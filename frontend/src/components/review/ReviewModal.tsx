import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Star, X, CheckCircle2 } from 'lucide-react';
import { api } from '../../services/api';

interface ReviewModalProps {
  tripId: string;
  guideName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  tripId,
  guideName,
  isOpen,
  onClose,
  onSuccess
}) => {
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.submitReview(tripId, { rating, comment });
      onSuccess();
      onClose();
    } catch (err) {
      console.error("Review submission error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-3xl p-6 md:p-8 shadow-floating border border-travion-100"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <h3 className="text-lg font-bold text-slate-900">How was your trip with {guideName}?</h3>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Star Selector */}
          <div className="flex justify-center items-center gap-2 py-3">
            {[1, 2, 3, 4, 5].map((star) => {
              const active = (hoverRating || rating) >= star;
              return (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(null)}
                  onClick={() => setRating(star)}
                  className="p-1 focus:outline-none transition-transform hover:scale-125"
                >
                  <Star
                    className={`w-8 h-8 ${
                      active ? 'text-amber-400 fill-amber-400' : 'text-slate-200'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          <p className="text-center text-xs font-semibold text-slate-500">
            {rating === 5 ? "Exceptional experience — truly memorable" : rating === 4 ? "Great guide service" : "Good, but room for improvement"}
          </p>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Your Feedback (Optional)</label>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Tell others about your experience, guide's local knowledge, and memorable spots..."
              className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 text-xs font-medium focus:border-travion-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-600 text-xs font-semibold hover:bg-slate-50"
            >
              Skip
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-travion-600 hover:bg-travion-700 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50"
            >
              {isSubmitting ? "Submitting…" : "Submit Review"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
