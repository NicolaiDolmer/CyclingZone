// backend/lib/engine/v4/timeline.test.ts
// Race Engine v4 F2 (#4030), Fase B4: kontrakt-tests for timeline.ts.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §6-7.
// Fog-gate-moenstret er kopieret fra backend/lib/raceTimeline.test.js (§2 invariant 5).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { TimelineEvent } from "./types.ts";
import {
  assertValidTimeline,
  breakawayCaughtEvent,
  breakawayFormedEvent,
  breakawaySurvivedEvent,
  favoriteCrackEvent,
  finaleAttackEvent,
  finishEvent,
  gapUpdateEvent,
  gcChangeEvent,
  groupMergedEvent,
  incidentEvent,
  intermediateSprintEvent,
  komPassageEvent,
  makeEvent,
  pelotonSplitsEvent,
  round2,
  sortTimeline,
  sprintDecidedEvent,
  stageStartEvent,
  validateGroupMembership,
  validateTimelineEvents,
} from "./timeline.ts";

// ── km-afrunding + makeEvent ──────────────────────────────────────────────────

test("round2: runder til 2 decimaler", () => {
  assert.equal(round2(12.3456), 12.35);
  assert.equal(round2(0), 0);
  assert.equal(round2(100), 100);
});

test("makeEvent: km rundes til 2 decimaler, form er {km, type, params}", () => {
  const e = makeEvent(45.678912, "finale_attack", { rider_id: "r1" });
  assert.deepEqual(e, { km: 45.68, type: "finale_attack", params: { rider_id: "r1" } });
});

// ── Builder-funktioner: param-shape matcher raceTimeline.js 1:1 (hvor v4 ikke
// bevidst afviger, jf. afvigelses-noten i timeline.ts) ────────────────────────

test("stageStartEvent: field_count/profile_type/distance_km", () => {
  const e = stageStartEvent(0, { fieldCount: 5, profileType: "mountain", distanceKm: 160 });
  assert.deepEqual(e, {
    km: 0,
    type: "stage_start",
    params: { field_count: 5, profile_type: "mountain", distance_km: 160 },
  });
});

test("breakawayFormedEvent: klippes til max 3 rider_ids (v3-praecedent)", () => {
  const e = breakawayFormedEvent(20, ["a", "b", "c", "d"]);
  assert.deepEqual(e.params, { rider_ids: ["a", "b", "c"] });
});

test("gapUpdateEvent: {group_id, gap_seconds} — matcher segmentLoop.ts's shippede shape", () => {
  const e = gapUpdateEvent(30, { groupId: "g1", gapSeconds: 12.345 });
  assert.deepEqual(e.params, { group_id: "g1", gap_seconds: 12.35 });
});

test("komPassageEvent + intermediateSprintEvent: name/category/top", () => {
  const kom = komPassageEvent(50, { name: "Col A", category: "1", top: [{ rider_id: "a", points: 10 }] });
  assert.deepEqual(kom.params, { name: "Col A", category: "1", top: [{ rider_id: "a", points: 10 }] });

  const sprint = intermediateSprintEvent(60, {
    name: "Sprint 1",
    top: [{ rider_id: "b", points: 5, bonus_seconds: 2 }],
  });
  assert.deepEqual(sprint.params, { name: "Sprint 1", top: [{ rider_id: "b", points: 5, bonus_seconds: 2 }] });
});

test("breakawayCaughtEvent + breakawaySurvivedEvent", () => {
  const caught = breakawayCaughtEvent(80, ["a", "b"]);
  assert.deepEqual(caught.params, { rider_ids: ["a", "b"] });

  const survived = breakawaySurvivedEvent(160, { riderIds: ["a"], finalGap: 42.6 });
  assert.deepEqual(survived.params, { rider_ids: ["a"], final_gap: 43 });
});

test("pelotonSplitsEvent: v4-native {group_id, kind, rider_ids, reason}", () => {
  const e = pelotonSplitsEvent(90, { groupId: "chase-1", kind: "chase", riderIds: ["c", "d"], reason: "climb_selection" });
  assert.deepEqual(e.params, { group_id: "chase-1", kind: "chase", rider_ids: ["c", "d"], reason: "climb_selection" });
});

