# -*- coding: utf-8 -*-
"""LIVE discovery smoke: real Gemini search-intents + GeoApify verification.

Deliberately runs WITHOUT the test stubs (real .env keys) and drives the actual
API like the frontend does. Verifies for a major city AND a small town:
  * destination-catalog returns only `verified: true` real places;
  * map-places contains all 9 map categories with counts == array lengths;
  * the Gemini intent tier surfaces provider-verified shopping/healthcare/etc.
    POIs instead of zeros, and never invents anything.
Run from backend/:  python smoke_discovery.py
"""
import sys, time
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

FAILS = []
OKS = []


def check(name, cond, extra=""):
    if cond:
        OKS.append(name)
    else:
        FAILS.append(f"{name} :: {str(extra)[:300]}")


def build_trip(header_prefix, dest_spec):
    s = client.post("/api/v1/auth/signup", json={
        "email": f"{header_prefix}_{int(time.time())}@test.com", "password": "Password123!",
        "role": "USER", "first_name": "Smoke", "last_name": "Test", "phone": "+919876543210",
    })
    tok = s.json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}
    hub = next(x for x in client.get("/api/v1/locations/all", headers=headers).json() if x["name"] == "Bangalore")
    reg = client.post("/api/v1/locations/register", headers=headers, json=dest_spec)
    assert reg.status_code == 200, reg.text
    now = datetime.now(timezone.utc)
    trip = client.post("/api/v1/trips/search", headers=headers, json={
        "source_location_id": hub["id"], "destination_location_id": reg.json()["id"],
        "start_datetime": (now + timedelta(days=3)).isoformat(),
        "end_datetime": (now + timedelta(days=6)).isoformat(),
    }).json()
    q = client.post(f"/api/v1/trips/{trip['id']}/discovery/next", headers=headers, json={
        "answers_so_far": {
            "budget": "₹15,000 - ₹25,000", "party": "Solo",
            "experience": ["Food & Culture"], "food_pref": ["Local Traditional Only"],
            "stay_pref": "3 Star Cozy Boutique", "transport_pref": "AC Sleeper Bus",
            "pace": "Balanced", "walking_tolerance": "Moderate",
            "priority": ["Unique Local Experiences"],
        },
    })
    assert q.status_code == 200 and q.json()["is_complete"], q.text
    return trip["id"], headers


def probe(name, trip_id, headers):
    t0 = time.time()
    cat = client.get(f"/api/v1/trips/{trip_id}/destination-catalog", headers=headers)
    c = cat.json() if cat.status_code == 200 else {}
    check(f"{name}: destination-catalog 200", cat.status_code == 200, c.get("detail"))
    if cat.status_code == 200:
        for k in ("must_visit", "food", "stays"):
            items = c.get(k) or []
            check(f"{name}: catalog {k} verified & real",
                  len(items) > 0 and all(i.get("verified") is True and i.get("latitude") is not None for i in items),
                  {k: len(items)})
        meta = c.get("catalog_meta") or {}
        cats_meta = [k for k in ("must_visit", "food", "stays", "activities") if meta.get(k)]
        honest = all(
            meta[k].get("available", 0) == len(c.get(k) or []) and meta[k].get("status") == "success"
            for k in cats_meta
        ) and cats_meta
        check(f"{name}: catalog_meta honest per-category", honest, meta)

    mp = client.get(f"/api/v1/trips/{trip_id}/map-places", headers=headers)
    m = mp.json() if mp.status_code == 200 else {}
    check(f"{name}: map-places 200", mp.status_code == 200, m.get("detail"))
    if mp.status_code == 200:
        cats = ["must_visit", "activities", "food", "stays",
                "shopping", "healthcare", "education", "transport", "other"]
        missing = [k for k in cats if k not in (m.get("map_counts_full") or {})]
        check(f"{name}: all 9 map categories present", not missing, missing)
        counts = m.get("map_counts_full") or {}
        places = m.get("map_places") or {}
        mismatched = {k: (counts.get(k), len(places.get(k) or [])) for k in cats
                      if counts.get(k, 0) != len(places.get(k) or [])}
        check(f"{name}: map counts == array lengths", not mismatched, mismatched)
        bad = [i for k in cats for i in (places.get(k) or [])
               if not i.get("verified") or i.get("latitude") is None or i.get("longitude") is None]
        check(f"{name}: every marker verified + has coords", not bad, bad[:2])
        total = sum(counts.get(k, 0) for k in cats)
        check(f"{name}: map has real markers (total={total})", total > 0, counts)
        for k in ("shopping", "healthcare", "education", "transport", "other"):
            if counts.get(k):
                sample = (places.get(k) or [])[0]
                check(f"{name}: {k} marker comes from live provider",
                      sample.get("source") in ("geoapify", "google", "osm", "geonames"), sample)
        src = m.get("discovery_source")
        check(f"{name}: discovery_source attributed", src in ("geoapify", "google", "osm", "vercel_geocoding_geoapify"), src)
    print(f"  {name}: {time.time()-t0:.1f}s (catalog {cat.status_code}, map {mp.status_code})")


def main():
    print("== LIVE discovery smoke: real Gemini intents + GeoApify verification ==")
    hyd = build_trip("hyd", {"name": "Hyderabad", "state": "Telangana", "country": "India", "lat": 17.3850, "lng": 78.4867})
    probe("Hyderabad", *hyd)
    ong = build_trip("ong", {"name": "Ongole", "state": "Andhra Pradesh", "country": "India", "lat": 15.5057, "lng": 80.0499})
    probe("Ongole", *ong)

    print("=" * 60)
    print(f"PASS {len(OKS)}  |  FAIL {len(FAILS)}")
    for o in OKS:
        print("  ok:", o)
    for f in FAILS:
        print("  FAIL:", f)
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()