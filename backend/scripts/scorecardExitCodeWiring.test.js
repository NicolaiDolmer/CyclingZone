// #3009 forward-guard (integration-niveau): spawner de to scorecards buggen blev
// rapporteret på (moneySupplyScorecard.js, inflationScorecard.js) som ægte child-
// processer og verificerer at den printede HEADLINE-verdikt matcher den faktiske
// exit-kode. Testen parser det RIGTIGE output i stedet for at hardcode PASS/FAIL,
// så den forbliver gyldig uanset om økonomien senere kalibreres til PASS — hvad
// den låser fast er invarianten "FAIL => non-zero exit, PASS => exit 0", ikke det
// aktuelle (i skrivende stund røde) resultat.
//
// sponsorChoiceScorecard.js (scripts/, samme fejlklasse fundet under #3009's
// backwards-check) er bevidst UDELADT her: den kræver live Supabase-service-role-
// credentials (ikke bare read-only) og kan derfor ikke køres i CI/lokalt test-run
// uden secrets — fixet og verificeret ved kode-gennemgang, se PR-beskrivelsen.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function run(scriptName, args) {
  return spawnSync(process.execPath, [path.join(SCRIPT_DIR, scriptName), ...args], {
    encoding: "utf8",
    cwd: SCRIPT_DIR,
  });
}

// Finder HEADLINE-linjen og returnerer "PASS" eller "FAIL" — kaster hvis linjen
// mangler eller ikke indeholder et af de to (så testen fejler højlydt i stedet
// for at glide stille forbi, hvis en fremtidig ændring omformulerer HEADLINE).
function headlineVerdict(stdout, headlineLabel) {
  const line = stdout.split("\n").find((l) => l.includes(headlineLabel));
  assert.ok(line, `forventede en HEADLINE-linje der indeholder "${headlineLabel}" i output:\n${stdout}`);
  if (line.includes("❌ FAIL")) return "FAIL";
  if (line.includes("✅ PASS")) return "PASS";
  throw new Error(`kunne ikke parse PASS/FAIL fra HEADLINE-linjen: ${line}`);
}

test("moneySupplyScorecard --synthetic-only: exit-kode matcher HEADLINE-verdikt", () => {
  const result = run("moneySupplyScorecard.js", ["--synthetic-only"]);
  const verdict = headlineVerdict(result.stdout, "HEADLINE: syntetisk net-gate");
  if (verdict === "FAIL") {
    assert.notEqual(result.status, 0, `HEADLINE FAIL skal give non-zero exit-kode (fik ${result.status})`);
  } else {
    assert.equal(result.status, 0, `HEADLINE PASS skal give exit-kode 0 (fik ${result.status})`);
  }
});

test("moneySupplyScorecard --synthetic-only --advisory: exit 0 uanset verdikt", () => {
  const result = run("moneySupplyScorecard.js", ["--synthetic-only", "--advisory"]);
  headlineVerdict(result.stdout, "HEADLINE: syntetisk net-gate"); // verdikten printes stadig
  assert.equal(result.status, 0, "--advisory skal altid exit 0 (report-only), uanset PASS/FAIL");
});

test("inflationScorecard (default, ingen --live): exit-kode matcher HEADLINE-verdikt", () => {
  const result = run("inflationScorecard.js", []);
  const verdict = headlineVerdict(result.stdout, "HEADLINE: inflations-gate");
  if (verdict === "FAIL") {
    assert.notEqual(result.status, 0, `HEADLINE FAIL skal give non-zero exit-kode (fik ${result.status})`);
  } else {
    assert.equal(result.status, 0, `HEADLINE PASS skal give exit-kode 0 (fik ${result.status})`);
  }
});

test("inflationScorecard --advisory: exit 0 uanset verdikt", () => {
  const result = run("inflationScorecard.js", ["--advisory"]);
  headlineVerdict(result.stdout, "HEADLINE: inflations-gate");
  assert.equal(result.status, 0, "--advisory skal altid exit 0 (report-only), uanset PASS/FAIL");
});
