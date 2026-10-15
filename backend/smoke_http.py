"""True HTTP smoke test of the fixed TRAVION endpoints against the RUNNING
server (127.0.0.1:8002, MySQL backend) — exactly what the browser does:
  signup -> login -> Save & Continue profile form -> trip search ->
  adaptive discovery -> plan (LLM routing) -> re-login persistence.
"""
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

BASE = "http://127.0.0.1:8002/api/v1"
PASS = []
FAIL = []


def call(method, path, body=None, token=None, retries=0):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.status, json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            payload = e.read().decode()
            try:
                return e.code, json.loads(payload)
            except Exception:
                return e.code, {"raw": payload}
        except Exception:
            if attempt == retries:
                raise
            time.sleep(2)


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail and not cond else ""))


def main():
    print("=" * 72)
    print("TRAVION HTTP SMOKE TEST — running server, MySQL backend")
    print("=" * 72)

    stamp = int(time.time())
    email = f"smoke.user.{stamp}@travion.in"

    # 1. Signup
    st, s = call("POST", "/auth/signup", {
        "email": email, "password": "SmokeTest1!", "role": "USER",
        "first_name": "Datta", "last_name": "Chinta", "phone": "+918309594383",
    })
    check("signup returns 200 + token", st == 200 and "access_token" in s, str(s))
    token = s.get("access_token")

    # 2. Login again (fresh session)
    st, lg = call("POST", "/auth/login", {"email": email, "password": "SmokeTest1!"})
    check("login returns 200 + token", st == 200 and "access_token" in lg, str(lg))
    token = lg.get("access_token", token)

    # 3. THE FIX: Save & Continue profile form (PUT /trips/profile/basic)
    st, prof = call("PUT", "/trips/profile/basic", {
        "first_name": "Datta Srinikesh", "last_name": "Chinta",
        "preferred_name": "Datta Srinikesh", "preferred_language": "English",
        "home_city": "Hyderabad", "phone": "+918309594383",
        "preferred_communication": "Voice",
        "emergency_contact_name": "Datta Srinikesh Chinta",
        "emergency_contact_phone": "8309594383",
    }, token)
    check("Save & Continue profile form (PUT /profile/basic) = 200", st == 200, json.dumps(prof))

    # mandatory-field guards still enforced (canonical contract: required
    # name fields present, home_city absent -> handler-level 400)
    st400, body400 = call("PUT", "/trips/profile/basic",
                          {"first_name": "Datta", "last_name": "Chinta",
                           "preferred_language": "English", "phone": "+918309594383"},
                          token)
    detail400 = str(body400.get("detail", "")).lower()
    check("missing home_city rejected with 400 + friendly detail",
          st400 == 400 and "home city" in detail400, f"{st400} {body400}")

    # 4. Profile persisted after re-login (new session)
    st, lg2 = call("POST", "/auth/login", {"email": email, "password": "SmokeTest1!"})
    token2 = lg2.get("access_token")
    st, me = call("GET", "/auth/me", token=token2)
    u = me.get("user", {})
    check("profile persisted across sessions", st == 200 and u.get("home_city") == "Hyderabad"
          and u.get("is_profile_complete") is True, json.dumps(u))

    # 5. Trip search (canonical JSON contract)
    st, locs = call("GET", "/locations/all", token=token2)
    by_name = {l["name"]: l for l in locs}
    check("verified journey-ready hubs served", len(by_name) >= 15, f"{len(by_name)} hubs")
    # The extended 30-location catalog (registered places) must be searchable
    # and usable for trips even though /all only markets verified hubs.
    st, found = call("GET", "/locations/search?q=tawang", token=token2)
    check("registered extended-catalog place searchable (Tawang)",
          st == 200 and any(l["name"].lower() == "tawang" for l in found), str(found)[:200])
    src, dst = by_name.get("Bangalore"), by_name.get("Ooty")
    if not (src and dst):
        src, dst = found[0], found[-1]
    now = datetime.now(timezone.utc)
    st, trip = call("POST", "/trips/search", {
        "source_location_id": src["id"], "destination_location_id": dst["id"],
        "start_datetime": (now + timedelta(days=10)).isoformat(),
        "end_datetime": (now + timedelta(days=13)).isoformat(),
    }, token2)
    check("trip search creates DRAFT trip", st == 200 and trip.get("status") == "DRAFT"
          and trip.get("source_name") == "Bangalore", json.dumps(trip))

    # 6. Adaptive discovery (Step 2)
    st, disc = call("POST", "/trips/adaptive-discovery", {
        "budget": 25000, "group_type": "Family", "adults": 4, "children": 2,
        "experience_type": "Food & Culture", "language": "Telugu",
    }, token2)
    check("adaptive discovery persists party+budget", st == 200
          and disc.get("total_travellers") == 6 and disc.get("party_type") == "Family",
          json.dumps(disc))

    # 7. Resume contract: profile endpoint returns questions_answers
    st, rp = call("GET", f"/trips/{trip['id']}/profile", token=token2)
    check("GET /trips/{id}/profile keeps questions_answers contract", st == 200
          and rp.get("party", {}).get("adults") == 4 and float(rp.get("budget", {}).get("max", 0)) >= 25000,
          json.dumps(rp))

    # 8. Mode set with exact fee rules
    st, fees = call("PATCH", f"/trips/{trip['id']}/mode?mode=GUIDE_MODE", token=token2)
    check("GUIDE_MODE: 12.5% guide fee + 3% platform fee", st == 200
          and fees.get("guide_fee") == 3125.0 and fees.get("platform_fee") == 750.0,
          json.dumps(fees))
    st, fees2 = call("PATCH", f"/trips/{trip['id']}/mode?mode=ADVENTUROUS_MODE", token=token2)
    check("ADVENTUROUS_MODE: zero guide fee, 3% platform stays", st == 200
          and fees2.get("guide_fee") == 0.0 and fees2.get("platform_fee") == 750.0,
          json.dumps(fees2))

    # 9. LLM routing / interview contract across locations
    st, q = call("POST", f"/trips/{trip['id']}/discovery/next", {"answers_so_far": {}}, token2)
    check("discovery interview (LLM routing) serves question 1", st == 200 and not q.get("is_complete"),
          json.dumps(q))

    # 10. Real plan generated (LLM/heuristic pipeline)
    st, plan = call("POST", f"/trips/{trip['id']}/plan",
                    {"mode": "GUIDE_MODE", "consent_acknowledged": True}, token2, retries=3)
    ok = st == 200 and plan.get("total_cost", 0) > 0 and len(plan.get("days", [])) >= 2
    first = (plan.get("days") or [{}])[0].get("stops", [{}])[0].get("title", "") if ok else ""
    check("plan generated with departure-first itinerary", ok and
          first.lower().startswith(("depart", "estimated departure")), str(plan)[:300])

    # 11. my-trips reflects everything (permanent record)
    st, my = call("GET", "/trips/my-trips", token=token2)
    check("trip visible in my-trips after all steps", st == 200
          and any(t["id"] == trip["id"] for t in my), f"{len(my) if isinstance(my, list) else my} trips")

    print("=" * 72)
    print(f"RESULT: {len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("FAILED:", *FAIL, sep="\n  - ")
    print("=" * 72)
    return 1 if FAIL else 0


if __name__ == "__main__":
    for i in range(30):
        try:
            req = urllib.request.Request("http://127.0.0.1:8002/api/v1/locations/all")
            with urllib.request.urlopen(req, timeout=3):
                break
        except urllib.error.HTTPError:
            break  # server answered (even 401/404) — it is up
        except Exception:
            time.sleep(2)
    else:
        print("SERVER NOT UP on 127.0.0.1:8002")
        sys.exit(2)
    sys.exit(main())
