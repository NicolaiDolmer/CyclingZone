// #7383 (SLUKKET motorkontakt, KUN s5_profiles_v3): 10 km fra maal er altid en segmentgraense.
// Kontrakter, ingen balance-tal (hard rule 17):
//   - slukket (default) og under aeldre revisioner er ruten det SAMME objekt, og motoren
//     er bit-identisk (relationelt bevist her; mod main er det maalt lokalt i PR'en),
//   - delingen: fladt/rullende deles, stigning/sektor deles men er EEN selektion (ved
//     halen, hele stykket, indsatsen fra den laengste del), en nedkoersel deles ikke, en
//     eksisterende graense genbruges,
//   - etapeplanens skift ved "de sidste 10 km" sker praecis paa graensen for alle opgaver
//     (holdarbejde og angreb), uden #7333-finaleundtagelsen,
//   - en delt stigning giver stadig een top: samme klatre-selektioner og kom_passage-events,
//   - frontendens kopi af kontakten er den samme som motorens.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { simulateStageV4, LIVE_MECHANIC_HOOKS } from "./index.ts";
import { runSegmentLoop } from "./segmentLoop.ts";
import { priorCategorizedClimbs, stageInputForRulesRevision } from "./s5Profiles.ts";
import { validateTimelineEvents } from "./timeline.ts";
import {
  FINAL_KM_BOUNDARY_7383_ACTIVE,
  finalKmBoundary7383Active,
  finalKmTerrainPiece7383,
  isFinalKmBoundary7383On,
  routeWithFinalKmBoundary7383,
  setFinalKmBoundary7383ForBench,
  splitAtFinalKm7383,
} from "./adapters/routeAdapter.ts";
import { finalKmUndivided7383 } from "./adapters/finalKmBoundary7383.ts";
import { lateAttackSegmentIndex } from "./mechanics/lateAttack.ts";
import { STAGE_PLAN_LEG_EVENT, STAGE_PLAN_ORDER_KIND } from "../../stagePlanEngine.ts";
import { STAGE_PLAN_FINAL_KM, TASK_EFFORT, type StagePlanLeg } from "../../stagePlan.ts";
import type { ClimbSelectionHook, CobblesHook, MechanicHooks, Segment, StageInput, TeamOrder, TimelineEvent } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures");
const REVISIONS = [null, "s5_profiles_v1", "s5_profiles_v2", "s5_profiles_v3"] as const;

function fixture(name: string, revision: string | null, orders: TeamOrder[] = []): StageInput {
  const input = JSON.parse(readFileSync(path.join(FIXTURES, name, "input.json"), "utf8")) as StageInput;
  input.startlist = input.startlist.map((e, i) => ({ ...e, team_id: `T${Math.floor(i / 3)}` }));
  input.orders = orders;
  const rec = input as { rules_revision?: unknown };
  if (revision) rec.rules_revision = revision;
  else delete rec.rules_revision;
  return input;
}

function withSwitch<T>(active: boolean, fn: () => T): T {
  setFinalKmBoundary7383ForBench(active);
  try {
    return fn();
  } finally {
    setFinalKmBoundary7383ForBench(null);
  }
}

function planOrder(teamId: string, riders: Array<{ rider_id: string; legs: StagePlanLeg[] }>): TeamOrder {
  return { team_id: teamId, kind: STAGE_PLAN_ORDER_KIND, params: { riders } };
}

/** Holdets ryttere med en plan: hjaelpere koerer tempo og lederen angriber fra de sidste 10 km. */
function finalKmPlan(input: StageInput, teamId = "T0"): TeamOrder {
  const riders = input.startlist.filter((e) => e.team_id === teamId).map((e) => ({
    rider_id: e.rider_id,
    legs: (e.role === "helper" || e.role === "hunter"
      ? [{ task: "shelter_leader" }, { task: "tempo", from: { at: "final_km" } }]
      : [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }]) as StagePlanLeg[],
  }));
  return planOrder(teamId, riders);
}

