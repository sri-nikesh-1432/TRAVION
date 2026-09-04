from datetime import datetime, timezone
from typing import Dict, Any

class OfflinePackageService:
    """
    Assembles a self-contained offline package bundle for mobile (SQLite)
    and web (IndexedDB) caching.
    """

    @classmethod
    def assemble_package(
        cls,
        trip_data: Dict[str, Any],
        itinerary_data: Dict[str, Any],
        profile_data: Dict[str, Any],
        guide_data: Dict[str, Any] = None,
        safety_data: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        return {
            "package_id": f"offline-pkg-{trip_data['id']}",
            "trip_id": trip_data["id"],
            "destination": trip_data.get("destination_name"),
            "source": trip_data.get("source_name"),
            "start_datetime": str(trip_data.get("start_datetime")),
            "end_datetime": str(trip_data.get("end_datetime")),
            "mode": trip_data.get("mode"),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "itinerary": itinerary_data,
            "profile_context": profile_data,
            "assigned_guide": guide_data,
            "emergency_safety": safety_data or {
                "tourist_helpline": "1800-425-4648",
                "police": "100",
                "ambulance": "108"
            },
            "offline_notice": "Offline mode verified. Route metadata, stops, vouchers, and emergency hotlines are cached locally. Live traffic and live satellite imagery require online connection."
        }
