// backend/lib/calendarScorecardReport.test.js
// #4270: laaser de kontrakter apply-gaten i buildSeasonCalendar.js hviler paa.
// Selve MAALINGERNE er allerede daekket ende-til-ende af calendarScorecardGate.test.js
// (som koerer scriptet mod fixture-kataloget) — her testes grupperingen og datomatematikken,
// som er dét der afgoer HVAD der blokerer en apply og HVAD der kraever et override-flag.

import test from "node:test";
import assert from "node:assert/strict";

import { addCalendarDays, scorecardGateGroups } from "./calendarScorecardReport.js";
import { quotasForRaceDays } from "../scripts/buildSeasonCalendar.js";
import { TIER_DENSITY } from "./tierCalendarMaterializer.js";

function rapportMed({ dækning = [], finale = [], uniform = [], sæsonFinale = [] } = {}) {
  return {
    dækning: { ok: dækning.length === 0, violations: dækning },
    sæsonFinaleViol: sæsonFinale,
    tiers: [{ tier: 1, finaleViol: finale, uniformViol: uniform }],
  };
}

test("#4270: §2's 'løb hver kalenderdag' er BLOKERENDE — den kan ikke overrides", () => {
  const g = scorecardGateGroups(rapportMed({ dækning: ["division 3 har 4 kalenderdag(e) uden løb"] }));
  assert.equal(g.blocking.length, 1);
  assert.match(g.blocking[0], /løb hver kalenderdag \(§2\)/);
  assert.deepEqual(g.finaleDrift, []);
  assert.deepEqual(g.uniformDrift, []);
});

test("#4270: §7b's finale-bånd er DRIFT, ikke blokerende — de har eget override-flag", () => {
  const g = scorecardGateGroups(rapportMed({ finale: ["tier 1: mountain slutter nedad 40 %"] }));
  assert.deepEqual(g.blocking, []);
  assert.equal(g.finaleDrift.length, 1);
  assert.match(g.finaleDrift[0], /finale-bånd \(§7b\)/);
});

test("#4270: §6b's uniforme mål er DRIFT med sit EGET flag, adskilt fra §7b", () => {
  const g = scorecardGateGroups(rapportMed({
    finale: ["tier 1: hilly slutter fladt 35 %"],
    uniform: ["tier 1: high_mountain 16,1 % mod mål 12,0 %"],
  }));
  assert.equal(g.finaleDrift.length, 1);
  assert.equal(g.uniformDrift.length, 1);
  assert.match(g.uniformDrift[0], /uniformt mål \(§6b\)/);
  // De to må ALDRIG blandes: et override af det ene må ikke tie det andet.
  assert.equal(g.finaleDrift.some((v) => v.includes("§6b")), false);
  assert.equal(g.uniformDrift.some((v) => v.includes("§7b")), false);
});

test("#4270: sæson-aggregatets finale-brud tælles med i finale-driften", () => {
  const g = scorecardGateGroups(rapportMed({ sæsonFinale: ["sæson: hilly slutter fladt 30,1 %"] }));
  assert.equal(g.finaleDrift.length, 1);
  assert.match(g.finaleDrift[0], /sæson-aggregat/);
});

test("#4270: en ren plan giver tre tomme grupper — gaten larmer ikke uden fund", () => {
  const g = scorecardGateGroups(rapportMed());
  assert.deepEqual(g, { blocking: [], finaleDrift: [], uniformDrift: [] });
});

test("#4270: kvoten er density × løbsdatoer (§1b), ikke den hardkodede 140/112/84/56", () => {
  // S3's egne tal (31 løbsdatoer) — dem regenSeason3Calendar.mjs faktisk byggede med.
  assert.deepEqual(quotasForRaceDays(31), { 1: 155, 2: 124, 3: 93, 4: 62 });
  // S4's 28-dages-vindue.
  assert.deepEqual(quotasForRaceDays(28), { 1: 140, 2: 112, 3: 84, 4: 56 });
  // Afledningen skal følge TIER_DENSITY, ikke en kopi af tallene.
  for (const [tier, density] of Object.entries(TIER_DENSITY)) {
    assert.equal(quotasForRaceDays(35)[Number(tier)], density * 35);
  }
});

test("#4270: datomatematikken holder over et månedsskifte", () => {
  assert.equal(addCalendarDays("2026-09-28", 27), "2026-10-25");
  assert.equal(addCalendarDays("2026-09-28", 34), "2026-11-01");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
});
