// #4854 + #5620: spillerens egne traeningsregler — rene funktioner + motor-loader.
import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRiderFatigueRule, downgradeProgram, applyFatigueRules, loadTeamFatigueRules,
  loadRiderIdsWithStageOnDate, previousDateString, TRAINING_FATIGUE_RULES_FLAG_KEY,
} from "./trainingFatigueRules.ts";

const team = (over = {}) => ({ rider_id: null, fatigue_threshold: 60, fallback: "rest", recovery_after_stage: false, ...over });
const rider = (over = {}) => ({ rider_id: "r1", fatigue_threshold: null, fallback: null, recovery_after_stage: null, ...over });

test("G7: ingen regel = ingen automatik", () => {
  const resolved = resolveRiderFatigueRule(null, null);
  assert.deepEqual(resolved, { threshold: null, fallback: null, recoveryAfterStage: false });
  const out = applyFatigueRules({ program: { focus: "vo2max", intensity: "hard" }, rule: resolved, fatigueAtDateStart: 99 });
  assert.equal(out.stamp, null);
  assert.equal(out.intensity, "hard");
  assert.equal(applyFatigueRules({ program: { focus: "vo2max", intensity: "hard" }, rule: null, fatigueAtDateStart: 99 }).stamp, null);
});

test("rytterens undtagelse slaar holdreglen; 'off' fritager; tom raekke foelger holdet", () => {
  assert.deepEqual(resolveRiderFatigueRule(team(), rider({ fatigue_threshold: 40, fallback: "light" })),
    { threshold: 40, fallback: "light", recoveryAfterStage: false });
  assert.deepEqual(resolveRiderFatigueRule(team(), rider({ fallback: "off" })),
    { threshold: null, fallback: null, recoveryAfterStage: false });
  assert.deepEqual(resolveRiderFatigueRule(team({ recovery_after_stage: true }), rider()),
    { threshold: 60, fallback: "rest", recoveryAfterStage: true });
  assert.equal(resolveRiderFatigueRule(team({ recovery_after_stage: true }), rider({ recovery_after_stage: false })).recoveryAfterStage, false);
});

test("graensen: kun OVER graensen slaar til (lig med graensen koerer programmet)", () => {
  const rule = resolveRiderFatigueRule(team(), null);
  const program = { focus: "threshold", intensity: "hard" };
  assert.equal(applyFatigueRules({ program, rule, fatigueAtDateStart: 60 }).stamp, null);
  const hit = applyFatigueRules({ program, rule, fatigueAtDateStart: 61 });
  assert.equal(hit.intensity, "rest");
  assert.equal(hit.focus, "threshold", "hvile bevarer spillerens fokus");
  assert.deepEqual(hit.stamp, { kind: "fatigue", fallback: "rest", fatigue: 61, threshold: 60, from_intensity: "hard" });
});

test("erstatnings-passene: Let bevarer sessionen paa let belastning, restitution og hvile", () => {
  assert.deepEqual(downgradeProgram({ focus: "sprint", intensity: "hard" }, "light"), { focus: "sprint", intensity: "easy" });
  assert.deepEqual(downgradeProgram({ focus: "tempo", intensity: "normal" }, "light"), { focus: "tempo", intensity: "easy" });
  assert.equal(downgradeProgram({ focus: "endurance", intensity: "easy" }, "light"), null, "allerede let");
  assert.deepEqual(downgradeProgram({ focus: "sprint", intensity: "hard" }, "recovery"), { focus: "restitution", intensity: "recovery" });
  assert.equal(downgradeProgram({ focus: "restitution", intensity: "recovery" }, "recovery"), null);
  assert.deepEqual(downgradeProgram({ focus: "restitution", intensity: "recovery" }, "rest"), { focus: "endurance", intensity: "rest" });
  assert.equal(downgradeProgram({ focus: "sprint", intensity: "rest" }, "rest"), null);
});

test("retur til program: samme regel, rytteren under graensen dagen efter = programmet uaendret", () => {
  const rule = resolveRiderFatigueRule(team({ fallback: "recovery" }), null);
  const program = { focus: "vo2max", intensity: "hard" };
  assert.equal(applyFatigueRules({ program, rule, fatigueAtDateStart: 75 }).intensity, "recovery");
  const nextDay = applyFatigueRules({ program, rule, fatigueAtDateStart: 50 });
  assert.equal(nextDay.stamp, null);
  assert.deepEqual({ focus: nextDay.focus, intensity: nextDay.intensity }, program);
  assert.deepEqual(program, { focus: "vo2max", intensity: "hard" }, "programmet muteres aldrig");
});

