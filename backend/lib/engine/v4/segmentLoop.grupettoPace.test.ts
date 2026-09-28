// backend/lib/engine/v4/segmentLoop.grupettoPace.test.ts
// #5581: koblingen af tidsgraense-gulvet (mechanics/grupettoPace.ts) til
// grupperne i segment-loopet (applyGrupettoPaceFloor). Selve reglen er testet
// i mechanics/grupettoPace.test.ts; her laases HVILKE grupper der roeres, og
// hvem der saa koerer forrest.

import { test } from "node:test";
import assert from "node:assert/strict";

import { applyGrupettoPaceFloor, groupDtSeconds, groupEffortTempo } from "./segmentLoop.ts";
import type { GroupTempo, GrupettoPaceFloorInput } from "./segmentLoop.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { EffortLevel, RaceGroup, RiderState, Segment } from "./types.ts";

const SEGMENT: Segment = { kind: "climb", from_km: 100, to_km: 110 } as Segment;
const REFERENCE_CP = 0.5;

function riderState(id: string, groupId: string, wprime = 1): RiderState {
  return {
    rider_id: id,
    group_id: groupId,
    cp: 0.5,
    wprimeMax: 1,
    wprime,
    dayform: 0,
    seconds_over_cp: 0,
    work_norm: 0,
    incidents: 0,
    status: "racing",
    time_seconds: 0,
  } as RiderState;
}

/** Tempoet PRAECIS som computeGroupTempo regner det, for givne CP'er og indsatsvalg. */
function tempoFor(cps: Record<string, number>, efforts: Record<string, EffortLevel>): GroupTempo {
  const cpByRider = new Map(Object.entries(cps));
  const t = groupEffortTempo(cpByRider, (id) => efforts[id], RACE_V4_TUNING.work.frontFraction);
  const dtSeconds = groupDtSeconds(t.collectiveCp, SEGMENT, RACE_V4_TUNING, cpByRider.size, REFERENCE_CP, t.effortTempoFactor);
  return { ...t, cpByRider, dtSeconds };
}

type Scenario = {
  groups: RaceGroup[];
  cps: Record<string, number>;
  efforts: Record<string, EffortLevel>;
  wprime?: Record<string, number>;
};

function inputFor(s: Scenario): GrupettoPaceFloorInput {
  const tempoByGroup = new Map<string, GroupTempo>();
  const riders: Record<string, RiderState> = {};
  for (const g of s.groups) {
    const cps = Object.fromEntries(g.rider_ids.map((id) => [id, s.cps[id]]));
    tempoByGroup.set(g.id, tempoFor(cps, s.efforts));
    for (const id of g.rider_ids) riders[id] = riderState(id, g.id, s.wprime?.[id] ?? 1);
  }
  return {
    groups: s.groups,
    tempoByGroup,
    riders,
    effortByRider: (id) => s.efforts[id],
    segment: SEGMENT,
    tuning: RACE_V4_TUNING,
    referenceCp: REFERENCE_CP,
    frontElapsedSeconds: 10000,
    nominalElapsedSeconds: 11000,
    nominalTotalSeconds: 14000,
    limitFactor: 0.15,
  };
}

const FAR_GAP = 1900;
const FRONT_IDS = Array.from({ length: 10 }, (_, i) => `f${i}`);
const front = (): RaceGroup => ({ id: "peloton-0", kind: "peloton", rider_ids: [...FRONT_IDS], gap_seconds: 0, cohesion: 1 });
const baseCps = (): Record<string, number> => Object.fromEntries(FRONT_IDS.map((id) => [id, 0.5]));
const baseEfforts = (): Record<string, EffortLevel> => Object.fromEntries(FRONT_IDS.map((id) => [id, "normal" as EffortLevel]));

test("uden grupetto-ryttere er alle tempi uroerte (samme objekter)", () => {
  const input = inputFor({
    groups: [front(), { id: "chase-1", kind: "chase", rider_ids: ["w1"], gap_seconds: 1500, cohesion: 1 }],
    cps: { ...baseCps(), w1: 0.2 },
    efforts: { ...baseEfforts(), w1: "normal" },
  });
  const out = applyGrupettoPaceFloor(input);
  for (const [id, tempo] of input.tempoByGroup) assert.equal(out.get(id), tempo, id);
});

