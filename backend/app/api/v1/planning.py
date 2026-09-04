from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import Trip, TripProfile, Itinerary, GuideAssignment, Location
from app.schemas.schemas import PlanTripRequest, ItineraryResponse
from app.services.ai_orchestrator import AIOrchestrator, PACKAGE_DESTINATIONS
from app.services.verified_data import VERIFIED_TRANSPORT

router = APIRouter(prefix="/trips", tags=["Planning"])

FEES_FALLBACK = {"guide_fee": 0.0, "platform_fee": 0.0, "payable": 0.0}


def effective_breakdown(itinerary: Itinerary) -> dict:
    """Return the persisted cost breakdown, or a minimal one for legacy rows."""
    breakdown = itinerary.cost_breakdown or {}
    if breakdown.get("payable") is not None and breakdown.get("total") is not None:
        return breakdown
    guide_fee = float(breakdown.get("guide_fee") or 0.0)
    platform_fee = float(breakdown.get("platform_fee") or 0.0)
    total = float(itinerary.total_cost or 0.0)
    remaining = max(0.0, total - guide_fee - platform_fee)
    return {
        "transport": round(remaining * 0.3, 0),
        "stay": round(remaining * 0.4, 0),
        "food": round(remaining * 0.2, 0),
        "activities": round(remaining * 0.1, 0),
        "guide_fee": guide_fee,
        "platform_fee": platform_fee,
        "payable": round(guide_fee + platform_fee, 0),
        "total": total,
    }


@router.post("/{trip_id}/plan", response_model=ItineraryResponse)
def generate_trip_plan(
    trip_id: str,
    req: PlanTripRequest,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    if not req.consent_acknowledged:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Terms and conditions acknowledgement is mandatory to generate your itinerary."
        )

    profile_dict = trip.profile.questions_answers if trip.profile else {}

    # Real geography from the traveller's selected locations — never a default city.
    src_loc = db.query(Location).filter(Location.id == trip.source_location_id).first()
    dst_loc = db.query(Location).filter(Location.id == trip.destination_location_id).first()
    source_coords = {"lat": src_loc.lat, "lng": src_loc.lng} if src_loc and src_loc.lat is not None else None
    dest_coords = {"lat": dst_loc.lat, "lng": dst_loc.lng} if dst_loc and dst_loc.lat is not None else None

    try:
        itinerary_plan = AIOrchestrator.generate_itinerary(
            source_name=trip.source_name,
            destination_name=trip.destination_name,
            start_date=trip.start_datetime.isoformat(),
            end_date=trip.end_datetime.isoformat(),
            mode=req.mode,
            profile=profile_dict,
            source_coords=source_coords,
            dest_coords=dest_coords
        )
    except ValueError as exc:
        msg = str(exc)
        # Destinations that are truly reachable from this departure city today:
        # a verified itinerary package AND a verified transport route from the source.
        reachable = sorted({
            dst for (src, dst) in VERIFIED_TRANSPORT.keys()
            if src == trip.source_name and dst in PACKAGE_DESTINATIONS
        })
        if "No verified itinerary package" in msg:
            # The selected destination has no published itinerary package — structured & recoverable.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error_code": "DESTINATION_NOT_COVERED",
                    "message": msg,
                    "available_destinations": reachable,
                },
            )
        if "No verified transport schedule" in msg:
            # The destination has a package but no verified route from this departure city.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error_code": "ROUTE_NOT_COVERED",
                    "message": msg,
                    "available_destinations": reachable,
                },
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)

    breakdown = itinerary_plan["cost_breakdown"]

    # Deactivate previous itineraries
    db.query(Itinerary).filter(Itinerary.trip_id == trip.id).update({"is_active": False})

    itinerary = Itinerary(
        trip_id=trip.id,
        version=itinerary_plan["version"],
        is_active=True,
        total_cost=itinerary_plan["total_cost"],
        days_data=itinerary_plan["days"],
        cost_breakdown=breakdown,
    )
    db.add(itinerary)

    trip.mode = req.mode
    trip.total_cost = itinerary_plan["total_cost"]

    if req.mode == "GUIDE_MODE":
        trip.status = "REQUESTED"
        assignment = db.query(GuideAssignment).filter(GuideAssignment.trip_id == trip.id).first()
        if not assignment:
            assignment = GuideAssignment(trip_id=trip.id, status="REQUESTED")
            db.add(assignment)
    else:
        trip.status = "PLANNED"

    db.commit()
    db.refresh(itinerary)

    return ItineraryResponse(
        id=itinerary.id,
        trip_id=trip.id,
        version=itinerary.version,
        is_active=itinerary.is_active,
        total_cost=itinerary.total_cost,
        cost_breakdown=breakdown,
        days=itinerary.days_data,
        created_at=itinerary.created_at
    )


@router.get("/{trip_id}/itinerary", response_model=ItineraryResponse)
def get_trip_itinerary(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    itinerary = db.query(Itinerary).filter(
        Itinerary.trip_id == trip.id,
        Itinerary.is_active == True
    ).first()

    if not itinerary:
        raise HTTPException(status_code=404, detail="Itinerary not generated yet")

    breakdown = effective_breakdown(itinerary)

    return ItineraryResponse(
        id=itinerary.id,
        trip_id=trip.id,
        version=itinerary.version,
        is_active=itinerary.is_active,
        total_cost=itinerary.total_cost,
        cost_breakdown=breakdown,
        days=itinerary.days_data,
        created_at=itinerary.created_at
    )
