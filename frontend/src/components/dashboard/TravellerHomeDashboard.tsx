import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Plus,
  Compass,
  MapPin,
  Calendar,
  Clock,
  ArrowRight,
  Heart,
  Luggage,
  Mountain,
  Landmark,
  Camera,
  Navigation,
  Globe,
  Sun,
  Trees,
  Waves,
  ChevronRight,
  BarChart3,
  TrendingUp,
  Wallet,
  Receipt,
  PieChart,
} from 'lucide-react';
import { TripItem, UserProfile } from '../../types';
import travionLogoNature from '../../assets/travion-logo-nature.png';
import { DashboardTab } from './TravellerSideDashboard';

interface TravellerHomeDashboardProps {
  userProfile?: UserProfile | null;
  userEmail: string;
  trips: TripItem[];
  onPlanNewTrip: () => void;
  onResumeTrip: (trip: TripItem) => void;
  onViewPaidTrip: (trip: TripItem) => void;
  onOpenSideDashboard: (initialTab?: DashboardTab) => void;
  onSelectQuickDestination?: (destinationName: string) => void;
}

const inr = (n: number | null | undefined) =>
  `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

interface DestinationInspiration {
  name: string;
  state: string;
  tagline: string;
  category: 'hills' | 'coastal' | 'heritage' | 'spiritual' | 'all';
  categoryLabel: string;
  badge: string;
  badgeType: 'sky' | 'blush' | 'nature' | 'cream';
  image: string;
  highlights: string[];
  weather: string;
}

const DESTINATION_INSPIRATIONS: DestinationInspiration[] = [
  {
    name: 'Munnar',
    state: 'Kerala',
    tagline: 'Emerald Mist, Rolling Hills & Tea Horizons',
    category: 'hills',
    categoryLabel: 'Misty Hill Station',
    badge: 'Tea Estate Haven',
    badgeType: 'nature',
    image: 'https://images.unsplash.com/photo-1593693397690-362cb9666fc2?auto=format&fit=crop&w=900&q=80',
    highlights: ['Tea Plantation Walk', 'Eravikulam Trails', 'Anamudi Peak View'],
    weather: '19°C · Gentle Mist',
  },
  {
    name: 'Goa',
    state: 'Goa',
    tagline: 'Azure Ocean Waves & Sun-Drenched Palm Shores',
    category: 'coastal',
    categoryLabel: 'Azure Coast',
    badge: 'Coastal Serenity',
    badgeType: 'sky',
    image: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=900&q=80',
    highlights: ['Palolem Sands', 'Old Latin Quarter', 'Sunset Sailing'],
    weather: '29°C · Ocean Breeze',
  },
  {
    name: 'Jaipur',
    state: 'Rajasthan',
    tagline: 'The Romantic Pink City & Majestic Amber Palaces',
    category: 'heritage',
    categoryLabel: 'Royal Heritage',
    badge: 'Blush Pink City',
    badgeType: 'blush',
    image: 'https://images.unsplash.com/photo-1477587458883-47145ed94245?auto=format&fit=crop&w=900&q=80',
    highlights: ['Hawa Mahal Dawn', 'Amber Fort Courtyards', 'Handicraft Bazaars'],
    weather: '25°C · Warm Sun',
  },
  {
    name: 'Udaipur',
    state: 'Rajasthan',
    tagline: 'City of Shimmering Lakes & Marble Palaces',
    category: 'heritage',
    categoryLabel: 'Lake Sanctuary',
    badge: 'Lakeside Serenade',
    badgeType: 'blush',
    image: 'https://images.unsplash.com/photo-1615836245337-f5b9b2303f10?auto=format&fit=crop&w=900&q=80',
    highlights: ['Lake Pichola Boat Ride', 'City Palace Balconies', 'Jagmandir Island'],
    weather: '26°C · Clear Sky',
  },
  {
    name: 'Hyderabad',
    state: 'Telangana',
    tagline: 'Historic Charminar, Nizam Palaces & Fragrant Biryani',
    category: 'heritage',
    categoryLabel: 'Royal Heritage',
    badge: 'City of Nizams',
    badgeType: 'cream',
    image: 'https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=900&q=80',
    highlights: ['Charminar Heritage Walk', 'Golconda Sunset', 'Chowmahalla Palace'],
    weather: '28°C · Pleasant',
  },
  {
    name: 'Varanasi',
    state: 'Uttar Pradesh',
    tagline: 'Sacred Sunrise Ghats on the Eternal River Ganga',
    category: 'spiritual',
    categoryLabel: 'Timeless Heritage',
    badge: 'Sacred Ganga',
    badgeType: 'sky',
    image: 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?auto=format&fit=crop&w=900&q=80',
    highlights: ['Subah-e-Banaras Boat', 'Evening Ganga Aarti', 'Ancient Alleys'],
    weather: '24°C · Serene',
  },
  {
    name: 'Manali',
    state: 'Himachal Pradesh',
    tagline: 'Pine Valleys, Rushing Glaciers & Crystal Mountain Skies',
    category: 'hills',
    categoryLabel: 'Mountain Peaks',
    badge: 'Alpine Sky',
    badgeType: 'sky',
    image: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=900&q=80',
    highlights: ['Solang Valley Heights', 'Old Manali Cafés', 'Jogini Waterfall Trail'],
    weather: '14°C · Crisp Air',
  },
  {
    name: 'Warangal',
    state: 'Telangana',
    tagline: 'Ancient Kakatiya Stone Temples & Sacred Gateways',
    category: 'heritage',
    categoryLabel: 'Sacred Stone Architecture',
    badge: 'Kakatiya Wonders',
    badgeType: 'cream',
    image: 'https://images.unsplash.com/photo-1626290467773-678cb54a5c9f?auto=format&fit=crop&w=900&q=80',
    highlights: ['Thousand Pillar Sanctuary', 'Kakatiya Stone Arch', 'Ramappa UNESCO'],
    weather: '27°C · Golden Light',
  },
];

const TRAVEL_MOODS = [
  { id: 'all', label: 'All Horizons', icon: Compass },
  { id: 'hills', label: 'Misty Hills & Tea Estates', icon: Mountain },
  { id: 'coastal', label: 'Azure Coasts & Palms', icon: Waves },
  { id: 'heritage', label: 'Palaces & Heritage', icon: Landmark },
  { id: 'spiritual', label: 'Sacred Rivers & Serenity', icon: Sun },
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
  const [selectedMood, setSelectedMood] = useState<string>('all');

  const displayName =
    userProfile?.preferred_name ||
    userProfile?.first_name ||
    userEmail.split('@')[0] ||
    'Datta Srinikesh';

  const permanentSource =
    userProfile?.home_city ||
    localStorage.getItem('travion_permanent_source') ||
    'Chennai';

  const plannedTrips = trips.filter((t) =>
    ['REQUESTED', 'PLANNED', 'DRAFT', 'ACTIVE', 'PAID', 'GUIDE_ASSIGNED'].includes(
      t.status
    )
  );

  const completedTrips = trips.filter((t) =>
    ['COMPLETED', 'FINISHED'].includes(t.status)
  );

  const latestTrip = plannedTrips[0] || null;

  // Total investment calculations
  const totalInvestment = trips.reduce(
    (sum, t) => sum + (Number(t.total_cost) || Number(t.budget) || 0),
    0
  );

  const avgCostPerTrip =
    trips.length > 0 ? Math.round(totalInvestment / trips.length) : 0;

  const plannedCapital = plannedTrips.reduce(
    (sum, t) => sum + (Number(t.total_cost) || Number(t.budget) || 0),
    0
  );

  const maxTripCost = Math.max(
    ...trips.map((t) => Number(t.total_cost) || Number(t.budget) || 0),
    1
  );

  const filteredDestinations =
    selectedMood === 'all'
      ? DESTINATION_INSPIRATIONS
      : DESTINATION_INSPIRATIONS.filter((d) => d.category === selectedMood);

  return (
    <div className="relative min-h-screen font-sans bg-[#FAF7F2] text-slate-800 pb-20 overflow-x-hidden selection:bg-sky-200 selection:text-sky-900">
      {/* ── ETHEREAL SKY, BEIGE & BLUSH AMBIENT GLOWS ── */}
      <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden">
        {/* Soft sky blue upper atmosphere */}
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] rounded-full bg-gradient-to-b from-sky-200/40 via-sky-100/25 to-transparent blur-3xl opacity-80" />
        {/* Baby pink blush sunrise glow on top-right */}
        <div className="absolute top-10 right-[-100px] w-[550px] h-[550px] rounded-full bg-gradient-to-bl from-pink-200/40 via-rose-100/20 to-transparent blur-3xl opacity-75" />
        {/* Warm cream/beige reflection on bottom-left */}
        <div className="absolute bottom-40 -left-20 w-[600px] h-[600px] rounded-full bg-gradient-to-tr from-amber-100/35 via-stone-100/20 to-transparent blur-3xl opacity-75" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 space-y-10 sm:space-y-12">
        {/* ── HERO CARD: GRAND LOGO CENTERPIECE (AS BIG AS THE CARD) + GREETING + GLASS CTA ── */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative rounded-[36px] bg-gradient-to-b from-white/95 via-white/90 to-[#FAF7F2]/95 border border-white/90 p-6 sm:p-10 lg:p-12 shadow-[0_16px_50px_-10px_rgba(14,165,233,0.14)] backdrop-blur-2xl overflow-hidden"
        >
          {/* Subtle sky cloud shimmer backdrop */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(186,230,253,0.4),transparent_65%),radial-gradient(ellipse_at_bottom_right,rgba(252,231,243,0.4),transparent_65%)] pointer-events-none"
          />

          <div className="relative z-10 flex flex-col items-center text-center max-w-4xl mx-auto space-y-6">
            {/* ── THE UPLOADED TRAVION LOGO: BOLD, EXPANSIVE & GRAND ── */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6 }}
              className="relative w-full max-w-3xl flex items-center justify-center py-2 sm:py-4"
            >
              {/* Radiant soft ambient halo behind logo */}
              <div className="absolute inset-0 w-3/4 mx-auto h-3/4 rounded-full bg-gradient-to-r from-sky-200/50 via-pink-100/40 to-sky-200/50 blur-2xl -z-10" />

              <img
                src={travionLogoNature}
                alt="TRAVION"
                className="w-full max-w-[96%] sm:max-w-[90%] md:max-w-[85%] h-auto max-h-[160px] sm:max-h-[220px] md:max-h-[280px] object-contain select-none filter drop-shadow-md mx-auto transition-transform duration-500 hover:scale-[1.01]"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (!target.src.endsWith('/travion-logo-nature.png')) {
                    target.src = '/travion-logo-nature.png';
                  }
                }}
              />
            </motion.div>

            {/* Personalized Warm Greeting with Permanent Origin Badge */}
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-sky-50 border border-sky-100 text-sky-800 text-xs font-semibold tracking-wide shadow-xs">
                  <Sparkles className="w-3.5 h-3.5 text-sky-500" />
                  <span>Welcome back, {displayName}</span>
                </span>

                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-pink-50 border border-pink-100 text-pink-700 text-xs font-semibold shadow-xs">
                  <MapPin className="w-3 h-3 text-pink-500" />
                  <span>Origin Hub: <strong>{permanentSource}</strong></span>
                </span>
              </div>

              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-slate-900 tracking-tight leading-snug">
                Where will your heart{' '}
                <span className="italic font-serif bg-gradient-to-r from-sky-600 via-sky-500 to-rose-400 bg-clip-text text-transparent">
                  travel next?
                </span>
              </h1>

              <p className="text-sm sm:text-base text-slate-600 font-normal leading-relaxed">
                Your personal travel sanctuary. Curate journeys through emerald hill stations, serene coastlines, and ancient horizons across India.
              </p>
            </div>

            {/* ── GLASSMORPHISM ACTION BUTTONS ── */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3.5 w-full sm:w-auto">
              {/* Primary "Plan a New Trip" Signature Glass CTA */}
              <motion.button
                type="button"
                whileHover={{ scale: 1.025, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={onPlanNewTrip}
                className="group w-full sm:w-auto flex items-center justify-between sm:justify-start gap-4 px-8 py-4 rounded-2xl bg-gradient-to-r from-sky-500 via-sky-600 to-sky-500 hover:from-sky-600 hover:to-sky-700 text-white font-bold text-base shadow-[0_12px_28px_rgba(14,165,233,0.32)] border border-sky-300/40 transition-all duration-300"
              >
                <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-white group-hover:rotate-12 transition-transform duration-300">
                  <Plus className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div className="text-left">
                  <span className="text-xs text-sky-100 font-medium block">
                    Begin Journey
                  </span>
                  <span className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-1.5">
                    Plan a New Trip
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </span>
                </div>
              </motion.button>

              {/* Secondary "Travel Hub & Analytics" Glass Pill */}
              <motion.button
                type="button"
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onOpenSideDashboard('analytics')}
                className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-3.5 px-6 py-4 rounded-2xl bg-white/95 hover:bg-white text-slate-800 font-semibold border border-slate-200/80 shadow-[0_6px_20px_rgba(0,0,0,0.04)] backdrop-blur-xl transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-pink-50 border border-pink-100 flex items-center justify-center text-pink-600">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <span className="text-xs text-slate-500 font-medium block">
                    Travel Intelligence
                  </span>
                  <span className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
                    Spending & Analytics
                    <span className="px-2 py-0.5 rounded-full text-xs font-black bg-pink-100 text-pink-700 border border-pink-200">
                      {inr(totalInvestment)}
                    </span>
                  </span>
                </div>
              </motion.button>
            </div>
          </div>
        </motion.section>

        {/* ── ACTIVE JOURNEY IN PROGRESS SPOTLIGHT (IF ANY) ── */}
        {latestTrip && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-[30px] bg-white/95 border border-sky-100/90 p-6 sm:p-7 shadow-[0_8px_30px_rgba(14,165,233,0.06)] backdrop-blur-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0 border border-sky-200/70 shadow-sm">
                <Compass className="w-6 h-6 animate-spin-slow" />
              </div>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-pink-50 text-pink-700 border border-pink-200/80">
                    {latestTrip.status === 'PAID' ? 'Confirmed Journey' : 'Trip in Planning'}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    {latestTrip.mode === 'GUIDE_MODE' ? 'Guided Experience' : 'Self-Exploration'}
                  </span>
                </div>

                <h3 className="text-lg sm:text-xl font-black text-slate-900 mt-1 flex items-center gap-2">
                  <span>{latestTrip.source_name}</span>
                  <ArrowRight className="w-4 h-4 text-sky-500" />
                  <span>{latestTrip.destination_name}</span>
                </h3>

                <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>
                    Investment:{' '}
                    <strong className="text-slate-800 font-bold">
                      {inr(latestTrip.total_cost || latestTrip.budget)}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>
                    {new Date(latestTrip.start_datetime).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    –{' '}
                    {new Date(latestTrip.end_datetime).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => onOpenSideDashboard('planned')}
                className="flex-1 sm:flex-initial px-4 h-11 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold transition-all shadow-sm"
              >
                All Trips ({plannedTrips.length})
              </button>

              {['PAID', 'ACTIVE', 'GUIDE_ASSIGNED'].includes(latestTrip.status) ? (
                <button
                  type="button"
                  onClick={() => onViewPaidTrip(latestTrip)}
                  className="flex-1 sm:flex-initial px-6 h-11 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-black flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-sky-600/20"
                >
                  <Navigation className="w-4 h-4" />
                  <span>Live Companion</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onResumeTrip(latestTrip)}
                  className="flex-1 sm:flex-initial px-6 h-11 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-black flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-sky-500/20"
                >
                  <span>Resume Plan</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </motion.section>
        )}

        {/* ── TRAVEL SPENDING & ANALYTICS OVERVIEW SECTION (CRITICAL REQUIREMENT) ── */}
        <section className="rounded-[32px] bg-gradient-to-r from-white via-white to-sky-50/50 border border-sky-100/80 p-7 sm:p-9 shadow-[0_8px_30px_rgba(0,0,0,0.03)] space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-sky-600 block flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Financial & Journey Analytics</span>
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-0.5">
                Your Complete Travel Investment Overview
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 font-normal">
                How much each journey costed, your cumulative travel spending, and trip analytics.
              </p>
            </div>

            <button
              type="button"
              onClick={() => onOpenSideDashboard('analytics')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-sky-50 text-sky-700 border border-sky-200 text-xs font-bold transition-all shadow-sm shrink-0"
            >
              <span>View Full Analytics Breakdown</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Metric Bento Pills */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-slate-200/70 space-y-1">
              <span className="text-[11px] font-bold text-slate-500 block">Total Investment</span>
              <div className="text-2xl font-black text-slate-900">{inr(totalInvestment)}</div>
              <span className="text-[10px] text-sky-700 font-semibold block">Across all {trips.length} journeys</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-slate-200/70 space-y-1">
              <span className="text-[11px] font-bold text-slate-500 block">Average per Journey</span>
              <div className="text-2xl font-black text-slate-900">{inr(avgCostPerTrip)}</div>
              <span className="text-[10px] text-pink-700 font-semibold block">Budget-to-actual allocation</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-slate-200/70 space-y-1">
              <span className="text-[11px] font-bold text-slate-500 block">Active Planning Capital</span>
              <div className="text-2xl font-black text-slate-900">{inr(plannedCapital)}</div>
              <span className="text-[10px] text-emerald-700 font-semibold block">{plannedTrips.length} active itineraries</span>
            </div>
          </div>

          {/* Quick Snapshot Table of Recent Trips Spending */}
          {trips.length > 0 && (
            <div className="space-y-2 pt-2">
              <span className="text-xs font-bold text-slate-700 block">Recent Journeys Cost Comparison</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {trips.slice(0, 3).map((trip) => {
                  const cost = Number(trip.total_cost) || Number(trip.budget) || 0;
                  const ratio = maxTripCost > 0 ? (cost / maxTripCost) * 100 : 0;
                  return (
                    <div
                      key={trip.id}
                      className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-black text-slate-900 truncate">
                          {trip.source_name} → {trip.destination_name}
                        </span>
                        <span className="font-extrabold text-sky-700">{inr(cost)}</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-sky-400 to-pink-400"
                          style={{ width: `${Math.max(ratio, 10)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>{new Date(trip.start_datetime).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>
                        <span className="uppercase font-semibold text-slate-500">{trip.status}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* ── TRAVEL MOODS & INSPIRATION HORIZONS (WITH AUTO-FILL ON CLICK) ── */}
        <section className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-sky-600 block">
                Inspiring Horizons
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-1">
                Wonders of Nature & Heritage
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 font-normal mt-1">
                Click <strong>"Plan this trip"</strong> to automatically fill the destination and your origin hub into Step 1!
              </p>
            </div>

            {/* Filter pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              {TRAVEL_MOODS.map((mood) => {
                const Icon = mood.icon;
                const isSelected = selectedMood === mood.id;
                return (
                  <button
                    key={mood.id}
                    type="button"
                    onClick={() => setSelectedMood(mood.id)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                      isSelected
                        ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/20'
                        : 'bg-white/80 hover:bg-white text-slate-600 border border-slate-200/80'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{mood.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Destination Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <AnimatePresence mode="popLayout">
              {filteredDestinations.map((dest, i) => {
                const badgeStyle =
                  dest.badgeType === 'blush'
                    ? 'bg-pink-50 text-pink-700 border-pink-200'
                    : dest.badgeType === 'nature'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : dest.badgeType === 'cream'
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-sky-50 text-sky-700 border-sky-200';

                return (
                  <motion.div
                    key={dest.name}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3, delay: i * 0.04 }}
                    whileHover={{ y: -5 }}
                    onClick={() => {
                      if (onSelectQuickDestination) {
                        onSelectQuickDestination(dest.name);
                      } else {
                        onPlanNewTrip();
                      }
                    }}
                    className="group relative rounded-[28px] overflow-hidden bg-white border border-slate-200/70 shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_16px_36px_rgba(14,165,233,0.12)] transition-all duration-300 cursor-pointer flex flex-col justify-between"
                  >
                    {/* Destination Image */}
                    <div className="relative h-48 overflow-hidden">
                      <img
                        src={dest.image}
                        alt={dest.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent" />

                      {/* Top Badges */}
                      <div className="absolute top-3 left-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold border backdrop-blur-md shadow-xs ${badgeStyle}`}
                        >
                          {dest.badge}
                        </span>
                      </div>

                      <div className="absolute top-3 right-3">
                        <span className="px-2 py-0.5 rounded-full bg-white/90 text-slate-800 backdrop-blur-md text-[10px] font-semibold border border-white/60">
                          {dest.weather}
                        </span>
                      </div>

                      {/* Bottom Image Overlay: City and State */}
                      <div className="absolute bottom-3 left-3.5 right-3.5 text-white">
                        <span className="text-[10px] font-medium tracking-wide text-sky-200 block">
                          {dest.state}, India
                        </span>
                        <h3 className="text-xl font-black tracking-tight">{dest.name}</h3>
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                      <div>
                        <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                          {dest.tagline}
                        </p>

                        <div className="mt-2.5 flex flex-wrap gap-1">
                          {dest.highlights.slice(0, 2).map((h, hi) => (
                            <span
                              key={hi}
                              className="px-2 py-0.5 rounded-lg bg-[#FAF7F2] border border-slate-200/60 text-[10.5px] font-medium text-slate-700"
                            >
                              {h}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Card Footer: Clear Autofill Trigger */}
                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-xs font-bold text-sky-600 group-hover:text-sky-700 flex items-center gap-1 transition-colors">
                          Plan this trip
                          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                        </span>

                        <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 group-hover:bg-sky-500 group-hover:text-white flex items-center justify-center transition-all shadow-xs">
                          <Plus className="w-4 h-4 stroke-[2.5]" />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </section>
      </div>
    </div>
  );
};
