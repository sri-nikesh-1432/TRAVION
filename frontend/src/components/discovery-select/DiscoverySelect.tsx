import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BadgeCheck, MapPin, BedDouble, Utensils, Mountain, Compass, ArrowRight, Landmark, ShieldAlert, Info, CalendarDays, ExternalLink, X, Clock, ClipboardList, Camera } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { DestinationCatalog, CatalogPlace, CatalogFood, CatalogStay, CatalogActivity, SelectedPlaceItem, SelectedFoodItem, SelectedStay, MapPlacesPayload, MapPlace, TripEventItem, GeoViewportPlace } from '../../types';
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
    stayRequired: boolean,
  ) => void;
  onBack: () => void;
  busy?: boolean;
}


const COLORS: Record<string, string> = {
  must_visit: '#10b981',
  activities: '#0ea5e9',
  food: '#f59e0b',
  stays: '#8b5cf6',
  shopping: '#ec4899',
  healthcare: '#ef4444',
  education: '#3b82f6',
  transport: '#64748b',
  other: '#f97316',
};

const MAP_KEY_ORDER = ['must_visit', 'activities', 'food', 'stays', 'shopping', 'healthcare', 'education', 'transport', 'other'];

// Map layer titles (label + which recommendation bucket a click maps into).
const MAP_LAYERS: Record<string, { label: string; kind: 'place' | 'food' | 'stay' }> = {
  must_visit: { label: 'Must Visit', kind: 'place' },
  activities: { label: 'Activities', kind: 'place' },
  food: { label: 'Restaurants · Cafés', kind: 'food' },
  stays: { label: 'Stays · Hotels', kind: 'stay' },
  shopping: { label: 'Shopping', kind: 'place' },
  healthcare: { label: 'Healthcare', kind: 'place' },
  education: { label: 'Education', kind: 'place' },
  transport: { label: 'Transport', kind: 'place' },
  other: { label: 'Other', kind: 'place' },
};

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

const insideFirst = <T extends { placement?: string | null; distance_km?: number | null }>(list: T[]): T[] =>
  [...list].sort((a, b) => {
    const aIn = (a.placement ?? 'inside') === 'inside' ? 0 : 1;
    const bIn = (b.placement ?? 'inside') === 'inside' ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    return (a.distance_km ?? 0) - (b.distance_km ?? 0);
  });

function toPlaceItemFromMap(p: MapPlace): SelectedPlaceItem {
  return {
    id: p.id ?? null,
    name: p.name,
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    distance_km: p.distance_km ?? null,
    placement: p.placement ?? 'inside',
    entry_fee: p.entry_fee ?? null,
    duration_minutes: null,
    rating: p.rating ?? null,
    source: p.source,
  };
}

// Classify a live GeoApify viewport POI into Travion's map buckets from its
// real provider categories — tourist spots, food, stays, worship, shopping,
// healthcare, education, transport (spec §8: every category on the map).
function viewportBucket(vp: GeoViewportPlace): string {
  const cats = vp.categories || [];
  if (cats.some((c) => c.startsWith('accommodation'))) return 'stays';
  if (cats.some((c) => c.startsWith('catering'))) return 'food';
  if (cats.some((c) => c.startsWith('sport'))) return 'activities';
  if (cats.some((c) => c.startsWith('commercial'))) return 'shopping';
  if (cats.some((c) => c.startsWith('healthcare'))) return 'healthcare';
  if (cats.some((c) => c.startsWith('education'))) return 'education';
  if (cats.some((c) => c.startsWith('public_transport'))) return 'transport';
  if (cats.some((c) => c.startsWith('tourism') || c.startsWith('leisure') ||
                     c.startsWith('entertainment') || c.startsWith('religion') ||
                     c.startsWith('natural'))) return 'must_visit';
  return 'other';
}

