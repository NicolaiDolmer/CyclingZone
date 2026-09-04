// #4644 — Forward-guard: hver setInterval(24h)-registrering i backend/cron.js
// SKAL enten (a) have et boot-run af SAMME funktionsnavn i boot-blokken ("Run
// immediately on start" og nedefter i startCron()), ELLER (b) være registreret
// via en kalender-styret kadence (fx en fremtidig scheduleDailyAt(...)-helper)
// i stedet for et rå 24h setInterval.
//
// Rod-årsag (#4644, postmortem .claude/learnings/2026-09-02-reconcile-24h-
// interval-nulstilles-af-deploy-koerte-aldrig.md): setInterval(24h) måler fra
// PROCES-start, ikke fra ur. Et 24h-job uden boot-run når reelt sjældent eller
// aldrig 24 sammenhængende timer, fordi backend'en deployer oftere end
// dagligt — jobbet kører i praksis aldrig, uden at nogen alarm fanger det
// (boot-priming af Sentry-monitoren, #2440, tilgiver bevidst deploy-genstarter
// og skjuler derfor præcis dette hul).
//
// Statisk tekst-parsing af cron.js (samme disciplin som
// cron.monitorCoverage.test.js): koden ER strukturen her, ikke data — parsing
// fanger fremtidige 24h-registreringer uafhængigt af hvordan resten af filen
// udvikler sig.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CRON_SRC = readFileSync(join(HERE, "cron.js"), "utf8");

const START_MARKER = "export function startCron() {";
const BOOT_MARKER = "// Run immediately on start";

// Kalender-styrede helpers der (i modsætning til rå setInterval(24h)) selv
// bestemmer NÆSTE kørsel fra uret, ikke fra proces-start — accepteres som
// alternativ til boot-run. Ingen findes i cron.js i dag (#4644 løste med
// boot-run alene), men guarden skal ikke fejlagtigt kræve boot-run af et
// fremtidigt job der allerede er kalender-styret.
const CALENDAR_SCHEDULER_PATTERN = /\bscheduleDailyAt\s*\(/;

function extractStartCronBody(src) {
  const start = src.indexOf(START_MARKER);
  assert.ok(start !== -1, "startCron()-funktion ikke fundet i cron.js — er filen omstruktureret?");
  const bootMarkerIdx = src.indexOf(BOOT_MARKER, start);
  assert.ok(bootMarkerIdx !== -1, "'// Run immediately on start'-markør ikke fundet efter startCron()");

  // Boot-blokken slutter ved startCron()'s lukke-brace: en linje der er PRÆCIS
  // "}" ved kolonne 0 (funktionen selv ligger på modul-niveau, ingen indrykning).
  // \r? tåler CRLF (cron.js har Windows-linjeskift).
  const closeBraceMatch = src.slice(bootMarkerIdx).match(/\r?\n\}\r?\n/);
  assert.ok(closeBraceMatch, "startCron()'s lukke-brace ikke fundet efter boot-markøren");
  const bootEnd = bootMarkerIdx + closeBraceMatch.index;

  return {
    scheduleBody: src.slice(start + START_MARKER.length, bootMarkerIdx),
    // Boot-run-kald findes to steder i praksis: samlet i "Run immediately on
    // start"-blokken nederst, ELLER lige efter selve setInterval-registreringen
    // (fx alunta forfalds-vagt/reconcile, #4514/#4536) — hasBootRun() skal
    // derfor kunne se HELE startCron()-kroppen, ikke kun bund-blokken. Et ægte
    // boot-run kendes på det afsluttende "()" der faktisk INVOKERER
    // trackedTick(...); den rene setInterval-registrering har ikke det.
    bootBody: src.slice(start + START_MARKER.length, bootEnd),
  };
}

