// #7508 — selection_warning markeres laest naar holdet er udtaget.
// Helperen (mock-supabase) + begge kaldesteder: assistentens vej
// (notifyAssistantFilledSquad) og managerens PUT /races/:raceId/selection
// (api.js kan ikke koeres uden live Supabase -> kildetekst-scan, samme moenster
// som routes/raceWithdrawalCalendarCache.routes.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveSelectionWarnings,
  resolveSelectionWarningsForTeam,
  SELECTION_WARNING_NOTIFICATION_TYPE,
} from "./selectionWarningResolve.ts";
import { notifyAssistantFilledSquad } from "./assistantFilledSquadNotification.js";

// Opfoerer sig som supabase-js: kaedebar builder, thenable ved update(), single
// opslag via maybeSingle() paa teams.
function makeSupabase({ updateError = null, throwOnUpdate = false, teamRow = { user_id: "u1" }, teamError = null } = {}) {
  const log = { updates: [], filters: [], teamLookups: [] };
  const supabase = {
    from(table) {
      const state = { table, filters: [], patch: null, select: null };
      const builder = {
        update(patch) { state.patch = patch; return builder; },
        select(cols) { state.select = cols; return builder; },
        eq(col, val) { state.filters.push([col, val]); return builder; },
        async maybeSingle() {
          log.teamLookups.push({ table, filters: state.filters });
          return { data: teamRow, error: teamError };
        },
        then(resolveFn, rejectFn) {
          if (throwOnUpdate) return Promise.reject(new Error("boom")).then(resolveFn, rejectFn);
          log.updates.push({ table, patch: state.patch, filters: state.filters });
          return Promise.resolve({ error: updateError }).then(resolveFn, rejectFn);
        },
      };
      return builder;
    },
  };
  return { supabase, log };
}

test("resolveSelectionWarnings: sætter is_read=true KUN paa ulaeste selection_warning for (bruger, loeb)", async () => {
  const { supabase, log } = makeSupabase();
  const res = await resolveSelectionWarnings({ supabase, userId: "u1", raceId: "r1" });
  assert.equal(res.ok, true);
  assert.equal(log.updates.length, 1);
  const [u] = log.updates;
  assert.equal(u.table, "notifications");
  assert.deepEqual(u.patch, { is_read: true });
  assert.deepEqual(u.filters, [
    ["type", SELECTION_WARNING_NOTIFICATION_TYPE],
    ["user_id", "u1"],
    ["related_id", "r1"],
    ["is_read", false],
  ]);
  assert.equal(SELECTION_WARNING_NOTIFICATION_TYPE, "selection_warning");
});

test("resolveSelectionWarnings: manglende bruger eller loeb -> intet kald", async () => {
  const { supabase, log } = makeSupabase();
  assert.equal((await resolveSelectionWarnings({ supabase, userId: null, raceId: "r1" })).reason, "missing_target");
  assert.equal((await resolveSelectionWarnings({ supabase, userId: "u1", raceId: undefined })).reason, "missing_target");
  assert.deepEqual(log.updates, []);
});

test("resolveSelectionWarnings: kaster ALDRIG - hverken ved DB-fejl eller exception", async () => {
  const failing = makeSupabase({ updateError: { message: "db down" } });
  const r1 = await resolveSelectionWarnings({ supabase: failing.supabase, userId: "u1", raceId: "r1" });
  assert.deepEqual(r1, { ok: false, reason: "update_failed" });
  const throwing = makeSupabase({ throwOnUpdate: true });
  const r2 = await resolveSelectionWarnings({ supabase: throwing.supabase, userId: "u1", raceId: "r1" });
  assert.deepEqual(r2, { ok: false, reason: "exception" });
  const r3 = await resolveSelectionWarnings({ supabase: "ikke-en-klient", userId: "u1", raceId: "r1" });
  assert.equal(r3.ok, false);
});

test("resolveSelectionWarningsForTeam: slaar ejeren op og markerer deres advarsel laest", async () => {
  const { supabase, log } = makeSupabase({ teamRow: { user_id: "owner-9" } });
  const res = await resolveSelectionWarningsForTeam({ supabase, teamId: "t1", raceId: "r7" });
  assert.equal(res.ok, true);
  assert.deepEqual(log.teamLookups[0].filters, [["id", "t1"]]);
  assert.equal(log.updates.length, 1);
  assert.deepEqual(log.updates[0].filters, [
    ["type", "selection_warning"], ["user_id", "owner-9"], ["related_id", "r7"], ["is_read", false],
  ]);
});

