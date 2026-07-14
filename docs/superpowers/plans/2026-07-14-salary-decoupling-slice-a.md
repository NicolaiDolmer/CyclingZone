# Løn-decoupling slice A (shadow-harness) — implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Byg en read-only shadow-harness der producerer den kalibrerede `SALARY_RATE_PROD` + lønbyrde-fordeling + talent-eksempler for løn-decoupling — så designet ([spec](../specs/2026-07-14-salary-decoupling-design.md)) bevises mod ægte data FØR nogen økonomi-ændring.

**Architecture:** (1) Ny ren funktion `currentProductionValue()` i `riderCareerNpv.js` = v4-modellens sæson-0-produktionsled (`scale · prod_0`, ingen elite-præmie), genbruger `careerTrajectory`. (2) Ren kalibrerings-/gate-logik i ny `backend/lib/salaryDecoupling.js` (node --test). (3) Read-only runner `backend/scripts/salaryDecouplingScorecard.js` der loader ægte owned-population, beregner `current_production_value` pr. rytter, kalibrerer satsen så global lønbyrde bevares, kører gates og skriver et audit-artefakt. INGEN `economyConstants`-ændring, INGEN migration, INGEN live-path rørt i denne slice.

**Tech Stack:** Node ESM, `node:test`, `@supabase/supabase-js` (kun SELECT), eksisterende `riderValuationModelV4.json`.

**Slice A non-goals (vigtigt):** Rør IKKE `economyConstants.SALARY_RATE`/tilføj IKKE `SALARY_RATE_PROD` som live-konstant (det er slice B/cutover). Rør IKKE `computeFrozenSalary`/`contractSeed`/`marketUtils`/frontend. Harnessen RAPPORTERER kun den anbefalede sats.

---

### Task 1: `currentProductionValue()` i riderCareerNpv.js

Sæson-0-produktionsleddet fra v4-modellen, skaleret, uden elite-præmie. Løn-basen.

**Files:**
- Modify: `backend/lib/riderCareerNpv.js` (tilføj eksporteret funktion efter `careerTrajectory`, ~linje 189)
- Test: `backend/lib/riderCareerNpv.test.js` (tilføj nye tests i eksisterende fil)

- [ ] **Step 1: Skriv de fejlende tests**

Tilføj til bunden af `backend/lib/riderCareerNpv.test.js` (importér `currentProductionValue` i den eksisterende import-linje øverst: `import { predictBaseValueV4, careerTrajectory, hazard, applyElitePremium, currentProductionValue } from "./riderCareerNpv.js";`):

