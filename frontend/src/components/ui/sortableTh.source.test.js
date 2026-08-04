import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3188: en inaktiv sorterbar kolonne-header havde INGEN visuel affordance ud
// over cursor-pointer + en hover-farve (usynlig på touch, let overset på
// desktop) — kolonner "lignede en kontrol, men intet skete", mistænkt for
// dead-clicks på /team (446/1.676 sessioner, Clarity 27/7-3/8). SortIndicator
// (delt af SortableTh, DataTable og Table.Th) viser nu ALTID et diskret ikon
// på en sorterbar kolonne: den dæmpede to-vejs-pil (SortIcon) når kolonnen
// IKKE er aktiv, den skarpe retningspil (op/ned) når den ER.
//
// Kilde-tekst-test (samme mønster som table.source.test.js/page.source.test.js)
// fremfor render — .test.js køres via rå `node --test` uden JSX-loader, så en
// .jsx-fil kan ikke importeres direkte her.

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "SortableTh.jsx"), "utf8");

function sortIndicatorBody() {
  const match = src.match(/export function SortIndicator\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, "kunne ikke finde SortIndicator-funktionskroppen i SortableTh.jsx");
  return match[1];
}

test("SortIndicator importerer SortIcon (den dæmpede to-vejs-pil til inaktiv sorterbar kolonne)", () => {
  assert.match(src, /import\s*\{[^}]*\bSortIcon\b[^}]*\}\s*from\s*["']\.\/icons\/index\.jsx["']/);
});

test("SortIndicator returnerer IKKE null for inaktiv — den skal rendere et ikon (affordance)", () => {
  const body = sortIndicatorBody();
  assert.doesNotMatch(
    body,
    /if\s*\(\s*!active\s*\)\s*return\s+null/,
    "en inaktiv sorterbar header uden noget ikon er regressionen #3188 skulle fjerne",
  );
  assert.match(body, /<SortIcon\b/, "inaktiv-grenen skal rendere SortIcon");
});

test("SortIndicator viser stadig ArrowUpIcon/ArrowDownIcon for den AKTIVE kolonne, styret af dir", () => {
  const body = sortIndicatorBody();
  assert.match(body, /<ArrowDownIcon\b/);
  assert.match(body, /<ArrowUpIcon\b/);
  assert.match(body, /dir\s*===\s*["']desc["']/, "retningsvalget skal stadig afhænge af sortDir");
});

test("SortableTh (default-eksport) er uændret: onClick/aria-sort/klik-cyklus rører ikke ved denne opgave", () => {
  assert.match(src, /export default function SortableTh/);
  assert.match(src, /onClick=\{\(\)\s*=>\s*onSort\(sortKey\)\}/);
  assert.match(src, /aria-sort=\{active\s*\?\s*\(sortDir\s*===\s*["']desc["']\s*\?\s*["']descending["']\s*:\s*["']ascending["']\)\s*:\s*["']none["']\}/);
});
