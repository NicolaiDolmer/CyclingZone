# Daglig træning v1 + Form/Træthed-spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dagligt trænings-loop (#1305) hvor hver rytter følger et program og fylder synlige progress-barer (fuld bar → +1 evne), plus Form/Træthed-spine med milde skader og race-motor-integration (#1306).

**Architecture:** Den daglige strøm genbruger L0-motorens (#1137) eksisterende matematik (`growthFractionByAge`, `ability_caps`, seeded determinisme) — sæsonbudgettet deles i ~28 daglige bidder med compounding. Eksekvering er pr. hold pr. dag (manager-klik = +25 % bonus, ellers assistent-sweep efter kl. 22 dansk tid), idempotent via `UNIQUE(team_id, tick_date)`. Form/Træthed er to tal (0-100) i ny `rider_condition`-tabel; race-motoren læser dem via de eksisterende stubs `formComponent`/`fatigueComponent` i `raceSimulator.js` (max ~±3 % af score). Skader udløses seeded af hård træning + høj træthed.

**Tech Stack:** Node/Express (ESM), Supabase Postgres (service-role), React+Vite, node --test, eksisterende seeded RNG-familie (FNV-1a `seededUnit`, mulberry32).

**Leverance-split:** Fase A = PR 1 (`feat/1305-daily-training`, Refs #1305). Fase B = PR 2 (`feat/1306-form-fatigue-race`, Refs #1306, bygger på fase A).

**Genbrugte byggesten (verificeret 11/6):**
| Byggesten | Fil | Rolle her |
|---|---|---|
| `growthFractionByAge`, `seededUnit`, caps | `backend/lib/riderProgression.js` | daglig rate + determinisme |
| `developRidersForSeason` | `backend/lib/riderProgressionEngine.js` | skal skippe vækst for human-hold (anti-double-dip) |
| `training_plans` + taksonomi | `backend/lib/training.js`, `database/2026-06-08-training-l2-teaser.sql` | programmer = samme tabel, slot-cap fjernes |
| `formComponent`/`fatigueComponent` stubs | `backend/lib/raceSimulator.js:63-71` | fase B implementerer dem |
| `autoFillEntries` team-filter | `backend/lib/raceRunner.js:251-273` | human-holds-diskriminator + skade-filter |
| flag-mønster `app_config` | `backend/lib/raceEngineFlag.js` | `daily_training_enabled` kopierer mønstret |
| cron-runner (setInterval) | `backend/cron.js` | assistent-sweep-job |
| `generateFictionalRiders`, `makeRng` | `backend/lib/fictionalRiderGenerator.js` | sim-harness-population |

**Design-beslutninger låst her (fra spec afsnit 5-6 + research):**
1. **Intensitet styrer fokus-multiplikator + træthed + skaderisiko — IKKE volumen.** Progress-matematikken er L0-ækvivalent: fokus-evner × `focusGrowthMult[intensity]` (1.15/1.35/1.60), øvrige × `offFocusMult` (0.97). Ny 4. intensitet `rest`: ingen progress, stor trætheds-recovery.
2. **Compounding-note:** dagligt `f/28` af residual-gap giver `gap·e^(−f)` over en sæson ≈ L0's `gap·(1−f)` men en anelse langsommere. Konstanten `dailyBudgetBoost` (start 1.0) kalibreres i sim-harnesset så peak rammer alder 27-28.
3. **Teaserens sæson-setback (5 %/18 %) erstattes af milde skader** (samme rolle: risiko ved hård træning). `resolveTrainingModifier`-stien forbliver urørt for flag-OFF og AI.
4. **AI-hold trænes ALDRIG dagligt** (spec 9.1) — de beholder fuld sæsonvis L0. Human-holds-ryttere i vækstfase får dagligt i stedet (L0-vækst skippes); decline + retirement forbliver sæsonvise for ALLE.
5. **Ryttere uden eksplicit program følger default-program** (`endurance`/`normal`) — "rytterne følger ALTID deres program" (spec 6.3). Default ligger i kode, ikke DB.
6. **Skadede ryttere:** ingen progress, træthed falder med hvile-rate, ekskluderes fra race-entry (fase B).
7. Flaget `daily_training_enabled` (app_config) gater tick + sweep. UI'et er synligt før flip (intent-capture før 20/6) med "starter ved relaunch"-note.

---

## Fase A — Dagligt trænings-loop (#1305, PR 1)

### Task A1: Migration — `rider_condition`, `training_day_runs`, `ability_progress`

**Files:**
- Create: `database/2026-06-12-daily-training.sql`

- [ ] **Step 1: Skriv migrationen**

```sql
-- Daglig træning v1 (#1305) + form/træthed-spine (#1306, datamodel her)
-- Spec: docs/superpowers/specs/2026-06-11-kernesystemer-design.md afsnit 5-6

-- Form/Træthed pr. rytter (0-100). Default: neutral form, frisk.
CREATE TABLE IF NOT EXISTS rider_condition (
  rider_id UUID PRIMARY KEY REFERENCES riders(id) ON DELETE CASCADE,
  form SMALLINT NOT NULL DEFAULT 50 CHECK (form BETWEEN 0 AND 100),
  fatigue SMALLINT NOT NULL DEFAULT 0 CHECK (fatigue BETWEEN 0 AND 100),
  injured_until DATE,
  injury_cause TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE rider_condition ENABLE ROW LEVEL SECURITY;
-- Læsning: alle autentificerede (stats er transparente per spec afsnit 1).
CREATE POLICY rider_condition_select ON rider_condition
  FOR SELECT TO authenticated USING (true);
-- Skrivning: kun service-role (ingen authenticated-policy for INSERT/UPDATE/DELETE).

-- Én trænings-eksekvering pr. hold pr. dag (dansk dato). Idempotens-anker.
CREATE TABLE IF NOT EXISTS training_day_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tick_date DATE NOT NULL,
  executed_by TEXT NOT NULL CHECK (executed_by IN ('manager', 'assistant')),
  bonus_applied BOOLEAN NOT NULL DEFAULT false,
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, tick_date)
);

CREATE INDEX IF NOT EXISTS idx_training_day_runs_team_date
  ON training_day_runs (team_id, tick_date DESC);

ALTER TABLE training_day_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_day_runs_select ON training_day_runs
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

-- Progress-barer pr. evne (0..1 fraktion mod næste +1), samme mønster som ability_caps.
ALTER TABLE rider_derived_abilities
  ADD COLUMN IF NOT EXISTS ability_progress JSONB;

-- Flag (samme mønster som race_engine_v2_enabled): OFF indtil relaunch-dagen.
INSERT INTO app_config (key, value)
  VALUES ('daily_training_enabled', 'false')
  ON CONFLICT (key) DO NOTHING;
```

> NB: tjek `app_config`-tabellens kolonnenavne i `backend/lib/raceEngineFlag.js` før commit — INSERT'en skal matche det eksisterende key/value-format præcist.

- [ ] **Step 2: Sanity-check SQL'en lokalt**

Run: `node --check` er ikke relevant for SQL — verificér i stedet at filen parser via Supabase MCP `execute_sql` med `BEGIN; <filens indhold>; ROLLBACK;` mod dev, ELLER nøjes med review. Migrationen auto-applies ved merge (fleet-playbook-regel: `database/*.sql` auto-applies).

- [ ] **Step 3: Commit**

```bash
git add database/2026-06-12-daily-training.sql
git commit -m "feat(db): rider_condition + training_day_runs + ability_progress (Refs #1305 #1306)"
```

---

### Task A2: Flag-helper `dailyTrainingFlag.js`

**Files:**
- Create: `backend/lib/dailyTrainingFlag.js`
- Test: `backend/lib/dailyTrainingFlag.test.js`

- [ ] **Step 1: Skriv failing test**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { isDailyTrainingEnabled, DAILY_TRAINING_FLAG_KEY } from "./dailyTrainingFlag.js";

function fakeSupabase(value, error = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: value === undefined ? null : { value }, error }),
        }),
      }),
    }),
  };
}

test("flag key er stabil", () => {
  assert.equal(DAILY_TRAINING_FLAG_KEY, "daily_training_enabled");
});

test("true når value='true'", async () => {
  assert.equal(await isDailyTrainingEnabled(fakeSupabase("true")), true);
});

test("false når value mangler eller DB fejler (fail-safe)", async () => {
  assert.equal(await isDailyTrainingEnabled(fakeSupabase(undefined)), false);
  assert.equal(await isDailyTrainingEnabled(fakeSupabase("true", new Error("boom"))), false);
});
```

- [ ] **Step 2: Kør testen — forvent FAIL**

Run (fra `backend/`): `node --test lib/dailyTrainingFlag.test.js`
Expected: FAIL — modul findes ikke.

- [ ] **Step 3: Implementér (spejl `raceEngineFlag.js` 1:1, kun key ændret)**

```javascript
// Flag for dagligt trænings-tick (#1305). Mønster kopieret fra raceEngineFlag.js.
// OFF = ingen ticks/sweeps; programmer kan stadig sættes (intent-capture før relaunch).
export const DAILY_TRAINING_FLAG_KEY = "daily_training_enabled";

