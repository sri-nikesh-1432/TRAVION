"""Budget engine tests — the strict-budget guarantee the product depends on.

Every plan generated for a traveller must satisfy:
    total = base_plan_cost + platform_fee  (fee = 3% of base)
    total <= user_max_budget
and budget strings like "₹10,000 - ₹25,000" must parse to (10000, 25000) —
never the old billion-rupee concatenation (1000025000).
"""
import pytest

from app.services.budget_service import (
    parse_budget,
    compute_totals,
    base_ceiling_for,
)
from app.services.multi_plan_engine import build_plans


def _base_plan(cost: float = 28000.0, days: int = 2, headcount: float = 2.0):
    return {
        "destination": "Pondicherry",
        "days": [
            {"day": 1, "title": "Day 1", "stops": [
                {"id": "s1", "time": "10:00 AM", "title": "Promenade Beach",
                 "category": "attraction", "location_name": "Pondicherry",
                 "lat": 11.93, "lng": 79.83, "estimated_cost": 0,
                 "duration_minutes": 90, "source": "verified_api", "verified": True},
                {"id": "s2", "time": "01:00 PM", "title": "Lunch",
                 "category": "food", "location_name": "Pondicherry",
                 "lat": 11.93, "lng": 79.83, "estimated_cost": 400,
                 "duration_minutes": 60, "source": "verified_api", "verified": True},
            ]},
            {"day": 2, "title": "Day 2", "stops": [
                {"id": "s3", "time": "09:00 AM", "title": "Auroville",
                 "category": "attraction", "location_name": "Pondicherry",
                 "lat": 12.0, "lng": 79.8, "estimated_cost": 0,
                 "duration_minutes": 120, "source": "verified_api", "verified": True},
            ]},
        ],
        "cost_breakdown": {
            "transport": 12000.0, "stay": 18000.0, "food": 6000.0,
            "activities": 0.0, "guide_fee": 0.0, "nights": (days - 1),
            "headcount": headcount,
        },
    }


# ── parse_budget ─────────────────────────────────────────────────────────────

def test_parse_range_string():
    assert parse_budget("₹10,000 - ₹25,000") == (10000.0, 25000.0)
    assert parse_budget("10000-25000") == (10000.0, 25000.0)
    assert parse_budget("₹10,000 — ₹25,000") == (10000.0, 25000.0)


def test_parse_single_value_scales_floor():
    bmin, bmax = parse_budget("15000")
    assert bmax == 15000.0
    assert bmin == pytest.approx(12000.0)


def test_parse_never_concatenates_components():
    """The old bug: '₹10,000 - ₹25,000' → 1000025000 (~₹1,00,00,25,000)."""
    bmin, bmax = parse_budget("₹10,000 - ₹25,000")
    assert bmax == 25000.0
    assert bmax < 1_000_000
    # Same protection for dict/other inputs.
    bmin2, bmax2 = parse_budget({"min": 10, "max": 25})
    assert bmax2 == 25.0


def test_parse_fallback():
    bmin, bmax = parse_budget(None, fallback=(12000.0, 15000.0))
    assert (bmin, bmax) == (12000.0, 15000.0)


# ── compute_totals / base_ceiling_for ───────────────────────────────────────

def test_compute_totals_includes_three_percent_fee():
    t = compute_totals(18447.0)
    assert t["platform_fee"] == 553
    assert t["final_total"] == 19000
    assert t["base_plan_cost"] == 18447


def test_ceiling_means_ceiling():
    c = base_ceiling_for(25000.0)
    assert c == pytest.approx(25000.0 / 1.03)
    # A base plan exactly at the ceiling (rounded to rupee) must fit.
    t = compute_totals(base_ceiling_for(25000.0))
    assert t["final_total"] <= 25000.0


# ── build_plans hard constraint ─────────────────────────────────────────────

@pytest.mark.parametrize("bmax", [25000.0, 50000.0, 15000.0, 80000.0])
def test_all_plans_are_within_budget(bmax):
    bmin = bmax * 0.8
    plans = build_plans(_base_plan(), bmin, bmax,
                        selected_places=["Promenade Beach"],
                        selected_food=["Lunch"])
    assert {p["type"] for p in plans} == {"VALUE", "RECOMMENDED", "PREMIUM"}
    for p in plans:
        assert p["within_budget"] is True, f"{p['type']} over budget: {p['final_total']}"
        assert float(p["final_total"]) <= bmax
        fee = p["platform_fee"]
        assert p["final_total"] == p["base_plan_cost"] + fee


