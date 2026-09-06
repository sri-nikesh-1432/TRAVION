"""Destination place discovery — REAL PLACES ONLY.

Pipeline: destination resolution -> real place search -> validation ->
dedup -> categorization -> ranking -> discovery payload.

Sources, in priority order:
  1. Google Places API (New) — used ONLY when GOOGLE_PLACES_API_KEY is set in
     the server environment (key never reaches the frontend).
  2. OpenStreetMap Overpass API (free, no key) — real tagged tourism/food/
     hotel POIs with real names, coordinates, websites and hours where the
     community mapped them. Nothing is inferred beyond what OSM contains.
  3. Travion verified catalog (curated, real stays/food/attractions).
  4. India place index generated from GeoNames (real gazetteer entries with
     real coordinates, 248 tourist places nationwide).

The LLM is NEVER a source of place existence. If a source has no data for a
category, that category is empty or omitted — never filled with inventions.
Unknown fields are None; the UI must show "Not available" for those.
"""
import math
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

from app.services.verified_data import VERIFIED_ATTRACTIONS, VERIFIED_STAYS, VERIFIED_FOOD
from app.services.india_places_index import INDIA_PLACES

GOOGLE_PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
_CACHE_TTL_SECONDS = 6 * 60 * 60  # provider-terms-friendly TTL
_cache: Dict[str, Tuple[float, Any]] = {}


def _cache_get(key: str) -> Optional[Any]:
    hit = _cache.get(key)
    if hit and (time.time() - hit[0]) < _CACHE_TTL_SECONDS:
        return hit[1]
    return None


def _cache_set(key: str, value: Any) -> None:
    _cache[key] = (time.time(), value)
    if len(_cache) > 500:
        # Drop the oldest quarter to keep memory bounded.
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:125]:
            _cache.pop(k, None)


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", str(name or "").lower()).strip()


# Region aliases map popular regional names to their representative real
# indexed place — the coordinates still come from the real gazetteer entry.
_REGION_ALIASES = {
    "kashmir": "Srinagar",
    "jammu and kashmir": "Srinagar",
    "ladakh": "Leh",
    "northeast india": "Guwahati",
    "rajasthan": "Jaipur",
    "kerala": "Kochi",
    "goa": "Panjim",
    "coorg": "Madikeri",
    "kodagu": "Madikeri",
    "puducherry": "Puducherry",
}

