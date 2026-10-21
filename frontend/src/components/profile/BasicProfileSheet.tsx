import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  User,
  Phone,
  Globe,
  Shield,
  ArrowRight,
  CheckCircle2,
  X,
  Camera,
  MapPin,
  Heart,
  Sparkles,
  Mail,
} from 'lucide-react';
import { api } from '../../services/api';
import { UserProfile } from '../../types';

interface BasicProfileSheetProps {
  initialData?: Partial<UserProfile>;
  userEmail?: string;
  onComplete: () => void;
  onClose?: () => void;
}

const PRESET_AVATARS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=256&q=80',
];

const POPULAR_SOURCE_CITIES = [
  'Chennai',
  'Hyderabad',
  'Bangalore',
  'Mumbai',
  'Delhi',
  'Kolkata',
  'Kochi',
  'Pune',
  'Jaipur',
];

const ALL_INTERESTS = [
  '🌲 Nature & Wildlife',
  '🏛️ Historic Heritage',
  '🏖️ Azure Coasts & Beaches',
  '🍲 Street Food & Gourmet',
  '🏔️ Mountain Treks',
  '🧘 Spiritual Ghats & Peace',
  '📸 Photography & Sunsets',
  '🏰 Royal Palaces & Forts',
  '☕ Tea & Coffee Estates',
];

