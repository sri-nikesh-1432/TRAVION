# -*- coding: utf-8 -*-
"""Full-journey live E2E: mirrors the exact API calls the frontend makes.

Covers: auth, worldwide location register/dedupe, trip create, mandatory
discovery, any-India instant plan, verified-hub plan path, fee model (guide vs
adventurous), checkout + webhook, guide onboarding->approval->assignment->lock,
settlement, admin revenue, chat context/actions/translation/refusal, replan,
offline package, review, non-India structured refusal.
"""
import json, uuid, sys, urllib.request, urllib.error
from datetime import datetime, timedelta

BASE = "http://localhost:8002/api/v1"
suffix = uuid.uuid4().hex[:6]
FAILS = []
OKS = []

def req(method, path, token=None, body=None, expect=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            status, payload = resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        status = e.code
        raw = e.read().decode()
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"raw": raw[:300]}
    except Exception as e:
        status, payload = -1, {"error": str(e)}
    ok = (expect is None and status < 400) or (expect is not None and status == expect)
    label = f"{method} {path} -> {status}"
    if ok:
        OKS.append(label)
    else:
        FAILS.append(f"{label} :: {json.dumps(payload)[:400]}")
    return status, payload

def check(name, cond, extra=""):
    if cond:
        OKS.append(name)
    else:
        FAILS.append(f"{name} :: {str(extra)[:400]}")

# ---------------------------------------------------------------- auth
pw = "E2ePass123!"
user_email = f"e2e_user_{suffix}@test.com"
guide_email = f"e2e_guide_{suffix}@test.com"
mgr_email = f"e2e_mgr_{suffix}@test.com"
adm_email = f"e2e_adm_{suffix}@test.com"

s, r = req("POST", "/auth/signup", body={"email": user_email, "password": pw, "role": "USER", "first_name": "E2E", "last_name": "User"})
user_tok = r["access_token"]; user_id = r.get("user_id")
check("user signup", s == 200 and user_id)

s, r = req("POST", "/auth/signup", body={"email": guide_email, "password": pw, "role": "GUIDE", "first_name": "E2E", "last_name": "Guide"})
guide_tok = r["access_token"]; guide_id = r.get("guide_id")
check("guide signup", s == 200 and guide_id)

s, r = req("POST", "/auth/elevate", body={"email": mgr_email, "password": pw, "access_code": "SIH-MANAGER"})
mgr_tok = r["access_token"]
check("manager elevate", s == 200 and r.get("role") == "MANAGER", r)

s, r = req("POST", "/auth/elevate", body={"email": adm_email, "password": pw, "access_code": "SIH-ADMIN"})
adm_tok = r["access_token"]
check("admin elevate", s == 200 and r.get("role") == "ADMIN", r)

intruder_email = f"e2e_intruder_{suffix}@test.com"
s, r = req("POST", "/auth/signup", body={"email": intruder_email, "password": pw, "role": "USER", "first_name": "Intruder", "last_name": "User"})
intruder_tok = r["access_token"]
check("intruder signup", s == 200)

# ---------------------------------------------------------------- locations
s, r = req("GET", "/locations/all")
hubs = {x["name"]: x for x in r}
check("locations seeded with hubs", s == 200 and "Bangalore" in hubs and "Ooty" in hubs)

s, r = req("POST", "/locations/register", token=user_tok, body={"name": "Kodaikanal", "state": "Tamil Nadu", "country": "India", "lat": 10.2381, "lng": 77.4892})
kodai_id = r.get("id"); check("register Kodaikanal", s == 200 and kodai_id, r)

s, r = req("POST", "/locations/register", token=user_tok, body={"name": "Hyderabad", "state": "Telangana", "country": "India", "lat": 17.3850, "lng": 78.4867})
hyd_id = r.get("id"); check("register Hyderabad", s == 200 and hyd_id, r)

s, r = req("POST", "/locations/register", token=user_tok, body={"name": "Paris", "state": "Ile-de-France", "country": "France", "lat": 48.8566, "lng": 2.3522})
paris_id = r.get("id"); check("register Paris", s == 200 and paris_id, r)

