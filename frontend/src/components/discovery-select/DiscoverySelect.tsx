import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BadgeCheck, MapPin, Star, BedDouble, Utensils, Mountain, Compass, ArrowRight, Landmark } from 'lucide-react';
import { DestinationCatalog, CatalogPlace, CatalogFood } from '../../types';
import { api } from '../../services/api';

interface DiscoverySelectProps {
  tripId: string;
  destinationName: string;
  onConfirm: (selectedPlaces: string[], selectedFood: string[]) => void;
  onBack: () => void;
  busy?: boolean;
}

/**
 * Destination Discovery — "Explore <destination>".
 * Shows ONLY real verified places (each carries verified: true from the
 * backend). The user's selections become hard preferences for the planner.
 * This screen comes BEFORE plan generation, per the product flow.
 */
export const DiscoverySelect: React.FC<DiscoverySelectProps> = ({
  tripId, destinationName, onConfirm, onBack, busy,
}) => {
  const [catalog, setCatalog] = useState<DestinationCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedFood, setSelectedFood] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getDestinationCatalog(tripId)
      .then((cat) => { if (alive) setCatalog(cat); })
      .catch(() => { if (alive) setLoadError('Could not load verified places for this destination.'); });
    return () => { alive = false; };
  }, [tripId]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name); else next.add(name);
    setter(next);
  };

  const totalSelected = selected.size + selectedFood.size;

  const visible = catalog ? (showAll ? catalog.must_visit : catalog.must_visit.slice(0, 6)) : [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 3 · Destination discovery</span>
        <h2 className="mt-2 text-2xl font-extrabold text-slate-900 tracking-tight">Explore {destinationName}</h2>
        <p className="mt-1.5 text-[13px] font-medium text-slate-500">
          What do you want to experience? Every place below is real and verified — your selections become must-visits for your plans.
        </p>
      </div>

      {loadError && (
        <div className="max-w-md mx-auto rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] font-bold text-red-600 text-center">
          {loadError}
        </div>
      )}

      {!catalog && !loadError && (
        <div className="py-16 text-center">
          <p className="text-[13px] font-bold text-slate-500">Discovering real places around {destinationName}…</p>
          <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl mx-auto">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-4 rounded-2xl border border-slate-200 bg-white animate-pulse">
                <div className="h-3.5 w-2/3 rounded bg-slate-200" />
                <div className="mt-2 h-2.5 w-full rounded bg-slate-100" />
                <div className="mt-1.5 h-2.5 w-4/5 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      )}

      {catalog && (
        <>
          {/* Data source — honest badge about where these places come from */}
          <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-500">
              <BadgeCheck className="w-3.5 h-3.5 text-emerald-600" />
              All places verified, no invented entries
            </span>
            {catalog.discovery_source && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-500">
                <MapPin className="w-3.5 h-3.5 text-travion-600" />
                Source: {catalog.discovery_source.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {/* Must visit */}
          <div className="mb-8">
            <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-500 mb-3">
              <Mountain className="w-4 h-4 text-travion-600" /> Must visit
              <span className="text-slate-300">·</span>
              <span className="text-[11px] font-bold text-emerald-600 normal-case">✓ verified real places</span>
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {visible.map((place: CatalogPlace) => {
                const active = selected.has(place.name);
                return (
                  <motion.button
                    key={place.name}
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    onClick={() => toggle(selected, setSelected, place.name)}
                    className={`text-left p-4 rounded-2xl border transition-all ${
                      active
                        ? 'bg-travion-50 border-travion-400 ring-2 ring-travion-100'
                        : 'bg-white border-slate-200 hover:border-travion-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-extrabold text-slate-900 leading-snug">{place.name}</p>
                        {place.description && (
                          <p className="mt-1 text-[11px] font-medium text-slate-500 line-clamp-2">{place.description}</p>
                        )}
                        <div className="mt-2 flex items-center gap-2 text-[10.5px] font-bold text-slate-400">
                          {(place.entry_fee ?? 0) > 0 ? <span>₹{place.entry_fee} entry</span> : <span className="text-emerald-600">Free</span>}
                          {place.rating != null && <span>· ★ {Number(place.rating).toFixed(1)}</span>}
                          {place.distance_km != null && <span className="text-travion-600">· {place.distance_km} km away</span>}
                          <span className="inline-flex items-center gap-0.5 text-emerald-600"><BadgeCheck className="w-3 h-3" /> Verified</span>
                        </div>
                        {place.address && (
                          <p className="mt-1.5 text-[10.5px] font-medium text-slate-400 truncate" title={place.address}>📍 {place.address}</p>
                        )}
                      </div>
                      <span className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
                        active ? 'bg-travion-600 border-travion-600' : 'border-slate-300 bg-white'
                      }`}>
                        {active && (
                          <svg viewBox="0 0 12 12" className="w-3 h-3 text-white"><path fill="currentColor" d="M4.6 8.4L2.3 6.1l.9-.9 1.4 1.4 3.2-3.2.9.9z" /></svg>
                        )}
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
            {catalog.must_visit.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAll((s) => !s)}
                className="mt-3 text-[12px] font-extrabold text-travion-700 hover:text-travion-800"
              >
                {showAll ? 'Show fewer' : `Show all ${catalog.must_visit.length} verified places`}
              </button>
            )}
          </div>

          {/* Food — hidden entirely when the source has none (never invented) */}
          {catalog.food.length > 0 && (
          <div className="mb-8">
            <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-500 mb-3">
              <Utensils className="w-4 h-4 text-travion-600" /> Where to eat
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {catalog.food.map((food: CatalogFood) => {
                const active = selectedFood.has(food.name);
                return (
                  <button
                    key={food.name}
                    type="button"
                    onClick={() => toggle(selectedFood, setSelectedFood, food.name)}
                    className={`text-left p-4 rounded-2xl border transition-all ${
                      active
                        ? 'bg-orange-50 border-orange-300 ring-2 ring-orange-100'
                        : 'bg-white border-slate-200 hover:border-orange-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-extrabold text-slate-900 leading-snug">{food.name}</p>
                        <p className="mt-0.5 text-[11px] font-medium text-slate-500 truncate">{food.cuisine}</p>
                        <div className="mt-2 flex items-center gap-2 text-[10.5px] font-bold text-slate-400">
                          <span>₹{food.avg_cost_for_two} for two</span>
                          {food.rating != null && <span>· ★ {Number(food.rating).toFixed(1)}</span>}
                          <span className="inline-flex items-center gap-0.5 text-emerald-600"><BadgeCheck className="w-3 h-3" /> Verified</span>
                        </div>
                      </div>
                      <span className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
                        active ? 'bg-orange-500 border-orange-500' : 'border-slate-300 bg-white'
                      }`}>
                        {active && (
                          <svg viewBox="0 0 12 12" className="w-3 h-3 text-white"><path fill="currentColor" d="M4.6 8.4L2.3 6.1l.9-.9 1.4 1.4 3.2-3.2.9.9z" /></svg>
                        )}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {/* Activities — real things to do (hidden entirely when none verified) */}
          {catalog.activities.length > 0 && (
          <div className="mb-8">
            <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-500 mb-3">
              <Compass className="w-4 h-4 text-travion-600" /> Activities
              <span className="text-slate-300">·</span>
              <span className="text-[11px] font-bold text-emerald-600 normal-case">✓ verified real experiences</span>
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {catalog.activities.map((place: CatalogPlace) => {
                const active = selected.has(place.name);
                return (
                  <button
                    key={`act_${place.name}`}
                    type="button"
                    onClick={() => toggle(selected, setSelected, place.name)}
                    className={`text-left p-4 rounded-2xl border transition-all ${
                      active
                        ? 'bg-travion-50 border-travion-400 ring-2 ring-travion-100'
                        : 'bg-white border-slate-200 hover:border-travion-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-extrabold text-slate-900 leading-snug">{place.name}</p>
                        {place.description && (
                          <p className="mt-1 text-[11px] font-medium text-slate-500 line-clamp-2">{place.description}</p>
                        )}
                        <div className="mt-2 flex items-center gap-2 text-[10.5px] font-bold text-slate-400">
                          {place.duration_minutes != null && <span>~{place.duration_minutes} min</span>}
                          {place.distance_km != null && <span className="text-travion-600">· {place.distance_km} km away</span>}
                          <span className="inline-flex items-center gap-0.5 text-emerald-600"><BadgeCheck className="w-3 h-3" /> Verified</span>
                        </div>
                      </div>
                      <span className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
                        active ? 'bg-travion-600 border-travion-600' : 'border-slate-300 bg-white'
                      }`}>
                        {active && (
                          <svg viewBox="0 0 12 12" className="w-3 h-3 text-white"><path fill="currentColor" d="M4.6 8.4L2.3 6.1l.9-.9 1.4 1.4 3.2-3.2.9.9z" /></svg>
                        )}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {/* Stays preview (informational — plans pick the tier) */}
          {catalog.stays.length > 0 && (
          <div className="mb-8">
            <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-500 mb-3">
              <BedDouble className="w-4 h-4 text-travion-600" /> Verified stays
            </h3>
            <div className="grid sm:grid-cols-3 gap-3">
              {catalog.stays.map((stay) => (
                <div key={stay.name} className="p-4 rounded-2xl border border-slate-200 bg-white">
                  {stay.tier && <p className="text-[10px] font-black uppercase tracking-wide text-travion-700">{stay.tier}</p>}
                  <p className="text-[13px] font-extrabold text-slate-900 leading-snug mt-0.5">{stay.name}</p>
                  <div className="mt-2 flex items-center gap-2 text-[10.5px] font-bold text-slate-400">
                    {stay.price_per_night ? <span>₹{stay.price_per_night.toLocaleString('en-IN')}/night</span> : <span>Price not available</span>}
                    {stay.rating != null && <span>· ★ {Number(stay.rating).toFixed(1)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Sticky action bar */}
          <div className="sticky bottom-4 z-10">
            <div className="flex items-center justify-between gap-3 rounded-3xl bg-white border border-slate-200 shadow-floating px-5 py-4">
              <button type="button" onClick={onBack} className="text-[13px] font-bold text-slate-500 hover:text-slate-700">
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onConfirm(Array.from(selected), Array.from(selectedFood))}
                className="inline-flex items-center gap-2 h-12 px-7 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-extrabold transition-colors"
              >
                {busy ? 'Generating your plans…' : totalSelected > 0 ? `Generate 3 plans with ${totalSelected} picks` : 'Generate 3 plans'}
                {!busy && <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
