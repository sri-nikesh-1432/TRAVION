from typing import Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import Trip, TripProfile, User
from app.schemas.schemas import DiscoveryNextRequest, DiscoveryQuestionResponse
from app.services.budget_service import parse_budget

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


# ─── The 3 questions ─────────────────────────────────────────────────────────
# Product decision: EXACTLY three questions before place discovery begins.
#   Q1 budget       — 4 predefined ranges + custom (server-enforced ₹1,000 min)
#   Q2 party        — travel group + exact traveller counts (adults/children)
#   Q3 experience   — Adventure / Food & Culture / Spiritual / Mixed; this is
#                     the preference that DRIVES place discovery & ranking.
# Destination + dates are captured by trip creation, so no extra questions.
MASTER_QUESTIONS: List[Dict[str, Any]] = [
    {
        "id": "budget",
        "text": "What's your travel budget?",
        "type": "budget",
        "options": [
            "₹10,000 – ₹15,000",
            "₹15,000 – ₹25,000",
            "₹25,000 – ₹50,000",
            "₹50,000+",
        ],
        "custom": True,  # client shows From/To inputs; server enforces the rules
        "placeholder": None,
    },
    {
        "id": "party",
        "text": "Who are you travelling with?",
        "type": "party",
        "options": ["Friends Group", "Couple", "Solo", "Family", "Other"],
        "custom": True,  # client collects exact traveller count + adults/children
        "placeholder": None,
    },
    {
        "id": "experience",
        "text": "What kind of experience are you looking for?",
        "type": "experience",
        "options": [
            {"label": "Adventure", "description": "Trekking, nature, viewpoints, hiking, outdoor activities, exploration"},
            {"label": "Food & Culture", "description": "Best food places, famous local cuisine, street food, markets, cultural experiences"},
            {"label": "Spiritual", "description": "Temples, spiritual sites, pilgrimage locations, peaceful places"},
            {"label": "Mixed", "description": "A balanced combination of different types of experiences"},
        ],
        "custom": False,
        "placeholder": None,
    },
]

MIN_BUDGET = 1000.0  # hard ₹1,000 minimum — ₹100 or ₹500 can never proceed

_EXPERIENCE_LABELS = {"adventure", "food & culture", "food and culture", "spiritual", "mixed"}

# Legacy multi-select labels (older clients / tests) map onto the 4 canonical
# experiences so nothing downstream breaks while the UI shows only the 4.
_LEGACY_EXPERIENCE_ALIASES = {
    "nature & wildlife": "Adventure",
    "adventure & treks": "Adventure",
    "adventure": "Adventure",
    "trek": "Adventure",
    "culinary exploration": "Food & Culture",
    "food": "Food & Culture",
    "culture": "Food & Culture",
    "spiritual": "Spiritual",
    "relaxed & scenic": "Mixed",
    "relaxation": "Mixed",
    "shopping": "Mixed",
    "photography": "Mixed",
    "family": "Mixed",
}


def _normalize_experience(value: Any) -> str:
    """Return one canonical experience label from any accepted input form."""
    if isinstance(value, (list, tuple)):
        value = _join(value)
    text = str(value or "").strip()
    if not text:
        return ""
    low = text.lower()
    if low in _EXPERIENCE_LABELS:
        return text if low != "food and culture" else "Food & Culture"
    if low in _LEGACY_EXPERIENCE_ALIASES:
        return _LEGACY_EXPERIENCE_ALIASES[low]
    # First recognized token of a legacy multi-select
    for token in low.split(","):
        token = token.strip()
        if token in _EXPERIENCE_LABELS:
            return token.title() if token != "food & culture" else "Food & Culture"
        if token in _LEGACY_EXPERIENCE_ALIASES:
            return _LEGACY_EXPERIENCE_ALIASES[token]
    return text  # unknown — store as-is; ranking treats it as Mixed


def _coerce_int(value: Any) -> int:
    """Strict integers only — booleans/floats/strings with letters rejected."""
    if isinstance(value, bool):
        return -1
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else -1
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        if not text.isdigit():  # rejects '+', '-', '.', letters, empty
            return -1
        return int(text)
    return -1


def _validate_budget_answer(answer: Any) -> Dict[str, Any]:
    """Accept a preset range string or {'from','to'} custom numbers. Enforce:
    numbers only, minimum ₹1,000, and To >= From. Raises HTTP 422 otherwise."""
    if isinstance(answer, dict):
        frm = _coerce_int(answer.get("from", answer.get("min")))
        to = _coerce_int(answer.get("to", answer.get("max")))
        if frm < 0 or to < 0:
            raise HTTPException(status_code=422, detail="Budget must be numbers only — no letters or symbols.")
        if frm < MIN_BUDGET:
            raise HTTPException(status_code=422, detail=f"Minimum budget is ₹{int(MIN_BUDGET):,}.")
        if to < frm:
            raise HTTPException(status_code=422, detail="Maximum budget must be greater than or equal to the minimum.")
        return {"from": float(frm), "to": float(to)}

    # Preset range string like '₹10,000 – ₹15,000' or a single number
    bmin, bmax = parse_budget(answer, fallback=(0.0, 0.0))
    if bmax <= 0:
        raise HTTPException(status_code=422, detail="Please choose a budget range or enter a custom budget.")
    if bmax < MIN_BUDGET:
        raise HTTPException(status_code=422, detail=f"Minimum budget is ₹{int(MIN_BUDGET):,}.")
    return {"min": bmin, "max": bmax}


