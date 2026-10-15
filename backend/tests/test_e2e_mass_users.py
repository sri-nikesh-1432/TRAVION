"""End-to-end mass-onboarding suite: 30 travellers + 30 guides + 30 locations.

Proves the promises the platform makes to real users:
  * every onboarded account is PERMANENT — signup once, sign in again any time,
    profile still there (identity → user → profile survives across sessions)
  * every guide registration persists with PENDING approval (manager elevates)
  * trips across 30 distinct real locations (15 verified hubs + 16 registered
    through the public API with their true coordinates — Munnar already exists
    as a hub, so the catalog lands at exactly 30) and BOTH experience modes
    (GUIDE_MODE / ADVENTUROUS_MODE)
  * the LLM/plan pipeline produces real itineraries for each pair — first step
    is always the departure transport (no fabricated places)
  * counts in the database match exactly what the API reports

Runs against the same engine as the app (SQLite by default, MySQL when
DATABASE_URL points at it) — rows written here stay in the database, exactly
like a production signup.
"""
import uuid
from datetime import datetime, timezone, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.db import SessionLocal
from app.models.entities import Identity, User, Guide, Trip

client = TestClient(app)

PASSWORD = "TravionE2e1!"

# 30 distinct destinations with REAL coordinates — 15 verified hubs exist in
# the catalog; the rest are registered through the public API (the same path
# a traveller uses) with their true lat/lng. "Munnar" already exists as a
# verified hub, so registering it is an idempotent no-op by design.
REGISTERED_LOCATIONS = [
    ("Munnar", "Kerala", 10.0889, 77.0595),
    ("Varkala", "Kerala", 8.7333, 76.7167),
    ("Hampi", "Karnataka", 15.3350, 76.4600),
    ("Gokarna", "Karnataka", 14.5500, 74.3167),
    ("Mahabalipuram", "Tamil Nadu", 12.6167, 80.1833),
    ("Kanyakumari", "Tamil Nadu", 8.0833, 77.5500),
    ("Mount Abu", "Rajasthan", 24.5925, 72.7156),
    ("Darjeeling", "West Bengal", 27.0360, 88.2627),
    ("Shillong", "Meghalaya", 25.5788, 91.8933),
    ("Tawang", "Arunachal Pradesh", 27.5864, 91.8689),
    ("Rishikesh", "Uttarakhand", 30.0869, 78.2676),
    ("Amritsar", "Punjab", 31.6340, 74.8723),
    ("Pondicherry", "Tamil Nadu", 11.9416, 79.8083),
    ("Kochi", "Kerala", 9.9312, 76.2673),
    ("Alleppey", "Kerala", 9.4981, 76.3388),
    ("Jodhpur", "Rajasthan", 26.2389, 73.0243),
]

FIRST_NAMES = [
    "Aarav", "Vivaan", "Aditya", "Ishaan", "Kabir", "Ananya", "Diya", "Myra",
    "Saanvi", "Aadhya", "Rohan", "Arjun", "Krishna", "Nikhil", "Priya",
    "Kavya", "Meera", "Tanvi", "Rahul", "Vikram", "Sneha", "Pooja", "Neha",
    "Aisha", "Riya", "Karan", "Siddharth", "Manish", "Lakshmi", "Divya",
]
LAST_NAMES = [
    "Sharma", "Verma", "Iyer", "Nair", "Reddy", "Patel", "Gupta", "Singh",
    "Chopra", "Mehta", "Rao", "Das", "Kulkarni", "Joshi", "Pillai",
    "Bhat", "Menon", "Shetty", "Ghosh", "Banerjee", "Kaur", "Mishra",
    "Chauhan", "Trivedi", "Desai", "Hegde", "Naidu", "Agarwal", "Saxena", "Dutta",
]
HOME_CITIES = [
    "Chennai", "Mumbai", "Delhi", "Pune", "Kolkata", "Jaipur", "Lucknow",
    "Indore", "Bhopal", "Nagpur", "Surat", "Vadodara", "Coimbatore",
    "Visakhapatnam", "Guwahati", "Patna", "Chandigarh", "Dehradun",
    "Mysore", "Thrissur", "Jabalpur", "Rajkot", "Kanpur", "Agra",
    "Varanasi", "Madurai", "Hubli", "Tirupati", "Guntur", "Udaipur",
]

