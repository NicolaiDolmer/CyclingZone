// backend/lib/engine/v4/mechanics/descentRegroup6486.test.ts
// #6486 D3 (D1 motor, KUN s5_profiles_v3, slukket): grupper samler sig paa vejen
// fra sidste top til maal paa bjerg uden topankomst.
//
// Tal staar ikke her (hard rule 17): baandet for nr. 10 laeses fra scorecardet
// (TOUR_BENCHMARKS, mountain_non_summit), de maalte tal ligger privat.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { simulateStageV4 } from "../index.ts";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { __resetRaceEngineV4Cache, loadRaceEngineV4 } from "../../../raceEngineV4Bridge.js";
import { breakawaySets, gapTo10Class, runStagesInOrder as runStagesInOrderJs, TOUR_BENCHMARKS, verdict } from "../../../../scripts/dev/lib/tourScorecard.mjs";
import { median } from "../../../../scripts/lib/headToHeadStats.js";
import {
  closingSecondsPerKm,
  cooperationShare,
  descentRegroup6486Applies,
  descentRegroup6486OnRoute,
  descentRegroupTempo6486,
  DESCENT_REGROUP_6486_TUNING as T,
  regroupClosingSeconds,
} from "./descentRegroup6486.ts";
import { D3_NON_SUMMIT_ROUTES_6486 } from "./descentRegroup6486.fixture.ts";
import type { RaceGroup, Segment, StageOutput } from "../types.ts";

// ── Rene regler ──────────────────────────────────────────────────────────────

const climb = (from: number, to: number): Segment => ({ kind: "climb", from_km: from, to_km: to, category: "1", avg_gradient: 7, top_elevation_m: 2000 } as Segment);
const descent = (from: number, to: number): Segment => ({ kind: "descent", from_km: from, to_km: to, technicality: 2 } as Segment);
const flat = (from: number, to: number): Segment => ({ kind: "flat", from_km: from, to_km: to } as Segment);
const nonSummit = { profile_type: "mountain" as const, segments: [flat(0, 100), climb(100, 115), descent(115, 126), flat(126, 130)] };

test("#6486: applies only after the last climb of a mountain stage that does not finish on a climb", () => {
  assert.equal(descentRegroup6486Applies(nonSummit, 2), true, "the descent after the last top");
  assert.equal(descentRegroup6486Applies(nonSummit, 3), true, "the run-in");
  assert.equal(descentRegroup6486Applies(nonSummit, 0), false, "before the last climb");
  assert.equal(descentRegroup6486Applies(nonSummit, 1), false, "the climb itself");
  assert.equal(descentRegroup6486Applies({ ...nonSummit, profile_type: "high_mountain" }, 2), true);
  for (const profile_type of ["hilly", "rolling", "flat"] as const) assert.equal(descentRegroup6486Applies({ ...nonSummit, profile_type }, 2), false, profile_type);
  const summit = { profile_type: "mountain" as const, segments: [flat(0, 100), climb(100, 110), descent(110, 120), climb(120, 130)] };
  assert.equal(descentRegroup6486Applies(summit, 2), false, "summit finish: untouched");
});

test("#6486: more riders cooperate better; a lone rider closes only a little; a smaller group behind a bigger one closes less", () => {
  assert.equal(cooperationShare(1), T.soloShare);
  assert.equal(cooperationShare(T.fullCooperationRiders), 1);
  assert.equal(cooperationShare(T.fullCooperationRiders + 10), 1);
  for (let n = 1; n < 10; n++) assert.ok(cooperationShare(n + 1) >= cooperationShare(n), `non-decreasing at ${n}`);
  assert.ok(closingSecondsPerKm("flat", 1, 1) < closingSecondsPerKm("flat", 4, 1));
  assert.ok(closingSecondsPerKm("flat", 2, 8) < closingSecondsPerKm("flat", 2, 2));
  assert.equal(closingSecondsPerKm("climb", 5, 1), 0, "never on a climb");
});

test("#6486: a gap only shrinks, never by more than the gap, and groups out of reach keep it", () => {
  const chain = [{ id: "a", gap: 0, riders: 3 }, { id: "b", gap: 20, riders: 6 }, { id: "c", gap: 25, riders: 1 }, { id: "d", gap: 25 + T.reachSeconds + 30, riders: 8 }];
  const closed = regroupClosingSeconds(chain, "flat", 10);
  assert.equal(closed.get("a"), 0);
  assert.ok((closed.get("b") ?? 0) > 0 && (closed.get("b") ?? 0) <= 20);
  assert.ok((closed.get("c") ?? -1) >= 0 && (closed.get("c") ?? 0) <= 5);
  assert.equal(closed.get("d"), 0, "beyond reach");
  // Zero length or a climb: nothing.
  for (const v of regroupClosingSeconds(chain, "flat", 0).values()) assert.equal(v, 0);
  for (const v of regroupClosingSeconds(chain, "climb", 10).values()) assert.equal(v, 0);
});

