"""Multi-plan itinerary engine (v2).

The user's preferences + selected places are the source of truth; the AI
optimizes around them and never replaces them. Budget is a HARD constraint.

Given a base verified/estimate plan and the traveller's selections, produces
exactly three differentiated in-budget variants:

  PLAN A — VALUE        cheapest real stay tier, economical transport, local food
  PLAN B — RECOMMENDED  best balance (highlighted RECOMMENDED FOR YOU)
  PLAN C — PREMIUM      richest real stay tier, private transport, premium dining

Hard rules enforced here (server-side, never just UI):
  * FINAL PLANNED AMOUNT (spec §23-26): every mode prices
    final_total = base + guide_fee (12.5% GUIDE_MODE only) + platform_fee
    (3% ALWAYS) + safety_reserve (15% ALWAYS) + insurance (₹50 fixed,
    every booking) — fees stack ON TOP of the base travel spend, never
    hidden inside it. No card may show platform fee ₹0 unless the base is
    genuinely ₹0.
  * safety_reserve is RESERVED funds for emergencies — shown as its own
    line, never silently merged into another amount or allocated to
    fake bookings.
  * Meal windows (breakfast 07:00–10:30, lunch 12:00–15:00, snacks
    15:30–18:00, dinner 19:00–22:00) are enforced on every day where the
    trip hours allow: real selected restaurants keep their slots; generic
    meal holds are inserted when a window is otherwise missed.
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

PLATFORM_FEE_RATE = 0.03  # explicit product rule: 3% of the base trip cost, ALWAYS
GUIDE_FEE_RATE = 0.125  # product rule: 12.5% of base trip cost in GUIDE_MODE only
SAFETY_RESERVE_RATE = 0.15  # product rule: 15% of base trip cost, ALWAYS reserved
INSURANCE_FEE = 50.0  # fixed ₹50 insurance in EVERY booking (TRAVION Refund Protection)

# Realistic meal windows (minutes from midnight) — spec §9 defaults.
MEAL_WINDOWS = [
    ("Breakfast", 7 * 60, 10 * 60 + 30),
    ("Lunch", 12 * 60, 15 * 60),
    ("Snacks", 15 * 60 + 30, 18 * 60),
    ("Dinner", 19 * 60, 22 * 60),
]


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


def _meal_label_from_minutes(m: int) -> str:
    """Minute-of-day → 'h:mm AM/PM' meal-hold label ('12:30 PM')."""
    return _from_minutes(m)


def _free_slot(intervals: List[Tuple[int, int]], lo: int, hi: int, need: int) -> Optional[int]:
    """Earliest t in [lo, hi-need] where [t, t+need) intersects no interval."""
    t = lo
    for a, b in sorted(intervals):
        if b <= t:
            continue
        if a - t >= need:
            return t
        t = max(t, b)
        if t + need > hi:
            return None
    return t if t + need <= hi else None


def _insert_missing_meal_stops(days: List[Dict[str, Any]]) -> int:
    """Guarantee every travel day's meals land INSIDE their realistic windows
    (spec §8/§9) without touching real selected restaurants.

    For each day and each meal window (breakfast 07:00–10:30, lunch
    12:00–15:00, snacks 15:30–18:00, dinner 19:00–22:00):
      1. A real restaurant stop (category 'food') already inside the window
         satisfies it — untouched, exactly where the traveller chose it.
      2. Otherwise a clearly-labelled meal hold ('Lunch — local cuisine') is
         placed in a genuinely FREE gap (duration-aware — never overlapping an
         existing stop, so validate_days stays clean) inside the window.
         A window with no free slot is skipped — a missing meal hold is better
         than an impossible schedule that blocks checkout.
    Meal holds are anchored geographically to the stop immediately before them
    so travel-time validation remains realistic (never (0,0)).
    Returns the number of holds inserted (informational).
    """
    inserted = 0
    seen_holds: set = set()
    HOLD_MIN = 45
    DAY_FLOOR = DAY_START_FLOOR_MINUTES  # day never begins before 08:00
    for d in days:
        parseable = [s for s in (d.get("stops") or [])
                     if _to_minutes(str(s.get("time", ""))) is not None]
        unparseable = [s for s in (d.get("stops") or [])
                       if _to_minutes(str(s.get("time", ""))) is None]
        if not parseable:
            continue
        day_num = int(d.get("day", 0) or 0)
        parseable.sort(key=lambda s: _to_minutes(str(s.get("time", ""))) or 0)

        def _sm(s: Dict[str, Any]) -> int:
            return _to_minutes(str(s.get("time", ""))) or 0

        # Occupied intervals [start, end) — includes meal holds as we add them.
        intervals: List[Tuple[int, int]] = [
            (_sm(s), _sm(s) + int(s.get("duration_minutes", 60) or 60))
            for s in parseable
        ]
        food_in_window = {label: False for label, _, _ in MEAL_WINDOWS}
        for s in parseable:
            if str(s.get("category", "")).lower() != "food":
                continue
            for label, lo, hi in MEAL_WINDOWS:
                if lo <= _sm(s) <= hi:
                    food_in_window[label] = True

        new_holds: List[Dict[str, Any]] = []
        for label, lo, hi in MEAL_WINDOWS:
            if food_in_window[label]:
                continue
            hold_key = (day_num, label.lower())
            already = hold_key in seen_holds or any(
                str(s.get("id", "")).startswith("meal-")
                and str(s.get("title", "")).lower().startswith(label.lower())
                for s in parseable
            )
            if already:
                continue
            t = _free_slot(intervals, max(lo, DAY_FLOOR), hi, HOLD_MIN)
            if t is None:
                continue  # window genuinely full — skip, never overlap
            seen_holds.add(hold_key)
            # Anchor the hold geographically to the stop immediately before it
            # (or the first stop) so travel checks stay realistic.
            before = [s for s in parseable + new_holds if _sm(s) <= t]
            anchor = before[-1] if before else (parseable[0] if parseable else None)
            if anchor is not None:
                try:
                    a_lat = float(anchor.get("lat", 0) or 0)
                    a_lng = float(anchor.get("lng", 0) or 0)
                except Exception:
                    a_lat, a_lng = 0.0, 0.0
            else:
                a_lat, a_lng = 0.0, 0.0
            if abs(a_lat) < 0.01 and abs(a_lng) < 0.01:
                a_lat, a_lng = 0.0, 0.0
            hold = {
                "id": f"meal-{day_num}-{label.lower()}",
                "day": day_num or 1,
                "time": _meal_label_from_minutes(t),
                "title": f"{label} — local cuisine",
                "description": (
                    f"{label} break near the day's route. Add a real restaurant "
                    "from discovery to fill this slot."
                ),
                "category": "meal_hold",
                "location_name": str((anchor or {}).get("location_name", "") or d.get("title", "") or ""),
                "lat": a_lat,
                "lng": a_lng,
                "estimated_cost": 0,
                "duration_minutes": HOLD_MIN,
                "source": "meal_window",
                "verified": False,
            }
            new_holds.append(hold)
            intervals.append((t, t + HOLD_MIN))
            inserted += 1
        if new_holds:
            parseable.extend(new_holds)
            parseable.sort(key=lambda s: _sm(s))
            d["stops"] = parseable + unparseable
    return inserted

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

# SPEC 10/12 - DESTINATION GEO-FENCING. A destination anchor comes from the
# trip's real location row (dest_coords in build_plans callers); every stop
# entering an itinerary must sit inside a sane radius of that anchor (300 km
# covers day-trips and regional excursions, rejects other states/countries)
# and never at null-island (0,0). Missing coordinates are as invalid as wrong
# ones.
DESTINATION_MAX_RADIUS_KM = 300.0


def validate_place_for_destination(
    place: Dict[str, Any],
    dest_coords,
    max_radius_km: float = DESTINATION_MAX_RADIUS_KM,
):
    """Reusable boundary validation (spec 12). Returns (ok, reason).

    Verifies: finite non-null latitude/longitude, off null-island, within
    max_radius_km of the destination anchor. dest_coords=None (anchor
    unknown) still rejects null-island/missing/out-of-range coordinates.
    """
    try:
        lat = float(place.get("lat", 0) or 0)
        lng = float(place.get("lng", 0) or 0)
    except (TypeError, ValueError):
        return False, "missing coordinates"
    if not (math.isfinite(lat) and math.isfinite(lng)):
        return False, "non-finite coordinates"
    if abs(lat) < 0.01 and abs(lng) < 0.01:
        return False, "null-island (0,0) coordinates"
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return False, "out-of-range coordinates"
    if dest_coords is not None:
        km = _haversine_km((lat, lng), (float(dest_coords[0]), float(dest_coords[1])))
        if km > max_radius_km:
            return False, f"{round(km):,} km outside the destination boundary"
    return True, ""


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
    dest_coords=None,
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

    # Tracks how many times each selected place has been scheduled so spread
    # across days is positional (selection order → distinct days) — a place is
    # only re-scheduled after every other selection has had its day.
    _place_rounds: Dict[str, int] = {}

    def _day_of(day_num: int) -> Optional[Dict[str, Any]]:
        return next((d for d in days if d.get("day") == day_num), None)

    def _stable_id(prefix: str, name: str) -> str:
        return f"{prefix}{abs(hash(name or '')) % 10**8}"

    # Curated catalog first; discovery-resolved real places (e.g. GeoNames
    # index entries for destinations outside the curated set) are also valid
    # injection sources — a user selection is a REAL place either way.
    def _in_boundary(item: Dict[str, Any]) -> bool:
        ok, reason = validate_place_for_destination(item, dest_coords)
        return ok

    attractions = [a for a in (VERIFIED_ATTRACTIONS.get(dest) or []) if _in_boundary(a)]
    for ra in (resolved_attractions or []):
        if not _match_by_name(attractions, ra.get("name", "")) and _in_boundary(ra):
            attractions.append(ra)
        elif not _match_by_name(attractions, ra.get("name", "")):
            if verbose:
                warnings.append(
                    f"'{ra.get('name', 'A resolved place')}' lies outside the {dest} area and was left out of the plan."
                )
    foods = [f for f in (VERIFIED_FOOD.get(dest) or []) if _in_boundary(f)]
    for rf in (resolved_food or []):
        if not _match_by_name(foods, rf.get("name", "")) and _in_boundary(rf):
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
        # Each selected place is scheduled ONCE on a distinct day, spreading
        # across days in order (5 selected places over 5 days → one per day).
        # Repeats only occur after the traveller's selections are exhausted —
        # user choices are never duplicated while unused picks remain.
        attraction_round = _place_rounds.get(match.get("name", ""), 0)
        target = days[min(attraction_round % len(days), len(days) - 1)]
        _place_rounds[match.get("name", "")] = attraction_round + 1
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
        ok, reason = validate_place_for_destination(match, dest_coords)
        if not ok:
            if verbose:
                warnings.append(f"'{match.get('name', name)}' could not be placed: {reason}.")
            continue
        target.setdefault("stops", []).append({
            "id": _stable_id("sel-", match.get("name", str(name))),
            "day": target.get("day", 1),
            "time": start,
            "title": match.get("name", str(name)),
            "description": match.get("description", ""),
            "category": "attraction",
            "location_name": match.get("location_name") or dest,
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
    first_day_start: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Create the three differentiated plans. See module docstring for rules.

    `constraints` (from the Budget Feasibility Engine) is a HARD envelope the
    AI can never override: economy mode forces budget food/transport/activities
    on every variant, stay_allowed=False drops accommodation entirely (day-trip
    budget mode). User-selected stays always win — they are a direct pick.

    `stay_required` is the traveller's EXPLICIT stay choice: `False` is the
    "Continue without a stay" rule — accommodation is ₹0 and no hotel is ever
    auto-added, even when the budget could afford one. `True` means keep a stay

    `first_day_start` (e.g. "04:00 PM") is the trip's real start time on Day 1:
    no Day-1 stop may be scheduled earlier (PART U). Other days start at 08:00
    at the earliest (PART V).
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
    # FINAL PLANNED AMOUNT factor over the plan's base cost (travel spend):
    # fees stack ON TOP in EVERY mode (spec §23-26) — GUIDE_MODE adds the
    # 12.5% guide fee, the 3% platform + 15% safety reserve apply always, and
    # the fixed ₹50 insurance sits on every booking.
    fee_factor = (1.0 + GUIDE_FEE_RATE + PLATFORM_FEE_RATE + SAFETY_RESERVE_RATE) if guide_mode \
        else (1.0 + PLATFORM_FEE_RATE + SAFETY_RESERVE_RATE)

    budget_stay_tiers = ["Budget Guesthouse", "2 Star", "Homestay", "3 Star"]
    span = max(0.0, float(budget_max or 0.0) - float(budget_min or 0.0))

    for variant in ("VALUE", "RECOMMENDED", "PREMIUM"):
        # Laddering: give each variant its own honest cost target inside the
        # floor→ceiling range. Targets are FINAL-PLANNED-AMOUNT targets (spec:
        # remaining = budget − final, so the final amount must fit the budget).
        # The base travel spend that produces that final amount is derived by
        # inverting the fee stack (final = base × fee_factor + insurance).
        if variant == "VALUE":
            variant_target = float(budget_min or 0.0)
        elif variant == "RECOMMENDED":
            variant_target = float(budget_min or 0.0) + span * 0.55
        else:
            variant_target = float(budget_max or 0.0)
        variant_target = min(max(variant_target, 0.0), float(budget_max or 0.0))
        variant_base_target = max(0.0, (variant_target - INSURANCE_FEE) / fee_factor)
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

        # SPEC §10/§31 — the itinerary carries ONLY destination-valid stops.
        # Anything failing the boundary check is dropped with a visible note
        # (never a silent change, never an out-of-region stop on the map).
        geo_anchor = base.get("dest_coords")
        if geo_anchor is not None:
            dropped = 0
            for d in days:
                kept_stops = []
                for s in d.get("stops") or []:
                    ok, reason = validate_place_for_destination(s, geo_anchor)
                    if ok:
                        kept_stops.append(s)
                    else:
                        dropped += 1
                        warnings.append(
                            f"'{s.get('title', 'A stop')}' was left out — {reason}."
                        )
                d["stops"] = kept_stops
            if dropped:
                warnings.append(
                    f"{dropped} stop(s) outside the {dest} destination boundary were removed."
                )

        # 1. HARD PREFERENCES: inject every selected real place into the plan.
        selection_cost = _inject_selected_places(
            days, dest, selected_places or [], selected_food or [], warnings,
            resolved_attractions=resolved_attractions,
            resolved_food=resolved_food,
            selected_place_items=selected_place_items,
            selected_food_items=selected_food_items,
            dest_coords=base.get("dest_coords"),
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
                    stay_pick = {**stay_pick, "price_per_night": nightly}
            # SPEC §5 — a selected REAL stay must NEVER silently cost ₹0.
            # Live-discovered properties (GeoApify) carry no verified nightly
            # rate; instead of shipping a false "Stay ₹0" line we price from
            # the stay's stated budget tier (verified rate bands) and tell the
            # traveller transparently. Only a genuine "Continue without a
            # stay" (handled above) can produce ₹0 accommodation.
            if nightly <= 0 and stay_pick.get("budget_category"):
                from app.services.india_planner import STAY_TIERS
                tier_words = str(stay_pick["budget_category"]).lower()
                tier = next((t for t in STAY_TIERS if any(w in tier_words for w in t["words"])), None)
                if tier:
                    nightly = round((float(tier["lo"]) + float(tier["hi"])) / 2.0, 0)
                    stay_pick = {**stay_pick, "price_per_night": nightly}
                    warnings.append(
                        f"Your selected stay '{stay_pick.get('name', '')}' doesn't publish a verified nightly rate "
                        f"— we estimated ₹{round(nightly):,}/night from its {tier['label']} class. "
                        "Pick a verified stay to lock an exact price."
                    )
            if nightly <= 0:
                nightly = 1500.0  # Homestay/Guesthouse band midpoint — labelled estimate
                stay_pick = {**stay_pick, "price_per_night": nightly}
                warnings.append(
                    f"No verified rate for '{stay_pick.get('name', '')}' — an economy ₹1,500/night "
                    "estimate is used so your budget stays honest. Swap in a verified stay for an exact price."
                )
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

        # 4. LIVE RESCHEDULING: re-sequence every day so nothing overlaps, then
        #    enforce the hard chronology floor (Day 1 >= the trip's real start
        #    time, travel-time gaps between stops) — the 4 PM → 8:30 AM bug is
        #    made impossible here, server-side, for EVERY plan variant.
        _resequence(days)
        # HARD TRIP-LENGTH RULE: the plan may never grow days beyond the trip's
        # real duration — overflow on the final day compresses into evening
        # hours or is dropped with a visible note, never a phantom Day N+1.
        chronology_notes = enforce_chronology(
            days, first_day_start=first_day_start, max_day=len(days),
        )
        if chronology_notes:
            warnings.extend(chronology_notes[:3])

        # 5. HARD BUDGET: the budget range is the TRAVEL-SPEND range in every
        #    mode. Fees (12.5% guide in GUIDE_MODE; 3% platform + 15% safety
        #    reserve always) stack ON TOP of that spend (spec §23-26), so the
        #    plan's base cost fills the chosen rung directly
        #    (VALUE→floor, RECOMMENDED→mid, PREMIUM→ceiling) and the final
        #    planned amount is spend × fee_factor.
        base_ceiling = variant_base_target
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
        safety_reserve = round(spend * SAFETY_RESERVE_RATE, 0)
        insurance_fee = INSURANCE_FEE
        final_total = spend + guide_fee + platform_fee + safety_reserve + insurance_fee

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
            "safety_reserve": safety_reserve,
            "insurance_fee": insurance_fee,
            "payable": round(final_total, 0),
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
            "safety_reserve": safety_reserve,
            "insurance_fee": insurance_fee,
            "final_total": round(final_total, 0),
            "total_cost": round(final_total, 0),
            "cost_breakdown": breakdown,
            "days": days,
            "budget_min": budget_min,
            "budget_max": budget_max,
            # Spec §7: remaining budget = user budget − FINAL PLANNED AMOUNT.
            "remaining_budget": round(float(budget_max or 0) - final_total, 0),
            "within_budget": bool(final_total <= float(budget_max or 0) + 0.5),
            "highlights": highlights,
            "warnings": warnings,
            "recommended": variant == "RECOMMENDED",
            "stay_required": False if force_no_stay else (stay_required is True or bool(selected_stay)),
            "stay_cost": float(breakdown.get("stay", 0) or 0),
        })

    return _enforce_ordering(plans, verbose=verbose)


def _resequence(days: List[Dict[str, Any]]) -> None:
    """Push overlapping stops later so every day is a feasible schedule.

    Never pushes a start past midnight: a wrapped '01:02 AM' label would sort
    BEFORE the evening stops that caused it (the 4 PM → 8:30 AM bug in
    disguise). Overflowing stops are left untouched here; enforce_chronology
    defers them to the next day.
    """
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
                if cursor >= 1440:
                    break  # midnight overflow — defer to enforce_chronology
                s["time"] = _from_minutes(cursor)
                s["ai_note"] = "Rescheduled automatically to avoid overlapping activities."
                start = cursor
            cursor = start + dur


DAY_START_FLOOR_MINUTES = 8 * 60  # 08:00 — days never start earlier than this


def validate_schedule(
    days: List[Dict[str, Any]],
    first_day_start: Optional[str] = None,
) -> List[str]:
    """Deterministic schedule audit (PART Y) — returns violations, changes nothing.

    Rejects: unparseable times, stops before the Day-1 trip start, stops before
    08:00 on later days, out-of-order stops and overlapping stops. Runs before
    payment and activation so an impossible itinerary can never be bought.
    """
    violations: List[str] = []
    floor1 = _to_minutes(first_day_start or "") if first_day_start else None
    if floor1 is None:
        floor1 = DAY_START_FLOOR_MINUTES
    for d in sorted(days, key=lambda x: int(x.get("day", 0) or 0)):
        day_num = int(d.get("day", 0) or 0)
        floor = floor1 if day_num <= 1 else DAY_START_FLOOR_MINUTES
        stops = [s for s in d.get("stops", []) if _to_minutes(str(s.get("time", ""))) is not None]
        if len(stops) != len(d.get("stops", []) or []):
            violations.append(f"Day {day_num}: a stop has an invalid time.")
        stops.sort(key=lambda s: _to_minutes(str(s.get("time", ""))) or 0)
        prev_end: Optional[int] = None
        prev_title = ""
        for s in stops:
            start = _to_minutes(str(s.get("time", ""))) or 0
            dur = int(s.get("duration_minutes", 60) or 60)
            title = str(s.get("title", "Stop"))
            if start < floor:
                violations.append(
                    f"Day {day_num}: '{title}' at {s.get('time')} is before the "
                    f"{'trip start' if day_num == 1 else 'earliest day start'} ({_from_minutes(floor)})."
                )
            if prev_end is not None and start < prev_end:
                violations.append(
                    f"Day {day_num}: '{title}' overlaps the previous stop ('{prev_title}')."
                )
            prev_end = start + dur
            prev_title = title
    return violations


def enforce_chronology(
    days: List[Dict[str, Any]],
    first_day_start: Optional[str] = None,
    max_day: Optional[int] = None,
) -> List[str]:
    """Make the 4 PM → 8:30 AM class of bugs mathematically impossible.

    Deterministic post-scheduling pass (PART R–W of the spec), applied to EVERY
    generated or edited plan:
      1. DAY 1 FLOOR: the first day starts no earlier than the trip's real
         start time (e.g. a 4:00 PM arrival can never yield an 8:30 AM Day-1
         item). Any earlier stop is pushed to >= that time.
      2. GENERAL FLOOR: other days never begin before 08:00 (PART V).
      3. CHRONOLOGY + TRAVEL: stops within a day are ordered; each stop starts
         at or after the previous stop's end + travel time (haversine at a
         conservative 30 km/h city average, minimum 15 min — PART W).
    Returns human-readable notes for stops that were moved.
    """
    notes: List[str] = []
    floor1 = _to_minutes(first_day_start or "") if first_day_start else None
    if floor1 is None:
        floor1 = DAY_START_FLOOR_MINUTES
    for d in sorted(days, key=lambda x: int(x.get("day", 0) or 0)):
        day_num = int(d.get("day", 0) or 0)
        floor = floor1 if day_num <= 1 else DAY_START_FLOOR_MINUTES
        stops = [s for s in d.get("stops", []) if _to_minutes(str(s.get("time", ""))) is not None]
        # Clamp every stated time to the day's floor FIRST, then stable-sort by
        # the clamped time — the generator's narrative order is preserved for
        # stops that share a slot and no early stop can steal the Day-1 start.
        for s in stops:
            stated = _to_minutes(str(s.get("time", ""))) or 0
            s["_chrono_start"] = max(stated, floor)
        stops.sort(key=lambda s: s["_chrono_start"])
        def _is_transport(s: Dict[str, Any]) -> bool:
            cat = str(s.get("category", "")).lower()
            title = str(s.get("title", "")).lower()
            return "transport" in cat or "depart" in title or "board" in title or "return" in title or "arrival" in title

        cursor: Optional[int] = None
        prev_geo: Optional[Tuple[float, float]] = None
        overflow: List[Dict[str, Any]] = []
        kept: List[Dict[str, Any]] = []
        for s in stops:
            start = s["_chrono_start"]
            dur = int(s.get("duration_minutes", 60) or 60)
            earliest = cursor or 0
            # Travel time from the previous stop (PART W): conservative 30 km/h
            # city average with a 15-minute minimum for any real move.
            if cursor is not None and prev_geo is not None:
                try:
                    km = _haversine_km(
                        prev_geo,
                        (float(s.get("lat", 0) or 0), float(s.get("lng", 0) or 0)),
                    )
                except Exception:
                    km = 0.0
                if km > 0.3:  # under ~300 m = same complex, no travel needed
                    earliest = max(earliest, cursor + max(15, int(km / 30.0 * 60.0)))
            final_start = max(start, earliest)
            # Midnight overflow (PART S): a start at/after 24:00 would wrap into
            # a small-hours label that sorts BEFORE the evening stops that
            # caused it. Defer the stop to the next day instead. Transport legs
            # keep their explicit schedule (clamped inside the day).
            if final_start >= 1440 and not _is_transport(s):
                s.pop("_chrono_start", None)
                overflow.append(s)
                continue
            if final_start >= 1440:
                final_start = 1439
            if final_start > start:
                s["time"] = _from_minutes(final_start)
                s["ai_note"] = "Rescheduled to keep the day chronological."
                notes.append(f"Day {day_num}: '{s.get('title', 'Stop')}' moved to {s['time']} (chronological order)")
            else:
                s["time"] = _from_minutes(final_start)
            cursor = final_start + dur
            try:
                prev_geo = (float(s.get("lat", 0) or 0), float(s.get("lng", 0) or 0))
            except Exception:
                prev_geo = None
            s.pop("_chrono_start", None)
            # A stop whose own duration spills past midnight is also deferred
            # (non-transport only) so the day stays inside its calendar date.
            if cursor > 1440 and not _is_transport(s):
                overflow.append(s)
                kept = [k for k in kept if k is not s]
                cursor = final_start  # day ends at this stop
                continue
            kept.append(s)
        # The day's stored order now IS chronological order.
        d["stops"] = kept
        if overflow:
            # HARD TRIP-LENGTH RULE (spec §7): a trip that ends on Day N can
            # never grow a Day N+1. Overflow on the final day is compressed
            # into the last day's remaining evening capacity; anything that
            # genuinely cannot fit is dropped WITH a visible note — never
            # silently expanded into an extra calendar day.
            trip_last_day = max_day if max_day is not None else max(
                (int(x.get("day", 0) or 0) for x in days), default=day_num
            )
            if day_num >= trip_last_day:
                evening_cap = 21 * 60
                for s in list(overflow):
                    sm = _to_minutes(str(s.get("time", "")))
                    dur = int(s.get("duration_minutes", 60) or 60)
                    if sm is not None and sm + dur <= evening_cap:
                        s["ai_note"] = "Kept on the final day within evening hours."
                        kept.append(s)
                        overflow.remove(s)
                    else:
                        notes.append(
                            f"Day {day_num}: '{s.get('title', 'Stop')}' could not fit "
                            f"inside the trip's final day and was left out of the schedule."
                        )
                        overflow.remove(s)
                d["stops"] = sorted(
                    kept,
                    key=lambda s: _to_minutes(str(s.get("time", ""))) or 0,
                )
                continue
            target = next((x for x in days if int(x.get("day", 0) or 0) == day_num + 1), None)
            if target is None:
                target = {"day": day_num + 1, "title": f"Day {day_num + 1}", "stops": []}
                days.append(target)
                days.sort(key=lambda x: int(x.get("day", 0) or 0))
            morning = DAY_START_FLOOR_MINUTES
            for i, s in enumerate(overflow):
                s["day"] = day_num + 1
                s["time"] = _from_minutes(min(morning + i * 120, 20 * 60))
                s["ai_note"] = f"Moved to Day {day_num + 1} — Day {day_num} was fully committed."
                notes.append(f"Day {day_num}: '{s.get('title', 'Stop')}' deferred to Day {day_num + 1} (day overflow).")
                target.setdefault("stops", []).append(s)
    # MEAL WINDOWS (spec §8/§9): after chronology, ensure each day's breakfast/
    # lunch/snacks/dinner sit inside realistic windows — real selected
    # restaurants are untouched; clear meal holds fill otherwise-missed windows.
    _insert_missing_meal_stops(days)
    # Re-sort each day so inserted holds sit in chronological position.
    for d in days:
        d["stops"] = sorted(
            [s for s in (d.get("stops") or []) if _to_minutes(str(s.get("time", ""))) is not None],
            key=lambda s: _to_minutes(str(s.get("time", ""))) or 0,
        ) + [s for s in (d.get("stops") or []) if _to_minutes(str(s.get("time", ""))) is None]
    return notes


def _enforce_ordering(plans: List[Dict[str, Any]], verbose: bool = True) -> List[Dict[str, Any]]:
    """VALUE ≤ RECOMMENDED ≤ PREMIUM; travel spend ≤ budget_max — deterministic."""
    by_type = {p["type"]: p for p in plans}
    budget_max = float(plans[0]["budget_max"]) if plans else 0.0
    # The traveller's selected maximum budget is the HARD ceiling for the
    # plan's TRAVEL SPEND in every mode. Fees (guide 12.5% in GUIDE_MODE;
    # platform 3% + safety 15% always) stack ON TOP of the spend, so the
    # premium plan may reach final_total = budget_max × fee_factor.
    def _final_cap(p: Dict[str, Any]) -> float:
        fac = (1.0 + PLATFORM_FEE_RATE + SAFETY_RESERVE_RATE)
        # FINAL amount is capped BY the budget itself (spec §7: the final
        # planned amount must fit; remaining = budget − final ≥ 0).
        return float(budget_max)
    prem_cap = _final_cap(by_type["PREMIUM"])
    prem = min(by_type["PREMIUM"]["final_total"], prem_cap)
    rec = min(by_type["RECOMMENDED"]["final_total"], prem)
    val = min(by_type["VALUE"]["final_total"], rec)
    if by_type["PREMIUM"]["final_total"] > prem_cap:
        _shave_final_to(by_type["PREMIUM"], float(prem_cap), verbose=verbose)
    for plan, target in ((by_type["RECOMMENDED"], rec), (by_type["VALUE"], val)):
        if plan["final_total"] > target:
            _shave_final_to(plan, float(target), verbose=verbose)
    # within_budget is exact (no tolerance): the FINAL PLANNED AMOUNT (base +
    # guide 12.5% + platform 3% + safety 15% + ₹50 insurance) must sit within
    # the traveller's budget (spec §3/§7).
    for plan in plans:
        plan["within_budget"] = bool(float(plan["final_total"]) <= float(plan["budget_max"]) + 0.5)
    return plans


def _shave_final_to(plan: Dict[str, Any], target: float, verbose: bool = True) -> None:
    """Shave a plan's flexible buckets so its final total (incl. fees) hits target."""
    bd = plan["cost_breakdown"]
    guide_mode = bool(bd.get("guide_mode"))
    # Target is the final total (incl. fees). The plan's base spend must satisfy
    # spend × fee_factor <= target, where fee_factor stacks guide (GUIDE_MODE
    # only) + platform + safety over the base (spec §23-26).
    fee_factor = (1.0 + GUIDE_FEE_RATE + PLATFORM_FEE_RATE + SAFETY_RESERVE_RATE) if guide_mode \
        else (1.0 + PLATFORM_FEE_RATE + SAFETY_RESERVE_RATE)
    spend_target = (target - INSURANCE_FEE) / fee_factor
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
    spend = min(spend, int(max(0.0, target - INSURANCE_FEE) / fee_factor))
    guide_fee = round(spend * GUIDE_FEE_RATE, 0) if guide_mode else 0.0
    platform_fee = round(spend * PLATFORM_FEE_RATE, 0)
    safety_reserve = round(spend * SAFETY_RESERVE_RATE, 0)
    insurance_fee = INSURANCE_FEE
    final_total = spend + guide_fee + platform_fee + safety_reserve + insurance_fee
    bd.update({
        "stay": round(stay, 0), "food": round(food, 0), "activities": round(activities, 0),
        "travel_spend": spend,
        "guide_fee": round(guide_fee, 0),
        "platform_fee": platform_fee,
        "safety_reserve": safety_reserve,
        "insurance_fee": insurance_fee,
        "base_plan_cost": spend,
        "final_total": round(final_total, 0), "total": round(final_total, 0),
        "payable": round(final_total, 0),
    })
    plan.update({
        "base_plan_cost": spend, "platform_fee": platform_fee,
        "safety_reserve": safety_reserve, "insurance_fee": insurance_fee,
        "final_total": round(final_total, 0), "total_cost": round(final_total, 0),
        # Fees sit on top of the travel spend in EVERY mode (spec §23-26);
        # what remains of the traveller's budget is budget − spend.
        "remaining_budget": round(plan["budget_max"] - spend, 0),
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
            a_geo = (float(a.get("lat", 0) or 0), float(a.get("lng", 0) or 0))
            b_geo = (float(b.get("lat", 0) or 0), float(b.get("lng", 0) or 0))
            # (0,0) means "no verified coordinates" — distance is unknowable,
            # never flag a 17,000-minute phantom transfer.
            if abs(a_geo[0]) < 0.01 and abs(a_geo[1]) < 0.01:
                km = 0.0
            elif abs(b_geo[0]) < 0.01 and abs(b_geo[1]) < 0.01:
                km = 0.0
            else:
                km = _haversine_km(a_geo, b_geo)
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

    Recomputs a plan's fees/total from the single rule (spec §3/§23-26): base
    cost = transport + stay + food + activities; fees stack ON TOP — guide fee
    12.5% in GUIDE_MODE only, platform fee 3% always, safety reserve 15%
    always, insurance ₹50 fixed. Guarantees the invariants:
        final_total == base + guide + platform + safety + insurance
        final_total <= budget_max        (remaining = budget − final ≥ 0)
    """
    bd = plan["cost_breakdown"]
    guide_mode = bool(bd.get("guide_mode"))
    raw_spend = float(plan["base_plan_cost"])
    if float(budget_max) > 0:
        # The budget caps the FINAL amount, so invert the fee stack to get the
        # largest base spend whose fully-loaded total still fits.
        fee_factor = (1.0 + GUIDE_FEE_RATE + PLATFORM_FEE_RATE + SAFETY_RESERVE_RATE) if guide_mode             else (1.0 + PLATFORM_FEE_RATE + SAFETY_RESERVE_RATE)
        spend_ceiling = max(0.0, (float(budget_max) - INSURANCE_FEE) / fee_factor)
        spend = int(min(raw_spend, spend_ceiling))
    else:
        spend = round(raw_spend, 0)
    guid_fee_seed = float(bd.get("guide_fee", 0) or 0)
    guide_fee = round(spend * GUIDE_FEE_RATE, 0) if guide_mode else guid_fee_seed
    platform_fee = round(spend * PLATFORM_FEE_RATE, 0)
    safety_reserve = round(spend * SAFETY_RESERVE_RATE, 0)
    insurance_fee = float(bd.get("insurance_fee", INSURANCE_FEE) or INSURANCE_FEE)
    final_total = round(spend + guide_fee + platform_fee + safety_reserve + insurance_fee, 0)
    plan["base_plan_cost"] = spend
    plan["platform_fee"] = platform_fee
    plan["safety_reserve"] = safety_reserve
    plan["insurance_fee"] = insurance_fee
    plan["final_total"] = final_total
    plan["total_cost"] = final_total
    # Spec §7: remaining budget = user budget − FINAL PLANNED AMOUNT.
    plan["remaining_budget"] = round(float(budget_max) - final_total, 0)
    plan["within_budget"] = bool(final_total <= float(budget_max) + 0.5)
    bd["base_plan_cost"] = spend
    bd["guide_fee"] = round(guide_fee, 0)
    bd["platform_fee"] = platform_fee
    bd["safety_reserve"] = safety_reserve
    bd["insurance_fee"] = insurance_fee
    bd["final_total"] = final_total
    bd["total"] = final_total
    bd["payable"] = final_total


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
        safety_reserve = round(spend * SAFETY_RESERVE_RATE, 0)
        insurance_fee = float(breakdown.get("insurance_fee", INSURANCE_FEE) or INSURANCE_FEE)
        final_total = spend + guide_fee + platform_fee + safety_reserve + insurance_fee
        breakdown["guide_fee"] = round(guide_fee, 0)
        breakdown["platform_fee"] = platform_fee
        breakdown["safety_reserve"] = safety_reserve
        breakdown["insurance_fee"] = insurance_fee
        breakdown["base_plan_cost"] = round(spend, 0)
        breakdown["final_total"] = round(final_total, 0)
        breakdown["total"] = round(final_total, 0)
        breakdown["payable"] = round(final_total, 0)
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
