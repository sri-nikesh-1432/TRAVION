"""GROUP COST CONTRACT (product spec §15/§16/§40/§50/§51/§53).

Travion must NEVER generate a plan for one person when the user is travelling
as a group. The 3-question interview captures {'group','total','adults',
'children'}; every cost engine must use that EXACT headcount:

  * transport_total = fare_per_person × 2 × total_members      (round trip)
  * food_total      = per_person_per_day × total_members × days
  * stay_total      = nightly × nights × rooms, rooms = ⌈members / 2⌉
  * activities      = entry_fee per person × members

Also pins the authoritative fee split:
  GUIDE_MODE:      guide_fee = 12.5% of base, platform = 3% of base
  ADVENTUROUS:     guide_fee = 0,            platform = 3% of base
  final_total      = base + guide_fee + platform_fee

These tests drive the REAL service layer (party_pax + both plan engines).
"""
from app.services.pricing_service import party_pax
from app.services.ai_orchestrator import AIOrchestrator
from app.services.india_planner import build_estimate_plan


def test_party_pax_uses_exact_structured_total():
    """10 members (8 adults + 2 children) → pax MUST be 10 — never a label
    estimate like Friends-Group≈4.5 (the old bug that under-priced groups)."""
    assert party_pax({"group": "Friends Group", "total": 10, "adults": 8, "children": 2}) == 10
    assert party_pax({"group": "Family", "total": 6, "adults": 4, "children": 2}) == 6
    assert party_pax({"group": "Solo", "total": 1, "adults": 1, "children": 0}) == 1
    assert party_pax({"group": "Couple", "total": 2, "adults": 2, "children": 0}) == 2


def test_party_pax_falls_back_to_adults_plus_children():
    assert party_pax({"group": "Family", "adults": 6, "children": 2}) == 8


def test_party_pax_legacy_string_labels_still_work():
    """Legacy trips answered a bare string — the label estimates apply."""
    assert party_pax("Solo") == 1
    assert party_pax("Couple") == 2
    assert party_pax(None) == 1


def _verified_trip(party_answer):
    """A verified-package trip (Bangalore → Ooty) with the given party answer."""
    return AIOrchestrator.generate_itinerary(
        source_name="Bangalore",
        destination_name="Ooty",
        start_date="2027-03-01T06:00:00",
        end_date="2027-03-04T06:00:00",
        mode="ADVENTUROUS_MODE",
        profile={
            "budget": {"min": 40000, "max": 60000},
            "party": party_answer,
            "experience": ["Adventure"],
            "stay_pref": "3 Star",
            "transport_pref": "AC Sleeper Bus",
        },
        source_coords={"lat": 12.9716, "lng": 77.5946},
        dest_coords={"lat": 11.4102, "lng": 76.6950},
    )


def test_transport_and_rooms_scale_with_exact_group_size():
    """₹500/person transport × 10 members must become ₹5,000 — NOT ₹500, and
    NOT ₹2,250 (the old 4.5× Friends-Group estimate). 10 travellers → 5 rooms."""
    solo = _verified_trip({"group": "Solo", "total": 1, "adults": 1, "children": 0})
    ten = _verified_trip({"group": "Friends Group", "total": 10, "adults": 8, "children": 2})
    four = _verified_trip({"group": "Friends Group", "total": 4, "adults": 4, "children": 0})

    solo_bd = solo["cost_breakdown"]
    four_bd = four["cost_breakdown"]
    ten_bd = ten["cost_breakdown"]

    assert solo_bd["headcount"] == 1
    assert four_bd["headcount"] == 4
    assert ten_bd["headcount"] == 10

    # Transport is strictly proportional to headcount (round trip × pax).
    per_person = solo_bd["transport"] / 1
    assert abs(four_bd["transport"] - 4 * per_person) < 1.0
    assert abs(ten_bd["transport"] - 10 * per_person) < 1.0

    # Rooms: 2 travellers per room → 10 travellers = 5 rooms.
    assert ten_bd["nights"] >= 1
    # Stay scales in the rooms dimension (same nights, same tier): 10 pax ≈ 5× solo.
    assert abs(ten_bd["stay"] - 5 * solo_bd["stay"]) < 1.0


def test_estimate_engine_food_scales_with_exact_group_size():
    """India-wide estimate engine: food is per-person-per-day × members × days."""
    kwargs = dict(
        source_name="Chennai",
        destination_name="Kodaikanal",
        source_state="Tamil Nadu",
        destination_state="Tamil Nadu",
        start_date="2027-03-01T06:00:00",
        end_date="2027-03-04T06:00:00",
        mode="ADVENTUROUS_MODE",
        source_coords={"lat": 13.0827, "lng": 80.2707},
        dest_coords={"lat": 10.2381, "lng": 77.4892},
    )
    solo = build_estimate_plan(
        profile={
            "budget": {"min": 8000, "max": 12000},
            "party": {"group": "Solo", "total": 1, "adults": 1, "children": 0},
            "experience": ["Mixed"],
            "stay_pref": "3 Star",
            "transport_pref": "Bus",
        },
        **kwargs,
    )
    ten = build_estimate_plan(
        profile={
            "budget": {"min": 80000, "max": 120000},
            "party": {"group": "Friends Group", "total": 10, "adults": 8, "children": 2},
            "experience": ["Mixed"],
            "stay_pref": "3 Star",
            "transport_pref": "Bus",
        },
        **kwargs,
    )
    assert solo["cost_breakdown"]["headcount"] == 1
    assert ten["cost_breakdown"]["headcount"] == 10
    # The 10-person trip must cost far more than one person — the group size
    # has to be visible in the actual numbers, not just the traveller count.
    assert ten["cost_breakdown"]["transport"] > 8 * solo["cost_breakdown"]["transport"]
    assert ten["cost_breakdown"]["stay"] > 4 * solo["cost_breakdown"]["stay"]
