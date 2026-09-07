from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import Trip, Itinerary, Payment, PaymentSplit, OfflinePackage, GuideAssignment
from app.schemas.schemas import CheckoutRequest, CheckoutResponse, PaymentWebhookRequest, TripPricingResponse
from app.services.payment_service import PaymentService
from app.services.offline_service import OfflinePackageService
from app.services.pricing_service import calculate_trip_pricing

router = APIRouter(prefix="", tags=["Payments"])


def _pricing_context(trip: Trip, itinerary: Itinerary, db: Session) -> dict:
    """Build the authoritative pricing inputs from ONE place so checkout, the
    pricing endpoint, the webhook and every dashboard show identical numbers."""
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
            currency="INR"
        )
        db.add(payment)
        db.flush()
    else:
        payment.razorpay_order_id = order_info["order_id"]
        payment.total_amount = payable
        payment.status = "PENDING"

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

    db.commit()

    display_breakdown = dict(pricing["breakdown"])
    display_breakdown["payable"] = payable
    display_breakdown["travel_spend"] = pricing["travel_spend"]
    display_breakdown["guide_required"] = _guide_required(trip)
    display_breakdown["guide_assigned"] = _guide_assigned(trip)

    return CheckoutResponse(
        order_id=order_info["order_id"],
        amount=payable,
        currency=order_info["currency"],
        key_id=order_info["key_id"],
        breakdown=display_breakdown,
        live_checkout=bool(order_info.get("live"))
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
        raise HTTPException(status_code=404, detail="Order reference not found")

    is_valid = PaymentService.verify_payment_signature(
        order_id=req.razorpay_order_id,
        payment_id=req.razorpay_payment_id,
        signature=req.razorpay_signature
    )
    if not is_valid:
        payment.status = "FAILED"
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid payment signature")

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
