import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Wallet, Loader2, CheckCircle2, X } from 'lucide-react';
import { api } from '../../services/api';

const TOPUP_PRESETS = [2500, 5000, 7500, 10000];

const inr = (n: number | null | undefined) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/**
 * BudgetAlert — shown whenever a stage gate returns `can_continue: false`
 * (or a forward PUT /stage answers 422 with violations).
 *
 * Shows the violations + deselect hints, and offers budget top-ups (quick
 * amounts + custom). A top-up is a BUDGET ADJUSTMENT, never a payment.
 * After a successful top-up the caller re-fetches its gate and STAYS on the
 * same stage — selections are never cleared.
 */
export const BudgetGateAlert: React.FC<{
  tripId: string;
  violations: string[];
  hints?: string[];
  stage: string;
  remainingBudget?: number | null;
  onTopupComplete: () => void;
  onClose: () => void;
}> = ({ tripId, violations, hints, stage, remainingBudget, onTopupComplete, onClose }) => {
  const [amount, setAmount] = useState<number | ''>('');
  const [custom, setCustom] = useState('');
  const [preview, setPreview] = useState<{ previous_budget: number; updated_budget: number; updated_remaining: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const effective = amount === '' ? Number(custom) || 0 : Number(amount);

  const doPreview = async (amt: number) => {
    if (!amt || amt <= 0) { setPreview(null); return; }
    setError(null);
    try {
      const p = await api.previewBudgetTopup(tripId, amt, stage);
      setPreview({ previous_budget: p.previous_budget, updated_budget: p.updated_budget, updated_remaining: p.updated_remaining });
    } catch (err: any) {
      setPreview(null);
      setError(err?.message || 'Could not preview this top-up.');
    }
  };

  const pick = (amt: number) => {
    setAmount(amt);
    setCustom('');
    setDone(false);
    void doPreview(amt);
  };

  const confirm = async () => {
    if (!effective || effective <= 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmBudgetTopup(tripId, effective, stage, 'Traveller top-up from budget gate');
      setDone(true);
      setPreview(null);
      onTopupComplete();
    } catch (err: any) {
      setError(err?.message || 'Top-up failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-travion-900/45 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white rounded-3xl shadow-floating border border-red-100 overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start gap-3 px-6 py-5 border-b border-red-100 bg-red-50/60">
          <span className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </span>
          <div className="flex-1">
            <h3 className="text-[15px] font-extrabold text-charcoal-900">Your budget can't cover this yet</h3>
            <p className="text-[12px] font-semibold text-charcoal-500 mt-0.5">
              Your selections are saved — nothing was removed. Adjust below or add to your budget.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-xl text-charcoal-400 hover:text-charcoal-700 hover:bg-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          {remainingBudget != null && (
            <p className="text-[12px] font-bold text-charcoal-500 mb-3">
              Remaining budget: <span className="text-charcoal-800">{inr(remainingBudget)}</span>
            </p>
          )}
          <ul className="space-y-2">
            {violations.map((v, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] font-semibold text-charcoal-700">
                <span className="w-4 h-4 rounded-full bg-red-100 text-red-600 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">!</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
          {hints && hints.length > 0 && (
            <div className="mt-4 rounded-2xl bg-travion-50/70 border border-travion-100 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-wider text-travion-700 mb-1.5">Ways to fit your budget</p>
              <ul className="space-y-1">
                {hints.map((h, i) => (
                  <li key={i} className="text-[12px] font-semibold text-charcoal-600">· {h}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Top-up — budget adjustment, never a payment */}
          <div className="mt-5">
            <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-charcoal-500 mb-2.5">
              <Wallet className="w-3.5 h-3.5 text-travion-600" /> Add to trip budget
            </p>
            <div className="grid grid-cols-4 gap-2">
              {TOPUP_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => pick(p)}
                  className={`h-10 rounded-xl text-[12.5px] font-extrabold border transition-all ${
                    amount === p ? 'bg-travion-600 border-travion-600 text-white' : 'bg-white border-charcoal-200 text-charcoal-700 hover:border-travion-300'
                  }`}
                >
                  {inr(p)}
                </button>
              ))}
            </div>
            <input
              type="number"
              min={1}
              value={custom}
              onChange={(e) => { setCustom(e.target.value); setAmount(''); setDone(false); void doPreview(Number(e.target.value) || 0); }}
              placeholder="Or enter a custom amount (₹)"
              className="mt-2 w-full h-11 px-4 rounded-xl border border-charcoal-200 text-[13px] font-bold text-charcoal-800 focus:outline-none focus:ring-2 focus:ring-travion-200 focus:border-travion-300"
            />
            {preview && (
              <p className="mt-2 text-[12px] font-semibold text-charcoal-500">
                Budget {inr(preview.previous_budget)} → <span className="font-extrabold text-travion-700">{inr(preview.updated_budget)}</span>
                {' '}· remaining after selections {inr(preview.updated_remaining)}
              </p>
            )}
            {done && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] font-bold text-emerald-700">
                <CheckCircle2 className="w-4 h-4" /> Budget updated — re-checking what fits…
              </p>
            )}
            {error && (
              <p className="mt-2 text-[12px] font-bold text-red-600">{error}</p>
            )}
            <button
              type="button"
              onClick={confirm}
              disabled={busy || !effective || effective <= 0}
              className="mt-3 w-full h-11 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:bg-sand-200 disabled:text-charcoal-400 text-white text-[13px] font-extrabold transition-colors flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? 'Saving…' : effective > 0 ? `Add ${inr(effective)} to budget` : 'Choose an amount'}
            </button>
            <p className="mt-2 text-[10.5px] font-medium text-charcoal-400 text-center">
              A top-up adjusts your trip budget only — it is never a payment and creates no charge.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
