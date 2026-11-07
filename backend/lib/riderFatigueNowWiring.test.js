// #7801 PR 2: kontakten fatigue_now_7801 og kalderne af riderFatigueNow.js.
//
// Bit-identitet med kontakten slukket bevises mod en FROSSET digest fra merge-basen
// (__fixtures__/fatigueNow7801FlagOffBase.json, genereret i et separat checkout af basen før
// koden blev rørt). Den genereres aldrig med den nye kode.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  fatigueByRiderNow, fatigueNowBeforeGameDay, fatigueOutlookForTeam, firstStageNumber, loadNextStageByRider, riderFatigueNow, slotFatiguesNow,
} from "./riderFatigueNow.js";
import { evaluateFatigueNow7801Flag, FATIGUE_NOW_7801_FLAG_KEY, isFatigueNow7801Enabled } from "./riderFatigueNowFlag.js";
import { FRESH_FLAG_KEYS } from "./featureStage.js";
import { runScenarios } from "./__fixtures__/fatigueNow7801FlagOffScenarios.js";

const BASE = JSON.parse(readFileSync(new URL("./__fixtures__/fatigueNow7801FlagOffBase.json", import.meta.url), "utf8"));

// ── Fake supabase: app_config + de tabeller kalderne læser ──────────────────────────
function fakeSupabase({ flag = undefined, v2 = "on", ledger = [], abilities = [], schedule = [], entryDays = [], races = null, log = [] } = {}) {
  // Uden `races`: hvert planlagt løb står som uden kørte etaper.
  const raceRows = races ?? [...new Set(schedule.map((s) => s.race_id))].map((id) => ({ id, stages_completed: 0 }));
  const config = { fatigue_now_7801: flag, condition_model_v2: v2, training_condition_per_date: "on", training_tick_per_race_day: "on" };
  return {
    from(table) {
      log.push(table);
      const filters = [];
      const chain = {
        select() { return chain; },
        eq(col, val) { filters.push((r) => r[col] === val); return chain; },
        in(col, vals) { filters.push((r) => vals.includes(r[col])); return chain; },
        lt(col, val) { filters.push((r) => r[col] < val); return chain; },
        gt(col, val) { filters.push((r) => r[col] > val); return chain; },
        gte(col, val) { filters.push((r) => r[col] >= val); return chain; },
        is(col, val) { filters.push((r) => (r[col] ?? null) === val); return chain; },
        order() { return chain; },
        range() { return chain; },
        limit() { return chain; },
        rows() {
          const rows = { training_race_loads: ledger, rider_derived_abilities: abilities, race_stage_schedule: schedule, race_entry_days: entryDays, races: raceRows, race_entries: [], race_results: [] }[table] ?? [];
          return rows.filter((r) => filters.every((f) => f(r)));
        },
        maybeSingle() { return Promise.resolve({ data: chain.rows()[0] ?? null, error: null }); },
        then(resolve, reject) {
          return Promise.resolve({ data: chain.rows(), error: null }).then(resolve, reject);
        },
      };
      if (table === "app_config") {
        chain.maybeSingle = () => {
          const probe = Object.keys(config).find((k) => filters.every((f) => f({ key: k })));
          const value = probe ? config[probe] : undefined;
          return Promise.resolve({ data: value === undefined ? null : { value }, error: null });
        };
      }
      return chain;
    },
  };
}

test("kontakten: kun den eksakte streng \"on\" tænder; fejl = slukket; læses friskt", async () => {
  assert.equal(FATIGUE_NOW_7801_FLAG_KEY, "fatigue_now_7801");
  for (const v of ["off", "beta", true, "ON", null, undefined, 1]) assert.equal(evaluateFatigueNow7801Flag(v), false, String(v));
  assert.equal(evaluateFatigueNow7801Flag("on"), true);
  assert.equal(await isFatigueNow7801Enabled({ from() { throw new Error("db nede"); } }), false);
  assert.ok(FRESH_FLAG_KEYS.has(FATIGUE_NOW_7801_FLAG_KEY), "træningens regler må ikke læse kontakten fra cachen");
});

