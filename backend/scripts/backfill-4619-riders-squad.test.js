// Tests for #4619-backfill'en. Det vigtigste er IDEMPOTENSEN: planen bygges af
// en ren funktion uden I/O, så vi kan køre den, anvende dens egne patches på
// fixturen, og køre den igen — anden kørsel SKAL være tom. Det er præcis den
// garanti et prod-backfill står og falder med.

import test from "node:test";
import assert from "node:assert/strict";

import { planSquadBackfill, targetSquadFor } from "./backfill-4619-riders-squad.js";
import { SQUAD_CAPS } from "../lib/squads.js";
import { LAUNCH_REFERENCE_YEAR } from "../lib/riderSeasonAge.js";

const SEASON = 3; // referenceår 2028
const SEASON_ID = "s3";
const bornForAge = (age) => `${LAUNCH_REFERENCE_YEAR + (SEASON - 1) - age}-06-15`;

const TEAMS = [
  { id: "t1", name: "Alpha Cycling" },
  { id: "t2", name: "Beta Racing" },
];

function rider(id, { age, academy = true, team = "t1", squad = "senior" } = {}) {
  return {
    id, team_id: team, firstname: "R", lastname: id,
    birthdate: age === null ? null : bornForAge(age),
    is_academy: academy, squad, is_retired: false,
  };
}

// Anvend planens egne patches på fixturen — som DB'en ville gøre.
function applyPlanTo(riders, graduations, plan) {
  const byId = new Map(riders.map((r) => [r.id, { ...r }]));
  for (const u of plan.riderUpdates) Object.assign(byId.get(u.id), { squad: u.squad, is_academy: u.is_academy });
  const grads = graduations.map((g) => {
    const patch = plan.graduationBackfills.find((p) => p.id === g.id);
    return patch ? { ...g, ...patch } : { ...g };
  });
  let seq = grads.length;
  for (const row of plan.newGraduations) grads.push({ id: `g-new-${++seq}`, ...row });
  return { riders: [...byId.values()], graduations: grads };
}

// ── reglen ───────────────────────────────────────────────────────────────────

test("targetSquadFor: reglen fra spec §3.2", () => {
  assert.deepEqual(targetSquadFor(rider("a", { age: 17 }), SEASON), { squad: "junior", seasonAge: 17, needsGraduation: false });
  assert.deepEqual(targetSquadFor(rider("b", { age: 18 }), SEASON), { squad: "junior", seasonAge: 18, needsGraduation: false });
  assert.deepEqual(targetSquadFor(rider("c", { age: 19 }), SEASON), { squad: "u23", seasonAge: 19, needsGraduation: false });
  assert.deepEqual(targetSquadFor(rider("d", { age: 22 }), SEASON), { squad: "u23", seasonAge: 22, needsGraduation: false });
});

test("targetSquadFor: >= 23 i akademiet bliver u23 + pending graduation, IKKE senior", () => {
  // Han skal igennem Graduation Day (managerens override-vindue), ikke direkte
  // paa seniorholdets loenningsliste.
  assert.deepEqual(targetSquadFor(rider("e", { age: 23 }), SEASON), { squad: "u23", seasonAge: 23, needsGraduation: true });
  assert.deepEqual(targetSquadFor(rider("f", { age: 27 }), SEASON), { squad: "u23", seasonAge: 27, needsGraduation: true });
});

test("targetSquadFor: alt ikke-akademi bliver senior, uanset alder", () => {
  assert.equal(targetSquadFor(rider("g", { age: 17, academy: false }), SEASON).squad, "senior");
  assert.equal(targetSquadFor(rider("h", { age: 30, academy: false }), SEASON).squad, "senior");
  assert.equal(targetSquadFor(rider("i", { age: null, academy: false }), SEASON).squad, "senior");
});

test("targetSquadFor: akademirytter uden fodselsdato placeres i junior, aldrig gaettet op", () => {
  const r = targetSquadFor(rider("j", { age: null }), SEASON);
  assert.equal(r.squad, "junior");
  assert.equal(r.seasonAge, null);
  assert.equal(r.needsGraduation, false);
});

// ── planen ───────────────────────────────────────────────────────────────────

const POPULATION = [
  rider("r17", { age: 17 }),
  rider("r18", { age: 18 }),
  rider("r20", { age: 20 }),
  rider("r22", { age: 22 }),
  rider("r24", { age: 24 }),                                  // vokset ud -> pending
  rider("r30", { age: 30, academy: false }),                  // senior
  rider("r19b", { age: 19, team: "t2" }),
  rider("r-free", { age: 21, team: null }),                   // akademi-fri-agent
];

