#!/usr/bin/env python3
"""
TRAVION — Live Cloud Database Real-Time Monitor
Watch new users, logins, and trips as they are created on travions.netlify.app.
"""
import time
import os
import sys

try:
    from sqlalchemy import create_engine, text
except ImportError:
    print("Run: pip install sqlalchemy pymysql")
    sys.exit(1)

URL = os.environ.get("DATABASE_URL")
if not URL:
    # Try loading from backend/.env
    _env_file = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(_env_file):
        for line in open(_env_file):
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                URL = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
if not URL:
    print("ERROR: Set DATABASE_URL env var or add it to backend/.env")
    sys.exit(1)

def main():
    engine = create_engine(URL, connect_args={"ssl": {}}, pool_pre_ping=True)
    print("=" * 65)
    print("TRAVION LIVE CLOUD DATABASE MONITOR (Aiven MySQL 8.4)")
    print("Host: travion-mysql-travion-project.l.aivencloud.com:14577")
    print("Connected! Listening for new account creations and trips...")
    print("=" * 65)

    seen_ids = set()

    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, email, role, created_at FROM identities ORDER BY created_at DESC")
        ).fetchall()
        print(f"\n[CURRENT USERS IN CLOUD DATABASE: {len(rows)}]")
        for r in rows:
            seen_ids.add(r[0])
            print(f"  - {r[1]} ({r[2]}) | Created: {r[3]}")
        print("\nMonitoring for updates (Press Ctrl+C to stop)...\n")

    while True:
        try:
            time.sleep(3)
            with engine.connect() as conn:
                rows = conn.execute(
                    text("SELECT id, email, role, created_at FROM identities ORDER BY created_at DESC")
                ).fetchall()
                for r in rows:
                    if r[0] not in seen_ids:
                        seen_ids.add(r[0])
                        print(f"\n*** NEW REGISTRATION DETECTED! ***")
                        print(f"  Email:      {r[1]}")
                        print(f"  Role:       {r[2]}")
                        print(f"  Created At: {r[3]}")
                        print(f"  ID:         {r[0]}\n")
        except KeyboardInterrupt:
            print("\nStopped.")
            break
        except Exception as e:
            time.sleep(3)

if __name__ == "__main__":
    main()
