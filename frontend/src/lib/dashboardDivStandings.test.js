import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMyDivisionStandings } from "./dashboardDivStandings.js";

// #2182 — dashboardets "My division standings"-modul skal defaulte til
// spillerens egen division OG pulje, ikke hele tieren (en tier kan have op til
// 8 puljer). Disse tests dækker filter-logikken der blev udtrukket fra
// DashboardPage.jsx til denne rene funktion.

const POOLS_TIER1 = [{ id: 1, tier: 1, pool_index: 0, label: "Division 1" }];
const POOLS_TIER3 = [
  { id: 10, tier: 3, pool_index: 0, label: "Division 3 — A" },
  { id: 11, tier: 3, pool_index: 1, label: "Division 3 — B" },
  { id: 12, tier: 3, pool_index: 2, label: "Division 3 — C" },
  { id: 13, tier: 3, pool_index: 3, label: "Division 3 — D" },
];
const ALL_POOLS = [...POOLS_TIER1, ...POOLS_TIER3];

function standingRow({ id, teamId, division, poolId, points, isAi = false }) {
  return {
    id,
    team_id: teamId,
    total_points: points,
    team: { id: teamId, division, league_division_id: poolId, is_ai: isAi, name: `Team ${teamId}` },
  };
}

test("computeMyDivisionStandings — filtrerer til egen division OG pulje når tieren har flere puljer (#2182 kerne-bug)", () => {
  const myTeam = { id: "me", division: 3, league_division_id: 11 };
  const standings = [
    standingRow({ id: 1, teamId: "me", division: 3, poolId: 11, points: 50 }),
    standingRow({ id: 2, teamId: "same-pool", division: 3, poolId: 11, points: 80 }),
    standingRow({ id: 3, teamId: "other-pool", division: 3, poolId: 12, points: 999 }),
    standingRow({ id: 4, teamId: "other-division", division: 4, poolId: 20, points: 999 }),
  ];
  const { divStandingsAll, hasPoolSubtabs } = computeMyDivisionStandings(standings, myTeam, ALL_POOLS);
  assert.equal(hasPoolSubtabs, true);
  assert.equal(divStandingsAll.length, 2);
  assert.ok(divStandingsAll.every(s => ["me", "same-pool"].includes(s.team_id)));
  assert.ok(!divStandingsAll.some(s => s.team_id === "other-pool"), "hold i anden pulje samme tier skal IKKE med (#2182)");
});

test("computeMyDivisionStandings — tier med kun én pulje (fx tier 1) filtrerer ikke yderligere på pulje", () => {
  const myTeam = { id: "me", division: 1, league_division_id: 1 };
  const standings = [
    standingRow({ id: 1, teamId: "me", division: 1, poolId: 1, points: 50 }),
    standingRow({ id: 2, teamId: "teammate", division: 1, poolId: 1, points: 80 }),
  ];
  const { divStandingsAll, hasPoolSubtabs, ownPoolRow } = computeMyDivisionStandings(standings, myTeam, ALL_POOLS);
  assert.equal(hasPoolSubtabs, false);
  assert.equal(ownPoolRow, null);
  assert.equal(divStandingsAll.length, 2);
});

test("computeMyDivisionStandings — kant-tilfælde: hold uden league_division_id (helt nyt hold) falder tilbage til hele tieren, ikke tom flade", () => {
  const myTeam = { id: "me", division: 3, league_division_id: null };
  const standings = [
    standingRow({ id: 1, teamId: "me", division: 3, poolId: null, points: 0 }),
    standingRow({ id: 2, teamId: "pool-a", division: 3, poolId: 10, points: 80 }),
    standingRow({ id: 3, teamId: "pool-b", division: 3, poolId: 11, points: 40 }),
  ];
  const { divStandingsAll, hasPoolSubtabs, divStandings } = computeMyDivisionStandings(standings, myTeam, ALL_POOLS);
  assert.equal(hasPoolSubtabs, false, "ukendt egen pulje => ingen pulje-filtrering");
  assert.equal(divStandingsAll.length, 3, "hele tieren vises, modulet må ikke render'e tomt");
  assert.ok(divStandings.length > 0);
});

