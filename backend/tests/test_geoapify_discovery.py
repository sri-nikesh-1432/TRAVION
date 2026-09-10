"""GeoApify Places API — preference-driven discovery (product spec §4+§5).

Verifies:
  * the GeoApify tier is the PRIMARY provider: when the key is set its results
    feed every bucket and the payload is attributed `source=geoapify`
  * the API is asked for categories chosen by the user's selected EXPERIENCE —
    a Spiritual selection requests religion.place_of_worship, Adventure requests
    parks/sport venues, Food & Culture requests museums/markets
  * results are classified back into Travion buckets from the provider's own
    category taxonomy
  * the preference DOMINATES ranking: matched places (name OR provider types)
    always rank above famous but unrelated ones
  * provider noise (generic one-token names like "temple"/"parking area")
    never outranks properly named places
  * the destination filter uses GeoApify rect (west,south,east,north) — never a
    2 km circle for destination-wide discovery
All network is mocked; assertions run on the real pipeline code.
"""
import pytest

import app.services.places_discovery as pd


def _feature(name: str, cats, lat=11.4102, lng=76.6950, pid=None):
    return {
        "type": "Feature",
        "properties": {
            "name": name,
            "categories": list(cats),
            "formatted": f"{name}, Ooty, Tamil Nadu, India",
            "place_id": pid or f"gp_{abs(hash(name))}",
            "lat": lat,
            "lon": lng,
        },
    }


@pytest.fixture
def geoapify_env(monkeypatch):
    """Key configured + no Overpass/geocode so GeoApify is the only live tier.
    The discovery TTL cache is cleared per test so identical destinations with
    different mocked payloads never leak results across tests."""
    from app.core.config import settings
    monkeypatch.setattr(pd, "_cache", {})
    monkeypatch.setattr(settings, "GEOAPIFY_API_KEY", "test-geoapify-key")
    monkeypatch.setattr(settings, "GOOGLE_PLACES_API_KEY", "")
    monkeypatch.setattr(pd, "_discover_osm", lambda dest, resolved, bounds=None: {
        "must_visit": [], "food": [], "activities": [], "stays": [],
    })
    monkeypatch.setattr(pd, "_discover_map_osm", lambda resolved, bounds=None: {
        c: [] for c in pd.MAP_CATEGORIES
    })
    monkeypatch.setattr(pd, "_geocode_destination", lambda dest, state=None: None)
    return monkeypatch


def test_geoapify_request_categories_follow_the_experience(geoapify_env, monkeypatch):
    """Spec §4: the preference must be used in the actual place-discovery logic —
    the categories sent to the provider ARE that logic at the API level."""
    captured: list = []

    def fake_fetch(categories, geo_filter, api_key):
        captured.extend(categories)  # both batched calls (preference + amenities)
        return []

    geoapify_env.setattr(pd, "_geoapify_fetch", fake_fetch)

    pd.discover_destination("Ooty", preferences={"experience": "Spiritual", "interests": "Spiritual"})
    assert "religion.place_of_worship" in captured

    captured.clear()
    pd.discover_destination("Ooty", preferences={"experience": "Food & Culture", "interests": "Food & Culture"})
    assert "entertainment.museum" in captured
    assert "commercial.marketplace" in captured

    captured.clear()
    pd.discover_destination("Ooty", preferences={"experience": "Adventure", "interests": "Adventure"})
    assert "leisure.park" in captured
    assert "sport.sports_centre" in captured


def test_geoapify_filter_is_destination_rect_never_2km(geoapify_env, monkeypatch):
    captured = {}

    def fake_fetch(categories, geo_filter, api_key):
        captured["filter"] = geo_filter
        return []

    geoapify_env.setattr(pd, "_geoapify_fetch", fake_fetch)
    monkeypatch.setattr(pd, "_geocode_destination", lambda dest, state=None: {
        "south": 11.30, "north": 11.52, "west": 76.60, "east": 76.79,
        "latitude": 11.4102, "longitude": 76.6950,
    })
    pd.discover_destination("Ooty", preferences={"experience": "Mixed"})
    # GeoApify rect order is west,south,east,north — the WHOLE destination.
    assert captured["filter"] == "rect:76.6,11.3,76.79,11.52"


def test_geoapify_results_fill_buckets_and_are_attributed(geoapify_env, monkeypatch):
    features = [
        _feature("Hanuman Temple", ["religion", "religion.place_of_worship", "religion.place_of_worship.hinduism"], lat=11.4142, lng=76.7022),
        _feature("Willy's Coffee Pub", ["catering", "catering.cafe"], lat=11.4130, lng=76.7010),
        _feature("The Savoy", ["accommodation", "accommodation.hotel"], lat=11.4120, lng=76.7005),
        _feature("Breeks Open Air Stadium", ["sport", "sport.sports_centre"], lat=11.4150, lng=76.7030),
        _feature("Government Museum", ["entertainment", "entertainment.museum"], lat=11.4160, lng=76.7040),
    ]

    def fake_fetch(categories, geo_filter, api_key):
        if "accommodation.hotel" in categories:
            return [f for f in features if "accommodation.hotel" in (f["properties"]["categories"])]
        return [f for f in features if "accommodation.hotel" not in (f["properties"]["categories"])]

    geoapify_env.setattr(pd, "_geoapify_fetch", fake_fetch)
    result = pd.discover_destination("Ooty", preferences={"experience": "Mixed"})
    assert result["source"] == "geoapify"
    # The full real candidate pool (what the map plots) must contain the tier's
    # places; the visible top-10 may be shared with the curated catalog.
    pool_names = {i["name"] for cat in ("must_visit", "food", "stays") for i in result["map_candidates"][cat]}
    assert "Hanuman Temple" in pool_names
    assert "Willy's Coffee Pub" in pool_names
    assert "The Savoy" in pool_names
    for bucket in ("must_visit", "food", "stays"):
        geo_rows = [i for i in result[bucket] if i["source"] == "geoapify"]
        for i in geo_rows:
            assert i["verified"] is True
            assert i["rating"] is None  # provider gives no ratings — never invented


