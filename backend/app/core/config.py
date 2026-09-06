import os
from pathlib import Path
from dotenv import load_dotenv
from pydantic import BaseModel

# Load backend/.env (relative to this file: app/core -> app -> backend)
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(_BACKEND_DIR / ".env")

class Settings(BaseModel):
    PROJECT_NAME: str = "Travion — AI Travel Orchestration Platform"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = os.getenv("JWT_SIGNING_SECRET", "travion-super-secret-production-jwt-key-2026")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # Database: SQLite by default for zero-config run, PostgreSQL when DATABASE_URL provided
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./travion.db")
    
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
    # Server-side ONLY — never exposed to the frontend (no VITE_ key).
    GOOGLE_PLACES_API_KEY: str = os.getenv("GOOGLE_PLACES_API_KEY", "")
    RAZORPAY_KEY_ID: str = os.getenv("RAZORPAY_KEY_ID", "rzp_test_travion_live")
    RAZORPAY_KEY_SECRET: str = os.getenv("RAZORPAY_KEY_SECRET", "travion_sec_verified_razorpay")

settings = Settings()
