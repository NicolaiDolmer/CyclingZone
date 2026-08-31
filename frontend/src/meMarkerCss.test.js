import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "index.css"), "utf8");

// Forward-guard for #2795-opfoelgningen, skrevet efter adversarisk review 31/8.
//
// Foerste forsoeg lagde "dig"-fladetoningen som `background-color` paa cellerne.
// Det saa rigtigt ud i en tom tabel, men reglen har specificitet (0,1,2) og
// vandt derfor over de Tailwind-utilities (0,1,0) der maler cellernes EGEN
// baggrund. Tre tavse regressioner fulgte, alle kun paa brugerens egen raekke:
//   1. DataTables sticky navnecelle er bevidst opak (bg-cz-card,
//      dataTableStyles.js:75) fordi kolonnerne scroller ind under den. Den blev
//      95 % gennemsigtig, saa tallene kunne ses gennem holdnavnet.
//   2. Zone-tinten paa /standings (bg-cz-success-bg / bg-cz-danger-bg) blev
//      erstattet, saa egen raekke var den ENESTE farveloese i sin zone.
//   3. <Card>'s bg-cz-card paa Global Rank-baandet forsvandt paa samme maade.
// Dertil erstattede zone-reglen dig-markeringen helt for divisionslederen paa
// saeson-afslutningen, fordi box-shadow ikke kaskaderer sammen: to regler med
// samme specificitet giver den sidstes skygge, ikke begges.
//
// Testen laaser mekanikken, ikke udseendet. e2e-specen
// (tests/e2e/me-marker-cells.spec.js) maaler det renderede resultat.

// Klippet ud af index.css: fra me-markerings-kommentaren til og med
// blok-varianterne. Holder assertions vaek fra resten af stylesheetet.
const blockStart = css.indexOf('/* "Dig"-markering paa tabelraekker');
const blockEnd = css.indexOf("}", css.indexOf(".cz-me-block-bar {")) + 1;
const block = css.slice(blockStart, blockEnd);

test("me-markerings-blokken findes og daekker alle varianter", () => {
  assert.ok(block.length > 500, "kunne ikke klippe me-markerings-blokken ud af index.css");
  for (const cls of [".cz-me-block", ".cz-me-block-bar", "tr.cz-me", "tr.cz-me-bar", "tr.cz-zone-up", "tr.cz-zone-down", "tr.cz-compare"]) {
    assert.ok(block.includes(cls), `mangler ${cls}`);
  }
});

test("fladetoningen er en inset skygge, ALDRIG en background-color", () => {
  // Kernen i fundet: en background-color paa markerings-klasserne ERSTATTER
  // cellens/kortets egen baggrund i stedet for at laegge sig ovenpaa.
  assert.ok(
    !/background-color\s*:/.test(block),
    "me-markeringen saetter background-color igen - den vinder over Tailwinds " +
      "bg-cz-card/bg-cz-success-bg og goer sticky-cellen gennemsigtig. " +
      "Brug en inset box-shadow som toning i stedet.",
  );
  assert.match(block, /--cz-mark-tint:\s*inset 0 0 0 9999px rgb\(var\(--me-ring\) \/ 0\.05\)/);
  assert.match(block, /\.cz-me-block\s*\{[^}]*inset 0 0 0 9999px rgb\(var\(--me-ring\) \/ 0\.05\)/);
});

test("bar-varianterne toner ikke - de er kun kant", () => {
  // Raekker/blokke der allerede baerer leder-guld faar KUN kanten, ellers
  // ligger toningen oven paa guldet.
  const bar = block.slice(block.indexOf("tr.cz-me-bar {"));
  assert.match(bar.slice(0, 120), /--cz-mark-me:/);
  assert.ok(!/--cz-mark-tint/.test(bar.slice(0, 120)), "tr.cz-me-bar maa ikke saette toningen");
  const blockBar = block.slice(block.indexOf(".cz-me-block-bar {"));
  assert.ok(!/9999px/.test(blockBar.slice(0, 160)), ".cz-me-block-bar maa ikke toneres");
});

test("dig + zone paa samme raekke daekker BEGGE me-varianter", () => {
  // Lederen af en division er altid ogsaa i op-rykningszonen, saa `.cz-me-bar`
  // + `.cz-zone-up` er netop den kombination der forekommer i praksis. Da
  // reglen kun matchede `.cz-me`, tabte divisionslederen der er dig selv sin
  // markering helt paa saeson-afslutningen.
  for (const sel of [
    "tr.cz-zone-up.cz-me,",
    "tr.cz-zone-up.cz-me-bar,",
    "tr.cz-zone-down.cz-me,",
    "tr.cz-zone-down.cz-me-bar",
  ]) {
    assert.ok(block.includes(sel), `kombinations-reglen mangler ${sel}`);
  }
  // Dig rykker 3px ind, saa zonen kan beholde de yderste 3px.
  assert.match(block, /--cz-mark-me:\s*inset 6px 0 0 0 rgb\(var\(--me-ring\)\)/);
});

test("lagene komponeres i variabler, saa den ene skygge ikke erstatter den anden", () => {
  // box-shadow kaskaderer ikke sammen: to regler med samme specificitet giver
  // den sidstes skygge alene. Derfor ét sted der skriver box-shadow paa foerste
  // celle, med alle tre lag som variabler.
  const firstChild = block.slice(block.indexOf("tr.cz-me > td:first-child"));
  const decl = firstChild.slice(firstChild.indexOf("{"), firstChild.indexOf("}"));
  for (const layer of ["--cz-mark-zone", "--cz-mark-me", "--cz-mark-tint"]) {
    assert.ok(decl.includes(layer), `foerste-celle-reglen mangler laget ${layer}`);
  }
  // Foerste skygge i listen males oeverst: zonen skal staa foer "dig", ellers
  // daekker den 6px brede dig-stribe zone-bjaelken.
  assert.ok(
    decl.indexOf("--cz-mark-zone") < decl.indexOf("--cz-mark-me"),
    "zonen skal staa FOER dig i box-shadow-listen for at kunne ses",
  );
});

test("sammenlign-kanten beholder fladetoningen", () => {
  // `tr.cz-compare > td:last-child` (0,2,2) vinder over toningsreglen (0,2,1),
  // saa toningen skal skrives med her, ellers bliver sidste celle utonet.
  const compare = block.slice(block.indexOf("tr.cz-compare > td:last-child"));
  const decl = compare.slice(compare.indexOf("{"), compare.indexOf("}"));
  assert.match(decl, /inset -3px 0 0 0 rgb\(var\(--accent\)\)/);
  assert.ok(decl.includes("--cz-mark-tint"), "compare-kanten spiser fladetoningen");
});
