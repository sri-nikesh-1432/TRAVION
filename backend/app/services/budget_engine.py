"""Budget Feasibility Engine — decides whether a trip is financially possible
BEFORE any itinerary is generated.

CORE PROBLEM this service fixes: Travion used to build a full normal itinerary
no matter the entered budget (₹100, ₹500, ₹1,000 …). That must never happen.
The budget controls feasibility, day count, stay availability, food quality,
transport level, activities and overall scope — never the other way around.

The engine only ever estimates from REAL data building blocks:
    - transport: india_planner's corridor + fare band estimator (real per-km
      fares, real floor prices, bus/train corridor selection)
    - stay: the real Budget/Hostel tier floor (₹500/night) from STAY_TIERS
    - food: a bottom-floor per-traveller per-day amount (realistic minimal)
    - activities: 0 — minimum-cost means free/low-cost attractions only
The LLM is never asked to invent prices; nothing here is fabricated.

All thresholds are centralised in BUDGET_CONFIG, so no `if budget < 1000`
scattered across the codebase. See the "Budget tiers" product spec.
"""
import math
from typing import Any, Dict, List, Optional, Tuple

from app.services.budget_service import PLATFORM_FEE_RATE
from app.services.pricing_service import compute_guide_fee, party_headcount, party_pax, GUIDE_FEE_RATE
from app.services.ai_orchestrator import _party
from app.services.india_planner import _estimate_transport, STAY_TIERS

# ── Single place for every budget rule ──────────────────────────────────────
# These are the ONLY numbers that decide a trip's feasibility tier. Changing a
# threshold here updates the whole product (rejection, catalog, plan engine).

BUDGET_CONFIG: Dict[str, float] = {
    # TIER 1 — below this is a hard „cannot afford" rejection.
    "absolute_minimum": 1000.0,
    # TIER 2 — 1,000–2,000: only a day-trip / no-stay trip is realistic.
    "very_low_budget": 2000.0,
    # TIER 3 — 2,000–4,000: budget-constrained generation.
    "low_budget": 4000.0,
    # TIER 4 — 4,000–5,000: restricted but usable.
    "restricted_budget": 5000.0,
    # TIER 5 — 5,000+ is budget-aware generation (still validated per trip).
    "normal_budget": 5000.0,
    # Cost model floors (real, not invented):
    "minimum_nightly_stay": 500.0,          # Budget/Hostel tier floor in STAY_TIERS
    "minimum_food_per_pax_per_day": 250.0,  # one basic meal set + light bites
    "contingency_rate": 0.05,               # small honest safety margin
    "max_days_cap": 30.0,
    # Step-3 display bands (low / medium / high) used ONLY for card ordering.
    "band_low_max": 15000.0,
    "band_medium_max": 40000.0,
}

TIER_LABELS: Dict[str, str] = {
    "extremely_low": "Extremely low budget",
    "very_low": "Very low budget",
    "low": "Low budget",
    "restricted": "Restricted budget",
    "normal": "Standard budget",
}

TIER_SUMMARIES: Dict[str, str] = {
    "extremely_low": "Your budget is too low to cover even the basic costs of this trip.",
    "very_low": "We can only build a day-trip style plan — no accommodation, basic food, public transport and free/low-cost attractions.",
    "low": "We'll prioritize budget food, public transport and free-or-cheap attractions with the cheapest possible stay.",
    "restricted": "We can build this trip, but only within tight limits — budget stay, budget food and low-cost activities.",
    "normal": "Your budget supports a standard trip. We still validate every generated plan against it.",
}

# What each tier ALLOWS the planner to spend on / include.
TIER_CLASSES: Dict[str, Dict[str, Any]] = {
    "extremely_low": {"stay_allowed": False, "food_category": "basic", "transport_category": "public", "activity_category": "free"},
    "very_low":      {"stay_allowed": False, "food_category": "budget", "transport_category": "public", "activity_category": "free_low_cost"},
    "low":           {"stay_allowed": True,  "food_category": "budget", "transport_category": "public", "activity_category": "free_low_cost"},
    "restricted":    {"stay_allowed": True,  "food_category": "budget", "transport_category": "public", "activity_category": "budget"},
    "normal":        {"stay_allowed": True,  "food_category": "flexible", "transport_category": "flexible", "activity_category": "flexible"},
}


