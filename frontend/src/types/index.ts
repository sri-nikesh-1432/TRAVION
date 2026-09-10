export type UserRole = 'USER' | 'GUIDE' | 'MANAGER' | 'ADMIN';

export interface UserProfile {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name?: string;
  photo_url?: string;
  age?: number;
  gender?: string;
  preferred_language: string;
  additional_languages: string[];
  country: string;
  home_city?: string;
  phone?: string;
  preferred_communication: 'Voice' | 'Text' | 'Both';
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  is_profile_complete: boolean;
}

export interface GuideProfile {
  id: string;
  first_name: string;
  last_name: string;
  photo_url?: string;
  phone?: string;
  status: 'ACTIVE' | 'BUSY' | 'DUTY_OFF';
  approval_status: 'PENDING' | 'APPROVED' | 'REJECTED';
  languages: string[];
  destinations: string[];
  experience_years: number;
  specializations: string[];
  destination_knowledge?: string;
  safety_information?: string;
  rating: number;
  review_count: number;
}

export interface AuthSession {
  access_token: string;
  token_type: string;
  role: UserRole;
  email: string;
  identity_id: string;
  user_id?: string;
  guide_id?: string;
  is_profile_complete: boolean;
}

export interface LocationItem {
  id: string;
  name: string;
  state: string;
  country: string;
  lat: number;
  lng: number;
  place_id?: string;
  formatted_address?: string;
  description?: string;
  hero_image?: string;
  popular_season?: string;
}

export type StopCategory = 'transport' | 'stay' | 'food' | 'attraction' | 'hidden_gem' | 'safety' | 'emergency';

export interface ItineraryStop {
  id: string;
  day: number;
  time: string;
  title: string;
  description: string;
  category: StopCategory;
  location_name: string;
  lat: number;
  lng: number;
  estimated_cost: number;
  duration_minutes: number;
  rating?: number;
  weather_note?: string;
  ai_note?: string;
  source: 'verified_api' | 'guide_submitted' | 'ai_reasoned';
  emergency_contact?: string;
  transport_details?: {
    type: string;
    code: string;
    departure: string;
    arrival: string;
    duration: string;
    fare: number;
    comfort_level: string;
  };
}

// Real GeoApify road leg between two consecutive stops of a day (additive
// overlay from the backend — never straight-line unless clearly flagged).
export interface ItineraryRouteLeg {
  from: string;
  to: string;
  distance_km: number;
  duration_min: number;
  mode: string;
  source: string; // geoapify_routematrix | geoapify_routing | estimate_haversine
}

export interface ItineraryDay {
  day: number;
  title: string;
  stops: ItineraryStop[];
  routes?: ItineraryRouteLeg[];
  route_distance_km?: number;
  route_duration_min?: number;
}

export interface CostBreakdown {
  transport: number;
  stay: number;
  food: number;
  activities: number;
  guide_fee: number;
  platform_fee: number;
  payable?: number;
  travel_spend?: number;
  total: number;
  budget?: number;
  party_type?: string;
  destination?: string;
  days?: number;
  nights?: number;
  guide_mode?: boolean;
  route_distance_km?: number;
  route_source?: string;
}

export interface TripAssignment {
  trip_id: string;
  mode?: 'GUIDE_MODE' | 'ADVENTUROUS_MODE';
  assignment_status?: string | null;
  guide?: {
    guide_id: string;
    name: string;
    phone?: string; // masked by the backend, e.g. "+91 830959****"
    rating: number;
    review_count: number;
    languages: string[];
  } | null;
}

export interface TripItinerary {
  id: string;
  trip_id: string;
  version: number;
  is_active: boolean;
  total_cost: number;
  cost_breakdown: CostBreakdown;
  days: ItineraryDay[];
  created_at: string;
}

/* ── Multi-plan & user-controlled itinerary editing ── */
export interface PlanOption {
  type: 'VALUE' | 'RECOMMENDED' | 'PREMIUM';
  label: string;
  tagline: string;
  base_plan_cost: number;
  platform_fee: number;
  final_total: number;
  total_cost: number;
  cost_breakdown: CostBreakdown;
  days: ItineraryDay[];
  budget_min: number;
  budget_max: number;
  remaining_budget: number;
  within_budget: boolean;
  highlights: string[];
  warnings: string[];
  recommended: boolean;
  budget_status?: 'restricted' | 'affordable' | 'impossible' | null;
  budget_mode?: boolean;
  budget_mode_message?: string | null;
  minimum_required_budget?: number;
  max_affordable_days?: number | null;
  stay_required?: boolean;
  selected_stay_id?: string | null;
  stay_cost?: number;
}

