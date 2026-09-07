// backend/scripts/teamPlayAbMeasure.test.mjs
// #4914: parserne i A/B-maalescriptet er kontrakten mod TO harness-scripts'
// tekst-output. Skifter det output form, skal maalingen FEJLE HAARDT og ikke
// stille og roligt rapportere nul-tal — som ville se ud som "holdspillet
// virker ikke". Derfor testes baade den glade sti og formskiftet.

import assert from "node:assert/strict";
import test from "node:test";

import {
  END_MARKER,
  START_MARKER,
  parseTailGate,
  parseTeamPlay,
  replaceBlock,
} from "./teamPlayAbMeasure.mjs";

const TEAM_PLAY_OUTPUT = [
  "-- Holdspil (M16): placering pr. rolle, v3 mod v4 --",
  "Etaper med roller: 141",
  "(delta = pladser BEDRE end rytterens egen evne-rang i feltet forudsiger; 0 = motoren har intet holdspil)",
  "rolle             v3 gns.plads  v3 delta   v4 gns.plads  v4 delta",
  "captain                   64.6      -0.65           60.4      3.74",
  "sprint_captain            81.3       2.06           90.8     -7.47",
  "helper                   112.4      -5.14          108.1     -0.86",
  "hunter                    98.4       3.27           99.6      2.06",
  "free_role                 90.9       0.26           91.1      0.06",
  "Beskyttelses-gab (leder minus hjaelper): v3 5.85 · v4 -1.01",
].join("\n");

const TAIL_GATE_OUTPUT = [
  "-- HALE-GATE (ejer-laast 7/9, #4885, RACE_ENGINE_RULES.md §9 raekke 13) --",
  "key\tn\tren_p90_%_samlet\tbaand\tstatus\tmiddel_pr_seed_%\tspaend_pr_seed_%",
  "flat\t105\t0.20\t0-2 %\tPASS\t0.20\t0.19-0.21",
  "high_mountain\t36\t5.24\t6-12 %\tFAIL\t5.30\t4.90-5.70",
  "hilly\t60\t3.10\t-\tingen ejer-baand\t3.10\t2.90-3.30",
  "Samlet gate-dom: FAIL (3 laaste etapetyper).",
].join("\n");

test("parseTeamPlay laeser beskyttelses-gabet og alle fem roller", () => {
  const parsed = parseTeamPlay(TEAM_PLAY_OUTPUT);
  assert.equal(parsed.v3Gap, 5.85);
  assert.equal(parsed.v4Gap, -1.01);
  assert.equal(Object.keys(parsed.roles).length, 5);
  assert.deepEqual(parsed.roles.helper, {
    v3MeanRank: 112.4,
    v3Delta: -5.14,
    v4MeanRank: 108.1,
    v4Delta: -0.86,
  });
  // Negative deltaer er hele pointen (hjaelperen taber pladser) — de maa
  // aldrig blive slugt af en regex der kun matcher positive tal.
  assert.equal(parsed.roles.sprint_captain.v4Delta, -7.47);
});

test("parseTeamPlay fejler haardt hvis holdspils-blokken mangler", () => {
  assert.throws(() => parseTeamPlay("=== Scorecard ===\nAnker: noget\n"), /Beskyttelses-gab/u);
});

test("parseTailGate laeser status pr. etapetype og den samlede dom", () => {
  const parsed = parseTailGate(TAIL_GATE_OUTPUT);
  assert.equal(parsed.allPass, false);
  assert.equal(parsed.rows.length, 3);
  const highMountain = parsed.rows.find((r) => r.profileType === "high_mountain");
  assert.equal(highMountain.cleanP90Pct, 5.24);
  assert.equal(highMountain.band, "6-12 %");
  assert.equal(highMountain.status, "FAIL");
  // Typer uden ejer-baand skal med som RAPPORT-raekker, ikke som domme.
  assert.equal(parsed.rows.find((r) => r.profileType === "hilly").band, "-");
});

test("parseTailGate fejler haardt hvis gate-tabellen mangler", () => {
  assert.throws(() => parseTailGate("-- I alt --\nalle etaper\t141\n"), /HALE-GATE/u);
});

test("replaceBlock bevarer haandskreven prosa omkring markoererne", () => {
  const doc = `# Overskrift\n\nAnbefaling: vaelg B.\n\n${START_MARKER}\ngamle tal\n${END_MARKER}\n\nHale.\n`;
  const next = replaceBlock(doc, `${START_MARKER}\nnye tal\n${END_MARKER}`);
  assert.match(next, /Anbefaling: vaelg B\./u);
  assert.match(next, /nye tal/u);
  assert.doesNotMatch(next, /gamle tal/u);
  assert.match(next, /Hale\./u);
});

test("replaceBlock returnerer null naar markoererne mangler", () => {
  assert.equal(replaceBlock("# Kun prosa\n", `${START_MARKER}\nx\n${END_MARKER}`), null);
});
