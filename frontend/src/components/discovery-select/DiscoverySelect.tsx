import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  BadgeCheck,
  MapPin,
  Utensils,
  Mountain,
  Compass,
  ArrowRight,
  ArrowLeft,
  Search,
  Check,
  Plus,
  RefreshCw,
  AlertCircle,
  Map as MapIcon,
  LayoutGrid,
  Clock,
  Sparkles,
  Star,
  Landmark,
  Ticket,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  DestinationCatalog,
  SelectedPlaceItem,
  SelectedFoodItem,
  SelectedStay,
} from '../../types';
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
    activityCount: number,
  ) => void;
  onBack: () => void;
  busy?: boolean;
}

type TabCategory = 'all' | 'must_visit' | 'activities' | 'tourist_spots' | 'food';

function getCategoryTheme(item: { kind: 'place' | 'activity' | 'food'; category: string }) {
  const cat = (item.category || '').toLowerCase();
  if (item.kind === 'food' || cat.includes('food') || cat.includes('rest') || cat.includes('cafe') || cat.includes('dining')) {
    return {
      bgGradient: 'from-rose-50 via-pink-50/70 to-amber-50/60',
      borderColor: 'border-pink-200/80',
      iconBg: 'bg-pink-100 text-pink-700',
      badgeBg: 'bg-rose-50 text-rose-700 border-rose-200',
      Icon: Utensils,
      typeLabel: 'Culinary & Dining',
    };
  }
  if (item.kind === 'activity' || cat.includes('activ') || cat.includes('trail') || cat.includes('trek')) {
    return {
      bgGradient: 'from-sky-50 via-pink-50/50 to-indigo-50/60',
      borderColor: 'border-sky-200/80',
      iconBg: 'bg-sky-100 text-sky-700',
      badgeBg: 'bg-sky-50 text-sky-700 border-sky-200',
      Icon: Compass,
      typeLabel: 'Verified Activity',
    };
  }
  if (cat.includes('nature') || cat.includes('park') || cat.includes('lake') || cat.includes('waterfall') || cat.includes('hill')) {
    return {
      bgGradient: 'from-emerald-50 via-teal-50/60 to-sky-50/70',
      borderColor: 'border-emerald-200/80',
      iconBg: 'bg-emerald-100 text-emerald-700',
      badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      Icon: Mountain,
      typeLabel: 'Scenic Nature',
    };
  }
  return {
    bgGradient: 'from-sky-50 via-amber-50/40 to-pink-50/50',
    borderColor: 'border-amber-200/70',
    iconBg: 'bg-amber-100 text-amber-800',
    badgeBg: 'bg-amber-50 text-amber-800 border-amber-200',
    Icon: Landmark,
    typeLabel: 'Heritage & Landmark',
  };
}