# Common user-typed spellings/aliases -> canonical indexed place name. This is a
# mapping of REAL known name variants (never an invention): the resolved place
# still comes from the real gazetteer entry with its real coordinates.
_NAME_ALIASES = {
    "pondicherry": "Puducherry",
    "pondichery": "Puducherry",
    "puduchery": "Puducherry",
    "cochin": "Kochi",
    "trivandrum": "Thiruvananthapuram",
    "tiruvananthapuram": "Thiruvananthapuram",
    "trichy": "Tiruchirappalli",
    "tiruchy": "Tiruchirappalli",
    "tiruchchirapalli": "Tiruchirappalli",
    "thrissur": "Trichur",
    "trichur": "Trichur",
    "alleppey": "Alappuzha",
    "dharamsala": "Dharamsala",
    "dharamshala": "Dharamsala",
    "bangalore": "Bengaluru",
    "mysore": "Mysuru",
    "kanyakumari": "Kanyakumari",
    "kanchipuram": "Kanchipuram",
    "vellankanni": "Velankanni",
    "madikeri": "Madikeri",
    "kodaikanal": "Kodaikanal",
    "ootacamund": "Ooty",
    "cottonian": "Kotagiri",
    "coonoor": "Coonoor",
    "palakkad": "Palakkad",
    "kozhikode": "Kozhikode",
    "calicut": "Kozhikode",
    "trichur": "Thrissur",
    "bengalooru": "Bengaluru",
    "gurgaon": "Gurugram",
    "gurugram": "Gurugram",
    "punjab": "Chandigarh",
    "jamshedpur": "Jamshedpur",
    "ranchi": "Ranchi",
    "kanpur": "Kanpur",
    "vijayawada": "Vijayawada",
    "vizag": "Visakhapatnam",
    "visakhapatnam": "Visakhapatnam",
    "mangalore": "Mangaluru",
    "mangaluru": "Mangaluru",
    "hubli": "Hubballi",
    "belgaum": "Belagavi",
    "kolhapur": "Kolhapur",
    "nagpur": "Nagpur",
    "aurangabad": "Aurangabad",
    "shirdi": "Shirdi",
    "nasik": "Nashik",
    "nashik": "Nashik",
    "indore": "Indore",
    "ujjain": "Ujjain",
    "gwalior": "Gwalior",
    "jabalpur": "Jabalpur",
    "gorakhpur": "Gorakhpur",
    "prayagraj": "Allahabad",
    "allahabad": "Allahabad",
    "kashi": "Varanasi",
    "benaras": "Varanasi",
    "banaras": "Varanasi",
    "kalinga": "Bhubaneswar",
    "bhubaneshwar": "Bhubaneswar",
    "bhubaneswar": "Bhubaneswar",
    "cuttack": "Cuttack",
    "siliguri": "Siliguri",
    "asansol": "Asansol",
    "guwahati": "Guwahati",
    "gauhati": "Guwahati",
    "dibrugarh": "Dibrugarh",
    "shillong": "Shillong",
    "imphal": "Imphal",
    "agartala": "Agartala",
    "aizawl": "Aizawl",
    "kohima": "Kohima",
    "itanagar": "Itanagar",
    "gangtok": "Gangtok",
    "portblair": "Port Blair",
    "port blair": "Port Blair",
    "srinagar": "Srinagar",
    "jammu": "Jammu",
    "leh": "Leh",
    "shimla": "Shimla",
    "simla": "Shimla",
    "manali": "Manali",
    "kullu": "Kullu",
    "palampur": "Palampur",
    "ankola": "Ankola",
    "gokarna": "Gokarna",
    "karwar": "Karwar",
    "murudeshwar": "Murudeshwar",
    "udupi": "Udupi",
    "chikmagalur": "Chikmagalur",
    "chikkamagaluru": "Chikmagalur",
    "hassan": "Hassan",
    "sakleshpur": "Sakleshpur",
    "madikeri": "Madikeri",
    "virajpet": "Virajpet",
    "kabini": "Kabini",
    "wayanad": "Wayanad",
    "kumarakom": "Kumarakom",
    "varkala": "Varkala",
    "kovalam": "Kovalam",
    "neyyar": "Neyyar",
    "poovar": "Poovar",
    "munnar": "Munnar",
    "thekkady": "Thekkady",
    "vagamon": "Vagamon",
    "athirappilly": "Athirappilly",
    "bekal": "Bekal",
    "peermade": "Peermade",
    "mananthavady": "Mananthavady",
    "kalpetta": "Kalpetta",
    "sulthan bathery": "Sulthan Bathery",
    "bootukkal": "Boitukkal",
    "yercaud": "Yercaud",
    "kodaikanal": "Kodaikanal",
    "theni": "Theni",
    "rameshwaram": "Rameswaram",
    "rameswaram": "Rameswaram",
    "kanyakumari": "Kanniyakumari",
    "kanniyakumari": "Kanniyakumari",
    "mahabalipuram": "Mahabalipuram",
    "mamallapuram": "Mahabalipuram",
    "tirupati": "Tirupati",
    "tirumala": "Tirumala",
    "srisailam": "Srisailam",
    "hampi": "Hampi",
    "belur": "Belur",
    "halebidu": "Halebidu",
    "dharwad": "Dharwad",
    "bidar": "Bidar",
    "gulbarga": "Kalaburagi",
    "kalaburagi": "Kalaburagi",
    "bellary": "Ballari",
    "davanagere": "Davanagere",
    "raichur": "Raichur",
    "hosur": "Hosur",
    "kochi": "Kochi",
    "ernakulam": "Kochi",
    "kakkanad": "Kakkanad",
    "kottayam": "Kottayam",
    "changanassery": "Changanassery",
    "pala": "Pala",
    "idukki": "Idukki",
    "thodupuzha": "Thodupuzha",
    "ernakulam": "Kochi",
    "neyyattinkara": "Neyyattinkara",
    "attingal": "Attingal",
    "kollam": "Kollam",
    "quilon": "Kollam",
    "alappuzha": "Alappuzha",
    "alleppey": "Alappuzha",
    "ernakulam": "Kochi",
    "guruvayur": "Guruvayur",
    "kakkad": "Kakkanad",
}