test("incidentEvent + favoriteCrackEvent + finaleAttackEvent", () => {
  const inc = incidentEvent(75, { riderId: "e", kind: "crash", outcome: "time_loss", timeLossSeconds: 12 });
  assert.deepEqual(inc.params, { rider_id: "e", kind: "crash", outcome: "time_loss", time_loss_seconds: 12 });

  const crack = favoriteCrackEvent(140, { riderId: "f", reason: "jour_sans" });
  assert.deepEqual(crack.params, { rider_id: "f", reason: "jour_sans" });

  const attack = finaleAttackEvent(155, "g");
  assert.deepEqual(attack.params, { rider_id: "g" });
});

// ── incidentEvent: valgfrit cause-argument (#4950) ────────────────────────────

test("incidentEvent: cause udelades naar ikke angivet (bit-identisk med foer #4950)", () => {
  const inc = incidentEvent(75, { riderId: "e", kind: "crash", outcome: "time_loss", timeLossSeconds: 12 });
  assert.ok(!("cause" in inc.params), "ingen cause-argument => ingen cause-noegle i params");
});

test("incidentEvent: cause-argumentet saettes ordret i params naar angivet", () => {
  const inc = incidentEvent(75, {
    riderId: "e",
    kind: "crash",
    outcome: "time_loss",
    timeLossSeconds: 12,
    cause: "descent_attack",
  });
  assert.equal(inc.params.cause, "descent_attack");
});

test("sprintDecidedEvent + finishEvent + gcChangeEvent", () => {
  const sprint = sprintDecidedEvent(180, { riderIds: ["a", "b"], photoFinish: true });
  assert.deepEqual(sprint.params, { rider_ids: ["a", "b"], photo_finish: true });

  const finish = finishEvent(180, { top: [{ rider_id: "a", rank: 1, gap: 0 }], winType: "sprint_win" });
  assert.deepEqual(finish.params, { top: [{ rider_id: "a", rank: 1, gap: 0 }], win_type: "sprint_win" });

  const gc = gcChangeEvent(180, { newLeaderId: "a", previousLeaderId: "d" });
  assert.deepEqual(gc.params, { new_leader_id: "a", previous_leader_id: "d" });
});

// ── sortTimeline ───────────────────────────────────────────────────────────────

test("sortTimeline: stabil sortering paa km, bevarer insertion-orden ved lige km", () => {
  const events: TimelineEvent[] = [
    makeEvent(50, "kom_passage", { seq: 1 }),
    makeEvent(0, "stage_start", { seq: 2 }),
    makeEvent(50, "gap_update", { seq: 3 }),
    makeEvent(180, "finish", { seq: 4 }),
  ];
  const sorted = sortTimeline(events);
  assert.deepEqual(
    sorted.map((e) => e.params.seq),
    [2, 1, 3, 4],
  );
  // Ren funktion — input uaendret.
  assert.equal(events[0].params.seq, 1);
});

// ── validateTimelineEvents / assertValidTimeline — #2410 §2.3 regel 3/4/5 ──────

test("validateTimelineEvents: rent (sorteret, in-range, kendte ryttere, ingen fog-gate) giver ingen brud", () => {
  const events = sortTimeline([
    stageStartEvent(0, { fieldCount: 2, profileType: "flat", distanceKm: 100 }),
    finaleAttackEvent(97, "a"),
    finishEvent(100, { top: [{ rider_id: "a", rank: 1, gap: 0 }, { rider_id: "b", rank: 2, gap: 3 }], winType: "solo_win" }),
  ]);
  const violations = validateTimelineEvents(events, { distanceKm: 100, knownRiderIds: new Set(["a", "b"]) });
  assert.deepEqual(violations, []);
  assert.doesNotThrow(() => assertValidTimeline(events, { distanceKm: 100, knownRiderIds: new Set(["a", "b"]) }));
});

test("validateTimelineEvents regel 4 (km-range): km > distance_km flages", () => {
  const events = [makeEvent(150, "finish", { top: [], win_type: "solo_win" })];
  const violations = validateTimelineEvents(events, { distanceKm: 100, knownRiderIds: new Set() });
  assert.ok(violations.some((v) => v.rule === "km-range"));
});

test("validateTimelineEvents regel 4 (km-monotonic): faldende km flages", () => {
  const events = [makeEvent(50, "kom_passage", {}), makeEvent(20, "gap_update", { group_id: "g", gap_seconds: 1 })];
  const violations = validateTimelineEvents(events, { distanceKm: 100, knownRiderIds: new Set() });
  assert.ok(violations.some((v) => v.rule === "km-monotonic"));
});

