import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { BadgeCheck, MapPin, BedDouble, Utensils, Mountain, Compass, ArrowRight, Landmark, ShieldAlert, Info } from 'lucide-react';
import { DestinationCatalog, CatalogPlace, CatalogFood, CatalogStay, SelectedPlaceItem, SelectedFoodItem, SelectedStay } from '../../types';
import { api } from '../../services/api';

interface DiscoverySelectProps {
  tripId: string;
  destinationName: string;
  onConfirm: (
    selectedPlaces: string[],
    selectedFood: string[],
    placeItems: SelectedPlaceItem[],
    foodItems: SelectedFoodItem[],
    selectedStay: SelectedStay | null,
  ) => void;
  onBack: () => void;
  busy?: boolean;
}

const insideFirst = <T extends { placement?: string | null; distance_km?: number | null }>(list: T[]): T[] =>
  [...list].sort((a, b) => {
    const aIn = (a.placement ?? 'inside') === 'inside' ? 0 : 1;
    const bIn = (b.placement ?? 'inside') === 'inside' ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    return (a.distance_km ?? 0) - (b.distance_km ?? 0);
  });

const placementLabel = (p?: string | null, dist?: number | null) =>
  p === 'inside' || dist == null || dist === 0 ? 'Inside destination' : 'Nearby';

function toPlaceItem(place: CatalogPlace): SelectedPlaceItem {
  return {
    id: place.id ?? null,
    name: place.name,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
    distance_km: place.distance_km ?? null,
    placement: place.placement ?? 'inside',
    entry_fee: place.entry_fee ?? null,
    duration_minutes: place.duration_minutes ?? null,
    rating: place.rating ?? null,
    source: place.source,
  };
}

function toFoodItem(food: CatalogFood): SelectedFoodItem {
  return {
    id: food.id ?? null,
    name: food.name,
    latitude: food.latitude ?? null,
    longitude: food.longitude ?? null,
    distance_km: food.distance_km ?? null,
    avg_cost_for_two: food.avg_cost_for_two ?? null,
    cuisine: food.cuisine ?? null,
    must_try: food.must_try ?? null,
    rating: food.rating ?? null,
    source: food.source,
  };
}

/**
 * Destination Discovery — "Choose what you want to experience".
 * Shows ONLY real verified places (each carries verified: true from the backend).
 * Places INSIDE the destination core are shown first; stays are a single-select
 * choice ('Continue without a stay' skips accommodation); the budget tier is the
 * honest advisor strip on top. Selections become hard preferences for the planner.
 */
