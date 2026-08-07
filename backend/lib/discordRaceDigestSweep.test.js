import test from "node:test";
import assert from "node:assert/strict";
import {
  runDiscordRaceDigestSweep,
  DISCORD_DIGEST_HOUR_COPENHAGEN,
  buildDigestItemLine,
  buildDigestDescriptionAndFields,
} from "./discordRaceDigestSweep.js";
import { copenhagenHour } from "./copenhagenTime.js";

// July -> CEST (UTC+2). 18:15 UTC = 20:15 Copenhagen (inside the digest hour);
// 17:15 UTC = 19:15 Copenhagen (outside it, and matches the EMAIL digest's own
// hour — verifying the two channels use DIFFERENT windows).
const IN_WINDOW_NOW = new Date("2026-07-20T18:15:00Z");
const OUT_OF_WINDOW_NOW = new Date("2026-07-20T17:15:00Z");

function makeSupabase({
  raceResultRows = [],
  userRows = [],
  alreadySentUserIds = [],
  digestLogInserts = [],
  digestLogInsertError = null,
} = {}) {
  return {
    digestLogInserts,
    from(table) {
      if (table === "race_results") {
        const eqFilters = [];
        let gteFilter = null;
        let inFilter = null;
        let notNullCol = null;
        const b = {
          select() { return b; },
          gte(col, val) { gteFilter = [col, val]; return b; },
          eq(col, val) { eqFilters.push([col, val]); return b; },
          in(col, values) { inFilter = [col, values]; return b; },
          not(col, op, val) { if (op === "is" && val === null) notNullCol = col; return b; },
          order() { return b; },
          range() {
            let out = [...raceResultRows];
            if (gteFilter) out = out.filter((r) => r.imported_at >= gteFilter[1]);
            if (inFilter) out = out.filter((r) => inFilter[1].includes(r[inFilter[0]]));
            for (const [col, val] of eqFilters) {
              const key = col.includes(".") ? col.split(".")[1] : col;
              out = out.filter((r) =>
                col.startsWith("team.") ? (r.team?.[key] ?? false) === val : (r[key] ?? null) === val
              );
            }
            if (notNullCol) out = out.filter((r) => r[notNullCol] != null);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "users") {
        return {
          select() { return this; },
          in: async (_col, ids) => ({ data: userRows.filter((u) => ids.includes(u.id)), error: null }),
        };
      }
      if (table === "discord_race_digest_log") {
        return {
          select() {
            return {
              eq(_col, _val) {
                return {
                  in: async (_col2, ids) => ({
                    data: ids.filter((id) => alreadySentUserIds.includes(id)).map((id) => ({ user_id: id })),
                    error: null,
                  }),
                };
              },
            };
          },
          insert(row) {
            digestLogInserts.push(row);
            return Promise.resolve({ error: digestLogInsertError });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const row = ({ raceId, raceName, resultType, stageNumber = null, userId, imported_at = "2026-07-20T10:00:00Z", human = {} }) => ({
  race_id: raceId,
  stage_number: stageNumber,
  result_type: resultType,
  rank: 1,
  race: { id: raceId, name: raceName },
  team: { user_id: userId, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, ...human },
  imported_at,
});

test("efter kl. 20 samme dag (deploy-restart catch-up) koerer sweepen stadig", async () => {
  // 2026-08-06: gaten var `!== 20`; deploy-genstarter aad kl. 20-vinduet og
  // hele dagen blev sprunget over. `>=` + dedup-loggen = catch-up uden dobbelt-DM.
  const CATCHUP_NOW = new Date("2026-07-20T19:15:00Z"); // 21:15 Copenhagen
  assert.ok(copenhagenHour(CATCHUP_NOW) > DISCORD_DIGEST_HOUR_COPENHAGEN);
  const supabase = makeSupabase({ raceResultRows: [], userRows: [], alreadySentUserIds: [] });
  const result = await runDiscordRaceDigestSweep({ supabase, now: CATCHUP_NOW });
  assert.notEqual(result.skippedReason, "outside_hour_window");
});

test("outside the digest hour, the sweep does no DB work at all", async () => {
  assert.ok(copenhagenHour(OUT_OF_WINDOW_NOW) < DISCORD_DIGEST_HOUR_COPENHAGEN);
  const supabase = { from() { throw new Error("must not query any table outside the digest hour"); } };
  const result = await runDiscordRaceDigestSweep({ supabase, now: OUT_OF_WINDOW_NOW });
  assert.equal(result.skippedReason, "outside_hour_window");
  assert.equal(result.sent, 0);
});

test("uses a DIFFERENT hour window than the email digest (19:00)", () => {
  assert.notEqual(DISCORD_DIGEST_HOUR_COPENHAGEN, 19);
});

test("sends a single digest DM combining a race_result item", async () => {
  const rows = [row({ raceId: "race-1", raceName: "Vuelta a Castilla", resultType: "gc", userId: "u1" })];
  const supabase = makeSupabase({ raceResultRows: rows, userRows: [{ id: "u1", discord_id: "discord-1", discord_dm_enabled: true }] });
  const sendCalls = [];
  const sendDigestDM = async (args) => { sendCalls.push(args); };
  const fetchRaceNarrative = async ({ race: _race }) => ({ headlineText: "Krogh takes the sprint", ranksByUser: new Map([["u1", [2]]]) });

  const result = await runDiscordRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, sendDigestDM, fetchRaceNarrative });

  assert.deepEqual(result, { candidates: 1, sent: 1, skipped: 0, failed: 0 });
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].userId, "u1");
  assert.equal(sendCalls[0].description, "Krogh takes the sprint. You placed 2nd. https://cyclingzone.org/races/race-1");
  assert.deepEqual(sendCalls[0].fields, [], "single item => no fields, just the description");
  assert.equal(supabase.digestLogInserts.length, 1, "logs the send so a later tick today is capped");
  assert.equal(supabase.digestLogInserts[0].user_id, "u1");
  assert.equal(supabase.digestLogInserts[0].item_count, 1);
});

test("combines MULTIPLE races/stages for the same manager into ONE DM with a field per item (no spam)", async () => {
  const rows = [
    row({ raceId: "race-1", raceName: "Tour du Tyrol", resultType: "stage", stageNumber: 3, userId: "u1" }),
    row({ raceId: "race-1", raceName: "Tour du Tyrol", resultType: "stage", stageNumber: 4, userId: "u1" }),
  ];
  const supabase = makeSupabase({ raceResultRows: rows, userRows: [{ id: "u1", discord_id: "d1", discord_dm_enabled: true }] });
  const sendCalls = [];
  const sendDigestDM = async (args) => { sendCalls.push(args); };
  const fetchStageNarrative = async ({ stageNumber }) => ({
    headlineText: `Stage ${stageNumber} headline`,
    ranksByUser: new Map([["u1", [stageNumber === 3 ? 2 : 5]]]),
  });

  await runDiscordRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, sendDigestDM, fetchStageNarrative });

  assert.equal(sendCalls.length, 1, "ÉN DM uanset antal etaper/løb samme dag");
  assert.equal(sendCalls[0].fields.length, 2);
  assert.match(sendCalls[0].fields[0].value, /Stage 3 headline/);
  assert.match(sendCalls[0].fields[1].value, /Stage 4 headline/);
});

test("dedupes multiple riders on the same team in the same stage into ONE item", async () => {
  const rows = [
    row({ raceId: "race-1", raceName: "Tour du Tyrol", resultType: "stage", stageNumber: 3, userId: "u1" }),
    row({ raceId: "race-1", raceName: "Tour du Tyrol", resultType: "stage", stageNumber: 3, userId: "u1" }),
  ];
  const supabase = makeSupabase({ raceResultRows: rows, userRows: [{ id: "u1", discord_id: "d1", discord_dm_enabled: true }] });
  const sendCalls = [];
  const sendDigestDM = async (args) => { sendCalls.push(args); };

  await runDiscordRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, sendDigestDM, fetchStageNarrative: async () => null });

  assert.equal(sendCalls[0].fields.length, 0, "kun ÉT item => beskrivelse, ingen fields");
});

