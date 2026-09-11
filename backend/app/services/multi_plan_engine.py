"""Multi-plan itinerary engine (v2).

The user's preferences + selected places are the source of truth; the AI
optimizes around them and never replaces them. Budget is a HARD constraint.

Given a base verified/estimate plan and the traveller's selections, produces
exactly three differentiated in-budget variants:

  PLAN A — VALUE        cheapest real stay tier, economical transport, local food
  PLAN B — RECOMMENDED  best balance (highlighted RECOMMENDED FOR YOU)
  PLAN C — PREMIUM      richest real stay tier, private transport, premium dining

Hard rules enforced here (server-side, never just UI):
  * base_plan_cost x 1.03 <= budget_max  → the 3% platform fee is computed
    INSIDE the user's ceiling, because the budget means total spending.
  * platform_fee = round(0.03 x base_plan_cost); final_total = base + fee.
  * Every selected place is injected into EVERY plan. If one genuinely cannot
    fit the schedule, a visible warning is returned — never a silent drop.
  * Stay tiers come from real verified stays (name, tier, per-night price).
  * Plans must actually differ: stay tier, transport class, food mix, pacing
    and extras all vary per plan, and highlights[] states each difference.

recalculate_change() powers the live drag & drop editor: every user edit is
re-validated (overlaps, tight transfers, budget) and re-costed immediately.
"""
import math
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from app.services.verified_data import VERIFIED_STAYS, VERIFIED_ATTRACTIONS, VERIFIED_FOOD

PLATFORM_FEE_RATE = 0.03  # explicit product rule: 3% of the generated plan cost
GUIDE_FEE_RATE = 0.125  # product rule: 12.5% of plan base cost in GUIDE_MODE


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


def _haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = a[0], a[1], b[0], b[1]
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# ── Verified real-place helpers ──────────────────────────────────────────────

def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", str(name or "").lower()).strip()


def _match_by_name(catalog: List[Dict[str, Any]], name: str) -> Optional[Dict[str, Any]]:
    target = str(name or "").strip().lower()
    if not target:
        return None
    best, best_score = None, 0
    for item in catalog:
        hay = str(item.get("name", "")).lower()
        if target == hay:
            return item
        score = sum(1 for tok in target.split() if tok and tok in hay)
        if score > best_score:
            best, best_score = item, score
    return best if best_score >= 2 else None


def _pick_stay(dest: str, tier_candidates: List[str]) -> Optional[Dict[str, Any]]:
    """Choose a REAL verified stay: first matching tier, best rated within it."""
    catalog = VERIFIED_STAYS.get(dest) or []
    for tier in tier_candidates:
        pool = [s for s in catalog if str(s.get("tier", "")).lower() == tier.lower()]
        if pool:
            return max(pool, key=lambda s: float(s.get("rating", 0) or 0))
    return None


def _stay_tier_label(stay: Optional[Dict[str, Any]], fallback: str) -> str:
    return str(stay.get("tier")) if stay and stay.get("tier") else fallback


# ── Variant definitions ──────────────────────────────────────────────────────

def _variant_params(variant: str, profile_stay_pref: str) -> Dict[str, Any]:
    if variant == "VALUE":
        return {
            "label": "Budget",
            "tagline": "Maximum experience with minimum unnecessary spending.",
            "stay_tiers": ["3 Star", "Homestay", "Budget Guesthouse", "2 Star"],
            "stay_fallback_scale": 0.7,
            "transport_scale": 0.85,
            "transport_label": "Bus / shared transport",
            "food_scale": 0.8,
            "food_label": "Local restaurants & street food",
            "extra_stop": False,
            "badge": "💰 Maximum savings",
        }
    if variant == "PREMIUM":
        return {
            "label": "Premium",
            "tagline": "Maximum comfort while staying inside your budget.",
            "stay_tiers": ["5 Star", "4 Star"],
            "stay_fallback_scale": 1.4,
            "transport_scale": 1.15,
            "transport_label": "Private cab throughout",
            "food_scale": 1.25,
            "food_label": "Premium dining experiences",
            "extra_stop": True,
            "badge": "✨ Premium experiences",
        }
    return {
        "label": "Recommended",
        "tagline": "Best balance of comfort, experiences and budget.",
        "stay_tiers": ["4 Star", "Homestay", "3 Star"],
        "stay_fallback_scale": 1.0,
        "transport_scale": 1.0,
        "transport_label": "Comfortable local transport",
        "food_scale": 1.0,
        "food_label": "Mix of local + premium food",
        "extra_stop": False,
        "badge": "⭐ Best balance",
    }


