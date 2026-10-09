// #5978: "en top-10 i klassementet faar aldrig 5 min i et udbrud uden at feltet
// jagter". Feltet er klassementsgruppen (flest af de oevrige top-10), ikke den
// stoerste gruppe: paa bjergetaper er den stoerste gruppe ofte de afhaegtede.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GIRO_FIXTURE } from "./tourDryRun.mjs";
import { gcTop10InBreakOverThreshold, runStagesInOrder } from "./lib/tourScorecard.mjs";

const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
// Klassementet: g1 (udbryderen) + c0..c8 er top-10; d* er afhaegtede ryttere.
const favourites = ids("c", 9);
const dropped = ids("d", 40);
const gc = [{ rider_id: "g1", time: 60 }, ...favourites.map((id, i) => ({ rider_id: id, time: i })), ...dropped.map((id, i) => ({ rider_id: id, time: 600 + i }))]
  .sort((a, b) => a.time - b.time);
const formed = { timeline: { events: [{ type: "breakaway_formed", params: { rider_ids: ["g1", "x"] } }] } };

test("#5978: stor afhaegtet gruppe bagved taeller ikke, naar klassementsgruppen er taet paa", () => {
  const out = {
    ...formed,
    groupSnapshots: [
      { km: 60, groups: [{ rider_ids: ["g1", "x"], gap_seconds: 0 }, { rider_ids: favourites, gap_seconds: 40 }, { rider_ids: dropped, gap_seconds: 420 }] },
      { km: 90, groups: [{ rider_ids: ["g1", "x"], gap_seconds: 0 }, { rider_ids: favourites, gap_seconds: 35 }, { rider_ids: dropped, gap_seconds: 610 }] },
    ],
  };
  assert.deepEqual(gcTop10InBreakOverThreshold(out, gc), []);
});

test("#5978: indhentet udbryder tilbage i klassementsgruppen taeller ikke", () => {
  const out = {
    ...formed,
    groupSnapshots: [
      { km: 30, groups: [{ rider_ids: ["g1", "x"], gap_seconds: 0 }, { rider_ids: [...favourites, ...dropped], gap_seconds: 90 }] },
      { km: 110, groups: [{ rider_ids: ["g1", ...favourites], gap_seconds: 0 }, { rider_ids: ["x", ...dropped], gap_seconds: 540 }] },
    ],
  };
  assert.deepEqual(gcTop10InBreakOverThreshold(out, gc), []);
});

test("#5978: 5 min paa klassementsgruppen taeller, ogsaa naar en stoerre gruppe ligger taettere", () => {
  const out = {
    ...formed,
    groupSnapshots: [
      { km: 80, groups: [{ rider_ids: ["g1", "x"], gap_seconds: 0 }, { rider_ids: dropped, gap_seconds: 120 }, { rider_ids: favourites, gap_seconds: 310 }] },
    ],
  };
  assert.deepEqual(gcTop10InBreakOverThreshold(out, gc), ["g1"]);
});

test("#5978: lige mange top-10 i to grupper = den forreste er klassementsgruppen", () => {
  const out = {
    ...formed,
    groupSnapshots: [
      { km: 80, groups: [{ rider_ids: ["g1", "x"], gap_seconds: 0 }, { rider_ids: favourites.slice(0, 4), gap_seconds: 200 }, { rider_ids: favourites.slice(4, 8), gap_seconds: 400 }, { rider_ids: [favourites[8], ...dropped], gap_seconds: 900 }] },
    ],
  };
  assert.deepEqual(gcTop10InBreakOverThreshold(out, gc), []);
});

test("#5978 motor-vagt: official_times_v2 giver aldrig en top-10-udbryder 5 min paa klassementsgruppen (anonymiseret Giro-felt)", async () => {
  const { loadRaceEngineV4 } = await import("../../lib/raceEngineV4Bridge.js");
  const v4 = await loadRaceEngineV4();
  const data = JSON.parse(readFileSync(GIRO_FIXTURE, "utf8"));
  // #5578 robust: under official_times_v2 kommer klassementets forreste sjaeldent
  // med i morgenudbruddet, saa vagten koerer to seeds, hvoraf det ene har tilfaelde.
  const count = (revision) => {
    let hits = 0;
    let suspects = 0;
    for (const seedTag of ["tour6285-1", "tour6285-5"]) {
      runStagesInOrder({
        v4, data, revision, seedTag,
        onStage: ({ res, gcBefore }) => {
          hits += gcTop10InBreakOverThreshold(res.v4Output, gcBefore).length;
          suspects += gcTop10InBreakOverThreshold(res.v4Output, gcBefore, { thresholdSeconds: -Infinity }).length;
        },
      });
    }
    return { hits, suspects };
  };
  const v2Official = count("official_times_v2");
  assert.ok(v2Official.suspects > 0, "ikke tom: top-10-ryttere sidder i udbrud med klassementsgruppen bagved");
  assert.equal(v2Official.hits, 0);
  // Maalingen kan fyre: samme felt og seed under orders_gc_v2 (frosset) har tilfaelde.
  assert.ok(count("orders_gc_v2").hits > 0);
});
