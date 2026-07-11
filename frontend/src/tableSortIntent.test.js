import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// GUARD: hver tabel på siden SKAL erklære sin sorterings-intention — OG
// data-sortable-flaget skal holde stik.
//
// Baggrund: nye tabeller blev gang på gang shippet uden sortering, fordi intet
// tvang et valg. Denne kilde-tekst-guard (samme mønster som #1537) fejler hvis
// en <table> eller den delte <Table> mangler ET af to eksplicitte flag:
//
//   data-sortable                  → tabellen ER sorterbar (SortableTh/Table.Th
//                                    med onSort, useTableSort, egen sort-state,
//                                    eller server-sort).
//   data-sort-exempt="<grund>"     → bevidst usorteret; grunden dokumenteres i
//                                    selve JSX'en (fx "rangliste, iboende orden"
//                                    eller "fast opslags-tabel, 2 rækker").
//
// #2329: den oprindelige guard tjekkede KUN at flaget fandtes — den fangede
// derfor ikke to tabeller hvor flaget var løgn (TeamTransferHistoryTab.jsx:
// profit-panelet havde data-sortable men INGEN sort-mekanisme; historik-
// tabellen havde omvendt en RIGTIG sortering bag et data-sort-exempt-flag).
// Guarden verificerer nu OGSÅ at et data-sortable-tag rent faktisk indeholder
// en header-sort-mekanisme mellem åbnings- og lukke-tagget (SortableTh/SortTh/
// onSort/aria-sort) — ellers kan flaget sættes uden at bygge sorteringen.
//
// Én ny <table> uden et af flagene — eller med et data-sortable uden reel
// mekanisme — kan derfor ikke merges uubemærket. Sådan stoppes "vi glemte
// sortering igen" OG "vi løj om at den var sorterbar".
//
// Tilføj sortering: importér useTableSort (lib/useTableSort.js) + SortableTh
// (components/ui/SortableTh) ELLER giv den delte <Th> sortKey/sort/sortDir/onSort.

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = __dirname; // frontend/src

// Filer der ikke tæller som "en tabel på siden":
//  - ui/Table.jsx: selve den delte primitiv (definerer <table>, er ikke en flade).
//  - KitchenSinkPage.jsx: intern komponent-showcase, ikke en spiller-/admin-flade.
const SKIP_FILES = new Set([
  join("components", "ui", "Table.jsx"),
  join("pages", "KitchenSinkPage.jsx"),
]);

// Åbnings-tags for rå <table> og den delte <Table>-komponent. `[^>]*` matcher
// også newlines (alt "ikke >"), så et tag spredt over flere linjer fanges også.
const TABLE_TAG_RE = /<[Tt]able\b[^>]*>/g;
const SORTABLE_RE = /data-sortable\b/;
const EXEMPT_RE = /data-sort-exempt=["'][^"']+["']/;
// Lukke-tag for både <table> og den delte <Table>-komponent.
const CLOSE_TAG_RE = /<\/(?:table|Table)>/;
// Faktisk header-sort-mekanisme: den kanoniske SortableTh, en lokal SortTh-
// variant (fx RiderSortTh), et rå onSort-prop, eller aria-sort sat direkte.
const MECHANISM_RE = /\b(?:SortableTh|SortTh|onSort|aria-sort)\b/;

// Nogle tabeller delegerer HELE <thead> til en lokal komponent (fx
// AuctionsPage.jsx: <table><AuctionTableHead .../><tbody>...), så mekanismen
// (onSort/SortTh) lever i den komponents funktionskrop, ikke lexisk mellem
// <table> og </table>. Fald tilbage til at slå den delegerede komponents
// definition op i samme fil og lede efter mekanismen der.
const JSX_COMPONENT_TAG_RE = /<([A-Z]\w*)/g;

