// #3269 · Forward-guard: hver monitorCron(...)-slug i backend/cron.js SKAL have
// en tilsvarende entry i ALL_CRON_MONITORS (boot-priming-arrayet), ellers primes
// dens Sentry-monitor aldrig ved boot og missed-run-alarmer bliver upålidelige
// (samme klasse fejl som ai-recovery-sweep-gappet, lukket i PR #3267, og
// global-rank-weekly-snapshot/balance-drift-watch/rider-double-booking-watch/
// intake-offer-expiry-gapperne, lukket i denne PR).
//
// Testen parser backend/cron.js som RÅ TEKST (statisk analyse) i stedet for at
// importere ALL_CRON_MONITORS — den skal fange fremtidige monitorCron(...)-kald
// uden entry, uafhængigt af om arrayet nogensinde eksporteres.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CRON_SRC = readFileSync(join(HERE, "cron.js"), "utf8");

// Alle monitorCron("slug", ...)-kald — første argument er altid et string-literal.
// (import-linjen "import { ..., monitorCron, ... }" matcher ikke, da den ikke har
// en åbningsparentes lige efter navnet.)
function extractMonitorCronSlugs(src) {
  const re = /\bmonitorCron\(\s*["']([a-zA-Z0-9_-]+)["']/g;
  const slugs = new Set();
  let m;
  while ((m = re.exec(src)) !== null) slugs.add(m[1]);
  return slugs;
}

// ALL_CRON_MONITORS-arrayet: fra "const ALL_CRON_MONITORS = [" til den
// afsluttende "];" på sit eget niveau (arrayet indeholder ingen nestede
// arrays/objekter, så en simpel indtil-næste-"];"-scan er tilstrækkelig).
function extractAllCronMonitorsSlugs(src) {
  const startMarker = "const ALL_CRON_MONITORS = [";
  const start = src.indexOf(startMarker);
  assert.ok(start !== -1, "ALL_CRON_MONITORS-array ikke fundet i cron.js — er filen omstruktureret?");
  const end = src.indexOf("];", start);
  assert.ok(end !== -1, "afsluttende '];' for ALL_CRON_MONITORS ikke fundet");
  const block = src.slice(start + startMarker.length, end);

  const re = /\[\s*["']([a-zA-Z0-9_-]+)["']\s*,/g;
  const slugs = new Set();
  let m;
  while ((m = re.exec(block)) !== null) slugs.add(m[1]);
  return slugs;
}

test("hver monitorCron(...)-slug i cron.js har en ALL_CRON_MONITORS-entry (forward-guard, #3269)", () => {
  const calledSlugs = extractMonitorCronSlugs(CRON_SRC);
  const registeredSlugs = extractAllCronMonitorsSlugs(CRON_SRC);

  assert.ok(calledSlugs.size >= 30, `forventer mange monitorCron-kald fundet (fik ${calledSlugs.size}) — parser regex knækket?`);
  assert.ok(registeredSlugs.size >= 30, `forventer mange ALL_CRON_MONITORS-entries fundet (fik ${registeredSlugs.size}) — parser regex knækket?`);

  const missing = [...calledSlugs].filter((slug) => !registeredSlugs.has(slug));
  assert.deepEqual(
    missing,
    [],
    `monitorCron-slug(s) mangler ALL_CRON_MONITORS-entry (Sentry-monitor primes ikke ved boot): ${missing.join(", ")}`
  );
});

test("ALL_CRON_MONITORS har ingen ukendte entries uden tilsvarende monitorCron-kald (dead-entry-guard)", () => {
  const calledSlugs = extractMonitorCronSlugs(CRON_SRC);
  const registeredSlugs = extractAllCronMonitorsSlugs(CRON_SRC);

  const stale = [...registeredSlugs].filter((slug) => !calledSlugs.has(slug));
  assert.deepEqual(
    stale,
    [],
    `ALL_CRON_MONITORS-entry uden tilsvarende monitorCron-kald (dødt array-item?): ${stale.join(", ")}`
  );
});

test("de 4 gaps fra #3269 er nu dækket", () => {
  const registeredSlugs = extractAllCronMonitorsSlugs(CRON_SRC);
  for (const slug of [
    "global-rank-weekly-snapshot",
    "balance-drift-watch",
    "rider-double-booking-watch",
    "intake-offer-expiry",
  ]) {
    assert.ok(registeredSlugs.has(slug), `${slug} mangler stadig i ALL_CRON_MONITORS`);
  }
});
