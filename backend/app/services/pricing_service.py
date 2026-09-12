"""
Dynamic pricing engine for Travion.

Principles (per the product spec):
- The user's declared trip budget is an *estimated overall travel budget*, not the
  amount Travion collects.
- Travion charges ONLY the applicable Guide Fee + Platform Fee.
- Guide fee and platform fee are both dynamic: they vary with trip duration,
  destination, party size, service mode and budget band.
- Rules are centralised here (server-side only) and are admin-configurable in
  future via the same rule table exposed through the admin API.
"""

from typing import Dict, Any, Optional

# Destination difficulty / demand multipliers (rule-based, server-side).
DESTINATION_MULTIPLIERS: Dict[str, float] = {
    "Ooty": 1.0,
    "Munnar": 1.1,
    "Manali": 1.2,
    "Goa": 1.1,
    "Jaipur": 1.0,
    "Varanasi": 0.9,
    "Coimbatore": 0.8,
    "Bangalore": 0.8,
    "Delhi": 0.8,
    "Mumbai": 0.9,
}

# Party-size multipliers.
PARTY_MULTIPLIERS: Dict[str, float] = {
    "Solo": 1.0,
    "Couple": 1.2,
    "Family with Kids": 1.4,
    "Friends Group": 1.3,
}

# Headcount used when converting per-person fares into group estimates.
PARTY_HEADCOUNT: Dict[str, float] = {
    "Solo": 1,
    "Couple": 2,
    "Family with Kids": 3.5,
    "Friends Group": 4.5,
}

# Base guide rate per day (INR) for a standard guided day (fallback only).
# (party_pax above is the group-size source of truth for every cost engine.)
GUIDE_BASE_PER_DAY = 900.0
GUIDE_MIN_FEE = 1500.0
GUIDE_MAX_FEE = 30000.0

# Guide fee as a percentage of the plan's base cost (travel spend) in GUIDE_MODE.
# Product spec: e.g. a ₹15,000 plan -> 12.5% guide fee = ₹1,875, plus a 3%
# platform fee. Only ever charged in GUIDE_MODE.
GUIDE_FEE_RATE = 0.125

# Platform fee: percentage bands over the estimated travel spend by budget tier.
PLATFORM_RATE_BANDS = [
    (10000, 0.06),   # up to ~10k budget
    (25000, 0.055),  # up to ~25k
    (50000, 0.05),   # up to ~50k
    (100000, 0.045),  # up to ~1L
    (float("inf"), 0.04),  # 1L+
]
PLATFORM_MIN_FEE = 149.0
PLATFORM_MAX_FEE = 7499.0


def destination_multiplier(destination: str) -> float:
    return DESTINATION_MULTIPLIERS.get(destination, 1.0)


def party_multiplier(party_type: Optional[str]) -> float:
    if not party_type:
        return 1.0
    for key, value in PARTY_MULTIPLIERS.items():
        if key.lower() in party_type.lower():
            return value
    return 1.0


def party_headcount(party_type: Optional[str]) -> float:
    if not party_type:
        return 1.0
    for key, value in PARTY_HEADCOUNT.items():
        if key.lower() in party_type.lower():
            return value
    return 1.0


def party_pax(party: Any) -> int:
    """REAL traveller count for group cost maths (product rule: never plan for
    one person when the user is travelling as a group).

    The 3-question interview stores the party answer as
    {'group','total','adults','children'} — when that structured answer exists
    the EXACT total wins (10 travellers → 10× transport, 10× per-person food,
    10/2 = 5 rooms). Only when no exact count was captured (legacy trips that
    answered a bare 'Solo'/'Couple' string) do the label estimates apply.
    """
    if isinstance(party, dict):
        raw_total = party.get("total")
        try:
            total = int(float(raw_total))
        except (TypeError, ValueError):
            total = 0
        if total >= 1:
            return total
        # Malformed/missing total: fall back to adults + children when present.
        try:
            a = int(float(party.get("adults") or 0))
            c = int(float(party.get("children") or 0))
            if a + c >= 1:
                return a + c
        except (TypeError, ValueError):
            pass
    return int(party_headcount(party if isinstance(party, str) else None))


def platform_rate_for_budget(budget: float) -> float:
    for threshold, rate in PLATFORM_RATE_BANDS:
        if budget <= threshold:
            return rate
    return PLATFORM_RATE_BANDS[-1][1]


