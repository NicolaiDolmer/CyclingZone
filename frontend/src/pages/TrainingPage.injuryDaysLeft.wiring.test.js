import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { injuryDaysLeft } from "../lib/training.js";

// #3541 — "Daily training" (roster-tabellen), "Today's training report" (dagens
// kørsels-tabel) og rytterprofilen (ConditionChips) viste tre forskellige
// skadedage-tal på samme tidspunkt for samme rytter. Rod-årsag:
//
//   - Roster-tabellen (TrainingPage.jsx renderRosterRow) og ConditionChips.jsx
//     (rytterprofilen) beregnede LIVE via injuryDaysLeft(injured_until, today) —
//     de var allerede indbyrdes konsistente.
//   - "Today's training report"-tabellen viste i stedet row.injury_days, et felt
//     backend (dailyTrainingEngine.js) KUN sætter i den nyligt-skadet-gren
//     (`if (!injuredToday) { ... injuryDays = roll.days ... }`). For en rytter der
//     allerede VAR skadet før dagens tick (injuredToday === true) springes den
//     gren helt over, så injury_days forbliver sin init-værdi 0 — mens
//     `injured: injuredToday || newlyInjured` stadig er true. Rapporten falder
//     derfor til "0 dage" fra dag til dag, mens de to andre flader korrekt tæller
//     ned ét ad gangen (jf. issuets 8/8→9/8-evidens: 5→4 / 5→4 / 4→0).
//
// Fix: rapport-rækken bruger nu SAMME kanoniske injuryDaysLeft(injured_until,
// today) på SAMME condition-state som roster-rækken og ConditionChips, i stedet
// for backend-rapportens engangs-snapshot. Ingen ny backend-kode nødvendig —
// condition opdateres allerede fra samme /api/training/me-hentning som
// todayRun.report (useTraining.js refresh()), så de kan ikke drifte fra
// hinanden igen.
//
// Repoet kører `node --test` uden DOM-renderer, så JSX-wiringen verificeres
// kildekode-strukturelt (samme mønster som DashboardPage.availableBalance.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const trainingPageSource = readFileSync(join(__dirname, "TrainingPage.jsx"), "utf8");
const conditionChipsSource = readFileSync(
  join(__dirname, "../components/rider/ConditionChips.jsx"),
  "utf8",
);

test("#3541 TrainingPage's dagsrapport-tabel bruger IKKE længere backend-snapshottet row.injury_days", () => {
  assert.doesNotMatch(
    trainingPageSource,
    /row\.injury_days/,
    "row.injury_days var netop rod-årsagen (0 for allerede-skadede ryttere) — må ikke reintroduceres",
  );
});

test("#3541 TrainingPage's dagsrapport-tabel beregner skadedage via den kanoniske injuryDaysLeft på condition-state", () => {
  assert.match(
    trainingPageSource,
    /injuryDaysLeft\(condition\[row\.rider_id\]\?\.injured_until, today\)/,
    "rapport-rækken skal kalde injuryDaysLeft med SAMME condition-kilde + today som roster-rækken",
  );
});

test("#3541 TrainingPage's roster-række (Daily training) bruger fortsat den kanoniske injuryDaysLeft (regressionsvagt)", () => {
  assert.match(
    trainingPageSource,
    /injuryDaysLeft\(cond\.injured_until, today\)/,
    "roster-rækken må ikke stille om til et andet/nyt felt uden at rapport-rækken følger med",
  );
});

test("#3541 ConditionChips (rytterprofilen) bruger fortsat den kanoniske injuryDaysLeft (regressionsvagt)", () => {
  assert.match(
    conditionChipsSource,
    /injuryDaysLeft\(injuredUntil\)/,
    "rytterprofilens skade-badge må ikke stille om til et andet/nyt felt uden de to andre flader følger med",
  );
});

// Låser selve off-by-one/0-dages-grænsen (#1672-mønstret) som alle tre flader nu
// deler via injuryDaysLeft — hvis denne regel nogensinde ændres, skal den ændres
// ÉT sted (frontend/src/lib/training.js), og alle tre flader følger automatisk med.
test("#3541 injuryDaysLeft: en allerede-skadet rytter tæller korrekt ned dag for dag, aldrig til 0 mens injured_until er i fremtiden", () => {
  const injuredUntil = "2026-08-13"; // sidste skadedag (UTC-datostreng, DATE-kolonne)
  assert.equal(injuryDaysLeft(injuredUntil, new Date("2026-08-09T08:00:00+02:00")), 5);
  assert.equal(injuryDaysLeft(injuredUntil, new Date("2026-08-10T08:00:00+02:00")), 4);
  assert.equal(injuryDaysLeft(injuredUntil, new Date("2026-08-11T08:00:00+02:00")), 3);
  assert.equal(injuryDaysLeft(injuredUntil, new Date("2026-08-12T08:00:00+02:00")), 2);
  assert.equal(injuryDaysLeft(injuredUntil, new Date("2026-08-13T08:00:00+02:00")), 1); // sidste skadedag, ikke 0 (#1672)
  assert.equal(injuryDaysLeft(injuredUntil, new Date("2026-08-14T08:00:00+02:00")), 0); // rask dagen efter
});
