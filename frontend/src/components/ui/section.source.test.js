import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "Section.jsx"), "utf8");

// #4625 (slice 3 af #4622, TASTE §3) — venstre-accent-bjælker er et femte
// prioritetssignal og var Dashboards mest gentagne fund (audit 2026-09).
// Section har ingen accent-prop; forsøger en className en border-l-klasse
// ind alligevel, kaster den i DEV.
test("Section kaster i dev naar className har en venstre-accent-bjaelke", () => {
  assert.match(src, /LEFT_ACCENT_RE/);
  assert.match(src, /border-l-/);
  assert.match(src, /throw new Error/);
});

test("ingen side sender en border-l-klasse til Section", () => {
  const srcRoot = join(here, "..", "..");
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".jsx")) continue;
      if (full.includes(join("components", "ui"))) continue;
      const text = readFileSync(full, "utf8");
      const re = /<Section\b[^>]*className="[^"]*border-l-(?:\[|[2-9]\b|cz-)/;
      if (re.test(text)) offenders.push(full.slice(srcRoot.length + 1));
    }
  };
  walk(srcRoot);
  assert.deepEqual(offenders, [], `Section maa ikke have en venstre-accent-bjaelke: ${offenders.join(", ")}`);
});
