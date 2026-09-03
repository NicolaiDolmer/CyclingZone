// scripts/check-anti-slop.test.mjs
// ============================================================
// Tests for the anti-slop forward-guard (#4626, slice 4 af #4622).
// Run: node --test scripts/check-anti-slop.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  countArrow,
  countSmallPx,
  countShadow,
  countGradient,
  scanSource,
  scanRepo,
  compareAgainstBaseline,
} from "./check-anti-slop.mjs";

test("countArrow flags unicode arrows and chevron-quote substitutes", () => {
  assert.equal(countArrow("Forhandl ny plan →"), 1);
  assert.equal(countArrow("← Tilbage"), 1);
  assert.equal(countArrow("↔ ↑ ↓"), 3);
  assert.equal(countArrow("‹ › « »"), 4);
  assert.equal(countArrow("Forhandles: 5 → 3 → 1 år"), 2); // content arrows count too (ratchet, not exempt)
  assert.equal(countArrow("plain ascii text"), 0);
});

test("countArrow ignores arrows inside comments", () => {
  assert.equal(countArrow("// migrate → to ChevronRightIcon"), 0);
  assert.equal(countArrow("/* ← old back-link glyph */"), 0);
});

test("countSmallPx flags text-[Npx] only when N < 12 (numeric, not char-class)", () => {
  assert.equal(countSmallPx('className="text-[8px]"'), 1);
  assert.equal(countSmallPx("text-[11px] text-[11.5px]"), 2);
  assert.equal(countSmallPx("text-[12px]"), 0); // exactly 12 is allowed
  assert.equal(countSmallPx("text-[13px] text-[40px]"), 0);
  assert.equal(countSmallPx("text-2xs text-3xs"), 0); // named utilities, not bracket syntax
});

test("countSmallPx ignores matches inside comments", () => {
  assert.equal(countSmallPx("// avoid text-[9px] in new UI"), 0);
});

test("countShadow flags shadow-* classes but allows shadow-overlay and shadow-none", () => {
  assert.equal(countShadow('className="shadow-xl"'), 1);
  assert.equal(countShadow("shadow shadow-2xl"), 2);
  assert.equal(countShadow("shadow-[0_0_40px_rgba(0,0,0,.5)]"), 1);
  assert.equal(countShadow("shadow-red-500/50"), 1);
  assert.equal(countShadow("shadow-overlay"), 0);
  assert.equal(countShadow("shadow-none"), 0);
  assert.equal(countShadow("rounded-cz shadow-overlay p-2"), 0);
});

test("countShadow flags raw box-shadow / boxShadow styles", () => {
  assert.equal(countShadow("style={{ boxShadow: `0 0 0 3px red` }}"), 1);
  assert.equal(countShadow("box-shadow: inset 0 0 0 1px red;"), 1);
});

test("countShadow ignores matches inside comments", () => {
  assert.equal(countShadow("// rå box-shadow fjernet, se index.css"), 0);
  assert.equal(countShadow("{/* box-shadow paa <tr> males ikke paalideligt */}"), 0);
});

test("countGradient flags Tailwind gradient utility and raw CSS gradient functions", () => {
  assert.equal(countGradient('className="bg-gradient-to-r from-cz-accent to-cz-accent-2"'), 1);
  assert.equal(countGradient("background: linear-gradient(90deg, red, blue);"), 1);
  assert.equal(countGradient("[background-image:linear-gradient(var(--a),var(--a))]"), 1);
  assert.equal(countGradient("radial-gradient(circle, red, blue)"), 1);
});

test("countGradient does not false-positive on the cycling term 'gradient'", () => {
  // #4626: "gradient" i denne kodebase betyder oftest stigningsprocent, ikke
  // en CSS-gradient. Scriptet maa IKKE flage disse.
  assert.equal(countGradient('t("detail.route.waypoint.gradient", { gradient: avg })'), 0);
  assert.equal(countGradient("const gradientBand = classifyClimb(avg_gradient);"), 0);
  assert.equal(countGradient("// ingen glow/gradient her"), 0);
});

test("scanSource returns per-category counts (arrow/smallpx/shadow/gradient)", () => {
  const r = scanSource('<div className="shadow-xl text-[9px] bg-gradient-to-r">Næste →</div>');
  assert.deepEqual(r, { arrow: 1, smallpx: 1, shadow: 1, gradient: 1 });
});

test("compareAgainstBaseline only flags increases over baseline", () => {
  const findings = { "a.jsx": { arrow: 2, smallpx: 0, shadow: 0, gradient: 0 } };
  const baseline = { files: { "a.jsx": { arrow: 1, smallpx: 0, shadow: 0, gradient: 0 } } };
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 1);
  assert.match(newViolations[0], /a\.jsx/);
  assert.match(newViolations[0], /arrow/);
});

test("compareAgainstBaseline flags a brand-new file with violations", () => {
  const findings = { "new.jsx": { arrow: 0, smallpx: 0, shadow: 1, gradient: 0 } };
  const baseline = { files: {} };
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 1);
  assert.match(newViolations[0], /shadow/);
});

test("compareAgainstBaseline reports stale baseline when violations shrink", () => {
  const findings = { "a.jsx": { arrow: 0, smallpx: 0, shadow: 0, gradient: 0 } };
  const baseline = { files: { "a.jsx": { arrow: 1, smallpx: 0, shadow: 0, gradient: 0 } } };
  const { newViolations, stale } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 0);
  assert.ok(stale.length >= 1);
});

test("nul NYE anti-slop-fund paa nuvaerende traae mod committet baseline", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const baseline = JSON.parse(readFileSync(join(here, "anti-slop-baseline.json"), "utf8"));
  const findings = scanRepo();
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(
    newViolations.length,
    0,
    `Nye anti-slop-overtraedelser (kør \`node scripts/check-anti-slop.mjs\` for detaljer):\n${newViolations.join("\n")}`
  );
});