test("ren grupetto-gruppe der ligger til at ryge ud: tempoet haeves, aldrig over fuld CP og aldrig foran fronten", () => {
  const input = inputFor({
    // Hullet er valgt saa graensen er naesten brugt op: resten af budgettet er
    // mindre end grupetto-tempoets tab paa stigningen.
    groups: [front(), { id: "solo-g", kind: "solo", rider_ids: ["g1"], gap_seconds: FAR_GAP, cohesion: 1 }],
    cps: { ...baseCps(), g1: 0.55 },
    efforts: { ...baseEfforts(), g1: "grupetto" },
  });
  const before = input.tempoByGroup.get("solo-g")!;
  const after = applyGrupettoPaceFloor(input).get("solo-g")!;
  assert.ok(after.dtSeconds < before.dtSeconds, "grupettoen skal koere hurtigere naar graensen trues");
  assert.ok(after.effortTempoFactor > before.effortTempoFactor && after.effortTempoFactor <= 1);
  assert.ok(after.dtSeconds >= input.tempoByGroup.get("peloton-0")!.dtSeconds - 1e-9, "aldrig hurtigere end fronten");
  assert.equal(input.tempoByGroup.get("peloton-0"), applyGrupettoPaceFloor(input).get("peloton-0"), "fronten roeres aldrig");
});

test("ren grupetto-gruppe taet paa fronten: uaendret (grupetto er stadig langsommere end feltet)", () => {
  const input = inputFor({
    groups: [front(), { id: "solo-g", kind: "solo", rider_ids: ["g1"], gap_seconds: 20, cohesion: 1 }],
    cps: { ...baseCps(), g1: 0.55 },
    efforts: { ...baseEfforts(), g1: "grupetto" },
  });
  const out = applyGrupettoPaceFloor(input);
  assert.equal(out.get("solo-g"), input.tempoByGroup.get("solo-g"));
  assert.ok(out.get("solo-g")!.dtSeconds > out.get("peloton-0")!.dtSeconds, "grupetto-tempoet er langsommere end fronten");
});

test("uden reserve kan han ikke holde gulvet og ryger stadig ud", () => {
  const input = inputFor({
    groups: [front(), { id: "solo-g", kind: "solo", rider_ids: ["g1"], gap_seconds: FAR_GAP, cohesion: 1 }],
    cps: { ...baseCps(), g1: 0.55 },
    efforts: { ...baseEfforts(), g1: "grupetto" },
    wprime: { g1: 0 },
  });
  assert.equal(applyGrupettoPaceFloor(input).get("solo-g"), input.tempoByGroup.get("solo-g"));
});

test("blandet gruppe der er for langsom: grupetto-rytteren gaar selv frem, de koerende sidder paa hans hjul", () => {
  const input = inputFor({
    groups: [front(), { id: "chase-1", kind: "chase", rider_ids: ["g1", "w1"], gap_seconds: 1500, cohesion: 1 }],
    cps: { ...baseCps(), g1: 0.55, w1: 0.2 },
    efforts: { ...baseEfforts(), g1: "grupetto", w1: "normal" },
  });
  const before = input.tempoByGroup.get("chase-1")!;
  assert.deepEqual([...before.frontRiderIds], ["w1"], "foer: den svage koerende saetter tempoet");
  const after = applyGrupettoPaceFloor(input).get("chase-1")!;
  assert.deepEqual([...after.frontRiderIds], ["g1"]);
  assert.ok(after.dtSeconds < before.dtSeconds);
  assert.ok(after.effortTempoFactor <= 1);
});

test("blandet gruppe hvor de koerende er hurtige nok: uroert (grupetto sidder paa hjul)", () => {
  const input = inputFor({
    groups: [front(), { id: "chase-1", kind: "chase", rider_ids: ["g1", "r1"], gap_seconds: 20, cohesion: 1 }],
    cps: { ...baseCps(), g1: 0.55, r1: 0.5 },
    efforts: { ...baseEfforts(), g1: "grupetto", r1: "normal" },
  });
  assert.equal(applyGrupettoPaceFloor(input).get("chase-1"), input.tempoByGroup.get("chase-1"));
});
