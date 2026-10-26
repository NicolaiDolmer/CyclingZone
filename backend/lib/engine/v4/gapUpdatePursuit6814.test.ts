// #6814 (KUN s5_profiles_v3, slukket): udbruddets afstand til den gruppe der
// faktisk jager det, paa `gap_update`. Design: docs/superpowers/specs/
// 2026-10-18-6814-gap-update-chase-design.md (bygget bag v3 i stedet for v2,
// koordinering paa #6814 21/10). Strukturelle invarianter, ingen kalibrerede tal.
import test from "node:test";
import assert from "node:assert/strict";
import { frozenStageOutput, frozenStages } from "./testUtils/oldRevisionDigests6199.ts";
import { buildFilmTimeline } from "../../../../frontend/src/lib/stageTimelineFilm.js";
import type { TimelineEvent } from "./types.ts";

const SEEDS = ["6814-a", "6814-b"] as const;

type Run = { key: string; timeline: TimelineEvent[]; distanceKm: number };

function runs(revision: string): Run[] {
  const out: Run[] = [];
  for (const row of frozenStages()) {
    for (const seed of SEEDS) {
      const output = frozenStageOutput(row, seed, revision);
      out.push({ key: `${row.profile_type}#${row.stage_number ?? 1}@${seed}`, timeline: output.timeline.events, distanceKm: Number(row.distance_km) || 0 });
    }
  }
  return out;
}

const V3 = runs("s5_profiles_v3");
const isPursuit = (e: TimelineEvent) => e.type === "gap_update" && typeof e.params?.chase_group_id === "string";

test("#6814: v2 og aeldre faar aldrig jagtfelter paa gap_update", () => {
  for (const revision of ["s5_profiles_v2", "s5_profiles_v1", "official_times_v5"]) {
    for (const run of runs(revision)) {
      assert.equal(run.timeline.some(isPursuit), false, `${revision} ${run.key}`);
    }
  }
});

test("#6814: v3 udsender jagtafstand for udbrud, altid med en jagtgruppe og en afstand >= 0", () => {
  let pursuits = 0;
  for (const run of V3) {
    for (const e of run.timeline.filter(isPursuit)) {
      pursuits++;
      assert.notEqual(e.params.chase_group_id, e.params.group_id, `${run.key}: jagtgruppen er ikke udbruddet selv`);
      const sep = Number(e.params.separation_seconds);
      assert.ok(Number.isFinite(sep) && sep >= 0, `${run.key}: afstanden er endelig og ikke negativ`);
    }
  }
  assert.ok(pursuits > 0, "baselinen har udbrud med jagt-punkter");
});

test("#6814: aldrig to gap_update for samme gruppe paa samme km", () => {
  for (const run of V3) {
    const seen = new Set<string>();
    for (const e of run.timeline.filter((x) => x.type === "gap_update")) {
      const key = `${e.params?.group_id}@${e.km}`;
      assert.equal(seen.has(key), false, `${run.key}: ${key}`);
      seen.add(key);
    }
  }
});

test("#6814 testport 4: et hentet udbruds sidste jagt-punkt er samme jagtgruppe som breakaway_caught, med afstand 0", () => {
  let checked = 0;
  for (const run of V3) {
    // Paa sidste segment henter finalen udbruddet; dér tegner filmen selv nul ved catch-km.
    const finishKm = run.timeline.find((e) => e.type === "finish")?.km ?? Infinity;
    for (const caught of run.timeline.filter((e) => e.type === "breakaway_caught" && typeof e.params?.chase_group_id === "string" && Math.round(Number(e.params?.exact_km ?? e.km)) < Math.round(finishKm))) {
      const samples = run.timeline.filter((e) => isPursuit(e) && e.params.group_id === caught.params?.group_id);
      if (!samples.length) continue;
      checked++;
      const last = samples[samples.length - 1];
      assert.equal(last.params.chase_group_id, caught.params?.chase_group_id, run.key);
      assert.equal(last.params.separation_seconds, 0, `${run.key}: hullet er lukket`);
    }
  }
  assert.ok(checked > 0, "mindst én indhentning midt paa etapen har jagt-punkter");
});

test("#6814 testport 3: loebsfilmen tegner en gab-kurve paa v3 og ingen paa v2", () => {
  const curves = (list: Run[]) => list.filter((run) => buildFilmTimeline({ events: run.timeline, distanceKm: run.distanceKm, timelineVersion: 2 }).gapCurve.length > 0).length;
  assert.ok(curves(V3) > 0, "v3: mindst én etape har en kurve");
  for (const run of V3) {
    for (const point of buildFilmTimeline({ events: run.timeline, distanceKm: run.distanceKm, timelineVersion: 2 }).gapCurve) {
      assert.ok(point.gapSeconds >= 0, `${run.key}: kurven er aldrig negativ`);
    }
  }
  assert.equal(curves(runs("s5_profiles_v2")), 0, "v2: uaendret, ingen kurve");
});

test("#6814 testport 7: etapens historie (foererlinje og mellemtider) er den samme med og uden de nye jagt-punkter", async () => {
  const { buildRaceStory } = await import("../../raceStory.js");
  // De punkter der ikke fandtes foer: udbruddet paa gab 0 (foerer) og slutpunktet ved indhentningen.
  const isNew = (e: TimelineEvent) => isPursuit(e) && (e.params.gap_seconds === 0 || e.params.separation_seconds === 0);
  let compared = 0;
  for (const run of V3) {
    if (!run.timeline.some(isNew)) continue;
    compared++;
    const withNew = buildRaceStory({ events: run.timeline, timelineVersion: 2 });
    const without = buildRaceStory({ events: run.timeline.filter((e) => !isNew(e)), timelineVersion: 2 });
    // Samme km; tiden maa kun afvige med afrunding (udbruddet paa gab 0 giver foererens tid direkte,
    // feltet giver den som tid minus et afrundet gab).
    const close = (x: Array<{ km: number; t: number | null }>, y: Array<{ km: number; t: number | null }>, what: string) => {
      assert.deepEqual(x.map((p) => p.km), y.map((p) => p.km), `${run.key}: ${what} km`);
      x.forEach((p, i) => assert.ok(Math.abs((p.t ?? 0) - (y[i].t ?? 0)) <= 0.02, `${run.key}: ${what} km ${p.km}`));
    };
    close(withNew.leader_line.map((p: { km: number; time: number }) => ({ km: p.km, t: p.time })), without.leader_line.map((p: { km: number; time: number }) => ({ km: p.km, t: p.time })), "foererlinjen");
    close(withNew.checkpoints.map((c: { km: number; leader_time_s?: number }) => ({ km: c.km, t: c.leader_time_s ?? null })), without.checkpoints.map((c: { km: number; leader_time_s?: number }) => ({ km: c.km, t: c.leader_time_s ?? null })), "mellemtiderne");
  }
  assert.ok(compared > 0);
});
