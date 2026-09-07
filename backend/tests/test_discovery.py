"""Destination discovery tests — REAL PLACES ONLY, DESTINATION-WIDE.

Covers:
  * name resolution robustness (Cochin→Kochi, Dharamshala, Kanyakumari)
  * the Manali wrong-state bug (Tamil Nadu vs Himachal Pradesh)
  * DESTINATION-WIDE discovery: the destination is searched as a whole area
    (bounding box / destination kind radius) — NOT a 2 km circle around the
    centre. A famous attraction outside the core but inside the destination is
    still a legitimate result.
  * the 2 km rule belongs ONLY to NEARBY mode (places near a specific spot),
    where it is enforced hard.
  * destination-first ranking: inside-core places always outrank broader
    destination places within every bucket.
  * pool targets: up to 10 places / 10 activities / 7 restaurants / 7 stays.
  * nothing is ever invented: ratings, addresses, stars and prices come only
    from real sources.
Network tiers (Google/Overpass/geocoding) are mocked out so the tests are
offline and deterministic; the geonames index + verified catalog are real local
data.
"""
import pytest

import app.services.places_discovery as pd


@pytest.fixture(autouse=True)
def offline_no_network(monkeypatch):
    """No Google key, no live Overpass, no geocoding — the geonames index +
    verified catalog (real local data) do all the work, deterministically."""
    monkeypatch.setattr(pd, "_discover_osm", lambda dest, resolved, bounds=None: {
        "must_visit": [], "food": [], "activities": [], "stays": [],
    })
    monkeypatch.setattr(pd, "_geocode_destination", lambda dest, state=None: None)


def test_index_has_all_our_test_destinations():
    names = [p["name"] for p in pd.INDIA_PLACES]
    assert "Puducherry" in names
    assert "Ooty" in names
    assert "Kochi" in names
    assert "Dharamsala" in names
    assert "Kanniyakumari" in names


# ── resolution ──────────────────────────────────────────────────────────────

def test_resolution_catalog():
    assert pd._resolve_destination("Pondicherry")["name"] == "Puducherry"
    assert pd._resolve_destination("Cochin")["name"] == "Kochi"
    assert pd._resolve_destination("Ooty")["name"] == "Ooty"
    assert pd._resolve_destination("Jaipur")["name"] == "Jaipur"
    assert pd._resolve_destination("Dharamshala")["name"] == "Dharamsala"
    assert pd._resolve_destination("Kanyakumari")["name"] == "Kanniyakumari"
    assert pd._resolve_destination("North Goa", state="Goa")["name"] == "North Goa"


def test_manali_state_disambiguation():
    """Manali exists in BOTH Tamil Nadu and Himachal Pradesh — the traveller's
    registered state/coords must decide, not the first list entry."""
    hp = pd._resolve_destination("Manali", state="Himachal Pradesh")
    tn = pd._resolve_destination("Manali", state="Tamil Nadu")
    assert hp["state"] == "Himachal Pradesh"
    assert tn["state"] == "Tamil Nadu"
    # And coordinates also pick the nearby one.
    by_coords = pd._resolve_destination("Manali", coords=(32.2432, 77.1892))
    assert by_coords["state"] == "Himachal Pradesh"


# ── pipeline returns REAL places for any destination ───────────────────────

@pytest.mark.parametrize("name", ["Puducherry", "Chennai", "Ooty", "Dharamshala"])
def test_discovery_returns_real_places(name):
    result = pd.discover_destination(name, preferences={"interests": ["culture"]})
    assert result["must_visit"], f"{name} must_visit should never be empty"
    for item in result["must_visit"]:
        assert item["name"], "place names come from real sources"
        assert item["source"] in {
            "google_places", "openstreetmap", "verified_api",
            "geonames_local_index", "guide_submitted",
        }


def test_discovery_unindexed_name_via_coords_surfaces_real_places():
    """'Dharamshala' with registered coords must surface real places even when
    the exact gazetteer spelling is not indexed. This is the 'empty sections' fix."""
    result = pd.discover_destination("Dharamshala", coords=(32.2190, 76.3234), state="Himachal Pradesh")
    assert result["total_places"] > 0
    assert result["must_visit"]
    for item in result["must_visit"]:
        assert item["verified"] is True


# ── DESTINATION-WIDE: THE 2 KM RULE Applies ONLY to nearby mode ─────────────

