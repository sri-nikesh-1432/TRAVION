import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass,
  Gauge,
  Train,
  Crosshair,
  Radio,
  MapPin,
  Footprints,
  Car,
  Navigation,
  Sparkles,
  Clock,
  Calendar,
  Utensils,
  BedDouble,
  BookOpen,
  LocateFixed,
  ArrowLeft,
  Download,
  RefreshCw,
  Phone,
  MessageSquare,
  ShieldAlert,
  ExternalLink,
  Volume2,
  CheckCircle2,
  Layers,
  Info,
  Maximize2,
  Minimize2,
  AlertTriangle,
  X,
  PhoneCall,
  Flame,
  FileText,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TripItinerary, TripItem, ItineraryStop } from '../../types';

interface LiveJourneyCompanionScreenProps {
  trip: TripItem;
  itinerary: TripItinerary;
  assignedGuide?: { name: string; phone?: string; rating?: number } | null;
  onBackToHome: () => void;
  onOpenOffline?: () => void;
  onOpenCancel?: () => void;
  onOpenChat?: () => void;
  onTriggerReplan?: (reason: string) => void;
}

type MovementMode = 'STATIONARY' | 'WALKING' | 'VEHICLE' | 'TRAIN';
type MapVisionMode = 'satellite' | 'streets' | 'night';

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export const LiveJourneyCompanionScreen: React.FC<LiveJourneyCompanionScreenProps> = ({
  trip,
  itinerary,
  assignedGuide,
  onBackToHome,
  onOpenOffline,
  onOpenCancel,
  onOpenChat,
  onTriggerReplan,
}) => {
  // Real device GPS & telemetry
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [altitude, setAltitude] = useState<number | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const [speedKmh, setSpeedKmh] = useState<number>(0);
  const [isGpsActive, setIsGpsActive] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Companion UI state
  const [mapVision, setMapVision] = useState<MapVisionMode>('satellite');
  const [trainMode, setTrainMode] = useState<boolean>(false);
  const [showStoryline, setShowStoryline] = useState<boolean>(true);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(0);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [showSafetyModal, setShowSafetyModal] = useState<boolean>(false);
  const [showAudioNarration, setShowAudioNarration] = useState<ItineraryStop | null>(null);
  const [activeTab, setActiveTab] = useState<'live' | 'itinerary'>('live');

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const avatarMarkerRef = useRef<L.Marker | null>(null);
  const pathPolylineRef = useRef<L.Polyline | null>(null);
  const stopMarkersLayerRef = useRef<L.LayerGroup | null>(null);
  const positionsHistoryRef = useRef<[number, number][]>([]);

  const days = itinerary?.days || [];
  const currentDay = days[selectedDayIndex] || days[0] || null;
  const stops = currentDay?.stops || [];

  // Identify "Up Next" stop
  const upNextStop: ItineraryStop | null = useMemo(() => {
    if (!stops || stops.length === 0) return null;
    if (activeStopId) {
      const match = stops.find((s) => s.id === activeStopId);
      if (match) return match;
    }
    return stops[0];
  }, [stops, activeStopId]);

  // Derive movement mode from velocity
  const movementMode: MovementMode =
    speedKmh < 1.5
      ? 'STATIONARY'
      : speedKmh <= 7.0
        ? 'WALKING'
        : speedKmh <= 65.0
          ? 'VEHICLE'
          : 'TRAIN';

  // Watch real device GPS
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGpsError('Geolocation API is not supported on this device/browser.');
      return;
    }

    let lastPos: { lat: number; lng: number; time: number } | null = null;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        setAccuracy(pos.coords.accuracy || null);
        setAltitude(pos.coords.altitude || null);
        if (pos.coords.heading != null && !Number.isNaN(pos.coords.heading)) {
          setHeading(pos.coords.heading);
        }
        setIsGpsActive(true);
        setGpsError(null);

        if (pos.coords.speed != null && pos.coords.speed >= 0) {
          setSpeedKmh(Math.round(pos.coords.speed * 3.6 * 10) / 10);
        } else if (lastPos) {
          const dt = (pos.timestamp - lastPos.time) / 1000;
          if (dt > 1.5) {
            const dKm = getDistanceKm(lastPos.lat, lastPos.lng, lat, lng);
            const kmh = (dKm / dt) * 3600;
            setSpeedKmh(Math.round(Math.min(kmh, 250) * 10) / 10);
          }
        }
        lastPos = { lat, lng, time: pos.timestamp };

        positionsHistoryRef.current.push([lat, lng]);
        if (positionsHistoryRef.current.length > 180) {
          positionsHistoryRef.current.shift();
        }
      },
      (err) => {
        setIsGpsActive(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError('GPS permission denied. Enable location in browser for live tracking.');
        } else {
          setGpsError('Acquiring high-accuracy satellite lock…');
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // Distance to Up Next stop
  const upNextDistanceKm: number | null = useMemo(() => {
    if (!coords || !upNextStop) return null;
    const sLat = (upNextStop as any).lat ?? (upNextStop as any).latitude;
    const sLng = (upNextStop as any).lng ?? (upNextStop as any).longitude;
    if (sLat == null || sLng == null) return null;
    return getDistanceKm(coords.lat, coords.lng, Number(sLat), Number(sLng));
  }, [coords, upNextStop]);

  // Center on stop
  const focusStop = (stop: ItineraryStop) => {
    setActiveStopId(stop.id);
    const stopLat = (stop as any).lat ?? (stop as any).latitude;
    const stopLng = (stop as any).lng ?? (stop as any).longitude;
    if (stopLat != null && stopLng != null && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([Number(stopLat), Number(stopLng)], 16, {
        duration: 1.2,
      });
    }
  };

  // Center on user GPS position
  const centerUser = () => {
    if (coords && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([coords.lat, coords.lng], 16, {
        duration: 1.0,
      });
    }
  };

  // Open Google Maps directions
  const openDirections = (stop: ItineraryStop) => {
    const stopLat = (stop as any).lat ?? (stop as any).latitude;
    const stopLng = (stop as any).lng ?? (stop as any).longitude;
    if (stopLat != null && stopLng != null) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${stopLat},${stopLng}&travelmode=driving`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const initialLat = coords?.lat || 17.385;
    const initialLng = coords?.lng || 78.4867;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([initialLat, initialLng], 14);

      // Base tile layer
      const tileUrl =
        mapVision === 'streets'
          ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
          : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{x}/{y}';

      const tileLayer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
      tileLayerRef.current = tileLayer;

      // Real user path polyline
      const polyline = L.polyline([], {
        color: '#10b981',
        weight: 3.5,
        opacity: 0.85,
        dashArray: '6, 8',
      }).addTo(map);
      pathPolylineRef.current = polyline;

      // Real pulse avatar marker
      const avatarIcon = L.divIcon({
        className: 'companion-avatar',
        html: `
          <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; width: 100%; height: 100%; border-radius: 50%; background: rgba(16, 185, 129, 0.35); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
            <div style="position: absolute; width: 22px; height: 22px; border-radius: 50%; background: #10b981; border: 3px solid white; box-shadow: 0 0 14px rgba(16, 185, 129, 0.9);"></div>
            <div style="position: absolute; top: 0; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 8px solid #34d399; transform: translateY(-4px);"></div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });

      const marker = L.marker([initialLat, initialLng], { icon: avatarIcon }).addTo(map);
      avatarMarkerRef.current = marker;

      // Group for itinerary stops
      const stopGroup = L.layerGroup().addTo(map);
      stopMarkersLayerRef.current = stopGroup;

      mapInstanceRef.current = map;
    }

    if (coords && mapInstanceRef.current && avatarMarkerRef.current) {
      avatarMarkerRef.current.setLatLng([coords.lat, coords.lng]);
      if (pathPolylineRef.current && positionsHistoryRef.current.length > 0) {
        pathPolylineRef.current.setLatLngs(positionsHistoryRef.current);
      }
    }
  }, [coords, mapVision]);

  // Switch map tile layer on mapVision change
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    mapInstanceRef.current.removeLayer(tileLayerRef.current);

    const tileUrl =
      mapVision === 'streets'
        ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{x}/{y}';

    const newLayer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(mapInstanceRef.current);
    tileLayerRef.current = newLayer;
  }, [mapVision]);

  // Update itinerary waypoints when day changes
  useEffect(() => {
    if (!mapInstanceRef.current || !stopMarkersLayerRef.current) return;
    const group = stopMarkersLayerRef.current;
    group.clearLayers();

    const validPoints: [number, number][] = [];

    stops.forEach((stop, index) => {
      const stopLat = (stop as any).lat ?? (stop as any).latitude;
      const stopLng = (stop as any).lng ?? (stop as any).longitude;
      if (stopLat != null && stopLng != null) {
        const point: [number, number] = [Number(stopLat), Number(stopLng)];
        validPoints.push(point);

        const isFood = ['food', 'meal_hold', 'restaurant', 'cafe'].includes(String(stop.category).toLowerCase());
        const isStay = ['stay', 'hotel'].includes(String(stop.category).toLowerCase());
        const badgeColor = isStay ? '#6366f1' : isFood ? '#f59e0b' : '#10b981';

        const stopIcon = L.divIcon({
          className: 'companion-stop-marker',
          html: `
            <div style="background: rgba(15, 23, 42, 0.95); border: 2px solid ${badgeColor}; color: white; border-radius: 9999px; padding: 2px 8px; font-weight: 800; font-size: 11px; box-shadow: 0 4px 14px rgba(0,0,0,0.6); display: flex; align-items: center; gap: 5px; white-space: nowrap; cursor: pointer;">
              <span style="background: ${badgeColor}; color: black; border-radius: 9999px; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 900;">${index + 1}</span>
              <span style="max-width: 120px; overflow: hidden; text-overflow: ellipsis;">${stop.title}</span>
            </div>
          `,
          iconSize: [130, 26],
          iconAnchor: [65, 13],
        });

        const stopMarker = L.marker(point, { icon: stopIcon }).addTo(group);
        stopMarker.bindPopup(`
          <div style="font-family: sans-serif; padding: 6px; min-width: 180px; color: #0f172a;">
            <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #10b981;">Stop ${index + 1} · ${stop.time}</div>
            <div style="font-size: 13px; font-weight: 800; margin: 3px 0;">${stop.title}</div>
            <div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">${stop.duration_minutes ? `~${stop.duration_minutes} min` : ''} · ${stop.estimated_cost ? `₹${stop.estimated_cost}` : 'Included'}</div>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${point[0]},${point[1]}" target="_blank" rel="noopener noreferrer" style="display: inline-block; font-size: 11px; font-weight: bold; background: #10b981; color: white; padding: 4px 8px; border-radius: 6px; text-decoration: none;">Get Directions</a>
          </div>
        `);

        stopMarker.on('click', () => {
          setActiveStopId(stop.id);
        });
      }
    });

    if (!coords && validPoints.length > 0 && mapInstanceRef.current) {
      mapInstanceRef.current.fitBounds(validPoints, { padding: [60, 60], maxZoom: 15 });
    }
  }, [stops, coords]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const formatDateRange = () => {
    try {
      const s = new Date(trip.start_datetime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const e = new Date(trip.end_datetime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      return `${s} – ${e}`;
    } catch {
      return '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 w-screen h-screen bg-charcoal-950 flex flex-col font-sans text-white overflow-hidden select-none">
      {/* ── TOP HUD NAVIGATION BAR ── */}
      <header className="h-16 px-4 sm:px-6 bg-charcoal-950/95 border-b border-charcoal-800/80 backdrop-blur-xl flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToHome}
            title="Return to your trips"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-charcoal-900 hover:bg-charcoal-850 border border-charcoal-700/80 text-charcoal-300 hover:text-white text-xs font-bold transition-all shadow-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">My Trips</span>
          </button>

          <div className="flex items-center gap-2 pl-2 border-l border-charcoal-800">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                  {trip.source_name} → {trip.destination_name}
                </span>
                <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-emerald-950 text-emerald-300 border border-emerald-800">
                  LIVE COMPANION ACTIVE
                </span>
              </div>
              <span className="text-[10px] text-charcoal-400 font-mono hidden sm:inline">
                {formatDateRange()} · {days.length} Days · {trip.mode === 'GUIDE_MODE' ? 'Guide Mode' : 'Adventurous Mode'}
              </span>
            </div>
          </div>
        </div>

        {/* Center Live Telemetry Status */}
        <div className="hidden lg:flex items-center gap-4 px-4 py-1.5 rounded-2xl bg-charcoal-900/80 border border-charcoal-800/80 font-mono text-xs">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <Gauge className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-bold">{speedKmh.toFixed(1)} km/h</span>
          </div>
          <div className="w-px h-3.5 bg-charcoal-700" />
          <div className="flex items-center gap-1.5 text-charcoal-300">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>{isGpsActive ? `GPS LOCK (±${Math.round(accuracy || 0)}m)` : 'ACQUIRING SATELLITES…'}</span>
          </div>
          <div className="w-px h-3.5 bg-charcoal-700" />
          <span className="text-[10.5px] font-bold uppercase text-charcoal-400">
            {movementMode}
          </span>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2">
          {/* Map Vision Toggle */}
          <div className="hidden sm:flex items-center p-0.5 rounded-xl bg-charcoal-900 border border-charcoal-800 text-xs font-mono">
            {(['satellite', 'streets', 'night'] as MapVisionMode[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setMapVision(v)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${
                  mapVision === v
                    ? 'bg-emerald-500 text-charcoal-950 font-black shadow-sm'
                    : 'text-charcoal-400 hover:text-white'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Train Mode Toggle */}
          <button
            type="button"
            onClick={() => setTrainMode((prev) => !prev)}
            title="Toggle Live Train GPS Speedometer"
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
              trainMode
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                : 'bg-charcoal-900 text-charcoal-400 border-charcoal-800 hover:text-white'
            }`}
          >
            <Train className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Train Mode</span>
          </button>

          {/* Storyline Toggle */}
          <button
            type="button"
            onClick={() => setShowStoryline((prev) => !prev)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
              showStoryline
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm'
                : 'bg-charcoal-900 text-charcoal-400 border-charcoal-800 hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{showStoryline ? 'Hide Storyline' : 'Storyline'}</span>
          </button>

          {/* Safety & SOS Modal Button */}
          <button
            type="button"
            onClick={() => setShowSafetyModal(true)}
            title="Emergency SOS & Protected Reserve Info"
            className="p-2 rounded-xl bg-red-950/60 hover:bg-red-900/80 text-red-400 border border-red-800/60 transition-colors"
          >
            <ShieldAlert className="w-4 h-4" />
          </button>

          {/* Guide Chat (if Guide Mode) */}
          {trip.mode === 'GUIDE_MODE' && onOpenChat && (
            <button
              type="button"
              onClick={onOpenChat}
              className="p-2 rounded-xl bg-travion-600 hover:bg-travion-700 text-white shadow-sm transition-colors"
              title="Chat with assigned guide"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          )}

          {/* Offline Download */}
          {onOpenOffline && (
            <button
              type="button"
              onClick={onOpenOffline}
              title="Download offline pack"
              className="p-2 rounded-xl bg-charcoal-900 hover:bg-charcoal-800 text-charcoal-300 hover:text-white border border-charcoal-800 transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* ── MAIN IMMERSIVE CONTENT AREA ── */}
      <div className="relative flex-1 w-full h-full flex overflow-hidden">
        {/* Night / FLIR Overlay */}
        {mapVision === 'night' && (
          <div className="absolute inset-0 z-10 pointer-events-none mix-blend-color-burn bg-emerald-950/40" />
        )}

        {/* Map Canvas */}
        <div className="relative flex-1 h-full w-full">
          <div ref={mapContainerRef} className="w-full h-full" />

          {/* Signal / GPS Error Toast */}
          {gpsError && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl bg-amber-500/95 text-charcoal-950 text-xs font-bold flex items-center gap-2 shadow-xl backdrop-blur-md">
              <Radio className="w-4 h-4 animate-pulse" />
              <span>{gpsError}</span>
            </div>
          )}

          {/* Floating Left Speedometer & Telemetry Card */}
          <div className="absolute top-4 left-4 z-20 flex flex-col gap-3 pointer-events-auto">
            <div className="p-4 rounded-3xl bg-charcoal-950/90 backdrop-blur-xl border border-charcoal-800/90 shadow-2xl text-white min-w-[210px]">
              <div className="flex items-center justify-between text-charcoal-400 text-[10px] font-mono uppercase tracking-wider mb-1">
                <span className="flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-emerald-400" /> Velocity
                </span>
                <span className={isGpsActive ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {isGpsActive ? 'GPS ACTIVE' : 'SEARCHING'}
                </span>
              </div>

              <div className="flex items-baseline gap-1.5 my-1">
                <span className="text-4xl font-black font-mono tracking-tight text-emerald-400">
                  {speedKmh.toFixed(1)}
                </span>
                <span className="text-xs font-mono font-bold text-charcoal-400">km/h</span>
              </div>

              <div className="mt-2.5 pt-2 border-t border-charcoal-800/80 flex items-center justify-between text-xs">
                <span className="text-[10px] text-charcoal-400 font-mono">STATUS:</span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black uppercase tracking-wide">
                  {movementMode === 'WALKING' && <Footprints className="w-3 h-3 text-emerald-400" />}
                  {movementMode === 'VEHICLE' && <Car className="w-3 h-3 text-emerald-400" />}
                  {movementMode === 'TRAIN' && <Train className="w-3 h-3 text-amber-400" />}
                  {movementMode === 'STATIONARY' && <MapPin className="w-3 h-3 text-cyan-400" />}
                  {movementMode}
                </span>
              </div>

              {coords && (
                <div className="mt-2 text-[9.5px] font-mono text-charcoal-400 flex justify-between">
                  <span>LAT: {coords.lat.toFixed(4)}</span>
                  <span>LNG: {coords.lng.toFixed(4)}</span>
                </div>
              )}
            </div>

            {/* Recenter / Actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={centerUser}
                className="px-3.5 py-2.5 rounded-2xl bg-charcoal-950/90 hover:bg-charcoal-900 border border-charcoal-800 text-emerald-400 text-xs font-bold flex items-center gap-1.5 shadow-xl backdrop-blur-md transition-all"
              >
                <LocateFixed className="w-4 h-4 text-emerald-400" />
                <span>My Location</span>
              </button>
              {upNextStop && (
                <button
                  type="button"
                  onClick={() => focusStop(upNextStop)}
                  className="px-3.5 py-2.5 rounded-2xl bg-charcoal-950/90 hover:bg-charcoal-900 border border-charcoal-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-xl backdrop-blur-md transition-all"
                >
                  <Crosshair className="w-4 h-4 text-emerald-400" />
                  <span>Next Stop</span>
                </button>
              )}
            </div>
          </div>

          {/* Where is my Train Mode Floating Panel */}
          {trainMode && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-4 right-4 z-20 p-4 rounded-3xl bg-charcoal-950/95 backdrop-blur-xl border border-amber-500/40 shadow-2xl text-white max-w-xs w-full pointer-events-auto"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                    <Train className="w-4 h-4" />
                  </span>
                  <div>
                    <span className="text-xs font-black uppercase text-amber-400 block">Where is my Train</span>
                    <span className="text-[10px] text-charcoal-400 font-mono">Live Rail GPS Telemetry</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTrainMode(false)}
                  className="p-1 rounded-lg text-charcoal-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="p-3 rounded-2xl bg-charcoal-900 border border-charcoal-800 space-y-2 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-charcoal-400">Corridor Velocity:</span>
                  <span className="text-amber-400 font-black text-sm">{speedKmh.toFixed(0)} km/h</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-charcoal-400">Destination Hub:</span>
                  <span className="text-white font-bold">{trip.destination_name}</span>
                </div>
                <div className="flex justify-between text-[10px] text-charcoal-400 pt-1 border-t border-charcoal-800">
                  <span>GPS Tracking:</span>
                  <span className="text-emerald-400 font-bold">ACTIVE · IRCTC LINE</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Guide Mode Avatar Floating Card (Bottom-Left) */}
          {trip.mode === 'GUIDE_MODE' && assignedGuide && (
            <div className="absolute bottom-6 left-4 z-20 p-3.5 rounded-3xl bg-charcoal-950/90 backdrop-blur-xl border border-charcoal-800 shadow-2xl text-white max-w-xs w-full flex items-center justify-between gap-3 pointer-events-auto">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-travion-500 to-travion-700 text-white font-black text-sm flex items-center justify-center shadow-md">
                  {assignedGuide.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-extrabold text-white">{assignedGuide.name}</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
                      VERIFIED
                    </span>
                  </div>
                  <p className="text-[10px] text-charcoal-400">
                    ★ {(assignedGuide.rating ?? 4.9).toFixed(1)} · Local Guide Support
                  </p>
                </div>
              </div>

              {assignedGuide.phone && (
                <a
                  href={`tel:${assignedGuide.phone}`}
                  className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all"
                  title="Call guide"
                >
                  <PhoneCall className="w-4 h-4" />
                </a>
              )}
            </div>
          )}
        </div>

        {/* ── INTERACTIVE STORYLINE DRAWER (RIGHT) ── */}
        <AnimatePresence>
          {showStoryline && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="h-full bg-charcoal-950/95 backdrop-blur-2xl border-l border-charcoal-800/90 flex flex-col z-20 shrink-0 text-white overflow-hidden shadow-2xl"
            >
              {/* Storyline Header */}
              <div className="p-4 border-b border-charcoal-800 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Journey Storyline
                  </h3>
                  <p className="text-[11px] text-charcoal-400 mt-0.5 font-medium">
                    {days.length} Days in {trip.destination_name} · Real Chronology
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowStoryline(false)}
                  className="p-1.5 rounded-lg text-charcoal-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Day Pills Bar */}
              {days.length > 1 && (
                <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-charcoal-800/80 overflow-x-auto scrollbar-none bg-charcoal-900/50">
                  {days.map((day, dIdx) => (
                    <button
                      key={day.day}
                      type="button"
                      onClick={() => setSelectedDayIndex(dIdx)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition-all ${
                        selectedDayIndex === dIdx
                          ? 'bg-emerald-500 text-charcoal-950 shadow-sm'
                          : 'bg-charcoal-800/80 text-charcoal-300 hover:text-white'
                      }`}
                    >
                      Day {day.day}
                    </button>
                  ))}
                </div>
              )}

              {/* UP NEXT SPOTLIGHT CARD */}
              {upNextStop && (
                <div className="p-4 m-3.5 rounded-3xl bg-gradient-to-br from-charcoal-900 via-charcoal-900 to-charcoal-850 border border-emerald-500/40 shadow-xl">
                  <div className="flex items-center justify-between text-[10px] font-mono text-emerald-400 uppercase tracking-wider mb-1">
                    <span className="flex items-center gap-1 font-bold">
                      <Clock className="w-3 h-3" /> CURRENT / UP NEXT
                    </span>
                    <span>{upNextStop.time}</span>
                  </div>

                  <h4 className="text-base font-black text-white leading-snug line-clamp-1">
                    {upNextStop.title}
                  </h4>

                  <div className="mt-1 flex items-center gap-3 text-[11px] text-charcoal-400">
                    {upNextDistanceKm !== null && (
                      <span className="font-bold text-emerald-400">
                        📍 {upNextDistanceKm} km away
                      </span>
                    )}
                    <span>~{upNextStop.duration_minutes || 60} min</span>
                    <span>₹{upNextStop.estimated_cost || 0}</span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => openDirections(upNextStop)}
                      className="h-9 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-charcoal-950 font-black text-xs flex items-center justify-center gap-1.5 transition-all shadow-md"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      <span>Directions</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => focusStop(upNextStop)}
                      className="h-9 px-3 rounded-xl bg-charcoal-800 hover:bg-charcoal-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors border border-charcoal-700"
                    >
                      <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Center Map</span>
                    </button>
                  </div>
                </div>
              )}

              {/* CHRONOLOGICAL STOP LIST */}
              <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
                <div className="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-charcoal-400 px-1">
                  <span>{currentDay?.title || `Day ${selectedDayIndex + 1} Schedule`}</span>
                  <span>{stops.length} stops</span>
                </div>

                <ol className="relative border-l border-charcoal-800/80 ml-2.5 space-y-3.5 pt-1">
                  {stops.map((stop, sIdx) => {
                    const isSelected = activeStopId === stop.id;
                    const isFood = ['food', 'meal_hold', 'restaurant', 'cafe'].includes(String(stop.category).toLowerCase());
                    const isStay = ['stay', 'hotel'].includes(String(stop.category).toLowerCase());

                    return (
                      <li
                        key={stop.id || sIdx}
                        onClick={() => focusStop(stop)}
                        className={`ml-4 p-3 rounded-2xl cursor-pointer transition-all border ${
                          isSelected
                            ? 'bg-emerald-500/15 border-emerald-500/50 shadow-md ring-1 ring-emerald-500/30'
                            : 'bg-charcoal-900/60 hover:bg-charcoal-850/80 border-charcoal-800/70 text-charcoal-300'
                        }`}
                      >
                        <span
                          className={`absolute -left-1.5 mt-2 w-3.5 h-3.5 rounded-full border-2 border-charcoal-950 transition-colors ${
                            isSelected ? 'bg-emerald-400 ring-4 ring-emerald-500/30' : 'bg-charcoal-600'
                          }`}
                        />
                        <div className="flex items-center justify-between text-[10.5px] font-mono text-charcoal-400 mb-1">
                          <span className="font-bold text-emerald-300">{stop.time}</span>
                          <span className="flex items-center gap-1 text-[10px] font-bold uppercase">
                            {isFood ? (
                              <Utensils className="w-3 h-3 text-amber-400" />
                            ) : isStay ? (
                              <BedDouble className="w-3 h-3 text-indigo-400" />
                            ) : (
                              <MapPin className="w-3 h-3 text-emerald-400" />
                            )}
                            {stop.category}
                          </span>
                        </div>
                        <h5 className="text-xs font-black text-white leading-snug">{stop.title}</h5>
                        {stop.description && (
                          <p className="text-[11px] text-charcoal-400 mt-1 line-clamp-2 leading-relaxed">
                            {stop.description}
                          </p>
                        )}
                        <div className="mt-2 flex items-center justify-between text-[10.5px] text-charcoal-400 pt-1.5 border-t border-charcoal-800/60">
                          <span>~{stop.duration_minutes || 60} min</span>
                          <span className="font-bold text-white">
                            {stop.estimated_cost ? `₹${stop.estimated_cost}` : 'Included'}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── SAFETY & EMERGENCY MODAL ── */}
      <AnimatePresence>
        {showSafetyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-charcoal-950/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-3xl bg-charcoal-900 border border-charcoal-800 p-6 shadow-2xl text-white"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-red-400">
                  <ShieldAlert className="w-5 h-5 text-red-500" />
                  <h3 className="text-base font-black">Emergency & Safety Hub</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSafetyModal(false)}
                  className="p-1 rounded-lg text-charcoal-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-charcoal-400 leading-relaxed mb-4">
                Direct national emergency dispatch for travellers in India. Location coordinates are shared during dispatch.
              </p>

              <div className="space-y-2.5 mb-6">
                <a
                  href="tel:112"
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-red-950/50 hover:bg-red-900/60 border border-red-800/60 text-white font-bold text-sm transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    <Phone className="w-4 h-4 text-red-400" /> National Emergency (Police / Fire / EMS)
                  </span>
                  <span className="font-mono text-red-400 font-black">112</span>
                </a>
                <a
                  href="tel:108"
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-charcoal-850 hover:bg-charcoal-800 border border-charcoal-700 text-white font-bold text-sm transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    <Phone className="w-4 h-4 text-emerald-400" /> Ambulance / Medical
                  </span>
                  <span className="font-mono text-emerald-400 font-black">108</span>
                </a>
                <a
                  href="tel:139"
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-charcoal-850 hover:bg-charcoal-800 border border-charcoal-700 text-white font-bold text-sm transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    <Train className="w-4 h-4 text-amber-400" /> Railway Security & Help
                  </span>
                  <span className="font-mono text-amber-400 font-black">139</span>
                </a>
              </div>

              <div className="p-3.5 rounded-2xl bg-charcoal-950 border border-charcoal-800 text-xs font-mono text-charcoal-400 mb-5">
                <div className="text-emerald-400 font-bold mb-1">PROTECTED SAFETY RESERVE (15%)</div>
                <div>Your trip includes protected emergency funds set aside, never spent on ordinary items.</div>
              </div>

              {onOpenCancel && (
                <button
                  type="button"
                  onClick={() => {
                    setShowSafetyModal(false);
                    onOpenCancel();
                  }}
                  className="w-full h-11 rounded-2xl bg-charcoal-800 hover:bg-charcoal-700 text-red-400 font-bold text-xs transition-colors"
                >
                  Cancel Trip & Request Refund
                </button>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
