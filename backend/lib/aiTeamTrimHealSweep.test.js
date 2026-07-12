import test from "node:test";
import assert from "node:assert/strict";

import { runAiTeamTrimHealSweep, STALE_PENDING_HOURS } from "./aiTeamTrimHealSweep.js";

// Mock af teams-tabellen for sweep-queryen:
//   select("id, name, league_division_id, pending_removal_at")
//     .eq("is_ai", true).not("pending_removal_at", "is", null).order().range()
function teamsMock(rows) {
  return {
    from(table) {
      assert.equal(table, "teams", "sweep'en queryer kun teams");
      const eqFilters = [];
      let notNullCol = null;
      const b = {
        select() { return b; },
        eq(col, val) { eqFilters.push([col, val]); return b; },
        not(col, op, val) {
          if (op === "is" && val === null) notNullCol = col;
          return b;
        },
        order() { return b; },
        range(from) {
          let out = [...rows];
          for (const [col, val] of eqFilters) out = out.filter((r) => r[col] === val);
          if (notNullCol) out = out.filter((r) => r[notNullCol] != null);
          const data = from === 0 ? out : [];
          return Promise.resolve({ data, error: null });
        },
      };
      return b;
    },
  };
}

test("#2187 sweep: hold der IKKE længere er blokeret slettes og tælles healed", async () => {
  const now = new Date("2026-07-12T12:00:00Z");
  const rows = [
    { id: "ai-1", name: "AI One", is_ai: true, league_division_id: "pool-a", pending_removal_at: "2026-07-10T00:00:00Z" },
  ];
  const removed = [];
  const res = await runAiTeamTrimHealSweep({
    supabase: teamsMock(rows),
    now,
    isBlocked: async () => false,
    hasUnpaidPrizes: async () => false,
    removeTeam: async (_sb, id) => { removed.push(id); },
    getInflightIds: async () => [],
  });

  assert.deepEqual(removed, ["ai-1"], "det ikke-længere-blokerede hold slettes");
  assert.equal(res.candidates, 1);
  assert.equal(res.healed, 1);
  assert.equal(res.failed, 0);
  assert.deepEqual(res.stale, []);
});

test("#2187 sweep: hold der STADIG er blokeret efterlades urørt, ingen kast", async () => {
  const now = new Date("2026-07-12T12:00:00Z");
  const rows = [
    { id: "ai-1", name: "AI One", is_ai: true, league_division_id: "pool-a", pending_removal_at: "2026-07-12T10:00:00Z" }, // 2t gammel
  ];
  const removed = [];
  const res = await runAiTeamTrimHealSweep({
    supabase: teamsMock(rows),
    now,
    isBlocked: async () => true,
    removeTeam: async (_sb, id) => { removed.push(id); },
    getInflightIds: async () => ["race-x"],
  });

  assert.deepEqual(removed, [], "blokeret hold slettes ikke");
  assert.equal(res.candidates, 1);
  assert.equal(res.healed, 0);
  assert.equal(res.failed, 0);
  assert.deepEqual(res.stale, [], "kun 2t gammel — ikke stale endnu");
});

test("#2187 sweep: persistent blokeret hold (>staleHours) rapporteres som stale (Sentry-alarm i cron-wrapperen)", async () => {
  const now = new Date("2026-07-12T12:00:00Z");
  const pendingSince = new Date(now.getTime() - (STALE_PENDING_HOURS + 1) * 60 * 60 * 1000).toISOString();
  const rows = [
    { id: "ai-stale", name: "AI Stuck", is_ai: true, league_division_id: "pool-b", pending_removal_at: pendingSince },
  ];
  const res = await runAiTeamTrimHealSweep({
    supabase: teamsMock(rows),
    now,
    isBlocked: async () => true,
    removeTeam: async () => { throw new Error("må ikke kaldes"); },
    getInflightIds: async () => ["race-x"],
  });

  assert.equal(res.candidates, 1);
  assert.equal(res.healed, 0);
  assert.equal(res.stale.length, 1, "persistent udskudt hold flagges stale");
  assert.equal(res.stale[0].teamId, "ai-stale");
  assert.equal(res.stale[0].poolId, "pool-b");
  assert.ok(res.stale[0].ageHours >= STALE_PENDING_HOURS);
});

