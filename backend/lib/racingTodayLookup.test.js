import test from "node:test";
import assert from "node:assert/strict";
import { computeRacingTodayByRider, loadRacingTodayByRider } from "./racingTodayLookup.js";
import { readFileSync } from "node:fs";
import { loadBoundRiderIdsForRaceDay } from "./trainingRaceDayTick.js";

// ── computeRacingTodayByRider (ren funktion) ──────────────────────────────────

test("computeRacingTodayByRider: matcher kun entries hvis race_id har en etape i dag", () => {
  const out = computeRacingTodayByRider({
    entryRows: [
      { race_id: "race-a", rider_id: "rider-1" },
      { race_id: "race-b", rider_id: "rider-2" }, // race-b har INGEN etape i dag
    ],
    todayRaceIds: ["race-a"],
    raceNameById: new Map([["race-a", "Tour de Zone"]]),
  });
  assert.deepEqual(out, { "rider-1": { race: "Tour de Zone" } });
});

test("computeRacingTodayByRider: tomme entries/todayRaceIds giver tomt map", () => {
  assert.deepEqual(computeRacingTodayByRider({}), {});
  assert.deepEqual(computeRacingTodayByRider({ entryRows: [], todayRaceIds: ["race-a"] }), {});
  assert.deepEqual(computeRacingTodayByRider({ entryRows: [{ race_id: "race-a", rider_id: "rider-1" }], todayRaceIds: [] }), {});
});

test("computeRacingTodayByRider: manglende løbsnavn (races-select fejlede delvist) giver race:null, ikke en kastet fejl", () => {
  const out = computeRacingTodayByRider({
    entryRows: [{ race_id: "race-a", rider_id: "rider-1" }],
    todayRaceIds: ["race-a"],
    raceNameById: new Map(),
  });
  assert.deepEqual(out, { "rider-1": { race: null } });
});

test("computeRacingTodayByRider: 1-rytter-1-løb-invarianten betyder normalt ét match, men en uventet dobbelt-række er harmløs (sidste vinder)", () => {
  const out = computeRacingTodayByRider({
    entryRows: [
      { race_id: "race-a", rider_id: "rider-1" },
      { race_id: "race-b", rider_id: "rider-1" },
    ],
    todayRaceIds: ["race-a", "race-b"],
    raceNameById: new Map([["race-a", "Race A"], ["race-b", "Race B"]]),
  });
  assert.equal(out["rider-1"].race, "Race B");
});

// ── loadRacingTodayByRider (I/O-wrapper, fake supabase) ───────────────────────

const SIX_IDS = [1, 2, 3, 4, 5, 6].map((n) => `rider-${n}`);
const SIX_ENTRIES = SIX_IDS.map((rider_id) => ({ race_id: "race-a", rider_id }));

