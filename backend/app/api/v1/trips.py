from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import get_current_identity, require_role
from app.models.entities import Trip, Location, User, Identity, TripProfile
from app.schemas.schemas import BasicProfileUpdate
from app.services.privacy import mask_phone
from app.services.budget_engine import check_budget_feasibility
from app.services.pricing_service import GUIDE_FEE_RATE, PLATFORM_FEE_RATE

router = APIRouter(prefix="/trips", tags=["Trips"])


@router.post("/search", response_model=dict)
def search_and_create_trip(
    source_name: str,
    destination_name: str,
    start_datetime: str,
    end_datetime: str,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.identity_id == current["identity_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User profile not found")

    source = db.query(Location).filter(Location.name.ilike(source_name)).first()
    if not source:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "INVALID_SOURCE", "message": "Please select a recognized departure city.", "field": "source_name"}
        )

    destination = db.query(Location).filter(Location.name.ilike(destination_name)).first()
    if not destination:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "INVALID_DESTINATION", "message": "Please select a recognized destination city.", "field": "destination_name"}
        )

    if source.id == destination.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "SAME_LOCATIONS", "message": "Your destination is the same as your source.", "field": "destination_name"}
        )

    now = datetime.now(timezone.utc)
    try:
        start_dt = datetime.fromisoformat(start_datetime.replace("Z", "+00:00")) if start_datetime else None
        end_dt = datetime.fromisoformat(end_datetime.replace("Z", "+00:00")) if end_datetime else None
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "INVALID_DATETIME", "message": "Invalid start/end datetime format.", "field": "start_datetime/end_datetime"}
        )

    if not start_dt or not end_dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "MISSING_DATETIME", "message": "Start and end datetimes are required.", "field": "start_datetime/end_datetime"}
        )

    if start_dt < (now - timedelta(minutes=5)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "PAST_DATE", "message": "Please choose a future travel date and time.", "field": "start_datetime"}
        )

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

    return {"trip_id": trip.id, "status": "created", "message": "Trip created. Proceed to Adaptive Discovery (Step 2)."}


@router.post("/adaptive-discovery", response_model=dict)
def adaptive_discovery(
    # Accept dict body since AdaptiveDiscoveryRequest not in original schema
    body: Dict[str, Any],
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.identity_id == current["identity_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User profile not found")

    trip = db.query(Trip).filter(
        Trip.user_id == user.id, 
        Trip.status == "DRAFT"
    ).order_by(Trip.created_at.desc()).first()
    
    if not trip:
        raise HTTPException(status_code=404, detail="No draft trip found. Create a trip first.")

    # A. Budget
    budget = body.get("budget")
    if budget is not None and budget > 0:
        trip.budget = float(budget)
    elif trip.budget is None:
        raise HTTPException(status_code=400, detail="Budget must be set before proceeding.")

    # B. Group type
    group_type = body.get("group_type", "Solo")
    group_map = {"Friends": "Friends Group", "Group": "Friends Group", "Couple": "Couple", "Solo": "Solo", "Family": "Family", "Other": "Other"}
    party_type = group_map.get(group_type, "Solo")
    
    trip_profile, created = db.query(TripProfile).filter(TripProfile.trip_id == trip.id).first_or_create(
        trip_id=trip.id,
        defaults={
            "party_type": party_type,
            "experience_type": body.get("experience_type", "Relaxed"),
            "food_pref": "Veg",
            "stay_pref": "3 Star",
            "transport_pref": "Train",
            "walking_tolerance": "Moderate",
            "language": "English",
            "specific_places": [],
            "priority": "Balanced",
            "selected_stay": None
        }
    )
    if not created:
        trip_profile.party_type = party_type
        trip_profile.experience_type = body.get("experience_type", trip_profile.experience_type)
    db.commit()

    # C. Traveller counts
    adults = body.get("adults", 0) or trip_profile.adults
    children = body.get("children", 0) or trip_profile.children
    total_travellers = adults + children
    
    if adults + children != total_travellers:
        raise HTTPException(
            status_code=400, detail="Total travellers must equal adults + children."
        )
    if total_travellers < 1 or total_travellers > 20:
        raise HTTPException(status_code=400, detail="Traveller count must be between 1 and 20.")
    if adults < 0 or children < 0:
        raise HTTPException(status_code=400, detail="Counts must be non-negative.")
    
    trip_profile.adults = adults
    trip_profile.children = children
    db.commit()

    # D. Experience type
    experience_map = {"Adventure": "Adventure", "Food & Culture": "Food & Culture", "Spiritual": "Spiritual", "Mixed": "Mixed"}
    experience_type = experience_map.get(body.get("experience_type", "Relaxed"), "Relaxed")
    trip_profile.experience_type = experience_type
    db.commit()

    # Budget feasibility check
    budget_val = float(trip.budget or 0)
    destination = trip.destination_name or ""
    profile_data = {"party_type": trip_profile.party_type, "adults": adults, "children": children}
    mode = "ADVENTUROUS_MODE"
    feasibility = check_budget_feasibility(budget=budget, destination=destination, mode=mode, profile=profile_data, requested_days=3)
    
    return {
        "status": "ok",
        "trip_id": trip.id,
        "budget_set": bool(trip.budget),
        "party_type": trip_profile.party_type,
        "experience_type": trip_profile.experience_type,
        "adults": adults,
        "children": children,
        "total_travellers": total_travellers,
        "budget_feasibility": feasibility["status"],
        "budget_message": feasibility["message"],
        "note": "All adaptive discovery data persisted. Proceed to Round-Trip Transport (Step 3)."
    }


@router.get("/{trip_id}/profile", response_model=dict)
def get_trip_profile(
    trip_id: str,
    current: dict = Depends(get_current_identity),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    profile = db.query(TripProfile).filter(TripProfile.trip_id == trip_id).first()
    if not profile:
        return {"trip_id": trip_id, "profile_not_populated": True}
    return {
        "trip_id": trip_id,
        "party_type": profile.party_type,
        "experience_type": profile.experience_type,
        "food_pref": profile.food_pref,
        "stay_pref": profile.stay_pref,
        "transport_pref": profile.transport_pref,
        "adults": profile.adults,
        "children": profile.children,
        "budget": trip.budget,
        "mode": trip.mode
    }


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
