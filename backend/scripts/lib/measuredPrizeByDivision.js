// #1819 · MÅLT præmie-indkomst pr. division pr. sæson.
//
// HVORFOR DENNE FIL FINDES: moneySupplyScorecard.js kalibrerede sponsor/upkeep
// mod et ANTAGET præmie-niveau (D1 160k / D2 70k / D3 25k) der bar mærkatet
// "(IKKE målt)". Det var rod-årsagen bag #1816: den antagne præmie var 14x for
// lav, og hele break-even-balancen hvilede på gættet. Efter præmie-reskaleringen
// (÷20, PRIZE_PER_POINT=75) har vi to afsluttede sæsoner med rigtige
// udbetalinger, så gættet kan udskiftes med en måling.
//
// ── MÅLING (read-only SELECT mod prod, 2026-08-30, Europe/Copenhagen) ──────────
// Kilde: race_results.prize_money summeret pr. hold pr. sæson. Sæson 2
// (2026-07-27 til 2026-08-23, 28 løbsdage, status=completed) er den seneste
// FULDE sæson; sæson 3 er 3/31 løbsdage inde og duer ikke som facit.
//
// ATTRIBUTION (det led der afgør tallene): præmien tilskrives den division
// LØBET blev kørt i (races.league_division_id -> league_divisions.tier), ikke
// holdets NUVÆRENDE teams.division. Forskellen er ikke akademisk:
//
//   teams.division (nuværende)   -> D1 709.425 / D2 184.117 / D3 60.819
//   races.league_division_id     -> D1 ingen hold / D2 219.709 / D3 188.206
//
// Den første række måler "hvad tjente de hold der i dag ligger i D1", altså
// hvad et oprykker-hold tjente i D2/D3 i sæson 2. Den anden måler "hvad et hold
// i division D tjener på en sæson", som er det scorecardet skal bruge.
//
// D1 ER AFLEDT, IKKE MÅLT PÅ HOLD: sæson 2 havde NUL hold i division 1. Alle
// 92.442 resultatrækker på tier-1-løbene har team_id = NULL (ubundne ryttere),
// og season_standings har 1 række uden menneskehold. Præmiepuljen på
// D1-kalenderen er derimod virkelig: 13.963.575 CZ$. Divideret med de 24
// D1-pladser sæson 3 faktisk har fyldt op giver det 581.816 pr. hold.
// Krydstjek: sæson 3's D1-pulje har udbetalt 1.232.400 på 3 af 31 løbsdage
// (100 % til hold), hvilket fremskrevet er ~12,7 mio., altså samme størrelse.
//
// STATISTIK-VALG: konstanten er GENNEMSNITTET, ikke medianen. Et
// money-supply-scorecard spørger hvor mange kroner der sprøjtes ind pr. hold
// (pulje / antal hold), og det er per definition gennemsnittet. Medianen står
// ved siden af som "mid-table"-reference, fordi fordelingen er højreskæv
// (D2: median 120.862 mod gennemsnit 219.709).
//
// HVAD DENNE FIL IKKE GØR: den ændrer ingen konstant i economyConstants.js.
// PRIZE_PER_POINT, sponsor og upkeep er balance-beslutninger til ejeren. Denne
// fil får kun scorecardet til at fortælle sandheden; derefter beslutter ejeren.

export const PRIZE_MEASUREMENT = Object.freeze({
  measured_at: "2026-08-30",
  season: 2,
  season_window: "2026-07-27 til 2026-08-23",
  race_days: 28,
  method:
    "sum(race_results.prize_money) pr. hold, praemien tilskrevet den division loebet blev koert i " +
    "(races.league_division_id -> league_divisions.tier); bank- og testhold ekskluderet",
  issue: 1819,
});

// Pr. division: antal hold der faktisk kørte i divisionen den sæson, samlet
// udbetaling, gennemsnit og median pr. hold. `derived: true` betyder at tallet
// er regnet ud fra puljen frem for målt på hold (kun D1, se filens header).
export const MEASURED_PRIZE_SEASON2 = Object.freeze({
  1: Object.freeze({
    teams: 24,
    pool: 13_963_575,
    mean: 581_816,
    median: null,
    derived: true,
    note: "saeson 2 havde nul hold i D1 (92.442 tier-1-raekker med team_id NULL); pulje / 24 D1-pladser",
  }),
  2: Object.freeze({
    teams: 48,
    pool: 10_546_050,
    mean: 219_709,
    median: 120_862,
    derived: false,
    note: "48 menneskehold, hele puljen gik til hold",
  }),
  3: Object.freeze({
    teams: 96,
    pool: 18_067_800,
    mean: 188_206,
    median: 78_150,
    derived: false,
    note: "95 menneskehold + 1 AI-hold; human-only gennemsnit 189.608",
  }),
  4: Object.freeze({
    teams: 72,
    pool: 3_809_880,
    mean: 52_915,
    median: 33_975,
    derived: false,
    note: "69 menneskehold + 3 AI-hold; resten af D4-puljen (4,56 mio.) gik til ubundne ryttere",
  }),
});

/** Gennemsnitlig praemie pr. hold pr. saeson, pr. division. Scorecardets input. */
export const PRIZE_MEASURED_BY_DIVISION = Object.freeze(
  Object.fromEntries(Object.entries(MEASURED_PRIZE_SEASON2).map(([d, m]) => [d, m.mean]))
);

/** Median (mid-table-reference). null for divisioner uden hold-maaling. */
export const PRIZE_MEDIAN_BY_DIVISION = Object.freeze(
  Object.fromEntries(Object.entries(MEASURED_PRIZE_SEASON2).map(([d, m]) => [d, m.median]))
);

/** Een linje til scorecard-output: hvor tallet kommer fra, saa ingen skal gaette. */
export function prizeProvenanceLine() {
  return (
    `målt sæson ${PRIZE_MEASUREMENT.season} (${PRIZE_MEASUREMENT.season_window}, ` +
    `${PRIZE_MEASUREMENT.race_days} løbsdage), aflæst ${PRIZE_MEASUREMENT.measured_at}: ` +
    "gennemsnitlig udbetalt præmie pr. hold, tilskrevet den division løbet blev kørt i (#1819)"
  );
}
