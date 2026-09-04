import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Text, DateTime, ForeignKey, Enum, JSON
)
from sqlalchemy.orm import relationship
from app.core.db import Base

def get_utc_now():
    return datetime.now(timezone.utc)

def generate_uuid():
    return str(uuid.uuid4())

class Identity(Base):
    __tablename__ = "identities"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False)  # USER, GUIDE, MANAGER, ADMIN
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=get_utc_now)

    user = relationship("User", back_populates="identity", uselist=False)
    guide = relationship("Guide", back_populates="identity", uselist=False)
    manager = relationship("Manager", back_populates="identity", uselist=False)
    admin = relationship("Admin", back_populates="identity", uselist=False)


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    identity_id = Column(String(36), ForeignKey("identities.id"), unique=True, nullable=False)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    preferred_name = Column(String(100), nullable=True)
    photo_url = Column(String(500), nullable=True)
    age = Column(Integer, nullable=True)
    gender = Column(String(50), nullable=True)
    preferred_language = Column(String(50), default="English")
    additional_languages = Column(JSON, default=list)
    country = Column(String(100), default="India")
    home_city = Column(String(100), nullable=True)
    phone = Column(String(50), nullable=True)
    preferred_communication = Column(String(50), default="Both")  # Voice, Text, Both
    emergency_contact_name = Column(String(100), nullable=True)
    emergency_contact_phone = Column(String(50), nullable=True)
    is_profile_complete = Column(Boolean, default=False)
    created_at = Column(DateTime, default=get_utc_now)

    identity = relationship("Identity", back_populates="user")
    trips = relationship("Trip", back_populates="user")


class Guide(Base):
    __tablename__ = "guides"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    identity_id = Column(String(36), ForeignKey("identities.id"), unique=True, nullable=False)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    photo_url = Column(String(500), nullable=True)
    phone = Column(String(50), nullable=True)
    status = Column(String(50), default="ACTIVE")  # ACTIVE, BUSY, DUTY_OFF
    approval_status = Column(String(50), default="PENDING")  # PENDING, APPROVED, REJECTED
    languages = Column(JSON, default=list)
    destinations = Column(JSON, default=list)  # Supported cities/regions
    experience_years = Column(Integer, default=1)
    specializations = Column(JSON, default=list)  # Trekking, History, Culinary, Photography
    destination_knowledge = Column(Text, nullable=True)
    safety_information = Column(Text, nullable=True)
    rating = Column(Float, default=5.0)
    review_count = Column(Integer, default=0)
    current_trip_id = Column(String(36), nullable=True)
    created_at = Column(DateTime, default=get_utc_now)

    identity = relationship("Identity", back_populates="guide")
    assignments = relationship("GuideAssignment", back_populates="guide")
    reviews = relationship("Review", back_populates="guide")


class Manager(Base):
    __tablename__ = "managers"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    identity_id = Column(String(36), ForeignKey("identities.id"), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    department = Column(String(100), default="Operations")
    created_at = Column(DateTime, default=get_utc_now)

    identity = relationship("Identity", back_populates="manager")


class Admin(Base):
    __tablename__ = "admins"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    identity_id = Column(String(36), ForeignKey("identities.id"), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=get_utc_now)

    identity = relationship("Identity", back_populates="admin")


class Location(Base):
    __tablename__ = "locations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(100), nullable=False, index=True)
    state = Column(String(100), nullable=False)
    country = Column(String(100), default="India")
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    place_id = Column(String(255), nullable=True, index=True)  # Provider canonical id (Google Places)
    description = Column(Text, nullable=True)
    hero_image = Column(String(500), nullable=True)
    popular_season = Column(String(100), nullable=True)


class Trip(Base):
    __tablename__ = "trips"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    source_location_id = Column(String(36), ForeignKey("locations.id"), nullable=False)
    destination_location_id = Column(String(36), ForeignKey("locations.id"), nullable=False)
    source_name = Column(String(100), nullable=False)
    destination_name = Column(String(100), nullable=False)
    start_datetime = Column(DateTime, nullable=False)
    end_datetime = Column(DateTime, nullable=False)
    status = Column(String(50), default="DRAFT")  # DRAFT, PLANNED, REQUESTED, GUIDE_ASSIGNED, PAID, ACTIVE, COMPLETED
    mode = Column(String(50), nullable=True)  # GUIDE_MODE, ADVENTUROUS_MODE
    budget = Column(Float, default=15000.0)
    total_cost = Column(Float, default=0.0)
    created_at = Column(DateTime, default=get_utc_now)
    updated_at = Column(DateTime, default=get_utc_now, onupdate=get_utc_now)

    user = relationship("User", back_populates="trips")
    profile = relationship("TripProfile", back_populates="trip", uselist=False)
    itineraries = relationship("Itinerary", back_populates="trip")
    guide_assignment = relationship("GuideAssignment", back_populates="trip", uselist=False)
    payment = relationship("Payment", back_populates="trip", uselist=False)
    replanning_logs = relationship("ReplanningLog", back_populates="trip")
    offline_package = relationship("OfflinePackage", back_populates="trip", uselist=False)


class TripProfile(Base):
    __tablename__ = "trip_profiles"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    trip_id = Column(String(36), ForeignKey("trips.id"), unique=True, nullable=False)
    questions_answers = Column(JSON, default=dict)
    party_type = Column(String(50), default="Solo")
    experience_type = Column(String(50), default="Relaxed")
    food_pref = Column(String(50), default="Veg")
    stay_pref = Column(String(50), default="3 Star")
    transport_pref = Column(String(50), default="Train")
    walking_tolerance = Column(String(50), default="Moderate")
    language = Column(String(50), default="English")
    specific_places = Column(JSON, default=list)
    priority = Column(String(50), default="Balanced")
    created_at = Column(DateTime, default=get_utc_now)

    trip = relationship("Trip", back_populates="profile")


class Itinerary(Base):
    __tablename__ = "itineraries"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    trip_id = Column(String(36), ForeignKey("trips.id"), nullable=False)
    version = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)
    total_cost = Column(Float, default=0.0)
    days_data = Column(JSON, default=list)  # Detailed list of days, stops, typed pins
    cost_breakdown = Column(JSON, default=dict)  # travel estimate items + dynamic fees
    created_at = Column(DateTime, default=get_utc_now)

    trip = relationship("Trip", back_populates="itineraries")


