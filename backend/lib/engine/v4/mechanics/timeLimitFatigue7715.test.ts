// backend/lib/engine/v4/mechanics/timeLimitFatigue7715.test.ts
// #7715 (ejer 5/11): meget traette ryttere paa en etape der passer dem daarligt. Reglen er
// aegte aarsag uden rng. Testene bruger tal der kun beskriver retning; kalibreringen er privat.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { StageResult } from "../types.ts";
import { TIME_LIMIT_FATIGUE_7715_TUNING } from "../tuning.ts";
import {
  applyTimeLimit,
  fatigueLimitSecondsFor,
  OTL_STATUS,
  timeLimitFatigue7715On,
  timeLimitFatigueSeverity7715,
  timeLimitSecondsFor,
} from "./timeLimit.ts";

const T = TIME_LIMIT_FATIGUE_7715_TUNING;
const TIRED = T.tiredFull;
const BAD_FIT = { stageFit: 20, ownLevel: 100 };

function row(rider_id: string, rank: number, time_seconds: number): StageResult {
  return { rider_id, rank, time_seconds, group_id: "g", status: "finished", injury_days: null };
}

const WINNER = 10_000;
const LIMIT = timeLimitSecondsFor(WINNER, "mountain");
const MARGIN = LIMIT - WINNER;

test("alvor: kraever baade meget traet og daarligt match paa en haard etape", () => {
  assert.ok(timeLimitFatigueSeverity7715({ fatigue: TIRED, ...BAD_FIT, profileType: "mountain" }) > 0);
  assert.equal(timeLimitFatigueSeverity7715({ fatigue: T.tiredFrom - 1, ...BAD_FIT, profileType: "mountain" }), 0, "ikke traet nok");
  assert.equal(timeLimitFatigueSeverity7715({ fatigue: TIRED, stageFit: 100, ownLevel: 100, profileType: "mountain" }), 0, "etapen passer ham");
  for (const profileType of ["flat", "rolling", "hilly", "itt", "itt_hilly", "ttt"] as const) {
    assert.equal(timeLimitFatigueSeverity7715({ fatigue: TIRED, ...BAD_FIT, profileType }), 0, profileType);
  }
});

test("alvor: maales mod rytterens eget niveau, saa samme forhold giver samme svar i alle divisioner", () => {
  const top = timeLimitFatigueSeverity7715({ fatigue: TIRED, stageFit: 40, ownLevel: 80, profileType: "mountain" });
  const low = timeLimitFatigueSeverity7715({ fatigue: TIRED, stageFit: 4, ownLevel: 8, profileType: "mountain" });
  assert.equal(top, low);
});

test("alvor: manglende tal giver 0, aldrig et gaet", () => {
  assert.equal(timeLimitFatigueSeverity7715({ fatigue: null, ...BAD_FIT, profileType: "mountain" }), 0);
  assert.equal(timeLimitFatigueSeverity7715({ fatigue: TIRED, stageFit: null, ownLevel: 100, profileType: "mountain" }), 0);
  assert.equal(timeLimitFatigueSeverity7715({ fatigue: TIRED, stageFit: 20, ownLevel: 0, profileType: "mountain" }), 0);
  assert.equal(timeLimitFatigueSeverity7715({ fatigue: TIRED, ...BAD_FIT, profileType: null }), 0);
});

test("alvor: mere traet eller daarligere match goer det aldrig mildere", () => {
  let last = 0;
  for (let fatigue = T.tiredFrom; fatigue <= 100; fatigue += 1) {
    const s = timeLimitFatigueSeverity7715({ fatigue, ...BAD_FIT, profileType: "mountain" });
    assert.ok(s >= last);
    last = s;
  }
  last = 0;
  for (let stageFit = 80; stageFit >= 0; stageFit -= 1) {
    const s = timeLimitFatigueSeverity7715({ fatigue: TIRED, stageFit, ownLevel: 100, profileType: "mountain" });
    assert.ok(s >= last);
    last = s;
  }
});

