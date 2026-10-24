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
  Waves,
  ChevronRight,
  BarChart3,
  TrendingUp,
  Wallet,
  Receipt,
  PieChart,
  Search,
  Plane,
  TrainFront,
  ShieldCheck,
  User,
  Coffee,
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
  onEditProfile?: () => void;
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
  onEditProfile,
}) => {
  const [selectedMood, setSelectedMood] = useState<string>('all');

  const displayName =
    userProfile?.preferred_name ||
    userProfile?.first_name ||
    userEmail.split('@')[0] ||
    'Datta Srinikesh';

  const userPhoto =
    userProfile?.photo_url ||
    localStorage.getItem('travion_user_photo') ||
    '';

  const permanentSource =
    userProfile?.home_city ||
    localStorage.getItem('travion_permanent_source') ||
    'Chennai';

  const userInterests: string[] = (() => {
    try {
      const saved = localStorage.getItem('travion_user_interests');
      return saved
        ? JSON.parse(saved)
        : ['🌲 Nature & Wilderness', '🏛️ Historic Heritage', '🏖️ Azure Coasts & Shorelines'];
    } catch {
      return ['🌲 Nature & Wilderness', '🏛️ Historic Heritage'];
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

  const initials = (displayName.charAt(0) || 'D').toUpperCase();

  return (
    <div className="relative min-h-screen font-sans bg-[#FAF7F2] text-slate-800 pb-24 overflow-x-hidden selection:bg-sky-200 selection:text-sky-900">
      {/* ── DRIBBLE-INSPIRED MULTI-LAYER AMBIENT LIVING LIGHTING ── */}
      <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden">
        {/* Morning Sky Blue Upper Atmosphere */}
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[1300px] h-[650px] rounded-full bg-gradient-to-b from-sky-200/40 via-sky-100/25 to-transparent blur-3xl opacity-80" />
        {/* Sunrise Baby Pink Blush on top-right */}
        <div className="absolute top-20 -right-28 w-[600px] h-[600px] rounded-full bg-gradient-to-bl from-pink-200/40 via-rose-100/25 to-transparent blur-3xl opacity-75" />
        {/* Warm Linen & Cream Gold on bottom-left */}
        <div className="absolute bottom-20 -left-28 w-[650px] h-[650px] rounded-full bg-gradient-to-tr from-amber-100/35 via-stone-100/25 to-transparent blur-3xl opacity-75" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 space-y-10 sm:space-y-12">
        {/* ── TOP UTILITY STRIP: ORIGIN HUB + AVATAR + QUICK ACTIONS ── */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-2 border-b border-slate-200/60 pb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-white shadow-md bg-gradient-to-br from-sky-400 to-pink-400 flex items-center justify-center text-white font-black text-sm select-none">
                {userPhoto ? (
                  <img src={userPhoto} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
              <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white shadow-xs" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-slate-900 leading-tight">
                  {displayName}
                </h3>
                <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-2 py-0.2 rounded-full border border-sky-200">
                  Traveller Hub
                </span>
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                <MapPin className="w-3 h-3 text-sky-600" />
                <span>Origin Hub: <strong className="text-slate-800 font-semibold">{permanentSource}</strong></span>
                {onEditProfile && (
                  <button
                    type="button"
                    onClick={onEditProfile}
                    className="text-[10px] font-bold text-sky-600 hover:text-sky-800 underline ml-1"
                  >
                    Change
                  </button>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            {onEditProfile && (
              <button
                type="button"
                onClick={onEditProfile}
                className="px-3.5 h-9 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
              >
                <User className="w-3.5 h-3.5 text-slate-500" />
                <span>Edit Profile & Photo</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenSideDashboard('analytics')}
              className="px-3.5 h-9 rounded-xl bg-pink-50 hover:bg-pink-100 text-pink-700 border border-pink-200 text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            >
              <BarChart3 className="w-3.5 h-3.5 text-pink-600" />
              <span>Spending: {inr(totalInvestment)}</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenSideDashboard('planned')}
              className="px-3.5 h-9 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            >
              <Compass className="w-3.5 h-3.5 text-sky-600" />
              <span>Saved Trips ({plannedTrips.length})</span>
            </button>
          </div>
        </header>

        {/* ── GRAND HERO SANCTUARY: MASSIVE NATURE LOGO + AIRY ARCHITECTURAL PAVILION ── */}
        <motion.section
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative rounded-[40px] bg-gradient-to-b from-white/95 via-white/90 to-[#FAF7F2]/95 border border-white/90 p-6 sm:p-10 lg:p-14 shadow-[0_20px_60px_-15px_rgba(14,165,233,0.15)] backdrop-blur-2xl overflow-hidden"
        >
          {/* Subtle sky cloud shimmer backdrop */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(186,230,253,0.45),transparent_65%),radial-gradient(ellipse_at_bottom_right,rgba(252,231,243,0.45),transparent_65%)] pointer-events-none"
          />

          <div className="relative z-10 flex flex-col items-center text-center max-w-4xl mx-auto space-y-6">
            {/* Top architectural luxury pill */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/90 backdrop-blur-xl border border-sky-100 text-sky-800 text-xs font-bold tracking-wider shadow-xs">
              <Sparkles className="w-3.5 h-3.5 text-sky-500" />
              <span>PERSONAL TRAVEL SANCTUARY · INDIA</span>
            </div>

            {/* ── THE GRAND TRAVION NATURE LOGO (EXPANSIVE & STUNNING) ── */}
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.7 }}
              className="relative w-full max-w-4xl flex items-center justify-center py-2 sm:py-4"
            >
              {/* Radiant soft ambient halo behind logo */}
              <div className="absolute inset-0 w-4/5 mx-auto h-4/5 rounded-full bg-gradient-to-r from-sky-200/50 via-pink-100/40 to-sky-200/50 blur-2xl -z-10" />

              <img
                src={travionLogoNature}
                alt="TRAVION"
                className="w-full max-w-[96%] sm:max-w-[90%] md:max-w-[85%] h-auto max-h-[170px] sm:max-h-[240px] md:max-h-[300px] object-contain select-none filter drop-shadow-md mx-auto transition-transform duration-500 hover:scale-[1.01]"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (!target.src.endsWith('/travion-logo-nature.png')) {
                    target.src = '/travion-logo-nature.png';
                  }
                }}
              />
            </motion.div>

            {/* Personalized Welcoming Editorial Headline */}
            <div className="space-y-2 max-w-2xl mx-auto">
              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-slate-900 tracking-tight leading-snug">
                Where India's wonders become your{' '}
                <span className="italic font-serif bg-gradient-to-r from-sky-600 via-sky-500 to-rose-400 bg-clip-text text-transparent">
                  unforgettable story.
                </span>
              </h1>

              <p className="text-sm sm:text-base text-slate-600 font-normal leading-relaxed">
                Curating emerald hill stations, azure coastlines, and ancient horizons across India with verified routes and deterministic financial clarity.
              </p>
            </div>

            {/* ── DRIBBLE-STYLE FLOATING QUICK SEARCH LAUNCHER STRIP ── */}
            <motion.div
              whileHover={{ y: -2 }}
              onClick={onPlanNewTrip}
              className="w-full max-w-3xl mt-4 p-2 sm:p-2.5 rounded-3xl bg-white/95 border border-white shadow-[0_12px_36px_rgba(14,165,233,0.12)] backdrop-blur-2xl flex flex-col sm:flex-row items-center justify-between gap-3 cursor-pointer group transition-all"
            >
              {/* Origin Section */}
              <div className="flex items-center gap-2.5 px-4 py-2 w-full sm:w-auto text-left">
                <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0 border border-sky-100">
                  <MapPin className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Starting From
                  </span>
                  <span className="text-sm font-black text-slate-900">
                    {permanentSource}
                  </span>
                </div>
              </div>

              <div className="hidden sm:block w-px h-8 bg-slate-200" />

              {/* Destination Section */}
              <div className="flex items-center gap-2.5 px-4 py-2 w-full sm:w-auto flex-1 text-left">
                <div className="w-9 h-9 rounded-xl bg-pink-50 text-pink-600 flex items-center justify-center shrink-0 border border-pink-100">
                  <Navigation className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Destination
                  </span>
                  <span className="text-sm font-semibold text-slate-500 group-hover:text-slate-800 transition-colors">
                    Search any city, region, or landmark…
                  </span>
                </div>
              </div>

              {/* Action Button */}
              <button
                type="button"
                className="w-full sm:w-auto px-7 py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 via-sky-600 to-sky-500 text-white font-black text-sm flex items-center justify-center gap-2 shadow-md shadow-sky-500/25 group-hover:shadow-lg group-hover:shadow-sky-500/35 transition-all"
              >
                <span>Plan a New Trip</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </motion.div>
          </div>
        </motion.section>

        {/* ── DRIBBLE BENTO GRID: LIVING JOURNEY & ANALYTICS INTELLIGENCE ── */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* ── BENTO 1: ACTIVE JOURNEY SPOTLIGHT (BOARDING PASS AESTHETIC) ── */}
          <div className="md:col-span-2 rounded-[32px] bg-white border border-sky-100 p-6 sm:p-7 shadow-[0_8px_30px_rgba(0,0,0,0.03)] flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-pink-50 text-pink-700 border border-pink-200">
                <Sparkles className="w-3 h-3 text-pink-500" />
                <span>{latestTrip ? 'Active Journey in Progress' : 'No Trips in Progress'}</span>
              </span>

              {latestTrip && (
                <span className="text-xs font-mono text-slate-400">
                  {new Date(latestTrip.start_datetime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {new Date(latestTrip.end_datetime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>

            {latestTrip ? (
              <div className="space-y-4">
                {/* Route visualization */}
                <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 uppercase font-bold block">Departure</span>
                    <h3 className="text-xl sm:text-2xl font-black text-slate-900">{latestTrip.source_name}</h3>
                  </div>

                  <div className="flex flex-col items-center px-4">
                    <span className="text-[10px] font-mono text-sky-600 font-bold uppercase">Corridor</span>
                    <div className="w-20 sm:w-28 h-0.5 bg-gradient-to-r from-sky-400 to-pink-400 my-1 relative flex items-center justify-center">
                      <Plane className="w-3.5 h-3.5 text-sky-600 absolute" />
                    </div>
                    <span className="text-[10px] text-slate-400">Direct Route</span>
                  </div>

                  <div className="text-right">
                    <span className="text-xs text-slate-400 uppercase font-bold block">Arrival</span>
                    <h3 className="text-xl sm:text-2xl font-black text-slate-900">{latestTrip.destination_name}</h3>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
                  <div>
                    <span className="text-xs text-slate-500 block">Total Planned Investment</span>
                    <span className="text-xl font-black text-slate-900">{inr(latestTrip.total_cost || latestTrip.budget)}</span>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => onOpenSideDashboard('planned')}
                      className="flex-1 sm:flex-initial px-4 h-10 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold transition-all"
                    >
                      All Plans ({plannedTrips.length})
                    </button>

                    {['PAID', 'ACTIVE', 'GUIDE_ASSIGNED'].includes(latestTrip.status) ? (
                      <button
                        type="button"
                        onClick={() => onViewPaidTrip(latestTrip)}
                        className="flex-1 sm:flex-initial px-5 h-10 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        <span>Live Companion</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onResumeTrip(latestTrip)}
                        className="flex-1 sm:flex-initial px-5 h-10 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <span>Resume Planning</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center space-y-2">
                <Luggage className="w-8 h-8 text-sky-400 mx-auto" />
                <h4 className="text-base font-black text-slate-800">Your Next Journey Awaits</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Pick any destination across India and let Travion build an itinerary matching your exact preferences.
                </p>
                <button
                  type="button"
                  onClick={onPlanNewTrip}
                  className="mt-2 px-5 py-2 rounded-xl bg-sky-500 text-white text-xs font-bold"
                >
                  Plan a Trip Now
                </button>
              </div>
            )}
          </div>

          {/* ── BENTO 2: FINANCIAL INTELLIGENCE & SPENDING ANALYTICS ── */}
          <div className="rounded-[32px] bg-white border border-pink-100 p-6 sm:p-7 shadow-[0_8px_30px_rgba(0,0,0,0.03)] flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-sky-50 text-sky-700 border border-sky-200">
                  <BarChart3 className="w-3 h-3 text-sky-600" />
                  <span>Spending Intelligence</span>
                </span>
                <span className="text-[10px] font-black text-slate-400 uppercase">{trips.length} Trips</span>
              </div>

              <div className="mt-4 space-y-1">
                <span className="text-xs text-slate-500 font-semibold block">Total Travel Spend</span>
                <div className="text-2xl sm:text-3xl font-black text-slate-900">{inr(totalInvestment)}</div>
                <span className="text-[11px] text-pink-700 font-bold block">
                  Avg: {inr(avgCostPerTrip)} per journey
                </span>
              </div>

              {/* Progress Bar */}
              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between text-[11px] text-slate-500 font-semibold">
                  <span>Planned vs Spent</span>
                  <span>{plannedCapital > 0 ? inr(plannedCapital) : '₹0'} Active</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden flex">
                  <div
                    className="h-full bg-gradient-to-r from-sky-400 to-pink-400"
                    style={{ width: totalInvestment > 0 ? `${Math.min(100, Math.max(15, (plannedCapital / totalInvestment) * 100))}%` : '20%' }}
                  />
                </div>
              </div>

              {/* Cost Allocations Preview */}
              <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 rounded-xl bg-[#FAF7F2] border border-slate-100">
                  <span className="block font-bold text-slate-800">🚆 Transport ~30%</span>
                  <span className="text-[10px] text-slate-400">Verified corridors</span>
                </div>
                <div className="p-2 rounded-xl bg-[#FAF7F2] border border-slate-100">
                  <span className="block font-bold text-slate-800">🏨 Stays ~40%</span>
                  <span className="text-[10px] text-slate-400">Curated boutique</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onOpenSideDashboard('analytics')}
              className="w-full py-2.5 rounded-xl bg-pink-50 hover:bg-pink-100 text-pink-700 border border-pink-200 text-xs font-bold transition-all text-center block mt-2"
            >
              Explore Full Analytics →
            </button>
          </div>
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
                Click <strong>"Plan this trip"</strong> to automatically fill the destination and origin into Step 1!
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

                const headerGradient =
                  dest.badgeType === 'blush'
                    ? 'from-pink-50 via-rose-50/60 to-amber-50/50'
                    : dest.badgeType === 'nature'
                    ? 'from-emerald-50 via-teal-50/60 to-sky-50/60'
                    : dest.badgeType === 'cream'
                    ? 'from-amber-50 via-yellow-50/50 to-pink-50/40'
                    : 'from-sky-50 via-cyan-50/60 to-indigo-50/40';

                return (
                  <motion.div
                    key={dest.name}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3, delay: i * 0.04 }}
                    whileHover={{ y: -6 }}
                    onClick={() => {
                      if (onSelectQuickDestination) {
                        onSelectQuickDestination(dest.name);
                      } else {
                        onPlanNewTrip();
                      }
                    }}
                    className="group relative rounded-[28px] overflow-hidden bg-white border border-slate-200/70 shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_16px_36px_rgba(14,165,233,0.12)] transition-all duration-300 cursor-pointer flex flex-col justify-between"
                  >
                    {/* Destination Visual Banner (Zero External Images) */}
                    <div className={`p-5 bg-gradient-to-br ${headerGradient} border-b border-slate-200/80 relative overflow-hidden`}>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold border backdrop-blur-md shadow-xs ${badgeStyle}`}
                        >
                          {dest.badge}
                        </span>

                        <span className="px-2 py-0.5 rounded-full bg-white/90 text-slate-800 backdrop-blur-md text-[10px] font-semibold border border-white/60">
                          {dest.weather}
                        </span>
                      </div>

                      {/* City and State */}
                      <div className="mt-3">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                          {dest.state}, India
                        </span>
                        <h3 className="text-2xl font-black text-slate-900 tracking-tight">{dest.name}</h3>
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
