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

# Base guide rate per day (INR) for a standard guided day.
GUIDE_BASE_PER_DAY = 900.0
GUIDE_MIN_FEE = 1500.0
GUIDE_MAX_FEE = 30000.0

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
) -> float:
    """Rule-based guide fee: base/day x days x destination x party x service level."""
    if mode != "GUIDE_MODE":
        return 0.0

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
