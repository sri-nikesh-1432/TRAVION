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
            className="relative z-10 w-full max-w-md h-full bg-[#FAF7F2] border-l border-white/80 shadow-2xl flex flex-col font-sans text-slate-800 overflow-hidden"
          >
            {/* Top Drawer Header with User Profile */}
            <div className="p-5 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 text-white font-black text-lg flex items-center justify-center shadow-md shadow-sky-500/20">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-base font-black text-slate-900 leading-tight">
                        {displayName}
                      </h3>
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-sky-50 text-sky-700 border border-sky-200">
                        <CheckCircle2 className="w-2.5 h-2.5 text-sky-500" /> Member
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[200px]">
                      {userEmail}
                    </p>
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

              {/* Segmented Tab Bar */}
              <div className="mt-5 grid grid-cols-4 gap-1 p-1 rounded-2xl bg-slate-200/60 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setActiveTab('planned')}
                  className={`py-2 px-1 rounded-xl text-center transition-all ${
                    activeTab === 'planned'
                      ? 'bg-white text-sky-700 shadow-sm font-black'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Planned ({plannedTrips.length})
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
                  Settings
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

              {/* ── TAB 2: MEMORIES ── */}
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

              {/* ── TAB 3: TRAVEL DNA & INTERESTS ── */}
              {activeTab === 'dna' && (
                <div className="space-y-4">
                  <div className="text-xs font-bold text-slate-500 px-1">
                    Your Travel Style & Preferences
                  </div>

                  <div className="space-y-2.5">
                    {travelInterests.map((item, idx) => {
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

                  <div className="p-4 rounded-3xl bg-white border border-slate-200/80 space-y-2 text-xs">
                    <span className="font-bold text-slate-900 block">
                      Custom Travel Curation
                    </span>
                    <p className="text-slate-500 leading-relaxed">
                      Your travel preferences adapt every itinerary to match your desired tempo, dining tastes, and destination style.
                    </p>
                  </div>
                </div>
              )}

              {/* ── TAB 4: PROFILE SETTINGS ── */}
              {activeTab === 'settings' && (
                <div className="space-y-4 text-xs font-semibold">
                  <div className="text-xs font-bold text-slate-500 px-1">
                    Account & Preferences
                  </div>

                  <div className="p-4 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-3">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Full Name</span>
                      <span className="font-bold text-slate-900">{displayName}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Email</span>
                      <span className="font-bold text-slate-900 truncate max-w-[180px]">
                        {userEmail}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Membership</span>
                      <span className="font-bold text-sky-600">Active Traveller</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Support</span>
                      <span className="font-bold text-slate-900">24/7 Journey Concierge</span>
                    </div>
                  </div>

                  {onEditProfile && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onEditProfile();
                      }}
                      className="w-full h-10 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-bold transition-colors"
                    >
                      Edit Profile Info
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onLogout}
                    className="w-full h-11 rounded-xl bg-pink-50 hover:bg-pink-100 text-pink-700 border border-pink-200 text-xs font-bold flex items-center justify-center gap-2 transition-colors mt-4"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
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