def get_budget_config() -> Dict[str, float]:
    """Copy of the single budget rule table (so callers can't mutate it)."""
    return dict(BUDGET_CONFIG)


def tier_for(budget: Optional[float]) -> str:
    b = float(budget or 0.0)
    if b < BUDGET_CONFIG["absolute_minimum"]:
        return "extremely_low"
    if b < BUDGET_CONFIG["very_low_budget"]:
        return "very_low"
    if b < BUDGET_CONFIG["low_budget"]:
        return "low"
    if b < BUDGET_CONFIG["restricted_budget"]:
        return "restricted"
    return "normal"


def tier_label(tier: str) -> str:
    return TIER_LABELS.get(tier, TIER_LABELS["normal"])


def tier_summary(tier: str) -> str:
    return TIER_SUMMARIES.get(tier, TIER_SUMMARIES["normal"])


def tier_classes(tier: str) -> Dict[str, Any]:
    return dict(TIER_CLASSES.get(tier, TIER_CLASSES["normal"]))


def display_band_for(budget: Optional[float]) -> str:
    """Coarse band used to ORDER discovery cards (budget-fit first). Never
    invents or removes anything — it only reorders real verified options."""
    b = float(budget or 25000)
    if b <= BUDGET_CONFIG["band_low_max"]:
        return "low"
    if b <= BUDGET_CONFIG["band_medium_max"]:
        return "medium"
    return "high"


# ── Alias names consumed by trip_edit / destination_catalog ──────────────────
def budget_tier_for(budget: Optional[float]) -> Dict[str, Any]:
    """Metadata for the Step-3 budget advisor strip."""
    tier = tier_for(budget)
    return {
        "tier": tier,
        "label": tier_label(tier),
        "tier_label": tier_label(tier),
        "summary": tier_summary(tier),
        "tier_summary": tier_summary(tier),
    }


def band_for_budget(budget: Optional[float]) -> str:
    return display_band_for(budget)


def get_budget_constraints(budget: Optional[float]) -> Dict[str, Any]:
    """The full constraint set the itinerary generator must obey."""
    tier = tier_for(budget)
    classes = tier_classes(tier)
    return {
        "tier": tier,
        "tier_label": tier_label(tier),
        "tier_summary": tier_summary(tier),
        "tier_message": tier_summary(tier),
        "budget_status": "restricted" if tier in ("extremely_low", "very_low", "low", "restricted") else "affordable",
        "maximum_allowed_spend": float(budget or 0.0),
        # True = stay may be included, but low/restricted tiers only ever use
        # the cheapest stay class (classic „no stay if it's a day trip" rule).
        "stay_allowed": bool(classes["stay_allowed"]),
        "food_category": classes["food_category"],
        "transport_category": classes["transport_category"],
        "activity_category": classes["activity_category"],
        # Economy mode forces all three plan variants onto budget-level choices.
        "economy": bool(tier in ("very_low", "low", "restricted")),
        # Extremely low is never generated at all.
        "impossible": bool(tier == "extremely_low"),
    }


def _haversine_km(a: Optional[Tuple[float, float]], b: Optional[Tuple[float, float]]) -> float:
    try:
        lat1, lng1, lat2, lng2 = a[0], a[1], b[0], b[1]
    except (TypeError, IndexError):
        return 0.0
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _pax_and_rooms(profile: Dict[str, Any]) -> Tuple[int, int]:
    """REAL group size (exact total when the structured answer exists) + rooms
    at 2 travellers per room — the feasibility floor scales with the group."""
    party = _party(profile)
    pax = party_pax(profile.get("party"))
    pax = max(1, pax)
    return pax, max(1, math.ceil(pax / 2))


