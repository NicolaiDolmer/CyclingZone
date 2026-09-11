// Kontrakt-tests for build-determinisme-gaten (#5160).
//
// Gaten bestaar af tre dele der kun virker SAMMEN:
//
//   1. frontend/vite.config.js skal kunne koere Sentry-TRANSFORMATIONEN uden et
//      upload-token (CZ_SENTRY_TRANSFORM), ellers maaler CI en pipeline prod
//      ikke bruger.
//   2. `release.inject: false` skal blive staaende (#4595 rod-aarsag 2).
//   3. CI-jobbet skal bygge TO gange med FORSKELLIGE release-id'er, have
//      transformationen slaaet til, og vaere blokerende - ikke advisory.
//
// Hver af dem kan forsvinde i en refaktor uden at noget build fejler. Derfor
// testes de som tekst-kontrakter her. Desuden testes at markoer-vaerdierne i
// scripts/check-build-determinism.mjs og ci.yml ikke driver fra hinanden -
// scriptets egen kommentar kraever det, men intet haandhaevede det foer nu.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MARKERS, viteConfigDisablesReleaseInject } from "./check-build-determinism.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// CRLF normaliseres: filerne checkes ud med \r\n paa Windows, og saa ville
// linje-ankrede moenstre fejle lokalt men bestaa i CI (eller omvendt).
const read = (...parts) =>
  fs.readFileSync(path.join(repoRoot, ...parts), "utf-8").replace(/\r\n/g, "\n");
const viteConfig = read("frontend", "vite.config.js");
const ciWorkflow = read(".github", "workflows", "ci.yml");

/** Klipper eet job ud af ci.yml paa indrykning (jobs ligger paa 2 mellemrum). */
function jobBlock(name) {
  const start = ciWorkflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `jobbet "${name}" findes ikke i .github/workflows/ci.yml`);
  const rest = ciWorkflow.slice(start + 1);
  const next = rest.search(/\n {2}[a-z0-9][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

test("viteConfigDisablesReleaseInject accepterer den rigtige config", () => {
  assert.equal(viteConfigDisablesReleaseInject(viteConfig), true);
});

test("viteConfigDisablesReleaseInject afviser inject: true og en manglende release-blok", () => {
  assert.equal(
    viteConfigDisablesReleaseInject('sentryVitePlugin({ release: { name: x, inject: true } })'),
    false
  );
  assert.equal(viteConfigDisablesReleaseInject("sentryVitePlugin({ authToken: t })"), false);
  // En kommentar der naevner inject: false taeller ikke - kun rigtig kode.
  assert.equal(
    viteConfigDisablesReleaseInject("// release: { inject: false }\nsentryVitePlugin({})"),
    false
  );
});

test("vite.config.js kan koere Sentry-transformationen uden upload-token", () => {
  // Uden disse tre led er der ingen maade at faa debug-id-injektionen med i et
  // tokenloest CI-build, og to-build-beviset maaler igen en anden pipeline end
  // prod (audit 11/9, fund H1).
  assert.match(viteConfig, /CZ_SENTRY_TRANSFORM/, "CZ_SENTRY_TRANSFORM-flaget er vaek");
  assert.match(
    viteConfig,
    /disable:\s*"disable-upload"/,
    'sourcemaps.disable: "disable-upload" er vaek - transformationen koerer nu kun med token'
  );
  assert.match(
    viteConfig,
    /enableSentryPlugin\s*=\s*enableSentryUpload\s*\|\|\s*forceSentryTransform/,
    "pluginet er ikke laengere gated paa upload ELLER transform"
  );
  // Prod-adfaerden skal vaere uaendret: upload kraever stadig alle tre env-vars.
  assert.match(viteConfig, /SENTRY_AUTH_TOKEN/);
  assert.match(viteConfig, /SENTRY_ORG/);
  assert.match(viteConfig, /SENTRY_PROJECT/);
});

test("source maps foelger pluginet, saa de to builds ligner prod", () => {
  assert.match(
    viteConfig,
    /sourcemap:\s*enableSentryPlugin/,
    "build.sourcemap er ikke koblet til pluginet - CI-buildet faar ingen source maps og dermed andre asset-bytes end prod"
  );
});

test("MARKERS matcher env'en paa ci.yml's markoer-build", () => {
  // Scriptets egen kommentar siger at de SKAL vaere identiske. Her haandhaeves det.
  const block = jobBlock("frontend-build");
  for (const [name, value] of Object.entries(MARKERS)) {
    assert.ok(
      new RegExp(`${name}:\\s*["']?${value}["']?`).test(block),
      `ci.yml's "Build frontend" saetter ikke ${name}=${value} - markoer-guarden kan gaa falsk groen`
    );
  }
});

test("to-build-jobbet findes, bygger to gange og er ikke advisory", () => {
  const block = jobBlock("build-determinism-two-builds");

  assert.match(block, /CZ_SENTRY_TRANSFORM:\s*"1"/, "transformationen er ikke slaaet til i jobbet");
  assert.match(block, /VITE_SENTRY_DSN:/, "uden DSN elimineres Sentry.init og buildet ligner ikke prod");

  const builds = block.match(/run:\s*npm run build/g) ?? [];
  assert.equal(builds.length, 2, `jobbet koerer ${builds.length} builds, ikke 2`);

  const releases = [...block.matchAll(/SENTRY_RELEASE:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(releases.length, 2, "der saettes ikke praecis to release-id'er");
  assert.notEqual(releases[0], releases[1], "de to builds bruger SAMME release-id - beviser ingenting");

  assert.match(block, /compare-build-manifests\.mjs build-a build-b/, "sammenligningen koeres ikke");
  assert.ok(
    !/continue-on-error/.test(block),
    "jobbet har continue-on-error - gaten er advisory, ikke blokerende"
  );
  assert.match(block, /upload-artifact/, "manifest + diff uploades ikke som artifact");
  // Upload skal koere OGSAA naar sammenligningen fejlede - ellers mangler
  // artifactet praecis naar det er noedvendigt.
  assert.match(block, /if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}/);
});

test("jobbet indeholder selvtesten der beviser at gaten kan blive roed", () => {
  const block = jobBlock("build-determinism-two-builds");
  assert.match(
    block,
    /CZ_DETERMINISM_FIXTURE_DIST:\s*build-b/,
    "gate-selvtesten koerer ikke paa rigtige build-bytes"
  );
});

test("ci.yml koerer paa pull_request, saa gaten kan blokere en PR", () => {
  assert.match(ciWorkflow, /\n {2}pull_request:/);
});
