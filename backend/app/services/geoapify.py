"""GeoApify service layer — Travion's geographic ground truth.

ONE service for every GeoApify API Travion uses (key stays server-side, read
from settings.GEOAPIFY_API_KEY):

  * Geocoding          — destination text -> real coordinates + metadata
  * Reverse Geocoding  — coordinates -> address
  * Places             — real POI discovery in a destination region
  * Place Details      — details for one provider place_id
  * Map Tiles / Static Maps / Marker Icons — map rendering assets
  * Routing            — real road distance/time between two points
  * Route Matrix       — many-to-many distance/time in one request
  * Isolines           — reachability polygons (time/distance)
  * Batch API          — bulk geocode/route jobs (free tier: sync jobs)

Principles:
  * the key NEVER leaves the server — the frontend talks only to Travion APIs
  * every function degrades honestly: on failure it returns None / empty and
    never invents data
  * responses are cached (TTL) so repeated planning sessions are fast
"""

import math
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

from app.core.config import settings

API = "https://api.geoapify.com"
MAPS = "https://maps.geoapify.com"

_CACHE: Dict[str, Tuple[float, Any]] = {}
_CACHE_TTL = 6 * 60 * 60
_CACHE_MAX = 800

# Experience -> GeoApify category sets (validated against the live API — the
# provider 400s on unsupported categories, which would kill a batched request).
EXPERIENCE_CATEGORIES: Dict[str, List[str]] = {
    "adventure": ["leisure.park", "sport.sports_centre", "sport.fishing", "sport.stadium"],
    "food & culture": ["entertainment.museum", "entertainment.culture",
                       "entertainment.culture.theatre", "commercial.marketplace",
                       "commercial.shopping_mall"],
    "spiritual": ["religion.place_of_worship"],
    "mixed": ["religion.place_of_worship", "entertainment.museum", "entertainment.culture"],
}

BASE_CATEGORIES: Dict[str, List[str]] = {
    "must_visit": ["tourism.attraction", "leisure.park"],
    "food": ["catering.restaurant", "catering.cafe", "catering.fast_food", "catering.food_court"],
    "stays": ["accommodation.hotel", "accommodation.guest_house", "accommodation.hostel",
              "accommodation.motel", "accommodation.apartment"],
    "activities": ["sport.sports_centre", "sport.fishing", "sport.stadium"],
}

# Real GeoApify icon names per Travion bucket (used by the Marker Icon API).
CATEGORY_ICONS: Dict[str, str] = {
    "must_visit": "camera",
    "food": "restaurant",
    "stays": "bed",
    "activities": "sports_soccer",
    "healthcare": "local_hospital",
    "shopping": "shopping_cart",
    "education": "school",
    "transport": "train",
    "other": "star",
}

# GeoApify travel modes accepted by routing/matrix/isoline.
TRAVEL_MODES = {"drive", "truck", "motorcycle", "walk", "hike", "bicycle", "scooter", "bus", "rail", "transit"}


def _key() -> str:
    return (getattr(settings, "GEOAPIFY_API_KEY", "") or "").strip()


def has_key() -> bool:
    return bool(_key())


def _cache_get(key: str) -> Optional[Any]:
    hit = _CACHE.get(key)
    if hit and (time.time() - hit[0]) < _CACHE_TTL:
        return hit[1]
    return None


