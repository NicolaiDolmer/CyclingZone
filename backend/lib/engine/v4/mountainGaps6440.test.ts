// backend/lib/engine/v4/mountainGaps6440.test.ts
// #6440 (ren motor-revision, gate trin 1+3): bjerg-tiderne under official_times_v3.
//
// To rodaarsager, begge rettet KUN under official_times_v3 (official_times_v2 og
// aeldre er byte-identiske, officialTimesV2Frozen6200.test.ts):
//
//  1. D3 (ejer 10/10) er geometri: "nedkoersel mod maal" er nedkoerslen efter
//     sidste stigning, fulgt af hoejst et kort stykke uden stigning. Motoren
//     kraevede ogsaa finale-maerkatet "descent", saa en bjergetape maerket fx
//     "punch" (generatoren lægger altid sidste top 5-20 km foer maal) koerte sin
//     sidste stigning i gruppe uden loft bagefter, og hele top 10 kom ind samlet.
//  2. #6199 A: stigningens hul maales mod den gruppe rytteren koerte i. Naar M5 i
//     samme segment flytter den gruppe frem (jagten henter dagens udbrud paa
//     slutstigningen), blev de afsatte staaende paa det gamle ur, og jagtens
//     lukning blev lagt oven i hullet for dem alle.
//
// Tal staar ikke her (hard rule 17); baandene laeses fra scorecardet/ankrene.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { __resetRaceEngineV4Cache, loadRaceEngineV4 } from "../../raceEngineV4Bridge.js";
import { gapAtRank, runStagesInOrder as runStagesInOrderJs, sortedStages, TOUR_BENCHMARKS, verdict } from "../../../scripts/dev/lib/tourScorecard.mjs";
import { median } from "../../../scripts/lib/headToHeadStats.js";
import { carrySplitsWithSourceAdvance, segmentSplitsFromEvents } from "./groups.ts";
import { isDescentFinishDecidingClimb } from "./mechanics/climbSelection.ts";
import {
  SHARED_TIME_MODEL_V2_TUNING,
  SHARED_TIME_MODEL_V3_TUNING,
  TIME_MODEL_V3_TUNING,
  finishDescentIndexFor,
  isDescentFinaleFor,
} from "./mechanics/timeModel.ts";
import type { RaceGroup, RouteV2, Segment, StageOutput, TimelineEvent } from "./types.ts";

const runStagesInOrder = runStagesInOrderJs as unknown as (opts: Record<string, unknown>) => unknown;

// ── 1. D3: geometrien afgoer paa bjerg og hoejfjeld ──────────────────────────

const climb = (from: number, to: number): Segment => ({ kind: "climb", from_km: from, to_km: to, category: "HC", avg_gradient: 8, top_elevation_m: 2000 } as Segment);
const descent = (from: number, to: number): Segment => ({ kind: "descent", from_km: from, to_km: to, technicality: 2 } as Segment);
const rolling = (from: number, to: number): Segment => ({ kind: "rolling", from_km: from, to_km: to } as Segment);
const route = (segments: Segment[], profile_type: RouteV2["profile_type"], finale_type: RouteV2["finale_type"]): RouteV2 =>
  ({ distance_km: segments[segments.length - 1].to_km, profile_type, finale_type, segments, weather: { kind: "sun", wind_exposure: 0 }, waypoints: [] } as RouteV2);

test("#6440 D3: under v3 is a mountain stage's descent before a short run-in the finish descent, whatever the finale label", () => {
  const v3 = SHARED_TIME_MODEL_V3_TUNING;
  const runIn = v3.finishDescentMaxRunInKm;
  const segs = [rolling(0, 100), climb(100, 110), descent(110, 120), rolling(120, 120 + runIn)];
  for (const profile of ["mountain", "high_mountain"] as const) {
    for (const finale of ["punch", "breakaway", "descent"] as const) {
      const r = route(segs, profile, finale);
      assert.equal(isDescentFinaleFor(r, v3), true, `${profile}/${finale}`);
      assert.equal(finishDescentIndexFor(r, v3), 2, `${profile}/${finale}`);
      assert.equal(isDescentFinishDecidingClimb({ route: r, segmentIndex: 1 }, v3), true, `${profile}/${finale}: the last climb decides`);
    }
  }
  // A long run-in is still a valley, not the finish descent (D3's own limit).
  assert.equal(finishDescentIndexFor(route([rolling(0, 100), climb(100, 110), descent(110, 120), rolling(120, 121 + runIn)], "mountain", "punch"), v3), -1);
  // Hilly and rolling keep the label rule.
  assert.equal(finishDescentIndexFor(route(segs, "hilly", "punch"), v3), -1);
  assert.equal(isDescentFinishDecidingClimb({ route: route(segs, "hilly", "punch"), segmentIndex: 1 }, v3), false);
});

