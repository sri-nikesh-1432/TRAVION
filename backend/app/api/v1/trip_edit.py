"""User-controlled itinerary lifecycle.

Extends the existing planning flow (app/api/v1/planning.py) without replacing
it. After the discovery interview, /plan-multi generates exactly THREE
budget-clamped plans (VALUE / RECOMMENDED / PREMIUM); /choose-plan activates
the user's pick; PATCH /itinerary applies any user change (remove / move /
add / reorder) with full recalculation; /itinerary/explore-more lists
unselected places that can be added anytime.

Every itinerary change is validated (budget / schedule / overlaps) and
persisted as a new itinerary version — the previous version is kept inactive
so the user can always see what changed. In GUIDE_MODE the assigned guide is
synchronized with a chat system message so the guide always sees the latest
plan.
"""
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import (
    Trip, Itinerary, GuideAssignment, Location, Guide, User, ChatMessage,
)
from app.schemas.schemas import (
    PlanMultiRequest, ChoosePlanRequest, ItineraryChangeRequest,
    ItineraryChangeResponse, ExplorePlaceItem, ItineraryResponse,
)
from app.api.v1.planning import generate_base_plan, effective_breakdown
from app.services.multi_plan_engine import build_plans, recalculate_change
from app.services.verified_data import VERIFIED_ATTRACTIONS

router = APIRouter(prefix="/trips", tags=["Trip Editing"])


def _budget_envelope(profile: dict | None, trip_budget: float) -> Dict[str, float]:
    """Budget envelope for this trip. Honors an explicit profile override."""
    bmin, bmax = 0.0, float(trip_budget or 15000.0)
    raw = (profile or {}).get("budget")
    if isinstance(raw, dict):
        try:
            bmin = float(raw.get("min") or 0)
            bmax = float(raw.get("max") or 0)
        except (TypeError, ValueError):
            pass
    if bmax <= 0:
        bmax = float(trip_budget or 15000.0)
    if bmin >= bmax:
        bmin = max(0.0, bmax * 0.8)
    return {"min": bmin, "max": bmax}


def _notify_guide(db: Session, trip: Trip, text: str) -> None:
    """Guide synchronization: post a chat message on the GUIDE channel so the
    assigned guide always sees the traveller's latest plan."""
    assignment = db.query(GuideAssignment).filter(
        GuideAssignment.trip_id == trip.id,
        GuideAssignment.status.in_(["ACTIVE", "CONFIRMED"]),
    ).first()
    if not assignment:
        return
    guide = db.query(Guide).filter(Guide.id == assignment.guide_id).first()
    if not guide:
        return
    db.add(ChatMessage(
        trip_id=trip.id,
        sender_role="AI",
        sender_id="system",
        sender_name="Travion",
        message=text,
        channel="GUIDE",
    ))


def _new_version_number(db: Session, trip_id: str) -> int:
    last = db.query(Itinerary).filter(Itinerary.trip_id == trip_id).order_by(
        Itinerary.version.desc()
    ).first()
    return (last.version + 1) if last and last.version else 1


def _persist_version(
    db: Session, trip: Trip, days: List[Dict[str, Any]],
    total_cost: float, breakdown: Dict[str, Any],
) -> Itinerary:
    db.query(Itinerary).filter(Itinerary.trip_id == trip.id).update({"is_active": False})
    itin = Itinerary(
        trip_id=trip.id,
        version=_new_version_number(db, trip.id),
        is_active=True,
        total_cost=total_cost,
        days_data=days,
        cost_breakdown=breakdown,
    )
    db.add(itin)
    trip.total_cost = total_cost
    return itin


def _own_trip(trip_id: str, current: dict, db: Session) -> Trip:
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if current["role"] == "USER":
        user = db.query(User).filter(User.identity_id == current["identity_id"]).first()
        if not user or user.id != trip.user_id:
            raise HTTPException(status_code=403, detail="You can only manage your own trips.")
    elif current["role"] not in ("MANAGER", "ADMIN"):
        guide = db.query(Guide).filter(Guide.identity_id == current["identity_id"]).first()
        assigned = guide and db.query(GuideAssignment).filter(
            GuideAssignment.trip_id == trip.id,
            GuideAssignment.guide_id == guide.id,
        ).first()
        if not assigned:
            raise HTTPException(status_code=403, detail="This trip is not assigned to you.")
    return trip


def _itinerary_response(itin: Itinerary) -> ItineraryResponse:
    return ItineraryResponse(
        id=itin.id,
        trip_id=itin.trip_id,
        version=itin.version,
        is_active=itin.is_active,
        total_cost=itin.total_cost,
        cost_breakdown=effective_breakdown(itin),
        days=itin.days_data,
        created_at=itin.created_at,
    )


def _in_plan(days: List[Dict[str, Any]], name: str) -> bool:
    for d in days or []:
        for s in d.get("stops", []) or []:
            if str(s.get("title", "")).lower().find(str(name).lower()) != -1:
                return True
    return False


# ── 1. Three in-budget plans ────────────────────────────────────────────────

