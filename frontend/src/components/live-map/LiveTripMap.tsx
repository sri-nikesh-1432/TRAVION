import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  TrainFront, BedDouble, Utensils, Mountain, Gem, ShieldAlert, PhoneCall,
  Navigation, Layers, CloudSun, Clock, Star, ArrowUpRight, X, Compass, Sparkles
} from 'lucide-react';
import { ItineraryStop, StopCategory } from '../../types';
import { iconSvgString } from './leafletMarkerIcons';

// Google Maps base tiles (Maps JavaScript API key from frontend/.env)
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

interface LiveTripMapProps {
  stops: ItineraryStop[];
  selectedStop: ItineraryStop | null;
  onSelectStop: (stop: ItineraryStop) => void;
  onStartNavigation: (stop: ItineraryStop) => void;
  avatarPosition?: [number, number];
}

const CATEGORY_ICONS: Record<StopCategory, { glyph: string; color: string; label: string }> = {
  transport: { glyph: 'train-front', color: '#0284c7', label: 'Transport' },
  stay: { glyph: 'bed-double', color: '#6366f1', label: 'Stay' },
  food: { glyph: 'utensils', color: '#f59e0b', label: 'Dining' },
  attraction: { glyph: 'landmark', color: '#10b981', label: 'Attraction' },
  hidden_gem: { glyph: 'gem', color: '#ec4899', label: 'Hidden Gem' },
  safety: { glyph: 'shield-alert', color: '#eab308', label: 'Safety Note' },
  emergency: { glyph: 'phone-call', color: '#ef4444', label: 'Emergency' }
};

// Same categories rendered as React icons for in-DOM UI (bottom card, legend)
const CATEGORY_COMPONENTS: Record<StopCategory, React.ComponentType<{ className?: string }>> = {
  transport: TrainFront,
  stay: BedDouble,
  food: Utensils,
  attraction: Mountain,
  hidden_gem: Gem,
  safety: ShieldAlert,
  emergency: PhoneCall
};

