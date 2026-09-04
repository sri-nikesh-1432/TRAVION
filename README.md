# Travion — AI Travel Orchestration Platform

> **Tagline:** *Travel without the uncertainty.*  
> Software-only end-to-end travel orchestration platform (no IoT, no hardware) featuring four role-based domains: **User**, **Guide**, **Manager**, and **Admin**.

---

## 🌟 Overview & Key Architecture

Travion replaces fragmented travel apps (Google Maps, booking sites, food aggregators, translators, emergency directories) with a single, unified, adaptive platform:

- **Four Dedicated Domains**:
  1. **User (AI Travel Hub)**: Hero Search, Adaptive Discovery Questionnaire, Mode Selection (Guide Mode vs Adventurous Mode), Live Trip Map with desktop split view, Turn-by-Turn Voice Navigation (Web Speech API), Magnification Dock, Trip-Scoped AI Chat, Dynamic Replanning with "Why did my plan change?" explanations, Razorpay Checkout with transparent fee split, and Offline Package caching.
  2. **Guide (Operations Hub)**: Mobile-first operational layout, Guide Application & Vetting, Availability Toggle (🟢 Active, 🟡 Busy, ⚪ Duty Off), Active Trip Queue, Traveller Details, Guide-User Chat, Review Visibility Toggle.
  3. **Manager (Operations Portal)**: Live KPI Stats (Today's Trips, Pending Requests, Active Guides, Busy Guides), Guide Onboarding Vetting, Ranked Guide Matching with compatibility breakdown score bars, Guide Assignment, and Payment Settlement tracking.
  4. **Admin (Control Center)**: Executive Overview, **Dual Revenue Separation** (Total Platform Transactions vs Platform Revenue fee-only vs Guide Payouts), User/Guide tables, Review Moderation (including guide-hidden reviews), and Elevation/Audit Trail.

- **Non-Negotiable Constraints**:
  - ❌ No IoT, no hardware.
  - ❌ No demo accounts in live system (Sandboxed demo preview is strictly isolated on the landing page).
  - ❌ No hallucinatory travel data (transport schedules, room rates, coordinates, and emergency hotlines are grounded in our verified database).
  - ✅ One email = one identity enforced at database level across roles.
  - ✅ Strict server-side validation on all dates, routes, role elevation codes, and payment totals.

---

## 🚀 Getting Started

### Prerequisites
- Python 3.10+ (tested on Python 3.13)
- Node.js 18+ and npm

### 1. Run the Backend (FastAPI)
```bash
cd backend
python -m uvicorn app.main:app --reload --port 8002
```
- API Documentation: [http://localhost:8002/api/v1/docs](http://localhost:8002/api/v1/docs)
- Interactive OpenAPI Schema: [http://localhost:8002/api/v1/openapi.json](http://localhost:8002/api/v1/openapi.json)

> Backend runs on **port 8002** to match `frontend/.env` (`VITE_API_BASE_URL=http://localhost:8002/api/v1`). Keys for Gemini, OpenWeather, Google Maps and Razorpay (test mode) live in `backend/.env` and `frontend/.env` — never commit them.

### 2. Run the Frontend (React + Vite + Tailwind + Framer Motion)
```bash
cd frontend
npm run dev
```
- Web Application: [http://localhost:5173](http://localhost:5173)

---

## 🔑 Authorized Access & Test Credentials

### Public Roles (Sign Up / Sign In):
- **User (Traveller)**: Enter any email/password or create a new account.
- **Guide**: Register via Guide sign-up. Example pre-seeded active guide:
  - Email: `arun.nilgiri@travion.in`
  - Password: `guide1234`

### Authorized Operations Access (Manager & Admin):
Reachable exclusively through the **⚙ Authorized** control in the footer of the Landing Page:
- **Manager Access**:
  - Access Code: `SIH-MANAGER`
  - Email: `manager@travion.in` (or any official staff email)
  - Password: `managerpassword`
- **Admin Access**:
  - Access Code: `SIH-ADMIN`
  - Email: `admin@travion.in` (or any official staff email)
  - Password: `adminpassword`

---

## 🧪 Running Automated Tests

Run the backend verification test suite (covers health check, RBAC, elevation, email uniqueness, strict trip search validation, AI planning, Razorpay payment simulation, dynamic replanning, and dual revenue metrics):

```bash
cd backend
python -m pytest tests/test_backend.py -v
```