/* ── Budget Feasibility Engine — Step 3 advisor strip ── */
export interface BudgetTierInfo {
  tier: 'extremely_low' | 'very_low' | 'low' | 'restricted' | 'normal';
  label: string;
  summary: string;
  budget_status: 'restricted' | 'affordable';
  economy: boolean;
  impossible: boolean;
}

export interface BudgetAdvisor {
  tier?: BudgetTierInfo;
  budget_status?: 'restricted' | 'affordable';
  maximum_allowed_spend?: number;
  message?: string;
}

export interface BudgetRecovery {
  minimum_required_budget: number;
  max_affordable_days: number;
  requested_days: number;
  budget_status: string;
  alternatives: { heading: string; text: string }[];
}

/* Date-relevant live event (concerts, festivals, food events…) surfaced in
   Step 3. Only real provider-backed listings ever reach the client. */
export interface TripEventItem {
  id: string;
  name: string;
  description?: string | null;
  venue?: string | null;
  date?: string | null;
  time?: string | null;
  price?: number | null;
  booking_url?: string | null;
  category?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source?: string;
}

export interface CatalogPlace {
  id?: string | null;
  name: string;
  category: string;
  description?: string | null;
  address?: string | null;
  distance_km?: number | null;
  placement?: 'inside' | 'nearby' | 'outside' | string;
  inside_destination?: boolean;
  opening_hours?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  entry_fee?: number;
  duration_minutes?: number;
  duration_is_estimate?: boolean;
  rating?: number | null;
  review_count?: number | null;
  source: string;
  verified: boolean;
  already_in_plan: boolean;
  /** True → experience-matched place the UI auto-selects (server-decided). */
  recommended?: boolean;
}

export interface CatalogStay {
  id?: string | null;
  name: string;
  tier: string;
  placement?: 'inside' | 'nearby' | 'outside' | string;
  inside_destination?: boolean;
  price_per_night?: number | null;
  rating?: number | null;
  amenities: string[];
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
  budget_category?: string | null;
  source: string;
  verified: boolean;
  already_in_plan: boolean;
}

export interface SelectedStay {
  id?: string | null;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
  budget_category?: string | null;
  price_per_night?: number | null;
}

export interface CatalogFood {
  id?: string | null;
  name: string;
  cuisine: string;
  veg_type: string;
  avg_cost_for_two?: number | null;
  rating?: number | null;
  address?: string | null;
  distance_km?: number | null;
  placement?: 'inside' | 'nearby' | 'outside' | string;
  inside_destination?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  price_level?: string | null;
  budget_class?: string | null;
  must_try?: string | null;
  source: string;
  verified: boolean;
  already_in_plan: boolean;
}

/* Structured discovery selection (id + real coords + distance + price) — the
   planner uses the EXACT place the user picked, never a same-named guess. */
export interface SelectedPlaceItem {
  id?: string | null;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
  placement?: string;
  entry_fee?: number | null;
  duration_minutes?: number | null;
  rating?: number | null;
  source?: string;
}

export interface SelectedFoodItem {
  id?: string | null;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
  avg_cost_for_two?: number | null;
  cuisine?: string | null;
  must_try?: string | null;
  rating?: number | null;
  source?: string;
}

export interface BudgetTierPanel {
  tier: string;
  label: string;
  summary: string;
  budget_status: 'restricted' | 'affordable' | 'impossible';
  economy: boolean;
  impossible: boolean;
}

export interface DestinationCatalog {
  destination: string;
  destination_latitude?: number | null;
  destination_longitude?: number | null;
  destination_radius_km?: number | null;
  verified_only: boolean;
  discovery_source?: string | null;
  budget_band?: string | null;
  core_radius_km?: number | null;
  budget?: {
    tier: BudgetTierPanel;
    budget_status: string;
    maximum_allowed_spend?: number;
    constraints?: Record<string, any>;
    message?: string;
  } | null;
  counts: { attractions: number; stays: number; food: number; activities: number };
  must_visit: CatalogPlace[];
  stays: CatalogStay[];
  food: CatalogFood[];
  activities: CatalogPlace[];
}

export type DiscoveryCategory = 'must_visit' | 'activities' | 'food' | 'stays';

export interface MapPlace {
  id?: string | null;
  provider_place_id?: string | null;
  name: string;
  category: string;
  description?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
  placement?: 'inside' | 'nearby' | 'outside' | string;
  inside_destination?: boolean;
  rating?: number | null;
  source: string;
  verified: boolean;
  entry_fee?: number | null;
  price_per_night?: number | null;
  avg_cost_for_two?: number | null;
  cuisine?: string | null;
  tier?: string | null;
  opening_hours?: string | null;
}

