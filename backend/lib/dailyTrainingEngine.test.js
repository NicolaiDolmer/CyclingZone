import test from "node:test";
import assert from "node:assert/strict";

import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

// ── In-memory Supabase-mock ───────────────────────────────────────────────────
// Understøtter: select/eq/in/update/insert/upsert/delete — de operationer engine'n bruger.
// insert returnerer { error: { code: "23505" } } for 2. kald på UNIQUE-nøgle
// med simuleret unique-violation.
// opts.injectRidersError = "message" → riders-select returnerer error med den besked.
// opts.deleteCalls = [] → array der samler { table, filters } for hvert .delete()-kald.
function createMockSupabase(state, opts = {}) {
  // opts.injectUniqueViolation = true → første INSERT på training_day_runs fejler 23505

  function builder(table, op = "select", filters = [], patch = null, inList = null) {
    const matchRow = (row) => {
      if (filters.some(([col, val]) => row[col] !== val)) return false;
      if (inList && !inList[1].includes(row[inList[0]])) return false;
      return true;
    };

    const obj = {
      select(/* _cols */) {
        // Vi ignorerer kolonne-selektionen og returnerer alle felter (mock).
        return builder(table, "select", filters, patch, inList);
      },
      eq(col, val) {
        const nf = [...filters, [col, val]];
        // Accumulate filters — flush happens on .then() / Promise resolution.
        return builder(table, op, nf, patch, inList);
      },
      in(col, vals) {
        return builder(table, op, filters, patch, [col, vals]);
      },
      order() { return builder(table, op, filters, patch, inList); },
      update(p) { return builder(table, "update", filters, p, inList); },
      delete() {
        return builder(table, "delete", filters, patch, inList);
      },
      insert(row) {
        state[table] ??= [];
        // Unique-violation simulation for training_day_runs.
        if (table === "training_day_runs" && opts.injectUniqueViolation) {
          opts.injectUniqueViolation = false; // kun én gang
          return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
        }
        // Check real UNIQUE(team_id, tick_date) i test-state.
        const r = Array.isArray(row) ? row[0] : row;
        const exists = state[table].some((x) => x.team_id === r.team_id && x.tick_date === r.tick_date);
        if (exists) {
          return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
        }
        state[table].push({ id: `run-${Date.now()}`, ...r });
        return Promise.resolve({ error: null });
      },
      upsert(rows, upsertOpts = {}) {
        // Best-effort-test: simulér fejl på historik-upserten (må ikke kaste).
        if (table === "rider_derived_ability_history" && opts.injectHistoryError) {
          return Promise.resolve({ error: { message: "history boom" } });
        }
        state[table] ??= [];
        const conflict = (upsertOpts.onConflict || "").split(",").map((s) => s.trim()).filter(Boolean);
        for (const r of (Array.isArray(rows) ? rows : [rows])) {
          const idx = conflict.length
            ? state[table].findIndex((x) => conflict.every((c) => x[c] === r[c]))
            : -1;
          if (idx >= 0) {
            if (!upsertOpts.ignoreDuplicates) Object.assign(state[table][idx], r);
          } else {
            state[table].push({ ...r });
          }
        }
        return Promise.resolve({ error: null });
      },
      then(resolve) {
        // Await-støtte: flush pending operation på .then().
        state[table] ??= [];
        let result;
        if (op === "update") {
          for (const row of state[table]) {
            if (matchRow(row)) Object.assign(row, patch);
          }
          result = { error: null };
        } else if (op === "delete") {
          if (opts.deleteCalls) opts.deleteCalls.push({ table, filters: [...filters] });
          state[table] = state[table].filter((row) => !matchRow(row));
          result = { error: null };
        } else {
          // select — injicér fejl hvis opts.injectRidersError matcher dette bord
          if (opts.injectRidersError && table === "riders") {
            result = { data: null, error: { message: opts.injectRidersError } };
          } else {
            result = { data: state[table].filter(matchRow), error: null };
          }
        }
        return Promise.resolve(result).then(resolve);
      },
    };

    // Gør builder thenable så `await supabase.from(...).select(...)...` virker.
    obj[Symbol.toStringTag] = "MockBuilder";
    return obj;
  }

  return {
    from(table) {
      state[table] ??= [];
      return builder(table);
    },
  };
}

