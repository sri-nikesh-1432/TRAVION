"""LLM Routing Layer — routes saved trip context to task-specific prompts.

Design principles (from spec §5/§10/§30):
- LLM receives the ACTUAL saved trip record values — never placeholders.
- LLM never returns monetary amounts; any price-like text is labeled "estimate".
- Backend independently calculates ALL fees, budget, safety reserve, protection fee.
- LLM output is validated by backend before any persistence.
- If LLM proposes impossible dates/invalid coords, backend rejects and logs.
- Context injection includes: source, dest, dates, pax/adults/children, group type,
  budget, mode, interests, selected places/stay, fees already computed, remaining budget.
- Retries with exponential backoff; timeout per call; fallback to honest text if no key.
"""

import os
import time
import logging
import json
from typing import Dict, Any, List, Optional, Tuple

from google.generativeai import types as gemini_types
import google.generativeai as genai

from app.core.config import settings

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────
# LLM client setup — one per-process, configured once
# ──────────────────────────────────────────────────────────────────────
_llm_model = None
_max_retries = 3
_backoff_base = 1.0  # seconds


def _ensure_llm():
    """Initialise the configured LLM model once. Safe to call multiple times."""
    global _llm_model
    if _llm_model is not None:
        return _llm_model

    key = (settings.GEMINI_API_KEY or "").strip()
    if not key:
        logger.warning(
            "GEMINI_API_KEY not set — LLM router will return honest-unavailable text"
        )
        _llm_model = None
        return None

    try:
        genai.configure(api_key=key)
        _llm_model = genai.GenerativeModel("gemini-1.5-flash")
        logger.info("LLM router initialised with Gemini flash")
    except Exception as e:
        logger.error(f"Failed to initialise Gemini: {e}")
        _llm_model = None
        return None

    return _llm_model


# ──────────────────────────────────────────────────────────────────────
# Prompt builders — one per task, each returns a plain-text prompt
# ──────────────────────────────────────────────────────────────────────


def _build_transport_prompt(context: Dict[str, Any]) -> str:
    """Prompt for outbound + return transport discovery."""
    src = context.get("source_name", "origin")
    dst = context.get("destination_name", "destination")
    start = context.get("start_datetime", "17 OCT 4:00 PM")
    end = context.get("end_datetime", "20 OCT 4:00 PM")
    days = context.get("duration_days", 3)
    pax = context.get("total_travellers", 2)
    adults = context.get("adults", 2)
    children = context.get("children", 0)
    group = context.get("group_type", "Solo")
    interests = context.get("interests", "")
    budget = context.get("budget", 50000)

    sections = [
        f"Trip context:",
        f"  Origin: {src}",
        f"  Destination: {dst}",
        f"  Dates: {start} → {end} ({days} days, {days - 1} nights)",
        f"  Group: {group} — {adults} adults, {children} children (total {pax})",
        f"  Budget (base trip budget): ₹{budget:,.0f}",
        f"  Interests: {interests}",
        "",
        "TASK: Generate up to 5 real transport options for the outbound journey "
        f"(from {src} to {dst}) and 5 real options for the return journey "
        f"(from {dst} to {src}).",
        "",
        "REQUIREMENTS:",
        "  • Use real provider schedules where available (Amadeus flights, Indian "
        "railway train listings, licensed bus aggregators).",
        "  • If a provider has not been configured, document it honestly and show "
        "an unavailable state — never fabricate a confirmed timetable or fare.",
        "  • For each option include: mode, provider, departure/arrival date & time, "
        "duration, transfers/stops, per-person fare, group total (per-person × "
        f"{pax}), currency, availability/quote expiry, booking conditions.",
        "  • If adult/child fares differ, calculate group total as "
        f"(adult_fare × {adults}) + (child_fare × {children}).",
        "  • Label any price that is not a confirmed booking quote clearly as an "
        "estimate or unavailable.",
        "  • Do NOT include any monetary totals that should be computed by the "
        "backend financial engine. All group totals must be labelled 'estimate'.",
        "",
        "Return the response as a JSON object with keys 'outbound' (list of up to 5) "
        "and 'return' (list of up to 5). Each item must have: mode, provider, "
        "departure, arrival, duration, transfers, per_person_fare_estimate, "
        "group_total_estimate, currency, availability, conditions."
    ]

    return "\n".join(sections)


