import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { choiceLabel, columnsSummary, tableControlPayload } from "./tableTitleBar.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, "TableTitleBar.tsx"), "utf8");
const dataTableSrc = readFileSync(join(dir, "DataTable.jsx"), "utf8");

// #8280 (TASTE P21) — tabellens titellinje.
test("columnsSummary viser N/M og holder N inden for 0..M", () => {
  assert.equal(columnsSummary(3, 9), "3/9");
  assert.equal(columnsSummary(12, 9), "9/9");
  assert.equal(columnsSummary(-1, 4), "0/4");
  assert.equal(columnsSummary(undefined, undefined), "0/0");
});

test("choiceLabel viser den valgte options label og falder tilbage til den første", () => {
  const choice = { value: "2", options: [{ value: "all", label: "All" }, { value: "2", label: "Division 2" }] };
  assert.equal(choiceLabel(choice), "Division 2");
  assert.equal(choiceLabel({ ...choice, value: 2 }), "Division 2");
  assert.equal(choiceLabel({ ...choice, value: "missing" }), "All");
  assert.equal(choiceLabel({ value: "x", options: [] }), "");
});

test("table_control_used bærer kun side og kontrolnavn (aldrig værdier eller persondata)", () => {
  assert.deepEqual(tableControlPayload("rider_database", "filters"), { page: "rider_database", control: "filters" });
  assert.deepEqual(tableControlPayload("rider_rankings", "column", "top3"), {
    page: "rider_rankings",
    control: "column",
    item: "top3",
  });
  assert.deepEqual(tableControlPayload(undefined, "search"), { page: "unknown", control: "search" });
  // Kun disse tre nøgler må findes i nyttelasten.
  assert.deepEqual(Object.keys(tableControlPayload("p", "c", "i")).sort(), ["control", "item", "page"]);
});

test("titellinjen logger table_control_used og sender aldrig søgetekst", () => {
  assert.match(src, /logEvent\("table_control_used"/);
  assert.doesNotMatch(src, /logEvent\([^)]*search\.value/);
});

test("titellinjen er ÉN linje på mindst 44 px med hairline, uden pille-radius, skygge og guld", () => {
  assert.match(src, /min-h-11/);
  assert.match(src, /border-b border-cz-border/);
  assert.doesNotMatch(src, /rounded-cz-pill/);
  assert.doesNotMatch(src, /shadow-/);
  assert.doesNotMatch(src, /bg-cz-accent\b|text-cz-accent\b/, "en tabel-kontrol er aldrig sidens guld-primary");
});

test("hvert valg er et ord med pil og sit eget native select", () => {
  assert.match(src, /<select\b/);
  assert.match(src, /ChevronDownIcon/);
  assert.match(src, /aria-label=\{choice\.ariaLabel\}/);
});

test("kolonne-knappen viser tabel-ikon + N/M og åbner et ark", () => {
  assert.match(src, /TableIcon/);
  assert.match(src, /columnsSummary\(columns\.count, columns\.total\)/);
  assert.match(src, /role="dialog"/);
  assert.match(src, /useModalA11y/);
});

test("søg er ikon på telefon og felt på computer", () => {
  assert.match(src, /sm:hidden/);
  assert.match(src, /hidden w-48 flex-none sm:block/);
});

test("DataTable bruger titellinjen i tabellens ramme og dropper chip-rækken på mobil", () => {
  assert.match(dataTableSrc, /import TableTitleBar from "\.\/TableTitleBar\.jsx"/);
  assert.match(dataTableSrc, /renderTitleBar\(titleBar, mobileColumnsControl\)/);
  assert.match(dataTableSrc, /\(hasChips && !titleBar\) \|\| viewModes/);
});

test("navnet brydes aldrig midt i ordet i mobilens navnecelle", () => {
  assert.match(dataTableSrc, /"min-w-0 wrap-normal \*:min-w-0 \*\*:whitespace-normal"/);
});