```js
// ── currentProductionValue (løn-base, #2428 løn-decoupling) ─────────────────────

test("currentProductionValue: er sæson-0-leddet — mindre end den fulde NPV (base_value)", () => {
  const rider = { id: "r", primary_type: "climber", potentiale: 4, age: 24 };
  const abilities = makeAbilities({ climbing: 60, tempo: 60, punch: 60, endurance: 60 });
  const model = fixtureModel();
  const cpv = currentProductionValue(rider, abilities, model);
  const base = predictBaseValueV4(rider, abilities, model);
  assert.ok(cpv > 0 && base > 0);
  assert.ok(cpv < base, `sæson-0 (${cpv}) skal være mindre end hele karrieren (${base})`);
});

test("currentProductionValue: talent har lavere løn/værdi-forhold end etableret rytter (decoupling)", () => {
  const model = fixtureModel();
  const ab = makeAbilities({ climbing: 60, tempo: 60, punch: 60, endurance: 60 });
  const young = { id: "y", primary_type: "climber", potentiale: 5, age: 20 };
  const established = { id: "e", primary_type: "climber", potentiale: 3, age: 31 };
  const ratioYoung = currentProductionValue(young, ab, model) / predictBaseValueV4(young, ab, model);
  const ratioOld = currentProductionValue(established, ab, model) / predictBaseValueV4(established, ab, model);
  assert.ok(ratioYoung < ratioOld,
    `talent-forhold (${ratioYoung.toFixed(3)}) skal være lavere end etableret (${ratioOld.toFixed(3)})`);
});

test("currentProductionValue: elite-præmie påvirker IKKE løn-basen (men påvirker værdien)", () => {
  const ep = { overall_threshold: 45, k: 0.1 };
  const rider = { id: "elite", primary_type: "climber", potentiale: 3, age: 26 };
  const eliteAb = makeAbilities(Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, 90])));
  const cpvNoEp = currentProductionValue(rider, eliteAb, fixtureModel());
  const cpvEp = currentProductionValue(rider, eliteAb, fixtureModel({ elite_premium: ep }));
  assert.equal(cpvEp, cpvNoEp, "løn-base må ikke få elite-præmie");
  const baseNoEp = predictBaseValueV4(rider, eliteAb, fixtureModel());
  const baseEp = predictBaseValueV4(rider, eliteAb, fixtureModel({ elite_premium: ep }));
  assert.ok(baseEp > baseNoEp, "værdien SKAL få elite-præmie");
});

test("currentProductionValue: monoton i overall (stærk > svag)", () => {
  const model = fixtureModel();
  const weak = currentProductionValue(
    { primary_type: "rouleur", potentiale: 3, age: 26 }, makeAbilities({ flat: 40, endurance: 40 }), model);
  const strong = currentProductionValue(
    { primary_type: "rouleur", potentiale: 3, age: 26 }, makeAbilities({ flat: 80, endurance: 80 }), model);
  assert.ok(strong > weak, `stærk (${strong}) > svag (${weak})`);
});

test("currentProductionValue: deterministisk + null-guards", () => {
  const rider = { primary_type: "gc", potentiale: 3, age: 25 };
  const abilities = makeAbilities();
  const model = fixtureModel();
  assert.equal(currentProductionValue(rider, abilities, model), currentProductionValue(rider, abilities, model));
  assert.equal(currentProductionValue(rider, abilities, null), null);
  assert.equal(currentProductionValue(rider, {}, model), null);
  assert.equal(currentProductionValue(rider, abilities, { fit: {} }), null);
});
```

- [ ] **Step 2: Kør testene og bekræft at de FEJLER**

Run: `cd backend && node --test lib/riderCareerNpv.test.js`
Expected: FAIL — `currentProductionValue is not a function` (import undefined).

- [ ] **Step 3: Implementér funktionen**

Tilføj i `backend/lib/riderCareerNpv.js` efter `careerTrajectory` (efter linje 189):

```js
// Løn-base (#2428 løn-decoupling): kun SÆSON-0-produktionsleddet, skaleret, UDEN
// elite-præmie. Adskiller løn ("ugeløn for nuværende levering") fra base_value
// ("køb/salg-pris = hele karriere-NPV'en + elite-præmie"). Genbruger careerTrajectory
// så formlen ikke duplikeres — trajectory[0].prod = exp(a + b·O_0 + c·O_0² + offset)
// ved rytterens NUVÆRENDE evner (ingen diskontering, survival=1, ingen fremskrivning).
// Samme kald-form + null-kontrakt som predictBaseValueV4. Ren funktion.
export function currentProductionValue(rider, abilities, model) {
  const traj = careerTrajectory(rider, abilities, model);
  if (!traj.length) return null;
  const scale = Number.isFinite(Number(model?.scale)) ? Number(model.scale) : 1;
  const v = Math.round(scale * traj[0].prod);
  return Number.isFinite(v) && v > 0 ? Math.max(1, v) : null;
}
```

- [ ] **Step 4: Kør testene og bekræft at de PASSERER**

Run: `cd backend && node --test lib/riderCareerNpv.test.js`
Expected: PASS (alle tests, inkl. de eksisterende).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/riderCareerNpv.js backend/lib/riderCareerNpv.test.js
git commit -F <msg-fil>   # "feat(valuation): currentProductionValue — sæson-0 løn-base, ingen elite-præmie (#2428)"
```

---

### Task 2: Ren kalibrerings- + gate-logik i `salaryDecoupling.js`

Deterministiske, DB-fri funktioner: kalibrér satsen (bevar global lønbyrde), projekter løn, opsummer pr. division, evaluér gates. Følger lib/script-splittet fra `valuationV4Scorecard.js`.

**Files:**
- Create: `backend/lib/salaryDecoupling.js`
- Test: `backend/lib/salaryDecoupling.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