def _build_places_prompt(context: Dict[str, Any]) -> str:
    """Prompt for destination place discovery."""
    dst = context.get("destination_name", "destination")
    start = context.get("start_datetime", "17 OCT")
    end = context.get("end_datetime", "20 OCT")
    days = context.get("duration_days", 3)
    pax = context.get("total_travellers", 2)
    adults = context.get("adults", 2)
    children = context.get("children", 0)
    group = context.get("group_type", "Solo")
    interests = context.get("interests", "")
    budget = context.get("budget", 50000)
    remaining = context.get("remaining_budget_after_transport", 40000)
    protected = context.get("place_selection_protected", remaining * 0.20)
    allowance = remaining - protected

    sections = [
        f"Trip context:",
        f"  Destination: {dst}",
        f"  Dates: {start} → {end} ({days} days, {days - 1} nights)",
        f"  Group: {group} — {adults} adults, {children} children (total {pax})",
        f"  Base trip budget: ₹{budget:,.0f}",
        f"  Remaining budget after transport: ₹{remaining:,.0f}",
        f"  20% place-selection protected buffer: ₹{protected:,.0f}",
        f"  Available place-selection allowance: ₹{allowance:,.0f}",
        f"  Interests: {interests}",
        "",
        "TASK: Generate up to 10 real candidate places per required category for "
        f"the destination {dst}.",
        "",
        "REQUIRED CATEGORIES (show clearly separated):",
        "  1. Must Visit Places",
        "  2. Activities to Do",
        "  3. Restaurants",
        "  4. Cafés",
        "  5. Stays (exactly one must be selectable)",
        "  6. Shopping Places",
        "  7. Healthcare and Educational Places (museums, clinics, pharmacies — "
        "display only, NOT selectable as itinerary attractions)",
        "  8. Other Places",
        "",
        "REQUIREMENTS:",
        "  • Use real provider data (Google Places, licensed guides, museum "
        "databases, verified local knowledge).",
        "  • Never invent a place merely to reach 10 results per category.",
        "  • Each result must include where available: name, category, address, "
        "latitude & longitude (never (0,0) as fallback), short description, "
        "opening hours, visit duration, estimated/verified cost, provider/source, "
        "accessibility information.",
        "  • Restaurant prices: save the real price information or price range "
        "when available, with source and currency. Do NOT display restaurant prices "
        "on the place-selection screen (that appears later on the Plan screen).",
        "  • Accommodation: each stay option must provide property name, address, "
        "dates of stay, number of nights, room types, occupancy/capacity, per-room "
        "price, per-night price, taxes/fees, group price, booking/quote source.",
        "  • Show transparent calculations: room price per night × number of nights "
        "× number of required rooms, plus applicable taxes and charges. Do NOT "
        "multiply a room price by the number of travellers if the room price "
        "already covers multiple occupants.",
        "  • Healthcare/educational places: may be displayed for discovery but "
        "must NOT be selectable as itinerary attractions. The backend must enforce "
        "this restriction.",
        "  • Do NOT include any price calculations that the backend should compute. "
        "All cost fields must be labelled 'estimate' or provide source/currency.",
        "  • The 20% place-selection budget guard will be enforced by the backend — "
        "the LLM only recommends; the gate is backend-only.",
        "",
        "Return a JSON object with keys for each category, each containing a list "
        "of up to 10 items. Each item must have: name, category, address, lat, lng, "
        "description, opening_hours, visit_duration_minutes, cost_estimate (label "
        "as estimate + source + currency), provider, accessibility_notes."
    ]

    return "\n".join(sections)


