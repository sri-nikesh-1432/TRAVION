import React, { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  ArrowRight, Loader2, ShieldCheck, Utensils, Wallet, BadgeCheck,
} from 'lucide-react';
import type { BudgetGate, FoodTier, StageState } from '../../types';
import { api, ApiError } from '../../services/api';
import { BudgetGateAlert } from './BudgetGateAlert';

const inr = (n: number | null | undefined) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

// Fee display formula (backend-authoritative numbers, client only renders):
//   Final = B + G + P + R + ₹50
// where B = base spend total, G = guide fee, P = platform fee,
// R = safety reserve (PROTECTED — never spent automatically),
// ₹50 = fixed insurance (TRAVION Refund Protection).

const TIER_RATES: Record<FoodTier, { rate: number; label: string; blurb: string }> = {
  BASIC: { rate: 500, label: 'Basic', blurb: 'Simple, filling local meals' },
  STANDARD: { rate: 800, label: 'Standard', blurb: 'Comfortable curated dining' },
  PREMIUM: { rate: 1200, label: 'Premium', blurb: 'Top-rated restaurants & cafés' },
};

interface BudgetFoodPlanProps {
  tripId: string;
  initialGate?: BudgetGate | null;
  travellers?: number | null;
  days?: number | null;
  onComplete: (stage: StageState) => void;
  onBack: () => void;
}

/**
 * Stage 7 — Budget + food. Full spend/fee breakdown from the gate, three food
 * tiers (switching calls setFoodTier and changes NOTHING else), BudgetAlert on
 * can_continue=false with top-up recovery that STAYS on this stage.
 */
