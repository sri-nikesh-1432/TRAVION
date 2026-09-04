"""
India Journey Planner — generic, India-wide itinerary builder.

Purpose: a traveller may start from or head to ANY Indian location — a state,
a district town, a village, a hill station — while Travion only holds curated
verified packages for a handful of hubs. This service builds a complete,
instantly usable plan for any India -> India pair using:

  - the traveller's REAL selected geography (coordinates, distances),
  - real typical Indian transport corridors and cost bands (train / bus /
    flight / cab estimates by distance),
  - honest, clearly-labelled estimates everywhere: no invented train numbers,
    flight codes, hotel names, vendor availability or attraction claims.

Every stop is marked source = "estimate".  Where the verified database covers
the destination, AIOrchestrator (verified plan) is used instead — this engine
never runs for covered hubs.

Fee rules stay server-side in pricing_service; Travion still only collects
guide + platform fees, never the travel budget.
"""

import math
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.services.pricing_service import compute_fees, party_headcount
from app.services.ai_orchestrator import _parse_days, _parse_budget, _party

# Real national emergency / helpline numbers (Government of India).
NATIONAL_HELP = {
    "police_emergency": "112",
    "ambulance": "108",
    "tourist_helpline": "1078",
    "railway_helpline": "139",
}

# Estimated per-night stay bands (INR) by preference — real typical ranges.
STAY_TIERS: List[Dict[str, Any]] = [
    {"words": ["luxury", "5 star", "5-star"], "label": "Luxury / 5-Star", "lo": 7000, "hi": 16000, "comfort": "luxury"},
    {"words": ["4 star", "4-star", "resort"], "label": "4-Star / Resort", "lo": 3800, "hi": 7500, "comfort": "premium"},
    {"words": ["3 star", "3-star", "boutique", "heritage"], "label": "3-Star / Boutique", "lo": 2200, "hi": 4200, "comfort": "standard"},
    {"words": ["homestay", "guesthouse", "guest house", "bed and breakfast"], "label": "Homestay / Guesthouse", "lo": 1100, "hi": 2200, "comfort": "cozy"},
    {"words": ["hostel", "budget", "backpack"], "label": "Budget / Hostel", "lo": 500, "hi": 1100, "comfort": "budget"},
]
FALLBACK_STAY = STAY_TIERS[2]

# Regional cuisine hints by state — only used as generic labels, never as venues.
CUISINE_HINT: Dict[str, str] = {
    "Kerala": "Kerala-style meals (sadya, seafood, appam)",
    "Karnataka": "local Kannada cuisine",
    "Tamil Nadu": "South Indian tiffin and Chettinad flavours",
    "Andhra Pradesh": "Andhra-style meals and seafood",
    "Telangana": "Hyderabadi and Telangana flavours",
    "Maharashtra": "Maharashtrian and coastal cuisine",
    "Goa": "Goan fish-curry and local cuisine",
    "Gujarat": "Gujarati thali and snacks",
    "Rajasthan": "Rajasthani thali and dal-baati",
    "Punjab": "Punjabi dhaba and tandoori food",
    "Haryana": "Haryanvi rustic meals",
    "Uttar Pradesh": "Awadhi and North Indian cuisine",
    "Madhya Pradesh": "Malwa and Bundelkhandi food",
    "Bihar": "Bihari thali and litti-chokha",
    "Jharkhand": "Jharkhandi tribal and rustic food",
    "West Bengal": "Bengali meals and sweets",
    "Odisha": "Odia thali and coastal food",
    "Assam": "Assamese thali and bamboo dishes",
    "Himachal Pradesh": "Himachali dham-style meals",
    "Uttarakhand": "Kumaoni-Garhwali food",
    "Jammu and Kashmir": "Kashmiri wazwan-style meals",
    "Sikkim": "Sikkimese momos and thukpa",
    "Arunachal Pradesh": "Arunachali tribal food",
    "Meghalaya": "Khasi and Jaintia food",
    "Mizoram": "Mizo cuisine",
    "Nagaland": "Naga smoked and spicy food",
    "Manipur": "Manipuri cuisine",
    "Tripura": "Tripuri cuisine",
    "Ladakh": "Ladakhi thukpa and momos",
}

