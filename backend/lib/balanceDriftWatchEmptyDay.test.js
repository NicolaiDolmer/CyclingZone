import test from "node:test";
import assert from "node:assert/strict";

import { fetchDayInputs, runBalanceDriftWatch } from "./balanceDriftWatch.js";

// #4232 — Balance-drift-vagten (#2414) crashede med
// `TypeError: Cannot read properties of undefined (reading 'map')` hver gang den
// kørte for en dag UDEN løb.
//
// Rodårsag: fetchDayInputs returnerede feltet under to forskellige navne alt
// efter gren — `incidentObservations` på den tomme dag, `incidentObservationsInput`
// på en normal dag. Kalderen (runBalanceDriftWatch) læser kun det sidste, så
// `.map()` blev kaldt på undefined og hele kørslen døde FØR computeDayMetrics.
// Ingen række blev skrevet i race_balance_drift_daily, og vagten var dermed blind
// gennem hele sæsonpausen 24/8-27/8 (68 events i Sentry, CYCLINGZONE-4V).
//
// balanceDriftMetrics.test.js dækker computeDayMetrics på en tom dag, men INGEN
// test kørte runBalanceDriftWatch mod fetchDayInputs' tomme gren — præcis
// samlingen hvor de to kontrakter divergerede. Denne fil lukker det hul: den
// stubber supabase til 0 runs og kræver et GENNEMFØRT run med en persisteret
// række, ikke bare et fravær af exception.

// Minimal, chainable supabase-stub. Hver kædet metode returnerer builderen selv;
// builderen er thenable, så både `await q` og `await q.range(...)` virker.
function makeSupabaseStub({ onUpsert } = {}) {
  const calls = { selects: [], upserts: [] };

  function builder(table, result) {
    const q = {
      select: () => q,
      eq: () => q,
      gte: () => q,
      lt: () => q,
      in: () => q,
      gt: () => q,
      order: () => q,
      limit: () => q,
      range: () => q,
      maybeSingle: () => Promise.resolve(result),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    calls.selects.push(table);
    return q;
  }

  return {
    calls,
    from(table) {
      return {
        select: (...args) => builder(table, { data: [], error: null }).select(...args),
        upsert: (row, opts) => {
          calls.upserts.push({ table, row, opts });
          onUpsert?.(table, row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

test("fetchDayInputs' tomme gren bruger SAMME feltnavne som normal-grenen (#4232)", async () => {
  const supabase = makeSupabaseStub();
  const inputs = await fetchDayInputs(supabase, "2026-08-26");

  // Det feltnavn kalderen faktisk læser. Var det `incidentObservations`, ville
  // undefined.map() kaste et lag længere oppe — se runBalanceDriftWatch.
  assert.ok(
    Array.isArray(inputs.incidentObservationsInput),
    "tom dag skal returnere incidentObservationsInput (ikke incidentObservations)",
  );
  assert.equal(inputs.incidentObservationsInput.length, 0);
  assert.ok(Array.isArray(inputs.observations), "observations skal være et array");
  assert.ok(inputs.winsByRider instanceof Map, "winsByRider skal være en Map");
  assert.ok(inputs.startsByRider instanceof Map, "startsByRider skal være en Map");

  // Ingen af de felter kalderen bruger må mangle — det var netop det hul der
  // gjorde en håndskrevet return-literal farlig i første omgang.
  for (const key of [
    "observations",
    "incidentObservationsInput",
    "winsByRider",
    "startsByRider",
    "jourSansHits",
    "riderStageCount",
    "breakawayWins",
    "breakawayEligibleStages",
    "skippedNullRiderRows",
  ]) {
    assert.notEqual(inputs[key], undefined, `tom dag mangler feltet "${key}"`);
  }
});

test("runBalanceDriftWatch gennemfører en løbsfri dag og persisterer dagens række (#4232)", async () => {
  const written = [];
  const supabase = makeSupabaseStub({
    onUpsert: (table, row) => {
      if (table === "race_balance_drift_daily") written.push(row);
    },
  });

  const captured = [];
  const result = await runBalanceDriftWatch({
    supabase,
    now: new Date("2026-08-27T02:00:00.000Z"), // måldag = 26/8, midt i sæsonpausen
    captureExceptionFn: (err) => captured.push(err),
  });

  assert.equal(result.date, "2026-08-26");
  assert.ok(result.metrics, "en løbsfri dag skal stadig give et metrics-objekt");
  assert.ok(result.statuses, "en løbsfri dag skal stadig klassificeres");
  assert.deepEqual(captured, [], "ingen fejl må rapporteres til Sentry på en tom dag");

  // Kernen: dagens række SKAL skrives. Uden den forplanter hullet sig til
  // streak-poolingen (#2731), som læser de seneste persisterede rækker.
  assert.equal(written.length, 1, "der skal skrives præcis én race_balance_drift_daily-række");
  assert.equal(written[0].metric_date, "2026-08-26");
});
