import test from "node:test";
import assert from "node:assert/strict";

import { releaseRetiredRiders } from "./retirementRelease.js";

// #2748 · Pension → fri trup-plads ved sæsonskifte.
//
// fetchRetiredOwnedRiders injiceres i de fleste tests (samme mønster som
// contractExpiryRelease.test.js), så de beviser RELEASE-LOGIKKEN. Selve
// query-formen er IKKE kun antaget her: den sidste test kører den ægte
// defaultFetchRetiredOwnedRiders mod en mock der optager filtrene, så
// `is_retired = true AND team_id IS NOT NULL` er låst fast af en assertion —
// det er hele fasens idempotens-/selv-helings-kontrakt.

// ─── Minimal mock-supabase ────────────────────────────────────────────────────
// Dækker de tabeller releaseRetiredRiders rammer via de ikke-injicerede
// side-effekt-helpers: riders (update), race_entries (clearFutureRaceEntriesSafe),
// transfer_listings + transfer_offers + swap_offers (markeds-oprydning).

function makeMockSupabase({ unreleasableRiderIds = [], erroringRiderIds = [], fetchRows = null } = {}) {
  const riderUpdates = [];
  const listingUpdates = [];
  const offerUpdates = [];
  const swapUpdates = [];
  const selectFilters = [];

  function builder(table) {
    const b = {
      __table: table,
      __filters: {},
      __op: null,
      __select: "",
      select(c) { b.__select = c || ""; return b; },
      eq(col, val) { b.__filters[col] = val; return b; },
      neq(col, val) { b.__filters[`neq:${col}`] = val; return b; },
      in(col, vals) { b.__filters[`in:${col}`] = vals; return b; },
      or(expr) { b.__filters.or = expr; return b; },
      not(col, op, val) { b.__filters[`not:${col}`] = `${op}:${val}`; return b; },
      order() { return b; },
      range() { return b; },
      update(patch) { b.__op = "update"; b.__patch = patch; return b; },
      delete() { b.__op = "delete"; return b; },
      then(resolve) { resolve(resolveQuery()); },
    };

    function resolveQuery() {
      if (table === "riders" && b.__op === "update") {
        const riderId = b.__filters.id;
        riderUpdates.push({ riderId, patch: { ...b.__patch }, filters: { ...b.__filters } });
        if (erroringRiderIds.includes(riderId)) {
          return { data: null, error: { message: "simulated transient DB error" } };
        }
        // Concurrency-guard-stien: 0 rækker ramt (rytteren er flyttet imellem).
        if (unreleasableRiderIds.includes(riderId)) return { data: [], error: null };
        return { data: [{ id: riderId }], error: null };
      }
      if (table === "riders") {
        // defaultFetchRetiredOwnedRiders' select — optag filtrene til assertion.
        selectFilters.push({ select: b.__select, filters: { ...b.__filters } });
        return { data: fetchRows || [], error: null };
      }
      if (table === "race_entries") {
        // clearFutureRaceEntriesSafe: ingen fremtidige entries i disse tests.
        return { data: [], error: null };
      }
      if (table === "transfer_listings" && b.__op === "update") {
        listingUpdates.push({ patch: { ...b.__patch }, filters: { ...b.__filters } });
        return { data: null, error: null };
      }
      if (table === "transfer_offers" && b.__op === "update") {
        offerUpdates.push({ patch: { ...b.__patch }, filters: { ...b.__filters } });
        return { data: null, error: null };
      }
      if (table === "swap_offers" && b.__op === "update") {
        swapUpdates.push({ patch: { ...b.__patch }, filters: { ...b.__filters } });
        return { data: null, error: null };
      }
      return { data: [], error: null };
    }

    return b;
  }

  return { supabase: { from: builder }, riderUpdates, listingUpdates, offerUpdates, swapUpdates, selectFilters };
}

const RETIRED = [
  { id: "r1", firstname: "Alejandro", lastname: "Valverde", team_id: "t1" },
  { id: "r2", firstname: "Jens", lastname: "Voigt", team_id: "t2" },
];

// ─── Kerne-adfærd ─────────────────────────────────────────────────────────────

test("frigiver trup-pladsen: team_id + kontraktfelter nulstilles for hver kandidat", async () => {
  const { supabase, riderUpdates } = makeMockSupabase();

  const stats = await releaseRetiredRiders({
    supabase,
    fetchRetiredOwnedRiders: async () => RETIRED,
  });

  assert.deepEqual(stats, { candidates: 2, released: 2, failed: 0 });
  assert.equal(riderUpdates.length, 2);
  for (const upd of riderUpdates) {
    assert.deepEqual(upd.patch, {
      team_id: null,
      pending_team_id: null,
      salary: null,
      contract_length: null,
      contract_end_season: null,
      acquired_at: null,
    });
  }
});

test("concurrency-guard: opdateringen filtrerer på det team_id vi læste", async () => {
  const { supabase, riderUpdates } = makeMockSupabase();

  await releaseRetiredRiders({ supabase, fetchRetiredOwnedRiders: async () => RETIRED });

  assert.equal(riderUpdates[0].filters.id, "r1");
  assert.equal(riderUpdates[0].filters.team_id, "t1");
  assert.equal(riderUpdates[1].filters.team_id, "t2");
});

