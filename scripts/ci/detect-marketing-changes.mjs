// scripts/ci/detect-marketing-changes.mjs
// ============================================================
// #5424: "marketing-changes"-jobbet i .github/workflows/ci.yml sprang stille
// over paa push/merge_group, fordi selve detektions-trinnet kun koerte ved
// `if: github.event_name == 'pull_request'` - outputtet blev derfor TOMT
// (ikke "false") paa push/merge queue, og marketing-lint-build blev aldrig
// koert efter et merge, uanset om marketing/ rent faktisk var aendret. Samme
// fejlklasse som #4463 ("en vagt der gaar groen uden at maale noget").
//
// Denne fil rummer kun den RENE afgoerelse (rører en filliste marketing/?),
// adskilt fra YAML'ens gh api-/compare-logik, saa den kan enhedstestes uden
// en GitHub Actions-runner (node --test scripts/ci/detect-marketing-changes.test.mjs).
// Selve workflow-jobbet kalder denne fil som CLI for alle tre event-typer
// (pull_request, push, merge_group) og en ukendt/fremtidig event-type koerer
// jobbet i stedet for at gaette "ingen aendringer" (se ci.yml's kommentar).
//
// CLI: laeser newline-separerede filstier fra stdin, printer "true" eller
// "false" til stdout. Tomme linjer ignoreres.
//
//   printf '%s\n' "$FILES" | node scripts/ci/detect-marketing-changes.mjs
//
// Refs #5424 #4463.

import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKETING_PATH_RE = /^marketing\//;

/** @param {string[]} files @returns {boolean} */
export function marketingChanged(files) {
  return files.some((f) => MARKETING_PATH_RE.test(f));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdin();
  const files = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  process.stdout.write(marketingChanged(files) ? "true\n" : "false\n");
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  // CodeRabbit-fund (denne PR, #5424): `process.exit(code)` kan afbryde en
  // endnu-ikke-flushet stdout-write naar stdout er piped/capture (som her -
  // workflowet laeser scriptets stdout via $()). `process.exitCode` lader
  // Node afslutte naturligt, EFTER skrivningen er flushet.
  main().then((code) => {
    process.exitCode = code;
  });
}