# Experience keywords -> themed daily block templates (honest generic suggestions).
_THEMES: List[Dict[str, Any]] = [
    {"keys": ["adventure", "trek", "hike"], "title": "Outdoor & trail exploration around {d}",
     "desc": "Trek / nature-trail options around {d}. Route difficulty and permits are confirmed live — nothing here is a booked promise."},
    {"keys": ["nature", "wildlife", "scenic", "photography"], "title": "Nature & scenic viewpoints near {d}",
     "desc": "Scenic viewpoints, gardens or wildlife options near {d}. Exact spots and best light hours are confirmed live before the day."},
    {"keys": ["cultural", "heritage", "spiritual", "history", "architecture", "museum"], "title": "Heritage & cultural walk in {d}",
     "desc": "Heritage sites, monuments and cultural landmarks of {d}. Opening hours and entry fees are confirmed live before the day."},
    {"keys": ["culinary", "food", "street food"], "title": "Local food trail in {d}",
     "desc": "A walkable food trail across {d}'s popular local eateries. Venues are confirmed live against your dietary preferences."},
    {"keys": ["relaxed", "relaxation", "leisure"], "title": "Leisurely local exploration in {d}",
     "desc": "Slow-paced sightseeing and local leisure spots around {d}, tuned to a relaxed rhythm."},
    {"keys": ["shopping", "arts", "craft"], "title": "Local bazaars & craft lanes of {d}",
     "desc": "Traditional markets and craft lanes of {d}. Prices are negotiated locally; ask your assistant for fair-price guidance."},
    {"keys": ["nightlife"], "title": "Evening scene near {d} centre",
     "desc": "Popular evening spots near {d} centre — cafes, live music or markets. Venues are confirmed live."},
    {"keys": ["family"], "title": "Family-friendly outing in {d}",
     "desc": "Easy, family-friendly experiences around {d} — parks, museums and local attractions with short travel times."},
    {"keys": [], "title": "Local discovery around {d}",
     "desc": "Offbeat neighbourhoods and lesser-known local spots around {d}, surfaced for a genuine local feel."},
]


def _fmt_inr(amount: float) -> str:
    return f"\u20b9{amount:,.0f}"


