import pytest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from app.main import app
from app.core.db import Base, engine, SessionLocal
from app.models.entities import Identity, User, Guide, Trip, Location

client = TestClient(app)

@pytest.fixture(scope="session", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield

def test_health_check():
    res = client.get("/")
    assert res.status_code == 200
    assert res.json()["status"] == "operational"

def test_signup_and_email_uniqueness():
    email = f"traveller_{datetime.now().timestamp()}@test.com"
    # 1. Successful User Signup
    res = client.post("/api/v1/auth/signup", json={
        "email": email,
        "password": "Password123!",
        "role": "USER",
        "first_name": "Kavya",
        "last_name": "Rao",
        "phone": "+919876543210"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["role"] == "USER"
    assert "access_token" in data

    # 2. Duplicate registration attempt as GUIDE must be rejected (One identity = one email)
    res_dup = client.post("/api/v1/auth/signup", json={
        "email": email,
        "password": "Password123!",
        "role": "GUIDE",
        "first_name": "Kavya",
        "last_name": "Rao",
        "phone": "+919876543210"
    })
    assert res_dup.status_code == 400
    assert "already registered" in res_dup.json()["detail"].lower()

def test_manager_elevation_flow():
    mgr_email = f"manager_{datetime.now().timestamp()}@travion.in"
    # Invalid access code fails
    res_fail = client.post("/api/v1/auth/elevate", json={
        "email": mgr_email,
        "password": "managersecret",
        "access_code": "WRONG-CODE"
    })
    assert res_fail.status_code == 403

    # Valid SIH-MANAGER code succeeds
    res_success = client.post("/api/v1/auth/elevate", json={
        "email": mgr_email,
        "password": "managersecret",
        "access_code": "SIH-MANAGER"
    })
    assert res_success.status_code == 200
    assert res_success.json()["role"] == "MANAGER"

def test_trip_search_validation_rules():
    # Login as user (account creation requires a valid Indian phone)
    email = f"val_user_{datetime.now().timestamp()}@test.com"
    client.post("/api/v1/auth/signup", json={
        "email": email,
        "password": "Password123!",
        "role": "USER",
        "first_name": "Rohan",
        "last_name": "Verma",
        "phone": "+919876543210"
    })
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    locs = client.get("/api/v1/locations/all").json()
    ooty = next(l for l in locs if l["name"] == "Ooty")
    bangalore = next(l for l in locs if l["name"] == "Bangalore")

    now = datetime.now(timezone.utc)

    # 1. Same source and destination rejected
    res_same = client.post("/api/v1/trips/search", headers=headers, json={
        "source_location_id": ooty["id"],
        "destination_location_id": ooty["id"],
        "start_datetime": (now + timedelta(days=5)).isoformat(),
        "end_datetime": (now + timedelta(days=8)).isoformat()
    })
    assert res_same.status_code == 400
    assert "same as your source" in res_same.json()["detail"]["message"].lower()

    # 2. Past date rejected
    res_past = client.post("/api/v1/trips/search", headers=headers, json={
        "source_location_id": bangalore["id"],
        "destination_location_id": ooty["id"],
        "start_datetime": (now - timedelta(days=2)).isoformat(),
        "end_datetime": (now + timedelta(days=2)).isoformat()
    })
    assert res_past.status_code == 400
    assert "future travel date" in res_past.json()["detail"]["message"].lower()

    # 3. End date before start date rejected
    res_end = client.post("/api/v1/trips/search", headers=headers, json={
        "source_location_id": bangalore["id"],
        "destination_location_id": ooty["id"],
        "start_datetime": (now + timedelta(days=5)).isoformat(),
        "end_datetime": (now + timedelta(days=4)).isoformat()
    })
    assert res_end.status_code == 400
    assert "after your departure date" in res_end.json()["detail"]["message"].lower()

    # 4. Valid search creates Draft trip
    res_valid = client.post("/api/v1/trips/search", headers=headers, json={
        "source_location_id": bangalore["id"],
        "destination_location_id": ooty["id"],
        "start_datetime": (now + timedelta(days=5)).isoformat(),
        "end_datetime": (now + timedelta(days=8)).isoformat()
    })
    assert res_valid.status_code == 200
    trip_data = res_valid.json()
    assert trip_data["status"] == "DRAFT"
    assert trip_data["source_name"] == "Bangalore"
    assert trip_data["destination_name"] == "Ooty"

def test_full_user_trip_flow():
    # User signup (phone is mandatory, validated server-side)
    user_email = f"flow_user_{datetime.now().timestamp()}@test.com"
    signup_res = client.post("/api/v1/auth/signup", json={
        "email": user_email,
        "password": "Password123!",
        "role": "USER",
        "first_name": "Ananya",
        "last_name": "Sharma",
        "phone": "+919876543210"
    })
    token = signup_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Update Basic Profile
    prof_res = client.put("/api/v1/trips/profile/basic", headers=headers, json={
        "first_name": "Ananya",
        "last_name": "Sharma",
        "preferred_language": "English",
        "preferred_communication": "Voice",
        "phone": "+91 98765 43210",
        "emergency_contact_name": "Sunil Sharma",
        "emergency_contact_phone": "+91 98765 43210"
    })
    assert prof_res.status_code == 200

    # Phone is mandatory: profile without it is rejected
    no_phone = client.put("/api/v1/trips/profile/basic", headers=headers, json={
        "first_name": "Ananya",
        "last_name": "Sharma",
        "preferred_language": "English"
    })
    assert no_phone.status_code == 400

    # Search Trip
    locs = client.get("/api/v1/locations/all").json()
    ooty = next(l for l in locs if l["name"] == "Ooty")
    bangalore = next(l for l in locs if l["name"] == "Bangalore")
    now = datetime.now(timezone.utc)

    trip_res = client.post("/api/v1/trips/search", headers=headers, json={
        "source_location_id": bangalore["id"],
        "destination_location_id": ooty["id"],
        "start_datetime": (now + timedelta(days=3)).isoformat(),
        "end_datetime": (now + timedelta(days=6)).isoformat()
    })
    trip_id = trip_res.json()["id"]

    # Discovery questions
    q1 = client.post(f"/api/v1/trips/{trip_id}/discovery/next", headers=headers, json={
        "answers_so_far": {}
    }).json()
    assert not q1["is_complete"]

    q_done = client.post(f"/api/v1/trips/{trip_id}/discovery/next", headers=headers, json={
        "answers_so_far": {
            "budget": "₹15,000 - ₹25,000",
            "party": "Solo",
            "experience": ["Nature & Wildlife", "Adventure & Treks"],
            "food_pref": ["Pure Veg", "Local Traditional Only"],
            "stay_pref": "3 Star Cozy Boutique",
            "transport_pref": "Scenic Train / Toy Train",
            "activities": ["Hiking & Treks", "Wildlife & Safaris"],
            "pace": "Balanced",
            "walking_tolerance": "Moderate",
            "priority": ["Balanced Value", "Safety & Verified Support"]
        }
    }).json()
    assert q_done["is_complete"]

    # Plan Trip with Guide Mode
    plan_res = client.post(f"/api/v1/trips/{trip_id}/plan", headers=headers, json={
        "mode": "GUIDE_MODE",
        "consent_acknowledged": True
    })
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["total_cost"] > 0
    assert len(plan["days"]) >= 2

    # Checkout & Razorpay split
    checkout_res = client.post(f"/api/v1/trips/{trip_id}/checkout", headers=headers, json={
        "payment_method": "razorpay"
    })
    assert checkout_res.status_code == 200
    order_data = checkout_res.json()
    assert "order_" in order_data["order_id"]
    # Travion collects ONLY guide fee + platform fee (dynamic), never the trip budget.
    bd = order_data["breakdown"]
    assert bd["guide_fee"] > 0
    assert bd["platform_fee"] > 0
    assert order_data["amount"] == bd["guide_fee"] + bd["platform_fee"]
    assert order_data["amount"] < bd.get("total", 10**12)
    assert bd["travel_spend"] > 0

    # Payment Webhook simulation
    webhook_res = client.post("/api/v1/payments/webhook", json={
        "razorpay_order_id": order_data["order_id"],
        "razorpay_payment_id": "pay_test_sim_12345",
        "razorpay_signature": "sim_sig_verified_123"
    })
    assert webhook_res.status_code == 200
    assert webhook_res.json()["payment_status"] == "SUCCESS"

    # Dynamic Replanning Trigger
    replan_res = client.post(f"/api/v1/trips/{trip_id}/replan", headers=headers, json={
        "trigger_type": "WEATHER",
        "reason": "Dense fog and rain reported on high elevation ridge"
    })
    assert replan_res.status_code == 200
    replan_data = replan_res.json()
    assert replan_data["new_version"] == 2
    assert len(replan_data["explanation"]) > 20

    # Offline package check
    offline_res = client.get(f"/api/v1/trips/{trip_id}/offline-package", headers=headers)
    assert offline_res.status_code == 200
    pkg = offline_res.json()
    assert pkg["trip_id"] == trip_id
    assert "Offline mode verified" in pkg["offline_notice"]

def test_planned_trip_first_step_is_departure_from_source():
    """
    The first step of any planned trip must be the departure from the source.

    Regression: day stops were sorted lexicographically on the 12-hour label
    ("02:00 PM" < "08:00 AM", "06:00 PM" < "06:30 AM"), which scrambled the
    itinerary so a destination check-in / briefing appeared as Step 1 instead of
    the outbound departure. Overnight legs (evening departure, next-day arrival)
    must keep Day 1 as the journey day and start destination content on Day 2.
    """
    from app.services.ai_orchestrator import AIOrchestrator
    from app.services.india_planner import build_estimate_plan

    # Verified overnight route (Delhi -> Manali 7:30 PM Volvo) and same-day
    # morning route (Mumbai -> Goa 05:50 AM Tejas) both start with departure.
    for src, dst in (("Delhi", "Manali"), ("Mumbai", "Goa"), ("Bangalore", "Ooty")):
        plan = AIOrchestrator.generate_itinerary(
            src, dst, "2026-09-10T06:00:00+05:30", "2026-09-13T06:00:00+05:30",
            "ADVENTUROUS_MODE", {"budget": 18000, "party": "Solo"},
        )
        first = plan["days"][0]["stops"][0]
        assert first["category"] == "transport", f"{src}->{dst} first step: {first['title']}"
        assert first["title"].lower().startswith("depart"), f"{src}->{dst} first step: {first['title']}"

    # India-wide estimate engine for any pair (no verified package needed).
    est = build_estimate_plan(
        "Hyderabad", "Munnar", "Telangana", "Kerala",
        "2026-09-10T06:00:00+05:30", "2026-09-12T06:00:00+05:30",
        "ADVENTUROUS_MODE", {"budget": 18000, "party": "Solo"},
        {"lat": 17.38, "lng": 78.48}, {"lat": 10.09, "lng": 77.06},
    )
    first = est["days"][0]["stops"][0]
    assert first["category"] == "transport"
    assert "departure from hyderabad" in first["title"].lower()

def test_admin_dual_revenue():
    # Elevate to Admin
    adm_email = f"admin_{datetime.now().timestamp()}@travion.in"
    res = client.post("/api/v1/auth/elevate", json={
        "email": adm_email,
        "password": "adminpassword",
        "access_code": "SIH-ADMIN"
    })
    token = res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Seed a paid trip + payment + split so the admin revenue numbers diverge.
    user_email = f"revseed_{datetime.now().timestamp()}@test.com"
    s = client.post("/api/v1/auth/signup", json={
        "email": user_email,
        "password": "Password123!",
        "role": "USER",
        "first_name": "Rev",
        "last_name": "Seed",
        "phone": "+919876543210"
    })
    user_tok = s.json()["access_token"]
    uheaders = {"Authorization": f"Bearer {user_tok}"}

    locs = client.get("/api/v1/locations/all", headers=uheaders).json()
    src = next(l for l in locs if l["name"] == "Bangalore")
    dst = next(l for l in locs if l["name"] == "Ooty")
    now = datetime.now(timezone.utc)
    trip = client.post("/api/v1/trips/search", headers=uheaders, json={
        "source_location_id": src["id"],
        "destination_location_id": dst["id"],
        "start_datetime": (now + timedelta(days=10)).isoformat(),
        "end_datetime": (now + timedelta(days=13)).isoformat(),
    }).json()
    client.post(f"/api/v1/trips/{trip['id']}/discovery/next", headers=uheaders, json={
        "answers_so_far": {
            "budget": "₹15,000 - ₹25,000",
            "party": "Solo",
            "experience": ["Nature"],
            "restrictions": ["Vegetarian"],
        }
    })
    plan = client.post(f"/api/v1/trips/{trip['id']}/plan", headers=uheaders, json={
        "mode": "ADVENTUROUS_MODE",
        "consent_acknowledged": True,
    }).json()
    checkout = client.post(f"/api/v1/trips/{trip['id']}/checkout", headers=uheaders, json={}).json()
    client.post("/api/v1/payments/webhook", json={
        "razorpay_order_id": checkout["order_id"],
        "razorpay_payment_id": "pay_revseed",
        "razorpay_signature": "sim_sig_verified_123",
    })

    rev_res = client.get("/api/v1/admin/revenue", headers=headers)
    assert rev_res.status_code == 200
    data = rev_res.json()
    assert "total_platform_transactions" in data
    assert "actual_platform_revenue" in data
    assert "total_guide_fees_payout" in data
    # Verify strict separation
    assert data["actual_platform_revenue"] != data["total_platform_transactions"]
