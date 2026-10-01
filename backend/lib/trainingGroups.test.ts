// #6000 · traeningsgrupper: rene funktioner + gruppe-undtagelsen i motorens loader.
import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeGroupName, sanitizeRiderIds, followerIds, groupSeedDays, groupRuleRow, effectiveRiderRuleRow,
  groupFatiguePatch, copyWeekDays, loadGroupFatigueRuleRows, markRidersOwnPlan, TRAINING_GROUPS_FLAG_KEY,
  type MemberRow,
} from "./trainingGroups.ts";
import {
  loadTeamFatigueRules, resolveRiderFatigueRule, TRAINING_FATIGUE_RULES_FLAG_KEY, type FatigueRuleRow,
} from "./trainingFatigueRules.ts";
import { programWeekDaysFor } from "./trainingPrograms.js";

test("navn: trimmes og samles, 1..40 tegn", () => {
  assert.equal(normalizeGroupName("  Sprint   train "), "Sprint train");
  assert.equal(normalizeGroupName(""), null);
  assert.equal(normalizeGroupName("x".repeat(41)), null);
  assert.equal(normalizeGroupName(42), null);
});

test("ryttere: kun holdets egne, ingen dubletter; ikke-liste afvises", () => {
  assert.deepEqual(sanitizeRiderIds(["a", "b", "a", "z"], ["a", "b"]), ["a", "b"]);
  assert.equal(sanitizeRiderIds("a", ["a"]), null);
  assert.equal(sanitizeRiderIds([1], ["a"]), null);
});

test("foelgere: medlemmer der stadig er holdets og ikke har egen plan", () => {
  const members: MemberRow[] = [
    { rider_id: "a", group_id: "g", team_id: "t", follows_group: true },
    { rider_id: "b", group_id: "g", team_id: "t", follows_group: false },
    { rider_id: "c", group_id: "h", team_id: "t", follows_group: true },
    { rider_id: "gone", group_id: "g", team_id: "t", follows_group: true },
  ];
  assert.deepEqual(followerIds(members, "g", ["a", "b", "c"]), ["a"]);
});

test("startpunkt: gruppens felter, ellers foerste medlems uge (sorteret), ellers hans saaede uge", () => {
  const sprinter = programWeekDaysFor("sprinter");
  const climber = programWeekDaysFor("hill_climber");
  assert.deepEqual(groupSeedDays({ group: { days: climber }, memberIds: ["b"], ownDaysByRider: new Map(), seedsByRider: {} }),
    { days: climber, isSeed: false });
  assert.deepEqual(groupSeedDays({
    group: { days: null }, memberIds: ["b", "a"], ownDaysByRider: new Map([["a", sprinter], ["b", climber]]), seedsByRider: {},
  }), { days: sprinter, isSeed: true });
  assert.deepEqual(groupSeedDays({
    group: { days: null }, memberIds: ["a"], ownDaysByRider: new Map(), seedsByRider: { a: climber },
  }), { days: climber, isSeed: true });
  assert.deepEqual(groupSeedDays({ group: { days: null }, memberIds: [], ownDaysByRider: new Map(), seedsByRider: {} }),
    { days: null, isSeed: true });
});

test("kopi: ingen delte objekter", () => {
  const days = programWeekDaysFor("sprinter") as Record<string, { slots?: Array<string | null> }>;
  days.mon.slots = [null, "recovery", null, null, null];
  const copy = copyWeekDays(days) as Record<string, { slots?: Array<string | null> }>;
  assert.deepEqual(copy, days);
  assert.notEqual(copy.mon, days.mon);
  assert.notEqual(copy.mon.slots, days.mon.slots);
});

test("undtagelse: validering af klientens mode", () => {
  assert.deepEqual(groupFatiguePatch({ mode: "team" }), { fatigue_threshold: null, fallback: null });
  assert.deepEqual(groupFatiguePatch({ mode: "off" }), { fatigue_threshold: null, fallback: "off" });
  assert.deepEqual(groupFatiguePatch({ mode: "own", threshold: 70, fallback: "light" }), { fatigue_threshold: 70, fallback: "light" });
  assert.equal(groupFatiguePatch({ mode: "own", threshold: 70.5, fallback: "light" }), null);
  assert.equal(groupFatiguePatch({ mode: "own", threshold: 70, fallback: "off" }), null);
  assert.equal(groupFatiguePatch({ mode: "x" }), null);
  assert.equal(groupRuleRow({ fatigue_threshold: null, fallback: null }), null);
});

