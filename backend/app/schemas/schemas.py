from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr, Field, field_validator

PASSWORD_POLICY_HINT = (
    "Password must be at least 8 characters long and include "
    "at least one uppercase letter, one lowercase letter, and one number."
)

def validate_password_strength(password: str) -> str:
    if len(password) < 8:
        raise ValueError(PASSWORD_POLICY_HINT)
    if not any(c.isupper() for c in password):
        raise ValueError("Password must include at least one uppercase letter (A–Z).")
    if not any(c.islower() for c in password):
        raise ValueError("Password must include at least one lowercase letter (a–z).")
    if not any(c.isdigit() for c in password):
        raise ValueError("Password must include at least one number (0–9).")
    return password

# --- Auth Schemas ---
class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    role: str = Field(..., pattern="^(USER|GUIDE)$")
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    # Mandatory onboarding: a valid phone number is required to create any
    # account (traveller or guide). Validated server-side, stored as-is,
    # and only ever displayed masked via app.services.privacy.mask_phone.
    phone: str

    @field_validator("phone")
    @classmethod
    def phone_must_be_valid(cls, v: str) -> str:
        digits = "".join(c for c in v if c.isdigit())
        if len(digits) < 10:
            raise ValueError("A valid 10-digit Indian phone number is mandatory to create an account.")
        if len(digits) == 11 and digits.startswith("0"):
            digits = digits[1:]
        if len(digits) == 12 and digits.startswith("91"):
            digits = digits[2:]
        if len(digits) != 10 or not digits.startswith(("6", "7", "8", "9")):
            raise ValueError("Enter a valid Indian mobile number (10 digits, starting 6-9).")
        return v

    @field_validator("password")
    @classmethod
    def password_must_be_strong(cls, v: str) -> str:
        return validate_password_strength(v)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    email: str
    identity_id: str
    user_id: Optional[str] = None
    guide_id: Optional[str] = None
    is_profile_complete: Optional[bool] = False

class ElevateRequest(BaseModel):
    email: EmailStr
    password: str
    access_code: str  # SIH-MANAGER or SIH-ADMIN

