import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Sparkles, Leaf, Crown, AlertTriangle, ArrowRight } from 'lucide-react';
import { PlanOption } from '../../types';

interface PlanChoiceCardsProps {
  plans: PlanOption[];
  destinationName: string;
  onSelect: (planType: 'VALUE' | 'RECOMMENDED' | 'PREMIUM') => void;
  onBack?: () => void;
  busy?: boolean;
}

const PLAN_META: Record<string, { icon: React.ReactNode; accent: string; ring: string }> = {
  VALUE: { icon: <Leaf className="w-4 h-4" />, accent: 'bg-emerald-100 text-emerald-700', ring: 'hover:border-emerald-300' },
  RECOMMENDED: { icon: <Sparkles className="w-4 h-4" />, accent: 'bg-travion-100 text-travion-700', ring: 'border-travion-300 ring-2 ring-travion-100' },
  PREMIUM: { icon: <Crown className="w-4 h-4" />, accent: 'bg-amber-100 text-amber-700', ring: 'hover:border-amber-300' },
};

export const PlanChoiceCards: React.FC<PlanChoiceCardsProps> = ({ plans, destinationName, onSelect, onBack, busy }) => {
  const [selected, setSelected] = useState<string | null>(null);

  const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

  const handleConfirm = () => {
    if (!selected || busy) return;
    onSelect(selected as 'VALUE' | 'RECOMMENDED' | 'PREMIUM');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">
          Step 3 · Choose your plan
        </span>
        <h2 className="mt-2 text-2xl font-extrabold text-slate-900 tracking-tight">
          Three ways to experience {destinationName}
        </h2>
        <p className="mt-1.5 text-[13px] font-medium text-slate-500">
          Every plan stays within your budget. Pick the one that fits your style — you can still fine-tune it afterwards.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {plans.map((plan, i) => {
          const meta = PLAN_META[plan.type] || PLAN_META.RECOMMENDED;
          const isSelected = selected === plan.type;
          const bd = plan.cost_breakdown || {};
          return (
            <motion.button
              key={plan.type}
              type="button"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={() => setSelected(plan.type)}
              className={`relative text-left p-5 rounded-3xl border bg-white shadow-soft transition-all ${
                isSelected ? 'border-travion-400 ring-2 ring-travion-200' : `border-slate-200 ${meta.ring}`
              }`}
            >
              {plan.recommended && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-travion-600 text-white text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
                  Recommended for you
                </span>
              )}

              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${meta.accent}`}>
                  {meta.icon}
                  {plan.type}
                </span>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  isSelected ? 'bg-travion-600 border-travion-600 text-white' : 'border-slate-300'
                }`}>
                  {isSelected && <Check className="w-3 h-3" />}
                </span>
              </div>

              <div className="mt-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{plan.label.split('·')[1]?.trim() || plan.type}</p>
                <p className="text-2xl font-extrabold text-slate-900 mt-0.5">{inr(plan.total_cost)}</p>
                <p className="text-[12px] font-medium text-slate-500 mt-1.5 leading-relaxed">{plan.tagline}</p>
              </div>

              <div className="mt-4 space-y-1.5 text-[12px] font-semibold text-slate-600">
                <div className="flex justify-between"><span>Transport</span><span>{inr(bd.transport || 0)}</span></div>
                <div className="flex justify-between"><span>Stay</span><span>{inr(bd.stay || 0)}</span></div>
                <div className="flex justify-between"><span>Food</span><span>{inr(bd.food || 0)}</span></div>
                <div className="flex justify-between"><span>Activities</span><span>{inr(bd.activities || 0)}</span></div>
                {(bd.guide_fee || 0) + (bd.platform_fee || 0) > 0 && (
                  <div className="flex justify-between text-travion-700">
                    <span>Guide + platform</span>
                    <span>{inr((bd.guide_fee || 0) + (bd.platform_fee || 0))}</span>
                  </div>
                )}
              </div>

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

              {plan.within_budget && plan.warnings.length === 0 && (
                <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-emerald-600">
                  <Check className="w-3.5 h-3.5" />
                  Within your {inr(plan.budget_min)}–{inr(plan.budget_max)} budget
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
            Back
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