test("slukket: opgørelse og prognose er bit-identiske med merge-basen (frossen digest)", () => {
  const now = runScenarios();
  assert.equal(now.settleCount, BASE.settleCount);
  assert.equal(now.forecastCount, BASE.forecastCount);
  assert.equal(now.settle, BASE.settle, "aftenens opgørelse (træthed, form, skaderisiko, skade) ændret med kontakten slukket");
  assert.equal(now.forecast, BASE.forecast, "prognosen med træthedsregler ændret med kontakten slukket");
});

test("tændt: samme scenarier giver andre udfald (scenarierne rammer grenene, kontakten ændrer)", () => {
  const on = runScenarios({
    onArgs: {
      settle: (args) => ({ riskFatigues: slotFatiguesNow({ openingFatigue: Number(args.condition.fatigue), intensities: args.intensities, raceLoads: args.raceLoads, recoveryAbility: args.recoveryAbility, medicalBonus: args.medicalBonus }) }),
      forecast: { fatigueNow: true },
    },
  });
  assert.notEqual(on.settle, BASE.settle, "skaderisikoen på live-tallet skal ramme mindst ét scenarie");
  assert.notEqual(on.forecast, BASE.forecast, "reglen på live-tallet skal ramme mindst ét scenarie");
});

test("fatigueNowBeforeGameDay: kun rytterens egne etaper på tidligere løbsdage, i løbsdags-orden", () => {
  const rows = [
    { rider_id: "a", game_day: 43, load: 20 },
    { rider_id: "a", game_day: 41, load: 15 },
    { rider_id: "b", game_day: 41, load: 30 },
    { rider_id: "a", game_day: 44, load: 40 },
  ];
  const got = fatigueNowBeforeGameDay({ openingFatigue: 50, loadRows: rows, riderId: "a", beforeGameDay: 44, recoveryAbility: 60 });
  assert.equal(got, riderFatigueNow({ openingFatigue: 50, dateLoads: [15, 20], recoveryAbility: 60 }));
  assert.equal(fatigueNowBeforeGameDay({ openingFatigue: 50, loadRows: rows, riderId: "a", beforeGameDay: 41 }), 50, "første felt = åbningen");
  assert.ok(got > 50);
});

test("slotFatiguesNow: hvert felt ser kun etaperne i felterne før sig", () => {
  const out = slotFatiguesNow({ openingFatigue: 40, intensities: ["race", "hard", "race", "normal", "rest"], raceLoads: [25, 0, 18, 0, 0], recoveryAbility: 50 });
  assert.equal(out.length, 5);
  assert.equal(out[0], 40);
  assert.equal(out[1], riderFatigueNow({ openingFatigue: 40, dateLoads: [25], recoveryAbility: 50 }));
  assert.equal(out[1], out[2]);
  assert.equal(out[3], riderFatigueNow({ openingFatigue: 40, dateLoads: [25, 18], recoveryAbility: 50 }));
  assert.equal(out[4], out[3]);
});

const CONDITIONS = [{ rider_id: "a", fatigue: 55 }, { rider_id: "b", fatigue: null }, { rider_id: "c", fatigue: 80 }];

test("fatigueByRiderNow slukket: præcis dagens map, og intet læses ud over kontakten", async () => {
  for (const flag of [undefined, "off", "beta"]) {
    const log = [];
    const got = await fatigueByRiderNow({ supabase: fakeSupabase({ flag, log, ledger: [{ rider_id: "a", tick_date: "2026-11-04", game_day: 41, load: 30, consumed_at: null, duplicate_of_race_id: null }] }), conditions: CONDITIONS, teamId: "t", now: new Date("2026-11-04T15:00:00Z") });
    assert.deepEqual([...got], [...new Map(CONDITIONS.map((c) => [c.rider_id, c.fatigue]))]);
    assert.deepEqual([...new Set(log)], ["app_config"], `flag=${flag}`);
  }
  const empty = await fatigueByRiderNow({ supabase: { from() { throw new Error("må ikke læse"); } }, conditions: [], now: new Date("2026-11-04T15:00:00Z") });
  assert.equal(empty.size, 0);
});

