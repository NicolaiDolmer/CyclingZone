import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applySameDateEnteringFatigueV2 } from "./raceFatigue.js";
import { enteringFatigueV2, settleDateFatigueV2 } from "./conditionModelV2.js";
import {
  applyStageStartFatigue, loadStageStart, loadUnsettledDateLoads, riderFatigueAtStageStart, riderFatigueNow, ridersWithFatigueNow,
} from "./riderFatigueNow.js";
import { buildScenario, digestScenarios, fakeSupabase, modelFingerprint, runScenario } from "./__fixtures__/riderFatigueNow7801Scenarios.js";

const frozen = JSON.parse(readFileSync(new URL("./__fixtures__/riderFatigueNow7801Base.json", import.meta.url), "utf8"));

// The frozen fixture predates stamps. Model that absent table explicitly; its
// generic fake otherwise returns race-ledger rows/errors for every new table.
const unstamped = (apply = applyStageStartFatigue) => args => apply({ ...args, supabase: {
  from(table) {
    if (table !== "training_train_now_locks") return args.supabase.from(table);
    const q = { select() { return q; }, eq() { return q; }, in() { return q; },
      then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); } };
    return q;
  },
} });

test("#7801: motorens indgang er bit-identisk med merge-basen", async (t) => {
  // Facit er skrevet med basens regnestykke. Er modellen kalibreret om siden, siger facit
  // ikke længere noget om denne omlægning; generér det ikke om, men fjern fixturen.
  if (modelFingerprint() !== frozen.modelFingerprint) return t.skip("condition v2 er ændret efter facit blev skrevet");
  const digest = await digestScenarios(unstamped());
  for (const key of ["scenarios", "entrants", "returned", "thrown", "reads", "empty"]) {
    assert.equal(digest[key], frozen[key], `${key} afviger fra merge-basen ${frozen.sourceCommit}`);
  }
});

test("#7801: scenarierne rammer motorens forskellige veje", async () => {
  const results = [];
  for (let seed = 1; seed <= 200; seed++) results.push(await runScenario(seed, unstamped()));
  assert.ok(results.some((r) => r.returned > 0), "nogen ryttere ændres");
  assert.ok(results.some((r) => r.returned === 0), "nogen ryttere ændres ikke");
  assert.ok(results.some((r) => r.thrown?.startsWith("race_stage_schedule")), "plan-fejl kastes");
  assert.ok(results.some((r) => r.thrown?.startsWith("training_race_loads")), "ledger-fejl kastes");
  const chunked = await runScenario(97, unstamped());
  assert.equal(chunked.log.filter(([table, method]) => table === "training_race_loads" && method === "await").length, 3, "felt over chunk-størrelsen læses i bidder");
});

test("#7801: applySameDateEnteringFatigueV2 er samme funktion som fladernes kerne", async () => {
  for (let seed = 1; seed <= 120; seed++) {
    const viaEngine = await runScenario(seed, applySameDateEnteringFatigueV2);
    const viaCore = await runScenario(seed, applyStageStartFatigue);
    assert.deepEqual(viaCore, viaEngine);
  }
});

test("#7801: lige nu er åbningen plus datoens kørte etaper", () => {
  assert.equal(riderFatigueNow({ openingFatigue: 30 }), 30);
  assert.equal(riderFatigueNow({ openingFatigue: 30.5, dateLoads: [] }), 30.5, "uden etaper er tallet åbningen, uændret");
  const args = { openingFatigue: 30, recoveryAbility: 60, medicalBonus: 2 };
  assert.equal(riderFatigueNow({ ...args, dateLoads: [20, 15] }), enteringFatigueV2({ ...args, priorLoadsToday: [20, 15] }));
});

test("#7801: start af næste etape samme dato er det tal, motoren kører på", async () => {
  const ledger = [{ rider_id: "a", game_day: 10, load: 20 }, { rider_id: "a", game_day: 11, load: 15 }]
    .map((row) => ({ ...row, tick_date: "2026-11-01", consumed_at: null, duplicate_of_race_id: null }));
  const entrants = [{ rider_id: "a", team_id: "t", fatigue: 30, abilities: { recovery: 60 } }];
  const scenario = { ledger, schedule: { game_day: 12, scheduled_at: "2026-11-01T14:00:00Z" } };
  await applySameDateEnteringFatigueV2({ supabase: fakeSupabase(scenario), raceId: "r", stageNumber: 3, entrants, medicalBonusByTeam: new Map([["t", 2]]) });
  assert.equal(entrants[0].fatigue, riderFatigueAtStageStart({ openingFatigue: 30, loadsBeforeStage: [20, 15], recoveryAbility: 60, medicalBonus: 2 }));
});

test("#7801: en etape på en senere dato går gennem aftenens opgørelse først", () => {
  const dates = [
    { intensities: ["race", "rest", "rest", "rest", "rest"], raceLoads: [25, 0, 0, 0, 0] },
    { intensities: ["rest", "rest", "rest", "rest", "rest"], raceLoads: [0, 0, 0, 0, 0] },
  ];
  const args = { recoveryAbility: 60, medicalBonus: 1 };
  let expected = 40;
  for (const date of dates) expected = settleDateFatigueV2({ fatigue: expected, ...date, ...args });
  assert.equal(riderFatigueAtStageStart({ openingFatigue: 40, datesBefore: dates, ...args }), expected);
  assert.equal(
    riderFatigueAtStageStart({ openingFatigue: 40, datesBefore: dates, loadsBeforeStage: [18], ...args }),
    enteringFatigueV2({ openingFatigue: expected, priorLoadsToday: [18], ...args }),
  );
});

