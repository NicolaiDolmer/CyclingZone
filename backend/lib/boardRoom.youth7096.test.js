import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBoardRoomPayload,
  deriveMemberMood,
  deriveYouthResultMoodEvents,
  isYouthFocusedArchetype,
  loadYouthRaceResultsForBoard,
  YOUTH_PODIUM_MAX_RANK,
  YOUTH_RESULT_TYPES,
  YOUTH_JERSEY_TYPES,
} from "./boardRoom.js";
import {
  YOUTH_RESULT_SOURCE,
  YOUTH_TUNING_ENV,
  parseYouthMoodTuning,
  readYouthMoodTuning,
} from "./boardYouthEvaluation.js";

// #7096 · Ejer 23/10: U23-/juniorresultater tæller i bestyrelsens vurdering af
// ungdomsarbejdet (de ungdomsfokuserede medlemmers stemning), aldrig i
// seniormålene. Alle tider er faste strenge (hard rule 16: intet vægur).
// Design-go 24/10 (mulighed A): ét nik pr. løb, større plus ved sejr/slut-trøje,
// loft for ungdomsandelen i vinduet. De rigtige tal er private (regel 17); alle
// tal her er SYNTETISKE og siger intet om live-tuningen.

const TEAM_ID = "team-youth";
const TUNING = Object.freeze({ podiumWeight: 2, winWeight: 5, windowCap: 2 });

const MEMBERS = [
  { team_id: TEAM_ID, archetype_key: "talentspejderen", selection_kind: "identity", alignment_score: 3, is_chairman: true },
  { team_id: TEAM_ID, archetype_key: "ungdomsidealisten", selection_kind: "identity", alignment_score: 2, is_chairman: false },
  { team_id: TEAM_ID, archetype_key: "pragmatikeren", selection_kind: "wildcard", alignment_score: 1, is_chairman: false },
  { team_id: TEAM_ID, archetype_key: "resultatjaegeren", selection_kind: "wildcard", alignment_score: 1, is_chairman: false },
];

function row({ raceId, resultType = "stage", rank = 1, at, squad = "u23" }) {
  return { race_id: raceId, result_type: resultType, rank, imported_at: at, races: { squad, season_id: "s3" } };
}

test("isYouthFocusedArchetype: kun arketyper med youth_focus high", () => {
  assert.equal(isYouthFocusedArchetype("talentspejderen"), true);
  assert.equal(isYouthFocusedArchetype("ungdomsidealisten"), true);
  assert.equal(isYouthFocusedArchetype("pragmatikeren"), false);
  assert.equal(isYouthFocusedArchetype("resultatjaegeren"), false);
  assert.equal(isYouthFocusedArchetype("findes_ikke"), false);
  assert.equal(isYouthFocusedArchetype(null), false);
});

test("resultat-typer og podie-grænse er etape + samlet, top 3", () => {
  assert.deepEqual([...YOUTH_RESULT_TYPES], ["stage", "gc"]);
  assert.equal(YOUTH_PODIUM_MAX_RANK, 3);
});

test("ét dominerende ungdomsetapeløb giver ét input pr. ungdomsmedlem, ikke ét pr. etape", () => {
  const rows = [];
  for (let stage = 1; stage <= 7; stage += 1) {
    rows.push(row({ raceId: "u23-tour", at: `2026-10-1${stage}T12:00:00Z` }));
  }
  rows.push(row({ raceId: "u23-tour", resultType: "gc", at: "2026-10-18T12:00:00Z" }));

  const events = deriveYouthResultMoodEvents({ rows, assignedMembers: MEMBERS, tuning: TUNING });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.ownerArchetypeKey).sort(), ["talentspejderen", "ungdomsidealisten"]);
  for (const event of events) {
    assert.equal(event.raceId, "u23-tour");
    assert.equal(event.created_at, "2026-10-18T12:00:00Z", "dateret ved løbets seneste tællende resultat");
    assert.equal(event.satisfaction_delta > 0, true);
    assert.equal(event.source, "youth_result");
  }
});

