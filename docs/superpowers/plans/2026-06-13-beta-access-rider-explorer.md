# Beta-adgangssystem + Rider Explorer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giv ejer + en beta-tester-kohorte tidlig adgang til flag-styrede beta-funktioner (academy/training/race) uden at eksponere dem for alle spillere, plus en read-only admin-side der viser de 800 fiktive relaunch-ryttere til indholds-feedback.

**Architecture:** Tre-tilstands feature-flags (`off`/`beta`/`on`) i `app_config` + en `is_beta_tester`-kohorte på `users`, evalueret per-request. Frontend kræver INGEN ændring for adgang (gating sker allerede via `enabled`-feltet endpoints returnerer). Rider Explorer genbruger den eksisterende deterministiske værdi-kæde via en delt builder, eksponeret gennem et admin-endpoint og en admin-side der spejler `ValuationPreviewSection.jsx`.

**Tech Stack:** Node.js + Express (backend, ESM, `node --test`), Supabase Postgres (RLS, RPC), React + Vite (frontend), Tailwind (`cz-*` tokens).

**Spec:** `docs/superpowers/specs/2026-06-13-beta-access-rider-explorer-design.md`

---

## File Structure

| Fil | Ansvar | Create/Modify |
|-----|--------|---------------|
| `database/2026-06-13-beta-access.sql` | Migration: `users.is_beta_tester`, `is_beta_tester()` RPC, tri-state flag-seed | Create |
| `backend/lib/featureStage.js` | `readFlagStage()` + `evaluateFlagStage()` — eneste flag-læse/evaluerings-logik | Create |
| `backend/lib/featureStage.test.js` | Tests for evaluering + læsning | Create |
| `backend/lib/academyFlag.js` | Refactor til `readFlagStage`+`evaluateFlagStage` + `{ isBetaTester }`-opt | Modify |
| `backend/lib/dailyTrainingFlag.js` | Samme refactor | Modify |
| `backend/lib/raceEngineFlag.js` | Samme refactor | Modify |
| `backend/lib/*Flag.test.js` | Tilføj `"beta"`-stage-cases | Modify |
| `backend/routes/api.js` | `isViewerBetaTester(req)`-helper + wiring i bruger-endpoints + Rider Explorer-endpoint | Modify |
| `backend/lib/adminSimulateRace.js` | Pass `{ isBetaTester: true }` (admin-only sti) | Modify |
| `backend/lib/fictionalPopulationPreview.js` | Delt builder: generator→abilities→typer→base_value (ingen DB) | Create |
| `backend/lib/fictionalPopulationPreview.test.js` | Builder-tests | Create |
| `backend/scripts/previewFictionalPopulation.js` | Refactor til at bruge builderen (DRY) | Modify |
| `frontend/src/components/admin/RiderExplorerSection.jsx` | Admin-side: sorterbar/filtrerbar 800-rytter-tabel | Create |
| `frontend/src/pages/admin/AdminDataTab.jsx` | Mount `<RiderExplorerSection>` | Modify |

**Rækkefølge:** Enhed A (Task 1-4) → Enhed B (Task 5-7) → Verifikation (Task 8). Migration (Task 1) merges af ejer.

---

## Enhed A — Beta-adgangssystem

### Task 1: Migration — kohorte + RPC + tri-state flags

**Files:**
- Create: `database/2026-06-13-beta-access.sql`

- [ ] **Step 1: Skriv migrationen**