def _haversine_km(a: Dict[str, float], b: Dict[str, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, [a["lat"], a["lng"], b["lat"], b["lng"]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def _mins_to_label(minutes: int) -> str:
    minutes = int(round(minutes))
    h = (minutes // 60) % 24
    m = minutes % 60
    suffix = "AM" if h < 12 else "PM"
    hh = h % 12 or 12
    return f"{hh:02d}:{m:02d} {suffix}"


def _clock_minutes(label: str) -> int:
    """'hh:mm AM/PM' -> minutes since midnight for real chronological ordering.

    Sorting on the raw 12-hour label is lexicographic and wrong ("02:00 PM" sorts
    before "08:00 AM", "06:00 PM" before "06:30 AM"), which used to scramble the
    itinerary so the outbound departure was not the first step of Day 1.
    """
    m = re.match(r"(\d{1,2}):(\d{2})\s*(AM|PM)?", (label or "").strip(), re.IGNORECASE)
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


def _time_label_from(start_label: str, minutes: int) -> str:
    """Add minutes to a '06:30 AM' label -> arrival estimate label."""
    try:
        start = datetime.strptime(start_label, "%I:%M %p")
    except ValueError:
        return "(timing estimated)"
    total = start.hour * 60 + start.minute + int(minutes)
    total %= 1440
    return _mins_to_label(total)


def _estimate_transport(src: str, dst: str, km: float, profile: Dict[str, Any], budget: float) -> Dict[str, Any]:
    """Pick a realistic Indian transport corridor and per-traveller fare estimate."""
    pref = str(profile.get("transport_pref") or "").lower()
    contains = lambda *w: any(x in pref for x in w)

    wants_flight = contains("flight", "air")
    wants_train = contains("train", "rail", "metro")
    wants_bus = contains("bus", "volvo", "sleeper")
    wants_cab = contains("cab", "taxi", "car", "private", "self drive", "rental")
    budget = float(budget or 15000)

    # Mode selection: real corridors by distance + preference + budget.
    if km <= 180 and (wants_cab or (not wants_train and not wants_bus and not wants_flight)):
        mode, speed, base, per_km, floor = "Intercity cab", 45.0, 0, 9.0, 400.0
    elif wants_flight or (km > 1400 and not wants_train and not wants_bus):
        mode, speed, base, per_km, floor = "Flight", 720.0, 0, 3.1, 2300.0
    elif wants_bus or (km <= 650 and budget <= 9000):
        mode, speed, base, per_km, floor = "AC sleeper bus", 45.0, 0, 1.5, 350.0
    else:
        mode, speed, base, per_km, floor = "Train (AC / sleeper)", 58.0, 0, 0.95, 450.0

    if wants_flight and km > 500 and mode != "Flight":
        mode, speed, base, per_km, floor = "Flight", 720.0, 0, 3.1, 2300.0
    if wants_train and 150 <= km <= 2200 and mode != "Train (AC / sleeper)":
        mode, speed, base, per_km, floor = "Train (AC / sleeper)", 58.0, 0, 0.95, 450.0
    if wants_bus and mode not in ("AC sleeper bus", "Flight") and km <= 900:
        mode, speed, base, per_km, floor = "AC sleeper bus", 45.0, 0, 1.5, 350.0

    fare = round(base + km * per_km, 0)
    fare = max(floor, round(fare / 10.0) * 10)
    # High budgets upgrade comfort automatically within the same corridor.
    if budget >= 60000 and mode == "Train (AC / sleeper)":
        fare = round(fare * 1.6 / 10.0) * 10
    elif budget >= 40000 and mode == "AC sleeper bus":
        fare = round(fare * 1.3 / 10.0) * 10
    elif budget <= 9000 and mode == "Train (AC / sleeper)":
        fare = round(fare * 0.75 / 10.0) * 10

    travel_mins = max(40, km / speed * 60 + (150 if mode == "Flight" else 20))
    return {
        "type": mode,
        "code": "",                       # never invent a number
        "departure": "06:30 AM",
        "arrival": "",                    # derived label used in description
        "duration": f"{int(travel_mins // 60)}h {int(travel_mins % 60)}m",
        "duration_minutes": int(travel_mins),
        "fare": fare,
        "comfort_level": "estimated",
        "km": round(km, 0),
        "source": "estimate",
    }


def _stay_tier(pref_text: str) -> Dict[str, Any]:
    pref = (pref_text or "").lower().replace("\u2605", " star")
    for tier in STAY_TIERS:
        if any(w in pref for w in tier["words"]):
            return tier
    return dict(FALLBACK_STAY)


def _food_hint(destination: str, state: str) -> str:
    return CUISINE_HINT.get(state or "", "local Indian cuisine")


def _theme_for(day_num: int, experience: str, destination: str, first: bool, last: bool) -> Dict[str, Any]:
    exp = (experience or "").lower()
    pool = [t for t in _THEMES if not t["keys"] or any(k in exp for k in t["keys"])] or _THEMES
    if not any(t["keys"] for t in pool):
        pool = _THEMES
    theme = pool[(day_num - 1) % len(pool)]
    title = theme["title"].format(d=destination)
    desc = theme["desc"].format(d=destination)
    return {"title": title, "desc": desc}


def _mk_stop(**kw: Any) -> Dict[str, Any]:
    base: Dict[str, Any] = {
        "id": "est",
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
        "weather_note": None,
        "ai_note": None,
        "source": "estimate",
    }
    base.update(kw)
    return base


def build_estimate_plan(
    source_name: str,
    destination_name: str,
    source_state: str,
    destination_state: str,
    start_date: str,
    end_date: str,
    mode: str,
    profile: Dict[str, Any],
    source_coords: Dict[str, float],
    dest_coords: Dict[str, float],
) -> Dict[str, Any]:
    """Build an honest, fully-estimated itinerary for ANY India -> India pair."""
    days = _parse_days(start_date, end_date)
    budget = _parse_budget(profile)
    party = _party(profile)
    pax = party_headcount(party)
    nights = max(1, days - 1)
    rooms = max(1, math.ceil(pax / 2))

    km = _haversine_km(source_coords, dest_coords)
    transport = _estimate_transport(source_name, destination_name, km, profile, budget)
    tier = _stay_tier(profile.get("stay_pref"))

    # Stay estimate respects the declared budget (~36% of it) but never drops
    # below a real minimum for the chosen class.
    stay_target = max(500.0, (budget * 0.36) / max(nights, 1))
    nightly = max(float(tier["lo"]), min(stay_target, float(tier["hi"])))
    nightly = round(nightly / 50.0) * 50.0

    # Food estimate per traveller per day by budget band.
    if budget <= 10000:
        food_per_pax_day = 400.0
    elif budget <= 25000:
        food_per_pax_day = 650.0
    elif budget <= 60000:
        food_per_pax_day = 950.0
    else:
        food_per_pax_day = 1500.0

    # Activity allowance per traveller per day by interests + budget.
    exp = str(profile.get("experience") or "").lower() + " " + str(profile.get("activities") or "").lower()
    activity_allow_pax = 500.0
    if any(k in exp for k in ("adventure", "trek", "wildlife", "photography", "heritage", "museum", "culinary")):
        activity_allow_pax = 800.0
    if budget >= 60000:
        activity_allow_pax *= 1.8
    if budget <= 10000:
        activity_allow_pax = 300.0
    activity_allow_pax = round(activity_allow_pax, 0)

    stay_cost = nightly * nights * rooms
    transport_cost = transport["fare"] * 2 * pax
    food_total = 0.0
    activity_total = 0.0

    travel_long = transport["duration_minutes"] >= 360
    arrive_label = _time_label_from("06:30 AM", transport["duration_minutes"])

    long_travel_note = (
        f"Estimated one-way journey of {transport['duration']} covering ~{transport['km']:,.0f} km. "
        f"Live schedules and booking links are confirmed by your trip assistant — no train/flight number is invented."
    ) if travel_long else (
        f"Estimated one-way journey of ~{transport['km']:,.0f} km ({transport['duration']}), arriving around {arrive_label}. "
        "Live schedules confirmed by your trip assistant before travel."
    )

    day_blocks: List[Dict[str, Any]] = []
    for day_num in range(1, days + 1):
        day_stops: List[Dict[str, Any]] = []
        is_first = day_num == 1
        is_last = day_num == days
        food_hint = _food_hint(destination_name, destination_state)

        # Outbound journey on day one.
        if is_first:
            day_stops.append(_mk_stop(
                id=f"est-d{day_num}-t", day=day_num, time="06:30 AM",
                title=f"Estimated departure from {source_name}",
                description=(
                    f"{transport['type']} option {source_name} -> {destination_name}. {long_travel_note} "
                    f"Estimated one-way fare {_fmt_inr(transport['fare'])} per traveller."
                ),
                category="transport", location_name=f"{source_name} transit",
                lat=source_coords["lat"], lng=source_coords["lng"],
                estimated_cost=transport["fare"], duration_minutes=transport["duration_minutes"],
                ai_note="Estimated corridor — verified live by your assistant before travel.",
                transport_details={
                    "type": transport["type"], "code": "Estimate",
                    "departure": transport["departure"], "arrival": arrive_label,
                    "duration": transport["duration"], "fare": transport["fare"],
                    "comfort_level": "estimated",
                },
            ))

        # Safety briefing once with real national numbers.
        briefing_day = 1 if not travel_long or days == 1 else 2
        if day_num == briefing_day:
            day_stops.append(_mk_stop(
                id=f"est-d{day_num}-s", day=day_num,
                time="09:00 AM" if not travel_long else "08:30 AM",
                title="Trip safety & emergency briefing",
                description=(
                    f"National emergency numbers: Police/Emergency {NATIONAL_HELP['police_emergency']}, "
                    f"Ambulance {NATIONAL_HELP['ambulance']}, Tourist Helpline {NATIONAL_HELP['tourist_helpline']}, "
                    f"Railway Helpline {NATIONAL_HELP['railway_helpline']}. Your regional numbers are confirmed live by "
                    f"{'your guide' if mode == 'GUIDE_MODE' else 'the assistant'} on arrival."
                ),
                category="safety" if mode == "GUIDE_MODE" else "emergency",
                location_name=f"{destination_name} region",
                lat=dest_coords["lat"], lng=dest_coords["lng"],
                estimated_cost=0.0, duration_minutes=10,
                emergency_contact=NATIONAL_HELP["tourist_helpline"],
            ))

        # Stay check-in / check-out.
        if is_first:
            day_stops.append(_mk_stop(
                id=f"est-d{day_num}-h", day=day_num,
                time="03:00 PM" if travel_long else "02:00 PM",
                title=f"Check-in: {tier['label']} stays near {destination_name} centre",
                description=(
                    f"Estimated {_fmt_inr(tier['lo'])}–{_fmt_inr(tier['hi'])} per night for a {tier['label'].lower()} "
                    f"property ({_fmt_inr(nightly)} used in the estimate). Actual hotels are shortlisted and confirmed by "
                    "your assistant against your stay preference."
                ),
                category="stay", location_name=f"{destination_name} centre area",
                lat=dest_coords["lat"], lng=dest_coords["lng"],
                estimated_cost=nightly, duration_minutes=60,
                ai_note="Estimate — concrete hotels confirmed before travel.",
            ))
        elif is_last:
            day_stops.append(_mk_stop(
                id=f"est-d{day_num}-h", day=day_num, time="09:00 AM",
                title=f"Check-out — {tier['label']} stay, {destination_name}",
                description="Room check-out with luggage holding before the return journey.",
                category="stay", location_name=f"{destination_name} centre area",
                lat=dest_coords["lat"], lng=dest_coords["lng"],
                estimated_cost=0.0, duration_minutes=30,
            ))

        # Themed experience blocks on full days (and a light one on travel days).
        full_day = not (is_first and travel_long) and not (is_last and travel_long)
        if full_day or is_first or days == 1:
            blocks = 2 if full_day and not is_last else 1
            for b in range(blocks):
                theme = _theme_for(day_num * 2 + b, exp, destination_name, is_first, is_last)
                time_slot = ["09:30 AM", "02:30 PM"][b]
                if is_first and travel_long:
                    time_slot = "06:00 PM" if b == 0 else "07:00 PM"
                elif is_first and not travel_long and b == 1:
                    time_slot = "04:00 PM"
                cost = round(activity_allow_pax / blocks) if blocks else 0
                day_stops.append(_mk_stop(
                    id=f"est-d{day_num}-a{b}", day=day_num, time=time_slot,
                    title=theme["title"],
                    description=f"{theme['desc']} Included as a suggestion — entry prices are not pre-booked.",
                    category="attraction", location_name=destination_name,
                    lat=round(dest_coords["lat"] + 0.003 * (b + 1), 6),
                    lng=round(dest_coords["lng"] + 0.003 * (b + 1), 6),
                    estimated_cost=cost * pax, duration_minutes=120,
                    ai_note="Estimated experience block from your interest profile.",
                ))
                activity_total += cost * pax

        # Meals.
        if days == 1:
            meal_times = ["12:30 PM", "07:30 PM"]
        elif is_first:
            meal_times = ["07:30 PM"]
        elif is_last:
            meal_times = ["08:30 AM"]
        else:
            meal_times = ["12:30 PM", "07:30 PM"]
        for mi, mt in enumerate(meal_times):
            meal_pax = round(food_per_pax_day * 0.5 if len(meal_times) > 1 else food_per_pax_day)
            label = "Breakfast" if mt == "08:30 AM" else ("Lunch" if mt == "12:30 PM" else "Dinner")
            day_stops.append(_mk_stop(
                id=f"est-d{day_num}-f{mi}", day=day_num, time=mt,
                title=f"{label} — {food_hint} near {destination_name}",
                description=(
                    f"{label.lower()} allowance estimate of {_fmt_inr(meal_pax)} per traveller. Venues are shortlisted "
                    "live against your dietary preferences — never assumed."
                ),
                category="food", location_name=f"{destination_name} dining area",
                lat=round(dest_coords["lat"] - 0.002 * (mi + 1), 6),
                lng=round(dest_coords["lng"] - 0.002 * (mi + 1), 6),
                estimated_cost=meal_pax * pax, duration_minutes=60,
                ai_note="Estimate — verified dining shortlist confirmed before the meal.",
            ))
            food_total += meal_pax * pax

        # Return journey on the final day.
        if is_last and days > 1:
            day_stops.append(_mk_stop(
                id=f"est-d{day_num}-r", day=day_num, time="06:00 PM",
                title=f"Estimated return to {source_name}",
                description=(
                    f"Return on the {transport['type'].lower()} corridor ({transport['duration']}, ~{transport['km']:,.0f} km). "
                    "Round-trip fare is included in the transport estimate."
                ),
                category="transport", location_name=f"{destination_name} transit point",
                lat=dest_coords["lat"], lng=dest_coords["lng"],
                estimated_cost=transport["fare"], duration_minutes=transport["duration_minutes"],
                ai_note="Estimated corridor — verified live by your assistant before travel.",
            ))

        # Chronological sort (minutes since midnight), NOT lexicographic on the
        # 12-hour label — so the 06:30 AM departure is always the first step of
        # Day 1 and no check-in ever sorts ahead of the morning departure.
        day_stops.sort(key=lambda s: _clock_minutes(s.get("time")))
        if is_first:
            theme_name = "Arrival & Orientation"
        elif is_last and days > 1:
            theme_name = "Departure Day"
        else:
            theme_name = ["Signature Experiences", "Local Discovery"][day_num % 2]
        day_blocks.append({
            "day": day_num,
            "title": f"{destination_name} — {theme_name}",
            "stops": day_stops,
        })

    fees = compute_fees(
        mode=mode, days=days, budget=budget, destination=destination_name,
        party_type=party, luxury_level=profile.get("stay_pref"),
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
        "estimated_plan": True,
    }

    return {
        "version": 1,
        "total_cost": total,
        "cost_breakdown": cost_breakdown,
        "days": day_blocks,
    }