// ── Basis-data helpers ────────────────────────────────────────────────────────
const TEAM_ID = "team-abc";
const SEASON_ID = "season-1";
const SEASON_NUMBER = 1;

function makeRider(overrides = {}) {
  return {
    id: "r1",
    team_id: TEAM_ID,
    primary_type: "climber",
    potentiale: 4,
    birthdate: "2003-01-01",   // sæson 1 (2026) → alder 23
    firstname: "Test",
    lastname: "Rytter",
    is_retired: false,
    ...overrides,
  };
}

const BASE_ABILITIES = Object.fromEntries(
  VISIBLE_ABILITIES.map((k) => [k, 50])
);

function makeAbilityRow(riderId = "r1", extra = {}) {
  return { rider_id: riderId, ...BASE_ABILITIES, ability_caps: null, ability_progress: null, ...extra };
}

function makeCondition(riderId = "r1", extra = {}) {
  return { rider_id: riderId, form: 50, fatigue: 10, injured_until: null, injury_cause: null, ...extra };
}

function seedState(opts = {}) {
  const {
    riders = [makeRider()],
    abilities = [makeAbilityRow()],
    conditions = [makeCondition()],
    plans = [],
  } = opts;
  return {
    riders,
    rider_derived_abilities: abilities,
    rider_condition: conditions,
    training_plans: plans,
    training_day_runs: [],
  };
}

const NOW = new Date("2026-06-12T10:00:00+02:00"); // dansk tid

// ── Test 1: Happy path (manager) ──────────────────────────────────────────────
test("happy path (manager): tick kører, rapport + DB-skriv korrekt", async () => {
  const state = seedState();
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  assert.equal(result.alreadyRan, false);
  assert.equal(result.tickDate, "2026-06-12");
  assert.ok(result.report, "rapport returneret");
  assert.equal(result.report.executed_by, "manager");
  assert.equal(result.report.bonus_applied, true);
  assert.equal(result.report.riders.length, 1, "én rytter i rapporten");

  const rr = result.report.riders[0];
  assert.equal(rr.rider_id, "r1");
  assert.ok(typeof rr.score === "number", "score er et tal");
  assert.ok(typeof rr.fatigue === "number", "fatigue tilstede");
  assert.ok(typeof rr.form === "number", "form tilstede");

  // training_day_runs-row skal eksistere med rapporten.
  const runRow = state.training_day_runs.find((r) => r.team_id === TEAM_ID);
  assert.ok(runRow, "run-row skrevet til DB");
  assert.equal(runRow.report.tick_date, "2026-06-12");

  // rider_condition skal være upserted.
  const cond = state.rider_condition.find((c) => c.rider_id === "r1");
  assert.ok(cond, "condition upserted");
  assert.ok(typeof cond.fatigue === "number");
});

// ── Test 2: Idempotens — 23505 → alreadyRan, ingen videre writes ──────────────
test("idempotens: 23505 unique-violation → alreadyRan=true, ingen ability/condition-skriv", async () => {
  const state = seedState();
  const supabase = createMockSupabase(state, { injectUniqueViolation: true });

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  assert.equal(result.alreadyRan, true);
  assert.equal(result.tickDate, "2026-06-12");
  assert.equal(result.report, undefined, "ingen rapport ved alreadyRan");

  // Condition skal IKKE være ændret.
  const cond = state.rider_condition.find((c) => c.rider_id === "r1");
  // Den originale form var 50 — ingen upsert → stadig 50 (upsert-listen var tom/aldrig eksekveret).
  assert.equal(cond?.form, 50, "condition uændret — intet tick eksekveret");

  // Ingen ability-ændringer.
  const ab = state.rider_derived_abilities.find((a) => a.rider_id === "r1");
  for (const k of VISIBLE_ABILITIES) {
    assert.equal(ab[k], 50, `ability ${k} uændret`);
  }
});

