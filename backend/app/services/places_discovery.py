"""Destination place discovery — REAL PLACES ONLY, DESTINATION-WIDE.

Pipeline: destination resolution -> real place search across the destination ->
validation -> category filtering -> dedup -> ranking -> discovery payload.

WHAT "the destination" means
---------------------------
The user asks "what famous places can I visit in Hyderabad?" — NOT "what exists
within 2 km of the city centre?". Discovery therefore searches the WHOLE
destination area as a real geographic region:

  1. the destination is resolved to a real place (anchor) AND, when reachable,
     geocoded to its geographic bounding box (Nominatim; keyless, cached);
  2. live providers (Google Places Text Search / OpenStreetMap Overpass) search
     that destination area — Google via a `locationRestriction` rectangle or
     destination-radius circle, Overpass via an area bounding box;
  3. results are filtered to the destination footprint (bounding box, or the
     destination's own kind-based radius as a documented fallback), category-
     filtered to real tourist categories, deduplicated and ranked by
     famousness (rating, review volume, relevance) — NOT by nearness to the
     centre;
  4. the 2 km rule applies ONLY to "nearby" mode (places near a specific
     selected spot); it is NEVER applied to destination-wide discovery.

Sources, in priority order:
  1. GeoApify Places API (v2) — PRIMARY preference-driven live provider, used
     when GEOAPIFY_API_KEY is set in the server environment (key never reaches
     the frontend). ONE batched request per discovery, filtered to the real
     destination rectangle, with categories chosen by the user's selected
     EXPERIENCE preference (Adventure / Food & Culture / Spiritual / Mixed).
  2. Google Places API (New) — secondary keyed tier (GOOGLE_PLACES_API_KEY),
     same server-only guarantee.
  3. OpenStreetMap Overpass API (free, no key) — real tagged tourism/food/
     hotel POIs with real names, coordinates, websites and hours where the
     community mapped them. Nothing is inferred beyond what OSM contains.
  4. Travion verified catalog (curated, real stays/food/attractions).
  5. India place index generated from GeoNames (real gazetteer entries with
     real coordinates, 248 tourist places nationwide) — used to fill genuine
     last-mile gaps inside the destination footprint.

The LLM is NEVER a source of place existence. If a source has no data for a
category, that category is empty or omitted — never filled with inventions.
Unknown fields are None; the UI must show "Not available" for those.
Ratings, addresses, hotel star tiers and prices are surfaced ONLY when the
source provides them — never guessed.
"""

import math
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

from app.services.verified_data import VERIFIED_ATTRACTIONS, VERIFIED_STAYS, VERIFIED_FOOD
from app.services.india_places_index import INDIA_PLACES

# Hard maximum radius for "nearby" mode (places near a specific spot) — the
# ONLY mode restricted to a small radius. Destination-wide discovery below does
# NOT use this cap.
MAX_DISTANCE_KM = 2.0

# The destination's own footprint, derived from the real gazetteer entry's
# `kind`. Used as a DOCUMENTED FALLBACK when a geocoded bounding box is not
# reachable; exact geography (bounding box) takes priority when available.
DESTINATION_RADIUS_KM: Dict[str, float] = {
    "city": 25.0,
    "district": 20.0,
    "town": 12.0,
    "place": 5.0,
}

# Target pool sizes per discovery section (we return UP TO these counts of real
# places; if fewer real places exist inside the destination, we honestly return
# fewer — we never fabricate to hit a number).
TARGET_COUNTS: Dict[str, int] = {
    "must_visit": 10,
    "activities": 10,
    "food": 10,
    "stays": 10,
}

GOOGLE_PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
GEOAPIFY_ENDPOINT = "https://api.geoapify.com/v2/places"
NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search"
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


def _filter_by_distance(items: List[Dict[str, Any]], origin: Tuple[float, float], max_km: float = MAX_DISTANCE_KM) -> List[Dict[str, Any]]:
    """NEARBY-mode hard filter: discard any place farther than max_km from a
    REFERENCE POINT. Used ONLY for "places near this spot" (max 2 km). It is
    NEVER used for destination-wide discovery. Mutates items by clamping
    distance_km and dropping out-of-range entries.
    """
    out: List[Dict[str, Any]] = []
    for item in items:
        lat, lng = item.get("latitude"), item.get("longitude")
        if lat is None or lng is None:
            continue
        km = _haversine_km(origin, (lat, lng))
        if km > max_km:
            continue
        item["distance_km"] = round(km, 1)
        out.append(item)
    return out