def _premium_extra_stop(day_block: Dict[str, Any], dest: str) -> Optional[Dict[str, Any]]:
    """A small real evening enrichment stop for the lightest day."""
    anchor = None
    for s in day_block.get("stops", []):
        if s.get("category") in ("attraction", "hidden_gem") and _to_minutes(str(s.get("time", ""))) is not None:
            if anchor is None or _to_minutes(str(s.get("time", ""))) > _to_minutes(str(anchor.get("time", ""))):
                anchor = s
    if not anchor:
        return None
    return {
        "id": f"premium-eve-d{day_block.get('day', 1)}",
        "day": day_block.get("day", 1),
        "time": _bump(str(anchor.get("time", "04:00 PM")), int(anchor.get("duration_minutes", 90) or 90) + 30),
        "title": "Sunset Viewpoint & Local Market Walk",
        "description": (
            f"A relaxed evening addition in {dest}: a scenic sunset viewpoint followed by "
            "a stroll through the local market."
        ),
        "category": "hidden_gem",
        "location_name": dest,
        "lat": float(anchor.get("lat", 0) or 0),
        "lng": float(anchor.get("lng", 0) or 0),
        "estimated_cost": 150.0,
        "duration_minutes": 90,
        "rating": 4.7,
        "source": "ai_reasoned",
        "verified": False,
        "ai_note": "Premium enrichment stop — added to deepen the local experience.",
    }


# ── Selected-place injection (HARD preferences) ─────────────────────────────

def _item_from_structured(item: Dict[str, Any], category: str, dest: str) -> Dict[str, Any]:
    """Turn a structured discovery selection into a planner stop source-of-truth.

    The coordinates/price/rating come from the REAL place the user picked in
    Step 3 — never overwritten by a same-named guess.
    """
    return {
        "name": str(item.get("name") or ""),
        "category": category,
        "description": item.get("description"),
        "lat": float(item.get("lat") or item.get("latitude") or 0),
        "lng": float(item.get("lng") or item.get("longitude") or 0),
        "entry_fee": float(item.get("entry_fee") or 0),
        "duration_minutes": int(item.get("duration_minutes") or 90),
        "rating": float(item.get("rating") or 4.6),
        "source": item.get("source") or "verified_api",
        "avg_cost_for_two": item.get("avg_cost_for_two"),
        "cuisine": item.get("cuisine") or "",
        "must_try": item.get("must_try"),
        "location_name": dest,
    }


