# Travion — AI Travel Companion for India

> **The problem we solve:** *How do I confidently travel through a place I don't know?*
> Travion is an AI-powered travel companion that stays with the traveller from planning to return — helping them reach, navigate, communicate, discover, adapt and stay safe, while connecting them with verified local guides and promoting lesser-known destinations.

Travion is **not** an itinerary generator, a chatbot, or a destination website. It is a travel operating system that understands the traveller's actual journey: a mandatory preference interview shapes every plan, real location data powers search and maps, a context-aware AI remembers the whole trip, verified journeys are planned only where real data exists, and Guide Mode connects the traveller to a vetted local human guide through an operations pipeline.

---

## Table of contents

1. [Core principles](#core-principles)
2. [Domains](#domains)
3. [Location system](#location-system)
4. [AI assistant](#ai-assistant)
5. [Payments and fees](#payments-and-fees)
6. [Tech stack](#tech-stack)
7. [Repository layout](#repository-layout)
8. [Getting started](#getting-started)
9. [Configuration](#configuration)
10. [Access and test credentials](#access-and-test-credentials)
11. [Key API routes](#key-api-routes)
12. [Verification and tests](#verification-and-tests)
13. [Design rules](#design-rules)

---

## Core principles

- **World-scale search, honest planning.** Source and destination are live global location fields backed by a bundled index of every Indian state, district, city and town (4,600+ records with real coordinates) plus live Google Places autocomplete for the rest of the world. Travion plans a *verified journey* only where it holds real, curated travel data (stays, dining, attractions, transport); for anywhere else it says so clearly and offers reachable covered alternatives instead of inventing content.
- **The selected place is the destination.** No silent substitution of transport hubs for the destination. Transit points appear only as intermediate segments of a real route.
- **Real GPS or nothing.** "Use my current location" reads the device GPS and reverse-geocodes it. On failure the app says so — there is no fake fallback city anywhere in production code.
- **Preferences change the plan.** A mandatory, multi-select discovery interview stores structured preferences that genuinely drive stay class, budget, pace and activities. A Rs. 15,000 backpacker and a Rs. 1,00,000 luxury traveller on the same route receive materially different plans.
- **Only service fees are collected.** Travion never charges the travel budget. It collects the Guide Fee plus Platform Fee (Guide Mode) or Platform Fee only (Adventurous Mode) through a backend-computed Razorpay order.
- **Real data only.** No dummy reviews, revenue, GPS, hotels or statistics. Empty states say "No completed trips yet" — never fake numbers.
- **Trip-scoped memory.** Each trip has its own isolated conversation and state; memory never leaks between trips and persists across sessions until the trip completes.
- **No emojis.** Professional Lucide/vector icons everywhere.

## Domains

Four role-based single-page applications share one backend.

| Domain | Surface | Purpose |
|---|---|---|
| **User** | `/` → sign in → user hub | Live search, discovery interview, mode selection, split map + itinerary workspace, voice navigation, trip-scoped AI chat, dynamic replanning, transparent checkout, offline package, reviews |
| **Guide** | guide sign-in | Mobile-first operations: onboarding + destination knowledge assessment, availability state (Active / Busy / Duty Off), assigned trips, traveller details, chat, revenue overview |
| **Manager** | Authorized access code | Operations portal: KPI dashboard, guide vetting, ranked guide matching, drag-and-drop assignment workspace, BUSY locking, operational payments and settlements |
| **Admin** | Authorized access code | Full financial control: dual revenue separation (platform vs guide), transaction inspection, user/guide tables, review moderation, audit trail, pricing configuration |

## Location system

- **Bundled world/India index** — `frontend/src/data/placeIndex.ts` (generated, ~4,600 records): 248 countries, all 36 Indian states/UTs, ~360 district-only names, every Indian city and town with population >= 15,000 (3,700+), and ~250 curated tourist destinations (Munnar, Kodaikanal, Leh, Hampi, Rann of Kutch, etc.). Search is instant and works fully offline, character by character.
  - Regenerate it from raw sources: `cd frontend/scripts/geodata && python gen.py` (see the script header — GeoNames `IN.zip` is CC-BY 4.0, countries file is ODbL; curated additions are committed in `curated_part*.json`).
- **Live Google Places** — when `VITE_GOOGLE_MAPS_API_KEY` is configured, typing also queries Google Places for worldwide cities, landmarks, airports, stations and POIs. Results are shown under a separate "Worldwide" section and the selected place's canonical `place_id` + coordinates are persisted server-side.
- **`POST /locations/register`** stores any selected place with real geography and deduplicates: same Google `place_id`, same name+country as a hub, or same name+country+coordinates all reuse one row.
- **Current location** — browser geolocation -> reverse geocoding. Permission denied or GPS failure shows "Unable to determine your current location" with manual search; coordinates are never fabricated and no city is ever assumed.

## AI assistant

The trip chat (`POST /trips/{id}/chat`) is a context engine, not a chatbot. For every message it assembles: the trip's itinerary position, structured preferences, budget and payment records, guide context (Guide Mode), persisted conversation history for that trip only, optional live GPS from the client, and real weather when the OpenWeather key is available.

- Answers "What's next?", "Is it cold?", "How much am I paying?", "What did I tell you about food?" from actual trip state.
- Resolves "it / there / this / that" against entities mentioned in the conversation.
- Performs real actions — remove a stop, move dinner to 8 PM, add a rest day — by modifying the persisted itinerary through backend tools, then explains the change.
- Refuses non-travel questions politely ("What is 2 + 2?").
- Translates practical travel phrases (fare, directions, help) for the traveller's destination region.
- Gemini (optional) is used strictly as a grounded reasoning layer; when unavailable the deterministic verified engine answers from trip data alone. Nothing is ever invented: if live weather or availability is unknown, the assistant says so.

## Payments and fees

- Fees are computed by the **backend pricing engine** — never the frontend.
- **Estimated travel spend** (transport/stay/food/activities) is shown for transparency but paid locally during the trip.
- **Travion collects only:** Guide Fee + Platform Fee (Guide Mode) or Platform Fee (Adventurous Mode, guide fee = 0).
- Razorpay order amount is backend-generated and server-verified; revenue dashboards read actual `payments`/`guide_settlements` records, with historical fee values frozen at payment time.
- Guide assignment: Manager sees trip requests and eligible verified guides, assigns (drag-and-drop or click), the guide flips to BUSY, duplicate/overlapping assignments are blocked at the database level, and the user + guide receive notifications.

## Tech stack

- **Backend:** Python 3.10+, FastAPI, SQLAlchemy, SQLite (`backend/travion.db`) with role-based access control, bcrypt password hashing, and JWT sessions.
- **Frontend:** React 18 + TypeScript + Vite, Tailwind CSS v4, Framer Motion, Leaflet, Lucide icons.
- **External services (all optional keys, all env-configurable):** Google Maps Platform (Places autocomplete/geocoding), OpenWeatherMap, Google Gemini (AI reasoning), Razorpay (test-mode checkout).

## Repository layout

```
backend/
  app/
    main.py              # FastAPI app, startup migration + emoji sanitizer
    core/                # config, db, security (RBAC, JWT)
    models/entities.py   # SQLAlchemy models (users, trips, locations, ...)
    schemas/schemas.py   # Pydantic request/response models
    services/            # verified_data, ai_orchestrator, itinerary_tools, ...
    api/v1/              # auth, locations, trips, discovery, planning,
                         # guides, managers, admin, chat, replanning,
                         # payments, reviews, offline
  tests/test_backend.py
frontend/
  src/
    data/placeIndex.ts        # generated world/India location index
    services/api.ts           # typed API client
    views/                    # LandingPage, UserDomain, GuideDomain,
                              # ManagerDomain, AdminDomain
    components/               # search bar, discovery, live map, chat,
                              # mode selection, replanning, review, offline
  scripts/geodata/            # index generator + curated source data
```

## Getting started

Prerequisites: Python 3.10+ and Node.js 18+.

```bash
# 1. Backend
cd backend
python -m venv .venv                 # optional but recommended
.venv/Scripts/activate               # Windows  (source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
cp .env.example .env                 # then fill in real values (see Configuration)
python -m uvicorn app.main:app --reload --port 8002
# API docs:  http://localhost:8002/api/v1/docs

# 2. Frontend (second terminal)
cd frontend
npm install
cp .env.example .env                 # set VITE_API_BASE_URL=http://localhost:8002/api/v1
npm run dev                          # http://localhost:5173
```

On first backend start the verified hub data is seeded and the schema/migrations run automatically against `backend/travion.db`.

## Configuration

Backend `.env` (never committed):

| Variable | Purpose |
|---|---|
| `JWT_SIGNING_SECRET` | Signs auth tokens |
| `MANAGER_ELEVATION_SECRET` | Code for Manager access (default-style: `SIH-MANAGER`) |
| `ADMIN_ELEVATION_SECRET` | Code for Admin access (default-style: `SIH-ADMIN`) |
| `GEMINI_API_KEY` | Optional Gemini reasoning for chat |
| `OPENWEATHER_API_KEY` | Optional live weather for the AI assistant |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Test (`rzp_test_`) or live Razorpay keys |

Frontend `.env` (never committed):

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Backend base URL, e.g. `http://localhost:8002/api/v1` |
| `VITE_GOOGLE_MAPS_API_KEY` | Enables live worldwide autocomplete + reverse geocoding |
| `VITE_RAZORPAY_KEY_ID` | Public Razorpay key id for checkout |

Without Google/Razorpay keys the app degrades gracefully: the bundled India index still powers search, checkout falls back to the server-verified simulation flow, and weather answers honestly report no live reading.

## Access and test credentials

- **User (traveller):** sign up with any email/password (password rules enforced server-side).
- **Guide:** register via Guide sign-up. Seeded verified guide for demos:
  - Email `arun.nilgiri@travion.in`, password `guide1234`
- **Manager / Admin:** reachable from the Authorized control on the landing page footer, or via `/auth/elevate`:
  - Manager: code `SIH-MANAGER`, email `manager@travion.in`, password `managerpassword`
  - Admin: code `SIH-ADMIN`, email `admin@travion.in`, password `adminpassword`

## Key API routes

All under `/api/v1`. OpenAPI docs: `http://localhost:8002/api/v1/docs`.

| Route | Purpose |
|---|---|
| `POST /auth/signup`, `/auth/login`, `/auth/elevate` | Auth + role elevation |
| `POST /locations/register` | Persist any searched place (place_id aware, deduping) |
| `GET /locations/all` | All known/registered locations |
| `POST /trips/search` | Validate + create a trip (source, destination, dates) |
| `GET /trips/{id}/discovery/next` | Next adaptive interview question |
| `POST /trips/{id}/plan` | Build itinerary from verified data; structured `DESTINATION_NOT_COVERED` / `ROUTE_NOT_COVERED` errors with `available_destinations` |
| `POST /trips/{id}/checkout` | Backend-computed fee split + Razorpay order |
| `POST /payments/verify-webhook` | Signature-verified payment confirmation |
| `POST /trips/{id}/chat` | Context-aware trip assistant |
| `POST /trips/{id}/replan` | Dynamic replanning with explanation |
| `GET/POST /manager/...`, `/admin/...` | Manager/admin operations (assignments, revenue, audits) |

## Verification and tests

```bash
cd backend && python -m pytest tests/ -q          # 6/6 backend tests
cd frontend && npx tsc --noEmit && npm run build  # typecheck + production build
cd frontend && npm run lint                       # eslint (0 errors)
```

The live end-to-end suites used during development exercise: signup/login, worldwide + India place registration and dedupe, trip creation without destination substitution, discovery interviews, preference-driven plans, honest refusal with recovery destinations, payment simulation, guide assignment with BUSY lock, AI context/memory/actions/refusals, and no-Bangalore guarantees.

## Design rules

- Zero emojis across every surface — landing, user app, guide, manager, admin, maps, chat, tables, empty states. Professional vector icons only.
- Premium light editorial travel aesthetic with the Travion sky-blue system (`--color-travion-*`), deep slate text, soft shadows, rounded surfaces.
- Every claim in the UI is either real data, clearly labelled as a preview/sample, or an honest empty state.
- Respect `prefers-reduced-motion`; animation communicates the journey rather than decorating it.

---

Travion stays with the traveller from "Where should I go?" through "How do I get to my hotel?", "What's next?", "Is it cold?", weather changes, missed connections and the safe return — *make unfamiliar India feel familiar.*
