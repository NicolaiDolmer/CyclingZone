// backend/lib/engine/v4/fixtures.test.ts
// Race Engine v4 F2 (#4030), Fase C: golden fixture-tests.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §7
// ("Golden fixtures: 4 committede syntetiske scenarier ... input + forventet
// fuldt output som JSON; bit-identitet ved samme seed").
//
// Hvert scenarie i fixtures/<navn>/ har input.json (haandbygget StageInput)
// + expected.json (det FULDE StageOutput, genereret af
// backend/scripts/dev/generateEngineV4Fixtures.mjs og INSPICERET for at
// matche scenariets hensigt foer det blev frosset — se generator-scriptets
// kalibrerings-kommentarer for hvert scenaries afvejninger/fund).
//
// JSON laeses via node:fs (ikke `import ... with { type: "json" }`) fordi
// tsconfig.engine.json's `resolveJsonModule: false` (designdoc §1's
// erasable-syntax-krav) ikke tillader JSON-modul-imports i typecheck'et.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { simulateStageV4 } from "./index.ts";
import { validateGroupMembership } from "./timeline.ts";
import { isWinType } from "./winType.ts";
import type { StageInput, StageOutput } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");

function loadFixture(name: string): { input: StageInput; expected: StageOutput } {
  const dir = path.join(fixturesDir, name);
  const input = JSON.parse(readFileSync(path.join(dir, "input.json"), "utf8")) as StageInput;
  const expected = JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8")) as StageOutput;
  return { input, expected };
}

function winner(output: StageOutput) {
  const w = output.results.find((r) => r.rank === 1);
  assert.ok(w, "output skal have en rytter med rank 1");
  return w!;
}

function eventTypesOf(output: StageOutput): string[] {
  return output.timeline.events.map((e) => e.type);
}

// ── Scenarie 1: flat-massespurt ─────────────────────────────────────────────
// Flad rute, felt samlet (ingen climb/descent => M2/M3 kan ikke splitte
// feltet), sprinter (r01) vinder via M4's bunch_sprint-demandvektor.
test("golden fixture: flat-massespurt — bit-identitet + sprinter vinder samlet felt", () => {
  const { input, expected } = loadFixture("flat-massespurt");
  const actual = simulateStageV4(input);
  assert.deepEqual(actual, expected, "simulateStageV4(input) skal matche det frosne expected.json bit-for-bit");

  assert.equal(winner(actual).rider_id, "r01", "den staerkeste sprinter (r01) skal vinde");
  const splitEvents = eventTypesOf(actual).filter((t) => t === "peloton_splits");
  assert.equal(splitEvents.length, 0, "feltet maa ikke splitte foer maalstregen paa en flad rute (felt samlet)");
});

// ── Scenarie 2: bjerg-selektion ─────────────────────────────────────────────
// Lang stigning, felt splittes via M2, den staerkeste klatrer (r01) vinder
// med reelle (store) tidsgab til resten af feltet.
test("golden fixture: bjerg-selektion — bit-identitet + klatrer vinder med reelle gaps", () => {
  const { input, expected } = loadFixture("bjerg-selektion");
  const actual = simulateStageV4(input);
  assert.deepEqual(actual, expected, "simulateStageV4(input) skal matche det frosne expected.json bit-for-bit");

  assert.equal(winner(actual).rider_id, "r01", "den staerkeste klatrer (r01) skal vinde bjergetapen");
  const splitEvents = eventTypesOf(actual).filter((t) => t === "peloton_splits");
  assert.ok(splitEvents.length >= 1, "stigningen skal splitte feltet (mindst ét peloton_splits-event)");
  const lastPlaceTime = actual.results[actual.results.length - 1].time_seconds;
  assert.ok(lastPlaceTime - winner(actual).time_seconds > 300, "der skal vaere et reelt (>5 min) gab til sidstepladsen");
});

// ── Scenarie 3: punch-finale-forspring (#3965) ──────────────────────────────
// Descent-attack skaber et solo-forspring; rytteren (r01) der baerer
// forspringet OG stadig har W'-reserve vinder, selvom feltet jagter i den
// afsluttende punch-stigning.
test("golden fixture: punch-finale-forspring — bit-identitet + forspring m. W'-reserve vinder (#3965)", () => {
  const { input, expected } = loadFixture("punch-finale-forspring");
  const actual = simulateStageV4(input);
  assert.deepEqual(actual, expected, "simulateStageV4(input) skal matche det frosne expected.json bit-for-bit");

  assert.equal(winner(actual).rider_id, "r01", "rytteren med forspringet over sidste top (r01) skal vinde");
  const winnerLoad = actual.loads.find((l) => l.rider_id === "r01");
  assert.ok(winnerLoad, "r01 skal have et loads-indslag");
  assert.equal(winnerLoad!.wprime_depleted_j_norm, 0, "vinderen skal krydse maalstregen med W'-reserve i behold (#3965)");
});

