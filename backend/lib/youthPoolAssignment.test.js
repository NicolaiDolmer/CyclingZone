import test from "node:test";
import assert from "node:assert/strict";

import {
  YOUTH_GROUP_SIZE,
  groupLetter,
  youthGroupLabel,
  youthGroupCount,
  isEligibleManagerTeam,
  isEligibleAiTeam,
  rankManagersForYouth,
  planYouthGroups,
  pickYouthGroupForNewTeam,
  planYouthTopUp,
} from "./youthPoolAssignment.js";
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";

const pad = (n) => String(n).padStart(3, "0");
const manager = (i, extra = {}) => ({ id: `m${pad(i)}`, name: `Hold M${pad(i)}`, is_ai: false, parked_at: null, youthRiders: 0, ...extra });
const aiTeam = (i, extra = {}) => ({ id: `a${pad(i)}`, name: `AI ${pad(i)}`, is_ai: true, youthRiders: 7, ...extra });
// Global Rank: m001 er bedst (flest point), faldende.
const ranksFor = (teams) => teams.map((t, i) => ({ team_id: t.id, global_points: 10000 - i * 10, global_rank: i + 1, active_recent: true }));

function realisticInput({ managers = 114, ai = 101 } = {}) {
  const teams = Array.from({ length: managers }, (_, i) => manager(i + 1, { youthRiders: i % 9 }));
  const aiTeams = Array.from({ length: ai }, (_, i) => aiTeam(i + 1));
  return { teams, aiTeams, globalRanks: ranksFor(teams) };
}

const poolOf = (plan, teamId) => plan.groups.find((g) => g.managerTeamIds.includes(teamId) || g.aiTeamIds.includes(teamId))?.poolIndex;

test("groupLetter/label følger seniorpuljernes bogstav-mønster", () => {
  assert.equal(groupLetter(0), "A");
  assert.equal(groupLetter(8), "I");
  assert.equal(groupLetter(26), "AA");
  assert.equal(youthGroupLabel("u23", 0), "U23 — Group A");
  assert.equal(youthGroupLabel("junior", 2), "Junior — Group C");
  assert.throws(() => youthGroupLabel("senior", 0));
});

test("youthGroupCount: så få grupper som muligt uden at nogen går over 24", () => {
  assert.equal(youthGroupCount(0), 1);
  assert.equal(youthGroupCount(24), 1);
  assert.equal(youthGroupCount(25), 2);
  assert.equal(youthGroupCount(215), 9);
  assert.equal(youthGroupCount(217), 10);
});

test("ca. 9 grupper pr. trup med prod-lignende tal, ingen gruppe over 24, alle placeret", () => {
  const plan = planYouthGroups({ ...realisticInput(), squad: "u23" });
  assert.equal(plan.groups.length, 9);
  for (const g of plan.groups) {
    assert.ok(g.size <= YOUTH_GROUP_SIZE, `gruppe ${g.poolIndex} har ${g.size}`);
    assert.equal(g.tier, 1);
    assert.equal(g.squad, "u23");
  }
  assert.equal(plan.summary.managers, 114);
  assert.equal(plan.summary.aiTeams, 101);
  assert.deepEqual(plan.aiOverflow, []);
  const placed = plan.groups.reduce((n, g) => n + g.size, 0);
  assert.equal(placed, 215);
  assert.ok(plan.summary.largestGroup - plan.summary.smallestGroup <= 1);
});

test("snake-balance: top-seeds spredes, og hver gruppe får samme antal managers ±1", () => {
  const plan = planYouthGroups({ ...realisticInput(), squad: "u23" });
  // Række 0 → A..I, række 1 → I..A (boustrofedon).
  assert.equal(poolOf(plan, "m001"), 0);
  assert.equal(poolOf(plan, "m009"), 8);
  assert.equal(poolOf(plan, "m010"), 8);
  assert.equal(poolOf(plan, "m018"), 0);
  const counts = plan.groups.map((g) => g.managerTeamIds.length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `managers pr. gruppe: ${counts}`);
  // Sum af rang pr. gruppe ligger tæt (snake udligner styrke).
  const rankOf = new Map(plan.managers.map((m) => [m.teamId, m.rank]));
  const sums = plan.groups.map((g) => g.managerTeamIds.reduce((s, id) => s + rankOf.get(id), 0) / g.managerTeamIds.length);
  assert.ok(Math.max(...sums) - Math.min(...sums) < 10, `gennemsnitlig rang pr. gruppe: ${sums}`);
});

