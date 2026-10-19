import React, { useMemo } from 'react';
import {
  ArrowLeft, ArrowRight, BedDouble, Bus, CalendarDays, Car, MapPin, ShieldCheck,
  Sparkles, Users, Utensils, Wallet, PencilLine, Compass, Mountain,
  Plane, TrainFront, Route,
} from 'lucide-react';
import type { TripItinerary } from '../../types';
import { calculateTripBudget, formatINR } from '../../utils/tripPricing';
import { WeatherStrip } from '../weather/WeatherStrip';

export type ReviewEditTarget =
  | 'basics' | 'travellers' | 'places' | 'plans' | 'itinerary'
  | 'transport' | 'discovery_select' | 'stay' | 'mode_select' | 'local_transport' | 'budget_food';

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
  /** One-line summaries rendered from the review snapshot (server truth). */
  transportLabel?: string | null;
  localLabel?: string | null;
  foodLabel?: string | null;
  stayLabel?: string | null;
  onEdit: (target: ReviewEditTarget) => void;
  onConfirm: () => void;
  busy?: boolean;
}

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const CategoryIcon: React.FC<{ category: string; className?: string }> = ({ category, className }) => {
  const cls = className || 'w-3.5 h-3.5';
  switch (String(category)) {
    case 'food':
    case 'meal_hold':
      return <Utensils className={cls} />;
    case 'stay':
      return <BedDouble className={cls} />;
    case 'transport':
      return <Car className={cls} />;
    default:
      return <MapPin className={cls} />;
  }
};

const EditBtn: React.FC<{ target: ReviewEditTarget; label?: string; onEdit: (target: ReviewEditTarget) => void }> = ({ target, label, onEdit }) => (
  <button
    type="button"
    onClick={() => onEdit(target)}
    className="inline-flex items-center gap-1 text-[12px] font-bold text-travion-600 hover:text-travion-700"
  >
    <PencilLine className="w-3.5 h-3.5" /> {label || 'Edit'}
  </button>
);