test("validateTimelineEvents regel 3 (unknown-rider): rider_id udenfor det kendte felt flages, i alle param-former", () => {
  const events = [
    finaleAttackEvent(50, "ghost"),
    breakawayFormedEvent(10, ["ghost2"]),
    finishEvent(100, { top: [{ rider_id: "ghost3", rank: 1, gap: 0 }], winType: "solo_win" }),
    gcChangeEvent(100, { newLeaderId: "ghost4", previousLeaderId: "a" }),
  ];
  const violations = validateTimelineEvents(events, { distanceKm: 100, knownRiderIds: new Set(["a"]) });
  const flaggedRuleCount = violations.filter((v) => v.rule === "unknown-rider").length;
  assert.equal(flaggedRuleCount, 4);
});

test("validateTimelineEvents: incident-cause — tom/ikke-streng cause paa et incident-event flages (#4950)", () => {
  const events = [
    makeEvent(10, "incident", { rider_id: "a", kind: "crash", outcome: "time_loss", time_loss_seconds: 5, cause: "" }),
    makeEvent(20, "incident", { rider_id: "a", kind: "crash", outcome: "time_loss", time_loss_seconds: 5, cause: 7 }),
    incidentEvent(30, { riderId: "a", kind: "crash", outcome: "time_loss", timeLossSeconds: 5, cause: "descent_attack" }),
    incidentEvent(40, { riderId: "a", kind: "crash", outcome: "time_loss", timeLossSeconds: 5 }),
  ];
  const violations = validateTimelineEvents(events, { distanceKm: 100, knownRiderIds: new Set(["a"]) });
  const causeViolations = violations.filter((v) => v.rule === "incident-cause");
  assert.equal(causeViolations.length, 2, "kun de to ugyldige cause-vaerdier skal flages");
});

test("assertValidTimeline: kaster med samlet fejlbesked ved brud", () => {
  const events = [makeEvent(500, "finale_attack", { rider_id: "ghost" })];
  assert.throws(
    () => assertValidTimeline(events, { distanceKm: 100, knownRiderIds: new Set() }),
    /timeline-konsistensbrud.*km-range.*unknown-rider|timeline-konsistensbrud/,
  );
});

// ── Fog-gate (#1791, konsistensregel 5) — moenster kopieret fra
// raceTimeline.test.js's "fog-gate: ingen event-params indeholder noegler fra
// components-settet" ────────────────────────────────────────────────────────

test("fog-gate: builder-output for en realistisk fuld tidslinje indeholder ingen fog-gated noegler", () => {
  const events = sortTimeline([
    stageStartEvent(0, { fieldCount: 6, profileType: "mountain", distanceKm: 160 }),
    breakawayFormedEvent(15, ["a", "b"]),
    gapUpdateEvent(40, { groupId: "breakaway-1", gapSeconds: 90 }),
    komPassageEvent(70, { name: "Col A", category: "1", top: [{ rider_id: "a", points: 10 }] }),
    pelotonSplitsEvent(90, { groupId: "chase-1", kind: "chase", riderIds: ["c", "d"], reason: "climb_selection" }),
    incidentEvent(120, { riderId: "e", kind: "crash", outcome: "time_loss", timeLossSeconds: 20 }),
    favoriteCrackEvent(140, { riderId: "f", reason: "jour_sans" }),
    breakawayCaughtEvent(150, ["a", "b"]),
    finaleAttackEvent(155, "c"),
    finishEvent(160, { top: [{ rider_id: "c", rank: 1, gap: 0 }, { rider_id: "d", rank: 2, gap: 8 }], winType: "solo_win" }),
    gcChangeEvent(160, { newLeaderId: "c", previousLeaderId: "d" }),
  ]);
  const violations = validateTimelineEvents(events, {
    distanceKm: 160,
    knownRiderIds: new Set(["a", "b", "c", "d", "e", "f"]),
  });
  const fogGateViolations = violations.filter((v) => v.rule === "fog-gate");
  assert.deepEqual(fogGateViolations, [], `uventede fog-gate-brud: ${JSON.stringify(fogGateViolations)}`);
});

