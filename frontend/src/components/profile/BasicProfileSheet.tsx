import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Phone, Globe, Shield, MessageSquare, ArrowRight, CheckCircle2 } from 'lucide-react';
import { api } from '../../services/api';
import { UserProfile } from '../../types';

interface BasicProfileSheetProps {
  initialData?: Partial<UserProfile>;
  onComplete: () => void;
}

export const BasicProfileSheet: React.FC<BasicProfileSheetProps> = ({
  initialData,
  onComplete
}) => {
  const [firstName, setFirstName] = useState(initialData?.first_name || '');
  const [lastName, setLastName] = useState(initialData?.last_name || '');
  const [preferredName, setPreferredName] = useState(initialData?.preferred_name || '');
  const [gender, setGender] = useState(initialData?.gender || 'Prefer not to say');
  const [language, setLanguage] = useState(initialData?.preferred_language || 'English');
  const [country, setCountry] = useState(initialData?.country || 'India');
  const [homeCity, setHomeCity] = useState(initialData?.home_city || '');
  const [phone, setPhone] = useState(initialData?.phone || '');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [homeCityError, setHomeCityError] = useState<string | null>(null);
  const [commPreference, setCommPreference] = useState<'Voice' | 'Text' | 'Both'>(initialData?.preferred_communication || 'Both');
  const [emergencyName, setEmergencyName] = useState(initialData?.emergency_contact_name || '');
  const [emergencyPhone, setEmergencyPhone] = useState(
    (initialData?.emergency_contact_phone || '').replace(/\D/g, '').slice(0, 10)
  );
  const [emergencyPhoneError, setEmergencyPhoneError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const phoneDigits = phone.replace(/\D/g, '');
  const phoneValid = phoneDigits.length >= 10 && phoneDigits.length <= 13;

  const handlePhoneChange = (value: string) => {
    setPhone(value);
    const digits = value.replace(/\D/g, '');
    if (value && (digits.length < 10 || digits.length > 13)) {
      setPhoneError('Enter 10–13 digits, e.g. +91 98765 43210.');
    } else {
      setPhoneError(null);
    }
  };

  // Emergency contact must be a valid 10-digit Indian mobile number — letters
  // and special characters are blocked at the input itself (spec: numbers only).
  const handleEmergencyPhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').slice(0, 10);
    setEmergencyPhone(digits);
    if (digits.length > 0 && (digits.length < 10 || !/^[6-9]/.test(digits))) {
      setEmergencyPhoneError('Enter a valid 10-digit Indian mobile number (starting 6-9).');
    } else {
      setEmergencyPhoneError(null);
    }
  };
  const emergencyPhoneValid = emergencyPhone.length === 0 ||
    (emergencyPhone.length === 10 && /^[6-9]/.test(emergencyPhone));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Home City is MANDATORY — the user cannot continue without it.
    if (!homeCity.trim()) {
      setHomeCityError('Please enter your home city to continue.');
      return;
    }
    setHomeCityError(null);
    setIsSubmitting(true);
    try {
      await api.updateBasicProfile({
        first_name: firstName,
        last_name: lastName,
        preferred_name: preferredName || firstName,
        gender,
        preferred_language: language,
        country,
        home_city: homeCity,
        phone,
        preferred_communication: commPreference,
        emergency_contact_name: emergencyName,
        emergency_contact_phone: emergencyPhone
      });
      onComplete();
    } catch (err: any) {
      const msg = err?.message || 'Failed to update your profile. Please try again.';
      setPhoneError(msg.includes('phone') ? msg : null);
      console.error('Failed to update basic profile:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-travion-900/45 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-xl bg-white rounded-3xl shadow-floating border border-travion-100 p-6 md:p-8 my-8"
      >
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-travion-100 text-travion-600 mx-auto flex items-center justify-center mb-3">
            <User className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Tell us a little about you</h2>
          <p className="text-xs text-slate-500 mt-1">
            This stable profile persists across all your trips so AI never asks repetitive questions.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">First Name *</label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="e.g. Kavya"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:border-travion-500 focus:ring-2 focus:ring-travion-100 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Last Name *</label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="e.g. Rao"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:border-travion-500 focus:ring-2 focus:ring-travion-100 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">What should we call you? (Preferred Name)</label>
            <input
              type="text"
              value={preferredName}
              onChange={(e) => setPreferredName(e.target.value)}
              placeholder="e.g. Kavya"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:border-travion-500 focus:ring-2 focus:ring-travion-100 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Preferred Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:border-travion-500 focus:ring-2 focus:ring-travion-100 focus:outline-none bg-white"
              >
                <option value="English">English</option>
                <option value="Hindi">Hindi</option>
                <option value="Tamil">Tamil</option>
                <option value="Kannada">Kannada</option>
                <option value="Malayalam">Malayalam</option>
                <option value="Telugu">Telugu</option>
                <option value="French">French</option>
                <option value="German">German</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Home / Current City *</label>
              <input
                type="text"
                required
                value={homeCity}
                onChange={(e) => {
                  setHomeCity(e.target.value);
                  if (homeCityError) setHomeCityError(null);
                }}
                placeholder="e.g. Chennai"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-sm font-semibold focus:border-travion-500 focus:ring-2 focus:ring-travion-100 focus:outline-none ${
                  homeCityError ? 'border-red-300 bg-red-50/40' : 'border-slate-200'
                }`}
              />
              {homeCityError && (
                <p className="mt-1 text-[11px] font-semibold text-red-600">{homeCityError}</p>
              )}
            </div>
          </div>

          {/* Mobile number is mandatory for verification & safety coordination */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Mobile Number *
            </label>
            <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border transition-all ${phoneError ? 'border-red-300 bg-red-50/40' : 'border-slate-200 focus-within:border-travion-500 focus-within:ring-2 focus-within:ring-travion-100'}`}>
              <Phone className="w-4 h-4 text-travion-500 shrink-0" />
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full bg-transparent text-sm font-semibold focus:outline-none placeholder:text-slate-300"
              />
            </div>
            <p className={`text-[11px] mt-1 font-medium ${phoneError ? 'text-red-600' : 'text-slate-400'}`}>
              {phoneError || 'Used once for guide verification and safety coordination. Never shown publicly.'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Preferred Navigation Communication</label>
            <div className="grid grid-cols-3 gap-2">
              {(['Voice', 'Text', 'Both'] as const).map((pref) => (
                <button
                  key={pref}
                  type="button"
                  onClick={() => setCommPreference(pref)}
                  className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                    commPreference === pref
                      ? 'bg-travion-600 text-white border-travion-600 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-travion-50'
                  }`}
                >
                  {pref}
                </button>
              ))}
            </div>
          </div>

          {/* Emergency Contact */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-slate-800">
              <Shield className="w-4 h-4 text-travion-600" />
              <span>Emergency Contact (Safety Assurance)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={emergencyName}
                onChange={(e) => setEmergencyName(e.target.value)}
                placeholder="Contact Name (e.g. Sunil)"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold focus:border-travion-500 focus:outline-none bg-white"
              />
              <input
                type="tel"
                inputMode="numeric"
                value={emergencyPhone}
                onChange={(e) => handleEmergencyPhoneChange(e.target.value)}
                placeholder="10-digit mobile (e.g. 9876543210)"
                className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold focus:border-travion-500 focus:outline-none bg-white ${
                  emergencyPhoneError ? 'border-red-300 bg-red-50/40' : 'border-slate-200'
                }`}
              />
            </div>
            {emergencyPhoneError && (
              <p className="mt-1 text-[11px] font-semibold text-red-600">{emergencyPhoneError}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !firstName || !lastName || !phoneValid || !!emergencyPhoneError}
            className="w-full py-3 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white font-bold text-sm shadow-md hover:shadow-soft flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            <span>Save & Continue</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </motion.div>
    </div>
  );
};
