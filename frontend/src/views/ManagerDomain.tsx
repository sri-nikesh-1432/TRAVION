import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard, ClipboardList, Workflow, Activity, Users, BadgeCheck,
  Wallet, CreditCard, TrendingUp, Star, MapPin, Calendar, UserCheck,
  GripVertical, CheckCircle2, ArrowDownToLine, Eye,
} from 'lucide-react';
import { AuthSession, GuideCandidate } from '../types';
import { api } from '../services/api';
import { PortalShell, PortalNavItem } from '../components/portal/PortalShell';
import {
  KpiCard, StatusPill, ModePill, EmptyState, SectionCard, SearchBox, IconBtn,
  BarChart, LineChart, DonutChart, ResponsiveTable, Drawer, ConfirmDialog, Funnel,
  inr, shortId, fmtDate, fmtDateTime, filterRows,
} from '../components/portal/ui';

interface ManagerDomainProps {
  session: AuthSession;
  onLogout: () => void;
}

type PageKey = 'overview' | 'requests' | 'conversions' | 'active' | 'guides' | 'verification' | 'settlements' | 'payments' | 'revenue' | 'reviews';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#0ea5e9', '#ec4899', '#8b5cf6', '#14b8a6'];

export const ManagerDomain: React.FC<ManagerDomainProps> = ({ session, onLogout }) => {
  const [page, setPage] = useState<PageKey>('overview');

  // Overview data
  const [stats, setStats] = useState<any>(null);
  const [pendingGuides, setPendingGuides] = useState<any[]>([]);
  const [tripRequests, setTripRequests] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);

  // Dedicated pages
  const [guides, setGuides] = useState<any[]>([]);
  const [activeTrips, setActiveTrips] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [revenue, setRevenue] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);

  // Conversion workspace
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<GuideCandidate[]>([]);
  const [dragTripId, setDragTripId] = useState<string | null>(null);
  const [dragOverGuideId, setDragOverGuideId] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [confirmAssign, setConfirmAssign] = useState(false);
  const [confirmSettle, setConfirmSettle] = useState<string | null>(null);
  const [tripDrawerId, setTripDrawerId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [queries, setQueries] = useState<Record<string, string>>({});
  const qFor = (p: string) => queries[p] || '';
  const setQFor = (p: string) => (v: string) => setQueries((prev) => ({ ...prev, [p]: v }));

  const NAV: PortalNavItem[] = [
    { key: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { key: 'requests', label: 'Trip Requests', icon: <ClipboardList className="w-4 h-4" />, badge: tripRequests.length || undefined },
    { key: 'conversions', label: 'Conversions', icon: <Workflow className="w-4 h-4" /> },
    { key: 'active', label: 'Active Trips', icon: <Activity className="w-4 h-4" />, badge: activeTrips.length || undefined },
    { key: 'guides', label: 'Guides', icon: <Users className="w-4 h-4" /> },
    { key: 'verification', label: 'Guide Verification', icon: <BadgeCheck className="w-4 h-4" />, badge: pendingGuides.length || undefined },
    { key: 'settlements', label: 'Settlements', icon: <Wallet className="w-4 h-4" /> },
    { key: 'payments', label: 'Payments', icon: <CreditCard className="w-4 h-4" /> },
    { key: 'revenue', label: 'Revenue', icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'reviews', label: 'Reviews', icon: <Star className="w-4 h-4" /> },
  ];

  const fetchOverview = useCallback(async () => {
    try {
      const [s, g, reqs, stl] = await Promise.all([
        api.getManagerStats(), api.getPendingGuides(), api.getTripRequests(), api.getSettlements(),
      ]);
      setStats(s); setPendingGuides(g); setTripRequests(reqs); setSettlements(stl);
    } catch (err) { console.error('manager overview fetch failed:', err); }
  }, []);

  const fetchPage = useCallback(async (p: PageKey) => {
    setNotice(null);
    if (p === 'guides') { try { setGuides(await api.getManagerGuides()); } catch { } }
    if (p === 'active') { try { setActiveTrips(await api.getManagerActiveTrips()); } catch { } }
    if (p === 'payments') { try { setPayments(await api.getManagerPayments()); } catch { } }
    if (p === 'revenue') { try { setRevenue(await api.getManagerRevenue()); } catch { } }
    if (p === 'reviews') { try { setReviews(await api.getManagerReviews()); } catch { } }
    if (p === 'requests' || p === 'conversions' || p === 'overview') {
      try { const reqs = await api.getTripRequests(); setTripRequests(reqs); } catch { }
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNavigate = (key: string) => {
    setPage(key as PageKey);
    fetchPage(key as PageKey);
  };

  const fetchCandidates = useCallback(async (tripId: string) => {
    setDetailLoading(true);
    try {
      const cands = await api.getRankedCandidates(tripId);
      setCandidates(cands);
      setSelectedGuideId(null);
    } catch (err) {
      console.error('Fetch candidates failed:', err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleSelectTrip = (tripId: string) => {
    setSelectedTripId(tripId);
    setSelectedGuideId(null);
    fetchCandidates(tripId);
  };

  const handleAssign = async (tripId: string, guideId: string) => {
    setIsAssigning(true);
    try {
      await api.assignGuide(tripId, guideId);
      setConfirmAssign(false);
      setPage('active');
      setNotice('Assignment confirmed. Guide is now BUSY; traveller and guide have been notified.');
      await Promise.all([fetchOverview(), fetchPage('active')]);
      if (candidates.some((c) => c.guide_id === guideId)) setSelectedGuideId(null);
    } catch (err: any) {
      setNotice(`Assignment failed: ${err?.error || err?.message || 'unknown error'}`);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleSettle = async (splitId: string) => {
    try {
      await api.settlePayout(splitId);
      setConfirmSettle(null);
      setNotice('Guide fee settlement marked as complete and audit-logged.');
      fetchOverview();
      try { setSettlements(await api.getSettlements()); } catch { }
      try { setRevenue(await api.getManagerRevenue()); } catch { }
    } catch (err) {
      setNotice('Settlement action failed.');
      console.error(err);
    }
  };

  const handleApproveGuide = async (guideId: string, action: 'APPROVE' | 'REJECT') => {
    try {
      await api.decideGuideApproval(guideId, action);
      setNotice(action === 'APPROVE' ? 'Guide verified and activated.' : 'Guide application rejected.');
      fetchOverview();
      try { setGuides(await api.getManagerGuides()); } catch { }
    } catch (err) {
      console.error('Guide decision failed:', err);
    }
  };

  const tripById = (id: string) => tripRequests.find((r) => r.trip_id === id) || null;
  const tripDrawer = tripById(tripDrawerId || '');
  const selectedTrip = tripById(selectedTripId || '');

  /* ───────────────────────── PAGES ───────────────────────── */
  const renderOverview = () => (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Trips" value={stats?.today_trips ?? 0} />
        <KpiCard label="Pending Requests" value={stats?.pending_requests ?? 0} tone="amber" />
        <KpiCard label="Active Guides" value={stats?.active_guides ?? 0} tone="emerald" />
        <KpiCard label="Busy Guides" value={stats?.busy_guides ?? 0} tone="indigo" />
        <KpiCard label="Duty Off" value={stats?.duty_off_guides ?? 0} />
        <KpiCard label="Completed Trips" value={stats?.completed_trips ?? 0} tone="sky" />
        <KpiCard label="Pending Verifications" value={stats?.pending_guide_approvals ?? 0} tone="rose" />
        <KpiCard label="Pending Settlements" value={settlements.filter((s) => s.settlement_status !== 'SETTLED').length ?? 0} tone="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SectionCard title="Guide availability" subtitle="Live database state">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
              <p className="text-2xl font-black text-emerald-700">{stats?.active_guides ?? 0}</p>
              <p className="text-[11px] font-bold text-emerald-600">ACTIVE</p>
            </div>
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100">
              <p className="text-2xl font-black text-amber-700">{stats?.busy_guides ?? 0}</p>
              <p className="text-[11px] font-bold text-amber-600">BUSY</p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-100 border border-slate-200">
              <p className="text-2xl font-black text-slate-600">{stats?.duty_off_guides ?? 0}</p>
              <p className="text-[11px] font-bold text-slate-500">DUTY OFF</p>
            </div>
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-100">
              <p className="text-2xl font-black text-rose-600">{stats?.pending_guide_approvals ?? 0}</p>
              <p className="text-[11px] font-bold text-rose-500">WAITING</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Operational alerts" subtitle="Derived from real records">
          <div className="space-y-2.5">
            {stats?.pending_guide_approvals > 0 && (
              <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-amber-50 border border-amber-100 text-[11.5px] font-bold text-amber-800">
                <BadgeCheck className="w-4 h-4" /> Guide verification pending ({stats.pending_guide_approvals})
              </div>
            )}
            {stats?.pending_requests > 0 && (
              <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-indigo-50 border border-indigo-100 text-[11.5px] font-bold text-indigo-800">
                <Workflow className="w-4 h-4" /> Trip requests waiting for assignment ({stats.pending_requests})
              </div>
            )}
            {settlements.some((s) => s.settlement_status !== 'SETTLED') && (
              <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-amber-50 border border-amber-100 text-[11.5px] font-bold text-amber-800">
                <Wallet className="w-4 h-4" /> Settlement pending for {settlements.filter((s) => s.settlement_status !== 'SETTLED').length} paid trip(s)
              </div>
            )}
            {settlements.length === 0 && stats?.pending_requests === 0 && stats?.pending_guide_approvals === 0 && (
              <EmptyState title="All clear" hint="No open operational items right now." />
            )}
          </div>
        </SectionCard>

        <SectionCard title="Recent trip requests" actions={
          <button onClick={() => onNavigate('requests')} className="text-[11px] font-bold text-indigo-600 hover:underline">View all</button>
        }>
          {tripRequests.length === 0 ? (
            <EmptyState title="No trip requests yet" />
          ) : (
            <div className="space-y-2.5">
              {tripRequests.slice(0, 5).map((r) => (
                <button key={r.trip_id} onClick={() => { setTripDrawerId(r.trip_id); }}
                  className="w-full text-left p-3 rounded-2xl border border-slate-200 hover:border-indigo-300 transition-all">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-slate-900">{r.traveller?.name}</span>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-500">
                    <MapPin className="w-3 h-3 text-indigo-500" /> {r.source} → {r.destination}
                    <span className="text-slate-300">·</span>
                    <Calendar className="w-3 h-3 text-indigo-500" /> {fmtDate(r.start_datetime)} – {fmtDate(r.end_datetime)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );

  const renderRequests = () => {
    const q = qFor('requests');
    const filtered = filterRows(tripRequests, ['destination', 'source', 'traveller.name'], q);
    return (
      <SectionCard
        title="Trip Requests" subtitle="All traveller requests awaiting or in the assignment pipeline"
        actions={<SearchBox value={q} onChange={setQFor('requests')} placeholder="Search traveller, destination, source…" />}
      >
        <ResponsiveTable
          rows={filtered}
          empty="No trip requests yet"
          columns={[
            { key: 'traveller.name', label: 'Traveller', render: (r) => <span className="font-extrabold text-slate-900">{r.traveller?.name}</span> },
            { key: 'route', label: 'Route', render: (r) => <span className="text-slate-600">{r.source} → {r.destination}</span> },
            { key: 'start_datetime', label: 'Dates', render: (r) => <span className="text-slate-500 whitespace-nowrap">{fmtDate(r.start_datetime)} – {fmtDate(r.end_datetime)}</span> },
            { key: 'language', label: 'Language', render: (r) => <span className="text-slate-500">{r.traveller?.preferred_language || 'English'}</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'guide', label: 'Guide', render: (r) => r.assigned_guide_name ? <span className="font-bold text-indigo-700">{r.assigned_guide_name}</span> : <span className="text-slate-300">Unassigned</span> },
            { key: 'action', label: '', render: (r) => (
              <div className="flex items-center gap-1.5 justify-end">
                <IconBtn onClick={() => setTripDrawerId(r.trip_id)} title="View trip"><Eye className="w-4 h-4" /></IconBtn>
                <button onClick={() => onNavigate('conversions')} className="px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[10.5px] font-bold hover:bg-indigo-700">Move to Conversion</button>
              </div>
            )},
          ]}
        />
      </SectionCard>
    );
  };

  const selectedCandidate = candidates.find((c) => c.guide_id === selectedGuideId) || null;

  const renderConversions = () => (
    <SectionCard
      title="Conversion Center" subtitle="Select a traveller request, then choose an eligible guide — or drag the trip card onto a guide."
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT — traveller requests */}
        <div className="lg:col-span-4 space-y-2.5">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Traveller Requests</span>
          {tripRequests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-[11px] font-bold text-slate-400 text-center">
              No pending Guide Mode requests.
            </div>
          ) : tripRequests.map((r) => {
            const isSel = selectedTripId === r.trip_id;
            const isDragging = dragTripId === r.trip_id;
            return (
              <div
                key={r.trip_id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/trip-id', r.trip_id); e.dataTransfer.effectAllowed = 'move'; setDragTripId(r.trip_id); }}
                onDragEnd={() => setDragTripId(null)}
                onClick={() => handleSelectTrip(r.trip_id)}
                className={`cursor-grab active:cursor-grabbing p-4 rounded-2xl border transition-all ${
                  isSel ? 'border-indigo-500 bg-indigo-50/60 shadow-sm ring-2 ring-indigo-200' : 'border-slate-200 hover:border-indigo-200 bg-white'
                } ${isDragging ? 'opacity-50 border-dashed' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-black text-slate-900">
                    <GripVertical className="w-3.5 h-3.5 text-slate-300" />
                    {r.traveller?.name}
                  </span>
                  <StatusPill status={r.status} />
                </div>
                <div className="mt-1.5 text-[11px] font-bold text-slate-600 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-indigo-500" /> {r.source} → {r.destination}
                </div>
                <div className="mt-0.5 text-[10.5px] font-semibold text-slate-400">
                  {fmtDate(r.start_datetime)} – {fmtDate(r.end_datetime)} · Guide Mode
                </div>
                {r.traveller?.preferred_language && (
                  <div className="mt-1 text-[10px] font-bold text-slate-400">Language: {r.traveller.preferred_language}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* CENTER — assignment workspace */}
        <div className="lg:col-span-4 flex flex-col">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Assignment Workspace</span>
          <div className="flex-1 rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/60 p-5 space-y-4 min-h-[280px]">
            <div className="rounded-2xl bg-white border border-slate-200 p-4">
              <p className="text-[10px] font-bold uppercase text-slate-400">Traveller</p>
              {selectedTrip ? (
                <>
                  <p className="text-sm font-extrabold text-slate-900 mt-0.5">{selectedTrip.traveller?.name}</p>
                  <p className="text-[11px] font-bold text-slate-500">{selectedTrip.source} → {selectedTrip.destination}</p>
                  <p className="text-[11px] font-semibold text-slate-400">{fmtDate(selectedTrip.start_datetime)} – {fmtDate(selectedTrip.end_datetime)}</p>
                </>
              ) : <p className="text-[11px] font-bold text-slate-300 mt-1">Select a request from the left</p>}
            </div>
            <div className="flex items-center justify-center">
              <ArrowDownToLine className="w-5 h-5 text-slate-300" />
            </div>
            <div className="rounded-2xl bg-white border border-slate-200 p-4">
              <p className="text-[10px] font-bold uppercase text-slate-400">Selected Guide</p>
              {selectedCandidate ? (
                <>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-sm font-extrabold text-slate-900">{selectedCandidate.name}</p>
                    <StatusPill status={selectedCandidate.status} />
                  </div>
                  <p className="text-[11px] font-bold text-slate-500">{selectedCandidate.experience_years} yrs · {selectedCandidate.languages.join(', ')}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">Match {selectedCandidate.match_score}% · Dest {selectedCandidate.match_breakdown.destination_compatibility}% · Lang {selectedCandidate.match_breakdown.language_compatibility}%</p>
                </>
              ) : <p className="text-[11px] font-bold text-slate-300 mt-1">Choose a guide from the right</p>}
            </div>
            <button
              disabled={!selectedTrip || !selectedCandidate || isAssigning}
              onClick={() => setConfirmAssign(true)}
              className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-extrabold shadow-sm transition-all"
            >
              {isAssigning ? 'Assigning…' : 'Assign Guide'}
            </button>
            {notice && <p className="text-[11px] font-bold text-rose-600 leading-relaxed">{notice}</p>}
          </div>
        </div>

        {/* RIGHT — eligible guides */}
        <div className="lg:col-span-4 space-y-2.5">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
            Eligible Guides {selectedTripId ? `for ${selectedTrip?.destination}` : ''}
          </span>
          {detailLoading ? (
            <div className="space-y-2.5">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />)}</div>
          ) : candidates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-[11px] font-bold text-slate-400 text-center">
              {selectedTripId ? 'No approved guides match this trip yet.' : 'Select a trip to see eligible guides.'}
            </div>
          ) : candidates.map((cand) => {
            const isSel = selectedGuideId === cand.guide_id;
            const dragActive = dragOverGuideId === cand.guide_id && cand.status === 'ACTIVE';
            return (
              <div
                key={cand.guide_id}
                draggable={false}
                onDragOver={(e) => { if (cand.status !== 'ACTIVE') return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverGuideId(cand.guide_id); }}
                onDragLeave={() => setDragOverGuideId((p) => (p === cand.guide_id ? null : p))}
                onDrop={(e) => {
                  e.preventDefault(); setDragOverGuideId(null);
                  if (cand.status !== 'ACTIVE') return;
                  const tid = e.dataTransfer.getData('text/trip-id');
                  if (tid) handleAssign(tid, cand.guide_id);
                }}
                onClick={() => cand.status === 'ACTIVE' && setSelectedGuideId(cand.guide_id)}
                className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                  dragActive ? 'border-indigo-500 ring-2 ring-indigo-200 bg-indigo-50/60'
                  : isSel ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-100'
                  : cand.status === 'ACTIVE' ? 'border-slate-200 bg-white hover:border-indigo-200'
                  : 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-extrabold text-slate-900">{cand.name}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cand.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-500'}`}>
                    {cand.status}
                  </span>
                </div>
                <p className="text-[10.5px] font-semibold text-slate-500 flex items-center gap-1 flex-wrap">
                  {cand.experience_years} yrs exp · {cand.languages.join(', ')} · <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {cand.rating} ({cand.review_count})
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] font-black text-indigo-600">{cand.match_score}% match</span>
                  {cand.status === 'ACTIVE' ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedGuideId(cand.guide_id); }}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${isSel ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600 border border-indigo-200'}`}
                    >
                      {isSel ? 'Selected' : 'Select'}
                    </button>
                  ) : <span className="text-[10px] font-bold text-slate-400">Not available</span>}
                </div>
                <div className="mt-2 space-y-1">
                  {(['destination_compatibility', 'language_compatibility', 'availability', 'experience', 'rating'] as const).map((k) => {
                    const mb = cand.match_breakdown as Record<string, number>;
                    return (
                      <div key={k} className="flex items-center gap-2">
                        <span className="w-20 text-[9px] font-bold text-slate-400 uppercase">{k.replace('_compatibility', '')}</span>
                        <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${mb[k] || 0}%` }} />
                        </div>
                        <span className="text-[9px] font-bold text-slate-500 tabular-nums">{mb[k] || 0}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );

  const renderActive = () => {
    const q = qFor('active');
    const filtered = filterRows(activeTrips, ['traveller', 'destination', 'mode', 'status', 'guide_name'], q);
    return (
      <SectionCard title="Active Trips" subtitle="Live operations — every running trip and the guide on it."
        actions={<SearchBox value={q} onChange={setQFor('active')} placeholder="Search traveller, destination…" />}>
        <ResponsiveTable
          rows={filtered}
          empty="No active trips right now"
          columns={[
            { key: 'traveller', label: 'Traveller', render: (r) => <span className="font-extrabold text-slate-900">{r.traveller}</span> },
            { key: 'route', label: 'Route', render: (r) => <span className="text-slate-600">{r.source} → {r.destination}</span> },
            { key: 'start_datetime', label: 'Trip dates', render: (r) => <span className="text-slate-500 whitespace-nowrap">{fmtDateTime(r.start_datetime)}</span> },
            { key: 'mode', label: 'Mode', render: (r) => <ModePill mode={r.mode} /> },
            { key: 'guide_name', label: 'Guide', render: (r) => r.guide_name ? <span className="font-bold text-indigo-700">{r.guide_name}</span> : <span className="text-slate-300">—</span> },
            { key: 'plan_days', label: 'Plan', render: (r) => <span className="text-slate-500">{r.plan_days} days</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
          ]}
        />
      </SectionCard>
    );
  };

  const renderGuides = () => {
    const q = qFor('guides');
    const filtered = filterRows(guides, ['name', 'status', 'approval_status', 'destinations'], q);
    return (
      <SectionCard title="Guide network" subtitle="All guides with live status, coverage and workload"
        actions={<SearchBox value={q} onChange={setQFor('guides')} placeholder="Search guides…" />}>
        <ResponsiveTable
          rows={filtered}
          empty="No guide records yet"
          columns={[
            { key: 'name', label: 'Guide', render: (r) => <span className="font-extrabold text-slate-900">{r.name}</span> },
            { key: 'destinations', label: 'Coverage', render: (r) => <span className="text-slate-500">{r.destinations?.join(', ') || '—'}</span> },
            { key: 'languages', label: 'Languages', render: (r) => <span className="text-slate-500">{r.languages?.join(', ') || '—'}</span> },
            { key: 'experience_years', label: 'Exp', render: (r) => <span className="text-slate-600">{r.experience_years}y</span> },
            { key: 'rating', label: 'Rating', render: (r) => <span className="font-bold text-amber-600 inline-flex items-center gap-1"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{r.rating} ({r.review_count})</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'approval_status', label: 'Verification', render: (r) => <StatusPill status={r.approval_status} /> },
            { key: 'trip', label: 'Current trip', render: (r) => r.current_trip_id ? <span className="font-mono text-[10px] text-slate-400">{shortId(r.current_trip_id)}</span> : <span className="text-slate-300">—</span> },
          ]}
        />
      </SectionCard>
    );
  };

  const renderVerification = () => (
    <SectionCard title="Guide verification queue" subtitle="Pending onboarding applications with destination knowledge and safety responses">
      {pendingGuides.length === 0 ? (
        <EmptyState title="No pending verifications" hint="Applications that pass validation will appear here." />
      ) : (
        <div className="space-y-4">
          {pendingGuides.map((g) => (
            <div key={g.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-sm text-slate-900">{g.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Destinations: {g.destinations.join(', ')} · Languages: {g.languages.join(', ')} · {g.experience_years} yrs
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => handleApproveGuide(g.id, 'APPROVE')}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs">Verify Guide</button>
                  <button onClick={() => handleApproveGuide(g.id, 'REJECT')}
                    className="px-4 py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs">Reject</button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Destination knowledge</p>
                  <p className="text-[11.5px] font-semibold text-slate-700 leading-relaxed">{g.destination_knowledge}</p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Safety & emergency response</p>
                  <p className="text-[11.5px] font-semibold text-slate-700 leading-relaxed">{g.safety_information}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );

  const renderSettlements = () => (
    <SectionCard title="Guide settlements" subtitle="Guide fees held from successful payments — only the guide portion, never the travel budget">
      <ResponsiveTable
        rows={settlements}
        empty="No payment settlements recorded yet"
        columns={[
          { key: 'trip_id', label: 'Trip', render: (r) => <span className="font-mono text-[10.5px] text-slate-400">{shortId(r.trip_id)}</span> },
          { key: 'guide_name', label: 'Guide', render: (r) => <span className="font-extrabold text-slate-900">{r.guide_name}</span> },
          { key: 'guide_fee', label: 'Guide fee', render: (r) => <span className="font-bold text-emerald-600">{inr(r.guide_fee)}</span> },
          { key: 'platform_fee', label: 'Platform fee', render: (r) => <span className="text-slate-500">{inr(r.platform_fee)}</span> },
          { key: 'total_amount', label: 'Traveller paid', render: (r) => <span className="font-bold text-slate-700">{inr(r.total_amount)}</span> },
          { key: 'settlement_status', label: 'Settlement', render: (r) => <StatusPill status={r.settlement_status} /> },
          { key: 'action', label: '', render: (r) => r.settlement_status !== 'SETTLED' ? (
            <button onClick={() => setConfirmSettle(r.split_id)} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px]">Mark Settled</button>
          ) : <span className="text-[10px] font-bold text-emerald-600">{fmtDate(r.settled_at)}</span> },
        ]}
      />
    </SectionCard>
  );

  const renderPayments = () => {
    const q = qFor('payments');
    const filtered = filterRows(payments, ['traveller', 'destination', 'status', 'guide_name'], q);
    return (
      <SectionCard title="Payment transactions" subtitle="Actual recorded payment transactions and their fee split"
        actions={<SearchBox value={q} onChange={setQFor('payments')} placeholder="Search transactions…" />}>
        <ResponsiveTable
          rows={filtered}
          empty="No payments recorded yet"
          columns={[
            { key: 'payment_id', label: 'Transaction', render: (r) => <span className="font-mono text-[10.5px] text-slate-400">{shortId(r.payment_id)}</span> },
            { key: 'traveller', label: 'Traveller', render: (r) => <span className="font-extrabold text-slate-900">{r.traveller}</span> },
            { key: 'destination', label: 'Trip', render: (r) => <span className="text-slate-600">{r.destination}</span> },
            { key: 'amount', label: 'Amount', render: (r) => <span className="font-bold text-slate-900">{inr(r.amount)}</span> },
            { key: 'guide_fee', label: 'Guide fee', render: (r) => <span className="text-emerald-600 font-bold">{inr(r.guide_fee)}</span> },
            { key: 'platform_fee', label: 'Platform fee', render: (r) => <span className="text-slate-500">{inr(r.platform_fee)}</span> },
            { key: 'guide_name', label: 'Guide', render: (r) => r.guide_name || <span className="text-slate-300">—</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'created_at', label: 'Date', render: (r) => <span className="text-slate-400 whitespace-nowrap">{fmtDateTime(r.created_at)}</span> },
          ]}
        />
      </SectionCard>
    );
  };

  const renderRevenue = () => {
    if (!revenue) return <div className="h-40" />;
    const monthly = revenue.by_month || [];
    const monthLabels = monthly.map((m: any) => m.month);
    const guideSettled = Number(revenue.settled_guide_fees) || 0;
    const pendingSettled = Number(revenue.pending_settlements) || 0;
    const paymentStatuses = Object.entries(revenue.status_counts || {})
      .filter(([k]) => k.startsWith('payment_'))
      .map(([k, v]) => ({ label: k.replace('payment_', ''), value: Number(v), color: k.includes('SUCCESS') ? '#10b981' : k.includes('FAILED') ? '#f43f5e' : '#f59e0b' }));
    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <KpiCard label="Gross traveller payments" value={inr(revenue.gross_traveller_payments)} />
          <KpiCard label="Platform revenue" value={inr(revenue.platform_revenue)} tone="indigo" />
          <KpiCard label="Guide fees" value={inr(revenue.guide_fees)} tone="emerald" />
          <KpiCard label="Settled guide fees" value={inr(guideSettled)} tone="sky" />
          <KpiCard label="Pending settlements" value={inr(pendingSettled)} tone="amber" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Revenue over time" subtitle="Gross, platform and guide fees by month">
            <LineChart
              height={200} money
              series={[
                { label: 'Gross', color: '#94a3b8', data: monthLabels.map((m: string, i: number) => ({ month: m, value: monthly[i].gross })) },
                { label: 'Platform', color: '#6366f1', data: monthLabels.map((m: string, i: number) => ({ month: m, value: monthly[i].platform })) },
                { label: 'Guide', color: '#10b981', data: monthLabels.map((m: string, i: number) => ({ month: m, value: monthly[i].guide })) },
              ]}
            />
          </SectionCard>
          <SectionCard title="Revenue by destination" subtitle="Top destinations from real transactions">
            <BarChart data={(revenue.by_destination || []).slice(0, 8).map((d: any) => ({ label: d.destination, value: d.revenue }))} money />
          </SectionCard>
          <SectionCard title="Guide vs platform fees" subtitle="Comparison from real splits">
            <BarChart
              data={monthly.map((m: any) => ({
                label: m.month.slice(5),
                'Guide fee': m.guide,
                'Platform fee': m.platform,
              }))}
              valueKey="Guide fee" money
            />
            <div className="mt-3 flex items-center gap-4 text-[10.5px] font-bold text-slate-500">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> Platform fee</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Guide fee</span>
            </div>
          </SectionCard>
          <SectionCard title="Payment status" subtitle="From recorded transactions">
            <DonutChart data={paymentStatuses} />
          </SectionCard>
        </div>
      </>
    );
  };

  const renderReviews = () => {
    const q = qFor('reviews');
    const filtered = filterRows(reviews, ['user_name', 'guide_name', 'comment', 'trip_id'], q);
    return (
      <SectionCard title="Reviews" subtitle="Traveller reviews across assigned trips"
        actions={<SearchBox value={q} onChange={setQFor('reviews')} placeholder="Search reviews…" />}>
        <ResponsiveTable
          rows={filtered}
          empty="No reviews yet"
          columns={[
            { key: 'user_name', label: 'Traveller', render: (r) => <span className="font-extrabold text-slate-900">{r.user_name}</span> },
            { key: 'guide_name', label: 'Guide', render: (r) => <span className="font-bold text-indigo-700">{r.guide_name}</span> },
            { key: 'rating', label: 'Rating', render: (r) => (
              <span className="inline-flex items-center gap-0.5 text-amber-400">
                {Array.from({ length: Math.min(r.rating, 5) }).map((_, i) => <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />)}
              </span>
            ) },
            { key: 'comment', label: 'Comment', render: (r) => <span className="text-slate-500 line-clamp-2 max-w-[280px]">{r.comment || '—'}</span> },
            { key: 'created_at', label: 'Date', render: (r) => <span className="text-slate-400 whitespace-nowrap">{fmtDate(r.created_at)}</span> },
          ]}
        />
      </SectionCard>
    );
  };

  const tripDetailDrawer = (trip: any) => ({
    traveller: trip.traveller?.name || '—',
    route: `${trip.source} → ${trip.destination}`,
    dates: `${fmtDateTime(trip.start_datetime)} – ${fmtDateTime(trip.end_datetime)}`,
    language: trip.traveller?.preferred_language || 'English',
    status: trip.status,
    guide: trip.assigned_guide_name || null,
    match: trip.match_score,
  });

  return (
    <PortalShell
      title="TRAVION OPERATIONS"
      subtitle="Manager Portal"
      nav={NAV}
      active={page}
      onNavigate={onNavigate}
      sessionEmail={session.email}
      onLogout={onLogout}
      theme="manager"
    >
      {notice && (
        <div className="mb-5 px-4 py-3 rounded-2xl bg-indigo-50 border border-indigo-200 text-[12px] font-bold text-indigo-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {notice}
          <button onClick={() => setNotice(null)} className="ml-auto text-indigo-400 hover:text-indigo-700">Dismiss</button>
        </div>
      )}

      {page === 'overview' && renderOverview()}
      {page === 'requests' && renderRequests()}
      {page === 'conversions' && renderConversions()}
      {page === 'active' && renderActive()}
      {page === 'guides' && renderGuides()}
      {page === 'verification' && renderVerification()}
      {page === 'settlements' && renderSettlements()}
      {page === 'payments' && renderPayments()}
      {page === 'revenue' && renderRevenue()}
      {page === 'reviews' && renderReviews()}

      {/* Trip request detail drawer */}
      <Drawer open={!!tripDrawer} onClose={() => setTripDrawerId(null)} title="Trip detail">
        {tripDrawer && (() => {
          const d = tripDetailDrawer(tripDrawer);
          return (
            <>
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                <p className="text-[10px] font-bold uppercase text-slate-400">{d.traveller}</p>
                <p className="text-base font-black text-slate-900 mt-0.5">{d.route}</p>
                <p className="text-[12px] font-bold text-slate-500 mt-0.5">{d.dates}</p>
                <div className="mt-2 flex items-center gap-2">
                  <ModePill mode="GUIDE_MODE" />
                  <StatusPill status={d.status} />
                  <span className="text-[10.5px] font-bold text-slate-500">Language: {d.language}</span>
                </div>
              </div>
              <div className="rounded-2xl bg-white border border-slate-200 p-4">
                <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">Assignment state</p>
                {d.guide ? (
                  <p className="text-[12.5px] font-extrabold text-indigo-700">Assigned guide: {d.guide} {d.match ? `· match ${d.match}%` : ''}</p>
                ) : (
                  <p className="text-[12.5px] font-bold text-slate-500">Unassigned</p>
                )}
              </div>
              {!d.guide && (
                <button onClick={() => { setTripDrawerId(null); onNavigate('conversions'); }}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-extrabold hover:bg-indigo-700">
                  Move to Conversion
                </button>
              )}
            </>
          );
        })()}
      </Drawer>

      {/* Assignment confirmation */}
      <ConfirmDialog
        open={confirmAssign}
        onCancel={() => setConfirmAssign(false)}
        onConfirm={() => selectedTripId && selectedGuideId && handleAssign(selectedTripId, selectedGuideId)}
        title="Confirm assignment?"
        body={selectedTrip && selectedCandidate ? (
          <ul className="space-y-1">
            <li>Traveller: <b>{selectedTrip.traveller?.name}</b></li>
            <li>Guide: <b>{selectedCandidate.name}</b> ({selectedCandidate.match_score}% match)</li>
            <li>Destination: <b>{selectedTrip.destination}</b></li>
            <li>Dates: <b>{fmtDate(selectedTrip.start_datetime)} – {fmtDate(selectedTrip.end_datetime)}</b></li>
          </ul>
        ) : null}
        confirmLabel="Confirm Assignment"
      />

      {/* Settlement confirmation */}
      <ConfirmDialog
        open={!!confirmSettle}
        onCancel={() => setConfirmSettle(null)}
        onConfirm={() => confirmSettle && handleSettle(confirmSettle)}
        title="Mark guide settlement complete?"
        body="The guide fee will be marked settled and the action will be written to the audit log."
        confirmLabel="Mark Settled"
      />
    </PortalShell>
  );
};