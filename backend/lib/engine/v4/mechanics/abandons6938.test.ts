// backend/lib/engine/v4/mechanics/abandons6938.test.ts
// #6938 (KUN s5_profiles_v3, slukket): U2 styrt-udgang pr. terraen og U3 hjaelper
// stiger af i endagsloeb (U1 er erstattet af sygdom, egen PR). Spec: docs/superpowers/specs/
// 2026-10-23-6804-v3-tilvalg-design.md §2.2.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyHelperWithdrawals,
  HELPER_WITHDRAWAL_V3_TUNING,
  helperWithdrawalProbability,
} from "./abandons.ts";
import { CRASH_ABANDON_V3_TUNING, crashSeriousShareFor, resolveIncident } from "./incidents.ts";
import { simulateStageV4 } from "../index.ts";
import { INCIDENTS_EXTRA_TUNING } from "../tuning.ts";
import type { Entrant, GcContext, StageInput, StageResult } from "../types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): StageInput =>
  JSON.parse(readFileSync(path.join(HERE, "..", "fixtures", name, "input.json"), "utf8")) as StageInput;

const standings = (ids: string[], stage = 10, extra: Record<string, unknown> = {}): GcContext =>
  ({
    status: "standings",
    stage_number: stage,
    leader_id: ids[0] ?? null,
    standings: ids.map((rider_id, i) => ({ rider_id, rank: i + 1, gap_seconds: i * 10 })),
    stages_remaining: 21 - stage,
    race_gc_stages: [
      { stage_number: stage - 1, profile_type: "mountain", demand: {} },
      { stage_number: stage, profile_type: "flat", demand: {} },
    ],
    ...extra,
  }) as GcContext;

const entrant = (over: Partial<Entrant> = {}): Pick<Entrant, "condition" | "form" | "role"> => ({
  condition: 0.1,
  form: 50,
  role: "helper",
  ...over,
});

test("#6938 U2: andelen af styrt der udgaar kommer fra terraenet kun under s5_profiles_v3", () => {
  for (const kind of ["flat", "rolling", "climb", "descent", "cobbles"] as const) {
    assert.equal(crashSeriousShareFor(kind, false), undefined);
    assert.equal(crashSeriousShareFor(kind, true), CRASH_ABANDON_V3_TUNING.seriousShareByKind[kind]);
  }
  const shares = CRASH_ABANDON_V3_TUNING.seriousShareByKind;
  assert.ok(shares.cobbles >= shares.flat && shares.descent >= shares.flat, "brosten og nedkoersler hoejest");
  assert.ok(shares.climb <= shares.flat, "stigning lavest");
  for (const share of Object.values(shares)) assert.ok(share > INCIDENTS_EXTRA_TUNING.crashSeverityShares.serious);
});

test("#6938 U2: resolveIncident bruger terraenets andel; udeladt = tuningens egen (byte-identisk)", () => {
  const rolls = { kind: 0.99, severity: 0.08, magnitude: 0.5, injury: 0.5 };
  const ctx = { protectedByRule: false, helperNearby: false };
  assert.equal(resolveIncident(rolls, ctx, INCIDENTS_EXTRA_TUNING).severity, "hard");
  assert.equal(resolveIncident(rolls, { ...ctx, seriousShare: 0.1 }, INCIDENTS_EXTRA_TUNING).severity, "serious");
  assert.equal(resolveIncident(rolls, { ...ctx, seriousShare: 0.1 }, INCIDENTS_EXTRA_TUNING).outcome, "abandoned");
  // Mekanisk uheld kan stadig aldrig udgaa, uanset andelen.
  assert.equal(resolveIncident({ ...rolls, kind: 0 }, { ...ctx, seriousShare: 1 }, INCIDENTS_EXTRA_TUNING).outcome, "time_loss");
});

// ── U3: hjaelperen stiger af i endagsloeb ───────────────────────────────────

