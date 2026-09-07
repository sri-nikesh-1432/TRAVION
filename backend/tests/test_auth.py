"""Authentication hardening — END-TO-END guarantee suite.

The product rule (UNIVERSAL DESTINATION-MAP / AUTH spec):
  * signup stores ONE canonical email (trim + lowercase) and login wakes up
    that SAME account no matter what combination of spaces / case the user
    types — the notorious "login after signup" bug;
  * email uniqueness is enforced at the DATABASE level (functional unique
    index on lower(email)), not just in a `first()` check;
  * LOGIN NEVER CREATES AN ACCOUNT — an unknown email is a clean 401 with the
    identity count unchanged;
  * the session survives a refresh: /auth/me restores the identity (token is
    validated against the backend before access is granted);
  * logout clears the CLIENT token only — the account itself is never deleted.
"""
from datetime import datetime
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from fastapi.testclient import TestClient
from app.main import app
from app.core.db import engine, SessionLocal
from app.models.entities import Identity

client = TestClient(app)


def _uniq():
    return "".join(ch for ch in str(datetime.now().timestamp()) if ch.isalnum())[-10:]


def _count_identities(email: str) -> int:
    norm = (email or "").strip().lower()
    with engine.connect() as conn:
        return len(conn.execute(text("SELECT id FROM identities WHERE lower(email) = :e"), {"e": norm}).fetchall())


# ── ONE identity per email: signup normalizes, login finds it ───────────────

def test_signup_normalizes_email_and_login_wakes_same_account():
    """Nail the reported bug: signing up with `  Test@Example.COM  ` then
    logging in with test@example.com (or any case/spacing variant) must succeed
    against the SAME single account."""
    email = f"  SignUp_{_uniq()}@Example.COM  "
    raw = email.strip()
    s = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Norm", "last_name": "Check", "phone": "+919876543210",
    })
    assert s.status_code == 200, s.text
    body = s.json()
    assert body["email"] == raw.lower().strip(), "response must carry the canonical email"
    assert body["role"] == "USER"

    for variant in (raw, raw.lower(), raw.upper(), "  " + raw + "  "):
        lg = client.post("/api/v1/auth/login", json={"email": variant, "password": "Password123!"})
        assert lg.status_code == 200, f"login with {variant!r} failed: {lg.text}"
        assert lg.json()["email"] == body["email"]
        assert lg.json()["identity_id"] == body["identity_id"], "must be the SAME identity"
        assert lg.json()["role"] == "USER"

    assert _count_identities(raw) == 1, "exactly one account exists for that email"


def test_duplicate_signup_any_casing_is_rejected_and_never_creates_second_row():
    email = f"  Dup.{_uniq()}@Test.COM  "
    first = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Dup", "last_name": "One", "phone": "+919876543210",
    })
    assert first.status_code == 200
    dup = client.post("/api/v1/auth/signup", json={
        "email": email.strip().lower(), "password": "Password123!", "role": "USER",
        "first_name": "Dup", "last_name": "Two", "phone": "+919876543210",
    })
    assert dup.status_code == 400
    assert "already registered" in dup.json()["detail"].lower()
    assert _count_identities(email) == 1, "duplicate attempt must not grow the table"


def test_login_never_creates_an_account():
    email = f"ghost.{_uniq()}@test.com"
    lg = client.post("/api/v1/auth/login", json={"email": email, "password": "WrongPass123!"})
    assert lg.status_code == 401
    assert "register" in lg.json()["detail"].lower(), "unknown email must be told to register"
    assert _count_identities(email) == 0, "login must NEVER auto-create an account"


def test_wrong_password_is_distinct_401():
    email = f"wrongpw.{_uniq()}@test.com"
    client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Pw", "last_name": "Check", "phone": "+919876543210",
    })
    lg = client.post("/api/v1/auth/login", json={"email": email, "password": "NotThePassword"})
    assert lg.status_code == 401
    assert "password" in lg.json()["detail"].lower()


# ── Session persistence across refresh via /auth/me ─────────────────────────

def test_session_persists_across_refresh_via_me():
    email = f"persist.{_uniq()}@test.com"
    s = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Keep", "last_name": "Me", "phone": "+919876543210",
    })
    token = s.json()["access_token"]

    # Simulate a browser REFRESH: the SAME token is validated against /auth/me.
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    assert me.json()["email"] == email.lower().strip()
    assert me.json()["identity_id"] == s.json()["identity_id"]

    # A re-login (fresh token) resolves back to that same identity too.
    lg = client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    me2 = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {lg.json()['access_token']}"})
    assert me2.json()["identity_id"] == s.json()["identity_id"]


def test_expired_token_is_rejected_on_me():
    """A token the backend cannot validate must NOT restore a session."""
    me = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer definitely-not-a-real-token"})
    assert me.status_code == 401


# ── Logout clears the client token; the ACCOUNT survives ────────────────────

def test_logout_never_deletes_the_account():
    email = f"logout.{_uniq()}@test.com"
    s = client.post("/api/v1/auth/signup", json={
        "email": email, "password": "Password123!", "role": "USER",
        "first_name": "Bye", "last_name": "Not", "phone": "+919876543210",
    })
    token = s.json()["access_token"]
    # "Logout" = discarding the token (client-side). No account deletion happens.
    still_works = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert still_works.status_code == 200
    assert _count_identities(email) == 1, "account must still exist after logout"


# ── Database-level uniqueness (the app-layer first() check is NOT the gate) ─

def test_database_enforces_email_uniqueness_case_insensitively():
    """Even a raw INSERT bypassing the API is rejected: a functional unique
    index on lower(email) is the real guard."""
    import uuid
    email = f"DbDup.{_uniq()}@DbTest.com"
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO identities (id, email, hashed_password, role) VALUES (:id, :e, :h, 'USER')"),
                     {"id": str(uuid.uuid4()), "e": email.lower(), "h": "hash"})
    try:
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO identities (id, email, hashed_password, role) VALUES (:id, :e, :h, 'USER')"),
                         {"id": str(uuid.uuid4()), "e": email.upper(), "h": "hash2"})
        assert False, "the second, case-differing row must be refused by the database"
    except IntegrityError:
        pass
    assert _count_identities(email) == 1


def test_identity_unique_index_exists():
    with engine.connect() as conn:
        indexes = conn.execute(text("PRAGMA index_list('identities')")).fetchall()
    names = [r[1] for r in indexes]
    assert "ix_identities_email_norm" in names, "functional unique index missing"


# ── GUIDES: normalized too ──────────────────────────────────────────────────

def test_guide_register_and_login_share_one_identity():
    email = f"  Guide.{_uniq()}@Trip.com  "
    raw = email.strip()
    rg = client.post("/api/v1/auth/guide/register", json={
        "email": email, "password": "Password123!", "first_name": "Tour", "last_name": "Lead",
        "phone": "+919876543210", "city": "Goa", "languages": ["English"],
        "destinations": ["Goa"], "experience_years": 3, "guide_type": "Local",
        "availability": "weekends",
    })
    assert rg.status_code == 200, rg.text
    assert rg.json()["role"] == "GUIDE"
    assert rg.json()["email"] == raw.lower().strip()
    lg = client.post("/api/v1/auth/login", json={"email": raw.upper() + " ", "password": "Password123!"})
    assert lg.status_code == 200
    assert lg.json()["email"] == rg.json()["email"]
    assert _count_identities(raw) == 1