test("fog-gate: raa fysiologi-/selektions-noegler i params flages (negativ-kontrol, laaser detektionen)", () => {
  const leaking: TimelineEvent[] = [
    makeEvent(10, "peloton_splits", { group_id: "g1", kind: "chase", rider_ids: ["a"], wprime: 0.4 }),
    makeEvent(20, "finale_attack", { rider_id: "b", dayform: 0.02 }),
    makeEvent(30, "gap_update", { group_id: "g2", gap_seconds: 5, collectiveCp: 0.7 }),
  ];
  const violations = validateTimelineEvents(leaking, { distanceKm: 100, knownRiderIds: new Set(["a", "b"]) });
  const fogGateKeys = violations.filter((v) => v.rule === "fog-gate").length;
  assert.equal(fogGateKeys, 3);
});

// ── group-membership: event vs. snapshot (#4971) ─────────────────────────────
// Negativ-kontrollen er den EGENTLIGE regressionstest: den gengiver den
// praecise form CodeRabbit fandt paa PR #4971 i golden fixture bjerg-selektion
// — et `peloton_splits` der flytter r04/r05 til `chase-1000` ved km 65, mens
// snapshottet ved km 65 stadig har dem i `peloton-0`. Foer fixet (segmentLoop
// emitterede intet naar merge-trinnet foldede gruppen tilbage) var det
// motorens faktiske output.

test("#4971 group-membership: et split der ikke naar segment-state flages (negativ-kontrol)", () => {
  const events: TimelineEvent[] = [
    makeEvent(45, "breakaway_formed", { group_id: "breakaway-0", rider_ids: ["r02", "r04", "r05"] }),
    makeEvent(65, "peloton_splits", {
      group_id: "chase-1000",
      source_group_id: "breakaway-0",
      rider_ids: ["r04", "r05"],
      cause: "mixed",
      gap_seconds: 81.82,
    }),
  ];
  const snapshots = [
    { km: 45, groups: [
      { group_id: "breakaway-0", rider_ids: ["r02", "r04", "r05"] },
      { group_id: "peloton-0", rider_ids: ["r01", "r03"] },
    ] },
    { km: 65, groups: [
      { group_id: "breakaway-0", rider_ids: ["r02"] },
      { group_id: "peloton-0", rider_ids: ["r01", "r03", "r04", "r05"] },
    ] },
  ];
  const violations = validateGroupMembership(events, snapshots);
  assert.equal(violations.length, 2, `forventede 2 brud (r04+r05), fik ${JSON.stringify(violations)}`);
  for (const v of violations) assert.equal(v.rule, "group-membership");
  assert.ok(
    violations.every((v) => v.message.includes("chase-1000") && v.message.includes("peloton-0")),
    "bruddet skal navngive BAADE eventets gruppe og snapshottets gruppe",
  );
});

test("#4971 group-membership: samme split PLUS group_merged er konsistent (positiv-kontrol)", () => {
  const events: TimelineEvent[] = [
    makeEvent(45, "breakaway_formed", { group_id: "breakaway-0", rider_ids: ["r02", "r04", "r05"] }),
    makeEvent(65, "peloton_splits", {
      group_id: "chase-1000",
      source_group_id: "breakaway-0",
      rider_ids: ["r04", "r05"],
      cause: "mixed",
      gap_seconds: 81.82,
    }),
    groupMergedEvent(65, { groupId: "chase-1000", intoGroupId: "peloton-0", riderIds: ["r04", "r05"] }),
  ];
  const snapshots = [
    { km: 65, groups: [
      { group_id: "breakaway-0", rider_ids: ["r02"] },
      { group_id: "peloton-0", rider_ids: ["r01", "r03", "r04", "r05"] },
    ] },
  ];
  assert.deepEqual(validateGroupMembership(events, snapshots), []);
});

test("#4971 group-membership: senere, legitim omgruppering uden rytter-navne er ikke et brud", () => {
  // M4's placerings-tiers paa maalstregen navngiver ikke ryttere — kun naeste
  // snapshot efter et event tjekkes, saa finalen giver ingen falske brud.
  const events: TimelineEvent[] = [
    makeEvent(40, "breakaway_formed", { group_id: "breakaway-0", rider_ids: ["r01"] }),
    makeEvent(70, "finale_attack", { kind: "placement_gap", group_id: "finale-winner-0", gap_seconds: 3 }),
  ];
  const snapshots = [
    { km: 40, groups: [{ group_id: "breakaway-0", rider_ids: ["r01"] }, { group_id: "peloton-0", rider_ids: ["r02"] }] },
    { km: 70, groups: [{ group_id: "finale-winner-0", rider_ids: ["r01"] }, { group_id: "finale-tier-1", rider_ids: ["r02"] }] },
  ];
  assert.deepEqual(validateGroupMembership(events, snapshots), []);
});

