// backend/lib/engine/v4/ai/aiTactics.test.ts
// M14 (#4030, #2478): kontrakt-tests + forklarligheds-laas for AI-holdtaktik.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §8b beslutning 22 + docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md.

import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";

import { generateAiTeamOrder } from "./aiTactics.ts";
import { validateTeamOrder } from "./teamOrderContract.ts";
import type { AiRosterEntrant, AiTacticsInput, AiTacticsRoute } from "./aiTactics.ts";
import type { AbilityKey, RiderRole } from "../types.ts";

// ── Fixtures ───────────────────────────────────────────────────────────────

function abilities(overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const base: Record<AbilityKey, number> = {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
  };
  return { ...base, ...overrides };
}

function rider(rider_id: string, role: RiderRole, overrides: Partial<Record<AbilityKey, number>> = {}): AiRosterEntrant {
  return { rider_id, role, abilities: abilities(overrides) };
}

const MOUNTAIN: AiTacticsRoute = { profile_type: "mountain", finale_type: "long_climb" };
const FLAT_SPRINT: AiTacticsRoute = { profile_type: "flat", finale_type: "bunch_sprint" };

// ── Kaptajn beskyttes paa bjergetaper (opgave-eksemplet) ──────────────────────

test("staerk kaptajn til bjergetape -> chase + kaptajnen beskyttes, forklaret", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 85 }),
    rider("sprint-cap", "sprint_captain", { sprint: 90 }),
    rider("h1", "helper"),
    rider("hunt", "hunter", { aggression: 80, climbing: 70 }),
  ];
  const input: AiTacticsInput = { team_id: "team-1", route: MOUNTAIN, roster };
  const decision = generateAiTeamOrder(input);

  assert.equal(decision.order.breakaway_stance, "chase");
  const capOrder = decision.order.riders.find((r) => r.rider_id === "cap");
  assert.equal(capOrder?.effort, "protect");
  assert.equal(capOrder?.try_break, false);

  // Sprint-kaptajnen er off-specialty paa en bjergetape -> spares.
  const sprintCapOrder = decision.order.riders.find((r) => r.rider_id === "sprint-cap");
  assert.equal(sprintCapOrder?.effort, "save");

  // Forklarlighed: hver rytter + stance har en ikke-tom reason-streng.
  assert.ok(decision.reasons.breakaway_stance.length > 0);
  for (const r of roster) assert.ok((decision.reasons.riders[r.rider_id] ?? "").length > 0);
  assert.match(decision.reasons.riders.cap, /Beskyttes/);
});

// ── Sprint-tog-narrativ paa flade etaper ──────────────────────────────────────

test("staerk sprint-kaptajn til flad spurtetape -> chase + sprint-kaptajnen beskyttes", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 80 }),
    rider("sprint-cap", "sprint_captain", { sprint: 92 }),
    rider("h1", "helper"),
  ];
  const decision = generateAiTeamOrder({ team_id: "team-2", route: FLAT_SPRINT, roster });

  assert.equal(decision.order.breakaway_stance, "chase");
  assert.equal(decision.order.riders.find((r) => r.rider_id === "sprint-cap")?.effort, "protect");
  // GC-kaptajnen er off-specialty paa en flad spurtetape -> spares.
  assert.equal(decision.order.riders.find((r) => r.rider_id === "cap")?.effort, "save");
});

// ── Udbrudsforsoeg fra svage hold (opgave-eksemplet) ──────────────────────────

test("svagt hold uden kaptajn-kandidat til bjergetape -> let_go + hunter forsoeger udbrud", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 40 }), // langt under taerskel
    rider("hunt", "hunter", { aggression: 85, climbing: 75 }),
    rider("free", "free_role", { aggression: 40, climbing: 40 }),
    rider("h1", "helper"),
  ];
  const decision = generateAiTeamOrder({ team_id: "team-3", route: MOUNTAIN, roster });

  assert.equal(decision.order.breakaway_stance, "let_go");
  assert.equal(decision.order.riders.find((r) => r.rider_id === "cap")?.effort, "save");
  assert.equal(decision.order.riders.find((r) => r.rider_id === "hunt")?.try_break, true);
  assert.equal(decision.order.riders.find((r) => r.rider_id === "free")?.try_break, false);
  assert.match(decision.reasons.riders.hunt, /Udbrudsforsoeg/);
  assert.match(decision.reasons.breakaway_stance, /taerskel|Ingen/);
});

test("intet kaptajn-rolle overhovedet paa holdlisten -> let_go med forklaring", () => {
  const roster: AiRosterEntrant[] = [rider("h1", "helper"), rider("hunt", "hunter", { aggression: 70, climbing: 65 })];
  const decision = generateAiTeamOrder({ team_id: "team-4", route: MOUNTAIN, roster });
  assert.equal(decision.order.breakaway_stance, "let_go");
  assert.match(decision.reasons.breakaway_stance, /Ingen kaptajn/);
});

// ── Neutral: midt-imellem giver hverken jagt eller opgivelse ──────────────────

