// #5944 · "Train only" pr. ungdomstrup: ren model, skift (ryd kun ulaaste loeb),
// manglende tabel og den manuelle tilmeldings-gate i prepareSelectionChange.
import assert from "node:assert/strict";
import test from "node:test";

import {
  YOUTH_RACE_OPT_OUT_TABLE, TRAIN_ONLY_SELECTION_ERROR,
  firstUnlockedRaceDay, isTeamSquadTrainOnly, loadOptedOutKeys, loadTeamTrainOnly,
  racesToClearOnTrainOnly, setTeamSquadTrainOnly,
} from "./youthRaceOptOut.ts";
import { prepareSelectionChange } from "./raceSelection.js";

type Row = Record<string, unknown>;
type State = Record<string, Row[]> & { __missing?: string[] };

// Generisk thenable fake over `state`: eq/in/is-filtre, order/range/limit, maybeSingle,
// delete og upsert. En tabel i `__missing` svarer som en ikke-migreret tabel (42P01).
function fakeSupabase(state: State) {
  function builder(table: string, op = "select", filters: Array<(r: Row) => boolean> = [], payload: unknown = null) {
    const missing = () => (state.__missing ?? []).includes(table);
    const run = (slice?: [number, number]) => {
      if (missing()) return { data: null, error: { code: "42P01", message: `relation ${table} does not exist` } };
      state[table] ??= [];
      const match = (row: Row) => filters.every((f) => f(row));
      if (op === "delete") { state[table] = state[table].filter((r) => !match(r)); return { data: null, error: null }; }
      if (op === "upsert") {
        for (const row of [payload].flat() as Row[]) {
          const exists = state[table].some((r) => r.team_id === row.team_id && r.squad === row.squad);
          if (!exists) state[table].push({ ...row });
        }
        return { data: null, error: null };
      }
      let rows = state[table].filter(match).map((r) => ({ ...r }));
      if (slice) rows = rows.slice(slice[0], slice[1] + 1);
      return { data: rows, error: null };
    };
    const next = (f: (r: Row) => boolean) => builder(table, op, [...filters, f], payload);
    const obj: Record<string, unknown> = {
      select() { return obj; },
      eq(c: string, v: unknown) { return next((r) => (r[c] ?? (c === "squad" && table === "races" ? "senior" : null)) === v); },
      in(c: string, vs: unknown[]) { return next((r) => vs.includes(r[c])); },
      is(c: string, v: unknown) { return next((r) => (r[c] ?? null) === v); },
      or() { return obj; },
      order() { return obj; },
      limit() { return obj; },
      range(from: number, to: number) { return Promise.resolve(run([from, to])); },
      maybeSingle() { const r = run(); return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }); },
      delete() { return builder(table, "delete", filters); },
      upsert(p: unknown) { return Promise.resolve(builder(table, "upsert", filters, p).__run()); },
      __run: () => run(),
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return obj;
  }
  return { from: (table: string) => builder(table) };
}

const TEAM = { id: "team-a", u23_league_division_id: 10, junior_league_division_id: 20 };

