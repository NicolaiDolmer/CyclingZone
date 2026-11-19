import { test } from "node:test";
import assert from "node:assert/strict";
import { riderXpBars, withXpLines, xpLine } from "./xpAbilityLine.ts";

test("#7947 a bar reads as whole x of y XP with a fill", () => {
  assert.deepEqual(xpLine({ xp: 312, price: 540 }), { xp: 312, price: 540, pct: 57 });
  assert.deepEqual(xpLine({ xp: 0, price: 540 }), { xp: 0, price: 540, pct: 0 });
});

test("#7947 XP over the price is shown as it is, the fill stops at full", () => {
  assert.deepEqual(xpLine({ xp: 600, price: 540 }), { xp: 600, price: 540, pct: 100 });
});

test("#7947 a missing or broken bar is no line, never an invented number", () => {
  for (const bad of [null, undefined, 5, "312/540", [], {}, { xp: 10 }, { price: 10 }, { xp: -1, price: 10 }, { xp: 1, price: 0 }, { xp: Number.NaN, price: 9 }]) {
    assert.equal(xpLine(bad), null, JSON.stringify(bad));
  }
});

test("#7947 no xp_bar in the payload = XP is off for the viewer", () => {
  assert.equal(riderXpBars(undefined, "r1"), null);
  assert.equal(riderXpBars(null, "r1"), null);
  assert.equal(riderXpBars([], "r1"), null);
  assert.deepEqual(riderXpBars({ r1: { tempo: { xp: 1, price: 2 } } }, "r1"), { tempo: { xp: 1, price: 2 } });
  // XP is on, but this rider has no bar yet: still XP mode (no "done", no percent).
  assert.deepEqual(riderXpBars({ r2: {} }, "r1"), {});
});

test("#7947 XP off: the receipt rows come back untouched (today's view)", () => {
  const rows = [{ ability: "tempo", locked: true, pct: null }, { ability: "sprint", locked: false, pct: 82 }];
  assert.equal(withXpLines(rows, null), rows);
  assert.equal(withXpLines(null, { tempo: { xp: 1, price: 2 } }), null);
});

test("#7947 XP on: every line shows XP and none is ever 'done'", () => {
  const rows = [
    { ability: "tempo", locked: true, pct: null },
    { ability: "sprint", locked: false, pct: 82 },
    { ability: "climbing", locked: false, pct: 40 },
  ];
  const out = withXpLines(rows, { tempo: { xp: 312, price: 540 }, sprint: { xp: 700, price: 640 } });
  assert.deepEqual(out?.map((r) => [r.ability, r.locked, r.pct, r.xpLine]), [
    ["tempo", false, 57, { xp: 312, price: 540, pct: 57 }],
    ["sprint", false, 100, { xp: 700, price: 640, pct: 100 }],
    // No bar for this ability: a dash, not the old percent.
    ["climbing", false, null, null],
  ]);
  assert.equal(rows[0].locked, true, "the input rows are not mutated");
});

test("dagens XP pr. evne (19/11): aktiviteternes xp summeres, og raekken faar xpDay", async () => {
  const { dayXpByAbility, withXpLines } = await import("./xpAbilityLine.ts");
  const day = dayXpByAbility([{ xp: { sprint: 30, tempo: 0 } }, { xp: { sprint: 24.4 } }, {}]);
  assert.deepEqual(day, { sprint: 54.4 });
  assert.equal(dayXpByAbility(null), null);
  const rows = withXpLines([{ ability: "sprint" }, { ability: "tempo" }], { sprint: { xp: 10, price: 100 } }, day);
  assert.equal(rows[0].xpDay, 54);
  assert.equal(rows[1].xpDay, null);
});
