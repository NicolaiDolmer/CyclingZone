// Tests for i18n leak-guard heuristikker + baseline-ratchet — Refs #1068.
// Kør: node --test scripts/i18n-check-leaks.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DANISH_CHARS,
  DANISH_STOPWORDS,
  isNaturalLanguage,
  stripComments,
  countDanishLines,
  countBackendDanishLines,
  compareAgainstBaseline,
} from "./i18n-check-leaks.mjs";

test("DANISH_STOPWORDS flagger utvetydigt danske ord", () => {
  assert.ok(DANISH_STOPWORDS.test("Du har ikke nok penge"));
  assert.ok(DANISH_STOPWORDS.test("Vis din profil"));
  assert.ok(DANISH_STOPWORDS.test("Slet rytter"));
  assert.ok(DANISH_STOPWORDS.test("Noget gik galt, gentag handlingen"));
});

test("DANISH_STOPWORDS rammer IKKE engelske homografer/almindelig engelsk", () => {
  assert.equal(DANISH_STOPWORDS.test("Hold to confirm your bid"), false);
  assert.equal(DANISH_STOPWORDS.test("Add a tag to this rider"), false);
  assert.equal(DANISH_STOPWORDS.test("Sign in to continue"), false);
  assert.equal(DANISH_STOPWORDS.test("Your team is ready for the race"), false);
  // "dines" må ikke matche \bdine\b, "ogre" må ikke matche \bog\b
  assert.equal(DANISH_STOPWORDS.test("The ogre dines at noon"), false);
});

test("isNaturalLanguage: >1 ord = natursprog; ICU-vars/symboler er ikke", () => {
  assert.ok(isNaturalLanguage("Send request"));
  assert.ok(isNaturalLanguage("Tour de France"));
  assert.equal(isNaturalLanguage("Sprint"), false);
  assert.equal(isNaturalLanguage("{{amount}} CZ$"), false);
  // Edge: "Min. {amount} CZ$" tæller "Min" + "CZ" som 2 ord → advisory.
  // Bevidst accepteret over-inklusion — advisory-kanalen fejler aldrig.
  assert.equal(isNaturalLanguage("Min. {amount} CZ$"), true);
});

test("countDanishLines: fanger JSX-tekstnoder OG literals, ignorerer kommentarer", () => {
  const src = `
// Kommentar med æøå skal ignoreres
/* også æøå i blok-kommentar */
const a = "Tæt på minimum";
export function C() {
  return <p>Prøver igen om 30 sekunder</p>;
}
const en = "All English here";
`;
  assert.equal(countDanishLines(src), 2);
});

test("countBackendDanishLines: kun error/message/json/throw-kontekst tæller", () => {
  const src = `
console.log("intern dansk log uden kontekst — tælles ikke her: ærgerligt");
return res.status(400).json({ error: "Du har ikke råd til dette bud" });
throw new Error("Sæsonen er allerede afsluttet");
const label = "købsdato"; // dansk literal uden API-kontekst
`;
  // console.log-linjen: ingen kontekst-match ("message"/"error"/.json(/throw) → 0
  // res...json-linjen: 1, throw-linjen: 1
  assert.equal(countBackendDanishLines(src), 2);
});

test("ratchet: nye leaks fejler, fixede leaks er kun stale-info", () => {
  const findings = {
    locale: {
      leaks: [{ id: "team.json::new.key", kind: "æ/ø/å", value: "Køb rytter" }],
      advisories: [],
    },
    frontend: { "frontend/src/pages/NewPage.jsx": 2 },
    backend: { "backend/routes/api.js": 100 },
  };
  const baseline = {
    locale: ["races.json::old.fixed.key"],
    frontend: {},
    backend: { "backend/routes/api.js": 112 },
  };
  const { newLeaks, stale } = compareAgainstBaseline(findings, baseline);
  // Nye: locale-nøglen + den nye frontend-fil. api.js er UNDER baseline → ikke ny.
  assert.equal(newLeaks.length, 2);
  assert.ok(newLeaks.some((l) => l.includes("team.json::new.key")));
  assert.ok(newLeaks.some((l) => l.includes("NewPage.jsx")));
  // Stale: den fixede locale-nøgle + api.js der er skrumpet.
  assert.equal(stale.length, 2);
});

test("ratchet: count-stigning i baselinet fil fejler med delta", () => {
  const findings = {
    locale: { leaks: [], advisories: [] },
    frontend: { "frontend/src/pages/DeadlineDayBoard.jsx": 9 },
    backend: {},
  };
  const baseline = { locale: [], frontend: { "frontend/src/pages/DeadlineDayBoard.jsx": 7 }, backend: {} };
  const { newLeaks, stale } = compareAgainstBaseline(findings, baseline);
  assert.equal(newLeaks.length, 1);
  assert.ok(newLeaks[0].includes("+2"));
  assert.equal(stale.length, 0);
});

test("uændret tilstand = hverken nye eller stale", () => {
  const findings = {
    locale: { leaks: [], advisories: [] },
    frontend: { "frontend/src/pages/SeasonPreviewPage.jsx": 3 },
    backend: {},
  };
  const baseline = { locale: [], frontend: { "frontend/src/pages/SeasonPreviewPage.jsx": 3 }, backend: {} };
  const { newLeaks, stale } = compareAgainstBaseline(findings, baseline);
  assert.equal(newLeaks.length, 0);
  assert.equal(stale.length, 0);
});

test("DANISH_CHARS sanity", () => {
  assert.ok(DANISH_CHARS.test("Sæson"));
  assert.equal(DANISH_CHARS.test("Season"), false);
});

test("stripComments bevarer URL'er (:// er ikke en kommentar)", () => {
  const src = 'const url = "https://example.com/æøå";';
  assert.ok(stripComments(src).includes("https://example.com"));
});