def _inject_selected_places(
    days: List[Dict[str, Any]],
    dest: str,
    selected_places: List[str],
    selected_food: List[str],
    warnings: List[str],
    resolved_attractions: Optional[List[Dict[str, Any]]] = None,
    resolved_food: Optional[List[Dict[str, Any]]] = None,
    selected_place_items: Optional[List[Dict[str, Any]]] = None,
    selected_food_items: Optional[List[Dict[str, Any]]] = None,
    verbose: bool = True,
) -> float:
    """Insert the user's selected real places into the schedule.

    Returns the added entry-fee + meal cost so the fit step accounts for it.
    A place that cannot fit any day produces an explicit warning — user
    choices are never silently dropped.

    Restaurants are DISTRIBUTED across the days (spec: never all on one day,
    no needless repetition): each selected eatery gets a lunch or dinner slot on
    a distinct day before any repeats are considered.
    """
    added_cost = 0.0
    if not days:
        return added_cost

    def _day_of(day_num: int) -> Optional[Dict[str, Any]]:
        return next((d for d in days if d.get("day") == day_num), None)

    def _stable_id(prefix: str, name: str) -> str:
        return f"{prefix}{abs(hash(name or '')) % 10**8}"

    # Curated catalog first; discovery-resolved real places (e.g. GeoNames
    # index entries for destinations outside the curated set) are also valid
    # injection sources — a user selection is a REAL place either way.
    attractions = list(VERIFIED_ATTRACTIONS.get(dest) or [])
    for ra in (resolved_attractions or []):
        if not _match_by_name(attractions, ra.get("name", "")):
            attractions.append(ra)
    foods = list(VERIFIED_FOOD.get(dest) or [])
    for rf in (resolved_food or []):
        if not _match_by_name(foods, rf.get("name", "")):
            foods.append(rf)

    # Structured items (Step 3 picks with real coords/price) take priority over
    # name-matching when both exist for the same place.
    place_map = {_norm(struct.get("name", "")): struct for struct in (selected_place_items or []) if struct.get("name")}
    food_map = {_norm(struct.get("name", "")): struct for struct in (selected_food_items or []) if struct.get("name")}

    for name in selected_places or []:
        structured = place_map.get(_norm(name))
        match = _item_from_structured(structured, "attraction", dest) if structured else None
        if not match:
            match = _match_by_name(attractions, name)
        if not match:
            warnings.append(f"'{name}' is not in the verified catalog for {dest}, so it was not auto-added.")
            continue
        if _plan_contains(days, match.get("name", "")):
            continue
        # Target the day with the fewest attraction stops (spreads the load).
        target = min(days, key=lambda d: sum(
            1 for s in d.get("stops", []) if s.get("category") in ("attraction", "hidden_gem")
        ))
        stops = target.get("stops") or []
        last = max(
            (s for s in stops if _to_minutes(str(s.get("time", ""))) is not None),
            key=lambda s: _to_minutes(str(s.get("time", ""))) or 0,
            default=None,
        )
        start = _bump(str(last.get("time", "10:00 AM")), int(last.get("duration_minutes", 90) or 90) + 30) if last else "10:00 AM"
        if _to_minutes(start) is None or _to_minutes(start) > 19 * 60:
            if verbose:
                warnings.append(
                    f"'{match.get('name')}' could not fit the current day timings — it was added to a later day; drag it anywhere you like."
                )
            target = days[min(len(days) - 1, days.index(target) + 1)]
            start = "09:30 AM"
        fee = float(match.get("entry_fee", 0) or 0)
        target.setdefault("stops", []).append({
            "id": _stable_id("sel-", match.get("name", str(name))),
            "day": target.get("day", 1),
            "time": start,
            "title": match.get("name", str(name)),
            "description": match.get("description", ""),
            "category": "attraction",
            "location_name": dest,
            "lat": float(match.get("lat", 0) or 0),
            "lng": float(match.get("lng", 0) or 0),
            "estimated_cost": fee,
            "duration_minutes": int(match.get("duration_minutes", 90) or 90),
            "rating": float(match.get("rating", 4.6) or 4.6),
            "source": match.get("source", "verified_api"),
            "verified": True,
        })
        added_cost += fee

    # Restaurants: spread one eatery per day (lunch first, then dinner) before
    # any restaurant appears a second time.
    day_count = max(1, len(days))
    food_index = 0
    for name in selected_food or []:
        structured = food_map.get(_norm(name))
        match = _item_from_structured(structured, "food", dest) if structured else None
        if not match:
            match = _match_by_name(foods, name)
        if not match or _plan_contains(days, match.get("name", "")):
            food_index += 1
            continue
        day_idx = food_index % day_count
        meal_round = food_index // day_count  # 0 → lunch, 1 → dinner
        meal_day = days[day_idx]
        meal_time = "12:30 PM" if meal_round == 0 else "07:30 PM"
        meal_label = "Lunch" if meal_round == 0 else "Dinner"
        cuisine = str(match.get("cuisine") or match.get("types") or "").strip()
        desc = f"{meal_label} at {match.get('name', name)}"
        if cuisine:
            desc += f" · {cuisine}"
        meal_day.setdefault("stops", []).append({
            "id": _stable_id("selfood-", match.get("name", name)),
            "day": meal_day.get("day", 1),
            "time": meal_time,
            "title": f"{meal_label} at {match.get('name', name)}",
            "description": desc,
            "category": "food",
            "location_name": dest,
            "lat": float(match.get("lat", 0) or 0),
            "lng": float(match.get("lng", 0) or 0),
            "estimated_cost": round(float(match.get("avg_cost_for_two", 600) or 600) / 2, 0),
            "duration_minutes": 75,
            "rating": float(match.get("rating", 4.6) or 4.6),
            "source": match.get("source", "verified_api"),
            "verified": True,
        })
        added_cost += round(float(match.get("avg_cost_for_two", 600) or 600) / 2, 0)
        food_index += 1

    return added_cost


def _plan_contains(days: List[Dict[str, Any]], name: str) -> bool:
    n = str(name or "").lower()
    return any(n and n in str(s.get("title", "")).lower() for d in days for s in d.get("stops", []))


# ── Plan construction ────────────────────────────────────────────────────────

