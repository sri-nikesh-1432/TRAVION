"""Destination discovery tests — REAL PLACES ONLY.

Covers:
  * name resolution robustness (Cochin→Kochi, Dharamshala, Kanyakumari)
  * the Manali wrong-state bug (Tamil Nadu vs Himachal Pradesh)
  * the HARD 3 km cap: the pipeline returns verified real places within the
    destination core, and — when none exist within 3 km — returns an HONEST
    EMPTY (never a fabricated or out-of-radius place).
Network tiers (Google/Overpass) are mocked out so the tests are offline and
deterministic; the geonames index + verified catalog are real local data.
"""
import pytest

import app.services.places_discovery as pd


@pytest.fixture(autouse=True)
def offline_no_network(monkeypatch):
    """No Google key, no live Overpass — the geonames index + verified catalog
    (real local data) do all the work, deterministically."""
    monkeypatch.setattr(pd, "_discover_osm", lambda dest, resolved: {
        "must_visit": [], "food": [], "activities": [], "stays": [],
    })


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
    names = {i["name"] for i in result["must_visit"]}
    assert "Tsuglagkhang Complex (Dalai Lama Temple)" in names or "Bhagsu Waterfall" in names


def test_discovery_3km_cap_is_honest_never_invents():
    """The 3 km core rule is HARD: when no verified place lies within 3 km of
    the anchor, discovery returns an honest empty — it must NEVER fabricate a
    place or reach outside the cap. (Verified catalog distances for these
    anchors all exceed the cap; live Google/Overpass tiers are mocked out.)"""
    # Goa — absolutely nothing real within the core.
    goa = pd.discover_destination("Goa")
    assert goa["total_places"] == 0
    assert goa["must_visit"] == []
    # Cochin coords (Fort Kochi anchor) — nothing real within 3 km offline.
    cochin = pd.discover_destination("Cochin", coords=(9.9312, 76.2673), state="Kerala")
    assert cochin["total_places"] == 0
    assert cochin["must_visit"] == []
    # Jaipur — verified attractions sit 3.3–10.3 km from the centroid, so the
    # attraction section is honestly empty; anything that IS returned is real.
    jaipur = pd.discover_destination("Jaipur")
    assert jaipur["must_visit"] == []
    for bucket in ("food", "stays", "activities"):
        for item in jaipur[bucket]:
            assert item["verified"] is True


def test_discovery_never_invents():
    result = pd.discover_destination("Dharamshala", coords=(32.2190, 76.3234), state="Himachal Pradesh")
    for bucket in ("must_visit", "food", "activities", "stays"):
        for item in result[bucket]:
            assert item["verified"] is True
            assert item["source"] not in {"ai", "llm", "invented", "estimated"}