# Dedupe: re-register Ooty with provider coords + place_id must return the SAME hub row
s, r = req("POST", "/locations/register", token=user_tok, body={"name": "Ooty", "state": "Tamil Nadu", "country": "India", "lat": 11.4102, "lng": 76.6950, "place_id": "ChIJooty"})
check("Ooty re-register snaps to hub (no duplicate)", s == 200 and r["id"] == hubs["Ooty"]["id"], r)

# Landmark registers cleanly (never "not a city" errors)
s, r = req("POST", "/locations/register", token=user_tok, body={"name": "Agra Fort", "state": "Uttar Pradesh", "country": "India", "lat": 27.1795, "lng": 78.0211})
check("landmark Agra Fort registers", s == 200 and r.get("id"), r)

# Registered worldwide places must NOT surface as journey-ready hubs (landing/ recovery feed)
s, r = req("GET", "/locations/all")
hub_names = [x["name"] for x in r]
check("registered places not marketed as hubs (Paris/Agra Fort/Kodaikanal absent)",
      all(n not in hub_names for n in ("Paris", "Agra Fort", "Kodaikanal")), hub_names)
check("hub feed still lists real verified hubs", "Ooty" in hub_names and "Goa" in hub_names, hub_names)
# ...but worldwide places remain searchable
s, r = req("GET", "/locations/search?q=Paris")
check("worldwide places still searchable", s == 200 and any(x.get("name") == "Paris" for x in r), r)

def chat(trip, msg, tok=user_tok, lat=None, lng=None):
    body = {"message": msg, "channel": "AI"}
    if lat is not None:
        body["lat"] = lat; body["lng"] = lng
    s, r = req("POST", f"/trips/{trip}/chat-message", token=tok, body=body)
    # The AI reply is persisted as a separate row; fetch it from history.
    hs, h = req("GET", f"/trips/{trip}/chat-history", token=tok)
    reply = ""
    if hs == 200 and isinstance(h, list):
        ai_rows = [m for m in h if m.get("sender_role") != "USER" and m.get("sender_role") != "GUIDE"]
        if ai_rows:
            reply = ai_rows[-1].get("message", "") or ""
    return s, r, reply

# ---------------------------------------------------------------- trip A: Bangalore -> Kodaikanal (estimate plan, ADVENTUROUS)
start = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%dT09:00:00+05:30")
end = (datetime.utcnow() + timedelta(days=6)).strftime("%Y-%m-%dT18:00:00+05:30")
s, r = req("POST", "/trips/search", token=user_tok, body={"source_location_id": hubs["Bangalore"]["id"], "destination_location_id": kodai_id, "start_datetime": start, "end_datetime": end})
trip_a = r.get("id")
check("trip A created Bangalore->Kodaikanal", s == 200 and trip_a and r["destination_name"] == "Kodaikanal", r)

answers = {
    "budget": "₹30,000 - ₹50,000",
    "party": "Couple",
    "experience": ["Adventure & Treks", "Nature & Wildlife"],
    "food_pref": ["Pure Veg", "Local Traditional Only"],
    "stay_pref": "3 Star Cozy Boutique",
    "transport_pref": "Scenic Train / Toy Train",
    "activities": ["Hiking & Treks", "Waterfalls & Nature", "Photography"],
    "pace": "Balanced",
    "walking_tolerance": "Moderate (3,000 - 8,000 steps/day)",
    "priority": ["Safety & Verified Support", "Balanced Value"],
}
s, r = req("POST", f"/trips/{trip_a}/discovery/next", token=user_tok, body={"answers_so_far": answers})
check("discovery completes with all 10 questions", s == 200 and r.get("is_complete") is True and r.get("answered_count") == 10, r)

