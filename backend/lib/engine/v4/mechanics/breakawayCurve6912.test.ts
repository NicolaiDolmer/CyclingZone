// backend/lib/engine/v4/mechanics/breakawayCurve6912.test.ts
// #6912 (KUN s5_profiles_v3 + kontakten, SLUKKET): forspringskurven. Ingen balance-tal her
// (hard rule 17): testene laaser reglerne (kontakten, kurvens form, maalets fald, styringens
// graenser, bit-identitet uden kontakten), ikke kalibreringen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateStageV4 } from "../index.ts";
import { BREAKAWAY_CURVE_6912_TUNING as T } from "../tuning.ts";
import type { GcContext, RouteV2, Segment, StageInput, TimelineEvent } from "../types.ts";
import {
  breakawayCurve6912Applies,
  breakawayCurve6912On,
  curveClosingCapSeconds,
  curveControlledClosing,
  curveGrowthSeconds,
  curveLetGoSplitKm,
  curvePeakSeconds,
  curveTargetSeconds,
  curveTopKm,
  remainingClimbLossSeconds,
} from "./breakawayCurve6912.ts";
import { preFinalChaseClosingScale6912 } from "./mountainSelection.ts";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): StageInput => JSON.parse(readFileSync(path.join(fixturesDir, name, "input.json"), "utf8")) as StageInput;
const firstStage: GcContext = { status: "first_stage", stage_number: 1 };

const flat = (from: number, to: number): Segment => ({ kind: "flat", from_km: from, to_km: to } as Segment);
const climb = (from: number, to: number, gradient = 7): Segment => ({ kind: "climb", from_km: from, to_km: to, category: "1", avg_gradient: gradient, top_elevation_m: 2000 } as Segment);
const route = (segments: Segment[], profile_type: RouteV2["profile_type"] = "mountain") =>
  ({ distance_km: segments[segments.length - 1].to_km, segments, profile_type }) as Pick<RouteV2, "distance_km" | "segments" | "profile_type">;

test("#6912: kontakten kraever s5_profiles_v3 OG et eksplicit flag", () => {
  assert.equal(breakawayCurve6912On({ rules_revision: "s5_profiles_v3", breakaway_curve_6912: true }), true);
  assert.equal(breakawayCurve6912On({ rules_revision: "s5_profiles_v3" }), false);
  assert.equal(breakawayCurve6912On({ rules_revision: "s5_profiles_v3", breakaway_curve_6912: null }), false);
  assert.equal(breakawayCurve6912On({ rules_revision: "s5_profiles_v2", breakaway_curve_6912: true }), false);
  assert.equal(breakawayCurve6912On({ rules_revision: null, breakaway_curve_6912: true }), false);
  assert.equal(breakawayCurve6912Applies(true, "rolling"), false, "rullende er uden for sagen");
  assert.equal(breakawayCurve6912Applies(undefined, "mountain"), false);
  for (const p of T.profileTypes) assert.equal(breakawayCurve6912Applies(true, p), true, p);
});

test("#6912: toppen ligger aldrig over loftet (loftet bevares) og aldrig under hovedstarten", () => {
  for (const p of ["flat", "mountain", "high_mountain", "rolling"] as const) {
    for (const ceiling of [0, 10, 300, 900]) {
      const peak = curvePeakSeconds({ ceilingSeconds: ceiling, profileType: p, initialGapSeconds: 25 });
      assert.ok(peak <= ceiling || ceiling < 25, `${p} ${ceiling}: aldrig over loftet`);
      assert.ok(peak >= Math.min(25, ceiling), `${p} ${ceiling}: aldrig under hovedstarten`);
    }
  }
});

