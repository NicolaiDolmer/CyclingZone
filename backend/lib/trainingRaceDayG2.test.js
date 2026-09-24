// Gate G2 (#4846, spec §7): PRAECIS 140 tickede loebsdage pr. division.
//
// EJERENS LAASTE REGEL: lige mange loebsdage i alle divisioner, og tallet er 140
// (TRAINING_RULES.md §13.3 beslutning 2 + §13.3b regel 4). Kalenderen leverer aksen
// (#5267: 5 loebsdage paa hver af de 28 kalenderdatoer). Denne test beviser at
// traenings-lukningen faktisk TICKER hele aksen — hverken mere eller mindre — naar den
// koeres een gang pr. kalenderdato hen over saesonen.
//
// HVORFOR DER VAR ET HUL. Pakkeren lae­gger de tomme loebsdage FORAN datoens loeb (og
// positionen efter aksens sidste loeb arver den sidste dato). Paa saesonens foerste dato
// ligger der derfor tomme loebsdage foran det foerste loeb, og paa den sidste dato
// ligger der tomme loebsdage efter det sidste. Foer #4846 startede spaendet paa dagens
// foerste loeb og sluttede paa dagens sidste, saa netop de dage fik aldrig et tick.
// Negativ-kontrollen nederst viser det tab paa samme fixture.
//
// FIXTUREN er den committede prod-katalog-fixture, pakket S4-agtigt: 4 divisioner,
// 28 datoer, maal 140, taethed 5/4/3/3 (TIER_DENSITY). Kvoten saettes eksplicit til
// taethed x datoer, fordi den eksakte soegning (§1b) kraever at kvoten gaar op — ellers
// falder pakkeren ned i det afslappede layout uden maal.
//
// Refs #4846 #4847 #4845 #5267

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan } from "./tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "./calendarStartDate.js";
import { TIER_DENSITY } from "./calendarTierCaps.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { SEASON_RACE_DAY_TARGET } from "./calendarRaceDayTargets.js";
import { resolveCalendarRaceDayTarget } from "./trainingRaceDayTick.js";
import {
  gameDaySpansByDivision, axisEndByDivisionFor, NO_PRIOR_GAME_DAY,
  runTrainingDayCloseSweep, __resetTrainingDayCloseStateForTests,
} from "./trainingDayCloseTrigger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "__fixtures__", "racePoolCatalog.prod.json");

// Faste ankre (#4222/#4239) — ellers raadner testen paa selve datoen. Alle 28 datoer
// ligger i dansk sommertid (UTC+2), hvilket sweep-simulationen nedenfor bygger paa.
const FIRST_RACE_DAY = "2026-08-28";
const NOW = new Date("2026-08-25T12:00:00Z");
const REAL_DAYS = 28;
const SEASON_NUMBER = 4;
const TARGET = resolveCalendarRaceDayTarget({ seasonNumber: SEASON_NUMBER });
const ALL_GAME_DAYS = Array.from({ length: TARGET }, (_, g) => g);

let tierPlans = null;
function s4Plans() {
  if (tierPlans) return tierPlans;
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY, now: NOW });
  const quotas = Object.fromEntries(
    Object.entries(TIER_DENSITY).map(([tier, density]) => [tier, density * REAL_DAYS]),
  );
  tierPlans = buildTierMaterializationPlan({
    pools, catalog, from, baseSeed: 1, realDays: REAL_DAYS, raceDayTarget: TARGET, quotas,
  }).tierPlans;
  return tierPlans;
}

// Divisionens etaper, med race-id'er gjort unikke paa tvaers af divisioner og den
// DANSKE kalenderdato (samme doegn-graense som sweepens copenhagenMidnightUTC).
function divisionRows(plan) {
  return plan.pools[0].stageRows.map((s) => ({
    race_id: `D${plan.tier}:${s.pool_race_id}`,
    stage_number: s.stage_number,
    game_day: s.game_day,
    scheduled_at: s.scheduled_at,
    date: copenhagenDateString(new Date(s.scheduled_at)),
  }));
}

// Een gameDaySpansByDivision-lukning pr. kalenderdato, praecis med de input sweepen
// selv slaar op: sidste loebsdag FOER i dag (eller "ingen"), og om der kommer etaper
// EFTER i dag. `edges: false` er adfaerden foer #4846 (negativ-kontrollen).
function simulateSeason(plan, { edges = true } = {}) {
  const division = `D${plan.tier}`;
  const rows = divisionRows(plan);
  const divisionByRace = new Map(rows.map((r) => [r.race_id, division]));
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const ticked = [];
  const skipped = [];
  for (const date of dates) {
    const todays = rows.filter((r) => r.date === date);
    const before = rows.filter((r) => r.date < date);
    const after = rows.filter((r) => r.date > date);
    const prior = before.length
      ? Math.max(...before.map((r) => r.game_day))
      : (edges ? NO_PRIOR_GAME_DAY : null);
    const axisEndByDivision = edges
      ? axisEndByDivisionFor({
        lastRaceDateByDivision: new Map([[division, after.length === 0]]),
        raceDaysPerSeason: TARGET,
      })
      : null;
    const span = gameDaySpansByDivision(
      todays, divisionByRace, new Map([[division, prior]]), { axisEndByDivision },
    ).get(division);
    if (!span) continue;
    ticked.push(...span.gameDays);
    skipped.push(...span.skippedGameDays);
  }
  return { ticked, skipped, dates };
}

