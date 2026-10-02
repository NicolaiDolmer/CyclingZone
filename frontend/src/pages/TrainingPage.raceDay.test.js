import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3459 V3 — løbsdags-badge på trænings-siden (ejer-godkendt mockup 7/8). Kun én
// visuel kontrakt: badge (stroke flag-ikon + kort tekst i fremhævet farve) ERSTATTER
// rytme-meta-linjen, intensitets-knapperne DÆMPES men forbliver AKTIVE, tooltip
// forklarer mekanikken. Feltet er PRÆCIS den samme gate (racingToday-objektets
// tilstedeværelse pr. rytter, leveret kun bag flag af backend — se
// apiTrainingMeRaceDay.routes.test.js) — samme source-string-guard-mønster som
// TrainingPage.wiring.test.js.
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TrainingPage.jsx"), "utf8");

test("#3459 racingToday hentes fra useTraining (ingen ny fetch/config-endpoint på siden)", () => {
  // #4851/#4847: destruktureringens SIDSTE linjer er ikke længere `racingToday,`
  // alene — `trainingScore` står før og `dayClose` efter, hver med sin kommentar.
  // Mønstret binder derfor kun det gaten faktisk handler om: at `racingToday`
  // kommer fra `useTraining()`s destrukturering, ikke fra et nyt fetch på siden.
  assert.match(
    src,
    /const \{[\s\S]{0,1200}?\bracingToday,[\s\S]{0,400}?\} = training;/,
    "skal destrukturere racingToday fra useTraining()",
  );
  // Tilstedeværelse pr. rytter er hele gaten (løbsdags-cellen og telefonens række).
  assert.match(src, /const racingTodayFor = \(riderId\) => racingToday\[riderId\] != null;/);
  assert.match(src, /tone: "race", title: racingToday\[riderId\]\?\.race \?\? undefined/);
});

// #6030: badgen i #5124's D-047-roster-række (FlagIcon + dæmpede intensitets-
// knapper) er slettet sammen med grenen (training_mobile_table er on for alle).
// Løbsdagen vises nu som "race"-cellen i dagens tabel (ovenfor).
test("#3459 ingen emoji på siden (stroke-ikoner, aldrig emoji)", () => {
  assert.doesNotMatch(src, /🚩|🏁|🚴/);
});
test("#3459 planen (fokus/intensitet-handlers) kaldes uændret — badgen rører ALDRIG handlePlanChange", () => {
  assert.doesNotMatch(
    src,
    /raceToday[\s\S]{0,80}handlePlanChange/,
    "raceToday må ikke optræde i nærheden af et handlePlanChange-kald (G5-invarianten: planen muteres aldrig af motoren/UI'et)",
  );
});
