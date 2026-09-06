// backend/lib/engine/v4/mechanics/descent.test.ts
// Kontrakt-tests + property-test (fast-check, 200 runs, seeded) for M3
// (nedkoersel v2). SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-
// f2-core-design.md §4 punkt 3; mor-spec §3.2 (monotoni, hardt krav) + §8
// beslutning 6-7.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { computeAttackGainSeconds, computeRegroupSeconds, descentHook, incidentProbability } from "./descent.ts";
import { maxIncidentsForField, resolveCrashIncident } from "./incidents.ts";
import { boundRngFor } from "../rng.ts";
import { RACE_V4_TUNING, DESCENT_EXTRA_TUNING, INCIDENTS_EXTRA_TUNING } from "../tuning.ts";
import type {
  AbilityKey,
  DescentSegment,
  GroupKind,
  Entrant,
  EngineState,
  RaceGroup,
  RiderState,
  RouteV2,
  SegmentHookContext,
  SegmentHookResult,
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
    rngForStage: boundRngFor(seed),
    orders: [],
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

// ── Kontrakt: risiko-kobling daempet af descending (beslutning 7, gulv #4905) ──

test("incidentProbability: daempes MONOTONT ikke-stigende af descending-evnen, aldrig omvendt fortegn, clamped [0,1]", () => {
  const tuning = {
    incidentRiskBase: RACE_V4_TUNING.descent.incidentRiskBase,
    incidentRiskFloorFraction: DESCENT_EXTRA_TUNING.incidentRiskFloorFraction,
    incidentRiskAbilityDampeningFraction: DESCENT_EXTRA_TUNING.incidentRiskAbilityDampeningFraction,
  };
  let prev = incidentProbability(0, tuning);
  assert.ok(prev >= 0 && prev <= 1);
  for (let ability = 1; ability <= 99; ability += 1) {
    const p = incidentProbability(ability, tuning);
    assert.ok(p >= 0 && p <= 1, `p=${p} uden for [0,1] ved ability=${ability}`);
    assert.ok(p <= prev + 1e-12, `risiko steg ved ability=${ability} (${p} > ${prev}) — omvendt fortegn`);
    prev = p;
  }
  const atFloor = incidentProbability(99, tuning);
  const expectedFloor = tuning.incidentRiskBase * tuning.incidentRiskFloorFraction;
  assert.ok(atFloor > 0, "gulvet (#4905) skal forhindre at risikoen naar 0 ved ability=99 (start-tuning)");
  assert.ok(Math.abs(atFloor - expectedFloor) < 1e-12, `forventede gulv-vaerdien ${expectedFloor}, fik ${atFloor}`);
});

test("incidentProbability: gulvet er en NEDRE graense — evnen kan aldrig daempe risikoen under den, uanset dampFraction", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 99 }),
      fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
      fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
      (ability, floorFraction, dampFraction) => {
        const tuning = {
          incidentRiskBase: 0.5,
          incidentRiskFloorFraction: floorFraction,
          incidentRiskAbilityDampeningFraction: dampFraction,
        };
        const p = incidentProbability(ability, tuning);
        assert.ok(p >= 0.5 * floorFraction - 1e-9, `p=${p} faldt under gulvet (0.5*${floorFraction})`);
      },
    ),
    { numRuns: 200, seed: 4905 },
  );
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

// ── #4934: uheldet gaar gennem M10's trappe ─────────────────────────────────
// Én uheldsmodel: descent leverer kun "hvem og hvor", incidents.ts afgoer
// konsekvensen. Testene laaser at konsekvensen er ORDRET den samme som et
// tilsvarende M10-uheld, at gevinsten bortfalder, og at etape-loftet deles.

/**
 * Rigget rngFor: `plan(mekanik, riderId)` leverer streamens vaerdier i
 * raekkefolge. Alt udenfor planen giver 0.999999, saa ingen anden rytter/
 * mekanik kan fyre et uheld ved et uheld.
 */
function riggedRngFor(plan: (mechanic: string, riderId: string) => number[]): SegmentHookContext["rngFor"] {
  return (mechanic: string, riderId?: string) => {
    const values = plan(mechanic, riderId ?? "");
    let i = 0;
    return () => (i < values.length ? values[i++]! : 0.999999);
  };
}

