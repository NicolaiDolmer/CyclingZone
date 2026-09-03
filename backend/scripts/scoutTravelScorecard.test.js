// #3853 — regressionstjek for scoutTravelScorecard.js's nye kadence-følsomme
// input (sektion B: teoretisk spend-loft som funktion af missionsvarighed).
// Mønster: spawner scriptet som ægte child-proces og parser output (samme
// tilgang som scorecardExitCodeWiring.test.js), ikke import af interne
// funktioner — scriptet har intet import.meta.url-guard, og et direkte import
// ville køre hele main() (inkl. LIVE-forsøget) som en test-import-sideeffekt.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [path.join(SCRIPT_DIR, "scoutTravelScorecard.js"), ...args], {
    encoding: "utf8",
    cwd: SCRIPT_DIR,
  });
}

// "Missioner/sæson (11 uger)    : 77.00 × 6.000 = 462.000" → 462000
function extractSeasonSpend(stdout) {
  const line = stdout.split("\n").find((l) => l.includes("Missioner/sæson (11 uger)"));
  assert.ok(line, `forventede en "Missioner/sæson"-linje i output:\n${stdout}`);
  const match = line.match(/=\s*([\d.]+)\s*$/);
  assert.ok(match, `kunne ikke parse spend-tallet fra linjen: ${line}`);
  return Number(match[1].replace(/\./g, ""));
}

function extractMissionDaysLabel(stdout) {
  const line = stdout.split("\n").find((l) => l.includes("Missionsdage (input)"));
  assert.ok(line, `forventede en "Missionsdage (input)"-linje i output:\n${stdout}`);
  return line;
}

test("#3853 default (ingen --mission-days): bruger LIVE SCOUT_JOB_CONFIG.mission.days, ikke en fast antagelse", () => {
  const result = run([]);
  assert.equal(result.status, 0);
  const label = extractMissionDaysLabel(result.stdout);
  assert.match(label, /Missionsdage \(input\)\s*: 1 \(= live config\)/, `forventede dage=1 (= live config): ${label}`);
});

test("#3853 --mission-days er kadence-følsomt: halvering af missionsdage FORDOBLER det teoretiske missions-spend/sæson", () => {
  const oneDay = run(["--mission-days=1"]);
  const twoDay = run(["--mission-days=2"]);
  assert.equal(oneDay.status, 0);
  assert.equal(twoDay.status, 0);

  const spend1 = extractSeasonSpend(oneDay.stdout);
  const spend2 = extractSeasonSpend(twoDay.stdout);

  assert.ok(spend1 > spend2, `1-dags spend (${spend1}) skal være større end 2-dags spend (${spend2})`);
  // Kontinuerlig-genkø-modellen er lineær i 1/mission.days — halveret varighed
  // skal fordoble missions/måned og dermed spend/sæson (±1% afrundingstolerance).
  const ratio = spend1 / spend2;
  assert.ok(Math.abs(ratio - 2) < 0.01, `forventede ratio ~2.0 (1-dag vs 2-dag), fik ${ratio.toFixed(4)}`);
});

test("#3853 --mission-days=<overstyret værdi>: viser eksplicit OVERSTYRET-label når input afviger fra live config", () => {
  const result = run(["--mission-days=2"]);
  assert.equal(result.status, 0);
  const label = extractMissionDaysLabel(result.stdout);
  assert.match(label, /Missionsdage \(input\)\s*: 2 \(OVERSTYRET — live config = 1\)/, label);
});

test("#3853 --mission-days=0 (ugyldigt input): fejler højlydt (non-zero exit), stille ingen NaN i output", () => {
  const result = run(["--mission-days=0"]);
  assert.notEqual(result.status, 0, "ugyldig kadence skal give non-zero exit, ikke et stille NaN-resultat");
  assert.doesNotMatch(result.stdout + result.stderr, /NaN/);
});

test("#3853 --mission-days ændrer IKKE profil-gatens (sektion A) HEADLINE/exit-kode — kun sektion B er kadence-følsom", () => {
  const defaultRun = run([]);
  const overrideRun = run(["--mission-days=2"]);
  const headline = (stdout) => stdout.split("\n").find((l) => l.includes("HEADLINE: scout-travel-cost-gate"));
  assert.equal(headline(defaultRun.stdout), headline(overrideRun.stdout), "profil-gatens HEADLINE må ikke flytte sig med --mission-days");
  assert.equal(defaultRun.status, overrideRun.status, "profil-gatens exit-kode må ikke flytte sig med --mission-days");
});

test("#3853 (C) LIVE fund-rate-sektion: crasher ikke scriptet uanset creds-tilstand (report-pattern)", () => {
  const result = run([]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\(C\) #3853 LIVE READ-ONLY — fund-rate mod ægte free-agent-population/);
});
