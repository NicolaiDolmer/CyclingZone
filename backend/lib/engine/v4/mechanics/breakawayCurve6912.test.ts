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
import { BREAKAWAY_CURVE_6912_TUNING as T, RACE_V4_TUNING } from "../tuning.ts";
import { routeFromStageProfileRow } from "../adapters/routeAdapter.ts";
import { buildStageOrderPlan } from "../orders/teamOrdersAdapter.ts";
import { frozenField, frozenStages } from "../testUtils/oldRevisionDigests6199.ts";
import type { GcContext, RouteV2, Segment, StageInput, TimelineEvent } from "../types.ts";
import {
  MANAGER_CHASE_6912_PARAM,
  addWork,
  breakawayCurve6912Applies,
  breakawayCurve6912On,
  curveAppliesToBreak,
  curveChaseWork,
  curveClosingCapSeconds,
  curveControlActive,
  curveControlledClosing,
  curveFloorExtraSeconds,
  curveGrowthSeconds,
  curveLetGoSplitKm,
  curvePeakSeconds,
  curvePreFinalLift,
  curveScaledGrowthSeconds,
  curveTargetSeconds,
  curveTopKm,
  curveUpperBoundApplies,
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

test("#6912: kun finalestigningen laegges oveni maalet; mellemstigningerne er terraen", () => {
  const finalOnly = route([flat(0, 150), climb(150, 165, 8)]);
  const withMiddle = route([flat(0, 40), climb(40, 55, 8), flat(55, 150), climb(150, 165, 8)]);
  assert.equal(remainingClimbLossSeconds(withMiddle, 0), remainingClimbLossSeconds(finalOnly, 0), "mellemstigningen taeller ikke");
  const peak = 600;
  assert.equal(
    curveTargetSeconds({ route: withMiddle, km: 30, topKm: 20, peakSeconds: peak }),
    curveTargetSeconds({ route: finalOnly, km: 30, topKm: 20, peakSeconds: peak }),
    "samme maal foer mellemstigningen som uden den",
  );
  // Finalestigningen i flere segmenter taeller samlet.
  const split = route([flat(0, 150), climb(150, 158, 8), climb(158, 165, 8)]);
  assert.ok(Math.abs(remainingClimbLossSeconds(split, 0) - remainingClimbLossSeconds(finalOnly, 0)) < 1e-9);
  assert.equal(remainingClimbLossSeconds(route([flat(0, 160)], "flat"), 0), 0, "uden stigning: intet tab");
  // Maalet falder paa bjerg foer finalestigningen (det ligger ikke paa toppen hele dagen).
  const gentle = route([flat(0, 40), climb(40, 55, 8), flat(55, 150), climb(150, 165, 3)]);
  const early = curveTargetSeconds({ route: gentle, km: 60, topKm: 20, peakSeconds: peak });
  const late = curveTargetSeconds({ route: gentle, km: 145, topKm: 20, peakSeconds: peak });
  assert.ok(late < early, "faldende mod foden af finalestigningen");
});

test("#6912: overgraensen gaelder kun flad/rullende-klassen; paa bjerg lukker holdene selv", () => {
  assert.equal(curveUpperBoundApplies("flat"), true);
  assert.equal(curveUpperBoundApplies("rolling"), true);
  for (const p of ["mountain", "high_mountain", "hilly"] as const) assert.equal(curveUpperBoundApplies(p), false, p);
  // Uden overgraense: den almindelige jagt lukker frit, de jagende hold mindst ned mod maalet.
  assert.deepEqual(curveControlledClosing({ existingSeconds: 200, grownSeconds: 250, targetSeconds: 200, capSeconds: 1000, hasChasers: true, upperBounded: false }), { closing: 200, extra: 0 });
  assert.deepEqual(curveControlledClosing({ existingSeconds: 10, grownSeconds: 400, targetSeconds: 300, capSeconds: 1000, hasChasers: true, upperBounded: false }), { closing: 100, extra: 90 });
});

test("#6912: en spillers jag-ordre virker altid; kurven begraenser kun den automatiske jagt", () => {
  // Automatisk jagt 50 + ordrens egen lukning 80 = 130; kurven tillader 50 ned til maalet.
  const capped = curveControlledClosing({ existingSeconds: 130, grownSeconds: 250, targetSeconds: 200, capSeconds: 1000, hasChasers: true, upperBounded: true });
  assert.equal(capped.closing, 50, "uden ordre: aldrig under maalet");
  const ordered = curveControlledClosing({ existingSeconds: 130, grownSeconds: 250, targetSeconds: 200, capSeconds: 1000, hasChasers: true, upperBounded: true, orderSeconds: 80 });
  assert.equal(ordered.closing, 130, "ordrens lukning laegges oven paa graensen");
  assert.equal(ordered.extra, 0);
  assert.ok(ordered.closing > capped.closing, "ordren lukker hurtigere end kurven");
  // Ordren kan aldrig lukke mere end jagten faktisk lukker.
  assert.equal(curveControlledClosing({ existingSeconds: 60, grownSeconds: 250, targetSeconds: 200, capSeconds: 1000, hasChasers: true, upperBounded: true, orderSeconds: 500 }).closing, 60);
  // Negativ ordre-andel = ingen.
  assert.equal(curveControlledClosing({ existingSeconds: 130, grownSeconds: 250, targetSeconds: 200, capSeconds: 1000, hasChasers: true, upperBounded: true, orderSeconds: -5 }).closing, 50);
});

test("#6912: jagt-gulvets vindue: de jagende hold lukker ned mod maalet oven i gulvet, aldrig mere end loftet", () => {
  const base = { beforeFloorSeconds: 200, floorClosingSeconds: 40, targetSeconds: 60, floorKm: 10, hasChasers: true };
  assert.equal(curveFloorExtraSeconds(base), Math.min(curveClosingCapSeconds(10), 100));
  assert.equal(curveFloorExtraSeconds({ ...base, floorKm: 2 }), Math.min(curveClosingCapSeconds(2), 100), "loftet pr. km");
  assert.ok(curveFloorExtraSeconds({ ...base, floorKm: 2 }) <= curveClosingCapSeconds(2));
  assert.equal(curveFloorExtraSeconds({ ...base, hasChasers: false }), 0, "uden ryttere at jage med");
  assert.equal(curveFloorExtraSeconds({ ...base, floorKm: 0 }), 0, "uden vindue");
  assert.equal(curveFloorExtraSeconds({ ...base, floorClosingSeconds: 180 }), 0, "gulvet alene naar maalet");
  assert.equal(curveFloorExtraSeconds({ ...base, targetSeconds: 500 }), 0, "under maalet: intet");
});

test("#6912: endagsskalaen: vaeksten regnes i endagsloftets skala og tilbage", () => {
  const input = { separationSeconds: 25, peakSeconds: 400, secondsPerKm: 12, km: 10 };
  assert.equal(curveScaledGrowthSeconds({ ...input, oneDayScale: 1 }), curveGrowthSeconds(input), "etapeloeb = kurven selv");
  for (const scale of [0.25, 0.5, 0.8]) {
    const g = curveScaledGrowthSeconds({ ...input, oneDayScale: scale });
    const direct = curveGrowthSeconds({ separationSeconds: 25, peakSeconds: 400 * scale, secondsPerKm: 12 * scale, km: 10 });
    assert.ok(Math.abs(g * scale - direct) < 1e-9, `${scale}: kalderen ganger tilbage til endagsskalaen`);
    let sep = 25;
    for (let i = 0; i < 30; i++) sep += curveScaledGrowthSeconds({ ...input, separationSeconds: sep, oneDayScale: scale }) * scale;
    assert.ok(sep <= 400 * scale + 1e-6, `${scale}: aldrig over endagstoppen`);
  }
  assert.equal(curveScaledGrowthSeconds({ ...input, oneDayScale: 0 }), 0);
});

test("#6912: kurven gaelder ikke et farligt udbrud, et nedkoerselsangreb eller uden interesse; P6-kontrollen ejer klassementet", () => {
  const ok = { origin: "breakaway", dangerous: false, profileApplies: true, interestedTeams: 2 };
  assert.equal(curveAppliesToBreak(ok), true);
  assert.equal(curveAppliesToBreak({ ...ok, dangerous: true }), false, "farligt udbrud: GC-bremsen og snoren");
  assert.equal(curveAppliesToBreak({ ...ok, origin: "descent_attack" }), false);
  assert.equal(curveAppliesToBreak({ ...ok, origin: undefined }), false);
  assert.equal(curveAppliesToBreak({ ...ok, profileApplies: false }), false);
  assert.equal(curveAppliesToBreak({ ...ok, interestedTeams: 0 }), false);
  assert.equal(curveControlActive({ peakSeconds: 300, p6Control: false, reacting: true }), true, "reaktion uden P6: styringen gaelder");
  assert.equal(curveControlActive({ peakSeconds: 300, p6Control: true, reacting: false }), true, "P6 uden reaktion: styringen gaelder");
  assert.equal(curveControlActive({ peakSeconds: 300, p6Control: true, reacting: true }), false, "klassementskontrollen med reaktion");
  assert.equal(curveControlActive({ peakSeconds: 0, p6Control: false, reacting: false }), false, "ingen top, ingen styring");
});

test("#6912: de jagende holds arbejde laegges oven i planen, og to bidrag i samme segment betales begge", () => {
  const chasers = new Map([["team-a", ["a1", "a2"]], ["team-b", ["b1"]]]);
  const workOf = (id: string) => (id === "a2" ? 0.5 : 1);
  const chaseKm = curveChaseWork({ chasers, workOf, intensity: 0.4, km: 6, bookedKm: 10 });
  assert.ok(Math.abs((chaseKm.get("a1") ?? 0) - 0.24) < 1e-12, "andel af planens km");
  assert.ok(Math.abs((chaseKm.get("a2") ?? 0) - 0.12) < 1e-12, "indsatsen skalerer");
  const floor = curveChaseWork({ chasers, workOf, intensity: 0.4, km: 4, bookedKm: 10 });
  const plan = new Map([["a1", 0.3], ["x", 0.2]]);
  const booked = addWork(addWork(plan, chaseKm), floor);
  assert.ok(Math.abs((booked.get("a1") ?? 0) - (0.3 + 0.24 + 0.16)) < 1e-12, "sum, ikke max");
  assert.equal(booked.get("x"), 0.2, "andre ryttere uroert");
  assert.ok((booked.get("b1") ?? 0) > Math.max(chaseKm.get("b1") ?? 0, floor.get("b1") ?? 0), "begge bidrag betales");
  assert.deepEqual([...booked.keys()], ["a1", "a2", "b1", "x"], "fast raekkefoelge");
  // Uden bogfoerte km (eller kortere end intervallet): hele intensiteten.
  assert.equal(curveChaseWork({ chasers, workOf, intensity: 0.4, km: 6, bookedKm: 0 }).get("a1"), 0.4);
  assert.equal(curveChaseWork({ chasers, workOf, intensity: 0.4, km: 6, bookedKm: 4 }).get("a1"), 0.4);
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
  assert.equal(preFinalChaseClosingScale6912(0.2, true, 0.5), 0.5, "loeftet til profilens skala");
  assert.equal(preFinalChaseClosingScale6912(0.4, false, 0.9), 0.4);
  assert.equal(curvePreFinalLift("flat"), null, "flad har ingen finalestigningsfase");
  for (const p of ["mountain", "high_mountain"] as const) {
    const lift = curvePreFinalLift(p);
    assert.ok(lift !== null && lift > 0, p);
  }
});

const maxBreakSeparation = (events: readonly TimelineEvent[]): number => Math.max(0, ...events
  .filter((e) => e.type === "gap_update" && e.params.group_id === "breakaway-0")
  .map((e) => Number(e.params.separation_seconds ?? 0)));

test("#6912: uden kontakten er motoren bit-identisk; med kontakten deterministisk og under loftet", () => {
  for (const name of ["bjerg-selektion", "flat-massespurt", "mur-finale", "mellembjerg"]) {
    const input = fixture(name);
    for (const rules_revision of ["s5_profiles_v2", "s5_profiles_v3", "orders_gc_v3"] as const) {
      const base: string = JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision }));
      const nullFlag: string = JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision, breakaway_curve_6912: null }));
      assert.equal(nullFlag, base, `${name} ${rules_revision}: null = udeladt`);
      if (rules_revision !== "s5_profiles_v3") {
        const flagged: string = JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision, breakaway_curve_6912: true }));
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

