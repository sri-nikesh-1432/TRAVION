"""GeoApify endpoints — Travion's geographic proxy.

The GeoApify key NEVER reaches the frontend: every call below is server-side.
The frontend asks Travion for real places, real routes and map assets; Travion
asks GeoApify. Expensive operations are rate-limited per identity and every
result is TTL-cached so planning sessions stay fast (spec §30).
"""

import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.core.security import require_role
from app.services import geoapify as geo

router = APIRouter(prefix="/geo", tags=["GeoApify"])

_RATE: Dict[str, List[float]] = {}


def _rate_limit(bucket: str, ident: str, per_minute: int) -> None:
    """Tiny in-memory sliding-window limiter for expensive GeoApify calls."""
    key = f"{bucket}::{ident}"
    now = time.time()
    window = [t for t in _RATE.get(key, []) if now - t < 60]
    if len(window) >= per_minute:
        raise HTTPException(status_code=429, detail="Too many geo requests — try again in a moment.")
    window.append(now)
    _RATE[key] = window


def _clean(text: str, max_len: int = 120) -> str:
    return str(text or "").strip()[:max_len]


# ── Schemas ──────────────────────────────────────────────────────────────────

class GeocodeResponse(BaseModel):
    query: str
    results: List[Dict[str, Any]]


class DestinationResponse(BaseModel):
    name: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    formatted: Optional[str] = None
    place_id: Optional[str] = None
    region_filter: Optional[str] = None
    region_kind: Optional[str] = None  # rect (destination boundary) | circle fallback
    source: str = "geoapify"


class RouteMatrixRequest(BaseModel):
    points: List[Dict[str, float]] = Field(..., min_length=2, max_length=50)
    mode: str = "drive"


class TripRouteRequest(BaseModel):
    """One ordered day of stops (stay -> places -> restaurants -> stay)."""
    days: List[List[Dict[str, Any]]] = Field(..., max_length=30)
    mode: str = "drive"
    rate_per_km: float = Field(12.0, ge=0, le=200)


class BatchGeocodeRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1, max_length=50)


# ── 1. Geocoding ─────────────────────────────────────────────────────────────

