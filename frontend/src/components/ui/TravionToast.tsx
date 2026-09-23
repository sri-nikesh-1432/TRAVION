import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';

export interface TravionToastOptions {
  tone?: 'success' | 'info' | 'error';
  title: string;
  desc?: string;
  /** Undo / secondary action — the normal toast already dismisses itself. */
  action?: { label: string; onAction: () => void };
  duration?: number;
}

interface ToastItem extends TravionToastOptions {
  id: number;
}

const ToastContext = createContext<{ toast: (o: TravionToastOptions) => void } | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <TravionToastProvider>');
  return ctx;
};

const toneStyles: Record<string, { bar: string; icon: React.ReactNode }> = {
  success: { bar: 'bg-emerald-500', icon: <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600 shrink-0" /> },
  info: { bar: 'bg-travion-400', icon: <Info className="w-4.5 h-4.5 text-travion-600 shrink-0" /> },
  error: { bar: 'bg-red-400', icon: <AlertTriangle className="w-4.5 h-4.5 text-red-500 shrink-0" /> },
};

export const TravionToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    timers.current.get(id) && clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (options: TravionToastOptions) => {
      const id = ++seq.current;
      const duration = options.duration ?? (options.tone === 'error' ? 7000 : 4200);
      setToasts((t) => [...t.slice(-2), { ...options, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration + (options.action ? 4000 : 0))
      );
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 inset-x-4 z-[60] flex flex-col items-center gap-2.5 sm:items-end sm:right-6 sm:left-auto sm:inset-x-auto sm:max-w-sm pb-safe pointer-events-none"
      >
        <AnimatePresence>
          {toasts.map((t) => {
            const tone = toneStyles[t.tone || 'info'];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 18, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.96 }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                className="glass-strong rounded-2xl shadow-floating pl-1 pr-2.5 py-2.5 flex items-center gap-3 w-full pointer-events-none"
              >
                <span className={`self-stretch w-1 rounded-full ${tone.bar} ml-1`} />
                {tone.icon}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-extrabold text-charcoal-800 leading-tight">{t.title}</p>
                  {t.desc && <p className="text-[11.5px] font-medium text-charcoal-500 mt-0.5">{t.desc}</p>}
                </div>
                {t.action && (
                  <button
                    onClick={() => { t.action?.onAction(); dismiss(t.id); }}
                    className="pointer-events-auto text-[11.5px] font-black text-travion-700 px-2.5 py-2 rounded-xl hover:bg-travion-50 transition-colors"
                  >
                    {t.action.label}
                  </button>
                )}
                <button
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  className="pointer-events-auto p-1.5 rounded-lg text-charcoal-400 hover:text-charcoal-700 hover:bg-charcoal-100/60 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};