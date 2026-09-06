import React, { useState, useRef } from 'react';
import {
  GripVertical, Trash2, Plus, CalendarDays, Clock, Sparkles, X, Check, Compass,
} from 'lucide-react';
import { TripItinerary, ItineraryDay, ExplorePlace } from '../../types';
import { api } from '../../services/api';

interface ItineraryEditorProps {
  tripId: string;
  itinerary: TripItinerary;
  budgetMax: number;
  onItineraryChange: (itinerary: TripItinerary, warnings: string[]) => void;
}

const CATEGORY_STYLES: Record<string, string> = {
  transport: 'bg-sky-100 text-sky-700',
  stay: 'bg-violet-100 text-violet-700',
  food: 'bg-orange-100 text-orange-700',
  attraction: 'bg-emerald-100 text-emerald-700',
  hidden_gem: 'bg-teal-100 text-teal-700',
};

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

export const ItineraryEditor: React.FC<ItineraryEditorProps> = ({
  tripId, itinerary, budgetMax, onItineraryChange,
}) => {
  const [dragStopId, setDragStopId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showExplore, setShowExplore] = useState(false);
  const [exploreItems, setExploreItems] = useState<ExplorePlace[] | null>(null);
  const [exploreLoading, setExploreLoading] = useState(false);
  const dragCounter = useRef(0);

  const remaining = budgetMax - itinerary.total_cost;

  const applyChange = async (change: any) => {
    if (busy) return;
    setBusy(true);
    setWarnings([]);
    try {
      const res = await api.editItinerary(tripId, change);
      onItineraryChange(res.itinerary, res.warnings || []);
      setWarnings(res.warnings || []);
    } catch (err: any) {
      const detail = err?.message || 'Could not apply the change. Please try again.';
      setWarnings([detail]);
    } finally {
      setBusy(false);
    }
  };

  /* ── Drag & drop ── */
  const handleDrop = (targetDay: number, targetIndex?: number) => {
    if (!dragStopId) return;
    const stop = findStop(dragStopId);
    const currentDay = stop?.day;
    setDragStopId(null);
    setDragOverDay(null);
    dragCounter.current = 0;
    if (!stop) return;
    if (currentDay === targetDay && targetIndex === undefined) return;
    void applyChange({
      kind: currentDay === targetDay ? 'reorder' : 'move_day',
      stop_id: dragStopId,
      new_day: targetDay,
      ...(targetIndex !== undefined ? { new_index: targetIndex } : {}),
    });
  };

  const findStop = (stopId: string) => {
    for (const d of itinerary.days) {
      const s = (d.stops || []).find((st) => st.id === stopId);
      if (s) return s;
    }
    return null;
  };

  /* ── Explore more ── */
  const openExplore = async () => {
    setShowExplore(true);
    if (!exploreItems) {
      setExploreLoading(true);
      try {
        const items = await api.exploreMore(tripId);
        setExploreItems(items);
      } catch {
        setExploreItems([]);
      } finally {
        setExploreLoading(false);
      }
    }
  };

  const addPlace = (place: ExplorePlace) => {
    void applyChange({ kind: 'add', stop: { ...place, day: itinerary.days[0]?.day || 1 } });
    setShowExplore(false);
  };

  const days: ItineraryDay[] = [...itinerary.days].sort((a, b) => a.day - b.day);

  return (
    <div className="relative">
      {/* Budget bar */}
      <div className="mb-5 p-4 rounded-3xl bg-white border border-slate-200/80 shadow-soft flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Itinerary budget</p>
          <p className="text-lg font-extrabold text-slate-900">
            {inr(itinerary.total_cost)}{' '}
            <span className={`text-[13px] font-bold ${remaining >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              · {remaining >= 0 ? `${inr(remaining)} left` : `${inr(-remaining)} over`}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-400 hidden sm:inline">Drag cards between days · v{itinerary.version}</span>
          <button
            type="button"
            onClick={openExplore}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-xs font-extrabold transition-colors"
          >
            <Plus className="w-4 h-4" />
            Explore more
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-2.5 text-[12px] font-semibold text-amber-700">
              <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Day columns */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {days.map((day) => (
          <div
            key={day.day}
            onDragOver={(e) => { e.preventDefault(); setDragOverDay(day.day); }}
            onDragEnter={() => { dragCounter.current += 1; setDragOverDay(day.day); }}
            onDragLeave={() => {
              dragCounter.current -= 1;
              if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOverDay(null); }
            }}
            onDrop={(e) => { e.preventDefault(); handleDrop(day.day); }}
            className={`rounded-3xl border p-4 transition-colors ${
              dragOverDay === day.day
                ? 'border-travion-400 bg-travion-50/60'
                : 'border-slate-200/80 bg-white/60'
            } ${busy ? 'opacity-60 pointer-events-none' : ''}`}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-xl bg-travion-600 text-white text-[12px] font-black flex items-center justify-center">
                {day.day}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-extrabold text-slate-900 truncate">Day {day.day}</p>
                <p className="text-[11px] font-semibold text-slate-400 truncate">{day.title}</p>
              </div>
            </div>

            <div className="space-y-2">
              {(day.stops || []).map((stop) => (
                <div
                  key={stop.id}
                  draggable
                  onDragStart={() => setDragStopId(stop.id)}
                  onDragEnd={() => { setDragStopId(null); setDragOverDay(null); dragCounter.current = 0; }}
                  className={`group p-3 rounded-2xl bg-white border shadow-sm transition-all ${
                    dragStopId === stop.id ? 'opacity-40 border-travion-300' : 'border-slate-200 hover:border-travion-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <GripVertical className="w-4 h-4 text-slate-300 group-hover:text-travion-500 mt-0.5 shrink-0 cursor-grab" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-black text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />{stop.time}
                        </span>
                        <span className={`text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-md ${CATEGORY_STYLES[stop.category] || 'bg-slate-100 text-slate-600'}`}>
                          {stop.category.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-[13px] font-extrabold text-slate-800 mt-0.5 leading-snug">{stop.title}</p>
                      <p className="text-[11px] font-medium text-slate-400 truncate">{stop.location_name}</p>
                      <div className="flex items-center gap-2 mt-1 text-[10px] font-bold text-slate-400">
                        {stop.estimated_cost > 0 && <span>{inr(stop.estimated_cost)}</span>}
                        {stop.duration_minutes > 0 && <span>· {Math.round(stop.duration_minutes / 60 * 10) / 10}h</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${stop.title}`}
                      onClick={() => void applyChange({ kind: 'remove', stop_id: stop.id })}
                      className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {(day.stops || []).length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-[11px] font-semibold text-slate-400">
                  Drag stops here or add from Explore more
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Explore More drawer */}
      {showExplore && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowExplore(false)}>
          <div className="w-full max-w-md h-full bg-white shadow-floating overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-100 p-5 flex items-center justify-between z-10">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <Compass className="w-4 h-4 text-travion-600" />
                  Explore more places
                </h3>
                <p className="text-[11px] font-semibold text-slate-400 mt-0.5">Verified spots you haven't added yet — tap ADD TO TRIP</p>
              </div>
              <button type="button" onClick={() => setShowExplore(false)} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              {exploreLoading && (
                <div className="py-10 text-center text-[13px] font-bold text-slate-400">Finding verified places…</div>
              )}
              {!exploreLoading && (exploreItems || []).length === 0 && (
                <div className="py-10 text-center text-[13px] font-bold text-slate-400">
                  You've added every verified place for this destination. 🎉
                </div>
              )}
              {(exploreItems || []).map((place) => (
                <div key={place.name} className="p-4 rounded-2xl border border-slate-200 bg-white">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-extrabold text-slate-800">{place.name}</p>
                      <p className="text-[11px] font-medium text-slate-400 mt-0.5 line-clamp-2">{place.description}</p>
                      <div className="flex items-center gap-2 mt-1.5 text-[10px] font-bold text-slate-400">
                        <span className={`px-1.5 py-0.5 rounded-md ${CATEGORY_STYLES[place.category] || 'bg-slate-100 text-slate-600'}`}>
                          {place.category.replace('_', ' ')}
                        </span>
                        {place.entry_fee > 0 ? <span>{inr(place.entry_fee)}</span> : <span>Free</span>}
                        <span>· ★ {place.rating?.toFixed(1) || '4.6'}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => addPlace(place)}
                      className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-travion-50 hover:bg-travion-100 text-travion-700 text-[11px] font-black uppercase tracking-wide transition-colors disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Add
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
