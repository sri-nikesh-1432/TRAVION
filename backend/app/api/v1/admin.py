from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import (
    Identity, User, Guide, Manager, Admin, Trip, Payment, PaymentSplit, Review, AuditLog,
    GuideAssignment,
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
    verified_guides = db.query(Guide).filter(Guide.approval_status == "APPROVED").count()
    pending_guides = db.query(Guide).filter(Guide.approval_status == "PENDING").count()
    total_payments = db.query(Payment).filter(Payment.status == "SUCCESS").count()
    failed_payments = db.query(Payment).filter(Payment.status == "FAILED").count()

    platform_revenue = (
        db.query(func.sum(PaymentSplit.platform_fee))
        .join(Payment, Payment.id == PaymentSplit.payment_id)
        .filter(Payment.status == "SUCCESS")
        .scalar() or 0.0
    )
    pending_settlements = (
        db.query(func.count(PaymentSplit.id))
        .filter(PaymentSplit.settlement_status == "PENDING")
        .scalar() or 0
    )

    return {
        "total_users": total_users,
        "total_guides": total_guides,
        "verified_guides": verified_guides,
        "pending_guides": pending_guides,
        "total_managers": total_managers,
        "active_trips": active_trips,
        "completed_trips": completed_trips,
        "total_payments": total_payments,
        "failed_payments": failed_payments,
        "platform_revenue": round(platform_revenue, 2),
        "pending_settlements": pending_settlements,
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

    # Analytics series for the Revenue Analytics page (from real records).
    payments = db.query(Payment).filter(Payment.status == "SUCCESS").all()
    by_month: List[Dict[str, Any]] = []
    by_dest: Dict[str, float] = {}
    by_mode: Dict[str, float] = {}
    month_buckets: Dict[str, Dict[str, float]] = {}
    for p in payments:
        trip = p.trip
        split = p.split
        gf = float(split.guide_fee) if split else 0.0
        pf = float(split.platform_fee) if split else 0.0
        month = p.created_at.strftime("%Y-%m") if p.created_at else "Unknown"
        b = month_buckets.setdefault(month, {"platform": 0.0, "guide": 0.0, "gross": 0.0})
        b["gross"] += float(p.total_amount or 0)
        b["platform"] += pf
        b["guide"] += gf
        if trip:
            by_dest[trip.destination_name or "Unknown"] = by_dest.get(trip.destination_name or "Unknown", 0.0) + float(p.total_amount or 0)
            by_mode[trip.mode or "Unknown"] = by_mode.get(trip.mode or "Unknown", 0.0) + float(p.total_amount or 0)
    by_month = [{"month": k, **v} for k, v in sorted(month_buckets.items())]
    by_dest_list = sorted(
        [{"destination": k, "revenue": round(v, 2)} for k, v in by_dest.items()],
        key=lambda x: x["revenue"], reverse=True,
    )
    by_mode_list = [{"mode": k, "revenue": round(v, 2)} for k, v in by_mode.items()]

    payment_status_counts = [
        {"status": st, "count": c} for st, c in db.query(Payment.status, func.count(Payment.id)).group_by(Payment.status).all()
    ]
    settlement_status_counts = [
        {"status": st, "count": c} for st, c in db.query(PaymentSplit.settlement_status, func.count(PaymentSplit.id)).group_by(PaymentSplit.settlement_status).all()
    ]
    settled_guide_fees = db.query(func.sum(PaymentSplit.guide_fee)).filter(PaymentSplit.settlement_status == "SETTLED").scalar() or 0.0
    pending_guide_fees = db.query(func.sum(PaymentSplit.guide_fee)).filter(PaymentSplit.settlement_status == "PENDING").scalar() or 0.0

    return {
        "total_platform_transactions": round(total_transactions, 2),
        "actual_platform_revenue": round(platform_revenue, 2),
        "total_guide_fees_payout": round(total_guide_fees, 2),
        "settled_guide_fees": round(settled_guide_fees, 2),
        "pending_guide_fees": round(pending_guide_fees, 2),
        "net_revenue": round(platform_revenue - 0, 2),
        "by_month": by_month,
        "by_destination": by_dest_list,
        "by_mode": by_mode_list,
        "payment_status_counts": payment_status_counts,
        "settlement_status_counts": settlement_status_counts,
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


# ────────────────────────────────────────────────────────────────────────
# Admin portal pages — every value below is computed from real records.
# ────────────────────────────────────────────────────────────────────────

def _trip_row(db: Session, trip: Trip) -> dict:
    user = trip.user
    guide = None
    assignment = trip.guide_assignment
    if assignment and assignment.guide:
        guide = assignment.guide
    payment = db.query(Payment).filter(Payment.trip_id == trip.id).first()
    return {
        "trip_id": trip.id,
        "traveller": f"{user.first_name} {user.last_name}".strip() if user else "Traveller",
        "source": trip.source_name,
        "destination": trip.destination_name,
        "start_datetime": trip.start_datetime,
        "end_datetime": trip.end_datetime,
        "mode": trip.mode,
        "budget": trip.budget,
        "total_cost": trip.total_cost,
        "status": trip.status,
        "guide_name": f"{guide.first_name} {guide.last_name}" if guide else None,
        "payment_status": payment.status if payment else None,
        "created_at": trip.created_at,
    }


@router.get("/trips")
def get_admin_trips(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    trips = db.query(Trip).order_by(Trip.created_at.desc()).all()
    return [_trip_row(db, t) for t in trips]


@router.get("/payments")
def get_admin_payments(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    payments = db.query(Payment).order_by(Payment.created_at.desc()).all()
    rows = []
    for p in payments:
        trip = p.trip
        user = trip.user if trip else None
        split = db.query(PaymentSplit).filter(PaymentSplit.payment_id == p.id).first()
        guide = None
        if trip and trip.guide_assignment and trip.guide_assignment.guide:
            guide = trip.guide_assignment.guide
        rows.append({
            "payment_id": p.id,
            "razorpay_order_id": p.razorpay_order_id,
            "trip_id": trip.id if trip else None,
            "traveller": f"{user.first_name} {user.last_name}".strip() if user else "Traveller",
            "destination": trip.destination_name if trip else None,
            "amount": p.total_amount,
            "currency": p.currency,
            "status": p.status,
            "guide_name": f"{guide.first_name} {guide.last_name}" if guide else None,
            "guide_fee": split.guide_fee if split else 0.0,
            "platform_fee": split.platform_fee if split else 0.0,
            "settlement_status": split.settlement_status if split else None,
            "created_at": p.created_at,
        })
    return rows


@router.get("/settlements")
def get_admin_settlements(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    splits = db.query(PaymentSplit).order_by(PaymentSplit.id.desc()).all()
    rows = []
    for s in splits:
        payment = s.payment
        trip = payment.trip if payment else None
        user = trip.user if trip else None
        guide = None
        if trip and trip.guide_assignment and trip.guide_assignment.guide:
            guide = trip.guide_assignment.guide
        rows.append({
            "split_id": s.id,
            "trip_id": trip.id if trip else None,
            "traveller": f"{user.first_name} {user.last_name}".strip() if user else "Traveller",
            "destination": trip.destination_name if trip else None,
            "guide_name": f"{guide.first_name} {guide.last_name}" if guide else None,
            "guide_fee": s.guide_fee,
            "platform_fee": s.platform_fee,
            "total_amount": payment.total_amount if payment else 0.0,
            "payment_status": payment.status if payment else None,
            "settlement_status": s.settlement_status,
            "settled_at": s.settled_at,
        })
    return rows


@router.get("/managers")
def get_admin_managers(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    managers = db.query(Manager).all()
    rows = []
    for m in managers:
        assignments = db.query(GuideAssignment).filter(GuideAssignment.manager_id == m.id).count()
        audit_actions = db.query(AuditLog).filter(AuditLog.actor_email == (m.identity.email if m.identity else "")).count()
        rows.append({
            "id": m.id,
            "name": m.name,
            "email": m.identity.email if m.identity else "N/A",
            "department": m.department,
            "assignments": assignments,
            "audit_actions": audit_actions,
            "created_at": m.created_at,
        })
    return rows


@router.get("/conversions")
def get_admin_conversions(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    """Assignment history + conversion funnel computed from real records."""
    assignments = db.query(GuideAssignment).order_by(GuideAssignment.requested_at.desc()).all()
    rows = []
    for a in assignments:
        trip = a.trip
        user = trip.user if trip else None
        guide = a.guide
        rows.append({
            "assignment_id": a.id,
            "trip_id": trip.id if trip else None,
            "traveller": f"{user.first_name} {user.last_name}".strip() if user else "Traveller",
            "destination": trip.destination_name if trip else None,
            "guide_name": f"{guide.first_name} {guide.last_name}" if guide else None,
            "status": a.status,
            "match_score": a.match_score,
            "requested_at": a.requested_at,
            "confirmed_at": a.confirmed_at,
        })
    total_requests = db.query(Trip).count()
    guide_mode_requests = db.query(Trip).filter(Trip.mode == "GUIDE_MODE").count()
    assigned = db.query(GuideAssignment).filter(GuideAssignment.status.in_(["CONFIRMED"])).count()
    active = db.query(Trip).filter(Trip.status.in_(["PAID", "ACTIVE", "GUIDE_ASSIGNED"])).count()
    completed = db.query(Trip).filter(Trip.status == "COMPLETED").count()
    funnel = {
        "trip_requests": total_requests,
        "guide_mode_requests": guide_mode_requests,
        "guide_assigned": assigned,
        "trip_started": active,
        "trip_completed": completed,
    }
    return {"assignments": rows, "funnel": funnel}


@router.get("/analytics")
def get_admin_analytics(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    """Non-financial platform analytics from real records."""
    def month_series(rows):
        buckets: Dict[str, int] = {}
        for row in rows:
            created_at = row[0]
            month = created_at.strftime("%Y-%m") if created_at else "Unknown"
            buckets[month] = buckets.get(month, 0) + 1
        return [{"month": k, "count": v} for k, v in sorted(buckets.items())]

    dest_pop = [
        {"destination": d, "count": c} for d, c in db.query(Trip.destination_name, func.count(Trip.id)).group_by(Trip.destination_name).all()
    ]
    dest_pop.sort(key=lambda x: x["count"], reverse=True)
    mode_pop = [
        {"mode": m, "count": c} for m, c in db.query(Trip.mode, func.count(Trip.id)).group_by(Trip.mode).all()
    ]
    status_dist = [
        {"status": st, "count": c} for st, c in db.query(Trip.status, func.count(Trip.id)).group_by(Trip.status).all()
    ]
    avg_budget = db.query(func.avg(Trip.budget)).scalar() or 0
    avg_duration_days = 0.0
    all_trips = db.query(Trip).all()
    durations = []
    for t in all_trips:
        if t.start_datetime and t.end_datetime:
            durations.append((t.end_datetime - t.start_datetime).days + 1)
    avg_duration_days = round(sum(durations) / len(durations), 1) if durations else 0.0
    avg_rating = db.query(func.avg(Review.rating)).scalar() or 0.0

    mode_trip_count = db.query(Trip).filter(Trip.mode == "GUIDE_MODE").count()
    assigned_count = db.query(GuideAssignment).filter(GuideAssignment.status == "CONFIRMED").count()
    completed_count = db.query(Trip).filter(Trip.status == "COMPLETED").count()
    total_trips = db.query(Trip).count()

    return {
        "users_growth": month_series(db.query(User.created_at).all()),
        "guides_growth": month_series(db.query(Guide.created_at).all()),
        "trips_growth": month_series(db.query(Trip.created_at).all()),
        "destination_popularity": dest_pop,
        "mode_popularity": mode_pop,
        "trip_status_distribution": status_dist,
        "average_budget": round(float(avg_budget), 0),
        "average_trip_duration_days": avg_duration_days,
        "average_guide_rating": round(float(avg_rating), 2),
        "assignment_rate": round(assigned_count / mode_trip_count * 100, 1) if mode_trip_count else 0.0,
        "completion_rate": round(completed_count / max(total_trips, 1) * 100, 1),
    }


@router.get("/active-operations")
def get_admin_active_operations(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    trips = db.query(Trip).filter(Trip.status.in_(["PAID", "ACTIVE", "GUIDE_ASSIGNED"])).order_by(Trip.start_datetime.desc()).all()
    return [_trip_row(db, t) for t in trips]
