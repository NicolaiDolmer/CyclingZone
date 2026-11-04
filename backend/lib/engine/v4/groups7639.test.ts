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

function hooksCrashingOn(segmentIndex: number): MechanicHooks {
  return {
    ...LIVE_MECHANIC_HOOKS,
    incidents: (state, ctx) => (ctx.segmentIndex === segmentIndex ? riggedIncident(state, ctx) : { state, events: [] }),
  };
}

function loadInput(fixture: string): StageInput {
  const input = JSON.parse(readFileSync(path.join(here, "fixtures", fixture, "input.json"), "utf8")) as StageInput;
  return { ...input, rulesRevision: "s5_profiles_v3" };
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

// Frosset fra merge-base be8ea8a6f (se filhovedet). base_ghost_events = antal
// spoegelses-events den gamle kode emitterede (beviser at scenariet rammer fejlen).
const FROZEN = [
  { fixture: "mellembjerg", crashSegment: 3, baseGhostEvents: 5,
    state: "3a89fed860993cbabaaa1f16031ef8995dc9b25ea97f49ccb33873b268c15c7e",
    timeline: "c7ce35a4fefcd0b675a0b0e9de9b1364b6c35933c2ee836c5231912db18752f9" },
  { fixture: "flat-massespurt", crashSegment: 1, baseGhostEvents: 3,
    state: "a3a762c8506d9b64599f3a3e504fd2d362ecf55fd2aeb897fedd116ea4db248e",
    timeline: "5fb0f844a7bf0c7fc313ca9439c81567d06ef315dfbeda3ea5afef2161604e31" },
  { fixture: "bjerg-selektion", crashSegment: 3, baseGhostEvents: 1,
    state: "f909c6d33d67e6f2b364973abe6fc9cff10f80b375762d86076ff4e41a81af94",
    timeline: "f174735ef1549b2f4d5b601183846a238b0812c909d9082d76a8d9d7861c4176" },
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
    assert.equal(sha(out.timeline), frozen.timeline, "tidslinjen = base-tidslinjen minus spoegelses-events");
  });
}

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
