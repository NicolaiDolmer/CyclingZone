// Tests for aiRecoverySweep.js (#3015) — AI-hold får samme daglige recovery
// som menneskeholdene (kun fatigue/form, ingen ability-progression).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recoverRidersForTeam, runAiRecoverySweep } from "./aiRecoverySweep.js";
import { nextFatigue, nextForm } from "./riderCondition.js";

// ── Generisk select-chain: select/eq/order/range/then, altid samme resolveWith ──
function makeSelectChain(resolveWith) {
  const obj = {
    select() { return obj; },
    eq() { return obj; },
    order() { return obj; },
    in() { return obj; },
    range() { return Promise.resolve(resolveWith); },
    then(resolve, reject) { return Promise.resolve(resolveWith).then(resolve, reject); },
  };
  return obj;
}

function makeMockSupabase({
  aiTeams = [],
  existingRuns = [],
  ridersByTeam = {},
  conditionByRider = {},
  abilityByRider = {},
  reservedTicks = new Set(),
  failReserveFor = new Set(),
  failRidersLoadFor = new Set(),
  upsertCalls = [],
  insertCalls = [],
  updateCalls = [],
} = {}) {
  return {
    from(table) {
      if (table === "teams") {
        return makeSelectChain({ data: aiTeams, error: null });
      }
      if (table === "ai_recovery_runs") {
        return {
          select() { return makeSelectChain({ data: existingRuns, error: null }); },
          insert(row) {
            insertCalls.push(row);
            if (failReserveFor.has(row.team_id)) {
              return Promise.resolve({ error: { message: "insert boom" } });
            }
            const key = `${row.team_id}|${row.tick_date}`;
            if (reservedTicks.has(key)) {
              return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
            }
            reservedTicks.add(key);
            return Promise.resolve({ error: null });
          },
          update(patch) {
            const filters = [];
            const chain = {
              eq(field, val) { filters.push([field, val]); return chain; },
              then(resolve, reject) {
                updateCalls.push({ patch, filters });
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return chain;
          },
        };
      }
      if (table === "riders") {
        let teamId;
        const chain = {
          select() { return chain; },
          eq(field, val) { if (field === "team_id") teamId = val; return chain; },
          then(resolve, reject) {
            if (failRidersLoadFor.has(teamId)) {
              return Promise.resolve({ data: null, error: { message: "riders load failed" } }).then(resolve, reject);
            }
            return Promise.resolve({ data: ridersByTeam[teamId] ?? [], error: null }).then(resolve, reject);
          },
        };
        return chain;
      }
      if (table === "rider_condition") {
        let ids = [];
        const chain = {
          select() { return chain; },
          in(field, val) { ids = val; return chain; },
          then(resolve, reject) {
            const rows = ids.map((id) => conditionByRider[id]).filter(Boolean);
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
          upsert(rows) {
            upsertCalls.push(rows);
            return Promise.resolve({ error: null });
          },
        };
        return chain;
      }
      if (table === "rider_derived_abilities") {
        let ids = [];
        const chain = {
          select() { return chain; },
          in(field, val) { ids = val; return chain; },
          then(resolve, reject) {
            const rows = ids.map((id) => abilityByRider[id]).filter(Boolean);
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };
        return chain;
      }
      throw new Error(`makeMockSupabase: uventet tabel '${table}'`);
    },
  };
}

// ── recoverRidersForTeam ────────────────────────────────────────────────────

describe("recoverRidersForTeam", () => {
  it("kører nextFatigue/nextForm med intensity rest og skriver kun fatigue/form/updated_at", async () => {
    const upsertCalls = [];
    const supabase = makeMockSupabase({
      ridersByTeam: { t1: [{ id: "r1" }, { id: "r2" }] },
      conditionByRider: {
        r1: { rider_id: "r1", form: 40, fatigue: 100 },
        r2: { rider_id: "r2", form: 60, fatigue: 90 },
      },
      abilityByRider: { r1: { rider_id: "r1", recovery: 70 } }, // r2 mangler → default 50
      upsertCalls,
    });
    const now = new Date("2026-08-03T21:00:00Z");
    const n = await recoverRidersForTeam({ supabase, teamId: "t1", now });
    assert.equal(n, 2);
    assert.equal(upsertCalls.length, 1);
    const rows = upsertCalls[0];
    assert.equal(rows.length, 2);

    const expectedFatigueR1 = nextFatigue({ fatigue: 100, intensity: "rest", recoveryAbility: 70 });
    const expectedFormR1 = nextForm({ form: 40, fatigue: expectedFatigueR1 });
    const r1Row = rows.find((r) => r.rider_id === "r1");
    assert.equal(r1Row.fatigue, expectedFatigueR1);
    assert.equal(r1Row.form, expectedFormR1);
    assert.ok(r1Row.fatigue < 100, "en AI-rytter på træthed 100 skal falde efter ét tick");
    assert.equal(Object.keys(r1Row).sort().join(","), "fatigue,form,rider_id,updated_at");

    const expectedFatigueR2 = nextFatigue({ fatigue: 90, intensity: "rest", recoveryAbility: 50 });
    const r2Row = rows.find((r) => r.rider_id === "r2");
    assert.equal(r2Row.fatigue, expectedFatigueR2);
  });

  it("giver neutral default (fatigue 0, form 50) for rytter uden rider_condition-række", async () => {
    const upsertCalls = [];
    const supabase = makeMockSupabase({
      ridersByTeam: { t1: [{ id: "rNew" }] },
      conditionByRider: {},
      abilityByRider: {},
      upsertCalls,
    });
    const n = await recoverRidersForTeam({ supabase, teamId: "t1", now: new Date() });
    assert.equal(n, 1);
    const row = upsertCalls[0][0];
    // nextFatigue(0, rest) klemmes til 0 (kan ikke gå under gulvet).
    assert.equal(row.fatigue, 0);
  });

  it("returnerer 0 og laver intet upsert-kald for et hold uden ryttere", async () => {
    const upsertCalls = [];
    const supabase = makeMockSupabase({ ridersByTeam: {}, upsertCalls });
    const n = await recoverRidersForTeam({ supabase, teamId: "empty-team", now: new Date() });
    assert.equal(n, 0);
    assert.equal(upsertCalls.length, 0);
  });
});

// ── runAiRecoverySweep ───────────────────────────────────────────────────────

describe("runAiRecoverySweep", () => {
  const afterWindow = new Date("2026-08-03T20:30:00Z"); // 22:30 CEST
  const beforeWindow = new Date("2026-08-03T19:00:00Z"); // 21:00 CEST

  it("returnerer before_window når det er for tidligt", async () => {
    const supabase = makeMockSupabase({});
    const result = await runAiRecoverySweep({ supabase, now: beforeWindow, isEnabled: async () => true });
    assert.deepEqual(result, { swept: 0, ridersRecovered: 0, skipped: "before_window" });
  });

  it("returnerer flag_off når daily_training_enabled er slukket", async () => {
    const supabase = makeMockSupabase({});
    const result = await runAiRecoverySweep({ supabase, now: afterWindow, isEnabled: async () => false });
    assert.deepEqual(result, { swept: 0, ridersRecovered: 0, skipped: "flag_off" });
  });

  it("kører kun AI-hold uden allerede-kørt reservation og tæller swept/ridersRecovered", async () => {
    const supabase = makeMockSupabase({
      aiTeams: [{ id: "ai1" }, { id: "ai2" }],
      existingRuns: [{ team_id: "ai2", tick_date: "2026-08-03" }], // ai2 kørte allerede i dag
      ridersByTeam: { ai1: [{ id: "r1" }, { id: "r2" }, { id: "r3" }] },
      conditionByRider: {
        r1: { rider_id: "r1", form: 50, fatigue: 100 },
        r2: { rider_id: "r2", form: 50, fatigue: 100 },
        r3: { rider_id: "r3", form: 50, fatigue: 100 },
      },
    });
    const result = await runAiRecoverySweep({ supabase, now: afterWindow, isEnabled: async () => true });
    assert.deepEqual(result, { swept: 1, ridersRecovered: 3 });
  });

  it("tæller IKKE en reservations-kollision (23505) som swept eller failed", async () => {
    const reservedTicks = new Set(["ai1|2026-08-03"]); // simulerer at et andet tick allerede reserverede
    const supabase = makeMockSupabase({
      aiTeams: [{ id: "ai1" }],
      existingRuns: [], // teamsNeedingSweep ser IKKE endnu ai1 som kørt (racen)
      ridersByTeam: { ai1: [{ id: "r1" }] },
      conditionByRider: { r1: { rider_id: "r1", form: 50, fatigue: 100 } },
      reservedTicks,
    });
    const result = await runAiRecoverySweep({ supabase, now: afterWindow, isEnabled: async () => true });
    assert.deepEqual(result, { swept: 0, ridersRecovered: 0 });
  });

  it("ét holds fejl (riders-load) stopper ikke det næste hold, tælles som failed", async () => {
    const supabase = makeMockSupabase({
      aiTeams: [{ id: "ai1" }, { id: "ai2" }],
      ridersByTeam: { ai2: [{ id: "r2" }] },
      conditionByRider: { r2: { rider_id: "r2", form: 50, fatigue: 100 } },
      failRidersLoadFor: new Set(["ai1"]),
    });
    const result = await runAiRecoverySweep({ supabase, now: afterWindow, isEnabled: async () => true });
    assert.equal(result.swept, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.ridersRecovered, 1);
  });

  it("kalder IKKE noget når der ingen AI-hold er", async () => {
    const supabase = makeMockSupabase({ aiTeams: [] });
    const result = await runAiRecoverySweep({ supabase, now: afterWindow, isEnabled: async () => true });
    assert.deepEqual(result, { swept: 0, ridersRecovered: 0 });
  });

  // ── #3459 D4: no-op når løbsdags-motoren har overtaget AI-restitutionen ──────
  it("race_day_engine_enabled=on → no-op (dailyTrainingEngine dækker AI-hold nu), ingen riders/upsert-kald", async () => {
    const supabase = makeMockSupabase({
      aiTeams: [{ id: "ai1" }],
      ridersByTeam: { ai1: [{ id: "r1" }] },
      conditionByRider: { r1: { rider_id: "r1", form: 50, fatigue: 100 } },
    });
    const result = await runAiRecoverySweep({
      supabase, now: afterWindow, isEnabled: async () => true, isRaceDayEnabled: async () => true,
    });
    assert.deepEqual(result, { swept: 0, ridersRecovered: 0, skipped: "race_day_engine_on" });
  });

  it("race_day_engine_enabled=off (default) → uændret adfærd (bit-identisk med før #3459)", async () => {
    const supabase = makeMockSupabase({
      aiTeams: [{ id: "ai1" }],
      ridersByTeam: { ai1: [{ id: "r1" }] },
      conditionByRider: { r1: { rider_id: "r1", form: 50, fatigue: 100 } },
    });
    const result = await runAiRecoverySweep({
      supabase, now: afterWindow, isEnabled: async () => true, isRaceDayEnabled: async () => false,
    });
    assert.deepEqual(result, { swept: 1, ridersRecovered: 1 });
  });
});