test("parkerede, frosne, test-, bank- og pensionerede hold udelukkes", () => {
  const teams = [
    manager(1),
    manager(2, { parked_at: "2026-09-01T00:00:00Z" }),
    manager(3, { is_frozen: true }),
    manager(4, { is_test_account: true }),
    manager(5, { is_bank: true }),
    manager(6, { retired_at: "2026-09-01T00:00:00Z" }),
    manager(7),
  ];
  const aiTeams = [aiTeam(1), aiTeam(2, { is_frozen: true }), aiTeam(3, { pending_removal_at: "2026-09-20T00:00:00Z" }), aiTeam(4)];
  const plan = planYouthGroups({ teams, aiTeams, globalRanks: ranksFor(teams), squad: "junior" });
  const placed = plan.groups.flatMap((g) => [...g.managerTeamIds, ...g.aiTeamIds]).sort();
  assert.deepEqual(placed, ["a001", "a004", "m001", "m007"]);
  assert.deepEqual(plan.excluded.managers.sort(), ["m002", "m003", "m004", "m005", "m006"]);
  assert.deepEqual(plan.excluded.ai.sort(), ["a002", "a003"]);
  assert.equal(isEligibleManagerTeam(manager(9, { parked_at: undefined })), true);
  assert.equal(isEligibleAiTeam(manager(9)), false);
});

test("hold uden Global Rank (ingen række eller NULL) ligger sidst i rækken", () => {
  const teams = [manager(1), manager(2), manager(3), manager(4)];
  const globalRanks = [
    { team_id: "m001", global_points: 0, global_rank: 3 },
    { team_id: "m002", global_points: 500, global_rank: null },
    { team_id: "m004", global_points: 900, global_rank: 1 },
  ];
  const order = rankManagersForYouth({ teams, globalRanks }).map((r) => r.teamId);
  assert.deepEqual(order.slice(0, 2), ["m004", "m001"]);
  assert.deepEqual(order.slice(2).sort(), ["m002", "m003"]);
  const plan = planYouthGroups({ teams, globalRanks, aiTeams: [], squad: "u23" });
  const missing = plan.managers.filter((m) => m.missingGlobalRank).map((m) => m.rank);
  assert.deepEqual(missing, [3, 4]);
});

test(`ingen gruppe under MIN_RACE_ENTRIES (${MIN_RACE_ENTRIES}) startklare hold, når AI-holdene har deres trup`, () => {
  const plan = planYouthGroups({ ...realisticInput(), squad: "u23" });
  for (const g of plan.groups) {
    assert.ok(g.starters >= MIN_RACE_ENTRIES, `gruppe ${g.poolIndex}: ${g.starters} startklare`);
    assert.ok(g.size >= MIN_RACE_ENTRIES);
  }
  assert.deepEqual(plan.summary.groupsBelowMinStarters, []);
});

test("startklare AI-hold spredes, selv når managerne klumper de startklare", () => {
  // Kun de 9 bedst rangerede managers er startklare → 1 pr. gruppe via snake.
  // Kun 45 af 101 AI-hold er startklare (før A6 er færdig) → 5 pr. gruppe.
  const teams = Array.from({ length: 114 }, (_, i) => manager(i + 1, { youthRiders: i < 9 ? 8 : 0 }));
  const aiTeams = Array.from({ length: 101 }, (_, i) => aiTeam(i + 1, { youthRiders: i < 45 ? 7 : 0 }));
  const plan = planYouthGroups({ teams, aiTeams, globalRanks: ranksFor(teams), squad: "u23" });
  const starters = plan.groups.map((g) => g.starters);
  assert.ok(Math.max(...starters) - Math.min(...starters) <= 1, `startklare pr. gruppe: ${starters}`);
  assert.ok(Math.min(...starters) >= MIN_RACE_ENTRIES);
});