Create `backend/lib/salaryDecoupling.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  calibrateSalaryRate, projectedSalary, wageBillsByDivision,
  wageBillContinuityGate, talentFixGate, runawayGate,
} from "./salaryDecoupling.js";

// rows: { current_production_value, current_salary, division, is_talent }
const ROWS = [
  { current_production_value: 100_000, current_salary: 30_000, division: 1 },
  { current_production_value: 200_000, current_salary: 60_000, division: 1 },
  { current_production_value: 50_000, current_salary: 15_000, division: 2 },
];

test("calibrateSalaryRate: bevarer den globale lønbyrde (Σsalary / Σcpv)", () => {
  const rate = calibrateSalaryRate(ROWS);
  // (30k+60k+15k) / (100k+200k+50k) = 105k / 350k = 0,3
  assert.ok(Math.abs(rate - 0.3) < 1e-9, `rate=${rate}`);
  // Global projiceret lønbyrde ≈ nuværende.
  const projTotal = ROWS.reduce((s, r) => s + projectedSalary(r.current_production_value, rate), 0);
  const curTotal = ROWS.reduce((s, r) => s + r.current_salary, 0);
  assert.ok(Math.abs(projTotal - curTotal) <= ROWS.length, `proj ${projTotal} ≈ cur ${curTotal}`);
});

test("calibrateSalaryRate: ignorerer rækker uden salary/cpv; tom → null", () => {
  const rate = calibrateSalaryRate([
    { current_production_value: 100_000, current_salary: 30_000, division: 1 },
    { current_production_value: 0, current_salary: 999, division: 1 },
    { current_production_value: 5000, current_salary: null, division: 1 },
  ]);
  assert.ok(Math.abs(rate - 0.3) < 1e-9);
  assert.equal(calibrateSalaryRate([]), null);
});

test("projectedSalary: max(1, round(cpv·rate))", () => {
  assert.equal(projectedSalary(100_000, 0.3), 30_000);
  assert.equal(projectedSalary(0, 0.3), 1);
  assert.equal(projectedSalary(2, 0.3), 1);
});

test("wageBillsByDivision: summerer nuværende + projiceret pr. division", () => {
  const bills = wageBillsByDivision(ROWS, 0.3);
  assert.equal(bills[1].current, 90_000);
  assert.equal(bills[1].projected, 90_000);
  assert.equal(bills[1].count, 2);
  assert.equal(bills[2].current, 15_000);
});

test("wageBillContinuityGate (G1): pass når hver division er inden for tolerance", () => {
  const bills = wageBillsByDivision(ROWS, 0.3);
  assert.equal(wageBillContinuityGate(bills, 0.15).pass, true);
  // Kunstig drift: en division 40% over → fejl.
  const drifted = { 1: { current: 100_000, projected: 140_000, count: 2 } };
  assert.equal(wageBillContinuityGate(drifted, 0.15).pass, false);
});

test("talentFixGate (G2): talent-løn < sponsor OG lavere løn/værdi end i dag", () => {
  // talent: cpv lav ift. værdi. projiceret løn = 20k < sponsor 240k. Gammel kobling: value·0,067.
  const talents = [{ current_production_value: 60_000, value_v4: 5_560_000 }];
  const g = talentFixGate(talents, 0.3, { sponsor: 240_000, oldRate: 0.067 });
  assert.equal(g.pass, true, JSON.stringify(g));
  // Modeksempel: hvis satsen var absurd høj (4,0) → 240k løn = ikke < sponsor.
  assert.equal(talentFixGate(talents, 4.0, { sponsor: 240_000, oldRate: 0.067 }).pass, false);
});

test("runawayGate (G4): ingen projiceret løn over loft", () => {
  const rows = [{ current_production_value: 100_000 }, { current_production_value: 900_000 }];
  assert.equal(runawayGate(rows, 0.3, 240_000).pass, true); // maks 270k > 240k? nej → fejl
  assert.equal(runawayGate(rows, 0.3, 300_000).pass, true); // maks 270k ≤ 300k → pass
});
```

