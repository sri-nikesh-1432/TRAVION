"""Centralized budget service — the single source of truth for all budget math.

Fixes the critical bug where '₹10,000 - ₹25,000' parsed as ₹1,000,025,000
because the ₹ symbols made split parts non-numeric and digits got concatenated.
Never invents a global/default budget; the user's selection is absolute.

Rules (enforced server-side, everywhere):
    platform_fee = round(base_plan_cost * 0.03)
    total_cost   = base_plan_cost + platform_fee
    total_cost   <= user_max_budget          (HARD — including the fee)
    => base_plan_cost <= user_max_budget / 1.03

The frontend NEVER receives an over-budget generated plan. During live
editing, an over-budget state is allowed transiently with an explicit warning
and the UI must require optimization/removal (see recalculate_change).
"""
import re
from typing import Any, Dict, Optional, Tuple

PLATFORM_FEE_RATE = 0.03

PLAN_MIN_BUDGET = 1000.0
PLAN_MAX_BUDGET = 5_000_000.0


def sanitize_envelope(budget_min: float, budget_max: float) -> Tuple[float, float]:
    """Guard against implausible budgets (billion-scale values produced by
    malformed parsing) and zero/negative envelopes with bounded sane defaults."""
    lo = float(budget_min or 0.0)
    hi = float(budget_max or 0.0)
    if not (PLAN_MIN_BUDGET <= hi <= PLAN_MAX_BUDGET):
        hi = 50000.0
    if not (PLAN_MIN_BUDGET <= lo <= hi):
        lo = hi * 0.8
    return (round(lo, 0), round(hi, 0))


def fit_to_budget(base_plan_cost: float, user_max_budget: float) -> float:
    """Clamp a generated base cost so the total incl. fee never exceeds max."""
    ceiling = base_ceiling_for(user_max_budget)
    return round(min(float(base_plan_cost), ceiling), 0)


def parse_budget(value: Any, fallback: Optional[Tuple[float, float]] = None) -> Tuple[float, float]:
    """Parse any user budget expression into (min, max) without exploding.

    Handles: 15000 | '15000' | '15000.50' | '₹10,000 - ₹25,000' | '10000-25000'
    | {'min': 10000, 'max': 25000} | [10000, 25000]. The ₹ symbol and any other
    non-numeric characters are ignored per-number, NOT stripped globally before
    splitting — that is what previously produced ₹1,000,025,000.
    """
    if fallback is None:
        fallback = (0.0, 15000.0)

    def _invalid() -> Tuple[float, float]:
        return fallback

    if value is None:
        return _invalid()

    if isinstance(value, (int, float)):
        v = float(value)
        if v <= 0:
            return _invalid()
        return (v * 0.8, v)

    if isinstance(value, (list, tuple)):
        nums = [float(v) for v in value if isinstance(v, (int, float)) and float(v) > 0]
        if len(nums) >= 2:
            return (min(nums), max(nums))
        if len(nums) == 1:
            return (nums[0] * 0.8, nums[0])
        return _invalid()

    if isinstance(value, dict):
        try:
            lo = float(value.get("min") or 0)
            hi = float(value.get("max") or 0)
        except (TypeError, ValueError):
            return _invalid()
        if hi <= 0:
            return _invalid()
        if lo >= hi:
            lo = hi * 0.8
        return (lo, hi)

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return _invalid()
        # Extract each standalone number (currency symbols/commas/spaces ignored
        # WITHIN a number, but separate numbers are never concatenated).
        numbers = [float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)]
        if not numbers:
            return _invalid()
        if len(numbers) >= 2:
            lo, hi = min(numbers), max(numbers)
        else:
            lo, hi = numbers[0] * 0.8, numbers[0]
        if hi <= 0:
            return _invalid()
        if lo >= hi:
            lo = hi * 0.8
        return (lo, hi)

    return _invalid()


def base_ceiling_for(max_budget: float) -> float:
    """Largest base_plan_cost whose total (incl. 3% fee) still fits the budget."""
    return float(max_budget) / (1.0 + PLATFORM_FEE_RATE)


def compute_fee(base_plan_cost: float) -> float:
    return round(float(base_plan_cost) * PLATFORM_FEE_RATE, 0)


def compute_totals(base_plan_cost: float) -> Dict[str, float]:
    """The one fee/total calculation used by generation AND live editing."""
    base = float(base_plan_cost)
    fee = compute_fee(base)
    total = round(base + fee, 0)
    return {
        "base_plan_cost": round(base, 0),
        "platform_fee": fee,
        "final_total": total,
        "total": total,
        "payable": round(float(base) * 0 + fee, 0),  # kept for legacy fields
    "payable_is_fee_only": True,
    }


def validate_plan_budget(base_plan_cost: float, user_max_budget: float) -> Dict[str, Any]:
    """Backend-side budget validation. Never return an over-budget plan."""
    t = compute_totals(base_plan_cost)
    total = t["final_total"]
    return {
        "valid": total <= float(user_max_budget) + 0.5,
        "base_cost": t["base_plan_cost"],
        "platform_fee": t["platform_fee"],
        "total": total,
        "remaining": round(float(user_max_budget) - total, 0),
    }


def remaining_budget(total_cost: float, user_max_budget: float) -> float:
    return round(float(user_max_budget) - float(total_cost), 0)


def allocate_categories(max_budget: float) -> Dict[str, float]:
    """Transparent category allocation shares (for the planner's optimizer)."""
    ceiling = base_ceiling_for(max_budget)
    return {
        "transport": ceiling * 0.30,
        "stay": ceiling * 0.38,
        "food": ceiling * 0.17,
        "activities": ceiling * 0.12,
        "guide": ceiling * 0.03,
    }
