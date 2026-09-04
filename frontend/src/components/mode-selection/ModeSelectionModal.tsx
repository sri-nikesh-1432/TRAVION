import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Compass, Mountain, CheckCircle2, ShieldCheck, X, FileText, ArrowRight } from 'lucide-react';

interface ModeSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: 'GUIDE_MODE' | 'ADVENTUROUS_MODE') => void;
  destinationName: string;
}

export const ModeSelectionModal: React.FC<ModeSelectionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  destinationName
}) => {
  const [selectedMode, setSelectedMode] = useState<'GUIDE_MODE' | 'ADVENTUROUS_MODE' | null>(null);
  const [hasAcknowledged, setHasAcknowledged] = useState(false);
  const [showPdfViewer, setShowPdfViewer] = useState(false);

  if (!isOpen) return null;

  const guideFeatures = [
    "Verified local human guide, language & destination matched",
    "Complete door-to-door itinerary with verified transport & stay",
    "Curated local food tastings & guide-submitted hidden spots",
    "Live turn-by-turn navigation & live traveller avatar",
    "Direct in-app guide chat (unlocked on assignment)",
    "Trip-scoped AI assistant & full offline package",
    "Real dynamic replanning with explanation"
  ];

  const adventurousFeatures = [
    "Self-guided autonomous exploration (no human guide assigned)",
    "Explicit train/bus numbers, schedules & departure platforms",
    "Verified stays, curated food spots & attraction waypoints",
    "Voice turn-by-turn navigation & offline trip package",
    "Dedicated 24/7 tourist emergency helpline & police hotline",
    "Trip-scoped AI assistant & dynamic replanning engine"
  ];

  const handleContinue = () => {
    if (selectedMode && hasAcknowledged) {
      onConfirm(selectedMode);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="relative w-full max-w-3xl bg-white rounded-3xl shadow-floating border border-travion-100 p-6 md:p-8 overflow-hidden my-8"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Travel Mode Selection</span>
            <h2 className="text-2xl font-bold text-slate-900">Choose Your Travel Experience for {destinationName}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Two Large Side-by-Side Mode Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 my-6">
          
          {/* 1. Guide Mode Card */}
          <div
            onClick={() => {
              setSelectedMode('GUIDE_MODE');
              setHasAcknowledged(false);
            }}
            className={`cursor-pointer rounded-2xl p-5 border-2 transition-all flex flex-col justify-between ${
              selectedMode === 'GUIDE_MODE'
                ? 'border-travion-500 bg-travion-50/50 shadow-soft ring-2 ring-travion-200'
                : 'border-slate-200 hover:border-travion-300 hover:shadow-sm bg-white'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="w-12 h-12 rounded-xl bg-travion-100 text-travion-600 flex items-center justify-center">
                  <Compass className="w-6 h-6" />
                </div>
                {selectedMode === 'GUIDE_MODE' && (
                  <CheckCircle2 className="w-6 h-6 text-travion-600" />
                )}
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Guide Mode</h3>
              <p className="text-xs text-slate-500 mb-4">
                Full accompaniment with an operations-vetted regional local guide.
              </p>
              <ul className="space-y-2">
                {guideFeatures.slice(0, 5).map((f, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-slate-700 font-medium">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between text-xs font-semibold text-travion-700">
              <span>Verified Guide Network</span>
              <span>Dynamic guide fee</span>
            </div>
          </div>

          {/* 2. Adventurous Mode Card */}
          <div
            onClick={() => {
              setSelectedMode('ADVENTUROUS_MODE');
              setHasAcknowledged(false);
            }}
            className={`cursor-pointer rounded-2xl p-5 border-2 transition-all flex flex-col justify-between ${
              selectedMode === 'ADVENTUROUS_MODE'
                ? 'border-travion-500 bg-travion-50/50 shadow-soft ring-2 ring-travion-200'
                : 'border-slate-200 hover:border-travion-300 hover:shadow-sm bg-white'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
                  <Mountain className="w-6 h-6" />
                </div>
                {selectedMode === 'ADVENTUROUS_MODE' && (
                  <CheckCircle2 className="w-6 h-6 text-travion-600" />
                )}
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Adventurous Mode</h3>
              <p className="text-xs text-slate-500 mb-4">
                Self-guided independent travel backed by AI navigation & emergency assurance.
              </p>
              <ul className="space-y-2">
                {adventurousFeatures.slice(0, 5).map((f, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-slate-700 font-medium">
                    <CheckCircle2 className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between text-xs font-semibold text-slate-600">
              <span>Self-Navigated AI Trip</span>
              <span>₹0 guide fee</span>
            </div>
          </div>

        </div>

        {/* Acknowledgement and Consent Callout */}
        <AnimatePresence>
          {selectedMode && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-2xl bg-slate-50 border border-slate-200 p-4 mb-6"
            >
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-travion-600 shrink-0 mt-0.5" />
                <div className="w-full">
                  <div className="font-semibold text-slate-800 text-sm mb-1">
                    {selectedMode === 'GUIDE_MODE' ? 'Guide Mode Acknowledgement' : 'Adventurous Mode Terms & Emergency Briefing'}
                  </div>
                  <p className="text-xs text-slate-600 mb-3">
                    {selectedMode === 'GUIDE_MODE'
                      ? 'In Guide Mode, a verified regional local guide will be matched by Operations Manager. Location sharing is scoped solely to this trip for navigation and safety coordination.'
                      : 'In Adventurous Mode, you are travelling independently without human guide accompaniment. Verified transport schedules and emergency hotlines are provided in your itinerary.'}
                  </p>
                  
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-200">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                      <input
                        type="checkbox"
                        checked={hasAcknowledged}
                        onChange={(e) => setHasAcknowledged(e.target.checked)}
                        className="w-4 h-4 text-travion-600 rounded border-slate-300 focus:ring-travion-500"
                      />
                      <span>I understand and accept the trip terms, safety guidelines and permissions.</span>
                    </label>

                    <button
                      type="button"
                      onClick={() => setShowPdfViewer(true)}
                      className="text-xs font-bold text-travion-600 hover:text-travion-700 flex items-center gap-1 hover:underline"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>View Terms & Conditions</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action Button */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedMode || !hasAcknowledged}
            onClick={handleContinue}
            className="px-6 py-2.5 rounded-xl bg-travion-600 hover:bg-travion-700 text-white font-bold text-sm shadow-md hover:shadow-soft transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <span>Proceed to Itinerary</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* PDF-Style Terms & Conditions Modal Viewer */}
        <AnimatePresence>
          {showPdfViewer && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md"
            >
              <motion.div
                initial={{ scale: 0.95, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 20 }}
                className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
              >
                {/* PDF Header Bar */}
                <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-travion-400" />
                    <span className="font-bold text-sm tracking-wide">Travion Terms & Safety Charter (PDF Document)</span>
                  </div>
                  <button
                    onClick={() => setShowPdfViewer(false)}
                    className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* PDF Content Area */}
                <div className="p-6 md:p-8 overflow-y-auto space-y-4 text-xs text-slate-700 leading-relaxed font-serif">
                  <div className="border-b pb-3 mb-4 text-center font-sans">
                    <h4 className="text-base font-bold text-slate-900">TRAVION TRAVEL ORCHESTRATION PLATFORM</h4>
                    <p className="text-[11px] text-slate-500">Document ID: TC-TRV-2026-V1 · Verified Safety Protocol</p>
                  </div>

                  <h5 className="font-sans font-bold text-slate-900 text-sm">1. Scope of Orchestration</h5>
                  <p>Travion provides software orchestration connecting travellers with verified transport schedules, accommodation providers, dining spots, and independent local guides. Travion operates as a technology coordinator.</p>

                  <h5 className="font-sans font-bold text-slate-900 text-sm">2. Guide Mode & Safety Supervision</h5>
                  <p>Guides assigned through Travion are vetted by regional operations managers for destination expertise, language fluency, and local safety protocols. Location sharing is strictly trip-scoped and terminates upon trip completion.</p>

                  <h5 className="font-sans font-bold text-slate-900 text-sm">3. Adventurous Mode Autonomous Waiver</h5>
                  <p>Travellers selecting Adventurous Mode acknowledge self-directed navigation. Travion furnishes verified timetables, offline route metadata, and 24/7 medical and police hotlines.</p>

                  <h5 className="font-sans font-bold text-slate-900 text-sm">4. Transparent Payment Settlement</h5>
                  <p>All fees are segregated at checkout. Guide fees are held in operational escrow until tour fulfillment and disbursed directly to the verified guide upon trip completion.</p>
                </div>

                {/* PDF Footer */}
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowPdfViewer(false)}
                    className="px-5 py-2 rounded-xl bg-slate-900 text-white font-sans font-semibold text-xs hover:bg-slate-800 transition-colors"
                  >
                    Close Document
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </div>
  );
};
