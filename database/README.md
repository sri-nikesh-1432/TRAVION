# TRAVION — MySQL database (`travion_db`)

MySQL 8.0 is the **production database engine** for TRAVION. SQLite remains
supported only as a zero-config local development/test fallback — when no
MySQL URL is configured, `backend/app/core/config.py` falls back to
`sqlite:///./travion.db` and the application runs unchanged.

| File | What it is |
|---|---|
| `schema.sql` | The complete schema (21 tables, InnoDB, `utf8mb4_unicode_ci`, DECIMAL money). **Generated** — never hand-edit. |
| `seed.sql` | Optional development seed: the 15 verified locations + demo Manager/Admin/Guide logins. Contains **no** fake trips, payments or analytics. |
| `README.md` | This file. |

`seed.sql` begins with `USE travion_db;` — edit that line if you name the
database differently. `schema.sql` deliberately has no `USE`: select the target
schema in Workbench (or pass it on the CLI, `mysql … travion_db < schema.sql`).

---

## 1. Create the database and user

MySQL Workbench (or any MySQL client) as a user with `CREATE USER` rights:

```sql
CREATE DATABASE IF NOT EXISTS travion_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'travion'@'%' IDENTIFIED BY 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON travion_db.* TO 'travion'@'%';
FLUSH PRIVILEGES;
```

`utf8mb4` + `utf8mb4_unicode_ci` are required: the case-insensitive collation
is what enforces one-account-per-email at the database level (see §6).

## 2. Load the schema

**MySQL Workbench:** File → Open SQL Script → `database/schema.sql` → select
the `travion_db` schema in the schema sidebar → Execute (lightning bolt).

**CLI:**

```bash
mysql -h 127.0.0.1 -u travion -p travion_db < database/schema.sql
```

Alternatively let Alembic create it (identical result — both are generated
from the same SQLAlchemy models; the structural equivalence is verified in CI
fashion by `backend/tests/test_schema_consistency.py`):

```bash
cd backend
alembic upgrade head
```

## 3. Optional development seed

```bash
mysql -h 127.0.0.1 -u travion -p travion_db < database/seed.sql
```

Creates only reference data the app itself would seed at startup (locations,
demo logins). Every statement is `INSERT IGNORE`, so it is idempotent and safe
to run before or after the application has booted once — the app's startup
seeding detects existing rows and skips them. Verify a seeded login with
`python backend/scripts/verify_seed_login.py` (with `DATABASE_URL` pointing at
the seeded database).

Documented demo credentials (development only — rotate or delete for any
shared environment):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@travion.in` | `adminpassword` |
| Manager | `manager@travion.in` | `managerpassword` |
| Guide | `arun.nilgiri@travion.in` | `guide1234` |

## 4. Environment variables

The backend resolves its database in this order (see
`backend/app/core/config.py::build_database_url`):

1. `DATABASE_URL` — a single SQLAlchemy URL, e.g.
   `mysql+pymysql://travion:pass@host:3306/travion_db?charset=utf8mb4`
2. Component variables: `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`,
   `DB_PORT` (default 3306) — assembled into the same URL
3. Fallback: `sqlite:///./travion.db` (local development only)

Copy `backend/.env.example` → `backend/.env` and fill in real values. Never
commit `.env`.

## 5. Backup and restore

**Backup (full logical dump):**

```bash
mysqldump -h 127.0.0.1 -u travion -p \
  --single-transaction --routines --triggers \
  travion_db > travion_db_$(date +%Y%m%d_%H%M).sql
```

Workbench: Server → Data Export → select `travion_db` → "Dump to
Self-Contained File" → Start Export.

**Restore:**

```bash
mysql -h 127.0.0.1 -u travion -p travion_db < travion_db_20260101_1200.sql
```

Workbench: Server → Data Import → "Import from Self-Contained File" → select
the dump → Start Import.

`--single-transaction` gives a consistent snapshot on InnoDB without locking
reads. Schedule it (Task Scheduler / cron) and keep dumps off the database
host.

## 6. Known MySQL differences (vs the SQLite dev fallback)

