# Realistisk parcours pr. løb (arketype-anker) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hvert katalog-løb får en terræn-arketype (+ land) der afspejler dets virkelige karakter og driver stage-profil-generatoren; parcours varierer pr. sæson men er identisk for alle grupper i en division inden for en sæson.

**Architecture:** Den rene, deterministiske generator (`raceStageProfileGenerator.js`) udvides på to akser: (1) seed = løb-identitet + `season_id` (sæson-variation, konsistens bevaret), (2) `terrain_archetype` styrer terrænfordelingen. Arketype + land persisteres på `race_pool` (migration + version-styret data-fil + idempotent apply-script). De fire genererings-veje tråder de nye felter ind. Til sidst én prod-regen.

**Tech Stack:** Node.js (ESM), `node:test`, Supabase (Postgres), mulberry32-RNG (`fictionalRiderGenerator.js`).

**Forudsætning:** Konsistens-fixet (seed på `external_id` via `seedIdentityFor`, `GENERATOR_VERSION=2`) er allerede committet på branchen `fix/stage-profile-seed-by-race-identity` (commit `a5879dc6`). Denne plan bygger ovenpå.

**Spec:** `docs/superpowers/specs/2026-06-28-realistic-race-parcours-archetype-design.md`

---

## Fil-struktur

| Fil | Ansvar | Handling |
|---|---|---|
| `backend/lib/raceStageProfileGenerator.js` | Seed-akse + arketype-fordeling + `ARCHETYPE_PROFILES` | Modificér |
| `backend/lib/raceStageProfileGenerator.test.js` | Unit-tests (sæson + arketype) | Modificér |
| `database/2026-06-28-race-pool-archetype-country.sql` | Migration: `country` + `terrain_archetype` kolonner | Opret |
| `database/seed/race_pool_archetypes.json` | Forfattede arketype + land pr. løb | Opret (forfattes interaktivt) |
| `backend/scripts/applyRacePoolArchetypes.js` | Idempotent apply af data-fil → `race_pool` | Opret |
| `backend/lib/tierCalendarMaterializer.js` | Tråd `terrain_archetype` + `season_id` | Modificér |
| `backend/lib/seasonCalendarMaterializer.js` | Tråd `terrain_archetype` + `season_id` | Modificér |
| `backend/scripts/backfillRaceStageProfiles.js` | Tråd `terrain_archetype` + `season_id` | Modificér |
| `backend/lib/tierCalendarMaterializer.test.js` | Integrationstest: arketype-drevet, sæson-akse | Modificér |
| `backend/scripts/checkStageProfileSeedDivergence.js` | Sæson-akse + arketype-dækning | Modificér |

Kør alle backend-kommandoer fra `backend/`. Test-runner: `node --test <fil>`.

---

## Task 1: Sæson-akse i seed'en

**Files:**
- Modify: `backend/lib/raceStageProfileGenerator.js`
- Test: `backend/lib/raceStageProfileGenerator.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

Tilføj efter den eksisterende "v2 hærdning"-test i `raceStageProfileGenerator.test.js`:

```js
test("sæson-akse: samme løb + samme sæson, FORSKELLIG races.id → identisk (konsistens bevaret)", () => {
  const a = { id: "pool-A", external_id: "tour-x", season_id: "s1", race_type: "stage_race", stages: 5 };
  const b = { id: "pool-B", external_id: "tour-x", season_id: "s1", race_type: "stage_race", stages: 5 };
  assert.deepEqual(generateRaceStageProfiles(a), generateRaceStageProfiles(b));
});

test("sæson-akse: samme løb, FORSKELLIG sæson → forskelligt parcours (variation pr. sæson)", () => {
  const s1 = { id: "x", external_id: "tour-x", season_id: "s1", race_type: "stage_race", stages: 6 };
  const s2 = { id: "x", external_id: "tour-x", season_id: "s2", race_type: "stage_race", stages: 6 };
  assert.notDeepEqual(generateRaceStageProfiles(s1), generateRaceStageProfiles(s2));
});

