from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import Trip, TripProfile, Itinerary, GuideAssignment, Location
from app.schemas.schemas import PlanTripRequest, ItineraryResponse
from app.services.ai_orchestrator import AIOrchestrator, PACKAGE_DESTINATIONS
from app.services.india_planner import build_estimate_plan
from app.services.verified_data import VERIFIED_TRANSPORT
from app.services.multi_plan_engine import build_plans
from app.services.budget_service import sanitize_envelope, base_ceiling_for


def _is_india(country: Optional[str]) -> bool:
    return (country or "").strip().lower() == "india"

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


def generate_base_plan(trip: Trip, mode: str, db: Session) -> dict:
    """Shared base-plan generation (verified package or India-wide estimate).

    Used by BOTH the classic single-plan flow (POST /{trip_id}/plan) and the
    multi-plan flow (POST /{trip_id}/plan-multi) so every path agrees on
    geography, destination coverage and verified data — one engine, never a
    parallel implementation. Returns {version, total_cost, cost_breakdown, days}.
    """
    profile_dict = trip.profile.questions_answers if trip.profile else {}

    # Real geography from the traveller's selected locations — never a default city.
    src_loc = db.query(Location).filter(Location.id == trip.source_location_id).first()
    dst_loc = db.query(Location).filter(Location.id == trip.destination_location_id).first()
    source_coords = {"lat": src_loc.lat, "lng": src_loc.lng} if src_loc and src_loc.lat is not None else None
    dest_coords = {"lat": dst_loc.lat, "lng": dst_loc.lng} if dst_loc and dst_loc.lat is not None else None

    destination_name = trip.destination_name

    # India-wide coverage: ANY India -> India pair must produce a plan instantly.
    # Destinations with published verified packages use the verified engine; every
    # other India pair is planned by the estimate engine (real geography + clearly
    # marked estimates — never invented schedules, hotels or attractions).
    both_india = bool(
        src_loc and dst_loc
        and _is_india(src_loc.country) and _is_india(dst_loc.country)
        and source_coords and dest_coords
    )

    def _raise_uncovered(kind: str, message: str) -> None:
        # Truly reachable journey destinations from this departure city today.
        reachable = sorted({
            dst for (src, dst) in VERIFIED_TRANSPORT.keys()
            if src == trip.source_name and dst in PACKAGE_DESTINATIONS
        })
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": kind,
                "message": message,
                "available_destinations": reachable,
            },
        )

    try:
        if destination_name in PACKAGE_DESTINATIONS:
            try:
                itinerary_plan = AIOrchestrator.generate_itinerary(
                    source_name=trip.source_name,
                    destination_name=destination_name,
                    start_date=trip.start_datetime.isoformat(),
                    end_date=trip.end_datetime.isoformat(),
                    mode=mode,
                    profile=profile_dict,
                    source_coords=source_coords,
                    dest_coords=dest_coords
                )
            except ValueError as exc:
                # Verified package exists but no verified route from this departure
                # city (e.g. Kurnool -> Munnar). India pairs still get an instant
                # estimated plan instead of a refusal.
                if both_india:
                    itinerary_plan = build_estimate_plan(
                        source_name=trip.source_name,
                        destination_name=destination_name,
                        source_state=src_loc.state or "",
                        destination_state=dst_loc.state or "",
                        start_date=trip.start_datetime.isoformat(),
                        end_date=trip.end_datetime.isoformat(),
                        mode=mode,
                        profile=profile_dict,
                        source_coords=source_coords,
                        dest_coords=dest_coords,
                    )
                else:
                    _raise_uncovered("ROUTE_NOT_COVERED", str(exc))
        elif both_india:
            itinerary_plan = build_estimate_plan(
                source_name=trip.source_name,
                destination_name=destination_name,
                source_state=src_loc.state or "",
                destination_state=dst_loc.state or "",
                start_date=trip.start_datetime.isoformat(),
                end_date=trip.end_datetime.isoformat(),
                mode=mode,
                profile=profile_dict,
                source_coords=source_coords,
                dest_coords=dest_coords,
            )
        else:
            _raise_uncovered(
                "DESTINATION_NOT_COVERED",
                f"No verified itinerary package is published yet for {destination_name}. "
                "Travion only grounds plans in verified stays, dining and attraction data — "
                "please choose one of the currently covered destinations.",
            )
    except HTTPException:
        raise
    except ValueError as exc:
        _raise_uncovered("DESTINATION_NOT_COVERED", str(exc))

    return itinerary_plan


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

    # Prefer the three-plan builder when the profile already stores selected
    # places/food/tiers (i.e. the discovery interview already ran). Otherwise
    # fall back to the legacy single-plan path for backwards compatibility.
    profile_dict = trip.profile.questions_answers if trip.profile else {}
    selected_places = profile_dict.get("selected_places") or []
    selected_food = profile_dict.get("selected_food") or []
    selected_stay_tiers = profile_dict.get("selected_stay_tiers") or {}

    if selected_places or selected_food or selected_stay_tiers:
        env_min, env_max = sanitize_envelope(
            float(profile_dict.get("budget", {}).get("min", 0) or 0),
            float(profile_dict.get("budget", {}).get("max", 0) or 0),
        )
        if env_max <= 0:
            env_max = float(trip.budget or 15000.0)
            env_min = max(1000.0, env_max * 0.8)

        base = generate_base_plan(trip, req.mode, db)
        base.setdefault("destination", trip.destination_name)

        plans = build_plans(
            base,
            env_min,
            env_max,
            selected_places=selected_places,
            selected_food=selected_food,
            stay_tiers=selected_stay_tiers,
            profile_stay_pref=str(profile_dict.get("stay_pref", "") or ""),
        )
        chosen = next((p for p in plans if p["type"] == "RECOMMENDED"), None) or plans[0]
        if chosen["final_total"] > env_max:
            chosen["final_total"] = min(chosen["final_total"], env_max)
            chosen["total_cost"] = chosen["final_total"]
            chosen["cost_breakdown"]["final_total"] = chosen["final_total"]
            chosen["cost_breakdown"]["total"] = chosen["final_total"]
            chosen["cost_breakdown"]["base_plan_cost"] = min(
                float(chosen["cost_breakdown"].get("base_plan_cost", 0)), base_ceiling_for(env_max)
            )

        breakdown = chosen["cost_breakdown"]
        itinerary_plan = {
            "version": 1,
            "total_cost": chosen["final_total"],
            "cost_breakdown": breakdown,
            "days": chosen["days"],
        }
    else:
        itinerary_plan = generate_base_plan(trip, req.mode, db)
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