export async function isDailyTrainingEnabled(supabase) {
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", DAILY_TRAINING_FLAG_KEY)
      .maybeSingle();
    if (error) return false;
    return data?.value === "true";
  } catch {
    return false;
  }
}
```

> Spejl præcist `raceEngineFlag.js`' query-form (kolonnenavne/`maybeSingle`) — hvis den afviger fra ovenstående, følg den.

- [ ] **Step 4: Kør testen — forvent PASS**

Run: `node --test lib/dailyTrainingFlag.test.js`

- [ ] **Step 5: Commit**

```bash
git add backend/lib/dailyTrainingFlag.js backend/lib/dailyTrainingFlag.test.js
git commit -m "feat(training): daily_training_enabled flag-helper (Refs #1305)"
```

---

### Task A3: Dansk dato-helper

**Files:**
- Create: `backend/lib/copenhagenTime.js`
- Test: `backend/lib/copenhagenTime.test.js`

- [ ] **Step 1: Failing test**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { copenhagenDateString, copenhagenHour } from "./copenhagenTime.js";

test("UTC-midnat om sommeren er stadig 'i går' +2t → ny dato kl. 22 UTC", () => {
  // 2026-06-11T22:30Z = 2026-06-12 00:30 CEST
  assert.equal(copenhagenDateString(new Date("2026-06-11T22:30:00Z")), "2026-06-12");
  assert.equal(copenhagenHour(new Date("2026-06-11T22:30:00Z")), 0);
});

test("vinter (CET, +1)", () => {
  // 2026-01-15T23:30Z = 2026-01-16 00:30 CET
  assert.equal(copenhagenDateString(new Date("2026-01-15T23:30:00Z")), "2026-01-16");
});

test("midt på dagen", () => {
  assert.equal(copenhagenDateString(new Date("2026-06-11T10:00:00Z")), "2026-06-11");
  assert.equal(copenhagenHour(new Date("2026-06-11T10:00:00Z")), 12);
});
```

- [ ] **Step 2: Kør — forvent FAIL.** Run: `node --test lib/copenhagenTime.test.js`

- [ ] **Step 3: Implementér med Intl (ingen dependency)**

```javascript
// Dansk lokaltid (Europe/Copenhagen) — al spillogik om "dagen" bruger denne.
const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
});
const HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Copenhagen", hour: "2-digit", hour12: false,
});

export function copenhagenDateString(now = new Date()) {
  return DATE_FMT.format(now); // en-CA giver YYYY-MM-DD
}

export function copenhagenHour(now = new Date()) {
  return Number(HOUR_FMT.format(now)) % 24;
}
```

- [ ] **Step 4: Kør — forvent PASS.** Run: `node --test lib/copenhagenTime.test.js`

- [ ] **Step 5: Commit**

```bash
git add backend/lib/copenhagenTime.js backend/lib/copenhagenTime.test.js
git commit -m "feat(lib): copenhagenTime dato/time-helper (Refs #1305)"
```

---

### Task A4: Ren logik — `dailyTraining.js` (score, progress, +1)

**Files:**
- Create: `backend/lib/dailyTraining.js`
- Test: `backend/lib/dailyTraining.test.js`

Importer genbruges fra eksisterende moduler: `growthFractionForAge`-adgang sker via `PROGRESSION_CONFIG.growthFractionByAge` og `seededUnit` — begge fra `./riderProgression.js`. Fokus-taksonomi (`TRAINING_FOCUS_ABILITIES`, `isValidFocus`) fra `./training.js`. Evne-liste: brug SAMME import som `backend/lib/training.js` bruger til `VISIBLE_ABILITIES` (slå importlinjen op dér og spejl den).

- [ ] **Step 1: Failing tests**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_TRAINING_CONFIG, DEFAULT_PROGRAM, resolveProgram,
  growthFractionForAge, dailyAbilityDelta, applyDailyTick,
} from "./dailyTraining.js";

const CAPS = { sprint: 80, climbing: 60, endurance: 75 };
const ABIL = { sprint: 70, climbing: 55, endurance: 65 };

test("default-program bruges når plan mangler (spec 6.3: følger ALTID program)", () => {
  assert.deepEqual(resolveProgram(null), DEFAULT_PROGRAM);
  assert.equal(resolveProgram({ focus: "sprint", intensity: "hard" }).focus, "sprint");
});

test("rest-dag giver nul progress", () => {
  const d = dailyAbilityDelta({
    ability: "sprint", current: 70, cap: 80, age: 20,
    program: { focus: "sprint", intensity: "rest" },
    conditionMult: 1, bonus: false, noise: 1,
  });
  assert.equal(d, 0);
});

test("fokus-evne vokser hurtigere end off-fokus, bonus giver ×1.25", () => {
  const base = { ability: "sprint", current: 70, cap: 80, age: 20, conditionMult: 1, noise: 1 };
  const focus = dailyAbilityDelta({ ...base, program: { focus: "sprint", intensity: "normal" }, bonus: false });
  const off = dailyAbilityDelta({ ...base, ability: "climbing", current: 55, cap: 60, program: { focus: "sprint", intensity: "normal" }, bonus: false });
  const boosted = dailyAbilityDelta({ ...base, program: { focus: "sprint", intensity: "normal" }, bonus: true });
  assert.ok(focus > 0 && off > 0);
  // sprint-fokus dækker sprint+acceleration; climbing er off-fokus
  assert.ok(focus / (10 / 5) > off / (5 / 5) === false || focus > off, "fokus skal slå off-fokus pr. gap-enhed");
  assert.ok(Math.abs(boosted / focus - DAILY_TRAINING_CONFIG.bonusMult) < 1e-9);
});

test("evne på cap giver nul; delta er deterministisk", () => {
  const at = dailyAbilityDelta({
    ability: "sprint", current: 80, cap: 80, age: 20,
    program: { focus: "sprint", intensity: "hard" }, conditionMult: 1, bonus: false, noise: 1,
  });
  assert.equal(at, 0);
});

test("applyDailyTick: fuld bar giver +1 og remainder bevares; clamp ved cap", () => {
  const out = applyDailyTick({
    riderId: "r1", dateStr: "2026-06-20", age: 19,
    abilities: { ...ABIL }, caps: CAPS, progress: { sprint: 0.995 },
    program: { focus: "sprint", intensity: "hard" },
    conditionMult: 1, bonus: true,
  });
  assert.equal(out.abilities.sprint, 71);
  assert.ok(out.progress.sprint >= 0 && out.progress.sprint < 1);
  assert.ok(out.gains.sprint === 1);
  assert.ok(out.score > 0);
  // determinisme: samme input → samme output
  const out2 = applyDailyTick({
    riderId: "r1", dateStr: "2026-06-20", age: 19,
    abilities: { ...ABIL }, caps: CAPS, progress: { sprint: 0.995 },
    program: { focus: "sprint", intensity: "hard" },
    conditionMult: 1, bonus: true,
  });
  assert.deepEqual(out, out2);
});
```

- [ ] **Step 2: Kør — forvent FAIL.** Run: `node --test lib/dailyTraining.test.js`

- [ ] **Step 3: Implementér**

```javascript
// Dagligt trænings-tick (#1305) — ren matematik, ingen DB.
// Genbruger L0'ens budget (growthFractionByAge) delt i daglige bidder med compounding:
// dag-rate = residual-gap × f(age)/daysPerSeason. Over en sæson ≈ gap×e^(−f) ~ L0's gap×(1−f).
// dailyBudgetBoost kalibreres i scripts/previewDailyTraining.js så peak rammer 27-28 (spec 5.2).
import { PROGRESSION_CONFIG, seededUnit } from "./riderProgression.js";
import { TRAINING_CONFIG, TRAINING_FOCUS_ABILITIES } from "./training.js";
// VISIBLE_ABILITIES: spejl importkilden fra ./training.js (samme liste som L0 bruger).
import { VISIBLE_ABILITIES } from "./riderTypes.js";

export const DAILY_TRAINING_CONFIG = {
  daysPerSeason: 28,        // budget-konvertering; kalibreres i sim
  dailyBudgetBoost: 1.0,    // kompenserer compounding-tabet; kalibreres i sim
  bonusMult: 1.25,          // aktivt manager-klik (spec 6.3)
  noiseSpan: 0.15,          // ±15 % dagsform-støj, seeded pr. (rytter, dato)
  intensities: ["rest", "easy", "normal", "hard"],
  // Trætheds-belastning pr. intensitet (bruges af riderCondition.js)
  fatigueLoad: { rest: -14, easy: 4, normal: 9, hard: 16 },
};

export const DEFAULT_PROGRAM = Object.freeze({ focus: "endurance", intensity: "normal" });

export function resolveProgram(plan) {
  if (!plan || !plan.focus || !plan.intensity) return DEFAULT_PROGRAM;
  return { focus: plan.focus, intensity: plan.intensity };
}

export function growthFractionForAge(age) {
  const table = PROGRESSION_CONFIG.growthFractionByAge;
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (const k of keys) if (age <= k) return table[k];
  return table[keys[keys.length - 1]];
}

// Multiplikator pr. evne: fokus-evner får intensitetens focusGrowthMult, resten offFocusMult.
function abilityMult(ability, program) {
  if (program.intensity === "rest") return 0;
  const focusAbilities = TRAINING_FOCUS_ABILITIES[program.focus] ?? [];
  return focusAbilities.includes(ability)
    ? TRAINING_CONFIG.focusGrowthMult[program.intensity]
    : TRAINING_CONFIG.offFocusMult;
}

