import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Compass,
  Luggage,
  Camera,
  Heart,
  Settings,
  ArrowRight,
  Calendar,
  Sparkles,
  User,
  LogOut,
  MapPin,
  Navigation,
  CheckCircle2,
  Clock,
  Landmark,
  Utensils,
  Mountain,
  ChevronRight,
  Sun,
  Shield,
  BarChart3,
  TrendingUp,
  Receipt,
  Wallet,
  PieChart,
  Upload,
} from 'lucide-react';
import { TripItem, UserProfile } from '../../types';

export type DashboardTab = 'planned' | 'analytics' | 'memories' | 'dna' | 'settings';

interface TravellerSideDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile?: UserProfile | null;
  userEmail: string;
  trips: TripItem[];
  initialTab?: DashboardTab;
  onPlanNewTrip: () => void;
  onResumeTrip: (trip: TripItem) => void;
  onViewPaidTrip: (trip: TripItem) => void;
  onLogout: () => void;
  onEditProfile?: () => void;
}

const inr = (n: number | null | undefined) =>
  `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export const TravellerSideDashboard: React.FC<TravellerSideDashboardProps> = ({
  isOpen,
  onClose,
  userProfile,
  userEmail,
  trips,
  initialTab = 'planned',
  onPlanNewTrip,
  onResumeTrip,
  onViewPaidTrip,
  onLogout,
  onEditProfile,
}) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialTab);
  const drawerFileRef = useRef<HTMLInputElement>(null);

  const [userPhotoState, setUserPhotoState] = useState<string>(
    userProfile?.photo_url || localStorage.getItem('travion_user_photo') || ''
  );

  useEffect(() => {
    if (userProfile?.photo_url) {
      setUserPhotoState(userProfile.photo_url);
    }
  }, [userProfile?.photo_url]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setUserPhotoState(result);
        localStorage.setItem('travion_user_photo', result);
      }
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  const displayName =
    userProfile?.preferred_name ||
    userProfile?.first_name ||
    userEmail.split('@')[0] ||
    'Datta Srinikesh';

  const permanentSource =
    userProfile?.home_city ||
    localStorage.getItem('travion_permanent_source') ||
    'Chennai';

  const userInterests: string[] = (() => {
    try {
      const saved = localStorage.getItem('travion_user_interests');
      return saved
        ? JSON.parse(saved)
        : ['🌲 Nature & Wildlife', '🏛️ Historic Heritage', '🏖️ Azure Coasts & Beaches'];
    } catch {
      return ['🌲 Nature & Wildlife', '🏛️ Historic Heritage'];
    }
  })();

  const plannedTrips = trips.filter((t) =>
    ['REQUESTED', 'PLANNED', 'DRAFT', 'ACTIVE', 'PAID', 'GUIDE_ASSIGNED'].includes(
      t.status
    )
  );

  const completedTrips = trips.filter((t) =>
    ['COMPLETED', 'FINISHED'].includes(t.status)
  );

  // ── FINANCIAL & TRIP ANALYTICS CALCULATIONS ──
  const totalInvestment = trips.reduce(
    (sum, t) => sum + (Number(t.total_cost) || Number(t.budget) || 0),
    0
  );

  const completedSpend = completedTrips.reduce(
    (sum, t) => sum + (Number(t.total_cost) || Number(t.budget) || 0),
    0
  );

  const plannedSpend = plannedTrips.reduce(
    (sum, t) => sum + (Number(t.total_cost) || Number(t.budget) || 0),
    0
  );

  const avgCostPerTrip =
    trips.length > 0 ? Math.round(totalInvestment / trips.length) : 0;

  const maxTripCost = Math.max(
    ...trips.map((t) => Number(t.total_cost) || Number(t.budget) || 0),
    1
  );

  const travelArchetypes = [
    { label: 'Scenic Hills & Mountain Trails', icon: Mountain, count: '6 Destinations' },
    { label: 'Azure Coasts & Ocean Breezes', icon: Sun, count: '8 Coastlines' },
    { label: 'Heritage & Ancient Architecture', icon: Landmark, count: '14 Sites' },
    { label: 'Authentic Local Dining & Cafés', icon: Utensils, count: '28 Experiences' },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Light Frosted Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm"
          />

          {/* Slide-out Drawer */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="relative z-10 w-full max-w-lg h-full bg-[#FAF7F2] border-l border-white/80 shadow-2xl flex flex-col font-sans text-slate-800 overflow-hidden"
          >
            {/* Top Drawer Header with User Profile */}
            <div className="p-5 border-b border-slate-200/70 bg-white/95 backdrop-blur-xl">
              {/* Hidden file input for photo change */}
              <input
                ref={drawerFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    onClick={() => drawerFileRef.current?.click()}
                    className="relative group cursor-pointer w-13 h-13 rounded-2xl overflow-hidden border-2 border-white shadow-md bg-gradient-to-br from-sky-400 to-pink-400 flex items-center justify-center text-white font-black text-base shrink-0"
                    title="Click to change your photo"
                  >
                    {userPhotoState ? (
                      <img
                        src={userPhotoState}
                        alt={displayName}
                        className="w-full h-full object-cover"
                        onError={() => setUserPhotoState('')}
                      />
                    ) : (
                      <span>{(displayName.charAt(0) || 'D').toUpperCase()}</span>
                    )}
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera className="w-4 h-4 text-white" />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-base font-black text-slate-900 leading-tight">
                        {displayName}
                      </h3>
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-sky-50 text-sky-700 border border-sky-200">
                        <CheckCircle2 className="w-2.5 h-2.5 text-sky-500" /> Active Traveller
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-sky-600" />
                        <strong className="text-slate-800 font-semibold">{permanentSource}</strong> (Origin)
                      </span>
                      <span>·</span>
                      <span className="font-mono truncate max-w-[150px]">{userEmail}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
                  title="Close dashboard"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Segmented Tab Bar: 5 Tabs */}
              <div className="mt-4 grid grid-cols-5 gap-1 p-1 rounded-2xl bg-slate-200/60 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setActiveTab('planned')}
                  className={`py-2 px-1 rounded-xl text-center transition-all ${
                    activeTab === 'planned'
                      ? 'bg-white text-sky-700 shadow-sm font-black'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Trips ({plannedTrips.length})
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('analytics')}
                  className={`py-2 px-1 rounded-xl text-center transition-all flex items-center justify-center gap-1 ${
                    activeTab === 'analytics'
                      ? 'bg-white text-sky-700 shadow-sm font-black'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <BarChart3 className="w-3 h-3" />
                  <span>Analytics</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('memories')}
                  className={`py-2 px-1 rounded-xl text-center transition-all ${
                    activeTab === 'memories'
                      ? 'bg-white text-sky-700 shadow-sm font-black'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Memories
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('dna')}
                  className={`py-2 px-1 rounded-xl text-center transition-all ${
                    activeTab === 'dna'
                      ? 'bg-white text-sky-700 shadow-sm font-black'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Interests
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('settings')}
                  className={`py-2 px-1 rounded-xl text-center transition-all ${
                    activeTab === 'settings'
                      ? 'bg-white text-sky-700 shadow-sm font-black'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Profile
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* ── TAB 1: PLANNED TRIPS ── */}
              {activeTab === 'planned' && (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-500 px-1">
                    <span>Active Itineraries</span>
                    <span>{plannedTrips.length} Total</span>
                  </div>

                  {plannedTrips.length === 0 ? (
                    <div className="p-8 text-center rounded-3xl bg-white border border-dashed border-slate-200 space-y-2.5">
                      <Luggage className="w-8 h-8 text-sky-400 mx-auto" />
                      <h4 className="text-sm font-black text-slate-800">
                        No in-progress trips
                      </h4>
                      <p className="text-xs text-slate-500">
                        Start your next adventure across India's serene destinations.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onPlanNewTrip();
                        }}
                        className="mt-2 px-4 h-9 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors"
                      >
                        Plan a New Trip
                      </button>
                    </div>
                  ) : (
                    plannedTrips.map((trip) => {
                      const isPaidOrActive = ['PAID', 'ACTIVE', 'GUIDE_ASSIGNED'].includes(
                        trip.status
                      );

                      return (
                        <div
                          key={trip.id}
                          className="p-4 rounded-3xl bg-white border border-slate-200/80 shadow-sm hover:shadow-md hover:border-sky-300 transition-all space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                isPaidOrActive
                                  ? 'bg-sky-50 text-sky-700 border border-sky-200'
                                  : 'bg-pink-50 text-pink-700 border border-pink-200'
                              }`}
                            >
                              {isPaidOrActive ? '● Confirmed Journey' : '● In Planning'}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              {trip.mode === 'GUIDE_MODE' ? 'Guided Experience' : 'Self Exploration'}
                            </span>
                          </div>

                          <div>
                            <h4 className="text-base font-black text-slate-900 flex items-center gap-1.5">
                              <span>{trip.source_name}</span>
                              <ArrowRight className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                              <span>{trip.destination_name}</span>
                            </h4>
                            <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              <span>
                                {new Date(trip.start_datetime).toLocaleDateString('en-IN', {
                                  day: 'numeric',
                                  month: 'short',
                                })}{' '}
                                –{' '}
                                {new Date(trip.end_datetime).toLocaleDateString('en-IN', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </span>
                            </p>
                          </div>

                          <div className="p-2.5 rounded-2xl bg-[#FAF7F2] border border-slate-100 flex items-center justify-between text-xs">
                            <span className="font-medium text-slate-500">Planned Cost</span>
                            <span className="font-black text-slate-900">
                              {inr(trip.total_cost || trip.budget)}
                            </span>
                          </div>

                          {isPaidOrActive ? (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onViewPaidTrip(trip);
                              }}
                              className="w-full h-10 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                            >
                              <Navigation className="w-3.5 h-3.5" />
                              <span>Open Live Companion</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onResumeTrip(trip);
                              }}
                              className="w-full h-10 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                            >
                              <span>Resume Planning</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* ── TAB 2: TRIP & EXPENSE ANALYTICS (CRITICAL REQUIREMENT) ── */}
              {activeTab === 'analytics' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-500 px-1">
                    <span>Trip Spending Intelligence</span>
                    <span className="text-sky-700 font-extrabold">{trips.length} Journeys Indexed</span>
                  </div>

                  {/* Summary Metric Bento */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-3xl bg-gradient-to-br from-sky-50 to-white border border-sky-100 shadow-xs space-y-1">
                      <div className="w-8 h-8 rounded-xl bg-sky-500 text-white flex items-center justify-center shadow-xs">
                        <Wallet className="w-4 h-4" />
                      </div>
                      <span className="text-[10.5px] font-bold text-slate-500 block pt-1">
                        Total Investment
                      </span>
                      <h4 className="text-lg font-black text-slate-900">
                        {inr(totalInvestment)}
                      </h4>
                      <span className="text-[10px] text-sky-700 font-semibold block">
                        Across all journeys
                      </span>
                    </div>

                    <div className="p-4 rounded-3xl bg-gradient-to-br from-pink-50 to-white border border-pink-100 shadow-xs space-y-1">
                      <div className="w-8 h-8 rounded-xl bg-pink-500 text-white flex items-center justify-center shadow-xs">
                        <TrendingUp className="w-4 h-4" />
                      </div>
                      <span className="text-[10.5px] font-bold text-slate-500 block pt-1">
                        Average per Trip
                      </span>
                      <h4 className="text-lg font-black text-slate-900">
                        {inr(avgCostPerTrip)}
                      </h4>
                      <span className="text-[10px] text-pink-700 font-semibold block">
                        Estimated average
                      </span>
                    </div>
                  </div>

                  {/* Investment Distribution Bars */}
                  <div className="p-4 rounded-3xl bg-white border border-slate-200/80 shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                        <PieChart className="w-4 h-4 text-sky-500" />
                        <span>Investment by Journey</span>
                      </h4>
                      <span className="text-[10px] text-slate-400 font-medium">Exact Rupee Breakdown</span>
                    </div>

                    {trips.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-4">No trips planned yet.</p>
                    ) : (
                      <div className="space-y-3.5 pt-1">
                        {trips.map((trip) => {
                          const cost = Number(trip.total_cost) || Number(trip.budget) || 0;
                          const ratio = maxTripCost > 0 ? (cost / maxTripCost) * 100 : 0;
                          const shareOfTotal = totalInvestment > 0 ? Math.round((cost / totalInvestment) * 100) : 0;

                          return (
                            <div key={trip.id} className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                                  <span>{trip.source_name}</span>
                                  <ArrowRight className="w-3 h-3 text-sky-500" />
                                  <span>{trip.destination_name}</span>
                                </span>
                                <span className="font-black text-slate-900">{inr(cost)}</span>
                              </div>

                              {/* Progress bar comparing this trip */}
                              <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden flex">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-pink-400 transition-all duration-500"
                                  style={{ width: `${Math.max(ratio, 8)}%` }}
                                />
                              </div>

                              <div className="flex items-center justify-between text-[10px] text-slate-400">
                                <span>{shareOfTotal}% of total spend</span>
                                <span className="uppercase font-semibold text-slate-500">{trip.status}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Standard Category Proportions */}
                  <div className="p-4 rounded-3xl bg-[#FAF7F2] border border-slate-200/80 space-y-2 text-xs">
                    <span className="font-bold text-slate-900 block flex items-center gap-1">
                      <Receipt className="w-3.5 h-3.5 text-sky-600" />
                      <span>Standard Cost Allocations</span>
                    </span>
                    <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-600">
                      <div className="p-2 rounded-xl bg-white border border-slate-100">
                        <span className="block font-bold text-slate-800">🚆 Transport ~30%</span>
                        <span className="text-slate-400">Verified rails & flights</span>
                      </div>
                      <div className="p-2 rounded-xl bg-white border border-slate-100">
                        <span className="block font-bold text-slate-800">🏨 Stays ~40%</span>
                        <span className="text-slate-400">Curated boutique rooms</span>
                      </div>
                      <div className="p-2 rounded-xl bg-white border border-slate-100">
                        <span className="block font-bold text-slate-800">🍽️ Dining ~18%</span>
                        <span className="text-slate-400">Iconic culinary gems</span>
                      </div>
                      <div className="p-2 rounded-xl bg-white border border-slate-100">
                        <span className="block font-bold text-slate-800">🎟️ Sightseeing ~12%</span>
                        <span className="text-slate-400">Monuments & activities</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── TAB 3: MEMORIES ── */}
              {activeTab === 'memories' && (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-500 px-1">
                    <span>Travel Memories Scrapbook</span>
                    <span>{completedTrips.length} Completed</span>
                  </div>

                  {completedTrips.length === 0 ? (
                    <div className="p-8 text-center rounded-3xl bg-white border border-dashed border-slate-200 space-y-2.5">
                      <Camera className="w-8 h-8 text-pink-400 mx-auto" />
                      <h4 className="text-sm font-black text-slate-800">
                        Your memory scrapbook awaits
                      </h4>
                      <p className="text-xs text-slate-500">
                        Once you complete a journey, your routes, moments, and landmark memories will be saved right here.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onPlanNewTrip();
                        }}
                        className="mt-2 px-4 h-9 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors"
                      >
                        Start Your First Journey
                      </button>
                    </div>
                  ) : (
                    completedTrips.map((trip) => (
                      <div
                        key={trip.id}
                        className="p-4 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">
                            Completed Journey
                          </span>
                          <span className="text-xs font-bold text-slate-500">
                            {inr(trip.total_cost)}
                          </span>
                        </div>
                        <h4 className="text-sm font-black text-slate-900">
                          {trip.source_name} → {trip.destination_name}
                        </h4>
                        <p className="text-xs text-slate-500">
                          {new Date(trip.start_datetime).toLocaleDateString('en-IN', {
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* ── TAB 4: TRAVEL DNA & INTERESTS ── */}
              {activeTab === 'dna' && (
                <div className="space-y-4">
                  <div className="text-xs font-bold text-slate-500 px-1">
                    Your Travel Style & Preferences
                  </div>

                  {/* User Selected Interests */}
                  <div className="p-4 rounded-3xl bg-white border border-pink-100 space-y-2.5">
                    <span className="text-xs font-bold text-slate-900 block flex items-center gap-1.5">
                      <Heart className="w-3.5 h-3.5 text-pink-500" />
                      <span>Active Selected Vibes</span>
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {userInterests.map((interest, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-xl bg-pink-50 text-pink-700 text-xs font-bold border border-pink-200"
                        >
                          {interest}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {travelArchetypes.map((item, idx) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={idx}
                          className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
                              <Icon className="w-4 h-4" />
                            </span>
                            <span className="text-xs font-bold text-slate-900">
                              {item.label}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-100">
                            {item.count}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {onEditProfile && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onEditProfile();
                      }}
                      className="w-full py-2.5 rounded-xl bg-white hover:bg-slate-50 text-sky-700 border border-sky-200 text-xs font-bold transition-all text-center block"
                    >
                      Update Travel Interests →
                    </button>
                  )}
                </div>
              )}

              {/* ── TAB 5: PROFILE & SETTINGS (WITH PHOTO, EMAIL, PHONE, PERMANENT SOURCE) ── */}
              {activeTab === 'settings' && (
                <div className="space-y-4 text-xs font-semibold">
                  <div className="text-xs font-bold text-slate-500 px-1">
                    Your Complete Profile Details
                  </div>

                  {/* Profile Card */}
                  <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
                    <div className="flex items-center gap-3.5 pb-3 border-b border-slate-100">
                      <div
                        onClick={() => drawerFileRef.current?.click()}
                        className="relative group cursor-pointer w-14 h-14 rounded-full overflow-hidden border-2 border-white shadow-md bg-gradient-to-br from-sky-400 to-pink-400 flex items-center justify-center text-white font-black text-lg shrink-0"
                        title="Upload new photo"
                      >
                        {userPhotoState ? (
                          <img
                            src={userPhotoState}
                            alt={displayName}
                            className="w-full h-full object-cover"
                            onError={() => setUserPhotoState('')}
                          />
                        ) : (
                          <span>{(displayName.charAt(0) || 'D').toUpperCase()}</span>
                        )}
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Camera className="w-4 h-4 text-white" />
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h4 className="text-base font-black text-slate-900 leading-tight">
                            {displayName}
                          </h4>
                          <button
                            type="button"
                            onClick={() => drawerFileRef.current?.click()}
                            className="inline-flex items-center gap-1 text-[10.5px] font-bold text-sky-600 hover:text-sky-800"
                          >
                            <Upload className="w-3 h-3" />
                            <span>Upload Photo</span>
                          </button>
                        </div>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">{userEmail}</p>
                      </div>
                    </div>

                    <div className="space-y-2.5 text-xs">
                      <div className="flex justify-between items-center py-1 border-b border-slate-100">
                        <span className="text-slate-500">Phone Number</span>
                        <span className="font-bold text-slate-900 font-mono">
                          {userProfile?.phone || '+91 98765 43210'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center py-1 border-b border-slate-100">
                        <span className="text-slate-500 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-sky-600" />
                          <span>Permanent Departure City</span>
                        </span>
                        <span className="font-black text-sky-700 bg-sky-50 px-2 py-0.5 rounded-lg border border-sky-200">
                          {permanentSource}
                        </span>
                      </div>

                      <div className="flex justify-between items-center py-1 border-b border-slate-100">
                        <span className="text-slate-500">Language</span>
                        <span className="font-bold text-slate-900">
                          {userProfile?.preferred_language || 'English'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center py-1">
                        <span className="text-slate-500">Active Interests</span>
                        <span className="font-bold text-pink-700">
                          {userInterests.length} Selected
                        </span>
                      </div>
                    </div>
                  </div>

                  {onEditProfile && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onEditProfile();
                      }}
                      className="w-full h-11 rounded-xl bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 text-white text-xs font-bold shadow-md shadow-sky-500/20 transition-all flex items-center justify-center gap-1.5"
                    >
                      <Settings className="w-4 h-4" />
                      <span>Edit Profile, Photo & Permanent City</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onLogout}
                    className="w-full h-11 rounded-xl bg-pink-50 hover:bg-pink-100 text-pink-700 border border-pink-200 text-xs font-bold flex items-center justify-center gap-2 transition-colors mt-4"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out of Travion</span>
                  </button>
                </div>
              )}
            </div>

            {/* Bottom Drawer CTA */}
            <div className="p-4 border-t border-slate-200/80 bg-white">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onPlanNewTrip();
                }}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-sky-500 via-sky-600 to-sky-500 hover:from-sky-600 hover:to-sky-700 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-sky-500/20 transition-all"
              >
                <Sparkles className="w-4 h-4 text-sky-200" />
                <span>Plan a New Trip</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
};
