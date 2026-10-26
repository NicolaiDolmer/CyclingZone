// #6804 G2: udbruddets stoerste forspring mod feltet + "intet hold ville jage".
// Syntetiske snapshots (hard rule 17): kun logikken testes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { breakawayLeadFacts } from "./tourScorecard.mjs";

const ids = (n, p) => Array.from({ length: n }, (_, i) => `${p}${i}`);
const snap = (km, groups) => ({ km, groups });
const g = (kind, n, gap, p = kind) => ({ group_id: `${p}-${km0++}`, kind, rider_ids: ids(n, p), gap_seconds: gap });
let km0 = 0;

test("#6804 G2: forspringet maales mod feltet, og det stoerste taeller", () => {
  const out = { groupSnapshots: [
    snap(10, [g("breakaway", 5, 0), g("peloton", 100, 120)]),
    snap(50, [g("breakaway", 5, 0), g("peloton", 100, 400)]),
    snap(90, [g("breakaway", 5, 0), g("peloton", 100, 200)]),
  ], timeline: { events: [] } };
  assert.deepEqual(breakawayLeadFacts(out), { breakawayMaxLead: 400, breakawayUnchased: false });
});

test("#6804 G2: et splittet felt paa slutstigningen taeller ikke; en afhaegtet gruppe er aldrig maalestokken", () => {
  const out = { groupSnapshots: [
    snap(50, [g("breakaway", 5, 0), g("peloton", 80, 300), g("gruppetto", 20, 900)]),
    // Feltet er splittet i mange smaa grupper: ingen har en reel andel af rytterne.
    snap(95, [g("breakaway", 5, 0), g("chase", 10, 600), g("chase", 10, 800), g("chase", 10, 1000), g("chase", 10, 1200), g("chase", 10, 1400)]),
  ], timeline: { events: [] } };
  assert.equal(breakawayLeadFacts(out).breakawayMaxLead, 300);
});

test("#6804 G2: uden udbrud intet forspring; motorens melding om ingen jagt-interesse laeses", () => {
  assert.deepEqual(breakawayLeadFacts({ groupSnapshots: [snap(10, [g("peloton", 100, 0)])], timeline: { events: [] } }), { breakawayMaxLead: null, breakawayUnchased: false });
  const out = { groupSnapshots: [], timeline: { events: [{ km: 40, type: "breakaway_unchased", params: { group_id: "b" } }] } };
  assert.equal(breakawayLeadFacts(out).breakawayUnchased, true);
  assert.deepEqual(breakawayLeadFacts(null), { breakawayMaxLead: null, breakawayUnchased: false });
});
