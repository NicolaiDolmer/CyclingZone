// #1099 spec §9: enhedstests for omdømme-motoren — point-tabel pr.
// klasse/resultat, gulv-kap, halvering over sæsonskifte, ordbånd, dedupe ved
// gen-afslutning, seedFloor, og at hook'en er et rent no-op med flaget off.

import test from "node:test";
import assert from "node:assert/strict";

import {
  eventsFromStageResults,
  eventsFromResultRows,
  computeReputation,
  bandFor,
  classWeight,
  outcomeForRank,
  formPointsFor,
  floorCreditFor,
  seedFloorFor,
} from "./reputationEngine.js";
import {
  W_CLASS,
  FLOOR_CAP,
  SOFT_CAP,
  EVENT_BASE,
  EVENT_OUTCOME,
  SEED_FLOOR_WEIGHT,
  roundPoints,
  buildConstants,
} from "./reputationConstants.js";
import {
  normalizeReputationStage,
  isReputationWriteEnabled,
  isReputationReadEnabled,
  REPUTATION_STAGE,
} from "./reputationFlag.js";
import { runReputationForFinalization } from "./reputationHook.js";

const singleRace = (raceClass = "Monuments") => ({
  id: "race-single", season_id: "s1", race_type: "single", race_class: raceClass, stages: 1,
});
const stageRace = (raceClass = "TourFrance", stages = 21) => ({
  id: "race-gt", season_id: "s1", race_type: "stage_race", race_class: raceClass, stages,
});

// ── Point-tabel pr. klasse og resultat (spec §4) ────────────────────────────

test("klassevægt følger spec §4 og ukendte klasser vejer nul", () => {
  assert.equal(classWeight("TourFrance"), 1.0);
  assert.equal(classWeight("GiroVuelta"), 0.8);
  assert.equal(classWeight("Monuments"), 0.8);
  assert.equal(classWeight("ProSeries"), 0.25);
  assert.equal(classWeight("Class2"), 0.1);
  assert.equal(classWeight("HeltNyKlasse"), 0);
  assert.equal(classWeight(null), 0);
  assert.equal(Object.keys(W_CLASS).length, 9);
});

test("rank afgør udfald: 1 sejr, 2-3 podium, 4-10 top10, 11+ ingenting", () => {
  assert.equal(outcomeForRank(1), EVENT_OUTCOME.WIN);
  assert.equal(outcomeForRank(3), EVENT_OUTCOME.PODIUM);
  assert.equal(outcomeForRank(4), EVENT_OUTCOME.TOP10);
  assert.equal(outcomeForRank(10), EVENT_OUTCOME.TOP10);
  assert.equal(outcomeForRank(11), null);
  assert.equal(outcomeForRank(null), null);
});

test("form-basispoint: endagssejr 20·W, GC-sejr 25·W, etapesejr 8·W, trøje 10·W", () => {
  assert.equal(formPointsFor({ base: EVENT_BASE.ONE_DAY, outcome: EVENT_OUTCOME.WIN, raceClass: "Monuments" }), 16); // 20 · 0,8
  assert.equal(formPointsFor({ base: EVENT_BASE.GC, outcome: EVENT_OUTCOME.WIN, raceClass: "TourFrance" }), 25);
  assert.equal(formPointsFor({ base: EVENT_BASE.STAGE, outcome: EVENT_OUTCOME.WIN, raceClass: "GiroVuelta" }), 6.4); // 8 · 0,8
  assert.equal(formPointsFor({ base: EVENT_BASE.JERSEY_POINTS, outcome: EVENT_OUTCOME.WIN, raceClass: "OtherWorldTourA" }), 6); // 10 · 0,6
});