function legEvents(events: readonly TimelineEvent[]): TimelineEvent[] {
  return events.filter((e) => e.type === STAGE_PLAN_LEG_EVENT);
}

const seg = {
  flat: (from_km: number, to_km: number): Segment => ({ kind: "flat", from_km, to_km }),
  climb: (from_km: number, to_km: number): Segment => ({ kind: "climb", from_km, to_km, category: "1", avg_gradient: 7, top_elevation_m: 1500 }),
  descent: (from_km: number, to_km: number): Segment => ({ kind: "descent", from_km, to_km, technicality: 2 }),
  cobbles: (from_km: number, to_km: number): Segment => ({ kind: "cobbles", from_km, to_km, sector_name: "S", stars: 3 }),
};

test("#7383: kontakten er taendt (ejer-go 31/10), og frontendens kopi er den samme", () => {
  assert.equal(FINAL_KM_BOUNDARY_7383_ACTIVE, true);
  assert.equal(finalKmBoundary7383Active(), true);
  for (const revision of REVISIONS) assert.equal(isFinalKmBoundary7383On(revision), revision === "s5_profiles_v3", String(revision));
  const model = readFileSync(path.join(here, "..", "..", "..", "..", "frontend", "src", "components", "race", "StagePlanModel.ts"), "utf8");
  const match = model.match(/export const FINAL_KM_BOUNDARY_7383_ACTIVE\s*=\s*(true|false)\s*;/);
  assert.ok(match, "StagePlanModel.ts skal have sin kopi af kontakten");
  assert.equal(match![1] === "true", FINAL_KM_BOUNDARY_7383_ACTIVE);
});

test("#7383: kun s5_profiles_v3 og kun med kontakten taendt", () => {
  withSwitch(true, () => {
    assert.equal(isFinalKmBoundary7383On("s5_profiles_v3"), true);
    for (const revision of [null, "legacy", "s5_profiles_v1", "s5_profiles_v2", "official_times_v3"]) {
      assert.equal(isFinalKmBoundary7383On(revision), false, String(revision));
    }
  });
});

test("#7383: slukket er ruten det samme objekt og ingen deling (alle fixtures x revisioner)", () => withSwitch(false, () => {
  for (const name of readdirSync(FIXTURES).sort()) {
    for (const revision of REVISIONS) {
      const route = stageInputForRulesRevision(fixture(name, revision)).route;
      const looped = routeWithFinalKmBoundary7383(route, revision);
      assert.equal(looped, route, `${name} ${revision}`);
      assert.equal(looped.segments, route.segments);
      for (const s of looped.segments) assert.equal(finalKmTerrainPiece7383(s), undefined);
    }
  }
}));

test("#7383: med kontakten taendt er aeldre revisioner bit-identiske med slukket", () => {
  for (const name of ["flat-massespurt", "bjerg-selektion", "mellembjerg"]) {
    for (const revision of [null, "s5_profiles_v1", "s5_profiles_v2"]) {
      const input = fixture(name, revision);
      input.orders = [finalKmPlan(input)];
      const off = simulateStageV4(input);
      const on = withSwitch(true, () => simulateStageV4(input));
      assert.deepEqual(on, off, `${name} ${revision}`);
    }
  }
});

test("#7383: fladt/rullende deles praecis 10 km fra maal; inputtet muteres ikke", () => {
  const segments = [seg.flat(0, 100), seg.flat(100, 150)];
  const frozen = JSON.stringify(segments);
  const out = splitAtFinalKm7383(segments, 150);
  assert.equal(JSON.stringify(segments), frozen);
  assert.deepEqual(out.map((s) => [s.kind, s.from_km, s.to_km]), [["flat", 0, 100], ["flat", 100, 140], ["flat", 140, 150]]);
  for (const s of out) assert.equal(finalKmTerrainPiece7383(s), undefined, "fladt er almindelige stykker");
  assert.equal(STAGE_PLAN_FINAL_KM, 10);
});

