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
  assert.deepEqual(parseArgs([]), { squads: ["u23", "junior"], apply: false, ownerGo: false, groupSize: 24 });
  assert.deepEqual(parseArgs(["--squad=junior"]).squads, ["junior"]);
  assert.deepEqual(parseArgs(["--squad=all"]).squads, ["u23", "junior"]);
  assert.throws(() => parseArgs(["--apply"]), /owner-go/);
  assert.equal(parseArgs(["--apply", "--owner-go"]).apply, true);
  assert.throws(() => parseArgs(["--squad=senior"]));
  assert.throws(() => parseArgs(["--group-size=3"]));
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
    ["u23", 1, 0, "U23 — Group A"],
    ["u23", 1, 1, "U23 — Group B"],
    ["u23", 1, 2, "U23 — Group C"],
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

test("publicSummary/renderMarkdown indeholder ingen holdnavne eller team-id'er", () => {
  const w = world();
  const sp = buildSquadPlan({ squad: "u23", ...w });
  const summary = publicSummary([sp], { generatedAt: "2026-09-25T00:00:00.000Z", eligibleManagers: 40, eligibleAi: 20, globalRankRows: 40 });
  const text = JSON.stringify(summary) + renderMarkdown(summary);
  assert.doesNotMatch(text, /Hold M|AI 0|\bm0\d\d\b|\ba0\d\d\b/);
  assert.equal(summary.squads[0].groupCount, 3);
  assert.match(renderMarkdown(summary), /U23 — Group A/);
});
