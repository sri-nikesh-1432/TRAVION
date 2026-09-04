# -*- coding: utf-8 -*-
"""Generate frontend/src/data/placeIndex.ts from raw world data.

Sources (drop into this folder before running):
  1. GeoNames India dump  ->  IN.zip  (CC-BY 4.0)
     https://download.geonames.org/export/dump/IN.zip
     (~15 MB; slow server — use curl -L -C - to resume)
  2. World countries      ->  countries.json (ODbL, fast GitHub CDN)
     https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/json/countries.json
  3. curated_part*.json   ->  famous Indian tourist places (committed here)

The GeoNames dump is ~660k rows; this script keeps populated places with
population >= 15,000 plus all 36 states and district-only names, so the
bundled index stays complete yet small (~4,600 records).

Run:  python gen.py
"""
import zipfile, json, re, os, hashlib, glob, unicodedata, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "src", "data", "placeIndex.ts"))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
COUNTRIES_URL = "https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/json/countries.json"
IN_ZIP = os.path.join(HERE, "IN.zip")
COUNTRIES = os.path.join(HERE, "countries.json")
if not os.path.exists(COUNTRIES):
    print("Downloading countries.json ...")
    urllib.request.urlretrieve(COUNTRIES_URL, COUNTRIES)
if not os.path.exists(IN_ZIP):
    print("IN.zip missing. Download it once (see docstring), e.g.:")
    print("  curl -L -C - -o IN.zip https://download.geonames.org/export/dump/IN.zip")
    raise SystemExit(1)

