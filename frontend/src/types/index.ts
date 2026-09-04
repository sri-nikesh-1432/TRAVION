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

export interface ItineraryDay {
  day: number;
  title: string;
  stops: ItineraryStop[];
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
}

export interface TripAssignment {
  trip_id: string;
  mode?: 'GUIDE_MODE' | 'ADVENTUROUS_MODE';
  assignment_status?: string | null;
  guide?: {
    guide_id: string;
    name: string;
    phone?: string;
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