test("#7801: etapens dato er den danske kalenderdato; uplanlagt etape giver null", async () => {
  const at = (schedule) => loadStageStart({ supabase: fakeSupabase({ schedule }), raceId: "r", stageNumber: 1 });
  assert.deepEqual(await at({ game_day: 7, scheduled_at: "2026-10-31T23:30:00Z" }), { gameDay: 7, tickDate: "2026-11-01" });
  assert.equal(await at(null), null);
  assert.equal(await at({ game_day: 7, scheduled_at: null }), null);
});

test("#7801: datoens belastninger læses i løbsdags-orden; beforeGameDay afgrænser", async () => {
  const row = (game_day, load, extra = {}) => ({ rider_id: "a", game_day, load, tick_date: "2026-11-01", consumed_at: null, duplicate_of_race_id: null, ...extra });
  const scenario = {
    reverseRows: true,
    ledger: [row(3, 30), row(1, 10), row(2, "x"), row(1, 99, { consumed_at: "2026-11-01T20:05:00Z" }), row(2, 99, { duplicate_of_race_id: "d" }), row(1, 99, { tick_date: "2026-10-22" })],
  };
  const read = (extra = {}) => loadUnsettledDateLoads({ supabase: fakeSupabase(scenario), riderIds: ["a"], tickDate: "2026-11-01", ...extra });
  assert.deepEqual((await read()).get("a"), [10, 0, 30]);
  assert.deepEqual((await read({ beforeGameDay: 3 })).get("a"), [10, 0]);
  assert.equal((await read({ beforeGameDay: 1 })).get("a"), undefined);
});

// Flag-opslag ved siden af ledgeren: samme fake, plus app_config.
function flaggedSupabase(flagValue, scenario, log) {
  const ledger = fakeSupabase(scenario, log);
  return {
    from(table) {
      if (table !== "app_config") return ledger.from(table);
      const q = { _key: null, select() { return q; }, eq(_column, key) { q._key = key; return q; }, async maybeSingle() { return { data: { value: flagValue }, error: null }; } };
      return q;
    },
  };
}

test("#7801: flader får dagens etaper med, gamle uafregnede rækker tæller ikke", async () => {
  const row = (rider_id, game_day, load, tick_date) => ({ rider_id, game_day, load, tick_date, consumed_at: null, duplicate_of_race_id: null });
  const scenario = { ledger: [row("a", 10, 20, "2026-11-01"), row("a", 11, 15, "2026-11-01"), row("b", 4, 40, "2026-10-22")] };
  const riders = [
    { rider_id: "a", team_id: "t", fatigue: 30, abilities: { recovery: 60 } },
    { rider_id: "b", team_id: "t", fatigue: 30 },
    { rider_id: "c", team_id: "t" },
  ];
  const log = [];
  const out = await ridersWithFatigueNow({
    supabase: flaggedSupabase("on", scenario, log), riders, now: new Date("2026-10-31T23:30:00Z"), medicalBonusByTeam: new Map([["t", 2]]),
  });
  assert.equal(out[0].fatigue, riderFatigueNow({ openingFatigue: 30, dateLoads: [20, 15], recoveryAbility: 60, medicalBonus: 2 }));
  assert.equal(out[1].fatigue, 30);
  assert.equal(out[2].fatigue, undefined);
  assert.equal(riders[0].fatigue, 30, "input muteres ikke");
  assert.ok(!log.some(([, method]) => method === "lt"), "lige nu har ingen løbsdags-grænse");
});

test("#7801: lige nu efter en etape er motorens tal ved næste etape samme dato", async () => {
  for (let seed = 1; seed <= 120; seed++) {
    const scenario = buildScenario(seed);
    if (scenario.scheduleError || scenario.ledgerError || !Number.isInteger(scenario.schedule?.game_day) || !scenario.schedule?.scheduled_at) continue;
    const beforeStage = scenario.ledger.filter((row) => row.game_day < scenario.schedule.game_day);
    const clean = { ...scenario, ledger: beforeStage };
    const engine = scenario.entrants.map((e) => ({ ...e }));
    await applyStageStartFatigue({ supabase: fakeSupabase(clean), raceId: "r", stageNumber: 1, entrants: engine, medicalBonusByTeam: scenario.medicalBonusByTeam });
    const now = await ridersWithFatigueNow({
      supabase: flaggedSupabase("on", clean), riders: scenario.entrants, now: new Date(scenario.schedule.scheduled_at), medicalBonusByTeam: scenario.medicalBonusByTeam,
    });
    assert.deepEqual(now, engine);
  }
});

test("#7801: uden condition_model_v2 er rider_condition sandt og ledgeren læses ikke", async () => {
  const log = [];
  const riders = [{ rider_id: "a", team_id: "t", fatigue: 30 }];
  const out = await ridersWithFatigueNow({ supabase: flaggedSupabase("off", { ledger: [] }, log), riders, now: new Date("2026-10-31T23:30:00Z") });
  assert.deepEqual(out, riders);
  assert.ok(log.every(([table]) => table === "training_train_now_locks"), "durable stamps are checked even with the model off");
  assert.deepEqual(await ridersWithFatigueNow({ supabase: { from() { throw new Error("må ikke læse"); } }, riders: null, now: new Date("2026-10-31T23:30:00Z") }), []);
});
