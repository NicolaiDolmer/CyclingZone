// backend/lib/engine/v4/mechanics/leadout.test.ts
// Kontrakt-tests + property-test (fast-check, 200 runs, seeded) for M6
// (sprint-tog). SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-
// stage-design.md §4 M6 + §8 beslutning 9 (bounded bidrag).
//
// Testene laaser HENSIGT (retning + bounded stoerrelse), ikke
// implementeringsdetaljer: en kaptajn med et staerkere/stoerre sprint-tog
// scorer ALDRIG lavere end uden ordre, bonussen er ALTID clampet til
// tuning.maxScoreBonus, og ordre-fravaer paavirker intet (T4-defaultet).

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  applyLeadoutScoreBonuses,
  computeLeadoutQuality,
  computeLeadoutScoreBonus,
  hasSprinterProfile,
  parseLeadoutOrders,
  sprintTrainLeadoutOrder,
  trainSizeFactor,
  type LeadoutOrder,
  type SprintTrainInput,
} from "./leadout.ts";
import { simulateStageV4 } from "../index.ts";
import { LEADOUT_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, RiderState, RouteV2, TeamOrder } from "../types.ts";

// ── Fixtures ───────────────────────────────────────────────────────────────

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = overrides[key] ?? 50;
  return out;
}

function makeEntrant(riderId: string, ab: Record<AbilityKey, number>): Entrant {
  return { rider_id: riderId, abilities: ab, role: "free_role", effort: "normal", condition: 1 };
}

function makeRiderState(riderId: string, wprimeFraction = 1): RiderState {
  return {
    rider_id: riderId,
    group_id: "finale-winner-0",
    cp: 0.5,
    wprimeMax: 1,
    wprime: wprimeFraction,
    dayform: 0,
    seconds_over_cp: 0,
    work_norm: 0,
    incidents: 0,
    status: "racing",
    time_seconds: 0,
  };
}

// ── parseLeadoutOrders ────────────────────────────────────────────────────

test("parseLeadoutOrders: udtraekker gyldige leadout-ordrer, ignorerer andre kinds og fejlformet params", () => {
  const orders: TeamOrder[] = [
    { team_id: "team-a", kind: "leadout", params: { captain_rider_id: "cap-a", leadout_rider_ids: ["lo-1", "lo-2"] } },
    { team_id: "team-b", kind: "breakaway_stance", params: { stance: "chase" } },
    { team_id: "team-c", kind: "leadout", params: { captain_rider_id: "cap-c" } }, // mangler leadout_rider_ids
    { team_id: "team-d", kind: "leadout" }, // mangler params helt
  ];
  const parsed = parseLeadoutOrders(orders);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], { team_id: "team-a", captain_rider_id: "cap-a", leadout_rider_ids: ["lo-1", "lo-2"] });
});

test("parseLeadoutOrders: to ordrer for samme team_id — bruger den SIDSTE deterministisk", () => {
  const orders: TeamOrder[] = [
    { team_id: "team-a", kind: "leadout", params: { captain_rider_id: "cap-1", leadout_rider_ids: ["lo-1"] } },
    { team_id: "team-a", kind: "leadout", params: { captain_rider_id: "cap-2", leadout_rider_ids: ["lo-2"] } },
  ];
  const parsed = parseLeadoutOrders(orders);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].captain_rider_id, "cap-2");
});

// ── computeLeadoutQuality ──────────────────────────────────────────────────

test("computeLeadoutQuality: 0 naar ingen leadout-ryttere er i kontendentpuljen (sprengt tog)", () => {
  const entrants: Record<string, Entrant> = { lo1: makeEntrant("lo1", abilities({ positioning: 90, tempo: 90, acceleration: 90 })) };
  const riderStates: Record<string, RiderState> = { lo1: makeRiderState("lo1") };
  const quality = computeLeadoutQuality(["lo1"], new Set(["cap"]), entrants, riderStates);
  assert.equal(quality, 0);
});

