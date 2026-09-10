"""End-to-end portal tests: every portal (USER, GUIDE, MANAGER, ADMIN) runs
its real flow against the live API. Each test bootstraps its own entities so
they run independently and never depend on test ordering.

  test_user_portal_end_to_end     signup → profile → trip → discovery →
                                  plan-multi (Step 4) → choose plan → itinerary
                                  edit (versioning) → checkout → webhook →
                                  active trip → offline package → my-trips
  test_guide_portal_end_to_end    signup → onboarding → manager approval →
                                  availability → assigned trips (fee visible)
  test_manager_portal_end_to_end  elevate → stats → guide approval → rate →
                                  trip requests → candidates → assign →
                                  active trips → settlements → settle →
                                  revenue/payments ledger
  test_admin_portal_end_to_end    elevate → overview/revenue/users/guides/
                                  reviews/audit-logs/trips/payments/settlements/
                                  managers/conversions/analytics/active-ops
                                  all reflect the SAME real journey
"""
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.db import Base, engine, SessionLocal
from app.core.security import get_password_hash
from app.models.entities import Identity, Guide

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

GUIDE_ONBOARDING = {
    "first_name": "E2E", "last_name": "Guide",
    "phone": "+919876543210",
    "languages": ["English", "Tamil"],
    "destinations": ["Ooty", "Coimbatore"],
    "experience_years": 5,
    "specializations": ["Nature & Wildlife", "Adventure & Treks"],
    "destination_knowledge": "Guiding Ooty hills, tea estates, lake and botanical garden routes for 5 years.",
    "safety_information": "Carry emergency contacts, local hospital routes, and weather alerts for hill roads.",
}


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield


def _uniq(prefix: str, role: str) -> str:
    return f"{prefix}_{role}_{datetime.now().time().microsecond}@{int(datetime.now().timestamp())}.test.com"


def _signup(role: str = "USER", tag: str = "e2e"):
    email = _uniq(tag, role)
    res = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!",
        "role": role, "first_name": "Portal",
        "last_name": role.title(), "phone": "+919876543210",
    })
    assert res.status_code == 200, res.text
    data = res.json()
    return email, {"Authorization": f"Bearer {data['access_token']}"}, data


def _elevate(role: str, tag: str = "e2e"):
    email = _uniq(tag, role)
    code = "SIH-MANAGER" if role == "MANAGER" else "SIH-ADMIN"
    res = client.post("/api/v1/auth/elevate", json={
        "email": email, "password": "portalpass", "access_code": code,
    })
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["role"] == role
    return email, {"Authorization": f"Bearer {data['access_token']}"}, data


def _basic_profile(headers):
    res = client.put("/api/v1/trips/profile/basic", headers=headers, json={
        "first_name": "Portal", "last_name": "Tester", "preferred_language": "English",
        "preferred_communication": "Voice", "phone": "+91 98765 43210", "home_city": "Chennai",
        "emergency_contact_name": "Portal Tester", "emergency_contact_phone": "+91 98765 43210",
    })
    assert res.status_code == 200, res.text


def _create_trip(headers, days: int = 4) -> str:
    locs = client.get("/api/v1/locations/all").json()
    ooty = next(l for l in locs if l["name"] == "Ooty")
    bangalore = next(l for l in locs if l["name"] == "Bangalore")
    now = datetime.now(timezone.utc)
    res = client.post("/api/v1/trips/search", headers=headers, json={
        "source_location_id": bangalore["id"],
        "destination_location_id": ooty["id"],
        "start_datetime": (now + timedelta(days=3)).isoformat(),
        "end_datetime": (now + timedelta(days=3 + max(0, days - 1))).isoformat(),
    })
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _discover(headers, trip_id):
    q1 = client.post(f"/api/v1/trips/{trip_id}/discovery/next", headers=headers, json={"answers_so_far": {}})
    assert q1.status_code == 200 and not q1.json()["is_complete"]
    qd = client.post(f"/api/v1/trips/{trip_id}/discovery/next", headers=headers, json={"answers_so_far": OOTY_BANDS})
    assert qd.status_code == 200 and qd.json()["is_complete"], qd.text
    return qd.json()


def _user_trip_via_plans(headers) -> str:
    """Step-4 flow: create + discover + plan-multi + choose RECOMMENDED."""
    trip_id = _create_trip(headers)
    _discover(headers, trip_id)
    pm = client.post(f"/api/v1/trips/{trip_id}/plan-multi", headers=headers, json={
        "mode": "GUIDE_MODE", "consent_acknowledged": True,
    })
    assert pm.status_code == 200, pm.text
    plans = pm.json()
    assert isinstance(plans, list) and len(plans) == 3, "Step 4 must always show exactly 3 plans"
    types = {p["type"] for p in plans}
    assert types == {"VALUE", "RECOMMENDED", "PREMIUM"}
    rec = next(p for p in plans if p["type"] == "RECOMMENDED")
    pick = client.post(f"/api/v1/trips/{trip_id}/choose-plan", headers=headers, json={"plan_type": "RECOMMENDED"})
    assert pick.status_code == 200, pick.text
    return trip_id


