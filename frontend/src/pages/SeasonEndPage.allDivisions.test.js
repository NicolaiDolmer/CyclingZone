import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2908 — sæsonsiden (den side season_ended-notifikationen sender ~150 managere
// til) rendrede kun division 1-3 (SeasonEndPage.jsx: `[1, 2, 3].map(...)`) og
// grupperede slutstillingen på HOLDETS NUVÆRENDE division (s.team?.division) i
// stedet for standings-rækkens EGEN division (s.division). "Afslut sæson"
// flytter teams.division med det samme, så et oprykket/nedrykket hold ville
// vise sig under sin NYE division i en slutstilling der hører til den GAMLE
// sæson. 57 af 153 ægte hold ligger i division 4 og kunne slet ikke finde sig
// selv på siden.
//
// node --test uden DOM → kildekode-strukturel guard + reimplementeret
// ren-funktions-paritetstest, samme mønster som SeasonEndPage.recapAggregate.test.js
// og TransfersPage.swapCashSign.test.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dirname, "SeasonEndPage.jsx"), "utf8");
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("#2908 slutstillingen rendrer ikke længere et hardcodet [1, 2, 3] divisions-loop", () => {
  assert.doesNotMatch(
    code,
    /\[\s*1\s*,\s*2\s*,\s*3\s*\]\s*\.map/,
    "division 4 (57 af 153 ægte hold) forsvandt fordi loopet var hardcodet til de tre første divisioner",
  );
});

test("#2908 divisions-loopet dækker MIN..MAX_DIVISION (RULES_NUMBERS), ikke et nyt hardcodet tal", () => {
  assert.match(
    code,
    /RULES_NUMBERS\.maxDivision/,
    "divisions-listen skal afledes af den delte konstant-mirror, så en fremtidig 5. tier ikke kræver endnu en hardcodet ændring her",
  );
  assert.match(code, /RULES_NUMBERS\.minDivision/);
});

test("#2908 grupperingen bruger IKKE længere holdets nuværende division (s.team?.division)", () => {
  assert.doesNotMatch(
    code,
    /s\.team\?\.division/,
    "s.team?.division er holdets NUVÆRENDE division — 'Afslut sæson' har allerede flyttet den, så gruppering herpå viser holdet under sin nye division i en slutstilling der hører til den gamle sæson",
  );
});

test("#2908 season_standings-queryen henter ikke længere team.division (ubrugt efter grupperings-fixet)", () => {
  assert.doesNotMatch(
    code,
    /team:team_id\([^)]*\bdivision\b/,
    "team.division bruges ikke længere til gruppering — en overlevende select ville være en ubrugt kolonne, der inviterer til at bruggen sniger sig tilbage",
  );
});

// ── Paritet: grupperings-logikken skal bruge standings-rækkens EGEN division ──

function byDivision(standings, maxDivision) {
  return standings.reduce((acc, s) => {
    const div = s.division ?? maxDivision;
    if (!acc[div]) acc[div] = [];
    acc[div].push(s);
    return acc;
  }, {});
}

test("#2908 et oprykket hold grupperes på sin GAMLE (standings-rækkens) division, ikke sin nye", () => {
  // Hold der lige er rykket op fra division 3 til division 2 (teams.division = 2),
  // men season_standings-rækken for den AFSLUTTEDE sæson har stadig division: 3 —
  // den tier holdet faktisk kørte i.
  const standings = [
    { id: "s1", team_id: "tA", division: 3, team: { division: 2, name: "Rykket hold" } },
    { id: "s2", team_id: "tB", division: 1, team: { division: 1, name: "Div 1-hold" } },
  ];
  const grouped = byDivision(standings, 4);
  assert.deepEqual(Object.keys(grouped).sort(), ["1", "3"]);
  assert.equal(grouped[3][0].team_id, "tA", "det oprykkede hold skal stå under division 3 (den gamle/rigtige), ikke division 2 (den nye)");
  assert.equal(grouped[2], undefined, "holdet må ikke optræde under sin NYE division i en afsluttet sæsons slutstilling");
});

test("#2908 alle fire divisioner grupperes, inkl. division 4", () => {
  const standings = [1, 2, 3, 4].map(div => ({ id: `s${div}`, team_id: `t${div}`, division: div, team: { name: `Hold ${div}` } }));
  const grouped = byDivision(standings, 4);
  assert.deepEqual(Object.keys(grouped).map(Number).sort(), [1, 2, 3, 4]);
  assert.equal(grouped[4].length, 1, "division 4 skal kunne rumme hold — det er her 57 af 153 ægte hold ligger");
});

// ── Retning: promotion/relegation-noten skal følge "div 1 = toppen, MAX = bunden" ──
//
// economyConstants.js: "Divisions-struktur. Div 1 = toppen (bedst), MAX_DIVISION
// = bunden." Betingelserne stod byttet om siden filens allerførste commit
// (927e1b09): promotion viste div < 3 (div 1 fik fejlagtigt en "op"-note; den
// øverste tier kan ikke rykke længere op) og relegation viste div > 1 (div 3 fik
// fejlagtigt IKKE en "op"-note). Ufarligt mens kun div 1-3 rendrede (div 2
// dækkede begge retninger korrekt), men uden rettelsen ville den nyligt
// synlige division 4 vise en falsk "Bund rykker ned"-advarsel til bundtieren.

function promotionRelegation(div, minDivision, maxDivision) {
  return {
    canPromote: div > minDivision, // kan rykke til en LAVERE (bedre) division
    canRelegate: div < maxDivision, // kan rykke til en HØJERE (dårligere) division
  };
}

test("#2908 topdivisionen (1) kan IKKE rykke op, men kan rykke ned", () => {
  const { canPromote, canRelegate } = promotionRelegation(1, 1, 4);
  assert.equal(canPromote, false, "division 1 er toppen — der er ingen division over den at rykke op til");
  assert.equal(canRelegate, true);
});

test("#2908 bunddivisionen (4) kan rykke op, men kan IKKE rykke ned", () => {
  const { canPromote, canRelegate } = promotionRelegation(4, 1, 4);
  assert.equal(canPromote, true);
  assert.equal(canRelegate, false, "division 4 er bunden — der er ingen division under den at rykke ned til");
});

test("#2908 de to buggede grænsebetingelser (div < 3 / div > 1) er væk fra promotion/relegation-blokkene", () => {
  // #3422: span'en fik et stroke-ikon (ArrowUp/DownIcon) foran t()-kaldet, så
  // matchet tillader nu vilkårligt indhold mellem <span> og {t(...)}.
  const promoBlockMatch = code.match(/isCompleted && div [<>] [^\s]+ &&\s*\(\s*<span[^>]*>[\s\S]*?\{t\("promotionNote"\)\}/);
  const releBlockMatch = code.match(/isCompleted && div [<>] [^\s]+ &&\s*\(\s*<span[^>]*>[\s\S]*?\{t\("relegationNote"\)\}/);
  assert.ok(promoBlockMatch, "promotionNote-blokken skal stadig findes");
  assert.ok(releBlockMatch, "relegationNote-blokken skal stadig findes");
  assert.match(promoBlockMatch[0], /div > RULES_NUMBERS\.minDivision/, "promotion kræver div > MIN_DIVISION (kan rykke op) — ikke det gamle 'div < 3'");
  assert.match(releBlockMatch[0], /div < RULES_NUMBERS\.maxDivision/, "relegation kræver div < MAX_DIVISION (kan rykke ned) — ikke det gamle 'div > 1'");
});