export const BudgetFoodPlan: React.FC<BudgetFoodPlanProps> = ({
  tripId, initialGate, travellers, days, onComplete, onBack,
}) => {
  const [gate, setGate] = useState<BudgetGate | null>(initialGate || null);
  const [loading, setLoading] = useState(!initialGate);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<FoodTier | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [showGateAlert, setShowGateAlert] = useState(false);
  const [gateViolations, setGateViolations] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const g = await api.getBudgetGate(tripId);
      setGate(g);
    } catch (err: any) {
      setLoadError(err?.message || 'Budget details could not be loaded. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialGate) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const switchTier = async (tier: FoodTier) => {
    if (!gate || gate.food_tier === tier || switching) return;
    setSwitching(tier);
    try {
      // Switching tier updates the food allowance and the gate — NOTHING else.
      const res = await api.setFoodTier(tripId, tier);
      setGate(res.gate);
    } catch {
      // Tier switch failed — keep the current gate untouched.
    } finally {
      setSwitching(null);
    }
  };

  const handleContinue = async () => {
    if (!gate || continuing) return;
    if (!gate.can_continue) {
      setGateViolations(gate.violations || []);
      setShowGateAlert(true);
      return;
    }
    setContinuing(true);
    try {
      const stage = await api.setStage(tripId, 8);
      onComplete(stage);
    } catch (err: any) {
      const status = (err as ApiError)?.status;
      if (status === 404) {
        onComplete({} as StageState);
        return;
      }
      const extra = (err as ApiError)?.extra;
      const violations: string[] | undefined =
        extra?.violations || extra?.gate?.violations || extra?.detail?.violations;
      setGateViolations(violations && violations.length > 0 ? violations : [err?.message || 'Could not continue yet.']);
      setShowGateAlert(true);
    } finally {
      setContinuing(false);
    }
  };

  const party = Math.max(1, Number(travellers) || 1);
  const tripDays = Math.max(1, Number(days) || 1);

  const SpendRow: React.FC<{ label: string; value: number; strong?: boolean }> = ({ label, value, strong }) => (
    <div className="flex justify-between py-1.5 border-b border-charcoal-100 text-[13px]">
      <span className="font-semibold text-charcoal-600">{label}</span>
      <span className={`font-bold tabular-nums ${strong ? 'text-charcoal-900' : 'text-charcoal-800'}`}>{inr(value)}</span>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 7 · Budget & food</span>
        <h2 className="mt-2 text-2xl font-extrabold text-charcoal-900 tracking-tight">Your money, fully itemized</h2>
        <p className="mt-1.5 text-[13px] font-medium text-charcoal-500">
          Every number below comes from your trip's live budget gate — nothing estimated here.
        </p>
      </div>

      {loading ? (
        <div className="py-14 text-center">
          <Loader2 className="w-6 h-6 text-travion-500 animate-spin mx-auto mb-3" />
          <p className="text-[13px] font-bold text-charcoal-500">Loading your budget breakdown…</p>
        </div>
      ) : loadError || !gate ? (
        <div className="max-w-md mx-auto rounded-2xl bg-red-50 border border-red-100 px-4 py-4 text-center">
          <p className="text-[13px] font-bold text-red-600">{loadError || 'Budget details unavailable.'}</p>
          <button type="button" onClick={() => void load()} className="mt-3 px-5 h-10 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-[12px] font-extrabold">
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Food tiers */}
          <section className="rounded-3xl border border-charcoal-200/80 bg-white shadow-soft p-4 md:p-5">
            <h3 className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wider text-charcoal-500 mb-3">
              <Utensils className="w-4 h-4 text-travion-600" /> Food plan — per-person, per-day
            </h3>
            <div className="grid sm:grid-cols-3 gap-2.5">
              {(Object.keys(TIER_RATES) as FoodTier[]).map((tier) => {
                const meta = TIER_RATES[tier];
                const active = gate.food_tier === tier;
                const allowance = meta.rate * party * tripDays;
                const busy = switching === tier;
                return (
                  <button
                    key={tier}
                    type="button"
                    disabled={busy || active}
                    onClick={() => void switchTier(tier)}
                    className={`text-left p-4 rounded-2xl border-2 transition-all disabled:cursor-default ${
                      active ? 'bg-travion-50 border-travion-500 ring-2 ring-travion-100' : 'bg-white border-charcoal-200 hover:border-travion-300'
                    }`}
                  >
                    <span className="flex items-center justify-between">
                      <span className="text-[14px] font-black text-charcoal-900">{meta.label}</span>
                      {active && <BadgeCheck className="w-4 h-4 text-travion-600" />}
                      {busy && <Loader2 className="w-4 h-4 text-travion-600 animate-spin" />}
                    </span>
                    <span className="block mt-0.5 text-[11px] font-bold text-charcoal-400">{inr(meta.rate)} / person / day</span>
                    <span className="block mt-1 text-[11.5px] font-medium text-charcoal-500">{meta.blurb}</span>
                    <span className="block mt-2 text-[13px] font-extrabold text-travion-700">
                      {inr(allowance)} <span className="text-[10.5px] font-bold text-charcoal-400">for {party} traveller{party === 1 ? '' : 's'} × {tripDays} day{tripDays === 1 ? '' : 's'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 text-[11.5px] font-semibold text-charcoal-400">
              Current allowance in your total: <span className="text-charcoal-700 font-bold">{inr(gate.food_allowance)}</span>
              {' '}— switching tiers reprices food only; transport, stay, activities and fees stay exactly as they are.
            </p>
          </section>

          {/* Full breakdown */}
          <section className="mt-4 rounded-3xl border border-charcoal-200/80 bg-white shadow-soft p-4 md:p-5">
            <h3 className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wider text-charcoal-500 mb-2">
              <Wallet className="w-4 h-4 text-travion-600" /> Full breakdown
            </h3>
            <SpendRow label="Transport (round trip)" value={gate.spend?.transport} />
            <SpendRow label="Stay" value={gate.spend?.stay} />
            <SpendRow label="Food allowance" value={gate.spend?.food} />
            <SpendRow label="Activities" value={gate.spend?.activities} />
            <SpendRow label="Local transport" value={gate.spend?.local_transport} />
            <div className="flex justify-between py-1.5 text-[13px]">
              <span className="font-bold text-charcoal-700">Base trip total (B)</span>
              <span className="font-black text-charcoal-900 tabular-nums">{inr(gate.spend?.base_total)}</span>
            </div>
            <div className="mt-3 rounded-2xl bg-travion-50/70 border border-travion-100 px-4 py-3">
              <SpendRow label="Guide fee (G)" value={gate.fees?.guide} />
              <SpendRow label="Platform fee (P)" value={gate.fees?.platform} />
              <div className="flex justify-between py-1.5 border-b border-charcoal-100 text-[13px]">
                <span className="font-semibold text-charcoal-600">Safety reserve (R) — <span className="text-emerald-700 font-bold">PROTECTED</span></span>
                <span className="font-bold text-charcoal-800 tabular-nums">{inr(gate.fees?.safety_reserve)}</span>
              </div>
              <p className="text-[10.5px] font-medium text-charcoal-400 py-1">Reserved for unexpected travel or emergency needs — never spent automatically.</p>
              <SpendRow label="Insurance (fixed ₹50)" value={gate.fees?.insurance} />
              <div className="flex justify-between pt-2 text-[15px]">
                <span className="font-black text-charcoal-900">Final amount</span>
                <span className="font-black text-travion-700 tabular-nums">{inr(gate.final_amount)}</span>
              </div>
              <p className="mt-1 text-[10.5px] font-medium text-charcoal-400">Final = B + G + P + R + ₹50</p>
            </div>
            <div className="mt-3 flex items-center justify-between text-[13px]">
              <span className="font-bold text-charcoal-500">Budget ceiling</span>
              <span className="font-bold text-charcoal-700 tabular-nums">{inr(gate.budget_max)}</span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-bold text-charcoal-500">Remaining</span>
              <span className={`font-black tabular-nums ${gate.remaining_budget >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{inr(gate.remaining_budget)}</span>
            </div>
            {gate.pricing_unit_notes && gate.pricing_unit_notes.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {gate.pricing_unit_notes.map((n, i) => (
                  <li key={i} className="text-[10.5px] font-medium text-charcoal-400">· {n}</li>
                ))}
              </ul>
            )}
            {!gate.can_continue && (
              <div className="mt-3 rounded-2xl bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-[12.5px] font-extrabold text-red-700">Over budget — resolve below to continue.</p>
                {gate.violations.slice(0, 2).map((v, i) => (
                  <p key={i} className="text-[12px] font-medium text-red-600 mt-0.5">· {v}</p>
                ))}
                <button
                  type="button"
                  onClick={() => { setGateViolations(gate.violations || []); setShowGateAlert(true); }}
                  className="mt-2 h-10 px-5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[12px] font-extrabold"
                >
                  Fix budget
                </button>
              </div>
            )}
          </section>

          {/* Adjustments history */}
          {gate.adjustments && gate.adjustments.length > 0 && (
            <section className="mt-4 rounded-3xl border border-charcoal-200/80 bg-white shadow-soft p-4 md:p-5">
              <h3 className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wider text-charcoal-500 mb-2">
                <ShieldCheck className="w-4 h-4 text-travion-600" /> Budget adjustments
              </h3>
              <ul className="space-y-1.5">
                {gate.adjustments.map((a: any, i: number) => (
                  <li key={a.id || i} className="flex justify-between text-[12.5px] font-semibold text-charcoal-600">
                    <span>{a.reason || `Top-up · ${a.stage || ''}`}</span>
                    <span className="font-bold text-charcoal-800">+{inr(a.adjustment_amount ?? a.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 rounded-3xl bg-white border border-charcoal-200 shadow-floating px-5 py-4">
            <button type="button" onClick={onBack} className="text-[13px] font-bold text-charcoal-500 hover:text-charcoal-700">
              Back
            </button>
            <button
              type="button"
              onClick={() => void handleContinue()}
              disabled={continuing}
              className="inline-flex items-center gap-2 h-12 px-7 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:opacity-60 text-white text-sm font-extrabold transition-colors"
            >
              {continuing ? 'Building itinerary…' : gate.can_continue ? 'Continue — build my itinerary' : 'Review budget'}
              {!continuing && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </>
      )}

      <AnimatePresence>
        {showGateAlert && gate && (
          <BudgetGateAlert
            tripId={tripId}
            violations={gateViolations.length > 0 ? gateViolations : gate.violations}
            hints={[
              'Switch to the Basic food tier to lower the food allowance',
              'Deselect a paid place or choose the free alternative',
              'Add to your trip budget below — you stay on this screen',
            ]}
            stage="budget_food"
            remainingBudget={gate.remaining_budget}
            onTopupComplete={() => void load()}
            onClose={() => setShowGateAlert(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
