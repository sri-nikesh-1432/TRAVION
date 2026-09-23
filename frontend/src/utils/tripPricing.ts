// TRAVION centralized pricing engine (frontend mirror of
// backend/app/services/pricing_service.py — spec §26: ONE source of truth).
//
// Rules (identical to the backend, server remains authoritative):
//   platform_fee   = base × 3%    (ALWAYS)
//   guide_fee      = base × 12.5% (GUIDE_MODE only)
//   safety_reserve = base × 15%   (ALWAYS, reserved funds — never a hidden spend)
//   insurance_fee  = ₹50 fixed    (ALWAYS — TRAVION Refund Protection)
//   final_planned_amount = base + guide + platform + safety + insurance
//
// Fees stack ON TOP of the base travel budget in EVERY mode (spec §23-26).
// No surface may show platform fee ₹0 unless the base is genuinely ₹0.
// Razorpay orders and the Review page MUST both read from this object.
//
// TRAVION Refund Protection: if a trip is cancelled or cannot be fulfilled
// due to an issue attributable to TRAVION, the ₹50 Insurance Fee + the 3%
// Platform Fee are refunded (traveller-initiated cancellations and events
// outside TRAVION's responsibility are not covered).

export const PLATFORM_FEE_RATE = 0.03;
export const GUIDE_FEE_RATE = 0.125;
export const SAFETY_RESERVE_RATE = 0.15;
export const INSURANCE_FEE = 50;

export type TripMode = 'GUIDE_MODE' | 'ADVENTUROUS_MODE';

export interface TripPricing {
  baseBudget: number;
  guideFee: number;
  platformFee: number;
  safetyReserve: number;
  insuranceFee: number;
  finalPlannedAmount: number;
  travionCausedRefund: number;
  mode: TripMode;
  rates: { guide: number; platform: number; safety: number; insurance: number };
}

export function calculateTripBudget(
  baseBudget: number | null | undefined,
  mode: TripMode | string | null | undefined,
): TripPricing {
  const base = Math.max(0, Math.round(Number(baseBudget) || 0));
  const isGuide = String(mode || '') === 'GUIDE_MODE';
  const guideFee = isGuide ? Math.round(base * GUIDE_FEE_RATE) : 0;
  const platformFee = Math.round(base * PLATFORM_FEE_RATE);
  const safetyReserve = Math.round(base * SAFETY_RESERVE_RATE);
  const insuranceFee = INSURANCE_FEE;
  const finalPlannedAmount = base + guideFee + platformFee + safetyReserve + insuranceFee;
  return {
    baseBudget: base,
    guideFee,
    platformFee,
    safetyReserve,
    insuranceFee,
    finalPlannedAmount,
    travionCausedRefund: platformFee + insuranceFee,
    mode: isGuide ? 'GUIDE_MODE' : 'ADVENTUROUS_MODE',
    rates: { guide: isGuide ? GUIDE_FEE_RATE : 0, platform: PLATFORM_FEE_RATE, safety: SAFETY_RESERVE_RATE, insurance: INSURANCE_FEE },
  };
}

/** Format a pricing object as human-readable breakdown rows for Review/checkout UIs. */
export function pricingRows(p: TripPricing): Array<{ label: string; value: number; note?: string; tone?: 'guide' | 'platform' | 'safety' | 'insurance' | 'total' }> {
  const rows: Array<{ label: string; value: number; note?: string; tone?: 'guide' | 'platform' | 'safety' | 'insurance' | 'total' }> = [
    { label: 'Base trip budget', value: p.baseBudget },
  ];
  if (p.mode === 'GUIDE_MODE') {
    rows.push({ label: 'Guide fee', value: p.guideFee, note: '12.5% — verified local guide', tone: 'guide' });
  } else {
    rows.push({ label: 'Guide fee', value: 0, note: '₹0 — Adventurous Mode', tone: 'guide' });
  }
  rows.push({ label: 'Platform fee', value: p.platformFee, note: '3% — always applied', tone: 'platform' });
  rows.push({
    label: 'Safety reserve',
    value: p.safetyReserve,
    note: '15% — reserved for unexpected travel or emergency needs',
    tone: 'safety',
  });
  rows.push({
    label: 'Insurance',
    value: p.insuranceFee,
    note: '₹50 fixed — TRAVION Refund Protection',
    tone: 'insurance',
  });
  rows.push({ label: 'Final planned amount', value: p.finalPlannedAmount, tone: 'total' });
  return rows;
}

export const TRAVION_REFUND_POLICY = (
  'TRAVION Refund Protection — a fixed ₹50 Insurance Fee is included in every '
  + 'trip booking. If a trip is cancelled or cannot be fulfilled due to an issue '
  + 'attributable to TRAVION, TRAVION refunds the ₹50 Insurance Fee and the 3% '
  + 'Platform Fee paid by the user. This protection applies specifically to '
  + 'TRAVION-caused cancellation/non-fulfilment and does not automatically apply '
  + 'to cancellations initiated by the user or circumstances outside TRAVION\'s '
  + 'responsibility.'
);

export const formatINR = (n: number | null | undefined): string =>
  `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