test("sæson-akse: uden season_id seedes på identitet alene (bagudkompatibel)", () => {
  const withSeason = { id: "x", external_id: "tour-x", race_type: "stage_race", stages: 5 };
  const same = { id: "y", external_id: "tour-x", race_type: "stage_race", stages: 5 };
  assert.deepEqual(generateRaceStageProfiles(withSeason), generateRaceStageProfiles(same));
});
```

- [ ] **Step 2: Kør testene — verificér de fejler**

Run: `node --test backend/lib/raceStageProfileGenerator.test.js`
Expected: FAIL (sæson-akse-testene fejler — season_id påvirker endnu ikke seed'en).

- [ ] **Step 3: Tilføj sæson til seed-nøglen**

I `raceStageProfileGenerator.js`, lige under `seedIdentityFor`, tilføj:

```js
// Fuld seed-nøgle = løb-identitet + sæson. Alle grupper i en sæson deler nøglen
// (konsistens); en ny sæson giver en ny nøgle (variation pr. sæson, jf. spec §5.1).
function seedKeyFor(race) {
  const id = String(seedIdentityFor(race));
  return race?.season_id ? `${id}::${race.season_id}` : id;
}
```

Ret seed-linjen i `generateRaceStageProfiles`:

```js
  const rng = makeRng(Number.isInteger(seed) ? seed >>> 0 : stableSeed(seedKeyFor(race)));
```

- [ ] **Step 4: Kør testene — verificér de passerer**

Run: `node --test backend/lib/raceStageProfileGenerator.test.js`
Expected: PASS (alle, inkl. de eksisterende seed-fix-tests — de sender ingen season_id, så uændret).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceStageProfileGenerator.js backend/lib/raceStageProfileGenerator.test.js
git commit -m "feat(race): sæson-akse i stage-profil-seed (variation pr. sæson, konsistens bevaret)"
```

---

## Task 2: Arketype-data + endagsløbs-generering

**Files:**
- Modify: `backend/lib/raceStageProfileGenerator.js`
- Test: `backend/lib/raceStageProfileGenerator.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

```js
import {
  generateRaceStageProfiles, seedIdentityFor, ARCHETYPE_PROFILES, archetypeFor,
  finaleFor, DEMAND_VECTORS, ABILITY_DIMENSIONS, PROFILE_TYPES, FINALE_TYPES, GENERATOR_VERSION,
} from "./raceStageProfileGenerator.js";
```

(udvid den eksisterende import med `ARCHETYPE_PROFILES, archetypeFor`).

```js
test("arketype endagsløb: cobbled_classic → brosten-domineret", () => {
  const seen = {};
  for (let s = 1; s <= 60; s++) {
    const p = generateRaceStageProfiles({ id: "r", external_id: `e${s}`, terrain_archetype: "cobbled_classic", race_type: "single", stages: 1 })[0];
    seen[p.profile_type] = (seen[p.profile_type] || 0) + 1;
  }
  assert.ok((seen.cobbles || 0) >= 45, `forventede mest cobbles, fik ${JSON.stringify(seen)}`);
});

test("arketype endagsløb: flat_sprint → fladt + bunch_sprint dominerer", () => {
  let sprint = 0;
  for (let s = 1; s <= 60; s++) {
    const p = generateRaceStageProfiles({ id: "r", external_id: `e${s}`, terrain_archetype: "flat_sprint", race_type: "single", stages: 1 })[0];
    assert.ok(["flat", "rolling"].includes(p.profile_type), `uventet ${p.profile_type}`);
    if (p.finale_type === "bunch_sprint") sprint++;
  }
  assert.ok(sprint >= 30, `forventede mange bunch_sprint, fik ${sprint}`);
});

test("ukendt/NULL arketype endagsløb → generisk fordeling (bagudkompatibel)", () => {
  const a = generateRaceStageProfiles({ id: "x", race_type: "single", stages: 1, external_id: "race-single-1" });
  const b = generateRaceStageProfiles({ id: "x", race_type: "single", stages: 1, external_id: "race-single-1", terrain_archetype: "ukendt_xyz" });
  assert.deepEqual(a, b);
});