def norm(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().strip()

def clean_state(s):
    s = re.sub(r"^(State|Union Territory|National Capital Territory|The Union Territory|State of)\s+of?\s*", "", s, flags=re.I)
    s = re.sub(r"\s*\(.*?\)\s*$", "", s)
    s = s.replace(" NCT", "")
    return s.strip() or s

entries = {}   # (kind, key) -> dict
def add(kind, name, state, country, lat, lng, extra=None):
    name = (name or "").strip()
    if not name or not lat or not lng:
        return
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return
    key = norm(name).lower() + "|" + norm(state).lower()
    bucket = entries.setdefault(kind, {})
    if key in bucket:
        return
    bucket[key] = dict(name=name, state=state, country=country, lat=lat, lng=lng, extra=extra or {})

def has_town(key):
    return key in entries.get("city", {}) or key in entries.get("town", {})

def place_key(name, state):
    return norm(name).lower() + "|" + norm(state).lower()

z = zipfile.ZipFile(IN_ZIP)
raw = z.read("IN.txt").decode("utf-8", errors="replace")

state_codes = {}
adm2_rows = []
for ln in raw.splitlines():
    f = ln.split("\t")
    if len(f) < 15:
        continue
    if f[7] == "ADM1":
        clean = clean_state(f[2])
        state_codes[f[10]] = clean
        add("state", clean, "", "India", f[4], f[5])
    elif f[7] == "ADM2":
        adm2_rows.append(f)

# Towns/cities: real populated places, population >= 15000.
MIN_POP = 15000
towns = []
for ln in raw.splitlines():
    f = ln.split("\t")
    if len(f) < 15 or f[6] != "P":
        continue
    if f[14].isdigit() and int(f[14]) >= MIN_POP:
        towns.append(f)
# Cap total town rows for a sane bundle (raise threshold if needed).
if len(towns) > 7000:
    towns.sort(key=lambda f: -int(f[14]))
    towns = towns[:7000]
for f in towns:
    st = state_codes.get(f[10], "")
    kind = "city" if int(f[14]) >= 100000 else "town"
    # Prefer the ASCII transliteration for clean display names (e.g. "Kodaikanal"
    # over "Kodaikānal"), falling back to the primary name when it is already ASCII.
    name = f[1] if f[1].isascii() else (f[2] or f[1])
    add(kind, name, st, "India", f[4], f[5], {"pop": int(f[14])})

# Districts from GeoNames ADM2 rows (only if the dump carries them with coords).
# A district whose name matches an existing city/town row in the same state is
# skipped — the town itself covers that search.  Only true district-only names
# (seats too small to appear as towns) are kept.
if 600 <= len(adm2_rows) <= 900:
    for f in adm2_rows:
        st = state_codes.get(f[10], "")
        if has_town(place_key(f[2], st)):
            continue
        add("district", clean_state(f[2]), st, "India", f[4], f[5])

# World countries.
with open(COUNTRIES, encoding="utf-8") as fh:
    countries = json.load(fh)
for c in countries:
    try:
        lat, lng = float(c.get("latitude")), float(c.get("longitude"))
    except (TypeError, ValueError):
        continue
    add("country", c.get("name") or c.get("iso3"), "", c.get("name") or "", lat, lng)

# Curated famous tourist places.
for fp in sorted(glob.glob(os.path.join(HERE, "curated_part*.json"))):
    with open(fp, encoding="utf-8") as fh:
        for name, state, lat, lng in json.load(fh):
            # Do not shadow a real GeoNames town/city with the same name + state.
            if has_town(place_key(name, state)):
                continue
            add("place", name, state, "India", lat, lng)

flat = []
for kind in ("country", "state", "district", "city", "town", "place"):
    for rec in entries.get(kind, {}).values():
        flat.append((kind, rec))

# Deterministic stable id per record.
def rec_id(kind, name, state):
    h = hashlib.md5(f"{kind}|{name}|{state}".encode("utf-8")).hexdigest()[:10]
    return f"pl_{kind}_{h}"

lines = []
lines.append("// Travion bundled place index — generated from real world data. Do not edit by hand.")
lines.append("// Sources: GeoNames gazetteer, India (CC-BY 4.0); countries-states-cities-database (ODbL); curated Indian tourist places.")
lines.append("// Each record: [id, name, state, country, lat, lng, kind] where kind is country|state|district|city|town|place.")
lines.append("export type PlaceKind = 'country' | 'state' | 'district' | 'city' | 'town' | 'place';")
lines.append("export interface IndexedPlace { id: string; name: string; state: string; country: string; lat: number; lng: number; kind: PlaceKind; search: string; }")
# Tuple rows keep TypeScript inference cheap for thousands of records.
lines.append("type RawRow = [string, string, string, string, number, number, PlaceKind, string];")
lines.append("const ROWS: RawRow[] = [")
for kind, rec in flat:
    sid = rec_id(kind, rec["name"], rec["state"])
    search = norm((rec["name"] + " " + rec["state"]).lower())
    lines.append(
        f"  [{json.dumps(sid)}, {json.dumps(rec['name'])}, {json.dumps(rec['state'])}, {json.dumps(rec['country'])}, "
        f"{rec['lat']:.4f}, {rec['lng']:.4f}, '{kind}', {json.dumps(search)}],"
    )
lines.append("];")
lines.append("export const PLACE_INDEX: IndexedPlace[] = ROWS.map(r => ({ id: r[0], name: r[1], state: r[2], country: r[3], lat: r[4], lng: r[5], kind: r[6], search: r[7] }));")
lines.append("")
lines.append("const ORDER: Record<PlaceKind, number> = { city: 0, town: 1, place: 2, district: 3, state: 4, country: 5 };")
lines.append("")
lines.append("/** Ranked prefix + substring search over the bundled world/India index. */")
lines.append("export function searchPlaces(query: string, limit = 12): IndexedPlace[] {")
lines.append("  const q = query.trim().toLowerCase();")
lines.append("  if (!q) return [];")
lines.append("  const hits: Array<{ p: IndexedPlace; cls: number; nlen: number }> = [];")
lines.append("  for (const p of PLACE_INDEX) {")
lines.append("    const nm = p.name.toLowerCase();")
lines.append("    let cls = -1;")
lines.append("    if (nm === q) cls = 0;")
lines.append("    else if (nm.startsWith(q)) cls = 1;")
lines.append("    else if (p.search.startsWith(q)) cls = 2;")
lines.append("    else if (p.search.includes(q)) cls = 3;")
lines.append("    if (cls < 0) continue;")
lines.append("    hits.push({ p, cls, nlen: nm.length });")
lines.append("  }")
lines.append("  hits.sort((a, b) => a.cls - b.cls || a.nlen - b.nlen || ORDER[a.p.kind] - ORDER[b.p.kind] || (a.p.name < b.p.name ? -1 : 1));")
lines.append("  return hits.slice(0, limit).map(h => h.p);")
lines.append("}")
lines.append("")
lines.append("export function kindLabel(k: PlaceKind): string {")
lines.append("  return { city: 'City', town: 'Town', place: 'Destination', district: 'District', state: 'State', country: 'Country' }[k];")
lines.append("}")

with open(OUT, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines))

from collections import Counter
cnt = Counter(k for k, _ in flat)
print("wrote", OUT)
print("counts:", dict(cnt), "total:", len(flat))
print("size KB:", round(os.path.getsize(OUT) / 1024))
