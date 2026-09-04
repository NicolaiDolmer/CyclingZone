import test from "node:test";
import assert from "node:assert/strict";
import { resolveDmRecipient } from "./discordDmRecipient.js";

// Minimal fake Supabase query builder: .from(t).select().eq().single() -> { data }.
function fakeClient({ team, user }) {
  return {
    from(table) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        async single() {
          if (table === "teams") return { data: team ?? null };
          if (table === "users") return { data: user ?? null };
          return { data: null };
        },
      };
      return builder;
    },
  };
}

test("resolveDmRecipient returns discordId + prefs via the teamId path", async () => {
  const client = fakeClient({
    team: { user_id: "u1" },
    user: { discord_id: "d1", discord_dm_enabled: true, discord_dm_prefs: { auction_won: false }, language: "da" },
  });
  const res = await resolveDmRecipient({ teamId: "t1", client });
  assert.deepEqual(res, { discordId: "d1", prefs: { auction_won: false }, language: "da" });
});

test("resolveDmRecipient resolves the userId path without a team lookup", async () => {
  const client = fakeClient({
    team: null,
    user: { discord_id: "d2", discord_dm_enabled: true, discord_dm_prefs: {} },
  });
  const res = await resolveDmRecipient({ userId: "u2", client });
  // #4734: language mangler i raekken → null, som normaliseres til EN ved render.
  assert.deepEqual(res, { discordId: "d2", prefs: {}, language: null });
});

test("resolveDmRecipient returns null when the master switch is off", async () => {
  const client = fakeClient({
    user: { discord_id: "d3", discord_dm_enabled: false, discord_dm_prefs: {} },
  });
  assert.equal(await resolveDmRecipient({ userId: "u3", client }), null);
});

test("resolveDmRecipient returns null when the user has no discord_id", async () => {
  const client = fakeClient({
    user: { discord_id: null, discord_dm_enabled: true, discord_dm_prefs: {} },
  });
  assert.equal(await resolveDmRecipient({ userId: "u4", client }), null);
});

test("resolveDmRecipient returns null when no team/user resolves", async () => {
  const client = fakeClient({ team: null, user: null });
  assert.equal(await resolveDmRecipient({ teamId: "missing", client }), null);
  assert.equal(await resolveDmRecipient({ client }), null);
});

test("resolveDmRecipient defaults prefs to {} when the column is null", async () => {
  const client = fakeClient({
    user: { discord_id: "d5", discord_dm_enabled: true, discord_dm_prefs: null },
  });
  const res = await resolveDmRecipient({ userId: "u5", client });
  assert.deepEqual(res, { discordId: "d5", prefs: {}, language: null });
});

// #4734: DM-teksten rendres i modtagerens sprog, saa users.language SKAL med ud
// af resolveren — ellers falder hver DM tavst tilbage til EN.
test("resolveDmRecipient carries users.language through to the caller", async () => {
  const client = fakeClient({
    user: { discord_id: "d6", discord_dm_enabled: true, discord_dm_prefs: {}, language: "da" },
  });
  const res = await resolveDmRecipient({ userId: "u6", client });
  assert.equal(res.language, "da");
});