test("podium giver 40 % og top 10 giver 10 % af sejrens formpoint", () => {
  const win = formPointsFor({ base: EVENT_BASE.GC, outcome: EVENT_OUTCOME.WIN, raceClass: "TourFrance" });
  assert.equal(formPointsFor({ base: EVENT_BASE.GC, outcome: EVENT_OUTCOME.PODIUM, raceClass: "TourFrance" }), win * 0.4);
  assert.equal(formPointsFor({ base: EVENT_BASE.GC, outcome: EVENT_OUTCOME.TOP10, raceClass: "TourFrance" }), win * 0.1);
});

test("gulv-kredit gives kun ved sejr, og aldrig i Class2 (kørsel 2: Class1 fik en lille kredit)", () => {
  assert.equal(floorCreditFor({ base: EVENT_BASE.GC, outcome: EVENT_OUTCOME.WIN, raceClass: "TourFrance" }), 20);
  assert.equal(floorCreditFor({ base: EVENT_BASE.GC, outcome: EVENT_OUTCOME.WIN, raceClass: "GiroVuelta" }), 15);
  assert.equal(floorCreditFor({ base: EVENT_BASE.ONE_DAY, outcome: EVENT_OUTCOME.WIN, raceClass: "Monuments" }), 15);
  // Kørsel 2 (docs/audits/reputation-calibration-2026-09-05.md): ProSeries-
  // sejr 1 → 2, Class1-sejr 0 → 1 — nødvendigt for at holde de 20 mest
  // vindende ryttere i S1-S3 alle ≥ 70 (spec §9).
  assert.equal(floorCreditFor({ base: EVENT_BASE.ONE_DAY, outcome: EVENT_OUTCOME.WIN, raceClass: "ProSeries" }), 2);
  assert.equal(floorCreditFor({ base: EVENT_BASE.GC, outcome: EVENT_OUTCOME.WIN, raceClass: "ProSeries" }), 2);
  assert.equal(floorCreditFor({ base: EVENT_BASE.ONE_DAY, outcome: EVENT_OUTCOME.WIN, raceClass: "Class1" }), 1);
  assert.equal(floorCreditFor({ base: EVENT_BASE.GC, outcome: EVENT_OUTCOME.WIN, raceClass: "Class1" }), 1);
  assert.equal(floorCreditFor({ base: EVENT_BASE.STAGE, outcome: EVENT_OUTCOME.WIN, raceClass: "TourFrance" }), 4);
  // Podium og top 10: nul.
  assert.equal(floorCreditFor({ base: EVENT_BASE.GC, outcome: EVENT_OUTCOME.PODIUM, raceClass: "TourFrance" }), 0);
  // Class2: stadig nul, uanset hændelse (uændret af kørsel 2).
  assert.equal(floorCreditFor({ base: EVENT_BASE.ONE_DAY, outcome: EVENT_OUTCOME.WIN, raceClass: "Class2" }), 0);
  assert.equal(floorCreditFor({ base: EVENT_BASE.GC, outcome: EVENT_OUTCOME.WIN, raceClass: "Class2" }), 0);
});

test("floorCreditFor/formPointsFor/classWeight tager en kalibrerings-override UDEN at røre modulets egne frosne konstanter", () => {
  const constants = buildConstants({ "W_CLASS.ProSeries": 0.35, "FLOOR_CREDITS.one_day.Class1": 9 });
  assert.equal(classWeight("ProSeries", constants.W_CLASS), 0.35);
  assert.equal(classWeight("ProSeries"), 0.25); // modulets W_CLASS uændret
  assert.equal(
    floorCreditFor({ base: EVENT_BASE.ONE_DAY, outcome: EVENT_OUTCOME.WIN, raceClass: "Class1", floorCredits: constants.FLOOR_CREDITS, noFloorCreditClasses: constants.NO_FLOOR_CREDIT_CLASSES }),
    9,
  );
  assert.equal(floorCreditFor({ base: EVENT_BASE.ONE_DAY, outcome: EVENT_OUTCOME.WIN, raceClass: "Class1" }), 1); // modulets FLOOR_CREDITS uændret
});

// ── Hændelses-udledning fra resultatrækker ──────────────────────────────────

