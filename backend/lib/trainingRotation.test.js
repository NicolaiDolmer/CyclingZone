// #8548 · Rotation: formen (v1), gemningen (rev + anker) og pladsen (nextRotationIndex,
// advancesRotation). Rene funktioner; motoren bruger dem foerst i PR 2.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ROTATION_MAX_PASSES, ROTATION_MIN_PASSES, ROTATION_OUTCOMES, PLAN_KINDS,
  isPlanKind, isValidRotation, isValidRotationPass, normalizeRotationPasses, copyRotation, sameRotationPasses,
  buildRotationOnSave, nextRotationIndex, advancesRotation, rotationStamp, rotationPassAt,
  parseRotationWrite, applyRotationWrite,
} from "./trainingRotation.js";

const P = (...sessions) => sessions.map((session) => ({ session }));
const ABC = P("sprint", "endurance", "threshold");
const rot = (passes = ABC, extra = {}) => ({ v: 1, passes, rev: 1, anchor: { rev: 1, index: 0 }, ...extra });
const stamp = (rev, index, length, advanced = true) => ({ rev, index, length, advanced });

// ── Formen ───────────────────────────────────────────────────────────────────

test("plan_kind: kun week og rotation", () => {
  assert.deepEqual([...PLAN_KINDS], ["week", "rotation"]);
  assert.ok(isPlanKind("week") && isPlanKind("rotation"));
  assert.ok(!isPlanKind(null) && !isPlanKind("blocks") && !isPlanKind("Week"));
});

test("isValidRotation: v1 med 2..35 pas, rev og anker", () => {
  assert.ok(isValidRotation(rot()));
  assert.ok(isValidRotation(rot(ABC, { anchor: undefined })), "anker er valgfrit");
  assert.ok(isValidRotation(rot(P(...Array(ROTATION_MAX_PASSES).fill("rest")))));
  assert.ok(isValidRotation(rot(P("rest", "sprint"))), "laengde 2");
  assert.ok(!isValidRotation(rot(P("sprint"))), "under minimum");
  assert.ok(!isValidRotation(rot(P(...Array(ROTATION_MAX_PASSES + 1).fill("rest")))), "over maksimum");
  assert.ok(!isValidRotation({ ...rot(), v: 2 }), "ukendt version");
  assert.ok(!isValidRotation({ ...rot(), rev: 0 }));
  assert.ok(!isValidRotation({ ...rot(), active: true }), "rotation.active udgaar (plan_kind er markoeren)");
  assert.ok(!isValidRotation(rot(P("sprint", "moonwalk"))), "ukendt session");
  assert.ok(!isValidRotation(rot([{ session: "sprint", effort: "max" }, { session: "rest" }])), "ugyldig indsats");
  assert.ok(isValidRotation(rot([{ session: "sprint", effort: "hard" }, { session: "rest" }])));
  assert.ok(!isValidRotation(rot(ABC, { anchor: { rev: 1, index: 3 } })), "anker uden for listen");
  assert.ok(!isValidRotation(rot(ABC, { anchor: { rev: 2, index: 0 } })), "anker fra en senere rev");
  assert.ok(!isValidRotation(rot(ABC, { rev: 3, anchor: { rev: 3, index: 0, fromRev: 3 } })), "fromRev skal ligge foer");
  assert.ok(isValidRotation(rot(ABC, { rev: 3, anchor: { rev: 3, index: 0, fromRev: 2 } })));
  assert.ok(!isValidRotation(null) && !isValidRotation([]) && !isValidRotation("x"));
});

test("isValidRotationPass: kun session (+ indsats), v3-sessioner genkendes", () => {
  assert.ok(isValidRotationPass({ session: "long_climbs" }));
  assert.ok(!isValidRotationPass({ session: "sprint", note: "x" }));
  assert.ok(!isValidRotationPass("sprint"));
});

test("normalizeRotationPasses: indsats ignoreres med kontakten slukket, valideres taendt", () => {
  const input = [{ session: "sprint", effort: "hard" }, { session: "rest", effort: "bogus" }];
  assert.deepEqual(normalizeRotationPasses(input), { ok: true, passes: P("sprint", "rest") });
  assert.deepEqual(normalizeRotationPasses(input, { effortLevels: true }), { ok: false, reason: "invalid_effort" });
  assert.deepEqual(
    normalizeRotationPasses([{ session: "sprint", effort: "hard" }, { session: "rest", effort: null }], { effortLevels: true }),
    { ok: true, passes: [{ session: "sprint", effort: "hard" }, { session: "rest" }] },
  );
  assert.equal(normalizeRotationPasses(P("sprint")).reason, "invalid_passes");
  assert.equal(normalizeRotationPasses(P(...Array(ROTATION_MAX_PASSES + 1).fill("rest"))).reason, "invalid_passes");
  assert.equal(normalizeRotationPasses(P("sprint", "moonwalk")).reason, "invalid_session");
  assert.equal(normalizeRotationPasses([{ session: "sprint", x: 1 }, { session: "rest" }]).reason, "invalid_passes");
  assert.equal(normalizeRotationPasses("sprint").reason, "invalid_passes");
  assert.equal(ROTATION_MIN_PASSES, 2);
});

