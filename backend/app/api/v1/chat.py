"""Travion AI — context-aware trip assistant.

The assistant answers "what does this message mean inside this trip?", not
"What does this message look like?". It reasons over the real trip record:
active itinerary, structured preferences, actual payment/settlement records,
verified destination data, conversation history for the current trip only,
and the traveller's real GPS position when shared. Real-world facts are only
ever quoted from those verified sources — never invented.
"""
import math
import re
import requests
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_identity
from app.core.config import settings
from app.models.entities import (
    Trip, ChatMessage, User, Guide, Itinerary, TripProfile,
    Payment, PaymentSplit, GuideAssignment, ReplanningLog,
)
from app.services.verified_data import (
    VERIFIED_LOCATIONS, VERIFIED_STAYS, VERIFIED_FOOD, VERIFIED_SAFETY_INFO,
    VERIFIED_ATTRACTIONS,
)
from app.services.itinerary_tools import find_stop, remove_stop, move_stop_time, add_rest_day
from app.schemas.schemas import ChatMessageCreate, ChatMessageResponse

router = APIRouter(prefix="/trips", tags=["Chat"])

_RUPEE = "\u20b9"


# ─────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────
@router.get("/{trip_id}/chat-history", response_model=List[ChatMessageResponse])
def get_trip_chat_history(
    trip_id: str,
    channel: str = Query("AI", pattern="^(AI|GUIDE)$"),
    current: dict = Depends(get_current_identity),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    if channel == "GUIDE":
        if trip.status not in ["GUIDE_ASSIGNED", "PAID", "ACTIVE", "COMPLETED"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Guide chat is unlocked only after a local guide is assigned by the operations manager."
            )

    messages = db.query(ChatMessage).filter(
        ChatMessage.trip_id == trip.id,
        ChatMessage.channel == channel
    ).order_by(ChatMessage.created_at.asc()).all()
    return messages


@router.post("/{trip_id}/chat-message", response_model=ChatMessageResponse)
def send_chat_message(
    trip_id: str,
    req: ChatMessageCreate,
    current: dict = Depends(get_current_identity),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    sender_name = "User"
    if current["role"] == "USER":
        user = db.query(User).filter(User.identity_id == current["identity_id"]).first()
        if user:
            sender_name = f"{user.first_name} {user.last_name}".strip() or "Traveller"
    elif current["role"] == "GUIDE":
        guide = db.query(Guide).filter(Guide.identity_id == current["identity_id"]).first()
        if guide:
            sender_name = f"{guide.first_name} {guide.last_name}".strip() or "Guide"

    if req.channel == "GUIDE":
        if trip.status not in ["GUIDE_ASSIGNED", "PAID", "ACTIVE", "COMPLETED"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Guide chat is unlocked only after assignment."
            )

    user_msg = ChatMessage(
        trip_id=trip.id,
        sender_role=current["role"],
        sender_id=current["identity_id"],
        sender_name=sender_name,
        message=req.message,
        channel=req.channel,
        lat=req.lat,
        lng=req.lng,
    )
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    if req.channel == "AI":
        reply_text = generate_ai_reply(db, trip, req.message, lat=req.lat, lng=req.lng)
        ai_msg = ChatMessage(
            trip_id=trip.id,
            sender_role="AI",
            sender_id="travion-ai-assistant",
            sender_name="Travion AI",
            message=reply_text,
            channel="AI",
        )
        db.add(ai_msg)
        db.commit()

    return user_msg


# ─────────────────────────────────────────────────────────────────────────
# Verified-data helpers
# ─────────────────────────────────────────────────────────────────────────
def _verified_dest_key(dest: str) -> str:
    if dest in VERIFIED_STAYS:
        return dest
    norm = (dest or "").strip().lower()
    for loc in VERIFIED_LOCATIONS:
        name = loc["name"].lower()
        if norm == name or (norm and (norm in name or name in norm)):
            return loc["name"]
    return ""


def _fmt_inr(amount: Any) -> str:
    try:
        return f"{_RUPEE}{float(amount):,.0f}"
    except (TypeError, ValueError):
        return f"{_RUPEE}0"


def _parse_12h(value: str) -> Optional[int]:
    """'02:00 PM' -> minutes since midnight."""
    m = re.search(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)", value, re.IGNORECASE)
    if not m:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2) or 0)
    meridiem = m.group(3).lower()
    if meridiem == "pm" and hour != 12:
        hour += 12
    if meridiem == "am" and hour == 12:
        hour = 0
    return hour * 60 + minute


def _now_minutes() -> int:
    return datetime.now().hour * 60 + datetime.now().minute


def _haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    try:
        r = 6371.0
        p1, p2 = math.radians(a_lat), math.radians(b_lat)
        dp = math.radians(b_lat - a_lat)
        dl = math.radians(b_lng - a_lng)
        h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return round(2 * r * math.asin(math.sqrt(h)), 1)
    except Exception:
        return 0.0


