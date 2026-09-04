import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeftRight, Calendar, MapPin, Search, AlertCircle, Clock, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LocationItem } from '../../types';
import { api } from '../../services/api';

interface TripSearchBarProps {
  onSearch: (data: {
    source: LocationItem;
    destination: LocationItem;
    startDate: string;
    endDate: string;
  }) => void;
  isLoading?: boolean;
}

export const TripSearchBar: React.FC<TripSearchBarProps> = ({ onSearch, isLoading = false }) => {
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [sourceQuery, setSourceQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState<LocationItem | null>(null);
  const [selectedDest, setSelectedDest] = useState<LocationItem | null>(null);

  // Today + 3 days as default realistic departure
  const now = new Date();
  const defaultStart = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const defaultEnd = new Date(defaultStart.getTime() + 3 * 24 * 60 * 60 * 1000);

  const formatDateForInput = (d: Date) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  };

  const [startDateTime, setStartDateTime] = useState<string>(formatDateForInput(defaultStart));
  const [endDateTime, setEndDateTime] = useState<string>(formatDateForInput(defaultEnd));

  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showDestDropdown, setShowDestDropdown] = useState(false);
  const [swapRotation, setSwapRotation] = useState(0);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);

  const sourceRef = useRef<HTMLDivElement>(null);
  const destRef = useRef<HTMLDivElement>(null);

  // Effective search text: once a city is picked, its “Name, State” display value is
  // not treated as a typed query — reopening the dropdown shows all verified hubs.
  const effectiveSourceQuery =
    selectedSource && sourceQuery === `${selectedSource.name}, ${selectedSource.state}`
      ? ''
      : sourceQuery.trim();
  const effectiveDestQuery =
    selectedDest && destQuery === `${selectedDest.name}, ${selectedDest.state}`
      ? ''
      : destQuery.trim();

  const matchLocation = (l: LocationItem, q: string) =>
    !q || l.name.toLowerCase().includes(q.toLowerCase()) || l.state.toLowerCase().includes(q.toLowerCase()) || l.country.toLowerCase().includes(q.toLowerCase());

  const sourceResults = effectiveSourceQuery ? locations.filter(l => matchLocation(l, effectiveSourceQuery)) : locations;
  const destResults = effectiveDestQuery ? locations.filter(l => matchLocation(l, effectiveDestQuery)) : locations;

  // Fetch initial locations
  useEffect(() => {
    api.getLocations().then((locs) => {
      setLocations(locs);
      if (locs.length >= 2) {
        const blr = locs.find(l => l.name.toLowerCase().includes('bangalore')) || locs[0];
        const ooty = locs.find(l => l.name.toLowerCase().includes('ooty')) || locs[1];
        setSelectedSource(blr);
        setSourceQuery(`${blr.name}, ${blr.state}`);
        setSelectedDest(ooty);
        setDestQuery(`${ooty.name}, ${ooty.state}`);
      }
    }).catch(console.error);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sourceRef.current && !sourceRef.current.contains(e.target as Node)) {
        setShowSourceDropdown(false);
      }
      if (destRef.current && !destRef.current.contains(e.target as Node)) {
        setShowDestDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSwap = () => {
    setSwapRotation(prev => prev + 180);
    const tempLoc = selectedSource;
    const tempQuery = sourceQuery;
    setSelectedSource(selectedDest);
    setSourceQuery(destQuery);
    setSelectedDest(tempLoc);
    setDestQuery(tempQuery);
    setErrorMessage(null);
  };

  // Duration hint calculation
  const getDurationHint = () => {
    if (!startDateTime || !endDateTime) return null;
    const start = new Date(startDateTime);
    const end = new Date(endDateTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null;

    const diffMs = end.getTime() - start.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const nights = Math.max(1, diffDays - 1);

    const startStr = start.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    const endStr = end.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

    return `${startStr} — ${endStr} · ${diffDays} days · ${nights} nights`;
  };

  const handleValidateAndSearch = () => {
    setErrorMessage(null);
    setErrorField(null);

    if (!selectedSource) {
      setErrorMessage("Please select your departure city.");
      setErrorField("source");
      return;
    }

    if (!selectedDest) {
      setErrorMessage("Please select your destination city.");
      setErrorField("destination");
      return;
    }

    if (selectedSource.id === selectedDest.id) {
      setErrorMessage("Your destination is the same as your source.");
      setErrorField("destination");
      return;
    }

    const startDate = new Date(startDateTime);
    const endDate = new Date(endDateTime);
    const currentNow = new Date();

    if (startDate < new Date(currentNow.getTime() - 5 * 60 * 1000)) {
      setErrorMessage("Please choose a future travel date and time.");
      setErrorField("start");
      return;
    }

    if (endDate <= startDate) {
      setErrorMessage("Your return date must be after your departure date.");
      setErrorField("end");
      return;
    }

    onSearch({
      source: selectedSource,
      destination: selectedDest,
      startDate: startDateTime,
      endDate: endDateTime
    });
  };

  // Min date string for picker (current time)
  const minDateTimeStr = formatDateForInput(new Date());

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Outer Sky-Blue Container */}
      <div className="p-3 md:p-4 rounded-3xl bg-travion-600/90 backdrop-blur-md shadow-floating border border-travion-400/30">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 items-center bg-white rounded-2xl p-2.5 shadow-sm">
          
          {/* 1. Source Location */}
          <div ref={sourceRef} className="relative md:col-span-3">
            <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all ${errorField === 'source' ? 'border-red-400 bg-red-50/40' : 'border-slate-200 hover:border-travion-300 focus-within:border-travion-500 focus-within:ring-2 focus-within:ring-travion-100'}`}>
              <MapPin className="w-5 h-5 text-travion-500 shrink-0" />
              <div className="w-full">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Departure</label>
                <input
                  type="text"
                  value={sourceQuery}
                  onChange={(e) => {
                    setSourceQuery(e.target.value);
                    setShowSourceDropdown(true);
                  }}
                  onFocus={() => setShowSourceDropdown(true)}
                  placeholder="e.g. Bangalore"
                  className="w-full font-semibold text-slate-800 text-sm focus:outline-none bg-transparent placeholder:text-slate-300"
                />
              </div>
            </div>

            {/* Source Autocomplete Dropdown */}
            <AnimatePresence>
              {showSourceDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-soft-lg border border-slate-100 py-2 z-50 max-h-60 overflow-y-auto"
                >
                  <div className="px-4 pt-2 pb-1.5 flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
                    <span>Verified Destination Hubs</span>
                    <span className="bg-travion-50 text-travion-600 px-1.5 py-0.5 rounded-md">{sourceResults.length}</span>
                  </div>

                  {sourceResults.length === 0 ? (
                    <div className="px-4 py-7 text-center">
                      <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2.5">
                        <MapPin className="w-4.5 h-4.5" />
                      </div>
                      <p className="text-xs font-bold text-slate-600">No verified hub for “{effectiveSourceQuery}” yet</p>
                      <p className="text-[10px] text-slate-400 font-medium mt-1 leading-relaxed max-w-[220px] mx-auto">
                        Travion grounds plans in verified routes — try a listed hub instead.
                      </p>
                    </div>
                  ) : (
                    sourceResults.map(loc => (
                      <button
                        key={loc.id}
                        type="button"
                        onClick={() => {
                          setSelectedSource(loc);
                          setSourceQuery(`${loc.name}, ${loc.state}`);
                          setShowSourceDropdown(false);
                          setErrorMessage(null);
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-travion-50 flex items-center justify-between text-sm transition-colors"
                      >
                        <div>
                          <div className="font-semibold text-slate-800">{loc.name}</div>
                          <div className="text-xs text-slate-400">{loc.state}, {loc.country}</div>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-travion-100 text-travion-700 shrink-0">Hub</span>
                      </button>
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Swap Button */}
          <div className="flex justify-center md:col-span-1">
            <motion.button
              type="button"
              animate={{ rotate: swapRotation }}
              transition={{ duration: 0.35, ease: "easeInOut" }}
              onClick={handleSwap}
              className="p-2.5 rounded-full bg-travion-50 text-travion-600 hover:bg-travion-500 hover:text-white border border-travion-200 transition-all shadow-sm focus:outline-none"
              title="Swap source and destination"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </motion.button>
          </div>

          {/* 2. Destination Location */}
          <div ref={destRef} className="relative md:col-span-3">
            <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all ${errorField === 'destination' ? 'border-red-400 bg-red-50/40' : 'border-slate-200 hover:border-travion-300 focus-within:border-travion-500 focus-within:ring-2 focus-within:ring-travion-100'}`}>
              <MapPin className="w-5 h-5 text-red-500 shrink-0" />
              <div className="w-full">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Destination</label>
                <input
                  type="text"
                  value={destQuery}
                  onChange={(e) => {
                    setDestQuery(e.target.value);
                    setShowDestDropdown(true);
                  }}
                  onFocus={() => setShowDestDropdown(true)}
                  placeholder="e.g. Ooty"
                  className="w-full font-semibold text-slate-800 text-sm focus:outline-none bg-transparent placeholder:text-slate-300"
                />
              </div>
            </div>

            {/* Destination Autocomplete Dropdown */}
            <AnimatePresence>
              {showDestDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-soft-lg border border-slate-100 py-2 z-50 max-h-60 overflow-y-auto"
                >
                  <div className="px-4 pt-2 pb-1.5 flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
                    <span>Verified Destination Hubs</span>
                    <span className="bg-travion-50 text-travion-600 px-1.5 py-0.5 rounded-md">{destResults.length}</span>
                  </div>

                  {destResults.length === 0 ? (
                    <div className="px-4 py-7 text-center">
                      <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2.5">
                        <MapPin className="w-4.5 h-4.5" />
                      </div>
                      <p className="text-xs font-bold text-slate-600">No verified hub for “{effectiveDestQuery}” yet</p>
                      <p className="text-[10px] text-slate-400 font-medium mt-1 leading-relaxed max-w-[220px] mx-auto">
                        Travion grounds plans in verified routes — try a listed hub instead.
                      </p>
                    </div>
                  ) : (
                    destResults.map(loc => (
                      <button
                        key={loc.id}
                        type="button"
                        onClick={() => {
                          setSelectedDest(loc);
                          setDestQuery(`${loc.name}, ${loc.state}`);
                          setShowDestDropdown(false);
                          setErrorMessage(null);
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-travion-50 flex items-center justify-between text-sm transition-colors"
                      >
                        <div>
                          <div className="font-semibold text-slate-800">{loc.name}</div>
                          <div className="text-xs text-slate-400">{loc.state}, {loc.country}</div>
                        </div>
                        <span className="text-[10px] font-medium text-slate-400 shrink-0">{loc.popular_season}</span>
                      </button>
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 3. Start Datetime */}
          <div className="md:col-span-2">
            <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${errorField === 'start' ? 'border-red-400 bg-red-50/40' : 'border-slate-200 hover:border-travion-300 focus-within:border-travion-500 focus-within:ring-2 focus-within:ring-travion-100'}`}>
              <Calendar className="w-4 h-4 text-travion-500 shrink-0" />
              <div className="w-full overflow-hidden">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Start Date</label>
                <input
                  type="datetime-local"
                  min={minDateTimeStr}
                  value={startDateTime}
                  onChange={(e) => setStartDateTime(e.target.value)}
                  className="w-full text-xs font-semibold text-slate-700 focus:outline-none bg-transparent"
                />
              </div>
            </div>
          </div>

          {/* 4. End Datetime */}
          <div className="md:col-span-2">
            <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${errorField === 'end' ? 'border-red-400 bg-red-50/40' : 'border-slate-200 hover:border-travion-300 focus-within:border-travion-500 focus-within:ring-2 focus-within:ring-travion-100'}`}>
              <Calendar className="w-4 h-4 text-travion-500 shrink-0" />
              <div className="w-full overflow-hidden">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">End Date</label>
                <input
                  type="datetime-local"
                  min={startDateTime || minDateTimeStr}
                  value={endDateTime}
                  onChange={(e) => setEndDateTime(e.target.value)}
                  className="w-full text-xs font-semibold text-slate-700 focus:outline-none bg-transparent"
                />
              </div>
            </div>
          </div>

          {/* 5. Search Action Button */}
          <div className="md:col-span-1 flex items-center justify-center">
            <button
              type="button"
              disabled={isLoading}
              onClick={handleValidateAndSearch}
              className="w-full h-[46px] rounded-xl bg-travion-600 hover:bg-travion-700 text-white font-bold text-sm shadow-md hover:shadow-soft flex items-center justify-center gap-1.5 transition-all disabled:opacity-60"
            >
              {isLoading ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                  />
                  <span className="hidden lg:inline text-xs">Planning…</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-yellow-300" />
                  <span className="hidden lg:inline">Search</span>
                </>
              )}
            </button>
          </div>

        </div>
      </div>

      {/* Duration Hint or Inline Validation Error */}
      <div className="mt-2.5 px-4 min-h-[24px] flex items-center justify-between text-xs">
        {errorMessage ? (
          <motion.div
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-1.5 text-red-600 font-semibold"
          >
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{errorMessage}</span>
          </motion.div>
        ) : (
          <div className="text-slate-500 font-medium flex items-center gap-2">
            <span>{getDurationHint() || "Select departure & destination cities to plan your trip"}</span>
          </div>
        )}

        <div className="hidden sm:flex items-center gap-2 text-slate-400 text-[11px]">
          <Sparkles className="w-3 h-3 text-travion-400" />
          <span>Plans grounded in verified schedules & fares</span>
        </div>
      </div>
    </div>
  );
};