def calculate_minimum_trip_cost(
    destination: str,
    days: int,
    mode: str,
    profile: Dict[str, Any],
    source_name: str = "",
    destination_state: str = "",
    source_coords: Optional[Tuple[float, float]] = None,
    dest_coords: Optional[Tuple[float, float]] = None,
    stay_allowed: bool = True,
    party: Optional[str] = None,
) -> Dict[str, Any]:
    """A defensible floor: the cheapest REALISTIC way to do `days` days.

    Numbers are floors from real data (transport fare bands, hostel-tier stay
    floor, bottom food allowance, free activities). If even this floor cannot
    fit the budget, the trip honestly cannot be afforded. Returns a cost shape
    compatible with the plan engine (base + 3% platform fee).
    """
    days = max(1, int(days))
    pax, rooms = _pax_and_rooms(profile)
    party = party or _party(profile)
    nights = max(0, days - 1) if stay_allowed else 0
    budget_hint = float((profile or {}).get("budget", {}).get("max", 9000) or 9000)

    km = _haversine_km(source_coords, dest_coords)
    # Cheapest realistic corridor (bus or train floor) — never a made-up fare.
    transport = _estimate_transport(
        source_name or "Home", destination, km,
        {"transport_pref": "AC Sleeper Bus"}, min(max(budget_hint, 1.0), 9000.0),
    )
    transport_cost = round(float(transport["fare"]) * 2 * pax, 0)  # round trip

    nightly = BUDGET_CONFIG["minimum_nightly_stay"]
    stay_cost = round(nightly * nights * rooms, 0) if nights else 0.0

    food_per_pax_day = BUDGET_CONFIG["minimum_food_per_pax_per_day"]
    food_cost = round(food_per_pax_day * days * pax, 0)

    activity_cost = 0.0  # minimum-cost trip = free/low-cost attractions only

    travel_spend = round(transport_cost + stay_cost + food_cost + activity_cost, 0)
    contingency = round(travel_spend * BUDGET_CONFIG["contingency_rate"], 0)
    # Same fee model as every generated plan: guide 12.5% of the travel spend in
    # GUIDE_MODE, platform 3% of the travel spend. The contingency stays an
    # extra conservative buffer so the affordability floor never over-commits.
    guide_fee = float(compute_guide_fee(mode, days, destination, party_type=party, base_cost=travel_spend))
    platform_fee = round(travel_spend * PLATFORM_FEE_RATE, 0)
    base_plan_cost = round(travel_spend, 0)
    total_cost = round(travel_spend + contingency + guide_fee + platform_fee, 0)

    return {
        "days": days,
        "pax": pax,
        "rooms": rooms,
        "nights": nights,
        "transport_cost": transport_cost,
        "stay_cost": stay_cost,
        "food_cost": food_cost,
        "activity_cost": activity_cost,
        "contingency": contingency,
        "guide_fee": guide_fee,
        "travel_spend": travel_spend,
        "base_plan_cost": base_plan_cost,
        "platform_fee": platform_fee,
        "total_cost": total_cost,
        "final_total": total_cost,
        # GUIDE_MODE: the traveller's budget is the TRAVEL SPEND — the 12.5%
        # guide fee + 3% platform fee are charged on top, so the minimum budget
        # that must actually fit is the travel spend itself. Feasibility and
        # "how many days fit" guidance therefore compare against this.
        "minimum_required_budget": (
            round(travel_spend, 0) if mode == "GUIDE_MODE" else total_cost
        ),
    }


