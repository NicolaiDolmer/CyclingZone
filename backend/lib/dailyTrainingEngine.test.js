import test from "node:test";
import assert from "node:assert/strict";

import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { applyDailyTick } from "./dailyTraining.js";
import { conditionMultiplier } from "./riderCondition.js";
import { ACADEMY } from "./academyFlag.js";
import { buildCapsForRider } from "./riderProgression.js";

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
      is(col, val) {
        // #1895: .is("rider_id", null) — samme filter-semantik som .eq() her (row[col] !== val).
        const nf = [...filters, [col, val]];
        return builder(table, op, nf, patch, inList);
      },
      in(col, vals) {
        return builder(table, op, filters, patch, [col, vals]);
      },
      order() { return builder(table, op, filters, patch, inList); },
      async maybeSingle() {
        const result = await new Promise((resolve) => obj.then(resolve));
        const rows = result.data ?? [];
        return { data: rows[0] ?? null, error: result.error };
      },
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

// ── #2437: MIDLERTIDIG interim (ejer-godkendt 15/7) — sæson-loftet fra #2082/#1938
// er fjernet igen (rate-kollaps, se blok-kommentaren i dailyTrainingEngine.js).
// tickCaps = livstidsloftet for ALLE ryttere; akademi-alder dæmpes i stedet via
// ACADEMY.INTERIM_RATE_MULT (1/3). Testene nedenfor erstatter de gamle
// sæson-loft-tests (#2082/#1938), som nu tester adfærd der er fjernet.
//
// #2471: livstidsloftet er ikke længere den PERSISTEREDE ability_caps-værdi —
// motoren genberegner det hver tick via buildCapsForRider. Referencerne herunder
// beregner derfor loftet samme vej. Seeden beholder bevidst et forkert persisteret
// loft (alle 90), så testen samtidig beviser at den værdi IKKE længere styrer ticket.
test("akademi-alder (18): tickCaps=genberegnet livstidsloft (intet sæson-loft) + academyRateMult=1/3 (#2437 interim + #2471)", async () => {
  const riderAbilities = { ...BASE_ABILITIES, climbing: 40 };
  const staleCaps = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 90]));
  const rider = makeRider({ id: "ar4", is_academy: true, potentiale: 4, birthdate: "2008-01-01" }); // 18 år
  const state = seedState({
    riders: [rider],
    abilities: [makeAbilityRow("ar4", { ...riderAbilities, ability_caps: staleCaps })],
    conditions: [makeCondition("ar4")],
    plans: [{ rider_id: "ar4", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  // Reference: SAMME lavniveau-funktion (applyDailyTick) med de parametre motoren
  // skal sende — tickCaps = det GENBEREGNEDE livstidsloft (IKKE et sæson-loft, og
  // IKKE den stale persisterede værdi), academyRateMult=1/3.
  const lifetimeCaps = buildCapsForRider(riderAbilities, rider, rider.primary_type, rider.secondary_type);
  const expected = applyDailyTick({
    riderId: "ar4", dateStr: "2026-06-12", age: 18,
    abilities: riderAbilities, caps: lifetimeCaps, progress: {},
    program: { focus: "vo2max", intensity: "hard" },
    conditionMult: conditionMultiplier({ form: 50, fatigue: 10 }),
    bonus: true, potentiale: 4, hardDailyCap: ACADEMY.HARD_DAILY_CAP,
    academyRateMult: ACADEMY.INTERIM_RATE_MULT,
    staff: null, facilityTier: 0, riderLevel: "youth",
  });

  const rr = result.report.riders[0];
  assert.equal(rr.score, expected.score, "score bit-identisk med direkte beregning (tickCaps=genberegnet livstidsloft, rate/3)");
  assert.deepEqual(rr.gains, expected.gains, "gains bit-identisk med direkte beregning");

  const ab = state.rider_derived_abilities.find((a) => a.rider_id === "ar4");
  assert.deepEqual(ab.ability_caps, lifetimeCaps, "#2471: det stale persisterede loft (90) er overskrevet med det genberegnede");
  assert.equal(ab.season_budget_baseline, undefined, "intet sæson-loft skrives længere (#2437)");
  assert.equal(ab.season_budget_season, undefined, "intet sæson-loft skrives længere (#2437)");
});

test("voksen (25 år): academyRateMult=1.0 — bit-identisk med tick uden rate-mult-parameteren (ingen regression)", async () => {
  const riderAbilities = { ...BASE_ABILITIES, climbing: 40 };
  const staleCaps = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 90]));
  const rider = makeRider({ id: "adult1", potentiale: 4, birthdate: "2001-01-01" }); // 25 år
  const state = seedState({
    riders: [rider],
    abilities: [makeAbilityRow("adult1", { ...riderAbilities, ability_caps: staleCaps })],
    conditions: [makeCondition("adult1")],
    plans: [{ rider_id: "adult1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  // Reference UDEN academyRateMult-parameteren overhovedet (default 1.0) — beviser at
  // motoren rent faktisk sender 1.0 for voksne, ikke bare et tal der tilfældigvis
  // regner ud til det samme. riderLevel="junior": riderLevelBand(is_academy=false, 25).
  // #2471: caps = det genberegnede loft (samme formel for voksne som for ungdom).
  const lifetimeCaps = buildCapsForRider(riderAbilities, rider, rider.primary_type, rider.secondary_type);
  const expected = applyDailyTick({
    riderId: "adult1", dateStr: "2026-06-12", age: 25,
    abilities: riderAbilities, caps: lifetimeCaps, progress: {},
    program: { focus: "vo2max", intensity: "hard" },
    conditionMult: conditionMultiplier({ form: 50, fatigue: 10 }),
    bonus: true, potentiale: 4, hardDailyCap: undefined,
    staff: null, facilityTier: 0, riderLevel: "junior",
  });

  const rr = result.report.riders[0];
  assert.equal(rr.score, expected.score, "voksen-score bit-identisk med rate-mult-fri beregning (#2437 rører ikke voksne)");
  assert.deepEqual(rr.gains, expected.gains);

  const ab = state.rider_derived_abilities.find((a) => a.rider_id === "adult1");
  assert.equal(ab.season_budget_baseline, undefined, "ingen sæson-budget for voksne (uændret, #2437)");
});

test("akademi-alder: hård dags-cap (+1) gælder stadig efter fjernelse af sæson-loftet (#2437)", async () => {
  const state = seedState({
    riders: [makeRider({ id: "ar5", is_academy: true, potentiale: 6, birthdate: "2009-01-01" })], // 17 år
    abilities: [makeAbilityRow("ar5", {
      climbing: 1,
      ability_caps: { ...Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 90])), climbing: 99 },
    })],
    conditions: [makeCondition("ar5")],
    plans: [{ rider_id: "ar5", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.equal(rr.gains.climbing, 1, "maks +1/dag selv med stort gap + pot6 + bonus (#2082/#1938-sikkerhedsnettet uændret)");
});

test("akademi-alder: væksten mætter IKKE længere ved et sæson-loft — fortsætter forbi den gamle ~31-grænse over flere dage", async () => {
  // Samme scenarie som den tidligere #2082/#1938-sæson-loft-test (gap=70, pot6, 17 år):
  // frac for alder 17 var 0.16 → gammelt sæson-loft = 20 + 70×0.16 = 31.2. Interim-
  // modellen har INTET sæson-loft, så climbing skal vokse forbi det gamle loft (men
  // stadig langt under livstids-loftet 90 efter kun 90 dage, jf. rate/3-dæmpningen).
  const state = seedState({
    riders: [makeRider({ id: "ar6", is_academy: true, potentiale: 6, birthdate: "2009-01-01" })], // 17 år
    abilities: [makeAbilityRow("ar6", { climbing: 20, ability_caps: { climbing: 90 } })], // gap=70
    conditions: [makeCondition("ar6")],
    plans: [{ rider_id: "ar6", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  for (let d = 0; d < 90; d++) {
    const now = new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);
    await runTeamTrainingDay({ supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER, executedBy: "manager", now });
  }
  const ab = state.rider_derived_abilities.find((a) => a.rider_id === "ar6");
  assert.ok(ab.climbing > 32, `climbing (${ab.climbing}) skal vokse FORBI det gamle sæson-loft (~31.2) — intet loft længere`);
  assert.ok(ab.climbing < 90, `climbing (${ab.climbing}) skal stadig være under livstids-loftet 90 efter kun 90 dage`);
  assert.equal(ab.season_budget_baseline, undefined, "intet sæson-loft-felt skrives (#2437)");
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

// ── #1895 PR 1: ugentlig træningsrytme på holdniveau ──────────────────────────
// NOW = 2026-06-12T10:00+02:00 → Copenhagen-dato "2026-06-12" → fredag ("fri").
test("ugerytme: hold MED rytme styrer dagens intensitet (fredag='rest' overstyrer plan-intensitet 'hard')", async () => {
  const state = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  state.training_week_plans = [{
    team_id: TEAM_ID, rider_id: null,
    days: { mon: { intensity: "hard" }, tue: { intensity: "hard" }, wed: { intensity: "hard" },
      thu: { intensity: "hard" }, fri: { intensity: "rest" }, sat: { intensity: "hard" }, sun: { intensity: "rest" } },
  }];
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.equal(rr.intensity, "rest", "fredagens ugerytme (rest) vinder over plan-intensiteten (hard)");
  assert.equal(rr.focus, "vo2max", "fokus er UÆNDRET af ugerytmen — bor kun i training_plans");
  assert.deepEqual(rr.gains, {}, "rest → ingen ability-gains i dag");
});

test("ugerytme: hold UDEN rytme-row → uændret adfærd (regressions-guard, bit-identisk med i dag)", async () => {
  const withPlan = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  }); // ingen training_week_plans-row
  const resultWithoutRhythm = await runTeamTrainingDay({
    supabase: createMockSupabase(withPlan), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW,
  });
  assert.equal(resultWithoutRhythm.report.riders[0].intensity, "hard", "uden holdrytme følger dagen stadig plan-intensiteten uændret");

  // Samme scenarie med en TOM/flad "normal hver dag"-rytme skal give BIT-IDENTISK resultat.
  const withFlatRhythm = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  withFlatRhythm.training_week_plans = [{
    team_id: TEAM_ID, rider_id: null,
    days: { mon: { intensity: "normal" }, tue: { intensity: "normal" }, wed: { intensity: "normal" },
      thu: { intensity: "normal" }, fri: { intensity: "normal" }, sat: { intensity: "normal" }, sun: { intensity: "normal" } },
  }];
  const resultFlat = await runTeamTrainingDay({
    supabase: createMockSupabase(withFlatRhythm), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW,
  });
  // "normal" er hverken sat på fredag i den flade rytme forskelligt fra plan-intensiteten "hard" —
  // KUN rytmens fri-nøgle betyder noget: her er den "normal", plan er "hard". Rytme vinder når sat.
  assert.equal(resultFlat.report.riders[0].intensity, "normal", "flad rytme (alle 'normal') vinder over plan-intensiteten når rytmen ER sat");
});

test("ugerytme: bonus_applied følger stadig UDELUKKENDE executedBy (rytmen rører den ikke)", async () => {
  const state = seedState();
  state.training_week_plans = [{
    team_id: TEAM_ID, rider_id: null,
    days: { mon: { intensity: "hard" }, tue: { intensity: "hard" }, wed: { intensity: "hard" },
      thu: { intensity: "hard" }, fri: { intensity: "hard" }, sat: { intensity: "hard" }, sun: { intensity: "hard" } },
  }];
  const managerResult = await runTeamTrainingDay({
    supabase: createMockSupabase(state), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW,
  });
  assert.equal(managerResult.report.bonus_applied, true);

  const state2 = seedState();
  state2.training_week_plans = state.training_week_plans;
  const assistantResult = await runTeamTrainingDay({
    supabase: createMockSupabase(state2), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "assistant", now: NOW,
  });
  assert.equal(assistantResult.report.bonus_applied, false);
});

// ── #1895 PR 2: rytter-pr-dag-override (rider_id sat i training_week_plans) ────
test("rytter-override: r1's egen override vinder over holdets ugerytme", async () => {
  const state = seedState({
    riders: [makeRider({ id: "r1" }), makeRider({ id: "r2" })],
    abilities: [makeAbilityRow("r1"), makeAbilityRow("r2")],
    plans: [
      { rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" },
      { rider_id: "r2", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" },
    ],
  });
  state.training_week_plans = [
    // Holdets rytme: fredag = "normal".
    { team_id: TEAM_ID, rider_id: null, days: {
      mon: { intensity: "normal" }, tue: { intensity: "normal" }, wed: { intensity: "normal" },
      thu: { intensity: "normal" }, fri: { intensity: "normal" }, sat: { intensity: "normal" }, sun: { intensity: "normal" },
    } },
    // r1's egen override: fredag = "rest" — skal vinde over BÅDE holdrytmen OG plan-intensiteten.
    { team_id: TEAM_ID, rider_id: "r1", days: {
      mon: { intensity: "hard" }, tue: { intensity: "hard" }, wed: { intensity: "hard" },
      thu: { intensity: "hard" }, fri: { intensity: "rest" }, sat: { intensity: "hard" }, sun: { intensity: "hard" },
    } },
  ];
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const r1Row = result.report.riders.find((r) => r.rider_id === "r1");
  const r2Row = result.report.riders.find((r) => r.rider_id === "r2");
  assert.equal(r1Row.intensity, "rest", "r1's egen override (rest) vinder over holdrytmen (normal)");
  assert.equal(r2Row.intensity, "normal", "r2 uden override falder tilbage til holdets ugerytme");
  assert.equal(r1Row.focus, "vo2max", "fokus er UÆNDRET af rytter-override — bor kun i training_plans");
});

test("rytter-override: uden holdrytme falder rytteren tilbage til holdets/sæson-intensitet uændret (regression)", async () => {
  const state = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  }); // ingen training_week_plans-rows overhovedet
  const result = await runTeamTrainingDay({
    supabase: createMockSupabase(state), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW,
  });
  assert.equal(result.report.riders[0].intensity, "hard", "ingen override/rytme → uændret plan-intensitet");
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