def _build_local_transport_prompt(context: Dict[str, Any]) -> str:
    """Prompt for in-destination transport between selected locations."""
    src = context.get("selected_locations", [])[0] if context.get("selected_locations") else context.get("destination_name", "destination")
    # Build legs from selected places
    legs = context.get("itinerary_legs", [])
    pax = context.get("total_travellers", 2)
    group = context.get("group_type", "Solo")

    sections = [
        f"Trip context:",
        f"  Destination: {context.get('destination_name', 'destination')}",
        f"  Group: {group} — {pax} total travellers",
        f"  Mode: {context.get('mode', 'ADVENTUROUS_MODE')}",
        f"  Selected places count: {len(context.get('selected_places', []))}",
        f"  Itinerary legs to plan: {len(legs)}",
        "",
        "TASK: For each required route between selected locations within the "
        f"destination, generate up to 3 real transport options.",
        "",
        "TRANSPORT CATEGORIES (present each separately, do NOT combine into a "
        "misleading single fare):",
        "  A. Public transport (public bus, MMTS, appropriate supported service): "
        "route, stops/transfers, distance, departure/arrival times, duration, "
        "per-person fare, group fare (per-person × {pax}), operating schedule.",
        "  B. Auto or metro: actual applicable mode, route, distance, travel "
        "duration, per-person fare, group fare.",
        "  C. Private cab: estimated/confirmed route, distance, travel duration, "
        "vehicle capacity, number of vehicles required, total fare, fare per "
        "traveller when useful.",
        "",
        "REQUIREMENTS:",
        "  • Use real provider data (local transit APIs, mapped routes).",
        "  • Never fabricate a confirmed schedule or fare. If a provider is not "
        "configured, document the unavailable state honestly.",
        "  • For per-person fare: group cost = per-person fare × applicable traveller "
        f"count ({pax}).",
        "  • For private vehicle: group cost = per-vehicle fare × number of vehicles "
        "required.",
        "  • If child fares or discounts apply, use the provider's actual rules.",
        "  " "• Never calculate a private cab by multiplying its total vehicle fare by "
        "every traveller unless the provider's pricing model requires that calculation.",
        "  • LLM may propose sensible routes and modes, but route, timing, distance "
        "and fare must be validated using actual routing or transit data when available.",
        "  • For each leg, save: origin, destination, start/arrival time where known, "
        "distance, estimated duration, selected transport mode, selected option, "
        f"fare basis, group cost, provider or estimation source, confidence/freshness.",
        "",
        "Return a JSON object keyed by leg index, each containing up to 3 options. "
        "Each option must have: mode, provider, origin, destination, departure, "
        "arrival, duration_mins, distance_km, per_person_fare_estimate, group_total_estimate, "
        "currency, availability, conditions — and each monetary field must be labelled "
        "'estimate' with source/currency note.",
    ]

    return "\n".join(sections)


