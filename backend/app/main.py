from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.db import engine, Base, SessionLocal
from app.api.v1 import (
    auth, locations, trips, discovery, planning, guides, managers, admin,
    payments, replanning, offline, reviews, chat
)
from app.services.verified_data import VERIFIED_LOCATIONS
from app.models.entities import Location, Identity, Guide, Manager, Admin, TripProfile, Itinerary
from app.core.security import get_password_hash
from sqlalchemy import text
from sqlalchemy import inspect

# Create tables (additive: never drops or alters existing production data)
Base.metadata.create_all(bind=engine)


# Production guardrail: warn loudly if critical secrets are still running on
# their development fallbacks. Values are never printed — only the fact that
# a default is in use.
if not settings.DATABASE_URL.startswith("sqlite"):
    if settings.SECRET_KEY == "travion-super-secret-production-jwt-key-2026":
        print("[security] WARNING: JWT_SIGNING_SECRET is not set — using development fallback. Set it in the Render environment.")
    if settings.RAZORPAY_KEY_SECRET == "travion_sec_verified_razorpay":
        print("[security] WARNING: RAZORPAY_KEY_SECRET is not set — payments will run in simulated mode.")


def _ensure_runtime_columns():
    """Additive, dialect-agnostic schema migration for SQLite and PostgreSQL.

    Column existence is checked via SQLAlchemy's inspector (works on both
    dialects, unlike PRAGMA which is SQLite-only), then columns are added with
    plain ALTER TABLE. Existing rows and data are never dropped or recreated —
    safe to run on every deploy/startup.
    """
    _wanted = {
        "itineraries": {"cost_breakdown": "JSON"},
        "users": {"phone": "VARCHAR(50)"},
        "locations": {"place_id": "VARCHAR(255)"},
        "chat_messages": {"lat": "FLOAT", "lng": "FLOAT"},
    }
    try:
        inspector = inspect(engine)
        with engine.begin() as conn:
            for table, columns in _wanted.items():
                if not inspector.has_table(table):
                    continue  # create_all creates it with the full schema
                existing = {c["name"] for c in inspector.get_columns(table)}
                for col, col_type in columns.items():
                    if col not in existing:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"))
    except Exception as exc:  # pragma: no cover
        print(f"[migration] column ensure skipped: {exc}")


_ensure_runtime_columns()

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    description="Production AI-powered end-to-end travel orchestration platform"
)