test("skips managers without a linked Discord id or with discord_dm_enabled=false (opt-out respected)", async () => {
  const rows = [
    row({ raceId: "race-1", raceName: "Race", resultType: "gc", userId: "u-no-discord" }),
    row({ raceId: "race-1", raceName: "Race", resultType: "gc", userId: "u-opted-out" }),
    row({ raceId: "race-1", raceName: "Race", resultType: "gc", userId: "u-eligible" }),
  ];
  const supabase = makeSupabase({
    raceResultRows: rows,
    userRows: [
      { id: "u-no-discord", discord_id: null, discord_dm_enabled: true },
      { id: "u-opted-out", discord_id: "d2", discord_dm_enabled: false },
      { id: "u-eligible", discord_id: "d3", discord_dm_enabled: true },
    ],
  });
  const sendCalls = [];
  const sendDigestDM = async (args) => { sendCalls.push(args); };

  const result = await runDiscordRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, sendDigestDM, fetchRaceNarrative: async () => null });

  assert.deepEqual(sendCalls.map((c) => c.userId), ["u-eligible"]);
  assert.equal(result.skipped, 2);
});

test("MAX 1 DM per manager per day: a manager already logged today is skipped, even with fresh results", async () => {
  const rows = [row({ raceId: "race-2", raceName: "Race Two", resultType: "gc", userId: "u1" })];
  const supabase = makeSupabase({
    raceResultRows: rows,
    userRows: [{ id: "u1", discord_id: "d1", discord_dm_enabled: true }],
    alreadySentUserIds: ["u1"],
  });
  const sendCalls = [];
  const sendDigestDM = async (args) => { sendCalls.push(args); };

  const result = await runDiscordRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, sendDigestDM, fetchRaceNarrative: async () => null });

  assert.equal(sendCalls.length, 0, "allerede logget i dag => ingen ny DM, uanset friske resultater");
  assert.equal(result.skipped, 1);
});