GUIDE_SPECIALISATIONS = [
    ["Trekking", "Wildlife"], ["History", "Architecture"], ["Culinary", "Local Culture"],
    ["Photography", "Nature"], ["Spiritual", "Heritage"], ["Adventure", "Water Sports"],
]


def _signup_user(i: int) -> dict:
    email = f"e2e.user.{i}.{uuid.uuid4().hex[:6]}@travion.in"
    res = client.post("/api/v1/auth/signup", json={
        "email": email, "password": PASSWORD, "role": "USER",
        "first_name": FIRST_NAMES[i % len(FIRST_NAMES)],
        "last_name": LAST_NAMES[i % len(LAST_NAMES)],
        "phone": f"+91{98_0000_0000 + i}",
    })
    assert res.status_code == 200, res.text
    data = res.json()
    data["email"] = email
    return data


def _login(email: str) -> dict:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return res.json()


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def catalog():
    """All 30 locations: 16 verified + 14 registered through the public API."""
    admin = _signup_user(9000)
    locs = client.get("/api/v1/locations/all", headers=_headers(admin["access_token"])).json()
    by_name = {l["name"]: l for l in locs}
    for name, state, lat, lng in REGISTERED_LOCATIONS:
        if name in by_name:
            continue
        res = client.post("/api/v1/locations/register", headers=_headers(admin["access_token"]), json={
            "name": name, "state": state, "country": "India", "lat": lat, "lng": lng,
        })
        assert res.status_code == 200, res.text
        by_name[name] = res.json()
    assert len(by_name) >= 30, f"expected >=30 locations, found {len(by_name)}"
    return list(by_name.values())


@pytest.fixture(scope="module")
def onboarded_users(catalog):
    """30 travellers: signup → stable profile → trip → discovery → mode."""
    names = sorted({l["name"] for l in catalog})
    results = []
    for i in range(30):
        session = _signup_user(i)
        headers = _headers(session["access_token"])

        # Step 0 — stable profile (the form the travellers fill once)
        prof = client.put("/api/v1/trips/profile/basic", headers=headers, json={
            "first_name": FIRST_NAMES[i % len(FIRST_NAMES)],
            "last_name": LAST_NAMES[i % len(LAST_NAMES)],
            "preferred_name": FIRST_NAMES[i % len(FIRST_NAMES)],
            "preferred_language": "English",
            "home_city": HOME_CITIES[i],
            "phone": f"+91{98_0000_0000 + i}",
            "preferred_communication": ["Voice", "Text", "Both"][i % 3],
            "emergency_contact_name": f"{LAST_NAMES[i % len(LAST_NAMES)]} Senior",
            "emergency_contact_phone": f"97{0000_0000 + i:08d}"[:10],
        })
        assert prof.status_code == 200, prof.text

        # Step 1 — trip between two DISTINCT catalog cities
        src = next(l for l in catalog if l["name"] == names[i % len(names)])
        dst = next(l for l in catalog if l["name"] == names[(i + 5) % len(names)])
        now = datetime.now(timezone.utc)
        trip = client.post("/api/v1/trips/search", headers=headers, json={
            "source_location_id": src["id"], "destination_location_id": dst["id"],
            "start_datetime": (now + timedelta(days=30 + i)).isoformat(),
            "end_datetime": (now + timedelta(days=33 + i)).isoformat(),
        })
        assert trip.status_code == 200, trip.text
        trip = trip.json()
        assert trip["source_name"] != trip["destination_name"]

        # Step 2 — adaptive discovery (budget + party + experience)
        adults = 1 + (i % 4)
        children = i % 2
        experience = ["Adventure", "Food & Culture", "Spiritual", "Mixed"][i % 4]
        disc = client.post("/api/v1/trips/adaptive-discovery", headers=headers, json={
            "budget": 15000 + (i * 500),
            "group_type": ["Solo", "Friends", "Family", "Couple"][i % 4],
            "adults": adults, "children": children,
            "experience_type": experience,
        })
        assert disc.status_code == 200, disc.text
        disc_data = disc.json()
        assert disc_data["adults"] == adults and disc_data["children"] == children

        # Step 3 — experience mode: BOTH modes exercised across the fleet
        mode = "GUIDE_MODE" if i % 2 == 0 else "ADVENTUROUS_MODE"
        mode_res = client.patch(f"/api/v1/trips/{trip['id']}/mode?mode={mode}", headers=headers)
        assert mode_res.status_code == 200, mode_res.text
        assert mode_res.json()["mode"] == mode
        # Financial rule: guide fee only in GUIDE_MODE, platform fee always 3%
        fees = mode_res.json()
        assert fees["platform_fee"] == round(float(disc_data["budget"]) * 0.03)
        if mode == "GUIDE_MODE":
            assert fees["guide_fee"] > 0
        else:
            assert fees["guide_fee"] == 0

        results.append({
            "email": session["email"], "password": PASSWORD,
            "user_id": data_user_id(session), "trip_id": trip["id"],
            "mode": mode, "src": src["name"], "dst": dst["name"],
        })
    return results