test("planSquadBackfill: totals + hvilke raekker der aendres", () => {
  const plan = planSquadBackfill({ riders: POPULATION, teams: TEAMS, graduations: [], seasonNumber: SEASON, seasonId: SEASON_ID });
  assert.deepEqual(plan.totals, { senior: 1, u23: 5, junior: 2 });
  assert.equal(plan.stats.ridersScanned, 8);
  // r30 staar allerede korrekt (senior + is_academy=false) og skal ikke roeres.
  assert.equal(plan.riderUpdates.some((u) => u.id === "r30"), false);
  assert.equal(plan.stats.ridersChanging, 7);
});

test("planSquadBackfill: snapshot-raekker daekker praecis de ryttere der aendres", () => {
  const plan = planSquadBackfill({ riders: POPULATION, teams: TEAMS, graduations: [], seasonNumber: SEASON, seasonId: SEASON_ID });
  assert.deepEqual(
    plan.snapshotRows.map((s) => s.rider_id).sort(),
    plan.riderUpdates.map((u) => u.id).sort(),
  );
  assert.equal(plan.snapshotRows[0].squad_before, "senior", "foer-vaerdien er kolonnens DEFAULT");
  assert.equal(plan.snapshotRows[0].is_academy_before, true);
});

test("planSquadBackfill: squad og is_academy skrives altid sammen", () => {
  const plan = planSquadBackfill({ riders: POPULATION, teams: TEAMS, graduations: [], seasonNumber: SEASON, seasonId: SEASON_ID });
  for (const u of plan.riderUpdates) {
    assert.equal(u.is_academy, u.squad !== "senior", `${u.id}: is_academy skal vaere squad <> senior`);
  }
});

test("planSquadBackfill: pending graduation kun til den >= 23-aarige MED hold", () => {
  const withFreeOldster = [...POPULATION, rider("r-old-free", { age: 25, team: null })];
  const plan = planSquadBackfill({ riders: withFreeOldster, teams: TEAMS, graduations: [], seasonNumber: SEASON, seasonId: SEASON_ID });
  assert.equal(plan.stats.outgrownU23, 2, "begge er vokset ud");
  assert.deepEqual(plan.newGraduations.map((g) => g.rider_id), ["r24"], "academy_graduation.team_id er NOT NULL");
  assert.equal(plan.newGraduations[0].from_squad, "u23");
  assert.equal(plan.newGraduations[0].to_squad, "senior");
  assert.equal(plan.newGraduations[0].status, "pending");
  assert.ok(plan.newGraduations[0].deadline);
  // academy_graduation.season_id er NOT NULL uden default: mangler den, fejler
  // --apply paa foerste insert, og kun der (CodeRabbit-fund, 15/9).
  assert.equal(plan.newGraduations[0].season_id, SEASON_ID);
});

test("planSquadBackfill: kraever et season_id (ellers fejler --apply foerst i prod)", () => {
  assert.throws(
    () => planSquadBackfill({ riders: [], teams: [], graduations: [], seasonNumber: SEASON }),
    /seasonId required/,
  );
});

test("planSquadBackfill: en rytter med eksisterende pending-raekke faar ikke en ny", () => {
  const plan = planSquadBackfill({
    riders: POPULATION, teams: TEAMS, seasonNumber: SEASON, seasonId: SEASON_ID,
    graduations: [{ id: "g1", rider_id: "r24", team_id: "t1", status: "pending", from_squad: null, to_squad: null }],
  });
  assert.equal(plan.newGraduations.length, 0);
  assert.deepEqual(plan.graduationBackfills, [{ id: "g1", from_squad: "u23", to_squad: "senior" }]);
});

test("planSquadBackfill: grad-raekker der ALLEREDE har trup-felter roeres ikke", () => {
  const plan = planSquadBackfill({
    riders: POPULATION, teams: TEAMS, seasonNumber: SEASON, seasonId: SEASON_ID,
    graduations: [{ id: "g2", rider_id: "r18", team_id: "t1", status: "resolved", from_squad: "junior", to_squad: "u23" }],
  });
  assert.equal(plan.graduationBackfills.length, 0);
});

// ── go-kort-tallene ──────────────────────────────────────────────────────────

