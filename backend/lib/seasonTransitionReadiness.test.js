import test from "node:test";
import assert from "node:assert/strict";

import { assessSeasonEndBlockers, assessTransitionReadiness } from "./seasonTransitionReadiness.js";

// ─── Mock Supabase ────────────────────────────────────────────────────────────
// Dækker præcis de fire queries assessTransitionReadiness laver:
//   transfer_windows: select().eq().order().limit().maybeSingle()
//   auctions:         select(_, {count,head}).in()  → thenable {count}
//   races:            select(_, {count,head}).eq().neq() → thenable {count}
//   seasons:          select().eq().maybeSingle() (#2361: season_end_completed)

function createMockSupabase({
  win = null,
  activeAuctionCount = 0,
  unfinishedRaceCount = 0,
  // #2361: default = sæson 1, status completed → season_end_completed er ok
  // som default, så eksisterende tests (der ikke handler om dette check)
  // fortsat udtrykker deres oprindelige "ready"/"blocked af X"-forventning.
  seasonNumber = 1,
  seasonStatus = "completed",
  seasonMissing = false,
} = {}) {
  const thenableCount = (count) => ({
    then: (resolve) => resolve({ data: null, count, error: null }),
  });
  return {
    from(table) {
      if (table === "transfer_windows") {
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: win, error: null }),
        };
        return { select: () => chain };
      }
      if (table === "auctions") {
        return { select: () => ({ in: () => thenableCount(activeAuctionCount) }) };
      }
      if (table === "races") {
        const chain = { eq: () => chain, neq: () => thenableCount(unfinishedRaceCount) };
        return { select: () => chain };
      }
      if (table === "seasons") {
        const chain = {
          eq: () => chain,
          maybeSingle: () => Promise.resolve({
            data: seasonMissing ? null : { id: FROM_SEASON_ID, number: seasonNumber, status: seasonStatus },
            error: null,
          }),
        };
        return { select: () => chain };
      }
      throw new Error(`Uventet tabel i mock: ${table}`);
    },
  };
}

const WRAPPED_WINDOW = {
  id: "w-1",
  status: "closed",
  closed_at: "2026-06-10T18:00:00Z",
  final_whistle_sent_at: "2026-06-10T18:05:00Z",
  squad_enforcement_completed_at: "2026-06-10T18:10:00Z",
};

const FROM_SEASON_ID = "00000000-0000-0000-0000-000000000001";

test("assessTransitionReadiness — wrapped vindue + 0 auktioner + 0 uafviklede løb = ready", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, true);
  assert.deepEqual(result.failed_critical, []);
  for (const [key, check] of Object.entries(result.checks)) {
    assert.equal(check.ok, true, `check '${key}' skulle være ok`);
    assert.equal(check.critical, true, `check '${key}' skal være kritisk`);
  }
  assert.deepEqual(
    Object.keys(result.checks).sort(),
    [
      "all_races_completed",
      "final_whistle_sent",
      "no_active_auctions",
      "season_end_completed",
      "squad_enforcement_completed",
      "window_closed",
    ],
  );
});

// ============================================================
// #2361 — season_end_completed: transition på en stadig-AKTIV sæson
// springer op/nedrykning + divisionsbonusser irreversibelt over.
// ============================================================

test("assessTransitionReadiness — sæson 1 stadig 'active' (season-end ikke kørt) blokerer", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, seasonNumber: 1, seasonStatus: "active" });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.season_end_completed.ok, false);
  assert.ok(result.failed_critical.includes("season_end_completed"));
  assert.match(result.checks.season_end_completed.detail, /Afslut sæson/);
});

test("assessTransitionReadiness — sæson 1 'completed' (season-end kørt) er ok", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, seasonNumber: 1, seasonStatus: "completed" });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.checks.season_end_completed.ok, true);
  assert.equal(result.checks.season_end_completed.detail, null);
});

