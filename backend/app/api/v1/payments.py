from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import (
    Trip, Itinerary, Payment, PaymentSplit, OfflinePackage,
    GuideAssignment, Cancellation, AuditLog, User, get_utc_now
)
from app.schemas.schemas import (
    CheckoutRequest, CheckoutResponse, PaymentWebhookRequest,
    TripPricingResponse, TripCancelRequest
)
from app.services.payment_service import PaymentService
from app.services.offline_service import OfflinePackageService
from app.services.pricing_service import calculate_trip_pricing

router = APIRouter(prefix="", tags=["Payments"])
logger = logging.getLogger(__name__)


def _pricing_context(trip: Trip, itinerary: Itinerary, db: Session) -> dict:
    """Build the authoritative pricing inputs from ONE place so checkout, the
    pricing endpoint, the webhook and every dashboard show identical numbers."""
    from app.services.stage_service import evaluate_budget_gate
    evaluate_budget_gate(db, trip)
    if itinerary:
        db.refresh(itinerary)
    profile = trip.profile.questions_answers if trip.profile else {}
    days = len(itinerary.days_data or []) if itinerary else 1
    # GUIDE_*: only an accepted/confirmed real guide is load-bearing for the
    # per-guide rate. REQUESTED is still "no guide decided yet" → rule-based fee.
    guide = None
    if trip.guide_assignment and trip.guide_assignment.status in ("ACCEPTED", "CONFIRMED"):
        guide = trip.guide_assignment.guide or None
    return {
        "mode": trip.mode or "ADVENTUROUS_MODE",
        "days": days,
        "destination": trip.destination_name or "",
        "party_type": profile.get("party") or (trip.profile.party_type if trip.profile else None),
        "budget": trip.budget or 0.0,
        "breakdown": itinerary.cost_breakdown if itinerary else None,
        "guide": guide,
    }


def _guide_required(trip: Trip) -> bool:
    return (trip.mode or "") == "GUIDE_MODE"


def _guide_assigned(trip: Trip) -> bool:
    return bool(
        trip.guide_assignment
        and trip.guide_assignment.status in ("ACCEPTED", "CONFIRMED")
        and trip.guide_assignment.guide_id
    )


