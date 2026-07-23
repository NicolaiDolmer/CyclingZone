import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTRACT_EXPIRED_RELEASE_TYPE,
  buildContractExpiredReleaseNotification,
  releaseExpiredContractRiders,
} from "./contractExpiryRelease.js";

// #2744-B · Rytterkontrakt-udløb → fri-agent ved sæsonskifte.
//
// fetchExpiredContractRiders injiceres (samme mønster som
// contractExpiringNotifications.test.js) — så disse tests beviser
// RELEASE-LOGIKKEN (hvem frigives, hvordan, hvem notificeres, stage-race-defer,
// stats), mens selve query-formen (contract_end_season <= seasonNumber, team_id
// IS NOT NULL, is_academy=false) er verificeret direkte mod prod (196/1/195,
// 23/7) og matcher kildekoden i defaultFetchExpiredContractRiders 1:1.

// ─── Minimal mock-supabase — kun de tabeller/queries releaseExpiredContractRiders
//    faktisk rammer via de IKKE-injicerede side-effekt-helpers (getRidersInActiveStageRace,
//    clearFutureRaceEntriesSafe, closeTransferListingsForRiders). ─────────────────

function makeMockSupabase({ activeStageRaceRiderIds = [], unreleasableRiderIds = [], erroringRiderIds = [] } = {}) {
  const listingUpdates = [];
  const riderUpdates = [];

  function builder(table) {
    const b = {
      __table: table,
      __filters: {},
      __op: null,
      __select: "",
      select(c) { b.__select = c || ""; return b; },
      eq(col, val) { b.__filters[col] = val; return b; },
      neq(col, val) { b.__filters[`neq:${col}`] = val; return b; },
      gt(col, val) { b.__filters[`gt:${col}`] = val; return b; },
      in(col, vals) { b.__filters[`in:${col}`] = vals; return b; },
      not() { return b; },
      order() { return b; },
      update(patch) { b.__op = "update"; b.__patch = patch; return b; },
      delete() { b.__op = "delete"; return b; },
      then(resolve) { resolve(resolveQuery()); },
    };

    function resolveQuery() {
      if (table === "races") {
        // getRidersInActiveStageRace: races-lookup. Non-empty kun hvis vi har
        // aktive stage-race-ryttere at teste defer-stien med.
        return activeStageRaceRiderIds.length
          ? { data: [{ id: "race-active-1" }], error: null }
          : { data: [], error: null };
      }
      if (table === "race_entries") {
        if (b.__select.includes("races!inner")) {
          // clearFutureRaceEntriesSafe's lookup — ingen fremtidige entries i disse tests.
          return { data: [], error: null };
        }
        // getRidersInActiveStageRace's entries-lookup.
        const rows = activeStageRaceRiderIds.map((id) => ({ rider_id: id }));
        return { data: rows, error: null };
      }
      if (table === "riders" && b.__op === "update") {
        const riderId = b.__filters.id;
        riderUpdates.push({ riderId, patch: { ...b.__patch } });
        if (erroringRiderIds.includes(riderId)) return { data: null, error: { message: "simulated transient DB error" } };
        if (unreleasableRiderIds.includes(riderId)) return { data: [], error: null };
        return { data: [{ id: riderId }], error: null };
      }
      if (table === "transfer_listings" && b.__op === "update") {
        listingUpdates.push({ patch: { ...b.__patch }, filters: { ...b.__filters } });
        return { data: null, error: null };
      }
      return { data: [], error: null };
    }

    return b;
  }

  return { supabase: { from: builder }, listingUpdates, riderUpdates };
}

function makeNotifyRecorder(behavior = () => ({ delivered: true })) {
  const calls = [];
  const notify = async (args) => { calls.push(args); return behavior(args); };
  return { notify, calls };
}

// ─── buildContractExpiredReleaseNotification ──────────────────────────────────