export const DiscoverySelect: React.FC<DiscoverySelectProps> = ({
  tripId,
  destinationName,
  onConfirm,
  onBack,
  busy = false,
}) => {
  const [catalog, setCatalog] = useState<DestinationCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabCategory>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Selected Place and Food Sets (by name)
  const [selectedPlaces, setSelectedPlaces] = useState<Set<string>>(new Set());
  const [selectedFoods, setSelectedFoods] = useState<Set<string>>(new Set());

  // Full item dictionary for payload conversion
  const [placeItemsMap, setPlaceItemsMap] = useState<Map<string, SelectedPlaceItem>>(new Map());
  const [foodItemsMap, setFoodItemsMap] = useState<Map<string, SelectedFoodItem>>(new Map());

  // Leaflet map reference
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.FeatureGroup | null>(null);

  const fetchCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDestinationCatalog(tripId);
      setCatalog(data);

      const pMap = new Map<string, SelectedPlaceItem>();
      const fMap = new Map<string, SelectedFoodItem>();
      const initialSelected = new Set<string>();

      (data.must_visit || []).forEach((p) => {
        pMap.set(p.name, {
          id: p.id || null,
          name: p.name,
          latitude: p.latitude || null,
          longitude: p.longitude || null,
          distance_km: p.distance_km || null,
          placement: p.placement || 'inside',
          entry_fee: p.entry_fee || null,
          duration_minutes: p.duration_minutes || null,
          rating: p.rating || null,
          source: p.source || 'verified_catalog',
        });
        if (p.recommended) initialSelected.add(p.name);
      });

      (data.tourist_spots || []).forEach((p) => {
        if (!pMap.has(p.name)) {
          pMap.set(p.name, {
            id: p.id || null,
            name: p.name,
            latitude: p.latitude || null,
            longitude: p.longitude || null,
            distance_km: p.distance_km || null,
            placement: p.placement || 'inside',
            entry_fee: p.entry_fee || null,
            duration_minutes: p.duration_minutes || null,
            rating: p.rating || null,
            source: p.source || 'verified_catalog',
          });
        }
      });

      (data.activities || []).forEach((a) => {
        if (!pMap.has(a.name)) {
          pMap.set(a.name, {
            id: a.id || null,
            name: a.name,
            latitude: a.latitude || null,
            longitude: a.longitude || null,
            distance_km: null,
            placement: 'inside',
            entry_fee: a.entry_fee || null,
            duration_minutes: a.duration_minutes || null,
            rating: a.rating || null,
            source: a.source || 'activity_catalog',
          });
          if (a.recommended) initialSelected.add(a.name);
        }
      });

      (data.food || []).forEach((f) => {
        fMap.set(f.name, {
          id: f.id || null,
          name: f.name,
          latitude: f.latitude || null,
          longitude: f.longitude || null,
          distance_km: null,
          avg_cost_for_two: f.avg_cost_for_two || null,
          cuisine: f.cuisine || null,
          rating: f.rating || null,
          source: f.source || 'food_catalog',
        });
      });

      setPlaceItemsMap(pMap);
      setFoodItemsMap(fMap);

      // Pre-select recommended highlights (or at least first 2)
      if (initialSelected.size === 0 && pMap.size > 0) {
        const firstTwo = Array.from(pMap.keys()).slice(0, 2);
        firstTwo.forEach((name) => initialSelected.add(name));
      }
      setSelectedPlaces(initialSelected);
    } catch (err: any) {
      console.error('Failed to load destination catalog:', err);
      setError(err?.message || 'Could not fetch catalog for this destination.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, [tripId]);

  const togglePlace = (name: string) => {
    setSelectedPlaces((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const toggleFood = (name: string) => {
    setSelectedFoods((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const allItems = useMemo(() => {
    if (!catalog) return [];
    const list: Array<{
      id: string;
      name: string;
      category: string;
      kind: 'place' | 'activity' | 'food';
      description?: string;
      rating?: number | null;
      duration?: number | null;
      price?: number | null;
      verified: boolean;
      recommended?: boolean;
      latitude?: number | null;
      longitude?: number | null;
    }> = [];

    (catalog.must_visit || []).forEach((p, idx) => {
      list.push({
        id: p.id || `must-${idx}`,
        name: p.name,
        category: p.category || 'Must Visit',
        kind: 'place',
        description: p.description || `${p.name} is a key highlight in ${destinationName}.`,
        rating: p.rating || 4.7,
        duration: p.duration_minutes || 90,
        price: p.entry_fee || 0,
        verified: true,
        recommended: p.recommended,
        latitude: p.latitude,
        longitude: p.longitude,
      });
    });

    (catalog.tourist_spots || []).forEach((p, idx) => {
      if (!list.some((item) => item.name === p.name)) {
        list.push({
          id: p.id || `tourist-${idx}`,
          name: p.name,
          category: p.category || 'Attraction',
          kind: 'place',
          description: p.description || `Famous sightseeing point in ${destinationName}.`,
          rating: p.rating || 4.5,
          duration: p.duration_minutes || 60,
          price: p.entry_fee || 0,
          verified: true,
          latitude: p.latitude,
          longitude: p.longitude,
        });
      }
    });

    (catalog.activities || []).forEach((a, idx) => {
      if (!list.some((item) => item.name === a.name)) {
        list.push({
          id: a.id || `act-${idx}`,
          name: a.name,
          category: a.category || 'Experience',
          kind: 'activity',
          description: a.description || `Unique activity located at ${a.location_name || destinationName}.`,
          rating: a.rating || 4.8,
          duration: a.duration_minutes || 120,
          price: a.entry_fee || 0,
          verified: true,
          recommended: a.recommended,
          latitude: a.latitude,
          longitude: a.longitude,
        });
      }
    });

    (catalog.food || []).forEach((f, idx) => {
      list.push({
        id: f.id || `food-${idx}`,
        name: f.name,
        category: f.cuisine || 'Local Dining',
        kind: 'food',
        description: f.must_try ? `Must-try specialty: ${f.must_try}` : `${f.name} offers authentic cuisine in ${destinationName}.`,
        rating: f.rating || 4.4,
        duration: 45,
        price: f.avg_cost_for_two || 500,
        verified: true,
        latitude: f.latitude,
        longitude: f.longitude,
      });
    });

    return list;
  }, [catalog, destinationName]);

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          item.name.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          (item.description && item.description.toLowerCase().includes(q));
        if (!match) return false;
      }
      if (activeTab === 'all') return true;
      if (activeTab === 'must_visit') {
        return (
          item.category.toLowerCase().includes('must') ||
          item.category.toLowerCase().includes('highlight') ||
          Boolean(item.recommended)
        );
      }
      if (activeTab === 'tourist_spots') return item.kind === 'place';
      if (activeTab === 'activities') return item.kind === 'activity';
      if (activeTab === 'food') return item.kind === 'food';
      return true;
    });
  }, [allItems, searchQuery, activeTab]);

  // Leaflet map initialization
  useEffect(() => {
    if (viewMode !== 'map' || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [17.385, 78.4867],
        zoom: 12,
        zoomControl: false,
      });

      L.control.zoom({ position: 'topright' }).addTo(map);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        maxZoom: 19,
      }).addTo(map);

      markersRef.current = L.featureGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    // Refresh markers
    if (markersRef.current && mapInstanceRef.current) {
      markersRef.current.clearLayers();
      const bounds = L.latLngBounds([]);

      allItems.forEach((item) => {
        if (item.latitude && item.longitude) {
          const isSelected = item.kind === 'food' ? selectedFoods.has(item.name) : selectedPlaces.has(item.name);

          const iconHtml = `
            <div style="
              width: 32px;
              height: 32px;
              background-color: ${isSelected ? '#0284c7' : '#ffffff'};
              border: 2px solid ${isSelected ? '#ffffff' : '#64748b'};
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              color: ${isSelected ? '#ffffff' : '#0f172a'};
              box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
              cursor: pointer;
            ">
              <span style="font-size: 14px; font-weight: bold;">
                ${isSelected ? '✓' : '•'}
              </span>
            </div>
          `;

          const customIcon = L.divIcon({
            html: iconHtml,
            className: 'custom-map-pin',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          });

          const marker = L.marker([item.latitude, item.longitude], { icon: customIcon });

          marker.bindTooltip(`<strong>${item.name}</strong><br/>${item.category}`, {
            direction: 'top',
            offset: [0, -16],
          });

          marker.on('click', () => {
            if (item.kind === 'food') toggleFood(item.name);
            else togglePlace(item.name);
          });

          markersRef.current?.addLayer(marker);
          bounds.extend([item.latitude, item.longitude]);
        }
      });

      if (bounds.isValid()) {
        mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
    }
  }, [viewMode, allItems, selectedPlaces, selectedFoods, catalog]);

  const handleContinue = async () => {
    if (selectedPlaces.size === 0) {
      setError('Please select at least one attraction or place to visit.');
      return;
    }

    const placesList = Array.from(selectedPlaces);
    const foodsList = Array.from(selectedFoods);

    const placeItems: SelectedPlaceItem[] = placesList
      .map((name) => placeItemsMap.get(name))
      .filter((item): item is SelectedPlaceItem => !!item);

    const foodItems: SelectedFoodItem[] = foodsList
      .map((name) => foodItemsMap.get(name))
      .filter((item): item is SelectedFoodItem => !!item);

    const activityCount = allItems.filter(
      (item) => item.kind === 'activity' && selectedPlaces.has(item.name)
    ).length;

    setIsSubmitting(true);
    setError(null);

    // Sync selections directly into backend single source of truth
    const itemsToSync: any[] = [
      ...placeItems.map((p) => ({
        provider_place_id: p.id || `place_${encodeURIComponent(p.name)}`,
        name: p.name,
        category: 'must_visit',
        latitude: p.latitude ?? undefined,
        longitude: p.longitude ?? undefined,
        entry_fee: p.entry_fee ?? undefined,
        price: p.entry_fee ?? 0,
        selection_source: 'catalog',
      })),
      ...foodItems.map((f) => ({
        provider_place_id: f.id || `food_${encodeURIComponent(f.name)}`,
        name: f.name,
        category: 'restaurants',
        latitude: f.latitude ?? undefined,
        longitude: f.longitude ?? undefined,
        avg_cost_for_two: f.avg_cost_for_two ?? undefined,
        price: f.avg_cost_for_two ?? 0,
        selection_source: 'catalog',
      })),
    ];

    try {
      if (itemsToSync.length > 0) {
        await api.syncTripSelections(tripId, itemsToSync, true);
      }
    } catch (err: any) {
      console.warn('Sync selections warning:', err);
    } finally {
      setIsSubmitting(false);
    }

    onConfirm(placesList, foodsList, placeItems, foodItems, null, true, activityCount);
  };

  const totalSelectedCount = selectedPlaces.size + selectedFoods.size;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-50 border border-sky-200 text-sky-800 text-xs font-black uppercase tracking-wider mb-2">
          <Compass className="w-3.5 h-3.5 text-sky-600" />
          Step 4 · Discover & Curate
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
          What would you like to experience in {destinationName}?
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 max-w-xl mx-auto">
          Explore genuine attractions, heritage monuments, scenic nature spots, and authentic culinary dining with zero image bloat.
        </p>
      </div>

      {/* Search & Mode Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-6">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search places in ${destinationName}…`}
            className="w-full h-11 pl-10 pr-4 rounded-2xl border border-slate-200 bg-white text-xs font-semibold placeholder:text-slate-400 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all"
          />
        </div>

        {/* View Switcher: Grid vs Map */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              viewMode === 'grid'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Grid View</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('map')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              viewMode === 'map'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span>Interactive Map</span>
          </button>
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2 scrollbar-none">
        {[
          { id: 'all', label: 'All Highlights', count: allItems.length },
          {
            id: 'must_visit',
            label: 'Must Visit',
            count: allItems.filter((i) => String(i.category || '').toLowerCase().includes('must') || Boolean(i.recommended)).length,
          },
          {
            id: 'tourist_spots',
            label: 'Sightseeing',
            count: allItems.filter((i) => i.kind === 'place').length,
          },
          {
            id: 'activities',
            label: 'Activities',
            count: allItems.filter((i) => i.kind === 'activity').length,
          },
          {
            id: 'food',
            label: 'Dining & Cafés',
            count: allItems.filter((i) => i.kind === 'food').length,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as TabCategory)}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-sky-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-sky-300'
            }`}
          >
            {tab.label} <span className="opacity-75">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm font-semibold text-red-700">{error}</div>
          <button
            type="button"
            onClick={fetchCatalog}
            className="px-3 py-1 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-20 text-center">
          <RefreshCw className="w-8 h-8 text-sky-600 animate-spin mx-auto mb-4" />
          <p className="text-sm font-bold text-slate-600">
            Gathering verified locations and experiences in {destinationName}…
          </p>
        </div>
      )}

      {/* Interactive Map View */}
      {viewMode === 'map' && !loading && (
        <div className="mb-24 rounded-3xl overflow-hidden border border-slate-200 shadow-soft bg-white">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <span className="font-bold flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-sky-600" />
              Click any pin on the map to add/remove it from your itinerary
            </span>
            <span className="font-semibold text-emerald-700">● Blue: In your plan</span>
          </div>
          <div ref={mapContainerRef} className="w-full h-[520px]" />
        </div>
      )}

      {/* Grid View: Pure CSS High-End Gradient Cards (ZERO IMAGES) */}
      {viewMode === 'grid' && !loading && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-28">
          {filteredItems.map((item) => {
            const isSelected = item.kind === 'food' ? selectedFoods.has(item.name) : selectedPlaces.has(item.name);
            const theme = getCategoryTheme(item);
            const CategoryIcon = theme.Icon;

            return (
              <motion.div
                key={item.id}
                whileHover={{ y: -3 }}
                transition={{ duration: 0.2 }}
                onClick={() => {
                  if (item.kind === 'food') toggleFood(item.name);
                  else togglePlace(item.name);
                }}
                className={`cursor-pointer rounded-3xl border overflow-hidden transition-all flex flex-col ${
                  isSelected
                    ? 'border-sky-500 ring-2 ring-sky-400 bg-sky-50/20 shadow-md'
                    : 'border-slate-200 bg-white hover:border-sky-300 hover:shadow-sm'
                }`}
              >
                {/* Visual Header Banner - Pure CSS Palette Art */}
                <div className={`p-4 bg-gradient-to-br ${theme.bgGradient} border-b ${theme.borderColor} relative`}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-1.5">
                      <div className={`p-1.5 rounded-xl ${theme.iconBg} shadow-xs`}>
                        <CategoryIcon className="w-4 h-4" />
                      </div>
                      <span className={`text-[11px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border ${theme.badgeBg}`}>
                        {item.category}
                      </span>
                    </div>

                    {/* Checkbox badge */}
                    <div
                      className={`w-7 h-7 rounded-xl flex items-center justify-center transition-all ${
                        isSelected
                          ? 'bg-sky-600 text-white shadow-sm'
                          : 'bg-white border border-slate-300 text-slate-400'
                      }`}
                    >
                      {isSelected ? <Check className="w-4 h-4 stroke-[2.5]" /> : <Plus className="w-4 h-4" />}
                    </div>
                  </div>

                  <h3 className="text-base font-black text-slate-900 leading-snug line-clamp-1">
                    {item.name}
                  </h3>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-600 font-semibold">
                    <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                      <BadgeCheck className="w-3.5 h-3.5 text-emerald-600" /> Verified Place
                    </span>
                    <span className="flex items-center gap-1 font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/60">
                      <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                      {Number(item.rating || 4.7).toFixed(1)}
                    </span>
                  </div>
                </div>

                {/* Details Body */}
                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {item.description}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3 text-[11.5px] text-slate-600 font-semibold">
                      {item.duration ? (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {item.duration} min
                        </span>
                      ) : null}
                      <span className="flex items-center gap-1 text-slate-800 font-bold">
                        <Ticket className="w-3.5 h-3.5 text-sky-600" />
                        {item.price && item.price > 0
                          ? item.kind === 'food'
                            ? `₹${item.price} avg for two`
                            : `₹${item.price} entry`
                          : 'Free entry'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.kind === 'food') toggleFood(item.name);
                        else togglePlace(item.name);
                      }}
                      className={`h-8 px-3 rounded-xl font-bold text-xs flex items-center gap-1 transition-all ${
                        isSelected
                          ? 'bg-sky-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-sky-50 hover:text-sky-700'
                      }`}
                    >
                      {isSelected ? (
                        <>
                          <Check className="w-3 h-3" /> Added
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" /> Select
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Floating Tray Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 py-4 px-6 shadow-floating">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-4 h-11 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Transport
          </button>

          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs font-black text-slate-900">
              {totalSelectedCount} {totalSelectedCount === 1 ? 'place' : 'places'} selected
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs font-semibold text-slate-500">
              {selectedPlaces.size} attractions, {selectedFoods.size} dining spots
            </span>
          </div>

          <button
            type="button"
            disabled={selectedPlaces.size === 0 || busy || isSubmitting}
            onClick={handleContinue}
            className="inline-flex items-center gap-2 px-6 h-11 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white text-xs font-black uppercase tracking-wider transition-colors shadow-sm"
          >
            {busy || isSubmitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Saving Choices…
              </>
            ) : (
              <>
                Continue to Stay Selection <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