test("archetypeFor: kendt arketype → config, ukendt → null", () => {
  assert.ok(archetypeFor({ terrain_archetype: "cobbled_classic" }));
  assert.equal(archetypeFor({ terrain_archetype: "vrøvl" }), null);
  assert.equal(archetypeFor({}), null);
});
```

- [ ] **Step 2: Kør testene — verificér de fejler**

Run: `node --test backend/lib/raceStageProfileGenerator.test.js`
Expected: FAIL (`ARCHETYPE_PROFILES`/`archetypeFor` udefineret).

- [ ] **Step 3: Tilføj arketype-data + opslag + arketype-bevidst `buildSingle`**

I `raceStageProfileGenerator.js`, tilføj efter `SINGLE_PROFILE_WEIGHTS`/`STAGE_FILLER_WEIGHTS`:

```js
// Arketype-fordelinger (jf. spec §4). kind:"single" → endagsløbs-profilvægte;
// kind:"stage" → garantier (force-include) + filler-vægte. Vægte = samme format
// som weightedPick. Tunbar ÉT sted (jf. spec §12).
export const ARCHETYPE_PROFILES = Object.freeze({
  flat_sprint:         { kind: "single", weights: [{ value: "flat", weight: 80 }, { value: "rolling", weight: 20 }] },
  cobbled_classic:     { kind: "single", weights: [{ value: "cobbles", weight: 90 }, { value: "flat", weight: 10 }] },
  puncheur:            { kind: "single", weights: [{ value: "hilly", weight: 85 }, { value: "classic", weight: 15 }] },
  hilly_classic:       { kind: "single", weights: [{ value: "hilly", weight: 50 }, { value: "classic", weight: 35 }, { value: "rolling", weight: 15 }] },
  mountain_classic:    { kind: "single", weights: [{ value: "mountain", weight: 60 }, { value: "high_mountain", weight: 30 }, { value: "hilly", weight: 10 }] },
  long_sprint_classic: { kind: "single", weights: [{ value: "rolling", weight: 60 }, { value: "flat", weight: 25 }, { value: "hilly", weight: 15 }] },

  grand_tour:    { kind: "stage", guarantees: ["flat", "flat", "flat", "itt", "mountain", "high_mountain", "high_mountain"], filler: [{ value: "flat", weight: 26 }, { value: "rolling", weight: 12 }, { value: "hilly", weight: 14 }, { value: "mountain", weight: 20 }, { value: "high_mountain", weight: 14 }, { value: "itt", weight: 12 }, { value: "ttt", weight: 2 }] },
  mountain_tour: { kind: "stage", guarantees: ["flat", "mountain", "mountain"], filler: [{ value: "flat", weight: 16 }, { value: "rolling", weight: 14 }, { value: "hilly", weight: 14 }, { value: "mountain", weight: 34 }, { value: "high_mountain", weight: 16 }, { value: "itt", weight: 6 }] },
  hilly_tour:    { kind: "stage", guarantees: ["flat", "hilly", "hilly"], filler: [{ value: "flat", weight: 18 }, { value: "rolling", weight: 22 }, { value: "hilly", weight: 34 }, { value: "mountain", weight: 14 }, { value: "high_mountain", weight: 4 }, { value: "itt", weight: 8 }] },
  sprinters_week:{ kind: "stage", guarantees: ["flat", "mountain"], filler: [{ value: "flat", weight: 50 }, { value: "rolling", weight: 22 }, { value: "hilly", weight: 12 }, { value: "mountain", weight: 10 }, { value: "itt", weight: 6 }] },
  balanced_week: { kind: "stage", guarantees: ["flat", "mountain"], filler: [{ value: "flat", weight: 30 }, { value: "rolling", weight: 20 }, { value: "hilly", weight: 18 }, { value: "mountain", weight: 18 }, { value: "high_mountain", weight: 4 }, { value: "itt", weight: 10 }] },
});

export function archetypeFor(race) {
  return ARCHETYPE_PROFILES[race?.terrain_archetype] ?? null;
}
```

Ret `buildSingle` til at tage en valgfri config:

```js
function buildSingle(rng, cfg) {
  const weights = cfg?.kind === "single" ? cfg.weights : SINGLE_PROFILE_WEIGHTS;
  return [toStage(rng, weightedPick(rng, weights), 1)];
}
```

Ret kaldet i `generateRaceStageProfiles` til at sende arketypen (kun single i denne task; stage i Task 3):

```js
export function generateRaceStageProfiles(race, { seed } = {}) {
  if (!race?.id) throw new Error("race.id kræves");
  const isStageRace = race.race_type === "stage_race";
  const stages = isStageRace ? Math.max(2, Number(race.stages) || 2) : 1;
  const cfg = archetypeFor(race);
  const rng = makeRng(Number.isInteger(seed) ? seed >>> 0 : stableSeed(seedKeyFor(race)));
  return isStageRace ? buildStageRace(rng, stages) : buildSingle(rng, cfg);
}
```

- [ ] **Step 4: Kør testene — verificér de passerer**

Run: `node --test backend/lib/raceStageProfileGenerator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceStageProfileGenerator.js backend/lib/raceStageProfileGenerator.test.js
git commit -m "feat(race): arketype-data + endagsløbs-generering (ARCHETYPE_PROFILES)"
```

---

## Task 3: Arketype-drevet etapeløbs-generering + version-bump

**Files:**
- Modify: `backend/lib/raceStageProfileGenerator.js`
- Test: `backend/lib/raceStageProfileGenerator.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