test("seniorløb, ukendt trup, andre resultat-typer og placeringer uden for podiet tæller ikke", () => {
  const rows = [
    row({ raceId: "senior", squad: "senior", at: "2026-10-10T00:00:00Z" }),
    { race_id: "no-squad", result_type: "stage", rank: 1, imported_at: "2026-10-10T00:00:00Z", races: {} },
    { race_id: "no-races", result_type: "stage", rank: 1, imported_at: "2026-10-10T00:00:00Z" },
    row({ raceId: "jersey-2nd", resultType: "points", rank: 2, at: "2026-10-10T00:00:00Z" }),
    row({ raceId: "leader", resultType: "leader", at: "2026-10-10T00:00:00Z" }),
    row({ raceId: "fourth", rank: 4, at: "2026-10-10T00:00:00Z" }),
    row({ raceId: "rank-zero", rank: 0, at: "2026-10-10T00:00:00Z" }),
    row({ raceId: "no-time", at: null }),
    row({ raceId: null, at: "2026-10-10T00:00:00Z" }),
  ];
  assert.deepEqual(deriveYouthResultMoodEvents({ rows, assignedMembers: MEMBERS, tuning: TUNING }), []);
});

test("junior- og U23-podier tæller, nyeste løb først", () => {
  const rows = [
    row({ raceId: "junior-classic", squad: "junior", resultType: "gc", rank: 3, at: "2026-10-12T00:00:00Z" }),
    row({ raceId: "u23-classic", squad: "u23", resultType: "gc", rank: 2, at: "2026-10-15T00:00:00Z" }),
  ];
  const events = deriveYouthResultMoodEvents({
    rows,
    tuning: TUNING,
    assignedMembers: [MEMBERS[1]],
  });
  assert.deepEqual(events.map((e) => e.raceId), ["u23-classic", "junior-classic"]);
});

test("ingen ungdomsfokuserede medlemmer → ingen input", () => {
  const rows = [row({ raceId: "u23-tour", at: "2026-10-18T12:00:00Z" })];
  assert.deepEqual(deriveYouthResultMoodEvents({ rows, assignedMembers: [MEMBERS[2], MEMBERS[3]], tuning: TUNING }), []);
  assert.deepEqual(deriveYouthResultMoodEvents({ rows, assignedMembers: [], tuning: TUNING }), []);
  assert.deepEqual(deriveYouthResultMoodEvents(), []);
});

test("ungdomsinput løfter kun ungdomsmedlemmets stemning, ikke de andres", () => {
  const events = deriveYouthResultMoodEvents({
    rows: [row({ raceId: "u23-tour", at: "2026-10-18T12:00:00Z" })],
    assignedMembers: MEMBERS,
    tuning: TUNING,
  });
  assert.equal(deriveMemberMood({ ownedEvents: events, archetypeKey: "ungdomsidealisten" }), "positive");
  assert.equal(deriveMemberMood({ ownedEvents: events, archetypeKey: "pragmatikeren" }), "neutral");
});

// ── Loaderen: kun holdet, kun sæsonen, kun ungdomstrupper, kun top 3 ────────

function recordingSupabase(result = { data: [], error: null }) {
  const calls = [];
  const builder = {
    select(cols) { calls.push(["select", cols]); return builder; },
    eq(col, value) { calls.push(["eq", col, value]); return builder; },
    in(col, values) { calls.push(["in", col, values]); return builder; },
    lte(col, value) { calls.push(["lte", col, value]); return builder; },
    order(col, opts) { calls.push(["order", col, opts]); return builder; },
    range(from, to) { calls.push(["range", from, to]); return Promise.resolve(result); },
  };
  return {
    calls,
    from(table) { calls.push(["from", table]); return builder; },
  };
}

test("loadYouthRaceResultsForBoard filtrerer på hold, sæson, ungdomstrup, resultat-type og podie", async () => {
  const supabase = recordingSupabase({ data: [{ race_id: "r1" }], error: null });
  const rows = await loadYouthRaceResultsForBoard({ supabase, teamId: TEAM_ID, seasonId: "s3" });
  assert.deepEqual(rows, [{ race_id: "r1" }]);
  assert.deepEqual(supabase.calls[0], ["from", "race_results"]);
  assert.match(supabase.calls[1][1], /races!inner\(squad, season_id\)/);
  const filters = supabase.calls.slice(2);
  assert.deepEqual(filters, [
    ["eq", "team_id", TEAM_ID],
    ["in", "result_type", ["stage", "gc", "points", "mountain", "young"]],
    ["lte", "rank", 3],
    ["eq", "races.season_id", "s3"],
    ["in", "races.squad", ["junior", "u23"]],
    ["order", "id", { ascending: true }],
    ["range", 0, 999],
  ]);
});

