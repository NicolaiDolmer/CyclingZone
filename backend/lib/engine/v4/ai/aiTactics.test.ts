// backend/lib/engine/v4/ai/aiTactics.test.ts
// M14 (#4030, #2478, #5571): kontrakt-tests + forklarligheds-laas for AI-holdtaktik.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §8b beslutning 22 + docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md.

import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";

import { generateAiTeamOrder } from "./aiTactics.ts";
import { validateTeamOrder } from "./teamOrderContract.ts";
import type { AiFieldRider, AiRaceContext, AiRosterEntrant, AiTacticsInput, AiTacticsRoute } from "./aiTactics.ts";
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

/** Andre holds ryttere paa startlisten, én pr. vaerdi af `key`. */
function opponents(key: AbilityKey, values: readonly number[], rest: Partial<Record<AbilityKey, number>> = {}): AiFieldRider[] {
  return values.map((v, i) => ({ rider_id: `opp-${key}-${i}`, abilities: abilities({ ...rest, [key]: v }) }));
}

function fieldOf(roster: readonly AiRosterEntrant[], others: readonly AiFieldRider[]): AiFieldRider[] {
  return [...roster.map((r) => ({ rider_id: r.rider_id, abilities: r.abilities })), ...others];
}

/** n vaerdier jaevnt fordelt fra lo til hi (inklusive). */
function spread(n: number, lo: number, hi: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.round(lo + ((hi - lo) * i) / Math.max(1, n - 1)));
}

const MOUNTAIN: AiTacticsRoute = { profile_type: "mountain", finale_type: "long_climb" };
const FLAT_SPRINT: AiTacticsRoute = { profile_type: "flat", finale_type: "bunch_sprint" };

const ONE_DAY: AiRaceContext = { is_stage_race: false, later_stages: [] };
function stageRace(later: readonly AiTacticsRoute[]): AiRaceContext {
  return { is_stage_race: true, later_stages: later };
}

function effortOf(decision: ReturnType<typeof generateAiTeamOrder>, riderId: string) {
  return decision.order.riders.find((r) => r.rider_id === riderId)?.effort;
}

// ── Kaptajn beskyttes paa bjergetaper (opgave-eksemplet) ──────────────────────

test("kaptajn blandt feltets favoritter til bjergetape -> chase, kaptajn beskyttes, hjaelper arbejder", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 85 }),
    rider("sprint-cap", "sprint_captain", { sprint: 90 }),
    rider("h1", "helper", { climbing: 60, sprint: 40 }),
    rider("hunt", "hunter", { aggression: 80, climbing: 70 }),
  ];
  const field = fieldOf(roster, opponents("climbing", spread(30, 20, 60)));
  const input: AiTacticsInput = { team_id: "team-1", route: MOUNTAIN, roster, field };
  const decision = generateAiTeamOrder(input);

  assert.equal(decision.order.breakaway_stance, "chase");
  const capOrder = decision.order.riders.find((r) => r.rider_id === "cap");
  assert.equal(capOrder?.effort, "protect");
  assert.equal(capOrder?.try_break, false);
  // "Arbejd eller angrib": hjaelperen koerer ved kaptajnen holdet koerer for.
  assert.equal(effortOf(decision, "h1"), "protect");
  assert.match(decision.reasons.riders.h1, /Arbejd eller angrib/);

  // Sprint-kaptajnen er off-specialty paa en bjergetape -> spares (loebet er
  // ukendt, saa ingen grupetto).
  assert.equal(effortOf(decision, "sprint-cap"), "save");

  // Forklarlighed: hver rytter + stance har en ikke-tom reason-streng.
  assert.ok(decision.reasons.breakaway_stance.length > 0);
  for (const r of roster) assert.ok((decision.reasons.riders[r.rider_id] ?? "").length > 0);
  assert.match(decision.reasons.riders.cap, /Beskyttes/);
});

// ── Sprint-tog-narrativ paa flade etaper ──────────────────────────────────────

