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
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
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
from app.services.budget_engine import (
    tier_for, get_budget_constraints, display_band_for,
    check_budget_feasibility, validate_itinerary_budget,
)
from app.services.itinerary_validator import validate_itinerary, merge_warnings

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


def _budget_category(price_per_night: Optional[float], profile: dict) -> str:
    """Classify a stay's price into a budget category based on the trip profile."""
    if price_per_night is None:
        return "unknown"
    bmax = float((profile or {}).get("budget", {}).get("max", 25000) or 25000)
    nightly_ratio = price_per_night / max(bmax / 3, 1)  # compare to ~1/3 of total budget
    if nightly_ratio < 0.05:
        return "low"
    if nightly_ratio < 0.15:
        return "medium"
    return "high"


def _budget_band(bmax: Optional[float]) -> str:
    """Coarse budget band used to PRIORITISE (never invent) options for the UI.
    Thresholds are centralized in budget_engine.BUDGET_CONFIG."""
    return display_band_for(float(bmax or 25000))


# Preferred display order per band: budget-fit options first, then adjacent ones.
_BAND_PREFERENCE = {
    "low": ("low", "medium"),
    "medium": ("medium", "low"),
    "high": ("high", "medium"),
}


def _stay_matches_band(budget_category: Optional[str], band: str) -> bool:
    if budget_category == "unknown":
        return True
    return str(budget_category or "").lower() in _BAND_PREFERENCE.get(band, ("low", "medium"))


def _band_order_key(band_order: List[str], stay: Dict[str, Any]) -> Tuple[int, int, float]:
    """Place budget-fit stays first, then inside-destination, then by rating."""
    cat = str(stay.get("budget_category") or "unknown").lower()
    band_pos = band_order.index(cat) if cat in band_order else len(band_order)
    inside = 0 if stay.get("placement") == "inside" else 1
    rating = -(float(stay.get("rating") or 0) or 0)
    return band_pos, inside, rating


def _food_order_key(band: str, food: Dict[str, Any]) -> Tuple[int, int, float]:
    """Budget-fit and outside-first-pass ordering for restaurants."""
    cls = str(food.get("budget_class") or "ok").lower()
    order = {"low": ("low", "ok", "high"), "medium": ("ok", "low", "high"), "high": ("high", "ok", "low")}.get(band, ("low", "ok", "high"))
    cls_pos = order.index(cls) if cls in order else len(order)
    inside = 0 if food.get("placement") == "inside" else 1
    rating = -(float(food.get("rating") or 0) or 0)
    return cls_pos, inside, rating


def _food_price_level(avg_cost_for_two: Optional[float]) -> Optional[str]:
    """Absolute cost indicator (₹ / ₹₹ / ₹₹₹) for restaurants — real price data."""
    if not avg_cost_for_two:
        return None
    if float(avg_cost_for_two) <= 600:
        return "1"
    if float(avg_cost_for_two) <= 1200:
        return "2"
    return "3"


def _food_budget_class(avg_cost_for_two: Optional[float], bmax: Optional[float]) -> str:
    """Budget-fit class for restaurants: fit, ok, pricey — relative to trip budget."""
    if not avg_cost_for_two:
        return "ok"
    share = float(bmax or 25000) / 8.0  # rough per-meal ceiling for two within the trip
    if float(avg_cost_for_two) <= share * 0.75:
        return "low"
    if float(avg_cost_for_two) <= share * 1.15:
        return "ok"
    return "high"


def _selection_item(item: Dict[str, Any]) -> Dict[str, Any]:
    """Normalise a discovery result into the structured preference shape the
    planner consumes (id, real coords, distance, price)."""
    return {
        "id": item.get("id") or item.get("place_id"),
        "name": item.get("name", ""),
        "latitude": item.get("latitude"),
        "longitude": item.get("longitude"),
        "distance_km": item.get("distance_km"),
        "placement": item.get("placement") or "inside",
        "entry_fee": item.get("entry_fee"),
        "duration_minutes": item.get("duration_minutes"),
        "rating": item.get("rating"),
        "source": item.get("source", "verified_api"),
    }


def _source_anchor(trip: Trip, db: Session) -> Dict[str, Any]:
    """Registered source ground truth (coordinates + state) for cost estimation."""
    loc = None
    if getattr(trip, "source_location_id", None):
        loc = db.query(Location).filter(Location.id == trip.source_location_id).first()
    if not loc:
        return {"coords": None, "state": None, "name": None}
    return {
        "coords": (loc.lat, loc.lng) if (getattr(loc, "lat", None) and getattr(loc, "lng", None)) else None,
        "state": loc.state,
        "name": loc.name,
    }