// riders: holdets ryttere {id, squad}; roster-querien (applyRiderEligibilityFilter) afgraenses
// paa .eq("squad", <trup>) som i prod. Default = 6 senior-ryttere.
// #6740: generisk kæde til de nye opslag (afmelding, faktisk felt, Train now-lås).
function chain(rows) {
  const api = {};
  for (const m of ["select", "eq", "in", "order", "range", "limit", "is", "gte", "lt"]) api[m] = () => api;
  api.then = (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  return api;
}

function fakeSupabase({ entries, sched, races, entryError, schedError, raceError, conditions, conditionError, riders,
  withdrawals, results, locks, lockSched, runs } = {}) {
  const roster = riders ?? SIX_IDS.map((id) => ({ id, squad: "senior" }));
  return {
    from(table) {
      if (table === "race_withdrawals" && withdrawals) return chain(withdrawals);
      if (table === "race_results" && results) return chain(results);
      if (table === "race_simulation_runs" && runs) return chain(runs);
      if (table === "training_train_now_locks" && locks) return chain(locks);
      if (table === "riders") {
        const state = { squad: null };
        const api = {
          select: () => api,
          eq(col, val) { if (col === "squad") state.squad = val; return api; },
          or: () => api,
          is: () => api,
          then(resolve) { return Promise.resolve({ data: roster.filter((r) => r.squad === state.squad), error: null }).then(resolve); },
        };
        return api;
      }
      if (table === "rider_condition") {
        return { select: () => ({ in: async () => ({ data: conditions ?? [], error: conditionError ?? null }) }) };
      }
      if (table === "race_entries") {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: entries ?? [], error: entryError ?? null }),
            }),
          }),
        };
      }
      if (table === "race_stage_schedule") {
        return {
          select: () => ({
            gte: () => ({
              lt: async () => ({ data: sched ?? [], error: schedError ?? null }),
            }),
            // #6740: Train now-låsens opslag af løbets etapedatoer.
            in: async () => ({ data: lockSched ?? [], error: null }),
          }),
        };
      }
      if (table === "races") {
        return {
          select: () => ({
            in: async () => ({ data: races ?? [], error: raceError ?? null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test("loadRacingTodayByRider: happy path — rider entered in a race scheduled today gets the race name", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES,
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone", stages_completed: 0 }],
  });
  const out = await loadRacingTodayByRider(supabase, "team-1", [...SIX_IDS, "rider-7"], new Date("2026-08-10T10:00:00Z"));
  assert.equal(out["rider-1"].race, "Tour de Zone");
  assert.equal(Object.keys(out).length, 6);
});

test("loadRacingTodayByRider: rider entered but no stage scheduled today → not racing", async () => {
  const supabase = fakeSupabase({
    entries: [{ race_id: "race-a", rider_id: "rider-1" }],
    sched: [], // ingen etaper i dag
    races: [],
  });
  const out = await loadRacingTodayByRider(supabase, "team-1", ["rider-1"], new Date());
  assert.deepEqual(out, {});
});

test("loadRacingTodayByRider: tomt riderIds/manglende teamId/manglende supabase-client → {} uden query", async () => {
  assert.deepEqual(await loadRacingTodayByRider(fakeSupabase(), "team-1", [], new Date()), {});
  assert.deepEqual(await loadRacingTodayByRider(fakeSupabase(), null, ["rider-1"], new Date()), {});
  assert.deepEqual(await loadRacingTodayByRider(null, "team-1", ["rider-1"], new Date()), {});
});

test("loadRacingTodayByRider: fail-safe — query-fejl på entries/schedule/races giver {} i stedet for at kaste", async () => {
  const entryErrSupabase = fakeSupabase({ entryError: new Error("boom") });
  assert.deepEqual(await loadRacingTodayByRider(entryErrSupabase, "team-1", ["rider-1"], new Date()), {});

  const schedErrSupabase = fakeSupabase({ schedError: new Error("boom") });
  assert.deepEqual(await loadRacingTodayByRider(schedErrSupabase, "team-1", ["rider-1"], new Date()), {});

  const raceErrSupabase = fakeSupabase({
    entries: [{ race_id: "race-a", rider_id: "rider-1" }],
    sched: [{ race_id: "race-a" }],
    raceError: new Error("boom"),
  });
  assert.deepEqual(await loadRacingTodayByRider(raceErrSupabase, "team-1", ["rider-1"], new Date()), {});
});

test("loadRacingTodayByRider: fail-safe — en synkron/netværks-exception giver {} i stedet for at kaste", async () => {
  const throwingSupabase = { from: () => { throw new Error("network"); } };
  assert.deepEqual(await loadRacingTodayByRider(throwingSupabase, "team-1", ["rider-1"], new Date()), {});
});

// ── #5945: hold der ikke starter faar ikke "løber i dag" ──────────────────────

test("computeRacingTodayByRider: startsByRaceId=false skjuler badget, manglende noegle bevarer det (#5945)", () => {
  const args = {
    entryRows: [{ race_id: "race-a", rider_id: "rider-1" }, { race_id: "race-b", rider_id: "rider-2" }],
    todayRaceIds: ["race-a", "race-b"],
    raceNameById: new Map([["race-a", "A"], ["race-b", "B"]]),
  };
  assert.deepEqual(computeRacingTodayByRider({ ...args, startsByRaceId: new Map([["race-a", false]]) }), { "rider-2": { race: "B" } });
  assert.deepEqual(Object.keys(computeRacingTodayByRider(args)).sort(), ["rider-1", "rider-2"]);
});

test("loadRacingTodayByRider: hold med 3 udtagne og ingen frie ryttere faar intet badge (#5945)", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES.slice(0, 3),
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone", stages_completed: 0 }],
    riders: SIX_IDS.slice(0, 3).map((id) => ({ id, squad: "senior" })),
  });
  assert.deepEqual(await loadRacingTodayByRider(supabase, "team-1", SIX_IDS.slice(0, 3), new Date()), {});
});