```sql
-- Beta-adgangssystem (#1105-enabler): tester-kohorte + tre-tilstands feature-flags.
-- Idempotent. Spejler is_admin()-mønstret (2026-05-15-founder-supporter-waitlist.sql).
--
-- Rollback:
--   ALTER TABLE public.users DROP COLUMN IF EXISTS is_beta_tester;
--   DROP FUNCTION IF EXISTS public.is_beta_tester();

-- 1. Kohorte-medlemskab på users.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_beta_tester boolean NOT NULL DEFAULT false;

-- 2. Helper: is_beta_tester() — admins er implicit beta. Spejler is_admin().
CREATE OR REPLACE FUNCTION public.is_beta_tester()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' OR is_beta_tester FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_beta_tester() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_beta_tester() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.is_beta_tester() IS
  'True hvis auth.uid() er admin ELLER users.is_beta_tester. Stable + SECURITY DEFINER, spejler is_admin().';

-- 3. Tre-tilstands feature-flags: "off" | "beta" | "on". Sikrer rækker findes (off).
--    Bagudkompat i koden: boolean true/false læses stadig som on/off, så eksisterende
--    rækker (hvis boolean) virker uændret; ejer sætter beta via UPDATE ... '"beta"'.
INSERT INTO public.app_config (key, value, description) VALUES
  ('academy_enabled',        '"off"'::jsonb, 'Akademi (#1308). off|beta|on. beta = beta-testere + admins.'),
  ('daily_training_enabled', '"off"'::jsonb, 'Daglig træning (#1305). off|beta|on.'),
  ('race_engine_v2_enabled', '"off"'::jsonb, 'Race engine v2 (#1102). off|beta|on.')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Commit (ingen automatisk test — verificeres mod prod-klon ved review)**

```bash
git add database/2026-06-13-beta-access.sql
git commit -m "feat(db): beta-access — is_beta_tester kohorte + RPC + tri-state flags"
```

> **VERIFIKATION (ejer/review):** mod en prod-klon: `SELECT public.is_beta_tester();` som (a) admin → true, (b) bruger m. is_beta_tester=true → true, (c) normal bruger → false. Migration auto-applies ved merge → **ejer merger PR'en**.

---

### Task 2: `featureStage.js` — delt læsning + evaluering (TDD)

**Files:**
- Create: `backend/lib/featureStage.js`
- Test: `backend/lib/featureStage.test.js`

- [ ] **Step 1: Skriv den fejlende test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFlagStage, readFlagStage } from "./featureStage.js";

test("evaluateFlagStage: on/true → alle", () => {
  assert.equal(evaluateFlagStage("on"), true);
  assert.equal(evaluateFlagStage(true), true);
  assert.equal(evaluateFlagStage("on", { isBetaTester: false }), true);
});

test("evaluateFlagStage: beta → kun beta-testere", () => {
  assert.equal(evaluateFlagStage("beta", { isBetaTester: true }), true);
  assert.equal(evaluateFlagStage("beta", { isBetaTester: false }), false);
  assert.equal(evaluateFlagStage("beta"), false);
});

test("evaluateFlagStage: off/false/ukendt → ingen", () => {
  for (const v of ["off", false, null, undefined, "garbage"]) {
    assert.equal(evaluateFlagStage(v, { isBetaTester: true }), false, `v=${v}`);
  }
});

test("readFlagStage: fail-safe null + happy path", async () => {
  assert.equal(await readFlagStage(null, "k"), null);
  const errClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) };
  assert.equal(await readFlagStage(errClient, "k"), null);
  const onClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "beta" }, error: null }) }) }) }) };
  assert.equal(await readFlagStage(onClient, "k"), "beta");
});
```

- [ ] **Step 2: Kør testen — forvent FAIL**

Run: `node --test backend/lib/featureStage.test.js`
Expected: FAIL (`Cannot find module './featureStage.js'`)

- [ ] **Step 3: Skriv implementeringen**

```js
// Eneste sted flag-stage læses + evalueres. Tre-tilstand: "off" | "beta" | "on".
// Bagudkompatibel: boolean true/false fra gammelt skema honoreres som on/off.
// Fail-safe: manglende/ukendt værdi eller fejl → ingen adgang.

export async function readFlagStage(supabase, key) {
  if (!supabase?.from) return null;
  try {
    const { data, error } = await supabase
      .from("app_config").select("value").eq("key", key).maybeSingle();
    if (error) return null;
    return data?.value ?? null; // boolean | "off"|"beta"|"on" | null
  } catch {
    return null;
  }
}

export function evaluateFlagStage(value, { isBetaTester = false } = {}) {
  if (value === true || value === "on") return true;
  if (value === "beta") return isBetaTester === true;
  return false;
}
```

- [ ] **Step 4: Kør testen — forvent PASS**

Run: `node --test backend/lib/featureStage.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/featureStage.js backend/lib/featureStage.test.js
git commit -m "feat(flags): featureStage — readFlagStage + tri-state evaluateFlagStage"
```

---

### Task 3: Refactor de 3 flag-funktioner til delt logik + `{ isBetaTester }`

