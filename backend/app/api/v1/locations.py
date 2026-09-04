from typing import List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models.entities import Location
from app.schemas.schemas import LocationResponse
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

@router.get("/all", response_model=List[LocationResponse])
def get_all_locations(db: Session = Depends(get_db)):
    ensure_locations_seeded(db)
    return db.query(Location).all()

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