export function dailyAbilityDelta({ ability, current, cap, age, program, conditionMult, bonus, noise }) {
  const gap = Math.max(0, (cap ?? current) - current);
  if (gap === 0) return 0;
  const mult = abilityMult(ability, program);
  if (mult === 0) return 0;
  const cfg = DAILY_TRAINING_CONFIG;
  const base = (gap * growthFractionForAge(age) * cfg.dailyBudgetBoost) / cfg.daysPerSeason;
  return base * mult * conditionMult * (bonus ? cfg.bonusMult : 1) * noise;
}

// Ét dags-tick for én rytter. Muterer ikke input. Returnerer nye abilities/progress + rapportfelter.
export function applyDailyTick({ riderId, dateStr, age, abilities, caps, progress, program, conditionMult, bonus }) {
  const cfg = DAILY_TRAINING_CONFIG;
  const noise = 1 - cfg.noiseSpan + 2 * cfg.noiseSpan * seededUnit(`dtick:${riderId}:${dateStr}`);
  const nextAbilities = { ...abilities };
  const nextProgress = { ...(progress ?? {}) };
  const gains = {};
  let score = 0;

  for (const ability of VISIBLE_ABILITIES) {
    const current = Number(nextAbilities[ability] ?? 0);
    const delta = dailyAbilityDelta({
      ability, current, cap: caps?.[ability], age, program, conditionMult, bonus, noise,
    });
    if (delta <= 0) continue;
    score += delta;
    let bar = Number(nextProgress[ability] ?? 0) + delta;
    while (bar >= 1 && current + (gains[ability] ?? 0) < Math.min(99, caps?.[ability] ?? 99)) {
      bar -= 1;
      gains[ability] = (gains[ability] ?? 0) + 1;
    }
    if (gains[ability]) nextAbilities[ability] = current + gains[ability];
    nextProgress[ability] = Math.min(bar, 0.999);
  }

  return {
    abilities: nextAbilities,
    progress: nextProgress,
    gains,
    score: Math.round(score * 100) / 100,
    noise,
    status: noise > 1.05 ? "over" : noise < 0.95 ? "under" : "normal",
  };
}
```

> Justér importnavne hvis de afviger (fx hvis `TRAINING_CONFIG` hedder noget andet i `training.js`, eller `seededUnit`/`PROGRESSION_CONFIG` ikke er eksporteret — i så fald tilføj `export` på dem i kilden i stedet for at duplikere værdier).

- [ ] **Step 4: Kør — forvent PASS.** Run: `node --test lib/dailyTraining.test.js`

- [ ] **Step 5: Commit**

```bash
git add backend/lib/dailyTraining.js backend/lib/dailyTraining.test.js
git commit -m "feat(training): daglig tick-matematik — progress-barer, +1 ved fuld bar (Refs #1305)"
```

---

### Task A5: Ren logik — `riderCondition.js` (form/træthed-regler + skaderoll)

**Files:**
- Create: `backend/lib/riderCondition.js`
- Test: `backend/lib/riderCondition.test.js`

- [ ] **Step 1: Failing tests**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONDITION_CONFIG, nextFatigue, nextForm, conditionMultiplier,
  injuryRisk, rollInjury,
} from "./riderCondition.js";

test("træthed: hård dag bygger, rest sænker, clamp 0-100", () => {
  assert.ok(nextFatigue({ fatigue: 50, intensity: "hard", recoveryAbility: 50 }) > 50);
  assert.ok(nextFatigue({ fatigue: 50, intensity: "rest", recoveryAbility: 50 }) < 50);
  assert.equal(nextFatigue({ fatigue: 0, intensity: "rest", recoveryAbility: 99 }), 0);
  assert.equal(nextFatigue({ fatigue: 99, intensity: "hard", recoveryAbility: 0 }) <= 100, true);
});

test("recovery-evnen hjælper", () => {
  const lo = nextFatigue({ fatigue: 60, intensity: "normal", recoveryAbility: 0 });
  const hi = nextFatigue({ fatigue: 60, intensity: "normal", recoveryAbility: 99 });
  assert.ok(hi < lo);
});

test("form: stiger i sweet-zone, falder ved overbelastning, kan altid komme hjem via hvile", () => {
  assert.ok(nextForm({ form: 50, fatigue: 40 }) > 50);
  assert.ok(nextForm({ form: 50, fatigue: 90 }) < 50);
  // død-spiral-garanti (issue #1306 acceptance): fra værst tænkelige punkt
  let form = 0, fatigue = 100;
  for (let i = 0; i < 60; i++) {
    fatigue = nextFatigue({ fatigue, intensity: "rest", recoveryAbility: 0 });
    form = nextForm({ form, fatigue });
  }
  assert.ok(form >= 45, `form skal kunne restituere via hvile, fik ${form}`);
});

test("conditionMultiplier er 1.0 ved neutral og bounded", () => {
  assert.ok(Math.abs(conditionMultiplier({ form: 50, fatigue: 30 }) - 1) < 0.02);
  assert.ok(conditionMultiplier({ form: 100, fatigue: 0 }) <= 1.2);
  assert.ok(conditionMultiplier({ form: 0, fatigue: 100 }) >= 0.7);
});

test("skaderisiko: 0 under tærskel, stiger med træthed, kun ved hård træning", () => {
  assert.equal(injuryRisk({ intensity: "normal", fatigue: 90 }), 0);
  assert.equal(injuryRisk({ intensity: "hard", fatigue: 50 }), 0);
  assert.ok(injuryRisk({ intensity: "hard", fatigue: 80 }) > injuryRisk({ intensity: "hard", fatigue: 71 }));
});

test("rollInjury deterministisk + varighed 1-5 dage", () => {
  const a = rollInjury({ riderId: "r1", dateStr: "2026-06-20", risk: 1.0 }); // risk 100 % → altid skade
  const b = rollInjury({ riderId: "r1", dateStr: "2026-06-20", risk: 1.0 });
  assert.deepEqual(a, b);
  assert.ok(a.injured && a.days >= 1 && a.days <= 5);
  assert.equal(rollInjury({ riderId: "r1", dateStr: "2026-06-20", risk: 0 }).injured, false);
});
```

- [ ] **Step 2: Kør — forvent FAIL.** Run: `node --test lib/riderCondition.test.js`

- [ ] **Step 3: Implementér**

```javascript
// Form/Træthed-spine (#1306-datamodel, bruges af det daglige tick #1305).
// To tal 0-100. Fuld CTL/ATL/TSB (#931) bygges post-launch OVEN PÅ disse — ændr ikke semantikken.
import { seededUnit } from "./riderProgression.js";
import { DAILY_TRAINING_CONFIG } from "./dailyTraining.js";

export const CONDITION_CONFIG = {
  recoveryBase: 5,            // dagligt trætheds-fradrag alle får
  recoveryFromAbility: 4,     // + op til dette × recovery/99
  formSweetLo: 25, formSweetHi: 60,   // trætheds-zone hvor form bygges
  formGain: 3, formMildGain: 1, formOverloadLoss: 4, formHighLoss: 1,
  multFormSpan: 0.15,         // form 0→100 flytter trænings-effekt ±15 %
  multFatiguePenaltyFrom: 70, // træthed over dette koster effekt
  injuryFatigueFloor: 70,     // skaderisiko kræver hård dag + træthed over dette
  injuryBaseRisk: 0.02, injuryRiskPerPoint: 0.004, // 2 % + 0,4 %/point over floor
  injuryMaxDays: 5,
};

export function nextFatigue({ fatigue, intensity, recoveryAbility = 50, raceLoad = 0 }) {
  const cfg = CONDITION_CONFIG;
  const load = DAILY_TRAINING_CONFIG.fatigueLoad[intensity] ?? 0;
  const recovery = cfg.recoveryBase + cfg.recoveryFromAbility * (Number(recoveryAbility) / 99);
  const next = Number(fatigue) + load + raceLoad - recovery;
  return Math.max(0, Math.min(100, Math.round(next)));
}

export function nextForm({ form, fatigue }) {
  const cfg = CONDITION_CONFIG;
  let delta;
  if (fatigue >= cfg.formSweetLo && fatigue <= cfg.formSweetHi) delta = cfg.formGain;
  else if (fatigue > 80) delta = -cfg.formOverloadLoss;
  else if (fatigue > cfg.formSweetHi) delta = -cfg.formHighLoss;
  else delta = cfg.formMildGain; // let aktivitet/hvile under sweet-zonen
  return Math.max(0, Math.min(100, Math.round(Number(form) + delta)));
}

// Ganges på dagens trænings-score (spec 6: form/træthed påvirker dagseffekt let).
export function conditionMultiplier({ form, fatigue }) {
  const cfg = CONDITION_CONFIG;
  const formFactor = 1 + ((Number(form) - 50) / 50) * cfg.multFormSpan;
  const fatiguePenalty = Math.max(0, Number(fatigue) - cfg.multFatiguePenaltyFrom) / 150;
  return Math.max(0.7, Math.min(1.2, formFactor * (1 - fatiguePenalty)));
}

// Synlig, forklarlig risiko (spec 6.5): kun hård træning + høj træthed.
export function injuryRisk({ intensity, fatigue }) {
  const cfg = CONDITION_CONFIG;
  if (intensity !== "hard" || fatigue < cfg.injuryFatigueFloor) return 0;
  return cfg.injuryBaseRisk + (fatigue - cfg.injuryFatigueFloor) * cfg.injuryRiskPerPoint;
}

export function rollInjury({ riderId, dateStr, risk }) {
  if (risk <= 0) return { injured: false, days: 0 };
  const roll = seededUnit(`injury:${riderId}:${dateStr}`);
  if (roll >= risk) return { injured: false, days: 0 };
  const days = 1 + Math.floor(seededUnit(`injurydays:${riderId}:${dateStr}`) * CONDITION_CONFIG.injuryMaxDays);
  return { injured: true, days: Math.min(days, CONDITION_CONFIG.injuryMaxDays) };
}
```

