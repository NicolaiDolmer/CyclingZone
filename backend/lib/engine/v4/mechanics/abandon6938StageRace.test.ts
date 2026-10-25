// backend/lib/engine/v4/mechanics/abandon6938StageRace.test.ts
// #6938 U4 (KUN s5_profiles_v3, slukket): en slidt og sat rytter uden kaptajnrolle
// stiger af i et etapeloeb (G17). Spec: docs/superpowers/specs/2026-10-23-6804-v3-tilvalg-design.md §2.2.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyStageRaceWithdrawals,
  isStageRaceContext,
  raceLengthFactor,
  STAGE_RACE_WITHDRAWAL_V3_TUNING as T,
  stageRaceWithdrawalProbability,
  wearOf,
} from "./abandon6938StageRace.ts";
import { simulateStageV4 } from "../index.ts";
import type { Entrant, GcContext, StageInput, StageResult } from "../types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): StageInput =>
  JSON.parse(readFileSync(path.join(HERE, "..", "fixtures", name, "input.json"), "utf8")) as StageInput;

const standings = (ids: string[], stage: number, remaining: number): GcContext =>
  ({
    status: "standings",
    stage_number: stage,
    leader_id: ids[0] ?? null,
    standings: ids.map((rider_id, i) => ({ rider_id, rank: i + 1, gap_seconds: i * 10 })),
    stages_remaining: remaining,
  }) as GcContext;

test("#6938 U4: risikoen er 0 op til graensen og stiger monotont i hul og slid, med loft", () => {
  assert.equal(stageRaceWithdrawalProbability(0, 1), 0);
  assert.equal(stageRaceWithdrawalProbability(T.minGapSeconds, 1), 0);
  assert.equal(stageRaceWithdrawalProbability(Number.NaN, 1), 0);
  let previous = 0;
  for (const gap of [T.minGapSeconds + 60, T.minGapSeconds + 300, T.fullGapSeconds]) {
    const p = stageRaceWithdrawalProbability(gap, 0.3);
    assert.ok(p > previous);
    previous = p;
  }
  assert.equal(stageRaceWithdrawalProbability(T.fullGapSeconds * 10, 0.3), stageRaceWithdrawalProbability(T.fullGapSeconds, 0.3));
  assert.ok(stageRaceWithdrawalProbability(T.fullGapSeconds, 0.8) > stageRaceWithdrawalProbability(T.fullGapSeconds, 0.1), "mere slid, mere risiko");
  assert.ok(stageRaceWithdrawalProbability(T.fullGapSeconds, 1) <= T.maxShare);
  assert.equal(wearOf(undefined), 0);
  assert.equal(wearOf(0.4), 0.6);
  assert.equal(wearOf(2), 0);
});

test("#6938 U4: et langt etapeloeb deler risikoen med laengden; ukendt laengde = fuld", () => {
  assert.equal(raceLengthFactor(standings(["a"], 2, 3)), 1);
  assert.equal(raceLengthFactor(standings(["a"], 10, 11)), T.refStages / 21);
  assert.equal(raceLengthFactor({ status: "first_stage", stage_number: 1 }), 1);
  assert.equal(raceLengthFactor({ status: "standings", stage_number: 3, leader_id: null, standings: [] } as GcContext), 1);
  assert.ok(isStageRaceContext(standings(["a"], 2, 3)));
  assert.ok(isStageRaceContext({ status: "first_stage", stage_number: 1 }));
  assert.ok(!isStageRaceContext({ status: "one_day" }));
  assert.ok(!isStageRaceContext({ status: "missing" }));
  assert.ok(!isStageRaceContext(null));
});

