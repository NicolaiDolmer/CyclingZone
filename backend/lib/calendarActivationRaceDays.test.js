// backend/lib/calendarActivationRaceDays.test.js
// #5272 — remaining-horizon-målet for en pulje der aktiveres midt i sæsonen.
// Rene funktioner: ingen DB, intet ur.

import test from "node:test";
import assert from "node:assert/strict";

import { measureDivisionRaceDayAxes, resolveActivationRaceDayTarget } from "./calendarActivationRaceDays.js";

const FROM = new Date("2026-06-29T00:00:00Z");

/** Etaper for én division: `gameDays` på datoerne `datoer` (parvis). */
function rows(divisionId, par) {
  return par.map(([game_day, dato]) => ({
    league_division_id: divisionId, game_day, scheduled_at: `${dato}T12:00:00Z`,
  }));
}

test("#5272: aksen måles som max(game_day) + 1, ikke som antal distinkte løbsdage", () => {
  // §0b: databasen er 0-baseret. En løbsdag UDEN løb (#4845's træningsdag) har ingen
  // række, så en tælling ville gøre aksen kortere end den er.
  const m = measureDivisionRaceDayAxes({
    stageRows: rows(1, [[0, "2026-06-20"], [1, "2026-06-21"], [5, "2026-06-25"]]),
    from: FROM,
  });
  assert.equal(m.get("1").axisLength, 6);
  assert.equal(m.get("1").elapsedRaceDays, 6, "alle tre datoer ligger før from");
  assert.equal(m.get("1").remainingRaceDays, 0);
});

test("#5272: afviklede løbsdage tælles på scheduled_at, ikke på game_day-værdien", () => {
  // §0: game_day kan ALDRIG udledes af scheduled_at. Her er kun de to første datoer
  // passeret, så aksen er 4 lang og 2 løbsdage er afviklet.
  const m = measureDivisionRaceDayAxes({
    stageRows: rows(1, [[0, "2026-06-27"], [1, "2026-06-28"], [2, "2026-06-30"], [3, "2026-07-01"]]),
    from: FROM,
  });
  assert.deepEqual(m.get("1"), { axisLength: 4, elapsedRaceDays: 2, remainingRaceDays: 2 });
});

test("#5272: en pulje aktiveret MIDT i sæsonen får målet minus det afviklede", () => {
  const stageRows = [
    ...rows(1, [[0, "2026-06-15"], [39, "2026-06-28"], [40, "2026-06-29"], [79, "2026-07-09"]]),
  ];
  const r = resolveActivationRaceDayTarget({ stageRows, from: FROM, excludeDivisionId: 8 });
  assert.equal(r.seasonRaceDayTarget, 80, "aksen er 0-79, altså 80 løbsdage");
  assert.equal(r.elapsedRaceDays, 40, "game_day 0-39 er afviklet før from");
  assert.equal(r.raceDayTarget, 40, "resten af målet, ikke hele målet og ikke et søgeresultat");
  assert.equal(r.source, "hoejeste maalte division");
  assert.equal(r.sourceDivisionId, "1");
});

test("#5272: en pulje aktiveret ved SÆSONSTART får hele målet (intet er afviklet)", () => {
  const stageRows = rows(1, [[0, "2026-06-29"], [79, "2026-07-09"]]);
  const r = resolveActivationRaceDayTarget({ stageRows, from: FROM, excludeDivisionId: 8 });
  assert.equal(r.elapsedRaceDays, 0);
  assert.equal(r.raceDayTarget, 80);
  assert.equal(r.raceDayTarget, r.seasonRaceDayTarget);
});

test("#5272: uden andre kalendere afgøres intet mål — der gættes ikke", () => {
  const r = resolveActivationRaceDayTarget({ stageRows: [], from: FROM, excludeDivisionId: 8 });
  assert.equal(r.raceDayTarget, null);
  assert.equal(r.seasonRaceDayTarget, null);
  assert.equal(r.source, "ingen");
});

test("#5272: den aktiverede pulje er aldrig sin egen målestok", () => {
  // En halvskrevet kalender i puljen selv må ikke kunne sætte målet ned.
  const stageRows = [...rows(1, [[0, "2026-06-29"], [59, "2026-07-05"]]), ...rows(8, [[0, "2026-06-29"], [3, "2026-06-30"]])];
  const r = resolveActivationRaceDayTarget({ stageRows, from: FROM, excludeDivisionId: 8 });
  assert.equal(r.seasonRaceDayTarget, 60);
  assert.equal(r.sourceDivisionId, "1");
  assert.ok(!("8" in r.axisByDivision), "den aktiverede pulje må ikke tælle med");
});

test("#5272: et eksplicit sæson-mål slår det målte (hullet #4845/#5169 falder ned i)", () => {
  const stageRows = rows(1, [[0, "2026-06-20"], [55, "2026-07-09"]]);
  const r = resolveActivationRaceDayTarget({ stageRows, from: FROM, excludeDivisionId: 8, seasonTarget: 140 });
  assert.equal(r.seasonRaceDayTarget, 140);
  assert.equal(r.source, "eksplicit saeson-maal");
  assert.equal(r.raceDayTarget, 140 - r.elapsedRaceDays);
});

