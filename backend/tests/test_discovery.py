"""Destination discovery tests — REAL PLACES ONLY.

Covers:
  * name resolution robustness (Cochin→Kochi, Dharamshala, Kanyakumari)
  * the Manali wrong-state bug (Tamil Nadu vs Himachal Pradesh)
  * an ANY-destination pipeline that returns verified real places even for
    destinations that are unindexed — via registered coordinates (never empty).
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

@pytest.mark.parametrize("name", ["Pondicherry", "Chennai", "Ooty", "Jaipur", "Goa"])
def test_discovery_returns_real_places(name):
    result = pd.discover_destination(name, preferences={"interests": ["culture"]})
    assert result["total_places"] > 0
    assert result["must_visit"], f"{name} must_visit should never be empty"
    for item in result["must_visit"]:
        assert item["name"], "place names come from real sources"
        assert item["source"] in {
            "google_places", "openstreetmap", "verified_api",
            "geonames_local_index", "guide_submitted",
        }


def test_discovery_works_for_unindexed_names_via_coords():
    """'Cochin' isn't an exact gazetteer name — but with registered coords the
    pipeline must still surface real places. This is the 'empty sections' bug."""
    result = pd.discover_destination("Cochin", coords=(9.9312, 76.2673), state="Kerala")
    assert result["total_places"] > 0
    assert result["must_visit"]
    names = {i["name"] for i in result["must_visit"]}
    assert "Fort Kochi" in names or "Vypin" in names  # real Kerala places


def test_discovery_never_invents():
    result = pd.discover_destination("Dharamshala", coords=(32.2190, 76.3234), state="Himachal Pradesh")
    for bucket in ("must_visit", "food", "activities", "stays"):
        for item in result[bucket]:
            assert item["verified"] is True
            assert item["source"] not in {"ai", "llm", "invented", "estimated"}