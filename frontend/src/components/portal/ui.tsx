import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inbox, Search, X, AlertTriangle } from 'lucide-react';

/* ────────────────────────── KPI card ────────────────────────── */
export function KpiCard({ label, value, sub, tone = 'default' }: {
  label: string; value: React.ReactNode; sub?: string; tone?: 'default' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky';
}) {
  const tones: Record<string, string> = {
    default: 'text-slate-900',
    indigo: 'text-indigo-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
    sky: 'text-sky-600',
  };
  return (
    <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">{label}</span>
      <div className={`mt-1 text-2xl font-black tabular-nums ${tones[tone]}`}>{value}</div>
      {sub && <span className="text-[10.5px] font-semibold text-slate-400 mt-1 block">{sub}</span>}
    </div>
  );
}

/* ────────────────────────── Status pill ────────────────────────── */
const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  SETTLED: 'bg-emerald-100 text-emerald-800',
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  COMPLETED: 'bg-sky-100 text-sky-800',
  GUIDE_ASSIGNED: 'bg-sky-100 text-sky-800',
  PAID: 'bg-sky-100 text-sky-800',
  PLANNED: 'bg-indigo-100 text-indigo-800',
  REQUESTED: 'bg-amber-100 text-amber-800',
  PENDING: 'bg-amber-100 text-amber-800',
  ACCEPTED: 'bg-amber-100 text-amber-800',
  BUSY: 'bg-amber-100 text-amber-800',
  DUTY_OFF: 'bg-slate-200 text-slate-600',
  REJECTED: 'bg-rose-100 text-rose-800',
  FAILED: 'bg-rose-100 text-rose-800',
  DRAFT: 'bg-slate-200 text-slate-600',
};

