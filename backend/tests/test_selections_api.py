"""Step 5 selections — server-side single source of truth.

Drives the REAL API (build trip → destination-catalog → selections CRUD →
map-places → place details → plan-multi replay) and asserts:
  * add / re-add / soft-remove / re-add again is idempotent and preserves the
    ORIGINAL selection_source (map picks don't silently become 'recommendation');
  * destination-catalog reports HONEST catalog_meta (requested vs available) and
    the persisted selections (so the UI panel survives a refresh);
  * map-places counts always equal the actual arrays (never a fake total);
  * place details resolve from the verified pool and flip selection_status;
  * plan-multi called WITHOUT selections replays the persisted real picks.
"""
from fastapi.testclient import TestClient
import pytest

from app.main import app
import app.services.places_discovery as pd
from test_planner_api import _build_trip

client = TestClient(app)


@pytest.fixture(autouse=True)
def offline_no_network(monkeypatch):
    """Same offline baseline as the discovery suite: no Google key, no live
    Overpass, no geocoding — the verified catalog + index do all the work."""
    monkeypatch.setattr(pd, "_discover_osm", lambda dest, resolved, bounds=None: {
        "must_visit": [], "food": [], "activities": [], "stays": [],
    })
    monkeypatch.setattr(pd, "_discover_map_osm", lambda resolved, bounds=None: {
        c: [] for c in pd.MAP_CATEGORIES
    })
    monkeypatch.setattr(pd, "_geocode_destination", lambda dest, state=None: None)