```js
test("arketype etapeløb: sprinters_week → mest flad, ingen high_mountain", () => {
  const counts = {};
  for (let s = 1; s <= 30; s++) {
    for (const p of generateRaceStageProfiles({ id: "r", external_id: `e${s}`, terrain_archetype: "sprinters_week", race_type: "stage_race", stages: 6 })) {
      counts[p.profile_type] = (counts[p.profile_type] || 0) + 1;
    }
  }
  assert.equal(counts.high_mountain || 0, 0, "sprinters_week må ikke have high_mountain");
  assert.ok((counts.flat || 0) > (counts.mountain || 0), `flad skal dominere: ${JSON.stringify(counts)}`);
});

test("arketype etapeløb: mountain_tour garanterer ≥2 bjerg-etaper + ≥1 flad", () => {
  for (let s = 1; s <= 30; s++) {
    const types = generateRaceStageProfiles({ id: "r", external_id: `e${s}`, terrain_archetype: "mountain_tour", race_type: "stage_race", stages: 6 }).map((p) => p.profile_type);
    const climby = types.filter((t) => ["mountain", "high_mountain"].includes(t)).length;
    assert.ok(climby >= 2, `mountain_tour ${s}: kun ${climby} bjerg-etaper`);
    assert.ok(types.includes("flat"), `mountain_tour ${s}: ingen flad`);
  }
});

test("arketype etapeløb: grand_tour (21) har ≥2 high_mountain + ≥1 itt", () => {
  for (let s = 1; s <= 20; s++) {
    const types = generateRaceStageProfiles({ id: "r", external_id: `e${s}`, terrain_archetype: "grand_tour", race_type: "stage_race", stages: 21 }).map((p) => p.profile_type);
    assert.ok(types.filter((t) => t === "high_mountain").length >= 2, `gt ${s}: <2 high_mountain`);
    assert.ok(types.includes("itt"), `gt ${s}: ingen itt`);
  }
});

test("ukendt/NULL arketype etapeløb → uændret generisk adfærd (garanterer flad+bjerg)", () => {
  for (const n of [2, 4, 5, 6]) {
    for (let seed = 1; seed <= 20; seed++) {
      const types = generateRaceStageProfiles({ id: "x", race_type: "stage_race", stages: n }, { seed }).map((p) => p.profile_type);
      assert.ok(types.some((t) => ["flat", "rolling"].includes(t)), `n=${n} seed=${seed}: ingen flad`);
      assert.ok(types.some((t) => ["mountain", "high_mountain"].includes(t)), `n=${n} seed=${seed}: ingen bjerg`);
    }
  }
});

test("GENERATOR_VERSION er 3 (arketype-seedet)", () => {
  assert.equal(GENERATOR_VERSION, 3);
});
```

(Opdatér den eksisterende `GENERATOR_VERSION`-test fra `2` til denne, eller fjern den gamle for at undgå dublet.)

- [ ] **Step 2: Kør testene — verificér de fejler**

Run: `node --test backend/lib/raceStageProfileGenerator.test.js`
Expected: FAIL (etapeløb bruger endnu ikke arketypen; version er 2).

- [ ] **Step 3: Omdøb generisk + tilføj arketype-sti i `buildStageRace`**

Omdøb den nuværende `buildStageRace` til `buildStageRaceGeneric` (uændret krop). Tilføj en ny dispatcher:

```js
// Generisk (uændret): garanterer ≥1 flad + ≥1 bjerg, kort TT i lange løb.
function buildStageRaceGeneric(rng, stages) {
  const types = ["flat", "mountain"];
  if (stages >= 5 && rng() < 0.7) types.push("itt");
  while (types.length < stages) types.push(weightedPick(rng, STAGE_FILLER_WEIGHTS));
  types.length = stages;
  const ordered = types
    .map((t) => ({ t, key: STAGE_ORDER_HINT[t] + rng() * 0.5 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.t);
  return ordered.map((profileType, i) => toStage(rng, profileType, i + 1));
}

// Arketype-drevet: garantier (force-include, trimmet til stages) + filler-vægte,
// ordnet med STAGE_ORDER_HINT (flad tidligt → bjerg sent).
function buildStageRaceArchetype(rng, stages, cfg) {
  const types = cfg.guarantees.slice(0, stages);
  while (types.length < stages) types.push(weightedPick(rng, cfg.filler));
  types.length = stages;
  const ordered = types
    .map((t) => ({ t, key: STAGE_ORDER_HINT[t] + rng() * 0.5 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.t);
  return ordered.map((profileType, i) => toStage(rng, profileType, i + 1));
}

function buildStageRace(rng, stages, cfg) {
  return cfg?.kind === "stage" ? buildStageRaceArchetype(rng, stages, cfg) : buildStageRaceGeneric(rng, stages);
}
```

Ret kaldet i `generateRaceStageProfiles`:

