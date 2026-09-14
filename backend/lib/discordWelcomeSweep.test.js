import test from "node:test";
import assert from "node:assert/strict";

import {
  DISCORD_WELCOME_FALLBACK_WINDOW_MS,
  isDiscordWelcomeDue,
  runDiscordWelcomeSweep,
} from "./discordWelcomeSweep.js";
import { DISCORD_WELCOME_TYPE } from "./discordWelcomeNotification.js";

// #5130 · Ren beslutningsfunktion: draft-taerskel ELLER 24t-fallback.

test("isDiscordWelcomeDue: naar loebs-klar taersklen er naaet (8 ryttere)", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  assert.equal(
    isDiscordWelcomeDue({ team: { created_at: now.toISOString() }, activeRiders: 8, now }),
    true,
  );
});

test("isDiscordWelcomeDue: under taersklen OG under 24t → ikke moden endnu", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const created = new Date(now.getTime() - 60 * 60 * 1000); // 1t siden
  assert.equal(
    isDiscordWelcomeDue({ team: { created_at: created.toISOString() }, activeRiders: 3, now }),
    false,
  );
});

test("isDiscordWelcomeDue: under taersklen men 24t+ gammel → fallback udloeser", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const created = new Date(now.getTime() - DISCORD_WELCOME_FALLBACK_WINDOW_MS - 1000);
  assert.equal(
    isDiscordWelcomeDue({ team: { created_at: created.toISOString() }, activeRiders: 0, now }),
    true,
  );
});

test("isDiscordWelcomeDue: praecis paa 24t-graensen udloeser (>=)", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const created = new Date(now.getTime() - DISCORD_WELCOME_FALLBACK_WINDOW_MS);
  assert.equal(
    isDiscordWelcomeDue({ team: { created_at: created.toISOString() }, activeRiders: 0, now }),
    true,
  );
});

test("isDiscordWelcomeDue: intet created_at → false (defensivt)", () => {
  assert.equal(isDiscordWelcomeDue({ team: {}, activeRiders: 8, now: new Date() }), false);
});

function makeNoopSupabase() {
  return { from: () => ({}) };
}

