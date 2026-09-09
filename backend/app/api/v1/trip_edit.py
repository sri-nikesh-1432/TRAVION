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
    PlanChangeLog,
)
from app.schemas.schemas import (
    PlanMultiRequest, ChoosePlanRequest, ItineraryChangeRequest,
    ItineraryChangeResponse, ExplorePlaceItem, ItineraryResponse,
    PlaceSearchItem, PlanChangeResponse, OptimizeDayRequest,
    OptimizeDayResponse, ConfirmPlanResponse, SelectionPayload,
    SelectionSyncRequest, TripSelectionResponse, SelectionsResponse,
    PlaceDetailsResponse,
)
from app.api.v1.planning import generate_base_plan, effective_breakdown
from app.services.multi_plan_engine import (
    build_plans, recalculate_change, _resequence, _haversine_km, validate_days,
    _norm, normalize_plan_totals,
)
from app.services.verified_data import VERIFIED_ATTRACTIONS, VERIFIED_STAYS, VERIFIED_FOOD
from app.services.places_discovery import discover_destination, discover_nearby
from app.services.place_selections import (
    upsert_selection, remove_selection, active_selections, selections_payload,
    sync_selections, selections_for_plan, selection_payload,
)
from app.services.budget_service import (
    parse_budget, remaining_budget as budget_remaining,
    sanitize_envelope,
)
from app.services.pricing_service import reprice_breakdown
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


def _log_change(
    db: Session, trip: Trip, version: int, change_type: str, summary: str
) -> None:
    """Append one immutable PlanChangeLog row for a persisted plan version."""
    db.add(PlanChangeLog(
        trip_id=trip.id,
        version=version,
        change_type=change_type,
        summary=summary,
    ))


def _stop_title(days: List[Dict[str, Any]], stop_id: str) -> Optional[str]:
    for d in days or []:
        for s in (d.get("stops") or []):
            if s.get("id") == stop_id:
                return str(s.get("title") or s.get("name") or "item")
    return None


def _change_summary(
    change: Dict[str, Any], old_days: List[Dict[str, Any]]
) -> str:
    """Human-readable, verifiable diff of a single user edit. Titles are the
    real stop titles as persisted — never invented descriptions."""
    kind = change.get("kind")
    if kind == "add":
        title = str((change.get("stop") or {}).get("title") or (change.get("stop") or {}).get("name") or "a place")
        return f"Added “{title}” to Day {int(change.get('new_day') or (change.get('stop') or {}).get('day') or 1)}"
    if kind == "remove":
        title = _stop_title(old_days, str(change.get("stop_id", ""))) or "an item"
        return f"Removed “{title}”"
    if kind == "move_time":
        title = _stop_title(old_days, str(change.get("stop_id", ""))) or "an item"
        return f"Changed timing of “{title}” to {change.get('new_time')}"
    if kind == "move_day":
        title = _stop_title(old_days, str(change.get("stop_id", ""))) or "an item"
        return f"Moved “{title}” to Day {int(change.get('new_day') or 1)}"
    if kind == "reorder":
        title = _stop_title(old_days, str(change.get("stop_id", ""))) or "an item"
        return f"Resequenced “{title}” within Day {int(change.get('new_day') or 1)}"
    return "Updated the itinerary"


def _plan_version(db: Session, trip_id: str) -> Optional[PlanChangeLog]:
    return db.query(PlanChangeLog).filter(PlanChangeLog.trip_id == trip_id).order_by(
        PlanChangeLog.version.desc()
    ).first()


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
        "catalog_meta": discovery.get("catalog_meta"),
        "counts": {"attractions": len(attractions), "stays": len(stays_serialized), "food": len(foods_serialized), "activities": len(activities)},
        # Server-side single source of truth: the selections the traveller made
        # on earlier visits, so the UI can restore the "selected for my trip"
        # panel exactly (no fake counts, no lost picks on refresh).
        "selections": [
            {
                "provider_place_id": s["provider_place_id"],
                "name": s["name"],
                "category": s["category"],
                "selection_source": s["selection_source"],
            }
            for s in (selections_payload(db, trip.id)["selections"])
        ],
        "must_visit": [_attr(a) for a in attractions],
        "stays": stays_serialized,
        "food": foods_serialized,
        "activities": [_attr(a) for a in activities],
    }


