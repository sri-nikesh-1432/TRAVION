import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Clock, MapPin, Sparkles, Navigation, Calendar, CloudSun,
  ShieldAlert, ChevronRight, CheckCircle2
} from 'lucide-react';
import { TripItinerary, ItineraryStop, ItineraryDay } from '../../types';
import { LiveTripMap } from './LiveTripMap';

interface SplitViewProps {
  itinerary: TripItinerary;
  onStartNavigation: (stop: ItineraryStop) => void;
}

export const SplitView: React.FC<SplitViewProps> = ({ itinerary, onStartNavigation }) => {
  const allStops: ItineraryStop[] = itinerary.days.flatMap(d => d.stops);
  const [selectedStop, setSelectedStop] = useState<ItineraryStop | null>(allStops[0] || null);
  const [activeDay, setActiveDay] = useState<number>(1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[760px]">
      
      {/* Left Column: Itinerary Day-by-Day List */}
      <div className="lg:col-span-5 flex flex-col h-full bg-white rounded-3xl border border-slate-200/80 shadow-soft overflow-hidden">
        
        {/* Day Tabs */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {itinerary.days.map((day) => (
              <button
                key={day.day}
                onClick={() => setActiveDay(day.day)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeDay === day.day
                    ? 'bg-travion-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-travion-50 border border-slate-200'
                }`}
              >
                Day {day.day}
              </button>
            ))}
          </div>

          <span className="text-xs font-semibold text-slate-500">
            {itinerary.days.find(d => d.day === activeDay)?.stops.length || 0} stops
          </span>
        </div>

        {/* Scrollable Stops List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {itinerary.days.find(d => d.day === activeDay)?.stops.map((stop) => {
            const isSelected = selectedStop?.id === stop.id;
            return (
              <motion.div
                key={stop.id}
                whileHover={{ scale: 1.01 }}
                onClick={() => setSelectedStop(stop)}
                className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                  isSelected
                    ? 'border-travion-500 bg-travion-50/50 shadow-soft ring-2 ring-travion-100'
                    : 'border-slate-200 hover:border-travion-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-travion-700 bg-travion-100 px-2 py-0.5 rounded-md">
                      {stop.time}
                    </span>
                    <span className="text-xs font-semibold uppercase text-slate-400">
                      {stop.category.replace('_', ' ')}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-slate-700">
                    {stop.estimated_cost > 0 ? `₹${stop.estimated_cost}` : 'Included'}
                  </span>
                </div>

                <h4 className="font-bold text-sm text-slate-900 mb-1">
                  {stop.title}
                </h4>

                <p className="text-xs text-slate-500 line-clamp-2 mb-3">
                  {stop.description}
                </p>

                <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-travion-500" />
                    <span className="truncate max-w-[180px]">{stop.location_name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartNavigation(stop);
                    }}
                    className="flex items-center gap-1 text-travion-600 font-bold hover:underline"
                  >
                    <span>Navigate</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Right Column: Interactive Map */}
      <div className="lg:col-span-7 h-full">
        <LiveTripMap
          stops={allStops}
          selectedStop={selectedStop}
          onSelectStop={(s) => setSelectedStop(s)}
          onStartNavigation={onStartNavigation}
        />
      </div>

    </div>
  );
};