test("build: type, titel og metadata-koder er korrekte (EN-first, DA i backendMessages.json)", () => {
  const payload = buildContractExpiredReleaseNotification({
    riderName: "Primoz Roglic", riderId: "r1", seasonNumber: 1,
  });
  assert.equal(payload.type, CONTRACT_EXPIRED_RELEASE_TYPE);
  assert.equal(payload.type, "contract_expired_release");
  assert.equal(payload.relatedId, "r1");
  assert.match(payload.message, /Primoz Roglic/);
  assert.match(payload.message, /free agent/);
  assert.equal(payload.metadata.titleCode, "notif.contractExpiredRelease.title");
  assert.equal(payload.metadata.messageCode, "notif.contractExpiredRelease.message");
  assert.deepEqual(payload.metadata.messageParams, { rider: "Primoz Roglic", season: 1 });
});

// ─── releaseExpiredContractRiders ─────────────────────────────────────────────

test("frigiver PRÆCIS de kandidater fetchExpiredContractRiders returnerer — team_id/kontrakt-felter nulstillet", async () => {
  const { supabase, riderUpdates } = makeMockSupabase();
  const { notify, calls } = makeNotifyRecorder();

  const candidates = [
    { id: "r1", firstname: "A", lastname: "A", team_id: "human-team-1", contract_end_season: 1,
      team: { user_id: "u1", is_ai: false, is_frozen: false } },
    { id: "r2", firstname: "B", lastname: "B", team_id: "ai-team-1", contract_end_season: 1,
      team: { user_id: null, is_ai: true, is_frozen: false } },
  ];

  const stats = await releaseExpiredContractRiders({
    supabase, seasonNumber: 1, notify,
    fetchExpiredContractRiders: async () => candidates,
  });

  assert.deepEqual(stats, { candidates: 2, released: 2, deferredByRacing: 0, notified: 1, notifyFailed: 0, failed: 0 });
  assert.equal(riderUpdates.length, 2, "begge kandidater fik en update-kald");
  for (const u of riderUpdates) {
    assert.deepEqual(u.patch, {
      team_id: null, pending_team_id: null, salary: null,
      contract_length: null, contract_end_season: null, acquired_at: null,
    });
  }
  // Kun menneske-ejeren (r1) notificeres — AI-holdet (r2) har intet user_id.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, "u1");
  assert.equal(calls[0].relatedId, "r1");
});

test("ryttere midt i et AKTIVT fleretape-løb udskydes (kan ikke parkeres, samme #1995/#2617-begrænsning som squadEnforcement)", async () => {
  const { supabase, riderUpdates } = makeMockSupabase({ activeStageRaceRiderIds: ["r-racing"] });
  const { notify } = makeNotifyRecorder();

  const candidates = [
    { id: "r-racing", firstname: "Racing", lastname: "Now", team_id: "t1", contract_end_season: 1,
      team: { user_id: "u1", is_ai: false, is_frozen: false } },
    { id: "r-free", firstname: "Free", lastname: "Now", team_id: "t2", contract_end_season: 1,
      team: { user_id: "u2", is_ai: false, is_frozen: false } },
  ];

  const stats = await releaseExpiredContractRiders({
    supabase, seasonNumber: 1, notify,
    fetchExpiredContractRiders: async () => candidates,
  });

  assert.equal(stats.candidates, 2);
  assert.equal(stats.deferredByRacing, 1);
  assert.equal(stats.released, 1);
  assert.equal(riderUpdates.length, 1, "kun den ikke-racende rytter opdateres");
  assert.equal(riderUpdates[0].riderId, "r-free");
});

test("concurrency-guard: rytter der skiftede hold sideløbende (0 rows fra update) tælles ikke som released", async () => {
  const { supabase } = makeMockSupabase({ unreleasableRiderIds: ["r-moved"] });
  const { notify, calls } = makeNotifyRecorder();

  const stats = await releaseExpiredContractRiders({
    supabase, seasonNumber: 1, notify,
    fetchExpiredContractRiders: async () => [
      { id: "r-moved", firstname: "M", lastname: "M", team_id: "t1", contract_end_season: 1,
        team: { user_id: "u1", is_ai: false, is_frozen: false } },
    ],
  });

  assert.equal(stats.released, 0, "0-rows update → ikke talt som released, ingen notifikation sendt");
  assert.equal(calls.length, 0);
});