def _trip_days(trip: Trip) -> int:
    try:
        s, e = trip.start_datetime, trip.end_datetime
        if s and e:
            diff = (e - s).days
            return max(1, diff + 1)
    except Exception:
        pass
    return 2


def _raw_budget(profile: dict, trip_budget: float) -> float:
    """The traveller's RAW max budget BEFORE sanitize_envelope up-scaling.

    sanitize_envelope() maps implausibly small budgets to the 50k default band
    — that must NEVER decide feasibility. Feasibility is judged on the raw value.
    """
    raw = parse_budget((profile or {}).get("budget"), fallback=(0.0, float(trip_budget or 0)))
    hi = raw[1]
    if hi > 0:
        return hi
    return float(trip_budget or 0)


def _budget_verdict(trip: Trip, profile: dict, db: Session) -> Dict[str, Any]:
    """Run the Budget Feasibility Engine for this trip's real geography."""
    assert hasattr(trip, "destination_name")
    dest = trip.destination_name
    src = _source_anchor(trip, db)
    dst = _destination_anchor(trip, db)
    source_coords = tuple(src["coords"]) if src.get("coords") else None
    dest_coords = tuple(dst["coords"]) if dst.get("coords") else None
    return check_budget_feasibility(
        budget=_raw_budget(profile, getattr(trip, "budget", 0) or 0),
        destination=dest,
        days=_trip_days(trip),
        mode=str(trip.mode or "ADVENTUROUS_MODE"),
        profile=profile,
        source_name=src.get("name") or "",
        destination_state=dst.get("state") or "",
        source_coords=source_coords,
        dest_coords=dest_coords,
    )



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
            detail="We couldn't verify any real places for this destination right now. Please try another destination.",
        )

    env = _budget_envelope(profile, trip.budget)
    band = _budget_band(env["max"])

    # Budget tier panel for Step 3: central engine verdict + planner
    # constraints. The UI surfaces this as an honest advisor strip — never a
    # normal itinerary for an impossible budget.
    raw = _raw_budget(profile, trip.budget)
    raw_tier = tier_for(raw)
    constraints = get_budget_constraints(raw)
    tier_meta = {
        "tier": raw_tier,
        "label": constraints["tier_label"],
        "summary": constraints["tier_summary"],
        "budget_status": constraints["budget_status"],
        "economy": constraints["economy"],
        "impossible": raw_tier == "extremely_low",
    }

    attractions = discovery.get("must_visit") or []
    stays = discovery.get("stays") or []
    foods = discovery.get("food") or []
    activities = discovery.get("activities") or []

    def _attr(a: Dict[str, Any]) -> Dict[str, Any]:
        _inside = a.get("inside_destination")
        if _inside is None:
            _inside = bool(a.get("placement") == "inside") if a.get("placement") else not a.get("distance_km")
        return {
            "id": a.get("id") or a.get("place_id"),
            "name": a.get("name", ""),
            "category": a.get("category", "attraction"),
            "description": a.get("description"),
            "address": a.get("address"),
            "distance_km": a.get("distance_km"),
            "latitude": a.get("latitude"),
            "longitude": a.get("longitude"),
            "placement": a.get("placement") or ("inside" if not a.get("distance_km") else "nearby"),
            "inside_destination": bool(_inside),
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
        _inside = s.get("inside_destination")
        if _inside is None:
            _inside = bool(s.get("placement") == "inside") if s.get("placement") else not s.get("distance_km")
        return {
            "id": s.get("id") or s.get("place_id"),
            "name": s.get("name", ""),
            "tier": s.get("tier") or ("Verified stay" if s.get("price_per_night") else None),
            "price_per_night": s.get("price_per_night"),
            "rating": s.get("rating"),
            "amenities": s.get("amenities") or [],
            "address": s.get("address"),
            "latitude": s.get("latitude"),
            "longitude": s.get("longitude"),
            "distance_km": s.get("distance_km"),
            "placement": s.get("placement") or ("inside" if not s.get("distance_km") else "nearby"),
            "inside_destination": bool(_inside),
            "budget_category": _budget_category(s.get("price_per_night"), profile),
            "source": s.get("source", "verified_api"),
            "verified": s.get("verified", True),
            "already_in_plan": _in_plan(days, s.get("name", "")),
        }

    def _food(f: Dict[str, Any]) -> Dict[str, Any]:
        _inside = f.get("inside_destination")
        if _inside is None:
            _inside = bool(f.get("placement") == "inside") if f.get("placement") else not f.get("distance_km")
        return {
            "id": f.get("id") or f.get("place_id"),
            "name": f.get("name", ""),
            "cuisine": f.get("cuisine") or f.get("types"),
            "veg_type": f.get("veg_type"),
            "avg_cost_for_two": f.get("avg_cost_for_two"),
            "rating": f.get("rating"),
            "address": f.get("address"),
            "latitude": f.get("latitude"),
            "longitude": f.get("longitude"),
            "distance_km": f.get("distance_km"),
            "placement": f.get("placement") or ("inside" if not f.get("distance_km") else "nearby"),
            "inside_destination": bool(_inside),
            "price_level": _food_price_level(f.get("avg_cost_for_two")),
            "budget_class": _food_budget_class(f.get("avg_cost_for_two"), env["max"]),
            "source": f.get("source", "verified_api"),
            "verified": f.get("verified", True),
            "already_in_plan": _in_plan(days, f.get("name", "")),
        }

    # Budget-aware ordering (never fabrication): budget-fit stays first, then
    # inside the destination, then rating. For low-budget travellers expensive
    # category stays are not surfaced as normal results.
    stays_serialized = [_stay(s) for s in stays]
    band_order = list(_BAND_PREFERENCE.get(band, ("low", "medium")))
    if band == "low":
        stays_serialized = [s for s in stays_serialized if _stay_matches_band(s.get("budget_category"), band)] or stays_serialized
    stays_serialized.sort(key=lambda s: _band_order_key(band_order, s))

    foods_serialized = [_food(f) for f in foods]
    foods_serialized.sort(key=lambda f: _food_order_key(band, f))

    return {
        "destination": dest,
        "destination_latitude": discovery.get("destination_latitude"),
        "destination_longitude": discovery.get("destination_longitude"),
        "verified_only": True,
        "discovery_source": discovery.get("source"),
        "budget_band": band,
        "budget": {
            "tier": tier_meta,
            "budget_status": constraints["budget_status"],
            "maximum_allowed_spend": constraints["maximum_allowed_spend"],
            "constraints": constraints,
            "message": constraints["tier_summary"],
        },
        "core_radius_km": discovery.get("core_radius_km"),
        "destination_radius_km": discovery.get("destination_radius_km"),
        "counts": {"attractions": len(attractions), "stays": len(stays_serialized), "food": len(foods_serialized), "activities": len(activities)},
        "must_visit": [_attr(a) for a in attractions],
        "stays": stays_serialized,
        "food": foods_serialized,
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

    # ── BUDGET FEASIBILITY GATE ──────────────────────────────────────────────
    # The backend decides FIRST whether this budget can realistically support
    # the requested trip. The AI/planner never decides feasibility and never
    # receives an impossible budget (₹100/₹500/₹1,000 must NEVER yield a normal
    # itinerary — a previous sanitize_envelope() up-scale made that possible).
    verdict = _budget_verdict(trip, profile, db)
    if verdict["status"] == "impossible":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error_code": "BUDGET_INSUFFICIENT",
                "message": verdict["message"],
                "budget_status": "impossible",
                "minimum_required_budget": round(float(verdict["minimum_required_budget"])),
                "max_affordable_days": int(verdict["max_affordable_days"] or 0),
                "requested_days": int(verdict.get("requested_days") or _trip_days(trip)),
                "alternatives": verdict.get("alternatives") or [],
            },
        )
    constraints = verdict["constraints"]

    # Stay contract: "Continue without a stay" (stay_required=False) is an
    # ABSOLUTE rule — accommodation costs ₹0 and no hotel is ever auto-added,
    # even when the budget could afford one.
    req_stay_required = req.stay_required
    if req_stay_required is None and req.selected_stay:
        req_stay_required = True
    force_no_stay = req_stay_required is False

    # Selections are HARD PREFERENCES: persist them so /choose-plan and any
    # regeneration reproduce the exact same three plans deterministically.
    profile = dict(profile or {})
    place_items = [dict(x) for x in (req.selected_place_items or [])]
    food_items = [dict(x) for x in (req.selected_food_items or [])]

    # Structured items are the source of truth; name lists stay in sync so
    # every consumer (choose-plan, chat, replanning) sees the same selections.
    selected_places = [str(n) for n in (req.selected_places or [])]
    selected_food = [str(n) for n in (req.selected_food or [])]
    for it in place_items:
        nm = str(it.get("name") or "").strip()
        if nm and nm not in selected_places:
            selected_places.append(nm)
    for it in food_items:
        nm = str(it.get("name") or "").strip()
        if nm and nm not in selected_food:
            selected_food.append(nm)

    profile["selected_places"] = selected_places
    profile["selected_food"] = selected_food
    profile["selected_place_items"] = [_selection_item(it) for it in place_items if it.get("name")]
    profile["selected_food_items"] = [
        {**_selection_item(it), "cuisine": it.get("cuisine"), "avg_cost_for_two": it.get("avg_cost_for_two"),
         "price_level": it.get("price_level"), "budget_class": it.get("budget_class")}
        for it in food_items if it.get("name")
    ]
    # Single stay for the entire trip — persisted to keep the same hotel every night.
    if req.selected_stay and not force_no_stay:
        profile["selected_stay"] = {
            "id": req.selected_stay.get("id", ""),
            "name": req.selected_stay.get("name", ""),
            "latitude": req.selected_stay.get("latitude"),
            "longitude": req.selected_stay.get("longitude"),
            "distance_km": req.selected_stay.get("distance_km"),
            "price_per_night": req.selected_stay.get("price_per_night"),
            "rating": req.selected_stay.get("rating"),
            "budget_category": req.selected_stay.get("budget_category", "unknown"),
        }
    if force_no_stay:
        profile.pop("selected_stay", None)
    profile["stay_required"] = not force_no_stay
    profile["selected_stay_id"] = (req.selected_stay or {}).get("id") if not force_no_stay else None
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
        selected_places=selected_places,
        selected_food=selected_food,
        selected_place_items=profile.get("selected_place_items") or [],
        selected_food_items=profile.get("selected_food_items") or [],
        selected_stay=profile.get("selected_stay") or None,
        stay_tiers=req.stay_tiers or None,
        profile_stay_pref=str(profile.get("stay_pref") or ""),
        resolved_attractions=resolved_attractions,
        resolved_food=resolved_food,
        constraints=constraints,
        stay_required=req_stay_required,
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
                    f"The {p['type']} plan exceeds your selected budget ceiling "
                    f"(₹{round(float(p['final_total'])):,} > ₹{round(bmax):,}). "
                    "This destination/duration combination genuinely costs more than your maximum. "
                    "Raise your budget, shorten the trip, or choose a closer destination."
                ),
            )

    # Final itinerary validation: never trust the generator — re-verify totals.
    for p in plans:
        check = validate_itinerary_budget(p["final_total"], bmax)
        if not check["valid"]:
            raise HTTPException(
                status_code=422,
                detail={
                    "error_code": "BUDGET_INSUFFICIENT",
                    "message": (
                        f"We couldn't create a realistic itinerary within your current budget. "
                        "Try increasing your budget or reducing the trip duration."
                    ),
                    "budget_status": "impossible",
                    "minimum_required_budget": round(float(bmax), 0),
                },
            )

    # Schedule honesty: surface any overlap/tight-transfer warning on every
    # plan so the traveller sees reality before choosing, not after.
    for p in plans:
        schedule_check = validate_itinerary(p["cost_breakdown"], bmax, days=p["days"])
        p["warnings"] = merge_warnings(p.get("warnings") or [], schedule_check["warnings"])

    budget_mode = verdict.get("budget_status") == "restricted" or constraints.get("tier") in ("extremely_low", "very_low", "low")
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
            "budget_status": verdict.get("budget_status"),
            "budget_mode": budget_mode,
            "budget_mode_message": constraints["tier_summary"] if budget_mode else None,
            "minimum_required_budget": round(float(verdict.get("minimum_required_budget") or 0)),
            "max_affordable_days": int(verdict.get("max_affordable_days") or 0) or None,
            "stay_required": False if force_no_stay else (True if req.selected_stay else bool(profile.get("stay_required") or True)),
            "selected_stay_id": profile.get("selected_stay_id"),
            "stay_cost": float(p["cost_breakdown"].get("stay", 0) or 0),
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
    constraints = get_budget_constraints(_raw_budget(profile, trip.budget))
    mode = trip.mode or "ADVENTUROUS_MODE"
    base = generate_base_plan(trip, mode, db)
    base.setdefault("destination", trip.destination_name)
    plans = build_plans(
        base, env["min"], env["max"],
        selected_places=profile.get("selected_places") or [],
        selected_food=profile.get("selected_food") or [],
        selected_place_items=profile.get("selected_place_items") or [],
        selected_food_items=profile.get("selected_food_items") or [],
        selected_stay=profile.get("selected_stay") or None,
        stay_tiers=profile.get("selected_stay_tiers") or None,
        profile_stay_pref=str(profile.get("stay_pref") or ""),
        constraints=constraints,
        stay_required=profile.get("stay_required"),
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