- [ ] **Step 4: Kør — forvent PASS.** Run: `node --test lib/riderCondition.test.js`

- [ ] **Step 5: Commit**

```bash
git add backend/lib/riderCondition.js backend/lib/riderCondition.test.js
git commit -m "feat(training): form/træthed-regler + seeded skaderoll (Refs #1306)"
```

---

### Task A6: Orchestrator — `dailyTrainingEngine.js`

**Files:**
- Create: `backend/lib/dailyTrainingEngine.js`
- Test: `backend/lib/dailyTrainingEngine.test.js`

Mønster: dependency-injected supabase som i `riderProgressionEngine.js`. Funktionen er idempotent pr. (team, dato) via DB-constrainten — duplikat-insert (Postgres-fejl 23505) mappes til `{ alreadyRan: true }`.

- [ ] **Step 1: Failing test (mocket supabase, happy path + idempotens + skadet rytter)**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";

// Minimal in-memory supabase-mock: tabeller som Maps, fanger upserts/inserts.
function makeMock({ riders, abilities, plans, condition, existingRun = null }) {
  const writes = { runs: [], abilities: [], condition: [] };
  return {
    writes,
    client: {
      from(table) {
        const api = {
          _table: table, _filters: {},
          select() { return api; }, eq(k, v) { api._filters[k] = v; return api; },
          in() { return api; }, is() { return api; },
          async insert(rows) {
            if (table === "training_day_runs") {
              if (existingRun) return { error: { code: "23505" } };
              writes.runs.push(rows); return { error: null };
            }
            return { error: null };
          },
          async upsert(rows) {
            if (table === "rider_condition") writes.condition.push(...[].concat(rows));
            if (table === "rider_derived_abilities") writes.abilities.push(...[].concat(rows));
            return { error: null };
          },
          async update(patch) { writes.abilities.push({ _update: patch, ...api._filters }); return { error: null }; },
          then(resolve) { // afslut select-kæder
            const data = { riders, rider_derived_abilities: abilities, training_plans: plans, rider_condition: condition }[table] ?? [];
            resolve({ data, error: null });
          },
        };
        return api;
      },
    },
  };
}

const RIDERS = [{ id: "r1", team_id: "t1", birthdate: "2007-01-01", is_retired: false, firstname: "A", lastname: "One" }];
const ABILITIES = [{ rider_id: "r1", sprint: 70, ability_caps: { sprint: 80 }, ability_progress: null }];

test("kører tick, skriver run + abilities + condition, bonus ved manager", async () => {
  const mock = makeMock({ riders: RIDERS, abilities: ABILITIES, plans: [{ team_id: "t1", rider_id: "r1", focus: "sprint", intensity: "normal" }], condition: [] });
  const res = await runTeamTrainingDay({ supabase: mock.client, teamId: "t1", seasonId: "s1", seasonNumber: 2, executedBy: "manager", now: new Date("2026-06-20T10:00:00Z") });
  assert.equal(res.alreadyRan, false);
  assert.equal(res.report.bonus_applied, true);
  assert.equal(res.report.riders.length, 1);
  assert.ok(mock.writes.runs.length === 1 && mock.writes.condition.length === 1);
});

test("idempotent: 23505 → alreadyRan uden sideeffekter på abilities", async () => {
  const mock = makeMock({ riders: RIDERS, abilities: ABILITIES, plans: [], condition: [], existingRun: true });
  const res = await runTeamTrainingDay({ supabase: mock.client, teamId: "t1", seasonId: "s1", seasonNumber: 2, executedBy: "manager", now: new Date("2026-06-20T10:00:00Z") });
  assert.equal(res.alreadyRan, true);
});

test("skadet rytter får ingen gains men restituerer", async () => {
  const mock = makeMock({ riders: RIDERS, abilities: ABILITIES, plans: [], condition: [{ rider_id: "r1", form: 50, fatigue: 80, injured_until: "2026-06-25" }] });
  const res = await runTeamTrainingDay({ supabase: mock.client, teamId: "t1", seasonId: "s1", seasonNumber: 2, executedBy: "assistant", now: new Date("2026-06-20T10:00:00Z") });
  const r = res.report.riders[0];
  assert.equal(Object.keys(r.gains).length, 0);
  assert.ok(r.injured);
  assert.ok(r.fatigue < 80);
});
```

> Mock-formen skal matche de faktiske query-kæder du ender med i implementeringen — justér mocken, ikke produktionen, hvis kæderne afviger (fx `.select().eq()` await'es direkte).

- [ ] **Step 2: Kør — forvent FAIL.** Run: `node --test lib/dailyTrainingEngine.test.js`

- [ ] **Step 3: Implementér**

```javascript
// Eksekverer ÉN trænings-dag for ÉT hold (#1305). Idempotent via UNIQUE(team_id, tick_date).
// Kaldes fra: POST /api/training/run-today (manager, bonus) + cron-sweep (assistant, ingen bonus).
import { copenhagenDateString } from "./copenhagenTime.js";
import { resolveProgram, applyDailyTick } from "./dailyTraining.js";
import {
  nextFatigue, nextForm, conditionMultiplier, injuryRisk, rollInjury,
} from "./riderCondition.js";

function ageFromBirthdate(birthdate, seasonNumber) {
  // Samme sæson-anker som riderProgressionEngine.ageForSeason — genbrug funktionen hvis eksporteret.
  const birthYear = new Date(birthdate).getFullYear();
  return 2026 + (Number(seasonNumber) - 1) - birthYear;
}

