// backend/lib/engine/v4/segmentLoop.groupOrigin.test.ts
// #5578 (M3): gruppe-oprindelsen gennem den FULDE motor. Enhedsreglerne
// (split arver, merge med feltet = indhentet, klassifikationen) er testet i
// groups.test.ts; her testes at M5 og M3 saetter oprindelsen i det rigtige
// segment-loop, at den bevares gennem split/merge, og at StageOutput er
// byte-uaendret (de frosne golden fixtures).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { LIVE_MECHANIC_HOOKS, simulateStageV4, simulateStageV4WithTrace } from "./index.ts";
import { runSegmentLoop } from "./segmentLoop.ts";
import type { RaceGroup, StageInput, StageOutput } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROAD_FIXTURES = ["bjerg-selektion", "flat-massespurt", "nedkoerselsfinale", "punch-finale-forspring"];

function loadFixture(name: string): { input: StageInput; expected: StageOutput } {
  const dir = path.join(here, "fixtures", name);
  return {
    input: JSON.parse(readFileSync(path.join(dir, "input.json"), "utf8")) as StageInput,
    expected: JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8")) as StageOutput,
  };
}

function formedEscapeRiderIds(output: StageOutput): Set<string> {
  const ids = new Set<string>();
  for (const event of output.timeline.events) {
    if (event.type !== "breakaway_formed") continue;
    for (const id of (event.params.rider_ids as string[]) ?? []) ids.add(id);
  }
  return ids;
}

function allTraceGroups(input: StageInput): RaceGroup[] {
  const { finaleTrace } = runSegmentLoop(input, LIVE_MECHANIC_HOOKS);
  assert.ok(finaleTrace, "en vejetape med segmenter har altid et finale-billede");
  return [...finaleTrace.entryGroups, ...finaleTrace.preFinaleGroups, ...finaleTrace.postFinaleGroups];
}

test("#5578: simulateStageV4WithTrace aendrer ikke StageOutput (golden fixtures bit-for-bit)", () => {
  for (const name of ROAD_FIXTURES) {
    const { input, expected } = loadFixture(name);
    const { output, trace } = simulateStageV4WithTrace(input);
    assert.deepEqual(output, expected, `${name}: output skal matche det frosne expected.json`);
    assert.deepEqual(output, simulateStageV4(input), `${name}: samme output som simulateStageV4`);
    assert.equal(typeof trace.breakaway_win, "boolean", `${name}: en vejetape har en udbrudsdom`);
  }
});

test("#5578: en gruppe med udbrudsoprindelse rummer kun ryttere fra dagens udbrud (bevaret gennem split/merge)", () => {
  for (const name of ROAD_FIXTURES) {
    const { input } = loadFixture(name);
    const escapeIds = formedEscapeRiderIds(simulateStageV4(input));
    for (const group of allTraceGroups(input)) {
      if (group.origin !== "breakaway") continue;
      for (const id of group.rider_ids) {
        assert.ok(escapeIds.has(id), `${name}: ${id} i ${group.id} har udbrudsoprindelse uden at vaere i udbruddet`);
      }
    }
  }
});

test("#5578: en udbrudssejr er altid vundet af en rytter fra dagens udbrud", () => {
  for (const name of ROAD_FIXTURES) {
    const { input } = loadFixture(name);
    const { output, trace } = simulateStageV4WithTrace(input);
    if (!trace.breakaway_win) continue;
    assert.ok(formedEscapeRiderIds(output).has(output.results[0].rider_id), `${name}: vinderen var ikke i udbruddet`);
  }
});

test("#5578: et nedkoerselsangreb ud af feltet faar oprindelsen descent, ogsaa naar arten er breakaway", () => {
  // Nedkoerslen ER finalen (samme variant som segmentLoop.descentFinale.test.ts):
  // angrebet sker paa finale-segmentet og er med i billedet foer finalen.
  const { input: base } = loadFixture("nedkoerselsfinale");
  const input: StageInput = {
    ...base,
    route: { ...base.route, distance_km: 68, segments: base.route.segments.filter((s) => s.to_km <= 68) },
  };
  const { finaleTrace } = runSegmentLoop(input, LIVE_MECHANIC_HOOKS);
  assert.ok(finaleTrace);
  const descentGroups = finaleTrace.preFinaleGroups.filter((g) => g.origin === "descent");
  assert.ok(descentGroups.length > 0, "scenariet skal give et nedkoerselsangreb ud af feltet");
  for (const group of descentGroups) {
    assert.ok(group.kind === "breakaway" || group.kind === "solo", `uventet art ${group.kind}`);
  }
  // Dagens udbrud i samme etape beholder sin egen oprindelse.
  assert.ok(finaleTrace.preFinaleGroups.some((g) => g.origin === "breakaway"));
});

test("#5578: tidskoersler har ingen udbrudsdom (null), ikke et falsk nej", () => {
  const { input } = loadFixture("itt-solo");
  assert.equal(simulateStageV4WithTrace(input).trace.breakaway_win, null);
});