test("#5272: målet OG det afviklede læses af SAMME division når akserne er skæve", () => {
  // D1 80 mod D4 56 (målt 11/9, #4845). Tages målet fra D1 og det afviklede fra D4, er
  // de to tal målt på hver sin skala og resten bliver forkert.
  const stageRows = [
    ...rows(1, [[0, "2026-06-15"], [39, "2026-06-28"], [79, "2026-07-09"]]),
    ...rows(4, [[0, "2026-06-15"], [10, "2026-06-28"], [55, "2026-07-09"]]),
  ];
  const r = resolveActivationRaceDayTarget({ stageRows, from: FROM, excludeDivisionId: 8 });
  assert.equal(r.sourceDivisionId, "1");
  assert.equal(r.seasonRaceDayTarget, 80);
  assert.equal(r.elapsedRaceDays, 40, "D1's egne afviklede løbsdage, ikke D4's 11");
  assert.equal(r.raceDayTarget, 40);
  assert.equal(r.axisSpread, 80 - 56, "spredningen rapporteres, så #4845's ulighed er synlig");
});

test("#5272: er målet allerede opbrugt, sendes INTET mål videre", () => {
  const stageRows = rows(1, [[0, "2026-06-20"], [30, "2026-06-28"]]);
  const r = resolveActivationRaceDayTarget({ stageRows, from: FROM, excludeDivisionId: 8 });
  assert.equal(r.seasonRaceDayTarget, 31);
  assert.equal(r.elapsedRaceDays, 31);
  assert.equal(r.raceDayTarget, null, "0 er ikke et mål — det er fraværet af et");
});

test("#5272: ugyldige rækker springes over i stedet for at forgifte aksen med NaN", () => {
  const m = measureDivisionRaceDayAxes({
    stageRows: [
      { league_division_id: 1, game_day: 4, scheduled_at: "2026-06-20T12:00:00Z" },
      { league_division_id: 1, game_day: null, scheduled_at: "2026-06-21T12:00:00Z" },
      { league_division_id: 1, game_day: -1, scheduled_at: "2026-06-21T12:00:00Z" },
      { league_division_id: null, game_day: 99, scheduled_at: "2026-06-21T12:00:00Z" },
      { league_division_id: 1, game_day: 6, scheduled_at: "ikke-en-dato" },
    ],
    from: FROM,
  });
  assert.equal(m.get("1").axisLength, 7, "game_day 6 tæller på aksen selv om datoen er uparsebar");
  assert.equal(m.get("1").elapsedRaceDays, 5, "men en uparsebar dato kan ikke tælle som afviklet");
  assert.equal(m.size, 1);
});

test("#5272: NULL/tom game_day er IKKE løbsdag 0 (Number(null) === 0)", () => {
  // CodeRabbit 17/9: testen ovenfor kunne ikke se fejlen, fordi den injicerede 0 lå under
  // det eksisterende maksimum. Her er der INTET gyldigt game_day at gemme sig bag, så en
  // manglende værdi ville stå bart som en løbsdag der aldrig fandtes.
  const m = measureDivisionRaceDayAxes({
    stageRows: [
      { league_division_id: 1, game_day: null, scheduled_at: "2026-06-20T12:00:00Z" },
      { league_division_id: 1, game_day: "", scheduled_at: "2026-06-20T12:00:00Z" },
      { league_division_id: 1, game_day: undefined, scheduled_at: "2026-06-20T12:00:00Z" },
    ],
    from: FROM,
  });
  assert.equal(m.size, 0, "en division hvis rækker ALLE mangler game_day har ingen akse at måle");

  // Og den må heller ikke kunne afkorte et ægte mål: uden guarden ville NULL-rækken før
  // from give elapsedRaceDays = 1 og trække en løbsdag fra der aldrig blev kørt.
  const r = resolveActivationRaceDayTarget({
    stageRows: [
      { league_division_id: 1, game_day: null, scheduled_at: "2026-06-20T12:00:00Z" },
      { league_division_id: 1, game_day: 39, scheduled_at: "2026-07-05T12:00:00Z" },
    ],
    from: FROM,
    excludeDivisionId: 8,
  });
  assert.equal(r.elapsedRaceDays, 0, "intet er afviklet — NULL-rækken må ikke tælle som løbsdag 0");
  assert.equal(r.raceDayTarget, 40);
});

test("#5272: division-id som tal og streng er den SAMME division", () => {
  const m = measureDivisionRaceDayAxes({
    stageRows: [
      { league_division_id: 8, game_day: 2, scheduled_at: "2026-06-20T12:00:00Z" },
      { league_division_id: "8", game_day: 9, scheduled_at: "2026-06-20T12:00:00Z" },
    ],
    from: FROM,
  });
  assert.equal(m.size, 1, "en blandet nøgletype ville tavst dublere divisionen");
  assert.equal(m.get("8").axisLength, 10);
});