// Splitter schedule-body op i ét chunk pr. setInterval(...)-registrering
// (samme chunking-strategi som cron.monitorCoverage.test.js), filtrerer til
// dem med et 24-timers interval, og udtrækker for hver: dens trackedTick-label
// OG dens underliggende funktionsnavn (sidste identifier lige før intervallets
// lukke-parentes — enten direkte 2. argument til trackedTick, eller 2.
// argument til en indlejret monitorCron(...)-wrapper).
function extractDaily24hTicks(scheduleBody) {
  const chunks = scheduleBody.split(/(?=setInterval\()/g).filter((chunk) => chunk.startsWith("setInterval("));

  const daily = chunks.filter((chunk) => /24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(chunk));

  return daily.map((chunk) => {
    const labelMatch = chunk.match(/trackedTick\(\s*["']([^"']+)["']/);
    assert.ok(labelMatch, `24h setInterval(...)-kald uden genkendeligt trackedTick("label", ...)-kald: ${chunk.slice(0, 100)}…`);

    // monitorCron("slug", fnName, CRON_MONITOR_24H) — fnName er 2. argument.
    const monitorMatch = chunk.match(/monitorCron\(\s*["'][^"']+["']\s*,\s*([A-Za-z0-9_]+)\s*,/);
    // Uwrappet: trackedTick("label", fnName) uden monitorCron imellem.
    const bareMatch = chunk.match(/trackedTick\(\s*["'][^"']+["']\s*,\s*([A-Za-z0-9_]+)\s*\)/);
    const fnName = monitorMatch?.[1] ?? bareMatch?.[1];
    assert.ok(fnName, `kunne ikke udtrække funktionsnavn fra 24h-registrering "${labelMatch[1]}" — er kald-formen ændret?`);

    return { label: labelMatch[1], fnName };
  });
}

// Finder hvert trackedTick(...)-kald i `body` med BALANCERET parentes-parsing
// (regex alene knækker på labels der selv indeholder "(" — fx "alunta
// forfalds-vagt (boot)") og afgør om det er et ægte boot-run: kaldet skal
// selv INVOKERES med et afsluttende "()" lige efter trackedTick(...)'s egen
// lukke-parentes (en ren setInterval-registrering har ikke det).
function findTrackedTickCalls(body) {
  const calls = [];
  const callRe = /trackedTick\s*\(/g;
  while (callRe.exec(body) !== null) {
    const argsStart = callRe.lastIndex;
    let depth = 1;
    let i = argsStart;
    while (i < body.length && depth > 0) {
      if (body[i] === "(") depth++;
      else if (body[i] === ")") depth--;
      i++;
    }
    if (depth !== 0) continue; // ubalanceret — filen er malformed, spring over
    const args = body.slice(argsStart, i - 1);
    const afterClose = body.slice(i).match(/^\s*\(\s*\)/);
    calls.push({ args, invoked: Boolean(afterClose) });
  }
  return calls;
}

function hasBootRun(body, fnName) {
  const fnRe = new RegExp(`\\b${fnName}\\b`);
  return findTrackedTickCalls(body).some((call) => call.invoked && fnRe.test(call.args));
}

test("hvert 24h setInterval-job i cron.js har enten boot-run eller kalender-kadence (#4644)", () => {
  const { scheduleBody, bootBody } = extractStartCronBody(CRON_SRC);
  const dailyTicks = extractDaily24hTicks(scheduleBody);

  assert.ok(dailyTicks.length >= 10, `forventer mange 24h-registreringer fundet (fik ${dailyTicks.length}) — parser-regex knækket?`);

  const uncovered = dailyTicks.filter(
    ({ fnName }) => !hasBootRun(bootBody, fnName) && !CALENDAR_SCHEDULER_PATTERN.test(bootBody + scheduleBody)
  );

  assert.deepEqual(
    uncovered.map((t) => t.label),
    [],
    `24h-job(s) uden boot-run OG uden kalender-kadence — de vil reelt aldrig køre mellem to deploys (#4644): ${uncovered
      .map((t) => `${t.label} (${t.fnName})`)
      .join(", ")} — tilføj enten en trackedTick("label", ${uncovered[0]?.fnName ?? "fnName"})()-linje i boot-blokken (kun hvis idempotent!) eller flyt jobbet til en kalender-styret kadence`
  );
});

test("de to #4644-jobs (growth snapshot, global rank weekly snapshot) har nu boot-run", () => {
  const { bootBody } = extractStartCronBody(CRON_SRC);
  for (const fnName of ["runGrowthSnapshotCron", "runGlobalRankWeeklySnapshotCron"]) {
    assert.ok(hasBootRun(bootBody, fnName), `${fnName} mangler stadig boot-run i startCron()`);
  }
});