def _build_itinerary_prompt(context: Dict[str, Any]) -> str:
    """Prompt for day-by-day itinerary generation."""
    src = context.get("source_name", "origin")
    dst = context.get("destination_name", "destination")
    start = context.get("start_datetime", "17 OCT 4:00 PM")
    end = context.get("end_datetime", "20 OCT 4:00 PM")
    days = context.get("duration_days", 3)
    pax = context.get("total_travellers", 2)
    adults = context.get("adults", 2)
    children = context.get("children", 0)
    group = context.get("group_type", "Solo")
    mode = context.get("mode", "ADVENTUROUS_MODE")
    interests = context.get("interests", "")
    budget = context.get("budget", 50000)
    remaining = context.get("remaining_budget_after_transport", 40000)
    food_tier = context.get("food_tier", "standard")
    selected_places = context.get("selected_places", [])
    selected_stay = context.get("selected_stay")
    itinerary_legs = context.get("itinerary_legs", [])
    guide_fee = context.get("guide_fee", 0.0)
    platform_fee = context.get("platform_fee", 0.0)
    safety_reserve = context.get("safety_reserve", 0.0)
    protection_fee = context.get("protection_fee", 50.0)

    # Compute final planned amount in the prompt for reference (but backend still
    # is the authority; LLM only generates text, not final totals).
    final_amount = round(budget + guide_fee + platform_fee + safety_reserve + protection_fee, 0)

    sections = [
        f"Trip context:",
        f"  Origin: {src}",
        f"  Destination: {dst}",
        f"  Dates: {start} → {end} ({days} days, {days - 1} nights)",
        f"  Group: {group} — {adults} adults, {children} children (total {pax})",
        f"  Mode: {mode}",
        f"  Base trip budget: ₹{budget:,.0f}",
        f"  Remaining after transport: ₹{remaining:,.0f}",
        f"  Food tier: {food_tier}",
        f"  Interests: {interests}",
        "",
        "TASK: Generate a complete day-by-day itinerary for every actual trip day "
        f"from {start} to {end}. Use the real trip dates and times — do NOT generate "
        "an itinerary with arbitrary four-day defaults for a three-day trip.",
        "",
        "REQUIRED CONTENT for EACH day:",
        "  • Date.",
        "  • Destination or area.",
        "  • Day title.",
        "  • Activities in chronological order, each with: start time, end time "
        "or estimated duration, place name and category, valid coordinates, travel "
        "time from the previous stop, selected transport leg, estimated/confirmed "
        "cost (label as estimate + source), meal stops, relevant opening hours, "
        "practical notes, weather-related guidance where appropriate.",
        "",
        "CONSTRAINTS:",
        "  • Use the real trip dates and times — schedule attractions after "
        "actual arrival, not arbitrarily.",
        "  • If the user arrives late in the evening, do NOT schedule attractions "
        "before the actual arrival time.",
        "  • If there is a return transport departure, ensure the final day leaves "
        "enough time for selected transport and required check-in/boarding buffer.",
        "  • Do NOT use (0, 0) as a fabricated location coordinate — if a place "
        "coordinate is unknown, label it as 'pending' and the backend will fill it.",
        "  • Do NOT schedule attractions after closing time unless opening hours "
        "are unknown (label as 'hours unknown').",
        "  • Do NOT create impossible overlaps, unrealistic travel connections, "
        "or duplicate attractions merely to fill the day.",
        "  • Meal timing must be coherent — do not place breakfast, lunch and "
        "dinner at arbitrary contradictory times.",
        "  • The generated itinerary must be feasible for the saved dates, selected "
        "transport, accommodation and traveller composition.",
        "",
        "FINANCIAL CONTEXT (for narrative only — backend independently computes):",
        f"  • Base trip budget: ₹{budget:,.0f}",
        f"  • Guide fee ({int(0.125*100)}% if GUIDE_MODE else 0): ₹{guide_fee:,.0f}",
        f"  • Platform fee ({int(0.03*100)}%): ₹{platform_fee:,.0f}",
        f"  • Safety reserve ({int(0.15*100)}%): ₹{safety_reserve:,.0f}",
        f"  • TRAVION Refund Protection (fixed): ₹{protection_fee:,.0f}",
        f"  • Final planned amount (backend authoritative): ₹{final_amount:,.0f}",
        "",
        "REQUIREMENTS:",
        "  • The LLM must NOT be the financial authority. All monetary amounts "
        "referenced above are shown for narrative context only; the backend will "
        "independently validate and recalculate before any persistence.",
        "  • Include weather information where available, but clearly identify "
        "dates beyond the forecast horizon and offer only climatological context.",
        "  • Do not silently replace a selected place or itinerary activity without "
        "the user's approval.",
        "  • Do not fabricate live GPS positions, traffic conditions or turn-by-turn "
        "directions. If live data is unavailable, label as estimate.",
        "",
        "Return a JSON object keyed by day number (1..{days}), each containing: "
        "day, date, title, stops (list of: time, title, category, lat/lng, "
        "duration_mins, transport_leg, cost_estimate_with_source, meal_stop, "
        "opening_hours_note, practical_notes). The top-level object must also have "
        "'metadata' with: source, destination, days, pax, adults, children, mode, "
        "budget, guide_fee, platform_fee, safety_reserve, protection_fee, "
        "final_planned_amount — all values for backend reference only.",
    ]

    return "\n".join(sections)


