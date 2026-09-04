import {
  AuthSession, LocationItem, TripItem, TripItinerary, TripAssignment,
  GuideCandidate, ReviewItem, ChatMessageItem, ReplanningLogItem,
  UserProfile, GuideProfile
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

// ── Auth session persistence (Remember Me aware) ────────────────────────
// "Remember me" checked  -> localStorage (survives browser restart)
// "Remember me" unchecked -> sessionStorage (cleared when the tab closes)
const AUTH_KEYS = ['travion_token', 'travion_role', 'travion_email', 'travion_id'] as const;

interface AuthSessionInput {
  access_token: string;
  role: string;
  email: string;
  identity_id?: string | null;
}

export const authStorage = {
  save(session: AuthSessionInput, remember: boolean) {
    const target = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    AUTH_KEYS.forEach((k) => other.removeItem(k));
    target.setItem('travion_token', session.access_token);
    target.setItem('travion_role', session.role);
    target.setItem('travion_email', session.email);
    target.setItem('travion_id', session.identity_id || '');
  },
  load(): { token: string | null; role: string | null; email: string | null; identityId: string | null } {
    const pick = (k: string) => sessionStorage.getItem(k) || localStorage.getItem(k);
    return {
      token: pick('travion_token'),
      role: pick('travion_role'),
      email: pick('travion_email'),
      identityId: pick('travion_id')
    };
  },
  clear() {
    AUTH_KEYS.forEach((k) => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
  }
};

export class ApiError extends Error {
  errorCode?: string;
  field?: string;
  extra?: any;
  constructor(message: string, errorCode?: string, field?: string, extra?: any) {
    super(message);
    this.name = 'ApiError';
    this.errorCode = errorCode;
    this.field = field;
    this.extra = extra;
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = authStorage.load().token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorData: any;
    try {
      errorData = await response.json();
    } catch {
      errorData = { detail: response.statusText };
    }

    const detail = errorData.detail;
    if (typeof detail === 'object' && detail !== null) {
      throw new ApiError(detail.message || 'An error occurred', detail.error_code, detail.field, detail);
    } else if (typeof detail === 'string') {
      throw new ApiError(detail);
    } else {
      throw new ApiError('Request failed');
    }
  }

  return response.json();
}

export const api = {
  // Auth
  signup: (data: { email: string; password: string; role: string; first_name?: string; last_name?: string }) =>
    request<AuthSession>('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request<AuthSession>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  elevate: (data: { email: string; password: string; access_code: string }) =>
    request<AuthSession>('/auth/elevate', { method: 'POST', body: JSON.stringify(data) }),

  getMe: () =>
    request<{ email: string; role: string; user?: UserProfile; guide?: GuideProfile }>('/auth/me'),

  // Locations
  getLocations: () =>
    request<LocationItem[]>('/locations/all'),

  searchLocations: (q: string) =>
    request<LocationItem[]>(`/locations/search?q=${encodeURIComponent(q)}`),

  // Trips & User Profile
  searchTrip: (data: { source_location_id: string; destination_location_id: string; start_datetime: string; end_datetime: string }) =>
    request<TripItem>('/trips/search', { method: 'POST', body: JSON.stringify(data) }),

  getMyTrips: () =>
    request<TripItem[]>('/trips/my-trips'),

  getTrip: (tripId: string) =>
    request<TripItem>(`/trips/${tripId}`),

  getTripAssignment: (tripId: string) =>
    request<TripAssignment>(`/trips/${tripId}/assignment`),


  completeTrip: (tripId: string) =>
    request<TripItem>(`/trips/${tripId}/complete`, { method: 'PATCH' }),

  updateBasicProfile: (data: Partial<UserProfile>) =>
    request<{ message: string; user_id: string }>('/trips/profile/basic', { method: 'PUT', body: JSON.stringify(data) }),

  // Discovery
  getNextDiscoveryQuestion: (tripId: string, answersSoFar: Record<string, any>) =>
    request<{
      is_complete: boolean;
      question_id?: string;
      question_text?: string;
      question_type?: 'choice' | 'budget' | 'text';
      options?: string[];
      placeholder?: string;
      answered_count: number;
      total_estimated: number;
    }>(`/trips/${tripId}/discovery/next`, { method: 'POST', body: JSON.stringify({ answers_so_far: answersSoFar }) }),

  // Planning
  planTrip: (tripId: string, mode: 'GUIDE_MODE' | 'ADVENTUROUS_MODE', consentAcknowledged = true) =>
    request<TripItinerary>(`/trips/${tripId}/plan`, { method: 'POST', body: JSON.stringify({ mode, consent_acknowledged: consentAcknowledged }) }),

  getItinerary: (tripId: string) =>
    request<TripItinerary>(`/trips/${tripId}/itinerary`),

  // Guides
  submitGuideOnboarding: (data: Partial<GuideProfile>) =>
    request<{ message: string; guide_id: string }>('/guides/onboarding', { method: 'POST', body: JSON.stringify(data) }),

  updateGuideStatus: (status: 'ACTIVE' | 'BUSY' | 'DUTY_OFF') =>
    request<{ message: string; status: string }>('/guides/status', { method: 'PATCH', body: JSON.stringify({ status }) }),

  getAssignedTripsForGuide: () =>
    request<any[]>('/guides/assigned-trips'),

  toggleReviewVisibility: (reviewId: string, isVisible: boolean) =>
    request<any>(`/guides/reviews/${reviewId}/visibility`, { method: 'PATCH', body: JSON.stringify({ is_visible_on_profile: isVisible }) }),

  getMyReviewsForGuide: () =>
    request<ReviewItem[]>('/guides/my-reviews'),

  // Manager
  getManagerStats: () =>
    request<{
      today_trips: number;
      pending_requests: number;
      active_guides: number;
      busy_guides: number;
      duty_off_guides: number;
      completed_trips: number;
      pending_guide_approvals: number;
    }>('/manager/dashboard-stats'),

  getPendingGuides: () =>
    request<any[]>('/manager/pending-guides'),

  decideGuideApproval: (guideId: string, action: 'APPROVE' | 'REJECT') =>
    request<{ message: string; guide_id: string }>(`/manager/guides/${guideId}/approval?action=${action}`, { method: 'POST' }),

  getTripRequests: () =>
    request<any[]>('/manager/trip-requests'),

  getRankedCandidates: (tripId: string) =>
    request<GuideCandidate[]>(`/manager/trip-requests/${tripId}/candidates`),

  assignGuide: (tripId: string, guideId: string) =>
    request<any>(`/manager/trip-requests/${tripId}/assign`, { method: 'POST', body: JSON.stringify({ guide_id: guideId }) }),

  getSettlements: () =>
    request<any[]>('/manager/settlements'),

  settlePayout: (splitId: string) =>
    request<any>(`/manager/settlements/${splitId}/settle`, { method: 'POST' }),

  // Admin
  getAdminOverview: () =>
    request<{ total_users: number; total_guides: number; total_managers: number; active_trips: number; completed_trips: number }>('/admin/overview'),

  getAdminRevenue: () =>
    request<{
      total_platform_transactions: number;
      actual_platform_revenue: number;
      total_guide_fees_payout: number;
      currency: string;
      notes: string;
    }>('/admin/revenue'),

  getAdminUsers: () =>
    request<any[]>('/admin/users'),

  getAdminGuides: () =>
    request<any[]>('/admin/guides'),

  getAdminReviews: (includeHidden = true) =>
    request<any[]>(`/admin/reviews?include_hidden=${includeHidden}`),

  getAdminAuditLogs: () =>
    request<any[]>('/admin/audit-logs'),

  // Payments
  checkoutTrip: (tripId: string) =>
    request<{ order_id: string; amount: number; currency: string; key_id: string; breakdown: Record<string, any>; live_checkout?: boolean }>(`/trips/${tripId}/checkout`, { method: 'POST', body: JSON.stringify({ payment_method: 'razorpay' }) }),

  verifyPaymentWebhook: (data: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
    request<any>('/payments/webhook', { method: 'POST', body: JSON.stringify(data) }),

  // Dynamic Replanning
  replanTrip: (tripId: string, triggerType: 'WEATHER' | 'USER_PREFERENCE' | 'BUDGET' | 'TIREDNESS', reason: string, userPrompt?: string) =>
    request<{ new_version: number; trigger_type: string; reason: string; explanation: string; updated_itinerary: TripItinerary }>(`/trips/${tripId}/replan`, { method: 'POST', body: JSON.stringify({ trigger_type: triggerType, reason, user_prompt: userPrompt }) }),

  getReplanHistory: (tripId: string) =>
    request<ReplanningLogItem[]>(`/trips/${tripId}/replan-history`),

  // Offline Package
  getOfflinePackage: (tripId: string) =>
    request<any>(`/trips/${tripId}/offline-package`),

  // Reviews
  submitReview: (tripId: string, data: { rating: number; comment?: string }) =>
    request<ReviewItem>(`/trips/${tripId}/review`, { method: 'POST', body: JSON.stringify(data) }),

  getGuidePublicReviews: (guideId: string) =>
    request<ReviewItem[]>(`/guides/${guideId}/reviews`),

  // Chat
  getChatHistory: (tripId: string, channel: 'AI' | 'GUIDE') =>
    request<ChatMessageItem[]>(`/trips/${tripId}/chat-history?channel=${channel}`),

  sendChatMessage: (tripId: string, message: string, channel: 'AI' | 'GUIDE') =>
    request<ChatMessageItem>(`/trips/${tripId}/chat-message`, { method: 'POST', body: JSON.stringify({ message, channel }) }),
};
