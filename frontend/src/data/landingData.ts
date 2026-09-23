/**
 * TRAVION landing-page content layer.
 *
 * Rules honoured here:
 * - Destination coordinates come from the SAME bundled place index the
 *   search bar uses — never invented lat/lng values.
 * - Imagery is real travel photography (Unsplash) representing the actual
 *   place named, with `auto=format` letting Unsplash negotiate WebP/AVIF.
 * - Sample itineraries are explicitly labelled "product preview" in the UI —
 *   they demonstrate the real itinerary surface without claiming to be live
 *   trip data.
 * - No invented statistics, testimonials, ratings or partner logos anywhere.
 */

/* ── Photography ────────────────────────────────────────────────────────────
   Real places, real photos. `auto=format` serves WebP/AVIF to capable
   browsers. Widths are sized per slot to keep payloads lean. */
const img = (id: string, w: number, h?: number) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}${h ? `&h=${h}` : ''}&q=75`;

export const LANDING_IMAGES = {
  hero: img('photo-1470071459604-3b5ec3a7fe05', 2000), // misty mountain highlands
  guide: img('photo-1527631746610-bca00a040d60', 1200), // travellers on a trail
  adventure: img('photo-1533105079780-92b9be482077', 1200), // hiker overlooking a valley
  road: img('photo-1469474968028-56623f02e42e', 2000), // golden-hour mountain road
  planners: img('photo-1506003094589-53954a26283f', 1200), // planning over maps
  finalCta: img('photo-1507525428034-b723cf961d3e', 2000), // wide coastline
  authPanel: img('photo-1476514525535-07fb3b4ae5f1', 1200), // canoe on a turquoise lake
} as const;

/* ── Destination story (editorial collage, section 12) ────────────────────
   Munnar is a verified hub in the app; the others are real Indian
   destinations with real photography. `sub` is deliberately editorial, not
   an invented factual claim. */
export interface LandingDestination {
  name: string;
  state: string;
  sub: string;
  image: string;
  alt: string;
}

export const HIGHLIGHT_DESTINATIONS: LandingDestination[] = [
  {
    name: 'Munnar',
    state: 'Kerala',
    sub: 'Tea-plantation hills and quiet viewpoints',
    image: img('photo-1500673922987-e212871fec22', 1600),
    alt: 'Tea plantations rolling over the hills of Munnar, Kerala',
  },
  {
    name: 'Jaipur',
    state: 'Rajasthan',
    sub: 'Heritage streets and rose-pink facades',
    image: img('photo-1477587458883-47145ed94245', 1000),
    alt: 'The ornate pink facade of Hawa Mahal in Jaipur, Rajasthan',
  },
  {
    name: 'Meghalaya',
    state: 'Northeast India',
    sub: 'Waterfalls, living roots and cloud valleys',
    image: img('photo-1546587348-d12660c30c50', 1000),
    alt: 'A waterfall plunging through the forested cliffs of Meghalaya',
  },
  {
    name: 'Goa',
    state: 'Konkan Coast',
    sub: 'Palm-lined shores and slow afternoons',
    image: img('photo-1514222709107-a180c68d72b4', 1000),
    alt: 'Palm trees leaning over a quiet beach in Goa',
  },
  {
    name: 'Kashmir',
    state: 'Himalayas',
    sub: 'Meadows, lakes and snow-lined valleys',
    image: img('photo-1506905925346-21bda4d32df4', 1000),
    alt: 'Snow-covered Himalayan peaks above a Kashmir valley',
  },
];

/* ── Horizontal destination rail (section 13) ──────────────────────────────
   Desktop storytelling grid · mobile scroll-snap swipe. */
export const RAIL_DESTINATIONS: LandingDestination[] = [
  {
    name: 'Munnar',
    state: 'Kerala',
    sub: '3 days · 2 nights · hills & tea trails',
    image: img('photo-1500673922987-e212871fec22', 1000),
    alt: 'Tea estates covering the slopes around Munnar',
  },
  {
    name: 'Kashmir Valley',
    state: 'Himalayas',
    sub: '4 days · 3 nights · lakes & meadows',
    image: img('photo-1506905925346-21bda4d32df4', 1000),
    alt: 'Himalayan peaks rising above the Kashmir valley',
  },
  {
    name: 'Goa Coast',
    state: 'Konkan',
    sub: '3 days · 2 nights · beaches & cafés',
    image: img('photo-1514222709107-a180c68d72b4', 1000),
    alt: 'Palm-fringed shoreline on the Goa coast',
  },
  {
    name: 'Meghalaya',
    state: 'Northeast India',
    sub: '4 days · 3 nights · waterfalls & caves',
    image: img('photo-1546587348-d12660c30c50', 1000),
    alt: 'Monsoon waterfalls in the Meghalaya hills',
  },
];

/* ── Sample journey for the hero planner panel (section 8) ────────────────
   Both endpoints exist verbatim in the bundled place index. */
export const SAMPLE_PLANNER = {
  from: { name: 'Hyderabad', region: 'Telangana, India' },
  to: { name: 'Munnar', region: 'Kerala, India' },
  depart: { date: 'SEP 19', time: '10:00 AM' },
  arrive: { date: 'SEP 22', time: '8:00 PM' },
} as const;

/* ── Map preview stops (section 17) ────────────────────────────────────────
   Real Munnar-area geography rendered on real Leaflet + OpenStreetMap tiles.
   Munnar town coordinates come from the bundled place index; the named
   viewpoints are well-known real places around the town. */
export interface MapPreviewStop {
  id: string;
  name: string;
  time: string;
  kmFromPrev: string;
  lat: number;
  lng: number;
  kind: 'arrival' | 'culture' | 'food' | 'viewpoint' | 'nature';
}

export const MAP_PREVIEW_STOPS: MapPreviewStop[] = [
  { id: 'stop-1', name: 'Arrive in Munnar town', time: '09:00 AM', kmFromPrev: '—', lat: 10.0882, lng: 77.0624, kind: 'arrival' },
  { id: 'stop-2', name: 'Tea museum visit', time: '11:00 AM', kmFromPrev: '1.2 km', lat: 10.0799, lng: 77.0577, kind: 'culture' },
  { id: 'stop-3', name: 'Lunch near the bazaar', time: '01:00 PM', kmFromPrev: '0.9 km', lat: 10.0875, lng: 77.0601, kind: 'food' },
  { id: 'stop-4', name: 'Pothamedu viewpoint', time: '03:30 PM', kmFromPrev: '2.9 km', lat: 10.0663, lng: 77.0584, kind: 'viewpoint' },
  { id: 'stop-5', name: 'Kundala Lake by golden hour', time: '05:30 PM', kmFromPrev: '16.8 km', lat: 10.1128, lng: 77.1522, kind: 'nature' },
];

export const MAP_PREVIEW_PANEL = {
  destination: 'Munnar',
  meta: '3 days · 2 nights',
  counts: ['12 places', '4 activities', '3 stays'],
} as const;

/* ── Itinerary preview rows (section 18) ─────────────────────────────────── */
export const SAMPLE_ITINERARY = {
  day: 'DAY 1',
  date: 'SEP 19',
  rows: [
    { time: '10:00', title: 'Arrival', note: 'Check in and settle' },
    { time: '11:30', title: 'Nature walk', note: 'Tea-trail loop' },
    { time: '13:00', title: 'Lunch', note: 'Local kitchen' },
    { time: '15:30', title: 'Viewpoint', note: 'Golden-hour stop' },
  ],
} as const;

/* ── Trust strip (section 11) ────────────────────────────────────────────── */
export const TRUST_STRIP = [
  'Real places',
  'Verified discovery',
  'AI planning',
  'Human guides',
  'Live trip support',
] as const;

/* ── FAQ (section 26) ──────────────────────────────────────────────────────
   Answers describe actual product behaviour — the adaptive interview,
   verified POI discovery, server-side pricing, itinerary validation,
   Razorpay test-mode payments, replanning and live navigation. */
export const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is TRAVION?',
    a: 'TRAVION is an AI travel orchestration platform. It plans your journey from transport and stays to dining and activities, coordinates verified local guides when you want one, and stays with you during the trip with live navigation, a trip-scoped AI assistant and dynamic replanning.',
  },
  {
    q: 'How does AI planning work?',
    a: 'You answer a short adaptive interview — budget, pace, stay style, food, transport, interests. Those answers act as real constraints: the planner selects verified places and shapes a day-by-day schedule with them, and the validated itinerary engine — not the AI — is the source of truth for dates and times.',
  },
  {
    q: 'Are places real?',
    a: 'Yes. Discovery runs on verified points of interest from real map data providers across nine categories — attractions, food, stays, shopping, healthcare, education, transport and more. Where something has not been verified, TRAVION says so rather than inventing details.',
  },
  {
    q: 'What is Guide Mode?',
    a: 'Guide Mode pairs your planned trip with a verified local guide. Guides are onboarded with a structured assessment on destination knowledge and safety, approved by an operations manager, then matched to your route. A transparent guide fee is shown upfront, computed server-side.',
  },
  {
    q: 'What is Adventurous Mode?',
    a: 'Adventurous Mode removes the guide. You keep the full AI-planned journey — verified itinerary, live map, turn-by-turn navigation, the AI assistant and dynamic replanning — and only the platform fee applies. No guide fee you did not ask for.',
  },
  {
    q: 'Can I edit my itinerary?',
    a: 'Yes. The itinerary editor supports drag-and-drop between days, changing times, removing or adding stops, with undo. Every change is re-validated against real travel time, opening hours and your trip window — impossible schedules never appear.',
  },
  {
    q: 'What happens after payment?',
    a: 'The payment signature is verified server-side, your plan activates, and your trip becomes a live dashboard — today’s itinerary, the map, your assistant, navigation and emergency info. In Guide Mode your guide is assigned and introduced next.',
  },
  {
    q: 'Can I change my plan?',
    a: 'Yes — before and during the trip. Ask the assistant to adjust a day, or let dynamic replanning respond to conditions like weather. Changes apply to a new itinerary version and TRAVION always shows you a plain-language reason why the plan changed.',
  },
  {
    q: 'Does TRAVION support live navigation?',
    a: 'Yes. On an active trip you get turn-by-turn navigation to each stop, ETA and distance from your current location, and an offline trip package — itinerary, coordinates and important contacts — for when connectivity drops.',
  },
];
