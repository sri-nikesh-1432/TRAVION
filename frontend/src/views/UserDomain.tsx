import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass, Sparkles, Navigation, ShieldCheck,
  MessageSquare, Download, RefreshCw, CheckCircle2,
  LogOut, ArrowLeft, Star, Clock, AlertCircle,
  Mountain, Lock, BadgeCheck, Check, Crosshair, Ban, ArrowRight
} from 'lucide-react';
import {
  AuthSession, LocationItem, TripItem, TripItinerary,
  ItineraryStop, UserProfile, BudgetRecovery,
  SelectedPlaceItem, SelectedFoodItem, SelectedStay, StageState
} from '../types';
import { api, ApiError } from '../services/api';
import { TripSearchBar } from '../components/search-bar/TripSearchBar';
import { TravionLogo } from '../components/ui';
import { DiscoveryCard } from '../components/trip-discovery/DiscoveryCard';
import { BrandedLoader } from '../components/loading/BrandedLoader';
import { SplitView } from '../components/live-map/SplitView';
import { MagnificationDock, DockItemData } from '../components/dock/MagnificationDock';
import { LiveNavigationMode } from '../components/navigation/LiveNavigationMode';
import { ReplanningNotice } from '../components/replanning/ReplanningNotice';
import { TripChatDrawer } from '../components/chat/TripChatDrawer';
import { OfflineManager } from '../components/offline/OfflineManager';
import { ReviewModal } from '../components/review/ReviewModal';
import { FinalReviewStep, ReviewEditTarget } from '../components/review/FinalReviewStep';
import { BasicProfileSheet } from '../components/profile/BasicProfileSheet';
import { ItineraryEditor } from '../components/itinerary-editor/ItineraryEditor';
import { DiscoverySelect } from '../components/discovery-select/DiscoverySelect';
import { PlannerWorkspace } from '../components/planner/PlannerWorkspace';
import { ModeSelectionScreen, TripMode } from '../components/mode-selection/ModeSelectionModal';
import { TransportSelection } from '../components/transport/TransportSelection';
import { LocalTransportPlanner } from '../components/local-transport/LocalTransportPlanner';
import { BudgetFoodPlan } from '../components/budget/BudgetFoodPlan';
import { StaySelection } from '../components/stay/StaySelection';
import { PaymentStep } from '../components/payment/PaymentStep';
import { GodsEyeViewModal } from '../components/navigation/GodsEyeViewModal';
import { TripCancellationModal } from '../components/user/TripCancellationModal';
import { ProgressReviewModal } from '../components/user/ProgressReviewModal';
import { resolveBudgetMax } from '../utils/budget';

/* ─── Booking flow stepper: the visible 11-stage journey ────────────
   Stages 1–3 choose basic constraints (trip, travellers, transport);
   stage 4 is Explore (places & attractions in destination);
   stage 5 is Stay (dedicated hotel / accommodation booking);
   stage 6 is the dedicated Guide-vs-Adventurous EXPERIENCE decision;
   stages 7–8 lock local transport + budget/food;
   stage 9 generates the itinerary directly from saved state;
   stages 10–11 are Final Review and Payment.
   ORDER: Trip → Travellers → Transport → Explore → Stay → Mode → Local → Budget →
   Itinerary → Review → Payment. */
const BOOKING_STEPS = [
  { key: 'search', label: 'Trip' },
  { key: 'discovery', label: 'Travellers' },
  { key: 'transport', label: 'Transport' },
  { key: 'discovery_select', label: 'Explore' },
  { key: 'stay_select', label: 'Stay' },
  { key: 'mode_select', label: 'Mode' },
  { key: 'local_transport', label: 'Local' },
  { key: 'budget_food', label: 'Budget' },
  { key: 'planner', label: 'Itinerary' },
  { key: 'review', label: 'Review' },
  { key: 'pay', label: 'Payment' },
] as const;