test("#7383: en eksisterende graense genbruges, og en kort etape roeres ikke", () => {
  const onPoint = [seg.flat(0, 140), seg.flat(140, 150)];
  assert.equal(splitAtFinalKm7383(onPoint, 150), onPoint);
  const nearPoint = [seg.flat(0, 140.004), seg.flat(140.004, 150)];
  assert.equal(splitAtFinalKm7383(nearPoint, 150), nearPoint);
  const short = [seg.flat(0, 9)];
  assert.equal(splitAtFinalKm7383(short, 9), short);
});

test("#7383: en stigning deles med samme stejlhed, men er EEN stigning", () => {
  const climb = seg.climb(130, 150);
  const out = splitAtFinalKm7383([seg.flat(0, 130), climb], 150);
  assert.equal(out.length, 3);
  const [, head, tail] = out;
  assert.deepEqual([head.from_km, head.to_km, tail.from_km, tail.to_km], [130, 140, 140, 150]);
  assert.deepEqual({ ...head, to_km: 0 }, { ...climb, to_km: 0 }, "samme kategori og stejlhed");
  assert.deepEqual({ ...tail, from_km: 0 }, { ...climb, from_km: 0 });
  assert.deepEqual(finalKmTerrainPiece7383(head), { part: "head", whole: climb, headLonger: false }, "lige lange dele: halen vinder");
  assert.equal(finalKmTerrainPiece7383(tail)?.part, "tail");
  const long = seg.climb(120, 150);
  assert.equal(finalKmTerrainPiece7383(splitAtFinalKm7383([seg.flat(0, 120), long], 150)[1])?.headLonger, true);
});

test("#7383: en brostenssektor deles med samme sektor; en nedkoersel deles ikke", () => {
  const sector = seg.cobbles(135, 145);
  const withSector = splitAtFinalKm7383([seg.flat(0, 135), sector, seg.flat(145, 150)], 150);
  assert.equal(withSector.length, 4);
  assert.deepEqual([withSector[1], withSector[2]].map((s) => finalKmTerrainPiece7383(s)?.whole), [sector, sector]);
  assert.deepEqual([withSector[1], withSector[2]].map((s) => ({ ...s, from_km: 0, to_km: 0 })), [{ ...sector, from_km: 0, to_km: 0 }, { ...sector, from_km: 0, to_km: 0 }]);
  const descentFinish = [seg.flat(0, 120), seg.climb(120, 135), seg.descent(135, 150)];
  assert.equal(splitAtFinalKm7383(descentFinish, 150), descentFinish);
});

test("#7383: etapeplanens skift ved de sidste 10 km sker praecis paa graensen for alle opgaver", () => {
  for (const name of ["flat-massespurt", "mellembjerg", "bjerg-selektion"]) {
    const input = fixture(name, "s5_profiles_v3");
    input.orders = [finalKmPlan(input)];
    const finalKm = Math.round((input.route.distance_km - STAGE_PLAN_FINAL_KM) * 100) / 100;
    const out = withSwitch(true, () => simulateStageV4(input));
    const events = legEvents(out.timeline.events);
    const finished = new Set(out.results.filter((r) => r.status === "finished").map((r) => r.rider_id));
    const planned = input.startlist.filter((e) => e.team_id === "T0" && finished.has(e.rider_id));
    assert.ok(planned.length > 0, name);
    for (const rider of planned) {
      const own = events.filter((e) => e.params.rider_id === rider.rider_id);
      assert.equal(own.length, 1, `${name} ${rider.rider_id}: eet skift`);
      assert.equal(own[0].km, finalKm, `${name} ${rider.rider_id}: paa graensen`);
      assert.equal(own[0].params.reason, "final_km");
      assert.equal(own[0].params.at_finish, undefined, `${name}: ingen finaleundtagelse`);
    }
    assert.deepEqual(validateTimelineEvents(out.timeline.events, { distanceKm: input.route.distance_km, knownRiderIds: new Set(input.startlist.map((e) => e.rider_id)) }), [], name);
  }
});

