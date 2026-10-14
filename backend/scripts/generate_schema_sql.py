"""Generate `database/schema.sql` from the SQLAlchemy metadata.

The SQL file is the MySQL Workbench entry point (§4 of the master spec): it
must always describe exactly the same schema the ORM creates at startup, so it
is generated from the models rather than hand-maintained.

Usage (from `backend/`):

    python scripts/generate_schema_sql.py

Output: `database/schema.sql` (repository root). Import it in MySQL Workbench
against an empty `travion_db` schema; it is idempotent (`IF NOT EXISTS`).
"""

from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy.dialects import mysql  # noqa: E402
from sqlalchemy.schema import CreateIndex, CreateTable, sort_tables  # noqa: E402

# Importing the package registers every model on Base.metadata.
import app.models  # noqa: E402,F401
from app.core.db import Base  # noqa: E402

HEADER = """-- =============================================================================
-- TRAVION — MySQL schema for `travion_db`
-- =============================================================================
-- GENERATED FILE — do not edit by hand.
-- Source of truth: backend/app/models/entities.py
-- Regenerate:      cd backend && python scripts/generate_schema_sql.py
--
-- How to use (MySQL Workbench):
--   1. Create the schema first:  CREATE DATABASE IF NOT EXISTS `travion_db`
--        CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   2. Select it as the default schema in the connected session (schemas panel).
--   3. Run this script (File > Run SQL Script, or Ctrl+Shift+R).
--   4. Verify with:  SHOW TABLES;   and the EER diagram (Database > Reverse Engineer).
--
-- Notes
--   * Character set: utf8mb4 / utf8mb4_unicode_ci (full Unicode, emoji-safe).
--   * Engine: InnoDB (foreign keys, transactions, row-level locking).
--   * Money columns: DECIMAL(12,2) — exact base-10 arithmetic, never FLOAT.
--   * Coordinates: DOUBLE — scientific values, not money.
--   * Timestamps: DATETIME stored in UTC; the application converts for display.
--   * The backend additionally applies additive startup migrations
--     (app/main.py::_ensure_runtime_columns) — this file is the full baseline.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

"""


TABLE_OPTIONS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"


def build_sql() -> str:
    tables = list(Base.metadata.sorted_tables)
    # sort_tables gives FK-safe creation order (parents before children).
    ordered = list(sort_tables(tables))

    dialect = mysql.dialect()
    parts = [HEADER]

    for table in ordered:
        ddl = str(CreateTable(table).compile(dialect=dialect)).rstrip()
        # Idempotent script: never fail because the table already exists.
        ddl = ddl.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ", 1)
        # Engine / charset are appended as plain DDL text — cleaner than
        # mutating the shared metadata's dialect kwargs (which SQLAlchemy
        # treats as immutable).
        if ddl.endswith(")"):
            ddl = f"{ddl} {TABLE_OPTIONS}"
        parts.append(ddl + ";\n")

        # Index objects (Column(index=True) + explicit Index) are never inline
        # for MySQL — they are compiled as standalone CREATE INDEX statements.
        for index in sorted(table.indexes, key=lambda i: i.name or ""):
            idx = str(CreateIndex(index).compile(dialect=dialect)).rstrip()
            parts.append(idx + ";\n")

    parts.append("\nSET FOREIGN_KEY_CHECKS = 1;\n")
    return "\n".join(parts)


def main() -> None:
    out = REPO_ROOT / "database" / "schema.sql"
    out.parent.mkdir(parents=True, exist_ok=True)
    sql = build_sql()
    out.write_text(sql, encoding="utf-8")
    table_count = len(Base.metadata.tables)
    print(f"Wrote {out} ({table_count} tables, {len(sql)} bytes)")


if __name__ == "__main__":
    main()
