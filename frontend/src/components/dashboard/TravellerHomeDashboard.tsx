import React from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles,
  Plus,
  Compass,
  MapPin,
  Calendar,
  Clock,
  ArrowRight,
  ShieldCheck,
  Heart,
  User,
  CheckCircle2,
  ChevronRight,
  Luggage,
  TrainFront,
  Utensils,
  Mountain,
  Landmark,
  Camera,
  Star,
  Award,
  Navigation,
  Globe,
  Smile,
  Shield,
  Layers,
} from 'lucide-react';
import { TripItem, UserProfile } from '../../types';

interface TravellerHomeDashboardProps {
  userProfile?: UserProfile | null;
  userEmail: string;
  trips: TripItem[];
  onPlanNewTrip: () => void;
  onResumeTrip: (trip: TripItem) => void;
  onViewPaidTrip: (trip: TripItem) => void;
  onReviewTrip: (trip: TripItem) => void;
  onSelectQuickDestination?: (destinationName: string) => void;
  onEditProfile?: () => void;
}

const inr = (n: number | null | undefined) =>
  `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

const POPULAR_DESTINATIONS = [
  {
    name: 'Hyderabad',
    tagline: 'City of Pearls & Nizam Splendor',
    badge: 'Trending Heritage',
    highlights: 'Charminar, Golconda Fort, Biryani Trail',
    image: 'https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=600&q=80',
    typicalFare: '₹1,150 IRCTC Superfast',
  },
  {
    name: 'Warangal',
    tagline: 'Kakatiya Dynasty & Ancient Stone Temples',
    badge: 'Historic Architecture',
    highlights: 'Thousand Pillar Temple, Fort Gates, Ramappa',
    image: 'https://images.unsplash.com/photo-1626290467773-678cb54a5c9f?auto=format&fit=crop&w=600&q=80',
    typicalFare: '₹940 Express Train',
  },
  {
    name: 'Munnar',
    tagline: 'Emerald Mist & Tea Plantations',
    badge: 'Scenic Hill Station',
    highlights: 'Tea Estates, Eravikulam, Anamudi Peaks',
    image: 'https://images.unsplash.com/photo-1593693397690-362cb9666fc2?auto=format&fit=crop&w=600&q=80',
    typicalFare: '₹1,440 Scenic Coach',
  },
  {
    name: 'Jaipur',
    tagline: 'The Pink City & Regal Forts',
    badge: 'Royal Rajasthan',
    highlights: 'Amber Fort, Hawa Mahal, City Palace',
    image: 'https://images.unsplash.com/photo-1477587458883-47145ed94245?auto=format&fit=crop&w=600&q=80',
    typicalFare: '₹1,850 Express Line',
  },
];

export const TravellerHomeDashboard: React.FC<TravellerHomeDashboardProps> = ({
  userProfile,
  userEmail,
  trips,
  onPlanNewTrip,
  onResumeTrip,
  onViewPaidTrip,
  onReviewTrip,
  onSelectQuickDestination,
  onEditProfile,
}) => {
  // Derive name
  const displayName =
    userProfile?.preferred_name ||
    userProfile?.first_name ||
    userEmail.split('@')[0] ||
    'Traveller';

  // Time-aware greeting
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  // Separate active/in-progress vs completed trips
  const activeAndPlannedTrips = trips.filter((t) =>
    ['REQUESTED', 'PLANNED', 'DRAFT', 'ACTIVE', 'PAID', 'GUIDE_ASSIGNED'].includes(
      t.status
    )
  );
  const completedTrips = trips.filter((t) =>
    ['COMPLETED', 'FINISHED'].includes(t.status)
  );

  // User travel persona
  const travelInterests = [
    { label: 'Heritage & Monuments', icon: Landmark, color: 'text-amber-600 bg-amber-50 border-amber-200' },
    { label: 'Authentic Local Food', icon: Utensils, color: 'text-orange-600 bg-orange-50 border-orange-200' },
    { label: 'Scenic Landscapes', icon: Mountain, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
    { label: 'Curated Verified Stays', icon: ShieldCheck, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-10">
      {/* ── HERO BANNER WITH GLASSMORPHISM "NEW TRIP" BUTTON ── */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-charcoal-900 via-charcoal-850 to-charcoal-950 text-white p-7 sm:p-10 shadow-2xl border border-charcoal-800">
        {/* Subtle decorative glowing mesh */}
        <div
          aria-hidden="true"
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-gradient-to-br from-emerald-500/20 via-travion-500/15 to-transparent blur-3xl pointer-events-none"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full bg-gradient-to-tr from-amber-500/15 via-travion-600/10 to-transparent blur-3xl pointer-events-none"
        />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-emerald-300 text-xs font-mono font-bold">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>TRAVION TRAVEL ORCHESTRATION</span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-tight">
              {greeting},{' '}
              <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-amber-300 bg-clip-text text-transparent">
                {displayName}
              </span>
              !
            </h1>

            <p className="text-sm sm:text-base text-charcoal-300 font-medium leading-relaxed max-w-xl">
              Welcome to your personal travel dashboard. Explore your planned itineraries, cherish completed journey memories, or orchestrate an all-new trip across India.
            </p>

            {/* Quick stats badges */}
            <div className="pt-2 flex flex-wrap items-center gap-3 text-xs font-semibold">
              <span className="px-3 py-1 rounded-xl bg-charcoal-800/90 border border-charcoal-700/80 text-charcoal-300 flex items-center gap-1.5">
                <Luggage className="w-3.5 h-3.5 text-emerald-400" />
                <strong className="text-white">{trips.length}</strong> Total Journeys
              </span>
              <span className="px-3 py-1 rounded-xl bg-charcoal-800/90 border border-charcoal-700/80 text-charcoal-300 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-teal-400" />
                <strong className="text-white">India Index</strong> Verified Schedules
              </span>
              <span className="px-3 py-1 rounded-xl bg-charcoal-800/90 border border-charcoal-700/80 text-charcoal-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                Deterministic Math
              </span>
            </div>
          </div>

          {/* ── THE SIGNATURE GLASSMORPHISM "NEW TRIP" BUTTON ── */}
          <div className="shrink-0 flex flex-col items-start lg:items-end">
            <motion.button
              type="button"
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={onPlanNewTrip}
              className="group relative p-1 rounded-3xl bg-gradient-to-r from-white/30 via-emerald-400/30 to-amber-400/30 hover:from-white/40 hover:to-emerald-400/50 shadow-2xl transition-all duration-300"
            >
              <div className="relative flex items-center gap-4 px-8 py-5 rounded-[22px] bg-gradient-to-r from-travion-600/90 via-emerald-600/90 to-travion-700/90 backdrop-blur-2xl border border-white/30 shadow-inner group-hover:from-travion-500/95 group-hover:to-emerald-500/95 transition-all">
                <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md border border-white/40 flex items-center justify-center text-white shadow-md group-hover:rotate-12 transition-transform duration-300">
                  <Plus className="w-6 h-6 stroke-[3]" />
                </div>
                <div className="text-left">
                  <span className="text-[11px] font-mono font-black uppercase tracking-wider text-emerald-200 block">
                    AI Journey Orchestrator
                  </span>
                  <span className="text-lg sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
                    Plan a New Trip
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1.5 transition-transform" />
                  </span>
                  <span className="text-xs text-white/80 font-medium">
                    Search from, to, dates & verified IRCTC
                  </span>
                </div>
              </div>
            </motion.button>
          </div>
        </div>
      </section>

      {/* ── ACTIVE & PLANNED TRIPS ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-travion-100 text-travion-700 flex items-center justify-center">
              <Compass className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-xl font-black text-charcoal-900 tracking-tight">
                Active & Planned Trips
              </h2>
              <p className="text-xs text-charcoal-500 font-medium">
                Trips currently underway or saved in planning
              </p>
            </div>
          </div>
          <span className="text-xs font-bold px-3 py-1 rounded-full bg-sand-100 text-charcoal-700">
            {activeAndPlannedTrips.length} {activeAndPlannedTrips.length === 1 ? 'Trip' : 'Trips'}
          </span>
        </div>

        {activeAndPlannedTrips.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-charcoal-300 bg-sand-50/60 p-8 text-center space-y-3">
            <Luggage className="w-10 h-10 text-charcoal-400 mx-auto" />
            <h3 className="text-base font-extrabold text-charcoal-800">
              No trips in progress right now
            </h3>
            <p className="text-xs text-charcoal-500 max-w-sm mx-auto">
              Ready to explore? Start a new journey to pick your destinations, travel dates, trains, and verified stays.
            </p>
            <button
              type="button"
              onClick={onPlanNewTrip}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-xs font-bold transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Start Planning Now</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {activeAndPlannedTrips.map((trip) => {
              const isPaidOrActive = ['PAID', 'ACTIVE', 'GUIDE_ASSIGNED'].includes(
                trip.status
              );

              return (
                <div
                  key={trip.id}
                  className="rounded-3xl border border-charcoal-200/90 bg-white p-5 shadow-soft hover:shadow-card hover:border-travion-300 transition-all flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    {/* Status & Mode Row */}
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                          isPaidOrActive
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-sand-100 text-charcoal-700 border border-charcoal-200'
                        }`}
                      >
                        {isPaidOrActive ? '● Confirmed & Active' : '● Planning Stage'}
                      </span>
                      <span className="text-[10.5px] font-bold text-charcoal-400 font-mono">
                        {trip.mode === 'GUIDE_MODE' ? 'Guide Mode' : 'Adventurous'}
                      </span>
                    </div>

                    {/* Route */}
                    <div>
                      <h3 className="text-lg font-black text-charcoal-900 flex items-center gap-2">
                        <span>{trip.source_name}</span>
                        <ArrowRight className="w-4 h-4 text-travion-600 shrink-0" />
                        <span>{trip.destination_name}</span>
                      </h3>
                      <p className="text-xs text-charcoal-400 font-medium mt-1 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
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

                    {/* Financial summary */}
                    <div className="p-3 rounded-2xl bg-sand-50/80 border border-charcoal-100 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-black uppercase text-charcoal-400 block">
                          Total Investment
                        </span>
                        <span className="text-base font-black text-charcoal-900">
                          {inr(trip.total_cost || trip.budget)}
                        </span>
                      </div>
                      <span className="text-[11px] font-bold text-travion-700">
                        {trip.budget ? `Budget: ${inr(trip.budget)}` : 'Calculated'}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-2 flex items-center gap-2 border-t border-charcoal-100">
                    {isPaidOrActive ? (
                      <button
                        type="button"
                        onClick={() => onViewPaidTrip(trip)}
                        className="flex-1 h-11 rounded-2xl bg-charcoal-900 hover:bg-black text-emerald-400 font-black text-xs flex items-center justify-center gap-1.5 transition-colors shadow-soft"
                      >
                        <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Open Live Companion</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onReviewTrip(trip)}
                          className="px-3.5 h-10 rounded-xl bg-sand-100 hover:bg-sand-200 text-charcoal-700 text-xs font-bold transition-colors"
                        >
                          Review
                        </button>
                        <button
                          type="button"
                          onClick={() => onResumeTrip(trip)}
                          className="flex-1 h-10 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-xs font-black flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                        >
                          <span>Resume Plan</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── TRAVEL MEMORIES & COMPLETED JOURNEYS ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-xl font-black text-charcoal-900 tracking-tight">
                Travel Memories & Completed Journeys
              </h2>
              <p className="text-xs text-charcoal-500 font-medium">
                Your archive of past adventures and explorations
              </p>
            </div>
          </div>
        </div>

        {completedTrips.length === 0 ? (
          <div className="rounded-3xl border border-charcoal-200/80 bg-white p-6 shadow-soft flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200/80 flex items-center justify-center shrink-0">
                <Award className="w-6 h-6" />
              </span>
              <div>
                <h3 className="text-base font-extrabold text-charcoal-900">
                  Your first completed memory awaits
                </h3>
                <p className="text-xs text-charcoal-500 max-w-md mt-0.5">
                  Complete your first trip to save GPS route trails, attraction photos, and personal highlights right here in your permanent memories archive.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onPlanNewTrip}
              className="px-5 h-10 rounded-xl bg-travion-50 hover:bg-travion-100 text-travion-700 border border-travion-200 text-xs font-bold transition-colors whitespace-nowrap"
            >
              Plan Your Adventure
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {completedTrips.map((trip) => (
              <div
                key={trip.id}
                className="rounded-3xl border border-charcoal-200 bg-white p-5 shadow-soft space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    ✓ Completed Journey
                  </span>
                  <span className="text-xs font-bold text-charcoal-400">
                    {inr(trip.total_cost)}
                  </span>
                </div>
                <h4 className="text-lg font-black text-charcoal-900">
                  {trip.source_name} → {trip.destination_name}
                </h4>
                <p className="text-xs text-charcoal-500">
                  {new Date(trip.start_datetime).toLocaleDateString('en-IN', {
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
                <button
                  type="button"
                  onClick={() => onViewPaidTrip(trip)}
                  className="w-full h-10 rounded-xl bg-sand-100 hover:bg-sand-200 text-charcoal-800 text-xs font-bold transition-colors"
                >
                  View Journey Route & Stops
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── TRAVEL DNA & INTERESTS ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
              <Heart className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-xl font-black text-charcoal-900 tracking-tight">
                Your Travel Interests & Style
              </h2>
              <p className="text-xs text-charcoal-500 font-medium">
                Pillars tailored to personalize your itineraries and food allowances
              </p>
            </div>
          </div>
          {onEditProfile && (
            <button
              type="button"
              onClick={onEditProfile}
              className="text-xs font-bold text-travion-600 hover:text-travion-800 transition-colors"
            >
              Update Preferences
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          {travelInterests.map((interest, idx) => {
            const Icon = interest.icon;
            return (
              <div
                key={idx}
                className="p-4 rounded-3xl bg-white border border-charcoal-200/80 shadow-soft flex flex-col justify-between space-y-2 hover:border-travion-300 transition-all"
              >
                <div
                  className={`w-9 h-9 rounded-2xl flex items-center justify-center border ${interest.color}`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-xs font-extrabold text-charcoal-900 leading-snug">
                  {interest.label}
                </span>
                <span className="text-[10px] font-semibold text-charcoal-400">
                  Active Interest
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── POPULAR COVERED DESTINATIONS (QUICK LAUNCH) ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center">
              <Globe className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-xl font-black text-charcoal-900 tracking-tight">
                Iconic Covered Indian Destinations
              </h2>
              <p className="text-xs text-charcoal-500 font-medium">
                Grounded in verified IRCTC schedules, luxury buses, and curated stays
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {POPULAR_DESTINATIONS.map((dest) => (
            <div
              key={dest.name}
              className="group rounded-3xl border border-charcoal-200/90 bg-white overflow-hidden shadow-soft hover:shadow-card transition-all flex flex-col justify-between"
            >
              <div className="relative h-40 overflow-hidden">
                <img
                  src={dest.image}
                  alt={dest.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <span className="absolute top-3 left-3 text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-charcoal-950/80 text-white backdrop-blur-md">
                  {dest.badge}
                </span>
              </div>

              <div className="p-4 space-y-2 flex-1 flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-black text-charcoal-900">
                    {dest.name}
                  </h3>
                  <p className="text-xs text-charcoal-500 line-clamp-1 mt-0.5">
                    {dest.tagline}
                  </p>
                  <p className="text-[11px] text-charcoal-400 mt-1 line-clamp-1 font-mono">
                    ★ {dest.highlights}
                  </p>
                </div>

                <div className="pt-2 border-t border-charcoal-100 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-travion-700">
                    {dest.typicalFare}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectQuickDestination) {
                        onSelectQuickDestination(dest.name);
                      } else {
                        onPlanNewTrip();
                      }
                    }}
                    className="p-1.5 rounded-xl bg-sand-100 hover:bg-travion-600 hover:text-white text-charcoal-700 transition-colors"
                    title={`Plan trip to ${dest.name}`}
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
