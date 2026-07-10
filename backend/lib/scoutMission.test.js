// Talentspejder Fase 3 (#2244) — scoutMission: shortlist-generator + inversion-gate.
import test from "node:test";
import assert from "node:assert/strict";
import {
  filterCandidatePool, poolCoverageFraction, biasWeightFor, generateShortlist,
} from "./scoutMission.js";
import { DEFAULT_SCOUT, SCOUT_JOB_CONFIG } from "./scoutEngine.js";

function makePool(n = 30, { divisionId = "div-1", country = "DK" } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `rider-${i}`,
    potentiale: 1 + (i / (n - 1)) * 5, // spredt 1..6
    divisionId,
    country,
    age: 18 + (i % 12),
    isNmEligible: true,
  }));
}

// ─── filterCandidatePool ──────────────────────────────────────────────────────

test("filterCandidatePool: division scope", () => {
  const pool = [
    { id: "a", divisionId: "div-1" },
    { id: "b", divisionId: "div-2" },
  ];
  assert.deepEqual(filterCandidatePool(pool, { scope: "division", value: "div-1" }).map((r) => r.id), ["a"]);
});

test("filterCandidatePool: country scope", () => {
  const pool = [{ id: "a", country: "DK" }, { id: "b", country: "NO" }];
  assert.deepEqual(filterCandidatePool(pool, { scope: "country", value: "DK" }).map((r) => r.id), ["a"]);
});

test("filterCandidatePool: u23 scope filters age <= 23", () => {
  const pool = [{ id: "a", age: 22 }, { id: "b", age: 24 }, { id: "c", age: null }];
  assert.deepEqual(filterCandidatePool(pool, { scope: "u23" }).map((r) => r.id), ["a"]);
});

test("filterCandidatePool: nm scope requires country match + isNmEligible !== false", () => {
  const pool = [
    { id: "a", country: "DK", isNmEligible: true },
    { id: "b", country: "DK", isNmEligible: false },
    { id: "c", country: "NO", isNmEligible: true },
  ];
  assert.deepEqual(filterCandidatePool(pool, { scope: "nm", value: "DK" }).map((r) => r.id), ["a"]);
});

test("filterCandidatePool: no criteria or non-array riders → empty", () => {
  assert.deepEqual(filterCandidatePool([{ id: "a" }], null), []);
  assert.deepEqual(filterCandidatePool(null, { scope: "division", value: "x" }), []);
});

// ─── poolCoverageFraction / biasWeightFor ────────────────────────────────────

test("poolCoverageFraction: monotonic 40→0.3, 99→1.0", () => {
  assert.equal(poolCoverageFraction(40), 0.3);
  assert.equal(poolCoverageFraction(99), 1.0);
  assert.ok(poolCoverageFraction(70) > poolCoverageFraction(50));
});

test("biasWeightFor: monotonic decreasing 40→0.6, 99→0.15", () => {
  assert.equal(biasWeightFor(40), 0.6);
  assert.ok(Math.abs(biasWeightFor(99) - 0.15) < 1e-9);
  assert.ok(biasWeightFor(70) < biasWeightFor(50));
});

// ─── generateShortlist ────────────────────────────────────────────────────────

test("generateShortlist: empty pool → empty shortlist, null topRiderId", () => {
  const result = generateShortlist({
    candidates: [], criteria: { scope: "division", value: "div-1" },
    scout: DEFAULT_SCOUT, teamId: "team-1", missionId: "m-1",
  });
  assert.deepEqual(result, { shortlist: [], topRiderId: null });
});

test("generateShortlist: shortlist size between shortlistMin/Max", () => {
  const candidates = makePool(30);
  const result = generateShortlist({
    candidates, criteria: { scope: "division", value: "div-1" },
    scout: DEFAULT_SCOUT, teamId: "team-1", missionId: "m-1",
  });
  assert.ok(result.shortlist.length >= SCOUT_JOB_CONFIG.mission.shortlistMin);
  assert.ok(result.shortlist.length <= SCOUT_JOB_CONFIG.mission.shortlistMax);
  assert.ok(result.shortlist.includes(result.topRiderId));
});

test("generateShortlist: small pool below shortlistMin still returns all matches", () => {
  const candidates = makePool(2);
  const result = generateShortlist({
    candidates, criteria: { scope: "division", value: "div-1" },
    scout: DEFAULT_SCOUT, teamId: "team-1", missionId: "m-1",
  });
  assert.equal(result.shortlist.length, 2);
});

test("generateShortlist: deterministic — same inputs → same output", () => {
  const candidates = makePool(30);
  const args = {
    candidates, criteria: { scope: "division", value: "div-1" },
    scout: DEFAULT_SCOUT, teamId: "team-1", missionId: "m-1",
  };
  assert.deepEqual(generateShortlist(args), generateShortlist(args));
});