test("AI-ejede/fri agenter (intet user_id) frigives stadig, men notificeres ikke", async () => {
  const { supabase, riderUpdates } = makeMockSupabase();
  const { notify, calls } = makeNotifyRecorder();

  const stats = await releaseExpiredContractRiders({
    supabase, seasonNumber: 1, notify,
    fetchExpiredContractRiders: async () => [
      { id: "r1", firstname: "AI", lastname: "Rider", team_id: "ai-team", contract_end_season: 1,
        team: { user_id: null, is_ai: true, is_frozen: false } },
    ],
  });

  assert.equal(stats.released, 1);
  assert.equal(riderUpdates.length, 1);
  assert.equal(calls.length, 0, "ingen user_id → ingen notifikation, men rytteren frigives stadig");
});

test("frosne hold notificeres ikke (samme diskriminator som resten af motoren)", async () => {
  const { supabase } = makeMockSupabase();
  const { notify, calls } = makeNotifyRecorder();

  const stats = await releaseExpiredContractRiders({
    supabase, seasonNumber: 1, notify,
    fetchExpiredContractRiders: async () => [
      { id: "r1", firstname: "Frozen", lastname: "Owner", team_id: "frozen-team", contract_end_season: 1,
        team: { user_id: "u1", is_ai: false, is_frozen: true } },
    ],
  });

  assert.equal(stats.released, 1, "frigivelsen sker stadig — kun notifikationen er gated");
  assert.equal(calls.length, 0);
});

test("ingen kandidater → nul-stats, ingen writes", async () => {
  const { supabase, riderUpdates } = makeMockSupabase();
  const { notify, calls } = makeNotifyRecorder();

  const stats = await releaseExpiredContractRiders({
    supabase, seasonNumber: 1, notify,
    fetchExpiredContractRiders: async () => [],
  });

  assert.deepEqual(stats, { candidates: 0, released: 0, deferredByRacing: 0, notified: 0, notifyFailed: 0, failed: 0 });
  assert.equal(riderUpdates.length, 0);
  assert.equal(calls.length, 0);
});

test("ugyldigt seasonNumber → nul-stats uden at røre DB'en", async () => {
  const { supabase } = makeMockSupabase();
  let fetchCalled = false;
  const stats = await releaseExpiredContractRiders({
    supabase, seasonNumber: NaN,
    fetchExpiredContractRiders: async () => { fetchCalled = true; return []; },
  });
  assert.deepEqual(stats, { candidates: 0, released: 0, deferredByRacing: 0, notified: 0, notifyFailed: 0, failed: 0 });
  assert.equal(fetchCalled, false, "guard-clause skal returnere FØR fetch — ingen unødig DB-tur");
});

test("en fejlende notifikation isoleres og tælles separat (resten af releasen fortsætter)", async () => {
  const { supabase, riderUpdates } = makeMockSupabase();
  const { notify } = makeNotifyRecorder((args) => {
    if (args.relatedId === "r1") throw new Error("transient insert error");
    return { delivered: true };
  });

  const stats = await releaseExpiredContractRiders({
    supabase, seasonNumber: 1, notify,
    fetchExpiredContractRiders: async () => [
      { id: "r1", firstname: "A", lastname: "A", team_id: "t1", contract_end_season: 1,
        team: { user_id: "u1", is_ai: false, is_frozen: false } },
      { id: "r2", firstname: "B", lastname: "B", team_id: "t2", contract_end_season: 1,
        team: { user_id: "u2", is_ai: false, is_frozen: false } },
    ],
  });

  assert.equal(stats.released, 2, "begge frigives uanset notifikations-fejl");
  assert.equal(stats.notified, 1);
  assert.equal(stats.notifyFailed, 1);
  assert.equal(riderUpdates.length, 2);
});

