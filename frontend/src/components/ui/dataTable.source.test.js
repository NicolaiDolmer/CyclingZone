import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "DataTable.jsx"), "utf8");
const styles = readFileSync(join(here, "dataTableStyles.js"), "utf8");

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

test("kolonnevalget huskes pr. tabel-label", () => {
  assert.match(src, /readMobileColumnKeys\(label, columns, mobileDefaults\)/);
  assert.match(src, /writeMobileColumnKeys\(label, next\)/);
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
  const block = src.slice(src.indexOf("function MobileColumnChips"), src.indexOf("function MobileFullTable"));
  assert.match(block, /rounded-cz-pill/);
  assert.match(block, /text-2xs/);
  assert.match(block, /uppercase/);
  assert.match(block, /border-cz-1/); // aktiv chip = --text-1
  assert.match(block, /<TableIcon/); // stroke-ikon, ikke emoji
  assert.doesNotMatch(block, /shadow-/);
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
