// backend/scripts/v4EffortTwinMeasure.test.js
// #5580 (spec motor runde 2, M1 punkt 8): tvillinge-maalingen skal selv vaere
// testet foer et tal fra den bruges som argument (samme praecedens som
// v4TailSpread.test.js og headToHeadV4.test.js). Ingen balance-tal her: kun
// kontrakter for opstillingen og en sanity-kontrol af selve metoden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TWIN_EFFORTS,
  TWIN_ORDER_MODES,
  TWIN_ROLE_MODES,
  bestEffortByCell,
  runTwins,
  summarizeTwins,
  twinStartlist,
} from "./v4EffortTwinMeasure.js";
import { entrantsFromAbilitiesRows } from "../lib/engine/v4/adapters/entrantAdapter.ts";
import { routeFromStageProfileRow } from "../lib/engine/v4/adapters/routeAdapter.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STAGES = (() => {
  const raw = JSON.parse(readFileSync(join(SCRIPT_DIR, "baselines", "v4-proxy-stages-2026-09-06.json"), "utf8"));
  return Array.isArray(raw) ? raw : raw.stages;
})();
const POPULATION = JSON.parse(
  readFileSync(join(SCRIPT_DIR, "baselines", "population-snapshot-2026-09-07.json"), "utf8"),
);

function smallField(n = 24) {
  const rows = POPULATION.riders.slice(0, n).map((r) => ({ rider_id: r.id, ...r.abilities }));
  return entrantsFromAbilitiesRows(rows, () => ({ role: "free_role", effort: "normal", condition: 1 }));
}

const FLAT_STAGE = STAGES.find((s) => s.profile_type === "flat");

test("#5580 TWIN_EFFORTS: hele trappen i trappens orden, normal med som reference", () => {
  assert.deepEqual([...TWIN_EFFORTS], ["grupetto", "save", "normal", "protect", "all_out"]);
  assert.deepEqual([...TWIN_ROLE_MODES], ["free", "team"]);
  assert.deepEqual([...TWIN_ORDER_MODES], ["none", "ai"]);
});

test("#5580 twinStartlist free: feltstoerrelsen er uaendret, tvillingerne er fri rolle uden hold", () => {
  const entrants = smallField();
  const route = routeFromStageProfileRow(FLAT_STAGE);
  const { startlist, idX, idN, capX, capN } = twinStartlist(entrants, route, 0.5, "all_out", false);
  assert.equal(startlist.length, entrants.length);
  const x = startlist.find((e) => e.rider_id === idX);
  const n = startlist.find((e) => e.rider_id === idN);
  assert.equal(x.effort, "all_out");
  assert.equal(n.effort, "normal");
  assert.equal(x.role, "free_role");
  assert.equal(x.team_id, null);
  assert.deepEqual(x.abilities, n.abilities);
  assert.equal(capX, null);
  assert.equal(capN, null);
});

test("#5580 twinStartlist team: hjaelper + identisk kaptajn paa hvert sit hold, feltstoerrelsen uaendret", () => {
  const entrants = smallField();
  const route = routeFromStageProfileRow(FLAT_STAGE);
  for (const swap of [false, true]) {
    const { startlist, idX, idN, capX, capN } = twinStartlist(entrants, route, 0.5, "protect", swap, "team");
    assert.equal(startlist.length, entrants.length);
    assert.equal(new Set(startlist.map((e) => e.rider_id)).size, startlist.length, "ingen dublet-id'er");
    const byId = new Map(startlist.map((e) => [e.rider_id, e]));
    assert.equal(byId.get(idX).role, "helper");
    assert.equal(byId.get(idN).role, "helper");
    assert.equal(byId.get(idX).effort, "protect");
    assert.equal(byId.get(idN).effort, "normal");
    assert.equal(byId.get(capX).role, "captain");
    assert.equal(byId.get(capN).role, "captain");
    assert.equal(byId.get(capX).effort, "normal");
    // Kaptajnen for indsats-tvillingen er paa hans hold, og holdene er adskilte.
    assert.equal(byId.get(capX).team_id, byId.get(idX).team_id);
    assert.equal(byId.get(capN).team_id, byId.get(idN).team_id);
    assert.notEqual(byId.get(idX).team_id, byId.get(idN).team_id);
    assert.deepEqual(byId.get(capX).abilities, byId.get(capN).abilities);
  }
});

