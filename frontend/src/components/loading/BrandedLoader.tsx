import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Compass, Sparkles, MapPin, Navigation } from 'lucide-react';

interface BrandedLoaderProps {
  headline?: string;
  steps?: string[];
  durationPerStep?: number;
  onComplete?: () => void;
  fullScreen?: boolean;
}

const DEFAULT_STEPS = [
  "Analyzing your travel preferences & party style...",
  "Querying verified regional transport & schedule options...",
  "Evaluating verified boutique stays & scenic cottages...",
  "Integrating local culinary spots & guide-submitted hidden gems...",
  "Verifying regional safety guidelines and tourist hotlines...",
  "Finalizing your optimized day-by-day itinerary..."
];

export const BrandedLoader: React.FC<BrandedLoaderProps> = ({
  headline = "Planning your journey…",
  steps = DEFAULT_STEPS,
  durationPerStep = 900,
  onComplete,
  fullScreen = true
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev < steps.length - 1) {
          return prev + 1;
        } else {
          clearInterval(interval);
          if (onComplete) onComplete();
          return prev;
        }
      });
    }, durationPerStep);

    return () => clearInterval(interval);
  }, [steps, durationPerStep, onComplete]);

  const progressPercent = Math.min(100, Math.round(((currentStepIndex + 1) / steps.length) * 100));

  const content = (
    <div className="flex flex-col items-center justify-center p-8 text-center max-w-md w-full">
      {/* Animated Compass Motif */}
      <div className="relative mb-8 flex items-center justify-center">
        {/* Outer glowing pulse */}
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }}
          transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
          className="absolute w-28 h-28 rounded-full bg-travion-300 blur-xl"
        />

        {/* Outer rotating ring */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 12, ease: "linear" }}
          className="w-24 h-24 rounded-full border-2 border-dashed border-travion-400/60 flex items-center justify-center"
        >
          <div className="w-2 h-2 rounded-full bg-travion-500 absolute -top-1" />
        </motion.div>

        {/* Inner Counter-rotating compass icon */}
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
          className="absolute flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-soft border border-travion-100 text-travion-600"
        >
          <Compass className="w-9 h-9" />
        </motion.div>

        {/* Small floating sparkles */}
        <motion.div
          animate={{ y: [-4, 4, -4], opacity: [0.7, 1, 0.7] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          className="absolute -top-1 -right-1 text-travion-500"
        >
          <Sparkles className="w-5 h-5" />
        </motion.div>
      </div>

      {/* Headline */}
      <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-2 tracking-tight">
        {headline}
      </h3>

      {/* Dynamic Subtext Step */}
      <motion.p
        key={currentStepIndex}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="text-sm font-medium text-slate-600 min-h-[44px] flex items-center justify-center"
      >
        {steps[currentStepIndex]}
      </motion.p>

      {/* Animated Slim Progress Bar */}
      <div className="w-full mt-6 bg-travion-100 h-2 rounded-full overflow-hidden">
        <motion.div
          className="bg-travion-500 h-full rounded-full"
          initial={{ width: '0%' }}
          animate={{ width: `${progressPercent}%` }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
        />
      </div>
      <span className="text-xs text-slate-400 font-semibold mt-2">{progressPercent}%</span>
    </div>
  );

  if (!fullScreen) return content;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-white/90 backdrop-blur-md"
    >
      {content}
    </motion.div>
  );
};
