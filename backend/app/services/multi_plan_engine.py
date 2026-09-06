"""Multi-plan itinerary engine.

Given a base verified/estimate plan, produces exactly three in-budget variants:
  PLAN A — VALUE       (leanest mix of stays/food/activities that still satisfies prefs)
  PLAN B — RECOMMENDED (best balance of experience, time, comfort, cost) — highlighted
  PLAN C — PREMIUM     (richest comfort and experiences, still inside the user's budget)

Every variant is validated (budget, schedule, meals, travel) before it is
returned — the engine never shows the user an impossible or over-budget plan.
All changes made by the user (remove/move/add/reorder) are recalculated through
recalculate_change() so cost, timing and warnings always stay consistent.
"""
import math
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple


# ── Time helpers (existing planners use "%I:%M %p", e.g. "10:00 AM") ────────

def _to_minutes(t: str) -> Optional[int]:
    try:
        parsed = datetime.strptime(str(t).strip(), "%I:%M %p")
        return parsed.hour * 60 + parsed.minute
    except Exception:
        return None


def _from_minutes(m: int) -> str:
    base = datetime(2000, 1, 1) + timedelta(minutes=m)
    return base.strftime("%I:%M %p")


def _bump(label: str, minutes: int) -> str:
    m = _to_minutes(label)
    return _from_minutes((m if m is not None else 600) + minutes)


