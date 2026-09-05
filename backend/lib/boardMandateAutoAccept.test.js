import test from "node:test";
import assert from "node:assert/strict";

import { processMandateAutoAcceptCron } from "./boardMandateAutoAccept.js";

// ── Fake-supabase: board_mandates(status=proposed) + teams + users, plus alt
// signMandate (boardMandateMeeting.js) selv rører når den kaldes med Keep på
// alt — samme tabel-sæt som boardMandateMeeting.test.js's mock. ────────────
function makeCronSupabase({ flagValue = "on", mandates = [], teams = [], users = [] } = {}) {
  const state = { mandates: [...mandates], events: [], boardProfiles: [] };

  function selectChain(rows) {
    const filters = {};
    const chain = {
      eq(col, value) { filters[col] = value; return chain; },
      in(col, values) { filters[`__in:${col}`] = values; return chain; },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        const list = applyFilters(rows, filters);
        return { data: list[0] ?? null, error: null };
      },
      then: (resolve) => resolve({ data: applyFilters(rows, filters), error: null }),
    };
    return chain;
  }
  function applyFilters(rows, filters) {
    return rows.filter((r) => Object.entries(filters).every(([k, v]) => {
      if (k.startsWith("__in:")) return v.includes(r[k.slice(5)]);
      return r[k] === v;
    }));
  }

  return {
    _state: state,
    from(table) {
      if (table === "app_config") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: flagValue }, error: null }) }) }) };
      }
      if (table === "board_mandates") {
        return {
          select: () => selectChain(state.mandates),
          update(payload) {
            const filters = {};
            const chain = {
              eq(col, value) { filters[col] = value; return chain; },
              then: (resolve) => {
                applyFilters(state.mandates, filters).forEach((m) => Object.assign(m, payload));
                resolve({ error: null });
              },
            };
            return chain;
          },
        };
      }
      if (table === "teams") return { select: () => selectChain(teams) };
      if (table === "users") return { select: () => selectChain(users) };
      if (table === "teams_single") return null;
      // Tabeller signMandate/buildBoardRoomPayload rører ved fuld underskrift —
      // holdt minimale/tomme, testene her fokuserer på cron-beslutningen.
      if (table === "board_relations") return { select: () => selectChain([{ team_id: mandates[0]?.team_id, confidence: 55, category_scores: {} }]) };
      if (table === "team_board_members") return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      if (table === "board_vision_milestones") {
        const chain = { eq: () => chain, order: () => chain, limit: () => chain, maybeSingle: async () => ({ data: null, error: null }), then: (resolve) => resolve({ data: [], error: null }) };
        return { select: () => chain };
      }
      if (table === "board_satisfaction_events") {
        const chain = { eq: () => chain, or: () => chain, order: () => chain, limit: () => chain, then: (resolve) => resolve({ data: state.events, error: null }) };
        return { select: () => chain, insert: async (payload) => { state.events.push(payload); return { error: null }; } };
      }
      if (table === "board_profiles") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
          upsert: () => ({ select: () => ({ single: async () => { state.boardProfiles.push({}); return { data: { id: "bp-1" }, error: null }; } }) }),
        };
      }
      if (table === "seasons") {
        const chain = { eq: () => chain, order: () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) };
        return { select: () => chain };
      }
      if (table === "riders") return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      if (table === "season_standings") {
        const chain = { eq: () => chain, order: () => chain, limit: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
        return { select: () => chain };
      }
      if (table === "loans") {
        const chain = { eq: () => chain, then: (resolve) => resolve({ count: 0, error: null }) };
        return { select: () => chain };
      }
      // #4557 (overblik + faner) · boardRoom.js laeser nu ogsaa lag 6
      // (bonustilbuddet) til den payload signMandate returnerer. Ingen
      // bonus-raekker i auto-accept-fixturen: tom liste.
      if (table === "board_consequences") {
        const chain = {
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve) => resolve({ data: [], error: null }),
        };
        return { select: () => chain };
      }
      throw new Error(`uventet tabel i test: ${table}`);
    },
  };
}

function makeNotifyUser(deliveredLog) {
  return async (args) => { deliveredLog.push(args); return { delivered: true }; };
}

test("processMandateAutoAcceptCron: kill-switch off → no-op, ingen queries udover flag-tjek", async () => {
  const supabase = makeCronSupabase({ flagValue: "off" });
  const notified = [];
  const result = await processMandateAutoAcceptCron({ supabase, notifyUser: makeNotifyUser(notified) });
  assert.deepEqual(result, { mandates_checked: 0, reminders_sent: 0, auto_accepted: 0, errors: 0 });
  assert.equal(notified.length, 0);
});

test("processMandateAutoAcceptCron: ingen proposed mandater → no-op", async () => {
  const supabase = makeCronSupabase({ flagValue: "on", mandates: [] });
  const notified = [];
  const result = await processMandateAutoAcceptCron({ supabase, notifyUser: makeNotifyUser(notified) });
  assert.equal(result.mandates_checked, 0);
});

