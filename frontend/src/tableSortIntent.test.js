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

// #7533: .tsx med. Kalendertabellen og Løbshistorik er .tsx og slap derfor uden om guarden.
function collectJsxFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsxFiles(full, acc);
    } else if (/\.(jsx|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
      acc.push(full);
    }
  }
  return acc;
}

// #7533 (ejer 2/11: "Sørg lige for at tabeller altid kan sortere fra start af"):
// den delte <DataTable> skal have onSort, eller data-sort-exempt="<grund>". Props
// indeholder pile (`=>`), så tagget afgrænses ved første `>` uden for {} og strenge.
const DATA_TABLE_OPEN = "<DataTable";

// Selve primitiven og dens mobil-indpakning videresender kun props; de er ikke en flade.
const DATA_TABLE_SKIP = new Set([
  join("components", "ui", "DataTable.jsx"),
  join("components", "ui", "MobileTableChips.jsx"),
]);

// Ratchet: ældre DataTables uden sortering da guarden kom (2/11). Listen må kun
// skrumpe; gør tabellen sorterbar og fjern linjen. Nye tabeller kan ikke komme på.
const DATA_TABLE_BASELINE = new Set([
  "components/squad/YouthRacesTab.tsx",
  "pages/HallOfFamePage.jsx",
  "pages/StaffOverviewPage.jsx",
  "pages/TradeListPage.tsx",
  "pages/admin/AdminFeedbackTab.jsx",
  "pages/admin/AdminForumTab.jsx",
]);

function jsxOpenTag(src, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== "\\") quote = null; continue; }
    if (c === "/" && src[i + 1] === "*") { // kommentarer mellem props (kan indeholde ` og ')
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(from, i + 1);
  }
  return src.slice(from);
}

function inComment(src, at) {
  const linePrefix = src.slice(src.lastIndexOf("\n", at) + 1, at);
  if (linePrefix.includes("//")) return true;
  // Inde i /* ... */ (også {/* */} i JSX). Et "/*" i en //-linje (fx "frontend/**") åbner intet.
  for (let i = src.indexOf("/*"); i !== -1 && i < at; i = src.indexOf("/*", i + 2)) {
    if (src.slice(src.lastIndexOf("\n", i) + 1, i).includes("//")) continue;
    const end = src.indexOf("*/", i + 2);
    if (end === -1 || end > at) return true;
    i = end;
  }
  return false;
}

/** Usorterede <DataTable>-tags i én fils kilde (kommentarer og {...props}-indpakninger tæller ikke). */
function unsortedDataTables(src) {
  const out = [];
  for (let at = src.indexOf(DATA_TABLE_OPEN); at !== -1; at = src.indexOf(DATA_TABLE_OPEN, at + 1)) {
    if (/\w/.test(src[at + DATA_TABLE_OPEN.length])) continue; // fx <DataTableBase
    if (inComment(src, at)) continue;
    const tag = jsxOpenTag(src, at);
    // En tynd indpakning ({...props}) videresender kalderens onSort; kalderen tjekkes selv.
    if (/\{\s*\.\.\./.test(tag)) continue;
    if (!/\bonSort=/.test(tag) && !EXEMPT_RE.test(tag)) out.push(tag);
  }
  return out;
}

function findDataTableViolations() {
  const violations = [];
  for (const file of collectJsxFiles(SRC_ROOT)) {
    const rel = relative(SRC_ROOT, file);
    const relPath = rel.split(sep).join("/");
    if (SKIP_FILES.has(rel) || DATA_TABLE_SKIP.has(rel) || DATA_TABLE_BASELINE.has(relPath)) continue;
    for (const tag of unsortedDataTables(readFileSync(file, "utf8"))) {
      violations.push({ file: relPath, tag: tag.replace(/\s+/g, " ").slice(0, 90) });
    }
  }
  return violations;
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

test("#7533 hver <DataTable> kan sorteres (onSort) eller har data-sort-exempt=\"<grund>\"", () => {
  const violations = findDataTableViolations();
  const detail = violations.map((v) => `  ${v.file}: ${v.tag}`).join("\n");
  assert.equal(
    violations.length,
    0,
    `\n${violations.length} DataTable(s) uden sortering.\n` +
      `Giv kolonnerne sortKey og tabellen sort/sortDir/onSort (useTableSort/useSortState),\n` +
      `eller sæt data-sort-exempt="<grund>" hvis rækkefølgen er selve indholdet (fx en rangliste):\n${detail}\n`,
  );
});

test("#7533 ratchet: en fil på DataTable-listen der nu kan sortere, skal fjernes fra listen", () => {
  const stale = [...DATA_TABLE_BASELINE].filter(
    (rel) => unsortedDataTables(readFileSync(join(SRC_ROOT, ...rel.split("/")), "utf8")).length === 0,
  );
  assert.deepEqual(stale, [], `Fjern fra DATA_TABLE_BASELINE: ${stale.join(", ")}`);
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