export const BasicProfileSheet: React.FC<BasicProfileSheetProps> = ({
  initialData,
  userEmail,
  onComplete,
  onClose,
}) => {
  const [firstName, setFirstName] = useState(initialData?.first_name || '');
  const [lastName, setLastName] = useState(initialData?.last_name || '');
  const [preferredName, setPreferredName] = useState(initialData?.preferred_name || '');
  const [photoUrl, setPhotoUrl] = useState(
    initialData?.photo_url || localStorage.getItem('travion_user_photo') || PRESET_AVATARS[0]
  );
  const [gender, setGender] = useState(initialData?.gender || 'Prefer not to say');
  const [language, setLanguage] = useState(initialData?.preferred_language || 'English');
  const [country, setCountry] = useState(initialData?.country || 'India');
  const [homeCity, setHomeCity] = useState(
    initialData?.home_city || localStorage.getItem('travion_permanent_source') || 'Chennai'
  );
  const [phone, setPhone] = useState(initialData?.phone || '');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [homeCityError, setHomeCityError] = useState<string | null>(null);
  const [commPreference, setCommPreference] = useState<'Voice' | 'Text' | 'Both'>(
    initialData?.preferred_communication || 'Both'
  );

  const [selectedInterests, setSelectedInterests] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('travion_user_interests');
      return saved ? JSON.parse(saved) : ['🌲 Nature & Wildlife', '🏛️ Historic Heritage', '🏖️ Azure Coasts & Beaches'];
    } catch {
      return ['🌲 Nature & Wildlife', '🏛️ Historic Heritage'];
    }
  });

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

  const handleEmergencyPhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').slice(0, 10);
    setEmergencyPhone(digits);
    if (digits.length > 0 && (digits.length < 10 || !/^[6-9]/.test(digits))) {
      setEmergencyPhoneError('Enter a valid 10-digit Indian mobile number (starting 6-9).');
    } else {
      setEmergencyPhoneError(null);
    }
  };

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!homeCity.trim()) {
      setHomeCityError('Please enter your permanent source / home city to continue.');
      return;
    }
    setHomeCityError(null);
    setIsSubmitting(true);
    try {
      // Save locally
      localStorage.setItem('travion_permanent_source', homeCity.trim());
      localStorage.setItem('travion_user_photo', photoUrl);
      localStorage.setItem('travion_user_interests', JSON.stringify(selectedInterests));

      await api.updateBasicProfile({
        first_name: firstName,
        last_name: lastName,
        preferred_name: preferredName || firstName,
        photo_url: photoUrl,
        gender,
        preferred_language: language,
        country,
        home_city: homeCity.trim(),
        phone,
        preferred_communication: commPreference,
        emergency_contact_name: emergencyName,
        emergency_contact_phone: emergencyPhone,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-2xl bg-[#FAF7F2] rounded-[32px] shadow-2xl border border-white/80 p-6 sm:p-8 my-8 relative max-h-[92vh] overflow-y-auto"
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-xl bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors border border-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className="text-center mb-6 space-y-2">
          {/* Profile Photo & Avatar Picker */}
          <div className="relative inline-block mx-auto">
            <div className="w-20 h-20 rounded-full overflow-hidden border-4 border-white shadow-lg mx-auto bg-sky-100">
              <img src={photoUrl} alt="Profile" className="w-full h-full object-cover" />
            </div>
            <span className="absolute bottom-0 right-0 p-1.5 rounded-full bg-sky-500 text-white shadow-sm">
              <Camera className="w-3.5 h-3.5" />
            </span>
          </div>

          <div className="flex items-center justify-center gap-2 pt-1">
            {PRESET_AVATARS.map((av, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setPhotoUrl(av)}
                className={`w-8 h-8 rounded-full overflow-hidden border-2 transition-all ${
                  photoUrl === av ? 'border-sky-500 scale-110 shadow-sm' : 'border-transparent opacity-60 hover:opacity-100'
                }`}
              >
                <img src={av} alt="avatar" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>

          <h2 className="text-2xl font-black text-slate-900 tracking-tight mt-3">
            Your Personal Traveller Profile
          </h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            This profile saves your permanent departure city and travel preferences so you never have to re-enter them.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-semibold">
          {/* Name fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-slate-700 font-bold mb-1">First Name *</label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="e.g. Datta"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm font-semibold focus:border-sky-500 focus:outline-none shadow-xs"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-bold mb-1">Last Name *</label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="e.g. Srinikesh"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm font-semibold focus:border-sky-500 focus:outline-none shadow-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-slate-700 font-bold mb-1">Preferred Name</label>
              <input
                type="text"
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
                placeholder="What should we call you?"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm font-semibold focus:border-sky-500 focus:outline-none shadow-xs"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-bold mb-1 flex items-center gap-1">
                <Mail className="w-3.5 h-3.5 text-sky-500" />
                <span>Account Email</span>
              </label>
              <input
                type="email"
                disabled
                value={userEmail || initialData?.id || 'traveller@travion.in'}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-slate-500 text-sm font-mono cursor-not-allowed shadow-xs"
              />
            </div>
          </div>

          {/* PERMANENT SOURCE CITY (CRITICAL REQUIREMENT) */}
          <div className="p-4 rounded-2xl bg-white border border-sky-100 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-slate-900 font-black flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-sky-600" />
                <span>Permanent Source City (Default Departure Hub) *</span>
              </label>
              <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200">
                Default Origin
              </span>
            </div>

            <p className="text-[11px] text-slate-500 font-normal">
              This city will be automatically selected as your starting location whenever you plan a new trip.
            </p>

            <input
              type="text"
              required
              value={homeCity}
              onChange={(e) => {
                setHomeCity(e.target.value);
                if (homeCityError) setHomeCityError(null);
              }}
              placeholder="e.g. Chennai, Bangalore, Hyderabad"
              className={`w-full px-3.5 py-2.5 rounded-xl border text-sm font-semibold focus:border-sky-500 focus:outline-none ${
                homeCityError ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white text-slate-900'
              }`}
            />
            {homeCityError && (
              <p className="text-[11px] font-semibold text-red-600">{homeCityError}</p>
            )}

            {/* Quick city chips */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {POPULAR_SOURCE_CITIES.map((city) => (
                <button
                  key={city}
                  type="button"
                  onClick={() => setHomeCity(city)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    homeCity.toLowerCase() === city.toLowerCase()
                      ? 'bg-sky-500 text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {city}
                </button>
              ))}
            </div>
          </div>

          {/* Mobile phone number */}
          <div>
            <label className="block text-slate-700 font-bold mb-1">
              Mobile Phone Number *
            </label>
            <div
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border bg-white transition-all ${
                phoneError
                  ? 'border-red-300 bg-red-50/40'
                  : 'border-slate-200 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-100'
              }`}
            >
              <Phone className="w-4 h-4 text-sky-500 shrink-0" />
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full bg-transparent text-sm font-semibold focus:outline-none placeholder:text-slate-300 text-slate-900"
              />
            </div>
            <p className={`text-[11px] mt-1 font-medium ${phoneError ? 'text-red-600' : 'text-slate-500'}`}>
              {phoneError || 'Used for verification and trip coordinator updates.'}
            </p>
          </div>

          {/* TRAVEL INTERESTS & STYLE (CRITICAL REQUIREMENT) */}
          <div className="p-4 rounded-2xl bg-white border border-pink-100 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-slate-900 font-black flex items-center gap-1.5">
                <Heart className="w-4 h-4 text-pink-500" />
                <span>Your Travel Interests & Style</span>
              </label>
              <span className="text-[10px] font-bold text-pink-700 bg-pink-50 px-2 py-0.5 rounded-full border border-pink-200">
                {selectedInterests.length} Selected
              </span>
            </div>

            <p className="text-[11px] text-slate-500 font-normal">
              Select your favorite travel vibes so we can highlight relevant experiences.
            </p>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {ALL_INTERESTS.map((interest) => {
                const isSelected = selectedInterests.includes(interest);
                return (
                  <button
                    key={interest}
                    type="button"
                    onClick={() => toggleInterest(interest)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                      isSelected
                        ? 'bg-pink-500 text-white shadow-xs'
                        : 'bg-[#FAF7F2] hover:bg-slate-200 text-slate-700 border border-slate-200/80'
                    }`}
                  >
                    <span>{interest}</span>
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Save Button */}
          <button
            type="submit"
            disabled={isSubmitting || !firstName || !lastName || !phoneValid}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 via-sky-600 to-sky-500 hover:from-sky-600 hover:to-sky-700 text-white font-black text-sm shadow-md shadow-sky-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            <span>Save Profile & Permanent Source</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </motion.div>
    </div>
  );
};
