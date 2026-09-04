import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Compass, Users, Clock, CheckCircle2, XCircle, Award,
  Sparkles, DollarSign, LogOut, Check, ChevronRight, UserCheck,
  Star, GripVertical, ArrowDownToLine
} from 'lucide-react';
import { AuthSession, GuideCandidate } from '../types';
import { api } from '../services/api';

interface ManagerDomainProps {
  session: AuthSession;
  onLogout: () => void;
}

export const ManagerDomain: React.FC<ManagerDomainProps> = ({ session, onLogout }) => {
  const [stats, setStats] = useState<any>(null);
  const [pendingGuides, setPendingGuides] = useState<any[]>([]);
  const [tripRequests, setTripRequests] = useState<any[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<GuideCandidate[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [isAssigning, setIsAssigning] = useState(false);
  const [dragTripId, setDragTripId] = useState<string | null>(null);
  const [dragOverGuideId, setDragOverGuideId] = useState<string | null>(null);

  const fetchManagerData = async () => {
    try {
      const s = await api.getManagerStats();
      setStats(s);
      const g = await api.getPendingGuides();
      setPendingGuides(g);
      const reqs = await api.getTripRequests();
      setTripRequests(reqs);
      if (reqs.length > 0 && !selectedTripId) {
        setSelectedTripId(reqs[0].trip_id);
        fetchCandidates(reqs[0].trip_id);
      }
      const stl = await api.getSettlements();
      setSettlements(stl);
    } catch (err) {
      console.error("Manager data fetch failed:", err);
    }
  };

  const fetchCandidates = async (tripId: string) => {
    try {
      const cands = await api.getRankedCandidates(tripId);
      setCandidates(cands);
    } catch (err) {
      console.error("Fetch candidates failed:", err);
    }
  };

  useEffect(() => {
    fetchManagerData();
  }, []);

  const handleApproveGuide = async (guideId: string, action: 'APPROVE' | 'REJECT') => {
    try {
      await api.decideGuideApproval(guideId, action);
      fetchManagerData();
    } catch (err) {
      console.error("Guide decision failed:", err);
    }
  };

  const handleAssign = async (tripId: string, guideId: string) => {
    setIsAssigning(true);
    try {
      await api.assignGuide(tripId, guideId);
      setDragTripId(null);
      setDragOverGuideId(null);
      alert("Guide assigned successfully. The guide is now BUSY and the traveller has been notified.");
      fetchManagerData();
    } catch (err: any) {
      alert(err.message || "Assignment failed");
    } finally {
      setIsAssigning(false);
    }
  };

  const handleSettle = async (splitId: string) => {
    try {
      await api.settlePayout(splitId);
      fetchManagerData();
    } catch (err) {
      console.error("Settlement failed:", err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="text-base font-black text-slate-900 tracking-tight">TRAVION OPERATIONS</span>
            <span className="text-[10px] font-bold text-indigo-600 block leading-none">Manager Portal</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-600">
            {session.email}
          </span>
          <button
            onClick={onLogout}
            className="p-2 text-slate-400 hover:text-red-600 rounded-xl hover:bg-red-50 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl w-full mx-auto px-4 md:px-6 py-8 space-y-8">
        
        {/* KPI Cards Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Total Trips</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{stats?.today_trips || 0}</div>
          </div>
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Pending Requests</span>
            <div className="text-2xl font-black text-indigo-600 mt-1">{stats?.pending_requests || 0}</div>
          </div>
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Active Guides</span>
            <div className="text-2xl font-black text-emerald-600 mt-1">{stats?.active_guides || 0}</div>
          </div>
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <span className="text-[10px] font-bold uppercase text-slate-400">Busy / Assigned</span>
            <div className="text-2xl font-black text-amber-600 mt-1">{stats?.busy_guides || 0}</div>
          </div>
        </div>

        {/* Section 1: Pending Guide Applications */}
        {pendingGuides.length > 0 && (
          <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-soft">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                <span>Pending Guide Onboarding Applications ({pendingGuides.length})</span>
              </h3>
            </div>

            <div className="space-y-3">
              {pendingGuides.map(g => (
                <div key={g.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-sm text-slate-900">{g.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Destinations: {g.destinations.join(', ')} · Experience: {g.experience_years} years · Languages: {g.languages.join(', ')}
                    </div>
                    {g.destination_knowledge && (
                      <div className="text-xs text-slate-600 mt-2 bg-white p-2.5 rounded-xl border border-slate-200">
                        <span className="font-bold">Knowledge:</span> {g.destination_knowledge}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleApproveGuide(g.id, 'APPROVE')}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm"
                    >
                      Approve & Activate
                    </button>
                    <button
                      onClick={() => handleApproveGuide(g.id, 'REJECT')}
                      className="px-4 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 font-bold text-xs"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 2: Guide Matching & Assignment Pipeline */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-soft">
          <div className="mb-5">
            <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Award className="w-5 h-5 text-indigo-600" />
              <span>Trip Request & Guide Matching Queue</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Select a trip to inspect AI-ranked candidate guides scored by destination compatibility, language fluency, availability, experience, and workload penalty.
            </p>
          </div>

          {tripRequests.length === 0 ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-400">
              No pending Guide Mode requests awaiting match.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Trip Requests List */}
              <div className="lg:col-span-4 space-y-2.5">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Select Trip</span>
                {tripRequests.map(req => {
                  const isSelected = selectedTripId === req.trip_id;
                  const isDragging = dragTripId === req.trip_id;
                  return (
                    <div
                      key={req.trip_id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/trip-id', req.trip_id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragTripId(req.trip_id);
                      }}
                      onDragEnd={() => setDragTripId(null)}
                      onClick={() => {
                        setSelectedTripId(req.trip_id);
                        fetchCandidates(req.trip_id);
                      }}
                      className={`cursor-grab active:cursor-grabbing p-4 rounded-2xl border transition-all ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50/50 shadow-sm ring-2 ring-indigo-200'
                          : 'border-slate-200 hover:border-indigo-200 bg-white'
                      } ${isDragging ? 'opacity-50 border-dashed' : ''}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="flex items-center gap-1.5 text-xs font-black text-slate-900">
                          <GripVertical className="w-3.5 h-3.5 text-slate-300" />
                          <span>{req.destination} Expedition</span>
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          req.status === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {req.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">Traveller: {req.traveller.name} ({req.traveller.preferred_language})</div>
                      {req.assigned_guide_name && (
                        <div className="text-xs font-bold text-indigo-700 mt-1">Assigned: {req.assigned_guide_name}</div>
                      )}
                      {!req.assigned_guide_name && (
                        <div className="text-[10px] font-bold text-indigo-400 mt-1.5">Drag this trip onto an eligible guide to assign</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Ranked Candidates Panel (Document 07 Prompt #13) */}
              <div className="lg:col-span-8">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
                  Ranked Candidates for Trip
                </span>

                {candidates.length === 0 ? (
                  <div className="p-8 text-center text-xs font-semibold text-slate-400 rounded-2xl bg-slate-50 border border-slate-200">
                    No approved guides found matching criteria.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {dragTripId && (
                      <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-indigo-50 border border-dashed border-indigo-300 text-[11px] font-bold text-indigo-700">
                        <ArrowDownToLine className="w-3.5 h-3.5" />
                        <span>Drop the trip onto an eligible guide below to confirm the assignment</span>
                      </div>
                    )}
                    {candidates.map(cand => (
                      <div
                        key={cand.guide_id}
                        onDragOver={(e) => {
                          if (cand.status !== 'ACTIVE') return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDragOverGuideId(cand.guide_id);
                        }}
                        onDragLeave={() => setDragOverGuideId((prev) => prev === cand.guide_id ? null : prev)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverGuideId(null);
                          if (cand.status !== 'ACTIVE') return;
                          const tripId = e.dataTransfer.getData('text/trip-id');
                          if (tripId) handleAssign(tripId, cand.guide_id);
                        }}
                        className={`p-4 rounded-2xl bg-white border transition-all ${
                          dragOverGuideId === cand.guide_id && cand.status === 'ACTIVE'
                            ? 'border-indigo-500 ring-2 ring-indigo-200 bg-indigo-50/60'
                            : 'border-slate-200 hover:border-indigo-200'
                        } shadow-sm`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-600 font-bold flex items-center justify-center">
                              {cand.name.charAt(0)}
                            </div>
                            <div>
                              <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
                                <span>{cand.name}</span>
                                <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">
                                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                                  <span>{cand.rating}</span>
                                </span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  cand.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                                }`}>
                                  {cand.status}
                                </span>
                              </div>
                              <div className="text-xs text-slate-500">
                                {cand.experience_years} years exp · Languages: {cand.languages.join(', ')}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">Match Score</span>
                              <span className="text-lg font-black text-indigo-600">{cand.match_score}%</span>
                            </div>
                            <button
                              type="button"
                              disabled={isAssigning || cand.status !== 'ACTIVE'}
                              onClick={() => selectedTripId && handleAssign(selectedTripId, cand.guide_id)}
                              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Assign Guide
                            </button>
                          </div>
                        </div>

                        {/* Match Score Breakdown Progress Bars */}
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-100 text-[10px] text-slate-500 font-semibold">
                          <div>
                            <div className="flex justify-between mb-1">
                              <span>Destination</span>
                              <span>{cand.match_breakdown.destination_compatibility}%</span>
                            </div>
                            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${cand.match_breakdown.destination_compatibility}%` }} />
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between mb-1">
                              <span>Language</span>
                              <span>{cand.match_breakdown.language_compatibility}%</span>
                            </div>
                            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${cand.match_breakdown.language_compatibility}%` }} />
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between mb-1">
                              <span>Availability</span>
                              <span>{cand.match_breakdown.availability}%</span>
                            </div>
                            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${cand.match_breakdown.availability}%` }} />
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between mb-1">
                              <span>Experience</span>
                              <span>{cand.match_breakdown.experience}%</span>
                            </div>
                            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${cand.match_breakdown.experience}%` }} />
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between mb-1">
                              <span>Rating</span>
                              <span>{cand.match_breakdown.rating}%</span>
                            </div>
                            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${cand.match_breakdown.rating}%` }} />
                            </div>
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>
                )}

              </div>

            </div>
          )}
        </div>

        {/* Section 3: Settlements Tracker */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-soft">
          <h3 className="text-base font-extrabold text-slate-900 mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <span>Operational Settlements (Guide Fee vs Platform Fee Splits)</span>
          </h3>

          {settlements.length === 0 ? (
            <div className="p-6 text-center text-xs font-semibold text-slate-400">
              No payment transactions ready for settlement yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase">
                    <th className="pb-3">Trip ID</th>
                    <th className="pb-3">Guide Name</th>
                    <th className="pb-3">Guide Fee</th>
                    <th className="pb-3">Platform Fee</th>
                    <th className="pb-3">Total Paid</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {settlements.map(s => (
                    <tr key={s.split_id}>
                      <td className="py-3 font-mono text-[11px]">{s.trip_id?.slice(0, 8)}…</td>
                      <td className="py-3 font-bold text-slate-900">{s.guide_name}</td>
                      <td className="py-3 font-bold text-emerald-600">₹{s.guide_fee}</td>
                      <td className="py-3 text-slate-500">₹{s.platform_fee}</td>
                      <td className="py-3 font-bold">₹{s.total_amount}</td>
                      <td className="py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          s.settlement_status === 'SETTLED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {s.settlement_status}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        {s.settlement_status !== 'SETTLED' && (
                          <button
                            onClick={() => handleSettle(s.split_id)}
                            className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px]"
                          >
                            Mark Settled
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </main>
    </div>
  );
};
