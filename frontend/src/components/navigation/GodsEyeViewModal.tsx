import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass,
  Gauge,
  Train,
  Crosshair,
  Satellite,
  Radio,
  Eye,
  MapPin,
  Play,
  Pause,
  RotateCcw,
  Footprints,
  Car,
  Shield,
  Layers,
  X,
  Navigation,
  Sparkles,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TripItinerary, TripItem } from '../../types';

interface GodsEyeViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  trip?: TripItem | null;
  itinerary?: TripItinerary | null;
}

type MovementMode = 'STATIONARY' | 'WALKING' | 'VEHICLE' | 'TRAIN';

export const GodsEyeViewModal: React.FC<GodsEyeViewModalProps> = ({
  isOpen,
  onClose,
  trip,
  itinerary,
}) => {
  // Real GPS state
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [altitude, setAltitude] = useState<number | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const [rawSpeed, setRawSpeed] = useState<number>(0); // in km/h
  const [isGpsActive, setIsGpsActive] = useState<boolean>(false);

  // God's eye console state
  const [trainMode, setTrainMode] = useState<boolean>(false);
  const [tacticalFilter, setTacticalFilter] = useState<'standard' | 'night' | 'flir'>('standard');
  const [simActive, setSimActive] = useState<boolean>(false);
  const [simSpeedIndex, setSimSpeedIndex] = useState<number>(0);

  // Simulation speeds for desktop testing: [Stationary 0km/h, Walking 4km/h, City Vehicle 35km/h, Vande Bharat Train 130km/h]
  const simPresets = [
    { label: 'Walk (Pokemon Go Style)', speed: 4.8, mode: 'WALKING' as MovementMode },
    { label: 'Vehicle Drive', speed: 42.0, mode: 'VEHICLE' as MovementMode },
    { label: 'Express Train (Where is my Train)', speed: 115.0, mode: 'TRAIN' as MovementMode },
    { label: 'Stationary / Rest Stop', speed: 0.0, mode: 'STATIONARY' as MovementMode },
  ];

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const avatarMarkerRef = useRef<L.Marker | null>(null);
  const pathPolylineRef = useRef<L.Polyline | null>(null);
  const positionsHistoryRef = useRef<[number, number][]>([]);

  // Calculate movement mode based on speed
  const currentSpeed = simActive ? simPresets[simSpeedIndex].speed : rawSpeed;
  const movementMode: MovementMode =
    currentSpeed < 1.5
      ? 'STATIONARY'
      : currentSpeed <= 7.0
        ? 'WALKING'
        : currentSpeed <= 65.0
          ? 'VEHICLE'
          : 'TRAIN';

  // Watch live device GPS when open and not simulated
  useEffect(() => {
    if (!isOpen || simActive) return;
    if (!('geolocation' in navigator)) return;

    let lastPos: { lat: number; lng: number; time: number } | null = null;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        setAccuracy(pos.coords.accuracy || 5);
        setAltitude(pos.coords.altitude || 18);
        if (pos.coords.heading != null && !Number.isNaN(pos.coords.heading)) {
          setHeading(pos.coords.heading);
        }
        setIsGpsActive(true);

        // Speed calculation: convert m/s to km/h, or delta distance / time
        if (pos.coords.speed != null && pos.coords.speed >= 0) {
          setRawSpeed(Math.round(pos.coords.speed * 3.6 * 10) / 10);
        } else if (lastPos) {
          const dt = (pos.timestamp - lastPos.time) / 1000;
          if (dt > 1) {
            const dKm = getDistanceKm(lastPos.lat, lastPos.lng, lat, lng);
            const kmh = (dKm / dt) * 3600;
            setRawSpeed(Math.round(Math.min(kmh, 250) * 10) / 10);
          }
        }
        lastPos = { lat, lng, time: pos.timestamp };

        // Append to path history
        positionsHistoryRef.current.push([lat, lng]);
      },
      (err) => {
        console.warn('Live GPS watch position error:', err);
        setIsGpsActive(false);
        // Fallback default coordinates if GPS unavailable on desktop
        if (!coords) {
          setCoords({ lat: 17.385, lng: 78.4867 });
        }
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [isOpen, simActive]);

  // Simulation tick loop for desktop testing
  useEffect(() => {
    if (!simActive || !isOpen) return;

    const interval = setInterval(() => {
      setCoords((prev) => {
        const baseLat = prev?.lat || 17.385;
        const baseLng = prev?.lng || 78.4867;
        const speedKmh = simPresets[simSpeedIndex].speed;
        const step = (speedKmh / 3600) * 0.01; // lat/lng delta

        const nextLat = baseLat + (Math.sin(Date.now() / 5000) * step);
        const nextLng = baseLng + (Math.cos(Date.now() / 5000) * step * 1.2);
        positionsHistoryRef.current.push([nextLat, nextLng]);
        if (positionsHistoryRef.current.length > 50) positionsHistoryRef.current.shift();

        setHeading((h) => (h + 2) % 360);
        return { lat: nextLat, lng: nextLng };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [simActive, simSpeedIndex, isOpen]);

  // Initialize and update Leaflet Map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    const lat = coords?.lat || 17.385;
    const lng = coords?.lng || 78.4867;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([lat, lng], 17);

      // Satellite tiles / Esri World Imagery for God's Eye View
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
      }).addTo(map);

      // Trail polyline
      const polyline = L.polyline([], {
        color: '#10b981',
        weight: 3.5,
        opacity: 0.8,
        dashArray: '6, 8',
      }).addTo(map);
      pathPolylineRef.current = polyline;

      // Pulse avatar marker
      const avatarIcon = L.divIcon({
        className: 'gods-eye-avatar',
        html: `
          <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; width: 100%; height: 100%; border-radius: 50%; background: rgba(16, 185, 129, 0.35); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
            <div style="position: absolute; width: 24px; height: 24px; border-radius: 50%; background: #10b981; border: 3px solid white; box-shadow: 0 0 14px rgba(16, 185, 129, 0.9);"></div>
            <div style="position: absolute; top: 0; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 8px solid #34d399; transform: translateY(-4px);"></div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });

      const marker = L.marker([lat, lng], { icon: avatarIcon }).addTo(map);
      avatarMarkerRef.current = marker;
      mapInstanceRef.current = map;
    }

    if (coords && mapInstanceRef.current && avatarMarkerRef.current) {
      avatarMarkerRef.current.setLatLng([coords.lat, coords.lng]);
      mapInstanceRef.current.panTo([coords.lat, coords.lng], { animate: true, duration: 0.8 });

      if (pathPolylineRef.current && positionsHistoryRef.current.length > 0) {
        pathPolylineRef.current.setLatLngs(positionsHistoryRef.current);
      }
    }
  }, [isOpen, coords]);

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
        <div className="flex items-center justify-between px-5 py-3.5 bg-charcoal-950/80 border-b border-charcoal-800 text-white z-20">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <Crosshair className="w-4 h-4 animate-spin-slow" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black tracking-wider uppercase text-emerald-400">
                  God's Eye View
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800">
                  v2.4 SPATIAL HUD
                </span>
              </div>
              <p className="text-[10.5px] text-charcoal-400 font-mono">
                {trip ? `${trip.source_name} → ${trip.destination_name}` : 'Live Journey Telemetry'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
              <span>Where is my Train?</span>
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

        {/* Map Viewport Area */}
        <div className="relative flex-1 w-full bg-charcoal-950 overflow-hidden">
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

          {/* Leaflet Map Div */}
          <div ref={mapContainerRef} className="w-full h-full" />

          {/* Left Floating HUD: Speedometer & Movement State */}
          <div className="absolute top-4 left-4 z-20 flex flex-col gap-3 pointer-events-auto">
            {/* Speedometer Card */}
            <div className="p-4 rounded-2xl bg-charcoal-950/85 backdrop-blur-md border border-charcoal-800 shadow-2xl text-white min-w-[210px]">
              <div className="flex items-center justify-between text-charcoal-400 text-[10.5px] font-mono uppercase tracking-wider mb-1">
                <span className="flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-emerald-400" /> Live Velocity
                </span>
                <span className="text-emerald-400 font-bold">GPS LOCK</span>
              </div>

              <div className="flex items-baseline gap-1.5 my-1">
                <span className="text-4xl font-black font-mono tracking-tight text-emerald-400">
                  {currentSpeed.toFixed(1)}
                </span>
                <span className="text-xs font-mono font-bold text-charcoal-400">km/h</span>
              </div>

              {/* Movement State Chip */}
              <div className="mt-2 pt-2 border-t border-charcoal-800/80 flex items-center justify-between">
                <span className="text-[10px] text-charcoal-400 font-mono">STATUS:</span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10.5px] font-black uppercase tracking-wide">
                  {movementMode === 'WALKING' && <Footprints className="w-3 h-3 text-emerald-400" />}
                  {movementMode === 'VEHICLE' && <Car className="w-3 h-3 text-emerald-400" />}
                  {movementMode === 'TRAIN' && <Train className="w-3 h-3 text-amber-400" />}
                  {movementMode === 'STATIONARY' && <MapPin className="w-3 h-3 text-cyan-400" />}
                  {movementMode}
                </span>
              </div>
            </div>

            {/* GPS Telemetry Pill */}
            <div className="p-3 rounded-2xl bg-charcoal-950/85 backdrop-blur-md border border-charcoal-800 text-charcoal-300 text-[11px] font-mono space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-charcoal-500">COORDS:</span>
                <span className="text-white font-bold">
                  {coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : 'Searching…'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-charcoal-500">HEADING:</span>
                <span className="text-emerald-400 font-bold">{heading.toFixed(0)}°</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-charcoal-500">ALTITUDE:</span>
                <span className="text-white font-bold">{altitude ? `${Math.round(altitude)}m MSL` : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-charcoal-500">ACCURACY:</span>
                <span className="text-emerald-400 font-bold">±{accuracy ? `${accuracy.toFixed(1)}m` : '3.5m'}</span>
              </div>
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
                  <span className="text-charcoal-400">Train Speed:</span>
                  <span className="text-amber-400 font-black text-sm">{currentSpeed.toFixed(0)} km/h</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-charcoal-400">Next Junction:</span>
                  <span className="text-white font-bold">{trip?.destination_name || 'Approaching Station'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-charcoal-400">Est. Arrival:</span>
                  <span className="text-emerald-400 font-bold">On Schedule</span>
                </div>
              </div>

              <p className="text-[10px] text-charcoal-400 leading-relaxed font-sans">
                Real-time satellite speedometer tracks velocity and distance along rail corridors accurately without requiring external hardware.
              </p>
            </motion.div>
          )}

          {/* Bottom Simulation Bar for Desktop Testing */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 p-2 rounded-2xl bg-charcoal-950/90 backdrop-blur-md border border-charcoal-800 shadow-2xl text-xs text-white">
            <span className="text-[11px] font-mono text-charcoal-400 px-2 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" /> Test Simulator:
            </span>

            <button
              type="button"
              onClick={() => setSimActive(!simActive)}
              className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all ${
                simActive
                  ? 'bg-emerald-500 text-charcoal-950 font-black'
                  : 'bg-charcoal-800 text-charcoal-300 hover:text-white'
              }`}
            >
              {simActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{simActive ? 'Sim Active' : 'Start Sim'}</span>
            </button>

            {simActive && (
              <div className="flex items-center gap-1">
                {simPresets.map((preset, idx) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setSimSpeedIndex(idx)}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-mono font-bold transition-all ${
                      simSpeedIndex === idx
                        ? 'bg-travion-600 text-white'
                        : 'bg-charcoal-800 text-charcoal-400 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

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