**Files:**
- Modify: `backend/lib/academyFlag.js`, `backend/lib/dailyTrainingFlag.js`, `backend/lib/raceEngineFlag.js`
- Test: `backend/lib/academyFlag.test.js`, `backend/lib/dailyTrainingFlag.test.js`, `backend/lib/raceRunner.test.js`

- [ ] **Step 1: Tilføj beta-stage-tests (fejler indtil refactor)**

I `backend/lib/dailyTrainingFlag.test.js` tilføj:

```js
test("isDailyTrainingEnabled: beta-stage kun for beta-testere", async () => {
  const betaClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "beta" }, error: null }) }) }) }) };
  assert.equal(await isDailyTrainingEnabled(betaClient, { isBetaTester: true }), true);
  assert.equal(await isDailyTrainingEnabled(betaClient, { isBetaTester: false }), false);
  assert.equal(await isDailyTrainingEnabled(betaClient), false);
});
```

I `backend/lib/academyFlag.test.js` tilføj den tilsvarende (skift funktionsnavn til `isAcademyEnabled`). I `backend/lib/raceRunner.test.js` (som tester `isRaceEngineV2Enabled`) tilføj tilsvarende med `makeSupabase({ app_config: [{ value: "beta" }] })`.

- [ ] **Step 2: Kør — forvent FAIL** (gammel kode returnerer `value === true` → false for "beta")

Run: `node --test backend/lib/dailyTrainingFlag.test.js`
Expected: FAIL på den nye beta-test.

- [ ] **Step 3: Refactor de 3 funktioner**

`backend/lib/dailyTrainingFlag.js` — erstat funktions-body:

```js
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const DAILY_TRAINING_FLAG_KEY = "daily_training_enabled";

export async function isDailyTrainingEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, DAILY_TRAINING_FLAG_KEY), opts);
}
```

`backend/lib/raceEngineFlag.js` — samme mønster med `RACE_ENGINE_V2_FLAG_KEY`.

`backend/lib/academyFlag.js` — behold `ACADEMY`-konstanter + `isAcademyAge`/`youthMultiplier` uændret; erstat KUN `isAcademyEnabled`:

```js
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
// ... ACADEMY, isAcademyAge, youthMultiplier uændret ...
export async function isAcademyEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, ACADEMY.FLAG_KEY), opts);
}
```

- [ ] **Step 4: Kør alle berørte tests — forvent PASS** (eksisterende `value:true`-tests består uændret, da `true` → on)