test("loadRacingTodayByRider: 3 udtagne + 3 frie ryttere naar gulvet (assistenten fylder op) og beholder badget", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES.slice(0, 3),
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone", stages_completed: 0 }],
  });
  const out = await loadRacingTodayByRider(supabase, "team-1", SIX_IDS, new Date());
  assert.deepEqual(Object.keys(out).sort(), SIX_IDS.slice(0, 3));
});

test("loadRacingTodayByRider: juniorloeb taeller kun junior-truppen som frie, ikke senior-ryttere (#5945)", async () => {
  const juniors = ["j-1", "j-2", "j-3"];
  const seniors = ["s-1", "s-2", "s-3", "s-4"];
  const supabase = fakeSupabase({
    entries: juniors.map((rider_id) => ({ race_id: "race-j", rider_id })),
    sched: [{ race_id: "race-j" }],
    races: [{ id: "race-j", name: "Junior Cup", stages_completed: 0, squad: "junior" }],
    riders: [...juniors, ...seniors].map((id) => ({ id, squad: id.startsWith("j") ? "junior" : "senior" })),
  });
  assert.deepEqual(await loadRacingTodayByRider(supabase, "team-1", [...juniors, ...seniors], new Date()), {});
});

test("loadRacingTodayByRider: juniorloeb med nok junior-ryttere i truppen beholder badget (#5945)", async () => {
  const juniors = ["j-1", "j-2", "j-3", "j-4", "j-5", "j-6"];
  const supabase = fakeSupabase({
    entries: juniors.slice(0, 3).map((rider_id) => ({ race_id: "race-j", rider_id })),
    sched: [{ race_id: "race-j" }],
    races: [{ id: "race-j", name: "Junior Cup", stages_completed: 0, squad: "junior" }],
    riders: juniors.map((id) => ({ id, squad: "junior" })),
  });
  const out = await loadRacingTodayByRider(supabase, "team-1", juniors, new Date());
  assert.deepEqual(Object.keys(out).sort(), juniors.slice(0, 3));
});

test("loadRacingTodayByRider: skadede frie ryttere taeller ikke med til gulvet", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES.slice(0, 3),
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone", stages_completed: 0 }],
    conditions: SIX_IDS.slice(3).map((rider_id) => ({ rider_id, injured_until: "2999-01-01" })),
  });
  assert.deepEqual(await loadRacingTodayByRider(supabase, "team-1", SIX_IDS, new Date()), {});
});

test("loadRacingTodayByRider: et loeb i gang roeres ikke selvom holdet er under gulvet", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES.slice(0, 3),
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone", stages_completed: 2 }],
  });
  const out = await loadRacingTodayByRider(supabase, "team-1", SIX_IDS.slice(0, 3), new Date());
  assert.deepEqual(Object.keys(out).sort(), SIX_IDS.slice(0, 3));
});

test("loadRacingTodayByRider: svigtende skadesopslag fejler mod stiller-op (badge som foer), aldrig throw", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES.slice(0, 3),
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone", stages_completed: 0 }],
    conditionError: new Error("boom"),
  });
  const out = await loadRacingTodayByRider(supabase, "team-1", SIX_IDS, new Date());
  assert.equal(Object.keys(out).length, 3);
});