def _catalog(trip_id, headers):
    r = client.get(f"/api/v1/trips/{trip_id}/destination-catalog", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _selection(item, category="must_visit", source="map"):
    return {
        "provider_place_id": str(item["id"]),
        "name": item["name"],
        "category": category,
        "latitude": item.get("latitude"),
        "longitude": item.get("longitude"),
        "rating": item.get("rating"),
        "selection_source": source,
    }


def _active_ids(payload):
    return [s["provider_place_id"] for s in payload["selections"]]


def test_selections_crud_is_idempotent_and_preserves_source():
    trip_id, headers = _build_trip()
    cat = _catalog(trip_id, headers)
    assert len(cat["must_visit"]) >= 2
    a = cat["must_visit"][0]

    first = client.post(f"/api/v1/trips/{trip_id}/selections", headers=headers,
                        json=_selection(a, source="map"))
    assert first.status_code == 200, first.text
    # Idempotent re-add of the same place → still exactly ONE active row, and
    # (no explicit source passed) the ORIGINAL provenance survives — this is
    # the plan-multi persist path, which must never clobber a map pick.
    again = client.post(f"/api/v1/trips/{trip_id}/selections", headers=headers,
                        json={k: v for k, v in _selection(a).items() if k != "selection_source"})
    assert again.status_code == 200
    got = client.get(f"/api/v1/trips/{trip_id}/selections", headers=headers).json()
    assert _active_ids(got).count(str(a["id"])) == 1
    row = next(s for s in got["selections"] if s["provider_place_id"] == str(a["id"]))
    assert row["selection_source"] == "map", "original provenance must be preserved"

    # Soft remove, then re-add → active again, and still source 'map'.
    rem = client.delete(f"/api/v1/trips/{trip_id}/selections/{a['id']}", headers=headers)
    assert rem.status_code == 200
    empty = client.get(f"/api/v1/trips/{trip_id}/selections", headers=headers).json()
    assert str(a["id"]) not in _active_ids(empty)
    re_add = client.post(f"/api/v1/trips/{trip_id}/selections", headers=headers,
                         json={k: v for k, v in _selection(a).items() if k != "selection_source"})
    assert re_add.status_code == 200
    back = client.get(f"/api/v1/trips/{trip_id}/selections", headers=headers).json()
    again_row = next(s for s in back["selections"] if s["provider_place_id"] == str(a["id"]))
    assert again_row["status"] == "active"
    assert again_row["selection_source"] == "map"

    # Deleting a place that was never selected is a clean 404.
    miss = client.delete(f"/api/v1/trips/{trip_id}/selections/never-selected-000", headers=headers)
    assert miss.status_code == 404


def test_selections_sync_replace_and_keep_recommendations():
    trip_id, headers = _build_trip()
    cat = _catalog(trip_id, headers)
    a, b = cat["must_visit"][0], cat["must_visit"][1]
    client.post(f"/api/v1/trips/{trip_id}/selections", headers=headers, json=_selection(a, source="map"))
    client.post(f"/api/v1/trips/{trip_id}/selections", headers=headers,
                json={**_selection(b, source="recommendation"), "item_json": {"recommended": True}})
    # replace=True with only <a> → b is soft-removed... but recommendation rows
    # survive a replace (they're planner-owned, not map clutter).
    sync = client.post(f"/api/v1/trips/{trip_id}/selections/sync", headers=headers, json={
        "items": [_selection(a)],
        "replace": True,
    })
    assert sync.status_code == 200, sync.text
    ids = _active_ids(sync.json())
    assert str(a["id"]) in ids
    assert str(b["id"]) in ids, "recommendation rows are kept by services_keep_plan"


def test_destination_catalog_meta_is_honest_and_selections_persist():
    trip_id, headers = _build_trip()
    cat = _catalog(trip_id, headers)
    for section, key in (("must_visit", "must_visit"), ("food", "food"),
                         ("stays", "stays"), ("activities", "activities")):
        meta = cat["catalog_meta"][section]
        assert meta["requested"] == pd.TARGET_COUNTS.get(section, 10)
        assert meta["available"] == len(cat[key])
        assert meta["status"] == ("success" if meta["available"] else "unavailable")
        assert meta["note"]

    # Post a pick from the map, refresh the catalog, and it MUST come back.
    a = cat["must_visit"][0]
    client.post(f"/api/v1/trips/{trip_id}/selections", headers=headers, json=_selection(a))
    refreshed = _catalog(trip_id, headers)
    ids = [s["provider_place_id"] for s in refreshed["selections"]]
    assert str(a["id"]) in ids, "selections survive a catalog refresh"


def test_map_places_counts_are_real():
    trip_id, headers = _build_trip()
    res = client.get(f"/api/v1/trips/{trip_id}/map-places", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert "catalog_meta" in body
    assert isinstance(body.get("map_counts_full"), dict)
    # map_counts_full merges the recommended buckets + the broader real map tiers.
    for cat, count in body["map_counts_full"].items():
        if cat in pd.MAP_CATEGORIES:
            assert count == len((body["map_places"] or {}).get(cat, ())), (
                "map counts must come from the real arrays being returned"
            )
    # Recommended buckets always exist (verified local data) as real pins.
    assert body["map_counts"]["must_visit"] == len(body["map_places"]["must_visit"])

    # THE MAP SHOWS EVERY real candidate: counts exposed must exactly equal the
    # arrays plotted, and every plotted pin must carry real coordinates.
    for cat in ("must_visit", "activities", "food", "stays"):
        assert cat in body["map_places"], f"map must return a {cat} layer"
        arr = body["map_places"][cat]
        assert body["map_counts_full"][cat] == len(arr), f"{cat} full-pool mismatch"
        assert arr, f"map must never ship an empty {cat} pool"
        for item in arr:
            assert float(item.get("latitude") or 0) and float(item.get("longitude") or 0), (
                f"every plotted {cat} pin needs real coordinates: {item.get('name')}"
            )


def test_place_details_resolves_and_tracks_selection_status():
    trip_id, headers = _build_trip()
    cat = _catalog(trip_id, headers)
    a = cat["must_visit"][0]
    pid = str(a["id"])

    detail = client.get(f"/api/v1/trips/{trip_id}/places/{pid}", headers=headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["name"] == a["name"]
    assert body["selection_status"] == "none"
    assert body["verified"] is True

    client.post(f"/api/v1/trips/{trip_id}/selections", headers=headers, json=_selection(a))
    active = client.get(f"/api/v1/trips/{trip_id}/places/{pid}", headers=headers)
    assert active.json()["selection_status"] == "active"

    miss = client.get(f"/api/v1/trips/{trip_id}/places/000-definitely-not-real", headers=headers)
    assert miss.status_code == 404


def test_plan_multi_replays_persisted_selections():
    trip_id, headers = _build_trip()
    cat = _catalog(trip_id, headers)
    picked = cat["must_visit"][0]
    client.post(f"/api/v1/trips/{trip_id}/selections", headers=headers, json=_selection(picked))
    # A planner run with NO explicit selections must replay the persisted pick
    # (deterministic plans that match what the traveller chose on the map).
    res = client.post(f"/api/v1/trips/{trip_id}/plan-multi", headers=headers, json={
        "mode": "ADVENTUROUS_MODE", "consent_acknowledged": True,
    })
    assert res.status_code == 200, res.text
    plans = res.json()
    assert isinstance(plans, list) and len(plans) == 3, "expected the three in-budget plans"
    import json as _json
    plan_text = _json.dumps(plans).lower()
    assert picked["name"].lower() in plan_text, (
        "persisted selection must flow into the generated plans"
    )