test("sprint-kaptajn blandt feltets hurtigste til flad spurtetape -> chase + beskyttes, toget sat", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 80 }),
    rider("sprint-cap", "sprint_captain", { sprint: 92 }),
    rider("h1", "helper"),
  ];
  const field = fieldOf(roster, opponents("sprint", spread(30, 20, 60)));
  const decision = generateAiTeamOrder({ team_id: "team-2", route: FLAT_SPRINT, roster, field });

  assert.equal(decision.order.breakaway_stance, "chase");
  assert.equal(effortOf(decision, "sprint-cap"), "protect");
  // GC-kaptajnen er off-specialty paa en flad spurtetape -> spares.
  assert.equal(effortOf(decision, "cap"), "save");
  // M6: hjaelperen koerer i toget (rollens standard), maalet selv goer aldrig.
  assert.equal(decision.order.riders.find((r) => r.rider_id === "h1")?.leadout, true);
  assert.equal(decision.order.riders.find((r) => r.rider_id === "sprint-cap")?.leadout, false);
});

// ── Udbrudsforsoeg fra svage hold (opgave-eksemplet) ──────────────────────────

test("kaptajn langt nede i feltet til bjergetape -> let_go + hunter forsoeger udbrud", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 40 }),
    rider("hunt", "hunter", { aggression: 85, climbing: 75 }),
    rider("free", "free_role", { aggression: 40, climbing: 40 }),
    rider("h1", "helper"),
  ];
  const field = fieldOf(roster, opponents("climbing", spread(30, 45, 80)));
  const decision = generateAiTeamOrder({ team_id: "team-3", route: MOUNTAIN, roster, field });

  assert.equal(decision.order.breakaway_stance, "let_go");
  assert.equal(effortOf(decision, "cap"), "save");
  // Holdet jager ikke -> hjaelperen har ingen kaptajn at arbejde for i dag.
  assert.equal(effortOf(decision, "h1"), "normal");
  assert.equal(decision.order.riders.find((r) => r.rider_id === "hunt")?.try_break, true);
  assert.equal(decision.order.riders.find((r) => r.rider_id === "free")?.try_break, false);
  assert.match(decision.reasons.riders.hunt, /Udbrudsforsoeg/);
  assert.match(decision.reasons.breakaway_stance, /nr\. \d+ i feltet/);
});

test("let_go: en fri rytter med feltets hoejeste udbruds-score proever ogsaa udbruddet", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 30 }),
    rider("free", "free_role", { aggression: 90, climbing: 70 }),
  ];
  const field = fieldOf(roster, opponents("climbing", spread(30, 45, 80), { aggression: 30 }));
  const decision = generateAiTeamOrder({ team_id: "team-3b", route: MOUNTAIN, roster, field });
  assert.equal(decision.order.breakaway_stance, "let_go");
  assert.equal(decision.order.riders.find((r) => r.rider_id === "free")?.try_break, true);
});

test("intet kaptajn-rolle overhovedet paa holdlisten -> let_go med forklaring", () => {
  const roster: AiRosterEntrant[] = [rider("h1", "helper"), rider("hunt", "hunter", { aggression: 70, climbing: 65 })];
  const decision = generateAiTeamOrder({ team_id: "team-4", route: MOUNTAIN, roster });
  assert.equal(decision.order.breakaway_stance, "let_go");
  assert.match(decision.reasons.breakaway_stance, /Ingen kaptajn/);
});

// ── Neutral: midt-imellem giver hverken jagt eller opgivelse ──────────────────

test("kaptajn midt i feltet -> neutral; hunter-rollen proever udbruddet, en fri rytter goer ikke", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 62 }),
    rider("hunt", "hunter", { aggression: 90, climbing: 60 }),
    rider("free", "free_role", { aggression: 95, climbing: 60 }),
  ];
  // Ti ryttere er bedre end kaptajnen -> plads 11: hverken favorit eller outsider.
  const field = fieldOf(roster, [...opponents("climbing", spread(10, 70, 79)), ...opponents("climbing", spread(20, 10, 40))]);
  const decision = generateAiTeamOrder({ team_id: "team-5", route: MOUNTAIN, roster, field });

  assert.equal(decision.order.breakaway_stance, "neutral");
  assert.equal(effortOf(decision, "cap"), "normal");
  assert.equal(decision.order.riders.find((r) => r.rider_id === "hunt")?.try_break, true);
  assert.equal(decision.order.riders.find((r) => r.rider_id === "free")?.try_break, false);
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