test("endagsløb: gc rank 1 giver one_day_win (prod skriver IKKE 'stage' for single)", () => {
  const events = eventsFromStageResults({
    race: singleRace("Monuments"),
    stageNumber: 1,
    isLastStage: true,
    results: [
      { rider_id: "r1", team_id: "t1", result_type: "gc", rank: 1 },
      { rider_id: "r2", team_id: "t1", result_type: "gc", rank: 2 },
      { rider_id: "r3", team_id: "t2", result_type: "gc", rank: 7 },
      { rider_id: "r4", team_id: "t2", result_type: "gc", rank: 44 },
      { rider_id: "r5", team_id: "t2", result_type: "team", rank: 1 },
    ],
  });
  assert.deepEqual(events.map((e) => e.event_kind), ["one_day_win", "one_day_podium", "one_day_top10"]);
  assert.equal(events[0].form_points, 16);
  assert.equal(events[0].floor_credit, 15);
  assert.equal(events[1].form_points, 6.4);
  assert.equal(events[1].floor_credit, 0);
  assert.equal(events[2].form_points, 1.6);
});

test("eventsFromStageResults tager en kalibrerings-override (`constants`) UDEN at ændre modulets egen udledning", () => {
  const results = [{ rider_id: "r1", team_id: "t1", result_type: "gc", rank: 1 }];
  const defaultEvents = eventsFromStageResults({ race: singleRace("ProSeries"), stageNumber: 1, isLastStage: true, results });
  assert.equal(defaultEvents[0].floor_credit, 2); // kørsel 2-default

  const constants = buildConstants({ "FLOOR_CREDITS.one_day.ProSeries": 9, "W_CLASS.ProSeries": 0.5 });
  const overriddenEvents = eventsFromStageResults({
    race: singleRace("ProSeries"), stageNumber: 1, isLastStage: true, results, constants,
  });
  assert.equal(overriddenEvents[0].floor_credit, 9);
  assert.equal(overriddenEvents[0].form_points, 10); // 20 · 0,5

  // Modulets egen udledning (uden `constants`) er stadig uændret.
  const stillDefault = eventsFromStageResults({ race: singleRace("ProSeries"), stageNumber: 1, isLastStage: true, results });
  assert.equal(stillDefault[0].floor_credit, 2);
});

test("hold-resultater tæller ikke (spec §4)", () => {
  const events = eventsFromStageResults({
    race: stageRace(),
    stageNumber: 5,
    isLastStage: false,
    results: [
      { rider_id: "r1", result_type: "team", rank: 1 },
      { rider_id: "r1", result_type: "team_day", rank: 1 },
      { rider_id: "r1", result_type: "points_day", rank: 1 },
      { rider_id: "r1", result_type: "mountain_day", rank: 1 },
      { rider_id: "r1", result_type: "young_day", rank: 1 },
    ],
  });
  assert.equal(events.length, 0);
});

test("etapeløb: GC + trøjer tæller KUN på sidste etape, etapesejr tæller altid", () => {
  const midStage = eventsFromStageResults({
    race: stageRace(), stageNumber: 5, isLastStage: false,
    results: [
      { rider_id: "r1", result_type: "stage", rank: 1 },
      { rider_id: "r2", result_type: "gc", rank: 1 },
      { rider_id: "r3", result_type: "points", rank: 1 },
    ],
  });
  assert.deepEqual(midStage.map((e) => e.event_kind), ["stage_win"]);

  const finalStage = eventsFromStageResults({
    race: stageRace(), stageNumber: 21, isLastStage: true,
    results: [
      { rider_id: "r1", result_type: "stage", rank: 1 },
      { rider_id: "r2", result_type: "gc", rank: 1 },
      { rider_id: "r3", result_type: "points", rank: 1 },
      { rider_id: "r4", result_type: "young", rank: 1 },
    ],
  });
  assert.deepEqual(finalStage.map((e) => e.event_kind),
    ["stage_win", "gc_win", "jersey_points_win", "jersey_young_win"]);
});