> Bemærk: ret `runawayGate`-forventningen så den matcher din endelige loft-parametrisering; skriv gaten så `pass = max(projiceret løn) ≤ ceiling`.

- [ ] **Step 2: Kør testene og bekræft at de FEJLER**

Run: `cd backend && node --test lib/salaryDecoupling.test.js`
Expected: FAIL — kan ikke importere fra `./salaryDecoupling.js` (findes ikke).

- [ ] **Step 3: Implementér modulet**

Create `backend/lib/salaryDecoupling.js`:

```js
// Løn-decoupling slice A (#2428) — ren kalibrerings- + gate-logik, DB-fri og
// deterministisk (node --test). Runneren (scripts/salaryDecouplingScorecard.js)
// leverer rækkerne fra ægte prod-data. INGEN live-økonomi rørt (shadow).
//
// Række-form: { current_production_value:number, current_salary:number|null,
//               division:number, value_v4?:number }

// Sats der bevarer den GLOBALE lønbyrde: Σ nuværende_løn / Σ current_production_value
// (kun rækker med både positiv cpv og positiv løn). Så total-lønbyrden er uændret
// ved konstruktion; det interessante er fordelingen (G1 pr. division, G2 talent).
export function calibrateSalaryRate(rows) {
  let sumSalary = 0, sumCpv = 0;
  for (const r of rows) {
    const cpv = Number(r.current_production_value);
    const sal = Number(r.current_salary);
    if (Number.isFinite(cpv) && cpv > 0 && Number.isFinite(sal) && sal > 0) {
      sumSalary += sal;
      sumCpv += cpv;
    }
  }
  return sumCpv > 0 ? sumSalary / sumCpv : null;
}

// Frossen-løn-formel med den nye base (spejler computeFrozenSalary's max(1,round)).
export function projectedSalary(currentProductionValue, rate) {
  const base = Number(currentProductionValue) > 0 ? Number(currentProductionValue) : 0;
  return Math.max(1, Math.round(base * Number(rate)));
}

export function wageBillsByDivision(rows, rate) {
  const byDiv = {};
  for (const r of rows) {
    const div = r.division ?? "ukendt";
    (byDiv[div] ??= { current: 0, projected: 0, count: 0 });
    byDiv[div].current += Number(r.current_salary) || 0;
    byDiv[div].projected += projectedSalary(r.current_production_value, rate);
    byDiv[div].count += 1;
  }
  return byDiv;
}

// G1 (hård): hver divisions projicerede lønbyrde inden for ±tolerance af nuværende.
export function wageBillContinuityGate(bills, tolerance) {
  const rows = [];
  let pass = true;
  for (const [div, b] of Object.entries(bills)) {
    const drift = b.current > 0 ? (b.projected - b.current) / b.current : (b.projected > 0 ? 1 : 0);
    const ok = Math.abs(drift) <= tolerance;
    if (!ok) pass = false;
    rows.push({ division: div, ...b, drift, ok });
  }
  return { pass, tolerance, rows };
}

// G2 (hård): repræsentative talenter → projiceret løn < sponsor, OG løn/værdi-forhold
// lavere end den gamle market_value-kobling (oldRate).
export function talentFixGate(talents, rate, { sponsor, oldRate }) {
  const rows = talents.map((t) => {
    const newSalary = projectedSalary(t.current_production_value, rate);
    const oldSalary = Math.max(1, Math.round(Number(t.value_v4) * oldRate));
    const belowSponsor = newSalary < sponsor;
    const lowerThanOld = newSalary < oldSalary;
    return { ...t, newSalary, oldSalary, belowSponsor, lowerThanOld, ok: belowSponsor && lowerThanOld };
  });
  return { pass: rows.every((r) => r.ok), sponsor, rows };
}

// G4 (hård): ingen projiceret løn over loft (fx maks sponsor).
export function runawayGate(rows, rate, ceiling) {
  let maxSalary = 0;
  for (const r of rows) maxSalary = Math.max(maxSalary, projectedSalary(r.current_production_value, rate));
  return { pass: maxSalary <= ceiling, maxSalary, ceiling };
}
```

- [ ] **Step 4: Kør testene og bekræft at de PASSERER**

