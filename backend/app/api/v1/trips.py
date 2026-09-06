from datetime import datetime, timezone, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import get_current_identity, require_role
from app.models.entities import Trip, Location, User, Identity
from app.schemas.schemas import (
    TripSearchRequest, TripResponse, BasicProfileUpdate
)
from app.services.privacy import mask_phone

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

    # 3. Source != Destination
    if req.source_location_id == req.destination_location_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "SAME_LOCATIONS", "message": "Your destination is the same as your source.", "field": "destination_location_id"}
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
        budget=15000.0,
        total_cost=0.0
    )
    db.add(trip)
    db.commit()
    db.refresh(trip)

    return trip

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

@router.put("/profile/basic")
def update_basic_profile(
    req: BasicProfileUpdate,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.identity_id == current["identity_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

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
    if not req.phone or len("".join(c for c in req.phone if c.isdigit())) < 10:
        raise HTTPException(status_code=400, detail="A valid phone number is mandatory to start planning trips.")

    user.home_city = req.home_city
    user.phone = req.phone
    user.preferred_communication = req.preferred_communication
    user.emergency_contact_name = req.emergency_contact_name
    user.emergency_contact_phone = req.emergency_contact_phone
    user.is_profile_complete = True

    db.commit()
    return {"message": "Profile updated successfully", "user_id": user.id}