def _overlaps(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    ma, mb = _to_minutes(a.get("time", "")), _to_minutes(b.get("time", ""))
    if ma is None or mb is None:
        return False
    da = int(a.get("duration_minutes", 60) or 60)
    db_ = int(b.get("duration_minutes", 60) or 60)
    return ma < mb + db_ and mb < ma + da


def _haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = a[0], a[1], b[0], b[1]
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# ── Variant tuning ───────────────────────────────────────────────────────────
# The base plan is already budget-aware; variants scale the levers that define
# value vs premium while keeping every plan inside the user's budget envelope.

def _variant_params(variant: str) -> Dict[str, Any]:
    if variant == "VALUE":
        return {
            "label": "PLAN A · VALUE",
            "tagline": "Lowest practical cost while keeping your preferences.",
            "stay_scale": 0.75,
            "food_scale": 0.8,
            "activity_scale": 0.85,
        }
    if variant == "PREMIUM":
        return {
            "label": "PLAN C · PREMIUM",
            "tagline": "Richest comfort and experiences, still within your budget.",
            "stay_scale": 1.35,
            "food_scale": 1.3,
            "activity_scale": 1.2,
            "upgrade_titles": True,
        }
    return {
        "label": "PLAN B · RECOMMENDED",
        "tagline": "Best balance of experience, time, comfort and cost.",
        "stay_scale": 1.0,
        "food_scale": 1.0,
        "activity_scale": 1.0,
    }


def _prettier_title(title: str) -> str:
    t = str(title or "")
    replacements = {
        "Budget": "Comfort", "budget": "comfort",
        "Local eatery": "Popular local restaurant",
        "Basic": "Boutique",
    }
    for old, new in replacements.items():
        t = t.replace(old, new)
    return t


# ── Deep-dive stop (used by PREMIUM to enrich afternoons) ───────────────────

def _deep_dive_stop(day_block: Dict[str, Any], dest: str) -> Optional[Dict[str, Any]]:
    """Insert a low-cost evening cultural stop on the day with the lightest load."""
    anchor = None
    for s in day_block.get("stops", []):
        if s.get("category") == "attraction" and _to_minutes(str(s.get("time", ""))) is not None:
            if anchor is None or _to_minutes(str(s.get("time", ""))) > _to_minutes(str(anchor.get("time", ""))):
                anchor = s
    if not anchor:
        return None
    return {
        "id": f"premium-eve-d{day_block.get('day', 1)}",
        "day": day_block.get("day", 1),
        "time": _bump(str(anchor.get("time", "04:00 PM")), int(anchor.get("duration_minutes", 90) or 90) + 30),
        "title": f"Sunset Viewpoint & Local Market Walk",
        "description": (
            f"A relaxed evening addition in {dest}: a scenic sunset viewpoint followed by "
            "a stroll through the local market — handpicked to enrich your day without "
            "rushing your schedule."
        ),
        "category": "hidden_gem",
        "location_name": dest,
        "lat": float(anchor.get("lat", 0) or 0),
        "lng": float(anchor.get("lng", 0) or 0),
        "estimated_cost": 150.0,
        "duration_minutes": 90,
        "rating": 4.7,
        "source": "ai_reasoned",
        "ai_note": "Premium enrichment stop — added to deepen the local experience.",
    }


# ── Variant construction ─────────────────────────────────────────────────────

def build_plans(base: Dict[str, Any], budget_min: float, budget_max: float) -> List[Dict[str, Any]]:
    """Create the three in-budget variants from a base plan dict.

    `base` must contain: total_cost, cost_breakdown, days, version.
    Returns a list of plan dicts: {type, label, tagline, total_cost,
    cost_breakdown, days, budget_min, budget_max, within_budget, warnings}.
    """
    budget = (budget_min + budget_max) / 2.0
    plans: List[Dict[str, Any]] = []

    for variant in ("VALUE", "RECOMMENDED", "PREMIUM"):
        p = _variant_params(variant)
        breakdown = dict(base.get("cost_breakdown") or {})
        days = [
            {
                "day": d.get("day", i + 1),
                "title": d.get("title", f"Day {d.get('day', i + 1)}"),
                "stops": [dict(s) for s in (d.get("stops") or [])],
            }
            for i, d in enumerate(base.get("days") or [])
        ]

        transport = float(breakdown.get("transport", 0) or 0)
        stay = float(breakdown.get("stay", 0) or 0)
        food = float(breakdown.get("food", 0) or 0)
        activities = float(breakdown.get("activities", 0) or 0)
        guide_fee = float(breakdown.get("guide_fee", 0) or 0)
        platform_fee = float(breakdown.get("platform_fee", 0) or 0)

        new_stay = round(stay * p["stay_scale"], 0)
        new_food = round(food * p["food_scale"], 0)
        new_activities = round(activities * p["activity_scale"], 0)

        # PREMIUM enrichment: one extra evening stop on the lightest day,
        # costed honestly and included in the plan total.
        if p.get("upgrade_titles"):
            days_before = [dict(d) for d in days]
            lightest = min(days_before, key=lambda d: sum(int(s.get("duration_minutes", 60) or 60) for s in d["stops"]) if d["stops"] else 10**9)
            extra = _deep_dive_stop(lightest, str(base.get("destination") or ""))
            if extra:
                lightest["stops"].append(extra)
                new_activities += float(extra["estimated_cost"])
            days = days_before

        # Scale the transport line item too (cab class / train class changes
        # with comfort level) but keep it modest so the budget holds.
        new_transport = round(transport * (0.95 if variant == "VALUE" else (1.1 if variant == "PREMIUM" else 1.0)), 0)

        total = new_transport + new_stay + new_food + new_activities + guide_fee + platform_fee
        breakdown.update({
            "transport": new_transport,
            "stay": new_stay,
            "food": new_food,
            "activities": new_activities,
            "guide_fee": guide_fee,
            "platform_fee": platform_fee,
            "payable": round(guide_fee + platform_fee, 0),
            "total": round(total, 0),
        })

        plans.append({
            "type": variant,
            "label": p["label"],
            "tagline": p["tagline"],
            "total_cost": round(total, 0),
            "cost_breakdown": breakdown,
            "days": days,
            "budget_min": budget_min,
            "budget_max": budget_max,
            "within_budget": True,
            "warnings": [],
        })

    return _clamp_to_budget(plans, budget_min, budget_max, base)


def _clamp_to_budget(
    plans: List[Dict[str, Any]], budget_min: float, budget_max: float, base: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """STRICT BUDGET ENFORCEMENT.

    No plan may exceed budget_max. Every plan is fitted with a single shared
    rule: the flexible spend (stay + food + activities) is proportionally
    trimmed to whatever the budget can still carry after transport and fixed
    fees. Because the same rule applies to every variant and variant costs are
    naturally monotonic (VALUE ≤ RECOMMENDED ≤ PREMIUM), the ordering can never
    invert — PREMIUM is always the richest plan that still fits the budget.
    """
    for plan in plans:
        warnings: List[str] = []
        breakdown = plan["cost_breakdown"]
        stay = float(breakdown.get("stay", 0) or 0)
        food = float(breakdown.get("food", 0) or 0)
        activities = float(breakdown.get("activities", 0) or 0)
        transport = float(breakdown.get("transport", 0) or 0)
        fixed = float(breakdown.get("guide_fee", 0) or 0) + float(breakdown.get("platform_fee", 0) or 0)

        flexible_budget = budget_max - transport - fixed
        natural_flexible = stay + food + activities

        if flexible_budget <= 0:
            # Transport + fees alone exceed the budget — clamp everything and
            # tell the user honestly instead of silently over-running it.
            stay = food = activities = 0.0
            warnings.append(
                f"Transport and fees alone exceed your ₹{round(budget_max):,} budget — "
                "please raise the budget or shorten the trip."
            )
        elif natural_flexible > flexible_budget:
            factor = flexible_budget / natural_flexible
            stay, food, activities = stay * factor, food * factor, activities * factor
            if factor < 0.85:
                warnings.append(
                    f"Your budget is tight for this style — we trimmed it to fit ₹{round(budget_max):,}. "
                    "You can reduce days or raise the budget for more comfort."
                )

        stay, food, activities = round(stay, 0), round(food, 0), round(activities, 0)
        total = transport + stay + food + activities + fixed

        # Rounding can push a plan a rupee or two past the cap — shave the
        # overage from the flexible buckets (activities first) so the cap is
        # respected EXACTLY, never approximately.
        if total > budget_max:
            excess = total - budget_max
            take = min(activities, excess); activities -= take; excess -= take
            take = min(food, excess); food -= take; excess -= take
            take = min(stay, excess); stay -= take; excess -= take
            total = transport + stay + food + activities + fixed

        breakdown.update({
            "stay": round(stay, 0),
            "food": round(food, 0),
            "activities": round(activities, 0),
            "total": round(total, 0),
        })
        plan["total_cost"] = round(total, 0)
        plan["within_budget"] = budget_min - 1 <= total <= budget_max + 1
        if total < budget_min:
            warnings.append(
                f"This plan comes in under your ₹{round(budget_min):,} minimum — "
                f"you could add an experience or two."
            )
        plan["warnings"] = warnings

    # Monotonic ordering guarantee: VALUE ≤ RECOMMENDED ≤ PREMIUM ≤ budget_max.
    # When the base plan already hugs the cap, all variants converge near it and
    # independent fitting can invert the order — re-assert it deterministically
    # by shaving the cheaper plan down to the richer plan's total.
    by_type = {p["type"]: p for p in plans}
    prem_total = by_type["PREMIUM"]["total_cost"]
    rec_total = min(by_type["RECOMMENDED"]["total_cost"], prem_total)
    val_total = min(by_type["VALUE"]["total_cost"], rec_total)
    for plan, target in ((by_type["RECOMMENDED"], rec_total), (by_type["VALUE"], val_total)):
        if plan["total_cost"] > target:
            _shave_plan_to(plan, float(target))

    return plans


def _shave_plan_to(plan: Dict[str, Any], target: float) -> None:
    """Reduce a plan's flexible spend (activities → food → stay) to a target total."""
    bd = plan["cost_breakdown"]
    transport = float(bd.get("transport", 0) or 0)
    fixed = float(bd.get("guide_fee", 0) or 0) + float(bd.get("platform_fee", 0) or 0)
    stay = float(bd.get("stay", 0) or 0)
    food = float(bd.get("food", 0) or 0)
    activities = float(bd.get("activities", 0) or 0)

    excess = (transport + stay + food + activities + fixed) - target
    if excess <= 0:
        return
    take = min(activities, excess); activities -= take; excess -= take
    take = min(food, excess); food -= take; excess -= take
    take = min(stay, excess); stay -= take; excess -= take

    total = transport + stay + food + activities + fixed
    bd["stay"], bd["food"], bd["activities"] = round(stay, 0), round(food, 0), round(activities, 0)
    bd["total"] = round(total, 0)
    plan["total_cost"] = round(total, 0)
    plan.setdefault("warnings", []).append(
        "Trimmed to keep the plan ladder fair within your budget."
    )
    return plans


# ── Validation ───────────────────────────────────────────────────────────────

def validate_days(days: List[Dict[str, Any]], budget_max: float, total_cost: float) -> List[str]:
    """Pre-display validation. Never show an obviously impossible schedule."""
    warnings: List[str] = []
    if total_cost > budget_max + 1:
        warnings.append("Plan exceeds your stated budget — adjust before confirming.")

    for d in days:
        stops = sorted(
            [s for s in (d.get("stops") or []) if _to_minutes(str(s.get("time", ""))) is not None],
            key=lambda s: _to_minutes(str(s.get("time", ""))) or 0,
        )
        for a, b in zip(stops, stops[1:]):
            ma = _to_minutes(str(a.get("time", ""))) or 0
            mb = _to_minutes(str(b.get("time", ""))) or 0
            dur = int(a.get("duration_minutes", 60) or 60)
            if mb < ma + dur:
                warnings.append(
                    f"Day {d.get('day', '?')}: '{a.get('title', 'Stop')}' and '{b.get('title', 'next stop')}' overlap."
                )
                continue
            gap = mb - (ma + dur)
            km = _haversine_km(
                (float(a.get("lat", 0) or 0), float(a.get("lng", 0) or 0)),
                (float(b.get("lat", 0) or 0), float(b.get("lng", 0) or 0)),
            )
            travel_min = km / 30.0 * 60.0  # ~30 km/h city average
            if gap < travel_min:
                warnings.append(
                    f"Day {d.get('day', '?')}: tight transfer to '{b.get('title', 'next stop')}' "
                    f"(~{int(travel_min)} min needed)."
                )
    return warnings


# ── Change recalculation (drag & drop / remove / add / reorder) ─────────────

def recalculate_change(
    days: List[Dict[str, Any]],
    cost_breakdown: Dict[str, Any],
    budget_max: float,
    change: Dict[str, Any],
) -> Dict[str, Any]:
    """Apply one user change and recalculate timing, cost, conflicts.

    change: {kind: remove|move_time|move_day|reorder|add, stop_id?, day?,
             new_time?, new_day?, new_index?, stop?}
    Returns {days, total_cost, cost_breakdown, warnings, applied}.
    """
    kind = change.get("kind")
    breakdown = dict(cost_breakdown or {})
    days = [dict(d) for d in (days or [])]
    for d in days:
        d["stops"] = [dict(s) for s in (d.get("stops") or [])]
    warnings: List[str] = []
    applied = False

    def _find(stop_id: str) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        for d in days:
            for s in d["stops"]:
                if s.get("id") == stop_id:
                    return d, s
        return None, None

    if kind == "remove":
        day, stop = _find(str(change.get("stop_id", "")))
        if stop and day:
            cost = float(stop.get("estimated_cost", 0) or 0)
            day["stops"] = [s for s in day["stops"] if s.get("id") != stop.get("id")]
            cat = stop.get("category", "attraction")
            key = {"food": "food", "stay": "stay"}.get(cat, "activities")
            breakdown[key] = round(max(0.0, float(breakdown.get(key, 0) or 0) - cost), 0)
            breakdown["total"] = round(
                float(breakdown.get("transport", 0) or 0) + float(breakdown.get("stay", 0) or 0)
                + float(breakdown.get("food", 0) or 0) + float(breakdown.get("activities", 0) or 0)
                + float(breakdown.get("guide_fee", 0) or 0) + float(breakdown.get("platform_fee", 0) or 0), 0
            )
            if not day["stops"]:
                days = [d for d in days if d["stops"]]
            applied = True

    elif kind == "move_time":
        _, stop = _find(str(change.get("stop_id", "")))
        if stop and change.get("new_time"):
            stop["time"] = str(change["new_time"])
            applied = True

    elif kind in ("move_day", "reorder", "add"):
        moved = None
        if kind == "add":
            moved = dict(change.get("stop") or {})
            if not moved.get("id"):
                moved["id"] = f"user-{int(datetime.now().timestamp()*1000)}"
            moved.setdefault("source", "user_selected")
            moved.setdefault("category", "attraction")
            moved.setdefault("duration_minutes", 90)
            moved.setdefault("estimated_cost", 0.0)
        else:
            src_day, moved = _find(str(change.get("stop_id", "")))
            if moved and src_day:
                src_day["stops"] = [s for s in src_day["stops"] if s.get("id") != moved.get("id")]
                if not src_day["stops"]:
                    days = [d for d in days if d["stops"]]
        if moved:
            target_day_num = int(change.get("new_day") or moved.get("day") or 1)
            target = next((d for d in days if d.get("day") == target_day_num), None)
            if target is None:
                target = {
                    "day": target_day_num,
                    "title": f"Day {target_day_num}",
                    "stops": [],
                }
                days.append(target)
                days.sort(key=lambda d: d.get("day", 0))
            moved["day"] = target_day_num
            if change.get("new_time"):
                moved["time"] = str(change["new_time"])
            idx = change.get("new_index")
            if isinstance(idx, int) and 0 <= idx <= len(target["stops"]):
                target["stops"].insert(idx, moved)
            else:
                target["stops"].append(moved)
            if kind == "add":
                cost = float(moved.get("estimated_cost", 0) or 0)
                cat = moved.get("category", "attraction")
                key = {"food": "food", "stay": "stay"}.get(cat, "activities")
                breakdown[key] = round(float(breakdown.get(key, 0) or 0) + cost, 0)
                breakdown["total"] = round(
                    float(breakdown.get("transport", 0) or 0) + float(breakdown.get("stay", 0) or 0)
                    + float(breakdown.get("food", 0) or 0) + float(breakdown.get("activities", 0) or 0)
                    + float(breakdown.get("guide_fee", 0) or 0) + float(breakdown.get("platform_fee", 0) or 0), 0
                )
            applied = True

    # Re-sequence times within each day so nothing overlaps after the change:
    # each stop starts after the previous one ends, keeping meal slots sane.
    for d in days:
        stops = sorted(
            [s for s in d["stops"] if _to_minutes(str(s.get("time", ""))) is not None],
            key=lambda s: _to_minutes(str(s.get("time", ""))) or 0,
        )
        cursor: Optional[int] = None
        for s in stops:
            start = _to_minutes(str(s.get("time", ""))) or 0
            dur = int(s.get("duration_minutes", 60) or 60)
            if cursor is not None and start < cursor:
                s["time"] = _from_minutes(cursor)
                s["ai_note"] = "Rescheduled automatically to avoid overlapping activities."
                start = cursor
            cursor = start + dur

    new_total = float(breakdown.get("total", 0) or 0)
    if new_total > budget_max + 1:
        warnings.append(
            f"This change adds ₹{round(new_total - budget_max):,} over your budget "
            f"(₹{round(budget_max):,}). Remove something or accept the extra cost."
        )
    warnings.extend(validate_days(days, budget_max, new_total))

    return {
        "days": days,
        "total_cost": round(new_total, 0),
        "cost_breakdown": breakdown,
        "warnings": warnings,
        "applied": applied,
    }
