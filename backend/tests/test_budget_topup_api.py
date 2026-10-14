"""Budget snapshot + top-up persistence — end-to-end API guarantees (spec §8/§11/§14).

Covers, against the real API (signup → trip → selections → budget endpoints):

  * snapshot math: base budget, committed spend, remaining budget;
  * the 20% place-selection protection (buffer + allowance) — distinct from
    the 15% safety reserve;
  * the exceeded-budget gate: selection over the allowance is reported with
    `within_allowance: false` + `exceeds_by`, and a top-up re-opens Continue;
  * preview NEVER persists, confirm DOES persist (BudgetAdjustment trail +
    audit event + trips.budget + interview envelope stay in sync);
  * a top-up is never a Payment (no Payment rows created);
  * amount validation, role restrictions and ownership enforcement.
"""
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _signup(prefix: str):
    email = f"{prefix}_{datetime.now().timestamp()}@test.com"
    res = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Budget", "last_name": "Tester", "phone": "+919876543210",
    })
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _create_trip(headers) -> dict:
    locs = client.get("/api/v1/locations/all", headers=headers).json()
    src = next(l for l in locs if l["name"] == "Bangalore")
    dst = next(l for l in locs if l["name"] == "Ooty")
    now = datetime.now(timezone.utc)
    trip = client.post("/api/v1/trips/search", headers=headers, json={
        "source_location_id": src["id"], "destination_location_id": dst["id"],
        "start_datetime": (now + timedelta(days=12)).isoformat(),
        "end_datetime": (now + timedelta(days=15)).isoformat(),
    })
    assert trip.status_code == 200, trip.text
    return trip.json()


def _select(headers, trip_id, pid, name, category, price):
    res = client.post(f"/api/v1/trips/{trip_id}/selections", headers=headers, json={
        "provider_place_id": pid, "name": name, "category": category,
        "price": price, "latitude": 11.4, "longitude": 76.7,
    })
    assert res.status_code == 200, res.text
    return res.json()