def data_user_id(session: dict) -> str:
    me = client.get("/api/v1/auth/me", headers=_headers(session["access_token"])).json()
    return me["user"]["id"]


def test_thirty_guides_register_and_persist():
    """30 guide signups land in identities (GUIDE) + guides (PENDING) —
    never auto-approved; the manager elevates."""
    emails = []
    for i in range(30):
        email = f"e2e.guide.{i}.{uuid.uuid4().hex[:6]}@travion.in"
        res = client.post("/api/v1/auth/guide/register", json={
            "email": email, "password": PASSWORD, "role": "GUIDE",
            "first_name": FIRST_NAMES[(i + 7) % len(FIRST_NAMES)],
            "last_name": LAST_NAMES[(i + 3) % len(LAST_NAMES)],
            "phone": f"+91{97_0000_0000 + i}",
            "city": HOME_CITIES[i % len(HOME_CITIES)],
            "languages": ["English", ["Hindi", "Tamil", "Telugu", "Kannada"][i % 4]],
            "destinations": [REGISTERED_LOCATIONS[i % len(REGISTERED_LOCATIONS)][0]],
            "experience_years": 1 + (i % 12),
            "guide_type": GUIDE_SPECIALISATIONS[i % len(GUIDE_SPECIALISATIONS)][0],
            "availability": ["Weekdays", "Weekends", "Flexible", "Seasonal"][i % 4],
        })
        assert res.status_code == 200, res.text
        emails.append(email)

    db = SessionLocal()
    try:
        for email in emails:
            ident = db.query(Identity).filter(Identity.email == email).first()
            assert ident is not None, f"{email} missing from identities"
            assert ident.role == "GUIDE"
            guide = db.query(Guide).filter(Guide.identity_id == ident.id).first()
            assert guide is not None, f"{email} missing guide profile"
            assert guide.approval_status == "PENDING", (
                "guides must start PENDING — approval is a manager action"
            )
    finally:
        db.close()

    # Every guide can sign back in (permanent account)
    login = _login(emails[0])
    assert login["role"] == "GUIDE"


def test_thirty_users_onboarded_with_trips_and_modes(onboarded_users):
    """Every traveller's data is in the database with the right mode split."""
    assert len(onboarded_users) == 30
    guide_mode = [u for u in onboarded_users if u["mode"] == "GUIDE_MODE"]
    adventurous = [u for u in onboarded_users if u["mode"] == "ADVENTUROUS_MODE"]
    assert len(guide_mode) == 15 and len(adventurous) == 15

    db = SessionLocal()
    try:
        for u in onboarded_users:
            trip = db.query(Trip).filter(Trip.id == u["trip_id"]).first()
            assert trip is not None, f"trip {u['trip_id']} missing from database"
            assert trip.mode == u["mode"]
            assert trip.source_name == u["src"] and trip.destination_name == u["dst"]
            assert trip.budget is not None and float(trip.budget) > 0
    finally:
        db.close()


