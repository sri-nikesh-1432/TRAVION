"""TRAVION end-to-end test-suite driver.

Runs the REAL, authenticated test suites (same ones CI runs) and prints a
human-readable summary. Unlike a network script this drives the app directly
through its FastAPI routes — signup → stable profile → trip → adaptive
discovery → both experience modes → LLM planning → re-login persistence —
and writes everything to the database the app is configured for:

  * SQLite (backend/travion.db) by default
  * MySQL when DATABASE_URL points at it, e.g.:

      set DATABASE_URL=mysql+pymysql://travion:travion_local_dev@127.0.0.1:3307/travion_db
      python run_test_suite.py

What it covers (tests/test_e2e_mass_users.py):
  1. 30 travellers onboarded — signup, stable profile, trip, discovery, mode
  2. 30 guides registered — PENDING approval, permanent accounts
  3. 30 distinct real locations (15 verified + 16 registered via public API)
  4. BOTH modes exercised with the exact fee rules (12.5% guide fee only in
     GUIDE_MODE, 3% platform fee always)
  5. Re-login persistence — first user signs in again, everything intact
  6. LLM/plan pipeline — real itineraries, departure-first ordering
  7. Database totals reconcile with the API

Plus the full regression suite (tests/) when run with --all.
"""
import subprocess
import sys


def main() -> int:
    args = sys.argv[1:]
    targets = ["tests/test_e2e_mass_users.py"] if "--all" not in args else ["tests/"]

    print("=" * 70)
    print("TRAVION END-TO-END TEST SUITE")
    print("  30 travellers · 30 guides · 30 locations · both modes · persistence")
    print("=" * 70)

    cmd = [sys.executable, "-m", "pytest", *targets, "-q", "--tb=short"]
    result = subprocess.run(cmd)

    print()
    print("=" * 70)
    if result.returncode == 0:
        print("RESULT: ALL TESTS PASSED — TRAVION is fully operational.")
        print("  - 30 users onboarded permanently (sign in any time)")
        print("  - 30 guides registered (PENDING manager approval)")
        print("  - 30 real locations, GUIDE_MODE + ADVENTUROUS_MODE verified")
        print("  - Fee rules exact: 12.5% guide / 3% platform / 15% safety")
    else:
        print("RESULT: FAILURES DETECTED — see pytest output above.")
    print("=" * 70)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