test("computeLeadoutQuality: hoejere evner giver hoejere kvalitet (retning), altid i [0,1]", () => {
  const weakEntrants: Record<string, Entrant> = { lo1: makeEntrant("lo1", abilities({ positioning: 10, tempo: 10, acceleration: 10 })) };
  const strongEntrants: Record<string, Entrant> = { lo1: makeEntrant("lo1", abilities({ positioning: 90, tempo: 90, acceleration: 90 })) };
  const riderStates: Record<string, RiderState> = { lo1: makeRiderState("lo1") };
  const contenders = new Set(["lo1"]);
  const weak = computeLeadoutQuality(["lo1"], contenders, weakEntrants, riderStates);
  const strong = computeLeadoutQuality(["lo1"], contenders, strongEntrants, riderStates);
  assert.ok(weak >= 0 && weak <= 1);
  assert.ok(strong >= 0 && strong <= 1);
  assert.ok(strong > weak, `staerkere leadout-tog skal give hoejere kvalitet (${strong} <= ${weak})`);
});

test("computeLeadoutQuality: udtoemt rytter (wprime=0) bidrager mindre end en frisk, men aldrig negativt/aldrig 0 alene", () => {
  const entrants: Record<string, Entrant> = { lo1: makeEntrant("lo1", abilities({ positioning: 80, tempo: 80, acceleration: 80 })) };
  const contenders = new Set(["lo1"]);
  const fresh = computeLeadoutQuality(["lo1"], contenders, entrants, { lo1: makeRiderState("lo1", 1) });
  const spent = computeLeadoutQuality(["lo1"], contenders, entrants, { lo1: makeRiderState("lo1", 0) });
  assert.ok(spent >= 0 && spent <= 1);
  assert.ok(spent < fresh, "udtoemt rytter skal give lavere kvalitet end en frisk med samme evner");
  assert.ok(spent > 0, "reserve-gulvet skal forhindre at en helt udtoemt rytter giver 0-bidrag alene");
});

// ── trainSizeFactor + computeLeadoutScoreBonus (bounded, hardt krav) ────────

test("trainSizeFactor: 0 ryttere giver 0, stigende med presentCount, aldrig over 1", () => {
  assert.equal(trainSizeFactor(0, 3), 0);
  const one = trainSizeFactor(1, 3);
  const two = trainSizeFactor(2, 3);
  const three = trainSizeFactor(3, 3);
  const ten = trainSizeFactor(10, 3);
  assert.ok(one > 0 && one <= 1);
  assert.ok(one < two && two < three, "flere ryttere i toget skal give en stoerre (eller lig) faktor");
  assert.ok(three <= 1 && ten <= 1, "faktoren maa aldrig overstige 1 uanset togstoerrelse");
});

