import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Compass, User, Phone, MapPin, CheckCircle2, ShieldAlert,
  Star, Eye, EyeOff, MessageSquare, LogOut, Clock, Navigation,
  Languages as LanguagesIcon, Briefcase, AlertCircle
} from 'lucide-react';
import { AuthSession, GuideProfile, ReviewItem } from '../types';
import { api } from '../services/api';
import { TripChatDrawer } from '../components/chat/TripChatDrawer';

const GUIDE_LANGUAGES = ['English', 'Hindi', 'Tamil', 'Kannada', 'Malayalam', 'Telugu', 'Marathi', 'Bengali', 'Punjabi', 'French', 'German'];
const DESTINATION_OPTIONS = ['Ooty', 'Manali', 'Goa', 'Jaipur', 'Munnar', 'Varanasi', 'Coimbatore', 'Bangalore', 'Delhi', 'Mumbai'];
const SPECIALIZATION_OPTIONS = ['Trekking & Trails', 'Heritage & History', 'Culinary & Food Walks', 'Wildlife & Nature', 'Photography', 'Spiritual & Pilgrimage', 'Adventure Sports', 'Artisan & Crafts'];
const EXPERIENCE_OPTIONS = ['1 year', '2 years', '3 years', '5 years', '8 years', '10+ years'];
const numToYears: Record<string, number> = { '1 year': 1, '2 years': 2, '3 years': 3, '5 years': 5, '8 years': 8, '10+ years': 12 };

interface GuideDomainProps {
  session: AuthSession;
  onLogout: () => void;
}