test("de tre trøjer får hver sin event_kind, så samme rytter kan vinde flere på samme etape", () => {
  const events = eventsFromStageResults({
    race: stageRace(), stageNumber: 21, isLastStage: true,
    results: [
      { rider_id: "r1", result_type: "points", rank: 1 },
      { rider_id: "r1", result_type: "mountain", rank: 1 },
      { rider_id: "r1", result_type: "young", rank: 1 },
    ],
  });
  assert.equal(events.length, 3);
  assert.equal(new Set(events.map((e) => e.dedupe_key)).size, 3);
  assert.equal(events.reduce((s, e) => s + e.floor_credit, 0), 12); // 3 × GT-trøje 4
});

test("dag i førertrøje: rank 1, ikke sidste etape, 2·W og ingen gulv-kredit", () => {
  const events = eventsFromStageResults({
    race: stageRace("GiroVuelta"), stageNumber: 8, isLastStage: false,
    results: [
      { rider_id: "r1", result_type: "leader", rank: 1 },
      { rider_id: "r2", result_type: "leader", rank: 2 },
    ],
  });
  assert.deepEqual(events.map((e) => e.event_kind), ["leader_day"]);
  assert.equal(events[0].form_points, 1.6); // 2 · 0,8
  assert.equal(events[0].floor_credit, 0);

  const onFinal = eventsFromStageResults({
    race: stageRace("GiroVuelta"), stageNumber: 21, isLastStage: true,
    results: [{ rider_id: "r1", result_type: "leader", rank: 1 }],
  });
  assert.equal(onFinal.length, 0);
});

test("dedupe: gen-afslutning af samme etape giver identiske dedupe_keys, og dubletter i input tælles kun én gang", () => {
  const results = [
    { rider_id: "r1", result_type: "stage", rank: 1 },
    { rider_id: "r1", result_type: "stage", rank: 1 }, // dublet i input
  ];
  const first = eventsFromStageResults({ race: stageRace(), stageNumber: 4, isLastStage: false, results });
  const second = eventsFromStageResults({ race: stageRace(), stageNumber: 4, isLastStage: false, results });
  assert.equal(first.length, 1);
  assert.deepEqual(first.map((e) => e.dedupe_key), second.map((e) => e.dedupe_key));
  assert.equal(first[0].dedupe_key, "rider:r1:race:race-gt:stage:4:stage_win");
});

test("eventsFromResultRows grupperer pr. etape og udleder sidste etape af race.stages", () => {
  const events = eventsFromResultRows({
    race: stageRace("TourFrance", 3),
    resultRows: [
      { rider_id: "r1", stage_number: 1, result_type: "stage", rank: 1 },
      { rider_id: "r1", stage_number: 2, result_type: "leader", rank: 1 },
      { rider_id: "r1", stage_number: 3, result_type: "gc", rank: 1 },
    ],
  });
  assert.deepEqual(events.map((e) => e.event_kind), ["stage_win", "leader_day", "gc_win"]);
});

// ── Tal-modellen (spec §3) ──────────────────────────────────────────────────

test("seedFloor = min(popularity, FLOOR_CAP) · SEED_FLOOR_WEIGHT", () => {
  assert.equal(seedFloorFor(30), 30);
  assert.equal(seedFloorFor(85), FLOOR_CAP); // kappet ved 60
  assert.equal(seedFloorFor(85, { seedFloorWeight: 0.5 }), 30);
  assert.equal(seedFloorFor(0), 0);
  assert.equal(seedFloorFor(null), 0);
  assert.equal(SEED_FLOOR_WEIGHT, 1.0);
});

test("gulvet kappes ved FLOOR_CAP uanset hvor mange sejre der ligger bag (uændret af det bløde loft)", () => {
  const events = Array.from({ length: 10 }, () => ({ form_points: 0, floor_credit: 20, season_index: 3 }));
  const { floor } = computeReputation({ seedPopularity: 40, events, currentSeasonIndex: 3 });
  assert.equal(floor, FLOOR_CAP);
});

