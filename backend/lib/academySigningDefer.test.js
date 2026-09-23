import test from "node:test";
import assert from "node:assert/strict";

import {
  flushPendingAcademySigning,
  flushDeferredAcademySigningsForRace,
} from "./academySigningDefer.js";
import { SQUAD_CAPS } from "./squads.js";
import { LAUNCH_REFERENCE_YEAR } from "./riderSeasonAge.js";

// Chainable Supabase-mock, skræddersyet til de tre forespørgsler
// academySigningDefer.js reelt sender:
//   1. riders: pending-opslag              .select(...).in(ids).eq(pending_academy_signing,true)
//   2. rpc("flush_pending_academy_signing") — #5432: tælling pr. mål-trup + flip
//      under låsen. Mocken tæller pr. hold OG trup (cfg.squadCounts) mod det loft
//      kalderen sender, præcis som den ægte RPC.
//   3. seasons: aktiv sæson                .select(number).eq(status,active).maybeSingle()
//   4. race_entries: løbets deltagere      .select(rider_id).eq(race_id).order  → fetchAllRows (range)
//   5. races/race_entries (getRidersInActiveStageRace, importeret fra stageRaceTransferDefer.js)
function makeSupabase(cfg = {}) {
  const spy = { updates: [], notifies: [], rpcCalls: [] };
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
      maybeSingle() { return Promise.resolve(resolve(st)); },
      then(f, r) { return Promise.resolve(resolve(st)).then(f, r); },
    };
    return b;
  }
  const has = (st, op) => st.ops.some((o) => o[0] === op);
  const selectIsCount = (st) => {
    const hit = st.ops.find((o) => o[0] === "select");
    return !!(hit && hit[1][1] && hit[1][1].count === "exact" && hit[1][1].head === true);
  };
  function resolve(st) {
    const { table } = st;
    if (table === "races") return { data: cfg.activeRaces ?? [], error: cfg.racesError ?? null };
    if (table === "seasons") return { data: { number: cfg.seasonNumber ?? 1 }, error: null };
    if (table === "race_entries") {
      if (has(st, "range")) return { data: cfg.raceEntries ?? [], error: null }; // fetchAllRows: løbets deltagere
      if (has(st, "in")) return { data: cfg.overlapEntries ?? [], error: null }; // getRidersInActiveStageRace step 2
      return { data: [], error: null };
    }
    if (table === "riders") {
      if (has(st, "update") || selectIsCount(st)) {
        throw new Error("#5432: flippet og tællingen hører til i RPC'en, ikke i direkte riders-kald");
      }
      if (has(st, "in")) return { data: cfg.pendingRiders ?? [], error: null };
      return { data: [], error: null };
    }
    return { data: [], error: null };
  }
  return {
    from(t) { return builder(t); },
    rpc(fn, args) {
      spy.rpcCalls.push({ fn, args });
      assert.equal(fn, "flush_pending_academy_signing");
      if (cfg.rpcError) return Promise.resolve({ data: null, error: cfg.rpcError });
      const count = cfg.squadCounts?.[args.p_team_id]?.[args.p_squad] ?? 0;
      if (count >= args.p_squad_cap) return Promise.resolve({ data: { ok: false, code: "academy_full" }, error: null });
      if ((cfg.alreadyFlushedIds || []).includes(args.p_rider_id)) {
        return Promise.resolve({ data: { ok: false, code: "not_pending" }, error: null });
      }
      spy.updates.push({ riderId: args.p_rider_id, squad: args.p_squad });
      return Promise.resolve({ data: { ok: true, squad: args.p_squad, squad_count: count + 1 }, error: null });
    },
    _spy: spy,
    _notify: async (...args) => { spy.notifies.push(args); },
  };
}

// ── flushPendingAcademySigning ──────────────────────────────────────────────

test("flushPendingAcademySigning: flipper via RPC'en med mål-truppen + dens loft fra squads.js; notificerer", async () => {
  const supa = makeSupabase({ squadCounts: { T1: { u23: 2 } } });
  const flushed = await flushPendingAcademySigning(
    supa,
    // 20 år i sæson 1 → u23
    { id: "R1", firstname: "Alpha", lastname: "Rider", team_id: "T1", birthdate: `${LAUNCH_REFERENCE_YEAR - 20}-05-01` },
    { notifyTeamOwner: supa._notify, seasonNumber: 1 }
  );
  assert.equal(flushed, true);
  assert.deepEqual(supa._spy.rpcCalls[0].args, {
    p_team_id: "T1", p_rider_id: "R1", p_squad: "u23", p_squad_cap: SQUAD_CAPS.u23,
  });
  assert.equal(supa._spy.updates.length, 1);
  assert.equal(supa._spy.updates[0].riderId, "R1");
  assert.equal(supa._spy.notifies.length, 1);
  assert.equal(supa._spy.notifies[0][0], "T1"); // notificér holdet
  assert.equal(supa._spy.notifies[0][1], "academy_signed");
  const metadata = supa._spy.notifies[0][5];
  assert.equal(metadata.messageCode, "notif.academySigningArrived.message");
});

