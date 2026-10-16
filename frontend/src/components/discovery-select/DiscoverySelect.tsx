import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BadgeCheck, MapPin, BedDouble, Utensils, Mountain, Compass, ArrowRight, ArrowUpRight, Landmark, ShieldAlert, Info, CalendarDays, ExternalLink, X, Clock, ClipboardList, Camera, Search, LocateFixed } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { DestinationCatalog, CatalogPlace, CatalogFood, CatalogStay, CatalogActivity, SelectedPlaceItem, SelectedFoodItem, SelectedStay, MapPlacesPayload, MapPlace, TripEventItem, GeoViewportPlace } from '../../types';
import { api } from '../../services/api';
import { useToast } from '../ui';

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
    /** How many ACTIVITY cards (things to do) the traveller added — real
        activities, not places (shown on the experience-choice screen). */
    activityCount: number,
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
 * Destination Discovery — MAP-FIRST "Explore & select places".
 * The interactive map is the PRIMARY interface (spec §1): it dominates the
 * desktop as a sticky pane, every card/marker/selected-chip is synchronized
 * with it both ways, and selections become hard preferences for the planner.
 * Shows ONLY real verified places (each carries verified: true from the
 * backend); stays are a single-select choice ('Continue without a stay'
 * skips accommodation).
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
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [mapFilter, setMapFilter] = useState('all');
  const [autoSelected, setAutoSelected] = useState(false);
  const [events, setEvents] = useState<TripEventItem[]>([]);
  // GeoApify basemap + viewport-based POI loading (spec §8/§30): the map asks
  // the backend /geo proxy for the places actually visible, debounced on
  // pan/zoom, clustered so large POI sets stay smooth.
  const [viewportPlaces, setViewportPlaces] = useState<GeoViewportPlace[]>([]);
  const [vpLoading, setVpLoading] = useState(false);
  // Honest failure state for the live layer (spec §44): rate limits / auth
  // errors must never silently render as a map with "0 live places in view".
  const [vpError, setVpError] = useState<string | null>(null);
  // Map pin popup: click a pin → place card with details + Add to Plan
  // (spec §2 — every map place is clickable and adds to the plan from a
  // proper popup, not a silent toggle).
  const [popupPlace, setPopupPlace] = useState<{ key: string; item: MapPlace } | null>(null);
  // Bumped by the Retry button so a failed catalog load can be attempted again
  // (spec §45: every API-driven operation offers Loading / Error / Retry).
  const [catalogRetry, setCatalogRetry] = useState(0);
  // Card ↔ map sync (spec §8/§32): the highlighted place (from a marker click
  // OR a card click) renders a ring on the map and a highlight on the card.
  const [highlight, setHighlight] = useState<{ key: string; name: string } | null>(null);
  // In-dataset search (spec §33): searches the REAL loaded POI dataset only.
  const [searchQuery, setSearchQuery] = useState('');
  // Whether the CURRENT popup was opened from a marker (→ scroll its card into
  // view) or from a card (→ already visible, don't scroll-jump the panel).
  const lastFocusFromMap = useRef(false);

  const { toast } = useToast();

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, name: string) => {
    const next = new Set(set);
    const removing = next.has(name);
    if (removing) next.delete(name); else next.add(name);
    setter(next);
    if (set === selected) {
      if (removing) {
        toast({
          tone: 'info',
          title: 'Removed from your plan',
          desc: name,
          action: {
            label: 'Undo',
            onAction: () => setSelected((prev) => { const n = new Set(prev); n.add(name); return n; }),
          },
        });
      } else {
        toast({ tone: 'success', title: 'Added to your plan', desc: name });
      }
    }
  };

  // Stage-4 interactive map (raw Leaflet — leaflet is the only map dependency).
  const mapDiv = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const hasFitRef = useRef(false);
  const tileUrlRef = useRef<string | null>(null);
  const vpSeq = useRef(0);
  const vpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // DOM refs for every rendered card, keyed `card_<category>_<encodedName>` —
  // a marker click scrolls its card into view (spec §17: marker → card).
  const cardRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const setCardRef = (key: string, name: string) => (el: HTMLElement | null) => {
    cardRefs.current.set(`card_${key}_${encodeURIComponent(name)}`, el);
  };

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
    // Responsive correctness: when the window resizes (or a panel reflows the
    // grid), Leaflet keeps a stale canvas size — re-measure to avoid a
    // half-rendered map on mobile rotation or desktop split-pane use.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (mapRef.current) map.invalidateSize();
      }, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
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
    // Healthcare + educational categories are VIEW-ONLY — never selectable.
    if (key === 'healthcare' || key === 'education') return;
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
    const centerLat = Number(catalog?.must_visit?.[0]?.latitude ?? (mapData?.map_places as any)?.must_visit?.[0]?.latitude);
    const centerLng = Number(catalog?.must_visit?.[0]?.longitude ?? (mapData?.map_places as any)?.must_visit?.[0]?.longitude);
    const hasCenter = Boolean(centerLat && centerLng);

    for (const vp of viewportPlaces) {
      if (hasCenter && vp.lat && vp.lng) {
        const dLat = (vp.lat - centerLat) * (Math.PI / 180);
        const dLon = (vp.lng - centerLng) * (Math.PI / 180);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(centerLat * (Math.PI / 180)) * Math.cos(vp.lat * (Math.PI / 180)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const distKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        if (distKm > 35) continue; // Strictly within destination boundary only
      }
      push(viewportBucket(vp), vpToMapPlace(vp));
    }
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

  // A category's count is only HONEST once its data source has reported.
  // While the broader map payload is still loading, secondary categories must
  // show '—' — never a misleading 0 (spec §15: no fake zeros during load).
  const countReady = useCallback((key: string) => {
    if (mapData) return true; // full verified dataset (all categories) loaded
    if (catalog && ['must_visit', 'activities', 'food', 'stays'].includes(key)) return true;
    return false; // still loading → render '—', never 0
  }, [mapData, catalog]);

  const chipCount = useCallback((key: string) =>
    countReady(key) ? (mapFilterCount as Record<string, number>)[key] ?? 0 : null
  , [countReady, mapFilterCount]);

  // ── CARD ↔ MAP SYNCHRONIZATION (spec §8/§32) ─────────────────────────────
  // CARD → MAP: fly to the exact place, highlight the marker, open the popup.
  const flyToPlace = useCallback((key: string, item: MapPlace) => {
    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    if (!lat || !lng) return;
    lastFocusFromMap.current = false;
    setHighlight({ key, name: item.name });
    setPopupPlace({ key, item });
    // The marker must be visible: a narrowed filter that hides this category
    // resets to All Places (spec §13 — clicking a card MUST react on the map).
    if (mapFilter !== 'all' && mapFilter !== key) setMapFilter('all');
    // Mobile: the map sits ABOVE the stacked panel — bring it into view so
    // the fly-to is actually seen (desktop keeps the map permanently sticky).
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      mapDiv.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (mapRef.current) {
      mapRef.current.flyTo([lat, lng], Math.max(mapRef.current.getZoom(), 15), { duration: 0.8 });
    }
  }, [mapFilter]);

  // Fly to a selected chip / card by name — resolves against the full map
  // dataset, then activity anchors ("Action — Place" → its real location).
  const flyToByName = useCallback((name: string) => {
    const norm = name.trim().toLowerCase();
    const hit = allMapPlaces.find(({ item }) => item.name.toLowerCase() === norm)
      ?? allMapPlaces.find(({ item }) => item.name.toLowerCase().includes(norm));
    if (hit) { flyToPlace(hit.key, hit.item); return; }
    const act = (catalog?.activities ?? []).find((a) => a.name === name);
    if (act?.latitude && act?.longitude) {
      flyToPlace('activities', {
        name: act.location_name || act.name, category: 'activities',
        latitude: act.latitude, longitude: act.longitude,
        address: act.description ?? null, source: act.source || 'derived', verified: true,
      });
    }
  }, [allMapPlaces, catalog, flyToPlace]);

  // MAP → CARD: after a marker click, scroll the corresponding card into view.
  useEffect(() => {
    if (!popupPlace || !lastFocusFromMap.current) return;
    const el = cardRefs.current.get(`card_${popupPlace.key}_${encodeURIComponent(popupPlace.item.name)}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [popupPlace]);

  // In-dataset search over the REAL loaded POIs only (spec §33) — never a
  // fabricated result. Click → map flies to the exact place.
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allMapPlaces.filter(({ item }) =>
      item.name?.toLowerCase().includes(q)
      || (item.address || '').toLowerCase().includes(q)
      || (MAP_LAYERS[item.category]?.label || '').toLowerCase().includes(q)
    ).slice(0, 8);
  }, [searchQuery, allMapPlaces]);

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
      const isHighlight = highlight?.name === name && (mapFilter === 'all' || mapFilter === key);
      const color = COLORS[key] ?? '#64748b';
      const marker = L.circleMarker([lat, lng], {
        radius: isHighlight ? 14 : active ? 12 : 8,
        color: isHighlight ? '#f59e0b' : '#ffffff',
        weight: isHighlight ? 4 : 2,
        fillColor: active ? color : `${color}cc`,
        fillOpacity: active ? 1 : 0.75,
      });
      marker.bindTooltip(`<b>${name}</b><br/>${MAP_LAYERS[key]?.label ?? key}${active ? '<br/>✓ selected' : ''}`);
      // Click a pin → proper place popup with details + explicit Add to Plan
      // (spec §2 — never a silent toggle); also highlights + scrolls to the
      // corresponding card (spec §17: marker → card sync).
      marker.on('click', () => {
        lastFocusFromMap.current = true;
        setHighlight({ key, name });
        setPopupPlace({ key, item });
        mapRef.current?.flyTo([lat, lng], Math.max(mapRef.current.getZoom(), 15), { duration: 0.6 });
      });
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
  }, [allMapPlaces, mapFilter, selected, selectedFood, selectedStay, highlight, toggleMapItem]);

  // "Back to the destination view" — reset the camera to the fitted dataset.
  const resetView = useCallback(() => {
    const pts = allMapPlaces
      .map(({ item }) => (item.latitude && item.longitude ? L.latLng(Number(item.latitude), Number(item.longitude)) : null))
      .filter((p): p is L.LatLng => !!p);
    if (pts.length && mapRef.current) {
      mapRef.current.flyToBounds(L.latLngBounds(pts).pad(0.18), { maxZoom: 13, duration: 0.8 });
      setMapFilter('all');
    }
  }, [allMapPlaces]);

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
          if (vpSeq.current === seq) {
            setViewportPlaces(r.places || []);
            setVpError(null);
          }
        })
        .catch((err) => {
          if (vpSeq.current !== seq) return;
          setViewportPlaces([]);
          // NEVER a silent failure: surface why the live layer is empty.
          console.error('[Explore] live viewport POIs failed:', err?.message || err);
          const msg = String(err?.message || '');
          if (msg.includes('429') || /rate limit/i.test(msg)) {
            setVpError('Live browsing paused for a moment (provider rate limit) — recommended places below are unaffected.');
          } else if (msg.includes('401') || msg.includes('403')) {
            setVpError('Live place browsing needs you to sign in again.');
          } else {
            setVpError('Live places could not be loaded — the verified places below are still available.');
          }
        })
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
      .catch((err) => {
        if (!alive) return;
        // Classified failures (PART I): the user must see WHY discovery failed,
        // not one generic message for every kind of breakdown.
        const status = Number((err as { status?: number })?.status
          ?? (err as { extra?: { status?: number } })?.extra?.status
          ?? 0);
        const msg = String((err as Error)?.message || '');
        if (msg.includes('Trip not found')) {
          setLoadError('Your trip session expired — please start planning again.');
        } else if (status === 429 || msg.includes('429') || /rate limit/i.test(msg)) {
          setLoadError('The place provider is rate-limiting us right now — please retry in a few seconds.');
        } else if (status === 401 || status === 403 || msg.includes('401') || msg.includes('403')) {
          setLoadError('Your session needs to be re-authenticated to load verified places.');
        } else if (msg.includes('not found in geocoding')) {
          setLoadError(`We couldn't identify "${destinationName}" as a destination — check the spelling.`);
        } else {
          setLoadError('Verified places could not be loaded — the place provider may be temporarily down.');
        }
      });
    return () => { alive = false; };
  }, [tripId, autoSelected, catalogRetry]);

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
  // ── Cumulative-LLM personalization (step 4 reads steps 1–3) ──────────────
  // The backend routes the FULL saved trip (dates, party, budget, interests +
  // the chosen round-trip transport) to the places prompt and returns this
  // group's ordered picks with reasons. Names are validated server-side
  // against verified candidates, so ordering can never invent a place; when
  // the model is unreachable the catalog order stands (source 'catalog').
  const [aiRanking, setAiRanking] = useState<Record<string, Array<{ name: string; reason: string }>> | null>(null);
  const [aiSource, setAiSource] = useState<'llm' | 'catalog' | null>(null);
  useEffect(() => {
    let live = true;
    setAiRanking(null);
    setAiSource(null);
    api.personalizeDiscovery(tripId)
      .then((r) => {
        if (!live) return;
        setAiRanking(r.categories || {});
        setAiSource(r.source);
      })
      .catch(() => { /* catalog order stands — never blocks Explore */ });
    return () => { live = false; };
  }, [tripId]);
  const rankIndex = useCallback((cat: string, name: string): number => {
    const list = aiRanking?.[cat];
    if (!list) return 999;
    const i = list.findIndex((p) => p.name.trim().toLowerCase() === (name || '').trim().toLowerCase());
    return i < 0 ? 999 : i;
  }, [aiRanking]);
  const aiReason = useCallback((cat: string, name: string): string | null => {
    const list = aiRanking?.[cat];
    if (!list) return null;
    const hit = list.find((p) => p.name.trim().toLowerCase() === (name || '').trim().toLowerCase());
    return hit?.reason || null;
  }, [aiRanking]);
  const orderByRank = useCallback(<T,>(items: T[], cat: string, keyOf: (t: T) => string, extraCats: string[] = []): T[] => {
    if (!aiRanking) return items;
    return [...items].sort((a, b) => {
      const ra = Math.min(rankIndex(cat, keyOf(a)), ...extraCats.map((c) => rankIndex(c, keyOf(a))));
      const rb = Math.min(rankIndex(cat, keyOf(b)), ...extraCats.map((c) => rankIndex(c, keyOf(b))));
      return ra - rb;
    });
  }, [aiRanking, rankIndex]);
  const AiPickNote: React.FC<{ cat: string; name: string; extraCats?: string[] }> = ({ cat, name, extraCats = [] }) => {
    if (aiSource !== 'llm') return null;
    const cats = [cat, ...extraCats];
    let reason: string | null = null;
    let picked = false;
    for (const c of cats) {
      const r = aiReason(c, name);
      if (r !== null || rankIndex(c, name) < 999) { reason = r; picked = true; break; }
    }
    if (!picked) return null;
    return (
      <p className="mt-1 text-[10.5px] font-bold text-travion-700 leading-snug">
        Picked for your group{reason ? ` — ${reason}` : ''}
      </p>
    );
  };
  const places = useMemo(() => orderByRank(insideFirst(catalog?.must_visit ?? []), 'must_visit', (p) => p.name), [catalog, orderByRank]);
  const activities = useMemo(() => orderByRank(insideFirst(catalog?.activities ?? []), 'activities', (a: CatalogActivity) => (a as CatalogActivity).name ?? (a as CatalogActivity).action) as CatalogActivity[], [catalog, orderByRank]);
  // Best Tourist Spots — the famousness-ranked attractions, DISTINCT from the
  // preference-matched Must Visit list (spec §4: two different sections).
  const touristSpots = useMemo(() => insideFirst(catalog?.tourist_spots ?? []), [catalog]);
  // Candidate display cap: at most 10 cards per category (prevents overload;
  // the map still shows the full verified dataset).
  const MAX_CANDIDATES_PER_CATEGORY = 10;

  const visiblePlaces = showAll ? places.slice(0, MAX_CANDIDATES_PER_CATEGORY) : places.slice(0, 6);
  // Stage-4 rule: EXACTLY ONE stay is required before Continue. Selections are
  // local state only — they are never cleared by budget/gate refreshes, so a
  // top-up elsewhere can never lose the traveller's picks.
  const [stayRequiredNote, setStayRequiredNote] = useState<string | null>(null);

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

  const handleConfirm = async () => {
    let currentSelected = new Set(selected);
    const allItems = (catalog?.must_visit ?? []).concat((catalog?.tourist_spots ?? []) as CatalogPlace[]);

    // If no place was manually checked, auto-select the top 3 verified places so traveller is never stuck
    if (currentSelected.size === 0) {
      const autoPicks = allItems.slice(0, 3).map((p) => p.name);
      if (autoPicks.length > 0) {
        currentSelected = new Set(autoPicks);
        setSelected(currentSelected);
      }
    }
    setStayRequiredNote(null);
    setSaving(true);

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
    // Activities carry their own real coordinates (they are auto-selected when
    // recommended): resolve them too so plan stops keep their lat/lng instead
    // of falling back to a coordinate-less {name, source:'selected'} stub.
    const activityItems = new Map<string, SelectedPlaceItem>();
    for (const a of catalog?.activities ?? []) {
      if (a.latitude == null || a.longitude == null) continue;
      activityItems.set(a.name, {
        id: a.id ?? null,
        name: a.name,
        latitude: a.latitude,
        longitude: a.longitude,
        entry_fee: a.entry_fee ?? null,
        duration_minutes: a.duration_minutes ?? null,
        rating: a.rating ?? null,
        placement: a.placement ?? 'inside',
        source: a.source ?? 'derived',
      });
    }
    const itemBySelection = (name: string): SelectedPlaceItem => {
      const mapHit = byName.get(name);
      if (mapHit) return toPlaceItemFromMap(mapHit);
      const act = activityItems.get(name);
      if (act) return act;
      const hit = allItems.find((p) => p.name === name);
      return hit ? toPlaceItem(hit) : { name, source: 'selected' };
    };
    const placeItems = Array.from(currentSelected).map(itemBySelection);
    const foodItems = Array.from(selectedFood).map((name) => {
      const hit = (catalog?.food ?? []).find((f) => f.name === name);
      return hit ? toFoodItem(hit) : { name, source: 'selected' };
    });

    try {
      // Persist the final selection server-side (single source of truth) so the
      // generated plans reproduce exactly what the traveller confirmed here.
      await api.syncTripSelections(tripId, [
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
      ], true);
    } catch (err) {
      console.warn('syncTripSelections warning:', err);
    } finally {
      setSaving(false);
    }

    // Activities are counted separately: they are THINGS TO DO (action cards),
    // not places — the experience-choice screen shows the honest split.
    const activityCount = (catalog?.activities ?? []).filter((a: CatalogActivity) => currentSelected.has(a.name)).length;
    // A stay can be chosen here or in dedicated Step 5 Stay
    onConfirm(Array.from(currentSelected), Array.from(selectedFood), placeItems, foodItems, selectedStay, selectedStay != null, activityCount);
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <span className="text-xs font-bold uppercase tracking-wider text-travion-600">Step 4 · Destination discovery</span>
        <h2 className="mt-2 text-2xl font-extrabold text-charcoal-900 tracking-tight">Explore {destinationName}</h2>
        <p className="mt-1.5 text-[13px] font-medium text-charcoal-500">
          The map is your planner: pan the real destination, tap any pin or card for details, and build your own plan.
          Travion pre-selects the best matches for your travel style — unselect or add freely;
          only your final picks shape the itinerary.
        </p>
      </div>

      {loadError && (
        <div className="max-w-md mx-auto rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] font-bold text-red-600 text-center">
          {loadError}
          <button
            type="button"
            onClick={() => { setLoadError(null); setCatalogRetry((n) => n + 1); }}
            className="mt-2 block mx-auto px-4 h-9 rounded-xl bg-travion-600 hover:bg-travion-700 text-white text-[12px] font-extrabold transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {!catalog && !loadError && (
        <div className="py-16 text-center">
          <p className="text-[13px] font-bold text-charcoal-500">Exploring {destinationName}…</p>
          <p className="mt-1 text-[12px] font-medium text-charcoal-400">Finding verified places · loading the destination map…</p>
          <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl mx-auto">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-4 rounded-2xl border border-charcoal-200 bg-white animate-pulse">
                <div className="h-3.5 w-2/3 rounded bg-sand-200" />
                <div className="mt-2 h-2.5 w-full rounded bg-sand-100" />
                <div className="mt-1.5 h-2.5 w-4/5 rounded bg-sand-100" />
              </div>
            ))}
          </div>
        </div>
      )}

      {catalog && (
        <>
          {/* Data source — honest badge about where these places come from */}
          <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-sand-100 border border-charcoal-200 px-3 py-1 text-[11px] font-bold text-charcoal-500">
              <BadgeCheck className="w-3.5 h-3.5 text-emerald-600" />
              All places verified, no invented entries
            </span>
            {catalog.discovery_source && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sand-100 border border-charcoal-200 px-3 py-1 text-[11px] font-bold text-charcoal-500">
                <MapPin className="w-3.5 h-3.5 text-travion-600" />
                Source: {catalog.discovery_source.replace(/_/g, ' ')}
              </span>
            )}
            {catalog.destination_radius_km != null ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-sand-100 border border-charcoal-200 px-3 py-1 text-[11px] font-bold text-charcoal-500">
                <Landmark className="w-3.5 h-3.5 text-travion-600" />
                Whole {catalog.destination} area ({catalog.destination_radius_km} km map)
              </span>
            ) : catalog.core_radius_km != null ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-sand-100 border border-charcoal-200 px-3 py-1 text-[11px] font-bold text-charcoal-500">
                <Landmark className="w-3.5 h-3.5 text-travion-600" />
                Destination-wide: {catalog.destination}
              </span>
            ) : null}
          </div>

          {/* Budget Feasibility advisor — the honest strip */}
          {budgetPanel && budgetTier && (
            <div className={`mb-6 rounded-2xl border px-4 py-3.5 flex items-start gap-3 ${
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

          {/* ── MAP-FIRST LAYOUT — the map is the hero (spec §1/§18) ──
              Desktop: sticky map pane (~62%) + independently scrollable
              exploration panel. Mobile: full-width map on top, panel below. */}
          <div className="lg:flex lg:items-start lg:gap-6">

            {/* ══ LEFT / TOP: THE MAP PANE ══ */}
            <div className="lg:w-[62%] lg:sticky lg:top-4 lg:self-start mb-6 lg:mb-0">
              {/* In-dataset search (spec §33) — real loaded POIs only */}
              <div className="relative mb-2.5">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search places in ${destinationName}… (museum, hotel, park)`}
                  className="w-full h-11 pl-10 pr-4 rounded-2xl border border-charcoal-200 bg-white text-[13px] font-semibold text-charcoal-800 placeholder:text-charcoal-400 placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-travion-200 focus:border-travion-300 shadow-soft"
                  aria-label={`Search places in ${destinationName}`}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-charcoal-400 hover:text-charcoal-700 hover:bg-sand-100"
                    aria-label="Clear search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                {searchResults.length > 0 && (
                  <div className="absolute z-20 mt-1.5 w-full rounded-2xl border border-charcoal-200 bg-white shadow-floating overflow-hidden">
                    {searchResults.map(({ key, item }) => (
                      <button
                        key={`sr_${key}_${item.name}`}
                        type="button"
                        onClick={() => { flyToPlace(key, item); setSearchQuery(''); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-travion-50 transition-colors"
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[key] ?? '#64748b' }} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-extrabold text-charcoal-900 truncate">{item.name}</span>
                          {item.address && <span className="block text-[11px] font-medium text-charcoal-400 truncate">{item.address}</span>}
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-wide text-travion-600 shrink-0">{MAP_LAYERS[key]?.label ?? key}</span>
                      </button>
                    ))}
                  </div>
                )}
                {searchQuery.trim() && searchResults.length === 0 && (
                  <div className="absolute z-20 mt-1.5 w-full rounded-2xl border border-charcoal-200 bg-white shadow-floating px-4 py-3 text-[12px] font-bold text-charcoal-500">
                    No loaded place matches "{searchQuery.trim()}" — try panning the map to load more.
                  </div>
                )}
              </div>

              {/* Category filter bar — floating over the map, counts from REAL
                  loaded data; '—' while loading (never a fake 0, spec §15) */}
              <div className="flex flex-wrap items-center gap-2 mb-2.5">
                <button
                  key="all"
                  type="button"
                  onClick={() => setMapFilter('all')}
                  className={`h-8 px-3.5 rounded-full text-[12px] font-bold border transition-all ${
                    mapFilter === 'all' ? 'text-white bg-travion-600 border-transparent shadow-sm' : 'bg-white text-charcoal-600 hover:border-charcoal-300'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                  All places <span className="ml-0.5 text-[10px] font-black opacity-80">{chipCount('all') ?? '—'}</span>
                </button>
                {MAP_KEY_ORDER.map((f) => {
                  const count = chipCount(f);
                  const empty = count === 0;
                  const label = MAP_LAYERS[f]?.label ?? f;
                  const color = COLORS[f];
                  return (
                    <button
                      key={f}
                      type="button"
                      disabled={count != null && empty}
                      title={count === 0 ? 'No verified places in this category yet.' : undefined}
                      onClick={() => setMapFilter(f)}
                      className={`h-8 px-3.5 rounded-full text-[12px] font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        mapFilter === f
                          ? 'text-white border-transparent shadow-sm'
                          : 'bg-white text-charcoal-600 hover:border-charcoal-300'
                      }`}
                      style={mapFilter === f && color ? { backgroundColor: color } : mapFilter === f ? { backgroundColor: '#1b232c' } : undefined}
                    >
                      {label} <span className={`ml-0.5 text-[10px] font-black ${mapFilter === f ? 'opacity-80' : 'text-charcoal-400'}`}>{count ?? '—'}</span>
                    </button>
                  );
                })}
              </div>

              {/* THE MAP — dominates the viewport (spec §1/§18) */}
              <div className="rounded-3xl overflow-hidden border border-charcoal-200 bg-white shadow-soft">
                <div ref={mapDiv} className="h-[360px] sm:h-[440px] lg:h-[560px] w-full z-0 relative" />
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-ivory-50 border-t border-charcoal-100">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-charcoal-500">
                    {(Object.entries(COLORS) as Array<[string, string]>).map(([k, c]) => (
                      <span key={k} className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: c }} />
                        {MAP_LAYERS[k]?.label ?? k}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={resetView}
                      className="inline-flex items-center gap-1 text-[11px] font-extrabold text-travion-700 hover:text-travion-800"
                      title="Reset the map to the whole destination"
                    >
                      <LocateFixed className="w-3.5 h-3.5" /> Reset view
                    </button>
                    <span className="inline-flex items-center gap-1 text-charcoal-400 font-medium text-[11px]">
                      {vpLoading ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-travion-500 animate-pulse inline-block" />
                          Loading places in view…
                        </>
                      ) : vpError ? (
                        <span className="text-amber-600 inline-flex items-center gap-1" title={vpError}><ShieldAlert className="w-3 h-3" /> {vpError}</span>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                          {viewportPlaces.length} live places in view · pan to explore
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* ══ RIGHT / BOTTOM: THE EXPLORATION PANEL ══ */}
            <div className="lg:w-[38%] lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1 lg:flex-none">

              {/* My Plan — the user's live selection. Every Add to Plan lands
                  here instantly (spec §11/§14); tapping a chip flies the map
                  back to that exact place (spec §11). */}
              <div className="mb-6 rounded-3xl border border-travion-100 bg-travion-50/40 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-charcoal-600">
                    <ClipboardList className="w-4 h-4 text-travion-600" /> My Plan
                  </h3>
                  <span className="text-[11px] font-bold text-charcoal-500">
                    {totalSelected > 0
                      ? `${selected.size} place${selected.size === 1 ? '' : 's'} · ${selectedFood.size} food stop${selectedFood.size === 1 ? '' : 's'}${selectedStay ? ' · stay selected' : ''}`
                      : 'Nothing selected yet — tap pins or cards to add'}
                  </span>
                </div>
                {totalSelected === 0 && !selectedStay ? (
                  <p className="text-[12px] font-medium text-charcoal-400">
                    Places, activities and food stops you add will appear here before your itinerary is organized.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(selected).map((name) => (
                      <button
                        key={`mp_${name}`}
                        type="button"
                        title="Show on map"
                        onClick={() => flyToByName(name)}
                        className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-white border border-travion-200 text-[11px] font-bold text-charcoal-700 hover:border-travion-400 transition-colors"
                      >
                        {name}
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`Remove ${name} from plan`}
                          onClick={(e) => { e.stopPropagation(); toggle(selected, setSelected, name); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); toggle(selected, setSelected, name); } }}
                          className="p-0.5 rounded-full text-charcoal-300 hover:text-red-500 hover:bg-red-50"
                        >
                          <X className="w-3 h-3" />
                        </span>
                      </button>
                    ))}
                    {Array.from(selectedFood).map((name) => (
                      <button
                        key={`mpf_${name}`}
                        type="button"
                        title="Show on map"
                        onClick={() => flyToByName(name)}
                        className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-white border border-orange-200 text-[11px] font-bold text-charcoal-700 hover:border-orange-400 transition-colors"
                      >
                        {name}
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`Remove ${name} from plan`}
                          onClick={(e) => { e.stopPropagation(); toggle(selectedFood, setSelectedFood, name); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); toggle(selectedFood, setSelectedFood, name); } }}
                          className="p-0.5 rounded-full text-charcoal-300 hover:text-red-500 hover:bg-red-50"
                        >
                          <X className="w-3 h-3" />
                        </span>
                      </button>
                    ))}
                    {selectedStay && (
                      <button
                        type="button"
                        title="Show on map"
                        onClick={() => flyToByName(selectedStay.name)}
                        className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-white border border-violet-200 text-[11px] font-bold text-charcoal-700 hover:border-violet-400 transition-colors"
                      >
                        {selectedStay.name}
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="Remove stay"
                          onClick={(e) => { e.stopPropagation(); setSelectedStay(null); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setSelectedStay(null); } }}
                          className="p-0.5 rounded-full text-charcoal-300 hover:text-red-500 hover:bg-red-50"
                        >
                          <X className="w-3 h-3" />
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Must visit — honest empty state. We search the whole destination, never a tiny circle */}
              {aiSource === 'llm' && places.length > 0 && (
                <p className="mb-3 rounded-xl bg-travion-50 border border-travion-200 px-4 py-2 text-[11.5px] font-bold text-travion-700">
                  Ordered for your group — dates, party, budget, interests and your chosen transport were all sent to the travel assistant.
                </p>
              )}
              <div className="mb-6">
                <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-charcoal-500 mb-3">
                  <Mountain className="w-4 h-4 text-travion-600" /> Must visit
                  <span className="text-charcoal-300">·</span>
                  <span className="text-[11px] font-bold text-emerald-600 normal-case">✓ verified real places</span>
                </h3>
                {places.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-charcoal-300 bg-ivory-50 px-5 py-6 text-center">
                    <p className="text-[13px] font-bold text-charcoal-600">
                      No verified places found for {catalog.destination} right now.
                    </p>
                    <p className="mt-1 text-[12px] font-medium text-charcoal-400">
                      We only show real, verified places — we never invent attractions. Check back later or try a nearby destination.
                    </p>
                  </div>
                ) : (
                <>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                    {visiblePlaces.map((place: CatalogPlace) => {
                      const active = selected.has(place.name);
                      const focused = highlight?.name === place.name;
                      const displayName = place.name;
                      const onFly = () => {
                        const hit = allMapPlaces.find(({ item }) => item.name === place.name);
                        if (hit) flyToPlace(hit.key, hit.item);
                      };
                      return (
                        <div
                          key={`${place.id ?? place.name}_${place.category}`}
                          ref={setCardRef('must_visit', place.name)}
                          className={`p-4 rounded-2xl border transition-all ${
                            active
                              ? 'bg-travion-50 border-travion-400 ring-2 ring-travion-100'
                              : focused
                                ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-100'
                                : 'bg-white border-charcoal-200 hover:border-travion-200'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={onFly}
                            className="w-full flex items-start justify-between gap-2 text-left"
                            title={`Show ${place.name} on the map`}
                            aria-label={`Show ${place.name} on the map`}
                          >
                            <div className="min-w-0">
                              <p className="text-[13.5px] font-extrabold text-charcoal-900 leading-snug">{place.name}</p>
                              {place.description && (
                                <p className="mt-1 text-[11px] font-medium text-charcoal-500 line-clamp-2">{place.description}</p>
                              )}
                              <AiPickNote cat="must_visit" name={place.name} />
                              <div className="mt-2 flex items-center gap-2 text-[10.5px] font-bold text-charcoal-400">
                                <span className="text-travion-600">{placementLabel(place.placement, place.distance_km)}</span>
                                {(place.entry_fee ?? 0) > 0 ? <span>· ₹{place.entry_fee} entry</span> : <span className="text-emerald-600">· Free</span>}
                                {place.rating != null && <span>· ★ {Number(place.rating).toFixed(1)}</span>}
                              </div>
                            </div>
                            <MapPin className={`w-4 h-4 shrink-0 ${focused ? 'text-amber-500' : 'text-charcoal-300'}`} />
                          </button>
                          <div className="mt-2.5 flex items-center justify-between gap-2">
                            <button
                            type="button"
                            onClick={onFly}
                            title={`Open ${displayName} on the map`}
                            aria-label={`Open ${displayName} on the map`}
                            className="inline-flex items-center gap-1 text-[10.5px] font-extrabold text-travion-700 hover:text-travion-900 hover:underline"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" /> Open on map
                          </button>
                            <button
                              type="button"
                              onClick={() => toggle(selected, setSelected, place.name)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-wide transition-colors ${
                                active ? 'bg-travion-600 text-white' : 'bg-travion-50 text-travion-700 hover:bg-travion-100'
                              }`}
                            >
                              {active ? (
                                <>
                                  <svg viewBox="0 0 12 12" className="w-3 h-3"><path fill="currentColor" d="M4.6 8.4L2.3 6.1l.9-.9 1.4 1.4 3.2-3.2.9.9z" /></svg>
                                  Added
                                </>
                              ) : '+ Add to Plan'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {places.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setShowAll((s) => !s)}
                      className="mt-3 text-[12px] font-extrabold text-travion-700 hover:text-travion-800"
                    >
                      {showAll ? 'Show fewer' : `Show all ${Math.min(places.length, MAX_CANDIDATES_PER_CATEGORY)} verified places`}
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
              <div className="mb-6">
                <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-charcoal-500 mb-3">
                  <Camera className="w-4 h-4 text-travion-600" /> Best tourist spots
                  <span className="text-charcoal-300">·</span>
                  <span className="text-[11px] font-bold text-emerald-600 normal-case">most popular attractions in {destinationName}</span>
                </h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                  {touristSpots.slice(0, MAX_CANDIDATES_PER_CATEGORY).map((spot: CatalogPlace) => {
                    const active = selected.has(spot.name);
                    const focused = highlight?.name === spot.name;
                    const displayName = spot.name;
                    const onFly = () => {
                      const hit = allMapPlaces.find(({ item }) => item.name === spot.name);
                      if (hit) flyToPlace(hit.key, hit.item);
                    };
                    return (
                      <div
                        key={`spot_${spot.id ?? spot.name}`}
                        ref={setCardRef('must_visit', spot.name)}
                        className={`p-4 rounded-2xl border transition-all ${
                          active
                            ? 'bg-travion-50 border-travion-400 ring-2 ring-travion-100'
                            : focused
                              ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-100'
                              : 'bg-white border-charcoal-200 hover:border-travion-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={onFly}
                          className="w-full flex items-start justify-between gap-2 text-left"
                          title={`Show ${spot.name} on the map`}
                          aria-label={`Show ${spot.name} on the map`}
                        >
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-extrabold text-charcoal-900 leading-snug">{spot.name}</p>
                            {spot.description && (
                              <p className="mt-1 text-[11px] font-medium text-charcoal-500 line-clamp-2">{spot.description}</p>
                            )}
                            <div className="mt-2 flex items-center gap-2 text-[10.5px] font-bold text-charcoal-400">
                              <span className="text-travion-600">{placementLabel(spot.placement, spot.distance_km)}</span>
                              {(spot.entry_fee ?? 0) > 0 ? <span>· ₹{spot.entry_fee} entry</span> : <span className="text-emerald-600">· Free</span>}
                              {spot.rating != null && <span>· ★ {Number(spot.rating).toFixed(1)}</span>}
                            </div>
                          </div>
                          <MapPin className={`w-4 h-4 shrink-0 ${focused ? 'text-amber-500' : 'text-charcoal-300'}`} />
                        </button>
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={onFly}
                            title={`Open ${displayName} on the map`}
                            aria-label={`Open ${displayName} on the map`}
                            className="inline-flex items-center gap-1 text-[10.5px] font-extrabold text-travion-700 hover:text-travion-900 hover:underline"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" /> Open on map
                          </button>
                          <button
                            type="button"
                            onClick={() => toggle(selected, setSelected, spot.name)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-wide transition-colors ${
                              active ? 'bg-travion-600 text-white' : 'bg-travion-50 text-travion-700 hover:bg-travion-100'
                            }`}
                          >
                            {active ? (
                              <>
                                <svg viewBox="0 0 12 12" className="w-3 h-3"><path fill="currentColor" d="M4.6 8.4L2.3 6.1l.9-.9 1.4 1.4 3.2-3.2.9.9z" /></svg>
                                Added
                              </>
                            ) : '+ Add to Plan'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Activities to do — THINGS THE USER CAN DO, never place names
                  (spec §5). Each card shows the ACTION, the real LOCATION where
                  it happens, and the recommended time of day. Tapping the card
                  flies the map to the activity's exact real location (§8). */}
              {activities.length > 0 && (
              <div className="mb-6">
                <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-charcoal-500 mb-3">
                  <Compass className="w-4 h-4 text-travion-600" /> Activities to do
                  <span className="text-charcoal-300">·</span>
                  <span className="text-[11px] font-bold text-emerald-600 normal-case">real experiences at real places</span>
                </h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                  {activities.slice(0, MAX_CANDIDATES_PER_CATEGORY).map((activity: CatalogActivity) => {
                    const active = selected.has(activity.name);
                    const focused = highlight?.name === activity.location_name;
                    const displayName = activity.location_name || activity.name;
                    const onFly = () => {
                      if (activity.latitude && activity.longitude) {
                        flyToPlace('activities', {
                          name: activity.location_name || activity.name,
                          category: 'activities',
                          latitude: activity.latitude,
                          longitude: activity.longitude,
                          address: activity.description ?? null,
                          source: activity.source || 'derived',
                          verified: true,
                        });
                      }
                    };
                    return (
                      <div
                        key={`act_${activity.id ?? activity.name}`}
                        ref={setCardRef('activities', activity.name)}
                        className={`p-4 rounded-2xl border transition-all ${
                          active
                            ? 'bg-travion-50 border-travion-400 ring-2 ring-travion-100'
                            : focused
                              ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-100'
                              : 'bg-white border-charcoal-200 hover:border-travion-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={onFly}
                          className="w-full flex items-start justify-between gap-2 text-left"
                          title={`Show ${activity.location_name} on the map`}
                          aria-label={`Show ${activity.location_name} on the map`}
                        >
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-extrabold text-charcoal-900 leading-snug">{activity.action}</p>
                            {activity.description && (
                              <p className="mt-1 text-[11px] font-medium text-charcoal-500 line-clamp-2">{activity.description}</p>
                            )}
                            <AiPickNote cat="activities" name={(activity as CatalogActivity).name ?? activity.action} />
                            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] font-bold text-charcoal-400">
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
                          <MapPin className={`w-4 h-4 shrink-0 ${focused ? 'text-amber-500' : 'text-charcoal-300'}`} />
                        </button>
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={onFly}
                            title={`Open ${displayName} on the map`}
                            aria-label={`Open ${displayName} on the map`}
                            className="inline-flex items-center gap-1 text-[10.5px] font-extrabold text-travion-700 hover:text-travion-900 hover:underline"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" /> Open on map
                          </button>
                          <button
                            type="button"
                            onClick={() => toggle(selected, setSelected, activity.name)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-wide transition-colors ${
                              active ? 'bg-travion-600 text-white' : 'bg-travion-50 text-travion-700 hover:bg-travion-100'
                            }`}
                          >
                            {active ? (
                              <>
                                <svg viewBox="0 0 12 12" className="w-3 h-3"><path fill="currentColor" d="M4.6 8.4L2.3 6.1l.9-.9 1.4 1.4 3.2-3.2.9.9z" /></svg>
                                Added
                              </>
                            ) : '+ Add Activity'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Live events around the travel dates — only real provider-backed
                  listings; the section disappears entirely when there are none. */}
              {events.length > 0 && (
              <div className="mb-6">
                <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-charcoal-500 mb-3">
                  <CalendarDays className="w-4 h-4 text-travion-600" /> Live during your dates
                  <span className="text-charcoal-300">·</span>
                  <span className="text-[11px] font-bold text-charcoal-400 normal-case">tap to add to your trip</span>
                </h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
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
                            : 'bg-white border-charcoal-200 hover:border-travion-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-extrabold text-charcoal-900 leading-snug">{ev.name}</p>
                            {ev.venue && (
                              <p className="mt-0.5 text-[11px] font-medium text-charcoal-500 flex items-center gap-1">
                                <MapPin className="w-3 h-3" /> {ev.venue}
                              </p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] font-bold text-charcoal-400">
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
                            active ? 'bg-travion-600 border-travion-600' : 'border-charcoal-300 bg-white'
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
              <div className="mb-6">
                <h3 className="flex items-center gap-2 text-[13px] font-black uppercase tracking-wider text-charcoal-500 mb-3">
                  <Utensils className="w-4 h-4 text-travion-600" /> Where to eat
                </h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                  {orderByRank(catalog.food, 'restaurants', (f: CatalogFood) => f.name, ['cafes']).slice(0, MAX_CANDIDATES_PER_CATEGORY).map((food: CatalogFood) => {
                    const active = selectedFood.has(food.name);
                    const focused = highlight?.name === food.name;
                    const displayName = food.name;
                    const onFly = () => {
                      const hit = allMapPlaces.find(({ item }) => item.name === food.name);
                      if (hit) flyToPlace(hit.key, hit.item);
                    };
                    return (
                      <div
                        key={food.id ?? food.name}
                        ref={setCardRef('food', food.name)}
                        className={`p-4 rounded-2xl border transition-all ${
                          active
                            ? 'bg-orange-50 border-orange-300 ring-2 ring-orange-100'
                            : focused
                              ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-100'
                              : 'bg-white border-charcoal-200 hover:border-orange-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={onFly}
                          className="w-full flex items-start justify-between gap-2 text-left"
                          title={`Show ${food.name} on the map`}
                          aria-label={`Show ${food.name} on the map`}
                        >
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-extrabold text-charcoal-900 leading-snug">{food.name}</p>
                            <p className="mt-0.5 text-[11px] font-medium text-charcoal-500 truncate">{food.cuisine}</p>
                            <AiPickNote cat="restaurants" name={food.name} extraCats={['cafes']} />
                            {/* No prices at selection — food is priced in the
                                budget stage (spec §9); cards show cuisine,
                                rating and verified status only. */}
                            <div className="mt-2 flex items-center gap-2 text-[10.5px] font-bold text-charcoal-400">
                              {food.rating != null && <span>★ {Number(food.rating).toFixed(1)}</span>}
                              <span className="inline-flex items-center gap-0.5 text-emerald-600"><BadgeCheck className="w-3 h-3" /> Verified</span>
                            </div>
                          </div>
                          <MapPin className={`w-4 h-4 shrink-0 ${focused ? 'text-amber-500' : 'text-charcoal-300'}`} />
                        </button>
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={onFly}
                            title={`Open ${displayName} on the map`}
                            aria-label={`Open ${displayName} on the map`}
                            className="inline-flex items-center gap-1 text-[10.5px] font-extrabold text-travion-700 hover:text-travion-900 hover:underline"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" /> Open on map
                          </button>
                          <button
                            type="button"
                            onClick={() => toggle(selectedFood, setSelectedFood, food.name)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-wide transition-colors ${
                              active ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                            }`}
                          >
                            {active ? (
                              <>
                                <svg viewBox="0 0 12 12" className="w-3 h-3"><path fill="currentColor" d="M4.6 8.4L2.3 6.1l.9-.9 1.4 1.4 3.2-3.2.9.9z" /></svg>
                                Added
                              </>
                            ) : '+ Add to Plan'}
                          </button>
                        </div>
                      </div>
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
              {totalSelected > 0 && (
                <div className="mb-3 rounded-2xl border border-charcoal-200 bg-ivory-50 px-4 py-2.5 flex items-center justify-between gap-3 text-[12px] font-bold text-charcoal-600">
                  <span className="text-charcoal-500">
                    Estimated entry fees so far
                  </span>
                  <span className="text-travion-700">
                    ₹{selectedEntryFees.toLocaleString('en-IN')} entry fees
                  </span>
                </div>
              )}

              {/* Sticky action bar (inside the scrollable panel on desktop) */}
              <div className="sticky bottom-4 z-10">
                {stayRequiredNote && (
                  <div className="mb-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[12.5px] font-bold text-amber-700">
                    {stayRequiredNote}
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 rounded-3xl bg-white border border-charcoal-200 shadow-floating px-5 py-4">
                  <button type="button" onClick={onBack} className="text-[13px] font-bold text-charcoal-500 hover:text-charcoal-700">
                    Back
                  </button>
                  {!hasNothing && (
                    <button
                      type="button"
                      disabled={busy || saving || !!budgetTier?.impossible}
                      onClick={handleConfirm}
                      className="inline-flex items-center gap-2 h-12 px-7 rounded-2xl bg-travion-600 hover:bg-travion-700 disabled:bg-sand-200 disabled:text-charcoal-400 text-white text-sm font-extrabold transition-colors"
                    >
                      {budgetTier?.impossible ? 'Budget too low for plans'
                        : (busy || saving) ? 'Saving selections…' : 'Continue to Choose Stay'}
                      {!(busy || saving) && !budgetTier?.impossible && <ArrowRight className="w-4 h-4" />}
                    </button>
                  )}
                  {hasNothing && (
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-2 h-12 px-7 rounded-2xl bg-sand-200 text-charcoal-400 text-sm font-extrabold cursor-not-allowed"
                    >
                      No verified places to add yet
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Map pin popup: place details + explicit Add to Plan (spec §9/§10) ── */}
      <AnimatePresence>
        {popupPlace && (() => {
          const p = popupPlace.item;
          const kind = MAP_LAYERS[popupPlace.key]?.kind ?? 'place';
          // Healthcare + educational pins are VIEW-ONLY: reference information
          // for the traveller, never part of the plan — no select button.
          const viewOnly = popupPlace.key === 'healthcare' || popupPlace.key === 'education';
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
                className="w-full max-w-md bg-white rounded-3xl shadow-floating border border-charcoal-200 overflow-hidden"
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
                    <h3 className="mt-1.5 text-lg font-extrabold text-charcoal-900 leading-snug">{p.name}</h3>
                    {(p as MapPlace).address && (
                      <p className="mt-0.5 text-[11.5px] font-medium text-charcoal-500 line-clamp-2">{(p as MapPlace).address}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPopupPlace(null)}
                    className="p-2 rounded-xl text-charcoal-400 hover:text-charcoal-700 hover:bg-sand-100 shrink-0"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="px-5 pb-5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-charcoal-500">
                    {(p as MapPlace).rating != null && <span>★ {Number((p as MapPlace).rating).toFixed(1)}</span>}
                    {(p as MapPlace).opening_hours && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {(p as MapPlace).opening_hours}</span>}
                    {p.distance_km != null && <span>{p.distance_km} km from centre</span>}
                    <span className="text-travion-600">{placementLabel(p.placement, p.distance_km)}</span>
                    <span className="inline-flex items-center gap-0.5 text-emerald-600"><BadgeCheck className="w-3 h-3" /> Verified place data</span>
                  </div>
                  {viewOnly ? (
                    <p className="mt-4 w-full rounded-2xl bg-ivory-50 border border-charcoal-200 px-4 py-3 text-[12px] font-bold text-charcoal-500 text-center">
                      Reference only — {MAP_LAYERS[popupPlace.key]?.label ?? 'this place'} is shown for information and can't be added to your plan.
                    </p>
                  ) : kind === 'stay' ? (
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
