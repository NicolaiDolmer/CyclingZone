// Tests for trainingSweep.js (#1305)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldSweepNow, teamsNeedingSweep, runTrainingSweep } from "./trainingSweep.js";

// ── shouldSweepNow ────────────────────────────────────────────────────────────

describe("shouldSweepNow", () => {
  it("sweep kun efter kl. 22 dansk tid", () => {
    // 2026-06-20T19:59:00Z = 21:59 CEST (UTC+2) → for tidligt
    assert.equal(shouldSweepNow(new Date("2026-06-20T19:59:00Z")), false);
    // 2026-06-20T20:01:00Z = 22:01 CEST → korrekt vindue
    assert.equal(shouldSweepNow(new Date("2026-06-20T20:01:00Z")), true);
  });

  it("grænseværdi: præcis kl. 22:00 CEST er inden for vinduet", () => {
    // 2026-06-20T20:00:00Z = 22:00 CEST
    assert.equal(shouldSweepNow(new Date("2026-06-20T20:00:00Z")), true);
  });

  it("kl. 23 er også inden for vinduet", () => {
    // 2026-06-20T21:00:00Z = 23:00 CEST
    assert.equal(shouldSweepNow(new Date("2026-06-20T21:00:00Z")), true);
  });

  it("om morgenen er uden for vinduet", () => {
    // 2026-06-20T06:00:00Z = 08:00 CEST
    assert.equal(shouldSweepNow(new Date("2026-06-20T06:00:00Z")), false);
  });
});

// ── teamsNeedingSweep ────────────────────────────────────────────────────────

describe("teamsNeedingSweep", () => {
  it("filtrerer hold der allerede har kørt i dag", () => {
    const teams = [{ id: "t1" }, { id: "t2" }];
    const runs = [{ team_id: "t1", tick_date: "2026-06-20" }];
    assert.deepEqual(
      teamsNeedingSweep(teams, runs, "2026-06-20").map((t) => t.id),
      ["t2"]
    );
  });

  it("returnerer alle hold når ingen har kørt i dag", () => {
    const teams = [{ id: "t1" }, { id: "t2" }];
    const runs = [];
    assert.deepEqual(
      teamsNeedingSweep(teams, runs, "2026-06-20").map((t) => t.id),
      ["t1", "t2"]
    );
  });

  it("returnerer tomt array når alle hold allerede har kørt", () => {
    const teams = [{ id: "t1" }, { id: "t2" }];
    const runs = [
      { team_id: "t1", tick_date: "2026-06-20" },
      { team_id: "t2", tick_date: "2026-06-20" },
    ];
    assert.deepEqual(teamsNeedingSweep(teams, runs, "2026-06-20"), []);
  });

  it("kørsler fra en anden dato tæller ikke", () => {
    const teams = [{ id: "t1" }, { id: "t2" }];
    // t1 kørte i går
    const runs = [{ team_id: "t1", tick_date: "2026-06-19" }];
    assert.deepEqual(
      teamsNeedingSweep(teams, runs, "2026-06-20").map((t) => t.id),
      ["t1", "t2"]
    );
  });
});

// ── runTrainingSweep ─────────────────────────────────────────────────────────

// Supabase mock der implementerer Promise-protokol korrekt for begge query-mønstre
// (.maybeSingle() + direkte await af query-builder via .then()).
function makeChainMock({ resolveWith }) {
  const obj = {
    select() { return this; },
    eq() { return this; },
    maybeSingle() { return Promise.resolve(resolveWith); },
    then(resolve, reject) {
      return Promise.resolve(resolveWith).then(resolve, reject);
    },
  };
  return obj;
}

function makeFullMockSupabase({
  configValue = true,
  teams = [],
  season = { id: "s1", number: 1 },
  runs = [],
} = {}) {
  return {
    from(table) {
      if (table === "app_config") {
        return makeChainMock({ table, resolveWith: { data: { value: configValue }, error: null } });
      }
      if (table === "seasons") {
        return makeChainMock({ table, resolveWith: { data: season, error: null } });
      }
      if (table === "teams") {
        return makeChainMock({ table, resolveWith: { data: teams, error: null } });
      }
      if (table === "training_day_runs") {
        return makeChainMock({ table, resolveWith: { data: runs, error: null } });
      }
      return makeChainMock({ table, resolveWith: { data: null, error: null } });
    },
  };
}

