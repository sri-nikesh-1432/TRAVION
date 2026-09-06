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


# ─── The 5 high-value questions ──────────────────────────────────────────────
# Product decision: exactly five questions before the three plans are shown.
# Q1 destination+dates are captured by trip creation (source/destination and
# start/end datetimes), so the interview covers Q2–Q5 plus party composition.
MASTER_QUESTIONS = [
    {
        "id": "budget",
        "text": "What is your total travel budget for this trip?",
        "type": "budget",
        "options": ["₹10,000 - ₹15,000", "₹15,000 - ₹25,000", "₹25,000 - ₹50,000", "₹50,000+ Premium"],
        "placeholder": "e.g. 18000",
    },
    {
        "id": "party",
        "text": "Who are you travelling with?",
        "type": "choice",
        "options": ["Solo", "Couple", "Family with Kids", "Friends Group", "Family with Seniors"],
        "placeholder": None,
    },
    {
        "id": "experience",
        "text": "What kind of experience do you want? Select all that apply.",
        "type": "multi_choice",
        "options": [
            "Adventure", "Relaxation", "Nature", "Culture", "Food",
            "Shopping", "Spiritual", "Family", "Photography", "Mixed"
        ],
        "placeholder": None,
    },
    {
        "id": "transport_stay",
        "text": "What are your transportation and accommodation preferences?",
        "type": "multi_choice",
        "options": [
            "Scenic Train / Toy Train", "AC Sleeper Bus", "Flight", "Private Cab / Self Drive",
            "Budget Hostel & Guesthouse", "Homestay & Heritage Cottage", "3 Star Cozy Boutique",
            "4 Star Resort & Spa", "5 Star Luxury Heritage"
        ],
        "placeholder": None,
    },
    {
        "id": "restrictions",
        "text": "Any must-have preferences or restrictions? Select all that apply.",
        "type": "multi_choice",
        "options": [
            "Vegetarian", "Non-vegetarian", "Jain", "Halal", "Vegan",
            "Child-friendly", "Senior-friendly", "Wheelchair accessibility", "Low walking",
            "High adventure", "Pure Veg"
        ],
        "placeholder": None,
    },
]

# Legacy-compatible mapping: downstream consumers (ai_orchestrator, india_planner,
# chat assistant, replanning engine) read profile.transport_pref / stay_pref /
# food_pref / walking_tolerance / priority. The 5-question answers are mapped
# into those exact fields so NOTHING downstream changes.

_TRANSPORT_WORDS = ("train", "bus", "flight", "cab", "self drive")
_STAY_WORDS = ("hostel", "homestay", "3 star", "4 star", "5 star")


def _split_transport_stay(selections: List[str]) -> Dict[str, str]:
    transport = [s for s in selections if any(w in s.lower() for w in _TRANSPORT_WORDS)]
    stay = [s for s in selections if any(w in s.lower() for w in _STAY_WORDS)]
    return {
        "transport_pref": _join(transport) or "Fastest Available",
        "stay_pref": _join(stay) or "3 Star Cozy Boutique",
    }


def _food_from_restrictions(selections: List[str]) -> str:
    food = [s for s in selections if s in ("Vegetarian", "Non-vegetarian", "Jain", "Halal", "Vegan", "Pure Veg")]
    if not food:
        return "Veg & Non-Veg"
    rename = {"Vegetarian": "Pure Veg", "Pure Veg": "Pure Veg", "Vegan": "Vegan", "Jain": "Jain", "Halal": "Halal", "Non-vegetarian": "Veg & Non-Veg"}
    return rename.get(food[0], "Veg & Non-Veg")


def _walking_from_restrictions(selections: List[str]) -> str:
    if "Wheelchair accessibility" in selections or "Low walking" in selections:
        return "Light (Under 3,000 steps/day)"
    if "High adventure" in selections:
        return "Active / High (8,000+ steps/day)"
    return "Moderate (3,000 - 8,000 steps/day)"


def _priority_from_answers(answers: Dict[str, Any]) -> str:
    exp = _as_list(answers.get("experience"))
    if "Relaxation" in exp:
        return "Comfort & Relaxation"
    if "Adventure" in exp:
        return "Maximum Exploration & Hidden Gems"
    return "Balanced Value"


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

        ts = _split_transport_stay(_as_list(answers.get("transport_stay")))
        profile.transport_pref = ts["transport_pref"]
        profile.stay_pref = ts["stay_pref"]
        profile.food_pref = _food_from_restrictions(_as_list(answers.get("restrictions")))
        profile.walking_tolerance = _walking_from_restrictions(_as_list(answers.get("restrictions")))
        profile.priority = _priority_from_answers(answers)
        restrictions = _as_list(answers.get("restrictions"))
        profile.specific_places = [r for r in restrictions if r not in (
            "Vegetarian", "Non-vegetarian", "Jain", "Halal", "Vegan", "Pure Veg",
        )]

        # Extract budget via the centralized BudgetService — currency-symbol
        # strings like '₹10,000 - ₹25,000' previously concatenated digits into
        # a billion-rupee budget. The envelope is stored so the strict budget
        # engine can clamp all three plans.
        from app.services.budget_service import parse_budget
        bmin, bmax = parse_budget(answers.get("budget"), fallback=(12000.0, 15000.0))
        profile.questions_answers = {**answers, "budget": {"min": bmin, "max": bmax}}
        trip.budget = float(bmax)

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
