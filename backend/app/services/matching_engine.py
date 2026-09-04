from typing import List, Dict, Any
from app.models.entities import Guide

class GuideMatchingEngine:
    """
    Computes a weighted match score for each eligible guide against trip requirements:
    - Destination match (weight: 0.30)
    - Language match (weight: 0.25)
    - Availability status (weight: 0.20)
    - Experience years (weight: 0.10)
    - Guide rating (weight: 0.15)
    - Workload penalty (-0.25 if busy or on active trip)
    """

    @classmethod
    def calculate_match(
        cls,
        guide: Guide,
        destination_name: str,
        preferred_language: str,
        additional_languages: List[str] = None
    ) -> Dict[str, Any]:
        additional_languages = additional_languages or []
        req_langs = [preferred_language.lower()] + [l.lower() for l in additional_languages]

        # 1. Destination match (0.0 to 1.0)
        guide_destinations = [d.lower() for d in (guide.destinations or [])]
        dest_match = 1.0 if destination_name.lower() in guide_destinations else 0.4

        # 2. Language match (0.0 to 1.0)
        guide_langs = [l.lower() for l in (guide.languages or [])]
        matched_langs = set(req_langs).intersection(set(guide_langs))
        lang_match = min(1.0, len(matched_langs) * 0.5) if matched_langs else 0.2

        # 3. Availability
        if guide.status == "ACTIVE" and not guide.current_trip_id:
            avail_score = 1.0
        elif guide.status == "BUSY":
            avail_score = 0.2
        else:  # DUTY_OFF
            avail_score = 0.0

        # 4. Experience (scaled up to 10 years)
        exp_score = min(1.0, (guide.experience_years or 1) / 10.0)

        # 5. Rating (scaled from 5.0)
        rating_score = min(1.0, (guide.rating or 5.0) / 5.0)

        # Workload penalty
        workload_penalty = 0.25 if guide.current_trip_id or guide.status == "BUSY" else 0.0

        total_score = (
            (0.30 * dest_match) +
            (0.25 * lang_match) +
            (0.20 * avail_score) +
            (0.10 * exp_score) +
            (0.15 * rating_score) -
            workload_penalty
        )
        total_score = max(0.05, min(1.0, total_score))

        breakdown = {
            "destination_compatibility": round(dest_match * 100, 1),
            "language_compatibility": round(lang_match * 100, 1),
            "availability": round(avail_score * 100, 1),
            "experience": round(exp_score * 100, 1),
            "rating": round(rating_score * 100, 1),
            "workload_penalty": round(workload_penalty * 100, 1)
        }

        return {
            "match_score": round(total_score * 100, 1),
            "breakdown": breakdown
        }