test("#6486: groups that make contact chase on together (snowball), so the group behind them gains more", () => {
  const lone = regroupClosingSeconds([{ id: "a", gap: 0, riders: 1 }, { id: "c", gap: 40, riders: 1 }], "flat", 10).get("c") ?? 0;
  // Same last rider, but a big group just ahead of him catches him early and takes him along.
  const carried = regroupClosingSeconds([{ id: "a", gap: 0, riders: 1 }, { id: "c", gap: 40, riders: 1 }, { id: "z", gap: 41, riders: 6 }], "flat", 10).get("c") ?? 0;
  assert.ok(carried > lone, `the lone rider closes more with a group on his wheel (${carried} > ${lone})`);
});

const g = (id: string, gap: number, riders: number, extra: Partial<RaceGroup> = {}): RaceGroup =>
  ({ id, kind: "chase", rider_ids: Array.from({ length: riders }, (_, i) => `${id}${i}`), gap_seconds: gap, cohesion: 1, ...extra });

test("#6486: the tempo layer only makes a group faster, leaves the breakaway and an incident chase alone, and returns the same Map without effect", () => {
  const groups = [g("brk", 0, 2, { kind: "breakaway", origin: "breakaway" }), g("brkPiece", 10, 3, { origin: "breakaway" }), g("fav", 60, 3, { kind: "peloton" }), g("ch", 80, 5), g("inc", 85, 1)];
  const tempo = new Map(groups.map((x) => [x.id, { dtSeconds: 600 }]));
  const out = descentRegroupTempo6486(groups, tempo, nonSummit, 3, { inc0: {} });
  assert.notEqual(out, tempo);
  assert.equal(out.get("brk")?.dtSeconds, 600);
  assert.equal(out.get("brkPiece")?.dtSeconds, 600, "a chase piece split from the breakaway is still M5's");
  assert.equal(out.get("fav")?.dtSeconds, 600);
  assert.ok((out.get("ch")?.dtSeconds ?? 600) < 600);
  assert.ok(600 - (out.get("ch")?.dtSeconds ?? 0) <= 20, "never more than the hole");
  assert.equal(out.get("inc")?.dtSeconds, 600, "incident chase untouched");
  assert.equal(descentRegroupTempo6486(groups, tempo, nonSummit, 0, undefined), tempo, "before the last climb: same Map");
  // A group that already rides faster keeps its own tempo.
  const fast = new Map(tempo); fast.set("ch", { dtSeconds: 500 });
  assert.equal(descentRegroupTempo6486(groups, fast, nonSummit, 3, undefined).get("ch")?.dtSeconds, 500);
});

test("#6486: among the engine fixtures only the descent finish is a non-summit mountain stage; there v3 changes only times and groups after the last top", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
  const names = readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isDirectory()).sort();
  const applies = names.filter((n) => descentRegroup6486OnRoute(JSON.parse(readFileSync(path.join(dir, n, "input.json"), "utf8")).route));
  assert.deepEqual(applies, ["nedkoerselsfinale"]);
  const input = JSON.parse(readFileSync(path.join(dir, "nedkoerselsfinale", "input.json"), "utf8"));
  const lastTopKm = Math.max(...input.route.segments.filter((s: Segment) => s.kind === "climb").map((s: Segment) => s.to_km));
  const v2 = simulateStageV4({ ...input, rules_revision: "s5_profiles_v2" });
  const v3 = simulateStageV4({ ...input, rules_revision: "s5_profiles_v3" });
  assert.equal(JSON.stringify(simulateStageV4({ ...input, rules_revision: "s5_profiles_v3" })), JSON.stringify(v3), "deterministic");
  // Up to and including the last top the race is the same (gap_update aside, #6814).
  const upToTop = (out: StageOutput) => JSON.stringify(out.timeline.events.filter((e) => e.km <= lastTopKm && e.type !== "gap_update"));
  assert.equal(upToTop(v3), upToTop(v2));
  assert.deepEqual(v3.results.map((r) => r.rider_id).sort(), v2.results.map((r) => r.rider_id).sort(), "same riders");
  // Nobody finishes further behind the winner than under v2: gaps only shrink.
  const behind = (out: StageOutput) => {
    const fin = out.results.filter((r) => r.status === "finished");
    const best = Math.min(...fin.map((r) => r.time_seconds));
    return Math.max(...fin.map((r) => r.time_seconds - best));
  };
  assert.ok(behind(v3) <= behind(v2) + 1e-6);
});