@router.post("/trips/{trip_id}/checkout", response_model=CheckoutResponse)
def create_trip_checkout(
    trip_id: str,
    req: CheckoutRequest,
    current: dict = Depends(require_role("USER")),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    itinerary = db.query(Itinerary).filter(
        Itinerary.trip_id == trip.id,
        Itinerary.is_active == True
    ).first()
    if not itinerary:
        raise HTTPException(status_code=400, detail="Active itinerary required before checkout")

    # §20 hard gate: the traveller must have accepted the non-refundable
    # acknowledgement BEFORE payment can even be prepared. Stored with the
    # transaction record so the order itself carries proof of acceptance.
    if not req.non_refundable_acknowledged:
        raise HTTPException(
            status_code=400,
            detail="Please accept the non-refundable acknowledgement before confirming payment.",
        )
    acknowledged_at = get_utc_now()

    # PART Y: the itinerary must pass the schedule validator BEFORE payment —
    # an impossible itinerary (pre-trip-start Day-1 item, overlapping stops,
    # unparseable times) can never be paid for. Runs on the authoritative
    # stored days (the user's finalItinerary).
    try:
        from app.services.multi_plan_engine import validate_schedule
        from zoneinfo import ZoneInfo
        _s = trip.start_datetime
        if _s and _s.tzinfo is None:
            _s = _s.replace(tzinfo=ZoneInfo("Asia/Kolkata"))
        _fd = _s.astimezone(ZoneInfo("Asia/Kolkata")).strftime("%I:%M %p") if _s else None
        violations = validate_schedule(itinerary.days_data or [], first_day_start=_fd)
        if violations:
            raise HTTPException(
                status_code=422,
                detail={
                    "error_code": "INVALID_ITINERARY_SCHEDULE",
                    "message": "The itinerary has scheduling problems that must be fixed before payment.",
                    "violations": violations[:5],
                },
            )
    except HTTPException:
        raise
    except Exception:
        pass  # a malformed stored itinerary still fails loudly at pricing below

    # Server-side truth: THE authoritative backend pricing (never client input).
    pricing = calculate_trip_pricing(**_pricing_context(trip, itinerary, db))
    payable = float(pricing["amount_payable"])
    if payable <= 0:
        raise HTTPException(status_code=400, detail="No payable fees configured for this trip yet")

    # Travion collects ONLY Guide Fee + Platform Fee — never the travel budget.
    order_info = PaymentService.create_order(
        trip_id=trip.id,
        amount=payable,
        currency="INR"
    )

    payment = db.query(Payment).filter(Payment.trip_id == trip.id).first()
    if not payment:
        payment = Payment(
            trip_id=trip.id,
            razorpay_order_id=order_info["order_id"],
            status="PENDING",
            total_amount=payable,
            currency="INR",
            non_refundable_acknowledged=bool(req.non_refundable_acknowledged),
            acknowledged_at=acknowledged_at,
        )
        db.add(payment)
        db.flush()
    else:
        payment.razorpay_order_id = order_info["order_id"]
        payment.total_amount = payable
        payment.status = "PENDING"
        payment.non_refundable_acknowledged = bool(req.non_refundable_acknowledged)
        payment.acknowledged_at = acknowledged_at

    # Persist the authoritative fee SNAPSHOT at order time (not only after
    # success) so the transaction record always carries the exact
    # travel-spend + guide/platform split that Razorpay was asked to collect.
    split = db.query(PaymentSplit).filter(PaymentSplit.payment_id == payment.id).first()
    if not split:
        split = PaymentSplit(payment_id=payment.id, settlement_status="PENDING")
        db.add(split)
    split.transport_cost = round(float(pricing["transport_cost"]), 0)
    split.stay_cost = round(float(pricing["stay_cost"]), 0)
    split.food_cost = round(float(pricing["food_cost"]), 0)
    split.activity_cost = round(float(pricing["activity_cost"]), 0)
    split.guide_fee = round(float(pricing["guide_fee"]), 0)
    split.platform_fee = round(float(pricing["platform_fee"]), 0)
    split.safety_reserve = round(float(pricing.get("safety_reserve", 0) or 0), 0)
    split.insurance_fee = round(float(pricing.get("insurance_fee", 0) or 0), 0)

    db.commit()

    display_breakdown = dict(pricing["breakdown"])
    display_breakdown["payable"] = payable
    display_breakdown["travel_spend"] = pricing["travel_spend"]
    display_breakdown["guide_required"] = _guide_required(trip)
    display_breakdown["guide_assigned"] = _guide_assigned(trip)
    display_breakdown["safety_reserve"] = float(pricing.get("safety_reserve", 0) or 0)
    display_breakdown["insurance_fee"] = float(pricing.get("insurance_fee", 0) or 0)
    display_breakdown["final_planned_amount"] = float(pricing.get("final_planned_amount", payable) or payable)

    return CheckoutResponse(
        order_id=order_info["order_id"],
        amount=payable,
        currency=order_info["currency"],
        key_id=order_info["key_id"],
        breakdown=display_breakdown,
        live_checkout=bool(order_info.get("live")),
        simulated_signature=order_info.get("simulated_signature"),
    )


@router.get("/trips/{trip_id}/pricing", response_model=TripPricingResponse)
def get_trip_pricing(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    """THE authoritative pricing endpoint. Everyone (checkout UI, manager,
    guide, admin, repricing) reads these same numbers — never independently
    recalculated amounts."""
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    itinerary = db.query(Itinerary).filter(
        Itinerary.trip_id == trip.id,
        Itinerary.is_active == True
    ).first()
    if not itinerary:
        raise HTTPException(status_code=404, detail="No active itinerary yet")
    pricing = calculate_trip_pricing(**_pricing_context(trip, itinerary, db))
    return TripPricingResponse(
        **pricing,
        guide_assigned=_guide_assigned(trip),
        guide_required=_guide_required(trip),
    )


@router.post("/payments/webhook")
def process_payment_webhook(
    req: PaymentWebhookRequest,
    db: Session = Depends(get_db)
):
    payment = db.query(Payment).filter(Payment.razorpay_order_id == req.razorpay_order_id).first()
    if not payment:
        logger.warning("Payment webhook for unknown order %s", req.razorpay_order_id[:24])
        raise HTTPException(status_code=404, detail="Order reference not found")

    # Idempotency: repeated callbacks for an already-successful payment must
    # NEVER re-activate the trip, duplicate charges or duplicate offline
    # packages — return the settled state instead.
    if payment.status == "SUCCESS":
        logger.info("Duplicate webhook for settled order %s — returning settled state", req.razorpay_order_id[:24])
        split = db.query(PaymentSplit).filter(PaymentSplit.payment_id == payment.id).first()
        return {
            "status": "success",
            "trip_id": payment.trip_id,
            "payment_status": "SUCCESS",
            "trip_status": payment.trip.status if payment.trip else None,
            "amount_collected": payment.total_amount,
            "guide_fee": round(float(split.guide_fee or 0), 0) if split else 0.0,
            "platform_fee": round(float(split.platform_fee or 0), 0) if split else 0.0,
            "amount_delta_vs_authoritative": 0.0,
            "offline_package_ready": True,
            "duplicate_callback": True,
        }

    # §53: a fabricated payment id must never activate a REAL Razorpay order.
    # Simulated payment ids are only meaningful for simulated orders.
    is_simulated_order = req.razorpay_order_id.startswith("order_sim_")
    if not is_simulated_order and req.razorpay_payment_id.startswith("pay_sim_"):
        logger.warning("Rejected simulated payment id on live order %s", req.razorpay_order_id[:24])
        raise HTTPException(status_code=400, detail="Invalid payment reference for this order")

    is_valid = PaymentService.verify_payment_signature(
        order_id=req.razorpay_order_id,
        payment_id=req.razorpay_payment_id,
        signature=req.razorpay_signature
    )
    if not is_valid:
        payment.status = "FAILED"
        db.commit()
        logger.warning("Payment signature verification FAILED for order %s", req.razorpay_order_id[:24])
        raise HTTPException(status_code=400, detail="Invalid payment signature")
    logger.info("Payment verified for order %s (trip %s)", req.razorpay_order_id[:24], payment.trip_id)

    payment.razorpay_payment_id = req.razorpay_payment_id
    payment.razorpay_signature = req.razorpay_signature
    payment.status = "SUCCESS"

    trip = payment.trip
    trip.status = "ACTIVE"

    # Verify from authoritative data (never trust the frontend): the collected
    # order amount must equal the backend's current guide_fee + platform_fee.
    itinerary = db.query(Itinerary).filter(Itinerary.trip_id == trip.id, Itinerary.is_active == True).first()
    pricing = calculate_trip_pricing(**_pricing_context(trip, itinerary, db)) if itinerary else None
    if pricing is not None and abs(
        float(payment.total_amount or 0) - float(pricing["amount_payable"])
    ) > 0.01:
        # The planner/pricing changed between order creation and settlement.
        # The binding charge is the razorpay order amount; record the CURRENT
        # authoritative split plus an explicit note so revenue never drifts.
        amount_note = round(float(payment.total_amount or 0) - float(pricing["amount_payable"]), 0)
    else:
        amount_note = 0.0

    # Record the settlement split from server-side truth (guide fee vs platform fee).
    split = db.query(PaymentSplit).filter(PaymentSplit.payment_id == payment.id).first()
    if not split:
        split = PaymentSplit(payment_id=payment.id, settlement_status="PENDING")
        db.add(split)
    if pricing is not None:
        split.transport_cost = round(float(pricing["transport_cost"]), 0)
        split.stay_cost = round(float(pricing["stay_cost"]), 0)
        split.food_cost = round(float(pricing["food_cost"]), 0)
        split.activity_cost = round(float(pricing["activity_cost"]), 0)
        split.guide_fee = round(float(pricing["guide_fee"]), 0)
        split.platform_fee = round(float(pricing["platform_fee"]), 0)
        split.safety_reserve = round(float(pricing.get("safety_reserve", 0) or 0), 0)
        split.insurance_fee = round(float(pricing.get("insurance_fee", 0) or 0), 0)

    # Assemble offline package for the traveller.
    guide_info = None
    if trip.guide_assignment and trip.guide_assignment.guide:
        g = trip.guide_assignment.guide
        guide_info = {
            "name": f"{g.first_name} {g.last_name}",
            "phone": g.phone,
            "rating": g.rating
        }

    pkg_bundle = OfflinePackageService.assemble_package(
        trip_data={"id": trip.id, "source_name": trip.source_name, "destination_name": trip.destination_name, "start_datetime": trip.start_datetime, "end_datetime": trip.end_datetime, "mode": trip.mode},
        itinerary_data=itinerary.days_data if itinerary else [],
        profile_data=trip.profile.questions_answers if trip.profile else {},
        guide_data=guide_info
    )
    offline_pkg = db.query(OfflinePackage).filter(OfflinePackage.trip_id == trip.id).first()
    if not offline_pkg:
        offline_pkg = OfflinePackage(trip_id=trip.id, package_data=pkg_bundle)
        db.add(offline_pkg)
    else:
        offline_pkg.package_data = pkg_bundle

    db.commit()

    return {
        "status": "success",
        "trip_id": trip.id,
        "payment_status": "SUCCESS",
        "trip_status": trip.status,
        "amount_collected": payment.total_amount,
        "guide_fee": round(float(split.guide_fee or 0), 0),
        "platform_fee": round(float(split.platform_fee or 0), 0),
        "amount_delta_vs_authoritative": float(amount_note),
        "offline_package_ready": True
    }


# ── Trip Cancellation & 8-Hour Refund Policy ─────────────────────────────────

def _compute_cancellation_math(trip: Trip, payment: Optional[Payment]) -> dict:
    """Evaluates the strict 8-hour cancellation/refund rule."""
    now = datetime.now(timezone.utc)
    trip_start = trip.start_datetime
    if trip_start.tzinfo is not None:
        trip_start_utc = trip_start.astimezone(timezone.utc)
    else:
        trip_start_utc = trip_start.replace(tzinfo=timezone.utc)

    hours_remaining = (trip_start_utc - now).total_seconds() / 3600.0
    is_eligible = hours_remaining >= 8.0
    paid_amount = float(payment.total_amount or 0.0) if payment and payment.status == "SUCCESS" else 0.0
    refund_amount = paid_amount if is_eligible else 0.0

    if is_eligible:
        policy_applied = (
            f"Eligible for 100% refund — cancelled {hours_remaining:.1f} hrs before departure "
            "(meets the >= 8 hours requirement)."
        )
    else:
        policy_applied = (
            f"Non-refundable under policy — cancelled {max(0.0, hours_remaining):.1f} hrs before departure "
            "(less than the required 8 hours)."
        )

    return {
        "trip_id": trip.id,
        "trip_start_datetime": trip.start_datetime.isoformat() if trip.start_datetime else None,
        "hours_before_departure": round(hours_remaining, 2),
        "hours_remaining": round(hours_remaining, 2),
        "cutoff_hours": 8.0,
        "policy_threshold_hours": 8.0,
        "is_eligible": is_eligible,
        "eligible": is_eligible,
        "paid_amount": paid_amount,
        "refund_amount": refund_amount,
        "refund_percentage": 100 if is_eligible else 0,
        "policy_applied": policy_applied,
        "message": policy_applied,
    }


@router.get("/trips/{trip_id}/cancellation-check")
def check_cancellation_eligibility(
    trip_id: str,
    current: dict = Depends(require_role("USER", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    """Inspect cancellation and refund eligibility before confirming cancellation."""
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    payment = db.query(Payment).filter(Payment.trip_id == trip.id).first()
    existing_cancel = db.query(Cancellation).filter(Cancellation.trip_id == trip.id).first()

    math_result = _compute_cancellation_math(trip, payment)
    math_result["is_already_cancelled"] = trip.status == "CANCELLED" or existing_cancel is not None
    if existing_cancel:
        math_result["existing_cancellation"] = {
            "id": existing_cancel.id,
            "cancelled_at": existing_cancel.cancelled_at.isoformat() if existing_cancel.cancelled_at else None,
            "refund_status": existing_cancel.refund_status,
            "refund_amount": float(existing_cancel.refund_amount or 0.0),
            "razorpay_refund_id": existing_cancel.razorpay_refund_id,
            "policy_applied": existing_cancel.policy_applied,
        }
    return math_result


@router.post("/trips/{trip_id}/cancel")
def cancel_trip(
    trip_id: str,
    req: TripCancelRequest,
    current: dict = Depends(require_role("USER", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    """
    Cancels a trip, records the 8-hour policy decision, and triggers a Razorpay refund
    if the cancellation occurs at least 8 hours before the scheduled trip start time.
    """
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    if trip.status == "CANCELLED":
        raise HTTPException(status_code=409, detail="This trip has already been cancelled.")

    payment = db.query(Payment).filter(Payment.trip_id == trip.id).first()
    math_result = _compute_cancellation_math(trip, payment)

    razorpay_refund_id = None
    refund_status = "NOT_APPLICABLE"

    if payment and payment.status == "SUCCESS":
        if math_result["is_eligible"]:
            # Process refund via Razorpay API
            refund_res = PaymentService.create_refund(
                payment_id=payment.razorpay_payment_id or payment.razorpay_order_id,
                amount=math_result["refund_amount"],
                reason=req.reason or "Customer Cancellation under 8h policy",
            )
            if refund_res["status"] == "SUCCESS":
                refund_status = "PROCESSED"
                razorpay_refund_id = refund_res.get("refund_id")
                payment.status = "REFUNDED"
            else:
                refund_status = "FAILED"
                logger.error("Razorpay refund execution failed: %s", refund_res.get("error"))
        else:
            refund_status = "INELIGIBLE_UNDER_POLICY"
            payment.status = "CANCELLED_NO_REFUND"

    # Mark trip as CANCELLED
    trip.status = "CANCELLED"
    trip.updated_at = get_utc_now()

    # Free assigned guide if any
    if trip.guide_assignment:
        trip.guide_assignment.status = "CANCELLED"
        if trip.guide_assignment.guide:
            g = trip.guide_assignment.guide
            if g.current_trip_id == trip.id:
                g.status = "ACTIVE"
                g.current_trip_id = None

    # Create persistent cancellation record in MySQL
    cancellation = Cancellation(
        trip_id=trip.id,
        user_id=trip.user_id,
        payment_id=payment.id if payment else None,
        trip_start_datetime=trip.start_datetime,
        cancelled_at=get_utc_now(),
        hours_before_departure=math_result["hours_before_departure"],
        eligible_for_refund=math_result["is_eligible"],
        refund_amount=math_result["refund_amount"],
        razorpay_payment_id=payment.razorpay_payment_id if payment else None,
        razorpay_refund_id=razorpay_refund_id,
        refund_status=refund_status,
        policy_applied=math_result["policy_applied"],
        reason=req.reason,
    )
    db.add(cancellation)

    # Add audit log for MySQL Workbench & audit trail
    audit = AuditLog(
        action="TRIP_CANCELLED",
        actor_email=current.get("email") or "unknown",
        actor_role=current.get("role") or "USER",
        target_id=trip.id,
        details={
            "hours_before_departure": math_result["hours_before_departure"],
            "eligible": math_result["is_eligible"],
            "refund_amount": math_result["refund_amount"],
            "refund_status": refund_status,
            "razorpay_refund_id": razorpay_refund_id,
            "reason": req.reason,
        },
    )
    db.add(audit)
    db.commit()
    db.refresh(cancellation)

    return {
        "status": "success",
        "trip_id": trip.id,
        "trip_status": "CANCELLED",
        "cancellation_id": cancellation.id,
        "hours_before_departure": cancellation.hours_before_departure,
        "eligible_for_refund": cancellation.eligible_for_refund,
        "refund_amount": float(cancellation.refund_amount or 0.0),
        "refund_status": cancellation.refund_status,
        "razorpay_refund_id": cancellation.razorpay_refund_id,
        "policy_applied": cancellation.policy_applied,
        "reason": cancellation.reason,
        "cancelled_at": cancellation.cancelled_at.isoformat() if cancellation.cancelled_at else None,
    }


@router.get("/admin/cancellations")
def get_admin_cancellations(
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    """Admin inspection of all trip cancellations, refund eligibility decisions, and gateway statuses."""
    cancels = db.query(Cancellation).order_by(Cancellation.cancelled_at.desc()).all()
    results = []
    for c in cancels:
        trip = c.trip
        user = c.user
        results.append({
            "id": c.id,
            "trip_id": c.trip_id,
            "source_name": trip.source_name if trip else "—",
            "destination_name": trip.destination_name if trip else "—",
            "user_email": user.identity.email if user and user.identity else "—",
            "user_name": f"{user.first_name or ''} {user.last_name or ''}".strip() if user else "—",
            "trip_start_datetime": c.trip_start_datetime.isoformat() if c.trip_start_datetime else None,
            "cancelled_at": c.cancelled_at.isoformat() if c.cancelled_at else None,
            "hours_before_departure": c.hours_before_departure,
            "eligible_for_refund": c.eligible_for_refund,
            "refund_amount": float(c.refund_amount or 0.0),
            "razorpay_payment_id": c.razorpay_payment_id,
            "razorpay_refund_id": c.razorpay_refund_id,
            "refund_status": c.refund_status,
            "policy_applied": c.policy_applied,
            "reason": c.reason,
        })
    return results


@router.get("/managers/cancellations")
def get_manager_cancellations(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    """Operations Manager cancellation overview."""
    cancels = db.query(Cancellation).order_by(Cancellation.cancelled_at.desc()).all()
    results = []
    for c in cancels:
        trip = c.trip
        user = c.user
        results.append({
            "id": c.id,
            "trip_id": c.trip_id,
            "source_name": trip.source_name if trip else "—",
            "destination_name": trip.destination_name if trip else "—",
            "user_email": user.identity.email if user and user.identity else "—",
            "cancelled_at": c.cancelled_at.isoformat() if c.cancelled_at else None,
            "hours_before_departure": c.hours_before_departure,
            "eligible_for_refund": c.eligible_for_refund,
            "refund_amount": float(c.refund_amount or 0.0),
            "refund_status": c.refund_status,
            "policy_applied": c.policy_applied,
            "reason": c.reason,
        })
    return results


@router.post("/admin/cancellations/{cancellation_id}/retry-refund")
def retry_cancellation_refund(
    cancellation_id: str,
    current: dict = Depends(require_role("ADMIN")),
    db: Session = Depends(get_db)
):
    """Admin action to retry a failed gateway refund."""
    cancel = db.query(Cancellation).filter(Cancellation.id == cancellation_id).first()
    if not cancel:
        raise HTTPException(status_code=404, detail="Cancellation record not found")

    if not cancel.eligible_for_refund:
        raise HTTPException(status_code=400, detail="This cancellation is not eligible for refund under policy.")

    if cancel.refund_status == "PROCESSED":
        raise HTTPException(status_code=409, detail="Refund is already processed.")

    payment = cancel.payment or (db.query(Payment).filter(Payment.trip_id == cancel.trip_id).first())
    if not payment:
        raise HTTPException(status_code=400, detail="No payment record found for this cancellation.")

    refund_res = PaymentService.create_refund(
        payment_id=payment.razorpay_payment_id or payment.razorpay_order_id,
        amount=float(cancel.refund_amount or payment.total_amount or 0.0),
        reason=f"Admin retry: {cancel.reason or 'Customer Cancellation'}",
    )
    if refund_res["status"] == "SUCCESS":
        cancel.refund_status = "PROCESSED"
        cancel.razorpay_refund_id = refund_res.get("refund_id")
        payment.status = "REFUNDED"
        db.commit()
        return {"status": "SUCCESS", "refund_id": cancel.razorpay_refund_id}
    else:
        cancel.refund_status = "FAILED"
        db.commit()
        raise HTTPException(status_code=502, detail=f"Gateway refund retry failed: {refund_res.get('error')}")
