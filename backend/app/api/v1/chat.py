from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import get_current_identity
from app.models.entities import Trip, ChatMessage, User, Guide
from app.services.verified_data import VERIFIED_LOCATIONS, VERIFIED_STAYS, VERIFIED_FOOD, VERIFIED_SAFETY_INFO, VERIFIED_ATTRACTIONS
from app.schemas.schemas import ChatMessageCreate, ChatMessageResponse

router = APIRouter(prefix="/trips", tags=["Chat"])

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

    # If guide channel, ensure assignment exists
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

    # Guide channel authorization check
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
        channel=req.channel
    )
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    # If channel is AI, generate automated grounded AI response
    if req.channel == "AI":
        reply_text = generate_ai_reply(trip, req.message)
        ai_msg = ChatMessage(
            trip_id=trip.id,
            sender_role="AI",
            sender_id="travion-ai-assistant",
            sender_name="Travion AI",
            message=reply_text,
            channel="AI"
        )
        db.add(ai_msg)
        db.commit()

    return user_msg

def _verified_dest_key(dest: str) -> str:
    """Return the canonical verified-dataset key for a destination, if any."""
    if dest in VERIFIED_STAYS:
        return dest
    norm = (dest or "").strip().lower()
    for loc in VERIFIED_LOCATIONS:
        name = loc["name"].lower()
        if norm == name or (norm and (norm in name or name in norm)):
            return loc["name"]
    return ""


def _fmt_inr(amount: float) -> str:
    try:
        return f"Rs {float(amount):,.0f}".replace(",", ",")
    except (TypeError, ValueError):
        return "Rs 0"


def generate_ai_reply(trip: Trip, user_query: str) -> str:
    q = user_query.lower()
    dest = trip.destination_name or ""
    key = _verified_dest_key(dest)
    context = f"your {dest} trip" if dest else "your trip"

    if key:
        stays = VERIFIED_STAYS.get(key, [])
        foods = VERIFIED_FOOD.get(key, [])
        attractions = VERIFIED_ATTRACTIONS.get(key, [])
        safety = VERIFIED_SAFETY_INFO.get(key, {})
    else:
        stays, foods, attractions, safety = [], [], [], {}

    if "eat" in q or "food" in q or "restaurant" in q or "dining" in q:
        if foods:
            top = sorted(foods, key=lambda f: f.get("rating", 0), reverse=True)[0]
            line = f"{top['name']} ({top.get('cuisine', 'Local cuisine')}) is our top-rated verified pick, at about {_fmt_inr(top.get('avg_cost_for_two'))} for two. It is pinned on your Live Trip Map."
            if "veg" in q:
                veg = [f for f in foods if "pure veg" in str(f.get("veg_type", "")).lower()]
                if veg:
                    v = sorted(veg, key=lambda f: f.get("rating", 0), reverse=True)[0]
                    line = f"For pure-vegetarian dining, {v['name']} is verified at about {_fmt_inr(v.get('avg_cost_for_two'))} for two. It is pinned on your Live Trip Map."
            return line
        return f"Verified dining recommendations for {context} are still being added to the database. When they become available they will appear on your Live Trip Map."
    if "tired" in q or "rest" in q or "change" in q or "replan" in q or "pace" in q:
        if attractions:
            calm = [a for a in attractions if a.get("category") != "adventure"] or attractions
            pick = sorted(calm, key=lambda a: a.get("duration_minutes", 60))[0]
            return f"For a more relaxed pace on {context}, consider swapping strenuous stops for {pick['name']} - a short, low-effort visit already in our verified database. Trigger a dynamic replan from your live itinerary and the change will be explained to you."
        return f"You can trigger a dynamic replan on {context} at any time - the system recalculates your stops within budget and explains every change."
    if "hotel" in q or "stay" in q or "accommodation" in q:
        if stays:
            s = sorted(stays, key=lambda x: x.get("rating", 0), reverse=True)[0]
            return f"Your verified stay for {context} is {s['name']} - a {s.get('tier', 'verified')} property at about {_fmt_inr(s.get('price_per_night'))} per night with {', '.join((s.get('amenities') or [])[:3])}. Directions are in your Live Trip Map bottom sheet."
        return f"Verified stay options for {context} are still being added to the database and will appear on your Live Trip Map."
    if "safe" in q or "emergency" in q or "police" in q or "helpline" in q or "hospital" in q:
        if safety:
            parts = []
            if safety.get("tourist_helpline"):
                parts.append(f"Tourist helpline: {safety['tourist_helpline']}")
            if safety.get("hospital_name"):
                parts.append(f"{safety['hospital_name']} ({safety.get('hospital_phone', '24/7')})")
            if safety.get("police_phone"):
                parts.append(f"Police: {safety['police_phone']}")
            if parts:
                return ". ".join(parts) + ". These are pinned under Safety on your Live Trip Map."
        return f"Verified emergency contacts for {context} are still being added to the database. Until then, dial the national emergency line for immediate help."
    if "plan" in q or "itinerary" in q or "tomorrow" in q or "next" in q:
        if attractions:
            a = sorted(attractions, key=lambda x: x.get("rating", 0), reverse=True)[0]
            return f"Your plan for {context} is ready in the Itinerary panel. A top-rated verified stop is {a['name']} - {a.get('description', '')[:110]}. Ask me to adjust any day and I will apply the change."
        return f"Your plan for {context} is ready in the Itinerary panel. Ask me to adjust any day and I will apply the change."
    return f"I am your trip assistant for your journey from {trip.source_name or 'origin'} to {dest or 'destination'}. Ask me about food, stays, safety contacts, today's plan, or a change of pace, and I will answer from your trip's verified data."
