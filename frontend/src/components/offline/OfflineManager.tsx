import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, CheckCircle2, WifiOff, CloudCheck, Shield, Sparkles, X } from 'lucide-react';
import { api } from '../../services/api';

interface OfflineManagerProps {
  tripId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const OfflineManager: React.FC<OfflineManagerProps> = ({
  tripId,
  isOpen,
  onClose
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isCached, setIsCached] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const checklistItems = [
    "Complete day-by-day itinerary & stop timings",
    "Verified route coordinates & waypoint metadata",
    "Hotel bookings, address & phone vouchers",
    "Local cuisine & dining recommendations",
    "Regional emergency hotlines & hospital contacts",
    "Trip-scoped AI assistant offline context bundle",
    "Assigned guide identity & safety briefing"
  ];

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadProgress(10);

    try {
      // Simulate staged progress
      const timer = setInterval(() => {
        setDownloadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(timer);
            return 90;
          }
          return prev + 25;
        });
      }, 400);

      const pkg = await api.getOfflinePackage(tripId);
      clearInterval(timer);
      setDownloadProgress(100);

      // Save to localStorage / IndexedDB
      localStorage.setItem(`travion_offline_${tripId}`, JSON.stringify(pkg));
      setIsCached(true);
    } catch (err) {
      console.error("Offline package download failed:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="w-full max-w-lg bg-white rounded-3xl p-6 md:p-8 shadow-floating border border-travion-100"
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-travion-100 text-travion-600 flex items-center justify-center">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-travion-600">Offline Resilience</span>
              <h3 className="text-lg font-bold text-slate-900">Download Offline Trip Package</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Honest Technical Scope Notice */}
        <div className="p-3.5 rounded-2xl bg-sky-50 border border-sky-100 text-xs text-sky-800 leading-relaxed mb-5 font-medium">
          <span className="font-bold">Honest Offline Scope:</span> All itinerary details, voucher numbers, offline route coordinates, and emergency hotlines are saved locally. Live traffic and high-res satellite tiles require an active data connection.
        </div>

        {/* Checklist Animation */}
        <div className="space-y-2.5 mb-6">
          {checklistItems.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2.5 text-xs font-semibold text-slate-700">
              <CheckCircle2 className={`w-4 h-4 ${isCached ? 'text-emerald-500' : 'text-slate-300'}`} />
              <span>{item}</span>
            </div>
          ))}
        </div>

        {/* Progress Bar when downloading */}
        {isDownloading && (
          <div className="mb-6">
            <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
              <span>Packing offline bundle…</span>
              <span>{downloadProgress}%</span>
            </div>
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div
                className="bg-travion-500 h-full transition-all duration-300 rounded-full"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-xs hover:bg-slate-50 transition-colors"
          >
            Close
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={isDownloading || isCached}
            className="px-6 py-2.5 rounded-xl bg-travion-600 hover:bg-travion-700 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {isCached ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-white" />
                <span>Package Saved Locally</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>{isDownloading ? "Downloading…" : "Download Bundle"}</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
