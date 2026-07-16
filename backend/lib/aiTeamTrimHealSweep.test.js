import test from "node:test";
import assert from "node:assert/strict";

import { runAiTeamTrimHealSweep, STALE_BACKSTOP_HOURS } from "./aiTeamTrimHealSweep.js";

// Multi-tabel in-memory mock (#2407): sweep'en læser nu BÅDE teams (kandidater +
// pulje-felter til trim-budgettet) OG league_divisions (tier), og rydder forældede
// markører via update. Modellerer kun det sweep'en rører.
function dbMock(state) {
  function from(table) {
    const rows = () => state[table] || [];
    const filters = [];
    const matches = (row) => filters.every((f) => {
      if (f.t === "eq") return row[f.c] === f.v;
      if (f.t === "in") return f.v.includes(row[f.c]);
      if (f.t === "is") return f.v === null ? row[f.c] == null : row[f.c] === f.v;
      if (f.t === "not-is-null") return row[f.c] != null;
      return true;
    });
    const b = {
      select() { return b; },
      eq(c, v) { filters.push({ t: "eq", c, v }); return b; },
      in(c, v) { filters.push({ t: "in", c, v }); return b; },
      is(c, v) { filters.push({ t: "is", c, v }); return b; },
      not(c, op, v) { if (op === "is" && v === null) filters.push({ t: "not-is-null", c }); return b; },
      order() { return b; },
      range(from) {
        const data = from === 0 ? rows().filter(matches) : [];
        return Promise.resolve({ data, error: null });
      },
      update(payload) {
        const u = {
          eq(c, v) { filters.push({ t: "eq", c, v }); return u; },
          is(c, v) { filters.push({ t: "is", c, v }); return u; },
          then(res, rej) {
            for (const row of rows()) if (matches(row)) Object.assign(row, payload);
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          },
        };
        return u;
      },
      then(res, rej) {
        return Promise.resolve({ data: rows().filter(matches), error: null }).then(res, rej);
      },
    };
    return b;
  }
  return { from, state };
}