test("generateShortlist: different missionId → different shuffle order (not a fixed sort)", () => {
  const candidates = makePool(30);
  const a = generateShortlist({
    candidates, criteria: { scope: "division", value: "div-1" },
    scout: DEFAULT_SCOUT, teamId: "team-1", missionId: "m-1",
  });
  const b = generateShortlist({
    candidates, criteria: { scope: "division", value: "div-1" },
    scout: DEFAULT_SCOUT, teamId: "team-1", missionId: "m-2",
  });
  assert.notDeepEqual(a.shortlist, b.shortlist);
});

test("generateShortlist: never sorted by potentiale descending (position != rank)", () => {
  const candidates = makePool(30);
  const result = generateShortlist({
    candidates, criteria: { scope: "division", value: "div-1" },
    scout: DEFAULT_SCOUT, teamId: "team-1", missionId: "m-1",
  });
  const byId = new Map(candidates.map((r) => [r.id, r.potentiale]));
  const potentials = result.shortlist.map((id) => byId.get(id));
  const sortedDesc = [...potentials].sort((x, y) => y - x);
  assert.notDeepEqual(potentials, sortedDesc, "shortlist-rækkefølgen må ikke matche sorteret potentiale");
});

// ─── REQUIRED invariant (#1162): shortlist-position må ikke korrelere med sand rang ──
// Spearman rho over 200 seeds mellem (shortlist-position, sand potentiale-rang
// blandt de udvalgte) skal være < 0.3 (aftalt loft, jf. plan Task B3).

function spearman(pairs) {
  const n = pairs.length;
  const rank = (values) => {
    const sorted = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(n);
    sorted.forEach(([, origIdx], sortedIdx) => { ranks[origIdx] = sortedIdx; });
    return ranks;
  };
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const rx = rank(xs);
  const ry = rank(ys);
  const meanX = rx.reduce((a, b) => a + b, 0) / n;
  const meanY = ry.reduce((a, b) => a + b, 0) / n;
  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    cov += (rx[i] - meanX) * (ry[i] - meanY);
    varX += (rx[i] - meanX) ** 2;
    varY += (ry[i] - meanY) ** 2;
  }
  if (varX === 0 || varY === 0) return 0;
  return cov / Math.sqrt(varX * varY);
}

test("INVARIANT: shortlist-position vs sand potentiale-rang korrelation < 0.3 over 200 seeds", () => {
  const candidates = makePool(40);
  const pairs = [];
  for (let seed = 0; seed < 200; seed++) {
    const teamId = `team-${seed}`;
    const missionId = `mission-${seed}`;
    const result = generateShortlist({
      candidates, criteria: { scope: "division", value: "div-1" },
      scout: DEFAULT_SCOUT, teamId, missionId,
    });
    const byId = new Map(candidates.map((r) => [r.id, r.potentiale]));
    // Sand rang KUN blandt de riders der faktisk endte i denne shortlist (0=bedst).
    const trueRanked = [...result.shortlist].sort((a, b) => byId.get(b) - byId.get(a));
    const rankOf = new Map(trueRanked.map((id, i) => [id, i]));
    result.shortlist.forEach((id, position) => {
      pairs.push([position, rankOf.get(id)]);
    });
  }
  const rho = Math.abs(spearman(pairs));
  assert.ok(rho < 0.3, `Spearman rho=${rho} skal være < 0.3 (shortlist-position må ikke afsløre potentiale-rang)`);
});

test("INVARIANT holds across scout ratings (default + hired top scout)", () => {
  const candidates = makePool(40);
  const topScout = { overall: 90, roleSkills: { evaluation: 90, reach: 95 } };
  for (const scout of [DEFAULT_SCOUT, topScout]) {
    const pairs = [];
    for (let seed = 0; seed < 200; seed++) {
      const result = generateShortlist({
        candidates, criteria: { scope: "division", value: "div-1" },
        scout, teamId: `team-${seed}`, missionId: `mission-${seed}`,
      });
      const byId = new Map(candidates.map((r) => [r.id, r.potentiale]));
      const trueRanked = [...result.shortlist].sort((a, b) => byId.get(b) - byId.get(a));
      const rankOf = new Map(trueRanked.map((id, i) => [id, i]));
      result.shortlist.forEach((id, position) => pairs.push([position, rankOf.get(id)]));
    }
    const rho = Math.abs(spearman(pairs));
    assert.ok(rho < 0.3, `scout overall=${scout.overall}: rho=${rho} skal være < 0.3`);
  }
});
