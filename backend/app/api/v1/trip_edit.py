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
from app.services.verified_data import VERIFIED_ATTRACTIONS, VERIFIED_STAYS, VERIFIED_FOOD
from app.services.places_discovery import discover_destination
from app.services.budget_service import (
    parse_budget, base_ceiling_for, remaining_budget as budget_remaining,
    sanitize_envelope, compute_totals, fit_to_budget,
)

router = APIRouter(prefix="/trips", tags=["Trip Editing"])


def _budget_envelope(profile: dict | None, trip_budget: float) -> Dict[str, float]:
    """Budget envelope for this trip — parsed ONLY via the centralized
    BudgetService so currency-symbol strings like '₹10,000 - ₹25,000' can
    never explode into a billion-rupee budget, then clamped to a sane band
    so no malformed value can ever reach the planner."""
    override = None
    if trip_budget and float(trip_budget) > 0:
        override = (float(trip_budget) * 0.8, float(trip_budget))
    bmin, bmax = parse_budget((profile or {}).get("budget"), fallback=override)
    bmin, bmax = sanitize_envelope(bmin, bmax)
    if bmin >= bmax:
        bmin = max(1000.0, bmax * 0.8)
    return {"min": bmin, "max": bmax}


def _normalize_plan_totals(plan: Dict[str, Any], budget_max: float) -> None:
    """Belt-and-suspenders clamp: recompute a plan's fee/total from the single
    source of truth (BudgetService) so the flat 3% rule is ALWAYS the last word,
    regardless of which engine generated the plan."""
    bd = plan["cost_breakdown"]
    base = fit_to_budget(float(plan["base_plan_cost"]), budget_max)
    totals = compute_totals(base)
    plan["base_plan_cost"] = totals["base_plan_cost"]
    plan["platform_fee"] = totals["platform_fee"]
    plan["final_total"] = totals["final_total"]
    plan["total_cost"] = totals["final_total"]
    plan["remaining_budget"] = round(float(budget_max) - totals["final_total"], 0)
    plan["within_budget"] = bool(plan["final_total"] <= float(budget_max))
    bd["base_plan_cost"] = totals["base_plan_cost"]
    bd["platform_fee"] = totals["platform_fee"]
    bd["final_total"] = totals["final_total"]
    bd["total"] = totals["final_total"]
    bd["payable"] = round(float(bd.get("guide_fee", 0) or 0) + totals["platform_fee"], 0)


def _destination_anchor(trip: Trip, db: Session) -> Dict[str, Any]:
    """Registered destination ground truth from the real location picker.

    Returns a dict with the destination's REAL coordinates and state whenever
    the trip was created from a recognized Location. This is what lets place
    discovery run around the exact registered spot even when the destination
    name is unindexed (Cochin, Dharamshala, …) or ambiguous (Manali TN vs HP).
    """
    loc = None
    if getattr(trip, "destination_location_id", None):
        loc = db.query(Location).filter(Location.id == trip.destination_location_id).first()
    if not loc:
        return {"coords": None, "state": None, "name": None}
    return {
        "coords": (loc.lat, loc.lng) if (getattr(loc, "lat", None) and getattr(loc, "lng", None)) else None,
        "state": loc.state,
        "name": loc.name,
    }


def _discovery_kwargs(anchor: Dict[str, Any]) -> Dict[str, Any]:
    """Keyword-args for discover_destination() extracted from the anchor."""
    kwargs: Dict[str, Any] = {}
    if anchor.get("coords"):
        kwargs["coords"] = (float(anchor["coords"][0]), float(anchor["coords"][1]))
    if anchor.get("state"):
        kwargs["state"] = str(anchor["state"])
    return kwargs


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


# ── 0. Destination discovery catalog: REAL verified places only ─────────────

