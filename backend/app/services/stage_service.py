"""10-stage prompt-routed workflow: persistent trip state + budget gate.

Every stage reads from and updates the SAME trip record. The LLM proposes
options (transport / places / local legs / itinerary narrative); THIS module
(plus the stages router) performs every authoritative calculation — the model
is never trusted with financial math.

Fee contract (settled; identical to pricing_service / spec S23-26):
    B = base trip cost = transport + stay + food + activities + local
    G = 12.5% x B in GUIDE_MODE, else 0
    P = 3% x B,  R = 15% x B (protected reserve),  I = Rs.50 insurance
    Final planned amount = B + G + P + R + I

Budget envelope: trips.budget (incl. top-ups) caps B (travel spend); fees and
the reserve stack ON TOP. The gate blocks Continue while B > budget_max; the
reserve is displayed separately as protected, never as spendable money.

Stage completion is DERIVED from saved data (never from the pointer alone);
trips.current_stage is only the furthest-reached pointer for resume.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.entities import (
    BudgetAdjustment,
    Guide,
    GuideAssignment,
    Itinerary,
    Payment,
    Trip,
    TripPlaceSelection,
    TripProfile,
    get_utc_now,
)
from app.services.pricing_service import (
    GUIDE_FEE_RATE,
    INSURANCE_FEE,
    PLATFORM_FEE_RATE,
    SAFETY_RESERVE_RATE,
)

# ── Stage catalogue ───────────────────────────────────────────────────────────
STAGES: List[Dict[str, Any]] = [
    {"index": 1, "key": "details", "label": "Trip"},
    {"index": 2, "key": "preferences", "label": "Travellers"},
    {"index": 3, "key": "transport", "label": "Transport"},
    {"index": 4, "key": "places", "label": "Explore"},
    {"index": 5, "key": "stay", "label": "Stay"},
    {"index": 6, "key": "mode", "label": "Mode"},
    {"index": 7, "key": "local_transport", "label": "Local"},
    {"index": 8, "key": "budget_food", "label": "Budget"},
    {"index": 9, "key": "itinerary", "label": "Itinerary"},
    {"index": 10, "key": "review", "label": "Review"},
    {"index": 11, "key": "payment", "label": "Payment"},
]
STAGE_BY_INDEX = {s["index"]: s for s in STAGES}
STAGE_BY_KEY = {s["key"]: s for s in STAGES}

# Food tiers: per-person per-day DINING ALLOWANCE. Tiers change ONLY food.
FOOD_TIERS: Dict[str, Dict[str, Any]] = {
    "BASIC": {"rate_per_person_per_day": 500.0, "label": "Basic"},
    "STANDARD": {"rate_per_person_per_day": 800.0, "label": "Standard"},
    "PREMIUM": {"rate_per_person_per_day": 1200.0, "label": "Premium"},
}

# Categories the traveller may SELECT at stage 4. Healthcare + education are
# view-only recommendations (spec S4) and stay is exactly-one (spec S5).
SELECTABLE_CATEGORIES = {
    "must_visit", "activities", "activity", "restaurants", "restaurant",
    "cafes", "cafe", "food", "attraction", "attractions", "tourist_spots",
    "tourist_spot", "stays", "stay", "hotel", "shopping", "other",
}
VIEW_ONLY_CATEGORIES = {"healthcare", "education"}
STAY_CATEGORIES = {"stays", "stay", "hotel"}


# ── Small helpers ─────────────────────────────────────────────────────────────
def _party(trip: Trip) -> Dict[str, int]:
    profile = trip.profile
    answers = dict(profile.questions_answers or {}) if profile else {}
    party = answers.get("party") if isinstance(answers.get("party"), dict) else {}
    total = int(party.get("total") or answers.get("total_travellers") or 0)
    adults = int(party.get("adults") or answers.get("adults") or 0)
    children = int(party.get("children") or answers.get("children") or 0)
    if total <= 0:
        total = max(adults + children, 1)
    if adults <= 0 and total > 0:
        adults = max(total - children, 1)
    return {"total": total, "adults": adults, "children": children}


def _days_nights(trip: Trip) -> Dict[str, int]:
    try:
        days = max(1, (trip.end_datetime.date() - trip.start_datetime.date()).days + 1)
    except Exception:
        days = 1
    return {"days": days, "nights": max(days - 1, 1)}


def _active_selections(db: Session, trip_id: str) -> List[TripPlaceSelection]:
    return (
        db.query(TripPlaceSelection)
        .filter(
            TripPlaceSelection.trip_id == trip_id,
            TripPlaceSelection.status == "active",
        )
        .all()
    )


def _stay_cost_from_ledger(rows: List[TripPlaceSelection], nights: int, travellers: int) -> float:
    """Whole-party stay cost for the full duration.

    Rooms = ceil(travellers / 2) (children share; documented rule). A ledger
    row price is the PER-ROOM PER-NIGHT rate, so total = rate x rooms x nights.
    """
    import math

    rooms = max(1, math.ceil(max(travellers, 1) / 2))
    total = 0.0
    for r in rows:
        if str(r.category or "").lower() in STAY_CATEGORIES:
            per_night = float(r.price or 0.0)
            item = r.item_json or {}
            try:
                rooms_for_row = int(item.get("rooms_needed") or rooms)
            except (TypeError, ValueError):
                rooms_for_row = rooms
            try:
                nights_for_row = int(item.get("nights") or nights)
            except (TypeError, ValueError):
                nights_for_row = nights
            total += per_night * max(rooms_for_row, 1) * max(nights_for_row, 1)
    return round(total, 2)


def _activities_cost_from_ledger(rows: List[TripPlaceSelection]) -> float:
    total = 0.0
    for r in rows:
        cat = str(r.category or "").lower()
        if cat in STAY_CATEGORIES:
            continue
        if cat in ("restaurants", "cafes", "food"):
            continue  # food is priced by tier allowance at stage 7, never at selection
        total += float(r.price or 0.0)
    return round(total, 2)


def _transport_cost(trip: Trip) -> Dict[str, float]:
    sel = dict(trip.selected_transport or {})
    out = sel.get("outbound") or {}
    ret = sel.get("return") or {}
    outbound = round(float(out.get("party_total") or 0.0), 2)
    ret_cost = round(float(ret.get("party_total") or 0.0), 2)
    return {"outbound": outbound, "return": ret_cost, "total": round(outbound + ret_cost, 2)}


def _local_transport_cost(trip: Trip) -> float:
    total = 0.0
    for leg in (dict(trip.local_transport or {}).get("legs") or []):
        opts = {o.get("id"): o for o in (leg.get("options") or []) if o.get("id")}
        chosen = opts.get(leg.get("selected_id")) if leg.get("selected_id") else None
        if chosen is None and leg.get("options"):
            chosen = leg["options"][0]
        if chosen:
            total += float(chosen.get("party_total") or 0.0)
    return round(total, 2)


def _food_allowance(trip: Trip) -> Dict[str, Any]:
    tier = str(trip.food_tier or "STANDARD").upper()
    if tier not in FOOD_TIERS:
        tier = "STANDARD"
    party = _party(trip)
    dn = _days_nights(trip)
    rate = float(FOOD_TIERS[tier]["rate_per_person_per_day"])
    allowance = round(rate * max(party["total"], 1) * dn["days"], 2)
    return {
        "tier": tier,
        "label": FOOD_TIERS[tier]["label"],
        "rate_per_person_per_day": rate,
        "travellers": party["total"],
        "days": dn["days"],
        "allowance": allowance,
    }


# ── Budget gate ───────────────────────────────────────────────────────────────
def evaluate_budget_gate(db: Session, trip: Trip) -> Dict[str, Any]:
    """Authoritative per-stage budget math. Deterministic; no LLM involved."""
    party = _party(trip)
    dn = _days_nights(trip)
    rows = _active_selections(db, trip.id)
    transport = _transport_cost(trip)
    stay = _stay_cost_from_ledger(rows, dn["nights"], party["total"])
    food_info = _food_allowance(trip)
    activities = _activities_cost_from_ledger(rows)
    local = _local_transport_cost(trip)

    base_total = round(transport["total"] + stay + food_info["allowance"] + activities + local, 2)
    guide_mode = (trip.mode or "") == "GUIDE_MODE"
    guide_fee = round(base_total * GUIDE_FEE_RATE, 0) if guide_mode else 0.0
    platform_fee = round(base_total * PLATFORM_FEE_RATE, 0)
    safety_reserve = round(base_total * SAFETY_RESERVE_RATE, 0)
    insurance_fee = float(INSURANCE_FEE)
    final_amount = round(base_total + guide_fee + platform_fee + safety_reserve + insurance_fee, 0)

    budget_max = round(float(trip.budget or 0.0), 2)
    if budget_max <= 0:
        budget_max = round(max(base_total * 1.25, 30000.0), 2)
        trip.budget = budget_max
    remaining = round(budget_max - base_total, 2)

    violations: List[str] = []
    if base_total - budget_max > 0.01:
        violations.append(
            f"Planned travel spend Rs.{base_total:,.0f} exceeds the budget of "
            f"Rs.{budget_max:,.0f} by Rs.{base_total - budget_max:,.0f}. "
            "Remove a selection or add a top-up to continue."
        )
    if transport["total"] - budget_max > 0.01:
        violations.append(
            f"Round-trip transport alone (Rs.{transport['total']:,.0f}) exceeds the "
            f"whole budget (Rs.{budget_max:,.0f}). Choose cheaper options or top up."
        )

    adjustments = (
        db.query(BudgetAdjustment)
        .filter(BudgetAdjustment.trip_id == trip.id)
        .order_by(BudgetAdjustment.created_at.desc(), BudgetAdjustment.id.desc())
        .all()
    )

    notes = [
        "Flight / train / bus fares are per-person x %d traveller(s)." % max(party["total"], 1),
        "Stay is priced per-room per-night x %d room(s) x %d night(s) for the whole party."
        % (max(1, -(-max(party["total"], 1) // 2)), dn["nights"]),
        "Food is a per-person daily allowance (no restaurant prices at selection).",
        "Private-cab legs are priced per vehicle (vehicles = ceil(party / 4)), never per-person.",
        "Guide fee 12.5% applies in Guide Mode only; platform 3% always; "
        "the 15% safety reserve is protected money set aside, not spendable.",
    ]
    return {
        "trip_id": trip.id,
        "currency": "INR",
        "budget_max": budget_max,
        "travellers": party["total"],
        "days": dn["days"],
        "nights": dn["nights"],
        "spend": {
            "transport": transport["total"],
            "transport_outbound": transport["outbound"],
            "transport_return": transport["return"],
            "stay": stay,
            "food": food_info["allowance"],
            "activities": activities,
            "local_transport": local,
            "base_total": base_total,
        },
        "fees": {
            "guide": guide_fee,
            "guide_rate": GUIDE_FEE_RATE if guide_mode else 0.0,
            "platform": platform_fee,
            "platform_rate": PLATFORM_FEE_RATE,
            "safety_reserve": safety_reserve,
            "safety_reserve_rate": SAFETY_RESERVE_RATE,
            "safety_reserve_protected": True,
            "insurance": insurance_fee,
        },
        "final_amount": final_amount,
        "remaining_budget": remaining,
        "can_continue": not violations,
        "violations": violations,
        "food_tier": food_info["tier"],
        "food_allowance": food_info,
        "pricing_unit_notes": notes,
        "adjustments": [
            {
                "id": a.id,
                "previous_budget": float(a.previous_budget or 0.0),
                "adjustment_amount": float(a.adjustment_amount or 0.0),
                "updated_budget": float(a.updated_budget or 0.0),
                "stage": a.stage or "",
                "reason": a.reason,
                "created_at": a.created_at,
            }
            for a in adjustments
        ],
    }


# ── Cumulative LLM context (every stage prompt gets everything) ────────────────
def cumulative_context(db: Session, trip: Trip) -> Dict[str, Any]:
    """ONE builder for every prompt-routed LLM call. Each stage's prompt
    receives the TOTAL saved data up to that point — never a fresh session:

    steps 1-2 (trip + preferences) → step 3 (transport) → step 4 (places,
    now including the step-3 selection) → step 5 (mode) → step 6 (local legs,
    now including places + stay + transport) → step 7 (food) → step 8
    (itinerary synthesis over everything).

    Flat keys match what the prompt builders read; unknown keys are ignored.
    Money here is context for feasibility ONLY — the backend computes every
    authoritative price, fee and total (the model is never trusted with math).
    """
    profile = trip.profile
    answers = dict(profile.questions_answers or {}) if profile else {}
    party = _party(trip)
    dn = _days_nights(trip)
    rows = _active_selections(db, trip.id)
    transport = _transport_cost(trip)
    food_info = _food_allowance(trip)
    gate = evaluate_budget_gate(db, trip)

    sel = dict(trip.selected_transport or {})
    places = [
        {"name": r.name, "category": r.category, "price": float(r.price or 0.0),
         "lat": r.latitude, "lng": r.longitude}
        for r in rows
        if str(r.category or "").lower() in SELECTABLE_CATEGORIES
    ]
    stay_row = next(
        (r for r in rows if str(r.category or "").lower() in STAY_CATEGORIES), None)
    legs = list((dict(trip.local_transport or {}).get("legs") or []))
    chosen_legs = []
    for leg in legs:
        opts = {o.get("id"): o for o in (leg.get("options") or []) if o.get("id")}
        chosen = opts.get(leg.get("selected_id")) if leg.get("selected_id") else None
        chosen_legs.append({
            "from": leg.get("origin"), "to": leg.get("destination"),
            "distance_km": leg.get("distance_km"), "duration_min": leg.get("duration_min"),
            "choice": (chosen or {}).get("label"), "party_total": (chosen or {}).get("party_total"),
        })

    return {
        # Step 1 — trip details
        "source_name": trip.source_name,
        "destination_name": trip.destination_name,
        "start_datetime": trip.start_datetime.isoformat() if trip.start_datetime else "",
        "end_datetime": trip.end_datetime.isoformat() if trip.end_datetime else "",
        "duration_days": dn["days"],
        "nights": dn["nights"],
        # Step 2 — preferences
        "total_travellers": party["total"],
        "adults": party["adults"],
        "children": party["children"],
        "group_type": answers.get("travelling_type") or answers.get("party_type")
                      or (profile.party_type if profile else "Solo"),
        "interests": answers.get("experience") or (profile.experience_type if profile else ""),
        "budget": float(trip.budget or 0.0),
        # Step 3 — selected round-trip transport (None until chosen)
        "selected_transport": {
            "outbound": sel.get("outbound"), "return": sel.get("return"),
        },
        "transport_total": transport["total"],
        "remaining_budget_after_transport": round(
            float(trip.budget or 0.0) - transport["total"], 2),
        # Step 4 — selected places + the single stay
        "selected_places": [p["name"] for p in places],
        "selected_place_items": places,
        "selected_stay": (
            {"name": stay_row.name, "price_per_night": float(stay_row.price or 0.0),
             "lat": stay_row.latitude, "lng": stay_row.longitude}
            if stay_row else None
        ),
        # Step 5 — mode
        "mode": trip.mode,
        # Step 6 — local legs + choices
        "itinerary_legs": chosen_legs,
        # Step 7 — food tier + allowance
        "food_tier": str(trip.food_tier or "STANDARD"),
        # Budget truth (context only — backend math is authoritative)
        "base_total_so_far": gate["spend"]["base_total"],
        "remaining_budget": gate["remaining_budget"],
        "final_planned_amount": gate["final_amount"],
    }


# ── Stage completion (derived) ────────────────────────────────────────────────
def stage_completion(db: Session, trip: Trip) -> Dict[str, Any]:
    """Which stages are complete, derived from SAVED data only."""
    profile = trip.profile
    answers = dict(profile.questions_answers or {}) if profile else {}
    party = _party(trip)
    rows = _active_selections(db, trip.id)

    s1 = bool(
        trip.source_name and trip.destination_name and trip.start_datetime and trip.end_datetime
        and trip.end_datetime > trip.start_datetime
        and trip.source_location_id != trip.destination_location_id
        and str(trip.source_name or "").strip().lower() != str(trip.destination_name or "").strip().lower()
    )

    budget_val = answers.get("budget")
    if isinstance(budget_val, dict):
        budget_num = float(budget_val.get("max") or budget_val.get("min") or 0)
    else:
        try:
            budget_num = float(budget_val or trip.budget or 0)
        except (TypeError, ValueError):
            budget_num = 0.0
    experience = answers.get("experience") or (profile.experience_type if profile else "")
    travelling_type = answers.get("travelling_type") or answers.get("party_type") or (profile.party_type if profile else "")
    party_ok = party["total"] > 0 and party["adults"] > 0 and party["adults"] + party["children"] in (party["total"],) \
        or (party["total"] > 0 and party["adults"] > 0 and party["children"] >= 0
            and party["adults"] + party["children"] <= party["total"])
    s2 = bool(budget_num > 0 and travelling_type and experience and party_ok)

    sel = dict(trip.selected_transport or {})
    s3 = bool((sel.get("outbound") or {}).get("id") and (sel.get("return") or {}).get("id"))

    cats = [str(r.category or "").lower() for r in rows]
    stay_rows = [r for r in rows if str(r.category or "").lower() in STAY_CATEGORIES]
    place_rows = [r for r in rows if str(r.category or "").lower() in SELECTABLE_CATEGORIES and str(r.category or "").lower() not in STAY_CATEGORIES]
    s4 = bool(place_rows or len(rows) > 0)

    s5 = bool(len(stay_rows) == 1)

    s6 = (trip.mode or "") in ("GUIDE_MODE", "ADVENTUROUS_MODE")

    legs = list((dict(trip.local_transport or {}).get("legs") or []))
    if legs:
        s7 = all(bool(leg.get("selected_id")) for leg in legs)
    else:
        s7 = False

    gate = evaluate_budget_gate(db, trip)
    s8 = bool((trip.food_tier or "STANDARD") in FOOD_TIERS)

    itin = (
        db.query(Itinerary)
        .filter(Itinerary.trip_id == trip.id, Itinerary.is_active == True)  # noqa: E712
        .first()
    )
    s9 = bool(itin and (itin.days_data or []))
    s10 = bool(s9 and gate["can_continue"])
    payment = db.query(Payment).filter(Payment.trip_id == trip.id).first()
    s11 = bool(payment and payment.status == "SUCCESS" and (trip.status or "") == "ACTIVE")

    return {
        "1": s1, "2": s2, "3": s3, "4": s4, "5": s5,
        "6": s6, "7": s7, "8": s8, "9": s9, "10": s10, "11": s11,
        "_counts": {c: cats.count(c) for c in set(cats)},
        "_stay_count": len(stay_rows),
        "_itinerary_id": itin.id if itin else None,
        "_payment_status": payment.status if payment else "NONE",
    }


def _auto_seed_places_if_empty(db: Session, trip: Trip) -> None:
    """If a traveller reaches stage 5 with no place selections in the ledger,
    seed default verified attractions for the destination so they are never blocked."""
    existing = _active_selections(db, trip.id)
    if existing:
        return
    from app.services.verified_data import VERIFIED_ATTRACTIONS
    from app.services.stage_transport import _norm_city
    dest = _norm_city(trip.destination_name or "")
    candidates = VERIFIED_ATTRACTIONS.get(dest) or []
    if not candidates:
        for k, v in VERIFIED_ATTRACTIONS.items():
            if dest and (dest in k.lower() or k.lower() in dest):
                candidates = v
                break
    from app.services.place_selections import upsert_selection
    user_id = str(trip.user_id or "system")
    for item in candidates[:3]:
        item_copy = dict(item)
        item_copy["category"] = "must_visit"
        item_copy["provider_place_id"] = str(item.get("id") or f"seed:{item.get('name')}")
        item_copy["price"] = float(item.get("entry_fee") or 0.0)
        item_copy["selection_source"] = "auto_seed"
        if item.get("lat") is not None:
            item_copy["latitude"] = float(item["lat"])
        if item.get("lng") is not None:
            item_copy["longitude"] = float(item["lng"])
        upsert_selection(db, trip.id, user_id, item_copy)
    try:
        db.commit()
    except Exception:
        db.rollback()


def _blockers_for(db: Session, trip: Trip, completion: Dict[str, Any], target: int) -> List[str]:
    blockers: List[str] = []
    party = _party(trip)
    if target >= 2 and not completion["1"]:
        blockers.append("Invalid route: departure place and destination cannot be the same location.")
    if target >= 3 and not completion["2"]:
        blockers.append("Finish Travellers (stage 2): budget, travelling type, party counts and experience are all required.")
    if target >= 4 and not completion["3"]:
        blockers.append("Select one outbound AND one return transport option (stage 3) before choosing places.")
    if target >= 5 and not completion["4"]:
        _auto_seed_places_if_empty(db, trip)
        completion = stage_completion(db, trip)
        if not completion["4"]:
            blockers.append("Select at least one place (stage 4) before continuing.")
    if target >= 6 and not completion["5"]:
        if completion["_stay_count"] == 0:
            # Auto-seed the recommended stay for party and budget so the user is never stranded
            try:
                dest = trip.destination_name or "Destination"
                recs = stay_service.fetch_destination_stays(dest, party.get("total", 1), 1, float(trip.budget or 50000.0))
                if recs:
                    best = next((s for s in recs if s.get("is_recommended")), recs[0])
                    stay_service.select_trip_stay(db, trip, best)
                    completion = stage_completion(db, trip)
            except Exception as exc:
                logger.warning(f"Auto-seed stay fallback error: {exc}")

        if completion["_stay_count"] > 1:
            # Keep newest primary stay, soft-remove duplicates
            try:
                stay_rows = [r for r in _active_selections(db, trip.id) if str(r.category or "").lower() in STAY_CATEGORIES]
                if len(stay_rows) > 1:
                    for extra in stay_rows[1:]:
                        extra.status = "removed"
                    db.commit()
                    completion = stage_completion(db, trip)
            except Exception as exc:
                logger.warning(f"Stay deduplication error: {exc}")

        if not completion["5"]:
            blockers.append("Choose your accommodation (stage 5) before continuing.")
    if target >= 7 and not completion["6"]:
        blockers.append("Choose Guide Mode or Adventurous Mode (stage 6) before local transport.")
    if target >= 8 and not completion["7"]:
        blockers.append("Plan local transport legs and pick an option for every leg (stage 7).")
    if target >= 10 and not completion["9"]:
        blockers.append("Generate the day-by-day itinerary (stage 9) before review.")
    if target >= 11 and not completion["10"]:
        blockers.append("The budget gate must pass on the final review (stage 10) before payment.")
    if target in (10, 11):
        gate = evaluate_budget_gate(db, trip)
        if not gate["can_continue"]:
            blockers.extend(gate["violations"])
    if target == 3 and party["total"] <= 0:
        blockers.append("Party size is missing — complete stage 2 first.")
    return blockers


# ── Stage state + transitions ─────────────────────────────────────────────────
def build_stage_state(db: Session, trip: Trip) -> Dict[str, Any]:
    completion = stage_completion(db, trip)
    gate = evaluate_budget_gate(db, trip)
    profile = trip.profile
    answers = dict(profile.questions_answers or {}) if profile else {}
    rows = _active_selections(db, trip.id)
    legs = list((dict(trip.local_transport or {}).get("legs") or []))
    stay_row = next((r for r in rows if str(r.category or "").lower() in STAY_CATEGORIES), None)
    payment = db.query(Payment).filter(Payment.trip_id == trip.id).first()
    dn = _days_nights(trip)

    guide_available = False
    assigned = None
    ga = trip.guide_assignment
    if ga and ga.status in ("ACCEPTED", "CONFIRMED") and ga.guide_id:
        guide_available = True
        g = ga.guide
        assigned = {"name": f"{g.first_name} {g.last_name}".strip(), "phone": g.phone} if g else {"assigned": True}
    else:
        try:
            dest = (trip.destination_name or "").strip()
            q = db.query(Guide).filter(Guide.status == "ACTIVE")
            if dest:
                q = q.filter(Guide.preferred_destinations.ilike(f"%{dest}%"))
            guide_available = db.query(q.exists()).scalar() or False
        except Exception:
            guide_available = False

    pointer = int(trip.current_stage or 1)
    pointer = min(max(pointer, 1), 11)
    stages = []
    for s in STAGES:
        idx = s["index"]
        stages.append({
            "index": idx,
            "key": s["key"],
            "label": s["label"],
            "complete": bool(completion.get(str(idx))),
            "locked": idx > pointer + 1,
        })

    transport_sel = dict(trip.selected_transport or {})
    return {
        "trip_id": trip.id,
        "current_stage": pointer,
        "stage_key": STAGE_BY_INDEX[pointer]["key"],
        "stages": stages,
        "trip": {
            "id": trip.id,
            "source_name": trip.source_name,
            "destination_name": trip.destination_name,
            "start_datetime": trip.start_datetime,
            "end_datetime": trip.end_datetime,
            "days": dn["days"],
            "nights": dn["nights"],
            "status": trip.status,
            "budget": float(trip.budget or 0.0),
        },
        "preferences": answers,
        "transport": {
            "options": dict(trip.transport_options or {}),
            "selected": {
                "outbound": transport_sel.get("outbound"),
                "return": transport_sel.get("return"),
            },
        },
        "places": {
            "counts": completion["_counts"],
            "stay": (
                {"id": stay_row.id, "name": stay_row.name, "price": float(stay_row.price or 0.0),
                 "lat": stay_row.latitude, "lng": stay_row.longitude}
                if stay_row else None
            ),
            "items": [
                {"id": r.id, "name": r.name, "category": r.category,
                 "price": float(r.price or 0.0), "lat": r.latitude, "lng": r.longitude}
                for r in rows
            ],
        },
        "mode": trip.mode,
        "local_transport": {"legs": legs},
        "food_tier": str(trip.food_tier or "STANDARD"),
        "budget": gate,
        "itinerary": {
            "exists": bool(completion["9"]),
            "version": None,
            "active": bool(completion["9"]),
            "itinerary_id": completion["_itinerary_id"],
        },
        "payment": {
            "status": completion["_payment_status"],
            "amount": float(payment.total_amount or 0.0) if payment else 0.0,
        },
        "guide": {
            "required": (trip.mode or "") == "GUIDE_MODE",
            "available": guide_available,
            "assigned": assigned,
        },
    }


def advance_stage(db: Session, trip: Trip, target: int, actor: str = "") -> Dict[str, Any]:
    """Move the resume pointer. Forward moves validate prerequisites + gate;
    backward moves are always allowed (selections are never wiped)."""
    try:
        target = int(target)
    except (TypeError, ValueError):
        raise ValueError("Stage must be a number between 1 and 11.")
    if target < 1 or target > 11:
        raise ValueError("Stage must be a number between 1 and 11.")
    pointer = int(trip.current_stage or 1)
    # Validate on any non-backward move: re-affirming the current stage is
    # what the client's Continue button does, so the gate must hold there too.
    if target >= pointer:
        completion = stage_completion(db, trip)
        blockers = _blockers_for(db, trip, completion, target)
        if blockers:
            raise PermissionError(" | ".join(blockers))
    hist = list(trip.stage_history or [])
    hist.append({
        "from": pointer,
        "to": target,
        "at": datetime.now(timezone.utc).isoformat(),
        "actor": actor or "",
    })
    trip.stage_history = hist
    trip.current_stage = max(pointer, target) if target > pointer else target
    trip.updated_at = get_utc_now()
    db.commit()
    db.refresh(trip)
    return build_stage_state(db, trip)


def bump_pointer(db: Session, trip: Trip, stage_completed: int) -> None:
    """After a stage's data is saved, advance the pointer past it (best-effort,
    never blocks the save itself)."""
    try:
        pointer = int(trip.current_stage or 1)
        if stage_completed >= pointer:
            trip.current_stage = min(stage_completed + 1, 11)
            hist = list(trip.stage_history or [])
            hist.append({
                "from": pointer,
                "to": trip.current_stage,
                "at": datetime.now(timezone.utc).isoformat(),
                "actor": "auto",
            })
            trip.stage_history = hist
            trip.updated_at = get_utc_now()
            db.commit()
    except Exception:
        db.rollback()
