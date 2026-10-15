import React, { useEffect, useState } from 'react';
import { CloudSun, CloudOff, Loader2 } from 'lucide-react';
import type { WeatherDay, WeatherPayload } from '../../types';
import { api } from '../../services/api';

/**
 * Horizontal destination forecast strip.
 *
 * Every day renders from the backend response. Days flagged `reliable: false`
 * are styled as "typical seasonal conditions — not a confirmed forecast" and
 * never presented as a real prediction.
 */
export const WeatherStrip: React.FC<{
  tripId: string;
  compact?: boolean;
}> = ({ tripId, compact }) => {
  const [data, setData] = useState<WeatherPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.getWeather(tripId)
      .then((w) => { if (alive) { setData(w); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tripId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] font-bold text-charcoal-400 px-1 py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking destination weather…
      </div>
    );
  }

  // Honest absence: no forecast provider configured — the strip hides itself
  // instead of inventing weather.
  if (failed || !data || !data.forecast || data.forecast.length === 0) return null;

  const Day: React.FC<{ d: WeatherDay }> = ({ d }) => (
    <div
      className={`shrink-0 w-[118px] rounded-2xl border px-3 py-2.5 text-center ${
        d.reliable
          ? 'bg-white border-charcoal-200'
          : 'bg-sand-50 border-dashed border-charcoal-300'
      }`}
      title={d.reliable ? `Source: ${d.source}` : 'Typical seasonal conditions — not a confirmed forecast'}
    >
      <p className="text-[10px] font-black uppercase tracking-wider text-charcoal-400">{d.day || d.date}</p>
      <p className="mt-1 text-[13px] font-extrabold text-charcoal-800 flex items-center justify-center gap-1">
        {d.reliable
          ? <CloudSun className="w-4 h-4 text-travion-600" />
          : <CloudOff className="w-4 h-4 text-charcoal-300" />}
        {Math.round(Number(d.temp_c) || 0)}°C
      </p>
      <p className="mt-0.5 text-[10.5px] font-semibold text-charcoal-500 leading-tight line-clamp-2">{d.condition}</p>
      {!d.reliable && (
        <p className="mt-1 text-[9px] font-bold text-charcoal-400 leading-tight">
          Typical seasonal conditions — not a confirmed forecast
        </p>
      )}
    </div>
  );

  return (
    <div className={compact ? '' : 'rounded-3xl border border-charcoal-200/80 bg-ivory-50/60 p-4'}>
      {!compact && (
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[11px] font-black uppercase tracking-wider text-charcoal-400">
            Weather · {data.destination}
          </p>
          {data.travel_dates && (
            <p className="text-[10.5px] font-bold text-charcoal-400">{data.travel_dates}</p>
          )}
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {data.forecast.map((d) => (
          <Day key={d.date} d={d} />
        ))}
      </div>
      {data.disclaimer && (
        <p className="mt-2 text-[10.5px] font-medium text-charcoal-400">{data.disclaimer}</p>
      )}
      {data.label && !data.disclaimer && (
        <p className="mt-2 text-[10.5px] font-medium text-charcoal-400">{data.label}</p>
      )}
    </div>
  );
};