def _snapshot(headers, trip_id) -> dict:
    res = client.get(f"/api/v1/trips/{trip_id}/budget", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


# ── Snapshot math ────────────────────────────────────────────────────────────

def test_snapshot_reports_base_committed_remaining_and_20pc_protection():
    headers = _signup("budsnap")
    trip = _create_trip(headers)
    snap = _snapshot(headers, trip["id"])

    assert snap["currency"] == "INR"
    assert float(snap["base_budget"]) == float(trip["budget"])  # one authority
    assert float(snap["committed_expenses"]) == 0.0
    assert float(snap["remaining_budget"]) == float(snap["base_budget"])

    # 20% protected, 80% spendable while selecting places (spec §11).
    stage = snap["place_stage"]
    base = float(snap["base_budget"])
    assert abs(float(stage["protected_buffer"]) - round(base * 0.20, 2)) < 0.011
    assert abs(float(stage["place_selection_allowance"]) - round(base * 0.80, 2)) < 0.011
    assert stage["within_allowance"] is True
    assert float(stage["exceeds_by"]) == 0.0
    assert snap["adjustments"] == []


def test_selections_feed_committed_and_gate_flips_when_allowance_exceeded():
    headers = _signup("budgate")
    trip = _create_trip(headers)
    tid = trip["id"]

    # Base budget 15,000 → allowance 12,000.
    _select(headers, tid, "stay-1", "Cozy Nest Homestay", "stay", 6000)
    _select(headers, tid, "must-1", "Botanical Gardens", "must_visit", 4000)
    snap = _snapshot(headers, tid)
    assert float(snap["committed_expenses"]) == 10000
    assert float(snap["remaining_budget"]) == 5000
    assert snap["place_stage"]["within_allowance"] is True

    # One push over the 80% allowance → Continue must be blocked (spec §11).
    _select(headers, tid, "act-1", "Peak Trek", "activities", 3000)
    snap = _snapshot(headers, tid)
    stage = snap["place_stage"]
    assert float(snap["committed_expenses"]) == 13000
    assert stage["within_allowance"] is False
    assert abs(float(stage["exceeds_by"]) - 1000) < 0.011  # 13,000 − 12,000

    # "Deselect and continue" path: removing the activity re-opens Continue.
    client.delete(f"/api/v1/trips/{tid}/selections/act-1", headers=headers)
    snap = _snapshot(headers, tid)
    assert snap["place_stage"]["within_allowance"] is True
    assert float(snap["committed_expenses"]) == 10000


# ── Preview vs confirm ───────────────────────────────────────────────────────

def test_preview_never_persists_but_confirm_writes_the_adjustment_trail():
    headers = _signup("budtopup")
    trip = _create_trip(headers)
    tid = trip["id"]

    prev = client.post(f"/api/v1/trips/{tid}/budget/topup-preview", headers=headers,
                       json={"amount": 5000, "stage": "places"})
    assert prev.status_code == 200, prev.text
    body = prev.json()
    assert float(body["previous_budget"]) == float(trip["budget"])
    assert float(body["updated_budget"]) == float(trip["budget"]) + 5000

    # Preview must NOT touch the database.
    snap = _snapshot(headers, tid)
    assert float(snap["base_budget"]) == float(trip["budget"])
    assert snap["adjustments"] == []

    # Confirm: exact spec rule — new base = previous base + amount.
    res = client.post(f"/api/v1/trips/{tid}/budget/topup", headers=headers,
                      json={"amount": 5000, "stage": "places", "reason": "stay upgrade"})
    assert res.status_code == 200, res.text
    data = res.json()
    adj = data["adjustment"]
    assert float(adj["previous_budget"]) == float(trip["budget"])
    assert float(adj["adjustment_amount"]) == 5000
    assert float(adj["updated_budget"]) == float(trip["budget"]) + 5000
    assert adj["stage"] == "places"
    assert adj["reason"] == "stay upgrade"
    assert adj["actor_role"] == "USER"

    # Snapshot reflects it everywhere (persisted across a fresh read).
    snap = _snapshot(headers, tid)
    assert float(snap["base_budget"]) == float(trip["budget"]) + 5000
    assert len(snap["adjustments"]) == 1
    assert float(snap["adjustments"][0]["adjustment_amount"]) == 5000
    # Committed spend unchanged; remaining rises by exactly the top-up.
    assert float(snap["remaining_budget"]) == float(trip["budget"]) + 5000


def test_topup_raises_the_allowance_so_the_blocked_selection_passes():
    """The spec's exact recovery loop: exceed → top-up ₹2,500 → same page,
    same selections, Continue usable again."""
    headers = _signup("budrecover")
    trip = _create_trip(headers)
    tid = trip["id"]
    _select(headers, tid, "stay-2", "Lake View Rooms", "stay", 9000)
    _select(headers, tid, "must-2", "Doddabetta Peak", "must_visit", 4000)
    # 13,000 > 12,000 allowance → blocked.
    assert _snapshot(headers, tid)["place_stage"]["within_allowance"] is False

    res = client.post(f"/api/v1/trips/{tid}/budget/topup", headers=headers,
                      json={"amount": 2500, "stage": "places"})
    assert res.status_code == 200, res.text

    snap = _snapshot(headers, tid)
    stage = snap["place_stage"]
    # Selections untouched by the top-up (spec §8: never erase selections).
    assert float(snap["committed_expenses"]) == 13000
    assert stage["within_allowance"] is True
    assert float(stage["exceeds_by"]) == 0.0
    assert abs(float(stage["protected_buffer"]) - round(17500 * 0.20, 2)) < 0.011


def test_topup_never_creates_a_payment():
    from app.core.db import SessionLocal
    from app.models.entities import Payment
    headers = _signup("budnopay")
    trip = _create_trip(headers)
    tid = trip["id"]

    res = client.post(f"/api/v1/trips/{tid}/budget/topup", headers=headers,
                      json={"amount": 2500, "stage": "plan"})
    assert res.status_code == 200, res.text

    db = SessionLocal()
    try:
        payments = db.query(Payment).filter(Payment.trip_id == tid).count()
        assert payments == 0, "a budget top-up must never look like money collected"
    finally:
        db.close()


def test_topup_writes_an_audit_event():
    from app.core.db import SessionLocal
    from app.models.entities import AuditLog
    headers = _signup("budaudit")
    trip = _create_trip(headers)
    tid = trip["id"]
    client.post(f"/api/v1/trips/{tid}/budget/topup", headers=headers,
                json={"amount": 7500, "stage": "transport"})

    db = SessionLocal()
    try:
        row = db.query(AuditLog).filter(
            AuditLog.action == "BUDGET_TOPUP", AuditLog.target_id == tid
        ).first()
        assert row is not None, "every top-up must be audited"
        assert float(row.details["adjustment_amount"]) == 7500
        assert row.actor_role == "USER"
        assert "password" not in str(row.details).lower()
    finally:
        db.close()


def test_topup_syncs_the_interview_budget_envelope():
    """After the discovery interview, trips.budget and the stored envelope
    must move together — otherwise the feasibility gate would judge a stale
    budget (spec: recalculate all dependent totals)."""
    headers = _signup("budenv")
    trip = _create_trip(headers)
    tid = trip["id"]
    answers = {
        "budget": {"from": 10000, "to": 20000},
        "party": "Solo",
        "experience": ["Nature & Wildlife"],
        "restrictions": ["Vegetarian"],
        "food_pref": ["Local Traditional Only"],
        "stay_pref": "Budget Hostel & Guesthouse",
        "transport_pref": "AC Sleeper Bus",
        "pace": "Balanced",
        "walking_tolerance": "Moderate",
        "priority": ["Balanced Value"],
    }
    done = client.post(f"/api/v1/trips/{tid}/discovery/next", headers=headers,
                       json={"answers_so_far": answers})
    assert done.status_code == 200, done.text
    snap0 = _snapshot(headers, tid)
    assert float(snap0["base_budget"]) == 20000

    res = client.post(f"/api/v1/trips/{tid}/budget/topup", headers=headers,
                      json={"amount": 5000, "stage": "plan"})
    assert res.status_code == 200, res.text

    prof = client.get(f"/api/v1/trips/{tid}/profile", headers=headers).json()
    budget_val = prof["budget"]
    assert float(budget_val["max"]) == 25000
    assert float(budget_val["min"]) <= float(budget_val["max"])


# ── Validation / security ────────────────────────────────────────────────────

def test_invalid_topup_amounts_are_rejected():
    headers = _signup("budvalid")
    trip = _create_trip(headers)
    tid = trip["id"]

    for amount in (0, -500, 6_000_000):
        res = client.post(f"/api/v1/trips/{tid}/budget/topup", headers=headers,
                          json={"amount": amount, "stage": "plan"})
        assert res.status_code == 422, f"amount {amount} must be rejected: {res.text}"

    res = client.post(f"/api/v1/trips/{tid}/budget/topup", headers=headers,
                      json={"amount": 2500, "stage": "surprise-stage"})
    assert res.status_code == 422

    snap = _snapshot(headers, tid)
    assert snap["adjustments"] == [], "rejected top-ups must leave no trail"
    assert float(snap["base_budget"]) == float(trip["budget"])


def test_budget_endpoints_enforce_auth_and_ownership():
    headers_a = _signup("budown_a")
    trip = _create_trip(headers_a)
    tid = trip["id"]

    # Unauthenticated → 401.
    assert client.get(f"/api/v1/trips/{tid}/budget").status_code == 401

    # Another signed-in user → 403 (object-level access check).
    headers_b = _signup("budown_b")
    assert client.get(f"/api/v1/trips/{tid}/budget", headers=headers_b).status_code == 403
    res = client.post(f"/api/v1/trips/{tid}/budget/topup", headers=headers_b,
                      json={"amount": 2500, "stage": "plan"})
    assert res.status_code == 403

    # Missing trip → 404.
    assert client.get("/api/v1/trips/nonexistent-id/budget",
                      headers=headers_a).status_code == 404


def test_guides_cannot_change_a_budget():
    headers = _signup("budguidetrip")
    trip = _create_trip(headers)
    res = client.post("/api/v1/auth/guide/register", json={
        "email": f"guide_{datetime.now().timestamp()}@test.com",
        "password": "Password123!", "first_name": "G", "last_name": "uide",
        "phone": "+919876543210", "city": "Ooty", "languages": ["English"],
        "destinations": ["Ooty"], "experience_years": 3, "guide_type": "Local",
        "availability": "always",
    })
    assert res.status_code == 200, res.text
    guide_headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    g = client.post(f"/api/v1/trips/{trip['id']}/budget/topup", headers=guide_headers,
                    json={"amount": 2500, "stage": "plan"})
    assert g.status_code == 403, "guides must never edit traveller budgets"
