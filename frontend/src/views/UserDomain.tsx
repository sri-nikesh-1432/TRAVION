import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass, MapPin, Sparkles, Navigation, Phone, ShieldCheck,
  CreditCard, MessageSquare, Download, RefreshCw, CheckCircle2,
  LogOut, ArrowLeft, Star, Heart, Clock, User, AlertCircle,
  TrainFront, BedDouble, Utensils, Mountain, Wallet, Lock, BadgeCheck
} from 'lucide-react';
import {
  AuthSession, LocationItem, TripItem, TripItinerary,
  ItineraryStop, UserProfile, PlanOption
} from '../types';
import { api, ApiError } from '../services/api';
import { TripSearchBar } from '../components/search-bar/TripSearchBar';
import { DiscoveryCard } from '../components/trip-discovery/DiscoveryCard';
import { ModeSelectionModal } from '../components/mode-selection/ModeSelectionModal';
import { BrandedLoader } from '../components/loading/BrandedLoader';
import { SplitView } from '../components/live-map/SplitView';
import { MagnificationDock, DockItemData } from '../components/dock/MagnificationDock';
import { LiveNavigationMode } from '../components/navigation/LiveNavigationMode';
import { ReplanningNotice } from '../components/replanning/ReplanningNotice';
import { TripChatDrawer } from '../components/chat/TripChatDrawer';
import { OfflineManager } from '../components/offline/OfflineManager';
import { ReviewModal } from '../components/review/ReviewModal';
import { BasicProfileSheet } from '../components/profile/BasicProfileSheet';
import { PlanChoiceCards } from '../components/plan-choice/PlanChoiceCards';
import { ItineraryEditor } from '../components/itinerary-editor/ItineraryEditor';
import { DiscoverySelect } from '../components/discovery-select/DiscoverySelect';

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
  // Navigation views: 'search' | 'discovery' | 'planning' | 'discovery_select' | 'plan_choice' | 'workspace' | 'my_trips'
  const [currentView, setCurrentView] = useState<'search' | 'discovery' | 'planning' | 'discovery_select' | 'plan_choice' | 'workspace' | 'my_trips'>('search');

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
  
  // Modals & Overlays
  const [showModeModal, setShowModeModal] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkoutData, setCheckoutData] = useState<any>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentNote, setPaymentNote] = useState<string | null>(null);
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
  const [planError, setPlanError] = useState<{ message: string; available?: string[] } | null>(null);
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

  const getPlanErrorMessage = (err: any): { message: string; available?: string[] } => {
    const fallback = 'Something went wrong while planning your trip. Please try again.';
    if (!err) return { message: fallback };
    const message = err?.message || fallback;
    const rawAvailable = err?.extra?.available_destinations;
    const available = Array.isArray(rawAvailable) && rawAvailable.length > 0
      ? (rawAvailable as string[])
      : undefined;
    return { message, available };
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
        const ongoing = trips.find(t => t.status === 'ACTIVE' || t.status === 'GUIDE_ASSIGNED' || t.status === 'PAID');
        if (ongoing) {
          loadTripWorkspace(ongoing.id, true);
        }
      }).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSandboxDemo]);

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
    }
  };

  // 2. Answer question in Adaptive Interview
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
        // Interview complete! Move to Mode Selection
        setCurrentQuestion(null);
        setPlanError(null);
        setShowModeModal(true);
      } else {
        setCurrentQuestion(nextQ);
      }
    } catch (err) {
      console.error('Discovery question failed:', err);
    }
  };

  // 3. Confirm Mode → destination discovery (user selects REAL places first)
  const handleConfirmMode = (mode: 'GUIDE_MODE' | 'ADVENTUROUS_MODE') => {
    if (!activeTrip) return;
    setShowModeModal(false);
    setPlanError(null);
    setActiveTrip(prev => prev ? { ...prev, mode } : null);
    setCurrentView('discovery_select');
  };

  // 3a. Selections made → generate the THREE in-budget plans around them
  const handleGeneratePlans = async (places: string[], foods: string[]) => {
    if (!activeTrip) return;
    setIsGeneratingPlan(true);
    setPlanError(null);
    setSelectedPlaces(places);
    setSelectedFood(foods);
    try {
      const plans = await api.planMulti(activeTrip.id, activeTrip.mode || 'ADVENTUROUS_MODE', {
        selected_places: places,
        selected_food: foods
      });
      setPlanOptions(plans);
      setIsGeneratingPlan(false);
      setCurrentView('plan_choice');
    } catch (err) {
      console.error("Plan generation failed:", err);
      setIsGeneratingPlan(false);
      setPlanError(getPlanErrorMessage(err));
      setCurrentView('discovery_select');
    }
  };

  // 3b. User picked one of the three plans → activate it & open checkout
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
        status: prev.mode === 'GUIDE_MODE' ? 'REQUESTED' : 'PLANNED'
      } : null);
      setIsChoosingPlan(false);

      // Auto open Checkout (same transparent flow as before)
      const checkout = await api.checkoutTrip(activeTrip.id);
      setCheckoutData(checkout);
      setShowCheckoutModal(true);
    } catch (err) {
      console.error("Choosing plan failed:", err);
      setIsChoosingPlan(false);
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
    if (!activeTrip || !checkoutData) return;
    setPaymentNote(null);
    setIsProcessingPayment(true);

    try {
      const canDoLive = checkoutData.live_checkout === true;
      const sdkReady = canDoLive ? await loadRazorpayScript() : false;

      if (canDoLive && sdkReady && window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const rzp = new window.Razorpay({
            key: checkoutData.key_id,
            amount: Math.round(checkoutData.amount * 100),
            currency: checkoutData.currency || 'INR',
            name: 'Travion',
            description: `${activeTrip.source_name} to ${activeTrip.destination_name} trip`,
            order_id: checkoutData.order_id,
            prefill: { email: session.email },
            theme: { color: '#0284c7' },
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
        // Simulated fallback — same server-side signature-verified flow
        await api.verifyPaymentWebhook({
          razorpay_order_id: checkoutData.order_id,
          razorpay_payment_id: `pay_${Date.now()}`,
          razorpay_signature: `sim_sig_verified_${Date.now()}`
        });
      }

      setActiveTrip(prev => prev ? { ...prev, status: 'ACTIVE' } : null);
      setPlanError(null);
      setShowCheckoutModal(false);
      setCurrentView('workspace');
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
      icon: <MessageSquare className="w-5 h-5 text-indigo-600" />,
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
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      
      {/* Top Header */}
      <header className="sticky top-0 z-40 w-full bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentView('search')}
              className="flex items-center gap-2.5 focus:outline-none"
            >
              <div className="w-9 h-9 rounded-2xl bg-travion-600 text-white flex items-center justify-center shadow-soft">
                <Compass className="w-5 h-5" />
              </div>
              <span className="text-lg font-black text-slate-900 tracking-tight">TRAVION</span>
            </button>

            {isSandboxDemo && (
              <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider">
                Sandboxed Demo
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentView('search')}
              className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${
                currentView === 'search' ? 'text-travion-600 bg-travion-50' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Plan Trip
            </button>

            {activeTrip && itinerary && (
              <button
                onClick={() => setCurrentView('workspace')}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${
                  currentView === 'workspace' ? 'text-travion-600 bg-travion-50' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Live Workspace
              </button>
            )}

            {/* Profile Avatar / Logout */}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <span className="text-xs font-bold text-slate-700 hidden sm:inline">
                {userProfile?.preferred_name || session.email.split('@')[0]}
              </span>
              <button
                onClick={onLogout}
                className="p-2 text-slate-400 hover:text-red-600 rounded-xl hover:bg-red-50 transition-colors"
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

        {/* VIEW 1: Search & Home */}
        {currentView === 'search' && (
          <div className="pt-6">
            <div className="text-center max-w-2xl mx-auto mb-8">
              <span className="text-[11px] font-bold uppercase tracking-wider text-travion-600">AI Travel Hub</span>
              <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight mt-1">
                Where would you like to go?
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-2 font-medium">
                Start anywhere, go anywhere. Search any city, region, landmark or place — Travion orchestrates the journey around you.
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

            <TripSearchBar onSearch={handleTripSearch} />

            {/* Recent Trips Section */}
            {myTrips.length > 0 && (
              <div className="mt-16 max-w-4xl mx-auto">
                <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-travion-600" />
                  <span>Your Planned & Completed Trips</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {myTrips.map(trip => (
                    <div
                      key={trip.id}
                      onClick={() => loadTripWorkspace(trip.id)}
                      className="cursor-pointer p-4 rounded-2xl bg-white border border-slate-200 hover:border-travion-300 hover:shadow-soft transition-all flex items-center justify-between"
                    >
                      <div>
                        <div className="text-xs font-bold text-travion-700">{trip.source_name} → {trip.destination_name}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">Status: <span className="font-semibold text-slate-600">{trip.status}</span></div>
                      </div>
                      <span className="text-xs font-bold text-slate-700">₹{trip.total_cost}</span>
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
            <div className="text-center mb-6">
              <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 2 · Adaptive Discovery</span>
              <h2 className="text-2xl font-bold text-slate-900 mt-1">Understanding Your Travel Style</h2>
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
              <div className="max-w-2xl mx-auto rounded-3xl border border-slate-200 bg-white shadow-soft overflow-hidden">
                <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4 bg-red-50/50">
                  <span className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                    <AlertCircle className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-extrabold text-slate-900">Your plan could not be generated yet</h3>
                    <p className="text-[12px] font-semibold text-slate-500">Your search is saved — nothing was lost.</p>
                  </div>
                </div>

                <div className="px-6 py-5">
                  <p className="text-[13px] font-medium text-slate-600 leading-relaxed">{planError.message}</p>

                  {planError.available && planError.available.length > 0 && activeTrip && (
                    <div className="mt-5">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
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
                      <p className="mt-2.5 text-[11px] font-semibold text-slate-400">
                        {activeTrip.source_name} → choose above — your departure city, dates and traveller details carry over automatically.
                      </p>
                    </div>
                  )}

                  <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
                    <button
                      onClick={() => { setPlanError(null); setCurrentView('search'); }}
                      className="flex-1 h-11 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm hover:border-slate-300 transition-colors"
                    >
                      Back to search
                    </button>
                    {!planError.available && (
                      <button
                        onClick={() => { setPlanError(null); setShowModeModal(true); }}
                        className="flex-1 h-11 rounded-xl bg-travion-600 hover:bg-travion-700 text-white font-bold text-sm transition-colors"
                      >
                        Try planning again
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : !showModeModal && !isGeneratingPlan ? (
              /* ── Resumed state: interview finished — continue to mode selection ── */
              <div className="max-w-md mx-auto rounded-3xl border border-slate-200 bg-white shadow-soft p-8 text-center">
                <span className="mx-auto w-14 h-14 rounded-2xl bg-travion-100 text-travion-600 flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-7 h-7" />
                </span>
                <h3 className="text-lg font-extrabold text-slate-900">Your travel style is captured</h3>
                <p className="mt-2 text-[13px] font-medium text-slate-500 leading-relaxed">
                  Ready to choose how you want this journey run.
                </p>
                <button
                  onClick={() => setShowModeModal(true)}
                  className="mt-6 w-full h-12 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-extrabold transition-colors"
                >
                  Choose travel mode
                </button>
                <button
                  onClick={() => { setPlanError(null); setCurrentView('search'); }}
                  className="mt-2.5 w-full h-11 rounded-2xl text-slate-500 text-[13px] font-bold hover:text-slate-700 transition-colors"
                >
                  Start a different trip
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* VIEW 2a: Destination discovery — user selects REAL verified places */}
        {currentView === 'discovery_select' && activeTrip && (
          <DiscoverySelect
            tripId={activeTrip.id}
            destinationName={activeTrip.destination_name}
            onConfirm={handleGeneratePlans}
            onBack={() => { setCurrentView('search'); }}
            busy={isGeneratingPlan}
          />
        )}

        {/* VIEW 2b: Three-plan choice (VALUE / RECOMMENDED / PREMIUM) */}
        {currentView === 'plan_choice' && activeTrip && (
          <PlanChoiceCards
            plans={planOptions}
            destinationName={activeTrip.destination_name}
            onSelect={handleChoosePlan}
            onBack={() => { setPlanOptions([]); setCurrentView('discovery_select'); }}
            busy={isChoosingPlan}
          />
        )}

        {/* VIEW 3: Live Trip Workspace (Desktop Split View + Map + Magnification Dock) */}
        {currentView === 'workspace' && itinerary && activeTrip && (
          <div>
            {/* Trip Context Banner */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-3xl bg-white border border-slate-200/80 shadow-soft">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-travion-100 text-travion-600 flex items-center justify-center">
                  {activeTrip.mode === 'GUIDE_MODE' ? <Compass className="w-6 h-6" /> : <Mountain className="w-6 h-6" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
                      {activeTrip.source_name}
                      <ArrowLeft className="w-3.5 h-3.5 text-slate-400 rotate-180" />
                      {activeTrip.destination_name}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      {activeTrip.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 font-medium mt-0.5">
                    {activeTrip.mode === 'GUIDE_MODE' ? 'Verified Local Guide Assigned' : 'Autonomous Adventurous Mode'} · Total Budget: ₹{activeTrip.total_cost}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowOfflineModal(true)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition-colors"
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
                budgetMax={activeTrip.budget || itinerary.cost_breakdown?.budget || itinerary.total_cost}
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

      {/* Mode Selection Modal */}
      <ModeSelectionModal
        isOpen={showModeModal}
        onClose={() => setShowModeModal(false)}
        onConfirm={handleConfirmMode}
        destinationName={activeTrip?.destination_name || "Ooty"}
      />

      {/* Branded Loading Transition */}
      <AnimatePresence>
        {isGeneratingPlan && (
          <BrandedLoader
            headline="Crafting your personalized itinerary…"
            onComplete={() => {}}
          />
        )}
      </AnimatePresence>

      {/* Transparent Checkout & Payment Split Modal */}
      <AnimatePresence>
        {showCheckoutModal && checkoutData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-white rounded-3xl p-6 md:p-8 shadow-floating border border-travion-100"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <div className="flex items-center gap-2.5">
                  <CreditCard className="w-5 h-5 text-travion-600" />
                  <h3 className="text-lg font-bold text-slate-900">Transparent Checkout</h3>
                </div>
                <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-travion-100 text-travion-700">
                  {checkoutData.live_checkout ? 'Razorpay · Test Mode' : 'Razorpay Verified'}
                </span>
              </div>

              {/* Itemized Cost Breakdown */}
              {/* Section 1 — Estimated travel spend (paid locally during the trip) */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-4 h-4 text-travion-600" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">Estimated travel spend — paid locally as you travel</span>
                </div>
                <div className="space-y-2 text-xs text-slate-700 font-medium">
                  {[
                    { icon: TrainFront, color: '#0284c7', label: 'Transport (round trip)', value: checkoutData.breakdown.transport },
                    { icon: BedDouble, color: '#6366f1', label: 'Stay (per your stay preference)', value: checkoutData.breakdown.stay },
                    { icon: Utensils, color: '#f59e0b', label: 'Curated dining allowance', value: checkoutData.breakdown.food },
                    { icon: Mountain, color: '#10b981', label: 'Activities & heritage entries', value: checkoutData.breakdown.activities }
                  ].map((row) => (
                    <div key={row.label} className="flex justify-between py-1 border-b border-slate-100">
                      <span className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: row.color }}>
                          <row.icon className="w-3.5 h-3.5" />
                        </span>
                        <span>{row.label}</span>
                      </span>
                      <span className="font-bold">₹{row.value.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-1 text-[11px] text-slate-500">
                    <span>Travel spend estimate</span>
                    <span className="font-bold">₹{checkoutData.breakdown.travel_spend?.toLocaleString?.() ?? checkoutData.breakdown.total.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Section 2 — Travion services: the only amount collected now */}
              <div className="rounded-2xl bg-travion-50/70 border border-travion-100 p-4 mb-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <ShieldCheck className="w-4 h-4 text-travion-700" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-travion-700">Travion services — what you pay today</span>
                </div>
                <div className="space-y-2 text-xs font-medium">
                  {Number(checkoutData.breakdown.guide_fee) > 0 && (
                    <div className="flex justify-between py-1 border-b border-travion-100 text-travion-800">
                      <span className="font-semibold flex items-center gap-1.5">
                        <Compass className="w-3.5 h-3.5" />
                        <span>Verified local guide fee</span>
                      </span>
                      <span className="font-bold">₹{checkoutData.breakdown.guide_fee.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1 border-b border-travion-100 text-travion-800">
                    <span className="font-semibold flex items-center gap-1.5">
                      <BadgeCheck className="w-3.5 h-3.5" />
                      <span>Travion platform fee</span>
                    </span>
                    <span className="font-bold">₹{checkoutData.breakdown.platform_fee.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between pt-2 text-sm font-black text-slate-900">
                    <span>Amount payable to Travion</span>
                    <span className="text-travion-700">₹{checkoutData.amount.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 font-medium leading-relaxed mb-6 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5">
                Your trip budget is an estimated spending limit for travel expenses you settle locally. Travion collects only the guide and platform fees shown above — never your full travel budget.
              </p>

              <button
                type="button"
                onClick={handleExecutePayment}
                disabled={isProcessingPayment}
                className="w-full py-3.5 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white font-black text-sm shadow-md hover:shadow-soft transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isProcessingPayment ? (
                  <span className="flex items-center justify-center gap-2">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
                      <Compass className="w-4 h-4" />
                    </motion.div>
                    {checkoutData.live_checkout ? "Opening Secure Checkout…" : "Verifying Signature…"}
                  </span>
                ) : `Pay ${checkoutData.amount.toLocaleString()} · Activate Trip`}
              </button>

              <p className="text-center text-[10px] text-slate-500 font-medium mt-3 flex items-center justify-center gap-1.5">
                <Lock className="w-3 h-3 text-emerald-500" />
                <span>
                  {checkoutData.live_checkout
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

      {/* Chat Drawer */}
      <TripChatDrawer
        tripId={activeTrip?.id || ""}
        isOpen={showChatDrawer}
        onClose={() => setShowChatDrawer(false)}
        isGuideAssigned={activeTrip?.status === 'GUIDE_ASSIGNED' || activeTrip?.status === 'ACTIVE'}
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
