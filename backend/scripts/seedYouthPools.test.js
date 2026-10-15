import test from "node:test";
import assert from "node:assert/strict";

import {
  parseArgs,
  fkColumn,
  youthRidersByTeam,
  currentGroups,
  buildSquadPlan,
  publicSummary,
  renderMarkdown,
  applyParkingForecast,
  squadNumbers,
  starterShares,
} from "./seedYouthPools.js";

const pad = (n) => String(n).padStart(3, "0");
const manager = (i, extra = {}) => ({ id: `m${pad(i)}`, name: `Hold M${pad(i)}`, is_ai: false, league_division_id: 10, ...extra });
const aiTeam = (i, extra = {}) => ({ id: `a${pad(i)}`, name: `AI ${pad(i)}`, is_ai: true, league_division_id: 10, ...extra });
const ranksFor = (teams) => teams.map((t, i) => ({ team_id: t.id, global_points: 5000 - i, global_rank: i + 1 }));

function world({ managers = 40, ai = 20 } = {}) {
  const teams = [
    ...Array.from({ length: managers }, (_, i) => manager(i + 1)),
    ...Array.from({ length: ai }, (_, i) => aiTeam(i + 1)),
  ];
  const riders = [
    ...Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, team_id: "m001", squad: "u23" })),
    { id: "rx", team_id: "m001", squad: "u23", is_retired: true },
    { id: "ry", team_id: "m001", squad: "junior" },
  ];
  return { teams, riders, globalRanks: ranksFor(teams.filter((t) => !t.is_ai)), pools: [{ id: 10, tier: 4, pool_index: 0, squad: "senior" }] };
}

test("parseArgs: dry-run default, begge trupper, --apply kræver --owner-go", () => {
  assert.deepEqual(parseArgs([]), { squads: ["u23", "junior"], apply: false, ownerGo: false, groupSize: 24, managersPerGroup: null, mixJunior: false, regroup: false });
  assert.deepEqual(parseArgs(["--squad=junior"]).squads, ["junior"]);
  assert.deepEqual(parseArgs(["--squad=all"]).squads, ["u23", "junior"]);
  assert.throws(() => parseArgs(["--apply"]), /owner-go/);
  assert.equal(parseArgs(["--apply", "--owner-go"]).apply, true);
  assert.throws(() => parseArgs(["--squad=senior"]));
  assert.throws(() => parseArgs(["--group-size=3"]));
});

test("parseArgs rejects malformed allocation flags instead of changing the plan", () => {
  assert.throws(() => parseArgs(["--managers-per-group"]), /managers-per-group/);
  assert.throws(() => parseArgs(["--mix-junior=true"]), /mix-junior/);
  assert.throws(() => parseArgs(["--mix-junior=false"]), /mix-junior/);
});

test("fkColumn peger på A2-kolonnerne", () => {
  assert.equal(fkColumn("u23"), "u23_league_division_id");
  assert.equal(fkColumn("junior"), "junior_league_division_id");
  assert.throws(() => fkColumn("senior"));
});

test("youthRidersByTeam tæller aktive ryttere i trup'en", () => {
  const counts = youthRidersByTeam(world().riders, "u23");
  assert.equal(counts.get("m001"), 7);
  assert.equal(youthRidersByTeam(world().riders, "junior").get("m001"), 1);
});

test("buildSquadPlan fresh: opretter grupperne og en FK-opdatering pr. placeret hold", () => {
  const w = world();
  const sp = buildSquadPlan({ squad: "u23", ...w });
  assert.equal(sp.mode, "fresh");
  assert.equal(sp.plan.groups.length, 3);
  assert.deepEqual(sp.poolsToCreate.map((p) => [p.squad, p.tier, p.pool_index, p.label]), [
    ["u23", 1, 0, "U23 Group A"],
    ["u23", 1, 1, "U23 Group B"],
    ["u23", 1, 2, "U23 Group C"],
  ]);
  assert.equal(sp.updates.length, 60);
  assert.ok(sp.updates.every((u) => u.column === "u23_league_division_id"));
  const starters = sp.plan.groups.reduce((n, g) => n + g.starters, 0);
  assert.equal(starters, 1);
});