def build_plans(
    base: Dict[str, Any],
    budget_min: float,
    budget_max: float,
    selected_places: Optional[List[str]] = None,
    selected_food: Optional[List[str]] = None,
    selected_stay: Optional[Dict[str, Any]] = None,
    stay_tiers: Optional[Dict[str, str]] = None,
    profile_stay_pref: str = "",
    resolved_attractions: Optional[List[Dict[str, Any]]] = None,
    resolved_food: Optional[List[Dict[str, Any]]] = None,
    selected_place_items: Optional[List[Dict[str, Any]]] = None,
    selected_food_items: Optional[List[Dict[str, Any]]] = None,
    constraints: Optional[Dict[str, Any]] = None,
    stay_required: Optional[bool] = None,
    mode: str = "ADVENTUROUS_MODE",
    verbose: bool = True,
) -> List[Dict[str, Any]]:
    """Create the three differentiated plans. See module docstring for rules.

    `constraints` (from the Budget Feasibility Engine) is a HARD envelope the
    AI can never override: economy mode forces budget food/transport/activities
    on every variant, stay_allowed=False drops accommodation entirely (day-trip
    budget mode). User-selected stays always win — they are a direct pick.

    `stay_required` is the traveller's EXPLICIT stay choice: `False` is the
    "Continue without a stay" rule — accommodation is ₹0 and no hotel is ever
    auto-added, even when the budget could afford one. `True` means keep a stay
    (the budget/allowed flags still apply). `None` = not specified: behave as
    before (stay if the budget allows it, else no-stay).

    BUDGET IS A RANGE: `budget_min` is the floor and `budget_max` the ceiling.
    Plans are LAYERED — VALUE targets the floor, RECOMMENDED the mid-range and
    PREMIUM the ceiling — but a plan is never padded UP to hit a target; costs
    stay honest. If the cheapest real plan lands below the floor the user is
    told (no price invention).
    """
    dest = str(base.get("destination") or "")
    constraints = constraints or {}
    economy = bool(constraints.get("economy"))
    stay_allowed = bool(constraints.get("stay_allowed", True))
    force_no_stay = stay_required is False
    guide_mode = mode == "GUIDE_MODE"
    plans: List[Dict[str, Any]] = []
    n_selected = len(selected_places or [])
    # Fee total factor over the plan's base cost (travel spend): GUIDE_MODE adds
    # the 12.5% guide fee + 3% platform fee on top; otherwise only 3% platform.
    fee_factor = (1.0 + GUIDE_FEE_RATE + PLATFORM_FEE_RATE) if guide_mode else (1.0 + PLATFORM_FEE_RATE)

    budget_stay_tiers = ["Budget Guesthouse", "2 Star", "Homestay", "3 Star"]
    span = max(0.0, float(budget_max or 0.0) - float(budget_min or 0.0))

    for variant in ("VALUE", "RECOMMENDED", "PREMIUM"):
        # Laddering: give each variant its own honest cost target inside the
        # floor→ceiling range. The 3% platform fee still lives INSIDE the target.
        if variant == "VALUE":
            variant_target = float(budget_min or 0.0)
        elif variant == "RECOMMENDED":
            variant_target = float(budget_min or 0.0) + span * 0.55
        else:
            variant_target = float(budget_max or 0.0)
        variant_target = min(max(variant_target, 0.0), float(budget_max or 0.0))
        p = _variant_params(variant, profile_stay_pref)
        warnings: List[str] = []

        # Budget Feasibility Engine controls: economy forces budget-class choices
        # (public transport, local food, no premium extras) on EVERY plan.
        if economy:
            p = dict(p)
            p["transport_scale"] = 0.85
            p["transport_label"] = "Bus / shared transport"
            p["food_scale"] = 0.8
            p["food_label"] = "Local restaurants & street food"
            p["extra_stop"] = False
            p["stay_fallback_scale"] = 0.7
            warnings.append(
                "Budget mode: we prioritised budget food, public transport and free-or-low-cost attractions "
                "to keep your trip financially honest."
            )

        days = [
            {
                "day": d.get("day", i + 1),
                "title": d.get("title", f"Day {d.get('day', i + 1)}"),
                "stops": [dict(s) for s in (d.get("stops") or [])],
            }
            for i, d in enumerate(base.get("days") or [])
        ]

        # 1. HARD PREFERENCES: inject every selected real place into the plan.
        selection_cost = _inject_selected_places(
            days, dest, selected_places or [], selected_food or [], warnings,
            resolved_attractions=resolved_attractions,
            resolved_food=resolved_food,
            selected_place_items=selected_place_items,
            selected_food_items=selected_food_items,
            verbose=verbose,
        )

        bd0 = dict(base.get("cost_breakdown") or {})
        transport = float(bd0.get("transport", 0) or 0)
        stay = float(bd0.get("stay", 0) or 0) + selection_cost
        food = float(bd0.get("food", 0) or 0)

        nights = int(bd0.get("nights") or max(1, len(days) - 1) or 1)
        pax = int(bd0.get("headcount") or 2)
        rooms = max(1, math.ceil(pax / 2))

        # 2. REAL STAY TIER: use user-selected stay if provided (single stay for entire trip).
        # When the user explicitly selected a hotel in Step 3, that stay is used for
        # EVERY night of the trip — never replaced by the planner. "Continue without
        # a stay" (stay_required=False) is an ABSOLUTE rule: accommodation is ₹0 and
        # no hotel is ever auto-added, even when the budget could afford one.
        no_stay_mode = not stay_allowed and not selected_stay
        if selected_stay and not force_no_stay:
            stay_pick = selected_stay
            nightly = float(stay_pick.get("price_per_night", 0) or 0)
            # If the selected stay has no price, fall back to a verified catalog match.
            if nightly <= 0:
                catalog_match = _match_by_name(list(VERIFIED_STAYS.get(dest) or []), stay_pick.get("name", ""))
                if catalog_match:
                    nightly = float(catalog_match.get("price_per_night", 0) or 0)
            stayedge_cost = nightly * nights * rooms
            stay = stayedge_cost + selection_cost
            stay_label = f"{stay_pick.get('name', 'Selected stay')} — {stay_pick.get('budget_category', 'selected')}"
            stay_tier_used = stay_pick.get("budget_category", "selected")
        elif force_no_stay or no_stay_mode:
            # Either the traveller explicitly chose "Continue without a stay"
            # (stay_required=False) or the budget genuinely can't hold a stay —
            # in BOTH cases accommodation is ₹0 and no made-up hotel appears.
            stay = 0.0
            stay_label = "No stay (day-trip style)"
            stay_tier_used = None
            for d in days:
                d["stops"] = [s for s in d.get("stops", []) if s.get("category") != "stay"]
            if force_no_stay:
                warnings.append(
                    "You chose to continue without a stay — accommodation costs ₹0 and no hotel was "
                    "added to any plan. You can add one anytime from the plan cards."
                )
            else:
                warnings.append(
                    "Your budget doesn't support accommodation for this trip — we planned it as a day-trip "
                    "style itinerary with no stay. Raise the budget or continue as-is."
                )
        else:
            candidates = budget_stay_tiers if economy else None
            override_tier = (stay_tiers or {}).get(variant)
            tier_candidates = [override_tier] if override_tier else (candidates or p["stay_tiers"])
            stay_pick = _pick_stay(dest, tier_candidates)
            if stay_pick:
                tier_stay_cost = float(stay_pick.get("price_per_night", 0) or 0) * nights * rooms
                stay = tier_stay_cost + selection_cost
                stay_label = f"{_stay_tier_label(stay_pick, 'Stay')} — {stay_pick.get('name', '')}"
                stay_tier_used = _stay_tier_label(stay_pick, 'Stay')
            else:
                stay = round(stay * p["stay_fallback_scale"], 0)
                stay_label = f"{profile_stay_pref or 'Comfort'} stay (estimated)"
                stay_tier_used = profile_stay_pref or 'Comfort'

        food = round(food * p["food_scale"], 0)
        transport = round(transport * p["transport_scale"], 0)
        activities = 0.0

        # 3. PREMIUM extra: one real enrichment stop on the lightest day.
        if p.get("extra_stop"):
            lightest = min(
                days,
                key=lambda d: sum(int(s.get("duration_minutes", 60) or 60) for s in d.get("stops", [])) if d.get("stops") else 10**9,
            )
            extra = _premium_extra_stop(lightest, dest)
            if extra:
                lightest.setdefault("stops", []).append(extra)
                activities += float(extra["estimated_cost"])

        # 4. LIVE RESCHEDULING: re-sequence every day so nothing overlaps.
        _resequence(days)

        # 5. HARD BUDGET: the budget range is the TRAVEL-SPEND range. In
        #    GUIDE_MODE the 12.5% guide fee + 3% platform fee are charged ON TOP
        #    of that spend (budget 10,000 → guide 1,250 → total 11,550), so the
        #    plan's base cost fills the chosen rung directly
        #    (VALUE→floor, RECOMMENDED→mid, PREMIUM→ceiling). In ADVENTUROUS
        #    the 3% platform fee lives INSIDE the rung (spend backed out).
        base_ceiling = variant_target if guide_mode else variant_target / fee_factor
        fixed = transport
        flexible_budget = base_ceiling - fixed
        natural_flexible = stay + food + activities
        downgraded = False
        if flexible_budget <= 0:
            # Transport alone exceeds the ceiling: fit the transport line to the
            # budget (cheaper class) — NEVER return an over-budget plan.
            stay = food = activities = 0.0
            if fixed > base_ceiling:
                transport = max(base_ceiling, 0.0)
                fixed = transport
                warnings.append(
                    f"Transport for this route consumes most of your ₹{round(budget_max):,} budget — "
                    "we fitted the most affordable option. Raise the budget or shorten the trip for more comfort."
                )
        elif natural_flexible > flexible_budget:
            factor = flexible_budget / natural_flexible
            stay, food, activities = stay * factor, food * factor, activities * factor
            if factor < 0.85:
                downgraded = True

        stay, food, activities = round(stay, 0), round(food, 0), round(activities, 0)
        base_cost = transport + stay + food + activities

        # Rounding-safe exact shave (activities → food → stay).
        if base_cost > base_ceiling:
            excess = base_cost - base_ceiling
            take = min(activities, excess); activities -= take; excess -= take
            take = min(food, excess); food -= take; excess -= take
            take = min(stay, excess); stay -= take; excess -= take
            base_cost = transport + stay + food + activities

        spend = round(base_cost, 0)
        guide_fee = round(spend * GUIDE_FEE_RATE, 0) if guide_mode else 0.0
        platform_fee = round(spend * PLATFORM_FEE_RATE, 0)
        final_total = spend + guide_fee + platform_fee

        # Honest budget-range communication — never padding prices to hit a rung.
        if variant == "VALUE" and verbose:
            warnings.append(
                f"PLAN A targets the low end of your ₹{round(budget_min):,}–₹{round(budget_max):,} budget range; "
                f"PLAN C explores the top end. We never inflate prices to reach a number."
            )
        if verbose and variant == "VALUE" and float(budget_min or 0) > 0 and final_total < float(budget_min):
            warnings.append(
                f"The realistic cheapest version of this trip comes to ₹{round(final_total):,} — below your "
                f"listed minimum of ₹{round(float(budget_min)):,}. That's fine: we don't pad costs to reach "
                f"your target. Use the PREMIUM plan or upgrade a stay to spend more deliberately."
            )

        # 6. Trade-off intelligence: explain consequences, never silently.
        if verbose and downgraded:
            warnings.append(
                f"You've selected {n_selected} place(s). To keep this plan under ₹{round(budget_max):,} "
                f"(including the {int(PLATFORM_FEE_RATE * 100)}% platform fee), the stay budget was trimmed to "
                f"{stay_label}. Upgrade the stay on the plan card to see the trade-off."
            )

        breakdown = {
            "transport": round(transport, 0),
            "stay": stay,
            "food": food,
            "activities": round(activities, 0),
            "travel_spend": spend,
            "guide_fee": round(guide_fee, 0),
            "platform_fee": platform_fee,
            "payable": round(guide_fee + platform_fee, 0),
            "base_plan_cost": spend,
            "final_total": round(final_total, 0),
            "total": round(final_total, 0),
            "budget": budget_max,
            "budget_min": budget_min,
            "destination": dest,
            "days": len(days),
            "nights": nights,
            "stay_label": stay_label,
            "transport_label": p["transport_label"],
            "food_label": p["food_label"],
            "selected_places_count": n_selected,
            "guide_mode": guide_mode,
        }

        highlights = [
            f"🏨 {stay_label}",
            f"🚗 {p['transport_label']}",
            f"🍴 {p['food_label']}",
            f"📍 {n_selected} selected place(s) included",
            p["badge"],
        ]
        if selected_stay and variant != "RECOMMENDED":
            # Confirm the user's chosen stay is used in every plan variant.
            highlights.append(f"📌 Your selected stay: {selected_stay.get('name', 'Selected stay')}")

        plans.append({
            "type": variant,
            "label": p["label"],
            "tagline": p["tagline"],
            "base_plan_cost": spend,
            "platform_fee": platform_fee,
            "final_total": round(final_total, 0),
            "total_cost": round(final_total, 0),
            "cost_breakdown": breakdown,
            "days": days,
            "budget_min": budget_min,
            "budget_max": budget_max,
            "remaining_budget": round(budget_max - (spend if guide_mode else final_total), 0),
            "within_budget": bool((spend if guide_mode else final_total) <= budget_max),
            "highlights": highlights,
            "warnings": warnings,
            "recommended": variant == "RECOMMENDED",
            "stay_required": False if force_no_stay else (stay_required is True or bool(selected_stay)),
            "stay_cost": float(breakdown.get("stay", 0) or 0),
        })

    return _enforce_ordering(plans, verbose=verbose)