def compute_guide_fee(
    mode: str,
    days: int,
    destination: str,
    party_type: Optional[str] = None,
    luxury_level: Optional[str] = None,
    base_cost: Optional[float] = None,
) -> float:
    """Guide fee in GUIDE_MODE.

    Preferred rule (product spec): 12.5% of the plan's BASE COST (travel spend).
    A conference-style per-day fallback (base/day x days x destination x party x
    service level, min ₹1,500, max ₹30,000) is used only when no base cost is
    known yet (e.g. an early estimate before the plan exists).
    """
    if mode != "GUIDE_MODE":
        return 0.0

    if base_cost is not None and float(base_cost) > 0:
        fee = float(base_cost) * GUIDE_FEE_RATE
        return round(fee, 0)

    days = max(1, int(days))
    fee = (
        GUIDE_BASE_PER_DAY
        * days
        * destination_multiplier(destination)
        * party_multiplier(party_type)
    )
    # Longer, more complex trips add a small complexity bump beyond a week.
    if days > 7:
        fee *= 1.05
    if days > 14:
        fee *= 1.05

    # Luxury concierge-style guidance carries a premium.
    if luxury_level and "luxury" in str(luxury_level).lower():
        fee *= 1.25

    return round(max(GUIDE_MIN_FEE, min(fee, GUIDE_MAX_FEE)), 0)


def compute_platform_fee(budget: float) -> float:
    """Platform fee: rate-band percentage over the declared trip budget."""
    if budget <= 0:
        budget = 10000.0
    rate = platform_rate_for_budget(budget)
    fee = budget * rate
    return round(max(PLATFORM_MIN_FEE, min(fee, PLATFORM_MAX_FEE)), 0)


def compute_fees(
    mode: str,
    days: int,
    budget: float,
    destination: str,
    party_type: Optional[str] = None,
    luxury_level: Optional[str] = None,
) -> Dict[str, Any]:
    """Compute full Travion fee structure for a trip. Never charges the trip budget."""
    guide_fee = compute_guide_fee(mode, days, destination, party_type, luxury_level)
    platform_fee = compute_platform_fee(budget)
    payable = round(guide_fee + platform_fee, 0)

    return {
        "guide_fee": guide_fee,
        "platform_fee": platform_fee,
        "payable": payable,
        "rules": {
            "mode": mode,
            "days": max(1, int(days)),
            "destination_multiplier": destination_multiplier(destination),
            "party_multiplier": party_multiplier(party_type),
            "guide_base_per_day": GUIDE_BASE_PER_DAY,
            "platform_rate": platform_rate_for_budget(budget),
        },
    }


# ── SINGLE SOURCE OF TRUTH ───────────────────────────────────────────────────
# Every surface (checkout, Razorpay order, plan cards, plan-change repricing,
# guide/manager/admin dashboards, transactions) reads Trip pricing from these
# functions. The formulas never live in React or in per-surface ad-hoc code.

from app.services.budget_service import PLATFORM_FEE_RATE  # noqa: E402


def guide_fee_for(
    mode: str,
    days: int,
    destination: str,
    party_type: Optional[str] = None,
    guide: Any = None,
    base_cost: Optional[float] = None,
) -> float:
    """Authoritative guide fee.

    1. If a real guide is ASSIGNED (accepted/confirmed) AND that guide has a
       manager-configured `rate_per_day`, the fee is their rate × guided days
       (clamped to Travion's published guide-fee bounds). This is the future
       manager-configurable per-guide pricing path.
    2. Otherwise, in GUIDE_MODE, the fee is 12.5% of the plan's base cost
       (travel spend) per the product spec — e.g. a ₹15,000 plan → ₹1,875.
    3. Never a hardcoded universal amount; never ₹0 for a trip where a guide
       is actually required (GUIDE_MODE).
    """
    days = max(1, int(days))
    if guide is not None and getattr(guide, "rate_per_day", None):
        fee = float(guide.rate_per_day) * days
        return round(max(GUIDE_MIN_FEE, min(fee, GUIDE_MAX_FEE)), 0)
    return compute_guide_fee(mode, days, destination, party_type, base_cost=base_cost)


