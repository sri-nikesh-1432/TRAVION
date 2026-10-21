import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, Loader2, ShieldCheck, Utensils, Wallet, BadgeCheck,
  Check, Sparkles, ChevronDown, ChevronUp, AlertTriangle, Shield,
  Car, Building2, Ticket, MapPin,
} from 'lucide-react';
import type { BudgetCard, BudgetGate, FoodTier, StageState } from '../../types';
import { api, ApiError } from '../../services/api';
import { BudgetGateAlert } from './BudgetGateAlert';

const inr = (n: number | null | undefined) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

interface BudgetFoodPlanProps {
  tripId: string;
  destinationName?: string;
  initialGate?: BudgetGate | null;
  travellers?: number | null;
  days?: number | null;
  onComplete: (stage: StageState) => void;
  onBack: () => void;
}

const TIER_META: Record<FoodTier, { rate: number; label: string; planCode: string; badge: string; tagline: string; description: string; recommended: boolean }> = {
  BASIC: {
    rate: 500,
    label: 'Budget',
    planCode: 'PLAN A',
    badge: '⚡ Maximum savings',
    tagline: 'Maximum experience with minimum unnecessary spending.',
    description: 'Authentic local dining, street food discoveries, and clean reliable comfort while protecting your budget.',
    recommended: false,
  },
  STANDARD: {
    rate: 800,
    label: 'Recommended',
    planCode: 'PLAN B',
    badge: '✦ Best balance',
    tagline: 'Best balance of comfort, experiences and budget.',
    description: 'Curated local favorites, comfortable dining, verified stays, and smooth transfers tailored to your group.',
    recommended: true,
  },
  PREMIUM: {
    rate: 1200,
    label: 'Premium',
    planCode: 'PLAN C',
    badge: '★ Premium experiences',
    tagline: 'Maximum comfort while staying inside your budget.',
    description: 'Top-rated restaurants, iconic rooftop dining, upgraded flexibility, and premium comfort throughout.',
    recommended: false,
  },
};