test("narrative fetch failure degrades to a generic (not invented) line, never throws", async () => {
  const rows = [row({ raceId: "race-1", raceName: "Race One", resultType: "gc", userId: "u1" })];
  const supabase = makeSupabase({ raceResultRows: rows, userRows: [{ id: "u1", discord_id: "d1", discord_dm_enabled: true }] });
  const sendCalls = [];
  const sendDigestDM = async (args) => { sendCalls.push(args); };

  const result = await runDiscordRaceDigestSweep({
    supabase, now: IN_WINDOW_NOW, sendDigestDM,
    fetchRaceNarrative: async () => { throw new Error("boom"); },
  });

  assert.equal(result.sent, 1);
  assert.equal(sendCalls[0].description, "Race One: results are in. https://cyclingzone.org/races/race-1");
});

test("a log-insert failure after a successful send does not count as failed", async () => {
  const rows = [row({ raceId: "race-1", raceName: "Race", resultType: "gc", userId: "u1" })];
  const supabase = makeSupabase({
    raceResultRows: rows,
    userRows: [{ id: "u1", discord_id: "d1", discord_dm_enabled: true }],
    digestLogInsertError: new Error("unique violation"),
  });
  const result = await runDiscordRaceDigestSweep({
    supabase, now: IN_WINDOW_NOW, sendDigestDM: async () => {}, fetchRaceNarrative: async () => null,
    captureExceptionFn: () => {},
  });
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
});

test("per-manager send failures are isolated", async () => {
  const rows = [
    row({ raceId: "race-1", raceName: "Race", resultType: "gc", userId: "u1" }),
    row({ raceId: "race-1", raceName: "Race", resultType: "gc", userId: "u2" }),
  ];
  const supabase = makeSupabase({
    raceResultRows: rows,
    userRows: [{ id: "u1", discord_id: "d1", discord_dm_enabled: true }, { id: "u2", discord_id: "d2", discord_dm_enabled: true }],
  });
  const sendDigestDM = async (args) => { if (args.userId === "u1") throw new Error("discord down"); };

  const result = await runDiscordRaceDigestSweep({
    supabase, now: IN_WINDOW_NOW, sendDigestDM, fetchRaceNarrative: async () => null, captureExceptionFn: () => {},
  });

  assert.equal(result.candidates, 2);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
});

// ─── pure helpers ───────────────────────────────────────────────────────────

test("buildDigestItemLine: headline + personal result + link", () => {
  const line = buildDigestItemLine({ headlineText: "Krogh takes the sprint", personalText: "you placed 2nd", raceName: "Race", raceId: "race-1" });
  assert.equal(line, "Krogh takes the sprint. You placed 2nd. https://cyclingzone.org/races/race-1");
});

test("buildDigestItemLine: personal result without a headline (narrative unavailable)", () => {
  const line = buildDigestItemLine({ headlineText: null, personalText: "you placed 2nd", raceName: "Race", stageLabel: " (stage 3)", raceId: "race-1" });
  assert.equal(line, "Race (stage 3). You placed 2nd. https://cyclingzone.org/races/race-1");
});

test("buildDigestItemLine: neither headline nor personal result => honest generic line", () => {
  const line = buildDigestItemLine({ headlineText: null, personalText: null, raceName: "Race", raceId: "race-1" });
  assert.equal(line, "Race: results are in. https://cyclingzone.org/races/race-1");
});

test("buildDigestDescriptionAndFields: empty items", () => {
  assert.deepEqual(buildDigestDescriptionAndFields([]), { description: "", fields: [] });
});

test("buildDigestDescriptionAndFields: single item uses the line as description, no fields", () => {
  const result = buildDigestDescriptionAndFields([{ label: "Race", line: "Race: results are in." }]);
  assert.deepEqual(result, { description: "Race: results are in.", fields: [] });
});

test("buildDigestDescriptionAndFields: multiple items get a generic intro + one field each", () => {
  const result = buildDigestDescriptionAndFields([
    { label: "Race A", line: "Line A" },
    { label: "Race B", line: "Line B" },
  ]);
  assert.equal(result.description, "Your results from today:");
  assert.deepEqual(result.fields, [
    { name: "Race A", value: "Line A", inline: false },
    { name: "Race B", value: "Line B", inline: false },
  ]);
});