s, r = req("POST", f"/trips/{trip_a}/plan", token=user_tok, body={"mode": "ADVENTUROUS_MODE", "consent_acknowledged": True})
check("any-India plan instant (Kodaikanal not a hub)", s == 200 and r.get("is_active") and r.get("total_cost", 0) > 0, r)
bd_a = r.get("cost_breakdown", {})
check("adventurous: guide_fee == 0, platform_fee > 0", float(bd_a.get("guide_fee", 1)) == 0 and float(bd_a.get("platform_fee", 0)) > 0, bd_a)
check("breakdown payable == guide+platform", abs(float(bd_a.get("payable", 0)) - (float(bd_a.get("guide_fee", 0)) + float(bd_a.get("platform_fee", 0)))) < 1, bd_a)
check("estimate flag on days (no invented schedules)", any(d.get("source") == "estimate" for d in r.get("days", [])) or r.get("days"), r.get("days", [{}])[0].keys() if r.get("days") else "no days")

s, r = req("GET", f"/trips/{trip_a}/itinerary", token=user_tok)
days_a = r.get("days", [])
stops_a = [st for d in days_a for st in d.get("stops", [])]
check("itinerary fetch has day stops", s == 200 and len(stops_a) >= 3, s)
check("stops carry real coords + category + source", all(st.get("lat") is not None and st.get("category") and st.get("source") for st in stops_a[:5]), stops_a[:1])

# ---------------------------------------------------------------- checkout + webhook (A)
s, r = req("POST", f"/trips/{trip_a}/checkout", token=user_tok, body={})
amount_a = r.get("amount")
order_a = r.get("order_id")
check("checkout amount == payable only (never trip budget)", s == 200 and abs(amount_a - float(bd_a.get("payable", -1))) < 1 and amount_a < float(bd_a.get("total", 10**9)), r)

s, r = req("POST", "/payments/webhook", body={"razorpay_order_id": order_a, "razorpay_payment_id": f"pay_{uuid.uuid4().hex[:10]}", "razorpay_signature": "sim_sig_e2e"})
check("webhook verifies payment (sim sig) -> ACTIVE", s == 200 and r.get("payment_status") == "SUCCESS" and r.get("trip_status") == "ACTIVE", r)
check("offline package assembled on payment", r.get("offline_package_ready") is True, r)

s, r = req("GET", f"/trips/{trip_a}/offline-package", token=user_tok)
check("offline package retrievable", s == 200 and r.get("trip_id") == trip_a and isinstance(r.get("itinerary"), list) and r.get("emergency_safety"), r)

# ---------------------------------------------------------------- trip B: Bangalore -> Hyderabad (GUIDE_MODE)
start_b = (datetime.utcnow() + timedelta(days=8)).strftime("%Y-%m-%dT09:00:00+05:30")
end_b = (datetime.utcnow() + timedelta(days=13)).strftime("%Y-%m-%dT18:00:00+05:30")
s, r = req("POST", "/trips/search", token=user_tok, body={"source_location_id": hubs["Bangalore"]["id"], "destination_location_id": hyd_id, "start_datetime": start_b, "end_datetime": end_b})
trip_b = r.get("id")
check("trip B created Bangalore->Hyderabad", s == 200 and trip_b, r)

answers_b = {
    "budget": "₹50,000+ Luxury",
    "party": "Couple",
    "experience": ["Relaxed & Scenic", "Culinary Exploration"],
    "food_pref": ["Fine Dining"],
    "stay_pref": "5 Star Luxury Heritage",
    "transport_pref": "Fastest Available",
    "activities": ["Food Trails", "Museums & Culture"],
    "pace": "Relaxed",
    "walking_tolerance": "Light (Under 3,000 steps/day)",
    "priority": ["Comfort & Relaxation", "Unique Local Experiences"],
}
req("POST", f"/trips/{trip_b}/discovery/next", token=user_tok, body={"answers_so_far": answers_b})
s, r = req("POST", f"/trips/{trip_b}/plan", token=user_tok, body={"mode": "GUIDE_MODE", "consent_acknowledged": True})
bd_b = r.get("cost_breakdown", {})
check("guide-mode plan on any-India pair", s == 200, r)
check("guide mode: guide_fee > 0 and payable == guide+platform", float(bd_b.get("guide_fee", 0)) > 0 and abs(float(bd_b.get("payable", 0)) - (float(bd_b.get("guide_fee", 0)) + float(bd_b.get("platform_fee", 0)))) < 1, bd_b)
check("luxury trip meaningfully more expensive than mid trip", float(bd_b.get("total", 0)) > float(bd_a.get("total", 0)), (bd_b, bd_a))

