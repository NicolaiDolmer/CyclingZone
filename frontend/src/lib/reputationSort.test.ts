import { test } from "node:test";
import assert from "node:assert/strict";
import { compareRidersByFilter } from "./riderColumnSort.js";

test("reputation sort follows the displayed transition value in both directions", () => {
  const rows = [{ id: "a", popularity: 90, reputation: 10 }, { id: "b", popularity: 20, reputation: 80 }];
  assert.deepEqual([...rows].sort((a,b) => compareRidersByFilter(a,b,{ sort: "reputation", sort_dir: "desc" })).map(r=>r.id), ["a","b"]);
  assert.deepEqual([...rows].sort((a,b) => compareRidersByFilter(a,b,{ sort: "reputation", sort_dir: "asc" })).map(r=>r.id), ["b","a"]);
});
test("unknown reputation stays last; legacy popularity sort is unchanged", () => {
  const rows = [{ id:"empty", popularity:null, reputation:null }, { id:"zero", popularity:0, reputation:0 }, { id:"known", popularity:50, reputation:80 }];
  for (const dir of ["asc","desc"]) assert.equal([...rows].sort((a,b)=>compareRidersByFilter(a,b,{sort:"reputation",sort_dir:dir})).at(-1)?.id,"empty");
  assert.ok(compareRidersByFilter({popularity:90,reputation:0},{popularity:20,reputation:99},{sort:"popularity",sort_dir:"desc"})<0);
});

test("global reputation ordering survives page boundaries and breaks ties by id", async () => {
  const { mergeReputationSortedIds } = await import("./reputationSort.ts");
  const rows = Array.from({length: 1005}, (_,i) => ({id:String(i).padStart(4,"0"), popularity:i===1004?99:20, reputation:20}));
  const before = rows.map(r=>r.id);
  const ids = mergeReputationSortedIds(rows, false);
  assert.equal(ids[0],"1004");
  assert.equal(new Set(ids).size,1005);
  assert.deepEqual(rows.map(r=>r.id),before);
  assert.deepEqual(ids.slice(1,4),["0000","0001","0002"]);
});

test("saved popularity/reputation URLs follow the visible measure; other sorts stay unchanged", async () => {
  const { reputationSortKey } = await import("./reputationSort.ts");
  assert.equal(reputationSortKey("popularity", true), "reputation");
  assert.equal(reputationSortKey("reputation", false), "popularity");
  assert.equal(reputationSortKey("salary", true), "salary");
});
