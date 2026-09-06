import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck, ArrowRight, AlertCircle, Eye, EyeOff, Loader2,
  Lock, Mail, Phone
} from 'lucide-react';
import { api, authStorage, resolveApiBaseUrl } from '../services/api';

const EASE = [0.22, 1, 0.36, 1] as const;

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-travion-600">
    <span className="h-px w-7 bg-travion-300" />
    {children}
  </span>
);

interface GuideSignInProps {
  onSignInSuccess: (session: any) => void;
  onSwitchToRegistration: () => void;
}

export const GuideSignIn: React.FC<GuideSignInProps> = ({ onSignInSuccess, onSwitchToRegistration }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase(), password })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Invalid credentials. Please try again.');
      }

      const session = await res.json();
      authStorage.save(session, true);
      onSignInSuccess(session);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

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
              <span className="text-[11px] font-bold uppercase tracking-wider text-travion-600">For Existing Guides</span>
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
            className="mt-5 text-4xl md:text-5xl font-extrabold text-white tracking-tight"
          >
            Guide Sign In
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: EASE }}
            className="mt-4 text-lg text-white/70 font-medium max-w-lg mx-auto"
          >
            Access your TRAVION Guide account and manage your trips.
          </motion.p>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-md mx-auto px-5 -mt-12 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, ease: EASE }}
          className="rounded-3xl bg-white shadow-soft-lg border border-slate-200 p-8 md:p-10"
        >
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                <p className="text-sm font-medium text-red-700">{error}</p>
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Email Address
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

            {/* Password */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full h-12 pl-12 pr-12 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm font-medium focus:border-travion-400 focus:ring-2 focus:ring-travion-100 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:bg-travion-300 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Signing In...
                  </>
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            {/* Switch to Registration */}
            <div className="text-center">
              <p className="text-sm text-slate-500">
                Don't have a guide account yet?
              </p>
              <button
                type="button"
                onClick={onSwitchToRegistration}
                className="mt-2 text-sm font-bold text-travion-600 hover:text-travion-700 transition-colors"
              >
                Register as a Guide
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );
};