test("fatigueByRiderNow tændt: datoens kørte etaper lægges oveni; uden etaper er tallet uændret", async () => {
  const ledger = [{ rider_id: "a", tick_date: "2026-11-04", game_day: 41, load: 30, consumed_at: null, duplicate_of_race_id: null }];
  const got = await fatigueByRiderNow({
    supabase: fakeSupabase({ flag: "on", ledger, abilities: [{ rider_id: "a", recovery: 60 }, { rider_id: "c", recovery: 40 }] }),
    conditions: CONDITIONS, teamId: "t", now: new Date("2026-11-04T15:00:00Z"),
  });
  assert.equal(got.get("a"), riderFatigueNow({ openingFatigue: 55, dateLoads: [30], recoveryAbility: 60 }));
  assert.ok(got.get("a") > 55);
  assert.equal(got.get("c"), 80);
  assert.equal(got.get("b"), null);
});

test("fatigueByRiderNow tændt men læsefejl: dagens tal frem for en væltet udtagelse", async () => {
  const supabase = fakeSupabase({ flag: "on" });
  const from = supabase.from.bind(supabase);
  supabase.from = (table) => {
    if (table === "training_race_loads") throw new Error("ledger nede");
    return from(table);
  };
  const got = await fatigueByRiderNow({ supabase, conditions: CONDITIONS, teamId: "t", abilityByRider: new Map(), now: new Date("2026-11-04T15:00:00Z") });
  assert.deepEqual([...got], [...new Map(CONDITIONS.map((c) => [c.rider_id, c.fatigue]))]);
});

test("fatigueOutlookForTeam: slukket = null (fladen er som i dag)", async () => {
  assert.equal(await fatigueOutlookForTeam({ supabase: fakeSupabase({ flag: "off" }), team: { id: "t" }, seasonId: "s", conditions: CONDITIONS, now: new Date("2026-11-04T15:00:00Z") }), null);
});

test("fatigueOutlookForTeam tændt: næste etape i dag = tallet lige nu; uden etape intet skøn", async () => {
  const now = new Date("2026-11-04T15:00:00Z");
  const supabase = fakeSupabase({
    flag: "on",
    ledger: [{ rider_id: "a", tick_date: "2026-11-04", game_day: 41, load: 30, consumed_at: null, duplicate_of_race_id: null }],
    abilities: [{ rider_id: "a", recovery: 50 }],
    schedule: [{ race_id: "R", stage_number: 2, game_day: 42, scheduled_at: "2026-11-04T17:00:00Z" }],
    entryDays: [{ rider_id: "a", race_id: "R", game_day: 42, season_id: "s" }],
  });
  const out = await fatigueOutlookForTeam({ supabase, team: { id: "t" }, seasonId: "s", conditions: CONDITIONS, now });
  const a = out.get("a");
  assert.ok(a.fatigue > 55);
  assert.equal(a.fatigueAtStart, a.fatigue);
  assert.equal(out.get("c").fatigueAtStart, null);
});

test("loadNextStageByRider: tidligste ikke-startede etape; længere frem end i morgen gives intet", async () => {
  const now = new Date("2026-11-04T15:00:00Z");
  const supabase = fakeSupabase({
    schedule: [
      { race_id: "R", stage_number: 3, game_day: 46, scheduled_at: "2026-11-05T12:00:00Z" },
      { race_id: "R", stage_number: 2, game_day: 42, scheduled_at: "2026-11-04T17:00:00Z" },
      { race_id: "Q", stage_number: 1, game_day: 46, scheduled_at: "2026-11-05T12:00:00Z" },
    ],
    entryDays: [
      { rider_id: "a", race_id: "R", game_day: 46, season_id: "s" },
      { rider_id: "a", race_id: "R", game_day: 42, season_id: "s" },
      { rider_id: "b", race_id: "Q", game_day: 46, season_id: "s" },
    ],
  });
  const next = await loadNextStageByRider({ supabase, riderIds: ["a", "b", "c"], seasonId: "s", now });
  assert.equal(next.get("a").gameDay, 42);
  assert.equal(next.get("a").tickDate, "2026-11-04");
  assert.equal(next.get("b").tickDate, "2026-11-05");
  assert.equal(next.has("c"), false);
});