test("copyRotation: selvstaendig kopi, ingen delte objekter", () => {
  const src = rot([{ session: "sprint", effort: "easy" }, { session: "rest" }], { rev: 4, anchor: { rev: 4, index: 1, fromRev: 2 } });
  const copy = copyRotation(src);
  assert.deepEqual(copy, src);
  assert.notEqual(copy.passes, src.passes);
  assert.notEqual(copy.passes[0], src.passes[0]);
  assert.notEqual(copy.anchor, src.anchor);
  assert.equal(copyRotation({ v: 1 }), null);
});

test("sameRotationPasses: samme raekkefoelge og indsats", () => {
  assert.ok(sameRotationPasses(rot(), P("sprint", "endurance", "threshold")));
  assert.ok(!sameRotationPasses(rot(), P("endurance", "sprint", "threshold")));
  assert.ok(!sameRotationPasses(rot(), [{ session: "sprint", effort: "hard" }, ...P("endurance", "threshold")]));
  assert.ok(!sameRotationPasses(null, ABC));
});

// ── Gemningen ────────────────────────────────────────────────────────────────

test("buildRotationOnSave: foerste gemning starter ved pas 1", () => {
  assert.deepEqual(buildRotationOnSave(null, ABC), { v: 1, passes: ABC, rev: 1, anchor: { rev: 1, index: 0 } });
});

test("buildRotationOnSave: samme laengde beholder pladsen (ejer svar 3), ny laengde = pas 1", () => {
  const prev = rot(ABC, { rev: 3, anchor: { rev: 3, index: 0 } });
  const same = buildRotationOnSave(prev, P("tempo", "endurance", "rest"));
  assert.equal(same.rev, 4);
  assert.deepEqual(same.anchor, { rev: 4, index: 0, fromRev: 3 });
  const longer = buildRotationOnSave(prev, P("tempo", "endurance", "rest", "sprint"));
  assert.deepEqual(longer.anchor, { rev: 4, index: 0 });
  const startOver = buildRotationOnSave(prev, P("tempo", "endurance", "rest"), { keepPlace: false });
  assert.deepEqual(startOver.anchor, { rev: 4, index: 0 }, "Start fra pas 1");
});

test("buildRotationOnSave: Spring til pas saetter et eksplicit anker og hoever rev", () => {
  const prev = rot(ABC, { rev: 2, anchor: { rev: 2, index: 0 } });
  assert.deepEqual(buildRotationOnSave(prev, ABC, { startIndex: 2 }).anchor, { rev: 3, index: 2 });
  assert.equal(buildRotationOnSave(prev, ABC, { startIndex: 3 }), null, "uden for listen");
  assert.equal(buildRotationOnSave(prev, ABC, { startIndex: 1.5 }), null);
  assert.equal(buildRotationOnSave(prev, P("sprint")), null, "for faa pas");
});

test("buildRotationOnSave: en kaede af rettelser uden koersel bevarer fromRev og springet", () => {
  const r1 = buildRotationOnSave(null, ABC);
  const r2 = buildRotationOnSave(r1, ABC, { startIndex: 2 });
  const r3 = buildRotationOnSave(r2, P("rest", "endurance", "threshold"));
  assert.deepEqual(r3.anchor, { rev: 3, index: 2, fromRev: 2 });
  const r4 = buildRotationOnSave(r3, P("rest", "tempo", "threshold"));
  assert.deepEqual(r4.anchor, { rev: 4, index: 2, fromRev: 2 });
});

test("buildRotationOnSave: rev stiger ogsaa oven paa en ugyldig gammel vaerdi", () => {
  assert.equal(buildRotationOnSave({ v: 9, rev: 7 }, ABC).rev, 8);
});

// ── Skrivningen fra klienten ─────────────────────────────────────────────────

