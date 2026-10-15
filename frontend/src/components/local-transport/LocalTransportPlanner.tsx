import React, { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  ArrowRight, BadgeCheck, Car, Loader2, MapPin, Route,
  TrainFront, Bus, CircleAlert, Footprints,
} from 'lucide-react';
import type { BudgetGate, LocalLeg, LocalTransportOption, StageState } from '../../types';
import { api, ApiError } from '../../services/api';
import { BudgetGateAlert } from '../budget/BudgetGateAlert';

const inr = (n: number | null | undefined) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

const optionIcon = (t: string) => {
  const k = t.toLowerCase();
  if (k.includes('metro') || k.includes('train')) return TrainFront;
  if (k.includes('bus')) return Bus;
  if (k.includes('walk')) return Footprints;
  return Car;
};

interface LocalTransportPlannerProps {
  tripId: string;
  initialLegs?: LocalLeg[] | null;
  onComplete: (stage: StageState) => void;
  onBack: () => void;
}

/**
 * Stage 6 — Local transport. One option per generated leg (origin →
 * destination with real distance/duration). Cab fares are per-vehicle
 * (vehicles_needed × fare_vehicle) — never per-person-multiplied.
 * Every number renders from the API.
 */
export const LocalTransportPlanner: React.FC<LocalTransportPlannerProps> = ({
  tripId, initialLegs, onComplete, onBack,
}) => {
  const [legs, setLegs] = useState<LocalLeg[]>(initialLegs || []);
  const [loading, setLoading] = useState(!initialLegs || initialLegs.length === 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [gate, setGate] = useState<BudgetGate | null>(null);
  const [allSelected, setAllSelected] = useState(false);
  const [showGateAlert, setShowGateAlert] = useState(false);
  const [gateViolations, setGateViolations] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.planLocalTransport(tripId);
      setLegs(res.legs || []);
      setAllSelected((res.legs || []).every((l) => !!l.selected_id));
    } catch (err: any) {
      setLoadError(err?.message || 'Local routes could not be generated. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialLegs || initialLegs.length === 0) void load();
    else setAllSelected(initialLegs.every((l) => !!l.selected_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const pick = async (leg: LocalLeg, opt: LocalTransportOption) => {
    const key = `${leg.index}:${opt.id}`;
    setSavingKey(key);
    try {
      const res = await api.selectLocalTransport(tripId, leg.index, opt.id);
      setLegs(res.legs || []);
      setGate(res.gate);
      setAllSelected(res.all_selected);
      if (!res.gate.can_continue) {
        setGateViolations(res.gate.violations || []);
        setShowGateAlert(true);
      }
    } catch (err: any) {
      const extra = (err as ApiError)?.extra;
      const violations: string[] | undefined =
        extra?.violations || extra?.gate?.violations || extra?.detail?.violations;
      setGateViolations(violations && violations.length > 0 ? violations : [err?.message || 'This option could not be saved.']);
      setShowGateAlert(true);
    } finally {
      setSavingKey(null);
    }
  };

  const refreshGate = async () => {
    try {
      const g = await api.getBudgetGate(tripId);
      setGate(g);
      if (g.can_continue) setShowGateAlert(false);
    } catch { /* stay; selections preserved */ }
  };

  const handleContinue = async () => {
    if (!allSelected || continuing) return;
    if (gate && !gate.can_continue) {
      setGateViolations(gate.violations || []);
      setShowGateAlert(true);
      return;
    }
    setContinuing(true);
    try {
      const stage = await api.setStage(tripId, 7);
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

  const OptionRow: React.FC<{ leg: LocalLeg; opt: LocalTransportOption }> = ({ leg, opt }) => {
    const Icon = optionIcon(opt.type || opt.label || '');
    const active = leg.selected_id === opt.id;
    const busy = savingKey === `${leg.index}:${opt.id}`;
    const isCab = /cab|taxi|car/i.test(`${opt.type} ${opt.label}`);
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => void pick(leg, opt)}
        className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all disabled:opacity-60 ${
          active ? 'bg-travion-50 border-travion-500 ring-2 ring-travion-100' : 'bg-white border-charcoal-200 hover:border-travion-300'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${active ? 'bg-travion-600 text-white' : 'bg-sand-100 text-charcoal-600'}`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-extrabold text-charcoal-900 truncate">{opt.label || opt.type}</span>
              {isCab && opt.vehicles_needed != null && opt.vehicles_needed > 0 && (
                <span className="block text-[10.5px] font-bold text-charcoal-400">
                  {opt.vehicles_needed} vehicle{opt.vehicles_needed === 1 ? '' : 's'} × {inr(opt.fare_vehicle)} per vehicle
                </span>
              )}
              {!isCab && (
                <span className="block text-[10.5px] font-bold text-charcoal-400">{inr(opt.fare_per_person)} per person</span>
              )}
            </span>
          </span>
          <span className="text-right shrink-0">
            <span className="block text-[14px] font-black text-charcoal-900">{inr(opt.party_total)}</span>
            <span className="block text-[9.5px] font-bold text-charcoal-400 uppercase">party total</span>
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {opt.verified
            ? <span className="inline-flex items-center gap-1 text-[9.5px] font-black uppercase tracking-wide text-emerald-700"><BadgeCheck className="w-3 h-3" /> Verified · {opt.source}</span>
            : <span className="inline-flex items-center gap-1 text-[9.5px] font-black uppercase tracking-wide text-amber-700"><CircleAlert className="w-3 h-3" /> Estimate · {opt.source || 'market'}</span>}
          {opt.feasibility_reason && (
            <span className="text-[10.5px] font-medium text-charcoal-400">· {opt.feasibility_reason}</span>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 6 · Local transport</span>
        <h2 className="mt-2 text-2xl font-extrabold text-charcoal-900 tracking-tight">Getting around your destination</h2>
        <p className="mt-1.5 text-[13px] font-medium text-charcoal-500">
          Pick one option per leg — real distances, honest fares.
        </p>
      </div>

      {loading ? (
        <div className="py-14 text-center">
          <Loader2 className="w-6 h-6 text-travion-500 animate-spin mx-auto mb-3" />
          <p className="text-[13px] font-bold text-charcoal-500">Generating local routes…</p>
        </div>
      ) : loadError ? (
        <div className="max-w-md mx-auto rounded-2xl bg-red-50 border border-red-100 px-4 py-4 text-center">
          <p className="text-[13px] font-bold text-red-600">{loadError}</p>
          <button type="button" onClick={() => void load()} className="mt-3 px-5 h-10 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-[12px] font-extrabold">
            Generate legs
          </button>
        </div>
      ) : legs.length === 0 ? (
        <div className="max-w-md mx-auto rounded-2xl border border-dashed border-charcoal-300 bg-ivory-50 px-5 py-8 text-center">
          <Route className="w-6 h-6 text-charcoal-300 mx-auto mb-2" />
          <p className="text-[13px] font-bold text-charcoal-600">No local legs yet.</p>
          <p className="mt-1 text-[12px] font-medium text-charcoal-400">Generate the routes between your selected places.</p>
          <button type="button" onClick={() => void load()} className="mt-4 px-6 h-11 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-[13px] font-extrabold">
            Generate legs
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-5">
            {legs.map((leg) => (
              <section key={leg.index} className="rounded-3xl border border-charcoal-200/80 bg-white shadow-soft p-4 md:p-5">
                <div className="flex items-center gap-2 text-[13px] font-extrabold text-charcoal-900 flex-wrap">
                  <MapPin className="w-4 h-4 text-travion-600 shrink-0" />
                  <span>{leg.origin}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-charcoal-300" />
                  <span>{leg.destination}</span>
                </div>
                <p className="mt-1 text-[11.5px] font-bold text-charcoal-400">
                  {leg.distance_km} km · ~{leg.duration_min} min
                </p>
                <div className="mt-3 grid sm:grid-cols-2 gap-2.5">
                  {leg.options.map((o) => (
                    <OptionRow key={o.id} leg={leg} opt={o} />
                  ))}
                </div>
                {leg.options.length === 0 && (
                  <p className="mt-2 text-[12px] font-semibold text-charcoal-400">No options on this leg yet — nothing invented.</p>
                )}
              </section>
            ))}
          </div>

          {gate && (
            <div className="mt-5 rounded-2xl border border-charcoal-200 bg-ivory-50 px-4 py-3 text-[12.5px] font-bold text-charcoal-600">
              Local transport so far: <span className="text-charcoal-900">{inr(gate.spend?.local_transport)}</span>
              {' '}· remaining budget <span className="text-travion-700">{inr(gate.remaining_budget)}</span>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 rounded-3xl bg-white border border-charcoal-200 shadow-floating px-5 py-4">
            <button type="button" onClick={onBack} className="text-[13px] font-bold text-charcoal-500 hover:text-charcoal-700">
              Back
            </button>
            <button
              type="button"
              onClick={() => void handleContinue()}
              disabled={!allSelected || continuing}
              className="inline-flex items-center gap-2 h-12 px-7 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:bg-sand-200 disabled:text-charcoal-400 text-white text-sm font-extrabold transition-colors"
            >
              {continuing ? 'Continuing…' : 'Continue'}
              {!continuing && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
          {!allSelected && (
            <p className="mt-2 text-center text-[12px] font-semibold text-charcoal-400">
              Select an option for every leg to continue.
            </p>
          )}
        </>
      )}

      <AnimatePresence>
        {showGateAlert && (
          <BudgetGateAlert
            tripId={tripId}
            violations={gateViolations.length > 0 ? gateViolations : ['Local transport exceeds your remaining budget.']}
            hints={[
              'Pick shared options (metro / bus) on longer legs',
              'Use cabs only on short legs where they save real time',
              'Add to your trip budget below — your picks stay selected',
            ]}
            stage="local_transport"
            remainingBudget={gate?.remaining_budget}
            onTopupComplete={() => void refreshGate()}
            onClose={() => setShowGateAlert(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
