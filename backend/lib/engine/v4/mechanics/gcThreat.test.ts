// backend/lib/engine/v4/mechanics/gcThreat.test.ts
// #5978 (#5984 Task 4): GC-truslen mod et holds klassementsrytter. Syntetiske
// ryttere og klassementer; testene laaser strukturelle invarianter (hvem er en
// trussel, eksplicitte tilstande), ikke kalibrerede tal.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessGcThreat,
  GC_THREAT_TUNING,
  normalizeGcContext,
  protectedRiderForTeam,
  remainingTerrainKm,
} from "./gcThreat.ts";
import type { AbilityKey, Entrant, GcContext, RaceGroup, RouteV2 } from "../types.ts";

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
function abilities(level: number): Record<AbilityKey, number> {
  return Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>;
}
function entrant(id: string, team: string, level = 60, role: Entrant["role"] = "helper"): Entrant {
  return { rider_id: id, abilities: abilities(level), role, effort: "normal", condition: 1, team_id: team };
}

const FLAT: RouteV2 = {
  distance_km: 150, profile_type: "flat", finale_type: "bunch_sprint",
  segments: [{ kind: "flat", from_km: 0, to_km: 150 }],
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};
const MOUNTAIN: RouteV2 = {
  distance_km: 150, profile_type: "mountain", finale_type: "long_climb",
  segments: [
    { kind: "flat", from_km: 0, to_km: 100 },
    { kind: "climb", from_km: 100, to_km: 150, category: "HC", avg_gradient: 7, top_elevation_m: 2000 },
  ],
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};

const ENTRANTS: Record<string, Entrant> = {
  lead: entrant("lead", "A", 75, "captain"),
  aHelp: entrant("aHelp", "A", 55),
  rival: entrant("rival", "B", 76, "captain"),
  weak: entrant("weak", "C", 40, "hunter"),
  far: entrant("far", "D", 75, "hunter"),
  bCap: entrant("bCap", "E", 70, "captain"),
};

function standings(rows: Array<[string, number]>): GcContext {
  return {
    status: "standings", stage_number: 5, leader_id: rows[0][0],
    standings: rows.map(([rider_id, gap_seconds], i) => ({ rider_id, rank: i + 1, gap_seconds })),
  };
}
const GC = standings([["lead", 0], ["rival", 30], ["bCap", 60], ["far", 1800], ["weak", 2400], ["aHelp", 3000]]);

function groups(breakaway: string[], breakawayLead: number, peloton: string[]): RaceGroup[] {
  return [
    { id: "breakaway-0", kind: "breakaway", rider_ids: breakaway, gap_seconds: 0, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: peloton, gap_seconds: breakawayLead, cohesion: 1 },
  ];
}

const assess = (over: Partial<Parameters<typeof assessGcThreat>[0]>) =>
  assessGcThreat({ gcContext: GC, groups: [], entrants: ENTRANTS, route: FLAT, protectedRiderId: "lead", km: 100, ...over });

test("real leader: a strong rival up the road who would take the jersey is serious", () => {
  const t = assess({ groups: groups(["rival"], 60, ["lead", "aHelp", "weak", "far", "bCap"]) });
  assert.equal(t.severity, "serious");
  assert.equal(t.reason, "leader_at_risk");
  assert.deepEqual(t.threat_rider_ids, ["rival"]);
  assert.equal(t.protected_rider_id, "lead");
  assert.equal(t.chase_group_id, "peloton-0");
});

test("nearby strong rival: close but not yet past is moderate, and grows with the gap", () => {
  // bCap staar 60 s efter; et lille forspring holder ham bag GC-rytteren.
  const near = assess({ groups: groups(["bCap"], 20, ["lead", "aHelp", "rival", "weak", "far"]), km: 149 });
  assert.equal(near.severity, "moderate");
  assert.equal(near.reason, "rival_close");
  const past = assess({ groups: groups(["bCap"], 90, ["lead", "aHelp", "rival", "weak", "far"]), km: 149 });
  assert.equal(past.severity, "serious");
});

test("harmless rider far down GC is not a threat", () => {
  const t = assess({ groups: groups(["far"], 300, ["lead", "aHelp", "rival", "weak", "bCap"]) });
  assert.equal(t.severity, "none");
  assert.equal(t.reason, "harmless");
  assert.deepEqual(t.threat_rider_ids, []);
});