// Fake claim: efterligner .update(...).eq("id", …).is(col, null).select("id") —
// registrerer forsoeg og lader kalderen styre om raekken "vindes".
function makeClaimingSupabase({ alreadyClaimedIds = new Set() } = {}) {
  const claims = [];
  return {
    claims,
    supabase: {
      from(table) {
        if (table !== "teams") throw new Error(`uventet tabel: ${table}`);
        return {
          update() {
            return {
              eq(_col, id) {
                return {
                  is() {
                    return {
                      async select() {
                        claims.push(id);
                        if (alreadyClaimedIds.has(id)) return { data: [], error: null };
                        alreadyClaimedIds.add(id);
                        return { data: [{ id }], error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

test("runDiscordWelcomeSweep: modne hold claimes + notify'es, umodne springes over", async () => {
  const notified = [];
  const { supabase, claims } = makeClaimingSupabase();
  const now = new Date("2026-09-14T12:00:00Z");

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    notify: async (payload) => { notified.push(payload); return { delivered: true }; },
    fetchCandidateTeams: async () => [
      { id: "t1", user_id: "u1", created_at: now.toISOString() }, // moden via ryttertal
      { id: "t2", user_id: "u2", created_at: now.toISOString() }, // umoden, for ny
    ],
    fetchActiveRiderCounts: async () => new Map([["t1", 8], ["t2", 1]]),
  });

  assert.equal(stats.candidates, 2);
  assert.equal(stats.sent, 1);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.failed, 0);
  assert.deepEqual(claims, ["t1"]);
  assert.equal(notified.length, 1);
  assert.equal(notified[0].userId, "u1");
  assert.equal(notified[0].type, DISCORD_WELCOME_TYPE);
});

test("runDiscordWelcomeSweep: tabt claim-race (0 raekker) springer over uden notify", async () => {
  const notified = [];
  const { supabase } = makeClaimingSupabase({ alreadyClaimedIds: new Set(["t1"]) });
  const now = new Date("2026-09-14T12:00:00Z");

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    notify: async (payload) => { notified.push(payload); return { delivered: true }; },
    fetchCandidateTeams: async () => [{ id: "t1", user_id: "u1", created_at: now.toISOString() }],
    fetchActiveRiderCounts: async () => new Map([["t1", 8]]),
  });

  assert.equal(stats.sent, 0);
  assert.equal(stats.skipped, 1);
  assert.equal(notified.length, 0);
});

test("runDiscordWelcomeSweep: ingen kandidater → tomt resultat, ingen kald", async () => {
  const stats = await runDiscordWelcomeSweep({
    supabase: makeNoopSupabase(),
    notify: async () => { throw new Error("skal ikke kaldes"); },
    fetchCandidateTeams: async () => [],
    fetchActiveRiderCounts: async () => { throw new Error("skal ikke kaldes"); },
  });
  assert.deepEqual(stats, { candidates: 0, sent: 0, skipped: 0, failed: 0 });
});

// Fake supabase der skelner claim-kald (.eq().is().select(), patch =
// timestamp) fra revert-kald (bare .eq(), afventet direkte, patch = null) —
// samme skelnen den ægte discordWelcomeSweep.js laver ved at kalde .is() kun
// på claim-vejen.
function makeRevertTrackingSupabase() {
  const claims = [];
  const reverts = [];
  return {
    claims,
    reverts,
    supabase: {
      from(table) {
        if (table !== "teams") throw new Error(`uventet tabel: ${table}`);
        return {
          update(patch) {
            return {
              eq(_col, id) {
                if (patch.discord_welcome_sent_at === null) {
                  reverts.push(id);
                  return Promise.resolve({ error: null });
                }
                return {
                  is() {
                    return {
                      async select() {
                        claims.push(id);
                        return { data: [{ id }], error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

test("runDiscordWelcomeSweep: notify fejler EFTER vundet claim → claimet rulles tilbage (CodeRabbit-fund)", async () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const { supabase, claims, reverts } = makeRevertTrackingSupabase();

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    notify: async () => { throw new Error("Supabase midlertidigt nede"); },
    fetchCandidateTeams: async () => [{ id: "t1", user_id: "u1", created_at: now.toISOString() }],
    fetchActiveRiderCounts: async () => new Map([["t1", 8]]),
    captureExceptionFn: () => {},
  });

  assert.deepEqual(claims, ["t1"]);
  assert.deepEqual(reverts, ["t1"], "et fejlet notify SKAL frigive claimet, ellers er holdet tabt for evigt");
  assert.equal(stats.failed, 1);
  assert.equal(stats.sent, 0);
});

test("runDiscordWelcomeSweep: en fejlet claim isoleres, resten af sweepen fortsaetter", async () => {
  const notified = [];
  const now = new Date("2026-09-14T12:00:00Z");
  let calls = 0;
  const supabase = {
    from(table) {
      assert.equal(table, "teams");
      return {
        update() {
          return {
            eq(_col, id) {
              return {
                is() {
                  return {
                    async select() {
                      calls += 1;
                      if (id === "t1") return { data: null, error: { message: "boom" } };
                      return { data: [{ id }], error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    notify: async (payload) => { notified.push(payload); return { delivered: true }; },
    fetchCandidateTeams: async () => [
      { id: "t1", user_id: "u1", created_at: now.toISOString() },
      { id: "t2", user_id: "u2", created_at: now.toISOString() },
    ],
    fetchActiveRiderCounts: async () => new Map([["t1", 8], ["t2", 8]]),
    captureExceptionFn: () => {},
  });

  assert.equal(calls, 2);
  assert.equal(stats.failed, 1);
  assert.equal(stats.sent, 1);
  assert.equal(notified.length, 1);
  assert.equal(notified[0].userId, "u2");
});
