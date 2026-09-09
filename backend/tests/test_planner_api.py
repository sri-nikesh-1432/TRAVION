"""Step 5 Interactive Planner — end-to-end API guarantees.

Drives the REAL API (signup → search → discovery → plan-multi → choose-plan →
edit → optimize-day → confirm) exactly like the frontend planner does and
asserts:
  * choosing a plan moves the trip to PLANNED and records plan_selected;
  * every edit produces a NEW itinerary version + a PlanChangeLog row with a
    human-readable summary (plan versioning / guide-visible change history);
  * /places/search returns only REAL places (nonzero coords) and never a place
    already in the plan;
  * /optimize-day preview vs apply (version bump only when applied);
  * /confirm validates a normal in-budget plan as payment-ready.
"""
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def _build_trip():
    key = "".join(ch for ch in str(datetime.now().timestamp()) if ch.isalnum())[-16:]
    email = f"planner_{key}@test.com"
    s = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Plan", "last_name": "Test", "phone": "+919876543210",
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
        "budget": "₹15,000 - ₹25,000",
        "party": "Solo",
        "experience": ["Nature & Wildlife"],
        "food_pref": ["Local Traditional Only"],
        "stay_pref": "3 Star Cozy Boutique",
        "transport_pref": "AC Sleeper Bus",
        "pace": "Balanced",
        "walking_tolerance": "Moderate",
        "priority": ["Balanced Value"],
    }
    q = client.post(f"/api/v1/trips/{trip['id']}/discovery/next", headers=headers, json={
        "answers_so_far": answers,
    })
    assert q.status_code == 200 and q.json()["is_complete"]
    return trip["id"], headers


def _choose_plan(trip_id, headers):
    res = client.post(f"/api/v1/trips/{trip_id}/plan-multi", headers=headers, json={
        "mode": "ADVENTUROUS_MODE", "consent_acknowledged": True,
    })
    assert res.status_code == 200, res.text
    chosen = client.post(f"/api/v1/trips/{trip_id}/choose-plan", headers=headers, json={
        "plan_type": "VALUE",
    })
    assert chosen.status_code == 200, chosen.text
    return chosen.json()


def test_choose_plan_sets_planned_and_logs_plan_selected():
    trip_id, headers = _build_trip()
    itn = _choose_plan(trip_id, headers)

    trip = client.get(f"/api/v1/trips/{trip_id}", headers=headers).json()
    assert trip["status"] == "PLANNED"

    changes = client.get(f"/api/v1/trips/{trip_id}/plan-changes", headers=headers).json()
    assert changes, "a plan_selected entry must exist"
    assert changes[0]["change_type"] == "plan_selected"
    assert itn["version"] in {c["version"] for c in changes}


def test_every_edit_is_versioned_and_logged():
    trip_id, headers = _build_trip()
    itn = _choose_plan(trip_id, headers)
    first_stop = itn["days"][0]["stops"][0]

    edited = client.patch(f"/api/v1/trips/{trip_id}/itinerary", headers=headers, json={
        "kind": "move_time", "stop_id": first_stop["id"], "new_time": "09:30 AM",
    })
    assert edited.status_code == 200, edited.text
    assert edited.json()["itinerary"]["version"] == itn["version"] + 1

    changes = client.get(f"/api/v1/trips/{trip_id}/plan-changes", headers=headers).json()
    edit_entries = [c for c in changes if c["change_type"] == "edit"]
    assert edit_entries, "the edit must be logged"
    assert len(edit_entries[-1]["summary"]) > 5


def test_places_search_returns_only_real_places_not_in_plan():
    trip_id, headers = _build_trip()
    _choose_plan(trip_id, headers)

    res = client.get(f"/api/v1/trips/{trip_id}/places/search?q=", headers=headers)
    assert res.status_code == 200, res.text
    items = res.json()
    assert items, "the real-verified pool must return places"
    in_plan = client.get(f"/api/v1/trips/{trip_id}/itinerary", headers=headers).json()
    plan_names = {
        str(s.get("title") or s.get("name") or "").lower()
        for d in in_plan["days"] for s in d.get("stops", [])
    }
    for item in items:
        assert item["name"], "real places always carry a name"
        assert float(item["lat"] or 0) or float(item["lng"] or 0), "coords must be real"
        assert str(item["name"]).lower() not in plan_names, "never offer a place already added"