export const FinalReviewStep: React.FC<FinalReviewStepProps> = ({
  trip, planLabel, travellers, experienceLabel, itinerary,
  transportLabel, localLabel, foodLabel, stayLabel,
  onEdit, onConfirm, busy,
}) => {
  const days = itinerary.days || [];
  const bd = (itinerary.cost_breakdown as any) || {};

  const pricing = useMemo(() => {
    if (bd && (bd.final_total || bd.payable || bd.total_cost || bd.guide_fee !== undefined)) {
      const base = Number(bd.base_plan_cost ?? bd.travel_spend ?? trip.budget ?? 0);
      const isGuideMode = trip.mode === 'GUIDE_MODE' || Number(bd.guide_fee || 0) > 0;
      return {
        baseBudget: base,
        guideFee: Number(bd.guide_fee ?? (isGuideMode ? Math.round(base * 0.125) : 0)),
        platformFee: Number(bd.platform_fee ?? Math.round(base * 0.03)),
        safetyReserve: Number(bd.safety_reserve ?? Math.round(base * 0.15)),
        insuranceFee: Number(bd.insurance_fee ?? 50),
        finalPlannedAmount: Number(bd.final_total ?? bd.payable ?? bd.total_cost ?? (base + (isGuideMode ? Math.round(base * 0.125) : 0) + Math.round(base * 0.03) + Math.round(base * 0.15) + 50)),
      };
    }
    const base = Number((itinerary.cost_breakdown as any)?.base_plan_cost ?? trip.budget ?? 0);
    return calculateTripBudget(base, trip.mode);
  }, [itinerary.cost_breakdown, trip.budget, trip.mode]);

  const { days: dayCount, nights } = useMemo(() => {
    const s = new Date(trip.start_datetime).getTime();
    const e = new Date(trip.end_datetime).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) return { days: days.length, nights: Math.max(0, days.length - 1) };
    const d = Math.max(1, Math.ceil((e - s) / 86_400_000));
    return { days: d, nights: Math.max(0, d - 1) };
  }, [trip.start_datetime, trip.end_datetime, days.length]);

  const isGuide = trip.mode === 'GUIDE_MODE' || pricing.guideFee > 0;
  const totalTravellers = travellers?.total;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 9 · Final review</span>
        <h2 className="mt-2 text-2xl font-extrabold text-charcoal-900 tracking-tight">Review your trip</h2>
        <p className="mt-1.5 text-[13px] font-medium text-charcoal-500">
          Your edited plan — the final source of truth. Nothing is regenerated here.
        </p>
      </div>

      {/* Trip details */}
      <section className="bg-white rounded-3xl border border-charcoal-200/80 shadow-soft p-5 md:p-6" aria-labelledby="review-trip-details">
        <div className="flex items-center justify-between mb-4">
          <h3 id="review-trip-details" className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">Trip details</h3>
          <EditBtn onEdit={onEdit} target="basics" />
        </div>
        <div className="grid sm:grid-cols-2 gap-3 text-[13px] font-semibold text-charcoal-700">
          <p className="flex items-center gap-2"><MapPin className="w-4 h-4 text-travion-600" />{trip.source_name} → {trip.destination_name}</p>
          <p className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-travion-600" />{fmtDay(trip.start_datetime)} – {fmtDay(trip.end_datetime)} · {dayCount} days · {nights} nights</p>
          {totalTravellers ? (
            <p className="flex items-center gap-2"><Users className="w-4 h-4 text-travion-600" />{totalTravellers} traveller{totalTravellers === 1 ? '' : 's'} <EditBtn onEdit={onEdit} target="travellers" label="Edit travellers" /></p>
          ) : null}
          <p className="flex items-center gap-2"><Wallet className="w-4 h-4 text-travion-600" />{formatINR(pricing.baseBudget)} travel budget</p>
          {experienceLabel ? (
            <p className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-travion-600" />{experienceLabel}</p>
          ) : null}
          {planLabel ? (
            <p className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-travion-600" />Selected plan: {planLabel}</p>
          ) : null}
        </div>
        <div className="mt-4">
          <WeatherStrip tripId={trip.id} />
        </div>
      </section>

      {/* Transport */}
      <section className="mt-5 bg-white rounded-3xl border border-charcoal-200/80 shadow-soft p-5 md:p-6" aria-labelledby="review-transport">
        <div className="flex items-center justify-between mb-3">
          <h3 id="review-transport" className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">Transport</h3>
          <EditBtn onEdit={onEdit} target="transport" />
        </div>
        {transportLabel ? (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-charcoal-700">
            <TrainFront className="w-4 h-4 text-travion-600" />{transportLabel}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-charcoal-400">
            <Bus className="w-4 h-4" />Outbound + return options confirmed in the Transport step.
          </p>
        )}
      </section>

      {/* Places & stay */}
      {/* Explore / Places */}
      <section className="mt-5 bg-white rounded-3xl border border-charcoal-200/80 shadow-soft p-5 md:p-6" aria-labelledby="review-places">
        <div className="flex items-center justify-between mb-3">
          <h3 id="review-places" className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">Places & Attractions</h3>
          <EditBtn onEdit={onEdit} target="discovery_select" label="Edit Places" />
        </div>
        <p className="flex items-center gap-2 text-[13px] font-semibold text-charcoal-700">
          <MapPin className="w-4 h-4 text-travion-600" />Attractions & activities chosen in Explore.
        </p>
      </section>

      {/* Accommodation / Stay */}
      <section className="mt-5 bg-white rounded-3xl border border-charcoal-200/80 shadow-soft p-5 md:p-6" aria-labelledby="review-stay">
        <div className="flex items-center justify-between mb-3">
          <h3 id="review-stay" className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">Accommodation</h3>
          <EditBtn onEdit={onEdit} target="stay" label="Edit Stay" />
        </div>
        {stayLabel ? (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-charcoal-700">
            <BedDouble className="w-4 h-4 text-travion-600" />{stayLabel}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-charcoal-400">
            <BedDouble className="w-4 h-4" />Accommodation chosen in the Stay step.
          </p>
        )}
      </section>

      {/* Mode */}
      <section className="mt-5 bg-white rounded-3xl border border-charcoal-200/80 shadow-soft p-5 md:p-6" aria-labelledby="review-mode">
        <div className="flex items-center justify-between mb-3">
          <h3 id="review-mode" className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">Travel mode</h3>
          <EditBtn onEdit={onEdit} target="mode_select" />
        </div>
        <p className="flex items-center gap-2">
          {isGuide
            ? <Compass className="w-4 h-4 text-cognac-600" />
            : <Mountain className="w-4 h-4 text-[#4c6151]" />}
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-black uppercase tracking-wide ${isGuide ? 'bg-cognac-50 text-cognac-600' : 'bg-sage-100 text-[#4c6151]'}`}>
            {isGuide ? 'Guide Mode — verified local guide + AI' : 'Adventurous Mode — independent + AI'}
          </span>
        </p>
      </section>

      {/* Local transport */}
      <section className="mt-5 bg-white rounded-3xl border border-charcoal-200/80 shadow-soft p-5 md:p-6" aria-labelledby="review-local">
        <div className="flex items-center justify-between mb-3">
          <h3 id="review-local" className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">Local transport</h3>
          <EditBtn onEdit={onEdit} target="local_transport" />
        </div>
        {localLabel ? (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-charcoal-700">
            <Route className="w-4 h-4 text-travion-600" />{localLabel}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-charcoal-400">
            <Car className="w-4 h-4" />Local legs confirmed in the Local step.
          </p>
        )}
      </section>

      {/* Food */}
      <section className="mt-5 bg-white rounded-3xl border border-charcoal-200/80 shadow-soft p-5 md:p-6" aria-labelledby="review-food">
        <div className="flex items-center justify-between mb-3">
          <h3 id="review-food" className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">Food plan</h3>
          <EditBtn onEdit={onEdit} target="budget_food" />
        </div>
        {foodLabel ? (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-charcoal-700">
            <Utensils className="w-4 h-4 text-travion-600" />{foodLabel}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-charcoal-400">
            <Utensils className="w-4 h-4" />Food tier chosen in the Budget step.
          </p>
        )}
      </section>

      {/* Final itinerary (READ-ONLY — the exact stored finalItinerary) */}
      <section className="mt-5 bg-white rounded-3xl border border-charcoal-200/80 shadow-soft p-5 md:p-6" aria-labelledby="review-itinerary">
        <div className="flex items-center justify-between mb-4">
          <h3 id="review-itinerary" className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">Your final itinerary</h3>
          <EditBtn onEdit={onEdit} target="itinerary" label="Edit itinerary" />
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
                    <p className="text-[13px] font-bold text-charcoal-800 flex items-center gap-1.5">
                      <span className="text-charcoal-400 font-semibold tabular-nums">{stop.time}</span>
                      <span className="text-travion-600"><CategoryIcon category={String(stop.category)} /></span>
                      <span>{stop.title}</span>
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
          <EditBtn onEdit={onEdit} target="budget_food" label="Edit budget" />
        </div>
        <div className="space-y-1.5 text-[13px] font-semibold text-charcoal-600 max-w-md">
          {Boolean(bd.transport || bd.stay || bd.food || bd.activities || bd.local_transport) && (
            <div className="mb-3 pb-3 border-b border-charcoal-100 space-y-1 text-xs text-charcoal-500">
              {Boolean(bd.transport) && (
                <div className="flex justify-between">
                  <span>Round-trip Transport</span>
                  <span className="font-semibold text-charcoal-700">{formatINR(Number(bd.transport))}</span>
                </div>
              )}
              {Boolean(bd.stay) && (
                <div className="flex justify-between">
                  <span>Accommodation</span>
                  <span className="font-semibold text-charcoal-700">{formatINR(Number(bd.stay))}</span>
                </div>
              )}
              {Boolean(bd.food) && (
                <div className="flex justify-between">
                  <span>Daily Food Allowance</span>
                  <span className="font-semibold text-charcoal-700">{formatINR(Number(bd.food))}</span>
                </div>
              )}
              {Boolean(bd.activities) && (
                <div className="flex justify-between">
                  <span>Activities & Sightseeing</span>
                  <span className="font-semibold text-charcoal-700">{formatINR(Number(bd.activities))}</span>
                </div>
              )}
              {Boolean(bd.local_transport) && (
                <div className="flex justify-between">
                  <span>Local Transport Legs</span>
                  <span className="font-semibold text-charcoal-700">{formatINR(Number(bd.local_transport))}</span>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-between"><span>Base travel spend</span><span className="font-bold text-charcoal-800">{formatINR(pricing.baseBudget)}</span></div>
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
            <span>Safety reserve <span className="font-semibold opacity-70">15% · PROTECTED</span></span><span>{formatINR(pricing.safetyReserve)}</span>
          </div>
          <p className="text-[10.5px] font-semibold text-charcoal-400 px-2">
            PROTECTED — reserved for unexpected travel or emergency needs, never spent automatically.
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