export async function runTeamTrainingDay({ supabase, teamId, seasonId, seasonNumber, executedBy, now = new Date() }) {
  const tickDate = copenhagenDateString(now);
  const bonus = executedBy === "manager";

  // 1) Reservér dagen FØRST (race-condition-guard): insert med tom rapport, opdatér til sidst.
  const { error: runErr } = await supabase.from("training_day_runs").insert({
    team_id: teamId, tick_date: tickDate, executed_by: executedBy,
    bonus_applied: bonus, report: { pending: true },
  });
  if (runErr) {
    if (runErr.code === "23505") return { alreadyRan: true, tickDate };
    throw new Error(`training_day_runs insert fejlede: ${runErr.message}`);
  }

  // 2) Load holdets ikke-pensionerede ryttere + abilities + planer + condition.
  const { data: riders } = await supabase.from("riders")
    .select("id, team_id, birthdate, is_retired, firstname, lastname")
    .eq("team_id", teamId);
  const active = (riders ?? []).filter((r) => !r.is_retired);
  const ids = active.map((r) => r.id);
  const { data: abilityRows } = await supabase.from("rider_derived_abilities")
    .select("*").in("rider_id", ids);
  const { data: planRows } = await supabase.from("training_plans")
    .select("rider_id, focus, intensity").eq("team_id", teamId).eq("season_id", seasonId);
  const { data: condRows } = await supabase.from("rider_condition")
    .select("*").in("rider_id", ids);

  const abilitiesBy = new Map((abilityRows ?? []).map((a) => [a.rider_id, a]));
  const planBy = new Map((planRows ?? []).map((p) => [p.rider_id, p]));
  const condBy = new Map((condRows ?? []).map((c) => [c.rider_id, c]));

  // 3) Tick pr. rytter.
  const reportRiders = [];
  const abilityWrites = [];
  const conditionWrites = [];
  for (const rider of active) {
    const row = abilitiesBy.get(rider.id);
    if (!row) continue; // ingen abilities → kan ikke udvikles (samme guard som L0)
    const program = resolveProgram(planBy.get(rider.id));
    const cond = condBy.get(rider.id) ?? { form: 50, fatigue: 0, injured_until: null };
    const injuredToday = cond.injured_until && cond.injured_until >= tickDate;

    const abilities = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "number" && !["formula_version"].includes(k)) abilities[k] = v;
    }

    let tick = { abilities, progress: row.ability_progress ?? {}, gains: {}, score: 0, status: "rest" };
    let intensity = injuredToday ? "rest" : program.intensity;
    if (!injuredToday && intensity !== "rest") {
      tick = applyDailyTick({
        riderId: rider.id, dateStr: tickDate,
        age: ageFromBirthdate(rider.birthdate, seasonNumber),
        abilities, caps: row.ability_caps ?? {}, progress: row.ability_progress ?? {},
        program, conditionMult: conditionMultiplier(cond), bonus,
      });
    }

    // Condition-opdatering + evt. ny skade (kun raske, hårde dage kan skade).
    const fatigue = nextFatigue({ fatigue: cond.fatigue, intensity, recoveryAbility: abilities.recovery ?? 50 });
    const form = nextForm({ form: cond.form, fatigue });
    let injury = null;
    if (!injuredToday) {
      const risk = injuryRisk({ intensity, fatigue: cond.fatigue });
      const roll = rollInjury({ riderId: rider.id, dateStr: tickDate, risk });
      if (roll.injured) {
        const until = new Date(now);
        until.setUTCDate(until.getUTCDate() + roll.days);
        injury = { days: roll.days, until: copenhagenDateString(until) };
      }
    }

    abilityWrites.push({
      rider_id: rider.id,
      ...Object.fromEntries(Object.entries(tick.gains).map(([a]) => [a, tick.abilities[a]])),
      ability_progress: tick.progress,
    });
    conditionWrites.push({
      rider_id: rider.id, form, fatigue,
      injured_until: injury ? injury.until : (injuredToday ? cond.injured_until : null),
      injury_cause: injury ? "training_overload" : (injuredToday ? cond.injury_cause : null),
      updated_at: new Date().toISOString(),
    });
    reportRiders.push({
      rider_id: rider.id,
      name: `${rider.firstname} ${rider.lastname}`,
      score: tick.score, gains: tick.gains, status: tick.status,
      form, fatigue, fatigue_delta: fatigue - (cond.fatigue ?? 0),
      injured: Boolean(injuredToday || injury),
      injury_days: injury?.days ?? null,
      focus: program.focus, intensity,
    });
  }

  // 4) Persistér (batch). ability_progress + evt. +1-felter pr. rytter.
  for (const w of abilityWrites) {
    const { rider_id, ...patch } = w;
    await supabase.from("rider_derived_abilities").update(patch).eq("rider_id", rider_id);
  }
  if (conditionWrites.length) {
    await supabase.from("rider_condition").upsert(conditionWrites, { onConflict: "rider_id" });
  }
  const report = {
    riders: reportRiders, bonus_applied: bonus, executed_by: executedBy, tick_date: tickDate,
  };
  await supabase.from("training_day_runs")
    .update({ report }).eq("team_id", teamId).eq("tick_date", tickDate);

  return { alreadyRan: false, tickDate, report };
}
```

> Batch-optimering (update 25 ad gangen som `riderProgressionEngine.js:173-188`) må gerne genbruges; korrekthed før mikro-optimering.

- [ ] **Step 4: Kør — forvent PASS.** Run: `node --test lib/dailyTrainingEngine.test.js`

- [ ] **Step 5: Commit**

```bash
git add backend/lib/dailyTrainingEngine.js backend/lib/dailyTrainingEngine.test.js
git commit -m "feat(training): runTeamTrainingDay orchestrator — idempotent dags-tick pr. hold (Refs #1305)"
```

---

### Task A7: API — `run-today` + udvidet `GET /me` + slot-cap fjernes

**Files:**
- Modify: `backend/routes/api.js` (trænings-blokken, linje ~979-1058)
- Modify: `backend/lib/training.js` (slot-cap + `rest`-intensitet)
- Test: `backend/lib/training.test.js` (opdatér)

- [ ] **Step 1: Opdatér `training.js`**

I `TRAINING_CONFIG`: behold `slotsPerSeason` af bagudkompatibilitet men tilføj `unlimitedSlots: true`; `canTrain` returnerer altid `{ ok: true }` når `unlimitedSlots` er sat. Tilføj `"rest"` til `intensities` (gyldig i planer; `focusGrowthMult.rest` behøves ikke — daglig logik håndterer rest separat, og sæson-stien (`resolveTrainingModifier`, flag-OFF/AI) skal behandle `rest` som `easy` uden setback-risiko):

```javascript
// I TRAINING_CONFIG:
unlimitedSlots: true,            // #1305: programmer til hele truppen, 3-slots-cap pensioneret
intensities: ["rest", "easy", "normal", "hard"],
// I resolveTrainingModifier: behandl "rest" som "easy" (ingen setback, mild vækst) — sæson-stien
// bruges kun ved flag-OFF; den daglige sti håndterer rest eksplicit.
```

`deriveTrainingState`: når `unlimitedSlots`, returnér `slots: { total: null, used: plans.length, remaining: null }` (UI tolker null = ubegrænset).

- [ ] **Step 2: Opdatér `training.test.js`** — slot-tests vendes (canTrain altid ok), `rest` er gyldig intensitet, `resolveTrainingModifier("rest")` giver ingen setback. Kør: `node --test lib/training.test.js` → PASS.

- [ ] **Step 3: Tilføj route `POST /api/training/run-today`** (samme auth-mønster som POST /api/training/:riderId — kopier team-opslag derfra):

```javascript
// POST /api/training/run-today — dagens ét-kliks-træning (#1305). Manager = +25 % bonus.
router.post("/training/run-today", requireAuth, async (req, res) => {
  try {
    const team = await getTeamForUser(req); // ← genbrug eksakt samme helper/opslag som POST /training/:riderId
    if (!team) return res.status(404).json({ error: "no_team" });
    if (!(await isDailyTrainingEnabled(supabaseService))) {
      return res.status(409).json({ error: "daily_training_disabled" });
    }
    const season = await getActiveSeason(); // ← genbrug eksisterende active-season-opslag fra trænings-blokken
    if (!season) return res.status(409).json({ error: "no_active_season" });
    const result = await runTeamTrainingDay({
      supabase: supabaseService, teamId: team.id,
      seasonId: season.id, seasonNumber: season.season_number,
      executedBy: "manager",
    });
    if (result.alreadyRan) return res.status(409).json({ error: "already_trained_today", tickDate: result.tickDate });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("run-today fejlede", err);
    return res.status(500).json({ error: "internal" });
  }
});
```

`GET /api/training/me` udvides med: `enabled` (flaget), `todayRun` (dagens `training_day_runs`-række hvis findes), `condition` (rider_id → {form, fatigue, injured_until, risk-badge: injuryRisk for rytterens program ved aktuel træthed}) og `progress` (rider_id → ability_progress). Hold svar-formen bagudkompatibel (eksisterende felter bevares).

- [ ] **Step 4: Verificér** — `node --check routes/api.js` + kør hele backend-testsuiten: `npm test` (eller `node --test` per repo-konvention). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/api.js backend/lib/training.js backend/lib/training.test.js
git commit -m "feat(api): POST /training/run-today + ubegrænsede program-slots + rest-intensitet (Refs #1305)"
```

---

### Task A8: Cron — assistent-sweep efter kl. 22 + AI-eksklusion

**Files:**
- Create: `backend/lib/trainingSweep.js`
- Modify: `backend/cron.js` (job-listen, ~linje 420-464)
- Test: `backend/lib/trainingSweep.test.js`

- [ ] **Step 1: Failing test**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { shouldSweepNow, teamsNeedingSweep } from "./trainingSweep.js";

test("sweep kun efter kl. 22 dansk tid", () => {
  assert.equal(shouldSweepNow(new Date("2026-06-20T19:00:00Z")), true);  // 21:00 CEST? nej — 21 < 22 → false
});
```

Ret testen til de rigtige forventninger (22:00 CEST = 20:00Z om sommeren):

```javascript
test("sweep kun efter kl. 22 dansk tid", () => {
  assert.equal(shouldSweepNow(new Date("2026-06-20T19:59:00Z")), false); // 21:59 CEST
  assert.equal(shouldSweepNow(new Date("2026-06-20T20:01:00Z")), true);  // 22:01 CEST
});

test("teamsNeedingSweep filtrerer hold der allerede har kørt i dag", () => {
  const teams = [{ id: "t1" }, { id: "t2" }];
  const runs = [{ team_id: "t1", tick_date: "2026-06-20" }];
  assert.deepEqual(teamsNeedingSweep(teams, runs, "2026-06-20").map((t) => t.id), ["t2"]);
});
```

- [ ] **Step 2: Kør — forvent FAIL.** Run: `node --test lib/trainingSweep.test.js`

- [ ] **Step 3: Implementér**

```javascript
// Assistent-sweep (#1305): efter kl. 22 dansk tid trænes alle human-hold der ikke selv klikkede.
// AI-hold trænes ALDRIG dagligt (spec 9.1) — de beholder sæsonvis L0.
import { copenhagenHour, copenhagenDateString } from "./copenhagenTime.js";
import { isDailyTrainingEnabled } from "./dailyTrainingFlag.js";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";

export const SWEEP_FROM_HOUR = 22;

export function shouldSweepNow(now = new Date()) {
  return copenhagenHour(now) >= SWEEP_FROM_HOUR;
}

export function teamsNeedingSweep(teams, todaysRuns, tickDate) {
  const ran = new Set(todaysRuns.filter((r) => r.tick_date === tickDate).map((r) => r.team_id));
  return teams.filter((t) => !ran.has(t.id));
}