export const LiveTripMap: React.FC<LiveTripMapProps> = ({
  stops,
  selectedStop,
  onSelectStop,
  onStartNavigation,
  avatarPosition
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [key: string]: L.Marker }>({});
  const polylineRef = useRef<L.Polyline | null>(null);
  const avatarMarkerRef = useRef<L.Marker | null>(null);

  const [mapType, setMapType] = useState<'roadmap' | 'satellite' | 'terrain' | 'google'>('roadmap');
  const [activeLayer, setActiveLayer] = useState<L.TileLayer | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Neutral India default; when stops exist the map is centred on the real
    // planned geometry (fitBounds below), never on a hardcoded city.
    const initialLat = stops.length > 0 ? stops[0].lat : 20.5937;
    const initialLng = stops.length > 0 ? stops[0].lng : 78.9629;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: stops.length > 0 ? 10 : 5,
      zoomControl: false
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    const layer = L.tileLayer(tileUrl, {
      attribution: '&copy; OpenStreetMap contributors | Travion Verified Maps'
    }).addTo(map);

    setActiveLayer(layer);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Map Layer based on MapType
  useEffect(() => {
    if (!mapRef.current) return;
    if (activeLayer) {
      mapRef.current.removeLayer(activeLayer);
    }

    let url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    let attribution = '&copy; OpenStreetMap contributors | Travion';
    if (mapType === 'satellite') {
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      attribution = 'Tiles &copy; Esri | Travion';
    } else if (mapType === 'terrain') {
      url = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
      attribution = '&copy; OpenTopoMap contributors | Travion';
    } else if (mapType === 'google' && GOOGLE_MAPS_API_KEY) {
      // Google Maps base roadmap tiles via the Maps JS API key
      url = `https://maps.googleapis.com/maps/vt?lyrs=m&x={x}&y={y}&z={z}&key=${GOOGLE_MAPS_API_KEY}`;
      attribution = '&copy; Google Maps | Travion';
    }

    const newLayer = L.tileLayer(url, {
      attribution
    }).addTo(mapRef.current);

    setActiveLayer(newLayer);
  }, [mapType]);

  // Update Markers & Polyline
  useEffect(() => {
    if (!mapRef.current || stops.length === 0) return;
    const map = mapRef.current;

    // Clear old markers
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    if (polylineRef.current) polylineRef.current.remove();

    const coordinates: [number, number][] = [];

    stops.forEach((stop) => {
      coordinates.push([stop.lat, stop.lng]);
      const config = CATEGORY_ICONS[stop.category] || CATEGORY_ICONS.attraction;
      const isSelected = selectedStop?.id === stop.id;

      const html = `
        <div class="relative group cursor-pointer flex items-center justify-center">
          <div style="background-color: ${config.color}" class="w-10 h-10 rounded-2xl flex items-center justify-center shadow-soft-lg text-white transform transition-all duration-300 ${
            isSelected ? 'scale-125 ring-4 ring-white shadow-floating z-50' : 'hover:scale-110'
          }">
            ${iconSvgString(config.glyph, { size: 19, stroke: '#ffffff', strokeWidth: 2 })}
          </div>
          ${isSelected ? '<div class="absolute -bottom-2 w-3 h-3 rotate-45" style="background-color: ' + config.color + '"></div>' : ''}
        </div>
      `;

      const icon = L.divIcon({
        className: 'custom-travion-pin',
        html,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });

      const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map);
      marker.on('click', () => onSelectStop(stop));
      markersRef.current[stop.id] = marker;
    });

    // Draw connected route polyline
    if (coordinates.length > 1) {
      const polyline = L.polyline(coordinates, {
        color: '#0284c7',
        weight: 4,
        opacity: 0.8,
        dashArray: '8, 8',
        lineCap: 'round'
      }).addTo(map);
      polylineRef.current = polyline;

      // Fit bounds with comfortable padding
      const bounds = L.latLngBounds(coordinates);
      map.fitBounds(bounds, { padding: [60, 60] });
    }
  }, [stops, selectedStop]);

  // Pan to selected stop
  useEffect(() => {
    if (!mapRef.current || !selectedStop) return;
    mapRef.current.flyTo([selectedStop.lat, selectedStop.lng], 14, {
      duration: 1.2,
      easeLinearity: 0.25
    });
  }, [selectedStop]);

  // Live Traveller Avatar — only ever drawn from the device's real GPS position.
  // No avatar is shown when location permission has not been granted; the map
  // never fabricates a position.
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const pos = avatarPosition; // [lat, lng] from real device GPS, or undefined

    if (!pos) {
      if (avatarMarkerRef.current) {
        map.removeLayer(avatarMarkerRef.current);
        avatarMarkerRef.current = null;
      }
      return;
    }

    if (!avatarMarkerRef.current) {
      const avatarHtml = `
        <div class="relative flex items-center justify-center travion-avatar-pulse">
          <div class="w-11 h-11 rounded-full bg-travion-500 border-2 border-white shadow-floating flex items-center justify-center text-white">
            ${iconSvgString('navigation', { size: 20, stroke: '#ffffff', strokeWidth: 2.2 })}
          </div>
          <div class="absolute -bottom-1 px-1.5 py-0.5 bg-slate-900 text-[9px] font-bold text-white rounded-full">
            YOU
          </div>
        </div>
      `;
      const avatarIcon = L.divIcon({
        className: 'travion-avatar-pin',
        html: avatarHtml,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });
      avatarMarkerRef.current = L.marker(pos as [number, number], { icon: avatarIcon }).addTo(map);
    } else {
      avatarMarkerRef.current.setLatLng(pos as [number, number]);
    }
  }, [avatarPosition]);

  return (
    <div className="relative w-full h-full min-h-[480px] rounded-3xl overflow-hidden border border-slate-200/80 shadow-soft">
      {/* The Leaflet Container */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Map Type Switcher Floating Toggle */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-1.5 p-1 rounded-2xl bg-white/90 backdrop-blur-md shadow-soft border border-slate-200 text-xs font-semibold">
        <button
          onClick={() => setMapType('roadmap')}
          className={`px-3 py-1.5 rounded-xl transition-all ${
            mapType === 'roadmap' ? 'bg-travion-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Roadmap
        </button>
        <button
          onClick={() => setMapType('satellite')}
          className={`px-3 py-1.5 rounded-xl transition-all ${
            mapType === 'satellite' ? 'bg-travion-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Satellite
        </button>
        <button
          onClick={() => setMapType('terrain')}
          className={`px-3 py-1.5 rounded-xl transition-all ${
            mapType === 'terrain' ? 'bg-travion-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Terrain
        </button>
        {GOOGLE_MAPS_API_KEY && (
          <button
            onClick={() => setMapType('google')}
            className={`px-3 py-1.5 rounded-xl transition-all ${
              mapType === 'google' ? 'bg-travion-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Google
          </button>
        )}
      </div>

      {/* Bottom Sheet / Side Card on Selected Pin */}
      <AnimatePresence>
        {selectedStop && (
          <motion.div
            initial={{ opacity: 0, y: 25, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 25, scale: 0.96 }}
            className="absolute bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-96 z-30 bg-white/95 backdrop-blur-md rounded-3xl p-5 shadow-floating border border-travion-100"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
                  style={{ backgroundColor: (CATEGORY_ICONS[selectedStop.category] || CATEGORY_ICONS.attraction).color }}
                >
                  {(() => {
                    const Comp = CATEGORY_COMPONENTS[selectedStop.category] || Mountain;
                    return <Comp className="w-4.5 h-4.5" />;
                  })()}
                </span>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-travion-600">
                    Day {selectedStop.day} · {selectedStop.time}
                  </span>
                  <h4 className="text-base font-bold text-slate-900 leading-tight">
                    {selectedStop.title}
                  </h4>
                </div>
              </div>
              <button
                onClick={() => onSelectStop(null as any)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-3 line-clamp-2">
              {selectedStop.description}
            </p>

            {/* Weather, Duration & Cost Pills */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600 mb-4">
              {selectedStop.weather_note && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700">
                  <CloudSun className="w-3.5 h-3.5" />
                  <span>{selectedStop.weather_note}</span>
                </span>
              )}
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100">
                <Clock className="w-3.5 h-3.5" />
                <span>{selectedStop.duration_minutes} min</span>
              </span>
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold">
                ₹{selectedStop.estimated_cost}
              </span>
            </div>

            {/* AI Note if available */}
            {selectedStop.ai_note && (
              <div className="p-2.5 rounded-xl bg-travion-50 border border-travion-100 text-xs text-travion-800 mb-4 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-travion-600 shrink-0 mt-0.5" />
                <span>{selectedStop.ai_note}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onStartNavigation(selectedStop)}
                className="flex-1 py-2.5 rounded-xl bg-travion-600 hover:bg-travion-700 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-1.5 transition-all"
              >
                <Navigation className="w-4 h-4" />
                <span>Navigate to Stop</span>
              </button>
              <a
                href={`https://maps.google.com/?q=${selectedStop.lat},${selectedStop.lng}`}
                target="_blank"
                rel="noreferrer"
                className="p-2.5 rounded-xl border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 transition-colors"
                title="Open in Google Maps"
              >
                <ArrowUpRight className="w-4 h-4" />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