test("egen graense: strengere end den almindelige, aldrig foer vindertiden", () => {
  const own = fatigueLimitSecondsFor(WINNER, LIMIT, 1);
  assert.ok(own < LIMIT && own > WINNER);
  assert.ok(fatigueLimitSecondsFor(WINNER, LIMIT, 0.5) > own, "mindre alvor giver mere tid");
  assert.equal(fatigueLimitSecondsFor(WINNER, LIMIT, 0), LIMIT);
});

test("kontakten: kun s5_profiles_v3 og kun med et kort fra broen", () => {
  assert.equal(timeLimitFatigue7715On({ rules_revision: "s5_profiles_v3", time_limit_fatigue_7715: {} }), true);
  assert.equal(timeLimitFatigue7715On({ rules_revision: "s5_profiles_v3" }), false);
  assert.equal(timeLimitFatigue7715On({ rules_revision: "s5_profiles_v3", time_limit_fatigue_7715: null }), false);
  assert.equal(timeLimitFatigue7715On({ rules_revision: "s5_profiles_v2", time_limit_fatigue_7715: {} }), false);
});

const justBehind = WINNER + MARGIN * 0.9; // inden for den almindelige graense, uden for den stramme

test("en rytter med risikoen ryger ud foer den almindelige graense, andre med samme tid er i maal", () => {
  const results = [row("win", 1, WINNER), row("frisk", 2, justBehind), row("traet", 3, justBehind)];
  const out = applyTimeLimit({ results, profileType: "mountain", distanceKm: 100, fatigueSeverityByRider: { traet: 1 } });
  assert.deepEqual(out.otlRiderIds, ["traet"]);
  assert.deepEqual(out.fatigueRiderIds, ["traet"]);
  assert.equal(out.results.find((r) => r.rider_id === "frisk")?.status, "finished");
  assert.equal(out.results.find((r) => r.rider_id === "traet")?.status, OTL_STATUS);
  assert.deepEqual(out.events[0].params, { rider_ids: ["traet"], rider_count: 1, fatigue_rider_ids: ["traet"] });
});

test("rytter med risikoen i god tid sker der intet med", () => {
  const results = [row("win", 1, WINNER), row("traet", 2, WINNER + MARGIN * 0.1)];
  const out = applyTimeLimit({ results, profileType: "mountain", distanceKm: 100, fatigueSeverityByRider: { traet: 1 } });
  assert.deepEqual(out.otlRiderIds, []);
  assert.deepEqual(out.events, []);
});

test("vinderen kan aldrig ramme reglen", () => {
  const results = [row("win", 1, WINNER)];
  const out = applyTimeLimit({ results, profileType: "mountain", distanceKm: 100, fatigueSeverityByRider: { win: 1 } });
  assert.deepEqual(out.otlRiderIds, []);
});

test("grupettoen baerer ikke en rytter med risikoen, resten reddes stadig", () => {
  const late = LIMIT + 60;
  const field = [row("win", 1, WINNER), ...Array.from({ length: 9 }, (_, i) => row(`g${i}`, i + 2, late))];
  const results = [...field, ...Array.from({ length: 0 }, () => row("x", 0, 0))];
  const plain = applyTimeLimit({ results, profileType: "mountain", distanceKm: 100 });
  assert.equal(plain.rescuedRiderIds.length, 9, "scenariet skal have en reddet grupetto");
  const out = applyTimeLimit({ results, profileType: "mountain", distanceKm: 100, fatigueSeverityByRider: { g3: 1 } });
  assert.deepEqual(out.otlRiderIds, ["g3"]);
  assert.equal(out.rescuedRiderIds.length, 8);
  assert.equal(out.results.find((r) => r.rider_id === "g3")?.reinstated_by, undefined);
  assert.equal(out.results.find((r) => r.rider_id === "g4")?.reinstated_by, "grupetto");
});

test("den almindelige OTL-rytter med risikoen faar traetheden som aarsag, en uden risikoen ikke", () => {
  const results = [row("win", 1, WINNER), row("traet", 2, LIMIT + 500), row("frisk", 3, LIMIT + 900)];
  const out = applyTimeLimit({ results, profileType: "mountain", distanceKm: 100, fatigueSeverityByRider: { traet: 1 } });
  assert.deepEqual(out.otlRiderIds, ["traet", "frisk"]);
  assert.deepEqual(out.fatigueRiderIds, ["traet"]);
});