test("buildSquadPlan: AI-hold uden seniorpulje springes over (samme krav som A6)", () => {
  const w = world({ managers: 2, ai: 2 });
  w.teams.push(aiTeam(99, { league_division_id: null }));
  const sp = buildSquadPlan({ squad: "junior", ...w });
  const placed = sp.plan.groups.flatMap((g) => g.aiTeamIds);
  assert.ok(!placed.includes("a099"));
});

test("buildSquadPlan genkørt efter apply = top-up med 0 skrivninger (idempotent)", () => {
  const w = world();
  const first = buildSquadPlan({ squad: "u23", ...w });
  const pools = [...w.pools, ...first.poolsToCreate.map((p, i) => ({ ...p, id: 100 + i }))];
  const idByIndex = new Map(pools.filter((p) => p.squad === "u23").map((p) => [p.pool_index, p.id]));
  const target = new Map(first.updates.map((u) => [u.teamId, idByIndex.get(u.poolIndex)]));
  const teams = w.teams.map((t) => ({ ...t, u23_league_division_id: target.get(t.id) ?? null }));
  const groups = currentGroups({ pools, teams, squad: "u23" });
  assert.equal(groups.length, 3);
  const again = buildSquadPlan({ squad: "u23", ...w, pools, teams });
  assert.equal(again.mode, "top-up");
  assert.deepEqual(again.updates, []);
  assert.deepEqual(again.poolsToCreate, []);
});

test("applyParkingForecast: sweepens parkerede hold falder ud, genindplacerede kommer med", () => {
  const w = world({ managers: 30, ai: 0 });
  w.teams.push(manager(31, { parked_at: "2026-08-01" }));
  const before = buildSquadPlan({ squad: "u23", ...w });
  assert.equal(before.plan.summary.managers, 30);
  const toPark = ["m001", "m002", "m003", "m004", "m005", "m006", "m007"];
  const forecastTeams = applyParkingForecast(w.teams, { toPark, toUnpark: ["m031"] });
  const after = squadNumbers(buildSquadPlan({ squad: "u23", ...w, teams: forecastTeams }));
  assert.deepEqual(after, { squad: "u23", managers: 24, aiTeams: 0, groupCount: 1, largestGroup: 24, smallestGroup: 24 });
  assert.equal(w.teams[0].parked_at, undefined, "input muteres ikke");
});

test("publicSummary/renderMarkdown indeholder ingen holdnavne eller team-id'er", () => {
  const w = world();
  const sp = buildSquadPlan({ squad: "u23", ...w });
  const forecast = { parked: 3, unparked: 1, squads: [squadNumbers(sp)] };
  const summary = publicSummary([sp], { generatedAt: "2026-09-25T00:00:00.000Z", eligibleManagers: 40, eligibleAi: 20, globalRankRows: 40, forecast });
  const text = JSON.stringify(summary) + renderMarkdown(summary);
  assert.match(renderMarkdown(summary), /Prognose efter sæsonskiftets parkering/);
  assert.doesNotMatch(text, /Hold M|AI 0|\bm0\d\d\b|\ba0\d\d\b/);
  assert.equal(summary.squads[0].groupCount, 3);
  assert.match(renderMarkdown(summary), /U23 Group A/);
});

// ── #6668: --regroup samler menneskeholdene i færre grupper ───────────────────
test("parseArgs: --regroup kræver et eksplicit --managers-per-group (dokumenteret valg)", () => {
  assert.throws(() => parseArgs(["--regroup"]), /managers-per-group/);
  assert.throws(() => parseArgs(["--regroup=yes", "--managers-per-group=20"]), /regroup/);
  const a = parseArgs(["--regroup", "--managers-per-group=20"]);
  assert.equal(a.regroup, true);
  assert.equal(a.managersPerGroup, 20);
});