describe("G2-fixturen er S4-agtig og rammer de to kanter", () => {
  it("maalet er ejerens laaste 140, laest fra kalenderen", () => {
    assert.equal(TARGET, 140);
    assert.equal(TARGET, SEASON_RACE_DAY_TARGET[SEASON_NUMBER]);
  });

  it("4 divisioner, 28 datoer, taethed 5/4/3/3, eksakt kvote og en akse paa praecis maalet", () => {
    const plans = [...s4Plans()].sort((a, b) => a.tier - b.tier);
    assert.deepEqual(plans.map((p) => p.tier), [1, 2, 3, 4]);
    assert.deepEqual(plans.map((p) => p.density), [5, 4, 3, 3]);
    for (const plan of plans) {
      const rows = divisionRows(plan);
      assert.equal(new Set(rows.map((r) => r.date)).size, REAL_DAYS, `D${plan.tier}: antal datoer`);
      assert.equal(rows.length, plan.density * REAL_DAYS, `D${plan.tier}: kvoten gaar ikke op`);
      assert.equal(plan.raceDayAxisLength, TARGET, `D${plan.tier}: aksen ramte ikke maalet`);
    }
  });

  it("loebsdag 0 og aksens sidste loebsdag er tomme traeningsdage i ALLE fire divisioner (ellers tester G2 ingenting)", () => {
    // Uden disse to kanter ville G2 ogsaa vaere groen med den gamle adfaerd. `every`,
    // ikke `some` (diff-tjekket af PR #5608): kanten skal findes i hver division, ellers
    // beviser G2 den kun for dem der tilfaeldigvis rammer den.
    const plans = s4Plans();
    assert.equal(plans.length, 4);
    const bearing = (plan) => new Set(divisionRows(plan).map((r) => r.game_day));
    const names = (ps) => ps.map((p) => `D${p.tier}`).join(", ");
    assert.ok(plans.every((p) => !bearing(p).has(0)),
      `${names(plans.filter((p) => bearing(p).has(0)))} har et loeb paa loebsdag 0 — fixturen rammer ikke kanten ved saesonstart`);
    assert.ok(plans.every((p) => !bearing(p).has(TARGET - 1)),
      `${names(plans.filter((p) => bearing(p).has(TARGET - 1)))} har et loeb paa sidste loebsdag — fixturen rammer ikke kanten ved saesonslut`);
  });
});

describe("G2: PRAECIS 140 tickede loebsdage pr. division", () => {
  it("hver division tikker hver loebsdag 0..139 praecis een gang — intet sprunget over", () => {
    for (const plan of s4Plans()) {
      const { ticked, skipped } = simulateSeason(plan);
      assert.deepEqual(skipped, [], `D${plan.tier}: ops-loftet sprang loebsdage over`);
      assert.equal(ticked.length, TARGET, `D${plan.tier}: ${ticked.length} ticks, ${TARGET} forventet`);
      assert.equal(new Set(ticked).size, TARGET, `D${plan.tier}: en loebsdag blev tikket to gange`);
      assert.deepEqual([...ticked].sort((a, b) => a - b), ALL_GAME_DAYS, `D${plan.tier}: forkert maengde`);
    }
  });

  it("lige mange i ALLE divisioner (ejerens regel 4)", () => {
    const counts = s4Plans().map((plan) => simulateSeason(plan).ticked.length);
    assert.deepEqual(counts, counts.map(() => TARGET));
  });

  it("negativ-kontrol: med adfaerden FOER #4846 mangler netop kanterne", () => {
    for (const plan of s4Plans()) {
      const bearing = new Set(divisionRows(plan).map((r) => r.game_day));
      const { ticked } = simulateSeason(plan, { edges: false });
      const missing = ALL_GAME_DAYS.filter((g) => !ticked.includes(g));
      const first = Math.min(...bearing);
      const last = Math.max(...bearing);
      const expected = ALL_GAME_DAYS.filter((g) => g < first || g > last);
      assert.deepEqual(missing, expected,
        `D${plan.tier}: den gamle adfaerd skulle tabe praecis dagene foer foerste og efter sidste loeb`);
      if (expected.length) assert.ok(ticked.length < TARGET);
    }
  });
});

