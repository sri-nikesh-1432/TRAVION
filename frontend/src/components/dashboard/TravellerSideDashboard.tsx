import React, { useState } from 'react';
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
  ShieldCheck,
  User,
  LogOut,
  MapPin,
  Navigation,
  CheckCircle2,
  Clock,
  Landmark,
  Utensils,
  Mountain,
  Award,
  ChevronRight,
  ExternalLink,
  Shield,
  Layers,
} from 'lucide-react';
import { TripItem, UserProfile } from '../../types';

interface TravellerSideDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile?: UserProfile | null;
  userEmail: string;
  trips: TripItem[];
  onPlanNewTrip: () => void;
  onResumeTrip: (trip: TripItem) => void;
  onViewPaidTrip: (trip: TripItem) => void;
  onLogout: () => void;
  onEditProfile?: () => void;
}

const inr = (n: number | null | undefined) =>
  `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

type DashboardTab = 'planned' | 'memories' | 'dna' | 'settings';

export const TravellerSideDashboard: React.FC<TravellerSideDashboardProps> = ({
  isOpen,
  onClose,
  userProfile,
  userEmail,
  trips,
  onPlanNewTrip,
  onResumeTrip,
  onViewPaidTrip,
  onLogout,
  onEditProfile,
}) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('planned');

  const displayName =
    userProfile?.preferred_name ||
    userProfile?.first_name ||
    userEmail.split('@')[0] ||
    'Datta Srinikesh';

  const plannedTrips = trips.filter((t) =>
    ['REQUESTED', 'PLANNED', 'DRAFT', 'ACTIVE', 'PAID', 'GUIDE_ASSIGNED'].includes(
      t.status
    )
  );

  const completedTrips = trips.filter((t) =>
    ['COMPLETED', 'FINISHED'].includes(t.status)
  );

  const travelInterests = [
    { label: 'Heritage & Architecture', icon: Landmark, count: '14 Sites' },
    { label: 'Authentic Local Cuisine', icon: Utensils, count: '28 Cafés' },
    { label: 'Scenic Landscapes & Trails', icon: Mountain, count: '6 Treks' },
    { label: 'Verified Stays & Retreats', icon: ShieldCheck, count: '5-Star' },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop with frosted glass blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-charcoal-950/60 backdrop-blur-md"
          />

          {/* Slide-out Glass Drawer */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="relative z-10 w-full max-w-md h-full bg-white/95 backdrop-blur-2xl border-l border-white/60 shadow-2xl flex flex-col font-sans text-charcoal-900 overflow-hidden"
          >
            {/* Top Drawer Header with User Profile */}
            <div className="p-5 border-b border-charcoal-100 bg-gradient-to-br from-charcoal-50/80 via-white to-travion-50/30">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-travion-600 to-emerald-600 text-white font-black text-lg flex items-center justify-center shadow-md">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-base font-black text-charcoal-900 leading-tight">
                        {displayName}
                      </h3>
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                        <CheckCircle2 className="w-2.5 h-2.5" /> VERIFIED
                      </span>
                    </div>
                    <p className="text-xs text-charcoal-500 font-mono mt-0.5 truncate max-w-[200px]">
                      {userEmail}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-xl bg-charcoal-100 hover:bg-charcoal-200 text-charcoal-600 hover:text-charcoal-900 transition-colors"
                  title="Close dashboard"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Segmented Tab Bar */}
              <div className="mt-5 grid grid-cols-4 gap-1 p-1 rounded-2xl bg-charcoal-100/80 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setActiveTab('planned')}
                  className={`py-2 px-1 rounded-xl text-center transition-all ${
                    activeTab === 'planned'
                      ? 'bg-white text-travion-700 shadow-sm font-black'
                      : 'text-charcoal-500 hover:text-charcoal-800'
                  }`}
                >
                  Planned ({plannedTrips.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('memories')}
                  className={`py-2 px-1 rounded-xl text-center transition-all ${
                    activeTab === 'memories'
                      ? 'bg-white text-travion-700 shadow-sm font-black'
                      : 'text-charcoal-500 hover:text-charcoal-800'
                  }`}
                >
                  Memories
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('dna')}
                  className={`py-2 px-1 rounded-xl text-center transition-all ${
                    activeTab === 'dna'
                      ? 'bg-white text-travion-700 shadow-sm font-black'
                      : 'text-charcoal-500 hover:text-charcoal-800'
                  }`}
                >
                  Interests
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('settings')}
                  className={`py-2 px-1 rounded-xl text-center transition-all ${
                    activeTab === 'settings'
                      ? 'bg-white text-travion-700 shadow-sm font-black'
                      : 'text-charcoal-500 hover:text-charcoal-800'
                  }`}
                >
                  Settings
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* ── TAB 1: PLANNED TRIPS ── */}
              {activeTab === 'planned' && (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between text-xs font-bold text-charcoal-500 px-1">
                    <span>Active Itineraries</span>
                    <span>{plannedTrips.length} Total</span>
                  </div>

                  {plannedTrips.length === 0 ? (
                    <div className="p-8 text-center rounded-3xl bg-sand-50/70 border border-dashed border-charcoal-200 space-y-2.5">
                      <Luggage className="w-8 h-8 text-charcoal-400 mx-auto" />
                      <h4 className="text-sm font-black text-charcoal-800">
                        No in-progress trips
                      </h4>
                      <p className="text-xs text-charcoal-500">
                        Start your next adventure across India with real schedules.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onPlanNewTrip();
                        }}
                        className="mt-2 px-4 h-9 rounded-xl bg-travion-600 text-white text-xs font-bold"
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
                          className="p-4 rounded-3xl bg-white border border-charcoal-200/90 shadow-soft hover:shadow-card hover:border-travion-300 transition-all space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-[9.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                isPaidOrActive
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  : 'bg-sand-100 text-charcoal-700'
                              }`}
                            >
                              {isPaidOrActive ? '● Confirmed & Active' : '● In Planning'}
                            </span>
                            <span className="text-[10px] font-mono text-charcoal-400 font-bold">
                              {trip.mode === 'GUIDE_MODE' ? 'Guide Mode' : 'Adventurous'}
                            </span>
                          </div>

                          <div>
                            <h4 className="text-base font-black text-charcoal-900 flex items-center gap-1.5">
                              <span>{trip.source_name}</span>
                              <ArrowRight className="w-3.5 h-3.5 text-travion-600 shrink-0" />
                              <span>{trip.destination_name}</span>
                            </h4>
                            <p className="text-[11px] text-charcoal-500 flex items-center gap-1 mt-0.5">
                              <Calendar className="w-3 h-3 text-charcoal-400" />
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

                          <div className="p-2.5 rounded-2xl bg-sand-50 border border-charcoal-100 flex items-center justify-between text-xs">
                            <span className="font-semibold text-charcoal-500">Investment</span>
                            <span className="font-black text-charcoal-900">
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
                              className="w-full h-10 rounded-xl bg-charcoal-900 hover:bg-black text-emerald-400 text-xs font-black flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                            >
                              <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Open Live Companion</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onResumeTrip(trip);
                              }}
                              className="w-full h-10 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-xs font-black flex items-center justify-center gap-1.5 transition-colors shadow-sm"
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

              {/* ── TAB 2: MEMORIES ── */}
              {activeTab === 'memories' && (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between text-xs font-bold text-charcoal-500 px-1">
                    <span>Travel Memories Scrapbook</span>
                    <span>{completedTrips.length} Completed</span>
                  </div>

                  {completedTrips.length === 0 ? (
                    <div className="p-8 text-center rounded-3xl bg-sand-50/70 border border-dashed border-charcoal-200 space-y-2.5">
                      <Camera className="w-8 h-8 text-amber-500 mx-auto" />
                      <h4 className="text-sm font-black text-charcoal-800">
                        Your travel scrapbook awaits
                      </h4>
                      <p className="text-xs text-charcoal-500">
                        Once you complete a trip, GPS route maps, landmark photos, and dining highlights will be preserved right here.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onPlanNewTrip();
                        }}
                        className="mt-2 px-4 h-9 rounded-xl bg-travion-600 text-white text-xs font-bold"
                      >
                        Start Your First Journey
                      </button>
                    </div>
                  ) : (
                    completedTrips.map((trip) => (
                      <div
                        key={trip.id}
                        className="p-4 rounded-3xl bg-white border border-charcoal-200 shadow-soft space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                            Completed Trip
                          </span>
                          <span className="text-xs font-bold text-charcoal-400">
                            {inr(trip.total_cost)}
                          </span>
                        </div>
                        <h4 className="text-sm font-black text-charcoal-900">
                          {trip.source_name} → {trip.destination_name}
                        </h4>
                        <p className="text-xs text-charcoal-500">
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

              {/* ── TAB 3: TRAVEL DNA & INTERESTS ── */}
              {activeTab === 'dna' && (
                <div className="space-y-4">
                  <div className="text-xs font-bold text-charcoal-500 px-1">
                    Your Travel Style & Preferences
                  </div>

                  <div className="space-y-2.5">
                    {travelInterests.map((item, idx) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={idx}
                          className="p-3.5 rounded-2xl bg-white border border-charcoal-200/80 shadow-soft flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-8 h-8 rounded-xl bg-travion-50 text-travion-600 flex items-center justify-center">
                              <Icon className="w-4 h-4" />
                            </span>
                            <span className="text-xs font-extrabold text-charcoal-900">
                              {item.label}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                            {item.count}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="p-4 rounded-3xl bg-sand-50/80 border border-charcoal-200 space-y-2 text-xs">
                    <span className="font-extrabold text-charcoal-900 block">
                      Autonomous Journey Engine
                    </span>
                    <p className="text-charcoal-500 leading-relaxed">
                      Your choices in Step 2 adapt every destination itinerary to match your dining budget, tempo, and group style.
                    </p>
                  </div>
                </div>
              )}

              {/* ── TAB 4: PROFILE SETTINGS ── */}
              {activeTab === 'settings' && (
                <div className="space-y-4 text-xs font-semibold">
                  <div className="text-xs font-bold text-charcoal-500 px-1">
                    Account & Preferences
                  </div>

                  <div className="p-4 rounded-3xl bg-white border border-charcoal-200 shadow-soft space-y-3">
                    <div className="flex justify-between py-1 border-b border-charcoal-100">
                      <span className="text-charcoal-500">Full Name</span>
                      <span className="font-bold text-charcoal-900">{displayName}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-charcoal-100">
                      <span className="text-charcoal-500">Email</span>
                      <span className="font-bold text-charcoal-900 font-mono truncate max-w-[180px]">
                        {userEmail}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-charcoal-100">
                      <span className="text-charcoal-500">Payment Engine</span>
                      <span className="font-bold text-emerald-700">Razorpay Verified</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-charcoal-500">Safety Reserve</span>
                      <span className="font-bold text-charcoal-900">15% Protected</span>
                    </div>
                  </div>

                  {onEditProfile && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onEditProfile();
                      }}
                      className="w-full h-10 rounded-xl bg-sand-100 hover:bg-sand-200 text-charcoal-800 text-xs font-bold transition-colors"
                    >
                      Edit Profile Info
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onLogout}
                    className="w-full h-11 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold flex items-center justify-center gap-2 transition-colors mt-4"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out of Travion</span>
                  </button>
                </div>
              )}
            </div>

            {/* Bottom Drawer CTA */}
            <div className="p-4 border-t border-charcoal-100 bg-white">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onPlanNewTrip();
                }}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-travion-600 via-emerald-600 to-travion-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transition-all"
              >
                <Sparkles className="w-4 h-4 text-gold-300" />
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