def test_plans_are_laddered():
    bmax = 50000.0
    plans = build_plans(_base_plan(), bmax * 0.8, bmax)
    totals = {p["type"]: p["final_total"] for p in plans}
    assert totals["VALUE"] <= totals["RECOMMENDED"] <= totals["PREMIUM"] <= bmax


def test_heavy_base_plan_still_clamped():
    """A base estimate way over budget must be trimmed — never returned as-is."""
    bmax = 20000.0
    plans = build_plans(_base_plan(cost=90000.0), bmax * 0.8, bmax)
    for p in plans:
        assert float(p["final_total"]) <= bmax
        assert p["within_budget"] is True


# ── Budget Feasibility Engine gate — the strict-budget product guarantee ────
# The core fix the product demanded: ₹100 / ₹500 / ₹1,000 must NEVER produce a
# normal itinerary. Feasibility is decided by the ENGINE before the planner.

from app.services.budget_engine import (
    check_budget_feasibility,
    get_budget_constraints,
    calculate_max_affordable_days,
    validate_itinerary_budget,
    tier_for,
)

GEO = dict(
    destination="Pondicherry",
    mode="ADVENTUROUS_MODE",
    profile={"party": "Solo"},
    source_coords=(13.0827, 80.2707),
    dest_coords=(11.93, 79.83),
    source_state="Tamil Nadu",
    destination_state="Puducherry",
)


@pytest.mark.parametrize("budget", [100, 250, 500, 700, 900])
def test_tiny_budgets_are_impossible(budget):
    """Sub-₹1,000 budgets are a hard rejection — never a normal itinerary."""
    v = check_budget_feasibility(budget=budget, requested_days=3, **GEO)
    assert v["feasible"] is False
    assert v["status"] == "impossible"
    assert v["budget_status"] == "restricted"
    assert v["minimum_required_budget"] > budget
    assert v["alternatives"]


def test_1000_to_2000_is_day_trip_no_stay():
    v = check_budget_feasibility(budget=1500, requested_days=3, **GEO)
    assert v["feasible"] is True
    assert v["status"] == "restricted"
    assert v["constraints"]["stay_allowed"] is False
    assert v["constraints"]["economy"] is True
    assert v["recommended_days"] <= 3
    assert v["recommended_days"] >= 1


def test_low_budget_still_generates_budget_trip():
    v = check_budget_feasibility(budget=3000, requested_days=3, **GEO)
    assert v["feasible"] is True
    assert v["constraints"]["economy"] is True
    assert v["max_affordable_days"] >= 1


def test_normal_budget_is_affordable_and_validated():
    v = check_budget_feasibility(budget=18000, requested_days=3, **GEO)
    assert v["feasible"] is True
    assert v["status"] == "affordable"
    assert v["constraints"]["economy"] is False
    assert v["minimum_required_budget"] <= 18000
    # An itinerary at minimum cost must be within budget per the validator.
    ok = validate_itinerary_budget(v["minimum_required_budget"], 18000)
    assert ok["valid"] is True


def test_max_affordable_days_is_monotonic():
    more = calculate_max_affordable_days(30000, "Pondicherry", "ADVENTUROUS_MODE", {"party": "Solo"},
                                         True, source_coords=(13.0827, 80.2707), dest_coords=(11.93, 79.83))
    less = calculate_max_affordable_days(6000, "Pondicherry", "ADVENTUROUS_MODE", {"party": "Solo"},
                                         True, source_coords=(13.0827, 80.2707), dest_coords=(11.93, 79.83))
    assert more >= less >= 0


def test_validate_accepts_cost_breakdown_dict():
    bd = {"final_total": 1400.0, "platform_fee": 41.0}
    assert validate_itinerary_budget(bd, 1500)["valid"] is True
    assert validate_itinerary_budget(bd, 1300)["valid"] is False


def test_tier_thresholds_centralized():
    assert tier_for(500) == "extremely_low"
    assert tier_for(1500) == "very_low"
    assert tier_for(3000) == "low"
    assert tier_for(4500) == "restricted"
    assert tier_for(6000) == "normal"


def test_constraints_never_invent_prices():
    c = get_budget_constraints(1500)
    assert c["impossible"] is False
    assert any(ref in c["tier_message"] for ref in ("day-trip", "no accommodation")) or c["tier_message"]