test("spillerens udvej: grupetto og spar kraefter er under den almindelige regel", () => {
  const results = [row("win", 1, WINNER), row("a", 2, justBehind), row("b", 3, justBehind), row("c", 4, justBehind)];
  const out = applyTimeLimit({
    results, profileType: "mountain", distanceKm: 100,
    fatigueSeverityByRider: { a: 1, b: 1, c: 1 },
    jury: { incidents: [], effortByRider: { a: "grupetto", b: "save", c: "normal" } },
  });
  assert.deepEqual(out.otlRiderIds, ["c"]);
});

test("udvejen gaelder hele dagen: et skift til grupetto paa sidste led redder ham ikke", () => {
  const results = [row("win", 1, WINNER), row("skift", 2, justBehind), row("helt", 3, justBehind)];
  const out = applyTimeLimit({
    results, profileType: "mountain", distanceKm: 100,
    fatigueSeverityByRider: { skift: 1, helt: 1 },
    fatigueEffortByRider: { skift: "normal", helt: "grupetto" },
    jury: { incidents: [], effortByRider: { skift: "grupetto", helt: "grupetto" } },
  });
  assert.deepEqual(out.otlRiderIds, ["skift"]);
});

test("et uheld taeller ikke: rytteren doemmes paa sin tid minus uheldet", () => {
  const results = [row("win", 1, WINNER), row("styrtet", 2, justBehind), row("traet", 3, justBehind)];
  const out = applyTimeLimit({
    results, profileType: "mountain", distanceKm: 100,
    fatigueSeverityByRider: { styrtet: 1, traet: 1 },
    jury: { incidents: [{ rider_id: "styrtet", outcome: "time_loss", time_loss_seconds: MARGIN * 0.8 }] },
  });
  assert.deepEqual(out.otlRiderIds, ["traet"]);
});

test("juryens genindsatte roeres ikke", () => {
  const results = [row("win", 1, WINNER), row("offer", 2, LIMIT + 30)];
  const out = applyTimeLimit({
    results, profileType: "mountain", distanceKm: 100,
    fatigueSeverityByRider: { offer: 1 },
    jury: { incidents: [{ rider_id: "offer", outcome: "time_loss", time_loss_seconds: 60 }] },
  });
  assert.deepEqual(out.juryReinstatedRiderIds, ["offer"]);
  assert.deepEqual(out.otlRiderIds, []);
});

test("kun status aendres: rank, tid og raekkefoelge er uroert, og samme input giver samme svar", () => {
  const results = [row("win", 1, WINNER), row("traet", 2, justBehind), row("frisk", 3, justBehind + 1)];
  const args = { results, profileType: "mountain" as const, distanceKm: 100, fatigueSeverityByRider: { traet: 1 } };
  const out = applyTimeLimit(args);
  assert.deepEqual(out.results.map((r) => [r.rider_id, r.rank, r.time_seconds]), results.map((r) => [r.rider_id, r.rank, r.time_seconds]));
  assert.deepEqual(applyTimeLimit(args), out);
});

test("uden kort er outcome som foer, ogsaa formen", () => {
  const results = [row("win", 1, WINNER), row("traet", 2, justBehind)];
  const out = applyTimeLimit({ results, profileType: "mountain", distanceKm: 100 });
  assert.equal("fatigueRiderIds" in out, false);
  const noOne = applyTimeLimit({ results, profileType: "mountain", distanceKm: 100, fatigueSeverityByRider: {} });
  assert.deepEqual(noOne.otlRiderIds, []);
});

test("ingen tal i eventet", () => {
  const results = [row("win", 1, WINNER), row("traet", 2, justBehind)];
  const out = applyTimeLimit({ results, profileType: "mountain", distanceKm: 100, fatigueSeverityByRider: { traet: 0.8 } });
  assert.deepEqual(Object.keys(out.events[0].params ?? {}).sort(), ["fatigue_rider_ids", "rider_count", "rider_ids"]);
});