function seeded(w, squad = "u23") {
  const first = buildSquadPlan({ squad, ...w });
  const pools = [...w.pools, ...first.poolsToCreate.map((p, i) => ({ ...p, id: 100 + i }))];
  const idByIndex = new Map(pools.filter((p) => p.squad === squad).map((p) => [p.pool_index, p.id]));
  const target = new Map(first.updates.map((u) => [u.teamId, idByIndex.get(u.poolIndex)]));
  const teams = w.teams.map((t) => ({ ...t, [fkColumn(squad)]: target.get(t.id) ?? null }));
  return { pools, teams, idByIndex };
}

test("buildSquadPlan --regroup: eksisterende grupper lægges om til færre, AI-overløb mister pladsen", () => {
  const w = world({ managers: 40, ai: 20 });
  const { pools, teams } = seeded(w);
  // Uden regroup: top-up, ingen ændring.
  assert.equal(buildSquadPlan({ squad: "u23", ...w, pools, teams, managersPerGroup: 20 }).mode, "top-up");
  const sp = buildSquadPlan({ squad: "u23", ...w, pools, teams, managersPerGroup: 20, regroup: true });
  assert.equal(sp.mode, "regroup");
  assert.equal(sp.plan.groups.length, 2, "40 managers / 20 = 2 grupper (før 3)");
  assert.deepEqual(sp.poolsToCreate, [], "de eksisterende grupper genbruges");
  assert.deepEqual(sp.unusedPools, [2]);
  const placed = new Set(sp.plan.groups.flatMap((g) => [...g.managerTeamIds, ...g.aiTeamIds]));
  assert.equal(placed.size, 48, "2 grupper à 24");
  // Alle managers har en plads; de AI-hold der ikke er plads til, får FK = null.
  const nulls = sp.updates.filter((u) => u.poolIndex === null).map((u) => u.teamId);
  assert.equal(nulls.length, 12);
  assert.ok(nulls.every((id) => id.startsWith("a")), "kun AI-hold mister plads");
  // Hold der allerede står i deres nye gruppe, skrives ikke igen.
  const current = new Map(teams.map((t) => [t.id, t.u23_league_division_id]));
  const idOf = new Map(pools.filter((p) => p.squad === "u23").map((p) => [p.pool_index, p.id]));
  assert.ok(sp.updates.every((u) => u.poolIndex === null || current.get(u.teamId) !== idOf.get(u.poolIndex)));
});

test("buildSquadPlan --regroup genkørt efter apply = 0 skrivninger", () => {
  const w = world({ managers: 40, ai: 20 });
  const { pools, teams, idByIndex } = seeded(w);
  const sp = buildSquadPlan({ squad: "u23", ...w, pools, teams, managersPerGroup: 20, regroup: true });
  const after = new Map(teams.map((t) => [t.id, t.u23_league_division_id]));
  for (const u of sp.updates) after.set(u.teamId, u.poolIndex == null ? null : idByIndex.get(u.poolIndex));
  const teams2 = teams.map((t) => ({ ...t, u23_league_division_id: after.get(t.id) }));
  const again = buildSquadPlan({ squad: "u23", ...w, pools, teams: teams2, managersPerGroup: 20, regroup: true });
  assert.deepEqual(again.updates, []);
});

test("starterShares: AI-andel af de startklare hold, samlet og i den mest AI-tunge gruppe", () => {
  const s = starterShares([
    { poolIndex: 0, managerStarters: 6, aiStarters: 2 },
    { poolIndex: 1, managerStarters: 2, aiStarters: 6 },
  ]);
  assert.equal(s.managerStarters, 8);
  assert.equal(s.aiStarters, 8);
  assert.equal(s.aiStarterShare, 0.5);
  assert.equal(s.maxGroupAiStarterShare, 0.75);
  assert.equal(s.minGroupManagerStarters, 2);
  assert.equal(starterShares([]).aiStarterShare, null);
});
