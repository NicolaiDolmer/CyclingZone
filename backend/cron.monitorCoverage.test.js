// #3269/#2892 · Forward-guard: hver periodisk cron-job i backend/cron.js SKAL
// enten (a) have et monitorCron(...)-kald der matcher en ALL_CRON_MONITORS-
// entry i lib/cronMonitorRegistry.js, ELLER (b) stå eksplicit i
// UNMONITORED_CRON_TICKS med en begrundelse. Uden dette primes dens Sentry-
// monitor aldrig ved boot og missed-run-alarmer bliver upålidelige (samme
// klasse fejl som ai-recovery-sweep-gappet, lukket i PR #3267, og
// global-rank-weekly-snapshot/balance-drift-watch/rider-double-booking-watch/
// intake-offer-expiry-gapperne, lukket i PR #3284).
//
// #2892 udvidede testen med en TREDJE kontrol: et helt NYT periodisk
// setInterval(trackedTick(...), ...)-job der glemmer monitorCron(...) HELT
// (ikke bare glemmer ALL_CRON_MONITORS-entryen) blev tidligere slet ikke
// fanget, fordi de to første tests kun ser på eksisterende monitorCron(...)-
// kald. Se "hvert periodisk ..." testen nedenfor.
//
// ALL_CRON_MONITORS + UNMONITORED_CRON_TICKS importeres nu direkte fra
// lib/cronMonitorRegistry.js (rent data-modul, ingen side-effects — sikkert
// at importere i test uden SUPABASE_URL/.env). monitorCron(...)-kaldene i
// selve cron.js parses stadig som RÅ TEKST (statisk analyse), fordi de er
// kode-struktur, ikke data — parsing fanger fremtidige kald uafhængigt af
// hvordan cron.js's øvrige eksports udvikler sig.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ALL_CRON_MONITORS, UNMONITORED_CRON_TICKS } from "./lib/cronMonitorRegistry.js";

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

// startCron()'s periodiske registrerings-blok: fra "export function
// startCron() {" til kommentaren "// Run immediately on start" — alt derefter
// er engangs-boot-kald (ingen "missed"-semantik giver mening for dem).
function extractStartCronScheduleBody(src) {
  const startMarker = "export function startCron() {";
  const endMarker = "// Run immediately on start";
  const start = src.indexOf(startMarker);
  assert.ok(start !== -1, "startCron()-funktion ikke fundet i cron.js — er filen omstruktureret?");
  const end = src.indexOf(endMarker, start);
  assert.ok(end !== -1, "'// Run immediately on start'-markør ikke fundet efter startCron()");
  return src.slice(start + startMarker.length, end);
}

// Splitter schedule-body op i ét chunk pr. setInterval(...)-registrering og
// afgør for hver om den er monitorCron-wrappet. Chunking (i stedet for en
// enkelt regex over hele blokken) håndterer at flere setInterval-kald ligger
// lige efter hinanden (fx email-sweepene) uden at ét kalds monitorCron(...)
// fejlagtigt "lækker" ind i naboens match.
function extractPeriodicTicks(scheduleBody) {
  const chunks = scheduleBody
    .split(/(?=setInterval\()/g)
    .filter((chunk) => chunk.startsWith("setInterval("));

  return chunks.map((chunk) => {
    const labelMatch = chunk.match(/trackedTick\(\s*["']([^"']+)["']/);
    assert.ok(labelMatch, `setInterval(...)-kald uden genkendeligt trackedTick("label", ...)-kald: ${chunk.slice(0, 80)}…`);
    return { label: labelMatch[1], monitored: /monitorCron\(/.test(chunk) };
  });
}

test("hver monitorCron(...)-slug i cron.js har en ALL_CRON_MONITORS-entry (forward-guard, #3269)", () => {
  const calledSlugs = extractMonitorCronSlugs(CRON_SRC);
  const registeredSlugs = new Set(ALL_CRON_MONITORS.map(([slug]) => slug));

  assert.ok(calledSlugs.size >= 30, `forventer mange monitorCron-kald fundet (fik ${calledSlugs.size}) — parser regex knækket?`);
  assert.ok(registeredSlugs.size >= 30, `forventer mange ALL_CRON_MONITORS-entries fundet (fik ${registeredSlugs.size}) — er lib/cronMonitorRegistry.js omstruktureret?`);

  const missing = [...calledSlugs].filter((slug) => !registeredSlugs.has(slug));
  assert.deepEqual(
    missing,
    [],
    `monitorCron-slug(s) mangler ALL_CRON_MONITORS-entry i lib/cronMonitorRegistry.js (Sentry-monitor primes ikke ved boot): ${missing.join(", ")}`
  );
});

test("ALL_CRON_MONITORS har ingen ukendte entries uden tilsvarende monitorCron-kald (dead-entry-guard)", () => {
  const calledSlugs = extractMonitorCronSlugs(CRON_SRC);
  const registeredSlugs = new Set(ALL_CRON_MONITORS.map(([slug]) => slug));

  const stale = [...registeredSlugs].filter((slug) => !calledSlugs.has(slug));
  assert.deepEqual(
    stale,
    [],
    `ALL_CRON_MONITORS-entry i lib/cronMonitorRegistry.js uden tilsvarende monitorCron-kald i cron.js (dødt array-item?): ${stale.join(", ")}`
  );
});

test("de 4 gaps fra #3269 er nu dækket", () => {
  const registeredSlugs = new Set(ALL_CRON_MONITORS.map(([slug]) => slug));
  for (const slug of [
    "global-rank-weekly-snapshot",
    "balance-drift-watch",
    "rider-double-booking-watch",
    "intake-offer-expiry",
  ]) {
    assert.ok(registeredSlugs.has(slug), `${slug} mangler stadig i ALL_CRON_MONITORS`);
  }
});

test("hvert periodisk setInterval(trackedTick(...))-job er enten monitorCron-wrappet eller eksplicit allowlistet (#2892)", () => {
  const scheduleBody = extractStartCronScheduleBody(CRON_SRC);
  const ticks = extractPeriodicTicks(scheduleBody);

  assert.ok(ticks.length >= 30, `forventer mange periodiske setInterval-jobs fundet (fik ${ticks.length}) — chunking-regex knækket?`);

  const unmonitored = ticks.filter((t) => !t.monitored).map((t) => t.label);
  const allowlist = new Set(UNMONITORED_CRON_TICKS);
  const unexpected = unmonitored.filter((label) => !allowlist.has(label));

  assert.deepEqual(
    unexpected,
    [],
    `periodisk cron-job uden monitorCron(...) OG uden UNMONITORED_CRON_TICKS-entry (jobbet kan dø tavst uden alarm): ${unexpected.join(", ")} — ` +
      `tilføj enten monitorCron("slug", fn, CRON_MONITOR_*) + en ALL_CRON_MONITORS-entry, eller (med begrundelse) labellen til ` +
      `UNMONITORED_CRON_TICKS i backend/lib/cronMonitorRegistry.js`
  );

  // Dead-entry-guard den anden vej: en UNMONITORED_CRON_TICKS-label der ikke
  // (længere) matcher noget periodisk job er en stale allowlist-entry —
  // fjern den, ellers skjuler den fremtidige reelle huller.
  const allLabels = new Set(ticks.map((t) => t.label));
  const staleAllowlist = [...allowlist].filter((label) => !allLabels.has(label));
  assert.deepEqual(
    staleAllowlist,
    [],
    `UNMONITORED_CRON_TICKS-entry uden tilsvarende periodisk setInterval-job (dødt allowlist-item?): ${staleAllowlist.join(", ")}`
  );
});
