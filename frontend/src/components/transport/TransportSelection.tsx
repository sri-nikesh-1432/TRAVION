import React, { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Plane, TrainFront, Bus, ArrowRight, BadgeCheck, AlertTriangle,
  Loader2, RefreshCw, ShieldCheck, CircleAlert,
} from 'lucide-react';
import type { BudgetGate, StageState, TransportOption } from '../../types';
import { api, ApiError } from '../../services/api';
import { BudgetGateAlert } from '../budget/BudgetGateAlert';

const inr = (n: number | null | undefined) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

const typeIcon = (t: string) =>
  t === 'flight' ? Plane : t === 'train' ? TrainFront : Bus;

const fmtDuration = (min: number | null | undefined) => {
  const m = Math.round(Number(min) || 0);
  if (m <= 0) return '—';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${r > 0 ? `${r}m` : ''}`.trim() : `${r}m`;
};

interface TransportSelectionProps {
  tripId: string;
  initial?: StageState['transport'] | null;
  partySize?: number | null;
  onComplete: (stage: StageState) => void;
  onBack: () => void;
}

/**
 * Stage 3 — Transport. Outbound + return option cards, one selection per
 * direction. All prices render from the API; gate failures keep the screen
 * and its selections intact while the BudgetAlert offers recovery.
 */
export const TransportSelection: React.FC<TransportSelectionProps> = ({
  tripId, initial, partySize, onComplete, onBack,
}) => {
  const [outbound, setOutbound] = useState<TransportOption[]>(initial?.options?.outbound || []);
  const [back, setBack] = useState<TransportOption[]>(initial?.options?.return || []);
  const [selOut, setSelOut] = useState<string | null>(initial?.selected?.outbound?.id || null);
  const [selRet, setSelRet] = useState<string | null>(initial?.selected?.return?.id || null);
  const [loading, setLoading] = useState(!initial || (outbound.length === 0 && back.length === 0));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [gate, setGate] = useState<BudgetGate | null>(null);
  const [gateError, setGateError] = useState<string[] | null>(null);
  const [showGateAlert, setShowGateAlert] = useState(false);

  const load = async (regenerate = false) => {
    if (regenerate) setRegenerating(true); else setLoading(true);
    setLoadError(null);
    try {
      const opts = await api.getTransportOptions(tripId, regenerate);
      setOutbound(opts.outbound || []);
      setBack(opts.return || []);
      if ((opts.outbound || []).length === 0 && (opts.return || []).length === 0) {
        setLoadError('No transport options came back for this route. Please retry — your trip details are saved.');
      }
    } catch (err: any) {
      const status = (err as ApiError)?.status;
      // A route-level 404 here means the app bundle is older than the
      // backend: hard-refresh (Ctrl+Shift+R) to load the current screens.
      const hint = status === 404
        ? ' (the server did not recognise this step — hard-refresh with Ctrl+Shift+R, then continue from your saved trip)'
        : '';
      setLoadError(`${err?.message || 'Transport options could not be loaded. Please retry.'}${hint}`);
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  };

  useEffect(() => {
    const hasOptions = (initial?.options?.outbound?.length || 0) + (initial?.options?.return?.length || 0) > 0;
    if (!initial || !hasOptions) {
      void load(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const confirmSelections = async () => {
    if (!selOut || !selRet || saving) return;
    setSaving(true);
    setGate(null);
    setGateError(null);
    try {
      const res = await api.selectTransport(tripId, selOut, selRet);
      setGate(res.gate);
      if (!res.gate.can_continue) {
        setShowGateAlert(true);
        return;
      }
    } catch (err: any) {
      const extra = (err as ApiError)?.extra;
      const violations: string[] | undefined =
        extra?.violations || extra?.gate?.violations || extra?.detail?.violations;
      setGateError(violations && violations.length > 0 ? violations : [err?.message || 'These selections could not be saved.']);
      setShowGateAlert(true);
      return;
    } finally {
      setSaving(false);
    }
  };

  const refreshGate = async () => {
    try {
      const g = await api.getBudgetGate(tripId);
      setGate(g);
      if (g.can_continue) setShowGateAlert(false);
    } catch { /* stay on screen; selections preserved */ }
  };

  const handleContinue = async () => {
    if (!selOut || !selRet || continuing) return;
    // Persist selections first when the gate is unknown or blocking.
    if (!gate || !gate.can_continue) {
      await confirmSelections();
      return;
    }
    setContinuing(true);
    try {
      const stage = await api.setStage(tripId, 4);
      onComplete(stage);
    } catch (err: any) {
      const status = (err as ApiError)?.status;
      if (status === 404) {
        // Staged endpoint not live yet — advance locally; selections are saved.
        onComplete({} as StageState);
        return;
      }
      const extra = (err as ApiError)?.extra;
      const violations: string[] | undefined =
        extra?.violations || extra?.gate?.violations || extra?.detail?.violations;
      setGateError(violations && violations.length > 0 ? violations : [err?.message || 'Could not continue yet.']);
      setShowGateAlert(true);
    } finally {
      setContinuing(false);
    }
  };

  const OptionCard: React.FC<{ opt: TransportOption; active: boolean; onPick: () => void }> = ({ opt, active, onPick }) => {
    const Icon = typeIcon(opt.type);
    return (
      <button
        type="button"
        onClick={onPick}
        className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${
          active ? 'bg-travion-50 border-travion-500 ring-2 ring-travion-100' : 'bg-white border-charcoal-200 hover:border-travion-300'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-2">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${active ? 'bg-travion-600 text-white' : 'bg-sand-100 text-charcoal-600'}`}>
              <Icon className="w-4.5 h-4.5" />
            </span>
            <span>
              <span className="block text-[13.5px] font-extrabold text-charcoal-900">{opt.operator}</span>
              <span className="block text-[10.5px] font-bold text-charcoal-400 uppercase tracking-wide">{opt.type}</span>
            </span>
          </span>
          <span className="flex flex-col items-end gap-1">
            {opt.verified
              ? <span className="inline-flex items-center gap-1 text-[9.5px] font-black uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><BadgeCheck className="w-3 h-3" /> Verified</span>
              : <span className="inline-flex items-center gap-1 text-[9.5px] font-black uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"><CircleAlert className="w-3 h-3" /> Estimate · {opt.source || 'market'}</span>}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[13px] font-bold text-charcoal-800">
          <span>{opt.depart_time}</span>
          <span className="flex-1 h-px bg-charcoal-200 relative">
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-black text-charcoal-400 bg-white px-1">{fmtDuration(opt.duration_min)}</span>
          </span>
          <span>{opt.arrive_time}</span>
        </div>
        {opt.date && <p className="mt-1 text-[11px] font-semibold text-charcoal-400">{opt.date}</p>}
        <div className="mt-2.5 flex items-end justify-between gap-2">
          <span className="text-[11px] font-bold text-charcoal-500">
            {opt.availability || 'Availability on request'}
            {partySize ? ` · ${partySize} traveller${partySize === 1 ? '' : 's'}` : ''}
          </span>
          <span className="text-right">
            <span className="block text-[15px] font-black text-charcoal-900">{inr(opt.party_total)}</span>
            <span className="block text-[10.5px] font-semibold text-charcoal-400">{inr(opt.price_per_person)} per person</span>
          </span>
        </div>
        {opt.note && <p className="mt-1.5 text-[11px] font-medium text-charcoal-400">{opt.note}</p>}
      </button>
    );
  };

  const Direction: React.FC<{
    title: string; options: TransportOption[]; selected: string | null; onPick: (id: string) => void;
  }> = ({ title, options, selected, onPick }) => (
    <section>
      <h3 className="text-[12px] font-black uppercase tracking-wider text-charcoal-500 mb-3">{title}</h3>
      {options.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-charcoal-300 bg-ivory-50 px-5 py-6 text-center">
          <p className="text-[13px] font-bold text-charcoal-600">No verified {title.toLowerCase()} options right now.</p>
          <p className="mt-1 text-[12px] font-medium text-charcoal-400">We never invent schedules — retry or regenerate below.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {options.map((o) => (
            <OptionCard key={o.id} opt={o} active={selected === o.id} onPick={() => { setGate(null); onPick(o.id); }} />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 3 · Transport</span>
        <h2 className="mt-2 text-2xl font-extrabold text-charcoal-900 tracking-tight">How will you get there and back?</h2>
        <p className="mt-1.5 text-[13px] font-medium text-charcoal-500">
          Pick one option each way — real operators and fares, verified where marked.
        </p>
      </div>

      {loading ? (
        <div className="py-14 text-center">
          <Loader2 className="w-6 h-6 text-travion-500 animate-spin mx-auto mb-3" />
          <p className="text-[13px] font-bold text-charcoal-500">Finding real transport options…</p>
        </div>
      ) : loadError ? (
        <div className="max-w-md mx-auto rounded-2xl bg-red-50 border border-red-100 px-4 py-4 text-center">
          <p className="text-[13px] font-bold text-red-600">{loadError}</p>
          <button type="button" onClick={() => void load(false)} className="mt-3 px-5 h-10 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-[12px] font-extrabold">
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-8">
            <Direction title="Outbound — getting there" options={outbound} selected={selOut} onPick={setSelOut} />
            <Direction title="Return — coming home" options={back} selected={selRet} onPick={setSelRet} />
          </div>

          {gate && (
            <div className={`mt-6 rounded-2xl border px-4 py-3 flex items-start gap-2.5 ${gate.can_continue ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              {gate.can_continue
                ? <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                : <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />}
              <div>
                <p className={`text-[13px] font-extrabold ${gate.can_continue ? 'text-emerald-700' : 'text-red-700'}`}>
                  {gate.can_continue
                    ? `Fits your budget — ${inr(gate.remaining_budget)} remaining`
                    : 'Over budget — see what can change'}
                </p>
                {!gate.can_continue && gate.violations.length > 0 && (
                  <p className="text-[12px] font-medium text-red-600 mt-0.5">{gate.violations[0]}</p>
                )}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-3xl bg-white border border-charcoal-200 shadow-floating px-5 py-4">
            <div className="flex items-center gap-2">
              <button type="button" onClick={onBack} className="text-[13px] font-bold text-charcoal-500 hover:text-charcoal-700">
                Back
              </button>
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={regenerating}
                className="inline-flex items-center gap-1.5 text-[12px] font-bold text-travion-600 hover:text-travion-700 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                {regenerating ? 'Refreshing…' : 'Refresh options'}
              </button>
            </div>
            <div className="flex items-center gap-2.5">
              {selOut && selRet && (
                <button
                  type="button"
                  onClick={() => void confirmSelections()}
                  disabled={saving}
                  className="h-12 px-5 rounded-2xl border border-travion-300 text-travion-700 text-sm font-extrabold hover:bg-travion-50 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save selections'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleContinue()}
                disabled={!selOut || !selRet || continuing || saving}
                className="inline-flex items-center gap-2 h-12 px-7 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:bg-sand-200 disabled:text-charcoal-400 text-white text-sm font-extrabold transition-colors"
              >
                {continuing ? 'Continuing…' : 'Continue'}
                {!continuing && <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {(!selOut || !selRet) && (
            <p className="mt-2 text-center text-[12px] font-semibold text-charcoal-400">
              Select one outbound and one return option to continue.
            </p>
          )}
        </>
      )}

      <AnimatePresence>
        {showGateAlert && (gateError || (gate && !gate.can_continue)) && (
          <BudgetGateAlert
            tripId={tripId}
            violations={gateError || gate?.violations || ['These selections exceed your budget.']}
            hints={[
              'Pick a lower-fare operator in either direction',
              'Choose a bus or train leg where the time works for you',
              'Add to your trip budget below — your picks stay selected',
            ]}
            stage="transport"
            remainingBudget={gate?.remaining_budget}
            onTopupComplete={() => void refreshGate()}
            onClose={() => { setShowGateAlert(false); setGateError(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
