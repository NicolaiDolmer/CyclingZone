import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), "utf8");

// #2849 bølge 0: states-sheet-recipen — dashed inset, 26px ikon,
// titel 15px/600, beskrivelse 13px. Bølge 4 (ejer 24/7): radius konvergeret
// til rounded-cz (12px var systemets eneste outlier).
test("EmptyState er dashed inset med ikon/titel/tekst/handling", () => {
  const src = read("EmptyState.jsx");
  assert.match(src, /border-dashed/);
  assert.match(src, /border-cz-border/);
  assert.match(src, /rounded-cz /);
  assert.match(src, /size=\{26\}/);
  assert.match(src, /text-\[15px\] font-semibold/);
  assert.match(src, /\{icon\}/);
  assert.match(src, /\{title\}/);
  assert.match(src, /\{action\}/);
});

// #4625 (slice 3 af #4622, TASTE fork 4) — EmptyState uden en handling der
// fører videre var 6 af de 10 værste audit-fund 2026-09. `action` er nu
// PÅKRÆVET (blødgjort 2/9, PR #4657 opfølgning: logger console.error i dev
// i stedet for at kaste — renderer uden knap, tree-shaket ud af produktionsbuilds).
test("EmptyState logger console.error i dev naar action mangler, men renderer alligevel", () => {
  const src = read("EmptyState.jsx");
  assert.match(src, /import\.meta\.env\.DEV && !action/);
  assert.match(src, /console\.error/, "EmptyState skal logge console.error i stedet for at kaste");
  assert.doesNotMatch(src, /throw new Error/, "EmptyState maa ikke laengere kaste i dev");
  assert.doesNotMatch(src, /action\s*=\s*null/, "action maa ikke laengere have en null-default");
});

test("ErrorState: samme anatomi, danger kun i ikonet — ingen røde flader", () => {
  const src = read("ErrorState.jsx");
  assert.match(src, /AlertTriangleIcon/);
  assert.match(src, /text-cz-danger/);
  assert.match(src, /border-dashed/);
  assert.match(src, /\{action\}/);
  assert.doesNotMatch(src, /bg-cz-danger/, "ingen røde flader/paneler i error-state");
  assert.doesNotMatch(src, /border-cz-danger/, "hairline er neutral, ikke rød");
});

test("Skeleton bruger cz-skeleton-klassen og er aria-hidden", () => {
  const src = read("Skeleton.jsx");
  assert.match(src, /cz-skeleton/);
  assert.match(src, /aria-hidden/);
});

test("SkeletonLines: 12px linjer, 12px gap, radius 4, ekko-bredder", () => {
  const src = read("Skeleton.jsx");
  assert.match(src, /SkeletonLines/);
  assert.match(src, /h-3 rounded/);
  assert.match(src, /space-y-3/);
  for (const w of ["88%", "64%", "76%", "52%"]) {
    assert.ok(src.includes(`"${w}"`), `mangler linjebredde ${w}`);
  }
});

test("Spinner genbruger .spinner + animate-spin og melder status", () => {
  const src = read("Spinner.jsx");
  assert.match(src, /"spinner|spinner /);
  assert.match(src, /animate-spin/);
  assert.match(src, /role="status"/);
});
