import test from "node:test";
import assert from "node:assert/strict";
import { participationForResult, historyForStage, participationFlagsForResult, breakawayMarkerState, withFinishSafetyNet } from "./raceParticipationMarkers.ts";
import { PENISOLA_STAGE3_EVENTS, PENISOLA_STAGE3_RANKS, PENISOLA_DROPPED, PENISOLA_CAUGHT } from "../../../backend/lib/raceParticipationHistory.fixtures.ts";
const timeline = { timeline_version: 2, stage_number: 6, events: [
  { km: 0, type: "stage_start", params: { field_count: 3 } },
  { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["morning"] } },
  { km: 75, type: "finale_attack", params: { direction: "descent", group_id: "later", rider_ids: ["attacker"] } },
  { km: 96, type: "breakaway_caught", params: { group_id: "escape", rider_ids: ["morning"] } },
  { km: 100, type: "finish", params: { top: [{ rider_id: "attacker", rank: 1 }] } },
] };

test("historical broad flags are corrected by the same event projection as the runner", () => {
  const history = historyForStage(timeline, 6, ["morning", "attacker", "passive"]);
  assert.deepEqual(participationForResult({ rider_id: "attacker", in_breakaway: true }, history), { morning: false, caught: false, survived: false, dropped: false, laterAttack: true, verified: true });
  assert.deepEqual(participationForResult({ rider_id: "morning", in_breakaway: true }, history), { morning: true, caught: true, survived: false, dropped: false, laterAttack: false, verified: true });
  assert.equal(participationForResult({ rider_id: "passive", in_breakaway: true }, history)?.morning, false);
});

test("another stage's timeline cannot overwrite a result's stored marker", () => {
  const history = historyForStage(timeline, 5, ["morning"]);
  assert.equal(history, null);
  assert.equal(participationForResult({ rider_id: "old", in_breakaway: true, breakaway_caught: true }, history)?.caught, true);
});

test("missing timeline retains the legacy marker without inventing a later attack", () => {
  assert.equal(participationForResult({ rider_id: "old", in_breakaway: true }, null)?.laterAttack, false);
  assert.equal(participationForResult({ rider_id: null }, null), null);
});

test("legacy v1 sampled names cannot erase other stored morning flags", () => {
  const history = historyForStage({ ...timeline, timeline_version: 1 }, 6, ["morning", "fourth"]);
  assert.equal(history, null);
  assert.equal(participationForResult({ rider_id: "fourth", in_breakaway: true }, history)?.morning, true);
});
test("view flags preserve an unknown native outcome instead of claiming survival", () => {
  const history = historyForStage({ ...timeline, events: timeline.events.filter(event => event.type !== "breakaway_caught") }, 6, ["morning", "attacker"]);
  assert.ok(history);
  assert.deepEqual(participationFlagsForResult({ rider_id: "morning", in_breakaway: true, breakaway_caught: false }, history), { in_breakaway: true, breakaway_caught: null, breakaway_dropped: false });
});

// ── #6185: "Dropped from the break" is its own marker ───────────────────────
const penisola = { timeline_version: 2, stage_number: 3, events: PENISOLA_STAGE3_EVENTS };
const penisolaIds = Object.keys(PENISOLA_STAGE3_RANKS);

test("#6185 anchor: Penisola stage 3 dropped escapees get the dropped marker, never 'held home'", () => {
  const history = historyForStage(penisola, 3, penisolaIds);
  assert.ok(history);
  for (const id of PENISOLA_DROPPED) {
    // The stored row said "not caught" (= held home) before the fix.
    const participation = participationForResult({ rider_id: id, in_breakaway: true, breakaway_caught: false }, history);
    assert.equal(participation?.dropped, true, id);
    assert.equal(participation?.survived, false, id);
    assert.deepEqual(breakawayMarkerState(participation!), { labelKey: "detail.breakaway.dropped", muted: true, icon: "dropped", tone: "danger" });
    assert.deepEqual(participationFlagsForResult({ rider_id: id, in_breakaway: true, breakaway_caught: false }, history!), { in_breakaway: true, breakaway_caught: null, breakaway_dropped: true });
  }
  for (const id of PENISOLA_CAUGHT) {
    const participation = participationForResult({ rider_id: id, in_breakaway: true, breakaway_caught: true }, history);
    assert.deepEqual(breakawayMarkerState(participation!), { labelKey: "detail.breakaway.caught", muted: true, icon: "flag", tone: "muted" });
  }
});

test("#6185 without a timeline a persisted dropped flag still wins over 'held home'", () => {
  const legacyDropped = participationForResult({ rider_id: "e4", in_breakaway: true, breakaway_caught: false, breakaway_dropped: true }, null);
  assert.deepEqual(legacyDropped, { morning: true, caught: false, survived: false, dropped: true, laterAttack: false, verified: false });
  assert.equal(breakawayMarkerState(legacyDropped!).labelKey, "detail.breakaway.dropped");
  // Not yet assessed (NULL) keeps today's legacy reading.
  const unknown = participationForResult({ rider_id: "x", in_breakaway: true, breakaway_caught: false, breakaway_dropped: null }, null);
  assert.deepEqual(breakawayMarkerState(unknown!), { labelKey: "detail.breakaway.survived", muted: false, icon: "flag", tone: "accent" });
  // A caught row is never relabelled as dropped.
  const caught = participationForResult({ rider_id: "y", in_breakaway: true, breakaway_caught: true, breakaway_dropped: true }, null);
  assert.equal(breakawayMarkerState(caught!).labelKey, "detail.breakaway.caught");
});

