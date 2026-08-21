// backend/lib/engine/v4/mechanics/descent.test.ts
// Kontrakt-tests + property-test (fast-check, 200 runs, seeded) for M3
// (nedkoersel v2). SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-
// f2-core-design.md §4 punkt 3; mor-spec §3.2 (monotoni, hardt krav) + §8
// beslutning 6-7.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { computeAttackGainSeconds, descentHook, incidentProbability } from "./descent.ts";
import { boundRngFor } from "../rng.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import type {
  AbilityKey,
  DescentSegment,
  Entrant,
  EngineState,
  RaceGroup,
  RiderState,
  RouteV2,
  SegmentHookContext,
  TimelineEvent,
} from "../types.ts";

// ── Fixtures ───────────────────────────────────────────────────────────────

function abilities(overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const base: Record<AbilityKey, number> = {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
  };
  return { ...base, ...overrides };
}

function makeEntrant(riderId: string, descending: number): Entrant {
  return {
    rider_id: riderId,
    abilities: abilities({ descending }),
    role: "free_role",
    effort: "normal",
    condition: 1,
  };
}

function makeRiderState(riderId: string, groupId: string): RiderState {
  return {
    rider_id: riderId,
    group_id: groupId,
    cp: 0.5,
    wprimeMax: 0.4,
    wprime: 0.4,
    dayform: 0,
    seconds_over_cp: 0,
    work_norm: 0,
    incidents: 0,
    status: "racing",
    time_seconds: 0,
  };
}

const ROUTE_STUB: RouteV2 = {
  distance_km: 100,
  profile_type: "hilly",
  finale_type: "descent",
  segments: [],
  weather: { kind: "sun", wind_exposure: 0 },
  waypoints: [],
};

function descentSegment(technicality: 1 | 2 | 3, fromKm = 40, toKm = 48): DescentSegment {
  return { kind: "descent", from_km: fromKm, to_km: toKm, technicality };
}

/** Bygger state+ctx for én gruppe med (riderId, descending)-par. */
function buildSingleGroupScenario(
  pairs: Array<[string, number]>,
  technicality: 1 | 2 | 3,
  seed = "descent-seed",
): { state: EngineState; ctx: SegmentHookContext } {
  const entrantsById: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  const riderIds = pairs.map(([id]) => id);
  for (const [id, descending] of pairs) {
    entrantsById[id] = makeEntrant(id, descending);
    riders[id] = makeRiderState(id, "peloton-0");
  }
  const group: RaceGroup = { id: "peloton-0", kind: "peloton", rider_ids: riderIds, gap_seconds: 0, cohesion: 1 };
  const state: EngineState = { km: 40, groups: [group], riders, virtual_gc: {} };
  const segment = descentSegment(technicality);
  const ctx: SegmentHookContext = {
    segment,
    segmentIndex: 3,
    route: ROUTE_STUB,
    entrants: entrantsById,
    tuning: RACE_V4_TUNING,
    rngFor: boundRngFor(seed),
  };
  return { state, ctx };
}

function findGroupOf(groups: RaceGroup[], riderId: string): RaceGroup | undefined {
  return groups.find((g) => g.rider_ids.includes(riderId));
}

function eventsOfType(events: TimelineEvent[], type: string): TimelineEvent[] {
  return events.filter((e) => e.type === type);
}

// ── Kontrakt: technicality-gate ─────────────────────────────────────────────

test("technicality 1: ingen split/event selv ved ekstrem evne-forskel", () => {
  const { state, ctx } = buildSingleGroupScenario([["weak", 0], ["strong", 99]], 1);
  const result = descentHook(state, ctx);
  assert.equal(result.events.length, 0);
  assert.strictEqual(result.state, state, "no-op skal returnere praecis samme state-reference");
});

test("technicality 2 men evne-forskel under taerskel: ingen split", () => {
  const { state, ctx } = buildSingleGroupScenario([["a", 50], ["b", 55]], 2); // gap 5 < minAbilityGapForAttack (15)
  const result = descentHook(state, ctx);
  assert.equal(result.events.length, 0);
  assert.equal(result.state.groups.length, 1);
  assert.deepEqual(new Set(result.state.groups[0].rider_ids), new Set(["a", "b"]));
});

test("technicality 2 + kvalificerende evne-forskel: split med finale_attack-event", () => {
  const { state, ctx } = buildSingleGroupScenario([["weak", 0], ["strong", 50]], 2);
  const result = descentHook(state, ctx);
  const attacks = eventsOfType(result.events, "finale_attack");
  assert.equal(attacks.length, 1);
  assert.equal(result.state.groups.length, 2);

  const weakGroup = findGroupOf(result.state.groups, "weak")!;
  const strongGroup = findGroupOf(result.state.groups, "strong")!;
  assert.notEqual(weakGroup.id, strongGroup.id);
  assert.equal(weakGroup.gap_seconds, 0, "gruppen der ikke angriber beholder kilde-gap'en");
  assert.ok(strongGroup.gap_seconds < weakGroup.gap_seconds, "angriberen skal have et BEDRE (mindre) gap end den svage");

  const gain = attacks[0].params.gained_seconds as number;
  assert.ok(gain >= RACE_V4_TUNING.descent.attackWindowSeconds[0] && gain <= RACE_V4_TUNING.descent.attackWindowSeconds[1]);
  assert.ok(Math.abs(strongGroup.gap_seconds - -gain) < 1e-9);
});

