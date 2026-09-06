from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from app.core.config import settings

connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

# Render/PostgreSQL: the platform closes idle connections, so dropped pooled
# connections must be transparently recycled instead of surfacing as 500s.
engine_kwargs = {
    "connect_args": connect_args,
    "echo": False,
}
if settings.DATABASE_URL.startswith("postgresql"):
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_recycle"] = 280

engine = create_engine(
    settings.DATABASE_URL,
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