test("#6938 U4: kun sate ryttere uden kaptajnrolle og uden for klassementets top stiger af; de staar sidst", () => {
  const entrants = [
    { rider_id: "win", role: "captain", condition: 0.2 },
    { rider_id: "cap", role: "captain", condition: 0 },
    { rider_id: "spr", role: "sprint_captain", condition: 0 },
    { rider_id: "h1", role: "helper", condition: 0 },
    { rider_id: "h2", role: "hunter", condition: 0 },
    { rider_id: "gcHelper", role: "helper", condition: 0 },
    { rider_id: "near", role: "helper", condition: 0 },
    { rider_id: "otl", role: "helper", condition: 0 },
  ] as Entrant[];
  const results: StageResult[] = [
    { rider_id: "win", rank: 1, time_seconds: 10000, group_id: "a", status: "finished" },
    { rider_id: "near", rank: 2, time_seconds: 10000 + T.minGapSeconds, group_id: "a", status: "finished" },
    { rider_id: "cap", rank: 3, time_seconds: 13000, group_id: "b", status: "finished" },
    { rider_id: "spr", rank: 4, time_seconds: 13000, group_id: "b", status: "finished" },
    { rider_id: "h1", rank: 5, time_seconds: 13000, group_id: "b", status: "finished" },
    { rider_id: "gcHelper", rank: 6, time_seconds: 13000, group_id: "b", status: "finished" },
    { rider_id: "h2", rank: 7, time_seconds: 13000, group_id: "b", status: "finished" },
    { rider_id: "otl", rank: 8, time_seconds: 14000, group_id: "c", status: "otl" },
  ];
  const all = { ...T, baseShare: 1, wearShare: 0, maxShare: 1, gcProtectedTop: 1 };
  // gcHelper staar nr. 1 i klassementet og er beskyttet; resten ligger uden for toppen.
  const gc = standings(["gcHelper", "win", "near", "cap", "spr", "h1", "h2", "otl"], 2, 3);
  const out = applyStageRaceWithdrawals(results, entrants, { seed: "s", distanceKm: 150, gc, tuning: all });
  assert.deepEqual(out.results.map((r) => [r.rider_id, r.rank, r.status]), [
    ["win", 1, "finished"],
    ["near", 2, "finished"],
    ["cap", 3, "finished"],
    ["spr", 4, "finished"],
    ["gcHelper", 5, "finished"],
    ["otl", 6, "otl"],
    ["h1", 7, "abandoned"],
    ["h2", 8, "abandoned"],
  ]);
  assert.deepEqual(out.incidents.map((i) => [i.rider_id, i.kind, i.outcome, i.injury_days, i.km]), [
    ["h1", "withdrawal", "abandoned", null, 150],
    ["h2", "withdrawal", "abandoned", null, 150],
  ]);
  // Endagsloeb og manglende klassement: U4 goer intet.
  for (const other of [{ status: "one_day" }, { status: "missing" }, null] as const) {
    const res = applyStageRaceWithdrawals(results, entrants, { seed: "s", distanceKm: 150, gc: other as GcContext | null, tuning: all });
    assert.deepEqual(res.results, results);
    assert.deepEqual(res.incidents, []);
  }
  // Etape 1 (S5-trusselsmodellens "alle staar lige"): ingen er beskyttet af klassementet.
  const first = applyStageRaceWithdrawals(results, entrants, {
    seed: "s",
    distanceKm: 150,
    gc: { ...standings(results.map((r) => r.rider_id), 1, 4), first_stage: true } as unknown as GcContext,
    tuning: all,
  });
  assert.ok(first.incidents.some((i) => i.rider_id === "gcHelper"));
  // Samme rytter, samme seed: samme udfald uanset hvem der ellers starter (seedet pr. rytter).
  const tuning = { ...T, maxShare: 1, baseShare: 0.5, wearShare: 0 };
  const a = applyStageRaceWithdrawals(results, entrants, { seed: "x", distanceKm: 150, gc, tuning }).incidents.some((i) => i.rider_id === "h1");
  const b = applyStageRaceWithdrawals(results.filter((r) => r.rider_id !== "h2"), entrants, { seed: "x", distanceKm: 150, gc, tuning }).incidents.some((i) => i.rider_id === "h1");
  assert.equal(a, b);
});

function stageRaceInput(name: string, revision: string, k = 0): StageInput {
  const base = fixture(name);
  // Slidte ryttere midt i et ugeloeb (etape 3 af 5).
  const startlist = base.startlist.map((e) => ({ ...e, condition: 0.2 }));
  // Kun kaptajnerne staar i klassementets top (smaa fixture-felter ville ellers alle vaere i toppen).
  const ids = startlist.filter((e) => e.role === "captain" || e.role === "sprint_captain").map((e) => e.rider_id);
  return { ...base, seed: `${base.seed}:u4-${k}`, startlist, rules_revision: revision, gc_context: standings(ids, 3, 2) } as StageInput;
}

test("#6938 U4: motoren lader kun ryttere uden kaptajnrolle stige af i etapeloeb, kun under s5_profiles_v3", () => {
  let total = 0;
  for (const [name, k] of ["bjerg-selektion", "mellembjerg"].flatMap((n) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [n, i] as const))) {
    const v3 = simulateStageV4(stageRaceInput(name, "s5_profiles_v3", k));
    const v2 = simulateStageV4(stageRaceInput(name, "s5_profiles_v2", k));
    const input = stageRaceInput(name, "s5_profiles_v3", k);
    const role = new Map(input.startlist.map((e) => [e.rider_id, e.role]));
    const withdrawn = (v3.incidents ?? []).filter((inc) => (inc.kind as string) === "withdrawal").map((inc) => inc.rider_id);
    total += withdrawn.length;
    for (const id of withdrawn) {
      assert.ok(!["captain", "sprint_captain"].includes(role.get(id) as string), `${name}: ${id} er kaptajn`);
      assert.equal(v3.results.find((r) => r.rider_id === id)!.status, "abandoned");
    }
    assert.deepEqual(v3.results.map((r) => r.rider_id).sort(), input.startlist.map((e) => e.rider_id).sort());
    // v2 kender ikke U4.
    assert.ok(!v2.incidents?.some((inc) => (inc.kind as string) === "withdrawal"), `${name}: v2 uden udgang`);
  }
  assert.ok(total > 0, "en bjergetape midt i et ugeloeb faar en slidt, sat hjaelper til at stige af");
});
