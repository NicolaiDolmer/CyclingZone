#!/usr/bin/env node
// scripts/summarize-invariant-report.mjs
// ============================================================
// Laeser `verify-invariants.js --json` og oversaetter den til den laesbare rapport
// + de taellinger `calendar-invariant-audit.yml` gater paa (#4463).
//
// WHY (nat-vagt 30/8 09:28 UTC, run 33304153305):
//   Parseren stod som en inline heredoc i workflowet, skrevet
//   `node --input-type=module - <<'NODE' | tee invariants.txt`. Kaeden der gjorde
//   vagten groen uden at maale noget:
//     1. verify-invariants doede paa `rpc verify_race_result_duplicates:
//        HTTP 500 statement timeout` (kendt langsom, #4204).
//     2. `|| true` lod bash fortsaette med en TOM invariants.json.
//     3. Parseren kastede `SyntaxError: Unexpected end of JSON input`.
//     4. Under `bash -e` uden `pipefail` er det SIDSTE kommandos exit-kode der
//        taeller, og `tee` returnerer 0 — steppet meldte success.
//     5. `kalender_brud` naaede aldrig GITHUB_OUTPUT, saa baade tracking-issuet
//        og fail-steppet blev SKIPPED, fordi de betinger sig af et output der
//        ikke fandtes.
//   Et groent flueben paa en vagt der ikke maalte noget. Anden gang samme
//   fejlklasse rammer, se .claude/learnings/2026-08-28-groent-flueben-der-intet-
//   verificerede.md.
//
// RULE:
//   Forskellen paa "intet brud" og "intet maalt" skal vaere SYNLIG. Rapporten
//   afvises derfor haardt naar filen mangler, er tom, ikke er gyldig JSON, eller
//   ikke indeholder et `checks`-objekt med mindst én invariant. Kun en rapport
//   der beviseligt er maalt giver taellinger videre til gaten.
//
// Som selvstaendig fil frem for en heredoc: den kan unit-testes (den her vagt
// SKAL kunne bevises), og dens exit-kode kan ikke sluges af en pipe.
//
// Usage:
//   node scripts/summarize-invariant-report.mjs invariants.json > invariants.txt
//   node scripts/summarize-invariant-report.mjs            # default invariants.json
//
// Skriver `kalender_brud` + `oevrige_brud` til $GITHUB_OUTPUT naar den er sat.
//
// Exit codes:
//   0 — rapporten er maalt og opsummeret (uanset om der ER brud)
//   1 — rapporten mangler, er tom eller ugyldig: der blev IKKE maalt noget
//
// Refs #4463 #4176 #4204.

import { readFileSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Kalender-invarianterne er dem gaten blokerer paa; de kendes paa navne-praefikset. */
export const CALENDAR_PREFIX = 'calendar_';

/**
 * Fejl der betyder "der blev ikke maalt noget" — til forskel fra "der blev maalt
 * et brud". Kun den foerste maa faa vagten til at fejle som en maalefejl.
 */
export class MeasurementError extends Error {}

/**
 * Oversaet raa JSON-tekst til rapport + taellinger.
 *
 * @param {string} raw indholdet af invariants.json
 * @param {string} source sti/navn til brug i fejlteksten
 * @returns {{ report: string, kalenderBrud: number, oevrigeBrud: number, checked: number }}
 * @throws {MeasurementError} naar der ikke er maalt noget brugbart
 */
export function summarize(raw, source = 'invariants.json') {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new MeasurementError(
      `${source} er TOM. verify-invariants naaede ikke at skrive en rapport — ` +
      `det er "intet maalt", ikke "intet brud".`
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new MeasurementError(
      `${source} er ikke gyldig JSON (${err.message}). verify-invariants doede ` +
      `sandsynligvis midt i koerslen — der blev ikke maalt noget.`
    );
  }

  const checks = data?.checks;
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) {
    throw new MeasurementError(
      `${source} mangler et \`checks\`-objekt. Rapporten er ufuldstaendig — ` +
      `der blev ikke maalt noget.`
    );
  }

  const rows = Object.entries(checks);
  if (rows.length === 0) {
    throw new MeasurementError(
      `${source} indeholder NUL invarianter. En tom maaling er ikke et groent svar.`
    );
  }

  const kalenderBrud = rows.filter(([n, c]) => n.startsWith(CALENDAR_PREFIX) && !c?.ok);
  const oevrigeBrud = rows.filter(([n, c]) => !n.startsWith(CALENDAR_PREFIX) && !c?.ok);

  const lines = [];
  for (const [name, c] of rows) lines.push(`${c?.ok ? '[ok]  ' : '[FEJL]'} ${name}: ${c?.detail ?? ''}`);
  for (const [, c] of kalenderBrud) {
    for (const v of c?.violations ?? []) lines.push('   ' + JSON.stringify(v));
  }
  lines.push('');
  lines.push(
    `${rows.length} invariant(er) maalt — ${kalenderBrud.length} kalender-brud, ` +
    `${oevrigeBrud.length} oevrige brud.`
  );

  return {
    report: lines.join('\n'),
    kalenderBrud: kalenderBrud.length,
    oevrigeBrud: oevrigeBrud.length,
    checked: rows.length,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main(argv) {
  const file = resolve(argv[0] ?? 'invariants.json');

  if (!existsSync(file) || !statSync(file).isFile()) {
    console.error(
      `::error::${file} findes ikke. verify-invariants skrev ingen rapport — ` +
      `vagten maalte INTET (#4463).`
    );
    return 1;
  }

  let result;
  try {
    result = summarize(readFileSync(file, 'utf8'), file);
  } catch (err) {
    if (!(err instanceof MeasurementError)) throw err;
    console.error(`::error::${err.message} Se verify-invariants-loggen ovenfor (#4463).`);
    return 1;
  }

  console.log(result.report);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `kalender_brud=${result.kalenderBrud}\noevrige_brud=${result.oevrigeBrud}\nmaalt=${result.checked}\n`
    );
  }
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
