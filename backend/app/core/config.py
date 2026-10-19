import os
from pathlib import Path
from dotenv import load_dotenv
from pydantic import BaseModel
from sqlalchemy.engine import URL

# Load backend/.env (relative to this file: app/core -> app -> backend)
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(_BACKEND_DIR / ".env")


def build_database_url() -> str:
    """Resolve the application database URL (MySQL is the target engine).

    Resolution order — deliberately explicit so no two settings contradict
    each other:

    1. ``DATABASE_URL`` — full SQLAlchemy URL. Expected production form:
       ``mysql+pymysql://USER:PASSWORD@HOST:3306/travion_db``.
       Built with ``sqlalchemy.URL.create`` (see ``DB_*`` below) or provided
       verbatim by the platform (passwords with special characters are fine
       when URL-encoded).
    2. ``DB_HOST`` + ``DB_NAME`` (+ ``DB_USER``/``DB_PASSWORD``/``DB_PORT``) —
       component-wise MySQL configuration assembled with ``URL.create`` so
       special characters in the password never break parsing.
    3. SQLite local-development fallback (zero-config ``backend/travion.db``)
       — kept only so the existing local workflow and offline test suite keep
       running without a MySQL server. Production MUST set one of the above.

    The returned URL always targets ``travion_db`` (or ``DB_NAME``) for MySQL.
    """
    explicit = os.getenv("DATABASE_URL", "").strip()
    if explicit:
        return explicit

    host = os.getenv("DB_HOST", "").strip()
    name = (os.getenv("DB_NAME", "").strip() or "travion_db")
    if host:
        user = os.getenv("DB_USER", "").strip() or "travion"
        password = os.getenv("DB_PASSWORD", "") or ""
        port = int(os.getenv("DB_PORT", "3306") or 3306)
        return URL.create(
            drivername="mysql+pymysql",
            username=user,
            password=password,
            host=host,
            port=port,
            database=name,
            query={"charset": "utf8mb4", "collation": "utf8mb4_unicode_ci"},
        ).render_as_string(hide_password=False)

    return "sqlite:///./travion.db"


class Settings(BaseModel):
    PROJECT_NAME: str = "Travion — AI Travel Orchestration Platform"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = os.getenv("JWT_SIGNING_SECRET", "travion-super-secret-production-jwt-key-2026")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # Database: MySQL (travion_db) in production; SQLite zero-config fallback
    # for local development only. See build_database_url() for precedence.
    DATABASE_URL: str = build_database_url()
    DB_NAME: str = os.getenv("DB_NAME", "travion_db")
    
    # Authorized Access Entry Codes
    MANAGER_ELEVATION_SECRET: str = os.getenv("MANAGER_ELEVATION_SECRET", "SIH-MANAGER")
    ADMIN_ELEVATION_SECRET: str = os.getenv("ADMIN_ELEVATION_SECRET", "SIH-ADMIN")

    # CORS allow-list (comma-separated). Defaults to local dev origins.
    CORS_ALLOW_ORIGINS: str = os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,https://travions.netlify.app,https://travion18.netlify.app",
    )
    
    # External APIs
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    OPENWEATHER_API_KEY: str = os.getenv("OPENWEATHER_API_KEY", "")
    # Live events provider (PredictHQ or compatible). Optional — when unset the
    # events endpoint honestly returns an empty list instead of inventing data.
    EVENTS_API_KEY: str = os.getenv("EVENTS_API_KEY", "")
    # Server-side ONLY — never exposed to the frontend (no VITE_ key).
    GOOGLE_PLACES_API_KEY: str = os.getenv("GOOGLE_PLACES_API_KEY", "")
    # GeoApify Places API — PRIMARY real-place discovery provider (Step 3).
    # Server-side ONLY — never exposed to the frontend.
    GEOAPIFY_API_KEY: str = os.getenv("GEOAPIFY_API_KEY", "")
    RAZORPAY_KEY_ID: str = os.getenv("RAZORPAY_KEY_ID", "rzp_test_travion_live")
    RAZORPAY_KEY_SECRET: str = os.getenv("RAZORPAY_KEY_SECRET", "travion_sec_verified_razorpay")
    # WeatherStack — current + historical weather (primary weather provider)
    WEATHERSTACK_API_KEY: str = os.getenv("WEATHERSTACK_API_KEY", "") or os.getenv("WEATHER_STACK_API_KEY", "")
    # AviationStack — real-time flight data
    AVIATIONSTACK_API_KEY: str = (
        os.getenv("AVIATION_STACK_API_KEY", "") or os.getenv("AVIATIONSTACK_API_KEY", "")
    )
    RAPIDAPI_KEY: str = os.getenv("RAPIDAPI_KEY", "")
    RAPIDAPI_HOST_IRCTC: str = os.getenv("RAPIDAPI_HOST_IRCTC", "irctc1.p.rapidapi.com")
    # Google OAuth
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")

settings = Settings()
