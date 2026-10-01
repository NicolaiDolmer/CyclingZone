import { test } from "node:test";
import assert from "node:assert/strict";
import * as receipt from "./riderDevelopmentReceipt.js";

// #5947: kalenderdags-raekken fryser paa datoens FOERSTE gevinst-tick (ignoreDuplicates),
// saa senere loebsdages gevinster manglede paa datoen og dukkede op paa naeste
// gevinst-dato sammen med dens egne. Historikken skal vise datoens slut-tilstand
// for ALLE spillere, ikke kun beta.
function fakeClient({ calendar, raceDay, seen = [] }) {
  return { from(table) {
    seen.push(table);
    if (table === "rider_derived_ability_history") {
      const q = { select(){return q;}, eq(){return q;}, order(){return q;},
        limit(){ return Promise.resolve({ data: calendar, error: null }); } };
      return q;
    }
    assert.equal(table, "rider_ability_race_day_history");
    const q = { select(){return q;}, eq(){return q;}, order(){return q;}, gte(){return q;},
      range(from){ return Promise.resolve({ data: from === 0 ? raceDay : [], error: null }); } };
    return q;
  } };
}

test("#5947: history shows each date's end state, so no gain is missing or shifted to the next date", async () => {
  // Calendar rows (DESC): 30/9 frozen at its first race day, 29/9 frozen at its first race day.
  const calendar = [
    { snapshot_date:"2026-09-30", season_number:4, source:"daily_training", abilities:{ tempo:57, sprint:41, climbing:60 } },
    { snapshot_date:"2026-09-29", season_number:4, source:"daily_training", abilities:{ tempo:55, sprint:40, climbing:60 } },
  ];
  const raceDay = [
    { snapshot_date:"2026-09-30", season_number:4, source:"daily_training", game_day:12, abilities:{ tempo:57, sprint:41, climbing:60 } },
    { snapshot_date:"2026-09-29", season_number:4, source:"daily_training", game_day:7, abilities:{ tempo:55, sprint:40, climbing:60 } },
    { snapshot_date:"2026-09-29", season_number:4, source:"race_development", game_day:9, abilities:{ tempo:56, sprint:41, climbing:60 } },
  ];
  for (const dailyReceiptEnabled of [false, true, undefined]) {
    const seen = [];
    const result = await receipt.loadDevelopmentReceiptHistory(fakeClient({ calendar, raceDay, seen }), "r1", { dailyReceiptEnabled });
    assert.ok(seen.includes("rider_ability_race_day_history"), "race-day evidence is read regardless of the beta flag");
    assert.deepEqual(result.map(r => r.snapshot_date), ["2026-09-29", "2026-09-30"]);
    // 29/9 ends at tempo 56 + sprint 41 (not the first-race-day 55/40) ...
    assert.deepEqual(result[0].abilities, { tempo:56, sprint:41, climbing:60 });
    // ... so 30/9 shows only its own +1 tempo, not 29/9's late gains piled on top.
    const changed = Object.keys(result[1].abilities).filter(k => result[1].abilities[k] !== result[0].abilities[k]);
    assert.deepEqual(changed, ["tempo"]);
  }
});

test("#5947: merge without a limit keeps every date (Pro season history)", () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({
    snapshot_date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    season_number: 1, source: "daily_training", abilities: { tempo: i },
  }));
  assert.equal(receipt.mergeDevelopmentSnapshots(rows, []).length, 200);
  assert.equal(receipt.mergeDevelopmentSnapshots(rows, [], { limit: Infinity }).length, 250);
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
