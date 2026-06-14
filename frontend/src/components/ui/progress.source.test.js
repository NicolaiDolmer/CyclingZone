import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ProgressMeter.jsx"), "utf8");

test("ProgressMeter bruger track/fill-helpers + clampPercent", () => {
  assert.match(src, /trackClass\(/);
  assert.match(src, /fillClass\(/);
  assert.match(src, /clampPercent\(/);
});

test("ProgressMeter er role=progressbar med aria-vaerdier", () => {
  assert.match(src, /role="progressbar"/);
  assert.match(src, /aria-valuenow=/);
  assert.match(src, /aria-valuemin=/);
  assert.match(src, /aria-valuemax=/);
});

test("fyldet saetter bredde inline efter clampet procent", () => {
  assert.match(src, /style=\{\{ width: `\$\{pct\}%` \}\}/);
});

test("valgfri tal-label er tabular (Inter Tight)", () => {
  assert.match(src, /tabular-nums/);
});