test("transient virtual lead by a weak rider is not a GC threat for a non-leader", () => {
  // Holdet E's GC-rytter (bCap, 60 s) mod en svag rytter der virtuelt er foran.
  const gc = standings([["lead", 0], ["bCap", 60], ["weak", 70], ["rival", 80], ["far", 1800], ["aHelp", 3000]]);
  const t = assess({ gcContext: gc, protectedRiderId: "bCap", groups: groups(["weak"], 200, ["lead", "aHelp", "rival", "far", "bCap"]) });
  assert.equal(t.severity, "none");
  assert.equal(t.reason, "transient_only");
  // ...men for foereren er troejen paa spil: moderat.
  const leaderView = assess({ gcContext: standings([["lead", 0], ["weak", 10], ["rival", 80], ["bCap", 90], ["far", 1800], ["aHelp", 3000]]), groups: groups(["weak"], 200, ["lead", "aHelp", "rival", "far", "bCap"]) });
  assert.equal(leaderView.severity, "moderate");
  assert.equal(leaderView.reason, "leader_jersey_at_risk");
});

test("remaining terrain matters: the same gap is a bigger threat with a climb still to come for a stronger rider", () => {
  const strongRival: Record<string, Entrant> = { ...ENTRANTS, rival: entrant("rival", "B", 90, "captain") };
  const g = groups(["rival"], 10, ["lead", "aHelp", "weak", "far", "bCap"]);
  const beforeClimb = assess({ entrants: strongRival, route: MOUNTAIN, km: 95, groups: g });
  const afterClimb = assess({ entrants: strongRival, route: MOUNTAIN, km: 150, groups: g });
  assert.equal(beforeClimb.severity, "serious");
  assert.notEqual(afterClimb.severity, "serious");
  const terrain = remainingTerrainKm(MOUNTAIN, 95);
  assert.equal(terrain.climbKm, 50);
  assert.equal(terrain.openKm, 5);
});

test("gap changes: a shrinking lead contains the threat", () => {
  const big = assess({ groups: groups(["rival"], 120, ["lead", "aHelp", "weak", "far", "bCap"]), km: 149 });
  const small = assess({ groups: groups(["rival"], 0.5, ["lead", "aHelp", "weak", "far", "bCap"]), km: 149 });
  assert.equal(big.severity, "serious");
  assert.notEqual(small.severity, "serious");
});

test("rider in another group: a protected rider dropped behind the chasing group cannot be protected", () => {
  const g: RaceGroup[] = [
    { id: "breakaway-0", kind: "breakaway", rider_ids: ["rival"], gap_seconds: 0, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: ["aHelp", "weak", "far", "bCap"], gap_seconds: 60, cohesion: 1 },
    { id: "chase-1", kind: "chase", rider_ids: ["lead"], gap_seconds: 120, cohesion: 1 },
  ];
  const t = assess({ groups: g, chasingGroupIds: new Set(["peloton-0"]) });
  assert.equal(t.severity, "none");
  assert.equal(t.reason, "protected_in_other_group");
  assert.equal(t.chase_group_id, "chase-1");
});

test("protected rider in the breakaway himself has nothing to chase", () => {
  const t = assess({ groups: groups(["lead", "weak"], 60, ["aHelp", "rival", "far", "bCap"]) });
  assert.equal(t.severity, "none");
  assert.equal(t.reason, "protected_ahead");
});

test("explicit states: missing, one-day and first stage never produce a threat", () => {
  const g = groups(["rival"], 600, ["lead", "aHelp", "weak", "far", "bCap"]);
  assert.equal(assess({ gcContext: null, groups: g }).reason, "no_context");
  assert.equal(assess({ gcContext: { status: "missing" }, groups: g }).reason, "no_context");
  assert.equal(assess({ gcContext: { status: "one_day" }, groups: g }).reason, "one_day");
  assert.equal(assess({ gcContext: { status: "first_stage", stage_number: 1 }, groups: g }).reason, "first_stage");
  for (const ctx of [null, { status: "missing" as const }, { status: "one_day" as const }, { status: "first_stage" as const, stage_number: 1 }]) {
    assert.equal(assess({ gcContext: ctx, groups: g }).severity, "none");
  }
});

test("a rider without a published standing is never treated as a zero-gap leader", () => {
  const entrants = { ...ENTRANTS, ghost: entrant("ghost", "F", 90, "captain") };
  const t = assess({ entrants, groups: groups(["ghost"], 600, ["lead", "aHelp", "rival", "weak", "far", "bCap"]) });
  assert.equal(t.severity, "none");
  assert.equal(t.reason, "no_classified_rider_ahead");
});