test("#6938 U3: risikoen er 0 op til graensen og stiger monotont til loftet", () => {
  const t = HELPER_WITHDRAWAL_V3_TUNING;
  assert.equal(helperWithdrawalProbability(0), 0);
  assert.equal(helperWithdrawalProbability(t.minGapSeconds), 0);
  let previous = 0;
  for (const gap of [t.minGapSeconds + 30, t.minGapSeconds + 120, t.fullGapSeconds - 1]) {
    const p = helperWithdrawalProbability(gap);
    assert.ok(p > previous);
    previous = p;
  }
  assert.equal(helperWithdrawalProbability(t.fullGapSeconds), t.maxShare);
  assert.equal(helperWithdrawalProbability(t.fullGapSeconds * 10), t.maxShare);
});

test("#6938 U3: kun sate hjaelpere i et endagsloeb stiger af; de staar sidst, uden skade", () => {
  const entrants = [
    { rider_id: "cap", role: "captain" },
    { rider_id: "h1", role: "helper" },
    { rider_id: "h2", role: "helper" },
    { rider_id: "cap2", role: "captain" },
    { rider_id: "otl", role: "helper" },
  ] as Entrant[];
  const results: StageResult[] = [
    { rider_id: "cap", rank: 1, time_seconds: 1000, group_id: "a", status: "finished" },
    { rider_id: "h1", rank: 2, time_seconds: 1060, group_id: "a", status: "finished" },
    { rider_id: "h2", rank: 3, time_seconds: 2000, group_id: "b", status: "finished" },
    { rider_id: "cap2", rank: 4, time_seconds: 2000, group_id: "b", status: "finished" },
    { rider_id: "otl", rank: 5, time_seconds: 2500, group_id: "c", status: "otl" },
  ];
  const all = { ...HELPER_WITHDRAWAL_V3_TUNING, maxShare: 1 };
  const out = applyHelperWithdrawals(results, entrants, { seed: "s", distanceKm: 200, gc: { status: "one_day" }, tuning: all });
  assert.deepEqual(out.results.map((r) => [r.rider_id, r.rank, r.status]), [
    ["cap", 1, "finished"],
    ["h1", 2, "finished"],
    ["cap2", 3, "finished"],
    ["otl", 4, "otl"],
    ["h2", 5, "abandoned"],
  ]);
  assert.deepEqual(out.incidents, [
    { rider_id: "h2", km: 200, kind: "withdrawal", severity: null, outcome: "abandoned", time_loss_seconds: null, injury_days: null, helper_assist: false },
  ]);
  // Etapeloeb: ingen.
  const stageRace = applyHelperWithdrawals(results, entrants, { seed: "s", distanceKm: 200, gc: standings(["cap"], 3), tuning: all });
  assert.deepEqual(stageRace.results, results);
  assert.deepEqual(stageRace.incidents, []);
});

test("#6938 U3: motoren lader kun sate hjaelpere stige af, kun under s5_profiles_v3 og kun i endagsloeb", () => {
  let total = 0;
  for (const name of ["bjerg-selektion", "nedkoerselsfinale", "mellembjerg", "mur-finale"]) {
    const base = fixture(name);
    const input: StageInput = { ...base, rules_revision: "s5_profiles_v3", gc_context: { status: "one_day" } };
    const out = simulateStageV4(input);
    const v2 = simulateStageV4({ ...input, rules_revision: "s5_profiles_v2" });
    const role = new Map(base.startlist.map((e) => [e.rider_id, e.role]));
    const winnerTime = v2.results[0]!.time_seconds;
    const withdrawn = (out.incidents ?? []).filter((inc) => (inc.kind as string) === "withdrawal").map((inc) => inc.rider_id);
    total += withdrawn.length;
    for (const id of withdrawn) {
      assert.equal(role.get(id), "helper", `${name}: ${id}`);
      const v2Row = v2.results.find((r) => r.rider_id === id)!;
      assert.ok(v2Row.time_seconds - winnerTime > HELPER_WITHDRAWAL_V3_TUNING.minGapSeconds, `${name}: ${id} var sat`);
      assert.equal(out.results.find((r) => r.rider_id === id)!.status, "abandoned");
    }
    assert.deepEqual(out.results.map((r) => r.rider_id).sort(), base.startlist.map((e) => e.rider_id).sort());
    assert.ok(!v2.incidents?.some((inc) => (inc.kind as string) === "withdrawal"));
  }
  assert.ok(total > 0, "bjergetapen spreder feltet nok til at en sat hjaelper stiger af");
});
