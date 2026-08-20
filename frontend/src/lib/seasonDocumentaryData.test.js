import { test } from "node:test";
import assert from "node:assert/strict";
import { isMissingTableError, pickDocumentaryText, buildDocumentaryCardStats } from "./seasonDocumentaryData.js";

// ─── isMissingTableError ────────────────────────────────────────────────────

test("isMissingTableError: PGRST205 code is a missing-table error", () => {
  assert.equal(isMissingTableError({ code: "PGRST205", message: "x" }), true);
});

test("isMissingTableError: 42P01 code is a missing-table error", () => {
  assert.equal(isMissingTableError({ code: "42P01", message: "x" }), true);
});

test("isMissingTableError: message fallback matches 'could not find the table'", () => {
  assert.equal(isMissingTableError({ message: "Could not find the table 'season_documentaries' in the schema cache" }), true);
});

test("isMissingTableError: unrelated error is false", () => {
  assert.equal(isMissingTableError({ code: "42501", message: "permission denied" }), false);
});

test("isMissingTableError: null/undefined is false", () => {
  assert.equal(isMissingTableError(null), false);
  assert.equal(isMissingTableError(undefined), false);
});

// ─── pickDocumentaryText ─────────────────────────────────────────────────────

test("pickDocumentaryText: null row returns null", () => {
  assert.equal(pickDocumentaryText(null, "en"), null);
});

test("pickDocumentaryText: prefers LLM text when present for the requested language", () => {
  const row = {
    llm_en: "Paragraph one.\n\nParagraph two.",
    llm_da: null,
    deterministic_en: ["fallback en"],
    deterministic_da: ["fallback da"],
  };
  const result = pickDocumentaryText(row, "en");
  assert.deepEqual(result, { paragraphs: ["Paragraph one.", "Paragraph two."], source: "llm" });
});

test("pickDocumentaryText: falls back to deterministic per-language when LLM text is missing for that language", () => {
  const row = {
    llm_en: "English polished text.",
    llm_da: null,
    deterministic_en: ["fallback en"],
    deterministic_da: ["fallback da 1", "fallback da 2"],
  };
  const result = pickDocumentaryText(row, "da");
  assert.deepEqual(result, { paragraphs: ["fallback da 1", "fallback da 2"], source: "deterministic" });
});

test("pickDocumentaryText: falls back to deterministic when llm_* is an empty string", () => {
  const row = { llm_en: "   ", deterministic_en: ["a", "b"] };
  const result = pickDocumentaryText(row, "en");
  assert.deepEqual(result, { paragraphs: ["a", "b"], source: "deterministic" });
});

test("pickDocumentaryText: row with no deterministic data returns empty paragraphs array, not a crash", () => {
  const result = pickDocumentaryText({}, "en");
  assert.deepEqual(result, { paragraphs: [], source: "deterministic" });
});

// ─── buildDocumentaryCardStats ───────────────────────────────────────────────

const t = (key) => {
  const map = {
    "documentary.card.turningPoint": "Turning point",
    "documentary.card.result": "Biggest result",
    "documentary.card.rival": "Closest rival",
    "documentary.card.pts": "pts",
    "documentary.card.finalPoints": "Final points",
  };
  return map[key] || key;
};
const formatNumber = (n) => String(n);

test("buildDocumentaryCardStats: builds exactly 4 rows in the fixed order (turning point, biggest result, closest rival, final points)", () => {
  const facts = {
    bestRaceDay: { race_id: "r1", race_name: "Tour de Test", total_points: 482, riders_scoring: 3 },
    biggestResult: { rider_name: "Rider One", race_name: "Tour de Test" },
    rival: { team_name: "Rival FC", total_points: 900, gap: 12 },
    myStanding: { total_points: 999 },
  };
  const rows = buildDocumentaryCardStats(facts, null, formatNumber, t);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].label, "Turning point");
  assert.equal(rows[0].value, "482 pts · Tour de Test");
  assert.equal(rows[1].label, "Biggest result");
  assert.match(rows[1].value, /Rider One/);
  assert.equal(rows[2].label, "Closest rival");
  assert.equal(rows[3].label, "Final points");
  assert.equal(rows[3].value, "999");
});

test("buildDocumentaryCardStats: turning point value prefers a formatted date over the race name when given", () => {
  const facts = { bestRaceDay: { race_id: "r1", race_name: "Tour de Test", total_points: 200, riders_scoring: 2 } };
  const rows = buildDocumentaryCardStats(facts, null, formatNumber, t, { turningPointDateLabel: "12 Aug" });
  assert.equal(rows[0].value, "200 pts · 12 Aug");
});

test("buildDocumentaryCardStats: closest rival sign reflects whether I'm ahead or behind", () => {
  const aheadFacts = { rival: { team_name: "Rival FC", total_points: 500, gap: 40 }, myStanding: { total_points: 540 } };
  const aheadRows = buildDocumentaryCardStats(aheadFacts, null, formatNumber, t);
  assert.match(aheadRows.find((r) => r.label === "Closest rival").value, /\+40$/);

  const behindFacts = { rival: { team_name: "Rival FC", total_points: 700, gap: 40 }, myStanding: { total_points: 660 } };
  const behindRows = buildDocumentaryCardStats(behindFacts, null, formatNumber, t);
  assert.match(behindRows.find((r) => r.label === "Closest rival").value, /-40$/);
});

test("buildDocumentaryCardStats: final points falls back to standingsRow when facts.myStanding is missing", () => {
  const rows = buildDocumentaryCardStats({}, { total_points: 321 }, formatNumber, t);
  assert.deepEqual(rows, [{ label: "Final points", value: "321" }]);
});

test("buildDocumentaryCardStats: skips missing facts instead of rendering placeholders", () => {
  const facts = { myStanding: { total_points: 100 } };
  const rows = buildDocumentaryCardStats(facts, null, formatNumber, t);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Final points");
});

test("buildDocumentaryCardStats: empty facts and no standingsRow returns empty array, never throws", () => {
  const rows = buildDocumentaryCardStats({}, null, formatNumber, t);
  assert.deepEqual(rows, []);
  const rowsNull = buildDocumentaryCardStats(null, null, formatNumber, t);
  assert.deepEqual(rowsNull, []);
});