@router.get("/{trip_id}/destination-catalog")
def destination_catalog(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Everything the discovery screen needs — grouped, verified, no inventions.

    attractions/stays/food come straight from the verified data service; every
    item carries `verified: true` so the UI can show the ✓ Verified badge.
    Places already in the active itinerary are flagged `already_in_plan`.
    """
    trip = _own_trip(trip_id, current, db)
    itin = db.query(Itinerary).filter(
        Itinerary.trip_id == trip.id, Itinerary.is_active == True
    ).first()
    days = itin.days_data if itin else []

    dest = trip.destination_name
    profile = trip.profile.questions_answers if trip.profile else {}
    discovery = discover_destination(
        dest,
        preferences={
            "interests": (profile.get("experience") or []),
            "restrictions": (profile.get("restrictions") or []),
        },
        **_discovery_kwargs(_destination_anchor(trip, db)),
    )
    if not discovery.get("total_places"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="We're unable to verify enough places for this destination right now. Please try another destination.",
        )

    attractions = discovery.get("must_visit") or []
    stays = discovery.get("stays") or []
    foods = discovery.get("food") or []
    activities = discovery.get("activities") or []

    def _attr(a: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "name": a.get("name", ""),
            "category": a.get("category", "attraction"),
            "description": a.get("description"),
            "address": a.get("address"),
            "distance_km": a.get("distance_km"),
            "rating": a.get("rating"),
            "review_count": a.get("review_count"),
            "opening_hours": a.get("opening_hours"),
            "entry_fee": a.get("entry_fee") if a.get("entry_fee") is not None else 0,
            "duration_minutes": a.get("duration_minutes") or 90,
            "duration_is_estimate": a.get("duration_is_estimate", True),
            "source": a.get("source", "verified_api"),
            "verified": a.get("verified", True),
            "already_in_plan": _in_plan(days, a.get("name", "")),
        }

    def _stay(s: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "name": s.get("name", ""),
            "tier": s.get("tier") or ("Verified stay" if s.get("price_per_night") else None),
            "price_per_night": s.get("price_per_night"),
            "rating": s.get("rating"),
            "amenities": s.get("amenities") or [],
            "address": s.get("address"),
            "source": s.get("source", "verified_api"),
            "verified": s.get("verified", True),
            "already_in_plan": _in_plan(days, s.get("name", "")),
        }

    def _food(f: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "name": f.get("name", ""),
            "cuisine": f.get("cuisine") or f.get("types"),
            "veg_type": f.get("veg_type"),
            "avg_cost_for_two": f.get("avg_cost_for_two"),
            "rating": f.get("rating"),
            "address": f.get("address"),
            "source": f.get("source", "verified_api"),
            "verified": f.get("verified", True),
            "already_in_plan": _in_plan(days, f.get("name", "")),
        }

    return {
        "destination": dest,
        "verified_only": True,
        "discovery_source": discovery.get("source"),
        "counts": {"attractions": len(attractions), "stays": len(stays), "food": len(foods), "activities": len(activities)},
        "must_visit": [_attr(a) for a in attractions],
        "stays": [_stay(s) for s in stays],
        "food": [_food(f) for f in foods],
        "activities": [_attr(a) for a in activities],
    }


# ── 1. Three in-budget plans ───────────────────────────────────────────────

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
    bmin, bmax = sanitize_envelope(bmin, bmax)
    if bmax <= 0:
        raise HTTPException(status_code=400, detail="A budget is required before generating plans.")
    if bmin >= bmax:
        bmin = max(1000.0, bmax * 0.8)

    # Selections are HARD PREFERENCES: persist them so /choose-plan and any
    # regeneration reproduce the exact same three plans deterministically.
    profile = dict(profile or {})
    profile["selected_places"] = req.selected_places or []
    profile["selected_food"] = req.selected_food or []
    profile["selected_stay_tiers"] = {k: v for k, v in (req.stay_tiers or {}).items() if v}
    if trip.profile:
        trip.profile.questions_answers = profile

    base = generate_base_plan(trip, req.mode, db)
    base.setdefault("destination", trip.destination_name)

    # Resolve selected names against the discovery pipeline so selections from
    # the generic index (any destination in India) are injectable too. The
    # trip's registered coordinates/state anchor the search (REAL places only).
    anchor = _destination_anchor(trip, db)
    discovery = discover_destination(
        trip.destination_name,
        preferences={
            "interests": (profile.get("experience") or []),
            "restrictions": (profile.get("restrictions") or []),
        },
        **_discovery_kwargs(anchor),
    )
    resolved_attractions = [
        {"name": a["name"], "category": "attraction", "description": a.get("description"),
         "lat": a.get("latitude") or 0, "lng": a.get("longitude") or 0,
         "entry_fee": a.get("entry_fee") or 0, "duration_minutes": a.get("duration_minutes") or 90,
         "rating": a.get("rating") or 4.5, "source": a.get("source", "verified_api")}
        for a in (discovery.get("must_visit") or []) + (discovery.get("activities") or [])
    ]
    resolved_food = [
        {"name": f["name"], "cuisine": f.get("cuisine") or "", "veg_type": f.get("veg_type") or "",
         "lat": f.get("latitude") or 0, "lng": f.get("longitude") or 0,
         "avg_cost_for_two": f.get("avg_cost_for_two") or 500, "rating": f.get("rating") or 4.5,
         "source": f.get("source", "verified_api")}
        for f in (discovery.get("food") or [])
    ]

    plans = build_plans(
        base, bmin, bmax,
        selected_places=req.selected_places,
        selected_food=req.selected_food,
        stay_tiers=req.stay_tiers or None,
        profile_stay_pref=str(profile.get("stay_pref") or ""),
        resolved_attractions=resolved_attractions,
        resolved_food=resolved_food,
    )

    # Belt-and-braces: the plan engine already clamps, but the flat 3% rule
    # from the BudgetService is the final word on every returned total.
    for p in plans:
        _normalize_plan_totals(p, bmax)

    # A single plan that still exceeds the traveller's selected maximum is an
    # unacceptable result. Reject it loudly instead of shipping an over-budget plan.
    for p in plans:
        if float(p["final_total"]) > bmax + 0.01:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"The {p['type']} plan exceeds your selected budget "
                    f"(₹{round(float(p['final_total'])):,} > ₹{round(bmax):,}). "
                    "Please raise your budget or remove some selections."
                ),
            )

    return [
        {
            "type": p["type"],
            "label": p["label"],
            "tagline": p["tagline"],
            "base_plan_cost": p["base_plan_cost"],
            "platform_fee": p["platform_fee"],
            "final_total": p["final_total"],
            "total_cost": p["total_cost"],
            "cost_breakdown": p["cost_breakdown"],
            "days": p["days"],
            "budget_min": bmin,
            "budget_max": bmax,
            "remaining_budget": p["remaining_budget"],
            "within_budget": p["within_budget"],
            "highlights": p["highlights"],
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

    profile = dict(trip.profile.questions_answers if trip.profile else {})
    env = _budget_envelope(profile, trip.budget)
    mode = trip.mode or "ADVENTUROUS_MODE"
    base = generate_base_plan(trip, mode, db)
    base.setdefault("destination", trip.destination_name)
    plans = build_plans(
        base, env["min"], env["max"],
        selected_places=profile.get("selected_places") or [],
        selected_food=profile.get("selected_food") or [],
        stay_tiers=profile.get("selected_stay_tiers") or None,
        profile_stay_pref=str(profile.get("stay_pref") or ""),
    )
    chosen = next((p for p in plans if p["type"] == req.plan_type), None)
    if not chosen:
        raise HTTPException(status_code=400, detail="Unknown plan type.")

    _normalize_plan_totals(chosen, env["max"])

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
    profile = trip.profile.questions_answers if trip.profile else {}

    # Generic Explore More: curated catalog PLUS discovery-resolved real
    # places, so it works for ANY destination in India — never invented.
    catalog: List[Dict[str, Any]] = []
    for a in VERIFIED_ATTRACTIONS.get(dest) or []:
        catalog.append({
            "name": a.get("name", ""), "category": a.get("category", "attraction"),
            "description": a.get("description"), "lat": a.get("lat") or 0, "lng": a.get("lng") or 0,
            "entry_fee": a.get("entry_fee") or 0, "duration_minutes": a.get("duration_minutes") or 90,
            "rating": a.get("rating"), "source": a.get("source", "verified_api"),
        })
    discovery = discover_destination(
        dest,
        preferences={
            "interests": (profile.get("experience") or []),
            "restrictions": (profile.get("restrictions") or []),
        },
        **_discovery_kwargs(_destination_anchor(trip, db)),
    )
    seen = {str(c.get("name", "")).lower() for c in catalog}
    for a in discovery.get("must_visit") or []:
        if str(a.get("name", "")).lower() in seen:
            continue
        seen.add(str(a.get("name", "")).lower())
        catalog.append({
            "name": a.get("name", ""), "category": a.get("category", "attraction"),
            "description": a.get("description"), "lat": a.get("latitude") or 0, "lng": a.get("longitude") or 0,
            "entry_fee": a.get("entry_fee") or 0, "duration_minutes": a.get("duration_minutes") or 90,
            "rating": a.get("rating"), "source": a.get("source", "verified_api"),
        })

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