test("#6912: vaeksten flader ud mod toppen og gaar aldrig over den; et hul over toppen vokser ikke", () => {
  const peak = 400;
  const rate = 12;
  let sep = 25;
  let prevStep = Infinity;
  for (let i = 0; i < 40; i++) {
    const step = curveGrowthSeconds({ separationSeconds: sep, peakSeconds: peak, secondsPerKm: rate, km: 5 });
    assert.ok(step >= 0 && step <= prevStep + 1e-9, "aftagende vaekst");
    sep += step;
    assert.ok(sep <= peak + 1e-9, "aldrig over toppen");
    prevStep = step;
  }
  assert.ok(sep > 0.95 * peak, "naermer sig toppen");
  assert.equal(curveGrowthSeconds({ separationSeconds: peak + 50, peakSeconds: peak, secondsPerKm: rate, km: 10 }), 0);
  assert.equal(curveGrowthSeconds({ separationSeconds: 100, peakSeconds: peak, secondsPerKm: rate, km: 0 }), 0);
  assert.equal(curveGrowthSeconds({ separationSeconds: 100, peakSeconds: peak, secondsPerKm: 0, km: 10 }), 0);
});

test("#6912: lad-gaa-fasen slutter ved kurvens top; segmentet deles uden tab", () => {
  const input = { formationKm: 5, peakSeconds: 400, secondsPerKm: 12, initialGapSeconds: 25 };
  const top = curveTopKm(input);
  assert.ok(top > input.formationKm);
  // Kurven har naaet topShare af toppen ved top-km.
  const grown = 25 + curveGrowthSeconds({ separationSeconds: 25, peakSeconds: 400, secondsPerKm: 12, km: top - 5 });
  assert.ok(Math.abs(grown - T.topShare * 400) < 1e-6, "top-km og vaeksten er samme kurve");
  for (const [from, to] of [[0, 10], [10, top - 1], [top - 1, top + 1], [top + 5, top + 20]]) {
    const { letGoKm, chaseKm } = curveLetGoSplitKm({ ...input, fromKm: from, toKm: to });
    assert.ok(letGoKm >= 0 && chaseKm >= 0);
    assert.ok(Math.abs(letGoKm + chaseKm - (to - Math.max(from, 5))) < 1e-9);
  }
  assert.equal(curveLetGoSplitKm({ ...input, fromKm: top + 5, toKm: top + 20 }).letGoKm, 0, "efter toppen er alt jagt");
  assert.equal(curveTopKm({ ...input, peakSeconds: 25 }), 5, "ingen plads = ingen fase");
});

test("#6912: maalet falder fra toppen mod finalen, og resterende stigninger laegges oveni", () => {
  const flatRoute = route([flat(0, 180)], "flat");
  const peak = 300;
  let prev = Infinity;
  for (let km = 60; km <= 180; km += 10) {
    const t = curveTargetSeconds({ route: flatRoute, km, topKm: 60, peakSeconds: peak });
    assert.ok(t <= prev + 1e-9, `faldende ved km ${km}`);
    assert.ok(t <= peak);
    prev = t;
  }
  assert.ok(Math.abs(curveTargetSeconds({ route: flatRoute, km: 60, topKm: 60, peakSeconds: peak }) - peak) < 1e-9, "ved toppen = toppen");
  const mountain = route([flat(0, 150), climb(150, 165, 8)]);
  const before = curveTargetSeconds({ route: mountain, km: 140, topKm: 50, peakSeconds: peak });
  const sameWithoutClimb = curveTargetSeconds({ route: route([flat(0, 165)]), km: 140, topKm: 50, peakSeconds: peak });
  assert.ok(before > sameWithoutClimb, "den resterende stigning holder maalet hoejere");
  assert.ok(before <= peak);
  assert.ok(remainingClimbLossSeconds(mountain, 0) > remainingClimbLossSeconds(mountain, 158), "kun den resterende del taeller");
  assert.equal(remainingClimbLossSeconds(mountain, 165), 0);
});

