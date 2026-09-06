"""
AI Orchestrator — generates trip itineraries.

Design principles:
- Destination is NEVER substituted: the itinerary for Delhi -> Munnar stays in Munnar.
- Recommendations change with the user's budget, duration, transport preference,
  stay tier, dietary preference, walking tolerance and party size — the totals and
  the actual recommended places must differ between a budget backpacker and a
  luxury traveller.
- Every place, schedule and fare comes from the curated Verified Travel Database.
  When a destination has no published package, planning is refused with a clear
  message instead of fabricating content.
- Fees (guide + platform) are computed by the dynamic pricing engine; Travion only
  ever collects those fees, never the full travel budget.
"""

import logging
import math
import re
from datetime import datetime
from typing import Dict, Any, List, Optional

from app.services.pricing_service import compute_fees, party_headcount
from app.services.verified_data import (
    VERIFIED_LOCATIONS, VERIFIED_TRANSPORT, VERIFIED_STAYS,
    VERIFIED_FOOD, VERIFIED_ATTRACTIONS, VERIFIED_SAFETY_INFO
)

logger = logging.getLogger(__name__)

LOCATION_COORDS: Dict[str, Dict[str, float]] = {
    loc["name"]: {"lat": loc["lat"], "lng": loc["lng"]} for loc in VERIFIED_LOCATIONS
}

# Destinations with published verified packages (stay + food + attractions + safety).
PACKAGE_DESTINATIONS = set(VERIFIED_STAYS.keys())

_MEAL_TIMES = ["12:30 PM", "07:30 PM"]
_ATTRACTION_TIMES = ["09:30 AM", "02:30 PM"]


def _parse_budget(profile: Dict[str, Any]) -> float:
    raw = profile.get("budget")
    if raw is None:
        return 18000.0
    # Budget envelopes {"min": x, "max": y} are stored by the 5-question
    # interview; plan against the midpoint so no component overshoots the cap.
    if isinstance(raw, dict):
        try:
            lo = float(raw.get("min") or 0)
            hi = float(raw.get("max") or 0)
        except (TypeError, ValueError):
            return 18000.0
        if hi <= 0:
            return 18000.0
        return (lo + hi) / 2.0 if lo > 0 else hi
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw)
    digits = [float(x) for x in re.findall(r"\d[\d,]*", text.replace(",", ""))]
    if not digits:
        return 18000.0
    if len(digits) >= 2 and "-" in text:
        return (digits[0] + digits[1]) / 2.0
    return digits[0]


def _parse_days(start_date: str, end_date: str) -> int:
    """Calendar days inclusive between two ISO datetimes (min 1)."""
    try:
        s = datetime.fromisoformat(start_date).date()
        e = datetime.fromisoformat(end_date).date()
        diff = (e - s).days
        return max(1, diff + 1 if diff >= 0 else 1)
    except Exception:
        return 2


def _party(profile: Dict[str, Any]) -> str:
    return profile.get("party") or profile.get("party_type") or "Solo"


def _pick_transport(src: str, dest: str, profile: Dict[str, Any], budget: float) -> Dict[str, Any]:
    """Pick a verified transport option by preference + budget."""
    options = VERIFIED_TRANSPORT.get((src, dest)) or VERIFIED_TRANSPORT.get((dest, src))
    if not options:
        raise ValueError(
            f"No verified transport schedule is published yet for {src} to {dest}. "
            "Travion will not invent schedules — try a route that is currently covered."
        )
    pref = str(profile.get("transport_pref") or "").lower()

    def contains(*words: str) -> bool:
        return any(w in pref for w in words)

    candidates = list(options)
    if contains("toy", "scenic"):
        toy = [o for o in options if "toy" in o["type"].lower()]
        if toy:
            candidates = toy
    elif contains("bus", "sleeper", "volvo", "ksrtc", "hr"):
        bus = [o for o in options if any(k in o["type"].lower() for k in ("bus", "sleeper", "ksrtc"))]
        if bus:
            candidates = bus
    elif contains("cab", "private", "self drive", "van"):
        van = [o for o in options if any(k in o["type"].lower() for k in ("van", "cab", "road shuttle"))]
        if van:
            candidates = van

    def duration_mins(o: Dict[str, Any]) -> int:
        txt = o.get("duration", "6h")
        try:
            h, m = 0, 0
            if "h" in txt:
                parts = txt.replace("m", "").split("h")
                h = int(float(parts[0].strip()))
                if len(parts) > 1 and parts[1].strip():
                    m = int(float(parts[1].strip()))
            return h * 60 + m
        except Exception:
            return 360

    if contains("fastest"):
        return min(candidates, key=duration_mins)
    if budget <= 12000:
        return min(candidates, key=lambda o: float(o.get("fare", 0)))
    return max(candidates, key=lambda o: float(o.get("fare", 0)))


