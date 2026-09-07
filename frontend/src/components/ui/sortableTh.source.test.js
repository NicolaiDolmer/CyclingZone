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

// #4989 (CodeRabbit, PR #4989): en <th onClick> uden fokuserbart element kan
// ikke betjenes af tastatur-brugere. Header-cellen skal derfor indeholde en
// native <button type="button"> som ejer klikket, mens aria-sort bliver på
// <th> (den semantiske celle screenreadere annoncerer sort-status på).
test("header-teksten sidder i en fokuserbar <button type=\"button\">, ikke direkte i en klikbar <th>", () => {
  assert.match(
    src,
    /<button\s+type="button"[\s\S]*?onClick=\{\(\)\s*=>\s*onSort\(sortKey\)\}/,
    "onSort skal aktiveres via en native <button>, ikke kun via et th-onClick uden tastatur-adgang",
  );
  // Regressions-guard for selve #4989-fundet: <th> må IKKE selv have onClick
  // (det var den ikke-fokuserbare klik-flade tastatur-brugere ikke kunne nå).
  assert.doesNotMatch(
    src,
    /<th\s[^>]*onClick=/,
    "onClick må ikke ligge direkte på <th> — det er den ikke-tastatur-tilgængelige variant #4989 fjernede",
  );
});

test("aria-sort bliver på <th> (den semantiske tabel-celle), selvom klikket sidder på en indre <button>", () => {
  const thBlock = src.match(/<th\s+title=\{title\}[\s\S]*?>/);
  assert.ok(thBlock, "kunne ikke finde <th>-åbningstagget (med title-prop) i SortableTh.jsx");
  assert.match(thBlock[0], /aria-sort=/, "aria-sort skal stå på <th>, ikke kun på den indre knap");
});
