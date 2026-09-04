import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronDown, Navigation, MapPin, LocateFixed, TrainFront, BedDouble,
  Utensils, Landmark, Gem, ShieldAlert, PhoneCall, CalendarDays, Route as RouteIcon,
  Sparkles
} from 'lucide-react';
import { TripItinerary, ItineraryStop } from '../../types';
import {
  buildJourneySnapshot, distanceKm, fmtDistance, actionForStop, STATE_META,
  costLabel, categoryIconLabel, parseClock, JourneySnapshot,
} from './journey';

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  transport: <TrainFront className="w-4 h-4" />,
  stay: <BedDouble className="w-4 h-4" />,
  food: <Utensils className="w-4 h-4" />,
  attraction: <Landmark className="w-4 h-4" />,
  hidden_gem: <Gem className="w-4 h-4" />,
  safety: <ShieldAlert className="w-4 h-4" />,
  emergency: <PhoneCall className="w-4 h-4" />,
};

export interface JourneyTimelineProps {
  itinerary: TripItinerary;
  onStartNavigation: (stop: ItineraryStop) => void;
  avatarPosition?: [number, number] | null;
  tripStart?: string;
  tripEnd?: string;
  tripStatus?: string;
  tripSource?: string;
  tripDestination?: string;
  selectedStop?: ItineraryStop | null;
  onSelectStop?: (stop: ItineraryStop) => void;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Trip live',
  PAID: 'Paid · starting soon',
  GUIDE_ASSIGNED: 'Guide assigned',
  REQUESTED: 'Guide request pending',
  PLANNED: 'Planned',
  COMPLETED: 'Completed',
};

function friendlyDayDate(tripStart: string | undefined, dayNo: number): string {
  if (!tripStart) return `Day ${dayNo}`;
  const base = new Date(tripStart);
  if (isNaN(base.getTime())) return `Day ${dayNo}`;
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + (dayNo - 1));
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
  return `Day ${dayNo} · ${d.toLocaleDateString('en-IN', opts)}`;
}

