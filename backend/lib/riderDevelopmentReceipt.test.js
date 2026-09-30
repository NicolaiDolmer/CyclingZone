import { test } from "node:test";
import assert from "node:assert/strict";
import * as receipt from "./riderDevelopmentReceipt.js";

test("non-beta development keeps calendar history and never reads race-day evidence", async () => {
  const rows=[{snapshot_date:"2026-09-29",abilities:{tempo:55}},{snapshot_date:"2026-09-28",abilities:{tempo:54}}];
  const client={from(table){
    assert.equal(table,"rider_derived_ability_history");
    const query={select(){return query;},eq(){return query;},order(){return query;},
      limit(){return Promise.resolve({data:rows,error:null});}};
    return query;
  }};
  assert.deepEqual(await receipt.loadDevelopmentReceiptHistory(client,"r1",{dailyReceiptEnabled:false}),[rows[1],rows[0]]);
  assert.deepEqual(await receipt.loadDevelopmentReceiptHistory(client,"r1"),[rows[1],rows[0]]);
});

test("development history takes the last recorded race-day state, preserving season transitions", () => {
  assert.equal(typeof receipt.mergeDevelopmentSnapshots, "function");
  const result = receipt.mergeDevelopmentSnapshots(
    [{ snapshot_date:"2026-09-29",season_number:4,source:"daily_training",abilities:{tempo:55} },
     { snapshot_date:"2026-09-27",season_number:4,source:"season_transition",abilities:{tempo:54} }],
    [{ snapshot_date:"2026-09-29",season_number:4,source:"daily_training",game_day:8,abilities:{tempo:56} },
     { snapshot_date:"2026-09-29",season_number:4,source:"race_development",game_day:9,abilities:{tempo:57} },
     { snapshot_date:"2026-09-27",season_number:3,source:"daily_training",game_day:139,abilities:{tempo:53} }],
  );
  assert.equal(result.length,2);
  assert.equal(result[0].abilities.tempo,54);
  assert.equal(result[1].abilities.tempo,57);
});

test("race-day snapshots cannot pull the final date state back to the first gain", () => {
  assert.equal(typeof receipt.mergeDevelopmentSnapshots, "function");
  const rows = [3,1,2].map(game_day=>({snapshot_date:"2026-09-29",season_number:4,
    source:"daily_training",game_day,abilities:{tempo:54+game_day}}));
  assert.equal(receipt.mergeDevelopmentSnapshots([],rows)[0].abilities.tempo,57);
});