Run: `node --test backend/lib/academyFlag.test.js backend/lib/dailyTrainingFlag.test.js backend/lib/raceRunner.test.js`
Expected: PASS (inkl. nye beta-cases + uændrede fail-safe-cases)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/academyFlag.js backend/lib/dailyTrainingFlag.js backend/lib/raceEngineFlag.js backend/lib/academyFlag.test.js backend/lib/dailyTrainingFlag.test.js backend/lib/raceRunner.test.js
git commit -m "refactor(flags): flag-fns bruger featureStage + accepterer isBetaTester-opt"
```

---

### Task 4: `isViewerBetaTester` + wiring i bruger-endpoints

**Files:**
- Modify: `backend/routes/api.js`
- Modify: `backend/lib/adminSimulateRace.js`

- [ ] **Step 1: Tilføj `isViewerBetaTester`-helper**

I `backend/routes/api.js`, lige efter `isViewerAdmin` (omkr. linje 510):

```js
// Beta-status for den aktuelle viewer (admin ELLER users.is_beta_tester). Bruges
// til at gate beta-funktioner per-bruger uden at eksponere dem for alle. Spejler
// isViewerAdmin. Ét opslag pr. request — beregn én gang og send til flag-kald.
async function isViewerBetaTester(req) {
  if (!req.user?.id) return false;
  const { data: u } = await supabase
    .from("users")
    .select("role, is_beta_tester")
    .eq("id", req.user.id)
    .single();
  return u?.role === "admin" || u?.is_beta_tester === true;
}
```

- [ ] **Step 2: Importér featureStage-helpers øverst i api.js**

Tilføj ved de øvrige flag-imports (omkr. linje 114-121):

```js
import { readFlagStage, evaluateFlagStage } from "../lib/featureStage.js";
```

- [ ] **Step 3: Wire academy-action-endpoints (4 steder)**

I HVER af `GET /api/academy/me` (~7930), `POST /api/academy/sign` (~8058), `POST /api/academy/reject` (~8093), `POST /api/academy/free-agent/sign` (~8118): erstat

```js
const enabled = await isAcademyEnabled(supabase);
```

med

```js
const isBetaTester = await isViewerBetaTester(req);
const enabled = await isAcademyEnabled(supabase, { isBetaTester });
```

(Bekræft med `grep -n "isAcademyEnabled(supabase)" backend/routes/api.js` at alle 4 er ramt — der må ikke være `isAcademyEnabled(supabase)` uden opts tilbage i api.js.)

- [ ] **Step 4: Wire training-endpoints**

`POST /api/training/run-today` (~1159): erstat `const enabled = await isDailyTrainingEnabled(supabase);` med:

```js
const isBetaTester = await isViewerBetaTester(req);
const enabled = await isDailyTrainingEnabled(supabase, { isBetaTester });
```

`GET /api/training/me` (~1028): i `Promise.all`, erstat `isDailyTrainingEnabled(supabase)` med beta+stage og udled enabled:

```js
const [{ activeSeasonId, state }, isBetaTester, stage] = await Promise.all([
  loadTrainingState(teamId),
  isViewerBetaTester(req),
  readFlagStage(supabase, DAILY_TRAINING_FLAG_KEY),
]);
const enabled = evaluateFlagStage(stage, { isBetaTester });
```

I `res.json({ ... })` for dette endpoint: behold `enabled`, og tilføj `betaTester: isBetaTester` (sætter data til en fremtidig "Beta"-badge; ingen frontend-ændring nu).

- [ ] **Step 5: Wire race-selection-endpoints**

`GET /api/races/:raceId/selection` (~1191): erstat `const enabled = await isRaceEngineV2Enabled(supabase);` med:

```js
const isBetaTester = await isViewerBetaTester(req);
const enabled = evaluateFlagStage(await readFlagStage(supabase, RACE_ENGINE_V2_FLAG_KEY), { isBetaTester });
```

`PUT /api/races/:raceId/selection` (~1213): erstat med:

```js
const isBetaTester = await isViewerBetaTester(req);
const enabled = await isRaceEngineV2Enabled(supabase, { isBetaTester });
```

- [ ] **Step 6: Admin-race-sim skal honorere beta-stage (admin-only sti)**

I `backend/lib/adminSimulateRace.js` (linje ~22 og ~107): erstat begge `isRaceEngineV2Enabled(supabase)` med:

```js
// Admin-only sti (requireAdmin): admins er implicit beta → beta-stage tæller som ON.
isRaceEngineV2Enabled(supabase, { isBetaTester: true })
```

- [ ] **Step 7: LAD system/cron-kald være globale (rør IKKE)**

Bekræft at disse forbliver UDEN opts (kun `"on"` aktiverer dem — et beta-flag må aldrig trigge en populations-sweep):
- `backend/lib/trainingSweep.js:60`
- `backend/lib/riderProgressionEngine.js:88`
- `backend/lib/relaunchOrchestrator.js:136`

- [ ] **Step 8: Kør backend-tests + start server lokalt for at fange import-fejl**

Run: `node --test backend/` (eller `pwsh -File scripts/verify-local.ps1`)
Expected: PASS. Ingen `isAcademyEnabled(supabase)` uden opts tilbage (manuel grep-tjek).

- [ ] **Step 9: Commit**

```bash
git add backend/routes/api.js backend/lib/adminSimulateRace.js
git commit -m "feat(flags): per-bruger beta-gating i academy/training/race-endpoints"
```

---

## Enhed B — Rider Explorer

### Task 5: Delt preview-builder (TDD) + script-refactor

**Files:**
- Create: `backend/lib/fictionalPopulationPreview.js`
- Test: `backend/lib/fictionalPopulationPreview.test.js`
- Modify: `backend/scripts/previewFictionalPopulation.js`

- [ ] **Step 1: Skriv den fejlende test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFictionalPopulationPreview } from "./fictionalPopulationPreview.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "riderValuationModel.json"), "utf8"));

test("buildFictionalPopulationPreview: antal, felter, deterministisk", () => {
  const a = buildFictionalPopulationPreview({ count: 50, seed: 2026, baseline, model });
  assert.equal(a.riders.length, 50);
  const r = a.riders[0];
  for (const k of ["name", "age", "nationality_code", "primary_type", "secondary_type", "abilities", "base_value"]) {
    assert.ok(k in r, `mangler felt ${k}`);
  }
  assert.equal(typeof r.base_value, "number");
  assert.ok(r.base_value > 0);
  assert.equal(typeof r.abilities.climbing, "number");
  const b = buildFictionalPopulationPreview({ count: 50, seed: 2026, baseline, model });
  assert.deepEqual(a.riders.map((x) => x.base_value), b.riders.map((x) => x.base_value));
});

test("buildFictionalPopulationPreview: kræver baseline + model", () => {
  assert.throws(() => buildFictionalPopulationPreview({ count: 5 }));
});
```

