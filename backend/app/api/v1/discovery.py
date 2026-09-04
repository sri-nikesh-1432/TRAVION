from typing import Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import Trip, TripProfile, User
from app.schemas.schemas import DiscoveryNextRequest, DiscoveryQuestionResponse

router = APIRouter(prefix="/trips", tags=["Discovery"])


def _join(value: Any) -> str:
    """Column-friendly rendering: a multi-select list becomes a readable string."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v) for v in value if str(v).strip())
    return str(value)


def _as_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value if str(v).strip()]
    return [str(value)]


MASTER_QUESTIONS = [
    {
        "id": "budget",
        "text": "What is your approximate total budget for this trip (in INR)?",
        "type": "budget",
        "options": ["₹8,000 - ₹12,000", "₹15,000 - ₹25,000", "₹30,000 - ₹50,000", "₹50,000+ Luxury"],
        "placeholder": "e.g. 18000"
    },
    {
        "id": "party",
        "text": "Who are you travelling with?",
        "type": "choice",
        "options": ["Solo", "Couple", "Family with Kids", "Friends Group"],
        "placeholder": None
    },
    {
        "id": "experience",
        "text": "What type of experience are you seeking? Select all that apply.",
        "type": "multi_choice",
        "options": [
            "Relaxed & Scenic", "Adventure & Treks", "Cultural & Heritage",
            "Nature & Wildlife", "Culinary Exploration", "Spiritual & Peaceful",
            "Beaches & Water Sports", "Nightlife & Entertainment"
        ],
        "placeholder": None
    },
    {
        "id": "food_pref",
        "text": "What are your dietary or cuisine preferences? Select all that apply.",
        "type": "multi_choice",
        "options": [
            "Pure Veg", "Veg & Non-Veg", "Vegan", "Halal", "Gluten-Free",
            "Local Traditional Only", "Street Food", "Fine Dining"
        ],
        "placeholder": None
    },
    {
        "id": "stay_pref",
        "text": "What is your preferred style of stay?",
        "type": "choice",
        "options": [
            "Budget Hostel & Guesthouse", "Homestay & Heritage Cottage",
            "3 Star Cozy Boutique", "4 Star Resort & Spa", "5 Star Luxury Heritage"
        ],
        "placeholder": None
    },
    {
        "id": "transport_pref",
        "text": "How would you prefer to travel between cities?",
        "type": "choice",
        "options": [
            "Scenic Train / Toy Train", "AC Sleeper Bus",
            "Private Cab / Self Drive", "Fastest Available"
        ],
        "placeholder": None
    },
    {
        "id": "activities",
        "text": "Which activities interest you most? Select all that apply.",
        "type": "multi_choice",
        "options": [
            "Hiking & Treks", "Waterfalls & Nature", "Temples & Heritage",
            "Wildlife & Safaris", "Museums & Culture", "Beaches",
            "Shopping & Local Markets", "Photography", "Adventure Sports",
            "Food Trails", "Spiritual Sites"
        ],
        "placeholder": None
    },
    {
        "id": "pace",
        "text": "What travel pace feels right for you?",
        "type": "choice",
        "options": ["Relaxed", "Balanced", "Fast-Paced"],
        "placeholder": None
    },
    {
        "id": "walking_tolerance",
        "text": "How much walking are you comfortable with for sightseeing?",
        "type": "choice",
        "options": [
            "Light (Under 3,000 steps/day)", "Moderate (3,000 - 8,000 steps/day)",
            "Active / High (8,000+ steps/day)"
        ],
        "placeholder": None
    },
    {
        "id": "priority",
        "text": "What is most important to you when Travion plans this trip? Select all that apply.",
        "type": "multi_choice",
        "options": [
            "Comfort & Relaxation", "Maximum Exploration & Hidden Gems",
            "Safety & Verified Support", "Balanced Value", "Lowest Cost",
            "Unique Local Experiences"
        ],
        "placeholder": None
    }
]


@router.post("/{trip_id}/discovery/next", response_model=DiscoveryQuestionResponse)
def get_next_discovery_question(
    trip_id: str,
    req: DiscoveryNextRequest,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    user = db.query(User).filter(User.identity_id == current["identity_id"]).first()
    answers = req.answers_so_far or {}

    # Adaptive pruning: find first question not yet answered
    next_q = None
    for q in MASTER_QUESTIONS:
        if q["id"] not in answers:
            next_q = q
            break

    answered_count = len(answers)

    # If all answered or sufficient signal collected
    if not next_q or answered_count >= len(MASTER_QUESTIONS):
        # Save or update TripProfile
        profile = db.query(TripProfile).filter(TripProfile.trip_id == trip.id).first()
        if not profile:
            profile = TripProfile(trip_id=trip.id)
            db.add(profile)

        # Structured preferences are stored raw (strings or lists) so the planner
        # and AI can reason over every selection — not just the questionnaire text.
        profile.questions_answers = answers
        profile.party_type = _join(answers.get("party") or "Solo")
        profile.experience_type = _join(answers.get("experience")) or "Relaxed & Scenic"
        profile.food_pref = _join(answers.get("food_pref")) or "Veg & Non-Veg"
        profile.stay_pref = _join(answers.get("stay_pref")) or "3 Star Cozy Boutique"
        profile.transport_pref = _join(answers.get("transport_pref")) or "Fastest Available"
        profile.walking_tolerance = _join(answers.get("walking_tolerance")) or "Moderate"
        profile.priority = _join(answers.get("priority")) or "Balanced Value"

        # Extract budget if numeric or string
        b_val = answers.get("budget", 15000)
        if isinstance(b_val, str):
            digits = "".join(c for c in b_val.split("-")[0] if c.isdigit())
            trip.budget = float(digits) if digits else 15000.0
        elif isinstance(b_val, (int, float)):
            trip.budget = float(b_val)

        trip.status = "PLANNED"
        db.commit()

        return DiscoveryQuestionResponse(
            is_complete=True,
            answered_count=answered_count,
            total_estimated=len(MASTER_QUESTIONS)
        )

    return DiscoveryQuestionResponse(
        is_complete=False,
        question_id=next_q["id"],
        question_text=next_q["text"],
        question_type=next_q["type"],
        options=next_q["options"],
        placeholder=next_q["placeholder"],
        answered_count=answered_count,
        total_estimated=len(MASTER_QUESTIONS)
    )


@router.get("/{trip_id}/profile")
def get_trip_profile(
    trip_id: str,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip or not trip.profile:
        raise HTTPException(status_code=404, detail="Trip profile not found")
    return trip.profile.questions_answers
