import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const heroStats = readFileSync(join(dir, "HeroStats.jsx"), "utf8");
const segmented = readFileSync(join(dir, "Segmented.jsx"), "utf8");
const dataTable = readFileSync(join(dir, "DataTable.jsx"), "utf8");
const index = readFileSync(join(dir, "index.js"), "utf8");

// #4628 (audit 2026-09 raekke #37) — /managers/:teamId klippede det fjerde
// hero-tal helt vaek paa 375px. Fixet er geometri: to kolonner paa mobil,
// den uaendrede vandrette raekke fra sm og op. Faerre tal er IKKE en loesning
// (TASTE P10: mobil viser de samme tal som desktop).
test("HeroStats stabler i to kolonner paa mobil og bliver en raekke fra sm", () => {
  assert.match(heroStats, /grid grid-cols-2/, "mobil skal vaere et 2-kolonners gitter, ikke en vandret scroller");
  assert.match(heroStats, /sm:flex/, "fra sm og op er raekken uaendret");
});

// PAGE_TEMPLATES.md §T3: label text-3xs uppercase tracking .1em, value 20px/650
// data-font tabular. Tallene skal vaere tabulaere begge steder.
test("HeroStats holder T3-stat-opskriften (10px label, 20px/650 tabular vaerdi)", () => {
  assert.match(heroStats, /text-3xs font-semibold uppercase tracking-\[\.1em\] text-cz-3/);
  assert.match(heroStats, /font-data text-\[20px\] font-\[650\][^"]*tabular-nums/);
});

// TASTE fork 3 (guld): aktivt segment er guld-TEKST paa 10% guld-flade, ikke en
// udfyldt knap. Og #3188: det aktive segment maa ikke se klikbart ud.
test("Segmented er en hairline-gruppe med guld-tekst paa det aktive segment", () => {
  assert.match(segmented, /rounded-cz border border-cz-border/);
  assert.match(segmented, /bg-cz-accent\/10 text-cz-accent-t/);
  assert.doesNotMatch(segmented, /shadow-|rounded-(?:lg|xl|2xl)/, "ingen skygger, ingen off-token radius");
});

test("Segmented giver det aktive segment hverken handler eller pointer-cursor (#3188)", () => {
  assert.match(segmented, /onClick=\{active \? undefined :/);
  assert.match(segmented, /cursor-default/);
});

test("Segmented er en role=group med aria-label og aria-pressed pr. segment", () => {
  assert.match(segmented, /role="group"/);
  assert.match(segmented, /aria-label=\{label\}/);
  assert.match(segmented, /aria-pressed=\{active\}/);
});

// #4628 (audit 2026-09 raekke #2) — kontroller der kun styrer tabellen laa som
// en fritsvaevende raekke over den ("no orphan action rows", PAGE_TEMPLATES).
// DataTable har nu en toolbar INDE i tabellens hairline-ramme.
test("DataTable har en toolbar-slot inde i rammen, over scrolleren", () => {
  assert.match(dataTable, /toolbar = null/, "toolbar er en opt-in prop");
  assert.match(
    dataTable,
    /\{toolbar &&[\s\S]{0,320}?border-b border-cz-border[\s\S]{0,200}?<div className=\{SCROLLER\}>/,
    "toolbaren skal staa inde i WRAP, over SCROLLER, adskilt af en hairline",
  );
});

test("de to nye primitiver eksporteres fra kittets index", () => {
  assert.match(index, /from "\.\/Segmented\.jsx"/);
  assert.match(index, /from "\.\/HeroStats\.jsx"/);
});
