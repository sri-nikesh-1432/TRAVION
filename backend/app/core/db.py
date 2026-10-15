from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from app.core.config import settings

URL_VALUE = settings.DATABASE_URL

connect_args = {}
if URL_VALUE.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
elif URL_VALUE.startswith("mysql") and "127.0.0.1" not in URL_VALUE and "localhost" not in URL_VALUE:
    connect_args = {"ssl": {}}


# Engine tuning per dialect:
# - MySQL (target engine, `travion_db`): utf8mb4 comes from the URL query
#   (charset=utf8mb4&collation=utf8mb4_unicode_ci) or driver default. Cloud
#   MySQL closes idle connections, so pool_pre_ping transparently discards
#   dropped connections and pool_recycle recycles them before the server's
#   wait_timeout. Exact DECIMAL/Float money columns are unaffected by pooling.
# - Render/PostgreSQL (legacy source): platform closes idle connections, so
#   dropped pooled connections must be recycled instead of surfacing as 500s.
# - SQLite: single-file local dev, no pooling concerns.
engine_kwargs = {
    "connect_args": connect_args,
    "echo": False,
}
if URL_VALUE.startswith("mysql"):
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_recycle"] = 1800
    engine_kwargs["pool_size"] = 10
    engine_kwargs["max_overflow"] = 20
elif URL_VALUE.startswith("postgresql"):
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_recycle"] = 280

engine = create_engine(
    URL_VALUE,
    **engine_kwargs,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