function bodyDelegatesMechanism(src, body) {
  for (const cm of body.matchAll(JSX_COMPONENT_TAG_RE)) {
    const name = cm[1];
    const defRe = new RegExp(`function\\s+${name}\\s*\\(|const\\s+${name}\\s*=`);
    const defMatch = defRe.exec(src);
    if (!defMatch) continue;
    const from = defMatch.index;
    // Grov afgrænsning af komponentens krop: op til næste top-level
    // function/const-deklaration (ny linje der starter en ny definition),
    // eller filens slutning.
    const nextDefRe = /\n(?:function\s+[A-Z]\w*\s*\(|export default|const\s+[A-Z]\w*\s*=)/g;
    nextDefRe.lastIndex = from + 1;
    const nextMatch = nextDefRe.exec(src);
    const to = nextMatch ? nextMatch.index : src.length;
    if (MECHANISM_RE.test(src.slice(from, to))) return true;
  }
  return false;
}

function collectJsxFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsxFiles(full, acc);
    } else if (entry.name.endsWith(".jsx") && !entry.name.includes(".test.")) {
      acc.push(full);
    }
  }
  return acc;
}

function findViolations() {
  const violations = [];
  for (const file of collectJsxFiles(SRC_ROOT)) {
    const rel = relative(SRC_ROOT, file);
    if (SKIP_FILES.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    const relPath = rel.split(sep).join("/");
    for (const m of src.matchAll(TABLE_TAG_RE)) {
      const tag = m[0];
      const hasSortable = SORTABLE_RE.test(tag);
      const hasExempt = EXEMPT_RE.test(tag);
      if (!hasSortable && !hasExempt) {
        violations.push({
          file: relPath,
          tag: tag.slice(0, 90),
          reason: "mangler data-sortable/data-sort-exempt",
        });
        continue;
      }
      if (hasSortable) {
        const tagEnd = m.index + tag.length;
        const rest = src.slice(tagEnd);
        const closeMatch = CLOSE_TAG_RE.exec(rest);
        const body = closeMatch ? rest.slice(0, closeMatch.index) : rest;
        if (!MECHANISM_RE.test(body) && !bodyDelegatesMechanism(src, body)) {
          violations.push({
            file: relPath,
            tag: tag.slice(0, 90),
            reason: "data-sortable uden faktisk sort-mekanisme (SortableTh/SortTh/onSort/aria-sort)",
          });
        }
      }
    }
  }
  return violations;
}

test("hver <table>/<Table> erklærer sorterings-intention (data-sortable | data-sort-exempt), og data-sortable holder stik", () => {
  const violations = findViolations();
  const detail = violations.map((v) => `  ${v.file}: [${v.reason}] ${v.tag}`).join("\n");
  assert.equal(
    violations.length,
    0,
    `\n${violations.length} tabel(ler) fejler sorterings-intentions-guarden.\n` +
      `Tilføj enten data-sortable (gør den sorterbar via useTableSort/SortableTh/Table.Th)\n` +
      `eller data-sort-exempt="<grund>" (bevidst usorteret) på <table>/<Table>-tagget.\n` +
      `Har tabellen data-sortable, skal den have en RIGTIG header-sort-mekanisme mellem\n` +
      `åbnings- og lukke-tagget (SortableTh/SortTh/onSort/aria-sort):\n${detail}\n`,
  );
});

// Sanity: guarden ser faktisk tabeller (fanger en fremtidig regex-/sti-brudt guard
// der stille rapporterer 0 fund og dermed intet håndhæver).
test("guarden scanner rent faktisk tabel-tags (ingen tavst no-op)", () => {
  let total = 0;
  for (const file of collectJsxFiles(SRC_ROOT)) {
    const rel = relative(SRC_ROOT, file);
    if (SKIP_FILES.has(rel)) continue;
    const m = readFileSync(file, "utf8").match(TABLE_TAG_RE);
    if (m) total += m.length;
  }
  assert.ok(total >= 30, `forventede mange tabel-tags, fandt ${total} — er regex/sti brudt?`);
});