export const GuideDomain: React.FC<GuideDomainProps> = ({ session, onLogout }) => {
  const [guide, setGuide] = useState<GuideProfile | null>(null);
  const [assignedTrips, setAssignedTrips] = useState<any[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [status, setStatus] = useState<'ACTIVE' | 'BUSY' | 'DUTY_OFF'>('ACTIVE');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Onboarding form state if pending (structured vetting — no blank applications)
  const [phone, setPhone] = useState('');
  const [selectedDestinations, setSelectedDestinations] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [experience, setExperience] = useState('3 years');
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [destinationKnowledge, setDestinationKnowledge] = useState('');
  const [safetyInfo, setSafetyInfo] = useState('');
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [onboardingSaved, setOnboardingSaved] = useState(false);
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false);
  const [chatTrip, setChatTrip] = useState<any | null>(null);

  const toggleIn = (list: string[], value: string, setter: (v: string[]) => void) => {
    setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  };

  const fetchData = async () => {
    try {
      const me = await api.getMe();
      if (me.guide) {
        setGuide(me.guide);
        setStatus(me.guide.status);
      }
      const trips = await api.getAssignedTripsForGuide();
      setAssignedTrips(trips);
      const revs = await api.getMyReviewsForGuide();
      setReviews(revs);
    } catch (err) {
      console.error("Guide data fetch error:", err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleStatusToggle = async (newStatus: 'ACTIVE' | 'BUSY' | 'DUTY_OFF') => {
    setIsUpdatingStatus(true);
    try {
      await api.updateGuideStatus(newStatus);
      setStatus(newStatus);
    } catch (err: any) {
      setOnboardingError(err.message || "Failed to update status");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleToggleReviewVisibility = async (reviewId: string, currentVisible: boolean) => {
    try {
      await api.toggleReviewVisibility(reviewId, !currentVisible);
      setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, is_visible_on_profile: !currentVisible } : r));
    } catch (err) {
      console.error("Toggle review failed:", err);
    }
  };

  const handleSaveOnboarding = async () => {
    setOnboardingError(null);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) {
      setOnboardingError('A valid phone number (10–13 digits) is mandatory for verification.');
      return;
    }
    if (selectedDestinations.length === 0) {
      setOnboardingError('Select at least one destination you can guide in.');
      return;
    }
    if (selectedLanguages.length === 0) {
      setOnboardingError('Select at least one language you can guide in.');
      return;
    }
    if (specializations.length === 0) {
      setOnboardingError('Select at least one guiding specialization.');
      return;
    }
    if (destinationKnowledge.trim().length < 20) {
      setOnboardingError('Describe your destination knowledge in detail (minimum 20 characters).');
      return;
    }
    if (safetyInfo.trim().length < 20) {
      setOnboardingError('Describe your safety & emergency knowledge in detail (minimum 20 characters).');
      return;
    }

    setIsSavingOnboarding(true);
    try {
      await api.submitGuideOnboarding({
        first_name: guide?.first_name || session.email.split('@')[0],
        last_name: guide?.last_name || '',
        phone,
        languages: selectedLanguages,
        destinations: selectedDestinations,
        experience_years: numToYears[experience] || 3,
        specializations,
        destination_knowledge: destinationKnowledge,
        safety_information: safetyInfo
      });
      setOnboardingSaved(true);
      fetchData();
    } catch (err: any) {
      setOnboardingError(err?.message || 'Failed to submit your application. Please try again.');
      console.error("Save onboarding failed:", err);
    } finally {
      setIsSavingOnboarding(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-travion-600 text-white flex items-center justify-center">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <span className="text-base font-black text-slate-900 tracking-tight">TRAVION GUIDE</span>
            <span className="text-[10px] font-bold text-travion-600 block leading-none">Operations Hub</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Availability Status Controller */}
          <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-100 border border-slate-200 text-xs font-bold">
            <button
              disabled={isUpdatingStatus}
              onClick={() => handleStatusToggle('ACTIVE')}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 ${
                status === 'ACTIVE' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-200" />
              <span>Active</span>
            </button>
            <button
              disabled={isUpdatingStatus}
              onClick={() => handleStatusToggle('BUSY')}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 ${
                status === 'BUSY' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-amber-200" />
              <span>Busy</span>
            </button>
            <button
              disabled={isUpdatingStatus}
              onClick={() => handleStatusToggle('DUTY_OFF')}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 ${
                status === 'DUTY_OFF' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span>Duty Off</span>
            </button>
          </div>

          <button
            onClick={onLogout}
            className="p-2 text-slate-400 hover:text-red-600 rounded-xl hover:bg-red-50 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl w-full mx-auto px-4 md:px-6 py-8 space-y-6">
        
        {/* Onboarding Vetting Banner if not approved */}
        {guide?.approval_status !== 'APPROVED' && (
          <div className="p-6 rounded-3xl bg-amber-50 border border-amber-200">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
              <div className="w-full">
                <h3 className="text-base font-bold text-amber-900">Guide Verification & Onboarding</h3>
                <p className="text-xs text-amber-700 mt-1">
                  Your profile requires manager approval before assignments activate. Submit your local destination knowledge and safety precautions.
                </p>

                {!onboardingSaved ? (
                  <div className="mt-4 bg-white rounded-2xl border border-amber-200 p-4 md:p-5 space-y-4">
                    {/* Identity & contact */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">First Name</label>
                        <input
                          type="text"
                          value={guide?.first_name || ''}
                          readOnly
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Last Name</label>
                        <input
                          type="text"
                          value={guide?.last_name || ''}
                          readOnly
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
                          <Phone className="w-3 h-3" /> Phone Number *
                        </label>
                        <input
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+91 98765 43210"
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold focus:border-amber-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Destinations */}
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Primary & Additional Destinations *
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {DESTINATION_OPTIONS.map((d) => {
                          const on = selectedDestinations.includes(d);
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => toggleIn(selectedDestinations, d, setSelectedDestinations)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                                on ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-600 border-slate-200 hover:border-amber-400'
                              }`}
                            >
                              {d}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Languages + Experience */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1">
                          <LanguagesIcon className="w-3 h-3" /> Languages You Guide In *
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {GUIDE_LANGUAGES.map((lang) => {
                            const on = selectedLanguages.includes(lang);
                            return (
                              <button
                                key={lang}
                                type="button"
                                onClick={() => toggleIn(selectedLanguages, lang, setSelectedLanguages)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                                  on ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:border-sky-400'
                                }`}
                              >
                                {lang}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1">
                            <Briefcase className="w-3 h-3" /> Years of Experience *
                          </label>
                          <select
                            value={experience}
                            onChange={(e) => setExperience(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold bg-white focus:border-amber-500 focus:outline-none"
                          >
                            {EXPERIENCE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Specializations *</label>
                          <div className="flex flex-wrap gap-1.5">
                            {SPECIALIZATION_OPTIONS.map((s) => {
                              const on = specializations.includes(s);
                              return (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => toggleIn(specializations, s, setSpecializations)}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                                    on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400'
                                  }`}
                                >
                                  {s}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Knowledge + Safety assessments */}
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                        Destination Knowledge Assessment * <span className="text-amber-600 normal-case">(min 20 characters)</span>
                      </label>
                      <textarea
                        rows={2}
                        value={destinationKnowledge}
                        onChange={(e) => setDestinationKnowledge(e.target.value)}
                        placeholder="Describe local heritage, key attractions, routes, festivals and lesser-known spots you would show travellers..."
                        className="w-full p-3 rounded-xl border border-slate-200 text-xs font-medium focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                        Safety & Emergency Preparedness * <span className="text-amber-600 normal-case">(min 20 characters)</span>
                      </label>
                      <textarea
                        rows={2}
                        value={safetyInfo}
                        onChange={(e) => setSafetyInfo(e.target.value)}
                        placeholder="How would you handle a lost traveller, a medical issue, bad weather, or a safety concern during a trip?"
                        className="w-full p-3 rounded-xl border border-slate-200 text-xs font-medium focus:border-amber-500 focus:outline-none"
                      />
                    </div>

                    {onboardingError && (
                      <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{onboardingError}</span>
                      </div>
                    )}

                    <button
                      onClick={handleSaveOnboarding}
                      disabled={isSavingOnboarding}
                      className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-sm transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {isSavingOnboarding ? 'Submitting…' : 'Submit for Manager Review'}
                      {!isSavingOnboarding && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 p-3 bg-white rounded-xl text-xs font-semibold text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Submitted! Your application is in the Manager verification queue.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Guide Stats Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Current Status</span>
            <div className="text-lg font-black text-slate-900 mt-1 flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${status === 'ACTIVE' ? 'bg-emerald-500' : status === 'BUSY' ? 'bg-amber-500' : 'bg-slate-400'}`} />
              <span>{status}</span>
            </div>
          </div>
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Guide Rating</span>
            <div className="text-lg font-black text-slate-900 mt-1 flex items-center gap-1.5">
              <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
              <span>{guide?.rating || 4.9}</span>
              <span className="text-xs font-medium text-slate-400">({guide?.review_count || 0})</span>
            </div>
          </div>
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Experience</span>
            <div className="text-lg font-black text-slate-900 mt-1">
              {guide?.experience_years || 5} Years
            </div>
          </div>
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Assigned Trips</span>
            <div className="text-lg font-black text-slate-900 mt-1">
              {assignedTrips.length} Total
            </div>
          </div>
        </div>

        {/* Today's Active Assignment Card */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-soft">
          <h3 className="text-base font-extrabold text-slate-900 mb-4 flex items-center gap-2">
            <Compass className="w-5 h-5 text-travion-600" />
            <span>Assigned Trips Queue</span>
          </h3>

          {assignedTrips.length === 0 ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-400">
              No active traveller trips assigned to you currently. Keep your status ACTIVE to receive matches.
            </div>
          ) : (
            <div className="space-y-4">
              {assignedTrips.map((assignment) => (
                <div
                  key={assignment.assignment_id}
                  className="p-5 rounded-2xl bg-travion-50/50 border border-travion-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-extrabold text-slate-900">
                        {assignment.trip.destination} Expedition
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-travion-100 text-travion-700">
                        {assignment.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      Traveller: <span className="font-bold">{assignment.trip.traveller.name}</span> · Preferred Language: {assignment.trip.traveller.language}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Departure: {new Date(assignment.trip.start_datetime).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setChatTrip(assignment)}
                      className="px-3.5 py-2 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Message Traveller</span>
                    </button>
                    <span className="px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 text-xs font-bold">
                      Guide fee follows trip completion
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Review Management (Show / Hide toggle without deletion) */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-soft">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Traveller Reviews & Profile Visibility</h3>
              <p className="text-xs text-slate-500">
                You can manage whether a review appears publicly on your profile. Hiding never deletes the review; platform administrators retain access.
              </p>
            </div>
          </div>

          {reviews.length === 0 ? (
            <div className="p-6 text-center text-xs font-semibold text-slate-400">
              No traveller reviews yet. Reviews will appear here once trips complete.
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map((rev) => (
                <div
                  key={rev.id}
                  className="p-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center text-amber-400">
                        {Array.from({ length: rev.rating }).map((_, i) => (
                          <Star key={i} className="w-3.5 h-3.5 fill-amber-400" />
                        ))}
                      </div>
                      <span className="text-xs font-bold text-slate-800">{rev.user_name}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">"{rev.comment || 'Great guidance!'}"</p>
                  </div>

                  <button
                    onClick={() => handleToggleReviewVisibility(rev.id, rev.is_visible_on_profile)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${
                      rev.is_visible_on_profile
                        ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {rev.is_visible_on_profile ? (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        <span>Visible (Hide)</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>Hidden (Show)</span>
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </main>

      {/* Guide <-> Traveller chat (real trip-scoped conversation) */}
      <TripChatDrawer
        tripId={chatTrip?.trip?.id || ''}
        isOpen={!!chatTrip}
        onClose={() => setChatTrip(null)}
        isGuideAssigned
        mode="guide"
        travellerName={chatTrip?.trip?.traveller?.name}
        destinationName={chatTrip?.trip?.destination}
        tripStart={chatTrip?.trip?.start_datetime}
        tripEnd={chatTrip?.trip?.end_datetime}
      />
    </div>
  );
};