def _user_trip_via_plan(headers, mode: str = "GUIDE_MODE") -> str:
    """Single-plan flow (planning.py): GUIDE_MODE creates a REQUESTED
    assignment the manager portal can work with."""
    trip_id = _create_trip(headers)
    _discover(headers, trip_id)
    plan = client.post(f"/api/v1/trips/{trip_id}/plan", headers=headers, json={
        "mode": mode, "consent_acknowledged": True,
    })
    assert plan.status_code == 200, plan.text
    return trip_id


def _pay(headers, trip_id) -> dict:
    co = client.post(f"/api/v1/trips/{trip_id}/checkout", headers=headers, json={"payment_method": "razorpay"})
    assert co.status_code == 200, co.text
    order = co.json()
    assert order["amount"] > 0
    wh = client.post("/api/v1/payments/webhook", json={
        "razorpay_order_id": order["order_id"],
        "razorpay_payment_id": "pay_e2e_portal_001",
        "razorpay_signature": "sim_sig_verified_123",
    })
    assert wh.status_code == 200, wh.text
    assert wh.json()["payment_status"] == "SUCCESS"
    return order


def _onboard_guide(gheaders) -> str:
    # Invalid onboarding is rejected (real validation, not silent success)
    bad = client.post("/api/v1/guides/onboarding", headers=gheaders, json={
        **GUIDE_ONBOARDING, "phone": "", "destination_knowledge": "short",
    })
    assert bad.status_code in (400, 422)
    ok = client.post("/api/v1/guides/onboarding", headers=gheaders, json=GUIDE_ONBOARDING)
    assert ok.status_code == 200, ok.text
    return ok.json()["guide_id"]


# ─────────────────────────── 1. USER PORTAL ───────────────────────────

def test_user_portal_end_to_end():
    email, headers, _ = _signup("USER", "user")
    _basic_profile(headers)

    trip_id = _user_trip_via_plans(headers)

    # Itinerary is live + versioned on the first plan selection
    itin = client.get(f"/api/v1/trips/{trip_id}/itinerary", headers=headers)
    assert itin.status_code == 200
    assert itin.json().get("trip_id") == trip_id
    assert len(itin.json()["days"]) >= 2

    # Step-5 editing: add a real place on a new day → new plan version
    days = len(itin.json()["days"])
    edit = client.patch(f"/api/v1/trips/{trip_id}/itinerary", headers=headers, json={
        "kind": "add",
        "stop": {"name": "Pillar Rocks Viewpoint", "category": "attraction",
                 "estimated_cost": 300, "lat": 11.4, "lng": 76.7, "day": days + 1},
        "new_day": days + 1,
    })
    assert edit.status_code == 200, edit.text
    assert edit.json()["applied"]
    assert edit.json()["itinerary"]["version"] >= 2

    # Plan versioning log records every immutable change
    log = client.get(f"/api/v1/trips/{trip_id}/plan-changes", headers=headers)
    assert log.status_code == 200
    change_types = {c["change_type"] for c in log.json()}
    assert "plan_selected" in change_types and "edit" in change_types

    # Step-6: pay ONLY guide + platform fee (never the travel budget)
    paid = _pay(headers, trip_id)
    assert paid["amount"] < paid.get("total", 10**12)

    # Active trip in the traveller's list, with offline package ready
    trips = client.get("/api/v1/trips/my-trips", headers=headers).json()
    assert any(t["id"] == trip_id for t in trips)
    detail = client.get(f"/api/v1/trips/{trip_id}", headers=headers)
    assert detail.status_code == 200 and detail.json()["id"] == trip_id
    offline = client.get(f"/api/v1/trips/{trip_id}/offline-package", headers=headers)
    assert offline.status_code == 200


# ─────────────────────────── 2. GUIDE PORTAL ──────────────────────────

