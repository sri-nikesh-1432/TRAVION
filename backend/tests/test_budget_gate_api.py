"""Budget Feasibility Gate — end-to-end API guarantees.

The product rule: ₹100 / ₹500 / ₹1,000 must NEVER produce a normal itinerary.
This test drives the real API (signup → search → discovery → plan-multi) exactly
like the frontend does and asserts:
  * an impossible budget → HTTP 422 with error_code BUDGET_INSUFFICIENT,
    honest minimum numbers and recovery alternatives (never a plan);
  * a very-low day-trip budget → 3 plans all inside budget, budget_mode on,
    zero stay (no fabricated hotel).
"""
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def _build_trip(budget_answer: str, extra_answers=None):
    key = "".join(ch for ch in budget_answer if ch.isalnum())[-24:]
    email = f"budget_gate_{datetime.now().timestamp()}_{key}@test.com"
    s = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Budget", "last_name": "Gate", "phone": "+919876543210",
    })
    token = s.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    locs = client.get("/api/v1/locations/all", headers=headers).json()
    src = next(l for l in locs if l["name"] == "Bangalore")
    dst = next(l for l in locs if l["name"] == "Ooty")
    now = datetime.now(timezone.utc)
    trip = client.post("/api/v1/trips/search", headers=headers, json={
        "source_location_id": src["id"], "destination_location_id": dst["id"],
        "start_datetime": (now + timedelta(days=3)).isoformat(),
        "end_datetime": (now + timedelta(days=6)).isoformat(),
    }).json()
    answers = {
        "budget": budget_answer,
        "party": "Solo",
        "experience": ["Nature & Wildlife"],
        "restrictions": ["Vegetarian"],
        "food_pref": ["Local Traditional Only"],
        "stay_pref": "Budget Hostel & Guesthouse",
        "transport_pref": "AC Sleeper Bus",
        "pace": "Balanced",
        "walking_tolerance": "Moderate",
        "priority": ["Balanced Value"],
        **(extra_answers or {}),
    }
    q = client.post(f"/api/v1/trips/{trip['id']}/discovery/next", headers=headers, json={
        "answers_so_far": answers,
    })
    assert q.status_code == 200
    return trip["id"], headers


def test_tiny_budget_is_rejected_before_planning():
    trip_id, headers = _build_trip("100")
    res = client.post(f"/api/v1/trips/{trip_id}/plan-multi", headers=headers, json={
        "mode": "ADVENTUROUS_MODE", "consent_acknowledged": True,
    })
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["error_code"] == "BUDGET_INSUFFICIENT"
    assert detail["budget_status"] == "impossible"
    assert detail["minimum_required_budget"] > 100
    assert detail["alternatives"]


def test_five_hundred_budget_never_yields_normal_itinerary():
    trip_id, headers = _build_trip("500")
    res = client.post(f"/api/v1/trips/{trip_id}/plan-multi", headers=headers, json={
        "mode": "ADVENTUROUS_MODE", "consent_acknowledged": True,
    })
    assert res.status_code == 422
    assert res.json()["detail"]["error_code"] == "BUDGET_INSUFFICIENT"


def test_very_low_budget_produces_day_trip_plans_inside_budget():
    # ₹1,500 for a 4-day Bangalore→Ooty trip: realistic only as a no-stay trip.
    trip_id, headers = _build_trip("1500")
    res = client.post(f"/api/v1/trips/{trip_id}/plan-multi", headers=headers, json={
        "mode": "ADVENTUROUS_MODE", "consent_acknowledged": True,
    })
    assert res.status_code == 200, res.text
    plans = res.json()
    assert {p["type"] for p in plans} == {"VALUE", "RECOMMENDED", "PREMIUM"}
    for p in plans:
        assert float(p["final_total"]) <= 1500, p["type"]
        assert p["within_budget"] is True
        assert p["budget_mode"] is True
        bd = p["cost_breakdown"]
        # No stay — a ₹1,500 budget cannot be forced into a hotel.
        assert float(bd.get("stay") or 0) == 0
        stay_stops = [s["category"] for d in p["days"] for s in d.get("stops", []) if s.get("category") == "stay"]
        assert not stay_stops


def test_normal_budget_generates_normal_plans():
    trip_id, headers = _build_trip("₹15,000 - ₹25,000")
    res = client.post(f"/api/v1/trips/{trip_id}/plan-multi", headers=headers, json={
        "mode": "ADVENTUROUS_MODE", "consent_acknowledged": True,
    })
    assert res.status_code == 200, res.text
    plans = res.json()
    assert len(plans) == 3
    for p in plans:
        assert float(p["final_total"]) <= 25000
        assert p["within_budget"] is True
        stay_stops = [s["category"] for d in p["days"] for s in d.get("stops", []) if s.get("category") == "stay"]
        assert stay_stops  # a normal budget includes somewhere to sleep


def test_continue_without_stay_is_respected_end_to_end():
    """'Continue without a stay' (stay_required=False) must be explicit through
    the API: stay cost ₹0 everywhere, no stay stops, selected_stay_id null —
    even though this budget could afford a hotel (never auto-add one)."""
    trip_id, headers = _build_trip("₹15,000 - ₹25,000")
    res = client.post(f"/api/v1/trips/{trip_id}/plan-multi", headers=headers, json={
        "mode": "ADVENTUROUS_MODE", "consent_acknowledged": True,
        "stay_required": False,
    })
    assert res.status_code == 200, res.text
    plans = res.json()
    assert len(plans) == 3
    for p in plans:
        assert p["stay_required"] is False
        assert p["selected_stay_id"] is None
        assert float(p["stay_cost"]) == 0
        assert float(p["cost_breakdown"].get("stay") or 0) == 0
        stay_stops = [s["category"] for d in p["days"] for s in d.get("stops", []) if s.get("category") == "stay"]
        assert not stay_stops
        assert any("continue without a stay" in w.lower() for w in p["warnings"])