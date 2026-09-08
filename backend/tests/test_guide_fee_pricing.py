"""End-to-end tests for the authoritative GUIDE FEE pricing flow.

Covers the user spec that the guide fee is a REAL backend component flowing
through budget -> plan -> checkout -> Razorpay -> verification -> trip record
-> guide/manager/admin -> plan-versioning:

  1. /pricing is the single source of truth and matches checkout exactly.
  2. A fee snapshot (PaymentSplit) is persisted at ORDER time, not only after
     payment success.
  3. An assigned guide's manager-configured rate_per_day drives the fee.
  4. Itinerary edits (add a day) REPRICE the guide fee — never frozen.
  5. The webhook detects amount drift vs authoritative pricing and refreshes
     the split.
  6. Non-Guide mode honestly shows a ₹0 fee instead of faking a guide charge.
"""
import pytest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from app.main import app
from app.core.db import Base, engine, SessionLocal
from app.models.entities import Guide, GuideAssignment, PaymentSplit
from app.services.pricing_service import compute_guide_fee, GUIDE_MIN_FEE, GUIDE_MAX_FEE

client = TestClient(app)

OOTY_BANDS = {
    "budget": "₹15,000 - ₹25,000",
    "party": "Solo",
    "experience": ["Nature & Wildlife", "Adventure & Treks"],
    "food_pref": ["Pure Veg", "Local Traditional Only"],
    "stay_pref": "3 Star Cozy Boutique",
    "transport_pref": "Scenic Train / Toy Train",
    "activities": ["Hiking & Treks", "Wildlife & Safaris"],
    "pace": "Balanced",
    "walking_tolerance": "Moderate",
    "priority": ["Balanced Value", "Safety & Verified Support"],
}


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield


def _new_user(mode: str = "USER"):
    email = f"pricing_{mode.lower()}_{datetime.now().time().microsecond}@{int(datetime.now().timestamp())}.test.com"
    role = mode if mode in ("USER", "GUIDE") else "USER"
    res = client.post("/api/v1/auth/signup", json={
        "email": email,
        "password": "Password123!",
        "role": role,
        "first_name": "Pricing",
        "last_name": "Tester",
        "phone": "+919876543210",
    })
    assert res.status_code == 200, res.text
    data = res.json()
    return email, {"Authorization": f"Bearer {data['access_token']}"}, data


def _build_trip(mode: str = "GUIDE_MODE"):
    """Full traveller setup: signup -> profile -> trip -> discovery -> plan."""
    email, headers, _ = _new_user("USER")
    client.put("/api/v1/trips/profile/basic", headers=headers, json={
        "first_name": "Pricing", "last_name": "Tester", "preferred_language": "English",
        "preferred_communication": "Voice", "phone": "+91 98765 43210",
        "emergency_contact_name": "Pricing Tester", "emergency_contact_phone": "+91 98765 43210",
    })
    locs = client.get("/api/v1/locations/all").json()
    ooty = next(l for l in locs if l["name"] == "Ooty")
    bangalore = next(l for l in locs if l["name"] == "Bangalore")
    now = datetime.now(timezone.utc)
    trip_res = client.post("/api/v1/trips/search", headers=headers, json={
        "source_location_id": bangalore["id"],
        "destination_location_id": ooty["id"],
        "start_datetime": (now + timedelta(days=3)).isoformat(),
        "end_datetime": (now + timedelta(days=6)).isoformat(),
    })
    assert trip_res.status_code == 200, trip_res.text
    trip_id = trip_res.json()["id"]

    q1 = client.post(f"/api/v1/trips/{trip_id}/discovery/next", headers=headers, json={"answers_so_far": {}})
    assert q1.status_code == 200 and not q1.json()["is_complete"]
    qd = client.post(f"/api/v1/trips/{trip_id}/discovery/next", headers=headers, json={"answers_so_far": OOTY_BANDS})
    assert qd.status_code == 200 and qd.json()["is_complete"]

    plan_res = client.post(f"/api/v1/trips/{trip_id}/plan", headers=headers, json={
        "mode": mode, "consent_acknowledged": True,
    })
    assert plan_res.status_code == 200, plan_res.text
    return email, headers, trip_id