test("middel kaptajn-evne -> neutral stance, kun hoej-aggressiv hunter forsoeger udbrud", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 62 }), // mellem 55 og 70
    rider("hunt-aggressive", "hunter", { aggression: 90, climbing: 60 }),
    rider("hunt-passive", "hunter", { aggression: 40, climbing: 55 }),
  ];
  const decision = generateAiTeamOrder({ team_id: "team-5", route: MOUNTAIN, roster });

  assert.equal(decision.order.breakaway_stance, "neutral");
  assert.equal(decision.order.riders.find((r) => r.rider_id === "cap")?.effort, "normal");
  assert.equal(decision.order.riders.find((r) => r.rider_id === "hunt-aggressive")?.try_break, true);
  assert.equal(decision.order.riders.find((r) => r.rider_id === "hunt-passive")?.try_break, false);
});

// ── Chase-hold splitter ikke egen indsats med et udbrudsforsoeg ──────────────

test("chase-stance: ingen rytter faar try_break, selv en meget aggressiv hunter", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 90 }),
    rider("hunt", "hunter", { aggression: 99, climbing: 99 }),
  ];
  const decision = generateAiTeamOrder({ team_id: "team-6", route: MOUNTAIN, roster });
  assert.equal(decision.order.breakaway_stance, "chase");
  assert.equal(decision.order.riders.find((r) => r.rider_id === "hunt")?.try_break, false);
});

// ── Kontrakt + determinisme ────────────────────────────────────────────────

test("output validerer altid mod den frosne TeamOrder-kontrakt", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 85 }),
    rider("h1", "helper"),
    rider("hunt", "hunter", { aggression: 80, climbing: 70 }),
  ];
  const decision = generateAiTeamOrder({ team_id: "team-7", route: MOUNTAIN, roster });
  const result = validateTeamOrder(decision.order);
  assert.deepEqual(result, { ok: true });
});

test("ordren indeholder PRAECIS de ryttere fra rosteret, ingen ekstra/manglende", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 85 }),
    rider("h1", "helper"),
    rider("hunt", "hunter"),
  ];
  const decision = generateAiTeamOrder({ team_id: "team-8", route: MOUNTAIN, roster });
  assert.deepEqual(
    decision.order.riders.map((r) => r.rider_id).sort(),
    roster.map((r) => r.rider_id).sort(),
  );
});

test("deterministisk: samme input giver byte-identisk output ved gentagne kald", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 63 }),
    rider("hunt", "hunter", { aggression: 72, climbing: 58 }),
    rider("free", "free_role", { aggression: 72, climbing: 58 }),
  ];
  const input: AiTacticsInput = { team_id: "team-9", route: MOUNTAIN, roster };
  const a = generateAiTeamOrder(input);
  const b = generateAiTeamOrder(input);
  assert.deepEqual(a, b);
});

// ── Kun hunter/free_role faar nogensinde try_break=true ──────────────────────

test("property: try_break er kun nogensinde true for hunter/free_role, output validerer altid", () => {
  const roleArb = fc.constantFrom<RiderRole>("captain", "sprint_captain", "helper", "hunter", "free_role");
  const routeArb = fc.constantFrom<AiTacticsRoute>(
    MOUNTAIN,
    FLAT_SPRINT,
    { profile_type: "cobbles", finale_type: null },
    { profile_type: "itt", finale_type: "solo_tt" },
    { profile_type: "hilly", finale_type: "reduced_sprint" },
  );
  const rosterArb = fc.array(
    fc.record({
      rider_id: fc.uuid(),
      role: roleArb,
      climbing: fc.integer({ min: 0, max: 99 }),
      sprint: fc.integer({ min: 0, max: 99 }),
      aggression: fc.integer({ min: 0, max: 99 }),
      tempo: fc.integer({ min: 0, max: 99 }),
      cobblestone: fc.integer({ min: 0, max: 99 }),
      time_trial: fc.integer({ min: 0, max: 99 }),
      punch: fc.integer({ min: 0, max: 99 }),
    }),
    { minLength: 1, maxLength: 12 },
  ).filter((entries) => new Set(entries.map((e) => e.rider_id)).size === entries.length);

  fc.assert(
    fc.property(routeArb, rosterArb, (route, entries) => {
      const roster: AiRosterEntrant[] = entries.map((e) =>
        rider(e.rider_id, e.role, {
          climbing: e.climbing,
          sprint: e.sprint,
          aggression: e.aggression,
          tempo: e.tempo,
          cobblestone: e.cobblestone,
          time_trial: e.time_trial,
          punch: e.punch,
        }),
      );
      const decision = generateAiTeamOrder({ team_id: "prop-team", route, roster });
      assert.equal(validateTeamOrder(decision.order).ok, true);
      for (const r of decision.order.riders) {
        if (r.try_break) {
          const role = roster.find((e) => e.rider_id === r.rider_id)?.role;
          assert.ok(role === "hunter" || role === "free_role");
        }
      }
    }),
    { numRuns: 200, seed: 4030 },
  );
});