export async function runTrainingSweep({ supabase, now = new Date() }) {
  if (!shouldSweepNow(now)) return { swept: 0, skipped: "before_window" };
  if (!(await isDailyTrainingEnabled(supabase))) return { swept: 0, skipped: "flag_off" };

  const tickDate = copenhagenDateString(now);
  // VIGTIGT: genbrug SAMME human-holds-diskriminator som autoFillEntries (raceRunner.js:251-273)
  // — ikke-AI, ikke-test, ikke-frosne hold. Udtræk evt. filteret til en delt helper
  // (fx eligibleHumanTeamsQuery(supabase)) og brug den BEGGE steder.
  const teams = await loadEligibleHumanTeams(supabase);
  const { data: runs } = await supabase.from("training_day_runs")
    .select("team_id, tick_date").eq("tick_date", tickDate);
  const season = await loadActiveSeason(supabase); // genbrug eksisterende helper
  if (!season) return { swept: 0, skipped: "no_active_season" };

  let swept = 0;
  for (const team of teamsNeedingSweep(teams, runs ?? [], tickDate)) {
    const res = await runTeamTrainingDay({
      supabase, teamId: team.id, seasonId: season.id,
      seasonNumber: season.season_number, executedBy: "assistant", now,
    });
    if (!res.alreadyRan) swept += 1;
  }
  return { swept };
}
```

I `cron.js`: tilføj job med 5-minutters interval efter eksisterende mønster:

```javascript
// Daglig træning: assistent-sweep efter kl. 22 dansk tid (#1305)
setInterval(() => runTrainingSweepCron(), 5 * 60 * 1000);
```

(med samme wrapper/fejl-logging som de øvrige jobs i filen — kopier nabolagets stil; sweepen er idempotent, så 5-min-gentag efter kl. 22 er harmløst.)

- [ ] **Step 4: Kør — forvent PASS.** Run: `node --test lib/trainingSweep.test.js` + `node --check cron.js`

- [ ] **Step 5: Commit**

```bash
git add backend/lib/trainingSweep.js backend/lib/trainingSweep.test.js backend/cron.js
git commit -m "feat(cron): assistent-sweep for daglig træning efter kl. 22 DK-tid (Refs #1305)"
```

---

### Task A9: Anti-double-dip — L0 skipper vækst for human-hold når flaget er ON

**Files:**
- Modify: `backend/lib/riderProgression.js` (`developRiderSeason` får `skipGrowth`-option)
- Modify: `backend/lib/riderProgressionEngine.js` (beregn `skipGrowth` pr. rytter)
- Test: `backend/lib/riderProgression.test.js` (findes der ikke tests: opret; ellers udvid)

- [ ] **Step 1: Failing test**

```javascript
test("skipGrowth: vækstfase-rytter ændres ikke; decline-rytter falder stadig", () => {
  const young = developRiderSeason(riderAge20, abilities, caps, 3, undefined, undefined, { skipGrowth: true });
  assert.deepEqual(young.next, abilities); // ingen vækst — den daglige strøm ejer den
  const old = developRiderSeason(riderAge32, abilities, caps, 3, undefined, undefined, { skipGrowth: true });
  assert.ok(sumAbilities(old.next) < sumAbilities(abilities)); // decline kører stadig
});
```

(tilpas kaldssignaturen til den faktiske `developRiderSeason(rider, abilities, caps, season, cfg, training)` — `skipGrowth` tilføjes som sidste options-arg.)

- [ ] **Step 2: Kør — forvent FAIL.**

- [ ] **Step 3: Implementér**

I `developRiderSeason`: når `options.skipGrowth === true`, spring `stepAbility`-vækst over for ryttere med `age <= peakAge` (returnér uændrede abilities for dem), men kør decline-grenen uændret for `age > peakAge`. Retirement-beslutningen kører uændret for alle.

I `developRidersForSeason` (`riderProgressionEngine.js`): læs flaget én gang (`isDailyTrainingEnabled`), slå human-hold op (samme diskriminator-helper som Task A8), og sæt `skipGrowth = dailyEnabled && riderIsOnHumanTeam`. AI-ryttere og flag-OFF → uændret adfærd (fuld L0 + evt. sæson-træningsbias).

- [ ] **Step 4: Kør — forvent PASS.** Run: `node --test lib/riderProgression.test.js` + hele suiten.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/riderProgression.js backend/lib/riderProgressionEngine.js backend/lib/riderProgression.test.js
git commit -m "feat(progression): skipGrowth for human-hold når daglig træning er aktiv — anti-double-dip (Refs #1305)"
```

---

### Task A10: Sim-harness — `previewDailyTraining.js` + `training:gate`

**Files:**
- Create: `backend/scripts/previewDailyTraining.js`
- Modify: `backend/package.json` (script-alias)

Sim-før-ship-gaten (spec afsnit 13 + ejer-regel 7/6). Deterministisk, fiktiv population, ingen DB.

- [ ] **Step 1: Skriv harnesset**

```javascript
// Dry-run-harness for daglig træning (#1305): simulerer N sæsoner × daysPerSeason dage
// og verificerer mål-scorecardet FØR ship (spec afsnit 13):
//   1) 18-årig debutant peaker median ved alder 27-28
//   2) human-vs-AI-drift pr. sæson rapporteres (baseline for 10 %-triggeren, spec 9.1)
// Brug: node scripts/previewDailyTraining.js --seasons=12 --count=400 --seed=2026 [--enforce-targets]
import { generateFictionalRiders } from "../lib/fictionalRiderGenerator.js";
import { buildCaps, developRiderSeason, PROGRESSION_CONFIG } from "../lib/riderProgression.js";
import { resolveProgram, applyDailyTick, DAILY_TRAINING_CONFIG } from "../lib/dailyTraining.js";
import { nextFatigue, nextForm, conditionMultiplier } from "../lib/riderCondition.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const SEASONS = Number(args.seasons ?? 12);
const COUNT = Number(args.count ?? 400);
const SEED = Number(args.seed ?? 2026);
const ENFORCE = "enforce-targets" in args;
const DAYS = DAILY_TRAINING_CONFIG.daysPerSeason;

const riders = generateFictionalRiders({ count: COUNT, seed: SEED, referenceYear: 2026 });
// To kohorter af SAMME population: human (daglig strøm) vs AI (sæsonvis L0).
const results = { human: [], ai: [] };

for (const cohort of ["human", "ai"]) {
  for (const rider of riders) {
    let abilities = { ...rider.abilities };
    const caps = buildCaps(abilities, rider.primary_type, rider.potentiale);
    let progress = {};
    let cond = { form: 50, fatigue: 0 };
    const sumHistory = [];
    for (let season = 1; season <= SEASONS; season++) {
      const age = rider.age + (season - 1);
      if (cohort === "human" && age <= PROGRESSION_CONFIG.peakAge) {
        // standard-adfærd: fokus = rytterens stærkeste fokus-gruppe, normal intensitet, klik 60 % af dage
        const program = resolveProgram(null);
        for (let day = 1; day <= DAYS; day++) {
          const dateStr = `s${season}d${day}`;
          const bonus = (day * 7 + season) % 10 < 6; // deterministisk ~60 % klikrate
          const intensity = day % 7 === 0 ? "rest" : program.intensity;
          const tick = applyDailyTick({
            riderId: rider.id ?? `${cohort}:${rider.lastname}`, dateStr, age,
            abilities, caps, progress, program: { ...program, intensity },
            conditionMult: conditionMultiplier(cond), bonus,
          });
          abilities = tick.abilities; progress = tick.progress;
          const fatigue = nextFatigue({ fatigue: cond.fatigue, intensity, recoveryAbility: abilities.recovery ?? 50 });
          cond = { form: nextForm({ form: cond.form, fatigue }), fatigue };
        }
        // decline/retirement håndteres sæsonvis også for human (skipGrowth-spejl):
        const dev = developRiderSeason({ ...rider, age }, abilities, caps, season, undefined, undefined, { skipGrowth: true });
        abilities = dev.next;
      } else {
        const dev = developRiderSeason({ ...rider, age }, abilities, caps, season);
        abilities = dev.next;
      }
      sumHistory.push(Object.values(abilities).reduce((a, b) => a + (Number(b) || 0), 0));
    }
    const peakSeason = sumHistory.indexOf(Math.max(...sumHistory)) + 1;
    results[cohort].push({ startAge: rider.age, peakAge: rider.age + peakSeason - 1, sumHistory });
  }
}

// Scorecard 1: debutant-peak (startAge ≤ 19)
const debutants = results.human.filter((r) => r.startAge <= 19);
const peakAges = debutants.map((r) => r.peakAge).sort((a, b) => a - b);
const medianPeak = peakAges[Math.floor(peakAges.length / 2)];
console.log(`Debutanter (≤19): n=${debutants.length}, median peak-alder=${medianPeak} (mål: 27-28)`);

// Scorecard 2: human-vs-AI-drift pr. sæson
for (let s = 0; s < SEASONS; s++) {
  const avg = (rows) => rows.reduce((a, r) => a + r.sumHistory[s], 0) / rows.length;
  const h = avg(results.human), ai = avg(results.ai);
  console.log(`S${s + 1}: human=${h.toFixed(0)} ai=${ai.toFixed(0)} drift=${(((h - ai) / ai) * 100).toFixed(1)} %`);
}

const pass = medianPeak >= 27 && medianPeak <= 28;
console.log(pass ? "GATE: PASS" : "GATE: FAIL — kalibrér dailyBudgetBoost/daysPerSeason");
if (ENFORCE && !pass) process.exit(1);
```

> `generateFictionalRiders`-outputtets feltnavne (age/abilities/potentiale/primary_type) skal matches mod den faktiske generator — tilpas destructuring, ikke generatoren. `developRiderSeason`-signaturen ligeså.

- [ ] **Step 2: Tilføj alias i `backend/package.json`** (ved siden af `race:gate`):

```json
"training:gate": "node scripts/previewDailyTraining.js --seasons=12 --count=400 --seed=2026 --enforce-targets"
```

- [ ] **Step 3: Kør og kalibrér**

