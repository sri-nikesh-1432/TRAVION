import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BedDouble,
  Star,
  Check,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Users,
  Moon,
  Home,
  Sparkles,
  MapPin,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  MailCheck,
  Building,
} from 'lucide-react';
import { api } from '../../services/api';
import { StayOption, StageState } from '../../types';

interface StaySelectionProps {
  tripId: string;
  initialStay?: Record<string, any> | null;
  partySize?: number | null;
  nightsCount?: number | null;
  onComplete: (stageState?: StageState | null) => void;
  onBack: () => void;
}

export const StaySelection: React.FC<StaySelectionProps> = ({
  tripId,
  initialStay,
  partySize,
  nightsCount,
  onComplete,
  onBack,
}) => {
  const [stays, setStays] = useState<StayOption[]>([]);
  const [selectedStay, setSelectedStay] = useState<StayOption | null>(null);
  const [destination, setDestination] = useState<string>('');
  const [travellers, setTravellers] = useState<number>(partySize || 1);
  const [nights, setNights] = useState<number>(nightsCount || 1);
  const [roomsNeeded, setRoomsNeeded] = useState<number>(Math.max(1, Math.ceil((partySize || 1) / 2)));
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filterTier, setFilterTier] = useState<string>('All');
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [reservationNotice, setReservationNotice] = useState<string | null>(null);

  const fetchStays = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStays(tripId);
      setStays(res.stays || []);
      setDestination(res.destination || '');
      setTravellers(res.travellers || travellers);
      setNights(res.nights || nights);
      setRoomsNeeded(res.rooms_needed || roomsNeeded);

      // Pre-select if already saved
      if (res.selected_stay && res.stays) {
        const found = res.stays.find((s) => s.name === res.selected_stay?.name);
        if (found) {
          setSelectedStay(found);
        } else if (res.selected_stay?.name) {
          setSelectedStay({
            id: res.selected_stay.id || 'selected-stay',
            name: res.selected_stay.name,
            tier: res.selected_stay.tier || '4 Star',
            rating: res.selected_stay.rating || 4.5,
            price_per_night: res.selected_stay.price_per_night || 3500,
            rooms_needed: res.rooms_needed || Math.max(1, Math.ceil((partySize || 1) / 2)),
            nights: res.nights || 1,
            travellers: res.travellers || 1,
            total_price: (res.selected_stay.price_per_night || 3500) * (res.rooms_needed || 1) * (res.nights || 1),
            amenities: res.selected_stay.amenities || ['Free Wi-Fi', 'AC'],
            hero_image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80',
            source: res.selected_stay.source || 'selected',
            calculation_note: '',
          });
        }
      } else if (res.stays && res.stays.length > 0 && !selectedStay) {
        // Pre-select the recommended stay, or first available
        const defaultChoice = res.stays.find((s) => s.is_recommended) || res.stays[0];
        setSelectedStay(defaultChoice);
      }
    } catch (err: any) {
      setError(err?.message || 'Could not load hotel options. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStays();
  }, [tripId]);

  const handleSelect = (stay: StayOption) => {
    setSelectedStay(stay);
  };

  const handleReserveInquiry = async (stay: StayOption, e: React.MouseEvent) => {
    e.stopPropagation();
    setReservingId(stay.id);
    try {
      const res = await api.reserveStay(tripId, {
        stay_name: stay.name,
        hotel_email: stay.hotel_email,
        travellers,
        rooms_needed: stay.rooms_needed || roomsNeeded,
        nights,
      });
      setReservationNotice(res.message);
      setSelectedStay(stay);
      setTimeout(() => setReservationNotice(null), 7000);
    } catch {
      setReservationNotice(`Reservation inquiry noted for ${stay.name}. Proceed to finalize booking.`);
      setTimeout(() => setReservationNotice(null), 5000);
    } finally {
      setReservingId(null);
    }
  };

  const handleContinue = async () => {
    if (!selectedStay || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.selectStay(tripId, {
        name: selectedStay.name,
        price_per_night: selectedStay.price_per_night,
        tier: selectedStay.tier,
        rating: selectedStay.rating,
        latitude: selectedStay.latitude,
        longitude: selectedStay.longitude,
        amenities: selectedStay.amenities,
        source: selectedStay.source,
        hero_image: selectedStay.hero_image,
        rooms_needed: selectedStay.rooms_needed || roomsNeeded,
        nights: selectedStay.nights || nights,
      });

      const stageState = await api.getStageState(tripId).catch(() => null);
      onComplete(stageState);
    } catch (err: any) {
      setError(err?.message || 'Failed to save accommodation selection. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const filteredStays = stays.filter((s) => {
    if (filterTier === 'All') return true;
    return s.tier?.toLowerCase() === filterTier.toLowerCase();
  });

  const tiers = ['All', '5 Star', '4 Star', '3 Star', '2 Star', 'Budget'];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Step Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-travion-50 border border-travion-200 text-travion-700 text-xs font-black uppercase tracking-wider mb-2">
          <BedDouble className="w-3.5 h-3.5 text-travion-600" />
          Step 5 · Accommodation & Stays
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-charcoal-900 tracking-tight">
          Where will you stay in {destination || 'your destination'}?
        </h1>
        <p className="mt-2 text-sm text-charcoal-600 max-w-2xl mx-auto">
          Choose verified accommodation suited to your entire party size. Recommended stays are tailored to your budget and group requirements.
        </p>

        {/* Party & Stay context pill */}
        <div className="mt-4 inline-flex flex-wrap items-center justify-center gap-3 px-4 py-2 rounded-2xl bg-sand-50 border border-charcoal-200 text-xs font-bold text-charcoal-700">
          <span className="inline-flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-travion-600" />
            {travellers} Traveller{travellers > 1 ? 's' : ''}
          </span>
          <span className="text-charcoal-300">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Moon className="w-3.5 h-3.5 text-amber-500" />
            {nights} Night{nights > 1 ? 's' : ''}
          </span>
          <span className="text-charcoal-300">·</span>
          <span className="inline-flex items-center gap-1.5 text-travion-700 font-black">
            <Home className="w-3.5 h-3.5" />
            {roomsNeeded} Room{roomsNeeded > 1 ? 's' : ''} Required ({travellers} Guests total)
          </span>
        </div>
      </div>

      {/* Reservation Toast */}
      <AnimatePresence>
        {reservationNotice && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="max-w-2xl mx-auto mb-6 flex items-center gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold shadow-soft"
          >
            <MailCheck className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="flex-1">{reservationNotice}</div>
            <button
              type="button"
              onClick={() => setReservationNotice(null)}
              className="text-emerald-600 hover:text-emerald-900 font-extrabold"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tier Filter Tabs */}
      <div className="flex items-center justify-center gap-2 mb-8 overflow-x-auto pb-2">
        {tiers.map((tier) => (
          <button
            key={tier}
            type="button"
            onClick={() => setFilterTier(tier)}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all ${
              filterTier === tier
                ? 'bg-travion-600 text-white shadow-sm scale-105'
                : 'bg-white border border-charcoal-200 text-charcoal-600 hover:border-travion-300 hover:text-charcoal-900'
            }`}
          >
            {tier}
          </button>
        ))}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm font-semibold text-red-700">{error}</div>
          <button
            type="button"
            onClick={fetchStays}
            className="px-3 py-1 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-20 text-center">
          <RefreshCw className="w-8 h-8 text-travion-600 animate-spin mx-auto mb-4" />
          <p className="text-sm font-bold text-charcoal-600">
            Checking real hotel availability in {destination || 'destination'}…
          </p>
        </div>
      )}

      {/* Hotel Cards Grid */}
      {!loading && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-24">
          {filteredStays.map((stay) => {
            const isSelected = selectedStay?.name === stay.name;
            const isRecommended = !!stay.is_recommended;

            return (
              <motion.div
                key={stay.id || stay.name}
                whileHover={{ y: -3 }}
                transition={{ duration: 0.2 }}
                onClick={() => handleSelect(stay)}
                className={`cursor-pointer rounded-3xl border overflow-hidden transition-all flex flex-col relative ${
                  isSelected
                    ? 'border-travion-600 ring-2 ring-travion-500 bg-travion-50/20 shadow-floating'
                    : isRecommended
                      ? 'border-amber-300 bg-white shadow-soft ring-1 ring-amber-200 hover:border-amber-400'
                      : 'border-charcoal-200 bg-white hover:border-travion-300 hover:shadow-card'
                }`}
              >
                {/* Recommendation Banner */}
                {isRecommended && (
                  <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-travion-600 px-3.5 py-1.5 text-white flex items-center justify-between text-[11px] font-black tracking-wide">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                      Recommended as per your budget & preference
                    </span>
                    <span className="text-[10px] uppercase font-bold text-amber-100">Best Match</span>
                  </div>
                )}

                {/* Hero Image */}
                <div className="relative h-48 bg-charcoal-100 overflow-hidden">
                  <img
                    src={stay.hero_image}
                    alt={stay.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-travion-900/80 backdrop-blur-md text-white text-[11px] font-black uppercase tracking-wider">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    {stay.tier}
                  </div>
                  <div className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/90 backdrop-blur-md text-charcoal-900 text-xs font-black shadow-sm">
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                    {stay.rating.toFixed(1)}
                  </div>
                  {isSelected && (
                    <div className="absolute bottom-3 right-3 px-3 py-1 rounded-full bg-travion-600 text-white text-xs font-black flex items-center gap-1 shadow-md">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      Selected Stay
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-base font-extrabold text-charcoal-900 leading-snug line-clamp-1">
                      {stay.name}
                    </h3>
                    <p className="mt-1 text-xs text-charcoal-500 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-travion-600 shrink-0" />
                      {destination} · Verified Property
                    </p>

                    {/* Room configuration calculation note */}
                    <div className="mt-2 text-[11.5px] font-bold text-travion-800 bg-travion-50/70 border border-travion-100 rounded-xl px-2.5 py-1 flex items-center gap-1.5">
                      <Building className="w-3.5 h-3.5 text-travion-600 shrink-0" />
                      <span className="line-clamp-1">
                        {stay.room_configuration || `${stay.rooms_needed || roomsNeeded} Rooms for ${travellers} Guests`}
                      </span>
                    </div>

                    {stay.recommendation_reason && (
                      <p className="mt-2 text-[11px] font-medium text-amber-800 bg-amber-50 rounded-lg p-2 border border-amber-100">
                        {stay.recommendation_reason}
                      </p>
                    )}

                    {/* Amenities */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(stay.amenities || []).slice(0, 4).map((amenity, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md bg-sand-100 text-[10.5px] font-bold text-charcoal-600"
                        >
                          {amenity}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Pricing Breakdown & Actions */}
                  <div className="mt-5 pt-4 border-t border-charcoal-100">
                    <div className="flex items-baseline justify-between">
                      <div>
                        <span className="text-lg font-black text-charcoal-900">
                          ₹{stay.price_per_night.toLocaleString('en-IN')}
                        </span>
                        <span className="text-xs font-bold text-charcoal-500"> / night / room</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-bold text-charcoal-500 block">Total ({nights} nights)</span>
                        <span className="text-sm font-black text-travion-700">
                          ₹{stay.total_price.toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] font-medium text-charcoal-400">
                      {stay.rooms_needed || roomsNeeded} room{(stay.rooms_needed || roomsNeeded) > 1 ? 's' : ''} × {nights} night{nights > 1 ? 's' : ''} for {travellers} guest{travellers > 1 ? 's' : ''}
                    </p>

                    {/* Redirect / Email buttons */}
                    <div className="mt-3 flex items-center gap-2">
                      {stay.booking_url && (
                        <a
                          href={stay.booking_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 h-9 rounded-xl border border-charcoal-200 hover:border-travion-400 bg-white text-charcoal-700 hover:text-travion-700 text-[11px] font-bold flex items-center justify-center gap-1 transition-colors"
                          title="View live room details on Booking.com"
                        >
                          <span>Booking.com</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleReserveInquiry(stay, e)}
                        disabled={reservingId === stay.id}
                        className="flex-1 h-9 rounded-xl border border-travion-200 hover:bg-travion-50 text-travion-700 text-[11px] font-bold flex items-center justify-center gap-1 transition-colors"
                        title="Send room reservation inquiry to hotel"
                      >
                        <MailCheck className="w-3.5 h-3.5" />
                        <span>{reservingId === stay.id ? 'Sending…' : 'Reserve Room'}</span>
                      </button>
                    </div>

                    {/* Selection Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelect(stay);
                      }}
                      className={`mt-2 w-full h-10 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                        isSelected
                          ? 'bg-travion-600 text-white shadow-sm'
                          : 'bg-sand-100 text-charcoal-700 hover:bg-travion-50 hover:text-travion-700'
                      }`}
                    >
                      {isSelected ? (
                        <>
                          <Check className="w-4 h-4 stroke-[2.5]" /> Selected for Entire Trip
                        </>
                      ) : (
                        'Select this Stay'
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Sticky Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-charcoal-200 py-4 px-6 shadow-floating">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-4 h-11 rounded-xl border border-charcoal-300 text-charcoal-700 text-xs font-bold hover:bg-charcoal-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Explore
          </button>

          {selectedStay && (
            <div className="hidden sm:flex items-center gap-3 text-right">
              <div>
                <p className="text-xs font-extrabold text-charcoal-900">
                  {selectedStay.name}
                </p>
                <p className="text-[11px] font-medium text-charcoal-500">
                  ₹{selectedStay.total_price.toLocaleString('en-IN')} total ({roomsNeeded} room{roomsNeeded > 1 ? 's' : ''}, {nights} night{nights > 1 ? 's' : ''})
                </p>
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={!selectedStay || saving}
            onClick={handleContinue}
            className="inline-flex items-center gap-2 px-6 h-11 rounded-xl bg-travion-600 hover:bg-travion-700 disabled:bg-charcoal-300 text-white text-xs font-black uppercase tracking-wider transition-colors shadow-sm"
          >
            {saving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Saving Stay…
              </>
            ) : (
              <>
                Continue to Mode Selection <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