test("form halveres pr. sæson siden hændelsen; gulvet gør ikke", () => {
  const event = { form_points: 40, floor_credit: 10, season_index: 1 };
  const sameSeason = computeReputation({ seedPopularity: 0, events: [event], currentSeasonIndex: 1 });
  const oneLater = computeReputation({ seedPopularity: 0, events: [event], currentSeasonIndex: 2 });
  const twoLater = computeReputation({ seedPopularity: 0, events: [event], currentSeasonIndex: 3 });
  assert.equal(sameSeason.form, 40);
  assert.equal(oneLater.form, 20);
  assert.equal(twoLater.form, 10);
  assert.equal(sameSeason.floor, 10);
  assert.equal(twoLater.floor, 10); // gulvet falder aldrig
  // Blødt loft (kørsel 2): reputation = 100 · tanh(raw / SOFT_CAP), raw = floor + form.
  assert.equal(twoLater.reputation, roundPoints(100 * Math.tanh(20 / SOFT_CAP)));
});

test("en hændelse fra en fremtidig sæson forstærker ikke formen", () => {
  const { form } = computeReputation({
    seedPopularity: 0,
    events: [{ form_points: 10, floor_credit: 0, season_index: 5 }],
    currentSeasonIndex: 3,
  });
  assert.equal(form, 10); // ikke 0,5^-2 · 10 = 40
});

// ── Blødt loft (kørsel 2, docs/audits/reputation-calibration-2026-09-05.md) ─

test("reputation nærmer sig 100 asymptotisk under det bløde loft, men rammer det ALDRIG eksakt", () => {
  const events = Array.from({ length: 20 }, () => ({ form_points: 25, floor_credit: 20, season_index: 3 }));
  const { reputation } = computeReputation({ seedPopularity: 100, events, currentSeasonIndex: 3 });
  // Kørsel 1's hårde clamp gav præcis 100 her — det var problemet (29 ryttere
  // klemt fast). Det bløde loft må ALDRIG ramme 100 eksakt, uanset hvor højt
  // raw (floor + form) er.
  assert.ok(reputation < 100, `reputation ${reputation} skal være < 100`);
  assert.ok(reputation > 99, `reputation ${reputation} skal stadig være tæt på loftet`);
});

test("blødt loft: reputation = 100 · tanh(raw / SOFT_CAP), altid ikke-negativ og aldrig > 100", () => {
  const cases = [
    { floorCredit: 0, form: 0 },
    { floorCredit: 30, form: 5 },
    { floorCredit: 60, form: 40 },
    { floorCredit: 60, form: 500 },
  ];
  for (const { floorCredit, form } of cases) {
    const { reputation, floor } = computeReputation({
      seedPopularity: 0,
      events: [{ form_points: form, floor_credit: floorCredit, season_index: 3 }],
      currentSeasonIndex: 3,
    });
    const raw = floor + roundPoints(form);
    assert.equal(reputation, roundPoints(100 * Math.tanh(raw / SOFT_CAP)));
    assert.ok(reputation >= 0 && reputation < 100);
  }
});

test("softCap er en valgfri kalibrerings-override i options — modulets SOFT_CAP er uændret uden den", () => {
  const events = [{ form_points: 40, floor_credit: 20, season_index: 3 }];
  const defaultRun = computeReputation({ seedPopularity: 0, events, currentSeasonIndex: 3 });
  const overriddenRun = computeReputation({ seedPopularity: 0, events, currentSeasonIndex: 3, options: { softCap: 40 } });
  assert.equal(defaultRun.reputation, roundPoints(100 * Math.tanh(60 / SOFT_CAP)));
  assert.equal(overriddenRun.reputation, roundPoints(100 * Math.tanh(60 / 40)));
  assert.notEqual(defaultRun.reputation, overriddenRun.reputation);
});