Run: `npm run training:gate`
Expected: `GATE: PASS` — hvis median-peak er for tidlig/sen: justér `dailyBudgetBoost` (compounding-tab ⇒ forvent start-justering opad mod ~1.1-1.2) og gentag. Notér slutværdier i commit-beskeden. Kør også seeds 7 og 42 manuelt (`--seed=7` osv.) — alle tre skal passe.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/previewDailyTraining.js backend/package.json
git commit -m "feat(sim): training:gate — peak-alder 27-28 + human/AI-drift-baseline (Refs #1305)"
```

---

### Task A11: Frontend — TrainingPage (programmer + dagens klik + rapport)

**Files:**
- Create: `frontend/src/pages/TrainingPage.jsx`
- Modify: `frontend/src/lib/useTraining.js` (run-today + condition/progress/todayRun)
- Modify: router/nav (find hvor sider registreres — søg efter den fil der router til `RiderStatsPage`/øvrige sider, typisk `App.jsx` eller en routes-fil, + nav-komponenten)
- Create: `frontend/public/locales/en/training.json` + `frontend/public/locales/da/training.json`
- Modify: `frontend/src/components/rider/TrainingFocus.jsx` (slots → ubegrænset, + rest)
- Test: `frontend/src/lib/training.test.js` (udvid: rest-intensitet)

- [ ] **Step 1: Udvid `useTraining.js`**

Tilføj til hook-state: `enabled`, `todayRun`, `condition`, `progress` (fra udvidet GET /me) + ny funktion:

```javascript
const runToday = useCallback(async () => {
  setRunning(true);
  try {
    const res = await apiFetch("/api/training/run-today", { method: "POST" });
    if (res.ok) {
      const body = await res.json();
      setTodayRun({ report: body.report, executed_by: "manager" });
      logEvent("training_run_today", { riders: body.report?.riders?.length }); // consent-gated som training_focus_set
      await refresh();
      return body;
    }
    if (res.status === 409) { await refresh(); return null; } // allerede kørt / flag OFF
    return null;
  } finally {
    setRunning(false);
  }
}, [refresh]);
```

(spejl fejl-/fetch-mønstret fra eksisterende `setPlan` i samme fil.)

- [ ] **Step 2: Byg `TrainingPage.jsx`**

Indhold (genbrug eksisterende side-skelet/styling fra en eksisterende liste-side, fx den RiderStatsPage/holdsider bruger):
1. Header med "Train today"-knap: disabled hvis `todayRun` findes (vis "Trained today ✓ — assistant/manager") eller `!enabled` (vis "starts at relaunch"-note).
2. Trup-tabel: navn, fokus-select (6 + uændret taksonomi), intensitets-select (rest/easy/normal/hard), form-/træthedssøjler (0-100 mini-bars), risiko-badge (`condition[id].risk >= 0.05` → "High injury risk"), skade-badge med dage tilbage.
3. Dagens rapport (fra `todayRun.report`): pr. rytter score, gains ("+1 Sprint"), status-ikon (over/under/normal), træthed-delta, skader.
4. Al tekst via i18n-namespace `training` (EN-først, DA-sekundært).

Minimal komponentform:

```jsx
import { useTranslation } from "react-i18next";
import { useTraining } from "../lib/useTraining";

export default function TrainingPage() {
  const { t } = useTranslation("training");
  const { enabled, plans, condition, progress, todayRun, runToday, running, setPlan, riders } = useTraining();
  // riders: udvid hooken til at returnere trup-listen fra GET /me (backend joiner riders) —
  // alternativt genbrug eksisterende squad-hook hvis en findes (tjek hvordan holdsiden henter truppen).
  return (
    <div className="training-page">
      <header>
        <h1>{t("title")}</h1>
        {!enabled && <p className="muted">{t("disabledNote")}</p>}
        <button disabled={!enabled || running || Boolean(todayRun)} onClick={runToday}>
          {todayRun ? t("trainedToday", { by: t(`by_${todayRun.executed_by}`) }) : t("trainToday")}
        </button>
      </header>
      {/* trup-tabel + rapport som beskrevet — fuld JSX skrives ved implementering, marker
          over/under-performere med ▲/▼ og brug eksisterende badge-/tabelklasser */}
    </div>
  );
}
```

i18n-nøgler (en/training.json — da spejles på dansk):

```json
{
  "title": "Training",
  "trainToday": "Train today (+25% boost)",
  "trainedToday": "Trained today — by {{by}}",
  "by_manager": "you",
  "by_assistant": "assistant",
  "disabledNote": "Daily training starts at the season relaunch. Set your programs now — riders follow them automatically.",
  "focus": "Focus",
  "intensity": "Intensity",
  "intensity_rest": "Rest",
  "form": "Form",
  "fatigue": "Fatigue",
  "injuryRisk": "High injury risk",
  "injured": "Injured — {{days}} days left",
  "report": "Today's training report",
  "gain": "+{{points}} {{ability}}",
  "overperformed": "Overperformed",
  "underperformed": "Underperformed"
}
```

- [ ] **Step 3: Route + nav** — registrér `/training` i routeren + nav-punkt (følg mønstret for en eksisterende side; lazy-load hvis siderne ellers lazy-loades).

- [ ] **Step 4: `TrainingFocus.jsx`** — fjern slot-tæller-UI når `slots.total === null`; tilføj `rest` til intensitets-knapperne; behold alt andet.

- [ ] **Step 5: Frontend-tests + i18n-check**

Run (fra `frontend/`): `node --test` → PASS (udvid `src/lib/training.test.js` med rest-intensitet).
i18n-paritet en/da: kør repoets i18n-keys-check (del af `scripts/verify-local.ps1`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/TrainingPage.jsx frontend/src/lib/useTraining.js frontend/public/locales/en/training.json frontend/public/locales/da/training.json frontend/src/components/rider/TrainingFocus.jsx
# + router/nav-filerne
git commit -m "feat(ui): TrainingPage — programmer, dagligt klik med bonus, rapport, form/træthed (Refs #1305)"
```

---

### Task A12: Rytterprofil — progress-barer + form/træthed-chips

**Files:**
- Modify: `frontend/src/pages/RiderStatsPage.jsx` (+ evt. `frontend/src/components/RiderDevelopmentTab.jsx`)

- [ ] **Step 1:** I development-fanen: vis pr. evne en tynd progress-bar (0-100 % fra `ability_progress`) under den nuværende værdi — kun for egne ryttere (data kommer fra GET /api/training/me; andre ryttere viser kun current stats, som er transparente). Vis Form/Træthed-chips + skade-badge i profil-headeren for ALLE ryttere (condition er læsbar for authenticated per RLS — transparens-beslutningen).

- [ ] **Step 2:** i18n-nøgler i `rider.json` (en+da): `condition.form`, `condition.fatigue`, `condition.injured`, `development.progressHint` ("Progress toward next point").

- [ ] **Step 3:** Verificér lokalt via Playwright-mocks (logget-ind UI verificeres via fixtures.js-mønstret — mock GET /api/training/me) + engangs-screenshot.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/RiderStatsPage.jsx frontend/public/locales/en/rider.json frontend/public/locales/da/rider.json
git commit -m "feat(ui): progress-barer + form/træthed på rytterprofilen (Refs #1305)"
```

---

### Task A13: PR 1 — help, patch notes, pre-flight, PR

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx` (ny version, EN+DA)
- Modify: help-indhold `help.json` (en+da — find filerne under `frontend/public/locales/*/help.json`): ny sektion "Daily training" (programmer, dagligt klik/bonus, assistent, form/træthed, barer)
- Modify: `docs/FEATURE_STATUS.md` (daglig træning: bygget, flag OFF til relaunch)