def _pricing(trip_id, headers):
    res = client.get(f"/api/v1/trips/{trip_id}/pricing", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def _checkout(trip_id, headers):
    res = client.post(f"/api/v1/trips/{trip_id}/checkout", headers=headers, json={"payment_method": "razorpay"})
    assert res.status_code == 200, res.text
    return res.json()


def _webhook(order_id, pid="pay_test_pricing_001"):
    return client.post("/api/v1/payments/webhook", json={
        "razorpay_order_id": order_id,
        "razorpay_payment_id": pid,
        "razorpay_signature": "sim_sig_verified_123",
    })


def test_pricing_is_single_source_and_split_persisted_at_order_time():
    _, headers, trip_id = _build_trip("GUIDE_MODE")

    pr = _pricing(trip_id, headers)
    assert pr["guide_required"] is True
    assert pr["guide_assigned"] is False
    assert pr["guide_fee"] > 0, "GUIDE_MODE must carry a real guide fee"
    assert pr["platform_fee"] > 0
    assert abs(pr["amount_payable"] - (pr["guide_fee"] + pr["platform_fee"])) < 1
    assert pr["days"] >= 2
    assert pr["travel_spend"] > 0
    # amount_payable is ONLY the fees — never the travel spend
    assert pr["amount_payable"] < pr["total_cost"]

    # Checkout must reuse the SAME authoritative numbers (single source of truth)
    co = _checkout(trip_id, headers)
    assert co["amount"] == pr["amount_payable"]
    bd = co["breakdown"]
    assert bd["guide_fee"] == pr["guide_fee"]
    assert bd["platform_fee"] == pr["platform_fee"]
    assert bd["guide_required"] is True and bd["guide_assigned"] is False

    # Fee snapshot persisted at ORDER time (before the webhook)
    db = SessionLocal()
    try:
        from app.models.entities import Payment
        pay = db.query(Payment).filter(Payment.trip_id == trip_id).first()
        assert pay.status == "PENDING"
        split = db.query(PaymentSplit).filter(PaymentSplit.payment_id == pay.id).first()
        assert split is not None
        assert split.settlement_status == "PENDING"
        assert abs(float(split.guide_fee or 0) - pr["guide_fee"]) < 1
        assert abs(float(split.platform_fee or 0) - pr["platform_fee"]) < 1
    finally:
        db.close()


def test_assigned_guide_rate_per_day_drives_fee():
    _, headers, trip_id = _build_trip("GUIDE_MODE")

    # Manager-configured rate on an ASSIGNED + CONFIRMED guide
    _, gheaders, gdata = _new_user("GUIDE")
    db = SessionLocal()
    try:
        guide = db.query(Guide).filter(Guide.identity_id == gdata["identity_id"]).first()
        assert guide is not None
        guide.rate_per_day = 2000.0
        # A GUIDE_MODE plan may auto-create a pending assignment (UNIQUE per
        # trip). Reuse it rather than inserting a second row.
        assign = db.query(GuideAssignment).filter(GuideAssignment.trip_id == trip_id).first()
        if not assign:
            assign = GuideAssignment(trip_id=trip_id, status="CONFIRMED", match_score=98.0)
            db.add(assign)
        assign.guide_id = guide.id
        assign.status = "CONFIRMED"
        db.commit()
    finally:
        db.close()

    pr = _pricing(trip_id, headers)
    days = pr["days"]
    assert pr["guide_assigned"] is True
    expected = max(GUIDE_MIN_FEE, min(2000.0 * days, GUIDE_MAX_FEE))
    assert pr["guide_fee"] == expected
    # checkout mirrors it
    co = _checkout(trip_id, headers)
    assert co["breakdown"]["guide_fee"] == expected
    assert co["amount"] == co["breakdown"]["guide_fee"] + co["breakdown"]["platform_fee"]

    # The assigned guide sees the SAME authoritative fee on their dashboard
    at = client.get("/api/v1/guides/assigned-trips", headers=gheaders)
    assert at.status_code == 200, at.text
    row = next((a for a in at.json() if a["trip"]["id"] == trip_id), None)
    assert row is not None
    assert row["trip"]["pricing"]["guide_fee"] == expected
    assert row["trip"]["pricing"]["amount_payable"] == expected + row["trip"]["pricing"]["platform_fee"]


def test_add_day_reprices_guide_fee_never_frozen():
    _, headers, trip_id = _build_trip("GUIDE_MODE")
    pr0 = _pricing(trip_id, headers)
    d0 = pr0["days"]

    # Add a brand-new day: recalculate_change appends it, edit_itinerary must
    # reprice the guide fee via pricing_service (single source of truth).
    add_res = client.patch(f"/api/v1/trips/{trip_id}/itinerary", headers=headers, json={
        "kind": "add",
        "stop": {"name": "Pillar Rocks Viewpoint", "category": "attraction",
                 "estimated_cost": 300, "lat": 11.4, "lng": 76.7, "day": d0 + 1},
        "new_day": d0 + 1,
    })
    assert add_res.status_code == 200, add_res.text
    assert add_res.json()["applied"]

    pr1 = _pricing(trip_id, headers)
    assert pr1["days"] == d0 + 1
    expected_fee = compute_guide_fee("GUIDE_MODE", d0 + 1, "Ooty", "Solo")
    assert pr1["guide_fee"] == expected_fee, "guide fee must track the new day count, never stay frozen"
    assert pr1["amount_payable"] == pr1["guide_fee"] + pr1["platform_fee"]

    # The persisted itinerary carries the repriced breakdown (plan versioning)
    db = SessionLocal()
    try:
        from app.models.entities import Itinerary
        itin = db.query(Itinerary).filter(Itinerary.trip_id == trip_id, Itinerary.is_active == True).first()
        assert float((itin.cost_breakdown or {}).get("guide_fee", 0)) == expected_fee
    finally:
        db.close()


def test_webhook_detects_pricing_drift_and_refreshes_split():
    _, headers, trip_id = _build_trip("GUIDE_MODE")
    co = _checkout(trip_id, headers)
    order_amount = co["amount"]

    # Drift: user edits the itinerary (adds a day) AFTER placing the order.
    from app.models.entities import Itinerary
    db = SessionLocal()
    try:
        itin = db.query(Itinerary).filter(Itinerary.trip_id == trip_id, Itinerary.is_active == True).first()
        new_day = len(itin.days_data or []) + 1
    finally:
        db.close()
    r = client.patch(f"/api/v1/trips/{trip_id}/itinerary", headers=headers, json={
        "kind": "add",
        "stop": {"name": "Emerald Lake Viewpoint", "category": "attraction",
                 "estimated_cost": 250, "lat": 11.36, "lng": 76.69, "day": new_day},
        "new_day": new_day,
    })
    assert r.status_code == 200

    wh = _webhook(co["order_id"])
    assert wh.status_code == 200, wh.text
    data = wh.json()
    assert data["status"] == "success"
    assert data["payment_status"] == "SUCCESS"
    # collected amount was the OLD order total -> now differs from authoritative
    assert data["amount_delta_vs_authoritative"] != 0
    assert data["amount_collected"] == order_amount

    # split refreshed to CURRENT authoritative values
    assert data["guide_fee"] > 0
    pr = _pricing(trip_id, headers)
    assert data["guide_fee"] == pr["guide_fee"]


def test_non_guide_mode_honestly_zero_fee():
    _, headers, trip_id = _build_trip("ADVENTUROUS_MODE")
    pr = _pricing(trip_id, headers)
    assert pr["guide_required"] is False
    assert pr["guide_fee"] == 0.0
    assert pr["guide_assigned"] is False
    assert pr["amount_payable"] == pr["platform_fee"]

    co = _checkout(trip_id, headers)
    assert co["breakdown"]["guide_fee"] == 0.0
    assert co["amount"] == co["breakdown"]["platform_fee"]


def test_manager_rate_endpoint_drives_assigned_guide_fee():
    # Manager token (valid access code from the auth flow)
    mgr_email = f"pricing_mgr_{datetime.now().time().microsecond}@travion.in"
    elev = client.post("/api/v1/auth/elevate", json={
        "email": mgr_email, "password": "managersecret", "access_code": "SIH-MANAGER",
    })
    assert elev.status_code == 200, elev.text
    mgr_headers = {"Authorization": f"Bearer {elev.json()['access_token']}"}

    _, headers, trip_id = _build_trip("GUIDE_MODE")
    _, _, gdata = _new_user("GUIDE")
    guide_id = gdata["guide_id"]

    # Manager configures the per-day rate via the dedicated endpoint
    set_res = client.patch(f"/api/v1/manager/guides/{guide_id}/rate", headers=mgr_headers, json={"rate_per_day": 2500})
    assert set_res.status_code == 200, set_res.text
    assert set_res.json()["rate_per_day"] == 2500.0

    # Link the guide as CONFIRMED on the trip (assignment is per-trip UNIQUE)
    db = SessionLocal()
    try:
        assign = db.query(GuideAssignment).filter(GuideAssignment.trip_id == trip_id).first()
        if not assign:
            assign = GuideAssignment(trip_id=trip_id, status="CONFIRMED", match_score=97.0)
            db.add(assign)
        assign.guide_id = guide_id
        assign.status = "CONFIRMED"
        db.commit()
    finally:
        db.close()

    pr = _pricing(trip_id, headers)
    expected = max(GUIDE_MIN_FEE, min(2500.0 * pr["days"], GUIDE_MAX_FEE))
    assert pr["guide_assigned"] is True
    assert pr["guide_fee"] == expected
    assert pr["amount_payable"] == pr["guide_fee"] + pr["platform_fee"]

    # Manager roster exposes the saved rate (real record)
    roster = client.get("/api/v1/manager/guides", headers=mgr_headers)
    assert roster.status_code == 200
    row = next((g for g in roster.json() if g["id"] == guide_id), None)
    assert row is not None and row["rate_per_day"] == 2500.0