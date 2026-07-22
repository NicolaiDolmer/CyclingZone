# Sub-1: Realistiske ruter — datamodel + generator — Implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Berig hver genereret etape med en realistisk-generativ rute (distance, kategoriserede stigninger, mellemsprints, brosten-sektorer) — additivt, deterministisk, med motoren bit-identisk — og ret S2's tier 3/4-skævhed (#2755) via nye arketyper + katalog-re-tagging, gated på et rute-realisme-scorecard FØR nogen migration/regen.

**Architecture:** Et **andet pass** (`attachRoute`) i den eksisterende deterministiske generator bruger en **dedikeret rng-strøm** (`…":route:"+stage_number`) → pass 1's `profile_type`/`finale_type`/`demand_vector` er bit-identiske for et givet seed. Rute-data persisteres som additive jsonb-kolonner + `distance_km` på `race_stage_profiles`. Nye arketyper (`summit_tour`, `itt_classic`, `cobbled_tour`) + en verificeret re-tag-liste rammer #2755-tier-båndene. Et scorecard regenererer S2 in-memory og gater mod referencebånd før apply. Motoren (simulatoren) røres ikke.

**Tech Stack:** Node.js ESM, `node --test` (backend), Supabase Postgres (additive `ALTER TABLE`, idempotent .sql), eksisterende `makeRng` (mulberry32) + `stableSeed` (FNV-1a).

**Beslutninger låst (ejer 21/7):**
- **27/7-udrulning: (a)** — land Sub-1 + grønt scorecard + review før ~26/7 → regenerér S2 → lanceres 27/7 med ægte ruter + fikset mix. **(c)** (glid til S3) er automatisk fallback hvis scorecardet ikke er grønt ~26/7.
- **`prolog`/`itt_classic` er IKKE nye `profile_type`** — de genbruger `profile_type="itt"` og skelnes via rute-felterne (prolog: `distance_km` 5–8) + arketype-tag. En ny `profile_type` ville bryde §5's bit-identiske løfte (DB CHECK-constraint på 9 typer + `PROFILE_TO_BUCKET` i `raceTerrain.js` mapper kun de kendte → ukendt falder til `"flat"`).

**Verificeret S2-baseline (21/7, én pulje pr. tier — alle puljer identiske):**