// ── #5571: skala-invarians (prod-skalaen ligger langt under fixtures') ──────

test("styrken er feltets plads, ikke en absolut evne: lav skala giver samme beslutning", () => {
  const high: AiRosterEntrant[] = [rider("cap", "captain", { climbing: 85 }), rider("h1", "helper")];
  const low: AiRosterEntrant[] = [rider("cap", "captain", { climbing: 34 }), rider("h1", "helper", { climbing: 20 })];
  const highDecision = generateAiTeamOrder({
    team_id: "t", route: MOUNTAIN, roster: high, field: fieldOf(high, opponents("climbing", spread(40, 20, 80))),
  });
  const lowDecision = generateAiTeamOrder({
    team_id: "t", route: MOUNTAIN, roster: low, field: fieldOf(low, opponents("climbing", spread(40, 8, 32))),
  });
  assert.equal(highDecision.order.breakaway_stance, "chase");
  assert.equal(lowDecision.order.breakaway_stance, "chase");
  assert.equal(effortOf(lowDecision, "cap"), "protect");
});

// ── #5571: indsatstrappen brugt realistisk ─────────────────────────────────

test("etapeloeb, bjergetape: sprint-kaptajnen og hans tog-rytter koerer grupetto, klatre-hjaelperen arbejder", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 85 }),
    rider("sprint-cap", "sprint_captain", { sprint: 90, climbing: 20 }),
    rider("train", "helper", { sprint: 70, climbing: 30 }),
    rider("climb-helper", "helper", { sprint: 30, climbing: 70 }),
  ];
  const field = fieldOf(roster, opponents("climbing", spread(30, 20, 60)));
  const decision = generateAiTeamOrder({
    team_id: "gt", route: MOUNTAIN, roster, field, race: stageRace([MOUNTAIN, FLAT_SPRINT]),
  });
  assert.equal(effortOf(decision, "sprint-cap"), "grupetto");
  assert.equal(effortOf(decision, "train"), "grupetto");
  assert.equal(effortOf(decision, "climb-helper"), "protect");
  assert.match(decision.reasons.riders["sprint-cap"], /Grupetto/);
  // En grupetto-rytter er aldrig med i et tog eller et udbrud.
  const train = decision.order.riders.find((r) => r.rider_id === "train");
  assert.equal(train?.leadout, false);
  assert.equal(train?.try_break, false);
});

test("endagsloeb paa bjergterraen: ingen grupetto (der er ingen i morgen at gemme benene til)", () => {
  const roster: AiRosterEntrant[] = [
    rider("cap", "captain", { climbing: 85 }),
    rider("sprint-cap", "sprint_captain", { sprint: 90, climbing: 20 }),
  ];
  const decision = generateAiTeamOrder({ team_id: "od", route: MOUNTAIN, roster, race: ONE_DAY });
  assert.equal(effortOf(decision, "sprint-cap"), "save");
});