# ─────────────────────────────────────────────────────────────────────────────
# 0b. Trip place selections — server-side single source of truth (Step 3/4/5)
# Row identity is (trip_id, provider_place_id); add/remove is idempotent, so
# map↔card↔planner selections survive a refresh and flow to guide/manager views.
# ─────────────────────────────────────────────────────────────────────────────

def _current_user(db: Session, current: dict) -> User:
    user = db.query(User).filter(User.identity_id == current["identity_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/{trip_id}/selections", response_model=SelectionsResponse)
def get_trip_selections(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    trip = _own_trip(trip_id, current, db)
    data = selections_payload(db, trip.id)
    return SelectionsResponse(
        destination=trip.destination_name,
        selections=data["selections"],
        counts=data["counts"],
        total=data["total"],
    )


@router.post("/{trip_id}/selections", response_model=TripSelectionResponse)
def add_trip_selection(
    trip_id: str,
    req: SelectionPayload,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db),
):
    trip = _own_trip(trip_id, current, db)
    user = _current_user(db, current)
    row = upsert_selection(db, trip.id, user.id, req.model_dump(exclude_none=True))
    db.commit()
    return TripSelectionResponse(**selection_payload(row))


@router.post("/{trip_id}/selections/sync", response_model=SelectionsResponse)
def sync_trip_selections(
    trip_id: str,
    req: SelectionSyncRequest,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db),
):
    trip = _own_trip(trip_id, current, db)
    user = _current_user(db, current)
    sync_selections(
        db, trip.id, user.id,
        [p.model_dump(exclude_none=True) for p in req.items],
        replace=req.replace,
    )
    db.commit()
    data = selections_payload(db, trip.id)
    return SelectionsResponse(
        destination=trip.destination_name,
        selections=data["selections"],
        counts=data["counts"],
        total=data["total"],
    )