- [ ] **Step 2: Kør — forvent FAIL** (`Cannot find module`)

Run: `node --test backend/lib/fictionalPopulationPreview.test.js`
Expected: FAIL

- [ ] **Step 3: Skriv builderen** (samme kæde som previewFictionalPopulation.js l.52-66)

```js
// Delt builder: kør den fiktive launch-population gennem HELE værdi-kæden
// (generator → abilities → typer → base_value) UDEN at røre DB. Brugt af
// preview-scriptet OG admin Rider Explorer-endpointet (#1364-enabler).
import { generateFictionalRiders } from "./fictionalRiderGenerator.js";
import { deriveAbilities } from "./abilityDerivation.js";
import { computeRiderTypes } from "./riderTypes.js";
import { predictBaseValue } from "./riderValuation.js";
import { LAUNCH_POPULATION } from "./fictionalLaunchPopulation.js";

export function buildFictionalPopulationPreview({
  count = LAUNCH_POPULATION.count,
  seed = 2026,
  referenceYear = 2026,
  baseline,
  model,
} = {}) {
  if (!baseline || !model) {
    throw new Error("buildFictionalPopulationPreview kræver baseline + model");
  }
  const { riders, coverage } = generateFictionalRiders({ seed, count, referenceYear });
  const rows = riders.map((r, i) => {
    const id = `fic-${seed}-${i}`;
    const riderRow = { ...r, id };
    const abilities = deriveAbilities({}, riderRow, { asOfYear: referenceYear });
    const { primary, secondary } = computeRiderTypes(abilities, baseline);
    const withType = { ...riderRow, primary_type: primary.key, secondary_type: secondary.key };
    const base_value = predictBaseValue(withType, abilities, model);
    return {
      id,
      firstname: r.firstname,
      lastname: r.lastname,
      name: `${r.firstname} ${r.lastname}`,
      age: r._meta?.age ?? null,
      tier: r._meta?.tier ?? null,
      nationality_code: r.nationality_code,
      primary_type: primary.key,
      secondary_type: secondary.key,
      abilities,
      base_value,
      _meta: r._meta,
    };
  });
  return { riders: rows, coverage };
}
```

- [ ] **Step 4: Kør — forvent PASS**

