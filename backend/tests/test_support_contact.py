"""Contact / support form — real backend, never a fake submit.

Guarantees:
  * a visitor can submit the contact form WITHOUT an account (public POST);
  * every field is validated (email, topic, priority, message length, name);
  * the record is stored with a triage status and is only visible to
    MANAGER / ADMIN staff (401 anonymous, 403 traveller, 200 manager);
  * the manager queue is newest-first.
"""
from datetime import datetime
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def _uniq():
    return "".join(ch for ch in str(datetime.now().timestamp()) if ch.isalnum())[-10:]


def _user_headers():
    email = f"contact_user_{_uniq()}@travion.in"
    s = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Contact", "last_name": "Check", "phone": "+919881122334",
    })
    assert s.status_code == 200, s.text
    tok = s.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def _manager_headers():
    email = f"contact_mgr_{_uniq()}@travion.in"
    s = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Contact", "last_name": "Mgr", "phone": "+919881122335",
    })
    assert s.status_code == 200, s.text
    e = client.post("/api/v1/auth/elevate", json={
        "email": email, "password": "Password123!", "access_code": "SIH-MANAGER",
    })
    assert e.status_code == 200, e.text
    return {"Authorization": f"Bearer {e.json()['access_token']}"}


# ── Public submit ────────────────────────────────────────────────────────────

def test_visitor_can_submit_contact_without_an_account():
    res = client.post("/api/v1/support/contact", json={
        "name": "Priya Raghavan",
        "email": "priya@example.com",
        "topic": "Trip planning",
        "priority": "Urgent",
        "message": "Can Travion plan a 5-day Kerala itinerary before the rains?",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "Priya Raghavan"
    assert body["email"] == "priya@example.com"
    assert body["topic"] == "Trip planning"
    assert body["priority"] == "Urgent"
    assert body["status"] == "NEW"
    assert body["id"]
    assert body["handled_at"] is None


def test_contact_validates_every_field():
    # Short message
    r = client.post("/api/v1/support/contact", json={
        "name": "Rahul", "email": "rahul@example.com", "message": "hi",
    })
    assert r.status_code == 422, r.text
    # Invalid email
    r = client.post("/api/v1/support/contact", json={
        "name": "Rahul", "email": "not-an-email", "message": "A useful message here.",
    })
    assert r.status_code == 422, r.text
    # Unknown topic
    r = client.post("/api/v1/support/contact", json={
        "name": "Rahul", "email": "rahul@example.com", "topic": "Sailing",
        "message": "A useful message here.",
    })
    assert r.status_code == 422, r.text
    # Placeholder name rejected (no fake data)
    r = client.post("/api/v1/support/contact", json={
        "name": "asdf", "email": "rahul@example.com", "message": "A useful message here.",
    })
    assert r.status_code == 422, r.text


def test_contact_normalizes_email():
    res = client.post("/api/v1/support/contact", json={
        "name": "Meera", "email": "  Meera@Example.COM  ",
        "message": "I would like help with my trip planning.",
    })
    assert res.status_code == 201, res.text
    assert res.json()["email"] == "meera@example.com"


# ── Staff-only triage queue ──────────────────────────────────────────────────

def test_contact_queue_requires_authentication():
    res = client.get("/api/v1/support/contact")
    assert res.status_code == 401, res.text


def test_contact_queue_forbidden_for_travellers():
    h = _user_headers()
    res = client.get("/api/v1/support/contact", headers=h)
    assert res.status_code == 403, res.text


def test_manager_sees_queue_newest_first():
    for i, topic in enumerate(["Help", "Bug report", "Payments"]):
        res = client.post("/api/v1/support/contact", json={
            "name": f"Fan Number {i + 1}",
            "email": f"fan{i + 1}@example.com",
            "topic": topic,
            "message": f"Message number {i + 1} with enough length to pass.",
        })
        assert res.status_code == 201, res.text

    h = _manager_headers()
    res = client.get("/api/v1/support/contact", headers=h)
    assert res.status_code == 200, res.text
    items = res.json()
    assert items, "manager must see submitted messages"
    timestamps = [it["created_at"] for it in items]
    assert timestamps == sorted(timestamps, reverse=True), "queue must be newest-first"
    topics = {it["topic"] for it in items}
    assert {"Help", "Bug report", "Payments"}.issubset(topics)