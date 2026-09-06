import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ArrowRight, ArrowUpRight, BadgeCheck, BedDouble, Bell, BookOpen, BrainCircuit,
  Check, CheckCircle2, ChevronDown, Clock, CloudRain, Compass,
  Eye, EyeOff, Globe2, HeartHandshake, IndianRupee, Key, Landmark,
  Layers, Lock, Mail, MapPin, Menu, Mountain, Navigation, Phone,
  RefreshCw, Route, ShieldCheck, Train, Users, Utensils,
  Wallet, X
} from 'lucide-react';
import { LocationItem } from '../types';
import { api, authStorage, resolveApiBaseUrl } from '../services/api';
import { TripSearchBar } from '../components/search-bar/TripSearchBar';

interface LandingPageProps {
  onLoginSuccess: (session: any) => void;
  onExploreDemo: () => void;
  onOpenGuideRegistration: () => void;
  onOpenGuideSignIn: () => void;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/* ─── Destinations for discovery section ─── */
const FEATURED_DESTINATIONS = [
  { name: 'Munnar', state: 'Kerala', description: 'Lush tea plantations, cool mountain air, and winding roads through the Western Ghats.', hero_image: 'https://images.unsplash.com/photo-1592322585812-2afed89e2a59?auto=format&fit=crop&w=800&q=80' },
  { name: 'Goa', state: 'Goa', description: 'Golden beaches, Portuguese heritage, vibrant food scene, and unforgettable sunsets.', hero_image: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?auto=format&fit=crop&w=800&q=80' },
  { name: 'Rajasthan', state: 'Rajasthan', description: 'Royal palaces, desert adventures, vibrant markets, and centuries of living history.', hero_image: 'https://images.unsplash.com/photo-1470601500940-4a638a1cfea3?auto=format&fit=crop&w=800&q=80' },
  { name: 'Varanasi', state: 'Uttar Pradesh', description: 'Ancient ghats, spiritual energy, morning boat rides on the Ganges, and timeless rituals.', hero_image: 'https://images.unsplash.com/photo-1622474752919-7ebe9227b78c?auto=format&fit=crop&w=800&q=80' },
  { name: 'Andaman Islands', state: 'Andaman & Nicobar', description: 'Crystal-clear waters, pristine beaches, coral reefs, and unforgettable underwater experiences.', hero_image: 'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?auto=format&fit=crop&w=800&q=80' },
  { name: 'Hampi', state: 'Karnataka', description: 'Stunning boulder landscapes, ancient Vijayanagara ruins, and a surreal otherworldly terrain.', hero_image: 'https://images.unsplash.com/photo-1473494808687-61e41250e296?auto=format&fit=crop&w=800&q=80' }
];

/* ─────────────────────────────────────────────────────────────
   Shared primitives
───────────────────────────────────────────────────────────── */

const Eyebrow: React.FC<{ children: React.ReactNode; light?: boolean }> = ({ children, light }) => (
  <span className={`inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.22em] ${light ? 'text-white/90' : 'text-travion-600'}`}>
    <span className={`h-px w-7 ${light ? 'bg-white/60' : 'bg-travion-300'}`} />
    {children}
  </span>
);

const Reveal: React.FC<{ children: React.ReactNode; delay?: number; y?: number; className?: string }> = ({ children, delay = 0, y = 28, className }) => (
  <motion.div
    initial={{ opacity: 0, y }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-60px' }}
    transition={{ duration: 0.8, delay, ease: EASE }}
    className={className}
  >
    {children}
  </motion.div>
);

const NAV_LINKS = [
  { href: '#discover', label: 'Discover' },
  { href: '#how', label: 'How It Works' },
  { href: '#modes', label: 'Modes' },
  { href: '#guides', label: 'Guides' },
  { href: '#faq', label: 'About' }
];

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=2200&q=80';

/* ─────────────────────────────────────────────────────────────
   Landing page
───────────────────────────────────────────────────────────── */

export const LandingPage: React.FC<LandingPageProps> = ({ onLoginSuccess, onExploreDemo, onOpenGuideRegistration, onOpenGuideSignIn }) => {
  const reduceMotion = useReducedMotion();

  /* Auth modal state */
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authRole, setAuthRole] = useState<'USER' | 'GUIDE'>('USER');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const openAuth = (loginMode: boolean, role: 'USER' | 'GUIDE' = 'USER') => {
    setIsLoginMode(loginMode);
    setAuthRole(role);
    setAuthError(null);
    setShowAuthModal(true);
  };

  const openGuideRegistration = () => {
    // Open auth modal with guide mode already selected for registration
    setIsLoginMode(false);
    setAuthRole('GUIDE');
    setAuthError(null);
    setShowAuthModal(true);
  };

  /* Strong-password helpers */
  const passwordChecks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password)
  };
  const satisfiedCount = Object.values(passwordChecks).filter(Boolean).length;
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  /* Mandatory phone onboarding: exactly 10 digits, Indian mobile (6-9 start) */
  const phoneDigits = phone.replace(/\D/g, '');
  const phoneValid = /^([6-9]\d{9})$/.test(phoneDigits) || /^91[6-9]\d{9}$/.test(phoneDigits);
  const signupValid = !isLoginMode && Object.values(passwordChecks).every(Boolean) && passwordsMatch && phoneValid;
  const strengthIndex = Math.max(0, Math.min(3, satisfiedCount - 1));
  const strengthLabels = ['Too weak', 'Weak', 'Fair', 'Strong'];
  const strengthBar = ['bg-red-400', 'bg-orange-400', 'bg-amber-400', 'bg-emerald-500'];
  const strengthText = ['text-red-500', 'text-orange-500', 'text-amber-500', 'text-emerald-600'];
  const strengthLabel = satisfiedCount === 0 ? 'Too weak' : strengthLabels[strengthIndex];

  /* Secret authorized access — no visible triggers, server-validated */
  const [secretKeyBuffer, setSecretKeyBuffer] = useState('');
  const [showElevateModal, setShowElevateModal] = useState(false);
  const [elevateEmail, setElevateEmail] = useState('');
  const [elevatePassword, setElevatePassword] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [elevateError, setElevateError] = useState<string | null>(null);
  const [elevateShowPass, setElevateShowPass] = useState(false);

  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
      const next = (secretKeyBuffer + e.key).slice(-7).toUpperCase();
      setSecretKeyBuffer(next);
      if (next === 'TRAVION') {
        setSecretKeyBuffer('');
        setTimeout(() => setShowElevateModal(true), 120);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [secretKeyBuffer]);