function vpToMapPlace(vp: GeoViewportPlace): MapPlace {
  return {
    id: vp.place_id,
    provider_place_id: vp.place_id,
    name: vp.name,
    category: viewportBucket(vp),
    address: vp.formatted,
    latitude: vp.lat,
    longitude: vp.lng,
    placement: 'inside',
    source: vp.source || 'geoapify',
    verified: true,
    opening_hours: (vp as unknown as { opening_hours?: string | null }).opening_hours ?? null,
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
  const [mapData, setMapData] = useState<MapPlacesPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedFood, setSelectedFood] = useState<Set<string>>(new Set());
  const [selectedStay, setSelectedStay] = useState<SelectedStay | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [mapFilter, setMapFilter] = useState('all');
  const [autoSelected, setAutoSelected] = useState(false);
  const [events, setEvents] = useState<TripEventItem[]>([]);
  // GeoApify basemap + viewport-based POI loading (spec §8/§30): the map asks
  // the backend /geo proxy for the places actually visible, debounced on
  // pan/zoom, clustered so large POI sets stay smooth.
  const [viewportPlaces, setViewportPlaces] = useState<GeoViewportPlace[]>([]);
  const [vpLoading, setVpLoading] = useState(false);
  // Map pin popup: click a pin → place card with details + Add to Plan
  // (spec §2 — every map place is clickable and adds to the plan from a
  // proper popup, not a silent toggle).
  const [popupPlace, setPopupPlace] = useState<{ key: string; item: MapPlace } | null>(null);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name); else next.add(name);
    setter(next);
  };

  // The map plots the FULL real dataset from map-places: recommended buckets +
  // every broader provider-verified category. Click → add to the visit list.
  const mapPlaces = useMemo(() => {
    const all: Array<{ key: string; item: MapPlace }> = [];
    if (mapData) {
      for (const key of MAP_KEY_ORDER) {
        for (const item of (mapData.map_places as Record<string, MapPlace[]>)[key] ?? []) {
          if (item.latitude && item.longitude) all.push({ key, item });
        }
      }
    } else if (catalog) {
      const push = (key: string, arr: Array<MapPlace | CatalogFood | CatalogStay>) => {
        for (const it of arr) if (it.latitude && it.longitude) all.push({ key, item: it as MapPlace });
      };
      push('must_visit', catalog.must_visit);
      push('activities', catalog.activities);
      push('food', catalog.food);
      push('stays', catalog.stays);
    }
    return all;
  }, [mapData, catalog]);

  // Step 3 interactive map (raw Leaflet — leaflet is the only map dependency).
  const mapDiv = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const hasFitRef = useRef(false);
  const tileUrlRef = useRef<string | null>(null);
  const vpSeq = useRef(0);
  const vpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // The map container only mounts once `catalog` is populated (the discovery
    // section renders conditionally), so the init must retry when it appears —
    // an empty-deps effect would run before the div exists and leave a blank map.
    if (!mapDiv.current || mapRef.current) return;
    const map = L.map(mapDiv.current, {
      center: [20.5937, 78.9629],
      zoom: 10,
      scrollWheelZoom: false,
    });
    // Basemap: render instantly with OSM tiles, then transparently upgrade to
    // the GeoApify basemap once the server-side proxy answers (spec §2: the
    // API key never reaches the browser; spec §31: graceful fallback).
    const osmBase = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    api.getTileUrl()
      .then((t) => {
        tileUrlRef.current = t.url;
        if (mapRef.current) {
          map.removeLayer(osmBase);
          L.tileLayer(t.url, {
            maxZoom: 19,
            attribution: t.attribution || '&copy; OpenStreetMap contributors &copy; GeoApify',
          }).addTo(mapRef.current);
        }
      })
      .catch(() => { /* OSM basemap stays — never a blank map */ });
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    // Marker clustering (spec §30): large POI sets stay smooth and readable.
    const cluster = L.markerClusterGroup({
      maxClusterRadius: 42,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 16,
    });
    clusterRef.current = cluster;
    map.addLayer(cluster);
    // The container may already be displayed when created; invalidate so
    // Leaflet measures the real size instead of 0×0.
    requestAnimationFrame(() => {
      if (mapRef.current) map.invalidateSize();
    });
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      clusterRef.current = null;
      hasFitRef.current = false;
    };
  }, [catalog]);

  // Places/activities/swapping categories → the places set; food → the food
  // set; stays → the single selected stay. Selections flow to the planner.
  const toggleMapItem = useCallback((key: string, item: MapPlace) => {
    const kind = MAP_LAYERS[key]?.kind ?? 'place';
    if (kind === 'food') {
      toggle(selectedFood, setSelectedFood, item.name);
    } else if (kind === 'stay') {
      setSelectedStay({
        id: item.id ?? null, name: item.name,
        latitude: item.latitude ?? null, longitude: item.longitude ?? null,
        distance_km: item.distance_km ?? null, budget_category: null,
        price_per_night: item.price_per_night ?? null,
      });
    } else {
      toggle(selected, setSelected, item.name);
    }
  }, [selected, selectedFood]);

  // The FULL marker set: verified discovery dataset + live GeoApify viewport
  // POIs (viewport-only, so the traveller can browse the whole destination
  // region by panning — spec §8/§30).
  const allMapPlaces = useMemo(() => {
    const byName = new Map<string, MapPlace>();
    const push = (key: string, item: MapPlace) => {
      if (!item.latitude || !item.longitude) return;
      const k = `${(item.name || '').trim().toLowerCase()}@${Number(item.latitude).toFixed(4)},${Number(item.longitude).toFixed(4)}`;
      if (!byName.has(k)) byName.set(k, { ...item, category: key });
    };
    for (const key of MAP_KEY_ORDER) {
      for (const item of (mapData?.map_places as Record<string, MapPlace[]> | undefined)?.[key] ?? []) push(key, item);
    }
    if (!mapData && catalog) {
      for (const it of catalog.must_visit) push('must_visit', it as unknown as MapPlace);
      for (const it of catalog.activities) push('activities', it as unknown as MapPlace);
      for (const it of catalog.food) push('food', it as unknown as MapPlace);
      for (const it of catalog.stays) push('stays', it as unknown as MapPlace);
    }
    for (const vp of viewportPlaces) push(viewportBucket(vp), vpToMapPlace(vp));
    const all: Array<{ key: string; item: MapPlace }> = [];
    for (const [, item] of byName) {
      all.push({ key: item.category || 'other', item });
    }
    return all;
  }, [mapData, catalog, viewportPlaces]);

  // Filter-chip counts over the FULL merged dataset (verified discovery data
  // + live viewport POIs), so the chips reflect what the map actually shows.
  const mapFilterCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const key of MAP_KEY_ORDER) counts[key] = 0;
    for (const { key } of allMapPlaces) counts[key] = (counts[key] ?? 0) + 1;
    counts['all'] = allMapPlaces.length;
    return counts;
  }, [allMapPlaces]);

  useEffect(() => {
    if (!mapRef.current || !layerRef.current) return;
    const layer = layerRef.current;
    layer.clearLayers();
    const cluster = clusterRef.current;
    if (cluster) cluster.clearLayers();
    const points: L.LatLng[] = [];
    const visible = allMapPlaces.filter(({ key }) => mapFilter === 'all' || key === mapFilter);
    for (const { key, item } of visible) {
      const lat = Number(item.latitude);
      const lng = Number(item.longitude);
      if (!lat || !lng) continue;
      points.push(L.latLng(lat, lng));
      const kind = MAP_LAYERS[key]?.kind ?? 'place';
      const name = item.name;
      const active = kind === 'food'
        ? selectedFood.has(name)
        : kind === 'stay'
          ? selectedStay?.name === name
          : selected.has(name);
      const color = COLORS[key] ?? '#64748b';
      const marker = L.circleMarker([lat, lng], {
        radius: active ? 12 : 8,
        color: '#ffffff',
        weight: 2,
        fillColor: active ? color : `${color}cc`,
        fillOpacity: active ? 1 : 0.75,
      });
      const oh = (item as MapPlace).opening_hours;
      marker.bindTooltip(`<b>${name}</b><br/>${MAP_LAYERS[key]?.label ?? key}${active ? '<br/>✓ selected' : ''}`);
      // Click a pin → proper place popup with details + explicit Add to Plan
      // (spec §2 — never a silent toggle).
      marker.on('click', () => setPopupPlace({ key, item }));
      // Clustered markers keep large POI sets smooth (spec §30); the plain
      // layer still draws when clustering is unavailable.
      if (cluster) marker.addTo(cluster); else marker.addTo(layer);
    }

    if (points.length > 0) {
      if (!hasFitRef.current) {
        hasFitRef.current = true;
        mapRef.current.fitBounds(L.latLngBounds(points).pad(0.18), { maxZoom: 13 });
      } else if (mapFilter !== 'all') {
        mapRef.current.fitBounds(L.latLngBounds(points).pad(0.25), { maxZoom: 15 });
      }
    }
  }, [allMapPlaces, mapFilter, selected, selectedFood, selectedStay, toggleMapItem]);

  // Viewport-based loading (spec §30): debounced fetch of real POIs for the
  // area actually on screen — every category, from the GeoApify proxy.
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const load = () => {
      const b = map.getBounds();
      if (!b) return;
      const seq = ++vpSeq.current;
      setVpLoading(true);
      api.getViewportPlaces({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, 100)
        .then((r) => {
          if (vpSeq.current === seq) setViewportPlaces(r.places || []);
        })
        .catch(() => { if (vpSeq.current === seq) setViewportPlaces([]); })
        .finally(() => {
          if (vpSeq.current === seq) setVpLoading(false);
        });
    };
    const debounced = () => {
      if (vpTimer.current) clearTimeout(vpTimer.current);
      vpTimer.current = setTimeout(load, 700);
    };
    map.on('moveend', debounced);
    // Initial load for the first fitted view (the discovery catalog fit fires
    // right after markers land).
    vpTimer.current = setTimeout(load, 900);
    return () => {
      map.off('moveend', debounced);
      if (vpTimer.current) clearTimeout(vpTimer.current);
    };
  }, [catalog]);

  useEffect(() => {
    let alive = true;
    api.getDestinationCatalog(tripId)
      .then((cat) => {
        if (!alive) return;
        setCatalog(cat);
        // ── AUTO-SELECT recommended places ──
        // The backend flags the strongest experience-matching places with
        // `recommended: true`. They arrive PRE-SELECTED so Travion has already
        // chosen the best matches for the trip — the traveller keeps full
        // control and can unselect/remove any of them before planning.
        if (!autoSelected) {
          setAutoSelected(true);
          const rec = [
            ...(cat.must_visit ?? []),
            ...((cat.activities ?? []) as unknown as Array<CatalogPlace & { recommended?: boolean }>),
          ]
            .filter((p) => p.recommended && !p.already_in_plan)
            .map((p) => p.name);
          if (rec.length > 0) setSelected(new Set(rec));
        }
      })
      .catch(() => { if (alive) setLoadError('Could not load verified places for this destination.'); });
    return () => { alive = false; };
  }, [tripId, autoSelected]);

  useEffect(() => {
    let alive = true;
    api.getMapPlaces(tripId)
      .then((m) => { if (alive) setMapData(m); })
      .catch(() => { /* fall back to catalog markers */ });
    return () => { alive = false; };
  }, [tripId]);

  // Date-relevant live events. The backend returns an honest empty list when no
  // provider is configured — the section then stays hidden (never fake data).
  useEffect(() => {
    let alive = true;
    api.getTripEvents(tripId)
      .then((r) => { if (alive) setEvents(r.events || []); })
      .catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, [tripId]);

  const totalSelected = selected.size + selectedFood.size;
  const places = useMemo(() => insideFirst(catalog?.must_visit ?? []), [catalog]);
  const activities = useMemo(() => insideFirst(catalog?.activities ?? []) as CatalogActivity[], [catalog]);
  // Best Tourist Spots — the famousness-ranked attractions, DISTINCT from the
  // preference-matched Must Visit list (spec §4: two different sections).
  const touristSpots = useMemo(() => insideFirst(catalog?.tourist_spots ?? []), [catalog]);

  const visiblePlaces = showAll ? places : places.slice(0, 6);

  const hasNothing = catalog
    && places.length === 0
    && activities.length === 0
    && (catalog.food?.length ?? 0) === 0
    && (catalog.stays?.length ?? 0) === 0;
  const budgetTier = catalog?.budget?.tier;
  const budgetPanel = catalog?.budget;

  const selectedEntryFees = useMemo(() => {
    const all = (catalog?.must_visit ?? []).concat((catalog?.tourist_spots ?? []) as CatalogPlace[]);
    return Array.from(selected)
      .map((name) => all.find((p) => p.name === name))
      .reduce((sum, p) => sum + (p ? (p.entry_fee ?? 0) : 0), 0);
  }, [catalog, selected]);

  const selectedStayCost = selectedStay?.price_per_night ?? 0;

  const handleConfirm = () => {
    const allItems = (catalog?.must_visit ?? []).concat((catalog?.tourist_spots ?? []) as CatalogPlace[]);
    // Map places can come from broader (non-recommended) categories too; look
    // them up across the full map dataset first, then the catalog cards.
    const allMap: Array<[string, MapPlace]> = [
      ...(mapData
        ? MAP_KEY_ORDER.flatMap((k) => ((mapData.map_places as Record<string, MapPlace[]>)[k] ?? []).map((i) => [k, i] as [string, MapPlace]))
        : []),
      // Live viewport POIs are first-class too: a place added from the map's
      // panned view keeps its real coordinates in the generated plan.
      ...viewportPlaces.map((vp) => [viewportBucket(vp), vpToMapPlace(vp)] as [string, MapPlace]),
    ];
    const byName = new Map<string, MapPlace>();
    for (const [, i] of allMap) if (!byName.has(i.name)) byName.set(i.name, i);
    const itemBySelection = (name: string): SelectedPlaceItem => {
      const mapHit = byName.get(name);
      if (mapHit) return toPlaceItemFromMap(mapHit);
      const hit = allItems.find((p) => p.name === name);
      return hit ? toPlaceItem(hit) : { name, source: 'selected' };
    };
    const placeItems = Array.from(selected).map(itemBySelection);
    const foodItems = Array.from(selectedFood).map((name) => {
      const hit = (catalog?.food ?? []).find((f) => f.name === name);
      return hit ? toFoodItem(hit) : { name, source: 'selected' };
    });
    // Persist the final selection server-side (single source of truth) so the
    // generated plans reproduce exactly what the traveller confirmed here.
    api.syncTripSelections(tripId, [
      ...placeItems.map((p) => ({
        provider_place_id: p.id || `sel:${p.name}`,
        name: p.name,
        category: 'must_visit',
        latitude: p.latitude ?? undefined,
        longitude: p.longitude ?? undefined,
        distance_km: p.distance_km ?? undefined,
        rating: p.rating ?? undefined,
        selection_source: 'user',
      })),
      ...foodItems.map((f) => ({
        provider_place_id: f.id || `sel:${f.name}`,
        name: f.name,
        category: 'food',
        latitude: f.latitude ?? undefined,
        longitude: f.longitude ?? undefined,
        distance_km: f.distance_km ?? undefined,
        rating: f.rating ?? undefined,
        selection_source: 'user',
      })),
    ], true).catch(() => { /* non-fatal — selections also ride the plan request */ });
    onConfirm(Array.from(selected), Array.from(selectedFood), placeItems, foodItems, selectedStay, selectedStay != null);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 3 · Destination discovery</span>
        <h2 className="mt-2 text-2xl font-extrabold text-slate-900 tracking-tight">Explore {destinationName}</h2>
        <p className="mt-1.5 text-[13px] font-medium text-slate-500">
          Browse the destination map, tap any pin for details, and build your own plan.
          Travion pre-selects the best matches for your travel style — unselect or add freely;
          only your final picks shape the itinerary.
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
            {catalog.destination_radius_km != null ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-500">
                <Landmark className="w-3.5 h-3.5 text-travion-600" />
                Whole {catalog.destination} area ({catalog.destination_radius_km} km map)
              </span>
            ) : catalog.core_radius_km != null ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-500">
                <Landmark className="w-3.5 h-3.5 text-travion-600" />
                Destination-wide: {catalog.destination}
              </span>
            ) : null}
          </div>

          {/* Step 3 interactive map — every real place, click to add */}
          <div className="mb-8">
            <div className="flex flex-wrap items-center justify-center gap-2 mb-3">
              <button
                key="all"
                type="button"
                onClick={() => setMapFilter('all')}
                className={`h-8 px-3.5 rounded-full text-[12px] font-bold border transition-all ${
                  mapFilter === 'all' ? 'text-white bg-travion-600 border-transparent shadow-sm' : 'bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <Compass className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                All places <span className="ml-0.5 text-[10px] font-black opacity-80">{mapFilterCount.all ?? 0}</span>
              </button>
              {MAP_KEY_ORDER.map((f) => {
                const count = (mapFilterCount as Record<string, number>)[f] ?? 0;
                const zero = count === 0;
                const label = MAP_LAYERS[f]?.label ?? f;
                const color = COLORS[f];
                return (
                  <button
                    key={f}
                    type="button"
                    disabled={zero}
                    title={zero ? 'No verified places in this category yet.' : undefined}
                    onClick={() => setMapFilter(f)}
                    className={`h-8 px-3.5 rounded-full text-[12px] font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      mapFilter === f
                        ? 'text-white border-transparent shadow-sm'
                        : 'bg-white text-slate-600 hover:border-slate-300'
                    }`}
                    style={mapFilter === f && color ? { backgroundColor: color } : mapFilter === f ? { backgroundColor: '#0f172a' } : undefined}
                  >
                    {label} <span className={`ml-0.5 text-[10px] font-black ${mapFilter === f ? 'opacity-80' : 'text-slate-400'}`}>{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="rounded-3xl overflow-hidden border border-slate-200 bg-white shadow-soft">
              <div ref={mapDiv} className="h-[440px] w-full z-0 relative" />
              <p className="flex flex-wrap items-center justify-center gap-4 px-4 py-2.5 bg-slate-50 border-t border-slate-100 text-[11px] font-bold text-slate-500">
                {(Object.entries(COLORS) as Array<[string, string]>).map(([k, c]) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: c }} />
                    {MAP_LAYERS[k]?.label ?? k}
                  </span>
                ))}
                <span className="text-slate-400 font-medium">Tap a marker to add it to your trip</span>
                <span className="inline-flex items-center gap-1 text-slate-400 font-medium">
                  {vpLoading ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-travion-500 animate-pulse inline-block" />
                      Loading places in view…
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                      {viewportPlaces.length} live places in view · pan to explore
                    </>
                  )}
                </span>
              </p>
            </div>
          </div>

          {/* My Plan — the user's live selection. Every Add to Plan lands
              here instantly (spec §14: selected places must be visible). */}
          <div className="mb-8 rounded-3xl border border-travion-100 bg-travion-50/40 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-600">
                <ClipboardList className="w-4 h-4 text-travion-600" /> My Plan
              </h3>
              <span className="text-[11px] font-bold text-slate-500">
                {totalSelected > 0
                  ? `${selected.size} place${selected.size === 1 ? '' : 's'} · ${selectedFood.size} food stop${selectedFood.size === 1 ? '' : 's'}${selectedStay ? ' · stay selected' : ''}`
                  : 'Nothing selected yet — tap pins or cards to add'}
              </span>
            </div>
            {totalSelected === 0 && !selectedStay ? (
              <p className="text-[12px] font-medium text-slate-400">
                Places, activities and food stops you add will appear here before your itinerary is organized.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {Array.from(selected).map((name) => (
                  <span key={`mp_${name}`} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-white border border-travion-200 text-[11px] font-bold text-slate-700">
                    {name}
                    <button
                      type="button"
                      aria-label={`Remove ${name} from plan`}
                      onClick={() => toggle(selected, setSelected, name)}
                      className="p-0.5 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {Array.from(selectedFood).map((name) => (
                  <span key={`mpf_${name}`} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-white border border-orange-200 text-[11px] font-bold text-slate-700">
                    {name}
                    <button
                      type="button"
                      aria-label={`Remove ${name} from plan`}
                      onClick={() => toggle(selectedFood, setSelectedFood, name)}
                      className="p-0.5 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {selectedStay && (
                  <span className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-white border border-violet-200 text-[11px] font-bold text-slate-700">
                    {selectedStay.name}
                    <button
                      type="button"
                      aria-label="Remove stay"
                      onClick={() => setSelectedStay(null)}
                      className="p-0.5 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Must visit — honest empty state. We search the whole destination, never a tiny circle */}
          <div className="mb-8">
            <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-500 mb-3">
              <Mountain className="w-4 h-4 text-travion-600" /> Must visit
              <span className="text-slate-300">·</span>
              <span className="text-[11px] font-bold text-emerald-600 normal-case">✓ verified real places</span>
            </h3>
            {places.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center">
                <p className="text-[13px] font-bold text-slate-600">
                  No verified places found for {catalog.destination} right now.
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

          {/* Best Tourist Spots — the destination's most famous attractions,
              ranked by popularity rather than preference. DISTINCT from Must
              Visit (which is AI-preference-matched). Every item is a PLACE
              inside the destination — never a nearby town (spec §4). */}
          {touristSpots.length > 0 && (
          <div className="mb-8">
            <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-500 mb-3">
              <Camera className="w-4 h-4 text-travion-600" /> Best tourist spots
              <span className="text-slate-300">·</span>
              <span className="text-[11px] font-bold text-emerald-600 normal-case">most popular attractions in {destinationName}</span>
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {touristSpots.map((spot: CatalogPlace) => {
                const active = selected.has(spot.name);
                return (
                  <button
                    key={`spot_${spot.id ?? spot.name}`}
                    type="button"
                    onClick={() => toggle(selected, setSelected, spot.name)}
                    className={`text-left p-4 rounded-2xl border transition-all ${
                      active
                        ? 'bg-travion-50 border-travion-400 ring-2 ring-travion-100'
                        : 'bg-white border-slate-200 hover:border-travion-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-extrabold text-slate-900 leading-snug">{spot.name}</p>
                        {spot.description && (
                          <p className="mt-1 text-[11px] font-medium text-slate-500 line-clamp-2">{spot.description}</p>
                        )}
                        <div className="mt-2 flex items-center gap-2 text-[10.5px] font-bold text-slate-400">
                          <span className="text-travion-600">{placementLabel(spot.placement, spot.distance_km)}</span>
                          {(spot.entry_fee ?? 0) > 0 ? <span>· ₹{spot.entry_fee} entry</span> : <span className="text-emerald-600">· Free</span>}
                          {spot.rating != null && <span>· ★ {Number(spot.rating).toFixed(1)}</span>}
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

          {/* Activities to do — THINGS THE USER CAN DO, never place names
              (spec §5). Each card shows the ACTION, the real LOCATION where it
              happens, and the recommended time of day. */}
          {activities.length > 0 && (
          <div className="mb-8">
            <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-500 mb-3">
              <Compass className="w-4 h-4 text-travion-600" /> Activities to do
              <span className="text-slate-300">·</span>
              <span className="text-[11px] font-bold text-emerald-600 normal-case">real experiences at real places</span>
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {activities.map((activity: CatalogActivity) => {
                const active = selected.has(activity.name);
                return (
                  <button
                    key={`act_${activity.id ?? activity.name}`}
                    type="button"
                    onClick={() => toggle(selected, setSelected, activity.name)}
                    className={`text-left p-4 rounded-2xl border transition-all ${
                      active
                        ? 'bg-travion-50 border-travion-400 ring-2 ring-travion-100'
                        : 'bg-white border-slate-200 hover:border-travion-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-extrabold text-slate-900 leading-snug">{activity.action}</p>
                        {activity.description && (
                          <p className="mt-1 text-[11px] font-medium text-slate-500 line-clamp-2">{activity.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] font-bold text-slate-400">
                          <span className="inline-flex items-center gap-1 text-travion-700">
                            <MapPin className="w-3 h-3" /> {activity.location_name}
                          </span>
                          {activity.time_of_day && (
                            <span className="inline-flex items-center gap-1 text-amber-600">
                              <Clock className="w-3 h-3" /> {activity.time_of_day}
                            </span>
                          )}
                          {activity.duration_minutes != null && <span>· ~{activity.duration_minutes} min</span>}
                          {activity.rating != null && <span>· ★ {Number(activity.rating).toFixed(1)}</span>}
                        </div>
                      </div>
                      <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                        active ? 'bg-travion-600 text-white' : 'bg-travion-50 text-travion-700'
                      }`}>
                        {active ? (
                          <>
                            <svg viewBox="0 0 12 12" className="w-3 h-3"><path fill="currentColor" d="M4.6 8.4L2.3 6.1l.9-.9 1.4 1.4 3.2-3.2.9.9z" /></svg>
                            Added
                          </>
                        ) : (
                          '+ Add Activity'
                        )}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {/* Live events around the travel dates — only real provider-backed
              listings; the section disappears entirely when there are none. */}
          {events.length > 0 && (
          <div className="mb-8">
            <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-slate-500 mb-3">
              <CalendarDays className="w-4 h-4 text-travion-600" /> Live during your dates
              <span className="text-slate-300">·</span>
              <span className="text-[11px] font-bold text-slate-400 normal-case">tap to add to your trip</span>
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {events.map((ev) => {
                const active = selected.has(ev.name);
                return (
                  <div
                    key={ev.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggle(selected, setSelected, ev.name)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(selected, setSelected, ev.name); }}
                    className={`text-left p-4 rounded-2xl border transition-all cursor-pointer ${
                      active
                        ? 'bg-travion-50 border-travion-400 ring-2 ring-travion-100'
                        : 'bg-white border-slate-200 hover:border-travion-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-extrabold text-slate-900 leading-snug">{ev.name}</p>
                        {ev.venue && (
                          <p className="mt-0.5 text-[11px] font-medium text-slate-500 flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {ev.venue}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] font-bold text-slate-400">
                          {ev.date && <span className="text-travion-600">{ev.date}{ev.time ? ` · ${ev.time}` : ''}</span>}
                          {ev.price != null && <span>· ₹{ev.price}</span>}
                          {ev.booking_url && (
                            <a
                              href={ev.booking_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-0.5 text-travion-600 hover:underline"
                            >
                              Book <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
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
                  </div>
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
                  selectedStay === null ? 'bg-travion-600 border-travion-400' : 'border-slate-300'
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
                        ? 'bg-travion-50 border-travion-400 ring-2 ring-travion-100'
                        : 'bg-white border-slate-200 hover:border-travion-200'
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
                        active ? 'bg-travion-500 border-travion-600' : 'border-slate-300 bg-white'
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

          {/* Live selection estimate — no hidden costs, updated as you pick */}
          {(totalSelected > 0 || selectedStay) && (
            <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 flex items-center justify-between gap-3 text-[12px] font-bold text-slate-600">
              <span className="text-slate-500">
                Estimated add-on spend so far
              </span>
              <span className="text-travion-700">
                ₹{selectedEntryFees.toLocaleString('en-IN')} entry fees
                {selectedStayCost > 0 && <> · ₹{selectedStayCost.toLocaleString('en-IN')}/night stay</>}
              </span>
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
                    : busy ? 'Generating your plans…' : 'Continue to Trip Planning'}
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

      {/* ── Map pin popup: place details + explicit Add to Plan (spec §2) ── */}
      <AnimatePresence>
        {popupPlace && (() => {
          const p = popupPlace.item;
          const kind = MAP_LAYERS[popupPlace.key]?.kind ?? 'place';
          const active = kind === 'food'
            ? selectedFood.has(p.name)
            : kind === 'stay'
              ? selectedStay?.name === p.name
              : selected.has(p.name);
          const add = () => toggleMapItem(popupPlace.key, p);
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-travion-900/40 backdrop-blur-sm"
              onClick={() => setPopupPlace(null)}
            >
              <motion.div
                initial={{ y: 24, opacity: 0, scale: 0.98 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: 24, opacity: 0, scale: 0.98 }}
                className="w-full max-w-md bg-white rounded-3xl shadow-floating border border-slate-200 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between p-5 pb-3">
                  <div className="min-w-0">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-black uppercase tracking-wider text-white"
                      style={{ backgroundColor: COLORS[popupPlace.key] ?? '#64748b' }}
                    >
                      {MAP_LAYERS[popupPlace.key]?.label ?? popupPlace.key}
                    </span>
                    <h3 className="mt-1.5 text-lg font-extrabold text-slate-900 leading-snug">{p.name}</h3>
                    {(p as MapPlace).address && (
                      <p className="mt-0.5 text-[11.5px] font-medium text-slate-500 line-clamp-2">{(p as MapPlace).address}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPopupPlace(null)}
                    className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="px-5 pb-5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                    {(p as MapPlace).rating != null && <span>★ {Number((p as MapPlace).rating).toFixed(1)}</span>}
                    {(p as MapPlace).opening_hours && <span>🕘 {(p as MapPlace).opening_hours}</span>}
                    {p.distance_km != null && <span>{p.distance_km} km from centre</span>}
                    <span className="text-travion-600">{placementLabel(p.placement, p.distance_km)}</span>
                  </div>
                  {kind === 'stay' ? (
                    <button
                      type="button"
                      onClick={() => { add(); setPopupPlace(null); }}
                      className={`mt-4 w-full h-11 rounded-2xl text-[13px] font-extrabold transition-colors ${
                        active
                          ? 'bg-emerald-600 text-white'
                          : 'bg-travion-600 hover:bg-travion-700 text-white'
                      }`}
                    >
                      {active ? '✓ Selected as your stay' : 'Use as my stay'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={add}
                      className={`mt-4 w-full h-11 rounded-2xl text-[13px] font-extrabold transition-colors ${
                        active
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-travion-600 hover:bg-travion-700 text-white'
                      }`}
                    >
                      {active ? '✓ In My Plan — tap to remove' : '+ Add to Plan'}
                    </button>
                  )}
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
};