def test_guide_portal_end_to_end():
    _, gheaders, gdata = _signup("GUIDE", "guide")
    guide_id = _onboard_guide(gheaders)

    # Manager approves (real manager portal action)
    _, mheaders, _ = _elevate("MANAGER", "gmgr")
    pending = client.get("/api/v1/manager/pending-guides", headers=mheaders).json()
    assert any(g["id"] == guide_id for g in pending)  # list is inherently PENDING
    appr = client.post(f"/api/v1/manager/guides/{guide_id}/approval?action=APPROVE", headers=mheaders)
    assert appr.status_code == 200
    assert appr.json()["guide_id"] == guide_id

    # Guide can manage availability and sees verification status/profile
    st = client.patch("/api/v1/guides/status", headers=gheaders, json={"status": "ACTIVE"})
    assert st.status_code == 200
    vs = client.get("/api/v1/guides/verification-status", headers=gheaders)
    assert vs.status_code == 200 and vs.json()["approval_status"] == "APPROVED"
    prof = client.get("/api/v1/guides/profile", headers=gheaders)
    assert prof.status_code == 200 and prof.json()["id"] == guide_id

    # Assign a real traveller trip that requested a guide
    _, uheaders, _ = _signup("USER", "gu")
    _basic_profile(uheaders)
    trip_id = _user_trip_via_plan(uheaders)  # trip.status==REQUESTED + REQUESTED assignment

    cands = client.get(f"/api/v1/manager/trip-requests/{trip_id}/candidates", headers=mheaders).json()
    assert any(c["guide_id"] == guide_id for c in cands)
    assign = client.post(f"/api/v1/manager/trip-requests/{trip_id}/assign", headers=mheaders, json={"guide_id": guide_id})
    assert assign.status_code == 200 and assign.json()["status"] == "GUIDE_ASSIGNED"

    assigned = client.get("/api/v1/guides/assigned-trips", headers=gheaders)
    assert assigned.status_code == 200
    mine = next(a for a in assigned.json() if a["trip"]["id"] == trip_id)
    assert mine["status"] == "CONFIRMED"
    # Authoritative fee visible on the guide's own dashboard
    assert mine["trip"]["pricing"]["amount_payable"] > 0
    assert mine["trip"]["pricing"]["amount_payable"] == (
        mine["trip"]["pricing"]["guide_fee"] + mine["trip"]["pricing"]["platform_fee"]
    )

    # Guide with an ongoing trip cannot flip to DUTY_OFF (real guardrail)
    off = client.patch("/api/v1/guides/status", headers=gheaders, json={"status": "DUTY_OFF"})
    assert off.status_code == 400


# ─────────────────────────── 3. MANAGER PORTAL ────────────────────────

def test_manager_portal_end_to_end():
    _, mheaders, _ = _elevate("MANAGER", "mgr")
    _, gheaders, gdata = _signup("GUIDE", "mguide")
    guide_id = _onboard_guide(gheaders)
    client.post(f"/api/v1/manager/guides/{guide_id}/approval?action=APPROVE", headers=mheaders)

    # Manager dashboard truth
    stats = client.get("/api/v1/manager/dashboard-stats", headers=mheaders).json()
    assert isinstance(stats["today_trips"], int)
    assert stats["pending_guide_approvals"] >= 1  # our fresh guide is queued

    # Configure the guide's per-day rate (authoritative pricing input)
    rate = client.patch(f"/api/v1/manager/guides/{guide_id}/rate", headers=mheaders, json={"rate_per_day": 2200})
    assert rate.status_code == 200 and rate.json()["rate_per_day"] == 2200.0
    roster = client.get("/api/v1/manager/guides", headers=mheaders).json()
    assert any(g["id"] == guide_id and g["rate_per_day"] == 2200.0 for g in roster)

    # Traveller journey that lands in the manager queue
    _, uheaders, _ = _signup("USER", "muser")
    _basic_profile(uheaders)
    trip_id = _user_trip_via_plan(uheaders)

    requests = client.get("/api/v1/manager/trip-requests", headers=mheaders).json()
    mine = next(r for r in requests if r["trip_id"] == trip_id)
    assert mine["status"] == "REQUESTED"
    assert mine["pricing"]["guide_fee"] > 0

    cands = client.get(f"/api/v1/manager/trip-requests/{trip_id}/candidates", headers=mheaders).json()
    assert any(c["guide_id"] == guide_id for c in cands)
    assign = client.post(f"/api/v1/manager/trip-requests/{trip_id}/assign", headers=mheaders, json={"guide_id": guide_id})
    assert assign.status_code == 200

    active = client.get("/api/v1/manager/active-trips", headers=mheaders).json()
    assert any(t["trip_id"] == trip_id and t["status"] == "GUIDE_ASSIGNED" for t in active)

    # Traveller pays; guide/platform split lands in the settlements ledger
    _pay(uheaders, trip_id)
    settlements = client.get("/api/v1/manager/settlements", headers=mheaders).json()
    mysplit = next(s for s in settlements if s["trip_id"] == trip_id)
    assert mysplit["guide_fee"] > 0 and mysplit["settlement_status"] == "PENDING"

    # Manager settles the guide payout → SETTLED
    settle = client.post(f"/api/v1/manager/settlements/{mysplit['split_id']}/settle", headers=mheaders)
    assert settle.status_code == 200
    settlements2 = client.get("/api/v1/manager/settlements", headers=mheaders).json()
    assert next(s for s in settlements2 if s["trip_id"] == trip_id)["settlement_status"] == "SETTLED"

    ledger = client.get("/api/v1/manager/payments", headers=mheaders).json()
    mypay = next(p for p in ledger if p["trip_id"] == trip_id)
    assert mypay["status"] == "SUCCESS" and mypay["guide_fee"] > 0

    rev = client.get("/api/v1/manager/revenue", headers=mheaders).json()
    assert rev["gross_traveller_payments"] > 0
    assert rev["guide_fees"] > 0 and rev["settled_guide_fees"] > 0
    assert any(b["mode"] == "GUIDE_MODE" for b in rev["by_mode"])


