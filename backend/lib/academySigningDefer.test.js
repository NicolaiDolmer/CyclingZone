import test from "node:test";
import assert from "node:assert/strict";

import {
  flushPendingAcademySigning,
  flushDeferredAcademySigningsForRace,
} from "./academySigningDefer.js";

// Chainable Supabase-mock, skræddersyet til de tre forespørgsler
// academySigningDefer.js reelt sender:
//   1. riders: head-count (cap-tjek)      .select("id", {count,head}).eq(team_id).eq(is_academy,true)
//   2. riders: pending-opslag              .select(...).in(ids).eq(pending_academy_signing,true)
//   3. riders: flip (update)               .update({...}).eq(id).eq(pending_academy_signing,true).select("id")
//   4. race_entries: løbets deltagere      .select(rider_id).eq(race_id).order  → fetchAllRows (range)
//   5. races/race_entries (getRidersInActiveStageRace, importeret fra stageRaceTransferDefer.js)
function makeSupabase(cfg = {}) {
  const spy = { updates: [], notifies: [] };
  function builder(table) {
    const st = { table, ops: [] };
    const b = {
      select(...a) { st.ops.push(["select", a]); return b; },
      eq(...a) { st.ops.push(["eq", a]); return b; },
      neq(...a) { st.ops.push(["neq", a]); return b; },
      gt(...a) { st.ops.push(["gt", a]); return b; },
      in(...a) { st.ops.push(["in", a]); return b; },
      order(...a) { st.ops.push(["order", a]); return b; },
      update(...a) { st.ops.push(["update", a]); return b; },
      range(...a) { st.ops.push(["range", a]); return Promise.resolve(resolve(st)); },
      then(f, r) { return Promise.resolve(resolve(st)).then(f, r); },
    };
    return b;
  }
  const has = (st, op) => st.ops.some((o) => o[0] === op);
  const eqArg = (st, key) => {
    const hit = st.ops.find((o) => o[0] === "eq" && o[1][0] === key);
    return hit ? hit[1][1] : undefined;
  };
  const selectIsCount = (st) => {
    const hit = st.ops.find((o) => o[0] === "select");
    return !!(hit && hit[1][1] && hit[1][1].count === "exact" && hit[1][1].head === true);
  };
  function resolve(st) {
    const { table } = st;
    if (table === "races") return { data: cfg.activeRaces ?? [], error: cfg.racesError ?? null };
    if (table === "race_entries") {
      if (has(st, "range")) return { data: cfg.raceEntries ?? [], error: null }; // fetchAllRows: løbets deltagere
      if (has(st, "in")) return { data: cfg.overlapEntries ?? [], error: null }; // getRidersInActiveStageRace step 2
      return { data: [], error: null };
    }
    if (table === "riders") {
      if (has(st, "update")) {
        const payload = st.ops.find((o) => o[0] === "update")[1][0];
        const riderId = eqArg(st, "id");
        spy.updates.push({ payload, riderId });
        const alreadyFlushed = (cfg.alreadyFlushedIds || []).includes(riderId);
        return { data: alreadyFlushed ? [] : [{ id: riderId }], error: null };
      }
      if (selectIsCount(st)) {
        const teamId = eqArg(st, "team_id");
        const count = (cfg.academyCountByTeam || {})[teamId] ?? 0;
        return { count, error: cfg.countError ?? null };
      }
      if (has(st, "in")) return { data: cfg.pendingRiders ?? [], error: null };
      return { data: [], error: null };
    }
    return { data: [], error: null };
  }
  return {
    from(t) { return builder(t); },
    _spy: spy,
    _notify: async (...args) => { spy.notifies.push(args); },
  };
}

// ── flushPendingAcademySigning ──────────────────────────────────────────────

test("flushPendingAcademySigning: flipper is_academy + rydder flag + notificerer", async () => {
  const supa = makeSupabase({ academyCountByTeam: { T1: 2 } });
  const flushed = await flushPendingAcademySigning(
    supa,
    { id: "R1", firstname: "Alpha", lastname: "Rider", team_id: "T1" },
    { notifyTeamOwner: supa._notify }
  );
  assert.equal(flushed, true);
  assert.equal(supa._spy.updates.length, 1);
  assert.equal(supa._spy.updates[0].payload.is_academy, true);
  assert.equal(supa._spy.updates[0].payload.pending_academy_signing, false);
  assert.equal(supa._spy.updates[0].riderId, "R1");
  assert.equal(supa._spy.notifies.length, 1);
  assert.equal(supa._spy.notifies[0][0], "T1"); // notificér holdet
  assert.equal(supa._spy.notifies[0][1], "academy_signed");
  const metadata = supa._spy.notifies[0][5];
  assert.equal(metadata.messageCode, "notif.academySigningArrived.message");
});