/** Streams for ÉT rigget styrt hos `victim`: rul-under-p, km-fraktion, og trappens tre lodtraekninger. */
function crashPlan(
  victim: string,
  rolls: { severity: number; magnitude: number; injury: number; kmFrac?: number },
): (mechanic: string, riderId: string) => number[] {
  return (mechanic, riderId) => {
    if (riderId !== victim) return [];
    if (mechanic === "descent_incident") return [0, rolls.kmFrac ?? 0.5];
    if (mechanic === "descent_incident_severity") return [rolls.severity];
    if (mechanic === "descent_incident_time_loss") return [rolls.magnitude];
    if (mechanic === "descent_incident_injury") return [rolls.injury];
    return [];
  };
}

/** Kildegruppens gap er 0 i buildSingleGroupScenario, saa "kildegruppens gap + X" er bare X. */
function gapOf(result: SegmentHookResult, riderId: string): number {
  const group = findGroupOf(result.state.groups, riderId);
  assert.ok(group, `rytter ${riderId} skal tilhoere en gruppe`);
  return group!.gap_seconds;
}

test("#4934: et LET descent-styrt koster praecis det samme som et tilsvarende M10-uheld", () => {
  const rolls = { severity: 0.9, magnitude: 0.5, injury: 0 }; // severity >= serious+hard => light
  const { state, ctx } = buildSingleGroupScenario([["weak", 0], ["strong", 99]], 3);
  const result = descentHook(state, { ...ctx, rngFor: riggedRngFor(crashPlan("strong", rolls)) });

  // Referencen: M10's egen trappe med de SAMME lodtraekninger.
  const expected = resolveCrashIncident(rolls, { protectedByRule: false, helperNearby: false }, INCIDENTS_EXTRA_TUNING);
  assert.equal(expected.kind, "crash");
  assert.equal(expected.severity, "light");
  assert.equal(expected.injuryDays, null, "trin 1 skader ikke");

  const incident = eventsOfType(result.events, "incident")[0];
  assert.ok(incident, "der skal vaere et descent-uheld");
  assert.equal(incident.params.cause, "descent_attack");
  assert.equal(incident.params.kind, expected.kind);
  assert.equal(incident.params.severity, expected.severity);
  assert.equal(incident.params.outcome, expected.outcome);
  assert.equal(incident.params.time_loss_seconds, expected.timeLossSeconds);
  assert.equal(incident.params.injury_days, expected.injuryDays);

  // Tiden: kildegruppens gap (0) + trappens tidstab. Gevinsten er VAEK.
  assert.equal(gapOf(result, "strong"), expected.timeLossSeconds);
  assert.equal(gapOf(result, "weak"), 0, "resten af gruppen roeres ikke af uheldet");
  assert.equal(result.state.riders.strong.status, "racing", "et let styrt udgaar ikke");
});

test("#4934: gevinsten bortfalder — den styrtede angriber ligger BAG gruppen han angreb fra", () => {
  const { state, ctx } = buildSingleGroupScenario([["weak", 0], ["strong", 99]], 3);
  const rigged = { ...ctx, rngFor: riggedRngFor(crashPlan("strong", { severity: 0.9, magnitude: 0, injury: 0 })) };
  const result = descentHook(state, rigged);

  const attack = eventsOfType(result.events, "finale_attack")[0];
  assert.ok(attack, "angrebet skal stadig ske — uheldet er en konsekvens af det, ikke en annullering");
  const gained = attack.params.gained_seconds as number;
  assert.ok(gained > 0);

  // Uden styrtet ville han ligge paa -gained. Med styrtet ligger han paa
  // +tidstab: hele gevinsten er inddraget, og tidstabet laagt oveni.
  assert.equal(gapOf(result, "strong"), INCIDENTS_EXTRA_TUNING.unprotectedTimeLossSecondsRange[0]);
  assert.ok(gapOf(result, "strong") > gapOf(result, "weak"), "han ligger bag kildegruppen, ikke foran den");
});

test("#4934: et ALVORLIGT descent-styrt udgaar — status abandoned + abandonedGapSeconds, som i M10", () => {
  const { state, ctx } = buildSingleGroupScenario([["weak", 0], ["strong", 99]], 3);
  const rolls = { severity: 0.001, magnitude: 0.5, injury: 0.5 }; // under crashSeverityShares.serious
  const result = descentHook(state, { ...ctx, rngFor: riggedRngFor(crashPlan("strong", rolls)) });

  const expected = resolveCrashIncident(rolls, { protectedByRule: false, helperNearby: false }, INCIDENTS_EXTRA_TUNING);
  assert.equal(expected.severity, "serious");
  assert.equal(expected.outcome, "abandoned");
  assert.ok((expected.injuryDays ?? 0) > 0, "trin 3 skader");

  assert.equal(result.state.riders.strong.status, "abandoned");
  assert.equal(gapOf(result, "strong"), INCIDENTS_EXTRA_TUNING.abandonedGapSeconds);
  assert.equal(eventsOfType(result.events, "incident")[0].params.injury_days, expected.injuryDays);
});