Run: `node --test backend/lib/fictionalPopulationPreview.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Refactor scriptet til at bruge builderen (DRY)**

I `backend/scripts/previewFictionalPopulation.js`: erstat genererings-/map-blokken (nuværende l.51-66, dvs. `generateFictionalRiders(...)` + `const rows = riders.map(...)`) med:

```js
import { buildFictionalPopulationPreview } from "../lib/fictionalPopulationPreview.js";
// ... i main():
const { riders: rows, coverage } = buildFictionalPopulationPreview({
  count: COUNT, seed: SEED, referenceYear: REFERENCE_YEAR, baseline, model,
});
```

Resten af scriptet (rapportering) er uændret — `rows` har stadig `_meta`, `firstname`, `primary_type`, `secondary_type`, `abilities`, `base_value`. Fjern de nu-ubrugte direkte imports af `generateFictionalRiders`/`deriveAbilities`/`computeRiderTypes`/`predictBaseValue` hvis de ikke bruges andre steder i filen.

- [ ] **Step 6: Kør scriptet — forvent uændret output + exit 0**

Run: `node backend/scripts/previewFictionalPopulation.js --count=800 --seed=2026`
Expected: Samme pyramide-bånd + "✅ Type-mix-oracle ... holder." + exit 0.

- [ ] **Step 7: Commit**

```bash
git add backend/lib/fictionalPopulationPreview.js backend/lib/fictionalPopulationPreview.test.js backend/scripts/previewFictionalPopulation.js
git commit -m "feat(riders): delt fictionalPopulationPreview-builder + DRY preview-script"
```

---

### Task 6: Admin-endpoint `GET /api/admin/fictional-rider-preview`

**Files:**
- Modify: `backend/routes/api.js`

- [ ] **Step 1: Load baseline ved siden af VALUATION_MODEL**

Find hvor `VALUATION_MODEL` loades i api.js (`grep -n "VALUATION_MODEL =" backend/routes/api.js`). Tilføj en parallel load af baseline lige under, med samme `readFileSync`/sti-mønster:

```js
const RIDER_TYPES_BASELINE = JSON.parse(
  readFileSync(new URL("../lib/riderTypesBaseline.json", import.meta.url), "utf8")
);
```

(Hvis VALUATION_MODEL bruger en anden sti-konstruktion, spejl den nøjagtigt.)

- [ ] **Step 2: Tilføj endpointet** (placér lige efter `/admin/rider-valuation-preview`, ~linje 3824)

```js
import { buildFictionalPopulationPreview } from "../lib/fictionalPopulationPreview.js";

