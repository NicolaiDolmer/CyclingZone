// #7639: en udgaaet rytter forlader loebsfilmens tidslinje ved udgangen.
//
// Fundet 4/11 (Giro della Penisola etape 6): en rytter styrtede og udgik, men
// hans solo-gruppe blev ved med at optraede i `gap_update` til maal, over en
// time bagud (M10 parkerer en udgaaet rytter langt bag feltet, saa han aldrig
// merges ind igen). Rettelsen er KUN tidslinjen: gruppen bliver i motorens
// state og snapshots, og alle tider er uaendrede.
//
// Frossen golden (#7587): digests herunder er genereret af merge-base-koden
// be8ea8a6f (FOER rettelsen) med samme riggede scenarie; base-tidslinjen er
// filtreret for spoegelses-events. Den nye kode skal give praecis samme state
// og praecis den filtrerede tidslinje. Generer dem ALDRIG igen med den nye kode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isRetiredGroup } from "./groups.ts";
import { LIVE_MECHANIC_HOOKS } from "./index.ts";
import { createIncidentHook, makeIncidentSoloGroupId } from "./mechanics/incidents.ts";
import { runSegmentLoop } from "./segmentLoop.ts";
import { INCIDENTS_EXTRA_TUNING } from "./tuning.ts";
import type { MechanicHooks, StageInput, TimelineEvent } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

// Rig: praecis ét alvorligt styrt (udgaaelse) paa et valgt segment.
const riggedIncident = createIncidentHook({
  ...INCIDENTS_EXTRA_TUNING,
  baseRiskPerSegment: { flat: 1, rolling: 1, climb: 1, descent: 1, cobbles: 1 },
  positioningDampening: 0,
  referenceSegmentKm: 0.01,
  maxIncidentsFieldShare: 0.001,
  mechanicalShare: 0,
  crashSeverityShares: { hard: 0, serious: 1 },
});

// v3's terraen-andel for udgaaelse (#6938) ville ellers overstyre riggens trin,
// saa KUN uheldshooket ser konteksten uden v3-flaget; resten af etapen er v3.
function hooksCrashingOn(segmentIndex: number): MechanicHooks {
  return {
    ...LIVE_MECHANIC_HOOKS,
    incidents: (state, ctx) =>
      ctx.segmentIndex === segmentIndex ? riggedIncident(state, { ...ctx, s5ProfilesV3: undefined }) : { state, events: [] },
  };
}

function loadInput(fixture: string, revision: "s5_profiles_v3" | "s5_profiles_v2" = "s5_profiles_v3"): StageInput {
  const input = JSON.parse(readFileSync(path.join(here, "fixtures", fixture, "input.json"), "utf8")) as StageInput;
  return { ...input, rules_revision: revision };
}

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const GROUP_KEYS = ["group_id", "into_group_id", "chase_group_id", "source_group_id"] as const;

/** Events EFTER udgangen der tegner ham som en gruppe/rytter i loebet. */
function ghostRefs(timeline: readonly TimelineEvent[], incidentIndex: number, ghostId: string, victim: string): TimelineEvent[] {
  return timeline.filter((e, i) => {
    if (i <= incidentIndex) return false;
    const p = e.params ?? {};
    if (GROUP_KEYS.some((k) => p[k] === ghostId)) return true;
    return Array.isArray(p.rider_ids) && p.rider_ids.includes(victim);
  });
}

// Frosset fra merge-base be8ea8a6f (se filhovedet). baseGhostEvents = antal
// spoegelses-events den gamle kode emitterede (beviser at scenariet rammer fejlen).
// `timeline` er digesten af base-tidslinjen MINUS spoegelses-events.
//
// flat-massespurt: dagens udbryder holdt hele vejen. Den gamle kode lod
// spoegelset "overleve et hul" i finalen og skjulte dermed finale-eventet om at
// udbruddet bar forspringet i maal. Det event er nu tilbage (`restored`), og
// det er den eneste tilfoejelse; alt andet er base minus spoegelset.
const FROZEN = [
  { fixture: "mellembjerg", crashSegment: 3, baseGhostEvents: 6, restored: null,
    state: "2bc69ca2a53eb0bc0349ee92de4639985f1de9c95967b30e9528583e2ef0be53",
    timeline: "7617d8a29384f766a778117097999fd5540eb0d17968fffcba4f0341ae09aa06" },
  { fixture: "flat-massespurt", crashSegment: 1, baseGhostEvents: 4, restored: "carried_gap_held",
    state: "a0ddf30aa3e3b0cac907e6eab345e6e07f08b45f665b0d15b10a58b9be36b5cf",
    timeline: "17a4bb72c69793129bd25cf67805934ea25cbe63db62f8c34ef8a2d0308f9b74" },
  { fixture: "bjerg-selektion", crashSegment: 3, baseGhostEvents: 2, restored: null,
    state: "9429f3518ef3e36ec713bf04204da6eef77ac0cd3ceeb874f3c79d8107fc0209",
    timeline: "b8d119994a873adf5d57049d7e8d45370a962d05dc177bedb3cc616449a3d8f1" },
] as const;

