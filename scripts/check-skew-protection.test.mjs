import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  extractAssetRefs,
  checkEntryHtml,
  checkDynamicChunkReferences,
  runSkewProtectionCheck,
} from "./check-skew-protection.mjs";

function makeFixtureDist({ withDpl }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "skew-protection-fixture-"));
  const assetsDir = path.join(dir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const suffix = withDpl ? "?dpl=dpl_test" : "";

  const entryHtml = `<!doctype html><html><head>
    <script type="module" crossorigin src="/assets/index-abc123.js${suffix}"></script>
    <link rel="modulepreload" crossorigin href="/assets/react-def456.js${suffix}">
    <link rel="stylesheet" crossorigin href="/assets/index-ghi789.css${suffix}">
  </head><body><div id="root"></div></body></html>`;

  writeFileSync(path.join(dir, "app.html"), entryHtml);
  writeFileSync(path.join(dir, "index.html"), entryHtml);

  // Simulerer Vites chunk-preload-kode: strengreferencer til andre chunks.
  const entryJs = withDpl
    ? `const deps=["assets/RidersPage-jkl012.js?dpl=dpl_test","assets/react-def456.js?dpl=dpl_test"];`
    : `const deps=["assets/RidersPage-jkl012.js","assets/react-def456.js"];`;
  writeFileSync(path.join(assetsDir, "index-abc123.js"), entryJs);
  writeFileSync(path.join(assetsDir, "RidersPage-jkl012.js"), "export default function RidersPage(){}");

  return dir;
}

test("extractAssetRefs finds script src and link href asset URLs", () => {
  const html = `<script src="/assets/a.js?dpl=x"></script><link href="/assets/b.css">`;
  assert.deepEqual(extractAssetRefs(html), ["/assets/a.js?dpl=x", "/assets/b.css"]);
});

test("checkEntryHtml passes when every asset ref carries the matching dpl value", () => {
  const dir = makeFixtureDist({ withDpl: true });
  try {
    const result = checkEntryHtml(dir, "dpl_test");
    assert.equal(result.ok, true);
    assert.equal(result.missing.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkEntryHtml fails when asset refs have no dpl param", () => {
  const dir = makeFixtureDist({ withDpl: false });
  try {
    const result = checkEntryHtml(dir, "dpl_test");
    assert.equal(result.ok, false);
    assert.ok(result.missing.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkEntryHtml fails when no entry HTML file exists", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "skew-protection-empty-"));
  try {
    const result = checkEntryHtml(dir, "dpl_test");
    assert.equal(result.ok, false);
    assert.match(result.reason, /ingen entry-HTML/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkDynamicChunkReferences finds a JS chunk that references another chunk with dpl=", () => {
  const dir = makeFixtureDist({ withDpl: true });
  try {
    const result = checkDynamicChunkReferences(dir, "dpl_test");
    assert.equal(result.ok, true);
    assert.deepEqual(result.matches, ["index-abc123.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkDynamicChunkReferences fails when no chunk carries a dpl= cross-reference", () => {
  const dir = makeFixtureDist({ withDpl: false });
  try {
    const result = checkDynamicChunkReferences(dir, "dpl_test");
    assert.equal(result.ok, false);
    assert.deepEqual(result.matches, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runSkewProtectionCheck is skipped (ok) when VERCEL_DEPLOYMENT_ID is absent", () => {
  const result = runSkewProtectionCheck({ distDir: "does-not-matter", deploymentId: undefined });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test("runSkewProtectionCheck passes end-to-end against a fixture build with dpl= wired in", () => {
  const dir = makeFixtureDist({ withDpl: true });
  try {
    const result = runSkewProtectionCheck({ distDir: dir, deploymentId: "dpl_test" });
    assert.equal(result.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runSkewProtectionCheck fails end-to-end against a fixture build missing dpl=", () => {
  const dir = makeFixtureDist({ withDpl: false });
  try {
    const result = runSkewProtectionCheck({ distDir: dir, deploymentId: "dpl_test" });
    assert.equal(result.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
