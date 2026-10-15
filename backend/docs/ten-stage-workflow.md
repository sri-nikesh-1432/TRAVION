# TRAVION 10-stage workflow — settled engineering rules

One persistent trip state, prompt-routed LLM, deterministic backend math.
The LLM proposes; the backend prices, gates and persists. Status: implemented.

## The 10 stages (all read/write the SAME trip row)

1 Trip (search) → 2 Travellers (adaptive discovery) → 3 Transport (5+5
round-trip options, select 1+1) → 4 Explore (10/category, exactly one stay)
→ 5 Mode (Guide/Adventurous, pre-itinerary) → 6 Local (legs between the
ACTUAL selected places+stay) → 7 Budget+food (Basic/Standard/Premium) →
8 Itinerary (single generation from saved state) → 9 Review (source of
truth, edit jumps) → 10 Payment (verify → activate, idempotent).

Stage completion is DERIVED from saved data (`stage_service.stage_completion`);
`trips.current_stage` is only the resume pointer. Forward `PUT /stage`
validates prerequisites + the budget gate (422 + violations, selections kept).

## Settled rules (spec §12 decisions)

- Fee basis: B = transport+stay+food+activities+local. G=12.5%·B (Guide only),
  P=3%·B, R=15%·B, I=₹50. Final = B+G+P+R+I (same formula as pricing_service).
- Budget envelope: `trips.budget` caps B (travel spend); fees/reserve stack on
  top. Gate blocks Continue while B > budget; top-ups (2500/5000/7500/10000/
  custom) return to the SAME stage with selections intact.
- Reserve: protected, displayed separately — never spendable, never hidden.
- Stay: rooms = ceil(party/2), cost = per-night-rate × rooms × nights.
  `price_per_night` now survives selections sync (was stripped by the schema).
- Food tiers: Basic ₹500 / Standard ₹800 / Premium ₹1,200 per-person/day;
  allowance = rate × travellers × days. Tiers change ONLY food.
- Transport sources: verified catalog first (labelled Verified/AVAILABLE);
  otherwise transparent estimate bands (UNCONFIRMED_ESTIMATE). LLM candidates
  accepted only with numeric fares; availability never claimed without source.
- Cabs are per-VEHICLE (vehicles = ceil(party/4)). No metro outside metro
  cities, no MMTS outside Hyderabad.
- Itinerary consumes saved state: ledger→profile mirror on every sync;
  `/plan` prices the SELECTED stage-3 fares and reprices authoritatively.
  Day-1 departure leads (departure-first invariant, enforced + repaired).
- Weather: OpenWeather within ~5-day horizon (labelled live); beyond it,
  seasonal-typical labels — never confirmed forecasts; cached on the trip.
- Edits: transport change → revalidate itinerary + costs; stay change →
  local legs re-planned (unchanged-leg picks preserved); mode switch →
  reprice only, never regen. Every itinerary edit recalculates server-side.
- Payment: webhook is idempotent (settled orders return settled state, no
  re-activation/duplicates). Activation only after verified signature.
- Guide Mode honesty: `guide.available` reflects real ACTIVE guides for the
  destination; assignment is flagged REQUESTED, never promised upfront.

## Key backend surface

`GET/PUT /trips/{id}/stage`, `POST /trips/{id}/transport/options|/select`,
`POST /trips/{id}/local-transport/plan|/select`, `PUT /trips/{id}/food-tier`,
`GET /trips/{id}/budget/gate`, `GET /trips/{id}/weather`,
`GET /trips/{id}/review` (payment_amount == pricing.final_amount).
Services: `stage_service` (state+gate), `stage_transport` (options+legs).
Tests: `tests/test_ten_stage_workflow.py` (15 tests, incl. the §4A
₹1,000×10 example scale and the Final=B+G+P+R+I identity).
