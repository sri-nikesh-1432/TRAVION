import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeftRight, Calendar, MapPin, Search, AlertCircle, Globe, Loader2,
  Navigation, Check, Plane, TrainFront, Trees, Landmark, Utensils, BedDouble, Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LocationItem } from '../../types';
import { api, authStorage } from '../../services/api';
import { searchPlaces, kindLabel, IndexedPlace } from '../../data/placeIndex';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const RECENT_KEY = 'travion_recent_places';

// ── Tiny Google Maps JS loader (no extra dependency) ─────────────────────
let mapsPromise: Promise<boolean> | null = null;
function loadGoogleMaps(): Promise<boolean> {
  if (!GOOGLE_MAPS_API_KEY) return Promise.resolve(false);
  if ((window as any).google?.maps?.places) return Promise.resolve(true);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve) => {
    const callbackName = '__travionMapsReady';
    (window as any)[callbackName] = () => resolve(true);
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,geocoding&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete (window as any)[callbackName];
      resolve(false);
    };
    document.body.appendChild(script);
  });
  return mapsPromise;
}

/** Pick a short canonical place name from Google address components. */
function pickGoogleName(components: any[]): { name: string; state: string; country: string } {
  const pick = (types: string[]) => components.find(c => types.some(t => c.types.includes(t)))?.long_name || '';
  const pickShort = (types: string[]) => components.find(c => types.some(t => c.types.includes(t)))?.short_name || '';
  const city = pick(['locality', 'postal_town', 'administrative_area_level_3', 'administrative_area_level_2']);
  const state = pick(['administrative_area_level_1']);
  const country = pick(['country']);
  const region = pickShort(['administrative_area_level_1']);
  const name = city || state || country || 'Selected place';
  return { name, state: region || state, country: country || 'Worldwide' };
}

/** Map a Google prediction to a clean contextual suggestion line. */
function suggestionFromPrediction(p: any): {
  place_id: string; name: string; subtitle: string; types: string[];
} {
  const name = p.structured_formatting?.main_text || p.description?.split(',')[0] || 'Place';
  const subtitle = p.structured_formatting?.secondary_text || p.description || '';
  return { place_id: p.place_id, name, subtitle, types: p.types || [] };
}

function iconForPlace(types: string[]): React.ComponentType<{ className?: string }> {
  if (types.some(t => ['airport', 'flight'].includes(t))) return Plane;
  if (types.some(t => ['train_station', 'transit_station', 'light_rail_station', 'subway_station'].includes(t))) return TrainFront;
  if (types.some(t => ['park', 'natural_feature', 'campground'].includes(t))) return Trees;
  if (types.some(t => ['museum', 'art_gallery', 'tourist_attraction', 'point_of_interest'].includes(t))) return Landmark;
  if (types.some(t => ['restaurant', 'cafe', 'bar', 'meal_takeaway', 'bakery'].includes(t))) return Utensils;
  if (types.some(t => ['lodging', 'hotel'].includes(t))) return BedDouble;
  if (types.some(t => ['country', 'political'].includes(t))) return Globe;
  return MapPin;
}

interface Suggestion {
  place_id: string;
  name: string;
  subtitle: string;
  types: string[];
}

interface RecentPlace {
  name: string;
  state: string;
  country: string;
  lat: number;
  lng: number;
  place_id?: string;
  formatted_address?: string;
}

function readRecent(): RecentPlace[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, 4) : [];
  } catch {
    return [];
  }
}

function pushRecent(p: RecentPlace) {
  try {
    const next = [p, ...readRecent().filter(r => (r.place_id ? r.place_id !== p.place_id : !(r.name === p.name && r.country === p.country)))].slice(0, 4);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage unavailable */ }
}

interface TripSearchBarProps {
  onSearch: (data: {
    source: LocationItem;
    destination: LocationItem;
    startDate: string;
    endDate: string;
  }) => void;
  isLoading?: boolean;
}

type FieldKind = 'source' | 'destination';

const LOADING_COPY = [
  'Finding your route…',
  'Checking real places…',
  'Building your destination map…',
  'Preparing your journey…',
];