function seasonState(): State {
  return {
    seasons: [{ id: "s4", status: "active" }],
    races: [
      // Startet (etape koert): laast, beholder sit felt.
      { id: "u-started", season_id: "s4", squad: "u23", league_division_id: 10, status: "scheduled", stages_completed: 2, game_day_start: 20 },
      // "Train now" trykket paa loebets dato: laast.
      { id: "u-locked", season_id: "s4", squad: "u23", league_division_id: 10, status: "scheduled", stages_completed: 0, game_day_start: 21 },
      // Aabne og tilmeldt: ryddes.
      { id: "u-open-1", season_id: "s4", squad: "u23", league_division_id: 10, status: "scheduled", stages_completed: 0, game_day_start: 22 },
      { id: "u-open-2", season_id: "s4", squad: "u23", league_division_id: 10, status: "scheduled", stages_completed: 0, game_day_start: 24 },
      // Afsluttet: roeres aldrig.
      { id: "u-done", season_id: "s4", squad: "u23", league_division_id: 10, status: "completed", stages_completed: 1, game_day_start: 12 },
      // Juniorloeb og seniorloeb i samme saeson: upaavirkede af et U23-skift.
      { id: "j-open", season_id: "s4", squad: "junior", league_division_id: 20, status: "scheduled", stages_completed: 0, game_day_start: 22 },
      { id: "s-open", season_id: "s4", squad: "senior", league_division_id: 1, status: "scheduled", stages_completed: 0, game_day_start: 22 },
    ],
    race_stage_schedule: [
      { race_id: "u-locked", stage_number: 1, scheduled_at: "2026-10-02T10:00:00Z" },
      { race_id: "u-open-1", stage_number: 1, scheduled_at: "2026-10-03T10:00:00Z" },
    ],
    // #6139: laasen er pr. rytter. u-locked-r er tilmeldt u-locked og traenede den dag; u1 traenede ogsaa,
    // men er ikke tilmeldt noget U23-loeb den dato.
    training_train_now_locks: [
      { team_id: "team-a", tick_date: "2026-10-02", rider_id: "u-locked-r" },
      { team_id: "team-a", tick_date: "2026-10-02", rider_id: "u1" },
    ],
    race_entries: [
      ...["u-started", "u-locked", "u-open-1", "u-open-2", "u-done", "j-open", "s-open"].map((race_id) => ({ race_id, team_id: "team-a", rider_id: `${race_id}-r` })),
      // Et andet hold i samme U23-loeb: roeres aldrig.
      { race_id: "u-open-1", team_id: "team-b", rider_id: "b1" },
    ],
    [YOUTH_RACE_OPT_OUT_TABLE]: [],
  };
}

const entered = (state: State, teamId = "team-a") =>
  state.race_entries.filter((e) => e.team_id === teamId).map((e) => e.race_id).sort();

test("#5944 racesToClearOnTrainOnly: kun aabne, tilmeldte og ikke Train now-laaste loeb", () => {
  const races = seasonState().races.filter((r) => r.squad === "u23") as never;
  const out = racesToClearOnTrainOnly({
    races,
    enteredRaceIds: new Set(["u-started", "u-locked", "u-open-1", "u-done"]),
    trainNowLockedRaceIds: new Set(["u-locked"]),
  });
  assert.deepEqual(out, ["u-open-1"]);
});

test("#5944 skift til Train only: rydder kun truppens ulaaste loeb, laaste dage bevares", async () => {
  const state = seasonState();
  const result = await setTeamSquadTrainOnly(fakeSupabase(state), { team: TEAM, squad: "u23", trainOnly: true });
  assert.equal(result.trainOnly, true);
  assert.deepEqual(result.clearedRaceIds.sort(), ["u-open-1", "u-open-2"]);
  assert.deepEqual(entered(state), ["j-open", "s-open", "u-done", "u-locked", "u-started"],
    "startede, Train now-laaste og afsluttede loeb beholder feltet; junior og senior roeres ikke");
  assert.deepEqual(entered(state, "team-b"), ["u-open-1"], "andre hold roeres aldrig");
  assert.deepEqual(state[YOUTH_RACE_OPT_OUT_TABLE], [{ team_id: "team-a", squad: "u23" }]);
  assert.equal(result.effectiveFromDay, 22, "foerste ulaaste loebsdag (dag 21 er Train now-laast)");
});

test("#6139 skift til Train only: et loeb paa en Train now-dato ryddes, naar ingen af de tilmeldte traenede", async () => {
  const state = seasonState();
  // Den tilmeldte rytter blev koebt efter trykket: ingen laase-raekke, saa loebet er ikke afgjort.
  state.training_train_now_locks = state.training_train_now_locks.filter((row) => row.rider_id !== "u-locked-r");
  const result = await setTeamSquadTrainOnly(fakeSupabase(state), { team: TEAM, squad: "u23", trainOnly: true });
  assert.deepEqual(result.clearedRaceIds.sort(), ["u-locked", "u-open-1", "u-open-2"]);
  assert.equal(result.effectiveFromDay, 21);
});

test("#5944 skift til Train only to gange er idempotent (én raekke)", async () => {
  const state = seasonState();
  const sb = fakeSupabase(state);
  await setTeamSquadTrainOnly(sb, { team: TEAM, squad: "u23", trainOnly: true });
  await setTeamSquadTrainOnly(sb, { team: TEAM, squad: "u23", trainOnly: true });
  assert.equal(state[YOUTH_RACE_OPT_OUT_TABLE].length, 1);
});

