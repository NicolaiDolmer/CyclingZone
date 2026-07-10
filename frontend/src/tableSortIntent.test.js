import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// GUARD: hver tabel på siden SKAL erklære sin sorterings-intention.
//
// Baggrund: nye tabeller blev gang på gang shippet uden sortering, fordi intet
// tvang et valg. Denne kilde-tekst-guard (samme mønster som #1537) fejler hvis
// en <table> eller den delte <Table> mangler ET af to eksplicitte flag:
//
//   data-sortable                  → tabellen ER sorterbar (SortableTh/Table.Th
//                                    med onSort, useTableSort, egen sort-state,
//                                    eller server-sort). Guarden verificerer ikke
//                                    HVORDAN — kun at intentionen er erklæret.
//   data-sort-exempt="<grund>"     → bevidst usorteret; grunden dokumenteres i
//                                    selve JSX'en (fx "rangliste, iboende orden"
//                                    eller "fast opslags-tabel, 2 rækker").
//
// Én ny <table> uden et af flagene kan derfor ikke merges uubemærket — man SKAL
// tage stilling. Sådan stoppes "vi glemte sortering igen".
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
    const tags = src.match(TABLE_TAG_RE);
    if (!tags) continue;
    for (const tag of tags) {
      const hasSortable = SORTABLE_RE.test(tag);
      const hasExempt = EXEMPT_RE.test(tag);
      if (!hasSortable && !hasExempt) {
        violations.push({ file: rel.split(sep).join("/"), tag: tag.slice(0, 90) });
      }
    }
  }
  return violations;
}

test("hver <table>/<Table> erklærer sorterings-intention (data-sortable | data-sort-exempt)", () => {
  const violations = findViolations();
  const detail = violations.map((v) => `  ${v.file}: ${v.tag}`).join("\n");
  assert.equal(
    violations.length,
    0,
    `\n${violations.length} tabel(ler) mangler et sorterings-intentions-flag.\n` +
      `Tilføj enten data-sortable (gør den sorterbar via useTableSort/SortableTh/Table.Th)\n` +
      `eller data-sort-exempt="<grund>" (bevidst usorteret) på <table>/<Table>-tagget:\n${detail}\n`,
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
