import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, ChevronDown, ChevronUp, X, Sparkles, AlertTriangle } from 'lucide-react';

interface ReplanningNoticeProps {
  reason: string;
  explanation: string;
  newVersion: number;
  onDismiss: () => void;
}

export const ReplanningNotice: React.FC<ReplanningNoticeProps> = ({
  reason,
  explanation,
  newVersion,
  onDismiss
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full max-w-2xl mx-auto rounded-3xl bg-white/95 backdrop-blur-md border border-travion-200 shadow-soft-lg p-4 my-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-travion-100 text-travion-600 flex items-center justify-center shrink-0">
            <RefreshCw className="w-5 h-5 animate-spin" style={{ animationDuration: '6s' }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-travion-100 text-travion-700">
                Itinerary v{newVersion} Active
              </span>
              <span className="text-xs font-semibold text-slate-400">Dynamic AI Adaptation</span>
            </div>
            <h4 className="text-sm font-bold text-slate-900 mt-0.5">
              {reason}
            </h4>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs font-bold text-travion-600 hover:text-travion-700 px-3 py-1.5 rounded-xl hover:bg-travion-50 flex items-center gap-1 transition-colors"
          >
            <span>Why did my plan change?</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onDismiss}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expandable Explanation Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-700 leading-relaxed font-medium bg-travion-50/50 rounded-2xl p-3.5"
          >
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-travion-600 shrink-0 mt-0.5" />
              <div>
                <p className="mb-2 font-bold text-travion-900">AI Optimization Rationale:</p>
                <p>{explanation}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