const FlowStepper: React.FC<{ current: string }> = ({ current }) => {
  const activeIdx = BOOKING_STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Booking progress" className="mb-9">
      <ol className="flex items-start justify-center gap-0 max-w-4xl mx-auto">
        {BOOKING_STEPS.map((s, i) => {
          const done = activeIdx >= 0 && i < activeIdx;
          const active = i === activeIdx;
          const stepNo = String(i + 1).padStart(2, '0');
          const lineDone = i > 0 && i <= activeIdx;
          return (
            <li key={s.key} className="relative flex flex-1 min-w-0 flex-col items-center">
              {i > 0 && (
                <span
                  aria-hidden
                  className={`absolute top-3.5 left-0 w-1/2 h-px -translate-y-1/2 transition-colors duration-300 ${
                    lineDone ? 'bg-gold-300' : 'bg-charcoal-200'
                  }`}
                />
              )}
              <span
                className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black border-2 transition-all duration-300 ${
                  active
                    ? 'bg-travion-600 border-travion-600 text-white shadow-floating scale-110'
                    : done
                      ? 'bg-gold-100 border-gold-400 text-gold-500'
                      : 'bg-white border-charcoal-200 text-charcoal-400'
                }`}
              >
                {done ? <Check className="w-3 h-3" /> : stepNo}
              </span>
              <span className={`mt-1.5 px-0.5 text-center text-[8.5px] sm:text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-colors duration-300 ${active ? 'text-travion-700' : done ? 'text-charcoal-600' : 'text-charcoal-400'}`}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

declare global {
  interface Window {
    Razorpay?: any;
  }
}

type PlannerView =
  | 'search' | 'discovery' | 'transport' | 'discovery_select' | 'stay_select' | 'mode_select'
  | 'local_transport' | 'budget_food' | 'planner' | 'review' | 'pay'
  | 'workspace' | 'my_trips';

/** Stage index (1–11) → PlannerView. stage_key is honored when present via
 *  STAGE_KEY_TO_VIEW; the numeric index is the fallback. */
const STAGE_INDEX_TO_VIEW: Record<number, PlannerView> = {
  1: 'search',
  2: 'discovery',
  3: 'transport',
  4: 'discovery_select',
  5: 'stay_select',
  6: 'mode_select',
  7: 'local_transport',
  8: 'budget_food',
  9: 'planner',
  10: 'review',
  11: 'pay',
};

const STAGE_KEY_TO_VIEW: Record<string, PlannerView> = {
  trip: 'search',
  details: 'search',
  travellers: 'discovery',
  preferences: 'discovery',
  transport: 'transport',
  explore: 'discovery_select',
  places: 'discovery_select',
  discovery_select: 'discovery_select',
  stay: 'stay_select',
  stays: 'stay_select',
  stay_select: 'stay_select',
  mode: 'mode_select',
  mode_select: 'mode_select',
  local: 'local_transport',
  local_transport: 'local_transport',
  budget: 'budget_food',
  budget_food: 'budget_food',
  itinerary: 'planner',
  planner: 'planner',
  review: 'review',
  payment: 'pay',
  pay: 'pay',
};

/** Best-effort forward stage advance: honors 422 gate violations (returns
 *  them so the caller can stay put and show the alert); 404 means the staged
 *  endpoint is not live yet — the caller proceeds with locally saved state. */
const STAGE_NOT_LIVE = 'STAGE_NOT_LIVE' as const;

interface UserDomainProps {
  session: AuthSession;
  onLogout: () => void;
}

export const UserDomain: React.FC<UserDomainProps> = ({
  session,
  onLogout
}) => {
  // Navigation views: the 11-stage booking flow + workspace + my_trips.
  const [currentView, setCurrentViewState] = useState<PlannerView>(() => {
    try {
      const saved = localStorage.getItem('travion_current_view') as PlannerView | null;
      return saved && saved !== 'workspace' ? saved : 'search';
    } catch {
      return 'search';
    }
  });

  const [showProgressReview, setShowProgressReview] = useState(false);
  const [showGodsEyeView, setShowGodsEyeView] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  // Global Back & Forward History management:
  // Synchronized with browser history and sessionStorage so users are never
  // kicked to the home/search view unexpectedly on back click or refresh.
  const viewHistoryRef = useRef<PlannerView[]>((() => {
    try {
      const saved = sessionStorage.getItem('travion_view_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  })());

  const setCurrentView = (v: PlannerView | ((prev: PlannerView) => PlannerView)) => {
    setCurrentViewState((prev) => {
      const next = typeof v === 'function' ? (v as (p: PlannerView) => PlannerView)(prev) : v;
      if (next !== prev) {
        viewHistoryRef.current = [...viewHistoryRef.current.slice(-19), prev];
        try {
          sessionStorage.setItem('travion_view_history', JSON.stringify(viewHistoryRef.current));
          localStorage.setItem('travion_current_view', next);
          window.history.pushState({ view: next }, '', '#' + next);
        } catch { /* storage quota ignore */ }
      }
      return next;
    });
  };

  const goBack = () => {
    const hist = viewHistoryRef.current;
    if (hist.length > 0) {
      const prev = hist[hist.length - 1];
      viewHistoryRef.current = hist.slice(0, -1);
      try {
        sessionStorage.setItem('travion_view_history', JSON.stringify(viewHistoryRef.current));
        localStorage.setItem('travion_current_view', prev);
      } catch { /* ignore */ }
      setCurrentViewState(prev);
    } else {
      // Step-aware backward fallback across the 11 booking stages
      const viewOrder: PlannerView[] = [
        'search', 'discovery', 'transport', 'discovery_select',
        'stay_select', 'mode_select', 'local_transport', 'budget_food',
        'planner', 'review', 'pay'
      ];
      const idx = viewOrder.indexOf(currentView);
      if (idx > 0) {
        const prev = viewOrder[idx - 1];
        setCurrentViewState(prev);
        try { localStorage.setItem('travion_current_view', prev); } catch {}
      } else {
        setCurrentViewState('search');
      }
    }
  };

  // Listen to browser Back/Forward (popstate)
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (e.state && e.state.view) {
        setCurrentViewState(e.state.view);
      } else if (viewHistoryRef.current.length > 0) {
        const prev = viewHistoryRef.current[viewHistoryRef.current.length - 1];
        viewHistoryRef.current = viewHistoryRef.current.slice(0, -1);
        try { sessionStorage.setItem('travion_view_history', JSON.stringify(viewHistoryRef.current)); } catch {}
        setCurrentViewState(prev);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showProfileSheet, setShowProfileSheet] = useState(false);

  // Active Trip state
  const [activeTrip, setActiveTrip] = useState<TripItem | null>(null);
  const [itinerary, setItinerary] = useState<TripItinerary | null>(null);

  // 10-stage server state — the source of truth for resume + gate decisions.
  const [stageState, setStageState] = useState<StageState | null>(null);
  // Review snapshot (single-source summary for the Review step + payment).
  const [reviewSnapshot, setReviewSnapshot] = useState<{
    transport?: string | null; local?: string | null; food?: string | null;
    stay?: string | null; paymentAmount?: number | null;
  } | null>(null);
  
  // Discovery Interview state
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [answersSoFar, setAnswersSoFar] = useState<Record<string, any>>({});
  
  // Modals & Overlays — Guide Mode is NEVER offered inside the user planning
  // flow (product rule): users plan in Adventurous Mode; guides join later via
  // manager assignment. The guide signup stays a separate landing-page flow.
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  // Step 4 (Explore) selections held while the traveller picks the trip
  // experience (Guide / Adventurous). Nothing is lost between stages — the
  // stage-8 itinerary is generated from this saved server state.
  const [pendingSelection, setPendingSelection] = useState<{
    places: string[];
    foods: string[];
    placeItems: SelectedPlaceItem[];
    foodItems: SelectedFoodItem[];
    stay: SelectedStay | null;
    stayRequired: boolean;
  } | null>(null);
  // Real ACTIVITY count (things to do, not places) from Explore — shown on
  // the experience-choice summary chips instead of a broken heuristic.
  const [selectedActivityCount, setSelectedActivityCount] = useState(0);
  const [navigatingStop, setNavigatingStop] = useState<ItineraryStop | null>(null);
  const [showChatDrawer, setShowChatDrawer] = useState(false);
  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [replanningAlert, setReplanningAlert] = useState<{ reason: string; explanation: string; newVersion: number } | null>(null);

  // My Trips List
  const [myTrips, setMyTrips] = useState<TripItem[]>([]);
  const [assignedGuide, setAssignedGuide] = useState<{ name: string; phone?: string; rating?: number } | null>(null);

  // Real device GPS during the live trip — never fabricated, never defaulted.
  const [livePosition, setLivePosition] = useState<{ lat: number; lng: number } | null>(null);

  // Plan-stage UX state — prevents blank screens when a plan cannot be built yet
  const [planError, setPlanError] = useState<{ message: string; available?: string[]; budget?: BudgetRecovery } | null>(null);
  const [reroutingDest, setReroutingDest] = useState<string | null>(null);
  const [locationsCache, setLocationsCache] = useState<LocationItem[]>([]);

  // Cache all verified hubs so recovery can re-route a trip to a covered destination
  useEffect(() => {
    api.getLocations().then(setLocationsCache).catch(() => {});
  }, []);

  // Live GPS tracking once the trip is underway (permission-gated; errors are
  // silent — the map simply shows no avatar rather than a fake position).
  useEffect(() => {
    const inTrip = currentView === 'workspace' && activeTrip && ['PAID', 'GUIDE_ASSIGNED', 'ACTIVE'].includes(activeTrip.status);
    if (!inTrip || !('geolocation' in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setLivePosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* permission denied or GPS unavailable — no fallback position */ },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [currentView, activeTrip?.id, activeTrip?.status]);

  const getPlanErrorMessage = (err: any): { message: string; available?: string[]; budget?: BudgetRecovery } => {
    const fallback = 'Something went wrong while planning your trip. Please try again.';
    if (!err) return { message: fallback };
    const message = err?.message || fallback;
    const rawAvailable = err?.extra?.available_destinations;
    const available = Array.isArray(rawAvailable) && rawAvailable.length > 0
      ? (rawAvailable as string[])
      : undefined;
    // Budget Feasibility Engine rejection (BUDGET_INSUFFICIENT) carries the
    // honest numbers + the recovery paths — surface them, not a generic error.
    let budget: BudgetRecovery | undefined;
    if (err?.extra?.error_code === 'BUDGET_INSUFFICIENT' || err?.error_code === 'BUDGET_INSUFFICIENT') {
      const x = err?.extra || err;
      budget = {
        minimum_required_budget: Number(x.minimum_required_budget) || 0,
        max_affordable_days: Number(x.max_affordable_days) || 0,
        requested_days: Number(x.requested_days) || 0,
        budget_status: String(x.budget_status || 'restricted'),
        alternatives: Array.isArray(x.alternatives) ? x.alternatives : [],
      };
    }
    return { message, available, budget };
  };

  // Shared entry point for the adaptive interview (fresh trip, resume or re-route)
  const beginDiscoveryForTrip = async (trip: TripItem) => {
    setActiveTrip(trip);
    setAnswersSoFar({});
    setPlanError(null);
    setCurrentQuestion(null);
    setCurrentView('discovery');
    try {
      const firstQ = await api.getNextDiscoveryQuestion(trip.id, {});
      setCurrentQuestion(firstQ);
    } catch (err) {
      setPlanError({ message: 'Discovery is temporarily unavailable. Please try again in a moment.' });
    }
  };

  // Re-route an unplannable trip to a journey-ready destination, keeping source & dates
  const reRouteTripToDestination = async (destName: string) => {
    if (!activeTrip || reroutingDest) return;
    if (activeTrip.source_name && activeTrip.source_name.trim().toLowerCase() === destName.trim().toLowerCase()) {
      setPlanError({ message: 'Destination cannot be the same as your starting place.' });
      return;
    }
    const dest = locationsCache.find((l) => l.name === destName);
    if (!dest) return;
    setReroutingDest(destName);
    try {
      const trip = await api.searchTrip({
        source_location_id: activeTrip.source_location_id,
        destination_location_id: dest.id,
        start_datetime: activeTrip.start_datetime,
        end_datetime: activeTrip.end_datetime
      });
      await beginDiscoveryForTrip(trip);
    } catch (err) {
      setPlanError(getPlanErrorMessage(err));
    } finally {
      setReroutingDest(null);
    }
  };

  // Initial user profile check + auto-resume of an ongoing journey
  useEffect(() => {
    api.getMe().then((res) => {
      if (res.user) {
        setUserProfile(res.user);
        if (!res.user.is_profile_complete) {
          setShowProfileSheet(true);
        }
      }
    }).catch(console.error);

    api.getMyTrips().then((trips) => {
      setMyTrips(trips);
      // ── PERSISTENT TRIP (spec §1/§32) ──────────────────────────────
      // The SAME trip_id survives refresh across the WHOLE flow.
      const storedTripId = localStorage.getItem('travion_active_trip_id');
      const targetStoredTrip = storedTripId ? trips.find((t) => t.id === storedTripId) : null;

      if (targetStoredTrip) {
        if (['ACTIVE', 'GUIDE_ASSIGNED', 'PAID'].includes(targetStoredTrip.status)) {
          loadTripWorkspace(targetStoredTrip.id, true);
          return;
        }
        void resumeFromStageState(targetStoredTrip);
        return;
      }

      const ongoing = trips.find(t => t.status === 'ACTIVE' || t.status === 'GUIDE_ASSIGNED' || t.status === 'PAID');
      if (ongoing) {
        loadTripWorkspace(ongoing.id, true);
        return;
      }
      const midPlanning = trips.find(t => ['REQUESTED', 'PLANNED', 'DRAFT'].includes(t.status));
      if (midPlanning) {
        // STAGE-AWARE resume: jump to the trip's current_stage view.
        void resumeFromStageState(midPlanning);
      }
    }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync active trip ID to localStorage
  useEffect(() => {
    if (activeTrip?.id) {
      try {
        localStorage.setItem('travion_active_trip_id', activeTrip.id);
      } catch { /* storage quota */ }
    }
  }, [activeTrip?.id]);

  // STAGE-AWARE resume: with an active trip, GET the stage state and jump to
  // its current_stage view (stage_key → view, numeric index as fallback).
  // Falls back to the legacy interview resume when the staged endpoint is
  // not live yet (404) — the flow keeps working either way.
  const applyStageState = (stage: StageState): PlannerView => {
    setStageState(stage);
    if (stage.trip) setActiveTrip(stage.trip as TripItem);
    if (stage.mode && stage.trip) {
      setActiveTrip((prev) => (prev ? { ...prev, mode: stage.mode as TripItem['mode'] } : prev));
    }
    const byKey = stage.stage_key ? STAGE_KEY_TO_VIEW[stage.stage_key] : undefined;
    const view = byKey || STAGE_INDEX_TO_VIEW[Number(stage.current_stage)] || 'search';
    return view;
  };

  const resumeFromStageState = async (trip: TripItem) => {
    try {
      const stage = await api.getStageState(trip.id);
      const view = applyStageState(stage);
      if (view === 'planner' || view === 'review' || view === 'pay' || view === 'workspace') {
        // Stage 8+ needs the generated itinerary — load it; if it does not
        // exist yet, drop back to the budget step (never a blank screen).
        try {
          const itn = await api.getItinerary(trip.id);
          setItinerary(itn);
          setCurrentView(view === 'workspace' ? 'workspace' : view);
        } catch {
          setCurrentView('budget_food');
        }
        return;
      }
      if (view === 'discovery' || view === 'search') {
        await resumeInterviewState(trip);
        return;
      }
      setActiveTrip(trip);
      // Restore the interview answers for traveller counts on later screens.
      try {
        const saved = await api.getTripProfile(trip.id).catch(() => null);
        const answers = (saved?.questions_answers as Record<string, any>) || {};
        setAnswersSoFar(answers);
      } catch { /* counts stay unset */ }
      setCurrentView(view);
    } catch (err: any) {
      if ((err as ApiError)?.status === 404) {
        // Staged endpoint not live — legacy resume path.
        await resumePlanningTrip(trip);
        return;
      }
      await resumePlanningTrip(trip);
    }
  };

  /** Advance one stage forward, honoring 422 gate violations.
   *  Returns null on success; returns violations when blocked. Throws the
   *  STAGE_NOT_LIVE sentinel (as a rejected value) when the endpoint 404s so
   *  callers can proceed with locally saved state. */
  const advanceStage = async (tripId: string, stage: number): Promise<string[] | null> => {
    try {
      const next = await api.setStage(tripId, stage);
      setStageState(next);
      if (next.trip) setActiveTrip(next.trip as TripItem);
      return null;
    } catch (err: any) {
      const status = (err as ApiError)?.status;
      if (status === 404) throw STAGE_NOT_LIVE;
      const extra = (err as ApiError)?.extra;
      const violations: string[] | undefined =
        extra?.violations || extra?.gate?.violations || extra?.detail?.violations;
      return violations && violations.length > 0 ? violations : [err?.message || 'This stage cannot be completed yet.'];
    }
  };

  // Legacy resume (interview state only) — used when the staged endpoint is
  // not live yet. Everything needed is already persisted server-side: the
  // interview answers (TripProfile.questions_answers) and the trip record
  // itself — so the flow picks up where the traveller left off.
  const resumePlanningTrip = async (trip: TripItem) => {
    await resumeInterviewState(trip);
  };

  const resumeInterviewState = async (trip: TripItem) => {
    setActiveTrip(trip);
    setCurrentView('discovery');
    try {
      const saved = await api.getTripProfile(trip.id).catch(() => null);
      const answers = (saved?.questions_answers as Record<string, any>) || {};
      setAnswersSoFar(answers);
      const q = await api.getNextDiscoveryQuestion(trip.id, answers);
      if (q.is_complete) {
        // Interview done — without stage state we cannot know how far the
        // traveller went, so continue at Explore (stage 4).
        setCurrentView('discovery_select');
      } else {
        setCurrentQuestion(q);
      }
    } catch {
      // Interview state is unreadable — restart the (3-question) interview
      // for this SAME trip rather than dropping the traveller's progress.
      setCurrentQuestion(null);
      setAnswersSoFar({});
      try {
        setCurrentQuestion(await api.getNextDiscoveryQuestion(trip.id, {}));
      } catch {
        setCurrentView('search');
      }
    }
  };

  const loadTripWorkspace = async (tripId: string, silent = false) => {
    let trip: TripItem | null = null;
    try {
      trip = await api.getTrip(tripId);
      setActiveTrip(trip);
      const itn = await api.getItinerary(tripId);
      setItinerary(itn);
      setCurrentView('workspace');
      api.getTripAssignment(tripId).then((a) => {
        setAssignedGuide(a.guide ? { name: a.guide.name, phone: a.guide.phone, rating: a.guide.rating } : null);
      }).catch(() => setAssignedGuide(null));
    } catch (err) {
      const msg = String((err as any)?.message || '');
      if (trip && msg.includes('Itinerary not generated yet')) {
        // The trip exists but was never planned — resume the interview instead of a blank screen.
        await beginDiscoveryForTrip(trip);
        return;
      }
      if (!silent) console.error('Failed to load trip workspace:', err);
    }
  };

  // 1. Hand off from Trip Search Bar to Discovery
  // A place picked from worldwide Google results carries a gmap: id until it is
  // registered — persist it server-side now so the trip has real geography.
  const ensureRegistered = async (loc: LocationItem): Promise<LocationItem> => {
    // Ephemeral client-side picks (Google Places or the bundled India index) carry
    // a non-server id until they are persisted — register them now for real geography.
    if (!loc.id.startsWith('gmap:') && !loc.id.startsWith('india:')) return loc;
    try {
      const registered = await api.registerLocation({
        name: loc.name,
        state: loc.state,
        country: loc.country,
        lat: loc.lat,
        lng: loc.lng,
        description: loc.description
      });
      return registered;
    } catch {
      throw new ApiError(
        `Could not save “${loc.name}” yet. Please pick it again from the list.`,
        'LOCATION_REGISTER_FAILED'
      );
    }
  };

  const handleTripSearch = async (searchData: {
    source: LocationItem;
    destination: LocationItem;
    startDate: string;
    endDate: string;
  }) => {
    setPlanError(null);
    setIsSearching(true);
    try {
      const srcName = (searchData.source.name || '').trim().toLowerCase();
      const dstName = (searchData.destination.name || '').trim().toLowerCase();
      const srcId = searchData.source.id || '';
      const dstId = searchData.destination.id || '';
      const srcPlace = searchData.source.place_id || '';
      const dstPlace = searchData.destination.place_id || '';

      if (
        (srcId && dstId && srcId === dstId) ||
        (srcPlace && dstPlace && srcPlace === dstPlace) ||
        (srcName && dstName && srcName === dstName)
      ) {
        setPlanError({
          message: 'Source and destination cannot be the same place. Please choose a different destination.'
        });
        setIsSearching(false);
        return;
      }

      const source = await ensureRegistered(searchData.source);
      const destination = await ensureRegistered(searchData.destination);

      if (
        source.id === destination.id ||
        (source.place_id && destination.place_id && source.place_id === destination.place_id) ||
        source.name.trim().toLowerCase() === destination.name.trim().toLowerCase()
      ) {
        setPlanError({
          message: 'Source and destination cannot be the same place. Please choose a different destination.'
        });
        setIsSearching(false);
        return;
      }

      const trip = await api.searchTrip({
        source_location_id: source.id,
        destination_location_id: destination.id,
        start_datetime: searchData.startDate,
        end_datetime: searchData.endDate
      });
      await beginDiscoveryForTrip(trip);
    } catch (err: any) {
      // e.g. same source/destination or past dates — surface inline instead of silently failing
      setPlanError(getPlanErrorMessage(err));
    } finally {
      setIsSearching(false);
    }
  };

  // 2. Answer question in Adaptive Interview (exactly 3 questions).
  // Interview complete → Stage 3 Transport (forward PUT validates the gate;
  // 422 violations keep the traveller here with the message inline).
  const handleAnswerQuestion = async (answer: any) => {
    if (!activeTrip || !currentQuestion?.question_id) return;
    const updatedAnswers = {
      ...answersSoFar,
      [currentQuestion.question_id]: answer
    };
    setAnswersSoFar(updatedAnswers);

    try {
      const nextQ = await api.getNextDiscoveryQuestion(activeTrip.id, updatedAnswers);
      if (nextQ.is_complete) {
        setCurrentQuestion(null);
        setPlanError(null);
        try {
          const blocked = await advanceStage(activeTrip.id, 3);
          if (blocked) {
            setPlanError({ message: blocked.join(' ') });
            return;
          }
        } catch (e) {
          if (e !== STAGE_NOT_LIVE) throw e;
          // Staged endpoint not live — proceed locally.
        }
        setCurrentView('transport');
      } else {
        setCurrentQuestion(nextQ);
      }
    } catch (err: any) {
      // Validation errors (budget minimum, party mismatch) surface inline on
      // the current question — never a dead end.
      const detail = err?.message || 'Please check your answer and try again.';
      setPlanError({ message: detail });
    }
  };

  // Stage 4 (Explore) selections made → the traveller chooses Accommodation
  // (Stage 5) with verified stays & Booking.com live inventory.
  // Selections are already persisted server-side by DiscoverySelect.
  const handleGeneratePlans = async (places: string[], foods: string[], placeItems: SelectedPlaceItem[], foodItems: SelectedFoodItem[], stay?: SelectedStay | null, stayRequired?: boolean, activityCount?: number) => {
    if (!activeTrip) return;
    setPendingSelection({ places, foods, placeItems, foodItems, stay: stay ?? null, stayRequired: stayRequired ?? (stay != null) });
    setSelectedActivityCount(Number(activityCount) || 0);
    try {
      const blocked = await advanceStage(activeTrip.id, 5);
      if (blocked) {
        setPlanError({ message: blocked.join(' ') });
        return;
      }
    } catch (e) {
      if (e !== STAGE_NOT_LIVE) throw e;
    }
    setCurrentView('stay_select');
  };

  // STAGE 5 → STAGE 6: Stay selected → choose experience mode (Guide vs Adventurous).
  const handleStayComplete = async (stage?: StageState | null) => {
    if (!activeTrip) return;
    if (stage && Object.keys(stage).length > 0) setStageState(stage);
    try {
      const blocked = await advanceStage(activeTrip.id, 6);
      if (blocked && blocked.some((b) => !b.toLowerCase().includes('budget') && !b.toLowerCase().includes('exceeds'))) {
        setPlanError({ message: blocked.join(' ') });
        return;
      }
    } catch (e) {
      if (e !== STAGE_NOT_LIVE) console.warn('advanceStage 6:', e);
    }
    setCurrentView('mode_select');
  };

  // STAGE 6 → STAGE 7: the traveller picks HOW to experience the trip. The
  // mode is persisted on the trip (setExperienceMode reprices server-side);
  // the forward PUT then unlocks Local transport.
  const handleModeSelect = async (mode: TripMode) => {
    if (!activeTrip || isGeneratingPlan) return;
    setIsGeneratingPlan(true);
    setPlanError(null);
    try {
      try {
        await api.setExperienceMode(activeTrip.id, mode);
      } catch { /* staged flow persists mode via PUT below; keep going */ }
      setActiveTrip((prev) => (prev ? { ...prev, mode } : prev));
      try {
        const blocked = await advanceStage(activeTrip.id, 7);
        if (blocked && blocked.some((b) => !b.toLowerCase().includes('budget') && !b.toLowerCase().includes('exceeds'))) {
          setPlanError({ message: blocked.join(' ') });
          setIsGeneratingPlan(false);
          return;
        }
      } catch (e) {
        if (e !== STAGE_NOT_LIVE) console.warn('advanceStage 7:', e);
      }
      setIsGeneratingPlan(false);
      setCurrentView('local_transport');
    } catch (err) {
      setIsGeneratingPlan(false);
      setPlanError(getPlanErrorMessage(err));
    }
  };

  // STAGE 9: generate the itinerary DIRECTLY from saved state (no plan
  // cards) via the existing planTrip endpoint, then open the editor.
  const handleBuildItinerary = async (stage: StageState | null) => {
    const trip = activeTrip;
    if (!trip) return;
    if (stage && Object.keys(stage).length > 0) setStageState(stage);
    const mode = (stage && (stage as StageState).mode) || stageState?.mode || trip.mode || 'ADVENTUROUS_MODE';
    setIsGeneratingPlan(true);
    setPlanError(null);
    try {
      const itn = await api.planTrip(trip.id, mode as 'GUIDE_MODE' | 'ADVENTUROUS_MODE', true);
      setItinerary(itn);
      setActiveTrip((prev) => (prev ? { ...prev, total_cost: itn.total_cost, status: 'PLANNED' } : prev));
      try {
        await advanceStage(trip.id, 9);
      } catch { /* best effort */ }
      setIsGeneratingPlan(false);
      setCurrentView('planner');
    } catch (err) {
      setIsGeneratingPlan(false);
      setPlanError(getPlanErrorMessage(err));
    }
  };

  // Stage 9 → Stage 10: open Final Review. Loads the single-source review
  // snapshot when available (labels + payment amount); the editor state is
  // untouched either way.
  const handlePlannerProceedToReview = async () => {
    if (!activeTrip) return;
    try {
      const blocked = await advanceStage(activeTrip.id, 10);
      if (blocked) {
        setPlanError({ message: blocked.join(' ') });
        return;
      }
    } catch (e) {
      if (e !== STAGE_NOT_LIVE) throw e;
    }
    try {
      const snap = await api.getReviewSnapshot(activeTrip.id);
      const str = (v: any): string | null => (v == null || v === '' ? null : String(v));
      setReviewSnapshot({
        transport: str((snap.transport as any)?.summary || (snap.transport as any)?.label),
        local: str((snap.local_transport as any)?.summary || (snap.local_transport as any)?.label),
        food: str((snap.food_tier as any)?.label || (typeof snap.food_tier === 'string' ? snap.food_tier : null)),
        stay: str((snap.stay as any)?.name || (snap.stay as any)?.summary),
        paymentAmount: typeof snap.payment_amount === 'number' ? snap.payment_amount : null,
      });
    } catch {
      setReviewSnapshot(null);
    }
    setCurrentView('review');
  };

  // Stage 10 → Stage 11: open the Payment step (forward PUT validates the
  // gate; 422 violations keep the traveller on Review).
  const handleReviewConfirm = async () => {
    if (!activeTrip) return;
    try {
      const blocked = await advanceStage(activeTrip.id, 11);
      if (blocked) {
        setPlanError({ message: blocked.join(' ') });
        return;
      }
    } catch (e) {
      if (e !== STAGE_NOT_LIVE) throw e;
    }
    setCurrentView('pay');
  };

  // Payment success → the activated trip workspace.
  const handlePaymentSuccess = async () => {
    if (!activeTrip) return;
    setPlanError(null);
    await loadTripWorkspace(activeTrip.id, true);
  };

  // 3c. Live itinerary edits (drag & drop / remove / add) — recalculated server-side
  const handleItineraryChange = (updated: TripItinerary, _warnings: string[]) => {
    setItinerary(updated);
    setActiveTrip(prev => prev ? { ...prev, total_cost: updated.total_cost } : null);
  };

  // 5. Dynamic Replanning Trigger
  const handleTriggerReplan = async (triggerType: 'WEATHER' | 'TIREDNESS' = 'WEATHER') => {
    if (!activeTrip) return;
    const reason = triggerType === 'WEATHER'
      ? "Rain & dense fog advisory detected along summit path"
      : "User requested a relaxed fireside afternoon";

    try {
      const res = await api.replanTrip(activeTrip.id, triggerType, reason);
      setItinerary(res.updated_itinerary);
      setReplanningAlert({
        reason: res.reason,
        explanation: res.explanation,
        newVersion: res.new_version
      });
    } catch (err) {
      console.error("Dynamic replan failed:", err);
    }
  };

  // Magnification Dock Action Items (max 6)
  const dockItems: DockItemData[] = [
    {
      icon: <Navigation className="w-5 h-5 text-travion-600" />,
      label: "Live Voice Navigation",
      onClick: () => {
        const firstStop = itinerary?.days[0]?.stops[0];
        if (firstStop) setNavigatingStop(firstStop);
      }
    },
    {
      icon: <MessageSquare className="w-5 h-5 text-travion-600" />,
      label: "Trip AI & Guide Chat",
      onClick: () => setShowChatDrawer(true),
      badge: activeTrip?.mode === 'GUIDE_MODE' ? "Guide" : undefined
    },
    {
      icon: <Download className="w-5 h-5 text-emerald-600" />,
      label: "Offline Package",
      onClick: () => setShowOfflineModal(true)
    },
    {
      icon: <RefreshCw className="w-5 h-5 text-amber-600" />,
      label: "Change Plan / Replan",
      onClick: () => handleTriggerReplan('WEATHER')
    },
    {
      icon: <Star className="w-5 h-5 text-yellow-500" />,
      label: "Trip Review",
      onClick: () => setShowReviewModal(true)
    }
  ];

  return (
    <div className="min-h-screen bg-cream-50 flex flex-col justify-between">
      
      {/* Top Header — floating glass */}
      <header className="sticky top-0 z-40 w-full glass-strong border-b border-white/50 shadow-soft">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentView('search')}
              className="flex items-center gap-2.5 focus:outline-none"
            >
              <TravionLogo mark="dark" />
            </button>
            {/* §25 — Global Back: returns to the ACTUAL previous screen with
                all trip state intact (never a hardcoded Home). */}
            {currentView !== 'search' && (
              <button
                onClick={goBack}
                aria-label="Go back to the previous screen"
                title="Back"
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl border border-charcoal-200 bg-white text-charcoal-700 text-xs font-bold hover:border-charcoal-300 hover:bg-charcoal-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-travion-400"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* God's Eye View Button */}
            <button
              type="button"
              onClick={() => setShowGodsEyeView(true)}
              title="God's Eye View — Live Telemetry & Speedometer"
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl bg-charcoal-900 hover:bg-black text-emerald-400 border border-emerald-500/30 text-xs font-bold transition-all shadow-sm"
            >
              <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline font-mono">God's Eye View</span>
            </button>

            {/* Persistent Review Progress Button — always accessible */}
            {(activeTrip || myTrips.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  if (!activeTrip && myTrips.length > 0) {
                    const latest = myTrips.find(t => ['REQUESTED', 'PLANNED', 'DRAFT', 'ACTIVE'].includes(t.status)) || myTrips[0];
                    setActiveTrip(latest);
                  }
                  setShowProgressReview(true);
                }}
                title="Review your plan progress and selections so far"
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl bg-travion-50 hover:bg-travion-100 text-travion-700 border border-travion-200 text-xs font-bold transition-colors shadow-sm"
              >
                <Sparkles className="w-3.5 h-3.5 text-travion-600" />
                <span className="hidden sm:inline">Review Progress</span>
              </button>
            )}

            {/* Profile Avatar / Logout */}
            <div className="flex items-center gap-2 pl-2 border-l border-charcoal-200">
              <span className="text-xs font-bold text-charcoal-700 hidden sm:inline">
                {userProfile?.preferred_name || session.email.split('@')[0]}
              </span>
              <button
                onClick={onLogout}
                className="p-2 text-charcoal-400 hover:text-red-600 rounded-xl hover:bg-red-50 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-6 py-6 pb-28">
        
        {/* Dynamic Replanning Notice Toast */}
        <AnimatePresence>
          {replanningAlert && (
            <ReplanningNotice
              reason={replanningAlert.reason}
              explanation={replanningAlert.explanation}
              newVersion={replanningAlert.newVersion}
              onDismiss={() => setReplanningAlert(null)}
            />
          )}
        </AnimatePresence>

        {/* VIEW 1: Search & Home — the beginning of a journey */}
        {currentView === 'search' && (
          <div className="pt-8 md:pt-12">
            {/* Editorial hero */}
            <div className="relative max-w-3xl mx-auto text-center mb-9">
              <div aria-hidden="true" className="absolute -top-20 left-1/2 -translate-x-1/2 w-[620px] h-[260px] rounded-full bg-gradient-to-r from-sky-200/50 via-travion-100/60 to-sand-200/50 blur-3xl -z-10" />
              <span className="inline-flex items-center gap-1.5 text-[10.5px] font-black uppercase tracking-[0.18em] text-travion-700 bg-white/70 backdrop-blur border border-travion-100 rounded-full px-3.5 py-1.5 shadow-sm">
                <Sparkles className="w-3.5 h-3.5" />
                AI Travel Planner · India & beyond
              </span>
              <h1 className="font-black text-charcoal-900 tracking-tight mt-5 text-[2.35rem] leading-[1.04] sm:text-5xl sm:leading-[1.03]">
                Plan a trip that feels{' '}
                <span className="font-editorial italic font-medium text-travion-600">effortless.</span>
              </h1>
              <p className="text-charcoal-500 mt-4 text-[15px] sm:text-base font-medium leading-relaxed max-w-xl mx-auto">
                Where would you like to go? Tell us where you're coming from, where you're going, and when — Travion plans, adapts and supports the whole journey.
              </p>
            </div>

            {/* Quick Resume Card for In-Progress Trip */}
            {(() => {
              const pendingTrip = activeTrip || myTrips.find(t => ['REQUESTED', 'PLANNED', 'DRAFT'].includes(t.status));
              if (!pendingTrip) return null;
              return (
                <div className="max-w-2xl mx-auto mb-6 p-4 rounded-3xl bg-white border border-travion-200 shadow-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-2xl bg-travion-50 text-travion-600 flex items-center justify-center shrink-0 border border-travion-100">
                      <Sparkles className="w-5 h-5" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-travion-100 text-travion-700">
                          Plan In Progress
                        </span>
                      </div>
                      <h4 className="text-sm font-extrabold text-charcoal-900 mt-0.5">
                        {pendingTrip.source_name} → {pendingTrip.destination_name}
                      </h4>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTrip(pendingTrip);
                        setShowProgressReview(true);
                      }}
                      className="flex-1 sm:flex-initial px-3.5 h-10 rounded-xl border border-charcoal-200 bg-sand-50 hover:bg-sand-100 text-charcoal-700 text-xs font-bold transition-colors"
                    >
                      Review Plan
                    </button>
                    <button
                      type="button"
                      onClick={() => void resumeFromStageState(pendingTrip)}
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-4 h-10 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-xs font-black shadow-sm transition-colors"
                    >
                      <span>Resume Trip</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Server-side validation notice (e.g. same source/destination, past dates) */}
            <AnimatePresence>
              {planError && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="max-w-2xl mx-auto mb-5 flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3"
                >
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[13px] font-semibold text-red-700 leading-relaxed flex-1">{planError.message}</p>
                  <button
                    onClick={() => setPlanError(null)}
                    className="text-[11px] font-black text-red-400 hover:text-red-600 transition-colors"
                  >
                    Dismiss
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <TripSearchBar onSearch={handleTripSearch} isLoading={isSearching} />

            {/* Trust strip — factual product capabilities, never invented stats */}
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-2.5 text-[11.5px] font-semibold text-charcoal-500">
              <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Verified real places</span>
              <span className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-travion-500" /> AI planning</span>
              <span className="flex items-center gap-1.5"><BadgeCheck className="w-3.5 h-3.5 text-cognac-500" /> Human guide support</span>
              <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-charcoal-400" /> Secure payments</span>
            </div>

            {/* Recent Trips Section */}
            {myTrips.length > 0 && (
              <div className="mt-16 max-w-4xl mx-auto">
                <h3 className="text-base font-bold text-charcoal-900 mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-travion-600" />
                  <span>Your Planned & Completed Trips</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {myTrips.map(trip => (
                    <div
                      key={trip.id}
                      onClick={() => loadTripWorkspace(trip.id)}
                      className="cursor-pointer p-4 rounded-2xl bg-white border border-charcoal-200 hover:border-travion-300 hover:shadow-soft transition-all flex items-center justify-between"
                    >
                      <div>
                        <div className="text-xs font-bold text-travion-700">{trip.source_name} → {trip.destination_name}</div>
                        <div className="text-[11px] text-charcoal-400 mt-0.5">Status: <span className="font-semibold text-charcoal-600">{trip.status}</span></div>
                      </div>
                      <span className="text-xs font-bold text-charcoal-700">₹{trip.total_cost}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: Adaptive AI Discovery Interview */}
        {currentView === 'discovery' && (
          <div className="pt-8">
            <FlowStepper current="discovery" />
            <div className="text-center mb-6">
              <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 2 · Adaptive Discovery</span>
              <h2 className="text-2xl font-bold text-charcoal-900 mt-1">Understanding Your Travel Style</h2>
            </div>

            {currentQuestion ? (
              <DiscoveryCard
                questionId={currentQuestion.question_id}
                questionText={currentQuestion.question_text}
                questionType={currentQuestion.question_type}
                options={currentQuestion.options}
                placeholder={currentQuestion.placeholder}
                answeredCount={currentQuestion.answered_count}
                totalEstimated={currentQuestion.total_estimated}
                onAnswer={handleAnswerQuestion}
                onBack={() => { setPlanError(null); setCurrentQuestion(null); setCurrentView('search'); }}
              />
            ) : planError ? (
              /* ── Recovery panel — never leave the user on a blank screen ── */
              <div className="max-w-2xl mx-auto rounded-3xl border border-charcoal-200 bg-white shadow-soft overflow-hidden">
                <div className="flex items-center gap-3 border-b border-charcoal-100 px-6 py-4 bg-red-50/50">
                  <span className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                    <AlertCircle className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-extrabold text-charcoal-900">Your plan could not be generated yet</h3>
                    <p className="text-[12px] font-semibold text-charcoal-500">Your search is saved — nothing was lost.</p>
                  </div>
                </div>

                <div className="px-6 py-5">
                  <p className="text-[13px] font-medium text-charcoal-600 leading-relaxed">{planError.message}</p>

                  {planError.available && planError.available.length > 0 && activeTrip && (
                    <div className="mt-5">
                      <p className="text-[10px] font-black uppercase tracking-wider text-charcoal-400 mb-2">
                        Journey-ready destinations right now
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {planError.available.map((dest) => (
                          <button
                            key={dest}
                            type="button"
                            disabled={reroutingDest === dest}
                            onClick={() => reRouteTripToDestination(dest)}
                            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-travion-50 border border-travion-200 text-travion-700 text-[13px] font-bold hover:bg-travion-600 hover:text-white hover:border-travion-600 transition-all disabled:opacity-50"
                          >
                            {reroutingDest === dest ? 'Switching...' : dest}
                            {reroutingDest !== dest && <ArrowLeft className="w-3.5 h-3.5 rotate-180" />}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2.5 text-[11px] font-semibold text-charcoal-400">
                        {activeTrip.source_name} → choose above — your departure city, dates and traveller details carry over automatically.
                      </p>
                    </div>
                  )}

                  <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
                    <button
                      onClick={() => { setPlanError(null); setCurrentView('search'); }}
                      className="flex-1 h-11 rounded-xl border border-charcoal-200 text-charcoal-700 font-bold text-sm hover:border-charcoal-300 transition-colors"
                    >
                      Back to search
                    </button>
                    {!planError.available && (
                      <button
                        onClick={() => { setPlanError(null); if (activeTrip) loadTripWorkspace(activeTrip.id, true); }}
                        className="flex-1 h-11 rounded-xl bg-travion-600 hover:bg-travion-700 text-white font-bold text-sm transition-colors"
                      >
                        Try planning again
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : !isGeneratingPlan ? (
              /* ── Resumed state: interview finished — continue planning ── */
              <div className="max-w-md mx-auto rounded-3xl border border-charcoal-200 bg-white shadow-soft p-8 text-center">
                <span className="mx-auto w-14 h-14 rounded-2xl bg-travion-100 text-travion-600 flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-7 h-7" />
                </span>
                <h3 className="text-lg font-extrabold text-charcoal-900">Your travel style is captured</h3>
                <p className="mt-2 text-[13px] font-medium text-charcoal-500 leading-relaxed">
                  Ready to pick the places you want to experience.
                </p>
                <button
                  onClick={() => setCurrentView('discovery_select')}
                  className="mt-6 w-full h-12 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-extrabold transition-colors"
                >
                  Continue to place discovery
                </button>
                <button
                  onClick={() => { setPlanError(null); setCurrentView('search'); }}
                  className="mt-2.5 w-full h-11 rounded-2xl text-charcoal-500 text-[13px] font-bold hover:text-charcoal-700 transition-colors"
                >
                  Start a different trip
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* VIEW 2a: Destination discovery — user selects REAL verified places */}
        {currentView === 'discovery_select' && activeTrip && (
          <div>
            {planError && planError.budget && (
              <div className="max-w-3xl mx-auto mb-6 rounded-3xl border border-red-200 bg-red-50 overflow-hidden">
                <div className="flex items-center gap-3 px-6 py-4 border-b border-red-100">
                  <span className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                    <AlertCircle className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-extrabold text-charcoal-900">This budget can't fund the trip yet</h3>
                    <p className="text-[12px] font-semibold text-charcoal-500">Travion stays honest — it will never hand you a normal itinerary you can't afford.</p>
                  </div>
                </div>

                <div className="px-6 py-5">
                  <p className="text-[13px] font-medium text-charcoal-600 leading-relaxed">{planError.message}</p>

                  <div className="mt-4 grid sm:grid-cols-3 gap-2.5">
                    <div className="rounded-xl bg-white border border-red-100 px-3.5 py-2.5">
                      <p className="text-[10px] font-black uppercase tracking-wider text-charcoal-400">Realistic minimum</p>
                      <p className="text-lg font-extrabold text-charcoal-900">₹{Number(planError.budget.minimum_required_budget || 0).toLocaleString('en-IN')}</p>
                    </div>
                    <div className="rounded-xl bg-white border border-red-100 px-3.5 py-2.5">
                      <p className="text-[10px] font-black uppercase tracking-wider text-charcoal-400">Budget supports</p>
                      <p className="text-lg font-extrabold text-charcoal-900">{planError.budget.max_affordable_days || 0} day{planError.budget.max_affordable_days === 1 ? '' : 's'}</p>
                    </div>
                    <div className="rounded-xl bg-white border border-red-100 px-3.5 py-2.5">
                      <p className="text-[10px] font-black uppercase tracking-wider text-charcoal-400">Requested</p>
                      <p className="text-lg font-extrabold text-charcoal-900">{planError.budget.requested_days || 0} day{planError.budget.requested_days === 1 ? '' : 's'}</p>
                    </div>
                  </div>

                  {planError.budget.alternatives.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[10px] font-black uppercase tracking-wider text-charcoal-400 mb-2">Ways to make it work</p>
                      <div className="space-y-1.5">
                        {planError.budget.alternatives.map((alt, ai) => (
                          <div key={ai} className="flex items-start gap-2 text-[12.5px] font-semibold text-charcoal-600">
                            <span className="w-4 h-4 rounded-full bg-travion-100 text-travion-700 text-[10px] font-black flex items-center justify-center shrink-0">
                              {ai + 1}
                            </span>
                            <span>{alt.heading} — <span className="font-medium text-charcoal-500">{alt.text}</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
                    <button
                      onClick={() => { setPlanError(null); setCurrentView('search'); }}
                      className="flex-1 h-11 rounded-xl border border-charcoal-200 bg-white text-charcoal-700 font-bold text-sm hover:border-charcoal-300 transition-colors"
                    >
                      Back to search
                    </button>
                    <button
                      onClick={() => setPlanError(null)}
                      className="flex-1 h-11 rounded-xl bg-travion-600 hover:bg-travion-700 text-white font-bold text-sm transition-colors"
                    >
                      Adjust my choices above
                    </button>
                  </div>
                </div>
              </div>
            )}

            <FlowStepper current="discovery_select" />
            <DiscoverySelect
              tripId={activeTrip.id}
              destinationName={activeTrip.destination_name}
              onConfirm={handleGeneratePlans}
              onBack={() => { setPlanError(null); setCurrentView('search'); }}
              busy={isGeneratingPlan}
            />
          </div>
        )}

        {/* STAGE 3 — Transport: outbound + return picks, gate-checked. */}
        {currentView === 'transport' && activeTrip && (
          <>
            <FlowStepper current="transport" />
            <TransportSelection
              tripId={activeTrip.id}
              initial={stageState?.trip_id === activeTrip.id ? stageState.transport : null}
              partySize={Number(answersSoFar?.party?.total) || null}
              onComplete={(stage) => {
                if (stage && Object.keys(stage).length > 0) setStageState(stage);
                setCurrentView('discovery_select');
              }}
              onBack={() => setCurrentView('discovery')}
            />
          </>
        )}

        {/* STAGE 5 — Stay: dedicated accommodation selection */}
        {currentView === 'stay_select' && activeTrip && (
          <>
            <FlowStepper current="stay_select" />
            <StaySelection
              tripId={activeTrip.id}
              initialStay={stageState?.places?.stay}
              partySize={Number(answersSoFar?.party?.total) || null}
              nightsCount={(() => {
                const s = new Date(activeTrip.start_datetime).getTime();
                const e = new Date(activeTrip.end_datetime).getTime();
                if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
                return Math.max(1, Math.round((e - s) / 86_400_000));
              })()}
              onComplete={(stage) => void handleStayComplete(stage)}
              onBack={() => setCurrentView('discovery_select')}
            />
          </>
        )}

        {/* VIEW 2a-2: STAGE 6 — CHOOSE YOUR TRAVEL MODE. The dedicated
            major-decision screen (Guide = human + AI, 12.5% guide fee;
            Adventurous = independent + AI, no guide fee), shown BEFORE local
            transport, budget and itinerary so everything prices the chosen
            mode exactly. */}
        {currentView === 'mode_select' && activeTrip && (
          <>
            <FlowStepper current="mode_select" />
            <ModeSelectionScreen
            destinationName={activeTrip.destination_name}
            placeCount={pendingSelection?.places.length ?? 0}
            activityCount={selectedActivityCount}
            foodCount={pendingSelection?.foods.length ?? 0}
            hasStay={!!(pendingSelection?.stayRequired && pendingSelection?.stay)}
            totalCost={activeTrip.budget}
            guide={stageState?.trip_id === activeTrip.id ? stageState.guide : null}
            onBack={() => setCurrentView('stay_select')}
            onSelect={(mode) => void handleModeSelect(mode)}
            busy={isGeneratingPlan}
            />
          </>
        )}

        {/* STAGE 7 — Local transport: one option per generated leg. */}
        {currentView === 'local_transport' && activeTrip && (
          <>
            <FlowStepper current="local_transport" />
            <LocalTransportPlanner
              tripId={activeTrip.id}
              initialLegs={stageState?.trip_id === activeTrip.id ? stageState.local_transport?.legs : null}
              onComplete={(stage) => {
                if (stage && Object.keys(stage).length > 0) setStageState(stage);
                setCurrentView('budget_food');
              }}
              onBack={() => setCurrentView('mode_select')}
            />
          </>
        )}

        {/* STAGE 8 — Budget + food: full gate breakdown, tier switching,
            top-up recovery. Continue builds the itinerary (stage 9). */}
        {currentView === 'budget_food' && activeTrip && (
          <>
            <FlowStepper current="budget_food" />
            <BudgetFoodPlan
              tripId={activeTrip.id}
              initialGate={stageState?.trip_id === activeTrip.id ? stageState.budget : null}
              travellers={Number(answersSoFar?.party?.total) || null}
              days={(() => {
                const s = new Date(activeTrip.start_datetime).getTime();
                const e = new Date(activeTrip.end_datetime).getTime();
                if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
                return Math.max(1, Math.ceil((e - s) / 86_400_000));
              })()}
              onComplete={(stage) => void handleBuildItinerary(stage)}
              onBack={() => setCurrentView('local_transport')}
            />
          </>
        )}

        {/* STAGE 9: Interactive Trip Planner — finalize the itinerary (the
            traveller's source of truth), generated directly from saved state
            via planTrip (no plan cards). */}
        {currentView === 'planner' && itinerary && activeTrip && (
          <>
            <FlowStepper current="planner" />
            <PlannerWorkspace
            tripId={activeTrip.id}
            itinerary={itinerary}
            budgetMax={resolveBudgetMax(
              itinerary.cost_breakdown?.budget,
              activeTrip.budget,
              itinerary.total_cost,
            )}
            onItineraryChange={handleItineraryChange}
            onBackToPlans={() => setCurrentView('budget_food')}
            onProceedToExperience={() => void handlePlannerProceedToReview()}
            onProceedToPayment={() => void handlePlannerProceedToReview()}
            feePreview={null}
            tripInfo={{
              destination: activeTrip.destination_name,
              start: activeTrip.start_datetime,
              end: activeTrip.end_datetime,
              mode: activeTrip.mode,
              travellers: Number(answersSoFar?.party?.total) || undefined,
              adults: Number(answersSoFar?.party?.adults) || undefined,
              children: Number(answersSoFar?.party?.children) || undefined,
            }}
          />
          </>
        )}

        {/* STAGE 10 — FINAL REVIEW. Read/confirm state: shows the EXACT
            stored itinerary (the user's final edits) + the same centralized
            pricing object the Razorpay order uses. Every Edit jumps to its
            own stage WITHOUT destroying state. */}
        {currentView === 'review' && itinerary && activeTrip && (
          <>
            <FlowStepper current="review" />
            <FinalReviewStep
              trip={{
                id: activeTrip.id,
                destination_name: activeTrip.destination_name,
                source_name: activeTrip.source_name,
                start_datetime: activeTrip.start_datetime,
                end_datetime: activeTrip.end_datetime,
                budget: activeTrip.budget,
                mode: activeTrip.mode,
              }}
              planLabel={null}
              travellers={
                answersSoFar?.party && typeof answersSoFar.party === 'object'
                  ? { total: Number(answersSoFar.party.total) || undefined, adults: Number(answersSoFar.party.adults) || undefined, children: Number(answersSoFar.party.children) || undefined }
                  : null
              }
              experienceLabel={
                answersSoFar?.experience
                  ? (Array.isArray(answersSoFar.experience) ? answersSoFar.experience.join(' · ') : String(answersSoFar.experience))
                  : null
              }
              itinerary={itinerary}
              transportLabel={reviewSnapshot?.transport}
              localLabel={reviewSnapshot?.local}
              foodLabel={reviewSnapshot?.food}
              stayLabel={reviewSnapshot?.stay}
              onEdit={(target: ReviewEditTarget) => {
                if (target === 'basics') setCurrentView('search');
                else if (target === 'travellers') setCurrentView('discovery');
                else if (target === 'places' || target === 'discovery_select') setCurrentView('discovery_select');
                else if (target === 'stay' || (target as string) === 'stay_select') setCurrentView('stay_select');
                else if (target === 'transport') setCurrentView('transport');
                else if (target === 'mode_select') setCurrentView('mode_select');
                else if (target === 'local_transport') setCurrentView('local_transport');
                else if (target === 'budget_food' || target === 'plans') setCurrentView('budget_food');
                else setCurrentView('planner');
              }}
              onConfirm={() => void handleReviewConfirm()}
              busy={false}
            />
          </>
        )}

        {/* STAGE 11 — Payment: extracted checkout step (Razorpay order,
            webhook verify, activation). On success → workspace. */}
        {currentView === 'pay' && activeTrip && (
          <>
            <FlowStepper current="pay" />
            <PaymentStep
              tripId={activeTrip.id}
              sourceName={activeTrip.source_name}
              destinationName={activeTrip.destination_name}
              userEmail={session.email}
              expectedAmount={reviewSnapshot?.paymentAmount}
              onSuccess={() => void handlePaymentSuccess()}
              onBack={() => setCurrentView('review')}
            />
          </>
        )}

        {/* VIEW 3: Live Trip Workspace (Desktop Split View + Map + Magnification Dock) */}
        {currentView === 'workspace' && itinerary && activeTrip && (
          <div>
            {/* Trip Context Banner */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-3xl bg-white border border-charcoal-200/80 shadow-soft">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-travion-100 text-travion-600 flex items-center justify-center">
                  {activeTrip.mode === 'GUIDE_MODE' ? <Compass className="w-6 h-6" /> : <Mountain className="w-6 h-6" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold text-charcoal-900 flex items-center gap-1.5">
                      {activeTrip.source_name}
                      <ArrowLeft className="w-3.5 h-3.5 text-charcoal-400 rotate-180" />
                      {activeTrip.destination_name}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      {activeTrip.status}
                    </span>
                  </div>
                  {/* §21: NEVER claim a guide is assigned before a real
                      assignment exists. Status text follows the actual trip state. */}
                  <div className="text-xs text-charcoal-500 font-medium mt-0.5">
                    {activeTrip.mode === 'GUIDE_MODE'
                      ? (assignedGuide
                          ? `Verified Local Guide: ${assignedGuide.name}`
                          : activeTrip.status === 'REQUESTED'
                            ? 'Guide Mode · waiting for guide assignment'
                            : 'Guide Mode · guide assignment pending payment')
                      : 'Adventurous Mode · independent AI-assisted travel'}
                    {' '}· Total Budget: ₹{activeTrip.total_cost}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowGodsEyeView(true)}
                  className="px-4 py-2 rounded-xl bg-charcoal-900 hover:bg-black text-emerald-400 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-soft"
                >
                  <Crosshair className="w-4 h-4 text-emerald-400" />
                  <span>God's Eye View</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowOfflineModal(true)}
                  className="px-4 py-2 rounded-xl bg-sand-100 hover:bg-sand-200 text-charcoal-700 font-bold text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Offline</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTriggerReplan('WEATHER')}
                  className="px-4 py-2 rounded-xl bg-travion-50 hover:bg-travion-100 text-travion-700 font-bold text-xs flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Simulate Weather Replan</span>
                </button>
                {['PAID', 'GUIDE_ASSIGNED', 'ACTIVE', 'PLANNED'].includes(activeTrip.status) && (
                  <button
                    type="button"
                    onClick={() => setShowCancelModal(true)}
                    className="px-4 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <Ban className="w-4 h-4 text-red-500" />
                    <span>Cancel Trip & Refund</span>
                  </button>
                )}
              </div>
            </div>

            {/* User-controlled Drag & Drop Itinerary Builder (remove/move/add with live recalc) */}
            <div className="mb-6">
              <ItineraryEditor
                tripId={activeTrip.id}
                itinerary={itinerary}
                budgetMax={resolveBudgetMax(
                  itinerary.cost_breakdown?.budget,
                  activeTrip.budget,
                  itinerary.total_cost,
                )}
                onItineraryChange={handleItineraryChange}
              />
            </div>

            {/* The Split View Component */}
            <SplitView
              itinerary={itinerary}
              onStartNavigation={(stop) => setNavigatingStop(stop)}
              avatarPosition={livePosition ? [livePosition.lat, livePosition.lng] : null}
              tripStart={activeTrip.start_datetime}
              tripEnd={activeTrip.end_datetime}
              tripStatus={activeTrip.status}
              tripSource={activeTrip.source_name}
              tripDestination={activeTrip.destination_name}
            />

            {/* Magnification Quick Actions Dock */}
            <MagnificationDock items={dockItems} />
          </div>
        )}

      </main>

      {/* Basic Profile Sheet Modal */}
      <AnimatePresence>
        {showProfileSheet && (
          <BasicProfileSheet
            initialData={userProfile || undefined}
            onComplete={() => setShowProfileSheet(false)}
          />
        )}
      </AnimatePresence>

      {/* Branded Loading Transition — §22/§23: itinerary building is a real
          server operation (place validation, geo-fencing, chronology, budget
          fitting). The animated stage list reflects those real stages and
          never fakes completion; the loader simply rides along until the
          response lands. Stage 8 generates the full itinerary from saved
          state via planTrip before responding. */}
      <AnimatePresence>
        {isGeneratingPlan && (
          <BrandedLoader
            headline="Building your TRAVION itinerary"
            steps={[
              'Understanding your destination…',
              'Checking your travel dates…',
              'Finding places worth visiting…',
              'Validating real locations…',
              'Optimizing your daily route…',
              'Balancing your travel budget…',
              'Arranging your days…',
              'Finalizing your TRAVION journey…',
            ]}
            durationPerStep={1100}
            onComplete={() => {}}
          />
        )}
      </AnimatePresence>

      {/* Turn-by-Turn Voice Navigation Overlay */}
      <AnimatePresence>
        {navigatingStop && (
          <LiveNavigationMode
            destinationStop={navigatingStop}
            onExit={() => setNavigatingStop(null)}
          />
        )}
      </AnimatePresence>

      {/* Chat Drawer — guide chat opens only when a guide is REALLY assigned
          (spec §26); trip status alone never unlocks it. */}
      <TripChatDrawer
        tripId={activeTrip?.id || ""}
        isOpen={showChatDrawer}
        onClose={() => setShowChatDrawer(false)}
        isGuideAssigned={!!assignedGuide || activeTrip?.status === 'GUIDE_ASSIGNED'}
        assignedGuideName={assignedGuide?.name || ''}
        onTriggerReplan={() => handleTriggerReplan('TIREDNESS')}
        currentPosition={livePosition}
        destinationName={activeTrip?.destination_name}
        tripStart={activeTrip?.start_datetime}
        tripEnd={activeTrip?.end_datetime}
        itinerary={itinerary}
        budgetLabel={itinerary?.cost_breakdown ? `Trip budget ₹${Math.round(itinerary.cost_breakdown.total || 0).toLocaleString('en-IN')}` : undefined}
      />

      {/* Offline Package Modal */}
      <OfflineManager
        tripId={activeTrip?.id || ""}
        isOpen={showOfflineModal}
        onClose={() => setShowOfflineModal(false)}
      />

      {/* Review Modal */}
      <ReviewModal
        tripId={activeTrip?.id || ""}
        guideName={assignedGuide?.name || "your guide"}
        isOpen={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        onSuccess={() => alert(`Thank you! Your review has been attached to ${assignedGuide?.name || "your guide"}'s profile.`)}
      />

      {/* God's Eye View Spatial Intelligence & Speedometer Modal */}
      <GodsEyeViewModal
        isOpen={showGodsEyeView}
        onClose={() => setShowGodsEyeView(false)}
        trip={activeTrip}
        itinerary={itinerary}
        onProceedToPayment={() => setCurrentView('pay')}
      />

      {/* Progress Review Modal — accessible from anywhere across the 11 steps */}
      <ProgressReviewModal
        isOpen={showProgressReview}
        onClose={() => setShowProgressReview(false)}
        trip={activeTrip}
        stageState={stageState}
        answers={answersSoFar}
        onNavigateToStep={(target) => setCurrentView(target as PlannerView)}
      />

      {/* Trip Cancellation & 8-Hour Refund Modal */}
      {activeTrip && (
        <TripCancellationModal
          tripId={activeTrip.id}
          isOpen={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          onCancelled={() => {
            if (activeTrip) {
              api.getTrip(activeTrip.id).then(setActiveTrip).catch(() => {});
            }
          }}
        />
      )}

    </div>
  );
};