class GuideAssignment(Base):
    __tablename__ = "guide_assignments"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    trip_id = Column(String(36), ForeignKey("trips.id"), unique=True, nullable=False)
    guide_id = Column(String(36), ForeignKey("guides.id"), nullable=True)
    manager_id = Column(String(36), ForeignKey("managers.id"), nullable=True)
    status = Column(String(50), default="REQUESTED")  # REQUESTED, ACCEPTED, REJECTED, CONFIRMED
    match_score = Column(Float, default=0.0)
    match_breakdown = Column(JSON, default=dict)
    requested_at = Column(DateTime, default=get_utc_now)
    confirmed_at = Column(DateTime, nullable=True)

    trip = relationship("Trip", back_populates="guide_assignment")
    guide = relationship("Guide", back_populates="assignments")


class Payment(Base):
    __tablename__ = "payments"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    trip_id = Column(String(36), ForeignKey("trips.id"), unique=True, nullable=False)
    razorpay_order_id = Column(String(100), nullable=False)
    razorpay_payment_id = Column(String(100), nullable=True)
    razorpay_signature = Column(String(255), nullable=True)
    status = Column(String(50), default="PENDING")  # PENDING, SUCCESS, FAILED
    total_amount = Column(Float, nullable=False)
    currency = Column(String(10), default="INR")
    created_at = Column(DateTime, default=get_utc_now)

    trip = relationship("Trip", back_populates="payment")
    split = relationship("PaymentSplit", back_populates="payment", uselist=False)


class PaymentSplit(Base):
    __tablename__ = "payment_splits"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    payment_id = Column(String(36), ForeignKey("payments.id"), unique=True, nullable=False)
    transport_cost = Column(Float, default=0.0)
    stay_cost = Column(Float, default=0.0)
    food_cost = Column(Float, default=0.0)
    activity_cost = Column(Float, default=0.0)
    guide_fee = Column(Float, default=0.0)
    platform_fee = Column(Float, default=0.0)
    settlement_status = Column(String(50), default="PENDING")  # PENDING, SETTLED
    settled_at = Column(DateTime, nullable=True)

    payment = relationship("Payment", back_populates="split")


class Review(Base):
    __tablename__ = "reviews"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    trip_id = Column(String(36), ForeignKey("trips.id"), nullable=False)
    guide_id = Column(String(36), ForeignKey("guides.id"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    user_name = Column(String(100), default="Anonymous")
    rating = Column(Integer, nullable=False)  # 1 to 5 stars
    comment = Column(Text, nullable=True)
    is_visible_on_profile = Column(Boolean, default=True)
    created_at = Column(DateTime, default=get_utc_now)

    guide = relationship("Guide", back_populates="reviews")


class ReplanningLog(Base):
    __tablename__ = "replanning_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    trip_id = Column(String(36), ForeignKey("trips.id"), nullable=False)
    trigger_type = Column(String(50), nullable=False)  # WEATHER, USER_PREFERENCE, BUDGET, DISRUPTION
    reason = Column(String(255), nullable=False)
    explanation = Column(Text, nullable=False)  # "Why did my plan change?"
    old_version = Column(Integer, nullable=False)
    new_version = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=get_utc_now)

    trip = relationship("Trip", back_populates="replanning_logs")


class OfflinePackage(Base):
    __tablename__ = "offline_packages"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    trip_id = Column(String(36), ForeignKey("trips.id"), unique=True, nullable=False)
    package_data = Column(JSON, nullable=False)
    generated_at = Column(DateTime, default=get_utc_now)

    trip = relationship("Trip", back_populates="offline_package")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    action = Column(String(100), nullable=False)  # ELEVATION, GUIDE_APPROVAL, SETTLEMENT, MODERATION
    actor_email = Column(String(255), nullable=False)
    actor_role = Column(String(50), nullable=False)
    target_id = Column(String(100), nullable=True)
    details = Column(JSON, default=dict)
    created_at = Column(DateTime, default=get_utc_now)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    trip_id = Column(String(36), ForeignKey("trips.id"), nullable=False)
    sender_role = Column(String(50), nullable=False)  # USER, GUIDE, AI
    sender_id = Column(String(36), nullable=False)
    sender_name = Column(String(100), nullable=False)
    message = Column(Text, nullable=False)
    channel = Column(String(50), default="AI")  # AI, GUIDE
    lat = Column(Float, nullable=True)  # traveller's real GPS position (device-reported)
    lng = Column(Float, nullable=True)
    created_at = Column(DateTime, default=get_utc_now)
