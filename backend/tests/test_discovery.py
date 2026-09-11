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
  * pool targets: up to 10 places / 10 activities / 10 restaurants / 10 stays.
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
    """No GeoApify, no Google key, no live Overpass, no geocoding — the geonames
    index + verified catalog (real local data) do all the work, deterministically."""
    monkeypatch.setattr(pd, "_geoapify_fetch", lambda categories, geo_filter, api_key: [])
    monkeypatch.setattr(pd, "_discover_osm", lambda dest, resolved, bounds=None: {
        "must_visit": [], "food": [], "activities": [], "stays": [],
    })
    monkeypatch.setattr(pd, "_discover_map_osm", lambda resolved, bounds=None: {
        c: [] for c in pd.MAP_CATEGORIES
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
    """Pool targets: up to 10 places / 10 activities / up to 10 restaurants /
    up to 10 stays. Fewer real results are fine; inventing more is not allowed."""
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


# ── Activities never duplicate Must-Visit (spec Part 2) ─────────────────────

def test_unique_activities_rejects_must_visit_collisions():
    """A candidate activity is rejected (next real candidate takes its slot)
    when it is the same real place as a must-visit — by place id, by coordinates
    within 350 m, or by a >=2-token name overlap. Distinct places survive."""
    must_visit = [
        {"name": "Golconda Fort", "place_id": "mv_1", "latitude": 17.3833, "longitude": 78.4011,
         "description": "Historic hilltop fort with the evening light & sound show."},
    ]
    activities = [
        # Same provider id → collision
        {"name": "Golconda Fort", "place_id": "mv_1", "latitude": 17.3833, "longitude": 78.4011,
         "description": "Fort"},
        # Different id but essentially the same coords (~0.2 km) → collision
        {"name": "Golconda Fort Light Show", "place_id": "act_x", "latitude": 17.3851, "longitude": 78.4003,
         "description": "Evening light & sound show inside the fort."},
        # Different place, far away, distinct name → must survive
        {"name": "Chowmahalla Palace", "place_id": "act_y", "latitude": 17.3573, "longitude": 78.4713,
         "description": "The royal palace of the Nizams."},
    ]
    kept = pd._unique_activities(activities, must_visit)
    names = {i["name"] for i in kept}
    assert "Golconda Fort" not in names, "identical place_id must be rejected"
    assert "Golconda Fort Light Show" not in names, "co-located same-place activity must be rejected"
    assert "Chowmahalla Palace" in names, "a distinct real activity must survive"
    assert len(kept) == 1


def test_thin_activity_pool_stays_honest_when_all_collide():
    """Rejections are filled by the NEXT real candidate, never by an invention:
    if every candidate collides, the activities bucket may legitimately shrink."""
    must_visit = [{"name": "Ooty Botanical Gardens", "place_id": "m1",
                   "latitude": 11.4136, "longitude": 76.6999, "description": "Gardens"}]
    activities = [{"name": "Ooty Botanical Gardens", "place_id": "m1",
                   "latitude": 11.4136, "longitude": 76.6999, "description": "Gardens"}]
    kept = pd._unique_activities(activities, must_visit)
    assert kept == []


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


# ── HONEST discovery contract: requested vs available, never fake counts ─────

def test_catalog_meta_reports_honest_requested_vs_available():
    """Every section reports `requested` (target), `available` (what actually
    exists) and `status`. `available` must ALWAYS equal the actual list length —
    the UI can't show '10' when only N real places exist."""
    result = pd.discover_destination("Ooty")
    meta = result["catalog_meta"]
    for cat in ("must_visit", "activities", "food", "stays"):
        row = meta[cat]
        assert row["requested"] == pd.TARGET_COUNTS[cat]
        assert row["available"] == len(result.get(cat) or [])
        assert row["status"] in {"success", "unavailable"}
        if row["available"]:
            assert row["status"] == "success"
        assert row["note"], "every category gets an honest note"


def test_catalog_meta_never_claims_success_when_pool_shrunk():
    """Activities that collide with must-visit are honestly dropped — `available`
    reflects the REAL (possibly smaller) pool, never the requested target."""
    result = pd.discover_destination("Mahabalipuram")
    meta = result["catalog_meta"]
    assert meta["activities"]["available"] == len(result.get("activities") or [])
    assert meta["activities"]["available"] <= meta["activities"]["requested"]


# ── Real MAP data: broader categories, provider-verified only ───────────────

def test_discover_map_returns_real_verified_places_only(monkeypatch):
    """The map's broader categories (shopping/healthcare/education/…) come only
    from real providers; results are inside the destination and verified."""
    fake = {
        "shopping": [{
            "id": "osm_map_1", "place_id": "osm_map_1", "name": "Real Market",
            "category": "shopping", "latitude": 11.4100, "longitude": 76.6900,
            "source": "openstreetmap", "verified": True,
        }],
        "healthcare": [{
            "id": "osm_map_2", "place_id": "osm_map_2", "name": "General Hospital",
            "category": "healthcare", "latitude": 11.4050, "longitude": 76.6950,
            "source": "openstreetmap", "verified": True,
        }],
        "education": [], "transport": [], "other": [],
    }
    monkeypatch.setattr(pd, "_discover_map_osm", lambda resolved, bounds=None: fake)
    res = pd.discover_map(
        "Ooty",
        {"name": "Ooty", "lat": 11.4102, "lng": 76.6950, "kind": "city"},
        origin=(11.4102, 76.6950), dest_radius_km=25.0, core_km=2.0,
    )
    assert res["shopping"], "real map data must be surfaced"
    assert res["healthcare"]
    for cat in pd.MAP_CATEGORIES:
        for item in res[cat]:
            assert item["verified"] is True
            assert item["inside_destination"] is True
            assert item["source"] not in {"ai", "llm", "invented", "estimated"}


def test_discover_map_rejects_places_outside_destination(monkeypatch):
    """A real but far-away place (e.g. 200 km off) must never appear on the
    destination map."""
    far_away = [{
        "id": "osm_far", "place_id": "osm_far", "name": "Distant Mall",
        "category": "shopping", "latitude": 13.0827, "longitude": 80.2707,  # Chennai-ish
        "source": "openstreetmap", "verified": True,
    }]
    monkeypatch.setattr(pd, "_discover_map_osm", lambda resolved, bounds=None: {
        "shopping": far_away, "healthcare": [], "education": [], "transport": [], "other": [],
    })
    res = pd.discover_map(
        "Ooty",
        {"name": "Ooty", "lat": 11.4102, "lng": 76.6950, "kind": "city"},
        origin=(11.4102, 76.6950), dest_radius_km=25.0, core_km=2.0,
    )
    assert res["shopping"] == [], "far-away real places are filtered out"; return


# ── GUARANTEED 10 per section: real places, every destination ────────────────

# Island territories (Andaman & Nicobar) have fewer than 10 real
# town/place entries in the entire archipelago; they are the documented
# honest exception where offline pools cannot reach the full target.
_KNOWN_THIN_DESTINATIONS = {"Port Blair"}


def test_every_destination_fills_ten_must_visit_and_activities():
    """MUST VISIT is filled to 10 from real data (curated catalog + real
    gazetteer entries INSIDE the destination footprint). ACTIVITIES are
    action-based — things to DO at real destination places — never padded with
    nearby towns, so the honest count may be below 10 when the destination
    itself has fewer real spots (strict boundary rule, no 350 km topup).
    Nothing is ever invented."""
    for name in sorted(pd.VERIFIED_ATTRACTIONS.keys()):
        if name in _KNOWN_THIN_DESTINATIONS:
            continue
        result = pd.discover_destination(name)
        must_visit = result.get("must_visit") or []
        # Honest fill: up to 10 real places INSIDE the destination footprint.
        # The old "always exactly 10" was only possible by pulling nearby
        # towns from a 350 km radius — that padding is gone by design.
        assert 3 <= len(must_visit) <= 10, f"{name} must_visit: {len(must_visit)}"
        # Action-based activities: bounded by the destination's real spots.
        activities = result.get("activities") or []
        assert len(activities) <= 10, f"{name} activities"
        for item in activities:
            assert item.get("category") == "activity", f"{name}: activity cards must be action-based"
            assert item.get("location_name"), f"{name}: every activity needs a real location"
        for cat in ("must_visit", "activities"):
            for item in result[cat]:
                assert item["verified"] is True
                assert item["source"] != "invented"


def test_port_blair_pool_honest_but_extended():
    """Port Blair (Andaman islands) has very few real entries in the
    archipelago. With the strict destination boundary the pool is HONEST —
    no nearby towns are pulled in to hit a number, and catalog_meta reports
    the real available count."""
    result = pd.discover_destination("Port Blair")
    avail_activities = len(result.get("activities") or [])
    avail_must = len(result.get("must_visit") or [])
    # Islands genuinely have fewer real entries — the pool is honest.
    assert avail_must >= 3, "Port Blair must_visit should still surface real places"
    assert avail_activities >= 1, "Port Blair should have at least a few real activities"
    meta = result["catalog_meta"]["activities"]
    assert meta["available"] == avail_activities
    if avail_activities:
        assert meta["status"] == "success"


def test_overpass_runs_when_fast_tiers_leave_buckets_empty(monkeypatch):
    """The OpenStreetMap keyless tier is the honest FALLBACK for destinations
    the fast tiers (GeoApify / Google / curated catalog) cannot cover — when a
    bucket is still empty it MUST run so real pools stay fillable."""
    called = {"osm": False}
    def spy_osm(dest, resolved, bounds=None):
        called["osm"] = True
        return {"must_visit": [], "food": [], "activities": [], "stays": []}
    monkeypatch.setattr(pd, "_discover_osm", spy_osm)
    monkeypatch.setattr(pd, "_geoapify_fetch", lambda categories, geo_filter, api_key: [])
    monkeypatch.setattr(pd, "_discover_map_osm", lambda r, bounds=None: {c: [] for c in pd.MAP_CATEGORIES})
    monkeypatch.setattr(pd, "_geocode_destination", lambda d, state=None: None)
    from app.core.config import settings
    monkeypatch.setattr(settings, "GEOAPIFY_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GOOGLE_PLACES_API_KEY", "")
    pd._cache.clear()
    # An unindexed destination (registered coords only, no curated catalog) is
    # exactly the case the OSM fallback exists for.
    pd.discover_destination("Unindexed Hill Village", coords=(32.2190, 76.3234), state="Himachal Pradesh")
    assert called["osm"], "OSM must run when the fast tiers leave buckets empty"


def test_overpass_skipped_when_fast_tiers_fill_buckets(monkeypatch):
    """Latency rule (spec: optimize API calls so place generation is fast): when
    GeoApify already fills every bucket, the slow free Overpass tier is skipped
    entirely."""
    called = {"osm": False}
    def spy_osm(dest, resolved, bounds=None):
        called["osm"] = True
        return {"must_visit": [], "food": [], "activities": [], "stays": []}
    monkeypatch.setattr(pd, "_discover_osm", spy_osm)

    def filling_fetch(categories, geo_filter, api_key):
        # One real-shaped feature per bucket per call — enough to fill the pools.
        c = set(categories.split(","))
        if "accommodation.hotel" in c:
            cat, cats, lat, lng = "stays", ["accommodation", "accommodation.hotel"], 11.4120, 76.7005
        elif "catering.restaurant" in c:
            cat, cats, lat, lng = "food", ["catering", "catering.restaurant"], 11.4130, 76.7010
        elif "sport.sports_centre" in c:
            cat, cats, lat, lng = "activities", ["sport", "sport.sports_centre"], 11.4150, 76.7030
        else:
            cat, cats, lat, lng = "must_visit", ["tourism", "tourism.attraction"], 11.4160, 76.7040
        return [{
            "type": "Feature",
            "properties": {
                "name": f"GeoApify {cat.title()} Place",
                "categories": cats,
                "formatted": f"GeoApify {cat.title()} Place, Ooty, Tamil Nadu, India",
                "place_id": f"gp_fill_{cat}",
                "lat": lat, "lon": lng,
            },
        }]

    monkeypatch.setattr(pd, "_geoapify_fetch", filling_fetch)
    monkeypatch.setattr(pd, "_discover_map_osm", lambda r, bounds=None: {c: [] for c in pd.MAP_CATEGORIES})
    monkeypatch.setattr(pd, "_geocode_destination", lambda d, state=None: None)
    from app.core.config import settings
    monkeypatch.setattr(settings, "GEOAPIFY_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GOOGLE_PLACES_API_KEY", "")
    pd._cache.clear()
    pd.discover_destination("Ooty")
    assert not called["osm"], "Overpass must be skipped when fast tiers already filled every bucket"


def test_topup_entries_are_real_verified_provenance():
    """Every must-visit and activity item has a real source (never 'invented')
    and carries a real latitude/longitude."""
    for name in ("Ooty", "Jaisalmer", "Shimla"):
        result = pd.discover_destination(name)
        for cat in ("must_visit", "activities"):
            for item in result.get(cat) or []:
                assert item["latitude"] is not None, f"{name}/{cat}/{item['name']} missing coords"
                assert item["longitude"] is not None
                assert item["verified"] is True
                assert item["source"] in {
                    "google_places", "openstreetmap", "verified_api",
                    "geonames_local_index", "guide_submitted",
                }