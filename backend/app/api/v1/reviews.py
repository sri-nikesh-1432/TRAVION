from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import Trip, Guide, User, Review
from app.schemas.schemas import ReviewCreate, ReviewResponse

router = APIRouter(prefix="", tags=["Reviews"])

@router.post("/trips/{trip_id}/review", response_model=ReviewResponse)
def submit_trip_review(
    trip_id: str,
    req: ReviewCreate,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.identity_id == current["identity_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user.id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found for your account")

    # Only once per trip
    existing = db.query(Review).filter(Review.trip_id == trip.id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have already submitted a review for this trip."
        )

    # Must be COMPLETED or ACTIVE in test
    guide = None
    if trip.guide_assignment and trip.guide_assignment.guide:
        guide = trip.guide_assignment.guide
    else:
        # Check if guide assignment exists
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No assigned guide found on this trip to review."
        )

    user_name = f"{user.first_name} {user.last_name}".strip() or user.preferred_name or "Traveller"

    review = Review(
        trip_id=trip.id,
        guide_id=guide.id,
        user_id=user.id,
        user_name=user_name,
        rating=req.rating,
        comment=req.comment,
        is_visible_on_profile=True
    )
    db.add(review)

    # Recalculate guide average rating
    all_ratings = db.query(func.avg(Review.rating), func.count(Review.id)).filter(
        Review.guide_id == guide.id
    ).first()
    curr_avg = all_ratings[0] if all_ratings and all_ratings[0] else float(req.rating)
    curr_count = (all_ratings[1] or 0) + 1
    new_avg = round(((curr_avg * (curr_count - 1)) + req.rating) / curr_count, 1)

    guide.rating = new_avg
    guide.review_count = curr_count

    db.commit()
    db.refresh(review)

    return review

@router.get("/guides/{guide_id}/reviews", response_model=List[ReviewResponse])
def get_public_guide_reviews(
    guide_id: str,
    db: Session = Depends(get_db)
):
    return db.query(Review).filter(
        Review.guide_id == guide_id,
        Review.is_visible_on_profile == True
    ).order_by(Review.created_at.desc()).all()