def _validate_party_answer(answer: Any) -> Dict[str, Any]:
    """Accept 'Solo' (legacy string) or {'group', 'total', 'adults', 'children'}.
    Adults + Children must match the total; numbers only, never negative."""
    if isinstance(answer, str):
        # Legacy single-choice answer — Solo/Couple imply 1/2 travellers.
        label = answer.strip() or "Solo"
        implied = {"Solo": 1, "Couple": 2}.get(label, 1)
        return {"group": label, "total": implied, "adults": implied, "children": 0}

    if isinstance(answer, dict):
        group = str(answer.get("group") or "").strip() or "Other"
        total = _coerce_int(answer.get("total"))
        adults = _coerce_int(answer.get("adults", total))
        children = _coerce_int(answer.get("children", 0))
        if group == "Solo":
            return {"group": "Solo", "total": 1, "adults": 1, "children": 0}
        if total < 1 or total > 100:
            raise HTTPException(status_code=422, detail="Enter a valid number of travellers (1–100).")
        if adults < 0 or children < 0:
            raise HTTPException(status_code=422, detail="Traveller counts must be numbers and cannot be negative.")
        if adults + children != total:
            raise HTTPException(
                status_code=422,
                detail=f"Adults ({adults}) + Children ({children}) must add up to {total} travellers.",
            )
        return {"group": group, "total": total, "adults": adults, "children": children}

    raise HTTPException(status_code=422, detail="Please tell us who you are travelling with.")


# Legacy-compatible mapping: downstream consumers (ai_orchestrator, india_planner,
# chat assistant, replanning engine) read profile.transport_pref / stay_pref /
# food_pref / walking_tolerance / priority. The 3-question answers are mapped
# into those exact fields so NOTHING downstream changes. Clients that still
# send the legacy keys (food_pref/stay_pref/transport_pref) are honored first.

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
    exp = str(answers.get("experience") or "").lower()
    if "adventure" in exp:
        return "Maximum Exploration & Hidden Gems"
    if "spiritual" in exp or "food" in exp:
        return "Signature Experiences"
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
    answers = dict(req.answers_so_far or {})

    # Validate answers the client has already provided — invalid values are
    # rejected the moment they are submitted, never silently accepted.
    if "budget" in answers and answers["budget"] is not None:
        answers["budget"] = _validate_budget_answer(answers["budget"])
    if "party" in answers and answers["party"] is not None:
        answers["party"] = _validate_party_answer(answers["party"])
    if "experience" in answers and answers["experience"] is not None:
        answers["experience"] = _normalize_experience(answers["experience"]) or None

    # Find the first question not yet answered
    next_q = None
    for q in MASTER_QUESTIONS:
        if not answers.get(q["id"]):
            next_q = q
            break

    answered_count = sum(1 for q in MASTER_QUESTIONS if answers.get(q["id"]))

    # All 3 answered → persist the TripProfile and complete the interview
    if not next_q or answered_count >= len(MASTER_QUESTIONS):
        # Save or update TripProfile
        profile = db.query(TripProfile).filter(TripProfile.trip_id == trip.id).first()
        if not profile:
            profile = TripProfile(trip_id=trip.id)
            db.add(profile)

        # Structured preferences are stored raw (strings, lists or dicts) so the
        # planner and AI can reason over every selection — not just the text.
        profile.questions_answers = answers
        party = answers["party"]
        profile.party_type = _join(party.get("group") if isinstance(party, dict) else party or "Solo")
        profile.experience_type = _join(answers.get("experience")) or "Mixed"

        # Honor explicit legacy keys first, else map from the 3-question answers
        legacy_transport = _as_list(answers.get("transport_pref") or answers.get("transport_stay"))
        legacy_stay = _as_list(answers.get("stay_pref"))
        ts = _split_transport_stay(legacy_transport)
        profile.transport_pref = _join(legacy_transport) or ts["transport_pref"]
        profile.stay_pref = _join(legacy_stay) or ts["stay_pref"]

        legacy_food = _as_list(answers.get("food_pref"))
        restrictions = _as_list(answers.get("restrictions"))
        profile.food_pref = _join(legacy_food) or _food_from_restrictions(restrictions)
        profile.walking_tolerance = _walking_from_restrictions(restrictions)
        profile.priority = _join(_as_list(answers.get("priority"))) or _priority_from_answers(answers)
        profile.specific_places = [r for r in restrictions if r not in (
            "Vegetarian", "Non-vegetarian", "Jain", "Halal", "Vegan", "Pure Veg",
        )]

        # Budget: the interview already validated it; parse the envelope so the
        # strict budget engine can clamp all three plans.
        budget_answer = answers.get("budget") or {}
        if isinstance(budget_answer, dict) and "from" in budget_answer:
            bmin, bmax = float(budget_answer["from"]), float(budget_answer["to"])
        else:
            bmin, bmax = parse_budget(budget_answer, fallback=(12000.0, 15000.0))
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
