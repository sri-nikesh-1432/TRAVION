from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import get_current_identity, require_role
from app.models.entities import Trip, Location, User, Identity, TripProfile
from app.schemas.schemas import TripSearchRequest, TripResponse, BasicProfileUpdate
from app.services.privacy import mask_phone
from app.services.budget_engine import check_budget_feasibility

router = APIRouter(prefix="/trips", tags=["Trips"])


@router.post("/search", response_model=TripResponse)
def search_and_create_trip(
    req: TripSearchRequest,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    # Retrieve user
    user = db.query(User).filter(User.identity_id == current["identity_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User profile not found")

    # 1. Source location validation
    source = db.query(Location).filter(Location.id == req.source_location_id).first()
    if not source:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "INVALID_SOURCE", "message": "Please select a recognized departure city.", "field": "source_location_id"}
        )

    # 2. Destination location validation
    destination = db.query(Location).filter(Location.id == req.destination_location_id).first()
    if not destination:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "INVALID_DESTINATION", "message": "Please select a recognized destination city.", "field": "destination_location_id"}
        )

    # 3. Source != Destination (Strict validation: ID, Place ID, Normalized Name, and Geo Proximity)
    is_same_location = False
    if req.source_location_id == req.destination_location_id:
        is_same_location = True
    elif source.place_id and destination.place_id and source.place_id == destination.place_id:
        is_same_location = True
    elif source.name and destination.name and source.name.strip().lower() == destination.name.strip().lower():
        is_same_location = True
    elif (
        source.lat is not None and source.lng is not None
        and destination.lat is not None and destination.lng is not None
    ):
        from math import radians, cos, sin, asin, sqrt
        def _haversine_km(lat1, lon1, lat2, lon2):
            R = 6371.0
            dlat = radians(lat2 - lat1)
            dlon = radians(lon2 - lon1)
            a = sin(dlat / 2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2)**2
            c = 2 * asin(sqrt(max(0.0, a)))
            return R * c
        if _haversine_km(source.lat, source.lng, destination.lat, destination.lng) < 15.0:
            is_same_location = True

    if is_same_location:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": "SAME_LOCATIONS",
                "message": "Source and destination cannot be the same city or location. Please select a different destination.",
                "field": "destination_location_id"
            }
        )

    # Server now with UTC comparison
    now = datetime.now(timezone.utc)
    start_dt = req.start_datetime if req.start_datetime.tzinfo else req.start_datetime.replace(tzinfo=timezone.utc)
    end_dt = req.end_datetime if req.end_datetime.tzinfo else req.end_datetime.replace(tzinfo=timezone.utc)

    # 4. Start date cannot be in past (allow 5 min grace for network jitter)
    if start_dt < (now - timedelta(minutes=5)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "PAST_DATE", "message": "Please choose a future travel date and time.", "field": "start_datetime"}
        )

    # 5. End date strictly after start date (min 1 day / overnight duration for v1)
    if end_dt <= start_dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "END_BEFORE_START", "message": "Your return date must be after your departure date.", "field": "end_datetime"}
        )

    trip = Trip(
        user_id=user.id,
        source_location_id=source.id,
        destination_location_id=destination.id,
        source_name=source.name,
        destination_name=destination.name,
        start_datetime=start_dt,
        end_datetime=end_dt,
        status="DRAFT",
        budget=None,
        total_cost=0.0
    )
    db.add(trip)
    db.commit()
    db.refresh(trip)

    return trip