test("parseRotationWrite: typer, standarder og intet at skrive", () => {
  assert.deepEqual(parseRotationWrite({ passes: ABC }), { ok: true, planKind: "rotation", passes: ABC, keepPlace: true, startIndex: null });
  assert.equal(parseRotationWrite({ planKind: "week" }).planKind, "week");
  assert.equal(parseRotationWrite({ startIndex: 2 }).planKind, undefined, "kun et spring roerer ikke markoeren");
  assert.equal(parseRotationWrite({}).reason, "nothing_to_write");
  assert.equal(parseRotationWrite(null).reason, "nothing_to_write");
  assert.equal(parseRotationWrite({ planKind: "blocks" }).reason, "invalid_plan_kind");
  assert.equal(parseRotationWrite({ passes: "sprint" }).reason, "invalid_passes");
  assert.equal(parseRotationWrite({ passes: ABC, keepPlace: "yes" }).reason, "invalid_keep_place");
  assert.equal(parseRotationWrite({ startIndex: -1 }).reason, "invalid_start");
  assert.equal(parseRotationWrite({ startIndex: 1.5 }).reason, "invalid_start");
});

test("applyRotationWrite: nye pas giver ny rev; samme pas staar stille", () => {
  const first = applyRotationWrite({ write: parseRotationWrite({ passes: ABC }), passes: ABC });
  assert.deepEqual(first, { ok: true, planKind: "rotation", rotation: { v: 1, passes: ABC, rev: 1, anchor: { rev: 1, index: 0 } } });
  const again = applyRotationWrite({ prev: first.rotation, prevKind: "rotation", write: parseRotationWrite({ passes: ABC }), passes: ABC });
  assert.deepEqual(again.rotation, first.rotation, "ingen rev-bump uden aendring");
  const edited = applyRotationWrite({ prev: first.rotation, prevKind: "rotation", write: parseRotationWrite({ passes: P("rest", "endurance", "threshold") }), passes: P("rest", "endurance", "threshold") });
  assert.deepEqual(edited.rotation.anchor, { rev: 2, index: 0, fromRev: 1 });
});

test("applyRotationWrite: Week blocks beholder rotationen, spring kraever en rotation", () => {
  const prev = rot();
  const toWeek = applyRotationWrite({ prev, prevKind: "rotation", write: parseRotationWrite({ planKind: "week" }) });
  assert.deepEqual(toWeek, { ok: true, planKind: "week", rotation: prev });
  const back = applyRotationWrite({ prev, prevKind: "week", write: parseRotationWrite({ planKind: "rotation" }) });
  assert.deepEqual(back.rotation, prev, "et skift tilbage fortsaetter (samme rev)");
  const jump = applyRotationWrite({ prev, prevKind: "rotation", write: parseRotationWrite({ startIndex: 2 }) });
  assert.deepEqual([jump.planKind, jump.rotation.rev, jump.rotation.anchor], ["rotation", 2, { rev: 2, index: 2 }]);
  assert.equal(applyRotationWrite({ prev, write: parseRotationWrite({ startIndex: 3 }) }).reason, "invalid_start");
  assert.equal(applyRotationWrite({ write: parseRotationWrite({ startIndex: 0 }) }).reason, "rotation_missing");
  assert.equal(applyRotationWrite({ write: parseRotationWrite({ planKind: "rotation" }) }).reason, "rotation_missing");
  assert.deepEqual(applyRotationWrite({ write: parseRotationWrite({ planKind: "week" }) }), { ok: true, planKind: "week", rotation: null });
});

// ── Pladsen ──────────────────────────────────────────────────────────────────

test("nextRotationIndex: intet stempel og intet anker = pas 1; ingen rotation = null", () => {
  assert.equal(nextRotationIndex({ rotation: rot(ABC, { anchor: undefined }) }), 0);
  assert.equal(nextRotationIndex({ rotation: rot() }), 0);
  assert.equal(nextRotationIndex({ rotation: null }), null);
});

test("nextRotationIndex: ankeret goelder til der findes et stempel med samme rev", () => {
  const rotation = rot(ABC, { rev: 2, anchor: { rev: 2, index: 2 } });
  assert.equal(nextRotationIndex({ rotation, stamps: [stamp(1, 0, 3)] }), 2, "stempler fra en gammel rev taeller ikke");
  assert.equal(nextRotationIndex({ rotation, stamps: [stamp(2, 2, 3)] }), 0, "wrap ved N");
  assert.equal(nextRotationIndex({ rotation, stamps: [stamp(2, 2, 3), stamp(2, 0, 3)] }), 1, "seneste i afregningsraekkefoelge");
});

test("nextRotationIndex: et slot der ikke koerte passet, holder pladsen", () => {
  const rotation = rot();
  assert.equal(nextRotationIndex({ rotation, stamps: [stamp(1, 1, 3, false)] }), 1);
  assert.equal(nextRotationIndex({ rotation, stamps: [stamp(1, 1, 3, true), stamp(1, 2, 3, false)] }), 2);
});