@router.post("/{trip_id}/plan-multi")
def plan_multi(
    trip_id: str,
    req: PlanMultiRequest,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db),
):
    trip = _own_trip(trip_id, current, db)
    if not req.consent_acknowledged:
        raise HTTPException(status_code=400, detail="Consent is mandatory to generate plans.")

    profile = trip.profile.questions_answers if trip.profile else {}
    env = _budget_envelope(profile, trip.budget)
    bmin = float(req.budget_min) if req.budget_min is not None else env["min"]
    bmax = float(req.budget_max) if req.budget_max is not None else env["max"]
    if bmax <= 0:
        raise HTTPException(status_code=400, detail="A budget is required before generating plans.")
    if bmin >= bmax:
        bmin = max(0.0, bmax * 0.8)

    base = generate_base_plan(trip, req.mode, db)
    base.setdefault("destination", trip.destination_name)
    plans = build_plans(base, bmin, bmax)

    # Stash the three options on the trip record (transient JSON on TripProfile
    # would pollute the interview data; keep them in-memory per request instead
    # — choose-plan regenerates deterministically from the same base engine).
    return [
        {
            "type": p["type"],
            "label": p["label"],
            "tagline": p["tagline"],
            "total_cost": p["total_cost"],
            "cost_breakdown": p["cost_breakdown"],
            "days": p["days"],
            "budget_min": bmin,
            "budget_max": bmax,
            "within_budget": p["within_budget"],
            "warnings": p["warnings"],
            "recommended": p["type"] == "RECOMMENDED",
        }
        for p in plans
    ]


# ── 2. Activate the user's chosen plan ──────────────────────────────────────

@router.post("/{trip_id}/choose-plan", response_model=ItineraryResponse)
def choose_plan(
    trip_id: str,
    req: ChoosePlanRequest,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db),
):
    trip = _own_trip(trip_id, current, db)

    profile = trip.profile.questions_answers if trip.profile else {}
    env = _budget_envelope(profile, trip.budget)
    mode = trip.mode or "ADVENTUROUS_MODE"
    base = generate_base_plan(trip, mode, db)
    base.setdefault("destination", trip.destination_name)
    plans = build_plans(base, env["min"], env["max"])
    chosen = next((p for p in plans if p["type"] == req.plan_type), None)
    if not chosen:
        raise HTTPException(status_code=400, detail="Unknown plan type.")

    itin = _persist_version(db, trip, chosen["days"], chosen["total_cost"], chosen["cost_breakdown"])
    db.commit()
    db.refresh(itin)
    return _itinerary_response(itin)


# ── 3. Apply a user change (drag & drop / remove / add / move) ──────────────

@router.patch("/{trip_id}/itinerary", response_model=ItineraryChangeResponse)
def edit_itinerary(
    trip_id: str,
    change: ItineraryChangeRequest,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db),
):
    trip = _own_trip(trip_id, current, db)
    itin = db.query(Itinerary).filter(
        Itinerary.trip_id == trip.id, Itinerary.is_active == True
    ).first()
    if not itin:
        raise HTTPException(status_code=404, detail="No active itinerary to edit. Generate a plan first.")

    profile = trip.profile.questions_answers if trip.profile else {}
    env = _budget_envelope(profile, trip.budget)

    if change.kind == "add" and not change.stop:
        raise HTTPException(status_code=400, detail="An `stop` payload is required to add a place.")

    result = recalculate_change(
        days=itin.days_data or [],
        cost_breakdown=itin.cost_breakdown or {},
        budget_max=env["max"],
        change=change.model_dump(exclude_none=True),
    )
    if not result["applied"]:
        raise HTTPException(status_code=400, detail="Change could not be applied (stop not found).")

    new_itin = _persist_version(db, trip, result["days"], result["total_cost"], result["cost_breakdown"])

    # Guide synchronization — the assigned guide sees every traveller change.
    _notify_guide(
        db, trip,
        f"Traveller updated the itinerary (v{new_itin.version}). "
        f"New total ₹{round(new_itin.total_cost):,}. Please review the latest plan."
    )

    db.commit()
    db.refresh(new_itin)
    return ItineraryChangeResponse(
        itinerary=_itinerary_response(new_itin),
        warnings=result["warnings"],
        applied=True,
    )


# ── 4. Explore more: unselected verified places for this destination ───────

@router.get("/{trip_id}/itinerary/explore-more", response_model=List[ExplorePlaceItem])
def explore_more(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE")),
    db: Session = Depends(get_db),
):
    trip = _own_trip(trip_id, current, db)
    itin = db.query(Itinerary).filter(
        Itinerary.trip_id == trip.id, Itinerary.is_active == True
    ).first()

    dest = trip.destination_name
    catalog = VERIFIED_ATTRACTIONS.get(dest) or []
    items: List[ExplorePlaceItem] = []
    for a in catalog:
        if _in_plan(itin.days_data if itin else [], a.get("name", "")):
            continue
        items.append(ExplorePlaceItem(
            name=a.get("name", ""),
            category=a.get("category", "attraction"),
            description=a.get("description"),
            lat=float(a.get("lat", 0) or 0),
            lng=float(a.get("lng", 0) or 0),
            entry_fee=float(a.get("entry_fee", 0) or 0),
            duration_minutes=int(a.get("duration_minutes", 90) or 90),
            rating=float(a.get("rating", 4.6) or 4.6),
            source=a.get("source", "verified_api"),
        ))
    return items