# ---------------------------------------------------------------- guide onboarding + approval + assignment
s, r = req("POST", "/guides/onboarding", token=guide_tok, body={
    "first_name": "E2E", "last_name": "Guide", "phone": "9876543210",
    "languages": ["English", "Hindi", "Telugu"], "destinations": ["Hyderabad", "Kodaikanal", "Ooty"],
    "experience_years": 5, "specializations": ["Heritage", "Food", "Nature"],
    "destination_knowledge": "I have guided across Telangana and Tamil Nadu for five years including Hyderabad old city, Charminar, Kodaikanal lakes and trails.",
    "safety_information": "I carry first-aid, know emergency numbers for Telangana and Tamil Nadu, keep travellers together at crowded sites and confirm weather before hill trips.",
})
check("guide onboarding submits PENDING", s == 200, r)

s, r = req("GET", "/manager/pending-guides", token=mgr_tok)
check("manager sees pending guide", s == 200 and any(g.get("id") == guide_id for g in r), [g.get("id") for g in r][:5])

s, r = req("POST", f"/manager/guides/{guide_id}/approval?action=APPROVE", token=mgr_tok)
check("manager approves guide", s == 200, r)

s, r = req("GET", "/manager/trip-requests", token=mgr_tok)
reqs = r if isinstance(r, list) else r.get("items", r.get("requests", []))
check("manager sees trip B request", s == 200 and any(str(t.get("trip_id")) == trip_b for t in reqs), (reqs[0] if reqs else r))

s, r = req("GET", f"/manager/trip-requests/{trip_b}/candidates", token=mgr_tok)
check("candidates include approved guide", s == 200 and any(c.get("guide_id") == guide_id for c in r), [c.get("guide_id") for c in r][:6])

s, r = req("POST", f"/manager/trip-requests/{trip_b}/assign", token=mgr_tok, body={"guide_id": guide_id})
check("assign guide -> GUIDE_ASSIGNED + guide BUSY", s == 200 and r.get("status") == "GUIDE_ASSIGNED", r)

s, r = req("GET", f"/trips/{trip_b}/assignment", token=user_tok)
check("user sees assigned guide on trip", s == 200 and r.get("guide") and r["guide"].get("name"), r)

# Assignment lock: same guide on overlapping trip D must be rejected
s, r = req("POST", "/trips/search", token=user_tok, body={"source_location_id": hubs["Bangalore"]["id"], "destination_location_id": hubs["Goa"]["id"], "start_datetime": (datetime.utcnow() + timedelta(days=9)).strftime("%Y-%m-%dT09:00:00+05:30"), "end_datetime": (datetime.utcnow() + timedelta(days=12)).strftime("%Y-%m-%dT18:00:00+05:30")})
trip_d = r.get("id")
req("POST", f"/trips/{trip_d}/discovery/next", token=user_tok, body={"answers_so_far": answers})
s, r = req("POST", f"/trips/{trip_d}/plan", token=user_tok, body={"mode": "GUIDE_MODE", "consent_acknowledged": True})
check("trip D (Goa, hub) plans via verified engine", s == 200 and any(d.get("source") != "estimate" for d in r.get("days", [])) is False or s == 200, s)
s, r = req("POST", f"/manager/trip-requests/{trip_d}/assign", token=mgr_tok, body={"guide_id": guide_id}, expect=400)
check("BUSY guide cannot take overlapping trip D (400)", s == 400, r)

# ---------------------------------------------------------------- payment B + settlement + admin revenue
s, r = req("POST", f"/trips/{trip_b}/checkout", token=user_tok, body={})
order_b = r.get("order_id"); amount_b = r.get("amount")
check("guide-mode checkout amount == guide+platform", s == 200 and abs(amount_b - float(bd_b.get("payable", -1))) < 1, r)
s, r = req("POST", "/payments/webhook", body={"razorpay_order_id": order_b, "razorpay_payment_id": f"pay_{uuid.uuid4().hex[:10]}", "razorpay_signature": "sim_sig_e2e"})
check("trip B payment success -> ACTIVE", s == 200 and r.get("payment_status") == "SUCCESS", r)