test("flushPendingAcademySigning: akademi-cap fyldt (8) → forbliver pending, ingen flip", async () => {
  const supa = makeSupabase({ academyCountByTeam: { T1: 8 } });
  const flushed = await flushPendingAcademySigning(
    supa,
    { id: "R1", firstname: "A", lastname: "B", team_id: "T1" },
    { notifyTeamOwner: supa._notify }
  );
  assert.equal(flushed, false);
  assert.equal(supa._spy.updates.length, 0);
  assert.equal(supa._spy.notifies.length, 0);
});

test("flushPendingAcademySigning: idempotent — allerede flushet (0 rows) → false, ingen notif", async () => {
  const supa = makeSupabase({ academyCountByTeam: { T1: 0 }, alreadyFlushedIds: ["R1"] });
  const flushed = await flushPendingAcademySigning(
    supa,
    { id: "R1", firstname: "A", lastname: "B", team_id: "T1" },
    { notifyTeamOwner: supa._notify }
  );
  assert.equal(flushed, false);
  assert.equal(supa._spy.notifies.length, 0);
});

// ── flushDeferredAcademySigningsForRace ─────────────────────────────────────

test("flush: non-stage_race løb → no-op", async () => {
  const supa = makeSupabase({});
  const res = await flushDeferredAcademySigningsForRace(supa, { id: "R1", race_type: "single" });
  assert.deepEqual(res, { ridersFlushed: 0, riderIds: [] });
  assert.equal(supa._spy.updates.length, 0);
});

test("flush: ingen deltagere → no-op", async () => {
  const supa = makeSupabase({ raceEntries: [] });
  const res = await flushDeferredAcademySigningsForRace(supa, { id: "R1", race_type: "stage_race" });
  assert.deepEqual(res, { ridersFlushed: 0, riderIds: [] });
});

test("flush: ingen udskudte optagelser blandt deltagerne → no-op", async () => {
  const supa = makeSupabase({ raceEntries: [{ rider_id: "A" }], pendingRiders: [] });
  const res = await flushDeferredAcademySigningsForRace(supa, { id: "R1", race_type: "stage_race" });
  assert.deepEqual(res, { ridersFlushed: 0, riderIds: [] });
});

test("flush: udskudt optagelse flippes når løbet er slut", async () => {
  const supa = makeSupabase({
    raceEntries: [{ rider_id: "A" }],
    pendingRiders: [{ id: "A", firstname: "Alpha", lastname: "Rider", team_id: "T1" }],
    academyCountByTeam: { T1: 0 },
    activeRaces: [{ id: "R1" }], // kun det finaliserede løb → efter exclude ingen andre aktive
  });
  const res = await flushDeferredAcademySigningsForRace(
    supa,
    { id: "R1", race_type: "stage_race", name: "Tour" },
    { notifyTeamOwner: supa._notify }
  );
  assert.deepEqual(res, { ridersFlushed: 1, riderIds: ["A"] });
  assert.equal(supa._spy.updates[0].payload.is_academy, true);
});

test("flush: overlap-guard — rytter stadig i et ANDET aktivt etapeløb flushes IKKE", async () => {
  const supa = makeSupabase({
    raceEntries: [{ rider_id: "A" }, { rider_id: "B" }],
    pendingRiders: [
      { id: "A", firstname: "A", lastname: "A", team_id: "T1" },
      { id: "B", firstname: "B", lastname: "B", team_id: "T1" },
    ],
    academyCountByTeam: { T1: 0 },
    activeRaces: [{ id: "R1" }, { id: "R2" }], // R2 er stadig aktivt
    overlapEntries: [{ rider_id: "A" }], // A er i R2 → skal IKKE flushes endnu
  });
  const res = await flushDeferredAcademySigningsForRace(
    supa,
    { id: "R1", race_type: "stage_race" },
    { notifyTeamOwner: supa._notify }
  );
  assert.deepEqual(res, { ridersFlushed: 1, riderIds: ["B"] });
});

test("flush: akademi-cap fyldt for holdet → rytteren forbliver pending", async () => {
  const supa = makeSupabase({
    raceEntries: [{ rider_id: "A" }],
    pendingRiders: [{ id: "A", firstname: "A", lastname: "A", team_id: "T1" }],
    academyCountByTeam: { T1: 8 },
    activeRaces: [{ id: "R1" }],
  });
  const res = await flushDeferredAcademySigningsForRace(
    supa,
    { id: "R1", race_type: "stage_race" },
    { notifyTeamOwner: supa._notify }
  );
  assert.deepEqual(res, { ridersFlushed: 0, riderIds: [] });
});
