import test from "node:test";
import assert from "node:assert/strict";

import { runDeferredTransferHealSweep } from "./deferredTransferHealSweep.js";

// Chainable Supabase-mock — samme opskrift som stageRaceTransferDefer.test.js's
// makeSupabase (delt afhængighedsgraf: riders/races/race_entries), da sweep'en
// genbruger getRidersInActiveStageRace + flushParkedRider fra samme modul.
function makeSupabase(cfg = {}) {
  const spy = { updates: [], notifies: [] };
  function builder() {
    const st = { table: null, ops: [] };
    const b = {
      from(t) { st.table = t; return b; },
      select(...a) { st.ops.push(["select", a]); return b; },
      eq(...a) { st.ops.push(["eq", a]); return b; },
      neq(...a) { st.ops.push(["neq", a]); return b; },
      gt(...a) { st.ops.push(["gt", a]); return b; },
      in(...a) { st.ops.push(["in", a]); return b; },
      not(...a) { st.ops.push(["not", a]); return b; },
      order(...a) { st.ops.push(["order", a]); return b; },
      delete(...a) { st.ops.push(["delete", a]); return b; },
      update(...a) { st.ops.push(["update", a]); return b; },
      range(...a) { st.ops.push(["range", a]); return Promise.resolve(resolve(st)); },
      then(f, r) { return Promise.resolve(resolve(st)).then(f, r); },
    };
    return b;
  }
  const has = (st, op) => st.ops.some((o) => o[0] === op);
  const argOf = (st, op) => { const o = st.ops.find((x) => x[0] === op); return o ? o[1] : null; };
  function resolve(st) {
    const { table } = st;
    if (table === "races") return { data: cfg.activeRaces ?? [], error: cfg.racesError ?? null };
    if (table === "race_entries") {
      if (has(st, "delete")) return { error: null }; // clearFutureRaceEntries delete
      if (has(st, "in")) return { data: cfg.overlapEntries ?? [], error: null }; // getRidersInActiveStageRace step 2
      return { data: [], error: null }; // clearFutureRaceEntries select
    }
    if (table === "riders") {
      if (has(st, "update")) {
        const payload = argOf(st, "update")[0];
        const guard = st.ops.filter((o) => o[0] === "eq").map((o) => o[1]);
        spy.updates.push({ payload, guard });
        const riderId = guard[0]?.[1];
        const alreadyFlushed = (cfg.alreadyFlushedIds || []).includes(riderId);
        return { data: alreadyFlushed ? [] : [{ id: riderId }], error: null };
      }
      if (has(st, "not")) return { data: cfg.parkedRiders ?? [], error: cfg.parkedError ?? null }; // hoved-kandidat-query
      return { data: [], error: null };
    }
    return { data: [], error: null };
  }
  return {
    from(t) { return builder().from(t); },
    _spy: spy,
    _notify: async (...args) => { spy.notifies.push(args); },
  };
}

test("kræver supabase-klient", async () => {
  await assert.rejects(() => runDeferredTransferHealSweep({ supabase: null }), /Supabase client required/);
});

test("ingen parkerede ryttere → no-op", async () => {
  const supa = makeSupabase({ parkedRiders: [] });
  const res = await runDeferredTransferHealSweep({ supabase: supa });
  assert.deepEqual(res, { candidates: 0, healed: 0, failed: 0, stillRacing: 0, errors: [] });
  assert.equal(supa._spy.updates.length, 0);
});

test("flusher en parkeret rytter der IKKE er i et aktivt etapeløb (#3330)", async () => {
  const supa = makeSupabase({
    parkedRiders: [{ id: "vasco", firstname: "Vasco", lastname: "Fernandes", pending_team_id: "team-hansen" }],
    activeRaces: [], // ingen aktive stage races overhovedet
  });
  const res = await runDeferredTransferHealSweep({
    supabase: supa,
    notifyTeamOwner: supa._notify,
    now: new Date("2026-08-04T12:00:00Z"),
  });
  assert.equal(res.candidates, 1);
  assert.equal(res.healed, 1);
  assert.equal(res.failed, 0);
  assert.equal(res.stillRacing, 0);
  assert.equal(supa._spy.updates.length, 1);
  assert.equal(supa._spy.updates[0].payload.team_id, "team-hansen");
  assert.equal(supa._spy.updates[0].payload.pending_team_id, null);
  assert.equal(supa._spy.updates[0].payload.acquired_at, "2026-08-04T12:00:00.000Z");
  assert.equal(supa._spy.notifies.length, 1);
  assert.equal(supa._spy.notifies[0][0], "team-hansen", "notificér den nye ejer");
});