// ── Samme bevis gennem den AEGTE sweep ──────────────────────────────────────
// Ovenfor koeres den rene funktion med haandbyggede input. Her koeres
// runTrainingDayCloseSweep een gang pr. kalenderdato mod en lille in-memory-database,
// saa ogsaa de to NYE opslag (sidste loebsdag foer i dag, etaper efter i dag) og
// saesonens maal er med i beviset.

function memorySupabase(tables) {
  return {
    from(table) {
      const filters = [];
      let order = null;
      let offset = 0;
      let limit = null;
      const run = () => {
        let rows = (tables[table] ?? []).filter((r) => filters.every((keep) => keep(r)));
        if (order) {
          rows = [...rows].sort((a, b) => (order.ascending ? 1 : -1) * (Number(a[order.col]) - Number(b[order.col])));
        }
        rows = rows.slice(offset, limit === null ? undefined : offset + limit);
        return { data: rows, error: null };
      };
      const q = {
        select() { return q; },
        eq(col, val) { filters.push((r) => r[col] === val); return q; },
        in(col, vals) { const s = new Set(vals); filters.push((r) => s.has(r[col])); return q; },
        gte(col, val) { filters.push((r) => Date.parse(r[col]) >= Date.parse(val)); return q; },
        lt(col, val) { filters.push((r) => Date.parse(r[col]) < Date.parse(val)); return q; },
        is(col, val) { filters.push((r) => (r[col] ?? null) === val); return q; },
        order(col, o = {}) { order = { col, ascending: o.ascending !== false }; return q; },
        limit(n) { limit = n; return q; },
        range(from, to) { offset = from; limit = to - from + 1; return q; },
        async maybeSingle() { return { data: run().data[0] ?? null, error: null }; },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return q;
    },
  };
}

describe("G2 gennem runTrainingDayCloseSweep (een koersel pr. kalenderdato)", () => {
  let result = null;

  before(async () => {
    __resetTrainingDayCloseStateForTests();
    const plans = s4Plans();
    const stages = plans.flatMap(divisionRows);
    const tables = {
      app_config: [
        { key: "training_tick_per_race_day", value: "on" },
        { key: "daily_training_enabled", value: true },
        { key: "race_day_engine_enabled", value: false },
      ],
      seasons: [{ id: "season-4", number: SEASON_NUMBER, status: "active" }],
      races: [...new Map(stages.map((s) => [s.race_id, {
        id: s.race_id,
        season_id: "season-4",
        league_division_id: s.race_id.split(":")[0],
        // Alle etaper er afviklet og ingen finaliserer: hver aften er lukket.
        stages_completed: 999,
        finalize_state: null,
      }])).values()],
      race_stage_schedule: stages.map(({ race_id, stage_number, game_day, scheduled_at }) => ({
        race_id, stage_number, game_day, scheduled_at,
      })),
      teams: plans.map((p) => ({
        id: `team-D${p.tier}`, league_division_id: `D${p.tier}`,
        is_bank: false, is_frozen: false, is_test_account: false, is_ai: false,
      })),
      training_day_runs: [],
    };
    const supabase = memorySupabase(tables);
    const ticksByTeam = new Map();
    const warnings = [];
    const failures = [];
    const dates = [...new Set(stages.map((s) => s.date))].sort();
    for (const date of dates) {
      // 19:00 UTC = 21:00 dansk sommertid: efter kl. 20, foer maks-ventetiden.
      const out = await runTrainingDayCloseSweep({
        supabase,
        now: new Date(`${date}T19:00:00Z`),
        logger: { warn: (m) => warnings.push(m), error: (m) => warnings.push(m) },
        runDay: async ({ teamId, gameDay }) => {
          if (!ticksByTeam.has(teamId)) ticksByTeam.set(teamId, []);
          ticksByTeam.get(teamId).push(gameDay);
          return { alreadyRan: false };
        },
      });
      if (!out.ran || out.failed || out.skippedGameDays?.length || out.droppedExtensionGameDays?.length) {
        failures.push({ date, out });
      }
    }
    result = { ticksByTeam, warnings, failures, dates };
    __resetTrainingDayCloseStateForTests();
  });

  it("hver kalenderdato koerer, uden fejl og uden sprungne loebsdage", () => {
    assert.equal(result.dates.length, REAL_DAYS);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.warnings, []);
  });

  it("hvert hold faar PRAECIS 140 loebsdags-ticks: hver loebsdag 0..139 een gang", () => {
    assert.equal(result.ticksByTeam.size, 4);
    for (const [teamId, ticks] of result.ticksByTeam) {
      assert.equal(ticks.length, TARGET, `${teamId}: ${ticks.length} ticks`);
      assert.deepEqual([...ticks].sort((a, b) => a - b), ALL_GAME_DAYS, `${teamId}: forkert maengde`);
    }
  });
});