// GET /api/admin/fictional-rider-preview — read-only preview af de 800 fiktive
// relaunch-ryttere kørt gennem hele værdi-kæden. Rører INTET i DB. (#1364-enabler)
router.get("/admin/fictional-rider-preview", requireAdmin, async (req, res) => {
  if (!VALUATION_MODEL) return res.status(503).json({ error: "Valuation model not fitted yet" });
  try {
    const { riders } = buildFictionalPopulationPreview({
      baseline: RIDER_TYPES_BASELINE,
      model: VALUATION_MODEL,
    });
    const values = riders.map((r) => r.base_value).sort((a, b) => a - b);
    const pctile = (p) => (values.length ? values[Math.min(values.length - 1, Math.floor(p * values.length))] : null);
    res.json({
      count: riders.length,
      distribution: { p10: pctile(0.1), median: pctile(0.5), p90: pctile(0.9), max: values.length ? values[values.length - 1] : null },
      riders,
    });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Verificér lokalt med admin-token**

Start backend lokalt. Som admin-bruger:
Run: `curl -s -H "Authorization: Bearer <ADMIN_JWT>" "$VITE_API_URL/api/admin/fictional-rider-preview" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('count',j.count,'median',j.distribution.median,'first',j.riders[0].name,j.riders[0].primary_type,j.riders[0].base_value)})"`
Expected: `count 800`, et rimeligt median-tal, og en navngiven rytter m. type + base_value. Uden admin → HTTP 403.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/api.js
git commit -m "feat(admin): fictional-rider-preview endpoint (read-only, 800 ryttere)"
```

---

### Task 7: Frontend Rider Explorer-side

**Files:**
- Create: `frontend/src/components/admin/RiderExplorerSection.jsx`
- Modify: `frontend/src/pages/admin/AdminDataTab.jsx`

> Admin-only flade → **ingen i18n** (følger `ValuationPreviewSection.jsx`-konventionen).

- [ ] **Step 1: Skriv `RiderExplorerSection.jsx`** (spejler ValuationPreviewSection: getAuth/onMsg-props, fetch, sort, filter, paginering)

```jsx
import { useState, useEffect, useMemo } from "react";
import { readAdminJson, adminErrorMessage } from "./shared/useAdminAuth";

const API = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 50;
const ABIL_COLS = ["climbing", "time_trial", "sprint", "endurance"];
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));

export default function RiderExplorerSection({ getAuth, onMsg }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sort, setSort] = useState({ key: "base_value", dir: "desc" });
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/fictional-rider-preview`, { headers: await getAuth() });
      const json = await readAdminJson(res);
      if (res.ok) setData(json);
      else onMsg?.(`❌ ${adminErrorMessage(json, res)}`, "error");
    } catch (e) {
      onMsg?.(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const types = useMemo(() => {
    if (!data?.riders) return [];
    return [...new Set(data.riders.map((r) => r.primary_type))].sort();
  }, [data]);

  const rows = useMemo(() => {
    if (!data?.riders) return [];
    const q = search.trim().toLowerCase();
    let r = data.riders;
    if (q) r = r.filter((x) => x.name.toLowerCase().includes(q));
    if (typeFilter) r = r.filter((x) => x.primary_type === typeFilter);
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    const val = (x) => (ABIL_COLS.includes(key) ? x.abilities?.[key] : x[key]);
    r = [...r].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === "string") return av.localeCompare(bv) * mul;
      return ((av ?? 0) - (bv ?? 0)) * mul;
    });
    return r;
  }, [data, search, typeFilter, sort]);

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
    setPage(1);
  }

  if (loading && !data) return <p className="text-cz-3 text-xs">Henter forhåndsvisning…</p>;
  if (!data) return (
    <button onClick={load} className="px-3 py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-xs hover:text-cz-1">
      Indlæs forhåndsvisning
    </button>
  );
  const d = data.distribution;

  return (
    <div className="space-y-4">
      <div className="bg-cz-subtle border border-cz-border rounded-lg px-4 py-3 text-xs">
        <p className="text-cz-2 font-semibold mb-1">Fiktiv launch-population — {data.count.toLocaleString("da-DK")} ryttere (preview, rører intet)</p>
        <p className="text-cz-3">base_value CZ$ · p10 {fmt(d.p10)} · median {fmt(d.median)} · p90 {fmt(d.p90)} · max {fmt(d.max)}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Søg rytter…"
          className="w-full sm:w-56 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none"
        />
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm"
        >
          <option value="">Alle typer</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-cz-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-cz-border text-cz-3">
              <Th label="Rytter" k="name" sort={sort} onSort={toggleSort} align="left" />
              <Th label="Nat" k="nationality_code" sort={sort} onSort={toggleSort} align="left" />
              <Th label="Alder" k="age" sort={sort} onSort={toggleSort} />
              <Th label="Type" k="primary_type" sort={sort} onSort={toggleSort} align="left" />
              <Th label="2.type" k="secondary_type" sort={sort} onSort={toggleSort} align="left" />
              {ABIL_COLS.map((a) => <Th key={a} label={a} k={a} sort={sort} onSort={toggleSort} />)}
              <Th label="base_value" k="base_value" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} className="border-b border-cz-border/50 last:border-0 hover:bg-cz-bg">
                <td className="px-3 py-1.5 text-cz-1">{r.name}</td>
                <td className="px-3 py-1.5 text-cz-2">{r.nationality_code}</td>
                <td className="px-3 py-1.5 text-right font-mono text-cz-2">{r.age}</td>
                <td className="px-3 py-1.5 text-cz-2">{r.primary_type}</td>
                <td className="px-3 py-1.5 text-cz-3">{r.secondary_type}</td>
                {ABIL_COLS.map((a) => <td key={a} className="px-3 py-1.5 text-right font-mono text-cz-2">{r.abilities?.[a] ?? "—"}</td>)}
                <td className="px-3 py-1.5 text-right font-mono text-cz-1 font-semibold">{fmt(r.base_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-2 text-xs text-cz-3">
        <span>{rows.length.toLocaleString("da-DK")} ryttere</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 rounded bg-cz-subtle disabled:opacity-40">‹</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 rounded bg-cz-subtle disabled:opacity-40">›</button>
          <button onClick={load} className="ms-2 px-2 py-1 rounded bg-cz-subtle hover:text-cz-1">↻ Genindlæs</button>
        </div>
      </div>
    </div>
  );
}

function Th({ label, k, sort, onSort, align = "right" }) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => onSort(k)}
      className={`px-3 py-2 cursor-pointer select-none hover:text-cz-1 ${align === "left" ? "text-left" : "text-right"} ${active ? "text-cz-1" : ""}`}
    >
      {label}{active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
}
```

- [ ] **Step 2: Mount i AdminDataTab**

Læs `frontend/src/pages/admin/AdminDataTab.jsx`. Den bruger `useAdminAuth()` (→ `getAuth`, `showMsg`). Importér og render sektionen ved siden af eksisterende sektioner, fx i en ny kort-blok:

```jsx
import RiderExplorerSection from "../../components/admin/RiderExplorerSection";
// ... i render, hvor andre sektioner ligger (mønster: <h2>…</h2> + <Section getAuth={getAuth} onMsg={showMsg} />):
<section className="...">
  <h2 className="...">Rider Explorer (fiktiv launch-population)</h2>
  <RiderExplorerSection getAuth={getAuth} onMsg={showMsg} />
</section>
```

(Følg den nøjagtige overskrift/wrapper-stil de andre sektioner i AdminDataTab bruger.)

- [ ] **Step 3: Verificér i browseren (Playwright-mocks eller lokal admin-login)**

Byg + start frontend. Naviger til `/admin/data` som admin → "Rider Explorer"-sektion viser 800 ryttere, sortér på base_value, filtrér på type. Ingen konsol-fejl.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/RiderExplorerSection.jsx frontend/src/pages/admin/AdminDataTab.jsx
git commit -m "feat(admin): Rider Explorer-side — 800 fiktive ryttere m. type/evner/base_value"
```

---

### Task 8: Typer, fuld CI-gate, PR

- [ ] **Step 1: Regenerér TS-typer** (efter migration er anvendt på en DB — ELLER lad ejer gøre det post-merge)

Via Supabase MCP `generate_typescript_types` → opdatér `frontend/src/types/database.types.ts` (ny `users.is_beta_tester` + evt. `is_beta_tester`-RPC). Hvis migration ikke er anvendt endnu: markér som ejer-post-merge-step og noter det i PR.

- [ ] **Step 2: Kør hele CI-gate-sættet lokalt**

Run:
```
pwsh -File scripts/verify-local.ps1
cd frontend; npm run lint; cd ..
node scripts/i18n-check-leaks.mjs
node scripts/check-tone-em-dash.mjs   # (eller projektets tone-check)
npx playwright test core-smoke.spec.js
```
Expected: alt grønt. (Ingen nye i18n-nøgler → i18n-keys uændret; admin-flade har ingen i18n.)

- [ ] **Step 3: Opdatér FEATURE_STATUS.md** hvis flag-kontrakten dokumenteres der (tri-state + beta-kohorte).

- [ ] **Step 4: Patch notes** — IKKE påkrævet (intern beta-infra; almindelige spillere ser ingen ændring). Skriv begrundelsen i PR-bodyen.

- [ ] **Step 5: Åbn PR — BACKEND/DB; ejer merger** (migration auto-applies i prod)

```bash
git push -u origin feat/beta-access-rider-explorer
gh pr create --title "feat: beta-adgangssystem + Rider Explorer" --body "<inkl. Brugerverifikation-sektion + 'database/*.sql → ejer merger'-note + patch-notes-begrundelse>"
```

> PR-body SKAL have en **Brugerverifikation**-sektion (ellers fejler `PR user-verification check`). Migrations-PR → **ejer merger** (ikke auto-merge).

---

## Self-Review (udført ved skrivning)

- **Spec-dækning:** §3.1 datamodel → Task 1. §3.2 evaluering → Task 2. §3.3 backend-wiring + system/cron-global → Task 3-4 (Step 7 dækker eksplicit cron-global). §3.4 frontend → bevidst NUL ændring (gating via `enabled`); badge udskudt (returnerer `betaTester`-data i Task 4 Step 4). §3.6 migration=ejer-merger → Task 1 + Task 8 Step 5. §4 Rider Explorer → Task 5-7. §5 test-strategi → tests i Task 2/3/5 + verifikation Task 6/7/8.
- **Placeholder-scan:** ingen TBD/TODO. To "bekræft via grep/sti-mønster"-steps (Task 4 Step 3, Task 6 Step 1, Task 7 Step 2) er konkrete eksekverings-tjek mod faktiske mønstre, ikke logik-huller.
- **Type-konsistens:** `readFlagStage`/`evaluateFlagStage` (Task 2) bruges identisk i Task 3-4-6. `isViewerBetaTester(req)` (Task 4) konsistent. `buildFictionalPopulationPreview({baseline, model})` (Task 5) kaldt ens i script + endpoint. Endpoint returnerer `{count, distribution{p10,median,p90,max}, riders[]}` → frontend læser nøjagtig de felter (Task 7).