test("#5580 runTwins: normal mod normal giver praecis 0 (metodens sanity-kontrol), ogsaa med hold", () => {
  const population = { riders: POPULATION.riders.slice(0, 30) };
  const rows = runTwins({
    population,
    stages: [FLAT_STAGE],
    seeds: ["s1"],
    efforts: ["normal"],
    roleModes: ["free", "team"],
  });
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.equal(r.effort, "normal");
    assert.equal(r.medianRankDelta, 0, `${r.roleMode}/${r.level}`);
    assert.equal(r.medianTimeDelta, 0, `${r.roleMode}/${r.level}`);
    if (r.roleMode === "team") assert.equal(r.medianCaptainRankDelta, 0);
    else assert.equal(r.medianCaptainRankDelta, null);
  }
});

test("#5580 runTwins: ukendt --orders-tilstand afvises", () => {
  assert.throws(
    () => runTwins({ population: { riders: [] }, stages: [], seeds: [], orderMode: "bogus" }),
    /ukendt --orders-tilstand/,
  );
});

test("#5580 runTwins --orders=ai: feltet faar roller og indsats fra ordre-byggeren", () => {
  const population = { riders: POPULATION.riders.slice(0, 30) };
  let calls = 0;
  const buildOrders = ({ riders }) => {
    calls += 1;
    return {
      orders: [],
      roles: new Map(riders.map((r) => [r.id, "helper"])),
      effortByRider: new Map(riders.map((r) => [r.id, "save"])),
    };
  };
  const rows = runTwins({
    population,
    stages: [FLAT_STAGE],
    seeds: ["s1"],
    efforts: ["normal"],
    roleModes: ["free"],
    orderMode: "ai",
    buildOrders,
  });
  assert.equal(calls, 1, "ordrerne bygges een gang pr. (seed, etape)");
  for (const r of rows) assert.equal(r.medianRankDelta, 0);
});

test("#5580 bestEffortByCell: vaelger trinnet med laveste median-plads pr. celle", () => {
  const rows = summarizeTwins([
    { effort: "save", level: "mid", profileType: "flat", roleMode: "free", rankDelta: 3, timeDelta: 0, xSecondsOverCp: 0, nSecondsOverCp: 0, workDelta: 0, xWins: 0, xTop10: 0, xOtl: 0, nOtl: 0, xGapPct: 0, captainRankDelta: null },
    { effort: "all_out", level: "mid", profileType: "flat", roleMode: "free", rankDelta: -2, timeDelta: 0, xSecondsOverCp: 0, nSecondsOverCp: 0, workDelta: 0, xWins: 0, xTop10: 0, xOtl: 0, nOtl: 0, xGapPct: 0, captainRankDelta: null },
    { effort: "normal", level: "mid", profileType: "flat", roleMode: "free", rankDelta: 0, timeDelta: 0, xSecondsOverCp: 0, nSecondsOverCp: 0, workDelta: 0, xWins: 0, xTop10: 0, xOtl: 0, nOtl: 0, xGapPct: 0, captainRankDelta: null },
    { effort: "save", level: "mid", profileType: "mountain", roleMode: "free", rankDelta: -1, timeDelta: 0, xSecondsOverCp: 0, nSecondsOverCp: 0, workDelta: 0, xWins: 0, xTop10: 0, xOtl: 0, nOtl: 0, xGapPct: 0, captainRankDelta: null },
  ]);
  const best = bestEffortByCell(rows);
  assert.deepEqual(
    best.map((c) => `${c.profileType}:${c.best}`),
    ["flat:all_out", "mountain:save"],
  );
});
