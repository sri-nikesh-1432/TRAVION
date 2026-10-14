"""Schema deliverables stay honest: database/schema.sql ↔ ORM metadata, and
the MySQL-specific guarantees that only a real MySQL server can prove.

The first tests run everywhere (no server needed): they parse
`database/schema.sql` and `database/seed.sql` and fail if the generated SQL
drifts from the SQLAlchemy models, or if the seed ever contains fabricated
financial rows (trips/payments/reviews — master spec forbids fake data).

The MySQL integration tests activate only when TRAVION_TEST_MYSQL_URL is set,
e.g.

    TRAVION_TEST_MYSQL_URL=mysql+pymysql://travion:pass@127.0.0.1:3307/travion_db \
        python -m pytest tests/test_schema_consistency.py -q

and prove on a live server: FK enforcement, case-insensitive e-mail
uniqueness via the utf8mb4 ci collation, DECIMAL(12,2) exactness, and
transaction rollback. They SKIP (not fail) when the variable is absent, so
the SQLite-only dev loop is unaffected.
"""
import os
import re
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from app.core.db import Base
import app.models  # noqa: F401  — registers every table on Base.metadata

REPO = Path(__file__).resolve().parents[2]
SCHEMA_SQL = REPO / "database" / "schema.sql"
SEED_SQL = REPO / "database" / "seed.sql"


def _schema_text() -> str:
    return SCHEMA_SQL.read_text(encoding="utf-8")


def _tables_in_schema() -> dict[str, set[str]]:
    """{table_name: {column_name, ...}} parsed from the generated DDL."""
    tables: dict[str, set[str]] = {}
    current = None
    for line in _schema_text().splitlines():
        m = re.match(r"CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`? \(", line)
        if m:
            current = m.group(1)
            tables[current] = set()
            continue
        if current:
            if line.strip().startswith(")"):
                current = None
                continue
            cm = re.match(r"\s+`?(\w+)`? ", line)
            if cm and cm.group(1).upper() not in {"PRIMARY", "UNIQUE", "CONSTRAINT",
                                                  "FOREIGN", "KEY", "INDEX"}:
                tables[current].add(cm.group(1))
    return tables


# ── generated SQL files ↔ ORM metadata ──────────────────────────────────────

def test_schema_sql_exists_and_targets_mysql():
    assert SCHEMA_SQL.exists(), "database/schema.sql must be generated & committed"
    text_ = _schema_text()
    assert "SET NAMES utf8mb4;" in text_
    assert "SET FOREIGN_KEY_CHECKS = 0;" in text_
    assert re.search(r"\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 "
                     r"COLLATE=utf8mb4_unicode_ci;", text_), \
        "every table must end with the InnoDB/utf8mb4_unicode_ci table options"
    assert text_.count("CREATE TABLE") == len(Base.metadata.tables), (
        "schema.sql table count drifted from the ORM metadata — "
        "run backend/scripts/generate_schema_sql.py"
    )


def test_schema_sql_has_every_table_and_column_from_the_models():
    parsed = _tables_in_schema()
    for name, table in Base.metadata.tables.items():
        assert name in parsed, f"table `{name}` missing from database/schema.sql"
        for column in table.columns:
            assert column.name in parsed[name], (
                f"column `{name}.{column.name}` missing from database/schema.sql"
            )


def test_money_and_coordinate_columns_use_exact_mysql_types():
    text_ = _schema_text()
    # Exact-base-10 money. SQLAlchemy emits NUMERIC; MySQL treats
    # NUMERIC/DECIMAL as synonyms and reports both as decimal(12,2).
    assert re.search(r"[\t ]*total_amount (NUMERIC|DECIMAL)\(12, ?2\)", text_, re.I), \
        "payments.total_amount must be NUMERIC/DECIMAL(12,2), not a float"
    assert re.search(r"[\t ]*budget (NUMERIC|DECIMAL)\(12, ?2\)", text_, re.I), \
        "trips.budget must be NUMERIC/DECIMAL(12,2)"
    # DOUBLE for coordinates (single-precision FLOAT loses ~0.3 m of accuracy)
    assert re.search(r"[\t ]*lat DOUBLE", text_, re.I), "locations.lat must be DOUBLE"


def test_seed_sql_contains_no_fabricated_financial_or_trip_rows():
    """The optional seed may hold reference data only — never trips, payments,
    reviews, itineraries, selections or analytics (master spec: no fabricated
    data anywhere)."""
    seed = SEED_SQL.read_text(encoding="utf-8")
    inserts = re.findall(r"INSERT(?:\s+IGNORE)?\s+INTO\s+(\w+)", seed, re.I)
    allowed = {"locations", "identities", "managers", "admins", "guides"}
    forbidden = set(inserts) - allowed
    assert not forbidden, (
        f"seed.sql must never write these tables: {sorted(forbidden)} — "
        "fabricated rows would poison dashboards and tests"
    )
    assert len(inserts) >= 19, "seed.sql looks truncated (expect 15 locations + staff)"


def test_seed_sql_passwords_are_hashed_never_plaintext():
    seed = SEED_SQL.read_text(encoding="utf-8")
    for line in seed.splitlines():
        if line.startswith("INSERT") and "identities" in line:
            assert "$2b$" in line or "$2a$" in line, (
                "identity rows must carry bcrypt hashes, never plaintext"
            )
            assert "adminpassword" not in line and "managerpassword" not in line


# ── live-MySQL integration (opt-in via TRAVION_TEST_MYSQL_URL) ──────────────

MYSQL_URL = os.getenv("TRAVION_TEST_MYSQL_URL")

