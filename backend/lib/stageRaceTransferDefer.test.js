import test from "node:test";
import assert from "node:assert/strict";

import {
  getRidersInActiveStageRace,
  shouldDeferTeamChange,
  flushDeferredTransfersForRace,
} from "./stageRaceTransferDefer.js";

// Chainable Supabase-mock. cfg styrer svar pr. (tabel, operations); en spy samler
// riders-updates + notify-kald til assertions.
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
      if (has(st, "range")) return { data: cfg.raceEntries ?? [], error: null }; // fetchAllRows: løbets deltagere
      if (has(st, "delete")) return { error: null }; // clearFutureRaceEntries delete
      if (has(st, "in")) return { data: cfg.overlapEntries ?? [], error: null }; // overlap step 2
      return { data: [], error: null }; // clearFutureRaceEntries select
    }
    if (table === "riders") {
      if (has(st, "update")) {
        const payload = argOf(st, "update")[0];
        const guard = st.ops.filter((o) => o[0] === "eq").map((o) => o[1]);
        spy.updates.push({ payload, guard });
        // guard: [['id', X], ['pending_team_id', Y]] — simulér "allerede flushet" hvis konfigureret
        const riderId = guard[0]?.[1];
        const alreadyFlushed = (cfg.alreadyFlushedIds || []).includes(riderId);
        return { data: alreadyFlushed ? [] : [{ id: riderId }], error: null };
      }
      if (has(st, "not")) return { data: cfg.parkedRiders ?? [], error: null }; // parked lookup
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

// ── getRidersInActiveStageRace ──────────────────────────────────────────────

test("getRidersInActiveStageRace: tom riderIds → [] (ingen query)", async () => {
  const supa = makeSupabase({ activeRaces: [{ id: "R1" }] });
  assert.deepEqual(await getRidersInActiveStageRace(supa, []), []);
});

test("getRidersInActiveStageRace: ingen aktive stage races → []", async () => {
  const supa = makeSupabase({ activeRaces: [] });
  assert.deepEqual(await getRidersInActiveStageRace(supa, ["A", "B"]), []);
});

test("getRidersInActiveStageRace: returnerer deduped ryttere i aktive stage races", async () => {
  const supa = makeSupabase({
    activeRaces: [{ id: "R1" }],
    overlapEntries: [{ rider_id: "A" }, { rider_id: "A" }, { rider_id: "B" }],
  });
  const result = await getRidersInActiveStageRace(supa, ["A", "B", "C"]);
  assert.deepEqual([...result].sort(), ["A", "B"]);
});

test("getRidersInActiveStageRace: excludeRaceId filtrerer det løb fra → [] når det var eneste aktive", async () => {
  const supa = makeSupabase({ activeRaces: [{ id: "R1" }], overlapEntries: [{ rider_id: "A" }] });
  assert.deepEqual(await getRidersInActiveStageRace(supa, ["A"], { excludeRaceId: "R1" }), []);
});

// ── shouldDeferTeamChange ───────────────────────────────────────────────────

test("shouldDeferTeamChange: true når en involveret rytter er i et aktivt etapeløb", async () => {
  const supa = makeSupabase({ activeRaces: [{ id: "R1" }], overlapEntries: [{ rider_id: "A" }] });
  assert.equal(await shouldDeferTeamChange(supa, ["A"]), true);
});

test("shouldDeferTeamChange: false når ingen er i et aktivt etapeløb", async () => {
  const supa = makeSupabase({ activeRaces: [] });
  assert.equal(await shouldDeferTeamChange(supa, ["A", "B"]), false);
});

// ── flushDeferredTransfersForRace ───────────────────────────────────────────

test("flush: non-stage_race løb → no-op", async () => {
  const supa = makeSupabase({});
  const res = await flushDeferredTransfersForRace(supa, { id: "R1", race_type: "single" });
  assert.deepEqual(res, { ridersFlushed: 0, riderIds: [] });
  assert.equal(supa._spy.updates.length, 0);
});

test("flush: ingen parkerede deltagere → no-op", async () => {
  const supa = makeSupabase({ raceEntries: [{ rider_id: "A" }], parkedRiders: [] });
  const res = await flushDeferredTransfersForRace(supa, { id: "R1", race_type: "stage_race" });
  assert.deepEqual(res, { ridersFlushed: 0, riderIds: [] });
  assert.equal(supa._spy.updates.length, 0);
});

test("flush: parkeret deltager flyttes pending_team_id → team_id + notificeres", async () => {
  const supa = makeSupabase({
    raceEntries: [{ rider_id: "A" }],
    parkedRiders: [{ id: "A", firstname: "Alpha", lastname: "Rider", pending_team_id: "T2" }],
    activeRaces: [{ id: "R1" }], // kun det finaliserede → efter exclude ingen andre aktive
  });
  const res = await flushDeferredTransfersForRace(supa, { id: "R1", race_type: "stage_race", name: "Tour" }, {
    notifyTeamOwner: supa._notify,
    now: new Date("2026-07-03T12:00:00Z"),
  });
  assert.deepEqual(res, { ridersFlushed: 1, riderIds: ["A"] });
  assert.equal(supa._spy.updates.length, 1);
  assert.equal(supa._spy.updates[0].payload.team_id, "T2");
  assert.equal(supa._spy.updates[0].payload.pending_team_id, null);
  assert.equal(supa._spy.notifies.length, 1);
  assert.equal(supa._spy.notifies[0][0], "T2"); // notificér den nye ejer
});

test("flush: overlap-guard — rytter stadig i et ANDET aktivt etapeløb flushes IKKE", async () => {
  const supa = makeSupabase({
    raceEntries: [{ rider_id: "A" }, { rider_id: "B" }],
    parkedRiders: [
      { id: "A", firstname: "A", lastname: "A", pending_team_id: "T2" },
      { id: "B", firstname: "B", lastname: "B", pending_team_id: "T2" },
    ],
    activeRaces: [{ id: "R1" }, { id: "R2" }], // R2 er stadig aktivt
    overlapEntries: [{ rider_id: "A" }], // A er i R2 → skal IKKE flushes endnu
  });
  const res = await flushDeferredTransfersForRace(supa, { id: "R1", race_type: "stage_race", name: "Tour" }, {
    notifyTeamOwner: supa._notify,
  });
  assert.deepEqual(res, { ridersFlushed: 1, riderIds: ["B"] });
  assert.equal(supa._spy.updates.length, 1);
  assert.equal(supa._spy.updates[0].guard[0][1], "B");
});

test("flush: idempotent — allerede-flushet rytter (0 rows) tælles ikke", async () => {
  const supa = makeSupabase({
    raceEntries: [{ rider_id: "A" }],
    parkedRiders: [{ id: "A", firstname: "A", lastname: "A", pending_team_id: "T2" }],
    activeRaces: [{ id: "R1" }],
    alreadyFlushedIds: ["A"], // update returnerer 0 rows
  });
  const res = await flushDeferredTransfersForRace(supa, { id: "R1", race_type: "stage_race" }, {
    notifyTeamOwner: supa._notify,
  });
  assert.deepEqual(res, { ridersFlushed: 0, riderIds: [] });
  assert.equal(supa._spy.notifies.length, 0); // ingen notifikation når intet blev flushet
});
