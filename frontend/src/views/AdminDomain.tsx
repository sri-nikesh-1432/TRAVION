import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Shield, TrendingUp, Users, Compass, DollarSign, LogOut,
  Eye, EyeOff, Star, AlertTriangle, FileText, CheckCircle2
} from 'lucide-react';
import { AuthSession } from '../types';
import { api } from '../services/api';

interface AdminDomainProps {
  session: AuthSession;
  onLogout: () => void;
}

export const AdminDomain: React.FC<AdminDomainProps> = ({ session, onLogout }) => {
  const [overview, setOverview] = useState<any>(null);
  const [revenue, setRevenue] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [guides, setGuides] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'revenue' | 'users' | 'guides' | 'reviews' | 'audit'>('revenue');

  const fetchAdminData = async () => {
    try {
      const ov = await api.getAdminOverview();
      setOverview(ov);
      const rev = await api.getAdminRevenue();
      setRevenue(rev);
      const u = await api.getAdminUsers();
      setUsers(u);
      const g = await api.getAdminGuides();
      setGuides(g);
      const r = await api.getAdminReviews(true);
      setReviews(r);
      const a = await api.getAdminAuditLogs();
      setAuditLogs(a);
    } catch (err) {
      console.error("Admin data fetch error:", err);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-900 text-white border-b border-slate-800 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-travion-500 text-white flex items-center justify-center">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <span className="text-base font-black tracking-tight">TRAVION CONTROL CENTER</span>
            <span className="text-[10px] font-bold text-travion-400 block leading-none">Super Administrator</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-400">{session.email}</span>
          <button
            onClick={onLogout}
            className="p-2 text-slate-400 hover:text-red-400 rounded-xl hover:bg-slate-800 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl w-full mx-auto px-4 md:px-6 py-8 space-y-8">
        
        {/* Executive Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Total Travellers</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{overview?.total_users || 0}</div>
          </div>
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Total Guides</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{overview?.total_guides || 0}</div>
          </div>
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Managers</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{overview?.total_managers || 0}</div>
          </div>
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Active Trips</span>
            <div className="text-2xl font-black text-emerald-600 mt-1">{overview?.active_trips || 0}</div>
          </div>
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Completed Trips</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{overview?.completed_trips || 0}</div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex p-1 rounded-2xl bg-white border border-slate-200 w-fit text-xs font-bold">
          <button
            onClick={() => setActiveTab('revenue')}
            className={`px-4 py-2 rounded-xl transition-all ${
              activeTab === 'revenue' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Dual Revenue Dashboard
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 rounded-xl transition-all ${
              activeTab === 'users' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Users ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('guides')}
            className={`px-4 py-2 rounded-xl transition-all ${
              activeTab === 'guides' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Guides ({guides.length})
          </button>
          <button
            onClick={() => setActiveTab('reviews')}
            className={`px-4 py-2 rounded-xl transition-all ${
              activeTab === 'reviews' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Review Moderation ({reviews.length})
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 rounded-xl transition-all ${
              activeTab === 'audit' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Audit Trail ({auditLogs.length})
          </button>
        </div>

        {/* TAB 1: DUAL REVENUE REPORTING (Document 07 Prompt #14) */}
        {activeTab === 'revenue' && (
          <div className="space-y-6">
            <div className="p-8 rounded-3xl bg-white border border-slate-200 shadow-soft">
              <div className="mb-6">
                <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Financial Integrity</span>
                <h3 className="text-2xl font-black text-slate-900 tracking-tight">
                  Dual Revenue Separation Model
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Strict segregation between gross transaction throughput and actual retained platform revenue commissions.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Number 1: Total Platform Transactions */}
                <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                    Total Platform Transactions
                  </span>
                  <div className="text-3xl font-black text-slate-900">
                    ₹{revenue?.total_platform_transactions.toLocaleString() || '0'}
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 mt-2 block">
                    Gross throughput across all user payments, stays & transports.
                  </span>
                </div>

                {/* Number 2: Actual Platform Revenue (FEES ONLY) */}
                <div className="p-6 rounded-2xl bg-travion-50 border border-travion-200 ring-2 ring-travion-300">
                  <span className="text-xs font-bold uppercase tracking-wider text-travion-700 block mb-2">
                    Actual Platform Revenue
                  </span>
                  <div className="text-3xl font-black text-travion-700">
                    ₹{revenue?.actual_platform_revenue.toLocaleString() || '0'}
                  </div>
                  <span className="text-[11px] font-bold text-travion-800 mt-2 block flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    <span>Retained platform service commissions only.</span>
                  </span>
                </div>

                {/* Number 3: Guide Fees Payouts (Tracked Separately) */}
                <div className="p-6 rounded-2xl bg-emerald-50 border border-emerald-200">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 block mb-2">
                    Guide Fees Settlement
                  </span>
                  <div className="text-3xl font-black text-emerald-700">
                    ₹{revenue?.total_guide_fees_payout.toLocaleString() || '0'}
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-800 mt-2 block">
                    Explicitly excluded from platform earnings and held for guides.
                  </span>
                </div>

              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Users Table */}
        {activeTab === 'users' && (
          <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <h3 className="text-base font-extrabold text-slate-900 mb-4">Registered Travellers</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase">
                    <th className="pb-3">User ID</th>
                    <th className="pb-3">Email</th>
                    <th className="pb-3">Name</th>
                    <th className="pb-3">Language</th>
                    <th className="pb-3">Home City</th>
                    <th className="pb-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {users.map(u => (
                    <tr key={u.id}>
                      <td className="py-3 font-mono text-[11px]">{u.id.slice(0, 8)}…</td>
                      <td className="py-3 font-bold text-slate-900">{u.email}</td>
                      <td className="py-3">{u.name}</td>
                      <td className="py-3">{u.preferred_language}</td>
                      <td className="py-3">{u.home_city || 'N/A'}</td>
                      <td className="py-3 text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: Guides Table */}
        {activeTab === 'guides' && (
          <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <h3 className="text-base font-extrabold text-slate-900 mb-4">Local Guide Network</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase">
                    <th className="pb-3">Guide Name</th>
                    <th className="pb-3">Email</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Approval</th>
                    <th className="pb-3">Destinations</th>
                    <th className="pb-3">Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {guides.map(g => (
                    <tr key={g.id}>
                      <td className="py-3 font-bold text-slate-900">{g.name}</td>
                      <td className="py-3">{g.email}</td>
                      <td className="py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          g.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {g.status}
                        </span>
                      </td>
                      <td className="py-3">
                        <span className="font-bold text-slate-800">{g.approval_status}</span>
                      </td>
                      <td className="py-3">{g.destinations?.join(', ') || 'N/A'}</td>
                      <td className="py-3">
                        <span className="flex items-center gap-1 font-bold text-amber-600">
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                          <span>{g.rating} ({g.review_count})</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: Review Moderation (Including Guide-Hidden Reviews) */}
        {activeTab === 'reviews' && (
          <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <div className="mb-4">
              <h3 className="text-base font-extrabold text-slate-900">Review Moderation Center</h3>
              <p className="text-xs text-slate-500">
                Displays all reviews across the network. Reviews hidden by guides from their personal profiles remain visible here for administrative moderation and quality audit.
              </p>
            </div>

            <div className="space-y-3">
              {reviews.map(r => (
                <div key={r.id} className="p-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center text-amber-400">
                        {Array.from({ length: r.rating }).map((_, i) => (
                          <Star key={i} className="w-3.5 h-3.5 fill-amber-400" />
                        ))}
                      </div>
                      <span className="text-xs font-bold text-slate-900">{r.user_name}</span>
                      <span className="text-xs text-slate-400">for guide</span>
                      <span className="text-xs font-bold text-indigo-600">{r.guide_name}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">"{r.comment || 'No comment provided.'}"</p>
                  </div>

                  <div>
                    {r.is_visible_on_profile ? (
                      <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        <span>Public</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold flex items-center gap-1">
                        <EyeOff className="w-3 h-3" />
                        <span>Hidden by Guide</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: Audit Logs */}
        {activeTab === 'audit' && (
          <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <h3 className="text-base font-extrabold text-slate-900 mb-4">Elevation & Operational Audit Trail</h3>
            <div className="space-y-2.5">
              {auditLogs.map(log => (
                <div key={log.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between font-mono">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-indigo-700">[{log.action}]</span>
                    <span className="text-slate-800 font-sans">{log.actor_email} ({log.actor_role})</span>
                  </div>
                  <span className="text-slate-400 text-[11px] font-sans">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
};
