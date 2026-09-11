"""Experience-mode endpoint — the FINAL pre-payment choice (Guide vs Adventurous).

Drives the REAL API (signup → search → discovery → plan-multi → choose-plan →
experience-mode) and asserts:
  * choosing a plan (before any experience is set) leaves the trip PLANNED with
    no guide fee — plans are neutral until the experience choice;
  * GUIDE_MODE after planning reprices the SAME itinerary version with a 12.5%
    guide fee + 3% platform fee, WITHOUT bumping the version (the user's edits
    must never be regenerated);
  * ADVENTUROUS_MODE keeps the guide fee at ₹0 (only the 3% platform fee);
  * switching modes updates the authoritative total BOTH ways;
  * every switch is logged in the plan-change audit trail.
"""
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def _build_trip():
    key = "".join(ch for ch in str(datetime.now().timestamp()) if ch.isalnum())[-16:]
    email = f"expmode_{key}@test.com"
    s = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Exp", "last_name": "Mode", "phone": "+919876543210",
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


def _plan_and_choose(trip_id, headers):
    res = client.post(f"/api/v1/trips/{trip_id}/plan-multi", headers=headers, json={
        "mode": "ADVENTUROUS_MODE", "consent_acknowledged": True,
    })
    assert res.status_code == 200, res.text
    chosen = client.post(f"/api/v1/trips/{trip_id}/choose-plan", headers=headers, json={
        "plan_type": "RECOMMENDED",
    })
    assert chosen.status_code == 200, chosen.text
    return chosen.json()


def _trip(trip_id, headers):
    return client.get(f"/api/v1/trips/{trip_id}", headers=headers).json()


def test_plan_is_neutral_before_experience_choice():
    """Plans are built WITHOUT a guide fee: the experience choice hasn't been
    made yet, so a chosen plan must never carry a 12.5% guide fee."""
    trip_id, headers = _build_trip()
    itn = _plan_and_choose(trip_id, headers)
    assert _trip(trip_id, headers)["status"] == "PLANNED"
    bd = itn["cost_breakdown"]
    assert float(bd.get("guide_fee") or 0) == 0.0, "no guide fee before the experience choice"


def test_guide_mode_reprices_final_itinerary_without_regeneration():
    """GUIDE_MODE adds the 12.5% guide fee to the SAME itinerary version — the
    user's plan is repriced, never rebuilt."""
    trip_id, headers = _build_trip()
    itn = _plan_and_choose(trip_id, headers)
    base_total = float(itn["total_cost"])

    res = client.post(f"/api/v1/trips/{trip_id}/experience-mode", headers=headers, json={
        "mode": "GUIDE_MODE",
    })
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["mode"] == "GUIDE_MODE"
    assert data["guide_fee"] > 0, "Guide Mode must collect the 12.5% guide fee"
    assert data["platform_fee"] > 0, "the 3% platform fee always applies"
    # fee math (authoritative rule): base = payable − fees; guide = 12.5% of
    # base; platform = 3% of base. (The plan total already embeds the old 3%
    # platform fee, so deriving the base from the payable is the honest check.)
    fee_base = round(data["amount_payable"] - data["guide_fee"] - data["platform_fee"], 0)
    assert data["guide_fee"] == round(fee_base * 0.125, 0), "guide fee must be exactly 12.5% of the base"
    assert data["platform_fee"] == round(fee_base * 0.03, 0), "platform fee must be exactly 3% of the base"
    assert data["amount_payable"] > base_total * 0.1, "sanity: a real repriced total came back"
    # the itinerary itself was NOT regenerated
    after = client.get(f"/api/v1/trips/{trip_id}/itinerary", headers=headers).json()
    assert after["version"] == itn["version"]
    # guide-assignment pipeline is flagged — but no guide is assigned yet (§21)
    assert _trip(trip_id, headers)["status"] == "REQUESTED"


def test_adventurous_mode_keeps_guide_fee_zero():
    trip_id, headers = _build_trip()
    _plan_and_choose(trip_id, headers)
    res = client.post(f"/api/v1/trips/{trip_id}/experience-mode", headers=headers, json={
        "mode": "ADVENTUROUS_MODE",
    })
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["mode"] == "ADVENTUROUS_MODE"
    assert data["guide_fee"] == 0, "Adventurous Mode must NEVER charge the guide fee"
    assert data["platform_fee"] > 0
    assert _trip(trip_id, headers)["status"] == "PLANNED"


def test_switching_modes_reprices_both_ways_and_logs():
    trip_id, headers = _build_trip()
    _plan_and_choose(trip_id, headers)

    guide = client.post(f"/api/v1/trips/{trip_id}/experience-mode", headers=headers,
                        json={"mode": "GUIDE_MODE"}).json()
    adv = client.post(f"/api/v1/trips/{trip_id}/experience-mode", headers=headers,
                      json={"mode": "ADVENTUROUS_MODE"}).json()
    assert adv["guide_fee"] == 0
    assert adv["amount_payable"] < guide["amount_payable"], "dropping the guide must lower the payable"

    back = client.post(f"/api/v1/trips/{trip_id}/experience-mode", headers=headers,
                       json={"mode": "GUIDE_MODE"}).json()
    assert back["guide_fee"] == guide["guide_fee"], "repricing is deterministic"

    changes = client.get(f"/api/v1/trips/{trip_id}/plan-changes", headers=headers).json()
    modes = [c for c in changes if c["change_type"] == "experience_mode"]
    assert len(modes) >= 3, "every experience switch is auditable"


def test_experience_mode_requires_a_chosen_plan():
    trip_id, headers = _build_trip()
    res = client.post(f"/api/v1/trips/{trip_id}/experience-mode", headers=headers, json={
        "mode": "GUIDE_MODE",
    })
    assert res.status_code == 400, "no itinerary exists yet — the choice must come after a plan"
