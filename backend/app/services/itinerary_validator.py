"""Final itinerary validation — the backend NEVER trusts the generator.

After any plan/edit is produced we re-verify, with the same math the product
promises the user:
    1. budget  — total (incl. 3% platform fee) must fit the traveller's max
    2. schedule — days/stops must have no overlaps or absurd back-to-backs
This runs on generated plans (/plan-multi) and on every user edit (PATCH
/itinerary). No AI escapes this gate; the verdict is deterministic and cheap.
"""
from typing import Any, Dict, List, Optional, Tuple

from app.services.budget_engine import validate_itinerary_budget
from app.services.multi_plan_engine import validate_days


def validate_itinerary(
    itinerary: Dict[str, Any],
    budget_max: float,
    cost_breakdown: Optional[Dict[str, Any]] = None,
    days: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Validate a full itinerary shape (cost_breakdown + days) in one call.

    `itinerary` may carry final_total / total_cost as a dict; alternatively pass
    `cost_breakdown` and `days` directly (the common plan-engine output).
    """
    bd = cost_breakdown if cost_breakdown is not None else itinerary
    guide_mode = bool(bd.get("guide_mode"))
    # GUIDE_MODE: the 12.5% guide + 3% platform fees sit ON TOP of the travel
    # spend, so the budget gates the base (travel) cost — the fee-inclusive
    # total intentionally exceeds it. ADVENTUROUS: the 3% platform fee lives
    # inside the budget, so the whole total must fit.
    if guide_mode:
        total = float(bd.get("base_plan_cost") or 0) or float(bd.get("travel_spend") or 0)
    else:
        total = (
            bd.get("final_total")
            or bd.get("total")
            or bd.get("total_cost")
            or float(bd.get("base_plan_cost") or 0) + float(bd.get("platform_fee") or 0)
        )
    budget_check = validate_itinerary_budget(float(total or 0.0), float(budget_max or 0.0))

    day_list = days if days is not None else (itinerary.get("days") or [])
    warnings: List[str] = validate_days(
        day_list,
        float(budget_max or 0.0),
        float(budget_check["total"]),
    )
    if not budget_check["valid"]:
        warnings.append(
            f"Itinerary is ₹{budget_check['over_by']:,.0f} over your budget "
            f"(₹{budget_check['total']:,.0f} vs ₹{round(float(budget_max or 0)):,})."
        )

    return {
        "valid": bool(budget_check["valid"]),
        "total": budget_check["total"],
        "remaining": budget_check["remaining"],
        "over_by": budget_check["over_by"],
        "warnings": warnings,
    }


def validate_plans(
    plans: List[Dict[str, Any]],
    budget_max: float,
) -> List[str]:
    """Convenience gate over a list of generated plans — rejects over-budget."""
    problems: List[str] = []
    for p in plans:
        bd = p.get("cost_breakdown") or {}
        # GUIDE_MODE gates the travel spend (fees are on top); ADVENTUROUS the
        # fee-inclusive total — either way just the amount that must fit.
        check_total = (
            float(bd.get("base_plan_cost") or 0) if bd.get("guide_mode")
            else (bd or p.get("final_total"))
        )
        check = validate_itinerary_budget(check_total, float(budget_max or 0.0))
        if not check["valid"]:
            problems.append(
                f"{p.get('type', 'Plan')} is ₹{check['over_by']:,.0f} over budget — "
                "raise the budget or remove selections."
            )
    return problems


def merge_warnings(base: List[str], extra: List[str]) -> List[str]:
    """Dedupe warnings while preserving order and every distinct message."""
    seen: Dict[str, None] = {}
    out: List[str] = []
    for w in [*(base or []), *(extra or [])]:
        key = str(w).strip().lower()
        if key and key not in seen:
            seen[key] = None
            out.append(w)
    return out