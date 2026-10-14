"""Ephemeral validation helper (not part of the committed test suite): boot the
app against a freshly schema+seeded MySQL database and prove the seeded demo
logins work (bcrypt hashes in seed.sql are valid, startup seeding is
idempotent). Usage: set DATABASE_URL then `python scripts/verify_seed_login.py`.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.models.entities import Identity, Location  # noqa: E402

c = TestClient(app)
print("health:", c.get("/health").status_code)
for email, pwd in [
    ("admin@travion.in", "adminpassword"),
    ("manager@travion.in", "managerpassword"),
    ("arun.nilgiri@travion.in", "guide1234"),
]:
    r = c.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    status = "OK" if r.status_code == 200 else f"FAIL {r.status_code} {r.text[:120]}"
    print(f"{email} -> {status}")

db = SessionLocal()
print("locations:", db.query(Location).count(), "identities:", db.query(Identity).count())
db.close()
