"""10-stage prompt-routed workflow: persistent state, transport, local legs,
food tiers, budget gate, review, weather honesty and payment idempotency.

Uses the spec S4A example scale (10 travellers) so per-person x party math is
asserted exactly, including the private-cab per-vehicle exception.
"""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

import uuid

_N = 0


def _auth():
    global _N
    _N += 1
    uniq = uuid.uuid4().hex[:10]
    email = f"stage10.{uniq}@travion.in"
    password = "TravionE2e1!"
    digits = "9" + "".join(c for c in uuid.uuid4().hex if c.isdigit())[:9].ljust(9, "7")
    r = client.post("/api/v1/auth/signup", json={
        "email": email, "password": password, "role": "USER",
        "first_name": "Stage", "last_name": f"Ten{_N}",
        "phone": f"+91{digits[:10]}",
    })
    assert r.status_code in (200, 201), r.text
    token = client.post("/api/v1/auth/login", json={"email": email, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _make_trip(headers, days_ahead=30, length=4):
    locs = client.get("/api/v1/locations/all", headers=headers).json()
    src = next(l for l in locs if l["name"] == "Bangalore")
    dst = next(l for l in locs if l["name"] == "Ooty")
    now = datetime.now(timezone.utc)
    trip = client.post("/api/v1/trips/search", headers=headers, json={
        "source_location_id": src["id"], "destination_location_id": dst["id"],
        "start_datetime": (now + timedelta(days=days_ahead)).isoformat(),
        "end_datetime": (now + timedelta(days=days_ahead + length - 1)).isoformat(),
    }).json()
    return trip["id"]


def _discover(headers, budget=100000.0, adults=8, children=2):
    r = client.post("/api/v1/trips/adaptive-discovery", headers=headers, json={
        "budget": budget, "group_type": "Family", "adults": adults, "children": children,
        "experience_type": "Mixed",
    })
    assert r.status_code == 200, r.text
    return r.json()


def _select_transport(headers, trip_id):
    pool = client.post(f"/api/v1/trips/{trip_id}/transport/options", headers=headers, json={}).json()
    sel = client.post(f"/api/v1/trips/{trip_id}/transport/select", headers=headers, json={
        "outbound_id": pool["outbound"][0]["id"],
        "return_id": pool["return"][0]["id"],
    })
    assert sel.status_code == 200, sel.text
    return sel.json()


def _sync_places(headers, trip_id, items):
    r = client.post(f"/api/v1/trips/{trip_id}/selections/sync", headers=headers,
                    json={"items": items, "replace": True})
    assert r.status_code == 200, r.text
    return r.json()


STAY = {"provider_place_id": "stay-oak-1", "name": "Oak Grove Residency",
        "category": "stays", "latitude": 11.4100, "longitude": 76.7000, "price_per_night": 2500.0}
PARK = {"provider_place_id": "park-botanical", "name": "Botanical Gardens",
        "category": "must_visit", "latitude": 11.4200, "longitude": 76.7100, "entry_fee": 150.0}
LAKE = {"provider_place_id": "lake-ooty", "name": "Ooty Lake",
        "category": "activities", "latitude": 11.4000, "longitude": 76.6900, "entry_fee": 100.0}
CAFE = {"provider_place_id": "cafe-bean", "name": "Bean & Leaf Cafe",
        "category": "cafes", "latitude": 11.4150, "longitude": 76.7050}


# ── stage state ───────────────────────────────────────────────────────────────
def test_stage_state_shape_and_resume_pointer():
    h = _auth()
    trip_id = _make_trip(h)
    state = client.get(f"/api/v1/trips/{trip_id}/stage", headers=h).json()
    assert state["trip_id"] == trip_id
    assert state["current_stage"] == 1 and state["stage_key"] == "details"
    assert [s["index"] for s in state["stages"]] == list(range(1, 11))
    assert [s["label"] for s in state["stages"]] == [
        "Trip", "Travellers", "Transport", "Explore", "Mode",
        "Local", "Budget", "Itinerary", "Review", "Payment",
    ]
    assert state["trip"]["days"] == 4 and state["trip"]["nights"] == 3
    gate = state["budget"]
    assert gate["food_tier"] == "STANDARD"
    # Standard allowance: 800 x 10 travellers x 4 days
    _discover(h)
    state = client.get(f"/api/v1/trips/{trip_id}/stage", headers=h).json()
    assert state["budget"]["spend"]["food"] == 800.0 * 10 * 4


def test_stage_forward_blocked_until_prerequisites_met():
    h = _auth()
    trip_id = _make_trip(h)
    r = client.put(f"/api/v1/trips/{trip_id}/stage", headers=h, json={"stage": 4})
    assert r.status_code == 422
    assert r.json()["detail"]["error_code"] == "STAGE_BLOCKED"
    # Backward moves are always allowed and never wipe anything.
    back = client.put(f"/api/v1/trips/{trip_id}/stage", headers=h, json={"stage": 1})
    assert back.status_code == 200


# ── stage 3: transport ────────────────────────────────────────────────────────
def test_transport_options_party_math_and_verified_first():
    h = _auth()
    trip_id = _make_trip(h)
    _discover(h)  # 10 travellers
    pool = client.post(f"/api/v1/trips/{trip_id}/transport/options", headers=h, json={}).json()
    assert 1 <= len(pool["outbound"]) <= 5
    assert 1 <= len(pool["return"]) <= 5
    for opt in pool["outbound"] + pool["return"]:
        assert opt["party_total"] == round(opt["price_per_person"] * 10, 2)
        assert opt["verified"] in (True, False)
        if opt["verified"]:
            assert opt["source"] == "verified_catalog" and opt["availability"] == "AVAILABLE"
        else:
            assert opt["availability"] == "UNCONFIRMED_ESTIMATE"
    # Bangalore->Ooty corridor has verified catalog entries: they must lead.
    assert pool["outbound"][0]["verified"] is True


def test_transport_select_persists_and_rejects_unknown_ids():
    h = _auth()
    trip_id = _make_trip(h)
    _discover(h)
    bad = client.post(f"/api/v1/trips/{trip_id}/transport/select", headers=h,
                      json={"outbound_id": "ob-999", "return_id": "rt-1"})
    assert bad.status_code in (409, 422)  # no pool generated yet
    pool = client.post(f"/api/v1/trips/{trip_id}/transport/options", headers=h, json={}).json()
    bad2 = client.post(f"/api/v1/trips/{trip_id}/transport/select", headers=h,
                       json={"outbound_id": "ob-999", "return_id": pool["return"][0]["id"]})
    assert bad2.status_code == 422
    out, ret = pool["outbound"][0], pool["return"][0]
    sel = client.post(f"/api/v1/trips/{trip_id}/transport/select", headers=h,
                      json={"outbound_id": out["id"], "return_id": ret["id"]}).json()
    assert sel["selected"]["outbound"]["id"] == out["id"]
    assert sel["gate"]["spend"]["transport"] == round(out["party_total"] + ret["party_total"], 2)


# ── stage 4: exactly one stay ─────────────────────────────────────────────────
def test_places_completion_requires_exactly_one_stay():
    h = _auth()
    trip_id = _make_trip(h)
    _discover(h)
    _select_transport(h, trip_id)
    _sync_places(h, trip_id, [PARK])
    s = client.get(f"/api/v1/trips/{trip_id}/stage", headers=h).json()
    assert [x for x in s["stages"] if x["index"] == 4][0]["complete"] is False  # no stay
    _sync_places(h, trip_id, [PARK, STAY])
    s = client.get(f"/api/v1/trips/{trip_id}/stage", headers=h).json()
    assert [x for x in s["stages"] if x["index"] == 4][0]["complete"] is True
    _sync_places(h, trip_id, [PARK, STAY, dict(STAY, provider_place_id="stay-second", name="Second Stay")])
    s = client.get(f"/api/v1/trips/{trip_id}/stage", headers=h).json()
    assert [x for x in s["stages"] if x["index"] == 4][0]["complete"] is False  # two stays


def test_stay_cost_uses_rooms_times_nights():
    h = _auth()
    trip_id = _make_trip(h)
    _discover(h)  # 10 travellers -> 5 rooms, 3 nights
    _select_transport(h, trip_id)
    _sync_places(h, trip_id, [STAY])
    gate = client.get(f"/api/v1/trips/{trip_id}/budget/gate", headers=h).json()
    assert gate["spend"]["stay"] == 2500.0 * 5 * 3


# ── stage 5: mode before itinerary ────────────────────────────────────────────
def test_experience_mode_settable_before_itinerary():
    h = _auth()
    trip_id = _make_trip(h)
    _discover(h)
    _select_transport(h, trip_id)
    _sync_places(h, trip_id, [PARK, STAY])
    r = client.post(f"/api/v1/trips/{trip_id}/experience-mode", headers=h, json={"mode": "GUIDE_MODE"})
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "GUIDE_MODE"
    t = client.get(f"/api/v1/trips/{trip_id}", headers=h).json()
    assert t["mode"] == "GUIDE_MODE"
    gate = client.get(f"/api/v1/trips/{trip_id}/budget/gate", headers=h).json()
    assert gate["fees"]["guide"] == round(gate["spend"]["base_total"] * 0.125, 0)


# ── stage 6: local transport ──────────────────────────────────────────────────
def test_local_legs_and_cab_vehicle_math():
    h = _auth()
    trip_id = _make_trip(h)
    _discover(h)  # 10 travellers -> 3 cabs
    _select_transport(h, trip_id)
    _sync_places(h, trip_id, [STAY, PARK, LAKE])
    plan = client.post(f"/api/v1/trips/{trip_id}/local-transport/plan", headers=h, json={}).json()
    assert len(plan["legs"]) >= 2  # stay + 2 places
    for leg in plan["legs"]:
        assert leg["distance_km"] >= 0.5 and leg["duration_min"] >= 10
        by_type = {o["type"]: o for o in leg["options"]}
        assert "auto" in by_type and "private_cab" in by_type
        cab = by_type["private_cab"]
        assert cab["vehicles_needed"] == 3
        assert cab["party_total"] == round(cab["fare_vehicle"] * 3, 0)
        assert by_type["auto"]["party_total"] == round(by_type["auto"]["fare_per_person"] * 10, 0)
        assert leg["selected_id"]  # sensible default selected
    pick = client.post(f"/api/v1/trips/{trip_id}/local-transport/select", headers=h,
                       json={"leg_index": 0, "option_id": "lt-0-cab"}).json()
    assert pick["all_selected"] is True
    assert pick["gate"]["spend"]["local_transport"] > 0


# ── stage 7: food tiers + fee formula ─────────────────────────────────────────
def test_food_tier_changes_only_food_and_final_formula():
    h = _auth()
    trip_id = _make_trip(h)
    _discover(h)
    _select_transport(h, trip_id)
    _sync_places(h, trip_id, [STAY, PARK, LAKE, CAFE])
    client.post(f"/api/v1/trips/{trip_id}/experience-mode", headers=h, json={"mode": "GUIDE_MODE"})
    client.post(f"/api/v1/trips/{trip_id}/local-transport/plan", headers=h, json={})
    before = client.get(f"/api/v1/trips/{trip_id}/budget/gate", headers=h).json()
    assert before["food_tier"] == "STANDARD" and before["spend"]["food"] == 800.0 * 10 * 4
    after = client.put(f"/api/v1/trips/{trip_id}/food-tier", headers=h, json={"tier": "PREMIUM"}).json()
    gate = after["gate"]
    assert gate["food_tier"] == "PREMIUM" and gate["spend"]["food"] == 1200.0 * 10 * 4
    # Nothing else moved.
    for key in ("transport", "stay", "activities", "local_transport"):
        assert gate["spend"][key] == before["spend"][key], key
    b = gate["spend"]["base_total"]
    assert gate["fees"]["guide"] == round(b * 0.125, 0)
    assert gate["fees"]["platform"] == round(b * 0.03, 0)
    assert gate["fees"]["safety_reserve"] == round(b * 0.15, 0)
    assert gate["fees"]["insurance"] == 50.0
    assert gate["final_amount"] == round(
        b + gate["fees"]["guide"] + gate["fees"]["platform"]
        + gate["fees"]["safety_reserve"] + 50.0, 0)
    bad = client.put(f"/api/v1/trips/{trip_id}/food-tier", headers=h, json={"tier": "DELUXE"})
    assert bad.status_code == 422


# ── gate block + top-up recovery on the SAME stage ────────────────────────────
def test_gate_blocks_advance_and_topup_unblocks():
    h = _auth()
    trip_id = _make_trip(h)
    _discover(h, budget=5000.0)  # tiny envelope
    _select_transport(h, trip_id)
    gate = client.get(f"/api/v1/trips/{trip_id}/budget/gate", headers=h).json()
    assert gate["can_continue"] is False and gate["violations"]
    blocked = client.put(f"/api/v1/trips/{trip_id}/stage", headers=h, json={"stage": 4})
    assert blocked.status_code == 422
    top = client.post(f"/api/v1/trips/{trip_id}/budget/topup", headers=h, json={
        "amount": 100000.0, "stage": "transport", "reason": "stage-10 test top-up"})
    assert top.status_code == 200, top.text
    gate2 = client.get(f"/api/v1/trips/{trip_id}/budget/gate", headers=h).json()
    assert gate2["can_continue"] is True
    assert gate2["budget_max"] == 105000.0


# ── stage 8/9: review snapshot consistency ────────────────────────────────────
def test_review_snapshot_matches_gate():
    h = _auth()
    trip_id = _make_trip(h)
    _discover(h)
    _select_transport(h, trip_id)
    _sync_places(h, trip_id, [STAY, PARK])
    client.post(f"/api/v1/trips/{trip_id}/experience-mode", headers=h,
                json={"mode": "ADVENTUROUS_MODE"})
    review = client.get(f"/api/v1/trips/{trip_id}/review", headers=h).json()
    assert review["payment_amount"] == review["pricing"]["final_amount"]
    assert review["transport"]["selected"]["outbound"]["id"]
    assert review["places"]["stay"]["name"] == "Oak Grove Residency"
    assert review["mode"] == "ADVENTUROUS_MODE"
    assert review["pricing"]["fees"]["guide"] == 0.0


# ── bridges: selections → profile → itinerary ─────────────────────────────────
def test_sync_mirrors_ledger_into_planner_profile():
    h = _auth()
    trip_id = _make_trip(h)
    _discover(h)
    _sync_places(h, trip_id, [STAY, PARK, CAFE])
    prof = client.get(f"/api/v1/trips/{trip_id}/profile", headers=h).json()
    assert "Oak Grove Residency" not in (prof.get("selected_places") or [])
    assert "Botanical Gardens" in (prof.get("selected_places") or [])
    assert (prof.get("selected_stay") or {}).get("name") == "Oak Grove Residency"
    assert float((prof.get("selected_stay") or {}).get("price_per_night") or 0) == 2500.0


def test_plan_prices_selected_transport_fares():
    h = _auth()
    trip_id = _make_trip(h)
    _discover(h)
    chosen = _select_transport(h, trip_id)
    expected = round(
        chosen["selected"]["outbound"]["party_total"]
        + chosen["selected"]["return"]["party_total"], 0)
    _sync_places(h, trip_id, [STAY, PARK])
    client.post(f"/api/v1/trips/{trip_id}/experience-mode", headers=h,
                json={"mode": "ADVENTUROUS_MODE"})
    plan = client.post(f"/api/v1/trips/{trip_id}/plan", headers=h,
                       json={"mode": "ADVENTUROUS_MODE", "consent_acknowledged": True}).json()
    bd = plan["cost_breakdown"]
    assert float(bd["transport"]) == expected
    assert bd["selected_transport"]["outbound"]["id"] == chosen["selected"]["outbound"]["id"]


# ── LLM chain (offline): prompt-schema payload → honest options ───────────────
def test_llm_suggestion_payload_flows_through_labelled_unconfirmed():
    """The prompt contract (mode/provider/departure/arrival/duration/
    per_person_fare_estimate, possibly fenced + string fares) must survive
    into the pool as UNCONFIRMED llm_suggestion rows with party pricing —
    verified rows always lead. No network involved."""
    import json as _json
    import re as _re
    from app.services import stage_transport as _stra
    raw = (
        "```json\n"
        '{"outbound": [{"mode": "Private Minibus 12-Seater AC Tempo Traveller", '
        '"provider": "Savaari Car Rentals", '
        '"departure": "2026-12-25T16:30:00+05:30", "arrival": "2026-12-25T23:45:00+05:30", '
        '"duration": "7h 15m", "per_person_fare_estimate": "1,650", '
        '"availability": "Estimate only"}], '
        '"return": [{"mode": "AC Sleeper Bus", "provider": "KSRTC", '
        '"departure": "2026-12-28T21:00:00+05:30", "arrival": "2026-12-29T06:00:00+05:30", '
        '"duration": "9h", "per_person_fare_estimate": "Rs.1,150", '
        '"availability": "Estimate"}]}\n```'
    )
    m = _re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", raw, _re.S)
    parsed = _json.loads(m.group(1))
    pool = _stra.build_round_trip_options("Bangalore", "Ooty", None, None, 10, llm_options=parsed)
    llm_rows = [o for d in ("outbound", "return") for o in pool[d]
                if o["source"] == "llm_suggestion"]
    assert len(llm_rows) == 2
    by_id = {o["operator"]: o for o in llm_rows}
    assert by_id["Savaari Car Rentals"]["party_total"] == 1650.0 * 10
    assert by_id["KSRTC"]["party_total"] == 1150.0 * 10
    assert all(o["availability"] == "UNCONFIRMED_ESTIMATE" and o["verified"] is False
               for o in llm_rows)
    assert pool["outbound"][0]["verified"] is True  # verified always leads


# ── weather honesty ───────────────────────────────────────────────────────────
def test_weather_labels_every_day_honestly():
    h = _auth()
    trip_id = _make_trip(h, days_ahead=60)  # beyond any forecast horizon
    w = client.get(f"/api/v1/trips/{trip_id}/weather", headers=h).json()
    assert len(w["forecast"]) == 4
    for day in w["forecast"]:
        assert day["source"] in ("openweathermap", "seasonal_typical")
        if day["source"] == "seasonal_typical":
            assert day["reliable"] is False
    assert "disclaimer" in w and w["disclaimer"]


# ── payment idempotency ───────────────────────────────────────────────────────
def test_webhook_replay_does_not_duplicate():
    h = _auth()
    trip_id = _make_trip(h)
    _discover(h)
    _select_transport(h, trip_id)
    _sync_places(h, trip_id, [STAY, PARK])
    client.post(f"/api/v1/trips/{trip_id}/experience-mode", headers=h,
                json={"mode": "ADVENTUROUS_MODE"})
    plan = client.post(f"/api/v1/trips/{trip_id}/plan", headers=h,
                       json={"mode": "ADVENTUROUS_MODE"}).json()
    assert plan.get("days"), plan
    co = client.post(f"/api/v1/trips/{trip_id}/checkout", headers=h,
                     json={"non_refundable_acknowledged": True}).json()
    order_id = co["order_id"]
    payload = {"razorpay_order_id": order_id,
               "razorpay_payment_id": "pay_sim_testreplay1",
               "razorpay_signature": co.get("simulated_signature")}
    first = client.post("/api/v1/payments/webhook", json=payload).json()
    assert first["payment_status"] == "SUCCESS" and first["trip_status"] == "ACTIVE"
    second = client.post("/api/v1/payments/webhook", json=payload).json()
    assert second["payment_status"] == "SUCCESS"
    assert second.get("duplicate_callback") is True
    t = client.get(f"/api/v1/trips/{trip_id}", headers=h).json()
    assert t["status"] == "ACTIVE"
