import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, ArrowLeft, Sparkles, Check, Plus } from 'lucide-react';

interface DiscoveryCardProps {
  questionId: string;
  questionText: string;
  questionType: 'choice' | 'multi_choice' | 'budget' | 'text';
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
  const isMulti = questionType === 'multi_choice';
  // Single-select keeps a string; multi-select keeps a structured list so every
  // chosen preference reaches the planner (never just the last click).
  const [selectedOption, setSelectedOption] = useState<any>(
    isMulti
      ? Array.isArray(currentAnswer) ? currentAnswer : (currentAnswer ? [currentAnswer] : [])
      : currentAnswer || ''
  );

  const toggleMulti = (opt: string) => {
    setSelectedOption((prev: string[]) => {
      if (!Array.isArray(prev)) prev = [];
      return prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt];
    });
  };

  const canContinue = isMulti
    ? Array.isArray(selectedOption) && selectedOption.length > 0
    : selectedOption !== undefined && selectedOption !== '';

  const handleNext = () => {
    if (canContinue) {
      onAnswer(isMulti && !Array.isArray(selectedOption) ? [selectedOption] : selectedOption);
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
        <div className="mb-6">
          {isMulti && (
            <p className="text-[11px] font-bold text-slate-400 mb-2.5">Select all that apply</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {options.map((opt, idx) => {
              const isSelected = isMulti
                ? Array.isArray(selectedOption) && selectedOption.includes(opt)
                : selectedOption === opt;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => isMulti ? toggleMulti(opt) : setSelectedOption(opt)}
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
          {isMulti && Array.isArray(selectedOption) && selectedOption.length > 0 && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-travion-50 border border-travion-200 text-[11px] font-bold text-travion-700">
              <Plus className="w-3 h-3" />
              <span>{selectedOption.length} selected{selectedOption.length > 1 ? ' — all will shape your plan' : ''}</span>
            </div>
          )}
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
          disabled={!canContinue}
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
