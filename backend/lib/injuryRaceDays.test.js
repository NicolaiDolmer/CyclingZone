// #5462 — skadesvarighed paa LOEBSDAGS-aksen. Ren matematik + kalenderopslaget.
import test from "node:test";
import assert from "node:assert/strict";

import {
  injuryEndGameDay, injuryRaceDaysLeft, isInjuredOnRaceDay, resolveInjuryEndDates,
  loadTeamDivisionId,
} from "./injuryRaceDays.js";

const SEASON_ID = "season-1";

// ── injuryEndGameDay ─────────────────────────────────────────────────────────

test("injuryEndGameDay: samme aritmetik som kalenderstien — loebsdag + N", () => {
  assert.equal(injuryEndGameDay({ gameDay: 12, days: 3 }), 15);
  assert.equal(injuryEndGameDay({ gameDay: 0, days: 1 }), 1);
});

test("injuryEndGameDay: uden en brugbar akse eller varighed → null (kald-stedet falder tilbage)", () => {
  assert.equal(injuryEndGameDay({ gameDay: null, days: 3 }), null);
  assert.equal(injuryEndGameDay({ gameDay: -1, days: 3 }), null, "negativ loebsdag findes ikke");
  assert.equal(injuryEndGameDay({ gameDay: 1.5, days: 3 }), null, "loebsdage er hele tal");
  assert.equal(injuryEndGameDay({ gameDay: 12, days: 0 }), null);
  assert.equal(injuryEndGameDay({}), null);
});

// ── injuryRaceDaysLeft ───────────────────────────────────────────────────────

test("injuryRaceDaysLeft: tæller INKLUSIV den indevaerende loebsdag (#1672-semantikken)", () => {
  // Skadet paa loebsdag 12 i 3 loebsdage ⇒ slut = 15.
  const endGameDay = injuryEndGameDay({ gameDay: 12, days: 3 });
  assert.equal(injuryRaceDaysLeft({ endGameDay, currentGameDay: 12 }), 4);
  assert.equal(injuryRaceDaysLeft({ endGameDay, currentGameDay: 13 }), 3);
  assert.equal(injuryRaceDaysLeft({ endGameDay, currentGameDay: 15 }), 1, "sidste skadede loebsdag = 1, ikke 0");
  assert.equal(injuryRaceDaysLeft({ endGameDay, currentGameDay: 16 }), 0, "rask loebsdagen efter");
});

test("injuryRaceDaysLeft: manglende tal giver 0, aldrig NaN", () => {
  assert.equal(injuryRaceDaysLeft({ endGameDay: null, currentGameDay: 3 }), 0);
  assert.equal(injuryRaceDaysLeft({ endGameDay: 5, currentGameDay: null }), 0);
  assert.equal(injuryRaceDaysLeft({}), 0);
});

// ── isInjuredOnRaceDay ───────────────────────────────────────────────────────

test("isInjuredOnRaceDay: loebsdagen vinder naar den findes og saesonen passer", () => {
  const cond = { injured_until: "2026-06-30", injury_end_game_day: 15, injury_season_id: SEASON_ID };
  assert.equal(isInjuredOnRaceDay({ condition: cond, seasonId: SEASON_ID, gameDay: 15, tickDate: "2026-06-12" }), true);
  assert.equal(
    isInjuredOnRaceDay({ condition: cond, seasonId: SEASON_ID, gameDay: 16, tickDate: "2026-06-12" }),
    false,
    "rask paa loebsdag 16 selv om datoen stadig ligger i fremtiden — det er hele beslutningen",
  );
});

test("isInjuredOnRaceDay: uden loebsdags-felter falder den tilbage til dato-sammenligningen (overgangs-reglen)", () => {
  const gammel = { injured_until: "2026-06-15", injury_end_game_day: null, injury_season_id: null };
  assert.equal(isInjuredOnRaceDay({ condition: gammel, seasonId: SEASON_ID, gameDay: 99, tickDate: "2026-06-12" }), true);
  assert.equal(isInjuredOnRaceDay({ condition: gammel, seasonId: SEASON_ID, gameDay: 99, tickDate: "2026-06-16" }), false);
});

test("isInjuredOnRaceDay: en loebsdag fra en ANDEN saeson bruges aldrig — datoen svarer i stedet", () => {
  const cond = { injured_until: "2026-06-15", injury_end_game_day: 3, injury_season_id: "season-0" };
  assert.equal(
    isInjuredOnRaceDay({ condition: cond, seasonId: SEASON_ID, gameDay: 99, tickDate: "2026-06-12" }),
    true,
    "game_day nulstilles hver saeson; en akse fra i fjor maa ikke raskmelde en skade",
  );
});

test("isInjuredOnRaceDay: ingen skade → false", () => {
  assert.equal(isInjuredOnRaceDay({ condition: null, seasonId: SEASON_ID, gameDay: 1, tickDate: "2026-06-12" }), false);
  assert.equal(isInjuredOnRaceDay({ condition: {}, seasonId: SEASON_ID, gameDay: 1, tickDate: "2026-06-12" }), false);
});