test("#4934: et HAARDT descent-styrt giver stort tidstab OG skadedage", () => {
  const { state, ctx } = buildSingleGroupScenario([["weak", 0], ["strong", 99]], 3);
  const rolls = { severity: 0.1, magnitude: 0.25, injury: 0.5 }; // mellem serious og serious+hard
  const result = descentHook(state, { ...ctx, rngFor: riggedRngFor(crashPlan("strong", rolls)) });

  const expected = resolveCrashIncident(rolls, { protectedByRule: false, helperNearby: false }, INCIDENTS_EXTRA_TUNING);
  assert.equal(expected.severity, "hard");
  assert.ok((expected.injuryDays ?? 0) > 0);
  assert.equal(eventsOfType(result.events, "incident")[0].params.injury_days, expected.injuryDays);
  assert.equal(gapOf(result, "strong"), expected.timeLossSeconds);
  assert.equal(result.state.riders.strong.status, "racing", "et haardt styrt gennemfoerer");
});

test("#4934: ingen dobbelt bogfoering — ét uheld = én taeller, ét stage_incidents-element", () => {
  const { state, ctx } = buildSingleGroupScenario([["weak", 0], ["strong", 99]], 3);
  const result = descentHook(state, {
    ...ctx,
    rngFor: riggedRngFor(crashPlan("strong", { severity: 0.9, magnitude: 0.5, injury: 0 })),
  });

  assert.equal(result.state.riders.strong.incidents, 1);
  assert.equal(result.state.riders.weak.incidents, 0);
  assert.equal(result.state.stage_incidents?.length, 1);
  const logged = result.state.stage_incidents![0];
  assert.equal(logged.rider_id, "strong");
  assert.equal(logged.kind, "crash");
  assert.equal(logged.km, eventsOfType(result.events, "incident")[0].km);
});

test("#4934: etape-loftet deles med M10 — et opbrugt budget giver INGEN descent-uheld", () => {
  const { state, ctx } = buildSingleGroupScenario([["weak", 0], ["strong", 99]], 3);
  const budget = maxIncidentsForField(Object.keys(state.riders).length, INCIDENTS_EXTRA_TUNING);
  const alreadyLogged = Array.from({ length: budget }, (_, i) => ({
    rider_id: `other-${i}`,
    km: 1,
    kind: "crash" as const,
    severity: "light" as const,
    outcome: "time_loss" as const,
    time_loss_seconds: 10,
    injury_days: null,
    helper_assist: false,
  }));
  const full: EngineState = { ...state, stage_incidents: alreadyLogged };
  const result = descentHook(full, {
    ...ctx,
    rngFor: riggedRngFor(crashPlan("strong", { severity: 0.001, magnitude: 0, injury: 0 })),
  });

  assert.equal(eventsOfType(result.events, "incident").length, 0, "loftet er haardt — der rulles ikke engang");
  assert.equal(result.state.stage_incidents?.length, budget);
  assert.equal(result.state.riders.strong.incidents, 0);
  assert.equal(result.state.riders.strong.status, "racing");
  assert.ok(eventsOfType(result.events, "finale_attack").length > 0, "angrebet sker stadig");
});

test("#4934 monotoni: ved SAMME lodtraekning faar en bedre nedkoerer aldrig et vaerre udfald", () => {
  // Samme rolls, to forskellige angriber-evner. Trappens konsekvens er bevidst
  // IKKE evne-skaleret (incidents.ts), og slut-gap'et er kildegruppens gap +
  // tidstabet — uafhaengigt af hvor stor gevinsten var. Den bedre nedkoerer
  // kan derfor kun styrte SJAELDNERE (incidentProbability, testet ovenfor),
  // aldrig haardere.
  const rolls = { severity: 0.5, magnitude: 0.7, injury: 0.3 };
  const gapFor = (attackerAbility: number): number => {
    const { state, ctx } = buildSingleGroupScenario([["weak", 0], ["strong", attackerAbility]], 3);
    const result = descentHook(state, { ...ctx, rngFor: riggedRngFor(crashPlan("strong", rolls)) });
    assert.equal(eventsOfType(result.events, "incident").length, 1, "begge scenarier skal styrte ved samme rul");
    return gapOf(result, "strong");
  };
  assert.equal(gapFor(99), gapFor(70), "samme lodtraekning => samme udfald, uanset descending-evne");
});