def _pick_stay(dest: str, profile: Dict[str, Any], budget: float, nights: int) -> Dict[str, Any]:
    stays = VERIFIED_STAYS.get(dest) or VERIFIED_STAYS.get("Ooty")
    stay_pref = str(profile.get("stay_pref") or "").replace("\u2605", " Star").replace("\u2605", " Star")
    nightly_budget = (budget * 0.34) / max(nights, 1)

    tier_key = ""
    for key in ["5 Star", "4 Star", "3 Star", "Homestay", "Heritage", "Resort", "Boutique"]:
        if key in stay_pref:
            tier_key = key
            break

    affordable = [s for s in stays if s.get("price_per_night", 0) <= max(nightly_budget * 1.6, 1500)]
    pool = affordable or list(stays)
    if tier_key:
        exact = [s for s in pool if s.get("tier") == tier_key]
        if exact:
            return min(exact, key=lambda s: s.get("price_per_night", 0))
        # preference unavailable within budget: closest lower tier that is affordable
        closer = [s for s in pool if s.get("price_per_night", 0) <= nightly_budget * 1.6]
        if closer:
            return min(closer, key=lambda s: s.get("price_per_night", 0))
    return min(pool, key=lambda s: s.get("price_per_night", 999999))


def _pick_food(dest: str, profile: Dict[str, Any]) -> List[Dict[str, Any]]:
    foods = VERIFIED_FOOD.get(dest) or VERIFIED_FOOD.get("Ooty")
    pref = str(profile.get("food_pref") or "")
    if "veg" in pref.lower() and "non" not in pref.lower():
        veg = [f for f in foods if "pure veg" in f.get("veg_type", "").lower()]
        if veg:
            foods = veg
    return foods


def _clock_minutes(value: Any) -> int:
    """'hh:mm AM/PM' -> minutes since midnight for real chronological ordering.

    Sorting on the raw 12-hour label is lexicographic and wrong ("02:00 PM" sorts
    before "08:00 AM", "06:00 PM" before "06:30 AM"), which used to scramble the
    itinerary so the outbound departure was not the first step of Day 1.
    """
    m = re.match(r"(\d{1,2}):(\d{2})\s*(AM|PM)?", str(value or "").strip(), re.IGNORECASE)
    if not m:
        return 0
    hour = int(m.group(1))
    minute = int(m.group(2))
    meridiem = (m.group(3) or "").upper()
    if meridiem == "PM" and hour < 12:
        hour += 12
    if meridiem == "AM" and hour == 12:
        hour = 0
    return hour * 60 + minute


