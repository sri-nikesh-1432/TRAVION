import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  DestinationCatalog,
  CatalogPlace,
  CatalogFood,
  CatalogActivity,
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

const KNOWN_LANDMARK_IMAGES: Record<string, string> = {
  // Hyderabad
  'charminar': 'https://images.unsplash.com/photo-1572445271230-a78b5944a659?auto=format&fit=crop&w=800&q=80',
  'golconda': 'https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=800&q=80',
  'salar jung': 'https://images.unsplash.com/photo-1582510003544-4d00b7f74220?auto=format&fit=crop&w=800&q=80',
  'chowmahalla': 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=800&q=80',
  'qutb shahi': 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=800&q=80',
  'birla mandir': 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=800&q=80',
  'ramoji': 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=800&q=80',
  'hussain sagar': 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
  'lumbini': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
  'nehru zoological': 'https://images.unsplash.com/photo-1534567153574-2b12153a87f0?auto=format&fit=crop&w=800&q=80',
  'laad bazaar': 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80',
  'taramati': 'https://images.unsplash.com/photo-1589182373726-e4f658ab50f0?auto=format&fit=crop&w=800&q=80',
  'durgam cheruvu': 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=800&q=80',
  'paradise biryani': 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=800&q=80',
  'bawarchi': 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=800&q=80',
  'shadab': 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
  'chutneys': 'https://images.unsplash.com/photo-1610192244261-3f33de3f55e4?auto=format&fit=crop&w=800&q=80',
  // Bangalore
  'lalbagh': 'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?auto=format&fit=crop&w=800&q=80',
  'cubbon': 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=800&q=80',
  'bangalore palace': 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=800&q=80',
  'vidhana soudha': 'https://images.unsplash.com/photo-1599661046827-dacff0c0f09a?auto=format&fit=crop&w=800&q=80',
  // Chennai
  'marina beach': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
  'kapaleeshwarar': 'https://images.unsplash.com/photo-1582510003544-4d00b7f74220?auto=format&fit=crop&w=800&q=80',
  // Agra
  'taj mahal': 'https://images.unsplash.com/photo-1564507592333-c60657eea523?auto=format&fit=crop&w=800&q=80',
  'agra fort': 'https://images.unsplash.com/photo-1585135497273-1a86b09fe70e?auto=format&fit=crop&w=800&q=80',
  'fatehpur sikri': 'https://images.unsplash.com/photo-1590050752117-238cb0fb12b1?auto=format&fit=crop&w=800&q=80',
};

const CATEGORY_IMAGES: Record<string, string[]> = {
  heritage: [
    'https://images.unsplash.com/photo-1599661046827-dacff0c0f09a?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1590050752117-238cb0fb12b1?auto=format&fit=crop&w=800&q=80',
  ],
  nature: [
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=800&q=80',
  ],
  activities: [
    'https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1503220317375-aaad61436b1b?auto=format&fit=crop&w=800&q=80',
  ],
  food: [
    'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=800&q=80',
  ],
  default: [
    'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?auto=format&fit=crop&w=800&q=80',
  ],
};