export function StatusPill({ status }: { status?: string | null }) {
  if (!status) return <span className="text-[10px] font-bold text-slate-300">—</span>;
  const style = STATUS_STYLES[String(status).toUpperCase()] || 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${style}`}>
      {status}
    </span>
  );
}

export function ModePill({ mode }: { mode?: string | null }) {
  if (!mode) return null;
  const guide = mode === 'GUIDE_MODE';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap ${guide ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
      {guide ? 'Guide' : 'Adventurous'}
    </span>
  );
}

/* ────────────────────────── Empty state ────────────────────────── */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-11 h-11 rounded-2xl bg-slate-100 text-slate-300 flex items-center justify-center mb-3">
        <Inbox className="w-5 h-5" />
      </div>
      <p className="text-sm font-extrabold text-slate-500">{title}</p>
      {hint && <p className="mt-1 text-[11px] font-semibold text-slate-400 max-w-sm">{hint}</p>}
    </div>
  );
}

/* ────────────────────────── Section card ────────────────────────── */
export function SectionCard({ title, subtitle, actions, children, className = '' }: {
  title?: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`p-5 md:p-6 rounded-3xl bg-white border border-slate-200 shadow-soft ${className}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            {title && <h3 className="text-[15px] font-extrabold text-slate-900">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-[11.5px] font-semibold text-slate-400">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

/* ────────────────────────── Search box ────────────────────────── */
export function SearchBox({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Search…'}
        className="w-full sm:w-64 pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
      />
    </div>
  );
}

/* ────────────────────────── Icon button ────────────────────────── */
export function IconBtn({ children, onClick, title, tone = 'indigo' }: {
  children: React.ReactNode; onClick?: () => void; title?: string; tone?: 'indigo' | 'emerald' | 'rose' | 'slate';
}) {
  const tones: Record<string, string> = {
    indigo: 'text-indigo-600 hover:bg-indigo-50',
    emerald: 'text-emerald-600 hover:bg-emerald-50',
    rose: 'text-rose-600 hover:bg-rose-50',
    slate: 'text-slate-500 hover:bg-slate-100',
  };
  return (
    <button
      type="button" onClick={onClick} title={title}
      className={`p-2 rounded-xl transition-colors ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

/* ────────────────────────── Bar chart ────────────────────────── */
export function BarChart({ data, valueKey = 'value', labelKey = 'label', height = 180, money = false }: {
  data: Record<string, any>[]; valueKey?: string; labelKey?: string; height?: number; money?: boolean;
}) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0)), [data, valueKey]);
  const fmt = (v: number) => (money ? `₹${Math.round(v).toLocaleString('en-IN')}` : String(Math.round(v)));
  if (data.length === 0) return <EmptyState title="No data yet" />;
  return (
    <div className="w-full">
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((d, i) => {
          const v = Number(d[valueKey]) || 0;
          const h = Math.max(v > 0 ? 6 : 1, (v / max) * (height - 26));
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-[9.5px] font-bold text-slate-500 tabular-nums whitespace-nowrap">{fmt(v)}</span>
              <div className="w-full max-w-[42px] rounded-t-lg bg-gradient-to-t from-indigo-600 to-indigo-400 transition-all"
                style={{ height: h }} title={`${String(d[labelKey])}: ${fmt(v)}`} />
              <span className="text-[9px] font-bold text-slate-400 truncate w-full text-center">{String(d[labelKey])}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────── Line / area chart ────────────────────────── */
export function LineChart({ series, height = 190, money = false }: {
  series: { label: string; color: string; data: { month: string; value: number }[] }[];
  height?: number; money?: boolean;
}) {
  if (series.every((s) => s.data.length === 0)) return <EmptyState title="No data yet" />;
  const months = Array.from(new Set(series.flatMap((s) => s.data.map((d) => d.month)))).sort();
  const allVals = series.flatMap((s) => s.data.map((d) => d.value));
  const max = Math.max(1, ...allVals);
  const W = 560, H = height, PAD = 38, BOTTOM = 22;
  const x = (i: number) => PAD + (i / Math.max(months.length - 1, 1)) * (W - PAD - 12);
  const y = (v: number) => 8 + (1 - v / max) * (H - 8 - BOTTOM);
  const fmt = (v: number) => (money ? `₹${Math.round(v).toLocaleString('en-IN')}` : String(Math.round(v)));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={PAD} x2={W - 12} y1={y(max * f)} y2={y(max * f)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={PAD - 6} y={y(max * f) + 3} fontSize={8} fill="#94a3b8" textAnchor="end" fontWeight={700}>{fmt(max * f)}</text>
        </g>
      ))}
      {months.map((m, i) => (
        <text key={m} x={x(i)} y={H - 6} fontSize={8} fill="#94a3b8" textAnchor="middle" fontWeight={700}>{m.slice(5)}</text>
      ))}
      {series.map((s) => {
        const pts = s.data
          .map((d) => [x(months.indexOf(d.month)), y(d.value)] as const)
          .sort((a, b) => a[0] - b[0]);
        if (pts.length < 1) return null;
        if (pts.length === 1) {
          return <circle key={s.label} cx={pts[0][0]} cy={pts[0][1]} r={4} fill={s.color} />;
        }
        const line = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px},${py}`).join(' ');
        return (
          <g key={s.label}>
            <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {pts.map(([px, py], i) => (
              <circle key={i} cx={px} cy={py} r={2.6} fill="#fff" stroke={s.color} strokeWidth={1.6} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/* ────────────────────────── Donut chart ────────────────────────── */
export function DonutChart({ data, size = 150, money = false }: {
  data: { label: string; value: number; color: string }[]; size?: number; money?: boolean;
}) {
  const total = data.reduce((a, b) => a + Number(b.value), 0) || 0;
  const R = size / 2 - 10;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const fmt = (v: number) => (money ? `₹${Math.round(v).toLocaleString('en-IN')}` : String(Math.round(v)));
  if (total === 0) return <EmptyState title="No data yet" />;
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="#f1f5f9" strokeWidth={14} />
        {data.map((d, i) => {
          const frac = Number(d.value) / total;
          const dash = frac * C;
          const offset = -acc * C;
          acc += frac;
          return (
            <circle key={i} cx={size / 2} cy={size / 2} r={R} fill="none" stroke={d.color} strokeWidth={14}
              strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
          );
        })}
        <text x="50%" y="48%" textAnchor="middle" fontSize={size * 0.11} fontWeight={800} fill="#0f172a">{fmt(total)}</text>
        <text x="50%" y="60%" textAnchor="middle" fontSize={8} fontWeight={700} fill="#94a3b8">TOTAL</text>
      </svg>
      <div className="space-y-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px] font-bold">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
            <span className="text-slate-600">{d.label}</span>
            <span className="text-slate-900 tabular-nums ml-auto">{fmt(Number(d.value))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────── H table wrapper ────────────────────────── */
export function ResponsiveTable({ loading, error, onRetry, columns, rows, empty }: {
  loading?: boolean; error?: string | null; onRetry?: () => void;
  columns: { key: string; label: string; render?: (row: any) => React.ReactNode }[];
  rows: any[];
  empty?: string;
}) {
  if (loading) {
    return (
      <div className="space-y-2.5 py-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-xl bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-xs font-bold text-rose-600">{error}</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-3 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
            Retry
          </button>
        )}
      </div>
    );
  }
  if (rows.length === 0) return <EmptyState title={empty || 'No records yet'} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase">
            {columns.map((c) => (
              <th key={c.key} className="pb-3 pr-3 whitespace-nowrap">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-slate-50/70">
              {columns.map((c) => (
                <td key={c.key} className="py-3 pr-3 align-middle">
                  {c.render ? c.render(row) : String(row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────── Drawer ────────────────────────── */
export function Drawer({ open, onClose, title, children, wide = false }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.28, ease: 'easeOut' }}
            className={`fixed right-0 top-0 h-full z-50 bg-white shadow-floating flex flex-col ${wide ? 'w-full max-w-3xl' : 'w-full max-w-xl'}`}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-extrabold text-slate-900">{title}</h3>
              <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ────────────────────────── Confirm dialog ────────────────────────── */
export function ConfirmDialog({ open, onCancel, onConfirm, title, body, confirmLabel = 'Confirm', danger = false }: {
  open: boolean; onCancel: () => void; onConfirm: () => void; title: string; body: React.ReactNode;
  confirmLabel?: string; danger?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onCancel}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md p-6 bg-white rounded-3xl shadow-floating border border-slate-100"
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${danger ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'}`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-extrabold text-slate-900">{title}</h3>
                <div className="mt-1.5 text-xs font-semibold text-slate-500 leading-relaxed">{body}</div>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className={`px-4 py-2 rounded-xl text-xs font-bold text-white shadow-sm ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ────────────────────────── Money / date helpers ────────────────────────── */
export const inr = (v: number) => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
export const shortId = (id: string) => (id ? `${id.slice(0, 8)}…` : '—');
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
export const fmtDateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');

/* ────────────────────────── Funnel bars ────────────────────────── */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-2.5">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-36 shrink-0 text-[11px] font-bold text-slate-600 text-right">{s.label}</span>
          <div className="flex-1 h-7 rounded-lg bg-slate-100 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(s.value / max) * 100}%` }}
              transition={{ duration: 0.5, delay: i * 0.06 }}
              className="h-full rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-400 flex items-center justify-end pr-2"
            >
              <span className="text-[10px] font-black text-white">{s.value}</span>
            </motion.div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Plain (non-hook) row filter — callable from any render function. */
export function filterRows<T extends Record<string, any>>(rows: T[], keys: string[], q: string): T[] {
  if (!q.trim()) return rows;
  const needle = q.toLowerCase();
  return rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(needle)));
}