test("#4934: 3 km-reglen beskytter TIDEN — ingen gruppe-/tidsaendring, men uheldet bogfoeres", () => {
  const { state, ctx } = buildSingleGroupScenario([["weak", 0], ["strong", 99]], 3);
  // Flad etape + descent-segment der slutter paa maalstregen (100 km).
  const flatRoute: RouteV2 = { ...ROUTE_STUB, profile_type: "flat" };
  const finalSegment = descentSegment(3, 98, 100);
  const result = descentHook(state, {
    ...ctx,
    route: flatRoute,
    segment: finalSegment,
    rngFor: riggedRngFor(crashPlan("strong", { severity: 0.9, magnitude: 0.5, injury: 0, kmFrac: 0.5 })),
  });

  const incident = eventsOfType(result.events, "incident")[0];
  assert.ok(incident, "uheldet sker stadig");
  assert.equal(incident.params.outcome, "protected_three_km_rule");
  assert.equal(incident.params.time_loss_seconds, null);
  assert.equal(result.state.riders.strong.incidents, 1, "uheldet bogfoeres");
  assert.equal(result.state.stage_incidents?.length, 1);
  // Han beholder angrebsgruppens tid: gap'et er stadig gevinsten, ikke et tab.
  const gained = eventsOfType(result.events, "finale_attack")[0].params.gained_seconds as number;
  assert.equal(gapOf(result, "strong"), -gained);
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

      // #4934: uheldsramte ryttere er UDE af evne-sammenligningen. Invariant 3
      // (§3) gaelder mekanikker der SAMMENLIGNER ryttere paa den evne segmentet
      // tester — et styrt er et uheld, ikke en evne-test, og M10 behandler sine
      // egne uheld praecis sadan (se incidents.ts's monotoni-bemaerkning).
      // Monotonien for selve uheldet er den SKARPERE form og testes separat
      // nedenfor: ved samme lodtraekning faar en bedre nedkoerer aldrig et
      // vaerre udfald. Her maales angrebs-mekanikken alene.
      const crashed = new Set(
        eventsOfType(result.events, "incident").map((e) => e.params.rider_id as string),
      );

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
          if (crashed.has(idA) || crashed.has(idB)) continue;
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

// ── Regruppering (#4604) ────────────────────────────────────────────────────
// Fire garantier fra descent.ts's regrupperings-kommentar, laast som tests.

/** Bygger N grupper med givne (gap, descending-evne, antal ryttere). */
function buildMultiGroupScenario(
  groupSpecs: Array<{ gap: number; descending: number; size: number }>,
  technicality: 1 | 2 | 3,
  lengthKm = 8,
): { state: EngineState; ctx: SegmentHookContext } {
  const entrantsById: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  const groups: RaceGroup[] = groupSpecs.map((spec, gi) => {
    const id = `g${gi}`;
    const riderIds: string[] = [];
    for (let i = 0; i < spec.size; i++) {
      const riderId = `g${gi}r${i}`;
      entrantsById[riderId] = makeEntrant(riderId, spec.descending);
      riders[riderId] = makeRiderState(riderId, id);
      riderIds.push(riderId);
    }
    return { id, kind: "peloton" as GroupKind, rider_ids: riderIds, gap_seconds: spec.gap, cohesion: 1 };
  });
  const segment = descentSegment(technicality, 40, 40 + lengthKm);
  // Nedkoerslen ER finalen: regrupperingen er kalibreret paa finale-nedkoersler
  // (midtvejs-leddet er bevidst 0, se DESCENT_EXTRA_TUNING i tuning.ts).
  const route: RouteV2 = { ...ROUTE_STUB, segments: [segment] };
  return {
    state: { km: 40, groups, riders, virtual_gc: {} },
    ctx: {
      segment, segmentIndex: 0, route, entrants: entrantsById,
      tuning: RACE_V4_TUNING, rngFor: boundRngFor("regroup-seed"), rngForStage: boundRngFor("regroup-seed"), orders: [],
    },
  };
}

test("regruppering: et hul kan kun KRYMPE paa en nedkoersel, aldrig vokse", () => {
  const { state, ctx } = buildMultiGroupScenario(
    [{ gap: 0, descending: 80, size: 5 }, { gap: 120, descending: 40, size: 20 }, { gap: 400, descending: 30, size: 60 }],
    2,
  );
  const result = descentHook(state, ctx);
  for (const before of state.groups) {
    const after = result.state.groups.find((g) => g.id === before.id);
    assert.ok(after, `gruppe ${before.id} skal stadig findes`);
    assert.ok(
      after!.gap_seconds <= before.gap_seconds + 1e-9,
      `gruppe ${before.id}: gap voksede (${before.gap_seconds} -> ${after!.gap_seconds})`,
    );
  }
});

test("regruppering: raekkefolgen mellem grupper er invariant — ingen jagende gruppe overhaler den foran", () => {
  const { state, ctx } = buildMultiGroupScenario(
    [{ gap: 0, descending: 20, size: 3 }, { gap: 30, descending: 99, size: 40 }, { gap: 90, descending: 99, size: 40 }],
    1,
    20,
  );
  const result = descentHook(state, ctx);
  const gapOf = (id: string) => result.state.groups.find((g) => g.id === id)!.gap_seconds;
  assert.ok(gapOf("g0") <= gapOf("g1") + 1e-9, "g1 maa aldrig ende foran g0");
  assert.ok(gapOf("g1") <= gapOf("g2") + 1e-9, "g2 maa aldrig ende foran g1");
});

test("regruppering: computeRegroupSeconds lukker aldrig mere end hullet og aldrig mindre end nul (fast-check)", () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0, max: 3000, noNaN: true }),
      fc.double({ min: 0, max: 40, noNaN: true }),
      fc.constantFrom<1 | 2 | 3>(1, 2, 3),
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 0, max: 99 }),
      (gap, km, tech, chase, ahead) => {
        const closed = computeRegroupSeconds(gap, km, tech, chase, ahead, undefined, true);
        assert.ok(closed >= 0, `lukning blev negativ: ${closed}`);
        assert.ok(closed <= gap + 1e-9, `lukning (${closed}) oversteg hullet (${gap})`);
      },
    ),
    { numRuns: 300, seed: 4604 },
  );
});

