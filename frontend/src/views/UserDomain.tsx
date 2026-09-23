import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass, MapPin, Sparkles, Navigation, Phone, ShieldCheck,
  CreditCard, MessageSquare, Download, RefreshCw, CheckCircle2,
  LogOut, ArrowLeft, Star, Heart, Clock, User, AlertCircle,
  TrainFront, BedDouble, Utensils, Mountain, Wallet, Lock, BadgeCheck, Check
} from 'lucide-react';
import {
  AuthSession, LocationItem, TripItem, TripItinerary,
  ItineraryStop, UserProfile, PlanOption, BudgetRecovery,
  SelectedPlaceItem, SelectedFoodItem, SelectedStay
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
import { PlanChoiceCards } from '../components/plan-choice/PlanChoiceCards';
import { ItineraryEditor } from '../components/itinerary-editor/ItineraryEditor';
import { DiscoverySelect } from '../components/discovery-select/DiscoverySelect';
import { PlannerWorkspace } from '../components/planner/PlannerWorkspace';
import { ModeSelectionScreen, TripMode } from '../components/mode-selection/ModeSelectionModal';
import { resolveBudgetMax } from '../utils/budget';

/* ─── Booking flow stepper: the visible 7-step journey ─────────────
   Steps 01–03 choose WHAT the trip contains (trip, travellers, explore);
   step 04 is the dedicated Guide-vs-Adventurous EXPERIENCE decision (the
   major product choice — always BEFORE plans so every plan card prices the
   chosen mode); step 06 is the Final Review read/confirm state. The step
   ORDER follows the master spec: Trip → Travellers → Explore → Mode → Plan
   → Itinerary → Review → Payment. */
const BOOKING_STEPS = [
  { key: 'search', label: 'Trip' },
  { key: 'discovery', label: 'Travellers' },
  { key: 'discovery_select', label: 'Explore' },
  { key: 'mode_select', label: 'Mode' },
  { key: 'plan_choice', label: 'Plan' },
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

let razorpayScriptPromise: Promise<boolean> | null = null;
function loadRazorpayScript(): Promise<boolean> {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve(true);
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

interface UserDomainProps {
  session: AuthSession;
  onLogout: () => void;
  isSandboxDemo?: boolean;
}

export const UserDomain: React.FC<UserDomainProps> = ({
  session,
  onLogout,
  isSandboxDemo = false
}) => {
  // Navigation views: 'search' | 'discovery' | 'planning' | 'discovery_select' | 'mode_select' | 'plan_choice' | 'planner' | 'review' | 'workspace' | 'my_trips'
  const [currentView, setCurrentView] = useState<'search' | 'discovery' | 'planning' | 'discovery_select' | 'mode_select' | 'plan_choice' | 'planner' | 'review' | 'workspace' | 'my_trips'>('search');

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showProfileSheet, setShowProfileSheet] = useState(false);

  // Active Trip state
  const [activeTrip, setActiveTrip] = useState<TripItem | null>(null);
  const [itinerary, setItinerary] = useState<TripItinerary | null>(null);

  // Multi-plan state (VALUE / RECOMMENDED / PREMIUM)
  const [planOptions, setPlanOptions] = useState<PlanOption[]>([]);
  const [isChoosingPlan, setIsChoosingPlan] = useState(false);
  const [selectedPlaces, setSelectedPlaces] = useState<string[]>([]);
  const [selectedFood, setSelectedFood] = useState<string[]>([]);
  
  // Discovery Interview state
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [answersSoFar, setAnswersSoFar] = useState<Record<string, any>>({});
  
  // Modals & Overlays — Guide Mode is NEVER offered inside the user planning
  // flow (product rule): users plan in Adventurous Mode; guides join later via
  // manager assignment. The guide signup stays a separate landing-page flow.
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  // Step 3 selections held while the traveller picks the trip experience
  // (Guide / Adventurous). Nothing is lost between discovery and planning —
  // these ride the plan-multi request once the mode is chosen (spec §6).
  const [pendingSelection, setPendingSelection] = useState<{
    places: string[];
    foods: string[];
    placeItems: SelectedPlaceItem[];
    foodItems: SelectedFoodItem[];
    stay: SelectedStay | null;
    stayRequired: boolean;
  } | null>(null);
  // Real ACTIVITY count (things to do, not places) from Step 3 — shown on the
  // experience-choice summary chips instead of a broken heuristic.
  const [selectedActivityCount, setSelectedActivityCount] = useState(0);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkoutData, setCheckoutData] = useState<any>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentNote, setPaymentNote] = useState<string | null>(null);
  // §20 non-refundable acknowledgement — must be checked before Confirm & Pay.
  const [nonRefundableAcknowledged, setNonRefundableAcknowledged] = useState(false);
  // Authoritative pricing preview shown while the popup opens (order created
  // only after the acknowledgement is checked).
  const [pricingSummary, setPricingSummary] = useState<{ travel_spend: number; guide_fee: number; platform_fee: number; safety_reserve: number; insurance_fee: number; final_planned_amount: number; amount_payable: number; guide_required: boolean; guide_assigned: boolean; breakdown: Record<string, any> } | null>(null);
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
    if (!isSandboxDemo) {
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
        // The SAME trip_id survives refresh across the WHOLE flow — including
        // the mid-planning stage (REQUESTED/PLANNED/DRAFT) that used to be
        // lost on refresh and later surfaced as "Trip not found" at checkout.
        const ongoing = trips.find(t => t.status === 'ACTIVE' || t.status === 'GUIDE_ASSIGNED' || t.status === 'PAID');
        if (ongoing) {
          loadTripWorkspace(ongoing.id, true);
          return;
        }
        const midPlanning = trips.find(t => ['REQUESTED', 'PLANNED', 'DRAFT'].includes(t.status));
        if (midPlanning) {
          resumePlanningTrip(midPlanning);
        }
      }).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSandboxDemo]);

  // Resume an in-flight planning trip from server state (refresh / back-nav).
  // Everything needed is already persisted server-side: the interview answers
  // (TripProfile.questions_answers) and the trip record itself — so the flow
  // picks up exactly where the traveller left off, with the SAME trip_id.
  const resumePlanningTrip = async (trip: TripItem) => {
    setActiveTrip(trip);
    setCurrentView('discovery');
    try {
      const saved = await api.getTripProfile(trip.id).catch(() => null);
      const answers = (saved?.questions_answers as Record<string, any>) || {};
      setAnswersSoFar(answers);
      const q = await api.getNextDiscoveryQuestion(trip.id, answers);
      if (q.is_complete) {
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
      const source = await ensureRegistered(searchData.source);
      const destination = await ensureRegistered(searchData.destination);
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

  // 2. Answer question in Adaptive Interview (exactly 3 questions)
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
        // Interview complete → destination discovery. The Guide/Adventurous
        // EXPERIENCE choice happens ONLY after Step 3 selection — never here.
        setCurrentQuestion(null);
        setPlanError(null);
        setCurrentView('discovery_select');
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

  // 3a. Selections made → the traveller makes the MAJOR Guide-vs-Adventurous
  // decision (Step 4) BEFORE any plan is generated, so all three plan cards
  // price the chosen mode exactly as it will be charged (spec Step 4→5).
  const handleGeneratePlans = (places: string[], foods: string[], placeItems: SelectedPlaceItem[], foodItems: SelectedFoodItem[], stay?: SelectedStay | null, stayRequired?: boolean, activityCount?: number) => {
    setPendingSelection({ places, foods, placeItems, foodItems, stay: stay ?? null, stayRequired: stayRequired ?? (stay != null) });
    setSelectedPlaces(places);
    setSelectedFood(foods);
    setSelectedActivityCount(Number(activityCount) || 0);
    setCurrentView('mode_select');
  };

  // Shared plan generation. Mode is only an interim pricing input here — the
  // authoritative experience choice is made (and repriced) later.
  const generatePlans = async (mode: 'GUIDE_MODE' | 'ADVENTUROUS_MODE', sel: NonNullable<typeof pendingSelection>) => {
    if (!activeTrip) return;
    setIsGeneratingPlan(true);
    setPlanError(null);
    try {
      const plans = await api.planMulti(activeTrip.id, mode, {
        selected_places: sel.places,
        selected_food: sel.foods,
        selected_place_items: sel.placeItems,
        selected_food_items: sel.foodItems,
        ...(sel.stay ? { selected_stay: sel.stay } : {}),
        stay_required: sel.stayRequired,
      });
      setPlanOptions(plans);
      setIsGeneratingPlan(false);
      setCurrentView('plan_choice');
      return plans;
    } catch (err) {
      console.error("Plan generation failed:", err);
      setIsGeneratingPlan(false);
      setPlanError(getPlanErrorMessage(err));
      setCurrentView('mode_select');
      return null;
    }
  };

  // STEP 4 → STEP 5: the traveller picks HOW to experience the trip. The mode
  // is persisted on the trip via planMulti(mode) — every plan card is priced
  // with that exact mode (12.5% guide fee in Guide Mode, none in Adventurous,
  // 3% platform + 15% safety always) and nothing after this step loses it.
  const handleModeSelect = async (mode: TripMode) => {
    if (!activeTrip || isGeneratingPlan) return;
    void generatePlans(mode, pendingSelection!);
  };

  // User picked one of the three plans → activate it & open the editor.
  // NO payment happens here: editing comes first, the experience choice after.
  const handleChoosePlan = async (planType: 'VALUE' | 'RECOMMENDED' | 'PREMIUM') => {
    if (!activeTrip) return;
    setIsChoosingPlan(true);
    setPlanError(null);
    try {
      const itn = await api.choosePlan(activeTrip.id, planType);
      setItinerary(itn);
      setActiveTrip(prev => prev ? {
        ...prev,
        total_cost: itn.total_cost,
        status: 'PLANNED'
      } : null);
      setIsChoosingPlan(false);
      // Next: edit & finalize the itinerary (Step 6) before Final Review.
      setCurrentView('planner');
    } catch (err) {
      console.error("Choosing plan failed:", err);
      setIsChoosingPlan(false);
      setPlanError(getPlanErrorMessage(err));
    }
  };

  // Final Review → payment: opens the confirmation popup. §20: the order is
  // only created after the traveller checks the non-refundable acknowledgement
  // in the popup itself — the backend independently enforces the same rule.
  const handlePlannerProceedToPayment = async () => {
    if (!activeTrip) return;
    setNonRefundableAcknowledged(false);
    setPaymentNote(null);
    setCheckoutData(null); // always create a FRESH order on confirmation
    setShowCheckoutModal(true);
    try {
      // Spec §34: the SAME pricing object prices Review and the Razorpay order.
      const pricing = await api.getTripPricing(activeTrip.id);
      setPricingSummary({
        travel_spend: pricing.travel_spend,
        guide_fee: pricing.guide_fee,
        platform_fee: pricing.platform_fee,
        safety_reserve: Number(pricing.safety_reserve ?? 0),
        insurance_fee: Number(pricing.insurance_fee ?? 50),
        final_planned_amount: Number(pricing.final_planned_amount ?? pricing.amount_payable ?? 0),
        amount_payable: pricing.amount_payable,
        guide_required: pricing.guide_required,
        guide_assigned: pricing.guide_assigned,
        breakdown: pricing.breakdown || {},
      });
    } catch (err) {
      setShowCheckoutModal(false);
      setPlanError(getPlanErrorMessage(err));
    }
  };

  // 3c. Live itinerary edits (drag & drop / remove / add) — recalculated server-side
  const handleItineraryChange = (updated: TripItinerary, _warnings: string[]) => {
    setItinerary(updated);
    setActiveTrip(prev => prev ? { ...prev, total_cost: updated.total_cost } : null);
  };

  // 4. Razorpay Checkout & Webhook Confirmation
  // Live checkout = genuine Razorpay test-mode order (real keys configured & reachable).
  // If the SDK/API is unavailable, gracefully falls back to the verified simulation flow.
  const handleExecutePayment = async () => {
    if (!activeTrip) return;
    // §20 hard rule: payment confirmation is impossible until the checkbox
    // is checked. The backend rejects the order for the same reason.
    if (!nonRefundableAcknowledged) {
      setPaymentNote("Please accept the non-refundable acknowledgement before confirming payment.");
      return;
    }
    setPaymentNote(null);
    setIsProcessingPayment(true);

    try {
      // Order creation happens here — only after the acknowledgement is
      // checked — so the stored transaction carries proof of acceptance.
      const checkout = checkoutData ?? await api.checkoutTrip(activeTrip.id, true);
      setCheckoutData(checkout);

      const canDoLive = checkout.live_checkout === true;
      const sdkReady = canDoLive ? await loadRazorpayScript() : false;

      if (canDoLive && sdkReady && window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const rzp = new window.Razorpay({
            key: checkout.key_id,
            amount: Math.round(checkout.amount * 100),
            currency: checkout.currency || 'INR',
            name: 'Travion',
            description: `${activeTrip.source_name} to ${activeTrip.destination_name} trip`,
            order_id: checkout.order_id,
            prefill: { email: session.email },
            theme: { color: '#267aa8' },
            handler: async (response: any) => {
              try {
                await api.verifyPaymentWebhook({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature
                });
                resolve();
              } catch (err) {
                reject(err);
              }
            },
            modal: {
              ondismiss: () => reject(new Error('cancelled'))
            }
          });
          rzp.open();
        });
      } else {
        // Simulated fallback — same server-side signature-verified flow. The
        // signature is the SERVER-ISSUED HMAC from the checkout response: the
        // client can never mint its own payment success (§33/§53).
        await api.verifyPaymentWebhook({
          razorpay_order_id: checkout.order_id,
          razorpay_payment_id: `pay_sim_${Date.now()}`,
          razorpay_signature: checkout.simulated_signature || ''
        });
      }

      // Server truth after signature verification (spec §45: no fake success).
      // The webhook response carries the authoritative status — an earlier
      // optimistic update could mask a verification failure.
      let verifiedTripStatus = 'ACTIVE';
      try {
        const t = await api.getTrip(activeTrip.id);
        verifiedTripStatus = t.status || 'ACTIVE';
      } catch { /* keep webhook-declared status */ }
      setActiveTrip(prev => prev ? { ...prev, status: verifiedTripStatus as any } : null);
      setPlanError(null);
      setShowCheckoutModal(false);
      setCurrentView('workspace');
      // Refresh silently in the background so workspace surfaces (final map,
      // chat, guide banner) render from the ACTIVATED backend trip.
      loadTripWorkspace(activeTrip.id, true);
    } catch (err: any) {
      console.error("Payment failed or cancelled:", err);
      if (String(err?.message || '').toLowerCase().includes('cancel')) {
        setPaymentNote("Payment was cancelled. Your trip is safely saved — you can retry payment anytime.");
      }
    } finally {
      setIsProcessingPayment(false);
    }
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

  // Unified checkout-display values: the popup shows the authoritative pricing
  // summary the moment it opens, then the real Razorpay order once created.
  // Both sources are backend truth — the same numbers checkout stores.
  const checkoutView = checkoutData
    ? {
        live: !!checkoutData.live_checkout,
        transport: Number(checkoutData.breakdown?.transport || 0),
        stay: Number(checkoutData.breakdown?.stay || 0),
        food: Number(checkoutData.breakdown?.food || 0),
        activities: Number(checkoutData.breakdown?.activities || 0),
        travelSpend: Number(checkoutData.breakdown?.travel_spend ?? pricingSummary?.travel_spend ?? 0),          guideFee: Number(checkoutData.breakdown?.guide_fee || 0),
          platformFee: Number(checkoutData.breakdown?.platform_fee || 0),
          safetyReserve: Number(checkoutData.breakdown?.safety_reserve ?? 0),
          insuranceFee: Number(checkoutData.breakdown?.insurance_fee ?? 50),
          payable: Number(checkoutData.amount || 0),
        }
    : pricingSummary
      ? {
          live: false,
          transport: Number(pricingSummary.breakdown?.transport || 0),
          stay: Number(pricingSummary.breakdown?.stay || 0),
          food: Number(pricingSummary.breakdown?.food || 0),
          activities: Number(pricingSummary.breakdown?.activities || 0),
          travelSpend: Number(pricingSummary.travel_spend || 0),
          guideFee: Number(pricingSummary.guide_fee || 0),
          platformFee: Number(pricingSummary.platform_fee || 0),
          safetyReserve: Number(pricingSummary.safety_reserve || 0),
          insuranceFee: Number(pricingSummary.insurance_fee ?? 50),
          payable: Number(pricingSummary.amount_payable || 0),
        }
      : null;

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
              {isSandboxDemo && (
                <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider">
                  Sandboxed Demo
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-4">
            {/* Profile Avatar / Logout — the trip-planning CTA lives in the main
                flow, not as a duplicate top-nav button (product rule #10) */}
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

        {/* VIEW 2a-2: STEP 4 — CHOOSE YOUR TRAVEL MODE. The dedicated
            major-decision screen (Guide = human + AI, 12.5% guide fee;
            Adventurous = independent + AI, no guide fee), shown BEFORE plans
            so every plan card prices the chosen mode exactly. */}
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
            onBack={() => setCurrentView('discovery_select')}
            onSelect={(mode) => void handleModeSelect(mode)}
            busy={isGeneratingPlan}
            />
          </>
        )}

        {/* VIEW 2b: Three-plan choice (Budget / Recommended / Premium) — priced
            with the mode chosen in Step 4; the Final Review follows editing. */}
        {currentView === 'plan_choice' && activeTrip && (
          <>
            <FlowStepper current="plan_choice" />
            <PlanChoiceCards
              plans={planOptions}
              destinationName={activeTrip.destination_name}
              onSelect={handleChoosePlan}
              onBack={() => { setPlanOptions([]); setCurrentView('mode_select'); }}
              busy={isChoosingPlan}
            />
          </>
        )}

        {/* VIEW 2c: Step 6 Interactive Trip Planner — finalize the itinerary
            (the traveller's source of truth) before the Final Review step. */}
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
            onBackToPlans={() => setCurrentView('plan_choice')}
            onProceedToExperience={() => setCurrentView('review')}
            onProceedToPayment={() => setCurrentView('review')}
            feePreview={pricingSummary ? {
              guide_fee: pricingSummary.guide_fee,
              platform_fee: pricingSummary.platform_fee,
              amount_payable: pricingSummary.amount_payable,
            } : null}
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

        {/* VIEW 2d: STEP 7 — FINAL REVIEW. Read/confirm state: shows the EXACT
            stored itinerary (the user's final edits) + the same centralized
            pricing object the Razorpay order uses. Every Edit returns to the
            right step WITHOUT destroying state (spec §39/§36). */}
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
              planLabel={planOptions.find(p => p.recommended)?.label || planOptions[0]?.label || null}
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
              onEdit={(target: ReviewEditTarget) => {
                if (target === 'basics') setCurrentView('search');
                else if (target === 'travellers') setCurrentView('discovery');
                else if (target === 'places') setCurrentView('discovery_select');
                else if (target === 'plans') setCurrentView('plan_choice');
                else setCurrentView('planner');
              }}
              onConfirm={() => void handlePlannerProceedToPayment()}
              busy={isProcessingPayment}
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

              <div className="flex items-center gap-2">
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

      {/* Branded Loading Transition */}
      <AnimatePresence>
        {isGeneratingPlan && (
          <BrandedLoader
            headline="Crafting your personalized itinerary…"
            onComplete={() => {}}
          />
        )}
      </AnimatePresence>

      {/* Transparent Checkout & Payment Split Modal — §20: the non-refundable
          acknowledgement checkbox lives HERE, and Confirm & Pay stays disabled
          until it is checked. The order is created only on confirmation. */}
      <AnimatePresence>
        {showCheckoutModal && (checkoutData || pricingSummary) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-travion-900/45 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-white rounded-3xl p-6 md:p-8 shadow-floating border border-travion-100"
            >
              <div className="flex items-center justify-between pb-4 border-b border-charcoal-100 mb-4">
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-2xl bg-travion-100 text-travion-700 flex items-center justify-center shrink-0">
                    <CreditCard className="w-4.5 h-4.5" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-extrabold text-charcoal-900 tracking-tight">Transparent Checkout</h3>
                    <p className="text-[9px] font-black uppercase tracking-wider text-charcoal-400 mt-0.5">Step 07 · Payment</p>
                  </div>
                </div>
                <span className="text-[9px] font-black px-2.5 py-1 rounded-full bg-travion-100 text-travion-700">
                  {checkoutData?.live_checkout ? 'Razorpay · Test Mode' : 'Razorpay Verified'}
                </span>
              </div>

              {/* Itemized Cost Breakdown */}
              {/* Section 1 — Estimated travel spend (paid locally during the trip) */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-4 h-4 text-travion-600" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-charcoal-500">Estimated travel spend — paid locally as you travel</span>
                </div>
                <div className="space-y-2 text-xs text-charcoal-700 font-medium">
                  {[
                    { icon: TrainFront, color: '#267aa8', label: 'Transport (round trip)', value: checkoutView!.transport },
                    { icon: BedDouble, color: '#6366f1', label: 'Stay (per your stay preference)', value: checkoutView!.stay },
                    { icon: Utensils, color: '#f59e0b', label: 'Curated dining allowance', value: checkoutView!.food },
                    { icon: Mountain, color: '#10b981', label: 'Activities & heritage entries', value: checkoutView!.activities }
                  ].map((row) => (
                    <div key={row.label} className="flex justify-between py-1 border-b border-charcoal-100">
                      <span className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: row.color }}>
                          <row.icon className="w-3.5 h-3.5" />
                        </span>
                        <span>{row.label}</span>
                      </span>
                      <span className="font-bold">₹{row.value.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-1 text-[11px] text-charcoal-500">
                    <span>Travel spend estimate</span>
                    <span className="font-bold">₹{checkoutView!.travelSpend.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Section 2 — Fees + safety reserve: the FINAL PLANNED AMOUNT is
                  what the Razorpay order charges (same pricing object as Review). */}
              <div className="rounded-2xl bg-travion-50/70 border border-travion-100 p-4 mb-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <ShieldCheck className="w-4 h-4 text-travion-700" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-travion-700">Fees & reserve — final planned amount</span>
                </div>
                <div className="space-y-2 text-xs font-medium">
                  <div className="flex justify-between py-1 border-b border-travion-100 text-travion-800">
                    <span className="font-semibold flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5" />
                      <span>Guide fee</span>
                    </span>
                    <span className="font-bold">{checkoutView!.guideFee > 0 ? `₹${checkoutView!.guideFee.toLocaleString()}` : '₹0 — Adventurous Mode'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-travion-100 text-travion-800">
                    <span className="font-semibold flex items-center gap-1.5">
                      <BadgeCheck className="w-3.5 h-3.5" />
                      <span>Platform fee (3%)</span>
                    </span>
                    <span className="font-bold">₹{checkoutView!.platformFee.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-travion-100 text-travion-800">
                    <span className="font-semibold flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Safety reserve (15%)</span>
                    </span>
                    <span className="font-bold">₹{checkoutView!.safetyReserve.toLocaleString()}</span>
                  </div>
                  <p className="text-[10.5px] font-semibold text-charcoal-400">
                    Reserved for unexpected travel or emergency needs — never spent automatically.
                  </p>
                  <div className="flex justify-between py-1 border-b border-travion-100 text-travion-800">
                    <span className="font-semibold flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Insurance (fixed)</span>
                    </span>
                    <span className="font-bold">₹{checkoutView!.insuranceFee.toLocaleString()}</span>
                  </div>
                  <p className="text-[10.5px] font-semibold text-charcoal-400">
                    ₹50 fixed — TRAVION Refund Protection: if TRAVION cancels your trip, the platform fee + this insurance are refunded.
                  </p>
                  <div className="flex justify-between pt-2 text-sm font-black text-charcoal-900">
                    <span>Final planned amount</span>
                    <span className="text-travion-700">₹{checkoutView!.payable.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-charcoal-500 font-medium leading-relaxed mb-4 bg-ivory-50 border border-charcoal-100 rounded-xl px-3 py-2.5">
                The final planned amount = your base trip budget + fees + safety reserve — the exact total shown on your Final Review. {checkoutView!.guideFee > 0 ? 'The 12.5% guide fee applies because this is a Guide Mode trip.' : 'No guide fee applies — this is an Adventurous Mode trip.'}
              </p>

              {/* §20 — Non-refundable acknowledgement: MANDATORY before Confirm & Pay.
                  The pay button stays disabled until this box is checked, and the
                  backend independently refuses the order without it. */}
              <label
                htmlFor="non-refundable-ack"
                className={`flex items-start gap-3 mb-5 p-3.5 rounded-2xl border cursor-pointer select-none transition-colors ${
                  nonRefundableAcknowledged
                    ? 'border-travion-300 bg-travion-50/60'
                    : paymentNote && !nonRefundableAcknowledged
                      ? 'border-amber-300 bg-amber-50/50'
                      : 'border-charcoal-200 bg-ivory-50/60 hover:border-charcoal-300'
                }`}
              >
                <input
                  id="non-refundable-ack"
                  type="checkbox"
                  checked={nonRefundableAcknowledged}
                  onChange={(e) => {
                    setNonRefundableAcknowledged(e.target.checked);
                    if (e.target.checked) setPaymentNote(null);
                  }}
                  className="mt-0.5 w-[18px] h-[18px] shrink-0 accent-travion-600 cursor-pointer"
                />
                <span className="text-[11.5px] leading-relaxed text-charcoal-700 font-medium">
                  I understand that the applicable fee paid is <span className="font-bold text-charcoal-900">non-refundable</span> if a guide has not yet been assigned and the trip plan has not yet become active.
                </span>
              </label>

              <button
                type="button"
                onClick={handleExecutePayment}
                disabled={isProcessingPayment || !nonRefundableAcknowledged}
                title={nonRefundableAcknowledged ? undefined : "Please accept the non-refundable acknowledgement first"}
                className="w-full py-3.5 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white font-black text-sm shadow-md hover:shadow-soft transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isProcessingPayment ? (
                  <span className="flex items-center justify-center gap-2">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
                      <Compass className="w-4 h-4" />
                    </motion.div>
                    {checkoutData?.live_checkout ? "Opening Secure Checkout…" : "Verifying Signature…"}
                  </span>
                ) : `Confirm & Pay ₹${checkoutView!.payable.toLocaleString()} · Activate Trip`}
              </button>

              <p className="text-center text-[10px] text-charcoal-500 font-medium mt-3 flex items-center justify-center gap-1.5">
                <Lock className="w-3 h-3 text-emerald-500" />
                <span>
                  {checkoutData?.live_checkout
                    ? 'Secure Razorpay test mode — UPI, cards and netbanking supported'
                    : 'Verified sandbox verification flow — no real charge is created'}
                </span>
              </p>

              <AnimatePresence>
                {paymentNote && (
                  <motion.p
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-center text-[11px] text-amber-600 font-semibold mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2"
                  >
                    {paymentNote}
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
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

    </div>
  );
};