def _filter_by_destination(
    items: List[Dict[str, Any]],
    origin: Optional[Tuple[float, float]],
    dest_radius_km: float,
    bounds: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Destination-wide filter: keep real places INSIDE the destination.

    When a geocoded bounding box is available it defines the destination's
    actual geographic area (the whole point of destination-wide discovery).
    Otherwise the destination's own kind-based radius is a documented fallback.
    `distance_km` is kept as informational distance from the destination anchor
    — it is NOT a hard boundary.
    """
    has_bounds = bool(bounds and bounds.get("north") is not None and bounds.get("south") is not None)
    pad = 0.02
    out: List[Dict[str, Any]] = []
    for item in items:
        lat, lng = item.get("latitude"), item.get("longitude")
        if lat is None or lng is None:
            continue
        if has_bounds:
            if not (bounds["south"] - pad <= lat <= bounds["north"] + pad
                    and bounds["west"] - pad <= lng <= bounds["east"] + pad):
                continue
        elif origin and _haversine_km(origin, (lat, lng)) > dest_radius_km:
            continue
        if origin:
            item["distance_km"] = round(_haversine_km(origin, (lat, lng)), 1)
        out.append(item)
    return out


# ── Inside-destination vs nearby classification ─────────────────────────────
# The destination's own footprint varies — a city is far bigger than a beach or
# a hill town. `kind` comes from the real gazetteer entry, so the "inside-core"
# radius is derived from real geography, never guessed per-trip. "inside" means
# within the destination CORE; everything else in the destination is "nearby"
# relative to the core — both are honest in-destination results.

_CORE_RADIUS_KM = {
    "city": 2.0,
    "district": 2.0,
    "town": 1.0,
    "place": 0.5,
}


def _core_radius_kms(kind: Optional[str]) -> float:
    return _CORE_RADIUS_KM.get(str(kind or "").lower(), 1.0)


def _placement_for(
    item: Dict[str, Any],
    origin: Optional[Tuple[float, float]],
    core_km: float,
) -> str:
    """Classify a real place as INSIDE the destination core or NEARBY (still
    inside the destination, beyond the core). Curated verified entries for the
    destination are inherently inside it. Never invasive — purely a label.
    """
    if item.get("source") in ("verified_api", "guide_submitted") and not item.get("distance_km"):
        return "inside"
    km = item.get("distance_km")
    if km is None and origin is not None:
        lat, lng = item.get("latitude"), item.get("longitude")
        if lat is not None and lng is not None:
            km = _haversine_km(origin, (lat, lng))
    if km is None:
        return "inside"
    return "inside" if float(km) <= core_km else "nearby"


# ── Destination geography resolution (geocoding, keyless, cached) ───────────

def _geocode_destination(
    destination: str,
    state: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Resolve the destination's real geographic area (bounding box) via
    Nominatim. Optional: on any failure returns None and the kind-based
    destination radius is used instead. Bounding box data is real geography —
    never invented by the app."""
    key = f"geocode::{_norm(destination)}::{_norm(state or '')}"
    cached = _cache_get(key)
    if cached is not None:
        return cached
    try:
        params: Dict[str, Any] = {
            "q": destination,
            "format": "json",
            "limit": 1,
            "accept-language": "en",
            "addressdetails": 0,
        }
        if state:
            params["state"] = state
        resp = requests.get(
            NOMINATIM_ENDPOINT,
            params=params,
            headers={"User-Agent": "Travion/1.0 (travel planning; keyless OSM geocoding)"},
            timeout=10,
        )
        if resp.status_code == 200:
            rows = resp.json() or []
            if rows:
                bb = rows[0].get("boundingbox")
                if bb and len(bb) >= 4:
                    out: Dict[str, Any] = {
                        "south": float(bb[0]),
                        "north": float(bb[1]),
                        "west": float(bb[2]),
                        "east": float(bb[3]),
                        "latitude": float(rows[0].get("lat") or 0),
                        "longitude": float(rows[0].get("lon") or 0),
                        "display_name": rows[0].get("display_name"),
                    }
                    _cache_set(key, out)
                    return out
    except Exception:
        pass
    _cache_set(key, None)
    return None


# ── Google Places (New) Text Search — primary source when key configured ────

_GOOGLE_FIELD_MASK = (
    "places.id,places.displayName,places.formattedAddress,places.location,"
    "places.rating,places.userRatingCount,places.types,places.websiteUri,"
    "places.currentOpeningHours"
)

# Destination-wide query templates. NEVER append "within 2 km" — these describe
# the whole destination.
_SEARCH_CATEGORIES: List[Tuple[str, List[str]]] = [
    ("must_visit", ["tourist attractions in {d}", "famous places to visit in {d}",
                    "historical places in {d}", "heritage sites in {d}",
                    "temples in {d}", "museums in {d}", "monuments in {d}",
                    "beaches in {d}", "parks in {d}"]),
    ("food", ["restaurants in {d}", "popular restaurants in {d}", "cafes in {d}",
              "street food in {d}"]),
    ("activities", ["things to do in {d}", "activities in {d}",
                    "tourist experiences in {d}", "adventure activities in {d}"]),
    ("stays", ["hotels in {d}", "2 star hotels in {d}", "3 star hotels in {d}",
               "4 star hotels in {d}", "5 star hotels in {d}", "homestays in {d}"]),
]

# Real Google Places place `types` that read as actual tourist attractions.
# Used to keep hospitals/schools/banks/shops OUT of "Places to Visit".
_GOOGLE_TOURIST_TYPES = {
    "tourist_attraction", "museum", "art_gallery", "hindu_temple", "church",
    "mosque", "synagogue", "gurdwara", "place_of_worship", "park", "zoo",
    "amusement_park", "aquarium", "national_park", "beach", "natural_feature",
    "botanical_garden", "performing_arts_theater", "concert_hall", "stadium",
    "theme_park", "water_park", "casino", "art_studio", "historic_site",
    "castle", "cemetery", "monument", "viewpoint", "library", "marina",
}


def _google_search(
    query: str,
    api_key: str,
    center: Optional[Tuple[float, float]] = None,
    radius_m: Optional[int] = None,
    bounds: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Google Places (New) text search scoped to a DESTINATION area.

    Destination-wide discovery passes the destination's bounding box
    (`locationRestriction` rectangle) or, failing a geocode, its kind-based
    destination radius circle. "Nearby" mode passes a 2 km circle. Results are
    still REAL regardless of the scoping."""
    cache_key = None
    if bounds and bounds.get("north") is not None:
        cache_key = f"gp::{query}::{round(bounds['south'],2)},{round(bounds['west'],2)},{round(bounds['north'],2)},{round(bounds['east'],2)}"
    elif center and radius_m:
        cache_key = f"gp::{query}::{round(center[0],3)},{round(center[1],3)}::{radius_m}"
    if cache_key:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    body: Dict[str, Any] = {"textQuery": query, "languageCode": "en", "regionCode": "IN"}
    if bounds and bounds.get("north") is not None:
        body["locationRestriction"] = {
            "rectangle": {
                "low": {"latitude": bounds["south"], "longitude": bounds["west"]},
                "high": {"latitude": bounds["north"], "longitude": bounds["east"]},
            }
        }
    elif center and center[0] and center[1] and radius_m:
        body["locationRestriction"] = {
            "circle": {
                "center": {"latitude": center[0], "longitude": center[1]},
                "radius": radius_m,
            }
        }
    try:
        resp = requests.post(
            GOOGLE_PLACES_ENDPOINT,
            headers={
                "X-Goog-Api-Key": api_key,
                "X-Goog-FieldMask": _GOOGLE_FIELD_MASK,
            },
            json=body,
            timeout=12,
        )
        if resp.status_code != 200:
            return []
        places = (resp.json() or {}).get("places") or []
        if cache_key:
            _cache_set(cache_key, places)
        return places
    except Exception:
        return []


def _google_is_tourist(place: Dict[str, Any]) -> bool:
    types = set(place.get("types") or [])
    return bool(types & _GOOGLE_TOURIST_TYPES) or "tourist_attraction" in types


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
        "types": place.get("types") or [],
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


def _discover_google(
    destination: str,
    resolved: Dict[str, Any],
    api_key: str,
    bounds: Optional[Dict[str, Any]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    d = destination if resolved and _norm(resolved["name"]) == _norm(destination) else (
        f"{destination} {resolved['state']}" if resolved else destination
    )
    origin = (resolved["lat"], resolved["lng"]) if resolved and resolved.get("lat") and resolved.get("lng") else None
    kind = str(resolved.get("kind") or "").lower()
    radius_m = int(DESTINATION_RADIUS_KM.get(kind, 12.0) * 1000) if origin else None
    buckets: Dict[str, List[Dict[str, Any]]] = {"must_visit": [], "food": [], "activities": [], "stays": []}
    for category, queries in _SEARCH_CATEGORIES:
        cap = TARGET_COUNTS.get(category, 10) * 2  # collect a generous real pool, dedup later
        for template in queries:
            if len(buckets[category]) >= cap:
                break
            for place in _google_search(template.format(d=d), api_key, center=origin, radius_m=radius_m, bounds=bounds):
                item = _google_item(place, category)
                if item:
                    buckets[category].append(item)
    # Tourist-type filter for "Places to Visit": keep only real tourist
    # categories. If filtering would leave the section nearly empty we keep the
    # raw results (they came from real tourist-flavoured queries) rather than
    # show nothing — we never invent, we just avoid over-silencing.
    mv = buckets["must_visit"]
    if mv:
        tourist = [i for i in mv if _google_is_tourist(i)]
        if len(tourist) >= 3:
            buckets["must_visit"] = tourist
    return buckets


# ── GeoApify Places API v2 — PRIMARY preference-driven live tier ────────────
# Step 3 uses a real Places API for fast real-world discovery (product spec §5);
# GeoApify is that provider. Categories are REAL GeoApify taxonomy groups — the
# set sent for a destination is chosen by the user's selected EXPERIENCE, so
# the preference literally drives what the API is asked for (and therefore what
# can come back). Requests are batched (2 per discovery) to keep Step 3 fast.

# Always-on base categories per Travion bucket. Every category below was
# validated against the live GeoApify /v2/places endpoint — unsupported ones
# (e.g. activity.*, natural.*, tourism.museum) are rejected with HTTP 400 and
# would silently kill the whole batched request, so only verified taxonomy is
# used.
_BASE_GEOAPIFY_CATEGORIES: Dict[str, List[str]] = {
    "must_visit": ["tourism.attraction", "leisure.park"],
    "food": ["catering.restaurant", "catering.cafe", "catering.fast_food", "catering.food_court"],
    "stays": ["accommodation.hotel", "accommodation.guest_house", "accommodation.hostel",
              "accommodation.motel", "accommodation.apartment"],
    "activities": ["sport.sports_centre", "sport.fishing", "sport.stadium"],
}

# Experience-preference categories (product spec §4): the selected preference
# ADDS what the API is asked for — Adventure pulls parks + outdoor sport
# venues, Food & Culture pulls food markets + museums/cultural venues,
# Spiritual pulls places of worship, Mixed blends them all.
_GEOAPIFY_EXPERIENCE_CATEGORIES: Dict[str, List[str]] = {
    "adventure": ["leisure.park", "sport.sports_centre", "sport.fishing", "sport.stadium"],
    "food & culture": ["entertainment.museum", "entertainment.culture",
                       "entertainment.culture.theatre", "commercial.marketplace",
                       "commercial.shopping_mall"],
    "spiritual": ["religion.place_of_worship"],
    "mixed": ["religion.place_of_worship", "entertainment.museum", "entertainment.culture"],
}


def _geoapify_filter(
    bounds: Optional[Dict[str, Any]],
    anchor: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Real destination footprint as a GeoApify filter: the geocoded bounding
    rectangle when available, else a destination-kind-radius circle around the
    resolved anchor. NEVER a tiny 2 km circle — that belongs to nearby mode."""
    if bounds and bounds.get("north") is not None:
        return f"rect:{bounds['west']},{bounds['south']},{bounds['east']},{bounds['north']}"
    if anchor and anchor.get("lat") is not None and anchor.get("lng") is not None:
        radius_m = int(DESTINATION_RADIUS_KM.get(str((anchor or {}).get("kind") or "").lower(), 12.0) * 1000)
        return f"circle:{anchor['lng']},{anchor['lat']},{radius_m}"
    return None


def _geoapify_fetch(categories: List[str], geo_filter: str, api_key: str = "") -> List[Dict[str, Any]]:
    """One batched GeoApify Places request across the destination area.
    Delegates to the central GeoApify service (single key owner + TTL cache)."""
    try:
        from app.services import geoapify as _geo
        return _geo.places(list(categories), geo_filter, limit=60) or []
    except Exception:
        return []


def _geoapify_bucket(cats: List[str]) -> Optional[str]:
    """Map the feature's REAL GeoApify categories onto a Travion bucket.
    First match wins; unknown categories are honestly dropped."""
    for c in cats or []:
        if c.startswith("accommodation."):
            return "stays"
        if c.startswith("catering."):
            return "food"
        if c.startswith("sport."):
            return "activities"
        if (c.startswith("religion.place_of_worship") or c.startswith("entertainment.museum")
                or c.startswith("entertainment.culture") or c.startswith("tourism.attraction")
                or c == "leisure.park" or c.startswith("commercial.")):
            return "must_visit"
    return None


def _geoapify_item(feature: Dict[str, Any], category: str) -> Optional[Dict[str, Any]]:
    """Normalize one GeoApify feature into a Travion discovery item. Only real
    provider fields are surfaced — ratings/fees the provider does not give are
    left None, never invented."""
    props = feature.get("properties") or {}
    name = str(props.get("name") or "").strip()
    if not name:  # unnamed real features are useless for trip planning
        return None
    lat, lng = props.get("lat"), props.get("lon")
    if lat is None or lng is None:
        return None
    pid = props.get("place_id") or f"geoapify_{_norm(name)[:40]}_{round(float(lat), 4)}_{round(float(lng), 4)}"
    return {
        "id": f"geo_{str(pid)[:56]}",
        "place_id": pid,
        "name": name,
        "category": category,
        "latitude": lat,
        "longitude": lng,
        "address": props.get("formatted"),
        "rating": None,  # GeoApify places response carries no ratings — never invented
        "review_count": None,
        "types": props.get("categories") or [],
        "opening_hours": props.get("opening_hours"),
        "website": props.get("website"),
        "photos": [],
        "source": "geoapify",
        "verified": True,
        "entry_fee": None,
        "price_per_night": None,
        "duration_minutes": 90,
        "duration_is_estimate": True,
    }


def _discover_geoapify(
    destination: str,
    resolved: Dict[str, Any],
    api_key: str,
    experience: Optional[str] = None,
    bounds: Optional[Dict[str, Any]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """GeoApify PRIMARY live tier — TWO batched requests per discovery:
      1. attractions + the user's EXPERIENCE-preference categories,
      2. food + stays amenities.
    Categories come from REAL GeoApify taxonomy chosen by the preference, so a
    Spiritual selection literally asks the API for places of worship first.
    Results are classified back into Travion buckets by their own provider
    categories; on any failure empty buckets are returned so the lower tiers
    take over — nothing is ever invented."""
    buckets: Dict[str, List[Dict[str, Any]]] = {"must_visit": [], "food": [], "activities": [], "stays": []}
    geo_filter = _geoapify_filter(bounds, resolved)
    if not api_key or not geo_filter:
        return buckets
    exp_key = experience if experience in _GEOAPIFY_EXPERIENCE_CATEGORIES else "mixed"

    pref_cats: List[str] = list(_BASE_GEOAPIFY_CATEGORIES["must_visit"]) + list(_BASE_GEOAPIFY_CATEGORIES["activities"])
    pref_cats.extend(_GEOAPIFY_EXPERIENCE_CATEGORIES.get(exp_key, ()))
    pref_cats = list(dict.fromkeys(pref_cats))  # de-dup, preserve order

    amenity_cats: List[str] = list(dict.fromkeys(
        _BASE_GEOAPIFY_CATEGORIES["food"] + _BASE_GEOAPIFY_CATEGORIES["stays"]
    ))

    features: List[Dict[str, Any]] = []
    for cats in (pref_cats, amenity_cats):
        try:
            features.extend(_geoapify_fetch(cats, geo_filter, api_key))
        except Exception:
            continue  # provider failure must never break discovery — lower tiers take over
    if not features:
        return buckets

    for feature in features:
        props = feature.get("properties") or {}
        bucket = _geoapify_bucket(props.get("categories") or [])
        if not bucket:
            continue
        item = _geoapify_item(feature, bucket)
        if item:
            buckets[bucket].append(item)
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


def _overpass_query_at(loc: str) -> str:
    """Overpass query scoped to a `loc` sentence (bounding box or around) across
    node+way+relation so real attractions mapped as areas are included."""
    lines: List[str] = []
    for _, flt in _OSM_FILTERS:
        lines.append(f"  node{flt}{loc};")
        lines.append(f"  way{flt}{loc};")
        lines.append(f"  relation{flt}{loc};")
    return f"[out:json][timeout:25];(\n{chr(10).join(lines)}\n);out center tags 500;"


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


def _discover_osm(
    destination: str,
    resolved: Dict[str, Any],
    bounds: Optional[Dict[str, Any]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Live OpenStreetMap POI search across the DESTINATION AREA — a bounding
    box when geocoded, otherwise the destination's kind-based radius. ONE
    combined Overpass request (free API is rate-limited, so per-destination
    batching keeps us well within limits). Returns only real mapped features;
    on network failure returns empty buckets so lower tiers take over."""
    buckets: Dict[str, List[Dict[str, Any]]] = {"must_visit": [], "food": [], "activities": [], "stays": []}
    lat, lng = resolved["lat"], resolved["lng"]
    origin = (lat, lng)
    if bounds and bounds.get("north") is not None:
        loc = f"({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']})"
    else:
        radius_m = int(DESTINATION_RADIUS_KM.get(str(resolved.get("kind") or "").lower(), 12.0) * 1000)
        loc = f"(around:{radius_m},{lat},{lng})"
    q = _overpass_query_at(loc)
    data = _overpass_cached(q, timeout=12, attempts=1)
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


# ── Real MAP data: broader categories the map may show (never fabricated) ────

# The Step 3 map can plot MORE than the recommendation buckets. These broader
# map categories come ONLY from real providers (OSM tags / Google types) — when
# a provider has nothing, the map category is honestly empty.
MAP_CATEGORIES: List[str] = ["shopping", "healthcare", "education", "transport", "other"]
MAP_TARGET: int = 25  # cap per map category (broader than the recommended 10s, still real)

_OSM_MAP_FILTERS: List[Tuple[str, str]] = [
    ("shopping", 'node["shop"]'),
    ("shopping", 'way["shop"]'),
    ("healthcare", 'node["amenity"~"^(hospital|clinic|pharmacy)$"]'),
    ("healthcare", 'way["amenity"~"^(hospital|clinic|pharmacy)$"]'),
    ("education", 'node["amenity"~"^(school|university|college|kindergarten)$"]'),
    ("education", 'way["amenity"~"^(school|university|college|kindergarten)$"]'),
    ("transport", 'node["railway"="station"]'),
    ("transport", 'node["aeroway"="terminal"]'),
    ("transport", 'node["amenity"="bus_station"]'),
    ("transport", 'way["amenity"="bus_station"]'),
    ("other", 'node["leisure"~"^(cinema|golf_course|swimming_pool|bowling_alley|nightclub)$"]'),
    ("other", 'node["amenity"~"^(bar|cafe|casino)$"]'),
]


def _map_overpass_query(loc: str) -> str:
    lines: List[str] = []
    for _, flt in _OSM_MAP_FILTERS:
        lines.append(f"  node{flt}{loc};")
        lines.append(f"  way{flt}{loc};")
    return f"[out:json][timeout:30];(\n{chr(10).join(lines)}\n);out center tags 450;"


def _map_classify(tags: Dict[str, str]) -> Optional[str]:
    """Map REAL OSM tags to a broader map category (or None). Named features
    only — the caller drops unnamed ones via `_osm_item`."""
    if tags.get("shop"):
        return "shopping"
    amenity = tags.get("amenity", "")
    if amenity in {"hospital", "clinic", "pharmacy"}:
        return "healthcare"
    if amenity in {"school", "university", "college", "kindergarten"}:
        return "education"
    if tags.get("railway") == "station" or tags.get("aeroway") == "terminal" or amenity == "bus_station":
        return "transport"
    if tags.get("leisure") in {"cinema", "golf_course", "swimming_pool", "bowling_alley", "nightclub"}:
        return "other"
    if amenity in {"bar", "cafe", "casino"}:
        return "other"
    return None


def _overpass_cached(query: str, timeout: int, attempts: int = 2,
                     user_agent: str = "Travion/1.0 (travel planning)") -> Optional[Dict[str, Any]]:
    """Cached raw Overpass execution — the free API is slow and rate-limited, so
    identical destination queries are answered from a TTL cache instead of
    re-hitting it (every tier above Overpass must stay fast). `attempts` is 1
    for latency-sensitive paths that run only as a fallback tier."""
    key = f"overpass::{_norm(query)[:220]}"
    cached = _cache_get(key)
    if cached is not None:
        return cached if cached else None  # empty dict == known-failure marker
    data: Optional[Dict[str, Any]] = None
    for attempt in range(attempts):
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                resp = requests.post(endpoint, data={"data": query}, timeout=timeout,
                                     headers={"User-Agent": user_agent})
                if resp.status_code == 200:
                    data = resp.json()
                    break
            except Exception:
                continue
        if data:
            break
        time.sleep(2)
    _cache_set(key, data if data else {})
    return data


def _discover_map_osm(
    resolved: Dict[str, Any],
    bounds: Optional[Dict[str, Any]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """The map's OpenStreetMap tier: ONE combined Overpass query across the
    destination area returning real mapped shopping/healthcare/education/
    transport/other POIs. Returns empty buckets on any failure."""
    buckets: Dict[str, List[Dict[str, Any]]] = {c: [] for c in MAP_CATEGORIES}
    lat, lng = resolved.get("lat"), resolved.get("lng")
    if lat is None or lng is None:
        return buckets
    origin = (float(lat), float(lng))
    if bounds and bounds.get("north") is not None:
        loc = f"({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']})"
    else:
        radius_m = int(DESTINATION_RADIUS_KM.get(str(resolved.get("kind") or "").lower(), 12.0) * 1000)
        loc = f"(around:{radius_m},{lat},{lng})"
    q = _map_overpass_query(loc)
    data = _overpass_cached(q, timeout=18,
                            user_agent="Travion/1.0 (travel planning; map tier)")
    if not data:
        return buckets
    for el in (data.get("elements") or []):
        tags = el.get("tags") or {}
        cat = _map_classify(tags)
        if not cat:
            continue
        item = _osm_item(el, cat, origin=origin)
        if item:
            buckets[cat].append(item)
    return buckets


_GOOGLE_MAP_TYPES: Dict[str, set] = {
    "shopping": {"shopping_mall", "department_store", "market", "store", "furniture_store"},
    "healthcare": {"hospital", "pharmacy", "doctor", "dental_clinic"},
    "education": {"university", "school", "college", "library"},
    "transport": {"train_station", "airport", "transit_station", "bus_station", "subway_station"},
    "other": {"movie_theater", "amusement_park", "bar", "casino", "night_club", "bowling_alley"},
}

_GOOGLE_MAP_QUERIES: Dict[str, List[str]] = {
    "shopping": ["shopping malls in {d}", "markets in {d}", "department stores in {d}"],
    "healthcare": ["hospitals in {d}", "clinics in {d}", "pharmacies in {d}"],
    "education": ["universities in {d}", "schools in {d}", "colleges in {d}", "libraries in {d}"],
    "transport": ["railway stations in {d}", "airports in {d}", "bus stands in {d}"],
    "other": ["cinemas in {d}", "amusement parks in {d}", "bars in {d}"],
}


def _discover_google_map(
    destination: str,
    resolved: Dict[str, Any],
    api_key: str,
    bounds: Optional[Dict[str, Any]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    d = destination if resolved and _norm(resolved["name"]) == _norm(destination) else (
        f"{destination} {resolved['state']}" if resolved else destination
    )
    origin = (resolved["lat"], resolved["lng"]) if resolved and resolved.get("lat") and resolved.get("lng") else None
    radius_m = int(DESTINATION_RADIUS_KM.get(str(resolved.get("kind") or "").lower(), 12.0) * 1000) if origin else None
    buckets: Dict[str, List[Dict[str, Any]]] = {c: [] for c in MAP_CATEGORIES}
    for cat, queries in _GOOGLE_MAP_QUERIES.items():
        want_types = _GOOGLE_MAP_TYPES.get(cat, set())
        for template in queries:
            if len(buckets[cat]) >= MAP_TARGET:
                break
            for place in _google_search(template.format(d=d), api_key, center=origin, radius_m=radius_m, bounds=bounds):
                item = _google_item(place, cat)
                if not item:
                    continue
                types = set(item.get("types") or [])
                if types & want_types:
                    buckets[cat].append(item)
                elif len(buckets[cat]) < MAP_TARGET:
                    # the place came from a real category-flavoured query — keep
                    # it rather than over-silence a genuine result.
                    buckets[cat].append(item)
    return buckets


# The map's GeoApify tier: ONE batched request covers every broader map
# category (validated live taxonomy only).
_MAP_GEOAPIFY_CATEGORIES: Dict[str, List[str]] = {
    "shopping": ["commercial.marketplace", "commercial.shopping_mall"],
    "healthcare": ["healthcare"],
    "education": ["education"],
    "transport": ["public_transport"],
    "other": ["entertainment", "catering.bar"],
}


def _discover_geoapify_map(
    resolved: Dict[str, Any],
    api_key: str,
    bounds: Optional[Dict[str, Any]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """The map's FAST GeoApify tier — a single batched request returning real
    shopping/healthcare/education/transport/entertainment POIs across the
    destination area. Empty buckets on any failure."""
    buckets: Dict[str, List[Dict[str, Any]]] = {c: [] for c in MAP_CATEGORIES}
    geo_filter = _geoapify_filter(bounds, resolved)
    if not geo_filter:
        return buckets
    all_cats: List[str] = []
    for cats in _MAP_GEOAPIFY_CATEGORIES.values():
        all_cats.extend(cats)
    features = _geoapify_fetch(list(dict.fromkeys(all_cats)), geo_filter, api_key)
    for feature in features:
        props = feature.get("properties") or {}
        cats = props.get("categories") or []
        target: Optional[str] = None
        for c in cats or []:
            if c.startswith("commercial."):
                target = "shopping"
            elif c.startswith("healthcare."):
                target = "healthcare"
            elif c.startswith("education."):
                target = "education"
            elif c.startswith("public_transport."):
                target = "transport"
            elif c.startswith("entertainment.") or c == "catering.bar":
                target = "other"
            if target:
                break
        if not target:
            continue
        item = _geoapify_item(feature, target)
        if item:
            buckets[target].append(item)
    return buckets


def discover_map(
    destination: str,
    resolved: Dict[str, Any],
    origin: Optional[Tuple[float, float]] = None,
    dest_radius_km: float = 12.0,
    core_km: float = 1.0,
    bounds: Optional[Dict[str, Any]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """The map's REAL broader dataset (shopping / healthcare / education /
    transport / other) — destination-wide, provider-verified only. Never
    fabricates a marker. GeoApify is the fast primary tier; the slow free
    Overpass query runs ONLY for categories it could not fill. When no live
    tier is reachable the category is honestly empty and the map shows the
    recommendation data instead."""
    if not resolved or resolved.get("lat") is None or resolved.get("lng") is None:
        return {c: [] for c in MAP_CATEGORIES}
    api_key: Optional[str] = None
    geoapify_key: Optional[str] = None
    try:
        from app.core.config import settings
        api_key = (getattr(settings, "GOOGLE_PLACES_API_KEY", "") or "").strip() or None
        geoapify_key = (getattr(settings, "GEOAPIFY_API_KEY", "") or "").strip() or None
    except Exception:
        api_key = None
        geoapify_key = None
    buckets: Dict[str, List[Dict[str, Any]]] = {c: [] for c in MAP_CATEGORIES}
    if geoapify_key:
        try:
            geo = _discover_geoapify_map(resolved, geoapify_key, bounds=bounds)
            for k, v in geo.items():
                buckets[k].extend(v)
        except Exception:
            pass
    if api_key:
        try:
            google = _discover_google_map(destination, resolved, api_key, bounds=bounds)
            for k, v in google.items():
                buckets[k].extend(v)
        except Exception:
            pass
    # Overpass top-up ONLY when the fast tiers essentially failed (4+ of 5 map
    # categories empty) — the free API is slow and must never gate Step 3
    # latency when a keyed tier already delivered real data.
    if sum(1 for c in MAP_CATEGORIES if not buckets[c]) >= len(MAP_CATEGORIES) - 1:
        try:
            osm = _discover_map_osm(resolved, bounds=bounds)
            for k, v in osm.items():
                if not buckets[k]:
                    buckets[k].extend(v)
        except Exception:
            pass
    out: Dict[str, List[Dict[str, Any]]] = {}
    for cat in MAP_CATEGORIES:
        items = _dedup(buckets.get(cat) or [])
        items = _filter_by_destination(items, origin, dest_radius_km, bounds=bounds)
        for it in items:
            it["placement"] = _placement_for(it, origin, core_km)
            it["inside_destination"] = True
        out[cat] = items[:MAP_TARGET]
    return out


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
    for a in activity_pool[: TARGET_COUNTS["activities"] * 2]:
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
    destination. Distance-based relevance; no invented fields. Entries are later
    filtered to the destination footprint (bounding box / destination radius)
    exactly like every other real source."""
    if not resolved:
        return []
    origin = (resolved["lat"], resolved["lng"])
    nearby: List[Dict[str, Any]] = []
    for p in INDIA_PLACES:
        km = _haversine_km(origin, (p["lat"], p["lng"]))
        if 0 < km <= 350:  # realistic journey radius around the destination
            # Administrative districts/cities around the destination (e.g.
            # "Central Delhi") are not tourist places — prefer real POIs.
            if p.get("kind") in ("district", "city"):
                continue
            nearby.append((km, p))
    nearby.sort(key=lambda t: t[0])
    items: List[Dict[str, Any]] = []
    count = 0
    for km, p in nearby:
        if count >= 40:
            break
        count += 1
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


def _index_topup(
    resolved: Dict[str, Any],
    origin: Optional[Tuple[float, float]],
    dest_radius_km: float,
    bounds: Optional[Dict[str, Any]],
    used_names: set,
    core_km: float,
    slack: int,
    max_km: float = 350.0,
) -> List[Dict[str, Any]]:
    """Fill-to-target from the REAL GeoNames index: real spare places around the
    destination that are NOT already shown, inside the destination footprint.

    This is the mechanism behind "10 must-visits and 10 activities for EVERY
    destination": when live providers / the curated catalog cannot supply the
    full pool, verified gazetteer entries (real town/place entries, districts
    and cities excluded) top the section up. Nothing is ever invented — every
    top-up carries its real coordinates, distance and ``geonames_local_index``
    provenance, and the planner sees an honest *close-by region* place."""
    if not resolved or not origin or slack <= 0:
        return []
    out: List[Dict[str, Any]] = []
    seen_names = set(used_names)
    seen_ids: set = set()
    # Real journey radius (whole touring region around the destination, e.g.
    # Ooty → Coonoor/Kotagiri/Nilgiris). These are ALL real gazetteer places —
    # the guarantee "10 real options for every category" is met from this wider
    # honest pool when the destination core itself has fewer.
    journey_radius_km: float = max(dest_radius_km, 350.0)
    sorted_by_km = sorted(
        (
            (p, _haversine_km(origin, (p["lat"], p["lng"])))
            for p in INDIA_PLACES
            if p.get("kind") in ("place", "town")
        ),
        key=lambda t: t[1],
    )
    for p, km in sorted_by_km:
        if len(out) >= slack:
            break
        if km <= 0 or km > min(max_km, journey_radius_km):
            continue
        if p["name"] in seen_names or p["id"] in seen_ids:
            continue
        if bounds and bounds.get("north") is not None:
            if not (bounds["south"] - 0.02 <= p["lat"] <= bounds["north"] + 0.02
                    and bounds["west"] - 0.02 <= p["lng"] <= bounds["east"] + 0.02):
                continue
        item: Dict[str, Any] = {
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
        }
        item["placement"] = _placement_for(item, origin, core_km)
        item["inside_destination"] = True
        out.append(item)
        seen_names.add(p["name"])
        seen_ids.add(p["id"])
    return out


# ── Dedup + ranking ──────────────────────────────────────────────────────────

def _dedup(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicate by provider place_id, then by normalized name + proximity
    (<250 m) — "Charminar", "Charminar, Hyderabad" and "Charminar Monument"
    collapse to one record."""
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

# ── Experience-preference ranking (product rule: the selected experience must
# DIRECTLY control place discovery and ranking — never a generic popular list).
# The 3-question interview stores one canonical experience; these keyword groups
# carry that preference into the real ranking function below. Keyword groups
# also include the NORMALIZED provider-type tokens (e.g. "place of worship",
# "sports centre") so GeoApify/Google typed places match without name hints.
_EXPERIENCE_KEYWORDS = {
    "adventure": (
        "trek", "trekking", "hike", "hiking", "trail", "viewpoint", "view point",
        "peak", "waterfall", "falls", "rafting", "kayak", "diving", "snorkel",
        "surf", "camping", "adventure", "paragliding", "zip", "ropeway", "gondola",
        "safari", "climb", "climbing", "canyon", "gorge", "outdoor", "nature park",
        "sanctuary", "park", "garden", "lake", "stadium", "sports centre", "dam",
        "zoo", "surfing", "snorkeling", "boating",
    ),
    "food & culture": (
        "restaurant", "cafe", "food", "street food", "bakery", "cuisine", "kitchen",
        "market", "bazaar", "heritage", "museum", "monument", "fort", "palace",
        "cultural", "craft", "artisan", "food street", "chowk", "culinary",
        "theatre", "theater", "shopping mall", "shopping", "convention", "marketplace",
    ),
    "spiritual": (
        "temple", "church", "mosque", "gurudwara", "ashram", "monastery", "pilgrim",
        "shrine", "dargah", "basilica", "meditation", "spiritual", "mutt", "math",
        "ganga", "ghat", "sacred", "jyotirlinga", "worship", "cathedral", "masjid",
        "hinduism", "christianity", "islam", "jain", "sikh",
    ),
    "mixed": (),  # balanced — no single-keyword boost, pure famousness ranking
}

# Single-token names that read as provider noise rather than a real, specific
# destination ("temple", "parking", "gate"). Real features — but a traveller
# cannot plan a visit to "the place called Temple". They are demoted below
# named places, never fabricated away.
_GENERIC_PLACE_NAMES = {
    "temple", "mosque", "church", "shrine", "gurudwara", "masjid", "cathedral",
    "park", "garden", "museum", "stadium", "gate", "parking", "fort", "palace",
    "lake", "beach", "waterfall", "market", "bazaar", "mall", "zoo", "pool",
}


def _experience_label(value: Any) -> str:
    """Map any stored experience value onto a canonical keyword group."""
    if isinstance(value, (list, tuple)):
        value = ", ".join(str(v) for v in value)
    low = str(value or "").strip().lower()
    if not low:
        return "mixed"
    if "adventure" in low or "trek" in low:
        return "adventure"
    if "spiritual" in low or "temple" in low or "pilgrim" in low:
        return "spiritual"
    if "food" in low or "culture" in low or "culinary" in low:
        return "food & culture"
    return "mixed"


def _rank(
    items: List[Dict[str, Any]],
    interests: List[str],
    veg_only: bool,
    inside_first: bool = True,
    experience: Optional[str] = None,
) -> List[Dict[str, Any]]:
    # Defensive coercion: a caller passing a bare string (e.g. "Spiritual") must
    # not be iterated character-by-character — it is ONE preference.
    if isinstance(interests, str):
        interests = [interests] if interests.strip() else []
    """Rank real places by FAMOUSNESS + relevance (rating, review volume,
    source confidence, interest/keyword match, tourist category) — NOT by
    distance to the centre. Places INSIDE the destination core still outrank
    the wider destination, each group keeping score order.

    ``experience`` is the user's selected preference (Adventure / Food & Culture
    / Spiritual / Mixed). Matching places get a dominant keyword boost so the
    preference controls the final ordering — a Spiritual selection surfaces
    temples first, an Adventure selection surfaces treks and viewpoints first.
    """
    exp_key = _experience_label(experience or ", ".join(str(i) for i in interests))
    exp_keywords = _EXPERIENCE_KEYWORDS.get(exp_key, ())

    # Single-word keywords match TOKENS with only plural suffixes allowed
    # ("park" matches "parks" but NEVER "parking"; "temple" matches "temples").
    # Multi-word phrases match as substrings ("sports centre", "shopping mall").
    _KW_SUFFIXES = {"s", "es"}

    def _kw_hit(haystack: str, kw: str) -> bool:
        if " " in kw:
            return kw in haystack
        return any(tok == kw or (tok.startswith(kw) and tok[len(kw):] in _KW_SUFFIXES)
                   for tok in haystack.split())

    def _haystack(item: Dict[str, Any]) -> str:
        # Provider type tokens carry dots/underscores ("religion.place_of_worship",
        # "sport.sports_centre") — split them into words so type evidence stays
        # matchable after normalization.
        types_text = " ".join(str(t).replace(".", " ").replace("_", " ") for t in (item.get("types") or []))
        return _norm(f"{item.get('name', '')} {item.get('category', '')} {item.get('address', '')} "
                     f"{item.get('description', '')} {types_text}")

    def _matched(item: Dict[str, Any]) -> bool:
        return any(_kw_hit(_haystack(item), kw) for kw in exp_keywords)

    def score(item: Dict[str, Any]) -> float:
        s = 0.0
        rating = item.get("rating")
        if rating is not None:
            s += float(rating) * 2
            s += min(float(item.get("review_count") or 0), 2000) / 50.0  # review volume up to +40
        if item.get("source") == "geoapify":
            s += 1.0
        if item.get("source") == "google_places":
            s += 1.0
        if item.get("source") in ("verified_api", "guide_submitted"):
            s += 0.5
        if item.get("category") == "activities":
            s += 0.5
        haystack = _haystack(item)
        for interest in interests:
            for kw in _INTEREST_KEYWORDS.get(str(interest).strip().lower(), ()):
                if _kw_hit(haystack, kw):
                    s += 2.0
        # The selected experience preference DOMINATES the score: every keyword
        # hit is worth +6 (vs +2 for generic interests), so a preference-matched
        # place outranks a merely-famous unrelated one.
        for kw in exp_keywords:
            if _kw_hit(haystack, kw):
                s += 6.0
        if exp_key != "mixed" and item.get("category") in (
            "food", "stays",
        ) and exp_key not in ("food & culture",):
            # For Adventure/Spiritual selections, food/stay entries must not
            # crowd out preference-matched places in the must-visit list.
            s -= 3.0
        return s

    items = sorted(items, key=score, reverse=True)
    if inside_first:
        # Destination-core places always outrank the wider destination, each
        # group keeping score order.
        inside = [i for i in items if i.get("placement") == "inside"]
        nearby = [i for i in items if i.get("placement") != "inside"]
        items = inside + nearby
    if exp_key != "mixed" and exp_keywords:
        # THE PREFERENCE WINS (product spec §4): every preference-matched place
        # — by name, category, address, description OR provider types — comes
        # before every unmatched one, each group keeping its score order. This
        # is a hard partition, not a soft boost, so a famous but unrelated
        # attraction can never crowd out the temples/treks/food markets the
        # user actually asked for. Applied LAST so it outranks the geography
        # partition: a matched place beyond the destination core still ranks
        # above an unmatched one in the core.
        matched = [i for i in items if _matched(i)]
        rest = [i for i in items if not _matched(i)]
        # Within the matched group, properly-NAMED places outrank generic
        # provider noise (a feature literally called "temple", "parking" or
        # "gate" is real but useless for trip planning). Named first, generic
        # after — both keep their score order.
        def _generic_named(it: Dict[str, Any]) -> bool:
            tokens = _norm(it.get("name", "")).split()
            return len(tokens) == 1 and (tokens[0] in _GENERIC_PLACE_NAMES or len(tokens[0]) <= 3)
        items = [i for i in matched if not _generic_named(i)] + \
                [i for i in matched if _generic_named(i)] + rest
    if veg_only:
        veg_first = [i for i in items if "veg" in _norm(str(i.get("veg_type") or " veg"))]
        veg_first.extend(i for i in items if "veg" not in _norm(str(i.get("veg_type") or " veg")))
        # Only reorder the food bucket's semantics at the caller level; here keep global order.
    return items


def _significant_tokens(text: str) -> set:
    """Meaningful name tokens (>=3 chars) — used to detect real duplicates
    across different spellings/categories without false positives on short
    common words like 'the', 'new', 'old'."""
    return {tok for tok in _norm(text).split() if len(tok) >= 3}


def _unique_activities(
    activity_items: List[Dict[str, Any]],
    must_visit_items: List[Dict[str, Any]],
    proximity_km: float = 0.35,
) -> List[Dict[str, Any]]:
    """Single source of truth for the 'Activities never duplicate Must-Visit'
    rule (spec: an activity cannot be the same place already shown as a
    must-visit attraction).

    A candidate activity is REJECTED (and the next real candidate takes its
    slot) when it collides with any must-visit on:
      1. provider place_id equality,
      2. real-world coordinates within ``proximity_km`` (same physical place),
      3. name overlap >= 2 significant tokens (e.g. 'Golconda Fort' vs
         'Golconda Fort Experience'),
      4. description overlap >= 2 significant tokens (same place, different
         title), OR a must-visit name that is fully contained in the activity's
         name/description and vice-versa.

    Nothing is invented to fill a rejected slot — the remaining real candidates
    simply move up in order."""
    collisions: List[bool] = [False] * len(activity_items)
    mv_norm = [_norm(item.get("name", "")) for item in must_visit_items]
    mv_tokens = [_significant_tokens(item.get("name", "")) for item in must_visit_items]
    mv_desc = [_significant_tokens(item.get("description", "")) for item in must_visit_items]

    def _collides(a: Dict[str, Any]) -> bool:
        pid = str(a.get("place_id") or "").strip()
        if pid:
            for m in must_visit_items:
                if str(m.get("place_id") or "").strip() == pid:
                    return True
        a_lat, a_lng = a.get("latitude"), a.get("longitude")
        if a_lat is not None and a_lng is not None:
            for m in must_visit_items:
                m_lat, m_lng = m.get("latitude"), m.get("longitude")
                if m_lat is not None and m_lng is not None:
                    if _haversine_km((float(a_lat), float(a_lng)), (float(m_lat), float(m_lng))) <= proximity_km:
                        return True
        a_tokens = _significant_tokens(a.get("name", ""))
        a_body = _significant_tokens(f"{a.get('name', '')} {a.get('description', '')}")
        for idx, m in enumerate(must_visit_items):
            if len(a_tokens & mv_tokens[idx]) >= 2:
                return True
            m_norm = mv_norm[idx]
            if m_norm and (m_norm in _norm(a.get("name", "")) or _norm(a.get("name", "")) in m_norm):
                return True
            if mv_desc[idx] and len(a_body & mv_desc[idx]) >= 2:
                return True
        return False

    kept: List[Dict[str, Any]] = []
    for item in activity_items:
        if not _collides(item):
            kept.append(item)
    return kept


# ── Public entry points ─────────────────────────────────────────────────────

def discover_destination(
    destination: str,
    preferences: Optional[Dict[str, Any]] = None,
    coords: Optional[Tuple[float, float]] = None,
    state: Optional[str] = None,
) -> Dict[str, Any]:
    """DESTINATION-WIDE discovery pipeline. Searches the destination as a whole
    geographic area (geocoded bounding box, else the destination's kind radius)
    and returns real tourist places, activities, restaurants and stays — up to
    the TARGET_COUNTS. NEVER restricted to a 2 km circle; the 2 km rule belongs
    to the separate "nearby" mode (see discover_nearby). Never returns invented
    places; categories may legitimately be fewer than the target when no source
    can verify more, and empty when the destination has no verifiable results.

    ``coords`` and ``state`` are the traveller's REGISTERED destination
    coordinates/state (from the real location picker). They are used to (a)
    disambiguate name lookups (Manali TN vs HP), and (b) run the place search
    around the exact registered spot even when the name is unindexed — so ANY
    destination still returns real places."""
    prefs = preferences or {}
    interests_raw = prefs.get("interests") or prefs.get("experience") or []
    # A bare string preference ("Spiritual") is ONE interest, not an iterable of
    # characters — coerce before it feeds ranking and cache keys.
    if isinstance(interests_raw, str):
        interests_raw = [interests_raw] if interests_raw.strip() else []
    interests = [str(x) for x in interests_raw]
    veg_only = any("veg" in str(x).lower() and "non" not in str(x).lower()
                   for x in (prefs.get("restrictions") or []))

    state_key = _norm(state) if state else ""
    coord_key = (
        f"{round(coords[0], 3)},{round(coords[1], 3)}" if coords and len(coords) == 2 else ""
    )
    exp_key = _experience_label(prefs.get("experience"))
    cache_key = f"disc::{_norm(destination)}::{state_key}::{coord_key}::{sorted(interests)}::{exp_key}::{veg_only}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    resolved = _resolve_destination(destination, coords=coords, state=state)
    api_key: Optional[str] = None
    geoapify_key: Optional[str] = None
    try:
        from app.core.config import settings
        api_key = (getattr(settings, "GOOGLE_PLACES_API_KEY", "") or "").strip() or None
        geoapify_key = (getattr(settings, "GEOAPIFY_API_KEY", "") or "").strip() or None
    except Exception:
        api_key = None
        geoapify_key = None

    # Registered coordinates are ground truth: search around them even when the
    # name isn't in the gazetteer (e.g. "Cochin", "Dharamshala").
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

    dest_kind = str((anchor or {}).get("kind") or "town").lower()
    dest_radius_km = DESTINATION_RADIUS_KM.get(dest_kind, 12.0)

    # The curated verified catalog is evaluated BEFORE deciding whether live
    # tiers are even needed: for a destination the catalog fully covers we skip
    # the (rate-limited, sometimes slow) Overpass tier entirely — curated real
    # stays/food/attractions are sufficient and always deterministic.
    catalog = _catalog_items(destination)

    # The real live tier (Google when keyed, keyless OpenStreetMap otherwise)
    # ALWAYS runs for a resolved destination: it is the mechanism that lets
    # every section reach its full pool of REAL places (10 restaurants /
    # 10 stays / 10 activities are the norm across real-world destinations).
    # Provider results are additive — they can only ever increase the honest
    # real pool, and the same no-invention filters apply to them.
    use_live = bool(anchor)
    # Destination geography: geocode ONLY when a live tier will actually run
    # (geocoding is optional and network-based; deterministic offline).
    bounds: Optional[Dict[str, Any]] = None
    if use_live:
        try:
            bounds = _geocode_destination(destination, state=state) or None
        except Exception:
            bounds = None

    buckets: Dict[str, List[Dict[str, Any]]] = {"must_visit": [], "food": [], "activities": [], "stays": []}
    source: Optional[str] = None
    # PRIMARY live tier — GeoApify Places API with EXPERIENCE-driven categories.
    # The user's selected preference decides what the provider is asked for, so
    # discovery is preference-driven from the very first API call (spec §4+§5).
    if geoapify_key and anchor:
        geo = _discover_geoapify(
            destination, anchor, geoapify_key,
            experience=_experience_label(prefs.get("experience")),
            bounds=bounds,
        )
        for k, v in geo.items():
            buckets[k].extend(v)
        if any(buckets.values()):
            source = "geoapify"
    if api_key and anchor:
        google = _discover_google(destination, anchor, api_key, bounds=bounds)
        for k, v in google.items():
            buckets[k].extend(v)
        if not source:
            source = "google_places"

    # Curated verified data is layered on top of the keyed live tiers.
    for k, v in catalog.items():
        buckets[k].extend(v)

    # Keyless live tier: OpenStreetMap real POIs (restaurants, hotels,
    # attractions, experiences) — run ONLY when a bucket is still EMPTY after
    # the fast tiers (GeoApify + curated catalog). The free Overpass API takes
    # tens of seconds and must never gate Step 3 latency when a keyed tier
    # already delivered real data (spec rule 19: optimize API calls so place
    # generation is fast). It remains the honest fallback for destinations the
    # fast tiers cannot cover.
    if anchor and any(not buckets[k] for k in buckets):
        try:
            osm = _discover_osm(destination, anchor, bounds=bounds)
        except Exception:
            osm = {"must_visit": [], "food": [], "activities": [], "stays": []}
        for k, v in osm.items():
            if len(buckets[k]) < TARGET_COUNTS.get(k, 10):  # OSM never crowds out richer sources
                buckets[k].extend(v)
        # Attribution stays honest: a destination with its own curated catalog
        # does not get mis-labelled as an OpenStreetMap result.
        if any(buckets.values()) and not source and not any(catalog.values()):
            source = "openstreetmap"

    # Last-gap fill from the real GeoNames index, INSIDE the destination only:
    # contributes real gazetteer entries when the must-visit pool is under
    # target. Filtered/ranked with everything else, so famous attractions stay
    # on top.
    if anchor and len(buckets["must_visit"]) < TARGET_COUNTS["must_visit"]:
        slack = TARGET_COUNTS["must_visit"] - len(buckets["must_visit"])
        buckets["must_visit"].extend(_index_items(destination, anchor)[:slack])
    if synthetic_anchor and anchor is not None and source is None:
        source = "registered_local_index"
    if any(buckets.values()) and not source:
        source = "verified_local"

    result: Dict[str, Any] = {"destination": destination, "resolved": anchor, "source": source}
    if anchor and anchor.get("lat") is not None and anchor.get("lng") is not None:
        result["destination_latitude"] = anchor["lat"]
        result["destination_longitude"] = anchor["lng"]
    origin = (anchor["lat"], anchor["lng"]) if anchor and anchor.get("lat") and anchor.get("lng") else None
    core_km = _core_radius_kms(dest_kind)
    result["core_radius_km"] = core_km
    result["destination_radius_km"] = dest_radius_km
    if bounds:
        result["destination_bounds"] = {k: bounds[k] for k in ("south", "west", "north", "east")}

    total = 0
    catalog_meta: Dict[str, Any] = {}
    map_candidates: Dict[str, List[Dict[str, Any]]] = {}
    # Destination-wide boundary: keep real places INSIDE the destination
    # (bounding box, else the destination's own kind radius). There is NO 2 km
    # cap here — that cap belongs to "nearby" mode only.
    for category in ("must_visit", "food", "activities", "stays"):
        requested = TARGET_COUNTS.get(category, 10)
        items = _dedup(buckets.get(category) or [])
        items = _filter_by_destination(items, origin, dest_radius_km, bounds=bounds)
        for item in items:
            item["placement"] = _placement_for(item, origin, core_km)
            item["inside_destination"] = True
        # Famousness ranking (rating/reviews/relevance — not distance), then
        # truncate to the target pool size. The user's selected EXPERIENCE
        # preference dominates the ordering (see _rank).
        items = _rank(items, interests, veg_only, inside_first=True, experience=prefs.get("experience"))
        if category == "activities":
            # Spec: Activities must never duplicate a Must-Visit already shown.
            # The dedup runs after ranking, so rejected candidates leave the
            # NEXT best real activity to take the slot — nothing is invented.
            items = _unique_activities(items, result.get("must_visit") or [])
        # THE MAP SHOWS EVERY REAL CANDIDATE — not just the top-ten cards. This
        # full pool (deduped + geofiltered + ranked, then extended by any topup
        # below) is what the Step-3 map plots, so every restaurant, stay/hotel
        # and must-visit attraction in the destination appears on the map.
        # Nothing beyond the real candidate pool is ever fabricated.
        full_pool = list(items)
        items = items[: requested]
        # GUARANTEED FULL POOLS — real, never invented. When live providers and
        # the curated catalog cannot supply the whole section, verified GeoNames
        # gazetteer entries INSIDE the destination footprint fill must-visit /
        # activities to the requested count. Food/stays fill from the always-on
        # real provider pool instead (10 real restaurants/hotels per destination
        # is the production norm). Nothing is fabricated to reach the number.
        if category in ("must_visit", "activities") and len(items) < requested:
            slack = requested - len(items)
            topup = _index_topup(
                anchor, origin, dest_radius_km, bounds,
                used_names={i.get("name", "") for i in items}
                | ({i.get("name", "") for i in result.get("must_visit", [])} if category == "activities" else set()),
                core_km=core_km, slack=slack,
            )
            if topup:
                items = _rank(items + topup, interests, veg_only, inside_first=True, experience=prefs.get("experience"))
                items = items[: requested]
                full_pool = _rank(list(full_pool) + topup, interests, veg_only, inside_first=True, experience=prefs.get("experience"))
        result[category] = items
        result.setdefault("counts", {})[category] = len(items)
        total += len(items)
        map_candidates[category] = full_pool
        # HONEST discovery contract: every section reports how many real places
        # were requested vs actually available, so the UI can never show "10"
        # when only 6 verified things exist.
        catalog_meta[category] = {
            "requested": requested,
            "available": len(items),
            "status": "success" if items else "unavailable",
            "note": f"Found {len(items)} of {requested} requested real places." if items else (
                "No verified real places available in this category for this destination."
            ),
        }
    result["catalog_meta"] = catalog_meta
    result["map_candidates"] = map_candidates

    # Real MAP data: broader categories (shopping/healthcare/education/
    # transport/other) via the always-on real provider tier — the map is
    # allowed to plot MORE than the recommendation buckets, but never a
    # fabricated marker.
    map_places: Dict[str, List[Dict[str, Any]]] = {}
    map_counts: Dict[str, int] = {}
    if anchor and use_live:
        map_places = discover_map(
            destination, anchor,
            origin=origin, dest_radius_km=dest_radius_km,
            core_km=core_km, bounds=bounds,
        )
        for _cat, _items in map_places.items():
            map_counts[_cat] = len(_items)
    result["map_places"] = map_places
    result["map_counts"] = map_counts

    result["total_places"] = total
    # Report the provider that actually produced the visible places (honest UI
    # badge), keeping live providers preferred over local fallbacks.
    if source in (None, "verified_local", "registered_local_index") and total:
        latest_rank = ("geoapify", "google_places", "openstreetmap", "verified_api", "geonames_local_index",
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
        "We're unable to verify any real places for this destination right now."
    )
    _cache_set(cache_key, result)
    return result


def discover_nearby(destination: str, name: str, coords: Tuple[float, float]) -> Dict[str, Any]:
    """NEARBY mode — the ONLY 2 km-scoped search. Used when the user explicitly
    wants places near a specific selected spot ("places near Charminar"). The
    hard 2 km cap is enforced at both the provider layer (2 km circle) and the
    backend (`_filter_by_distance`). This mode is intentionally SEPARATE from
    destination-wide discovery so the two are never mixed."""
    if not coords or len(coords) != 2:
        return {"reference": name, "radius_km": MAX_DISTANCE_KM,
                "attractions": [], "food": [], "stays": [], "activities": []}
    origin = (float(coords[0]), float(coords[1]))
    radius_m = int(MAX_DISTANCE_KM * 1000)
    api_key: Optional[str] = None
    try:
        from app.core.config import settings
        api_key = (getattr(settings, "GOOGLE_PLACES_API_KEY", "") or "").strip() or None
    except Exception:
        api_key = None

    buckets: Dict[str, List[Dict[str, Any]]] = {"attractions": [], "food": [], "stays": [], "activities": []}
    cat_for_query = [
        ("attractions", f"attractions near {name}"),
        ("food", f"restaurants near {name}"),
        ("activities", f"things to do near {name}"),
        ("stays", f"hotels near {name}"),
    ]
    # GeoApify nearby tier: same provider, hard 2 km circle filter — the ONLY
    # mode allowed to be radius-scoped this tight.
    try:
        from app.core.config import settings as _s
        _gk = (getattr(_s, "GEOAPIFY_API_KEY", "") or "").strip()
    except Exception:
        _gk = ""
    if _gk:
        geo_filter = f"circle:{origin[1]},{origin[0]},{radius_m}"
        features = _geoapify_fetch(
            list(dict.fromkeys(
                _BASE_GEOAPIFY_CATEGORIES["must_visit"] + _BASE_GEOAPIFY_CATEGORIES["activities"]
                + _GEOAPIFY_EXPERIENCE_CATEGORIES["mixed"] + _BASE_GEOAPIFY_CATEGORIES["food"]
                + _BASE_GEOAPIFY_CATEGORIES["stays"]
            )),
            geo_filter, _gk,
        )
        for feature in features:
            props = feature.get("properties") or {}
            bucket = _geoapify_bucket(props.get("categories") or [])
            if not bucket:
                continue
            item = _geoapify_item(feature, bucket)
            if item:
                buckets[bucket].append(item)
    if api_key:
        for cat, query in cat_for_query:
            for place in _google_search(query, api_key, center=origin, radius_m=radius_m):
                item = _google_item(place, cat)
                if item:
                    buckets[cat].append(item)

    try:
        osm = _discover_osm(destination, {
            "id": "nearby_anchor", "name": name, "state": "", "lat": origin[0],
            "lng": origin[1], "kind": "place",
        }, bounds=None)
        for k, v in osm.items():
            buckets[k].extend(v)
    except Exception:
        pass

    for cat in buckets:
        items = _filter_by_distance(buckets[cat], origin, MAX_DISTANCE_KM)
        buckets[cat] = _dedup(items)[:5]

    return {"reference": name, "radius_km": MAX_DISTANCE_KM, **buckets}