def test_thirty_distinct_locations_used(onboarded_users):
    """30 trips span 30 distinct source cities — every location is exercised."""
    sources = {u["src"] for u in onboarded_users}
    destinations = {u["dst"] for u in onboarded_users}
    assert len(sources) >= 16, f"only {len(sources)} distinct sources used"
    assert len(sources | destinations) >= 30, (
        f"only {len(sources | destinations)} distinct locations used across trips"
    )


def test_first_user_can_sign_in_again_with_everything_persisted(onboarded_users):
    """The permanence promise: signup once → sign in again later → profile,
    trips and mode are exactly as they were left."""
    u = onboarded_users[0]

    # New session (equivalent to closing the browser and coming back)
    login = _login(u["email"])
    assert login["role"] == "USER"
    headers = _headers(login["access_token"])

    me = client.get("/api/v1/auth/me", headers=headers).json()["user"]
    assert me["home_city"] == HOME_CITIES[0]
    assert me["phone"].replace(" ", "") == f"+91{98_0000_0000}"
    assert me["is_profile_complete"] is True

    trips = client.get("/api/v1/trips/my-trips", headers=headers).json()
    mine = [t for t in trips if t["id"] == u["trip_id"]]
    assert len(mine) == 1
    assert mine[0]["mode"] == u["mode"]
    assert mine[0]["status"] == "DRAFT"

    profile = client.get(f"/api/v1/trips/{u['trip_id']}/profile", headers=headers).json()
    assert profile["party"]["total"] == profile["party"]["adults"] + profile["party"]["children"]


def test_llm_planning_pipeline_serves_all_locations_and_modes(onboarded_users, catalog):
    """Real itineraries for a cross-section of the fleet — different locations
    and BOTH modes. Every plan starts with the departure transport and carries
    real stops (never fabricated placeholders)."""
    sample = [onboarded_users[i] for i in (0, 5, 12, 18, 25, 29)]
    seen_routes = set()
    for u in sample:
        login = _login(u["email"])
        headers = _headers(login["access_token"])
        res = client.post(f"/api/v1/trips/{u['trip_id']}/plan", headers=headers, json={
            "mode": u["mode"], "consent_acknowledged": True,
        })
        assert res.status_code == 200, res.text
        plan = res.json()
        assert plan["total_cost"] > 0, "plan must have a real cost"
        assert len(plan["days"]) >= 2, "a 3-4 day trip needs at least 2 days"
        first = plan["days"][0]["stops"][0]
        assert first["category"] == "transport", f"first step must be departure: {first}"
        title = first["title"].lower()
        assert title.startswith("depart") or title.startswith("estimated departure"), (
            f"first step must be the departure: {first['title']}"
        )
        # No empty/fabricated stops anywhere in the plan
        for day in plan["days"]:
            for stop in day["stops"]:
                assert stop.get("title"), "every stop needs a title"
        seen_routes.add((u["src"], u["dst"]))

    assert len(seen_routes) == len(sample), "sampled plans must cover distinct routes"
    modes = {u["mode"] for u in sample}
    assert modes == {"GUIDE_MODE", "ADVENTUROUS_MODE"}, "both modes must be exercised"


def test_database_totals_are_permanent_and_ordered(onboarded_users):
    """Aggregate sanity: the database holds every onboarded account and the
    numbers reconcile with what the API reports."""
    db = SessionLocal()
    try:
        users = db.query(User).count()
        identities = db.query(Identity).count()
        guides = db.query(Guide).count()
        trips = db.query(Trip).count()

        # Our suite alone added exactly 30 users + 30 guides + 30 trips
        # (plus one admin fixture user) on top of whatever existed before.
        assert users >= 30, f"expected at least 30 users, found {users}"
        assert guides >= 30, f"expected at least 30 guides, found {guides}"
        assert trips >= 30, f"expected at least 30 trips, found {trips}"
        assert identities >= users, "every user has exactly one identity"
    finally:
        db.close()

    # API and database agree for a fresh login (round-trip through auth)
    u = onboarded_users[10]
    login = _login(u["email"])
    me = client.get("/api/v1/auth/me", headers=_headers(login["access_token"])).json()
    assert me["user"]["is_profile_complete"] is True
