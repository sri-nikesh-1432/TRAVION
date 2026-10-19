import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BadgeCheck, BedDouble, Car, Compass, CreditCard, Loader2, Lock,
  Mountain, ShieldCheck, TrainFront, Utensils, Wallet,
} from 'lucide-react';
import { api } from '../../services/api';

const inr = (n: number | null | undefined) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

let razorpayScriptPromise: Promise<boolean> | null = null;
function loadRazorpayScript(): Promise<boolean> {
  if (typeof window !== 'undefined' && (window as any).Razorpay) return Promise.resolve(true);
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

interface PaymentStepProps {
  tripId: string;
  sourceName: string;
  destinationName: string;
  userEmail: string;
  /** Review-matching final amount (authoritative pricing preview). */
  expectedAmount?: number | null;
  onSuccess: () => void;
  onBack: () => void;
}

/**
 * Stage 10 — Payment. Owns the full checkout flow: authoritative pricing
 * preview, non-refundable acknowledgement, Razorpay order creation (only after
 * acknowledgement), live-or-simulated verified payment, trip activation.
 * Shows the review-matching final amount; on success the trip workspace opens.
 */
export const PaymentStep: React.FC<PaymentStepProps> = ({
  tripId, sourceName, destinationName, userEmail, expectedAmount, onSuccess, onBack,
}) => {
  const [pricing, setPricing] = useState<{
    travel_spend: number; guide_fee: number; platform_fee: number;
    safety_reserve: number; insurance_fee: number;
    final_planned_amount: number; amount_payable: number;
    guide_required: boolean; breakdown: Record<string, any>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonRefundableAcknowledged, setNonRefundableAcknowledged] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentNote, setPaymentNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.getTripPricing(tripId)
      .then((p) => {
        if (!alive) return;
        setPricing({
          travel_spend: Number(p.travel_spend ?? 0),
          guide_fee: Number(p.guide_fee ?? 0),
          platform_fee: Number(p.platform_fee ?? 0),
          safety_reserve: Number(p.safety_reserve ?? 0),
          insurance_fee: Number(p.insurance_fee ?? 50),
          final_planned_amount: Number(p.final_planned_amount ?? p.amount_payable ?? 0),
          amount_payable: Number(p.amount_payable ?? 0),
          guide_required: Boolean(p.guide_required),
          breakdown: (p.breakdown || {}) as Record<string, any>,
        });
      })
      .catch((err: any) => { if (alive) setLoadError(err?.message || 'Pricing could not be loaded.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tripId]);

  const executePayment = async () => {
    if (!pricing || isProcessing) return;
    // §20 hard rule: confirmation is impossible until the checkbox is checked.
    if (!nonRefundableAcknowledged) {
      setPaymentNote('Please accept the non-refundable acknowledgement before confirming payment.');
      return;
    }
    setPaymentNote(null);
    setIsProcessing(true);
    try {
      // Order creation happens here — only after the acknowledgement is
      // checked — so the stored transaction carries proof of acceptance.
      const checkout = await api.checkoutTrip(tripId, true);
      const canDoLive = checkout.live_checkout === true;
      const sdkReady = canDoLive ? await loadRazorpayScript() : false;

      if (canDoLive && sdkReady && (window as any).Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const rzp = new (window as any).Razorpay({
            key: checkout.key_id,
            amount: Math.round(checkout.amount * 100),
            currency: checkout.currency || 'INR',
            name: 'Travion',
            description: `${sourceName} to ${destinationName} trip`,
            order_id: checkout.order_id,
            prefill: { email: userEmail },
            theme: { color: '#267aa8' },
            handler: async (response: any) => {
              try {
                await api.verifyPaymentWebhook({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                });
                resolve();
              } catch (err) {
                reject(err);
              }
            },
            modal: { ondismiss: () => reject(new Error('cancelled')) },
          });
          rzp.open();
        });
      } else {
        // Simulated fallback — same server-side signature-verified flow. The
        // signature is the SERVER-ISSUED HMAC from the checkout response: the
        // client can never mint its own payment success.
        await api.verifyPaymentWebhook({
          razorpay_order_id: checkout.order_id,
          razorpay_payment_id: `pay_sim_${Date.now()}`,
          razorpay_signature: checkout.simulated_signature || '',
        });
      }
      onSuccess();
    } catch (err: any) {
      if (String(err?.message || '').toLowerCase().includes('cancel')) {
        setPaymentNote('Payment was cancelled. Your trip is safely saved — you can retry payment anytime.');
      } else {
        setPaymentNote(err?.message || 'Payment failed. Please try again.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-14 text-center">
        <Loader2 className="w-6 h-6 text-travion-500 animate-spin mx-auto mb-3" />
        <p className="text-[13px] font-bold text-charcoal-500">Loading secure checkout…</p>
      </div>
    );
  }

  if (loadError || !pricing) {
    return (
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="rounded-2xl bg-red-50 border border-red-100 px-4 py-4 text-center">
          <p className="text-[13px] font-bold text-red-600">{loadError || 'Checkout unavailable.'}</p>
          <div className="mt-3 flex justify-center gap-2">
            <button type="button" onClick={onBack} className="px-4 h-10 rounded-xl border border-charcoal-200 text-charcoal-700 text-[12px] font-bold">
              Back to review
            </button>
            <button type="button" onClick={() => window.location.reload()} className="px-4 h-10 rounded-xl bg-travion-600 text-white text-[12px] font-extrabold">
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const b = pricing.breakdown || {};
  const rows = [
    { icon: TrainFront, color: '#267aa8', label: 'Transport (round trip)', value: Number(b.transport || 0) },
    { icon: BedDouble, color: '#6366f1', label: 'Stay (per your stay preference)', value: Number(b.stay || 0) },
    { icon: Utensils, color: '#f59e0b', label: 'Curated dining allowance', value: Number(b.food || 0) },
    { icon: Mountain, color: '#10b981', label: 'Activities & heritage entries', value: Number(b.activities || 0) },
    ...(Number(b.local_transport || 0) > 0 ? [{ icon: Car, color: '#0ea5e9', label: 'Local transport & cabs', value: Number(b.local_transport || 0) }] : []),
  ];

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <div className="text-center mb-5">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 10 · Payment</span>
        <h2 className="mt-2 text-2xl font-extrabold text-charcoal-900 tracking-tight">Secure checkout</h2>
        <p className="mt-1 text-[12.5px] font-medium text-charcoal-500">{sourceName} → {destinationName}</p>
      </div>

      <div className="bg-white rounded-3xl p-6 md:p-7 shadow-floating border border-travion-100">
        <div className="flex items-center justify-between pb-4 border-b border-charcoal-100 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-2xl bg-travion-100 text-travion-700 flex items-center justify-center shrink-0">
              <CreditCard className="w-4.5 h-4.5" />
            </span>
            <h3 className="text-[15px] font-extrabold text-charcoal-900 tracking-tight">Transparent Checkout</h3>
          </div>
          <span className="text-[9px] font-black px-2.5 py-1 rounded-full bg-travion-100 text-travion-700">
            Razorpay Verified
          </span>
        </div>

        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-4 h-4 text-travion-600" />
            <span className="text-[11px] font-black uppercase tracking-wider text-charcoal-500">Estimated travel spend — paid locally as you travel</span>
          </div>
          <div className="space-y-2 text-xs text-charcoal-700 font-medium">
            {rows.map((row) => (
              <div key={row.label} className="flex justify-between py-1 border-b border-charcoal-100">
                <span className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: row.color }}>
                    <row.icon className="w-3.5 h-3.5" />
                  </span>
                  <span>{row.label}</span>
                </span>
                <span className="font-bold">{inr(row.value)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-1 text-[11px] text-charcoal-500">
              <span>Travel spend estimate</span>
              <span className="font-bold">{inr(pricing.travel_spend)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-travion-50/70 border border-travion-100 p-4 mb-5">
          <div className="flex items-center gap-2 mb-2.5">
            <ShieldCheck className="w-4 h-4 text-travion-700" />
            <span className="text-[11px] font-black uppercase tracking-wider text-travion-700">Fees & reserve — final planned amount</span>
          </div>
          <div className="space-y-2 text-xs font-medium">
            <div className="flex justify-between py-1 border-b border-travion-100 text-travion-800">
              <span className="font-semibold flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5" />
                <span>Guide fee</span>
              </span>
              <span className="font-bold">{pricing.guide_fee > 0 ? inr(pricing.guide_fee) : '₹0 — Adventurous Mode'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-travion-100 text-travion-800">
              <span className="font-semibold flex items-center gap-1.5">
                <BadgeCheck className="w-3.5 h-3.5" />
                <span>Platform fee (3%)</span>
              </span>
              <span className="font-bold">{inr(pricing.platform_fee)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-travion-100 text-travion-800">
              <span className="font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Safety reserve (15%) — PROTECTED</span>
              </span>
              <span className="font-bold">{inr(pricing.safety_reserve)}</span>
            </div>
            <p className="text-[10.5px] font-semibold text-charcoal-400">
              Reserved for unexpected travel or emergency needs — never spent automatically.
            </p>
            <div className="flex justify-between py-1 border-b border-travion-100 text-travion-800">
              <span className="font-semibold">Insurance (fixed)</span>
              <span className="font-bold">{inr(pricing.insurance_fee)}</span>
            </div>
            <p className="text-[10.5px] font-semibold text-charcoal-400">
              ₹50 fixed — TRAVION Refund Protection: if TRAVION cancels your trip, the platform fee + this insurance are refunded.
            </p>
            <div className="flex justify-between pt-2 text-sm font-black text-charcoal-900">
              <span>Final planned amount</span>
              <span className="text-travion-700">{inr(pricing.amount_payable)}</span>
            </div>
            {expectedAmount != null && Math.round(expectedAmount) !== Math.round(pricing.amount_payable) && (
              <p className="text-[10.5px] font-bold text-amber-600">
                Review showed {inr(expectedAmount)} — the amount above is the live authoritative total.
              </p>
            )}
          </div>
        </div>

        <label
          htmlFor="non-refundable-ack"
          className={`flex items-start gap-3 mb-5 p-3.5 rounded-2xl border cursor-pointer select-none transition-colors ${
            nonRefundableAcknowledged
              ? 'border-travion-300 bg-travion-50/60'
              : paymentNote && !nonRefundableAcknowledged
                ? 'border-amber-300 bg-amber-50/50'
                : 'border-charcoal-200 bg-ivory-50/60 hover:border-charcoal-300'
          }`}
        >
          <input
            id="non-refundable-ack"
            type="checkbox"
            checked={nonRefundableAcknowledged}
            onChange={(e) => {
              setNonRefundableAcknowledged(e.target.checked);
              if (e.target.checked) setPaymentNote(null);
            }}
            className="mt-0.5 w-[18px] h-[18px] shrink-0 accent-travion-600 cursor-pointer"
          />
          <span className="text-[11.5px] leading-relaxed text-charcoal-700 font-medium">
            I understand that the applicable fee paid is <span className="font-bold text-charcoal-900">non-refundable</span> if a guide has not yet been assigned and the trip plan has not yet become active.
          </span>
        </label>

        <button
          type="button"
          onClick={() => void executePayment()}
          disabled={isProcessing || !nonRefundableAcknowledged}
          title={nonRefundableAcknowledged ? undefined : 'Please accept the non-refundable acknowledgement first'}
          className="w-full py-3.5 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white font-black text-sm shadow-md hover:shadow-soft transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <span className="flex items-center justify-center gap-2">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
                <Compass className="w-4 h-4" />
              </motion.div>
              Verifying Signature…
            </span>
          ) : `Confirm & Pay ${inr(pricing.amount_payable)} · Activate Trip`}
        </button>

        <p className="text-center text-[10px] text-charcoal-500 font-medium mt-3 flex items-center justify-center gap-1.5">
          <Lock className="w-3 h-3 text-emerald-500" />
          <span>Secure checkout — verified payment flow</span>
        </p>

        {paymentNote && (
          <p className="text-center text-[11px] text-amber-600 font-semibold mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {paymentNote}
          </p>
        )}

        <button
          type="button"
          onClick={onBack}
          className="mt-3 w-full h-10 rounded-xl text-charcoal-500 text-[12px] font-bold hover:text-charcoal-700 transition-colors"
        >
          Back to review
        </button>
      </div>
    </div>
  );
};
