import { test } from "node:test";
import assert from "node:assert/strict";
import { WRAP, COUNT, thClass, tdClass, trClass, zonePillClass } from "./dataTableStyles.js";

// #2849 bølge 0 — cz-table-recipen (T2, docs/design/PAGE_TEMPLATES.md).

test("wrap: 12px radius + hairline på bg-card, ingen skygge", () => {
  assert.ok(WRAP.includes("rounded-[12px]"));
  assert.ok(WRAP.includes("border-cz-border"));
  assert.ok(WRAP.includes("bg-cz-card"));
  assert.ok(!WRAP.includes("shadow"));
});

test("header-celle: 11px uppercase tracking .06em i text-3", () => {
  const c = thClass();
  assert.ok(c.includes("text-[11px]"));
  assert.ok(c.includes("uppercase"));
  assert.ok(c.includes("tracking-[.06em]"));
  assert.ok(c.includes("text-cz-3"));
  assert.ok(c.includes("text-left"));
});

test("numerisk celle er højrestillet font-data tabular", () => {
  const c = tdClass({ numeric: true });
  assert.ok(c.includes("text-right"));
  assert.ok(c.includes("tabular-nums"));
  assert.ok(c.includes("font-data"));
});

test("sticky kolonne: opak bg + 1px højre-rule + mobil-min-bredde — ALDRIG rå skygge", () => {
  const c = tdClass({ sticky: true });
  assert.ok(c.includes("sticky left-0"));
  assert.ok(c.includes("border-r"));
  assert.ok(c.includes("bg-cz-card"));
  assert.ok(c.includes("min-w-[148px]"));
  assert.ok(!c.includes("shadow"), "sticky-skyggen er erstattet af opak celle + højre-rule");
});

test("zone-rækker: fuld-række-tint, ingen hover, 2px separator kun på boundary", () => {
  const tinted = tdClass({ zone: "success" });
  assert.ok(tinted.includes("bg-cz-success-bg"));

  // Dark theme har translucent zone-bg → sticky-celler skal have opak card-bund
  // under tinten, ellers ses kolonnerne igennem dem under scroll.
  const stickyTinted = tdClass({ zone: "success", sticky: true });
  assert.ok(stickyTinted.includes("bg-cz-card"));
  assert.ok(stickyTinted.includes("background-image:linear-gradient(var(--success-bg)"));
  assert.ok(tinted.includes("border-t border-cz-border"), "ikke-boundary beholder 1px-rule");

  const boundary = tdClass({ zone: "danger", edgeTop: true });
  assert.ok(boundary.includes("border-t-2"));
  assert.ok(boundary.includes("border-t-cz-danger/40"));
  assert.ok(!boundary.includes("border-t border-cz-border"), "2px-separatoren erstatter 1px-rulen");

  assert.equal(trClass("success"), "", "tintede rækker har ingen hover-highlight");
  assert.ok(trClass(null).includes("hover:bg-cz-subtle"));
});

test("zone-pill: 9px uppercase, tone-bg + tone-tekst", () => {
  const c = zonePillClass("danger");
  assert.ok(c.includes("text-[9px]"));
  assert.ok(c.includes("uppercase"));
  assert.ok(c.includes("bg-cz-danger-bg"));
  assert.ok(c.includes("text-cz-danger"));
});

test("count-linje: font-data 12px i text-3", () => {
  assert.ok(COUNT.includes("font-data"));
  assert.ok(COUNT.includes("text-xs"));
  assert.ok(COUNT.includes("text-cz-3"));
});
