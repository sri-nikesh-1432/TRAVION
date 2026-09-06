from datetime import datetime
from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import (
    Guide, Trip, GuideAssignment, PaymentSplit, Payment, User, AuditLog,
    Itinerary, Review, ChatMessage,
)
from app.schemas.schemas import AssignGuideRequest
from app.services.matching_engine import GuideMatchingEngine

router = APIRouter(prefix="/manager", tags=["Manager"])

@router.get("/dashboard-stats")
def get_manager_stats(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    total_trips = db.query(Trip).count()
    pending_requests = db.query(GuideAssignment).filter(GuideAssignment.status == "REQUESTED").count()
    active_guides = db.query(Guide).filter(Guide.status == "ACTIVE", Guide.approval_status == "APPROVED").count()
    busy_guides = db.query(Guide).filter(Guide.status == "BUSY").count()
    duty_off_guides = db.query(Guide).filter(Guide.status == "DUTY_OFF").count()
    completed_trips = db.query(Trip).filter(Trip.status == "COMPLETED").count()
    pending_guide_approvals = db.query(Guide).filter(Guide.approval_status == "PENDING").count()

    return {
        "today_trips": total_trips,
        "pending_requests": pending_requests,
        "active_guides": active_guides,
        "busy_guides": busy_guides,
        "duty_off_guides": duty_off_guides,
        "completed_trips": completed_trips,
        "pending_guide_approvals": pending_guide_approvals
    }

@router.get("/pending-guides")
def get_pending_guides(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    guides = db.query(Guide).filter(Guide.approval_status == "PENDING").all()
    return [
        {
            "id": g.id,
            "name": f"{g.first_name} {g.last_name}",
            "languages": g.languages,
            "destinations": g.destinations,
            "experience_years": g.experience_years,
            "specializations": g.specializations,
            "destination_knowledge": g.destination_knowledge,
            "safety_information": g.safety_information,
            "created_at": g.created_at
        }
        for g in guides
    ]

@router.post("/guides/{guide_id}/approval")
def approve_or_reject_guide(
    guide_id: str,
    action: str,  # APPROVE or REJECT
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    guide = db.query(Guide).filter(Guide.id == guide_id).first()
    if not guide:
        raise HTTPException(status_code=404, detail="Guide not found")

    if action.upper() == "APPROVE":
        guide.approval_status = "APPROVED"
        guide.status = "ACTIVE"
    else:
        guide.approval_status = "REJECTED"
        guide.status = "DUTY_OFF"

    # Audit log
    audit = AuditLog(
        action=f"GUIDE_{action.upper()}",
        actor_email=current["email"],
        actor_role=current["role"],
        target_id=guide.id,
        details={"decision": action.upper()}
    )
    db.add(audit)
    db.commit()

    return {"message": f"Guide application {action.lower()}d successfully", "guide_id": guide.id}

@router.get("/trip-requests")
def get_trip_requests(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    assignments = db.query(GuideAssignment).filter(
        GuideAssignment.status.in_(["REQUESTED", "ACCEPTED", "CONFIRMED"])
    ).all()

    res = []
    for a in assignments:
        trip = a.trip
        user = trip.user
        res.append({
            "assignment_id": a.id,
            "trip_id": trip.id,
            "status": a.status,
            "destination": trip.destination_name,
            "source": trip.source_name,
            "start_datetime": trip.start_datetime,
            "end_datetime": trip.end_datetime,
            "assigned_guide_id": a.guide_id,
            "assigned_guide_name": f"{a.guide.first_name} {a.guide.last_name}" if a.guide else None,
            "match_score": a.match_score,
            "traveller": {
                "name": f"{user.first_name} {user.last_name}".strip() if user else "Traveller",
                "preferred_language": user.preferred_language if user else "English"
            }
        })
    return res

@router.get("/trip-requests/{trip_id}/candidates")
def get_ranked_candidates(
    trip_id: str,
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    user = trip.user
    preferred_lang = user.preferred_language if user else "English"
    add_langs = user.additional_languages if user else []

    # Find approved guides
    guides = db.query(Guide).filter(Guide.approval_status == "APPROVED").all()

    candidates = []
    for g in guides:
        score_res = GuideMatchingEngine.calculate_match(
            guide=g,
            destination_name=trip.destination_name,
            preferred_language=preferred_lang,
            additional_languages=add_langs
        )
        candidates.append({
            "guide_id": g.id,
            "name": f"{g.first_name} {g.last_name}",
            "photo_url": g.photo_url,
            "languages": g.languages or [],
            "rating": g.rating or 5.0,
            "review_count": g.review_count or 0,
            "experience_years": g.experience_years or 1,
            "match_score": score_res["match_score"],
            "match_breakdown": score_res["breakdown"],
            "status": g.status
        })

    # Sort descending by match score
    candidates.sort(key=lambda x: x["match_score"], reverse=True)
    return candidates

@router.post("/trip-requests/{trip_id}/assign")
def assign_guide_to_trip(
    trip_id: str,
    req: AssignGuideRequest,
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    guide = db.query(Guide).filter(Guide.id == req.guide_id).first()
    if not guide:
        raise HTTPException(status_code=404, detail="Guide not found")

    # Real concurrency check: guide cannot be assigned if already busy or duty off
    if guide.status == "BUSY" and guide.current_trip_id != trip.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This guide is currently marked BUSY with another active trip."
        )
    if guide.status == "DUTY_OFF":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This guide is currently on DUTY_OFF and cannot receive assignments."
        )

    assignment = db.query(GuideAssignment).filter(GuideAssignment.trip_id == trip.id).first()
    if not assignment:
        assignment = GuideAssignment(trip_id=trip.id)
        db.add(assignment)

    assignment.guide_id = guide.id
    assignment.status = "CONFIRMED"

    # Flip guide status
    guide.status = "BUSY"
    guide.current_trip_id = trip.id

    # Update trip status
    trip.status = "GUIDE_ASSIGNED"

    # Guide synchronization: the guide receives the COMPLETE trip context in
    # their chat channel the moment the manager confirms the assignment.
    profile = trip.profile
    db.add(ChatMessage(
        trip_id=trip.id,
        sender_role="AI",
        sender_id="system",
        sender_name="Travion",
        channel="GUIDE",
        message=(
            f"New trip assigned: {trip.source_name} → {trip.destination_name}, "
            f"{trip.start_datetime:%d %b %Y} to {trip.end_datetime:%d %b %Y}. "
            f"Budget ₹{round(trip.total_cost or 0):,}. "
            f"Preferences — party: {profile.party_type if profile else 'n/a'}; "
            f"food: {profile.food_pref if profile else 'n/a'}; "
            f"stay: {profile.stay_pref if profile else 'n/a'}; "
            f"transport: {profile.transport_pref if profile else 'n/a'}. "
            "The complete itinerary is visible in your trip view."
        ),
    ))

    # Audit log
    audit = AuditLog(
        action="GUIDE_ASSIGNED",
        actor_email=current["email"],
        actor_role=current["role"],
        target_id=trip.id,
        details={"guide_id": guide.id, "guide_name": f"{guide.first_name} {guide.last_name}"}
    )
    db.add(audit)
    db.commit()

    return {
        "message": "Guide has been successfully assigned to the trip",
        "trip_id": trip.id,
        "guide_id": guide.id,
        "status": trip.status
    }

@router.get("/settlements")
def get_payment_settlements(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    splits = db.query(PaymentSplit).all()
    res = []
    for s in splits:
        payment = s.payment
        trip = payment.trip if payment else None
        guide = trip.guide_assignment.guide if (trip and trip.guide_assignment) else None
        res.append({
            "split_id": s.id,
            "payment_id": payment.id if payment else None,
            "trip_id": trip.id if trip else None,
            "guide_name": f"{guide.first_name} {guide.last_name}" if guide else "N/A",
            "guide_fee": s.guide_fee,
            "platform_fee": s.platform_fee,
            "total_amount": payment.total_amount if payment else 0.0,
            "settlement_status": s.settlement_status,
            "settled_at": s.settled_at
        })
    return res

@router.post("/settlements/{split_id}/settle")
def settle_guide_payout(
    split_id: str,
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    split = db.query(PaymentSplit).filter(PaymentSplit.id == split_id).first()
    if not split:
        raise HTTPException(status_code=404, detail="Settlement record not found")

    split.settlement_status = "SETTLED"
    split.settled_at = datetime.utcnow()
    db.commit()

    audit = AuditLog(
        action="SETTLEMENT_MARKED",
        actor_email=current["email"],
        actor_role=current["role"],
        target_id=split.id,
        details={"guide_fee": split.guide_fee, "platform_fee": split.platform_fee}
    )
    db.add(audit)
    db.commit()
    return {"message": "Guide fee payout settled successfully", "split_id": split.id}


# ────────────────────────────────────────────────────────────────────────
# Manager portal pages — every number below comes from real records.
# ────────────────────────────────────────────────────────────────────────

def _trip_ledger_row(db: Session, trip: Trip) -> dict:
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


@router.get("/guides")
def get_manager_guides(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    """Full guide roster for the manager Guides page (real DB records)."""
    guides = db.query(Guide).order_by(Guide.created_at.desc()).all()
    return [
        {
            "id": g.id,
            "name": f"{g.first_name} {g.last_name}",
            "status": g.status,
            "approval_status": g.approval_status,
            "languages": g.languages or [],
            "destinations": g.destinations or [],
            "experience_years": g.experience_years or 0,
            "specializations": g.specializations or [],
            "rating": g.rating or 5.0,
            "review_count": g.review_count or 0,
            "current_trip_id": g.current_trip_id,
            "created_at": g.created_at,
        }
        for g in guides
    ]


@router.get("/active-trips")
def get_manager_active_trips(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    """Live trip operations: every running trip and the guide on it."""
    trips = db.query(Trip).filter(Trip.status.in_(["PAID", "ACTIVE", "GUIDE_ASSIGNED"])).order_by(Trip.start_datetime.desc()).all()
    rows = []
    for trip in trips:
        row = _trip_ledger_row(db, trip)
        # Active itinerary day span for live operations.
        itin = db.query(Itinerary).filter(
            Itinerary.trip_id == trip.id, Itinerary.is_active == True
        ).first()
        row["plan_days"] = len(itin.days_data) if itin and itin.days_data else 0
        rows.append(row)
    return rows


@router.get("/payments")
def get_manager_payments(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    """Operational payment ledger — actual transactions only."""
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


@router.get("/revenue")
def get_manager_revenue(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    """Operational revenue analytics computed from real payments + splits."""
    payments = db.query(Payment).filter(Payment.status == "SUCCESS").all()
    splits = db.query(PaymentSplit).all()

    gross = float(sum(p.total_amount for p in payments))
    platform_total = 0.0
    guide_total = 0.0
    settled = 0.0
    pending = 0.0
    by_dest: Dict[str, float] = {}
    by_mode: Dict[str, float] = {}
    by_month: Dict[str, Dict[str, float]] = {}
    status_counts: Dict[str, int] = {}

    for s in splits:
        payment = s.payment
        if payment and payment.status == "SUCCESS":
            platform_total += float(s.platform_fee or 0)
            gf = float(s.guide_fee or 0)
            guide_total += gf
            if s.settlement_status == "SETTLED":
                settled += gf
            else:
                pending += gf
            trip = payment.trip
            if trip:
                dest = trip.destination_name or "Unknown"
                by_dest[dest] = by_dest.get(dest, 0.0) + float(payment.total_amount or 0)
                mode = trip.mode or "Unknown"
                by_mode[mode] = by_mode.get(mode, 0.0) + float(payment.total_amount or 0)
                month = payment.created_at.strftime("%Y-%m") if payment.created_at else "Unknown"
                bucket = by_month.setdefault(month, {"platform": 0.0, "guide": 0.0, "gross": 0.0})
                bucket["platform"] += float(s.platform_fee or 0)
                bucket["guide"] += gf
                bucket["gross"] += float(payment.total_amount or 0)

    mode_counts = db.query(Trip.mode, func.count(Trip.id)).group_by(Trip.mode).all()
    for m, c in mode_counts:
        status_counts[f"trips_{m or 'UNKNOWN'}"] = c
    pay_counts = db.query(Payment.status, func.count(Payment.id)).group_by(Payment.status).all()
    for st, c in pay_counts:
        status_counts[f"payment_{st}"] = c

    by_month_sorted = [
        {"month": k, **v} for k, v in sorted(by_month.items())
    ]
    by_dest_sorted = sorted(
        [{"destination": k, "revenue": round(v, 2)} for k, v in by_dest.items()],
        key=lambda x: x["revenue"], reverse=True,
    )
    by_mode_sorted = [{"mode": k, "revenue": round(v, 2)} for k, v in by_mode.items()]

    return {
        "gross_traveller_payments": round(gross, 2),
        "platform_revenue": round(platform_total, 2),
        "guide_fees": round(guide_total, 2),
        "settled_guide_fees": round(settled, 2),
        "pending_settlements": round(pending, 2),
        "by_month": by_month_sorted,
        "by_destination": by_dest_sorted,
        "by_mode": by_mode_sorted,
        "status_counts": status_counts,
        "currency": "INR",
    }


@router.get("/reviews")
def get_manager_reviews(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    reviews = db.query(Review).order_by(Review.created_at.desc()).all()
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
            "created_at": r.created_at,
        }
        for r in reviews
    ]