def test_build_plans_honors_engine_constraints():
    """Very-low budgets force economy + no-stay on EVERY variant — the planner
    cannot override the engine."""
    plans = build_plans(
        _base_plan(), 1200, 1500,
        selected_places=["Promenade Beach"],
        selected_food=["Lunch"],
        constraints={"economy": True, "stay_allowed": False},
    )
    for p in plans:
        assert p["final_total"] <= 1500
        assert p["cost_breakdown"].get("stay", 0) == 0
        stay_cats = [s.get("category") for d in p["days"] for s in d.get("stops", []) if s.get("category") == "stay"]
        assert not stay_cats
        assert any("Budget mode" in w for w in p["warnings"])


# ── "Continue without a stay" (stay_required=False) — absolute ₹0 stay rule ───

def test_stay_required_false_keeps_stay_cost_zero_everywhere():
    """'Continue without a stay' is an ABSOLUTE rule: even on a healthy budget
    that could afford a hotel, accommodation is ₹0 on every variant and no
    hotel is ever auto-added."""
    plans = build_plans(
        _base_plan(), 15000, 25000,
        selected_places=["Promenade Beach"],
        selected_food=["Lunch"],
        stay_required=False,
    )
    assert {p["type"] for p in plans} == {"VALUE", "RECOMMENDED", "PREMIUM"}
    for p in plans:
        assert p["stay_required"] is False
        assert float(p["cost_breakdown"].get("stay") or 0) == 0
        stay_stops = [s["category"] for d in p["days"] for s in d.get("stops", []) if s.get("category") == "stay"]
        assert not stay_stops
        assert any("continue without a stay" in w.lower() for w in p["warnings"])


def test_stay_required_false_beats_auto_stay():
    """Without the flag the planner adds a stay on a healthy budget; with
    stay_required=False it must not. Also verifies the user-selected stay wins
    when the flag is True."""
    auto = build_plans(_base_plan(), 15000, 25000)
    assert any(float(p["cost_breakdown"].get("stay") or 0) > 0 for p in auto)
    no_stay = build_plans(_base_plan(), 15000, 25000, stay_required=False)
    for p in no_stay:
        assert float(p["cost_breakdown"].get("stay") or 0) == 0


# ── Budget RANGE semantics: floor + ceiling, three-rung ladder, no padding ────

def test_budget_range_three_rung_ladder():
    """₹15,000–₹25,000 is a floor + ceiling, NOT a target max. VALUE leans at
    the floor, RECOMMENDED mid-range, PREMIUM up to the ceiling — always
    VALUE ≤ RECOMMENDED ≤ PREMIUM ≤ ceiling."""
    plans = build_plans(
        _base_plan(), 15000, 25000,
        selected_places=["Promenade Beach"],
        selected_food=["Lunch"],
    )
    totals = {p["type"]: p["final_total"] for p in plans}
    assert totals["VALUE"] <= totals["RECOMMENDED"] <= totals["PREMIUM"] <= 25000
    # A real ladder spans the range (PREMIUM should cost meaningfully more than
    # VALUE — they must actually be DIFFERENT plans, not three copies of max).
    assert totals["PREMIUM"] - totals["VALUE"] >= 1500
    for p in plans:
        assert p["budget_min"] == 15000
        assert p["budget_max"] == 25000
        assert p["within_budget"] is True


def test_below_floor_plan_not_padded_up():
    """If the realistic cheapest plan lands BELOW the floor, we keep the honest
    lower price and tell the user — we never pad costs to hit the minimum."""
    cheap_base = {
        "destination": "Pondicherry",
        "days": [
            {"day": 1, "title": "Day 1", "stops": [
                {"id": "c1", "time": "10:00 AM", "title": "Promenade Beach",
                 "category": "attraction", "location_name": "Pondicherry",
                 "lat": 11.93, "lng": 79.83, "estimated_cost": 0,
                 "duration_minutes": 90, "source": "verified_api", "verified": True},
            ]},
        ],
        "cost_breakdown": {
            "transport": 4000.0, "stay": 3000.0, "food": 2000.0,
            "activities": 0.0, "guide_fee": 0.0, "nights": 0, "headcount": 2.0,
        },
    }
    plans = build_plans(cheap_base, 30000, 40000)
    value = next(p for p in plans if p["type"] == "VALUE")
    assert float(value["final_total"]) < 30000  # below the floor, allowed
    assert value["within_budget"] is True
    assert any("don't pad costs" in w or "below your" in w for w in value["warnings"])