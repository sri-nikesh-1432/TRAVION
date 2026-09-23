import React, { useMemo } from 'react';
import {
  ArrowLeft, ArrowRight, CalendarDays, MapPin, ShieldCheck,
  Sparkles, Users, Wallet, PencilLine, Compass, Mountain,
} from 'lucide-react';
import type { TripItinerary } from '../../types';
import { calculateTripBudget, formatINR } from '../../utils/tripPricing';

export type ReviewEditTarget = 'basics' | 'travellers' | 'places' | 'plans' | 'itinerary';

interface FinalReviewStepProps {
  trip: {
    id: string;
    destination_name: string;
    source_name: string;
    start_datetime: string;
    end_datetime: string;
    budget: number;
    mode?: 'GUIDE_MODE' | 'ADVENTUROUS_MODE' | null;
  };
  planLabel: string | null;
  travellers?: { total?: number; adults?: number; children?: number } | null;
  experienceLabel?: string | null;
  itinerary: TripItinerary;
  onEdit: (target: ReviewEditTarget) => void;
  onConfirm: () => void;
  busy?: boolean;
}

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
};

const categoryEmoji = (c: string): string => {
  switch (c) {
    case 'food': return '🍽️';
    case 'meal_hold': return '🍴';
    case 'stay': return '🏨';
    case 'activity': return '🥾';
    case 'transport': return '🚗';
    default: return '📍';
  }
};