test("stigen rytter → gruppe → hold for traethedsgraensen", () => {
  const team: FatigueRuleRow = { rider_id: null, fatigue_threshold: 65, fallback: "rest", recovery_after_stage: true };
  const group = groupRuleRow({ fatigue_threshold: 70, fallback: "light" });
  const own: FatigueRuleRow = { rider_id: "a", fatigue_threshold: 75, fallback: "recovery", recovery_after_stage: null };
  const afterStageOnly: FatigueRuleRow = { rider_id: "a", fatigue_threshold: null, fallback: null, recovery_after_stage: false };
  // Kun holdet.
  assert.equal(resolveRiderFatigueRule(team, effectiveRiderRuleRow(null, null)).threshold, 65);
  // Gruppen slaar holdet.
  const viaGroup = resolveRiderFatigueRule(team, effectiveRiderRuleRow(null, group));
  assert.deepEqual([viaGroup.threshold, viaGroup.fallback, viaGroup.recoveryAfterStage], [70, "light", true]);
  // Rytterens egen slaar gruppen.
  assert.equal(resolveRiderFatigueRule(team, effectiveRiderRuleRow(own, group)).threshold, 75);
  // Rytter-raekke uden graense: gruppens graense, men rytterens etape-valg bevares.
  const mixed = resolveRiderFatigueRule(team, effectiveRiderRuleRow(afterStageOnly, group));
  assert.deepEqual([mixed.threshold, mixed.recoveryAfterStage], [70, false]);
  // Gruppe "off" = ingen graense for gruppens ryttere.
  assert.equal(resolveRiderFatigueRule(team, effectiveRiderRuleRow(null, groupRuleRow({ fatigue_threshold: null, fallback: "off" }))).threshold, null);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSupabase(tables: Record<string, any[]>, { errorOn = {} as Record<string, { code?: string; message: string }> } = {}) {
  const writes: Array<{ table: string; patch: unknown }> = [];
  return {
    writes,
    from(table: string) {
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      let patch: unknown = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select() { return q; },
        update(p: unknown) { patch = p; return q; },
        eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
        in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return q; },
        async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
      };
      function run() {
        if (errorOn[table]) return { data: null, error: errorOn[table] };
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (patch) { writes.push({ table, patch }); for (const r of rows) Object.assign(r, patch); }
        return { data: rows, error: null };
      }
      return q;
    },
  };
}

test("motorens loader: gruppe-undtagelsen gaelder kun naar groups-flaget er aabent for holdet", async () => {
  const base = {
    team_training_rules: [],
    training_groups: [{ id: "g", team_id: "t1", fatigue_threshold: 70, fallback: "light" }],
    training_group_members: [{ rider_id: "r1", group_id: "g", team_id: "t1", follows_group: true }],
    teams: [{ id: "t1", user_id: "u1" }],
    users: [{ id: "u1", role: "manager", is_beta_tester: true }],
  };
  const withStages = (groups: string) => fakeSupabase({
    ...base,
    app_config: [{ key: TRAINING_FATIGUE_RULES_FLAG_KEY, value: "beta" }, { key: TRAINING_GROUPS_FLAG_KEY, value: groups }],
  });
  assert.equal(await loadTeamFatigueRules(withStages("off"), "t1"), null);
  const on = await loadTeamFatigueRules(withStages("beta"), "t1");
  assert.equal(on?.forRider("r1").threshold, 70);
  assert.equal(on?.forRider("r2").threshold, null);
});

test("gruppe-opslaget: manglende tabel = ingen; anden fejl kaster; ingen undtagelser = eet opslag", async () => {
  assert.equal((await loadGroupFatigueRuleRows(fakeSupabase({}, { errorOn: { training_groups: { code: "42P01", message: "x" } } }), "t1")).size, 0);
  await assert.rejects(() => loadGroupFatigueRuleRows(fakeSupabase({}, { errorOn: { training_groups: { code: "500", message: "boom" } } }), "t1"));
  const none = await loadGroupFatigueRuleRows(fakeSupabase({ training_groups: [{ id: "g", team_id: "t1", fatigue_threshold: null, fallback: null }] }), "t1");
  assert.equal(none.size, 0);
});

test("egen plan: rytterne holder op med at foelge gruppen; fejl vaelter aldrig rettelsen", async () => {
  const supabase = fakeSupabase({ training_group_members: [
    { rider_id: "r1", team_id: "t1", follows_group: true }, { rider_id: "r2", team_id: "t1", follows_group: true },
  ] });
  await markRidersOwnPlan(supabase, "t1", ["r1"]);
  assert.deepEqual(supabase.writes, [{ table: "training_group_members", patch: { follows_group: false } }]);
  const reported: Error[] = [];
  await markRidersOwnPlan(fakeSupabase({}, { errorOn: { training_group_members: { code: "500", message: "boom" } } }), "t1", ["r1"], (e) => reported.push(e));
  assert.equal(reported.length, 1);
  await markRidersOwnPlan(fakeSupabase({}, { errorOn: { training_group_members: { code: "42P01", message: "x" } } }), "t1", ["r1"], (e) => reported.push(e));
  assert.equal(reported.length, 1);
});
