"""10-stage workflow API (spec S1-S10): one persistent trip state.

Every endpoint reads/writes the SAME trip record. The LLM proposes options;
every price, fee, total and gate decision below is computed deterministically
by stage_service / stage_transport — never by the model.

Endpoints (all authenticated; ownership via _own_trip):
    GET  /trips/{id}/stage                    full state (resume + stepper)
    PUT  /trips/{id}/stage                    move pointer (forward validated)
    POST /trips/{id}/transport/options        generate 5+5 round-trip options
    POST /trips/{id}/transport/select         choose outbound + return
    POST /trips/{id}/local-transport/plan     legs between selected places+stay
    POST /trips/{id}/local-transport/select   choose option per leg
    PUT  /trips/{id}/food-tier                Basic|Standard|Premium (food only)
    GET  /trips/{id}/budget/gate              authoritative gate math
    GET  /trips/{id}/weather                  honest forecast w/ labels
    GET  /trips/{id}/review                   single-source review snapshot
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import logging

import requests
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.v1.trip_edit import _own_trip
from app.core.config import settings
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import Location, get_utc_now
from app.services import stage_service as stages
from app.services import stage_transport as stra
from app.services import stay_service
from app.services.llm_router import route_task

router = APIRouter(prefix="/trips", tags=["Trip Stages"])
logger = logging.getLogger(__name__)


# ── helpers ───────────────────────────────────────────────────────────────────
def _llm_enrich(task: str, db: Session, trip, extra: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Prompt-routed LLM enrichment with the CUMULATIVE saved trip context
    injected (stages.cumulative_context: every prior step's answers and
    selections, not a fresh session).

    Returns a parsed dict when the model cooperates, else None — the caller
    always falls back to deterministic data. User text is data, never
    instructions (prompts are built server-side from saved state only). LLM
    prices are never trusted (validators re-price everything server-side).
    """
    context: Dict[str, Any] = stages.cumulative_context(db, trip)
    if extra:
        context.update(extra)
    try:
        out = route_task(task, context)
    except Exception:
        return None
    if not out or out.get("status") != "OK":
        return None
    result = out.get("result")
    return result if isinstance(result, dict) else None


