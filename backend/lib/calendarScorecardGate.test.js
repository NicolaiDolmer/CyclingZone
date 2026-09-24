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
import { KENDTE_FIXTURE_BRUD, delEfterKendteBrud } from "../scripts/dev/calendarScorecard4218.mjs";
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

// #5405 (23/9): de tre sidste finale-linjer er lukket af kvote-fordelingen af finale-
// typerne (balanceFinaleQuotas) — ikke af et slaekket baand, en flyttet vaegt eller en
// faelles variant-soegning. Smaa stikproever er stadig kun rapport.
const KENDTE_BALANCEBRUD = 0;

test("#4215: den planlagte S4-kalender har kun de KENDTE balance-afvigelser", () => {
  const { stdout } = kør();
  assert.match(stdout, new RegExp(`SAMLET: ${KENDTE_BALANCEBRUD} regelbrud`),
    `nyt eller forsvundet regelbrud — opdatér KENDTE_BALANCEBRUD og listen over dem:\n${stdout}`);
  assert.match(stdout, /dækning OK/, `S4-vinduet skal kunne fyldes i alle fire divisioner:\n${stdout}`);
});

// #4270's fire nye gates (§1b eksakt kvote, #4203 monument-i-GT, #3329 mindste-overlap,
// §5's rolling-bånd) tælles SEPARAT: de stopper --apply, men ændrer ikke dommen her.
// Testen låser at de faktisk MÅLES — en gate der ikke rapporterer noget er ikke en gate,
// og det er præcis den fejlklasse CALENDAR_RULES.md §9b beskriver.
test("#4270: placerings-gatene måles og rapporteres separat fra balance-dommen", () => {
  const { stdout } = kør();
  assert.match(stdout, /placeringsbrud/);
  assert.match(stdout, /Monument uden for GT-spænd/);
  assert.match(stdout, /Mindste-overlap/);
  assert.match(stdout, /Kvote \(§1b, eksakt 100 %\)/);
  assert.match(stdout, /rolling-bånd/);
});

test("#4215: --json bærer samme dom som tabellen", () => {
  const { stdout } = kør(["--json"]);
  const rapport = JSON.parse(stdout);
  assert.equal(rapport.regelbrud, KENDTE_BALANCEBRUD);
  assert.equal(rapport.dækning.ok, true);
  assert.equal(rapport.tiers.length, 4, "alle fire divisioner skal måles");
  // #4203: placeringsbrud er nu NUL - det er hele leverancen. Feltet skal stadig FINDES
  // (en gate der ikke rapporterer et tal er ikke maalt, §9b), men et krav om at det er
  // positivt ville have laast fixturen fast paa et brud vi netop har lukket.
  assert.equal(typeof rapport.placeringsbrud, "number", "placerings-gatene skal være målt, ikke tavse");
  assert.equal(rapport.placeringsbrud, 0, "S4-planen må ikke have placeringsbrud efter #4203");
});

// Gaten skal kunne SIGE FRA. En gate der aldrig fejler beviser ingenting — og det var
// præcis tilstanden før: reglerne var konstanter generatoren forsøgte at ramme.
// 35 dage overstiger hvad kataloget kan fylde, så divisionerne får tomme kalenderdage.
// #4270 (3/9): fixture-gaten dømmer mod en ENUMERERET kendt tilstand, ikke mod nul brud.
// Fixturen er et frosset S3-katalog, og ejerens nye regler måler den nye regel mod det
// gamle katalog — bruddene er korrekte at rapportere, men kan ikke lukkes af den PR der
// indførte reglen. Alternativet, at slække reglen for at få grønt, er præcis det
// docs/CALENDAR_RULES.md §5b forbyder.
//
// Kontrakten testen låser: (a) et NYT brud fælder gaten, (b) et KENDT brud der forsvinder
// fælder den også — en stale liste lyver om hvad vi ved, og (c) tabellen bliver ved med at
// sige at der ER brud, så et grønt flueben aldrig kan læses som "kalenderen er i orden".
test("#4270: kendt-tilstand-gaten fælder et NYT brud og et FORSVUNDET kendt brud", () => {
  const kendte = [
    { id: "a", moenster: /alfa/, hvorfor: "", lukkesAf: "" },
    { id: "b", moenster: /beta/, hvorfor: "", lukkesAf: "" },
  ];

  const rent = delEfterKendteBrud(["alfa brud", "beta brud"], kendte);
  assert.deepEqual(rent.nye, []);
  assert.deepEqual(rent.forsvundne, []);

  const nyt = delEfterKendteBrud(["alfa brud", "beta brud", "gamma brud"], kendte);
  assert.deepEqual(nyt.nye, ["gamma brud"], "et brud der ikke står på listen skal fælde gaten");

  const forsvundet = delEfterKendteBrud(["alfa brud"], kendte);
  assert.deepEqual(forsvundet.forsvundne.map((f) => f.id), ["b"],
    "et kendt brud der er lukket skal kræve at listen opdateres i samme PR");
});

