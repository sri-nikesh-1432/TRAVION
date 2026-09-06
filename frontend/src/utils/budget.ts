// Budget sanity helpers shared across the traveller UI.
//
// A usable travel budget is a real, positive, finite amount a reasonable
// traveller would put on a single trip (< ₹1,000,000). Without this guard the
// UI can render absurd values like "₹99,99,XX left" from ancient default rows
// or the old concatenated-budget-string bug ("₹10,000 - ₹25,000" → a crore+).

export const MAX_SANE_BUDGET = 1_000_000;

export const isSaneBudget = (n: number | null | undefined): boolean =>
  n != null && Number.isFinite(Number(n)) && Number(n) > 0 && Number(n) < MAX_SANE_BUDGET;

export function saneBudget(n: number | undefined | null): number | undefined {
  return isSaneBudget(n) ? Number(n) : undefined;
}

/** Pick the first sane budget ceiling among the known sources. */
export function resolveBudgetMax(
  breakdownBudget?: number | null,
  tripBudget?: number | null,
  totalCost?: number | null,
): number {
  return (
    saneBudget(breakdownBudget) ??
    saneBudget(tripBudget) ??
    saneBudget(totalCost) ??
    15000
  );
}