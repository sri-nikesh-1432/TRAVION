import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Compass, Mountain, Check, ArrowRight, ShieldCheck, Bot, MapPinned,
  MessageSquareText, Volume2, Languages, UserCheck, Footprints, Siren, Sparkles,
} from 'lucide-react';

export type TripMode = 'GUIDE_MODE' | 'ADVENTUROUS_MODE';

interface ModeSelectionScreenProps {
  destinationName: string;
  placeCount: number;
  activityCount: number;
  foodCount: number;
  hasStay: boolean;
  /** The FINAL edited plan's cost — repriced server-side once a mode is picked. */
  totalCost?: number;
  onBack: () => void;
  onSelect: (mode: TripMode) => void;
  busy?: boolean;
}

interface Feature {
  icon: React.ReactNode;
  text: string;
}

/**
 * "How would you like to experience your trip?" — the full-width mode
 * selection shown ONLY after Step 3 destination discovery is complete and the
 * user has finished selecting places, activities, restaurants and stays.
 *
 * This is a TRIP EXPERIENCE choice, not a registration mode:
 *   Guide Mode       = Human + AI assisted travel (12.5% guide fee applies)
 *   Adventurous Mode = Independent + AI assisted travel (no guide fee)
 */
export const ModeSelectionScreen: React.FC<ModeSelectionScreenProps> = ({
  destinationName, placeCount, activityCount, foodCount, hasStay, totalCost, onBack, onSelect, busy,
}) => {
  const [hovered, setHovered] = useState<TripMode | null>(null);

  const guideFeatures: Feature[] = [
    { icon: <UserCheck className="w-4 h-4" />, text: 'Verified local guide' },
    { icon: <Languages className="w-4 h-4" />, text: 'Destination & language matching' },
    { icon: <ShieldCheck className="w-4 h-4" />, text: 'Human assistance during the trip' },
    { icon: <MessageSquareText className="w-4 h-4" />, text: 'Guide chat once your guide is assigned' },
    { icon: <Sparkles className="w-4 h-4" />, text: 'Personalized local recommendations' },
    { icon: <MapPinned className="w-4 h-4" />, text: 'Trip-based guide assignment' },
  ];

  const adventurousFeatures: Feature[] = [
    { icon: <Footprints className="w-4 h-4" />, text: 'No guide required — explore independently' },
    { icon: <Bot className="w-4 h-4" />, text: 'AI trip assistant' },
    { icon: <MapPinned className="w-4 h-4" />, text: 'Live navigation' },
    { icon: <Volume2 className="w-4 h-4" />, text: 'Voice navigation' },
    { icon: <MessageSquareText className="w-4 h-4" />, text: 'Trip-specific chatbot' },
    { icon: <Siren className="w-4 h-4" />, text: 'Emergency information' },
  ];

  const ModeCard: React.FC<{
    mode: TripMode;
    icon: React.ReactNode;
    iconClass: string;
    emoji: string;
    title: string;
    subtitle: string;
    description: string;
    features: Feature[];
    footer: React.ReactNode;
    accentBorder: string;
    accentRing: string;
  }> = ({ mode, icon, iconClass, emoji, title, subtitle, description, features, footer, accentBorder, accentRing }) => {
    const active = hovered === mode;
    return (
      <motion.button
        type="button"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        whileHover={{ y: -4 }}
        onMouseEnter={() => setHovered(mode)}
        onMouseLeave={() => setHovered(null)}
        onClick={() => !busy && onSelect(mode)}
        disabled={busy}
        className={`relative text-left p-6 md:p-7 rounded-3xl border-2 bg-white shadow-soft transition-all flex flex-col ${
          active ? `${accentBorder} ${accentRing}` : 'border-slate-200 hover:border-slate-300'
        } ${busy ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
      >
        <div className="flex items-start justify-between">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${iconClass}`}>
            {icon}
          </div>
          <span className="text-2xl" aria-hidden>{emoji}</span>
        </div>
        <h3 className="mt-4 text-xl font-black text-slate-900 tracking-tight">{title}</h3>
        <p className="mt-0.5 text-[13px] font-bold text-travion-700">{subtitle}</p>
        <p className="mt-3 text-[12.5px] font-medium text-slate-600 leading-relaxed">{description}</p>

        <ul className="mt-4 space-y-2 flex-1">
          {features.map((f, i) => (
            <li key={i} className="flex items-center gap-2.5 text-[12.5px] font-semibold text-slate-700">
              <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                {f.icon}
              </span>
              {f.text}
            </li>
          ))}
        </ul>

        <div className="mt-5 pt-4 border-t border-slate-100">{footer}</div>

        <span className={`mt-4 inline-flex items-center justify-center gap-2 w-full h-11 rounded-2xl text-[13px] font-black transition-colors ${
          active ? 'bg-travion-600 text-white' : 'bg-slate-100 text-slate-700'
        }`}>
          {mode === 'GUIDE_MODE' ? 'Choose Guide Mode' : 'Choose Adventurous Mode'}
          <ArrowRight className="w-4 h-4" />
        </span>
      </motion.button>
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {/* Step split — where the traveller is in the booking journey */}
      <div className="flex items-center justify-center gap-2 mb-6" aria-label="Booking progress">
        {[
          { label: 'Plan', done: true },
          { label: 'Edit', done: true },
          { label: 'Experience', done: false },
          { label: 'Pay', done: false },
        ].map((s, i, arr) => (
          <React.Fragment key={s.label}>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black ${
              s.done ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-travion-50 text-travion-700 border border-travion-200'
            }`}>
              {s.done ? <Check className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
              {s.label}
            </span>
            {i < arr.length - 1 && <span className="w-5 h-px bg-slate-200" />}
          </React.Fragment>
        ))}
      </div>

      <div className="text-center mb-4">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Final step before payment</span>
        <h2 className="mt-2 text-3xl font-extrabold text-slate-900 tracking-tight">
          How would you like to experience your trip?
        </h2>
        <p className="mt-2 text-[14px] font-medium text-slate-500 max-w-2xl mx-auto">
          Your plan is ready
          {typeof totalCost === 'number' && totalCost > 0 ? <span className="font-bold text-slate-700"> (base cost ₹{Math.round(totalCost).toLocaleString('en-IN')})</span> : null}
          {destinationName ? <> in <span className="font-bold text-slate-700">{destinationName}</span></> : null}. Pick your experience — fees update instantly, your itinerary stays exactly as you built it.
        </p>
        {(placeCount > 0 || foodCount > 0 || hasStay) && (
          <div className="mt-4 inline-flex flex-wrap items-center justify-center gap-2">
            {placeCount > 0 && (
              <span className="px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-[11px] font-bold text-emerald-700">
                {placeCount} place{placeCount === 1 ? '' : 's'}
              </span>
            )}
            {activityCount > 0 && (
              <span className="px-3 py-1 rounded-full bg-sky-50 border border-sky-100 text-[11px] font-bold text-sky-700">
                {activityCount} activit{activityCount === 1 ? 'y' : 'ies'}
              </span>
            )}
            {foodCount > 0 && (
              <span className="px-3 py-1 rounded-full bg-amber-50 border border-amber-100 text-[11px] font-bold text-amber-700">
                {foodCount} food stop{foodCount === 1 ? '' : 's'}
              </span>
            )}
            {hasStay && (
              <span className="px-3 py-1 rounded-full bg-violet-50 border border-violet-100 text-[11px] font-bold text-violet-700">
                Stay selected
              </span>
            )}
          </div>
        )}
      </div>

      {/* The two cards must read as two trip EXPERIENCE paths — never two
          registration types. Guide = human + AI; Adventurous = independent + AI. */}
      <div className="grid md:grid-cols-2 gap-5 mt-8">
        <ModeCard
          mode="GUIDE_MODE"
          icon={<Compass className="w-7 h-7" />}
          iconClass="bg-travion-100 text-travion-700"
          emoji="🧑‍💼"
          title="Guide Mode"
          subtitle="Travel with a verified local guide"
          description="Get personalized support from a verified local guide who can accompany you during your trip — help with local experiences, navigation, recommendations and on-trip assistance."
          features={guideFeatures}
          footer={
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-cognac-600">
              <ShieldCheck className="w-3.5 h-3.5" />
              Human + AI travel · 12.5% guide fee added to this plan at checkout
            </span>
          }
          accentBorder="border-travion-400"
          accentRing="ring-4 ring-travion-100"
        />

        <ModeCard
          mode="ADVENTUROUS_MODE"
          icon={<Mountain className="w-7 h-7" />}
          iconClass="bg-amber-100 text-amber-700"
          emoji="🧭"
          title="Adventurous Mode"
          subtitle="Explore independently, with Travion by your side"
          description="Travel independently while Travion helps you with your itinerary, navigation, trip AI, safety information and real-time travel assistance."
          features={adventurousFeatures}
          footer={
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-amber-700">
              <Check className="w-3.5 h-3.5" />
              Independent + AI travel · no guide fee — only the 3% platform fee
            </span>
          }
          accentBorder="border-amber-400"
          accentRing="ring-4 ring-amber-100"
        />
      </div>

      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={onBack}
          className="text-[13px] font-bold text-slate-500 hover:text-slate-700 transition-colors"
        >
          Back to my plan
        </button>
      </div>
    </div>
  );
};