test("regruppering: en gruppe med bedre descending-evne lukker mindst lige saa meget som en svagere", () => {
  const mk = (chaseDescending: number) =>
    computeRegroupSeconds(300, 12, 2, chaseDescending, 50, undefined, true);
  const weak = mk(20);
  const mid = mk(50);
  const strong = mk(90);
  assert.ok(weak <= mid + 1e-9, `svag (${weak}) lukkede mere end middel (${mid})`);
  assert.ok(mid <= strong + 1e-9, `middel (${mid}) lukkede mere end staerk (${strong})`);
});

test("regruppering: en ikke-teknisk finale-nedkoersel regrupperer selvom den ALDRIG kan udloese et angreb", () => {
  const { state, ctx } = buildMultiGroupScenario(
    [{ gap: 0, descending: 50, size: 5 }, { gap: 200, descending: 50, size: 30 }],
    1, // under minTechnicalityForAttack — gammel kode returnerede uaendret state
    15,
  );
  const result = descentHook(state, ctx);
  const after = result.state.groups.find((g) => g.id === "g1")!;
  assert.ok(after.gap_seconds < 200, "T1-nedkoerslen skal stadig lukke en del af hullet");
  assert.equal(eventsOfType(result.events, "finale_attack").length, 0, "T1 maa ikke udloese angreb");
});

test("angreb: en samlet hovedgruppe kan ikke koere fra sig selv paa en T2-nedkoersel", () => {
  const big = Array.from({ length: 150 }, (_, i) => [`r${i}`, i % 100] as [string, number]);
  const { state, ctx } = buildSingleGroupScenario(big, 2);
  const result = descentHook(state, ctx);
  assert.equal(
    eventsOfType(result.events, "finale_attack").length,
    0,
    "angreb ud af en 150-rytters gruppe kraever den svaereste vejtype",
  );
});

test("angreb: kun de bedste descendere gaar med — ikke hele gruppen", () => {
  const pairs: Array<[string, number]> = [
    ["elite1", 95], ["elite2", 92], ["mid1", 70], ["mid2", 65], ["weak1", 40], ["weak2", 30],
  ];
  const { state, ctx } = buildSingleGroupScenario(pairs, 3);
  const result = descentHook(state, ctx);
  const attack = eventsOfType(result.events, "finale_attack")[0];
  assert.ok(attack, "der skal vaere et angreb ved stor evne-forskel paa T3");
  const attackerIds = attack.params.rider_ids as string[];
  assert.ok(attackerIds.length < pairs.length, "angrebet maa ikke omfatte hele gruppen");
  for (const id of attackerIds) {
    assert.ok(id.startsWith("elite"), `${id} burde ikke kvalificere som angriber`);
  }
});