// ── Scenarie 4: nedkoerselsfinale ───────────────────────────────────────────
// Teknisk nedkoersel (T3), stor descending-forskel — descent attack (M3)
// afgoer finalen (r01, staerkeste nedkoersere, vinder).
test("golden fixture: nedkoerselsfinale — bit-identitet + descent attack afgoer", () => {
  const { input, expected } = loadFixture("nedkoerselsfinale");
  const actual = simulateStageV4(input);
  assert.deepEqual(actual, expected, "simulateStageV4(input) skal matche det frosne expected.json bit-for-bit");

  assert.equal(winner(actual).rider_id, "r01", "den staerkeste nedkoersere (r01) skal vinde");
  const descentAttacks = actual.timeline.events.filter(
    (e) => e.type === "finale_attack" && (e.params as { direction?: string }).direction === "descent",
  );
  assert.ok(descentAttacks.length >= 1, "der skal vaere mindst ét descent-angreb (direction: descent) i tidslinjen");
});

// ── Tvaergaaende: tidslinje og snapshots skal fortaelle samme historie (#4971) ─
// CodeRabbit fandt uenigheden i bjerg-selektion (km 65: `peloton_splits` til
// `chase-1000`, snapshot i `peloton-0`). Guarden koeres paa ALLE fire fixtures,
// fordi flat/punch/nedkoersel har hver sit merge-moenster — og fordi et frosset
// expected.json ellers kan cementere netop den slags selvmodsigelse igen.
for (const name of ["flat-massespurt", "bjerg-selektion", "punch-finale-forspring", "nedkoerselsfinale"]) {
  test(`golden fixture: ${name} — hvert gruppeskift i tidslinjen staar i naeste snapshot (#4971)`, () => {
    const { input, expected } = loadFixture(name);
    for (const [label, output] of [["frosset expected.json", expected], ["frisk koersel", simulateStageV4(input)]] as const) {
      const violations = validateGroupMembership(output.timeline.events, output.groupSnapshots);
      assert.deepEqual(violations, [], `${label}: ${violations.map((v) => v.message).join("; ")}`);
    }
  });
}

// ── Sejrstypen (#5577, spec M2) ─────────────────────────────────────────────
// Foer stod "group_finish" paa hver massestart, og finalen udsendte
// `sprint_decided` for enhver vinder. Forventningen pr. scenarie er det
// scenariet beskriver: samlet felt paa fladt = massespurt, klatrer der slipper
// én medrytter = taet finish, forspring baaret alene hjem = solo, nedkoersels-
// finale afgjort i en gruppe = taet finish, enkeltstart = sin egen noegle.
const EXPECTED_WIN_TYPE: Record<string, string> = {
  "flat-massespurt": "sprint_win",
  "bjerg-selektion": "close_win",
  "punch-finale-forspring": "solo_win",
  nedkoerselsfinale: "close_win",
  "itt-solo": "itt_win",
};

function finishOf(output: StageOutput) {
  const finish = output.timeline.events.find((e) => e.type === "finish");
  assert.ok(finish, "tidslinjen skal have et finish-event");
  return finish!;
}

for (const [name, winType] of Object.entries(EXPECTED_WIN_TYPE)) {
  test(`golden fixture: ${name} — sejrstypen er ${winType}, en kendt noegle, og filmen siger kun spurt ved en spurt (#5577)`, () => {
    const { input, expected } = loadFixture(name);
    for (const [label, output] of [["frosset expected.json", expected], ["frisk koersel", simulateStageV4(input)]] as const) {
      const finishWinType = finishOf(output).params.win_type;
      assert.ok(isWinType(finishWinType), `${label}: win_type "${String(finishWinType)}" er ikke en kendt noegle`);
      assert.equal(finishWinType, winType, label);

      const sprintEvents = output.timeline.events.filter((e) => e.type === "sprint_decided");
      assert.equal(sprintEvents.length, winType === "sprint_win" ? 1 : 0, `${label}: sprint_decided kun ved en massespurt`);

      // Finalens afgoerelse og finish-eventet maa aldrig vaere uenige.
      const decisions = output.timeline.events.filter((e) => e.type !== "finish" && e.params.win_type !== undefined);
      for (const decision of decisions) assert.equal(decision.params.win_type, finishWinType, label);
    }
  });
}

test("golden fixtures: hvert scenarie har en forventet sejrstype (ingen fixture uden dom, #5577)", () => {
  assert.deepEqual(Object.keys(EXPECTED_WIN_TYPE).sort(), readdirSync(fixturesDir).sort());
});