test("#7383: slukket gaelder #7333-reglen uaendret (naermeste eksisterende graense, ikke punktet)", () => {
  const input = fixture("flat-massespurt", "s5_profiles_v3");
  input.orders = [finalKmPlan(input)];
  const finalKm = input.route.distance_km - STAGE_PLAN_FINAL_KM;
  const events = legEvents(withSwitch(false, () => simulateStageV4(input)).timeline.events);
  assert.ok(events.length > 0);
  const boundaries = new Set(input.route.segments.map((s) => s.from_km));
  for (const e of events) {
    assert.notEqual(e.km, finalKm, "punktet ligger midt i et segment");
    assert.ok(boundaries.has(e.km) || e.params.at_finish === true, "skiftet sker ved en eksisterende graense eller i finalen");
  }
});

test("#7383: en delt slutstigning er een selektion paa hele stigningen med indsatsen fra den laengste del", () => {
  const input = fixture("bjerg-selektion", "s5_profiles_v3");
  const captain = input.startlist.find((e) => e.team_id === "T0" && e.role === "captain")!;
  input.orders = [planOrder("T0", [{ rider_id: captain.rider_id, legs: [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }] }])];
  const route = stageInputForRulesRevision(input).route;
  const finalClimb = route.segments[route.segments.length - 1];
  const finalKm = route.distance_km - STAGE_PLAN_FINAL_KM;
  assert.equal(finalClimb.kind, "climb");
  assert.ok(finalKm - finalClimb.from_km > finalClimb.to_km - finalKm, "fixturen: 10 km-punktet paa stigningens anden halvdel");

  const run = (active: boolean) => {
    const seen: Array<{ index: number; from: number; to: number; effort: string | undefined }> = [];
    const spy: ClimbSelectionHook = (state, ctx) => {
      seen.push({ index: ctx.segmentIndex, from: ctx.segment.from_km, to: ctx.segment.to_km, effort: ctx.entrants[captain.rider_id]?.effort });
      return LIVE_MECHANIC_HOOKS.climbSelection(state, ctx);
    };
    const hooks: MechanicHooks = { ...LIVE_MECHANIC_HOOKS, climbSelection: spy };
    const result = withSwitch(active, () => runSegmentLoop(stageInputForRulesRevision(input), hooks));
    return { seen, result, komPassages: result.timeline.filter((e) => e.type === "kom_passage").map((e) => [e.km, e.params.name]) };
  };
  const off = run(false);
  const on = run(true);
  assert.deepEqual(on.seen.map((s) => [s.from, s.to]), off.seen.map((s) => [s.from, s.to]), "samme stigninger, hver een gang, hele laengden");
  assert.equal(on.seen[on.seen.length - 1].index, off.seen[off.seen.length - 1].index + 1, "selektionen sker ved halen (toppen)");
  assert.deepEqual(on.komPassages, off.komPassages, "samme bjergtoppe og bjergpoint");
  assert.equal(on.seen[on.seen.length - 1].effort, "save", "Codex-review: angrebet paa de sidste 10 km giver ikke angrebets indsats paa hele stigningen");
  const leg = on.result.timeline.find((e) => e.type === STAGE_PLAN_LEG_EVENT && e.params.rider_id === captain.rider_id);
  assert.equal(leg?.km, Math.round(finalKm * 100) / 100, "men tempoet skifter praecis ved 10 km");
});

/**
 * Et fixture-felt paa en egen rute (s5_profiles_v3), evt. med en anden seed. `strongAttacker`:
 * mur-finale-feltet med en kaptajn der er klart staerkest paa angrebets evner og paa
 * brosten (som s5Profiles6363.test.ts), saa det sene angreb faktisk sker.
 */
