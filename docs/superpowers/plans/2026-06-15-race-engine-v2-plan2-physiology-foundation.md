# Race-engine v2 — Plan 2: Fysiologi-fundament (arketype-skæv seeding → fysiologi-drevet evne-derivation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gør fysiologi til fundamentet under evnerne: seed `rider_physiology_profiles` **skævt pr. arketype** (born-in specialisering), omskriv `abilityDerivation.js` så de **fysiske** evner udledes fra fysiologien (tekniske/mentale forbliver skill-seeds fra legacy-stats), merge `prolog` ind i `time_trial`, og re-tune mod Plan 1's eksisterende born-as-scorecard (`race:gate` grøn på alle seeds) — alt verificeret in-memory FØR prod.

**Architecture:** Den frosne `simulateStage`-kontrakt (motor-input = A′, evner) bevares uændret — vi rører IKKE scoringen. Vi indsætter fysiologi som det lag evnerne udledes fra: (1) en ny ren `archetypePhysiology.js` der genererer en arketype-skæv fysiologi-profil (samme felt-form som `physiologySeeding.js` + 3 nye metrics), (2) generatoren hænger profilen på hver fiktiv rytter, (3) `abilityDerivation.js` v3 læser fysiologi→fysiske evner og legacy-skill-stats→tekniske/mentale evner, (4) dry-run-harnessen fodrer profilen ind i `deriveAbilities`, og (5) derivations-koefficienter + arketype-skew tunes mod det eksisterende born-as-scorecard til gaten er grøn. Migrationen er **reversibel** (deprecér `prolog`/`power_5m_wkg`, drop dem ikke). Den eksisterende `physiologySeeding.js` (legacy-stat→fysiologi, FORMULA_VERSION=1, prod-backfill for PCM-ryttere) røres ikke.

**Tech Stack:** Node.js ≥24 ESM (`"type":"module"`), `node:test` + `node:assert/strict`, deterministisk `makeRng` (mulberry32) + `gaussian` (Box-Muller) fra `fictionalRiderGenerator.js`, det eksisterende `race:gate` + `balance:baseline`-snapshot. Postgres-migration (idempotent, `ADD COLUMN IF NOT EXISTS`, kolonne-privilegier).

**Branch:** `feat/1102-race-engine-v2-plan2` (feat → branch + PR; **har `database/*.sql` → ALDRIG auto-merge, EJEREN merger** — migrationen auto-applies i prod ved merge). PR-body skal have Brugerverifikation-sektion (ikke ren backend-only — migrationen + re-derive er bruger-synligt via evne-tal).

---

## Context for a zero-context engineer