test("assessTransitionReadiness — sæson 0 er N/A for season_end_completed selv med status='active'", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, seasonNumber: 0, seasonStatus: "active" });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.checks.season_end_completed.ok, true, "sæson 0 har intet season-end-skridt at vente på");
});

test("assessTransitionReadiness — resume-sti (#578): completed sæson 2+ er stadig ok for season_end_completed", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, seasonNumber: 2, seasonStatus: "completed" });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.checks.season_end_completed.ok, true);
});

test("assessTransitionReadiness — manglende sæson-row kaster", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, seasonMissing: true });
  await assert.rejects(
    () => assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID }),
    /findes ikke/,
  );
});

test("assessTransitionReadiness — query-fejl på sæson kaster (fail-closed)", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW });
  const broken = {
    from(table) {
      if (table === "seasons") {
        const chain = {
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        };
        return { select: () => chain };
      }
      return supabase.from(table);
    },
  };
  await assert.rejects(
    () => assessTransitionReadiness({ supabase: broken, fromSeasonId: FROM_SEASON_ID }),
    /Kunne ikke læse sæson/,
  );
});

test("assessTransitionReadiness — åbent vindue blokerer (window_closed=false)", async () => {
  const supabase = createMockSupabase({
    win: { id: "w-2", status: "open", closed_at: null, final_whistle_sent_at: null, squad_enforcement_completed_at: null },
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.window_closed.ok, false);
  assert.ok(result.failed_critical.includes("window_closed"));
});

test("assessTransitionReadiness — racing-window (closed men closed_at=null) blokerer", async () => {
  const supabase = createMockSupabase({
    win: { id: "w-3", status: "closed", closed_at: null, final_whistle_sent_at: null, squad_enforcement_completed_at: null },
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.window_closed.ok, false, "racing-window må ikke tælle som lukket deadline-vindue");
});

test("assessTransitionReadiness — manglende final whistle blokerer", async () => {
  const supabase = createMockSupabase({
    win: { ...WRAPPED_WINDOW, final_whistle_sent_at: null },
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.window_closed.ok, true);
  assert.equal(result.checks.final_whistle_sent.ok, false);
});

test("assessTransitionReadiness — manglende squad enforcement blokerer", async () => {
  const supabase = createMockSupabase({
    win: { ...WRAPPED_WINDOW, squad_enforcement_completed_at: null },
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.squad_enforcement_completed.ok, false);
});

test("assessTransitionReadiness — aktive auktioner blokerer med antal i detail", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, activeAuctionCount: 2 });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.no_active_auctions.ok, false);
  assert.match(result.checks.no_active_auctions.detail, /2/);
});

test("assessTransitionReadiness — uafviklede løb blokerer med antal i detail", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, unfinishedRaceCount: 3 });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.all_races_completed.ok, false);
  assert.match(result.checks.all_races_completed.detail, /3/);
});

test("assessTransitionReadiness — intet vindue overhovedet blokerer", async () => {
  const supabase = createMockSupabase({ win: null });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.window_closed.ok, false);
  assert.equal(result.checks.final_whistle_sent.ok, false);
  assert.equal(result.checks.squad_enforcement_completed.ok, false);
});

test("assessTransitionReadiness — kræver supabase og fromSeasonId", async () => {
  await assert.rejects(() => assessTransitionReadiness({ supabase: null, fromSeasonId: FROM_SEASON_ID }));
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW });
  await assert.rejects(() => assessTransitionReadiness({ supabase, fromSeasonId: null }));
});

test("assessTransitionReadiness — query-fejl på vinduet kaster (fail-closed, aldrig ready)", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW });
  const broken = {
    from(table) {
      if (table === "transfer_windows") {
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        };
        return { select: () => chain };
      }
      return supabase.from(table);
    },
  };
  await assert.rejects(
    () => assessTransitionReadiness({ supabase: broken, fromSeasonId: FROM_SEASON_ID }),
    /Kunne ikke læse transfervindue/,
  );
});

