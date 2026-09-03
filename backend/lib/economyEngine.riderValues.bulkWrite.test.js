import test from "node:test";
import assert from "node:assert/strict";

import { updateRiderValues } from "./economyEngine.js";

// #4148: beviser at bulk-RPC-stien (RIDER_VALUES_BULK_WRITE) skriver PRÆCIS de
// samme værdier pr. rytter som den eksisterende per-rytter-PATCH-loop, for
// NØJAGTIGT samme input — begge stier deler samme beregning (computeRiderValueUpdates),
// så testen beviser at kun SKRIVEMÅDEN adskiller sig, ikke resultatet.
//
// Mock-klienten holder de samme seasons/races/race_results-tabeller som
// economyEngine.riderValues.test.js, men tilføjer:
//   - .rpc(name, args) for bulk-stien (registrerer payload'en pr. kald)
//   - opts.forceBulkWrite til updateRiderValues, så testen ikke afhænger af en
//     app_config-læsning for at vælge sti deterministisk.
function makeClient({ seasons, races, raceResults, riders }) {
  const patchedRiders = {};
  const rpcCalls = [];
  function from(table) {
    if (table === "seasons") {
      const b = { status: null, gtTotal: null };
      const api = {
        select: () => api,
        eq: (col, val) => { if (col === "status") b.status = val; return api; },
        gt: (col, val) => { if (col === "race_days_total") b.gtTotal = val; return api; },
        order: () => api,
        limit: (n) => {
          let rows = seasons.filter(s => s.status === b.status);
          if (b.gtTotal !== null) rows = rows.filter(s => (s.race_days_total || 0) > b.gtTotal);
          rows = rows.slice().sort((a, c) => c.number - a.number).slice(0, n);
          return Promise.resolve({ data: rows, error: null });
        },
        maybeSingle: () => {
          const rows = seasons.filter(s => s.status === b.status);
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
      };
      return api;
    }
    if (table === "races") {
      const b = { ids: [] };
      const api = {
        select: () => api,
        in: (_col, ids) => { b.ids = ids; return api; },
        order: () => api,
        range: (from0) => Promise.resolve({
          data: from0 === 0 ? races.filter(r => b.ids.includes(r.season_id)) : [],
          error: null,
        }),
      };
      return api;
    }
    if (table === "race_results") {
      const b = { ids: [], gt: 0 };
      const api = {
        select: () => api,
        in: (_col, ids) => { b.ids = ids; return api; },
        gt: (_col, val) => { b.gt = val; return api; },
        order: () => api,
        range: (from0) => Promise.resolve({
          data: from0 === 0
            ? raceResults.filter(r => b.ids.includes(r.race_id) && (r.prize_money || 0) > b.gt)
            : [],
          error: null,
        }),
      };
      return api;
    }
    if (table === "riders") {
      return {
        select: () => ({
          order: () => ({
            range: (from0) => Promise.resolve({ data: from0 === 0 ? riders : [], error: null }),
          }),
        }),
        update: (payload) => ({
          eq: (_col, id) => { patchedRiders[id] = payload; return Promise.resolve({ error: null }); },
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  }
  function rpc(name, args) {
    rpcCalls.push({ name, args });
    return Promise.resolve({ data: args?.p_updates?.length ?? 0, error: null });
  }
  return { client: { from, rpc }, patchedRiders, rpcCalls };
}

const FIXTURE = {
  seasons: [
    { id: "active", number: 2, status: "active", race_days_completed: 5, race_days_total: 10 },
    { id: "prev", number: 1, status: "completed", race_days_completed: 8, race_days_total: 8 },
    { id: "seed", number: 0, status: "completed", race_days_completed: 0, race_days_total: 0 },
  ],
  races: [
    { id: "r-active", season_id: "active" },
    { id: "r-prev", season_id: "prev" },
    { id: "r-seed", season_id: "seed" },
  ],
  raceResults: [
    { rider_id: "rider-1", race_id: "r-active", prize_money: 1000 },
    { rider_id: "rider-1", race_id: "r-prev", prize_money: 600 },
    { rider_id: "rider-1", race_id: "r-seed", prize_money: 5000 },
    { rider_id: "rider-2", race_id: "r-prev", prize_money: 300 },
    // rider-3 has no race_results at all → bonus must come out as 0 on both paths.
  ],
  riders: [{ id: "rider-1" }, { id: "rider-2" }, { id: "rider-3" }],
};

test("updateRiderValues: per-rytter-PATCH-stien og bulk-RPC-stien skriver byte-identiske værdier pr. rytter", async () => {
  const oldPath = makeClient(FIXTURE);
  const newPath = makeClient(FIXTURE);

  const oldResult = await updateRiderValues(oldPath.client, { forceBulkWrite: false });
  const newResult = await updateRiderValues(newPath.client, { forceBulkWrite: true });

  // Samme antal ryttere opdateret på begge stier.
  assert.equal(oldResult.ridersUpdated, newResult.ridersUpdated);
  assert.equal(oldResult.ridersUpdated, 3);

  // Gammel sti: ét PATCH-payload pr. rytter (patchedRiders keyed på id).
  assert.deepEqual(oldPath.patchedRiders, {
    "rider-1": { prize_earnings_bonus: 533 }, // round((1000+600)/3) — sæson "seed" ekskluderet
    "rider-2": { prize_earnings_bonus: 100 }, // round(300/3)
    "rider-3": { prize_earnings_bonus: 0 },
  });

  // Ny sti: INGEN per-rytter-PATCH — kun ét RPC-kald.
  assert.deepEqual(newPath.patchedRiders, {});
  assert.equal(newPath.rpcCalls.length, 1);
  assert.equal(newPath.rpcCalls[0].name, "bulk_update_rider_prize_earnings_bonus");

  // Byte-identisk sammenligning: RPC-payloaddet indeholder NØJAGTIGT samme
  // (id, prize_earnings_bonus)-par som de gamle PATCH-payloads, uanset rækkefølge.
  const bulkPayloadById = Object.fromEntries(
    newPath.rpcCalls[0].args.p_updates.map((row) => [row.id, { prize_earnings_bonus: row.prize_earnings_bonus }])
  );
  assert.deepEqual(bulkPayloadById, oldPath.patchedRiders);
});

test("updateRiderValues: bulk-RPC-stien chunker over 2000 rækker i flere kald, uden at tabe eller duplikere ryttere", async () => {
  const manyRiders = Array.from({ length: 4500 }, (_, i) => ({ id: `rider-${i}` }));
  const fixture = { seasons: [], races: [], raceResults: [], riders: manyRiders };

  const { client, rpcCalls } = makeClient(fixture);
  const result = await updateRiderValues(client, { forceBulkWrite: true });

  assert.equal(result.ridersUpdated, 4500);
  // 4500 / 2000-chunk-loft (RIDER_VALUES_BULK_CHUNK_SIZE) → 3 kald (2000+2000+500).
  assert.equal(rpcCalls.length, 3);
  const totalRowsAcrossCalls = rpcCalls.reduce((sum, c) => sum + c.args.p_updates.length, 0);
  assert.equal(totalRowsAcrossCalls, 4500);
  const idsSeen = new Set(rpcCalls.flatMap((c) => c.args.p_updates.map((r) => r.id)));
  assert.equal(idsSeen.size, 4500, "ingen dubletter eller tabte rytter-id'er på tværs af chunks");
});