test("IKKE flusher en rytter der er midt i et aktivt etapeløb", async () => {
  const supa = makeSupabase({
    parkedRiders: [{ id: "mid-race", firstname: "Mid", lastname: "Race", pending_team_id: "buyer-team" }],
    activeRaces: [{ id: "R1" }],
    overlapEntries: [{ rider_id: "mid-race" }],
  });
  const res = await runDeferredTransferHealSweep({ supabase: supa, notifyTeamOwner: supa._notify });
  assert.equal(res.candidates, 1);
  assert.equal(res.healed, 0);
  assert.equal(res.stillRacing, 1);
  assert.equal(supa._spy.updates.length, 0, "rytteren er midt i et løb — INGEN update-kald");
  assert.equal(supa._spy.notifies.length, 0);
});

test("blandet population: kun den ikke-racende rytter flushes", async () => {
  const supa = makeSupabase({
    parkedRiders: [
      { id: "stuck", firstname: "Stuck", lastname: "Rider", pending_team_id: "team-a" },
      { id: "racing", firstname: "Racing", lastname: "Rider", pending_team_id: "team-b" },
    ],
    activeRaces: [{ id: "R1" }],
    overlapEntries: [{ rider_id: "racing" }],
  });
  const res = await runDeferredTransferHealSweep({ supabase: supa, notifyTeamOwner: supa._notify });
  assert.equal(res.candidates, 2);
  assert.equal(res.healed, 1);
  assert.equal(res.stillRacing, 1);
  assert.equal(supa._spy.updates.length, 1);
  assert.equal(supa._spy.updates[0].guard[0][1], "stuck");
});

test("idempotent — genkørsel efter flush finder pending_team_id=null → 0 candidates → 0 healed", async () => {
  // Første kørsel: rytteren er stadig parkeret i cfg.parkedRiders (mock-fixturen
  // ændrer sig ikke af sig selv), men update-guarden simulerer at han ALLEREDE
  // blev flushet af et tidligere tick (0 rows tilbage).
  const supa = makeSupabase({
    parkedRiders: [{ id: "vasco", firstname: "Vasco", lastname: "Fernandes", pending_team_id: "team-hansen" }],
    activeRaces: [],
    alreadyFlushedIds: ["vasco"],
  });
  const res = await runDeferredTransferHealSweep({ supabase: supa, notifyTeamOwner: supa._notify });
  assert.equal(res.candidates, 1, "kandidat-queryen fandt stadig rækken (mock er statisk)");
  assert.equal(res.healed, 0, "men update-guarden (0 rows) gør flush'et til et no-op");
  assert.equal(supa._spy.notifies.length, 0, "ingen notifikation når intet blev flushet");
});

test("per-rytter isolation: én fejl stopper ikke resten af sweep'en", async () => {
  const supa = makeSupabase({
    parkedRiders: [
      { id: "fails", firstname: "Fail", lastname: "Rider", pending_team_id: "team-a" },
      { id: "ok", firstname: "Ok", lastname: "Rider", pending_team_id: "team-b" },
    ],
    activeRaces: [],
  });
  // Simpelt fejl-scenarie: notifyTeamOwner kaster for den ene rytter.
  let calls = 0;
  const notifyTeamOwner = async (teamId) => {
    calls += 1;
    if (teamId === "team-a") throw new Error("notify boomed");
  };
  const res = await runDeferredTransferHealSweep({ supabase: supa, notifyTeamOwner });
  assert.equal(res.candidates, 2);
  assert.equal(res.healed, 1, "kun 'ok'-rytteren tælles som healed");
  assert.equal(res.failed, 1);
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].riderId, "fails");
  assert.equal(calls, 2, "begge ryttere blev forsøgt, fejlen isolerede ikke resten af loopet");
});

test("query-fejl på riders-kandidat-lookup kaster (så cron/monitorCron kan se DB-fejlen)", async () => {
  const supa = makeSupabase({ parkedError: { message: "permission denied for table riders" } });
  await assert.rejects(() => runDeferredTransferHealSweep({ supabase: supa }));
});
