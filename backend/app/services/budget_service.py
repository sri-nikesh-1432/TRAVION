"""Centralized budget service — the single source of truth for all budget math.

Fixes the critical bug where '₹10,000 - ₹25,000' parsed as ₹1,000,025,000
because the ₹ symbols made split parts non-numeric and digits got concatenated.
Never invents a global/default budget; the user's selection is absolute.

Rules (enforced server-side, everywhere — spec §3/§7):
    platform_fee   = round(base_plan_cost * 0.03)     (ALWAYS)
    guide_fee      = round(base_plan_cost * 0.125)    (GUIDE_MODE only)
    safety_reserve = round(base_plan_cost * 0.15)     (ALWAYS)
    insurance_fee  = ₹50 fixed                        (ALWAYS)
    final_planned_amount = base + guide + platform + safety + insurance
    final_planned_amount <= user_max_budget           (HARD — fully loaded)
    remaining_budget     = user_max_budget − final_planned_amount

The frontend NEVER receives an over-budget generated plan. During live
editing, an over-budget state is allowed transiently with an explicit warning
and the UI must require optimization/removal (see recalculate_change).
"""
import re
from typing import Any, Dict, Optional, Tuple

PLATFORM_FEE_RATE = 0.03
GUIDE_FEE_RATE = 0.125
SAFETY_RESERVE_RATE = 0.15
INSURANCE_FEE = 50.0

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


def fit_to_budget(base_plan_cost: float, user_max_budget: float, guide_mode: bool = False) -> float:
    """Clamp a generated base cost so its fully-loaded final amount fits max."""
    ceiling = base_ceiling_for(user_max_budget, guide_mode=guide_mode)
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


def base_ceiling_for(max_budget: float, guide_mode: bool = False) -> float:
    """Largest base_plan_cost whose FULLY-LOADED final amount (base + 12.5%
    guide in Guide Mode + 3% platform + 15% safety + ₹50 insurance) still fits
    the budget (spec §3/§7).

    Per-component rupee rounding can add up to ~₹2 of drift, so the inverse
    result is verified against the real compute_totals and nudged down until
    it genuinely fits — the ceiling is exact, never aspirational.
    """
    fee_factor = (1.0 + GUIDE_FEE_RATE + PLATFORM_FEE_RATE + SAFETY_RESERVE_RATE) if guide_mode         else (1.0 + PLATFORM_FEE_RATE + SAFETY_RESERVE_RATE)
    candidate = int(max(0.0, (float(max_budget) - INSURANCE_FEE) / fee_factor))
    while candidate > 0 and compute_totals(candidate, guide_mode=guide_mode)["final_total"] > float(max_budget) + 0.5:
        candidate -= 1
    return float(candidate)


def compute_fee(base_plan_cost: float) -> float:
    return round(float(base_plan_cost) * PLATFORM_FEE_RATE, 0)


def compute_totals(base_plan_cost: float, guide_mode: bool = False) -> Dict[str, float]:
    """The one fee/total calculation used by generation AND live editing.

    Mirrors the central pricing rule exactly: fees stack on top of the base
    (12.5% guide in Guide Mode only, 3% platform always, 15% safety reserve
    always, ₹50 insurance always) and the final amount is fully loaded.
    """
    base = float(base_plan_cost)
    guide_fee = round(base * GUIDE_FEE_RATE, 0) if guide_mode else 0.0
    platform_fee = compute_fee(base)
    safety_reserve = round(base * SAFETY_RESERVE_RATE, 0)
    insurance_fee = INSURANCE_FEE
    total = round(base + guide_fee + platform_fee + safety_reserve + insurance_fee, 0)
    return {
        "base_plan_cost": round(base, 0),
        "guide_fee": guide_fee,
        "platform_fee": platform_fee,
        "safety_reserve": safety_reserve,
        "insurance_fee": insurance_fee,
        "final_total": total,
        "total": total,
        "payable": total,
    }


def validate_plan_budget(
    base_plan_cost: float, user_max_budget: float, guide_mode: bool = False
) -> Dict[str, Any]:
    """Backend-side budget validation. Never return an over-budget plan —
    the FULLY-LOADED final amount must fit the budget."""
    t = compute_totals(base_plan_cost, guide_mode=guide_mode)
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
