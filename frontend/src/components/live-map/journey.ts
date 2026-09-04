// Journey timeline engine.
//
// Turns a persisted itinerary (days -> stops) into a live, stateful journey:
// every stop is UPCOMING -> ACTIVE -> COMPLETED based on the traveller's real
// clock (trip dates + stop times) and real GPS position. Guidance copy is
// derived per category from the actual stop data — never hardcoded per city and
// never pretending to know specifics (platforms, live fares) that are only
// confirmed live by the assistant.
import { TripItinerary, ItineraryStop } from '../../types';

export type StopState = 'completed' | 'active' | 'upcoming';

export interface JourneySnapshot {
  /** Day number that is "now" (calendar offset from trip start), clamped 1..N */
  todayDayNo: number | null;
  /** Trip not started yet (before start date) */
  notStarted: boolean;
  /** Trip finished (past end date) */
  finished: boolean;
  /** Stop id that should be treated as the current / next action, if any */
  currentStopId: string | null;
  stateOf: (stop: ItineraryStop) => StopState;
  /** Fraction of all stops completed (0..1) for the overall progress rail */
  progress: number;
}

const MS_DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Parse "06:30 AM" / "6:30 PM" / "18:30" into minutes since midnight. */
export function parseClock(time: string | undefined | null): number | null {
  if (!time) return null;
  const t = time.trim();
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

/** Haversine distance in km between two coordinates. */
export function distanceKm(
  aLat: number | null | undefined,
  aLng: number | null | undefined,
  bLat: number | null | undefined,
  bLng: number | null | undefined
): number | null {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null;
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function fmtDistance(km: number | null): string | null {
  if (km == null) return null;
  if (km < 0.12) return null; // effectively "you're here"
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function calendarDayOffset(startISO: string | undefined, now: Date): number | null {
  if (!startISO) return null;
  const start = new Date(startISO);
  if (isNaN(start.getTime())) return null;
  return Math.round((startOfDay(now) - startOfDay(start)) / MS_DAY);
}

export function buildJourneySnapshot(
  itinerary: TripItinerary,
  tripStart: string | undefined,
  tripEnd: string | undefined,
  now: Date = new Date()
): JourneySnapshot {
  const days = itinerary.days || [];
  const all = days.flatMap((d) => d.stops || []);
  const start = tripStart ? new Date(tripStart) : null;
  const end = tripEnd ? new Date(tripEnd) : null;

  const notStarted = !!start && !isNaN(start.getTime()) && startOfDay(now) < startOfDay(start);
  const finished =
    !notStarted && !!end && !isNaN(end.getTime()) && startOfDay(now) > startOfDay(end) + MS_DAY;

  const offset = start ? calendarDayOffset(tripStart, now) : null;
  // Day numbers in the plan start at 1.
  let todayDayNo: number | null = null;
  if (!notStarted && !finished && offset != null && days.length > 0) {
    todayDayNo = Math.min(Math.max(offset + 1, 1), days.length);
  } else if (notStarted && days.length > 0) {
    todayDayNo = 1;
  } else if (finished && days.length > 0) {
    todayDayNo = days.length;
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const byId = new Map<string, ItineraryStop>();
  all.forEach((s) => byId.set(s.id, s));
  let currentStopId: string | null = null;

  const stateOf = (stop: ItineraryStop): StopState => {
    if (finished || (todayDayNo == null && !notStarted)) return 'completed';
    if (notStarted) return 'upcoming';
    if (todayDayNo == null) return 'upcoming';
    if (stop.day < todayDayNo) return 'completed';
    if (stop.day > todayDayNo) return 'upcoming';

    const stopMin = parseClock(stop.time);
    if (stopMin == null) return 'upcoming';
    const endMin = stopMin + Math.max(stop.duration_minutes || 0, 0);
    if (endMin < nowMin) return 'completed';
    // First stop whose window covers "now" (or is the next one coming up) is active.
    return 'active';
  };

  // Current stop: earliest stop on today's day that is not completed; if the
  // whole day is done and a later day exists, lead with its first stop.
  if (!notStarted && !finished && todayDayNo != null) {
    const today = days.find((d) => d.day === todayDayNo);
    const rest = today ? today.stops || [] : [];
    const nextToday = rest.find((s) => stateOf(s) === 'active');
    if (nextToday) currentStopId = nextToday.id;
    else {
      const later = days.find((d) => d.day === todayDayNo + 1);
      if (later && (later.stops || []).length > 0) currentStopId = later.stops[0].id;
    }
  } else if (notStarted && days.length > 0 && (days[0].stops || []).length > 0) {
    currentStopId = days[0].stops[0].id;
  }

  const completedCount = all.filter((s) => stateOf(s) === 'completed').length;
  return {
    todayDayNo,
    notStarted,
    finished,
    currentStopId,
    stateOf,
    progress: all.length > 0 ? completedCount / all.length : 0,
  };
}

export const STATE_META: Record<StopState, { label: string; dot: string; text: string; ring: string }> = {
  completed: {
    label: 'Completed',
    dot: 'bg-emerald-500 border-emerald-500 text-white',
    text: 'text-emerald-600',
    ring: 'border-emerald-200 bg-emerald-50/60',
  },
  active: {
    label: 'Now',
    dot: 'bg-travion-600 border-travion-600 text-white',
    text: 'text-travion-700',
    ring: 'border-travion-300 bg-travion-50/80 ring-2 ring-travion-100',
  },
  upcoming: {
    label: 'Upcoming',
    dot: 'bg-white border-slate-300 text-slate-400',
    text: 'text-slate-400',
    ring: 'border-slate-200/80 bg-white',
  },
};

/**
 * One-line "what do I actually do at this stop" guidance, derived from the real
 * stop record. Specifics that only become available live (exact platform, live
 * fare, booking state) are never invented here — they say so.
 */
export function actionForStop(stop: ItineraryStop, tripDestination: string | undefined): string {
  const where = stop.location_name && stop.location_name.trim() ? stop.location_name.trim() : 'the listed point';
  switch (stop.category) {
    case 'transport': {
      const td = stop.transport_details as { type?: string } | undefined;
      const via = td?.type ? `${td.type} — ` : '';
      if (stop.id.startsWith('est-') || (stop.source !== 'verified_api' && stop.title.toLowerCase().includes('return'))) {
        return `Get ready to board ${via}this leg from ${where}. Live departure point and schedule are confirmed by your trip assistant before travel.`;
      }
      return `Board ${via}from ${where}. Live platform/gate and booking reference are confirmed by your trip assistant.`;
    }
    case 'stay':
      return `Arrive at ${where} and complete check-in around ${stop.time}. Keep your booking reference ready — confirmation is handled by your assistant.`;
    case 'food':
      return `Dine near ${where}. Venue and timing are shortlisted against your dietary and budget preferences live — never assumed.`;
    case 'attraction':
      return `Visit ${stop.title} at ${where} around ${stop.time}. Opening hours and entry are confirmed live before you head out.`;
    case 'hidden_gem':
      return `Local discovery near ${where} — fits your interests. Reachable on foot or a short hop; details confirmed live.`;
    case 'safety':
    case 'emergency': {
      const helpline = stop.emergency_contact ? ` Helpline: ${stop.emergency_contact}.` : '';
      return `Review and save this briefing${helpline} Numbers below are national emergency lines — regional numbers are confirmed on arrival.`;
    }
    default:
      return `Be at ${where} around ${stop.time}. Live details are confirmed by your trip assistant.`;
  }
}

export function categoryIconLabel(stop: ItineraryStop): string {
  switch (stop.category) {
    case 'transport':
      return 'Transport';
    case 'stay':
      return 'Stay';
    case 'food':
      return 'Dining';
    case 'attraction':
      return 'Attraction';
    case 'hidden_gem':
      return 'Local discovery';
    case 'safety':
      return 'Safety';
    case 'emergency':
      return 'Emergency';
    default:
      return 'Stop';
  }
}

export function costLabel(cost: number): string {
  if (!cost || cost <= 0) return 'Included';
  return `₹${Math.round(cost).toLocaleString('en-IN')}`;
}
