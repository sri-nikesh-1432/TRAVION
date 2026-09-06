import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, AlertTriangle, ArrowRight, Sparkles } from 'lucide-react';
import { PlanOption } from '../../types';

interface PlanChoiceCardsProps {
  plans: PlanOption[];
  destinationName: string;
  onSelect: (planType: 'VALUE' | 'RECOMMENDED' | 'PREMIUM') => void;
  onBack?: () => void;
  busy?: boolean;
}

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

export const PlanChoiceCards: React.FC<PlanChoiceCardsProps> = ({
  plans, destinationName, onSelect, onBack, busy,
}) => {
  const [selected, setSelected] = useState<string | null>(null);

  const handleConfirm = () => {
    if (!selected || busy) return;
    onSelect(selected as 'VALUE' | 'RECOMMENDED' | 'PREMIUM');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 4 · Choose your plan</span>
        <h2 className="mt-2 text-2xl font-extrabold text-slate-900 tracking-tight">
          Three ways to experience {destinationName}
        </h2>
        <p className="mt-1.5 text-[13px] font-medium text-slate-500">
          Every plan includes your selected places and stays within your budget — the 3% platform fee is included in the ceiling, so what you see is what you spend.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {plans.map((plan, i) => {
          const isSelected = selected === plan.type;
          const bd = plan.cost_breakdown || {};
          const usedPct = Math.max(4, Math.min(100, (plan.final_total / Math.max(1, plan.budget_max)) * 100));
          return (
            <motion.button
              key={plan.type}
              type="button"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={() => setSelected(plan.type)}
              className={`relative text-left p-5 rounded-3xl border bg-white shadow-soft transition-all ${
                isSelected ? 'border-travion-400 ring-2 ring-travion-200' : 'border-slate-200 hover:border-travion-200'
              }`}
            >
              {plan.recommended && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-travion-600 text-white text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
                  <Sparkles className="w-2.5 h-2.5" /> Recommended for you
                </span>
              )}

              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  {plan.label.split('·')[1]?.trim() || plan.type}
                </span>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  isSelected ? 'bg-travion-600 border-travion-600 text-white' : 'border-slate-300'
                }`}>
                  {isSelected && <Check className="w-3 h-3" />}
                </span>
              </div>

              {/* Live budget bar */}
              <div className="mt-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-2xl font-extrabold text-slate-900">{inr(plan.final_total)}</p>
                  <p className={`text-[11px] font-bold ${(plan.remaining_budget ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {inr(plan.remaining_budget)} left
                  </p>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${plan.final_total > plan.budget_max ? 'bg-red-500' : 'bg-travion-600'}`}
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[9.5px] font-bold text-slate-400">
                  <span>limit {inr(plan.budget_min)}</span>
                  <span>{inr(plan.budget_max)}</span>
                </div>
              </div>

              {/* Transparent fee math */}
              <div className="mt-3.5 space-y-1.5 text-[12px] font-semibold text-slate-600">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Trip cost</p>
                <div className="flex justify-between"><span>Transport</span><span>{inr(bd.transport || 0)}</span></div>
                <div className="flex justify-between"><span>Stay</span><span>{inr(bd.stay || 0)}</span></div>
                <div className="flex justify-between"><span>Food</span><span>{inr(bd.food || 0)}</span></div>
                {(bd.activities || 0) > 0 && (
                  <div className="flex justify-between"><span>Activities & extras</span><span>{inr(bd.activities || 0)}</span></div>
                )}
                {(bd.guide_fee || 0) > 0 && (
                  <div className="flex justify-between"><span>Guide</span><span>{inr(bd.guide_fee || 0)}</span></div>
                )}
                <div className="flex justify-between border-t border-slate-100 pt-1.5 font-bold text-slate-800">
                  <span>Base plan cost</span><span>{inr(plan.base_plan_cost)}</span>
                </div>
                <div className="flex justify-between text-travion-700 font-bold">
                  <span>Platform fee (3%)</span><span>{inr(plan.platform_fee)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-1.5 font-extrabold text-slate-900">
                  <span>Total incl. fee</span><span>{inr(plan.final_total)}</span>
                </div>
              </div>

              {/* What makes this plan different */}
              {plan.highlights?.length > 0 && (
                <div className="mt-3.5 space-y-1">
                  {plan.highlights.map((h, hi) => (
                    <p key={hi} className="text-[11.5px] font-semibold text-slate-600 leading-relaxed">{h}</p>
                  ))}
                </div>
              )}

              {plan.warnings.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {plan.warnings.map((w, wi) => (
                    <div key={wi} className="flex items-start gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-2.5 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {w}
                    </div>
                  ))}
                </div>
              )}
            </motion.button>
          );
        })}
      </div>

      <div className="mt-8 flex items-center justify-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="h-12 px-6 rounded-2xl text-slate-500 text-[13px] font-bold hover:text-slate-700 transition-colors"
          >
            Change my places
          </button>
        )}
        <button
          type="button"
          disabled={!selected || busy}
          onClick={handleConfirm}
          className="inline-flex items-center gap-2 h-12 px-8 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-extrabold transition-colors"
        >
          {busy ? 'Building your itinerary…' : 'Confirm plan & continue'}
          {!busy && <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