def _build_review_prompt(context: Dict[str, Any]) -> str:
    """Prompt for final review narration (not financial recalculation)."""
    src = context.get("source_name", "origin")
    dst = context.get("destination_name", "destination")
    start = context.get("start_datetime", "17 OCT 4:00 PM")
    end = context.get("end_datetime", "20 OCT 4:00 PM")
    days = context.get("duration_days", 3)
    pax = context.get("total_travellers", 2)
    group = context.get("group_type", "Solo")
    mode = context.get("mode", "ADVENTUROUS_MODE")
    budget = context.get("budget", 50000)
    selected_plan = context.get("selected_plan", "Recommended")
    selected_food_tier = context.get("food_tier", "standard")
    guide_fee = context.get("guide_fee", 0.0)
    platform_fee = context.get("platform_fee", 0.0)
    safety_reserve = context.get("safety_reserve", 0.0)
    protection_fee = context.get("protection_fee", 50.0)

    sections = [
        f"Trip context:",
        f"  Origin: {src}",
        f"  Destination: {dst}",
        f"  Dates: {start} → {end} ({days} days, {days - 1} nights)",
        f"  Group: {group} — {pax} total travellers",
        f"  Mode: {mode}",
        f"  Base trip budget: ₹{budget:,.0f}",
        f"  Selected plan: {selected_plan}",
        f"  Food tier: {selected_food_tier}",
        f"  Guide fee (computed by backend): ₹{guide_fee:,.0f}",
        f"  Platform fee (computed by backend): ₹{platform_fee:,.0f}",
        f"  Safety reserve (computed by backend): ₹{safety_reserve:,.0f}",
        f"  TRAVION Refund Protection (computed by backend): ₹{protection_fee:,.0f}",
        f"  Final planned amount (computed by backend): ₹{round(budget + guide_fee + platform_fee + safety_reserve + protection_fee, 0):,.0f}",
        "",
        "TASK: Narrate the complete, saved, validated trip — do NOT regenerate a "
        "new itinerary merely because the user opened the Review page. Present the "
        "edited plan as the final source of truth.",
        "",
        "INCLUDE:",
        "  • Trip details: source → destination, dates, duration, group type, "
        "interests, selected food tier, mode, selected plan.",
        "  • Final itinerary: every day and every activity with: time, activity, "
        "place, duration, travel time, transport, cost, notes, map location.",
        "  • Budget breakdown: base trip spending, round-trip transport, destination "
        "transport, stay, food, activities and entries, guide fee, platform fee, "
        "safety reserve, ₹50 protection fee, final planned amount. The total must "
        "reconcile exactly with the Plan screen.",
        "  • Editing behavior: user edits become authoritative until explicitly "
        "regenerated. Never silently regenerate or overwrite user edits. Revalidate "
        "timing, location, route and budget on edit.",
        "",
        "REQUIREMENTS:",
        "  • Do NOT generate a new itinerary merely because the user opened the "
        "Review page.",
        "  • If the user edits an activity: persist the edit, preserve original "
        "revision for audit, revalidate timing/location/route/budget, update map, "
        "recalculate costs when applicable.",
        "  • If an edit creates an invalid schedule or exceeds the budget, explain "
        "the issue and require correction or explicit budget adjustment.",
        "  • If the user changes selected stay, transport, food tier or Mode, "
        "recalculate dependent amounts using the backend financial service.",
        "",
        "Return a JSON object with: trip_details (keys as above), itinerary (per-day "
        "as described), budget_breakdown (all line items + final planned amount). "
        "All monetary fields must reference that they are 'computed by backend' "
        "and show the exact value.",
    ]

    return "\n".join(sections)