// ── Test 3: Skadet rytter — ingen gains, træthed falder (hvile) ──────────────
test("skadet rytter: ingen gains, træthed falder, rapport marker injured=true", async () => {
  const futureDate = "2026-06-15"; // injured_until > tickDate → stadig skadet
  const state = seedState({
    conditions: [makeCondition("r1", { fatigue: 30, injured_until: futureDate })],
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "endurance", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "assistant", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.equal(rr.injured, true, "rapport markerer skadet");
  assert.deepEqual(rr.gains, {}, "ingen ability-gains for skadet rytter");
  assert.equal(rr.score, 0, "score = 0 for skadet rytter");
  assert.equal(rr.intensity, "rest", "intensitet tvunget til rest for skadet rytter");
  assert.equal(result.report.bonus_applied, false, "assistant-run: bonus_applied=false");

  // Træthed bør falde (hvile-load er negativ).
  const cond = state.rider_condition.find((c) => c.rider_id === "r1");
  assert.ok(cond.fatigue < 30, `træthed faldt fra 30 til ${cond.fatigue}`);
});

// ── Test 4: Caps lazy-init — null caps bygges og persisteres ──────────────────
test("caps lazy-init: null ability_caps bygges, persisteres, og giver vækst", async () => {
  // Ung rytter med potentiale 5 og null caps — skal initialisere og give gains.
  const state = seedState({
    riders: [makeRider({ id: "r2", potentiale: 5, birthdate: "2005-01-01" })], // 21 år, vækstfase
    abilities: [makeAbilityRow("r2", { climbing: 40, ability_caps: null })],
    conditions: [makeCondition("r2", { fatigue: 10, form: 50 })],
    plans: [{ rider_id: "r2", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  assert.equal(result.alreadyRan, false);
  const ab = state.rider_derived_abilities.find((a) => a.rider_id === "r2");

  // Caps skal være initialiseret i DB.
  assert.ok(ab.ability_caps && typeof ab.ability_caps === "object", "ability_caps initialiseret i DB");
  assert.ok(ab.ability_caps.climbing > 40, `climbing-cap (${ab.ability_caps.climbing}) > baseline (40)`);

  // Ability_progress skal være skrevet.
  assert.ok(ab.ability_progress !== null, "ability_progress skrevet");

  // Scorer positiv (der er vækst at hente med 21 år, pot=5, climbing=40).
  const rr = result.report.riders[0];
  assert.ok(rr.score > 0, `score > 0 (var ${rr.score}) — caps-init gav progress`);
});

// ── Test 5: Rytter uden abilities-row springes stille over ───────────────────
test("rytter uden abilities-row springes stille over, rapport er tom", async () => {
  const state = seedState({
    abilities: [], // ingen abilities-rækker
    conditions: [makeCondition()],
  });
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "assistant", now: NOW,
  });

  assert.equal(result.alreadyRan, false);
  assert.equal(result.report.riders.length, 0, "ingen ryttere i rapporten — alle sprunget over");
});

// ── Test 6: Akademirytter MED abilities-row trænes (#1478 bug #3) ─────────────
// Rod-årsagen til bug #3 var at akademiryttere blev oprettet UDEN en
// rider_derived_abilities-række og derfor sprunget over her (Test 5). Fixet
// (deriveForRiderIds ved intake) giver dem en abilities-række. Denne test
// forward-guard'er at en akademirytter MED abilities faktisk får et tick.
test("akademirytter med abilities-row trænes (ikke sprunget over) — #1478 bug #3", async () => {
  const state = seedState({
    riders: [makeRider({ id: "ar1", is_academy: true, potentiale: 5, birthdate: "2007-01-01" })], // 19 år, vækstfase
    abilities: [makeAbilityRow("ar1", { climbing: 45, ability_caps: null })],
    conditions: [makeCondition("ar1", { fatigue: 10, form: 50 })],
    plans: [{ rider_id: "ar1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  assert.equal(result.alreadyRan, false);
  assert.equal(result.report.riders.length, 1, "akademirytter optræder i rapporten (ikke sprunget over)");
  const rr = result.report.riders[0];
  assert.equal(rr.rider_id, "ar1");
  assert.ok(rr.score > 0, `akademirytter får et tick med progress (score=${rr.score})`);
});

// ── #2082/#1938: sæson-budget-cap (ejer-godkendt 5/7) ────────────────────────
test("akademi-alder: season_budget_baseline snapshottes ved 1. tick, genbruges uændret ved 2. tick (samme sæson)", async () => {
  const state = seedState({
    riders: [makeRider({ id: "ar2", is_academy: true, potentiale: 5, birthdate: "2009-01-01" })], // 17 år
    abilities: [makeAbilityRow("ar2", { climbing: 45, ability_caps: { climbing: 90 } })],
    conditions: [makeCondition("ar2")],
    plans: [{ rider_id: "ar2", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  await runTeamTrainingDay({ supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW });
  const abAfterDay1 = state.rider_derived_abilities.find((a) => a.rider_id === "ar2");
  assert.ok(abAfterDay1.season_budget_baseline, "baseline snapshottet ved 1. tick");
  assert.equal(abAfterDay1.season_budget_baseline.climbing, 45, "baseline = FØR-tick-værdien, ikke efter");
  assert.equal(abAfterDay1.season_budget_season, SEASON_NUMBER);

  const day2 = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  await runTeamTrainingDay({ supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER, executedBy: "manager", now: day2 });
  const abAfterDay2 = state.rider_derived_abilities.find((a) => a.rider_id === "ar2");
  assert.equal(abAfterDay2.season_budget_baseline.climbing, 45, "baseline uændret 2. dag samme sæson (ikke gen-snapshottet)");
});

test("akademi-alder: væksten mætter ved sæson-loftet — rammer ALDRIG livstids-loftet selv efter mange dage", async () => {
  const state = seedState({
    riders: [makeRider({ id: "ar3", is_academy: true, potentiale: 6, birthdate: "2009-01-01" })], // 17 år
    abilities: [makeAbilityRow("ar3", { climbing: 20, ability_caps: { climbing: 90 } })], // gap=70
    conditions: [makeCondition("ar3")],
    plans: [{ rider_id: "ar3", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  for (let d = 0; d < 90; d++) {
    const now = new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);
    await runTeamTrainingDay({ supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER, executedBy: "manager", now });
  }
  const ab = state.rider_derived_abilities.find((a) => a.rider_id === "ar3");
  // frac for alder 17 = 0.16 → sæson-loft = 20 + 70×0.16 = 31.2 (afrundet ability, aldrig 90).
  assert.ok(ab.climbing < 40, `climbing (${ab.climbing}) skal mætte langt under livstids-loftet 90 efter 90 dage`);
  assert.ok(ab.climbing >= 28, `climbing (${ab.climbing}) skal nærme sig sæson-loftet ~31`);
});

test("voksen rytter (ikke-akademi): ingen season_budget_baseline skrives, uændret livstids-loft-adfærd", async () => {
  const state = seedState(); // default rider r1 er 23 år (birthdate 2003-01-01, sæson 1)
  const supabase = createMockSupabase(state);

  await runTeamTrainingDay({ supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW });
  const ab = state.rider_derived_abilities.find((a) => a.rider_id === "r1");
  assert.equal(ab.season_budget_baseline, undefined, "ingen sæson-budget for voksne");
});

// ── Test 6: to på hinanden følgende runs (2. kald → alreadyRan via state) ────
test("to kald i træk: 2. kald detekterer eksisterende run-row → alreadyRan", async () => {
  const state = seedState();
  const supabase = createMockSupabase(state);

  const r1 = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });
  assert.equal(r1.alreadyRan, false);

  const r2 = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "assistant", now: NOW,
  });
  assert.equal(r2.alreadyRan, true, "2. kald returnerer alreadyRan=true");
});

// ── Test 8: Phase 1-fejl → reservation slettes → retry mulig ─────────────────
test("phase1-fejl (riders-load): reservation slettes, funktion kaster, retry ville lykkes", async () => {
  const deleteCalls = [];
  const state = seedState();
  const supabase = createMockSupabase(state, {
    injectRidersError: "connection timeout",
    deleteCalls,
  });

  // Funktionen skal kaste (original fejl videresendes).
  await assert.rejects(
    () => runTeamTrainingDay({
      supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
      executedBy: "manager", now: NOW,
    }),
    /riders load: connection timeout/,
    "original fejl propageres til caller"
  );

  // Reservationen skal være slettet (ét delete-kald på training_day_runs med korrekte filtre).
  const tdrDeletes = deleteCalls.filter((c) => c.table === "training_day_runs");
  assert.equal(tdrDeletes.length, 1, "ét delete-kald på training_day_runs");
  const delFilters = Object.fromEntries(tdrDeletes[0].filters);
  assert.equal(delFilters.team_id, TEAM_ID, "delete filtrerer på team_id");
  assert.equal(delFilters.tick_date, "2026-06-12", "delete filtrerer på tick_date");

  // Ingen rækker i training_day_runs (slettet efter fejl).
  assert.equal(state.training_day_runs.length, 0, "reservation fjernet fra state — retry ville lykkes");
});

// ── Test 7: rapport indeholder alle påkrævede felter ─────────────────────────
test("rapport-form: alle påkrævede top-level + pr-rytter-felter til stede", async () => {
  const state = seedState();
  const supabase = createMockSupabase(state);

  const { report } = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  // Top-level
  assert.ok(Array.isArray(report.riders));
  assert.equal(typeof report.bonus_applied, "boolean");
  assert.equal(typeof report.executed_by, "string");
  assert.equal(typeof report.tick_date, "string");

  // Per-rytter
  const rr = report.riders[0];
  for (const field of ["rider_id", "name", "score", "gains", "gains_detail", "status", "form", "fatigue", "fatigue_delta", "injured", "injury_days", "focus", "intensity"]) {
    assert.ok(field in rr, `rapport mangler felt: ${field}`);
  }
});

// ── Test 9: Rytter ved loft — ingen ability-write, condition opdateres stadig ──
test("rytter ved loft: ingen ability-ændringer, kun condition opdateres", async () => {
  const highAbilities = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 80]));
  const caps80 = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 80]));
  const state = seedState({
    abilities: [makeAbilityRow("r1", { ...highAbilities, ability_caps: caps80, ability_progress: null })],
    conditions: [makeCondition("r1", { fatigue: 5 })],
  });
  const supabase = createMockSupabase(state);

  await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const ab = state.rider_derived_abilities.find((a) => a.rider_id === "r1");
  for (const k of VISIBLE_ABILITIES) {
    assert.equal(ab[k], 80, `ability ${k} må ikke stige over loftet`);
  }
  const cond = state.rider_condition.find((c) => c.rider_id === "r1");
  assert.ok(cond && typeof cond.fatigue === "number", "condition upserted selv ved cap");
});

// ── Test 10: gains_detail giver faktisk tal-spring pr. gevinst (#1305 polish) ──
test("rapport-række inkluderer gains_detail med from/to pr. gevinst", async () => {
  // Rytter med climbing-progress 0.999 + vo2max/hard → climbing rammer +1 i dag.
  const state = seedState({
    abilities: [makeAbilityRow("r1", { ability_progress: { climbing: 0.999 } })],
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.ok(rr.gains.climbing >= 1, "climbing fik mindst +1");
  assert.ok(rr.gains_detail, "gains_detail tilstede");
  const jump = rr.gains_detail.climbing;
  assert.ok(jump, "climbing-spring tilstede");
  assert.equal(jump.from, 50, "from = pre-tick værdi");
  assert.equal(jump.to, 50 + rr.gains.climbing, "to = pre-tick + gevinst");
  // Kun evner med gevinst er i gains_detail.
  const positiveGains = Object.keys(rr.gains).filter((k) => rr.gains[k] > 0).length;
  assert.equal(Object.keys(rr.gains_detail).length, positiveGains, "gains_detail dækker netop de positive gevinster");
});

// ── Test 11: #2000 — gevinst-dag snapshotter den fulde evnevektor til historik ──
test("ability-history: en tick m. gevinst skriver én daily_training-snapshot m. fuld vektor", async () => {
  const state = seedState({
    // climbing-progress 0.999 → ét vo2max/hard-tick tipper climbing +1 (samme trick som Test 10).
    abilities: [makeAbilityRow("r1", { ability_progress: { climbing: 0.999 } })],
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.ok(rr.gains.climbing >= 1, "forudsætning: rytteren fik en gevinst");

  const hist = state.rider_derived_ability_history ?? [];
  assert.equal(hist.length, 1, "præcis én historik-række for den ene rytter m. gevinst");
  const row = hist[0];
  assert.equal(row.rider_id, "r1");
  assert.equal(row.source, "daily_training");
  assert.equal(row.snapshot_date, "2026-06-12");
  assert.equal(row.season_number, SEASON_NUMBER);
  // Fuld 15-evne-vektor, post-tick (climbing = pre 50 + gevinst).
  for (const k of VISIBLE_ABILITIES) {
    assert.equal(typeof row.abilities[k], "number", `abilities.${k} er et tal`);
  }
  assert.equal(row.abilities.climbing, 50 + rr.gains.climbing, "snapshot = post-tick værdi");
});

// ── Test 12: #2000 — flad dag (ingen gevinst) giver INGEN historik-række ────────
test("ability-history: en flad dag (skadet rytter, ingen gevinst) skriver ingen snapshot", async () => {
  const state = seedState({
    conditions: [makeCondition("r1", { injured_until: "2026-06-20" })], // skadet → no gains
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  assert.equal((state.rider_derived_ability_history ?? []).length, 0, "ingen historik på en flad dag");
});

// ── Test 13: #2000 — historik-fejl er best-effort (kaster ikke, dagen committer) ─
test("ability-history: en upsert-fejl kaster ikke — træningsdagen committes alligevel", async () => {
  const state = seedState({
    abilities: [makeAbilityRow("r1", { ability_progress: { climbing: 0.999 } })],
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state, { injectHistoryError: true });

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  // Trænings-dagen er committet trods historik-fejlen (best-effort).
  assert.equal(result.alreadyRan, false);
  assert.ok(result.report, "rapport returneret trods historik-fejl");
  const runRow = state.training_day_runs.find((r) => r.team_id === TEAM_ID);
  assert.ok(runRow?.report?.tick_date, "training_day_runs committet");
  assert.equal((state.rider_derived_ability_history ?? []).length, 0, "historik ikke skrevet (fejlen blev slugt)");
});

// ── Plan B (#1441): trænings-facilitet + chef wired ind i tick'et ──────────────
test("Plan B: trænings-facilitet + chef løfter dags-score; uden club-data = bit-identisk baseline", async () => {
  // Baseline: intet club-data (team_facilities/team_staff findes ikke) → neutral kontekst.
  const baseState = seedState();
  const baseResult = await runTeamTrainingDay({
    supabase: createMockSupabase(baseState), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW,
  });
  const baseScore = baseResult.report.riders[0].score;
  assert.ok(baseScore > 0, "baseline-tick giver positiv score");

  // Med t5-træningscenter + aktiv chef (ability-række persisteret, fysisk-stærk).
  const clubState = seedState();
  clubState.team_facilities = [{ team_id: TEAM_ID, track: "training", tier: 5 }];
  clubState.team_staff = [{ id: "st-1", team_id: TEAM_ID, role: "training", status: "active", tier: 5, name: "Karel Novotny" }];
  clubState.staff_derived_abilities = [{ staff_id: "st-1", overall: 90, dimensions: { physical: 95, mental: 60, technical: 60 }, levels: { youth: 60, junior: 90, senior: 70 } }];
  const clubResult = await runTeamTrainingDay({
    supabase: createMockSupabase(clubState), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW,
  });
  const clubScore = clubResult.report.riders[0].score;

  // Facilitets-magnituden (1 + effectiveBonus ≈ 1.16 ved t5/overall-90) + junior-match
  // skal give en STRENGT højere dags-score end baseline (samme rytter/dato/noise-seed).
  assert.ok(clubScore > baseScore, `club-score ${clubScore} skal være > baseline ${baseScore}`);

  // Et hold m. tier 0 + ingen chef (rækker findes men er neutrale) = præcis baseline.
  const zeroState = seedState();
  zeroState.team_facilities = [{ team_id: TEAM_ID, track: "training", tier: 0 }];
  zeroState.team_staff = [];
  const zeroResult = await runTeamTrainingDay({
    supabase: createMockSupabase(zeroState), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW,
  });
  assert.equal(zeroResult.report.riders[0].score, baseScore, "tier 0 → bit-identisk med baseline");
});
