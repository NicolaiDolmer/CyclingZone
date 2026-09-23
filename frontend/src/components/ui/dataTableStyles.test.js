import { test } from "node:test";
import assert from "node:assert/strict";
import { WRAP, SCROLLER, MOBILE_SCROLLER, COUNT, thClass, tdClass, trClass, zonePillClass, mergeRowProps } from "./dataTableStyles.js";

// #4982/#5471 (ejer 21/9: "hele siden kan betjenes paa standard-maaden"): paa
// mobil og paa en telefon i landscape maa tabellen ALDRIG ligge i en lodret
// boks. Klasserne er kontrakten; table-page-scroll-mobile.spec.ts maaler
// adfaerden i en rigtig browser.
const BOX_MEDIA = "[@media(min-width:641px)_and_(min-height:600px)]:";

test("mobil-standarden har ingen lodret boks, og klip-containeren er ikke en scroll-container", () => {
  assert.doesNotMatch(MOBILE_SCROLLER, /max-h-/);
  assert.doesNotMatch(MOBILE_SCROLLER, /overflow-y-/);
  assert.doesNotMatch(MOBILE_SCROLLER, /overflow-auto/);
  // `clip` (ikke `hidden`) er det der lader overskriften foelge SIDEN.
  assert.ok(MOBILE_SCROLLER.includes("supports-[overflow:clip]:overflow-x-clip"));
});

test("desktop-boksen findes kun paa skaerme der er bredere end mobilgraensen OG mindst 600px hoeje", () => {
  const classes = SCROLLER.split(/\s+/);
  assert.ok(classes.includes("overflow-x-auto"), "brede tabeller skal stadig kunne skubbes vandret");
  assert.ok(!classes.includes("overflow-auto"), "overflow-auto uden media-graense ville gen-indfoere boksen");
  for (const cls of classes) {
    if (/max-h-|overflow-y-/.test(cls)) {
      assert.ok(cls.startsWith(BOX_MEDIA), `${cls} skal ligge bag ${BOX_MEDIA}`);
    }
  }
  assert.ok(classes.includes(`${BOX_MEDIA}max-h-[calc(100dvh-var(--table-sticky-offset))]`));
});

test("kortet klipper runde hjoerner uden at vaere en scroll-container, hvor browseren kan", () => {
  assert.ok(WRAP.includes("supports-[overflow:clip]:overflow-clip"));
  // Fallback for browsere uden `clip` (iOS < 16) er den gamle adfaerd.
  assert.ok(WRAP.includes("overflow-hidden"));
});

test("en tight matrix-kolonne yderst faar kant-luft (Mit hold > Evner, #4982)", () => {
  assert.ok(tdClass({ tight: true }).includes("last:pr-2"));
  assert.ok(thClass({ tight: true }).includes("last:pr-2"), "header og celle skal flugte");
  assert.ok(!tdClass({ compact: true }).includes("last:"), "kun tight-trinnet aendres");
});

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

test("dense rører ikke den VANDRETTE gutter (det er `compact`/`tight`s job)", () => {
  assert.ok(tdClass({ dense: true }).includes("px-4"));
  assert.ok(tdClass({ dense: true, compact: true }).includes("px-2"));
});

// Ejer-feedback 25/7 (#2888/#2906): evne-tallene stod stadig for langt fra
// hinanden ved px-2. `tight` er det tredje og strammeste gutter-trin, til
// tal-MATRICER hvor nabo-celler skal læses som én blok.
test("gutter i tre trin: px-4 default, px-2 compact, px-1 tight", () => {
  assert.ok(tdClass().includes("px-4"));
  assert.ok(tdClass({ compact: true }).includes("px-2"));
  assert.ok(tdClass({ tight: true }).includes("px-1"));
  assert.ok(thClass({ tight: true }).includes("px-1"), "headeren skal følge cellen, ellers flugter kolonnen ikke");
});

test("tight vinder over compact når begge er sat", () => {
  const c = tdClass({ compact: true, tight: true });
  assert.ok(c.includes("px-1"));
  assert.ok(!c.includes("px-2"));
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