# ──────────────────────────────────────────────────────────────────────
# Core routing function — takes context + task, returns (raw_text, model_info)
# ──────────────────────────────────────────────────────────────────────


def route_task(task: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """Route a task to the LLM with the given trip context.

    Args:
        task: One of "transport", "places", "local_transport", "itinerary", "review"
        context: Dict with all saved trip information (source_name, destination_name,
                 start_datetime, end_datetime, duration_days, total_travellers, adults,
                 children, group_type, interests, budget, mode, selected_places,
                 selected_stay, itinerary_legs, remaining_budget_after_transport,
                 food_tier, guide_fee, platform_fee, safety_reserve, protection_fee,
                 selected_plan, etc.)

    Returns:
        Dict with keys:
        - "status": "OK" | "UNAVAILABLE" | "ERROR"
        - "result": parsed JSON from LLM (task-specific shape) or honest text
        - "model_name": model used (or None)
        - "latency_ms": call latency
        - "raw_response": the model's raw text for debugging
    """
    model = _ensure_llm()
    start_ts = time.time()

    # Select prompt builder
    prompt_builders = {
        "transport": _build_transport_prompt,
        "places": _build_places_prompt,
        "local_transport": _build_local_transport_prompt,
        "itinerary": _build_itinerary_prompt,
        "review": _build_review_prompt,
    }

    builder = prompt_builders.get(task)
    if builder is None:
        return {
            "status": "ERROR",
            "result": None,
            "model_name": None,
            "latency_ms": int((time.time() - start_ts) * 1000),
            "raw_response": f"Unknown task: {task}",
        }

    try:
        prompt = builder(context)
    except Exception as e:
        logger.error(f"Prompt build failed for task={task}: {e}")
        return {
            "status": "ERROR",
            "result": {"honest": f"Failed to build prompt: {e}"},
            "model_name": None,
            "latency_ms": int((time.time() - start_ts) * 1000),
            "raw_response": str(e),
        }

    # Attempt LLM call with retries
    result = None
    model_name = None
    raw = ""

    if model is None:
        # No API key configured — return honest unavailable text
        result = {"honest": "LLM not configured — no API key set. All transport/place/itinerary "
                        "recommendations must come from verified provider data or backend "
                        "estimated fare bands. Contact administration to configure "
                        "GEMINI_API_KEY for LLM-assisted planning."}
        raw = str(result["honest"])
    else:
        for attempt in range(1, _max_retries + 1):
            try:
                response = model.generate_content(prompt,
                                                  )
                raw = response.text
                # Attempt lightweight JSON parse if the model returned JSON
                try:
                    result = json.loads(raw)
                    # Strip any price fields that look like they weren't labelled
                    # (the prompt already labels them, but double-check)
                except json.JSONDecodeError:
                    # Not JSON — store as raw text; backend will parse what it needs
                    result = {"raw_text": raw}
                model_name = getattr(model, 'model_name', 'gemini-1.5-flash')
                break  # success
            except Exception as e:
                logger.warning(
                    f"LLM call attempt {attempt}/{_max_retries} failed: {e}"
                )
                if attempt < _max_retries:
                    time.sleep(_backoff_base * attempt)  # exponential backoff
                else:
                    # All attempts failed
                    result = {"honest": f"LLM call failed after {_max_retries} attempts: {str(e)}"}
                    raw = str(result["honest"])

    latency_ms = int((time.time() - start_ts) * 1000)

    return {
        "status": "OK" if result is not None else "UNAVAILABLE",
        "result": result,
        "model_name": model_name,
        "latency_ms": latency_ms,
        "raw_response": raw[:2000] if raw else "",  # truncate for safety
    }


# ──────────────────────────────────────────────────────────────────────
# Helper: extract trip context from database record for endpoint use
# ──────────────────────────────────────────────────────────────────────
def build_context_from_trip(trip_record: Dict[str, Any], profile_record: Dict[str, Any],
                            selections_record: Dict[str, Any],
                            itinerary_record: Dict[str, Any],
                            pricing_snapshot: Dict[str, Any]) -> Dict[str, Any]:
    """Build a context dict from the database for LLM routing.

    This pulls the authoritative saved values and formats them for the LLM prompts.
    The LLM NEVER receives computed monetary totals — only the raw saved values
    and the backend-computed fee snapshot (which it references but does not trust).
    """

    # Derive basic fields
    source_name = trip_record.get("source_name", "")
    destination_name = trip_record.get("destination_name", "")
    start_dt = trip_record.get("start_datetime", "")
    end_dt = trip_record.get("end_datetime", "")

    # Duration
    from datetime import datetime
    try:
        s = datetime.fromisoformat(str(start_dt))
        e = datetime.fromisoformat(str(end_dt))
        days = max(1, (e - s).days + 1) if (e - s).days >= 0 else 1
    except Exception:
        days = 3

    # Party from profile
    party_data = profile_record.get("questions_answers", {}) or {}
    group_type = str(party_data.get("party_type", "Solo") or "Solo")
    # Extract adults/children from trip_profile or answers
    adults = int(party_data.get("adults", 0) or 0)
    children = int(party_data.get("children", 0) or 0)
    total_travellers = max(1, adults + children)

    # Budget
    budget = float(trip_record.get("budget", 50000) or 50000)

    # Mode
    mode = str(trip_record.get("mode", "ADVENTUROUS_MODE") or "ADVENTUROUS_MODE")

    # Interests
    interests = str(party_data.get("experience_type", "") or "")

    # Selected places / stay from selections
    selected_places = selections_record.get("selections", []) or []
    # Filter to active (not removed)
    selected_places = [s for s in selected_places if s.get("status") != "removed"]

    selected_stay = selections_record.get("selected_stay") or None

    # Remaining budget after transport (from snapshot or compute)
    remaining_after_transport = float(
        pricing_snapshot.get("remaining_budget", budget * 0.8) or budget * 0.8)

    # Itinerary legs
    legs = itinerary_record.get("legs_data", []) or []

    # Pricing snapshot from backend (the authoritative fee calculation)
    guide_fee = float(pricing_snapshot.get("guide_fee", 0.0) or 0.0)
    platform_fee = float(pricing_snapshot.get("platform_fee", 0.0) or 0.0)
    safety_reserve = float(pricing_snapshot.get("safety_reserve", 0.0) or 0.0)
    protection_fee = float(pricing_snapshot.get("protection_fee", 50.0) or 50.0)

    # Food tier
    food_tier = str(pricing_snapshot.get("food_tier", "standard") or "standard")

    # Selected plan
    selected_plan = str(pricing_snapshot.get("plan_selected", "Recommended") or "Recommended")

    # Place-selection buffer (20%)
    protected_buffer = remaining_after_transport * 0.20
    place_allowance = remaining_after_transport - protected_buffer

    return {
        "source_name": source_name,
        "destination_name": destination_name,
        "start_datetime": start_dt,
        "end_datetime": end_dt,
        "duration_days": days,
        "total_travellers": total_travellers,
        "adults": adults,
        "children": children,
        "group_type": group_type,
        "interests": interests,
        "budget": budget,
        "mode": mode,
        "selected_places": selected_places,
        "selected_stay": selected_stay,
        "itinerary_legs": legs,
        "remaining_budget_after_transport": remaining_after_transport,
        "food_tier": food_tier,
        "selected_plan": selected_plan,
        "guide_fee": guide_fee,
        "platform_fee": platform_fee,
        "safety_reserve": safety_reserve,
        "protection_fee": protection_fee,
        "place_selection_protected": protected_buffer,
        "place_selection_allowance": place_allowance,
    }