test("#5944 skift tilbage til Enter races: raekken slettes, intet felt aendres", async () => {
  const state = seasonState();
  state[YOUTH_RACE_OPT_OUT_TABLE] = [{ team_id: "team-a", squad: "u23" }, { team_id: "team-a", squad: "junior" }];
  const before = entered(state);
  const result = await setTeamSquadTrainOnly(fakeSupabase(state), { team: TEAM, squad: "u23", trainOnly: false });
  assert.equal(result.trainOnly, false);
  assert.deepEqual(result.clearedRaceIds, []);
  assert.deepEqual(entered(state), before);
  assert.deepEqual(state[YOUTH_RACE_OPT_OUT_TABLE], [{ team_id: "team-a", squad: "junior" }], "juniorvalget bevares");
});

test("#5944 manglende tabel: laesere svarer Enter races, skrivning kaster opt_out_unavailable", async () => {
  const state = seasonState();
  state.__missing = [YOUTH_RACE_OPT_OUT_TABLE];
  const sb = fakeSupabase(state);
  assert.equal(await isTeamSquadTrainOnly(sb, { teamId: "team-a", squad: "u23" }), false);
  assert.equal((await loadOptedOutKeys(sb)).size, 0);
  assert.deepEqual(await loadTeamTrainOnly(sb, "team-a"), { available: false, u23: false, junior: false });
  await assert.rejects(
    () => setTeamSquadTrainOnly(sb, { team: TEAM, squad: "u23", trainOnly: true }),
    (err: { code?: string }) => err.code === "opt_out_unavailable",
  );
  assert.equal(entered(state).length, 7, "intet ryddes naar valget ikke kan gemmes");
});

test("#5944 seniorer kan aldrig vaere fravalgt", async () => {
  const state = seasonState();
  state[YOUTH_RACE_OPT_OUT_TABLE] = [{ team_id: "team-a", squad: "u23" }];
  const sb = fakeSupabase(state);
  assert.equal(await isTeamSquadTrainOnly(sb, { teamId: "team-a", squad: "senior" }), false);
  assert.equal(await isTeamSquadTrainOnly(sb, { teamId: "team-a", squad: "u23" }), true);
  assert.deepEqual([...await loadOptedOutKeys(sb, { teamIds: ["team-a"] })], ["team-a|u23"]);
});

test("#5944 firstUnlockedRaceDay: null uden pulje for truppen", async () => {
  const day = await firstUnlockedRaceDay(fakeSupabase(seasonState()), {
    team: { id: "team-a", u23_league_division_id: null }, squad: "u23",
  });
  assert.equal(day, null);
});

// Manuel tilmelding (PUT /races/:id/selection og bulk deler prepareSelectionChange).
const U23_RACE = { id: "u-open-1", status: "scheduled", stages_completed: 0, league_division_id: 10, squad: "u23", race_class: "Class2", season_id: "s4" };
const SELECTION_TEAM = { league_division_id: 1, u23_league_division_id: 10 };

test("#5944 prepareSelectionChange: manuel tilmelding af en Train only-trup afvises med 409", async () => {
  const state = seasonState();
  state[YOUTH_RACE_OPT_OUT_TABLE] = [{ team_id: "team-a", squad: "u23" }];
  const result = await prepareSelectionChange({
    supabase: fakeSupabase(state), race: U23_RACE, teamId: "team-a", teamDivisionId: 1, team: SELECTION_TEAM,
    body: { rider_ids: ["u1"], captain_id: "u1" },
  });
  assert.deepEqual(result, { ok: false, status: 409, error: TRAIN_ONLY_SELECTION_ERROR });
});

test("#5944 prepareSelectionChange: en anden trup paa samme hold paavirkes ikke af U23-valget", async () => {
  const state = seasonState();
  state[YOUTH_RACE_OPT_OUT_TABLE] = [{ team_id: "team-a", squad: "junior" }];
  const result = await prepareSelectionChange({
    supabase: fakeSupabase(state), race: U23_RACE, teamId: "team-a", teamDivisionId: 1, team: SELECTION_TEAM,
    body: { rider_ids: ["u1"], captain_id: "u1" },
  });
  assert.notEqual(result.error, TRAIN_ONLY_SELECTION_ERROR);
});