export const BudgetFoodPlan: React.FC<BudgetFoodPlanProps> = ({
  tripId,
  destinationName,
  initialGate,
  travellers,
  days,
  onComplete,
  onBack,
}) => {
  const [gate, setGate] = useState<BudgetGate | null>(initialGate || null);
  const [loading, setLoading] = useState(!initialGate);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<FoodTier | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [showGateAlert, setShowGateAlert] = useState(false);
  const [gateViolations, setGateViolations] = useState<string[]>([]);
  const [showFullBreakdown, setShowFullBreakdown] = useState(false);

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
      const res = await api.setFoodTier(tripId, tier);
      setGate(res.gate);
    } catch {
      // Tier switch failed — keep current gate untouched
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

  // Compute or format the three budget cards
  const cards: BudgetCard[] = (() => {
    if (gate?.budget_cards && gate.budget_cards.length >= 3) {
      return gate.budget_cards;
    }
    if (gate?.cards && gate.cards.length >= 3) {
      return gate.cards;
    }

    // Client fallback computed strictly from live gate spend & fees
    const transportVal = Number(gate?.spend?.transport || 0);
    const stayVal = Number(gate?.spend?.stay || 0);
    const actVal = Number(gate?.spend?.activities || 0);
    const localVal = Number(gate?.spend?.local_transport || 0);
    const bMax = Number(gate?.budget_max || 50000);
    const hasGuide = (gate?.fees?.guide || 0) > 0;

    return (['BASIC', 'STANDARD', 'PREMIUM'] as FoodTier[]).map((tierKey) => {
      const meta = TIER_META[tierKey];
      const cFood = Math.round(meta.rate * party * tripDays);
      const cBase = Math.round(transportVal + stayVal + cFood + actVal + localVal);
      const cGuide = hasGuide ? Math.round(cBase * 0.125) : 0;
      const cPlatform = Math.round(cBase * 0.03);
      const cSafety = Math.round(cBase * 0.15);
      const cIns = 50;
      const cFinal = Math.round(cBase + cGuide + cPlatform + cSafety + cIns);
      const cRemaining = Math.round(bMax - cBase);
      const cWithin = cBase <= bMax + 0.01;
      const cPerPerson = Math.round(cFinal / party);

      return {
        type: (tierKey === 'BASIC' ? 'VALUE' : tierKey === 'STANDARD' ? 'RECOMMENDED' : 'PREMIUM') as 'VALUE' | 'RECOMMENDED' | 'PREMIUM',
        plan_code: meta.planCode,
        label: meta.label,
        tagline: meta.tagline,
        badge: meta.badge,
        description: meta.description,
        food_tier: tierKey,
        food_rate: meta.rate,
        food_allowance: cFood,
        recommended: meta.recommended,
        base_plan_cost: cBase,
        travel_spend: cBase,
        guide_fee: cGuide,
        platform_fee: cPlatform,
        safety_reserve: cSafety,
        insurance_fee: cIns,
        final_total: cFinal,
        total_cost: cFinal,
        amount_payable: cFinal,
        per_person: cPerPerson,
        budget_max: bMax,
        remaining_budget: cRemaining,
        within_budget: cWithin,
        highlights: [
          `🍴 ${meta.label} dining (${inr(meta.rate)}/person/day)`,
          meta.badge,
        ],
        spend: {
          transport: transportVal,
          stay: stayVal,
          food: cFood,
          activities: actVal,
          local_transport: localVal,
          base_total: cBase,
        },
        cost_breakdown: {},
      };
    });
  })();

  const activeTier = gate?.food_tier || 'STANDARD';
  const activeCard = cards.find((c) => c.food_tier === activeTier) || cards[1] || cards[0];

  const SpendRow: React.FC<{ label: string; value: number | null | undefined; strong?: boolean }> = ({ label, value, strong }) => (
    <div className="flex justify-between py-1.5 border-b border-charcoal-100 text-[13px]">
      <span className="font-semibold text-charcoal-600">{label}</span>
      <span className={`font-bold tabular-nums ${strong ? 'text-charcoal-900' : 'text-charcoal-800'}`}>{inr(value)}</span>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-travion-50 border border-travion-200 text-xs font-black uppercase tracking-wider text-travion-700">
          <Sparkles className="w-3 h-3 text-travion-600" />
          Step 8 · Budget planning
        </span>
        <h2 className="mt-3 text-2xl sm:text-3xl font-extrabold text-charcoal-900 tracking-tight">
          Three ways to experience {destinationName ? destinationName : 'your trip'}
        </h2>
        <p className="mt-2 text-sm font-medium text-charcoal-500 max-w-2xl mx-auto">
          Every plan uses your verified transport, stay, activities, and local transfers. Select a plan to tailor your food allowance and comfort level before we generate your itinerary.
        </p>
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <Loader2 className="w-8 h-8 text-travion-500 animate-spin mx-auto mb-3" />
          <p className="text-sm font-bold text-charcoal-600">Calculating your 3 budget plans…</p>
          <p className="text-xs text-charcoal-400 mt-1">Grounding fares, stay rates, and allowances</p>
        </div>
      ) : loadError || !gate ? (
        <div className="max-w-md mx-auto rounded-3xl bg-red-50 border border-red-100 p-6 text-center">
          <p className="text-sm font-bold text-red-600">{loadError || 'Budget details unavailable.'}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 px-6 h-11 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-xs font-black transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* 3 Budget Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
            {cards.map((card, idx) => {
              const isSelected = activeTier === card.food_tier;
              const isBusy = switching === card.food_tier;
              const bMax = card.budget_max || gate.budget_max || 50000;
              const baseCost = card.base_plan_cost || card.travel_spend || 0;
              const usedPct = Math.max(5, Math.min(100, (baseCost / bMax) * 100));
              const isOverBudget = !card.within_budget || card.remaining_budget < 0;

              return (
                <motion.div
                  key={card.food_tier}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.08 }}
                  onClick={() => void switchTier(card.food_tier)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void switchTier(card.food_tier);
                    }
                  }}
                  className={`relative flex flex-col justify-between text-left p-6 rounded-3xl border-2 transition-all cursor-pointer select-none bg-white ${
                    isSelected
                      ? 'border-travion-600 ring-4 ring-travion-100 shadow-md scale-[1.01]'
                      : 'border-charcoal-200/90 hover:border-travion-300 hover:shadow-soft'
                  }`}
                >
                  {/* Recommended Ribbon */}
                  {card.recommended && (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-gradient-to-r from-travion-600 to-travion-700 text-white text-[10px] font-black uppercase tracking-widest shadow-md z-10 whitespace-nowrap">
                      <Sparkles className="w-3 h-3 text-gold-300" /> Recommended for you
                    </span>
                  )}

                  <div>
                    {/* Plan Code & Badge & Select Indicator */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">
                          {card.plan_code}
                        </span>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-sand-100 text-charcoal-700">
                          {card.badge}
                        </span>
                      </div>
                      <span
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          isSelected
                            ? 'bg-travion-600 border-travion-600 text-white shadow-sm'
                            : 'border-charcoal-300 bg-white'
                        }`}
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isSelected ? (
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        ) : null}
                      </span>
                    </div>

                    {/* Plan Name & Tagline */}
                    <div className="mt-3">
                      <h3 className="text-xl font-extrabold text-charcoal-900 tracking-tight">
                        {card.label}
                      </h3>
                      <p className="mt-1 text-xs font-semibold text-travion-800 leading-snug">
                        {card.tagline}
                      </p>
                      <p className="mt-1.5 text-[11.5px] font-medium text-charcoal-500 leading-relaxed">
                        {card.description}
                      </p>
                    </div>

                    {/* Final Planned Amount & Per-Person */}
                    <div className="mt-5 p-3.5 rounded-2xl bg-charcoal-50/70 border border-charcoal-100">
                      <div className="flex items-baseline justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-charcoal-400 block">
                            Final planned total
                          </span>
                          <span className="text-2xl font-black text-charcoal-900 tabular-nums">
                            {inr(card.final_total)}
                          </span>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${
                            card.within_budget
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {card.within_budget ? '✓ Within budget' : '⚠ Over budget'}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] font-bold text-charcoal-500">
                        <span>{inr(card.per_person)} / traveller</span>
                        <span>{party} traveller{party === 1 ? '' : 's'} · {tripDays}d</span>
                      </div>
                    </div>

                    {/* Budget Ceiling & Progress Bar */}
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span className="text-charcoal-400">Budget status</span>
                        <span
                          className={`tabular-nums ${
                            card.remaining_budget >= 0 ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {card.remaining_budget >= 0
                            ? `${inr(card.remaining_budget)} remaining`
                            : `${inr(Math.abs(card.remaining_budget))} over budget`}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 rounded-full bg-sand-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isOverBudget ? 'bg-red-500' : 'bg-travion-600'
                          }`}
                          style={{ width: `${usedPct}%` }}
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] font-semibold text-charcoal-400">
                        <span>Base spend: {inr(baseCost)}</span>
                        <span>Ceiling: {inr(bMax)}</span>
                      </div>
                    </div>

                    {/* Cost Components Inside Card */}
                    <div className="mt-4 pt-4 border-t border-charcoal-100 space-y-1.5 text-[11.5px] font-semibold text-charcoal-600">
                      <div className="flex justify-between">
                        <span className="flex items-center gap-1.5 text-charcoal-500">
                          <Car className="w-3.5 h-3.5 text-travion-500" /> Transport
                        </span>
                        <span className="font-bold text-charcoal-800">{inr(card.spend?.transport)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="flex items-center gap-1.5 text-charcoal-500">
                          <Building2 className="w-3.5 h-3.5 text-travion-500" /> Stay
                        </span>
                        <span className="font-bold text-charcoal-800">{inr(card.spend?.stay)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="flex items-center gap-1.5 text-charcoal-500">
                          <Utensils className="w-3.5 h-3.5 text-travion-500" /> Dining allowance
                        </span>
                        <span className="font-bold text-travion-800">
                          {inr(card.food_allowance)}{' '}
                          <span className="text-[10px] font-medium text-charcoal-400">
                            ({inr(card.food_rate)}/d)
                          </span>
                        </span>
                      </div>
                      {(card.spend?.activities || 0) > 0 && (
                        <div className="flex justify-between">
                          <span className="flex items-center gap-1.5 text-charcoal-500">
                            <Ticket className="w-3.5 h-3.5 text-travion-500" /> Sightseeing & activities
                          </span>
                          <span className="font-bold text-charcoal-800">{inr(card.spend?.activities)}</span>
                        </div>
                      )}
                      {(card.spend?.local_transport || 0) > 0 && (
                        <div className="flex justify-between">
                          <span className="flex items-center gap-1.5 text-charcoal-500">
                            <MapPin className="w-3.5 h-3.5 text-travion-500" /> Local transport
                          </span>
                          <span className="font-bold text-charcoal-800">{inr(card.spend?.local_transport)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-charcoal-100 pt-1 font-bold text-charcoal-700 text-[12px]">
                        <span>Base plan spend (B)</span>
                        <span className="font-black text-charcoal-900">{inr(baseCost)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-charcoal-400">
                        <span>Platform fee (3%)</span>
                        <span className="font-semibold text-charcoal-600">{inr(card.platform_fee)}</span>
                      </div>
                      {card.guide_fee > 0 && (
                        <div className="flex justify-between text-[11px] text-cognac-600 font-bold">
                          <span>Guide fee (12.5%)</span>
                          <span>{inr(card.guide_fee)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-[11px] text-emerald-700 font-bold">
                        <span>Safety reserve (15% protected)</span>
                        <span>{inr(card.safety_reserve)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-charcoal-400">
                        <span>Insurance fee (fixed)</span>
                        <span className="font-semibold text-charcoal-600">{inr(card.insurance_fee)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Card Select Button */}
                  <div className="mt-5 pt-3 border-t border-charcoal-100">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        void switchTier(card.food_tier);
                      }}
                      className={`w-full h-11 rounded-2xl flex items-center justify-center gap-2 text-xs font-black transition-all ${
                        isSelected
                          ? 'bg-travion-600 text-white shadow-sm hover:bg-travion-700'
                          : 'bg-sand-100 text-charcoal-700 hover:bg-travion-50 hover:text-travion-700'
                      }`}
                    >
                      {isBusy ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Updating plan…</span>
                        </>
                      ) : isSelected ? (
                        <>
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                          <span>Selected {card.label} Plan</span>
                        </>
                      ) : (
                        <span>Choose {card.label} Plan</span>
                      )}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Detailed itemized breakdown accordion */}
          <div className="rounded-3xl border border-charcoal-200/80 bg-white shadow-soft overflow-hidden mb-6">
            <button
              type="button"
              onClick={() => setShowFullBreakdown((prev) => !prev)}
              className="w-full flex items-center justify-between p-5 text-left hover:bg-charcoal-50/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-travion-50 flex items-center justify-center text-travion-600">
                  <Wallet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-charcoal-900">
                    Transparent Itemized Breakdown · {activeCard.label} Plan
                  </h3>
                  <p className="text-xs font-medium text-charcoal-400">
                    Formula: Final = Base (B) + Guide (G) + Platform (P) + Reserve (R) + Insurance (₹50)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-travion-700 tabular-nums">
                  {inr(gate.final_amount)}
                </span>
                {showFullBreakdown ? (
                  <ChevronUp className="w-5 h-5 text-charcoal-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-charcoal-400" />
                )}
              </div>
            </button>

            {showFullBreakdown && (
              <div className="px-5 pb-5 pt-2 border-t border-charcoal-100">
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Spend column */}
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-charcoal-400 mb-2">
                      Base Travel Spend (B)
                    </h4>
                    <SpendRow label="Round-trip transport" value={gate.spend?.transport} />
                    <SpendRow label="Accommodation (stay)" value={gate.spend?.stay} />
                    <SpendRow label={`Food allowance (${activeTier} · ${party} travellers × ${tripDays}d)`} value={gate.spend?.food} />
                    <SpendRow label="Attractions & sightseeing" value={gate.spend?.activities} />
                    <SpendRow label="Local transport" value={gate.spend?.local_transport} />
                    <div className="flex justify-between py-2 text-[13px] font-black text-charcoal-900">
                      <span>Total Base Spend (B)</span>
                      <span className="tabular-nums">{inr(gate.spend?.base_total)}</span>
                    </div>
                  </div>

                  {/* Fees column */}
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-charcoal-400 mb-2">
                      Platform, Guide & Protections
                    </h4>
                    <SpendRow label="Guide fee (12.5% — Guide Mode only)" value={gate.fees?.guide} />
                    <SpendRow label="Platform fee (3%)" value={gate.fees?.platform} />
                    <div className="flex justify-between py-1.5 border-b border-charcoal-100 text-[13px]">
                      <span className="font-semibold text-charcoal-600">
                        Safety reserve (15%) — <span className="text-emerald-700 font-bold">PROTECTED</span>
                      </span>
                      <span className="font-bold text-charcoal-800 tabular-nums">{inr(gate.fees?.safety_reserve)}</span>
                    </div>
                    <p className="text-[10.5px] font-medium text-charcoal-400 py-1">
                      Set aside for unforeseen trip adjustments or emergency needs — never spent automatically.
                    </p>
                    <SpendRow label="Insurance (fixed ₹50 — Travion Refund Protection)" value={gate.fees?.insurance} />
                    <div className="flex justify-between pt-2.5 text-base font-black text-charcoal-900">
                      <span>Final Planned Total</span>
                      <span className="text-travion-700 tabular-nums">{inr(gate.final_amount)}</span>
                    </div>
                  </div>
                </div>

                {gate.pricing_unit_notes && gate.pricing_unit_notes.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-charcoal-100">
                    <ul className="space-y-1">
                      {gate.pricing_unit_notes.map((note, idx) => (
                        <li key={idx} className="text-[11px] font-medium text-charcoal-500">
                          · {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Over-budget violation alert if can_continue is false */}
          {!gate.can_continue && (
            <div className="mb-6 rounded-3xl bg-red-50 border border-red-200 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-red-800 font-extrabold text-sm">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>Your selected plan exceeds your travel budget</span>
                </div>
                {gate.violations && gate.violations.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs font-semibold text-red-700">
                    {gate.violations.map((v, i) => (
                      <li key={i}>· {v}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setGateViolations(gate.violations || []);
                  setShowGateAlert(true);
                }}
                className="shrink-0 h-10 px-5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black shadow-sm transition-colors"
              >
                Top-up budget
              </button>
            </div>
          )}

          {/* Budget adjustments history */}
          {gate.adjustments && gate.adjustments.length > 0 && (
            <div className="mb-6 rounded-3xl border border-charcoal-200/80 bg-white p-5 shadow-soft">
              <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-charcoal-500 mb-2">
                <ShieldCheck className="w-4 h-4 text-travion-600" /> Budget adjustments
              </h4>
              <ul className="space-y-1.5">
                {gate.adjustments.map((adj: any, i: number) => (
                  <li key={adj.id || i} className="flex justify-between text-xs font-semibold text-charcoal-600">
                    <span>{adj.reason || `Top-up · ${adj.stage || ''}`}</span>
                    <span className="font-bold text-charcoal-800">+{inr(adj.adjustment_amount ?? adj.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sticky / Floating Action Bar */}
          <div className="flex items-center justify-between gap-4 rounded-3xl bg-white border border-charcoal-200/90 shadow-floating px-6 py-4">
            <button
              type="button"
              onClick={onBack}
              className="text-xs font-bold text-charcoal-500 hover:text-charcoal-800 transition-colors"
            >
              Back to local transport
            </button>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-charcoal-400 block">
                  Active selection
                </span>
                <span className="text-sm font-black text-charcoal-900">
                  {activeCard.label} Plan · {inr(activeCard.final_total)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleContinue()}
                disabled={continuing}
                className="inline-flex items-center gap-2 h-12 px-7 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:opacity-60 text-white text-sm font-extrabold shadow-sm transition-all"
              >
                {continuing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Building your itinerary…</span>
                  </>
                ) : gate.can_continue ? (
                  <>
                    <span>Confirm {activeCard.label} & build itinerary</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    <span>Review budget to continue</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Top-up modal */}
      <AnimatePresence>
        {showGateAlert && gate && (
          <BudgetGateAlert
            tripId={tripId}
            violations={gateViolations.length > 0 ? gateViolations : gate.violations}
            hints={[
              'Switch to the Budget (Basic) plan to lower your dining allowance',
              'Adjust your accommodation or transport tier if available',
              'Add a top-up to your travel budget below — you stay right here on this step',
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