test("dagen efter en etape: kun foerste felt, kun naar rytteren koerte i gaar", () => {
  const rule = resolveRiderFatigueRule(team({ fatigue_threshold: null, fallback: null, recovery_after_stage: true }), null);
  const program = { focus: "sprint", intensity: "hard" };
  const first = applyFatigueRules({ program, rule, fatigueAtDateStart: 10, slotIndex: 0, rodeStagePreviousDate: true });
  assert.equal(first.intensity, "recovery");
  assert.equal(first.stamp.kind, "after_stage");
  assert.equal(applyFatigueRules({ program, rule, fatigueAtDateStart: 10, slotIndex: 1, rodeStagePreviousDate: true }).stamp, null);
  assert.equal(applyFatigueRules({ program, rule, fatigueAtDateStart: 10, slotIndex: 0, rodeStagePreviousDate: false }).stamp, null);
});

test("begge regler: det tungeste pas vinder", () => {
  const rule = resolveRiderFatigueRule(team({ fallback: "light", recovery_after_stage: true }), null);
  const out = applyFatigueRules({ program: { focus: "sprint", intensity: "hard" }, rule, fatigueAtDateStart: 80, slotIndex: 0, rodeStagePreviousDate: true });
  assert.equal(out.stamp.kind, "after_stage");
  assert.equal(out.intensity, "recovery");
  const later = applyFatigueRules({ program: { focus: "sprint", intensity: "hard" }, rule, fatigueAtDateStart: 80, slotIndex: 2, rodeStagePreviousDate: true });
  assert.equal(later.stamp.kind, "fatigue");
  assert.equal(later.intensity, "easy");
});

test("tidsuafhaengigt (I1): samme input giver samme svar — ingen klokke i funktionen", () => {
  const rule = resolveRiderFatigueRule(team(), null);
  const a = applyFatigueRules({ program: { focus: "sprint", intensity: "hard" }, rule, fatigueAtDateStart: 70 });
  const b = applyFatigueRules({ program: { focus: "sprint", intensity: "hard" }, rule, fatigueAtDateStart: 70 });
  assert.deepEqual(a, b);
});

function fakeSupabase(tables, { errorOn = null } = {}) {
  return {
    from(table) {
      const filters = [];
      const q = {
        select() { return q; },
        eq(c, v) { filters.push((r) => r[c] === v); return q; },
        in(c, vs) { filters.push((r) => vs.includes(r[c])); return q; },
        async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      function run() {
        if (errorOn?.[table]) return { data: null, error: errorOn[table] };
        return { data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null };
      }
      return q;
    },
  };
}

test("loader: hold uden regler = null (motoren koerer som foer)", async () => {
  assert.equal(await loadTeamFatigueRules(fakeSupabase({ team_training_rules: [] }), "t1"), null);
});

test("loader: manglende tabel (foer migrationen) = null, anden fejl kaster", async () => {
  assert.equal(await loadTeamFatigueRules(fakeSupabase({}, { errorOn: { team_training_rules: { code: "42P01", message: "x" } } }), "t1"), null);
  await assert.rejects(() => loadTeamFatigueRules(fakeSupabase({}, { errorOn: { team_training_rules: { code: "500", message: "boom" } } }), "t1"));
});

test("loader: flaget gater motoren (off = ingen regel; beta kun for beta-ejere)", async () => {
  const base = {
    team_training_rules: [{ team_id: "t1", ...team() }],
    teams: [{ id: "t1", user_id: "u1" }],
    users: [{ id: "u1", role: "manager", is_beta_tester: false }],
  };
  const withStage = (value, users = base.users) => fakeSupabase({ ...base, users, app_config: [{ key: TRAINING_FATIGUE_RULES_FLAG_KEY, value }] });
  assert.equal(await loadTeamFatigueRules(withStage("off"), "t1"), null);
  assert.equal(await loadTeamFatigueRules(withStage("beta"), "t1"), null);
  const beta = await loadTeamFatigueRules(withStage("beta", [{ id: "u1", role: "manager", is_beta_tester: true }]), "t1");
  assert.equal(beta.forRider("r1").threshold, 60);
  const on = await loadTeamFatigueRules(withStage("on"), "t1");
  assert.equal(on.anyAfterStage(["r1"]), false);
});

test("etape-opslaget laeser regnskabet for den foregaaende dato", async () => {
  const supabase = fakeSupabase({ training_race_loads: [
    { rider_id: "r1", tick_date: "2026-09-30" }, { rider_id: "r2", tick_date: "2026-09-29" },
  ] });
  const ids = await loadRiderIdsWithStageOnDate(supabase, { riderIds: ["r1", "r2"], previousDate: previousDateString("2026-10-01") });
  assert.deepEqual([...ids], ["r1"]);
  assert.equal(previousDateString("2026-03-01"), "2026-02-28");
});
