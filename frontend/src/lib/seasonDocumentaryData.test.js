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
    "documentary.card.signing": "Signing",
    "documentary.card.result": "Result",
    "documentary.card.rival": "Rival",
    "documentary.card.points": "points",
    "documentary.card.finalPoints": "Final points",
  };
  return map[key] || key;
};
const formatNumber = (n) => String(n);

test("buildDocumentaryCardStats: builds up to 4 rows from full facts", () => {
  const facts = {
    signings: [{ riderName: "Rider One", amount: 50000 }],
    biggestResult: { rider_name: "Rider One", race_name: "Tour de Test" },
    rival: { team_name: "Rival FC", gap: 12 },
    myStanding: { total_points: 999 },
  };
  const rows = buildDocumentaryCardStats(facts, formatNumber, t);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].label, "Signing");
  assert.match(rows[0].value, /Rider One/);
  assert.equal(rows[3].label, "Final points");
});

test("buildDocumentaryCardStats: skips missing facts instead of rendering placeholders", () => {
  const facts = { myStanding: { total_points: 100 } };
  const rows = buildDocumentaryCardStats(facts, formatNumber, t);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Final points");
});

test("buildDocumentaryCardStats: empty facts returns empty array, never throws", () => {
  const rows = buildDocumentaryCardStats({}, formatNumber, t);
  assert.deepEqual(rows, []);
  const rowsNull = buildDocumentaryCardStats(null, formatNumber, t);
  assert.deepEqual(rowsNull, []);
});
