import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, ArrowLeft, Sparkles, Check, Plus, Wallet, Users, Mountain, Utensils, Landmark, Sparkle } from 'lucide-react';

interface DiscoveryCardProps {
  questionId: string;
  questionText: string;
  questionType: 'budget' | 'party' | 'experience' | 'choice' | 'multi_choice' | 'text';
  options?: any[];
  placeholder?: string;
  currentAnswer?: any;
  onAnswer: (answer: any) => void;
  onBack?: () => void;
  answeredCount: number;
  totalEstimated: number;
}

const EXPERIENCE_ICONS: Record<string, React.ReactNode> = {
  'adventure': <Mountain className="w-6 h-6" />,
  'food & culture': <Utensils className="w-6 h-6" />,
  'spiritual': <Landmark className="w-6 h-6" />,
  'mixed': <Sparkle className="w-6 h-6" />,
};

const BUDGET_RANGES = [
  { label: '₹10,000 – ₹15,000', from: 10000, to: 15000 },
  { label: '₹15,000 – ₹25,000', from: 15000, to: 25000 },
  { label: '₹25,000 – ₹50,000', from: 25000, to: 50000 },
  { label: '₹50,000+', from: 50000, to: 100000 },
];

const MIN_BUDGET = 1000;

/** Numbers only — letters, symbols, negatives and decimals are rejected at the key. */
const onlyDigits = (v: string) => v.replace(/[^0-9]/g, '');

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
  const [selectedOption, setSelectedOption] = useState<any>(null);

  // Custom budget state (Question 1)
  const [isCustomBudget, setIsCustomBudget] = useState(false);
  const [budgetFrom, setBudgetFrom] = useState('');
  const [budgetTo, setBudgetTo] = useState('');
  const [budgetError, setBudgetError] = useState<string | null>(null);

  // Party state (Question 2)
  const [group, setGroup] = useState('');
  const [askCount, setAskCount] = useState(false);
  const [totalTravellers, setTotalTravellers] = useState('');
  const [adults, setAdults] = useState('');
  const [children, setChildren] = useState('');
  const [partyError, setPartyError] = useState<string | null>(null);

  // Reset local state when the question changes
  useEffect(() => {
    setSelectedOption(null);
    setIsCustomBudget(false);
    setBudgetFrom('');
    setBudgetTo('');
    setBudgetError(null);
    setGroup('');
    setAskCount(false);
    setTotalTravellers('');
    setAdults('');
    setChildren('');
    setPartyError(null);
  }, [questionId]);

  // ── Budget validation — errors surface immediately, never on Continue ──
  useEffect(() => {
    if (questionType !== 'budget' || !isCustomBudget) { setBudgetError(null); return; }
    if (!budgetFrom && !budgetTo) { setBudgetError(null); return; }
    if (!budgetFrom) { setBudgetError(null); return; }
    const from = parseInt(budgetFrom, 10);
    if (from < MIN_BUDGET) {
      setBudgetError(`Minimum budget is ₹${MIN_BUDGET.toLocaleString('en-IN')}.`);
      return;
    }
    if (budgetTo) {
      const to = parseInt(budgetTo, 10);
      if (to < from) {
        setBudgetError('Maximum budget must be greater than or equal to the minimum.');
        return;
      }
    }
    setBudgetError(null);
  }, [questionType, isCustomBudget, budgetFrom, budgetTo]);

  const budgetValid = questionType !== 'budget'
    ? true
    : isCustomBudget
      ? budgetFrom && parseInt(budgetFrom, 10) >= MIN_BUDGET && (!budgetTo || parseInt(budgetTo, 10) >= parseInt(budgetFrom, 10))
      : !!selectedOption;

  // ── Party validation ──
  useEffect(() => {
    if (questionType !== 'party' || !askCount) { setPartyError(null); return; }
    const total = parseInt(totalTravellers, 10);
    if (!totalTravellers) { setPartyError(null); return; }
    if (!Number.isFinite(total) || total < 1 || total > 100) {
      setPartyError('Enter a valid number of travellers (1–100).');
      return;
    }
    if (adults || children) {
      const a = parseInt(adults || '0', 10) || 0;
      const c = parseInt(children || '0', 10) || 0;
      if (a + c !== total) {
        setPartyError(`Adults (${a}) + Children (${c}) must add up to ${total} travellers.`);
        return;
      }
    }
    setPartyError(null);
  }, [questionType, askCount, totalTravellers, adults, children]);

  const partyValid = questionType !== 'party'
    ? true
    : group === 'Solo'
      ? true
      : group && askCount && totalTravellers && parseInt(totalTravellers, 10) >= 1
        && (adults || children ? parseInt(adults || '0', 10) + parseInt(children || '0', 10) === parseInt(totalTravellers, 10) : true);

  const canContinue = questionType === 'budget'
    ? !!budgetValid
    : questionType === 'party'
      ? !!partyValid
      : questionType === 'experience'
        ? !!selectedOption
        : selectedOption !== undefined && selectedOption !== '';

  const handleNext = () => {
    if (!canContinue) return;
    if (questionType === 'budget') {
      if (isCustomBudget) {
        onAnswer({ custom: true, from: parseInt(budgetFrom, 10), to: parseInt(budgetTo || budgetFrom, 10) });
      } else if (selectedOption) {
        onAnswer(selectedOption);
      }
      return;
    }
    if (questionType === 'party') {
      if (group === 'Solo') {
        onAnswer({ group: 'Solo', total: 1, adults: 1, children: 0 });
        return;
      }
      const total = parseInt(totalTravellers, 10);
      onAnswer({
        group,
        total,
        adults: parseInt(adults || '0', 10) || 0,
        children: parseInt(children || '0', 10) || 0,
      });
      return;
    }
    onAnswer(selectedOption);
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
        <span>Personalizing Your Experience · Question {answeredCount + 1} of {totalEstimated}</span>
      </div>

      <h3 className="text-xl md:text-2xl font-extrabold text-slate-900 mb-6 leading-tight">
        {questionText}
      </h3>

      {/* ═══ QUESTION 1 — BUDGET ═══ */}
      {questionType === 'budget' && (
        <div className="mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {BUDGET_RANGES.map((r) => {
              const isSelected = !isCustomBudget && selectedOption === r.label;
              return (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => { setIsCustomBudget(false); setSelectedOption(r.label); }}
                  className={`p-4 rounded-2xl border text-left font-bold text-sm transition-all flex items-center justify-between ${
                    isSelected
                      ? 'border-travion-500 bg-travion-50/70 text-travion-900 shadow-sm ring-2 ring-travion-200'
                      : 'border-slate-200 hover:border-travion-300 text-slate-700 bg-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Wallet className="w-4 h-4 text-travion-500" />
                    {r.label}
                  </span>
                  {isSelected && (
                    <span className="w-5 h-5 rounded-full bg-travion-600 text-white flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                  )}
                </button>
              );
            })}
            {/* Custom Budget toggle */}
            <button
              type="button"
              onClick={() => { setIsCustomBudget(true); setSelectedOption(null); }}
              className={`p-4 rounded-2xl border text-left font-bold text-sm transition-all flex items-center justify-between sm:col-span-2 ${
                isCustomBudget
                  ? 'border-travion-500 bg-travion-50/70 text-travion-900 shadow-sm ring-2 ring-travion-200'
                  : 'border-dashed border-slate-300 hover:border-travion-300 text-slate-700 bg-white'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Plus className="w-4 h-4 text-travion-500" />
                Custom Budget
              </span>
              {isCustomBudget && (
                <span className="w-5 h-5 rounded-full bg-travion-600 text-white flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3 stroke-[3]" />
                </span>
              )}
            </button>
          </div>

          {/* Custom From / To inputs — side by side, numbers only */}
          {isCustomBudget && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">From</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">₹</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={budgetFrom}
                      onChange={(e) => setBudgetFrom(onlyDigits(e.target.value))}
                      placeholder="8000"
                      className="w-full pl-8 pr-4 py-3 rounded-2xl border border-slate-200 text-base font-bold text-slate-800 focus:border-travion-500 focus:ring-2 focus:ring-travion-100 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">To</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">₹</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={budgetTo}
                      onChange={(e) => setBudgetTo(onlyDigits(e.target.value))}
                      placeholder="10000"
                      className="w-full pl-8 pr-4 py-3 rounded-2xl border border-slate-200 text-base font-bold text-slate-800 focus:border-travion-500 focus:ring-2 focus:ring-travion-100 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Immediate inline validation errors */}
          {budgetError && (
            <p className="mt-3 text-[12.5px] font-bold text-red-600 flex items-center gap-1.5">
              ✗ {budgetError}
            </p>
          )}
        </div>
      )}

      {/* ═══ QUESTION 2 — TRAVEL GROUP ═══ */}
      {questionType === 'party' && (
        <div className="mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {options.map((opt: string) => {
              const isSelected = group === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    setGroup(opt);
                    setAskCount(false);
                    setPartyError(null);
                    if (opt === 'Solo') { setTotalTravellers(''); setAdults(''); setChildren(''); }
                    else {
                      setAskCount(true);
                      if (opt === 'Couple') { setTotalTravellers('2'); setAdults('2'); setChildren(''); }
                      else { setTotalTravellers(''); setAdults(''); setChildren(''); }
                    }
                  }}
                  className={`p-4 rounded-2xl border text-left font-bold text-sm transition-all flex items-center justify-between ${
                    isSelected
                      ? 'border-travion-500 bg-travion-50/70 text-travion-900 shadow-sm ring-2 ring-travion-200'
                      : 'border-slate-200 hover:border-travion-300 text-slate-700 bg-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Users className="w-4 h-4 text-travion-500" />
                    {opt}
                  </span>
                  {isSelected && (
                    <span className="w-5 h-5 rounded-full bg-travion-600 text-white flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Exact traveller count + Adults/Children — free numeric entry */}
          {group && group !== 'Solo' && askCount && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-4"
            >
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">How many people are travelling?</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={totalTravellers}
                  onChange={(e) => setTotalTravellers(onlyDigits(e.target.value))}
                  placeholder="6"
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-base font-bold text-slate-800 focus:border-travion-500 focus:ring-2 focus:ring-travion-100 focus:outline-none"
                />
              </div>

              {totalTravellers && (
                <div className="mt-3">
                  <label className="block text-xs font-bold text-slate-500 mb-1">Split (optional)</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 mb-1">Adults</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={adults}
                        onChange={(e) => setAdults(onlyDigits(e.target.value))}
                        placeholder="4"
                        className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 text-base font-bold text-slate-800 focus:border-travion-500 focus:ring-2 focus:ring-travion-100 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 mb-1">Children</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={children}
                        onChange={(e) => setChildren(onlyDigits(e.target.value))}
                        placeholder="2"
                        className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 text-base font-bold text-slate-800 focus:border-travion-500 focus:ring-2 focus:ring-travion-100 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {partyError && (
            <p className="mt-3 text-[12.5px] font-bold text-red-600 flex items-center gap-1.5">
              ✗ {partyError}
            </p>
          )}
        </div>
      )}

      {/* ═══ QUESTION 3 — EXPERIENCE (with visible descriptions) ═══ */}
      {questionType === 'experience' && (
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {options.map((opt: any, idx: number) => {
            const label = typeof opt === 'string' ? opt : opt?.label;
            const description = typeof opt === 'string' ? '' : (opt?.description || '');
            const key = String(label || '').toLowerCase();
            const isSelected = selectedOption === label;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedOption(label)}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  isSelected
                    ? 'border-travion-500 bg-travion-50/70 shadow-sm ring-2 ring-travion-200'
                    : 'border-slate-200 hover:border-travion-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSelected ? 'bg-travion-600 text-white' : 'bg-travion-100 text-travion-600'}`}>
                    {EXPERIENCE_ICONS[key] ?? <Sparkle className="w-6 h-6" />}
                  </span>
                  {isSelected && (
                    <span className="w-5 h-5 rounded-full bg-travion-600 text-white flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                  )}
                </div>
                <p className={`text-[14.5px] font-extrabold ${isSelected ? 'text-travion-800' : 'text-slate-900'}`}>{label}</p>
                <p className="mt-1 text-[11.5px] font-medium text-slate-500 leading-relaxed">{description}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Legacy fallbacks (choice / multi_choice / text) ── */}
      {(questionType === 'choice' || questionType === 'multi_choice') && options && options.length > 0 && (
        <div className="mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {options.map((opt: any, idx: number) => {
              const label = typeof opt === 'string' ? opt : opt?.label;
              const isSelected = selectedOption === label;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedOption(label)}
                  className={`p-4 rounded-2xl border text-left font-semibold text-sm transition-all flex items-center justify-between ${
                    isSelected
                      ? 'border-travion-500 bg-travion-50/70 text-travion-900 shadow-sm ring-2 ring-travion-200'
                      : 'border-slate-200 hover:border-travion-300 text-slate-700 bg-white'
                  }`}
                >
                  <span>{label}</span>
                  {isSelected && (
                    <span className="w-5 h-5 rounded-full bg-travion-600 text-white flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                  )}
                </button>
              );
            })}
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
