import test from "node:test";
import assert from "node:assert/strict";

import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { applyDailyTick } from "./dailyTraining.js";
import { conditionMultiplier, nextFatigue, RACE_DAY_ENGINE_RECOVERY_CONFIG } from "./riderCondition.js";
import { RACE_DAY_ENGINE_FLAG_KEY } from "./raceDayEngineFlag.js";
import { RACE_DAY_DEVELOPMENT_FLAG_KEY } from "./raceDayDevelopmentFlag.js";
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
      if (filters.some(([col, val, fop]) => {
        if (fop === "gte") return !(row[col] >= val);
        if (fop === "lt") return !(row[col] < val);
        return row[col] !== val;
      })) return false;
      if (inList && !inList[1].includes(row[inList[0]])) return false;
      return true;
    };

    const obj = {
      select(/* _cols */) {
        // Vi ignorerer kolonne-selektionen og returnerer alle felter (mock).
        return builder(table, "select", filters, patch, inList);
      },
      eq(col, val) {
        const nf = [...filters, [col, val, "eq"]];
        // Accumulate filters — flush happens on .then() / Promise resolution.
        return builder(table, op, nf, patch, inList);
      },
      is(col, val) {
        // #1895: .is("rider_id", null) — samme filter-semantik som .eq() her (row[col] !== val).
        const nf = [...filters, [col, val, "eq"]];
        return builder(table, op, nf, patch, inList);
      },
      // #3459 D1: race-day-lookuppet filtrerer imported_at med et halvåbent interval.
      gte(col, val) {
        return builder(table, op, [...filters, [col, val, "gte"]], patch, inList);
      },
      lt(col, val) {
        return builder(table, op, [...filters, [col, val, "lt"]], patch, inList);
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
          } else if (opts.injectRaceResultsError && table === "race_results") {
            // #3459 D1 fail-safe-test: race_results-lookuppet fejler.
            result = { data: null, error: { message: opts.injectRaceResultsError } };
          } else if (opts.injectRaceStageProfilesError && table === "race_stage_profiles") {
            // #3459 D2 fail-safe-test: race_stage_profiles-lookuppet (profil-typen) fejler.
            result = { data: null, error: { message: opts.injectRaceStageProfilesError } };
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
test("akademi-alder (18): tickCaps=genberegnet livstidsloft, ÉN model — ingen dags-cap, ingen rate-daempning (#3709 trin 5)", async () => {
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
  // #3591: alderen sendes eksplicit, præcis som motoren gør (dailyTrainingEngine.js:314
  // kalder buildCapsForRider(abilities, { ...rider, age }, ...)). Referencen skal
  // bruge SAMME kaldform som det den er reference for — ellers måler den noget andet.
  const lifetimeCaps = buildCapsForRider(riderAbilities, { ...rider, age: 18 }, rider.primary_type, rider.secondary_type);
  const expected = applyDailyTick({
    riderId: "ar4", dateStr: "2026-06-12", age: 18,
    abilities: riderAbilities, caps: lifetimeCaps, progress: {},
    program: { focus: "vo2max", intensity: "hard" },
    conditionMult: conditionMultiplier({ form: 50, fatigue: 10 }),
    bonus: true, potentiale: 4,
    // #3709 trin 5: hverken hardDailyCap eller academyRateMult sendes laengere.
    // Akademi-alder og senior koerer den SAMME model; forskellen er youthMultiplier,
    // som dailyAbilityDelta selv ganger ind ud fra alderen.
    staff: null, facilityTier: 0, riderLevel: "u23",
    primaryType: rider.primary_type, secondaryType: rider.secondary_type,
  });

  const rr = result.report.riders[0];
  assert.equal(rr.score, expected.score, "score bit-identisk med direkte beregning (tickCaps=genberegnet livstidsloft, én model)");
  assert.deepEqual(rr.gains, expected.gains, "gains bit-identisk med direkte beregning");

  const ab = state.rider_derived_abilities.find((a) => a.rider_id === "ar4");
  assert.deepEqual(ab.ability_caps, lifetimeCaps, "#2471: det stale persisterede loft (90) er overskrevet med det genberegnede");
  assert.equal(ab.season_budget_baseline, undefined, "intet sæson-loft skrives længere (#2437)");
  assert.equal(ab.season_budget_season, undefined, "intet sæson-loft skrives længere (#2437)");
});

test("voksen (25 aar): samme model som akademiet — motoren sender anlaegget, ingen akademi-knapper (#3709 trin 5)", async () => {
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

  // Reference UDEN akademi-knapper overhovedet — efter #3709 trin 5 findes de ikke
  // laengere for NOGEN alder, saa denne reference og akademi-testens reference er nu
  // den SAMME kaldform. Det er praecis beslutning 13: én model.
  // riderLevel="u23": riderLevelBand(age=25) (#2529: <26 = u23).
  // #2471: caps = det genberegnede loft (samme formel for voksne som for ungdom).
  // #3591: samme kaldform som motoren — alderen eksplicit med (jf. testen ovenfor).
  // #3709 trin 4: anlaegget sendes med, saa rolle-raten kan slaas op pr. evne.
  const lifetimeCaps = buildCapsForRider(riderAbilities, { ...rider, age: 25 }, rider.primary_type, rider.secondary_type);
  const expected = applyDailyTick({
    riderId: "adult1", dateStr: "2026-06-12", age: 25,
    abilities: riderAbilities, caps: lifetimeCaps, progress: {},
    program: { focus: "vo2max", intensity: "hard" },
    conditionMult: conditionMultiplier({ form: 50, fatigue: 10 }),
    bonus: true, potentiale: 4, hardDailyCap: undefined,
    staff: null, facilityTier: 0, riderLevel: "u23",
    primaryType: rider.primary_type, secondaryType: rider.secondary_type,
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

// ── #4750: erhvervelsesdagens sikkerhedsnet ──────────────────────────────────
// En rytter erhvervet (akademi-signing/transfer/auktion) PRÆCIS i dag har sit
// gap på sit livstidsmaksimum — den eneste dag i karrieren det er tilfældet.
// Uden et loft netop denne dag kan en frisk 16-årig pot6-rytter med et
// fuldt specialiseret trænings-team (facilitet tier 5 + matchende chef) og
// manager-bonus krydse fremdrifts-baren TO gange for én evne på ÉN dag — noget
// der aldrig sker igen i karrieren, fordi gapet kun bliver mindre herefter.
// riderId "probe-0" + tick_date "2026-06-12" er valgt fordi den PRÆCISE
// (rytter, dato)-seedede støj for netop denne kombination rammer scenariet
// (verificeret uden capping nedenfor). Motoren sender nu hardDailyCap=1 KUN
// når riders.acquired_at falder på selve tick_date.
function makeFullTrainingStaffState(extra = {}) {
  return {
    team_facilities: [{ team_id: TEAM_ID, track: "training", tier: 5 }],
    team_staff: [{ id: "staff1", team_id: TEAM_ID, name: "Coach", role: "training", tier: 5, status: "active" }],
    staff_derived_abilities: [{ staff_id: "staff1", overall: 90, dimensions: { physical: 99 }, levels: { u23: 99 } }],
    ...extra,
  };
}

test("#4750: rytter erhvervet I DAG faar hardDailyCap=1 — evnen der ellers ville springe +2 giver kun +1", async () => {
  const state = {
    ...seedState({
      riders: [makeRider({
        id: "probe-0", is_academy: true, potentiale: 6, birthdate: "2010-01-01", // 16 år (maks youthMultiplier)
        acquired_at: "2026-06-12T09:00:00+02:00", // SAMME dag som tick_date (NOW = 2026-06-12)
      })],
      abilities: [makeAbilityRow("probe-0", { climbing: 1 })], // resten af BASE_ABILITIES=50 (gap kun stort for climbing)
      conditions: [makeCondition("probe-0", { form: 100, fatigue: 0 })], // conditionMult i loft (1.15)
      plans: [{ rider_id: "probe-0", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
    }),
    ...makeFullTrainingStaffState(),
  };
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.equal(rr.gains.climbing, 1, "erhvervelsesdagen: maks +1 i climbing uanset hvor stort gapet er (#4750-sikkerhedsnettet)");

  // Overskydende fremdrift MÅ IKKE gå tabt — den ligger videre i ability_progress
  // til i morgen, præcis som det almindelige hardDailyCap-loft i dailyTraining.js.
  const ab = state.rider_derived_abilities.find((a) => a.rider_id === "probe-0");
  assert.ok(ab.ability_progress.climbing > 0, "restfremdrift bevaret i progress-baren, ikke tabt");
});

test("#4750: SAMME rytter/scenarie dagen EFTER erhvervelse — intet loft, gains.climbing er 2 (#3709 trin 5 urørt)", async () => {
  const state = {
    ...seedState({
      riders: [makeRider({
        id: "probe-0", is_academy: true, potentiale: 6, birthdate: "2010-01-01",
        acquired_at: "2026-06-11T09:00:00+02:00", // I GÅR — ikke tick_date
      })],
      abilities: [makeAbilityRow("probe-0", { climbing: 1 })],
      conditions: [makeCondition("probe-0", { form: 100, fatigue: 0 })],
      plans: [{ rider_id: "probe-0", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
    }),
    ...makeFullTrainingStaffState(),
  };
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  // Dette ER netop den utilsigtede gevinst #4750 rapporterede: +2 i én evne på ÉN
  // dag, mulig KUN fordi gapet er på sit livstidsmaksimum. Testen dokumenterer at
  // #3709 trin 5's "intet dagligt loft"-beslutning for resten af karrieren er
  // UÆNDRET — sikkerhedsnettet ovenfor rammer kun selve erhvervelsesdagen.
  assert.equal(rr.gains.climbing, 2, `dagen efter erhvervelse: INTET loft — forventede 2, fik ${rr.gains.climbing} (regressions-guard mod #3709 trin 5)`);
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
// #2438-fix: holdrytmen er kun DEFAULT for ryttere UDEN egen eksplicit plan —
// se de to tests nedenfor for den opdaterede kontrakt (rider uden plan følger
// rytmen; rider MED egen plan overtrumfer den).
test("ugerytme: rytter UDEN egen plan følger holdets rytme (fredag='rest')", async () => {
  const state = seedState(); // ingen training_plans-row for r1 → intet eksplicit override
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
  assert.equal(rr.intensity, "rest", "uden egen plan er holdrytmen (rest) DEFAULT for rytteren");
  assert.deepEqual(rr.gains, {}, "rest → ingen ability-gains i dag");
});

// #2438 — regressionstest for selve bug-rapporten: manager satte holdrytme=hard
// (alle dage), men en enkelt rytter havde sin EGEN plan sat til "rest". Rytteren
// trænede alligevel hard, fordi holdrytmen dengang ubetinget slog rytterens egen
// plan. Kontrakten nu: en individuel rytter-indstilling overtrumfer rutinen.
test("ugerytme: #2438 — rytter MED egen eksplicit plan ('rest') overtrumfer holdrytmen ('hard')", async () => {
  const state = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "rest" }],
  });
  state.training_week_plans = [{
    team_id: TEAM_ID, rider_id: null,
    days: { mon: { intensity: "hard" }, tue: { intensity: "hard" }, wed: { intensity: "hard" },
      thu: { intensity: "hard" }, fri: { intensity: "hard" }, sat: { intensity: "hard" }, sun: { intensity: "hard" } },
  }];
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.equal(rr.intensity, "rest", "rytterens EGEN plan (rest) vinder over holdrytmen (hard) — #2438");
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

  // Samme scenarie med en flad "normal hver dag"-rytme, men rytteren har nu
  // INGEN egen plan (falder til DEFAULT_PROGRAM) — så rytmen ER default for
  // rytteren, og "normal" gælder.
  const withFlatRhythm = seedState(); // ingen training_plans-row
  withFlatRhythm.training_week_plans = [{
    team_id: TEAM_ID, rider_id: null,
    days: { mon: { intensity: "normal" }, tue: { intensity: "normal" }, wed: { intensity: "normal" },
      thu: { intensity: "normal" }, fri: { intensity: "normal" }, sat: { intensity: "normal" }, sun: { intensity: "normal" } },
  }];
  const resultFlat = await runTeamTrainingDay({
    supabase: createMockSupabase(withFlatRhythm), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW,
  });
  assert.equal(resultFlat.report.riders[0].intensity, "normal", "uden egen plan gælder holdrytmen (normal) som default");

  // #2438 — HAR rytteren derimod sin egen eksplicitte plan ('hard'), vinder DEN
  // over den flade rytme ('normal'), selvom rytmen ER sat for dagen.
  const withOwnPlanOverFlatRhythm = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  withOwnPlanOverFlatRhythm.training_week_plans = withFlatRhythm.training_week_plans;
  const resultOwnPlanWins = await runTeamTrainingDay({
    supabase: createMockSupabase(withOwnPlanOverFlatRhythm), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW,
  });
  assert.equal(resultOwnPlanWins.report.riders[0].intensity, "hard", "#2438 — rytterens egen plan (hard) vinder over holdrytmen (normal)");
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
// #2438: r2 har bevidst INGEN egen training_plans-row her — testen viser at
// holdrytmen kun er default for en rytter der HVERKEN har en individuel
// ugeplan-override ELLER sin egen eksplicitte plan. Havde r2 en egen plan
// ("hard"), ville DEN nu vinde over rytmen (se testen umiddelbart derefter).
test("rytter-override: r1's egen override vinder over holdets ugerytme", async () => {
  const state = seedState({
    riders: [makeRider({ id: "r1" }), makeRider({ id: "r2" })],
    abilities: [makeAbilityRow("r1"), makeAbilityRow("r2")],
    plans: [
      { rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" },
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
  assert.equal(r2Row.intensity, "normal", "r2 uden override OG uden egen plan falder tilbage til holdets ugerytme");
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
  clubState.staff_derived_abilities = [{ staff_id: "st-1", overall: 90, dimensions: { physical: 95, mental: 60, technical: 60 }, levels: { u23: 90, senior: 70 } }];
  const clubResult = await runTeamTrainingDay({
    supabase: createMockSupabase(clubState), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW,
  });
  const clubScore = clubResult.report.riders[0].score;

  // Facilitets-magnituden (1 + effectiveBonus ≈ 1.16 ved t5/overall-90) + u23-match (#2529)
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

// ── #3459 fase 2a: løbsdags-motoren (D1 løbsdags-gate + D3 recovery-konstanter) ──
// NOW = 2026-06-12T10:00+02:00 → tickDate "2026-06-12" i dansk tid.
const IMPORTED_AT_TODAY = "2026-06-12T08:00:00Z"; // 10:00 CEST — inde i tickDate's danske døgn
const IMPORTED_AT_YESTERDAY = "2026-06-11T08:00:00Z"; // udenfor tickDate's danske døgn

// #4277: motoren læser nu TO uafhængige flag. Denne helper tænder begge, så de
// eksisterende D1/D2/D3-tests bliver ved med at måle den "fuldt tændte" adfærd de
// blev skrevet til. Selve splittet dækkes af sit eget test-afsnit nedenfor.
function seedFlagOn(state, value = "on") {
  state.app_config = [
    { key: RACE_DAY_ENGINE_FLAG_KEY, value },
    { key: RACE_DAY_DEVELOPMENT_FLAG_KEY, value },
  ];
}

// #4277: kun ÉT af de to flag tændt — de fire kombinationer skal kunne stå frit.
function seedFlags(state, { engine = null, development = null } = {}) {
  state.app_config = [
    ...(engine == null ? [] : [{ key: RACE_DAY_ENGINE_FLAG_KEY, value: engine }]),
    ...(development == null ? [] : [{ key: RACE_DAY_DEVELOPMENT_FLAG_KEY, value: development }]),
  ];
}

test("D1+D2 (flag on): racede rytteren i dag → race-udvikling (IKKE 0), plan urørt, load=0 (ikke rest -14)", async () => {
  const state = seedState({
    conditions: [makeCondition("r1", { fatigue: 30, form: 50 })],
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  seedFlagOn(state);
  state.race_results = [{ rider_id: "r1", result_type: "stage", imported_at: IMPORTED_AT_TODAY }];
  const plansSnapshot = JSON.parse(JSON.stringify(state.training_plans));
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  // #3459 D2 (implementering): raced dage giver IKKE længere score=0 — raceRedaget
  // "det erstattede pas" bliver til race-udvikling i stedet (applyRaceDevelopmentTick),
  // omdirigeret til løbsprofilens relevante evner. Testen hed oprindeligt "intet
  // tick" fra D1-alene-fasen (før D2 landede på samme branch) — opdateret her.
  assert.ok(rr.score > 0, `løbsdag giver race-udvikling, ikke 0 (var ${rr.score})`);
  assert.equal(rr.intensity, "race", "rapporten markerer dagen som løbsdag");
  assert.equal(rr.race_day, true, "rapport-feltet race_day markerer løbsdagen");
  assert.equal(rr.injured, false, "løbsdag er ikke det samme som skade");

  // G5-invariant: managerens PLAN (training_plans) er ALDRIG rørt af motoren.
  assert.deepEqual(state.training_plans, plansSnapshot, "training_plans uændret efter en løbsdag");

  // D1: load=0 på løbsdage — IKKE rest-intensitetens -14. Krydstjek mod den ægte
  // nextFatigue-formel med "race" (ukendt DAILY_TRAINING_CONFIG.fatigueLoad-nøgle
  // → 0) og D3's flag-on-recovery-pakke.
  const expectedFatigue = nextFatigue({
    fatigue: 30, intensity: "race", recoveryAbility: 50, ...RACE_DAY_ENGINE_RECOVERY_CONFIG,
  });
  const cond = state.rider_condition.find((c) => c.rider_id === "r1");
  assert.equal(cond.fatigue, expectedFatigue, `løbsdags-træthed skal matche nextFatigue(load=0, D3-pakke): ${expectedFatigue}`);
});

test("D1 (flag on): rytter der IKKE racede i dag træner normalt (kun de racende springes over)", async () => {
  const state = seedState({
    riders: [makeRider({ id: "r1" }), makeRider({ id: "r2" })],
    abilities: [makeAbilityRow("r1"), makeAbilityRow("r2", { ability_progress: { climbing: 0.999 } })],
    conditions: [makeCondition("r1"), makeCondition("r2")],
    plans: [
      { rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" },
      { rider_id: "r2", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" },
    ],
  });
  seedFlagOn(state);
  state.race_results = [{ rider_id: "r1", result_type: "stage", imported_at: IMPORTED_AT_TODAY }];
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const r1 = result.report.riders.find((r) => r.rider_id === "r1");
  const r2 = result.report.riders.find((r) => r.rider_id === "r2");
  assert.equal(r1.race_day, true, "r1 racede — løbsdags-gate aktiv");
  assert.deepEqual(r1.gains, {}, "r1 (racede) får ingen gains");
  assert.equal(r2.race_day, false, "r2 racede ikke — normal træningsdag");
  assert.ok(r2.gains.climbing >= 1, "r2 (ikke racede) trænede normalt og fik en gevinst");
});

test("D1: race_results uden for tickDate's danske døgn tæller IKKE som løbsdag", async () => {
  const state = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
    abilities: [makeAbilityRow("r1", { ability_progress: { climbing: 0.999 } })],
  });
  seedFlagOn(state);
  state.race_results = [{ rider_id: "r1", result_type: "stage", imported_at: IMPORTED_AT_YESTERDAY }];
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.equal(rr.race_day, false, "gårsdagens løb tæller ikke som i dags løbsdag");
  assert.ok(rr.gains.climbing >= 1, "rytteren trænede normalt i dag");
});

test("D1 fail-safe: race-results-lookup fejler → tom mængde antaget (ingen løbsdag), dagen fejler IKKE", async () => {
  const state = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
    abilities: [makeAbilityRow("r1", { ability_progress: { climbing: 0.999 } })],
  });
  seedFlagOn(state);
  const supabase = createMockSupabase(state, { injectRaceResultsError: "connection timeout" });

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  assert.equal(result.alreadyRan, false, "en fejlet best-effort-berigelse vælter ikke træningsdagen");
  const rr = result.report.riders[0];
  assert.equal(rr.race_day, false, "fail-safe: ingen løbsdag antaget ved query-fejl");
  assert.ok(rr.gains.climbing >= 1, "rytteren trænede normalt trods fail-safe");
});

test("D1 (flag off, default): et race_results-hit i dag ændrer INTET — bit-identisk med før #3459", async () => {
  const state = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
    abilities: [makeAbilityRow("r1", { ability_progress: { climbing: 0.999 } })],
  });
  // Intet app_config-seed → flag off (fail-safe default).
  state.race_results = [{ rider_id: "r1", result_type: "stage", imported_at: IMPORTED_AT_TODAY }];
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.equal(rr.race_day, false, "flag off → løbsdags-gaten er slet ikke aktiv");
  assert.equal(rr.intensity, "hard", "intensiteten er den ægte plan-intensitet, ikke 'race'");
  assert.ok(rr.gains.climbing >= 1, "rytteren trænede normalt (bit-identisk med før #3459)");
});

// ── #4277: splittet mellem motor-flag (D3) og udviklings-flag (D1+D2) ─────────
//
// Ejer-beslutning 26/8: løbsdags-udviklingen slukkes for S3 og genindføres til
// S4, MENS recovery-konstanterne (D3) og AI-pariteten (D4) bliver on. Før
// splittet gatede ét flag alle fire, så "sluk udviklingen" ville have rullet
// træthedsmedianen tilbage fra 57 til 67 for hele populationen. Disse to tests
// er den egentlige regressionsspærre mod at koblingen sniger sig ind igen.

test("#4277: motor on + udvikling off → racende rytter træner NORMALT, men beholder D3's recovery-pakke", async () => {
  const state = seedState({
    conditions: [makeCondition("r1", { fatigue: 30, form: 50 })],
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
    abilities: [makeAbilityRow("r1", { ability_progress: { climbing: 0.999 } })],
  });
  seedFlags(state, { engine: "on", development: "off" });
  state.race_results = [{ rider_id: "r1", result_type: "stage", imported_at: IMPORTED_AT_TODAY }];
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  // D1+D2 er slukket: præcis S2-adfærd for løbsdage.
  assert.equal(rr.race_day, false, "udvikling off → løbsdags-gaten er ikke aktiv");
  assert.equal(rr.intensity, "hard", "rytteren kører sit planlagte pas, ikke 'race'");
  assert.ok(rr.gains.climbing >= 1, "rytteren trænede normalt trods løb samme dag (S2-adfærd)");

  // D3 er STADIG tændt: trætheden skal følge 4.5/0.15-pakken med det ÆGTE
  // trænings-load ("hard"), ikke løbsdagens load=0 og ikke de gamle 4/0.13.
  const expectedFatigue = nextFatigue({
    fatigue: 30, intensity: "hard", recoveryAbility: 50, ...RACE_DAY_ENGINE_RECOVERY_CONFIG,
  });
  const staleFatigue = nextFatigue({ fatigue: 30, intensity: "hard", recoveryAbility: 50 });
  const cond = state.rider_condition.find((c) => c.rider_id === "r1");
  assert.equal(cond.fatigue, expectedFatigue, "D3-pakken gælder stadig når kun udviklingen er slukket");
  assert.notEqual(expectedFatigue, staleFatigue, "testen er kun meningsfuld hvis de to pakker faktisk giver forskellige tal");
});

test("#4277: motor off + udvikling on → race-udvikling sker, men UDEN D3's recovery-pakke", async () => {
  const state = seedState({
    conditions: [makeCondition("r1", { fatigue: 30, form: 50 })],
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  seedFlags(state, { engine: "off", development: "on" });
  state.race_results = [{ rider_id: "r1", result_type: "stage", imported_at: IMPORTED_AT_TODAY }];
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.equal(rr.race_day, true, "udvikling on → løbsdagen registreres uanset motor-flagget");
  assert.ok(rr.score > 0, `løbet udvikler rytteren (var ${rr.score})`);

  // Motor-flagget er off → CONDITION_CONFIG's status quo, ikke 4.5/0.15.
  const expectedFatigue = nextFatigue({ fatigue: 30, intensity: "race", recoveryAbility: 50 });
  const cond = state.rider_condition.find((c) => c.rider_id === "r1");
  assert.equal(cond.fatigue, expectedFatigue, "uden motor-flagget bruges de gamle recovery-konstanter");
});

// ── #3459 D2: race-udviklings-tick (søster-funktion applyRaceDevelopmentTick) ──

test("D2 (flag on): kendt løbsprofil → KUN profilens relevante evner får progress (aldrig trænings-fokussets evner)", async () => {
  const state = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "sprint", intensity: "hard" }],
    // sprint-fokus (sprint/acceleration) rører IKKE mountain-profilens evner
    // (climbing/endurance/durability) — så et gevinst-hit dér beviser at
    // udviklingen kommer fra RACE_PROFILE_ABILITY_MAP, ikke det (ikke-kørte)
    // trænings-fokus. Baseline-abilities (50, rigeligt gap til de genberegnede
    // livstidslofter) så der reelt ER budget at omfordele.
    abilities: [makeAbilityRow("r1")],
  });
  seedFlagOn(state);
  state.race_results = [{ rider_id: "r1", result_type: "stage", race_id: "race-1", stage_number: 1, imported_at: IMPORTED_AT_TODAY }];
  state.race_stage_profiles = [{ race_id: "race-1", stage_number: 1, profile_type: "mountain" }];
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.equal(rr.race_day, true);
  assert.ok(rr.score > 0, "race-udvikling gav en positiv score");
  // gains_detail viser KUN mountain-evner hvis en +1 blev krydset — sprint/
  // acceleration (dagens plan-fokus, IKKE relevant for mountain) må ALDRIG stå i
  // gains_detail på en løbsdag.
  for (const ability of Object.keys(rr.gains_detail)) {
    assert.ok(["climbing", "endurance", "durability", "recovery"].includes(ability),
      `${ability} er uden for mountain-profilens evneliste — burde ikke have fået en gevinst`);
  }
  assert.equal(rr.gains.sprint, undefined, "sprint (plan-fokus) må IKKE få gevinst på en løbsdag");
  assert.equal(rr.gains.acceleration, undefined, "acceleration (plan-fokus) må IKKE få gevinst på en løbsdag");
});

test("D2: racet rytter får ALDRIG både trænings-tick OG race-udvikling samme dag (gensidigt udelukkende)", async () => {
  const state = seedState({
    riders: [makeRider({ id: "r1" }), makeRider({ id: "r2" })],
    abilities: [makeAbilityRow("r1"), makeAbilityRow("r2", { ability_progress: { climbing: 0.999 } })],
    conditions: [makeCondition("r1"), makeCondition("r2")],
    plans: [
      { rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" },
      { rider_id: "r2", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" },
    ],
  });
  seedFlagOn(state);
  // Kun r1 racede i dag. Mountain-profilen (climbing/endurance/durability) matcher
  // klatrer-rytterens (default primary_type) faktiske vækst-caps — en flad profil
  // ville lægge budgettet på evner UDEN gap for denne rytter-type (klippet til 0
  // ved cap-tjekket) og gøre testen ufølsom for det den faktisk skal bevise.
  state.race_results = [{ rider_id: "r1", result_type: "stage", race_id: "race-1", stage_number: 1, imported_at: IMPORTED_AT_TODAY }];
  state.race_stage_profiles = [{ race_id: "race-1", stage_number: 1, profile_type: "mountain" }];
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const r1 = result.report.riders.find((r) => r.rider_id === "r1");
  const r2 = result.report.riders.find((r) => r.rider_id === "r2");
  assert.equal(r1.race_day, true, "r1 racede");
  assert.ok(r1.score > 0, "r1 fik race-udvikling");
  // r1's gevinster må UDELUKKENDE komme fra mountain-profilen (climbing/endurance/
  // durability) — INGEN andre VISIBLE_ABILITIES må stige. Det ville kun kunne ske
  // hvis r1 fik BÅDE trænings-tick OG race-udvikling samme dag.
  for (const ability of Object.keys(r1.gains)) {
    assert.ok(["climbing", "endurance", "durability"].includes(ability),
      `${ability} er uden for mountain-profilen — r1 fik uventet en gevinst uden for race-udviklingens evneliste`);
  }
  assert.equal(r2.race_day, false, "r2 racede ikke — normal træningsdag");
  assert.ok(r2.gains.climbing >= 1, "r2 (vo2max-fokus, ikke racede) fik en normal trænings-gevinst i climbing");
});

test("D2: ukendt/manglende race_stage_profiles-række → 'rolling'-fallback (udvikling anvendes stadig)", async () => {
  const state = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "sprint", intensity: "hard" }],
    abilities: [makeAbilityRow("r1")],
  });
  seedFlagOn(state);
  state.race_results = [{ rider_id: "r1", result_type: "stage", race_id: "race-ukendt", stage_number: 1, imported_at: IMPORTED_AT_TODAY }];
  // Ingen matchende race_stage_profiles-række for race-ukendt/1.
  state.race_stage_profiles = [];
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.equal(rr.race_day, true);
  assert.ok(rr.score > 0, "manglende profil-række falder tilbage til 'rolling' — udvikling sker stadig, ikke 0");
});

test("D2 fail-safe: race_stage_profiles-lookup fejler → 'rolling'-fallback, dagen fejler IKKE", async () => {
  const state = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "sprint", intensity: "hard" }],
    abilities: [makeAbilityRow("r1")],
  });
  seedFlagOn(state);
  state.race_results = [{ rider_id: "r1", result_type: "stage", race_id: "race-1", stage_number: 1, imported_at: IMPORTED_AT_TODAY }];
  const supabase = createMockSupabase(state, { injectRaceStageProfilesError: "connection timeout" });

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  assert.equal(result.alreadyRan, false, "en fejlet profil-berigelse vælter ikke træningsdagen");
  const rr = result.report.riders[0];
  assert.equal(rr.race_day, true);
  assert.ok(rr.score > 0, "fail-safe: 'rolling'-fallback bruges, udvikling sker stadig");
});

test("D2 (flag off): et race_stage_profiles-hit ændrer INTET — race-udvikling er slet ikke aktiv uden flagget", async () => {
  const state = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
    abilities: [makeAbilityRow("r1", { ability_progress: { climbing: 0.999 } })],
  });
  // Intet app_config-seed → flag off.
  state.race_results = [{ rider_id: "r1", result_type: "stage", race_id: "race-1", stage_number: 1, imported_at: IMPORTED_AT_TODAY }];
  state.race_stage_profiles = [{ race_id: "race-1", stage_number: 1, profile_type: "mountain" }];
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.equal(rr.race_day, false, "flag off → hverken D1- eller D2-gaten er aktiv");
  assert.ok(rr.gains.climbing >= 1, "rytteren trænede normalt (bit-identisk med før #3459), IKKE mountain-profilens evner");
});

test("D2: G5-invariant — training_plans er ALDRIG rørt på en race-udviklings-dag", async () => {
  const state = seedState({
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "sprint", intensity: "hard" }],
    abilities: [makeAbilityRow("r1")],
  });
  seedFlagOn(state);
  state.race_results = [{ rider_id: "r1", result_type: "stage", race_id: "race-1", stage_number: 1, imported_at: IMPORTED_AT_TODAY }];
  state.race_stage_profiles = [{ race_id: "race-1", stage_number: 1, profile_type: "itt" }];
  const plansSnapshot = JSON.parse(JSON.stringify(state.training_plans));
  const supabase = createMockSupabase(state);

  await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  assert.deepEqual(state.training_plans, plansSnapshot, "training_plans uændret efter en race-udviklings-dag");
});

test("D3: recoveryFraction/base følger flagget — on giver mærkbart anderledes træthed end off (samme input)", async () => {
  const onState = seedState({ conditions: [makeCondition("r1", { fatigue: 50, form: 50 })] });
  seedFlagOn(onState);
  const onResult = await runTeamTrainingDay({
    supabase: createMockSupabase(onState), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW,
  });

  const offState = seedState({ conditions: [makeCondition("r1", { fatigue: 50, form: 50 })] });
  const offResult = await runTeamTrainingDay({
    supabase: createMockSupabase(offState), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "manager", now: NOW,
  });

  const onFatigue = onResult.report.riders[0].fatigue;
  const offFatigue = offResult.report.riders[0].fatigue;
  assert.notEqual(onFatigue, offFatigue, "D3-pakken (base 4.5/frac 0.15) skal give et andet resultat end status quo (base 4/frac 0.13)");
  assert.ok(onFatigue < offFatigue, "flag on giver MERE recovery (lavere sluttræthed) end flag off ved samme input");
});

