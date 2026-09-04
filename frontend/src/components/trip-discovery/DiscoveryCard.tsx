import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, ArrowLeft, Sparkles, Check } from 'lucide-react';

interface DiscoveryCardProps {
  questionId: string;
  questionText: string;
  questionType: 'choice' | 'budget' | 'text';
  options?: string[];
  placeholder?: string;
  currentAnswer?: any;
  onAnswer: (answer: any) => void;
  onBack?: () => void;
  answeredCount: number;
  totalEstimated: number;
}

export const DiscoveryCard: React.FC<DiscoveryCardProps> = ({
  questionId,
  questionText,
  questionType,
  options = [],
  placeholder,
  currentAnswer,
  onAnswer,
  onBack,
  answeredCount,
  totalEstimated
}) => {
  const [selectedOption, setSelectedOption] = useState<any>(currentAnswer || '');

  const handleNext = () => {
    if (selectedOption !== undefined && selectedOption !== '') {
      onAnswer(selectedOption);
    }
  };

  const progressPercent = Math.min(100, Math.round(((answeredCount + 1) / totalEstimated) * 100));

  return (
    <motion.div
      key={questionId}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full max-w-xl mx-auto bg-white rounded-3xl p-6 md:p-8 border border-travion-100 shadow-soft-lg"
    >
      {/* Soft Indeterminate Progress Bar */}
      <div className="w-full bg-travion-100 h-1.5 rounded-full overflow-hidden mb-6">
        <motion.div
          className="bg-travion-500 h-full rounded-full"
          initial={{ width: '0%' }}
          animate={{ width: `${progressPercent}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>

      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-travion-600 mb-2">
        <Sparkles className="w-4 h-4" />
        <span>Personalizing Your Experience</span>
      </div>

      <h3 className="text-xl md:text-2xl font-extrabold text-slate-900 mb-6 leading-tight">
        {questionText}
      </h3>

      {/* Multiple Choice Options as Chips / Cards */}
      {options && options.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {options.map((opt, idx) => {
            const isSelected = selectedOption === opt;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedOption(opt)}
                className={`p-4 rounded-2xl border text-left font-semibold text-sm transition-all flex items-center justify-between ${
                  isSelected
                    ? 'border-travion-500 bg-travion-50/70 text-travion-900 shadow-sm ring-2 ring-travion-200'
                    : 'border-slate-200 hover:border-travion-300 text-slate-700 bg-white'
                }`}
              >
                <span>{opt}</span>
                {isSelected && (
                  <div className="w-5 h-5 rounded-full bg-travion-600 text-white flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Open Budget / Text Input if applicable */}
      {questionType === 'budget' && (
        <div className="mb-6">
          <label className="block text-xs font-bold text-slate-500 mb-1">Custom Amount (Optional)</label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">₹</span>
            <input
              type="text"
              value={selectedOption}
              onChange={(e) => setSelectedOption(e.target.value)}
              placeholder={placeholder || "e.g. 18000"}
              className="w-full pl-8 pr-4 py-3 rounded-2xl border border-slate-200 text-base font-bold text-slate-800 focus:border-travion-500 focus:ring-2 focus:ring-travion-100 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Bottom Controls */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-100">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
        ) : <div />}

        <button
          type="button"
          disabled={!selectedOption}
          onClick={handleNext}
          className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white font-bold text-sm shadow-md hover:shadow-soft transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span>Continue</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
};