@router.get("/geocode", response_model=GeocodeResponse)
def geocode_endpoint(
    q: str = Query(..., min_length=1, max_length=120),
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    _rate_limit("geocode", str(current.get("identity_id")), 60)
    results = geo.geocode(_clean(q))
    return {"query": q, "results": results}


@router.get("/reverse")
def reverse_endpoint(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    result = geo.reverse_geocode(lat, lng)
    return result or {"formatted": None, "source": "unavailable"}


# ── 2. Destination region ────────────────────────────────────────────────────

_REGION_RADIUS_M = {"city": 15000, "county": 12000, "town": 8000, "village": 5000, "suburb": 4000}


@router.get("/destination", response_model=DestinationResponse)
def destination_endpoint(
    name: str = Query(..., min_length=1, max_length=120),
    state: Optional[str] = Query(None, max_length=80),
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    """Resolve a destination through GeoApify Geocoding and derive its REAL
    search region: the geocoded bounding rectangle when available, else a
    result-type-radius circle. This region — not an arbitrary global radius —
    is the spatial constraint for place discovery (spec §3+§4)."""
    _rate_limit("destination", str(current.get("identity_id")), 30)
    text = _clean(f"{name}, {state}" if state else name)
    results = geo.geocode(text, limit=5, bias={"country": "in"}) or geo.geocode(_clean(name), limit=5)
    if not results:
        raise HTTPException(status_code=404, detail="Destination not found in geocoding — check the spelling.")
    best = results[0]
    bbox = best.get("bbox")
    if bbox and len(bbox) >= 4:
        # GeoApify bbox = [west, south, east, north] (lon/lat) — pad 10% so
        # boundary-adjacent attractions are not clipped.
        west, south, east, north = bbox[0], bbox[1], bbox[2], bbox[3]
        pad_x = (east - west) * 0.10 or 0.02
        pad_y = (north - south) * 0.10 or 0.02
        region = geo.rect_filter(south - pad_y, west - pad_x, north + pad_y, east + pad_x)
        kind = "rect"
    else:
        radius = _REGION_RADIUS_M.get(str(best.get("type") or ""), 10000)
        region = geo.circle_filter(best["lat"], best["lon"], radius)
        kind = "circle"
    return {
        "name": best.get("name") or name,
        "lat": best.get("lat"),
        "lng": best.get("lon"),
        "city": best.get("city"),
        "state": best.get("state"),
        "country": best.get("country"),
        "formatted": best.get("formatted"),
        "place_id": best.get("place_id"),
        "region_filter": region,
        "region_kind": kind,
        "source": "geoapify",
    }


# ── 3. Places (destination region / nearby) ──────────────────────────────────

_VALID_PREFIXES = ("tourism.", "leisure.", "sport.", "religion.", "entertainment.",
                   "commercial.", "catering.", "accommodation.", "healthcare.",
                   "education.", "public_transport.", "service.", "natural.", "adult.")


@router.get("/places")
def places_endpoint(
    region: str = Query(..., min_length=5, max_length=200,
                       description="GeoApify filter from /geo/destination (rect/circle)"),
    categories: Optional[str] = Query(None, max_length=300,
                                      description="Comma-separated GeoApify categories; default = Travion tourist set"),
    experience: Optional[str] = Query(None, max_length=40),
    limit: int = Query(60, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    """Real POI discovery constrained to the destination region filter. The
    `experience` shortcut picks the preference-driven category set; explicit
    `categories` (validated against the real taxonomy) override it."""
    _rate_limit("places", str(current.get("identity_id")), 30)
    if not region.startswith(("rect:", "circle:")):
        raise HTTPException(status_code=400, detail="region must be a rect: or circle: filter from /geo/destination")
    if categories:
        cats = [c.strip() for c in _clean(categories, 300).split(",") if c.strip()]
        for c in cats:
            if not c.startswith(_VALID_PREFIXES):
                raise HTTPException(status_code=400, detail=f"Unsupported category: {c}")
    else:
        cats = list(dict.fromkeys(
            geo.BASE_CATEGORIES["must_visit"] + geo.BASE_CATEGORIES["food"]
            + geo.BASE_CATEGORIES["stays"] + geo.BASE_CATEGORIES["activities"]
            + geo.EXPERIENCE_CATEGORIES.get(str(experience or "mixed").strip().lower(), [])
        ))
    features = geo.places(cats, region, limit=limit, offset=offset)
    out: List[Dict[str, Any]] = []
    for f in features:
        p = f.get("properties") or {}
        if not p.get("name") or p.get("lat") is None:
            continue
        out.append({
            "place_id": p.get("place_id"),
            "name": p.get("name"),
            "categories": p.get("categories"),
            "formatted": p.get("formatted"),
            "lat": p.get("lat"),
            "lng": p.get("lon"),
            "opening_hours": p.get("opening_hours"),
            "website": p.get("website"),
            "source": "geoapify",
        })
    return {"count": len(out), "places": out, "region": region, "categories": cats}


@router.get("/viewport-places")
def viewport_places_endpoint(
    bbox: str = Query(..., description="Visible map area 'south,west,north,east' in degrees"),
    experience: Optional[str] = Query(None, max_length=40),
    categories: Optional[str] = Query(None, max_length=300),
    limit: int = Query(80, ge=1, le=100),
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    """Viewport-based map loading (spec §30): the map asks for the POIs of the
    area actually on screen. Accepts ANY visible rectangle (south,west,north,
    east), converts it to a GeoApify rect filter server-side, and returns
    classified, deduplicated real places. Category paging: `offset` style
    fetches are avoided by requesting a generous batch per viewport move."""
    _rate_limit("viewport", str(current.get("identity_id")), 60)
    try:
        parts = [float(p) for p in str(bbox).split(",")]
        if len(parts) != 4:
            raise ValueError
        south, west, north, east = parts
        if not (-90 <= south < north <= 90 and -180 <= west < east <= 180):
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=400, detail="bbox must be 'south,west,north,east' numeric degrees")
    if categories:
        cats = [c.strip() for c in _clean(categories, 300).split(",") if c.strip()]
        for c in cats:
            if not c.startswith(_VALID_PREFIXES):
                raise HTTPException(status_code=400, detail=f"Unsupported category: {c}")
    else:
        cats = list(dict.fromkeys(
            geo.BASE_CATEGORIES["must_visit"] + geo.BASE_CATEGORIES["food"]
            + geo.BASE_CATEGORIES["stays"] + geo.BASE_CATEGORIES["activities"]
            + geo.EXPERIENCE_CATEGORIES.get(str(experience or "mixed").strip().lower(), [])
            + ["commercial.marketplace", "commercial.shopping_mall", "healthcare.hospital",
               "public_transport"]  # parent category — subcategories like
            # public_transport.railway/aerodrome are NOT in this key's plan
            # (provider 400s the whole batched request when one category is invalid)
        ))
    region = geo.rect_filter(south, west, north, east)
    features = geo.places(cats, region, limit=limit)
    out: List[Dict[str, Any]] = []
    seen_ids: set = set()
    for f in features:
        p = f.get("properties") or {}
        name = str(p.get("name") or "").strip()
        if not name or p.get("lat") is None:
            continue
        pid = str(p.get("place_id") or "")
        key = pid or f"{round(float(p['lat']), 4)}:{round(float(p['lon']), 4)}:{name.lower()}"
        if key in seen_ids:
            continue
        seen_ids.add(key)
        cats_prop = p.get("categories") or []
        out.append({
            "place_id": pid or None,
            "name": name,
            "categories": cats_prop,
            "formatted": p.get("formatted"),
            "lat": p.get("lat"),
            "lng": p.get("lon"),
            "opening_hours": p.get("opening_hours"),
            "website": p.get("website"),
            "source": "geoapify",
        })
    return {"count": len(out), "places": out, "bbox": {"south": south, "west": west, "north": north, "east": east}}


# ── 4. Place details ─────────────────────────────────────────────────────────

@router.get("/places/{place_id}/details")
def place_details_endpoint(
    place_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    _rate_limit("details", str(current.get("identity_id")), 60)
    if not place_id.strip() or len(place_id) > 200:
        raise HTTPException(status_code=400, detail="Invalid place id")
    details = geo.place_details(place_id.strip())
    if not details:
        raise HTTPException(status_code=404, detail="No verified details available for this place")
    return details


# ── 5. Map assets ────────────────────────────────────────────────────────────

@router.get("/tile-url")
def tile_url_endpoint(current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN"))):
    url = geo.tile_url()
    if not url:
        raise HTTPException(status_code=503, detail="GeoApify tiles not configured")
    return {"url": url, "attribution": "© OpenStreetMap contributors © GeoApify"}


@router.get("/static-map")
def static_map_endpoint(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    zoom: int = Query(13, ge=1, le=20),
    width: int = Query(600, ge=64, le=1200),
    height: int = Query(400, ge=64, le=800),
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    _rate_limit("staticmap", str(current.get("identity_id")), 20)
    png = geo.static_map(lat, lng, zoom=zoom, width=width, height=height)
    if not png:
        raise HTTPException(status_code=503, detail="Static map unavailable")
    return Response(content=png, media_type="image/png")


@router.get("/icon/{category}")
def icon_endpoint(
    category: str,
    color: str = Query("#e11d48", pattern=r"^#[0-9a-fA-F]{6}$"),
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    png = geo.marker_icon(category, color=color)
    if not png:
        raise HTTPException(status_code=503, detail="Icon unavailable")
    return Response(content=png, media_type="image/png")


# ── 6. Routing / matrix / isolines ───────────────────────────────────────────

@router.get("/route")
def route_endpoint(
    from_lat: float = Query(..., ge=-90, le=90),
    from_lng: float = Query(..., ge=-180, le=180),
    to_lat: float = Query(..., ge=-90, le=90),
    to_lng: float = Query(..., ge=-180, le=180),
    mode: str = Query("drive", max_length=20),
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    """REAL road route — distance, duration and geometry (never straight-line)."""
    _rate_limit("route", str(current.get("identity_id")), 60)
    r = geo.route(from_lat, from_lng, to_lat, to_lng, mode=mode)
    if not r:
        raise HTTPException(status_code=503, detail="Routing unavailable right now")
    return r


@router.post("/route-matrix")
def route_matrix_endpoint(
    req: RouteMatrixRequest,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    """Many-to-many real distance/time matrix in ONE request (spec §14)."""
    _rate_limit("matrix", str(current.get("identity_id")), 20)
    pts = [(p.get("lat"), p.get("lng")) for p in req.points]
    if any(a is None or b is None for a, b in pts):
        raise HTTPException(status_code=400, detail="Every point needs lat and lng")
    grid = geo.route_matrix(pts, mode=req.mode)  # type: ignore[arg-type]
    if grid is None:
        raise HTTPException(status_code=503, detail="Route matrix unavailable right now")
    return {"mode": req.mode, "matrix": grid, "units": "metric"}


@router.get("/isoline")
def isoline_endpoint(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    range_value: int = Query(1800, ge=60, le=14400),
    range_type: str = Query("time", pattern="^(time|distance)$"),
    mode: str = Query("drive", max_length=20),
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    _rate_limit("isoline", str(current.get("identity_id")), 20)
    poly = geo.isoline(lat, lng, range_seconds=range_value, range_type=range_type, mode=mode)
    if not poly:
        raise HTTPException(status_code=503, detail="Isoline unavailable right now")
    return poly


# ── 7. Trip-day routes (spec §13: stay → p1 → restaurant → ... → stay) ──────

@router.post("/trip-route")
def trip_route_endpoint(
    req: TripRouteRequest,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    """Real legs for ordered trip days. One Route Matrix call covers a day's
    stops; the per-leg Routing API is the fallback. Straight-line distance is
    the last resort and is clearly flagged `estimate_haversine`."""
    _rate_limit("triproute", str(current.get("identity_id")), 20)
    all_legs: List[Dict[str, Any]] = []
    total_km = 0.0
    for day_stops in req.days:
        stops = day_stops[:30]
        pts = [(s.get("lat"), s.get("lng")) for s in stops]
        matrix = None
        if len([p for p in pts if p[0] is not None]) >= 2:
            matrix = geo.route_matrix([(float(a), float(b)) for a, b in pts if a is not None and b is not None],
                                      mode=req.mode)
        legs = geo.route_legs(stops, mode=req.mode, matrix=matrix)
        all_legs.append(legs)
        total_km += sum(float(l.get("distance_km") or 0) for l in legs)
    return {
        "days": all_legs,
        "total_distance_km": round(total_km, 2),
        "mode": req.mode,
        "transport_cost_estimate": round(total_km * req.rate_per_km, 0),
        "source": "geoapify",
    }


# ── 8. Batch geocoding (spec §30: batch instead of hundreds of calls) ───────

@router.post("/batch-geocode")
def batch_geocode_endpoint(
    req: BatchGeocodeRequest,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
):
    _rate_limit("batch", str(current.get("identity_id")), 5)
    jobs = [{"id": str(i), "params": {"text": _clean(t), "limit": 1}} for i, t in enumerate(req.texts)]
    results = geo.batch_geocode(jobs)
    if results is None:
        raise HTTPException(status_code=503, detail="Batch geocoding unavailable right now")
    return {"count": len(results), "results": results}
