import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pickReferenceSeason, pickResultsSeason } from "./seasonReference.js";
import { seasonReferenceYear } from "./riderAge.js";

// #4223 (ejer 25/8: "Alderen bliver lige nu ikke vist korrekt paa rytterne").
// Rodaarsag: mellem to saesoner findes INGEN raekke med status='active' —
// prod 25/8 havde S2 completed (sluttede 23/8) og S3 upcoming (starter 28/8).
// Alle alders-helpers fik derfor seasonYear=null og returnerede null, saa hver
// rytter viste "—" og bade U23/U25- og pensionsrisiko-badget forsvandt.

const S = (number, status) => ({ number, status });

test("aktiv saeson vinder altid", () => {
  const rows = [S(1, "completed"), S(2, "active"), S(3, "upcoming")];
  assert.equal(pickReferenceSeason(rows)?.number, 2);
});

test("interregnum: uden aktiv saeson bruges den KOMMENDE (ejer-valg 25/8)", () => {
  // Prod-tilstanden 25/8, ordret.
  const rows = [S(0, "completed"), S(1, "completed"), S(2, "completed"), S(3, "upcoming")];
  assert.equal(pickReferenceSeason(rows)?.number, 3);
  assert.equal(seasonReferenceYear(pickReferenceSeason(rows).number), 2028);
});

test("flere kommende saesoner: den naermeste (laveste nummer) vinder", () => {
  const rows = [S(2, "completed"), S(4, "upcoming"), S(3, "upcoming")];
  assert.equal(pickReferenceSeason(rows)?.number, 3);
});

test("ingen kommende: falder tilbage til seneste afsluttede", () => {
  const rows = [S(1, "completed"), S(2, "completed")];
  assert.equal(pickReferenceSeason(rows)?.number, 2);
});

test("saeson 0 er bogfoerings-saesonen og maa aldrig blive reference (#2763)", () => {
  assert.equal(pickReferenceSeason([S(0, "completed")]), null);
  assert.equal(pickReferenceSeason([S(0, "active")]), null);
});

test("tom/ugyldig input giver null frem for at gaette", () => {
  assert.equal(pickReferenceSeason([]), null);
  assert.equal(pickReferenceSeason(null), null);
  assert.equal(pickReferenceSeason(undefined), null);
  assert.equal(pickReferenceSeason([{ number: null, status: "active" }]), null);
  assert.equal(pickReferenceSeason([{ number: "3", status: "upcoming" }]), null);
});

test("ukendte statusser ignoreres, ikke gaettes paa", () => {
  assert.equal(pickReferenceSeason([S(3, "archived"), S(2, "paused")]), null);
});

// #4225: RESULTAT-varianten. En rangliste er resultater, ikke en fremadrettet
// alder, saa praeferencen er omvendt: en tom kommende saeson maa aldrig vinde over
// en afsluttet der faktisk HAR resultater. Ejer-beslutning 25/8.

test("resultater: aktiv saeson vinder ogsaa her", () => {
  const rows = [S(1, "completed"), S(2, "active"), S(3, "upcoming")];
  assert.equal(pickResultsSeason(rows)?.number, 2);
});

test("resultater: interregnum bruger seneste AFSLUTTEDE, ikke den kommende", () => {
  // Prod-tilstanden 25/8. Alderen peger paa 3; ranglisten skal pege paa 2.
  const rows = [S(0, "completed"), S(1, "completed"), S(2, "completed"), S(3, "upcoming")];
  assert.equal(pickResultsSeason(rows)?.number, 2);
  assert.equal(pickReferenceSeason(rows)?.number, 3, "de to varianter skal netop IKKE vaere enige her");
});

test("resultater: uden afsluttet saeson falder den tilbage til den kommende", () => {
  // Foerste saeson nogensinde: intet at vise bagud, saa peg frem frem for at kaste.
  assert.equal(pickResultsSeason([S(1, "upcoming")])?.number, 1);
});

test("resultater: saeson 0 og tom input opfoerer sig som alders-varianten", () => {
  assert.equal(pickResultsSeason([S(0, "completed")]), null);
  assert.equal(pickResultsSeason([]), null);
  assert.equal(pickResultsSeason(null), null);
});

// Forward-guard (#4223). Selve buggen var IKKE formlen — den var at alders-
// kilden hang paa et bart `status='active'`-opslag, som giver nul raekker i hvert
// eneste saesonmellemrum. Faldt den linje tilbage ind i hook'en, ville hele
// fladen stille vise "—" igen naeste gang en saeson slutter. Samme mekanik som
// riderAgeSeasonGuard.test.js's vagt mod wall-clock-aaret.
test("#4223: useActiveSeasonYear haenger ikke paa et bart status='active'-opslag", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "useActiveSeasonYear.js"), "utf8");
  assert.doesNotMatch(
    src,
    /\.eq\(\s*["']status["']\s*,\s*["']active["']\s*\)/,
    "useActiveSeasonYear maa ikke filtrere paa status='active' — mellem to saesoner findes ingen saadan raekke, og alderen forsvinder paa hele fladen (#4223)",
  );
  assert.match(src, /pickReferenceSeasonNumber/, "alders-referencen skal gaa gennem seasonReference.js");
});