```js
  return isStageRace ? buildStageRace(rng, stages, cfg) : buildSingle(rng, cfg);
```

Bump versionen:

```js
// ... v2 = seed på external_id; v3 (2026-06-28) = arketype-drevet fordeling + sæson-akse.
export const GENERATOR_VERSION = 3;
```

- [ ] **Step 4: Kør testene — verificér de passerer**

Run: `node --test backend/lib/raceStageProfileGenerator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceStageProfileGenerator.js backend/lib/raceStageProfileGenerator.test.js
git commit -m "feat(race): arketype-drevet etapeløbs-generering + GENERATOR_VERSION 3"
```

---

## Task 4: Migration — `country` + `terrain_archetype` kolonner

**Files:**
- Create: `database/2026-06-28-race-pool-archetype-country.sql`

- [ ] **Step 1: Skriv migrationen**

```sql
-- ============================================================
-- race_pool: terræn-arketype + land (realisme-anker)
-- ============================================================
-- terrain_archetype driver stage-profil-generatoren (jf.
-- backend/lib/raceStageProfileGenerator.js ARCHETYPE_PROFILES). country er
-- display-metadata. Begge nullable + additive (IF NOT EXISTS). NULL archetype →
-- generatoren falder tilbage til generiske vægte (bagudkompatibelt).
-- EJEREN MERGER (migration auto-applies i prod, jf. AGENTS.md).

ALTER TABLE public.race_pool
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS terrain_archetype text;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verificér SQL-syntaks lokalt (uden at køre mod prod)**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('database/2026-06-28-race-pool-archetype-country.sql','utf8');if(!/ADD COLUMN IF NOT EXISTS terrain_archetype text/.test(s))throw new Error('mangler kolonne');console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit (ejer merger PR'en — migration auto-applies)**

```bash
git add database/2026-06-28-race-pool-archetype-country.sql
git commit -m "feat(db): race_pool.country + terrain_archetype (realisme-anker)"
```

---

## Task 5: Apply-script for arketype-data

**Files:**
- Create: `backend/scripts/applyRacePoolArchetypes.js`
- Create: `database/seed/race_pool_archetypes.json` (minimal stub nu; fuldt forfattet i Task 8)

**Note:** Scriptet er idempotent og opdaterer KUN `country` + `terrain_archetype` (rør ikke andre felter). Default = dry-run.

- [ ] **Step 1: Opret en minimal data-fil-stub**

`database/seed/race_pool_archetypes.json`:

```json
[
  { "external_id": "2492f98e221c8b6f", "name": "L'Enfer du Nord", "country": "France", "terrain_archetype": "cobbled_classic" }
]
```

- [ ] **Step 2: Skriv apply-scriptet**

`backend/scripts/applyRacePoolArchetypes.js`:

```js
#!/usr/bin/env node
// Anvend database/seed/race_pool_archetypes.json → race_pool (country +
// terrain_archetype, match på external_id). Idempotent. Default = dry-run.
//   node scripts/applyRacePoolArchetypes.js            # dry-run (vis ændringer)
//   node scripts/applyRacePoolArchetypes.js --apply    # skriv
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { ARCHETYPE_PROFILES } from "../lib/raceStageProfileGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
const APPLY = process.argv.includes("--apply");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("❌ Missing SUPABASE_URL/KEY"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const data = JSON.parse(readFileSync(join(__dirname, "../../database/seed/race_pool_archetypes.json"), "utf8"));
const valid = new Set(Object.keys(ARCHETYPE_PROFILES));
const bad = data.filter((d) => !valid.has(d.terrain_archetype));
if (bad.length) { console.error(`❌ ${bad.length} ukendte arketyper: ${[...new Set(bad.map((b) => b.terrain_archetype))].join(", ")}`); process.exit(1); }

const catalog = await fetchAllRows(() => supabase.from("race_pool").select("id, external_id, country, terrain_archetype"));
const byExt = new Map(catalog.map((c) => [c.external_id, c]));
let changes = 0, missing = 0;
for (const d of data) {
  const cur = byExt.get(d.external_id);
  if (!cur) { console.log(`  ⚠ ukendt external_id: ${d.external_id} (${d.name})`); missing++; continue; }
  if (cur.country !== d.country || cur.terrain_archetype !== d.terrain_archetype) {
    changes++;
    console.log(`  ${d.name}: ${cur.terrain_archetype ?? "∅"} → ${d.terrain_archetype} · land ${cur.country ?? "∅"} → ${d.country}`);
    if (APPLY) {
      const { error } = await supabase.from("race_pool").update({ country: d.country, terrain_archetype: d.terrain_archetype }).eq("id", cur.id);
      if (error) throw new Error(`update ${d.external_id}: ${error.message}`);
    }
  }
}
console.log(`\n${APPLY ? "Skrev" : "(dry-run) ville skrive"} ${changes} ændringer · ${missing} ukendte external_id · ${data.length} rækker i filen.`);
const noArch = catalog.filter((c) => !data.find((d) => d.external_id === c.external_id));
if (noArch.length) console.log(`⚠ ${noArch.length} katalog-løb mangler en arketype i data-filen.`);
```

- [ ] **Step 3: Dry-run mod prod (read-only) — verificér scriptet kører**

Run (fra `backend/`): `node scripts/applyRacePoolArchetypes.js`
Expected: viser 1 ændring (L'Enfer du Nord) + advarsel om ~120 manglende arketyper. Skriver intet.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/applyRacePoolArchetypes.js database/seed/race_pool_archetypes.json
git commit -m "feat(race): apply-script for race_pool arketype + land (dry-run default)"
```

---

## Task 6: Tråd `terrain_archetype` + `season_id` gennem genererings-vejene

**Files:**
- Modify: `backend/lib/tierCalendarMaterializer.js`
- Modify: `backend/lib/seasonCalendarMaterializer.js`
- Modify: `backend/scripts/backfillRaceStageProfiles.js`
- Test: `backend/lib/tierCalendarMaterializer.test.js`

- [ ] **Step 1: Skriv/udvid den fejlende integrationstest**

I `tierCalendarMaterializer.test.js`, opdatér FØRST den eksisterende test "apply: en divisions puljer får IDENTISK parcours pr. løb, seedet på external_id": dens `expected`-beregning skal nu inkludere `season_id` (materializeren tråder `season_id: "s1"` ind i Task 6), ellers brydes den. Ret linjen til:

```js
    const expected = routeStr(generateRaceStageProfiles({ id: "ignored", external_id: externalById.get(poolRaceId), race_type: meta.race_type, stages: meta.stages, season_id: "s1" }));
```

(Katalog-rækkerne i den test har ingen `terrain_archetype` → `null` → generisk fordeling i begge sider, så den fortsat passerer.)

Tilføj derefter en ny test der beviser at arketypen faktisk driver parcours:

```js
test("apply: arketype driver parcours + season_id i seed (sæson-akse)", async () => {
  const catalog = tier3Catalog().map((c) => ({ ...c, external_id: `ext-${c.id}`, terrain_archetype: c.race_type === "stage_race" ? "mountain_tour" : "cobbled_classic" }));
  const league_divisions = [
    { id: 4, tier: 3, pool_index: 0, label: "Division 3 — A" },
    { id: 5, tier: 3, pool_index: 1, label: "Division 3 — B" },
  ];
  const mgr = (id, pool) => ({ id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: pool });
  const teams = [mgr("a1", 4), mgr("a2", 4), mgr("a3", 4), mgr("b1", 5), mgr("b2", 5), mgr("b3", 5)];
  const sb = makeSupabase({ league_divisions, teams, race_pool: catalog });
  await materializeTierCalendars({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false });

  // Endagsløb (cobbled_classic) → brosten dominerer.
  const oneDayProfiles = sb.state.race_stage_profiles.filter((p) => {
    const r = sb.state.races.find((x) => x.id === p.race_id);
    const meta = catalog.find((c) => c.id === r.pool_race_id);
    return meta && meta.race_type === "single";
  });
  const cobbles = oneDayProfiles.filter((p) => p.profile_type === "cobbles").length;
  assert.ok(cobbles >= oneDayProfiles.length * 0.6, `forventede brosten-dominans, fik ${cobbles}/${oneDayProfiles.length}`);
});
```

- [ ] **Step 2: Kør testen — verificér den fejler**

Run: `node --test backend/lib/tierCalendarMaterializer.test.js`
Expected: FAIL (materializeren tråder endnu ikke arketype → endagsløb bruger generisk fordeling, ikke brosten).

- [ ] **Step 3: Tråd arketype + season_id i tier-materializeren**

I `tierCalendarMaterializer.js`, udvid katalog-select + map (ved siden af `externalIdByPoolRace`):

```js
  const { data: catalog, error: cErr } = await supabase.from("race_pool").select("id, external_id, terrain_archetype, name, race_class, race_type, stages");
  if (cErr) throw new Error(`race_pool: ${cErr.message}`);
  const externalIdByPoolRace = new Map((catalog || []).map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map((catalog || []).map((c) => [c.id, c.terrain_archetype ?? null]));
```

Ret `seedRace`-konstruktionen i profil-løkken:

```js
        const seedRace = { ...race, external_id: externalIdByPoolRace.get(race.pool_race_id) ?? null, terrain_archetype: archetypeByPoolRace.get(race.pool_race_id) ?? null, season_id: seasonId };
```

- [ ] **Step 4: Tråd arketype + season_id i season-materializeren**

I `seasonCalendarMaterializer.js`, samme mønster — udvid katalog-select + tilføj `archetypeByPoolRace`-map, og ret `seedRace`:

```js
  const { data: catalog, error: catErr } = await supabase
    .from("race_pool").select("id, external_id, terrain_archetype, name, race_class, race_type, stages");
  if (catErr) throw new Error(`race_pool: ${catErr.message}`);
  const externalIdByPoolRace = new Map((catalog || []).map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map((catalog || []).map((c) => [c.id, c.terrain_archetype ?? null]));
```

```js
      const seedRace = { ...race, external_id: externalIdByPoolRace.get(race.pool_race_id) ?? null, terrain_archetype: archetypeByPoolRace.get(race.pool_race_id) ?? null, season_id: seasonId };
```

- [ ] **Step 5: Tråd arketype + season_id i backfill**

I `backfillRaceStageProfiles.js`, udvid `loadExternalIdByPoolRace` til også at hente arketype (omdøb til `loadCatalogMeta`):

```js
async function loadCatalogMeta() {
  const rows = await fetchAllRows(() =>
    supabase.from("race_pool").select("id, external_id, terrain_archetype").order("id"));
  return new Map((rows || []).map((r) => [r.id, { external_id: r.external_id ?? null, terrain_archetype: r.terrain_archetype ?? null }]));
}
```

Ret kaldet + `seedRace` (race-rækken har allerede `season_id` fra select'en):

```js
  const catalogMeta = await loadCatalogMeta();
```

```js
    const meta = catalogMeta.get(race.pool_race_id) || {};
    const seedRace = { ...race, external_id: meta.external_id ?? null, terrain_archetype: meta.terrain_archetype ?? null };
    const profiles = generateRaceStageProfiles(seedRace);
```

(`race.season_id` er allerede med i select'en `"id, name, race_type, stages, season_id, pool_race_id"` → indgår i seed via `seedKeyFor`.)

- [ ] **Step 6: Kør testene — verificér de passerer**

Run: `node --test backend/lib/tierCalendarMaterializer.test.js backend/lib/seasonCalendarMaterializer.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/lib/tierCalendarMaterializer.js backend/lib/seasonCalendarMaterializer.js backend/scripts/backfillRaceStageProfiles.js backend/lib/tierCalendarMaterializer.test.js
git commit -m "feat(race): tråd terrain_archetype + season_id gennem genererings-vejene"
```

---

## Task 7: Udvid divergens-diagnostikken med sæson + arketype-dækning

**Files:**
- Modify: `backend/scripts/checkStageProfileSeedDivergence.js`

- [ ] **Step 1: Tilføj season_id + arketype til frisk-genereringen + dækningsrapport**

I `checkStageProfileSeedDivergence.js`: udvid races-select med intet (season er kendt), men sæt `season_id` på `seedRace`, hent arketype-map fra `race_pool`, og rapportér hvor mange løb der mangler en arketype.

Ret katalog-load:

```js
  const catMeta = new Map((await fetchAllRows(() => supabase.from("race_pool").select("id, external_id, terrain_archetype"))).map((r) => [r.id, { external_id: r.external_id ?? null, terrain_archetype: r.terrain_archetype ?? null }]));
```

Ret `seedRace`:

```js
    const m = catMeta.get(r.pool_race_id) || {};
    const seedRace = { id: r.id, race_type: r.race_type, stages: r.stages, pool_race_id: r.pool_race_id, external_id: m.external_id, terrain_archetype: m.terrain_archetype, season_id: season.id };
```

Tilføj før den afsluttende `✅/❌`-linje:

```js
  const noArch = races.filter((r) => !(catMeta.get(r.pool_race_id) || {}).terrain_archetype).length;
  console.log(`Arketype-dækning: ${races.length - noArch}/${races.length} løb har en arketype${noArch ? ` (${noArch} mangler → generisk fordeling)` : ""}.`);
```

- [ ] **Step 2: Kør diagnostikken — verificér den stadig viser EFTER=0**

Run (fra `backend/`): `node scripts/checkStageProfileSeedDivergence.js --season 1`
Expected: EFTER=0 i alle divisioner; arketype-dækning vises (før forfatning: 0/263 → efter Task 8: 263/263).

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/checkStageProfileSeedDivergence.js
git commit -m "chore(race): diagnostik — sæson-akse + arketype-dækning"
```

---

## Task 8: Forfat arketype + land for alle 121 løb (interaktiv ejer-review)

**Files:**
- Modify: `database/seed/race_pool_archetypes.json`

- [ ] **Step 1: Generér udkast**

Hent alle katalog-løb (`external_id, name, race_class, race_type, stages, date_text`). For hvert: foreslå `country` + `terrain_archetype` ud fra det genkendelige ægte løb (fx `L'Enfer du Nord`→France/cobbled_classic, `La Classica d'Autunno`→Italy/mountain_classic, `La Course au Soleil`→France/balanced_week). Skriv det fulde udkast til `race_pool_archetypes.json`.

- [ ] **Step 2: Præsentér review-tabel for ejeren**

Vis tabellen grupperet pr. `race_class`. Ejeren retter (flytter løb mellem arketyper, retter land). Opdatér JSON-filen efter rettelser.

- [ ] **Step 3: Validér dækning + gyldighed**

Run (fra `backend/`): `node scripts/applyRacePoolArchetypes.js`
Expected: 0 ukendte arketyper, 0 manglende external_id, ~121 ændringer, 0 katalog-løb uden arketype.

- [ ] **Step 4: Commit**

```bash
git add database/seed/race_pool_archetypes.json
git commit -m "feat(race): forfat arketype + land for alle 121 katalog-løb"
```

---

## Task 9: Fuld backend-suite + lokal pre-flight

**Files:** (ingen — verifikation)

- [ ] **Step 1: Kør hele backend-suiten**

Run (fra `backend/`): `node --test`
Expected: alle grønne, 0 fejl.

- [ ] **Step 2: Kør verify-local hvis tid**

Run (fra repo-rod): `pwsh -File scripts/verify-local.ps1`
Expected: backend-tests + frontend-tests + build grønne.

- [ ] **Step 3: Push branchen + åbn PR (ejer merger pga. migration)**

```bash
git push
```
Åbn PR mod `main`. **Auto-merge IKKE** (PR'en indeholder `database/*.sql` → ejer merger, jf. AGENTS.md).

---

## Task 10: Anvend katalog-berigelse + regen i prod (ejer-gated)

**Files:** (ingen — prod-operationer; kør i rækkefølge, ÉN ad gangen, ejer-go pr. skridt)

- [ ] **Step 1: Migration i prod** — sker automatisk når ejeren merger PR'en (kolonner tilføjes).

- [ ] **Step 2: Anvend arketype + land til prod-kataloget**

Run (fra `backend/`): `node scripts/applyRacePoolArchetypes.js --apply`
Expected: ~121 ændringer skrevet; verificér med en read-only `SELECT count(*) FILTER (WHERE terrain_archetype IS NOT NULL)` = 121.

- [ ] **Step 3: Regen race_stage_profiles for sæson 1 (ejer-go — destruktiv masseskrivning)**

Backup findes allerede (`backup_seedfix_20260628_race_stage_profiles`). Med eksplicit ejer-go:

Run (fra `backend/`): `node scripts/backfillRaceStageProfiles.js --season 1`
Expected: 700 etape-rækker regenereret, `generator_version=3`.

- [ ] **Step 4: Verificér**

Run (fra `backend/`): `node scripts/checkStageProfileSeedDivergence.js --season 1`
Expected: EFTER=0 kryds-pulje-divergens; arketype-dækning 263/263. Lav en stikprøve af løb-navne vs parcours mod virkeligheden (fx `L'Enfer du Nord` → brosten).

- [ ] **Step 5: Close-out**

Patch notes (brugerrettet ændring: realistiske, konsistente ruter), `FEATURE_STATUS.md` hvis kontrakter ændret, `docs/NOW.md`, postmortem hvis relevant, og luk relateret issue.

---

## Self-Review (udført)

- **Spec-dækning:** §3 datamodel → Task 4; §4 taksonomi → Task 2+3 (`ARCHETYPE_PROFILES`); §5 generator (seed+arketype) → Task 1+2+3; §6 persistering → Task 4+5+8; §7 forfatning → Task 8; §8 integration → Task 6; §9 test → Task 1-3,6,7; §10 regen → Task 9+10. Ingen huller.
- **Placeholders:** ingen TBD/TODO; al kode vist.
- **Type-konsistens:** `seedKeyFor`, `archetypeFor`, `ARCHETYPE_PROFILES`, `buildSingle(rng,cfg)`, `buildStageRace(rng,stages,cfg)`, `loadCatalogMeta`, `archetypeByPoolRace` brugt konsistent på tværs af tasks.