export const TripSearchBar: React.FC<TripSearchBarProps> = ({ onSearch, isLoading = false }) => {
  const [sourceQuery, setSourceQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState<LocationItem | null>(null);
  const [selectedDest, setSelectedDest] = useState<LocationItem | null>(null);

  const [sourceResults, setSourceResults] = useState<Suggestion[]>([]);
  const [destResults, setDestResults] = useState<Suggestion[]>([]);
  const [searchState, setSearchState] = useState<FieldKind | null>(null); // field actively searching
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showDestDropdown, setShowDestDropdown] = useState(false);
  const [recent, setRecent] = useState<RecentPlace[]>([]);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'error' | 'denied'>('idle');
  const [swapRotation, setSwapRotation] = useState(0);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);

  const sourceRef = useRef<HTMLDivElement>(null);
  const destRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef<{ source: number; destination: number }>({ source: 0, destination: 0 });

  // Default dates: today + 3 days departure, 3 days later return.
  const now = new Date();
  const defaultStart = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const defaultEnd = new Date(defaultStart.getTime() + 3 * 24 * 60 * 60 * 1000);
  const formatDateForInput = (d: Date) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  };
  const [startDateTime, setStartDateTime] = useState<string>(formatDateForInput(defaultStart));
  const [endDateTime, setEndDateTime] = useState<string>(formatDateForInput(defaultEnd));

  const isLoggedIn = !!authStorage.load().token;

  useEffect(() => {
    setRecent(readRecent());
    loadGoogleMaps().then(ready => {
      setMapsReady(ready);
      if (!ready) setMapsError(true);
    });
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sourceRef.current && !sourceRef.current.contains(e.target as Node)) setShowSourceDropdown(false);
      if (destRef.current && !destRef.current.contains(e.target as Node)) setShowDestDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** Live query against Google Places — char by char, debounced, stale-cancelled. */
  const queryWorld = useCallback(async (text: string, field: FieldKind) => {
    const seq = field === 'source' ? ++seqRef.current.source : ++seqRef.current.destination;
    if (text.trim().length < 2) {
      if (field === 'source') setSourceResults([]); else setDestResults([]);
      setSearchState(null);
      return;
    }
    setSearchState(field);
    const g = (window as any).google;
    if (!g?.maps?.places) {
      if (field === 'source') setSourceResults([]); else setDestResults([]);
      setSearchState(null);
      return;
    }
    try {
      const svc = new g.maps.places.AutocompleteService();
      const raw: any[] = await new Promise((resolve) => {
        svc.getPlacePredictions(
          { input: text, types: [] },  // [] = all place types: cities, countries, landmarks, POIs
          (res: any, st: string) => resolve(st === g.maps.places.PlacesServiceStatus.OK && res ? res : [])
        );
      });
      if (seq !== (field === 'source' ? seqRef.current.source : seqRef.current.destination)) return; // stale
      const suggs = raw.slice(0, 6).map(suggestionFromPrediction);
      if (field === 'source') setSourceResults(suggs); else setDestResults(suggs);
    } catch {
      if (seq === (field === 'source' ? seqRef.current.source : seqRef.current.destination)) {
        if (field === 'source') setSourceResults([]); else setDestResults([]);
      }
    } finally {
      if (seq === (field === 'source' ? seqRef.current.source : seqRef.current.destination)) setSearchState(null);
    }
  }, []);

  const onTyped = (value: string, field: FieldKind) => {
    const setter = field === 'source' ? setSourceQuery : setDestQuery;
    const clearSel = field === 'source' ? () => setSelectedSource(null) : () => setSelectedDest(null);
    const opener = field === 'source' ? () => setShowSourceDropdown(true) : () => setShowDestDropdown(true);
    setter(value);
    opener();
    clearSel();
    setErrorMessage(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { queryWorld(value, field); }, 250);
  };

  /** Resolve prediction -> canonical place (place_id + coords) -> register/reuse. */
  const resolvePrediction = useCallback(async (prediction: Suggestion): Promise<LocationItem | null> => {
    const g = (window as any).google;
    if (!g?.maps?.places) return null;
    try {
      const details = await new Promise<any>((resolve, reject) => {
        const svc = new g.maps.places.PlacesService(document.createElement('div'));
        svc.getDetails(
          { placeId: prediction.place_id, fields: ['geometry', 'address_components', 'formatted_address', 'name'] },
          (res: any, st: string) => {
            if (st === g.maps.places.PlacesServiceStatus.OK && res) resolve(res); else reject(new Error(st));
          }
        );
      });
      const { name, state, country } = pickGoogleName(details.address_components || []);
      const location = details.geometry?.location;
      if (!location) return null;
      const formatted = details.formatted_address || prediction.subtitle || '';
      const canonical: LocationItem = {
        id: `gmap:${prediction.place_id}`,
        name,
        state,
        country,
        lat: location.lat(),
        lng: location.lng(),
        place_id: prediction.place_id,
        formatted_address: formatted,
        description: formatted,
      };
      if (isLoggedIn) {
        try {
          return await api.registerLocation({
            name, state, country,
            lat: canonical.lat, lng: canonical.lng,
            place_id: prediction.place_id,
            description: formatted,
          });
        } catch { /* ephemeral fallback below */ }
      }
      return canonical;
    } catch {
      return null;
    }
  }, [isLoggedIn]);

  const remember = (item: LocationItem) => {
    pushRecent({
      name: item.name, state: item.state, country: item.country,
      lat: item.lat, lng: item.lng, place_id: item.place_id,
      formatted_address: item.formatted_address,
    });
    setRecent(readRecent());
  };

  const selectSuggestion = async (prediction: Suggestion, field: FieldKind) => {
    const item = await resolvePrediction(prediction);
    if (!item) {
      setErrorMessage('Could not resolve that place. Try another selection.');
      setErrorField(field);
      return;
    }
    remember(item);
    if (field === 'source') {
      setSelectedSource(item);
      setSourceQuery(item.name);
      setShowSourceDropdown(false);
    } else {
      setSelectedDest(item);
      setDestQuery(item.name);
      setShowDestDropdown(false);
    }
    setErrorMessage(null);
    setErrorField(null);
  };

  /** Pick a bundled India/world place — register it server-side when signed in. */
  const selectLocal = async (p: IndexedPlace, field: FieldKind) => {
    const address = p.country === 'India'
      ? [p.name, p.state, 'India'].filter(Boolean).join(', ')
      : p.country;
    const item: LocationItem = {
      id: `india:${p.id}`,
      name: p.name,
      state: p.state,
      country: p.country,
      lat: p.lat,
      lng: p.lng,
      formatted_address: address,
      description: address,
    };
    if (isLoggedIn) {
      try {
        const reg = await api.registerLocation({
          name: p.name, state: p.state, country: p.country, lat: p.lat, lng: p.lng,
          description: address,
        });
        item.id = reg.id;
      } catch { /* keep the ephemeral id; registration retried at plan time */ }
    }
    remember(item);
    if (field === 'source') {
      setSelectedSource(item);
      setSourceQuery(item.name);
      setShowSourceDropdown(false);
    } else {
      setSelectedDest(item);
      setDestQuery(item.name);
      setShowDestDropdown(false);
    }
    setErrorMessage(null);
    setErrorField(null);
  };

  const selectRecent = async (p: RecentPlace, field: FieldKind) => {
    const item: LocationItem = {
      id: `gmap:${p.place_id || p.name}`,
      name: p.name, state: p.state, country: p.country,
      lat: p.lat, lng: p.lng, place_id: p.place_id,
      formatted_address: p.formatted_address, description: p.formatted_address,
    };
    if (isLoggedIn) {
      try {
        const reg = await api.registerLocation({
          name: p.name, state: p.state, country: p.country, lat: p.lat, lng: p.lng,
          place_id: p.place_id, description: p.formatted_address,
        });
        item.id = reg.id;
      } catch { /* keep ephemeral */ }
    }
    remember(item);
    if (field === 'source') {
      setSelectedSource(item);
      setSourceQuery(item.name);
      setShowSourceDropdown(false);
    } else {
      setSelectedDest(item);
      setDestQuery(item.name);
      setShowDestDropdown(false);
    }
    setErrorMessage(null);
  };

  /** Source only — the traveller's real position, reverse geocoded live. */
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setGeoState('error'); return; }
    setGeoState('locating');
    const finish = (item: LocationItem | null, label: string) => {
      if (item) {
        remember(item);
        setSelectedSource(item);
        setSourceQuery(item.name);
        setShowSourceDropdown(false);
        setErrorMessage(null);
      } else if (label) {
        setErrorMessage(label);
      }
      setGeoState('idle');
    };
    const onPosition = async (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      try {
        const g = (window as any).google;
        if (g?.maps?.Geocoder && mapsReady) {
          const geocoder = new g.maps.Geocoder();
          const result = await new Promise<any>((resolve) => {
            geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (res: any, st: string) => {
              resolve(st === 'OK' && res && res.length ? res : null);
            });
          });
          if (result) {
            const { name, state, country } = pickGoogleName(result[0].address_components || []);
            const formatted = result[0].formatted_address || '';
            const placeId = result[0].place_id || 'current-location';
            const item: LocationItem = {
              id: `gmap:${placeId}`,
              name, state, country,
              lat: latitude, lng: longitude,
              place_id: placeId,
              formatted_address: formatted, description: formatted,
            };
            if (isLoggedIn) {
              try {
                const reg = await api.registerLocation({
                  name, state, country, lat: latitude, lng: longitude,
                  place_id: placeId, description: formatted,
                });
                item.id = reg.id;
                finish(reg, '');
                return;
              } catch { /* ephemeral */ }
            }
            finish(item, '');
            return;
          }
        }
        // No geocoder available: we have real coordinates but cannot name them.
        // Never guess a city — tell the traveller honestly and let them search.
        finish(null, 'We detected your coordinates but could not resolve the location name. Search for your starting place manually.');
      } catch {
        finish(null, 'Could not resolve your current location. Search manually instead.');
      }
    };
    const onError = (err: GeolocationPositionError) => {
      const denied = err.code === err.PERMISSION_DENIED;
      setGeoState(denied ? 'denied' : 'error');
      setShowSourceDropdown(false);
      setTimeout(() => setGeoState('idle'), 4000);
    };
    navigator.geolocation.getCurrentPosition(onPosition, onError, {
      enableHighAccuracy: false, timeout: 12000, maximumAge: 60000,
    });
  };

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

  const getDurationHint = () => {
    if (!startDateTime || !endDateTime) return null;
    const start = new Date(startDateTime);
    const end = new Date(endDateTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null;
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const nights = Math.max(1, diffDays - 1);
    return `${start.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} — ${end.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} · ${diffDays} days · ${nights} nights`;
  };

  const handleValidateAndSearch = () => {
    setErrorMessage(null);
    setErrorField(null);
    if (!selectedSource) {
      setErrorMessage(sourceQuery.trim() ? 'Pick one of the suggested starting places to continue.' : 'Where are you starting? Select or search a location.');
      setErrorField('source');
      return;
    }
    if (!selectedDest) {
      setErrorMessage(destQuery.trim() ? 'Pick one of the suggested destinations to continue.' : 'Where are you going? Select or search a destination.');
      setErrorField('destination');
      return;
    }
    if (selectedSource.id === selectedDest.id) {
      setErrorMessage('Your destination is the same as your starting point.');
      setErrorField('destination');
      return;
    }
    const startDate = new Date(startDateTime);
    const endDate = new Date(endDateTime);
    if (startDate < new Date(Date.now() - 5 * 60 * 1000)) {
      setErrorMessage('Please choose a future travel date and time.');
      setErrorField('start');
      return;
    }
    if (endDate <= startDate) {
      setErrorMessage('Your return date must be after your departure date.');
      setErrorField('end');
      return;
    }
    onSearch({ source: selectedSource, destination: selectedDest, startDate: startDateTime, endDate: endDateTime });
  };

  const minDateTimeStr = formatDateForInput(new Date());

  // ── Dropdown content helpers ────────────────────────────────────────────
  const renderSourceEmpty = () => (
    <>
      {/* Use my current location — always the first, most useful action */}
      <button
        type="button"
        onClick={useCurrentLocation}
        disabled={geoState === 'locating'}
        className="w-full text-left px-4 py-3 hover:bg-travion-50 flex items-center gap-3 transition-colors"
      >
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${geoState === 'locating' ? 'bg-travion-100 text-travion-600' : 'bg-emerald-100 text-emerald-600'}`}>
          {geoState === 'locating' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
        </span>
        <span>
          <span className="block font-bold text-charcoal-800 text-sm">
            {geoState === 'locating' ? 'Detecting your location…' : geoState === 'denied' ? 'Location permission denied' : geoState === 'error' ? 'Unable to determine your current location' : 'Use my current location'}
          </span>
          <span className="block text-[11px] text-charcoal-400 font-medium">
            {geoState === 'denied' ? 'Search your starting place manually below' : geoState === 'error' ? 'Try again, or search your starting place below' : 'Auto-detect your real starting point via GPS'}
          </span>
        </span>
      </button>

      {recent.length > 0 && (
        <div className="border-t border-charcoal-50 pt-1">
          <div className="px-4 pt-2 pb-1 text-[9px] font-black uppercase tracking-wider text-charcoal-400">Recent searches</div>
          {recent.map((r, i) => (
            <button
              key={`${r.place_id || r.name}-${i}`}
              type="button"
              onClick={() => selectRecent(r, 'source')}
              className="w-full text-left px-4 py-2 hover:bg-travion-50 flex items-center gap-2.5 text-sm transition-colors"
            >
              <Clock className="w-3.5 h-3.5 text-charcoal-300 shrink-0" />
              <span>
                <span className="font-semibold text-charcoal-800 block">{r.name}</span>
                <span className="text-[11px] text-charcoal-400">{r.formatted_address || [r.state, r.country].filter(Boolean).join(', ')}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="px-4 py-3 border-t border-charcoal-50 flex items-center gap-2 text-[11px] font-semibold text-charcoal-400">
        <Globe className="w-3.5 h-3.5 text-travion-400" />
        <span>Search any city, region, landmark or place — the world is searchable</span>
      </div>
    </>
  );

  const renderDestinationEmpty = () => (
    <>
      {recent.length > 0 && (
        <div className="pt-1">
          <div className="px-4 pt-2 pb-1 text-[9px] font-black uppercase tracking-wider text-charcoal-400">Recent searches</div>
          {recent.map((r, i) => (
            <button
              key={`${r.place_id || r.name}-${i}`}
              type="button"
              onClick={() => selectRecent(r, 'destination')}
              className="w-full text-left px-4 py-2 hover:bg-travion-50 flex items-center gap-2.5 text-sm transition-colors"
            >
              <Clock className="w-3.5 h-3.5 text-charcoal-300 shrink-0" />
              <span>
                <span className="font-semibold text-charcoal-800 block">{r.name}</span>
                <span className="text-[11px] text-charcoal-400">{r.formatted_address || [r.state, r.country].filter(Boolean).join(', ')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="px-4 py-3 flex items-center gap-2 text-[11px] font-semibold text-charcoal-400">
        <Globe className="w-3.5 h-3.5 text-travion-400" />
        <span>{recent.length > 0 ? 'Start typing for live worldwide results' : 'Search any city, region, landmark or place — the world is searchable'}</span>
      </div>
    </>
  );

  /** Local bundled place icon + subtitle for the row. */
  const localMeta = (p: IndexedPlace) => {
    const kind = p.kind;
    const icon = kind === 'country' ? Globe : kind === 'state' ? Landmark : kind === 'place' ? Trees : MapPin;
    let sub: string;
    if (kind === 'country') sub = 'Country';
    else if (p.country === 'India') sub = kind === 'district' ? `District in ${p.state}, India` : `${p.state || 'India'}, India`;
    else sub = p.country;
    const tag = kind === 'state' ? 'State' : kindLabel(kind);
    return { icon, sub, tag };
  };

  const renderResults = (field: FieldKind, results: Suggestion[]) => {
    const query = field === 'source' ? sourceQuery.trim() : destQuery.trim();
    const loading = searchState === field;
    const local = query.length >= 1 ? searchPlaces(query, 8) : [];
    const hasLocal = local.length > 0;
    const hasWorld = results.length > 0;
    const any = hasLocal || hasWorld;
    return (
      <>
        <div className="px-4 pt-2 pb-1.5 flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-charcoal-400 border-b border-charcoal-100 sticky top-0 bg-white rounded-t-2xl">
          <span>Search results</span>
          <span className="text-[10px] font-bold text-travion-400 flex items-center gap-1">
            <MapPin className="w-3 h-3" /> {(hasLocal ? 'India + ' : '')}{mapsReady ? 'Worldwide' : 'Bundled index'}
          </span>
        </div>

        {!any && loading && (
          <div className="px-4 py-6 text-center">
            <Loader2 className="w-5 h-5 text-travion-400 animate-spin mx-auto mb-2" />
            <p className="text-xs font-semibold text-charcoal-500">Searching the world…</p>
          </div>
        )}
        {!any && !loading && (
          <div className="px-4 py-6 text-center">
            <MapPin className="w-5 h-5 text-charcoal-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-charcoal-600">No matching place found for “{query}”</p>
            <p className="text-[10px] text-charcoal-400 font-medium mt-1">Check the spelling, or try a broader name — a city, town, state or landmark.{!mapsReady ? ' (Live worldwide results need the Google Places key; the full India index is available now.)' : ''}</p>
          </div>
        )}

        {/* India & bundled index results — instant, always available */}
        {hasLocal && (
          <>
            <div className="px-4 pt-2.5 pb-1 text-[9px] font-black uppercase tracking-wider text-charcoal-300">
              {query.length >= 2 ? 'India — cities, towns, districts & states' : 'Places in India'}
            </div>
            {local.map(p => {
              const { icon: Icon, sub, tag } = localMeta(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectLocal(p, field)}
                  className="w-full text-left px-4 py-2.5 hover:bg-sky-50 flex items-start gap-3 text-sm transition-colors"
                >
                  <span className="w-8 h-8 rounded-xl bg-travion-50 text-travion-600 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="font-bold text-charcoal-800 block truncate">{p.name}</span>
                    <span className="text-[11px] text-charcoal-400 block truncate">{sub}</span>
                  </span>
                  <span className="ml-auto shrink-0 self-center text-[9px] font-black uppercase tracking-wide text-charcoal-300">{tag}</span>
                </button>
              );
            })}
          </>
        )}

        {/* Live worldwide results (Google Places when the key is configured) */}
        {hasWorld && (
          <>
            <div className="px-4 pt-2.5 pb-1 text-[9px] font-black uppercase tracking-wider text-charcoal-300 border-t border-charcoal-50">
              Worldwide — live places
            </div>
            {results.map(s => {
              const Icon = iconForPlace(s.types);
              return (
                <button
                  key={s.place_id}
                  type="button"
                  onClick={() => selectSuggestion(s, field)}
                  className="w-full text-left px-4 py-2.5 hover:bg-sky-50 flex items-start gap-3 text-sm transition-colors"
                >
                  <span className="w-8 h-8 rounded-xl bg-sand-100 text-charcoal-500 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="font-bold text-charcoal-800 block truncate">{s.name}</span>
                    <span className="text-[11px] text-charcoal-400 block truncate">{s.subtitle}</span>
                  </span>
                  <span className="ml-auto shrink-0 self-center text-charcoal-300">
                    <Check className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100" />
                  </span>
                </button>
              );
            })}
          </>
        )}
      </>
    );
  };

  const sourceDropdownOpen = showSourceDropdown;
  const destDropdownOpen = showDestDropdown;

  const dayLabel = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { day: '—', mon: '', time: '' };
    const day = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).toUpperCase();
    return {
      day,
      weekday: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      time: d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }),
    };
  };
  const startLabel = dayLabel(startDateTime);
  const endLabel = dayLabel(endDateTime);

  const [loadingStep, setLoadingStep] = useState(0);
  useEffect(() => {
    if (!isLoading) return;
    const id = setInterval(() => setLoadingStep(s => (s + 1) % LOADING_COPY.length), 1500);
    return () => clearInterval(id);
  }, [isLoading]);

  const locationField = (kind: FieldKind) => {
    const isSource = kind === 'source';
    const ref = isSource ? sourceRef : destRef;
    const query = isSource ? sourceQuery : destQuery;
    const selected = isSource ? selectedSource : selectedDest;
    const error = errorField === kind;
    const open = isSource ? sourceDropdownOpen : destDropdownOpen;
    const render = () => (query.trim().length < 1
      ? (isSource ? renderSourceEmpty() : renderDestinationEmpty())
      : renderResults(kind, isSource ? sourceResults : destResults));
    return (
      <div ref={ref} className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${isSource ? 'bg-travion-100 text-travion-600' : 'bg-sand-100 text-cognac-600'}`}>
            <MapPin className="w-3.5 h-3.5" />
          </span>
          <span className="text-[11px] font-black uppercase tracking-[0.16em] text-charcoal-500">{isSource ? 'From' : 'To'}</span>
          {selected && (
            <span className="ml-auto hidden sm:block text-[11px] font-semibold text-charcoal-400 truncate max-w-[160px]">
              {[selected.state, selected.country].filter(Boolean).join(', ')}
            </span>
          )}
        </div>
        <div className={[
          'flex items-center gap-3 px-4 py-3.5 rounded-2xl border bg-white/70 transition-all',
          error ? 'border-red-400 bg-red-50/50 ring-2 ring-red-100'
            : open ? 'border-travion-400 shadow-soft ring-2 ring-travion-100'
              : 'border-charcoal-200 hover:border-travion-300 lg:hover:translate-y-[-1px]',
        ].join(' ')}>
          <div className="w-full min-w-0">
            <input
              type="text"
              value={query}
              onChange={(e) => onTyped(e.target.value, kind)}
              onFocus={() => (isSource ? setShowSourceDropdown(true) : setShowDestDropdown(true))}
              placeholder={isSource ? 'Search any location' : 'Search any city, region, landmark or place'}
              autoComplete="off"
              aria-label={isSource ? 'Starting location' : 'Destination'}
              className="w-full font-bold text-charcoal-800 text-[15px] focus:outline-none bg-transparent placeholder:text-charcoal-300 placeholder:font-semibold"
            />
          </div>
          {isSource && (
            <span className="shrink-0">
              <button
                type="button"
                onClick={useCurrentLocation}
                disabled={geoState === 'locating'}
                title="Use my current location"
                aria-label="Use my current location"
                className={`p-2 rounded-xl transition-colors ${geoState === 'locating' ? 'bg-travion-100 text-travion-600 animate-pulse' : 'text-charcoal-300 hover:text-travion-600 hover:bg-travion-50'}`}
              >
                {geoState === 'locating' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
              </button>
            </span>
          )}
        </div>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="absolute left-0 right-0 top-full mt-2.5 bg-white/95 backdrop-blur-2xl rounded-2xl shadow-floating border border-charcoal-100 py-1.5 z-50 max-h-80 overflow-y-auto"
            >
              {render()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const dateField = (kind: 'start' | 'end') => {
    const isStart = kind === 'start';
    const value = isStart ? startDateTime : endDateTime;
    const label = isStart ? startLabel : endLabel;
    const error = errorField === kind;
    return (
      <div className={`relative rounded-2xl border bg-ivory-50 px-4 py-3 transition-all focus-within:ring-2 focus-within:ring-travion-100 ${error ? 'border-red-400 ring-2 ring-red-100' : 'border-charcoal-100 hover:border-travion-300'}`}>
        <div className="flex items-center gap-3">
          <Calendar className="w-4.5 h-4.5 text-travion-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-[9.5px] font-black uppercase tracking-[0.16em] text-charcoal-400">{isStart ? 'Start' : 'End'}</p>
            <p className="font-extrabold text-charcoal-800 text-[15px] leading-tight truncate">{label.day}<span className="text-charcoal-400 font-semibold mx-1">·</span>{label.time}</p>
          </div>
        </div>
        <input
          type="datetime-local"
          min={isStart ? minDateTimeStr : startDateTime || minDateTimeStr}
          value={value}
          onChange={(e) => (isStart ? setStartDateTime(e.target.value) : setEndDateTime(e.target.value))}
          aria-label={(isStart ? 'Start' : 'End') + ' date and time'}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          tabIndex={0}
        />
      </div>
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Premium glass planner surface */}
      <div className="relative rounded-[30px] bg-white/80 backdrop-blur-2xl border border-white/70 shadow-floating overflow-visible">
        <div className="pointer-events-none absolute -top-px inset-x-12 h-px bg-gradient-to-r from-transparent via-sky-200 to-transparent" />
        <div className="p-4 sm:p-6">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-start">
            {locationField('source')}
            <div className="hidden md:flex pt-9">
              <motion.button
                type="button"
                animate={{ rotate: swapRotation }}
                transition={{ duration: 0.35, ease: "easeInOut" }}
                onClick={handleSwap}
                className="p-2.5 rounded-full bg-travion-50 text-travion-600 hover:bg-travion-500 hover:text-white border border-travion-200 transition-all shadow-sm focus:outline-none"
                title="Swap source and destination"
                aria-label="Swap source and destination"
              >
                <ArrowLeftRight className="w-4 h-4" />
              </motion.button>
            </div>
            {locationField('destination')}
            <div className="flex justify-center md:hidden -my-1">
              <motion.button
                type="button"
                animate={{ rotate: swapRotation }}
                transition={{ duration: 0.35, ease: "easeInOut" }}
                onClick={handleSwap}
                className="p-2 rounded-full bg-travion-50 text-travion-600 hover:bg-travion-500 hover:text-white border border-travion-200 transition-all shadow-sm focus:outline-none"
                title="Swap destination and starting point"
                aria-label="Swap destination and starting point"
              >
                <ArrowLeftRight className="w-4 h-4" />
              </motion.button>
            </div>
          </div>

          <div className="mt-4 flex flex-col lg:flex-row lg:items-stretch gap-3">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-stretch gap-3">
              {dateField('start')}
              <div className="hidden sm:flex items-center justify-center">
                <span className="text-charcoal-300 font-black text-sm">→</span>
              </div>
              {dateField('end')}
            </div>

            <div className="lg:w-[240px]">
              <button
                type="button"
                disabled={isLoading}
                onClick={handleValidateAndSearch}
                aria-label="Explore trip"
                className="w-full h-full min-h-[58px] rounded-2xl bg-travion-600 hover:bg-travion-700 text-white font-extrabold text-[15px] shadow-soft hover:shadow-floating flex items-center justify-center gap-2.5 transition-all disabled:opacity-70 disabled:cursor-wait active:scale-[0.99] px-5"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4.5 h-4.5 animate-spin" />
                    <span className="text-[13px] font-bold">{LOADING_COPY[loadingStep]}</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4.5 h-4.5" />
                    <span>Explore trip</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Duration / trust hint */}
          <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs min-h-[20px]">
            {errorMessage ? (
              <motion.div
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-1.5 text-red-600 font-semibold flex-1"
              >
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span>{errorMessage}</span>
              </motion.div>
            ) : (
              <div className="flex items-center gap-2 text-charcoal-500 font-semibold flex-1">
                {getDurationHint() ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-travion-50 text-travion-700 text-[11.5px] font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-travion-500" />
                    {getDurationHint()}
                  </span>
                ) : (
                  <span>Every Indian state, district, city and town — plus live worldwide places</span>
                )}
              </div>
            )}
            <div className="hidden sm:flex items-center gap-2 text-charcoal-400 text-[11px] font-semibold">
              <Globe className="w-3 h-3 text-travion-400" />
              <span>{mapsReady ? 'Full India index · live worldwide search' : 'Full India index loaded · worldwide live search unavailable'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