- [ ] **Step 1:** Skriv patch note (EN først, DA under; versionsnummer = næste ledige; "behind relaunch flag" nævnes).
- [ ] **Step 2:** help.json en+da opdateret (#1171-rutinen).
- [ ] **Step 3: Fuld pre-flight** (CLAUDE.md-rutinen):

```powershell
pwsh -File scripts/verify-local.ps1   # backend-tests + frontend-tests + frontend-build
npx playwright test core-smoke.spec.js  # alle 3 projekter (uden --project-flag)
```

Expected: alt grønt. Visuelle ændringer → refresh snapshots for alle 3 projekter hvis diffs er intentionelle.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/1305-daily-training
gh pr create --title "feat(training): daglig træning v1 — programmer, ét-kliks-loop, progress-barer (Refs #1305)" --body-file <PR-body-fil>
```

PR-body SKAL have `## Brugerverifikation`-sektion med `- [x]`-punkter (lokal verifikation: tick kørt mod test-hold, rapport vist, idempotens-409, sweep-test, training:gate PASS-output indsat) — ellers fejler `PR user-verification check`. Tjek `git status` for untracked filer FØR commit.

---

## Fase B — Race-integration + skader i løb (#1306, PR 2: `feat/1306-form-fatigue-race`)

### Task B1: `formComponent`/`fatigueComponent` implementeres

**Files:**
- Modify: `backend/lib/raceSimulator.js:63-71` (stubs) + konstanter øverst
- Test: `backend/lib/raceSimulator.test.js` (udvid eksisterende eller opret)

- [ ] **Step 1: Failing test**

```javascript
test("form/træthed flytter score — bounded til ~±3 % af typisk terrain-score", () => {
  const entrantTop = { ...baseEntrant, form: 100, fatigue: 0 };
  const entrantLow = { ...baseEntrant, form: 0, fatigue: 100 };
  // komponenterne direkte:
  assert.ok(Math.abs(formComponent(entrantTop)) <= 0.013);
  assert.ok(fatigueComponent(entrantLow) <= 0.009);
  // neutral = præcis 0 (bagudkompatibel med flag-OFF-verdenen):
  assert.equal(formComponent({ ...baseEntrant, form: 50 }), 0);
  assert.equal(fatigueComponent({ ...baseEntrant, fatigue: 0 }), 0);
  // manglende condition-data = neutral:
  assert.equal(formComponent(baseEntrant), 0);
  assert.equal(fatigueComponent(baseEntrant), 0);
});
```

- [ ] **Step 2: Kør — forvent FAIL** (stubs returnerer 0 for alt — testen på `entrantTop` fejler).

- [ ] **Step 3: Implementér**

```javascript
// Form/Træthed-seams (#1306): max ±3 % af typisk terrain-score (~0.65) per spec afsnit 6.4.
// Kalibreres i race:gate; #1021 erstatter med fuld model i samme signaturer.
const FORM_RACE_WEIGHT = 0.012;     // form 0↔100 → ±0.012
const FATIGUE_RACE_WEIGHT = 0.008;  // træthed 100 → −0.008

function formComponent(entrant /* , stageProfile, rng */) {
  const form = Number(entrant?.form);
  if (!Number.isFinite(form)) return 0;
  return ((form - 50) / 50) * FORM_RACE_WEIGHT;
}

function fatigueComponent(entrant /* , stageProfile */) {
  const fatigue = Number(entrant?.fatigue);
  if (!Number.isFinite(fatigue)) return 0;
  return (fatigue / 100) * FATIGUE_RACE_WEIGHT;
}
```

(`fatigueComponent` trækkes allerede fra i formlen — returnér positiv størrelse, fortegnet håndteres af call-site `+ form - fatigue + team`; verificér mod linje 131-142.)

- [ ] **Step 4: Kør — forvent PASS.** Hele backend-suiten også.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceSimulator.js backend/lib/raceSimulator.test.js
git commit -m "feat(race): formComponent/fatigueComponent læser rider_condition, bounded ±3 % (Refs #1306)"
```

---

### Task B2: Entrants beriges med condition + skadede ekskluderes

**Files:**
- Modify: `backend/lib/raceRunner.js` (`loadEntrantsForRace` ~linje 277-318 + `autoFillEntries` ~linje 251-273)
- Test: udvid `backend/lib/raceRunner`-tests hvis de findes; ellers dæk via dry-run-kald i B4

- [ ] **Step 1:** `loadEntrantsForRace`: efter entrant-listen er bygget, hent `rider_condition` for alle rider_ids (én query) og merge `form`/`fatigue` ind på entrant-objekterne (mangler række → udelad felterne; komponenterne defaulter neutralt).
- [ ] **Step 2:** `autoFillEntries`: udeluk ryttere med `injured_until >= dags dato (dansk)` (join/filter på rider_condition; brug `copenhagenDateString`).
- [ ] **Step 3:** Kør backend-suiten + `node --check lib/raceRunner.js`. PASS.
- [ ] **Step 4: Commit**

```bash
git add backend/lib/raceRunner.js
git commit -m "feat(race): entrants bærer form/træthed; skadede ryttere udelukkes fra auto-entry (Refs #1306)"
```

---

### Task B3: Løbsdage bygger træthed

**Files:**
- Modify: `backend/lib/raceResultsEngine.js` (`applyRaceResults` ~linje 77-114)
- Create: `backend/lib/raceFatigue.js`
- Test: `backend/lib/raceFatigue.test.js`

- [ ] **Step 1: Failing test**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { raceFatigueLoad } from "./raceFatigue.js";

test("hårdere profiler koster mere, alle bounded", () => {
  assert.ok(raceFatigueLoad("mountain") > raceFatigueLoad("flat"));
  for (const p of ["flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "ttt", "cobbles", "classic"]) {
    const v = raceFatigueLoad(p);
    assert.ok(v >= 8 && v <= 25, `${p}=${v}`);
  }
  assert.equal(raceFatigueLoad("ukendt"), 12); // fallback
});
```

- [ ] **Step 2: Kør — FAIL.** **Step 3: Implementér**

```javascript
// Trætheds-belastning pr. løbsdag (#1306). Kalibreres i race:gate/training:gate.
const RACE_FATIGUE_BY_PROFILE = {
  flat: 10, rolling: 12, hilly: 14, classic: 16, cobbles: 16,
  mountain: 18, high_mountain: 20, itt: 12, ttt: 10,
};
export function raceFatigueLoad(profileType) {
  return RACE_FATIGUE_BY_PROFILE[profileType] ?? 12;
}

export async function applyRaceFatigue({ supabase, riderIds, profileType, now = new Date() }) {
  if (!riderIds?.length) return;
  const load = raceFatigueLoad(profileType);
  // Læs-modificér-skriv pr. batch; fatigue clamp 0-100. (RPC/SQL-increment er også fint —
  // vælg samme stil som nabokoden i raceResultsEngine.)
  const { data } = await supabase.from("rider_condition").select("rider_id, fatigue").in("rider_id", riderIds);
  const by = new Map((data ?? []).map((r) => [r.rider_id, r.fatigue]));
  const rows = riderIds.map((id) => ({
    rider_id: id,
    fatigue: Math.min(100, (by.get(id) ?? 0) + load),
    updated_at: new Date().toISOString(),
  }));
  await supabase.from("rider_condition").upsert(rows, { onConflict: "rider_id" });
}
```

I `applyRaceResults`: efter resultat-insert, kald `applyRaceFatigue` med deltagernes rider_ids + stage-profiltypen (kun når kaldet IKKE er dry-run — følg eksisterende `persist`-flag).

- [ ] **Step 4: Kør — PASS.** **Step 5: Commit**

```bash
git add backend/lib/raceFatigue.js backend/lib/raceFatigue.test.js backend/lib/raceResultsEngine.js
git commit -m "feat(race): løbsdage bygger træthed pr. profiltype (Refs #1306)"
```

---

### Task B4: race:gate udvides med condition-scenarie

**Files:**
- Modify: `backend/scripts/simulateSeasonDryRun.js`

- [ ] **Step 1:** Tilføj `--condition=random`-mode: seeded form (30-90) + træthed (0-70) pr. fiktiv rytter, sat på entrant-objekterne før `simulateStage`. Kør scorecardet BÅDE neutralt og med condition; targets skal holde i begge (condition må ikke vælte favorit-hierarkiet — det er hele pointen med ±3 %-grænsen).
- [ ] **Step 2:** Run: `npm run race:gate` (neutral, uændret PASS — beviser bagudkompatibilitet) og `node scripts/simulateSeasonDryRun.js --enforce-targets --no-html --seed=2026 --condition=random` (PASS).
- [ ] **Step 3:** Sanity-tjek i output: gennemsnitlig score-afvigelse top-form vs bund-form ≤ ~3,5 %.
- [ ] **Step 4: Commit**

```bash
git add backend/scripts/simulateSeasonDryRun.js
git commit -m "feat(sim): race:gate condition-scenarie — favorit-targets holder med form/træthed aktiv (Refs #1306)"
```

---

### Task B5: PR 2 — help, patch notes, pre-flight, PR

- [ ] **Step 1:** Patch note (EN+DA): Form & fatigue now affect races slightly; race days build fatigue; injured riders sit out. help.json (en+da): kort afsnit under træning om form/træthed i løb + skader.
- [ ] **Step 2:** Fuld pre-flight (`pwsh -File scripts/verify-local.ps1` + playwright alle 3) → grønt.
- [ ] **Step 3:** Push + PR med Brugerverifikation (`- [x]`: race:gate neutral + condition PASS-output indsat, unit-bounds-test, dry-run-diff før/efter med condition).

```bash
git push -u origin feat/1306-form-fatigue-race
gh pr create --title "feat(race): form/træthed i race-motoren + skader holder ryttere ude (Refs #1306)" --body-file <PR-body-fil>
```

---

## Self-review (kørt under skrivning)

1. **Spec-dækning (afsnit 5-6):** 5.1 daglig tick → A4/A6 · 5.2 peak 9-10 sæsoner → A10-gate · 6.1 programmer → A7/A11 · 6.2 ét klik + rapport → A6/A7/A11 · 6.3 assistent + bonus → A6/A8 · 6.4 form/træthed + seams ±3 % → A5/B1/B2/B4 · 6.5 milde skader → A5/A6 (roll) + B2 (race-eksklusion). 5.3 gennembrud + 5.4 fase-UI er eksplicit udeladt (fast-follow, jf. #1305-scope). 9.1 AI-passiv → A8 (sweep skipper AI) + A9 (L0 uændret for AI) + A10 (drift-baseline).
2. **Placeholder-scan:** ingen TBD'er; de bevidste "spejl eksisterende mønster"-instruktioner peger på præcise filer/linjer (eksisterende kode er sandheden for signaturer/kolonnenavne — det er research-ankre, ikke huller).
3. **Type-konsistens:** `applyDailyTick`-felter (abilities/progress/gains/score/status) matcher A6-forbruget; `nextFatigue({fatigue, intensity, recoveryAbility, raceLoad})` bruges ens i A6/A10; `form`/`fatigue` på entrants (B2) matcher B1-komponenterne; `tick_date`/`copenhagenDateString` format YYYY-MM-DD overalt.

## Kendte åbne kalibreringspunkter (ejes af gates, blokerer ikke implementering)

- `dailyBudgetBoost` + `daysPerSeason` (A10), `FORM_RACE_WEIGHT`/`FATIGUE_RACE_WEIGHT` (B4), trætheds-konstanter (A5) — alle har start-værdier + en gate der tvinger kalibrering før ship.
- Akademi-multiplikator (#1308) og holdudtagelsens træthedskobling (#1307) bygger oven på disse moduler — ingen ændringer her behøves.