test("loadYouthRaceResultsForBoard paginerer forbi PostgREST-loftet", async () => {
  const pages = [
    Array.from({ length: 1000 }, (_, i) => ({ id: i })),
    [{ id: 1000 }],
  ];
  const ranges = [];
  const builder = {
    select: () => builder, eq: () => builder, in: () => builder, lte: () => builder, order: () => builder,
    range(from, to) { ranges.push([from, to]); return Promise.resolve({ data: pages.shift() ?? [], error: null }); },
  };
  const rows = await loadYouthRaceResultsForBoard({ supabase: { from: () => builder }, teamId: TEAM_ID, seasonId: "s3" });
  assert.equal(rows.length, 1001);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
});

test("loadYouthRaceResultsForBoard: manglende input → [] uden opslag; fejl kastes", async () => {
  const supabase = recordingSupabase();
  assert.deepEqual(await loadYouthRaceResultsForBoard({ supabase, teamId: TEAM_ID, seasonId: null }), []);
  assert.deepEqual(supabase.calls, []);
  const failing = recordingSupabase({ data: null, error: { message: "boom" } });
  await assert.rejects(
    loadYouthRaceResultsForBoard({ supabase: failing, teamId: TEAM_ID, seasonId: "s3" }),
    /race_results \(youth\) lookup failed: boom/,
  );
});

// ── Aggregatoren ─────────────────────────────────────────────────────────────

function makeQueryBuilder(rows) {
  let filtered = [...rows];
  const builder = {
    eq(col, value) { filtered = filtered.filter((r) => r[col] === value); return builder; },
    in(col, values) { filtered = filtered.filter((r) => values.includes(r[col])); return builder; },
    lte() { return builder; },
    range() { return builder; },
    or() { return builder; },
    not() { return builder; },
    order(col, opts = {}) {
      const ascending = opts.ascending !== false;
      filtered = [...filtered].sort((a, b) => {
        if (a[col] === b[col]) return 0;
        return ascending ? (a[col] > b[col] ? 1 : -1) : (a[col] < b[col] ? 1 : -1);
      });
      return builder;
    },
    limit(n) { filtered = filtered.slice(0, n); return builder; },
    maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
    then(resolve, reject) { return Promise.resolve({ data: filtered, error: null }).then(resolve, reject); },
  };
  return builder;
}

function makeSupabase(tables) {
  return { from: (table) => ({ select: () => makeQueryBuilder(tables[table] || []) }) };
}

function tables(overrides = {}) {
  return {
    board_relations: [],
    team_board_members: MEMBERS,
    board_mandates: [],
    board_vision_milestones: [],
    teams: [{ id: TEAM_ID, team_dna_key: null, created_at: "2026-08-15T00:00:00Z" }],
    seasons: [{ id: "s3", number: 3, status: "active", start_date: "2026-07-31T00:00:00Z" }],
    season_standings: [],
    riders: [],
    loans: [],
    board_satisfaction_events: [],
    board_consequences: [],
    board_profiles: [],
    ...overrides,
  };
}

function moodOf(payload, archetypeKey) {
  return payload.board.members.find((m) => m.archetypeKey === archetypeKey)?.mood;
}

test("aggregator: ungdomsresultater gør ungdomsmedlemmerne positive, resten uændret", async () => {
  const calls = [];
  const payload = await buildBoardRoomPayload({
    supabase: makeSupabase(tables()),
    teamId: TEAM_ID,
    youthTuning: TUNING,
    loadYouthResults: async (args) => {
      calls.push(args.seasonId);
      return [row({ raceId: "u23-tour", resultType: "gc", at: "2026-10-18T12:00:00Z" })];
    },
  });
  assert.deepEqual(calls, ["s3"], "læser kun den aktive sæson");
  assert.equal(moodOf(payload, "talentspejderen"), "positive");
  assert.equal(moodOf(payload, "ungdomsidealisten"), "positive");
  assert.equal(moodOf(payload, "pragmatikeren"), "neutral");
  assert.equal(moodOf(payload, "resultatjaegeren"), "neutral");
  // Tillid og referat læser ikke ungdomsresultaterne.
  assert.equal(payload.confidence.value, null);
  assert.deepEqual(payload.minutes, []);
});

