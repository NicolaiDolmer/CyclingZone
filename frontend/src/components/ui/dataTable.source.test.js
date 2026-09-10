import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "DataTable.jsx"), "utf8");
const styles = readFileSync(join(here, "dataTableStyles.js"), "utf8");

// Samme kommentar-strip som scripts/check-anti-slop.mjs bruger, skrevet lokalt
// saa en frontend-test ikke importerer paa tvaers af pakkegraensen: forbuddene
// gaelder MARKUPPEN, ikke en kommentar der forklarer hvorfor de gaelder (og
// issue-referencer som "#5102" ville ellers taelle som raa hex).
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// Samme hex-heuristik som scripts/lint-ui-slop.mjs: et rent-decimalt token med
// 1-4 cifre er en issue-reference ("#5102"), ikke en farve. Kun cifre MED et
// hex-bogstav, eller 6/8 cifre, er en farve.
function rawHexColors(source) {
  const found = [];
  for (const [, digits] of source.matchAll(/#([0-9a-fA-F]{3,8})(?![0-9a-fA-F])/g)) {
    const len = digits.length;
    if (len !== 3 && len !== 4 && len !== 6 && len !== 8) continue;
    if (/[a-fA-F]/.test(digits) || len === 6 || len === 8) found.push(`#${digits}`);
  }
  return found;
}

// D-047 (#5102, ejer 10/9) — mobilstandarden. Den gamle regel (#4625: pinned
// navnekolonne + vandret scroll som DEFAULT) er trukket tilbage; navnekolonnen
// er stadig markeret `sticky: true`, men paa mobil er den navneBLOKKEN, ikke en
// CSS-sticky celle over en scroller.
test("DataTable advarer stadig naar ingen kolonne er markeret som entity-/navnekolonne", () => {
  assert.match(src, /columns\.find\(\(c\) => c\.sticky\)/);
  assert.match(src, /console\.error/);
  assert.match(src, /D-047/);
});

test("mobil-standarden viser navnekolonnen + praecis tre kolonner", () => {
  assert.match(src, /MOBILE_COLUMN_COUNT/);
  assert.match(src, /mobileDefaults/);
  assert.match(src, /orderMobileColumns\(columns, mobileKeys\)/);
  // Chip-raekken vises kun naar der ER mere end tre kolonner at bytte imellem.
  assert.match(src, /swappable\.length > MOBILE_COLUMN_COUNT/);
});

// Valget maa IKKE hænge på det viste label: det er oversat, tæller ofte rækker
// med ("Trup (1)" / "Squad (1)") og deles af to linser på samme side.
test("kolonnevalget huskes pr. KOLONNESAET, ikke pr. oversat label", () => {
  // Begge kald skal faa KOLONNESAETTET. Kolonnerne naas via en ref
  // (latestColumnsRef) saa signaturen kan vaere effektens eneste dependency
  // uden et eslint-disable — derfor tillader regexet et objekt-praefiks, men
  // stadig kun feltnavnene `columns`/`mobileDefaults`.
  assert.match(src, /readMobileColumnKeys\([\w.]*columns, [\w.]*mobileDefaults\)/);
  assert.match(src, /writeMobileColumnKeys\([\w.]*columns, next\)/);
  assert.match(src, /const columnSignature = mobileColumnsSignature\(columns\)/);
  assert.doesNotMatch(src, /(read|write)MobileColumnKeys\(label/);
});

// "Ingen vandret scroll" skal vaere en spaerring i markuppen, ikke et held med
// testdataens korte navne.
test("mobil-standardtilstanden kan ikke scrolle vandret", () => {
  assert.match(src, /MOBILE_SCROLLER/);
  assert.match(styles, /overflow-x-hidden/);
  // Navnecellen giver plads fra sig (w-full + max-w-0) og wrapper i stedet for
  // at staa paa een nowrap-linje.
  assert.match(src, /w-full max-w-0/);
  assert.match(src, /renderStickyCell\(entityCol, row, i, foldCols, true\)/);
  assert.match(src, /function renderStickyCell\(col, row, i, foldCols, wrap = false\)/);
});

// Ejerens ordrette krav i D-047 var "Husk at tjekke for ai slop". TASTE §3:
// ingen gradienter, ingen skygger, ingen raa hex i JSX. Kilden er den eneste
// vagt der kan fange det FOER CI's ratchet (scripts/check-anti-slop.mjs).
test("DataTable har hverken gradient, skygge eller raa hex i markuppen", () => {
  const markup = stripComments(src);
  assert.doesNotMatch(markup, /bg-gradient-to-|(?:linear|radial|conic)-gradient\s*\(/);
  assert.doesNotMatch(markup, /shadow-(?!overlay|none)/);
  assert.deepEqual(rawHexColors(markup), []);
});

// D-047 ordret: navneblokken er sin EGEN kolonne ved siden af en scrollbar
// datablok, "ikke CSS sticky" (#5060's fejlklasse). To-lags-tilstanden maa
// derfor ikke laene sig op ad tdClass' sticky-recept.
test("\"Fuld tabel\" er to-lags med to separate tabeller, ikke en sticky kolonne", () => {
  const block = src.slice(src.indexOf("function MobileFullTable"));
  assert.match(block, /nameRef/);
  assert.match(block, /dataRef/);
  assert.match(block, /overflow-x-auto/);
  assert.doesNotMatch(block, /sticky: true/);
  // Raekkehoejderne synkroniseres i JS, ellers glider de to blokke fra hinanden.
  assert.match(block, /getBoundingClientRect\(\)\.height/);
  assert.match(block, /ResizeObserver/);
  // Hoejderne laases inline paa hver <tr>, saa ResizeObserver ser IKKE en
  // indholdsaendring inde i en uaendret raekke — derfor ogsaa MutationObserver,
  // og en raekke-signatur af IDENTITET (rowKey), ikke af antal.
  assert.match(block, /MutationObserver/);
  assert.match(block, /rows\.map\(\(row, i\) => \(rowKey \? rowKey\(row, i\) : i\)\)\.join\("\|"\)/);
  // Begge lag skal have lige mange <tr>, ogsaa i tom tilstand.
  assert.match(block, /empty=\{empty \? <span aria-hidden="true">&nbsp;<\/span> : null\}/);
});

// Begge blokkes headere skal opfoere sig ENS — den vandrette scroller om
// datablokken er selv en scroll-container, saa kun den ene ville "hænge fast".
test("to-lags-tilstanden slaar den laaste overskriftsraekke fra i BEGGE blokke", () => {
  assert.match(styles, /stickyHeader = true/);
  assert.match(styles, /stickyHeader \? "sticky top-0 z-table-head" : ""/);
  const block = src.slice(src.indexOf("function MobileFullTable"));
  assert.equal((block.match(/stickyHeader=\{false\}/g) ?? []).length, 2);
});

// TASTE §3-forbudslisten (ejerens AI-slop-tjek i D-047): stroke-ikon, aldrig
// emoji; 999px-pillen er tilladt for chips, men kun for chips.
test("chip-raekken foelger TASTE: text-2xs uppercase, hairline, pille-radius, stroke-ikon", () => {
  const block = stripComments(
    src.slice(src.indexOf("function MobileColumnChips"), src.indexOf("function MobileFullTable"))
  );
  assert.match(block, /rounded-cz-pill/);
  assert.match(block, /text-2xs/);
  assert.match(block, /uppercase/);
  assert.match(block, /border-cz-1/); // aktiv chip = --text-1
  assert.match(block, /<TableIcon/); // stroke-ikon, ikke emoji
  assert.doesNotMatch(block, /shadow-/);
  assert.doesNotMatch(block, /gradient/); // ogsaa som mask-image (#5102-review)
  // "Fuld tabel" er neutral, aldrig gold: sidens ene gold primary er brugt.
  assert.doesNotMatch(block, /cz-accent/);
});

// Chip-raekken maa ikke omarrangere sig under fingeren: et tryk der flytter
// chippen fra plads 4 til plads 1 goer naeste tryk paa samme skaermposition til
// et tryk paa en ANDEN kolonne.
test("chip-ordenen er frosset, og raekken ruller ikke tilbage af sig selv", () => {
  assert.match(src, /applyMobileChipOrder\(columns, chipOrder\)/);
  const block = src.slice(src.indexOf("function MobileColumnChips"), src.indexOf("function MobileFullTable"));
  assert.doesNotMatch(block, /scrollLeft/);
});

// #4625 — raekkeknapper er ALTID secondary (PAGE_TEMPLATES T2). DataTable
// wrapper <tbody> i TableRowContext saa Button kan haandhaeve det — ogsaa i de
// to nye mobil-tilstande.
test("DataTable wrapper hver tbody i TableRowContext.Provider", () => {
  assert.match(src, /TableRowContext\.Provider value=\{true\}/);
  assert.equal((src.match(/<TableRowContext\.Provider value=\{true\}>/g) ?? []).length, 4);
  assert.match(src, /<TableRowContext\.Provider[\s\S]*<tbody>[\s\S]*<\/tbody>[\s\S]*<\/TableRowContext\.Provider>/);
});

// Desktop skal vaere UAENDRET af D-047: den gamle gren beholder fold-skjulet og
// den pinnede foerste kolonne.
test("desktop-grenen er uaendret: fold-skjul + sticky foerste kolonne", () => {
  assert.match(src, /hidden sm:table-cell/);
  assert.match(src, /sticky: col\.sticky/);
});