def test_discovery_is_destination_wide_not_a_2km_circle():
    """The main 'Places to Visit' section is NOT restricted to a 2 km circle
    around the destination centre. Jaipur's verified attractions sit 3–10 km
    from the centroid — under destination-wide discovery they MUST be returned,
    and at least one result must lie BEYOND 2 km from the anchor (proving the
    cap no longer applies)."""
    result = pd.discover_destination("Jaipur")
    assert result["total_places"] > 0
    assert result["must_visit"], "Jaipur's real attractions must be found destination-wide"
    distances = [float(i["distance_km"]) for i in result["must_visit"] if i.get("distance_km") is not None]
    assert any(d > 2.0 for d in distances), (
        "Destination-wide discovery returned only in-core results — the 2 km circle "
        "is still being applied. Famous attractions beyond 2 km must be included."
    )
    for bucket in ("must_visit", "food", "stays", "activities"):
        for item in result[bucket]:
            assert item["verified"] is True


def test_discovery_exposes_destination_footprint():
    """The payload carries the destination's own footprint so the UI can explain
    'found across the destination' rather than 'within 2 km'."""
    result = pd.discover_destination("Ooty")
    assert result.get("destination_latitude") is not None
    assert result.get("destination_longitude") is not None
    assert result.get("destination_radius_km") == pd.DESTINATION_RADIUS_KM["city"]  # Ooty is a city


# ── pool targets ────────────────────────────────────────────────────────────

def test_discovery_neither_overcap_targets_nor_invents():
    """Pool targets: up to 10 places / 10 activities / up to 7 restaurants /
    up to 7 stays. Fewer real results are fine; inventing more is not allowed."""
    for name in ("Ooty", "Puducherry", "Mahabalipuram"):
        result = pd.discover_destination(name)
        assert result["total_places"] > 0, name
        for bucket, cap in (
            ("must_visit", pd.TARGET_COUNTS["must_visit"]),
            ("activities", pd.TARGET_COUNTS["activities"]),
            ("food", pd.TARGET_COUNTS["food"]),
            ("stays", pd.TARGET_COUNTS["stays"]),
        ):
            items = result[bucket] or []
            assert len(items) <= cap, f"{name}/{bucket}: {len(items)} > {cap}"
            for item in items:
                assert item["verified"] is True, f"{name}/{bucket}: {item['name']} is not verified"
                assert item["source"] not in {"ai", "llm", "invented", "estimated"}


def test_discovery_ranks_inside_before_nearby():
    """Destination-first ranking: inside-core places always outrank the wider
    destination within every bucket."""
    for name in ("Ooty", "Puducherry", "Dharamshala"):
        result = pd.discover_destination(name)
        for bucket in ("must_visit", "activities", "food", "stays"):
            saw_nearby = False
            for item in result.get(bucket) or []:
                placement = item.get("placement") or "inside"
                if placement == "nearby":
                    saw_nearby = True
                else:
                    assert not saw_nearby, (
                        f"{name}/{bucket}: an inside place appears after a nearby one"
                    )


def test_discovery_never_invents():
    result = pd.discover_destination("Dharamshala", coords=(32.2190, 76.3234), state="Himachal Pradesh")
    for bucket in ("must_visit", "food", "activities", "stays"):
        for item in result[bucket]:
            assert item["verified"] is True
            assert item["source"] not in {"ai", "llm", "invented", "estimated"}


# ── NEARBY mode: the ONLY place the 2 km cap applies ────────────────────────

def _fake_google_place(pid, name, lat, lng):
    return {
        "id": pid,
        "displayName": {"text": name},
        "location": {"latitude": lat, "longitude": lng},
        "types": ["tourist_attraction"],
        "rating": 4.5,
        "userRatingCount": 120,
    }


def test_nearby_mode_hard_caps_at_2km(monkeypatch):
    """'Places near this spot' is the ONLY 2 km-scoped operation: the backend
    enforces the cap even if the provider returns a real place outside it."""
    ref = (12.6209, 80.1933)  # Mahabalipuram anchor
    # 0.8 km away — inside the cap; and 4.5 km away — real but OUT of the cap.
    close = "Landmark Within Cap"
    far = "Landmark Outside Cap"
    google_places = [
        _fake_google_place("gp_close", close, ref[0] + 0.007, ref[1]),
        _fake_google_place("gp_far", far, ref[0] + 0.040, ref[1]),  # ~4.5 km
    ]
    monkeypatch.setattr(pd, "_google_search", lambda *a, **k: google_places)
    monkeypatch.setattr(pd, "_discover_osm", lambda *a, **k: {
        "attractions": [], "food": [], "stays": [], "activities": [],
    })
    from app.core.config import settings
    monkeypatch.setattr(settings, "GOOGLE_PLACES_API_KEY", "test-key")
    res = pd.discover_nearby("Mahabalipuram", "Shore Temple", ref)
    assert res["radius_km"] == 2.0
    names = {i["name"] for i in res["attractions"]}
    assert close in names
    assert far not in names, "a real place 4.5 km away must NEVER be a 'nearby' result"
    for item in res["attractions"]:
        assert float(item["distance_km"]) <= 2.0 + 1e-6