| Tier | Summit (long_climb på mtn/hm) | M-Down% | Fritstående ITT | Brosten i etapeløb | → Mål (#2755) |
|---|---|---|---|---|---|
| 3 | 4 | 71% | 0 | 0 | summit ≥8 · M-Down ≤55% · ITT ≥1 · brosten ≥1 |
| 4 | 4 | 76% | 0 | 0 | summit ≥4 · M-Down ≤60% · ITT ≥1 · brosten ≥1 |

> **Scorecard-definition af "summit finish"** (reconciled mod #2755's "4"): `finale_type='long_climb'` på en `mountain`- eller `high_mountain`-profil. Den strikte high_mountain-only-tælling giver tier 3 = 1 / tier 4 = 0 — begge rapporteres, men **båndet gater på long_climb-på-mtn/hm-tallet** (= 4 i dag, matcher #2755).

---

## Filstruktur

| Fil | Ansvar | Ændring |
|---|---|---|
| `backend/lib/raceRouteGenerator.js` | Ren rute-berigelse (pass 2): distance/climbs/sprints/sectors/elevation + stignings-navne. Dedikeret rng-strøm. | NY |
| `backend/lib/raceRouteGenerator.test.js` | Kontrakt-form + determinisme + realisme-bånd pr. profil | NY |
| `backend/lib/raceStageProfileGenerator.js` | Kald `attachRoute` (pass 2); nye arketyper (`summit_tour`/`itt_classic`/`cobbled_tour`); `GENERATOR_VERSION` 3→4 | MODIFY |
| `backend/lib/raceStageProfileGenerator.test.js` | Pass-1 bit-identisk (golden) + arketype-adfærd | MODIFY |
| `backend/lib/raceRouteRealismMetrics.js` | Scorecard: tæl summit/M-Down/ITT/brosten/distance pr. tier + WT-bånd, GO/NO-GO | NY |
| `backend/lib/raceRouteRealismMetrics.test.js` | Metrik-korrekthed på syntetiske kalendre | NY |
| `backend/scripts/raceRouteRealismScorecard.js` | CLI-harness: regenerér en sæsons profiler in-memory mod live-katalog, print scorecard (GATEN) | NY |
| `backend/lib/tierCalendarMaterializer.js` | Persistér rute-felter i `race_stage_profiles`-insert | MODIFY |
| `backend/scripts/backfillRaceStageProfiles.js` | Persistér rute-felter i delete+insert (fuld regen af S2) | MODIFY |
| `backend/scripts/backfillRouteProfiles.js` | Rute-ONLY UPDATE (bevarer profil-mix) — for sæsoner der IKKE må fuld-regenereres | NY |
| `database/2026-07-21-race-route-model.sql` | Additive kolonner (§3), idempotent | NY |
| `database/2026-07-21-race-terrain-archetype-retag.sql` | Re-tag-liste (verificeret mod live-katalog), idempotent | NY |
| `frontend/src/pages/PatchNotesPage.jsx` · `frontend/src/data/help*.json` | Brugerrettet ændrings-note + FAQ | MODIFY |
| `docs/NOW.md` · `docs/superpowers/specs/2026-07-21-realistic-routes-foundation-design.md` | Close-out | MODIFY |

**Branch:** `feat/2769-realistic-routes-foundation` (worktree anbefalet — se `superpowers:using-git-worktrees`). Migrationer committes som `.sql`, applies post-merge af Claude (idempotent + post-verify, #2642-rammer).

---

## Task 1: Additive datamodel (migration)

**Files:**
- Create: `database/2026-07-21-race-route-model.sql`

- [ ] **Step 1: Skriv migrationen (additive kolonner, idempotent)**

```sql
-- 2026-07-21 · #2769 (Sub-1) · Additive rute-datamodel på race_stage_profiles.
-- Alt eksisterende urørt; motoren læser IKKE disse kolonner i Sub-1 (rent persisteret + vist).
-- Idempotent: kan køres flere gange. Applies post-merge (Claude, #2642-rammer).

ALTER TABLE race_stage_profiles
  ADD COLUMN IF NOT EXISTS distance_km        integer,
  ADD COLUMN IF NOT EXISTS elevation_gain_m   integer,
  ADD COLUMN IF NOT EXISTS climbs             jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sprints            jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sectors            jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN race_stage_profiles.distance_km      IS 'Etapens længde i km (Sub-1 #2769). NULL = ikke-genereret (legacy).';
COMMENT ON COLUMN race_stage_profiles.elevation_gain_m IS 'Samlet højdemeter (Sub-1 #2769).';
COMMENT ON COLUMN race_stage_profiles.climbs           IS 'Kategoriserede stigninger [{name,category,crest_km,length_km,avg_gradient,summit_finish}] sorteret på crest_km (Sub-1 #2769).';
COMMENT ON COLUMN race_stage_profiles.sprints          IS 'Sprints [{name,km,kind:"intermediate"|"finish"}] sorteret på km (Sub-1 #2769).';
COMMENT ON COLUMN race_stage_profiles.sectors          IS 'Brosten/grus-sektorer [{kind:"cobbles"|"gravel",start_km,length_km,name?}] sorteret på start_km (Sub-1 #2769).';
```

- [ ] **Step 2: Verificér idempotens lokalt (parse + gentag-sikkerhed)**

Migrationen bruger `ADD COLUMN IF NOT EXISTS` overalt → en gentagen kørsel er no-op. Ingen DB-kald i denne task (apply sker post-merge). Bekræft blot at der ikke findes destruktive statements:

Run: `grep -iE "drop|truncate|delete|alter column|not null(?! default)" database/2026-07-21-race-route-model.sql`
Expected: Ingen output (kun additive `ADD COLUMN IF NOT EXISTS` med `DEFAULT`).

- [ ] **Step 3: Commit**

```bash
git add database/2026-07-21-race-route-model.sql
git commit -F- <<'MSG'
feat(race): additive rute-datamodel på race_stage_profiles (#2769)

distance_km, elevation_gain_m, climbs/sprints/sectors jsonb. Alt additivt,
motoren urørt i Sub-1. Applies post-merge (idempotent).

Refs #2769, #2768
MSG
```

---

## Task 2: Rute-generator (pass 2) — `raceRouteGenerator.js`

**Files:**
- Create: `backend/lib/raceRouteGenerator.js`
- Test: `backend/lib/raceRouteGenerator.test.js`

- [ ] **Step 1: Skriv de fejlende kontrakt- + determinisme-tests**

```js
// backend/lib/raceRouteGenerator.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachRoute, DISTANCE_BANDS } from "./raceRouteGenerator.js";

const race = { external_id: "abc123", season_id: "s1", name: "Vuelta Andaluza" };
const stage = (profile_type, finale_type, stage_number = 1) =>
  ({ stage_number, profile_type, finale_type, demand_vector: {} });

test("attachRoute er deterministisk (samme input → deep-equal)", () => {
  const a = attachRoute(stage("high_mountain", "long_climb"), race, true);
  const b = attachRoute(stage("high_mountain", "long_climb"), race, true);
  assert.deepEqual(a, b);
});

test("distance_km ligger i profilens bånd", () => {
  for (const [pt, [lo, hi]] of Object.entries(DISTANCE_BANDS)) {
    const r = attachRoute(stage(pt, null), race, true);
    assert.ok(r.distance_km >= lo && r.distance_km <= hi, `${pt}: ${r.distance_km} udenfor [${lo},${hi}]`);
  }
});

test("summit-finale → sidste climb er summit_finish med crest = distance", () => {
  const r = attachRoute(stage("high_mountain", "long_climb"), race, true);
  assert.ok(r.climbs.length >= 1);
  const last = r.climbs[r.climbs.length - 1];
  assert.equal(last.summit_finish, true);
  assert.equal(last.crest_km, r.distance_km);
});

test("descent-finale → ingen summit_finish", () => {
  const r = attachRoute(stage("mountain", "descent"), race, true);
  assert.ok(r.climbs.every((c) => c.summit_finish === false));
});

test("climbs er sorteret på crest_km stigende", () => {
  const r = attachRoute(stage("mountain", "descent"), race, true);
  for (let i = 1; i < r.climbs.length; i++) assert.ok(r.climbs[i].crest_km >= r.climbs[i - 1].crest_km);
});

test("cobbles-profil → 3–6 brosten-sektorer inden for distancen", () => {
  const r = attachRoute(stage("cobbles", "reduced_sprint"), race, true);
  assert.ok(r.sectors.length >= 3 && r.sectors.length <= 6);
  assert.ok(r.sectors.every((s) => s.kind === "cobbles" && s.start_km + s.length_km <= r.distance_km));
});

test("etapeløbs-etape → mellemsprint + målspurt; endagsløb → kun målspurt", () => {
  const stageRace = attachRoute(stage("flat", "bunch_sprint"), race, true);
  assert.ok(stageRace.sprints.some((s) => s.kind === "intermediate"));
  assert.equal(stageRace.sprints[stageRace.sprints.length - 1].kind, "finish");
  const oneDay = attachRoute(stage("flat", "bunch_sprint"), race, false);
  assert.ok(oneDay.sprints.every((s) => s.kind === "finish"));
});

test("prolog-flag → itt-distance i 5–8 km", () => {
  const r = attachRoute({ ...stage("itt", "solo_tt"), is_prolog: true }, race, true);
  assert.ok(r.distance_km >= 5 && r.distance_km <= 8);
});

test("climb-navne er region-flavoured + ikke-tomme", () => {
  const es = attachRoute(stage("high_mountain", "long_climb"), { ...race, name: "Vuelta Burgalesa" }, true);
  assert.ok(es.climbs.every((c) => typeof c.name === "string" && c.name.length > 0));
});
```

- [ ] **Step 2: Kør testen og bekræft at den fejler**

Run: `cd backend && node --test lib/raceRouteGenerator.test.js`
Expected: FAIL med `Cannot find module './raceRouteGenerator.js'`.

- [ ] **Step 3: Implementér `raceRouteGenerator.js`**

```js
// backend/lib/raceRouteGenerator.js
// Sub-1 (#2769): rute-berigelse (pass 2) af en allerede-valgt etape. Ren funktion.
// Bruger en DEDIKERET rng-strøm (seed + ":route:" + stage_number) → forstyrrer ALDRIG
// pass 1's profile_type/finale_type/demand_vector. Udsender distance_km, elevation_gain_m,
// climbs[], sprints[], sectors[] jf. spec §3-4. Ingen DB/fs, ingen Math.random/Date.

import { makeRng } from "./fictionalRiderGenerator.js";

// FNV-1a 32-bit (lokal kopi af raceStageProfileGenerator.stableSeed — selvstændig fil).
function stableSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const presentKey = (v) => (typeof v === "string" ? (v.trim() === "" ? null : v) : v ?? null);
function seedIdentityFor(race) {
  return presentKey(race?.external_id) ?? presentKey(race?.pool_race_id) ?? race?.id ?? "adhoc";
}
function routeSeedKey(race, stageNumber) {
  const id = String(seedIdentityFor(race));
  const season = race?.season_id ? `::${race.season_id}` : "";
  return `${id}${season}:route:${stageNumber}`;
}

function randInt(rng, min, max) { return min + Math.floor(rng() * (max - min + 1)); }
function randFloat(rng, min, max, decimals = 1) {
  const f = 10 ** decimals;
  return Math.round((min + rng() * (max - min)) * f) / f;
}
function round5(n) { return Math.round(n / 5) * 5; }

// Distance-bånd pr. profil (spec §4.1, WT-kalibreret). [min,max] km.
export const DISTANCE_BANDS = Object.freeze({
  flat: [150, 200], rolling: [150, 190], hilly: [160, 210],
  mountain: [150, 190], high_mountain: [140, 180],
  cobbles: [150, 170], classic: [200, 260],
  itt: [15, 40], ttt: [25, 45],
});
export const PROLOG_BAND = Object.freeze([5, 8]);

// Climb-antal + kategori-pool pr. profil (spec §4.1).
const CLIMB_SPEC = Object.freeze({
  flat: { count: [0, 1], cats: ["4"] },
  rolling: { count: [1, 3], cats: ["3", "4"] },
  hilly: { count: [2, 4], cats: ["2", "3"] },
  mountain: { count: [3, 5], cats: ["1", "2", "3"] },
  high_mountain: { count: [2, 4], cats: ["HC", "1", "2"] },
  cobbles: { count: [0, 2], cats: ["3", "4"] },
  classic: { count: [2, 5], cats: ["1", "2", "3"] },
  itt: { count: [0, 0], cats: [] },
  ttt: { count: [0, 0], cats: [] },
});
// Længde (km) + gns. gradient (%) pr. kategori (WT-typisk).
const CAT_PROFILE = Object.freeze({
  HC: { length: [8, 20], grad: [7.5, 9.5] },
  "1": { length: [8, 16], grad: [6.5, 8.5] },
  "2": { length: [5, 10], grad: [5.5, 7.5] },
  "3": { length: [2, 6], grad: [4.5, 6.5] },
  "4": { length: [1, 3], grad: [4.0, 6.0] },
});
const CAT_ORDER = Object.freeze({ HC: 0, "1": 1, "2": 2, "3": 3, "4": 4 }); // 0 = hårdest
const SUMMIT_FINALE = new Set(["long_climb"]);
// Basis-højdemeter (ikke-kategoriseret bølgeterræn) pr. profil.
const BASE_ELEVATION = Object.freeze({
  flat: 200, rolling: 500, hilly: 700, mountain: 900, high_mountain: 1100,
  cobbles: 400, classic: 900, itt: 80, ttt: 120,
});

// --- Region-flavoured stignings-navne (deterministisk) ---
const REGION_PREFIXES = Object.freeze({
  es: ["Alto de", "Puerto de", "Coll de"],
  it: ["Passo di", "Salita di", "Cima"],
  fr: ["Col de", "Côte de", "Mont"],
  default: ["Climb of", "Ascent of", "Hill of"],
});
const PLACE_TOKENS = Object.freeze({
  es: ["Peña Blanca", "Valdeón", "Montaña", "Robledo", "Navacerrada", "El Cordal", "Covadonga", "Ancares"],
  it: ["San Pellegrino", "Fedaia", "Bondone", "Valparola", "Crostis", "Zoncolan", "Mortirolo", "Pratomagno"],
  fr: ["la Colombière", "Granier", "Beauregard", "Saint-Roch", "la Croix", "Portet", "Aubisque", "Vars"],
  default: ["Northgate", "Ravenshill", "Blackford", "Highfield", "Stonebridge", "Ashcombe", "Wynford", "Eldertop"],
});
const SECTOR_TOKENS = Object.freeze({
  es: ["Sector Adoquinado", "Tramo de Piedra"],
  it: ["Settore Pavé", "Tratto in Pietra"],
  fr: ["Secteur de Pavés", "Trouée d'Arenberg-type", "Carrefour de l'Arbre-type"],
  default: ["Cobbled Sector", "Pavé Stretch"],
});
const REGION_HINTS = Object.freeze([
  { re: /vuelta|espa|anda|burg|navarra|castilla|cantabria|picos|almer|llanera|cami|gran premio de|clásica|castilla|morvedre|mediterr/i, region: "es" },
  { re: /giro|coppa|trof(e|é)o|piemonte|veneto|emilia|trentino|abruzzo|legnano|peccioli|prato|appenn|ligure|colline|milano/i, region: "it" },
  { re: /tour|france|fran|jura|provence|mayenn|loire|golfe|bess|avesnois|dr[oô]me|touraine|hainaut|flandres|namur|wallonie|criquielion|k[oö]ln|c[eé]vennes|aveyron|ain/i, region: "fr" },
]);
function regionOf(raceName) {
  const s = String(raceName || "");
  for (const h of REGION_HINTS) if (h.re.test(s)) return h.region;
  return "default";
}
// Namer-factory: deterministisk fra rng + region. Undgår dubletter pr. etape via en brugt-mængde.
function makeRegionNamer(rng, region) {
  const prefixes = REGION_PREFIXES[region];
  const places = PLACE_TOKENS[region];
  const used = new Set();
  return {
    climb() {
      let name, guard = 0;
      do {
        name = `${prefixes[randInt(rng, 0, prefixes.length - 1)]} ${places[randInt(rng, 0, places.length - 1)]}`;
      } while (used.has(name) && guard++ < 8);
      used.add(name);
      return name;
    },
    sector(i) {
      const pool = SECTOR_TOKENS[region];
      return `${pool[randInt(rng, 0, pool.length - 1)]} ${i + 1}`;
    },
  };
}

function buildClimbs(rng, profileType, finaleType, distanceKm, namer) {
  const spec = CLIMB_SPEC[profileType] ?? CLIMB_SPEC.flat;
  const n = randInt(rng, spec.count[0], spec.count[1]);
  if (n === 0 || spec.cats.length === 0) return [];
  const cats = [];
  for (let i = 0; i < n; i++) cats.push(spec.cats[randInt(rng, 0, spec.cats.length - 1)]);
  // "Bygger mod klimaks": easiest først, hårdest sidst (descending CAT_ORDER-værdi).
  cats.sort((a, b) => CAT_ORDER[b] - CAT_ORDER[a]);
  const summit = SUMMIT_FINALE.has(finaleType);
  const climbs = [];
  for (let i = 0; i < n; i++) {
    const cp = CAT_PROFILE[cats[i]];
    const length_km = randFloat(rng, cp.length[0], cp.length[1], 1);
    const avg_gradient = randFloat(rng, cp.grad[0], cp.grad[1], 1);
    const isLast = i === n - 1;
    let crest_km;
    if (isLast) {
      crest_km = summit ? distanceKm : Math.max(1, distanceKm - randInt(rng, 5, 20));
    } else {
      crest_km = Math.round(distanceKm * (0.25 + (0.55 * (i + 1)) / n));
    }
    climbs.push({
      name: namer.climb(), category: cats[i], crest_km: Math.round(crest_km),
      length_km, avg_gradient, summit_finish: isLast && summit,
    });
  }
  climbs.sort((a, b) => a.crest_km - b.crest_km);
  return climbs;
}

function buildSprints(rng, profileType, finaleType, distanceKm, isStageRace) {
  const sprints = [];
  const summit = SUMMIT_FINALE.has(finaleType);
  const wantIntermediate = isStageRace && profileType !== "itt" && profileType !== "ttt" && !(summit && rng() < 0.5);
  if (wantIntermediate) {
    sprints.push({ name: "Intermediate Sprint", km: Math.round(distanceKm * randFloat(rng, 0.4, 0.65, 2)), kind: "intermediate" });
  }
  sprints.push({ name: "Finish", km: Math.round(distanceKm), kind: "finish" });
  return sprints;
}

function buildSectors(rng, profileType, distanceKm, namer) {
  let n = 0;
  if (profileType === "cobbles") n = randInt(rng, 3, 6);
  else if (profileType === "classic") n = randInt(rng, 0, 3); // Roubaix-type; typisk 0
  if (n === 0) return [];
  const sectors = [];
  let cursor = Math.round(distanceKm * 0.45); // brosten koncentreres i 2. halvdel
  for (let i = 0; i < n; i++) {
    const length_km = randFloat(rng, 1.0, 3.0, 1);
    if (cursor + length_km > distanceKm - 2) break;
    sectors.push({ kind: "cobbles", start_km: Math.round(cursor), length_km, name: namer.sector(i) });
    cursor += length_km + randInt(rng, 4, 12);
  }
  return sectors;
}

function elevationGain(climbs, profileType) {
  const fromClimbs = climbs.reduce((s, c) => s + Math.round((c.length_km * 1000 * c.avg_gradient) / 100), 0);
  return fromClimbs + (BASE_ELEVATION[profileType] ?? 300);
}

/**
 * Berig én etape med en rute (pass 2). Ren funktion — muterer ikke input.
 * @param {{stage_number:number, profile_type:string, finale_type:(string|null), is_prolog?:boolean}} stage
 * @param {{external_id?:string, pool_race_id?:string, id?:string, season_id?:string, name?:string}} race
 * @param {boolean} isStageRace  true = etape i et etapeløb; false = endagsløb (kun målspurt)
 * @returns {{distance_km,elevation_gain_m,climbs,sprints,sectors}}
 */
export function attachRoute(stage, race, isStageRace) {
  const pt = stage.profile_type;
  const rng = makeRng(stableSeed(routeSeedKey(race, stage.stage_number)));
  const namer = makeRegionNamer(rng, regionOf(race?.name));

  let distance_km;
  if (pt === "itt" && stage.is_prolog) distance_km = randInt(rng, PROLOG_BAND[0], PROLOG_BAND[1]);
  else {
    const [lo, hi] = DISTANCE_BANDS[pt] ?? DISTANCE_BANDS.flat;
    distance_km = pt === "itt" || pt === "ttt" ? randInt(rng, lo, hi) : round5(randInt(rng, lo, hi));
    if (distance_km < lo) distance_km = lo; // round5 må aldrig skyde under båndet
    if (distance_km > hi) distance_km = hi;
  }

  const climbs = buildClimbs(rng, pt, stage.finale_type, distance_km, namer);
  const sprints = buildSprints(rng, pt, stage.finale_type, distance_km, isStageRace);
  const sectors = buildSectors(rng, pt, distance_km, namer);
  return { distance_km, elevation_gain_m: elevationGain(climbs, pt), climbs, sprints, sectors };
}
```

- [ ] **Step 4: Kør testen og bekræft at den passerer**

Run: `cd backend && node --test lib/raceRouteGenerator.test.js`
Expected: PASS (alle tests grønne).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceRouteGenerator.js backend/lib/raceRouteGenerator.test.js
git commit -F- <<'MSG'
feat(race): rute-generator (pass 2) — distance/climbs/sprints/sektorer (#2769)

Ren, deterministisk berigelse via dedikeret rng-strøm. Region-flavoured
stignings-navne. Ingen DB/Math.random/Date.

Refs #2769
MSG
```

---

## Task 3: Wire pass 2 ind + bit-identisk pass 1 + GENERATOR_VERSION 4

**Files:**
- Modify: `backend/lib/raceStageProfileGenerator.js`
- Test: `backend/lib/raceStageProfileGenerator.test.js`

- [ ] **Step 1: Fang golden pass-1-output FRA main (før nogen ændring i denne fil)**

Kør på den **uændrede** `raceStageProfileGenerator.js` og gem pass-1-felterne som golden fixture. Dette beviser bit-identitet efter pass 2 wires ind.

```bash
cd backend && node --input-type=module -e '
import { generateRaceStageProfiles } from "./lib/raceStageProfileGenerator.js";
const cases = [
  { id: "r1", external_id: "8fe98b9f788c3b06", season_id: "s2", race_type: "stage_race", stages: 4, terrain_archetype: "mountain_tour" },
  { id: "r2", external_id: "241b2846959aa1c7", season_id: "s2", race_type: "stage_race", stages: 5, terrain_archetype: "balanced_week" },
  { id: "r3", external_id: "50c62405df6384e4", season_id: "s2", race_type: "single", stages: 1, terrain_archetype: "puncheur" },
  { id: "r4", external_id: "37e566b5829adb99", season_id: "s2", race_type: "stage_race", stages: 5, terrain_archetype: "sprinters_week" },
];
const strip = (ps) => ps.map((p) => ({ stage_number: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type, demand_vector: p.demand_vector }));
const out = Object.fromEntries(cases.map((c) => [c.id, strip(generateRaceStageProfiles(c))]));
console.log(JSON.stringify(out, null, 2));
' > lib/__fixtures__/pass1-golden.json && head -5 lib/__fixtures__/pass1-golden.json
```

Expected: `lib/__fixtures__/pass1-golden.json` skrevet med pass-1-felter for de 4 cases.

- [ ] **Step 2: Skriv den fejlende bit-identisk-test**

Tilføj til `backend/lib/raceStageProfileGenerator.test.js`:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));

test("pass 1 (profile/finale/demand) er bit-identisk efter pass 2 (golden)", () => {
  const golden = JSON.parse(readFileSync(join(__dir, "__fixtures__/pass1-golden.json"), "utf8"));
  const cases = {
    r1: { id: "r1", external_id: "8fe98b9f788c3b06", season_id: "s2", race_type: "stage_race", stages: 4, terrain_archetype: "mountain_tour" },
    r2: { id: "r2", external_id: "241b2846959aa1c7", season_id: "s2", race_type: "stage_race", stages: 5, terrain_archetype: "balanced_week" },
    r3: { id: "r3", external_id: "50c62405df6384e4", season_id: "s2", race_type: "single", stages: 1, terrain_archetype: "puncheur" },
    r4: { id: "r4", external_id: "37e566b5829adb99", season_id: "s2", race_type: "stage_race", stages: 5, terrain_archetype: "sprinters_week" },
  };
  for (const [key, race] of Object.entries(cases)) {
    const got = generateRaceStageProfiles(race).map((p) => ({
      stage_number: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type, demand_vector: p.demand_vector,
    }));
    assert.deepEqual(got, golden[key], `pass 1 ændret for ${key}`);
  }
});

test("pass 2 er additivt: rute-felter er til stede på hver etape", () => {
  const ps = generateRaceStageProfiles({ id: "r1", external_id: "8fe98b9f788c3b06", season_id: "s2", race_type: "stage_race", stages: 4, terrain_archetype: "mountain_tour" });
  for (const p of ps) {
    assert.equal(typeof p.distance_km, "number");
    assert.ok(Array.isArray(p.climbs) && Array.isArray(p.sprints) && Array.isArray(p.sectors));
    assert.equal(typeof p.elevation_gain_m, "number");
  }
});
```

- [ ] **Step 3: Kør testen og bekræft at den fejler**

Run: `cd backend && node --test lib/raceStageProfileGenerator.test.js`
Expected: FAIL — "pass 2 additivt"-testen fejler (`p.distance_km` er `undefined`).

- [ ] **Step 4: Wire pass 2 ind i `raceStageProfileGenerator.js`**

Tilføj importen øverst (efter `makeRng`-importen):

```js
import { attachRoute } from "./raceRouteGenerator.js";
```

Bump versionen (linje ~29):

```js
// v4 (2026-07-21, #2769): pass 2 (attachRoute) beriger hver etape med en rute
// (distance/climbs/sprints/sektorer) via en dedikeret rng-strøm. Pass 1 bit-identisk.
export const GENERATOR_VERSION = 4;
```

Erstat `toStage` så den kalder pass 2 (behold pass 1-felterne uændret):

```js
function toStage(rng, profileType, stageNumber, race, isStageRace, isProlog = false) {
  const base = {
    stage_number: stageNumber,
    profile_type: profileType,
    finale_type: finaleFor(rng, profileType),
    demand_vector: demandVectorFor(profileType),
  };
  // Pass 2: rute-berigelse via DEDIKERET rng-strøm (rører ikke `rng` ovenfor).
  const route = attachRoute({ ...base, is_prolog: isProlog }, race, isStageRace);
  return { ...base, ...route };
}
```

Tråd `race` + `isStageRace` gennem builder-kæden. Opdatér signaturerne:

```js
function buildSingle(rng, cfg, race) {
  const weights = cfg?.kind === "single" ? cfg.weights : SINGLE_PROFILE_WEIGHTS;
  return [toStage(rng, weightedPick(rng, weights), 1, race, false)];
}

function orderAndBuild(rng, types, stages, race) {
  types.length = stages;
  const ordered = types
    .map((t) => ({ t, key: STAGE_ORDER_HINT[t] + rng() * 0.5 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.t);
  // Prolog: en åbnings-itt på stage 1 markeres som prolog (kort 5–8 km ITT). Kun etapeløb.
  return ordered.map((profileType, i) => toStage(rng, profileType, i + 1, race, true, i === 0 && profileType === "itt"));
}

function buildStageRaceGeneric(rng, stages, race) {
  const types = ["flat", "mountain"];
  if (stages >= 5 && rng() < 0.7) types.push("itt");
  const protectedCount = types.length;
  while (types.length < stages) types.push(weightedPick(rng, STAGE_FILLER_WEIGHTS));
  capTimeTrials(rng, types, protectedCount, STAGE_FILLER_WEIGHTS);
  return orderAndBuild(rng, types, stages, race);
}

function buildStageRaceArchetype(rng, stages, cfg, race) {
  const types = cfg.guarantees.slice(0, stages);
  const protectedCount = types.length;
  while (types.length < stages) types.push(weightedPick(rng, cfg.filler));
  capTimeTrials(rng, types, protectedCount, cfg.filler);
  return orderAndBuild(rng, types, stages, race);
}

function buildStageRace(rng, stages, cfg, race) {
  return cfg?.kind === "stage" ? buildStageRaceArchetype(rng, stages, cfg, race) : buildStageRaceGeneric(rng, stages, race);
}
```

Opdatér `generateRaceStageProfiles`'s sidste linje:

```js
  return isStageRace ? buildStageRace(rng, stages, cfg, race) : buildSingle(rng, cfg, race);
```

> **DRY-note:** `finaleFor`/`demandVectorFor` kaldes ÉN gang pr. etape i `toStage` (pass 1), præcis som før — rækkefølgen af `rng`-forbrug i pass 1 er uændret, derfor er outputtet bit-identisk. `attachRoute` bruger sin egen rng og påvirker ikke `rng`.

- [ ] **Step 5: Kør testen og bekræft at den passerer**

Run: `cd backend && node --test lib/raceStageProfileGenerator.test.js`
Expected: PASS — inkl. "pass 1 bit-identisk (golden)".

- [ ] **Step 6: Commit**

```bash
git add backend/lib/raceStageProfileGenerator.js backend/lib/raceStageProfileGenerator.test.js backend/lib/__fixtures__/pass1-golden.json
git commit -F- <<'MSG'
feat(race): wire rute-pass 2 ind i generatoren, GENERATOR_VERSION 4 (#2769)

Pass 1 (profile/finale/demand) bit-identisk (golden fixture). Prolog =
åbnings-itt på stage 1 (5-8 km). Additive rute-felter pr. etape.

Refs #2769
MSG
```

---

## Task 4: Nye arketyper — `summit_tour`, `itt_classic`, `cobbled_tour`

**Files:**
- Modify: `backend/lib/raceStageProfileGenerator.js` (`ARCHETYPE_PROFILES`)
- Test: `backend/lib/raceStageProfileGenerator.test.js`

**Designbegrundelse (mod verificeret baseline):** tier 3/4-skævheden skyldes at ingen arketype **garanterer** en summit-finale — `mountain_tour` garanterer `mountain` (mellembjerg = descent-domineret finale → M-Down). `summit_tour` garanterer `high_mountain` (long_climb-domineret) → hæver summit + sænker M-Down i ét greb. `itt_classic` (single itt) løser fritstående ITT. `cobbled_tour` (garanteret `cobbles`-etape) løser brosten-i-etapeløb.

- [ ] **Step 1: Skriv de fejlende arketype-tests**

```js
import { ARCHETYPE_PROFILES, archetypeFor } from "./raceStageProfileGenerator.js";

test("summit_tour garanterer mindst én high_mountain-etape", () => {
  const cfg = ARCHETYPE_PROFILES.summit_tour;
  assert.equal(cfg.kind, "stage");
  assert.ok(cfg.guarantees.includes("high_mountain"));
});

test("summit_tour producerer ≥1 long_climb-summit over etaperne", () => {
  const race = { id: "st", external_id: "summit-x", season_id: "s2", race_type: "stage_race", stages: 5, terrain_archetype: "summit_tour" };
  const ps = generateRaceStageProfiles(race);
  const summits = ps.filter((p) => p.finale_type === "long_climb" && (p.profile_type === "high_mountain" || p.profile_type === "mountain"));
  assert.ok(summits.length >= 1, `forventede ≥1 summit, fik ${summits.length}`);
});

test("itt_classic er en single der giver netop én itt-etape", () => {
  const race = { id: "ic", external_id: "itt-x", season_id: "s2", race_type: "single", stages: 1, terrain_archetype: "itt_classic" };
  const ps = generateRaceStageProfiles(race);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].profile_type, "itt");
});

test("cobbled_tour garanterer en cobbles-etape inde i etapeløbet", () => {
  const race = { id: "ct", external_id: "cobbles-x", season_id: "s2", race_type: "stage_race", stages: 5, terrain_archetype: "cobbled_tour" };
  const ps = generateRaceStageProfiles(race);
  assert.ok(ps.some((p) => p.profile_type === "cobbles"), "manglede cobbles-etape");
  const cobbleStage = ps.find((p) => p.profile_type === "cobbles");
  assert.ok(cobbleStage.sectors.length >= 3, "cobbles-etape uden brosten-sektorer");
});
```

- [ ] **Step 2: Kør testen og bekræft at den fejler**

Run: `cd backend && node --test lib/raceStageProfileGenerator.test.js`
Expected: FAIL — `ARCHETYPE_PROFILES.summit_tour` er `undefined`.

- [ ] **Step 3: Tilføj arketyperne i `ARCHETYPE_PROFILES`**

Indsæt i `ARCHETYPE_PROFILES`-objektet (efter `mountain_classic`-single og de eksisterende stage-arketyper):

```js
  // #2769 (Sub-1): fritstående enkeltstart-endagsløb (#2177 — 0 fritstående ITT i dag).
  itt_classic: { kind: "single", weights: [{ value: "itt", weight: 1 }] },

  // #2769: etapeløb med GARANTERET high_mountain-summit (hæver tier 3/4 summit-finishes,
  // sænker M-Down-andelen — mountain_tour garanterer kun mellembjerg/descent). high_mountain
  // sidst via STAGE_ORDER_HINT (7) → dronningeetape/top-finish. En itt-garanti giver samtidig
  // en enkeltstart i løbet.
  summit_tour: { kind: "stage", guarantees: ["flat", "mountain", "high_mountain", "high_mountain"], filler: [{ value: "flat", weight: 14 }, { value: "rolling", weight: 12 }, { value: "hilly", weight: 12 }, { value: "mountain", weight: 20 }, { value: "high_mountain", weight: 26 }, { value: "itt", weight: 8 }] },

  // #2769: etapeløb med GARANTERET brosten-etape (#2527/#2755 — 0 brosten i etapeløb i dag).
  cobbled_tour: { kind: "stage", guarantees: ["flat", "cobbles", "mountain"], filler: [{ value: "flat", weight: 30 }, { value: "rolling", weight: 20 }, { value: "cobbles", weight: 16 }, { value: "hilly", weight: 16 }, { value: "mountain", weight: 12 }, { value: "itt", weight: 6 }] },
```

- [ ] **Step 4: Kør testen og bekræft at den passerer**

Run: `cd backend && node --test lib/raceStageProfileGenerator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceStageProfileGenerator.js backend/lib/raceStageProfileGenerator.test.js
git commit -F- <<'MSG'
feat(race): arketyper summit_tour/itt_classic/cobbled_tour (#2769)

Garanterede high_mountain-summit / fritstående ITT / brosten-i-etapeløb —
råstoffet der lader re-tagging ramme #2755-tier-båndene.

Refs #2769, #2755, #2177, #2527
MSG
```

---

## Task 5: Rute-realisme-scorecard (harness-gaten)

**Files:**
- Create: `backend/lib/raceRouteRealismMetrics.js`
- Create: `backend/lib/raceRouteRealismMetrics.test.js`
- Create: `backend/scripts/raceRouteRealismScorecard.js`

- [ ] **Step 1: Skriv de fejlende metrik-tests**

```js
// backend/lib/raceRouteRealismMetrics.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreTier, TIER_TARGETS } from "./raceRouteRealismMetrics.js";

// Syntetisk "tier": liste af løb, hver med etaper (profile_type/finale_type + rute).
const st = (profile_type, finale_type, distance_km = 160) => ({ profile_type, finale_type, distance_km, sectors: [] });
const stageRace = (stages) => ({ race_type: "stage_race", stages });
const oneDay = (profile_type, finale_type) => ({ race_type: "single", stages: [st(profile_type, finale_type)] });

test("scoreTier tæller summit = long_climb på mtn/hm", () => {
  const races = [{ ...stageRace(), stages: [st("high_mountain", "long_climb"), st("mountain", "long_climb"), st("mountain", "descent")] }];
  const s = scoreTier(3, races);
  assert.equal(s.summit_finishes, 2);
  assert.equal(s.mdown_pct, 33); // 1 descent af 3 bjerg-etaper
});

test("scoreTier tæller fritstående ITT + brosten-i-etapeløb", () => {
  const races = [
    oneDay("itt", "solo_tt"),
    { ...stageRace(), stages: [st("flat", "bunch_sprint"), { ...st("cobbles", "reduced_sprint"), sectors: [{ kind: "cobbles", start_km: 80, length_km: 2 }] }] },
  ];
  const s = scoreTier(3, races);
  assert.equal(s.standalone_itt, 1);
  assert.equal(s.cobbles_in_stagerace, 1);
});

test("GO/NO-GO: en tier under mål fejler gaten", () => {
  const flatOnly = [{ ...stageRace(), stages: [st("flat", "bunch_sprint"), st("mountain", "descent")] }];
  const s = scoreTier(3, flatOnly);
  assert.equal(s.pass, false);
  assert.ok(s.failures.some((f) => f.includes("summit")));
});

test("TIER_TARGETS matcher #2755 for tier 3 og 4", () => {
  assert.equal(TIER_TARGETS[3].summit_min, 8);
  assert.equal(TIER_TARGETS[3].mdown_max_pct, 55);
  assert.equal(TIER_TARGETS[4].summit_min, 4);
  assert.equal(TIER_TARGETS[4].mdown_max_pct, 60);
});
```

- [ ] **Step 2: Kør testen og bekræft at den fejler**

Run: `cd backend && node --test lib/raceRouteRealismMetrics.test.js`
Expected: FAIL — `Cannot find module './raceRouteRealismMetrics.js'`.

- [ ] **Step 3: Implementér `raceRouteRealismMetrics.js`**

```js
// backend/lib/raceRouteRealismMetrics.js
// Sub-1 (#2769) scorecard: mål en (regenereret) kalender mod WT-realisme + #2755-tier-bånd.
// Ren funktion — ingen DB. Input = allerede-genererede etaper (profile_type/finale_type/rute).
// GATEN: raceRouteRealismScorecard.js regenererer S2 in-memory og kalder scoreTier pr. tier.

const MOUNTAIN = new Set(["mountain", "high_mountain"]);
const isSummit = (s) => s.finale_type === "long_climb" && MOUNTAIN.has(s.profile_type);

// #2755-mål pr. tier. null = intet krav.
export const TIER_TARGETS = Object.freeze({
  1: { summit_min: null, mdown_max_pct: null, itt_min: null, cobbles_min: null },
  2: { summit_min: null, mdown_max_pct: null, itt_min: null, cobbles_min: null },
  3: { summit_min: 8, mdown_max_pct: 55, itt_min: 1, cobbles_min: 1 },
  4: { summit_min: 4, mdown_max_pct: 60, itt_min: 1, cobbles_min: 1 },
});

// WT-realisme-bånd (spec §6), pr. etape-type. [min,max] km.
export const WT_DISTANCE_BANDS = Object.freeze({
  flat: [150, 200], rolling: [150, 190], hilly: [160, 210],
  mountain: [140, 190], high_mountain: [140, 190],
  cobbles: [150, 170], classic: [200, 260], itt: [15, 40], ttt: [25, 45],
});

// Flad-ud alle etaper i en race-liste. En stage_race har `stages` som array; en single ligeså.
function allStages(races) {
  const out = [];
  for (const r of races) for (const s of (Array.isArray(r.stages) ? r.stages : [])) out.push({ ...s, _race_type: r.race_type });
  return out;
}

/**
 * Scorer én tier mod #2755-målene.
 * @param {number} tier
 * @param {Array<{race_type:string, stages:Array<{profile_type,finale_type,distance_km,sectors}>}>} races
 * @returns {{tier,summit_finishes,mountain_stages,mdown_pct,standalone_itt,cobbles_in_stagerace,pass,failures,distanceOutliers}}
 */
export function scoreTier(tier, races) {
  const stages = allStages(races);
  const mountainStages = stages.filter((s) => MOUNTAIN.has(s.profile_type));
  const mdown = mountainStages.filter((s) => s.finale_type === "descent");
  const summit = stages.filter(isSummit).length;
  const standaloneItt = races.filter((r) => r.race_type === "single" && (r.stages || []).some((s) => s.profile_type === "itt")).length;
  const cobblesInStageRace = races.filter((r) => r.race_type === "stage_race" && (r.stages || []).some((s) => s.profile_type === "cobbles")).length;
  const mdownPct = mountainStages.length ? Math.round((mdown.length / mountainStages.length) * 100) : 0;

  const distanceOutliers = stages.filter((s) => {
    const band = WT_DISTANCE_BANDS[s.profile_type];
    return band && (s.distance_km < band[0] || s.distance_km > band[1]);
  }).length;

  const t = TIER_TARGETS[tier] ?? {};
  const failures = [];
  if (t.summit_min != null && summit < t.summit_min) failures.push(`summit ${summit} < ${t.summit_min}`);
  if (t.mdown_max_pct != null && mdownPct > t.mdown_max_pct) failures.push(`M-Down ${mdownPct}% > ${t.mdown_max_pct}%`);
  if (t.itt_min != null && standaloneItt < t.itt_min) failures.push(`fritstående ITT ${standaloneItt} < ${t.itt_min}`);
  if (t.cobbles_min != null && cobblesInStageRace < t.cobbles_min) failures.push(`brosten-i-etapeløb ${cobblesInStageRace} < ${t.cobbles_min}`);

  return {
    tier, summit_finishes: summit, mountain_stages: mountainStages.length, mdown_pct: mdownPct,
    standalone_itt: standaloneItt, cobbles_in_stagerace: cobblesInStageRace,
    distanceOutliers, pass: failures.length === 0, failures,
  };
}

// GT-realisme (spec §6): tjek et 21-etapers løb. total-km-bånd + kategoriserede stigninger.
export function scoreGrandTour(stages) {
  const totalKm = stages.reduce((s, x) => s + (x.distance_km || 0), 0);
  const categorizedClimbs = stages.reduce((s, x) => s + ((x.climbs || []).length), 0);
  const hcClimbs = stages.reduce((s, x) => s + (x.climbs || []).filter((c) => c.category === "HC").length, 0);
  const failures = [];
  if (totalKm < 3200 || totalKm > 3500) failures.push(`total ${totalKm} km udenfor 3200–3500`);
  if (categorizedClimbs < 25) failures.push(`kategoriserede stigninger ${categorizedClimbs} < 25`);
  if (hcClimbs < 3 || hcClimbs > 8) failures.push(`HC-stigninger ${hcClimbs} udenfor 3–8`);
  return { totalKm, categorizedClimbs, hcClimbs, pass: failures.length === 0, failures };
}
```

- [ ] **Step 4: Kør testen og bekræft at den passerer**

Run: `cd backend && node --test lib/raceRouteRealismMetrics.test.js`
Expected: PASS.

- [ ] **Step 5: Implementér CLI-harnesset (regenerér S2 in-memory mod live-katalog)**

```js
#!/usr/bin/env node
// backend/scripts/raceRouteRealismScorecard.js
// GATEN (#2769): regenerér en sæsons profiler IN-MEMORY (rører INTET i DB) mod live-katalog
// og print scorecardet pr. tier. Bruges FØR nogen apply/regen.
//
//   node scripts/raceRouteRealismScorecard.js --season 2
//
// Regenererer via generateRaceStageProfiles (samme seed-kontekst som materializeren:
// external_id + terrain_archetype + season_id), så tallene matcher det en fuld regen ville give.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { generateRaceStageProfiles } from "../lib/raceStageProfileGenerator.js";
import { scoreTier, scoreGrandTour } from "../lib/raceRouteRealismMetrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const seasonIdx = process.argv.indexOf("--season");
const SEASON = seasonIdx >= 0 ? Number(process.argv[seasonIdx + 1]) : 2;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("❌ Missing SUPABASE creds"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const { data: season } = await supabase.from("seasons").select("id").eq("number", SEASON).single();
  if (!season) throw new Error(`Sæson ${SEASON} ikke fundet`);

  const divisions = await fetchAllRows(() => supabase.from("league_divisions").select("id, tier").order("id"));
  const tierByDiv = new Map(divisions.map((d) => [d.id, d.tier]));
  // Én pulje pr. tier (alle er identiske) — brug laveste div-id pr. tier.
  const onePoolByTier = new Map();
  for (const d of [...divisions].sort((a, b) => a.id - b.id)) if (!onePoolByTier.has(d.tier)) onePoolByTier.set(d.tier, d.id);
  const samplePools = new Set(onePoolByTier.values());

  const catalog = await fetchAllRows(() => supabase.from("race_pool").select("id, external_id, terrain_archetype").order("id"));
  const metaByPool = new Map(catalog.map((c) => [c.id, { external_id: c.external_id, terrain_archetype: c.terrain_archetype }]));

  const races = await fetchAllRows(() =>
    supabase.from("races").select("id, name, race_type, stages, pool_race_id, league_division_id").eq("season_id", season.id).order("id"));

  const byTier = new Map();
  for (const r of races) {
    if (!samplePools.has(r.league_division_id)) continue;
    const tier = tierByDiv.get(r.league_division_id);
    const meta = metaByPool.get(r.pool_race_id) || {};
    const seedRace = { ...r, external_id: meta.external_id ?? null, terrain_archetype: meta.terrain_archetype ?? null, season_id: season.id };
    const stages = generateRaceStageProfiles(seedRace);
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push({ race_type: r.race_type, stages });
  }

  console.log(`\n=== Rute-realisme-scorecard — sæson ${SEASON} (in-memory regen, generator v4) ===\n`);
  let allPass = true;
  for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
    const s = scoreTier(tier, byTier.get(tier));
    allPass = allPass && s.pass;
    const mark = s.pass ? "✅" : "❌";
    console.log(`${mark} Tier ${tier}: summit=${s.summit_finishes} · M-Down=${s.mdown_pct}% · fritstående ITT=${s.standalone_itt} · brosten-i-etapeløb=${s.cobbles_in_stagerace} · dist-outliers=${s.distanceOutliers}`);
    if (!s.pass) console.log(`     BRUD: ${s.failures.join(" · ")}`);
    // GT-tjek: tier 1 21-etapers løb.
    for (const r of byTier.get(tier)) {
      if (r.stages.length >= 21) {
        const gt = scoreGrandTour(r.stages);
        console.log(`     GT (${r.stages.length} et.): ${gt.totalKm} km · ${gt.categorizedClimbs} stigninger · ${gt.hcClimbs} HC ${gt.pass ? "✅" : "❌ " + gt.failures.join(", ")}`);
      }
    }
  }
  console.log(`\n${allPass ? "✅ GO — alle gatede tiers grønne" : "❌ NO-GO — mindst én tier under mål"}\n`);
  process.exit(allPass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Commit**

```bash
git add backend/lib/raceRouteRealismMetrics.js backend/lib/raceRouteRealismMetrics.test.js backend/scripts/raceRouteRealismScorecard.js
git commit -F- <<'MSG'
feat(race): rute-realisme-scorecard + GO/NO-GO-harness (#2769)

Måler regenereret kalender mod #2755-tier-bånd + WT-realisme. Gaten kører
FØR nogen migration/regen.

Refs #2769, #2755
MSG
```

---

## Task 6: Persistér rute-felter (materializer + fuld-regen-backfill)

**Files:**
- Modify: `backend/lib/tierCalendarMaterializer.js:325`
- Modify: `backend/scripts/backfillRaceStageProfiles.js:98-106`

- [ ] **Step 1: Udvid `profileRows`-mappingen i materializeren**

I `tierCalendarMaterializer.js`, i løkken der bygger `profileRows` (linje ~324-325), tilføj rute-felterne:

```js
        for (const p of generateRaceStageProfiles(seedRace)) {
          profileRows.push({
            race_id: race.id, stage_number: p.stage_number, profile_type: p.profile_type,
            finale_type: p.finale_type, demand_vector: p.demand_vector,
            distance_km: p.distance_km, elevation_gain_m: p.elevation_gain_m,
            climbs: p.climbs, sprints: p.sprints, sectors: p.sectors,
            generator_version: GENERATOR_VERSION, is_manual: false,
          });
        }
```

- [ ] **Step 2: Udvid `backfillRaceStageProfiles.js`-insert (fuld regen af S2)**

I `backend/scripts/backfillRaceStageProfiles.js`, i `rows`-mappingen (linje ~98-106):

```js
      const rows = profiles.map((p) => ({
        race_id: race.id, stage_number: p.stage_number,
        profile_type: p.profile_type, finale_type: p.finale_type, demand_vector: p.demand_vector,
        distance_km: p.distance_km, elevation_gain_m: p.elevation_gain_m,
        climbs: p.climbs, sprints: p.sprints, sectors: p.sectors,
        generator_version: GENERATOR_VERSION, is_manual: false,
      }));
```

- [ ] **Step 3: Verificér at eksisterende materializer-tests stadig passerer (ren plan-build urørt)**

Run: `cd backend && node --test lib/tierCalendarMaterializer.test.js`
Expected: PASS (mappingen er additiv; ren plan-build tester ikke insert-formen).

> Hvis `tierCalendarMaterializer.test.js` ikke findes, spring dette step. Insert-formen dækkes end-to-end af scorecardet + backfill-dry-run i Task 9.

- [ ] **Step 4: Commit**

```bash
git add backend/lib/tierCalendarMaterializer.js backend/scripts/backfillRaceStageProfiles.js
git commit -F- <<'MSG'
feat(race): persistér rute-felter i materializer + backfill (#2769)

distance_km/elevation_gain_m/climbs/sprints/sectors skrives ved kalender-
materialisering og ved fuld regen (backfillRaceStageProfiles).

Refs #2769
MSG
```

---

## Task 7: Rute-ONLY backfill — `backfillRouteProfiles.js`

**Files:**
- Create: `backend/scripts/backfillRouteProfiles.js`

**Formål:** tilføj rute-data til en sæsons EKSISTERENDE profiler UDEN at røre `profile_type`/`finale_type`/`demand_vector` (bevarer live-mix). Til sæsoner der IKKE må fuld-regenereres (fx en fremtidig S1-visning). **S2's 27/7-vej bruger IKKE denne — S2 fuld-regenereres i Task 9** (re-tags kræver ny profil-mix).

- [ ] **Step 1: Implementér scriptet**

```js
#!/usr/bin/env node
// backend/scripts/backfillRouteProfiles.js
// Rute-ONLY backfill (#2769): UPDATE distance_km/elevation_gain_m/climbs/sprints/sectors på
// EKSISTERENDE race_stage_profiles-rækker, matchet på (race_id, stage_number). Bevarer
// profile_type/finale_type/demand_vector uændret. Idempotent. Rører IKKE races/scheduling/game_day.
// Springer håndredigerede løb (is_manual) over.
//
//   node scripts/backfillRouteProfiles.js --season 2 [--dry-run]

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { attachRoute } from "../lib/raceRouteGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const seasonIdx = process.argv.indexOf("--season");
const SEASON = seasonIdx >= 0 ? Number(process.argv[seasonIdx + 1]) : null;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("❌ Missing SUPABASE creds"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  let seasonId = null;
  if (SEASON != null) {
    const { data } = await supabase.from("seasons").select("id").eq("number", SEASON).single();
    if (!data) throw new Error(`Sæson ${SEASON} ikke fundet`);
    seasonId = data.id;
  }
  const catalog = await fetchAllRows(() => supabase.from("race_pool").select("id, external_id, name").order("id"));
  const metaByPool = new Map(catalog.map((c) => [c.id, { external_id: c.external_id, name: c.name }]));

  const races = await fetchAllRows(() => {
    let q = supabase.from("races").select("id, name, race_type, pool_race_id, season_id").order("id");
    if (seasonId) q = q.eq("season_id", seasonId);
    return q;
  });
  const raceById = new Map(races.map((r) => [r.id, r]));

  const profiles = await fetchAllRows(() => {
    let q = supabase.from("race_stage_profiles").select("race_id, stage_number, profile_type, finale_type, is_manual").order("race_id");
    return q;
  });

  const manualRaceIds = new Set(profiles.filter((p) => p.is_manual).map((p) => p.race_id));
  let updated = 0, skippedManual = 0;
  for (const p of profiles) {
    const race = raceById.get(p.race_id);
    if (!race) continue; // profil for et andet sæson-løb
    if (manualRaceIds.has(p.race_id)) { skippedManual++; continue; }
    const meta = metaByPool.get(race.pool_race_id) || {};
    const seedRace = { ...race, external_id: meta.external_id ?? null, name: meta.name ?? race.name, season_id: race.season_id };
    const route = attachRoute(
      { stage_number: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type, is_prolog: p.stage_number === 1 && p.profile_type === "itt" },
      seedRace, race.race_type === "stage_race",
    );
    if (!DRY_RUN) {
      const { error } = await supabase.from("race_stage_profiles")
        .update({ distance_km: route.distance_km, elevation_gain_m: route.elevation_gain_m, climbs: route.climbs, sprints: route.sprints, sectors: route.sectors })
        .eq("race_id", p.race_id).eq("stage_number", p.stage_number);
      if (error) throw new Error(`update ${p.race_id}/${p.stage_number}: ${error.message}`);
    }
    updated++;
  }
  console.log(`${DRY_RUN ? "(DRY-RUN) " : ""}Rute-felter ${DRY_RUN ? "ville opdatere" : "opdaterede"} ${updated} etaper${skippedManual ? ` (sprang ${skippedManual} håndredigerede over)` : ""}.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verificér at scriptet parser (ingen DB-kald)**

Run: `cd backend && node --check scripts/backfillRouteProfiles.js`
Expected: Ingen output (syntaks-OK).

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/backfillRouteProfiles.js
git commit -F- <<'MSG'
feat(race): rute-only backfill-script (bevarer profil-mix) (#2769)

UPDATE af rute-felter på eksisterende rækker; til sæsoner der ikke må
fuld-regenereres. S2-vejen bruger fuld regen (re-tags kræver ny mix).

Refs #2769
MSG
```

---

## Task 8: Katalog-re-tag-liste (verificeret mod live-katalog)

**Files:**
- Create: `database/2026-07-21-race-terrain-archetype-retag.sql`

**Baggrund (verificeret 21/7 mod live `race_pool` + S2-kalender):** `terrain_archetype` er ortogonal til tier-selektionen (`selectTierRaceSet` rangerer kun på `race_class`+`stages`+seed), så re-tagging flytter ALDRIG et løb mellem tiers — hvert mål-løb nedenfor er bekræftet at lande i den angivne tier i S2. Re-tags matches på `external_id` (stabil identitet). Listen er **startforslaget**; scorecardet i Task 9 lukker loopet (juster tags/arketype-vægte til alle gatede tiers er grønne).

**Re-tag-mål:**

| external_id | Løb | Tier | Nu → Ny | Hvorfor |
|---|---|---|---|---|
| `bce1bccdd57efbb9` | Tour des Alpes Juliennes | 3 | mountain_tour → **summit_tour** | Alpine — garanteret high_mountain-summit |
| `622efeaa9c1a849d` | Vuelta Burgalesa | 3 | mountain_tour → **summit_tour** | Retter #2755's "4/5 M-Down" direkte |
| `e2471519c99384c6` | Tour Arctique | 3 | mountain_tour → **summit_tour** | Løfter tier 3 summit-count |
| `8fe98b9f788c3b06` | Giro d'Abruzzo Nuovo | 3 | mountain_tour → **summit_tour** | Appenniner-summit (Class1) |
| `37e566b5829adb99` | Danmark Rundt | 3 | sprinters_week → **cobbled_tour** | Nordeuropæisk brosten-i-etapeløb |
| `aea34f4c27148948` | Mascate Classic | 3 | flat_sprint → **itt_classic** | Flad ørkenrute — fritstående ITT |
| `b5d4329a6fa8dc15` | Vuelta a los Picos | 4 | mountain_tour → **summit_tour** | Picos de Europa — high_mountain-summit |
| `8b36bfed0f0557f5` | Giro del Trentino Nuovo | 4 | mountain_tour → **summit_tour** | Dolomitterne — summit-finale |
| `8f40dfb81187fab3` | Tour de l'Ain Nouveau | 4 | hilly_tour → **summit_tour** | Jura-summit; hæver tier 4 high_mountain |
| `7e002873eb156b00` | Ronde van Vlaams-Brabant | 4 | hilly_tour → **cobbled_tour** | Flandern = brosten (perfekt match) |
| `5206a2390029811d` | Gran Premio de Castilla | 4 | flat_sprint → **itt_classic** | Castiliansk højslette — fritstående ITT |

- [ ] **Step 1: Skriv re-tag-migrationen (idempotent, verificér-antal)**

```sql
-- 2026-07-21 · #2769 (Sub-1) · Re-tag terrain_archetype så tier 3/4-båndene (#2755) rammes.
-- Idempotent (matcher external_id; ren UPDATE). Applies post-merge EFTER scorecard-GO.
-- terrain_archetype er ortogonal til tier-selektionen → flytter ikke løb mellem tiers.

UPDATE race_pool SET terrain_archetype = 'summit_tour'
  WHERE external_id IN ('bce1bccdd57efbb9','622efeaa9c1a849d','e2471519c99384c6','8fe98b9f788c3b06','b5d4329a6fa8dc15','8b36bfed0f0557f5','8f40dfb81187fab3');

UPDATE race_pool SET terrain_archetype = 'cobbled_tour'
  WHERE external_id IN ('37e566b5829adb99','7e002873eb156b00');

UPDATE race_pool SET terrain_archetype = 'itt_classic'
  WHERE external_id IN ('aea34f4c27148948','5206a2390029811d');

-- Post-verify (forventet 11 rækker samlet): kør efter apply.
--   SELECT terrain_archetype, COUNT(*) FROM race_pool
--   WHERE external_id IN ('bce1bccdd57efbb9','622efeaa9c1a849d','e2471519c99384c6','8fe98b9f788c3b06',
--     '37e566b5829adb99','aea34f4c27148948','b5d4329a6fa8dc15','8b36bfed0f0557f5','8f40dfb81187fab3',
--     '7e002873eb156b00','5206a2390029811d') GROUP BY terrain_archetype;
--   Forventet: summit_tour=7, cobbled_tour=2, itt_classic=2.
```

- [ ] **Step 2: Verificér at alle 11 external_id findes i live-kataloget (præ-apply-sanity)**

Kør via Supabase MCP `execute_sql` (read-only tælling — ingen skrivning):

```sql
SELECT COUNT(*) FROM race_pool WHERE external_id IN
  ('bce1bccdd57efbb9','622efeaa9c1a849d','e2471519c99384c6','8fe98b9f788c3b06',
   '37e566b5829adb99','aea34f4c27148948','b5d4329a6fa8dc15','8b36bfed0f0557f5',
   '8f40dfb81187fab3','7e002873eb156b00','5206a2390029811d');
```
Expected: `11`.

- [ ] **Step 3: Commit**

```bash
git add database/2026-07-21-race-terrain-archetype-retag.sql
git commit -F- <<'MSG'
feat(race): re-tag terrain_archetype for tier 3/4-bånd (#2755) (#2769)

7× summit_tour, 2× cobbled_tour, 2× itt_classic. Verificeret mod live-katalog
+ S2-tier-placering. Applies post-merge efter scorecard-GO.

Refs #2769, #2755
MSG
```

---

## Task 9: GATEN — regenerér S2 in-memory, verificér bånd, iterér

> **Denne task er harness-gaten. INGEN migration/regen applies før scorecardet er GO for tier 3 OG 4.** Re-tag-migrationen (Task 8) skal først applies i et Supabase-branch/preview ELLER bekræftes via scorecardet, som læser `terrain_archetype` live. Da apply er ejer-/#2642-gated, kører vi scorecardet mod en **in-memory override** af re-tags (se step 1) FØR den rigtige apply.

- [ ] **Step 1: Kør scorecardet mod S2 med re-tags simuleret in-memory**

Da re-tag-.sql'en først applies post-merge, verificér effekten UDEN at skrive: lav en engangs-variant af harnesset der overlejrer re-tag-mappet på katalog-metaen. Tilføj en `--retags <fil>`-flag ELLER kør denne inline-check:

```bash
cd backend && node --input-type=module -e '
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv"; import { dirname, join } from "node:path"; import { fileURLToPath } from "node:url";
import { fetchAllRows } from "./lib/supabasePagination.js";
import { generateRaceStageProfiles } from "./lib/raceStageProfileGenerator.js";
import { scoreTier } from "./lib/raceRouteRealismMetrics.js";
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env"), quiet: true });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const RETAGS = { bce1bccdd57efbb9:"summit_tour",622efeaa9c1a849d:"summit_tour",e2471519c99384c6:"summit_tour",8fe98b9f788c3b06:"summit_tour",b5d4329a6fa8dc15:"summit_tour",8b36bfed0f0557f5:"summit_tour",8f40dfb81187fab3:"summit_tour","37e566b5829adb99":"cobbled_tour","7e002873eb156b00":"cobbled_tour",aea34f4c27148948:"itt_classic","5206a2390029811d":"itt_classic" };
const { data: season } = await sb.from("seasons").select("id").eq("number",2).single();
const divs = await fetchAllRows(()=>sb.from("league_divisions").select("id,tier").order("id"));
const tierByDiv = new Map(divs.map(d=>[d.id,d.tier])); const onePool=new Map();
for (const d of [...divs].sort((a,b)=>a.id-b.id)) if(!onePool.has(d.tier)) onePool.set(d.tier,d.id);
const sample=new Set(onePool.values());
const cat = await fetchAllRows(()=>sb.from("race_pool").select("id,external_id,terrain_archetype").order("id"));
const meta = new Map(cat.map(c=>[c.id,{external_id:c.external_id,terrain_archetype:RETAGS[c.external_id]??c.terrain_archetype}]));
const races = await fetchAllRows(()=>sb.from("races").select("id,name,race_type,stages,pool_race_id,league_division_id").eq("season_id",season.id).order("id"));
const byTier=new Map();
for (const r of races){ if(!sample.has(r.league_division_id))continue; const t=tierByDiv.get(r.league_division_id); const m=meta.get(r.pool_race_id)||{};
  const st=generateRaceStageProfiles({...r,external_id:m.external_id,terrain_archetype:m.terrain_archetype,season_id:season.id});
  if(!byTier.has(t))byTier.set(t,[]); byTier.get(t).push({race_type:r.race_type,stages:st}); }
for (const t of [...byTier.keys()].sort()){ const s=scoreTier(t,byTier.get(t));
  console.log(`${s.pass?"✅":"❌"} Tier ${t}: summit=${s.summit_finishes} M-Down=${s.mdown_pct}% ITT=${s.standalone_itt} brosten=${s.cobbles_in_stagerace}`, s.failures.join(" · ")); }
'
```

Expected: `✅ Tier 3` og `✅ Tier 4` (summit ≥8/≥4, M-Down ≤55%/≤60%, ITT ≥1, brosten ≥1).

- [ ] **Step 2: Hvis en tier er NO-GO — iterér (loop-guard: maks 3 runder, så STOP + spørg ejer)**

Justeringsknapper, i prioriteret rækkefølge:
1. **Summit for lav:** hæv `high_mountain`-vægten i `summit_tour.filler` (fx 26→32) ELLER re-tag ét ekstra mountain_tour-løb → summit_tour i den tier (vælg fra listen: tier 3 har `Tour du Golfe`/`Vuelta Andaluza` som balanced_week-kandidater; tier 4 har `Tour du Jura` mountain_tour).
2. **M-Down for høj:** flere summit_tour (erstatter mountain(descent)-garantier) ELLER sænk `mountain`-vægt i summit_tour.filler.
3. **Brosten/ITT mangler:** bekræft re-tag landede (external_id findes i den tier); tilføj ét mål mere.

Efter hver justering: gentag step 1. **2 runder uden fremskridt på samme symptom → STOP + forelæg ejer** (jf. loop-guard, `.claude/learnings/2026-05-17-symptom-patching-loop-vs-root-cause.md`).

- [ ] **Step 3: Byg preflight lokalt (obligatorisk før push)**

Run: `pwsh -File scripts/verify-local.ps1`
Expected: backend-tests + frontend-tests + frontend-build grønne. Kør desuden hele generator-suiten:
Run: `cd backend && node --test lib/raceRouteGenerator.test.js lib/raceStageProfileGenerator.test.js lib/raceRouteRealismMetrics.test.js`
Expected: PASS.

- [ ] **Step 4: Commit (scorecard-GO dokumenteret i PR-body)**

```bash
git commit --allow-empty -F- <<'MSG'
chore(race): scorecard GO for S2 tier 3/4 (#2769)

In-memory regen med re-tags: tier 3+4 rammer #2755-båndene (summit/M-Down/
ITT/brosten). Bånd-tal i PR-body. Klar til merge → apply post-merge.

Refs #2769, #2755
MSG
```

---

## Task 10: PR, apply (post-merge), S2-regen, verifikation, close-out

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx`, `frontend/src/data/help.json` (+ `help.da.json` hvis separat)
- Modify: `docs/NOW.md`

- [ ] **Step 1: Patch note + FAQ (brugerrettet ændring)**

Tilføj en patch-note-entry (EN først, DA under) om at løb nu har rigtige ruter (distance, navngivne bjerge, brosten-sektorer) og at S2-kalenderen er mere varieret (flere bjergtop-finaler, en fritstående enkeltstart, brosten inde i etapeløb). Opdatér `help.json` hvis rute-visning giver nye spørgsmål — ELLER skriv i PR-body hvorfor ikke (rute-data er persisteret men UI kommer i Sub-4 #2448, så evt. ingen player-facing visning endnu → patch-note kan udskydes til Sub-4). **Afgør eksplicit** og notér valget i PR-body.

- [ ] **Step 2: Push + opret PR mod PULL_REQUEST_TEMPLATE**

```bash
git push -u origin feat/2769-realistic-routes-foundation
gh pr create --title "feat(race): Sub-1 realistiske ruter — datamodel + generator (#2769)" --body-file - <<'BODY'
## Hvad
Additiv rute-datamodel + generator-pass-2 (#2769, epic #2768). Distance,
kategoriserede stigninger, mellemsprints, brosten-sektorer pr. etape. Nye
arketyper + re-tag rammer #2755-tier-båndene. Motoren bit-identisk.

## Scorecard (S2, in-memory regen, generator v4)
Tier 3: summit X (mål ≥8) · M-Down Y% (≤55%) · ITT Z (≥1) · brosten W (≥1) ✅
Tier 4: summit … ✅   [indsæt de faktiske GO-tal fra Task 9]

## Migrationer (applies post-merge, #2642)
- database/2026-07-21-race-route-model.sql (additive kolonner, idempotent)
- database/2026-07-21-race-terrain-archetype-retag.sql (11 re-tags, idempotent)
Efter apply: fuld regen af S2 (`backfillRaceStageProfiles.js --season 2`).

## Brugerverifikation
- [ ] Rute-data persisteret på S2-profiler (spot-check climbs/sectors/distance)
- [ ] Scorecard ✅ GO for tier 3+4 efter live apply+regen
- [ ] (Sub-4 leverer UI — ingen player-facing visning i denne PR)

Refs #2769, #2768, #2755, #2177, #2527
BODY
```

- [ ] **Step 3: Efter merge — apply migrationer (Claude, idempotent + post-verify)**

Rækkefølge (kritisk): (1) route-model, (2) re-tag, (3) fuld S2-regen.
```
-- 1) apply database/2026-07-21-race-route-model.sql (additive kolonner)
-- 2) apply database/2026-07-21-race-terrain-archetype-retag.sql
-- 3) post-verify re-tags: SELECT terrain_archetype, COUNT(*) ... (forventet summit_tour=7, cobbled_tour=2, itt_classic=2)
```
Derefter fuld regen af S2 (0 race_entries → sikkert):
```bash
cd backend && node scripts/backfillRaceStageProfiles.js --season 2 --dry-run   # inspicér fordeling
cd backend && node scripts/backfillRaceStageProfiles.js --season 2             # apply
```

- [ ] **Step 4: Post-apply verifikation (samme SQL som baselinen)**

Kør baseline-queryen fra planens top mod S2 igen. Expected:
- Tier 3: summit ≥8, M-Down ≤55%, standalone ITT ≥1, cobbles-in-stagerace ≥1.
- Tier 4: summit ≥4, M-Down ≤60%, standalone ITT ≥1, cobbles-in-stagerace ≥1.
- Spot-check: `SELECT distance_km, jsonb_array_length(climbs), jsonb_array_length(sectors) FROM race_stage_profiles WHERE distance_km IS NOT NULL LIMIT 5;` → distancer i bånd, climbs/sectors befolket.

- [ ] **Step 5: Close-out**

- `docs/NOW.md`: opdatér løbsmotor-epic-linjen (#2769 done/live, Sub-2/3 = Fable-session), nulstil 🤖 Working agent + 🎯 Next action (budget ≤1.200 tok).
- Markér #2769 `claude:todo`→`claude:done` (eller luk hvis fuldt verificeret) + kommentar med scorecard-tal. Kommentér #2755/#2177/#2527 (adresseret af Sub-1).
- Token-hygiejne: `pwsh -File scripts/check-agent-token-hygiene.ps1`.
- `docs/superpowers/specs/2026-07-21-realistic-routes-foundation-design.md`: markér §10-beslutningerne løst (27/7=a; re-tag-liste låst i denne plan).

---

## Self-review-noter (mod spec)

- **§3 datamodel** → Task 1 (additive kolonner) + Task 6 (persistens). ✅
- **§4 generator (pass 2, bånd, determinisme)** → Task 2 + Task 3. ✅
- **§4.2 nye arketyper** → Task 4 (summit_tour/itt_classic/cobbled_tour); `mountain_classic` findes allerede. `prolog` = itt+distance 5-8 (Task 3, `is_prolog`). ✅
- **§4.3 stignings-navne** → Task 2 (`makeRegionNamer`). ✅
- **§4.4 bit-identisk** → Task 3 (golden fixture). ✅
- **§6 scorecard** → Task 5 (metrics + harness) + Task 9 (gaten). ✅
- **§7 migration + backfill** → Task 1 + Task 6 (fuld regen) + Task 7 (rute-only). ✅
- **§10 beslutninger** → 27/7=a (låst); re-tag-liste (Task 8, verificeret). ✅
- **Uden for scope (Sub-2..5):** passage-ordener/KOM/bonus, gap-model, UI-graf, sidevind — ikke berørt. ✅