def calculate_max_affordable_days(
    budget: float,
    destination: str,
    mode: str,
    profile: Dict[str, Any],
    stay_allowed: bool,
    source_name: str = "",
    destination_state: str = "",
    source_coords: Optional[Tuple[float, float]] = None,
    dest_coords: Optional[Tuple[float, float]] = None,
    cap: int = 30,
) -> int:
    """Largest whole-number day count that fits the budget at the minimum cost.

    Returns 0 when even a single day does not fit the budget. This drives the
    honest "your budget supports a 2-day trip, not 5" guidance.
    """
    budget = float(budget or 0.0)
    base_kw = dict(
        source_name=source_name, destination_state=destination_state,
        source_coords=source_coords, dest_coords=dest_coords,
        stay_allowed=stay_allowed,
    )
    for days in range(1, int(BUDGET_CONFIG["max_days_cap"]) + 1):
        cost = calculate_minimum_trip_cost(destination, days, mode, profile, **base_kw)
        # In GUIDE_MODE the fees sit on top of the travel spend, so use the
        # spend as the comparable; otherwise compare the fee-inclusive total.
        comparable = cost["base_plan_cost"] if mode == "GUIDE_MODE" else cost["final_total"]
        if comparable > budget:
            return max(0, days - 1)
    return int(BUDGET_CONFIG["max_days_cap"])


