import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #5184 — sæsonopsamlingens tomme tilstand (standings.length === 0) rendrede
// EmptyState UDEN en action-prop. EmptyState.jsx (#4625, TASTE fork 4) logger
// "EmptyState kraever en action-prop" i DEV netop for at fange dette: en tom
// tilstand uden vej videre er et fund, ikke en variant
// (docs/design/PAGE_TEMPLATES.md#canonical-states).
//
// node --test uden DOM → kildekode-strukturel guard, samme mønster som
// SeasonEndPage.allDivisions.test.js og SeasonEndPage.recapAggregate.test.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dirname, "SeasonEndPage.jsx"), "utf8");
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

function extractEmptyStateBlock(source) {
  const start = source.indexOf("standings.length === 0");
  assert.ok(start !== -1, "standings.length === 0-grenen skal stadig findes");
  const emptyStateStart = source.indexOf("<EmptyState", start);
  assert.ok(emptyStateStart !== -1, "EmptyState skal renderes i standings.length === 0-grenen");
  // EmptyState er selvlukkende her (action={...} som sidste prop) — find den
  // matchende afsluttende "/>" på samme indrykningsniveau ved simpelt at tage
  // et rundhåndet udsnit og lade regex-assertions nedenfor gøre resten af arbejdet.
  return source.slice(emptyStateStart, emptyStateStart + 800);
}

const emptyStateBlock = extractEmptyStateBlock(code);

test("#5184 EmptyState i den tomme saesonopsamling faar en action-prop", () => {
  assert.match(
    emptyStateBlock,
    /action=\{/,
    "EmptyState uden action logger 'EmptyState kraever en action-prop' i DEV og bryder canonical-states-kontrakten",
  );
});

test("#5184 handlingen er ÉN gold primary-knap (buttonClass variant: primary, size: sm), ikke en ekstra sekundær knap", () => {
  assert.match(
    emptyStateBlock,
    /buttonClass\(\{\s*variant:\s*"primary",\s*size:\s*"sm"\s*\}\)/,
    "canonical-states kræver at empty-state-handlingen er sektionens primary, size sm — samme mønster som MessagesPanel.jsx",
  );
});

test("#5184 handlingen er et <Link> (routing), ikke en knap inde i et link eller omvendt", () => {
  assert.match(
    emptyStateBlock,
    /<Link\s+to="\/planning\?tab=calendar"/,
    "spilleren skal sendes til kalenderen for at følge sæsonens løb — den mest naturlige næste handling når der endnu ikke er resultater",
  );
});

test("#5184 titel og beskrivelse bruger stadig de eksisterende empty.title/empty.body-nøgler", () => {
  assert.match(emptyStateBlock, /t\("empty\.title"\)/);
  assert.match(emptyStateBlock, /t\("empty\.body"\)/);
  assert.match(emptyStateBlock, /t\("empty\.cta"\)/, "CTA-teksten skal komme fra en ny empty.cta-nøgle (locales), ikke hardcodet streng");
});

// ── Locale-paritet: EN først, DA under (docs/TONE_OF_VOICE.md) ──

function loadLocale(lang) {
  const p = join(__dirname, "..", "..", "public", "locales", lang, "seasonEnd.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

test("#5184 empty.cta findes i BÅDE en/seasonEnd.json og da/seasonEnd.json", () => {
  const en = loadLocale("en");
  const da = loadLocale("da");
  assert.equal(typeof en.empty?.cta, "string", "en/seasonEnd.json mangler empty.cta");
  assert.ok(en.empty.cta.length > 0);
  assert.equal(typeof da.empty?.cta, "string", "da/seasonEnd.json mangler empty.cta");
  assert.ok(da.empty.cta.length > 0);
});