test("processMandateAutoAcceptCron: dag 0 → neutralt åbnings-varsel, INGEN nedtælling", async () => {
  const now = new Date("2026-09-03T12:00:00Z");
  const supabase = makeCronSupabase({
    flagValue: "on",
    mandates: [{ id: "m1", team_id: "t1", status: "proposed", proposed_at: now.toISOString(), auto_accept_deadline: null }],
    teams: [{ id: "t1", user_id: "u1", name: "Team 1" }],
    users: [{ id: "u1", last_seen: null }],
  });
  const notified = [];
  const result = await processMandateAutoAcceptCron({ supabase, notifyUser: makeNotifyUser(notified), now });
  assert.equal(result.reminders_sent, 1);
  assert.equal(result.auto_accepted, 0);
  assert.equal(notified[0].metadata.titleCode, "notif.boardMandateOpened.title");
});

test("processMandateAutoAcceptCron: dag 5 (forladt konto, korte tærskler) → bestyrelsen underskriver Keep-på-alt", async () => {
  const openedAt = new Date("2026-09-03T00:00:00Z");
  const now = new Date(openedAt.getTime() + 5 * 24 * 60 * 60 * 1000 + 1000);
  const supabase = makeCronSupabase({
    flagValue: "on",
    mandates: [{
      id: "m1", team_id: "t1", season_number: 4, status: "proposed", focus: "balanced",
      goals: [{ type: "top_n_finish", target: 4, satisfaction_bonus: 10, satisfaction_penalty: 6 }],
      adjustments_allowed: 2, proposed_at: openedAt.toISOString(), auto_accept_deadline: null,
      source: { negotiation_power: { counteroffer_generosity: 1.0 } },
    }],
    teams: [{ id: "t1", user_id: "u1", name: "Team 1" }],
    users: [{ id: "u1", last_seen: null }], // ingen last_seen → korte tærskler (5 dage)
  });
  const notified = [];
  const result = await processMandateAutoAcceptCron({ supabase, notifyUser: makeNotifyUser(notified), now });
  assert.equal(result.auto_accepted, 1);
  assert.equal(supabase._state.mandates[0].status, "active");
  assert.equal(supabase._state.mandates[0].adjustments_used, 0, "Keep på alt — ingen justeringer brugt");
  assert.equal(supabase._state.mandates[0].request_used, false, "ingen anmodning ved auto-accept");
  assert.equal(notified[0].metadata.titleCode, "notif.boardMandateAutoAccepted.title");
});

test("processMandateAutoAcceptCron: en AKTIV spiller (last_seen for nylig) auto-accepteres IKKE på dag 5", async () => {
  const openedAt = new Date("2026-09-03T00:00:00Z");
  const now = new Date(openedAt.getTime() + 5 * 24 * 60 * 60 * 1000 + 1000);
  const supabase = makeCronSupabase({
    flagValue: "on",
    mandates: [{ id: "m1", team_id: "t1", status: "proposed", proposed_at: openedAt.toISOString(), auto_accept_deadline: null }],
    teams: [{ id: "t1", user_id: "u1", name: "Team 1" }],
    users: [{ id: "u1", last_seen: now.toISOString() }], // aktiv lige nu → lange tærskler (10 dage)
  });
  const notified = [];
  const result = await processMandateAutoAcceptCron({ supabase, notifyUser: makeNotifyUser(notified), now });
  assert.equal(result.auto_accepted, 0, "aktiv spiller beskyttes af det lange vindue (#3579-mønsteret)");
  assert.equal(supabase._state.mandates[0].status, "proposed", "urørt");
});

// ── #4839: cronen er en motor-skrivning — beta tæller som on ─────────────────

test("#4839 processMandateAutoAcceptCron: beta → bestyrelsen underskriver stadig (cron har ingen viewer)", async () => {
  const openedAt = new Date("2026-09-03T00:00:00Z");
  const now = new Date(openedAt.getTime() + 5 * 24 * 60 * 60 * 1000 + 1000);
  const supabase = makeCronSupabase({
    flagValue: "beta",
    mandates: [{
      id: "m1", team_id: "t1", season_number: 4, status: "proposed", focus: "balanced",
      goals: [{ type: "top_n_finish", target: 4, satisfaction_bonus: 10, satisfaction_penalty: 6 }],
      adjustments_allowed: 2, proposed_at: openedAt.toISOString(), auto_accept_deadline: null,
      source: { negotiation_power: { counteroffer_generosity: 1.0 } },
    }],
    teams: [{ id: "t1", user_id: "u1", name: "Team 1" }],
    users: [{ id: "u1", last_seen: null }],
  });
  const notified = [];
  const result = await processMandateAutoAcceptCron({ supabase, notifyUser: makeNotifyUser(notified), now });
  assert.equal(result.auto_accepted, 1, "beta må ikke efterlade mandater hængende forbi deres deadline");
  assert.equal(supabase._state.mandates[0].status, "active");
});

test("#4839 processMandateAutoAcceptCron: off → stadig no-op, også som motor-skrivning", async () => {
  const supabase = makeCronSupabase({
    flagValue: "off",
    mandates: [{ id: "m1", team_id: "t1", status: "proposed", proposed_at: "2026-09-03T00:00:00Z", auto_accept_deadline: null }],
    teams: [{ id: "t1", user_id: "u1", name: "Team 1" }],
    users: [{ id: "u1", last_seen: null }],
  });
  const notified = [];
  const result = await processMandateAutoAcceptCron({ supabase, notifyUser: makeNotifyUser(notified) });
  assert.deepEqual(result, { mandates_checked: 0, reminders_sent: 0, auto_accepted: 0, errors: 0 });
  assert.equal(supabase._state.mandates[0].status, "proposed");
});