* **Case-insensitive e-mail uniqueness.** SQLite/PostgreSQL enforce it with a
  functional unique index `ix_identities_email_norm` on `lower(email)`;
  MySQL has no `CREATE INDEX IF NOT EXISTS` for functional indexes, so
  `travion_db` instead relies on the `UNIQUE(email)` table constraint plus
  the case-insensitive `utf8mb4_unicode_ci` collation — `'A@x.com'` and
  `'a@x.com'` collide exactly as the functional index would. The runtime
  migration guard in `backend/app/main.py` skips the functional index on
  MySQL for this reason. `backend/tests/test_auth.py` asserts the mechanism
  per dialect.
* **Duplicate-skip inserts are dialect-specific.** SQLite's
  `INSERT OR IGNORE` has no direct MySQL equivalent; the selections ledger
  uses `INSERT … ON DUPLICATE KEY UPDATE id = id` on MySQL and
  `ON CONFLICT DO NOTHING` on PostgreSQL
  (`backend/app/services/place_selections.py`). Never write SQLite-only SQL
  (`PRAGMA`, `INSERT OR IGNORE`, `strftime`) in `backend/app` — the MySQL
  suite will fail on it.
* **Money is `NUMERIC(12,2)`** (MySQL reports it as `decimal(12,2)` in
  `information_schema`; NUMERIC and DECIMAL are synonyms — via `Money()` in
  `backend/app/models/entities.py`) and coordinates are `DOUBLE` — no
  binary-float rounding in financials or geodata.
* **DDL is non-transactional.** Alembic runs MySQL migrations with
  "assume non-transactional DDL"; a failed migration can leave partial DDL
  behind. The baseline migration's `downgrade()` therefore drops whole
  tables (children first, FK checks disabled) instead of individual
  indexes — MySQL refuses to drop an index a foreign key is bound to
  (errno 1553).
* **Timestamps** are stored naive-UTC; SQLAlchemy converts tz-aware Python
  datetimes on write/read.

## 7. Migrating existing data into MySQL

`backend/scripts/migrate_to_mysql.py` copies any SQLAlchemy source (SQLite or
PostgreSQL) into MySQL with FK-ordered inserts, primary-key/unique-conflict
skips, legacy-NULL sanitisation, and post-copy validation (per-table row
counts + a foreign-key orphan audit):

```bash
cd backend
# inspect first — writes nothing
python scripts/migrate_to_mysql.py \
  --source sqlite:///./travion.db \
  --dest mysql+pymysql://travion:pass@host:3306/travion_db \
  --create-schema --dry-run

# real run
python scripts/migrate_to_mysql.py \
  --source sqlite:///./travion.db \
  --dest mysql+pymysql://travion:pass@host:3306/travion_db
```

Flags: `--truncate-dest` (wipe destination rows first), `--batch-size N`
(default 500), `--dry-run`. Re-running is safe: existing primary keys are
skipped, so the copy is idempotent.

**From a PostgreSQL instance you cannot connect to:** this repository's
runtime data has always lived in `backend/travion.db` (SQLite); no live
PostgreSQL credentials are present in the repo or its history, so a live
PG→MySQL pull cannot be performed from here. If you hold the source system,
export per table first and load the dumps, or simply run the script with
`--source postgresql://…` from a machine that can reach it:

```bash
pg_dump --data-only --no-owner -d <old_pg_db> > pg_data.sql   # then: mysql < pg_data.sql
# or per-table CSV: \copy (SELECT * FROM trips) TO 'trips.csv' WITH CSV HEADER
```

## 8. Regenerating the SQL files

`schema.sql` and `seed.sql` are generated from source — never hand-edit them:

```bash
cd backend
python scripts/generate_schema_sql.py    # → database/schema.sql (from SQLAlchemy metadata)
python scripts/generate_seed_sql.py      # → database/seed.sql   (from VERIFIED_LOCATIONS + demo staff)
```

Schema changes must also get an Alembic revision:

```bash
cd backend
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
```

`backend/tests/test_schema_consistency.py` fails if `schema.sql` drifts from
the ORM metadata, so regenerate and commit both together.
