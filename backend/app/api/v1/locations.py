from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import get_current_identity
from app.models.entities import Location
from app.schemas.schemas import LocationResponse, RegisterLocationRequest
from app.services.verified_data import VERIFIED_LOCATIONS

router = APIRouter(prefix="/locations", tags=["Locations"])

def ensure_locations_seeded(db: Session):
    if db.query(Location).count() == 0:
        for loc in VERIFIED_LOCATIONS:
            l = Location(
                id=loc["id"],
                name=loc["name"],
                state=loc["state"],
                country=loc["country"],
                lat=loc["lat"],
                lng=loc["lng"],
                description=loc["description"],
                hero_image=loc["hero_image"],
                popular_season=loc["popular_season"]
            )
            db.add(l)
        db.commit()

@router.post("/register", response_model=LocationResponse)
def register_location(
    req: RegisterLocationRequest,
    current: dict = Depends(get_current_identity),
    db: Session = Depends(get_db)
):
    """Persist any searchable worldwide place chosen by the traveller.

    Travion is location-agnostic: the user may start from or head to any real
    place resolved by the location provider (Google Places / geocoding). This
    endpoint stores the canonical name + coordinates so trips, maps and
    navigation work with the traveller's actual geography — while the planning
    layer honestly reports when a verified journey package does not exist yet.
    """
    ensure_locations_seeded(db)
    name = (req.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail={"error_code": "INVALID_LOCATION", "message": "A place name is required."})
    if req.lat is None or req.lng is None:
        raise HTTPException(status_code=400, detail={"error_code": "INVALID_COORDINATES", "message": "Coordinates are required to register this place."})

    # Canonicalize to a real city/region when the provider resolved one.
    country = (req.country or "India").strip() or "India"
    state = (req.state or "").strip()
    place_id = (req.place_id or "").strip() or None

    # 1) The provider's canonical place_id is the strongest identity: re-registering
    #    the exact same Google place must never duplicate a row.
    if place_id:
        by_pid = db.query(Location).filter(Location.place_id == place_id).first()
        if by_pid:
            by_pid.name = name
            by_pid.lat = req.lat
            by_pid.lng = req.lng
            if state and by_pid.state in (None, "", "Worldwide"):
                by_pid.state = state
            if country and by_pid.country in (None, ""):
                by_pid.country = country
            db.commit()
            return by_pid

    # 2) Prefer an existing verified hub with the exact same place name + country
    #    (Google resolving "Ooty" must not create a duplicate of the hub row).
    hub = db.query(Location).filter(
        Location.name.ilike(name),
        Location.country.ilike(country)
    ).first()
    if hub:
        # Keep coordinates fresh from the provider when they differ meaningfully.
        if abs(hub.lat - req.lat) > 0.001 or abs(hub.lng - req.lng) > 0.001:
            hub.lat = req.lat
            hub.lng = req.lng
        if place_id and not hub.place_id:
            hub.place_id = place_id
        db.commit()
        return hub

    # 3) Otherwise reuse an identical previously-registered worldwide place.
    existing = None
    for loc in db.query(Location).filter(Location.name.ilike(name), Location.country.ilike(country)).all():
        if abs(loc.lat - req.lat) < 0.5 and abs(loc.lng - req.lng) < 0.5:
            existing = loc
            break
    if existing:
        if state and existing.state != state:
            existing.state = state
        if place_id and not existing.place_id:
            existing.place_id = place_id
        db.commit()
        return existing

    # 4) Register a brand-new worldwide place.
    loc = Location(
        name=name,
        state=state or "Worldwide",
        country=country,
        lat=req.lat,
        lng=req.lng,
        place_id=place_id,
        description=(req.description or "").strip() or None,
        popular_season=None,
    )
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return loc

@router.get("/all", response_model=List[LocationResponse])
def get_all_locations(db: Session = Depends(get_db)):
    """Journey-ready hubs only: the seeded, verified destinations.

    User-registered worldwide places (landmarks, towns, foreign cities) live in
    the same table but must never be marketed as verified hubs — the landing
    page shows this list as "journey-ready destinations". Registered places
    remain fully usable for trips, maps and search.
    """
    ensure_locations_seeded(db)
    hub_ids = {loc["id"] for loc in VERIFIED_LOCATIONS}
    return db.query(Location).filter(Location.id.in_(hub_ids)).all()

@router.get("/search", response_model=List[LocationResponse])
def search_locations(q: str = Query("", min_length=0), db: Session = Depends(get_db)):
    ensure_locations_seeded(db)
    if not q:
        return db.query(Location).limit(10).all()
    search = f"%{q.lower()}%"
    return db.query(Location).filter(
        (Location.name.ilike(search)) |
        (Location.state.ilike(search))
    ).limit(10).all()
