import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.jsx"), "utf8");

test("2a-ikoner er defineret og bygger paa IconBase", () => {
  for (const name of ["ChevronDownIcon", "CheckIcon", "XIcon", "AlertTriangleIcon", "InfoIcon", "InboxIcon"]) {
    assert.match(src, new RegExp(`export function ${name}\\(`), `mangler ${name}`);
  }
  // Hus-spec haandhaeves centralt af IconBase; ikonerne maa kun levere <path>/<circle> indeni.
  assert.ok(!/stroke-width|strokeWidth/.test(src), "ikoner maa ikke override stroke (IconBase ejer hus-spec)");
});
