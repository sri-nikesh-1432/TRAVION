"""Itinerary modification tools for the trip assistant.

Actions requested in chat ("remove tomorrow's museum", "move dinner to 8 PM",
"add a rest day") are executed against the *actual* persisted itinerary — the
assistant never pretends a change happened. Every change returns a human
summary and the exact new day data so the caller can persist a new version.
"""
from typing import Any, Dict, List, Optional


def all_stops(days: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for d in days or []:
        for s in d.get("stops", []) or []:
            out.append(s)
    return out


def _score_stop(stop: Dict[str, Any], phrase: str) -> int:
    if not phrase:
        return 0
    p = phrase.lower()
    haystack = " ".join([
        str(stop.get("title", "")),
        str(stop.get("location_name", "")),
        str(stop.get("description", ""))[:200],
    ]).lower()
    score = 0
    for token in p.split():
        if len(token) < 2:
            continue
        if token in haystack:
            score += len(token)
    # Title matches weigh more than description matches.
    title = str(stop.get("title", "")).lower()
    if phrase in title or p in title:
        score += 50
    return score


def find_stop(days: List[Dict[str, Any]], phrase: str) -> Optional[Dict[str, Any]]:
    """Fuzzy entity resolution: locate the itinerary stop the user means."""
    best = None
    best_score = 0
    for s in all_stops(days):
        sc = _score_stop(s, phrase)
        if sc > best_score:
            best_score = sc
            best = s
    return best if best_score >= 3 else None


def remove_stop(days: List[Dict[str, Any]], stop_id: str) -> Dict[str, Any]:
    """Remove a stop from the itinerary (and its estimated cost)."""
    removed: Optional[Dict[str, Any]] = None
    for d in days or []:
        for s in d.get("stops", []) or []:
            if s.get("id") == stop_id:
                removed = s
                break
        if removed:
            break
    removed_cost = float(removed.get("estimated_cost") or 0) if removed else 0.0
    for d in days or []:
        d["stops"] = [s for s in (d.get("stops", []) or []) if s.get("id") != stop_id]
    # Drop empty days so the map/UI never shows a blank day block.
    days = [d for d in (days or []) if (d.get("stops") or [])]
    return {"days": days, "removed": removed, "removed_cost": removed_cost}


def move_stop_time(days: List[Dict[str, Any]], stop_id: str, new_time: str) -> Dict[str, Any]:
    """Change a stop's scheduled time (e.g. dinner 8:00 PM)."""
    moved = None
    for s in all_stops(days):
        if s.get("id") == stop_id:
            s["time"] = new_time
            moved = s
            break
    return {"days": days, "moved": moved, "new_time": new_time}


def add_rest_day(days: List[Dict[str, Any]], dest: str, calm_stop: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Append a rest & leisure day using a verified calm attraction when available."""
    day_num = max([int(d.get("day", 0)) for d in (days or [])], default=0) + 1
    if calm_stop:
        stop = {
            "id": f"stop-d{day_num}-rest",
            "day": day_num,
            "time": "10:30 AM",
            "title": f"Rest & Leisure at {calm_stop.get('name', 'a local spot')}",
            "description": f"Added at your request: a relaxed visit to {calm_stop.get('name', 'a verified local spot')} — {str(calm_stop.get('description', ''))[:120]}",
            "category": "attraction",
            "location_name": calm_stop.get("name", dest),
            "lat": float(calm_stop.get("lat", 0) or 0),
            "lng": float(calm_stop.get("lng", 0) or 0),
            "estimated_cost": float(calm_stop.get("entry_fee", 0) or 0),
            "duration_minutes": int(calm_stop.get("duration_minutes", 90) or 90),
            "rating": float(calm_stop.get("rating", 4.6) or 4.6),
            "source": "verified_api",
            "ai_note": "Added by your trip assistant as a relaxed rest-day stop.",
        }
    else:
        stop = {
            "id": f"stop-d{day_num}-rest",
            "day": day_num,
            "time": "10:30 AM",
            "title": "Free Leisure & Rest Day",
            "description": f"An open day in {dest} at your request — sleep in, explore at your own pace, or ask me to fill it with verified stops.",
            "category": "attraction",
            "location_name": dest,
            "lat": 0.0,
            "lng": 0.0,
            "estimated_cost": 0.0,
            "duration_minutes": 480,
            "rating": 5.0,
            "source": "ai_reasoned",
            "ai_note": "Added by your trip assistant as a rest day.",
        }
    days = list(days or [])
    days.append({"day": day_num, "title": f"Day {day_num} — Rest & Leisure", "stops": [stop]})
    return {"days": days, "added": stop}