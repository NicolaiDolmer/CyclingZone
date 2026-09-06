import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-string-guard for Sponsors-siden (#4265) — samme mønster som
// KlubPage.wiring.test.js / TrainingPage.wiring.test.js: læs kildefilerne som
// tekst og assertér på den wiring der bærer ejer-beslutningerne, så en
// regression fanges uden jsdom.
const src = readFileSync(new URL("./SponsorsPage.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../components/Layout.jsx", import.meta.url), "utf8");
const board = readFileSync(new URL("./BoardPage.jsx", import.meta.url), "utf8");
const financePanel = readFileSync(
  new URL("../components/SponsorContractPanel.jsx", import.meta.url),
  "utf8",
);

test("Sponsors-siden er T1 (max-w-4xl) med det kanoniske sidehoved", () => {
  assert.match(src, /max-w-4xl/);
  assert.match(src, /<PageHeader/);
  assert.doesNotMatch(src, /font-display text-\[38px\]/);
});

test("fire underline-faner via Tabs-primitivet, Overview som default", () => {
  assert.match(src, /const VALID_TABS = \["overview", "deal", "payments", "next"\]/);
  assert.match(src, /VALID_TABS\.includes\(tabParam\) \? tabParam : "overview"/);
  for (const primitive of ["<Tabs", "<TabList", "<Tab ", "<TabPanel"]) {
    assert.ok(src.includes(primitive), `mangler ${primitive}`);
  }
  assert.equal((src.match(/<TabPanel value=/g) || []).length, 4);
});

test("URL'en ER fane-tilstanden (?tab=), default-fanen rydder parametret", () => {
  assert.match(src, /useSearchParams/);
  assert.match(src, /if \(next === "overview"\) params\.delete\("tab"\)/);
  assert.match(src, /else params\.set\("tab", next\)/);
});

test("Overview: HeroStats + ProgressMeter, og etape-tallet vises kun når det findes (P11)", () => {
  assert.match(src, /<HeroStats/);
  assert.match(src, /<ProgressMeter/);
  // Fjerde stat er betinget af at etapetallet faktisk kunne udledes.
  assert.match(src, /payments\.stagesRidden != null/);
  assert.match(src, /payments\.stagesTotal != null/);
});

test("én guld pr. view: sidehovedets primary dæmpes på Next season-fanen", () => {
  assert.match(src, /variant=\{tab === "next" \? "secondary" : "primary"\}/);
  // Præcis to primary-callsites i filen: sidehovedet (tab-afhængigt) og
  // confirm-strippens "Sign deal", som kun renderes på Next season-fanen.
  const primaries = src.match(/variant="primary"/g) || [];
  assert.equal(primaries.length, 1, "kun Sign deal må være hardkodet primary");
  const nextPanel = src.slice(src.indexOf('<TabPanel value="next">'));
  assert.ok(nextPanel.includes('variant="primary"'), "Sign deal skal ligge i Next season-fanen");
  assert.ok(nextPanel.includes('t("offers.signDeal")'));
});

test("sidehovedets CTA findes kun når der reelt er åbne tilbud", () => {
  assert.match(src, /const offersOpen = offersState\?\.negotiable === true && offers\.length > 0/);
  assert.match(src, /const headerActions = offersOpen \?/);
});

test("henter begge eksisterende endpoints og accepterer via det eksisterende POST", () => {
  assert.match(src, /\/api\/sponsor\/contract/);
  assert.match(src, /\/api\/sponsor\/offers`/);
  assert.match(src, /\/api\/sponsor\/offers\/accept/);
  // #4348: den kanoniske authHeaders, ikke en 27. håndrullet kopi.
  assert.match(src, /import \{ authHeaders \} from "\.\.\/lib\/supabase"/);
});

test("bruger sponsor-namespace og de rene lib-funktioner (ingen tal i komponenten)", () => {
  assert.match(src, /useTranslation\("sponsor"\)/);
  assert.match(src, /buildSponsorPayments/);
  assert.match(src, /projectRemainingStages/);
  assert.match(src, /projectOffer/);
  assert.match(src, /projectDivisionAdjustment/);
});

test("prissætnings-forklaringen (#2862/#3020/#4376) overlevede modalens død, bag en fold", () => {
  assert.match(src, /<CollapsibleSection/);
  assert.match(src, /offers\.unitDefinition/);
  assert.match(src, /offers\.divisionNote/);
  assert.match(src, /offers\.boardNote/);
  assert.match(src, /offers\.divisionAdjustmentUp/);
  assert.match(src, /offers\.divisionPill/);
});

test("ruten /sponsors findes med I18nReadyGate ns=\"sponsor\"", () => {
  assert.match(app, /<Route path="sponsors" element=\{<I18nReadyGate ns="sponsor"><SponsorsPage \/><\/I18nReadyGate>\}/);
});

test("nav: Sponsors ligger i Klubhus lige efter Bestyrelse, og labelen er oversat", () => {
  const boardIdx = layout.indexOf('to: "/board"');
  const sponsorsIdx = layout.indexOf('to: "/sponsors"');
  assert.ok(boardIdx !== -1 && sponsorsIdx !== -1);
  assert.ok(boardIdx < sponsorsIdx, "/sponsors skal stå efter /board");
  const between = layout.slice(boardIdx, sponsorsIdx);
  assert.ok(!/to: "\/[a-z-]+"/.test(between.slice('to: "/board"'.length)), "intet punkt imellem");
  assert.match(layout.slice(sponsorsIdx, sponsorsIdx + 120), /label: t\("nav\.item\.sponsors"\)/);
});

test("Board ejer ikke længere sponsor-flowet — kun ét stille link", () => {
  assert.doesNotMatch(board, /SponsorOfferModal/);
  assert.doesNotMatch(board, /sponsorState/);
  assert.doesNotMatch(board, /\/api\/sponsor\//);
  assert.match(board, /to="\/sponsors"/);
  assert.match(board, /tSponsor\("page\.title"\)/);
});

test("Finance-panelets sponsornavn linker til /sponsors", () => {
  assert.match(financePanel, /to="\/sponsors"/);
  assert.match(financePanel, /\{contract\.sponsor_name\}/);
});