// #6912 (ejer 3/11): en spillers jag-ordre virker altid; kurven begraenser kun den automatiske jagt.
// Flad etapeloebsetape (frosset proxy-rute, syntetisk felt): uden markering er jag-stancen hold-
// standard og begraenses af kurven; med markering (manageren gemte ordren) lukker holdet selv.
test("#6912: en markeret jag-ordre lukker hurtigere end kurven tillader den automatiske jagt", () => {
  const row = frozenStages().find((r) => r.profile_type === "flat" && r.stage_number === 4);
  assert.ok(row, "proxy-etapen findes");
  const r = routeFromStageProfileRow(row as Parameters<typeof routeFromStageProfileRow>[0]);
  const field = frozenField();
  const plan = buildStageOrderPlan({
    rows: [], stageNumber: 1,
    roster: field.map((x) => ({ team_id: x.team_id as string, rider_id: x.rider_id, role: x.role, is_ai: true, abilities: x.abilities })),
    context: { route: { profile_type: r.profile_type, finale_type: r.finale_type ?? null }, race: { is_stage_race: true, later_stages: [] }, rules_revision: "s5_profiles_v3" },
  } as Parameters<typeof buildStageOrderPlan>[0]);
  const startlist = field.map((x) => ({ ...x, role: plan.aiRoleByRider?.get(x.rider_id) ?? x.role, effort: plan.aiEffortByRider.get(x.rider_id) ?? x.effort }));
  const stance = (stanceOf: (teamId: string) => Record<string, unknown>) => plan.orders.map((o) => (o.kind === "team_tactics" ? { ...o, params: { ...o.params, ...stanceOf(o.team_id) } } : o));
  const chasing = new Set(["team-0", "team-2"]);
  const neutral = stance(() => ({ breakaway_stance: "neutral" }));
  const unmarked = stance((t) => ({ breakaway_stance: chasing.has(t) ? "chase" : "neutral" }));
  const marked = stance((t) => (chasing.has(t) ? { breakaway_stance: "chase", [MANAGER_CHASE_6912_PARAM]: true } : { breakaway_stance: "neutral" }));
  const gaps = (orders: StageInput["orders"], curve: boolean) => {
    const out = simulateStageV4({ route: r, startlist, orders, seed: "6912-b:4", tuning: RACE_V4_TUNING, rules_revision: "s5_profiles_v3", gc_context: firstStage, ...(curve ? { breakaway_curve_6912: true as const } : {}) } as StageInput);
    return new Map(out.timeline.events.filter((e) => e.type === "gap_update" && e.params.group_id === "breakaway-0").map((e) => [e.km, Number(e.params.separation_seconds ?? 0)]));
  };
  const auto = gaps(unmarked, true);
  const player = gaps(marked, true);
  assert.deepEqual([...auto.keys()], [...player.keys()]);
  let lower = 0;
  for (const [km, sep] of player) {
    assert.ok(sep <= (auto.get(km) ?? Infinity) + 1e-9, `km ${km}: ordren aabner aldrig forspringet`);
    if (sep < (auto.get(km) ?? 0) - 1) lower++;
  }
  assert.ok(lower > 0, "spillerens jag-ordre lukker hurtigere end den automatiske jagt under kurven");
  // Markeringen betyder kun noget med kontakten: slukket er markeret og umarkeret samme etape.
  const full = (orders: StageInput["orders"]) => JSON.stringify(simulateStageV4({ route: r, startlist, orders, seed: "6912-b:4", tuning: RACE_V4_TUNING, rules_revision: "s5_profiles_v3", gc_context: firstStage } as StageInput));
  assert.equal(full(marked), full(unmarked));
  assert.notEqual(full(unmarked), full(neutral), "slukket virker jag-stancen som foer");
});