// ── #5945: et hold der IKKE startede træner normalt ───────────────────────────
// "Løber i dag"-badget er PRE-hoc og skjules nu for hold der ikke starter. Selve
// træningen afgøres af to andre kilder, og begge skal blive ved at give det samme
// svar for et hold der blev fjernet fra startfeltet:
//   1) dailyTrainingEngine.loadRacedRiderIdsToday er POST-hoc paa race_results — et
//      hold uden resultater har ingen "koerte i dag"-raekker og traener normalt.
//   2) loadBoundRiderIdsForRaceDay slipper bindingen for ryttere der ikke staar i
//      loebets uforanderlige startfelt-snapshot (DNS), saa en rytter fra et hold der
//      blev fjernet ved start heller ikke er bundet.

test("pin: loadRacedRiderIdsToday laeser race_results (post-hoc), ikke race_entries", () => {
  const src = readFileSync(new URL("./dailyTrainingEngine.js", import.meta.url), "utf8");
  const start = src.indexOf("async function loadRacedRiderIdsToday");
  assert.ok(start > 0, "loadRacedRiderIdsToday findes");
  const body = src.slice(start, start + 1400);
  assert.match(body, /\.from\("race_results"\)/);
  assert.doesNotMatch(body, /\.from\("race_entries"\)/);
});

test("pin: rytter fra et hold der ikke staar i startfeltet er ikke bundet paa loebsdagen og traener normalt", async () => {
  const tables = {
    race_entry_days: [
      { rider_id: "rider-1", race_id: "race-a", season_id: "s1", game_day: 4 },
      { rider_id: "rider-2", race_id: "race-a", season_id: "s1", game_day: 4 },
    ],
    // Startfeltet blev laast uden dette holds ryttere (holdet var under gulvet).
    race_simulation_runs: [{ race_id: "race-a", stage_number: 1, entrant_snapshot: ["other-team-rider"] }],
  };
  const supabase = {
    from(table) {
      const state = { inList: null, filters: [] };
      const api = {
        select() { return api; },
        eq(col, val) { state.filters.push([col, val]); return api; },
        in(col, vals) { state.inList = [col, vals]; return api; },
        then(resolve) {
          let rows = tables[table] ?? [];
          rows = rows.filter((r) => state.filters.every(([c, v]) => r[c] === v));
          if (state.inList) rows = rows.filter((r) => state.inList[1].includes(r[state.inList[0]]));
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return api;
    },
  };
  const out = await loadBoundRiderIdsForRaceDay({ supabase, riderIds: ["rider-1", "rider-2"], seasonId: "s1", gameDay: 4 });
  assert.equal(out.error, null);
  assert.equal(out.data.size, 0);
});

// ── #6740: afmeldte og ikke-startede hold får intet "Racing"-mærke ────────────

test("loadRacingTodayByRider: afmeldt hold har ingen badge, selvom entries er bevaret (#6740, knud 16/10)", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES,
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour du Danube", stages_completed: 0 }],
    withdrawals: [{ race_id: "race-a" }],
  });
  assert.deepEqual(await loadRacingTodayByRider(supabase, "team-1", SIX_IDS, new Date("2026-10-16T08:00:00Z")), {});
});

test("loadRacingTodayByRider: startet loeb uden holdet i feltet giver ingen badge (#6740)", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES.slice(0, 4),
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour du Danube", stages_completed: 1 }],
    withdrawals: [],
    runs: [{ race_id: "race-a", entrant_snapshot: ["someone-else"] }],
  });
  assert.deepEqual(await loadRacingTodayByRider(supabase, "team-1", SIX_IDS, new Date("2026-10-16T08:00:00Z")), {});
});

test("loadRacingTodayByRider: startet loeb med holdet i feltet beholder badget (#6740)", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES,
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour du Danube", stages_completed: 1 }],
    withdrawals: [],
    runs: [{ race_id: "race-a", entrant_snapshot: SIX_IDS }],
  });
  assert.equal(Object.keys(await loadRacingTodayByRider(supabase, "team-1", SIX_IDS, new Date("2026-10-16T08:00:00Z"))).length, 6);
});

