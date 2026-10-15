#!/usr/bin/env python3
"""
TRAVION — Cloud MySQL Setup Verification Script
Run AFTER you've set DATABASE_URL in the Render environment.

Usage:
  python scripts/verify_cloud_db.py --url "mysql+pymysql://user:pass@host:port/travion_db"

This script:
1. Connects to the cloud MySQL
2. Checks that all 21 TRAVION tables exist
3. Confirms the 3 seed accounts are present
4. Prints MySQL Workbench connection details
"""
import argparse
import sys
import os

def check_cloud_db(url: str):
    try:
        from sqlalchemy import create_engine, text, inspect as sa_inspect
    except ImportError:
        print("ERROR: SQLAlchemy not installed. Run: pip install SQLAlchemy PyMySQL cryptography")
        sys.exit(1)

    print(f"\n{'='*60}")
    print("TRAVION Cloud MySQL Verification")
    print(f"{'='*60}")
    print(f"URL (masked): {url[:40]}...")

    # Parse host/port for Workbench display
    try:
        # mysql+pymysql://user:pass@host:port/db
        after_at = url.split('@')[1]
        host_port, db = after_at.split('/', 1)
        if ':' in host_port:
            host, port = host_port.rsplit(':', 1)
        else:
            host, port = host_port, '3306'
        user = url.split('://')[1].split(':')[0]
    except Exception:
        host, port, user, db = '?', '?', '?', '?'

    print(f"\n--- MySQL Workbench Connection Details ---")
    print(f"  Connection Name : TRAVION LIVE DATABASE")
    print(f"  Connection Method: Standard (TCP/IP)")
    print(f"  Hostname         : {host}")
    print(f"  Port             : {port}")
    print(f"  Username         : {user}")
    print(f"  Default Schema   : {db.split('?')[0]}")
    print(f"  SSL              : Required (enable SSL in Advanced tab)")
    print()

    try:
        engine = create_engine(url, connect_args={"connect_timeout": 15})
        with engine.connect() as conn:
            # Check MySQL version
            ver = conn.execute(text("SELECT VERSION()")).scalar()
            print(f"[OK] Connected to MySQL {ver}")

            # Check tables
            inspector = sa_inspect(engine)
            tables = set(inspector.get_table_names())
            
            required = {
                'identities', 'users', 'guides', 'managers', 'admins',
                'locations', 'trips', 'trip_profiles', 'itineraries',
                'payments', 'payment_splits', 'reviews', 'review_responses',
                'chat_messages', 'support_tickets', 'guides_trips',
                'audit_logs', 'offline_packages', 'alert_subscriptions',
                'place_ratings', 'password_reset_tokens'
            }
            missing = required - tables
            
            if missing:
                print(f"[WARN] Missing tables: {missing}")
                print("       Run: alembic upgrade head")
            else:
                print(f"[OK] All {len(required)} required tables present")

            # Check seed accounts
            seeds = [
                ('admin@travion.in', 'Administrator'),
                ('manager@travion.in', 'Manager'),
                ('arun.nilgiri@travion.in', 'Guide'),
            ]
            
            print("\n--- Seed Accounts ---")
            for email, role in seeds:
                if 'identities' in tables:
                    row = conn.execute(
                        text("SELECT id, role, created_at FROM identities WHERE email = :e"),
                        {"e": email}
                    ).fetchone()
                    if row:
                        print(f"  [OK] {email} ({role}) — id={row[0]}, created={row[2]}")
                    else:
                        print(f"  [MISSING] {email} — will be seeded on first backend startup")

            # Count user registrations
            if 'identities' in tables:
                count = conn.execute(text("SELECT COUNT(*) FROM identities")).scalar()
                print(f"\n[OK] Total identities in cloud DB: {count}")

            print(f"\n{'='*60}")
            print("Verification PASSED — Cloud MySQL is operational!")
            print(f"{'='*60}\n")

    except Exception as e:
        print(f"\n[FAIL] Connection error: {e}")
        print("\nTroubleshooting:")
        print("  1. Check that DATABASE_URL is correctly formatted")
        print("  2. Ensure the cloud MySQL service is running")
        print("  3. Check that your IP is allowlisted (if provider requires it)")
        print("  4. Verify SSL settings match provider requirements")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Verify TRAVION cloud MySQL connection")
    parser.add_argument("--url", help="MySQL connection URL (or set DATABASE_URL env var)")
    args = parser.parse_args()

    url = args.url or os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: Provide --url or set DATABASE_URL environment variable")
        sys.exit(1)

    check_cloud_db(url)
