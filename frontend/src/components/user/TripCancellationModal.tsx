import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  ShieldCheck,
  X,
  RefreshCw,
  ArrowRight,
  Info,
} from 'lucide-react';
import { api } from '../../services/api';

interface TripCancellationModalProps {
  tripId: string;
  isOpen: boolean;
  onClose: () => void;
  onCancelled: () => void;
}

export const TripCancellationModal: React.FC<TripCancellationModalProps> = ({
  tripId,
  isOpen,
  onClose,
  onCancelled,
}) => {
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [checkData, setCheckData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string>('Personal schedule change');
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (!isOpen || !tripId) return;
    setLoading(true);
    setError(null);
    setResult(null);

    api
      .checkTripCancellation(tripId)
      .then((res) => {
        setCheckData(res);
      })
      .catch((err) => {
        setError(err?.message || 'Could not verify cancellation eligibility.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, tripId]);

  const handleConfirmCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await api.cancelTrip(tripId, reason);
      setResult(res);
      onCancelled();
    } catch (err: any) {
      setError(err?.message || 'Cancellation failed. Please contact customer support.');
    } finally {
      setCancelling(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-charcoal-950/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg rounded-3xl bg-white border border-charcoal-200 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-charcoal-100 bg-sand-50/50">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-extrabold text-charcoal-900">Cancel Trip Booking</h3>
              <p className="text-xs text-charcoal-500 font-medium">TRAVION 8-Hour Refund Policy</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-charcoal-400 hover:text-charcoal-700 hover:bg-sand-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6">
          {loading ? (
            <div className="py-12 text-center">
              <RefreshCw className="w-7 h-7 text-travion-600 animate-spin mx-auto mb-3" />
              <p className="text-xs font-bold text-charcoal-600">Verifying departure countdown & refund eligibility…</p>
            </div>
          ) : result ? (
            /* Success confirmation */
            <div className="text-center py-4">
              <span className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-7 h-7" />
              </span>
              <h4 className="text-lg font-black text-charcoal-900">Trip Cancelled Successfully</h4>
              <p className="mt-2 text-xs text-charcoal-600 leading-relaxed max-w-sm mx-auto">
                {result.message}
              </p>

              {result.refund_eligible && (
                <div className="mt-4 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                  Refund Amount: ₹{result.refund_amount.toLocaleString('en-IN')} (Razorpay Refund ID: {result.razorpay_refund_id || 'Queued'})
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                className="mt-6 w-full h-11 rounded-xl bg-charcoal-900 hover:bg-charcoal-800 text-white text-xs font-black uppercase tracking-wider transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <div>
              {/* Policy Evaluation Card */}
              {checkData && (
                <div
                  className={`p-4 rounded-2xl border mb-5 ${
                    checkData.eligible
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                      : 'bg-amber-50/80 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {checkData.eligible ? (
                      <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="text-xs font-black uppercase tracking-wide">
                        {checkData.eligible ? '100% Refund Guaranteed' : 'Non-Refundable Window'}
                      </span>
                      <p className="mt-1 text-xs font-medium leading-relaxed">
                        {checkData.message}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-black/10 grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div>
                      <span className="text-charcoal-500 block">Hours to Departure:</span>
                      <span className="font-bold text-sm">
                        {checkData.hours_remaining != null ? `${checkData.hours_remaining} hrs` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-charcoal-500 block">Eligible Refund:</span>
                      <span className="font-bold text-sm">
                        ₹{(checkData.refund_amount || 0).toLocaleString('en-IN')} ({checkData.refund_percentage}%)
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Strict 8-hour policy notice */}
              <div className="flex items-start gap-2 p-3 rounded-xl bg-sand-100/70 border border-charcoal-200 text-charcoal-600 text-[11.5px] leading-relaxed mb-4">
                <Info className="w-4 h-4 text-charcoal-500 shrink-0 mt-0.5" />
                <span>
                  <strong>TRAVION Cancellation Policy:</strong> Full refund is processed via Razorpay if cancelled at least 8 hours prior to scheduled departure. Cancellations within 8 hours are strictly non-refundable due to vendor lock-in.
                </span>
              </div>

              {/* Reason input */}
              <div className="mb-4">
                <label className="block text-xs font-bold text-charcoal-700 uppercase tracking-wider mb-1.5">
                  Reason for Cancellation
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Tell us why you need to cancel this journey…"
                  rows={2}
                  className="w-full p-3 rounded-xl border border-charcoal-200 text-xs font-medium focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-200 resize-none"
                />
              </div>

              {error && (
                <p className="text-xs font-bold text-red-600 mb-4 bg-red-50 p-2.5 rounded-xl border border-red-200">
                  {error}
                </p>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 h-11 rounded-xl border border-charcoal-200 hover:bg-sand-100 text-charcoal-700 text-xs font-bold transition-colors"
                >
                  Keep My Trip
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancel}
                  disabled={cancelling}
                  className="flex-1 h-11 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  {cancelling ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Processing…
                    </>
                  ) : (
                    'Confirm Cancellation'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
