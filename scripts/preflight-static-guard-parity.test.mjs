// #6616: preflight-pr.ps1 skal spejle CI-jobbet static-guards. #6613 gik groen i
// preflight men roed i CI paa check-eslint-disable-count, fordi vagten kun
// stod i ci.yml. Denne test laeser static-guards' "Run ..."-trin og fejler
// hvis en vagt hverken koeres i preflight eller staar paa EXEMPT med begrundelse.
//
//   node --test scripts/preflight-static-guard-parity.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
const preflight = readFileSync(join(root, "scripts/preflight-pr.ps1"), "utf8");

// Vagter der med vilje IKKE koeres i preflight. Kraev en begrundelse (fx > 60 s).
export const EXEMPT = {
  // "scriptsti": "begrundelse"
};

// Udtraek "run:"-linjer i static-guards-jobbet (indtil naeste top-level job).
export function staticGuardsRunCommands(yml) {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^  static-guards:\s*$/.test(l));
  assert.ok(start >= 0, "job static-guards findes ikke i ci.yml");
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i])) break;
    const m = lines[i].match(/^\s+run:\s*(.+?)\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
}

// Kun "node <script>"-vagter (ikke "node --test ...", som er selvtests).
export function guardScripts(commands) {
  return commands
    .map((c) => c.match(/^node\s+(scripts\/\S+?\.mjs)(?:\s|$)/))
    .filter(Boolean)
    .map((m) => m[1]);
}

test("static-guards har mindst de kendte vagter (parseren er ikke blind)", () => {
  const scripts = guardScripts(staticGuardsRunCommands(ci));
  assert.ok(scripts.includes("scripts/check-eslint-disable-count.mjs"));
  assert.ok(scripts.length >= 10, `kun ${scripts.length} vagter fundet`);
});

test("hver static-guards-vagt koeres i preflight eller er undtaget med begrundelse", () => {
  const scripts = guardScripts(staticGuardsRunCommands(ci));
  const missing = scripts.filter((s) => !preflight.includes(s) && !EXEMPT[s]);
  assert.deepEqual(
    missing,
    [],
    `static-guards koerer ${missing.join(", ")} i CI, men scripts/preflight-pr.ps1 gør ikke. ` +
      "Tilfoej vagten til preflight, eller til EXEMPT i denne test med en begrundelse (#6616).",
  );
});

test("EXEMPT-poster har en begrundelse og er stadig en static-guards-vagt", () => {
  const scripts = new Set(guardScripts(staticGuardsRunCommands(ci)));
  for (const [script, reason] of Object.entries(EXEMPT)) {
    assert.ok(String(reason).trim().length >= 10, `${script}: mangler begrundelse`);
    assert.ok(scripts.has(script), `${script} er ikke laengere i static-guards - fjern fra EXEMPT`);
  }
});

test("preflight har ny-fil-reglen for frontend/src .js/.jsx", () => {
  assert.match(preflight, /--diff-filter=A/);
  assert.match(preflight, /new-frontend-file-ts-rule/);
});
