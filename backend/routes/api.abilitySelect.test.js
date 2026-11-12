// #7962: evnelisten i rider_derived_abilities(...)-selects skal komme fra
// registeret, ikke fra en haandskrevet noeglelist (ellers mangler nye evner).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "api.js"), "utf8");

test("rider_derived_abilities embeds use REGISTRY_ABILITY_KEYS, never a literal key list", () => {
  const offenders = [];
  const re = /rider_derived_abilities\((\$\{REGISTRY_ABILITY_KEYS\.join\(", "\)\}|[^)]*)\)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const inner = m[1].trim();
    if (inner === "" || inner === "*") continue;
    if (inner === '${REGISTRY_ABILITY_KEYS.join(", ")}') continue;
    const line = source.slice(0, m.index).split("\n").length;
    offenders.push(`api.js:${line}`);
  }
  assert.deepEqual(offenders, [], `Handwritten ability lists found: ${offenders.join(", ")}`);
});

test("interpolated ability lists are never inside a double-quoted string", () => {
  const bad = source
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.includes("${REGISTRY_ABILITY_KEYS") && /\.select\("/.test(line))
    .map(({ n }) => `api.js:${n}`);
  assert.deepEqual(bad, [], `Template placeholder inside a plain string: ${bad.join(", ")}`);
});

test("registry ability keys include teamwork and leadership", async () => {
  const { REGISTRY_ABILITY_KEYS } = await import("../lib/abilityRegistry.js");
  assert.ok(REGISTRY_ABILITY_KEYS.includes("teamwork"));
  assert.ok(REGISTRY_ABILITY_KEYS.includes("leadership"));
});
