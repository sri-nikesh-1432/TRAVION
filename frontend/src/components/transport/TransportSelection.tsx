import React, { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Plane, TrainFront, Bus, ArrowRight, BadgeCheck, AlertTriangle,
  Loader2, RefreshCw, ShieldCheck, CircleAlert, ExternalLink, Info,
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

type TransportTab = 'all' | 'train' | 'bus' | 'flight';

/**
 * Stage 3 — Transport. Outbound + return option cards, categorized by
 * mode (Trains, Buses, Flights) with booking redirection links, real airport
 * availability detection, and budget gate protection.
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

  // Active category tabs for Outbound and Return
  const [outboundTab, setOutboundTab] = useState<TransportTab>('all');
  const [returnTab, setReturnTab] = useState<TransportTab>('all');

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

  const hasOutboundFlights = outbound.some((o) => o.type === 'flight');
  const hasReturnFlights = back.some((o) => o.type === 'flight');

  const OptionCard: React.FC<{ opt: TransportOption; active: boolean; onPick: () => void }> = ({ opt, active, onPick }) => {
    const Icon = typeIcon(opt.type);

    const bookingLabel =
      opt.type === 'flight'
        ? 'Google Flights'
        : opt.type === 'train'
          ? 'ConfirmTkt / IRCTC'
          : 'RedBus';

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onPick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPick(); }}
        className={`w-full text-left p-4 rounded-2xl border-2 transition-all cursor-pointer relative ${
          active
            ? 'bg-travion-50 border-travion-500 ring-2 ring-travion-100 shadow-soft'
            : 'bg-white border-charcoal-200 hover:border-travion-300 hover:shadow-soft'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-2.5">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${active ? 'bg-travion-600 text-white' : 'bg-sand-100 text-charcoal-600'}`}>
              <Icon className="w-4.5 h-4.5" />
            </span>
            <div>
              <span className="block text-[13.5px] font-extrabold text-charcoal-900 leading-snug">{opt.operator}</span>
              <span className="block text-[10.5px] font-bold text-charcoal-400 uppercase tracking-wide">{opt.type}</span>
            </div>
          </span>

          <div className="flex items-center gap-1.5 shrink-0">
            {opt.service && (
              <span className="hidden sm:inline-flex items-center text-[10px] font-semibold text-charcoal-600 bg-sand-100/90 rounded-md px-2 py-0.5 max-w-[180px] truncate" title={opt.service}>
                {opt.service}
              </span>
            )}

            {opt.booking_url && (
              <a
                href={opt.booking_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`Book directly on ${bookingLabel}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-travion-50 hover:bg-travion-100 border border-travion-200 text-travion-700 text-[11px] font-extrabold transition-all shadow-xs"
              >
                <span>Book</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[13px] font-bold text-charcoal-800">
          <span className="font-mono text-sm">{opt.depart_time}</span>
          <span className="flex-1 h-px bg-charcoal-200 relative">
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-black text-charcoal-500 bg-white px-1.5 rounded">
              {fmtDuration(opt.duration_min)}
            </span>
          </span>
          <span className="font-mono text-sm">{opt.arrive_time}</span>
        </div>

        {opt.date && <p className="mt-1 text-[11px] font-semibold text-charcoal-400">{opt.date}</p>}

        <div className="mt-2.5 flex items-end justify-between gap-2">
          <span className="text-[11px] font-medium text-charcoal-500">
            {partySize && partySize > 1 ? `Total for ${partySize} travellers` : 'Scheduled service'}
          </span>
          <span className="text-right">
            <span className="block text-[15px] font-black text-charcoal-900">{inr(opt.party_total)}</span>
            <span className="block text-[10.5px] font-semibold text-charcoal-400">{inr(opt.price_per_person)} / person</span>
          </span>
        </div>

        {opt.note && <p className="mt-1.5 text-[11px] font-medium text-charcoal-400 line-clamp-2">{opt.note}</p>}
      </div>
    );
  };

  const DirectionSection: React.FC<{
    title: string;
    options: TransportOption[];
    selected: string | null;
    currentTab: TransportTab;
    onTabChange: (t: TransportTab) => void;
    hasFlights: boolean;
    onPick: (id: string) => void;
  }> = ({ title, options, selected, currentTab, onTabChange, hasFlights, onPick }) => {
    const trainsCount = options.filter((o) => o.type === 'train').length;
    const busesCount = options.filter((o) => o.type === 'bus').length;
    const flightsCount = options.filter((o) => o.type === 'flight').length;

    const filtered = options.filter((o) => {
      if (currentTab === 'all') return true;
      return o.type === currentTab;
    });

    return (
      <section className="bg-white rounded-3xl border border-charcoal-200/80 p-5 shadow-soft">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-charcoal-800">{title}</h3>
            <p className="text-[11.5px] text-charcoal-400 font-medium">Select one option for this leg</p>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-sand-100 rounded-xl overflow-x-auto">
            <button
              type="button"
              onClick={() => onTabChange('all')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                currentTab === 'all'
                  ? 'bg-white text-charcoal-900 shadow-sm'
                  : 'text-charcoal-500 hover:text-charcoal-700'
              }`}
            >
              All ({options.length})
            </button>
            <button
              type="button"
              onClick={() => onTabChange('train')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                currentTab === 'train'
                  ? 'bg-white text-charcoal-900 shadow-sm'
                  : 'text-charcoal-500 hover:text-charcoal-700'
              }`}
            >
              <TrainFront className="w-3.5 h-3.5" />
              <span>Trains ({trainsCount})</span>
            </button>
            <button
              type="button"
              onClick={() => onTabChange('bus')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                currentTab === 'bus'
                  ? 'bg-white text-charcoal-900 shadow-sm'
                  : 'text-charcoal-500 hover:text-charcoal-700'
              }`}
            >
              <Bus className="w-3.5 h-3.5" />
              <span>Buses ({busesCount})</span>
            </button>
            <button
              type="button"
              onClick={() => onTabChange('flight')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                currentTab === 'flight'
                  ? 'bg-white text-charcoal-900 shadow-sm'
                  : 'text-charcoal-500 hover:text-charcoal-700'
              }`}
            >
              <Plane className="w-3.5 h-3.5" />
              <span>Flights ({flightsCount})</span>
            </button>
          </div>
        </div>

        {/* Flight Unavailability Notice (when source or dest has no commercial airport) */}
        {!hasFlights && (
          <div className="mb-4 flex items-start gap-2.5 p-3 rounded-2xl bg-amber-50/70 border border-amber-200/80 text-amber-900">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-[12px] leading-relaxed">
              <span className="font-bold">Flight service is not available from the selected source for this journey.</span>
              <span className="text-amber-800 ml-1">
                No active commercial airport operates directly on this route. Real trains and luxury express buses are provided below.
              </span>
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-charcoal-300 bg-ivory-50 px-5 py-8 text-center">
            <p className="text-[13px] font-bold text-charcoal-600">
              {currentTab === 'flight' && !hasFlights
                ? 'Flight service is not available for this route.'
                : `No verified ${currentTab} options currently match.`}
            </p>
            <p className="mt-1 text-[12px] font-medium text-charcoal-400">
              Switch category tabs above or use the refresh button below.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3.5">
            {filtered.map((o) => (
              <OptionCard
                key={o.id}
                opt={o}
                active={selected === o.id}
                onPick={() => {
                  setGate(null);
                  onPick(o.id);
                }}
              />
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="text-center mb-7">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-travion-50 border border-travion-200 text-travion-700 text-xs font-black uppercase tracking-wider mb-2">
          Step 3 · Verified Transport
        </span>
        <h2 className="text-2xl sm:text-3xl font-black text-charcoal-900 tracking-tight">
          How will you get there and back?
        </h2>
        <p className="mt-1.5 text-[13.5px] font-medium text-charcoal-500 max-w-xl mx-auto">
          Explore all verified trains, buses, and flights on your travel date. Every option includes real schedules and direct booking access.
        </p>
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <Loader2 className="w-8 h-8 text-travion-600 animate-spin mx-auto mb-3" />
          <p className="text-sm font-bold text-charcoal-600">Checking verified rail, bus, and flight connections…</p>
        </div>
      ) : loadError ? (
        <div className="max-w-md mx-auto rounded-2xl bg-red-50 border border-red-100 p-6 text-center">
          <p className="text-[13px] font-bold text-red-600">{loadError}</p>
          <button
            type="button"
            onClick={() => void load(false)}
            className="mt-4 px-5 h-10 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-[12px] font-extrabold shadow-sm transition-colors"
          >
            Retry Connection Search
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-6">
            <DirectionSection
              title="Outbound — Getting to Destination"
              options={outbound}
              selected={selOut}
              currentTab={outboundTab}
              onTabChange={setOutboundTab}
              hasFlights={hasOutboundFlights}
              onPick={setSelOut}
            />
            <DirectionSection
              title="Return — Journey Back Home"
              options={back}
              selected={selRet}
              currentTab={returnTab}
              onTabChange={setReturnTab}
              hasFlights={hasReturnFlights}
              onPick={setSelRet}
            />
          </div>

          {gate && (
            <div className={`mt-6 rounded-2xl border px-4 py-3.5 flex items-start gap-2.5 ${gate.can_continue ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              {gate.can_continue
                ? <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                : <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />}
              <div>
                <p className={`text-[13px] font-extrabold ${gate.can_continue ? 'text-emerald-700' : 'text-red-700'}`}>
                  {gate.can_continue
                    ? `Fits your budget — ${inr(gate.remaining_budget)} remaining for stay & activities`
                    : 'Over budget — review your selections or top up below'}
                </p>
                {!gate.can_continue && gate.violations.length > 0 && (
                  <p className="text-[12px] font-medium text-red-600 mt-0.5">{gate.violations[0]}</p>
                )}
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-3xl bg-white border border-charcoal-200 shadow-floating px-6 py-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onBack}
                className="text-[13px] font-bold text-charcoal-500 hover:text-charcoal-700 px-3 py-2 rounded-xl hover:bg-sand-100 transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={regenerating}
                className="inline-flex items-center gap-1.5 text-[12px] font-bold text-travion-600 hover:text-travion-700 disabled:opacity-50 px-3 py-2 rounded-xl hover:bg-travion-50 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                {regenerating ? 'Refreshing…' : 'Refresh schedules'}
              </button>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              {selOut && selRet && (
                <button
                  type="button"
                  onClick={() => void confirmSelections()}
                  disabled={saving}
                  className="flex-1 sm:flex-initial h-12 px-5 rounded-2xl border border-travion-300 text-travion-700 text-sm font-extrabold hover:bg-travion-50 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save picks'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleContinue()}
                disabled={!selOut || !selRet || continuing || saving}
                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 h-12 px-7 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:bg-sand-200 disabled:text-charcoal-400 text-white text-sm font-extrabold transition-all shadow-soft"
              >
                {continuing ? 'Continuing…' : 'Continue to Explore'}
                {!continuing && <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {(!selOut || !selRet) && (
            <p className="mt-3 text-center text-[12px] font-semibold text-charcoal-400">
              Select one outbound and one return transport option to continue.
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
              'Pick a lower-fare train or bus operator in either direction',
              'Choose an alternate timing or cabin class',
              'Adjust your budget allocation below to match your journey needs',
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
