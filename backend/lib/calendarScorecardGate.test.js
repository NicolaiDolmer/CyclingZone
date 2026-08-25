// #4215 — kalender-scorecardet som CI-gate.
//
// HVORFOR DEN HER TEST FINDES. Reglerne i docs/CALENDAR_RULES.md fandtes allerede, men
// intet stoppede en kalender der brød dem. #4155 skrev game_day forkert og brød
// TIER_OVERLAP_CAP i alle fire divisioner uden at nogen opdagede det; #4161 måtte rydde
// op bagefter. Scorecardet fandt 25/8 to reelle brud (D3 for lidt kuperet, D4 for meget
// bjerg) — men kun fordi et menneske huskede at køre det manuelt.
//
// Testen kører scriptet som subproces og hænger på EXIT-KODEN, ikke på output-teksten.
// Det er med vilje: teksten er til mennesker og må gerne ændre sig, mens exit-koden er
// kontrakten CI og sæsonskifte-preflighten deler.
//
// Scriptet er rent og DB-frit (prod-fixture + rene funktioner), så det kan køre i CI
// uden credentials — samme grund til at det kan køre FØR en kalender skrives.
//
// Refs #4215 #4176 #4218 #4155 #4161

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "scripts", "dev", "calendarScorecard4218.mjs");

function kør(args = []) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8", timeout: 120_000,
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: String(err.stdout ?? "") };
  }
}

test("#4215: den planlagte S3-kalender passerer alle gates i CALENDAR_RULES.md", () => {
  const { code, stdout } = kør();
  assert.equal(code, 0, `scorecardet fandt regelbrud:\n${stdout}`);
  assert.match(stdout, /SAMLET: 0 regelbrud/);
  assert.match(stdout, /dækning OK/);
});

test("#4215: --json bærer samme dom som tabellen", () => {
  const { code, stdout } = kør(["--json"]);
  assert.equal(code, 0);
  const rapport = JSON.parse(stdout);
  assert.equal(rapport.ok, true);
  assert.equal(rapport.regelbrud, 0);
  assert.equal(rapport.dækning.ok, true);
  assert.equal(rapport.tiers.length, 4, "alle fire divisioner skal måles");
});

// Gaten skal kunne SIGE FRA. En gate der aldrig fejler beviser ingenting — og det var
// præcis tilstanden før: reglerne var konstanter generatoren forsøgte at ramme.
// 35 dage overstiger hvad kataloget kan fylde, så divisionerne får tomme kalenderdage.
test("#4215: gaten fejler når kalenderen ikke kan fyldes (exit 1, ikke bare en advarsel)", () => {
  const { code, stdout } = kør(["--days=35"]);
  assert.equal(code, 1, "for mange dage skal give exit 1");
  assert.match(stdout, /HULLER|FEJL/);
});

test("#4215: hver division måles for sig — ikke spillet som helhed", () => {
  const { stdout } = kør(["--days=35"]);
  // D1 har flest løb og fyldes længst; et hul i en LAVERE division må ikke drukne
  // i et samlet tal. Beskeden skal navngive divisionen.
  assert.match(stdout, /division \d har \d+ kalenderdag\(e\) uden løb/);
});