Run: `cd backend && node --test lib/salaryDecoupling.test.js`
Expected: PASS. (Juster `runawayGate`-testforventningen hvis nødvendigt så den matcher `max ≤ ceiling`.)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/salaryDecoupling.js backend/lib/salaryDecoupling.test.js
git commit -F <msg-fil>   # "feat(valuation): løn-decoupling kalibrerings- + gate-logik (#2428)"
```

---

### Task 3: Read-only runner `salaryDecouplingScorecard.js`

Loader ægte owned-population, beregner `current_production_value` pr. rytter, kalibrerer satsen, kører gates, skriver audit. Mønster fra `scripts/fitRiderValuationV4.js` + `scripts/valuationV4Scorecard.js`.

**Files:**
- Create: `backend/scripts/salaryDecouplingScorecard.js`

- [ ] **Step 1: Skriv runneren**

Create `backend/scripts/salaryDecouplingScorecard.js`:

```js
#!/usr/bin/env node
// Løn-decoupling slice A shadow-scorecard (#2428). Simulér-før-ship: kalibrerer den
// produktions-baserede løn-sats mod den ÆGTE owned-population og verificerer at
// (G1) lønbyrden pr. division bevares, (G2) unge talenter får løn < sponsor, (G4)
// ingen runaway — FØR cutover (slice B, separat migration, ejer merger).
//
// READ-ONLY mod prod (kun SELECT — skriver ALDRIG DB). Ren gate-matematik:
// ../lib/salaryDecoupling.js (node --test). Rører INGEN live-økonomi/konstant.
//
//   node scripts/salaryDecouplingScorecard.js [--model-v4=<sti>] [--tolerance=0.15] [--out=<sti>]
//
// Exit 1 hvis en HÅRD gate fejler.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { currentProductionValue, predictBaseValueV4 } from "../lib/riderCareerNpv.js";
import { riderOverall } from "../lib/riderValuation.js";
import {
  calibrateSalaryRate, projectedSalary, wageBillsByDivision,
  wageBillContinuityGate, talentFixGate, runawayGate,
} from "../lib/salaryDecoupling.js";
import { SPONSOR_INCOME_BASE } from "../lib/economyConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const argVal = (flag, def = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(`--${flag}=`.length) : def;
};
const MODEL_V4_PATH = argVal("model-v4") || join(__dirname, "../lib/riderValuationModelV4.json");
const TOLERANCE = Number(argVal("tolerance", "0.15"));
const OUT_PATH = argVal("out");
const OLD_RATE = 0.067;                 // nuværende SALARY_RATE (kobling til market_value)
const SPONSOR = SPONSOR_INCOME_BASE;    // 240_000 — talent-løn skal ligge under dette
const HIGH_POTENTIALE = 5;              // potentiale er 1-6 (verificeret #2428)