test("aggregator: seniormålet stage_wins tæller ikke ungdomssejre", async () => {
  const goal = { type: "stage_wins", target: 1, cumulative: false, category: "results" };
  const payload = await buildBoardRoomPayload({
    supabase: makeSupabase(tables({
      season_standings: [{ team_id: TEAM_ID, stage_wins: 0, updated_at: "2026-10-18T00:00:00Z" }],
      board_mandates: [{
        id: "mand-s3", team_id: TEAM_ID, season_id: "s3", season_number: 3,
        status: "active", signed_at: "2026-08-01T00:00:00Z", goals: [goal],
      }],
    })),
    teamId: TEAM_ID,
    youthTuning: TUNING,
    loadGoalContext: async () => ({}),
    loadYouthResults: async () => [row({ raceId: "u23-tour", at: "2026-10-18T12:00:00Z" })],
  });
  assert.equal(payload.mandate.goals[0].status, "behind");
  assert.equal(payload.mandate.goals[0].achievedDisplay, "0");
  assert.equal(moodOf(payload, "ungdomsidealisten"), "positive");
});

test("aggregator: fejlet ungdomslæsning koster kun inputtet, ikke siden", async () => {
  const payload = await buildBoardRoomPayload({
    supabase: makeSupabase(tables()),
    teamId: TEAM_ID,
    youthTuning: TUNING,
    loadYouthResults: async () => { throw new Error("boom"); },
  });
  assert.equal(payload.enabled, true);
  assert.equal(moodOf(payload, "ungdomsidealisten"), "neutral");
});

test("aggregator: uden aktiv sæson kaldes loaderen ikke", async () => {
  let called = false;
  const payload = await buildBoardRoomPayload({
    supabase: makeSupabase(tables({ seasons: [] })),
    teamId: TEAM_ID,
    youthTuning: TUNING,
    loadYouthResults: async () => { called = true; return []; },
  });
  assert.equal(called, false);
  assert.equal(moodOf(payload, "ungdomsidealisten"), "neutral");
});

// ── Design-go 24/10 (mulighed A): sejr-plus, loft, privat kilde ─────────────

test("sejr eller slut-trøje giver sejrsvægten, rent podie podievægten", () => {
  const talent = [MEMBERS[1]];
  const delta = (rows) => deriveYouthResultMoodEvents({ rows, assignedMembers: talent, tuning: TUNING })[0].satisfaction_delta;
  assert.equal(delta([row({ raceId: "r", rank: 2, at: "2026-10-10T00:00:00Z" })]), TUNING.podiumWeight);
  assert.equal(delta([row({ raceId: "r", resultType: "gc", rank: 3, at: "2026-10-10T00:00:00Z" })]), TUNING.podiumWeight);
  assert.equal(delta([row({ raceId: "r", resultType: "stage", rank: 1, at: "2026-10-10T00:00:00Z" })]), TUNING.winWeight);
  assert.equal(delta([row({ raceId: "r", resultType: "gc", rank: 1, at: "2026-10-10T00:00:00Z" })]), TUNING.winWeight);
});

test("slut-trøje (rank 1) giver sejrsvægten alene; plads 2-3 i trøjen tæller ikke", () => {
  assert.deepEqual([...YOUTH_JERSEY_TYPES], ["points", "mountain", "young"]);
  const talent = [MEMBERS[1]];
  for (const resultType of YOUTH_JERSEY_TYPES) {
    const events = deriveYouthResultMoodEvents({
      rows: [row({ raceId: "r", resultType, rank: 1, at: "2026-10-10T00:00:00Z" })],
      assignedMembers: talent,
      tuning: TUNING,
    });
    assert.equal(events.length, 1, resultType);
    assert.equal(events[0].satisfaction_delta, TUNING.winWeight, resultType);
  }
  // Trøje-sejr oven på et rent etapepodie løfter løbet til sejrsvægten, stadig ét nik.
  const combined = deriveYouthResultMoodEvents({
    rows: [
      row({ raceId: "r", resultType: "stage", rank: 2, at: "2026-10-10T00:00:00Z" }),
      row({ raceId: "r", resultType: "mountain", rank: 1, at: "2026-10-12T00:00:00Z" }),
    ],
    assignedMembers: talent,
    tuning: TUNING,
  });
  assert.equal(combined.length, 1);
  assert.equal(combined[0].satisfaction_delta, TUNING.winWeight);
});