def _weather_at(lat: Optional[float], lng: Optional[float]) -> Optional[Dict[str, Any]]:
    if lat is None or lng is None or not settings.OPENWEATHER_API_KEY:
        return None
    try:
        resp = requests.get(
            "https://api.openweathermap.org/data/2.5/weather",
            params={"lat": lat, "lon": lng, "appid": settings.OPENWEATHER_API_KEY, "units": "metric"},
            timeout=6,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        main = data.get("main", {})
        conds = data.get("weather", [{}])
        return {
            "temp": round(float(main.get("temp", 0)), 1),
            "feels_like": round(float(main.get("feels_like", 0)), 1),
            "condition": str(conds[0].get("description", "clear") if conds else "clear"),
            "place": data.get("name", ""),
        }
    except Exception:
        return None


def _gemini_reply(question: str, system_context: str) -> Optional[str]:
    """Optional Gemini reasoning for open-ended travel questions. Strictly
    grounded: Gemini may only reason over the provided trip context and must
    never invent facts. Any failure degrades to the deterministic engine."""
    if not settings.GEMINI_API_KEY:
        return None
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={settings.GEMINI_API_KEY}"
        prompt = (
            "You are Travion, a travel assistant for a specific trip. You may ONLY use the "
            "provided trip context. Never invent facts, prices, times, weather, distances or "
            "availability. If the context does not contain the answer, say you cannot verify it. "
            "Keep the reply under 120 words, natural, no emojis. Refuse non-travel questions politely.\n\n"
            f"TRIP CONTEXT:\n{system_context}\n\nTRAVELLER: {question}"
        )
        resp = requests.post(url, json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=12)
        if resp.status_code != 200:
            return None
        parts = resp.json().get("candidates", [{}])[0].get("content", {}).get("parts", [])
        text = (parts[0].get("text", "") if parts else "").strip()
        return text or None
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────
# Context bundle
# ─────────────────────────────────────────────────────────────────────────
def _active_itinerary(db: Session, trip: Trip) -> Optional[Itinerary]:
    return db.query(Itinerary).filter(
        Itinerary.trip_id == trip.id, Itinerary.is_active == True
    ).first()


def _conversation(db: Session, trip: Trip, limit: int = 14) -> List[Dict[str, str]]:
    rows = db.query(ChatMessage).filter(
        ChatMessage.trip_id == trip.id, ChatMessage.channel == "AI"
    ).order_by(ChatMessage.created_at.asc()).all()
    return [{"role": m.sender_role, "text": m.message} for m in rows[-limit:]]


def _build_context(db: Session, trip: Trip) -> Dict[str, Any]:
    dest = trip.destination_name or ""
    key = _verified_dest_key(dest)
    itin = _active_itinerary(db, trip)
    days = (itin.days_data or []) if itin else []
    breakdown = (itin.cost_breakdown or {}) if itin else {}

    prefs = {}
    if trip.profile:
        prefs = trip.profile.questions_answers or {}
        if isinstance(prefs, dict):
            for col in ("party_type", "experience_type", "food_pref", "stay_pref",
                        "transport_pref", "walking_tolerance", "priority"):
                if not prefs.get(col):
                    prefs[col] = getattr(trip.profile, col, "") or ""

    payments = db.query(Payment).filter(Payment.trip_id == trip.id).all()
    paid_total = sum(float(p.total_amount or 0) for p in payments if p.status == "SUCCESS")
    splits = [p.split for p in payments if p.split]

    guide_data = None
    if trip.guide_assignment and trip.guide_assignment.guide:
        g = trip.guide_assignment.guide
        guide_data = {
            "name": f"{g.first_name} {g.last_name}".strip(),
            "phone": g.phone,
            "rating": g.rating,
            "specializations": g.specializations or [],
            "status": g.status,
        }

    verified = {"stays": [], "foods": [], "attractions": [], "safety": {}}
    if key:
        verified["stays"] = VERIFIED_STAYS.get(key, [])
        verified["foods"] = VERIFIED_FOOD.get(key, [])
        verified["attractions"] = VERIFIED_ATTRACTIONS.get(key, [])
        verified["safety"] = VERIFIED_SAFETY_INFO.get(key, {})

    return {
        "trip": trip,
        "dest": dest,
        "key": key,
        "itinerary": itin,
        "days": days,
        "breakdown": breakdown,
        "prefs": prefs,
        "payments": payments,
        "splits": splits,
        "paid_total": paid_total,
        "guide": guide_data,
        "verified": verified,
        "history": _conversation(db, trip),
    }


def _all_stops(days: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [s for d in (days or []) for s in (d.get("stops", []) or [])]


# ─────────────────────────────────────────────────────────────────────────
# Next-stop engine
# ─────────────────────────────────────────────────────────────────────────
def _next_stop(ctx: Dict[str, Any], lat: Optional[float], lng: Optional[float]) -> Dict[str, Any]:
    days = ctx["days"]
    stops = _all_stops(days)
    if not stops:
        return {"stop": None, "reason": "no_plan"}

    trip: Trip = ctx["trip"]
    start = trip.start_datetime if trip.start_datetime.tzinfo else trip.start_datetime.replace(tzinfo=timezone.utc)
    today = datetime.now(timezone.utc).date()
    start_day = start.date()

    if today < start_day:
        # Trip has not begun yet.
        first = stops[0]
        return {"stop": first, "reason": "pre_trip", "note": f"Your trip starts on {start_day.strftime('%d %b')}."}
    if today > (trip.end_datetime or start).date():
        return {"stop": None, "reason": "completed"}

    elapsed = max(0, (today - start_day).days)  # day index = elapsed + 1
    now_min = _now_minutes()

    upcoming: List[Dict[str, Any]] = []
    for s in stops:
        t = _parse_12h(str(s.get("time", "")))
        if t is None:
            continue
        if s.get("day", 0) == elapsed + 1 and t > now_min:
            upcoming.append(s)
    if upcoming:
        upcoming.sort(key=lambda s: _parse_12h(str(s.get("time", ""))) or 0)
        nxt = upcoming[0]
    else:
        # Next day's first stop
        nxt = next((s for s in stops if s.get("day", 0) > elapsed + 1), None)

    if not nxt:
        return {"stop": None, "reason": "none_left"}

    distance = None
    if lat is not None and lng is not None and nxt.get("lat") and nxt.get("lng"):
        distance = _haversine_km(lat, lng, float(nxt["lat"]), float(nxt["lng"]))
    return {"stop": nxt, "reason": "upcoming", "distance_km": distance}


# ─────────────────────────────────────────────────────────────────────────
# Intent detection & reply generation
# ─────────────────────────────────────────────────────────────────────────
_GREETING = re.compile(r"^(hi|hii+|hello|hey|yo|namaste|good (morning|afternoon|evening))\b", re.IGNORECASE)
_WHAT_NEXT = re.compile(
    r"(what'?s next|what is next|next stop|next spot|next destination|where (do|should) (i|we) go next|"
    r"where (do|should) (i|we) (go|head) now|where are (we|i) heading|what (are we|am i) doing next|"
    r"what comes after|what'?s (my|our) next|what next|what'?s on next)",
    re.IGNORECASE,
)
_WEATHER = re.compile(r"\b(cold|rain|raining|hot|jacket|umbrella|temperature|weather|forecast|warm|chilly|humid|sweater)\b", re.IGNORECASE)
_BUDGET = re.compile(r"\b(how much|pay|paying|paid|spent|spend|money|fee|fees|budget|left|remaining|charg|cost|settlement)\b", re.IGNORECASE)
_FOOD = re.compile(r"\b(eat|food|restaurant|dining|dinner|lunch|breakfast|veg|non-veg|cuisine|meal|hungry)\b", re.IGNORECASE)
_STAY = re.compile(r"\b(hotel|stay|accommodation|room|resort|cottage|hostel)\b", re.IGNORECASE)
_SAFETY = re.compile(r"\b(safe|safety|emergency|police|helpline|hospital|medical|lost|unsafe|dial)\b", re.IGNORECASE)
_PLAN = re.compile(r"\b(plan|itinerary|schedule|tomorrow|today'?s|day \d|what do (i|we) have)\b", re.IGNORECASE)
_RECALL = re.compile(r"\b(did i (ask|say|tell)|what did i (say|tell|ask)|earlier|remember)\b", re.IGNORECASE)
_GUIDE = re.compile(r"\b(guide|local expert|my guide)\b", re.IGNORECASE)
_TRANSLATE = re.compile(
    r"\b(translate|translation|say it|how do (i|you) say|say in|phrase|language|speak|understand \w+|\w+ language)\b",
    re.IGNORECASE,
)

# ── Communication assistance: common travel phrases (phrasebook, not invented
#    machine translation). Every entry is a standard, commonly-used travel phrase.
_TRAVEL_PHRASES = {
    "How much does this cost?": {
        "English": "How much does this cost?",
        "Hindi": "Ye kitne ka hai?",
        "Tamil": "Idhu evvalavu?",
        "Kannada": "Idhu eshtu?",
        "Malayalam": "Ithu ethra?",
        "Telugu": "Idi entha?",
        "Marathi": "He kitle?",
        "Bengali": "Eta koto?",
    },
    "Where is the railway station?": {
        "English": "Where is the railway station?",
        "Hindi": "Railway station kahan hai?",
        "Tamil": "Railway station enga?",
        "Kannada": "Railway nildana ellide?",
        "Malayalam": "Railway station evideyaanu?",
        "Telugu": "Railway station ekkada?",
        "Marathi": "Railway station kuthe aahe?",
        "Bengali": "Railway station kothay?",
    },
    "Where is the bus stop?": {
        "English": "Where is the bus stop?",
        "Hindi": "Bus stop kahan hai?",
        "Tamil": "Bus stop enga?",
        "Kannada": "Bus nildana ellide?",
        "Malayalam": "Bus stop evideyaanu?",
        "Telugu": "Bus stop ekkada?",
        "Marathi": "Bus stop kuthe aahe?",
        "Bengali": "Bus stop kothay?",
    },
    "Please take me to this address.": {
        "English": "Please take me to this address.",
        "Hindi": "Is pate par chaliye.",
        "Tamil": "Intha address ku kooti pochchunga.",
        "Kannada": "Ee vilasana nanna karedu kodi.",
        "Malayalam": "Ee vilasathilekku kondu pokko.",
        "Telugu": "I address ku tisukelleyandi.",
        "Marathi": "Krupaya mala ya pattyavar gheun ja.",
        "Bengali": "Ei thekanay niye jaben.",
    },
    "How far is the hotel?": {
        "English": "How far is the hotel?",
        "Hindi": "Hotel kitni door hai?",
        "Tamil": "Hotel evvalavu dooram?",
        "Kannada": "Hotel eshtu doora ide?",
        "Malayalam": "Hotel ethra dooramaanu?",
        "Telugu": "Hotel entha dooram?",
        "Marathi": "Hotel kiti door aahe?",
        "Bengali": "Hotel koto door?",
    },
    "I need help.": {
        "English": "I need help.",
        "Hindi": "Mujhe madad chahiye.",
        "Tamil": "Enakku udhavi venum.",
        "Kannada": "Nanage sahaaya beku.",
        "Malayalam": "Enikku sahaayam venam.",
        "Telugu": "Naaku sahayam kavali.",
        "Marathi": "Mala madat havi.",
        "Bengali": "Amar sahayya dorkar.",
    },
    "Where is a hospital?": {
        "English": "Where is a hospital?",
        "Hindi": "Hospital kahan hai?",
        "Tamil": "Hospital enga?",
        "Kannada": "Aaspatre ellide?",
        "Malayalam": "Aashupathri evideyaanu?",
        "Telugu": "Aaspatri ekkada?",
        "Marathi": "Rugnalay kuthe aahe?",
        "Bengali": "Hospital kothay?",
    },
    "Please speak slowly.": {
        "English": "Please speak slowly.",
        "Hindi": "Dheere boliye.",
        "Tamil": "Mella pesunga.",
        "Kannada": "Nidhaanavaagi maataadi.",
        "Malayalam": "Pathukke samsaarikku.",
        "Telugu": "Melliga maatladandi.",
        "Marathi": "Krupaya haalu bola.",
        "Bengali": "Dheere bolun.",
    },
    "Is this the right way?": {
        "English": "Is this the right way?",
        "Hindi": "Kya ye sahi rasta hai?",
        "Tamil": "Idhu sariyaana vazhiya?",
        "Kannada": "Idu sariya daariya?",
        "Malayalam": "Ithu sheriyaaya vaazhiyaano?",
        "Telugu": "Idi sariyaina maargama?",
        "Marathi": "He barobar marg aahe ka?",
        "Bengali": "Eta ki thik rasta?",
    },
    "Thank you.": {
        "English": "Thank you.",
        "Hindi": "Dhanyavaad.",
        "Tamil": "Nandri.",
        "Kannada": "Dhanyavadaagalu.",
        "Malayalam": "Nanni.",
        "Telugu": "Dhanyavadalu.",
        "Marathi": "Dhanyavaad.",
        "Bengali": "Dhonnobad.",
    },
}

_PHRASE_LANGUAGES = ["English", "Hindi", "Tamil", "Kannada", "Malayalam", "Telugu", "Marathi", "Bengali"]
_NON_TRAVEL = re.compile(
    r"(\d\s*[+\-*/x\u00d7]\s*\d)|(what is \d)|(2\+2)|(\bmath\b)|(\bcode\b)|(\bprogram(ming|mer)?\b)|"
    r"(\bpython\b)|(\bjavascript\b)|(\bcrypto\b)|(\bstock market\b)|(\bmeaning of life\b)|"
    r"(\bwho is the (president|prime minister)\b)|(\brecipe for (pasta|cake|bread)\b)",
    re.IGNORECASE,
)
_ACTION_REMOVE = re.compile(r"\b(remove|skip|drop|cancel|delete|cut)\b", re.IGNORECASE)
_ACTION_MOVE_TIME = re.compile(r"\b(move|change|reschedule|shift)\b.*?(\d{1,2}(?::\d{2})?\s*(?:am|pm))", re.IGNORECASE)
_ACTION_REST = re.compile(r"\b(add|take|insert|include)\b.*\b(rest day|free day|break day|day off|leisure day)\b", re.IGNORECASE)


def _is_veg_pref(ctx: Dict[str, Any]) -> bool:
    prefs = ctx["prefs"]
    food = " ".join([
        str(prefs.get("food_pref", "")),
        str(prefs.get("food", "")),
    ]).lower()
    if "veg" in food and "non" not in food:
        return True
    for m in ctx["history"]:
        text = (m.get("text") or "").lower()
        if m.get("role") in ("USER", "user") and ("vegetarian" in text or "pure veg" in text or "veg food" in text):
            return True
    return False


def _last_mentioned_place(ctx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Entity resolution: find the most recently mentioned stop/place in the
    conversation (newest first) so 'it / there / this / that' can be resolved."""
    stops = _all_stops(ctx["days"])
    for m in reversed(ctx["history"]):
        text = str(m.get("text") or "")
        if not text:
            continue
        for s in stops:
            title = str(s.get("title", "")).lower()
            loc = str(s.get("location_name", "")).lower()
            words = title.split()
            if any(w and w in text.lower() for w in words if len(w) > 3) or (loc and loc[:12] in text.lower()):
                return s
    return None


def _apply_action(ctx: Dict[str, Any], db: Session, q: str) -> Optional[str]:
    """Execute a real itinerary change requested in chat."""
    days = ctx["days"]
    if not days:
        return "There is no generated itinerary to modify yet."

    # 1) Rest day
    if _ACTION_REST.search(q):
        calm = None
        for a in (ctx["verified"]["attractions"] or []):
            if a.get("category") != "adventure" and a.get("duration_minutes", 120) <= 120:
                calm = a
                break
        result = add_rest_day(days, ctx["dest"], calm)
        _persist_modified_itinerary(db, ctx, result["days"],
                                    f"Added a rest day at your request ({result['added'].get('title', 'Rest & Leisure')}).")
        name = result["added"].get("title", "Rest day")
        return f"Done. I added a new day to your plan: {name}. It is now the next day in your itinerary."

    # 2) Move / change time
    mt = _ACTION_MOVE_TIME.search(q)
    if mt:
        new_time = mt.group(2).strip()
        target_phrase = re.sub(
            r"\b(move|change|reschedule|shift|can|could|we|i|please|to|the|it|my|our|a)\b", " ", q, flags=re.IGNORECASE
        )
        target_phrase = re.sub(r"\d{1,2}(?::\d{2})?\s*(?:am|pm)", " ", target_phrase, flags=re.IGNORECASE).strip(" .,!?")
        stop = find_stop(days, target_phrase or "dinner")
        if not stop:
            # Entity fallback: dinner/lunch/breakfast refer to the day's food stop.
            food_stops = [s for s in _all_stops(days) if s.get("category") == "food"]
            if "dinner" in q.lower() or "lunch" in q.lower() or "breakfast" in q.lower():
                if food_stops:
                    stop = food_stops[0]
        if not stop:
            return f"I couldn't find which stop you want to move. Tell me the stop name (for example, the dinner stop or the museum)."
        result = move_stop_time(days, stop["id"], new_time)
        _persist_modified_itinerary(db, ctx, result["days"],
                                    f"Moved \"{stop.get('title')}\" to {new_time} at your request.")
        return f"Done. I moved \"{stop.get('title')}\" to {new_time} in your itinerary."

    # 3) Remove / skip a stop
    if _ACTION_REMOVE.search(q):
        target_phrase = _ACTION_REMOVE.sub("", q).strip(" .,!?")
        if not target_phrase or len(target_phrase) < 3:
            return "What would you like me to remove? Tell me the stop name."
        stop = find_stop(days, target_phrase)
        if not stop:
            return f"I couldn't find \"{target_phrase}\" in your current itinerary. Check the Itinerary panel for exact stop names."
        result = remove_stop(days, stop["id"])
        cost = result["removed_cost"]
        msg = f"Done. I removed \"{stop.get('title')}\" from your itinerary."
        if cost > 0:
            msg += f" Its estimated cost of {_fmt_inr(cost)} was taken out of the plan."
        _persist_modified_itinerary(db, ctx, result["days"],
                                    f"Removed \"{stop.get('title')}\" at your request.")
        return msg

    return None


def _persist_modified_itinerary(db: Session, ctx: Dict[str, Any], new_days: List[Dict[str, Any]], explanation: str):
    """Create a new itinerary version + replan log so the map and budget stay true."""
    current = ctx["itinerary"]
    if current is None:
        return
    current.is_active = False
    new_version = (current.version or 1) + 1
    new_itin = Itinerary(
        trip_id=ctx["trip"].id,
        version=new_version,
        is_active=True,
        total_cost=current.total_cost,
        days_data=new_days,
        cost_breakdown=current.cost_breakdown or {},
    )
    db.add(new_itin)
    db.add(ReplanningLog(
        trip_id=ctx["trip"].id,
        trigger_type="USER_PREFERENCE",
        reason="Itinerary change requested in the trip chat",
        explanation=explanation,
        old_version=current.version or 1,
        new_version=new_version,
    ))
    db.commit()


def _weather_answer(ctx: Dict[str, Any], lat: Optional[float], lng: Optional[float]) -> str:
    stops = _all_stops(ctx["days"])
    target = None
    if lat is not None and lng is not None and stops:
        target = min(
            stops,
            key=lambda s: _haversine_km(lat, lng, float(s.get("lat", 0)), float(s.get("lng", 0)))
            if s.get("lat") and s.get("lng") else float("inf"),
        )
    if target is None and stops:
        target = stops[0]
    t_lat = target.get("lat") if target else None
    t_lng = target.get("lng") if target else None
    if t_lat is None or t_lng is None:
        t_lat, t_lng = None, None
    w = _weather_at(t_lat, t_lng)
    place = (target or {}).get("location_name") or ctx["dest"] or "your destination"
    if not w:
        return (
            f"I don't have a live weather reading for {place} right now. "
            "I only report real forecasts, so I won't guess. Ask me again in a bit, "
            "or check the weather note on the next stop."
        )
    feel = ""
    if w.get("feels_like") is not None and abs(w["feels_like"] - w["temp"]) >= 2:
        feel = f" (feels like {w['feels_like']}\u00b0C)"
    advice = ""
    if w["temp"] <= 15:
        advice = " It is cold — carry a jacket or woollens."
    elif "rain" in w["condition"]:
        advice = " Rain is expected — carry an umbrella or rainwear."
    elif w["temp"] >= 32:
        advice = " It is hot — stay hydrated and plan shade breaks."
    return f"Right now in {place} it is {w['temp']}\u00b0C with {w['condition']}{feel}.{advice}"


def _budget_answer(ctx: Dict[str, Any]) -> str:
    bd = ctx["breakdown"]
    trip: Trip = ctx["trip"]
    guide_fee = float(bd.get("guide_fee") or 0)
    platform_fee = float(bd.get("platform_fee") or 0)
    payable = float(bd.get("payable") or (guide_fee + platform_fee))
    travel_spend = float(bd.get("travel_spend") or 0)
    budget = float(trip.budget or bd.get("budget") or 0)
    paid = float(ctx.get("paid_total") or 0)
    paid_status = "paid" if paid > 0 else "not paid yet"

    lines = [
        f"Your estimated overall travel budget for this trip is {_fmt_inr(budget)}.",
        f"Estimated travel expenses: transport {_fmt_inr(bd.get('transport') or 0)}, "
        f"stay {_fmt_inr(bd.get('stay') or 0)}, food {_fmt_inr(bd.get('food') or 0)}, "
        f"activities {_fmt_inr(bd.get('activities') or 0)} — these are planning estimates, not bills.",
    ]
    if guide_fee > 0:
        lines.append(f"Your Travion payment is {_fmt_inr(payable)}: {_fmt_inr(guide_fee)} guide fee + {_fmt_inr(platform_fee)} platform fee.")
    else:
        lines.append(f"Your Travion payment is {_fmt_inr(payable)}: a {_fmt_inr(platform_fee)} platform service fee (Adventurous Mode has no guide fee).")
    lines.append(f"Status: your Travion payment is {paid_status}"
                + (f" ({_fmt_inr(paid)} collected)." if paid > 0 else "."))
    if guide_fee > 0:
        lines.append("Of that payment, the guide fee goes to your guide's settlement and the platform fee is Travion's service revenue.")
    return " ".join(lines)


def _food_answer(ctx: Dict[str, Any], q: str) -> str:
    foods = ctx["verified"]["foods"]
    if not foods:
        return f"Verified dining recommendations for your {ctx['dest'] or 'trip'} are still being added to the database. When available they will appear on your Live Trip Map."
    veg = _is_veg_pref(ctx) or bool(re.search(r"\bveg\b", q, re.IGNORECASE))
    pool = foods
    if veg:
        v = [f for f in foods if "pure veg" in str(f.get("veg_type", "")).lower()]
        if v:
            pool = v
    top = sorted(pool, key=lambda f: f.get("rating", 0), reverse=True)[0]
    base = f"{top['name']} ({top.get('cuisine', 'Local cuisine')}) is my top-rated verified pick, about {_fmt_inr(top.get('avg_cost_for_two'))} for two."
    if veg:
        base = f"For vegetarian dining, {top['name']} is verified at about {_fmt_inr(top.get('avg_cost_for_two'))} for two."
    if len(pool) > 1:
        second = sorted(pool, key=lambda f: f.get("rating", 0), reverse=True)[1]
        base += f" Also great: {second['name']}."
    base += " Both are pinned on your Live Trip Map."
    return base


def _safety_answer(ctx: Dict[str, Any]) -> str:
    safety = ctx["verified"]["safety"]
    dest = ctx["dest"] or "your destination"
    if not safety:
        return f"Verified emergency contacts for {dest} are still being added. Until then, dial the national emergency line for immediate help."
    parts = []
    if safety.get("tourist_helpline"):
        parts.append(f"Tourist helpline: {safety['tourist_helpline']}")
    if safety.get("hospital_name"):
        parts.append(f"{safety['hospital_name']} ({safety.get('hospital_phone', '24/7')})")
    if safety.get("police_phone"):
        parts.append(f"Police: {safety['police_phone']}")
    if not parts:
        return f"Verified emergency contacts for {dest} are still being added."
    return ". ".join(parts) + ". These are pinned under Safety on your Live Trip Map."


def _plan_answer(ctx: Dict[str, Any], q: str) -> str:
    days = ctx["days"]
    if not days:
        return "No generated itinerary yet. Finish the discovery questions and mode selection, then plan the trip."
    trip: Trip = ctx["trip"]
    start = trip.start_datetime if trip.start_datetime.tzinfo else trip.start_datetime.replace(tzinfo=timezone.utc)
    today = datetime.now(timezone.utc).date()
    day_no = max(1, min(len(days), (today - start.date()).days + 1))
    if re.search(r"\btomorrow\b", q, re.IGNORECASE):
        day_no = min(len(days), day_no + 1)
    day = next((d for d in days if int(d.get("day", 0)) == day_no), days[0])
    stops = day.get("stops", []) or []
    if not stops:
        return f"Day {day_no} of your {ctx['dest'] or 'trip'} plan is open — no stops scheduled."
    lines = [f"Here is your Day {day_no} plan in {ctx['dest'] or 'your trip'}:"]
    for s in stops[:6]:
        cost = _fmt_inr(s.get("estimated_cost") or 0) if s.get("estimated_cost") else "no charge"
        lines.append(f"- {s.get('time', '')} {s.get('title', '')} ({cost})")
    return "\n".join(lines)


def _next_answer(ctx: Dict[str, Any], lat: Optional[float], lng: Optional[float]) -> str:
    ns = _next_stop(ctx, lat, lng)
    stop = ns.get("stop")
    if not stop:
        if ns.get("reason") == "completed":
            return "Your trip is complete — there are no more planned stops. Ask me anything about what you already visited."
        if ns.get("reason") == "no_plan":
            return "There's no generated itinerary yet, so there's no next stop to plan. Finish discovery and plan your trip first."
        return "You're all caught up — no more planned stops for today."
    line = f"Next stop: {stop.get('title', '')}"
    t = stop.get("time", "")
    if t:
        line += f" at {t}"
    dist = ns.get("distance_km")
    if dist is not None:
        line += f" — about {dist} km away (straight-line)"
    dur = stop.get("duration_minutes")
    if dur:
        line += f", planned route time about {int(dur)} min"
    line += ". It is pinned on your Live Trip Map — open the route from the map."
    pre = ns.get("note")
    if pre:
        line = f"{pre} {line}"
    return line


def _recall_answer(ctx: Dict[str, Any], q: str) -> str:
    user_msgs = [m["text"] for m in ctx["history"] if m["role"] in ("USER", "user")]
    if not user_msgs:
        return "We haven't discussed anything yet — ask me about food, pace, budget or any part of the trip."
    topics = []
    joined = " ".join(user_msgs).lower()
    if re.search(r"\bveg\b|vegetarian|pure veg", joined):
        topics.append("you prefer vegetarian dining")
    if re.search(r"\bcrowd|busy|packed|less crowded\b", joined):
        topics.append("you'd like to avoid crowded places")
    if re.search(r"\bbudget|under \u20b9|spend|cost\b", joined):
        topics.append("you care about keeping to your budget")
    if re.search(r"\btired|slow|relax|pace\b", joined):
        topics.append("you want a relaxed pace")
    if topics:
        return "From our conversation so far, I remember: " + "; ".join(topics) + ". I'll keep these in mind for the rest of the trip."
    return (
        "Here's what we've talked about so far on this trip:\n"
        + "\n".join(f"- {m[:120]}" for m in user_msgs[-4:])
    )


def _guide_answer(ctx: Dict[str, Any]) -> str:
    g = ctx["guide"]
    if g:
        return (
            f"Your guide for this trip is {g['name']} (rating {g['rating']}/5, "
            f"specializing in {', '.join((g.get('specializations') or [])[:3]) or 'local experiences'}). "
            "Their contact details are in your trip workspace, and the guide chat is unlocked — ask them anything local."
        )
    return (
        "You're travelling in Adventurous Mode, so there's no assigned human guide. "
        "I'm your assistant for planning, navigation, local discovery and safety info. "
        "For emergencies use the Safety panel on your Live Trip Map."
    )


# ─────────────────────────────────────────────────────────────────────────
# Main entry
# ─────────────────────────────────────────────────────────────────────────
def generate_ai_reply(db: Session, trip: Trip, user_query: str,
                      lat: Optional[float] = None, lng: Optional[float] = None) -> str:
    q = user_query.strip()
    ctx = _build_context(db, trip)
    dest = ctx["dest"] or "your trip"

    # 1) Polite scope refusal for clearly non-travel questions.
    if _NON_TRAVEL.search(q):
        return (
            "I'm Travion's travel assistant, so I focus on your trip — planning, destinations, "
            "transport, stays, food, navigation, weather, safety and budget. "
            "I can't help with general non-travel questions."
        )

    # 2) Real actions first (they change the persisted itinerary).
    if _ACTION_REST.search(q) or _ACTION_REMOVE.search(q) or _ACTION_MOVE_TIME.search(q):
        result = _apply_action(ctx, db, q)
        if result:
            return result

    # 3) Communication assistance — translation always wins over other intents
    #    when the traveller asks how to say something in a local language.
    if _TRANSLATE.search(q):
        lang_hint = None
        for lang in _PHRASE_LANGUAGES:
            if lang.lower() in q.lower():
                lang_hint = lang
                break
        target = lang_hint or "Hindi"  # most widely understood across India
        phrase_hint = re.sub(
            r"\b(translate|translation|say it|how do i say|how do you say|say in|in|the|a|to|please|can you|\w+ language|speak|understand)\b",
            " ", q, flags=re.IGNORECASE
        )
        phrase_hint = re.sub(r"[^a-zA-Z0-9' ]", " ", phrase_hint).strip()
        best, best_score = None, 0
        for phrase, langs in _TRAVEL_PHRASES.items():
            words = set(re.sub(r"[^a-z0-9' ]", "", phrase.lower()).split())
            words = {w for w in words if len(w) > 2}
            overlap = sum(1 for w in words if w in phrase_hint.lower())
            if overlap > best_score:
                best, best_score = phrase, overlap
        if best and best_score >= 2:
            trans = _TRAVEL_PHRASES[best].get(target) or _TRAVEL_PHRASES[best]["English"]
            return (
                f"In {target}, you can say: \"{trans}\" (for \"{best}\"). "
                "These are common travel phrases from Travion's phrasebook."
            )
        lines = []
        for p in ["I need help.", "How much does this cost?", "Please take me to this address.", "Thank you."]:
            lines.append(f"\"{_TRAVEL_PHRASES[p][target]}\" - {p}")
        return (
            f"Here are essential phrases in {target}:\n" + "\n".join(lines) +
            "\nAsk me to translate anything specific, or tell me your destination's local language."
        )

    # 4) What's next (uses time + itinerary + real GPS when shared).
    if _WHAT_NEXT.search(q):
        return _next_answer(ctx, lat, lng)

    # 4) Weather — uses the real forecast for the relevant place.
    if _WEATHER.search(q):
        return _weather_answer(ctx, lat, lng)

    # 5) Budget & payments — from actual financial records.
    if _BUDGET.search(q) and not _STAY.search(q):
        if re.search(r"\b(how much|pay|paying|paid|money|fee|fees|charg|left|remaining|spent|spend)\b", q, re.IGNORECASE):
            return _budget_answer(ctx)

    # 6) Food & dining (preference-aware).
    if _FOOD.search(q):
        return _food_answer(ctx, q)

    # 7) Stays.
    if _STAY.search(q):
        stays = ctx["verified"]["stays"]
        if not stays:
            return f"Verified stay options for {dest} are still being added to the database and will appear on your Live Trip Map."
        s = sorted(stays, key=lambda x: x.get("rating", 0), reverse=True)[0]
        return (
            f"Your verified stay for {dest} is {s['name']} — a {s.get('tier', 'verified')} property "
            f"at about {_fmt_inr(s.get('price_per_night'))} per night, with {', '.join((s.get('amenities') or [])[:3])}. "
            "Directions are in your Live Trip Map bottom sheet."
        )

    # 8) Safety & emergencies.
    if _SAFETY.search(q):
        return _safety_answer(ctx)

    # 9) Plan / today / tomorrow.
    if _PLAN.search(q):
        return _plan_answer(ctx, q)

    # 10) Conversation recall.
    if _RECALL.search(q):
        return _recall_answer(ctx, q)

    # 11) Guide context.
    if _GUIDE.search(q):
        return _guide_answer(ctx)

    # 13) Greeting — context-aware, only at the start.
    if _GREETING.search(q) and len(q) < 40:
        ns = _next_stop(ctx, lat, lng)
        line = f"Hey! I'm ready to help with your {dest} trip."
        if ns.get("stop"):
            line += f" Your next planned stop is {ns['stop'].get('title', '')}."
        line += " Ask me about the plan, food, weather, budget, or anything on the journey."
        return line

    # 14) Entity reference resolution ("it / there / this / that").
    if re.search(r"\b(it|there|this|that|here)\b", q, re.IGNORECASE):
        ref = _last_mentioned_place(ctx)
        if ref:
            return (
                f"I think you mean {ref.get('title', 'the place we discussed')}. "
                + _next_answer(ctx, lat, lng)
            )

    # 15) Open-ended travel question: verified grounding first, Gemini optional.
    system_context = _context_text(ctx)
    gemini = _gemini_reply(q, system_context)
    if gemini:
        return gemini

    # Deterministic fallback — grounded, never generic-loop.
    attractions = ctx["verified"]["attractions"]
    if attractions:
        top = sorted(attractions, key=lambda x: x.get("rating", 0), reverse=True)[0]
        return (
            f"Your {dest} plan is ready in the Itinerary panel. A top-rated verified stop is "
            f"{top['name']} — {str(top.get('description', ''))[:110]}. "
            "Ask me what's next, about food, weather, budget, or to change any part of the plan."
        )
    return (
        f"I'm your assistant for your journey to {dest}. I can tell you the next stop, today's plan, "
        "verified food and stays, weather when it's live, your exact Travion payment, and safety contacts — "
        "all from your trip's real data."
    )


def _context_text(ctx: Dict[str, Any]) -> str:
    trip: Trip = ctx["trip"]
    lines = [
        f"Trip: {trip.source_name} to {trip.destination_name}",
        f"Dates: {trip.start_datetime} to {trip.end_datetime}",
        f"Mode: {trip.mode or 'not selected'}",
        f"Budget: {_fmt_inr(trip.budget or 0)}",
    ]
    stops = _all_stops(ctx["days"])
    if stops:
        lines.append("Itinerary stops:")
        for s in stops[:14]:
            lines.append(
                f"- Day {s.get('day')} {s.get('time')} {s.get('title')} at {s.get('location_name')} "
                f"(cost {_fmt_inr(s.get('estimated_cost') or 0)})"
            )
    if ctx["prefs"]:
        prefs = {k: v for k, v in ctx["prefs"].items() if v}
        lines.append(f"Preferences: {prefs}")
    if ctx["breakdown"]:
        lines.append(f"Cost breakdown: {ctx['breakdown']}")
    if ctx["guide"]:
        lines.append(f"Guide: {ctx['guide']}")
    return "\n".join(lines)