function routeInput(segments: Segment[], seedSuffix = "", strongAttacker = false): StageInput {
  const input = fixture(strongAttacker ? "mur-finale" : "flat-massespurt", "s5_profiles_v3");
  const distance = segments[segments.length - 1].to_km;
  input.route = { ...input.route, distance_km: distance, segments, waypoints: [{ kind: "finish", index: 0, name: "Maal", km: distance }] as StageInput["route"]["waypoints"] };
  if (seedSuffix) input.seed = `${input.seed}-${seedSuffix}`;
  if (strongAttacker) input.startlist = input.startlist.map((e) => e.rider_id !== "r05" ? e : { ...e, abilities: { ...e.abilities, aggression: 92, tempo: 90, endurance: 92, tactics: 88, cobblestone: 95 } });
  return input;
}

test("#7383: det sene angreb ser de to stykker som eet og vaelger segment som paa den udelte rute", () => {
  const D = 150;
  const cases: Array<{ name: string; segments: Segment[] }> = [
    { name: "sektor fra 20 til 3 km fra maal (udelt: intet angreb)", segments: [seg.flat(0, 130), seg.cobbles(130, 147), seg.flat(147, 150)] },
    { name: "stigning fra 20 til 3 km fra maal (udelt: intet angreb)", segments: [seg.flat(0, 130), seg.climb(130, 147), seg.flat(147, 150)] },
    { name: "sidste segment krydser punktet (udelt: intet angreb)", segments: [seg.flat(0, 120), seg.flat(120, 150)] },
    { name: "det delte stykke er selv angrebs-segmentet", segments: [seg.flat(0, 136), seg.cobbles(136, 144), seg.flat(144, 150)] },
    { name: "angrebs-segmentet ligger foer det delte stykke", segments: [seg.flat(0, 138), seg.flat(138, 150)] },
    { name: "angrebs-segmentet ligger efter det delte stykke", segments: [seg.flat(0, 138), seg.climb(138, 142), seg.flat(142, 144), seg.flat(144, 150)] },
  ];
  for (const { name, segments } of cases) {
    assert.equal(finalKmUndivided7383(segments), null, `${name}: udelt (og slukket) er intet delt stykke`);
    const undividedIndex = lateAttackSegmentIndex({ distance_km: D, segments });
    const split = splitAtFinalKm7383(segments, D) as Segment[];
    assert.notEqual(split, segments, `${name}: ruten deles`);
    assert.deepEqual(finalKmUndivided7383(split), { segments, headIndex: split.findIndex((s) => s.to_km === D - STAGE_PLAN_FINAL_KM) }, name);
    const index = lateAttackSegmentIndex({ distance_km: D, segments: split });
    if (undividedIndex < 0) {
      assert.equal(index, -1, `${name}: graensen giver intet nyt angreb`);
    } else {
      assert.equal(split[index].to_km, segments[undividedIndex].to_km, `${name}: samme sted som udelt`);
      assert.notEqual(finalKmTerrainPiece7383(split[index])?.part, "head", `${name}: aldrig midt i stykket`);
    }
  }
  // Fundet (review 30/10): uden kendskab til delingen ville hovedet blive angrebs-segmentet.
  const blind = splitAtFinalKm7383(cases[0].segments, D).map((s) => ({ ...s })) as Segment[];
  assert.equal(blind[lateAttackSegmentIndex({ distance_km: D, segments: blind })]?.to_km, D - STAGE_PLAN_FINAL_KM);
});

test("#7383: tidligere stigninger taelles paa den udelte stigning (Codex-review)", () => {
  const D = 150;
  for (const segments of [
    [seg.flat(0, 100), seg.climb(100, 110), seg.flat(110, 130), seg.climb(130, 149.8), seg.flat(149.8, 150)],
    [seg.flat(0, 100), seg.climb(100, 110), seg.flat(110, 130), seg.climb(130, 145), seg.flat(145, 150)],
    [seg.flat(0, 100), seg.climb(100, 110), seg.flat(110, 135), seg.climb(135, 150)],
  ]) {
    const split = splitAtFinalKm7383(segments, D) as Segment[];
    assert.notEqual(split, segments);
    assert.equal(priorCategorizedClimbs({ distance_km: D, segments: split }), priorCategorizedClimbs({ distance_km: D, segments }), JSON.stringify(segments.map((s) => [s.kind, s.to_km])));
  }
});