// Bagudkompatibel helper for de eksisterende tests: kandidat-rækkerne ER pulje-
// felterne, og puljerne får tier 4 uden ægte managere → targetAi = 0 → alt AI er
// overskud → trim-budgettet blokerer aldrig (matcher præ-#2407-semantikken hvor
// testene alene handlede om blokerings-/stale-logik).
function teamsMock(rows, pools) {
  const poolIds = [...new Set(rows.map((r) => r.league_division_id))];
  const league_divisions = pools ?? poolIds.map((id) => ({ id, tier: 4 }));
  return dbMock({ teams: rows.map((r) => ({ ...r })), league_divisions });
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

// ── #2407 Fejl 2 · sweep'en må ALDRIG bringe en pulje under target. Prod 12-15/7:
// removeAiTeams over-markerede hele puljen (65 hold, kun 5 reelt overskud), og
// sweep'en slettede hvert markeret hold så snart det blev ublokeret — uden
// størrelses-check ville pulje 9/10/11 være tømt mod 4/4/4. Fixet: pr.-pulje
// trim-budget (aiCount - targetAi); budget 0 → forældet markør RYDDES i stedet
// for at slette (kaskade-bremse + selv-heling af over-markering). ────────────────

// Pulje på præcis target: tier 4, 1 ægte manager + 23 AI → targetAi = 23 → budget 0.
function poolAtTarget(nMarked, now) {
  const teams = [
    { id: "mgr-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: "pool-9" },
  ];
  for (let i = 0; i < 23; i++) {
    teams.push({
      id: `ai-${String(i).padStart(2, "0")}`,
      name: `AI ${i}`,
      is_ai: true,
      league_division_id: "pool-9",
      pending_removal_at: i < nMarked ? hoursAgo(now, 10 - i) : null,
    });
  }
  return teams;
}

test("#2407 Fejl 2: pulje på target → intet slettes, forældede markører ryddes (kaskade-bremsen)", async () => {
  const now = new Date("2026-07-16T12:00:00Z");
  const supabase = dbMock({
    teams: poolAtTarget(5, now),
    league_divisions: [{ id: "pool-9", tier: 4 }],
  });
  const removed = [];
  const res = await runAiTeamTrimHealSweep({
    supabase,
    now,
    teamBlockingRaceIds: async () => [], // ALT er ublokeret — præcis kaskade-scenariet
    getStalledIds: async () => [],
    hasUnpaidPrizes: async () => false,
    removeTeam: async (_sb, id) => { removed.push(id); },
    getInflightIds: async () => [],
  });

  assert.deepEqual(removed, [], "puljen er på target → INGEN sletning uanset markeringer");
  assert.equal(res.healed, 0);
  assert.equal(res.cleared, 5, "alle 5 forældede markører ryddes (selv-heling af over-markering)");
  const stillMarked = supabase.state.teams.filter((t) => t.pending_removal_at != null);
  assert.deepEqual(stillMarked, [], "pending_removal_at er nulstillet i DB");
  assert.ok(res.guard.every((g) => g.reason === "pool_at_or_below_target"), "guard-events forklarer rydningen");
});

test("#2407 Fejl 2: kun det reelle overskud slettes — budgettet stopper sweep'en ved target", async () => {
  const now = new Date("2026-07-16T12:00:00Z");
  // Prod-pulje 9-scenariet: 1 manager + 26 AI = 27 hold, targetAi 23 → overskud 3.
  const teams = [
    { id: "mgr-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: "pool-9" },
  ];
  for (let i = 0; i < 26; i++) {
    teams.push({
      id: `ai-${String(i).padStart(2, "0")}`,
      name: `AI ${i}`,
      is_ai: true,
      league_division_id: "pool-9",
      // 5 markerede; ældst først (i=0 er ældst) så sletnings-ordenen er deterministisk.
      pending_removal_at: i < 5 ? hoursAgo(now, 10 - i) : null,
    });
  }
  const supabase = dbMock({ teams, league_divisions: [{ id: "pool-9", tier: 4 }] });
  const removed = [];
  const res = await runAiTeamTrimHealSweep({
    supabase,
    now,
    teamBlockingRaceIds: async () => [],
    getStalledIds: async () => [],
    hasUnpaidPrizes: async () => false,
    // Spejl deleteAiTeamById: sletningen fjerner holdet (og dermed markøren) fra DB.
    removeTeam: async (_sb, id) => {
      removed.push(id);
      supabase.state.teams = supabase.state.teams.filter((t) => t.id !== id);
    },
    getInflightIds: async () => [],
  });

  assert.equal(res.healed, 3, "præcis overskuddet (3) slettes — ikke alle 5 markerede");
  assert.deepEqual(removed, ["ai-00", "ai-01", "ai-02"], "ældste markeringer først");
  assert.equal(res.cleared, 2, "de 2 resterende markører ryddes (puljen er nu på target)");
  const stillMarked = supabase.state.teams.filter((t) => t.pending_removal_at != null);
  assert.deepEqual(stillMarked, [], "ingen markører tilbage");
});

test("#2407 Fejl 2: blokeret hold bruger IKKE budget — markøren består til næste sweep", async () => {
  const now = new Date("2026-07-16T12:00:00Z");
  // Overskud 1: 1 manager + 24 AI = 25 hold, targetAi 23 → budget 1.
  const teams = [
    { id: "mgr-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: "pool-9" },
  ];
  for (let i = 0; i < 24; i++) {
    teams.push({
      id: `ai-${String(i).padStart(2, "0")}`,
      name: `AI ${i}`,
      is_ai: true,
      league_division_id: "pool-9",
      pending_removal_at: i < 2 ? hoursAgo(now, 10 - i) : null, // ai-00 (ældst) + ai-01
    });
  }
  const supabase = dbMock({ teams, league_divisions: [{ id: "pool-9", tier: 4 }] });
  const removed = [];
  const res = await runAiTeamTrimHealSweep({
    supabase,
    now,
    teamBlockingRaceIds: async (_sb, id) => (id === "ai-00" ? ["race-running"] : []),
    getStalledIds: async () => [],
    hasUnpaidPrizes: async () => false,
    removeTeam: async (_sb, id) => { removed.push(id); },
    getInflightIds: async () => ["race-running"],
  });

  assert.deepEqual(removed, ["ai-01"], "det ublokerede hold slettes inden for budgettet");
  assert.equal(res.healed, 1);
  assert.equal(res.cleared, 0, "det blokerede holds markør ryddes IKKE (puljen er stadig over target)");
  const blockedTeam = supabase.state.teams.find((t) => t.id === "ai-00");
  assert.ok(blockedTeam.pending_removal_at, "blokeret hold beholder markøren til næste sweep");
});

test("#2407 Fejl 2: ukendt pulje → fail-closed (ingen sletning, markør bevares, guard-event)", async () => {
  const now = new Date("2026-07-16T12:00:00Z");
  const supabase = dbMock({
    teams: [
      { id: "ai-lost", name: "AI Lost", is_ai: true, league_division_id: "pool-deleted", pending_removal_at: hoursAgo(now, 5) },
    ],
    league_divisions: [], // puljen findes ikke længere
  });
  const res = await runAiTeamTrimHealSweep({
    supabase,
    now,
    teamBlockingRaceIds: async () => [],
    getStalledIds: async () => [],
    hasUnpaidPrizes: async () => false,
    removeTeam: async () => { throw new Error("må ikke kaldes"); },
    getInflightIds: async () => [],
  });

  assert.equal(res.healed, 0, "uden pulje-kontekst slettes INTET (fail-closed)");
  assert.equal(res.cleared, 0, "markøren ryddes heller ikke (vi ved ikke om den er forældet)");
  assert.equal(res.guard.length, 1);
  assert.equal(res.guard[0].reason, "pool_unknown");
  const team = supabase.state.teams.find((t) => t.id === "ai-lost");
  assert.ok(team.pending_removal_at, "markøren består");
});