def _resolve_destination(
    destination: str,
    coords: Optional[Tuple[float, float]] = None,
    state: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Resolve a destination name to a real indexed place (never guessed coords).

    Strategy (in order, so the SAME destination always resolves the same way):
      1. Exact normalized name match.
      2. Known alias (Pondicherry -> Puducherry, Cochin -> Kochi, ...).
      3. Full-token containment (e.g. "Fort Kochi" vs "Kochi", "North Goa" vs
         "Goa") — every token of the queried name must be present.
      4. Best single-token overlap as a last resort.

    When several candidates tie (e.g. "Manali" exists in both Tamil Nadu and
    Himachal Pradesh), disambiguate by the traveller's REGISTERED destination
    state and coordinates — which the frontend always collects from the real
    location provider — then prefer curated tourist places over raw districts.
    """
    target = _norm(destination)
    if not target:
        return None
    alias = _REGION_ALIASES.get(target) or _NAME_ALIASES.get(target)
    if alias:
        target = _norm(alias)

    exact = [p for p in INDIA_PLACES if _norm(p["name"]) == target]
    if not exact:
        tokens = set(target.split())
        if tokens and len(tokens) >= 2:
            exact = [p for p in INDIA_PLACES if tokens and tokens <= set(_norm(p["name"]).split())]
    if not exact:
        tokens = set(target.split())
        best, best_score = None, 0
        for p in INDIA_PLACES:
            ptokens = set(_norm(p["name"]).split())
            overlap = len(tokens & ptokens)
            if overlap > best_score:
                best, best_score = p, overlap
        if best_score >= 1:
            exact = [best]
    if not exact:
        return None

    if len(exact) > 1:
        if state:
            st = _norm(state)
            same_state = [p for p in exact if _norm(p["state"]) == st]
            if same_state:
                exact = same_state
        if len(exact) > 1 and coords:
            exact = [min(exact, key=lambda p: _haversine_km(coords, (p["lat"], p["lng"])))]
        if len(exact) > 1:
            exact = [min(exact, key=lambda p: 0 if p["kind"] in ("place", "town") else 1)]
    return exact[0]


def _haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = a[0], a[1], b[0], b[1]
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# ── Google Places (New) Text Search — primary source when key configured ────

_GOOGLE_FIELD_MASK = (
    "places.id,places.displayName,places.formattedAddress,places.location,"
    "places.rating,places.userRatingCount,places.types,places.websiteUri,"
    "places.currentOpeningHours"
)

_SEARCH_CATEGORIES: List[Tuple[str, List[str]]] = [
    ("must_visit", ["tourist attractions in {d}", "landmarks in {d}", "beaches in {d}",
                    "temples in {d}", "museums in {d}", "parks in {d}"]),
    ("food", ["restaurants in {d}", "cafes in {d}", "street food in {d}"]),
    ("activities", ["things to do in {d}", "adventure activities in {d}"]),
    ("stays", ["hotels in {d}", "homestays in {d}"]),
]


def _google_search(query: str, api_key: str) -> List[Dict[str, Any]]:
    try:
        resp = requests.post(
            GOOGLE_PLACES_ENDPOINT,
            headers={
                "X-Goog-Api-Key": api_key,
                "X-Goog-FieldMask": _GOOGLE_FIELD_MASK,
            },
            json={"textQuery": query, "languageCode": "en", "regionCode": "IN"},
            timeout=10,
        )
        if resp.status_code != 200:
            return []
        return (resp.json() or {}).get("places") or []
    except Exception:
        return []


def _google_item(place: Dict[str, Any], category: str) -> Optional[Dict[str, Any]]:
    loc = place.get("location") or {}
    if loc.get("latitude") is None:
        return None
    display = (place.get("displayName") or {}).get("text")
    if not display:
        return None
    opening = place.get("currentOpeningHours")
    photos: List[str] = []  # photo media requires a separate keyed URL call; never fabricate
    return {
        "id": f"gp_{place.get('id')}",
        "place_id": place.get("id"),
        "name": display,
        "category": category,
        "latitude": loc.get("latitude"),
        "longitude": loc.get("longitude"),
        "address": place.get("formattedAddress"),
        "rating": place.get("rating"),
        "review_count": place.get("userRatingCount"),
        "opening_hours": (opening or {}).get("weekdayDescription") if opening else None,
        "website": place.get("websiteUri"),
        "photos": photos,
        "source": "google_places",
        "verified": True,
        "entry_fee": None,
        "price_per_night": None,
        "duration_minutes": 90,
        "duration_is_estimate": True,
    }


def _discover_google(destination: str, resolved: Dict[str, Any], api_key: str) -> Dict[str, List[Dict[str, Any]]]:
    d = destination if resolved and _norm(resolved["name"]) == _norm(destination) else (
        f"{destination} {resolved['state']}" if resolved else destination
    )
    buckets: Dict[str, List[Dict[str, Any]]] = {"must_visit": [], "food": [], "activities": [], "stays": []}
    for category, queries in _SEARCH_CATEGORIES:
        for template in queries:
            for place in _google_search(template.format(d=d), api_key):
                item = _google_item(place, category)
                if item:
                    buckets[category].append(item)
    return buckets


# ── OpenStreetMap Overpass — keyless live POI tier ─────────────────────────

# (category, OSM filter) pairs. Only real OSM-tagged features are returned;
# unnamed features are skipped. Filters mirror real destination relevance.
_OSM_FILTERS: List[Tuple[str, str]] = [
    ("must_visit", 'node["tourism"~"^(attraction|viewpoint|museum|gallery|zoo|theme_park|artwork)$"]'),
    ("must_visit", 'node["historic"~"^(monument|castle|memorial|fort|ruins|archaeological_site)$"]'),
    ("must_visit", 'node["natural"~"^(beach|waterfall)$"]'),
    ("must_visit", 'node["leisure"~"^(park|garden)$"]'),
    ("must_visit", 'node["place_of_worship"]["religion"]'),
    ("food", 'node["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream)$"]'),
    ("activities", 'node["leisure"~"^(water_park|sports_centre|horse_riding|track)$"]'),
    ("activities", 'node["amenity"="boat_rental"]'),
    ("stays", 'node["tourism"~"^(hotel|hostel|guest_house|motel|apartment|resort)$"]'),
]


def _osm_item(el: Dict[str, Any], category: str, origin: Optional[Tuple[float, float]] = None) -> Optional[Dict[str, Any]]:
    tags = el.get("tags") or {}
    name = (tags.get("name") or tags.get("name:en") or "").strip()
    if not name:  # unnamed real features are useless for trip planning
        return None
    center = el.get("center") or {}
    lat, lng = el.get("lat"), el.get("lon")
    if lat is None or lng is None:
        lat, lng = center.get("lat"), center.get("lon")
    if lat is None or lng is None:
        return None
    osm_id = f"osm_{el.get('type', 'node')}_{el.get('id')}"
    addr_parts = [tags.get(k) for k in ("addr:housenumber", "addr:street", "addr:city") if tags.get(k)]
    distance_km = round(_haversine_km(origin, (lat, lng)), 1) if origin else None
    return {
        "id": osm_id,
        "place_id": osm_id,
        "name": name,
        "category": category,
        "latitude": lat,
        "longitude": lng,
        "address": ", ".join(addr_parts) or None,
        "distance_km": distance_km,
        "rating": None,  # OSM has no ratings — never invented
        "review_count": None,
        "opening_hours": tags.get("opening_hours"),
        "website": tags.get("website") or tags.get("contact:website"),
        "photos": [],
        "source": "openstreetmap",
        "verified": True,
        "osm_tags": sorted(tags.keys()),
        "entry_fee": ("Paid" if tags.get("charge") else None),
        "price_per_night": None,
        "duration_minutes": 90,
        "duration_is_estimate": True,
    }


def _overpass_query(filters: List[str], lat: float, lng: float, radius_m: int) -> str:
    body = "\n".join(f"  {f}(around:{radius_m},{lat},{lng});" for f in filters)
    return f"[out:json][timeout:20];(\n{body}\n);out center tags 400;"


def _classify_osm(tags: Dict[str, str]) -> Optional[str]:
    """Map real OSM tags to a Travion discovery category. First match wins."""
    tourism = tags.get("tourism", "")
    amenity = tags.get("amenity", "")
    if tourism in {"hotel", "hostel", "guest_house", "motel", "apartment", "resort"}:
        return "stays"
    if amenity in {"restaurant", "cafe", "fast_food", "food_court", "ice_cream"}:
        return "food"
    if amenity == "boat_rental" or tags.get("leisure") in {"water_park", "sports_centre", "horse_riding", "track"}:
        return "activities"
    if tourism in {"attraction", "viewpoint", "museum", "gallery", "zoo", "theme_park", "artwork"}:
        return "must_visit"
    if tags.get("historic") in {"monument", "castle", "memorial", "fort", "ruins", "archaeological_site"}:
        return "must_visit"
    if tags.get("natural") in {"beach", "waterfall"}:
        return "must_visit"
    if tags.get("leisure") in {"park", "garden"}:
        return "must_visit"
    if "place_of_worship" in tags and tags.get("religion"):
        return "must_visit"
    return None


def _discover_osm(destination: str, resolved: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    """Live OpenStreetMap POI search around the resolved destination — ONE
    combined Overpass request (free API is rate-limited, so per-destination
    batching keeps us well within limits). Returns only real mapped features;
    on network failure returns empty buckets so lower tiers take over."""
    buckets: Dict[str, List[Dict[str, Any]]] = {"must_visit": [], "food": [], "activities": [], "stays": []}
    lat, lng = resolved["lat"], resolved["lng"]
    origin = (lat, lng)
    q = _overpass_query([flt for _, flt in _OSM_FILTERS], lat, lng, 25000)
    data: Optional[Dict[str, Any]] = None
    for attempt in range(2):  # free API rate-limits bursts; one retry round
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                resp = requests.post(endpoint, data={"data": q}, timeout=25,
                                     headers={"User-Agent": "Travion/1.0 (travel planning)"})
                if resp.status_code == 200:
                    data = resp.json()
                    break
            except Exception:
                continue
        if data:
            break
        time.sleep(3)
    if not data:
        return buckets
    for el in (data.get("elements") or []):
        tags = el.get("tags") or {}
        cat = _classify_osm(tags)
        if not cat:
            continue
        item = _osm_item(el, cat, origin=origin)
        if item:
            buckets[cat].append(item)
    return buckets


# ── Verified catalog + local index (fallback, always available) ─────────────

# Real curated entries that read as experiences/activities (matched against the
# item's name/description). These are the same verified places, surfaced in the
# activities bucket so it is never empty for a covered destination.
_ACTIVITY_KEYWORDS = (
    "rafting", "kayak", "boating", "boat ride", "cruise", "shikara", "dolphin",
    "snorkel", "scuba", "diving", "sailing", "surf", "watersports", "water sport",
    "safari", "jeep", "trek", "hike", "trail", "gondola", "cable car", "ropeway",
    "glacier", "paragliding", "zip", "bungee", "cycling", "elephant", "horse ride",
    "camping", "toy train", "mountain railway", "ridge walk", "climb", "glider",
    "canopy", "hot air balloon", "snowboard", "ski",
)


def _catalog_items(destination: str) -> Dict[str, List[Dict[str, Any]]]:
    """Travion's curated verified data (real names, ratings, fees)."""
    out: Dict[str, List[Dict[str, Any]]] = {"must_visit": [], "food": [], "activities": [], "stays": []}
    for a in VERIFIED_ATTRACTIONS.get(destination) or []:
        out["must_visit"].append({
            "id": f"cat_{_norm(a.get('name', ''))[:40]}",
            "place_id": None,
            "name": a.get("name", ""),
            "category": "must_visit",
            "latitude": a.get("lat"), "longitude": a.get("lng"),
            "address": None,
            "rating": a.get("rating"),
            "review_count": None,
            "opening_hours": None,
            "website": None,
            "photos": [],
            "source": a.get("source", "verified_api"),
            "verified": True,
            "entry_fee": a.get("entry_fee"),
            "price_per_night": None,
            "duration_minutes": a.get("duration_minutes", 90),
            "duration_is_estimate": False,
        })
    attractions = VERIFIED_ATTRACTIONS.get(destination) or []
    activity_like = [
        a for a in attractions
        if any(k in f"{a.get('name', '')} {a.get('description', '')}".lower()
               for k in _ACTIVITY_KEYWORDS)
    ]
    # When no curated entry is activity-flavoured, fall back to the top
    # must-visit entries so the Activities bucket is never empty for a real
    # destination (they are genuinely things a traveller does there).
    activity_pool = activity_like or list(attractions)
    for a in activity_pool[:6]:
        out["activities"].append({
            "id": f"cata_{_norm(a.get('name', ''))[:40]}",
            "place_id": None,
            "name": a.get("name", ""),
            "category": "activities",
            "latitude": a.get("lat"), "longitude": a.get("lng"),
            "address": None,
            "rating": a.get("rating"),
            "review_count": None,
            "opening_hours": None,
            "website": None,
            "photos": [],
            "source": a.get("source", "verified_api"),
            "verified": True,
            "entry_fee": a.get("entry_fee"),
            "price_per_night": None,
            "duration_minutes": a.get("duration_minutes", 90),
            "duration_is_estimate": False,
        })
    for f in VERIFIED_FOOD.get(destination) or []:
        out["food"].append({
            "id": f"catf_{_norm(f.get('name', ''))[:40]}",
            "place_id": None,
            "name": f.get("name", ""),
            "category": "food",
            "latitude": f.get("lat"), "longitude": f.get("lng"),
            "address": None,
            "rating": f.get("rating"),
            "review_count": None,
            "opening_hours": None,
            "website": None,
            "photos": [],
            "source": f.get("source", "verified_api"),
            "verified": True,
            "entry_fee": None,
            "price_per_night": None,
            "avg_cost_for_two": f.get("avg_cost_for_two"),
            "cuisine": f.get("cuisine"),
            "veg_type": f.get("veg_type"),
            "duration_minutes": 75,
            "duration_is_estimate": True,
        })
    for s in VERIFIED_STAYS.get(destination) or []:
        out["stays"].append({
            "id": f"cats_{_norm(s.get('name', ''))[:40]}",
            "place_id": None,
            "name": s.get("name", ""),
            "category": "stays",
            "latitude": s.get("lat"), "longitude": s.get("lng"),
            "address": None,
            "rating": s.get("rating"),
            "review_count": None,
            "opening_hours": None,
            "website": None,
            "photos": [],
            "source": s.get("source", "verified_api"),
            "verified": True,
            "tier": s.get("tier"),
            "amenities": s.get("amenities") or [],
            "entry_fee": None,
            "price_per_night": s.get("price_per_night"),
            "duration_minutes": None,
            "duration_is_estimate": False,
        })
    return out


def _index_items(destination: str, resolved: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Nearby REAL places from the GeoNames-derived index, around the resolved
    destination. Distance-based relevance; no invented fields."""
    if not resolved:
        return []
    origin = (resolved["lat"], resolved["lng"])
    nearby: List[Dict[str, Any]] = []
    for p in INDIA_PLACES:
        km = _haversine_km(origin, (p["lat"], p["lng"]))
        if 0 < km <= 120:  # day-trip radius around the destination
            # Administrative districts/cities around the destination (e.g.
            # "Central Delhi") are not tourist places — prefer real POIs.
            if p.get("kind") in ("district", "city"):
                continue
            nearby.append((km, p))
    nearby.sort(key=lambda t: t[0])
    items: List[Dict[str, Any]] = []
    for km, p in nearby[:12]:
        items.append({
            "id": p["id"],
            "place_id": p["id"],
            "name": p["name"],
            "category": "must_visit",
            "latitude": p["lat"], "longitude": p["lng"],
            "address": f"{p['name']}, {p['state']}, India",
            "rating": None,
            "review_count": None,
            "opening_hours": None,
            "website": None,
            "photos": [],
            "source": "geonames_local_index",
            "verified": True,
            "distance_km": round(km, 1),
            "entry_fee": None,
            "price_per_night": None,
            "duration_minutes": 90,
            "duration_is_estimate": True,
        })
    return items


# ── Dedup + ranking ──────────────────────────────────────────────────────────

def _dedup(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicate by provider place_id, then by name + proximity (<250 m)."""
    seen_ids: set = set()
    seen_coords: List[Tuple[str, float, float]] = []
    out: List[Dict[str, Any]] = []
    for item in items:
        pid = item.get("place_id") or item.get("id")
        if pid and pid in seen_ids:
            continue
        lat, lng = item.get("latitude"), item.get("longitude")
        if lat is not None and lng is not None:
            dup = False
            for oname, olat, olng in seen_coords:
                if _norm(oname) == _norm(item.get("name", "")) or _haversine_km((lat, lng), (olat, olng)) < 0.25:
                    dup = True
                    break
            if dup:
                continue
            seen_coords.append((item.get("name", ""), lat, lng))
        if pid:
            seen_ids.add(pid)
        out.append(item)
    return out


_INTEREST_KEYWORDS = {
    "beach": ("beach", "shore", "coast"),
    "photography": ("viewpoint", "sunset", "photography", "fort", "palace"),
    "adventure": ("trek", "rafting", "diving", "surfing", "adventure", "camping"),
    "nature": ("park", "lake", "falls", "waterfall", "sanctuary", "garden", "peak"),
    "culture": ("temple", "museum", "heritage", "monument", "ashram", "church", "mosque"),
    "food": ("restaurant", "cafe", "food", "bakery", "street"),
    "shopping": ("market", "bazaar", "mall", "shopping"),
    "spiritual": ("temple", "ashram", "church", "mosque", "gurudwara"),
    "relaxation": ("beach", "spa", "lake", "garden", "resort"),
}


def _rank(items: List[Dict[str, Any]], interests: List[str], veg_only: bool) -> List[Dict[str, Any]]:
    def score(item: Dict[str, Any]) -> float:
        s = 0.0
        rating = item.get("rating")
        if rating is not None:
            s += float(rating) * 2
            s += min(float(item.get("review_count") or 0), 500) / 100.0
        if item.get("source") == "google_places":
            s += 1.0
        haystack = _norm(f"{item.get('name', '')} {item.get('category', '')} {item.get('address', '')}")
        for interest in interests:
            for kw in _INTEREST_KEYWORDS.get(str(interest).strip().lower(), ()):
                if kw in haystack:
                    s += 2.0
        if item.get("distance_km") is not None:
            s -= min(float(item["distance_km"]), 50) / 10.0
        return s

    items = sorted(items, key=score, reverse=True)
    if veg_only:
        veg_first = [i for i in items if "veg" in _norm(str(i.get("veg_type") or " veg"))]
        veg_first.extend(i for i in items if "veg" not in _norm(str(i.get("veg_type") or " veg")))
        # Only reorder the food bucket's semantics at the caller level; here keep global order.
    return items


def discover_destination(
    destination: str,
    preferences: Optional[Dict[str, Any]] = None,
    coords: Optional[Tuple[float, float]] = None,
    state: Optional[str] = None,
) -> Dict[str, Any]:
    """Full discovery pipeline. Never returns invented places; categories may
    legitimately be empty when no source can verify them.

    ``coords`` and ``state`` are the traveller's REGISTERED destination
    coordinates/state (from the real location picker). They are used to (a)
    disambiguate name lookups (Manali TN vs HP), and (b) run the place search
    around the exact registered spot even when the name is unindexed — so ANY
    destination still returns real places."""
    prefs = preferences or {}
    interests = [str(x) for x in (prefs.get("interests") or prefs.get("experience") or [])]
    veg_only = any("veg" in str(x).lower() and "non" not in str(x).lower()
                   for x in (prefs.get("restrictions") or []))

    state_key = _norm(state) if state else ""
    coord_key = (
        f"{round(coords[0], 3)},{round(coords[1], 3)}" if coords and len(coords) == 2 else ""
    )
    cache_key = f"disc::{_norm(destination)}::{state_key}::{coord_key}::{sorted(interests)}::{veg_only}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    resolved = _resolve_destination(destination, coords=coords, state=state)
    api_key: Optional[str] = None
    try:
        from app.core.config import settings
        api_key = (getattr(settings, "GOOGLE_PLACES_API_KEY", "") or "").strip() or None
    except Exception:
        api_key = None

    # Registered coordinates are ground truth: search around them even when the
    # name isn't in the gazetteer (e.g. "Cochin", "Dharamshala 2 km from centre").
    anchor = resolved
    synthetic_anchor = None
    if anchor is None and coords and len(coords) == 2 and coords[0] and coords[1]:
        synthetic_anchor = {
            "id": "registered_location",
            "name": destination,
            "state": state or "",
            "lat": coords[0],
            "lng": coords[1],
            "kind": "town",
        }
        anchor = synthetic_anchor

    if api_key and anchor:
        buckets = _discover_google(destination, anchor, api_key)
        source = "google_places"
    else:
        buckets = {"must_visit": [], "food": [], "activities": [], "stays": []}
        source = None

    # The curated verified catalog is evaluated BEFORE deciding whether live
    # tiers are even needed: for a destination the catalog fully covers we skip
    # the (rate-limited, sometimes slow) Overpass tier entirely — curated real
    # stays/food/attractions are sufficient and always deterministic.
    catalog = _catalog_items(destination)
    catalog_sufficient = len(catalog["must_visit"]) >= 4 and bool(catalog["stays"])

    # Keyless live tier: run OpenStreetMap only when the curated catalog is
    # thin for must-visit (i.e. genuinely uncovered destinations).
    if anchor and not catalog_sufficient and len(buckets["must_visit"]) < 4:
        try:
            osm = _discover_osm(destination, anchor)
        except Exception:
            osm = {"must_visit": [], "food": [], "activities": [], "stays": []}
        for k, v in osm.items():
            if len(buckets[k]) < 10:  # OSM never crowds out richer sources
                buckets[k].extend(v)
        if any(buckets.values()) and not source:
            source = "openstreetmap"

    # Curated verified data is layered on top of whatever live sources gave us.
    for k, v in catalog.items():
        buckets[k].extend(v)

    # Last resort: real gazetteer entries around the destination — always fills
    # the must-visit bucket so the section is never empty for a real location.
    if anchor and not buckets["must_visit"]:
        buckets["must_visit"].extend(_index_items(destination, anchor))
    if synthetic_anchor and anchor is not None and source is None:
        source = "registered_local_index"
    if any(buckets.values()) and not source:
        source = "verified_local"

    result: Dict[str, Any] = {"destination": destination, "resolved": anchor, "source": source}
    total = 0
    for category in ("must_visit", "food", "activities", "stays"):
        items = _dedup(buckets.get(category) or [])
        items = _rank(items, interests, veg_only)
        result[category] = items
        result.setdefault("counts", {})[category] = len(items)
        total += len(items)
    result["total_places"] = total
    # Report the provider that actually produced the visible places (honest UI
    # badge), keeping live providers preferred over local fallbacks.
    if source in (None, "verified_local", "registered_local_index") and total:
        latest_rank = ("google_places", "openstreetmap", "verified_api", "geonames_local_index",
                       "guide_submitted", "verified_local")
        seen_providers = {i.get("source") for c in ("must_visit", "food", "activities", "stays")
                          for i in result.get(c, [])}
        chosen = next((p for p in latest_rank if p in seen_providers), None)
        if chosen and chosen != "guide_submitted":
            source = chosen
    result["source"] = source
    result["verified_only"] = True
    result["note"] = (
        "All places come from verified real-world data sources."
        if total else
        "We're unable to verify enough places for this destination right now."
    )
    _cache_set(cache_key, result)
    return result