// ── resolveInjuryEndDates ────────────────────────────────────────────────────

// Minimal PostgREST-agtig mock: kun de kald resolveInjuryEndDates faktisk bruger.
function mockSupabase({ races = [], stages = [], racesError = null, stagesError = null, throwOn = null } = {}) {
  return {
    from(table) {
      if (throwOn === table) throw new Error("boom");
      const q = {
        _gte: null,
        select() { return q; },
        eq() { return q; },
        in() { return q; },
        gte(_col, val) { q._gte = Number(val); return q; },
        order() { return q; },
        maybeSingle: async () => ({ data: races[0] ?? null, error: racesError }),
        then(resolve) {
          if (table === "races") return resolve({ data: races, error: racesError });
          const rows = stages
            .filter((s) => (q._gte == null ? true : Number(s.game_day) >= q._gte))
            .slice()
            .sort((a, b) => a.game_day - b.game_day || String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
          return resolve({ data: rows, error: stagesError });
        },
      };
      return q;
    },
  };
}

const STAGES = [
  { game_day: 12, scheduled_at: "2026-06-12T09:00:00Z" },
  { game_day: 12, scheduled_at: "2026-06-12T15:00:00Z" },
  { game_day: 14, scheduled_at: "2026-06-12T19:00:00Z" },
  { game_day: 17, scheduled_at: "2026-06-13T11:00:00Z" },
];

test("resolveInjuryEndDates: slaar datoen op paa den lagrede loebsdag (aldrig udledt af scheduled_at)", async () => {
  const supabase = mockSupabase({ races: [{ id: "race-1" }], stages: STAGES });
  const map = await resolveInjuryEndDates({ supabase, seasonId: SEASON_ID, divisionId: 1, endGameDays: [14] });
  assert.equal(map.get(14), "2026-06-12", "loebsdag 14 ligger sent paa den 12. — samme kalenderdato som loebsdag 12");
});

test("resolveInjuryEndDates: en TOM loebsdag runder OP til naeste loebsdag med en etape (aldrig ned)", async () => {
  const supabase = mockSupabase({ races: [{ id: "race-1" }], stages: STAGES });
  const map = await resolveInjuryEndDates({ supabase, seasonId: SEASON_ID, divisionId: 1, endGameDays: [15] });
  assert.equal(
    map.get(15), "2026-06-13",
    "loebsdag 15 og 16 er rene traeningsdage uden raekke; 17 er den foerste med en etape — konservativ retning",
  );
});

test("resolveInjuryEndDates: flere slut-loebsdage besvares i ÉT opslag", async () => {
  const supabase = mockSupabase({ races: [{ id: "race-1" }], stages: STAGES });
  const map = await resolveInjuryEndDates({ supabase, seasonId: SEASON_ID, divisionId: 1, endGameDays: [12, 14, 17] });
  assert.equal(map.get(12), "2026-06-12");
  assert.equal(map.get(14), "2026-06-12");
  assert.equal(map.get(17), "2026-06-13");
});

test("resolveInjuryEndDates: loebsdag efter sidste etape → null (kald-stedet beholder kalenderdags-fallbacken)", async () => {
  const supabase = mockSupabase({ races: [{ id: "race-1" }], stages: STAGES });
  const map = await resolveInjuryEndDates({ supabase, seasonId: SEASON_ID, divisionId: 1, endGameDays: [99] });
  assert.equal(map.get(99), null);
});

test("resolveInjuryEndDates: fail-safe — DB-fejl, kast, manglende division og tom kalender giver alle null", async () => {
  const cases = [
    mockSupabase({ races: [{ id: "race-1" }], stages: STAGES, stagesError: { message: "nope" } }),
    mockSupabase({ racesError: { message: "nope" } }),
    mockSupabase({ races: [], stages: [] }),
    mockSupabase({ races: [{ id: "race-1" }], stages: STAGES, throwOn: "race_stage_schedule" }),
  ];
  for (const supabase of cases) {
    const map = await resolveInjuryEndDates({ supabase, seasonId: SEASON_ID, divisionId: 1, endGameDays: [14] });
    assert.equal(map.get(14), null);
  }
  const udenDivision = await resolveInjuryEndDates({
    supabase: mockSupabase({ races: [{ id: "race-1" }], stages: STAGES }),
    seasonId: SEASON_ID, divisionId: null, endGameDays: [14],
  });
  assert.equal(udenDivision.get(14), null, "de 4 AI-hold uden division har ingen akse — et defineret svar, ikke et kast");
});

test("loadTeamDivisionId: fail-safe null ved fejl og ved manglende hold", async () => {
  assert.equal(await loadTeamDivisionId({ supabase: null, teamId: "t1" }), null);
  assert.equal(await loadTeamDivisionId({ supabase: mockSupabase({ races: [] }), teamId: null }), null);
  assert.equal(
    await loadTeamDivisionId({ supabase: mockSupabase({ races: [{ league_division_id: 3 }] }), teamId: "t1" }),
    3,
  );
});