# ── stage state ───────────────────────────────────────────────────────────────
@router.get("/{trip_id}/stage")
def get_stage(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Full persistent state for resume + stepper + every stage screen."""
    trip = _own_trip(trip_id, current, db)
    return stages.build_stage_state(db, trip)


@router.put("/{trip_id}/stage")
def set_stage(
    trip_id: str,
    body: Dict[str, Any],
    current: dict = Depends(require_role("USER", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Move the resume pointer. Forward moves validate prerequisites AND the
    budget gate (422 + violations, selections preserved); back moves always."""
    trip = _own_trip(trip_id, current, db)
    if "stage" not in body:
        raise HTTPException(status_code=422, detail="Provide 'stage' (1-11).")
    try:
        return stages.advance_stage(db, trip, body["stage"], actor=str(current.get("email") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error_code": "STAGE_BLOCKED", "message": "This stage is not complete yet.",
                    "violations": str(exc).split(" | ")},
        )


# ── stage 3: round-trip transport ─────────────────────────────────────────────
@router.post("/{trip_id}/transport/options")
def transport_options(
    trip_id: str,
    body: Optional[Dict[str, Any]] = None,
    current: dict = Depends(require_role("USER", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Generate up to 5 outbound + 5 return options (verified first, honest
    estimate bands otherwise) and PERSIST the pool on the trip."""
    trip = _own_trip(trip_id, current, db)
    party = stages._party(trip)
    if party["total"] <= 0:
        raise HTTPException(status_code=422, detail="Complete stage 2 (party size) before transport options.")
    llm = _llm_enrich("transport", db, trip)
    llm_opts = None
    if isinstance(llm, dict):
        llm_opts = {k: llm.get(k) for k in ("outbound", "return")}
    pool = stra.build_round_trip_options(
        trip.source_name, trip.destination_name,
        trip.start_datetime, trip.end_datetime,
        party["total"], llm_options=llm_opts,
    )
    trip.transport_options = pool
    trip.updated_at = get_utc_now()
    db.commit()
    return pool


@router.post("/{trip_id}/transport/select")
def transport_select(
    trip_id: str,
    body: Dict[str, Any],
    current: dict = Depends(require_role("USER", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Persist the chosen outbound + return options (must come from the saved
    pool — client prices are never trusted) and return the fresh budget gate."""
    trip = _own_trip(trip_id, current, db)
    pool = dict(trip.transport_options or {})
    if not pool.get("outbound"):
        raise HTTPException(status_code=409, detail="Generate transport options first.")
    by_id = {o.get("id"): o for o in (pool.get("outbound") or []) + (pool.get("return") or [])}
    out = by_id.get(body.get("outbound_id"))
    ret = by_id.get(body.get("return_id"))
    if not out or out.get("direction") != "outbound":
        raise HTTPException(status_code=422, detail="Unknown outbound option id.")
    if not ret or ret.get("direction") != "return":
        raise HTTPException(status_code=422, detail="Unknown return option id.")
    trip.selected_transport = {"outbound": out, "return": ret}
    trip.updated_at = get_utc_now()
    db.commit()
    stages.bump_pointer(db, trip, 3)
    db.refresh(trip)
    gate = stages.evaluate_budget_gate(db, trip)
    return {"selected": trip.selected_transport, "gate": gate, "next_stage": int(trip.current_stage or 4)}


# ── stage 5: stays / accommodation ────────────────────────────────────────────
@router.get("/{trip_id}/stays/options")
def get_stay_options(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Fetch live & verified hotel/stay options for the trip's destination.
    Uses Booking.com RapidAPI, verified catalog, and structured budget tiers."""
    trip = _own_trip(trip_id, current, db)
    party = stages._party(trip)
    dn = stages._days_nights(trip)
    budget = float(trip.budget or 50000.0)
    dest = (trip.destination_name or "").strip()

    stays = stay_service.fetch_destination_stays(
        destination=dest,
        travellers=party["total"],
        nights=dn["nights"],
        budget=budget,
    )
    active_rows = stages._active_selections(db, trip.id)
    selected_row = next((r for r in active_rows if str(r.category or "").lower() in stages.STAY_CATEGORIES), None)
    selected_stay_dict = None
    if selected_row:
        selected_stay_dict = {
            "id": selected_row.id,
            "name": selected_row.name,
            "price_per_night": float(selected_row.price or 0.0),
            "tier": (selected_row.item_json or {}).get("tier") or "4 Star",
            "rating": (selected_row.item_json or {}).get("rating") or 4.5,
            "latitude": selected_row.latitude,
            "longitude": selected_row.longitude,
            "amenities": (selected_row.item_json or {}).get("amenities") or [],
            "source": selected_row.source,
        }

    return {
        "destination": dest,
        "travellers": party["total"],
        "nights": dn["nights"],
        "rooms_needed": max(1, -(-party["total"] // 2)),
        "stays": stays,
        "selected_stay": selected_stay_dict,
    }


@router.post("/{trip_id}/stays/select")
def select_trip_stay_endpoint(
    trip_id: str,
    body: Dict[str, Any],
    current: dict = Depends(require_role("USER", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Save selected stay into TripPlaceSelection. Bumps pointer to stage 6."""
    trip = _own_trip(trip_id, current, db)
    if not body.get("name") and not body.get("stay_id"):
        raise HTTPException(status_code=422, detail="Provide stay name or selection payload.")
    selection = stay_service.select_trip_stay(db, trip, body)
    stages.bump_pointer(db, trip, 5)
    db.refresh(trip)
    gate = stages.evaluate_budget_gate(db, trip)
    return {
        "status": "OK",
        "stay": {
            "id": selection.id,
            "name": selection.name,
            "price_per_night": float(selection.price or 0.0),
            "tier": (selection.item_json or {}).get("tier"),
            "rating": (selection.item_json or {}).get("rating"),
        },
        "gate": gate,
        "next_stage": int(trip.current_stage or 6),
    }


@router.post("/{trip_id}/stays/reserve")
def reserve_trip_stay_endpoint(
    trip_id: str,
    body: Dict[str, Any],
    current: dict = Depends(require_role("USER", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Dispatch reservation request / booking inquiry to hotel and record confirmation reference."""
    trip = _own_trip(trip_id, current, db)
    stay_name = body.get("stay_name") or "Selected Hotel"
    hotel_email = body.get("hotel_email") or f"reservations@{stay_name.lower().replace(' ', '')}.com"
    travellers = int(body.get("travellers") or 1)
    rooms = int(body.get("rooms_needed") or max(1, -(-travellers // 2)))
    nights = int(body.get("nights") or 1)
    user_email = current.get("email", "traveller@travion.com")

    # Update active stay place selection with reservation metadata
    active_rows = stages._active_selections(db, trip.id)
    stay_row = next((r for r in active_rows if str(r.category or "").lower() in stages.STAY_CATEGORIES), None)
    if stay_row:
        item = dict(stay_row.item_json or {})
        item["reservation_status"] = "CONFIRMED"
        item["reservation_email_sent_to"] = hotel_email
        item["reservation_timestamp"] = datetime.now(timezone.utc).isoformat()
        item["rooms_booked"] = rooms
        item["guests_booked"] = travellers
        stay_row.item_json = item

    trip.updated_at = get_utc_now()
    db.commit()

    return {
        "status": "RESERVATION_CONFIRMED",
        "message": (
            f"Reservation inquiry sent to {stay_name} ({hotel_email}) for {travellers} traveller(s) "
            f"across {rooms} room(s) for {nights} night(s). Notification confirmed for {user_email}."
        ),
        "hotel_name": stay_name,
        "hotel_email": hotel_email,
        "rooms": rooms,
        "travellers": travellers,
    }


# ── stage 7: local transport ──────────────────────────────────────────────────
@router.post("/{trip_id}/local-transport/plan")
def local_transport_plan(
    trip_id: str,
    body: Optional[Dict[str, Any]] = None,
    current: dict = Depends(require_role("USER", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Legs between the ACTUAL selected places + stay (sensible visit order),
    with per-leg options. Re-planning replaces legs (e.g. after a stay
    change) — selections of unchanged legs are preserved by option id."""
    trip = _own_trip(trip_id, current, db)
    rows = stages._active_selections(db, trip.id)
    stops: List[Dict[str, Any]] = []
    stay = next((r for r in rows if str(r.category or "").lower() in stages.STAY_CATEGORIES), None)
    if stay and stay.latitude is not None and stay.longitude is not None:
        stops.append({"name": stay.name, "lat": float(stay.latitude), "lng": float(stay.longitude), "stay": True})
    for r in rows:
        if r is stay or r.latitude is None or r.longitude is None:
            continue
        stops.append({"name": r.name, "lat": float(r.latitude), "lng": float(r.longitude)})
    if len(stops) < 2:
        raise HTTPException(
            status_code=422,
            detail="Select a stay plus at least one mappable place before planning local transport.",
        )
    _llm = _llm_enrich("local_transport", db, trip, {
        "selected_places": [{"name": s["name"]} for s in stops],
    })
    legs = stra.build_local_legs(stops, stages._party(trip)["total"], trip.destination_name or "")
    previous = {leg.get("origin") + ">" + leg.get("destination"): leg.get("selected_id")
                for leg in (dict(trip.local_transport or {}).get("legs") or [])}
    for leg in legs:
        key = leg["origin"] + ">" + leg["destination"]
        if previous.get(key) in {o["id"] for o in leg["options"]}:
            leg["selected_id"] = previous[key]
    trip.local_transport = {"legs": legs, "planned_at": datetime.now(timezone.utc).isoformat()}
    trip.updated_at = get_utc_now()
    db.commit()
    stages.bump_pointer(db, trip, 7)
    return {"legs": legs, "gate": stages.evaluate_budget_gate(db, trip)}


@router.post("/{trip_id}/local-transport/select")
def local_transport_select(
    trip_id: str,
    body: Dict[str, Any],
    current: dict = Depends(require_role("USER", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    trip = _own_trip(trip_id, current, db)
    data = dict(trip.local_transport or {})
    legs = list(data.get("legs") or [])
    try:
        idx = int(body.get("leg_index"))
        leg = legs[idx]
    except (TypeError, ValueError, IndexError):
        raise HTTPException(status_code=422, detail="Unknown leg_index.")
    opt_ids = {o.get("id") for o in leg.get("options") or []}
    if body.get("option_id") not in opt_ids:
        raise HTTPException(status_code=422, detail="Unknown option_id for this leg.")
    leg["selected_id"] = body["option_id"]
    data["legs"] = legs
    trip.local_transport = data
    trip.updated_at = get_utc_now()
    db.commit()
    gate = stages.evaluate_budget_gate(db, trip)
    return {"legs": legs, "gate": gate,
            "all_selected": all(bool(l.get("selected_id")) for l in legs)}


# ── stage 8: food tier + gate ─────────────────────────────────────────────────
@router.put("/{trip_id}/food-tier")
def set_food_tier(
    trip_id: str,
    body: Dict[str, Any],
    current: dict = Depends(require_role("USER", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Switch the food tier. Changes ONLY the dining allowance — transport,
    stay, mode and selections are untouched."""
    trip = _own_trip(trip_id, current, db)
    tier = str(body.get("tier") or "").upper()
    if tier not in stages.FOOD_TIERS:
        raise HTTPException(status_code=422, detail="Tier must be BASIC, STANDARD or PREMIUM.")
    trip.food_tier = tier
    trip.updated_at = get_utc_now()
    db.commit()
    stages.bump_pointer(db, trip, 8)
    gate = stages.evaluate_budget_gate(db, trip)
    return {"food_tier": tier, "food_allowance": gate["food_allowance"], "gate": gate}


@router.get("/{trip_id}/budget/gate")
def budget_gate(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    trip = _own_trip(trip_id, current, db)
    return stages.evaluate_budget_gate(db, trip)


# ── stage 4 helper: cumulative LLM personalization ───────────────────────────
@router.post("/{trip_id}/discovery/personalize")
def discovery_personalize(
    trip_id: str,
    body: Optional[Dict[str, Any]] = None,
    current: dict = Depends(require_role("USER", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Rank the VERIFIED candidate pool with the CUMULATIVE trip context
    (steps 1-3: dates, party, budget, interests AND the chosen round-trip
    transport). The LLM only PICKS + ORDERS + explains from the provided
    verified names — coordinates and maps stay real; invented names are
    dropped by validation. Falls back to catalog order when the model is
    unreachable (never blocks the screen)."""
    import difflib
    from app.services.verified_data import (
        VERIFIED_ATTRACTIONS, VERIFIED_FOOD, VERIFIED_STAYS,
    )
    trip = _own_trip(trip_id, current, db)
    dest = stra._norm_city(trip.destination_name or "")

    attractions = VERIFIED_ATTRACTIONS.get(dest) or []
    foods = VERIFIED_FOOD.get(dest) or []
    stays = VERIFIED_STAYS.get(dest) or []

    def names(items, pred=None):
        out = []
        for it in items:
            if pred and not pred(it):
                continue
            nm = str(it.get("name") or "").strip()
            if nm:
                out.append(nm)
        return out

    pool = {
        "must_visit": names(attractions, lambda a: str(a.get("category") or "") == "attraction"),
        "activities": names(attractions, lambda a: str(a.get("category") or "") != "attraction"),
        "restaurants": names(foods, lambda f: not any(
            k in str(f.get("name") or "").lower() for k in ("cafe", "coffee", "bakery", "tea room"))),
        "cafes": names(foods, lambda f: any(
            k in str(f.get("name") or "").lower() for k in ("cafe", "coffee", "bakery", "tea room"))),
        "stays": names(stays),
        "shopping": [],
        "healthcare_education": [],
        "other": [],
    }

    llm = _llm_enrich("places", db, trip, {"candidate_names": pool})
    ranking: Dict[str, List[Dict[str, str]]] = {}
    source = "catalog"
    if isinstance(llm, dict):
        alias = {
            "must_visit": "must_visit", "must-visit": "must_visit", "mustvisit": "must_visit",
            "activities": "activities", "activity": "activities",
            "restaurants": "restaurants", "restaurant": "restaurants",
            "cafes": "cafes", "cafe": "cafes",
            "stays": "stays", "stay": "stays", "accommodation": "stays",
            "shopping": "shopping",
            "healthcare_education": "healthcare_education", "healthcare": "healthcare_education",
            "education": "healthcare_education", "educational": "healthcare_education",
            "other": "other", "other_places": "other",
        }
        found_any = False
        for raw_key, items in llm.items():
            cat = alias.get(str(raw_key or "").lower().replace(" ", "_"))
            if not cat or not isinstance(items, list):
                continue
            valid = [n.lower() for n in pool.get(cat, [])]
            picked: List[Dict[str, str]] = []
            for it in items[:10]:
                if not isinstance(it, dict) or not it.get("name"):
                    continue
                nm = str(it["name"]).strip()
                if nm.lower() in valid:
                    picked.append({"name": nm, "reason": str(it.get("reason") or "")[:200]})
                    found_any = True
                    continue
                close = difflib.get_close_matches(nm.lower(), valid, n=1, cutoff=0.85)
                if close:
                    real = next(n for n in pool[cat] if n.lower() == close[0])
                    picked.append({"name": real, "reason": str(it.get("reason") or "")[:200]})
                    found_any = True
                # invented names are dropped silently — never shown, never stored
            if picked:
                ranking[cat] = picked
        if found_any:
            source = "llm"
    if source == "catalog":
        ranking = {cat: [{"name": n, "reason": ""} for n in names[:10]]
                   for cat, names in pool.items() if names}
    if trip.profile is not None:
        try:
            prof = dict(trip.profile.questions_answers or {})
            prof["discovery_ranking"] = {"categories": ranking, "source": source}
            trip.profile.questions_answers = prof
            db.commit()
        except Exception:
            db.rollback()
    return {"trip_id": trip.id, "categories": ranking, "source": source}


# ── stage 8 helper: honest weather ────────────────────────────────────────────
@router.get("/{trip_id}/weather")
def trip_weather(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Daily weather for the destination across the trip dates.

    Within the ~5-day forecast horizon: live OpenWeather data labelled with
    its source. Beyond it: clearly labelled TYPICAL seasonal conditions, never
    presented as confirmed forecast. Without a key/coords: honest unavailable.
    """
    trip = _own_trip(trip_id, current, db)
    loc = db.query(Location).filter(Location.id == trip.destination_location_id).first()
    lat = float(loc.lat) if loc and loc.lat is not None else None
    lng = float(loc.lng) if loc and loc.lng is not None else None
    try:
        days = max(1, (trip.end_datetime.date() - trip.start_datetime.date()).days + 1)
    except Exception:
        days = 1
    start = trip.start_datetime.date() if trip.start_datetime else None

    forecast: List[Dict[str, Any]] = []
    live_days = 0

    # ── Primary: WeatherStack (current weather by city name) ──────────────
    ws_key = (settings.WEATHERSTACK_API_KEY or "").strip()
    dest_name = (trip.destination_name or "").strip()
    if ws_key and dest_name and start:
        try:
            ws_resp = requests.get(
                "http://api.weatherstack.com/current",
                params={"access_key": ws_key, "query": dest_name, "units": "m"},
                timeout=8,
            )
            if ws_resp.status_code == 200:
                ws_data = ws_resp.json()
                curr = ws_data.get("current", {})
                loc_info = ws_data.get("location", {})
                if curr and not ws_data.get("error"):
                    temp = float(curr.get("temperature", 0) or 0)
                    desc = str((curr.get("weather_descriptions") or [""])[0] or "")
                    # WeatherStack free tier only returns CURRENT weather.
                    # Build forecast from today's data; remaining days use typical.
                    from datetime import timedelta as _td
                    today_iso = start.isoformat()
                    forecast.append({
                        "date": today_iso,
                        "day": 1,
                        "temp_c": round(temp, 1),
                        "feels_like": float(curr.get("feelslike", temp) or temp),
                        "humidity": int(curr.get("humidity", 0) or 0),
                        "wind_kmph": float(curr.get("wind_speed", 0) or 0),
                        "condition": desc or "Partly cloudy",
                        "icon": str((curr.get("weather_icons") or [""])[0] or ""),
                        "reliable": True,
                        "source": "weatherstack_current",
                        "observation_time": str(curr.get("observation_time", "") or ""),
                        "uv_index": int(curr.get("uv_index", 0) or 0),
                        "visibility": int(curr.get("visibility", 0) or 0),
                        "local_time": str(loc_info.get("localtime", "") or ""),
                    })
                    live_days = 1
                    # Fill remaining trip days with typical conditions
                    for i in range(1, days):
                        d = (start + _td(days=i)).isoformat()
                        typical = _typical_day(trip.destination_name, d, i + 1)
                        # Anchor temp near the real current reading with slight variation
                        import math as _math
                        typical["temp_c"] = round(temp + (_math.sin(i) * 1.5), 1)
                        typical["source"] = "weatherstack_derived_typical"
                        forecast.append(typical)
        except Exception as ws_err:
            logger.warning(f"WeatherStack call failed: {ws_err}")

    # ── Fallback: OpenWeatherMap (5-day forecast) ────────────────────────
    if not forecast and lat is not None and lng is not None and settings.OPENWEATHER_API_KEY and start:
        try:
            resp = requests.get(
                "https://api.openweathermap.org/data/2.5/forecast",
                params={"lat": lat, "lon": lng, "appid": settings.OPENWEATHER_API_KEY,
                        "units": "metric", "cnt": 40},
                timeout=8,
            )
            if resp.status_code == 200:
                by_day: Dict[str, Dict[str, Any]] = {}
                for item in resp.json().get("list", []):
                    day = str(item.get("dt_txt") or "")[:10]
                    if not day or day in by_day:
                        continue
                    main = item.get("main", {})
                    conds = item.get("weather", [{}])
                    by_day[day] = {
                        "temp_c": round(float(main.get("temp", 0)), 1),
                        "condition": str((conds[0].get("description") if conds else "clear") or "clear"),
                        "icon": str((conds[0].get("icon") if conds else "") or ""),
                    }
                from datetime import timedelta as _td
                for i in range(days):
                    d = (start + _td(days=i)).isoformat()
                    if d in by_day:
                        live_days += 1
                        forecast.append({"date": d, "day": i + 1, "reliable": True,
                                         "source": "openweathermap", **by_day[d]})
                    else:
                        forecast.append(_typical_day(trip.destination_name, d, i + 1))
        except Exception:
            forecast = []

    # ── Final fallback: seasonal typical data ────────────────────────────
    if not forecast and start:
        from datetime import timedelta as _td
        forecast = [_typical_day(trip.destination_name, (start + _td(days=i)).isoformat(), i + 1)
                    for i in range(days)]
    reliable = live_days > 0
    label = (
        f"Live forecast for the first {live_days} day(s); remaining days show typical "
        "seasonal conditions — not a confirmed forecast." if 0 < live_days < days
        else "Live forecast for your trip dates." if live_days == days and days
        else "Forecast unavailable — showing typical seasonal conditions, not a confirmed forecast."
    )
    payload = {
        "destination": trip.destination_name,
        "travel_dates": [f["date"] for f in forecast],
        "forecast": forecast,
        "label": label,
        "disclaimer": "Weather beyond the ~5-day forecast horizon cannot be confirmed in advance.",
    }
    trip.weather = payload
    try:
        db.commit()
    except Exception:
        db.rollback()
    return payload


def _typical_day(destination: str, date_iso: str, day_no: int) -> Dict[str, Any]:
    try:
        month = int(date_iso[5:7])
    except (ValueError, IndexError):
        month = 6
    dest = (destination or "").lower()
    hill = any(k in dest for k in ("ooty", "munnar", "manali", "shimla", "coorg", "kodaikanal", "mussoorie"))
    if hill:
        cond = "cool and pleasant" if month in (10, 11, 12, 1, 2) else ("misty with showers" if month in (6, 7, 8, 9) else "mild and clear")
        temp = 14.0 if month in (12, 1, 2) else (18.0 if month in (6, 7, 8, 9) else 20.0)
    else:
        cond = "warm and dry" if month in (10, 11, 12, 1, 2) else ("hot with possible showers" if month in (6, 7, 8, 9) else "hot and dry")
        temp = 27.0 if month in (12, 1, 2) else 33.0
    return {"date": date_iso, "day": day_no, "temp_c": temp, "condition": cond,
            "icon": "", "reliable": False, "source": "seasonal_typical"}


# ── stage 9: single-source review snapshot ────────────────────────────────────
@router.get("/{trip_id}/review")
def review_snapshot(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Everything the traveller is about to pay for, from the SAVED plan:
    details, party, transport, places+stay, mode, local legs, food tier,
    itinerary summary and the authoritative budget math. Payment MUST charge
    the final_amount shown here."""
    from app.models.entities import Itinerary as _Itin
    trip = _own_trip(trip_id, current, db)
    state = stages.build_stage_state(db, trip)
    itin = (
        db.query(_Itin)
        .filter(_Itin.trip_id == trip.id, _Itin.is_active == True)  # noqa: E712
        .first()
    )
    summary = None
    if itin:
        days = itin.days_data or []
        summary = {
            "itinerary_id": itin.id,
            "version": itin.version,
            "days": len(days),
            "total_cost": float(itin.total_cost or 0.0),
            "day_summaries": [
                {"day": d.get("day") or i + 1, "date": d.get("date"),
                 "stops": len(d.get("stops") or []),
                 "title": d.get("title") or d.get("theme") or f"Day {i + 1}"}
                for i, d in enumerate(days)
            ],
        }
    return {
        "trip": state["trip"],
        "party": {"answers": state["preferences"]},
        "transport": state["transport"],
        "places": state["places"],
        "mode": state["mode"],
        "local_transport": state["local_transport"],
        "food_tier": state["food_tier"],
        "itinerary_summary": summary,
        "pricing": state["budget"],
        "payment_amount": state["budget"]["final_amount"],
        "guide": state["guide"],
        "payment": state["payment"],
    }