test("rapporterer grupper under MIN_RACE_ENTRIES startklare, når feltet ikke rækker (før A6)", () => {
  const teams = Array.from({ length: 30 }, (_, i) => manager(i + 1, { youthRiders: i < 3 ? 8 : 0 }));
  const aiTeams = Array.from({ length: 10 }, (_, i) => aiTeam(i + 1, { youthRiders: 0 }));
  const plan = planYouthGroups({ teams, aiTeams, globalRanks: ranksFor(teams), squad: "junior" });
  assert.equal(plan.groups.length, 2);
  assert.deepEqual(plan.summary.groupsBelowMinStarters, [0, 1]);
});

test("determinisme: samme input i vilkårlig rækkefølge giver samme plan", () => {
  const input = realisticInput();
  const a = planYouthGroups({ ...input, squad: "u23" });
  const shuffled = {
    teams: [...input.teams].reverse(),
    aiTeams: [...input.aiTeams].sort(() => 0).reverse(),
    globalRanks: [...input.globalRanks].reverse(),
  };
  const b = planYouthGroups({ ...shuffled, squad: "u23" });
  assert.deepEqual(b.groups, a.groups);
  assert.deepEqual(b.managers, a.managers);
});

test("pickYouthGroupForNewTeam: flest AI-hold, tie → laveste pool_index", () => {
  const groups = [
    { squad: "u23", poolIndex: 0, aiTeamIds: ["a1", "a2"] },
    { squad: "u23", poolIndex: 1, aiTeamIds: ["a3", "a4", "a5"] },
    { squad: "u23", poolIndex: 2, aiCount: 3 },
    { squad: "junior", poolIndex: 3, aiTeamIds: ["a6", "a7", "a8", "a9"] },
  ];
  assert.equal(pickYouthGroupForNewTeam({ groups, squad: "u23" }).poolIndex, 1);
  assert.equal(pickYouthGroupForNewTeam({ groups, squad: "junior" }).poolIndex, 3);
  assert.equal(pickYouthGroupForNewTeam({ groups: [], squad: "u23" }), null);
});

test("planYouthTopUp: genkørsel uden ændringer er en no-op (idempotent)", () => {
  const input = realisticInput();
  const plan = planYouthGroups({ ...input, squad: "u23" });
  const again = planYouthTopUp({ groups: plan.groups, ...input, squad: "u23" });
  assert.deepEqual(again.moves, []);
  assert.deepEqual(again.displacedAi, []);
  assert.deepEqual(again.stale, []);
});

test("planYouthTopUp: ny manager overtager en AI-plads, det viger AI-hold placeres igen eller rapporteres", () => {
  const teams = Array.from({ length: 24 }, (_, i) => manager(i + 1));
  const aiTeams = Array.from({ length: 24 }, (_, i) => aiTeam(i + 1));
  const plan = planYouthGroups({ teams, aiTeams, globalRanks: ranksFor(teams), squad: "u23" });
  assert.equal(plan.groups.length, 2);
  assert.ok(plan.groups.every((g) => g.size === 24));
  const newcomer = manager(99);
  const top = planYouthTopUp({ groups: plan.groups, teams: [...teams, newcomer], aiTeams, globalRanks: ranksFor(teams), squad: "u23" });
  assert.equal(top.moves.filter((m) => m.kind === "manager").length, 1);
  assert.equal(top.displacedAi.length, 1);
  assert.deepEqual(top.aiOverflow, [top.displacedAi[0].teamId]);
  assert.ok(top.groups.every((g) => g.size <= 24));
});

test("planYouthTopUp: AI-hold efter A6 fylder op, og parkerede hold rapporteres som stale", () => {
  const teams = Array.from({ length: 30 }, (_, i) => manager(i + 1));
  const plan = planYouthGroups({ teams, aiTeams: Array.from({ length: 10 }, (_, i) => aiTeam(i + 1)), globalRanks: ranksFor(teams), squad: "junior" });
  const moreAi = Array.from({ length: 12 }, (_, i) => aiTeam(i + 1));
  const parked = teams.map((t) => (t.id === "m005" ? { ...t, parked_at: "2026-09-26T00:00:00Z" } : t));
  const top = planYouthTopUp({ groups: plan.groups, teams: parked, aiTeams: moreAi, globalRanks: ranksFor(teams), squad: "junior" });
  assert.deepEqual(top.moves.map((m) => m.teamId).sort(), ["a011", "a012"]);
  assert.deepEqual(top.stale, ["m005"]);
});
