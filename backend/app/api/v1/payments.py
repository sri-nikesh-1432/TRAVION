from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import Trip, Itinerary, Payment, PaymentSplit, OfflinePackage
from app.schemas.schemas import CheckoutRequest, CheckoutResponse, PaymentWebhookRequest
from app.services.payment_service import PaymentService
from app.services.offline_service import OfflinePackageService
from app.api.v1.planning import effective_breakdown

router = APIRouter(prefix="", tags=["Payments"])


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

    # Server-side truth: breakdown persisted at planning time.
    breakdown = effective_breakdown(itinerary)
    guide_fee = float(breakdown.get("guide_fee") or 0.0)
    platform_fee = float(breakdown.get("platform_fee") or 0.0)
    payable = round(guide_fee + platform_fee, 0)
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
    else:
        payment.razorpay_order_id = order_info["order_id"]
        payment.total_amount = payable
        payment.status = "PENDING"

    db.commit()

    display_breakdown = dict(breakdown)
    display_breakdown["payable"] = payable
    display_breakdown["travel_spend"] = round(
        float(display_breakdown.get("transport") or 0)
        + float(display_breakdown.get("stay") or 0)
        + float(display_breakdown.get("food") or 0)
        + float(display_breakdown.get("activities") or 0), 0
    )

    return CheckoutResponse(
        order_id=order_info["order_id"],
        amount=payable,
        currency=order_info["currency"],
        key_id=order_info["key_id"],
        breakdown=display_breakdown,
        live_checkout=bool(order_info.get("live"))
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

    # Record the settlement split from server-side truth (guide fee vs platform fee).
    itinerary = db.query(Itinerary).filter(Itinerary.trip_id == trip.id, Itinerary.is_active == True).first()
    breakdown = effective_breakdown(itinerary) if itinerary else {}
    split = db.query(PaymentSplit).filter(PaymentSplit.payment_id == payment.id).first()
    if not split:
        split = PaymentSplit(
            payment_id=payment.id,
            transport_cost=round(float(breakdown.get("transport") or 0), 0),
            stay_cost=round(float(breakdown.get("stay") or 0), 0),
            food_cost=round(float(breakdown.get("food") or 0), 0),
            activity_cost=round(float(breakdown.get("activities") or 0), 0),
            guide_fee=round(float(breakdown.get("guide_fee") or 0), 0),
            platform_fee=round(float(breakdown.get("platform_fee") or 0), 0),
            settlement_status="PENDING"
        )
        db.add(split)

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
        "guide_fee": round(float(breakdown.get("guide_fee") or 0), 0),
        "platform_fee": round(float(breakdown.get("platform_fee") or 0), 0),
        "offline_package_ready": True
    }