test("computeMyDivisionStandings — kant-tilfælde: intet aktivt hold (team null/undefined) giver tom, ikke-krascherende liste", () => {
  const standings = [standingRow({ id: 1, teamId: "someone", division: 3, poolId: 10, points: 50 })];
  const result = computeMyDivisionStandings(standings, null, ALL_POOLS);
  assert.deepEqual(result.divStandingsAll, []);
  assert.deepEqual(result.divStandings, []);
  assert.equal(result.hasPoolSubtabs, false);
  assert.equal(result.myStandingIndex, -1);
});

test("computeMyDivisionStandings — AI-hold filtreres væk fra egen pulje-rangliste", () => {
  const myTeam = { id: "me", division: 3, league_division_id: 11 };
  const standings = [
    standingRow({ id: 1, teamId: "me", division: 3, poolId: 11, points: 50 }),
    standingRow({ id: 2, teamId: "ai-team", division: 3, poolId: 11, points: 999, isAi: true }),
  ];
  const { divStandingsAll } = computeMyDivisionStandings(standings, myTeam, ALL_POOLS);
  assert.equal(divStandingsAll.length, 1);
  assert.equal(divStandingsAll[0].team_id, "me");
});

test("computeMyDivisionStandings — sorterer efter total_points faldende", () => {
  const myTeam = { id: "me", division: 3, league_division_id: 11 };
  const standings = [
    standingRow({ id: 1, teamId: "me", division: 3, poolId: 11, points: 50 }),
    standingRow({ id: 2, teamId: "leader", division: 3, poolId: 11, points: 200 }),
    standingRow({ id: 3, teamId: "last", division: 3, poolId: 11, points: 10 }),
  ];
  const { divStandingsAll } = computeMyDivisionStandings(standings, myTeam, ALL_POOLS);
  assert.deepEqual(divStandingsAll.map(s => s.team_id), ["leader", "me", "last"]);
});

test("computeMyDivisionStandings — ownPoolRow matcher egen pulje-label (samme label-kilde som StandingsPage)", () => {
  const myTeam = { id: "me", division: 3, league_division_id: 12 };
  const standings = [standingRow({ id: 1, teamId: "me", division: 3, poolId: 12, points: 50 })];
  const { ownPoolRow } = computeMyDivisionStandings(standings, myTeam, ALL_POOLS);
  assert.equal(ownPoolRow.label, "Division 3 — C");
});

test("computeMyDivisionStandings — egen placering uden for top-5 tilføjes som ekstra række med _isOwnRowBreak", () => {
  const myTeam = { id: "me", division: 3, league_division_id: 11 };
  const standings = [
    standingRow({ id: 0, teamId: "me", division: 3, poolId: 11, points: 5 }),
    ...Array.from({ length: 6 }, (_, i) =>
      standingRow({ id: i + 1, teamId: `t${i}`, division: 3, poolId: 11, points: 100 - i })),
  ];
  const { divStandings, myStandingIndex } = computeMyDivisionStandings(standings, myTeam, ALL_POOLS);
  assert.equal(myStandingIndex, 6, "sidst efter sortering (lavest point)");
  assert.equal(divStandings.length, 6, "top-5 + egen ekstra række");
  const ownRow = divStandings[divStandings.length - 1];
  assert.equal(ownRow.team_id, "me");
  assert.equal(ownRow._isOwnRowBreak, true);
  assert.equal(ownRow._rank, 7);
});

test("computeMyDivisionStandings — egen placering i top-5 tilføjes IKKE som ekstra række", () => {
  const myTeam = { id: "me", division: 3, league_division_id: 11 };
  const standings = [
    standingRow({ id: 1, teamId: "me", division: 3, poolId: 11, points: 500 }),
    standingRow({ id: 2, teamId: "t2", division: 3, poolId: 11, points: 100 }),
  ];
  const { divStandings } = computeMyDivisionStandings(standings, myTeam, ALL_POOLS);
  assert.equal(divStandings.length, 2);
  assert.ok(!divStandings.some(s => s._isOwnRowBreak));
});

test("computeMyDivisionStandings — tom/null input giver tomme lister uden at kaste", () => {
  assert.deepEqual(computeMyDivisionStandings([], null, []).divStandingsAll, []);
  assert.deepEqual(computeMyDivisionStandings(null, null, null).divStandingsAll, []);
  assert.deepEqual(computeMyDivisionStandings(undefined, undefined, undefined).divStandings, []);
});
