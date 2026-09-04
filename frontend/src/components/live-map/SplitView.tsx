import React, { useState } from 'react';
import { TripItinerary, ItineraryStop } from '../../types';
import { LiveTripMap } from './LiveTripMap';
import { JourneyTimeline } from './JourneyTimeline';

interface SplitViewProps {
  itinerary: TripItinerary;
  onStartNavigation: (stop: ItineraryStop) => void;
  avatarPosition?: [number, number] | null;
  tripStart?: string;
  tripEnd?: string;
  tripStatus?: string;
  tripSource?: string;
  tripDestination?: string;
}

export const SplitView: React.FC<SplitViewProps> = ({
  itinerary,
  onStartNavigation,
  avatarPosition = null,
  tripStart,
  tripEnd,
  tripStatus,
  tripSource,
  tripDestination,
}) => {
  const allStops: ItineraryStop[] = itinerary.days.flatMap((d) => d.stops);
  const [selectedStop, setSelectedStop] = useState<ItineraryStop | null>(allStops[0] || null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[820px]">
      {/* Left Column: macOS-style journey timeline */}
      <div className="lg:col-span-5 h-full">
        <JourneyTimeline
          itinerary={itinerary}
          onStartNavigation={onStartNavigation}
          avatarPosition={avatarPosition}
          tripStart={tripStart}
          tripEnd={tripEnd}
          tripStatus={tripStatus}
          tripSource={tripSource}
          tripDestination={tripDestination}
          selectedStop={selectedStop}
          onSelectStop={setSelectedStop}
        />
      </div>

      {/* Right Column: Interactive Map */}
      <div className="lg:col-span-7 h-full">
        <LiveTripMap
          stops={allStops}
          selectedStop={selectedStop}
          onSelectStop={(s) => setSelectedStop(s)}
          onStartNavigation={onStartNavigation}
          avatarPosition={avatarPosition || undefined}
        />
      </div>
    </div>
  );
};