for (const frozen of FROZEN) {
  test(`#7639 ${frozen.fixture}: udgaaet rytter forsvinder fra tidslinjen, alt andet bit-identisk med merge-base`, () => {
    const out = runSegmentLoop(loadInput(frozen.fixture), hooksCrashingOn(frozen.crashSegment));
    const incidentIndex = out.timeline.findIndex((e) => e.type === "incident" && e.params?.outcome === "abandoned");
    assert.ok(incidentIndex >= 0, "riggen skal give praecis en udgaaelse");
    const victim = out.timeline[incidentIndex].params!.rider_id as string;
    const ghostId = makeIncidentSoloGroupId(frozen.crashSegment, 0);

    // Motoren er uroert: han er udgaaet og parkeret i sin egen gruppe i state.
    assert.equal(out.state.riders[victim].status, "abandoned");
    assert.ok(out.state.groups.some((g) => g.id === ghostId && isRetiredGroup(g, out.state.riders)));

    // Tidslinjen naevner ham ikke efter udgangen.
    assert.deepEqual(ghostRefs(out.timeline, incidentIndex, ghostId, victim), []);
    assert.ok(frozen.baseGhostEvents > 0);

    // Alt andet er bit-identisk med den frosne base.
    assert.equal(
      sha({ riders: out.state.riders, groups: out.state.groups, incidents: out.state.stage_incidents, snapshots: out.groupSnapshots }),
      frozen.state,
      "state/snapshots skal vaere bit-identiske med merge-base",
    );
    const isRestored = (e: TimelineEvent): boolean =>
      frozen.restored !== null && e.type === "finale_attack" && e.params?.kind === frozen.restored;
    if (frozen.restored !== null) {
      const restored = out.timeline.filter(isRestored);
      assert.equal(restored.length, 1, "finale-eventet om det baarne forspring er tilbage");
      assert.ok(!(restored[0].params!.rider_ids as string[]).includes(victim));
    }
    assert.equal(sha(out.timeline.filter((e) => !isRestored(e))), frozen.timeline, "tidslinjen = base-tidslinjen minus spoegelses-events");
  });
}

test("#7639: aeldre revisioner er frosne og beholder deres tidslinje (rettelsen gaelder kun s5_profiles_v3)", () => {
  const out = runSegmentLoop(loadInput("mellembjerg", "s5_profiles_v2"), hooksCrashingOn(3));
  const incidentIndex = out.timeline.findIndex((e) => e.type === "incident" && e.params?.outcome === "abandoned");
  assert.ok(incidentIndex >= 0);
  const victim = out.timeline[incidentIndex].params!.rider_id as string;
  assert.ok(ghostRefs(out.timeline, incidentIndex, makeIncidentSoloGroupId(3, 0), victim).length > 0);
});

test("#7639 isRetiredGroup: kun en gruppe af udelukkende udgaaede ryttere", () => {
  const riders = {
    a: { status: "abandoned" as const },
    b: { status: "abandoned" as const },
    c: { status: "racing" as const },
    d: { status: "finished" as const },
  };
  assert.equal(isRetiredGroup({ rider_ids: ["a"] }, riders), true);
  assert.equal(isRetiredGroup({ rider_ids: ["a", "b"] }, riders), true);
  assert.equal(isRetiredGroup({ rider_ids: ["a", "c"] }, riders), false, "en blandet gruppe er stadig i loebet");
  assert.equal(isRetiredGroup({ rider_ids: ["d"] }, riders), false, "en rytter i maal er ikke udgaaet");
  assert.equal(isRetiredGroup({ rider_ids: ["unknown"] }, riders), false, "ukendt rytter skjules aldrig");
  assert.equal(isRetiredGroup({ rider_ids: [] }, riders), false);
});
