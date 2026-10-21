"""Tests for Step 08 Budget Cards computation in evaluate_budget_gate."""
from datetime import datetime
from unittest.mock import MagicMock
from app.services.stage_service import evaluate_budget_gate
from app.models.entities import Trip, TripProfile


def test_evaluate_budget_gate_returns_three_cards():
    trip = Trip(
        id="test-trip-cards",
        source_name="Chennai",
        destination_name="Hyderabad",
        start_datetime=datetime(2026, 10, 22),
        end_datetime=datetime(2026, 10, 26),
        budget=50000.0,
        mode="ADVENTUROUS_MODE",
        selected_transport={
            "outbound": {"id": "ob1", "operator": "IndiGo", "party_total": 4800.0},
            "return": {"id": "ret1", "operator": "IndiGo", "party_total": 4800.0},
        },
        profile=TripProfile(
            party_type="Solo",
            questions_answers={
                "party": {"total": 1, "adults": 1, "children": 0},
                "days": 4,
                "nights": 3,
            },
        ),
    )

    db = MagicMock()
    # Mock stage items: no extra stay rows, let stay be 0 or mock
    db.query.return_value.filter.return_value.all.return_value = []
    db.query.return_value.filter.return_value.first.return_value = None

    gate = evaluate_budget_gate(db, trip)

    assert "budget_cards" in gate
    cards = gate["budget_cards"]
    assert len(cards) == 3

    plan_a, plan_b, plan_c = cards[0], cards[1], cards[2]

    # Plan A: Budget
    assert plan_a["type"] == "VALUE"
    assert plan_a["plan_code"] == "PLAN A"
    assert plan_a["label"] == "Budget"
    assert plan_a["food_tier"] == "BASIC"
    assert plan_a["food_rate"] == 500.0
    assert plan_a["recommended"] is False

    # Plan B: Recommended
    assert plan_b["type"] == "RECOMMENDED"
    assert plan_b["plan_code"] == "PLAN B"
    assert plan_b["label"] == "Recommended"
    assert plan_b["food_tier"] == "STANDARD"
    assert plan_b["food_rate"] == 800.0
    assert plan_b["recommended"] is True

    # Plan C: Premium
    assert plan_c["type"] == "PREMIUM"
    assert plan_c["plan_code"] == "PLAN C"
    assert plan_c["label"] == "Premium"
    assert plan_c["food_tier"] == "PREMIUM"
    assert plan_c["food_rate"] == 1200.0
    assert plan_c["recommended"] is False

    # Check math: Base = Transport (9600) + Food
    # Trip days: inclusive calendar days (2026-10-22 to 2026-10-26 = 5 days)
    # Plan A food = 500 * 1 * 5 = 2500
    # Plan A base = 9600 + 2500 = 12100
    assert plan_a["spend"]["food"] == 2500.0
    assert plan_a["base_plan_cost"] == 12100.0
    # Adventurous mode: guide fee = 0
    assert plan_a["guide_fee"] == 0.0
    assert plan_a["platform_fee"] == round(12100 * 0.03, 0)
    assert plan_a["safety_reserve"] == round(12100 * 0.15, 0)
    assert plan_a["insurance_fee"] == 50.0
    expected_final_a = 12100 + round(12100 * 0.03, 0) + round(12100 * 0.15, 0) + 50
    assert plan_a["final_total"] == expected_final_a

    # Check that each card is within budget
    assert plan_a["within_budget"] is True
    assert plan_b["within_budget"] is True
    assert plan_c["within_budget"] is True
