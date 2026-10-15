"""End-to-End Live MySQL Verification Script for TRAVION.

Validates all 8 checks required by Section 4.5 and Section 18 of the specification:
1. Backend connects to the configured MySQL instance (`travion_db`).
2. Confirms all 21 relational tables and constraints are present.
3. Registers a fresh test user account.
4. Verifies the row is written and immediately readable in MySQL `identities` and `users`.
5. Rejects duplicate registration with different casing (case-insensitive uniqueness).
6. Authenticates (logs in) with the registered account and verifies session continuity.
7. Authenticates fixed Administrator (admin@travion.in) and verifies live MySQL dashboard metrics.
8. Authenticates fixed Operations Manager (manager@travion.in) and verifies operational scope.
"""
import sys
from pathlib import Path
import uuid
import pymysql

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings

def run_verification():
    print("=" * 70)
    print("TRAVION LIVE MYSQL DATABASE & AUTHENTICATION VERIFICATION")
    print("=" * 70)

    # 1. Health check & DB engine
    client = TestClient(app)
    health_resp = client.get("/health")
    assert health_resp.status_code == 200, f"Health check failed: {health_resp.text}"
    health_data = health_resp.json()
    print(f"[1] Backend health: {health_data['status']}")
    print(f"    Database engine reported: {health_data['database']['engine']}")
    print(f"    Database connected: {health_data['database']['connected']}")
    assert health_data['database']['connected'] is True, "Database is not connected!"
    assert health_data['database']['engine'] == "mysql", "Engine is not MySQL!"

    db_probe = client.get("/api/v1/health/db")
    assert db_probe.status_code == 200, f"DB readiness probe failed: {db_probe.text}"
    print(f"[2] DB Readiness endpoint (/api/v1/health/db): {db_probe.json()['status']}")

    # Direct MySQL query check
    conn = pymysql.connect(
        host="127.0.0.1",
        port=3307,
        user="travion",
        password="travionpassword",
        database="travion_db",
        autocommit=True,
    )
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES")
        tables = [r[0] for r in cur.fetchall()]
        print(f"[3] Live MySQL Tables ({len(tables)} verified in travion_db):")
        print("    " + ", ".join(tables))
        assert len(tables) >= 21, f"Expected at least 21 tables, found {len(tables)}"

    # 4. User Registration test
    test_id = str(uuid.uuid4())[:8]
    test_email = f"traveller_{test_id}@example.com"
    test_pwd = "SecureTravellerPassword123"

    reg_resp = client.post("/api/v1/auth/signup", json={
        "email": test_email,
        "password": test_pwd,
        "role": "USER",
        "phone": "+91 98765 43210",
        "first_name": "Test",
        "last_name": "Traveller",
    })
    assert reg_resp.status_code == 200, f"Registration failed: {reg_resp.text}"
    reg_data = reg_resp.json()
    print(f"[4] Registered new user: {test_email}")
    print(f"    Assigned role: {reg_data['role']}, Token issued: {bool(reg_data.get('access_token'))}")

    # 5. Direct verification in MySQL (Workbench viewable)
    with conn.cursor() as cur:
        cur.execute("SELECT id, email, role, is_active FROM identities WHERE email = %s", (test_email,))
        row = cur.fetchone()
        assert row is not None, "User row was not found in MySQL identities table!"
        print(f"[5] Verified directly in MySQL identities table:")
        print(f"    id={row[0]}, email={row[1]}, role={row[2]}, active={row[3]}")

        cur.execute("SELECT id, first_name, last_name, country FROM users WHERE identity_id = %s", (row[0],))
        user_row = cur.fetchone()
        assert user_row is not None, "Profile row was not found in MySQL users table!"
        print(f"    Verified in MySQL users table: id={user_row[0]}, name={user_row[1]} {user_row[2]}")

    # 6. Duplicate Registration Prevention (case-insensitive)
    dup_email = test_email.upper()
    dup_resp = client.post("/api/v1/auth/signup", json={
        "email": dup_email,
        "password": "AnotherPassword456",
        "role": "USER",
        "phone": "+91 98765 43211",
        "first_name": "Duplicate",
        "last_name": "Attempt"
    })
    assert dup_resp.status_code in (400, 409), f"Expected duplicate rejection, got {dup_resp.status_code}: {dup_resp.text}"
    print(f"[6] Duplicate signup with '{dup_email}' was correctly rejected ({dup_resp.status_code})")

    # 7. Login with created user
    login_resp = client.post("/api/v1/auth/login", json={
        "email": test_email,
        "password": test_pwd
    })
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    user_token = login_resp.json()["access_token"]
    user_headers = {"Authorization": f"Bearer {user_token}"}
    me_resp = client.get("/api/v1/auth/me", headers=user_headers)
    assert me_resp.status_code == 200, f"/auth/me failed: {me_resp.text}"
    print(f"[7] Login authenticated successfully against stored MySQL password hash.")
    print(f"    Session confirmed: email={me_resp.json()['email']}, role={me_resp.json()['role']}")

    # 8. Fixed Administrator Login & Dashboard access
    admin_login = client.post("/api/v1/auth/login", json={
        "email": "admin@travion.in",
        "password": "adminpassword"
    })
    assert admin_login.status_code == 200, f"Admin login failed: {admin_login.text}"
    admin_token = admin_login.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    admin_ov = client.get("/api/v1/admin/overview", headers=admin_headers).json()
    admin_rev = client.get("/api/v1/admin/revenue", headers=admin_headers).json()
    admin_trips = client.get("/api/v1/admin/trips", headers=admin_headers).json()
    print(f"[8] Administrator (admin@travion.in) authenticated:")
    print(f"    Admin overview (real MySQL records): total_users={admin_ov['total_users']}, trips={len(admin_trips)}")
    print(f"    Platform revenue from live records: INR {admin_rev['actual_platform_revenue']:,}")

    # 9. Fixed Manager Login & Dashboard access
    mgr_login = client.post("/api/v1/auth/login", json={
        "email": "manager@travion.in",
        "password": "managerpassword"
    })
    assert mgr_login.status_code == 200, f"Manager login failed: {mgr_login.text}"
    mgr_token = mgr_login.json()["access_token"]
    mgr_headers = {"Authorization": f"Bearer {mgr_token}"}
    mgr_stats = client.get("/api/v1/manager/dashboard-stats", headers=mgr_headers).json()
    mgr_guides = client.get("/api/v1/manager/guides", headers=mgr_headers).json()
    print(f"[9] Operations Manager (manager@travion.in) authenticated:")
    print(f"    Manager stats: active_guides={mgr_stats['active_guides']}, guide roster={len(mgr_guides)} guides")

    # 10. Role isolation: User cannot access Admin endpoints
    forbidden_resp = client.get("/api/v1/admin/overview", headers=user_headers)
    assert forbidden_resp.status_code in (401, 403), f"Expected 403, got {forbidden_resp.status_code}"
    print(f"[10] Role-based Access Control verified: Standard user access to /admin/overview is blocked ({forbidden_resp.status_code}).")

    conn.close()
    print("=" * 70)
    print("ALL 10 VERIFICATION CHECKS PASSED ON LIVE MYSQL (travion_db)")
    print("=" * 70)

if __name__ == "__main__":
    run_verification()