pytestmark_live = pytest.mark.skipif(
    not MYSQL_URL,
    reason="TRAVION_TEST_MYSQL_URL not set — MySQL integration checks skipped",
)


@pytestmark_live
class TestLiveMySQL:
    """Server-level guarantees that SQLite cannot demonstrate."""

    @pytest.fixture(scope="class")
    def mysql_engine(self):
        eng = create_engine(MYSQL_URL, pool_pre_ping=True)
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        yield eng
        eng.dispose()

    def test_engine_is_mysql8_and_uses_utf8mb4_ci(self, mysql_engine):
        with mysql_engine.connect() as conn:
            version = conn.execute(text("SELECT VERSION()")).scalar()
            assert version.startswith("8."), f"expected MySQL 8.x, got {version}"
            for row in conn.execute(text(
                "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE='BASE TABLE'"
            )):
                assert row[1] == "InnoDB", f"{row[0]} is not InnoDB"
                assert row[2] == "utf8mb4_unicode_ci", f"{row[0]} collation is {row[2]}"

    def test_all_orm_tables_exist(self, mysql_engine):
        from sqlalchemy import inspect
        have = set(inspect(mysql_engine).get_table_names())
        missing = set(Base.metadata.tables) - have
        assert not missing, f"tables missing on MySQL: {sorted(missing)}"

    def test_foreign_keys_are_enforced(self, mysql_engine):
        """A child row pointing at a missing parent must be rejected by the
        server (RESTRICT), not silently accepted as SQLite would accept it."""
        with mysql_engine.begin() as conn:
            with pytest.raises(Exception) as excinfo:
                conn.execute(text(
                    "INSERT INTO payments (id, trip_id, razorpay_order_id, "
                    "status, total_amount, currency, non_refundable_acknowledged) "
                    "VALUES ('fk-test-row', 'no-such-trip', 'order_x', 'PENDING', "
                    "100.00, 'INR', 0)"
                ))
        assert "foreign key" in str(excinfo.value).lower()

    def test_email_uniqueness_is_case_insensitive_via_ci_collation(self, mysql_engine):
        """'A@x.com' then 'a@x.com' → the second INSERT must be rejected by the
        UNIQUE(email) constraint under utf8mb4_unicode_ci."""
        email_a = f"MySQLCI.{os.getpid()}@CaseTest.com"
        email_b = email_a.lower()
        with mysql_engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO identities (id, email, hashed_password, role) "
                "VALUES (:id, :email, 'x', 'USER')"
            ), {"id": "ci-test-a", "email": email_a})
            with pytest.raises(Exception) as excinfo:
                conn.execute(text(
                    "INSERT INTO identities (id, email, hashed_password, role) "
                    "VALUES ('ci-test-b', :email, 'x', 'USER')"
                ), {"email": email_b})
            conn.execute(text("DELETE FROM identities WHERE id = 'ci-test-a'"))
        assert "duplicate" in str(excinfo.value).lower()

    def test_money_columns_store_exact_decimals_not_binary_floats(self, mysql_engine):
        """0.1 + 0.2 must equal exactly 0.3 — DECIMAL(12,2) semantics, which a
        FLOAT/BINARY column could not guarantee. Builds the full FK chain
        (identity → user → locations → trip) inside one transaction."""
        with mysql_engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO identities (id, email, hashed_password, role) "
                "VALUES ('dec-id', 'dec.test@decimal.com', 'x', 'USER')"
            ))
            conn.execute(text(
                "INSERT INTO users (id, identity_id) VALUES ('dec-user', 'dec-id')"
            ))
            for lid in ("dec-src", "dec-dst"):
                conn.execute(text(
                    "INSERT INTO locations (id, name, state, lat, lng) "
                    f"VALUES ('{lid}', 'Dec', 'Test', 11.0, 76.0)"
                ))
            conn.execute(text(
                "INSERT INTO trips (id, user_id, source_location_id, "
                "destination_location_id, source_name, destination_name, "
                "start_datetime, end_datetime, budget, status) VALUES "
                "('dec-test', 'dec-user', 'dec-src', 'dec-dst', 'A', 'B', "
                "'2030-01-01 00:00:00', '2030-01-02 00:00:00', 0.10, 'DRAFT')"
            ))
            value = conn.execute(text(
                "SELECT budget, budget + 0.2 = 0.3 FROM trips WHERE id='dec-test'"
            )).first()
            conn.execute(text("DELETE FROM trips WHERE id='dec-test'"))
            conn.execute(text("DELETE FROM locations WHERE id IN ('dec-src','dec-dst')"))
            conn.execute(text("DELETE FROM users WHERE id='dec-user'"))
            conn.execute(text("DELETE FROM identities WHERE id='dec-id'"))
        assert value is not None
        assert float(value[0]) == 0.1
        assert value[1] in (1, True), "0.1 + 0.2 must equal exactly 0.3 in DECIMAL"

    def test_failed_transaction_leaves_no_partial_rows(self, mysql_engine):
        """Atomicity: a rollback after a successful INSERT must remove it."""
        with mysql_engine.begin() as conn:
            conn.execute(text("SAVEPOINT tx_test"))
            conn.execute(text(
                "INSERT INTO contact_messages (id, name, email, topic, priority, "
                "message, status) VALUES "
                "('tx-test', 'T', 'tx@test.com', 'General', 'Normal', 'x', 'NEW')"
            ))
            conn.execute(text("ROLLBACK TO SAVEPOINT tx_test"))
            conn.execute(text("RELEASE SAVEPOINT tx_test"))
            left = conn.execute(text(
                "SELECT COUNT(*) FROM contact_messages WHERE id='tx-test'"
            )).scalar()
        assert left == 0