// Review 7/11, P2: en etape, hvis planlagte tid er passeret uden at den er kørt, er stadig
// rytterens næste. Uret afgør ikke, om en etape er kørt; løbets stages_completed gør.
test("loadNextStageByRider: en forsinket etape er stadig den næste; en kørt etape er ikke", async () => {
  const now = new Date("2026-11-04T15:30:00Z");
  const schedule = [
    { race_id: "R", stage_number: 1, game_day: 40, scheduled_at: "2026-11-04T11:00:00Z" },
    { race_id: "R", stage_number: 2, game_day: 41, scheduled_at: "2026-11-04T14:00:00Z" },
    { race_id: "R", stage_number: 3, game_day: 46, scheduled_at: "2026-11-05T12:00:00Z" },
    { race_id: "Q", stage_number: 1, game_day: 41, scheduled_at: "2026-11-04T14:00:00Z" },
  ];
  const entryDays = [
    { rider_id: "a", race_id: "R", game_day: 40, season_id: "s" },
    { rider_id: "a", race_id: "R", game_day: 41, season_id: "s" },
    { rider_id: "a", race_id: "R", game_day: 46, season_id: "s" },
    { rider_id: "b", race_id: "Q", game_day: 41, season_id: "s" },
  ];
  const races = [{ id: "R", stages_completed: 1 }, { id: "Q", stages_completed: 1 }];
  const next = await loadNextStageByRider({ supabase: fakeSupabase({ schedule, entryDays, races }), riderIds: ["a", "b"], seasonId: "s", now });
  assert.equal(next.get("a").stageNumber, 2, "etape 2 er forsinket (planlagt før nu) og ikke kørt");
  assert.equal(next.get("a").tickDate, "2026-11-04");
  assert.equal(next.has("b"), false, "Q's eneste etape er kørt");

  const allRun = await loadNextStageByRider({ supabase: fakeSupabase({ schedule, entryDays, races: [{ id: "R", stages_completed: 3 }] }), riderIds: ["a", "b"], seasonId: "s", now });
  assert.equal(allRun.size, 0, "kørte etaper og et løb uden række giver intet skøn");
});

// Review 7/11, P1: assistenten udtager til en bestemt etape. Fast ur (AGENTS 16): `now` peger
// på en anden dato end etapen, og etapens planlagte start skal vinde.
test("fatigueByRiderNow atStage: etapens planlagte start er nu, og kun løbsdagene før etapen tæller", async () => {
  const row = (game_day, load, tick_date = "2026-11-04") => ({ rider_id: "a", tick_date, game_day, load, consumed_at: null, duplicate_of_race_id: null });
  const ledger = [row(41, 30), row(44, 25), row(41, 40, "2026-11-09")];
  const schedule = [{ race_id: "R", stage_number: 3, game_day: 43, scheduled_at: "2026-11-04T17:00:00Z" }];
  const args = { conditions: CONDITIONS, teamId: "t", now: new Date("2026-11-09T10:00:00Z"), atStage: { raceId: "R", stageNumber: 3 } };
  const supabase = fakeSupabase({ flag: "on", ledger, schedule, abilities: [{ rider_id: "a", recovery: 60 }] });
  const got = await fatigueByRiderNow({ supabase, ...args });
  assert.equal(got.get("a"), riderFatigueNow({ openingFatigue: 55, dateLoads: [30], recoveryAbility: 60 }));
  assert.equal(got.get("c"), 80);

  const unplanned = await fatigueByRiderNow({ supabase: fakeSupabase({ flag: "on", ledger }), ...args });
  assert.deepEqual([...unplanned], [...new Map(CONDITIONS.map((c) => [c.rider_id, c.fatigue]))], "uplanlagt etape = åbningen, som i motoren");

  const log = [];
  const off = await fatigueByRiderNow({ supabase: fakeSupabase({ flag: "off", ledger, schedule, log }), ...args });
  assert.deepEqual([...off], [...new Map(CONDITIONS.map((c) => [c.rider_id, c.fatigue]))]);
  assert.deepEqual([...new Set(log)], ["app_config"], "slukket læser ikke planen");
});

test("firstStageNumber: laveste etapenummer; tom liste = etape 1", () => {
  assert.equal(firstStageNumber([{ stage_number: 3 }, { stage_number: 2 }]), 2);
  assert.equal(firstStageNumber([{ profile_type: "flat" }]), 1);
  assert.equal(firstStageNumber([]), 1);
  assert.equal(firstStageNumber(undefined), 1);
});