test("#6912: styringen henter ikke under maalet foer finalen, og jagende hold lukker selv ned mod det", () => {
  // Over maalet med ryttere: lukker mindst ned mod maalet (inden for segmentets loft).
  const up = curveControlledClosing({ existingSeconds: 10, grownSeconds: 400, targetSeconds: 300, capSeconds: 1000, hasChasers: true, upperBounded: true });
  assert.equal(up.closing, 100);
  assert.equal(up.extra, 90, "de jagende hold baerer det ekstra");
  // Uden ryttere at jage med: ingen ekstra lukning.
  assert.deepEqual(curveControlledClosing({ existingSeconds: 10, grownSeconds: 400, targetSeconds: 300, capSeconds: 1000, hasChasers: false, upperBounded: true }), { closing: 10, extra: 0 });
  // Segmentets loft.
  assert.equal(curveControlledClosing({ existingSeconds: 0, grownSeconds: 400, targetSeconds: 0, capSeconds: 50, hasChasers: true, upperBounded: true }).closing, 50);
  // Foer finalen: den almindelige jagt henter ikke under maalet (flad: fangsten flyttes til finalen).
  assert.deepEqual(curveControlledClosing({ existingSeconds: 200, grownSeconds: 250, targetSeconds: 200, capSeconds: 1000, hasChasers: true, upperBounded: true }), { closing: 50, extra: 0 });
  // Finalen / klassementsreaktion: ingen oevre graense.
  assert.deepEqual(curveControlledClosing({ existingSeconds: 200, grownSeconds: 250, targetSeconds: 200, capSeconds: 1000, hasChasers: true, upperBounded: false }), { closing: 200, extra: 0 });
  // Under maalet: intet at lukke foer finalen.
  assert.equal(curveControlledClosing({ existingSeconds: 30, grownSeconds: 100, targetSeconds: 200, capSeconds: 1000, hasChasers: true, upperBounded: true }).closing, 0);
  assert.equal(curveClosingCapSeconds(-5), 0);
  assert.ok(curveClosingCapSeconds(10) > curveClosingCapSeconds(5));
});

test("#6912: daempningen foer finalen loeftes kun under styringen", () => {
  assert.equal(preFinalChaseClosingScale6912(0.4, false), 0.4);
  assert.equal(preFinalChaseClosingScale6912(0.4, true), 1);
  assert.equal(preFinalChaseClosingScale6912(1.2, true), 1.2, "aldrig lavere end foer");
});

const maxBreakSeparation = (events: readonly TimelineEvent[]): number => Math.max(0, ...events
  .filter((e) => e.type === "gap_update" && e.params.group_id === "breakaway-0")
  .map((e) => Number(e.params.separation_seconds ?? 0)));

test("#6912: uden kontakten er motoren bit-identisk; med kontakten deterministisk og under loftet", () => {
  for (const name of ["bjerg-selektion", "flat-massespurt", "mur-finale", "mellembjerg"]) {
    const input = fixture(name);
    for (const rules_revision of ["s5_profiles_v2", "s5_profiles_v3", "orders_gc_v3"] as const) {
      const base = JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision }));
      const nullFlag = JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision, breakaway_curve_6912: null }));
      assert.equal(nullFlag, base, `${name} ${rules_revision}: null = udeladt`);
      if (rules_revision !== "s5_profiles_v3") {
        const flagged = JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision, breakaway_curve_6912: true }));
        assert.equal(flagged, base, `${name} ${rules_revision}: kontakten virker kun under v3`);
      }
    }
    const on = simulateStageV4({ ...input, gc_context: firstStage, rules_revision: "s5_profiles_v3", breakaway_curve_6912: true });
    const again = simulateStageV4({ ...input, gc_context: firstStage, rules_revision: "s5_profiles_v3", breakaway_curve_6912: true });
    assert.equal(JSON.stringify(on), JSON.stringify(again), `${name}: deterministisk`);
    const off = simulateStageV4({ ...input, gc_context: firstStage, rules_revision: "s5_profiles_v3" });
    if (T.profileTypes.includes(input.route.profile_type)) {
      assert.ok(maxBreakSeparation(on.timeline.events) <= Math.max(maxBreakSeparation(off.timeline.events), 1) + 1e-6, `${name}: toppen bliver ikke hoejere`);
    }
  }
});
