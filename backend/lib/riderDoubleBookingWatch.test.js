import test from "node:test";
import assert from "node:assert/strict";
import { findDoubleBookedRiders, runRiderDoubleBookingWatch } from "./riderDoubleBookingWatch.js";

const w = (start, end = start) => ({ start, end });

// ── findDoubleBookedRiders (pure) ─────────────────────────────────────────────

test("findDoubleBookedRiders: ikke-overlappende løb er IKKE et brud", () => {
  const windowByRace = new Map([["A", w(0)], ["B", w(5)]]);
  const entries = [
    { race_id: "A", team_id: "t1", rider_id: "r1" },
    { race_id: "B", team_id: "t1", rider_id: "r1" },
  ];
  assert.deepEqual(findDoubleBookedRiders({ entries, windowByRace }), []);
});

test("findDoubleBookedRiders: samme rytter i to overlappende løb er ET brud", () => {
  // Præcis prod-formen: to etapeløb der begge spænder game_day 0-7.
  const windowByRace = new Map([["A", w(0, 7)], ["B", w(0, 7)]]);
  const entries = [
    { race_id: "A", team_id: "t1", rider_id: "r1" },
    { race_id: "B", team_id: "t1", rider_id: "r1" },
  ];
  const out = findDoubleBookedRiders({ entries, windowByRace });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { rider_id: "r1", team_id: "t1", raceA: "A", raceB: "B" });
});

test("findDoubleBookedRiders: delvist overlap (endagsløb inde i et etapeløb) er et brud", () => {
  const windowByRace = new Map([["ETAPE", w(45, 49)], ["ENDAGS", w(45)]]);
  const entries = [
    { race_id: "ETAPE", team_id: "t1", rider_id: "r1" },
    { race_id: "ENDAGS", team_id: "t1", rider_id: "r1" },
  ];
  assert.equal(findDoubleBookedRiders({ entries, windowByRace }).length, 1);
});

test("findDoubleBookedRiders: FORSKELLIGE ryttere i overlappende løb er intet brud", () => {
  const windowByRace = new Map([["A", w(0, 7)], ["B", w(0, 7)]]);
  const entries = [
    { race_id: "A", team_id: "t1", rider_id: "r1" },
    { race_id: "B", team_id: "t1", rider_id: "r2" },
  ];
  assert.deepEqual(findDoubleBookedRiders({ entries, windowByRace }), []);
});

// Rod A (#1823): et afmeldt løb binder ikke — ellers ville vagten larme på hvert
// hold der har meldt fra til det ene af to overlappende løb.
test("findDoubleBookedRiders: afmeldt (race,team) tæller IKKE som brud (#1823)", () => {
  const windowByRace = new Map([["A", w(0, 7)], ["B", w(0, 7)]]);
  const entries = [
    { race_id: "A", team_id: "t1", rider_id: "r1" },
    { race_id: "B", team_id: "t1", rider_id: "r1" },
  ];
  const withdrawnKeys = new Set(["B|t1"]);
  assert.deepEqual(findDoubleBookedRiders({ entries, windowByRace, withdrawnKeys }), []);
});

test("findDoubleBookedRiders: løb uden schedule-vindue kan ikke binde", () => {
  const windowByRace = new Map([["A", w(0, 7)]]); // B mangler vindue
  const entries = [
    { race_id: "A", team_id: "t1", rider_id: "r1" },
    { race_id: "B", team_id: "t1", rider_id: "r1" },
  ];
  assert.deepEqual(findDoubleBookedRiders({ entries, windowByRace }), []);
});

test("findDoubleBookedRiders: tre overlappende løb giver alle tre par, deterministisk sorteret", () => {
  const windowByRace = new Map([["A", w(1, 3)], ["B", w(2, 4)], ["C", w(3, 5)]]);
  const entries = ["C", "A", "B"].map((race_id) => ({ race_id, team_id: "t1", rider_id: "r1" }));
  const out = findDoubleBookedRiders({ entries, windowByRace });
  assert.deepEqual(out.map((c) => `${c.raceA}+${c.raceB}`), ["A+B", "A+C", "B+C"]);
});