- **Design-SSOT** er `docs/decisions/rider-ability-system-v2.md` — især **§0.1** (ejer-låst 2026-06-15). Ved konflikt vinder §0.1 over §3–§9 (historiske forslag). Læs §0.1 før du rører evne-listen eller derivations-mappingen.
- **Plan 1 (PR #1414, merged)** byggede måleinstrumentet (`raceSensitivity.js` + liveness-oracle + dry-run sektion E + committet `balance-baseline`) og aktiverede de 5 dødvægts-evner (`aggression`/`flat`/`tempo`/`durability`/`descending`) i motoren. Motor-vokabularet (`ABILITY_KEYS`=15, `DEMAND_VECTORS`) er allerede udvidet. Plan 2 rører **ikke** motoren — kun fysiologi + derivation + seeding. Kalibrerings-log: `docs/decisions/race-engine-v2-plan1-calibration-log.md`.
- **Evne-derivation i dag** (`backend/lib/abilityDerivation.js`, `FORMULA_VERSION=2`): hver disciplin-evne = ren lineær remap af sin primære PCM-stat (`stat_bj`→climbing osv.) `[50,85]→[1,99]`. `physiology`-parametren **ignoreres** i dag (kun rider_id-fallback). 16 synlige evner inkl. `prolog` + `hidden_potential`.
- **Fysiologi-tabellen** (`rider_physiology_profiles`, `database/2026-06-04-race-engine-physiology-schema.sql`): 14 metrics (ftp_wkg/ftp_watts/vo2max_power_wkg/zone2_power_wkg/pmax_watts/power_5s/15s/1m/5m_wkg/high_intensity_energy_kj/time_to_exhaustion_ftp_min/fatigue_resistance/recovery_rate/height_cm/weight_kg). RLS: `select_authenticated USING(true)` (**table-RLS, IKKE kolonne-privilegier** — nye kolonner her er auto-læsbare for `authenticated`, ingen per-kolonne-GRANT nødvendig).
- **Evne-tabellen** (`rider_derived_abilities`): bruger **KOLONNE-PRIVILEGIER** (`database/2026-06-10-riders-potentiale-column-privilege.sql`): `REVOKE SELECT` på tabel + `GRANT SELECT (kolonner)` undtagen `hidden_potential`. ⚠️ **#1309-fælden:** `ADD COLUMN` på `rider_derived_abilities`/`riders` giver IKKE klient-læseadgang → frontend får "permission denied". Plan 2 tilføjer ingen nye *læsbare* kolonner her (vi deprecerer `prolog`, dropper den ikke), men hvis du tilføjer én SKAL den grantes i samme migration. Verificér mod prod-klon, ikke frisk DB.
- **Seeding-generatoren** (`backend/lib/fictionalRiderGenerator.js`): deterministisk, arketype-bevidst. 9 arketyper (`ARCHETYPES`) med stat-boost/damp + `heightMean`/`bmi`. `_meta.archetype` er allerede sat pr. rytter. Eksakt tier-kvote (12/60/230/resten ved count 800). `makeRng`/`gaussian` eksporteret. Låst launch-population: `fictionalLaunchPopulation.js` (seed 2026, count 800).
- **Dry-run-harnessen** (`backend/scripts/simulateSeasonDryRun.js`): `generateFictionalRiders → deriveAbilities({}, {...r,id}) → computeRiderTypes/predictBaseValue → simulateStage`. Kører 8 terræner × 300 løb + Grand Tour, sektion A–E. `npm run race:gate` = `--enforce-targets --enforce-liveness --no-html` på seeds 2026/7/42 (+ condition + roles), CI-wired.
- **Scorecardet gater på BORN-AS** (`bornPct >= t.pct`, linje 385): `w.bornAs = _meta.archetype` (seeding-arketypen). Den **afledte** type (`computeRiderTypes`) + `baseValue` er kun rapport — de re-fittes i **Plan 3** (type z-score) / **Plan 4** (#1101 værdimodel). Derfor blokerer deres staleness IKKE Plan 2's tuning: kæden vi tuner er `arketype → skæv fysiologi → deriveAbilities → evner → demand-vektor-scoring → born-as-vinder-andel`.

## Non-goals (eksplicit deferret — ejer-besluttet 2026-06-15)

- **Nye terræn-typer** `medium_mountain` + `itt_short`/`itt_long` + ITT-split + nye demand-vektorer → **senere motor-slice** (ejer-defer 15/6). Plan 1 gav allerede motoren vokabular til de 5 aktiverede evner; fysiologi-omskrivningen er ikke blokeret af nye terræner. Rør IKKE `raceStageProfileGenerator.js`/`raceSimulator.js` her.
- **Hard-drop af `prolog`/`power_5m_wkg`-kolonner** → senere cleanup-migration når det nye system er bevist live (ejer valgte "deprecér nu, drop senere"). Kolonnerne forbliver nullable; vi stopper bare med at læse/skrive dem.
- **8-type z-score re-fit** (`riderTypes.js` + `riderTypesBaseline.json`) → **Plan 3**. Vi RØRER ikke type-formler/baseline. (Den afledte type bliver midlertidigt mindre præcis i sektion A — forventet, ikke en gate.)
- **Frontend fysiologi+evne-view, PCM-stat-swap-out, #1101 værdimodel-refit** → **Plan 4**. PCM-stats bliver i dataen som value-model-input indtil da (§7).
- **PCM-rytter-fysiologi** (`seedPhysiologyFromLegacy` for de ~9.000 importerede): røres ikke. De får stadig legacy-afledt fysiologi; deres evner re-derives fra den ved prod-backfill (Task D2), men launch-populationen er 100% fiktiv (epic #1105) så det er ikke gate-kritisk.

## File Structure

| File | Created/Modified | Responsibility |
|---|---|---|
| `database/2026-06-15-physiology-foundation-v2.sql` | **Create** | Migration: `ADD COLUMN IF NOT EXISTS power_2m_wkg/power_10m_wkg/aero` på `rider_physiology_profiles` (nullable); bump `version` default→2; kommentar-deprecering af `power_5m_wkg` + `prolog`. Ingen drop, ingen rename. Idempotent. |
| `backend/lib/archetypePhysiology.js` | **Create** | Ren, deterministisk arketype-skæv fysiologi-seeding: `seedArchetypePhysiology({archetype, tierLevel, height_cm, weight_kg, rng})` → fuld profil (14 + 3 nye metrics), monoton power-kurve håndhævet. Tuning-fladen for specialisering. |
| `backend/lib/archetypePhysiology.test.js` | **Create** | Determinisme, arketype-skew (climber høj ftp_wkg/lav pmax vs sprinter omvendt), monoton power-kurve, +3 metrics tilstede, tier-monotoni. |
| `backend/lib/abilityDerivation.js` | **Modify** | Omskriv til fysiologi-drevet: `FORMULA_VERSION=3`; fysiske evner ← fysiologi-bøtter; tekniske/mentale ← skill-stats (uændret kilde); `prolog` FJERNES fra output; `VISIBLE_ABILITIES`=15. Fallback til PCM-stat-derivation når fysiologi mangler (PCM-ryttere/pre-v3). |
| `backend/lib/abilityDerivation.test.js` | **Modify** | Opdatér ankre (fysiologi-input i stedet for stat-input); fjern `prolog`-assertions; ny VO2max-trekant-test; behold determinisme/bounds; fallback-test. |
| `backend/lib/fictionalRiderGenerator.js` | **Modify** | Hæng en arketype-fysiologi-profil på hver rytter (`_meta.physiology`); intet ændret i `riders`-payloaden (fysiologi går i separat tabel). |
| `backend/lib/fictionalRiderGenerator.test.js` | **Modify** | Test at `_meta.physiology` sættes deterministisk + er arketype-konsistent. |
| `backend/lib/fictionalLaunchPopulation.test.js` | **Modify** | Hvis den asserter evne-/payload-felter: opdatér til v3 (ingen prolog). |
| `backend/scripts/simulateSeasonDryRun.js` | **Modify** | Fodr `r._meta.physiology` ind i `deriveAbilities(physiology, {...r,id})`. Ellers uændret. |
| `backend/lib/balanceSnapshot.js` | **Modify** | Sørg for at snapshot-feltet bruger samme fysiologi-fodrede sti; bump diff når abilities skifter. |
| `backend/scripts/baselines/balance-baseline.{json,md}` | **Modify (regen)** | `npm run balance:baseline` — én gang RØD (efter omskrivning, før tune), én gang GRØN (efter tune). |
| `backend/scripts/backfillRacePhysiology.js` | **Modify** | Fiktive ryttere (`pcm_id IS NULL`) → `seedArchetypePhysiology` (arketype fra type-klassifikation eller lagret); PCM-ryttere → `seedPhysiologyFromLegacy` (uændret). Skriv +3 metrics. (Prod-apply-sti; ejer kører efter merge.) |
| `backend/scripts/previewDerivedAbilities.js` | **Modify** | Re-derive læser fysiologi fra `rider_physiology_profiles` og fodrer den ind i `deriveAbilities` (i dag fodres `{}`). Skriv ikke `prolog`. |
| `docs/decisions/race-engine-v2-plan2-calibration-log.md` | **Create** | Endelige arketype-skew + derivations-koefficienter + kalibrerings-ankre + born-as-scorecard pr. seed. |
| `frontend/src/pages/PatchNotesPage.jsx` | **Modify** | Patch-note: evner afledt af fysiologi; `prolog` slået sammen med `time_trial`. |
| `docs/FEATURE_STATUS.md` | **Modify** | Opdatér evne-system-kontrakt (15 synlige, fysiologi-drevet). |

---

## PHASE A — Migration + arketype-fysiologi-fundament (ingen derivation-ændring endnu)

Byg fundamentet uden at røre `deriveAbilities` — gaten forbliver grøn (evner kommer stadig fra PCM-stats indtil Phase B).

### Task A1: Reversibel migration (+3 metrics, deprecér prolog/power_5m)

**Files:**
- Create: `database/2026-06-15-physiology-foundation-v2.sql`

- [ ] **Step 1: Skriv migrationen**

```sql
-- Evne-system v2 / Plan 2 (#1122) — fysiologi-fundament.
-- Tilføj 3 fysiologi-metrics (power_2m_wkg, power_10m_wkg, aero) som NULLABLE; de
-- fyldes af backfillRacePhysiology.js umiddelbart efter migration. MAP = vo2max_power_wkg
-- (allerede korrekt navngivet — INGEN rename). power_5m_wkg + rider_derived_abilities.prolog
-- DEPRECERES (motoren/derivationen holder op med at bruge dem) men DROPPES IKKE her
-- (ejer-valg "deprecér nu, drop senere" — reversibelt; hard-drop i senere cleanup-migration).
--
-- rider_physiology_profiles bruger table-RLS (select_authenticated USING(true)) — nye
-- kolonner er auto-læsbare for authenticated, INGEN per-kolonne-GRANT nødvendig (modsat
-- rider_derived_abilities/riders som bruger kolonne-privilegier, jf. #1162/#1309).
-- Idempotent: ADD COLUMN IF NOT EXISTS. schema_migrations-insert: auto-migrate.yml.

ALTER TABLE public.rider_physiology_profiles
  ADD COLUMN IF NOT EXISTS power_2m_wkg  NUMERIC(4,2),  -- anaerob/puncheur (Hills-loft)
  ADD COLUMN IF NOT EXISTS power_10m_wkg NUMERIC(4,2),  -- VO2/Mid-mountain (TMAP-anker)
  ADD COLUMN IF NOT EXISTS aero          NUMERIC(4,3);  -- 0.000-1.000 aerodynamisk effektivitet (TT/flad)

COMMENT ON COLUMN public.rider_physiology_profiles.power_5m_wkg IS
  'DEPRECERET (Plan 2, #1122): erstattet af vo2max_power_wkg (=MAP, kanonisk 5-min-anker). Beholdes nullable til cleanup-migration; læses ikke længere af abilityDerivation.';
COMMENT ON COLUMN public.rider_physiology_profiles.power_2m_wkg IS 'Plan 2 (#1122): 2-min power W/kg — punch/Hills-loft.';
COMMENT ON COLUMN public.rider_physiology_profiles.power_10m_wkg IS 'Plan 2 (#1122): 10-min power W/kg — tempo/Mid-mountain (TMAP).';
COMMENT ON COLUMN public.rider_physiology_profiles.aero IS 'Plan 2 (#1122): aerodynamisk effektivitet 0-1 — time_trial + flat.';

COMMENT ON COLUMN public.rider_derived_abilities.prolog IS
  'DEPRECERET (Plan 2, #1122): merged ind i time_trial (ITT-split inferes fra profil). Beholdes nullable til cleanup-migration; skrives ikke længere af abilityDerivation (formula_version=3).';

-- PostgREST schema-cache reload (GRANT/kolonne-ændringer trigges normalt af
-- pgrst_ddl_watch, men eksplicit NOTIFY koster intet og fjerner al tvivl).
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verificér idempotens lokalt (PGlite eller frisk Postgres)**

Kør migrationen 2× mod samme DB. Forventet: ingen fejl (alle `ADD COLUMN IF NOT EXISTS` + `COMMENT` er gen-kørbare). Bekræft kolonnerne findes: `SELECT column_name FROM information_schema.columns WHERE table_name='rider_physiology_profiles' AND column_name IN ('power_2m_wkg','power_10m_wkg','aero');` → 3 rækker.

- [ ] **Step 3: Commit** (migration alene — ingen kode læser de nye kolonner endnu)

```bash
git add database/2026-06-15-physiology-foundation-v2.sql
git commit -F .git/COMMIT_PLAN_A1.txt
```
`.git/COMMIT_PLAN_A1.txt`:
```
feat(db): physiology foundation v2 — +3 metrics, deprecate prolog/power_5m (#1122)

Adds power_2m_wkg/power_10m_wkg/aero (nullable) to rider_physiology_profiles;
deprecates power_5m_wkg + rider_derived_abilities.prolog via COMMENT (no drop —
reversible, owner-merges). MAP = vo2max_power_wkg (no rename).

Refs #1122 #1101
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

### Task A2: `archetypePhysiology.js` — arketype-skæv fysiologi-seeding

**Files:**
- Create: `backend/lib/archetypePhysiology.js`
- Test: `backend/lib/archetypePhysiology.test.js`

Designprincip (§0.1 Beslutning 4): physiology = `lerp(eliteLow, eliteHigh, clamp(tierBase + arketype-skew + gaussian-støj))` pr. metric. `tierBase` styrer det generelle niveau (superstar højt, domestique lavt); arketype-skew former HVILKE metrics der er høje (climber: aerob op, sprint-power ned). Reuse de validerede elite-ranges + monoton power-kurve fra `physiologySeeding.js`. Vægt (kg) kommer fra generatorens arketype-`bmi`×højde → en let climber med høj `ftp_wkg` får moderate absolutte watt; en tung rouleur får høje absolutte watt (w/kg-vs-watt-splittet falder gratis ud).

- [ ] **Step 1: Skriv den fejlende test**

Create `backend/lib/archetypePhysiology.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { makeRng } from "./fictionalRiderGenerator.js";
import { seedArchetypePhysiology, PHYSIOLOGY_ARCHETYPES } from "./archetypePhysiology.js";

const ctx = (archetype, over = {}) => ({
  archetype, tierLevel: 0.6, height_cm: 178, weight_kg: 68, rng: makeRng(123), ...over,
});

test("determinisme: samme arketype+tier+krop+seed → identisk profil", () => {
  const a = seedArchetypePhysiology(ctx("climber"));
  const b = seedArchetypePhysiology(ctx("climber"));
  assert.deepEqual(a, b);
});

test("alle 9 arketyper har en skew-profil", () => {
  for (const a of ["sprinter","leadout","tt","climber","puncheur","brostensrytter","baroudeur","rouleur","gc"]) {
    assert.ok(PHYSIOLOGY_ARCHETYPES[a], `mangler ${a}`);
  }
});

test("+3 nye metrics produceres (power_2m_wkg, power_10m_wkg, aero)", () => {
  const p = seedArchetypePhysiology(ctx("tt"));
  for (const k of ["power_2m_wkg","power_10m_wkg","aero"]) {
    assert.ok(Number.isFinite(p[k]), `${k} mangler/ikke-finit: ${p[k]}`);
  }
});

test("arketype-skew: climber har højere ftp_wkg + lavere pmax_watts end sprinter (samme krop+tier)", () => {
  const body = { height_cm: 178, weight_kg: 68, tierLevel: 0.6, rng: makeRng(7) };
  const climber = seedArchetypePhysiology({ archetype: "climber", ...body, rng: makeRng(7) });
  const sprinter = seedArchetypePhysiology({ archetype: "sprinter", ...body, rng: makeRng(7) });
  assert.ok(climber.ftp_wkg > sprinter.ftp_wkg, `climber ftp_wkg ${climber.ftp_wkg} ikke > sprinter ${sprinter.ftp_wkg}`);
  assert.ok(sprinter.pmax_watts > climber.pmax_watts, `sprinter pmax ${sprinter.pmax_watts} ikke > climber ${climber.pmax_watts}`);
});

test("monoton power-kurve: 5s ≥ 15s ≥ 1m ≥ 2m ≥ 5m ≥ 10m, og 5m ≥ ftp", () => {
  const p = seedArchetypePhysiology(ctx("puncheur"));
  assert.ok(p.power_5s_wkg >= p.power_15s_wkg - 1e-9);
  assert.ok(p.power_15s_wkg >= p.power_1m_wkg - 1e-9);
  assert.ok(p.power_1m_wkg >= p.power_2m_wkg - 1e-9);
  assert.ok(p.power_2m_wkg >= p.power_5m_wkg - 1e-9);
  assert.ok(p.power_5m_wkg >= p.power_10m_wkg - 1e-9);
  assert.ok(p.power_10m_wkg >= p.ftp_wkg - 1e-9);
});

test("tier-monotoni: højere tier → ikke-lavere ftp_wkg (alt andet lige)", () => {
  const lo = seedArchetypePhysiology(ctx("gc", { tierLevel: 0.2, rng: makeRng(9) }));
  const hi = seedArchetypePhysiology(ctx("gc", { tierLevel: 0.95, rng: makeRng(9) }));
  assert.ok(hi.ftp_wkg >= lo.ftp_wkg, `hi ${hi.ftp_wkg} < lo ${lo.ftp_wkg}`);
});
```

- [ ] **Step 2: Kør testen — verificér den fejler**

Kør (fra `backend/`): `node --test --import ./test-setup.js lib/archetypePhysiology.test.js`
Forventet: FAIL — `Cannot find module './archetypePhysiology.js'`.

- [ ] **Step 3: Skriv implementeringen**

Create `backend/lib/archetypePhysiology.js`:

```js
// Arketype-skæv fysiologi-seeding (Plan 2, #1122 — §0.1 Beslutning 4 "born-in
// specialisering"). Ren + deterministisk: samme (arketype, tier, krop, seed) →
// identisk profil. Ingen DB, ingen Math.random.
//
// Model: hver metric = lerp(eliteLow, eliteHigh, clamp01(tierBase + skew + støj)).
//   tierBase  styrer NIVEAUET (superstar ~0.9, domestique ~0.25).
//   skew      (PHYSIOLOGY_ARCHETYPES) former PROFILEN (hvilke metrics er høje).
//   støj      lille gaussian pr. metric (seeded), så ens arketyper ikke er kloner.
// Elite-ranges + monoton power-kurve genbrugt fra physiologySeeding.js (validerede
// mod prod). Vægt/højde kommer fra generatorens arketype (bmi×højde) → w/kg-vs-watt
// falder gratis ud (let climber = moderate watt; tung rouleur = høje watt).
//
// KOEFFICIENTERNE NEDENFOR ER KANDIDATER — tunes i race:gate-løkken (Task C1).

import { gaussian } from "./fictionalRiderGenerator.js";

export const PHYSIOLOGY_FORMULA_VERSION = 2; // rider_physiology_profiles.version for arketype-seedede

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const clamp01 = (n) => clamp(n, 0, 1);
const lerp = (lo, hi, t) => lo + (hi - lo) * clamp01(t);
const round = (x, dp) => { const f = 10 ** dp; return Math.round(x * f) / f; };

// Arketype-skew pr. metric-driver (additiv på tierBase-fraktionen, ~[-0.35,+0.35]).
// Drivere: aerob (ftp_wkg/vo2max/zone2/TTE), sprint_power (pmax/5s/15s),
// punch_power (1m/2m), vo2_ceiling (vo2max/10m), aero, durability (fatigue_res/HIE),
// recovery. Positiv = arketypens styrke; negativ = bevidst svaghed (specialisering ON).
export const PHYSIOLOGY_ARCHETYPES = Object.freeze({
  sprinter:       { aerob: -0.22, sprint_power: 0.32, punch_power: 0.06, vo2_ceiling: -0.18, aero: 0.06, durability: -0.05, recovery: 0.04 },
  leadout:        { aerob: -0.12, sprint_power: 0.22, punch_power: 0.04, vo2_ceiling: -0.10, aero: 0.14, durability: 0.06, recovery: 0.04 },
  tt:             { aerob: 0.16,  sprint_power: -0.20, punch_power: -0.10, vo2_ceiling: 0.04, aero: 0.30, durability: 0.12, recovery: 0.02 },
  climber:        { aerob: 0.30,  sprint_power: -0.30, punch_power: -0.04, vo2_ceiling: 0.24, aero: -0.10, durability: 0.06, recovery: 0.08 },
  puncheur:       { aerob: 0.04,  sprint_power: 0.02, punch_power: 0.30, vo2_ceiling: 0.16, aero: -0.06, durability: -0.10, recovery: 0.04 },
  brostensrytter: { aerob: 0.08,  sprint_power: 0.06, punch_power: 0.16, vo2_ceiling: -0.08, aero: 0.04, durability: 0.20, recovery: 0.02 },
  baroudeur:      { aerob: 0.12,  sprint_power: -0.06, punch_power: 0.06, vo2_ceiling: 0.06, aero: 0.02, durability: 0.22, recovery: 0.12 },
  rouleur:        { aerob: 0.10,  sprint_power: 0.00, punch_power: 0.00, vo2_ceiling: -0.04, aero: 0.24, durability: 0.12, recovery: 0.04 },
  gc:             { aerob: 0.26,  sprint_power: -0.26, punch_power: -0.02, vo2_ceiling: 0.22, aero: 0.06, durability: 0.16, recovery: 0.16 },
});

const SKEW_DEFAULT = Object.freeze({ aerob: 0, sprint_power: 0, punch_power: 0, vo2_ceiling: 0, aero: 0, durability: 0, recovery: 0 });

// Hver metric trækker på én eller flere drivere. f(driver) = clamp01(tierBase + skew + støj).
function buildFracs(tierLevel, skew, rng) {
  const noise = () => gaussian(rng, 0, 0.05); // lille seeded pr.-metric-støj
  const f = (driver) => clamp01(tierLevel + (skew[driver] ?? 0) + noise());
  return {
    aerob: f("aerob"),
    sprint_power: f("sprint_power"),
    punch_power: f("punch_power"),
    vo2_ceiling: f("vo2_ceiling"),
    aero: f("aero"),
    durability: f("durability"),
    recovery: f("recovery"),
  };
}

/**
 * @param {object} args
 *   archetype: en af PHYSIOLOGY_ARCHETYPES-nøglerne (generatorens _meta.archetype)
 *   tierLevel: 0..1 NIVEAU (superstar ~0.9 … domestique ~0.25) — sættes af generatoren
 *   height_cm, weight_kg: krops-snapshot (fra generatorens arketype-bmi×højde)
 *   rng: seeded mulberry32 (fra generatoren — IKKE en ny global)
 * @returns {object} upsert-klar physiology-profil (14 + 3 nye metrics), monoton power-kurve
 */
export function seedArchetypePhysiology({ archetype, tierLevel, height_cm, weight_kg, rng }) {
  const skew = PHYSIOLOGY_ARCHETYPES[archetype] ?? SKEW_DEFAULT;
  const fr = buildFracs(clamp01(tierLevel), skew, rng);
  const weight = round(clamp(Number(weight_kg) || 70, 45, 110), 2);
  const height = round(clamp(Number(height_cm) || 180, 150, 210), 2);

  // ── Sustained power (samme ranges som physiologySeeding.js) ────────────────
  const ftp_wkg = round(lerp(3.0, 6.8, 0.7 * fr.aerob + 0.3 * fr.durability), 2);
  const ftp_watts = Math.round(ftp_wkg * weight);
  // MAP = power ved VO2max (= vo2max_power_wkg). Loftes til ftp.
  const vo2max_power_wkg = round(Math.max(lerp(4.2, 7.5, 0.6 * fr.vo2_ceiling + 0.4 * fr.aerob), ftp_wkg), 2);
  const zone2_power_wkg = round(ftp_wkg * lerp(0.6, 0.75, fr.aerob), 2);

  // ── Short-duration / neuromuscular ─────────────────────────────────────────
  const pmax_watts = Math.round(lerp(14.0, 24.0, fr.sprint_power) * weight);
  let power_5s_wkg  = lerp(13.0, 22.0, fr.sprint_power);
  let power_15s_wkg = lerp(9.0, 17.0, 0.7 * fr.sprint_power + 0.3 * fr.recovery);
  let power_1m_wkg  = lerp(7.0, 11.5, 0.6 * fr.punch_power + 0.4 * fr.sprint_power);
  let power_2m_wkg  = lerp(6.0, 9.5, 0.6 * fr.punch_power + 0.4 * fr.vo2_ceiling);
  let power_5m_wkg  = lerp(5.0, 7.8, 0.6 * fr.vo2_ceiling + 0.4 * fr.aerob); // DEPRECERET (beholdt til kurve-kontinuitet)
  let power_10m_wkg = lerp(4.6, 7.0, 0.6 * fr.aerob + 0.4 * fr.vo2_ceiling);

  // Power-duration invariant: kortere varighed ⇒ mindst lige så høj W/kg (clamp NED
  // ad kæden; gulv 10m til ftp). Bevarer monotoni i hver driver.
  power_15s_wkg = Math.min(power_15s_wkg, power_5s_wkg);
  power_1m_wkg  = Math.min(power_1m_wkg, power_15s_wkg);
  power_2m_wkg  = Math.min(power_2m_wkg, power_1m_wkg);
  power_5m_wkg  = Math.min(power_5m_wkg, power_2m_wkg);
  power_10m_wkg = clamp(power_10m_wkg, ftp_wkg, power_5m_wkg); // ftp ≤ 10m ≤ 5m

  // ── Capacity / durability / aero ────────────────────────────────────────────
  const high_intensity_energy_kj   = round(lerp(10.0, 30.0, 0.6 * fr.durability + 0.4 * fr.punch_power), 1);
  const time_to_exhaustion_ftp_min = Math.round(lerp(30, 75, 0.6 * fr.aerob + 0.4 * fr.durability));
  const fatigue_resistance         = round(lerp(0.4, 0.95, 0.6 * fr.durability + 0.4 * fr.aerob), 3);
  const recovery_rate              = round(lerp(0.4, 0.95, 0.7 * fr.recovery + 0.3 * fr.durability), 3);
  const aero                       = round(lerp(0.4, 0.95, fr.aero), 3);

  return {
    ftp_wkg, ftp_watts, vo2max_power_wkg, zone2_power_wkg,
    pmax_watts,
    power_5s_wkg: round(power_5s_wkg, 2), power_15s_wkg: round(power_15s_wkg, 2),
    power_1m_wkg: round(power_1m_wkg, 2), power_2m_wkg: round(power_2m_wkg, 2),
    power_5m_wkg: round(power_5m_wkg, 2), power_10m_wkg: round(power_10m_wkg, 2),
    high_intensity_energy_kj, time_to_exhaustion_ftp_min, fatigue_resistance, recovery_rate,
    aero, height_cm: height, weight_kg: weight,
    source: "seeded_archetype", version: PHYSIOLOGY_FORMULA_VERSION,
  };
}
```

⚠️ **Note for the engineer:** `source: "seeded_archetype"` er IKKE i `rider_physiology_profiles.source` CHECK-constraint (`seeded_from_legacy/manual_admin/import/training_update`). Den bruges kun in-memory i dry-run. Ved prod-backfill (Task D2) map'es den til `'seeded_from_legacy'` ELLER constraint'en udvides i en migration. For dry-run/Phase A-C er det irrelevant (rører ikke DB).

- [ ] **Step 4: Kør testen — verificér den passerer**

Kør: `node --test --import ./test-setup.js lib/archetypePhysiology.test.js`
Forventet: PASS — 6/6. Hvis monoton-kurve-testen fejler for en arketype, er en lerp-range eller clamp-rækkefølge forkert — ret kurven, ikke testen.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/archetypePhysiology.js backend/lib/archetypePhysiology.test.js
git commit -F .git/COMMIT_PLAN_A2.txt
```
`.git/COMMIT_PLAN_A2.txt`:
```
feat(race): archetype-skewed physiology seeding (#1122)

Pure deterministic seedArchetypePhysiology — born-in specialisation per
archetype (climber: aerobic up/sprint-power down, etc.). Reuses the
validated elite ranges + monotonic power-curve. Candidate coefficients —
tuned in the gate loop. No DB, no engine change.

Refs #1122 #1101
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

### Task A3: Generatoren hænger fysiologi-profilen på hver rytter

**Files:**
- Modify: `backend/lib/fictionalRiderGenerator.js`
- Test: `backend/lib/fictionalRiderGenerator.test.js`

`riders`-INSERT-payloaden ændres IKKE (fysiologi går i separat tabel). Vi lægger profilen i `_meta.physiology` (audit/in-memory, fjernes af `toInsertPayload`). `tierLevel` ∈ [0,1] afledes af tier-rækkefølgen (superstar→0.92, star→0.75, solid→0.55, domestique→0.30).

- [ ] **Step 1: Skriv den fejlende test** — append til `backend/lib/fictionalRiderGenerator.test.js`:

```js
test("#1122 hver rytter får en arketype-konsistent _meta.physiology (deterministisk)", () => {
  const a = generateFictionalRiders({ seed: 2026, count: 60, referenceYear: 2026 });
  const b = generateFictionalRiders({ seed: 2026, count: 60, referenceYear: 2026 });
  assert.deepEqual(a.riders.map((r) => r._meta.physiology), b.riders.map((r) => r._meta.physiology));
  for (const r of a.riders) {
    assert.ok(r._meta.physiology && Number.isFinite(r._meta.physiology.ftp_wkg), `mangler physiology for ${r._meta.archetype}`);
    assert.ok(Number.isFinite(r._meta.physiology.aero), "mangler aero-metric");
  }
});

test("#1122 climber-arketyper har i snit højere ftp_wkg end sprinter-arketyper", () => {
  const { riders } = generateFictionalRiders({ seed: 2026, count: 800, referenceYear: 2026 });
  const avg = (type) => {
    const xs = riders.filter((r) => r._meta.archetype === type).map((r) => r._meta.physiology.ftp_wkg);
    return xs.reduce((s, x) => s + x, 0) / xs.length;
  };
  assert.ok(avg("climber") > avg("sprinter"), `climber ftp_wkg ${avg("climber").toFixed(2)} ikke > sprinter ${avg("sprinter").toFixed(2)}`);
});

test("#1122 _meta.physiology fjernes af toInsertPayload (ikke en riders-kolonne)", () => {
  const { riders } = generateFictionalRiders({ seed: 1, count: 5, referenceYear: 2026 });
  for (const row of toInsertPayload(riders)) {
    assert.ok(!("physiology" in row) && !("_meta" in row), "physiology/_meta lækkede ind i INSERT-payload");
  }
});
```

- [ ] **Step 2: Kør testen — verificér den fejler**

Kør: `node --test --import ./test-setup.js lib/fictionalRiderGenerator.test.js`
Forventet: FAIL — `r._meta.physiology` er `undefined`.

- [ ] **Step 3: Implementér** — i `fictionalRiderGenerator.js`:

(a) Tilføj import øverst (efter linje 15):
```js
import { seedArchetypePhysiology } from "./archetypePhysiology.js";
```

(b) Tilføj en tier→niveau-mapping ved siden af `TIERS` (efter linje 122):
```js
// Plan 2 (#1122): tier → fysiologi-NIVEAU (0..1) til arketype-skæv seeding.
// Spejler værdi-pyramiden: superstjerner kører tæt på elite-loftet.
const TIER_PHYSIOLOGY_LEVEL = { superstar: 0.92, star: 0.75, solid: 0.55, domestique: 0.30 };
```

(c) I `generateFictionalRiders`-løkken, efter `const demo = buildDemographics(...)` (linje 343), tilføj:
```js
    const physiology = seedArchetypePhysiology({
      archetype: archetype.type,
      tierLevel: TIER_PHYSIOLOGY_LEVEL[tier.value] ?? 0.5,
      height_cm: demo.height,
      weight_kg: demo.weight,
      rng, // samme seeded rng — forbruger deterministisk efter demografi
    });
```

(d) Tilføj `physiology` til `_meta` (linje 363):
```js
      _meta: { tier: tier.value, archetype: archetype.type, age: demo.age, cluster: clusterKey, physiology },
```

⚠️ **Rng-rækkefølge:** `seedArchetypePhysiology` forbruger rng-kald (gaussian-støj) EFTER `buildDemographics`. Det forskyder alle efterfølgende rytteres træk → ALLE eksisterende determinisme-snapshots (population-audit, evt. golden-tests) ændrer sig. Det er forventet (ny seeding-version). Opdatér/regenerér snapshot-baserede tests i Step 4.

- [ ] **Step 4: Kør tests** — generatorens fulde suite:

Kør: `node --test --import ./test-setup.js lib/fictionalRiderGenerator.test.js`
Forventet: de 3 nye PASS. Eksisterende tier-kvote/range-tests PASS (payloaden er uændret). Hvis en determinisme-/golden-test asserter eksakte stat-værdier på rytter N>0, vil den fejle pga. rng-forskydningen — opdatér forventningen til de nye værdier (det er en legitim seeding-version-ændring, ikke en regression). Kør også `fictionalLaunchPopulation.test.js` + `fictionalRiderGenerator.integration.test.js` og opdatér tilsvarende.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/fictionalRiderGenerator.js backend/lib/fictionalRiderGenerator.test.js backend/lib/fictionalLaunchPopulation.test.js
git commit -F .git/COMMIT_PLAN_A3.txt
```
`.git/COMMIT_PLAN_A3.txt`:
```
feat(race): generator attaches archetype physiology to each rider (#1122)

Each fictional rider gets a deterministic _meta.physiology (archetype-
skewed). riders INSERT payload unchanged (physiology lives in a separate
table). Snapshots shift due to rng consumption — expected seeding bump.

Refs #1122 #1101
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## PHASE B — Omskriv `abilityDerivation.js` (fysiologi → evne, prolog merged)

Nu skifter evnerne kilde. Dette flytter liveness/scorecard til RØD (forventet) indtil Phase C tuner det grønt.

### Task B1: `deriveAbilities` v3 — fysiologi-drevne fysiske evner + prolog-merge

**Files:**
- Modify: `backend/lib/abilityDerivation.js`
- Test: `backend/lib/abilityDerivation.test.js`

Mapping (§0.1 Beslutning 3, kandidat-koefficienter — tunes i Task C1):
- **Fysiske ← fysiologi:** sprint/acceleration ← pmax/5s/15s · punch ← 1m/2m · tempo ← MAP/10m/vo2 · climbing ← ftp_wkg + vo2-loft · time_trial ← ftp_watts + aero (prolog merged: ITT-split inferes, ingen separat evne) · flat ← ftp_watts + aero + endurance · endurance ← zone2/TTE/fatigue_resistance · recovery (seam) ← recovery_rate · durability (seam) ← fatigue_resistance + HIE.
- **Tekniske/mentale ← skill-stats (uændret kilde):** descending ← stat_ned · cobblestone ← stat_bro (+ lille durability) · positioning ← stat_fl/stat_ned/stat_ftr · aggression ← stat_ftr + ungdom · tactics ← erfaring + aggression.
- **hidden_potential** ← potentiale + ungdom + støj (uændret).
- **Fallback:** mangler fysiologi (PCM-ryttere uden profil / pre-v3) → behold v2's PCM-stat-derivation for de fysiske evner.

Normalisering: hver fysiologi-metric normaliseres til [0,1] mod et elite-anker-interval (genbrug `physiologySeeding.js`-ranges) før den vægtes. Definér ankrene som en `PHYS_ANCHORS`-konstant så de er ét sted at tune.

- [ ] **Step 1: Skriv de fejlende tests** — erstat de fysiologi-relevante dele af `abilityDerivation.test.js`. Tilføj/ændr:

```js
// Hjælper: en arketype-konsistent fysiologi-profil til tests.
import { seedArchetypePhysiology } from "./archetypePhysiology.js";
import { makeRng } from "./fictionalRiderGenerator.js";
const physFor = (archetype, tierLevel = 0.7) =>
  seedArchetypePhysiology({ archetype, tierLevel, height_cm: 178, weight_kg: 68, rng: makeRng(2026) });

test("#1122 v3: formula_version=3, 15 synlige evner, INGEN prolog", () => {
  const a = deriveAbilities(physFor("climber"), rider(60));
  assert.equal(a.formula_version, 3);
  assert.equal(FORMULA_VERSION, 3);
  assert.equal(VISIBLE_ABILITIES.length, 15);
  assert.ok(!("prolog" in a), "prolog skal være fjernet i v3");
  assert.ok(!VISIBLE_ABILITIES.includes("prolog"));
});

test("#1122 v3 determinisme: samme fysiologi+row → identisk output", () => {
  const phys = physFor("gc");
  assert.deepEqual(deriveAbilities(phys, rider(60)), deriveAbilities(phys, rider(60)));
});

test("#1122 v3 fysiologi-drevet specialisering: climber climbing ≫ sprint; sprinter omvendt", () => {
  const clb = deriveAbilities(physFor("climber"), rider(60));
  const spr = deriveAbilities(physFor("sprinter"), rider(60));
  assert.ok(clb.climbing - clb.sprint > 25, `climber climbing(${clb.climbing}) ikke ≫ sprint(${clb.sprint})`);
  assert.ok(spr.sprint - spr.climbing > 25, `sprinter sprint(${spr.sprint}) ikke ≫ climbing(${spr.climbing})`);
});

test("#1122 v3 VO2max-trekant: monster-aerob climber stærk på BÅDE tempo og climbing", () => {
  const clb = deriveAbilities(physFor("climber", 0.95), rider(60));
  assert.ok(clb.climbing > 70 && clb.tempo > 60, `climber climbing ${clb.climbing} / tempo ${clb.tempo} for lave for elite-aerob`);
});

test("#1122 v3 alle 15 evner + hidden ∈ [1,99]", () => {
  for (const arch of ["sprinter","tt","climber","gc","puncheur","rouleur","brostensrytter","baroudeur"]) {
    const a = deriveAbilities(physFor(arch), rider(60));
    for (const k of ALL_ABILITY_KEYS) assert.ok(Number.isInteger(a[k]) && a[k] >= 1 && a[k] <= 99, `${k}=${a[k]} (${arch})`);
  }
});

test("#1122 v3 tekniske/mentale evner følger stadig skill-stats (descending←stat_ned)", () => {
  const phys = physFor("baroudeur");
  const hi = deriveAbilities(phys, rider(55, { stat_ned: 84 }));
  const lo = deriveAbilities(phys, rider(55, { stat_ned: 52 }));
  assert.ok(hi.descending > lo.descending, "descending følger ikke stat_ned");
});

test("#1122 v3 fallback: uden fysiologi falder fysiske evner tilbage til PCM-stat-derivation", () => {
  const a = deriveAbilities({}, rider(85)); // ingen fysiologi → v2-fallback
  assert.equal(a.climbing, 99, `fallback climbing ved stat 85 = ${a.climbing}, forventet 99`);
  assert.ok(!("prolog" in a), "prolog skal være fjernet selv i fallback");
});
```

Fjern/justér de eksisterende v2-only tests der antager `prolog` eller PCM-50/85→1/99 for de FYSISKE evner *med fysiologi* (ankertest-blokken linje 44-65): behold dem KUN under fallback-stien (kald `deriveAbilities({}, rider(...))`). `VISIBLE_ABILITIES.length`-assertion: 16→15.

- [ ] **Step 2: Kør testen — verificér den fejler**

Kør: `node --test --import ./test-setup.js lib/abilityDerivation.test.js`
Forventet: FAIL — `formula_version` er 2, `prolog` findes stadig, fysiologi-drevet specialisering uindfriet.

- [ ] **Step 3: Implementér** — omskriv `backend/lib/abilityDerivation.js`:

(a) `FORMULA_VERSION = 3` (linje 21).

(b) `VISIBLE_ABILITIES` — fjern `prolog` (15 evner):
```js
export const VISIBLE_ABILITIES = Object.freeze([
  // Fysiske (10) — prolog merged ind i time_trial (§0.1 Beslutning 2)
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration",
  "punch", "endurance", "recovery", "durability",
  // Tekniske (3)
  "descending", "cobblestone", "positioning",
  // Taktisk/mentale (2)
  "aggression", "tactics",
]);
```

(c) Tilføj fysiologi-ankre + normaliserings-helper (efter `CALIBRATION`, ~linje 28). Ankrene = elite-ranges fra `physiologySeeding.js` (lav→evne~1, høj→evne~99). KANDIDATER — tunes i C1:
```js
// Fysiologi-ankre (§0.1 Beslutning 3) — [lav, høj] pr. metric → normaliseres [0,1].
// Lav = peloton-bund (≈evne 1), høj = elite-loft (≈evne 99). Tuning-flade (Task C1).
export const PHYS_ANCHORS = Object.freeze({
  ftp_wkg: [3.6, 6.6], vo2max_power_wkg: [4.6, 7.4], zone2_power_wkg: [2.3, 4.8],
  pmax_watts: [900, 1900], power_5s_wkg: [14, 21], power_15s_wkg: [10, 16.5],
  power_1m_wkg: [7.2, 11.2], power_2m_wkg: [6.2, 9.3], power_10m_wkg: [4.7, 6.9],
  high_intensity_energy_kj: [12, 28], time_to_exhaustion_ftp_min: [33, 72],
  fatigue_resistance: [0.45, 0.93], recovery_rate: [0.45, 0.93], aero: [0.45, 0.93],
});
const normPhys = (phys, key) => {
  const [lo, hi] = PHYS_ANCHORS[key];
  const v = Number(phys?.[key]);
  if (!Number.isFinite(v)) return 0;
  return clamp((v - lo) / (hi - lo), 0, 1);
};
const hasPhysiology = (phys) => phys && Number.isFinite(Number(phys.ftp_wkg));
```

(d) Omskriv selve `deriveAbilities` (linje 90-118). Fysiske evner fra fysiologi (med v2 PCM-fallback), tekniske/mentale uændret:
```js
export function deriveAbilities(physiology = {}, riderRow = {}, { asOfYear = CALIBRATION.asOfYear } = {}) {
  const age = ageFrom(riderRow.birthdate, asOfYear);
  const youth = clamp((32 - age) / (32 - 21), 0, 1);
  const experience = clamp((age - 20) / (31 - 20), 0, 1);
  const potRaw = Number(riderRow.potentiale);
  const potential = Number.isFinite(potRaw) ? clamp((potRaw - 1) / 5, 0, 1) : 0.4;

  const out = { rider_id: physiology.rider_id ?? riderRow.id, formula_version: FORMULA_VERSION };

  // ── Fysiske evner ← fysiologi (§0.1 Beslutning 3). KANDIDAT-vægte (Task C1). ──
  if (hasPhysiology(physiology)) {
    const P = (k) => normPhys(physiology, k);
    out.sprint       = scoreFrac(0.45 * P("pmax_watts") + 0.35 * P("power_5s_wkg") + 0.20 * P("power_15s_wkg"));
    out.acceleration = scoreFrac(0.60 * P("pmax_watts") + 0.40 * P("power_5s_wkg"));
    out.punch        = scoreFrac(0.55 * P("power_1m_wkg") + 0.45 * P("power_2m_wkg"));
    out.tempo        = scoreFrac(0.45 * P("vo2max_power_wkg") + 0.35 * P("power_10m_wkg") + 0.20 * P("zone2_power_wkg"));
    out.climbing     = scoreFrac(0.65 * P("ftp_wkg") + 0.35 * P("vo2max_power_wkg")); // VO2-loft
    out.time_trial   = scoreFrac(0.55 * P("ftp_wkg") + 0.30 * P("aero") + 0.15 * P("zone2_power_wkg"));
    out.flat         = scoreFrac(0.45 * P("ftp_wkg") + 0.30 * P("aero") + 0.25 * P("zone2_power_wkg"));
    out.endurance    = scoreFrac(0.40 * P("zone2_power_wkg") + 0.35 * P("time_to_exhaustion_ftp_min") + 0.25 * P("fatigue_resistance"));
    out.recovery     = scoreFrac(P("recovery_rate"));
    out.durability   = scoreFrac(0.65 * P("fatigue_resistance") + 0.35 * P("high_intensity_energy_kj"));
  } else {
    // Fallback (PCM-ryttere uden profil / pre-v3): v2 PCM-stat-derivation.
    out.sprint       = scoreFrac(pcmFrac(riderRow.stat_sp));
    out.acceleration = scoreFrac(pcmFrac(riderRow.stat_acc));
    out.punch        = scoreFrac(pcmFrac(riderRow.stat_bk));
    out.tempo        = scoreFrac(pcmFrac(riderRow.stat_kb));
    out.climbing     = scoreFrac(pcmFrac(riderRow.stat_bj));
    out.time_trial   = scoreFrac(Math.max(pcmFrac(riderRow.stat_tt), pcmFrac(riderRow.stat_prl))); // prolog merged
    out.flat         = scoreFrac(pcmFrac(riderRow.stat_fl));
    out.endurance    = scoreFrac(pcmFrac(riderRow.stat_udh));
    out.recovery     = scoreFrac(pcmFrac(riderRow.stat_res));
    out.durability   = scoreFrac(pcmFrac(riderRow.stat_mod));
  }

  // ── Tekniske/mentale ← skill-stats (skæv pr. arketype, §0.1 Beslutning 1) ────
  const aggressionFrac = 0.85 * pcmFrac(riderRow.stat_ftr) + 0.15 * youth;
  out.aggression  = scoreFrac(aggressionFrac);
  out.descending  = scoreFrac(pcmFrac(riderRow.stat_ned));
  out.cobblestone = scoreFrac(0.85 * pcmFrac(riderRow.stat_bro) + 0.15 * (out.durability / 99));
  out.positioning = scoreFrac(0.50 * pcmFrac(riderRow.stat_fl) + 0.30 * pcmFrac(riderRow.stat_ned) + 0.20 * pcmFrac(riderRow.stat_ftr));
  out.tactics     = scoreFrac(0.55 * experience + 0.45 * aggressionFrac);
  out.hidden_potential = scoreFrac(0.60 * potential + 0.25 * youth + 0.15 * hashNoise(riderRow.id ?? physiology.rider_id));

  return out;
}
```

(e) Behold `PRIMARY_STAT` (bruges af fallback + evt. eksterne) men fjern `prolog`-nøglen fra den (linje 51). Opdatér dens header-kommentar til at nævne fallback-rollen.

- [ ] **Step 4: Kør testen — verificér den passerer**

Kør: `node --test --import ./test-setup.js lib/abilityDerivation.test.js`
Forventet: alle PASS. Hvis VO2max-trekant-testen er rød: hæv climbings vo2-loft-vægt eller juster `PHYS_ANCHORS` — det er en kandidat-tuning, men her må strukturen bare være rigtig (eksakt kalibrering = C1).

- [ ] **Step 5: Verificér intet andet importerer `prolog`** — søg på tværs af repoet:

Kør: `git grep -n "prolog" -- backend/ frontend/src/`
Forventet: kun deprecerede/fallback-referencer + patch-notes. Ret enhver der antager `abilities.prolog` (fx en frontend-evne-liste, `riderTypes.js`-vægt, value-model-feature). **`riderTypes.js`/`riderTypesBaseline.json` rører vi ikke (Plan 3)** — men hvis baseline har en `prolog`-vægt der nu er `undefined`, verificér at `computeRiderTypes` ikke kaster (det skal degradere blødt; ellers wrap'es i Task C2). Notér fund.

- [ ] **Step 6: Commit**

```bash
git add backend/lib/abilityDerivation.js backend/lib/abilityDerivation.test.js
git commit -F .git/COMMIT_PLAN_B1.txt
```
`.git/COMMIT_PLAN_B1.txt`:
```
feat(race): abilityDerivation v3 — physiology-driven physical abilities (#1122)

Physical abilities now derive from physiology buckets (sprint←pmax,
climbing←ftp_wkg+VO2 ceiling, etc.); prolog merged into time_trial
(15 visible abilities). Technical/mental stay skill-stat-driven. PCM-stat
fallback when physiology absent. Candidate coefficients — tuned next.

Refs #1122 #1101
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

### Task B2: Fodr fysiologi ind i dry-run-harnessen

**Files:**
- Modify: `backend/scripts/simulateSeasonDryRun.js`

- [ ] **Step 1: Ændr felt-bygningen** (linje 250):

Erstat:
```js
  const abilities = deriveAbilities({}, { ...r, id }, { asOfYear: REFERENCE_YEAR });
```
med:
```js
  const abilities = deriveAbilities(r._meta?.physiology ?? {}, { ...r, id }, { asOfYear: REFERENCE_YEAR });
```

- [ ] **Step 2: Kør harnessen — fang RØD baseline**

Kør (fra `backend/`): `node scripts/simulateSeasonDryRun.js --no-html --seed=2026`
Forventet: kører uden at kaste. Sektion B born-as-scorecard er nu sandsynligvis RØDT på flere terræner (kandidat-koefficienter ikke kalibreret); sektion E liveness kan også vise afvigelser. **Dette er den forventede RØDE start for Phase C.** Notér de faktiske born-as-%'er pr. terræn (det er udgangspunktet for tuning).

Kør også `npm run race:gate` → forventet **exit 1** nu (targets/liveness ikke grønne). Det er forventet indtil C1.

- [ ] **Step 3: Commit** (RØD mellemtilstand — eksplicit dokumenteret)

```bash
git add backend/scripts/simulateSeasonDryRun.js
git commit -F .git/COMMIT_PLAN_B2.txt
```
`.git/COMMIT_PLAN_B2.txt`:
```
feat(race): dry-run derives abilities from archetype physiology (#1122)

Harness now feeds _meta.physiology into deriveAbilities. RED scorecard
state is expected here — calibrated to green in the next phase.

Refs #1122
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## PHASE C — Tune til scorecard grøn (RØD → GRØN)

Tuning-fladerne (i prioriteret rækkefølge): (1) `PHYSIOLOGY_ARCHETYPES`-skew (`archetypePhysiology.js`), (2) `PHYS_ANCHORS` + derivations-vægte (`abilityDerivation.js`), (3) — KUN hvis nødvendigt — `TIER_PHYSIOLOGY_LEVEL`. Vi rører IKKE motoren (`DEMAND_VECTORS`/`raceSimulator.js`) — den er Plan 1-kalibreret og frossen.

### Task C1: Iterér mod grøn born-as-gate på alle seeds

**Files:**
- Modify: `backend/lib/archetypePhysiology.js` (skew), `backend/lib/abilityDerivation.js` (ankre/vægte)

- [ ] **Step 1: Etablér mål** — det er Plan 1's eksisterende `TARGETS` (uændrede):
  - flat: sprinter ≥90% · itt: tt ≥60% · itt_tempo (terræn itt): tt+gc ≥95% · cobbles: brostensrytter ≥80% · hilly: puncheur ≥35% · mountain/high_mountain: gc+climber+baroudeur ≥85%.
  - PLUS liveness-gulvene (sektion E) + strukturelle oracles + udbruds-bånd skal forblive grønne.

- [ ] **Step 2: Tuning-løkke** — gentag indtil grøn:
  1. Kør `node scripts/simulateSeasonDryRun.js --no-html --seed=2026` og læs sektion B (born-as %) + "Motor belønner rigtig evne?" (vinder ⌀nøgle-evne vs median) + sektion E.
  2. Diagnosticér: for hvert RØDT terræn, hvilken evne mangler den born-as-type? (fx sprinter taber flad → en sprinters fysiologi giver for lav `sprint`/`flat`-evne → hæv `sprint_power`-skew for sprinter ELLER `pmax`/`power_5s`-vægten i `out.sprint`).
  3. Justér ÉN tuning-flade ad gangen (skew før vægte før anchors). Re-kør.
  4. **Loop-guard (memory + Plan 1-disciplin):** maks 2 justeringer på samme RØDE symptom uden fremgang → STOP, skriv diagnosen, og spørg ejeren (sandsynligvis en arketype-skew der kæmper mod en anden types neutral-fordel — som Plan 1's itt-population-binding).
  5. Verificér på seed 7 + 42 + `--condition=random` + `--roles` når 2026 er grøn.
- [ ] **Step 3: Hård verifikation** — `npm run race:gate` → **exit 0** på alle indbyggede seeds/modes.

Kør: `cd backend && npm run race:gate`
Forventet: exit 0; alle born-as-bånd ✓, liveness ✓, strukturelle oracles ✓, udbruds-bånd ✓.

⚠️ **Hvis et mål er population-bundet og ikke kan nås med skew/vægte alene** (Plan 1 fandt itt tt-plateau ~62% pga. gc-tunge tt-rouleurs): STOP og rapportér. Sænk IKKE et mål egenhændigt — det er en ejer-beslutning (interim-bånd findes allerede for itt/hilly). Det fulde itt-mål (tt 85%) kan kræve ITT-split-terrænerne (deferret) — dokumentér det som fund.

- [ ] **Step 4: Commit den grønne kalibrering**

```bash
git add backend/lib/archetypePhysiology.js backend/lib/abilityDerivation.js
git commit -F .git/COMMIT_PLAN_C1.txt
```
`.git/COMMIT_PLAN_C1.txt`:
```
feat(race): calibrate physiology→ability to green born-as gate (#1122)

Tuned PHYSIOLOGY_ARCHETYPES skew + derivation weights/anchors so born-as
win-shares hit Plan 1's scorecard on all seeds (2026/7/42 + condition +
roles). Engine + demand vectors untouched.

Refs #1122 #1101
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

### Task C2: Bump committet balance-baseline (GRØN) + verificér oracles

**Files:**
- Modify: `backend/lib/balanceSnapshot.js` (hvis snapshot-stien fodrer `{}` til deriveAbilities — ret til `_meta.physiology`)
- Modify (regen): `backend/scripts/baselines/balance-baseline.{json,md}`

- [ ] **Step 1: Verificér snapshot-stien bruger fysiologi** — i `balanceSnapshot.js`, find kaldet til `deriveAbilities` (rapporteret linje ~127) og sørg for det fodrer `r._meta?.physiology ?? {}` ligesom dry-run (Task B2). Hvis ikke, ret det.

- [ ] **Step 2: Regenerér baseline**

Kør (fra `backend/`): `npm run balance:baseline`
Forventet: `balance-baseline.{json,md}` opdateres — evne-fordelinger + `abilitySensitivity` afspejler den fysiologi-drevne v3. Diff'en er stor (forventet — evnerne har skiftet kilde). Verificér at `abilitySensitivity`-blokken stadig viser alle Plan 1-aktiverede evner > deres gulv (ingen evne genintroduceret som dødvægt).

- [ ] **Step 3: Verificér strukturelle oracles ikke false-fejler** — bekræft `npm run race:gate` exit 0 (sektion D strukturelle oracles inkl.). Hvis en oracle fejler pga. en degenereret afledt type/baseValue (Plan 3/4-staleness), vurdér: er det et ægte motor-problem eller en baseline-artefakt? Wrap kun hvis sidstnævnte, og dokumentér.

- [ ] **Step 4: Commit**

```bash
git add backend/lib/balanceSnapshot.js backend/scripts/baselines/balance-baseline.json backend/scripts/baselines/balance-baseline.md
git commit -F .git/COMMIT_PLAN_C2.txt
```
`.git/COMMIT_PLAN_C2.txt`:
```
chore(race): bump balance baseline to physiology-driven v3 (GREEN) (#1122)

Regenerated committed baseline after the physiology→ability rewrite +
calibration. Ability distributions + sensitivity reflect formula_version=3.

Refs #1122 #1197
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## PHASE D — Prod-pipeline + close-out

Gør prod-backfill-stien klar (ejeren kører den efter merge) + dokumentér + patch notes.

### Task D1: `previewDerivedAbilities.js` re-derives fra fysiologi

**Files:**
- Modify: `backend/scripts/previewDerivedAbilities.js`

- [ ] **Step 1:** Find kaldet `deriveAbilities({}, riderRow)` (rapporteret linje ~75). Hent rytterens fysiologi fra `rider_physiology_profiles` (join/lookup på `rider_id`) og fodr den ind: `deriveAbilities(physiologyByRiderId.get(r.id) ?? {}, riderRow)`. Skriv IKKE `prolog` i upsert-payloaden (kolonnen er nu deprecated/nullable). Verificér `--apply` ikke forsøger at sætte `prolog`.

- [ ] **Step 2:** Kør i dry-run-mode (uden `--apply`) mod en prod-klon eller PGlite-fixture hvis muligt; ellers verificér kode-stien med en unit-/smoke-test. Bekræft outputtet har 15 evner, ingen `prolog`.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/previewDerivedAbilities.js
git commit -F .git/COMMIT_PLAN_D1.txt
```
`.git/COMMIT_PLAN_D1.txt`:
```
feat(race): re-derive reads physiology, drops prolog write (#1122)

previewDerivedAbilities now feeds rider_physiology_profiles into
deriveAbilities (v3) and stops writing the deprecated prolog column.

Refs #1122
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

### Task D2: `backfillRacePhysiology.js` — arketype-fysiologi for fiktive ryttere

**Files:**
- Modify: `backend/scripts/backfillRacePhysiology.js`

- [ ] **Step 1:** Forgren på `pcm_id IS NULL` (fiktiv): brug `seedArchetypePhysiology` (arketype fra den lagrede type ELLER en re-klassifikation; tierLevel fra uci/popularity-bånd eller en lagret tier). PCM-ryttere (`pcm_id` sat): behold `seedPhysiologyFromLegacy` (uændret). Skriv de +3 nye metrics i begge stier (legacy-stien kan default'e `power_2m/10m/aero` fra eksisterende drivere — tilføj de 3 til `seedPhysiologyFromLegacy`s output i en lille følge-edit ELLER sæt dem nullable for PCM-ryttere indtil de re-seedes).

⚠️ **`source`-constraint:** `seedArchetypePhysiology` returnerer `source: "seeded_archetype"` som IKKE er i CHECK-constraint'en. Enten (a) map til `'seeded_from_legacy'` ved upsert, eller (b) tilføj `'seeded_archetype'` til constraint'en i en lille ALTER i migrationen (Task A1). Vælg (a) for minimal migration-overflade, eller (b) for korrekt provenance — anbefaling: (b), tilføj til Task A1's migration: `ALTER TABLE ... DROP CONSTRAINT ...source_check, ADD CONSTRAINT ... CHECK (source IN (...,'seeded_archetype'))`.

- [ ] **Step 2:** Verificér mod en prod-klon/fixture at backfill-payloaden er gyldig mod skemaet (alle NOT NULL-felter sat; +3 metrics udfyldt for fiktive). **Kør IKKE mod prod** — det er ejerens skridt efter merge.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/backfillRacePhysiology.js
git commit -F .git/COMMIT_PLAN_D2.txt
```

### Task D3: Patch notes + FEATURE_STATUS + kalibrerings-log

**Files:**
- Create: `docs/decisions/race-engine-v2-plan2-calibration-log.md`
- Modify: `frontend/src/pages/PatchNotesPage.jsx`
- Modify: `docs/FEATURE_STATUS.md`

- [ ] **Step 1: Skriv kalibrerings-loggen** — efter Plan 1's mønster: endelige `PHYSIOLOGY_ARCHETYPES`-skew + `PHYS_ANCHORS` + derivations-vægte (tabel), born-as-scorecard pr. seed (2026/7/42 + condition + roles), liveness-tal, og FUND (population-bindinger, deferrede mål).

- [ ] **Step 2: Patch notes** (`PatchNotesPage.jsx`) — ny version, bruger-synlig: "Rytter-evner afledes nu af en fuld fysiologi-model (FTP, VO2max/MAP, power-kurve, aero) — specialister er skarpere. Prolog er slået sammen med enkeltstart (time_trial)." EN-first, DA-second; ingen emoji/em-dash; følg tone-reglerne. Opdatér `help.json` (en+da) hvis evne-listen vises i hjælp (#1171) — eller skriv hvorfor ikke.

- [ ] **Step 3: FEATURE_STATUS** — opdatér evne-system-kontrakten: 15 synlige evner (ikke 16), fysiologi-drevet (`FORMULA_VERSION=3`), `prolog` deprecated.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/race-engine-v2-plan2-calibration-log.md frontend/src/pages/PatchNotesPage.jsx docs/FEATURE_STATUS.md frontend/public/locales/*/help.json
git commit -F .git/COMMIT_PLAN_D3.txt
```

### Task D4: Fuld CI-gate + PR

- [ ] **Step 1: Kør hele gate-sættet lokalt** (memory: full CI-gate før PR):
  - `cd backend && npm test` (alle backend-tests grønne)
  - `cd backend && npm run race:gate` (exit 0)
  - `cd backend && npm run balance:baseline` → `git diff --exit-code backend/scripts/baselines/` (ingen uventet diff)
  - Frontend kun rørt i PatchNotes/help → `cd frontend && node --test` + `npm run build` + i18n-leak + tone-em-dash + warning-budget. (Ingen visuel ændring → core-smoke-snapshots uændrede.)
- [ ] **Step 2: Push + opret PR** mod `main`. Label: IKKE `backend-only` (migration + bruger-synlig). PR-body: **Brugerverifikation-sektion** med `- [ ]`-punkter (evne-tal viser specialisering; prolog væk fra evne-visning; race:gate grøn). `Refs #1122 #1101`. **ALDRIG auto-merge** (database/*.sql) — eksplicit: "Ejer merger; migration auto-applies i prod."
- [ ] **Step 3:** Efter ejer-merge: ejeren kører prod-rækkefølgen (dokumentér i PR-body som runbook): apply migration (auto) → `backfillRacePhysiology.js` (re-seed fysiologi inkl. +3 metrics) → `previewDerivedAbilities.js --apply` (re-derive evner v3). Verificér en stikprøve i UI (evne-tal, ingen "permission denied", ingen prolog).

---

## Self-Review (writing-plans checklist)

**Spec-dækning (mod §0.1 + ejer-forks):**
- ✅ Migration +3 metrics (power_2m/10m/aero) + MAP=vo2max_power_wkg (no rename) + deprecér prolog/power_5m (drop-senere) → A1.
- ✅ Arketype-skæv fysiologi-seeding (Beslutning 4) → A2+A3.
- ✅ Omskriv abilityDerivation fysiologi→evne, prolog merged, 15 evner (Beslutning 2/3) → B1.
- ✅ Tune mod Plan 1's scorecard → C1+C2.
- ✅ Tekniske/mentale = skill-seeds (Beslutning 1), ikke fysiologi → B1.
- ✅ Defer terræn-typer + drop-senere (ejer-forks) → Non-goals + A1.
- ✅ Type-refit (Plan 3) + værdimodel/frontend (Plan 4) eksplicit ude.
- ✅ #1309 kolonne-privilegie-fælde adresseret (fysiologi=table-RLS; ingen ny læsbar kolonne på rider_derived_abilities).
- ✅ Prod-pipeline (backfill + re-derive) → D1+D2; ejer-merger + runbook → D4.

**Type-konsistens:** `seedArchetypePhysiology`/`PHYSIOLOGY_ARCHETYPES`/`PHYS_ANCHORS`/`normPhys`/`hasPhysiology`/`TIER_PHYSIOLOGY_LEVEL` brugt konsistent på tværs af A2/A3/B1. `FORMULA_VERSION=3` overalt. `VISIBLE_ABILITIES`=15 (ingen prolog) konsistent i B1 + tests.

**Kendte risici (flag til ejer):**
1. **Rng-forskydning** (A3) ændrer ALLE determinisme-snapshots → forventet seeding-version-bump, ikke regression. Snapshot-tests opdateres i A3 Step 4.
2. **Afledt type + baseValue bliver midlertidigt stale** (sektion A-rapport + evt. en strukturel oracle) indtil Plan 3/4. C2 Step 3 verificerer at ingen oracle false-fejler; ellers wrap+dokumentér.
3. **itt/hilly kan være population-bundne** (Plan 1-fund) — interim-bånd findes; fuldt mål kan kræve de deferrede ITT-split-terræner. C1 Step 3 stopper + rapporterer i stedet for at sænke mål egenhændigt.
4. **`source`-constraint** for arketype-seedet fysiologi (D2 Step 1) — vælg constraint-udvidelse (anbefalet) eller map-til-legacy.
