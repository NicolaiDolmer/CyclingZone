// #7643: sandhedsvagtens runner med en falsk PostgREST, GitHub og Discord.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildDiscordPayload,
  buildIssueComment,
  main,
  pruneState,
  run,
  stageKey,
} from "./race-truth-guard.mjs";
import { checkStage } from "./lib/race-truth-rules.mjs";
import { loadFixture, stageInput } from "./__fixtures__/race-truth/load.mjs";

const RACE = "00000000-0000-4000-8000-000000000008";
const CREATED = "2026-11-04T12:00:00.000Z";
const NOW = new Date("2026-11-04T13:00:00.000Z");

function tmpState() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "race-truth-")), "state.json");
}

function rowsOf(table) {
  return table.rows.map((row) => Object.fromEntries(table.columns.map((c, i) => [c, row[i]])));
}

/** Falsk fetch: PostgREST-tabeller fra en fixture + optagelse af POST'er. */
function fakeFetch(fixtureName, { failTable = null, postOk = true } = {}) {
  const data = loadFixture(fixtureName);
  const tables = {
    race_stage_timelines: [{ race_id: RACE, stage_number: data.stage_number, timeline_version: data.timeline_version, created_at: CREATED, events: data.events }],
    race_results: rowsOf(data.results),
    race_stage_passages: rowsOf(data.passages),
    race_stage_moments: data.moments,
    race_incidents: data.incidents ?? [],
  };
  const posts = [];
  const gets = [];
  const fetchFn = async (url, init = {}) => {
    if (init.method === "POST") {
      posts.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return { ok: postOk, json: async () => ({}) };
    }
    gets.push({ url, headers: init.headers });
    const table = new URL(url).pathname.split("/").pop();
    if (table === failTable) return { ok: false, status: 503, json: async () => ({}) };
    const range = /^(\d+)-(\d+)$/.exec(init.headers?.Range ?? "0-999");
    const rows = tables[table] ?? [];
    return { ok: true, json: async () => rows.slice(Number(range[1]), Number(range[2]) + 1) };
  };
  return { fetchFn, posts, gets };
}

const ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "service-key-for-tests",
  GITHUB_TOKEN: "gh-token-for-tests",
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_RUN_ID: "42",
  RACE_TRUTH_TRACKING_ISSUE: "9999",
  DISCORD_OPS_WEBHOOK_URL: "https://discord.example/webhook",
};

test("etape 8: én issue-kommentar og én #ops-besked; kun GET mod databasen", async () => {
  const { fetchFn, posts, gets } = fakeFetch("giro-stage-8.json");
  const result = await run({ env: { ...ENV, RACE_TRUTH_STATE: tmpState() }, fetchFn, now: () => NOW, log: () => {}, warn: () => {} });
  assert.equal(result.checked, 1);
  assert.ok(result.findings.length > 0);
  assert.equal(posts.length, 2);
  const comment = posts.find((p) => p.url.includes("/issues/9999/comments"));
  const discord = posts.find((p) => p.url === ENV.DISCORD_OPS_WEBHOOK_URL);
  assert.ok(comment && discord);
  assert.ok(gets.every((g) => g.url.startsWith("https://example.supabase.co/rest/v1/")));
  // Offentlig kommentar: race-id og regler, ingen rytter-id'er eller tider.
  assert.match(comment.body.body, /R1/);
  assert.doesNotMatch(comment.body.body, /rider-\d{3}/);
  assert.doesNotMatch(comment.body.body, /\d+:\d{2}/);
  assert.doesNotMatch(JSON.stringify(discord.body), /rider-\d{3}/);
});

test("en ren etape giver ingen kommentar og ingen besked", async () => {
  const { fetchFn, posts } = fakeFetch("giro-stage-2-clean.json");
  const result = await run({ env: { ...ENV, RACE_TRUTH_STATE: tmpState() }, fetchFn, now: () => NOW, log: () => {}, warn: () => {} });
  assert.equal(result.checked, 1);
  assert.deepEqual(result.findings, []);
  assert.equal(posts.length, 0);
});

test("en etape tjekkes kun én gang (tilstand i cache-filen)", async () => {
  const state = tmpState();
  const first = fakeFetch("giro-stage-8.json");
  await run({ env: { ...ENV, RACE_TRUTH_STATE: state }, fetchFn: first.fetchFn, now: () => NOW, log: () => {}, warn: () => {} });
  const second = fakeFetch("giro-stage-8.json");
  const again = await run({ env: { ...ENV, RACE_TRUTH_STATE: state }, fetchFn: second.fetchFn, now: () => NOW, log: () => {}, warn: () => {} });
  assert.equal(again.checked, 0);
  assert.equal(second.posts.length, 0);
});