test("#4971 group-membership: en rytter der forsvinder fra snapshottet (DNF/OTL) er ikke et brud", () => {
  const events: TimelineEvent[] = [makeEvent(20, "peloton_splits", { group_id: "chase-1", rider_ids: ["r09"] })];
  const snapshots = [{ km: 20, groups: [{ group_id: "peloton-0", rider_ids: ["r01"] }] }];
  assert.deepEqual(validateGroupMembership(events, snapshots), []);
});

test("#4971 groupMergedEvent: param-form + fog-gate-renhed", () => {
  const event = groupMergedEvent(65.004, { groupId: "chase-1000", intoGroupId: "peloton-0", riderIds: ["r04", "r05"] });
  assert.deepEqual(event, {
    km: 65,
    type: "group_merged",
    params: { group_id: "chase-1000", into_group_id: "peloton-0", rider_ids: ["r04", "r05"] },
  });
  const violations = validateTimelineEvents([event], { distanceKm: 100, knownRiderIds: new Set(["r04", "r05"]) });
  assert.deepEqual(violations, [], `group_merged maa ikke bryde nogen konsistensregel: ${JSON.stringify(violations)}`);
});

// ── #4993: incident-undtagelsen er for BRED — den undskylder ALT for en ────
// rytter der havde ET ELLER ANDET uheld i vinduet, ogsaa naar det uheld ALDRIG
// flyttede ham (outcome "protected_three_km_rule", jf. incidents.ts's egen
// gren: KUN "time_loss"/"abandoned" kalder splitGroup). Det er for bredt: en
// helt UBESLAEGTET gruppeskifte-konflikt for samme rytter bliver ogsaa tavst
// undskyldt. Undtagelsen skal kun daekke uheld der FAKTISK kan have flyttet
// rytteren (samme afgraensning som incidents.ts's `resolved.outcome !==
// "protected_three_km_rule"`-gren).

test("#4993 group-membership: et protected_three_km_rule-uheld (INGEN gruppeskift) undskylder IKKE en ubeslaegtet konflikt (negativ-kontrol)", () => {
  const events: TimelineEvent[] = [
    makeEvent(90, "peloton_splits", { group_id: "chase-2000", rider_ids: ["r07"] }),
    incidentEvent(95, { riderId: "r07", kind: "crash", outcome: "protected_three_km_rule", timeLossSeconds: null }),
  ];
  const snapshots = [{ km: 100, groups: [{ group_id: "peloton-0", rider_ids: ["r07"] }] }];
  const violations = validateGroupMembership(events, snapshots);
  assert.equal(
    violations.length,
    1,
    "protected_three_km_rule flytter INGEN gruppe (incidents.ts) — undtagelsen maa ikke daekke en anden konflikt",
  );
  assert.equal(violations[0].rule, "group-membership");
});

test("#4993 group-membership: M10 traekker en rytter ud EFTER M2s split (outcome time_loss) er stadig undtaget (positiv-kontrol)", () => {
  const events: TimelineEvent[] = [
    makeEvent(65, "peloton_splits", { group_id: "chase-1000", rider_ids: ["r04"] }),
    // Incidentens km kan vaere LAVERE end splittets (M10 kaldes efter M2 i
    // segmentLoop.ts, men incidentens km-maerke er et tilfaeldigt punkt inde i
    // SAMME segment, ikke segmentets slut, hvor peloton_splits stemples).
    incidentEvent(64, { riderId: "r04", kind: "crash", outcome: "time_loss", timeLossSeconds: 8 }),
  ];
  const snapshots = [{ km: 65, groups: [{ group_id: "solo-1005", rider_ids: ["r04"] }] }];
  assert.deepEqual(validateGroupMembership(events, snapshots), []);
});

test("#4993 group-membership: M10s 'abandoned'-udfald er ogsaa undtaget (positiv-kontrol)", () => {
  const events: TimelineEvent[] = [
    makeEvent(65, "peloton_splits", { group_id: "chase-1000", rider_ids: ["r04"] }),
    incidentEvent(63, { riderId: "r04", kind: "crash", outcome: "abandoned", timeLossSeconds: null, severity: "serious" }),
  ];
  const snapshots = [{ km: 65, groups: [{ group_id: "peloton-0", rider_ids: ["r99"] }] }];
  assert.deepEqual(validateGroupMembership(events, snapshots), []);
});