test("#2187 sweep: per-hold fejl isoleres (én fejler, resten heales)", async () => {
  const now = new Date("2026-07-12T12:00:00Z");
  const rows = [
    { id: "a", name: "A", is_ai: true, league_division_id: "pool-a", pending_removal_at: "2026-07-10T00:00:00Z" },
    { id: "b", name: "B", is_ai: true, league_division_id: "pool-a", pending_removal_at: "2026-07-10T00:00:00Z" },
  ];
  const removed = [];
  const res = await runAiTeamTrimHealSweep({
    supabase: teamsMock(rows),
    now,
    isBlocked: async (_sb, id) => {
      if (id === "a") throw new Error("DB nede");
      return false;
    },
    hasUnpaidPrizes: async () => false,
    removeTeam: async (_sb, id) => { removed.push(id); },
    getInflightIds: async () => [],
  });

  assert.equal(res.candidates, 2);
  assert.equal(res.healed, 1, "b blev healet trods a's fejl");
  assert.equal(res.failed, 1);
  assert.equal(res.errors[0].teamId, "a");
  assert.deepEqual(removed, ["b"]);
});

test("#2389 sweep: hold med uudbetalte præmier udskydes (trim kolliderer ellers med auto-prize)", async () => {
  const now = new Date("2026-07-12T12:00:00Z");
  const rows = [
    { id: "ai-unpaid", name: "AI Unpaid", is_ai: true, league_division_id: "pool-a", pending_removal_at: "2026-07-12T10:00:00Z" },
  ];
  const removed = [];
  const res = await runAiTeamTrimHealSweep({
    supabase: teamsMock(rows),
    now,
    isBlocked: async () => false, // ikke inflight-blokeret — kun præmie-blokeret
    hasUnpaidPrizes: async () => true,
    removeTeam: async (_sb, id) => { removed.push(id); },
    getInflightIds: async () => [],
  });

  assert.deepEqual(removed, [], "hold med uudbetalte præmier slettes IKKE");
  assert.equal(res.healed, 0);
  assert.equal(res.failed, 0);
  assert.deepEqual(res.stale, [], "2t gammel — udskudt, ikke stale");
});

test("#2389 sweep: præmie-blokeret hold >staleHours rapporteres stale (samme eskalation som inflight)", async () => {
  const now = new Date("2026-07-12T12:00:00Z");
  const pendingSince = new Date(now.getTime() - (STALE_PENDING_HOURS + 2) * 60 * 60 * 1000).toISOString();
  const rows = [
    { id: "ai-unpaid-stale", name: "AI Unpaid Stale", is_ai: true, league_division_id: "pool-c", pending_removal_at: pendingSince },
  ];
  const res = await runAiTeamTrimHealSweep({
    supabase: teamsMock(rows),
    now,
    isBlocked: async () => false,
    hasUnpaidPrizes: async () => true,
    removeTeam: async () => { throw new Error("må ikke kaldes"); },
    getInflightIds: async () => [],
  });

  assert.equal(res.stale.length, 1, "vedvarende præmie-blokering eskaleres som stale");
  assert.equal(res.stale[0].teamId, "ai-unpaid-stale");
});

test("#2187 sweep: ingen kandidater → no-op", async () => {
  const now = new Date("2026-07-12T12:00:00Z");
  const res = await runAiTeamTrimHealSweep({ supabase: teamsMock([]), now });

  assert.equal(res.candidates, 0);
  assert.equal(res.healed, 0);
  assert.equal(res.failed, 0);
  assert.deepEqual(res.stale, []);
});

test("#2187 sweep: STALE_PENDING_HOURS er 48 (længere end noget realistisk etapeløb varer)", () => {
  assert.equal(STALE_PENDING_HOURS, 48);
});