test("#6440 D3: every older time model keeps the label rule (byte-identical)", () => {
  const segs = [rolling(0, 100), climb(100, 110), descent(110, 120), rolling(120, 123)];
  for (const t of [TIME_MODEL_V3_TUNING, SHARED_TIME_MODEL_V2_TUNING]) {
    assert.deepEqual(t.finishDescentAnyFinaleProfiles, []);
    assert.equal(isDescentFinaleFor(route(segs, "mountain", "punch"), t), false);
    assert.equal(finishDescentIndexFor(route(segs, "mountain", "punch"), t), -1);
  }
  assert.equal(isDescentFinaleFor(route(segs, "mountain", "descent"), SHARED_TIME_MODEL_V2_TUNING), true);
});

// ── 2. De afsatte foelger kilde-gruppen gennem M5 ────────────────────────────

const g = (id: string, gap: number, extra: Partial<RaceGroup> = {}): RaceGroup => ({ id, kind: "chase", rider_ids: [id], gap_seconds: gap, cohesion: 1, ...extra });

test("#6440: a group dropped on the climb keeps its gap to the source group when M5 advances the source", () => {
  const before = [g("break", 0, { kind: "breakaway", origin: "breakaway" }), g("pel", 70, { kind: "peloton" }), g("solo", 120), g("tail", 200)];
  const after = [g("break", 0, { kind: "breakaway", origin: "breakaway" }), g("pel", 0, { kind: "peloton" }), g("solo", 120), g("tail", 200)];
  const splits = [{ sourceGroupId: "pel", groupId: "solo" }, { sourceGroupId: "pel", groupId: "tail" }];
  const out = carrySplitsWithSourceAdvance({ before, beforeFrontSeconds: 1000, after, afterFrontSeconds: 1000, splits });
  assert.equal(out.find((x) => x.id === "solo")?.gap_seconds, 50);
  assert.equal(out.find((x) => x.id === "tail")?.gap_seconds, 130);
  // Measured absolutely: a new front (other front time) is not an advance.
  const shifted = after.map((x) => ({ ...x, gap_seconds: x.gap_seconds + 10 }));
  const same = carrySplitsWithSourceAdvance({ before: after, beforeFrontSeconds: 1000, after: shifted, afterFrontSeconds: 990, splits });
  assert.equal(same, shifted, "no advance, same array");
});

test("#6440: the carry never puts a dropped group ahead of its source, and leaves M5's own moves and the breakaway alone", () => {
  const before = [g("pel", 30, { kind: "peloton" }), g("solo", 35), g("moved", 60), g("piece", 40, { origin: "breakaway" })];
  const after = [g("pel", 0, { kind: "peloton" }), g("solo", 35), g("moved", 20), g("piece", 40, { origin: "breakaway" })];
  const out = carrySplitsWithSourceAdvance({
    before, beforeFrontSeconds: 500, after, afterFrontSeconds: 500,
    splits: [{ sourceGroupId: "pel", groupId: "solo" }, { sourceGroupId: "pel", groupId: "moved" }, { sourceGroupId: "piece", groupId: "pel" }],
  });
  assert.equal(out.find((x) => x.id === "solo")?.gap_seconds, 5, "follows the 30 s advance");
  assert.equal(out.find((x) => x.id === "moved")?.gap_seconds, 20, "M5 moved it itself");
  assert.ok((out.find((x) => x.id === "solo")?.gap_seconds ?? -1) >= (out.find((x) => x.id === "pel")?.gap_seconds ?? 0));
  assert.equal(carrySplitsWithSourceAdvance({ before, beforeFrontSeconds: 500, after, afterFrontSeconds: 500, splits: [] }), after);
});

test("#6440: the climb hook's splits are read from its peloton_splits events", () => {
  const events = [
    { km: 10, type: "peloton_splits", params: { group_id: "chase-1", source_group_id: "peloton-0", rider_ids: ["a"], cause: "climb_deficit", gap_seconds: 12 } },
    { km: 10, type: "gap_update", params: { group_id: "x", gap_seconds: 3 } },
  ] as TimelineEvent[];
  assert.deepEqual(segmentSplitsFromEvents(events), [{ sourceGroupId: "peloton-0", groupId: "chase-1" }]);
});