test("computeLeadoutScoreBonus: ALTID i [0, maxScoreBonus], fast-check (200 runs)", () => {
  fc.assert(
    fc.property(
      fc.float({ min: 0, max: 1, noNaN: true }),
      fc.integer({ min: 0, max: 12 }),
      (quality, presentCount) => {
        const bonus = computeLeadoutScoreBonus(quality, presentCount, LEADOUT_EXTRA_TUNING);
        assert.ok(bonus >= 0 - 1e-9, `bonus skal aldrig vaere negativ (${bonus})`);
        assert.ok(bonus <= LEADOUT_EXTRA_TUNING.maxScoreBonus + 1e-9, `bonus (${bonus}) overstiger loftet (${LEADOUT_EXTRA_TUNING.maxScoreBonus})`);
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

test("computeLeadoutScoreBonus: 0 naar quality=0 ELLER presentCount=0 (intet tog = ingen bonus)", () => {
  assert.equal(computeLeadoutScoreBonus(0, 3, LEADOUT_EXTRA_TUNING), 0);
  assert.equal(computeLeadoutScoreBonus(0.9, 0, LEADOUT_EXTRA_TUNING), 0);
});

// ── applyLeadoutScoreBonuses: bounded, kun kaptajnen paavirkes, aldrig deterministisk sejr ──

test("applyLeadoutScoreBonuses: ingen ordrer -> uaendret liste (T4-default)", () => {
  const scored = [{ riderId: "a", score: 0.5 }, { riderId: "b", score: 0.4 }];
  const result = applyLeadoutScoreBonuses(scored, [], new Set(["a", "b"]), {}, {}, LEADOUT_EXTRA_TUNING);
  assert.deepEqual(result, scored);
});

test("applyLeadoutScoreBonuses: kun den designerede kaptajn faar bonus, andre ryttere uaendrede", () => {
  const entrants: Record<string, Entrant> = {
    cap: makeEntrant("cap", abilities()),
    lo1: makeEntrant("lo1", abilities({ positioning: 80, tempo: 80, acceleration: 80 })),
    rival: makeEntrant("rival", abilities()),
  };
  const riderStates: Record<string, RiderState> = {
    cap: makeRiderState("cap"),
    lo1: makeRiderState("lo1"),
    rival: makeRiderState("rival"),
  };
  const contenders = new Set(["cap", "lo1", "rival"]);
  const orders: LeadoutOrder[] = [{ team_id: "team-a", captain_rider_id: "cap", leadout_rider_ids: ["lo1"] }];
  const scored = [{ riderId: "cap", score: 0.3 }, { riderId: "rival", score: 0.35 }];

  const result = applyLeadoutScoreBonuses(scored, orders, contenders, entrants, riderStates, LEADOUT_EXTRA_TUNING);
  const cap = result.find((r) => r.riderId === "cap")!;
  const rival = result.find((r) => r.riderId === "rival")!;

  assert.ok(cap.score > 0.3, "kaptajnen skal faa en positiv bonus fra sit sprint-tog");
  assert.ok(cap.score <= 0.3 + LEADOUT_EXTRA_TUNING.maxScoreBonus + 1e-9, "bonussen maa aldrig overstige det haarde loft");
  assert.equal(rival.score, 0.35, "en rytter uden leadout-ordre skal vaere upaavirket");
});

test("applyLeadoutScoreBonuses: aldrig deterministisk sejr — et svagt (lav-score) sprint-tog kan ikke slaa en langt staerkere rival", () => {
  const entrants: Record<string, Entrant> = {
    cap: makeEntrant("cap", abilities({ sprint: 10 })),
    lo1: makeEntrant("lo1", abilities({ positioning: 99, tempo: 99, acceleration: 99 })), // maksimalt sprint-tog
    rival: makeEntrant("rival", abilities({ sprint: 99 })),
  };
  const riderStates: Record<string, RiderState> = {
    cap: makeRiderState("cap"),
    lo1: makeRiderState("lo1"),
    rival: makeRiderState("rival"),
  };
  const contenders = new Set(["cap", "lo1", "rival"]);
  const orders: LeadoutOrder[] = [{ team_id: "team-a", captain_rider_id: "cap", leadout_rider_ids: ["lo1"] }];
  // Kaptajnens base-score ligger langt under rivalens (0.05 vs. 0.9) — selv det
  // absolut stoerste sprint-tog (bounded til maxScoreBonus=0.12) kan ikke lukke
  // et 0.85-hul.
  const scored = [{ riderId: "cap", score: 0.05 }, { riderId: "rival", score: 0.9 }];

  const result = applyLeadoutScoreBonuses(scored, orders, contenders, entrants, riderStates, LEADOUT_EXTRA_TUNING);
  const cap = result.find((r) => r.riderId === "cap")!;
  const rival = result.find((r) => r.riderId === "rival")!;
  assert.ok(cap.score < rival.score, "bounded bidrag: sprint-toget maa ALDRIG kunne vaelte en langt staerkere rival");
});

test("applyLeadoutScoreBonuses: hjaelper der ikke overlevede ind i finale-puljen giver ingen bonus", () => {
  const entrants: Record<string, Entrant> = {
    cap: makeEntrant("cap", abilities()),
    lo1: makeEntrant("lo1", abilities({ positioning: 90, tempo: 90, acceleration: 90 })),
  };
  const riderStates: Record<string, RiderState> = { cap: makeRiderState("cap"), lo1: makeRiderState("lo1") };
  // lo1 findes i entrants/riderStates men er IKKE i contenderIds -> sluppet tidligere.
  const contenders = new Set(["cap"]);
  const orders: LeadoutOrder[] = [{ team_id: "team-a", captain_rider_id: "cap", leadout_rider_ids: ["lo1"] }];
  const scored = [{ riderId: "cap", score: 0.3 }];
  const result = applyLeadoutScoreBonuses(scored, orders, contenders, entrants, riderStates, LEADOUT_EXTRA_TUNING);
  assert.equal(result[0].score, 0.3, "toget skal vaere sprengt naar leadout-rytteren ikke er i kontendentpuljen");
});

// ── #6352 (ren revision, official_times_v3): sprinteren faar et tog ─────────
//
// Trin 0 (genmaalt paa main 10/10): en `sprint_captain` med 3+ hjaelpere FIK
// allerede et tog gennem adapteren, og toget flyttede placeringen maalbart.
// Fejlen var holdet hvis obligatoriske KAPTAJN er sprinteren: intet tog, fordi
// togets maal kun var rollen sprint_captain. Testene nedenfor laaser begge.

const SEEDS_6352 = Array.from({ length: 12 }, (_, i) => `lo-6352-${i}`);

const FLAT_ROUTE: RouteV2 = {
  distance_km: 178,
  profile_type: "flat",
  finale_type: "bunch_sprint",
  segments: [
    { kind: "flat", from_km: 0, to_km: 95 },
    { kind: "flat", from_km: 95, to_km: 165 },
    { kind: "flat", from_km: 165, to_km: 178 },
  ],
  weather: { kind: "sun", wind_exposure: 0.1 },
  waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 178 }],
};

/** Ti hold a seks: én sprinter (faldende spurt pr. hold) + fem hjaelpere. Hold 4's sprinter har `leaderRole`. */
function flatField(leaderRole: "sprint_captain" | "captain"): Entrant[] {
  const list: Entrant[] = [];
  for (let t = 0; t < 10; t++) {
    const team = `team-${t}`;
    const sprint = 90 - t * 2;
    list.push({
      rider_id: `s${t}`, team_id: team, role: t === 4 ? leaderRole : "captain", effort: "normal", condition: 1,
      abilities: abilities({ sprint, acceleration: sprint - 4, flat: 72, positioning: 70, climbing: 50 }),
    });
    for (let h = 0; h < 5; h++) {
      list.push({
        rider_id: `h${t}-${h}`, team_id: team, role: "helper", effort: "normal", condition: 1,
        abilities: abilities({ flat: 70, tempo: 72, positioning: 66, acceleration: 62, sprint: 58, climbing: 40 }),
      });
    }
  }
  return list;
}

function team4Order(list: Entrant[], leadoutFlags: boolean): SprintTrainInput {
  const team = list.filter((e) => e.team_id === "team-4");
  return {
    team_id: "team-4",
    riders: team.map((e) => ({ rider_id: e.rider_id, effort: "normal", leadout: leadoutFlags && e.role === "helper" })),
    roster: team.map((e) => ({ rider_id: e.rider_id, role: e.role, abilities: e.abilities })),
    profileType: "flat",
    rulesRevision: "official_times_v3",
  };
}

function sprinterPlaces(list: Entrant[], orders: TeamOrder[]): number[] {
  return SEEDS_6352.map((seed) => {
    const out = simulateStageV4({ route: FLAT_ROUTE, startlist: list, orders, seed, tuning: RACE_V4_TUNING, rules_revision: "official_times_v3" });
    return out.results.findIndex((r) => r.rider_id === "s4") + 1;
  });
}

function assertMeasurableTrain(withTrain: number[], without: number[]): void {
  const notWorse = withTrain.every((p, i) => p <= without[i]);
  const better = withTrain.filter((p, i) => p < without[i]).length;
  assert.ok(notWorse, `toget maa aldrig koste placeringer: med ${withTrain.join(",")} / uden ${without.join(",")}`);
  assert.ok(better >= 6, `toget skal flytte placeringen i mindst halvdelen af seeds (${better} af 12)`);
}

test("#6352 v3: sprint_captain med 3+ hjaelpere i et fladt endagsloeb faar et tog med maalbar effekt", () => {
  const list = flatField("sprint_captain");
  const order = sprintTrainLeadoutOrder(team4Order(list, true));
  assert.ok(order, "toget dannes");
  assert.equal(order.params?.captain_rider_id, "s4");
  assert.ok((order.params?.leadout_rider_ids as string[]).length >= 3, "mindst tre i toget");
  assertMeasurableTrain(sprinterPlaces(list, [order]), sprinterPlaces(list, []));
});

test("#6352 v3: en kaptajn med sprinterprofil (ingen sprint_captain) faar hjaelperne som tog paa en flad etape", () => {
  const list = flatField("captain");
  const order = sprintTrainLeadoutOrder(team4Order(list, false));
  assert.ok(order, "kaptajnen faar et tog uden at holdet skal have en sprint_captain");
  assert.equal(order.params?.captain_rider_id, "s4");
  assert.deepEqual(order.params?.leadout_rider_ids, ["h4-0", "h4-1", "h4-2", "h4-3", "h4-4"]);
  assertMeasurableTrain(sprinterPlaces(list, [order]), sprinterPlaces(list, []));
});

test("#6352 v3: managerens egne tog-flag vinder, og en grupetto-rytter er aldrig med", () => {
  const list = flatField("captain");
  const input = team4Order(list, false);
  const picked = sprintTrainLeadoutOrder({
    ...input,
    riders: input.riders.map((r) => ({ ...r, leadout: r.rider_id === "h4-1" || r.rider_id === "h4-2" })),
  });
  assert.deepEqual(picked?.params?.leadout_rider_ids, ["h4-1", "h4-2"]);
  const withGrupetto = sprintTrainLeadoutOrder({
    ...input,
    riders: input.riders.map((r) => (r.rider_id === "h4-0" ? { ...r, effort: "grupetto" } : r)),
  });
  assert.ok(!(withGrupetto?.params?.leadout_rider_ids as string[]).includes("h4-0"));
});

test("#6352 v3: intet tog for en kaptajn uden sprinterprofil eller paa en ikke-flad etape", () => {
  const list = flatField("captain");
  const input = team4Order(list, false);
  const climberRoster = input.roster.map((r) => (r.rider_id === "s4" ? { ...r, abilities: { ...r.abilities, climbing: 95 } } : r));
  assert.equal(sprintTrainLeadoutOrder({ ...input, roster: climberRoster }), null);
  for (const profileType of ["hilly", "mountain", "rolling", null]) {
    assert.equal(sprintTrainLeadoutOrder({ ...input, profileType }), null, String(profileType));
  }
});

test("#6352: aeldre revisioner faar ingen ny tog-regel (null = kaldstedets gamle regel)", () => {
  const list = flatField("captain");
  for (const rulesRevision of [undefined, null, "legacy", "orders_gc_v3", "official_times_v1", "official_times_v2"]) {
    assert.equal(sprintTrainLeadoutOrder({ ...team4Order(list, false), rulesRevision }), null, String(rulesRevision));
    assert.equal(sprintTrainLeadoutOrder({ ...team4Order(flatField("sprint_captain"), true), rulesRevision }), null, String(rulesRevision));
  }
});

test("#6352: sprinterprofilen kraever at spurt er mindst lige saa hoej som de andre finale-evner", () => {
  assert.equal(hasSprinterProfile(abilities({ sprint: 80, climbing: 60 })), true);
  assert.equal(hasSprinterProfile(abilities({ sprint: 70, climbing: 80 })), false);
  assert.equal(hasSprinterProfile(abilities({ sprint: 70, time_trial: 71 })), false);
  assert.equal(hasSprinterProfile(null), false);
  assert.equal(hasSprinterProfile({}), false);
});
