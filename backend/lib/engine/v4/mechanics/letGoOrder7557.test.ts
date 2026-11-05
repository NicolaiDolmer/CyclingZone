// #7557: spillerens gemte "lad gaa" vinder over motorens egen jagt, bag kontakten
// let_go_order_7557. Her testes reglerne direkte; den hele kaede fra raekke til film
// staar i backend/lib/raceRunner7557Flag.test.js.
import test from "node:test";
import assert from "node:assert/strict";

import type { Entrant, TeamOrder } from "../types.ts";
import { parseBreakawayOrders, stageWinChaseForceV3 } from "./breakaway.ts";
import type { GcThreat } from "./gcThreat.ts";
import { MANAGER_LET_GO_7557_PARAM, advanceTeamReaction, letGoOrderTeamIds, planTeamReaction } from "./teamChaseReaction.ts";

const seriousThreat: GcThreat = {
  severity: "serious", reason: "rival_ahead", protected_rider_id: "p", chase_group_id: "peloton-0", threat_rider_ids: ["t"], tied: false,
};
const leashOnly: GcThreat = { ...seriousThreat, severity: "none", reason: "harmless", threat_rider_ids: [], leash_hold: true };
const reacting = { status: "reacting", mode: "preventive", neutral_work: 0, preventive_work: 0, reason: "rival_ahead" } as const;

test("#7557 planTeamReaction: uden kontakten beholder lad-gaa sin undtagelse", () => {
  const plan = planTeamReaction({ prior: undefined, threat: seriousThreat, stance: "let_go", availableWorkers: ["w"] });
  assert.equal(plan.mode, "preventive");
  assert.ok(plan.intensity > 0);
});

test("#7557 planTeamReaction: spillerens lad-gaa slaar undtagelsen fra", () => {
  const plan = planTeamReaction({ prior: undefined, threat: seriousThreat, stance: "let_go", availableWorkers: ["w"], letGoOrderWins: true });
  assert.equal(plan.intensity, 0);
  assert.equal(plan.mode, null);
  assert.equal(plan.reason, "let_go_order");
});

test("#7557 planTeamReaction: snoren holder heller ikke et hold med spillerens lad-gaa", () => {
  const held = planTeamReaction({ prior: reacting, threat: leashOnly, stance: "let_go", availableWorkers: ["w"], leash: true });
  assert.ok(held.intensity > 0, "uden kontakten holder snoren");
  const plan = planTeamReaction({ prior: reacting, threat: leashOnly, stance: "let_go", availableWorkers: ["w"], leash: true, letGoOrderWins: true });
  assert.equal(plan.intensity, 0);
});

test("#7557 planTeamReaction: kontakten roerer kun lad-gaa", () => {
  const neutral = planTeamReaction({ prior: undefined, threat: seriousThreat, stance: "neutral", availableWorkers: ["w"] });
  assert.deepEqual(planTeamReaction({ prior: undefined, threat: seriousThreat, stance: "neutral", availableWorkers: ["w"], letGoOrderWins: true }), neutral);
  const chase = planTeamReaction({ prior: undefined, threat: seriousThreat, stance: "chase", availableWorkers: ["w"] });
  assert.deepEqual(planTeamReaction({ prior: undefined, threat: seriousThreat, stance: "chase", availableWorkers: ["w"], letGoOrderWins: true }), chase);
});

test("#7557 advanceTeamReaction: en vundet ordre giver hverken arbejde eller events", () => {
  const plan = planTeamReaction({ prior: undefined, threat: seriousThreat, stance: "let_go", availableWorkers: ["w"], letGoOrderWins: true });
  const out = advanceTeamReaction({ prior: undefined, threat: seriousThreat, stance: "let_go", availableWorkers: ["w"], performedWork: 0, teamId: "A", km: 10, plan });
  assert.deepEqual(out.events, []);
  assert.deepEqual(out.workers, []);
  assert.equal(out.next.status, "idle");
});

test("#7557 markeringen: kun en lad-gaa-ordre med parameteren vinder", () => {
  const order = (team_id: string, stance: string, marked: boolean) => ({
    kind: "team_tactics", team_id, params: { breakaway_stance: stance, riders: [], ...(marked ? { [MANAGER_LET_GO_7557_PARAM]: true } : {}) },
  }) as unknown as TeamOrder;
  const parsed = parseBreakawayOrders([order("A", "let_go", true), order("B", "let_go", false), order("C", "neutral", true)]);
  assert.deepEqual([...letGoOrderTeamIds(parsed)], ["A"]);
  assert.deepEqual([...letGoOrderTeamIds(parseBreakawayOrders([order("A", "let_go", false)]))], []);
});

function rider(teamId: string, sprint: number): Entrant {
  return { team_id: teamId, role: "helper", abilities: { sprint, acceleration: sprint, flat: sprint, climbing: sprint, hills: sprint } } as unknown as Entrant;
}

test("#7557 etapeinteressen: et hold med spillerens lad-gaa staar uden for, og pladsen gaar videre", () => {
  const entrants: Record<string, Entrant> = {};
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) { const id = `a${i}`; entrants[id] = rider("A", 90 - i); ids.push(id); }
  for (let i = 0; i < 12; i++) { const id = `b${i}`; entrants[id] = rider("B", 60 - i); ids.push(id); }
  const input = {
    chaseGroupRiderIds: ids, entrants, finaleType: "bunch_sprint" as const, abilityScale: 1, profileType: "flat" as const, teamSignals: new Map<string, number>(),
  };
  const before = stageWinChaseForceV3(input);
  assert.ok((before.interestByTeam.get("A") ?? 0) > 0, "hold A har interessen foer ordren");
  const after = stageWinChaseForceV3({ ...input, letGoOrderTeams: new Set(["A"]) });
  assert.equal(after.interestByTeam.has("A"), false);
  assert.ok((after.interestByTeam.get("B") ?? 0) > (before.interestByTeam.get("B") ?? 0), "et hold der vil jage, overtager pladsen");
  assert.ok(after.total > 0, "feltet jager stadig");
  assert.deepEqual(stageWinChaseForceV3({ ...input, letGoOrderTeams: new Set<string>() }), before, "tomt saet = som foer");
});