// ── 3. Giro-feltet under official_times_v3 (fejlede foer #6440) ───────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const GIRO = path.join(here, "..", "..", "..", "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const SEEDS = 12;
// Giro-fixturen: etape 8 er hoejfjeld med sidste top kort foer maal (maerket punch),
// etape 12 en lang slutstigning paa en bjergetape.
const PUNCH_LABELLED_DESCENT_STAGE = 8;
const LONG_CLIMB_STAGE = 12;

type StageRun = { profile: { stage_number: number }; res: { v4Output: StageOutput } };

async function giroUnderV3(lastStage: number, onStage: (run: StageRun, seed: number) => void): Promise<void> {
  const data = JSON.parse(readFileSync(GIRO, "utf8"));
  __resetRaceEngineV4Cache();
  const v4 = await loadRaceEngineV4();
  const stages = sortedStages(data).filter((p: { stage_number: number }) => p.stage_number <= lastStage);
  for (let seed = 1; seed <= SEEDS; seed++) {
    runStagesInOrder({ v4, data, revision: "official_times_v3", seedTag: `tour6285-${seed}`, stages, onStage: (run: StageRun) => onStage(run, seed) });
  }
}

/**
 * Riders dropped on the final climb finish at most their own climb gap behind
 * the riders who stayed in that group (M5's chase closure is not added on top).
 */
function droppedBeyondOwnGap(out: StageOutput): number {
  const lastSnapshotBefore = out.groupSnapshots[out.groupSnapshots.length - 2];
  const finalKm = out.groupSnapshots[out.groupSnapshots.length - 1]?.km;
  if (!lastSnapshotBefore || finalKm === undefined) return 0;
  const time = new Map(out.results.filter((r) => r.status === "finished").map((r) => [r.rider_id, r.time_seconds]));
  const crashed = new Set((out.incidents ?? []).map((i) => i.rider_id));
  const splits = out.timeline.events.filter((e) => e.type === "peloton_splits" && e.km === finalKm);
  // Dagens udbrud (og stykker af det): M5 ejer det hul, og det roeres ikke af #6440.
  // Kun favoritternes gruppe: den gruppe etapens vinder sad i ved slutstigningens fod.
  const winner = out.results.find((r) => r.rank === 1)?.rider_id;
  let violations = 0;
  for (const source of lastSnapshotBefore.groups) {
    const fromSource = splits.filter((e) => e.params.source_group_id === source.group_id);
    if (fromSource.length === 0 || winner === undefined || !source.rider_ids.includes(winner)) continue;
    const dropped = new Set(fromSource.flatMap((e) => e.params.rider_ids as string[]));
    const stayTimes = source.rider_ids.filter((id) => !dropped.has(id) && time.has(id)).map((id) => time.get(id) as number);
    if (stayTimes.length === 0) continue;
    const reference = Math.min(...stayTimes);
    for (const e of fromSource) {
      for (const id of e.params.rider_ids as string[]) {
        const t = time.get(id);
        if (t === undefined || crashed.has(id)) continue;
        if (t - reference > (e.params.gap_seconds as number) + 1) violations++;
      }
    }
  }
  return violations;
}

test("#6440: under official_times_v3 a dropped favourite never also loses the chase's closure on the final climb (Giro, 12 seeds)", async () => {
  let violations = 0;
  let measured = 0;
  await giroUnderV3(LONG_CLIMB_STAGE, ({ profile, res }) => {
    if (profile.stage_number !== LONG_CLIMB_STAGE) return;
    measured++;
    violations += droppedBeyondOwnGap(res.v4Output);
  });
  assert.equal(measured, SEEDS);
  assert.equal(violations, 0, "riders dropped on the final climb lost more than their own climb gap");
});

test("#6440: nr. 10 on the punch-labelled high-mountain descent finish and the long final climb is inside the mountain band (Giro, 12 seeds)", async () => {
  const gaps = new Map<number, number[]>([[PUNCH_LABELLED_DESCENT_STAGE, []], [LONG_CLIMB_STAGE, []]]);
  await giroUnderV3(LONG_CLIMB_STAGE, ({ profile, res }) => {
    const list = gaps.get(profile.stage_number);
    const g10 = gapAtRank(res.v4Output, 10);
    if (list && g10 !== null) list.push(g10);
  });
  const band = TOUR_BENCHMARKS.gapTo10.byClass.mountain;
  for (const [stage, list] of gaps) {
    assert.equal(list.length, SEEDS, `stage ${stage}`);
    assert.equal(verdict(median(list), band), "PASS", `stage ${stage}: median nr. 10 outside the owner's mountain band`);
  }
});
