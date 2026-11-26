// #8614: delte scenarier til kontakten ai_team_frozen_state_8614.
//
// Bruges af aiTeamFrozenState8614.test.js OG af golden-generatoren, der koerer SAMME scenarie mod
// en frossen kopi af merge-base-koden (#7587). Scenariet faar sweep-funktionen udefra, saa samme
// input kan koeres mod baade base og ny kode. Ingen balance-tal; kun hvem der registreres og tickes.

/** En Supabase-fake der kun svarer paa app_config-opslag (kontakterne). */
export function flagClient(values = {}) {
  const reads = [];
  return {
    reads,
    from(table) {
      let key = null;
      const chain = {
        select() { return chain; },
        eq(column, value) { if (column === "key") key = value; return chain; },
        async maybeSingle() {
          reads.push(`${table}:${key}`);
          if (table !== "app_config") return { data: null, error: { message: `unexpected table ${table}` } };
          return { data: key in values ? { value: values[key] } : null, error: null };
        },
      };
      return chain;
    },
  };
}

const DAYS = [5, 6, 7, 8, 9];

/**
 * Aftenopgørelsen for én dato med fire slags hold:
 *   h1 menneskehold i division, a1 AI-hold i division, a2 AI-hold uden division,
 *   h2 menneskehold uden division, a3 AI-hold i division med allerede registreret arbejde.
 * Returnerer hvem der blev registreret og tickede (uden klient-objekter), saa resultatet kan
 * sammenlignes bit for bit.
 */
export async function runSweepScenario({ runNormalizedTrainingDateSweep, resetCache, flags }) {
  resetCache?.();
  const supabase = flagClient(flags);
  const workRows = [{ team_id: "a3", game_days: DAYS, expected_rider_ids: ["a3r"], status: "pending", opening_conditions: { a3r: { fatigue: 0, form: 50 } } }];
  const context = {
    teams: [
      { id: "h1", league_division_id: "d1", is_ai: false },
      { id: "a1", league_division_id: "d1", is_ai: true },
      { id: "a2", league_division_id: null, is_ai: true },
      { id: "h2", league_division_id: null, is_ai: false },
      { id: "a3", league_division_id: "d1", is_ai: true },
    ],
    riders: [
      { id: "h1r", team_id: "h1" }, { id: "a1r", team_id: "a1" }, { id: "a2r", team_id: "a2" },
      { id: "h2r", team_id: "h2" }, { id: "a3r", team_id: "a3" },
    ],
    races: [], stages: [], runs: [], entries: [], results: [], incidents: [], loads: [],
    gameDaysByDivision: new Map([["d1", DAYS]]),
  };
  const registers = [];
  const ticks = [];
  const summary = await runNormalizedTrainingDateSweep({
    supabase,
    now: new Date("2026-11-20T21:00:00Z"),
    elapsedClock: () => 0,
    loadIndex: async () => ({ today: "2026-11-20", jobs: [{ tickDate: "2026-11-20", season: { id: "s", number: 6 } }] }),
    loadContext: async () => context,
    loadWorkRows: async () => workRows,
    registerWork: async ({ teamId, gameDays, riderIds }) => {
      registers.push({ teamId, gameDays, riderIds });
      const row = { team_id: teamId, game_days: gameDays, expected_rider_ids: riderIds, status: "pending",
        opening_conditions: Object.fromEntries(riderIds.map((id) => [id, { fatigue: 0, form: 50 }])) };
      workRows.push(row);
      return row;
    },
    loadLegacyRuns: async () => new Set(),
    loadSweepMemory: async () => false,
    refreshRankings: async () => {},
    dispatchAlarms: async () => ({ dates: 0, failed: 0 }),
    admitRiders: async () => null,
    loadJoinedRiders: async () => [],
    runDay: async (args) => {
      ticks.push({ teamId: args.teamId, gameDay: args.gameDay, eligible: args.eligibleRiderIds ?? null });
      return { alreadyRan: false };
    },
  });
  const { durationMs: _ignored, ...stableSummary } = summary;
  return { registers, ticks, summary: stableSummary, flagReads: supabase.reads };
}