export const FinalReviewStep: React.FC<FinalReviewStepProps> = ({
  trip, planLabel, travellers, experienceLabel, itinerary, onEdit, onConfirm, busy,
}) => {
  const days = itinerary.days || [];

  const pricing = useMemo(() => {
    const base = Number((itinerary.cost_breakdown as any)?.base_plan_cost ?? trip.budget ?? 0);
    return calculateTripBudget(base, trip.mode);
  }, [(itinerary.cost_breakdown as any)?.base_plan_cost, trip.budget, trip.mode]);

  const { days: dayCount, nights } = useMemo(() => {
    const s = new Date(trip.start_datetime).getTime();
    const e = new Date(trip.end_datetime).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) return { days: days.length, nights: Math.max(0, days.length - 1) };
    const d = Math.max(1, Math.ceil((e - s) / 86_400_000));
    return { days: d, nights: Math.max(0, d - 1) };
  }, [trip.start_datetime, trip.end_datetime, days.length]);

  const isGuide = trip.mode === 'GUIDE_MODE';
  const totalTravellers = travellers?.total;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 7 · Final review</span>
        <h2 className="mt-2 text-2xl font-extrabold text-charcoal-900 tracking-tight">Review your trip</h2>
        <p className="mt-1.5 text-[13px] font-medium text-charcoal-500">
          Your edited plan — the final source of truth. Nothing is regenerated here.
        </p>
      </div>

      {/* Trip details */}
      <section className="bg-white rounded-3xl border border-charcoal-200/80 shadow-soft p-5 md:p-6" aria-labelledby="review-trip-details">
        <div className="flex items-center justify-between mb-4">
          <h3 id="review-trip-details" className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">Trip details</h3>
          <button
            type="button"
            onClick={() => onEdit('basics')}
            className="inline-flex items-center gap-1 text-[12px] font-bold text-travion-600 hover:text-travion-700"
          >
            <PencilLine className="w-3.5 h-3.5" /> Edit
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 text-[13px] font-semibold text-charcoal-700">
          <p className="flex items-center gap-2"><MapPin className="w-4 h-4 text-travion-600" />{trip.source_name} → {trip.destination_name}</p>
          <p className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-travion-600" />{fmtDay(trip.start_datetime)} – {fmtDay(trip.end_datetime)} · {dayCount} days · {nights} nights</p>
          {totalTravellers ? (
            <p className="flex items-center gap-2"><Users className="w-4 h-4 text-travion-600" />{totalTravellers} traveller{totalTravellers === 1 ? '' : 's'}</p>
          ) : null}
          <p className="flex items-center gap-2"><Wallet className="w-4 h-4 text-travion-600" />{formatINR(pricing.baseBudget)} travel budget</p>
          {experienceLabel ? (
            <p className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-travion-600" />{experienceLabel}</p>
          ) : null}
          <p className="flex items-center gap-2">
            {/* MODE IS EXPLICIT — never inferred from the plan name (spec §35). */}
            {isGuide
              ? <Compass className="w-4 h-4 text-cognac-600" />
              : <Mountain className="w-4 h-4 text-[#4c6151]" />}
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-black uppercase tracking-wide ${isGuide ? 'bg-cognac-50 text-cognac-600' : 'bg-sage-100 text-[#4c6151]'}`}>
              {isGuide ? 'Guide Mode — verified local guide + AI' : 'Adventurous Mode — independent + AI'}
            </span>
          </p>
          {planLabel ? (
            <p className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-travion-600" />Selected plan: {planLabel}</p>
          ) : null}
        </div>
      </section>

      {/* Final itinerary (READ-ONLY — the exact stored finalItinerary) */}
      <section className="mt-5 bg-white rounded-3xl border border-charcoal-200/80 shadow-soft p-5 md:p-6" aria-labelledby="review-itinerary">
        <div className="flex items-center justify-between mb-4">
          <h3 id="review-itinerary" className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">Your final itinerary</h3>
          <button
            type="button"
            onClick={() => onEdit('itinerary')}
            className="inline-flex items-center gap-1 text-[12px] font-bold text-travion-600 hover:text-travion-700"
          >
            <PencilLine className="w-3.5 h-3.5" /> Edit itinerary
          </button>
        </div>
        <div className="space-y-6">
          {days.map((day: any) => (
            <div key={day.day}>
              <p className="text-[12px] font-black uppercase tracking-wider text-charcoal-500 mb-2">
                Day {day.day}
                {day.stops[0]?.id && day.title ? <span className="ml-2 text-charcoal-400 normal-case font-bold">{day.title}</span> : null}
              </p>
              <ol className="border-l-2 border-sand-200 ml-2 space-y-3">
                {(day.stops || []).map((stop: any) => (
                  <li key={stop.id} className="pl-4 relative">
                    <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-travion-500 border-2 border-white" aria-hidden />
                    <p className="text-[13px] font-bold text-charcoal-800">
                      <span className="text-charcoal-400 font-semibold tabular-nums">{stop.time}</span>
                      {' · '}<span aria-hidden>{categoryEmoji(String(stop.category))}</span> {stop.title}
                    </p>
                    {stop.duration_minutes ? (
                      <p className="text-[11.5px] font-semibold text-charcoal-400">~{stop.duration_minutes} min</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      {/* Budget breakdown — the SAME centralized pricing object as payment (spec §34) */}
      <section className="mt-5 bg-white rounded-3xl border border-charcoal-200/80 shadow-soft p-5 md:p-6" aria-labelledby="review-budget">
        <div className="flex items-center justify-between mb-4">
          <h3 id="review-budget" className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">Budget breakdown</h3>
          <button
            type="button"
            onClick={() => onEdit('plans')}
            className="inline-flex items-center gap-1 text-[12px] font-bold text-travion-600 hover:text-travion-700"
          >
            <PencilLine className="w-3.5 h-3.5" /> Edit plan
          </button>
        </div>
        <div className="space-y-1.5 text-[13px] font-semibold text-charcoal-600 max-w-md">
          <div className="flex justify-between"><span>Base trip budget</span><span className="font-bold text-charcoal-800">{formatINR(pricing.baseBudget)}</span></div>
          {isGuide ? (
            <div className="flex justify-between rounded-lg bg-cognac-50 px-2 py-1 text-cognac-600 font-bold">
              <span>Guide fee <span className="font-semibold opacity-70">12.5%</span></span><span>{formatINR(pricing.guideFee)}</span>
            </div>
          ) : (
            <div className="flex justify-between px-2 text-charcoal-400">
              <span>Guide fee</span><span>₹0 — Adventurous Mode</span>
            </div>
          )}
          <div className="flex justify-between rounded-lg bg-cream-100 px-2 py-1 text-travion-700 font-bold">
            <span>Platform fee <span className="font-semibold opacity-70">3%</span></span><span>{formatINR(pricing.platformFee)}</span>
          </div>
          <div className="flex justify-between rounded-lg bg-sage-100 px-2 py-1 text-[#4c6151] font-bold">
            <span>Safety reserve <span className="font-semibold opacity-70">15%</span></span><span>{formatINR(pricing.safetyReserve)}</span>
          </div>
          <p className="text-[10.5px] font-semibold text-charcoal-400 px-2">
            Reserved for unexpected travel or emergency needs — never spent automatically.
          </p>
          <div className="flex justify-between rounded-lg bg-sky-100 px-2 py-1 text-travion-800 font-bold">
            <span>Insurance <span className="font-semibold opacity-70">fixed</span></span><span>{formatINR(pricing.insuranceFee)}</span>
          </div>
          <p className="text-[10.5px] font-semibold text-charcoal-400 px-2">
            ₹50 fixed — TRAVION Refund Protection: refunded with the platform fee if TRAVION cancels your trip.
          </p>
          <div className="flex justify-between border-t border-charcoal-100 pt-2 text-[15px] font-black text-charcoal-900">
            <span>Final planned amount</span><span>{formatINR(pricing.finalPlannedAmount)}</span>
          </div>
          <p className="text-[11px] font-semibold text-charcoal-500 pt-1">
            {isGuide
              ? 'Guide Mode — 12.5% guide fee applied.'
              : 'Adventurous Mode — no guide fee. The 3% platform fee, 15% safety reserve and ₹50 insurance are still included.'}
          </p>
        </div>
      </section>

      {/* Actions */}
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => onEdit('itinerary')}
          className="inline-flex items-center gap-2 h-12 px-6 rounded-2xl text-charcoal-500 text-[13px] font-bold hover:text-charcoal-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Edit itinerary
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="inline-flex items-center gap-2 h-12 px-8 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:bg-sand-200 disabled:text-charcoal-400 text-white text-sm font-extrabold transition-colors"
        >
          {busy ? 'Preparing…' : 'Continue to payment'}
          {!busy && <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
