#!/usr/bin/env node
// scripts/lint-workflow-output-masking.mjs
// ============================================================
// Forward-guard mod VAGTER DER GAAR GROENNE UDEN AT MAALE NOGET (#4463).
//
// WHY (nat-vagt 30/8 09:28 UTC, run 33304153305):
//   `calendar-invariant-audit.yml` rapporterede success uden at have maalt en
//   eneste invariant. Kaeden: verify-invariants doede paa en RPC-timeout ->
//   `|| true` lod bash fortsaette med en TOM invariants.json -> parseren kastede
//   SyntaxError -> men blokken var skrevet `node ... | tee invariants.txt`, og
//   under `bash -e` UDEN `pipefail` er det SIDSTE kommandos exit-kode der
//   taeller. `tee` returnerer 0, saa steppet meldte success, `kalender_brud`
//   naaede aldrig GITHUB_OUTPUT, og baade tracking-issuet og fail-steppet blev
//   SKIPPED fordi de betinger sig af et output der ikke fandtes.
//
//   Anden gang samme fejlklasse rammer, se
//   .claude/learnings/2026-08-28-groent-flueben-der-intet-verificerede.md.
//
// RULE:
//   Skriver et `run`-step til `$GITHUB_OUTPUT`, og indeholder samme step en
//   pipe (`| tee`, `| grep`, `| wc` ...) hvis venstreside er den maaling
//   outputtet stammer fra, SKAL steppet slaa `pipefail` til. Ellers kan en
//   crash i maalingen ikke naa exit-koden, og et senere step laeser et output
//   der aldrig blev skrevet - eller springes helt over.
//
//   `shell: bash` + `set -o pipefail` (eller `set -euo pipefail`, eller
//   `shell: bash -o pipefail {0}`) opfylder reglen.
//
// Hvorfor statisk lint og ikke bare en gennemgang: fejlen er USYNLIG i loggen.
// Et groent flueben paa en vagt der intet maalte fjerner mistanken uden at
// levere daekningen - vaerre end slet ingen vagt.
//
// Usage:
//   node scripts/lint-workflow-output-masking.mjs                 # alle workflows
//   node scripts/lint-workflow-output-masking.mjs .github/workflows/foo.yml
//
// Exit codes:
//   0 - ingen fund
//   1 - mindst ét step maskerer sin egen maalings exit-kode
//
// Refs #4463 #4176.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Kommandoer i hoejre side af en pipe der returnerer 0 uanset venstresidens udfald. */
const MASKING_SINKS = /\|\s*(tee|cat|head|tail|sed|awk|grep|wc|sort|uniq|jq|tr|xargs)\b/;

/** `set -o pipefail`, `set -euo pipefail`, `set -eo pipefail` ... */
const PIPEFAIL_SET = /^\s*set\s+-[A-Za-z]*o?\s*(-[A-Za-z]*\s+)*pipefail\b|^\s*set\s+-o\s+pipefail\b/m;

/** `shell: bash -o pipefail {0}` daekker hele steppet. */
const PIPEFAIL_SHELL = /^\s*shell:\s*.*\bpipefail\b/m;

// Bevidst BAREt navn og ikke `$GITHUB_OUTPUT`: 30/8-haendelsens step skrev via
// `appendFileSync(process.env.GITHUB_OUTPUT, ...)` inde i en inline node-blok.
// En detektor der kun kender shell-formen ville have misset praecis den fejl den
// blev bygget til at fange.
const WRITES_OUTPUT = /\bGITHUB_OUTPUT\b/;

/**
 * Del en workflow-tekst i steps paa `- name:`/`- uses:`/`- id:`-listepunkter.
 * Bevidst tekstuel frem for en YAML-parser: reglen handler om SHELL-teksten i
 * `run:`-blokken, og repoet har ingen YAML-afhaengighed i scripts/.
 *
 * @param {string} source
 * @returns {Array<{ text: string, line: number, name: string }>}
 */
export function splitSteps(source) {
  const lines = source.split('\n');
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    // Et listepunkt paa steps-niveau: "      - name: ..." / "      - run: ..."
    if (/^\s+-\s+(name|uses|run|id|shell):/.test(lines[i])) starts.push(i);
  }
  return starts.map((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const text = lines.slice(start, end).join('\n');
    const nameMatch = text.match(/-\s+name:\s*(.+)/);
    return { text, line: start + 1, name: (nameMatch?.[1] ?? '(unavngivet step)').trim() };
  });
}

/**
 * Scan én workflow-kilde.
 *
 * @param {string} source
 * @param {string} file rapporteret sti
 * @returns {Array<{file: string, line: number, step: string, message: string}>}
 */
export function scanWorkflow(source, file = '<inline>') {
  const findings = [];
  for (const step of splitSteps(source)) {
    // Kommentarlinjer taeller ikke som kode: en YAML-kommentar der FORKLARER
    // fejlklassen (som blokken over workflow-output-guard i ci.yml) ville ellers
    // flage sit eget nabo-step. Kun hele kommentarlinjer fjernes, saa en `#`
    // inde i en shell-streng ikke aendrer betydning.
    const code = step.text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    if (!WRITES_OUTPUT.test(code)) continue;
    const pipe = code.match(MASKING_SINKS);
    if (!pipe) continue;
    if (PIPEFAIL_SET.test(code) || PIPEFAIL_SHELL.test(code)) continue;

    findings.push({
      file,
      line: step.line,
      step: step.name,
      message:
        `Steppet skriver til GITHUB_OUTPUT og piper til \`${pipe[1]}\` uden pipefail. ` +
        `Under bash -e taeller kun SIDSTE kommandos exit-kode, saa en crash i maalingen ` +
        `bliver et GROENT step med et manglende output - praecis kaeden i #4463.\n` +
        `      Fix: \`shell: bash\` + \`set -o pipefail\` foerst i run-blokken.`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function repoRoot() {
  return resolve(fileURLToPath(new URL('..', import.meta.url)));
}

export function defaultFiles() {
  const dir = resolve(repoRoot(), '.github/workflows');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((f) => resolve(dir, f))
    .filter((f) => statSync(f).isFile());
}

function main(argv) {
  const files = argv.length ? argv.map((f) => resolve(f)) : defaultFiles();
  const findings = [];
  for (const file of files) {
    findings.push(...scanWorkflow(readFileSync(file, 'utf8'), relative(repoRoot(), file).replace(/\\/g, '/')));
  }

  if (findings.length === 0) {
    console.log(
      `\n✅ Workflow-output-guard: ${files.length} workflow(s) scannet, ingen step maskerer ` +
      `sin egen maalings exit-kode.`
    );
    return 0;
  }

  console.error(`\n❌ Workflow-output-guard: ${findings.length} fund\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} — ${f.step}`);
    console.error(`      ${f.message}\n`);
  }
  console.error(
    'En vagt der ikke kan blive roed er ikke en vagt. Forskellen paa "intet brud" og\n' +
    '"intet maalt" skal vaere synlig. Se #4463.\n'
  );
  return 1;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
