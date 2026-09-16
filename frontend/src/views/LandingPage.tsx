import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion, useInView, useScroll, useTransform } from 'framer-motion';
import {
  ArrowRight, ArrowUpRight, BadgeCheck, BedDouble, BookOpen, BrainCircuit,
  Check, CheckCircle2, ChevronDown, Clock, Compass,
  Eye, EyeOff, Globe2, HeartHandshake, IndianRupee, Key, Landmark,
  Lock, Mail, MapPin, Menu, Mountain, Navigation, Phone,
  RefreshCw, Route, ShieldCheck, Sparkles, Users, Utensils,
  Wallet, X, MessagesSquare
} from 'lucide-react';
import { LocationItem } from '../types';
import { api, authStorage, resolveApiBaseUrl } from '../services/api';
import { TripSearchBar } from '../components/search-bar/TripSearchBar';
import { TravionLogo, TravionButton } from '../components/ui';

interface LandingPageProps {
  onLoginSuccess: (session: any) => void;
  onExploreDemo: () => void;
  onOpenGuideRegistration: () => void;
  onOpenGuideSignIn: () => void;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/* ─── Hero extras: count-up ─── */
const CountUp: React.FC<{ to: number; suffix?: string; duration?: number }> = ({ to, suffix = '', duration = 1600 }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) { setVal(to); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setVal(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration, reduce]);
  return <span ref={ref}>{val.toLocaleString('en-IN')}{suffix}</span>;
};

const MARQUEE_ITEMS = [
  'Verified real places only', 'Live destination maps', 'Drag & drop itinerary',
  '12.5% guide fee — shown upfront', '3% platform fee — no surprises',
  'Voice navigation', 'Trip AI with memory', 'Offline trip packages',
  'Manager-verified guides', 'Razorpay secure payments',
] as const;

