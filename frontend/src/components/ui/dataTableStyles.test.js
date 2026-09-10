import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  // #5060: `border-r` alene forsvinder ved vandret scroll (border-collapse:
  // collapse lægger den i tabellens border-grid, ikke i cellen) — cellen tegner
  // derfor selv reglen som et 1px pseudo-element.
  assert.ok(c.includes("cz-pinned-rule-end"), "den pinnede celle skal selv tegne højre-rulen (#5060)");
});

test("#5060: .cz-pinned-rule-* tegner en 1px hairline, ikke en skygge", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.css"), "utf8");
  const block = css.slice(css.indexOf(".cz-pinned-rule-end::after"));
  assert.ok(block.length > 0, "index.css mangler .cz-pinned-rule-end::after");
  assert.match(block.slice(0, 400), /position:\s*absolute/);
  assert.match(block.slice(0, 400), /width:\s*1px/);
  assert.match(block.slice(0, 400), /background-color:\s*var\(--border\)/);
  assert.doesNotMatch(block.slice(0, 400), /box-shadow/, "hairline, ikke skygge (PAGE_TEMPLATES hard don't)");
  // -1px, ikke 0: den kollapsede border males i GRAENSEN mellem cellerne (lige
  // uden for border-boxen), saa `0` ville lægge reglen ved siden af den og give
  // en 2px-streg i hvile. Målt ved 4x DPI: 4 device-px før, 8 med `0`.
  assert.match(css, /\.cz-pinned-rule-end::after\s*\{\s*right:\s*-1px;\s*\}/);
  assert.match(css, /\.cz-pinned-rule-start::after\s*\{\s*left:\s*-1px;\s*\}/);
});

// #5060: hjørnecellen (den pinnede kolonnes EGEN overskrift) skal ligge over
// resten af overskriftsrækken. Delte de samme z-lag, vandt DOM-rækkefølgen ved
// vandret scroll, og "Rider"-headeren blev malet over af "Salary"/"Wins" —
// præcis når spilleren scrollede ud for at læse tallene (mobil, 375px).
//
// De to tests herunder låser hvad `thClass()` RETURNERER. De kan ikke se hvad
// browseren MALER: får `<thead>` sit eget stacking context, bliver z-table-corner
// indkapslet uden at én klasse-streng ændrer sig. Den rigtige forward-guard er
// derfor `tests/e2e/5060-mobile-sticky-name-column.spec.js`, som måler position,
// `elementFromPoint` og hairline i både mobile-chromium og mobile-webkit — og
// som er verificeret rød på pre-fix-koden på begge motorer. Ændrer du recepten
// her, så kør den spec, ikke kun denne fil.
test("#5060: kun ÉT z-lag pr. header-celle, og hjørnet ligger over resten", () => {
  const plain = thClass();
  const corner = thClass({ sticky: true });
  const pinned = thClass({ pinned: true });

  assert.ok(plain.includes("z-table-head"));
  assert.ok(!plain.includes("z-table-corner"));

  assert.ok(corner.includes("z-table-corner"), "sticky header-celle skal have hjørne-laget");
  assert.ok(!corner.includes("z-table-head"), "to z-index-utilities på samme celle er et cascade-væddeløb, ikke en beslutning");

  // `pinned` = samme lag uden STICKY-opskriften; til håndrullede tabeller der
  // pinner med deres egen offset (Træningssiden: left-0 + left-10).
  assert.ok(pinned.includes("z-table-corner"));
  assert.ok(!pinned.includes("z-table-head"));
  assert.ok(!pinned.includes("left-0"), "pinned må ikke tvinge en offset — kaldstedet ejer den");
  assert.ok(!pinned.includes("min-w-[148px]"));

  // Kroppens pinnede kolonne bliver under header-rækken (lodret scroll).
  assert.ok(tdClass({ sticky: true }).includes("z-table-col"));
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