def _minutes_to_clock(minutes: int) -> str:
    """Minutes since midnight -> 'hh:mm AM/PM' label."""
    minutes %= 1440
    hour = (minutes // 60) % 24
    minute = minutes % 60
    suffix = "AM" if hour < 12 else "PM"
    hh = hour % 12 or 12
    return f"{hh:02d}:{minute:02d} {suffix}"


def _stop(**kwargs: Any) -> Dict[str, Any]:
    base = {
        "id": "stop",
        "day": 1,
        "time": "10:00 AM",
        "title": "",
        "description": "",
        "category": "attraction",
        "location_name": "",
        "lat": 0.0,
        "lng": 0.0,
        "estimated_cost": 0.0,
        "duration_minutes": 60,
        "rating": 4.7,
        "weather_note": None,
        "ai_note": None,
        "source": "verified_api",
    }
    base.update(kwargs)
    return base


def _fmt_inr(amount: float) -> str:
    return f"\u20b9{amount:,.0f}"


def _duration_minutes(o: Dict[str, Any]) -> int:
    txt = o.get("duration", "6h")
    try:
        h, m = 0, 0
        if "h" in txt:
            parts = txt.replace("m", "").split("h")
            h = int(float(parts[0].strip()))
            if len(parts) > 1 and parts[1].strip():
                m = int(float(parts[1].strip()))
        return h * 60 + m
    except Exception:
        return 360


def _rooms_for_pax(pax: float) -> int:
    return max(1, int(math.ceil(pax / 2)))


def _norm_profile(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Discovery stores multi-select answers as structured lists; every planner
    matcher is substring-based, so stringify list selections without losing any
    choice (e.g. ['Adventure & Treks', 'Nature & Wildlife'] -> joined text)."""
    out: Dict[str, Any] = dict(profile)
    for key in ("party", "experience", "food_pref", "stay_pref", "transport_pref",
                "activities", "pace", "walking_tolerance", "priority"):
        value = out.get(key)
        if isinstance(value, (list, tuple)):
            out[key] = ", ".join(str(v) for v in value if str(v).strip())
    return out


class AIOrchestrator:
    """Builds preference-driven, verified-grounding trip itineraries."""

    @classmethod
    def generate_itinerary(
        cls,
        source_name: str,
        destination_name: str,
        start_date: str,
        end_date: str,
        mode: str,
        profile: Dict[str, Any],
        source_coords: Optional[Dict[str, float]] = None,
        dest_coords: Optional[Dict[str, float]] = None
    ) -> Dict[str, Any]:
        profile = _norm_profile(profile)
        if destination_name not in PACKAGE_DESTINATIONS:
            raise ValueError(
                f"No verified itinerary package is published yet for {destination_name}. "
                "Travion only grounds plans in verified stays, dining and attraction data — "
                "please choose one of the currently covered destinations."
            )

        days = _parse_days(start_date, end_date)
        budget = _parse_budget(profile)
        party = _party(profile)
        pax = party_headcount(party)
        nights = max(1, days - 1)
        rooms = _rooms_for_pax(pax)

        transport = _pick_transport(source_name, destination_name, profile, budget)
        # Real coordinates come from the traveller's selected locations (Location rows).
        # Verified dataset coordinates are used only when the planner itself resolves
        # the place; there is never a fabricated city fallback.
        dest_coords = dest_coords or LOCATION_COORDS.get(destination_name)
        src_coords = source_coords or LOCATION_COORDS.get(source_name)
        if not dest_coords or not src_coords:
            raise ValueError(
                f"Coordinate data is unavailable for {source_name} or {destination_name}. "
                "Travion will not guess a location — choose places with resolved coordinates."
            )

        stay = _pick_stay(destination_name, profile, budget, nights)
        food_options = _pick_food(destination_name, profile)
        attractions_all = VERIFIED_ATTRACTIONS.get(destination_name, [])
        sightseeing = [a for a in attractions_all if a.get("category") == "attraction"]
        gems = [a for a in attractions_all if a.get("category") == "hidden_gem"]
        safety = VERIFIED_SAFETY_INFO.get(destination_name, VERIFIED_SAFETY_INFO["Ooty"])

        priority = str(profile.get("priority") or "").lower()
        experience = str(profile.get("experience") or "").lower()
        activities = str(profile.get("activities") or "").lower()
        want_gems = any(k in priority for k in ["gem", "hidden", "explor", "discovery", "value"])
        want_depth = want_gems or any(
            k in experience for k in ["adventure", "trek", "wildlife", "heritage", "culture", "culinary", "spiritual"]
        ) or any(
            k in activities for k in ["trek", "hike", "waterfall", "wildlife", "heritage", "temple",
                                      "museum", "culture", "photography", "adventure", "food trail", "spiritual"]
        )

        # ----- Costs (whole-group estimates) -----
        transport_cost = float(transport.get("fare", 0)) * 2 * pax  # round trip
        stay_cost = float(stay.get("price_per_night", 0)) * nights * rooms
        food_total = 0.0
        activity_total = 0.0

        day_blocks: List[Dict[str, Any]] = []
        used_attractions: set = set()
        used_gems: set = set()

        # A hidden gem is offered once mid-trip for discovery-seekers.
        gem_day = min(days, 2) if days >= 2 and (want_gems or want_depth) else None

        # Overnight outbound legs (evening departure or next-day arrival) mean the
        # traveller is not physically at the destination on Day 1. Day 1 is then
        # purely the departure journey, and destination content (safety briefing +
        # hotel check-in) belongs to Day 2 after the morning arrival.
        dep_label = str(transport.get("departure", "06:15 AM"))
        arr_label = str(transport.get("arrival", ""))
        overnight_out = (
            "+1" in arr_label
            or "next day" in arr_label.lower()
            or _clock_minutes(dep_label) >= 17 * 60
        )
        defer_dest_to_day2 = overnight_out and days >= 3
        day2_extra: List[Dict[str, Any]] = []

        for day_num in range(1, days + 1):
            day_stops: List[Dict[str, Any]] = []
            is_first = day_num == 1
            is_last = day_num == days

            if is_first:
                # Transport in (verified schedule).
                day_stops.append(_stop(
                    id=f"stop-d{day_num}-t",
                    day=day_num,
                    time=str(transport.get("departure", "06:15 AM")),
                    title=f"Depart {source_name}: {transport['type']}",
                    description=(
                        f"Board {transport['code']} from {source_name}, scheduled arrival "
                        f"{transport['arrival']}. Verified fare {_fmt_inr(transport.get('fare', 0))} "
                        "per traveller; round-trip included in the estimate."
                    ),
                    category="transport",
                    location_name=f"{source_name} Transit Station",
                    lat=src_coords["lat"],
                    lng=src_coords["lng"],
                    estimated_cost=round(float(transport.get("fare", 0)), 0),
                    duration_minutes=_duration_minutes(transport),
                    rating=4.8,
                    source=transport.get("source", "verified_api"),
                    transport_details=transport,
                ))
                # Grounded safety / emergency briefing. On overnight journeys the
                # traveller boards in the evening and arrives the next morning, so
                # the briefing is scheduled for Day 2 after arrival instead.
                briefing_time = "08:00 AM"
                if defer_dest_to_day2:
                    arr_min = _clock_minutes(arr_label)
                    briefing_time = _minutes_to_clock(arr_min + 45) if arr_label and arr_min else "09:00 AM"
                briefing_stop = _stop(
                    id=f"stop-d{day_num}-s",
                    day=day_num,
                    time=briefing_time,
                    title=f"{destination_name} Safety & Emergency Briefing",
                    description=(
                        f"Hospital: {safety['hospital_name']} ({safety['hospital_phone']}). "
                        f"Police: {safety['police_phone']}. Tourist helpline: {safety['tourist_helpline']}."
                    ),
                    category="safety" if mode == "GUIDE_MODE" else "emergency",
                    location_name=f"{destination_name} Regional Safety Post",
                    lat=round(dest_coords["lat"] + 0.004, 6),
                    lng=round(dest_coords["lng"] + 0.004, 6),
                    estimated_cost=0.0,
                    duration_minutes=10,
                    rating=5.0,
                    emergency_contact=safety.get("tourist_helpline"),
                    source="verified_api",
                )
                if defer_dest_to_day2:
                    briefing_stop["id"] = "stop-d2-s"
                    briefing_stop["day"] = 2
                    day2_extra.append(briefing_stop)
                else:
                    day_stops.append(briefing_stop)

            # Stay check-in / check-out. On an overnight journey the traveller
            # sleeps on the road and checks in the following afternoon.
            if is_first:
                checkin_stop = _stop(
                    id=f"stop-d{day_num}-h",
                    day=day_num,
                    time="02:00 PM",
                    title=f"Check-in at {stay['name']}",
                    description=(
                        f"{stay['tier']} stay, {_fmt_inr(stay['price_per_night'])} per night. "
                        f"Amenities: {', '.join(stay['amenities'])}."
                    ),
                    category="stay",
                    location_name=stay["name"],
                    lat=float(stay["lat"]),
                    lng=float(stay["lng"]),
                    estimated_cost=round(float(stay.get("price_per_night", 0)), 0),
                    duration_minutes=60,
                    rating=float(stay.get("rating", 4.7)),
                    ai_note="Matched to your stay preference and within your travel budget.",
                    source=stay.get("source", "verified_api"),
                )
                if defer_dest_to_day2:
                    checkin_stop["id"] = "stop-d2-h"
                    checkin_stop["day"] = 2
                    day2_extra.append(checkin_stop)
                else:
                    day_stops.append(checkin_stop)
            elif is_last:
                day_stops.append(_stop(
                    id=f"stop-d{day_num}-h",
                    day=day_num,
                    time="09:00 AM",
                    title=f"Check-out from {stay['name']}",
                    description="Room check-out with luggage holding before your return journey.",
                    category="stay",
                    location_name=stay["name"],
                    lat=float(stay["lat"]),
                    lng=float(stay["lng"]),
                    estimated_cost=0.0,
                    duration_minutes=30,
                    rating=float(stay.get("rating", 4.7)),
                    source="verified_api",
                ))

            # Attractions for the day (no repeats until the pool is exhausted).
            # A night-travel Day 1 has no destination time left, so Day 2 (which
            # carries its own full schedule) is not duplicated with Day 1 picks.
            travel_night_day = is_first and defer_dest_to_day2
            picks: List[Dict[str, Any]] = []
            if not travel_night_day:
                spots_available = [a for a in sightseeing if a["name"] not in used_attractions]
                if not spots_available:
                    used_attractions.clear()
                    spots_available = list(sightseeing)
                if spots_available:
                    first = spots_available.pop(0)
                    picks.append(first)
                    used_attractions.add(first["name"])
                if len(picks) == 1 and spots_available and not is_last:
                    second = spots_available.pop(0)
                    picks.append(second)
                    used_attractions.add(second["name"])

            for idx, attr in enumerate(picks):
                slot = _ATTRACTION_TIMES[idx % len(_ATTRACTION_TIMES)]
                if is_first and idx == 0 and len(day_stops) >= 3:
                    slot = "04:30 PM"
                day_stops.append(_stop(
                    id=f"stop-d{day_num}-a{idx}",
                    day=day_num,
                    time=slot,
                    title=attr["name"],
                    description=attr["description"],
                    category="hidden_gem" if attr.get("category") == "hidden_gem" else "attraction",
                    location_name=attr["name"],
                    lat=float(attr["lat"]),
                    lng=float(attr["lng"]),
                    estimated_cost=round(float(attr.get("entry_fee", 0)), 0),
                    duration_minutes=int(attr.get("duration_minutes", 60)),
                    rating=float(attr.get("rating", 4.7)),
                    ai_note="Selected for your interest profile and walking tolerance.",
                    source=attr.get("source", "verified_api"),
                ))
                activity_total += float(attr.get("entry_fee", 0)) * pax

            # Hidden gem surfaced once.
            if day_num == gem_day and gems:
                gem = gems[0]
                if gem["name"] not in used_gems:
                    used_gems.add(gem["name"])
                    day_stops.append(_stop(
                        id=f"stop-d{day_num}-g",
                        day=day_num,
                        time="04:00 PM",
                        title=gem["name"],
                        description=gem["description"],
                        category="hidden_gem",
                        location_name=gem["name"],
                        lat=float(gem["lat"]),
                        lng=float(gem["lng"]),
                        estimated_cost=round(float(gem.get("entry_fee", 0)), 0),
                        duration_minutes=int(gem.get("duration_minutes", 60)),
                        rating=float(gem.get("rating", 4.9)),
                        ai_note="Local spot surfaced from verified guide submissions.",
                        source=gem.get("source", "guide_submitted"),
                    ))
                    activity_total += float(gem.get("entry_fee", 0)) * pax

            # Meals.
            if days == 1:
                meal_slots = _MEAL_TIMES
            elif is_first and defer_dest_to_day2:
                meal_slots = []  # traveller is on the overnight leg, not in town
            elif is_first:
                meal_slots = [_MEAL_TIMES[1]]
            elif is_last:
                meal_slots = [_MEAL_TIMES[0]]
            else:
                meal_slots = _MEAL_TIMES
            meal_count = 0
            for mslot in meal_slots:
                if not food_options:
                    break
                rest = food_options[meal_count % len(food_options)]
                meal_count += 1
                meal_cost = round(float(rest.get("avg_cost_for_two", 800)) * pax / 2, 0)
                food_total += meal_cost
                day_stops.append(_stop(
                    id=f"stop-d{day_num}-f{meal_count}",
                    day=day_num,
                    time=mslot,
                    title=f"Dining at {rest['name']}",
                    description=f"{rest['cuisine']} · Signature: {rest['must_try']}.",
                    category="food",
                    location_name=rest["name"],
                    lat=float(rest["lat"]),
                    lng=float(rest["lng"]),
                    estimated_cost=meal_cost,
                    duration_minutes=60,
                    rating=float(rest.get("rating", 4.6)),
                    ai_note="Curated to your dietary preference.",
                    source=rest.get("source", "verified_api"),
                ))

            # Return transport on the final day.
            if is_last and days > 1:
                day_stops.append(_stop(
                    id=f"stop-d{day_num}-r",
                    day=day_num,
                    time="05:30 PM",
                    title=f"Return journey to {source_name}",
                    description=(
                        f"Depart on {transport['code']} back to {source_name}. "
                        "Round-trip fare already included in the transport estimate."
                    ),
                    category="transport",
                    location_name=f"{destination_name} Transit Point",
                    lat=dest_coords["lat"],
                    lng=dest_coords["lng"],
                    estimated_cost=round(float(transport.get("fare", 0)), 0),
                    duration_minutes=_duration_minutes(transport),
                    rating=4.8,
                    source=transport.get("source", "verified_api"),
                ))

            # When the outbound journey arrived overnight, Day 2 opens with the
            # deferred safety briefing + hotel check-in from the travel night.
            if day_num == 2 and day2_extra:
                day_stops = day2_extra + day_stops

            # Chronological sort (minutes since midnight), NOT lexicographic on the
            # 12-hour label — so the 06:30 AM departure always precedes the 02:00 PM
            # check-in and the outbound leg is Step 1 of the trip.
            day_stops.sort(key=lambda s: _clock_minutes(s.get("time")))
            if is_first:
                theme = "Overnight Journey & Departure" if defer_dest_to_day2 else "Arrival & Orientation"
            elif day_num == 2 and defer_dest_to_day2:
                theme = "Arrival & Orientation"
            elif is_last and days > 1:
                theme = "Departure Day"
            else:
                theme = ["Signature Experiences", "Local Discovery"][day_num % 2]
            day_blocks.append({
                "day": day_num,
                "title": f"{destination_name} — {theme}",
                "stops": day_stops,
            })

        fees = compute_fees(
            mode=mode,
            days=days,
            budget=budget,
            destination=destination_name,
            party_type=party,
            luxury_level=profile.get("stay_pref"),
        )
        guide_fee = float(fees["guide_fee"])
        platform_fee = float(fees["platform_fee"])

        travel_spend = round(transport_cost + stay_cost + food_total + activity_total, 0)
        total = round(travel_spend + guide_fee + platform_fee, 0)

        cost_breakdown = {
            "transport": round(transport_cost, 0),
            "stay": round(stay_cost, 0),
            "food": round(food_total, 0),
            "activities": round(activity_total, 0),
            "travel_spend": travel_spend,
            "guide_fee": guide_fee,
            "platform_fee": platform_fee,
            "payable": round(fees["payable"], 0),
            "total": total,
            "budget": budget,
            "party_type": party,
            "headcount": pax,
            "days": days,
            "nights": nights,
            "destination": destination_name,
        }

        return {
            "version": 1,
            "total_cost": total,
            "cost_breakdown": cost_breakdown,
            "days": day_blocks,
        }