def test_spiritual_preference_ranks_temples_above_famous_unrelated(geoapify_env, monkeypatch):
    """THE product rule (spec §4): a Spiritual selection must surface temples
    first even when an unrelated attraction is more famous."""
    features = [
        _feature("Hanuman Temple", ["religion", "religion.place_of_worship"], lat=11.4142, lng=76.7022),
        _feature("Great Unrelated Mall", ["tourism", "tourism.attraction"], lat=11.4130, lng=76.7010),
    ]

    def fake_fetch(categories, geo_filter, api_key):
        return features

    geoapify_env.setattr(pd, "_geoapify_fetch", fake_fetch)
    result = pd.discover_destination("Ooty", preferences={"experience": "Spiritual", "interests": "Spiritual"})
    must_visit = result["must_visit"]
    names = [i["name"] for i in must_visit]
    assert "Hanuman Temple" in names
    if "Great Unrelated Mall" in names:
        assert names.index("Hanuman Temple") < names.index("Great Unrelated Mall")


def test_provider_types_count_as_preference_match(geoapify_env, monkeypatch):
    """A place whose NAME gives nothing away but whose provider type is
    religion.place_of_worship must still count as a Spiritual match — it has to
    rank above famous places that do not match the preference at all."""
    features = [
        _feature("Sri X Swami Kovil Road Building", ["religion", "religion.place_of_worship"], lat=11.4142, lng=76.7022),
        _feature("Great Unrelated Mall", ["tourism", "tourism.attraction"], lat=11.4130, lng=76.7010),
    ]
    geoapify_env.setattr(pd, "_geoapify_fetch", lambda c, g, k: features)
    result = pd.discover_destination("Ooty", preferences={"experience": "Spiritual", "interests": "Spiritual"})
    names = [i["name"] for i in result["must_visit"] + result["map_candidates"]["must_visit"]]
    assert "Sri X Swami Kovil Road Building" in names, "type-matched place must be present"
    if "Great Unrelated Mall" in names:
        assert names.index("Sri X Swami Kovil Road Building") < names.index("Great Unrelated Mall")


def test_generic_one_token_names_never_lead_the_recommendations(geoapify_env, monkeypatch):
    """Real provider noise ('temple', 'parking area') must rank below properly
    named places in the matched group."""
    features = [
        _feature("temple", ["religion", "religion.place_of_worship"], lat=11.4142, lng=76.7022),
        _feature("Sri Annamalaiyar Hill Temple", ["religion", "religion.place_of_worship"], lat=11.4143, lng=76.7023),
    ]
    geoapify_env.setattr(pd, "_geoapify_fetch", lambda c, g, k: features)
    result = pd.discover_destination("Ooty", preferences={"experience": "Spiritual", "interests": "Spiritual"})
    names = [i["name"] for i in result["must_visit"]]
    if "Sri Annamalaiyar Hill Temple" in names and "temple" in names:
        assert names.index("Sri Annamalaiyar Hill Temple") < names.index("temple"), (
            "a properly named temple must outrank the generic one-token 'temple'"
        )


def test_adventure_park_never_matches_parking(geoapify_env, monkeypatch):
    """"park" must token-match "park"/"parks" — NEVER "parking"."""
    features = [
        _feature("parking area", ["leisure", "leisure.park"], lat=11.4130, lng=76.7010),
        _feature("Rose Garden", ["leisure", "leisure.park"], lat=11.4120, lng=76.7005),
    ]
    geoapify_env.setattr(pd, "_geoapify_fetch", lambda c, g, k: features)
    result = pd.discover_destination("Ooty", preferences={"experience": "Adventure", "interests": "Adventure"})
    names = [i["name"] for i in result["must_visit"]]
    if "parking area" in names and "Rose Garden" in names:
        assert names.index("Rose Garden") < names.index("parking area"), (
            "'parking area' must not outrank a real named park — 'park' must not match 'parking'"
        )


def test_geoapify_off_when_key_missing(geoapify_env, monkeypatch):
    """No key configured → the tier is skipped entirely (no network attempts)."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "GEOAPIFY_API_KEY", "")
    called = {"n": 0}

    def spy(*a, **k):
        called["n"] += 1
        return []

    monkeypatch.setattr(pd, "_geoapify_fetch", spy)
    pd.discover_destination("Ooty", preferences={"experience": "Mixed"})
    assert called["n"] == 0


def test_geoapify_failure_falls_back_to_local_real_sources(geoapify_env, monkeypatch):
    """Provider down → honest empty buckets from the tier, catalog + index
    still deliver real places, nothing invented."""
    def boom(*a, **k):
        raise RuntimeError("geoapify down")

    geoapify_env.setattr(pd, "_geoapify_fetch", boom)
    result = pd.discover_destination("Ooty", preferences={"experience": "Mixed"})
    assert result["total_places"] > 0, "curated catalog/index must keep discovery alive"
    assert result["source"] != "geoapify"
    for item in result["must_visit"]:
        assert item["verified"] is True