def _cache_set(key: str, value: Any) -> None:
    _CACHE[key] = (time.time(), value)
    if len(_CACHE) > _CACHE_MAX:
        for k in sorted(_CACHE, key=lambda k: _CACHE[k][0])[: _CACHE_MAX // 4]:
            _CACHE.pop(k, None)


def _safe(default=None):
    """Decorator: absolute no-raise guarantee. Any failure anywhere in a
    GeoApify call degrades to `default` (None, or [] for list APIs) — Travion's
    lower tiers then take over (spec §31: failure handling, never a crash)."""
    import functools

    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                return fn(*args, **kwargs)
            except Exception:
                return default
        return wrapper
    return deco


def _get(url: str, params: Dict[str, Any], timeout: int = 15) -> Optional[Any]:
    """GET with key injection; None on any failure (never raises)."""
    if not has_key():
        return None
    p = dict(params)
    p["apiKey"] = _key()
    try:
        resp = requests.get(url, params=p, timeout=timeout,
                            headers={"User-Agent": "Travion/1.0 (travel planning)"})
        if resp.status_code != 200:
            return None
        ct = resp.headers.get("content-type", "")
        if "json" in ct:
            return resp.json()
        return resp.content  # binary (static map / icon / tile)
    except Exception:
        return None


def _post(url: str, params: Dict[str, Any], body: Dict[str, Any], timeout: int = 20) -> Optional[Any]:
    if not has_key():
        return None
    p = dict(params)
    p["apiKey"] = _key()
    try:
        resp = requests.post(url, params=p, json=body, timeout=timeout,
                             headers={"User-Agent": "Travion/1.0 (travel planning)"})
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception:
        return None


# ── Geocoding ────────────────────────────────────────────────────────────────

@_safe(default=[])
def geocode(text: str, limit: int = 5, bias: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Forward geocoding: destination text -> real coordinates + metadata.
    Returns a list of real candidate locations (name, lat/lon, city, state,
    country, formatted address, GeoApify place_id, bbox when available)."""
    if not has_key() or not str(text or "").strip():
        return []
    cache_key = f"geocode::{text.strip().lower()}::{limit}::{bias}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    params: Dict[str, Any] = {"text": text, "limit": limit, "lang": "en"}
    if bias:
        if bias.get("lat") is not None and bias.get("lon") is not None:
            params["bias:proximity"] = f"{bias['lon']},{bias['lat']}"
        if bias.get("country"):
            params["filter:countrycode"] = bias["country"]
    data = _get(f"{API}/v1/geocode/search", params) or {}
    out: List[Dict[str, Any]] = []
    for f in data.get("features") or []:
        props = f.get("properties") or {}
        if props.get("lat") is None or props.get("lon") is None:
            continue
        out.append({
            "name": props.get("name") or props.get("formatted"),
            "formatted": props.get("formatted"),
            "lat": props.get("lat"),
            "lon": props.get("lon"),
            "city": props.get("city"),
            "county": props.get("county"),
            "state": props.get("state"),
            "country": props.get("country"),
            "country_code": props.get("country_code"),
            "place_id": props.get("place_id"),
            "bbox": props.get("bbox"),
            "type": props.get("result_type"),
            "source": "geoapify_geocoding",
        })
    _cache_set(cache_key, out)
    return out


@_safe()
def reverse_geocode(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """Coordinates -> real address metadata (never invented)."""
    if not has_key():
        return None
    cache_key = f"reverse::{round(float(lat), 5)},{round(float(lon), 5)}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    data = _get(f"{API}/v1/geocode/reverse", {"lat": lat, "lon": lon, "lang": "en"}) or {}
    features = data.get("features") or []
    if not features:
        return None
    p = features[0].get("properties") or {}
    out = {
        "formatted": p.get("formatted"),
        "city": p.get("city"),
        "state": p.get("state"),
        "country": p.get("country"),
        "place_id": p.get("place_id"),
        "source": "geoapify_geocoding",
    }
    _cache_set(cache_key, out)
    return out


# ── Places ───────────────────────────────────────────────────────────────────

@_safe(default=[])
def places(categories: List[str], geo_filter: str, limit: int = 60,
           offset: int = 0, lang: str = "en") -> List[Dict[str, Any]]:
    """Real POI discovery. `geo_filter` is a GeoApify filter expression:
    'rect:west,south,east,north' (destination region) or 'circle:lon,lat,r_m'
    (strict nearby mode). Returns raw GeoApify features."""
    if not has_key() or not categories or not geo_filter:
        return []
    cache_key = f"places::{','.join(categories)}::{geo_filter}::{limit}::{offset}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    data = _get(f"{API}/v2/places", {
        "categories": ",".join(categories),
        "filter": geo_filter,
        "limit": min(int(limit), 100),
        "offset": max(int(offset), 0),
        "lang": lang,
    }) or {}
    out = data.get("features") or []
    _cache_set(cache_key, out)
    return out


def rect_filter(south: float, west: float, north: float, east: float) -> str:
    return f"rect:{west},{south},{east},{north}"


def circle_filter(lat: float, lon: float, radius_m: int) -> str:
    return f"circle:{lon},{lat},{int(radius_m)}"


# ── Place Details ────────────────────────────────────────────────────────────

@_safe()
def place_details(place_id: str) -> Optional[Dict[str, Any]]:
    """Details for one GeoApify place_id — real fields only, None when unknown."""
    if not has_key() or not place_id:
        return None
    cache_key = f"details::{place_id}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached or None
    data = _get(f"{API}/v2/place-details", {"id": place_id, "lang": "en"}) or {}
    features = data.get("features") or []
    if not features:
        _cache_set(cache_key, {})
        return None
    props = features[0].get("properties") or {}
    out = {
        "place_id": props.get("place_id") or place_id,
        "name": props.get("name"),
        "categories": props.get("categories"),
        "formatted": props.get("formatted"),
        "address_line1": props.get("address_line1"),
        "address_line2": props.get("address_line2"),
        "city": props.get("city"),
        "state": props.get("state"),
        "country": props.get("country"),
        "lat": props.get("lat"),
        "lon": props.get("lon"),
        "opening_hours": props.get("opening_hours"),
        "website": props.get("website"),
        "phone": props.get("phone"),
        "source": "geoapify",
    }
    _cache_set(cache_key, out)
    return out


# ── Routing ──────────────────────────────────────────────────────────────────

def _mode(value: Optional[str]) -> str:
    m = str(value or "drive").strip().lower()
    return m if m in TRAVEL_MODES else "drive"


@_safe()
def route(lat1: float, lng1: float, lat2: float, lng2: float,
          mode: str = "drive") -> Optional[Dict[str, Any]]:
    """Real road route between two points: distance (m), duration (s),
    geometry (GeoJSON LineString), per-leg breakdown. None when unavailable."""
    if not has_key():
        return None
    cache_key = f"route::{round(lat1, 5)},{round(lng1, 5)}::{round(lat2, 5)},{round(lng2, 5)}::{_mode(mode)}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached or None
    data = _get(f"{API}/v1/routing", {
        "waypoints": f"{lat1},{lng1}|{lat2},{lng2}",
        "mode": _mode(mode),
        "lang": "en",
    }, timeout=20) or {}
    features = data.get("features") or []
    if not features:
        _cache_set(cache_key, {})
        return None
    props = features[0].get("properties", {})
    out = {
        "distance_m": props.get("distance"),
        "duration_s": props.get("time"),
        "geometry": features[0].get("geometry"),
        "legs": [
            {"distance_m": leg.get("distance"), "duration_s": leg.get("time")}
            for leg in (props.get("legs") or [])
        ],
        "mode": _mode(mode),
        "source": "geoapify_routing",
    }
    _cache_set(cache_key, out)
    return out


@_safe()
def route_matrix(points: List[Tuple[float, float]], mode: str = "drive") -> Optional[List[List[Dict[str, Any]]]]:
    """Many-to-many real distance/time matrix (GeoApify Route Matrix API).
    Returns sources_to_targets rows: [{distance, time, source_index, target_index}].
    `points` are (lat, lng) tuples; GeoApify wants [lon, lat]."""
    if not has_key() or not points:
        return None
    pts = [(float(a), float(b)) for a, b in points]
    cache_key = f"matrix::{_mode(mode)}::{[(round(a,5), round(b,5)) for a,b in pts]}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached or None
    body = {
        "mode": _mode(mode),
        "sources": [{"location": [b, a]} for a, b in pts],
        "targets": [{"location": [b, a]} for a, b in pts],
    }
    data = _post(f"{API}/v1/routematrix", {}, body, timeout=25)
    if not data:
        _cache_set(cache_key, {})
        return None
    grid = data.get("sources_to_targets") or []
    _cache_set(cache_key, grid)
    return grid or None


# ── Isolines ─────────────────────────────────────────────────────────────────

@_safe()
def isoline(lat: float, lon: float, range_seconds: int = 1800,
            range_type: str = "time", mode: str = "drive") -> Optional[Dict[str, Any]]:
    """Reachability polygon: 'how far can I get in N seconds / meters'."""
    if not has_key():
        return None
    cache_key = f"isoline::{round(lat,5)},{round(lon,5)}::{range_seconds}::{range_type}::{_mode(mode)}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached or None
    params: Dict[str, Any] = {
        "lat": lat, "lon": lon,
        "range_type": range_type, "range": int(range_seconds),
        "mode": _mode(mode),
    }
    data = _get(f"{API}/v1/isoline", params, timeout=20) or {}
    features = data.get("features") or []
    if not features:
        _cache_set(cache_key, {})
        return None
    out = {"geometry": features[0].get("geometry"), "mode": _mode(mode), "source": "geoapify_isoline"}
    _cache_set(cache_key, out)
    return out


# ── Batch API ────────────────────────────────────────────────────────────────

@_safe()
def batch_geocode(jobs: List[Dict[str, Any]], timeout: int = 25) -> Optional[List[Optional[Dict[str, Any]]]]:
    """Bulk geocoding through the Batch API (free tier executes synchronously).
    Each job: {"id": ..., "params": {"text": ...}}. Results are returned in the
    same order as the jobs; failed entries are None."""
    if not has_key() or not jobs:
        return None
    data = _post(f"{API}/v1/batch", {}, {"jobs": jobs}, timeout=timeout)
    if not data or not isinstance(data, list):
        return None
    out: List[Optional[Dict[str, Any]]] = []
    for entry in data:
        try:
            f = (entry[0] if isinstance(entry, list) and entry else None) or {}
            props = (f.get("properties") or {}) if isinstance(f, dict) else {}
            out.append({
                "lat": props.get("lat"), "lon": props.get("lon"),
                "formatted": props.get("formatted"), "place_id": props.get("place_id"),
            } if props.get("lat") is not None else None)
        except Exception:
            out.append(None)
    return out


# ── Map assets (tiles / static maps / marker icons) ─────────────────────────

def tile_url(style: str = "osm-bright") -> Optional[str]:
    """Keyed tile URL template for the interactive map. The key is embedded in
    the URL — that is how GeoApify's Map Tiles API works — but it is issued by
    the backend at runtime, never hardcoded in the frontend bundle."""
    if not has_key():
        return None
    return f"{MAPS}/v1/tile/{{style}}/{{z}}/{{x}}/{{y}}.png?apiKey={_key()}".replace("{style}", style)


@_safe()
def static_map(lat: float, lng: float, zoom: int = 13, width: int = 600, height: int = 400,
               markers: Optional[List[Dict[str, Any]]] = None, style: str = "osm-bright") -> Optional[bytes]:
    """Static map PNG for itinerary/plan previews. Markers:
    [{'lat':..., 'lng':..., 'icon': 'restaurant', 'color': '#e11d48'}]."""
    if not has_key():
        return None
    params: Dict[str, Any] = {
        "style": style, "width": int(width), "height": int(height),
        "center": f"lonlat:{round(float(lng), 5)},{round(float(lat), 5)}",
        "zoom": int(zoom),
    }
    if markers:
        parts = []
        for m in markers:
            seg = f"lonlat:{round(float(m['lng']),5)},{round(float(m['lat']),5)}"
            if m.get("icon"):
                seg += f";type:material;icon:{m['icon']};color:{m.get('color', '#e11d48')}"
            parts.append(seg)
        params["marker"] = parts
    return _get(f"{MAPS}/v1/staticmap", params, timeout=20)


@_safe()
def marker_icon(category: str, color: str = "#e11d48", size: str = "medium") -> Optional[bytes]:
    """Real GeoApify marker icon PNG for a Travion category."""
    icon = CATEGORY_ICONS.get(str(category or "").lower(), "star")
    if not has_key():
        return None
    return _get(f"{API}/v1/icon", {
        "type": "material", "icon": icon, "color": color, "size": size,
    }, timeout=15)


# ── High-level helpers used by the planning pipeline ─────────────────────────

def _haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = a[0], a[1], b[0], b[1]
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


@_safe(default=[])
def route_legs(stops: List[Dict[str, Any]], mode: str = "drive",
               matrix: Optional[List[List[Dict[str, Any]]]] = None) -> List[Dict[str, Any]]:
    """Real legs for an ordered stop list (stay -> p1 -> restaurant -> ... ->
    stay). Prefers a precomputed route matrix (one API call for the whole day);
    falls back to the two-point Routing API per leg; NEVER uses straight-line
    distance as the answer (only as the fallback estimate, clearly flagged)."""
    out: List[Dict[str, Any]] = []
    pts: List[Tuple[float, float]] = []
    for s in stops:
        lat, lng = s.get("lat"), s.get("lng")
        if lat is None or lng is None:
            continue
        pts.append((float(lat), float(lng)))
    if len(pts) < 2:
        return out
    if matrix and len(matrix) >= len(pts):
        for i in range(len(pts) - 1):
            cell = None
            try:
                cell = matrix[i][i + 1]
            except Exception:
                cell = None
            if cell and cell.get("distance") is not None:
                out.append({
                    "from": stops[i].get("title") or stops[i].get("name") or f"stop_{i}",
                    "to": stops[i + 1].get("title") or stops[i + 1].get("name") or f"stop_{i+1}",
                    "distance_km": round(float(cell["distance"]) / 1000.0, 2),
                    "duration_min": round(float(cell.get("time") or 0) / 60.0, 1),
                    "mode": _mode(mode),
                    "source": "geoapify_routematrix",
                })
        if len(out) == len(pts) - 1:
            return out
    # Routing API fallback (per leg) — still real roads, not straight lines.
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        r = route(a[0], a[1], b[0], b[1], mode=mode)
        if r:
            out.append({
                "from": stops[i].get("title") or stops[i].get("name") or f"stop_{i}",
                "to": stops[i + 1].get("title") or stops[i + 1].get("name") or f"stop_{i+1}",
                "distance_km": round(float(r.get("distance_m") or 0) / 1000.0, 2),
                "duration_min": round(float(r.get("duration_s") or 0) / 60.0, 1),
                "mode": _mode(mode),
                "source": "geoapify_routing",
            })
            continue
        km = _haversine_km(a, b)
        out.append({
            "from": stops[i].get("title") or stops[i].get("name") or f"stop_{i}",
            "to": stops[i + 1].get("title") or stops[i + 1].get("name") or f"stop_{i+1}",
            "distance_km": round(km, 2),
            "duration_min": round(km / 30.0 * 60.0, 1),
            "mode": _mode(mode),
            "source": "estimate_haversine",  # clearly flagged, last resort only
        })
    return out