test("#7383: med kontakten taendt giver 10 km-graensen intet nyt sent angreb og flytter det ikke", () => {
  const lateAttackKms = (input: StageInput): number[] => simulateStageV4(input).timeline.events
    .filter((e) => e.type === "finale_attack" && e.params.kind === "late_attack").map((e) => e.km);
  let attacksOnSector = 0;
  for (let k = 0; k < 12; k++) {
    const noWindow = routeInput([seg.flat(0, 130), seg.cobbles(130, 147), seg.flat(147, 150)], `p2-${k}`, true);
    assert.deepEqual(lateAttackKms(noWindow), [], `slukket ${k}`);
    assert.deepEqual(withSwitch(true, () => lateAttackKms(noWindow)), [], `taendt ${k}: intet angreb midt i sektoren`);
    const sector = routeInput([seg.flat(0, 136), seg.cobbles(136, 144), seg.flat(144, 150)], `tail-${k}`, true);
    for (const km of withSwitch(true, () => lateAttackKms(sector))) {
      assert.equal(km, 144, `taendt ${k}: angrebet ved sektorens slutning som udelt`);
      attacksOnSector++;
    }
  }
  assert.ok(attacksOnSector > 0, "testen ser mindst eet sent angreb paa sektoren");
});

test("#7383: en delt brostenssektor er een selektion ved halen paa hele sektoren med indsatsen fra den laengste del", () => {
  const cases = [
    { name: "hovedet laengst", segments: [seg.flat(0, 134), seg.cobbles(134, 144), seg.flat(144, 150)], headLonger: true },
    { name: "halen laengst", segments: [seg.flat(0, 137), seg.cobbles(137, 145), seg.flat(145, 150)], headLonger: false },
  ];
  for (const { name, segments, headLonger } of cases) {
    const input = routeInput(segments);
    const rider = input.startlist.find((e) => e.team_id === "T0" && e.role === "sprint_captain")!;
    input.orders = [planOrder("T0", [{ rider_id: rider.rider_id, legs: [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }] }])];
    const split = splitAtFinalKm7383(stageInputForRulesRevision(input).route.segments, 150);
    assert.equal(split.map((s) => finalKmTerrainPiece7383(s)).find(Boolean)?.headLonger, headLonger, `${name}: fixturen`);
    const run = (active: boolean) => {
      const seen: Array<{ index: number; from: number; to: number; effort: string | undefined }> = [];
      const spy: CobblesHook = (state, ctx) => {
        seen.push({ index: ctx.segmentIndex, from: ctx.segment.from_km, to: ctx.segment.to_km, effort: ctx.entrants[rider.rider_id]?.effort });
        return LIVE_MECHANIC_HOOKS.cobbles!(state, ctx);
      };
      withSwitch(active, () => runSegmentLoop(stageInputForRulesRevision(input), { ...LIVE_MECHANIC_HOOKS, cobbles: spy }));
      return seen;
    };
    const off = run(false);
    const on = run(true);
    assert.equal(off.length, 1, `${name}: udelt een selektion`);
    assert.deepEqual(on.map((s) => [s.from, s.to]), off.map((s) => [s.from, s.to]), `${name}: een selektion paa hele sektoren`);
    assert.equal(on[0].index, off[0].index + 1, `${name}: ved halen (sektorens slutning)`);
    assert.equal(on[0].effort, headLonger ? TASK_EFFORT.stay_sheltered : TASK_EFFORT.attack, `${name}: indsatsen fra den laengste del`);
  }
});
