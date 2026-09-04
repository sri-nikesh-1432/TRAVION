import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, Menu, ChevronRight, ShieldCheck, UserCheck } from 'lucide-react';

export interface PortalNavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  badge?: number | string;
}

interface PortalShellProps {
  title: string;
  subtitle: string;
  nav: PortalNavItem[];
  active: string;
  onNavigate: (key: string) => void;
  sessionEmail: string;
  onLogout: () => void;
  theme: 'manager' | 'admin';
  children: React.ReactNode;
}

export const PortalShell: React.FC<PortalShellProps> = ({
  title, subtitle, nav, active, onNavigate, sessionEmail, onLogout, theme, children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdmin = theme === 'admin';
  const brandBg = isAdmin ? 'bg-slate-900' : 'bg-indigo-950';
  const brandText = isAdmin ? 'text-white' : 'text-white';
  const accent = isAdmin ? 'bg-travion-500' : 'bg-indigo-600';

  const SidebarBody = (
    <div className={`h-full flex flex-col ${brandBg}`}>
      <div className="px-5 py-5 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-2xl ${accent} text-white flex items-center justify-center`}>
          {isAdmin ? <ShieldCheck className="w-5 h-5" /> : <UserCheck className="w-5 h-5" />}
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-black tracking-tight ${brandText} truncate`}>{title}</p>
          <p className={`text-[10px] font-bold block leading-none mt-0.5 ${isAdmin ? 'text-travion-400' : 'text-indigo-400'}`}>{subtitle}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {nav.map((item) => {
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              onClick={() => { onNavigate(item.key); setMobileOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[12.5px] font-bold transition-all ${
                isActive
                  ? isAdmin ? 'bg-white/10 text-white' : 'bg-white/10 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className={`${isActive ? 'text-white' : 'text-slate-500'}`}>{item.icon}</span>
              <span className="flex-1 text-left truncate">{item.label}</span>
              {item.badge != null && (
                <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[9.5px] font-black flex items-center justify-center ${isActive ? 'bg-white text-slate-900' : 'bg-slate-600 text-white'}`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-white/10 text-white flex items-center justify-center text-[10px] font-black uppercase">
            {sessionEmail.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-bold text-white truncate">{sessionEmail}</p>
            <p className="text-[9px] font-semibold text-slate-400">{isAdmin ? 'Administrator' : 'Operations Manager'}</p>
          </div>
          <button onClick={onLogout} className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5 transition-colors" title="Sign out">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  const activeLabel = nav.find((n) => n.key === active)?.label || '';

  return (
    <div className="min-h-screen bg-slate-100/80">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-60 z-30">{SidebarBody}</aside>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" />
            <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="fixed inset-y-0 left-0 w-64 z-50 lg:hidden">{SidebarBody}</motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="lg:pl-60 flex flex-col min-h-screen">
        {/* Top bar */}
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-xl border-b border-slate-200/80 px-4 md:px-6 py-3 flex items-center gap-3">
          <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
            <span>{subtitle}</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-slate-900">{activeLabel}</span>
          </div>
        </header>

        <main className="flex-1 w-full mx-auto px-4 md:px-6 py-6 max-w-[1400px]">
          {children}
        </main>
      </div>
    </div>
  );
};