  const [dotClickCount, setDotClickCount] = useState(0);
  const dotClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDotClick = () => {
    setDotClickCount((c) => {
      const next = c + 1;
      if (next >= 7) {
        setShowElevateModal(true);
        if (dotClickTimer.current) clearTimeout(dotClickTimer.current);
        return 0;
      }
      if (dotClickTimer.current) clearTimeout(dotClickTimer.current);
      dotClickTimer.current = setTimeout(() => setDotClickCount(0), 2000);
      return next;
    });
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!isLoginMode) {
      if (!Object.values(passwordChecks).every(Boolean)) {
        setAuthError('Your password must meet every requirement listed below.');
        return;
      }
      if (!passwordsMatch) {
        setAuthError('Passwords do not match. Please re-type your password.');
        return;
      }
    }
    setIsSubmitting(true);
    try {
      const endpoint = isLoginMode ? '/auth/login' : '/auth/signup';
      const body = isLoginMode
        ? { email, password }
        : { email, password, role: authRole, first_name: firstName, last_name: lastName, phone: phoneDigits };
      const res = await fetch(`${resolveApiBaseUrl()}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(typeof err.detail === 'string' ? err.detail : err.detail?.message || 'Authentication failed');
      }
      const session = await res.json();
      authStorage.save(session, rememberMe);
      onLoginSuccess(session);
    } catch (err: any) {
      setAuthError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleElevateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setElevateError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/auth/elevate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: elevateEmail, password: elevatePassword, access_code: accessCode })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(typeof err.detail === 'string' ? err.detail : 'Authorization denied. Verify your credentials and code.');
      }
      const session = await res.json();
      authStorage.save(session, true);
      onLoginSuccess(session);
    } catch (err: any) {
      setElevateError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  /* Real destination data for the discovery strip */
  const [hubs, setHubs] = useState<LocationItem[]>([]);
  const [hubsLoading, setHubsLoading] = useState(true);
  const [hubsError, setHubsError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getLocations()
      .then((locs) => { if (alive) setHubs(locs); })
      .catch(() => { if (alive) setHubsError('Destination hub list is temporarily unavailable.'); })
      .finally(() => { if (alive) setHubsLoading(false); });
    return () => { alive = false; };
  }, []);

  /* Personalization concept demo */
  const preferenceDims = [
    { key: 'budget', label: 'Budget', icon: <Wallet className="w-4 h-4" />, note: 'Bands from backpacker to premium reshape stays, dining and pacing.' },
    { key: 'pace', label: 'Pace', icon: <Clock className="w-4 h-4" />, note: 'Relaxed mornings or sunrise-to-sunset days become actual stop durations.' },
    { key: 'stay', label: 'Stay', icon: <BedDouble className="w-4 h-4" />, note: 'Homestays, heritage cottages and star-rated resorts are matched to budget.' },
    { key: 'food', label: 'Food', icon: <Utensils className="w-4 h-4" />, note: 'Pure veg, regional specialities and street food filter every dining pick.' },
    { key: 'transport', label: 'Transport', icon: <Train className="w-4 h-4" />, note: 'Train, road or a mix — the routing engine follows your choice.' },
    { key: 'adventure', label: 'Adventure', icon: <Mountain className="w-4 h-4" />, note: 'Adventure level decides treks, trails and thrill activities.' },
    { key: 'interests', label: 'Interests', icon: <HeartHandshake className="w-4 h-4" />, note: 'History, wildlife, food trails — interests curate each day.' }
  ] as const;
  const [activePref, setActivePref] = useState<(typeof preferenceDims)[number]['key']>('budget');
  const activePrefDim = preferenceDims.find((d) => d.key === activePref)!;

  /* Live journey visualization state */
  const [activeStop, setActiveStop] = useState(0);
  const journeyStops = [
    { label: 'Departure', place: 'Your location', sub: 'Live GPS · resolved', icon: <Compass className="w-4 h-4" /> },
    { label: 'Transport', place: 'Nilgiri Express', sub: 'Overnight · reserved seat', icon: <Train className="w-4 h-4" /> },
    { label: 'Stay', place: 'Tea-estate cottage', sub: 'Checked in · Day 1', icon: <BedDouble className="w-4 h-4" /> },
    { label: 'Dining', place: 'Local plantation café', sub: 'Near your stay · 10 min walk', icon: <Utensils className="w-4 h-4" /> },
    { label: 'Attraction', place: 'Tea museum & viewpoints', sub: 'Next stop · 2.1 km', icon: <Landmark className="w-4 h-4" /> },
    { label: 'Destination', place: 'Munnar', sub: 'Trip complete', icon: <MapPin className="w-4 h-4" /> }
  ];
  useEffect(() => {
    if (reduceMotion) return;
    const t = setInterval(() => setActiveStop((s) => (s + 1) % journeyStops.length), 2400);
    return () => clearInterval(t);
  }, [reduceMotion]);

  /* FAQ */
  const faqs: { q: string; a: string }[] = [
    { q: 'What is Travion?', a: 'Travion is an adaptive AI travel orchestration platform. It learns how you travel, plans the complete journey from transport and stays to dining and activities, coordinates verified local guides when you want one, handles only the applicable Travion service payment, then stays with you during the trip with live navigation, trip-scoped AI assistance and dynamic replanning.' },
    { q: 'How does Travion personalize my trip?', a: 'A short adaptive interview captures your budget, pace, stay style, food preference, transport preference, walking tolerance, adventure level, interests and more. Those answers act as real constraints — the planner uses them to select verified transport, stays, dining and activities, and to shape the total estimate. Two travellers with different preferences receive genuinely different plans.' },
    { q: 'What is Guide Mode?', a: 'Guide Mode pairs your planned trip with a verified local guide who knows the destination. The guide is onboarded, assessed on destination knowledge and safety scenarios, then approved by an operations manager before they can take trips. You chat with the guide, meet them on the ground, and pay the guide fee through Travion with a transparent split.' },
    { q: 'What is Adventurous Mode?', a: 'Adventurous Mode removes the guide. You still get the full AI-planned journey — verified itinerary, live map, turn-by-turn navigation, trip AI assistant, dynamic replanning, local discovery and safety information — without any guide fee. Only the applicable platform fee applies.' },
    { q: 'How are guide fees calculated?', a: 'Guide fees are calculated by the backend from trip duration, destination, number of travellers, service level and trip complexity. They are never a single flat amount and never computed on the frontend.' },
    { q: 'What does Travion charge?', a: 'Travion collects the applicable guide fee (Guide Mode) plus a platform fee calculated for your trip. In Adventurous Mode only the platform fee applies. Charges are created and verified server-side, and the payment page shows a complete breakdown before you pay.' },
    { q: 'Does Travion take my entire travel budget?', a: 'No. Your trip budget is an estimate of your overall travel spending — transport, stays, food and activities belong to your journey. Travion only charges the service fees described above, never the travel budget itself.' },
    { q: 'How does the AI remember my trip?', a: 'Every trip has its own isolated memory namespace. The assistant stores your preferences, decisions, visited places and budget state for that trip only — nothing leaks between your trips, and it recalls what you told it earlier in the conversation.' },
    { q: 'Can Travion change my itinerary?', a: 'Yes, with your awareness. You can ask the assistant to adjust a day, or a dynamic replan can be triggered by conditions such as weather. Any change is applied to a new itinerary version, and Travion always shows you why the plan changed.' },
    { q: 'How does guide verification work?', a: 'Guides register with a structured onboarding form — profile, phone, languages, destinations, experience and specializations — then complete a destination knowledge assessment and safety-scenario review. Managers and admins inspect the submission and answers before approving. Unverified guides cannot operate on the platform.' },
    { q: 'What happens if my plans change?', a: 'The replanning engine detects or accepts the change, locks what must stay fixed, re-optimises what is flexible, recalculates within your budget and notifies you with a plain-language explanation. The map and itinerary update to the new version.' },
    { q: 'Can I use Travion offline?', a: 'Before departure you can download your offline trip package — itinerary, coordinates, important contacts, trip notes and AI trip context — and view it without connectivity. Live features that require the internet are clearly marked as such.' }
  ];
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const modeBullets = (guide: boolean) =>
    guide
      ? ['Verified local guide matched to your route', 'On-ground assistance through the whole journey', 'Direct chat with your guide after assignment', 'Local knowledge layered onto your AI plan']
      : ['Full AI-planned journey, no guide fee', 'Live map, navigation and AI assistant included', 'Dynamic replanning whenever conditions change', 'Local discovery and safety information built in'];

  const sampleStops = [
    { icon: <Train className="w-4 h-4" />, text: 'Reserved transport to your destination' },
    { icon: <BedDouble className="w-4 h-4" />, text: 'Verified stay matched to your style' },
    { icon: <Utensils className="w-4 h-4" />, text: 'Dining picked from local cuisine data' },
    { icon: <Mountain className="w-4 h-4" />, text: 'Activities within your adventure level' }
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased overflow-x-hidden">
      {/* ══════════════════ NAVBAR ══════════════════ */}
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
          scrolled || mobileOpen
            ? 'bg-white/95 backdrop-blur-xl border-b border-slate-200/80 shadow-[0_6px_24px_-12px_rgba(15,23,42,0.12)]'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <div className="flex items-center justify-between h-[72px]">
            {/* Brand */}
            <a href="#top" className="flex items-center gap-2.5 group" aria-label="Travion home">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center shadow-soft">
                <Compass className="w-5 h-5 text-white" />
              </span>
              <span className={`text-[17px] font-extrabold tracking-tight ${scrolled || mobileOpen ? 'text-slate-900' : 'text-white'}`}>
                TRAVION
              </span>
            </a>

            {/* Desktop nav */}
            <nav className="hidden lg:flex items-center gap-8" aria-label="Primary">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className={`text-[13px] font-semibold transition-colors ${
                    scrolled ? 'text-slate-600 hover:text-travion-700' : 'text-white/85 hover:text-white'
                  }`}
                >
                  {l.label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-2.5">
              <button
                onClick={() => openAuth(true)}
                className={`hidden sm:inline-flex items-center px-4 h-10 rounded-xl text-[13px] font-bold transition-colors ${
                  scrolled ? 'text-slate-700 hover:text-travion-700' : 'text-white hover:bg-white/10'
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => openGuideRegistration()}
                className={`hidden sm:inline-flex items-center px-4 h-10 rounded-xl text-[13px] font-bold transition-colors ${
                  scrolled ? 'text-slate-700 hover:text-travion-700' : 'text-white hover:bg-white/10'
                }`}
              >
                Become a Guide
              </button>
              <button
                onClick={() => openAuth(false)}
                className="hidden sm:inline-flex items-center gap-1.5 px-4.5 h-10 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-[13px] font-bold shadow-soft transition-all hover:-translate-y-px"
              >
                Plan My Trip
              </button>
              {/* Mobile trigger */}
              <button
                onClick={() => setMobileOpen((o) => !o)}
                aria-label="Toggle menu"
                aria-expanded={mobileOpen}
                className={`lg:hidden inline-flex w-10 h-10 items-center justify-center rounded-xl transition-colors ${
                  scrolled || mobileOpen ? 'text-slate-700 hover:bg-slate-100' : 'text-white hover:bg-white/10'
                }`}
              >
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile drawer */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.nav
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="lg:hidden overflow-hidden bg-white/98 border-t border-slate-100"
              aria-label="Mobile"
            >
              <div className="px-5 py-4 flex flex-col gap-1">
                {NAV_LINKS.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => setMobileOpen(false)}
                    className="px-3 py-3 rounded-xl text-[15px] font-semibold text-slate-700 hover:bg-travion-50 hover:text-travion-700"
                  >
                    {l.label}
                  </a>
                ))}
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button
                    onClick={() => { setMobileOpen(false); openAuth(true); }}
                    className="h-11 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => { setMobileOpen(false); openGuideRegistration(); }}
                    className="h-11 rounded-xl border border-travion-300 text-travion-700 font-bold text-sm hover:bg-travion-50"
                  >
                    Become a Guide
                  </button>
                  <button
                    onClick={() => { setMobileOpen(false); openAuth(false); }}
                    className="h-11 rounded-xl bg-travion-600 text-white font-bold text-sm col-span-2"
                  >
                    Plan My Trip
                  </button>
                </div>
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      {/* ══════════════════ HERO ══════════════════ */}
      <section id="top" className="relative min-h-[100svh] flex flex-col overflow-hidden bg-slate-950">
        {/* Cinematic imagery */}
        <div className="absolute inset-0">
          <motion.div
            initial={{ scale: 1.12, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 2.4, ease: EASE }}
            className="absolute inset-0 bg-cover bg-center will-change-transform"
            style={{ backgroundImage: `url(${HERO_IMAGE})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/55 to-slate-950/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-slate-950/40" />
        </div>

        <div className="relative flex-1 w-full max-w-7xl mx-auto px-5 md:px-8 pt-[120px] pb-16 grid lg:grid-cols-[1.05fr_0.95fr] items-end gap-12">
          {/* Editorial copy */}
          <div>
            <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.25, ease: EASE }}>
              <Eyebrow light>An adaptive AI travel orchestration platform</Eyebrow>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 26 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.4, ease: EASE }}
              className="mt-5 text-white text-[clamp(2.6rem,6.2vw,4.9rem)] font-extrabold leading-[1.02] tracking-[-0.03em]"
            >
              Plan your trip.
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-300 via-travion-200 to-white">Your way.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.6, ease: EASE }}
              className="mt-6 max-w-xl text-white/75 text-base md:text-lg leading-relaxed font-medium"
            >
              Tell Travion where you want to go and how you like to travel. We'll build a
              personalized itinerary around your choices — restaurants, stays, places to explore,
              and a verified guide if you want one.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.75, ease: EASE }}
              className="mt-8 flex flex-wrap items-center gap-3.5"
            >
              <button
                onClick={() => openAuth(false)}
                className="group inline-flex items-center gap-2 h-12 px-6 rounded-2xl bg-travion-500 hover:bg-travion-400 text-white text-sm font-bold shadow-floating transition-all hover:-translate-y-0.5"
              >
                Plan My Trip
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <a
                href="#how"
                className="inline-flex items-center gap-2 h-12 px-6 rounded-2xl border border-white/25 bg-white/5 backdrop-blur text-white text-sm font-bold hover:bg-white/15 transition-all"
              >
                See How Travion Works
              </a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 1 }}
              className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-[12px] font-semibold text-white/60"
            >
              {['Verified grounding data', 'Secure payments', 'Works offline', 'Trip-scoped AI memory'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-sky-300" />
                  {t}
                </span>
              ))}
            </motion.div>
          </div>

          {/* Floating trip planner */}
          <motion.div
            initial={{ opacity: 0, y: 44, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 1, delay: 0.7, ease: EASE }}
            className="w-full max-w-2xl lg:ml-auto"
          >
            <TripSearchBar
              onSearch={() => openAuth(false)}
            />
            <p className="mt-3 text-center text-[11px] font-medium text-white/55">
              Real hubs only — plans are grounded in verified routes and stays. Sign in to plan your trip.
            </p>
          </motion.div>
        </div>

        {/* Scroll cue */}
        <motion.a
          href="#discover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.6 }}
          className="relative mx-auto pb-5 flex flex-col items-center gap-1.5 text-white/55 hover:text-white transition-colors"
          aria-label="Scroll to destinations"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.25em]">Explore</span>
          <ChevronDown className="w-4 h-4" />
        </motion.a>
      </section>

      {/* ══════════════════ DESTINATION DISCOVERY ══════════════════ */}
      <section id="discover" className="relative py-24 md:py-32 bg-sky-50/60">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <Reveal>
              <Eyebrow>Destination discovery</Eyebrow>
              <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
                Where will you go next?
              </h2>
              <p className="mt-4 max-w-lg text-slate-500 font-medium leading-relaxed">
                Tell Travion how you want to travel. It will build the journey around you — from the
                first search to the last stop.
              </p>
            </Reveal>
            <Reveal delay={0.15} className="shrink-0">
              <button
                onClick={() => openAuth(false)}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-2xl bg-white border border-slate-200 text-slate-700 text-sm font-bold shadow-soft hover:border-travion-300 hover:text-travion-700 transition-all"
              >
                Start planning
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </Reveal>
          </div>
        </div>

        <div className="mt-12">
          {hubsLoading ? (
            <div className="max-w-7xl mx-auto px-5 md:px-8 grid grid-cols-2 md:grid-cols-4 gap-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-80 rounded-3xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : hubsError ? (
            <div className="max-w-7xl mx-auto px-5 md:px-8">
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <p className="text-sm font-bold text-slate-600">{hubsError}</p>
                <p className="mt-1.5 text-xs text-slate-400 font-medium">Please try again in a moment.</p>
              </div>
            </div>
          ) : hubs.length === 0 ? (
            <div className="max-w-7xl mx-auto px-5 md:px-8">
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <Globe2 className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-600">Verified hubs are being onboarded</p>
                <p className="mt-1.5 text-xs text-slate-400 font-medium">Plans are published per destination as their data is verified.</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth [scrollbar-width:thin]">
              <div className="flex gap-5 px-5 md:px-[max(2rem,calc((100vw-80rem)/2+2rem))] w-max">
                {hubs.map((hub, i) => (
                  <motion.button
                    key={hub.id}
                    initial={{ opacity: 0, y: 26 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-40px' }}
                    transition={{ duration: 0.7, delay: Math.min(i * 0.06, 0.4), ease: EASE }}
                    onClick={() => openAuth(false)}
                    className="snap-start group relative w-[270px] md:w-[320px] h-[380px] md:h-[430px] rounded-[28px] overflow-hidden text-left shrink-0 bg-slate-200 shadow-soft hover:shadow-floating transition-shadow focus:outline-none focus-visible:ring-4 focus-visible:ring-travion-200"
                    aria-label={`Plan a trip to ${hub.name}`}
                  >
                    {hub.hero_image ? (
                      <img
                        src={hub.hero_image}
                        alt={`${hub.name}, ${hub.state}`}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1.4s] ease-out group-hover:scale-[1.07]"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-travion-100 to-travion-200">
                        <MapPin className="w-10 h-10 text-travion-500/60" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/25 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-5 md:p-6">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2.5 py-1 rounded-full bg-white/15 backdrop-blur text-[10px] font-bold uppercase tracking-wider text-white border border-white/20">
                          {hub.country === 'India' ? 'India' : hub.country}
                        </span>
                        {hub.popular_season && (
                          <span className="px-2.5 py-1 rounded-full bg-travion-500/80 backdrop-blur text-[10px] font-bold text-white">
                            {hub.popular_season}
                          </span>
                        )}
                      </div>
                      <h3 className="text-2xl font-extrabold text-white tracking-tight">{hub.name}</h3>
                      <p className="text-[13px] font-semibold text-white/70 mt-0.5">{hub.state}</p>
                      {hub.description && (
                        <p className="mt-2.5 text-[12px] leading-relaxed text-white/75 line-clamp-2">{hub.description}</p>
                      )}
                      <span className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-sky-200 opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                        Plan this route <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ══════════════════ PERSONALIZATION ══════════════════ */}
      <section id="personalize" className="py-24 md:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <div className="grid lg:grid-cols-[1fr_1.1fr] gap-14 items-center">
            <Reveal>
              <Eyebrow>Personalization</Eyebrow>
              <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
                Your trip should feel like yours.
              </h2>
              <p className="mt-5 text-slate-500 font-medium leading-relaxed max-w-md">
                Budget, pace, stay, food, transport, adventure, interests — every answer is a real
                constraint. The planner uses them to choose verified transport, accommodation and
                experiences for your route.
              </p>
              <div className="mt-8 flex flex-wrap gap-2.5">
                {preferenceDims.map((dim) => {
                  const active = activePref === dim.key;
                  return (
                    <button
                      key={dim.key}
                      onMouseEnter={() => setActivePref(dim.key)}
                      onClick={() => setActivePref(dim.key)}
                      className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl text-[13px] font-bold border transition-all ${
                        active
                          ? 'bg-travion-600 border-travion-600 text-white shadow-soft'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-travion-300 hover:text-travion-700'
                      }`}
                    >
                      {dim.icon}
                      {dim.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 min-h-[70px]">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={activePrefDim.key}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.35 }}
                    className="max-w-md text-sm text-slate-500 font-medium leading-relaxed"
                  >
                    <span className="font-bold text-slate-800">{activePrefDim.label} · </span>
                    {activePrefDim.note}
                  </motion.p>
                </AnimatePresence>
              </div>
            </Reveal>

            {/* Evolving plan preview */}
            <Reveal delay={0.15}>
              <div className="relative">
                <div className="absolute -inset-3 rounded-[32px] bg-gradient-to-br from-travion-100/70 via-sky-50 to-transparent blur-xl" />
                <div className="relative rounded-[28px] border border-slate-200/90 bg-white shadow-soft-lg p-6 md:p-8">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-lg bg-travion-600 text-white flex items-center justify-center">
                        <Compass className="w-4 h-4" />
                      </span>
                      <div>
                        <p className="text-sm font-extrabold text-slate-900">Your journey preview</p>
                        <p className="text-[11px] font-semibold text-slate-400">Day 1 · Your location to Munnar</p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-travion-50 text-travion-700 text-[10px] font-bold uppercase tracking-wider">
                      Concept preview
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {sampleStops.map((stop, i) => {
                      const dimmed = i === 0;
                      return (
                        <motion.div
                          key={i}
                          animate={{
                            backgroundColor: dimmed ? 'rgba(14,165,233,0.07)' : 'rgba(255,255,255,1)',
                            borderColor: dimmed ? 'rgba(2,132,199,0.35)' : 'rgba(226,232,240,1)'
                          }}
                          transition={{ duration: 0.5 }}
                          className="flex items-center gap-3.5 rounded-2xl border px-4 py-3.5"
                        >
                          <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${dimmed ? 'bg-travion-600 text-white' : 'bg-travion-50 text-travion-600'}`}>
                            {stop.icon}
                          </span>
                          <span className="flex-1 text-sm font-bold text-slate-800">{stop.text}</span>
                          <motion.span
                            key={`${activePref}-${i}`}
                            initial={{ opacity: 0, x: 4 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.4, delay: i * 0.05 }}
                            className="text-[11px] font-semibold text-slate-400"
                          >
                            {activePref === 'budget' ? 'within budget' :
                             activePref === 'pace' ? 'your pace' :
                             activePref === 'stay' ? 'your stay style' :
                             activePref === 'food' ? 'your food rules' :
                             activePref === 'transport' ? 'your transport' :
                             activePref === 'adventure' ? 'your adventure level' : 'your interests'}
                          </motion.span>
                        </motion.div>
                      );
                    })}
                  </div>

                  <div className="mt-5 flex items-center justify-between rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                    <span className="text-[12px] font-semibold text-slate-500">Estimated travel spend for this route</span>
                    <span className="text-sm font-extrabold text-slate-900">Calculated at planning</span>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══════════════════ WHAT TRAVION CAN DO ══════════════════ */}
      <section id="features" className="py-24 md:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <Reveal className="text-center max-w-2xl mx-auto">
            <div className="flex justify-center"><Eyebrow>What Travion can do</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
              More than an itinerary generator.
            </h2>
            <p className="mt-4 text-slate-500 font-medium leading-relaxed">
              From AI-powered planning to verified human guides — Travion orchestrates your entire journey.
            </p>
          </Reveal>

          <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: <BrainCircuit className="w-6 h-6" />, title: 'AI Trip Planning', text: 'Travion understands your preferences and builds a personalized journey — not a generic template. Every answer you give becomes a real constraint.' },
              { icon: <Utensils className="w-6 h-6" />, title: 'Smart Food Discovery', text: 'Choose restaurants that fit your preferences, budget, and cuisine interests. Your selections are distributed across your trip days intelligently.' },
              { icon: <BedDouble className="w-6 h-6" />, title: 'Stay Selection', text: 'Choose accommodation that matches your budget. Your selected stay remains constant throughout the trip — no random rotating.' },
              { icon: <Landmark className="w-6 h-6" />, title: 'Real Attractions', text: 'Discover verified tourist places and attractions near your destination. Select the ones you want, and Travion optimizes the route around them.' },
              { icon: <Route className="w-6 h-6" />, title: 'Smart Itineraries', text: 'Travion organizes your selected places, food, and activities day by day — grouping nearby locations and respecting opening hours.' },
              { icon: <Users className="w-6 h-6" />, title: 'Verified Guide Connection', text: 'Get connected with a verified local guide when you want human support. Guides are onboarded, assessed, and manager-approved before they operate.' }
            ].map((item, i) => (
              <Reveal key={item.title} delay={Math.min(i * 0.06, 0.3)}>
                <div className="group h-full rounded-2xl border border-slate-200 bg-slate-50/50 p-6 hover:bg-white hover:border-travion-200 hover:shadow-soft transition-all duration-300">
                  <span className="w-12 h-12 rounded-2xl bg-travion-600 text-white flex items-center justify-center shadow-soft group-hover:bg-travion-700 transition-colors duration-300">
                    {item.icon}
                  </span>
                  <h3 className="mt-4 text-[15px] font-extrabold text-slate-900">{item.title}</h3>
                  <p className="mt-1.5 text-[12.5px] font-medium text-slate-500 leading-relaxed">{item.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════ LIVE TRIP VISUALIZATION ══════════════════ */}
      <section id="live" className="py-24 md:py-32 bg-slate-50/90">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <Reveal className="text-center max-w-2xl mx-auto">
            <div className="flex justify-center"><Eyebrow>Live journey</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
              Planning is only the beginning.
            </h2>
            <p className="mt-4 text-slate-500 font-medium leading-relaxed">
              Once your trip begins, the itinerary becomes a live workspace — route, pins, next stop
              and navigation all in one place, adapting as you move.
            </p>
          </Reveal>

          <Reveal delay={0.15} className="mt-14">
            <div className="relative rounded-[32px] border border-slate-200 bg-white shadow-soft-lg overflow-hidden">
              {/* Window chrome */}
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 bg-white">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
                <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
                <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
                <span className="ml-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
                  <Navigation className="w-3.5 h-3.5 text-travion-500" />
                  Live Trip · Your location → Munnar
                </span>
                <span className="ml-auto px-2.5 py-1 rounded-lg bg-travion-50 text-travion-700 text-[10px] font-bold uppercase tracking-wider">
                  Product preview
                </span>
              </div>

              <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
                {/* Map canvas */}
                <div className="relative h-[360px] md:h-[460px] bg-gradient-to-br from-sky-100/80 via-emerald-50/60 to-slate-100 overflow-hidden">
                  {/* Contour bands */}
                  <div className="absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(14,165,233,0.08), transparent 40%), radial-gradient(circle at 80% 20%, rgba(16,185,129,0.07), transparent 35%), radial-gradient(circle at 60% 85%, rgba(2,132,199,0.06), transparent 45%)' }} />
                  <div className="absolute inset-x-0 top-0 h-px bg-slate-200/70" />

                  <svg viewBox="0 0 760 460" className="absolute inset-0 w-full h-full" aria-hidden="true">
                    <defs>
                      <linearGradient id="routeGrad" x1="0" y1="1" x2="1" y2="0">
                        <stop offset="0%" stopColor="#0284c7" />
                        <stop offset="100%" stopColor="#10b981" />
                      </linearGradient>
                    </defs>
                    {/* Route */}
                    <motion.path
                      d="M 96 350 C 210 344, 238 214, 340 200 S 500 160, 560 118 S 656 84, 686 78"
                      fill="none"
                      stroke="url(#routeGrad)"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      initial={{ pathLength: 0 }}
                      whileInView={{ pathLength: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 2.2, ease: 'easeInOut', delay: 0.3 }}
                    />
                    <motion.path
                      d="M 96 350 C 210 344, 238 214, 340 200 S 500 160, 560 118 S 656 84, 686 78"
                      fill="none"
                      stroke="rgba(2,132,199,0.18)"
                      strokeWidth="10"
                      strokeLinecap="round"
                      initial={{ pathLength: 0 }}
                      whileInView={{ pathLength: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 2.2, ease: 'easeInOut', delay: 0.3 }}
                    />
                  </svg>

                  {/* Traveller marker moving along route */}
                  <motion.div
                    className="absolute z-10"
                    style={{
                      offsetPath: "path('M 96 350 C 210 344, 238 214, 340 200 S 500 160, 560 118 S 656 84, 686 78')",
                      offsetRotate: '0deg'
                    }}
                    animate={{ offsetDistance: reduceMotion ? '100%' : ['6%', '96%'] }}
                    transition={{ duration: 16, repeat: reduceMotion ? 0 : Infinity, ease: 'linear', repeatDelay: 1.2 }}
                  >
                    <span className="relative flex w-7 h-7 items-center justify-center">
                      <span className="absolute inset-0 rounded-full bg-travion-500/30 travion-avatar-pulse" />
                      <span className="relative w-6 h-6 rounded-full bg-gradient-to-br from-travion-500 to-travion-700 border-2 border-white shadow-floating flex items-center justify-center">
                        <Navigation className="w-3 h-3 text-white" />
                      </span>
                    </span>
                  </motion.div>

                  {/* Stop pins */}
                  {journeyStops.map((stop, i) => {
                    const pos = [
                      { left: '7.5%', top: '72%' },
                      { left: '30%', top: '40%' },
                      { left: '46%', top: '37%' },
                      { left: '66%', top: '28%' },
                      { left: '81%', top: '17%' },
                      { left: '91%', top: '13%' }
                    ][i];
                    const active = i === activeStop;
                    return (
                      <div
                        key={stop.label}
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{ left: pos.left, top: pos.top }}
                      >
                        <motion.span
                          animate={{ scale: active ? 1.18 : 1 }}
                          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                          className={`relative flex items-center justify-center rounded-full border-2 shadow-soft transition-colors duration-300 ${
                            i === 0
                              ? 'w-9 h-9 bg-slate-900 border-white text-white'
                              : i === journeyStops.length - 1
                                ? 'w-9 h-9 bg-emerald-500 border-white text-white'
                                : active
                                  ? 'w-9 h-9 bg-travion-600 border-white text-white'
                                  : 'w-8 h-8 bg-white border-travion-200 text-travion-600'
                          }`}
                        >
                          {stop.icon}
                        </motion.span>
                        {active && (
                          <motion.span
                            layoutId="mapPulse"
                            className="absolute inset-0 rounded-full border-2 border-travion-400"
                            animate={{ scale: [1, 1.7], opacity: [0.7, 0] }}
                            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
                          />
                        )}
                        <span className={`absolute left-1/2 -translate-x-1/2 top-full mt-1.5 whitespace-nowrap text-[10px] font-bold ${active ? 'text-travion-700' : 'text-slate-500'} transition-colors`}>
                          {stop.place}
                        </span>
                      </div>
                    );
                  })}

                  {/* Destination chip */}
                  <div className="absolute left-4 top-4 flex items-center gap-2 rounded-xl bg-white/90 backdrop-blur border border-slate-200 px-3 py-2 shadow-soft">
                    <Navigation className="w-3.5 h-3.5 text-travion-600" />
                    <span className="text-[11px] font-bold text-slate-700">
                      {activeStop < journeyStops.length - 1 ? `Next: ${journeyStops[activeStop + 1].place}` : 'You have arrived'}
                    </span>
                  </div>
                </div>

                {/* Itinerary rail */}
                <div className="border-t lg:border-t-0 lg:border-l border-slate-100 bg-white p-6 md:p-8">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-400 mb-5">Today's route</p>
                  <ol className="relative space-y-1">
                    {journeyStops.map((stop, i) => {
                      const active = i === activeStop;
                      const done = i < activeStop;
                      return (
                        <li key={stop.label} className="relative flex gap-4 pb-5 last:pb-0">
                          {i < journeyStops.length - 1 && (
                            <span className={`absolute left-[15px] top-8 bottom-0 w-px ${done || active ? 'bg-travion-200' : 'bg-slate-200'}`} />
                          )}
                          <span
                            className={`relative z-10 w-8 h-8 shrink-0 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                              done
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : active
                                  ? 'bg-travion-600 border-travion-600 text-white shadow-floating'
                                  : 'bg-white border-slate-200 text-slate-400'
                            }`}
                          >
                            {done ? <Check className="w-3.5 h-3.5" /> : stop.icon}
                          </span>
                          <div className="pt-1">
                            <p className={`text-[11px] font-bold uppercase tracking-wider ${active ? 'text-travion-600' : 'text-slate-400'}`}>{stop.label}</p>
                            <p className={`text-sm font-extrabold ${done || active ? 'text-slate-900' : 'text-slate-500'}`}>{stop.place}</p>
                            <p className="text-[11px] font-medium text-slate-400">{stop.sub}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  <button
                    onClick={() => openAuth(false)}
                    className="mt-6 w-full h-11 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold transition-colors"
                  >
                    Experience it live
                  </button>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ GUIDE CTA ══════════════════ */}
      <section id="guides" className="py-24 md:py-32 bg-slate-950 text-white">
        <div className="max-w-4xl mx-auto px-5 md:px-8 text-center">
          <Reveal>
            <Eyebrow light>For Local Guides</Eyebrow>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
              Know Your Destination Better?
            </h2>
            <p className="mt-4 text-xl text-white/80 font-medium max-w-2xl mx-auto">
              Become a TRAVION Guide and help travellers discover the places, food, culture and
experiences you know best.
            </p>
          </Reveal>

          <Reveal delay={0.2} className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => onOpenGuideRegistration()}
              className="group inline-flex items-center gap-2 h-12 px-8 rounded-2xl bg-travion-500 hover:bg-travion-400 text-white text-sm font-bold shadow-floating transition-all hover:-translate-y-0.5"
            >
              Become a Guide
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <button
              onClick={() => onOpenGuideSignIn()}
              className="inline-flex items-center gap-2 h-12 px-8 rounded-2xl border border-white/20 bg-white/5 backdrop-blur text-white text-sm font-bold hover:bg-white/15 transition-all"
            >
              Guide Sign In
            </button>
          </Reveal>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.5 }}
            className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[12px] font-semibold text-white/50"
          >
            {['Verified local guides', 'Fair trip assignments', 'Secure payments', 'Professional support'].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-travion-400" />
                {t}
              </span>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ══════════════════ ADAPTIVE AI ══════════════════ */}
      <section id="adapt" className="py-24 md:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <div className="grid lg:grid-cols-2 gap-14 items-center">
            <Reveal>
              <Eyebrow>Adaptive AI</Eyebrow>
              <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
                When plans change,
                <br />
                Travion changes with them.
              </h2>
              <p className="mt-5 text-slate-500 font-medium leading-relaxed max-w-md">
                Weather, tired legs, a closed viewpoint or a change of heart — Travion detects the
                trigger, finds a verified alternative, recalculates the route and budget, and tells
                you exactly why the plan changed.
              </p>

              <div className="mt-9 space-y-2.5">
                {[
                  { icon: <CloudRain className="w-4 h-4" />, title: 'Trigger detected', text: 'Heavy rain forecast for tomorrow afternoon at your viewpoint stop.' },
                  { icon: <RefreshCw className="w-4 h-4" />, title: 'Verified alternative found', text: 'An indoor cultural experience near your stay, checked for distance and hours.' },
                  { icon: <Route className="w-4 h-4" />, title: 'Route and budget recalculated', text: 'The day reorders around the change while locked bookings stay fixed.' },
                  { icon: <Bell className="w-4 h-4" />, title: 'You are notified with the reason', text: 'A plain-language explanation is logged with the new itinerary version.' }
                ].map((step, i) => (
                  <motion.div
                    key={step.title}
                    initial={{ opacity: 0, x: 20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: i * 0.1, ease: EASE }}
                    className="flex gap-3.5 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3.5"
                  >
                    <span className="w-9 h-9 shrink-0 rounded-xl bg-travion-600 text-white flex items-center justify-center">
                      {step.icon}
                    </span>
                    <div>
                      <p className="text-sm font-extrabold text-slate-900">{step.title}</p>
                      <p className="text-[12px] font-medium text-slate-500 leading-relaxed mt-0.5">{step.text}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </Reveal>

            {/* Replanning notice visual */}
            <Reveal delay={0.15}>
              <div className="relative">
                <div className="absolute -inset-3 rounded-[32px] bg-gradient-to-br from-amber-100/60 via-sky-50 to-transparent blur-xl" />
                <div className="relative space-y-4">
                  <div className="rounded-3xl border border-slate-200 bg-white shadow-soft-lg p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-500">
                          <RefreshCw className="w-5 h-5" />
                        </span>
                        <div>
                          <p className="text-sm font-extrabold text-slate-900">Your itinerary was updated</p>
                          <p className="text-[12px] font-semibold text-slate-400 mt-0.5">Day 2 · just now</p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider">
                        Replanned
                      </span>
                    </div>
                    <p className="mt-4 text-[13px] font-medium text-slate-600 leading-relaxed">
                      Rain is expected near the open-air viewpoint tomorrow afternoon. It was swapped for
                      a tea-tasting and plantation walk at a nearby estate — indoors, short travel time and
                      within your remaining budget.
                    </p>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white shadow-soft-lg overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between px-6 py-4 text-left"
                    >
                      <span className="text-sm font-extrabold text-slate-900">Why did my plan change?</span>
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    </button>
                    <div className="border-t border-slate-100 px-6 py-4 grid grid-cols-3 gap-3">
                      {[
                        { icon: <CloudRain className="w-4 h-4 text-sky-500" />, label: 'Before', value: 'Open-air viewpoint' },
                        { icon: <Mountain className="w-4 h-4 text-emerald-500" />, label: 'After', value: 'Plantation estate' },
                        { icon: <Wallet className="w-4 h-4 text-amber-500" />, label: 'Budget', value: 'Reallocated' }
                      ].map((c) => (
                        <div key={c.label} className="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-center">
                          <span className="inline-flex w-8 h-8 rounded-xl bg-white border border-slate-200 items-center justify-center mb-1.5">
                            {c.icon}
                          </span>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{c.label}</p>
                          <p className="text-[11px] font-extrabold text-slate-800 mt-0.5 leading-snug">{c.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="text-center text-[11px] font-semibold text-slate-400">
                    Concept preview · In your app, replans use your trip's verified data and real budgets.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══════════════════ AI ASSISTANT WITH MEMORY ══════════════════ */}
      <section id="assistant" className="py-24 md:py-32 bg-sky-50/60">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <Reveal className="text-center max-w-2xl mx-auto">
            <div className="flex justify-center"><Eyebrow>Trip assistant</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
              An assistant that remembers your trip.
            </h2>
            <p className="mt-4 text-slate-500 font-medium leading-relaxed">
              Not a generic chatbot. Every trip has isolated memory — preferences, decisions, visited
              places and budget state — used to answer what you ask next.
            </p>
          </Reveal>

          <div className="mt-14 grid lg:grid-cols-[1fr_0.9fr] gap-10 items-center max-w-5xl mx-auto">
            <Reveal>
              <div className="rounded-[28px] border border-slate-200 bg-white shadow-soft-lg overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-100">
                  <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center">
                    <Compass className="w-4 h-4 text-white" />
                  </span>
                  <div>
                    <p className="text-[13px] font-extrabold text-slate-900">Travion assistant</p>
                    <p className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Munnar trip memory active
                    </p>
                  </div>
                  <span className="ml-auto px-2.5 py-1 rounded-lg bg-travion-50 text-travion-700 text-[10px] font-bold uppercase tracking-wider">
                    Product preview
                  </span>
                </div>

                <div className="p-5 space-y-4 bg-slate-50/50">
                  {/* Bubble 1 user */}
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md bg-travion-600 text-white px-4 py-2.5 text-[13px] font-medium leading-relaxed">
                      I don't want crowded places tomorrow.
                    </div>
                  </div>
                  {/* Bubble 1 reply */}
                  <div className="flex justify-start gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-travion-100 flex items-center justify-center shrink-0 mt-1">
                      <Compass className="w-3.5 h-3.5 text-travion-600" />
                    </span>
                    <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-white border border-slate-200 px-4 py-2.5 text-[13px] font-medium text-slate-700 leading-relaxed shadow-soft">
                      Noted. I will keep tomorrow's plan to quieter verified locations and skip the
                      high-traffic viewpoints.
                    </div>
                  </div>

                  {/* Memory chip */}
                  <div className="flex justify-start pl-9">
                    <div className="inline-flex items-center gap-2 rounded-full bg-travion-50 border border-travion-100 px-3 py-1.5">
                      <BrainCircuit className="w-3.5 h-3.5 text-travion-600" />
                      <span className="text-[11px] font-bold text-travion-700">Saved: prefers calm places</span>
                    </div>
                  </div>

                  {/* Bubble 2 user */}
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md bg-travion-600 text-white px-4 py-2.5 text-[13px] font-medium leading-relaxed">
                      Find something for the afternoon.
                    </div>
                  </div>
                  {/* Bubble 2 reply */}
                  <div className="flex justify-start gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-travion-100 flex items-center justify-center shrink-0 mt-1">
                      <Compass className="w-3.5 h-3.5 text-travion-600" />
                    </span>
                    <div className="max-w-[82%] rounded-2xl rounded-bl-md bg-white border border-slate-200 px-4 py-2.5 text-[13px] font-medium text-slate-700 leading-relaxed shadow-soft">
                      Based on your preference for quieter places, your remaining budget and
                      tomorrow's route, the plantation estate walk fits best — low crowd, 20 minutes
                      from your stay. I can add it to Day 3.
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>

            {/* Context rail */}
            <Reveal delay={0.15}>
              <div className="space-y-3.5">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-400">Context it reasons over</p>
                {[
                  { icon: <BrainCircuit className="w-4 h-4" />, title: 'Trip memory', text: 'Your stated preferences and decisions — kept per trip, never mixed with other journeys.' },
                  { icon: <Wallet className="w-4 h-4" />, title: 'Budget state', text: 'What was estimated, spent and reallocated so far on this trip.' },
                  { icon: <Route className="w-4 h-4" />, title: 'Route position', text: 'Where you are, what is next and how far it is.' },
                  { icon: <Layers className="w-4 h-4" />, title: 'Verified facts only', text: 'Stays, dining, attractions and emergency numbers come from the verified database — the assistant never invents them.' }
                ].map((row) => (
                  <div key={row.title} className="flex gap-3.5 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-soft">
                    <span className="w-9 h-9 shrink-0 rounded-xl bg-travion-50 border border-travion-100 text-travion-600 flex items-center justify-center">
                      {row.icon}
                    </span>
                    <div>
                      <p className="text-sm font-extrabold text-slate-900">{row.title}</p>
                      <p className="text-[12px] font-medium text-slate-500 leading-relaxed mt-1">{row.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══════════════════ GUIDE NETWORK ══════════════════ */}
      <section id="guides" className="py-24 md:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <Reveal className="text-center max-w-2xl mx-auto">
            <div className="flex justify-center"><Eyebrow>Guide network</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
              Travel with someone who knows the place.
            </h2>
            <p className="mt-4 text-slate-500 font-medium leading-relaxed">
              Every Travion guide is onboarded, assessed on destination knowledge and safety, then
              approved by an operations manager before they ever take a trip.
            </p>
          </Reveal>

          {/* Workflow */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-5 gap-3 items-stretch">
            {[
              { icon: <Users className="w-4 h-4" />, label: 'Traveller' },
              { icon: <MapPin className="w-4 h-4" />, label: 'Trip request' },
              { icon: <BadgeCheck className="w-4 h-4" />, label: 'Manager review' },
              { icon: <ShieldCheck className="w-4 h-4" />, label: 'Verified guide' },
              { icon: <Navigation className="w-4 h-4" />, label: 'Assigned journey' }
            ].map((node, i) => (
              <React.Fragment key={node.label}>
                <Reveal delay={i * 0.08} className="h-full">
                  <div className="h-full flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-6 text-center hover:border-travion-300 hover:bg-white transition-colors">
                    <span className="w-10 h-10 rounded-2xl bg-white border border-slate-200 text-travion-600 flex items-center justify-center shadow-soft">
                      {node.icon}
                    </span>
                    <span className="text-[12px] font-extrabold text-slate-800 leading-snug">{node.label}</span>
                  </div>
                </Reveal>
                {i < 4 && (
                  <div className="hidden md:flex items-center justify-center text-slate-300">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* What verified means */}
          <div className="mt-10 grid md:grid-cols-3 gap-5">
            {[
              { icon: <BookOpen className="w-4 h-4" />, title: 'Structured onboarding', text: 'Guides register with profile, phone, languages, destinations, experience and specializations.' },
              { icon: <CheckCircle2 className="w-4 h-4" />, title: 'Knowledge assessment', text: 'A destination test and safety-scenario review must be completed before approval.' },
              { icon: <ShieldCheck className="w-4 h-4" />, title: 'Manager approval', text: 'Managers inspect submissions and answers; approvals are written to the audit log.' }
            ].map((c) => (
              <Reveal key={c.title}>
                <div className="rounded-2xl border border-slate-200 p-5 h-full">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="w-9 h-9 rounded-xl bg-travion-50 text-travion-600 flex items-center justify-center border border-travion-100">
                      {c.icon}
                    </span>
                    <h3 className="text-sm font-extrabold text-slate-900">{c.title}</h3>
                  </div>
                  <p className="text-[12.5px] font-medium text-slate-500 leading-relaxed">{c.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════ TWO MODES ══════════════════ */}
      <section id="modes" className="py-24 md:py-32 bg-slate-50/90">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <Reveal className="text-center max-w-2xl mx-auto">
            <div className="flex justify-center"><Eyebrow>Two ways to travel</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
              Choose how you want the journey run.
            </h2>
          </Reveal>

          <div className="mt-14 grid md:grid-cols-2 gap-6">
            {/* Guide mode */}
            <Reveal>
              <div className="group relative rounded-[30px] overflow-hidden shadow-soft-lg hover:shadow-floating transition-shadow h-full bg-slate-900">
                <div className="h-52 relative overflow-hidden">
                  <img
                    src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=1200&q=80"
                    alt="Local guide showing a traveller around a heritage town"
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover opacity-80 transition-transform duration-[1.5s] group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent" />
                </div>
                <div className="p-7 md:p-9 bg-white">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-2xl bg-travion-600 text-white flex items-center justify-center shadow-soft">
                      <Users className="w-5 h-5" />
                    </span>
                    <h3 className="text-2xl font-extrabold tracking-tight text-slate-900">Guide Mode</h3>
                  </div>
                  <p className="mt-2 text-slate-500 font-semibold text-[15px]">Your journey, with a verified local expert.</p>
                  <ul className="mt-6 space-y-3">
                    {modeBullets(true).map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-[13.5px] font-medium text-slate-600">
                        <CheckCircle2 className="w-4 h-4 text-travion-500 shrink-0 mt-0.5" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => openAuth(false)}
                    className="mt-8 w-full h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold transition-colors"
                  >
                    Plan with a guide
                  </button>
                </div>
              </div>
            </Reveal>

            {/* Adventurous mode */}
            <Reveal delay={0.12}>
              <div className="group relative rounded-[30px] overflow-hidden shadow-soft-lg hover:shadow-floating transition-shadow h-full bg-slate-900">
                <div className="h-52 relative overflow-hidden">
                  <img
                    src="https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?auto=format&fit=crop&w=1200&q=80"
                    alt="Traveller on a mountain trail with a backpack"
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover opacity-80 transition-transform duration-[1.5s] group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent" />
                </div>
                <div className="p-7 md:p-9 bg-white">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-soft">
                      <Compass className="w-5 h-5" />
                    </span>
                    <h3 className="text-2xl font-extrabold tracking-tight text-slate-900">Adventurous Mode</h3>
                  </div>
                  <p className="mt-2 text-slate-500 font-semibold text-[15px]">Your journey, your way.</p>
                  <ul className="mt-6 space-y-3">
                    {modeBullets(false).map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-[13.5px] font-medium text-slate-600">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => openAuth(false)}
                    className="mt-8 w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors"
                  >
                    Plan on your own
                  </button>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══════════════════ PREFERENCE-FIRST PLANNING ══════════════════ */}
      <section id="preferences" className="py-24 md:py-32 bg-slate-50/90">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <Reveal className="text-center max-w-2xl mx-auto">
            <div className="flex justify-center"><Eyebrow>Preference-first planning</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
              You choose what matters.
            </h2>
            <p className="mt-4 text-slate-500 font-medium leading-relaxed">
              Travion plans around your actual choices — not a generic template.
            </p>
          </Reveal>

          <div className="mt-14 relative">
            <div className="absolute left-[27px] top-2 bottom-2 w-px bg-gradient-to-b from-travion-200 via-slate-200 to-slate-100" />
            {[
              { t: 'Your destination', d: 'Where you want to go — real hubs with verified routes and stays.' },
              { t: 'Your preferences', d: 'Budget, pace, stay style, food rules, transport and adventure level.' },
              { t: 'Real places', d: 'Verified restaurants, hotels and attractions near your destination.' },
              { t: 'Your selections', d: 'Choose the restaurants, stay and places you actually want to experience.' },
              { t: 'AI optimization', d: 'Travion builds a day-wise journey around your picks — grouped by location, open hours, budget, and trip flow.' },
              { t: 'Your trip', d: 'A plan that feels like yours — because you picked the pieces.' }
            ].map((step, i) => (
              <Reveal key={i} delay={i * 0.04}>
                <div className="relative flex gap-6 pb-10 last:pb-0">
                  <div className="relative z-10 w-14 h-14 shrink-0 rounded-2xl bg-white border border-slate-200 shadow-soft flex items-center justify-center">
                    <span className="text-[11px] font-black text-travion-600 tracking-wide">{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <div className="pt-1.5">
                    <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">{step.t}</h3>
                    <p className="mt-1.5 text-[13.5px] font-medium text-slate-500 leading-relaxed max-w-md">{step.d}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Visual flow example */}
          <Reveal delay={0.15}>
            <div className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 md:p-8 shadow-soft">
              <h3 className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-400 mb-6">Example: a 3-day trip where you chose the pieces</h3>
              <div className="grid md:grid-cols-3 gap-4">
                {[
                  { day: 'Day 1', items: ['📍 Explore: Place A', '🍽 Lunch: Restaurant A', '🌆 Evening: Nearby activity', '🏨 Stay: Hotel A'] },
                  { day: 'Day 2', items: ['📍 Explore: Place C', '📍 Morning: Nearby attraction', '🍽 Lunch: Restaurant B', '🌆 Evening: Experience'] },
                  { day: 'Day 3', items: ['📍 Explore: Place D', '🍽 Lunch: Restaurant C', '🌆 Evening: Free exploration', '🏨 Stay: Hotel A'] }
                ].map((day) => (
                  <div key={day.day} className="rounded-xl border border-slate-100 bg-slate-50 p-5">
                    <p className="text-sm font-extrabold text-slate-900 mb-3">{day.day}</p>
                    <ul className="space-y-2">
                      {day.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-[13px] font-medium text-slate-700">
                          <span className="text-travion-500">{item.split(':')[0]}</span>
                          <span className="text-slate-500">: {item.split(':').slice(1).join(':')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-center text-xs font-medium text-slate-400">
                Hotel A stays constant. Restaurants A, B, C are distributed across days. Places are grouped geographically. This is the experience Travion builds around your selections.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ HOW TRAVION WORKS ══════════════════ */}
      <section id="how" className="py-24 md:py-32 bg-white">
        <div className="max-w-3xl mx-auto px-5 md:px-8">
          <Reveal className="text-center">
            <div className="flex justify-center"><Eyebrow>How it works</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
              From preference to journey.
            </h2>
          </Reveal>

          <div className="mt-16 relative">
            <div className="absolute left-[27px] top-2 bottom-2 w-px bg-gradient-to-b from-travion-200 via-slate-200 to-slate-100" />
            {[
              { n: '01', t: 'Plan', d: 'Choose source, destination and dates — any real place, anywhere in the world.' },
              { n: '02', t: 'Reach', d: 'Verified transport, stays, dining and activities are assembled day by day within your budget, so you know how to get there and what to expect.' },
              { n: '03', t: 'Navigate', d: 'A live trip map with real GPS, turn-by-turn guidance and every stop pinned professionally on the route.' },
              { n: '04', t: 'Communicate', d: 'A trip-scoped AI assistant that understands your journey, remembers your conversation and helps you speak the local language.' },
              { n: '05', t: 'Discover', d: 'Local food, hidden gems and lesser-known experiences matched to your interests, budget and the time you have.' },
              { n: '06', t: 'Adapt', d: 'Weather, delays and plan changes trigger dynamic replanning with a clear explanation — plus a full offline package when connectivity drops.' },
              { n: '07', t: 'Return', d: 'Safety contacts, emergency support and your guide at your side until the journey is complete and settled.' }
            ].map((step, i) => (
              <Reveal key={step.n} delay={i * 0.04}>
                <div className="relative flex gap-6 pb-10 last:pb-0">
                  <div className="relative z-10 w-14 h-14 shrink-0 rounded-2xl bg-white border border-slate-200 shadow-soft flex items-center justify-center">
                    <span className="text-[11px] font-black text-travion-600 tracking-wide">{step.n}</span>
                  </div>
                  <div className="pt-1.5">
                    <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">{step.t}</h3>
                    <p className="mt-1.5 text-[13.5px] font-medium text-slate-500 leading-relaxed max-w-md">{step.d}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════ BUDGET TRANSPARENCY ══════════════════ */}
      <section id="fees" className="py-24 md:py-32 bg-sky-50/60">
        <div className="max-w-7xl mx-auto px-5 md:px-8 grid lg:grid-cols-2 gap-14 items-center">
          <Reveal>
            <Eyebrow>Transparent pricing</Eyebrow>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
              Your travel budget stays yours.
            </h2>
            <p className="mt-5 text-slate-500 font-medium leading-relaxed max-w-md">
              The budget you set is an estimate of your overall travel spending. Travion collects only
              the applicable platform and guide service fees — never the travel budget itself.
            </p>
            <div className="mt-8 flex items-start gap-3.5 rounded-2xl border border-travion-100 bg-white p-5 shadow-soft">
              <span className="w-10 h-10 shrink-0 rounded-xl bg-travion-600 text-white flex items-center justify-center">
                <IndianRupee className="w-5 h-5" />
              </span>
              <p className="text-[13.5px] font-semibold text-slate-700 leading-relaxed">
                In the app, every figure on this page is calculated server-side from your trip's
                verified data — duration, destination, travellers and service level.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="relative rounded-[28px] border border-slate-200 bg-white shadow-soft-lg overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <p className="text-sm font-extrabold text-slate-900">Payment breakdown</p>
                <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider">
                  Sample only
                </span>
              </div>
              <div className="p-6 space-y-5">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Estimated trip budget</p>
                    <p className="text-2xl font-extrabold text-slate-900 mt-1">Rs 50,000</p>
                  </div>
                  <Wallet className="w-6 h-6 text-slate-300" />
                </div>

                <div className="space-y-2.5 rounded-2xl bg-slate-50 border border-slate-100 p-4">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Estimated travel expenses — yours to spend</p>
                  {[
                    { label: 'Transport', value: 'Rs 15,000' },
                    { label: 'Stay', value: 'Rs 15,000' },
                    { label: 'Food', value: 'Rs 7,000' },
                    { label: 'Activities', value: 'Rs 5,000' }
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between text-[13px]">
                      <span className="font-semibold text-slate-600">{row.label}</span>
                      <span className="font-bold text-slate-800">{row.value}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-slate-50 border border-slate-100 p-4">
                  <span className="text-[13px] font-bold text-slate-600">Estimated travel spend</span>
                  <span className="text-[15px] font-extrabold text-slate-900">Rs 42,000</span>
                </div>

                <div className="space-y-2.5 rounded-2xl bg-travion-50/70 border border-travion-100 p-4">
                  <p className="text-[10px] font-black uppercase tracking-wider text-travion-500">Travion services — fees for orchestration</p>
                  {[
                    { label: 'Guide fee', value: 'Rs 4,000', icon: <Users className="w-3.5 h-3.5" /> },
                    { label: 'Platform fee', value: 'Rs 1,500', icon: <Compass className="w-3.5 h-3.5" /> }
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between text-[13px]">
                      <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                        {row.icon}
                        {row.label}
                      </span>
                      <span className="font-bold text-slate-800">{row.value}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-slate-900 px-5 py-4">
                  <span className="text-[13px] font-bold text-slate-200">Amount payable to Travion</span>
                  <span className="text-lg font-extrabold text-white">Rs 5,500</span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ TRUST ══════════════════ */}
      <section id="trust" className="py-24 md:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <Reveal className="text-center max-w-2xl mx-auto">
            <div className="flex justify-center"><Eyebrow>Built to be trusted</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
              Built for travellers who want more than an itinerary.
            </h2>
          </Reveal>

          <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: <ShieldCheck className="w-5 h-5" />, title: 'Verified guides', text: 'Onboarded, assessed and manager-approved before they can operate.' },
              { icon: <Lock className="w-5 h-5" />, title: 'Secure payments', text: 'Fees recomputed server-side; every Razorpay payment signature is verified.' },
              { icon: <Layers className="w-5 h-5" />, title: 'Real travel data', text: 'Schedules, stays, dining and emergency contacts come from verified sources — never invented.' },
              { icon: <BrainCircuit className="w-5 h-5" />, title: 'Trip-specific AI memory', text: 'The assistant remembers your trip and only your trip, with isolated memory per journey.' },
              { icon: <Wallet className="w-5 h-5" />, title: 'Transparent pricing', text: 'A full breakdown before payment — your travel budget is never charged as a service fee.' },
              { icon: <Navigation className="w-5 h-5" />, title: 'Live journey support', text: 'Map, navigation, replanning and offline packages stay with you until you are home.' }
            ].map((item, i) => (
              <Reveal key={item.title} delay={Math.min(i * 0.06, 0.3)}>
                <div className="group h-full rounded-2xl border border-slate-200 bg-slate-50/50 p-6 hover:bg-white hover:border-travion-200 hover:shadow-soft transition-all duration-300">
                  <span className="w-11 h-11 rounded-2xl bg-white border border-slate-200 text-travion-600 flex items-center justify-center shadow-soft group-hover:bg-travion-600 group-hover:text-white group-hover:border-travion-600 transition-colors duration-300">
                    {item.icon}
                  </span>
                  <h3 className="mt-4 text-[15px] font-extrabold text-slate-900">{item.title}</h3>
                  <p className="mt-1.5 text-[12.5px] font-medium text-slate-500 leading-relaxed">{item.text}</p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Honest social proof */}
          <Reveal delay={0.1}>
            <div className="mt-12 rounded-3xl border border-slate-200 bg-gradient-to-r from-travion-50 via-white to-emerald-50/50 px-7 py-8 md:px-10">
              <div className="grid md:grid-cols-3 gap-8">
                {[
                  { title: 'No placeholders', text: 'Every schedule, stay, dish and emergency contact shown on a plan is verified before it appears.' },
                  { title: 'No fake guides', text: 'Only onboarded, manager-approved local experts are ever matched to a trip.' },
                  { title: 'No generic chat', text: 'The assistant reasons over your trip data and memory — or says the data is still being added.' }
                ].map((c) => (
                  <div key={c.title}>
                    <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                      <BadgeCheck className="w-4 h-4 text-travion-600" />
                      {c.title}
                    </h3>
                    <p className="mt-2 text-[12.5px] font-medium text-slate-500 leading-relaxed">{c.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ DESTINATION STORY ══════════════════ */}
      <section className="relative py-28 md:py-40 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2200&q=80"
          alt="Wide coastline at golden hour"
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-slate-950/55" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/70 via-slate-950/30 to-slate-950/60" />
        <div className="relative max-w-7xl mx-auto px-5 md:px-8">
          <Reveal>
            <div className="max-w-2xl">
              <Eyebrow light>Beyond the itinerary</Eyebrow>
              <h2 className="mt-5 text-white text-4xl md:text-6xl font-extrabold tracking-[-0.02em] leading-[1.05]">
                Go beyond the itinerary.
              </h2>
              <p className="mt-5 text-white/80 text-base md:text-lg font-medium leading-relaxed max-w-lg">
                Discover places, experiences and local recommendations that fit the way you travel —
                surfaced from verified local data, not guesswork.
              </p>
              <button
                onClick={() => { document.getElementById('discover')?.scrollIntoView({ behavior: 'smooth' }); }}
                className="mt-8 inline-flex items-center gap-2 h-12 px-6 rounded-2xl bg-white text-slate-900 text-sm font-bold hover:bg-travion-50 transition-colors"
              >
                Explore destinations
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ FAQ ══════════════════ */}
      <section id="faq" className="py-24 md:py-32 bg-slate-50/80">
        <div className="max-w-3xl mx-auto px-5 md:px-8">
          <Reveal className="text-center">
            <div className="flex justify-center"><Eyebrow>Questions</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
              Everything about Travion.
            </h2>
          </Reveal>

          <div className="mt-12 space-y-3">
            {faqs.map((f, i) => {
              const open = openFaq === i;
              return (
                <Reveal key={f.q} delay={Math.min(i * 0.03, 0.2)}>
                  <div className={`rounded-2xl border bg-white transition-all duration-300 ${open ? 'border-travion-200 shadow-soft' : 'border-slate-200'}`}>
                    <button
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-4 px-5 py-4.5 text-left"
                    >
                      <span className="text-[14.5px] font-extrabold text-slate-900 leading-snug">{f.q}</span>
                      <motion.span
                        animate={{ rotate: open ? 45 : 0 }}
                        transition={{ duration: 0.3 }}
                        className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center ${open ? 'bg-travion-600 text-white' : 'bg-slate-100 text-slate-500'}`}
                      >
                        <PlusIcon />
                      </motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.4, ease: EASE }}
                          className="overflow-hidden"
                        >
                          <p className="px-5 pb-5 text-[13.5px] font-medium text-slate-600 leading-relaxed">{f.a}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ══════════════════ FINAL CTA ══════════════════ */}
      <section className="relative py-32 md:py-44 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=2200&q=80"
          alt="Sunlit mountain valley road at dawn"
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-slate-950/65" />
        <div className="relative max-w-4xl mx-auto px-5 md:px-8 text-center">
          <Reveal>
            <Eyebrow light>Begin</Eyebrow>
            <h2 className="mt-5 text-white text-4xl md:text-6xl font-extrabold tracking-[-0.02em] leading-[1.05]">
              Your next journey starts here.
            </h2>
            <p className="mt-5 text-white/80 text-base md:text-lg font-medium max-w-xl mx-auto leading-relaxed">
              Tell Travion where you are going. We will help orchestrate the journey around you.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3.5">
              <button
                onClick={() => openAuth(false)}
                className="inline-flex items-center gap-2 h-13 px-7 rounded-2xl bg-travion-500 hover:bg-travion-400 text-white text-[15px] font-bold shadow-floating transition-all hover:-translate-y-0.5"
              >
                Plan My Trip
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={onExploreDemo}
                className="inline-flex items-center gap-2 h-13 px-7 rounded-2xl border border-white/30 bg-white/5 backdrop-blur text-white text-[15px] font-bold hover:bg-white/15 transition-all"
              >
                Try the demo preview
              </button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ FOOTER ══════════════════ */}
      <footer className="bg-white border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-5 md:px-8 py-16">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-10">
            <div className="col-span-2">
              <a href="#top" className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center">
                  <Compass className="w-4 h-4 text-white" />
                </span>
                <span className="text-[15px] font-extrabold tracking-tight text-slate-900">TRAVION</span>
              </a>
              <p className="mt-4 text-[12.5px] font-medium text-slate-500 leading-relaxed max-w-xs">
                An adaptive AI travel orchestration platform. Plan, coordinate, navigate and adapt
                every part of your journey.
              </p>
            </div>
            {[
              { h: 'Product', links: ['How it works', 'Modes', 'Destinations', 'Pricing'] },
              { h: 'Travel', links: ['Verified hubs', 'Live trip map', 'Offline mode', 'Trip assistant'] },
              { h: 'Guides', links: ['Guide network', 'Verification', 'Guide Mode'] },
              { h: 'Company', links: ['About', 'Contact', 'Help'] }
            ].map((col) => (
              <div key={col.h}>
                <h4 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-4">{col.h}</h4>
                <ul className="space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l}>
                      <a href={l === 'Pricing' ? '#fees' : l === 'Modes' ? '#modes' : l === 'Destinations' ? '#discover' : l === 'Verified hubs' ? '#discover' : l === 'Live trip map' ? '#live' : l === 'Offline mode' ? '#live' : l === 'Trip assistant' ? '#assistant' : l === 'Guide network' || l === 'Verification' || l === 'Guide Mode' ? '#guides' : '#top'} className="text-[12.5px] font-semibold text-slate-500 hover:text-travion-700 transition-colors">
                        {l}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-14 pt-7 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4 text-[11.5px] font-semibold text-slate-400">
              <a href="#top" className="hover:text-slate-600 transition-colors">Privacy</a>
              <span className="w-px h-3 bg-slate-200" />
              <a href="#top" className="hover:text-slate-600 transition-colors">Terms</a>
              <span className="w-px h-3 bg-slate-200" />
              <a href="#top" className="hover:text-slate-600 transition-colors">Contact</a>
            </div>
            <p className="text-[11.5px] font-semibold text-slate-400">© 2026 Travion Inc. Software-only platform.</p>
            {/* Hidden dot — 7 clicks opens the authorized gateway; no hints in UI */}
            <div
              onClick={handleDotClick}
              role="presentation"
              className="w-2 h-2 rounded-full bg-slate-200 cursor-default select-none"
              style={{ opacity: dotClickCount > 0 ? 0.8 : 0.4 }}
              aria-hidden="true"
            />
          </div>
        </div>
      </footer>

      {/* ══════════════════ AUTH MODAL ══════════════════ */}
      <AnimatePresence>
        {showAuthModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto"
            onClick={(e) => e.target === e.currentTarget && setShowAuthModal(false)}
          >
            <div className="fixed inset-0 bg-slate-950/55 backdrop-blur-md" />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.45, ease: EASE }}
              className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-white rounded-[28px] shadow-2xl md:grid md:grid-cols-[0.9fr_1.1fr]"
            >
              {/* Brand panel */}
              <div className="hidden md:flex flex-col justify-between relative overflow-hidden rounded-l-[28px] p-9 bg-slate-950">
                <img
                  src={HERO_IMAGE}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover opacity-40"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-travion-900/80 via-slate-950/60 to-slate-950/80" />
                <div className="relative z-10 flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-travion-400 to-travion-600 flex items-center justify-center">
                    <Compass className="w-5 h-5 text-white" />
                  </span>
                  <span className="text-lg font-extrabold tracking-tight text-white">TRAVION</span>
                </div>
                <div className="relative z-10">
                  <h4 className="text-[26px] font-extrabold leading-snug text-white tracking-tight">
                    {isLoginMode ? 'Welcome back to your journeys.' : 'One platform for the whole journey.'}
                  </h4>
                  <ul className="mt-6 space-y-3">
                    {[
                      { icon: <CheckCircle2 className="w-4 h-4" />, text: 'Plans grounded in verified travel data' },
                      { icon: <CheckCircle2 className="w-4 h-4" />, text: 'Live map, navigation and offline packages' },
                      { icon: <CheckCircle2 className="w-4 h-4" />, text: 'Trip-scoped AI assistant with memory' }
                    ].map((line) => (
                      <li key={line.text} className="flex items-start gap-2.5 text-[12px] font-semibold text-white/85">
                        <span className="text-travion-300 mt-0.5">{line.icon}</span>
                        {line.text}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="relative z-10 text-[10px] font-bold uppercase tracking-widest text-white/40">
                  Razorpay-secured payments
                </p>
              </div>

              {/* Form panel */}
              <div className="p-6 md:p-9">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                      {isLoginMode ? 'Sign in' : 'Create your account'}
                    </h3>
                    <p className="text-[12.5px] font-medium text-slate-500 mt-1">
                      {isLoginMode ? 'Pick up where you left off.' : 'Start orchestrating your next journey.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAuthModal(false)}
                    aria-label="Close"
                    className="p-2 -m-1 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Role cards (signup) */}
                {!isLoginMode && (
                  <div className="grid grid-cols-2 gap-2.5 mt-6">
                    {([
                      { role: 'USER' as const, icon: <Compass className="w-4 h-4" />, title: 'Traveller', desc: 'Plan and explore trips' },
                      { role: 'GUIDE' as const, icon: <Users className="w-4 h-4" />, title: 'Local guide', desc: 'Host verified journeys' }
                    ]).map((opt) => {
                      const active = authRole === opt.role;
                      return (
                        <button
                          key={opt.role}
                          type="button"
                          onClick={() => setAuthRole(opt.role)}
                          className={`p-3.5 rounded-2xl border text-left transition-all ${
                            active
                              ? 'bg-travion-50 border-travion-300 ring-2 ring-travion-100'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <span className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 ${active ? 'bg-travion-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                            {opt.icon}
                          </span>
                          <p className={`text-[13px] font-extrabold ${active ? 'text-travion-700' : 'text-slate-800'}`}>{opt.title}</p>
                          <p className="text-[11px] font-medium text-slate-400 mt-0.5">{opt.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                )}

                <AnimatePresence>
                  {authError && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5 text-red-600 text-[12px] font-bold">
                        <AlertIcon />
                        {authError}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleAuthSubmit} className="mt-5 space-y-4">
                  {!isLoginMode && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="First name">
                        <input type="text" required placeholder="Aarav" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} />
                      </Field>
                      <Field label="Last name">                        <input type="text" required placeholder="Sharma" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
                      </Field>
                    </div>
                  )}

                  <Field label="Email address">
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} pl-10`} />
                    </div>
                  </Field>

                  <Field label={isLoginMode ? 'Password' : 'Create a strong password'}>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required placeholder="8+ characters with a capital and a number"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${inputCls} pl-10 pr-11`}
                      />
                      <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label="Toggle password visibility" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </Field>

                  {!isLoginMode && (
                    <>
                      {/* Strength meter */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-400">Password strength</span>
                          <span className={`text-[11px] font-extrabold ${strengthText[strengthIndex]}`}>{strengthLabel}</span>
                        </div>
                        <div className="flex gap-1.5">
                          {[0, 1, 2, 3].map((i) => (
                            <motion.div
                              key={i}
                              animate={{ backgroundColor: i < satisfiedCount ? strengthBar[strengthIndex] : 'rgba(226,232,240,1)' }}
                              className="h-1.5 flex-1 rounded-full"
                            />
                          ))}
                        </div>
                        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                          {([
                            { k: 'length', label: '8+ characters' },
                            { k: 'upper', label: '1 uppercase letter' },
                            { k: 'lower', label: '1 lowercase letter' },
                            { k: 'number', label: '1 number' }
                          ] as const).map((r) => {
                            const ok = passwordChecks[r.k];
                            return (
                              <span key={r.k} className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10.5px] font-bold border ${ok ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                                {ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3 opacity-60" />}
                                {r.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Confirm password */}
                      <Field label="Confirm password">
                        <div className="relative">
                          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                          <input
                            type={showConfirmPassword ? 'text' : 'password'}
                            required placeholder="Re-type your password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className={`${inputCls} pl-10 pr-11 ${
                              confirmPassword.length === 0
                                ? ''
                                : passwordsMatch
                                  ? 'border-emerald-300 ring-2 ring-emerald-50'
                                  : 'border-red-300 ring-2 ring-red-50'
                            }`}
                          />
                          <button type="button" onClick={() => setShowConfirmPassword((s) => !s)} aria-label="Toggle confirm password visibility" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                            {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        {confirmPassword.length > 0 && !passwordsMatch && (
                          <p className="mt-1.5 text-[11px] font-bold text-red-500 flex items-center gap-1">
                            <AlertIcon />
                            Passwords do not match
                          </p>
                        )}
                      </Field>

                      {/* Mandatory phone onboarding — masked for other users, never shown publicly */}
                      <Field label="Phone number">
                        <div className="relative">
                          <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                          <input
                            type="tel"
                            required
                            inputMode="numeric"
                            placeholder="10-digit mobile number"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value.replace(/[^+\d]/g, '').slice(0, 13))}
                            className={`${inputCls} pl-10 ${
                              phoneDigits.length === 0
                                ? ''
                                : phoneValid
                                  ? 'border-emerald-300 ring-2 ring-emerald-50'
                                  : 'border-red-300 ring-2 ring-red-50'
                            }`}
                          />
                        </div>
                        {phoneDigits.length > 0 && !phoneValid && (
                          <p className="mt-1.5 text-[11px] font-bold text-red-500 flex items-center gap-1">
                            <AlertIcon />
                            Enter a valid 10-digit Indian mobile number
                          </p>
                        )}
                        <p className="mt-1.5 text-[10.5px] font-semibold text-slate-400">
                          Needed for guide coordination and emergencies. Always shown masked (+91 83095****) — never publicly.
                        </p>
                      </Field>
                    </>
                  )}

                  {/* Remember me */}
                  <button type="button" onClick={() => setRememberMe((r) => !r)} className="flex items-center gap-2.5 select-none group w-fit">
                    <span className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center transition-all ${rememberMe ? 'bg-travion-600 border-travion-600' : 'bg-white border-slate-300 group-hover:border-slate-400'}`}>
                      {rememberMe && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="text-[12px] font-bold text-slate-600 group-hover:text-slate-800">
                      Remember me
                      <span className="font-medium text-slate-400"> · stay signed in on this device</span>
                    </span>
                  </button>

                  <motion.button
                    type="submit"
                    disabled={isSubmitting || (!isLoginMode && !signupValid)}
                    whileTap={{ scale: 0.99 }}
                    className="w-full h-12 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-extrabold shadow-soft transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    {isSubmitting
                      ? 'Processing...'
                      : isLoginMode
                        ? 'Sign in'
                        : authRole === 'GUIDE'
                          ? 'Create guide account'
                          : 'Create traveller account'}
                  </motion.button>
                </form>

                <p className="mt-5 text-center text-[12.5px] font-semibold text-slate-500">
                  {isLoginMode ? (
                    <>New to Travion?{' '}
                      <button onClick={() => { setIsLoginMode(false); setAuthError(null); }} className="font-extrabold text-travion-600 hover:text-travion-700">Create an account</button>
                    </>
                  ) : (
                    <>Already have an account?{' '}
                      <button onClick={() => { setIsLoginMode(true); setAuthError(null); }} className="font-extrabold text-travion-600 hover:text-travion-700">Sign in</button>
                    </>
                  )}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════════════════ SECRET AUTHORIZED ACCESS MODAL ══════════════════ */}
      <AnimatePresence>
        {showElevateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setShowElevateModal(false)}
          >
            <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-lg" />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-7 shadow-2xl border border-slate-200"
            >
              <div className="flex items-center gap-3 mb-6">
                <span className="w-10 h-10 rounded-2xl bg-slate-900 text-slate-300 flex items-center justify-center">
                  <Key className="w-4.5 h-4.5" />
                </span>
                <div>
                  <h3 className="text-[15px] font-extrabold text-slate-900">Authorized operations</h3>
                  <p className="text-[11px] font-semibold text-slate-400">Restricted gateway · audited</p>
                </div>
                <button onClick={() => setShowElevateModal(false)} aria-label="Close" className="ml-auto p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <AnimatePresence>
                {elevateError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5 text-red-600 text-[12px] font-bold">
                      <AlertIcon />
                      {elevateError}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleElevateSubmit} className="space-y-3">
                <Field label="Official email">
                  <input type="email" required placeholder="name@travion.in" value={elevateEmail} onChange={(e) => setElevateEmail(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Password">
                  <div className="relative">
                    <input type={elevateShowPass ? 'text' : 'password'} required placeholder="Password" value={elevatePassword} onChange={(e) => setElevatePassword(e.target.value)} className={`${inputCls} pr-11`} />
                    <button type="button" onClick={() => setElevateShowPass((s) => !s)} aria-label="Toggle password visibility" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {elevateShowPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </Field>
                <Field label="Authorization code">
                  <input type="password" required placeholder="Enter code" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} className={`${inputCls} font-mono tracking-[0.2em]`} />
                </Field>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold transition-colors disabled:opacity-45"
                >
                  {isSubmitting ? 'Verifying...' : 'Authenticate'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ── Small shared bits ────────────────────────────────────── */

const inputCls =
  'w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-[13.5px] font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-travion-400 focus:ring-2 focus:ring-travion-100 transition-all';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="block text-[10.5px] font-black uppercase tracking-wider text-slate-400 mb-1.5">{label}</span>
    {children}
  </label>
);

const PlusIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M12 5v14" />
  </svg>
);

const AlertIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);
