// #5462 — BEGGE skrivere + udtagelses-gaten, maalt paa graensen mellem de to akser.
//
// Det testen faelder er praecis de to krav fra issuet:
//   1. flag ON  ⇒ varigheden er N LOEBSDAGE paa holdets/loebets divisions-akse, og
//      `injured_until` er datoen for den slut-loebsdag (gaten og alle flader laeser
//      derfor det samme felt).
//   2. flag OFF ⇒ BIT-IDENTISK med i dag. Ingen nye kolonner i payloaden, ingen
//      ekstra opslag, samme kalenderdato.
import test from "node:test";
import assert from "node:assert/strict";

import { incidentInjuryUpsertRows } from "./raceRunner.js";
import { isRiderInjured, applyInjuredFilter } from "./riderEligibility.js";
import { injuryEndGameDay, injuryRaceDaysLeft } from "./injuryRaceDays.js";

// ── Skriver 2: styrt i loeb (raceRunner.incidentInjuryUpsertRows) ────────────

const CRASH = { rider_id: "r-crash", kind: "crash", outcome: "abandon", injury_days: 3, stage_number: 1 };
const TODAY = "2026-06-12";
const STAGE_DAYS = new Map([[1, 40], [2, 41], [21, 60]]);

test("#5462 styrt, flag OFF: payloaden er BIT-IDENTISK med foer — tre noegler, kalenderdato", () => {
  const rows = incidentInjuryUpsertRows({ incidents: [CRASH], todayStr: TODAY });
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["injured_until", "injury_cause", "rider_id"]);
  assert.equal(rows[0].injured_until, "2026-06-15", "tickDate + N kalenderdage, som i dag");
  assert.equal(rows[0].injury_cause, "race_crash");
});

test("#5462 styrt, flag ON: slut-loebsdagen er loebsdag + N, og resten taelles inklusivt", () => {
  const rows = incidentInjuryUpsertRows({
    incidents: [CRASH], todayStr: TODAY, gameDayByStage: STAGE_DAYS, seasonId: "season-1",
  });
  assert.equal(rows[0].injury_end_game_day, 43, "samme formel som kalenderstien, bare paa loebsdagen");
  assert.equal(rows[0].injury_season_id, "season-1");
  assert.equal(rows[0].injury_race_days_left, 4, "loebsdag 40-43 inkl. i dag");
  assert.equal(
    rows[0].injured_until, "2026-06-15",
    "raekkebyggeren saetter kalenderdags-FALLBACKEN; persistIncidents overskriver den med slut-loebsdagens dato",
  );
});

test("#5462 styrt: loebsdag 0 er en RIGTIG loebsdag (DB er 0-baseret, CALENDAR_RULES §0b)", () => {
  const rows = incidentInjuryUpsertRows({
    incidents: [CRASH], todayStr: TODAY, gameDayByStage: new Map([[1, 0]]), seasonId: "season-1",
  });
  assert.equal(rows[0].injury_end_game_day, 3, "0 maa ikke falde ud som 'ingen akse'");
});

test("#5462 styrt: HVER etape faar sin EGEN loebsdag (whole-race-stien sender alle etaper samlet)", () => {
  // Foer rettelsen brugte alle uheld koerslens HOEJESTE loebsdag, saa et styrt paa
  // etape 1 fik etape 21's udgangspunkt og en skade der sluttede alt for sent.
  const rows = incidentInjuryUpsertRows({
    incidents: [
      { ...CRASH, rider_id: "tidlig", stage_number: 1 },
      { ...CRASH, rider_id: "sen", stage_number: 21 },
    ],
    todayStr: TODAY, gameDayByStage: STAGE_DAYS, seasonId: "season-1",
  });
  assert.equal(rows.find((r) => r.rider_id === "tidlig").injury_end_game_day, 43, "etape 1 ⇒ loebsdag 40 + 3");
  assert.equal(rows.find((r) => r.rider_id === "sen").injury_end_game_day, 63, "etape 21 ⇒ loebsdag 60 + 3");
});

test("#5462 styrt: uden saeson, uden akse eller for en UKENDT etape skrives INGEN loebsdags-kolonner", () => {
  for (const args of [
    { gameDayByStage: STAGE_DAYS, seasonId: null },
    { gameDayByStage: null, seasonId: "season-1" },
    { gameDayByStage: new Map(), seasonId: "season-1" },
    { gameDayByStage: new Map([[7, 40]]), seasonId: "season-1" },
  ]) {
    const rows = incidentInjuryUpsertRows({ incidents: [CRASH], todayStr: TODAY, ...args });
    assert.deepEqual(
      Object.keys(rows[0]).sort(), ["injured_until", "injury_cause", "rider_id"],
      "manglende akse maa give kalenderdags-raekken, ikke en halv loebsdags-raekke",
    );
  }
});

test("#5462 styrt: reglen om HVEM der skades er uroert (#4520/#4879) — kun styrt, aldrig kind='injury'", () => {
  const rows = incidentInjuryUpsertRows({
    incidents: [
      { rider_id: "mech", kind: "mechanical", outcome: "abandon", injury_days: 0, stage_number: 1 },
      { rider_id: "outside", kind: "injury", outcome: "dns", injury_days: 4, stage_number: 1 },
      { rider_id: "hard", kind: "time_limit", outcome: "finished", injury_days: 2, stage_number: 1 },
    ],
    todayStr: TODAY, gameDayByStage: STAGE_DAYS, seasonId: "season-1",
  });
  assert.deepEqual(rows.map((r) => r.rider_id), ["hard"], "mekanisk skader ikke; kind='injury' ejes af rider_condition");
  assert.equal(rows[0].injury_end_game_day, 42);
});

// ── Udtagelses-gaten laeser det SAMME felt i begge tilstande ─────────────────

test("#5462 gaten er uaendret: den spoerger stadig paa injured_until, som nu ER slut-loebsdagens dato", () => {
  // Skaden slutter paa loebsdag 43, som ligger paa den 13.
  const injuredUntil = "2026-06-13";
  assert.equal(isRiderInjured(injuredUntil, "2026-06-12"), true, "dagen foer: ude");
  assert.equal(isRiderInjured(injuredUntil, "2026-06-13"), true, "selve slutdagen: stadig ude (>=-semantikken)");
  assert.equal(isRiderInjured(injuredUntil, "2026-06-14"), false, "dagen efter: kan udtages");

  const calls = [];
  applyInjuredFilter({ gte: (col, val) => calls.push([col, val]) }, "2026-06-12");
  assert.deepEqual(calls, [["injured_until", "2026-06-12"]],
    "SQL-siden er uroert — det er hele pointen med at udlede datoen i stedet for at skifte kolonne");
});

test("#5462 gate + akse haenger sammen: samme skade, to udtryk, samme rytter", () => {
  const end = injuryEndGameDay({ gameDay: 40, days: 3 });
  assert.equal(end, 43);
  // Motoren regner paa loebsdagen ...
  assert.equal(injuryRaceDaysLeft({ endGameDay: end, currentGameDay: 43 }), 1);
  assert.equal(injuryRaceDaysLeft({ endGameDay: end, currentGameDay: 44 }), 0);
  // ... og gaten paa den dato loebsdag 43 ligger paa.
  assert.equal(isRiderInjured("2026-06-13", "2026-06-13"), true);
});