function getPlaceImage(
  item: { name: string; category?: string; image_url?: string | null },
  _destinationName: string,
  index: number
): string {
  if (item.image_url && item.image_url.startsWith('http')) {
    return item.image_url;
  }
  const nameLower = (item.name || '').toLowerCase();
  for (const [key, url] of Object.entries(KNOWN_LANDMARK_IMAGES)) {
    if (nameLower.includes(key)) {
      return url;
    }
  }
  const c = String(item.category || '').toLowerCase();
  let list = CATEGORY_IMAGES.default;
  if (c.includes('food') || c.includes('rest') || c.includes('cafe') || c.includes('biryani') || c.includes('dining')) {
    list = CATEGORY_IMAGES.food;
  } else if (c.includes('activ') || c.includes('trek') || c.includes('tour') || c.includes('walk')) {
    list = CATEGORY_IMAGES.activities;
  } else if (c.includes('natur') || c.includes('park') || c.includes('lake') || c.includes('beach') || c.includes('hill')) {
    list = CATEGORY_IMAGES.nature;
  } else if (c.includes('temple') || c.includes('fort') || c.includes('palace') || c.includes('herit') || c.includes('monum')) {
    list = CATEGORY_IMAGES.heritage;
  }
  return list[index % list.length];
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

  // Selected Place and Food Sets (by name)
  const [selectedPlaces, setSelectedPlaces] = useState<Set<string>>(new Set());
  const [selectedFoods, setSelectedFoods] = useState<Set<string>>(new Set());

  // Full item dictionary for payload conversion
  const [placeItemsMap, setPlaceItemsMap] = useState<Map<string, SelectedPlaceItem>>(new Map());
  const [foodItemsMap, setFoodItemsMap] = useState<Map<string, SelectedFoodItem>>(new Map());

  // Leaflet map reference
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

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
          distance_km: f.distance_km || null,
          avg_cost_for_two: f.avg_cost_for_two || null,
          cuisine: f.cuisine || null,
          must_try: f.must_try || null,
          rating: f.rating || null,
          source: f.source || 'verified_catalog',
        });
      });

      setPlaceItemsMap(pMap);
      setFoodItemsMap(fMap);

      // Pre-select top recommended places if user hasn't selected any yet
      if (initialSelected.size > 0 && selectedPlaces.size === 0) {
        setSelectedPlaces(initialSelected);
      } else if (selectedPlaces.size === 0 && (data.must_visit || []).length > 0) {
        const top3 = (data.must_visit || []).slice(0, 3).map((p) => p.name);
        setSelectedPlaces(new Set(top3));
      }
    } catch (err: any) {
      setError(err?.message || 'Could not load destination attractions.');
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
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleFood = (name: string) => {
    setSelectedFoods((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
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
      image_url?: string | null;
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
        image_url: p.image_url,
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
          image_url: p.image_url,
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
          image_url: a.image_url,
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
        image_url: f.image_url,
      });
    });

    return list;
  }, [catalog, destinationName]);

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          String(item.name || '').toLowerCase().includes(q) ||
          String(item.category || '').toLowerCase().includes(q) ||
          (item.description && String(item.description).toLowerCase().includes(q));
        if (!match) return false;
      }
      if (activeTab === 'all') return true;
      if (activeTab === 'must_visit') return String(item.category || '').toLowerCase().includes('must') || Boolean(item.recommended);
      if (activeTab === 'activities') return item.kind === 'activity';
      if (activeTab === 'tourist_spots') return item.kind === 'place';
      if (activeTab === 'food') return item.kind === 'food';
      return true;
    });
  }, [allItems, searchQuery, activeTab]);

  // Leaflet Map Initialization
  useEffect(() => {
    if (viewMode !== 'map' || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const lat = catalog?.destination_latitude || 17.385;
      const lng = catalog?.destination_longitude || 78.4867;
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView([lat, lng], 12);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      const markers = L.layerGroup().addTo(map);
      markersRef.current = markers;
      mapInstanceRef.current = map;
    }

    if (markersRef.current && mapInstanceRef.current) {
      markersRef.current.clearLayers();
      const bounds = L.latLngBounds([]);

      allItems.forEach((item) => {
        if (item.latitude && item.longitude) {
          const isSel = item.kind === 'food' ? selectedFoods.has(item.name) : selectedPlaces.has(item.name);
          const markerColor = isSel ? '#059669' : '#0284c7';

          const customIcon = L.divIcon({
            className: 'custom-map-pin',
            html: `
              <div style="background-color: ${markerColor}; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 2px solid white; font-weight: bold; font-size: 11px;">
                ${isSel ? '✓' : '•'}
              </div>
            `,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });

          const marker = L.marker([item.latitude, item.longitude], { icon: customIcon });
          marker.bindPopup(`
            <div style="font-family: inherit; font-size: 12px; padding: 4px;">
              <strong style="color: #0f172a; font-size: 13px;">${item.name}</strong><br/>
              <span style="color: #64748b;">${item.category}</span><br/>
              <p style="margin: 4px 0 0 0; color: #334155;">${item.description || ''}</p>
            </div>
          `);

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

  const handleContinue = () => {
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

    onConfirm(placesList, foodsList, placeItems, foodItems, null, true, activityCount);
  };

  const totalSelectedCount = selectedPlaces.size + selectedFoods.size;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-travion-50 border border-travion-200 text-travion-700 text-xs font-black uppercase tracking-wider mb-2">
          <Compass className="w-3.5 h-3.5 text-travion-600" />
          Step 4 · Discover & Curate
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-charcoal-900 tracking-tight">
          What would you like to experience in {destinationName}?
        </h1>
        <p className="mt-1.5 text-sm text-charcoal-600 max-w-xl mx-auto">
          Explore genuine attractions, heritage monuments, scenic nature spots, and authentic culinary dining.
        </p>
      </div>

      {/* Search & Mode Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-6">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-charcoal-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search places in ${destinationName}…`}
            className="w-full h-11 pl-10 pr-4 rounded-2xl border border-charcoal-200 bg-white text-xs font-semibold placeholder:text-charcoal-400 focus:outline-none focus:border-travion-500 focus:ring-2 focus:ring-travion-100 transition-all"
          />
        </div>

        {/* View Switcher: Grid vs Map */}
        <div className="flex items-center gap-1 p-1 bg-sand-100 rounded-xl border border-charcoal-200 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              viewMode === 'grid'
                ? 'bg-white text-charcoal-900 shadow-sm'
                : 'text-charcoal-500 hover:text-charcoal-800'
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
                ? 'bg-white text-charcoal-900 shadow-sm'
                : 'text-charcoal-500 hover:text-charcoal-800'
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
                ? 'bg-travion-600 text-white shadow-sm'
                : 'bg-white border border-charcoal-200 text-charcoal-600 hover:border-travion-300'
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
          <RefreshCw className="w-8 h-8 text-travion-600 animate-spin mx-auto mb-4" />
          <p className="text-sm font-bold text-charcoal-600">
            Gathering verified locations and experiences in {destinationName}…
          </p>
        </div>
      )}

      {/* Interactive Map View */}
      {viewMode === 'map' && !loading && (
        <div className="mb-24 rounded-3xl overflow-hidden border border-charcoal-200 shadow-soft bg-white">
          <div className="p-3 bg-sand-50 border-b border-charcoal-200 flex items-center justify-between text-xs text-charcoal-600">
            <span className="font-bold flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-travion-600" />
              Click any pin on the map to add/remove it from your itinerary
            </span>
            <span className="font-semibold text-emerald-700">● Green: In your plan</span>
          </div>
          <div ref={mapContainerRef} className="w-full h-[520px]" />
        </div>
      )}

      {/* Grid View */}
      {viewMode === 'grid' && !loading && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-28">
          {filteredItems.map((item, idx) => {
            const isSelected = item.kind === 'food' ? selectedFoods.has(item.name) : selectedPlaces.has(item.name);
            const img = getPlaceImage(item, destinationName, idx);

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
                    ? 'border-travion-600 ring-2 ring-travion-500 bg-travion-50/20 shadow-floating'
                    : 'border-charcoal-200 bg-white hover:border-travion-300 hover:shadow-card'
                }`}
              >
                {/* Photo & Badges */}
                <div className="relative h-44 bg-charcoal-100 overflow-hidden">
                  <img
                    src={img}
                    alt={item.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-travion-900/80 backdrop-blur-md text-white text-[10.5px] font-black uppercase tracking-wider">
                    <BadgeCheck className="w-3.5 h-3.5 text-emerald-400" />
                    {item.category}
                  </div>

                  {item.recommended && (
                    <div className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500 text-white text-[10px] font-black uppercase shadow-sm">
                      <Sparkles className="w-3 h-3" /> Recommended
                    </div>
                  )}

                  {isSelected && (
                    <div className="absolute bottom-3 right-3 px-3 py-1 rounded-full bg-travion-600 text-white text-xs font-black flex items-center gap-1 shadow-md">
                      <Check className="w-3.5 h-3.5 stroke-[3]" /> Added
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-base font-extrabold text-charcoal-900 leading-snug line-clamp-1">
                      {item.name}
                    </h3>
                    <p className="mt-1 text-xs text-charcoal-500 line-clamp-2 leading-relaxed">
                      {item.description}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-charcoal-100 flex items-center justify-between">
                    <div className="flex items-center gap-3 text-[11.5px] text-charcoal-500 font-semibold">
                      {item.duration ? (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-charcoal-400" />
                          {item.duration} min
                        </span>
                      ) : null}
                      <span className="flex items-center gap-1 text-charcoal-700">
                        {item.price && item.price > 0 ? `₹${item.price}` : 'Free entry'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.kind === 'food') toggleFood(item.name);
                        else togglePlace(item.name);
                      }}
                      className={`h-9 px-3.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all ${
                        isSelected
                          ? 'bg-travion-600 text-white shadow-sm'
                          : 'bg-sand-100 text-charcoal-700 hover:bg-travion-50 hover:text-travion-700'
                      }`}
                    >
                      {isSelected ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Added
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" /> Add
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
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-charcoal-200 py-4 px-6 shadow-floating">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-4 h-11 rounded-xl border border-charcoal-300 text-charcoal-700 text-xs font-bold hover:bg-charcoal-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Transport
          </button>

          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs font-black text-charcoal-900">
              {totalSelectedCount} {totalSelectedCount === 1 ? 'place' : 'places'} selected
            </span>
            <span className="text-xs text-charcoal-400">·</span>
            <span className="text-[11.5px] font-medium text-charcoal-500">
              {selectedPlaces.size} attractions & {selectedFoods.size} dining spots
            </span>
          </div>

          <button
            type="button"
            disabled={selectedPlaces.size === 0 || busy}
            onClick={handleContinue}
            className="inline-flex items-center gap-2 px-6 h-11 rounded-xl bg-travion-600 hover:bg-travion-700 disabled:bg-charcoal-300 text-white text-xs font-black uppercase tracking-wider transition-colors shadow-sm"
          >
            {busy ? (
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
