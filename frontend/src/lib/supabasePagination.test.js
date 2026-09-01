// #4581: beviser at fetchAllRows's paralleliserede bølge-strategi (a) stadig
// returnerer ALLE rækker i rækkefølge, (b) bruger markant færre SEKVENTIELLE
// round-trips end der er sider, (c) kaster Supabase-fejl videre uændret, og
// (d) giver [] for en tom tabel — uden at ændre kalder-kontrakten
// fetchAllRows(buildQuery, pageSize).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAllRows } from "./supabasePagination.js";

// Mock-builder der efterligner supabase-js's `builder.range(from, to) ->
// Promise<{data, error}>`-kontrakt. Tæller (a) totale .range()-kald og (b)
// "runder" — en runde er en gruppe kald der starter samtidig (synkront, FØR
// nogen af dem er resolvet) og slutter når alle i gruppen er resolvet. Det er
// præcis definitionen af en SEKVENTIEL round-trip i fetchAllRows's bølge-
// strategi: næste bølges .range()-kald sker først efter `await Promise.all(...)`
// på den forrige, så `pending` er tilbage på 0 (roundOpen=false) inden de nye
// kald starter synkront.
function makeCountingBuilder(totalRows, { failOnCallIndex = null } = {}) {
  const allRows = Array.from({ length: totalRows }, (_, i) => ({ id: i }));
  let callCount = 0;
  let rounds = 0;
  let pending = 0;
  let roundOpen = false;
  const ranges = [];

  const buildQuery = () => ({
    range(from, to) {
      const callIndex = callCount;
      callCount++;
      ranges.push([from, to]);
      if (!roundOpen) {
        rounds++;
        roundOpen = true;
      }
      pending++;
      return Promise.resolve().then(() => {
        pending--;
        if (pending === 0) roundOpen = false;
        if (failOnCallIndex != null && callIndex === failOnCallIndex) {
          return { data: null, error: new Error("boom") };
        }
        return { data: allRows.slice(from, to + 1), error: null };
      });
    },
  });

  return { buildQuery, ranges, stats: () => ({ callCount, rounds }) };
}

test("henter alle rækker i rækkefølge, på tværs af mange sider", async () => {
  const { buildQuery, stats } = makeCountingBuilder(11947);
  const rows = await fetchAllRows(buildQuery, 1000);
  assert.equal(rows.length, 11947);
  assert.deepEqual(rows.map((r) => r.id), Array.from({ length: 11947 }, (_, i) => i));
  // 12 sider ville være 12 sekventielle round-trips i den gamle implementering.
  const { rounds, callCount } = stats();
  assert.ok(rounds < 12, `forventede markant færre runder end 12 sider, fik ${rounds}`);
  assert.ok(rounds <= 4, `forventede <=4 runder (side 1 + <=2 bølger af 6), fik ${rounds}`);
  assert.ok(callCount >= 12, "skal have hentet mindst 12 sider værd af data");
});

test("bruger markant færre sekventielle bølger end antal sider (stort datasæt)", async () => {
  // 18-etapes Giro-ekstrapolation fra issuet: ~15.400 rækker = 16 sider.
  const { buildQuery, stats } = makeCountingBuilder(15400);
  const rows = await fetchAllRows(buildQuery, 1000);
  assert.equal(rows.length, 15400);
  const { rounds } = stats();
  assert.ok(rounds < 16, `forventede markant færre runder end 16 sider, fik ${rounds}`);
});

test("én-siders resultat kræver kun én round-trip", async () => {
  const { buildQuery, stats } = makeCountingBuilder(500);
  const rows = await fetchAllRows(buildQuery, 1000);
  assert.equal(rows.length, 500);
  const { rounds, callCount } = stats();
  assert.equal(callCount, 1);
  assert.equal(rounds, 1);
});

test("nøjagtig side-størrelse (1000 rækker) opdager korrekt at der ikke er mere", async () => {
  const { buildQuery, stats } = makeCountingBuilder(1000);
  const rows = await fetchAllRows(buildQuery, 1000);
  assert.equal(rows.length, 1000);
  assert.deepEqual(rows.map((r) => r.id), Array.from({ length: 1000 }, (_, i) => i));
  // Side 1 er fuld (1000/1000) -> udløser én ekstra bølge der opdager at resten er tom.
  const { rounds } = stats();
  assert.equal(rounds, 2);
});

test("tom tabel giver []", async () => {
  const { buildQuery, stats } = makeCountingBuilder(0);
  const rows = await fetchAllRows(buildQuery, 1000);
  assert.deepEqual(rows, []);
  const { callCount } = stats();
  assert.equal(callCount, 1);
});

test("Supabase-fejl på side 1 kastes videre uændret", async () => {
  const { buildQuery } = makeCountingBuilder(2000, { failOnCallIndex: 0 });
  await assert.rejects(() => fetchAllRows(buildQuery, 1000), /boom/);
});

test("Supabase-fejl på en senere (parallel) side kastes videre uændret", async () => {
  // 2500 rækker -> side 1 fuld, bølge 2..5 startes parallelt; fejl på kald-index 3
  // (en af de parallelle sider i bølgen, ikke side 1) skal stadig kastes.
  const { buildQuery } = makeCountingBuilder(7000, { failOnCallIndex: 3 });
  await assert.rejects(() => fetchAllRows(buildQuery, 1000), /boom/);
});

test("respekterer et custom pageSize (kontrakt: fetchAllRows(buildQuery, pageSize))", async () => {
  const { buildQuery, stats } = makeCountingBuilder(55, {});
  const rows = await fetchAllRows(buildQuery, 20);
  assert.equal(rows.length, 55);
  assert.deepEqual(rows.map((r) => r.id), Array.from({ length: 55 }, (_, i) => i));
  const { callCount } = stats();
  assert.ok(callCount >= 3, "skal have hentet mindst 3 sider a 20 rækker");
});