// ── runRiderDoubleBookingWatch (I/O + alarm) ──────────────────────────────────

// Minimal thenable mock: kun de fire tabeller vagten læser. .range() respekteres ikke
// (test-data < 1000 rækker), .maybeSingle() returnerer første række.
function makeSupabase(state) {
  function builder(table) {
    const filters = [];
    const api = {
      select() { return api; },
      eq(col, val) { filters.push([col, val]); return api; },
      in(col, vals) { filters.push([col, vals]); return api; },
      order() { return api; },
      range() { return api; },
      maybeSingle() {
        const rows = api.__rows();
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      __rows() {
        let rows = [...(state[table] || [])];
        for (const [col, val] of filters) {
          rows = Array.isArray(val) ? rows.filter((r) => val.includes(r[col])) : rows.filter((r) => r[col] === val);
        }
        return rows;
      },
      then(resolve) { return resolve({ data: api.__rows(), error: null }); },
    };
    return api;
  }
  return { from: (t) => builder(t) };
}

function seedState({ entries, stagesCompleted = {}, riders = null }) {
  return {
    seasons: [{ id: "s2", number: 2, status: "active" }],
    races: [
      { id: "A", season_id: "s2", name: "Tour des Hauts Plateaux", stages_completed: stagesCompleted.A ?? 0 },
      { id: "B", season_id: "s2", name: "Tour de Malaisie", stages_completed: stagesCompleted.B ?? 0 },
    ],
    race_stage_schedule: [
      { race_id: "A", stage_number: 1, scheduled_at: "2026-07-27T16:20:00Z", game_day: 0 },
      { race_id: "A", stage_number: 2, scheduled_at: "2026-07-28T16:20:00Z", game_day: 1 },
      { race_id: "B", stage_number: 1, scheduled_at: "2026-07-27T17:00:00Z", game_day: 0 },
      { race_id: "B", stage_number: 2, scheduled_at: "2026-07-28T17:00:00Z", game_day: 1 },
    ],
    race_withdrawals: [],
    race_entries: entries,
    // Ghost-krydset (#3185) slår entries op mod rytterens NUVÆRENDE tilstand —
    // default: alle entry-ryttere er stadig på deres entry-hold (ingen ghosts).
    riders: riders ?? [...new Set(entries.map((e) => e.rider_id))].map((id) => {
      const teamId = entries.find((e) => e.rider_id === id).team_id;
      return { id, team_id: teamId, is_academy: false, is_retired: false };
    }),
  };
}

test("runRiderDoubleBookingWatch: ren sæson → ingen alarm", async () => {
  const state = seedState({
    entries: [
      { race_id: "A", team_id: "t1", rider_id: "r1" },
      { race_id: "B", team_id: "t1", rider_id: "r2" },
    ],
  });
  const captured = [];
  const res = await runRiderDoubleBookingWatch({
    supabase: makeSupabase(state), captureExceptionFn: (e, ctx) => captured.push([e, ctx]),
  });
  assert.equal(res.conflicts, 0);
  assert.equal(res.alerted, false);
  assert.equal(captured.length, 0);
});

test("runRiderDoubleBookingWatch: dobbeltbooket rytter → ÉN capture med fast fingerprint", async () => {
  const state = seedState({
    entries: [
      { race_id: "A", team_id: "t1", rider_id: "r1" },
      { race_id: "B", team_id: "t1", rider_id: "r1" },
      { race_id: "A", team_id: "t1", rider_id: "r2" },
      { race_id: "B", team_id: "t1", rider_id: "r2" },
    ],
  });
  const captured = [];
  const res = await runRiderDoubleBookingWatch({
    supabase: makeSupabase(state), captureExceptionFn: (e, ctx) => captured.push([e, ctx]),
  });
  assert.equal(res.conflicts, 2);
  assert.equal(res.actionable, 2, "ingen af løbene er afviklet → begge kan stadig nås");
  assert.equal(res.alerted, true);
  assert.equal(captured.length, 1, "ét Sentry-issue uanset antal fund");
  assert.deepEqual(captured[0][1].fingerprint, ["rider-double-booked-overlapping-races"]);
  assert.equal(captured[0][1].extra.count, 2);
  // Samplet bruger løbsnavne, ikke rå UUID'er — triage skal kunne læses direkte.
  assert.equal(captured[0][1].extra.sample[0].raceA, "Tour des Hauts Plateaux");
});

// Prod-formen 27/7: begge løb er allerede afviklet → bruddet er historik og kræver en
// ejer-gated tilbagerulning, ikke en hurtig entry-sletning. Vagten skal skelne.
test("runRiderDoubleBookingWatch: afviklede løb tælles som brud, men ikke som actionable", async () => {
  const state = seedState({
    entries: [
      { race_id: "A", team_id: "t1", rider_id: "r1" },
      { race_id: "B", team_id: "t1", rider_id: "r1" },
    ],
    stagesCompleted: { A: 2, B: 2 },
  });
  const res = await runRiderDoubleBookingWatch({ supabase: makeSupabase(state), captureExceptionFn: () => {} });
  assert.equal(res.conflicts, 1);
  assert.equal(res.actionable, 0);
});

// #3185 (forensik 3/8): en SOLGT rytters entry hos det gamle hold er ikke et brud.
// Divisionernes kalendere er forskudt i real-tid, så en rytter der kørte færdig i D2
// (game_day 0-7, real 27-30/7) og blev solgt til et D4-hold lovligt kan køre D4's
// game_day 4 (real 31/7). Guards filtrerer ghost-entries (#1906); vagten skal dele
// semantik — ellers vokser CYCLINGZONE-44 med falske par (prod: 4→7 på 4 dage).
test("runRiderDoubleBookingWatch: solgt rytters gamle entry tæller IKKE (ghost-filter, #3185)", async () => {
  const state = seedState({
    entries: [
      { race_id: "A", team_id: "t1", rider_id: "r1" }, // kørt for sælger-holdet t1
      { race_id: "B", team_id: "t2", rider_id: "r1" }, // nyt hold t2, overlappende game_day-vindue
    ],
    riders: [{ id: "r1", team_id: "t2", is_academy: false, is_retired: false }], // r1 er SOLGT til t2
  });
  const captured = [];
  const res = await runRiderDoubleBookingWatch({
    supabase: makeSupabase(state), captureExceptionFn: (e, ctx) => captured.push([e, ctx]),
  });
  assert.equal(res.conflicts, 0, "ghost-entry hos gammelt hold er ikke et brud");
  assert.equal(res.alerted, false);
  assert.equal(captured.length, 0);
});

test("runRiderDoubleBookingWatch: rytter STADIG på holdet i to overlappende løb tæller (ghost-filteret overser ikke ægte brud)", async () => {
  const state = seedState({
    entries: [
      { race_id: "A", team_id: "t1", rider_id: "r1" },
      { race_id: "B", team_id: "t1", rider_id: "r1" },
    ],
    riders: [{ id: "r1", team_id: "t1", is_academy: false, is_retired: false }],
  });
  const res = await runRiderDoubleBookingWatch({ supabase: makeSupabase(state), captureExceptionFn: () => {} });
  assert.equal(res.conflicts, 1, "ægte brud (rytteren er stadig på holdet) fanges stadig");
});

test("runRiderDoubleBookingWatch: ingen aktiv sæson → skip uden alarm", async () => {
  const state = seedState({ entries: [] });
  state.seasons = [{ id: "s1", number: 1, status: "completed" }];
  const captured = [];
  const res = await runRiderDoubleBookingWatch({
    supabase: makeSupabase(state), captureExceptionFn: (e) => captured.push(e),
  });
  assert.equal(res.skipped, "no_active_season");
  assert.equal(res.alerted, false);
  assert.equal(captured.length, 0);
});

test("runRiderDoubleBookingWatch: kræver en supabase-klient", async () => {
  await assert.rejects(() => runRiderDoubleBookingWatch({}), /Supabase client required/);
});