@router.delete("/{trip_id}/selections/{provider_place_id}")
def delete_trip_selection(
    trip_id: str,
    provider_place_id: str,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db),
):
    trip = _own_trip(trip_id, current, db)
    row = remove_selection(db, trip.id, provider_place_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No active selection for that place.")
    db.commit()
    return {"removed": True, "provider_place_id": provider_place_id}


# ─────────────────────────────────────────────────────────────────────────────
# 0c. Real map data — the map's real dataset (recommended + verified map tiers)
# Places NEARBY and place DETAILS are defined after /places/search below so the
# fixed path segments (search, nearby) win over the {provider_place_id} catch-all.
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{trip_id}/map-places")
def map_places_catalog(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """The map's REAL dataset: the destination-wide discovery buckets PLUS any
    broader mapped categories (shopping/healthcare/education/transport/other)
    that a live provider verified. Never includes fabricated markers."""
    trip = _own_trip(trip_id, current, db)
    profile = trip.profile.questions_answers if trip.profile else {}
    discovery = discover_destination(
        trip.destination_name,
        preferences={
            "interests": (profile.get("experience") or []),
            "restrictions": (profile.get("restrictions") or []),
        },
        **_discovery_kwargs(_destination_anchor(trip, db)),
    )
    recommended: Dict[str, List[Dict[str, Any]]] = {}
    for _cat in ("must_visit", "activities", "food", "stays"):
        recommended[_cat] = [
            {"id": i.get("id") or i.get("place_id"), "provider_place_id": i.get("place_id"),
             "name": i.get("name", ""), "category": _cat,
             "description": i.get("description"), "address": i.get("address"),
             "latitude": i.get("latitude"), "longitude": i.get("longitude"),
             "distance_km": i.get("distance_km"), "rating": i.get("rating"),
             "review_count": i.get("review_count"), "source": i.get("source", "verified_api"),
             "verified": i.get("verified", True), "entry_fee": i.get("entry_fee"),
             "price_per_night": i.get("price_per_night"),
             "avg_cost_for_two": i.get("avg_cost_for_two"), "cuisine": i.get("cuisine"),
             "tier": i.get("tier"), "placement": i.get("placement"),
             "inside_destination": i.get("inside_destination", True)}
            for i in (discovery.get(_cat) or [])
        ]
    return {
        "destination": trip.destination_name,
        "destination_latitude": discovery.get("destination_latitude"),
        "destination_longitude": discovery.get("destination_longitude"),
        "destination_bounds": discovery.get("destination_bounds"),
        "destination_radius_km": discovery.get("destination_radius_km"),
        "discovery_source": discovery.get("source"),
        "map_places": {
            **recommended,
            # Broader real dataset: verified candidates beyond the ten cards +
            # any live map tiers (shopping/healthcare/…) — never fabricated.
            **{k: v for k, v in (discovery.get("map_candidates") or {}).items()},
            **{k: v for k, v in (discovery.get("map_places") or {}).items()},
        },
        "map_counts": {k: len(v) for k, v in recommended.items()},
        "map_counts_full": {
            **{k: len(v) for k, v in recommended.items()},
            **{k: len(v) for k, v in (discovery.get("map_candidates") or {}).items()},
            **{k: len(v) for k, v in (discovery.get("map_places") or {}).items()},
        },
        "catalog_meta": discovery.get("catalog_meta"),
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

    # Selections are HARD PREFERENCES: persist them so /choose-plan and any
    # regeneration reproduce the exact same three plans deterministically.
    profile = dict(profile or {})
    place_items = [dict(x) for x in (req.selected_place_items or [])]
    food_items = [dict(x) for x in (req.selected_food_items or [])]

    # ── SELECTION REPLAY (single source of truth) ────────────────────────────
    # Every place the traveller picked on the discovery screen is persisted in
    # trip_place_selections. When the planner is invoked WITHOUT explicit
    # selections (refresh / regenerate / deep link), replay the persisted REAL
    # picks so plans are deterministic and match what the user actually chose.
    explicit = bool(
        place_items or food_items or req.selected_places or req.selected_food
        or (req.selected_stay and req.selected_stay.get("name"))
        or req.stay_required is not None
    )
    if not explicit:
        replay = selections_for_plan(db, trip.id)
        if replay["places"] or replay["food"] or replay["stay"]:
            place_items = replay["places"]
            food_items = replay["food"]
            if replay["stay"]:
                s = replay["stay"]
                req.selected_stay = {
                    "id": s.get("id"), "name": s.get("name", ""),
                    "latitude": s.get("latitude"), "longitude": s.get("longitude"),
                    "distance_km": s.get("distance_km"),
                    "price_per_night": s.get("price_per_night"),
                    "rating": s.get("rating"),
                    "budget_category": s.get("budget_category") or s.get("tier"),
                }
                req.stay_required = True

    # Stay contract: "Continue without a stay" (stay_required=False) is an
    # ABSOLUTE rule — accommodation costs ₹0 and no hotel is ever auto-added,
    # even when the budget could afford one.
    req_stay_required = req.stay_required
    if req_stay_required is None and req.selected_stay:
        req_stay_required = True
    force_no_stay = req_stay_required is False

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

    # ── PERSIST selections to trip_place_selections (durable source of truth) ──
    # Defensive: the discovery UI usually posts them already; this guarantees the
    # table + the planner agree even when a caller lands here some other way.
    # Existing rows keep their original provenance — "recommendation" is only ever
    # the FALLBACK source for brand-new rows created right here.
    if explicit:
        user = _current_user(db, current)
        for it in place_items:
            upsert_selection(
                db, trip.id, user.id,
                {**it, "category": str(it.get("category") or "must_visit")},
                default_source="recommendation",
            )
        for it in food_items:
            upsert_selection(
                db, trip.id, user.id,
                {**it, "category": str(it.get("category") or "food")},
                default_source="recommendation",
            )
        if req.selected_stay and not force_no_stay:
            upsert_selection(
                db, trip.id, user.id,
                {
                    "id": req.selected_stay.get("id") or req.selected_stay.get("provider_place_id")
                          or req.selected_stay.get("name"),
                    "name": req.selected_stay.get("name", ""),
                    "category": "stays",
                    "latitude": req.selected_stay.get("latitude"),
                    "longitude": req.selected_stay.get("longitude"),
                    "distance_km": req.selected_stay.get("distance_km"),
                    "price_per_night": req.selected_stay.get("price_per_night"),
                    "rating": req.selected_stay.get("rating"),
                    "budget_category": req.selected_stay.get("budget_category"),
                },
                default_source="recommendation",
            )
        db.flush()

    # TRAVEL MODE persistence (single source of truth for pricing): Step-4 always
    # records the mode the traveller planned with so every later consumer
    # (choose-plan, itinerary edits, checkout pricing) prices the trip exactly as
    # presented — a GUIDE_MODE trip can never silently fall back to
    # ADVENTUROUS (guide fee ₹0) at checkout. GUIDE_MODE additionally flags the
    # trip for guide assignment so the 12.5% guide fee is collected.
    trip.mode = req.mode
    if req.mode == "GUIDE_MODE":
        trip.status = "REQUESTED"
        if not db.query(GuideAssignment).filter(GuideAssignment.trip_id == trip.id).first():
            db.add(GuideAssignment(trip_id=trip.id, status="REQUESTED"))

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
        mode=req.mode,
        verbose=False,
    )

    # Belt-and-braces: the plan engine already clamps, but the fee/total math
    # (12.5% guide in GUIDE_MODE + 3% platform over base spend) is the final
    # word on every returned total.
    for p in plans:
        normalize_plan_totals(p, bmax)

    # A single plan that still exceeds the traveller's selected maximum is an
    # unacceptable result. Reject it loudly instead of shipping an over-budget plan.
    # In GUIDE_MODE the 12.5% guide + 3% platform fees are charged ON TOP of the
    # travel spend, so the ceiling that must hold is the plan's base (travel) cost.
    for p in plans:
        bd = p.get("cost_breakdown") or {}
        comparable = float(bd.get("base_plan_cost") or p["final_total"]) if bd.get("guide_mode") else float(p["final_total"])
        if comparable > bmax + 0.01:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"The {p['type']} plan exceeds your selected budget ceiling "
                    f"(₹{round(comparable):,} > ₹{round(bmax):,}). "
                    "This destination/duration combination genuinely costs more than your maximum. "
                    "Raise your budget, shorten the trip, or choose a closer destination."
                ),
            )

    # Final itinerary validation: never trust the generator — re-verify totals.
    # For GUIDE_MODE the travel spend (not the fee-inclusive total) must fit the budget.
    for p in plans:
        bd = p.get("cost_breakdown") or {}
        check_total = float(bd.get("base_plan_cost") or p["final_total"]) if bd.get("guide_mode") else p["final_total"]
        check = validate_itinerary_budget(check_total, bmax)
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

    # Real schedule problems (overlaps / tight transfers) are surfaced during
    # LIVE editing (PATCH /itinerary), not on the clean Step-4 plan cards. The
    # plan cards only carry actionable budget warnings the traveller must see.
    # (Budget over-runs are already gated above with a loud 400/422.)

    # Persist the travel mode (+ GUIDE_MODE REQUESTED status/assignment) so
    # every later request — choose-plan, itinerary edits, checkout pricing —
    # prices this trip exactly as the traveller planned it.
    db.commit()

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
        mode=mode,
        verbose=False,
    )
    chosen = next((p for p in plans if p["type"] == req.plan_type), None)
    if not chosen:
        raise HTTPException(status_code=400, detail="Unknown plan type.")

    normalize_plan_totals(chosen, env["max"])

    itin = _persist_version(db, trip, chosen["days"], chosen["total_cost"], chosen["cost_breakdown"])
    if (trip.mode or "") == "GUIDE_MODE":
        # Guided trips stay flagged for guide assignment: the 12.5% guide fee is
        # part of the booking and checkout must price the trip as GUIDE_MODE.
        trip.status = "REQUESTED"
        if not db.query(GuideAssignment).filter(GuideAssignment.trip_id == trip.id).first():
            db.add(GuideAssignment(trip_id=trip.id, status="REQUESTED"))
    else:
        trip.status = "PLANNED"
    _log_change(
        db, trip, itin.version, "plan_selected",
        f"Selected the {req.plan_type.title()} plan",
    )
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

    # GUIDE-FEE REPRICING (single source of truth): an edit that changed the
    # guided-day count (add/remove day, move to a new day) changes what the
    # guide is paid. Recompute the fee from the authoritative rule — never
    # carry the old plan's frozen fee onto a new itinerary version.
    _assigned_guide = (trip.guide_assignment.guide
                       if trip.guide_assignment and trip.guide_assignment.status in ("ACCEPTED", "CONFIRMED")
                       else None)
    _party = profile.get("party") or (trip.profile.party_type if trip.profile else None)
    result["cost_breakdown"] = reprice_breakdown(
        result["cost_breakdown"],
        mode=trip.mode or "ADVENTUROUS_MODE",
        days=max(1, len(result["days"])),
        destination=trip.destination_name or "",
        party_type=_party,
        guide=_assigned_guide,
    )
    result["total_cost"] = float(result["cost_breakdown"]["final_total"])

    summary = _change_summary(change.model_dump(exclude_none=True), itin.days_data or [])
    new_itin = _persist_version(db, trip, result["days"], result["total_cost"], result["cost_breakdown"])

    # Plan versioning — every persisted edit is logged with its real summary.
    _log_change(db, trip, new_itin.version, "edit", summary)

    # Guide synchronization — the assigned guide sees every traveller change,
    # including the human-readable change summary (no JSON diff needed).
    _notify_guide(
        db, trip,
        f"Traveller updated the itinerary (v{new_itin.version}): {summary}. "
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


# ── 5. Step 5 planner: real-place search / optimize-a-day / plan versioning ──

@router.get("/{trip_id}/plan-changes", response_model=List[PlanChangeResponse])
def plan_changes(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Plan version history — every persisted planner version with its server-
    generated summary. Guides & managers read this to stay in sync with the
    traveller's latest plan without re-diffing itinerary JSON."""
    trip = _own_trip(trip_id, current, db)
    rows = db.query(PlanChangeLog).filter(PlanChangeLog.trip_id == trip.id).order_by(
        PlanChangeLog.version.asc()
    ).all()
    return [
        PlanChangeResponse(
            version=r.version, change_type=r.change_type,
            summary=r.summary, created_at=r.created_at,
        )
        for r in rows
    ]


@router.get("/{trip_id}/places/search", response_model=List[PlaceSearchItem])
def places_search(
    trip_id: str,
    q: str = "",
    current: dict = Depends(require_role("USER", "GUIDE")),
    db: Session = Depends(get_db),
):
    """REAL-place search for the Step 5 planner. Queries the destination-wide
    verified pool (curated catalog + live Google/OSM discovery) across
    must-visit attractions, activities, restaurants and stays — plus any other
    mapped category (shopping, healthcare, education, transport) that a real
    source provides. Never invents a place: results come only from verified
    providers, and anything already in the plan is excluded."""
    trip = _own_trip(trip_id, current, db)
    itin = db.query(Itinerary).filter(
        Itinerary.trip_id == trip.id, Itinerary.is_active == True
    ).first()
    dest = trip.destination_name

    pool: List[Dict[str, Any]] = []
    # --- Verified curated catalog (real stays/attractions/food) ---
    for a in VERIFIED_ATTRACTIONS.get(dest) or []:
        pool.append({
            "id": f"cat_{_norm(a.get('name', ''))[:40]}",
            "name": a.get("name", ""), "category": a.get("category", "attraction"),
            "description": a.get("description"), "address": None,
            "lat": a.get("lat") or 0, "lng": a.get("lng") or 0,
            "entry_fee": a.get("entry_fee") or 0,
            "duration_minutes": a.get("duration_minutes") or 90,
            "estimated_cost": a.get("entry_fee") or 0,
            "rating": a.get("rating"), "source": a.get("source", "verified_api"),
        })
    for f in VERIFIED_FOOD.get(dest) or []:
        pool.append({
            "id": f"catf_{_norm(f.get('name', ''))[:40]}",
            "name": f.get("name", ""), "category": "food",
            "description": f.get("description") or f.get("must_try"),
            "address": None,
            "lat": f.get("lat") or 0, "lng": f.get("lng") or 0,
            "entry_fee": 0,
            "duration_minutes": 75,
            "estimated_cost": (f.get("avg_cost_for_two") or 0) / 2,
            "rating": f.get("rating"), "source": f.get("source", "verified_api"),
        })
    for s in VERIFIED_STAYS.get(dest) or []:
        pool.append({
            "id": f"cats_{_norm(s.get('name', ''))[:40]}",
            "name": s.get("name", ""), "category": "stay",
            "description": str(s.get("tier") or "Verified stay"),
            "address": None,
            "lat": s.get("lat") or 0, "lng": s.get("lng") or 0,
            "entry_fee": 0,
            "duration_minutes": 1440,
            "estimated_cost": (s.get("price_per_night") or 0),
            "rating": s.get("rating"), "source": s.get("source", "verified_api"),
        })

    # --- Live destination-wide discovery buckets (real Google/OSM places) ---
    profile = trip.profile.questions_answers if trip.profile else {}
    discovery = discover_destination(
        dest,
        preferences={
            "interests": (profile.get("experience") or []),
            "restrictions": (profile.get("restrictions") or []),
        },
        **_discovery_kwargs(_destination_anchor(trip, db)),
    )
    for bucket, cat in (
        ("must_visit", "attraction"), ("activities", "activities"),
        ("food", "food"), ("stays", "stay"),
    ):
        for item in discovery.get(bucket) or []:
            d = item.get("description") or ""
            pool.append({
                "id": item.get("id"),
                "name": item.get("name", ""),
                "category": cat,
                "description": d or None,
                "address": item.get("address"),
                "lat": item.get("latitude") or 0, "lng": item.get("longitude") or 0,
                "entry_fee": item.get("entry_fee") or 0,
                "duration_minutes": item.get("duration_minutes") or 90,
                "estimated_cost": item.get("entry_fee") or 0,
                "rating": item.get("rating"), "source": item.get("source", "verified_api"),
            })

    # Dedup the pool by name + proximity so the same real place never appears
    # twice (catalog entry vs the same place re-discovered live).
    seen_names: set = set()
    deduped: List[Dict[str, Any]] = []
    for item in pool:
        key = _norm(item.get("name", ""))
        if not key or key in seen_names:
            continue
        dup_near = any(
            _haversine_km((float(item["lat"]) if item.get("lat") else 0.0,
                            float(item["lng"]) if item.get("lng") else 0.0),
                           (float(o["lat"]) if o.get("lat") else 0.0,
                            float(o["lng"]) if o.get("lng") else 0.0)) <= 0.25
            for o in deduped
        )
        if dup_near:
            continue
        seen_names.add(key)
        deduped.append(item)

    # Human-labelled query filter (token matching on name + category + desc).
    query = _norm(q or "")
    if query:
        tokens = {t for t in query.split() if len(t) >= 2}
        deduped = [
            it for it in deduped
            if tokens and tokens & set(
                _norm(f"{it.get('name', '')} {it.get('category', '')} {it.get('description') or ''}").split()
            )
        ]
    # Never offer a place the traveller already added.
    in_plan = {
        str(s.get("title") or s.get("name", "")).lower().strip()
        for d in (itin.days_data if itin else []) for s in (d.get("stops") or [])
    }
    deduped = [it for it in deduped if str(it.get("name", "")).lower().strip() not in in_plan]

    return [
        PlaceSearchItem(
            id=it.get("id"),
            name=it.get("name", ""),
            category=it.get("category", "attraction"),
            description=it.get("description"),
            address=it.get("address"),
            lat=float(it.get("lat", 0) or 0),
            lng=float(it.get("lng", 0) or 0),
            entry_fee=float(it.get("entry_fee", 0) or 0),
            duration_minutes=int(it.get("duration_minutes", 90) or 90),
            estimated_cost=float(it.get("estimated_cost", 0) or 0),
            rating=it.get("rating"),
            source=it.get("source", "verified_api"),
        )
        for it in deduped[:25]
    ]


# ── 5b. Nearby places (the ONLY 2 km-scoped operation) + one-place details ──
# Registered AFTER /places/search so the fixed path segments always win over
# the {provider_place_id} catch-all below.

@router.get("/{trip_id}/places/nearby")
def places_nearby(
    trip_id: str,
    name: str,
    lat: float,
    lng: float,
    current: dict = Depends(require_role("USER", "GUIDE")),
    db: Session = Depends(get_db),
):
    """'Places near this spot' — the ONLY 2 km-scoped operation. The backend
    enforces the hard 2 km cap at both the provider and the result layer, so a
    real place outside the cap is never returned as 'nearby'."""
    trip = _own_trip(trip_id, current, db)
    return discover_nearby(trip.destination_name, name, (lat, lng))


@router.get("/{trip_id}/places/{provider_place_id}", response_model=PlaceDetailsResponse)
def place_details(
    trip_id: str,
    provider_place_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Details for ONE real place (marker click) — resolved from the verified
    discovery+map pool by provider_place_id (or internal id). Also reports the
    selection status so the UI can show Add/Remove correctly."""
    trip = _own_trip(trip_id, current, db)
    profile = trip.profile.questions_answers if trip.profile else {}
    discovery = discover_destination(
        trip.destination_name,
        preferences={
            "interests": (profile.get("experience") or []),
            "restrictions": (profile.get("restrictions") or []),
        },
        **_discovery_kwargs(_destination_anchor(trip, db)),
    )
    pool: List[Dict[str, Any]] = []
    for cat in ("must_visit", "activities", "food", "stays"):
        for i in (discovery.get(cat) or []):
            pool.append((cat, i))
    for cat, items in (discovery.get("map_places") or {}).items():
        for i in items:
            pool.append((cat, i))
    for cat, i in pool:
        if str(i.get("place_id") or "") == provider_place_id or str(i.get("id") or "") == provider_place_id:
            selection_status = "none"
            key = str(i.get("place_id") or i.get("id") or "")
            if key:
                active = active_selections(db, trip.id)
                row = next((r for r in active if r.provider_place_id == key), None)
                selection_status = "active" if row else "none"
            return PlaceDetailsResponse(
                provider_place_id=str(i.get("place_id") or provider_place_id),
                id=str(i.get("id") or ""),
                name=str(i.get("name", "")),
                category=cat,
                description=i.get("description"),
                address=i.get("address"),
                latitude=i.get("latitude"),
                longitude=i.get("longitude"),
                distance_km=i.get("distance_km"),
                rating=i.get("rating"),
                review_count=i.get("review_count"),
                source=str(i.get("source") or "verified_api"),
                verified=bool(i.get("verified", True)),
                inside_destination=bool(i.get("inside_destination", True)),
                selection_status=selection_status,
                extra={
                    "entry_fee": i.get("entry_fee"),
                    "duration_minutes": i.get("duration_minutes"),
                    "cuisine": i.get("cuisine"),
                    "price_per_night": i.get("price_per_night"),
                    "tier": i.get("tier"),
                    "opening_hours": i.get("opening_hours"),
                    "website": i.get("website"),
                },
            )
    raise HTTPException(status_code=404, detail="Place not found in the verified destination pool.")


@router.post("/{trip_id}/optimize-day", response_model=OptimizeDayResponse)
def optimize_day(
    trip_id: str,
    req: OptimizeDayRequest,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db),
):
    """'Optimize My Day': nearest-neighbour routing within one day so the stops
    follow a real geographic line (less backtracking). `apply=false` returns the
    PROPOSED ordering for the user to preview; `apply=true` persists it as a new
    itinerary version (with guide sync + plan-change log)."""
    trip = _own_trip(trip_id, current, db)
    itin = db.query(Itinerary).filter(
        Itinerary.trip_id == trip.id, Itinerary.is_active == True
    ).first()
    if not itin:
        raise HTTPException(status_code=404, detail="No active itinerary to optimize. Generate a plan first.")

    days = [dict(d) for d in (itin.days_data or [])]
    for d in days:
        d["stops"] = list(d.get("stops") or [])
    target = next((d for d in days if d.get("day") == req.day), None)
    warnings: List[str] = []
    if not target or len(target.get("stops") or []) < 2:
        warnings.append(
            f"Day {req.day} has fewer than two places — there's nothing to re-route."
        )
        return OptimizeDayResponse(
            day=req.day, version=None, applied=False, days=[dict(d) for d in days],
            total_cost=itin.total_cost or 0,
            cost_breakdown=effective_breakdown(itin),
            warnings=warnings,
        )

    stops = list(target["stops"])
    anchor = stops[0]
    remaining = stops[1:]
    ordered = [anchor]
    while remaining:
        last = ordered[-1]
        last_pt = ((float(last.get("lat") or 0)), (float(last.get("lng") or 0)))
        best_idx, best_dist = 0, float("inf")
        for i, cand in enumerate(remaining):
            cand_pt = ((float(cand.get("lat") or 0)), (float(cand.get("lng") or 0)))
            dist = _haversine_km(last_pt, cand_pt)
            if dist < best_dist:
                best_idx, best_dist = i, dist
        ordered.append(remaining.pop(best_idx))
    target["stops"] = ordered
    _resequence(days)

    if not req.apply:
        return OptimizeDayResponse(
            day=req.day, version=None, applied=False, days=[dict(d) for d in days],
            total_cost=itin.total_cost or 0,
            cost_breakdown=effective_breakdown(itin),
            warnings=warnings,
        )

    new_itin = _persist_version(db, trip, days, itin.total_cost, itin.cost_breakdown or {})
    _log_change(
        db, trip, new_itin.version, "optimized_day",
        f"Optimized Day {req.day} routing ({len(ordered)} places, nearest-neighbour order)",
    )
    _notify_guide(
        db, trip,
        f"Traveller optimized Day {req.day} routing (v{new_itin.version}). "
        f"Please review the latest plan."
    )
    db.commit()
    db.refresh(new_itin)
    return OptimizeDayResponse(
        day=req.day, version=new_itin.version, applied=True,
        days=new_itin.days_data or [], total_cost=new_itin.total_cost or 0,
        cost_breakdown=effective_breakdown(new_itin),
        warnings=warnings,
    )


@router.post("/{trip_id}/confirm", response_model=ConfirmPlanResponse)
def confirm_plan(
    trip_id: str,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db),
):
    """FINAL backend validation of the Step 5 plan before payment.

    Every check is deterministic and real-data based:
      1. A plan exists (an active itinerary was chosen + edited).
      2. It is not empty and every stop has a title.
      3. Every stop has real coordinates (nothing invented/zeroed).
      4. Total cost (incl. 3% platform fee) is within the traveller's budget.
      5. The schedule has no overlaps/tight conflicts (server validator).
    `valid=false` returns the exact missing items so the planner UI can show
    clear remedies; checkout is allowed only after a valid=TRUE confirm."""
    trip = _own_trip(trip_id, current, db)
    itin = db.query(Itinerary).filter(
        Itinerary.trip_id == trip.id, Itinerary.is_active == True
    ).first()
    if not itin:
        return ConfirmPlanResponse(
            valid=False, version=0, total_cost=0, budget_max=None,
            within_budget=False,
            message="No plan to confirm yet — choose a plan and edit it first.",
            missing=["No active itinerary exists."],
        )

    profile = trip.profile.questions_answers if trip.profile else {}
    env = _budget_envelope(profile, trip.budget)
    bmax = env["max"]
    days = itin.days_data or []
    stops = [s for d in days for s in (d.get("stops") or [])]

    missing: List[str] = []
    if not stops:
        missing.append("The itinerary is empty — add at least one activity or attraction.")
    else:
        for s in stops:
            title = str(s.get("title") or s.get("name") or "").strip()
            if not title:
                missing.append("A stop is missing its name.")
                break
            lat, lng = s.get("lat"), s.get("lng")
            if not lat or not lng:
                missing.append(f"“{title}” has no real coordinates — remove or replace it.")
                break

    check = validate_itinerary(
        itin.cost_breakdown or {},
        budget_max=env["max"],
        cost_breakdown=itin.cost_breakdown or {},
        days=days,
    )
    within_budget = bool(check["valid"])
    if not within_budget:
        missing.insert(0, check["warnings"][0] if check["warnings"] else
                       "Total cost exceeds the budget.")

    valid = bool(not missing)
    version = itin.version or 0
    total_cost = float(itin.total_cost or 0)
    bd = itin.cost_breakdown or {}
    if valid:
        if bd.get("guide_mode"):
            spend = float(bd.get("base_plan_cost") or bd.get("travel_spend") or 0)
            message = (
                f"Your plan (v{version}) is validated and ready for payment. "
                f"Travel cost ₹{round(spend):,} fits your ₹{round(bmax):,} travel budget; "
                f"the 12.5% guide fee and 3% platform fee are added on top at checkout "
                f"(total ₹{round(total_cost):,})."
            )
        else:
            message = (
                f"Your plan (v{version}) is validated and ready for payment at "
                f"₹{round(total_cost):,} — within your ₹{round(bmax):,} budget."
            )
    else:
        message = "Your plan still needs final edits before payment."
    return ConfirmPlanResponse(
        valid=valid, message=message, version=version,
        total_cost=total_cost, budget_max=bmax, within_budget=within_budget,
        missing=missing,
    )
