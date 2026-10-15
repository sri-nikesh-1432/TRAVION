#!/usr/bin/env python3
"""
TRAVION — Apply Schema to Cloud MySQL
Runs the Alembic migration chain against any DATABASE_URL.

Usage:
  python scripts/apply_schema_to_cloud.py --url "mysql+pymysql://user:pass@host:port/db"

Or set DATABASE_URL env var and just run:
  python scripts/apply_schema_to_cloud.py
"""
import argparse
import os
import sys
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", help="MySQL connection URL")
    args = parser.parse_args()

    url = args.url or os.environ.get("DATABASE_URL", "")
    if not url:
        print("ERROR: Set DATABASE_URL or pass --url")
        sys.exit(1)

    # Set env for alembic
    env = os.environ.copy()
    env["DATABASE_URL"] = url

    backend_dir = os.path.join(os.path.dirname(__file__), "..")
    backend_dir = os.path.abspath(backend_dir)

    print(f"\nApplying Alembic migrations to: {url[:45]}...")
    print(f"Backend dir: {backend_dir}\n")

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend_dir,
        env=env,
    )

    if result.returncode != 0:
        print("\nERROR: Alembic migration failed.")
        print("Check that DATABASE_URL is correct and the MySQL server is reachable.")
        sys.exit(1)

    print("\nSchema applied successfully!")
    print("Run verify_cloud_db.py to confirm tables and seed accounts.")


if __name__ == "__main__":
    main()