test("assessTransitionReadiness — query-fejl på auktions-count kaster (fail-closed)", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW });
  const broken = {
    from(table) {
      if (table === "auctions") {
        return {
          select: () => ({
            in: () => ({ then: (resolve) => resolve({ data: null, count: null, error: { message: "boom" } }) }),
          }),
        };
      }
      return supabase.from(table);
    },
  };
  await assert.rejects(
    () => assessTransitionReadiness({ supabase: broken, fromSeasonId: FROM_SEASON_ID }),
    /Kunne ikke tælle auktioner/,
  );
});

// ============================================================
// #2805 — assessSeasonEndBlockers: spærre for "Afslut sæson"
// mod uafviklede løb. pending_race_results fanger kun løb der
// VENTER på behandling — et løb der aldrig startede har ingen
// række der og passerede tavst før denne spærre.
// ============================================================

// unfinishedRaces: array af {id, league_division_id} — league_division_id=null
// (default via genUnfinishedRaces) svarer til "ikke pulje-relateret" og blokerer
// altid, uanset teamPools (matcher den gamle count-only-adfærd).
// teamPools: array af {league_division_id} — én række pr. hold. Default = ét
// hold i "d1" (pool-filter aktivt, men rammer ingen af default-løbene).
function genUnfinishedRaces(n, leagueDivisionId = null) {
  return Array.from({ length: n }, (_, i) => ({ id: `race-${i}`, league_division_id: leagueDivisionId }));
}

function createSeasonEndMock({
  unfinishedRaces = [],
  teamPools = [{ league_division_id: "d1" }],
  lastStageAt = null,
  racesError = null,
  teamsError = null,
  stageError = null,
} = {}) {
  return {
    from(table) {
      if (table === "races") {
        const chain = {
          eq: () => chain,
          neq: () => ({ then: (resolve) => resolve({ data: racesError ? null : unfinishedRaces, error: racesError }) }),
        };
        return { select: () => chain };
      }
      if (table === "teams") {
        return {
          select: () => ({ then: (resolve) => resolve({ data: teamsError ? null : teamPools, error: teamsError }) }),
        };
      }
      if (table === "race_stage_schedule") {
        const chain = {
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({
            data: stageError ? null : (lastStageAt ? { scheduled_at: lastStageAt } : null),
            error: stageError,
          }),
        };
        return { select: () => chain };
      }
      throw new Error(`Uventet tabel i season-end-mock: ${table}`);
    },
  };
}

test("assessSeasonEndBlockers — 0 uafviklede løb = ikke blokeret (sæson 0 / færdigkørt sæson)", async () => {
  const supabase = createSeasonEndMock({ unfinishedRaces: [] });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, false);
  assert.equal(result.unfinished_races, 0);
  assert.equal(result.detail, null);
});

test("assessSeasonEndBlockers — uafviklede løb blokerer med antal + sidste etape-dato", async () => {
  const supabase = createSeasonEndMock({
    unfinishedRaces: genUnfinishedRaces(76),
    lastStageAt: "2026-07-26T17:00:00+00:00",
  });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, true);
  assert.equal(result.unfinished_races, 76);
  assert.equal(result.last_unfinished_stage_at, "2026-07-26T17:00:00+00:00");
  assert.match(result.detail, /76 løb er ikke afviklet/);
  assert.match(result.detail, /2026-07-26T17:00:00/);
});

test("assessSeasonEndBlockers — uafviklet løb UDEN schedule-rækker blokerer stadig (dato udelades)", async () => {
  const supabase = createSeasonEndMock({ unfinishedRaces: genUnfinishedRaces(3), lastStageAt: null });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, true);
  assert.equal(result.last_unfinished_stage_at, null);
  assert.match(result.detail, /3 løb er ikke afviklet/);
  assert.doesNotMatch(result.detail, /planlagt til/);
});

