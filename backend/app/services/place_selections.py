"""Trip place selections — the server-side single source of truth for the
places a traveller chose during discovery (Step 3 map/cards, search, nearby)
and the Step 5 planner.

Row identity: ``(trip_id, provider_place_id)``. Adding a place UPSERTs that
real place; removing it SETS ``status='removed'`` + ``removed_at`` so the same
`provider_place_id` can be re-added idempotently (the row is reactivated, never
duplicated). Every row carries a snapshot of the real item plus its provenance
(`selection_source`), so the planner and the guide/manager views always operate
on the exact REAL place the user picked — nothing invented, nothing name-guessed.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.entities import TripPlaceSelection


# Categories the planner treats as "places to visit" vs food/stay.
PLACE_CATEGORIES = {
    "must_visit", "attraction", "activities", "activity", "shopping",
    "healthcare", "education", "transport", "other",
}
FOOD_CATEGORIES = {"food", "restaurant", "cafe"}
STAY_CATEGORIES = {"stays", "stay", "hotel"}


def provider_key(item: Dict[str, Any]) -> str:
    """The idempotency key for a selection row: the provider's canonical id
    when available, otherwise the internal item id (curated catalog entries
    have no external provider id)."""
    key = str(item.get("provider_place_id") or item.get("id") or "").strip()
    return key


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def species(category: Optional[str]) -> str:
    """Map a raw category to the three planner buckets: place | food | stay."""
    c = str(category or "").lower().replace(" ", "_")
    if c in FOOD_CATEGORIES:
        return "food"
    if c in STAY_CATEGORIES:
        return "stay"
    return "place"


def upsert_selection(
    db: Session,
    trip_id: str,
    user_id: str,
    item: Dict[str, Any],
    default_source: Optional[str] = None,
) -> TripPlaceSelection:
    """Add (or re-add) one real place selection. Idempotent by
    (trip_id, provider_place_id): re-adding reactivates a previously removed
    row and refreshes the item snapshot, preserving the ORIGINAL
    selection_source unless the caller supplies one."""
    key = provider_key(item)
    if not key:
        # Without a key the selection cannot be identified idempotently — never
        # store a row the UI could not remove. (Real sources always have an id.)
        item["provider_place_id"] = item.get("id") or (
            f"name_{str(item.get('name','')).strip()[:60].replace(' ', '_').lower()}__"
            f"{item.get('latitude') or 0},{item.get('longitude') or 0}"
        )
        key = provider_key(item)
    row = db.query(TripPlaceSelection).filter(
        TripPlaceSelection.trip_id == trip_id,
        TripPlaceSelection.provider_place_id == key,
    ).first()
    if row is None:
        row = TripPlaceSelection(
            trip_id=trip_id,
            user_id=user_id,
            provider_place_id=key,
            status="active",
            selected_at=_utcnow(),
            selection_source=str(item.get("selection_source") or default_source or "map"),
        )
        db.add(row)
    row.place_id = item.get("place_id") or row.place_id
    row.name = str(item.get("name") or row.name or "")
    row.category = str(item.get("category") or "must_visit")
    if item.get("latitude") is not None:
        row.latitude = float(item["latitude"])
    if item.get("longitude") is not None:
        row.longitude = float(item["longitude"])
    if item.get("distance_km") is not None:
        row.distance_km = float(item["distance_km"])
    if item.get("rating") is not None:
        row.rating = float(item["rating"])
    price = item.get("price")
    if price is None and item.get("entry_fee") is not None:
        price = item["entry_fee"]
    if price is None and item.get("price_per_night") is not None:
        price = item["price_per_night"]
    if price is None and item.get("avg_cost_for_two") is not None:
        price = item["avg_cost_for_two"]
    if price is not None:
        row.price = float(price)
    row.item_json = {  # snapshot of the real item for later reactivation
        k: item.get(k)
        for k in (
            "id", "name", "category", "latitude", "longitude", "distance_km",
            "placement", "entry_fee", "duration_minutes", "rating", "source",
            "address", "price_per_night", "avg_cost_for_two", "cuisine",
            "budget_category", "tier",
        )
        if item.get(k) is not None
    }
    if item.get("selection_source"):
        row.selection_source = str(item["selection_source"])
    row.status = "active"
    row.removed_at = None
    db.flush()
    return row


def remove_selection(db: Session, trip_id: str, provider_place_id: str) -> Optional[TripPlaceSelection]:
    """Soft-remove an active selection by idempotency key. Returns the row when
    found (and it was active), else None."""
    row = db.query(TripPlaceSelection).filter(
        TripPlaceSelection.trip_id == trip_id,
        TripPlaceSelection.provider_place_id == provider_place_id,
    ).first()
    if not row:
        return None
    if row.status == "active":
        row.status = "removed"
        row.removed_at = _utcnow()
        db.flush()
    return row


def active_selections(db: Session, trip_id: str) -> List[TripPlaceSelection]:
    return db.query(TripPlaceSelection).filter(
        TripPlaceSelection.trip_id == trip_id,
        TripPlaceSelection.status == "active",
    ).order_by(TripPlaceSelection.selected_at.asc()).all()


def selection_payload(row: TripPlaceSelection) -> Dict[str, Any]:
    return {
        "provider_place_id": row.provider_place_id,
        "place_id": row.place_id,
        "name": row.name,
        "category": row.category,
        "latitude": row.latitude,
        "longitude": row.longitude,
        "distance_km": row.distance_km,
        "rating": row.rating,
        "price": row.price,
        "selection_source": row.selection_source,
        "status": row.status,
        "selected_at": row.selected_at,
        "removed_at": row.removed_at,
        "item_json": row.item_json,
    }


def selections_payload(db: Session, trip_id: str) -> Dict[str, Any]:
    rows = active_selections(db, trip_id)
    counts: Dict[str, int] = {}
    for r in rows:
        counts[r.category] = counts.get(r.category, 0) + 1
    return {
        "selections": [selection_payload(r) for r in rows],
        "counts": counts,
        "total": len(rows),
    }


def sync_selections(
    db: Session,
    trip_id: str,
    user_id: str,
    items: List[Dict[str, Any]],
    replace: bool = False,
) -> List[TripPlaceSelection]:
    """Bulk upsert (and optional replace). Returns the active rows afterwards."""
    for item in items:
        upsert_selection(db, trip_id, user_id, item)
    if replace:
        incoming = {provider_key(i) for i in items if provider_key(i)}
        for row in active_selections(db, trip_id):
            if row.provider_place_id in incoming:
                continue
            if services_keep_plan(row):
                continue  # planner-level picks (stays/food) are never clobbered
            remove_selection(db, trip_id, row.provider_place_id)
    db.flush()
    return active_selections(db, trip_id)


def services_keep_plan(row: TripPlaceSelection) -> bool:
    """True when a selection was persisted by the PLANNER (not the discovery
    UI) and therefore should survive a replace-sync from the discovery screen."""
    return row.selection_source == "recommendation"


def selections_for_plan(db: Session, trip_id: str) -> Dict[str, Any]:
    """Reconstruct the planning handshake (places / food / stay) from the active
    selections table — used to replay identical plans after a refresh."""
    rows = active_selections(db, trip_id)
    places: List[Dict[str, Any]] = []
    food: List[Dict[str, Any]] = []
    stay: Optional[Dict[str, Any]] = None
    for r in rows:
        kind = species(r.category)
        snapshot = dict(r.item_json or {})
        snapshot.setdefault("name", r.name)
        snapshot.setdefault("id", r.place_id or r.provider_place_id)
        if r.latitude is not None:
            snapshot["latitude"] = r.latitude
        if r.longitude is not None:
            snapshot["longitude"] = r.longitude
        if r.distance_km is not None:
            snapshot["distance_km"] = r.distance_km
        if r.rating is not None:
            snapshot["rating"] = r.rating
        if r.category in ("food", "restaurant", "cafe"):
            kind = "food"
        if kind == "food":
            food.append(snapshot)
        elif kind == "stay":
            if stay is None:
                stay = snapshot
        else:
            places.append(snapshot)
    return {"places": places, "food": food, "stay": stay}