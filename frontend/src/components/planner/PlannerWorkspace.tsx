import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Sparkles, Plus, Clock, MapPin, Route, ShieldCheck, CheckCircle2,
  AlertTriangle, X, History, ArrowLeft, Loader2, Compass,
} from 'lucide-react';
import {
  TripItinerary, ItineraryDay, ItineraryStop,
  PlanChangeItem, PlaceSearchItem, OptimizeDayResponse, ConfirmPlanResponse,
} from '../../types';
import { api } from '../../services/api';
import { ItineraryEditor } from '../itinerary-editor/ItineraryEditor';
import { SplitView } from '../live-map/SplitView';

interface PlannerWorkspaceProps {
  tripId: string;
  itinerary: TripItinerary;
  budgetMax: number;
  onItineraryChange: (itinerary: TripItinerary, warnings: string[]) => void;
  onBackToPlans: () => void;
  onProceedToPayment: () => void;
}

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

const changeTypeLabel: Record<string, string> = {
  plan_selected: 'Plan selected',
  edit: 'Edited',
  optimized_day: 'Routing optimized',
  replan: 'Replanned',
};

export const PlannerWorkspace: React.FC<PlannerWorkspaceProps> = ({
  tripId, itinerary, budgetMax, onItineraryChange, onBackToPlans, onProceedToPayment,
}) => {
  const [changes, setChanges] = useState<PlanChangeItem[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSearchItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addDay, setAddDay] = useState<number>(itinerary.days[0]?.day || 1);
  const [addingBusy, setAddingBusy] = useState(false);
  const [optimizeFor, setOptimizeFor] = useState<number>(itinerary.days[0]?.day || 1);
  const [proposal, setProposal] = useState<OptimizeDayResponse | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<ConfirmPlanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [localWarnings, setLocalWarnings] = useState<string[]>([]);

  // Refresh the plan-change audit trail whenever a new version lands.
  useEffect(() => {
    api.planChanges(tripId).then(setChanges).catch(() => setChanges([]));
  }, [tripId, itinerary.version]);

  const daysWithStops = useMemo(
    () => [...itinerary.days].sort((a, b) => a.day - b.day),
    [itinerary.days],
  );

  const total = Number(itinerary.total_cost) || 0;
  const overBudget = budgetMax > 0 && total > budgetMax;

  const applyOptimized = async (apply: boolean) => {
    if (!proposal || busy) return;
    setBusy(true);
    try {
      if (apply) {
        const res = await api.optimizeDay(tripId, optimizeFor, true);
        if (res.applied) {
          onItineraryChange(
            { ...itinerary, version: res.version ?? itinerary.version, days: res.days, total_cost: res.total_cost, cost_breakdown: res.cost_breakdown },
            res.warnings || [],
          );
          setLocalWarnings(res.warnings || []);
        }
      }
      setProposal(null);
    } catch (err: any) {
      setLocalWarnings([err?.message || 'Could not optimize this day right now.']);
    } finally {
      setOptimizing(false);
      setBusy(false);
    }
  };

  const previewOptimize = async () => {
    if (busy) return;
    setOptimizing(true);
    setLocalWarnings([]);
    try {
      const res = await api.optimizeDay(tripId, optimizeFor, false);
      if (res.applied) {
        setProposal(res);
      } else {
        setLocalWarnings(res.warnings || ['This day has fewer than two places — there is nothing to re-route.']);
      }
    } catch (err: any) {
      setLocalWarnings([err?.message || 'Could not load an optimized route.']);
    } finally {
      setOptimizing(false);
    }
  };

  const runSearch = async (q: string) => {
    if (!q.trim()) { setResults(null); return; }
    setSearching(true);
    try {
      setResults(await api.searchTripPlaces(tripId, q.trim()));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const addPlace = async (place: PlaceSearchItem) => {
    if (addingBusy) return;
    setAddingBusy(true);
    setLocalWarnings([]);
    try {
      const day = itinerary.days.find((d) => d.day === addDay);
      const baseIndex = (day?.stops?.length || 0) === 0 ? 1 : (day?.stops?.length || 1);
      const suggestedTime = day && day.stops.length > 0
        ? nextFreeTime(day)
        : '10:00 AM';
      const res = await api.editItinerary(tripId, {
        kind: 'add',
        new_day: addDay,
        new_time: suggestedTime,
        new_index: baseIndex,
        stop: {
          name: place.name,
          title: place.name,
          category: stopCategoryFrom(place.category),
          description: place.description || '',
          lat: place.lat,
          lng: place.lng,
          estimated_cost: place.estimated_cost,
          entry_fee: place.estimated_cost,
          duration_minutes: place.duration_minutes,
          rating: place.rating ?? null,
          source: place.source,
          location_name: place.address || place.description || place.name,
        },
      });
      onItineraryChange(res.itinerary, res.warnings || []);
      setResults((prev) => (prev || []).filter((p) => p.name !== place.name));
    } catch (err: any) {
      setLocalWarnings([err?.message || 'Could not add that place.']);
    } finally {
      setAddingBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (busy) return;
    setConfirming(true);
    setLocalWarnings([]);
    try {
      const res = await api.confirmTrip(tripId);
      setConfirmResult(res);
      if (res.valid) {
        onProceedToPayment();
      }
    } catch (err: any) {
      setLocalWarnings([err?.message || 'Plan validation failed. Please try again.']);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step 5 header + Confirm to Payment */}
      <div className="p-5 rounded-3xl bg-white border border-slate-200/80 shadow-soft flex flex-col lg:flex-row lg:items-center justify-between gap-4"
        style={{ background: 'linear-gradient(120deg,#0f172a 0%,#1e3a5f 60%,#0f766e 130%)' }}>
        <div className="flex items-center gap-3 text-white">
          <span className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center">
            <Compass className="w-5 h-5" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-travion-200">Step 5 · Interactive Trip Planner</p>
            <h2 className="text-lg font-black tracking-tight text-white">Perfect your day-by-day plan before you pay</h2>
            <p className="text-[12px] font-medium text-slate-200/90 mt-0.5">
              Drag stops between days, add real places, optimize routing — every change is versioned and synced to your guide.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-black px-3 py-2 rounded-xl bg-white/10 text-slate-100">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            v{itinerary.version}
          </span>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming || busy}
            className="inline-flex items-center gap-2 px-5 h-11 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white text-[13px] font-black shadow-md transition-all disabled:opacity-60"
          >
            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Confirm &amp; Proceed to Payment
          </button>
        </div>
      </div>

      {/* Plan-change audit trail (version history) */}
      {changes.length > 0 && (
        <details className="rounded-2xl bg-white border border-slate-200/80 shadow-sm px-4 py-3">
          <summary className="flex items-center gap-2 text-[12.5px] font-extrabold text-slate-700 cursor-pointer select-none">
            <History className="w-4 h-4 text-travion-600" />
            Plan version history
            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-travion-50 text-travion-700">{changes.length}</span>
          </summary>
          <ul className="mt-3 space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {[...changes].reverse().map((c) => (
              <li key={`${c.version}-${c.created_at}`} className="flex items-start gap-2 text-[12px]">
                <span className="w-7 h-7 rounded-lg bg-travion-50 text-travion-700 text-[10px] font-black flex items-center justify-center shrink-0">
                  v{c.version}
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-slate-700">
                    {changeTypeLabel[c.change_type] || c.change_type}
                    <span className="ml-2 text-[10px] font-semibold text-slate-400">
                      {new Date(c.created_at).toLocaleString()}
                    </span>
                  </p>
                  <p className="text-slate-500 font-medium">{c.summary}</p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Inline warnings */}
      <AnimatePresence>
        {(localWarnings.length > 0 || overBudget) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-1.5"
          >
            {overBudget && (
              <div className="flex items-start gap-2 rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-[12.5px] font-bold text-red-700">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                This plan is {inr(total - budgetMax)} over your {inr(budgetMax)} budget — adjust it before payment.
              </div>
            )}
            {localWarnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3 text-[12.5px] font-semibold text-amber-700">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                {w}
                <button type="button" className="ml-auto text-amber-400 hover:text-amber-600" onClick={() => setLocalWarnings([])}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm validation result */}
      <AnimatePresence>
        {confirmResult && !confirmResult.valid && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl bg-orange-50 border border-orange-200 px-4 py-3"
          >
            <div className="flex items-center gap-2 text-[12.5px] font-black text-orange-700">
              <AlertTriangle className="w-4 h-4" />
              {confirmResult.message}
            </div>
            {confirmResult.missing.length > 0 && (
              <ul className="mt-2 space-y-1 text-[12px] font-semibold text-orange-600 list-disc list-inside">
                {confirmResult.missing.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action bar: optimize a day / add a place */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
          <Route className="w-4 h-4 text-travion-600 ml-2" />
          <select
            value={optimizeFor}
            onChange={(e) => setOptimizeFor(Number(e.target.value))}
            className="text-[12.5px] font-bold text-slate-700 bg-transparent outline-none cursor-pointer pr-1"
          >
            {daysWithStops.map((d) => (
              <option key={d.day} value={d.day}>
                Day {d.day} · {(d.stops || []).length} stops
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={optimizing || busy}
            onClick={previewOptimize}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-[11.5px] font-black disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Optimize My Day
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowSearch(true)}
          className="inline-flex items-center gap-1.5 h-11 px-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm text-slate-700 text-[12.5px] font-extrabold hover:border-travion-300"
        >
          <Plus className="w-4 h-4" />
          Add a Real Place
        </button>

        <button
          type="button"
          onClick={onBackToPlans}
          className="inline-flex items-center gap-1.5 h-11 px-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm text-slate-600 text-[12.5px] font-extrabold hover:border-slate-300"
        >
          <ArrowLeft className="w-4 h-4" />
          Choose a different plan
        </button>
      </div>

      {/* Drag & drop itinerary builder */}
      <ItineraryEditor
        tripId={tripId}
        itinerary={itinerary}
        budgetMax={budgetMax}
        onItineraryChange={onItineraryChange}
      />

      {/* Map + timeline — synced with the current itinerary */}
      <SplitView
        itinerary={itinerary}
        onStartNavigation={() => {}}
        tripStart={undefined}
        tripEnd={undefined}
        tripStatus="PLANNED"
        tripSource={''}
        tripDestination={''}
      />

      {/* Add Place search drawer */}
      <AnimatePresence>
        {showSearch && (
          <div className="fixed inset-0 z-50 flex justify-end bg-travion-900/30 backdrop-blur-sm" onClick={() => setShowSearch(false)}>
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.2 }}
              className="w-full max-w-md h-full bg-white shadow-floating overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-100 p-5 z-10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-travion-600" />
                    <h3 className="text-base font-extrabold text-slate-900">Add a real place</h3>
                  </div>
                  <button type="button" onClick={() => setShowSearch(false)} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') runSearch(query); }}
                    placeholder="Search verifying real places…"
                    className="flex-1 h-11 px-4 rounded-2xl border border-slate-200 bg-slate-50 text-[13px] font-semibold outline-none focus:border-travion-400 focus:bg-white"
                  />
                  <button
                    type="button"
                    disabled={searching}
                    onClick={() => runSearch(query)}
                    className="h-11 px-4 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-[12px] font-black disabled:opacity-50"
                  >
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[11px] font-bold text-slate-500">Add to</span>
                  <select
                    value={addDay}
                    onChange={(e) => setAddDay(Number(e.target.value))}
                    className="text-[12px] font-bold text-slate-700 bg-transparent outline-none cursor-pointer"
                  >
                    {daysWithStops.map((d) => (
                      <option key={d.day} value={d.day}>Day {d.day}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-5 space-y-3">
                {searching && (
                  <div className="py-10 text-center text-[13px] font-bold text-slate-400">Searching verified sources…</div>
                )}
                {!searching && results && results.length === 0 && (
                  <div className="py-10 text-center text-[13px] font-bold text-slate-400">
                    No other real places match “{query}” for this destination. Try a spot name, food place or activity.
                  </div>
                )}
                {(results || []).map((place) => (
                  <div key={place.name} className="p-4 rounded-2xl border border-slate-200 bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-extrabold text-slate-800">{place.name}</p>
                        <p className="text-[11px] font-medium text-slate-400 mt-0.5 line-clamp-2">
                          {place.description || place.address || place.category.replace('_', ' ')}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] font-bold text-slate-400">
                          <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">
                            {place.category.replace('_', ' ')}
                          </span>
                          {place.estimated_cost > 0 ? <span>{inr(place.estimated_cost)}</span> : <span>Free</span>}
                          {place.rating != null && <span>· ★ {Number(place.rating).toFixed(1)}</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={addingBusy}
                        onClick={() => addPlace(place)}
                        className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-travion-50 hover:bg-travion-100 text-travion-700 text-[11px] font-black uppercase tracking-wide transition-colors disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Add
                      </button>
                    </div>
                  </div>
                ))}
                {!searching && !results && (
                  <p className="text-center text-[11.5px] font-semibold text-slate-400 pt-6">
                    Only real places from verified sources are offered — nothing is invented.
                  </p>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Optimize My Day proposal modal */}
      <AnimatePresence>
        {proposal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-travion-900/45 backdrop-blur-sm" onClick={() => setProposal(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-lg bg-white rounded-3xl p-6 shadow-floating"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100 mb-4">
                <Route className="w-5 h-5 text-travion-600" />
                <h3 className="text-lg font-extrabold text-slate-900">Optimize Day {proposal.day}?</h3>
              </div>
              <p className="text-[13px] font-medium text-slate-600 leading-relaxed">
                Travion re-routed Day {proposal.day} so the places follow a real geographic line — less backtracking, more time at each spot.
                You can apply this or keep your current order.
              </p>
              <ol className="mt-4 space-y-1.5">
                {(proposal.days.find((d) => d.day === proposal.day)?.stops || []).map((s: ItineraryStop, i: number) => (
                  <li key={`${s.id}-${i}`} className="flex items-center gap-2.5 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[12.5px] font-bold text-slate-700">
                    <span className="w-6 h-6 rounded-lg bg-travion-100 text-travion-700 text-[10px] font-black flex items-center justify-center">{i + 1}</span>
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-slate-500">{s.time}</span>
                    <span className="truncate">{s.title}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={() => applyOptimized(false)}
                  className="flex-1 h-11 rounded-2xl border border-slate-200 text-slate-700 font-extrabold text-[13px] hover:border-slate-300"
                >
                  Keep My Plan
                </button>
                <button
                  type="button"
                  disabled={optimizing}
                  onClick={() => applyOptimized(true)}
                  className="flex-1 h-11 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-[13px] font-extrabold disabled:opacity-50"
                >
                  {optimizing ? 'Applying…' : 'Apply New Route'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* Suggest the next reasonable slot after the last stop of a day (rounded to the
   next 30 minutes, capped at 8:00 PM) — a real suggestion, never fabricated
   opening hours. */
function nextFreeTime(day: ItineraryDay): string {
  const stops = [...day.stops]
    .map((s) => parseTime(s.time))
    .filter((m): m is number => m !== null)
    .sort((a, b) => b - a);
  const last = stops[0];
  const start = last != null ? Math.min(last + 90, 20 * 60) : 10 * 60;
  const rounded = Math.ceil(start / 30) * 30;
  const h = Math.floor(rounded / 60), m = rounded % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

function parseTime(t: string): number | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(t || '').trim());
  if (!match) return null;
  let h = Number(match[1]) % 12;
  if (/PM/i.test(match[3])) h += 12;
  return h * 60 + Number(match[2]);
}

function stopCategoryFrom(category: string): ItineraryStop['category'] {
  const map: Record<string, ItineraryStop['category']> = {
    attraction: 'attraction',
    activities: 'attraction',
    activity: 'attraction',
    food: 'food',
    stay: 'stay',
    hotel: 'stay',
    transport: 'transport',
    shopping: 'attraction',
    hidden_gem: 'hidden_gem',
  };
  return map[category] || 'attraction';
}