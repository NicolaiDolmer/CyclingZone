import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchAllRows,
  fetchAllRowsChunkedIn,
  SUPABASE_IN_CHUNK_SIZE,
} from "./supabasePagination.js";

// Mock-query: rows sliced pr. .range() som PostgREST (1000-loft simuleres via
// pageSize-parametren i kaldet).
function queryFor(rows) {
  return {
    range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
  };
}

test("fetchAllRows paginerer forbi pageSize-loftet", async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: i }));
  const out = await fetchAllRows(() => queryFor(rows), 10);
  assert.equal(out.length, 25);
  assert.deepEqual(out.map((r) => r.id), rows.map((r) => r.id));
});

test("#3030 fetchAllRowsChunkedIn splitter id-listen i chunks af chunkSize", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  const seenChunks = [];
  const out = await fetchAllRowsChunkedIn(ids, (chunk) => {
    seenChunks.push(chunk);
    return queryFor(chunk.map((id) => ({ id })));
  });
  // 250 ids / default 100 → 3 chunks (100, 100, 50)
  assert.equal(SUPABASE_IN_CHUNK_SIZE, 100);
  assert.deepEqual(seenChunks.map((c) => c.length), [100, 100, 50]);
  // Ingen chunk må kunne sprænge URL-grænsen igen: hård øvre grænse.
  assert.ok(seenChunks.every((c) => c.length <= SUPABASE_IN_CHUNK_SIZE));
  // Alle rækker samlet, i id-listens rækkefølge.
  assert.equal(out.length, 250);
  assert.deepEqual(out.map((r) => r.id), ids);
});

test("#3030 fetchAllRowsChunkedIn paginerer INDEN FOR hver chunk", async () => {
  // 2 chunks à 2 ids; hver id giver 3 rækker → 6 rækker pr. chunk, pageSize 4
  // tvinger 2 sider pr. chunk. Uden paginering ville kun 4/6 rækker komme med.
  const ids = ["a", "b", "c", "d"];
  const rowsFor = (chunk) => chunk.flatMap((id) => [0, 1, 2].map((n) => ({ id: `${id}-${n}` })));
  const out = await fetchAllRowsChunkedIn(
    ids,
    (chunk) => queryFor(rowsFor(chunk)),
    { chunkSize: 2, pageSize: 4 },
  );
  assert.equal(out.length, 12);
  assert.deepEqual(out.map((r) => r.id), [
    "a-0", "a-1", "a-2", "b-0", "b-1", "b-2",
    "c-0", "c-1", "c-2", "d-0", "d-1", "d-2",
  ]);
});

test("#3030 fetchAllRowsChunkedIn med tom id-liste kalder aldrig query-builderen", async () => {
  let calls = 0;
  const out = await fetchAllRowsChunkedIn([], () => {
    calls += 1;
    return queryFor([]);
  });
  assert.deepEqual(out, []);
  assert.equal(calls, 0);
});