test("nextRotationIndex: Behold pladsen fortsaetter fra den gamle rev ved samme laengde", () => {
  const rotation = rot(P("rest", "tempo", "sprint"), { rev: 4, anchor: { rev: 4, index: 0, fromRev: 3 } });
  assert.equal(nextRotationIndex({ rotation, stamps: [stamp(3, 1, 3)] }), 2);
  assert.equal(nextRotationIndex({ rotation, stamps: [stamp(2, 1, 3)] }), 0, "rev foer fromRev taeller ikke");
  assert.equal(nextRotationIndex({ rotation, stamps: [stamp(3, 1, 4)] }), 0, "anden laengde = pas 1");
  assert.equal(nextRotationIndex({ rotation, stamps: [stamp(3, 1, 3), stamp(4, 1, 3)] }), 2, "egen rev vinder");
});

test("nextRotationIndex: laengde 2 og 35 wrapper", () => {
  const two = rot(P("rest", "sprint"));
  assert.equal(nextRotationIndex({ rotation: two, stamps: [stamp(1, 1, 2)] }), 0);
  const long = rot(P(...Array(35).fill("endurance")));
  assert.equal(nextRotationIndex({ rotation: long, stamps: [stamp(1, 34, 35)] }), 0);
  assert.equal(nextRotationIndex({ rotation: long, stamps: [stamp(1, 33, 35)] }), 34);
});

test("nextRotationIndex: ugyldige stempler ignoreres", () => {
  const rotation = rot();
  assert.equal(nextRotationIndex({ rotation, stamps: [{ rev: 1, index: 5, length: 3, advanced: true }] }), 0);
  assert.equal(nextRotationIndex({ rotation, stamps: [{ rev: 1, index: 1, length: 3 }] }), 0);
  assert.equal(nextRotationIndex({ rotation, stamps: "nope" }), 0);
});

test("en uge med loeb: A, (loeb), B, C, A — pladsen venter paa loebet", () => {
  const rotation = rot();
  const stamps = [];
  const ran = [];
  for (const outcome of ["trained", "raced", "trained", "trained", "trained"]) {
    const index = nextRotationIndex({ rotation, stamps });
    const advanced = advancesRotation(outcome);
    stamps.push(rotationStamp({ rotation, index, advanced }));
    ran.push(advanced ? rotationPassAt(rotation, index).session : outcome);
  }
  assert.deepEqual(ran, ["sprint", "raced", "endurance", "threshold", "sprint"]);
});

// ── Rykker pladsen? (designets afsnit 5, ejer 21/11) ─────────────────────────

test("advancesRotation: hver raekke i tabellen", () => {
  const O = ROTATION_OUTCOMES;
  assert.equal(advancesRotation(O.TRAINED), true);
  assert.equal(advancesRotation(O.TRAIN_NOW), true);
  assert.equal(advancesRotation(O.FREE_SLOT_STAGE_DATE), true);
  assert.equal(advancesRotation(O.RACED), false);
  assert.equal(advancesRotation(O.BOUND_REST), false);
  assert.equal(advancesRotation(O.INJURED), false);
  assert.equal(advancesRotation(O.UNKNOWN_PENDING), false);
  assert.equal(advancesRotation(O.FATIGUE_RULE, { fatigueFallback: "rest" }), false);
  assert.equal(advancesRotation(O.FATIGUE_RULE, { fatigueFallback: "recovery" }), false);
  assert.equal(advancesRotation(O.FATIGUE_RULE, { fatigueFallback: "light" }), true, "samme pas paa let rykker (svar 2)");
  assert.equal(advancesRotation(O.FATIGUE_RULE), false);
  assert.equal(advancesRotation(O.AFTER_STAGE), false);
  assert.equal(advancesRotation("something_new"), false, "ukendt udfald venter");
});

test("rotationStamp og rotationPassAt", () => {
  const rotation = rot([{ session: "sprint", effort: "hard" }, { session: "rest" }], { rev: 5, anchor: { rev: 5, index: 0 } });
  assert.deepEqual(rotationStamp({ rotation, index: 1, advanced: true }), { rev: 5, index: 1, length: 2, advanced: true });
  assert.deepEqual(rotationStamp({ rotation, index: 0, advanced: "yes" }), { rev: 5, index: 0, length: 2, advanced: false });
  assert.equal(rotationStamp({ rotation, index: 2, advanced: true }), null);
  assert.deepEqual(rotationPassAt(rotation, 0), { session: "sprint", effort: "hard" });
  assert.notEqual(rotationPassAt(rotation, 0), rotation.passes[0]);
  assert.equal(rotationPassAt(rotation, 9), null);
});