test("flushPendingAcademySigning: mål-truppen fuld → forbliver pending, ingen flip, ingen notif", async () => {
  // Uden fødselsdato → junior (samme regel som #4619-backfill'en).
  const supa = makeSupabase({ squadCounts: { T1: { junior: SQUAD_CAPS.junior } } });
  const flushed = await flushPendingAcademySigning(
    supa,
    { id: "R1", firstname: "A", lastname: "B", team_id: "T1" },
    { notifyTeamOwner: supa._notify, seasonNumber: 1 }
  );
  assert.equal(flushed, false);
  assert.equal(supa._spy.updates.length, 0);
  assert.equal(supa._spy.notifies.length, 0);
});

test("#5432 flushPendingAcademySigning: en fyldt ANDEN trup låser ikke flippet (den gamle cap talte hele akademiet)", async () => {
  const supa = makeSupabase({ squadCounts: { T1: { u23: SQUAD_CAPS.u23 } } });
  const flushed = await flushPendingAcademySigning(
    supa,
    { id: "R1", firstname: "A", lastname: "B", team_id: "T1", birthdate: null },
    { notifyTeamOwner: supa._notify, seasonNumber: 1 }
  );
  assert.equal(flushed, true);
  assert.equal(supa._spy.rpcCalls[0].args.p_squad, "junior");
});

test("flushPendingAcademySigning: RPC-transportfejl kaster", async () => {
  const bad = makeSupabase({ rpcError: { message: "db down" } });
  await assert.rejects(
    () => flushPendingAcademySigning(bad, { id: "R1", team_id: "T1" }, { notifyTeamOwner: bad._notify, seasonNumber: 1 }),
    /db down/,
  );
});

test("flushPendingAcademySigning: idempotent — allerede flushet (not_pending) → false, ingen notif", async () => {
  const supa = makeSupabase({ alreadyFlushedIds: ["R1"] });
  const flushed = await flushPendingAcademySigning(
    supa,
    { id: "R1", firstname: "A", lastname: "B", team_id: "T1" },
    { notifyTeamOwner: supa._notify, seasonNumber: 1 }
  );
  assert.equal(flushed, false);
  assert.equal(supa._spy.notifies.length, 0);
});

test("flushPendingAcademySigning: ukendt sæson → forbliver pending uden RPC-kald (aldrig et gæt ned i junior)", async () => {
  const supa = makeSupabase({});
  for (const seasonNumber of [null, undefined, NaN]) {
    const flushed = await flushPendingAcademySigning(
      supa,
      { id: "R1", firstname: "A", lastname: "B", team_id: "T1", birthdate: `${LAUNCH_REFERENCE_YEAR - 21}-05-01` },
      { notifyTeamOwner: supa._notify, seasonNumber }
    );
    assert.equal(flushed, false);
  }
  assert.equal(supa._spy.rpcCalls.length, 0);
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
    activeRaces: [{ id: "R1" }], // kun det finaliserede løb → efter exclude ingen andre aktive
  });
  const res = await flushDeferredAcademySigningsForRace(
    supa,
    { id: "R1", race_type: "stage_race", name: "Tour" },
    { notifyTeamOwner: supa._notify }
  );
  assert.deepEqual(res, { ridersFlushed: 1, riderIds: ["A"] });
  assert.equal(supa._spy.updates[0].riderId, "A");
});

test("flush: overlap-guard — rytter stadig i et ANDET aktivt etapeløb flushes IKKE", async () => {
  const supa = makeSupabase({
    raceEntries: [{ rider_id: "A" }, { rider_id: "B" }],
    pendingRiders: [
      { id: "A", firstname: "A", lastname: "A", team_id: "T1" },
      { id: "B", firstname: "B", lastname: "B", team_id: "T1" },
    ],
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

test("flush: mål-truppen fuld for holdet → rytteren forbliver pending", async () => {
  const supa = makeSupabase({
    raceEntries: [{ rider_id: "A" }],
    pendingRiders: [{ id: "A", firstname: "A", lastname: "A", team_id: "T1" }],
    squadCounts: { T1: { junior: SQUAD_CAPS.junior } },
    activeRaces: [{ id: "R1" }],
  });
  const res = await flushDeferredAcademySigningsForRace(
    supa,
    { id: "R1", race_type: "stage_race" },
    { notifyTeamOwner: supa._notify }
  );
  assert.deepEqual(res, { ridersFlushed: 0, riderIds: [] });
});

test("#5432 flush: den aktive sæson bestemmer mål-truppen (sæsonalder, ikke kalenderalder)", async () => {
  // Født LAUNCH_REFERENCE_YEAR − 18: junior i sæson 1, U23 i sæson 2.
  const birthdate = `${LAUNCH_REFERENCE_YEAR - 18}-05-01`;
  for (const [seasonNumber, squad] of [[1, "junior"], [2, "u23"]]) {
    const supa = makeSupabase({
      raceEntries: [{ rider_id: "A" }],
      pendingRiders: [{ id: "A", firstname: "A", lastname: "A", team_id: "T1", birthdate }],
      activeRaces: [{ id: "R1" }],
      seasonNumber,
    });
    await flushDeferredAcademySigningsForRace(supa, { id: "R1", race_type: "stage_race" }, { notifyTeamOwner: supa._notify });
    assert.equal(supa._spy.rpcCalls[0].args.p_squad, squad, `sæson ${seasonNumber}`);
  }
});
