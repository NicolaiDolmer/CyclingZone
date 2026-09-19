// #5284 — fairplay-rapporter var usynlige i admin: indbakken viste hverken
// rytter, hold eller pris. Kildekode-struktur-guard (samme mønster som
// RaceSelectionPanel.riderProfile.test.js — repoet kører node --test uden
// DOM-renderer, ingen @testing-library her).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "AdminFeedbackTab.jsx"), "utf8");

test("#5284 'fairplay' har et rigtigt dansk label, ikke det rå kategorinavn", () => {
  assert.match(
    source,
    /fairplay:\s*"Fair play"/,
    "CATEGORY_LABELS skal kende 'fairplay' — ellers falder listen/modal-overskriften tilbage til det rå kolonnenavn",
  );
});

test("#5284 kategori-filteret har en 'Fair play'-option", () => {
  assert.match(
    source,
    /<option value="fairplay">Fair play<\/option>/,
    "uden filter-optionen kan admin ikke isolere fairplay-rapporter i listen",
  );
});

test("#5284 listerækken viser handelslinjen (rytter/A→B/pris) for fairplay-rapporter MED en opløst handel", () => {
  assert.match(
    source,
    /const trade = row\.category === "fairplay" \? row\.trade : null;/,
    "besked-kolonnen skal kun bruge trade for kategorien fairplay",
  );
  assert.match(
    source,
    /trade\s*\?\s*<TradeRowSummary trade=\{trade\}\s*\/>\s*\n\s*:\s*<span className="text-cz-2">\{excerpt\(row\.message\)\}<\/span>/,
    "MED en opløst handel vises TradeRowSummary; UDEN falder rækken tilbage til fritekst-uddraget uændret",
  );
});

test("#5284 TradeRowSummary bruger et stroke-ikon mellem holdene, aldrig en unicode-pil (lint-ui-slop.mjs)", () => {
  const summaryStart = source.indexOf("function TradeRowSummary");
  const summaryEnd = source.indexOf("\nconst STATUS_FILTERS", summaryStart);
  assert.ok(summaryStart > -1 && summaryEnd > summaryStart, "kunne ikke afgrænse TradeRowSummary i kildeteksten");
  const summarySource = source.slice(summaryStart, summaryEnd);
  assert.match(summarySource, /<ChevronRightIcon size=\{12\} className="text-cz-3" aria-hidden="true" \/>/);
  assert.doesNotMatch(summarySource, /[→←↔]/, "unicode-pile er forbudt i UI-tekst — brug et ikon");
});

test("#5284 TradeRowSummary håndterer swap (begge ryttere) og manglende hold/pris uden at kaste", () => {
  assert.match(
    source,
    /const riderLabel = trade\.rider\s*\n\s*\? tradeRiderName\(trade\.rider\)\s*\n\s*: trade\.riders/,
    "swap har ingen entydig 'rytter' — riderLabel skal falde tilbage til begge ryttere fra trade.riders",
  );
  assert.match(
    source,
    /const hasTeams = Boolean\(trade\.team_a\?\.name && trade\.team_b\?\.name\);/,
    "manglende hold (fx trade_missing) må ikke crashe rækken",
  );
});

test("#5284 detalje-modalen viser handelskortet OVER fritekst-boksen for fairplay-rapporter med trade", () => {
  const tradeCardIdx = source.indexOf('item.category === "fairplay" && item.trade && <TradeCard trade={item.trade} />');
  const messageBoxIdx = source.indexOf('<p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-cz-1">{item.message}</p>');
  assert.ok(tradeCardIdx > -1, "TradeCard skal renderes betinget af item.trade");
  assert.ok(messageBoxIdx > -1, "fritekst-boksen skal stadig eksistere");
  assert.ok(tradeCardIdx < messageBoxIdx, "handelskortet skal stå FØR spillerens fritekst i markup-rækkefølgen");
});

