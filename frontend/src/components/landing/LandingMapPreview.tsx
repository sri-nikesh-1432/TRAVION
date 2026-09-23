import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { motion } from 'framer-motion';
import { ArrowRight, Clock, MapPin, Mountain, Utensils, Landmark, Navigation } from 'lucide-react';
import { MAP_PREVIEW_STOPS, MAP_PREVIEW_PANEL } from '../../data/landingData';

/**
 * Real Leaflet map used on the landing page: live OpenStreetMap tiles, real
 * Munnar-area geography, marker ↔ list synchronisation, and a glass
 * information panel whose CTA opens the actual planning flow. This is the
 * same Leaflet stack the product map uses — no fake canvas tiles.
 */

const KIND_META: Record<string, { color: string; label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  arrival: { color: '#267aa8', label: 'Arrival', Icon: MapPin },
  culture: { color: '#a97f33', label: 'Culture', Icon: Landmark },
  food: { color: '#c58a2b', label: 'Food', Icon: Utensils },
  viewpoint: { color: '#678169', label: 'Viewpoint', Icon: Mountain },
  nature: { color: '#4f6653', label: 'Nature', Icon: Navigation },
};

const kindMeta = (kind: string) => KIND_META[kind] ?? KIND_META.arrival;

const numberedIcon = (n: number, color: string) =>
  L.divIcon({
    className: 'travion-preview-marker',
    html: `<span style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${color};color:#fff;font:800 12px/1 Inter,sans-serif;border:2.5px solid #fffdf8;box-shadow:0 4px 12px rgba(20,55,78,.35);">${n}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

interface LandingMapPreviewProps {
  openAuth: (loginMode: boolean) => void;
}

export const LandingMapPreview: React.FC<LandingMapPreviewProps> = ({ openAuth }) => {
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const [activeId, setActiveId] = useState<string>(MAP_PREVIEW_STOPS[0].id);
  const reduce = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  /* Initialise Leaflet once */
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, {
      center: [MAP_PREVIEW_STOPS[0].lat, MAP_PREVIEW_STOPS[0].lng],
      zoom: 12,
      zoomControl: false,
      scrollWheelZoom: false, // landing page: don't hijack page scroll
    });
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Travion verified data',
    }).addTo(map);

    MAP_PREVIEW_STOPS.forEach((stop, i) => {
      const meta = kindMeta(stop.kind);
      const marker = L.marker([stop.lat, stop.lng], { icon: numberedIcon(i + 1, meta.color) })
        .addTo(map)
        .bindPopup(
          `<strong>${stop.name}</strong><br/><span style="color:#5f6f7c;font-size:12px">${stop.time} · ${meta.label}</span>`
        );
      marker.on('click', () => setActiveId(stop.id));
      markersRef.current[stop.id] = marker;
    });

    /* Dotted route line through the day's stops */
    L.polyline(
      MAP_PREVIEW_STOPS.map((s) => [s.lat, s.lng] as [number, number]),
      { color: '#267aa8', weight: 3, opacity: 0.65, dashArray: '1 8', lineCap: 'round' }
    ).addTo(map);

    map.fitBounds(
      MAP_PREVIEW_STOPS.map((s) => [s.lat, s.lng] as [number, number]),
      { padding: [42, 42] }
    );

    mapRef.current = map;
    const onResize = () => map.invalidateSize({ animate: false, pan: false });
    const ro = new ResizeObserver(onResize);
    if (mapElRef.current) ro.observe(mapElRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, []);

  /* List click → fly the map to that marker and open its popup */
  const focusStop = (id: string) => {
    setActiveId(id);
    const map = mapRef.current;
    const marker = markersRef.current[id];
    if (!map || !marker) return;
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 13), { duration: reduce ? 0 : 0.8 });
    marker.openPopup();
  };

  const activeStop = MAP_PREVIEW_STOPS.find((s) => s.id === activeId) ?? MAP_PREVIEW_STOPS[0];

  return (
    <div className="grid lg:grid-cols-[1fr_320px] rounded-[26px] overflow-hidden border border-charcoal-100">
      {/* ~70% map */}
      <div className="relative h-[340px] md:h-[440px] lg:h-[520px] bg-travion-100">
        <div ref={mapElRef} className="leaflet-container" aria-label="Interactive map preview of a sample Munnar day plan" role="application" />
        <span className="absolute top-3 left-3 z-[500] inline-flex items-center gap-1.5 rounded-full bg-white/92 backdrop-blur px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-charcoal-600 shadow-soft pointer-events-none">
          <MapPin className="w-3 h-3 text-travion-600" aria-hidden /> Live map · Munnar, Kerala
        </span>
      </div>

      {/* ~30% glass information panel */}
      <aside className="glass-strong border-t lg:border-t-0 lg:border-l border-white/70 p-5 md:p-6 flex flex-col" aria-label="Sample journey details">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-travion-700">Sample day plan</p>
        <h3 className="mt-1.5 text-2xl font-extrabold tracking-tight text-charcoal-900">{MAP_PREVIEW_PANEL.destination}</h3>
        <p className="text-[12px] font-bold text-charcoal-400">{MAP_PREVIEW_PANEL.meta}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          {MAP_PREVIEW_PANEL.counts.map((c) => (
            <span key={c} className="rounded-full bg-white border border-charcoal-100 px-2.5 py-1 text-[10.5px] font-bold text-charcoal-600">
              {c}
            </span>
          ))}
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 space-y-1.5">
          {MAP_PREVIEW_STOPS.map((stop, i) => {
            const meta = kindMeta(stop.kind);
            const active = stop.id === activeId;
            return (
              <motion.button
                key={stop.id}
                onClick={() => focusStop(stop.id)}
                aria-current={active ? 'true' : undefined}
                initial={false}
                whileTap={{ scale: 0.99 }}
                className={`w-full flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                  active
                    ? 'border-travion-300 bg-travion-50'
                    : 'border-transparent bg-white/70 hover:bg-travion-50'
                }`}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white"
                  style={{ background: meta.color }}
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-extrabold text-charcoal-800">{stop.name}</span>
                  <span className="block text-[10.5px] font-semibold text-charcoal-400">
                    {stop.time} · {stop.kmFromPrev === '—' ? 'start' : `${stop.kmFromPrev} from prev`}
                  </span>
                </span>
                <Clock className={`ml-auto w-3.5 h-3.5 shrink-0 ${active ? 'text-travion-600' : 'text-charcoal-300'}`} aria-hidden />
              </motion.button>
            );
          })}
        </div>

        <div className="mt-4 rounded-2xl border border-travion-100 bg-white px-3.5 py-3 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-travion-50 text-travion-700 flex items-center justify-center shrink-0" aria-hidden>
            {(() => { const Ic = kindMeta(activeStop.kind).Icon; return <Ic className="w-4 h-4" />; })()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-extrabold text-charcoal-800">{activeStop.name}</p>
            <p className="text-[10.5px] font-semibold text-charcoal-400">Selected on the map</p>
          </div>
        </div>

        <button
          onClick={() => openAuth(false)}
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-travion-600 text-white text-sm font-extrabold shadow-soft hover:bg-travion-700 transition-colors btn-press focus:outline-none focus-visible:ring-4 focus-visible:ring-travion-200"
        >
          Plan this trip
          <ArrowRight className="w-4 h-4" aria-hidden />
        </button>
        <p className="mt-2.5 text-center text-[10px] font-medium text-charcoal-400">
          Opens the real planner — map, discovery and itinerary included.
        </p>
      </aside>
    </div>
  );
};

export default LandingMapPreview;
