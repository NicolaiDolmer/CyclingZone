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

// #4270 (3/9): scorecardet måler nu S4's vindue (28/9 → 25/10, 28 dage) og S4's regler.
// Ejerens beslutning om at hæve D4 fra 2 til 3 etaper om dagen flytter kalenderens form, og
// TRE balance-afvigelser følger med. De er ENUMERERET nedenfor, ikke tolereret i en klump:
// testen fejler stadig hvis der kommer ét brud mere, eller hvis et af de tre forsvinder
// uden at listen følger med.
//
// HVORFOR DE IKKE KAN LUKKES I DENNE PR: alle tre er filler-vægt-kalibrering, og
// genkalibreringen pr. division er ejer-besluttet 3/9 som en S5-opgave (CALENDAR_RULES §6b).
// De SAMME afvigelser findes i dry-runnet mod prods katalog samme dag — det er altså
// kalenderens faktiske tilstand, ikke en fixture-artefakt. Se
// docs/audits/season4-calendar-dryrun-2026-09-03.md, afsnittet "Efter ejerens beslutninger 3/9".
//   · tier 2 bjerg mod målet (tolerance ±5) — katalog-sporets nye bjergløb lukker den, når
//     migrationen er anvendt mod prod og fixturen er genopfrisket
//   · tier 4 mountain slutter aldrig i udbrud (stikprøve-båndet, n=12)
//   · sæson hilly slutter for ofte fladt
const KENDTE_BALANCEBRUD = 3;

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
  assert.ok(rapport.placeringsbrud > 0, "placerings-gatene skal være målt, ikke tavse");
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
