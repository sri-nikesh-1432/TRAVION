from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import (
    Identity, User, Guide, Manager, Admin, Trip, Payment, PaymentSplit, Review, AuditLog
)

router = APIRouter(prefix="/admin", tags=["Admin"])

@router.get("/overview")
def get_admin_overview(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    total_users = db.query(User).count()
    total_guides = db.query(Guide).count()
    total_managers = db.query(Manager).count()
    active_trips = db.query(Trip).filter(Trip.status.in_(["ACTIVE", "GUIDE_ASSIGNED", "PAID"])).count()
    completed_trips = db.query(Trip).filter(Trip.status == "COMPLETED").count()

    return {
        "total_users": total_users,
        "total_guides": total_guides,
        "total_managers": total_managers,
        "active_trips": active_trips,
        "completed_trips": completed_trips
    }

@router.get("/revenue")
def get_admin_revenue(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    """
    CRITICAL PRD REQUIREMENT:
    Admin Revenue Dashboard shows TWO distinct numbers:
    1. Total Platform Transactions (all user payments)
    2. Actual Platform Revenue (platform fee only — guide fees are EXPLICITLY excluded)
    3. Guide Fees (tracked separately)
    """
    total_transactions = db.query(func.sum(Payment.total_amount)).filter(Payment.status == "SUCCESS").scalar() or 0.0
    platform_revenue = (
        db.query(func.sum(PaymentSplit.platform_fee))
        .join(Payment, Payment.id == PaymentSplit.payment_id)
        .filter(Payment.status == "SUCCESS")
        .scalar() or 0.0
    )
    total_guide_fees = (
        db.query(func.sum(PaymentSplit.guide_fee))
        .join(Payment, Payment.id == PaymentSplit.payment_id)
        .filter(Payment.status == "SUCCESS")
        .scalar() or 0.0
    )

    return {
        "total_platform_transactions": round(total_transactions, 2),
        "actual_platform_revenue": round(platform_revenue, 2),
        "total_guide_fees_payout": round(total_guide_fees, 2),
        "currency": "INR",
        "notes": "Platform revenue accounts strictly for platform service commissions. Guide fees are held for local guide settlements and excluded from company revenue."
    }

@router.get("/users")
def get_all_users(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    users = db.query(User).all()
    return [
        {
            "id": u.id,
            "email": u.identity.email if u.identity else "N/A",
            "name": f"{u.first_name} {u.last_name}".strip() or u.preferred_name or "Anonymous",
            "preferred_language": u.preferred_language,
            "country": u.country,
            "home_city": u.home_city,
            "created_at": u.created_at
        }
        for u in users
    ]

@router.get("/guides")
def get_all_guides(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    guides = db.query(Guide).all()
    return [
        {
            "id": g.id,
            "email": g.identity.email if g.identity else "N/A",
            "name": f"{g.first_name} {g.last_name}",
            "status": g.status,
            "approval_status": g.approval_status,
            "languages": g.languages,
            "destinations": g.destinations,
            "experience_years": g.experience_years,
            "rating": g.rating,
            "review_count": g.review_count,
            "created_at": g.created_at
        }
        for g in guides
    ]

@router.get("/reviews")
def get_all_reviews_for_moderation(
    include_hidden: bool = Query(True),
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    """
    Allows Admin to review all user ratings, including those hidden by guides.
    """
    query = db.query(Review)
    if not include_hidden:
        query = query.filter(Review.is_visible_on_profile == True)
    reviews = query.order_by(Review.created_at.desc()).all()
    return [
        {
            "id": r.id,
            "trip_id": r.trip_id,
            "guide_id": r.guide_id,
            "guide_name": f"{r.guide.first_name} {r.guide.last_name}" if r.guide else "Guide",
            "user_name": r.user_name,
            "rating": r.rating,
            "comment": r.comment,
            "is_visible_on_profile": r.is_visible_on_profile,
            "created_at": r.created_at
        }
        for r in reviews
    ]

@router.get("/audit-logs")
def get_audit_logs(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    return db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(100).all()