test("#5284 detalje-modalen viser en forklarende note når handlen er slettet/annulleret (trade_missing), ikke en tom side", () => {
  assert.match(
    source,
    /item\.category === "fairplay" && !item\.trade && item\.trade_missing/,
  );
  assert.match(source, /Den rapporterede handel findes ikke længere/);
});

test("#5284 fairplay-rapporter UDEN metadata (item.trade === null, trade_missing === false) rammer ingen af de to trade-blokke", () => {
  // Begge betingede blokke kræver enten item.trade eller item.trade_missing.
  // En rapport fra kontaktformularen (metadata: null → trade: null,
  // trade_missing: false) rammer derfor ingen af dem og falder igennem til
  // den almindelige fritekst-boks uændret — det er selve pointen.
  function wouldRenderTradeCard(item) { return Boolean(item.category === "fairplay" && item.trade); }
  function wouldRenderMissingNote(item) { return Boolean(item.category === "fairplay" && !item.trade && item.trade_missing); }
  const noMetadataItem = { category: "fairplay", trade: null, trade_missing: false };
  assert.equal(wouldRenderTradeCard(noMetadataItem), false);
  assert.equal(wouldRenderMissingNote(noMetadataItem), false);

  assert.match(source, /item\.category === "fairplay" && item\.trade && <TradeCard/);
  assert.match(source, /item\.category === "fairplay" && !item\.trade && item\.trade_missing && \(/);
});

test("#5284 TradeCard viser rytter(-e), sælger→køber-hold, pris/kontantjustering, ratio og rapportør med links", () => {
  const cardStart = source.indexOf("function TradeCard");
  const cardEnd = source.indexOf("\nfunction FeedbackDetailModal");
  assert.ok(cardStart > -1 && cardEnd > cardStart, "kunne ikke afgrænse TradeCard i kildeteksten");
  const cardSource = source.slice(cardStart, cardEnd);

  assert.match(cardSource, /<TradeRiderLink rider=\{trade\.rider\} \/>/, "enkelt rytter (auction/transfer)");
  assert.match(cardSource, /<TradeRiderLink rider=\{trade\.riders\.offered\} \/>[\s\S]*<TradeRiderLink rider=\{trade\.riders\.requested\} \/>/, "begge ryttere ved swap");
  assert.match(cardSource, /<TeamLink id=\{trade\.team_a\?\.id\}/, "link til sælger/hold A");
  assert.match(cardSource, /<TeamLink id=\{trade\.team_b\?\.id\}/, "link til køber/hold B");
  assert.match(cardSource, /<ChevronRightIcon size=\{14\} className="text-cz-3" aria-hidden="true" \/>/, "stroke-ikon mellem holdene, ikke en unicode-pil");
  assert.match(cardSource, /trade\.type === "swap" \? "Kontantjustering" : "Pris"/, "swap viser 'Kontantjustering', andre typer 'Pris'");
  assert.match(cardSource, /ratioLabel/, "ratio mod markedsværdi vises når den findes");
  assert.match(cardSource, /Rapporteret af/, "rapportørens hold vises");
  assert.match(cardSource, /<TeamLink id=\{trade\.reporting_team\.id\}/, "rapportørens hold er et link, ikke bare tekst");
});

test("#5284 TradeRiderLink linker til rytterens side og falder tilbage til 'Ukendt rytter' uden et 500", () => {
  assert.match(source, /function TradeRiderLink\(\{ rider \}\) \{\s*\n\s*if \(!rider\) return <span className="text-cz-3">Ukendt rytter<\/span>;/);
  assert.match(source, /<RiderLink id=\{rider\.id\} className="font-semibold text-cz-accent-t hover:underline">/);
});

test("#5284 andre kategorier (fx bug) rører aldrig TradeCard — kun 'fairplay' gør", () => {
  const guardedTradeCard = [...source.matchAll(/<TradeCard trade=/g)];
  assert.equal(guardedTradeCard.length, 1, "TradeCard skal kun forekomme ét sted i markup'en");
  // Selve kaldsstedet skal være guardet af category === "fairplay" (verificeret
  // i testen ovenfor) — ingen anden kategori render'er nogensinde handelskortet.
});
