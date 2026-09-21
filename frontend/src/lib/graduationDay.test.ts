// Unit-tests for graduationDay.ts (#2491). Koerer med: node --test (i frontend/)
/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  coachVerdictKey, defaultChoice, groupGraduations, moveUpBlock,
  type Graduate,
} from "./graduationDay.ts";

function graduate(over: Partial<Graduate> = {}): Graduate {
  return {
    riderId: over.riderId ?? "r1",
    name: "Test Rider",
    age: 19,
    deadline: null,
    fromSquad: "junior",
    toSquad: "u23",
    targetSquadCount: 3,
    targetSquadMax: 12,
    salary: null,
    market_value: null,
    contract_end_season: null,
    primary_type: null,
    secondary_type: null,
    nationality_code: null,
    rider_derived_abilities: null,
    ...over,
  };
}

test("grupperer ÉT kort pr. overgang og respekterer raekkefoelgen junior -> u23 foer u23 -> senior", () => {
  const groups = groupGraduations([
    graduate({ riderId: "a", fromSquad: "u23", toSquad: "senior" }),
    graduate({ riderId: "b", fromSquad: "junior", toSquad: "u23" }),
    graduate({ riderId: "c", fromSquad: "junior", toSquad: "u23" }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.key), ["junior->u23", "u23->senior"]);
  assert.equal(groups[0].riders.length, 2);
  assert.equal(groups[1].riders.length, 1);
});

test("en raekke uden from_squad (fra foer #4619) forsvinder ikke, den faar sin egen gruppe", () => {
  const groups = groupGraduations([graduate({ fromSquad: null, toSquad: "senior" })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].fromSquad, null);
  assert.equal(groups[0].toSquad, "senior");
});

test("siden skaerer ingen overgang vaek: hver rytter fra serveren lander i praecis én gruppe", () => {
  const input = [
    graduate({ riderId: "a", fromSquad: "junior", toSquad: "u23" }),
    graduate({ riderId: "b", fromSquad: "u23", toSquad: "senior" }),
    graduate({ riderId: "c", fromSquad: null, toSquad: "senior" }),
  ];
  const ids = groupGraduations(input).flatMap((g) => g.riders.map((r) => r.riderId));
  assert.deepEqual([...ids].sort(), ["a", "b", "c"]);
});

test("moveUpBlock spejler serverens cap-gate: plads til én mere = ikke blokeret", () => {
  assert.equal(moveUpBlock(graduate({ targetSquadCount: 11, targetSquadMax: 12 })), null);
  assert.deepEqual(
    moveUpBlock(graduate({ targetSquadCount: 12, targetSquadMax: 12 })),
    { reason: "squad_full", count: 12, max: 12 },
  );
});

test("et ukendt loft blokerer ikke (vi gaetter aldrig en cap vi ikke fik)", () => {
  assert.equal(moveUpBlock(graduate({ targetSquadMax: null })), null);
  assert.equal(moveUpBlock(graduate({ targetSquadCount: null })), null);
});

test("defaulten er Move up, og Sell naar oprykningen er blokeret (mockup 3g)", () => {
  assert.equal(defaultChoice(graduate({ targetSquadCount: 3, targetSquadMax: 12 })), "promote");
  assert.equal(defaultChoice(graduate({ targetSquadCount: 12, targetSquadMax: 12 })), "sell");
});

test("fog-gate: uden baand siger traeneren intet om afstanden", () => {
  assert.equal(coachVerdictKey({ rating: 40, band: null }), "unknown");
});

test("fog-gate: et ufaerdigt scoutet baand giver den hedgede saetning, ikke en sammenligning", () => {
  assert.equal(
    coachVerdictKey({ rating: 30, band: { lo: 44, hi: 52 }, level: 1, maxLevel: 3 }),
    "unproven",
  );
});

test("med fuldt baand oversaettes afstanden til tre grader af traener-sprog", () => {
  const full = { level: 3, maxLevel: 3 };
  assert.equal(coachVerdictKey({ rating: 30, band: { lo: 44, hi: 52 }, ...full }), "climbing");
  assert.equal(coachVerdictKey({ rating: 44, band: { lo: 44, hi: 52 }, ...full }), "arriving");
  assert.equal(coachVerdictKey({ rating: 50, band: { lo: 44, hi: 52 }, ...full }), "settled");
});

test("en rytter uden rating faar 'unknown' frem for en opdigtet afstand", () => {
  assert.equal(
    coachVerdictKey({ rating: null, band: { lo: 44, hi: 52 }, level: 3, maxLevel: 3 }),
    "unknown",
  );
});
