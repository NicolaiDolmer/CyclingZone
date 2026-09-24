// backend/scripts/lib/headToHeadOrders.test.js
// Kontrakt-tests for harnessens rolle-/ordre-generator (#4615).
//
// Invarianterne er formuleret som EGENSKABER (rolle-vokabularet holdes, ordrer
// er deterministiske, sprint-tog kun paa massefinaler) — ikke som forventede
// stances for et bestemt felt. En test der laaste "hold t0 vaelger chase" ville
// braekke ved enhver kalibrering af M14 uden at fange en eneste rigtig fejl.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RACE_ROLES,
  assignFieldRoles,
  assignTeamRoles,
  buildStageTeamOrders,
  groupByTeam,
  sumOrderEffects,
} from "./headToHeadOrders.js";
import { LOCKED_FIELD_SIZE, resolveFieldSize, resolveSeeds } from "../headToHeadV4.js";

const ABILITY_KEYS = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(overrides = {}) {
  const out = {};
  for (const key of ABILITY_KEYS) out[key] = 50;
  return { ...out, ...overrides };
}

/** teamCount hold a riderCount ryttere, med varierede evner (deterministisk). */
function population(teamCount, ridersPerTeam) {
  const riders = [];
  for (let t = 0; t < teamCount; t++) {
    for (let i = 0; i < ridersPerTeam; i++) {
      riders.push({
        id: `t${t}r${i}`,
        team_id: `team-${t}`,
        abilities: abilities({
          climbing: 40 + ((t * 7 + i * 11) % 55),
          sprint: 35 + ((t * 13 + i * 5) % 60),
          aggression: 30 + ((t * 17 + i * 3) % 65),
          tempo: 45 + ((t * 3 + i * 9) % 45),
          positioning: 40 + ((t * 5 + i * 7) % 50),
        }),
      });
    }
  }
  return riders;
}

const flatRoute = { distance_km: 180, profile_type: "flat", finale_type: "bunch_sprint" };
const mountainRoute = { distance_km: 170, profile_type: "mountain", finale_type: "long_climb" };

test("roller: kun de fem kanoniske vaerdier bruges (RACE_ENGINE_RULES.md §1)", () => {
  const roles = assignFieldRoles(population(6, 8));
  for (const [riderId, role] of roles) {
    assert.ok(RACE_ROLES.includes(role), `${riderId} fik rollen "${role}", som ikke er i det kanoniske vokabular`);
  }
});

test("roller: hvert hold faar hoejst én kaptajn, én sprint-kaptajn og én hunter", () => {
  const riders = population(5, 9);
  for (const [, teamRiders] of groupByTeam(riders)) {
    const roles = [...assignTeamRoles(teamRiders).values()];
    for (const unique of ["captain", "sprint_captain", "hunter"]) {
      assert.ok(roles.filter((r) => r === unique).length <= 1, `mere end én ${unique} paa samme hold`);
    }
    assert.equal(roles.length, teamRiders.length, "alle holdets ryttere skal have en rolle");
  }
});

test("roller: et hold uden nok ryttere paa etapen faar ingen opdigtet struktur", () => {
  const roles = assignTeamRoles([
    { id: "a", abilities: abilities() },
    { id: "b", abilities: abilities() },
  ]);
  assert.deepEqual([...roles.values()], ["free_role", "free_role"]);
});

test("roller: deterministiske — samme felt giver samme roller", () => {
  const riders = population(4, 8);
  assert.deepEqual([...assignFieldRoles(riders)], [...assignFieldRoles([...riders])]);
});

test("ordrer: hvert hold faar praecis én team_tactics-ordre", () => {
  const riders = population(6, 8);
  const { orders } = buildStageTeamOrders({ riders, route: mountainRoute });
  const tactics = orders.filter((o) => o.kind === "team_tactics");
  assert.equal(tactics.length, 6);
  assert.equal(new Set(tactics.map((o) => o.team_id)).size, 6, "et hold maa ikke faa to taktik-ordrer");
});

test("ordrer: massefinale-flaget foelger ruten", () => {
  const riders = population(6, 8);
  const flat = buildStageTeamOrders({ riders, route: flatRoute });
  const mountain = buildStageTeamOrders({ riders, route: mountainRoute });
  assert.ok(flat.orders.some((o) => o.kind === "leadout"), "en massespurt skal give mindst ét sprint-tog");
  assert.equal(flat.effect.massFinish, true);
  assert.equal(mountain.effect.massFinish, false);
});