// #5405 (23/9): listen maa gerne vaere TOM — det er maalet, ikke et hul. Kravet er at den
// matcher virkeligheden: tom liste <=> nul brud i fixture-kalenderen (testen ovenfor), og
// hver post der staar der, skal kunne begrundes.
test("#4270: hver kendt post har en begrundelse og et spor der lukker den", () => {
  assert.equal(KENDTE_FIXTURE_BRUD.length === 0, KENDTE_BALANCEBRUD === 0,
    "en tom liste skal betyde nul brud, og nul brud skal betyde en tom liste");
  for (const post of KENDTE_FIXTURE_BRUD) {
    assert.ok(post.id && post.moenster instanceof RegExp, `${post.id}: mønster mangler`);
    assert.ok((post.hvorfor ?? "").length > 20, `${post.id}: en kendt post uden begrundelse er bare en undtagelse`);
    assert.ok(/#\d+|S5|katalog/i.test(post.lukkesAf ?? ""), `${post.id}: skal pege på det spor der lukker den`);
  }
});

// #4203 (3/9): TALLET FLYTTEDE SIG, IKKE KONTRAKTEN. Foer fixture-refreshen kunne 35 dage
// ikke fyldes; med prods 214 loeb kan de. 42 er nu den foerste laengde hvor forsyningen
// slipper op (maalt: D3 faar 5 kalenderdage uden loeb). Havde vi ladet 35 staa, ville
// begge tests nedenfor vaere blevet groenne af en helt anden grund end den de vogter -
// "HULLER|FEJL" ville have matchet paa balance-bruddene alene.
const FOR_MANGE_DAGE = "--days=42";

// Tabellen må ALDRIG sige "overholder alle gates" mens der står brud i den. Forskellen på
// "kalenderen er i orden" og "der er ikke kommet noget nyt" er hele pointen (§9b).
//
// #5405 (23/9): S4-fixturen har nu NUL brud, så tabellen maa — og skal — sige at den
// overholder gatene. Kravet om at den ALDRIG lyver maales derfor paa en kalender der
// beviseligt HAR brud (for mange dage), og tabellens og gatens dom skal vaere enige paa
// den rene S4-kalender.
test("#4270: den grønne gate lyver ikke i tabellen", () => {
  const ren = kør();
  assert.match(ren.stdout, /Kalenderen overholder alle gates/, "nul brud skal stå som nul brud");
  assert.match(ren.stdout, /Gaten er grøn/, "gatens egen dom skal stå adskilt fra tabellens");
  assert.doesNotMatch(ren.stdout, /Se linjerne markeret FEJL/);

  const medBrud = kør([FOR_MANGE_DAGE]);
  assert.match(medBrud.stdout, /Se linjerne markeret FEJL/, "tabellens dom skal vise at der ER brud");
  assert.doesNotMatch(medBrud.stdout, /Kalenderen overholder alle gates/);
});

test("#4215: gaten fejler når kalenderen ikke kan fyldes (exit 1, ikke bare en advarsel)", () => {
  const { code, stdout } = kør([FOR_MANGE_DAGE]);
  assert.equal(code, 1, "for mange dage skal give exit 1");
  assert.match(stdout, /dækning HULLER/, "dommen skal navngive DAEKNINGEN, ikke bare et vilkaarligt brud");
});

test("#4215: hver division måles for sig — ikke spillet som helhed", () => {
  const { stdout } = kør([FOR_MANGE_DAGE]);
  // D1 har flest løb og fyldes længst; et hul i en LAVERE division må ikke drukne
  // i et samlet tal. Beskeden skal navngive divisionen.
  assert.match(stdout, /division \d har \d+ kalenderdag\(e\) uden løb/);
});
