import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence, useReducedMotion, useInView, useScroll, useTransform } from 'framer-motion';
import {
  ArrowRight, ArrowUpRight, BadgeCheck, BrainCircuit, Check, CheckCircle2,
  ChevronDown, Clock, Compass, Eye, EyeOff, Globe2, HeartHandshake, IndianRupee, Key,
  Lock, Mail, MapPin, Menu, Mountain, Navigation, Phone, RefreshCw, Route,
  ShieldCheck, Users, Utensils, X, MessagesSquare, Send, Undo2,
} from 'lucide-react';
import { api, authStorage, resolveApiBaseUrl } from '../services/api';
import { TravionLogo, TravionButton } from '../components/ui';
import {
  LANDING_IMAGES, HIGHLIGHT_DESTINATIONS, RAIL_DESTINATIONS, SAMPLE_PLANNER,
  SAMPLE_ITINERARY, TRUST_STRIP, FAQS,
} from '../data/landingData';

interface LandingPageProps {
  onLoginSuccess: (session: any) => void;
  onExploreDemo: () => void;
  onOpenGuideRegistration: () => void;
  onOpenGuideSignIn: () => void;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/* Map preview loads Leaflet only when the section approaches the viewport —
   the landing page never pays for map tiles below the fold on first paint. */
const LandingMapPreview = lazy(() => import('../components/landing/LandingMapPreview'));

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

/* Image with graceful fallback: never a broken tile, never a layout shift. */
const SafeImg: React.FC<{
  src: string; alt: string; className?: string; loading?: 'lazy' | 'eager'; frame?: string;
}> = ({ src, alt, className = '', loading = 'lazy', frame }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div role="img" aria-label={alt} className={`${frame ?? className} img-frame bg-gradient-to-br from-sand-200 via-ivory-200 to-sand-300 flex items-center justify-center`}>
        <MapPin className="w-8 h-8 text-sand-400" aria-hidden />
      </div>
    );
  }
  return (
    <span className={`block overflow-hidden ${frame ?? ''}`}>
      <img src={src} alt={alt} loading={loading} onError={() => setFailed(true)} className={className} />
    </span>
  );
};