test("når hverken kommentar eller besked når frem, meldes etapen igen næste kørsel", async () => {
  const state = tmpState();
  const down = fakeFetch("giro-stage-8.json", { postOk: false });
  const first = await run({ env: { ...ENV, RACE_TRUTH_STATE: state }, fetchFn: down.fetchFn, now: () => NOW, log: () => {}, warn: () => {} });
  assert.equal(first.reported, false);
  assert.equal(down.posts.length, 2);
  const up = fakeFetch("giro-stage-8.json");
  const second = await run({ env: { ...ENV, RACE_TRUTH_STATE: state }, fetchFn: up.fetchFn, now: () => NOW, log: () => {}, warn: () => {} });
  assert.equal(second.checked, 1);
  assert.equal(up.posts.length, 2);
});

test("dry-run skriver hverken kommentar, besked eller tilstand", async () => {
  const state = tmpState();
  const { fetchFn, posts } = fakeFetch("giro-stage-8.json");
  await run({ env: { ...ENV, RACE_TRUTH_STATE: state, RACE_TRUTH_DRY_RUN: "1" }, fetchFn, now: () => NOW, log: () => {}, warn: () => {} });
  assert.equal(posts.length, 0);
  assert.equal(fs.existsSync(state), false);
});

test("fail-soft: manglende secrets, læsefejl og en kastende fetch giver altid exit 0", async () => {
  const warnings = [];
  assert.equal(await main({ env: {}, fetchFn: async () => { throw new Error("nope"); }, log: () => {}, warn: (m) => warnings.push(m) }), 0);
  assert.ok(warnings.some((m) => m.includes("SUPABASE_URL")));
  const thrower = async () => { throw new TypeError("network down"); };
  assert.equal(await main({ env: { ...ENV, RACE_TRUTH_STATE: tmpState() }, fetchFn: thrower, log: () => {}, warn: () => {} }), 0);
  const failing = fakeFetch("giro-stage-8.json", { failTable: "race_results" });
  const state = tmpState();
  const result = await run({ env: { ...ENV, RACE_TRUTH_STATE: state }, fetchFn: failing.fetchFn, now: () => NOW, log: () => {}, warn: () => {} });
  assert.deepEqual(result.findings.map((f) => f.code), ["load_error"]);
  // Ikke markeret som tjekket: næste kørsel prøver igen.
  assert.deepEqual(JSON.parse(fs.readFileSync(state, "utf8")).checked, {});
});

test("uden tracking-issue: ingen kommentar, men stadig #ops", async () => {
  const { fetchFn, posts } = fakeFetch("giro-stage-8.json");
  const env = { ...ENV, RACE_TRUTH_STATE: tmpState() };
  delete env.RACE_TRUTH_TRACKING_ISSUE;
  const warnings = [];
  await run({ env, fetchFn, now: () => NOW, log: () => {}, warn: (m) => warnings.push(m) });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, ENV.DISCORD_OPS_WEBHOOK_URL);
  assert.ok(warnings.some((m) => m.includes("RACE_TRUTH_TRACKING_ISSUE")));
});

test("buildIssueComment og buildDiscordPayload holder sig til regel, kode og sted", () => {
  const findings = checkStage({ ...stageInput("giro-stage-6.json"), raceId: RACE });
  const comment = buildIssueComment(findings, { runUrl: "https://example/run", checkedStages: 1 });
  assert.match(comment, /Race `00000000` etape 6: /);
  assert.match(comment, /ghost_group_after_abandon/);
  assert.doesNotMatch(comment, /rider-\d{3}/);
  const payload = buildDiscordPayload(findings, { runUrl: "https://example/run" });
  assert.ok(payload.embeds[0].description.length <= 4096);
  assert.match(payload.embeds[0].description, /R2×1/);
});

test("pruneState glemmer etaper ældre end en uge", () => {
  const state = { checked: { old: "2026-10-01T00:00:00.000Z", fresh: "2026-11-04T00:00:00.000Z" } };
  assert.deepEqual(Object.keys(pruneState(state, NOW.toISOString()).checked), ["fresh"]);
  assert.equal(stageKey({ race_id: "r", stage_number: 2, created_at: "t" }), "r:2:t");
});