test("den afgoerende dag: kaptajnen gaar alt ud paa loebets sidste etape af hans terraen", () => {
  const roster: AiRosterEntrant[] = [rider("cap", "captain", { climbing: 85 }), rider("h1", "helper")];
  const field = fieldOf(roster, opponents("climbing", spread(30, 20, 60)));

  const notYet = generateAiTeamOrder({ team_id: "gt", route: MOUNTAIN, roster, field, race: stageRace([MOUNTAIN, FLAT_SPRINT]) });
  assert.equal(effortOf(notYet, "cap"), "protect");

  const lastMountain = generateAiTeamOrder({ team_id: "gt", route: MOUNTAIN, roster, field, race: stageRace([FLAT_SPRINT]) });
  assert.equal(effortOf(lastMountain, "cap"), "all_out");
  assert.match(lastMountain.reasons.riders.cap, /Alt ud/);

  const oneDay = generateAiTeamOrder({ team_id: "od", route: MOUNTAIN, roster, field, race: ONE_DAY });
  assert.equal(effortOf(oneDay, "cap"), "all_out");

  // Uden loebs-kontekst kender AI'en ikke den afgoerende dag.
  const unknownRace = generateAiTeamOrder({ team_id: "u", route: MOUNTAIN, roster, field });
  assert.equal(effortOf(unknownRace, "cap"), "protect");
});

test("alt ud kun for en favorit: en kaptajn midt i feltet koerer normalt ogsaa paa den afgoerende dag", () => {
  const roster: AiRosterEntrant[] = [rider("cap", "captain", { climbing: 62 })];
  const field = fieldOf(roster, [...opponents("climbing", spread(10, 70, 79)), ...opponents("climbing", spread(20, 10, 40))]);
  const decision = generateAiTeamOrder({ team_id: "od", route: MOUNTAIN, roster, field, race: ONE_DAY });
  assert.equal(decision.order.breakaway_stance, "neutral");
  assert.equal(effortOf(decision, "cap"), "normal");
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

// ── #5571: trappens yderpunkter bruges kun hvor et rigtigt hold ville ────────

test("property: all_out kun for dagens kaptajn i et kendt loeb, grupetto kun i bjergene i etapeloeb", () => {
  const roleArb = fc.constantFrom<RiderRole>("captain", "sprint_captain", "helper", "hunter", "free_role");
  const routeArb = fc.constantFrom<AiTacticsRoute>(
    MOUNTAIN,
    FLAT_SPRINT,
    { profile_type: "high_mountain", finale_type: "descent" },
    { profile_type: "cobbles", finale_type: null },
    { profile_type: "itt", finale_type: "solo_tt" },
    { profile_type: "hilly", finale_type: "punch" },
  );
  const raceArb = fc.option(
    fc.record({
      is_stage_race: fc.boolean(),
      later_stages: fc.array(routeArb, { maxLength: 4 }),
    }),
    { nil: undefined },
  );
  const rosterArb = fc.array(
    fc.record({
      rider_id: fc.uuid(),
      role: roleArb,
      climbing: fc.integer({ min: 0, max: 99 }),
      sprint: fc.integer({ min: 0, max: 99 }),
      aggression: fc.integer({ min: 0, max: 99 }),
    }),
    { minLength: 1, maxLength: 10 },
  ).filter((entries) => new Set(entries.map((e) => e.rider_id)).size === entries.length);

  fc.assert(
    fc.property(routeArb, raceArb, rosterArb, (route, race, entries) => {
      const roster: AiRosterEntrant[] = entries.map((e) =>
        rider(e.rider_id, e.role, { climbing: e.climbing, sprint: e.sprint, aggression: e.aggression }),
      );
      const decision = generateAiTeamOrder({ team_id: "prop-team", route, roster, race });
      assert.equal(validateTeamOrder(decision.order).ok, true);
      const climbDay = route.profile_type === "mountain" || route.profile_type === "high_mountain";
      for (const r of decision.order.riders) {
        const role = roster.find((e) => e.rider_id === r.rider_id)?.role;
        if (r.effort === "all_out") {
          assert.ok(race !== undefined, "all_out kraever et kendt loeb");
          assert.equal(decision.order.breakaway_stance, "chase");
          assert.ok(role === "captain" || role === "sprint_captain");
        }
        if (r.effort === "grupetto") {
          assert.equal(race?.is_stage_race, true);
          assert.ok(climbDay);
          assert.ok(role === "sprint_captain" || role === "helper");
          assert.equal(r.try_break, false);
          assert.equal(r.leadout, false);
        }
      }
    }),
    { numRuns: 300, seed: 5571 },
  );
});