test("rytter der nåede at skifte hold imellem tælles IKKE som frigivet og udløser ingen markeds-oprydning", async () => {
  const { supabase, listingUpdates, offerUpdates } = makeMockSupabase({ unreleasableRiderIds: ["r1"] });

  const stats = await releaseRetiredRiders({
    supabase,
    fetchRetiredOwnedRiders: async () => RETIRED,
  });

  assert.equal(stats.candidates, 2);
  assert.equal(stats.released, 1);
  assert.equal(stats.failed, 0);
  // Kun r2 skal have fået listings/tilbud lukket.
  assert.equal(listingUpdates.length, 1);
  assert.deepEqual(listingUpdates[0].filters["in:rider_id"], ["r2"]);
  assert.equal(offerUpdates.length, 1);
  assert.deepEqual(offerUpdates[0].filters["in:rider_id"], ["r2"]);
});

test("markeds-oprydning: listings lukkes som withdrawn OG åbne transfer-/swap-tilbud trækkes tilbage", async () => {
  const { supabase, listingUpdates, offerUpdates, swapUpdates } = makeMockSupabase();

  await releaseRetiredRiders({
    supabase,
    fetchRetiredOwnedRiders: async () => [RETIRED[0]],
  });

  // #776/#822: zombie-listing må ikke overleve pensionen.
  assert.equal(listingUpdates.length, 1);
  assert.equal(listingUpdates[0].patch.status, "withdrawn");
  // #1748-parræl: modsat #2744-B trækker pensionen OGSÅ åbne tilbud tilbage, så en
  // modpart ikke kan acceptere et tilbud på en pensioneret rytter bagefter.
  assert.equal(offerUpdates.length, 1);
  assert.equal(offerUpdates[0].patch.status, "withdrawn");
  assert.equal(swapUpdates.length, 1);
  assert.equal(swapUpdates[0].patch.status, "withdrawn");
  assert.match(swapUpdates[0].filters.or, /offered_rider_id\.in\.\(r1\)/);
  assert.match(swapUpdates[0].filters.or, /requested_rider_id\.in\.\(r1\)/);
});

// ─── Fejl-isolation + observability ───────────────────────────────────────────

test("én rytters DB-fejl stopper ikke resten af loopet", async () => {
  const { supabase, riderUpdates } = makeMockSupabase({ erroringRiderIds: ["r1"] });

  const stats = await releaseRetiredRiders({
    supabase,
    fetchRetiredOwnedRiders: async () => RETIRED,
  });

  assert.equal(stats.candidates, 2);
  assert.equal(stats.released, 1, "r2 skal stadig være frigivet");
  assert.equal(stats.failed, 1);
  assert.equal(riderUpdates.length, 2, "begge ryttere skal være forsøgt");
});

test("fejler fetch, hænges de indtil da akkumulerede stats på err.partialStats", async () => {
  const { supabase } = makeMockSupabase();

  await assert.rejects(
    () => releaseRetiredRiders({
      supabase,
      fetchRetiredOwnedRiders: async () => { throw new Error("boom"); },
    }),
    (err) => {
      assert.equal(err.message, "boom");
      assert.deepEqual(err.partialStats, { candidates: 0, released: 0, failed: 0 });
      return true;
    }
  );
});

test("ingen kandidater → ingen mutationer, rene nul-stats", async () => {
  const { supabase, riderUpdates, listingUpdates } = makeMockSupabase();

  const stats = await releaseRetiredRiders({ supabase, fetchRetiredOwnedRiders: async () => [] });

  assert.deepEqual(stats, { candidates: 0, released: 0, failed: 0 });
  assert.equal(riderUpdates.length, 0);
  assert.equal(listingUpdates.length, 0);
});

test("manglende supabase-klient kaster", async () => {
  await assert.rejects(() => releaseRetiredRiders({ supabase: null }), /Supabase client required/);
});

// ─── Query-formen (idempotens-kontrakten) ─────────────────────────────────────

test("default-forespørgslen er tilstands-baseret: is_retired=true OG team_id IS NOT NULL", async () => {
  // Kører den ÆGTE defaultFetchRetiredOwnedRiders (ingen injektion), så filtrene
  // er låst fast. Det er dem der gør fasen selv-helende: en frigivet rytter har
  // team_id = null og findes derfor aldrig igen, uanset hvilken sæson vi er i.
  const { supabase, selectFilters } = makeMockSupabase({ fetchRows: [] });

  const stats = await releaseRetiredRiders({ supabase });

  assert.deepEqual(stats, { candidates: 0, released: 0, failed: 0 });
  assert.equal(selectFilters.length, 1);
  assert.equal(selectFilters[0].filters.is_retired, true);
  assert.equal(selectFilters[0].filters["not:team_id"], "is:null");
  // Ingen sæson-filtrering — fasen må også samle ryttere op der er pensioneret
  // ad anden vej (fx admin-endpointet) eller efterladt af en afbrudt kørsel.
  assert.equal(selectFilters[0].filters.contract_end_season, undefined);
  assert.equal(selectFilters[0].filters.season_number, undefined);
});
