import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const repo = fileURLToPath(new URL("../", import.meta.url));
const bytes = (size, seed = 1) => {
  const out = Buffer.alloc(size);
  let state = seed;
  for (let i = 0; i < size; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
};
const kb = (buf) => gzipSync(buf, { level: 9 }).length / 1024;

function runGate(chunks, budgetKB = 100, beta = false) {
  const root = mkdtempSync(join(tmpdir(), "cz-bundle-7170-"));
  try {
    for (const dir of ["scripts", "frontend/dist/assets", "frontend/src/i18n"]) mkdirSync(join(root, dir), { recursive: true });
    copyFileSync(join(repo, "scripts/check-bundle-budget.mjs"), join(root, "scripts/check-bundle-budget.mjs"));
    const languages = readFileSync(join(repo, "frontend/src/i18n/languages.js"), "utf8");
    writeFileSync(join(root, "frontend/src/i18n/languages.js"), beta ? languages.replaceAll("beta: false", "beta: true") : languages);
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(join(root, "frontend/bundle-budget.json"), JSON.stringify({ total_gzip_kb: budgetKB, margin_pct: 0 }));
    for (const [file, content] of Object.entries(chunks)) writeFileSync(join(root, "frontend/dist/assets", file), content);
    return spawnSync(process.execPath, [join(root, "scripts/check-bundle-budget.mjs")], { encoding: "utf8" });
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + "\\") || resolve(root).startsWith(resolve(tmpdir()) + "/"));
    rmSync(root, { recursive: true, force: true });
  }
}

const common = bytes(12_000);
const english = bytes(3_000, 2);
const danish = bytes(4_000, 3);
const base = { "index-hash.js": common, "i18n-messages-en-hash.js": english, "i18n-messages-da-hash.js": danish };
const expectedKB = kb(common) + kb(english) + kb(danish);

for (const beta of [false, true]) {
  test(`extra smaller languages do not add to the single-language total (beta=${beta})`, () => {
    const result = runGate({ ...base, "i18n-messages-fr-hash.js": bytes(2_000, 4), "i18n-messages-nl-hash.js": bytes(2_500, 5) }, expectedKB + 0.1, beta);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes(`Total gzipped JS: ${expectedKB.toFixed(1)} KB`), result.stdout);
  });
}

test("largest optional language replaces the previous maximum, including an unregistered language", () => {
  const larger = bytes(6_000, 7);
  const result = runGate({ ...base, "i18n-messages-zzz-hash.js": larger }, kb(common) + kb(english) + kb(larger) + 0.1);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("shared code growth still fails the gate with multiple languages", () => {
  const result = runGate({ ...base, "i18n-messages-fr-hash.js": bytes(2_000, 4), "shared-hash.js": bytes(3_000, 8) }, expectedKB + 0.1);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Bundle-budget overskredet/);
});

test("English fallback remains common weight and a build without optional languages is counted", () => {
  const result = runGate({ "index-hash.js": common, "i18n-messages-en-hash.js": english }, kb(common) + kb(english) - 0.1);
  assert.equal(result.status, 1, result.stdout + result.stderr);
});

test("non-JS assets do not affect the JS budget", () => {
  const result = runGate({ ...base, "style.css": bytes(20_000), "index-hash.js.map": bytes(20_000) }, expectedKB + 0.1);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