export const JourneyTimeline: React.FC<JourneyTimelineProps> = ({
  itinerary, onStartNavigation, avatarPosition = null, tripStart, tripEnd,
  tripStatus, tripSource, tripDestination, selectedStop = null, onSelectStop,
}) => {
  const [activeDay, setActiveDay] = useState<number>(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);

  // Re-derive states on a gentle clock tick so a live trip advances on its own.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const snapshot: JourneySnapshot = useMemo(
    () => buildJourneySnapshot(itinerary, tripStart, tripEnd),
    [itinerary, tripStart, tripEnd]
  );

  const allStops = useMemo(() => itinerary.days.flatMap((d) => d.stops), [itinerary]);
  const byId = useMemo(() => {
    const m = new Map<string, ItineraryStop>();
    allStops.forEach((s) => m.set(s.id, s));
    return m;
  }, [allStops]);

  // Follow the journey: switch the visible day to "today" and keep the current
  // stop in view while the trip is live.
  useEffect(() => {
    if (snapshot.todayDayNo != null) setActiveDay(snapshot.todayDayNo);
  }, [snapshot.todayDayNo]);

  const currentStop = snapshot.currentStopId ? byId.get(snapshot.currentStopId) || null : null;

  useEffect(() => {
    if (!currentStop) return;
    const el = document.getElementById(`journey-stop-${currentStop.id}`);
    if (el && snapshot.todayDayNo === currentStop.day) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.currentStopId, activeDay]);

  const day = itinerary.days.find((d) => d.day === activeDay);
  const dayStops = day?.stops || [];
  const doneInDay = dayStops.filter((s) => snapshot.stateOf(s) === 'completed').length;
  const gpsLive = !!avatarPosition;

  const handleSelect = (stop: ItineraryStop) => {
    onSelectStop?.(stop);
    setExpandedId((id) => (id === stop.id ? null : stop.id));
  };

  const navTo = (stop: ItineraryStop) => {
    onStartNavigation(stop);
  };

  return (
    <div className="flex flex-col h-full bg-white/80 backdrop-blur-xl rounded-3xl border border-slate-200/70 shadow-soft overflow-hidden">
      {/* Header: route + live status + progress */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-100 bg-gradient-to-b from-white to-slate-50/60">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 shrink-0 rounded-xl bg-travion-600/10 text-travion-700 flex items-center justify-center">
              <RouteIcon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-extrabold text-slate-900 truncate">
                {tripSource || itinerary.trip_id.slice(0, 8)} <span className="text-slate-300 mx-0.5">→</span> {tripDestination || 'Destination'}
              </p>
              <p className="text-[11px] font-semibold text-slate-400">
                {STATUS_LABEL[tripStatus || ''] || tripStatus || 'Journey'}
                {snapshot.notStarted && tripStart ? ` · Starts ${new Date(tripStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
              </p>
            </div>
          </div>

          <div className={`flex items-center gap-1.5 shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold border ${
            gpsLive ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-100 border-slate-200 text-slate-500'
          }`}>
            <span className="relative flex w-1.5 h-1.5">
              {gpsLive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />}
              <span className={`relative inline-flex rounded-full w-1.5 h-1.5 ${gpsLive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            </span>
            {gpsLive ? 'Live GPS · resolved' : 'Live location unavailable'}
          </div>
        </div>

        {/* Overall progress rail */}
        <div className="mt-3 flex items-center gap-2.5">
          <div className="flex-1 h-1.5 rounded-full bg-slate-200/80 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-travion-500 to-sky-500"
              initial={false}
              animate={{ width: `${Math.max(4, Math.round(snapshot.progress * 100))}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
          <span className="text-[10px] font-extrabold text-slate-500 tabular-nums">
            {Math.round(snapshot.progress * 100)}% complete
          </span>
        </div>

        {/* Day tabs */}
        <div className="mt-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {itinerary.days.map((d) => {
            const isToday = snapshot.todayDayNo === d.day && !snapshot.notStarted && !snapshot.finished;
            const allDone = (d.stops || []).every((s) => snapshot.stateOf(s) === 'completed');
            return (
              <button
                key={d.day}
                type="button"
                onClick={() => setActiveDay(d.day)}
                className={`relative px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all shrink-0 border ${
                  activeDay === d.day
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                }`}
              >
                {isToday && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-travion-500 ring-2 ring-white" />}
                {allDone && d.day !== activeDay && <Check className="w-3 h-3 inline -mt-0.5 mr-1 text-emerald-500" />}
                Day {d.day}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pre-trip notice */}
      <AnimatePresence>
        {snapshot.notStarted && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mx-4 mt-3 rounded-2xl border border-sky-100 bg-sky-50/80 px-3.5 py-2.5 flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-sky-500 mt-0.5 shrink-0" />
              <p className="text-[11.5px] font-semibold text-sky-800 leading-relaxed">
                Journey starts {tripStart ? new Date(tripStart).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}.
                Live GPS tracking and step states switch on automatically when the trip goes live.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Day heading */}
      <div className="px-5 pt-4 pb-1 flex items-baseline justify-between">
        <h3 className="text-sm font-extrabold text-slate-900">{friendlyDayDate(tripStart, activeDay)}</h3>
        <span className="text-[11px] font-bold text-slate-400 tabular-nums">
          {doneInDay}/{dayStops.length} done
        </span>
      </div>

      {/* The journey rail */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-5">
        {dayStops.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs font-semibold text-slate-400">
            No steps planned for this day.
          </div>
        ) : (
          <ol className="relative">
            {dayStops.map((stop, idx) => {
              const state = snapshot.stateOf(stop);
              const meta = STATE_META[state];
              const isCurrent = currentStop?.id === stop.id && state !== 'completed';
              const dist = distanceKm(
                avatarPosition?.[0], avatarPosition?.[1], stop.lat, stop.lng
              );
              const distTxt = fmtDistance(dist);
              const isHere = gpsLive && dist != null && dist < 0.12 && state !== 'completed';
              const expanded = expandedId === stop.id || isCurrent;
              const selected = selectedStop?.id === stop.id;
              const Icon = CATEGORY_ICON[stop.category] || <MapPin className="w-4 h-4" />;
              const isLast = idx === dayStops.length - 1;
              const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
              const stopStart = parseClock(stop.time);
              const stopStarted = stopStart != null && stopStart <= nowMin;

              return (
                <li key={stop.id} id={`journey-stop-${stop.id}`} className="relative flex gap-3 pb-1.5">
                  {/* Rail + marker */}
                  <div className="flex flex-col items-center shrink-0">
                    <button
                      type="button"
                      aria-label={`Step ${idx + 1}: ${stop.title} (${meta.label.toLowerCase()})`}
                      onClick={() => handleSelect(stop)}
                      className={`relative z-10 w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${
                        state === 'completed'
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : state === 'active'
                            ? 'bg-travion-600 border-travion-600 text-white shadow-md shadow-travion-600/25'
                            : 'bg-white border-slate-300 text-slate-400 hover:border-travion-400'
                      }`}
                    >
                      {state === 'completed' ? (
                        <Check className="w-4 h-4" strokeWidth={3} />
                      ) : (
                        <span className={state === 'active' ? 'animate-pulse' : ''}>{Icon}</span>
                      )}
                      {state === 'active' && !isCurrent && (
                        <span className="absolute inset-0 rounded-full animate-ping bg-travion-500/20 -z-10" />
                      )}
                    </button>
                    {!isLast && (
                      <span className={`w-0.5 flex-1 min-h-6 my-0.5 rounded-full ${state === 'completed' ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                    )}
                  </div>

                  {/* Step body */}
                  <motion.div
                    layout
                    onClick={() => handleSelect(stop)}                      className={`group flex-1 min-w-0 mb-2 rounded-2xl border px-3.5 py-3 cursor-pointer transition-all ${
                      selected || expanded
                        ? 'border-slate-200 bg-white shadow-[0_2px_16px_-6px_rgba(15,23,42,0.14)]'
                        : state === 'completed'
                          ? 'border-transparent bg-transparent opacity-70'
                          : 'border-slate-200/70 bg-white/60 hover:bg-white'
                    } ${isCurrent ? 'ring-2 ring-travion-200 ring-offset-1 ring-offset-slate-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] font-extrabold uppercase tracking-wider ${meta.text}`}>
                            {categoryIconLabel(stop)}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5">
                            {stop.time}
                          </span>
                          {isHere ? (
                            <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-100 rounded-md px-1.5 py-0.5 inline-flex items-center gap-1">
                              <LocateFixed className="w-3 h-3" /> You're here
                            </span>
                          ) : distTxt ? (
                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-md px-1.5 py-0.5 inline-flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-travion-500" /> {distTxt} away
                            </span>
                          ) : null}
                        </div>
                        <h4 className={`mt-1 text-[13.5px] font-extrabold leading-snug ${
                          state === 'completed' ? 'text-slate-400' : 'text-slate-900'
                        }`}>
                          {stop.title}
                        </h4>
                        <p className="mt-0.5 text-[11px] font-semibold text-slate-400 truncate">
                          {stop.location_name}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`text-[11px] font-extrabold tabular-nums ${state === 'completed' ? 'text-slate-300' : 'text-slate-600'}`}>
                          {costLabel(stop.estimated_cost)}
                        </span>
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-slate-300 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        />
                      </div>
                    </div>

                    {/* Expanded / current: what to do now + details */}
                    <AnimatePresence initial={false}>
                      {(expanded || isCurrent) && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: 'easeInOut' }}
                          className="overflow-hidden"
                        >
                          <div className={`mt-2.5 pt-2.5 border-t ${state === 'completed' ? 'border-slate-100' : 'border-slate-100'}`}>
                            {state !== 'completed' && (
                              <p className="text-[11.5px] font-semibold text-slate-700 leading-relaxed">
                                <span className="font-extrabold text-travion-700 uppercase tracking-wide text-[10px]">
                                  {isCurrent ? (state === 'active' && stopStarted ? 'In progress · ' : 'Next action · ') : 'Action · '}
                                </span>
                                {actionForStop(stop, tripDestination)}
                              </p>
                            )}
                            {stop.description && (
                              <p className={`mt-1.5 text-[11px] leading-relaxed ${state === 'completed' ? 'text-slate-400' : 'text-slate-500'}`}>
                                {stop.description}
                              </p>
                            )}
                            {stop.ai_note && (
                              <p className="mt-1 text-[10.5px] font-semibold text-sky-600/80 italic">Note: {stop.ai_note}</p>
                            )}
                            {stop.emergency_contact && (
                              <p className="mt-1 text-[10.5px] font-bold text-rose-600">Helpline: {stop.emergency_contact}</p>
                            )}
                            {stop.duration_minutes ? (
                              <p className="mt-1.5 text-[10.5px] font-bold text-slate-400">
                                ≈ {stop.duration_minutes} min {stop.category === 'transport' ? 'journey' : 'at this step'}
                              </p>
                            ) : null}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Footer actions */}
                    <div className={`flex items-center justify-between mt-2 ${expanded || isCurrent ? '' : 'opacity-0 group-hover:opacity-100'}`}>
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-300">
                        Step {String(idx + 1).padStart(2, '0')} · {meta.label}
                      </span>
                      <div className="flex items-center gap-1">
                        {stop.lat && stop.lng ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); navTo(stop); }}
                            className="inline-flex items-center gap-1 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-[10.5px] font-extrabold px-2.5 py-1.5 transition-colors shadow-sm"
                          >
                            <Navigation className="w-3 h-3" /> Navigate
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </motion.div>
                </li>
              );
            })}
          </ol>
        )}

        {/* Day capstone */}
        <div className="mt-1 ml-11 flex items-center gap-2 text-[11px] font-bold text-slate-400">
          <span className={`h-1.5 w-1.5 rounded-full ${doneInDay === dayStops.length && dayStops.length > 0 ? 'bg-emerald-400' : 'bg-slate-200'}`} />
          {doneInDay === dayStops.length && dayStops.length > 0
            ? `Day ${activeDay} complete${activeDay < itinerary.days.length ? ' — next day starts fresh on the map' : ' — journey complete'}.`
            : activeDay < itinerary.days.length
              ? `Continue to Day ${activeDay + 1}`
              : 'End of journey plan'}
        </div>
      </div>
    </div>
  );
};
