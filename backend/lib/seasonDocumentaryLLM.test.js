// Ingen ægte netværkskald i denne fil — fetchImpl er ALTID injiceret som en
// stub. polishSeasonDocumentary() kaldes aldrig uden en eksplicit `fetchImpl`
// her, så testsuiten rammer aldrig api.anthropic.com.
import test from "node:test";
import assert from "node:assert/strict";
import { polishSeasonDocumentary, isSeasonDocumentaryLlmEnabled, SEASON_DOCUMENTARY_LLM_FLAG_KEY } from "./seasonDocumentaryLLM.js";

const PARAGRAPHS = ["Sentence one.", "Sentence two.", "Sentence three."];

function stubFetch({ ok = true, status = 200, body }) {
  return async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

test("polishSeasonDocumentary returns null immediately when apiKey is missing (no fetch attempted)", async () => {
  let fetchCalled = false;
  const result = await polishSeasonDocumentary({
    paragraphs: PARAGRAPHS,
    lang: "en",
    apiKey: "",
    fetchImpl: async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; },
  });
  assert.equal(result, null);
  assert.equal(fetchCalled, false);
});

test("polishSeasonDocumentary returns null when paragraphs are empty", async () => {
  const result = await polishSeasonDocumentary({ paragraphs: [], lang: "en", apiKey: "sk-test" });
  assert.equal(result, null);
});

test("polishSeasonDocumentary returns joined text blocks on success", async () => {
  const fetchImpl = stubFetch({
    body: { content: [{ type: "text", text: "Polished paragraph one." }], stop_reason: "end_turn" },
  });
  const result = await polishSeasonDocumentary({ paragraphs: PARAGRAPHS, lang: "en", apiKey: "sk-test", fetchImpl });
  assert.equal(result, "Polished paragraph one.");
});

test("polishSeasonDocumentary returns null on stop_reason=refusal (fail-safe to deterministic draft)", async () => {
  const fetchImpl = stubFetch({ body: { content: [], stop_reason: "refusal" } });
  const result = await polishSeasonDocumentary({ paragraphs: PARAGRAPHS, lang: "en", apiKey: "sk-test", fetchImpl });
  assert.equal(result, null);
});

test("polishSeasonDocumentary returns null on non-ok HTTP response, never throws", async () => {
  const fetchImpl = stubFetch({ ok: false, status: 429, body: { error: "rate_limited" } });
  const result = await polishSeasonDocumentary({ paragraphs: PARAGRAPHS, lang: "en", apiKey: "sk-test", fetchImpl });
  assert.equal(result, null);
});

test("polishSeasonDocumentary returns null on network exception, never throws", async () => {
  const fetchImpl = async () => { throw new Error("network down"); };
  const result = await polishSeasonDocumentary({ paragraphs: PARAGRAPHS, lang: "en", apiKey: "sk-test", fetchImpl });
  assert.equal(result, null);
});

test("polishSeasonDocumentary sends thinking disabled and the season-documentary system prompt", async () => {
  let capturedBody = null;
  const fetchImpl = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }) };
  };
  await polishSeasonDocumentary({ paragraphs: PARAGRAPHS, lang: "da", apiKey: "sk-test", fetchImpl });
  assert.equal(capturedBody.model, "claude-sonnet-5");
  assert.deepEqual(capturedBody.thinking, { type: "disabled" });
  assert.match(capturedBody.system, /Danish/);
  assert.match(capturedBody.messages[0].content, /Sentence one\./);
});

test("isSeasonDocumentaryLlmEnabled is fail-safe false when app_config lookup errors", async () => {
  const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) };
  const enabled = await isSeasonDocumentaryLlmEnabled(supabase);
  assert.equal(enabled, false);
});

test("SEASON_DOCUMENTARY_LLM_FLAG_KEY matches the app_config key used in the SQL migration", () => {
  assert.equal(SEASON_DOCUMENTARY_LLM_FLAG_KEY, "season_documentary_llm_enabled");
});
