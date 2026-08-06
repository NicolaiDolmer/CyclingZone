import test from "node:test";
import assert from "node:assert/strict";
import { buildSeasonDocumentary, buildSeasonDocumentaryParagraphs, __internal } from "./seasonDocumentaryGrammar.js";

const FULL_FACTS = {
  signings: [
    { amount: 452739, riderName: "Jack Holland", source: "auction" },
    { amount: 404612, riderName: "Yassine Benali", source: "auction" },
  ],
  biggestResult: {
    rider_name: "Yassine Benali",
    race_name: "Tour du Golfe",
    result_type: "gc",
    stage_number: 5,
  },
  bestRaceDay: { race_name: "Tour Arctique", total_points: 920, riders_scoring: 6 },
  rival: { team_name: "L'Échappée du Soleil", total_points: 16629, gap: 18, rank_in_division: 1 },
  myStanding: { division: 3, rank_in_division: 1, total_points: 16647, races_completed: 46, stage_wins: 10, gc_wins: 20 },
};

const CTX = { teamId: "8073fb4a-aee0-4d87-a90d-9472bd72c9fc", teamName: "Équipe Lorraine Acier", seasonNumber: 1 };

test("buildSeasonDocumentary is a pure function — same input, same output (idempotent regen)", () => {
  const a = buildSeasonDocumentary(FULL_FACTS, CTX);
  const b = buildSeasonDocumentary(FULL_FACTS, CTX);
  assert.deepEqual(a, b);
});

test("produces both languages, 5 non-empty paragraphs each", () => {
  const doc = buildSeasonDocumentary(FULL_FACTS, CTX);
  for (const lang of ["en", "da"]) {
    assert.equal(doc[lang].length, 5);
    for (const p of doc[lang]) {
      assert.equal(typeof p, "string");
      assert.ok(p.length > 0);
    }
  }
});

test("every stated fact traces back to the facts object (hallucination guard, coarse)", () => {
  const doc = buildSeasonDocumentaryParagraphs(FULL_FACTS, CTX, "en");
  const joined = doc.join(" ");
  assert.ok(joined.includes("Yassine Benali"));
  assert.ok(joined.includes("Tour du Golfe"));
  assert.ok(joined.includes("Tour Arctique"));
  assert.ok(joined.includes("L'Échappée du Soleil") || joined.includes("L’Échappée du Soleil"));
});

test("signing that also delivered the biggest result gets the payoff callback", () => {
  const doc = buildSeasonDocumentaryParagraphs(FULL_FACTS, CTX, "en");
  assert.match(doc[2], /paid off/i);
});

test("all fields empty/null still renders 5 non-empty fallback paragraphs (v1 must always work alone)", () => {
  const emptyFacts = { signings: [], biggestResult: null, bestRaceDay: null, rival: null, myStanding: null };
  for (const lang of ["en", "da"]) {
    const doc = buildSeasonDocumentaryParagraphs(emptyFacts, CTX, lang);
    assert.equal(doc.length, 5);
    for (const p of doc) assert.ok(p.length > 0);
  }
});

test("same team+season always picks the same phrasing variant (deterministic, not random)", () => {
  const doc1 = buildSeasonDocumentaryParagraphs(FULL_FACTS, CTX, "en");
  const doc2 = buildSeasonDocumentaryParagraphs(FULL_FACTS, CTX, "en");
  assert.deepEqual(doc1, doc2);
});

test("teams commonly get different phrasing variants across the population (texture, not a single hardcoded template)", () => {
  const docA = buildSeasonDocumentaryParagraphs(FULL_FACTS, CTX, "en");
  // Sample several arbitrary team_ids — with 5 independent 2-way coin-flip
  // sections, SOME of these should land on a different combination than CTX
  // (a single fixed pair can coincidentally match on all 5, see #3402 fix-up).
  const sampleIds = Array.from({ length: 12 }, (_, i) => `00000000-0000-0000-0000-00000000${String(i).padStart(4, "0")}`);
  const anyDifferent = sampleIds.some((teamId) => {
    const doc = buildSeasonDocumentaryParagraphs(FULL_FACTS, { ...CTX, teamId }, "en");
    return JSON.stringify(doc) !== JSON.stringify(docA);
  });
  assert.ok(anyDifferent, "expected at least one sampled team_id to produce different phrasing than CTX");
});

test("formatAmount/formatNumber use locale-appropriate thousands separators", () => {
  assert.equal(__internal.formatAmount(452739, "en"), "452,739 CZ$");
  assert.equal(__internal.formatAmount(452739, "da"), "452.739 CZ$");
  assert.equal(__internal.formatNumber(16647, "en"), "16,647");
  assert.equal(__internal.formatNumber(16647, "da"), "16.647");
});

test("ordinal formats EN as 1st/2nd/3rd and DA as 1./2./3.", () => {
  assert.equal(__internal.ordinal(1, "en"), "1st");
  assert.equal(__internal.ordinal(2, "en"), "2nd");
  assert.equal(__internal.ordinal(3, "en"), "3rd");
  assert.equal(__internal.ordinal(11, "en"), "11th");
  assert.equal(__internal.ordinal(1, "da"), "1.");
});

test("no-signings team gets the fallback signings sentence, not an undefined-name sentence", () => {
  const noSignings = { ...FULL_FACTS, signings: [] };
  const doc = buildSeasonDocumentaryParagraphs(noSignings, CTX, "en");
  assert.match(doc[1], /No marquee signings/i);
  assert.ok(!doc[1].includes("undefined"));
});