// ageForSeason spejler riderProgressionEngine.js (inlinet, jf. fitRiderValuationV4.js).
const LAUNCH_REFERENCE_YEAR = 2026;
function ageForSeason(birthdate, seasonNumber) {
  if (!birthdate || !Number.isFinite(seasonNumber)) return null;
  const birthYear = new Date(birthdate).getFullYear();
  return Number.isFinite(birthYear) ? LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) - birthYear : null;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const model = JSON.parse(readFileSync(MODEL_V4_PATH, "utf8"));

  const { data: activeSeason } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  const seasonNumber = activeSeason?.number ?? 1;

  // Ægte hold (samme filter som ranglisten/UI: ikke test/frozen/bank). division fra teams.
  const teams = await fetchAllRows(() => supabase
    .from("teams").select("id, division, is_test_account, is_frozen, is_bank").order("id"));
  const realTeamById = new Map(teams
    .filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank)
    .map((t) => [t.id, t]));

  // Owned ryttere MED løn (den faktiske nuværende lønbyrde). Free agents (salary null)
  // udelades — de er ikke på lønningslisten.
  const [riders, abilityRows] = await Promise.all([
    fetchAllRows(() => supabase.from("riders")
      .select("id, team_id, salary, base_value, prize_earnings_bonus, potentiale, birthdate, primary_type, is_retired, is_academy")
      .not("team_id", "is", null).order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilityRows.map((a) => [a.rider_id, a]));

  const rows = [];
  const talents = [];
  let skipped = 0;
  for (const r of riders) {
    const team = realTeamById.get(r.team_id);
    if (!team) { skipped++; continue; }               // AI/test/frozen — ikke i lønbyrde-målet
    if (r.is_retired) { skipped++; continue; }
    if (r.salary == null) { skipped++; continue; }     // ingen kontrakt → ikke på lønningslisten
    const ab = abilityByRider.get(r.id);
    if (!ab) { skipped++; continue; }
    const age = ageForSeason(r.birthdate, seasonNumber);
    if (age == null) { skipped++; continue; }
    const npvRider = { primary_type: r.primary_type, potentiale: r.potentiale, age };
    const cpv = currentProductionValue(npvRider, ab, model);
    if (cpv == null) { skipped++; continue; }
    const value_v4 = predictBaseValueV4(npvRider, ab, model);
    rows.push({ current_production_value: cpv, current_salary: Number(r.salary), division: team.division, value_v4 });
    // Talent-udvalg til G2: ung + højt potentiale (repræsentative for det problematiske tilfælde).
    if (age <= 22 && Number(r.potentiale) >= HIGH_POTENTIALE) {
      talents.push({ id: r.id, age, overall: riderOverall(ab), current_production_value: cpv, value_v4 });
    }
  }

  if (!rows.length) {
    console.error("❌ Ingen owned-ryttere med løn fundet — kan ikke kalibrere.");
    process.exit(1);
  }

  const rate = calibrateSalaryRate(rows);
  const bills = wageBillsByDivision(rows, rate);
  const g1 = wageBillContinuityGate(bills, TOLERANCE);
  const g2 = talentFixGate(talents, rate, { sponsor: SPONSOR, oldRate: OLD_RATE });
  const g4 = runawayGate(rows, rate, SPONSOR);

  const fmt = (n) => (n / 1e6).toFixed(2) + "M";
  const lines = [];
  const say = (s = "") => { console.log(s); lines.push(s); };

  say(`# Løn-decoupling slice A — shadow-scorecard (#2428)`);
  say(``);
  say(`- Population: ${rows.length} owned-ryttere med løn (${skipped} sprunget over)`);
  say(`- **Kalibreret SALARY_RATE_PROD = ${rate.toFixed(4)}** (gammel market_value-rate: ${OLD_RATE})`);
  say(``);
  say(`## G1 · Lønbyrde-kontinuitet pr. division (±${(TOLERANCE * 100).toFixed(0)}%) — ${g1.pass ? "✅" : "❌"}`);
  say(`| Div | Nuværende | Projiceret | Drift | Ryttere |`);
  say(`|--:|--:|--:|--:|--:|`);
  for (const b of g1.rows.sort((a, c) => String(a.division).localeCompare(String(c.division)))) {
    say(`| ${b.division} | ${fmt(b.current)} | ${fmt(b.projected)} | ${(b.drift * 100).toFixed(1)}% | ${b.count} |`);
  }
  say(``);
  say(`## G2 · Talent-fix (løn < sponsor ${fmt(SPONSOR)} + lavere end market_value-kobling) — ${g2.pass ? "✅" : "❌"}`);
  say(`| Rytter | Alder | Overall | v4-værdi | Ny løn | Gl. løn (v4·0,067) |`);
  say(`|--|--:|--:|--:|--:|--:|`);
  for (const t of g2.rows.slice(0, 15)) {
    say(`| ${t.id.slice(0, 8)} | ${t.age} | ${t.overall} | ${fmt(t.value_v4)} | ${Math.round(t.newSalary).toLocaleString()} | ${Math.round(t.oldSalary).toLocaleString()} |`);
  }
  say(`(talenter i alt: ${g2.rows.length})`);
  say(``);
  say(`## G4 · Ingen runaway (maks løn ≤ ${fmt(SPONSOR)}) — ${g4.pass ? "✅" : "❌"}`);
  say(`- Højeste projicerede løn: ${Math.round(g4.maxSalary).toLocaleString()} CZ$`);
  say(``);
  const hardPass = g1.pass && g2.pass && g4.pass;
  say(`## Resultat: ${hardPass ? "✅ alle hårde gates grønne" : "❌ mindst én hård gate rød"}`);

  if (OUT_PATH) {
    writeFileSync(OUT_PATH, lines.join("\n") + "\n");
    console.log(`\n✅ Skrev audit ${OUT_PATH}`);
  }
  if (!hardPass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

> **Retning at bekræfte under kørsel:** `teams.division` er den rigtige kolonne for divisions-tilhør — hvis divisionen ligger i `standings`/`league_divisions` i stedet, hent den derfra (bekræft mod `list_tables` / eksisterende division-opslag før kørsel).

- [ ] **Step 2: Syntaks-tjek (uden DB)**

Run: `cd backend && node --check scripts/salaryDecouplingScorecard.js`
Expected: ingen output (gyldig syntaks). (Kør ikke mod prod endnu — det sker i Task 4.)

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/salaryDecouplingScorecard.js
git commit -F <msg-fil>   # "feat(valuation): løn-decoupling shadow-scorecard runner, read-only (#2428)"
```

---

### Task 4: Kør harnessen mod prod → producér audit → rapportér til ejer

**Files:**
- Create (output): `docs/audits/2026-07-14-salary-decoupling-scorecard.md`

- [ ] **Step 1: Kør scorecardet read-only mod prod**

Run: `cd backend && node scripts/salaryDecouplingScorecard.js --tolerance=0.15 --out=../docs/audits/2026-07-14-salary-decoupling-scorecard.md`
Expected: konsol-rapport + skrevet audit-fil. Exit 0 hvis alle hårde gates grønne; exit 1 ellers (så er der en reel finding at rapportere — ikke en fejl at skjule).

- [ ] **Step 2: Læs auditten + vurdér findings**

- Er G1 grøn på ALLE divisioner med én global sats? Hvis en division driver >±15%, er det en finding: overvej per-division-sats (rapportér til ejer, gæt ikke).
- Er G2 grøn — lander talenterne (inkl. det oprindelige 373k-tilfælde) langt under sponsor?
- Er den kalibrerede sats fornuftig (~0,20-0,25 forventet)?

- [ ] **Step 3: Commit audit + rapportér tallene til ejer**

```bash
git add docs/audits/2026-07-14-salary-decoupling-scorecard.md
git commit -F <msg-fil>   # "docs(valuation): løn-decoupling shadow-scorecard — kalibreret sats + fordeling (#2428)"
```

Rapportér til ejer: kalibreret `SALARY_RATE_PROD`, G1-tabel pr. division, G2-talent-tabel (ny vs. gl. løn), og de to §8-knapper (sats-mål + tolerance) klar til beslutning ved cutover-review. Vis tallene visuelt (show_widget) — ejer-præference.

---

## Self-review (mod spec)

- **Spec §2-3 mekanik** → Task 1 (`currentProductionValue` = scale·prod_0, ingen elite-præmie). ✓
- **Spec §3.4 sats-kalibrering** → Task 2 (`calibrateSalaryRate`) + Task 3/4 (mod ægte population). ✓
- **Spec §5 gates** G1/G2/G4 → Task 2 + Task 3. G3 (etableret-stabilitet) og G5 (determinisme) er rapport/triviel — G5 dækkes af Task 1's determinisme-test + rene funktioner; G3 kan tilføjes som ekstra rapport-tabel i runneren hvis ønsket (ikke hård gate). ✓ (G3 bevidst let — rapporteres, blokerer ikke.)
- **Spec §6 rollout** → hele planen ER slice A (shadow, read-only). Slice B (cutover) er IKKE i denne plan. ✓
- **Spec §7 non-goals** → planen rører hverken `economyConstants`, `computeFrozenSalary`, migration eller frontend. ✓
- **Placeholder-scan** → import-dubletten i Task 3 er eksplicit flagget med et ret-step (Step 2). Ingen TODO/TBD. ✓
- **Type-konsistens** → `currentProductionValue(rider, abilities, model)`, `calibrateSalaryRate(rows)`, `projectedSalary(cpv, rate)`, `wageBillsByDivision(rows, rate)` bruges konsistent på tværs af tasks. ✓
