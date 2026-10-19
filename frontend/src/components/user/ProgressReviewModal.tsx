import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  MapPin,
  Calendar,
  Users,
  Plane,
  TrainFront,
  Bus,
  BedDouble,
  Compass,
  Car,
  Wallet,
  Sparkles,
  Edit3,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { StageState, TripItem } from '../../types';

interface ProgressReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  trip: TripItem | null;
  stageState: StageState | null;
  answers: Record<string, any>;
  onNavigateToStep: (view: string) => void;
}

export const ProgressReviewModal: React.FC<ProgressReviewModalProps> = ({
  isOpen,
  onClose,
  trip,
  stageState,
  answers,
  onNavigateToStep,
}) => {
  if (!isOpen || !trip) return null;

  const party = answers?.party || {};
  const totalTravellers = Number(party.total || answers?.total_travellers || 1);
  const adults = Number(party.adults || 1);
  const children = Number(party.children || 0);

  const transport = stageState?.transport?.selected;
  const stay = stageState?.places?.stay;
  const placeItems = stageState?.places?.items || [];
  const mode = trip.mode || stageState?.mode;
  const budgetGate = stageState?.budget;

  const handleEdit = (stepView: string) => {
    onNavigateToStep(stepView);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-charcoal-950/70 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-3xl max-h-[90vh] rounded-3xl bg-white border border-charcoal-200 shadow-2xl flex flex-col overflow-hidden my-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-charcoal-100 bg-sand-50/70">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-travion-100 text-travion-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-extrabold text-charcoal-900">Your Trip Progress Review</h3>
              <p className="text-xs text-charcoal-500 font-medium">
                Review all your selections so far or edit any step
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-charcoal-400 hover:text-charcoal-700 hover:bg-sand-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {/* Step 1: Route & Dates */}
          <div className="p-4 rounded-2xl border border-charcoal-200 bg-white hover:border-travion-300 transition-colors flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg bg-sand-100 text-charcoal-600 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                01
              </span>
              <div>
                <span className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">
                  Route & Dates
                </span>
                <h4 className="text-sm font-extrabold text-charcoal-900 flex items-center gap-1.5 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-travion-600" />
                  {trip.source_name} → {trip.destination_name}
                </h4>
                <p className="text-xs text-charcoal-500 flex items-center gap-1.5 mt-1">
                  <Calendar className="w-3.5 h-3.5 text-charcoal-400" />
                  {trip.start_datetime ? new Date(trip.start_datetime).toLocaleDateString() : '—'} to{' '}
                  {trip.end_datetime ? new Date(trip.end_datetime).toLocaleDateString() : '—'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleEdit('search')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-charcoal-200 text-charcoal-700 hover:border-travion-300 text-xs font-bold transition-colors"
            >
              <Edit3 className="w-3 h-3 text-charcoal-400" /> Edit
            </button>
          </div>

          {/* Step 2: Travellers */}
          <div className="p-4 rounded-2xl border border-charcoal-200 bg-white hover:border-travion-300 transition-colors flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg bg-sand-100 text-charcoal-600 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                02
              </span>
              <div>
                <span className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">
                  Traveller Party
                </span>
                <h4 className="text-sm font-extrabold text-charcoal-900 flex items-center gap-1.5 mt-0.5">
                  <Users className="w-3.5 h-3.5 text-travion-600" />
                  {totalTravellers} Traveller{totalTravellers > 1 ? 's' : ''} ({adults} Adult{adults > 1 ? 's' : ''}
                  {children > 0 ? `, ${children} Child` : ''})
                </h4>
                {answers?.experience && (
                  <p className="text-xs text-charcoal-500 mt-1">
                    Style: {Array.isArray(answers.experience) ? answers.experience.join(' · ') : answers.experience}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleEdit('discovery')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-charcoal-200 text-charcoal-700 hover:border-travion-300 text-xs font-bold transition-colors"
            >
              <Edit3 className="w-3 h-3 text-charcoal-400" /> Edit
            </button>
          </div>

          {/* Step 3: Transport */}
          <div className="p-4 rounded-2xl border border-charcoal-200 bg-white hover:border-travion-300 transition-colors flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg bg-sand-100 text-charcoal-600 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                03
              </span>
              <div>
                <span className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">
                  Transport
                </span>
                {transport?.outbound || transport?.return ? (
                  <div className="space-y-1 mt-1 text-xs">
                    {transport.outbound && (
                      <p className="font-bold text-charcoal-800">
                        Outbound: {transport.outbound.operator} ({transport.outbound.type}) · ₹{transport.outbound.party_total}
                      </p>
                    )}
                    {transport.return && (
                      <p className="font-bold text-charcoal-800">
                        Return: {transport.return.operator} ({transport.return.type}) · ₹{transport.return.party_total}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-amber-700 mt-1 font-semibold">Transport not selected yet</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleEdit('transport')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-charcoal-200 text-charcoal-700 hover:border-travion-300 text-xs font-bold transition-colors"
            >
              <Edit3 className="w-3 h-3 text-charcoal-400" /> Edit
            </button>
          </div>

          {/* Step 4: Explore / Places */}
          <div className="p-4 rounded-2xl border border-charcoal-200 bg-white hover:border-travion-300 transition-colors flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg bg-sand-100 text-charcoal-600 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                04
              </span>
              <div>
                <span className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">
                  Curated Places & Highlights
                </span>
                <p className="text-xs font-bold text-charcoal-800 mt-1">
                  {placeItems.length > 0 ? `${placeItems.length} places selected in ${trip.destination_name}` : 'No places selected yet'}
                </p>
                {placeItems.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {placeItems.slice(0, 5).map((p, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-md bg-sand-100 text-[10.5px] font-semibold text-charcoal-600">
                        {p.name}
                      </span>
                    ))}
                    {placeItems.length > 5 && (
                      <span className="text-[10px] text-charcoal-400 font-bold self-center">+{placeItems.length - 5} more</span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleEdit('discovery_select')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-charcoal-200 text-charcoal-700 hover:border-travion-300 text-xs font-bold transition-colors"
            >
              <Edit3 className="w-3 h-3 text-charcoal-400" /> Edit
            </button>
          </div>

          {/* Step 5: Stay */}
          <div className="p-4 rounded-2xl border border-charcoal-200 bg-white hover:border-travion-300 transition-colors flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg bg-sand-100 text-charcoal-600 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                05
              </span>
              <div>
                <span className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">
                  Accommodation
                </span>
                {stay ? (
                  <div className="mt-1">
                    <h4 className="text-xs font-extrabold text-charcoal-900 flex items-center gap-1">
                      <BedDouble className="w-3.5 h-3.5 text-travion-600" />
                      {stay.name}
                    </h4>
                    <p className="text-[11px] text-charcoal-500 mt-0.5">
                      ₹{stay.price?.toLocaleString('en-IN')} / room / night
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-amber-700 mt-1 font-semibold">Stay selection pending</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleEdit('stay_select')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-charcoal-200 text-charcoal-700 hover:border-travion-300 text-xs font-bold transition-colors"
            >
              <Edit3 className="w-3 h-3 text-charcoal-400" /> Edit
            </button>
          </div>

          {/* Step 6: Mode */}
          <div className="p-4 rounded-2xl border border-charcoal-200 bg-white hover:border-travion-300 transition-colors flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg bg-sand-100 text-charcoal-600 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                06
              </span>
              <div>
                <span className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">
                  Travel Experience Mode
                </span>
                <p className="text-xs font-bold text-charcoal-800 mt-1">
                  {mode === 'GUIDE_MODE' ? 'Guide Mode (Local Verified Expert Guide + AI)' : 'Adventurous Mode (Independent AI Travel)'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleEdit('mode_select')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-charcoal-200 text-charcoal-700 hover:border-travion-300 text-xs font-bold transition-colors"
            >
              <Edit3 className="w-3 h-3 text-charcoal-400" /> Edit
            </button>
          </div>

          {/* Step 8: Budget Breakdown */}
          {budgetGate && (
            <div className="p-4 rounded-2xl border border-charcoal-200 bg-sand-50 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="w-8 h-8 rounded-lg bg-white border border-charcoal-200 text-charcoal-600 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                  08
                </span>
                <div>
                  <span className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">
                    Budget Summary
                  </span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-base font-black text-charcoal-900">
                      ₹{budgetGate.final_amount?.toLocaleString('en-IN')}
                    </span>
                    <span className="text-xs text-charcoal-500 font-semibold">
                      (Total Planned Cost)
                    </span>
                  </div>
                  <p className="text-[11px] text-charcoal-500 mt-0.5">
                    Budget Ceiling: ₹{budgetGate.budget_max?.toLocaleString('en-IN')} · Remaining: ₹{budgetGate.remaining_budget?.toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleEdit('budget_food')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-charcoal-200 text-charcoal-700 hover:border-travion-300 text-xs font-bold transition-colors"
              >
                <Edit3 className="w-3 h-3 text-charcoal-400" /> Edit
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-charcoal-100 bg-sand-50/50 flex items-center justify-between">
          <span className="text-xs font-bold text-charcoal-500">
            Click any Edit button to return to that step
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 h-10 rounded-xl bg-charcoal-900 hover:bg-charcoal-800 text-white text-xs font-black uppercase tracking-wider transition-colors"
          >
            Close Review
          </button>
        </div>
      </motion.div>
    </div>
  );
};