def reprice_breakdown(
    breakdown: Optional[Dict[str, Any]] = None,
    *,
    mode: str,
    days: int,
    destination: str,
    party_type: Optional[str] = None,
    guide: Any = None,
) -> Dict[str, Any]:
    """Recompute a cost breakdown with the CURRENT guide fee (e.g. after the
    traveller removed/added a day or the itinerary was edited). Keeps the guide
    fee consistent with the new plan instead of freezing the old one.
    Returns a full breakdown dict with authoritative payable/platform/travel.
    """
    bd = dict(breakdown or {})
    transport = float(bd.get("transport", 0) or 0)
    stay = float(bd.get("stay", 0) or 0)
    food = float(bd.get("food", 0) or 0)
    activities = float(bd.get("activities", 0) or 0)
    travel_spend = round(transport + stay + food + activities, 0)

    # BUDGET-FITTED PLANS STAY FITTED (single source of truth): a plan card may
    # clamp the base cost to the traveller's budget envelope (base_plan_cost).
    # Reconcile the component lines to that clamp so EVERY surface that
    # recomputes from components (checkout, pricing, ledgers, dashboards)
    # arrives at the SAME payable the plan card promised — the unclamped
    # components must never resurrect a higher total. Proportional, honest
    # scaling of the real lines; no invented values.
    fitted = bd.get("base_plan_cost")
    if fitted is not None:
        fitted = float(fitted or 0)
        if 0 < fitted < travel_spend:
            scale = fitted / travel_spend
            transport = round(transport * scale, 0)
            stay = round(stay * scale, 0)
            food = round(food * scale, 0)
            activities = round(activities * scale, 0)
            drift = round(fitted - (transport + stay + food + activities), 0)
            activities = round(activities + drift, 0)  # absorb rounding on the flexible line
            travel_spend = round(transport + stay + food + activities, 0)

    guide_fee = guide_fee_for(mode, days, destination, party_type, guide, base_cost=travel_spend)
    # base_cost in GUIDE_MODE = travel spend; both fees are %s over it.
    fee_base = travel_spend
    platform_fee = round(fee_base * PLATFORM_FEE_RATE, 0)
    final_total = round(fee_base + guide_fee + platform_fee, 0)
    bd.update({
        "guide_fee": round(guide_fee, 0),
        "platform_fee": platform_fee,
        "payable": round(guide_fee + platform_fee, 0),
        "travel_spend": travel_spend,
        "base_plan_cost": round(fee_base, 0),
        "final_total": final_total,
        "total": final_total,
        "total_cost": final_total,
        "days": max(1, int(days)),
    })
    return bd


def calculate_trip_pricing(
    *,
    mode: str,
    days: int,
    destination: str,
    breakdown: Optional[Dict[str, Any]] = None,
    budget: float = 0.0,
    party_type: Optional[str] = None,
    guide: Any = None,
) -> Dict[str, Any]:
    """THE authoritative Trip pricing result.

    Returns the exact numbers every surface must render/charge:
      transport_cost, stay_cost, food_cost, activity_cost, travel_spend,
      guide_fee, platform_fee, amount_payable, currency, total_cost plus the
      breakdown + rules. `amount_payable` (the ONLY thing Razorpay charges) is
      guide_fee + platform_fee — the local travel spend is never collected.
    """
    bd = reprice_breakdown(
        breakdown, mode=mode, days=days,
        destination=destination, party_type=party_type, guide=guide,
    )
    guide_fee = float(bd["guide_fee"])
    platform_fee = float(bd["platform_fee"])
    return {
        "transport_cost": float(bd.get("transport", 0) or 0),
        "stay_cost": float(bd.get("stay", 0) or 0),
        "food_cost": float(bd.get("food", 0) or 0),
        "activity_cost": float(bd.get("activities", 0) or 0),
        "travel_spend": float(bd["travel_spend"]),
        "guide_fee": guide_fee,
        "platform_fee": platform_fee,
        "amount_payable": round(guide_fee + platform_fee, 0),
        "currency": "INR",
        "days": max(1, int(days)),
        "total_cost": float(bd["total_cost"]),
        "breakdown": bd,
        "rules": {
            "mode": mode,
            "days": max(1, int(days)),
            "guide_base_per_day": GUIDE_BASE_PER_DAY,
            "guide_min_fee": GUIDE_MIN_FEE,
            "guide_max_fee": GUIDE_MAX_FEE,
            "platform_fee_rate": PLATFORM_FEE_RATE,
        },
    }