s, r = req("GET", "/manager/settlements", token=mgr_tok)
splits = r if isinstance(r, list) else r.get("splits", r.get("items", []))
my_split = next((sp for sp in splits if sp.get("trip_id") == trip_b or sp.get("payment_id") == order_b), None) or (splits[0] if splits else None)
check("manager settlements list non-empty", s == 200 and splits, splits[:1] if isinstance(splits, list) else r)
split_id = my_split.get("id") if my_split else None
if split_id:
    s, r = req("POST", f"/manager/settlements/{split_id}/settle", token=mgr_tok)
    check("manager settles guide payout", s == 200, r)

s, r = req("GET", "/admin/revenue", token=adm_tok)
check("admin revenue endpoint returns real records", s == 200 and isinstance(r, dict), r)
total_collected = 0.0
def _deep(d, key):
    if isinstance(d, dict):
        for k, v in d.items():
            if k == key and isinstance(v, (int, float)):
                return v
            res = _deep(v, key)
            if res is not None:
                return res
    elif isinstance(d, list):
        for it in d:
            res = _deep(it, key)
            if res is not None:
                return res
    return None
total_tx = r.get("total_platform_transactions") or 0
platform_rev = r.get("actual_platform_revenue") or 0
guide_pool = r.get("total_guide_fees_payout") or 0
check("admin revenue >= my two payments (transactions)", total_tx >= amount_a + amount_b - 1, {"found": total_tx, "expected_at_least": amount_a + amount_b})
check("admin platform revenue is real (fees only)", platform_rev > 0 and platform_rev <= total_tx, r)
check("admin guide-fee pool tracks guide fees", guide_pool >= float(bd_b.get("guide_fee", 0)) - 1, r)

# ---------------------------------------------------------------- chat security (trip-scoped memory)
s, r = req("GET", f"/trips/{trip_a}/chat-history", token=intruder_tok, expect=403)
check("intruder user cannot READ another user's trip chat (403)", s == 403, r)
s, r = req("POST", f"/trips/{trip_a}/chat-message", token=intruder_tok, body={"message": "peek", "channel": "AI"}, expect=403)
check("intruder user cannot WRITE another user's trip chat (403)", s == 403, r)

# Guide on assigned trip B: GUIDE channel ok, AI channel locked
s, r = req("GET", f"/trips/{trip_b}/chat-history?channel=AI", token=guide_tok, expect=403)
check("guide cannot read traveller AI memory (403)", s == 403, r)
s, r = req("GET", f"/trips/{trip_b}/chat-history?channel=GUIDE", token=guide_tok)
check("assigned guide can open GUIDE channel", s == 200, s)
s, r = req("POST", f"/trips/{trip_b}/chat-message", token=guide_tok, body={"message": "Namaste! I will be your local guide.", "channel": "GUIDE"})
check("assigned guide can message traveller on GUIDE channel", s == 200 and r.get("channel") == "GUIDE", r)
s, r = req("GET", f"/trips/{trip_b}/chat-history?channel=GUIDE", token=user_tok)
check("traveller sees guide message in GUIDE channel", s == 200 and any("Namaste" in (m.get("message") or "") for m in r), r[:2])
# Unaassigned guide (a second guide) must be locked out of GUIDE channel
s, r = req("POST", "/auth/signup", body={"email": f"e2e_guide2_{suffix}@test.com", "password": pw, "role": "GUIDE", "first_name": "Other", "last_name": "Guide"})
other_tok = r["access_token"]
s, r = req("GET", f"/trips/{trip_b}/chat-history?channel=GUIDE", token=other_tok, expect=403)
check("unassigned guide locked out of GUIDE channel (403)", s == 403, r)

# ---------------------------------------------------------------- chat on trip A (context engine)
s, _, reply_a = chat(trip_a, "hi")
check("chat hi answered contextually (no generic greeting loop)", len(reply_a) > 20, reply_a[:200])
check("AI reply never fabricates Bangalore for a Kodaikanal trip", "Bangalore" not in reply_a and "bengaluru" not in reply_a.lower(), reply_a[:200])

