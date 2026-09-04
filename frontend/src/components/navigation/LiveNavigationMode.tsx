import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Navigation, ArrowUp, ArrowRight, ArrowLeft, Volume2, VolumeX,
  X, MapPin, CheckCircle2, ShieldCheck
} from 'lucide-react';
import { ItineraryStop } from '../../types';

interface LiveNavigationModeProps {
  destinationStop: ItineraryStop;
  onExit: () => void;
}

export const LiveNavigationMode: React.FC<LiveNavigationModeProps> = ({
  destinationStop,
  onExit
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const navigationSteps = [
    { instruction: `Head northeast on Transit Road toward ${destinationStop.location_name}`, distance: '250 m', icon: ArrowUp },
    { instruction: 'Turn right onto Nilgiri Hill View Highway', distance: '1.2 km', icon: ArrowRight },
    { instruction: 'Keep left past the Tea Estate Viewpoint gate', distance: '400 m', icon: ArrowLeft },
    { instruction: `You have arrived at ${destinationStop.title}`, distance: 'Destination', icon: CheckCircle2 }
  ];

  const currentStep = navigationSteps[stepIndex];

  // Voice synthesis helper
  const speakInstruction = (text: string) => {
    if (isMuted || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    speakInstruction(currentStep.instruction);
  }, [stepIndex, isMuted]);

  const handleNextStep = () => {
    if (stepIndex < navigationSteps.length - 1) {
      setStepIndex(prev => prev + 1);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col justify-between p-4 md:p-6 bg-slate-950/90 backdrop-blur-md"
    >
      {/* Top Banner: Next Turn Instruction */}
      <div className="w-full max-w-xl mx-auto bg-travion-600 text-white rounded-3xl p-5 shadow-2xl flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-3xl font-bold">
            <currentStep.icon className="w-8 h-8" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-travion-200 font-bold">
              In {currentStep.distance}
            </div>
            <h2 className="text-lg md:text-xl font-black leading-tight">
              {currentStep.instruction}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 transition-colors"
            title={isMuted ? "Unmute Voice Guidance" : "Mute Voice Guidance"}
          >
            {isMuted ? <VolumeX className="w-5 h-5 text-red-300" /> : <Volume2 className="w-5 h-5 text-white" />}
          </button>
          <button
            onClick={onExit}
            className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 transition-colors"
            title="Exit Navigation"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* Center Simulated Live Road Simulation */}
      <div className="flex-1 flex items-center justify-center my-6">
        <div className="relative w-full max-w-md h-72 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden">
          {/* Animated Road Perspective Lines */}
          <motion.div
            animate={{ y: [0, 40] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
            className="absolute inset-0 flex justify-center"
          >
            <div className="w-2 border-r-2 border-dashed border-travion-400/40 h-full" />
          </motion.div>

          {/* Animated Moving Avatar */}
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
            className="relative z-10 flex flex-col items-center"
          >
            <div className="w-16 h-16 rounded-full bg-travion-500 border-4 border-white shadow-floating flex items-center justify-center text-white">
              <Navigation className="w-8 h-8" />
            </div>
            <span className="mt-2 px-3 py-1 rounded-full bg-white/90 text-[10px] font-black tracking-wide text-slate-900 shadow-md">
              TRAVION GPS ACTIVE
            </span>
          </motion.div>
        </div>
      </div>

      {/* Bottom Card: ETA, Distance, Destination Name & Next Simulation Button */}
      <div className="w-full max-w-xl mx-auto bg-white rounded-3xl p-5 shadow-2xl flex items-center justify-between">
        <div>
          <div className="text-[11px] font-bold text-slate-400 uppercase">Destination</div>
          <div className="text-base font-extrabold text-slate-900 truncate max-w-[200px]">
            {destinationStop.title}
          </div>
          <div className="text-xs text-emerald-600 font-bold mt-0.5">
            Estimated 18 min · 4.2 km remaining
          </div>
        </div>

        <div className="flex items-center gap-3">
          {stepIndex < navigationSteps.length - 1 ? (
            <button
              onClick={handleNextStep}
              className="px-5 py-3 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white font-bold text-xs shadow-md transition-all flex items-center gap-2"
            >
              <span>Next Turn</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onExit}
              className="px-5 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all"
            >
              Arrived & Exit
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};