@router.post("/adaptive-discovery", response_model=dict)
def adaptive_discovery(
    body: Dict[str, Any],
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    """Step 2 — Adaptive Discovery: budget, party breakdown, experience interests.

    Persists onto the traveller's latest DRAFT trip (created by /search) and
    syncs the stable profile answers into TripProfile.questions_answers so the
    3-question interview contract and the planner read the SAME data.
    """
    user = db.query(User).filter(User.identity_id == current["identity_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User profile not found")

    trip = db.query(Trip).filter(
        Trip.user_id == user.id,
        Trip.status == "DRAFT"
    ).order_by(Trip.created_at.desc()).first()

    if not trip:
        raise HTTPException(status_code=404, detail="No draft trip found. Create a trip first.")

    # A. Budget — required before party/experience can be priced
    budget = body.get("budget")
    if budget is not None:
        try:
            budget = float(budget)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Budget must be a number.")
    if budget is not None and budget > 0:
        trip.budget = budget
    elif trip.budget is None:
        raise HTTPException(status_code=400, detail="Budget must be set before proceeding.")
    budget_val = float(trip.budget or 0)

    # B. Group type → canonical party_type label
    group_type = body.get("group_type", "Solo")
    group_map = {"Friends": "Friends Group", "Group": "Friends Group", "Couple": "Couple",
                 "Solo": "Solo", "Family": "Family", "Other": "Other"}
    party_label = group_map.get(str(group_type), "Solo")

    # C. Traveller counts — validated BEFORE anything is persisted
    try:
        adults = int(body.get("adults") or 0)
        children = int(body.get("children") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Adults and children must be whole numbers.")
    if adults < 0 or children < 0:
        raise HTTPException(status_code=400, detail="Counts must be non-negative.")
    total_travellers = adults + children
    if total_travellers < 1 or total_travellers > 20:
        raise HTTPException(status_code=400, detail="Traveller count must be between 1 and 20.")

    # D. Experience type
    experience_map = {"Adventure": "Adventure", "Food & Culture": "Food & Culture",
                      "Spiritual": "Spiritual", "Mixed": "Mixed"}
    experience_type = experience_map.get(str(body.get("experience_type", "Relaxed")), "Relaxed")

    # Persist on TripProfile (SQLAlchemy get-or-create, never Peewee)
    trip_profile = db.query(TripProfile).filter(TripProfile.trip_id == trip.id).first()
    if trip_profile is None:
        trip_profile = TripProfile(trip_id=trip.id)
        db.add(trip_profile)
    trip_profile.party_type = party_label
    trip_profile.experience_type = experience_type
    trip_profile.language = str(body.get("language") or trip_profile.language or "English")

    # Canonical party answer shape (same contract as the 3-question interview)
    answers = dict(trip_profile.questions_answers or {})
    answers["party"] = {
        "group": party_label,
        "total": total_travellers,
        "adults": adults,
        "children": children,
    }
    answers["experience"] = body.get("experience") or answers.get("experience") or [experience_type]
    if budget_val > 0:
        previous = answers.get("budget") or {}
        previous_max = float(previous.get("max") or 0)
        answers["budget"] = {"min": float(previous.get("min") or 0), "max": max(budget_val, previous_max)}
    trip_profile.questions_answers = answers

    db.commit()
    db.refresh(trip_profile)

    # Budget feasibility verdict for this party (single financial authority)
    feasibility = check_budget_feasibility(
        budget=budget_val,
        destination=trip.destination_name or "",
        mode="ADVENTUROUS_MODE",
        profile={"party_type": party_label, "adults": adults, "children": children},
        requested_days=3,
    )

    return {
        "status": "ok",
        "trip_id": trip.id,
        "budget_set": bool(trip.budget),
        "budget": budget_val,
        "party_type": trip_profile.party_type,
        "experience_type": trip_profile.experience_type,
        "adults": adults,
        "children": children,
        "total_travellers": total_travellers,
        "budget_feasibility": feasibility["status"],
        "budget_message": feasibility["message"],
        "note": "All adaptive discovery data persisted. Proceed to Round-Trip Transport (Step 3)."
    }


@router.get("/my-trips", response_model=List[TripResponse])
def get_user_trips(
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.identity_id == current["identity_id"]).first()
    if not user:
        return []
    return db.query(Trip).filter(Trip.user_id == user.id).order_by(Trip.created_at.desc()).all()


@router.get("/{trip_id}", response_model=TripResponse)
def get_trip(
    trip_id: str,
    current: dict = Depends(get_current_identity),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip


@router.get("/{trip_id}/assignment")
def get_trip_assignment(
    trip_id: str,
    current: dict = Depends(get_current_identity),
    db: Session = Depends(get_db)
):
    """Real assigned-guide context for a trip (never hardcoded on the client)."""
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    assignment = trip.guide_assignment
    guide_data = None
    if assignment and assignment.guide:
        g = assignment.guide
        guide_data = {
            "guide_id": g.id,
            "name": f"{g.first_name} {g.last_name}".strip(),
            # Privacy policy: full phone numbers are never exposed in the UI —
            # only the masked form (+91 830959****) ever leaves the backend.
            "phone": mask_phone(g.phone),
            "phone_masked": True,
            "rating": g.rating,
            "review_count": g.review_count,
            "languages": g.languages or []
        }
    return {
        "trip_id": trip.id,
        "mode": trip.mode,
        "assignment_status": assignment.status if assignment else None,
        "guide": guide_data
    }


@router.patch("/{trip_id}/complete", response_model=TripResponse)
def complete_trip(
    trip_id: str,
    current: dict = Depends(get_current_identity),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    trip.status = "COMPLETED"

    # If guide assigned, free guide status BUSY -> ACTIVE
    if trip.guide_assignment and trip.guide_assignment.guide:
        trip.guide_assignment.guide.status = "ACTIVE"
        trip.guide_assignment.guide.current_trip_id = None

    db.commit()
    db.refresh(trip)
    return trip


@router.put("/profile/basic", response_model=dict)
def update_basic_profile(
    req: BasicProfileUpdate,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    """Stable traveller profile (Step 0 onboarding) — persists across every trip
    so the AI never asks the same questions again. Home city and phone are
    mandatory and re-validated server-side (direct API calls cannot bypass)."""
    user = db.query(User).filter(User.identity_id == current["identity_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Home City is MANDATORY — users cannot bypass it via direct API calls.
    if not (req.home_city or "").strip():
        raise HTTPException(status_code=400, detail="Please enter your home city to continue.")

    user.first_name = req.first_name
    user.last_name = req.last_name
    user.preferred_name = req.preferred_name or req.first_name
    user.photo_url = req.photo_url
    user.age = req.age
    user.gender = req.gender
    user.preferred_language = req.preferred_language
    user.additional_languages = req.additional_languages
    user.country = req.country
    # Phone is mandatory for travellers; verified by Pydantic before reaching here.
    if not req.phone or len("".join(c for c in (req.phone or "") if c.isdigit())) < 10:
        raise HTTPException(status_code=400, detail="A valid phone number is mandatory to start planning trips.")

    user.home_city = req.home_city
    user.phone = req.phone
    user.preferred_communication = req.preferred_communication
    user.emergency_contact_name = req.emergency_contact_name
    user.emergency_contact_phone = req.emergency_contact_phone
    user.is_profile_complete = True

    db.commit()
    return {"message": "Profile updated successfully", "user_id": user.id}


@router.patch("/{trip_id}/mode", response_model=dict)
def set_trip_mode(
    trip_id: str,
    mode: str = "ADVENTUROUS_MODE",
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if mode not in ("GUIDE_MODE", "ADVENTUROUS_MODE"):
        raise HTTPException(status_code=400, detail="Mode must be GUIDE_MODE or ADVENTUROUS_MODE")
    trip.mode = mode
    db.commit()
    from app.services.pricing_service import compute_guide_fee
    from app.services.budget_service import PLATFORM_FEE_RATE
    budget = float(trip.budget or 0)
    guide_fee = compute_guide_fee(mode=mode, days=3, destination=trip.destination_name or "", base_cost=budget)
    platform_fee = round(budget * PLATFORM_FEE_RATE, 0)
    return {"trip_id": trip.id, "mode": trip.mode, "guide_fee": guide_fee, "platform_fee": platform_fee, "message": f"Mode set to {mode}."}