export interface MapPlacesPayload {
  destination: string;
  destination_latitude?: number | null;
  destination_longitude?: number | null;
  destination_radius_km?: number | null;
  discovery_source?: string | null;
  map_places: Partial<Record<DiscoveryCategory | 'shopping' | 'healthcare' | 'education' | 'transport' | 'other', MapPlace[]>>;
  map_counts: Record<string, number>;
  map_counts_full: Record<string, number>;
  catalog_meta?: Record<string, { requested: number; available: number; status: string; note: string }>;
}

// ── GeoApify server-side proxy (/geo/*) — the key NEVER reaches the browser ──
export interface GeoTileUrl {
  url: string;
  attribution: string;
}

export interface GeoViewportPlace {
  place_id: string | null;
  name: string;
  categories: string[];
  formatted: string | null;
  lat: number;
  lng: number;
  opening_hours: string | null;
  website: string | null;
  source: string;
}

export interface GeoViewportPayload {
  count: number;
  places: GeoViewportPlace[];
  bbox: { south: number; west: number; north: number; east: number };
}

export interface ExplorePlace {
  name: string;
  category: string;
  description?: string | null;
  lat: number;
  lng: number;
  entry_fee: number;
  duration_minutes: number;
  rating?: number | null;
  source: string;
  verified?: boolean;
}

export type ItineraryChange =
  | { kind: 'remove'; stop_id: string }
  | { kind: 'move_time'; stop_id: string; new_time: string }
  | { kind: 'move_day'; stop_id: string; new_day: number; new_index?: number }
  | { kind: 'reorder'; stop_id: string; new_day: number; new_index: number }
  | { kind: 'add'; stop: ExplorePlace & { day?: number; time?: string; title?: string; estimated_cost?: number; location_name?: string }; new_day?: number; new_time?: string; new_index?: number };

export interface ItineraryChangeResponse {
  itinerary: TripItinerary;
  warnings: string[];
  applied: boolean;
}

export interface TripItem {
  id: string;
  user_id: string;
  source_location_id: string;
  destination_location_id: string;
  source_name: string;
  destination_name: string;
  start_datetime: string;
  end_datetime: string;
  status: 'DRAFT' | 'PLANNED' | 'REQUESTED' | 'GUIDE_ASSIGNED' | 'PAID' | 'ACTIVE' | 'COMPLETED';
  mode?: 'GUIDE_MODE' | 'ADVENTUROUS_MODE';
  budget: number;
  total_cost: number;
  created_at: string;
}

export interface GuideCandidate {
  guide_id: string;
  name: string;
  photo_url?: string;
  languages: string[];
  rating: number;
  review_count: number;
  experience_years: number;
  match_score: number;
  match_breakdown: {
    destination_compatibility: number;
    language_compatibility: number;
    availability: number;
    experience: number;
    rating: number;
    workload_penalty: number;
  };
  status: 'ACTIVE' | 'BUSY' | 'DUTY_OFF';
}

export interface ReviewItem {
  id: string;
  trip_id: string;
  guide_id: string;
  user_id: string;
  user_name: string;
  rating: number;
  comment?: string;
  is_visible_on_profile: boolean;
  created_at: string;
}

export interface ChatMessageItem {
  id: string;
  trip_id: string;
  sender_role: string;
  sender_id: string;
  sender_name: string;
  message: string;
  channel: 'AI' | 'GUIDE';
  created_at: string;
}

export interface ReplanningLogItem {
  id: string;
  trigger_type: string;
  reason: string;
  explanation: string;
  old_version: number;
  new_version: number;
  created_at: string;
}

/* ── Step 5 Interactive Planner ── */
export interface PlanChangeItem {
  version: number;
  change_type: string;
  summary: string;
  created_at: string;
}

export interface PlaceSearchItem {
  id?: string | null;
  name: string;
  category: string;
  description?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
  entry_fee: number;
  duration_minutes: number;
  estimated_cost: number;
  rating?: number | null;
  source: string;
}

export interface OptimizeDayResponse {
  day: number;
  version?: number | null;
  applied: boolean;
  days: ItineraryDay[];
  total_cost: number;
  cost_breakdown: CostBreakdown;
  warnings: string[];
}

export interface ConfirmPlanResponse {
  valid: boolean;
  message: string;
  version: number;
  total_cost: number;
  budget_max?: number | null;
  within_budget: boolean;
  missing: string[];
}