test("resolveSelectionWarningsForTeam: hold uden bruger (AI/bank) -> ingen opdatering; opslagsfejl kaster ikke", async () => {
  const noOwner = makeSupabase({ teamRow: { user_id: null } });
  assert.equal((await resolveSelectionWarningsForTeam({ supabase: noOwner.supabase, teamId: "t1", raceId: "r1" })).reason, "no_owner");
  assert.deepEqual(noOwner.log.updates, []);
  const lookupFail = makeSupabase({ teamRow: null, teamError: { message: "nope" } });
  assert.equal((await resolveSelectionWarningsForTeam({ supabase: lookupFail.supabase, teamId: "t1", raceId: "r1" })).reason, "lookup_failed");
  assert.deepEqual(lookupFail.log.updates, []);
  assert.equal((await resolveSelectionWarningsForTeam({ supabase: noOwner.supabase, teamId: null, raceId: "r1" })).reason, "missing_target");
});

// --- Kaldested 1: assistentens udfyldning -----------------------------------
test("notifyAssistantFilledSquad: markerer advarslen laest for holdet+loebet og sender stadig beskeden", async () => {
  const resolveCalls = [];
  const notifyCalls = [];
  const order = [];
  const resolve = async (args) => { order.push("resolve"); resolveCalls.push(args); return { ok: true }; };
  const notify = async (args) => { order.push("notify"); notifyCalls.push(args); return { delivered: true }; };
  const res = await notifyAssistantFilledSquad({
    supabase: "SB", teamId: "t1", raceId: "r1", raceName: "Tour de Test", notify, resolve,
  });
  assert.equal(res.delivered, true);
  assert.deepEqual(resolveCalls, [{ supabase: "SB", teamId: "t1", raceId: "r1" }]);
  assert.equal(notifyCalls.length, 1);
  assert.deepEqual(order, ["resolve", "notify"]);
});

test("notifyAssistantFilledSquad: ogsaa naar beskeden er dedupet markeres advarslen laest", async () => {
  const resolveCalls = [];
  const resolve = async (args) => { resolveCalls.push(args); return { ok: true }; };
  const notify = async () => ({ delivered: false, deduped: true });
  await notifyAssistantFilledSquad({ supabase: "SB", teamId: "t1", raceId: "r1", notify, resolve });
  assert.equal(resolveCalls.length, 1);
});

test("notifyAssistantFilledSquad: uden hold eller loeb -> hverken resolve eller notify", async () => {
  const calls = [];
  const resolve = async () => { calls.push("resolve"); };
  const notify = async () => { calls.push("notify"); };
  await notifyAssistantFilledSquad({ supabase: "SB", teamId: null, raceId: "r1", notify, resolve });
  await notifyAssistantFilledSquad({ supabase: "SB", teamId: "t1", raceId: null, notify, resolve });
  assert.deepEqual(calls, []);
});

test("notifyAssistantFilledSquad: default-resolve mod mock-supabase opdaterer rigtigt og sender beskeden", async () => {
  const { supabase, log } = makeSupabase({ teamRow: { user_id: "owner-1" } });
  const notifyCalls = [];
  await notifyAssistantFilledSquad({
    supabase, teamId: "t1", raceId: "r1", notify: async (a) => { notifyCalls.push(a); return { delivered: true }; },
  });
  assert.equal(log.updates.length, 1);
  assert.equal(log.updates[0].patch.is_read, true);
  assert.equal(notifyCalls.length, 1);
});

// --- Kaldested 2: managerens PUT /races/:raceId/selection --------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(marker) {
  const start = apiSource.indexOf(marker);
  assert.ok(start >= 0, `${marker} findes`);
  const next = apiSource.indexOf("\nrouter.", start + marker.length);
  return apiSource.slice(start, next === -1 ? undefined : next);
}

test("PUT /races/:raceId/selection: resolveSelectionWarnings efter gem, kun med >=1 rytter, foer svaret", () => {
  const block = routeBlock('router.put("/races/:raceId/selection"');
  const saveIdx = block.indexOf("await saveSelection(");
  const callIdx = block.indexOf("resolveSelectionWarnings(");
  const okIdx = block.indexOf("res.json({ ok: true })");
  assert.ok(saveIdx >= 0 && callIdx > saveIdx, "resolve kaldes EFTER saveSelection");
  assert.ok(okIdx > callIdx, "resolve kaldes foer svaret");
  assert.match(block, /riderIds\.length > 0\) await resolveSelectionWarnings\(\{ supabase, userId: req\.user\.id, raceId: race\.id \}\)/);
  assert.match(apiSource, /import \{ resolveSelectionWarnings \} from "\.\.\/lib\/selectionWarningResolve\.ts"/);
});
