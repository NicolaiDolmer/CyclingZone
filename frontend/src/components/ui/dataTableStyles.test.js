import { test } from "node:test";
import assert from "node:assert/strict";
import { WRAP, COUNT, thClass, tdClass, trClass, zonePillClass, mergeRowProps } from "./dataTableStyles.js";

// #2849 bølge 0 — cz-table-recipen (T2, docs/design/PAGE_TEMPLATES.md).

// #2849 bølge 4 (ejer 24/7): 12px-wrap var systemets eneste radius-outlier
// (alt andet chrome er rounded-cz 5px) — konvergeret til rounded-cz.
test("wrap: rounded-cz + hairline på bg-card, ingen skygge", () => {
  assert.ok(WRAP.includes("rounded-cz "));
  assert.ok(WRAP.includes("border-cz-border"));
  assert.ok(WRAP.includes("bg-cz-card"));
  assert.ok(!WRAP.includes("shadow"));
});

test("header-celle: text-2xs uppercase tracking .06em i text-3", () => {
  const c = thClass();
  assert.ok(c.includes("text-2xs"));
  assert.ok(c.includes("uppercase"));
  assert.ok(c.includes("tracking-[.06em]"));
  assert.ok(c.includes("text-cz-3"));
  assert.ok(c.includes("text-left"));
});

// #2906 (ejer 25/7: "rækkerne er for høje") — opt-in `dense` halverer den
// LODRETTE polstring. Default-rytmen (T2: 13px) må ikke ændre sig.
test("dense: halveret lodret polstring i både header og celle", () => {
  assert.ok(tdClass({ dense: true }).includes("py-[7px]"));
  assert.ok(!tdClass({ dense: true }).includes("py-[13px]"));
  assert.ok(thClass({ dense: true }).includes("py-2"));
  assert.ok(!thClass({ dense: true }).includes("py-3"));
});

test("dense er opt-in — T2's default-rytme er uændret", () => {
  assert.ok(tdClass().includes("py-[13px]"), "default-celle skal stadig være T2's 13px");
  assert.ok(thClass().includes("py-3"), "default-header skal stadig være py-3");
});

test("dense rører ikke den VANDRETTE gutter (det er `compact`s job)", () => {
  assert.ok(tdClass({ dense: true }).includes("px-4"));
  assert.ok(tdClass({ dense: true, compact: true }).includes("px-2"));
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

test("zone-pill: text-3xs uppercase, tone-bg + tone-tekst", () => {
  const c = zonePillClass("danger");
  assert.ok(c.includes("text-3xs"));
  assert.ok(c.includes("uppercase"));
  assert.ok(c.includes("bg-cz-danger-bg"));
  assert.ok(c.includes("text-cz-danger"));
});

test("count-linje: font-data 12px i text-3", () => {
  assert.ok(COUNT.includes("font-data"));
  assert.ok(COUNT.includes("text-xs"));
  assert.ok(COUNT.includes("text-cz-3"));
});

// #2849 bølge 1 — rowProps-hook (DataTable): per-række ref/onClick/className.
test("mergeRowProps: uden rowProps falder tilbage til ren trClass(zone)", () => {
  assert.equal(mergeRowProps("danger", null).className, trClass("danger"));
  assert.equal(mergeRowProps(null, undefined).className, trClass(null));
});

test("mergeRowProps: className KONKATENERES efter trClass(zone), ikke erstatter den", () => {
  const merged = mergeRowProps("success", { className: "ring-1 ring-cz-me-ring" });
  assert.equal(merged.className, `${trClass("success")} ring-1 ring-cz-me-ring`.trim());
  assert.ok(merged.className.startsWith(trClass("success") || ""), "zone-klassen står stadig først");
});

test("mergeRowProps: tom/manglende zone-klasse giver ikke et lorent mellemrum", () => {
  // trClass(zone="success") === "" — konkatenering skal ikke efterlade et
  // ledende blank i den mergede className.
  const merged = mergeRowProps("success", { className: "ring-1" });
  assert.equal(merged.className, "ring-1");
});

test("mergeRowProps: øvrige props (onClick, ref, data-*) spredes uændret — onClick rammer rækken", () => {
  let hit = false;
  const onClick = () => { hit = true; };
  const ref = () => {};
  const merged = mergeRowProps(null, { onClick, ref, "data-team-id": "123" });
  assert.equal(merged.onClick, onClick);
  assert.equal(merged.ref, ref);
  assert.equal(merged["data-team-id"], "123");
  merged.onClick();
  assert.ok(hit, "onClick fra rowProps skal kunne kaldes via de mergede <tr>-props");
});