const MarqueeRibbon: React.FC = () => {
  const reduce = useReducedMotion();
  const row = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];
  return (
    <div className="relative overflow-hidden border-y border-travion-900/10 bg-travion-900">
      <div
        className="flex w-max items-center gap-10 py-3.5"
        style={reduce ? undefined : { animation: 'travion-marquee 38s linear infinite' }}
      >
        {row.map((item, i) => (
          <span key={`${item}-${i}`} className="inline-flex items-center gap-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-200/80">
            <Sparkles className="w-3 h-3 text-gold-300" />
            {item}
          </span>
        ))}
      </div>
      <style>{`
        @keyframes travion-marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────
   Shared primitives
───────────────────────────────────────────────────────────── */

const Eyebrow: React.FC<{ children: React.ReactNode; light?: boolean }> = ({ children, light }) => (
  <span className={`inline-flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.26em] ${light ? 'text-ivory-200/90' : 'text-travion-600'}`}>
    <span className={`h-px w-8 ${light ? 'bg-ivory-200/50' : 'bg-gold-400'}`} />
    {children}
  </span>
);

const Reveal: React.FC<{ children: React.ReactNode; delay?: number; y?: number; className?: string }> = ({ children, delay = 0, y = 26, className }) => (
  <motion.div
    initial={{ opacity: 0, y }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-60px' }}
    transition={{ duration: 0.7, delay, ease: EASE }}
    className={className}
  >
    {children}
  </motion.div>
);

/* Image with graceful fallback (spec: image strategy — no broken tiles) */
const SafeImg: React.FC<{ src: string; alt: string; className?: string; loading?: 'lazy' | 'eager' }> = ({ src, alt, className = '', loading = 'lazy' }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div role="img" aria-label={alt} className={`${className} bg-gradient-to-br from-sand-200 via-ivory-200 to-sand-300 flex items-center justify-center`}>
        <MapPin className="w-8 h-8 text-sand-400" aria-hidden />
      </div>
    );
  }
  return <img src={src} alt={alt} loading={loading} onError={() => setFailed(true)} className={className} />;
};

const NAV_LINKS = [
  { href: '#explore', label: 'Explore' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#features', label: 'Features' },
  { href: '#about', label: 'About' },
  { href: '#contact', label: 'Contact' }
];

/* Every footer link resolves to a real section on this page — no dead anchors. */
const FOOTER_HREFS: Record<string, string> = {
  'Explore': '#explore',
  'Destinations': '#explore',
  'Live trip map': '#live',
  'How It Works': '#how-it-works',
  'Features': '#features',
  'Guide Mode': '#modes',
  'Adventurous Mode': '#modes',
  'Guide network': '#guide-network',
  'About': '#about',
  'Contact': '#contact',
  'FAQ': '#faq',
  'Help': '#faq'
};

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=2200&q=80';
const IMG_GUIDE = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=1200&q=80';
const IMG_ADVENTURE = 'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?auto=format&fit=crop&w=1200&q=80';
const IMG_COAST = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2200&q=80';
const IMG_PLANNERS = 'https://images.unsplash.com/photo-1506003094589-53954a26283f?auto=format&fit=crop&w=1200&q=80';
const IMG_ROAD = 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=2200&q=80';

/* ─────────────────────────────────────────────────────────────
   Landing page
───────────────────────────────────────────────────────────── */

export const LandingPage: React.FC<LandingPageProps> = ({ onLoginSuccess, onExploreDemo, onOpenGuideRegistration, onOpenGuideSignIn }) => {
  const reduceMotion = useReducedMotion();
  const { scrollY } = useScroll();
  const heroParallax = useTransform(scrollY, [0, 900], [0, 170]);
  const heroFade = useTransform(scrollY, [0, 720], [1, 0.94]);

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

  /* Legal overlays + contact form */
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', topic: 'General', priority: 'Normal', message: '' });
  const [contactState, setContactState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [contactError, setContactError] = useState<string | null>(null);

  const openAuth = (loginMode: boolean, role: 'USER' | 'GUIDE' = 'USER') => {
    setIsLoginMode(loginMode);
    setAuthRole(role);
    setAuthError(null);
    setShowAuthModal(true);
  };

  const openGuideRegistration = () => {
    // "Become a Guide" MUST open the dedicated Guide Registration flow —
    // never the traveller auth modal (the modal only offers Traveller
    // signup, so opening it for guides showed the WRONG role's form).
    onOpenGuideRegistration();
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

  /* Nav scrollspy: highlight the section currently in view */
  const [activeSection, setActiveSection] = useState('top');
  useEffect(() => {
    const SECTION_IDS = ['top', 'explore', 'features', 'how-it-works', 'live', 'modes', 'assistant', 'today', 'trust', 'guide-network', 'about', 'faq', 'contact'];
    let raf = 0;
    const compute = () => {
      const probe = window.scrollY + 150;
      let current = 'top';
      for (const id of SECTION_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top + window.scrollY <= probe) current = id;
      }
      setActiveSection(current);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

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

  const dotClickCount = useRef(0);
  const dotClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDotClick = () => {
    const next = dotClickCount.current + 1;
    dotClickCount.current = next;
    if (next >= 7) {
      setShowElevateModal(true);
      if (dotClickTimer.current) clearTimeout(dotClickTimer.current);
      dotClickCount.current = 0;
      return;
    }
    if (dotClickTimer.current) clearTimeout(dotClickTimer.current);
    dotClickTimer.current = setTimeout(() => {
      dotClickCount.current = 0;
    }, 2000);
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
      const normalizedEmail = email.trim().toLowerCase();
      const body = isLoginMode
        ? { email: normalizedEmail, password }
        : { email: normalizedEmail, password, role: authRole, first_name: firstName, last_name: lastName, phone: phoneDigits };
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

  /* Legal overlays: close on Escape only while one of them is open */
  useEffect(() => {
    if (!showTerms && !showPrivacy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowTerms(false);
        setShowPrivacy(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showTerms, showPrivacy]);

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (contactState === 'sending') return;
    setContactState('sending');
    setContactError(null);
    try {
      await api.submitContactMessage({
        name: contactForm.name.trim(),
        email: contactForm.email.trim(),
        topic: contactForm.topic,
        priority: contactForm.priority,
        message: contactForm.message.trim(),
      });
      setContactState('success');
    } catch (err: any) {
      setContactState('error');
      setContactError(err?.message || 'Could not send your message. Please try again in a moment.');
    }
  };

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

  /* How Travion works — the six steps */
  const howSteps = [
    { n: '01', icon: <Compass className="w-5 h-5" />, title: 'Tell us your trip', text: 'Choose the destination, dates and budget, then answer a short adaptive interview. Every answer becomes a real planning constraint.', tag: 'Your brief' },
    { n: '02', icon: <MapPin className="w-5 h-5" />, title: 'Explore real places', text: 'Open the live destination map with verified POIs — attractions, food, stays, shopping, healthcare, transport and more. Pick the exact spots you want.', tag: 'Live map' },
    { n: '03', icon: <Route className="w-5 h-5" />, title: 'Build your itinerary', text: 'Drag and drop your picks into day-by-day plans. Every date and time comes from the validated itinerary engine — impossible schedules never appear.', tag: 'Your itinerary' },
    { n: '04', icon: <Users className="w-5 h-5" />, title: 'Choose Guide or Adventurous', text: 'Travel with a verified local guide for on-ground support, or go independently with AI planning, navigation and replanning by your side.', tag: 'Your mode' },
    { n: '05', icon: <ShieldCheck className="w-5 h-5" />, title: 'Confirm & pay', text: 'Review the full breakdown — guide fee where applicable, platform fee, total. Pay securely through Razorpay with server-verified signatures.', tag: 'Transparent' },
    { n: '06', icon: <Navigation className="w-5 h-5" />, title: 'Travel with Travion', text: 'Live map, voice navigation, trip-scoped AI assistant, adaptive replanning and an offline package stay with you from departure to arrival.', tag: 'Live trip' }
  ] as const;

  /* Before/after story for the problem narrative */
  const beforeJourney = ['Too many tabs', 'Too many decisions', 'Uncertain places', 'Uncertain schedules', 'Unclear costs'];
  const travionJourney = [
    { label: 'Planning', text: 'A journey shaped around you', icon: <Compass className="w-4 h-4" /> },
    { label: 'Discovery', text: 'Real, verified places on a live map', icon: <MapPin className="w-4 h-4" /> },
    { label: 'Human support', text: 'Verified local guides when you want them', icon: <HeartHandshake className="w-4 h-4" /> },
    { label: 'Adaptive itinerary', text: 'A plan that respects time, budget and pace', icon: <Route className="w-4 h-4" /> },
    { label: 'Live trip', text: 'Navigation, replanning and offline packages', icon: <Navigation className="w-4 h-4" /> },
    { label: 'AI assistance', text: 'Memory-scoped help throughout the trip', icon: <BrainCircuit className="w-4 h-4" /> }
  ] as const;

  return (
    <div className="min-h-screen bg-ivory-50 text-charcoal-900 antialiased overflow-x-hidden">
      {/* ══════════════════ NAVBAR — floating glass ══════════════════ */}
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
          scrolled || mobileOpen ? 'glass-strong shadow-glass border-b border-white/50' : 'bg-transparent'
        }`}
      >
        <div className="container-site">
          <div className={`flex items-center justify-between ${scrolled || mobileOpen ? 'h-16' : 'h-[74px]'} transition-[height] duration-500`}>
            {/* Brand */}
            <a href="#top" className="flex items-center group aria-hidden-false" aria-label="Travion home">
              <TravionLogo mark={scrolled || mobileOpen ? 'dark' : 'ivory'} className="transition-opacity" />
            </a>

            {/* Desktop nav */}
            <nav className="hidden lg:flex items-center gap-8" aria-label="Primary">
              {NAV_LINKS.map((l) => {
                const active = activeSection === l.href.slice(1);
                return (
                  <a
                    key={l.href}
                    href={l.href}
                    className={`relative text-[13.5px] font-semibold transition-colors ${
                      active
                        ? scrolled ? 'text-travion-700' : 'text-white'
                        : scrolled ? 'text-charcoal-600 hover:text-travion-700' : 'text-white/85 hover:text-white'
                    }`}
                  >
                    {l.label}
                    {active && (
                      <span className={`absolute -bottom-2 left-0 right-0 h-0.5 rounded-full ${scrolled ? 'bg-travion-500' : 'bg-gold-300'}`} />
                    )}
                  </a>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              <button
                onClick={() => openAuth(true)}
                className={`hidden sm:inline-flex items-center px-4 h-10 rounded-xl text-[13px] font-bold transition-colors ${
                  scrolled ? 'text-charcoal-700 hover:bg-charcoal-100/60' : 'text-white hover:bg-white/10'
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => openGuideRegistration()}
                className={`hidden md:inline-flex items-center px-4 h-10 rounded-xl text-[13px] font-bold transition-colors ${
                  scrolled ? 'text-charcoal-700 hover:bg-charcoal-100/60' : 'text-white hover:bg-white/10'
                }`}
              >
                Become a Guide
              </button>
              <TravionButton
                size="sm"
                variant="primary"
                onClick={() => openAuth(false)}
                className={`hidden sm:inline-flex ${scrolled ? 'shadow-soft' : 'shadow-floating'}`}
              >
                Plan My Trip
                <ArrowRight className="w-3.5 h-3.5" />
              </TravionButton>
              {/* Mobile trigger */}
              <button
                onClick={() => setMobileOpen((o) => !o)}
                aria-label="Toggle menu"
                aria-expanded={mobileOpen}
                aria-controls="travion-mobile-nav"
                className={`lg:hidden inline-flex w-11 h-11 touch-manipulation items-center justify-center rounded-2xl border transition-colors ${
                  scrolled || mobileOpen
                    ? 'border-charcoal-200/70 bg-white/70 text-charcoal-700'
                    : 'border-white/20 bg-white/10 text-white'
                }`}
              >
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile navigation — full-screen glass sheet (bottom anchored) */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-charcoal-950/35 backdrop-blur-sm"
            />
            <motion.nav
              id="travion-mobile-nav"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.4, ease: EASE }}
              className="absolute inset-x-3 bottom-3 rounded-[30px] glass-strong shadow-floating px-5 pt-3 pb-5 pb-safe overflow-hidden"
              aria-label="Mobile"
            >
              <div className="flex items-center justify-between px-1 pt-2 pb-3">
                <TravionLogo />
                <button
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close menu"
                  className="inline-flex w-11 h-11 items-center justify-center rounded-2xl border border-charcoal-200/60 bg-white/70 text-charcoal-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {NAV_LINKS.map((l, i) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => setMobileOpen(false)}
                    className={`group flex items-center justify-between px-4 py-3.5 rounded-2xl text-[15px] transition-colors ${
                      activeSection === l.href.slice(1)
                        ? 'bg-travion-50 text-travion-700'
                        : 'text-charcoal-700 hover:bg-travion-50 hover:text-travion-700'
                    }`}
                  >
                    <span className="font-bold">{l.label}</span>
                    <span className="text-[10px] font-black tracking-widest text-charcoal-300 group-hover:text-travion-500">0{i + 1}</span>
                  </a>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-charcoal-100 grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setMobileOpen(false); openAuth(true); }}
                  className="h-12 rounded-2xl border border-charcoal-200/80 bg-white/70 text-charcoal-700 font-bold text-sm"
                >
                  Sign In
                </button>
                <button
                  onClick={() => { setMobileOpen(false); openGuideRegistration(); }}
                  className="h-12 rounded-2xl border border-travion-300 bg-travion-50 text-travion-700 font-bold text-sm hover:bg-travion-100"
                >
                  Become a Guide
                </button>
                <button
                  onClick={() => { setMobileOpen(false); openAuth(false); }}
                  className="h-12 rounded-2xl bg-travion-600 text-white font-bold text-sm col-span-2 shadow-soft"
                >
                  Plan My Trip
                </button>
              </div>
            </motion.nav>
          </div>
        )}
      </AnimatePresence>

      {/* ══════════════════ HERO ══════════════════ */}
      <section id="top" className="relative min-h-[100svh] flex flex-col overflow-hidden bg-travion-900">
        {/* Cinematic imagery — subtle parallax */}
        <div className="absolute inset-0">
          <motion.div
            initial={{ scale: 1.1, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 2.2, ease: EASE }}
            className="absolute inset-0 bg-cover bg-center will-change-transform"
            style={{ backgroundImage: `url(${HERO_IMAGE})`, y: reduceMotion ? 0 : heroParallax }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-travion-900/90 via-charcoal-950/45 to-travion-800/25" />
          <div className="absolute inset-0 bg-gradient-to-t from-travion-900/95 via-transparent to-travion-900/40" />
          {!reduceMotion && (
            <>
              <motion.div
                aria-hidden
                animate={{ x: [0, 36, -18, 0], y: [0, -24, 16, 0], opacity: [0.5, 0.7, 0.5] }}
                transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute -top-24 -left-24 w-[460px] h-[460px] rounded-full blur-[110px]"
                style={{ background: 'radial-gradient(circle, rgba(100,180,220,0.28), transparent 65%)' }}
              />
              <motion.div
                aria-hidden
                animate={{ x: [0, -40, 24, 0], y: [0, 20, -20, 0], opacity: [0.4, 0.6, 0.4] }}
                transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute bottom-0 right-[-120px] w-[500px] h-[500px] rounded-full blur-[120px]"
                style={{ background: 'radial-gradient(circle, rgba(219,190,118,0.18), transparent 65%)' }}
              />
            </>
          )}
        </div>

        <div className="relative flex-1 w-full max-w-7xl mx-auto px-5 md:px-8 pt-[132px] pb-16 grid lg:grid-cols-[1.06fr_0.94fr] items-end gap-12">
          {/* Editorial copy */}
          <div>
            <motion.div style={reduceMotion ? undefined : { opacity: heroFade }}>
              <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.2, ease: EASE }}>
                <Eyebrow light>Plans · adapts · supports · throughout</Eyebrow>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 26 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1, delay: 0.35, ease: EASE }}
                className="mt-6 text-white font-semibold type-display"
              >
                Travel without{' '}
                <br />
                <em className="font-editorial italic font-normal tracking-[-0.01em] bg-clip-text text-transparent bg-gradient-to-r from-ivory-200 via-sky-200 to-gold-200">
                  the uncertainty.
                </em>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, delay: 0.55, ease: EASE }}
                className="mt-6 max-w-xl text-white/80 text-base md:text-lg leading-relaxed font-medium"
              >
                TRAVION plans, adapts and supports you through the entire journey — from the first
                search to the last stop. Explore real places on a live map, build your itinerary,
                and choose a verified local guide or travel independently with AI by your side.
              </motion.p>

              {/* Flow pills — the product story in one glance */}
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, delay: 0.65, ease: EASE }}
                className="mt-6 flex flex-wrap items-center gap-2"
              >
                {[
                  'Explore the map',
                  'Choose your places',
                  'Pick your experience',
                  'Edit your plan',
                  'Pay transparently',
                ].map((step, i) => (
                  <span key={step} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 backdrop-blur px-3 py-1.5 text-[11px] font-semibold text-white/90">
                    <span className="w-4 h-4 rounded-full bg-gold-300/90 text-travion-900 text-[9px] font-black flex items-center justify-center">{i + 1}</span>
                    {step}
                  </span>
                ))}
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, delay: 0.72, ease: EASE }}
                className="mt-8 flex flex-wrap items-center gap-3.5"
              >
                <TravionButton
                  size="lg"
                  onClick={() => openAuth(false)}
                  className="bg-travion-500 hover:bg-travion-400 shadow-floating"
                >
                  Plan My Trip
                  <ArrowRight className="w-4 h-4" />
                </TravionButton>
                <button
                  onClick={() => openGuideRegistration()}
                  className="inline-flex items-center gap-2 h-12 px-7 rounded-2xl border border-white/25 bg-white/5 backdrop-blur text-white text-sm font-bold hover:bg-white/15 transition-all"
                >
                  Become a Guide
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1, delay: 0.95 }}
                className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl"
              >
                {[
                  { icon: <MapPin className="w-4 h-4" />, value: 5000, suffix: '+', label: 'Real places on live maps' },
                  { icon: <ShieldCheck className="w-4 h-4" />, value: 100, suffix: '%', label: 'Verified guides only' },
                  { icon: <Navigation className="w-4 h-4" />, value: 3, suffix: ' steps', label: 'To your final plan' },
                  { icon: <Wallet className="w-4 h-4" />, value: 0, suffix: '', label: 'Hidden fees. Ever.' },
                ].map((t) => (
                  <div key={t.label} className="rounded-2xl bg-white/10 border border-white/15 backdrop-blur px-3.5 py-3">
                    <span className="text-sky-200">{t.icon}</span>
                    <p className="mt-1 text-lg font-black text-white leading-tight">
                      <CountUp to={t.value} suffix={t.suffix} />
                    </p>
                    <p className="text-[10.5px] font-semibold text-white/60">{t.label}</p>
                  </div>
                ))}
              </motion.div>
            </motion.div>
          </div>

          {/* Floating trip planner */}
          <motion.div
            initial={{ opacity: 0, y: 44, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 1, delay: 0.7, ease: EASE }}
            className="w-full max-w-2xl lg:ml-auto"
          >
            <div className="rounded-[28px] border border-white/10 bg-white/95 backdrop-blur-xl shadow-floating p-2 md:p-3">
              <TripSearchBar onSearch={() => openAuth(false)} />
            </div>
            <p className="mt-3 text-center text-[11px] font-medium text-white/55">
              Real hubs only — plans are grounded in verified routes and stays. Sign in to plan your trip.
            </p>
          </motion.div>
        </div>

        {/* Scroll cue */}
        <motion.a
          href="#explore"
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

      {/* ══════════════════ MARQUEE RIBBON ══════════════════ */}
      <MarqueeRibbon />

      {/* ══════════════════ DESTINATION STORY ══════════════════ */}
      <section id="explore" className="relative py-24 md:py-32 bg-ivory-50">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <Reveal>
              <Eyebrow>Explore · Destination stories</Eyebrow>
              <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06] text-charcoal-900">
                Where will you go next?
              </h2>
              <p className="mt-4 max-w-lg text-charcoal-500 font-medium leading-relaxed">
                Journey through the places TRAVION knows how to plan — then open the live map and
                build the trip around you.
              </p>
            </Reveal>
            <Reveal delay={0.15} className="shrink-0">
              <button
                onClick={() => openAuth(false)}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-2xl bg-white border border-charcoal-200 text-charcoal-700 text-sm font-bold shadow-soft hover:border-travion-300 hover:text-travion-700 transition-all"
              >
                Start planning
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </Reveal>
          </div>

          {/* Editorial showcase — inspiration imagery (visual only, never trip data) */}
          <div className="mt-12 grid md:grid-cols-3 gap-5">
            {[
              { img: HERO_IMAGE, label: 'Misty highlands', sub: 'Forests · trails · viewpoints', tall: true },
              { img: IMG_COAST, label: 'Sun-drenched coast', sub: 'Beaches · tides · slow days', tall: false },
              { img: IMG_ROAD, label: 'Winding mountain roads', sub: 'Drives · towns · ghats', tall: false },
            ].map((card, i) => (
              <Reveal key={card.label} delay={Math.min(i * 0.1, 0.3)} className={card.tall ? 'md:row-span-1' : ''}>
                <div className={`group relative overflow-hidden rounded-[28px] ${card.tall ? 'h-[420px] md:h-[560px]' : 'h-[420px]'}`}>
                  <SafeImg
                    src={card.img}
                    alt={card.label}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1.4s] ease-out group-hover:scale-[1.05]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-charcoal-950/75 via-charcoal-950/10 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-6">
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gold-200">Inspiration</p>
                    <h3 className="mt-1.5 text-2xl font-extrabold text-white tracking-tight">{card.label}</h3>
                    <p className="mt-0.5 text-[13px] font-medium text-white/70">{card.sub}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-4 text-[11px] font-medium text-charcoal-400">
            Imagery is illustrative. Trip planning always uses verified destination data from the live map.
          </p>

          {/* Real verified hubs */}
          <div className="mt-14">
            <Reveal>
              <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-charcoal-400 mb-5">
                Verified hubs · real data
              </p>
            </Reveal>

            {hubsLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-80 rounded-3xl bg-ivory-200 animate-pulse" />
                ))}
              </div>
            ) : hubsError ? (
              <div className="rounded-3xl border border-dashed border-charcoal-200 bg-white p-10 text-center">
                <p className="text-sm font-bold text-charcoal-600">{hubsError}</p>
                <p className="mt-1.5 text-xs text-charcoal-400 font-medium">Please try again in a moment.</p>
              </div>
            ) : hubs.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-charcoal-200 bg-white p-10 text-center">
                <Globe2 className="w-8 h-8 text-charcoal-300 mx-auto mb-3" />
                <p className="text-sm font-bold text-charcoal-600">Verified hubs are being onboarded</p>
                <p className="mt-1.5 text-xs text-charcoal-400 font-medium">Plans are published per destination as their data is verified.</p>
              </div>
            ) : (
              <div className="overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth [scrollbar-width:thin]">
                <div className="flex gap-5 w-max">
                  {hubs.map((hub, i) => (
                    <motion.button
                      key={hub.id}
                      initial={{ opacity: 0, y: 26 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: '-40px' }}
                      transition={{ duration: 0.7, delay: Math.min(i * 0.06, 0.4), ease: EASE }}
                      onClick={() => openAuth(false)}
                      className="snap-start group relative w-[270px] md:w-[310px] h-[380px] md:h-[420px] rounded-[28px] overflow-hidden text-left shrink-0 bg-ivory-200 shadow-soft hover:shadow-floating transition-shadow focus:outline-none focus-visible:ring-4 focus-visible:ring-travion-200"
                      aria-label={`Plan a trip to ${hub.name}`}
                    >
                      {hub.hero_image ? (
                        <SafeImg
                          src={hub.hero_image}
                          alt={`${hub.name}, ${hub.state}`}
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1.4s] ease-out group-hover:scale-[1.06]"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-travion-100 to-travion-200">
                          <MapPin className="w-10 h-10 text-travion-500/60" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-charcoal-950/80 via-charcoal-950/20 to-transparent" />
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
        </div>
      </section>

      {/* ══════════════════ WHY TRAVION / FEATURES ══════════════════ */}
      <section id="features" className="py-24 md:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <Reveal className="text-center max-w-2xl mx-auto">
            <div className="flex justify-center"><Eyebrow>Why TRAVION</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06] text-charcoal-900">
              One continuous journey.
            </h2>
            <p className="mt-4 text-charcoal-500 font-medium leading-relaxed">
              Travel planning is fragmented. TRAVION was built to connect every piece of it — so
              nothing falls through the gaps.
            </p>
          </Reveal>

          <div className="mt-14 grid lg:grid-cols-2 gap-10 items-stretch">
            {/* Before */}
            <Reveal>
              <div className="h-full rounded-[28px] border border-charcoal-100 bg-ivory-50 p-8 md:p-10">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-charcoal-400">Before the journey</p>
                <h3 className="mt-2 text-2xl font-extrabold text-charcoal-800 tracking-tight">Fragmented. Uncertain. Exhausting.</h3>
                <ul className="mt-7 space-y-4">
                  {beforeJourney.map((item) => (
                    <li key={item} className="flex items-center gap-3.5">
                      <span className="w-7 h-7 rounded-full bg-charcoal-100 text-charcoal-400 flex items-center justify-center shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </span>
                      <span className="text-[15px] font-semibold text-charcoal-600">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

            {/* After — one continuous timeline */}
            <Reveal delay={0.15}>
              <div className="relative h-full rounded-[28px] bg-charcoal-900 p-8 md:p-10 overflow-hidden">
                <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full blur-[100px]" style={{ background: 'radial-gradient(circle, rgba(61,148,196,0.35), transparent 65%)' }} />
                <div className="relative">
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gold-300">With TRAVION</p>
                  <h3 className="mt-2 text-2xl font-extrabold text-white tracking-tight">Planned. Verified. Supported.</h3>
                  <div className="mt-8 space-y-0">
                    {travionJourney.map((step, i) => (
                      <div key={step.label} className="relative flex gap-5 pb-8 last:pb-0">
                        {i < travionJourney.length - 1 && (
                          <span className="absolute left-[17px] top-9 bottom-0 w-px bg-white/15" />
                        )}
                        <span className="relative w-9 h-9 rounded-xl bg-travion-500/20 border border-travion-400/30 text-travion-200 flex items-center justify-center shrink-0">
                          {step.icon}
                        </span>
                        <div className="pt-1">
                          <p className="text-[15px] font-extrabold text-white">{step.label}</p>
                          <p className="mt-0.5 text-[12.5px] font-medium text-white/60">{step.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══════════════════ HOW IT WORKS ══════════════════ */}
      <section id="how-it-works" className="py-24 md:py-32 bg-ivory-50">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <Reveal className="text-center max-w-2xl mx-auto">
            <div className="flex justify-center"><Eyebrow>How it works</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06] text-charcoal-900">
              From first idea to the open road.
            </h2>
            <p className="mt-4 text-charcoal-500 font-medium leading-relaxed">
              Six steps. One continuous journey. Every screen connected to real functionality.
            </p>
          </Reveal>

          <div className="relative mt-16">
            <span className="absolute left-5 md:left-1/2 top-0 bottom-0 w-px bg-charcoal-200 hidden md:block" aria-hidden />
            <div className="space-y-8">
              {howSteps.map((s, i) => (
                <Reveal key={s.n} delay={Math.min(i * 0.05, 0.25)}>
                  <div className={`md:grid md:grid-cols-2 md:gap-14 items-center ${i % 2 === 1 ? 'md:text-right' : ''}`}>
                    <div className={`md:relative flex items-center gap-5 ${i % 2 === 1 ? 'md:order-2' : ''}`}>
                      <span className="relative z-10 shrink-0 w-11 h-11 rounded-2xl bg-travion-600 text-white flex items-center justify-center shadow-soft">
                        {s.icon}
                      </span>
                      <div className="flex-1">
                        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold-500">{s.n}</p>
                        <h3 className="mt-1 text-xl md:text-2xl font-extrabold text-charcoal-900 tracking-tight">{s.title}</h3>
                        <p className={`mt-2 text-[13.5px] font-medium text-charcoal-500 leading-relaxed ${i % 2 === 1 ? 'md:ml-auto' : ''} max-w-md`}>{s.text}</p>
                        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-travion-50 border border-travion-200 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider text-travion-700">
                          {s.tag}
                        </span>
                      </div>
                    </div>
                    <div className={`hidden md:block ${i % 2 === 1 ? 'md:order-1' : ''}`}>
                      <div className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-charcoal-400 ${i % 2 === 1 ? 'md:justify-end' : ''}`}>
                        <span className="font-editorial italic normal-case text-lg text-charcoal-300">step</span>
                        <span className="text-5xl font-extrabold text-charcoal-200/60 leading-none">{s.n}</span>
                      </div>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════ MAP EXPERIENCE PREVIEW ══════════════════ */}
      <section id="live" className="py-24 md:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <div className="grid lg:grid-cols-[1fr_1fr] gap-12 items-center">
            <Reveal>
              <Eyebrow>Live map · Product preview</Eyebrow>
              <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06] text-charcoal-900">
                TRAVION doesn't just recommend places.
                <br />
                <span className="text-travion-700">It builds a real journey.</span>
              </h2>
              <p className="mt-5 text-charcoal-500 font-medium leading-relaxed max-w-md">
                Verified markers for every category, card-to-map sync, and an itinerary timeline that
                respects real times. This is the same map you use to plan — with the same real places.
              </p>
              <div className="mt-8 flex flex-wrap gap-2.5">
                {['Attractions', 'Food & cafés', 'Stays', 'Shopping', 'Transport', 'Healthcare', 'Education', 'More'].map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-charcoal-200 bg-ivory-50 px-3.5 py-1.5 text-[11px] font-bold text-charcoal-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-travion-500" />
                    {c}
                  </span>
                ))}
              </div>
            </Reveal>

            <Reveal delay={0.15}>
              <div className="relative">
                <div className="absolute -inset-3 rounded-[32px] bg-gradient-to-br from-travion-100/70 via-gold-100/40 to-transparent blur-xl" />
                <div className="relative rounded-[28px] border border-charcoal-100 bg-ivory-50 shadow-soft-lg overflow-hidden">
                  {/* Map canvas mock */}
                  <div className="relative h-[300px] bg-[#dcebf2] overflow-hidden">
                    <div className="absolute inset-0 opacity-60" style={{
                      backgroundImage: 'linear-gradient(#ffffff55 1px, transparent 1px), linear-gradient(90deg, #ffffff55 1px, transparent 1px), linear-gradient(#bcd3e3 1px, transparent 1px), linear-gradient(90deg, #bcd3e3 1px, transparent 1px)',
                      backgroundSize: '80px 80px, 80px 80px, 16px 16px, 16px 16px'
                    }} />
                    {/* Route line */}
                    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 300" fill="none" aria-hidden>
                      <path d="M70 230 C 150 190, 220 250, 300 160 S 460 120, 530 90" stroke="#267aa8" strokeWidth="3" strokeDasharray="1 8" strokeLinecap="round" strokeOpacity="0.6" />
                      {[
                        [70, 230], [190, 208], [300, 160], [430, 132], [530, 90]
                      ].map(([x, y], i) => (
                        <g key={i}>
                          <circle cx={x} cy={y} r="7" fill="#fffdf8" stroke="#267aa8" strokeWidth="3" />
                          <circle cx={x} cy={y} r="7" fill={i === 2 ? '#a97f33' : '#267aa8'} />
                        </g>
                      ))}
                    </svg>
                    <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-charcoal-600 shadow-soft">
                      <MapPin className="w-3 h-3 text-travion-600" /> Live map · Product preview
                    </span>
                  </div>
                  {/* Timeline card */}
                  <div className="p-5 border-t border-charcoal-100 bg-white/70">
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-charcoal-400">Marrying the itinerary to the map</p>
                    <div className="mt-4 space-y-2.5">
                      {[
                        { time: '04:00 pm', title: 'Hotel check-in', icon: <BedDouble className="w-4 h-4" /> },
                        { time: '05:00 pm', title: 'Heritage exploration', icon: <Landmark className="w-4 h-4" /> },
                        { time: '06:30 pm', title: 'Sunset viewpoint', icon: <Mountain className="w-4 h-4" /> },
                        { time: '07:45 pm', title: 'Dinner · local café', icon: <Utensils className="w-4 h-4" /> }
                      ].map((row) => (
                        <div key={row.title} className="flex items-center gap-3 rounded-2xl border border-charcoal-100 bg-white px-3.5 py-2.5">
                          <span className="w-8 h-8 rounded-xl bg-travion-50 text-travion-700 flex items-center justify-center">{row.icon}</span>
                          <div className="flex-1">
                            <p className="text-[13px] font-bold text-charcoal-800">{row.title}</p>
                            <p className="text-[10.5px] font-semibold text-charcoal-400">{row.time}</p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-charcoal-300" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══════════════════ HUMAN + AI ══════════════════ */}
      <section id="modes" className="py-24 md:py-32 bg-ivory-50">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <Reveal className="max-w-2xl">
            <Eyebrow>Two ways to travel</Eyebrow>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06] text-charcoal-900">
              Human care, or the open road — with AI beside you.
            </h2>
            <p className="mt-4 text-charcoal-500 font-medium leading-relaxed">
              Both modes share the same planned journey, verified map and live support. You choose
              how much of it happens with another human by your side.
            </p>
          </Reveal>

          <div className="mt-14 grid md:grid-cols-2 gap-6">
            {/* Guide Mode */}
            <Reveal>
              <div className="group relative overflow-hidden rounded-[28px] bg-charcoal-900 text-white p-8 min-h-[480px] flex flex-col">
                <SafeImg src={IMG_GUIDE} alt="A local guide showing the way" className="absolute inset-0 w-full h-full object-cover opacity-22 transition-transform duration-[1.4s] ease-out group-hover:scale-[1.05]" />
                <div className="absolute inset-0 bg-gradient-to-b from-charcoal-950/70 via-transparent to-charcoal-950/90" />
                <div className="relative z-10 flex-1 flex flex-col">
                  <div className="flex items-center gap-2.5">
                    <span className="px-3 py-1 rounded-full bg-gold-400/90 text-charcoal-900 text-[10px] font-black uppercase tracking-wider">Guide mode</span>
                    <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-ivory-200/80"><BadgeCheck className="w-3.5 h-3.5" /> Verified local guides</span>
                  </div>
                  <h3 className="mt-5 text-3xl font-extrabold tracking-tight">Travel with someone who knows the place.</h3>
                  <ul className="mt-6 space-y-3.5">
                    {[
                      'Verified local guide matched to your route',
                      'On-ground support through the whole trip',
                      'Direct chat with your guide after assignment',
                      'Local knowledge layered onto your AI plan'
                    ].map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-[13.5px] font-medium text-white/85">
                        <Check className="w-4 h-4 text-gold-300 mt-0.5" /> {b}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-7">
                    <p className="text-[12px] font-medium text-white/60">
                      Guide fee + platform fee — both shown upfront, computed server-side.
                    </p>
                    <button
                      onClick={() => openAuth(false)}
                      className="mt-4 inline-flex items-center gap-2 h-11 px-5 rounded-2xl bg-white/95 hover:bg-white text-charcoal-900 text-sm font-bold transition-all hover:-translate-y-px"
                    >
                      Plan a guided trip
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </Reveal>

            {/* Adventurous Mode */}
            <Reveal delay={0.12}>
              <div className="group relative overflow-hidden rounded-[28px] bg-white border border-charcoal-100 p-8 min-h-[480px] flex flex-col">
                <SafeImg src={IMG_ADVENTURE} alt="A solo traveller on a mountain trail" className="absolute inset-0 w-full h-full object-cover opacity-15 transition-transform duration-[1.4s] ease-out group-hover:scale-[1.05]" />
                <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/30 to-ivory-50/95" />
                <div className="relative z-10 flex-1 flex flex-col">
                  <div className="flex items-center gap-2.5">
                    <span className="px-3 py-1 rounded-full bg-travion-600 text-white text-[10px] font-black uppercase tracking-wider">Adventurous mode</span>
                    <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-charcoal-500"><BrainCircuit className="w-3.5 h-3.5" /> AI by your side</span>
                  </div>
                  <h3 className="mt-5 text-3xl font-extrabold tracking-tight text-charcoal-900">Independent travel, intelligently planned.</h3>
                  <ul className="mt-6 space-y-3.5">
                    {[
                      'Full AI-planned journey, no guide fee',
                      'Live map, navigation and AI assistant included',
                      'Dynamic replanning whenever conditions change',
                      'Local discovery and safety information built in'
                    ].map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-[13.5px] font-medium text-charcoal-600">
                        <Check className="w-4 h-4 text-travion-600 mt-0.5" /> {b}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-7">
                    <p className="text-[12px] font-medium text-charcoal-400">
                      Platform fee only — never a guide fee you don't ask for.
                    </p>
                    <button
                      onClick={() => openAuth(false)}
                      className="mt-4 inline-flex items-center gap-2 h-11 px-5 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-bold transition-all hover:-translate-y-px"
                    >
                      Plan an independent trip
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══════════════════ AI ASSISTANT ══════════════════ */}
      <section id="assistant" className="py-24 md:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <Reveal delay={0.1} className="order-2 lg:order-1">
              <div className="relative max-w-md">
                <div className="absolute -inset-3 rounded-[32px] bg-gradient-to-br from-travion-100/70 via-gold-100/30 to-transparent blur-xl" />
                <div className="relative rounded-[28px] border border-charcoal-100 bg-ivory-50 shadow-soft-lg overflow-hidden">
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-charcoal-100 bg-white/70">
                    <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center">
                      <BrainCircuit className="w-4.5 h-4.5 text-white" />
                    </span>
                    <div>
                      <p className="text-[13.5px] font-extrabold text-charcoal-800">TRAVION assistant</p>
                      <p className="text-[10.5px] font-semibold text-charcoal-400">Trip-scoped memory · your trip only</p>
                    </div>
                    <span className="ml-auto text-[9px] font-bold uppercase tracking-widest text-gold-500">Product preview</span>
                  </div>
                  <div className="space-y-3.5 p-5">
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-travion-600 text-white px-4 py-2.5 text-[13px] font-medium leading-relaxed shadow-soft">
                        What's next?
                      </div>
                    </div>
                    <div className="flex justify-start">
                      <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-white border border-charcoal-100 px-4 py-2.5 text-[13px] font-medium leading-relaxed text-charcoal-700 shadow-soft">
                        Your next stop is <span className="font-bold text-charcoal-900">Tank Bund</span> at <span className="font-bold text-travion-700">4:30 PM</span>.
                        It's <span className="font-bold text-charcoal-900">12 minutes</span> from your current location.
                      </div>
                    </div>
                    <div className="flex justify-start">
                      <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-white border border-charcoal-100 px-4 py-2.5 text-[13px] font-medium leading-relaxed text-charcoal-700 shadow-soft">
                        The viewpoint stays open until 6:00 PM, so you have time. Replan if the weather turns?
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>

            <Reveal className="order-1 lg:order-2">
              <Eyebrow>AI assistant</Eyebrow>
              <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06] text-charcoal-900">
                An assistant that knows <em className="font-editorial font-normal italic">your</em> trip.
              </h2>
              <p className="mt-5 text-charcoal-500 font-medium leading-relaxed max-w-md">
                Every trip gets its own isolated memory. Ask what's next, where to eat, or how to
                adjust a day — the assistant answers from your verified itinerary, never from
                somewhere else.
              </p>
              <div className="mt-8 space-y-3">
                {[
                  { icon: <RefreshCw className="w-4 h-4" />, text: 'Replans only your flexible parts — with a plain-language reason' },
                  { icon: <Clock className="w-4 h-4" />, text: 'Times come from the validated engine, never guessed schedules' },
                  { icon: <Lock className="w-4 h-4" />, text: 'Nothing leaks between trips; memory is scoped per journey' }
                ].map((row) => (
                  <div key={row.text} className="flex items-start gap-3 text-[13.5px] font-medium text-charcoal-600">
                    <span className="w-8 h-8 rounded-xl bg-travion-50 text-travion-700 flex items-center justify-center shrink-0">{row.icon}</span>
                    {row.text}
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══════════════════ ACTIVE TRIP PREVIEW ══════════════════ */}
      <section id="today" className="py-24 md:py-32 bg-travion-900 text-white">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <Reveal>
              <Eyebrow light>Live trip · Product preview</Eyebrow>
              <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
                The day you actually <em className="font-editorial font-normal italic text-gold-300">travel</em>.
              </h2>
              <p className="mt-5 text-white/70 font-medium leading-relaxed max-w-md">
                After payment is verified, your journey becomes a live dashboard — today's itinerary,
                the map, your assistant, navigation, your guide and emergency info, all in one place.
              </p>
              <div className="mt-8 flex flex-wrap gap-2.5">
                {['Today', 'Map', 'AI assistant', 'Navigation', 'Guide', 'Emergency'].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3.5 py-1.5 text-[11px] font-bold text-white/85">
                    {t}
                  </span>
                ))}
              </div>
            </Reveal>

            <Reveal delay={0.15}>
              <div className="relative">
                <div className="absolute -inset-3 rounded-[32px] bg-gradient-to-br from-travion-500/30 to-transparent blur-xl" />
                <div className="relative rounded-[28px] bg-white/95 shadow-floating overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-5 border-b border-charcoal-100">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-travion-600">Today</p>
                      <p className="text-xl font-extrabold text-charcoal-900">21 September</p>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-gold-50 border border-gold-200 text-gold-500 text-[10px] font-black uppercase tracking-wider">Product preview</span>
                  </div>
                  <div className="p-6 relative">
                    <span className="absolute left-[31px] top-8 bottom-8 w-px bg-charcoal-100" aria-hidden />
                    {[
                      { time: '09:00 AM', title: 'Breakfast', icon: <Utensils className="w-4 h-4" /> },
                      { time: '10:00 AM', title: 'Heritage exploration', icon: <Landmark className="w-4 h-4" /> },
                      { time: '12:30 PM', title: 'Lunch · street café', icon: <Coffee className="w-4 h-4" /> },
                      { time: '03:30 PM', title: 'Viewpoint', icon: <Mountain className="w-4 h-4" /> },
                      { time: '06:00 PM', title: 'Sunset', icon: <Navigation className="w-4 h-4" /> }
                    ].map((row) => (
                      <div key={row.time} className="relative flex gap-5 pb-5 last:pb-0">
                        <span className="relative z-10 w-12 h-12 rounded-2xl bg-travion-50 border border-travion-200 text-travion-700 flex items-center justify-center shrink-0">
                          {row.icon}
                        </span>
                        <div className="pt-1">
                          <p className="text-[12px] font-black text-charcoal-400">{row.time}</p>
                          <p className="text-[15px] font-extrabold text-charcoal-900">{row.title}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══════════════════ TRUST / SOCIAL PROOF ══════════════════ */}
      <section id="trust" className="py-24 md:py-32 bg-ivory-50">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <Reveal className="text-center max-w-2xl mx-auto">
            <div className="flex justify-center"><Eyebrow>Built to be trusted</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06] text-charcoal-900">
              Real capability. No placeholders.
            </h2>
            <p className="mt-4 text-charcoal-500 font-medium leading-relaxed">
              We don't publish fake testimonials or invented travellers. Here is what TRAVION actually
              guarantees with real product capability.
            </p>
          </Reveal>

          <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-5 gap-5">
            {[
              { icon: <MapPin className="w-5 h-5" />, title: 'Real places', text: 'Live maps of verified POIs across nine categories' },
              { icon: <BadgeCheck className="w-5 h-5" />, title: 'Verified POI data', text: 'Providers confirm what exists before it ever appears' },
              { icon: <BrainCircuit className="w-5 h-5" />, title: 'AI planning', text: 'Your preferences become genuine scheduling constraints' },
              { icon: <HeartHandshake className="w-5 h-5" />, title: 'Human guide support', text: 'Guides onboarded, assessed and manager-approved' },
              { icon: <ShieldCheck className="w-5 h-5" />, title: 'Secure payments', text: 'Razorpay processing with server-verified signatures' }
            ].map((item, i) => (
              <Reveal key={item.title} delay={Math.min(i * 0.06, 0.3)}>
                <div className="group h-full rounded-[22px] border border-charcoal-100 bg-white p-6 text-center hover:shadow-soft hover:-translate-y-1 transition-all duration-300">
                  <span className="mx-auto w-12 h-12 rounded-2xl bg-travion-50 text-travion-700 flex items-center justify-center group-hover:bg-travion-600 group-hover:text-white transition-colors duration-300">
                    {item.icon}
                  </span>
                  <h3 className="mt-4 text-[14.5px] font-extrabold text-charcoal-900">{item.title}</h3>
                  <p className="mt-1.5 text-[12px] font-medium text-charcoal-500 leading-relaxed">{item.text}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.15}>
            <div className="mt-8 rounded-[24px] border border-charcoal-100 bg-white p-7 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-5 md:justify-between">
              <div className="flex items-center gap-4">
                <span className="w-12 h-12 rounded-2xl bg-ivory-200 text-gold-500 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5" />
                </span>
                <div>
                  <p className="text-[15px] font-extrabold text-charcoal-900">Honest social proof</p>
                  <p className="mt-0.5 text-[12.5px] font-medium text-charcoal-500">No placeholders · No fake guides · No generic chat · Real verified data only.</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-charcoal-400">
                <ShieldCheck className="w-4 h-4 text-travion-600" /> Razorpay-secured payments
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ GUIDE NETWORK ══════════════════ */}
      <section id="guide-network" className="py-24 md:py-32 bg-charcoal-900 text-white">
        <div className="max-w-7xl mx-auto px-5 md:px-8 grid lg:grid-cols-2 gap-12 items-center">
          <Reveal>
            <Eyebrow light>Guide network</Eyebrow>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06]">
              Turn local knowledge into a living.
            </h2>
            <p className="mt-5 text-white/70 font-medium leading-relaxed max-w-md">
              Verified guides plan with, not against, the platform. You get assessed on destination
              knowledge and safety, approved by an operations manager, then matched to travellers
              who chose Guide Mode along your routes.
            </p>
            <div className="mt-8 space-y-3">
              {[
                { icon: <BadgeCheck className="w-4 h-4" />, text: 'Structured onboarding + safety assessment before approval' },
                { icon: <Wallet className="w-4 h-4" />, text: 'Transparent fees with settled payouts you can track' },
                { icon: <MessagesSquare className="w-4 h-4" />, text: 'Direct traveller chat from assignment to completion' }
              ].map((row) => (
                <div key={row.text} className="flex items-start gap-3 text-[13.5px] font-medium text-white/75">
                  <span className="text-gold-300 mt-0.5">{row.icon}</span>
                  {row.text}
                </div>
              ))}
            </div>
            <div className="mt-9 flex flex-wrap gap-3">
              <button
                onClick={() => openGuideRegistration()}
                className="inline-flex items-center gap-2 h-12 px-6 rounded-2xl bg-gold-400 hover:bg-gold-300 text-charcoal-900 text-sm font-black transition-all hover:-translate-y-0.5"
              >
                Become a Guide
                <ArrowUpRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => onOpenGuideSignIn()}
                className="inline-flex items-center h-12 px-6 rounded-2xl border border-white/25 bg-white/5 backdrop-blur text-white text-sm font-bold hover:bg-white/15 transition-all"
              >
                Guide Sign In
              </button>
            </div>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="grid grid-cols-2 gap-5">
              {[
                { icon: <BookOpen className="w-5 h-5" />, title: 'Onboarding', text: 'Profile, languages, destinations, experience' },
                { icon: <ShieldCheck className="w-5 h-5" />, title: 'Assessment', text: 'Destination knowledge + safety scenarios' },
                { icon: <Users className="w-5 h-5" />, title: 'Approval', text: 'Manager verifies before you can operate' },
                { icon: <Route className="w-5 h-5" />, title: 'Matching', text: 'Ranked against the trips you know best' }
              ].map((c) => (
                <div key={c.title} className="rounded-[22px] bg-white/5 border border-white/10 backdrop-blur p-5">
                  <span className="w-10 h-10 rounded-xl bg-travion-500/20 text-travion-200 flex items-center justify-center">{c.icon}</span>
                  <h3 className="mt-3 text-[14px] font-extrabold">{c.title}</h3>
                  <p className="mt-1 text-[11.5px] font-medium text-white/55">{c.text}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ ABOUT ══════════════════ */}
      <section id="about" className="py-24 md:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-5 md:px-8 grid lg:grid-cols-2 gap-12 items-center">
          <Reveal>
            <Eyebrow>About</Eyebrow>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06] text-charcoal-900">
              Why TRAVION exists.
            </h2>
            <p className="mt-5 text-charcoal-500 font-medium leading-relaxed max-w-md">
              Travel planning is fragmented across a dozen tabs — discovery, bookings, budgets,
              itineraries, directions, support. TRAVION connects them into one continuous journey,
              so the person planning can focus on the trip, not the tooling.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-3">
              {[
                'Discovery', 'Planning', 'Budget', 'Itinerary',
                'Human support', 'Navigation', 'AI assistance', 'Live replanning'
              ].map((c) => (
                <div key={c} className="flex items-center gap-2.5 rounded-2xl border border-charcoal-100 bg-ivory-50 px-4 py-3">
                  <CheckCircle2 className="w-4 h-4 text-travion-600 shrink-0" />
                  <span className="text-[13px] font-bold text-charcoal-700">{c}</span>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="relative">
              <div className="absolute -inset-3 rounded-[32px] bg-gradient-to-br from-travion-100/70 via-gold-100/30 to-transparent blur-xl" />
              <div className="relative overflow-hidden rounded-[28px] shadow-soft-lg">
                <SafeImg src={IMG_PLANNERS} alt="Travellers planning a route together" className="h-[480px] w-full object-cover" loading="eager" />
                <div className="absolute inset-0 bg-gradient-to-t from-charcoal-950/60 via-transparent to-transparent" />
                <div className="absolute bottom-6 left-6 right-6">
                  <p className="text-white text-sm font-medium leading-relaxed max-w-sm">
                    "We build the planning layer so a traveller can stay in one journey — from first
                    idea to the last stop."
                  </p>
                  <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/60">The TRAVION team</p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ FAQ ══════════════════ */}
      <section id="faq" className="py-24 md:py-32 bg-ivory-50">
        <div className="max-w-3xl mx-auto px-5 md:px-8">
          <Reveal className="text-center">
            <div className="flex justify-center"><Eyebrow>Questions</Eyebrow></div>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06] text-charcoal-900">
              Frequently asked
            </h2>
          </Reveal>
          <div className="mt-10 space-y-3">
            {faqs.map((f, i) => {
              const open = openFaq === i;
              return (
                <Reveal key={f.q} delay={Math.min(i * 0.03, 0.2)}>
                  <div className={`rounded-2xl border transition-all duration-300 ${open ? 'border-travion-200 bg-white shadow-soft' : 'border-charcoal-100 bg-white'}`}>
                    <button
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left"
                    >
                      <span className={`text-[15px] font-extrabold ${open ? 'text-travion-700' : 'text-charcoal-800'}`}>{f.q}</span>
                      <motion.span
                        animate={{ rotate: open ? 45 : 0 }}
                        transition={{ duration: 0.3 }}
                        className="shrink-0 w-8 h-8 rounded-xl bg-ivory-200 flex items-center justify-center text-charcoal-600"
                      >
                        <Plus className="w-4 h-4" />
                      </motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.35, ease: EASE }}
                          className="overflow-hidden"
                        >
                          <p className="px-6 pb-6 text-[13.5px] font-medium text-charcoal-500 leading-relaxed">{f.a}</p>
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
      <section className="relative py-28 md:py-36 overflow-hidden bg-travion-900">
        <SafeImg src={IMG_ROAD} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-b from-travion-900/85 via-travion-900/70 to-charcoal-950/90" />
        <div className="relative max-w-4xl mx-auto px-5 md:px-8 text-center">
          <Reveal>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-gold-300">Ready?</p>
            <h2 className="mt-4 text-4xl md:text-6xl font-extrabold tracking-[-0.03em] leading-[1.05] text-white">
              Travel without<br />
              <em className="font-editorial font-normal italic">the uncertainty.</em>
            </h2>
            <p className="mt-5 text-white/70 font-medium text-lg max-w-xl mx-auto">
              Start your journey on a live map of real places — or help others travel by becoming a guide.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3.5">
              <button
                onClick={() => openAuth(false)}
                className="inline-flex items-center gap-2 h-13 px-7 rounded-2xl bg-travion-500 hover:bg-travion-400 text-white text-sm font-bold shadow-floating transition-all hover:-translate-y-0.5"
              >
                Plan My Trip
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => openGuideRegistration()}
                className="inline-flex items-center gap-2 h-13 px-7 rounded-2xl border border-white/25 bg-white/5 backdrop-blur text-white text-sm font-bold hover:bg-white/15 transition-all"
              >
                Become a Guide
                <ArrowUpRight className="w-4 h-4" />
              </button>
              <button
                onClick={onExploreDemo}
                className="inline-flex items-center gap-2 h-13 px-7 rounded-2xl bg-white text-charcoal-900 text-sm font-bold hover:bg-ivory-100 transition-all hover:-translate-y-0.5"
              >
                Try the demo preview
                <Compass className="w-4 h-4" />
              </button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ CONTACT ══════════════════ */}
      <section id="contact" className="py-24 md:py-32 bg-ivory-50">
        <div className="max-w-6xl mx-auto px-5 md:px-8 grid lg:grid-cols-[0.9fr_1.1fr] gap-12 items-start">
          <Reveal>
            <Eyebrow>Contact</Eyebrow>
            <h2 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.06] text-charcoal-900">
              Talk to the people behind the journey.
            </h2>
            <p className="mt-5 text-charcoal-500 font-medium leading-relaxed max-w-md">
              Questions about planning, payments, the guide network or the platform itself — a real
              team reads every message.
            </p>
            <div className="mt-8 space-y-4">
              {[
                { icon: <IndianRupee className="w-4 h-4" />, title: 'Transparent fees', text: 'Guide fee + platform fee, shown before you pay' },
                { icon: <Phone className="w-4 h-4" />, title: 'Masked always', text: 'Phone numbers are masked except for escalation' },
                { icon: <ShieldCheck className="w-4 h-4" />, title: 'Razorpay-secured', text: 'Payments processed with server-verified signatures' }
              ].map((row) => (
                <div key={row.title} className="flex items-start gap-4 rounded-2xl border border-charcoal-100 bg-white px-5 py-4">
                  <span className="w-10 h-10 rounded-xl bg-travion-50 text-travion-700 flex items-center justify-center shrink-0">{row.icon}</span>
                  <div>
                    <p className="text-[14px] font-extrabold text-charcoal-800">{row.title}</p>
                    <p className="text-[12px] font-medium text-charcoal-500 mt-0.5">{row.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="rounded-[28px] border border-charcoal-100 bg-white shadow-soft-lg p-7 md:p-9">
              {contactState === 'success' ? (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <span className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-500 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8" />
                  </span>
                  <h3 className="mt-5 text-xl font-extrabold text-charcoal-900">Message sent</h3>
                  <p className="mt-2 text-sm font-medium text-charcoal-500 max-w-xs">
                    Thanks for writing to us. A member of the team will get back to you soon.
                  </p>
                  <button
                    onClick={() => { setContactState('idle'); setContactForm({ name: '', email: '', topic: 'General', priority: 'Normal', message: '' }); }}
                    className="mt-6 inline-flex items-center gap-2 h-11 px-5 rounded-2xl border border-charcoal-200 text-charcoal-700 text-sm font-bold hover:border-travion-300 hover:text-travion-700 transition-all"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Name">
                      <input type="text" required placeholder="Your name" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} className={inputCls} />
                    </Field>
                    <Field label="Email">
                      <input type="email" required placeholder="you@example.com" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} className={inputCls} />
                    </Field>
                  </div>

                  {contactState === 'error' && contactError && (
                    <div className="flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5 text-red-600 text-[12px] font-bold">
                      <AlertIcon />
                      {contactError}
                    </div>
                  )}

                  <Field label="Message">
                    <textarea
                      required
                      rows={5}
                      minLength={10}
                      maxLength={2000}
                      placeholder="How can we help?"
                      value={contactForm.message}
                      onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                      className={`${inputCls} h-auto py-3 resize-none`}
                    />
                  </Field>

                  <button
                    type="submit"
                    disabled={contactState === 'sending'}
                    className="w-full h-12 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-bold shadow-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {contactState === 'sending' ? 'Sending...' : 'Send message'}
                  </button>
                </form>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ FOOTER ══════════════════ */}
      <footer className="bg-charcoal-950 text-white">
        <div className="max-w-7xl mx-auto px-5 md:px-8 py-16">
          <div className="grid md:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10">
            <div>
              <a href="#top" className="inline-flex items-center gap-2.5" aria-label="Travion home">
                <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center">
                  <Compass className="w-5 h-5 text-white" />
                </span>
                <span className="text-[18px] font-extrabold tracking-[0.08em]">TRAVION</span>
              </a>
              <p className="mt-3 text-[13px] font-medium text-white/50 leading-relaxed max-w-xs">
                Travel without the uncertainty. One continuous journey — planning, discovery, human
                support, adaptive itineraries, live travel and AI assistance.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  onClick={() => openAuth(false)}
                  className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-[12.5px] font-bold transition-all"
                >
                  Plan My Trip
                </button>
                <button
                  onClick={() => openGuideRegistration()}
                  className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-white/20 bg-white/5 text-white text-[12.5px] font-bold hover:bg-white/15 transition-all"
                >
                  Become a Guide
                </button>
              </div>
            </div>

            <nav aria-label="Explore">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gold-300">Explore</p>
              <ul className="mt-4 space-y-2.5">
                {['Explore', 'Destinations', 'Live trip map', 'How It Works', 'Features', 'About'].map((link) => (
                  <li key={link}>
                    <a href={FOOTER_HREFS[link]} className="text-[13.5px] font-medium text-white/60 hover:text-white transition-colors">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-label="Support">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gold-300">Support</p>
              <ul className="mt-4 space-y-2.5">
                {['Contact', 'FAQ', 'Help'].map((link) => (
                  <li key={link}>
                    <a href={FOOTER_HREFS[link]} className="text-[13.5px] font-medium text-white/60 hover:text-white transition-colors">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-6 space-y-2.5">
                <button
                  onClick={() => openGuideRegistration()}
                  className="block text-[13.5px] font-medium text-white/60 hover:text-white transition-colors"
                >
                  Guide network
                </button>
                <button
                  onClick={() => onOpenGuideSignIn()}
                  className="block text-[13.5px] font-medium text-white/60 hover:text-white transition-colors"
                >
                  Guide Sign In
                </button>
              </div>
            </nav>

            <nav aria-label="Legal">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gold-300">Legal</p>
              <ul className="mt-4 space-y-2.5">
                <li>
                  <button onClick={() => setShowTerms(true)} className="text-[13.5px] font-medium text-white/60 hover:text-white transition-colors">
                    Terms
                  </button>
                </li>
                <li>
                  <button onClick={() => setShowPrivacy(true)} className="text-[13.5px] font-medium text-white/60 hover:text-white transition-colors">
                    Privacy
                  </button>
                </li>
              </ul>
              <p className="mt-6 text-[12px] font-medium text-white/35 leading-relaxed">
                Made for travellers,
                <br />guides and operators.
              </p>
            </nav>
          </div>

          <div className="mt-14 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-[11.5px] font-medium text-white/40">
              © {new Date().getFullYear()} TRAVION. Travel without the uncertainty.
            </p>
            <p className="text-[11.5px] font-medium text-white/40 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-travion-400" />
              Razorpay-secured payments
            </p>
            {/* Hidden access point — see rules around elevate */}
            <button aria-hidden="true" tabIndex={-1} onClick={handleDotClick} className="w-2 h-2 rounded-full opacity-0 hover:opacity-30 transition-opacity" />
          </div>
        </div>
      </footer>

      {/* ══════════════════ AUTH MODAL (traveller flow only) ══════════════════ */}
      <AnimatePresence>
        {showAuthModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto"
            onClick={(e) => e.target === e.currentTarget && setShowAuthModal(false)}
          >
            <div className="fixed inset-0 bg-charcoal-950/60 backdrop-blur-md" />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.45, ease: EASE }}
              role="dialog"
              aria-modal="true"
              aria-label={isLoginMode ? 'Sign in' : 'Create your account'}
              className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-white rounded-[28px] shadow-2xl md:grid md:grid-cols-[0.9fr_1.1fr]"
            >
              {/* Brand panel */}
              <div className="hidden md:flex flex-col justify-between relative overflow-hidden rounded-l-[28px] p-9 bg-travion-900">
                <SafeImg src={HERO_IMAGE} alt="" className="absolute inset-0 w-full h-full object-cover opacity-35" />
                <div className="absolute inset-0 bg-gradient-to-br from-travion-900/90 via-charcoal-950/55 to-travion-800/85" />
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
                    <h3 className="text-xl font-extrabold text-charcoal-900 tracking-tight">
                      {isLoginMode ? 'Sign in' : 'Create your account'}
                    </h3>
                    <p className="text-[12.5px] font-medium text-charcoal-500 mt-1">
                      {isLoginMode ? 'Pick up where you left off.' : 'Start orchestrating your next journey.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAuthModal(false)}
                    aria-label="Close"
                    className="p-2 -m-1 rounded-xl text-charcoal-400 hover:text-charcoal-700 hover:bg-charcoal-50 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Role cards (signup) — separate flows: travellers sign up
                    here; guides use the dedicated Guide Registration page */}
                {!isLoginMode && (
                  <div className="grid grid-cols-1 gap-2.5 mt-6">
                    {([
                      { role: 'USER' as const, icon: <Compass className="w-4 h-4" />, title: 'Traveller', desc: 'Plan and explore trips' },
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
                              : 'border-charcoal-200 hover:border-charcoal-300 bg-white'
                          }`}
                        >
                          <span className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 ${active ? 'bg-travion-600 text-white' : 'bg-charcoal-50 text-charcoal-500'}`}>
                            {opt.icon}
                          </span>
                          <p className={`text-[13px] font-extrabold ${active ? 'text-travion-700' : 'text-charcoal-800'}`}>{opt.title}</p>
                          <p className="text-[11px] font-medium text-charcoal-400 mt-0.5">{opt.desc}</p>
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
                      <Field label="Last name">
                        <input type="text" required placeholder="Sharma" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
                      </Field>
                    </div>
                  )}

                  <Field label="Email address">
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
                      <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} pl-10`} />
                    </div>
                  </Field>

                  <Field label={isLoginMode ? 'Password' : 'Create a strong password'}>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required placeholder="8+ characters with a capital and a number"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${inputCls} pl-10 pr-11`}
                      />
                      <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label="Toggle password visibility" className="absolute right-3 top-1/2 -translate-y-1/2 text-charcoal-400 hover:text-charcoal-600">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </Field>

                  {!isLoginMode && (
                    <>
                      {/* Strength meter */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10.5px] font-black uppercase tracking-wider text-charcoal-400">Password strength</span>
                          <span className={`text-[11px] font-extrabold ${strengthText[strengthIndex]}`}>{strengthLabel}</span>
                        </div>
                        <div className="flex gap-1.5">
                          {[0, 1, 2, 3].map((i) => (
                            <motion.div
                              key={i}
                              animate={{ backgroundColor: i < satisfiedCount ? strengthBar[strengthIndex] : 'rgba(231,235,238,1)' }}
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
                              <span key={r.k} className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10.5px] font-bold border ${ok ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-charcoal-50 text-charcoal-400 border-charcoal-200'}`}>
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
                          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
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
                          <button type="button" onClick={() => setShowConfirmPassword((s) => !s)} aria-label="Toggle confirm password visibility" className="absolute right-3 top-1/2 -translate-y-1/2 text-charcoal-400 hover:text-charcoal-600">
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
                          <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
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
                        <p className="mt-1.5 text-[10.5px] font-semibold text-charcoal-400">
                          Needed for guide coordination and emergencies. Always shown masked (+91 83095****) — never publicly.
                        </p>
                      </Field>
                    </>
                  )}

                  {/* Remember me */}
                  <button type="button" onClick={() => setRememberMe((r) => !r)} className="flex items-center gap-2.5 select-none group w-fit">
                    <span className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center transition-all ${rememberMe ? 'bg-travion-600 border-travion-600' : 'bg-white border-charcoal-300 group-hover:border-charcoal-400'}`}>
                      {rememberMe && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="text-[12px] font-bold text-charcoal-600 group-hover:text-charcoal-800">
                      Remember me
                      <span className="font-medium text-charcoal-400"> · stay signed in on this device</span>
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
                        : 'Create traveller account'}
                  </motion.button>
                </form>

                <p className="mt-5 text-center text-[12.5px] font-semibold text-charcoal-500">
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
            <div className="fixed inset-0 bg-charcoal-950/70 backdrop-blur-lg" />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-7 shadow-2xl border border-charcoal-100"
            >
              <div className="flex items-center gap-3 mb-6">
                <span className="w-10 h-10 rounded-2xl bg-charcoal-900 text-gold-300 flex items-center justify-center">
                  <Key className="w-4.5 h-4.5" />
                </span>
                <div>
                  <h3 className="text-[15px] font-extrabold text-charcoal-900">Authorized operations</h3>
                  <p className="text-[11px] font-semibold text-charcoal-400">Restricted gateway · audited</p>
                </div>
                <button onClick={() => setShowElevateModal(false)} aria-label="Close" className="ml-auto p-1.5 text-charcoal-400 hover:text-charcoal-700 rounded-lg hover:bg-charcoal-50">
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
                    <button type="button" onClick={() => setElevateShowPass((s) => !s)} aria-label="Toggle password visibility" className="absolute right-3 top-1/2 -translate-y-1/2 text-charcoal-400 hover:text-charcoal-600">
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
                  className="w-full h-12 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-bold transition-colors disabled:opacity-45"
                >
                  {isSubmitting ? 'Verifying...' : 'Authenticate'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════════════════ TERMS MODAL ══════════════════ */}
      <AnimatePresence>
        {showTerms && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[75] flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setShowTerms(false)}
          >
            <div className="fixed inset-0 bg-charcoal-950/55 backdrop-blur-md" />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.4, ease: EASE }}
              role="dialog"
              aria-modal="true"
              aria-label="Terms and conditions"
              className="relative w-full max-w-2xl max-h-[86vh] overflow-y-auto bg-white rounded-[28px] shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-charcoal-100 bg-white/95 backdrop-blur px-6 md:px-8 py-4">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center">
                    <Compass className="w-4 h-4 text-white" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-extrabold text-charcoal-900 tracking-tight">Terms &amp; Conditions</h3>
                    <p className="text-[10.5px] font-semibold text-charcoal-400">Travion · last updated February 2026</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowTerms(false)}
                  aria-label="Close terms"
                  className="p-2 rounded-xl text-charcoal-400 hover:text-charcoal-700 hover:bg-charcoal-50 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 md:px-8 py-6 space-y-5">
                {[
                  { t: '1. Acceptance of terms', d: 'By using Travion ("the platform") you agree to these Terms. If you do not agree, please do not use the service. The platform is currently provided for software demonstration and launch evaluation purposes.' },
                  { t: '2. Services we provide', d: 'Travion orchestrates travel journeys: trip planning, verified place discovery, itinerary editing, optional verified-guide coordination, transparent fee calculation via our payment partner Razorpay, live navigation, trip-scoped AI assistance, dynamic replanning and offline trip packages. The platform sells orchestration services, not the transport, stays, food or activities themselves.' },
                  { t: '3. Accounts and eligibility', d: 'You need an account to plan and join trips. You must be at least 18 years old or have a guardian’s consent. You are responsible for keeping your credentials confidential — one account per email, and phone numbers are masked except to staff who need them for coordination and emergencies.' },
                  { t: '4. Payments and fees', d: 'Travion collects the applicable platform fee and, in Guide Mode, the guide fee for your trip. These are computed server-side and shown as a full breakdown before you pay. Your travel budget is an estimate of your overall travel spending and is never charged as a service fee. All payments are processed securely through Razorpay and every payment signature is verified.' },
                  { t: '5. Verification promise', d: 'Places shown on plans are checked against verified local data before they appear. Guides are onboarded, assessed and approved by an operations manager before they can operate. Where data has not yet been verified, the platform says so rather than inventing details.' },
                  { t: '6. Your responsibilities', d: 'You agree to use the platform lawfully, provide accurate information during onboarding, respect the people and places you visit, and not misuse the service to defraud travellers, guides or the platform.' },
                  { t: '7. Liability and disclaimers', d: 'Travion makes reasonable efforts to keep plans and data accurate but does not guarantee third-party services such as transport schedules, property conditions or weather. The platform is not responsible for travel decisions made against verified advisories, nor for losses arising outside the orchestration services it controls.' },
                  { t: '8. Changes and contact', d: 'We may update these Terms as the platform evolves; continuing to use Travion after a change means you accept the revised Terms. Questions about these Terms can be raised through the contact form on this page.' }
                ].map((s) => (
                  <div key={s.t}>
                    <h4 className="text-[13.5px] font-extrabold text-charcoal-900">{s.t}</h4>
                    <p className="mt-1.5 text-[13px] font-medium text-charcoal-500 leading-relaxed">{s.d}</p>
                  </div>
                ))}
                <button
                  onClick={() => { setShowTerms(false); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); }}
                  className="mt-2 inline-flex items-center gap-2 h-11 px-5 rounded-2xl bg-travion-600 text-white text-sm font-bold hover:bg-travion-700 transition-colors"
                >
                  Ask a question
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════════════════ PRIVACY MODAL ══════════════════ */}
      <AnimatePresence>
        {showPrivacy && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[75] flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setShowPrivacy(false)}
          >
            <div className="fixed inset-0 bg-charcoal-950/55 backdrop-blur-md" />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.4, ease: EASE }}
              role="dialog"
              aria-modal="true"
              aria-label="Privacy policy"
              className="relative w-full max-w-2xl max-h-[86vh] overflow-y-auto bg-white rounded-[28px] shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-charcoal-100 bg-white/95 backdrop-blur px-6 md:px-8 py-4">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center">
                    <Compass className="w-4 h-4 text-white" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-extrabold text-charcoal-900 tracking-tight">Privacy Policy</h3>
                    <p className="text-[10.5px] font-semibold text-charcoal-400">Travion · last updated February 2026</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowPrivacy(false)}
                  aria-label="Close privacy policy"
                  className="p-2 rounded-xl text-charcoal-400 hover:text-charcoal-700 hover:bg-charcoal-50 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 md:px-8 py-6 space-y-5">
                {[
                  { t: '1. What we collect', d: 'When you create an account we collect your name, email, phone and basic profile details. Trip planning collects your destination, dates, budget and preferences. Chat messages, support requests and device-reported location during navigation are stored to provide the service you asked for.' },
                  { t: '2. How we use it', d: 'Your data is used to build and coordinate your trip, verify guides, process payments, provide AI trip context, run replanning, support you, and keep the platform safe. We do not sell your personal data.' },
                  { t: '3. Phone numbers and masking', d: 'Phone numbers are required for guide coordination and emergencies. They are displayed masked (for example +91 83095****) to everyone except staff who need the real number to help you, and they are never shown on public profiles.' },
                  { t: '4. Sharing', d: 'We share only what a trip needs: your name, route and preferences with your assigned guide, payment details with our payment provider Razorpay for the transaction, and — only when required — information with relevant authorities. Trip AI memory is isolated per trip.' },
                  { t: '5. Storage and security', d: 'Passwords are hashed, payments go through Razorpay’s verified signatures, and access to staff functions is role-gated and audited. Data is stored on our production database; local demo environments keep their own data.' },
                  { t: '6. Your rights', d: 'You can request a copy of your personal data, ask for corrections, or request deletion of your account and associated trip data. Contact us via the contact form and we will respond within a reasonable time.' },
                  { t: '7. Contact', d: 'For privacy questions or requests, use the contact form on this page or reach Travion directly at support@travion.in. We will verify your identity before acting on account-level requests.' }
                ].map((s) => (
                  <div key={s.t}>
                    <h4 className="text-[13.5px] font-extrabold text-charcoal-900">{s.t}</h4>
                    <p className="mt-1.5 text-[13px] font-medium text-charcoal-500 leading-relaxed">{s.d}</p>
                  </div>
                ))}
                <button
                  onClick={() => { setShowPrivacy(false); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); }}
                  className="mt-2 inline-flex items-center gap-2 h-11 px-5 rounded-2xl bg-travion-600 text-white text-sm font-bold hover:bg-travion-700 transition-colors"
                >
                  Privacy questions
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ── Small shared bits ────────────────────────────────────── */

const inputCls =
  'w-full h-11 px-3.5 rounded-xl border border-charcoal-200 bg-white text-[13.5px] font-semibold text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:border-travion-400 focus:ring-2 focus:ring-travion-100 transition-all';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="block text-[10.5px] font-black uppercase tracking-wider text-charcoal-400 mb-1.5">{label}</span>
    {children}
  </label>
);

const Plus: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M12 5v14" />
  </svg>
);

const Coffee: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
    <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
    <line x1="6" y1="2" x2="6" y2="4" />
    <line x1="10" y1="2" x2="10" y2="4" />
    <line x1="14" y1="2" x2="14" y2="4" />
  </svg>
);

const AlertIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);