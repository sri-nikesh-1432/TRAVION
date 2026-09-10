"""Three-question discovery contract — the new planning interview.

Verifies the product rules that shape Step 2:
  * EXACTLY three questions: budget → party → experience
  * Budget: 4 preset ranges; custom From/To must be numbers-only, min ₹1,000,
    To >= From — invalid answers are rejected with 422 immediately
  * Party: group + exact traveller count; Adults + Children must equal the
    total; Solo is handled automatically (1 traveller)
  * Experience: one of Adventure / Food & Culture / Spiritual / Mixed
  * Home City is mandatory on the basic profile
"""
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _signup() -> dict:
    email = f"threeq_{int(time.time() * 1000)}@test.com"
    r = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Three", "last_name": "Question", "phone": "+919876543210",
    })
    assert r.status_code == 200, r.text
    client.put("/api/v1/trips/profile/basic", headers={
        "Authorization": f"Bearer {r.json()['access_token']}"
    }, json={
        "first_name": "Three", "last_name": "Question",
        "phone": "+919876543210", "home_city": "Chennai",
    })
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _trip(headers: dict) -> str:
    locs = client.get("/api/v1/locations/all").json()
    ooty = next(l for l in locs if l["name"] == "Ooty")
    bangalore = next(l for l in locs if l["name"] == "Bangalore")
    now = datetime.now(timezone.utc)
    r = client.post("/api/v1/trips/search", headers=headers, json={
        "source_location_id": bangalore["id"],
        "destination_location_id": ooty["id"],
        "start_datetime": (now + timedelta(days=3)).isoformat(),
        "end_datetime": (now + timedelta(days=6)).isoformat(),
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _next(headers: dict, trip_id: str, answers: dict):
    return client.post(f"/api/v1/trips/{trip_id}/discovery/next",
                       headers=headers, json={"answers_so_far": answers})


def test_exactly_three_questions_in_order():
    headers = _signup()
    trip_id = _trip(headers)

    q1 = _next(headers, trip_id, {}).json()
    assert q1["is_complete"] is False
    assert q1["question_id"] == "budget"
    assert q1["question_text"] == "What's your travel budget?"
    assert len(q1["options"]) == 4  # exactly 4 predefined ranges
    assert q1["total_estimated"] == 3

    q2 = _next(headers, trip_id, {"budget": {"from": 8000, "to": 10000}}).json()
    assert q2["question_id"] == "party"
    assert q2["question_text"] == "Who are you travelling with?"

    q3 = _next(headers, trip_id, {
        "budget": {"from": 8000, "to": 10000},
        "party": {"group": "Friends Group", "total": 6, "adults": 4, "children": 2},
    }).json()
    assert q3["question_id"] == "experience"
    assert q3["question_text"] == "What kind of experience are you looking for?"
    labels = [o["label"] for o in q3["options"]]
    assert labels == ["Adventure", "Food & Culture", "Spiritual", "Mixed"]
    # Every experience option carries a visible description
    assert all(o.get("description") for o in q3["options"])

    done = _next(headers, trip_id, {
        "budget": {"from": 8000, "to": 10000},
        "party": {"group": "Friends Group", "total": 6, "adults": 4, "children": 2},
        "experience": "Spiritual",
    }).json()
    assert done["is_complete"] is True
    assert done["answered_count"] == 3


def test_custom_budget_below_minimum_rejected():
    headers = _signup()
    trip_id = _trip(headers)
    r = _next(headers, trip_id, {"budget": {"from": 100, "to": 5000}})
    assert r.status_code == 422
    assert "1,000" in r.json()["detail"]


def test_custom_budget_reversed_range_rejected():
    headers = _signup()
    trip_id = _trip(headers)
    r = _next(headers, trip_id, {"budget": {"from": 8000, "to": 2000}})
    assert r.status_code == 422


def test_custom_budget_letters_rejected():
    headers = _signup()
    trip_id = _trip(headers)
    r = _next(headers, trip_id, {"budget": {"from": "8000abc", "to": 10000}})
    assert r.status_code == 422
    r = _next(headers, trip_id, {"budget": {"from": -5000, "to": 10000}})
    assert r.status_code == 422


def test_party_counts_must_add_up():
    headers = _signup()
    trip_id = _trip(headers)
    base = {"budget": {"from": 8000, "to": 10000}}
    r = _next(headers, trip_id, {**base, "party": {"group": "Family", "total": 5, "adults": 4, "children": 2}})
    assert r.status_code == 422
    assert "add up" in r.json()["detail"]


def test_solo_is_handled_automatically():
    headers = _signup()
    trip_id = _trip(headers)
    q = _next(headers, trip_id, {"budget": {"from": 8000, "to": 10000}, "party": "Solo"}).json()
    # Solo completes the party question server-side without further input
    assert q["question_id"] == "experience"


def test_experience_stored_and_normalized():
    headers = _signup()
    trip_id = _trip(headers)
    _next(headers, trip_id, {"budget": {"from": 8000, "to": 10000}})
    _next(headers, trip_id, {"budget": {"from": 8000, "to": 10000}, "party": "Solo"})
    done = _next(headers, trip_id, {
        "budget": {"from": 8000, "to": 10000},
        "party": "Solo",
        "experience": ["Food & Culture"],
    })
    assert done.json()["is_complete"] is True
    profile = client.get(f"/api/v1/trips/{trip_id}/profile", headers=headers).json()
    assert profile["experience"] == "Food & Culture"
    assert profile["budget"]["max"] == 10000.0


def test_home_city_is_mandatory():
    email = f"homecity_{int(time.time() * 1000)}@test.com"
    r = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Home", "last_name": "City", "phone": "+919876543210",
    })
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    res = client.put("/api/v1/trips/profile/basic", headers=headers, json={
        "first_name": "Home", "last_name": "City", "phone": "+919876543210",
    })
    assert res.status_code == 400
    assert "home city" in res.json()["detail"].lower()
