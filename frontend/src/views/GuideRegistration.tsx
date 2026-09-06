import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck, Check, CheckCircle2, Clock, Loader2,
  AlertCircle, ArrowRight, MapPin, Languages, Briefcase,
  Calendar, User, Lock, Mail, Phone
} from 'lucide-react';
import { api, authStorage, resolveApiBaseUrl } from '../services/api';

/* ─── Easing ─── */
const EASE = [0.22, 1, 0.36, 1] as const;

/* ─── Helpers ─── */
const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-travion-600">
    <span className="h-px w-7 bg-travion-300" />
    {children}
  </span>
);

const Reveal = ({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-60px' }}
    transition={{ duration: 0.7, delay, ease: EASE }}
    className={className}
  >
    {children}
  </motion.div>
);

const cities = [
  'Agra', 'Ahmedabad', 'Amritsar', 'Bangalore', 'Bhopal', 'Chennai',
  'Delhi', 'Goa', 'Hyderabad', 'Jaipur', 'Kochi', 'Kolkata',
  'Mumbai', 'Munnar', 'Pune', 'Udaipur', 'Varanasi', 'Other'
];

const languages = [
  'English', 'Hindi', 'Bengali', 'Tamil', 'Telugu', 'Marathi',
  'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Urdu', 'Other'
];

const guideTypes = [
  { value: 'Cultural', label: 'Cultural Heritage' },
  { value: 'Trekking', label: 'Trekking & Adventure' },
  { value: 'Culinary', label: 'Culinary & Food' },
  { value: 'Wildlife', label: 'Wildlife & Nature' },
  { value: 'Photography', label: 'Photography Tours' },
  { value: 'Historical', label: 'Historical Sites' },
  { value: 'General', label: 'General Tourism' }
];

const availabilityOptions = [
  { value: 'Weekdays', label: 'Weekdays' },
  { value: 'Weekends', label: 'Weekends' },
  { value: 'Flexible', label: 'Flexible' },
  { value: 'Seasonal', label: 'Seasonal' }
];

interface GuideRegistrationProps {
  onRegisterSuccess: (session: any) => void;
  onSwitchToSignIn: () => void;
}

export const GuideRegistration: React.FC<GuideRegistrationProps> = ({ onRegisterSuccess, onSwitchToSignIn }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [city, setCity] = useState('');
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [selectedDestinations, setSelectedDestinations] = useState<string[]>([]);
  const [experienceYears, setExperienceYears] = useState(1);
  const [guideType, setGuideType] = useState('');
  const [availability, setAvailability] = useState('');

  // Password strength
  const passwordChecks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password)
  };
  const strengthIndex = Math.max(0, Math.min(3, Object.values(passwordChecks).filter(Boolean).length - 1));
  const strengthLabels = ['Too weak', 'Weak', 'Fair', 'Strong'];
  const strengthBar = ['bg-red-400', 'bg-orange-400', 'bg-amber-400', 'bg-emerald-500'];
  const strengthText = ['text-red-500', 'text-orange-500', 'text-amber-500', 'text-emerald-600'];
  const strengthLabel = Object.values(passwordChecks).every(Boolean) ? strengthLabels[3] :
    Object.values(passwordChecks).filter(Boolean).length === 0 ? 'Too weak' : strengthLabels[strengthIndex];

  // Validation
  const phoneDigits = phone.replace(/\D/g, '');
  const phoneValid = /^([6-9]\d{9})$/.test(phoneDigits) || /^91[6-9]\d{9}$/.test(phoneDigits);

  const isFormValid = () => {
    if (!fullName.trim()) return false;
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
    if (!phoneValid) return false;
    if (!password || !Object.values(passwordChecks).every(Boolean)) return false;
    if (password !== confirmPassword) return false;
    if (!city.trim()) return false;
    if (selectedLanguages.length === 0) return false;
    if (selectedDestinations.length === 0) return false;
    if (!guideType) return false;
    if (!availability) return false;
    return true;
  };

  const toggleLanguage = (lang: string) => {
    setSelectedLanguages(prev =>
      prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]
    );
  };

  const toggleDestination = (dest: string) => {
    setSelectedDestinations(prev =>
      prev.includes(dest) ? prev.filter(d => d !== dest) : [...prev, dest]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isFormValid()) {
      setError('Please complete all required fields correctly.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/auth/guide/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.toLowerCase(),
          password,
          first_name: fullName.split(' ')[0],
          last_name: fullName.split(' ').slice(1).join(' '),
          phone: phoneDigits,
          city,
          languages: selectedLanguages,
          destinations: selectedDestinations,
          experience_years: experienceYears,
          guide_type: guideType,
          availability
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(typeof err.detail === 'string' ? err.detail : 'Registration failed');
      }

      const session = await res.json();
      authStorage.save(session, true);
      setSuccess(true);
      // Small delay to show success state
      await new Promise(r => setTimeout(r, 1500));
      onRegisterSuccess(session);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4 py-20">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="w-full max-w-xl"
        >
          <div className="text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
              className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6"
            >
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            </motion.div>

            <Eyebrow>Registration Complete</Eyebrow>
            <h1 className="mt-4 text-3xl font-extrabold text-slate-900 tracking-tight">
              Your Guide Profile Has Been Submitted
            </h1>

            <p className="mt-4 text-slate-500 leading-relaxed">
              Thank you for applying to become a TRAVION Guide. Our team will review your profile
              and notify you once the verification process is complete.
            </p>

            <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <div className="flex items-center gap-3 mb-4">
                <Clock className="w-5 h-5 text-travion-500" />
                <span className="text-sm font-semibold text-slate-700">Verification Status</span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-slate-900">Account Created</p>
                    <p className="text-xs text-slate-500">Your guide account has been created successfully</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-slate-900">Profile Submitted</p>
                    <p className="text-xs text-slate-500">Your information has been received</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full border-2 border-amber-400 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Verification Pending</p>
                    <p className="text-xs text-slate-500">Awaiting manager review</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 opacity-40">
                  <div className="w-5 h-5 rounded-full border-2 border-slate-300" />
                  <div>
                    <p className="text-sm font-bold text-slate-400">Manager Review</p>
                    <p className="text-xs text-slate-400">Not yet started</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 opacity-40">
                  <div className="w-5 h-5 rounded-full border-2 border-slate-300" />
                  <div>
                    <p className="text-sm font-bold text-slate-400">Guide Approved</p>
                    <p className="text-xs text-slate-400">Pending approval</p>
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-4 text-sm text-slate-500">
              We'll send you an email notification when your profile has been reviewed.
            </p>

            <button
              onClick={onSwitchToSignIn}
              className="mt-8 inline-flex items-center gap-2 h-12 px-6 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-bold transition-colors"
            >
              Go to Sign In
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pt-20 pb-24">
      {/* Header */}
      <div className="bg-slate-950 py-16">
        <div className="max-w-4xl mx-auto px-5 text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-travion-500/10 border border-travion-500/20">
              <ShieldCheck className="w-4 h-4 text-travion-500" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-travion-600">For Local Travel Guides</span>
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
            className="mt-5 text-4xl md:text-5xl font-extrabold text-white tracking-tight"
          >
            Become a TRAVION Guide
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: EASE }}
            className="mt-4 text-lg text-white/70 font-medium max-w-lg mx-auto"
          >
            Share your local knowledge and help travellers experience destinations better.
          </motion.p>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-2xl mx-auto px-5 -mt-12 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, ease: EASE }}
          className="rounded-3xl bg-white shadow-soft-lg border border-slate-200 p-8 md:p-10"
        >
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Full Name */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Full Name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full h-12 pl-12 pr-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm font-medium focus:border-travion-400 focus:ring-2 focus:ring-travion-100 outline-none transition-all"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Email Address <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full h-12 pl-12 pr-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm font-medium focus:border-travion-400 focus:ring-2 focus:ring-travion-100 outline-none transition-all"
                />
              </div>
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Phone Number <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className={`w-full h-12 pl-12 pr-4 rounded-xl border ${phoneValid ? 'border-slate-200' : 'border-red-300'} bg-slate-50 text-slate-900 text-sm font-medium focus:border-travion-400 focus:ring-2 focus:ring-travion-100 outline-none transition-all`}
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                A valid Indian mobile number is required. This will not be shown publicly.
              </p>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full h-12 pl-12 pr-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm font-medium focus:border-travion-400 focus:ring-2 focus:ring-travion-100 outline-none transition-all"
                />
              </div>
              {password.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${strengthBar[strengthIndex]}`}
                        style={{ width: `${((strengthIndex + 1) / 4) * 100}%` }}
                      />
                    </div>
                    <span className={`text-xs font-semibold ${strengthText[strengthIndex]}`}>
                      {strengthLabel}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <label className={`flex items-center gap-1.5 ${passwordChecks.length ? 'text-emerald-600' : 'text-slate-400'}`}>
                      <Check className="w-3.5 h-3.5" /> 8+ characters
                    </label>
                    <label className={`flex items-center gap-1.5 ${passwordChecks.upper ? 'text-emerald-600' : 'text-slate-400'}`}>
                      <Check className="w-3.5 h-3.5" /> Uppercase letter
                    </label>
                    <label className={`flex items-center gap-1.5 ${passwordChecks.lower ? 'text-emerald-600' : 'text-slate-400'}`}>
                      <Check className="w-3.5 h-3.5" /> Lowercase letter
                    </label>
                    <label className={`flex items-center gap-1.5 ${passwordChecks.number ? 'text-emerald-600' : 'text-slate-400'}`}>
                      <Check className="w-3.5 h-3.5" /> Number
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className={`w-full h-12 pl-12 pr-4 rounded-xl border ${confirmPassword && password === confirmPassword ? 'border-emerald-300' : 'border-slate-200'} bg-slate-50 text-slate-900 text-sm font-medium focus:border-travion-400 focus:ring-2 focus:ring-travion-100 outline-none transition-all`}
                />
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Passwords do not match
                </p>
              )}
            </div>

            {/* City */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Primary Operating Location <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full h-12 pl-12 pr-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm font-medium focus:border-travion-400 focus:ring-2 focus:ring-travion-100 outline-none transition-all appearance-none"
                >
                  <option value="">Select your city</option>
                  {cities.map(city => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Languages */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Languages Spoken <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Languages className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <select
                  multiple
                  value={selectedLanguages}
                  onChange={(e) => {
                    const options = Array.from(e.target.selectedOptions, o => o.value);
                    setSelectedLanguages(options);
                  }}
                  className="w-full h-32 pl-12 pr-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm focus:border-travion-400 focus:ring-2 focus:ring-travion-100 outline-none transition-all appearance-none"
                >
                  {languages.map(lang => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Select all languages you can guide in (Ctrl+Click to select multiple)
              </p>
            </div>

            {/* Destinations */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Areas / Destinations Covered <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <select
                  multiple
                  value={selectedDestinations}
                  onChange={(e) => {
                    const options = Array.from(e.target.selectedOptions, o => o.value);
                    setSelectedDestinations(options);
                  }}
                  className="w-full h-32 pl-12 pr-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm focus:border-travion-400 focus:ring-2 focus:ring-travion-100 outline-none transition-all appearance-none"
                >
                  {cities.map(city => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Select the destinations you can guide travellers in (Ctrl+Click to select multiple)
              </p>
            </div>

            {/* Experience Years */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Years of Experience <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <select
                  value={experienceYears}
                  onChange={(e) => setExperienceYears(Number(e.target.value))}
                  className="w-full h-12 pl-12 pr-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm font-medium focus:border-travion-400 focus:ring-2 focus:ring-travion-100 outline-none transition-all appearance-none"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(y => (
                    <option key={y} value={y}>{y} {y === 1 ? 'year' : 'years'}</option>
                  ))}
                  <option value="10+">10+ years</option>
                </select>
              </div>
            </div>

            {/* Guide Type */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Guide Type <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {guideTypes.map(type => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setGuideType(type.value)}
                    className={`h-11 px-4 rounded-xl border text-sm font-semibold transition-all ${
                      guideType === type.value
                        ? 'bg-travion-600 border-travion-600 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-travion-300'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Availability */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Availability <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {availabilityOptions.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAvailability(opt.value)}
                    className={`h-11 px-3 rounded-xl border text-sm font-semibold transition-all ${
                      availability === opt.value
                        ? 'bg-travion-600 border-travion-600 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-travion-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                <p className="text-sm font-medium text-red-700">{error}</p>
              </div>
            )}

            {/* Submit */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:bg-travion-300 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  <>
                    Register as a Guide
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            {/* Switch to Sign In */}
            <div className="text-center">
              <p className="text-sm text-slate-500">
                Already a TRAVION Guide?
              </p>
              <button
                type="button"
                onClick={onSwitchToSignIn}
                className="mt-2 text-sm font-bold text-travion-600 hover:text-travion-700 transition-colors"
              >
                Sign in to your account
              </button>
            </div>
          </form>
        </motion.div>
      </div>

      {/* Footer note */}
      <div className="max-w-2xl mx-auto px-5 mt-8 text-center">
        <p className="text-xs text-slate-400">
          By registering, you agree to TRAVION's guide terms and verification process.
          Your phone number will remain private and only used for verification purposes.
        </p>
      </div>
    </div>
  );
};