describe("runTrainingSweep", () => {
  // Tidspunkt FØR kl. 22 dansk tid (CEST, UTC+2): 19:00 UTC = 21:00 CEST
  const beforeWindow = new Date("2026-06-20T19:00:00Z");
  // Tidspunkt EFTER kl. 22 dansk tid: 20:30 UTC = 22:30 CEST
  const afterWindow = new Date("2026-06-20T20:30:00Z");

  it("returnerer before_window når det er for tidligt", async () => {
    const supabase = makeFullMockSupabase();
    const result = await runTrainingSweep({ supabase, now: beforeWindow });
    assert.deepEqual(result, { swept: 0, skipped: "before_window" });
  });

  it("returnerer flag_off når feature-flaget er slukket", async () => {
    const supabase = makeFullMockSupabase({ configValue: false });
    const result = await runTrainingSweep({ supabase, now: afterWindow });
    assert.deepEqual(result, { swept: 0, skipped: "flag_off" });
  });

  it("returnerer no_active_season når der ikke er en aktiv sæson", async () => {
    const supabase = makeFullMockSupabase({ season: null });
    const result = await runTrainingSweep({ supabase, now: afterWindow });
    assert.deepEqual(result, { swept: 0, skipped: "no_active_season" });
  });

  it("swept=0 når alle hold allerede har kørt i dag", async () => {
    const teams = [{ id: "t1" }, { id: "t2" }];
    // Runs for den korrekte tickDate (2026-06-20 i CEST = 2026-06-20 for afterWindow)
    const runs = [
      { team_id: "t1", tick_date: "2026-06-20" },
      { team_id: "t2", tick_date: "2026-06-20" },
    ];
    const supabase = makeFullMockSupabase({ teams, runs });
    let callCount = 0;
    const runDay = async () => { callCount++; return { alreadyRan: false }; };
    const result = await runTrainingSweep({ supabase, now: afterWindow, runDay });
    assert.equal(callCount, 0);
    assert.deepEqual(result, { swept: 0 });
  });

  it("kalder runDay for hold der ikke har kørt og tæller swept korrekt", async () => {
    const teams = [{ id: "t1" }, { id: "t2" }];
    const runs = [{ team_id: "t1", tick_date: "2026-06-20" }]; // t1 allerede kørt
    const supabase = makeFullMockSupabase({ teams, runs });
    const called = [];
    const runDay = async ({ teamId }) => { called.push(teamId); return { alreadyRan: false }; };
    const result = await runTrainingSweep({ supabase, now: afterWindow, runDay });
    assert.deepEqual(called, ["t2"]);
    assert.deepEqual(result, { swept: 1 });
  });

  it("alreadyRan tæller IKKE som swept", async () => {
    const teams = [{ id: "t1" }];
    const runs = []; // ingen kørsler endnu (engine vil rapportere alreadyRan)
    const supabase = makeFullMockSupabase({ teams, runs });
    const runDay = async () => ({ alreadyRan: true });
    const result = await runTrainingSweep({ supabase, now: afterWindow, runDay });
    assert.deepEqual(result, { swept: 0 });
  });

  it("ét holds fejl stopper ikke det næste hold", async () => {
    const teams = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
    const runs = [];
    const supabase = makeFullMockSupabase({ teams, runs });
    const called = [];
    const runDay = async ({ teamId }) => {
      called.push(teamId);
      if (teamId === "t2") throw new Error("riders load fejl");
      return { alreadyRan: false };
    };
    const result = await runTrainingSweep({ supabase, now: afterWindow, runDay });
    assert.deepEqual(called, ["t1", "t2", "t3"]);
    assert.equal(result.swept, 2);
    assert.equal(result.failed, 1);
  });

  it("returnerer swept uden failed-nøgle når ingen fejlede", async () => {
    const teams = [{ id: "t1" }];
    const runs = [];
    const supabase = makeFullMockSupabase({ teams, runs });
    const runDay = async () => ({ alreadyRan: false });
    const result = await runTrainingSweep({ supabase, now: afterWindow, runDay });
    assert.equal(result.swept, 1);
    assert.equal("failed" in result, false);
  });
});

// ── Query-fejl: error-objekt skal kaste, ikke blive et stille no-op ────────────
describe("runTrainingSweep query-fejl", () => {
  it("teams-query-fejl kaster (ingen stille tom sweep)", async () => {
    const afterWindow = new Date("2026-06-20T20:30:00Z"); // 22:30 CEST
    const supabase = {
      from(table) {
        const b = {
          select() { return b; },
          eq() { return b; },
          maybeSingle() { return Promise.resolve({ data: { value: true }, error: null }); },
          then(resolve) {
            if (table === "teams") {
              return Promise.resolve({ data: null, error: { message: "permission denied" } }).then(resolve);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };
        return b;
      },
    };
    await assert.rejects(
      () => runTrainingSweep({ supabase, now: afterWindow }),
      /teams: permission denied/
    );
  });
});