test("ties are explicit: an equal-time strong rival ahead is a threat and is flagged as tied", () => {
  const tied = standings([["lead", 0], ["rival", 0], ["bCap", 0], ["far", 0], ["weak", 0], ["aHelp", 0]]);
  const t = assess({ gcContext: tied, groups: groups(["rival"], 30, ["lead", "aHelp", "weak", "far", "bCap"]) });
  assert.equal(t.severity, "serious");
  assert.equal(t.tied, true);
  const harmless = assess({ gcContext: tied, protectedRiderId: "rival", groups: groups(["weak"], 30, ["lead", "aHelp", "rival", "far", "bCap"]) });
  assert.equal(harmless.severity, "none");
});

test("no GC interest: a team whose best rider is far down does not defend GC", () => {
  const gc = standings([
    ["lead", 0], ["rival", 30], ...Array.from({ length: GC_THREAT_TUNING.protectRankLimit }, (_, i) => [`x${i}`, 40 + i] as [string, number]),
    ["far", 1800], ["bCap", 1900], ["weak", 2400], ["aHelp", 3000],
  ]);
  const t = assess({ gcContext: gc, protectedRiderId: "far", groups: groups(["rival"], 60, ["lead", "aHelp", "weak", "far", "bCap"]) });
  assert.equal(t.reason, "no_gc_interest");
  assert.equal(t.severity, "none");
});

test("normalizeGcContext: invalid input is missing, never an empty standings list", () => {
  assert.deepEqual(normalizeGcContext(undefined), { status: "missing" });
  assert.deepEqual(normalizeGcContext({ status: "standings", stage_number: 3, standings: [] }), { status: "missing", stage_number: 3 });
  assert.deepEqual(normalizeGcContext({ status: "nope" }), { status: "missing" });
  assert.deepEqual(normalizeGcContext({ status: "first_stage" }), { status: "missing" });
  const n = normalizeGcContext({
    status: "standings", stage_number: 2, leader_id: "zzz",
    standings: [{ rider_id: "b", rank: 2, gap_seconds: 5 }, { rider_id: "a", rank: 1, gap_seconds: 0 }, { rider_id: "bad", rank: 3, gap_seconds: -1 }, { rider_id: "a", rank: 4, gap_seconds: 9 }],
  });
  assert.equal(n.status, "standings");
  if (n.status !== "standings") return;
  assert.deepEqual(n.standings.map((s) => s.rider_id), ["a", "b"]);
  assert.equal(n.leader_id, "a", "an unknown leader id falls back to the best standing");
});

test("protectedRiderForTeam picks the team's best placed starter", () => {
  assert.equal(protectedRiderForTeam({ gcContext: GC, teamId: "A", entrants: ENTRANTS }), "lead");
  assert.equal(protectedRiderForTeam({ gcContext: GC, teamId: "Z", entrants: ENTRANTS }), null);
  assert.equal(protectedRiderForTeam({ gcContext: { status: "one_day" }, teamId: "A", entrants: ENTRANTS }), null);
});

test("purity: inputs are not mutated and results are deterministic", () => {
  const g = groups(["rival", "weak"], 60, ["lead", "aHelp", "far", "bCap"]);
  const snapshot = JSON.stringify({ g, GC, ENTRANTS });
  const a = assess({ groups: g });
  const b = assess({ groups: g });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify({ g, GC, ENTRANTS }), snapshot);
});

test("#5955: early on a long stage the open-terrain projection is capped, so a rival minutes down is not serious yet", () => {
  const lead = 10;
  const deficit = GC_THREAT_TUNING.potentialOpenCapSeconds + GC_THREAT_TUNING.moderateWindowSeconds / 2 + lead;
  assert.ok(FLAT.distance_km * GC_THREAT_TUNING.potentialSecondsPerOpenKm > deficit, "uncapped, this rider would project past the leader");
  const gc = standings([["lead", 0], ["rival", deficit], ["bCap", deficit + 30], ["far", 1800], ["weak", 2400], ["aHelp", 3000]]);
  const early = assess({ gcContext: gc, km: 0, groups: groups(["rival"], lead, ["lead", "aHelp", "weak", "far", "bCap"]) });
  assert.equal(early.severity, "moderate");
  assert.equal(early.reason, "rival_close");
  // Har han faktisk taget tiden paa vejen, er han stadig en alvorlig trussel.
  const real = assess({ gcContext: gc, km: 0, groups: groups(["rival"], deficit, ["lead", "aHelp", "weak", "far", "bCap"]) });
  assert.equal(real.severity, "serious");
});
