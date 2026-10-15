#!/usr/bin/env bash
# TRAVION production startup script (Render)
# Runs Alembic migrations then starts Uvicorn.
# Safe to run on every deploy — Alembic is idempotent.
set -e

echo "=== TRAVION Production Startup ==="
echo "DATABASE_URL prefix: ${DATABASE_URL:0:30}..."

echo "--- Running Alembic migrations ---"
alembic upgrade head

echo "--- Starting Uvicorn ---"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