test("#6185 a persisted dropped flag (finish safety net) also applies on top of the timeline", () => {
  const history = historyForStage({ ...timeline, events: timeline.events.filter(event => event.type !== "breakaway_caught") }, 6, ["morning", "attacker"]);
  const participation = participationForResult({ rider_id: "morning", in_breakaway: true, breakaway_caught: false, breakaway_dropped: true }, history);
  assert.equal(participation?.dropped, true);
  assert.equal(breakawayMarkerState(participation!).labelKey, "detail.breakaway.dropped");
});

test("#6185 timeline 'survived' + finish safety net reads as caught, same as the backend", () => {
  const survivedTimeline = { ...timeline, events: [
    ...timeline.events.filter(event => event.type !== "breakaway_caught" && event.type !== "finish"),
    { km: 100, type: "breakaway_survived", params: { group_id: "escape", rider_ids: ["morning"] } },
    { km: 100, type: "finish", params: { top: [{ rider_id: "attacker", rank: 1 }] } },
  ] };
  const history = historyForStage(survivedTimeline, 6, ["morning", "attacker", "passive"]);
  assert.ok(history);
  assert.equal(history.riders.get("morning")?.survived, true);
  // After the backfill / engine net: breakaway_caught=true, breakaway_dropped=false.
  const backfilled = participationForResult({ rider_id: "morning", in_breakaway: true, breakaway_caught: true, breakaway_dropped: false }, history);
  assert.equal(breakawayMarkerState(backfilled!).labelKey, "detail.breakaway.caught");
  assert.deepEqual(participationFlagsForResult({ rider_id: "morning", in_breakaway: true, breakaway_caught: true, breakaway_dropped: false }, history), { in_breakaway: true, breakaway_caught: true, breakaway_dropped: false });
  // Before the backfill: the frontend net flags the row dropped; with the timeline it agrees with the backend (caught).
  const [netted] = withFinishSafetyNet([
    { result_type: "stage", stage_number: 6, rank: 2, rider_id: "morning", in_breakaway: true, breakaway_caught: false },
    { result_type: "stage", stage_number: 6, rank: 1, rider_id: "attacker", in_breakaway: false, breakaway_caught: false },
  ]);
  assert.equal(netted.breakaway_dropped, true);
  assert.equal(breakawayMarkerState(participationForResult(netted, history)!).labelKey, "detail.breakaway.caught");
  // No non-escapee ahead: the engine's verdict stands.
  const held = participationForResult({ rider_id: "morning", in_breakaway: true, breakaway_caught: false, breakaway_dropped: false }, history);
  assert.deepEqual(breakawayMarkerState(held!), { labelKey: "detail.breakaway.survived", muted: false, icon: "flag", tone: "accent" });
});

test("#6185 the dropped marker has EN and DA copy", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const [lang, text] of [["en", "dropped from the break"], ["da", "sat af fra udbruddet"]]) {
    const races = JSON.parse(await readFile(new URL(`../../public/locales/${lang}/races.json`, import.meta.url), "utf8"));
    assert.equal(races.detail.breakaway.dropped, text, lang);
  }
});

test("#6185 finish safety net on stored rows: uncaught escapee behind a non-escapee reads as dropped", () => {
  const rows = Object.entries(PENISOLA_STAGE3_RANKS).map(([id, rank]) => ({ result_type: "stage", stage_number: 3, rank, rider_id: id, in_breakaway: id.startsWith("e"), breakaway_caught: id === "e3" || id === "e6" }));
  const netted = withFinishSafetyNet(rows);
  for (const id of PENISOLA_DROPPED) {
    const row = netted.find(r => r.rider_id === id)!;
    assert.equal(breakawayMarkerState(participationForResult(row, null)!).labelKey, "detail.breakaway.dropped", id);
  }
  for (const id of PENISOLA_CAUGHT) assert.equal(netted.find(r => r.rider_id === id)?.breakaway_dropped, undefined);
  // An escapee ahead of every non-escapee really held on.
  const held = withFinishSafetyNet([
    { result_type: "stage", stage_number: 1, rank: 1, rider_id: "a", in_breakaway: true, breakaway_caught: false },
    { result_type: "stage", stage_number: 1, rank: 2, rider_id: "p", in_breakaway: false, breakaway_caught: false },
    { result_type: "stage", stage_number: 2, rank: 1, rider_id: "p", in_breakaway: false, breakaway_caught: false },
    { result_type: "stage", stage_number: 2, rank: 2, rider_id: "a", in_breakaway: true, breakaway_caught: false },
  ]);
  assert.equal(held[0].breakaway_dropped, undefined, "stage 1: held on");
  assert.equal(held[3].breakaway_dropped, true, "stage 2 is its own group");
  assert.deepEqual(withFinishSafetyNet(null), []);
});

test("#6185 the three marker states differ in icon SHAPE or tone, so they read apart without hover", () => {
  const base = { morning: true, laterAttack: false, verified: true };
  const held = breakawayMarkerState({ ...base, caught: false, survived: true, dropped: false });
  const caught = breakawayMarkerState({ ...base, caught: true, survived: false, dropped: false });
  const dropped = breakawayMarkerState({ ...base, caught: false, survived: false, dropped: true });
  assert.notEqual(dropped.icon, held.icon);
  assert.notEqual(dropped.icon, caught.icon);
  assert.equal(new Set([held.tone, caught.tone, dropped.tone]).size, 3);
  assert.equal(new Set([held.labelKey, caught.labelKey, dropped.labelKey]).size, 3);
  // Only the dropped state leaves the flag shape.
  assert.equal(held.icon, "flag");
  assert.equal(caught.icon, "flag");
});
