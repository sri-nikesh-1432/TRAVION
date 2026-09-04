from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import Guide, GuideAssignment, Trip, Review
from app.schemas.schemas import (
    GuideOnboardingUpdate, GuideStatusUpdate, ReviewVisibilityUpdate, ReviewResponse
)

router = APIRouter(prefix="/guides", tags=["Guides"])

@router.post("/onboarding")
def submit_guide_onboarding(
    req: GuideOnboardingUpdate,
    current: dict = Depends(require_role("GUIDE")),
    db: Session = Depends(get_db)
):
    guide = db.query(Guide).filter(Guide.identity_id == current["identity_id"]).first()
    if not guide:
        raise HTTPException(status_code=404, detail="Guide account not found")

    # Mandatory structured onboarding: phone, real destinations/languages and
    # substantive knowledge + safety answers are required before Manager review.
    if not req.phone or len("".join(c for c in req.phone if c.isdigit())) < 10:
        raise HTTPException(status_code=400, detail="A valid phone number is mandatory for guide verification.")
    if not req.destinations:
        raise HTTPException(status_code=400, detail="Select at least one primary destination you can guide in.")
    if not req.languages:
        raise HTTPException(status_code=400, detail="Select at least one language you can guide in.")
    if not req.destination_knowledge or len(req.destination_knowledge.strip()) < 20:
        raise HTTPException(status_code=400, detail="Describe your destination knowledge in detail (minimum 20 characters).")
    if not req.safety_information or len(req.safety_information.strip()) < 20:
        raise HTTPException(status_code=400, detail="Provide your safety & emergency knowledge in detail (minimum 20 characters).")

    guide.first_name = req.first_name
    guide.last_name = req.last_name
    guide.phone = req.phone
    guide.languages = req.languages
    guide.destinations = req.destinations
    guide.experience_years = req.experience_years
    guide.specializations = req.specializations
    guide.destination_knowledge = req.destination_knowledge
    guide.safety_information = req.safety_information
    guide.approval_status = "PENDING"  # Submitted for Manager review
    # Unverified/pending guides must not operate trips yet.
    if guide.status == "ACTIVE":
        guide.status = "DUTY_OFF"

    db.commit()
    return {"message": "Onboarding details submitted. Awaiting Manager approval.", "guide_id": guide.id}

@router.patch("/status")
def update_guide_status(
    req: GuideStatusUpdate,
    current: dict = Depends(require_role("GUIDE")),
    db: Session = Depends(get_db)
):
    guide = db.query(Guide).filter(Guide.identity_id == current["identity_id"]).first()
    if not guide:
        raise HTTPException(status_code=404, detail="Guide not found")

    # If guide has an ongoing trip, cannot switch to DUTY_OFF or ACTIVE without finishing trip
    if guide.current_trip_id and req.status != "BUSY":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You currently have an active assigned trip. Complete your trip before changing availability."
        )

    guide.status = req.status
    db.commit()
    return {"message": f"Status updated to {guide.status}", "status": guide.status}

@router.get("/assigned-trips")
def get_assigned_trips(
    current: dict = Depends(require_role("GUIDE")),
    db: Session = Depends(get_db)
):
    guide = db.query(Guide).filter(Guide.identity_id == current["identity_id"]).first()
    if not guide:
        raise HTTPException(status_code=404, detail="Guide not found")

    assignments = db.query(GuideAssignment).filter(
        GuideAssignment.guide_id == guide.id
    ).all()

    res = []
    for a in assignments:
        trip = a.trip
        user = trip.user
        res.append({
            "assignment_id": a.id,
            "status": a.status,
            "match_score": a.match_score,
            "requested_at": a.requested_at,
            "trip": {
                "id": trip.id,
                "source": trip.source_name,
                "destination": trip.destination_name,
                "start_datetime": trip.start_datetime,
                "end_datetime": trip.end_datetime,
                "status": trip.status,
                "total_cost": trip.total_cost,
                "traveller": {
                    "name": f"{user.first_name} {user.last_name}".strip() if user else "Traveller",
                    "language": user.preferred_language if user else "English",
                    "phone": user.emergency_contact_phone if user else None
                }
            }
        })
    return res

@router.patch("/reviews/{review_id}/visibility")
def toggle_review_visibility(
    review_id: str,
    req: ReviewVisibilityUpdate,
    current: dict = Depends(require_role("GUIDE")),
    db: Session = Depends(get_db)
):
    guide = db.query(Guide).filter(Guide.identity_id == current["identity_id"]).first()
    if not guide:
        raise HTTPException(status_code=404, detail="Guide not found")

    review = db.query(Review).filter(Review.id == review_id, Review.guide_id == guide.id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found on your profile")

    # Hiding never deletes: retains record in DB for Admin oversight
    review.is_visible_on_profile = req.is_visible_on_profile
    db.commit()
    return {
        "message": f"Review visibility set to {'visible' if req.is_visible_on_profile else 'hidden'}",
        "review_id": review.id,
        "is_visible_on_profile": review.is_visible_on_profile
    }

@router.get("/my-reviews", response_model=List[ReviewResponse])
def get_my_reviews(
    current: dict = Depends(require_role("GUIDE")),
    db: Session = Depends(get_db)
):
    guide = db.query(Guide).filter(Guide.identity_id == current["identity_id"]).first()
    if not guide:
        return []
    return db.query(Review).filter(Review.guide_id == guide.id).order_by(Review.created_at.desc()).all()