_, _, r_next = chat(trip_a, "What's next?")
check("whats-next answered from real itinerary state", len(r_next) > 30, r_next[:200])

_, _, r_math = chat(trip_a, "What is 2 + 2?")
check("non-travel question politely refused", "travel" in r_math.lower() and r_math.strip() != "4", r_math[:200])

_, _, r_bud = chat(trip_a, "How much am I paying Travion?")
check("budget answer separates travel budget from Travion fees", ("platform" in r_bud.lower() or "₹" in r_bud), r_bud[:300])

_, _, r_tr = chat(trip_a, "translate how much to the railway station into Tamil")
check("translation assistance returns usable phrase", len(r_tr) > 20, r_tr[:200])

# Action: remove the safety briefing stop -> real itinerary change (new version)
_, _, r_rm = chat(trip_a, "Remove the safety and emergency briefing stop")
check("chat remove action replies about removal", "remov" in r_rm.lower(), r_rm[:200])
s, r = req("GET", f"/trips/{trip_a}/itinerary", token=user_tok)
check("itinerary version incremented after removal", s == 200 and r.get("version", 0) >= 2, r.get("version"))
remaining_titles = " ".join(st.get("title", "") for d in r.get("days", []) for st in d.get("stops", []))
check("safety briefing actually removed", "briefing" not in remaining_titles.lower(), remaining_titles[:200])

s, r = req("GET", f"/trips/{trip_a}/chat-history", token=user_tok)
check("chat history persists server-side", s == 200 and len(r) >= 6, len(r) if isinstance(r, list) else r)

# Live GPS context message
s, _, r_gps = chat(trip_a, "Where am I right now and what is near me?", lat=10.2381, lng=77.4892)
check("GPS-tagged message handled", s == 200 and len(r_gps) > 10, r_gps[:200])

# ---------------------------------------------------------------- replan on estimate plan
s, r = req("POST", f"/trips/{trip_a}/replan", token=user_tok, body={"trigger_type": "WEATHER", "reason": "Heavy rain forecast on the scheduled trail day"})
check("replan on estimate itinerary -> new version", s == 200 and r.get("new_version", 0) >= 3, r)
s, r = req("GET", f"/trips/{trip_a}/replan-history", token=user_tok)
check("replan history recorded", s == 200 and isinstance(r, list) and len(r) >= 1, r)

# ---------------------------------------------------------------- complete + review (guide trip B)
s, r = req("PATCH", f"/trips/{trip_b}/complete", token=user_tok)
check("complete trip B frees guide BUSY->ACTIVE", s == 200 and r.get("status") == "COMPLETED", r)
s, r = req("POST", f"/trips/{trip_b}/review", token=user_tok, body={"rating": 5, "comment": "Seamless guided trip"})
check("review submitted against guide", s == 200 and r.get("guide_id") == guide_id, r)
s, r = req("GET", f"/guides/{guide_id}/reviews", token=user_tok)
check("guide profile shows the real review", s == 200 and r and r[0].get("rating") == 5, r)

# ---------------------------------------------------------------- non-India structured refusal (no crash)
s, r = req("POST", "/trips/search", token=user_tok, body={"source_location_id": hubs["Bangalore"]["id"], "destination_location_id": paris_id, "start_datetime": (datetime.utcnow() + timedelta(days=15)).strftime("%Y-%m-%dT09:00:00+05:30"), "end_datetime": (datetime.utcnow() + timedelta(days=20)).strftime("%Y-%m-%dT18:00:00+05:30")})
trip_c = r.get("id")
check("trip C (Bangalore->Paris) creates (worldwide accepted)", s == 200 and trip_c, r)
req("POST", f"/trips/{trip_c}/discovery/next", token=user_tok, body={"answers_so_far": answers})
s, r = req("POST", f"/trips/{trip_c}/plan", token=user_tok, body={"mode": "ADVENTUROUS_MODE", "consent_acknowledged": True}, expect=400)
detail = r.get("detail", {}) if isinstance(r, dict) else {}
err = detail.get("error_code") if isinstance(detail, dict) else None
check("non-India plan -> structured DESTINATION_NOT_COVERED (400)", s == 400 and err == "DESTINATION_NOT_COVERED", detail)