def test_optimize_day_preview_is_apply_optional_and_versioned_when_applied():
    trip_id, headers = _build_trip()
    itn = _choose_plan(trip_id, headers)
    # Pick the first day with at least two places — single-stop days (e.g. a
    # transport-only travel day) correctly return applied=False with a message.
    day = next(d["day"] for d in itn["days"] if len(d.get("stops", [])) >= 2)

    preview = client.post(f"/api/v1/trips/{trip_id}/optimize-day", headers=headers, json={
        "day": day, "apply": False,
    })
    assert preview.status_code == 200, preview.text
    pv = preview.json()
    assert pv["applied"] is False
    assert pv["version"] is None
    assert pv["days"], "proposed days must be returned for the Apply/Keep My Plan choice"

    applied = client.post(f"/api/v1/trips/{trip_id}/optimize-day", headers=headers, json={
        "day": day, "apply": True,
    })
    assert applied.status_code == 200, applied.text
    ap = applied.json()
    assert ap["applied"] is True
    assert ap["version"] == itn["version"] + 1

    changes = client.get(f"/api/v1/trips/{trip_id}/plan-changes", headers=headers).json()
    assert any(c["change_type"] == "optimized_day" for c in changes)


def test_confirm_validates_normal_plan_before_payment():
    trip_id, headers = _build_trip()
    _choose_plan(trip_id, headers)

    res = client.post(f"/api/v1/trips/{trip_id}/confirm", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["valid"] is True
    assert body["within_budget"] is True
    assert not body["missing"]
    assert body["version"] >= 1
    assert "ready for payment" in body["message"]


def test_plan_multi_guide_mode_checkout_collects_guide_fee_on_top():
    """Step-4 GUIDE_MODE (plan-multi → choose-plan → checkout) regression:
    the mode is persisted so pricing sees GUIDE_MODE (never ₹0 guide fee), and
    the fee sits ON TOP of the travel budget — 12.5% guide + 3% platform."""
    trip_id, headers = _build_trip()

    res = client.post(f"/api/v1/trips/{trip_id}/plan-multi", headers=headers, json={
        "mode": "GUIDE_MODE", "consent_acknowledged": True,
    })
    assert res.status_code == 200, res.text
    plans = res.json()
    assert plans and len(plans) == 3
    for p in plans:
        bd = p["cost_breakdown"]
        assert bd["guide_mode"] is True
        assert bd["guide_fee"] == round(float(p["base_plan_cost"]) * 0.125)
        assert bd["platform_fee"] == round(float(p["base_plan_cost"]) * 0.03)
        assert p["final_total"] == p["base_plan_cost"] + bd["guide_fee"] + bd["platform_fee"]
        assert p["within_budget"] is True  # travel spend inside the budget

    chosen = client.post(f"/api/v1/trips/{trip_id}/choose-plan", headers=headers, json={
        "plan_type": "RECOMMENDED",
    })
    assert chosen.status_code == 200, chosen.text

    trip = client.get(f"/api/v1/trips/{trip_id}", headers=headers).json()
    assert trip["mode"] == "GUIDE_MODE"
    assert trip["status"] == "REQUESTED"

    pr = client.get(f"/api/v1/trips/{trip_id}/pricing", headers=headers).json()
    assert pr["guide_required"] is True
    assert pr["guide_assigned"] is False
    assert pr["guide_fee"] > 0, "GUIDE_MODE via Step-4 must carry a real guide fee"
    assert abs(pr["guide_fee"] - round(float(pr["travel_spend"]) * 0.125)) <= 1
    assert pr["amount_payable"] == pr["guide_fee"] + pr["platform_fee"]

    co = client.post(f"/api/v1/trips/{trip_id}/checkout", headers=headers, json={"payment_method": "razorpay"})
    assert co.status_code == 200, co.text
    assert co.json()["amount"] == pr["amount_payable"]