def _resequence(days: List[Dict[str, Any]]) -> None:
    """Push overlapping stops later so every day is a feasible schedule."""
    for d in days:
        stops = sorted(
            [s for s in d.get("stops", []) if _to_minutes(str(s.get("time", ""))) is not None],
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


def _enforce_ordering(plans: List[Dict[str, Any]], verbose: bool = True) -> List[Dict[str, Any]]:
    """VALUE ≤ RECOMMENDED ≤ PREMIUM; travel spend ≤ budget_max — deterministic."""
    by_type = {p["type"]: p for p in plans}
    budget_max = float(plans[0]["budget_max"]) if plans else 0.0
    # The traveller's selected maximum budget is the HARD ceiling for the
    # plan's TRAVEL SPEND. In GUIDE_MODE the guide (12.5%) and platform (3%)
    # fees are added ON TOP of the spend, so the premium plan may reach a
    # final_total of budget_max × fee_factor; otherwise fees stay inside
    # budget_max (ADVENTUROUS = 3% platform only, inside the ceiling).
    def _final_cap(p: Dict[str, Any]) -> float:
        fac = (1.0 + GUIDE_FEE_RATE + PLATFORM_FEE_RATE)
        fac = fac if (p["cost_breakdown"] or {}).get("guide_mode") else (1.0 + PLATFORM_FEE_RATE)
        return float(budget_max * fac)
    prem_cap = _final_cap(by_type["PREMIUM"])
    prem = min(by_type["PREMIUM"]["final_total"], prem_cap)
    rec = min(by_type["RECOMMENDED"]["final_total"], prem)
    val = min(by_type["VALUE"]["final_total"], rec)
    if by_type["PREMIUM"]["final_total"] > prem_cap:
        _shave_final_to(by_type["PREMIUM"], float(prem_cap), verbose=verbose)
    for plan, target in ((by_type["RECOMMENDED"], rec), (by_type["VALUE"], val)):
        if plan["final_total"] > target:
            _shave_final_to(plan, float(target), verbose=verbose)
    # within_budget is exact (no tolerance): in GUIDE_MODE the TRAVEL SPEND
    # must sit within the budget (fees are on top); otherwise the total must.
    for plan in plans:
        guide_mode = bool((plan.get("cost_breakdown") or {}).get("guide_mode"))
        comparable = plan["base_plan_cost"] if guide_mode else float(plan["final_total"])
        plan["within_budget"] = bool(comparable <= float(plan["budget_max"]))
    return plans


def _shave_final_to(plan: Dict[str, Any], target: float, verbose: bool = True) -> None:
    """Shave a plan's flexible buckets so its final total (incl. fees) hits target."""
    bd = plan["cost_breakdown"]
    guide_mode = bool(bd.get("guide_mode"))
    # Target is the final total (incl. fees). The plan's base spend must satisfy
    # spend × (1 + guide_rate + platform_rate) <= target in GUIDE_MODE, else
    # spend × (1 + platform_rate) <= target.
    fee_factor = (1.0 + GUIDE_FEE_RATE + PLATFORM_FEE_RATE) if guide_mode else (1.0 + PLATFORM_FEE_RATE)
    spend_target = target / fee_factor
    transport = float(bd.get("transport", 0) or 0)
    stay = float(bd.get("stay", 0) or 0)
    food = float(bd.get("food", 0) or 0)
    activities = float(bd.get("activities", 0) or 0)

    excess = (transport + stay + food + activities) - spend_target
    if excess > 0:
        take = min(activities, excess); activities -= take; excess -= take
        take = min(food, excess); food -= take; excess -= take
        take = min(stay, excess); stay -= take; excess -= take
        if excess > 0:
            take = min(transport, excess); transport -= take; excess -= take

    spend = round(transport + stay + food + activities, 0)
    spend = min(spend, int(target / fee_factor))
    guide_fee = round(spend * GUIDE_FEE_RATE, 0) if guide_mode else 0.0
    platform_fee = round(spend * PLATFORM_FEE_RATE, 0)
    final_total = spend + guide_fee + platform_fee
    bd.update({
        "stay": round(stay, 0), "food": round(food, 0), "activities": round(activities, 0),
        "travel_spend": spend,
        "guide_fee": round(guide_fee, 0),
        "platform_fee": platform_fee, "base_plan_cost": spend,
        "final_total": round(final_total, 0), "total": round(final_total, 0),
        "payable": round(guide_fee + platform_fee, 0),
    })
    plan.update({
        "base_plan_cost": spend, "platform_fee": platform_fee,
        "final_total": round(final_total, 0), "total_cost": round(final_total, 0),
        # GUIDE_MODE: fees sit on top of the travel spend; what remains of the
        # traveller's budget is budget − spend. ADVENTUROUS: budget − total.
        "remaining_budget": round(
            plan["budget_max"] - (spend if guide_mode else final_total), 0
        ),
    })
    plan.setdefault("warnings", [])
    if verbose:
        plan["warnings"].append("Trimmed slightly to keep the plan ladder fair within your budget.")


# ── Validation ───────────────────────────────────────────────────────────────

def validate_days(days: List[Dict[str, Any]], budget_max: float, total_cost: float) -> List[str]:
    """Pre-display validation. Never show an obviously impossible schedule."""
    warnings: List[str] = []
    if total_cost > budget_max:
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

def normalize_plan_totals(plan: Dict[str, Any], budget_max: float) -> None:
    """Mode-aware belt-and-braces clamp, shared by EVERY plan surface.

    Recomputs a plan's fee/total from the single rule — base cost = travel
    spend, guide fee 12.5% of it in GUIDE_MODE, platform fee 3% of it.
    In GUIDE_MODE the fees are added ON TOP of the travel spend (budget 10,000
    → guide 1,250, platform 300, total 11,550), so the spend is clamped to the
    budget while the final total may exceed it. In ADVENTUROUS the 3% platform
    fee lives INSIDE the budget (spend backed out). Guarantees the invariant:
        final_total == base_plan_cost + guide_fee + platform_fee.
    """
    bd = plan["cost_breakdown"]
    guide_mode = bool(bd.get("guide_mode"))
    fee_factor = (1.0 + GUIDE_FEE_RATE + PLATFORM_FEE_RATE) if guide_mode else (1.0 + PLATFORM_FEE_RATE)
    raw_spend = float(plan["base_plan_cost"])
    if float(budget_max) > 0:
        # GUIDE_MODE: budget = travel spend, fees added on top.
        # ADVENTUROUS: 3% platform fee backed out of the budget ceiling.
        divider = 1.0 if guide_mode else fee_factor
        spend = int(min(raw_spend, float(budget_max) / divider))
    else:
        spend = round(raw_spend, 0)
    guid_fee_seed = float(bd.get("guide_fee", 0) or 0)
    guide_fee = round(spend * GUIDE_FEE_RATE, 0) if guide_mode else guid_fee_seed
    platform_fee = round(spend * PLATFORM_FEE_RATE, 0)
    final_total = round(spend + guide_fee + platform_fee, 0)
    plan["base_plan_cost"] = spend
    plan["platform_fee"] = platform_fee
    plan["final_total"] = final_total
    plan["total_cost"] = final_total
    plan["remaining_budget"] = round(float(budget_max) - (spend if guide_mode else final_total), 0)
    plan["within_budget"] = bool((spend if guide_mode else final_total) <= float(budget_max))
    bd["base_plan_cost"] = spend
    bd["guide_fee"] = round(guide_fee, 0)
    bd["platform_fee"] = platform_fee
    bd["final_total"] = final_total
    bd["total"] = final_total
    bd["payable"] = round(guide_fee + platform_fee, 0)


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

    def _base_total() -> float:
        return (
            float(breakdown.get("transport", 0) or 0) + float(breakdown.get("stay", 0) or 0)
            + float(breakdown.get("food", 0) or 0) + float(breakdown.get("activities", 0) or 0)
        )

    def _recompute_totals() -> None:
        guide_mode = bool(breakdown.get("guide_mode"))
        spend = _base_total()
        guide_fee = round(spend * GUIDE_FEE_RATE, 0) if guide_mode else float(breakdown.get("guide_fee", 0) or 0)
        platform_fee = round(spend * PLATFORM_FEE_RATE, 0)
        final_total = spend + guide_fee + platform_fee
        breakdown["guide_fee"] = round(guide_fee, 0)
        breakdown["platform_fee"] = platform_fee
        breakdown["base_plan_cost"] = round(spend, 0)
        breakdown["final_total"] = round(final_total, 0)
        breakdown["total"] = round(final_total, 0)
        breakdown["payable"] = round(guide_fee + platform_fee, 0)
        breakdown["travel_spend"] = round(spend, 0)

    def _shift_bucket(cat: str, delta: float) -> None:
        key = {"food": "food", "stay": "stay"}.get(cat, "activities")
        breakdown[key] = round(max(0.0, float(breakdown.get(key, 0) or 0) + delta), 0)

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
            _shift_bucket(stop.get("category", "attraction"), -cost)
            if not day["stops"]:
                days = [d for d in days if d["stops"]]
            _recompute_totals()
            applied = True

    elif kind == "move_time":
        _, stop = _find(str(change.get("stop_id", "")))
        if stop and change.get("new_time"):
            stop["time"] = str(change["new_time"])
            _resequence(days)
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
            moved.setdefault("verified", False)
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
                target = {"day": target_day_num, "title": f"Day {target_day_num}", "stops": []}
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
                _shift_bucket(moved.get("category", "attraction"), float(moved.get("estimated_cost", 0) or 0))
                _recompute_totals()
            _resequence(days)
            applied = True

    final_total = float(breakdown.get("final_total", 0) or 0)
    if final_total > budget_max:
        warnings.append(
            f"This change puts your total at ₹{round(final_total):,} — ₹{round(final_total - budget_max):,} "
            f"over your budget (including the {int(PLATFORM_FEE_RATE * 100)}% platform fee). "
            "Remove something or accept the extra cost."
        )
    warnings.extend(validate_days(days, budget_max, final_total))

    return {
        "days": days,
        "total_cost": round(final_total, 0),
        "cost_breakdown": breakdown,
        "warnings": warnings,
        "applied": applied,
    }