const NAV_LINKS = [
  { href: '#explore', label: 'Explore' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#features', label: 'Features' },
  { href: '#about', label: 'About' },
];

const SECTION_IDS = ['top', 'explore', 'features', 'how-it-works', 'map', 'modes', 'assistant', 'today', 'product', 'about', 'faq', 'contact'];

/* ═════════════════════════════════════════════════════════════
   Landing page — complete public reconstruction
═════════════════════════════════════════════════════════════ */

export const LandingPage: React.FC<LandingPageProps> = ({ onLoginSuccess, onExploreDemo, onOpenGuideRegistration, onOpenGuideSignIn }) => {
  const reduceMotion = useReducedMotion();
  const { scrollY } = useScroll();
  const heroParallax = useTransform(scrollY, [0, 900], [0, 170]);
  const heroFade = useTransform(scrollY, [0, 720], [1, 0.94]);

  /* Auth modal state (traveller flow only — guides use the dedicated flow) */
  const [showAuthModal, setShowAuthModal] = useState(false);
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

  const openAuth = (loginMode: boolean) => {
    setIsLoginMode(loginMode);
    setAuthError(null);
    setShowAuthModal(true);
  };

  /* "Become a Guide" MUST open the dedicated Guide Registration flow —
     never the traveller auth modal. */
  const openGuideRegistration = () => onOpenGuideRegistration();

  /* Strong-password helpers */
  const passwordChecks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
  };
  const satisfiedCount = Object.values(passwordChecks).filter(Boolean).length;
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  /* Mandatory phone onboarding: exactly 10 digits, Indian mobile (6-9 start) */
  const phoneDigits = phone.replace(/\D/g, '');
  const phoneValid = /^([6-9]\d{9})$/.test(phoneDigits) || /^91[6-9]\d{9}$/.test(phoneDigits);
  const signupValid = !isLoginMode && Object.values(passwordChecks).every(Boolean) && passwordsMatch && phoneValid;
  const strengthIndex = Math.max(0, Math.min(3, satisfiedCount - 1));
  const strengthBar = ['bg-red-400', 'bg-orange-400', 'bg-amber-400', 'bg-emerald-500'];
  const strengthText = ['text-red-500', 'text-orange-500', 'text-amber-500', 'text-emerald-600'];
  const strengthLabel = ['Too weak', 'Weak', 'Fair', 'Strong'][Math.max(0, satisfiedCount - 1)];

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

  /* Escape closes every overlay; typing T-R-A-V-I-O-N opens the ops gateway */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        setShowAuthModal(false);
        setShowTerms(false);
        setShowPrivacy(false);
      }
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
        : { email: normalizedEmail, password, role: 'USER', first_name: firstName, last_name: lastName, phone: phoneDigits };
      const res = await fetch(`${resolveApiBaseUrl()}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
        body: JSON.stringify({ email: elevateEmail, password: elevatePassword, access_code: accessCode }),
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

  /* Real destination hubs — live from the backend, skeletons while loading */
  const [hubs, setHubs] = useState<{ id: string; name: string; state: string; country: string; description?: string; hero_image?: string; popular_season?: string }[]>([]);
  const [hubsLoading, setHubsLoading] = useState(true);
  const [hubsError, setHubsError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getLocations()
      .then((locs: any[]) => { if (alive) setHubs(locs); })
      .catch(() => { if (alive) setHubsError('Destination hub list is temporarily unavailable.'); })
      .finally(() => { if (alive) setHubsLoading(false); });
    return () => { alive = false; };
  }, []);

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
      setContactError(err?.message || 'We couldn’t send your message. Please try again.');
    }
  };

  /* FAQ accordion */
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  /* How Travion works — five steps */
  const howSteps = [
    { n: '01', icon: <Compass className="w-5 h-5" />, title: 'Tell us about your trip.', text: 'Where from, where to, when, with whom. A short adaptive interview turns your budget and preferences into real planning constraints.' },
    { n: '02', icon: <MapPin className="w-5 h-5" />, title: 'Discover real places.', text: 'Open the live destination map — verified attractions, food, stays, shopping, healthcare and transport, category by category.' },
    { n: '03', icon: <Route className="w-5 h-5" />, title: 'Build your journey.', text: 'Drag your picks into day-by-day plans. The validated engine assigns every date and time — impossible schedules never appear.' },
    { n: '04', icon: <Users className="w-5 h-5" />, title: 'Travel with AI + human support.', text: 'A verified local guide by your side, or the open road with AI planning, navigation and replanning. Your call.' },
    { n: '05', icon: <Navigation className="w-5 h-5" />, title: 'Adapt as you go.', text: 'Weather shifts, plans change, detours happen. Replanning keeps the trip whole — and tells you why it changed.' },
  ] as const;

  return (
    <div className="min-h-screen bg-surface text-charcoal-900 antialiased overflow-x-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:shadow-floating"
      >
        Skip to content
      </a>

      {/* ══════════════════ NAVBAR — floating glass ══════════════════ */}
      <header
        className={`fixed top-0 inset-x-0 z-50 pt-safe transition-all duration-500 ${
          scrolled || mobileOpen ? 'glass-strong shadow-glass border-b border-white/50' : 'bg-transparent'
        }`}
      >
        <div className="container-site">
          <div className={`flex items-center justify-between ${scrolled || mobileOpen ? 'h-16' : 'h-[74px]'} transition-[height] duration-500`}>
            <a href="#top" className="flex items-center" aria-label="Travion home">
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
                    aria-current={active ? 'true' : undefined}
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
                className={`hidden sm:inline-flex btn-press items-center px-4 h-10 rounded-xl text-[13px] font-bold ${
                  scrolled ? 'text-charcoal-700 hover:bg-charcoal-100/60' : 'text-white hover:bg-white/10'
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => openGuideRegistration()}
                className={`hidden md:inline-flex btn-press items-center px-4 h-10 rounded-xl text-[13px] font-bold ${
                  scrolled ? 'text-charcoal-700 hover:bg-charcoal-100/60' : 'text-white hover:bg-white/10'
                }`}
              >
                Become a Guide
              </button>
              <TravionButton
                size="sm"
                variant="primary"
                onClick={() => openAuth(false)}
                className={`hidden sm:inline-flex btn-press ${scrolled ? 'shadow-soft' : 'shadow-floating'}`}
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

      {/* Mobile navigation — polished full-screen glass sheet, bottom anchored */}
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
                  className="h-12 rounded-2xl border border-charcoal-200/80 bg-white/70 text-charcoal-700 font-bold text-sm btn-press"
                >
                  Sign In
                </button>
                <button
                  onClick={() => { setMobileOpen(false); openGuideRegistration(); }}
                  className="h-12 rounded-2xl border border-travion-300 bg-travion-50 text-travion-700 font-bold text-sm hover:bg-travion-100 btn-press"
                >
                  Become a Guide
                </button>
                <button
                  onClick={() => { setMobileOpen(false); openAuth(false); }}
                  className="h-12 rounded-2xl bg-travion-600 text-white font-bold text-sm col-span-2 shadow-soft btn-press"
                >
                  Plan My Trip
                </button>
              </div>
            </motion.nav>
          </div>
        )}
      </AnimatePresence>

      <main id="main">
        {/* ══════════════════ HERO — cinematic, editorial ══════════════════ */}
        <section id="top" className="relative min-h-[100svh] flex flex-col overflow-hidden bg-travion-900" aria-label="Introduction">
          {/* Full-bleed destination imagery with restrained parallax */}
          <div className="absolute inset-0">
            <motion.div
              initial={{ scale: 1.1, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 2.2, ease: EASE }}
              className="absolute inset-0 bg-cover bg-center will-change-transform"
              style={{ backgroundImage: `url(${LANDING_IMAGES.hero})`, y: reduceMotion ? 0 : heroParallax }}
              aria-hidden
            />
            <div className="absolute inset-0 bg-gradient-to-r from-travion-900/90 via-charcoal-950/45 to-travion-800/25" aria-hidden />
            <div className="absolute inset-0 bg-gradient-to-t from-travion-900/95 via-transparent to-travion-900/40" aria-hidden />
          </div>

          <div className="relative flex-1 w-full max-w-7xl mx-auto px-5 md:px-10 pt-[132px] pb-14 grid lg:grid-cols-[1.04fr_0.96fr] items-end gap-12">
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
                  <em className="font-editorial italic font-normal tracking-[-0.01em] bg-clip-text text-transparent bg-gradient-to-r from-ivory-200 via-travion-200 to-gold-200">
                    the uncertainty.
                  </em>
                  <span className="block mt-3 text-[0.42em] leading-snug font-medium tracking-normal text-white/85 max-w-lg normal-case">
                    Plan journeys that adapt to you — real places, real guides, real support.
                  </span>
                </motion.h1>

                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.9, delay: 0.72, ease: EASE }}
                  className="mt-9 flex flex-wrap items-center gap-3.5"
                >
                  <TravionButton
                    size="lg"
                    onClick={() => openAuth(false)}
                    className="bg-travion-500 hover:bg-travion-400 shadow-floating btn-press"
                  >
                    Plan My Trip
                    <ArrowRight className="w-4 h-4" />
                  </TravionButton>
                  <button
                    onClick={() => openGuideRegistration()}
                    className="inline-flex btn-press items-center gap-2 h-12 px-7 rounded-2xl border border-white/25 bg-white/5 backdrop-blur text-white text-sm font-bold hover:bg-white/15 transition-all"
                  >
                    Become a Guide
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                </motion.div>
              </motion.div>
            </div>

            {/* Glass planner preview — every field feeds the real planning flow */}
            <motion.div
              initial={{ opacity: 0, y: 44, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 1, delay: 0.7, ease: EASE }}
              className="w-full max-w-xl lg:ml-auto"
              aria-label="Trip planner preview"
            >
              <div className="glass-strong rounded-[28px] shadow-floating border-white/70 p-6 md:p-7">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-travion-700">Plan the journey</p>
                  <span className="rounded-full bg-travion-50 border border-travion-200 px-2.5 py-1 text-[9.5px] font-black uppercase tracking-widest text-travion-700">
                    Live preview
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div>
                    <p className="text-[9.5px] font-black uppercase tracking-[0.2em] text-charcoal-400">From</p>
                    <p className="text-[15px] font-extrabold text-charcoal-900 leading-tight">{SAMPLE_PLANNER.from.name}</p>
                    <p className="text-[11px] font-semibold text-charcoal-400">{SAMPLE_PLANNER.from.region}</p>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-travion-50 text-travion-600 border border-travion-200" aria-hidden>
                    <ArrowRight className="w-4 h-4" />
                  </span>
                  <div className="text-right">
                    <p className="text-[9.5px] font-black uppercase tracking-[0.2em] text-charcoal-400">To</p>
                    <p className="text-[15px] font-extrabold text-charcoal-900 leading-tight">{SAMPLE_PLANNER.to.name}</p>
                    <p className="text-[11px] font-semibold text-charcoal-400">{SAMPLE_PLANNER.to.region}</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-charcoal-100 pt-4">
                  <div className="rounded-2xl bg-ivory-100 border border-charcoal-100 px-4 py-3">
                    <p className="text-[9.5px] font-black uppercase tracking-[0.2em] text-charcoal-400">Departure</p>
                    <p className="text-[13.5px] font-extrabold text-charcoal-900">{SAMPLE_PLANNER.depart.date} <span className="text-charcoal-500 font-bold">· {SAMPLE_PLANNER.depart.time}</span></p>
                  </div>
                  <div className="rounded-2xl bg-ivory-100 border border-charcoal-100 px-4 py-3">
                    <p className="text-[9.5px] font-black uppercase tracking-[0.2em] text-charcoal-400">Return</p>
                    <p className="text-[13.5px] font-extrabold text-charcoal-900">{SAMPLE_PLANNER.arrive.date} <span className="text-charcoal-500 font-bold">· {SAMPLE_PLANNER.arrive.time}</span></p>
                  </div>
                </div>

                <button
                  onClick={() => openAuth(false)}
                  className="mt-5 w-full h-13 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-extrabold shadow-soft inline-flex items-center justify-center gap-2.5 transition-colors btn-press focus:outline-none focus-visible:ring-4 focus-visible:ring-travion-200"
                  aria-label="Explore my journey — open the trip planner"
                >
                  <Compass className="w-4 h-4" />
                  Explore my journey
                  <ArrowRight className="w-4 h-4" />
                </button>
                <p className="mt-3 text-center text-[10.5px] font-medium text-charcoal-400">
                  Sample route shown — sign in and the real planner opens with your own route.
                </p>
              </div>
            </motion.div>
          </div>

          {/* Scroll indicator */}
          <motion.a
            href="#explore"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.6 }}
            className="relative mx-auto pb-6 flex flex-col items-center gap-1.5 text-white/55 hover:text-white transition-colors"
            aria-label="Scroll to destinations"
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.25em]">Explore</span>
            <motion.span animate={reduceMotion ? undefined : { y: [0, 5, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}>
              <ChevronDown className="w-4 h-4" />
            </motion.span>
          </motion.a>
        </section>

        {/* ══════════════════ TRUST STRIP ══════════════════ */}
        <div aria-label="What Travion stands on" className="relative overflow-hidden border-y border-charcoal-100/70 bg-white">
          <div className="container-site">
            <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 py-5 md:justify-between">
              {TRUST_STRIP.map((item) => (
                <li key={item} className="inline-flex items-center gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gold-400" aria-hidden />
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.3em] text-charcoal-500">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ══════════════════ DESTINATION STORY — editorial collage ══════════════════ */}
        <section id="explore" className="relative py-24 md:py-32 bg-surface" aria-labelledby="explore-title">
          <div className="container-site">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <Reveal>
                <Eyebrow>Explore · Destination stories</Eyebrow>
                <h2 id="explore-title" className="mt-4 text-4xl md:text-6xl font-semibold tracking-[-0.03em] leading-[1.05] text-charcoal-900">
                  Go somewhere
                  <br />
                  <em className="font-editorial font-normal italic text-travion-700">worth remembering.</em>
                </h2>
                <p className="mt-4 max-w-lg text-charcoal-500 font-medium leading-relaxed">
                  Journey through the places TRAVION knows how to plan — then open the live map and
                  build the trip around you.
                </p>
              </Reveal>
              <Reveal delay={0.15} className="shrink-0">
                <button
                  onClick={() => openAuth(false)}
                  className="inline-flex btn-press items-center gap-2 h-11 px-5 rounded-2xl bg-white border border-charcoal-200 text-charcoal-700 text-sm font-bold shadow-soft hover:border-travion-300 hover:text-travion-700 transition-all"
                >
                  Start planning
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              </Reveal>
            </div>

            {/* Editorial collage — one large + four supporting, never a flat grid */}
            <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
              {HIGHLIGHT_DESTINATIONS.map((d, i) => {
                const large = i === 0;
                return (
                  <Reveal key={d.name} delay={Math.min(i * 0.08, 0.3)} className={large ? 'col-span-2 row-span-2' : ''}>
                    <button
                      onClick={() => openAuth(false)}
                      aria-label={`Plan a trip to ${d.name}, ${d.state}`}
                      className={`group relative block w-full overflow-hidden rounded-[26px] text-left shadow-soft hover:shadow-floating transition-shadow focus:outline-none focus-visible:ring-4 focus-visible:ring-travion-200 btn-press ${
                        large ? 'h-64 md:h-[540px]' : 'h-44 md:h-[262px]'
                      }`}
                    >
                      <SafeImg
                        src={d.image}
                        alt={d.alt}
                        frame="absolute inset-0"
                        loading={i === 0 ? 'eager' : 'lazy'}
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1.4s] ease-out group-hover:scale-[1.05]"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-charcoal-950/75 via-charcoal-950/10 to-transparent" aria-hidden />
                      <div className="absolute inset-x-0 bottom-0 p-4 md:p-6">
                        <p className="text-[9.5px] font-bold uppercase tracking-[0.24em] text-gold-200">{d.state}</p>
                        <h3 className={`mt-1 font-extrabold text-white tracking-tight ${large ? 'text-2xl md:text-4xl' : 'text-lg md:text-xl'}`}>{d.name}</h3>
                        {large && <p className="mt-1 text-[13px] font-medium text-white/70">{d.sub}</p>}
                        <span className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-bold text-travion-200 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 transition-all duration-300">
                          Plan this route <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </button>
                  </Reveal>
                );
              })}
            </div>

            {/* Horizontal destination rail — desktop storytelling, mobile swipe */}
            <div className="mt-16">
              <Reveal>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <Eyebrow>Journeys in focus</Eyebrow>
                    <h3 className="mt-3 text-2xl md:text-3xl font-extrabold tracking-tight text-charcoal-900">Swipe through the map.</h3>
                  </div>
                  <p className="hidden md:block text-[11.5px] font-medium text-charcoal-400">Drag or swipe — every card opens the planner.</p>
                </div>
              </Reveal>
              <div className="rail mt-7 lg:grid-cols-4">
                {RAIL_DESTINATIONS.map((d, i) => (
                  <Reveal key={`rail-${d.name}`} delay={Math.min(i * 0.06, 0.3)} className="w-[78vw] max-w-[320px] sm:w-[320px] lg:w-auto">
                    <button
                      onClick={() => openAuth(false)}
                      aria-label={`Plan ${d.sub} in ${d.name}`}
                      className="group relative block h-[340px] w-full overflow-hidden rounded-[24px] text-left shadow-soft hover:shadow-floating transition-shadow focus:outline-none focus-visible:ring-4 focus-visible:ring-travion-200 btn-press"
                    >
                      <SafeImg
                        src={d.image}
                        alt={d.alt}
                        frame="absolute inset-0"
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1.4s] ease-out group-hover:scale-[1.05]"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-charcoal-950/80 via-charcoal-950/15 to-transparent" aria-hidden />
                      <div className="absolute inset-x-0 bottom-0 p-5">
                        <p className="text-[9.5px] font-bold uppercase tracking-[0.24em] text-gold-200">{d.state}</p>
                        <h4 className="mt-1 text-xl font-extrabold text-white tracking-tight">{d.name}</h4>
                        <p className="mt-1 text-[11.5px] font-semibold text-white/70">{d.sub}</p>
                      </div>
                    </button>
                  </Reveal>
                ))}
              </div>
            </div>

            {/* Verified hubs — real backend data */}
            <div className="mt-16">
              <Reveal>
                <p className="text-[12px] font-bold uppercase tracking-[0.22em] text-charcoal-400 mb-5">Verified hubs · real data</p>
              </Reveal>
              {hubsLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-5" aria-live="polite" aria-label="Loading destinations">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-72 rounded-3xl skeleton" />
                  ))}
                </div>
              ) : hubsError ? (
                <div className="rounded-3xl border border-dashed border-charcoal-200 bg-white p-10 text-center" role="status">
                  <p className="text-sm font-bold text-charcoal-600">{hubsError}</p>
                  <p className="mt-1.5 text-xs text-charcoal-400 font-medium">Please try again in a moment.</p>
                </div>
              ) : hubs.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-charcoal-200 bg-white p-10 text-center" role="status">
                  <Globe2 className="w-8 h-8 text-charcoal-300 mx-auto mb-3" aria-hidden />
                  <p className="text-sm font-bold text-charcoal-600">Verified hubs are being onboarded</p>
                  <p className="mt-1.5 text-xs text-charcoal-400 font-medium">Plans are published per destination as their data is verified.</p>
                </div>
              ) : (
                <div className="rail lg:grid-cols-4">
                  {hubs.slice(0, 8).map((hub, i) => (
                    <Reveal key={hub.id} delay={Math.min(i * 0.05, 0.3)} className="w-[78vw] max-w-[300px] sm:w-[300px] lg:w-auto">
                      <button
                        onClick={() => openAuth(false)}
                        aria-label={`Plan a trip to ${hub.name}`}
                        className="group relative block h-[360px] w-full overflow-hidden rounded-[26px] text-left bg-ivory-200 shadow-soft hover:shadow-floating transition-shadow focus:outline-none focus-visible:ring-4 focus-visible:ring-travion-200 btn-press"
                      >
                        {hub.hero_image ? (
                          <SafeImg
                            src={hub.hero_image}
                            alt={`${hub.name}, ${hub.state}`}
                            frame="absolute inset-0"
                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1.4s] ease-out group-hover:scale-[1.06]"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-travion-100 to-travion-200">
                            <MapPin className="w-10 h-10 text-travion-500/60" aria-hidden />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-charcoal-950/80 via-charcoal-950/20 to-transparent" aria-hidden />
                        <div className="absolute inset-x-0 bottom-0 p-5">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="px-2.5 py-1 rounded-full bg-white/15 backdrop-blur text-[9.5px] font-bold uppercase tracking-wider text-white border border-white/20">
                              {hub.country}
                            </span>
                            {hub.popular_season && (
                              <span className="px-2.5 py-1 rounded-full bg-travion-500/80 backdrop-blur text-[9.5px] font-bold text-white">
                                {hub.popular_season}
                              </span>
                            )}
                          </div>
                          <h3 className="text-xl font-extrabold text-white tracking-tight">{hub.name}</h3>
                          <p className="text-[12.5px] font-semibold text-white/70 mt-0.5">{hub.state}</p>
                          <span className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-bold text-travion-200 opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                            Plan this route <ArrowRight className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </button>
                    </Reveal>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ══════════════════ WHY TRAVION — editorial lifecycle ══════════════════ */}
        <section id="features" className="py-24 md:py-32 bg-white" aria-labelledby="features-title">
          <div className="container-site">
            <Reveal className="max-w-3xl mx-auto text-center">
              <div className="flex justify-center"><Eyebrow>Why TRAVION</Eyebrow></div>
              <h2 id="features-title" className="mt-5 text-4xl md:text-6xl font-semibold tracking-[-0.03em] leading-[1.08] text-charcoal-900">
                Travel planning should not
                <br />
                <em className="font-editorial italic font-normal text-travion-700">end</em> when the itinerary is created.
              </h2>
              <p className="mt-5 text-charcoal-500 font-medium leading-relaxed">
                TRAVION stays with the journey — turning a static plan into something that thinks,
                adapts and supports from the first search to the last stop.
              </p>
            </Reveal>

            {/* BEFORE / DURING / AFTER — scroll storytelling */}
            <div className="mt-14 grid gap-6 md:grid-cols-3">
              {[
                {
                  n: '01',
                  phase: 'BEFORE',
                  title: 'AI understands your preferences, budget and destination.',
                  text: 'A short adaptive interview turns how you travel into real scheduling constraints — not generic suggestions.',
                },
                {
                  n: '02',
                  phase: 'DURING',
                  title: 'Your plan adapts while you travel.',
                  text: 'Weather, time changes or a spontaneous detour? Dynamic replanning locks what must stay and re-optimises the rest — with a plain-language reason.',
                },
                {
                  n: '03',
                  phase: 'AFTER',
                  title: 'Your final trip stays organised and accessible.',
                  text: 'Everything — map, itinerary, assistant, offline package — remains available through the whole journey and beyond.',
                },
              ].map((s, i) => (
                <Reveal key={s.n} delay={Math.min(i * 0.1, 0.3)} className="h-full">
                  <div className="group relative h-full overflow-hidden rounded-[26px] border border-charcoal-100 bg-surface p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-soft">
                    <div className="flex items-baseline justify-between">
                      <span className="text-5xl font-extrabold tracking-tight text-charcoal-200/80 transition-colors group-hover:text-travion-200" aria-hidden>{s.n}</span>
                      <span className="text-[10.5px] font-black uppercase tracking-[0.3em] text-sage-600">{s.phase}</span>
                    </div>
                    <div className="mt-6 h-px w-full bg-gradient-to-r from-charcoal-200/70 to-transparent" aria-hidden />
                    <h3 className="mt-6 text-lg font-bold leading-snug text-charcoal-900">{s.title}</h3>
                    <p className="mt-3 text-[13.5px] font-medium leading-relaxed text-charcoal-500">{s.text}</p>
                  </div>
                </Reveal>
              ))}
            </div>

            {/* The contrast: fragmented vs continuous */}
            <div className="mt-16 grid lg:grid-cols-2 gap-10 items-stretch">
              <Reveal>
                <div className="h-full rounded-[26px] border border-charcoal-100 bg-surface p-8 md:p-10">
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-charcoal-400">Before the journey</p>
                  <h3 className="mt-2 text-2xl font-extrabold text-charcoal-800 tracking-tight">Fragmented. Uncertain. Exhausting.</h3>
                  <ul className="mt-7 space-y-4">
                    {['Too many tabs', 'Too many decisions', 'Uncertain places', 'Uncertain schedules', 'Unclear costs'].map((item) => (
                      <li key={item} className="flex items-center gap-3.5">
                        <span className="w-7 h-7 rounded-full bg-charcoal-100 text-charcoal-400 flex items-center justify-center shrink-0" aria-hidden>
                          <X className="w-3.5 h-3.5" />
                        </span>
                        <span className="text-[15px] font-semibold text-charcoal-600">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
              <Reveal delay={0.15}>
                <div className="relative h-full rounded-[26px] bg-charcoal-900 p-8 md:p-10 overflow-hidden">
                  <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full blur-[100px]" style={{ background: 'radial-gradient(circle, rgba(61,148,196,0.35), transparent 65%)' }} aria-hidden />
                  <div className="relative">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gold-300">With TRAVION</p>
                    <h3 className="mt-2 text-2xl font-extrabold text-white tracking-tight">Planned. Verified. Supported.</h3>
                    <div className="mt-8 space-y-0">
                      {[
                        { label: 'Planning', text: 'A journey shaped around you', icon: <Compass className="w-4 h-4" /> },
                        { label: 'Discovery', text: 'Real, verified places on a live map', icon: <MapPin className="w-4 h-4" /> },
                        { label: 'Human support', text: 'Verified local guides when you want them', icon: <HeartHandshake className="w-4 h-4" /> },
                        { label: 'Adaptive itinerary', text: 'A plan that respects time, budget and pace', icon: <Route className="w-4 h-4" /> },
                        { label: 'Live trip', text: 'Navigation, replanning and offline packages', icon: <Navigation className="w-4 h-4" /> },
                        { label: 'AI assistance', text: 'Memory-scoped help throughout the trip', icon: <BrainCircuit className="w-4 h-4" /> },
                      ].map((step, i, arr) => (
                        <div key={step.label} className="relative flex gap-5 pb-8 last:pb-0">
                          {i < arr.length - 1 && <span className="absolute left-[17px] top-9 bottom-0 w-px bg-white/15" aria-hidden />}
                          <span className="relative w-9 h-9 rounded-xl bg-travion-500/20 border border-travion-400/30 text-travion-200 flex items-center justify-center shrink-0" aria-hidden>
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

        {/* ══════════════════ AI + HUMAN CONVERGENCE ══════════════════ */}
        <section className="relative py-24 md:py-32 overflow-hidden bg-surface" aria-labelledby="convergence-title">
          <div className="container-site">
            <Reveal className="max-w-3xl mx-auto text-center">
              <div className="flex justify-center"><Eyebrow>AI + human, together</Eyebrow></div>
              <h2 id="convergence-title" className="mt-5 text-4xl md:text-6xl font-semibold tracking-[-0.03em] leading-[1.08] text-charcoal-900">
                AI handles <em className="font-editorial italic font-normal text-travion-700">the uncertainty.</em>
                <br />
                Humans handle <em className="font-editorial italic font-normal text-sage-600">the moments.</em>
              </h2>
              <p className="mt-5 text-charcoal-500 font-medium leading-relaxed max-w-xl mx-auto">
                The AI runs the planning machinery. Real people — a verified guide, or the assistant
                that knows your trip — carry the experience when it matters.
              </p>
            </Reveal>

            <div className="relative mt-16 grid md:grid-cols-2 gap-6 items-stretch">
              <span aria-hidden className="hidden md:block absolute left-1/2 top-8 bottom-8 w-px bg-gradient-to-b from-transparent via-charcoal-200 to-transparent" />
              <Reveal className="h-full">
                <div className="h-full rounded-[26px] border border-travion-200/70 bg-white p-8 md:p-10">
                  <p className="text-[10.5px] font-black uppercase tracking-[0.3em] text-travion-600">AI</p>
                  <h3 className="mt-2 text-2xl font-bold text-charcoal-900">The planning mind.</h3>
                  <ul className="mt-7 space-y-4">
                    {[
                      { icon: <Compass className="w-4 h-4" />, text: 'Planning — constraints become a real schedule' },
                      { icon: <MapPin className="w-4 h-4" />, text: 'Discovery — verified places on a live map' },
                      { icon: <RefreshCw className="w-4 h-4" />, text: 'Replanning — adapts while you travel, with reasons' },
                      { icon: <Navigation className="w-4 h-4" />, text: 'Navigation — turn-by-turn to your next stop' },
                      { icon: <BrainCircuit className="w-4 h-4" />, text: 'Assistant — memory-scoped to your trip' },
                    ].map((r, i) => (
                      <li key={r.text} className="flex items-start gap-3.5">
                        <span className="w-9 h-9 shrink-0 rounded-2xl bg-travion-50 text-travion-700 flex items-center justify-center" aria-hidden>{r.icon}</span>
                        <span className="pt-1.5 text-[14px] font-semibold text-charcoal-600 leading-relaxed">{r.text}</span>
                        <span className="ml-auto text-[11px] font-black text-charcoal-200" aria-hidden>0{i + 1}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>

              <Reveal delay={0.12} className="h-full">
                <div className="h-full rounded-[26px] border border-sage-200/80 bg-white p-8 md:p-10">
                  <p className="text-[10.5px] font-black uppercase tracking-[0.3em] text-sage-600">Human</p>
                  <h3 className="mt-2 text-2xl font-bold text-charcoal-900">The real-world layer.</h3>
                  <ul className="mt-7 space-y-4">
                    {[
                      { icon: <MapPin className="w-4 h-4" />, text: 'Local knowledge — what maps miss' },
                      { icon: <HeartHandshake className="w-4 h-4" />, text: 'Guidance — a verified guide matched to your route' },
                      { icon: <Users className="w-4 h-4" />, text: 'Context — the story behind each place' },
                      { icon: <MessagesSquare className="w-4 h-4" />, text: 'Support — direct chat after assignment' },
                      { icon: <ShieldCheck className="w-4 h-4" />, text: 'Real-world help — from arrival to the last stop' },
                    ].map((r, i) => (
                      <li key={r.text} className="flex items-start gap-3.5">
                        <span className="w-9 h-9 shrink-0 rounded-2xl bg-sage-100 text-sage-700 flex items-center justify-center" aria-hidden>{r.icon}</span>
                        <span className="pt-1.5 text-[14px] font-semibold text-charcoal-600 leading-relaxed">{r.text}</span>
                        <span className="ml-auto text-[11px] font-black text-charcoal-200" aria-hidden>0{i + 1}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ══════════════════ HOW TRAVION WORKS — five steps ══════════════════ */}
        <section id="how-it-works" className="py-24 md:py-32 bg-white" aria-labelledby="how-title">
          <div className="container-site">
            <Reveal className="text-center max-w-2xl mx-auto">
              <div className="flex justify-center"><Eyebrow>How it works</Eyebrow></div>
              <h2 id="how-title" className="mt-4 text-4xl md:text-5xl font-semibold tracking-[-0.025em] leading-[1.06] text-charcoal-900">
                From first idea to the open road.
              </h2>
              <p className="mt-4 text-charcoal-500 font-medium leading-relaxed">
                Five steps. One continuous journey. Every screen connected to real functionality.
              </p>
            </Reveal>

            <div className="relative mt-16">
              <span className="absolute left-5 md:left-1/2 top-0 bottom-0 w-px bg-charcoal-200 hidden md:block" aria-hidden />
              <div className="space-y-10">
                {howSteps.map((s, i) => (
                  <Reveal key={s.n} delay={Math.min(i * 0.05, 0.25)}>
                    <div className={`md:grid md:grid-cols-2 md:gap-14 items-center ${i % 2 === 1 ? 'md:text-right' : ''}`}>
                      <div className={`md:relative flex items-center gap-5 ${i % 2 === 1 ? 'md:order-2' : ''}`}>
                        <span className="relative z-10 shrink-0 w-12 h-12 rounded-2xl bg-travion-600 text-white flex items-center justify-center shadow-soft" aria-hidden>
                          {s.icon}
                        </span>
                        <div className="flex-1">
                          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold-500">{s.n}</p>
                          <h3 className="mt-1 text-xl md:text-2xl font-extrabold text-charcoal-900 tracking-tight">{s.title}</h3>
                          <p className={`mt-2 text-[13.5px] font-medium text-charcoal-500 leading-relaxed ${i % 2 === 1 ? 'md:ml-auto' : ''} max-w-md`}>{s.text}</p>
                        </div>
                      </div>
                      <div className={`hidden md:block ${i % 2 === 1 ? 'md:order-1' : ''}`}>
                        <div className={`flex items-center gap-2 ${i % 2 === 1 ? 'md:justify-end' : ''}`}>
                          <span className="font-editorial italic text-lg text-charcoal-300">step</span>
                          <span className="text-6xl font-extrabold text-charcoal-100 leading-none" aria-hidden>{s.n}</span>
                        </div>
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════════ INTERACTIVE MAP PREVIEW — real Leaflet ══════════════════ */}
        <section id="map" ref={useRef<HTMLElement>(null) as React.RefObject<HTMLElement>} className="py-24 md:py-32 bg-surface" aria-labelledby="map-title">
          <div className="container-site">
            <Reveal className="max-w-2xl">
              <Eyebrow>Live map · Product preview</Eyebrow>
              <h2 id="map-title" className="mt-4 text-4xl md:text-5xl font-semibold tracking-[-0.025em] leading-[1.06] text-charcoal-900">
                Your journey,
                <br />
                <em className="font-editorial italic font-normal text-travion-700">mapped around you.</em>
              </h2>
              <p className="mt-5 text-charcoal-500 font-medium leading-relaxed">
                This is the real map surface — live tiles, real geography around Munnar, and the same
                marker-to-card sync you use while planning.
              </p>
            </Reveal>

            <Reveal delay={0.15} className="mt-12">
              <MapPreviewLazy openAuth={openAuth} />
            </Reveal>
          </div>
        </section>

        {/* ══════════════════ ITINERARY PREVIEW ══════════════════ */}
        <section id="itinerary" className="py-24 md:py-32 bg-white" aria-labelledby="itin-title">
          <div className="container-site">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <Reveal>
                <Eyebrow>Itinerary · Product preview</Eyebrow>
                <h2 id="itin-title" className="mt-4 text-4xl md:text-5xl font-semibold tracking-[-0.025em] leading-[1.06] text-charcoal-900">
                  A plan that reads like a <em className="font-editorial italic font-normal text-travion-700">travel journal.</em>
                </h2>
                <p className="mt-5 text-charcoal-500 font-medium leading-relaxed max-w-md">
                  Day by day, stop by stop — every time assigned by the validated engine, every stop
                  editable with drag-and-drop and undo.
                </p>
                <div className="mt-8 flex flex-wrap gap-2.5">
                  {['Drag & drop', 'Time editing', 'Undo', 'Travel time between stops', 'Validated dates'].map((t) => (
                    <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-charcoal-200 bg-surface px-3.5 py-1.5 text-[11px] font-bold text-charcoal-600">
                      <Check className="w-3 h-3 text-travion-600" /> {t}
                    </span>
                  ))}
                </div>
              </Reveal>

              <Reveal delay={0.15}>
                <div className="relative max-w-md lg:ml-auto">
                  <div className="absolute -inset-3 rounded-[32px] bg-gradient-to-br from-travion-100/70 via-gold-100/30 to-transparent blur-xl" aria-hidden />
                  <div className="relative rounded-[28px] border border-charcoal-100 bg-surface shadow-soft-lg overflow-hidden">
                    <div className="flex items-center justify-between px-6 py-5 border-b border-charcoal-100 bg-white/70">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-travion-600">{SAMPLE_ITINERARY.day}</p>
                        <p className="text-xl font-extrabold text-charcoal-900">{SAMPLE_ITINERARY.date}</p>
                      </div>
                      <span className="px-3 py-1 rounded-full bg-gold-50 border border-gold-200 text-gold-500 text-[9.5px] font-black uppercase tracking-wider">Sample plan</span>
                    </div>
                    <div className="p-6 relative">
                      <span className="absolute left-[31px] top-10 bottom-10 w-px bg-charcoal-100" aria-hidden />
                      {SAMPLE_ITINERARY.rows.map((row) => (
                        <div key={row.time} className="relative flex gap-5 pb-5 last:pb-0">
                          <span className="relative z-10 w-12 h-12 rounded-2xl bg-travion-50 border border-travion-200 text-travion-700 flex items-center justify-center shrink-0" aria-hidden>
                            <Clock className="w-4 h-4" />
                          </span>
                          <div className="pt-1">
                            <p className="text-[12px] font-black text-charcoal-400">{row.time}</p>
                            <p className="text-[15px] font-extrabold text-charcoal-900">{row.title}</p>
                            <p className="text-[11.5px] font-medium text-charcoal-400">{row.note}</p>
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

        {/* ══════════════════ MODES — guide & adventurous ══════════════════ */}
        <section id="modes" className="py-24 md:py-32 bg-surface" aria-labelledby="modes-title">
          <div className="container-site">
            <Reveal className="max-w-2xl">
              <Eyebrow>Two ways to travel</Eyebrow>
              <h2 id="modes-title" className="mt-4 text-4xl md:text-5xl font-semibold tracking-[-0.025em] leading-[1.06] text-charcoal-900">
                Human care, or the open road — with AI beside you.
              </h2>
            </Reveal>

            <div className="mt-14 grid md:grid-cols-2 gap-6">
              {/* Guide Mode */}
              <Reveal>
                <div className="group relative overflow-hidden rounded-[26px] bg-charcoal-900 text-white p-8 min-h-[500px] flex flex-col">
                  <SafeImg src={LANDING_IMAGES.guide} alt="Travellers walking a mountain trail with a local guide" className="absolute inset-0 w-full h-full object-cover opacity-25 transition-transform duration-[1.4s] ease-out group-hover:scale-[1.05]" />
                  <div className="absolute inset-0 bg-gradient-to-b from-charcoal-950/70 via-transparent to-charcoal-950/90" aria-hidden />
                  <div className="relative z-10 flex-1 flex flex-col">
                    <div className="flex items-center gap-2.5">
                      <span className="px-3 py-1 rounded-full bg-gold-400/90 text-charcoal-900 text-[10px] font-black uppercase tracking-wider">Guide mode</span>
                      <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-ivory-200/80"><BadgeCheck className="w-3.5 h-3.5" /> Verified local guides</span>
                    </div>
                    <h3 className="mt-5 text-3xl font-extrabold tracking-tight">Sometimes, the best route is a local one.</h3>
                    <ul className="mt-6 space-y-3.5">
                      {[
                        'Verified local guide matched to your route',
                        'On-ground support through the whole trip',
                        'Direct chat with your guide after assignment',
                        'Local knowledge layered onto your AI plan',
                      ].map((b) => (
                        <li key={b} className="flex items-start gap-2.5 text-[13.5px] font-medium text-white/85">
                          <Check className="w-4 h-4 text-gold-300 mt-0.5 shrink-0" /> {b}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto pt-7">
                      <p className="text-[12px] font-medium text-white/60">
                        Guide fee + platform fee — both shown upfront, computed server-side.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          onClick={() => openGuideRegistration()}
                          className="inline-flex btn-press items-center gap-2 h-11 px-5 rounded-2xl bg-white/95 hover:bg-white text-charcoal-900 text-sm font-bold transition-all hover:-translate-y-px"
                        >
                          Become a Guide
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                        <a
                          href="#guide-network"
                          className="inline-flex btn-press items-center gap-2 h-11 px-5 rounded-2xl border border-white/25 bg-white/5 backdrop-blur text-white text-sm font-bold hover:bg-white/15 transition-all"
                        >
                          Explore Guide Mode
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>

              {/* Adventurous Mode */}
              <Reveal delay={0.12}>
                <div className="group relative overflow-hidden rounded-[26px] bg-white border border-charcoal-100 p-8 min-h-[500px] flex flex-col">
                  <SafeImg src={LANDING_IMAGES.adventure} alt="A hiker pausing on a ridge above the valley" className="absolute inset-0 w-full h-full object-cover opacity-15 transition-transform duration-[1.4s] ease-out group-hover:scale-[1.05]" />
                  <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/30 to-surface/95" aria-hidden />
                  <div className="relative z-10 flex-1 flex flex-col">
                    <div className="flex items-center gap-2.5">
                      <span className="px-3 py-1 rounded-full bg-travion-600 text-white text-[10px] font-black uppercase tracking-wider">Adventurous mode</span>
                      <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-charcoal-500"><BrainCircuit className="w-3.5 h-3.5" /> AI by your side</span>
                    </div>
                    <h3 className="mt-5 text-3xl font-extrabold tracking-tight text-charcoal-900">Your journey. Your rules.</h3>
                    <ul className="mt-6 space-y-3.5">
                      {[
                        'Full AI-planned journey, no guide fee',
                        'Live map, navigation and AI assistant included',
                        'Dynamic replanning whenever conditions change',
                        'Local discovery and safety information built in',
                      ].map((b) => (
                        <li key={b} className="flex items-start gap-2.5 text-[13.5px] font-medium text-charcoal-600">
                          <Check className="w-4 h-4 text-travion-600 mt-0.5 shrink-0" /> {b}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto pt-7">
                      <p className="text-[12px] font-medium text-charcoal-400">
                        Platform fee only — never a guide fee you don’t ask for.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          onClick={() => openAuth(false)}
                          className="inline-flex btn-press items-center gap-2 h-11 px-5 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-bold transition-all hover:-translate-y-px"
                        >
                          Plan Independently
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ══════════════════ AI ASSISTANT PREVIEW ══════════════════ */}
        <section id="assistant" className="py-24 md:py-32 bg-white" aria-labelledby="assistant-title">
          <div className="container-site">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <Reveal delay={0.1} className="order-2 lg:order-1">
                <div className="relative max-w-md">
                  <div className="absolute -inset-3 rounded-[32px] bg-gradient-to-br from-travion-100/70 via-gold-100/30 to-transparent blur-xl" aria-hidden />
                  <div className="relative rounded-[28px] border border-charcoal-100 bg-surface shadow-soft-lg overflow-hidden">
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-charcoal-100 bg-white/70">
                      <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center" aria-hidden>
                        <BrainCircuit className="w-4 h-4 text-white" />
                      </span>
                      <div>
                        <p className="text-[13.5px] font-extrabold text-charcoal-800">TRAVION AI</p>
                        <p className="text-[10.5px] font-semibold text-charcoal-400">Trip-scoped memory · your trip only</p>
                      </div>
                      <span className="ml-auto text-[9px] font-bold uppercase tracking-widest text-gold-500">Product preview</span>
                    </div>
                    <div className="space-y-3.5 p-5">
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-travion-600 text-white px-4 py-2.5 text-[13px] font-medium leading-relaxed shadow-soft">
                          What should I do next?
                        </div>
                      </div>
                      <div className="flex justify-start">
                        <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-white border border-charcoal-100 px-4 py-2.5 text-[13px] font-medium leading-relaxed text-charcoal-700 shadow-soft">
                          You have <span className="font-bold text-charcoal-900">2 hours</span> before your next activity. There is a
                          verified viewpoint <span className="font-bold text-travion-700">1.2 km away</span> — golden light around
                          5:30 PM if you want the photo.
                        </div>
                      </div>
                      <div className="flex justify-start">
                        <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-white border border-charcoal-100 px-4 py-2.5 text-[13px] font-medium leading-relaxed text-charcoal-700 shadow-soft">
                          Want me to hold your current plan, or find a café on the way?
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>

              <Reveal className="order-1 lg:order-2">
                <Eyebrow>AI assistant</Eyebrow>
                <h2 id="assistant-title" className="mt-4 text-4xl md:text-5xl font-semibold tracking-[-0.025em] leading-[1.06] text-charcoal-900">
                  An assistant that knows <em className="font-editorial font-normal italic">your</em> trip.
                </h2>
                <p className="mt-5 text-charcoal-500 font-medium leading-relaxed max-w-md">
                  Every trip gets its own isolated memory. Ask what’s next, where to eat, or how to
                  adjust a day — the assistant answers from your verified itinerary, never from
                  somewhere else.
                </p>
                <div className="mt-8 space-y-3">
                  {[
                    { icon: <RefreshCw className="w-4 h-4" />, text: 'Replans only your flexible parts — with a plain-language reason' },
                    { icon: <Clock className="w-4 h-4" />, text: 'Times come from the validated engine, never guessed schedules' },
                    { icon: <Lock className="w-4 h-4" />, text: 'Nothing leaks between trips; memory is scoped per journey' },
                  ].map((row) => (
                    <div key={row.text} className="flex items-start gap-3 text-[13.5px] font-medium text-charcoal-600">
                      <span className="w-8 h-8 rounded-xl bg-travion-50 text-travion-700 flex items-center justify-center shrink-0" aria-hidden>{row.icon}</span>
                      {row.text}
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ══════════════════ ACTIVE TRIP PREVIEW ══════════════════ */}
        <section id="today" className="py-24 md:py-32 bg-travion-900 text-white" aria-labelledby="today-title">
          <div className="container-site">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <Reveal>
                <Eyebrow light>Live trip · Product preview</Eyebrow>
                <h2 id="today-title" className="mt-4 text-4xl md:text-5xl font-semibold tracking-[-0.025em] leading-[1.06]">
                  The day you actually <em className="font-editorial font-normal italic text-gold-300">travel</em>.
                </h2>
                <p className="mt-5 text-white/70 font-medium leading-relaxed max-w-md">
                  After payment is verified, your journey becomes a live dashboard — today’s itinerary,
                  the map, your assistant, navigation, your guide and emergency info, all in one place.
                </p>
                <div className="mt-8 flex flex-wrap gap-2.5">
                  {['Today', 'Map', 'AI assistant', 'Navigation', 'Guide', 'Emergency'].map((t) => (
                    <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3.5 py-1.5 text-[11px] font-bold text-white/85">
                      {t}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => openAuth(true)}
                  className="mt-8 inline-flex btn-press items-center gap-2 h-12 px-6 rounded-2xl bg-white text-charcoal-900 text-sm font-extrabold hover:bg-ivory-100 transition-all hover:-translate-y-0.5 shadow-floating"
                >
                  Open Trip
                  <ArrowRight className="w-4 h-4" />
                </button>
                <p className="mt-3 text-[11px] font-medium text-white/50">Sign in to open your live trip — new here? Creating an account takes a minute.</p>
              </Reveal>

              <Reveal delay={0.15}>
                <div className="relative">
                  <div className="absolute -inset-3 rounded-[32px] bg-gradient-to-br from-travion-500/30 to-transparent blur-xl" aria-hidden />
                  <div className="relative rounded-[28px] bg-white/95 shadow-floating overflow-hidden text-charcoal-900">
                    <div className="flex items-center justify-between px-6 py-5 border-b border-charcoal-100">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-travion-600">Munnar · Day 2 of 4</p>
                        <p className="text-xl font-extrabold text-charcoal-900">Good morning, traveller</p>
                      </div>
                      <span className="px-3 py-1 rounded-full bg-gold-50 border border-gold-200 text-gold-500 text-[9.5px] font-black uppercase tracking-wider">Preview</span>
                    </div>
                    <div className="p-6">
                      <p className="text-[10.5px] font-black uppercase tracking-[0.22em] text-charcoal-400">Next</p>
                      <div className="mt-3 flex items-center gap-4 rounded-2xl border border-travion-200 bg-travion-50 px-5 py-4">
                        <span className="w-12 h-12 rounded-2xl bg-travion-600 text-white flex items-center justify-center shrink-0" aria-hidden>
                          <Mountain className="w-5 h-5" />
                        </span>
                        <div>
                          <p className="text-[15px] font-extrabold text-charcoal-900">Sunset viewpoint</p>
                          <p className="text-[12px] font-bold text-charcoal-500">5:30 PM · 1.8 km away</p>
                        </div>
                        <Navigation className="ml-auto w-5 h-5 text-travion-600" aria-hidden />
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3">
                        {[
                          { icon: <Clock className="w-4 h-4" />, label: 'Local time', value: '4:12 PM' },
                          { icon: <Route className="w-4 h-4" />, label: 'Trip done', value: 'Day 2 / 4' },
                          { icon: <Utensils className="w-4 h-4" />, label: 'After next', value: 'Dinner 7:45' },
                        ].map((c) => (
                          <div key={c.label} className="rounded-2xl border border-charcoal-100 bg-white px-3.5 py-3">
                            <span className="text-travion-600" aria-hidden>{c.icon}</span>
                            <p className="mt-1.5 text-[13px] font-extrabold text-charcoal-900 leading-tight">{c.value}</p>
                            <p className="text-[9.5px] font-bold uppercase tracking-wider text-charcoal-400">{c.label}</p>
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

        {/* ══════════════════ BENTO — product experience ══════════════════ */}
        <section id="product" className="py-24 md:py-32 bg-white" aria-labelledby="bento-title">
          <div className="container-site">
            <Reveal className="max-w-2xl">
              <Eyebrow>One product · every layer</Eyebrow>
              <h2 id="bento-title" className="mt-4 text-4xl md:text-5xl font-semibold tracking-[-0.025em] leading-[1.06] text-charcoal-900">
                Everything a journey needs, <em className="font-editorial italic font-normal text-travion-700">nothing it doesn’t.</em>
              </h2>
            </Reveal>

            <div className="mt-12 grid gap-4 md:gap-5 md:grid-cols-3 lg:grid-cols-4">
              <Reveal className="md:col-span-2 lg:col-span-2 md:row-span-2">
                <a
                  href="#map"
                  className="group relative flex h-64 md:h-full min-h-[320px] flex-col justify-between overflow-hidden rounded-[26px] bg-charcoal-900 p-7 text-white shadow-soft hover:shadow-floating transition-shadow btn-press focus:outline-none focus-visible:ring-4 focus-visible:ring-travion-200"
                >
                  <SafeImg src={LANDING_IMAGES.road} alt="A mountain road winding through the highlands at golden hour" className="absolute inset-0 h-full w-full object-cover opacity-40 transition-transform duration-[1.4s] ease-out group-hover:scale-[1.04]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-charcoal-950/85 via-charcoal-950/30 to-transparent" aria-hidden />
                  <span className="relative text-[10px] font-black uppercase tracking-[0.28em] text-gold-300">Live map</span>
                  <div className="relative">
                    <h3 className="text-2xl font-extrabold tracking-tight">Nine categories of verified places, one map.</h3>
                    <p className="mt-2 text-[13px] font-medium text-white/70 max-w-sm">Attractions, food, stays, shopping, healthcare, education, transport — synced card to marker.</p>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-bold text-travion-200">See the map <ArrowRight className="w-3.5 h-3.5" /></span>
                  </div>
                </a>
              </Reveal>

              <Reveal delay={0.08} className="lg:col-span-2">
                <a
                  href="#assistant"
                  className="group flex h-full min-h-[150px] flex-col justify-between overflow-hidden rounded-[26px] border border-travion-200/70 bg-travion-50 p-6 shadow-soft hover:shadow-soft-lg transition-shadow btn-press focus:outline-none focus-visible:ring-4 focus-visible:ring-travion-200"
                >
                  <span className="w-10 h-10 rounded-2xl bg-travion-600 text-white flex items-center justify-center" aria-hidden><BrainCircuit className="w-5 h-5" /></span>
                  <div className="mt-4">
                    <h3 className="text-[16px] font-extrabold text-charcoal-900">AI assistant</h3>
                    <p className="mt-1 text-[12.5px] font-medium text-charcoal-500">Trip-scoped memory, replanning with reasons, answers from your itinerary.</p>
                  </div>
                </a>
              </Reveal>

              <Reveal delay={0.12}>
                <a
                  href="#today"
                  className="group flex h-full min-h-[150px] flex-col justify-between overflow-hidden rounded-[26px] bg-charcoal-900 p-6 text-white shadow-soft hover:shadow-soft-lg transition-shadow btn-press focus:outline-none focus-visible:ring-4 focus-visible:ring-travion-200"
                >
                  <span className="w-10 h-10 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center" aria-hidden><Navigation className="w-5 h-5 text-travion-200" /></span>
                  <div className="mt-4">
                    <h3 className="text-[16px] font-extrabold">Live trip</h3>
                    <p className="mt-1 text-[12.5px] font-medium text-white/60">Today’s plan, next stop, navigation and emergency info.</p>
                  </div>
                </a>
              </Reveal>

              <Reveal delay={0.16}>
                <div className="flex h-full min-h-[150px] flex-col justify-between overflow-hidden rounded-[26px] border border-sage-200/80 bg-sage-100/60 p-6 shadow-soft">
                  <span className="w-10 h-10 rounded-2xl bg-white text-sage-700 flex items-center justify-center shadow-soft" aria-hidden><BadgeCheck className="w-5 h-5" /></span>
                  <div className="mt-4">
                    <h3 className="text-[16px] font-extrabold text-charcoal-900">Verified places</h3>
                    <p className="mt-1 text-[12.5px] font-medium text-charcoal-500">Data checked before it appears — or labelled honestly.</p>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={0.2} className="md:col-span-2">
                <a
                  href="#guide-network"
                  className="group flex h-full min-h-[150px] flex-col justify-between overflow-hidden rounded-[26px] border border-charcoal-100 bg-surface p-6 shadow-soft hover:shadow-soft-lg transition-shadow btn-press focus:outline-none focus-visible:ring-4 focus-visible:ring-travion-200"
                >
                  <span className="w-10 h-10 rounded-2xl bg-gold-100 text-gold-500 flex items-center justify-center" aria-hidden><HeartHandshake className="w-5 h-5" /></span>
                  <div className="mt-4">
                    <h3 className="text-[16px] font-extrabold text-charcoal-900">Human guides</h3>
                    <p className="mt-1 text-[12.5px] font-medium text-charcoal-500">Onboarded, assessed and manager-approved before they ever meet a traveller.</p>
                  </div>
                </a>
              </Reveal>

              <Reveal delay={0.24} className="md:col-span-3 lg:col-span-3">
                <div className="flex h-full min-h-[120px] flex-col justify-center overflow-hidden rounded-[26px] border border-charcoal-100 bg-white p-6 shadow-soft md:flex-row md:items-center md:gap-6">
                  <span className="w-10 h-10 rounded-2xl bg-travion-50 text-travion-700 flex items-center justify-center shrink-0" aria-hidden><ShieldCheck className="w-5 h-5" /></span>
                  <div className="mt-3 md:mt-0">
                    <h3 className="text-[16px] font-extrabold text-charcoal-900">Secure payments</h3>
                    <p className="mt-1 text-[12.5px] font-medium text-charcoal-500">Razorpay checkout with server-verified signatures. Fees shown in full before you pay.</p>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ══════════════════ GUIDE NETWORK ══════════════════ */}
        <section id="guide-network" className="py-24 md:py-32 bg-charcoal-900 text-white" aria-labelledby="guide-title">
          <div className="container-site grid lg:grid-cols-2 gap-12 items-center">
            <Reveal>
              <Eyebrow light>Guide network</Eyebrow>
              <h2 id="guide-title" className="mt-4 text-4xl md:text-5xl font-semibold tracking-[-0.025em] leading-[1.06]">
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
                  { icon: <WalletIcon />, text: 'Transparent fees with settled payouts you can track' },
                  { icon: <MessagesSquare className="w-4 h-4" />, text: 'Direct traveller chat from assignment to completion' },
                ].map((row) => (
                  <div key={row.text} className="flex items-start gap-3 text-[13.5px] font-medium text-white/75">
                    <span className="text-gold-300 mt-0.5" aria-hidden>{row.icon}</span>
                    {row.text}
                  </div>
                ))}
              </div>
              <div className="mt-9 flex flex-wrap gap-3">
                <button
                  onClick={() => openGuideRegistration()}
                  className="inline-flex btn-press items-center gap-2 h-12 px-6 rounded-2xl bg-gold-400 hover:bg-gold-300 text-charcoal-900 text-sm font-black transition-all hover:-translate-y-0.5"
                >
                  Become a Guide
                  <ArrowUpRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onOpenGuideSignIn()}
                  className="inline-flex btn-press items-center h-12 px-6 rounded-2xl border border-white/25 bg-white/5 backdrop-blur text-white text-sm font-bold hover:bg-white/15 transition-all"
                >
                  Guide Sign In
                </button>
              </div>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="grid grid-cols-2 gap-5">
                {[
                  { icon: <BadgeCheck className="w-5 h-5" />, title: 'Onboarding', text: 'Profile, languages, destinations, experience' },
                  { icon: <ShieldCheck className="w-5 h-5" />, title: 'Assessment', text: 'Destination knowledge + safety scenarios' },
                  { icon: <Users className="w-5 h-5" />, title: 'Approval', text: 'Manager verifies before you can operate' },
                  { icon: <Route className="w-5 h-5" />, title: 'Matching', text: 'Ranked against the trips you know best' },
                ].map((c) => (
                  <div key={c.title} className="rounded-[22px] bg-white/5 border border-white/10 backdrop-blur p-5">
                    <span className="w-10 h-10 rounded-xl bg-travion-500/20 text-travion-200 flex items-center justify-center" aria-hidden>{c.icon}</span>
                    <h3 className="mt-3 text-[14px] font-extrabold">{c.title}</h3>
                    <p className="mt-1 text-[11.5px] font-medium text-white/55">{c.text}</p>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* ══════════════════ ABOUT ══════════════════ */}
        <section id="about" className="py-24 md:py-32 bg-white" aria-labelledby="about-title">
          <div className="container-site grid lg:grid-cols-2 gap-12 items-center">
            <Reveal>
              <Eyebrow>About</Eyebrow>
              <h2 id="about-title" className="mt-4 text-4xl md:text-5xl font-semibold tracking-[-0.025em] leading-[1.06] text-charcoal-900">
                Why TRAVION exists.
              </h2>
              <p className="mt-5 text-charcoal-500 font-medium leading-relaxed max-w-md">
                Travel planning is fragmented across a dozen tabs — discovery, bookings, budgets,
                itineraries, directions, support. TRAVION connects them into one continuous journey,
                so the person planning can focus on the trip, not the tooling.
              </p>
              <div className="mt-8 grid grid-cols-2 gap-3">
                {['Discovery', 'Planning', 'Budget', 'Itinerary', 'Human support', 'Navigation', 'AI assistance', 'Live replanning'].map((c) => (
                  <div key={c} className="flex items-center gap-2.5 rounded-2xl border border-charcoal-100 bg-surface px-4 py-3">
                    <CheckCircle2 className="w-4 h-4 text-travion-600 shrink-0" aria-hidden />
                    <span className="text-[13px] font-bold text-charcoal-700">{c}</span>
                  </div>
                ))}
              </div>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="relative">
                <div className="absolute -inset-3 rounded-[32px] bg-gradient-to-br from-travion-100/70 via-gold-100/30 to-transparent blur-xl" aria-hidden />
                <div className="relative overflow-hidden rounded-[28px] shadow-soft-lg">
                  <SafeImg src={LANDING_IMAGES.planners} alt="Travellers planning a route together over a map" className="h-[420px] md:h-[480px] w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-charcoal-950/60 via-transparent to-transparent" aria-hidden />
                  <div className="absolute bottom-6 left-6 right-6">
                    <p className="text-white text-sm font-medium leading-relaxed max-w-sm">
                      “We build the planning layer so a traveller can stay in one journey — from first
                      idea to the last stop.”
                    </p>
                    <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/60">The TRAVION team</p>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ══════════════════ FAQ ══════════════════ */}
        <section id="faq" className="py-24 md:py-32 bg-surface" aria-labelledby="faq-title">
          <div className="max-w-3xl mx-auto px-5 md:px-10">
            <Reveal className="text-center">
              <div className="flex justify-center"><Eyebrow>Questions</Eyebrow></div>
              <h2 id="faq-title" className="mt-4 text-4xl md:text-5xl font-semibold tracking-[-0.025em] leading-[1.06] text-charcoal-900">
                Frequently asked
              </h2>
            </Reveal>
            <div className="mt-10 space-y-3">
              {FAQS.map((f, i) => {
                const open = openFaq === i;
                return (
                  <Reveal key={f.q} delay={Math.min(i * 0.03, 0.2)}>
                    <div className={`rounded-2xl border transition-all duration-300 ${open ? 'border-travion-200 bg-white shadow-soft' : 'border-charcoal-100 bg-white'}`}>
                      <h3>
                        <button
                          onClick={() => setOpenFaq(open ? null : i)}
                          aria-expanded={open}
                          aria-controls={`faq-panel-${i}`}
                          id={`faq-button-${i}`}
                          className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left focus:outline-none focus-visible:ring-4 focus-visible:ring-travion-200 rounded-2xl"
                        >
                          <span className={`text-[15px] font-extrabold ${open ? 'text-travion-700' : 'text-charcoal-800'}`}>{f.q}</span>
                          <motion.span
                            animate={{ rotate: open ? 45 : 0 }}
                            transition={{ duration: 0.3 }}
                            className="shrink-0 w-8 h-8 rounded-xl bg-surface flex items-center justify-center text-charcoal-600"
                            aria-hidden
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                              <path d="M5 12h14M12 5v14" />
                            </svg>
                          </motion.span>
                        </button>
                      </h3>
                      <AnimatePresence initial={false}>
                        {open && (
                          <motion.div
                            id={`faq-panel-${i}`}
                            role="region"
                            aria-labelledby={`faq-button-${i}`}
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

        {/* ══════════════════ CONTACT ══════════════════ */}
        <section id="contact" className="py-24 md:py-32 bg-surface" aria-labelledby="contact-title">
          <div className="container-site grid lg:grid-cols-[0.9fr_1.1fr] gap-12 items-start">
            <Reveal>
              <Eyebrow>Contact</Eyebrow>
              <h2 id="contact-title" className="mt-4 text-4xl md:text-5xl font-semibold tracking-[-0.025em] leading-[1.06] text-charcoal-900">
                Let’s plan something <em className="font-editorial italic font-normal text-travion-700">worth remembering.</em>
              </h2>
              <p className="mt-5 text-charcoal-500 font-medium leading-relaxed max-w-md">
                Questions about planning, payments, the guide network or the platform itself — a real
                team reads every message.
              </p>
              <div className="mt-8 space-y-4">
                {[
                  { icon: <IndianRupee className="w-4 h-4" />, title: 'Transparent fees', text: 'Guide fee + platform fee, shown before you pay' },
                  { icon: <Phone className="w-4 h-4" />, title: 'Masked always', text: 'Phone numbers are masked except for escalation' },
                  { icon: <ShieldCheck className="w-4 h-4" />, title: 'Razorpay-secured', text: 'Payments processed with server-verified signatures' },
                ].map((row) => (
                  <div key={row.title} className="flex items-start gap-4 rounded-2xl border border-charcoal-100 bg-white px-5 py-4">
                    <span className="w-10 h-10 rounded-xl bg-travion-50 text-travion-700 flex items-center justify-center shrink-0" aria-hidden>{row.icon}</span>
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
                  <div className="flex flex-col items-center justify-center py-14 text-center" role="status">
                    <span className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-500 flex items-center justify-center" aria-hidden>
                      <CheckCircle2 className="w-8 h-8" />
                    </span>
                    <h3 className="mt-5 text-xl font-extrabold text-charcoal-900">Your message has been sent.</h3>
                    <p className="mt-2 text-sm font-medium text-charcoal-500 max-w-xs">
                      Thanks for writing to us. A member of the team will get back to you soon.
                    </p>
                    <button
                      onClick={() => { setContactState('idle'); setContactForm({ name: '', email: '', topic: 'General', priority: 'Normal', message: '' }); }}
                      className="mt-6 inline-flex btn-press items-center gap-2 h-11 px-5 rounded-2xl border border-charcoal-200 text-charcoal-700 text-sm font-bold hover:border-travion-300 hover:text-travion-700 transition-all"
                    >
                      <Undo2 className="w-4 h-4" />
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
                      <div className="flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5 text-red-600 text-[12px] font-bold" role="alert">
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
                      className="w-full h-12 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-bold shadow-soft inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed btn-press"
                    >
                      {contactState === 'sending' ? (
                        <>
                          <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
                          Sending…
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" aria-hidden />
                          Send Message
                        </>
                      )}
                    </button>
                  </form>
                )}
              </div>
            </Reveal>
          </div>
        </section>

        {/* ══════════════════ FINAL CTA ══════════════════ */}
        <section className="relative py-28 md:py-36 overflow-hidden bg-travion-900" aria-labelledby="cta-title">
          <SafeImg src={LANDING_IMAGES.finalCta} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-b from-travion-900/85 via-travion-900/70 to-charcoal-950/90" aria-hidden />
          <div className="relative max-w-4xl mx-auto px-5 md:px-10 text-center">
            <Reveal>
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-gold-300">Ready?</p>
              <h2 id="cta-title" className="mt-4 text-4xl md:text-6xl font-semibold tracking-[-0.03em] leading-[1.05] text-white">
                Your next journey
                <br />
                <em className="font-editorial font-normal italic">starts before you leave.</em>
              </h2>
              <p className="mt-5 text-white/70 font-medium text-lg max-w-xl mx-auto">
                Start your journey on a live map of real places — or help others travel by becoming a guide.
              </p>
              <div className="mt-9 flex flex-wrap justify-center gap-3.5">
                <button
                  onClick={() => openAuth(false)}
                  className="inline-flex btn-press items-center gap-2 h-13 px-7 rounded-2xl bg-travion-500 hover:bg-travion-400 text-white text-sm font-bold shadow-floating transition-all hover:-translate-y-0.5"
                >
                  Plan My Trip
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => openGuideRegistration()}
                  className="inline-flex btn-press items-center gap-2 h-13 px-7 rounded-2xl border border-white/25 bg-white/5 backdrop-blur text-white text-sm font-bold hover:bg-white/15 transition-all"
                >
                  Become a Guide
                  <ArrowUpRight className="w-4 h-4" />
                </button>
                <button
                  onClick={onExploreDemo}
                  className="inline-flex btn-press items-center gap-2 h-13 px-7 rounded-2xl bg-white text-charcoal-900 text-sm font-bold hover:bg-ivory-100 transition-all hover:-translate-y-0.5"
                >
                  Try the demo preview
                  <Compass className="w-4 h-4" />
                </button>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ══════════════════ FOOTER ══════════════════ */}
      <footer className="bg-charcoal-950 text-white">
        <div className="container-site py-16">
          <div className="grid md:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10">
            <div>
              <a href="#top" className="inline-flex items-center gap-2.5" aria-label="Travion home">
                <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center" aria-hidden>
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
                  className="inline-flex btn-press items-center gap-1.5 h-10 px-4 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-[12.5px] font-bold transition-all"
                >
                  Plan My Trip
                </button>
                <button
                  onClick={() => openGuideRegistration()}
                  className="inline-flex btn-press items-center gap-1.5 h-10 px-4 rounded-xl border border-white/20 bg-white/5 text-white text-[12.5px] font-bold hover:bg-white/15 transition-all"
                >
                  Become a Guide
                </button>
              </div>
            </div>

            <nav aria-label="Explore">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gold-300">Explore</p>
              <ul className="mt-4 space-y-2.5">
                {[
                  { label: 'Explore', href: '#explore' },
                  { label: 'How It Works', href: '#how-it-works' },
                  { label: 'Features', href: '#features' },
                  { label: 'Live map', href: '#map' },
                  { label: 'About', href: '#about' },
                ].map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-[13.5px] font-medium text-white/60 hover:text-white transition-colors">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-label="Product">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gold-300">Product</p>
              <ul className="mt-4 space-y-2.5">
                <li><a href="#modes" className="text-[13.5px] font-medium text-white/60 hover:text-white transition-colors">Plan My Trip</a></li>
                <li>
                  <button onClick={() => openGuideRegistration()} className="text-[13.5px] font-medium text-white/60 hover:text-white transition-colors">
                    Guide
                  </button>
                </li>
                <li><a href="#assistant" className="text-[13.5px] font-medium text-white/60 hover:text-white transition-colors">AI Assistant</a></li>
                <li><a href="#today" className="text-[13.5px] font-medium text-white/60 hover:text-white transition-colors">Active Trip</a></li>
                <li><a href="#faq" className="text-[13.5px] font-medium text-white/60 hover:text-white transition-colors">FAQ</a></li>
              </ul>
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
                <li>
                  <button onClick={() => onOpenGuideSignIn()} className="text-[13.5px] font-medium text-white/60 hover:text-white transition-colors">
                    Guide Sign In
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
              <ShieldCheck className="w-3.5 h-3.5 text-travion-400" aria-hidden />
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
                <SafeImg src={LANDING_IMAGES.authPanel} alt="" className="absolute inset-0 w-full h-full object-cover opacity-35" />
                <div className="absolute inset-0 bg-gradient-to-br from-travion-900/90 via-charcoal-950/55 to-travion-800/85" aria-hidden />
                <div className="relative z-10 flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-travion-400 to-travion-600 flex items-center justify-center" aria-hidden>
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
                      'Plans grounded in verified travel data',
                      'Live map, navigation and offline packages',
                      'Trip-scoped AI assistant with memory',
                    ].map((line) => (
                      <li key={line} className="flex items-start gap-2.5 text-[12px] font-semibold text-white/85">
                        <CheckCircle2 className="w-4 h-4 text-travion-300 mt-0.5 shrink-0" aria-hidden />
                        {line}
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

                <AnimatePresence>
                  {authError && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5 text-red-600 text-[12px] font-bold" role="alert">
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
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" aria-hidden />
                      <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} pl-10`} />
                    </div>
                  </Field>

                  <Field label={isLoginMode ? 'Password' : 'Create a strong password'}>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" aria-hidden />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="8+ characters with a capital and a number"
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
                            { k: 'number', label: '1 number' },
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

                      <Field label="Confirm password">
                        <div className="relative">
                          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" aria-hidden />
                          <input
                            type={showConfirmPassword ? 'text' : 'password'}
                            required
                            placeholder="Re-type your password"
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

                      <Field label="Phone number">
                        <div className="relative">
                          <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" aria-hidden />
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
                          Needed for guide coordination and emergencies. Always shown masked — never publicly.
                        </p>
                      </Field>
                    </>
                  )}

                  <button type="button" onClick={() => setRememberMe((r) => !r)} className="flex items-center gap-2.5 select-none group w-fit" aria-pressed={rememberMe}>
                    <span className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center transition-all ${rememberMe ? 'bg-travion-600 border-travion-600' : 'bg-white border-charcoal-300 group-hover:border-charcoal-400'}`} aria-hidden>
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
                    {isSubmitting ? 'Processing…' : isLoginMode ? 'Sign in' : 'Create traveller account'}
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
                <span className="w-10 h-10 rounded-2xl bg-charcoal-900 text-gold-300 flex items-center justify-center" aria-hidden>
                  <Key className="w-4 h-4" />
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
                    <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5 text-red-600 text-[12px] font-bold" role="alert">
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
                  className="w-full h-12 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-bold transition-colors disabled:opacity-45 btn-press"
                >
                  {isSubmitting ? 'Verifying…' : 'Authenticate'}
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
                  <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center" aria-hidden>
                    <Compass className="w-4 h-4 text-white" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-extrabold text-charcoal-900 tracking-tight">Terms &amp; Conditions</h3>
                    <p className="text-[10.5px] font-semibold text-charcoal-400">Travion · last updated February 2026</p>
                  </div>
                </div>
                <button onClick={() => setShowTerms(false)} aria-label="Close terms" className="p-2 rounded-xl text-charcoal-400 hover:text-charcoal-700 hover:bg-charcoal-50 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 md:px-8 py-6 space-y-5">
                {[
                  { t: '1. Acceptance of terms', d: 'By using Travion ("the platform") you agree to these Terms. If you do not agree, please do not use the service. The platform is currently provided for software demonstration and launch evaluation purposes.' },
                  { t: '2. Services we provide', d: 'Travion orchestrates travel journeys: trip planning, verified place discovery, itinerary editing, optional verified-guide coordination, transparent fee calculation via our payment partner Razorpay, live navigation, trip-scoped AI assistance, dynamic replanning and offline trip packages. The platform sells orchestration services, not the transport, stays, food or activities themselves.' },
                  { t: '3. Accounts and eligibility', d: 'You need an account to plan and join trips. You must be at least 18 years old or have a guardian’s consent. You are responsible for keeping your credentials confidential — one account per email, and phone numbers are masked except to staff who need them for coordination and emergencies.' },
                  { t: '4. Payments and fees', d: 'Travion collects the applicable platform fee and, in Guide Mode, the guide fee for your trip. Every booking includes a fixed ₹50 Insurance Fee (see TRAVION Refund Protection below). These are computed server-side and shown as a full breakdown before you pay. Your travel budget is an estimate of your overall travel spending and is never charged as a service fee. All payments are processed securely through Razorpay and every payment signature is verified.' },
                  { t: 'TRAVION Refund Protection', d: 'A fixed ₹50 Insurance Fee is included in every trip booking. The Insurance Fee is intended to provide refund protection for cancellations or non-fulfilment caused by TRAVION. If a trip is cancelled or cannot be fulfilled due to an issue attributable to TRAVION, TRAVION will refund the ₹50 Insurance Fee and the 3% Platform Fee paid by the user. This protection applies specifically to TRAVION-caused cancellation/non-fulfilment and does not automatically apply to cancellations initiated by the user or circumstances outside TRAVION\u2019s responsibility. The applicable refund amount and status are reflected in your booking/payment record.' },
                  { t: '5. Verification promise', d: 'Places shown on plans are checked against verified local data before they appear. Guides are onboarded, assessed and approved by an operations manager before they can operate. Where data has not yet been verified, the platform says so rather than inventing details.' },
                  { t: '6. Your responsibilities', d: 'You agree to use the platform lawfully, provide accurate information during onboarding, respect the people and places you visit, and not misuse the service to defraud travellers, guides or the platform.' },
                  { t: '7. Liability and disclaimers', d: 'Travion makes reasonable efforts to keep plans and data accurate but does not guarantee third-party services such as transport schedules, property conditions or weather. The platform is not responsible for travel decisions made against verified advisories, nor for losses arising outside the orchestration services it controls.' },
                  { t: '8. Changes and contact', d: 'We may update these Terms as the platform evolves; continuing to use Travion after a change means you accept the revised Terms. Questions about these Terms can be raised through the contact form on this page.' },
                ].map((s) => (
                  <div key={s.t}>
                    <h4 className="text-[13.5px] font-extrabold text-charcoal-900">{s.t}</h4>
                    <p className="mt-1.5 text-[13px] font-medium text-charcoal-500 leading-relaxed">{s.d}</p>
                  </div>
                ))}
                <button
                  onClick={() => { setShowTerms(false); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); }}
                  className="mt-2 inline-flex btn-press items-center gap-2 h-11 px-5 rounded-2xl bg-travion-600 text-white text-sm font-bold hover:bg-travion-700 transition-colors"
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
                  <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center" aria-hidden>
                    <Compass className="w-4 h-4 text-white" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-extrabold text-charcoal-900 tracking-tight">Privacy Policy</h3>
                    <p className="text-[10.5px] font-semibold text-charcoal-400">Travion · last updated February 2026</p>
                  </div>
                </div>
                <button onClick={() => setShowPrivacy(false)} aria-label="Close privacy policy" className="p-2 rounded-xl text-charcoal-400 hover:text-charcoal-700 hover:bg-charcoal-50 transition-colors">
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
                  { t: '7. Contact', d: 'For privacy questions or requests, use the contact form on this page or reach Travion directly at support@travion.in. We will verify your identity before acting on account-level requests.' },
                ].map((s) => (
                  <div key={s.t}>
                    <h4 className="text-[13.5px] font-extrabold text-charcoal-900">{s.t}</h4>
                    <p className="mt-1.5 text-[13px] font-medium text-charcoal-500 leading-relaxed">{s.d}</p>
                  </div>
                ))}
                <button
                  onClick={() => { setShowPrivacy(false); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); }}
                  className="mt-2 inline-flex btn-press items-center gap-2 h-11 px-5 rounded-2xl bg-travion-600 text-white text-sm font-bold hover:bg-travion-700 transition-colors"
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

/* ── Lazy-mounted real Leaflet map preview ──────────────────────────────── */

const MapPreviewLazy: React.FC<{ openAuth: (login: boolean) => void }> = ({ openAuth }) => {
  const ref = useRef<HTMLDivElement>(null);
  /* Mount (and download Leaflet) only when the section approaches — and keep
     a static styled fallback for reduced-motion / no-JS-map environments. */
  const inView = useInView(ref, { once: true, margin: '400px' });
  return (
    <div ref={ref} className="relative rounded-[28px] border border-charcoal-100 bg-white shadow-soft-lg overflow-hidden">
      {inView ? (
        <Suspense
          fallback={
            <div className="h-[420px] md:h-[500px] skeleton flex items-end justify-start p-6">
              <span className="rounded-full bg-white/90 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-charcoal-500">Preparing your destination map…</span>
            </div>
          }
        >
          <LandingMapPreview openAuth={openAuth} />
        </Suspense>
      ) : (
        <div className="h-[420px] md:h-[500px] bg-travion-100 flex items-end justify-start p-6">
          <span className="rounded-full bg-white/90 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-charcoal-500">
            <MapPin className="inline w-3 h-3 mr-1.5 text-travion-600" aria-hidden />Your journey, mapped
          </span>
        </div>
      )}
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

const AlertIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const WalletIcon: React.FC = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
  </svg>
);
