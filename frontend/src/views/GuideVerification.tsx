import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck, Check, CheckCircle2, Clock, Loader2,
  AlertCircle, ArrowRight, MapPin, Languages, Briefcase,
  Calendar, User, Lock, Mail, Phone
} from 'lucide-react';
import { api } from '../services/api';

const EASE = [0.22, 1, 0.36, 1] as const;

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-travion-600">
    <span className="h-px w-7 bg-travion-300" />
    {children}
  </span>
);

interface VerificationState {
  approval_status: 'PENDING' | 'APPROVED' | 'REJECTED' | string;
  status: 'ACTIVE' | 'BUSY' | 'DUTY_OFF' | string;
  profile_completed: boolean;
  languages: string[];
  destinations: string[];
  experience_years: number;
  specializations: string[];
  created_at: string | null;
}

interface GuideVerificationProps {
  onDashboardAccess: () => void;
  onResubmitProfile: () => void;
}

export const GuideVerification: React.FC<GuideVerificationProps> = ({ onDashboardAccess, onResubmitProfile }) => {
  const [verification, setVerification] = useState<VerificationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await api.getGuideVerificationStatus?.();
        if (status) {
          setVerification(status);
        } else {
          // Fallback: fetch from /auth/me
          const me = await api.getMe();
          if (me.guide) {
            setVerification({
              approval_status: me.guide.approval_status || 'PENDING',
              status: me.guide.status || 'DUTY_OFF',
              profile_completed: Boolean(me.guide.destination_knowledge && me.guide.safety_information),
              languages: me.guide.languages || [],
              destinations: me.guide.destinations || [],
              experience_years: me.guide.experience_years || 0,
              specializations: me.guide.specializations || [],
              created_at: null
            });
          }
        }
      } catch (err) {
        setError('Unable to load verification status. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
  }, []);

  const getStatusConfig = () => {
    if (!verification) return null;

    switch (verification.approval_status) {
      case 'APPROVED':
        return {
          title: "You're Verified",
          description: 'Your TRAVION Guide profile has been approved. You can now receive and manage trips.',
          icon: CheckCircle2,
          iconColor: 'text-emerald-500',
          bgColor: 'bg-emerald-50',
          borderColor: 'border-emerald-200',
          progressItems: [
            { icon: CheckCircle2, label: 'Account Created', done: true },
            { icon: CheckCircle2, label: 'Profile Submitted', done: true },
            { icon: CheckCircle2, label: 'Verification Pending', done: true },
            { icon: CheckCircle2, label: 'Manager Review', done: true },
            { icon: CheckCircle2, label: 'Guide Approved', done: true, current: true }
          ]
        };
      case 'REJECTED':
        return {
          title: 'Additional Information Needed',
          description: 'Your guide application needs additional information. Please update your profile and resubmit for review.',
          icon: AlertCircle,
          iconColor: 'text-amber-500',
          bgColor: 'bg-amber-50',
          borderColor: 'border-amber-200',
          progressItems: [
            { icon: CheckCircle2, label: 'Account Created', done: true },
            { icon: CheckCircle2, label: 'Profile Submitted', done: true },
            { icon: AlertCircle, label: 'Verification Pending', done: false, current: true },
            { icon: AlertCircle, label: 'Manager Review', done: false },
            { icon: AlertCircle, label: 'Guide Approved', done: false }
          ]
        };
      case 'PENDING':
      default:
        return {
          title: 'Verification Pending',
          description: 'Your guide profile has been submitted and is awaiting verification. Our team will review your application and notify you of the outcome.',
          icon: Clock,
          iconColor: 'text-amber-500',
          bgColor: 'bg-amber-50',
          borderColor: 'border-amber-200',
          progressItems: [
            { icon: CheckCircle2, label: 'Account Created', done: true },
            { icon: CheckCircle2, label: 'Profile Submitted', done: true },
            { icon: Clock, label: 'Verification Pending', done: false, current: true },
            { icon: CheckCircle2, label: 'Manager Review', done: false },
            { icon: CheckCircle2, label: 'Guide Approved', done: false }
          ]
        };
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4 py-20">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-xl text-center"
        >
          <Loader2 className="w-12 h-12 text-travion-500 animate-spin mx-auto" />
          <p className="mt-4 text-slate-500 font-medium">Loading verification status...</p>
        </motion.div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4 py-20">
        <div className="w-full max-w-xl text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Unable to Load Status</h1>
          <p className="mt-2 text-slate-500">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center gap-2 h-12 px-6 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-bold transition-colors"
          >
            Try Again
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  const config = getStatusConfig();
  if (!config || !verification) {
    return null;
  }

  const StatusIcon = config.icon;

  return (
    <div className="min-h-screen bg-white py-20 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="text-center mb-12"
        >
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full ${config.bgColor} mb-6`}>
            <StatusIcon className={`w-8 h-8 ${config.iconColor}`} />
          </div>

          <Eyebrow>Guide Status</Eyebrow>
          <h1 className="mt-3 text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">
            {config.title}
          </h1>
          <p className="mt-3 text-slate-500 leading-relaxed max-w-lg mx-auto">
            {config.description}
          </p>
        </motion.div>

        {/* Verification Progress */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
          className={`rounded-2xl border ${config.borderColor} ${config.bgColor} p-6 mb-8`}
        >
          <h2 className="text-sm font-bold text-slate-700 mb-5">Verification Progress</h2>
          <div className="space-y-4">
            {config.progressItems.map((item, index) => (
              <div
                key={index}
                className={`flex items-center gap-3 ${
                  item.current ? 'relative' : ''
                } ${item.current ? 'pb-2' : ''}`}
              >
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                  item.done ? 'bg-emerald-500' : 'bg-slate-200'
                }`}>
                  {item.done ? (
                    <Check className="w-3.5 h-3.5 text-white" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                  )}
                </div>
                <div>
                  <p className={`text-sm font-bold ${
                    item.done ? 'text-slate-900' : 'text-slate-500'
                  } ${item.current ? 'text-amber-600' : ''}`}>
                    {item.label}
                  </p>
                  {item.current && (
                    <p className="text-xs text-slate-400">Current status</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Profile Summary */}
        {verification && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-6"
          >
            <h2 className="text-sm font-bold text-slate-700 mb-4">Your Profile Summary</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-slate-400 mb-1">Experience</p>
                <p className="text-sm font-bold text-slate-900">{verification.experience_years} years</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400 mb-1">Profile Complete</p>
                <p className={`text-sm font-bold ${verification.profile_completed ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {verification.profile_completed ? 'Yes' : 'Pending'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400 mb-1">Languages</p>
                <p className="text-sm font-bold text-slate-900">{verification.languages.join(', ') || 'Not set'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400 mb-1">Destinations</p>
                <p className="text-sm font-bold text-slate-900">{verification.destinations.join(', ') || 'Not set'}</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3, ease: EASE }}
          className="space-y-4"
        >
          {verification.approval_status === 'APPROVED' ? (
            <button
              onClick={onDashboardAccess}
              className="w-full h-12 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
            >
              Go to Guide Dashboard
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : verification.approval_status === 'REJECTED' ? (
            <>
              <button
                onClick={onResubmitProfile}
                className="w-full h-12 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
              >
                Update and Resubmit Profile
                <ArrowRight className="w-4 h-4" />
              </button>
              <p className="text-center text-xs text-slate-400">
                You'll be notified once your updated profile is reviewed.
              </p>
            </>
          ) : (
            <>
              <button
                onClick={onResubmitProfile}
                className="w-full h-12 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
              >
                Update Profile Details
                <ArrowRight className="w-4 h-4" />
              </button>
              <p className="text-center text-xs text-slate-400">
                You can update your profile details while waiting for verification.
              </p>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
};
