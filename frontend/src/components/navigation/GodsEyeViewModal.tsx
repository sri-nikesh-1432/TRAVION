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
  X,
  Navigation,
  Sparkles,
  Lock,
  ArrowRight,
  ShieldAlert,
  Clock,
  Calendar,
  Utensils,
  BedDouble,
  ChevronRight,
  CheckCircle2,
  BookOpen,
  Layers,
  LocateFixed,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TripItinerary, TripItem, ItineraryStop } from '../../types';
import { api } from '../../services/api';

interface GodsEyeViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  trip?: TripItem | null;
  itinerary?: TripItinerary | null;
  onProceedToPayment?: () => void;
}

type MovementMode = 'STATIONARY' | 'WALKING' | 'VEHICLE' | 'TRAIN';

export const GodsEyeViewModal: React.FC<GodsEyeViewModalProps> = ({
  isOpen,
  onClose,
  trip,
  itinerary,
  onProceedToPayment,
}) => {
  // Payment Gating state
  const [checkingEntitlement, setCheckingEntitlement] = useState<boolean>(true);
  const [isEntitled, setIsEntitled] = useState<boolean>(false);
  const [entitlementReason, setEntitlementReason] = useState<string>('');

  // Real device GPS state
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [altitude, setAltitude] = useState<number | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const [speedKmh, setSpeedKmh] = useState<number>(0);
  const [isGpsActive, setIsGpsActive] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Companion UI state
  const [trainMode, setTrainMode] = useState<boolean>(false);
  const [showStoryline, setShowStoryline] = useState<boolean>(true);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(0);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [tacticalFilter, setTacticalFilter] = useState<'standard' | 'night' | 'flir'>('standard');

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const avatarMarkerRef = useRef<L.Marker | null>(null);
  const pathPolylineRef = useRef<L.Polyline | null>(null);
  const stopMarkersLayerRef = useRef<L.LayerGroup | null>(null);
  const positionsHistoryRef = useRef<[number, number][]>([]);

  const days = itinerary?.days || [];
  const currentDay = days[selectedDayIndex] || days[0] || null;
  const stops = currentDay?.stops || [];

  // Determine "Up Next" stop
  const upNextStop: ItineraryStop | null = useMemo(() => {
    if (!stops || stops.length === 0) return null;
    if (activeStopId) {
      const match = stops.find((s) => s.id === activeStopId);
      if (match) return match;
    }
    return stops[0];
  }, [stops, activeStopId]);

  // Check payment entitlement whenever modal opens or trip changes
  useEffect(() => {
    if (!isOpen || !trip) {
      setCheckingEntitlement(false);
      return;
    }

    const checkEntitlement = async () => {
      setCheckingEntitlement(true);
      try {
        const res = await api.getTrackingEntitlement(trip.id);
        setIsEntitled(res.entitled);
        setEntitlementReason(res.reason || '');
      } catch {
        const paid = ['PAID', 'GUIDE_ASSIGNED', 'ACTIVE'].includes((trip.status || '').toUpperCase());
        setIsEntitled(paid);
        if (!paid) {
          setEntitlementReason('Live Tour Companion & GPS Navigation is reserved for confirmed and active journeys.');
        }
      } finally {
        setCheckingEntitlement(false);
      }
    };

    checkEntitlement();
  }, [isOpen, trip?.id, trip?.status]);

  // Movement mode derived purely from genuine device velocity
  const movementMode: MovementMode =
    speedKmh < 1.5
      ? 'STATIONARY'
      : speedKmh <= 7.0
        ? 'WALKING'
        : speedKmh <= 65.0
          ? 'VEHICLE'
          : 'TRAIN';

  // Watch real device GPS only when paid/entitled
  useEffect(() => {
    if (!isOpen || !isEntitled) return;
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
        if (positionsHistoryRef.current.length > 120) {
          positionsHistoryRef.current.shift();
        }
      },
      (err) => {
        setIsGpsActive(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError('Location permission denied. Please allow GPS access in your browser settings.');
        } else {
          setGpsError('Acquiring high-accuracy satellite lock…');
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [isOpen, isEntitled]);

  // Center on specific stop
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

  // Center on user position
  const centerUser = () => {
    if (coords && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([coords.lat, coords.lng], 16, {
        duration: 1.0,
      });
    }
  };

  // Initialize and update Leaflet Map
  useEffect(() => {
    if (!isOpen || !isEntitled || !mapContainerRef.current) return;

    const initialLat = coords?.lat || 17.385;
    const initialLng = coords?.lng || 78.4867;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([initialLat, initialLng], 14);

      // High-resolution satellite layer
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{x}/{y}',
        { maxZoom: 19 }
      ).addTo(map);

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
  }, [isOpen, isEntitled, coords]);

  // Update itinerary waypoints when day or stops change
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

        const isFood = ['food', 'meal_hold'].includes(String(stop.category).toLowerCase());
        const isStay = String(stop.category).toLowerCase() === 'stay';
        const badgeColor = isStay ? '#6366f1' : isFood ? '#f59e0b' : '#10b981';

        const stopIcon = L.divIcon({
          className: 'companion-stop-marker',
          html: `
            <div style="background: rgba(15, 23, 42, 0.9); border: 2px solid ${badgeColor}; color: white; border-radius: 9999px; padding: 2px 8px; font-weight: 800; font-size: 11px; box-shadow: 0 4px 14px rgba(0,0,0,0.6); display: flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer;">
              <span style="background: ${badgeColor}; color: black; border-radius: 9999px; width: 15px; height: 15px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 900;">${index + 1}</span>
              <span style="max-width: 100px; overflow: hidden; text-overflow: ellipsis;">${stop.title}</span>
            </div>
          `,
          iconSize: [120, 24],
          iconAnchor: [60, 12],
        });

        const stopMarker = L.marker(point, { icon: stopIcon }).addTo(group);
        stopMarker.bindPopup(`
          <div style="font-family: sans-serif; padding: 4px; min-width: 160px; color: #0f172a;">
            <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #10b981;">Stop ${index + 1} · ${stop.time}</div>
            <div style="font-size: 13px; font-weight: 800; margin: 2px 0;">${stop.title}</div>
            <div style="font-size: 11px; color: #64748b;">${stop.duration_minutes ? `~${stop.duration_minutes} min` : ''} · ${stop.estimated_cost ? `₹${stop.estimated_cost}` : 'Included'}</div>
          </div>
        `);

        stopMarker.on('click', () => {
          setActiveStopId(stop.id);
        });
      }
    });

    // If no device GPS is locked yet, fit bounds to the day's stops
    if (!coords && validPoints.length > 0 && mapInstanceRef.current) {
      mapInstanceRef.current.fitBounds(validPoints, { padding: [50, 50], maxZoom: 15 });
    }
  }, [stops, coords]);

  // Clean up on unmount or close
  useEffect(() => {
    if (!isOpen && mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-charcoal-950/90 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-6xl h-[92vh] rounded-3xl overflow-hidden bg-charcoal-900 border border-emerald-500/30 shadow-2xl flex flex-col font-sans"
      >
        {/* Top Tactical HUD Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-charcoal-950/90 border-b border-charcoal-800 text-white z-20">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <Navigation className="w-4 h-4 text-emerald-400" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black tracking-wider uppercase text-emerald-400">
                  Live Journey Companion
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800">
                  REAL-TIME TOUR NAVIGATOR
                </span>
              </div>
              <p className="text-[10.5px] text-charcoal-400 font-mono">
                {trip ? `${trip.source_name} → ${trip.destination_name}` : 'Live Journey Telemetry'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isEntitled && (
              <>
                {/* Storyline Drawer Toggle */}
                <button
                  type="button"
                  onClick={() => setShowStoryline(!showStoryline)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
                    showStoryline
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm'
                      : 'bg-charcoal-800/60 text-charcoal-400 border-charcoal-700 hover:text-white'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>{showStoryline ? 'Hide Storyline' : 'Show Storyline'}</span>
                </button>

                {/* Where is my Train Toggle */}
                <button
                  type="button"
                  onClick={() => setTrainMode(!trainMode)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
                    trainMode
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/50 shadow-sm'
                      : 'bg-charcoal-800/60 text-charcoal-400 border-charcoal-700 hover:text-white'
                  }`}
                >
                  <Train className="w-3.5 h-3.5" />
                  <span>Train Mode</span>
                </button>

                {/* Tactical Vision Filter Toggle */}
                <div className="hidden sm:flex items-center p-0.5 rounded-xl bg-charcoal-800/80 border border-charcoal-700 text-xs">
                  {(['standard', 'night', 'flir'] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setTacticalFilter(filter)}
                      className={`px-2.5 py-1 rounded-lg font-mono text-[10px] uppercase font-bold transition-all ${
                        tacticalFilter === filter
                          ? 'bg-emerald-500 text-charcoal-950 font-black'
                          : 'text-charcoal-400 hover:text-white'
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-charcoal-800 hover:bg-charcoal-700 text-charcoal-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body: Payment Locked Screen vs Full Live Tracking */}
        {checkingEntitlement ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-charcoal-950 text-white">
            <Crosshair className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
            <p className="text-sm font-mono text-emerald-400 tracking-wide">
              VERIFYING SATELLITE TELEMETRY ENTITLEMENT…
            </p>
          </div>
        ) : !isEntitled ? (
          /* Locked State for Unpaid Trips */
          <div className="flex-1 flex flex-col items-center justify-center p-6 bg-charcoal-950 text-white text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/20 via-charcoal-950 to-charcoal-950 pointer-events-none" />

            <div className="relative z-10 max-w-lg p-8 rounded-3xl bg-charcoal-900/90 border border-emerald-500/30 shadow-2xl backdrop-blur-xl">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto mb-5 shadow-lg">
                <Lock className="w-8 h-8" />
              </div>

              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono font-bold uppercase tracking-wider mb-3">
                <ShieldAlert className="w-3.5 h-3.5" />
                Access Restricted · Active Trip Required
              </div>

              <h2 className="text-2xl font-black text-white tracking-tight">
                Live Journey Companion is Reserved for Confirmed Trips
              </h2>

              <p className="mt-3 text-sm text-charcoal-300 leading-relaxed">
                {entitlementReason ||
                  'Real-time GPS device tracking, chronological storyline navigation, and live rail telemetry are activated as soon as your journey is confirmed.'}
              </p>

              <div className="mt-6 p-4 rounded-2xl bg-charcoal-950/80 border border-charcoal-800 text-left space-y-2 text-xs font-mono text-charcoal-400">
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> Real-time device GPS positioning with dynamic waypoint guidance
                </div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> Chronological Storyline Drawer with "Up Next" focus
                </div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> High-precision speedometer (Walking, Driving & High-speed Rail)
                </div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> One-click satellite waypoint inspection & map centering
                </div>
              </div>

              <div className="mt-7 flex flex-col sm:flex-row items-center gap-3 justify-center">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    if (onProceedToPayment) onProceedToPayment();
                  }}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 h-12 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-charcoal-950 font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/20"
                >
                  <span>Complete Review & Payment</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto px-5 h-12 rounded-xl bg-charcoal-800 hover:bg-charcoal-700 text-charcoal-300 font-bold text-xs transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Entitled / Paid: Genuine Live GPS Telemetry View with Storyline Drawer */
          <div className="relative flex-1 w-full bg-charcoal-950 overflow-hidden flex">
            {/* Tactical Filters Overlay */}
            <div
              className={`absolute inset-0 z-10 pointer-events-none transition-all duration-300 ${
                tacticalFilter === 'night'
                  ? 'mix-blend-color-burn bg-emerald-950/40'
                  : tacticalFilter === 'flir'
                    ? 'mix-blend-difference bg-amber-950/30'
                    : ''
              }`}
            />

            {/* Map Area */}
            <div className="relative flex-1 h-full">
              {/* Leaflet Map Div */}
              <div ref={mapContainerRef} className="w-full h-full" />

              {/* GPS Status Banner if Signal Error */}
              {gpsError && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl bg-amber-500/90 text-charcoal-950 text-xs font-bold flex items-center gap-2 shadow-lg">
                  <Radio className="w-4 h-4 animate-pulse" />
                  <span>{gpsError}</span>
                </div>
              )}

              {/* Left Floating HUD: Speedometer & Telemetry */}
              <div className="absolute top-4 left-4 z-20 flex flex-col gap-3 pointer-events-auto">
                {/* Speedometer Card */}
                <div className="p-3.5 rounded-2xl bg-charcoal-950/85 backdrop-blur-md border border-charcoal-800 shadow-2xl text-white min-w-[200px]">
                  <div className="flex items-center justify-between text-charcoal-400 text-[10px] font-mono uppercase tracking-wider mb-1">
                    <span className="flex items-center gap-1.5">
                      <Gauge className="w-3.5 h-3.5 text-emerald-400" /> Live Velocity
                    </span>
                    <span className={isGpsActive ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                      {isGpsActive ? 'GPS LOCK' : 'ACQUIRING'}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-1.5 my-0.5">
                    <span className="text-3xl font-black font-mono tracking-tight text-emerald-400">
                      {speedKmh.toFixed(1)}
                    </span>
                    <span className="text-xs font-mono font-bold text-charcoal-400">km/h</span>
                  </div>

                  {/* Movement State Chip */}
                  <div className="mt-2 pt-2 border-t border-charcoal-800/80 flex items-center justify-between">
                    <span className="text-[10px] text-charcoal-400 font-mono">STATUS:</span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black uppercase tracking-wide">
                      {movementMode === 'WALKING' && <Footprints className="w-3 h-3 text-emerald-400" />}
                      {movementMode === 'VEHICLE' && <Car className="w-3 h-3 text-emerald-400" />}
                      {movementMode === 'TRAIN' && <Train className="w-3 h-3 text-amber-400" />}
                      {movementMode === 'STATIONARY' && <MapPin className="w-3 h-3 text-cyan-400" />}
                      {movementMode}
                    </span>
                  </div>
                </div>

                {/* Recenter / GPS Actions */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={centerUser}
                    className="p-2.5 rounded-xl bg-charcoal-950/85 hover:bg-charcoal-900 border border-charcoal-800 text-emerald-400 text-xs font-bold flex items-center gap-1.5 shadow-lg backdrop-blur-md transition-all"
                  >
                    <LocateFixed className="w-3.5 h-3.5" />
                    <span>My Location</span>
                  </button>
                </div>
              </div>

              {/* Right Floating HUD: Where is my Train Mode Panel */}
              {trainMode && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="absolute top-4 right-4 z-20 p-4 rounded-2xl bg-charcoal-950/90 backdrop-blur-md border border-amber-500/40 shadow-2xl text-white max-w-xs w-full pointer-events-auto"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                        <Train className="w-4 h-4" />
                      </span>
                      <div>
                        <span className="text-xs font-black uppercase text-amber-400">Where is my Train</span>
                        <p className="text-[10px] text-charcoal-400 font-mono">Live Rail GPS Speedometer</p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold">
                      ON ROUTE
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-charcoal-900 border border-charcoal-800 mb-3 space-y-1.5 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-charcoal-400">Rail Velocity:</span>
                      <span className="text-amber-400 font-black text-sm">{speedKmh.toFixed(0)} km/h</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-charcoal-400">Destination Hub:</span>
                      <span className="text-white font-bold">{trip?.destination_name || 'Approaching Station'}</span>
                    </div>
                  </div>

                  <p className="text-[10px] text-charcoal-400 leading-relaxed font-sans">
                    Real-time satellite GPS tracks velocity and position accurately along Indian rail corridors.
                  </p>
                </motion.div>
              )}
            </div>

            {/* Interactive Storyline Drawer */}
            <AnimatePresence>
              {showStoryline && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 340, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="h-full bg-charcoal-950/90 backdrop-blur-xl border-l border-charcoal-800 flex flex-col z-20 shrink-0 text-white overflow-hidden shadow-2xl"
                >
                  {/* Storyline Header */}
                  <div className="p-4 border-b border-charcoal-800 flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        Itinerary Storyline
                      </h3>
                      <p className="text-[11px] text-charcoal-400 mt-0.5">
                        {days.length} Day Journey · Select any stop to center
                      </p>
                    </div>
                  </div>

                  {/* Day Pills Bar */}
                  {days.length > 1 && (
                    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-charcoal-800 overflow-x-auto scrollbar-none bg-charcoal-900/50">
                      {days.map((day, dIdx) => (
                        <button
                          key={day.day}
                          type="button"
                          onClick={() => setSelectedDayIndex(dIdx)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
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

                  {/* Up Next Spotlight Card */}
                  {upNextStop && (
                    <div className="p-3 m-3 rounded-2xl bg-gradient-to-br from-charcoal-900 to-charcoal-850 border border-emerald-500/40 shadow-soft">
                      <div className="flex items-center justify-between text-[10px] font-mono text-emerald-400 uppercase tracking-wider mb-1">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> UP NEXT
                        </span>
                        <span>{upNextStop.time}</span>
                      </div>
                      <h4 className="text-sm font-black text-white leading-snug line-clamp-1">
                        {upNextStop.title}
                      </h4>
                      <p className="text-[11px] text-charcoal-400 mt-0.5 line-clamp-1">
                        {upNextStop.duration_minutes ? `Duration ~${upNextStop.duration_minutes} min` : 'Scheduled stop'}
                      </p>
                      <button
                        type="button"
                        onClick={() => focusStop(upNextStop)}
                        className="mt-2.5 w-full h-8 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-emerald-500/30"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>Center on Map</span>
                      </button>
                    </div>
                  )}

                  {/* Chronological Stop List */}
                  <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-charcoal-500">
                      {currentDay?.title || `Day ${selectedDayIndex + 1} Timeline`}
                    </div>

                    <ol className="relative border-l border-charcoal-800 ml-2 space-y-4">
                      {stops.map((stop, sIdx) => {
                        const isSelected = activeStopId === stop.id;
                        const isFood = ['food', 'meal_hold'].includes(String(stop.category).toLowerCase());
                        const isStay = String(stop.category).toLowerCase() === 'stay';

                        return (
                          <li
                            key={stop.id || sIdx}
                            onClick={() => focusStop(stop)}
                            className={`ml-4 p-2.5 rounded-xl cursor-pointer transition-all border ${
                              isSelected
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-white'
                                : 'bg-charcoal-900/60 hover:bg-charcoal-800/60 border-charcoal-800/80 text-charcoal-300'
                            }`}
                          >
                            <span
                              className={`absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full border-2 border-charcoal-950 ${
                                isSelected ? 'bg-emerald-400 ring-2 ring-emerald-500/40' : 'bg-charcoal-600'
                              }`}
                            />
                            <div className="flex items-center justify-between text-[10.5px] font-mono text-charcoal-400 mb-0.5">
                              <span>{stop.time}</span>
                              <span className="flex items-center gap-1">
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
                            <div className="text-xs font-bold text-white line-clamp-1">{stop.title}</div>
                            {stop.duration_minutes ? (
                              <div className="text-[10.5px] text-charcoal-400 mt-0.5">
                                ~{stop.duration_minutes} min
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export const LiveJourneyCompanionModal = GodsEyeViewModal;

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
  return R * c;
}