test("#5571 ordrer: sprint-toget er rollens standard — holdets hjaelpere, aldrig kaptajnen selv", () => {
  const riders = population(4, 8);
  const { orders, roles } = buildStageTeamOrders({ riders, route: flatRoute });
  const byTeam = groupByTeam(riders);
  for (const leadout of orders.filter((o) => o.kind === "leadout")) {
    const teamIds = new Set(byTeam.get(leadout.team_id).map((r) => r.id));
    assert.ok(!leadout.params.leadout_rider_ids.includes(leadout.params.captain_rider_id), "kaptajnen koerer ikke sit eget tog");
    for (const id of leadout.params.leadout_rider_ids) {
      assert.ok(teamIds.has(id), `${id} er ikke paa hold ${leadout.team_id}`);
      assert.equal(roles.get(id), "helper");
    }
    assert.equal(roles.get(leadout.params.captain_rider_id), "sprint_captain");
  }
});

test("#5571 ordrer: indsatsen pr. rytter er PRAECIS ordrens (det motoren laeser paa Entrant.effort)", () => {
  const riders = population(6, 8);
  const race = { is_stage_race: true, later_stages: [flatRoute] };
  const { orders, effortByRider } = buildStageTeamOrders({ riders, route: mountainRoute, race });
  const fromOrders = new Map();
  for (const o of orders.filter((x) => x.kind === "team_tactics")) {
    for (const r of o.params.riders) fromOrders.set(r.rider_id, r.effort);
  }
  assert.deepEqual([...effortByRider].sort(), [...fromOrders].sort());
  assert.equal(effortByRider.size, riders.length, "alle holdenes ryttere er AI-ryttere i harnessen");
});

test("#5571 ordrer: bjergetape i et etapeloeb — sprint-kaptajnerne koerer grupetto og er ude af toget", () => {
  const riders = population(6, 8);
  const race = { is_stage_race: true, later_stages: [flatRoute] };
  const { orders, roles, effortByRider, effect } = buildStageTeamOrders({ riders, route: mountainRoute, race });
  for (const [riderId, role] of roles) {
    if (role === "sprint_captain") assert.equal(effortByRider.get(riderId), "grupetto", riderId);
  }
  assert.ok(effect.effort.grupetto > 0);
  for (const leadout of orders.filter((o) => o.kind === "leadout")) {
    for (const id of leadout.params.leadout_rider_ids) assert.notEqual(effortByRider.get(id), "grupetto");
  }
  // Uden loebs-kontekst: ingen grupetto og intet alt-ud (loebet er ukendt).
  const unknown = buildStageTeamOrders({ riders, route: mountainRoute });
  assert.equal(unknown.effect.effort.grupetto, 0);
  assert.equal(unknown.effect.effort.all_out, 0);
});

test("ordrer: deterministiske — samme felt + samme rute giver identiske ordrer", () => {
  const riders = population(5, 9);
  const a = buildStageTeamOrders({ riders, route: flatRoute });
  const b = buildStageTeamOrders({ riders, route: flatRoute });
  assert.deepEqual(a.orders, b.orders);
});

test("ordrer: ryttere uden hold faar ingen holdplan", () => {
  const riders = [...population(2, 6), { id: "solo-1", team_id: null, abilities: abilities() }];
  const { orders, roles } = buildStageTeamOrders({ riders, route: flatRoute });
  assert.equal(roles.get("solo-1"), "free_role");
  assert.equal(orders.filter((o) => o.team_id === null || o.team_id === "null").length, 0);
});

test("effekt-rapport: summerer pr. etape uden at tabe kategorier", () => {
  const riders = population(4, 8);
  const flat = buildStageTeamOrders({ riders, route: flatRoute }).effect;
  const mountain = buildStageTeamOrders({ riders, route: mountainRoute }).effect;
  const total = sumOrderEffects([flat, mountain]);

  assert.equal(total.stages, 2);
  assert.equal(total.teams, flat.teams + mountain.teams);
  assert.equal(total.massFinishStages, 1);
  const stanceSum = total.stance.chase + total.stance.neutral + total.stance.let_go;
  assert.equal(stanceSum, total.teams, "hvert hold skal bidrage med praecis én stance");
});

// ── Laast feltstoerrelse (#4604 modsigelse 11) ────────────────────────────────

test("feltstoerrelse: laast som default, 'all' er den eksplicitte vej ud", () => {
  assert.equal(resolveFieldSize(null), LOCKED_FIELD_SIZE, "uden flag skal feltet vaere laast");
  assert.equal(resolveFieldSize(""), LOCKED_FIELD_SIZE);
  assert.equal(resolveFieldSize("all"), null);
  assert.equal(resolveFieldSize("ALL"), null);
  assert.equal(resolveFieldSize("120"), 120);
  assert.throws(() => resolveFieldSize("-4"), /ugyldig/);
  assert.throws(() => resolveFieldSize("abc"), /ugyldig/);
});

test("seeds: --seeds giver listen, ellers falder vi tilbage til --seed", () => {
  assert.deepEqual(resolveSeeds(null, "s"), ["s"]);
  assert.deepEqual(resolveSeeds("a,b,c", "s"), ["a", "b", "c"]);
  assert.deepEqual(resolveSeeds(" a , b ", "s"), ["a", "b"]);
  assert.deepEqual(resolveSeeds(",,", "s"), ["s"]);
});