test("loadRacingTodayByRider: Train now-laaste ryttere taeller ikke som frie reserver (#6740, Friis 16/10)", async () => {
  // 5 raske udtaget + 1 fri rytter, men den frie har trænet i dag og kan ikke fyldes ind.
  const riders = [...SIX_IDS, "rider-7"].map((id) => ({ id, squad: "senior" }));
  const today = new Date("2026-10-16T08:00:00Z");
  const base = {
    entries: SIX_ENTRIES.slice(0, 5),
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour du Léman", stages_completed: 0 }],
    riders, withdrawals: [],
    lockSched: [{ race_id: "race-a", scheduled_at: "2026-10-16T17:00:00Z" }],
  };
  const unlocked = await loadRacingTodayByRider(fakeSupabase({ ...base, locks: [] }), "team-1", [...SIX_IDS, "rider-7"], today);
  assert.equal(Object.keys(unlocked).length, 5, "uden laas kan assistenten fylde op, holdet starter");
  const locked = await loadRacingTodayByRider(fakeSupabase({ ...base, locks: [
    { rider_id: "rider-6", tick_date: "2026-10-16", team_id: "team-1", pressed_at: "2026-10-16T07:04:00Z" },
    { rider_id: "rider-7", tick_date: "2026-10-16", team_id: "team-1", pressed_at: "2026-10-16T07:04:00Z" },
  ] }), "team-1", [...SIX_IDS, "rider-7"], today);
  assert.deepEqual(locked, {}, "alle reserver laast: holdet stiller ikke op, intet badge");
});

test("loadRacingTodayByRider: overlap-dag, 4 udtaget og resten i et andet løb i dag -> holdet starter (#6739 regel A)", async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `rider-${i + 1}`);
  const today = new Date("2026-10-28T08:00:00Z");
  const base = {
    sched: [{ race_id: "race-a" }, { race_id: "race-b" }],
    races: [{ id: "race-a", name: "Race A", stages_completed: 0 }, { id: "race-b", name: "Race B", stages_completed: 0 }],
    riders: ids.map((id) => ({ id, squad: "senior" })), withdrawals: [], locks: [],
  };
  const four = await loadRacingTodayByRider(fakeSupabase({ ...base, entries: [
    ...ids.slice(0, 4).map((rider_id) => ({ race_id: "race-a", rider_id })),
    ...ids.slice(4).map((rider_id) => ({ race_id: "race-b", rider_id })),
  ] }), "team-1", ids, today);
  assert.equal(four["rider-1"]?.race, "Race A", "4 frie på en overlap-dag: holdet starter med 4");
  const three = await loadRacingTodayByRider(fakeSupabase({ ...base, entries: [
    ...ids.slice(0, 3).map((rider_id) => ({ race_id: "race-a", rider_id })),
    ...ids.slice(3).map((rider_id) => ({ race_id: "race-b", rider_id })),
  ] }), "team-1", ids, today);
  assert.equal(three["rider-1"], undefined, "3 frie: under 4, holdet stiller ikke op");
});

test("computeRacingTodayByRider: en skadet udtaget rytter løber ikke, selv om holdet starter (regel B, #6740)", () => {
  const out = computeRacingTodayByRider({
    entryRows: [{ race_id: "leman", rider_id: "fit" }, { race_id: "leman", rider_id: "hurt" }],
    todayRaceIds: ["leman"], raceNameById: new Map([["leman", "Tour du Léman"]]),
    startsByRaceId: new Map([["leman", true]]), notStartingByRaceId: new Map([["leman", new Set(["hurt"])]]),
  });
  assert.deepEqual(out, { fit: { race: "Tour du Léman" } });
  // Startet løb (intet sæt): en rytter der styrtede i dagens løb, kørte det (Codex P2).
  const started = computeRacingTodayByRider({
    entryRows: [{ race_id: "leman", rider_id: "hurt" }], todayRaceIds: ["leman"],
    raceNameById: new Map([["leman", "Tour du Léman"]]), startsByRaceId: new Map([["leman", true]]),
  });
  assert.deepEqual(started, { hurt: { race: "Tour du Léman" } });
});