test("sejren tæller uanset om den ligger før eller efter løbets seneste podie, og stadig kun ét nik", () => {
  const rows = [
    row({ raceId: "r", resultType: "stage", rank: 1, at: "2026-10-10T00:00:00Z" }),
    row({ raceId: "r", resultType: "gc", rank: 3, at: "2026-10-12T00:00:00Z" }),
  ];
  const events = deriveYouthResultMoodEvents({ rows, assignedMembers: [MEMBERS[1]], tuning: TUNING });
  assert.equal(events.length, 1);
  assert.equal(events[0].satisfaction_delta, TUNING.winWeight);
  assert.equal(events[0].created_at, "2026-10-12T00:00:00Z");
  const reversed = deriveYouthResultMoodEvents({ rows: [...rows].reverse(), assignedMembers: [MEMBERS[1]], tuning: TUNING });
  assert.deepEqual(reversed, events);
});

test("sejrsplusset kan opveje mål-bevægelser som et podie ikke kan", () => {
  const negative = (n) => Array.from({ length: n }, () => ({ ownerArchetypeKey: "ungdomsidealisten", satisfaction_delta: -1 }));
  const mood = (youthRow) => {
    const youth = deriveYouthResultMoodEvents({ rows: [youthRow], assignedMembers: [MEMBERS[1]], tuning: TUNING });
    return deriveMemberMood({ ownedEvents: [...youth, ...negative(3)], archetypeKey: "ungdomsidealisten" });
  };
  assert.equal(mood(row({ raceId: "r", rank: 2, at: "2026-10-10T00:00:00Z" })), "negative");
  assert.equal(mood(row({ raceId: "r", rank: 1, at: "2026-10-10T00:00:00Z" })), "positive");
});

test("loftet begrænser ungdomsandelen i vinduet; resten af pladserne går til øvrige events", () => {
  const youth = Array.from({ length: 4 }, () => ({ ownerArchetypeKey: "ungdomsidealisten", satisfaction_delta: 2, source: YOUTH_RESULT_SOURCE }));
  const older = Array.from({ length: 4 }, () => ({ ownerArchetypeKey: "ungdomsidealisten", satisfaction_delta: -2 }));
  const ownedEvents = [...youth, ...older];
  assert.equal(deriveMemberMood({ ownedEvents, archetypeKey: "ungdomsidealisten" }), "positive", "uden loft fylder ungdom de fem pladser");
  assert.equal(
    deriveMemberMood({ ownedEvents, archetypeKey: "ungdomsidealisten", youthWindowCap: TUNING.windowCap }),
    "negative",
    "med loft: 2 ungdoms-events + 3 øvrige",
  );
});

test("privat kilde: gyldig JSON læses, mangler/ugyldig → null (fail-closed)", () => {
  assert.deepEqual(parseYouthMoodTuning(JSON.stringify(TUNING)), TUNING);
  assert.deepEqual(readYouthMoodTuning({ [YOUTH_TUNING_ENV]: JSON.stringify(TUNING) }), TUNING);
  assert.equal(readYouthMoodTuning({}), null);
  assert.equal(parseYouthMoodTuning(""), null);
  assert.equal(parseYouthMoodTuning("ikke json"), null);
  assert.equal(parseYouthMoodTuning(JSON.stringify({ podiumWeight: 2, winWeight: 1, windowCap: 2 })), null, "sejr må ikke veje mindre end podie");
  assert.equal(parseYouthMoodTuning(JSON.stringify({ podiumWeight: 0, winWeight: 1, windowCap: 2 })), null);
  assert.equal(parseYouthMoodTuning(JSON.stringify({ podiumWeight: 2, winWeight: 5, windowCap: 0 })), null);
  assert.equal(parseYouthMoodTuning(JSON.stringify({ podiumWeight: 2, winWeight: 5, windowCap: 1.5 })), null);
});

test("uden tuning: ingen ungdoms-events og ingen læsning af race_results", async () => {
  assert.deepEqual(
    deriveYouthResultMoodEvents({ rows: [row({ raceId: "r", at: "2026-10-10T00:00:00Z" })], assignedMembers: MEMBERS, tuning: null }),
    [],
  );
  let called = false;
  const payload = await buildBoardRoomPayload({
    supabase: makeSupabase(tables()),
    teamId: TEAM_ID,
    youthTuning: null,
    loadYouthResults: async () => { called = true; return [row({ raceId: "r", at: "2026-10-10T00:00:00Z" })]; },
  });
  assert.equal(called, false);
  assert.equal(moodOf(payload, "ungdomsidealisten"), "neutral");
});