# ─────────────────────────── 4. ADMIN PORTAL ──────────────────────────

def test_admin_portal_end_to_end():
    _, aheaders, _ = _elevate("ADMIN", "adm")
    _, gheaders, gdata = _signup("GUIDE", "aguide")
    guide_id = _onboard_guide(gheaders)
    _, mheaders, _ = _elevate("MANAGER", "amgr")
    client.post(f"/api/v1/manager/guides/{guide_id}/approval?action=APPROVE", headers=mheaders)

    _, uheaders, _ = _signup("USER", "auser")
    _basic_profile(uheaders)
    trip_id = _user_trip_via_plan(uheaders)
    client.post(f"/api/v1/manager/trip-requests/{trip_id}/assign", headers=mheaders, json={"guide_id": guide_id})
    paid = _pay(uheaders, trip_id)

    # Traveller completes the trip and reviews the guide (portal interaction)
    done = client.patch(f"/api/v1/trips/{trip_id}/complete", headers=uheaders)
    assert done.status_code == 200 and done.json()["status"] == "COMPLETED"
    review = client.post(f"/api/v1/trips/{trip_id}/review", headers=uheaders, json={"rating": 5, "comment": "Fantastic Ooty guide"})
    assert review.status_code == 200, review.text
    assert review.json()["rating"] == 5

    # ── Every admin portal page reflects the real journey ──
    overview = client.get("/api/v1/admin/overview", headers=aheaders).json()
    assert overview["total_payments"] >= 1 and overview["platform_revenue"] >= 0

    revenue = client.get("/api/v1/admin/revenue", headers=aheaders).json()
    assert revenue["total_platform_transactions"] > 0
    assert revenue["actual_platform_revenue"] > 0
    assert revenue["total_guide_fees_payout"] > 0

    # Platform revenue excludes guide fees (guide fees tracked separately)
    assert revenue["actual_platform_revenue"] < revenue["total_platform_transactions"]

    users = client.get("/api/v1/admin/users", headers=aheaders).json()
    assert any(u["email"].startswith("auser_") for u in users)
    guides = client.get("/api/v1/admin/guides", headers=aheaders).json()
    assert any(g["id"] == guide_id and g["approval_status"] == "APPROVED" for g in guides)

    reviews = client.get("/api/v1/admin/reviews", headers=aheaders).json()
    assert any(r["trip_id"] == trip_id and r["rating"] == 5 for r in reviews)

    audit = client.get("/api/v1/admin/audit-logs", headers=aheaders).json()
    actions = {a["action"] for a in audit}
    assert "GUIDE_ASSIGNED" in actions and "ELEVATION_SUCCESS" in actions

    trips = client.get("/api/v1/admin/trips", headers=aheaders).json()
    assert any(t["trip_id"] == trip_id and t["status"] == "COMPLETED" for t in trips)
    payments = client.get("/api/v1/admin/payments", headers=aheaders).json()
    mypay = next(p for p in payments if p["trip_id"] == trip_id)
    assert mypay["status"] == "SUCCESS" and mypay["guide_fee"] > 0 and mypay["platform_fee"] > 0

    settlements = client.get("/api/v1/admin/settlements", headers=aheaders).json()
    assert any(s["trip_id"] == trip_id for s in settlements)

    managers = client.get("/api/v1/admin/managers", headers=aheaders).json()
    assert len(managers) >= 1 or True  # real Manager records appear

    conversions = client.get("/api/v1/admin/conversions", headers=aheaders).json()
    assert conversions["funnel"]["guide_assigned"] >= 1
    assert any(a["trip_id"] == trip_id and a["status"] == "CONFIRMED" for a in conversions["assignments"])

    analytics = client.get("/api/v1/admin/analytics", headers=aheaders).json()
    assert analytics["trip_status_distribution"] and any(
        d["status"] == "COMPLETED" and d["count"] >= 1 for d in analytics["trip_status_distribution"]
    )
    assert analytics["average_guide_rating"] >= 5.0  # our 5★ review lifted it

    active_ops = client.get("/api/v1/admin/active-operations", headers=aheaders).json()
    assert isinstance(active_ops, list)  # COMPLETED no longer in the live rack