test("#6486: a long chain of groups never sums to an invalid traversal; every group stays within its physical bound and keeps the order", () => {
  const long = { profile_type: "mountain" as const, segments: [flat(0, 100), climb(100, 115), descent(115, 130)] };
  const groups = Array.from({ length: 110 }, (_, i) => g(`s${String(i).padStart(3, "0")}`, i * 10, 1));
  const tempo = new Map(groups.map((x) => [x.id, { dtSeconds: 900 }]));
  const out = descentRegroupTempo6486(groups, tempo, long, 2, undefined);
  let prevArrival = -Infinity;
  for (const x of groups) {
    const dt = out.get(x.id)?.dtSeconds ?? NaN;
    assert.ok(Number.isFinite(dt) && dt > 0, `${x.id}: ${dt}`);
    // Loftet er paa farten (Codex #7175): fart-forholdet egen tid / ny tid maa aldrig
    // overstige 1 + maxSpeedGainShare.
    assert.ok(900 / dt <= 1 + T.maxSpeedGainShare + 1e-9, `${x.id}: speed ratio ${900 / dt}`);
    const arrival = x.gap_seconds + dt;
    assert.ok(arrival >= prevArrival - 1e-9, `${x.id} never passes the group ahead`);
    prevArrival = arrival;
  }
});

// ── Hele motoren: D3-fixturen, foer (s5_profiles_v2) og efter (s5_profiles_v3) ──

const runStagesInOrder = runStagesInOrderJs as unknown as (opts: Record<string, unknown>) => unknown;
const here = path.dirname(fileURLToPath(import.meta.url));
const GIRO = path.join(here, "..", "..", "..", "..", "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const SEEDS = 6;
type StageRun = { res: { v4Output: StageOutput } };

async function favouritesNr10(profile: Record<string, unknown>, revision: string): Promise<{ median: number; outputs: string[] }> {
  const data = JSON.parse(readFileSync(GIRO, "utf8"));
  __resetRaceEngineV4Cache();
  const v4 = await loadRaceEngineV4();
  const gaps: number[] = [];
  const outputs: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    runStagesInOrder({
      v4, data: { ...data, profiles: [profile] }, revision, seedTag: `d3-6486-${seed}`, stages: [profile],
      onStage: ({ res }: StageRun) => {
        // Favoritternes etape: nr. 10 uden for morgenudbruddet (Udbrudsmaal ejer udbruddet).
        const { formed } = breakawaySets(res.v4Output);
        const fav = res.v4Output.results.filter((r) => r.status === "finished" && !formed.has(r.rider_id)).sort((a, b) => a.time_seconds - b.time_seconds);
        if (fav.length >= 10) gaps.push(fav[9].time_seconds - fav[0].time_seconds);
        outputs.push(JSON.stringify(res.v4Output.results.map((r) => [r.rider_id, r.time_seconds])));
      },
    });
  }
  return { median: median(gaps) as number, outputs };
}

test("#6486: on the D3 fixture (last top far from the line, short run-in) nr. 10 comes inside the non-summit band only under s5_profiles_v3", async () => {
  const band = TOUR_BENCHMARKS.gapTo10.byClass.mountain_non_summit;
  for (const name of ["shortRunIn", "descentToLine"] as const) {
    const profile = D3_NON_SUMMIT_ROUTES_6486[name];
    assert.equal(gapTo10Class(profile), "mountain_non_summit", name);
    const before = await favouritesNr10(profile, "s5_profiles_v2");
    const after = await favouritesNr10(profile, "s5_profiles_v3");
    assert.notEqual(verdict(before.median, band), "PASS", `${name}: the reported problem is reproduced before`);
    assert.equal(verdict(after.median, band), "PASS", `${name}: nr. 10 inside the band after`);
    assert.ok(after.median > 0, `${name}: the favourites do not all come back together`);
  }
});

test("#6486: summit finishes are untouched under s5_profiles_v3 (same results as s5_profiles_v2)", async () => {
  const data = JSON.parse(readFileSync(GIRO, "utf8"));
  const summit = data.profiles.find((p: { stage_number: number }) => p.stage_number === 13);
  const v2 = await favouritesNr10(summit, "s5_profiles_v2");
  const v3 = await favouritesNr10(summit, "s5_profiles_v3");
  assert.deepEqual(v3.outputs, v2.outputs);
});