test("technicality 3 udloeser ogsaa attack (>= minTechnicalityForAttack)", () => {
  const { state, ctx } = buildSingleGroupScenario([["weak", 0], ["strong", 50]], 3);
  const result = descentHook(state, ctx);
  assert.equal(eventsOfType(result.events, "finale_attack").length, 1);
});

test("solo-gruppe (< 2 ryttere) kan ikke splitte", () => {
  const { state, ctx } = buildSingleGroupScenario([["solo", 90]], 3);
  const result = descentHook(state, ctx);
  assert.equal(result.events.length, 0);
  assert.strictEqual(result.state, state);
});

// ── Kontrakt: gevinst-loft (beslutning 6) ───────────────────────────────────

test("computeAttackGainSeconds: ALTID inden for [10,20]-baandet, monotont stigende med evne-forskel", () => {
  const tuning = RACE_V4_TUNING.descent;
  const atThreshold = computeAttackGainSeconds(15, 0, tuning); // attackerMin-groupMin == minGap
  const doubleThreshold = computeAttackGainSeconds(30, 0, tuning); // == 2*minGap (saturation)
  const extreme = computeAttackGainSeconds(99, 0, tuning);
  assert.ok(Math.abs(atThreshold - 10) < 1e-9, `forventede 10 ved taerskel, fik ${atThreshold}`);
  assert.ok(Math.abs(doubleThreshold - 20) < 1e-9, `forventede 20 ved 2x taerskel, fik ${doubleThreshold}`);
  assert.equal(extreme, 20, "gevinst skal clampes til loftet uanset hvor stor evne-forskellen er");
  assert.ok(atThreshold <= doubleThreshold && doubleThreshold <= extreme, "aldrig omvendt fortegn: gevinst falder aldrig naar evne-forskellen vokser");
});

test("computeAttackGainSeconds: fast-check — altid i baandet for alle gyldige input (200 runs)", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 }), (a, b) => {
      const tuning = RACE_V4_TUNING.descent;
      const attackerMin = Math.max(a, b);
      const groupMin = Math.min(a, b);
      const gain = computeAttackGainSeconds(attackerMin, groupMin, tuning);
      assert.ok(gain >= tuning.attackWindowSeconds[0] - 1e-9 && gain <= tuning.attackWindowSeconds[1] + 1e-9);
    }),
    { numRuns: 200, seed: 4030 },
  );
});

// ── Kontrakt: risiko-kobling daempet af descending (beslutning 7) ──────────

test("incidentProbability: daempes strengt monotont af descending-evnen, aldrig omvendt fortegn, clamped [0,1]", () => {
  const tuning = RACE_V4_TUNING.descent;
  let prev = incidentProbability(0, tuning);
  assert.ok(prev >= 0 && prev <= 1);
  for (let ability = 1; ability <= 99; ability += 1) {
    const p = incidentProbability(ability, tuning);
    assert.ok(p >= 0 && p <= 1, `p=${p} uden for [0,1] ved ability=${ability}`);
    assert.ok(p <= prev + 1e-12, `risiko steg ved ability=${ability} (${p} > ${prev}) — omvendt fortegn`);
    prev = p;
  }
  assert.equal(incidentProbability(99, tuning), 0, "hoej nok descending-evne daemper risikoen helt til 0 (start-tuning)");
});

test("descentHook: kun angribere ruller incident-risiko, seeded og deterministisk", () => {
  const { state, ctx } = buildSingleGroupScenario([["weak", 0], ["strong", 50]], 2, "incident-seed-1");
  const result = descentHook(state, ctx);
  const incidents = eventsOfType(result.events, "incident");
  for (const ev of incidents) {
    assert.equal(ev.params.rider_id, "strong", "kun angriberen (strong) kan ramme incident i dette scenarie");
    assert.ok(ev.km >= 40 && ev.km <= 48, "incident-km skal ligge inden for descent-segmentet");
  }
});

// ── Kontrakt: determinisme + per-rytter-hash-isolation ──────────────────────

test("determinisme: samme seed+input giver byte-identisk resultat", () => {
  const { state, ctx: ctxA } = buildSingleGroupScenario([["weak", 0], ["strong", 50]], 2, "det-seed");
  const ctxB: SegmentHookContext = { ...ctxA, rngFor: boundRngFor("det-seed") };
  const a = descentHook(state, ctxA);
  const b = descentHook(state, ctxB);
  assert.deepEqual(a, b);
});

