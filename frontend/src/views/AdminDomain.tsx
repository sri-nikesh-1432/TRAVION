import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard, Users, UserCheck, Briefcase, ClipboardList, Workflow,
  Activity, CreditCard, Wallet, TrendingUp, BarChart3, Star, ScrollText, Eye, Download,
} from 'lucide-react';
import { AuthSession } from '../types';
import { api } from '../services/api';
import { PortalShell, PortalNavItem } from '../components/portal/PortalShell';
import {
  KpiCard, StatusPill, ModePill, EmptyState, SectionCard, SearchBox, IconBtn,
  BarChart, LineChart, DonutChart, ResponsiveTable, Drawer, Funnel,
  inr, shortId, fmtDate, fmtDateTime, filterRows,
} from '../components/portal/ui';

interface AdminDomainProps {
  session: AuthSession;
  onLogout: () => void;
}

type PageKey = 'overview' | 'users' | 'guides' | 'managers' | 'trips' | 'conversions' | 'active' | 'payments' | 'settlements' | 'revenue' | 'analytics' | 'reviews' | 'audit';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#0ea5e9', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e'];

export const AdminDomain: React.FC<AdminDomainProps> = ({ session, onLogout }) => {
  const [page, setPage] = useState<PageKey>('overview');
  const [overview, setOverview] = useState<any>(null);
  const [revenue, setRevenue] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [guides, setGuides] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [conversions, setConversions] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [activeOps, setActiveOps] = useState<any[]>([]);
  const [detailTrip, setDetailTrip] = useState<any | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [queries, setQueries] = useState<Record<string, string>>({});
  const qFor = (p: string) => queries[p] || '';
  const setQFor = (p: string) => (v: string) => setQueries((prev) => ({ ...prev, [p]: v }));

  const NAV: PortalNavItem[] = [
    { key: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { key: 'users', label: 'Users', icon: <Users className="w-4 h-4" />, badge: users.length || undefined },
    { key: 'guides', label: 'Guides', icon: <UserCheck className="w-4 h-4" />, badge: guides.length || undefined },
    { key: 'managers', label: 'Managers', icon: <Briefcase className="w-4 h-4" /> },
    { key: 'trips', label: 'Trips', icon: <ClipboardList className="w-4 h-4" />, badge: trips.length || undefined },
    { key: 'conversions', label: 'Conversions', icon: <Workflow className="w-4 h-4" /> },
    { key: 'active', label: 'Active Operations', icon: <Activity className="w-4 h-4" />, badge: activeOps.length || undefined },
    { key: 'payments', label: 'Payments', icon: <CreditCard className="w-4 h-4" />, badge: payments.length || undefined },
    { key: 'settlements', label: 'Settlements', icon: <Wallet className="w-4 h-4" /> },
    { key: 'revenue', label: 'Revenue Analytics', icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'analytics', label: 'Platform Analytics', icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'reviews', label: 'Reviews', icon: <Star className="w-4 h-4" /> },
    { key: 'audit', label: 'Audit Logs', icon: <ScrollText className="w-4 h-4" /> },
  ];

  const loadAll = useCallback(async () => {
    try {
      const [o, r] = await Promise.all([api.getAdminOverview(), api.getAdminRevenue()]);
      setOverview(o); setRevenue(r);
    } catch (err) { console.error('admin core fetch failed:', err); }
  }, []);

  const fetchPage = useCallback(async (p: PageKey) => {
    if (p === 'users') { try { setUsers(await api.getAdminUsers()); } catch { } }
    if (p === 'guides') { try { setGuides(await api.getAdminGuides()); } catch { } }
    if (p === 'managers') { try { setManagers(await api.getAdminManagers()); } catch { } }
    if (p === 'trips') { try { setTrips(await api.getAdminTrips()); } catch { } }
    if (p === 'payments') { try { setPayments(await api.getAdminPayments()); } catch { } }
    if (p === 'settlements') { try { setSettlements(await api.getAdminSettlements()); } catch { } }
    if (p === 'conversions') { try { setConversions(await api.getAdminConversions()); } catch { } }
    if (p === 'analytics') { try { setAnalytics(await api.getAdminAnalytics()); } catch { } }
    if (p === 'reviews') { try { setReviews(await api.getAdminReviews(true)); } catch { } }
    if (p === 'audit') { try { setAudit(await api.getAdminAuditLogs()); } catch { } }
    if (p === 'active') { try { setActiveOps(await api.getAdminActiveOperations()); } catch { } }
  }, []);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNavigate = (key: string) => {
    setPage(key as PageKey);
    fetchPage(key as PageKey);
  };

  const exportCsv = (rows: any[], filename: string, map: (r: any) => Record<string, any>) => {
    if (rows.length === 0) return;
    const mapped = rows.map(map);
    const cols = Array.from(new Set(mapped.flatMap((r) => Object.keys(r))));
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...mapped.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ───────────────────────── PAGES ───────────────────────── */
  const renderOverview = () => (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        <KpiCard label="Total Users" value={overview?.total_users ?? 0} />
        <KpiCard label="Guides" value={overview?.total_guides ?? 0} />
        <KpiCard label="Verified Guides" value={overview?.verified_guides ?? 0} tone="emerald" />
        <KpiCard label="Pending Verifications" value={overview?.pending_guides ?? 0} tone="amber" />
        <KpiCard label="Managers" value={overview?.total_managers ?? 0} />
        <KpiCard label="Active Trips" value={overview?.active_trips ?? 0} tone="indigo" />
        <KpiCard label="Completed Trips" value={overview?.completed_trips ?? 0} tone="sky" />
        <KpiCard label="Successful Payments" value={overview?.total_payments ?? 0} tone="emerald" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Platform revenue" value={inr(overview?.platform_revenue ?? 0)} tone="indigo" sub="fees only — never the travel budget" />
        <KpiCard label="Pending settlements" value={overview?.pending_settlements ?? 0} tone="amber" />
        <KpiCard label="Failed payments" value={overview?.failed_payments ?? 0} tone="rose" />
        <KpiCard label="Currency" value="INR" sub="Payments in Indian Rupees" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Platform health" subtitle="Computed from live records">
          <div className="space-y-2.5">
            {overview?.pending_guides > 0 && <HealthRow label="Pending guide verifications" count={overview.pending_guides} tone="amber" />}
            {overview?.active_trips > 0 && <HealthRow label="Active / running trips" count={overview.active_trips} tone="indigo" />}
            {overview?.pending_settlements > 0 && <HealthRow label="Pending settlements" count={overview.pending_settlements} tone="amber" />}
            {overview?.failed_payments > 0 && <HealthRow label="Failed payments" count={overview.failed_payments} tone="rose" />}
            {overview?.total_payments > 0 && <HealthRow label="Successful payments" count={overview.total_payments} tone="emerald" />}
            {(!overview?.active_trips && !overview?.pending_guides && !overview?.pending_settlements) && (
              <EmptyState title="Platform idle" hint="No open operational items right now — all metrics come from real records." />
            )}
          </div>
        </SectionCard>

        <SectionCard title="Financial split" subtitle="Gross transactions vs retained revenue vs guide payouts">
          <div className="space-y-3">
            <SplitRow label="Total platform transactions" amount={revenue?.total_platform_transactions ?? 0} strong />
            <SplitRow label="Actual platform revenue (fees)" amount={revenue?.actual_platform_revenue ?? 0} tone="indigo" />
            <SplitRow label="Guide fees held for settlement" amount={revenue?.total_guide_fees_payout ?? 0} tone="emerald" />
            <p className="pt-2 text-[10.5px] leading-relaxed font-semibold text-slate-400">
              Traveller payments are split at payment time into the guide pool and platform commission. The estimated travel budget is never counted as Travion revenue.
            </p>
          </div>
        </SectionCard>
      </div>
    </>
  );

  const renderUsers = () => {
    const q = qFor('users');
    const filtered = filterRows(users, ['name', 'email', 'home_city', 'preferred_language'], q);
    return (
      <SectionCard title="Registered travellers" subtitle={`${users.length} user record(s)`}
        actions={<SearchBox value={q} onChange={setQFor('users')} placeholder="Search users…" />}>
        <ResponsiveTable
          rows={filtered} empty="No users registered yet"
          columns={[
            { key: 'name', label: 'User', render: (r) => <span className="font-extrabold text-slate-900">{r.name}</span> },
            { key: 'email', label: 'Email', render: (r) => <span className="text-slate-500">{r.email}</span> },
            { key: 'preferred_language', label: 'Language', render: (r) => <span className="text-slate-500">{r.preferred_language || '—'}</span> },
            { key: 'home_city', label: 'Home city', render: (r) => <span className="text-slate-500">{r.home_city || '—'}</span> },
            { key: 'created_at', label: 'Joined', render: (r) => <span className="text-slate-400 whitespace-nowrap">{fmtDate(r.created_at)}</span> },
          ]}
        />
      </SectionCard>
    );
  };

  const renderGuides = () => {
    const q = qFor('guides');
    const filtered = filterRows(guides, ['name', 'email', 'status', 'approval_status', 'destinations'], q);
    return (
      <SectionCard title="Guide database" subtitle={`${guides.length} guide record(s)`}
        actions={<SearchBox value={q} onChange={setQFor('guides')} placeholder="Search guides…" />}>
        <ResponsiveTable
          rows={filtered} empty="No guides yet"
          columns={[
            { key: 'name', label: 'Guide', render: (r) => <span className="font-extrabold text-slate-900">{r.name}</span> },
            { key: 'email', label: 'Email', render: (r) => <span className="text-slate-500">{r.email}</span> },
            { key: 'destinations', label: 'Coverage', render: (r) => <span className="text-slate-500">{r.destinations?.join(', ') || '—'}</span> },
            { key: 'languages', label: 'Languages', render: (r) => <span className="text-slate-500">{r.languages?.join(', ') || '—'}</span> },
            { key: 'rating', label: 'Rating', render: (r) => <span className="font-bold text-amber-600 inline-flex items-center gap-1"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{r.rating} ({r.review_count})</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'approval_status', label: 'Verification', render: (r) => <StatusPill status={r.approval_status} /> },
          ]}
        />
      </SectionCard>
    );
  };

  const renderManagers = () => (
    <SectionCard title="Operations managers" subtitle={`${managers.length} manager record(s)`}>
      <ResponsiveTable
        rows={managers} empty="No managers elevated yet"
        columns={[
          { key: 'name', label: 'Manager', render: (r) => <span className="font-extrabold text-slate-900">{r.name}</span> },
          { key: 'email', label: 'Email', render: (r) => <span className="text-slate-500">{r.email}</span> },
          { key: 'department', label: 'Department', render: (r) => <span className="text-slate-500">{r.department || 'Operations'}</span> },
          { key: 'assignments', label: 'Assignments', render: (r) => <span className="font-bold text-indigo-600">{r.assignments}</span> },
          { key: 'audit_actions', label: 'Audit actions', render: (r) => <span className="text-slate-500">{r.audit_actions}</span> },
          { key: 'created_at', label: 'Joined', render: (r) => <span className="text-slate-400 whitespace-nowrap">{fmtDate(r.created_at)}</span> },
        ]}
      />
    </SectionCard>
  );

  const renderTrips = () => {
    const q = qFor('trips');
    const filtered = filterRows(trips, ['traveller', 'destination', 'mode', 'status', 'guide_name'], q);
    return (
      <SectionCard title="Global trip database" subtitle={`${trips.length} trip record(s)`}
        actions={
          <div className="flex items-center gap-2">
            <SearchBox value={q} onChange={setQFor('trips')} placeholder="Search trips…" />
            <button onClick={() => exportCsv(trips, 'travion-trips', (r: any) => ({
              trip: r.trip_id, traveller: r.traveller, source: r.source, destination: r.destination,
              start: r.start_datetime, end: r.end_datetime, mode: r.mode, budget: r.budget,
              total_cost: r.total_cost, status: r.status, guide: r.guide_name, payment: r.payment_status,
            }))} className="p-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200" title="Export CSV">
              <Download className="w-4 h-4" />
            </button>
          </div>
        }>
        <ResponsiveTable
          rows={filtered} empty="No trips recorded"
          columns={[
            { key: 'traveller', label: 'Traveller', render: (r) => <span className="font-extrabold text-slate-900">{r.traveller}</span> },
            { key: 'route', label: 'Route', render: (r) => <span className="text-slate-600">{r.source} → {r.destination}</span> },
            { key: 'start_datetime', label: 'Dates', render: (r) => <span className="text-slate-500 whitespace-nowrap">{fmtDate(r.start_datetime)} – {fmtDate(r.end_datetime)}</span> },
            { key: 'mode', label: 'Mode', render: (r) => <ModePill mode={r.mode} /> },
            { key: 'budget', label: 'Budget', render: (r) => <span className="text-slate-600">{inr(r.budget)}</span> },
            { key: 'total_cost', label: 'Plan cost', render: (r) => <span className="font-bold text-slate-700">{inr(r.total_cost)}</span> },
            { key: 'guide_name', label: 'Guide', render: (r) => r.guide_name ? <span className="font-bold text-indigo-700">{r.guide_name}</span> : <span className="text-slate-300">—</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'details', label: '', render: (r) => <IconBtn onClick={() => setDetailTrip(r)} title="View lifecycle"><Eye className="w-4 h-4" /></IconBtn> },
          ]}
        />
      </SectionCard>
    );
  };

  const renderConversions = () => {
    const funnelData = conversions?.funnel;
    const steps = funnelData ? [
      { label: 'Trip requests', value: funnelData.trip_requests },
      { label: 'Guide mode requests', value: funnelData.guide_mode_requests },
      { label: 'Guide assigned', value: funnelData.guide_assigned },
      { label: 'Trip started', value: funnelData.trip_started },
      { label: 'Completed', value: funnelData.trip_completed },
    ] : [];
    return (
      <>
        <SectionCard title="Conversion funnel" subtitle="Platform-wide assignment pipeline from real records" className="mb-6">
          {funnelData ? <Funnel steps={steps} /> : <EmptyState title="Loading funnel…" />}
        </SectionCard>
        <SectionCard title="Assignment history" subtitle={`${conversions?.assignments?.length || 0} assignment record(s)`}>
          <ResponsiveTable
            rows={conversions?.assignments || []} empty="No assignments made yet"
            columns={[
              { key: 'traveller', label: 'Traveller', render: (r) => <span className="font-extrabold text-slate-900">{r.traveller}</span> },
              { key: 'destination', label: 'Destination', render: (r) => <span className="text-slate-600">{r.destination}</span> },
              { key: 'guide_name', label: 'Guide', render: (r) => r.guide_name ? <span className="font-bold text-indigo-700">{r.guide_name}</span> : <span className="text-slate-300">—</span> },
              { key: 'match_score', label: 'Match', render: (r) => <span className="font-black text-indigo-600">{r.match_score}%</span> },
              { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
              { key: 'requested_at', label: 'Requested', render: (r) => <span className="text-slate-400 whitespace-nowrap">{fmtDateTime(r.requested_at)}</span> },
            ]}
          />
        </SectionCard>
      </>
    );
  };

  const renderActive = () => (
    <SectionCard title="Active operations" subtitle="All running trips platform-wide">
      <ResponsiveTable
        rows={activeOps} empty="No trips currently running"
        columns={[
          { key: 'traveller', label: 'Traveller', render: (r) => <span className="font-extrabold text-slate-900">{r.traveller}</span> },
          { key: 'route', label: 'Route', render: (r) => <span className="text-slate-600">{r.source} → {r.destination}</span> },
          { key: 'start_datetime', label: 'Started', render: (r) => <span className="text-slate-500 whitespace-nowrap">{fmtDateTime(r.start_datetime)}</span> },
          { key: 'mode', label: 'Mode', render: (r) => <ModePill mode={r.mode} /> },
          { key: 'guide_name', label: 'Guide', render: (r) => r.guide_name ? <span className="font-bold text-indigo-700">{r.guide_name}</span> : <span className="text-slate-300">—</span> },
          { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
          { key: 'details', label: '', render: (r) => <IconBtn onClick={() => setDetailTrip(r)} title="View"><Eye className="w-4 h-4" /></IconBtn> },
        ]}
      />
    </SectionCard>
  );

  const renderPayments = () => {
    const q = qFor('payments');
    const filtered = filterRows(payments, ['traveller', 'destination', 'status', 'guide_name'], q);
    return (
      <SectionCard title="Payment ledger" subtitle={`${payments.length} transaction record(s)`}
        actions={
          <div className="flex items-center gap-2">
            <SearchBox value={q} onChange={setQFor('payments')} placeholder="Search payments…" />
            <button onClick={() => exportCsv(payments, 'travion-payments', (r: any) => ({
              payment: r.payment_id, order: r.razorpay_order_id, traveller: r.traveller, destination: r.destination,
              amount: r.amount, currency: r.currency, status: r.status, guide: r.guide_name,
              guide_fee: r.guide_fee, platform_fee: r.platform_fee, settlement: r.settlement_status, date: r.created_at,
            }))} className="p-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200" title="Export CSV">
              <Download className="w-4 h-4" />
            </button>
          </div>
        }>
        <ResponsiveTable
          rows={filtered} empty="No payments recorded"
          columns={[
            { key: 'payment_id', label: 'Transaction', render: (r) => <span className="font-mono text-[10.5px] text-slate-400">{shortId(r.payment_id)}</span> },
            { key: 'traveller', label: 'Traveller', render: (r) => <span className="font-extrabold text-slate-900">{r.traveller}</span> },
            { key: 'destination', label: 'Trip', render: (r) => <span className="text-slate-600">{r.destination}</span> },
            { key: 'amount', label: 'Total amount', render: (r) => <span className="font-bold text-slate-900">{inr(r.amount)}</span> },
            { key: 'guide_fee', label: 'Guide fee', render: (r) => <span className="text-emerald-600 font-bold">{inr(r.guide_fee)}</span> },
            { key: 'platform_fee', label: 'Platform fee', render: (r) => <span className="text-indigo-600 font-bold">{inr(r.platform_fee)}</span> },
            { key: 'guide_name', label: 'Guide', render: (r) => r.guide_name || <span className="text-slate-300">—</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'created_at', label: 'Date', render: (r) => <span className="text-slate-400 whitespace-nowrap">{fmtDate(r.created_at)}</span> },
          ]}
        />
      </SectionCard>
    );
  };

  const renderSettlements = () => (
    <SectionCard title="Guide settlements" subtitle="Money trail — every guide fee, its payment and settlement state">
      <ResponsiveTable
        rows={settlements} empty="No settlement records yet"
        columns={[
          { key: 'traveller', label: 'Traveller', render: (r) => <span className="font-extrabold text-slate-900">{r.traveller}</span> },
          { key: 'destination', label: 'Destination', render: (r) => <span className="text-slate-600">{r.destination}</span> },
          { key: 'guide_name', label: 'Guide', render: (r) => r.guide_name ? <span className="font-bold text-indigo-700">{r.guide_name}</span> : <span className="text-slate-300">—</span> },
          { key: 'guide_fee', label: 'Guide fee', render: (r) => <span className="font-bold text-emerald-600">{inr(r.guide_fee)}</span> },
          { key: 'platform_fee', label: 'Platform fee', render: (r) => <span className="text-slate-500">{inr(r.platform_fee)}</span> },
          { key: 'total_amount', label: 'Traveller paid', render: (r) => <span className="font-bold text-slate-700">{inr(r.total_amount)}</span> },
          { key: 'payment_status', label: 'Payment', render: (r) => <StatusPill status={r.payment_status} /> },
          { key: 'settlement_status', label: 'Settlement', render: (r) => <StatusPill status={r.settlement_status} /> },
          { key: 'settled_at', label: 'Settled at', render: (r) => <span className="text-slate-400 whitespace-nowrap">{r.settled_at ? fmtDateTime(r.settled_at) : '—'}</span> },
        ]}
      />
    </SectionCard>
  );

  const renderRevenue = () => {
    if (!revenue) return <div className="h-40" />;
    const monthly = revenue.by_month || [];
    const months = monthly.map((m: any) => m.month);
    const donutData = [
      ...(revenue.payment_status_counts || []).map((d: any, i: number) => ({
        label: d.status, value: d.count, color: d.status === 'SUCCESS' ? '#10b981' : d.status === 'FAILED' ? '#f43f5e' : '#f59e0b',
      })),
    ];
    const settlementDonut = (revenue.settlement_status_counts || []).map((d: any, i: number) => ({
      label: d.status, value: d.count, color: d.status === 'SETTLED' ? '#10b981' : '#f59e0b',
    }));
    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <KpiCard label="Total transaction value" value={inr(revenue.total_platform_transactions)} />
          <KpiCard label="Platform revenue" value={inr(revenue.actual_platform_revenue)} tone="indigo" sub="fees only" />
          <KpiCard label="Guide payouts" value={inr(revenue.total_guide_fees_payout)} tone="emerald" />
          <KpiCard label="Settled guide fees" value={inr(revenue.settled_guide_fees)} tone="sky" sub={`${inr(revenue.pending_guide_fees)} pending`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Revenue trend" subtitle="Gross vs platform vs guide by month">
            <LineChart height={210} money series={[
              { label: 'Gross', color: '#94a3b8', data: months.map((m: string, i: number) => ({ month: m, value: monthly[i].gross })) },
              { label: 'Platform', color: '#6366f1', data: months.map((m: string, i: number) => ({ month: m, value: monthly[i].platform })) },
              { label: 'Guide', color: '#10b981', data: months.map((m: string, i: number) => ({ month: m, value: monthly[i].guide })) },
            ]} />
          </SectionCard>
          <SectionCard title="Guide vs platform split" subtitle="Comparison per month">
            <LineChart height={210} money series={[
              { label: 'Platform fee', color: '#6366f1', data: months.map((m: string, i: number) => ({ month: m, value: monthly[i].platform })) },
              { label: 'Guide fee', color: '#10b981', data: months.map((m: string, i: number) => ({ month: m, value: monthly[i].guide })) },
            ]} />
          </SectionCard>
          <SectionCard title="Revenue by destination" subtitle="Top destinations">
            <BarChart data={(revenue.by_destination || []).slice(0, 8).map((d: any) => ({ label: d.destination, value: d.revenue }))} money />
          </SectionCard>
          <SectionCard title="Revenue by mode" subtitle="Guide vs adventurous">
            <BarChart data={(revenue.by_mode || []).map((d: any) => ({ label: d.mode === 'GUIDE_MODE' ? 'Guide' : d.mode || 'Unknown', value: d.revenue }))} money />
          </SectionCard>
          <SectionCard title="Payment status" subtitle="Transaction outcomes">
            <DonutChart data={donutData} />
          </SectionCard>
          <SectionCard title="Settlement status" subtitle="Guide pool settlement state">
            <DonutChart data={settlementDonut} />
          </SectionCard>
        </div>
      </>
    );
  };

  const renderAnalytics = () => {
    if (!analytics) return <div className="h-40" />;
    const growthMonths = (analytics.users_growth || []).map((d: any) => d.month);
    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <KpiCard label="Avg trip budget" value={inr(analytics.average_budget)} />
          <KpiCard label="Avg trip duration" value={`${analytics.average_trip_duration_days} days`} />
          <KpiCard label="Avg guide rating" value={<span className="inline-flex items-center gap-1"><Star className="w-4 h-4 fill-amber-400 text-amber-400" />{analytics.average_guide_rating}</span>} tone="amber" />
          <KpiCard label="Assignment rate" value={`${analytics.assignment_rate}%`} tone="indigo" sub="guide-mode trips with an assigned guide" />
          <KpiCard label="Completion rate" value={`${analytics.completion_rate}%`} tone="emerald" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Growth" subtitle="Users · guides · trips per month">
            <LineChart height={200} series={[
              { label: 'Users', color: '#6366f1', data: growthMonths.map((m: string, i: number) => ({ month: m, value: analytics.users_growth[i].count })) },
              { label: 'Guides', color: '#10b981', data: growthMonths.map((m: string, i: number) => ({ month: m, value: analytics.guides_growth[i]?.count || 0 })) },
              { label: 'Trips', color: '#f59e0b', data: growthMonths.map((m: string, i: number) => ({ month: m, value: analytics.trips_growth[i]?.count || 0 })) },
            ]} />
          </SectionCard>
          <SectionCard title="Destination popularity" subtitle="Trip counts by destination">
            <BarChart data={(analytics.destination_popularity || []).slice(0, 8).map((d: any) => ({ label: d.destination, value: d.count }))} />
          </SectionCard>
          <SectionCard title="Mode popularity" subtitle="Trip counts by mode">
            <BarChart data={(analytics.mode_popularity || []).map((d: any) => ({ label: d.mode === 'GUIDE_MODE' ? 'Guide' : d.mode || 'Unknown', value: d.count }))} />
          </SectionCard>
          <SectionCard title="Trip status distribution" subtitle="Current lifecycle state of every trip">
            <DonutChart data={(analytics.trip_status_distribution || []).map((d: any, i: number) => ({
              label: d.status, value: d.count, color: COLORS[i % COLORS.length],
            }))} />
          </SectionCard>
        </div>
      </>
    );
  };

  const renderReviews = () => {
    const q = qFor('reviews');
    const filtered = filterRows(reviews, ['user_name', 'guide_name', 'comment'], q);
    return (
      <SectionCard title="Review moderation" subtitle="Every review including ones hidden by guides — nothing is deleted, only visibility changes"
        actions={<SearchBox value={q} onChange={setQFor('reviews')} placeholder="Search reviews…" />}>
        <ResponsiveTable
          rows={filtered} empty="No reviews recorded"
          columns={[
            { key: 'user_name', label: 'Traveller', render: (r) => <span className="font-extrabold text-slate-900">{r.user_name}</span> },
            { key: 'guide_name', label: 'Guide', render: (r) => <span className="font-bold text-indigo-700">{r.guide_name}</span> },
            { key: 'rating', label: 'Rating', render: (r) => (
              <span className="inline-flex items-center gap-0.5 text-amber-400">
                {Array.from({ length: Math.min(r.rating, 5) }).map((_, i) => <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />)}
              </span>
            ) },
            { key: 'comment', label: 'Comment', render: (r) => <span className="text-slate-500 line-clamp-2 max-w-[300px]">{r.comment || '—'}</span> },
            { key: 'visible', label: 'Visibility', render: (r) => <StatusPill status={r.is_visible_on_profile ? 'Public' : 'Hidden'} /> },
            { key: 'created_at', label: 'Date', render: (r) => <span className="text-slate-400 whitespace-nowrap">{fmtDate(r.created_at)}</span> },
          ]}
        />
      </SectionCard>
    );
  };

  const renderAudit = () => {
    const q = qFor('audit');
    const filtered = filterRows(audit, ['action', 'actor_email', 'actor_role'], q);
    return (
      <SectionCard title="Audit logs" subtitle="Every sensitive action with actor, role and target"
        actions={<SearchBox value={q} onChange={setQFor('audit')} placeholder="Search audit trail…" />}>
        <div className="space-y-2">
          {filtered.length === 0 ? <EmptyState title="No audit entries" /> : filtered.map((log, i) => (
            <div key={i} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-black text-indigo-700">[{log.action}]</span>
              <span className="font-bold text-slate-800">{log.actor_email}</span>
              <span className="text-slate-400">({log.actor_role})</span>
              {log.target_id && <span className="font-mono text-[10px] text-slate-400">{shortId(log.target_id)}</span>}
              <span className="ml-auto text-slate-400 font-semibold whitespace-nowrap">{fmtDateTime(log.created_at)}</span>
            </div>
          ))}
        </div>
      </SectionCard>
    );
  };

  /* shared health/split helpers */
  const HealthRow = ({ label, count, tone }: { label: string; count: number; tone: 'amber' | 'indigo' | 'rose' | 'emerald' }) => {
    const tones: Record<string, string> = {
      amber: 'bg-amber-50 border-amber-100 text-amber-800', indigo: 'bg-indigo-50 border-indigo-100 text-indigo-800',
      rose: 'bg-rose-50 border-rose-100 text-rose-800', emerald: 'bg-emerald-50 border-emerald-100 text-emerald-800',
    };
    return (
      <div className={`flex items-center justify-between gap-3 p-3 rounded-2xl border ${tones[tone]}`}>
        <span className="text-[11.5px] font-bold">{label}</span>
        <span className="text-sm font-black tabular-nums">{count}</span>
      </div>
    );
  };
  const SplitRow = ({ label, amount, tone, strong }: { label: string; amount: number; tone?: string; strong?: boolean }) => {
    const tones: Record<string, string> = { indigo: 'text-indigo-700', emerald: 'text-emerald-700' };
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-bold text-slate-500">{label}</span>
        <span className={`text-[15px] ${strong ? 'font-black text-slate-900' : 'font-extrabold ' + (tones[tone || ''] || 'text-slate-700')} tabular-nums`}>
          {inr(amount)}
        </span>
      </div>
    );
  };

  return (
    <PortalShell
      title="TRAVION ADMIN"
      subtitle="Platform Control Center"
      nav={NAV}
      active={page}
      onNavigate={onNavigate}
      sessionEmail={session.email}
      onLogout={onLogout}
      theme="admin"
    >
      {notice && (
        <div className="mb-5 px-4 py-3 rounded-2xl bg-slate-900 text-white text-[12px] font-bold flex items-center gap-2">
          {notice}
          <button onClick={() => setNotice(null)} className="ml-auto text-slate-400 hover:text-white">Dismiss</button>
        </div>
      )}

      {page === 'overview' && renderOverview()}
      {page === 'users' && renderUsers()}
      {page === 'guides' && renderGuides()}
      {page === 'managers' && renderManagers()}
      {page === 'trips' && renderTrips()}
      {page === 'conversions' && renderConversions()}
      {page === 'active' && renderActive()}
      {page === 'payments' && renderPayments()}
      {page === 'settlements' && renderSettlements()}
      {page === 'revenue' && renderRevenue()}
      {page === 'analytics' && renderAnalytics()}
      {page === 'reviews' && renderReviews()}
      {page === 'audit' && renderAudit()}

      {/* Trip detail drawer — full lifecycle */}
      <Drawer open={!!detailTrip} onClose={() => setDetailTrip(null)} title="Trip lifecycle" wide>
        {detailTrip && (
          <>
            <div className="rounded-2xl bg-slate-900 text-white p-5">
              <p className="text-[10px] font-bold uppercase text-slate-400">{detailTrip.traveller}</p>
              <p className="text-lg font-black mt-0.5">{detailTrip.source} → {detailTrip.destination}</p>
              <p className="text-[11px] font-semibold text-slate-400 mt-0.5">{fmtDateTime(detailTrip.start_datetime)} – {fmtDateTime(detailTrip.end_datetime)}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ModePill mode={detailTrip.mode} />
                <StatusPill status={detailTrip.status} />
                <StatusPill status={detailTrip.payment_status} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                <p className="text-[10px] font-bold uppercase text-slate-400">Budget</p>
                <p className="text-base font-black text-slate-900">{inr(detailTrip.budget)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                <p className="text-[10px] font-bold uppercase text-slate-400">Planned cost</p>
                <p className="text-base font-black text-slate-900">{inr(detailTrip.total_cost)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                <p className="text-[10px] font-bold uppercase text-slate-400">Guide</p>
                <p className="text-sm font-extrabold text-indigo-700">{detailTrip.guide_name || 'Not assigned'}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                <p className="text-[10px] font-bold uppercase text-slate-400">Trip ID</p>
                <p className="text-sm font-mono text-slate-500 break-all">{detailTrip.trip_id}</p>
              </div>
            </div>
          </>
        )}
      </Drawer>
    </PortalShell>
  );
};