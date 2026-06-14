// scripts/lint-ui-slop.test.mjs
// ============================================================
// Tests for the UI anti-drift forward-guard (#671 Plan 3, spec DEL-C C1).
// Run: node --test scripts/lint-ui-slop.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { countHex, countSlop, countEmoji, scanSource } from "./lint-ui-slop.mjs";

test("countHex flags raw hex colors (3/4/6/8-digit)", () => {
  assert.equal(countHex("color: #e8c547;"), 1);
  assert.equal(countHex('fill="#fff" stroke="#0e0f15"'), 2);
  assert.equal(countHex("#abcd and #abcdef12"), 2); // 4-digit + 8-digit
});

test("countHex ignores hex inside comments", () => {
  assert.equal(countHex("// guld er #e8c547"), 0);
  assert.equal(countHex("/* #0e0f15 navy */"), 0);
});

test("countHex does not false-positive on non-color text", () => {
  assert.equal(countHex("const x = 12;"), 0);
  assert.equal(countHex('href="#section"'), 0); // #section is not hex-shaped
  assert.equal(countHex("rgb(var(--accent))"), 0);
});

test("countSlop flags rounded-xl/2xl/3xl, glow, backdrop-blur, blob-blur", () => {
  assert.equal(countSlop('className="rounded-2xl"'), 1);
  assert.equal(countSlop("rounded-xl rounded-3xl"), 2);
  assert.equal(countSlop("shadow-[0_0_40px_rgba(0,0,0,.5)]"), 1);
  assert.equal(countSlop("backdrop-blur-sm"), 1);
  assert.equal(countSlop("blur-2xl blur-3xl"), 2);
});

test("countSlop allows on-spec tokens (rounded-cz, shadow-overlay)", () => {
  assert.equal(countSlop("rounded-cz rounded-cz-pill shadow-overlay"), 0);
  assert.equal(countSlop("// avoid rounded-2xl in new UI"), 0); // comment stripped
});

test("countEmoji flags emoji used as icons but not text symbols", () => {
  assert.equal(countEmoji("🏁 finish line"), 1);
  assert.equal(countEmoji("💰🔭⛰️"), 3);
  assert.equal(countEmoji("© 2026 Cycling Zone"), 0); // ©®™ exempt
  assert.equal(countEmoji("plain ascii text"), 0);
  assert.equal(countEmoji("// 🏁 in a comment"), 0); // comment stripped
});

test("scanSource returns per-category counts", () => {
  const r = scanSource('<div className="rounded-2xl" style={{color:"#fff"}}>🏁</div>');
  assert.deepEqual(r, { hex: 1, slop: 1, emoji: 1 });
});
