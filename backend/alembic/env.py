"""Alembic environment for TRAVION.

Connects to the SAME database the FastAPI application uses (MySQL
`travion_db` in production — resolved by app.core.config.build_database_url)
so migrations, schema.sql and runtime tables can never drift apart.

Models are registered by importing the package only — app.main is deliberately
NOT imported because it runs create_all()/startup seeding, which would defeat
autogenerate's diff against an empty database.
"""
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from sqlalchemy.engine import make_url

from alembic import context

from app.core.config import settings
from app.core.db import Base
import app.models  # noqa: F401  — registers every table on Base.metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Same precedence as the application: DATABASE_URL → DB_* components → SQLite
# dev fallback (see app/core/config.py::build_database_url).
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL without a DB connection)."""
    url = make_url(config.get_main_option("sqlalchemy.url"))
    context.configure(
        url=url.render_as_string(hide_password=False),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live database (normal path)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
