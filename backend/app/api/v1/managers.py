from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import (
    Guide, Trip, GuideAssignment, PaymentSplit, Payment, User, AuditLog
)
from app.schemas.schemas import AssignGuideRequest
from app.services.matching_engine import GuideMatchingEngine

router = APIRouter(prefix="/manager", tags=["Manager"])

@router.get("/dashboard-stats")
def get_manager_stats(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    total_trips = db.query(Trip).count()
    pending_requests = db.query(GuideAssignment).filter(GuideAssignment.status == "REQUESTED").count()
    active_guides = db.query(Guide).filter(Guide.status == "ACTIVE", Guide.approval_status == "APPROVED").count()
    busy_guides = db.query(Guide).filter(Guide.status == "BUSY").count()
    duty_off_guides = db.query(Guide).filter(Guide.status == "DUTY_OFF").count()
    completed_trips = db.query(Trip).filter(Trip.status == "COMPLETED").count()
    pending_guide_approvals = db.query(Guide).filter(Guide.approval_status == "PENDING").count()

    return {
        "today_trips": total_trips,
        "pending_requests": pending_requests,
        "active_guides": active_guides,
        "busy_guides": busy_guides,
        "duty_off_guides": duty_off_guides,
        "completed_trips": completed_trips,
        "pending_guide_approvals": pending_guide_approvals
    }

@router.get("/pending-guides")
def get_pending_guides(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    guides = db.query(Guide).filter(Guide.approval_status == "PENDING").all()
    return [
        {
            "id": g.id,
            "name": f"{g.first_name} {g.last_name}",
            "languages": g.languages,
            "destinations": g.destinations,
            "experience_years": g.experience_years,
            "specializations": g.specializations,
            "destination_knowledge": g.destination_knowledge,
            "safety_information": g.safety_information,
            "created_at": g.created_at
        }
        for g in guides
    ]

@router.post("/guides/{guide_id}/approval")
def approve_or_reject_guide(
    guide_id: str,
    action: str,  # APPROVE or REJECT
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    guide = db.query(Guide).filter(Guide.id == guide_id).first()
    if not guide:
        raise HTTPException(status_code=404, detail="Guide not found")

    if action.upper() == "APPROVE":
        guide.approval_status = "APPROVED"
        guide.status = "ACTIVE"
    else:
        guide.approval_status = "REJECTED"
        guide.status = "DUTY_OFF"

    # Audit log
    audit = AuditLog(
        action=f"GUIDE_{action.upper()}",
        actor_email=current["email"],
        actor_role=current["role"],
        target_id=guide.id,
        details={"decision": action.upper()}
    )
    db.add(audit)
    db.commit()

    return {"message": f"Guide application {action.lower()}d successfully", "guide_id": guide.id}

@router.get("/trip-requests")
def get_trip_requests(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    assignments = db.query(GuideAssignment).filter(
        GuideAssignment.status.in_(["REQUESTED", "ACCEPTED", "CONFIRMED"])
    ).all()

    res = []
    for a in assignments:
        trip = a.trip
        user = trip.user
        res.append({
            "assignment_id": a.id,
            "trip_id": trip.id,
            "status": a.status,
            "destination": trip.destination_name,
            "source": trip.source_name,
            "start_datetime": trip.start_datetime,
            "end_datetime": trip.end_datetime,
            "assigned_guide_id": a.guide_id,
            "assigned_guide_name": f"{a.guide.first_name} {a.guide.last_name}" if a.guide else None,
            "match_score": a.match_score,
            "traveller": {
                "name": f"{user.first_name} {user.last_name}".strip() if user else "Traveller",
                "preferred_language": user.preferred_language if user else "English"
            }
        })
    return res

@router.get("/trip-requests/{trip_id}/candidates")
def get_ranked_candidates(
    trip_id: str,
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    user = trip.user
    preferred_lang = user.preferred_language if user else "English"
    add_langs = user.additional_languages if user else []

    # Find approved guides
    guides = db.query(Guide).filter(Guide.approval_status == "APPROVED").all()

    candidates = []
    for g in guides:
        score_res = GuideMatchingEngine.calculate_match(
            guide=g,
            destination_name=trip.destination_name,
            preferred_language=preferred_lang,
            additional_languages=add_langs
        )
        candidates.append({
            "guide_id": g.id,
            "name": f"{g.first_name} {g.last_name}",
            "photo_url": g.photo_url,
            "languages": g.languages or [],
            "rating": g.rating or 5.0,
            "review_count": g.review_count or 0,
            "experience_years": g.experience_years or 1,
            "match_score": score_res["match_score"],
            "match_breakdown": score_res["breakdown"],
            "status": g.status
        })

    # Sort descending by match score
    candidates.sort(key=lambda x: x["match_score"], reverse=True)
    return candidates

@router.post("/trip-requests/{trip_id}/assign")
def assign_guide_to_trip(
    trip_id: str,
    req: AssignGuideRequest,
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    guide = db.query(Guide).filter(Guide.id == req.guide_id).first()
    if not guide:
        raise HTTPException(status_code=404, detail="Guide not found")

    # Real concurrency check: guide cannot be assigned if already busy or duty off
    if guide.status == "BUSY" and guide.current_trip_id != trip.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This guide is currently marked BUSY with another active trip."
        )
    if guide.status == "DUTY_OFF":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This guide is currently on DUTY_OFF and cannot receive assignments."
        )

    assignment = db.query(GuideAssignment).filter(GuideAssignment.trip_id == trip.id).first()
    if not assignment:
        assignment = GuideAssignment(trip_id=trip.id)
        db.add(assignment)

    assignment.guide_id = guide.id
    assignment.status = "CONFIRMED"

    # Flip guide status
    guide.status = "BUSY"
    guide.current_trip_id = trip.id

    # Update trip status
    trip.status = "GUIDE_ASSIGNED"

    # Audit log
    audit = AuditLog(
        action="GUIDE_ASSIGNED",
        actor_email=current["email"],
        actor_role=current["role"],
        target_id=trip.id,
        details={"guide_id": guide.id, "guide_name": f"{guide.first_name} {guide.last_name}"}
    )
    db.add(audit)
    db.commit()

    return {
        "message": "Guide has been successfully assigned to the trip",
        "trip_id": trip.id,
        "guide_id": guide.id,
        "status": trip.status
    }

@router.get("/settlements")
def get_payment_settlements(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    splits = db.query(PaymentSplit).all()
    res = []
    for s in splits:
        payment = s.payment
        trip = payment.trip if payment else None
        guide = trip.guide_assignment.guide if (trip and trip.guide_assignment) else None
        res.append({
            "split_id": s.id,
            "payment_id": payment.id if payment else None,
            "trip_id": trip.id if trip else None,
            "guide_name": f"{guide.first_name} {guide.last_name}" if guide else "N/A",
            "guide_fee": s.guide_fee,
            "platform_fee": s.platform_fee,
            "total_amount": payment.total_amount if payment else 0.0,
            "settlement_status": s.settlement_status,
            "settled_at": s.settled_at
        })
    return res

@router.post("/settlements/{split_id}/settle")
def settle_guide_payout(
    split_id: str,
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    split = db.query(PaymentSplit).filter(PaymentSplit.id == split_id).first()
    if not split:
        raise HTTPException(status_code=404, detail="Settlement record not found")

    split.settlement_status = "SETTLED"
    db.commit()
    return {"message": "Guide fee payout settled successfully", "split_id": split.id}
