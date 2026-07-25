// #2916 — adfærdstests for carry-over-kontrakten.
//
// Beviser det issue'et påstår: uden carry-over er managerens træningsplan væk i
// den nye sæson (og motoren vælger tavst et auto-program), og MED carry-over
// lander præcis de rigtige rækker — hverken flere eller færre.

import test from "node:test";
import assert from "node:assert/strict";

import {
  carryOverManagerSetup,
  carryTrainingPlans,
  revalidateManualRaceEntries,
  revalidatePeakPlans,
} from "./seasonCarryOver.js";
import { resolveProgram } from "./dailyTraining.js";
import { isHumanTeam } from "./humanTeamFilter.js";

const S1 = "00000000-0000-0000-0000-000000000001";
const S2 = "00000000-0000-0000-0000-000000000002";

// ─── Minimal Supabase-mock ────────────────────────────────────────────────────
// Understøtter kun det carry-over-modulet faktisk bruger: select/eq/in/order/
// range/upsert samt embedded `race:race_id!inner(...)`-select.

function createMockSupabase(state) {
  const writes = [];

  function buildQuery(table) {
    const q = {
      __filters: [],
      __embed: null,
      select(cols) {
        if (typeof cols === "string" && cols.includes("race:race_id!inner")) {
          q.__embed = { as: "race", from: "races", localKey: "race_id" };
        }
        return q;
      },
      eq(col, val) {
        q.__filters.push({ kind: "eq", col, val });
        return q;
      },
      in(col, vals) {
        q.__filters.push({ kind: "in", col, vals: new Set(vals) });
        return q;
      },
      order() {
        return q;
      },
      range(from, to) {
        const rows = q.__rows();
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
      then(resolve) {
        return resolve({ data: q.__rows(), error: null });
      },
      __rows() {
        return (state[table] || [])
          .map((row) => {
            if (!q.__embed) return row;
            const parent = (state[q.__embed.from] || []).find(
              (p) => p.id === row[q.__embed.localKey]
            );
            return { ...row, [q.__embed.as]: parent ?? null };
          })
          .filter((row) =>
            q.__filters.every((f) => {
              const value = f.col.includes(".")
                ? f.col.split(".").reduce((acc, part) => acc?.[part], row)
                : row[f.col];
              return f.kind === "eq" ? value === f.val : f.vals.has(value);
            })
          );
      },
    };
    return q;
  }

  return {
    __writes: writes,
    from(table) {
      return {
        select: (cols) => buildQuery(table).select(cols),
        upsert(rows, opts) {
          writes.push({ table, rows, opts });
          for (const row of rows) {
            const dup = (state[table] || []).some(
              (r) =>
                r.team_id === row.team_id &&
                r.rider_id === row.rider_id &&
                r.season_id === row.season_id
            );
            if (dup && opts?.ignoreDuplicates) continue;
            state[table] = state[table] || [];
            state[table].push({ id: `gen-${state[table].length}`, ...row });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
}

function baseState(overrides = {}) {
  return {
    teams: [
      { id: "team-human", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: 10 },
      { id: "team-moved", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: 20 },
      { id: "team-test", is_ai: false, is_bank: false, is_frozen: false, is_test_account: true, league_division_id: 10 },
      { id: "team-ai", is_ai: true, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: 10 },
    ],
    riders: [
      { id: "rider-stays", team_id: "team-human", is_retired: false },
      { id: "rider-sold", team_id: "team-moved", is_retired: false },
      { id: "rider-retired", team_id: "team-human", is_retired: true },
      { id: "rider-moved", team_id: "team-moved", is_retired: false },
      { id: "rider-test", team_id: "team-test", is_retired: false },
    ],
    training_plans: [
      { id: "p1", team_id: "team-human", rider_id: "rider-stays", season_id: S1, focus: "sprint", intensity: "hard" },
      { id: "p2", team_id: "team-human", rider_id: "rider-sold", season_id: S1, focus: "climbing", intensity: "normal" },
      { id: "p3", team_id: "team-human", rider_id: "rider-retired", season_id: S1, focus: "tt", intensity: "easy" },
      { id: "p4", team_id: "team-ai", rider_id: "rider-moved", season_id: S1, focus: "sprint", intensity: "hard" },
      { id: "p5", team_id: "team-test", rider_id: "rider-test", season_id: S1, focus: "sprint", intensity: "easy" },
    ],
    races: [
      { id: "race-own-pool", season_id: S2, league_division_id: 20 },
      { id: "race-other-pool", season_id: S2, league_division_id: 99 },
    ],
    rider_peak_plans: [],
    race_entries: [],
    ...overrides,
  };
}

// ─── Rod-årsagen: hvad sker der UDEN carry-over ───────────────────────────────

test("uden carry-over vælger motoren tavst et auto-program (rod-årsagen i #2916)", () => {
  // Managerens valg i sæson N.
  const managerPlan = { focus: "sprint", intensity: "hard" };
  assert.deepEqual(resolveProgram(managerPlan, "sprinter"), managerPlan);

  // Samme rytter i sæson N+1 uden en plan-række: ingen fejl, ingen pause —
  // et andet program, hver dag, uden at manageren får besked.
  const withoutPlan = resolveProgram(null, "sprinter");
  assert.notDeepEqual(withoutPlan, managerPlan);
  assert.equal(withoutPlan.intensity, "normal");
});

// ─── training_plans (COPY) ────────────────────────────────────────────────────

test("carryTrainingPlans kopierer kun planer for ryttere der stadig er på holdet", async () => {
  const state = baseState();
  const supabase = createMockSupabase(state);

  const stats = await carryTrainingPlans({ supabase, fromSeasonId: S1, toSeasonId: S2 });

  assert.equal(stats.source_rows, 5);
  assert.equal(stats.skipped_non_human_team, 2, "AI-hold + test-konto skal falde ud");
  assert.equal(stats.skipped_rider_left_team, 1, "rider-sold er skiftet hold");
  assert.equal(stats.skipped_rider_retired, 1);
  assert.equal(stats.eligible, 1);
  assert.equal(stats.carried, 1);
  assert.equal(stats.teams, 1);

  const carried = state.training_plans.filter((p) => p.season_id === S2);
  assert.equal(carried.length, 1);
  assert.deepEqual(
    { rider: carried[0].rider_id, focus: carried[0].focus, intensity: carried[0].intensity },
    { rider: "rider-stays", focus: "sprint", intensity: "hard" }
  );
});

test("carryTrainingPlans er idempotent — anden kørsel kopierer intet nyt", async () => {
  const state = baseState();
  const supabase = createMockSupabase(state);

  await carryTrainingPlans({ supabase, fromSeasonId: S1, toSeasonId: S2 });
  const second = await carryTrainingPlans({ supabase, fromSeasonId: S1, toSeasonId: S2 });

  assert.equal(second.carried, 0);
  assert.equal(second.skipped_already_present, 1);
  assert.equal(state.training_plans.filter((p) => p.season_id === S2).length, 1);
});

test("carryTrainingPlans overskriver ALDRIG en plan manageren allerede har lagt i den nye sæson", async () => {
  const state = baseState();
  state.training_plans.push({
    id: "already", team_id: "team-human", rider_id: "rider-stays", season_id: S2,
    focus: "endurance", intensity: "easy",
  });
  const supabase = createMockSupabase(state);

  const stats = await carryTrainingPlans({ supabase, fromSeasonId: S1, toSeasonId: S2 });

  assert.equal(stats.carried, 0);
  assert.equal(stats.skipped_already_present, 1);
  const s2 = state.training_plans.filter((p) => p.season_id === S2);
  assert.equal(s2.length, 1);
  assert.equal(s2[0].focus, "endurance", "den nye sæsons egen plan skal stå urørt");
});

test("carryTrainingPlans med dryRun skriver ingenting men tæller det samme", async () => {
  const state = baseState();
  const supabase = createMockSupabase(state);

  const stats = await carryTrainingPlans({ supabase, fromSeasonId: S1, toSeasonId: S2, dryRun: true });

  assert.equal(stats.eligible, 1);
  assert.equal(stats.carried, 0);
  assert.equal(stats.dry_run, true);
  assert.equal(supabase.__writes.length, 0);
  assert.equal(state.training_plans.filter((p) => p.season_id === S2).length, 0);
});

// ─── is_test_account-ekskludering (#2852) ─────────────────────────────────────

test("#2852 · test-konti tælles ikke som menneskehold nogen steder i carry-over", async () => {
  const state = baseState();
  const supabase = createMockSupabase(state);

  const result = await carryOverManagerSetup({ supabase, fromSeasonId: S1, toSeasonId: S2 });

  assert.equal(result.human_teams, 2, "kun team-human + team-moved");
  assert.equal(
    state.training_plans.some((p) => p.season_id === S2 && p.team_id === "team-test"),
    false,
    "test-kontoens plan må ikke bæres over"
  );
});

test("#2852 · isHumanTeam afviser test-konti, bank, frosne og AI-hold", () => {
  assert.equal(isHumanTeam({ is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }), true);
  assert.equal(isHumanTeam({ is_ai: false, is_bank: false, is_frozen: false, is_test_account: true }), false);
  assert.equal(isHumanTeam({ is_ai: false, is_bank: true, is_frozen: false, is_test_account: false }), false);
  assert.equal(isHumanTeam({ is_ai: false, is_bank: false, is_frozen: true, is_test_account: false }), false);
  assert.equal(isHumanTeam({ is_ai: true, is_bank: false, is_frozen: false, is_test_account: false }), false);
  // NULL-kolonner tæller som "ikke sat" = menneskehold (samme som boardWeekendUpdate.js).
  assert.equal(isHumanTeam({ is_ai: false }), true);
  assert.equal(isHumanTeam(null), false);
});

// ─── rider_peak_plans (REVALIDATE) ────────────────────────────────────────────

test("revalidatePeakPlans tæller planer mod løb i en anden pulje og manglende mål", async () => {
  const state = baseState({
    rider_peak_plans: [
      { id: "pp-ok", rider_id: "rider-moved", season_id: S2, target_race_id: "race-own-pool" },
      { id: "pp-wrong", rider_id: "rider-moved", season_id: S2, target_race_id: "race-other-pool" },
      { id: "pp-gone", rider_id: "rider-moved", season_id: S2, target_race_id: "race-deleted" },
    ],
  });
  const supabase = createMockSupabase(state);

  const stats = await revalidatePeakPlans({ supabase, toSeasonId: S2 });

  assert.equal(stats.checked, 3);
  assert.equal(stats.wrong_pool, 1);
  assert.equal(stats.missing_target, 1);
  assert.equal(stats.teams_affected, 1);
  // Rører aldrig managerens data.
  assert.equal(state.rider_peak_plans.length, 3);
  assert.equal(supabase.__writes.length, 0);
});

// ─── race_entries (REVALIDATE) ────────────────────────────────────────────────

test("revalidateManualRaceEntries tæller manuelle udtagelser i forkert pulje", async () => {
  const state = baseState({
    race_entries: [
      { race_id: "race-own-pool", team_id: "team-moved", is_auto_filled: false },
      { race_id: "race-other-pool", team_id: "team-moved", is_auto_filled: false },
    ],
  });
  const supabase = createMockSupabase(state);

  const stats = await revalidateManualRaceEntries({ supabase, toSeasonId: S2 });

  assert.equal(stats.checked, 2);
  assert.equal(stats.wrong_pool, 1);
  assert.equal(stats.teams_affected, 1);
  assert.equal(supabase.__writes.length, 0);
});

// ─── Orkestrering ─────────────────────────────────────────────────────────────

test("carryOverManagerSetup samler alle tre flader og rapporterer ingen handler-drift", async () => {
  const state = baseState({
    rider_peak_plans: [
      { id: "pp-wrong", rider_id: "rider-moved", season_id: S2, target_race_id: "race-other-pool" },
    ],
    race_entries: [
      { race_id: "race-other-pool", team_id: "team-moved", is_auto_filled: false },
    ],
  });
  const supabase = createMockSupabase(state);

  const result = await carryOverManagerSetup({ supabase, fromSeasonId: S1, toSeasonId: S2 });

  assert.deepEqual(result.handler_drift, []);
  assert.equal(result.carried_total, 1);
  assert.equal(result.surfaces.training_plans.carried, 1);
  assert.equal(result.surfaces.rider_peak_plans.wrong_pool, 1);
  assert.equal(result.surfaces.race_entries.wrong_pool, 1);
});

test("carryOverManagerSetup kræver begge sæson-id'er", async () => {
  const supabase = createMockSupabase(baseState());
  await assert.rejects(() => carryOverManagerSetup({ supabase, toSeasonId: S2 }), /fromSeasonId/);
  await assert.rejects(() => carryOverManagerSetup({ supabase, fromSeasonId: S1 }), /toSeasonId/);
});