# CORS configuration
# Explicit allow-list, never a bare "*" with credentials (browsers reject that
# combination and it defeats CSRF protection). Local dev ports plus any
# configured deployed origins.
_configured_origins = [
    o.strip()
    for o in settings.CORS_ALLOW_ORIGINS.split(",")
    if o.strip()
] if settings.CORS_ALLOW_ORIGINS else []
_cors_origins = _configured_origins or [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "https://travions.netlify.app",
    "https://travion18.netlify.app",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(locations.router, prefix=settings.API_V1_STR)
app.include_router(trips.router, prefix=settings.API_V1_STR)
app.include_router(discovery.router, prefix=settings.API_V1_STR)
app.include_router(planning.router, prefix=settings.API_V1_STR)
app.include_router(guides.router, prefix=settings.API_V1_STR)
app.include_router(managers.router, prefix=settings.API_V1_STR)
app.include_router(admin.router, prefix=settings.API_V1_STR)
app.include_router(payments.router, prefix=settings.API_V1_STR)
app.include_router(replanning.router, prefix=settings.API_V1_STR)
app.include_router(offline.router, prefix=settings.API_V1_STR)
app.include_router(reviews.router, prefix=settings.API_V1_STR)
app.include_router(chat.router, prefix=settings.API_V1_STR)

@app.on_event("startup")
def startup_seeding():
    db = SessionLocal()
    try:
        # Seed locations if empty
        if db.query(Location).count() == 0:
            for loc in VERIFIED_LOCATIONS:
                l = Location(
                    id=loc["id"],
                    name=loc["name"],
                    state=loc["state"],
                    country=loc["country"],
                    lat=loc["lat"],
                    lng=loc["lng"],
                    description=loc["description"],
                    hero_image=loc["hero_image"],
                    popular_season=loc["popular_season"]
                )
                db.add(l)
            db.commit()

        # Seed pre-provisioned active guide for Ooty matching demo
        existing_guide = db.query(Identity).filter(Identity.email == "arun.nilgiri@travion.in").first()
        if not existing_guide:
            guide_ident = Identity(
                email="arun.nilgiri@travion.in",
                hashed_password=get_password_hash("guide1234"),
                role="GUIDE"
            )
            db.add(guide_ident)
            db.flush()

            guide = Guide(
                identity_id=guide_ident.id,
                first_name="Arun",
                last_name="Kumar",
                photo_url="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80",
                phone="+91 98421 88410",
                status="ACTIVE",
                approval_status="APPROVED",
                languages=["English", "Tamil", "Hindi"],
                destinations=["Ooty", "Coimbatore", "Munnar"],
                experience_years=8,
                specializations=["Trekking", "Tea History", "Wildlife Photography"],
                destination_knowledge="Born and raised in the Nilgiris. Expert on Toda tribal heritage trails, Shola forests, and secret viewpoint spots away from tourists.",
                safety_information="Always carry woollens after 5 PM. Kalhatty ghat road requires experienced low-gear driving. High altitude acclimatization advisory.",
                rating=4.9,
                review_count=34
            )
            db.add(guide)
            db.commit()

        def _seed_staff(email: str, password: str, role: str, name: str):
            existing = db.query(Identity).filter(Identity.email == email).first()
            if existing:
                return
            ident = Identity(
                email=email,
                hashed_password=get_password_hash(password),
                role=role
            )
            db.add(ident)
            db.flush()
            if role == "MANAGER":
                db.add(Manager(identity_id=ident.id, name=name))
            elif role == "ADMIN":
                db.add(Admin(identity_id=ident.id, name=name))
            db.commit()

        # Seed documented Manager / Admin demo credentials so the login flow
        # works exactly as documented in the README (elevation also works).
        _seed_staff("manager@travion.in", "managerpassword", "MANAGER", "Operations Manager")
        _seed_staff("admin@travion.in", "adminpassword", "ADMIN", "Platform Administrator")

        def _strip_stars(obj):
            if isinstance(obj, dict):
                return {k: _strip_stars(v) for k, v in obj.items()}
            if isinstance(obj, list):
                return [_strip_stars(v) for v in obj]
            if isinstance(obj, str) and "\u2605" in obj:
                return obj.replace("\u2605", " Star")
            return obj

        # Sanitize legacy star-glyph text from persisted records (idempotent).
        changed = False
        for profile in db.query(TripProfile).all():
            if profile.stay_pref and "\u2605" in profile.stay_pref:
                profile.stay_pref = profile.stay_pref.replace("\u2605", " Star")
                changed = True
            if profile.questions_answers:
                cleaned = _strip_stars(profile.questions_answers)
                if cleaned != profile.questions_answers:
                    profile.questions_answers = cleaned
                    changed = True
        for row in db.query(Itinerary).all():
            dirty = False
            for field in ("days_data", "cost_breakdown"):
                value = getattr(row, field, None)
                if value is not None:
                    cleaned = _strip_stars(value)
                    if cleaned != value:
                        setattr(row, field, cleaned)
                        dirty = True
            if dirty:
                changed = True
        if changed:
            db.commit()

    finally:
        db.close()

# WebSocket for real-time trip chat
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, trip_id: str, websocket: WebSocket):
        await websocket.accept()
        if trip_id not in self.active_connections:
            self.active_connections[trip_id] = []
        self.active_connections[trip_id].append(websocket)

    def disconnect(self, trip_id: str, websocket: WebSocket):
        if trip_id in self.active_connections:
            self.active_connections[trip_id].remove(websocket)
            if not self.active_connections[trip_id]:
                del self.active_connections[trip_id]

    async def broadcast(self, trip_id: str, message: dict):
        if trip_id in self.active_connections:
            for connection in self.active_connections[trip_id]:
                await connection.send_json(message)

ws_manager = ConnectionManager()

@app.websocket("/ws/trips/{trip_id}/chat")
async def websocket_chat_endpoint(websocket: WebSocket, trip_id: str):
    await ws_manager.connect(trip_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            # Broadcast message to room
            await ws_manager.broadcast(trip_id, data)
    except WebSocketDisconnect:
        ws_manager.disconnect(trip_id, websocket)

@app.get("/")
@app.get("/health")
def health_check():
    """Lightweight liveness probe — no DB, AI, or network calls."""
    return {
        "platform": settings.PROJECT_NAME,
        "status": "operational",
        "docs": f"{settings.API_V1_STR}/docs"
    }
