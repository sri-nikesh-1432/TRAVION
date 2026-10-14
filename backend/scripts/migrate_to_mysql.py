"""TRAVION data migration: SQLite / PostgreSQL → MySQL.

Run from backend/:

    # 1. Create the target schema (schema.sql via Workbench, or):
    python scripts/migrate_to_mysql.py --source sqlite:///./travion.db \
        --dest mysql+pymysql://user:pass@host:3306/travion_db \
        --create-schema --dry-run      # inspect first
    # 2. For real:
    python scripts/migrate_to_mysql.py --source sqlite:///./travion.db \
        --dest mysql+pymysql://user:pass@host:3306/travion_db

What it guarantees:
  * tables are copied in FOREIGN-KEY dependency order (parents first);
  * rows whose primary key already exists in the destination are SKIPPED
    (idempotent — re-running never duplicates);
  * after the copy, per-table row counts and an FK-orphan audit are run and
    printed; any mismatch aborts with a non-zero exit code;
  * money columns are copied as exact numerics (the MySQL side is
    DECIMAL(12,2)); JSON, boolean and tz-aware datetime columns are
    translated by SQLAlchemy on both ends — no hand-rolled casting.

Flags:
  --create-schema   create missing tables in the destination first
  --truncate-dest   wipe destination tables (FK checks off) before copying
  --dry-run         read + validate the plan, copy nothing
  --batch-size N    rows per insert (default 500)

If your production data lives in a managed PostgreSQL instance you no longer
have access to, export it first (pg_dump --data-only or a CSV per table) —
see database/README.md §"Migrating existing data". This script cannot reach a
database it is not given credentials for.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, inspect, select, func, text  # noqa: E402
from sqlalchemy.engine import Engine  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402

from app.core.db import Base  # noqa: E402
import app.models  # noqa: F401,E402  — registers every table on Base.metadata

DEFAULT_SOURCE = "sqlite:///" + str(
    Path(__file__).resolve().parent.parent / "travion.db"
)


def _fk_order(metadata) -> List[str]:
    """Table names, parents before children (safe insert order)."""
    # sorted_tables is SQLAlchemy's FK-dependency ordering (parents first).
    return [table.name for table in metadata.sorted_tables]


def _pk_columns(table) -> List[str]:
    return [c.name for c in table.primary_key.columns]


def _zero_for(column):
    """Type-appropriate fallback for legacy NULLs in NOT NULL columns."""
    from datetime import datetime as _dt
    from sqlalchemy import Boolean, DateTime, Integer, Float, Numeric, JSON
    t = column.type
    if isinstance(t, Boolean):
        return False
    if isinstance(t, DateTime):
        return _dt(1970, 1, 1)
    if isinstance(t, JSON):
        return {}
    if isinstance(t, (Integer, Float, Numeric)):
        return 0
    return ""


def _sanitize_row(table, row) -> Dict[str, Any]:
    """Legacy SQLite/PG rows can hold NULL in columns the model declares
    NOT NULL (SQLite does not retrofit NOT NULL when a column is added, and
    `_ensure_runtime_columns` adds some columns without a default). MySQL's
    strict mode rejects those rows — substitute the model's Python default,
    or a type-appropriate zero, exactly as the app itself would have written
    the row today. The caller counts substitutions and reports them."""
    out = dict(row)
    for c in table.c:
        if out.get(c.name) is None and not c.nullable:
            default = c.default
            if default is not None:
                out[c.name] = default.arg if not callable(default.arg) else default.arg()
            else:
                out[c.name] = _zero_for(c)
    return out


def copy_table(
    src: Engine, dst: Engine, table, batch_size: int, dry_run: bool,
    create_schema: bool = False,
) -> Dict[str, Any]:
    insp_dst = inspect(dst)
    with src.connect() as conn:
        source_count = conn.execute(select(func.count()).select_from(table)).scalar() or 0
        if not insp_dst.has_table(table.name):
            status = ("DRY-RUN: table would be created"
                      if dry_run and create_schema else "MISSING_IN_DEST")
            return {"table": table.name, "status": status, "copied": 0,
                    "source": source_count, "skipped_existing": 0,
                    "skipped_conflict": 0, "sanitized": 0}

        existing: set = set()
        pk_cols = _pk_columns(table)
        with dst.connect() as dconn:
            for row in dconn.execute(select(*[table.c[c] for c in pk_cols])):
                existing.add(tuple(row))

        copied = skipped = conflicts = sanitized = 0
        if not dry_run and source_count:
            columns = list(table.c.keys())
            offset = 0
            with dst.connect() as dconn:
                trans = dconn.begin()
                while True:
                    chunk = conn.execute(
                        select(*[table.c[c] for c in columns])
                        .offset(offset).limit(batch_size)
                    ).mappings().all()
                    if not chunk:
                        break
                    offset += len(chunk)
                    rows: List[Dict[str, Any]] = []
                    for r in chunk:
                        key = tuple(r[c] for c in pk_cols)
                        if key in existing:
                            skipped += 1
                            continue
                        row = _sanitize_row(table, r)
                        if row != dict(r):
                            sanitized += 1
                        rows.append(row)
                    if rows:
                        try:
                            dconn.execute(table.insert(), rows)
                            copied += len(rows)
                        except IntegrityError:
                            # A non-PK unique key already exists in the dest
                            # (e.g. a demo-seeded identity email with a
                            # different UUID). Roll back the batch, then retry
                            # row-by-row under SAVEPOINTs so only the true
                            # conflicts are skipped, never the whole batch.
                            trans.rollback()
                            for row in rows:
                                nested = dconn.begin_nested()
                                try:
                                    dconn.execute(table.insert(), [row])
                                    nested.commit()
                                    copied += 1
                                except IntegrityError:
                                    nested.rollback()
                                    conflicts += 1
                dconn.commit()
    return {"table": table.name, "status": "OK", "copied": copied,
            "source": source_count, "skipped_existing": skipped,
            "skipped_conflict": conflicts, "sanitized": sanitized}


def audit(dst: Engine, metadata) -> List[str]:
    """FK-orphan audit: child rows pointing at parents that don't exist."""
    problems: List[str] = []
    with dst.connect() as conn:
        for table in metadata.sorted_tables:
            for fk in table.foreign_keys:
                parent = fk.column.table.name  # resolved Table object, schema-safe
                child_col = fk.parent.name
                parent_col = fk.column.name
                orphans = conn.execute(text(f"""
                    SELECT COUNT(*) FROM {table.name} c
                    LEFT JOIN {parent} p ON c.{child_col} = p.{parent_col}
                    WHERE p.{parent_col} IS NULL AND c.{child_col} IS NOT NULL
                """)).scalar() or 0
                if orphans:
                    problems.append(
                        f"{table.name}.{child_col} -> {parent}.{parent_col}: "
                        f"{orphans} orphaned row(s)"
                    )
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default=DEFAULT_SOURCE,
                    help=f"SQLAlchemy URL of the source DB (default: {DEFAULT_SOURCE})")
    ap.add_argument("--dest", default=None,
                    help="SQLAlchemy URL of the MySQL destination "
                         "(default: DATABASE_URL / DB_* env, see app.core.config)")
    ap.add_argument("--create-schema", action="store_true",
                    help="create missing destination tables from the ORM metadata")
    ap.add_argument("--truncate-dest", action="store_true",
                    help="delete all destination rows first (never touches source)")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be copied; write nothing")
    ap.add_argument("--batch-size", type=int, default=500)
    args = ap.parse_args()

    if args.dest is None:
        from app.core.config import build_database_url
        args.dest = build_database_url()
        if args.dest.startswith("sqlite"):
            print("ERROR: no MySQL destination configured. Set DATABASE_URL or "
                  "DB_HOST/DB_NAME/DB_USER/DB_PASSWORD, or pass --dest.")
            return 2

    src = create_engine(args.source)
    dst = create_engine(args.dest, pool_pre_ping=True)

    print(f"source : {src.url.render_as_string(hide_password=True)}")
    print(f"dest   : {dst.url.render_as_string(hide_password=True)}")
    print(f"mode   : {'DRY RUN' if args.dry_run else 'COPY'}")

    if args.create_schema and not args.dry_run:
        Base.metadata.create_all(bind=dst)
        print("destination schema: ensured (create_all)")

    if args.truncate_dest and not args.dry_run:
        with dst.begin() as conn:
            conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
            for table in reversed(Base.metadata.sorted_tables):
                conn.execute(text(f"DELETE FROM {table.name}"))
            conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))
        print("destination rows: truncated (FK checks were disabled)")

    results = []
    for name in _fk_order(Base.metadata):
        table = Base.metadata.tables[name]
        results.append(copy_table(src, dst, table, args.batch_size,
                                  args.dry_run, args.create_schema))

    print(f"\n{'table':<26}{'source':>8}{'copied':>8}{'skip-pk':>8}{'skip-ux':>8}"
          f"{'nulled':>8}  status")
    print("-" * 80)
    failed = False
    for r in results:
        print(f"{r['table']:<26}{r['source']:>8}{r['copied']:>8}"
              f"{r['skipped_existing']:>8}{r['skipped_conflict']:>8}"
              f"{r['sanitized']:>8}  {r['status']}")
        if r["status"] == "MISSING_IN_DEST":
            failed = True

    if args.dry_run:
        print("\nDRY RUN — nothing was written.")
        return 1 if failed else 0

    print("\nvalidation: row counts per table (source vs destination)")
    bad_counts = []
    with dst.connect() as dconn, src.connect() as sconn:
        for r in results:
            if r["status"] != "OK":
                continue
            actual = dconn.execute(
                select(func.count()).select_from(Base.metadata.tables[r["table"]])
            ).scalar() or 0
            # Rows intentionally skipped (already present by PK, or conflicting
            # on a unique key such as a pre-seeded email) do not count against
            # the destination — the check is that every NON-skipped row landed.
            want = r["source"] - r["skipped_existing"] - r["skipped_conflict"]
            ok = actual >= want  # dest may legitimately hold extra pre-existing rows
            if not ok:
                bad_counts.append(f"{r['table']}: dest={actual} < expected {want}")
            print(f"  {r['table']:<26} source={r['source']:<8} "
                  f"expected>={want:<8} dest={actual:<8} "
                  f"{'OK' if ok else 'SHORT'}")

    orphans = audit(dst, Base.metadata)
    print("\nvalidation: foreign-key orphan audit")
    if orphans:
        for o in orphans:
            print(f"  ORPHAN: {o}")
        failed = True
    else:
        print("  OK — every FK child row resolves to a parent row.")

    if bad_counts or failed:
        print("\nMIGRATION FAILED:", "; ".join(bad_counts) or "see above")
        return 1
    print("\nMIGRATION COMPLETE — counts and FK integrity verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
