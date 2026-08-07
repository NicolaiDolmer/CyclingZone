#!/usr/bin/env node
// scripts/lint-t2-container-guard.mjs
// ============================================================
// T2-container forward-guard — #3454.
//
// REGEL (docs/design/PAGE_TEMPLATES.md, bindende): en side med en DENSE
// tabel (den kanoniske <DataTable> — T2's "wide data"-recipe) hører hjemme
// i T2 (max-w-[1600px]), ikke T1 (max-w-4xl). #3454 var tredje gang samme
// fejlklasse ramte production (#1675, #1186, #2446): en side fik den
// kanoniske DataTable-komponent, men beholdt sin T1-container, så tabellen
// sad klemt i midten af skærmen med spildt whitespace i siderne.
//
// Denne guard flagger enhver frontend/src/pages/*.jsx-fil der BÅDE
//   (a) renderer en <DataTable ...> — den kanoniske T2-tabel-komponent, og
//   (b) wrapper sit indhold i en max-w-4xl-container (T1's recipe)
// medmindre filen står i ALLOWLIST nedenfor med en begrundelse for hvorfor
// den bevidst bliver på T1 (fx en lille DataTable i et faneblad på en
// ellers læse-tung side — se HallOfFamePage).
//
// IKKE en ratchet (som lint-ui-slop.mjs) — dette er et lille, lukket sæt
// filer hvor hver undtagelse skal begrundes eksplicit, ikke en baseline der
// blot fryser status quo.
//
// Brug:
//   node scripts/lint-t2-container-guard.mjs
//
// Refs #3454, #2849 (PAGE_TEMPLATES.md), #1675, #1186, #2446.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripComments } from "./lint-ui-slop.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PAGES_DIR = join(ROOT, "frontend", "src", "pages");

// Sider der bevidst BLIVER på T1 selvom de indeholder en <DataTable>-brug.
// Hver entry SKAL have en begrundelse — ny brug af allowlisten uden
// begrundelse er selv en review-rødt-flag.
export const ALLOWLIST = {
  // #2849 bølge 3: manager-ranglisten (fanebladet "managers") er den eneste
  // tabel på siden tæt nok på T2's "dense wide data"-form til at bruge
  // DataTable direkte (sticky navnekolonne) — men selve kolonnetallet (4:
  // navn/titel/niveau/xp) og resten af siden (rekord-lister, sæson-historik)
  // er læse-tunge T1-kort, ikke en tabel-tung dataflade. Vurderet + fastholdt
  // T1 igen under #3454-auditten 7/8.
  "frontend/src/pages/HallOfFamePage.jsx":
    "manager-fanebladets DataTable er 4 kolonner i ét ud af tre faneblade på en ellers læse-tung side — ikke data-tung nok til T2 (#2849 bølge 3, revurderet #3454).",
};

const DATATABLE_USE_RE = /<DataTable\b/;
const T1_CONTAINER_RE = /max-w-4xl/;

function walk(dir, match, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      walk(p, match, out);
    } else if (match(f)) {
      out.push(p);
    }
  }
  return out;
}

const matchPage = (f) => /\.jsx$/.test(f) && !/\.test\.jsx$/.test(f);

// Returnér relative stier for sider der bruger DataTable + max-w-4xl.
export function findT2CandidatesInSource(src) {
  const clean = stripComments(src);
  return DATATABLE_USE_RE.test(clean) && T1_CONTAINER_RE.test(clean);
}

export function scanPages() {
  const hits = [];
  for (const file of walk(PAGES_DIR, matchPage)) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    const src = readFileSync(file, "utf8");
    if (findT2CandidatesInSource(src)) hits.push(rel);
  }
  return hits;
}

function main() {
  const hits = scanPages();
  const unallowed = hits.filter((f) => !(f in ALLOWLIST));

  if (unallowed.length) {
    console.error(`\n❌ ${unallowed.length} side(r) bruger den kanoniske <DataTable> (T2-recipe) inde i en T1-container (max-w-4xl):`);
    for (const f of unallowed) console.error(`   - ${f}`);
    console.error(`
Fix:
  - Data-tung side (tabellen ER pointen)? Flyt siden til T2: skift
    max-w-4xl → max-w-[1600px] i sidens container-div + tilføj rutens sti
    til WIDE_CONTENT_ROUTES i frontend/src/components/Layout.jsx.
  - Læse-tung side med en lille tabel i sidelinjen? Tilføj filen til
    ALLOWLIST i scripts/lint-t2-container-guard.mjs MED en konkret
    begrundelse (kolonnetal, radtal, hvorfor T1 stadig er retvisende).
Baggrund: docs/design/PAGE_TEMPLATES.md (T1 vs T2), #3454, #2849.`);
    process.exit(1);
  }

  const staleAllowlist = Object.keys(ALLOWLIST).filter((f) => !hits.includes(f));
  if (staleAllowlist.length) {
    console.log(`ℹ️  ${staleAllowlist.length} allowlist-entry/entries matcher ikke længere nogen fil med DataTable+max-w-4xl (kan ryddes):`);
    for (const f of staleAllowlist) console.log(`   - ${f}`);
  }

  console.log(`\n✅ T2-container-guard: ingen T1-sider med en ubegrundet dense DataTable (${Object.keys(ALLOWLIST).length} begrundede undtagelser).`);
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) main();
