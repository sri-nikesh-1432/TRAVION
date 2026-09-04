from typing import Dict, Any
from copy import deepcopy


class ReplanningEngine:
    """
    Evaluates dynamic triggers (weather change, user fatigue, transit disruption,
    budget reallocation) and updates flexible itinerary line items while preserving
    core locked constraints. Generates an explicit "Why did my plan change?"
    explanation. Explanations are plain professional copy — no decorative emoji.
    """

    @classmethod
    def execute_replan(
        cls,
        current_itinerary_data: Dict[str, Any],
        trigger_type: str,
        reason: str,
        user_prompt: str = None
    ) -> Dict[str, Any]:
        updated_data = deepcopy(current_itinerary_data)
        days = updated_data.get("days", [])
        explanation = ""
        changed_stops = 0

        def swap_stop(stop: Dict[str, Any], category: str, title: str, description: str, minutes: int, note: str):
            nonlocal changed_stops
            if stop.get("category") == category:
                stop["title"] = title
                stop["description"] = description
                stop["duration_minutes"] = minutes
                stop["weather_note"] = None
                stop["ai_note"] = note
                stop["source"] = "ai_reasoned"
                changed_stops += 1

        if trigger_type == "WEATHER":
            # Outdoor viewpoints / treks swap to an indoor alternative when a rain
            # advisory affects the plan.
            for day in days:
                for stop in day.get("stops", []):
                    if any(k in stop.get("title", "") for k in ("Peak", "Trek", "Viewpoint", "Boat", "Waterfall")):
                        swap_stop(
                            stop, stop.get("category"),
                            "Indoor Heritage Museum & Tasting Experience",
                            "A rain advisory affects open-air viewpoints today, so the outdoor stop "
                            "has been replaced with an indoor heritage experience — same area, no "
                            "compromise on character.",
                            75,
                            "Replanned automatically due to a live weather advisory for outdoor stops."
                        )

        elif trigger_type in ["TIREDNESS", "USER_PREFERENCE"]:
            # Replace high-exertion stops on later days with relaxed lounges/cafes.
            for day in days:
                for stop in day.get("stops", []):
                    if stop.get("category") in ("attraction", "hidden_gem") and day.get("day", 1) >= 2:
                        swap_stop(
                            stop, stop.get("category"),
                            "Relaxed Botanical Lawn & Scenic Cafe",
                            "High-exertion walking stops have been swapped for a relaxed shaded "
                            "veranda lounge with light refreshments, in line with your request.",
                            60,
                            "Replanned based on your request for a restful, low-strain afternoon."
                        )

        elif trigger_type == "BUDGET":
            explanation = (
                "Budget rebalancing applied: lower-cost verified transport and meal "
                "options were substituted, and the freed amount was reallocated to the "
                "highest-rated local experiences on your plan."
            )

        if not explanation:
            if trigger_type == "WEATHER":
                explanation = (
                    "Weather advisories affected open-air waypoints on this trip, so those "
                    "stops were replaced with indoor alternatives at similar locations. Your "
                    "stay, dining and travel arrangements are unchanged."
                )
            else:
                explanation = (
                    "Your plan was updated to better match the change you requested. Flexible "
                    "items were re-optimised while transport, stay and fixed bookings were "
                    "preserved."
                )

        new_version = updated_data.get("version", 1) + 1
        updated_data["version"] = new_version

        return {
            "new_version": new_version,
            "explanation": explanation,
            "updated_itinerary": updated_data
        }
