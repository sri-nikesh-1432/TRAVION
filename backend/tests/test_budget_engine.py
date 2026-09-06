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