test("assessSeasonEndBlockers — query-fejl på races-count kaster (fail-closed)", async () => {
  const supabase = createSeasonEndMock({ racesError: { message: "boom" } });
  await assert.rejects(
    () => assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID }),
    /Kunne ikke tælle uafviklede løb/,
  );
});

test("assessSeasonEndBlockers — query-fejl på puljer (teams) kaster (fail-closed)", async () => {
  const supabase = createSeasonEndMock({ unfinishedRaces: genUnfinishedRaces(2), teamsError: { message: "boom" } });
  await assert.rejects(
    () => assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID }),
    /Kunne ikke læse puljer/,
  );
});

test("assessSeasonEndBlockers — query-fejl på etape-lookup kaster (fail-closed)", async () => {
  const supabase = createSeasonEndMock({ unfinishedRaces: genUnfinishedRaces(5), stageError: { message: "boom" } });
  await assert.rejects(
    () => assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID }),
    /Kunne ikke finde sidste uafviklede etape/,
  );
});

test("assessSeasonEndBlockers — kræver supabase + seasonId", async () => {
  await assert.rejects(() => assessSeasonEndBlockers({ seasonId: FROM_SEASON_ID }), /Supabase client required/);
  await assert.rejects(() => assessSeasonEndBlockers({ supabase: createSeasonEndMock() }), /seasonId required/);
});

// ============================================================
// #3038 — empty-pool-undtagelse: dormant-pulje-løb (#2851-reconcilen tømte
// D4 C-H for legacy-AI) må IKKE tælle som season-end-blocker, men løb i
// puljer der stadig har hold skal fortsat blokere. Samme diskriminator som
// stageScheduler.js's "inEmptyPool" (P0 2/7-filteret).
// ============================================================

test("assessSeasonEndBlockers — uafviklet løb i TOM pulje (D4 C-H, 0 hold) tælles IKKE som blocker", async () => {
  const supabase = createSeasonEndMock({
    unfinishedRaces: genUnfinishedRaces(143, "d4-pool-c"),
    teamPools: [{ league_division_id: "d4-pool-a" }, { league_division_id: "d1" }], // ingen hold i d4-pool-c
  });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, false, "dormant-pulje-løb må ikke blokere 'Afslut sæson'");
  assert.equal(result.unfinished_races, 0);
});

test("assessSeasonEndBlockers — uafviklet løb i AKTIV pulje (hold findes) blokerer stadig", async () => {
  const supabase = createSeasonEndMock({
    unfinishedRaces: genUnfinishedRaces(2, "d4-pool-a"),
    teamPools: [{ league_division_id: "d4-pool-a" }, { league_division_id: "d4-pool-a" }],
    lastStageAt: "2026-08-10T12:00:00+00:00",
  });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, true, "løb i en pulje med hold skal stadig blokere");
  assert.equal(result.unfinished_races, 2);
  assert.match(result.detail, /2 løb er ikke afviklet/);
});

test("assessSeasonEndBlockers — blandet: dormant-pulje-løb undtages, aktive løb tælles", async () => {
  const supabase = createSeasonEndMock({
    unfinishedRaces: [
      ...genUnfinishedRaces(143, "d4-pool-c"), // dormant, ingen hold
      ...genUnfinishedRaces(1, "d1"), // aktiv pulje, har hold
    ],
    teamPools: [{ league_division_id: "d1" }],
  });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, true);
  assert.equal(result.unfinished_races, 1, "kun løbet i den aktive pulje skal tælles");
});

test("assessSeasonEndBlockers — fail-open: tom teams-tabel (0 hold overhovedet) deaktiverer pool-filteret", async () => {
  const supabase = createSeasonEndMock({
    unfinishedRaces: genUnfinishedRaces(4, "d4-pool-c"),
    teamPools: [],
  });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, true, "tom teams-tabel (mock/test-DB) skal fail-open, ikke undtage alle løb");
  assert.equal(result.unfinished_races, 4);
});
