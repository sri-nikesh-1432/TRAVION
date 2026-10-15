"""One-off data repair: apply the departure-first rule to ALREADY-STORED
itineraries.

The meal-hold insertion bug (fixed in `_insert_missing_meal_stops`) let
origin-city meal placeholders sort ahead of a late-evening outbound departure
— 27 of 63 stored active itineraries opened Day 1 with a placeholder meal
instead of the departure. Live Voice Navigation, the live-map journey state
and the itinerary UI all read stops[0], so those plans began the journey at
"Breakfast — local cuisine".

This script re-runs the SAME production function the planner uses, so every
repaired plan matches exactly what regeneration would produce:
  * pre-departure Day-1 meal holds are pruned (never re-placed before boarding)
  * remaining meal windows still fill (later days untouched unless they too
    had impossible holds)
  * costs, transport, stays, attractions and every real stop are untouched
  * all itinerary VERSIONS are repaired, so a rollback cannot resurrect the
    old order

Idempotent: running twice changes nothing the second time.
"""
import json

from app.core.db import SessionLocal
from app.models.entities import Itinerary, Trip
from app.api.v1.planning import first_day_start_label
from app.services.multi_plan_engine import _insert_missing_meal_stops, _to_minutes


def _load_days(raw):
    """Return (days_list, needs_reencode).

    `days_data` is a SQLAlchemy JSON column: reading yields a list. A row that
    reads back as a str was double-encoded (a JSON string stored inside JSON)
    — the app would iterate characters — so it must be rewritten once as a
    proper JSON array even when its content is already correct.
    """
    if isinstance(raw, list):
        return raw, False
    if isinstance(raw, str) and raw.strip():
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return parsed, True
        # JSON-string-wrapping-JSON: unwrap fully, then it still needs a write.
        while isinstance(parsed, str):
            parsed = json.loads(parsed)
        return parsed, True
    return [], False


def _leading_holds(days) -> int:
    """Meal holds on Day 1 that sit before the first transport stop."""
    if not days:
        return 0
    d1 = days[0]
    stops = d1.get("stops") or []
    dep = None
    for s in stops:
        if str(s.get("category", "")).lower() == "transport":
            dep = _to_minutes(str(s.get("time", "")))
            break
    if dep is None:
        return 0
    n = 0
    for s in stops:
        if str(s.get("category", "")).lower() != "meal_hold":
            continue
        t = _to_minutes(str(s.get("time", "")))
        if t is not None and t < dep:
            n += 1
    return n


def main() -> int:
    db = SessionLocal()
    repaired = 0
    holds_before_total = 0
    holds_after_total = 0
    rows = db.query(Itinerary).all()
    try:
        for itin in rows:
            days, needs_reencode = _load_days(itin.days_data)
            if not days:
                continue
            holds_before = _leading_holds(days)
            if holds_before == 0 and not needs_reencode:
                continue  # already correct — leave the row alone

            trip = db.query(Trip).filter(Trip.id == itin.trip_id).first()
            label = first_day_start_label(trip) if trip else None
            floor = _to_minutes(label or "") if label else None

            if holds_before:
                _insert_missing_meal_stops(days, day1_floor=floor)
            holds_after = _leading_holds(days)

            if holds_before and holds_after >= holds_before:
                # Defensive: the production function could not improve this
                # row — leave it untouched and report instead of guessing.
                print(
                    f"  SKIP {itin.id} trip={itin.trip_id}: "
                    f"{holds_before} leading hold(s) could not be repaired"
                )
                holds_after_total += holds_before
                holds_before_total += holds_before
                continue

            # Assign the LIST — the JSON column serializes it exactly once.
            itin.days_data = days
            repaired += 1
            holds_before_total += holds_before
            holds_after_total += holds_after
            if needs_reencode and not holds_before:
                print(f"  RE-ENCODED version={itin.version} trip={itin.trip_id} (JSON array restored)")
            else:
                print(
                    f"  REPAIRED version={itin.version} trip={itin.trip_id}: "
                    f"{holds_before} -> {holds_after} pre-departure hold(s)"
                )
        db.commit()
    finally:
        db.close()

    print()
    print(f"itinerary rows scanned : {len(rows)}")
    print(f"rows repaired          : {repaired}")
    print(f"leading holds before   : {holds_before_total}")
    print(f"leading holds after    : {holds_after_total}")
    print("REPAIR_OK" if holds_after_total == 0 else "REPAIR_INCOMPLETE")
    return 0 if holds_after_total == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
