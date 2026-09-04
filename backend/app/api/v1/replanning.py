from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import Trip, Itinerary, ReplanningLog, OfflinePackage
from app.schemas.schemas import ReplanTriggerRequest, ReplanResponse, ItineraryResponse
from app.services.replanning_engine import ReplanningEngine
from app.services.offline_service import OfflinePackageService
from app.api.v1.planning import effective_breakdown

router = APIRouter(prefix="/trips", tags=["Replanning"])

@router.post("/{trip_id}/replan", response_model=ReplanResponse)
def trigger_dynamic_replan(
    trip_id: str,
    req: ReplanTriggerRequest,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER")),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    current_itinerary = db.query(Itinerary).filter(
        Itinerary.trip_id == trip.id,
        Itinerary.is_active == True
    ).first()
    if not current_itinerary:
        raise HTTPException(status_code=400, detail="No active itinerary found to replan")

    current_data = {
        "version": current_itinerary.version,
        "total_cost": current_itinerary.total_cost,
        "days": current_itinerary.days_data
    }

    replan_result = ReplanningEngine.execute_replan(
        current_itinerary_data=current_data,
        trigger_type=req.trigger_type,
        reason=req.reason,
        user_prompt=req.user_prompt
    )

    # Deactivate prior itinerary version
    current_itinerary.is_active = False

    # Create new Itinerary version
    new_itinerary = Itinerary(
        trip_id=trip.id,
        version=replan_result["new_version"],
        is_active=True,
        total_cost=current_itinerary.total_cost,
        days_data=replan_result["updated_itinerary"]["days"],
        cost_breakdown=current_itinerary.cost_breakdown or {}
    )
    db.add(new_itinerary)

    # Persist replanning log
    log = ReplanningLog(
        trip_id=trip.id,
        trigger_type=req.trigger_type,
        reason=req.reason,
        explanation=replan_result["explanation"],
        old_version=current_itinerary.version,
        new_version=replan_result["new_version"]
    )
    db.add(log)

    # Re-assemble updated OfflinePackage
    pkg_bundle = OfflinePackageService.assemble_package(
        trip_data={"id": trip.id, "source_name": trip.source_name, "destination_name": trip.destination_name, "start_datetime": trip.start_datetime, "end_datetime": trip.end_datetime, "mode": trip.mode},
        itinerary_data=new_itinerary.days_data,
        profile_data=trip.profile.questions_answers if trip.profile else {}
    )
    offline_pkg = db.query(OfflinePackage).filter(OfflinePackage.trip_id == trip.id).first()
    if offline_pkg:
        offline_pkg.package_data = pkg_bundle

    db.commit()
    db.refresh(new_itinerary)

    cost_breakdown = effective_breakdown(new_itinerary)

    itinerary_resp = ItineraryResponse(
        id=new_itinerary.id,
        trip_id=trip.id,
        version=new_itinerary.version,
        is_active=new_itinerary.is_active,
        total_cost=new_itinerary.total_cost,
        cost_breakdown=cost_breakdown,
        days=new_itinerary.days_data,
        created_at=new_itinerary.created_at
    )

    return ReplanResponse(
        new_version=new_itinerary.version,
        trigger_type=req.trigger_type,
        reason=req.reason,
        explanation=replan_result["explanation"],
        updated_itinerary=itinerary_resp
    )

@router.get("/{trip_id}/replan-history")
def get_replan_history(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    logs = db.query(ReplanningLog).filter(ReplanningLog.trip_id == trip_id).order_by(ReplanningLog.created_at.desc()).all()
    return [
        {
            "id": l.id,
            "trigger_type": l.trigger_type,
            "reason": l.reason,
            "explanation": l.explanation,
            "old_version": l.old_version,
            "new_version": l.new_version,
            "created_at": l.created_at
        }
        for l in logs
    ]