def check_budget_feasibility(
    budget: float,
    destination: str,
    days: Optional[int] = None,
    mode: str = "ADVENTUROUS_MODE",
    profile: Optional[Dict[str, Any]] = None,
    source_name: str = "",
    source_state: str = "",
    destination_state: str = "",
    source_coords: Optional[Tuple[float, float]] = None,
    dest_coords: Optional[Tuple[float, float]] = None,
    requested_days: Optional[int] = None,
) -> Dict[str, Any]:
    """The verdict Travion acts on BEFORE generating anything.

    status:
      "impossible"  → reject loudly, show advisor message + alternatives
      "restricted"  → generate a budget-constrained trip (no stay / day-trip
                      style when the full trip with stay doesn't fit)
      "affordable"  → normal budget-aware generation (still validated after)

    `days` and `requested_days` are aliases — callers pass either.
    """
    profile = profile or {}
    budget = float(budget or 0.0)
    days = max(1, int(days or requested_days or 2))
    tier = tier_for(budget)
    classes = tier_classes(tier)

    base_kw = dict(
        source_name=source_name, destination_state=destination_state,
        source_coords=source_coords, dest_coords=dest_coords,
    )
    min_with_stay = calculate_minimum_trip_cost(destination, days, mode, profile, stay_allowed=True, **base_kw)
    min_no_stay = calculate_minimum_trip_cost(destination, days, mode, profile, stay_allowed=False, **base_kw)
    day1_no_stay = calculate_minimum_trip_cost(destination, 1, mode, profile, stay_allowed=False, **base_kw)

    max_with_stay = calculate_max_affordable_days(budget, destination, mode, profile, True, source_name=source_name, destination_state=destination_state, source_coords=source_coords, dest_coords=dest_coords)
    max_no_stay = calculate_max_affordable_days(budget, destination, mode, profile, False, source_name=source_name, destination_state=destination_state, source_coords=source_coords, dest_coords=dest_coords)

    full_day_trip_ok = bool(classes.get("stay_allowed"))
    min_required = min_with_stay["minimum_required_budget"] if full_day_trip_ok else min_no_stay["minimum_required_budget"]

    if tier == "extremely_low" or budget < day1_no_stay["minimum_required_budget"]:
        status = "impossible"
    elif not full_day_trip_ok:
        # TIER 2 (very low): always a day-trip / no-stay plan, never a hotel.
        status = "restricted"
    elif budget < min_with_stay["minimum_required_budget"]:
        status = "restricted"  # a stay simply cannot be afforded
    else:
        status = "affordable"

    constraints = get_budget_constraints(budget)
    # Restricted plans must never silently include a stay the budget can't hold.
    if status == "restricted":
        constraints["stay_allowed"] = bool(constraints["stay_allowed"] and budget >= min_with_stay["minimum_required_budget"])
    constraints["economy"] = bool(constraints["economy"] or status == "restricted")

    recommended_days = min(
        days,
        max_with_stay if full_day_trip_ok else max_no_stay,
    )

    if status == "impossible":
        message = (
            f"You cannot afford this trip with ₹{budget:,.0f} in hand. "
            f"The minimum realistic cost for this destination is approximately ₹{day1_no_stay['minimum_required_budget']:,.0f} "
            f"— even as a no-stay, free-attraction day trip."
        )
        alternatives = [
            {"heading": "Increase your budget", "text": "Raising your trip budget lets Travion plan the full experience you picked."},
            {"heading": "Choose a closer destination", "text": "Lower transport fares reduce the minimum realistic cost."},
            {"heading": "Reduce the trip duration", "text": "Fewer days cost proportionally less."},
        ]
    elif status == "restricted":
        if recommended_days < days:
            message = (
                f"With ₹{budget:,.0f}, a {max(1, recommended_days)}-day budget trip is realistic "
                f"(no accommodation, basic food, public transport and free/low-cost attractions). "
                f"A {days}-day trip would require approximately ₹{min_with_stay['minimum_required_budget']:,.0f} or more."
            )
        else:
            message = (
                f"Your ₹{budget:,.0f} budget can support a limited trip. We'll prioritise {('no stay / cheapest possible stay, ' if not constraints['stay_allowed'] else 'the cheapest stay, ')}"
                f"budget food, public transport and free-or-low-cost attractions."
            )
        alternatives = [
            {"heading": "Reduce the trip duration", "text": f"Shorten the trip to {max(1, recommended_days)} day(s) so it comfortably fits your budget."},
            {"heading": "Increase your budget", "text": "A bigger budget reinstates a stay and more comfortable choices."},
            {"heading": "Continue without a stay", "text": "Skip accommodation entirely — we'll plan day-trip style with every night skipped."},
        ]
    else:
        if mode == "GUIDE_MODE":
            message = (
                f"Good news — ₹{budget:,.0f} can fund the travel cost of this trip. "
                f"The {int(GUIDE_FEE_RATE * 100)}% guide fee and {int(PLATFORM_FEE_RATE * 100)}% "
                f"platform fee are added on top when you book."
            )
        else:
            message = (
                f"Good news — ₹{budget:,.0f} can fund this trip. We'll keep the total (including the "
                f"{int(PLATFORM_FEE_RATE * 100)}% Travion fee) inside your budget."
            )
        alternatives = []

    return {
        "feasible": status != "impossible",
        "status": status,
        "budget_status": "restricted" if status in ("impossible", "restricted") else "affordable",
        "tier": tier,
        "tier_label": tier_label(tier),
        "tier_summary": tier_summary(tier),
        "tier_message": tier_summary(tier),
        "maximum_allowed_spend": budget,
        "minimum_required_budget": round(min_required, 0),
        "minimum_with_stay": round(min_with_stay["minimum_required_budget"], 0),
        "minimum_no_stay": round(min_no_stay["minimum_required_budget"], 0),
        "max_affordable_days": max_with_stay,
        "max_affordable_days_no_stay": max_no_stay,
        "recommended_days": max(1, recommended_days),
        "requested_days": days,
        "message": message,
        "alternatives": alternatives,
        "constraints": constraints,
    }


def validate_itinerary_budget(final_total, budget_max: float) -> Dict[str, Any]:
    """Post-generation validation — never display an itinerary above budget.

    `final_total` may be a plain number OR a cost_breakdown dict (as emitted by
    the plan engine); both are handled so callers can pass p["cost_breakdown"].
    """
    if isinstance(final_total, dict):
        bd = final_total
        total = (bd.get("final_total") or bd.get("total") or 0)
        if not total:
            total = float(bd.get("base_plan_cost") or 0) + float(bd.get("platform_fee") or 0)
    else:
        total = float(final_total or 0.0)
    total = float(total)
    max_budget = float(budget_max or 0.0)
    return {
        "valid": total <= max_budget + 0.5,
        "total": round(total, 0),
        "remaining": round(max_budget - total, 0),
        "over_by": round(max(0.0, total - max_budget), 0),
        "fee_rate": PLATFORM_FEE_RATE,
    }