test("planSquadBackfill: hold over loft rapporteres med navn og antal", () => {
  const crowded = [
    ...Array.from({ length: SQUAD_CAPS.u23 + 2 }, (_, i) => rider(`u${i}`, { age: 20, team: "t1" })),
    ...Array.from({ length: SQUAD_CAPS.junior + 1 }, (_, i) => rider(`j${i}`, { age: 17, team: "t2" })),
    ...Array.from({ length: SQUAD_CAPS.junior }, (_, i) => rider(`jok${i}`, { age: 17, team: "t1" })),
  ];
  const plan = planSquadBackfill({ riders: crowded, teams: TEAMS, graduations: [], seasonNumber: SEASON, seasonId: SEASON_ID });
  assert.deepEqual(plan.overCap, [
    { team: "Alpha Cycling", teamId: "t1", squad: "u23", count: 14, cap: 12 },
    { team: "Beta Racing", teamId: "t2", squad: "junior", count: 11, cap: 10 },
  ]);
  // Præcis paa loftet er IKKE over loftet.
  assert.equal(plan.overCap.some((o) => o.teamId === "t1" && o.squad === "junior"), false);
});

test("planSquadBackfill: pr. hold taelles kun ungdomsryttere, og kun dem med hold", () => {
  const plan = planSquadBackfill({ riders: POPULATION, teams: TEAMS, graduations: [], seasonNumber: SEASON, seasonId: SEASON_ID });
  const t1 = plan.perTeam.find((t) => t.teamId === "t1");
  assert.deepEqual({ u23: t1.u23, junior: t1.junior }, { u23: 3, junior: 2 }, "r20, r22, r24 + r17, r18");
  assert.equal(plan.perTeam.some((t) => t.teamId === null), false, "fri agenter taelles ikke paa et hold");
});

test("planSquadBackfill: ukendt hold-id falder tilbage paa id'et, ikke paa undefined", () => {
  const plan = planSquadBackfill({ riders: [rider("x", { age: 20, team: "t-ghost" })], teams: TEAMS, graduations: [], seasonNumber: SEASON, seasonId: SEASON_ID });
  assert.equal(plan.perTeam[0].name, "t-ghost");
});

// ── idempotens ───────────────────────────────────────────────────────────────

test("IDEMPOTENS: anden koersel aendrer intet", () => {
  const graduations = [{ id: "g1", rider_id: "r18", team_id: "t1", status: "resolved", from_squad: null, to_squad: null }];
  const first = planSquadBackfill({ riders: POPULATION, teams: TEAMS, graduations, seasonNumber: SEASON, seasonId: SEASON_ID });
  assert.ok(first.stats.ridersChanging > 0, "foerste koersel skal faktisk lave noget");

  const after = applyPlanTo(POPULATION, graduations, first);
  const second = planSquadBackfill({ riders: after.riders, teams: TEAMS, graduations: after.graduations, seasonNumber: SEASON, seasonId: SEASON_ID });

  assert.deepEqual(second.riderUpdates, [], "ingen rytter aendres anden gang");
  assert.deepEqual(second.snapshotRows, [], "ingen ny snapshot-raekke");
  assert.deepEqual(second.newGraduations, [], "ingen ny pending-raekke");
  assert.deepEqual(second.graduationBackfills, [], "ingen grad-raekke at backfille");
  // Tallene i go-kortet er stadig de samme — planen er en funktion af
  // populationen, ikke af hvad der allerede er skrevet.
  assert.deepEqual(second.totals, first.totals);
  assert.deepEqual(second.overCap, first.overCap);
});

test("IDEMPOTENS: tredje koersel er ogsaa tom", () => {
  const first = planSquadBackfill({ riders: POPULATION, teams: TEAMS, graduations: [], seasonNumber: SEASON, seasonId: SEASON_ID });
  const after1 = applyPlanTo(POPULATION, [], first);
  const second = planSquadBackfill({ riders: after1.riders, teams: TEAMS, graduations: after1.graduations, seasonNumber: SEASON, seasonId: SEASON_ID });
  const after2 = applyPlanTo(after1.riders, after1.graduations, second);
  const third = planSquadBackfill({ riders: after2.riders, teams: TEAMS, graduations: after2.graduations, seasonNumber: SEASON, seasonId: SEASON_ID });
  assert.equal(third.stats.ridersChanging, 0);
  assert.equal(third.stats.pendingGraduationsToCreate, 0);
});

test("planSquadBackfill: kraever et saesonnummer (ingen tavs default)", () => {
  assert.throws(() => planSquadBackfill({ riders: [], teams: [], graduations: [] }), /seasonNumber required/);
});