test("per-rytter-hash: en ekstra, uafhaengig gruppe paavirker ikke andre ryttere/gruppers udfald", () => {
  const seed = "isolation-seed";
  const scenarioA = buildSingleGroupScenario([["weak", 0], ["strong", 50]], 2, seed);
  const resultA = descentHook(scenarioA.state, scenarioA.ctx);

  // Samme gruppe + seed, MEN et ekstra uafhaengigt felt af ryttere (anden gruppe).
  const extraEntrants: Record<string, Entrant> = { ...scenarioA.ctx.entrants };
  const extraRiders: Record<string, RiderState> = { ...scenarioA.state.riders };
  for (const [id, descending] of [["extra1", 10], ["extra2", 80]] as Array<[string, number]>) {
    extraEntrants[id] = makeEntrant(id, descending);
    extraRiders[id] = makeRiderState(id, "chase-9");
  }
  const extraGroup: RaceGroup = { id: "chase-9", kind: "chase", rider_ids: ["extra1", "extra2"], gap_seconds: 30, cohesion: 1 };
  const stateB: EngineState = { ...scenarioA.state, groups: [...scenarioA.state.groups, extraGroup], riders: extraRiders };
  const ctxB: SegmentHookContext = { ...scenarioA.ctx, entrants: extraEntrants, rngFor: boundRngFor(seed) };
  const resultB = descentHook(stateB, ctxB);

  const weakA = findGroupOf(resultA.state.groups, "weak")!;
  const strongA = findGroupOf(resultA.state.groups, "strong")!;
  const weakB = findGroupOf(resultB.state.groups, "weak")!;
  const strongB = findGroupOf(resultB.state.groups, "strong")!;
  assert.equal(weakA.gap_seconds, weakB.gap_seconds);
  assert.equal(strongA.gap_seconds, strongB.gap_seconds);
  const groupAAttackA = eventsOfType(resultA.events, "finale_attack").find((e) => (e.params.rider_ids as string[]).includes("strong"));
  const groupAAttackB = eventsOfType(resultB.events, "finale_attack").find((e) => (e.params.rider_ids as string[]).includes("strong"));
  assert.equal(groupAAttackA?.params.gained_seconds, groupAAttackB?.params.gained_seconds);

  const strongIncidentA = eventsOfType(resultA.events, "incident").filter((e) => e.params.rider_id === "strong");
  const strongIncidentB = eventsOfType(resultB.events, "incident").filter((e) => e.params.rider_id === "strong");
  assert.deepEqual(strongIncidentA, strongIncidentB, "det ekstra feltet maa ikke flytte 'strong's incident-udfald (per-rytter-hash-isolation)");
});

// ── Property-test: monotoni over tilfaeldige grupper (fast-check, 200 runs, seeded) ──
// Mor-spec §3.2 hardt krav: en daarligere descender kan ALDRIG ende med et
// bedre (mindre) gap_seconds end en bedre descender fra samme praesplit-gruppe.

const riderCountArb = fc.integer({ min: 2, max: 8 });
const groupScenarioArb = riderCountArb.chain((n) =>
  fc.tuple(
    fc.array(fc.integer({ min: 0, max: 99 }), { minLength: n, maxLength: n }),
    fc.constantFrom<1 | 2 | 3>(1, 2, 3),
    fc.string({ minLength: 1, maxLength: 12 }),
  ),
);

test("monotoni (hardt krav): en daarligere descender tager ALDRIG tid paa en bedre, tilfaeldige grupper (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(groupScenarioArb, ([descendingValues, technicality, seed]) => {
      const pairs: Array<[string, number]> = descendingValues.map((d, i) => [`r${i}`, d]);
      const { state, ctx } = buildSingleGroupScenario(pairs, technicality, seed);
      const result = descentHook(state, ctx);

      const gapById = new Map<string, number>();
      for (const [id] of pairs) {
        const group = findGroupOf(result.state.groups, id);
        assert.ok(group, `rytter ${id} skal stadig tilhoere en gruppe efter hook'et`);
        gapById.set(id, group!.gap_seconds);
      }

      for (let i = 0; i < pairs.length; i++) {
        for (let j = 0; j < pairs.length; j++) {
          if (i === j) continue;
          const [idA, descA] = pairs[i];
          const [idB, descB] = pairs[j];
          if (descA > descB) {
            assert.ok(
              gapById.get(idA)! <= gapById.get(idB)! + 1e-9,
              `monotoni-brud: ${idA} (descending=${descA}) fik vaerre gap end ${idB} (descending=${descB}) — technicality=${technicality}`,
            );
          } else if (descA === descB) {
            assert.ok(
              Math.abs(gapById.get(idA)! - gapById.get(idB)!) < 1e-9,
              `${idA} og ${idB} har samme descending-evne (${descA}) men endte med forskelligt gap`,
            );
          }
        }
      }

      // Bonus-invariant: enhver emitteret finale_attack-gevinst er altid i baandet.
      for (const ev of eventsOfType(result.events, "finale_attack")) {
        const gain = ev.params.gained_seconds as number;
        assert.ok(gain >= RACE_V4_TUNING.descent.attackWindowSeconds[0] - 1e-9);
        assert.ok(gain <= RACE_V4_TUNING.descent.attackWindowSeconds[1] + 1e-9);
      }
    }),
    { numRuns: 200, seed: 4030 },
  );
});
