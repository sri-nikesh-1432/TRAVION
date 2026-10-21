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
  Shield,
  Layers,
  Leaf,
  Sun,
  Trees,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { TripItem, UserProfile } from '../../types';

interface TravellerHomeDashboardProps {
  userProfile?: UserProfile | null;
  userEmail: string;
  trips: TripItem[];
  onPlanNewTrip: () => void;
  onResumeTrip: (trip: TripItem) => void;
  onViewPaidTrip: (trip: TripItem) => void;
  onOpenSideDashboard: () => void;
  onSelectQuickDestination?: (destinationName: string) => void;
}

const inr = (n: number | null | undefined) =>
  `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

const NATURAL_WONDERS = [
  {
    name: 'Munnar',
    state: 'Kerala',
    tagline: 'Emerald Mist & Tea Plantations',
    badge: 'Scenic Mountain Haven',
    image: 'https://images.unsplash.com/photo-1593693397690-362cb9666fc2?auto=format&fit=crop&w=800&q=80',
    highlights: ['Tea Estate Trails', 'Eravikulam National Park', 'Anamudi Peak'],
    fare: '₹1,440 Scenic Coach',
    weather: '19°C · Misty',
  },
  {
    name: 'Hyderabad',
    state: 'Telangana',
    tagline: 'City of Nizams & Historic Charminar',
    badge: 'Heritage & Gastronomy',
    image: 'https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=800&q=80',
    highlights: ['Charminar', 'Golconda Fort', 'Chowmahalla Palace', 'Biryani Trail'],
    fare: '₹1,150 IRCTC Superfast',
    weather: '28°C · Pleasant',
  },
  {
    name: 'Warangal',
    state: 'Telangana',
    tagline: 'Kakatiya Dynasty & Ancient Stone Temples',
    badge: 'Sacred Stone Architecture',
    image: 'https://images.unsplash.com/photo-1626290467773-678cb54a5c9f?auto=format&fit=crop&w=800&q=80',
    highlights: ['Thousand Pillar Temple', 'Kakatiya Fort Gates', 'Ramappa UNESCO'],
    fare: '₹940 Express Train',
    weather: '27°C · Clear',
  },
  {
    name: 'Jaipur',
    state: 'Rajasthan',
    tagline: 'The Royal Pink City & Palatial Forts',
    badge: 'Regal Splendor',
    image: 'https://images.unsplash.com/photo-1477587458883-47145ed94245?auto=format&fit=crop&w=800&q=80',
    highlights: ['Amber Fort', 'Hawa Mahal', 'City Palace', 'Bazaars'],
    fare: '₹1,850 Express Line',
    weather: '25°C · Sunny',
  },
  {
    name: 'Goa',
    state: 'Goa',
    tagline: 'Sun-Kissed Coastlines & Portuguese Vibe',
    badge: 'Coastal Serenity',
    image: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=800&q=80',
    highlights: ['Old Goa Churches', 'Palolem Beach', 'Spice Plantations'],
    fare: '₹2,100 Coastal Express',
    weather: '29°C · Tropical',
  },
  {
    name: 'Varanasi',
    state: 'Uttar Pradesh',
    tagline: 'Spiritual Ghats & Sacred Ganga River',
    badge: 'Eternal Heritage',
    image: 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?auto=format&fit=crop&w=800&q=80',
    highlights: ['Dashashwamedh Ghat', 'Ganga Aarti', 'Sarnath', 'Silk Guilds'],
    fare: '₹1,750 Vande Bharat',
    weather: '24°C · Serene',
  },
];

export const TravellerHomeDashboard: React.FC<TravellerHomeDashboardProps> = ({
  userProfile,
  userEmail,
  trips,
  onPlanNewTrip,
  onResumeTrip,
  onViewPaidTrip,
  onOpenSideDashboard,
  onSelectQuickDestination,
}) => {
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

  const latestTrip = plannedTrips[0] || null;

  return (
    <div className="relative min-h-screen font-sans overflow-hidden">
      {/* ── AMBIENT LIVING NATURE BACKGROUND (APPLE-INSPIRED AURA) ── */}
      <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden">
        {/* Soft emerald forest glow orb */}
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-emerald-200/40 via-teal-100/30 to-transparent blur-3xl opacity-70 animate-pulse duration-[10000ms]" />
        {/* Sunrise amber gold aura */}
        <div className="absolute top-1/4 -right-40 w-[550px] h-[550px] rounded-full bg-gradient-to-bl from-amber-200/40 via-orange-100/25 to-transparent blur-3xl opacity-60" />
        {/* Mountain mist teal aura */}
        <div className="absolute bottom-10 left-1/3 w-[650px] h-[450px] rounded-full bg-gradient-to-tr from-travion-100/40 via-emerald-100/30 to-transparent blur-3xl opacity-50" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-12">
        {/* ── CINEMATIC APPLE-GRADE HERO BANNER ── */}
        <motion.section
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative rounded-[36px] overflow-hidden bg-gradient-to-br from-charcoal-900/95 via-charcoal-850/95 to-charcoal-950/95 text-white p-8 sm:p-12 lg:p-16 shadow-2xl border border-white/10 backdrop-blur-3xl"
        >
          {/* Subtle nature mesh texture overlay */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_50%),radial-gradient(circle_at_bottom_left,rgba(245,158,11,0.12),transparent_50%)] pointer-events-none"
          />

          <div className="relative z-10 max-w-4xl space-y-6">
            {/* Supertag pill */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-xl border border-white/20 text-emerald-300 text-xs font-mono font-bold tracking-wider shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>NEXT-GEN AI TRAVEL ORCHESTRATION</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.08] text-white">
              Where India's wonders become your{' '}
              <span className="italic font-editorial bg-gradient-to-r from-emerald-400 via-teal-300 to-amber-300 bg-clip-text text-transparent">
                unforgettable story.
              </span>
            </h1>

            {/* Editorial Description */}
            <p className="text-sm sm:text-base lg:text-lg text-charcoal-300 font-medium leading-relaxed max-w-2xl">
              Welcome back, <strong className="text-white font-bold">{displayName}</strong>. Experience travel planned with pure deterministic math — verified IRCTC rail corridors, genuine hotel rooms, and handpicked local cuisine.
            </p>

            {/* ── THE SIGNATURE APPLE-STYLE GLASSMORPHISM BUTTONS ── */}
            <div className="pt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              {/* Primary Glassmorphism "Plan a New Trip" CTA */}
              <motion.button
                type="button"
                whileHover={{ scale: 1.025, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={onPlanNewTrip}
                className="group relative flex items-center justify-between sm:justify-start gap-4 px-8 py-5 rounded-[26px] bg-gradient-to-r from-travion-600/90 via-emerald-600/90 to-travion-700/90 hover:from-travion-500/95 hover:to-emerald-500/95 text-white backdrop-blur-2xl border border-white/30 shadow-[0_20px_50px_rgba(16,185,129,0.3)] transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md border border-white/40 flex items-center justify-center text-white shadow-md group-hover:rotate-12 transition-transform duration-300">
                  <Plus className="w-6 h-6 stroke-[3]" />
                </div>
                <div className="text-left">
                  <span className="text-[10.5px] font-mono font-black uppercase tracking-wider text-emerald-200 block">
                    AI Journey Orchestrator
                  </span>
                  <span className="text-lg sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
                    Plan a New Trip
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1.5 transition-transform" />
                  </span>
                  <span className="text-xs text-white/80 font-medium">
                    From, To, Dates & Verified Fares
                  </span>
                </div>
              </motion.button>

              {/* Secondary Side Dashboard Trigger Glass Pill */}
              <motion.button
                type="button"
                whileHover={{ scale: 1.025, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={onOpenSideDashboard}
                className="flex items-center justify-between sm:justify-start gap-3.5 px-6 py-5 rounded-[26px] bg-white/10 hover:bg-white/15 text-white backdrop-blur-2xl border border-white/20 shadow-lg hover:shadow-xl transition-all"
              >
                <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-emerald-400">
                  <Compass className="w-6 h-6" />
                </div>
                <div className="text-left">
                  <span className="text-[10.5px] font-mono font-black uppercase tracking-wider text-charcoal-400 block">
                    Your Travel Hub
                  </span>
                  <span className="text-base font-black text-white flex items-center gap-1.5">
                    View Trips & Memories
                    <span className="px-2 py-0.5 rounded-full text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {plannedTrips.length}
                    </span>
                  </span>
                  <span className="text-xs text-charcoal-400 font-medium">
                    Side dashboard with all plans & settings →
                  </span>
                </div>
              </motion.button>
            </div>
          </div>
        </motion.section>

        {/* ── FLOATING GLASS METRIC CAPSULES (APPLE STYLE) ── */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Real IRCTC Schedules', val: 'Verified Trains', icon: TrainFront, color: 'text-emerald-600 bg-emerald-50/80 border-emerald-200/80' },
            { label: 'Deterministic Pricing', val: 'Zero Rupee Drift', icon: ShieldCheck, color: 'text-amber-600 bg-amber-50/80 border-amber-200/80' },
            { label: 'Curated Verified Stays', val: 'Real Bed Math', icon: Landmark, color: 'text-indigo-600 bg-indigo-50/80 border-indigo-200/80' },
            { label: 'Emergency Fund', val: '15% Protected', icon: Shield, color: 'text-teal-600 bg-teal-50/80 border-teal-200/80' },
          ].map((item, idx) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={idx}
                whileHover={{ y: -3 }}
                className="p-4 rounded-3xl bg-white/80 backdrop-blur-xl border border-white/80 shadow-soft hover:shadow-card transition-all flex items-center gap-3.5"
              >
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border ${item.color} shrink-0`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-xs font-black text-charcoal-900 block leading-tight">
                    {item.val}
                  </span>
                  <span className="text-[11px] font-semibold text-charcoal-400">
                    {item.label}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </section>

        {/* ── IN-PROGRESS JOURNEY HIGHLIGHT (IF ANY TRIPS EXIST) ── */}
        {latestTrip && (
          <section className="rounded-3xl bg-gradient-to-r from-emerald-500/10 via-sand-50/80 to-amber-500/10 border border-emerald-200/60 p-6 sm:p-7 backdrop-blur-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 shadow-soft">
            <div className="flex items-center gap-4">
              <span className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md">
                <Compass className="w-6 h-6 animate-pulse" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                    {latestTrip.status === 'PAID' ? 'Confirmed & Active' : 'Active Plan in Progress'}
                  </span>
                  <span className="text-xs font-mono text-charcoal-500 font-bold">
                    {latestTrip.mode === 'GUIDE_MODE' ? 'Guide Mode' : 'Adventurous'}
                  </span>
                </div>
                <h3 className="text-lg sm:text-xl font-black text-charcoal-900 mt-1 flex items-center gap-2">
                  <span>{latestTrip.source_name}</span>
                  <ArrowRight className="w-4 h-4 text-emerald-600" />
                  <span>{latestTrip.destination_name}</span>
                </h3>
                <p className="text-xs text-charcoal-500 mt-0.5">
                  Investment: <strong className="text-charcoal-900">{inr(latestTrip.total_cost || latestTrip.budget)}</strong> ·{' '}
                  {new Date(latestTrip.start_datetime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} –{' '}
                  {new Date(latestTrip.end_datetime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={onOpenSideDashboard}
                className="flex-1 sm:flex-initial px-4 h-11 rounded-2xl bg-white border border-charcoal-200 hover:border-charcoal-300 text-charcoal-700 text-xs font-bold transition-all shadow-sm"
              >
                All Trips ({plannedTrips.length})
              </button>
              {['PAID', 'ACTIVE', 'GUIDE_ASSIGNED'].includes(latestTrip.status) ? (
                <button
                  type="button"
                  onClick={() => onViewPaidTrip(latestTrip)}
                  className="flex-1 sm:flex-initial px-6 h-11 rounded-2xl bg-charcoal-900 hover:bg-black text-emerald-400 text-xs font-black flex items-center justify-center gap-1.5 transition-colors shadow-soft"
                >
                  <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Live Companion</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onResumeTrip(latestTrip)}
                  className="flex-1 sm:flex-initial px-6 h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center justify-center gap-1.5 transition-colors shadow-md"
                >
                  <span>Resume Plan</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </section>
        )}

        {/* ── WONDERS OF INDIA: ICONIC NATURE & HERITAGE SHOWCASE ── */}
        <section className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <span className="text-[10.5px] font-mono font-black uppercase tracking-wider text-emerald-700 block">
                EXPLORE NATURAL & HISTORIC DESTINATIONS
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-charcoal-900 tracking-tight mt-1">
                Wonders of India, Grounded in Real Routes
              </h2>
              <p className="text-xs sm:text-sm text-charcoal-500 font-medium mt-1">
                Every destination is fully indexed with real train timetables, iconic monuments, and curated stays.
              </p>
            </div>

            <button
              type="button"
              onClick={onPlanNewTrip}
              className="inline-flex items-center gap-1.5 text-xs font-black text-emerald-700 hover:text-emerald-900 transition-colors shrink-0"
            >
              <span>Explore all destinations</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {NATURAL_WONDERS.map((wonder, i) => (
              <motion.div
                key={wonder.name}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                whileHover={{ y: -6 }}
                onClick={() => {
                  if (onSelectQuickDestination) {
                    onSelectQuickDestination(wonder.name);
                  } else {
                    onPlanNewTrip();
                  }
                }}
                className="group relative rounded-[32px] overflow-hidden bg-white/90 backdrop-blur-2xl border border-charcoal-200/80 shadow-soft hover:shadow-2xl transition-all cursor-pointer flex flex-col justify-between"
              >
                {/* Destination Image with ambient gradient overlay */}
                <div className="relative h-56 overflow-hidden">
                  <img
                    src={wonder.image}
                    alt={wonder.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-charcoal-950/80 via-transparent to-black/20" />

                  {/* Top Badges */}
                  <div className="absolute top-4 left-4 flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full bg-charcoal-950/80 text-white backdrop-blur-md text-[10px] font-mono font-black uppercase tracking-wider">
                      {wonder.badge}
                    </span>
                  </div>

                  <div className="absolute top-4 right-4">
                    <span className="px-2.5 py-1 rounded-full bg-white/90 text-charcoal-900 backdrop-blur-md text-[10px] font-bold">
                      {wonder.weather}
                    </span>
                  </div>

                  {/* Bottom Image Overlay: Name & State */}
                  <div className="absolute bottom-4 left-4 right-4 text-white">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300 block">
                      {wonder.state}, India
                    </span>
                    <h3 className="text-2xl font-black tracking-tight">{wonder.name}</h3>
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-5 space-y-4 flex-1 flex flex-col justify-between bg-white">
                  <div>
                    <p className="text-xs font-semibold text-charcoal-600 leading-snug">
                      {wonder.tagline}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {wonder.highlights.slice(0, 3).map((h, hi) => (
                        <span
                          key={hi}
                          className="px-2.5 py-1 rounded-xl bg-sand-100/80 text-[10.5px] font-semibold text-charcoal-700"
                        >
                          {h}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-charcoal-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-mono uppercase text-charcoal-400 block font-bold">
                        Transit Connectivity
                      </span>
                      <span className="text-xs font-black text-emerald-700">
                        {wonder.fare}
                      </span>
                    </div>

                    <div className="w-9 h-9 rounded-xl bg-charcoal-900 group-hover:bg-emerald-600 text-white flex items-center justify-center transition-colors shadow-sm">
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── CONSCIOUS & DETERMINISTIC TRAVEL PHILOSOPHY ── */}
        <section className="rounded-[32px] bg-white/70 backdrop-blur-2xl border border-charcoal-200/80 p-8 sm:p-10 shadow-soft space-y-6">
          <div className="max-w-2xl">
            <span className="text-[10px] font-mono font-black uppercase tracking-wider text-emerald-700 block">
              TRAVION CORE ARCHITECTURE
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-charcoal-900 tracking-tight mt-1">
              Built on 3 Non-Negotiable Travel Principles
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-5 rounded-3xl bg-sand-50/60 border border-charcoal-100 space-y-2.5">
              <span className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black">
                1
              </span>
              <h3 className="text-sm font-black text-charcoal-900">Deterministic Financial Math</h3>
              <p className="text-xs text-charcoal-500 leading-relaxed">
                AI models never guess money. Transport fares, hotel tariffs, food allowances, and platform fees match from Stage 8 to payment with zero rupee mismatch.
              </p>
            </div>

            <div className="p-5 rounded-3xl bg-sand-50/60 border border-charcoal-100 space-y-2.5">
              <span className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center font-black">
                2
              </span>
              <h3 className="text-sm font-black text-charcoal-900">Zero Hallucinated Geography</h3>
              <p className="text-xs text-charcoal-500 leading-relaxed">
                Every landmark and station is verified via Google Places and official IRCTC rail timetables. Never fictional tourist spots or nonexistent trains.
              </p>
            </div>

            <div className="p-5 rounded-3xl bg-sand-50/60 border border-charcoal-100 space-y-2.5">
              <span className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-800 flex items-center justify-center font-black">
                3
              </span>
              <h3 className="text-sm font-black text-charcoal-900">Full-Screen Live Companion</h3>
              <p className="text-xs text-charcoal-500 leading-relaxed">
                After payment, your trip opens in an immersive full-screen tour companion with real-time GPS speedometer, Indian rail tracking, and offline support.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