export const DiscoverySelect: React.FC<DiscoverySelectProps> = ({
  tripId, destinationName, onConfirm, onBack, busy,
}) => {
  const [catalog, setCatalog] = useState<DestinationCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedFood, setSelectedFood] = useState<Set<string>>(new Set());
  const [selectedStay, setSelectedStay] = useState<SelectedStay | null>(null);
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
  const places = useMemo(() => insideFirst(catalog?.must_visit ?? []), [catalog]);
  const activities = useMemo(() => insideFirst(catalog?.activities ?? []), [catalog]);

  const visiblePlaces = showAll ? places : places.slice(0, 6);

  const hasNothing = catalog
    && places.length === 0
    && activities.length === 0
    && (catalog.food?.length ?? 0) === 0
    && (catalog.stays?.length ?? 0) === 0;
  const budgetTier = catalog?.budget?.tier;
  const budgetPanel = catalog?.budget;

  const selectedEntryFees = useMemo(() => {
    const all = (catalog?.must_visit ?? []).concat(catalog?.activities ?? []);
    return Array.from(selected)
      .map((name) => all.find((p) => p.name === name))
      .reduce((sum, p) => sum + (p ? (p.entry_fee ?? 0) : 0), 0);
  }, [catalog, selected]);

  const handleConfirm = () => {
    const allItems = (catalog?.must_visit ?? []).concat(catalog?.activities ?? []);
    const itemBySelection = (name: string) => {
      const hit = allItems.find((p) => p.name === name);
      return hit ? toPlaceItem(hit) : { name, source: 'selected' };
    };
    const placeItems = Array.from(selected).map(itemBySelection);
    const foodItems = Array.from(selectedFood).map((name) => {
      const hit = (catalog?.food ?? []).find((f) => f.name === name);
      return hit ? toFoodItem(hit) : { name, source: 'selected' };
    });
    onConfirm(Array.from(selected), Array.from(selectedFood), placeItems, foodItems, selectedStay);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 3 · Destination discovery</span>
        <h2 className="mt-2 text-2xl font-extrabold text-slate-900 tracking-tight">Choose what you want to experience</h2>
        <p className="mt-1.5 text-[13px] font-medium text-slate-500">
          All places here are real and verified — your picks are locked into your plans, never replaced.
        </p>
      </div>

      {loadError && (
        <div className="max-w-md mx-auto rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] font-bold text-red-600 text-center">
          {loadError}
        </div>
      )}

      {/* Budget Feasibility advisor — the honest strip */}
      {catalog && budgetPanel && budgetTier && (
        <div className={`mb-7 rounded-2xl border px-4 py-3.5 flex items-start gap-3 ${
          budgetTier.impossible
            ? 'bg-red-50 border-red-200'
            : budgetPanel.budget_status === 'restricted'
              ? 'bg-amber-50 border-amber-200'
              : 'bg-emerald-50 border-emerald-200'
        }`}>
          {budgetTier.impossible ? (
            <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          ) : budgetPanel.budget_status === 'restricted' ? (
            <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          ) : (
            <BadgeCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <p className={`text-[13px] font-extrabold ${budgetTier.impossible ? 'text-red-700' : budgetPanel.budget_status === 'restricted' ? 'text-amber-700' : 'text-emerald-700'}`}>
              {budgetTier.label}
            </p>
            <p className={`text-[12px] font-medium mt-0.5 ${budgetTier.impossible ? 'text-red-600' : budgetPanel.budget_status === 'restricted' ? 'text-amber-700' : 'text-emerald-700'}`}>
              {budgetPanel.message || budgetTier.summary}
            </p>
          </div>
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
            {catalog.core_radius_km != null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-500">
                <Landmark className="w-3.5 h-3.5 text-travion-600" />
                Search radius: {catalog.core_radius_km} km
              </span>
            )}
          </div>

          {/* Must visit — honest empty state when the 3 km core has no verified place */}
          <div className="mb-8">
            <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-500 mb-3">
              <Mountain className="w-4 h-4 text-travion-600" /> Must visit
              <span className="text-slate-300">·</span>
              <span className="text-[11px] font-bold text-emerald-600 normal-case">✓ verified real places</span>
            </h3>
            {places.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center">
                <p className="text-[13px] font-bold text-slate-600">
                  No verified places found within {catalog.core_radius_km ?? 3} km of {catalog.destination} right now.
                </p>
                <p className="mt-1 text-[12px] font-medium text-slate-400">
                  We only show real, verified places — we never invent attractions. Check back later or try a nearby destination.
                </p>
              </div>
            ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visiblePlaces.map((place: CatalogPlace) => {
                  const active = selected.has(place.name);
                  return (
                    <motion.button
                      key={`${place.id ?? place.name}_${place.category}`}
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
                            <span className="text-travion-600">{placementLabel(place.placement, place.distance_km)}</span>
                            {(place.entry_fee ?? 0) > 0 ? <span>· ₹{place.entry_fee} entry</span> : <span className="text-emerald-600">· Free</span>}
                            {place.rating != null && <span>· ★ {Number(place.rating).toFixed(1)}</span>}
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
                    </motion.button>
                  );
                })}
              </div>
              {places.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAll((s) => !s)}
                  className="mt-3 text-[12px] font-extrabold text-travion-700 hover:text-travion-800"
                >
                  {showAll ? 'Show fewer' : `Show all ${places.length} verified places`}
                </button>
              )}
            </>
            )}
          </div>

          {/* Activities — real things to do (hidden entirely when none verified) */}
          {activities.length > 0 && (
          <div className="mb-8">
            <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-500 mb-3">
              <Compass className="w-4 h-4 text-travion-600" /> Activities
              <span className="text-slate-300">·</span>
              <span className="text-[11px] font-bold text-emerald-600 normal-case">✓ verified real experiences</span>
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {activities.map((place: CatalogPlace) => {
                const active = selected.has(place.name);
                return (
                  <button
                    key={`act_${place.id ?? place.name}`}
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
                          <span className="text-travion-600">{placementLabel(place.placement, place.distance_km)}</span>
                          {place.duration_minutes != null && <span>· ~{place.duration_minutes} min</span>}
                          {place.rating != null && <span>· ★ {Number(place.rating).toFixed(1)}</span>}
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
                    key={food.id ?? food.name}
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
                          {food.avg_cost_for_two != null && <span>₹{food.avg_cost_for_two} for two</span>}
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

          {/* Stays — single-select radio. The chosen stay is used EVERY night of the trip. */}
          {catalog.stays.length > 0 && (
          <div className="mb-8">
            <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-500 mb-3">
              <BedDouble className="w-4 h-4 text-travion-600" /> Pick your stay
              <span className="text-slate-300">·</span>
              <span className="text-[11px] font-bold text-slate-400 normal-case">use one stay for the whole trip</span>
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setSelectedStay(null)}
                className={`text-left p-4 rounded-2xl border transition-all ${
                  selectedStay === null
                    ? 'bg-slate-50 border-slate-400 ring-2 ring-slate-100'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <p className="text-[13.5px] font-extrabold text-slate-900">Continue without a stay</p>
                <p className="mt-1 text-[11px] font-medium text-slate-500">Plans will be day-trip style — great for low budgets.</p>
                <span className={`mt-2 inline-flex w-4 h-4 rounded-full border items-center justify-center ${
                  selectedStay === null ? 'bg-slate-700 border-slate-700' : 'border-slate-300'
                }`}>
                  {selectedStay === null && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                </span>
              </button>
              {insideFirst(catalog.stays as (CatalogStay & { placement?: string | null })[]).map((stay: CatalogStay) => {
                const active = selectedStay?.name === stay.name;
                return (
                  <button
                    key={stay.id ?? stay.name}
                    type="button"
                    onClick={() => setSelectedStay({
                      id: stay.id ?? null,
                      name: stay.name,
                      latitude: stay.latitude ?? null,
                      longitude: stay.longitude ?? null,
                      distance_km: stay.distance_km ?? null,
                      budget_category: stay.budget_category ?? null,
                      price_per_night: stay.price_per_night ?? null,
                    })}
                    className={`text-left p-4 rounded-2xl border transition-all ${
                      active
                        ? 'bg-indigo-50 border-indigo-400 ring-2 ring-indigo-100'
                        : 'bg-white border-slate-200 hover:border-indigo-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {stay.tier && <p className="text-[10px] font-black uppercase tracking-wide text-travion-700">{stay.tier}</p>}
                        <p className="text-[13.5px] font-extrabold text-slate-900 leading-snug mt-0.5">{stay.name}</p>
                        <div className="mt-2 flex items-center gap-2 text-[10.5px] font-bold text-slate-400">
                          {stay.price_per_night
                            ? <span>₹{Number(stay.price_per_night).toLocaleString('en-IN')}/night</span>
                            : <span>Price not available</span>}
                          {stay.rating != null && <span>· ★ {Number(stay.rating).toFixed(1)}</span>}
                          {stay.distance_km != null && <span className="text-travion-600">· {stay.distance_km} km</span>}
                        </div>
                        {stay.budget_category && (
                          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                            {stay.budget_category}
                          </span>
                        )}
                      </div>
                      <span className={`mt-0.5 inline-flex w-5 h-5 shrink-0 rounded-full border items-center justify-center ${
                        active ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'
                      }`}>
                        {active && <span className="w-2 h-2 rounded-full bg-white" />}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {/* Over-budget warning — selected entry fees exceed what the budget can hold */}
          {!budgetTier?.impossible && budgetPanel?.maximum_allowed_spend != null && selectedEntryFees > budgetPanel.maximum_allowed_spend && (
            <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[12px] font-bold text-amber-700">
                Selected entry fees add up to ₹{selectedEntryFees.toLocaleString('en-IN')}, more than your budget of ₹{Math.round(budgetPanel.maximum_allowed_spend).toLocaleString('en-IN')}. Drop a few paid places or the plan can't stay within budget.
              </p>
            </div>
          )}

          {/* Sticky action bar */}
          <div className="sticky bottom-4 z-10">
            <div className="flex items-center justify-between gap-3 rounded-3xl bg-white border border-slate-200 shadow-floating px-5 py-4">
              <button type="button" onClick={onBack} className="text-[13px] font-bold text-slate-500 hover:text-slate-700">
                Back
              </button>
              {!hasNothing && (
                <button
                  type="button"
                  disabled={busy || !!budgetTier?.impossible}
                  onClick={handleConfirm}
                  className="inline-flex items-center gap-2 h-12 px-7 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-extrabold transition-colors"
                >
                  {budgetTier?.impossible ? 'Budget too low for plans'
                    : busy ? 'Generating your plans…' : totalSelected > 0
                      ? `Generate 3 plans with ${totalSelected} ${totalSelected === 1 ? 'pick' : 'picks'}${selectedStay ? ' & stay' : ''}`
                      : selectedStay
                        ? 'Generate 3 plans with stay'
                        : 'Generate 3 plans'}
                  {!busy && !budgetTier?.impossible && <ArrowRight className="w-4 h-4" />}
                </button>
              )}
              {hasNothing && (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-2 h-12 px-7 rounded-2xl bg-slate-200 text-slate-400 text-sm font-extrabold cursor-not-allowed"
                >
                  No verified places to add yet
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};