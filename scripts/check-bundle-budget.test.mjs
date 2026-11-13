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

// #6165: the gate measures first load (entry + modulepreload from index.html),
// each lazy chunk on its own, and only reports the total as a trend.
// `firstLoad` lists the chunk files index.html references; everything else in
// `chunks` is a lazy chunk.
function runGate(chunks, firstLoad, budget = {}, beta = false) {
  const root = mkdtempSync(join(tmpdir(), "cz-bundle-6165-"));
  try {
    for (const dir of ["scripts", "frontend/dist/assets", "frontend/src/i18n"]) mkdirSync(join(root, dir), { recursive: true });
    copyFileSync(join(repo, "scripts/check-bundle-budget.mjs"), join(root, "scripts/check-bundle-budget.mjs"));
    const languages = readFileSync(join(repo, "frontend/src/i18n/languages.js"), "utf8");
    writeFileSync(join(root, "frontend/src/i18n/languages.js"), beta ? languages.replaceAll("beta: false", "beta: true") : languages);
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(
      join(root, "frontend/bundle-budget.json"),
      JSON.stringify({ total_gzip_kb: 1, margin_pct: 0, first_load_gzip_kb: 100, lazy_chunk_gzip_kb: 100, ...budget })
    );
    for (const [file, content] of Object.entries(chunks)) writeFileSync(join(root, "frontend/dist/assets", file), content);
    const [entry, ...preloads] = firstLoad;
    const html =
      "<!doctype html><html><head>" +
      `<script type="module" crossorigin src="/assets/${entry}"></script>` +
      preloads.map((f) => `<link rel="modulepreload" crossorigin href="/assets/${f}">`).join("") +
      '<link rel="stylesheet" crossorigin href="/assets/index-abc12345.css">' +
      "</head><body></body></html>";
    writeFileSync(join(root, "frontend/dist/index.html"), html);
    return spawnSync(process.execPath, [join(root, "scripts/check-bundle-budget.mjs")], { encoding: "utf8" });
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + "\\") || resolve(root).startsWith(resolve(tmpdir()) + "/"));
    rmSync(root, { recursive: true, force: true });
  }
}

const common = bytes(12_000);
const english = bytes(3_000, 2);
const danish = bytes(4_000, 3);
const base = { "index-aaaaaaaa.js": common, "i18n-messages-en-bbbbbbbb.js": english, "i18n-messages-da-cccccccc.js": danish };
const firstLoad = ["index-aaaaaaaa.js", "i18n-messages-en-bbbbbbbb.js"];
const firstLoadKB = kb(common) + kb(english) + kb(danish);

for (const beta of [false, true]) {
  test(`extra smaller languages do not add to first load (beta=${beta})`, () => {
    const result = runGate(
      { ...base, "i18n-messages-fr-dddddddd.js": bytes(2_000, 4), "i18n-messages-nl-eeeeeeee.js": bytes(2_500, 5) },
      firstLoad,
      { first_load_gzip_kb: firstLoadKB + 0.1 },
      beta
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes(`Første indlæsning: ${firstLoadKB.toFixed(1)} KB`), result.stdout);
  });
}

test("largest optional language replaces the previous maximum, including an unregistered language", () => {
  const larger = bytes(6_000, 7);
  const result = runGate(
    { ...base, "i18n-messages-zzz-ffffffff.js": larger },
    firstLoad,
    { first_load_gzip_kb: kb(common) + kb(english) + kb(larger) + 0.1 }
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a too heavy first load fails and names the chunk and the overshoot", () => {
  const heavy = bytes(30_000, 9);
  const result = runGate(
    { ...base, "react-vendor-99999999.js": heavy },
    [...firstLoad, "react-vendor-99999999.js"],
    { first_load_gzip_kb: firstLoadKB + 0.1 }
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Første indlæsning er .* KB over loftet/);
  assert.match(result.stderr, /react-vendor-99999999\.js/);
});

test("English fallback stays in first load and a build without optional languages is counted", () => {
  const result = runGate({ "index-aaaaaaaa.js": common, "i18n-messages-en-bbbbbbbb.js": english }, firstLoad, {
    first_load_gzip_kb: kb(common) + kb(english) - 0.1,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
});

test("margin_pct is added on top of the first load ceiling", () => {
  const ok = runGate(base, firstLoad, { first_load_gzip_kb: firstLoadKB / 1.05 + 0.05, margin_pct: 5 });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const over = runGate(base, firstLoad, { first_load_gzip_kb: firstLoadKB / 1.05 - 0.05, margin_pct: 5 });
  assert.equal(over.status, 1, over.stdout + over.stderr);
});

test("a heavy lazy chunk outside first load fails on its own and is named", () => {
  const result = runGate(
    { ...base, "RaceDetailPage-12345678.js": bytes(30_000, 11) },
    firstLoad,
    { lazy_chunk_gzip_kb: 10 }
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Stykket RaceDetailPage \(RaceDetailPage-12345678\.js\)/);
  assert.match(result.stderr, /KB over loftet/);
});

test("a named lazy chunk override lifts only that chunk", () => {
  const chunks = { ...base, "AdminGrowthPage-12345678.js": bytes(30_000, 12), "OtherPage-87654321.js": bytes(30_000, 13) };
  const both = runGate(chunks, firstLoad, { lazy_chunk_gzip_kb: 10, lazy_chunk_overrides: { AdminGrowthPage: 100 } });
  assert.equal(both.status, 1, both.stdout + both.stderr);
  assert.match(both.stderr, /OtherPage/);
  assert.doesNotMatch(both.stderr, /Stykket AdminGrowthPage/);
  const ok = runGate(chunks, firstLoad, { lazy_chunk_gzip_kb: 10, lazy_chunk_overrides: { AdminGrowthPage: 100, OtherPage: 100 } });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test("a lazy chunk is not held to the first load ceiling and vice versa", () => {
  const result = runGate(
    { ...base, "BigRoute-12345678.js": bytes(30_000, 14) },
    firstLoad,
    { first_load_gzip_kb: firstLoadKB + 0.1, lazy_chunk_gzip_kb: 100 }
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("total weight is only a trend and never fails the gate", () => {
  const result = runGate(
    { ...base, "RoutePage-12345678.js": bytes(30_000, 15) },
    firstLoad,
    { total_gzip_kb: 1, first_load_gzip_kb: firstLoadKB + 0.1, lazy_chunk_gzip_kb: 100 }
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Trend \(ikke en port\)/);
});

test("non-JS assets do not affect the JS budget", () => {
  const result = runGate(
    { ...base, "style.css": bytes(20_000), "index-aaaaaaaa.js.map": bytes(20_000) },
    firstLoad,
    { first_load_gzip_kb: firstLoadKB + 0.1 }
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a build without index.html entry scripts exits 2", () => {
  const result = runGate(base, ["style.css"], {});
  assert.equal(result.status, 2, result.stdout + result.stderr);
});
