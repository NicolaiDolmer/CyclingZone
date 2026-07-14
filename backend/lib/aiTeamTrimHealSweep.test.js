import test from "node:test";
import assert from "node:assert/strict";

import { runAiTeamTrimHealSweep, STALE_BACKSTOP_HOURS } from "./aiTeamTrimHealSweep.js";

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

const hoursAgo = (now, h) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();

test("#2187 sweep: hold der IKKE længere er blokeret slettes og tælles healed", async () => {
  const now = new Date("2026-07-12T12:00:00Z");
  const rows = [
    { id: "ai-1", name: "AI One", is_ai: true, league_division_id: "pool-a", pending_removal_at: "2026-07-10T00:00:00Z" },
  ];
  const removed = [];
  const res = await runAiTeamTrimHealSweep({
    supabase: teamsMock(rows),
    now,
    teamBlockingRaceIds: async () => [],
    getStalledIds: async () => [],
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

test("#2434 sweep: hold blokeret af LOVLIGT kørende løb er IKKE stale (kernen i CYCLINGZONE-31-fixet)", async () => {
  const now = new Date("2026-07-14T12:00:00Z");
  const rows = [
    // 60t gammel — ville have trigget den gamle 48t-tærskel, men løbet kører lovligt.
    { id: "ai-1", name: "AI One", is_ai: true, league_division_id: "pool-9", pending_removal_at: hoursAgo(now, 60) },
  ];
  const removed = [];
  const res = await runAiTeamTrimHealSweep({
    supabase: teamsMock(rows),
    now,
    teamBlockingRaceIds: async () => ["race-running"],
    getStalledIds: async () => [], // race-running er IKKE stallet → ingen alarm
    removeTeam: async (_sb, id) => { removed.push(id); },
    getInflightIds: async () => ["race-running"],
  });

  assert.deepEqual(removed, [], "blokeret hold slettes ikke");
  assert.equal(res.healed, 0);
  assert.deepEqual(res.stale, [], "60t blokeret af et kørende løb må ALDRIG alarmere");
});

test("#2434 sweep: hold blokeret af et STALLET løb flagges stale (reason=blocking_race_stalled)", async () => {
  const now = new Date("2026-07-14T12:00:00Z");
  const rows = [
    // Kun 3t gammel — men det blokerende løb er selv stallet, så det ER en ægte fastlåsning.
    { id: "ai-stuck", name: "AI Stuck", is_ai: true, league_division_id: "pool-b", pending_removal_at: hoursAgo(now, 3) },
  ];
  const res = await runAiTeamTrimHealSweep({
    supabase: teamsMock(rows),
    now,
    teamBlockingRaceIds: async () => ["race-stalled"],
    getStalledIds: async () => ["race-stalled"],
    removeTeam: async () => { throw new Error("må ikke kaldes"); },
    getInflightIds: async () => ["race-stalled"],
  });

  assert.equal(res.stale.length, 1, "hold blokeret af stallet løb flagges uanset alder");
  assert.equal(res.stale[0].teamId, "ai-stuck");
  assert.equal(res.stale[0].poolId, "pool-b");
  assert.equal(res.stale[0].reason, "blocking_race_stalled");
  assert.deepEqual(res.stale[0].stalledRaceIds, ["race-stalled"]);
});

test("#2434 sweep: blokering > backstop flagges stale (reason=pending_exceeds_backstop)", async () => {
  const now = new Date("2026-07-14T12:00:00Z");
  const rows = [
    { id: "ai-old", name: "AI Old", is_ai: true, league_division_id: "pool-c", pending_removal_at: hoursAgo(now, STALE_BACKSTOP_HOURS + 1) },
  ];
  const res = await runAiTeamTrimHealSweep({
    supabase: teamsMock(rows),
    now,
    teamBlockingRaceIds: async () => ["race-running"],
    getStalledIds: async () => [], // løbet ser ikke stallet ud, men blokeringen er uforklarligt gammel
    removeTeam: async () => { throw new Error("må ikke kaldes"); },
    getInflightIds: async () => ["race-running"],
  });

  assert.equal(res.stale.length, 1, "backstop fanger uforklarligt lang blokering");
  assert.equal(res.stale[0].reason, "pending_exceeds_backstop");
  assert.ok(res.stale[0].ageHours >= STALE_BACKSTOP_HOURS);
});

test("#2389 sweep: hold med uudbetalte præmier (< backstop) udskydes, ikke stale", async () => {
  const now = new Date("2026-07-14T12:00:00Z");
  const rows = [
    { id: "ai-unpaid", name: "AI Unpaid", is_ai: true, league_division_id: "pool-a", pending_removal_at: hoursAgo(now, 2) },
  ];
  const removed = [];
  const res = await runAiTeamTrimHealSweep({
    supabase: teamsMock(rows),
    now,
    teamBlockingRaceIds: async () => [], // ikke inflight-blokeret — kun præmie-blokeret
    getStalledIds: async () => [],
    hasUnpaidPrizes: async () => true,
    removeTeam: async (_sb, id) => { removed.push(id); },
    getInflightIds: async () => [],
  });

  assert.deepEqual(removed, [], "hold med uudbetalte præmier slettes IKKE");
  assert.equal(res.healed, 0);
  assert.deepEqual(res.stale, [], "2t gammel — udskudt, ikke stale");
});

test("#2389 sweep: præmie-blokeret hold > backstop rapporteres stale (auto-prize reelt død)", async () => {
  const now = new Date("2026-07-14T12:00:00Z");
  const rows = [
    { id: "ai-unpaid-stale", name: "AI Unpaid Stale", is_ai: true, league_division_id: "pool-c", pending_removal_at: hoursAgo(now, STALE_BACKSTOP_HOURS + 2) },
  ];
  const res = await runAiTeamTrimHealSweep({
    supabase: teamsMock(rows),
    now,
    teamBlockingRaceIds: async () => [],
    getStalledIds: async () => [],
    hasUnpaidPrizes: async () => true,
    removeTeam: async () => { throw new Error("må ikke kaldes"); },
    getInflightIds: async () => [],
  });

  assert.equal(res.stale.length, 1, "vedvarende præmie-blokering eskaleres via backstop");
  assert.equal(res.stale[0].teamId, "ai-unpaid-stale");
  assert.equal(res.stale[0].reason, "pending_exceeds_backstop");
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
    teamBlockingRaceIds: async (_sb, id) => {
      if (id === "a") throw new Error("DB nede");
      return [];
    },
    getStalledIds: async () => [],
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

test("#2187 sweep: ingen kandidater → no-op", async () => {
  const now = new Date("2026-07-12T12:00:00Z");
  const res = await runAiTeamTrimHealSweep({ supabase: teamsMock([]), now });

  assert.equal(res.candidates, 0);
  assert.equal(res.healed, 0);
  assert.equal(res.failed, 0);
  assert.deepEqual(res.stale, []);
});

test("#2434 sweep: STALE_BACKSTOP_HOURS er 120 (godt over det længste etapeløbs kalender-spredning)", () => {
  assert.equal(STALE_BACKSTOP_HOURS, 120);
});