test("ordbånd følger grænserne 0/20/45/70/90", () => {
  assert.equal(bandFor(0).key, "unknown");
  assert.equal(bandFor(19.9).key, "unknown");
  assert.equal(bandFor(20).key, "known");
  assert.equal(bandFor(44.9).key, "known");
  assert.equal(bandFor(45).key, "profile");
  assert.equal(bandFor(69.9).key, "profile");
  assert.equal(bandFor(70).key, "star");
  assert.equal(bandFor(89.9).key, "star");
  assert.equal(bandFor(90).key, "legend");
  assert.equal(bandFor(100).key, "legend");
  assert.equal(bandFor(70).bandKeyEn, "Star");
  assert.equal(bandFor(70).bandKeyDa, "Stjerne");
});

// ── Flag + hook ─────────────────────────────────────────────────────────────

test("flag-stadier: kun 'shadow'/'on'/true tæller, alt andet er off (fail-safe)", () => {
  assert.equal(normalizeReputationStage("on"), REPUTATION_STAGE.ON);
  assert.equal(normalizeReputationStage(true), REPUTATION_STAGE.ON);
  assert.equal(normalizeReputationStage("shadow"), REPUTATION_STAGE.SHADOW);
  assert.equal(normalizeReputationStage("off"), REPUTATION_STAGE.OFF);
  assert.equal(normalizeReputationStage(null), REPUTATION_STAGE.OFF);
  assert.equal(normalizeReputationStage("beta"), REPUTATION_STAGE.OFF);

  assert.equal(isReputationWriteEnabled("shadow"), true);
  assert.equal(isReputationWriteEnabled("on"), true);
  assert.equal(isReputationWriteEnabled("off"), false);
  assert.equal(isReputationReadEnabled("shadow"), false);
  assert.equal(isReputationReadEnabled("on"), true);
});

// Minimal spion-klient: enhver .from() registreres, så et no-op kan bevises
// (ikke bare "ingen exception").
function spySupabase() {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      throw new Error(`uventet DB-adgang mod ${table} med flaget off`);
    },
  };
}

test("hook'en er et rent no-op med flaget off — ingen DB-adgang, ingen hændelser", async () => {
  const supabase = spySupabase();
  const stats = await runReputationForFinalization({
    supabase,
    race: stageRace(),
    resultRows: [{ rider_id: "r1", stage_number: 21, result_type: "gc", rank: 1 }],
    stageNumbers: [21],
    seasonNumber: 3,
    stage: "off",
  });
  assert.deepEqual(stats, { stage: "off", events: 0, inserted: 0, deduped: 0, ridersUpdated: 0 });
  assert.deepEqual(supabase.calls, []);
});

test("hook'en scoper til de etaper finaliseringen dækker", async () => {
  const inserted = [];
  const supabase = {
    from(table) {
      if (table === "rider_reputation_events") {
        return {
          insert: async (rows) => { inserted.push(...(Array.isArray(rows) ? rows : [rows])); return { error: null }; },
          select: () => ({
            in: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }),
          }),
        };
      }
      if (table === "seasons") {
        return { select: () => ({ order: () => ({ range: async () => ({ data: [{ id: "s1", number: 3 }], error: null }) }) }) };
      }
      if (table === "riders") {
        return {
          select: () => ({ in: () => ({ order: () => ({ range: async () => ({ data: [{ id: "r1", popularity: 10 }], error: null }) }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      throw new Error(`uventet tabel ${table}`);
    },
  };

  const stats = await runReputationForFinalization({
    supabase,
    race: stageRace("TourFrance", 21),
    resultRows: [
      { rider_id: "r1", stage_number: 4, result_type: "stage", rank: 1 },
      { rider_id: "r1", stage_number: 5, result_type: "stage", rank: 1 },
    ],
    stageNumbers: [5],
    seasonNumber: 3,
    stage: "shadow",
  });
  assert.equal(stats.events, 1);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].dedupe_key, "rider:r1:race:race-gt:stage:5:stage_win");
  assert.equal(stats.ridersUpdated, 1);
});
