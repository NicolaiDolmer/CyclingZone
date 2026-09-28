// #5795: S4-kalenderen planlagt mod målstrukturen (D4 E-H pensioneres ved skiftet).
import test from "node:test";
import assert from "node:assert/strict";
import {
  CALENDAR_TARGET_STRUCTURES, resolveTargetStructure, targetStructureUsageError,
  resolveCutoverPoolRetirement, racesInCutoverRetiredPools, formatTargetStructureReport,
} from "./calendarTargetStructure.js";
import { SENIOR_CALENDAR_POOLS_FROM_S4 } from "./calendarTierCaps.js";
import { planD4PoolRetirement, D4_ACTIVE_POOL_COUNT } from "../scripts/retireD4PoolsS4.js";

const LETTERS = "ABCDEFGH";
// Prods form 26/9: 1/2/4/8 seniorpuljer, alle aktive (retired_at IS NULL).
function prodPools26Sep({ retiredEH = false } = {}) {
  const pools = [
    { id: 1, tier: 1, pool_index: 0, label: "Division 1", squad: "senior", retired_at: null },
    { id: 2, tier: 2, pool_index: 0, label: "Division 2 — A", squad: "senior", retired_at: null },
    { id: 3, tier: 2, pool_index: 1, label: "Division 2 — B", squad: "senior", retired_at: null },
  ];
  for (let i = 0; i < 4; i++) pools.push({ id: 4 + i, tier: 3, pool_index: i, label: `Division 3 — ${LETTERS[i]}`, squad: "senior", retired_at: null });
  for (let i = 0; i < 8; i++) {
    pools.push({
      id: 8 + i, tier: 4, pool_index: i, label: `Division 4 — ${LETTERS[i]}`, squad: "senior",
      retired_at: retiredEH && i >= 4 ? "2026-09-27T20:00:00Z" : null,
    });
  }
  return pools;
}

test("#5795: s4 er den eneste målstruktur, og den bygger på pyramidens D4-tal", () => {
  assert.deepEqual(Object.keys(CALENDAR_TARGET_STRUCTURES), ["s4"]);
  const s4 = resolveTargetStructure("S4");
  assert.equal(s4.tier, 4);
  assert.equal(s4.activePools, SENIOR_CALENDAR_POOLS_FROM_S4[4]);
  assert.equal(s4.activePools, D4_ACTIVE_POOL_COUNT, "kalenderen og pensioneringen skal beholde lige mange D4-puljer");
});

test("#5795: en ukendt eller tom målstruktur kaster (fail-closed)", () => {
  for (const raw of ["s5", "", null, undefined, "D4:E,F,G,H"]) {
    assert.throws(() => resolveTargetStructure(raw), /unknown target structure/);
  }
});

test("#5795: målstrukturen gælder kun seniorkalenderen og kun fra S4", () => {
  const s4 = resolveTargetStructure("s4");
  assert.equal(targetStructureUsageError({ structure: s4, seasonNumber: 4 }), null);
  assert.equal(targetStructureUsageError({ structure: s4, seasonNumber: 5, squad: "senior" }), null);
  assert.match(targetStructureUsageError({ structure: s4, seasonNumber: 3 }), /applies from season 4/);
  assert.match(targetStructureUsageError({ structure: s4, seasonNumber: 4, squad: "u23" }), /senior-only/);
  assert.match(targetStructureUsageError({ structure: s4, seasonNumber: 4, squad: "junior" }), /senior-only/);
});

test("#5795: D4 A-D beholdes, E-H pensioneres — på pool_index, uanset input-rækkefølge", () => {
  const pools = prodPools26Sep().reverse();
  const { keep, retire, retireIds } = resolveCutoverPoolRetirement({ pools });
  assert.deepEqual(keep.map((p) => p.label), ["Division 4 — A", "Division 4 — B", "Division 4 — C", "Division 4 — D"]);
  assert.deepEqual(retire.map((p) => p.label), ["Division 4 — E", "Division 4 — F", "Division 4 — G", "Division 4 — H"]);
  assert.deepEqual([...retireIds].sort((a, b) => a - b), [12, 13, 14, 15]);
  assert.ok(retire.every((p) => p.alreadyRetired === false));
});

test("#5795: idempotent — efter pensioneringen giver reglen samme puljer (allerede pensioneret)", () => {
  const before = resolveCutoverPoolRetirement({ pools: prodPools26Sep() });
  const after = resolveCutoverPoolRetirement({ pools: prodPools26Sep({ retiredEH: true }) });
  assert.deepEqual([...after.retireIds], [...before.retireIds]);
  assert.ok(after.retire.every((p) => p.alreadyRetired === true));
});

test("#5795: SAMME puljer som retireD4PoolsS4.js pensionerer (de to regler må ikke glide fra hinanden)", () => {
  const pools = prodPools26Sep();
  const plan = planD4PoolRetirement({ pools, teams: [] });
  const ours = resolveCutoverPoolRetirement({ pools });
  assert.deepEqual(ours.keep.map((p) => p.id), plan.keep.map((p) => p.id));
  assert.deepEqual(ours.retire.map((p) => p.id), plan.retire.map((p) => p.id));
});

test("#5795: ungdomsgrupper og andre tiers berøres aldrig", () => {
  const pools = [
    ...prodPools26Sep(),
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ id: 500 + i, tier: 4, pool_index: 10 + i, label: `U23 — ${i}`, squad: "u23", retired_at: null })),
  ];
  const { retireIds } = resolveCutoverPoolRetirement({ pools });
  assert.deepEqual([...retireIds].sort((a, b) => a - b), [12, 13, 14, 15]);
});

test("#5795: færre D4-puljer end målet, eller tvetydige pool_index, kaster", () => {
  const three = prodPools26Sep().filter((p) => !(p.tier === 4 && p.pool_index >= 3));
  assert.throws(() => resolveCutoverPoolRetirement({ pools: three }), /has 3 senior pools/);
  const dup = prodPools26Sep().map((p) => (p.id === 15 ? { ...p, pool_index: 0 } : p));
  assert.throws(() => resolveCutoverPoolRetirement({ pools: dup }), /not unique/);
});

test("#5795: præcis 4 D4-puljer (allerede S4-formen) giver intet at pensionere", () => {
  const pools = prodPools26Sep().filter((p) => !(p.tier === 4 && p.pool_index >= 4));
  const { keep, retire } = resolveCutoverPoolRetirement({ pools });
  assert.equal(keep.length, 4);
  assert.equal(retire.length, 0);
});

test("#5795: post-verify finder løb i en pulje der pensioneres ved skiftet", () => {
  const retireIds = new Set([12, 13]);
  assert.deepEqual(racesInCutoverRetiredPools({ poolCounts: [[8, 30], [9, 30]], retireIds }), []);
  assert.deepEqual(racesInCutoverRetiredPools({ poolCounts: [[8, 30], [12, 2], [13, 0]], retireIds }), [[12, 2]]);
});

test("#5795: rapporten navngiver puljerne og siger at databasen ikke røres", () => {
  const structure = resolveTargetStructure("s4");
  const lines = formatTargetStructureReport({ structure, ...resolveCutoverPoolRetirement({ pools: prodPools26Sep() }) }).join("\n");
  assert.match(lines, /Division 4 — E · Division 4 — F · Division 4 — G · Division 4 — H/);
  assert.match(lines, /databasen røres ikke: 4 pulje/);
  const done = formatTargetStructureReport({ structure, ...resolveCutoverPoolRetirement({ pools: prodPools26Sep({ retiredEH: true }) }) }).join("\n");
  assert.match(done, /allerede pensioneret/);
});