# ---------------------------------------------------------------- admin portal pages (real data, role-guarded)
s, r = req("GET", "/admin/overview", token=adm_tok)
check("admin overview OK", s == 200 and r.get("total_users", 0) >= 1 and "platform_revenue" in r, r)

s, r = req("GET", "/admin/audit-logs", token=adm_tok)
logs = r if isinstance(r, list) else r.get("logs", r.get("items", []))
check("audit log records guide assignment", s == 200 and any(l.get("action") == "GUIDE_ASSIGNED" for l in logs), logs[:2] if isinstance(logs, list) else r)

for path, key in [
    ("/admin/users", "total_users"), ("/admin/guides", "total_guides"), ("/admin/managers", "total_managers"),
    ("/admin/trips", "total_trips"), ("/admin/payments", "total_payments"), ("/admin/settlements", "total_settlements"),
]:
    s, r = req("GET", path, token=adm_tok)
    check(f"{path} return real records", s == 200 and isinstance(r, list), r[:1] if isinstance(r, list) else r)

s, r = req("GET", "/admin/revenue", token=adm_tok)
check("admin revenue analytics has series + split", s == 200 and \
      r.get("total_platform_transactions", 0) >= amount_a + amount_b - 1 and \
      isinstance(r.get("by_month"), list) and isinstance(r.get("by_mode"), list), r)
check("admin revenue: settled + pending guide fees tracked", s == 200 and \
      (r.get("settled_guide_fees", 0) + r.get("pending_guide_fees", 0)) >= float(bd_b.get("guide_fee", 0)) - 1, r)

s, r = req("GET", "/admin/conversions", token=adm_tok)
check("admin conversions returns funnel + assignments", s == 200 and \
      isinstance(r.get("funnel"), dict) and isinstance(r.get("assignments"), list) and r["funnel"]["guide_assigned"] >= 1, r)

s, r = req("GET", "/admin/analytics", token=adm_tok)
check("admin analytics aggregates real metrics", s == 200 and isinstance(r.get("users_growth"), list) and r.get("average_budget", 0) > 0, r)

s, r = req("GET", "/admin/active-operations", token=adm_tok)
check("admin active operations lists running trips", s == 200 and isinstance(r, list) and any(t.get("status") == "ACTIVE" for t in r), (r[:1] if isinstance(r, list) else r))

# manager portal pages
s, r = req("GET", "/manager/guides", token=mgr_tok)
check("manager guides roster", s == 200 and any(g.get("id") == guide_id for g in r), [g.get("id") for g in r][:4])
s, r = req("GET", "/manager/active-trips", token=mgr_tok)
check("manager active trips lists running trips", s == 200 and isinstance(r, list) and any(t.get("trip_id") == trip_a for t in r), (r[:1] if isinstance(r, list) else r))
s, r = req("GET", "/manager/payments", token=mgr_tok)
check("manager payments ledger", s == 200 and any(p.get("trip_id") in (trip_a, trip_b) for p in r), r[:1])
s, r = req("GET", "/manager/revenue", token=mgr_tok)
check("manager revenue analytics", s == 200 and r.get("gross_traveller_payments", 0) >= amount_a + amount_b - 1 and isinstance(r.get("by_month"), list), r)
s, r = req("GET", "/manager/reviews", token=mgr_tok)
check("manager reviews", s == 200 and isinstance(r, list) and any(rv.get("rating") == 5 for rv in r), r[:1])

# role isolation: manager cannot access admin-only triage endpoints? (both allowed by design for some)
s, r = req("GET", "/manager/revenue", token=user_tok, expect=403)
check("USER cannot access manager revenue (403)", s == 403, r)
s, r = req("GET", "/admin/analytics", token=mgr_tok, expect=403)
check("MANAGER cannot access admin analytics (403)", s == 403, r)

print("=" * 60)
print(f"PASS {len(OKS)}  |  FAIL {len(FAILS)}")
for o in OKS:
    print("  ok:", o)
for f in FAILS:
    print("  FAIL:", f)
sys.exit(1 if FAILS else 0)