# --- Profile Schemas ---
def validate_phone(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    digits = "".join(c for c in v if c.isdigit())
    if len(digits) < 10 or len(digits) > 13:
        raise ValueError("Phone number must contain 10–13 digits (include country code if outside India).")
    return v

class BasicProfileUpdate(BaseModel):
    first_name: str
    last_name: str
    preferred_name: Optional[str] = None
    photo_url: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    preferred_language: str = "English"
    additional_languages: List[str] = []
    country: str = "India"
    home_city: Optional[str] = None
    phone: Optional[str] = None  # Mandatory per product policy; validated server-side
    preferred_communication: str = "Both"  # Voice, Text, Both
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None

    @field_validator("phone")
    @classmethod
    def phone_must_be_valid(cls, v: Optional[str]) -> Optional[str]:
        return validate_phone(v)

class GuideRegistrationRequest(BaseModel):
    """Full guide registration payload from the guide registration page."""
    email: EmailStr
    password: str = Field(..., min_length=8)
    first_name: str
    last_name: str
    phone: str
    city: str  # Primary operating location
    languages: List[str]
    destinations: List[str]
    experience_years: int = Field(..., ge=0, le=60)
    guide_type: str  # e.g., 'Trekking', 'Cultural', 'Culinary', 'Wildlife', 'General'
    availability: str  # e.g., 'Weekdays', 'Weekends', 'Flexible', 'Seasonal'

    @field_validator("phone")
    @classmethod
    def guide_phone_must_be_valid(cls, v: str) -> str:
        digits = "".join(c for c in v if c.isdigit())
        if len(digits) < 10:
            raise ValueError("A valid 10-digit phone number is mandatory for guide registration.")
        if len(digits) == 11 and digits.startswith("0"):
            digits = digits[1:]
        if len(digits) == 12 and digits.startswith("91"):
            digits = digits[2:]
        if len(digits) != 10 or not digits.startswith(("6", "7", "8", "9")):
            raise ValueError("Enter a valid Indian mobile number (10 digits, starting 6-9).")
        return v

    @field_validator("password")
    @classmethod
    def password_must_be_strong(cls, v: str) -> str:
        return validate_password_strength(v)


class GuideOnboardingUpdate(BaseModel):
    first_name: str
    last_name: str
    phone: Optional[str] = None
    languages: List[str]
    destinations: List[str]
    experience_years: int = Field(..., ge=0, le=60)
    specializations: List[str]
    destination_knowledge: str = Field(..., min_length=20)
    safety_information: str = Field(..., min_length=20)

    @field_validator("phone")
    @classmethod
    def guide_phone_required(cls, v: Optional[str]) -> Optional[str]:
        return validate_phone(v)

class GuideStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(ACTIVE|BUSY|DUTY_OFF)$")

# --- Location Schemas ---
class LocationResponse(BaseModel):
    id: str
    name: str
    state: str
    country: str
    lat: float
    lng: float
    place_id: Optional[str] = None
    description: Optional[str] = None
    hero_image: Optional[str] = None
    popular_season: Optional[str] = None

class RegisterLocationRequest(BaseModel):
    name: str
    state: Optional[str] = None
    country: Optional[str] = None
    lat: float
    lng: float
    place_id: Optional[str] = None
    description: Optional[str] = None

# --- Trip Search & Creation ---
class TripSearchRequest(BaseModel):
    source_location_id: str
    destination_location_id: str
    start_datetime: datetime
    end_datetime: datetime

class TripResponse(BaseModel):
    id: str
    user_id: str
    source_location_id: str
    destination_location_id: str
    source_name: str
    destination_name: str
    start_datetime: datetime
    end_datetime: datetime
    status: str
    mode: Optional[str] = None
    budget: float
    total_cost: float
    created_at: datetime

# --- Adaptive Discovery Engine ---
class DiscoveryAnswer(BaseModel):
    question_id: str
    answer: Any

class DiscoveryNextRequest(BaseModel):
    answers_so_far: Dict[str, Any] = {}

class DiscoveryQuestionResponse(BaseModel):
    is_complete: bool
    question_id: Optional[str] = None
    question_text: Optional[str] = None
    question_type: Optional[str] = None  # choice, multi_choice, budget, text
    options: Optional[List[str]] = None
    placeholder: Optional[str] = None
    answered_count: int = 0
    total_estimated: int = 6

# --- Planning & Itinerary ---
class PlanTripRequest(BaseModel):
    mode: str = Field(..., pattern="^(GUIDE_MODE|ADVENTUROUS_MODE)$")
    consent_acknowledged: bool = True

class ItineraryStop(BaseModel):
    id: str
    day: int
    time: str
    title: str
    description: str
    category: str  # transport, stay, food, attraction, hidden_gem, safety, emergency
    location_name: str
    lat: float
    lng: float
    estimated_cost: float
    duration_minutes: int
    rating: Optional[float] = 4.8
    weather_note: Optional[str] = "Sunny 24°C"
    ai_note: Optional[str] = None
    source: str = "verified_api"  # verified_api, guide_submitted, ai_reasoned
    emergency_contact: Optional[str] = None
    transport_details: Optional[Dict[str, Any]] = None

class ItineraryResponse(BaseModel):
    id: str
    trip_id: str
    version: int
    is_active: bool
    total_cost: float
    cost_breakdown: Dict[str, Any]
    days: List[Dict[str, Any]]
    created_at: datetime

# --- Guide Matching & Assignment ---
class GuideCandidate(BaseModel):
    guide_id: str
    name: str
    photo_url: Optional[str] = None
    languages: List[str]
    rating: float
    review_count: int
    experience_years: int
    match_score: float
    match_breakdown: Dict[str, float]
    status: str

class AssignGuideRequest(BaseModel):
    guide_id: str

# --- Payment & Razorpay ---
class CheckoutRequest(BaseModel):
    payment_method: Optional[str] = "razorpay"

class CheckoutResponse(BaseModel):
    order_id: str
    amount: float
    currency: str = "INR"
    key_id: str
    breakdown: Dict[str, Any]
    live_checkout: bool = False  # True = real Razorpay test-mode order, False = simulated/local order

class PaymentWebhookRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str

# --- Multi-Plan & User-Controlled Itinerary Editing ---
class PlanMultiRequest(BaseModel):
    mode: str = Field(..., pattern="^(GUIDE_MODE|ADVENTUROUS_MODE)$")
    consent_acknowledged: bool = True
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    # User-selected REAL places (destination discovery) — hard preferences the
    # planner must include, never replace.
    selected_places: List[str] = []
    selected_food: List[str] = []
    # Optional per-plan stay tier override, e.g. {"PREMIUM": "5 Star"} from the
    # plan card's star +/- control.
    stay_tiers: Dict[str, str] = {}

class PlanOptionResponse(BaseModel):
    type: str  # VALUE | RECOMMENDED | PREMIUM
    label: str
    tagline: str
    total_cost: float
    cost_breakdown: Dict[str, Any]
    days: List[Dict[str, Any]]
    budget_min: float
    budget_max: float
    within_budget: bool
    warnings: List[str] = []

class ChoosePlanRequest(BaseModel):
    plan_type: str = Field(..., pattern="^(VALUE|RECOMMENDED|PREMIUM)$")

class ItineraryChangeRequest(BaseModel):
    kind: str = Field(..., pattern="^(remove|move_time|move_day|reorder|add)$")
    stop_id: Optional[str] = None
    new_time: Optional[str] = None
    new_day: Optional[int] = Field(None, ge=0)
    new_index: Optional[int] = Field(None, ge=0)
    stop: Optional[Dict[str, Any]] = None  # required for kind=add

class ItineraryChangeResponse(BaseModel):
    itinerary: ItineraryResponse
    warnings: List[str] = []
    applied: bool

class ExplorePlaceItem(BaseModel):
    name: str
    category: str
    description: Optional[str] = None
    lat: float
    lng: float
    entry_fee: float = 0.0
    duration_minutes: int = 90
    rating: Optional[float] = 4.6
    source: str = "verified_api"

# --- Replanning ---
class ReplanTriggerRequest(BaseModel):
    trigger_type: str = Field(..., pattern="^(WEATHER|USER_PREFERENCE|BUDGET|TIREDNESS)$")
    reason: str
    user_prompt: Optional[str] = None

class ReplanResponse(BaseModel):
    new_version: int
    trigger_type: str
    reason: str
    explanation: str
    updated_itinerary: ItineraryResponse

# --- Reviews ---
class ReviewCreate(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = None

class ReviewResponse(BaseModel):
    id: str
    trip_id: str
    guide_id: str
    user_id: str
    user_name: str
    rating: int
    comment: Optional[str]
    is_visible_on_profile: bool
    created_at: datetime

class ReviewVisibilityUpdate(BaseModel):
    is_visible_on_profile: bool

# --- Chat Messages ---
class ChatMessageCreate(BaseModel):
    message: str
    channel: str = "AI"  # AI or GUIDE
    # Optional live GPS position from the traveller's device — used as real
    # current-location context by the AI (never fabricated server-side).
    lat: Optional[float] = None
    lng: Optional[float] = None

class ChatMessageResponse(BaseModel):
    id: str
    trip_id: str
    sender_role: str
    sender_id: str
    sender_name: str
    message: str
    channel: str
    created_at: datetime