// ─── Partial-failure-observability (coordinator-review-fund) ──────────────────
// En rytters EGEN frigivelse (ikke kun hans notifikation) kan fejle midt i et
// 196-rækkers loop den 27/7. Testene her beviser at (a) andre riders' allerede-
// committede frigivelser IKKE tabes, og (b) et før-loop-throw eksponerer de
// akkumulerede stats til kalderen via err.partialStats.

test("én rytters DB-fejl midt i loopet isoleres — resten frigives stadig, fejlen tælles i stats.failed", async () => {
  const { supabase, riderUpdates } = makeMockSupabase({ erroringRiderIds: ["r2"] });
  const { notify, calls } = makeNotifyRecorder();

  const stats = await releaseExpiredContractRiders({
    supabase, seasonNumber: 1, notify,
    fetchExpiredContractRiders: async () => [
      { id: "r1", firstname: "A", lastname: "A", team_id: "t1", contract_end_season: 1,
        team: { user_id: "u1", is_ai: false, is_frozen: false } },
      { id: "r2", firstname: "B", lastname: "B", team_id: "t2", contract_end_season: 1,
        team: { user_id: "u2", is_ai: false, is_frozen: false } },
      { id: "r3", firstname: "C", lastname: "C", team_id: "t3", contract_end_season: 1,
        team: { user_id: "u3", is_ai: false, is_frozen: false } },
    ],
  });

  assert.equal(stats.candidates, 3);
  assert.equal(stats.released, 2, "r1 + r3 frigives — r2's fejl taber IKKE de andre");
  assert.equal(stats.failed, 1, "r2 tælles som fejlet, ikke stille tabt");
  assert.equal(riderUpdates.length, 3, "alle tre update-kald blev forsøgt (loopet fortsætter forbi r2)");
  assert.equal(calls.length, 2, "kun r1 + r3's ejere notificeres — r2 nåede aldrig til notifikations-trinnet");
});

test("fetchExpiredContractRiders-fejl hænger tomme partialStats på errors (intet nået endnu)", async () => {
  const { supabase } = makeMockSupabase();
  const err = await releaseExpiredContractRiders({
    supabase, seasonNumber: 1,
    fetchExpiredContractRiders: async () => { throw new Error("season lookup boom"); },
  }).then(
    () => { throw new Error("skulle have kastet"); },
    (e) => e,
  );

  assert.match(err.message, /season lookup boom/);
  assert.deepEqual(err.partialStats, { candidates: 0, released: 0, deferredByRacing: 0, notified: 0, notifyFailed: 0, failed: 0 });
});

test("getRidersInActiveStageRace-fejl hænger partialStats med kendt candidates-tal på errors", async () => {
  // races-tabellen kaster (simuleret via en supabase der fejler på races-select).
  const supabase = {
    from(table) {
      if (table === "races") {
        return { select: () => ({ eq: () => ({ neq: () => ({ gt: () => ({ then: (resolve) => resolve({ data: null, error: { message: "races lookup boom" } }) }) }) }) }) };
      }
      return { select: () => ({ eq: () => ({ then: (resolve) => resolve({ data: [], error: null }) }) }) };
    },
  };

  const err = await releaseExpiredContractRiders({
    supabase, seasonNumber: 1,
    fetchExpiredContractRiders: async () => [
      { id: "r1", firstname: "A", lastname: "A", team_id: "t1", contract_end_season: 1,
        team: { user_id: "u1", is_ai: false, is_frozen: false } },
    ],
  }).then(
    () => { throw new Error("skulle have kastet"); },
    (e) => e,
  );

  assert.match(err.message, /races lookup boom/);
  assert.equal(err.partialStats.candidates, 1, "candidates var allerede kendt da fejlen indtraf");
  assert.equal(err.partialStats.released, 0);
});
