// backend/lib/engine/v4/mechanics/gcBreakawayLeash7258.test.ts
// #7258 (KUN s5_profiles_v3): klassementet afgoeres ikke af et morgenudbrud. Kontrakter for den
// faelles fremskrivning (evne x resterende etaper) og dens fire brugere: blokeringen ved
// dannelsen, snoren/rivalen (uanset dangerFloor), #7160's "ufarligt" og testporten. Strukturelle
// invarianter og monotoni; ingen balance-tal (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isProjectedContender,
  projectedGainSeconds,
  projectedGapToWinnerSeconds,
  projectedGcFavourites,
  projectedLossSeconds,
  projectedTopRiders,
  remainingLossWeightSeconds,
  s5V3ProjectedControlTargetSeconds,
  stageFavourites,
  stageFavouriteSpontaneousScale,
} from "./gcBreakawayLeash7258.ts";
import { assessGcThreat, normalizeGcContext, raceGcAbilityModel, type DangerModel, type GcDangerTuning } from "./gcThreat.ts";
import { breakawayHarmlessFor } from "./breakawayInterest7160.ts";
import { s5V3FormationGuards7258 } from "./breakaway.ts";
import { SHARED_TIME_MODEL_V2_TUNING } from "./timeModel.ts";
import { RACE_V4_TUNING as TUNING, S5_V3_GC_LEASH_7258_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, GcContext, GcStageDemand, GcStanding, RaceGroup, RouteV2 } from "../types.ts";

const T = S5_V3_GC_LEASH_7258_TUNING;
const DANGER = SHARED_TIME_MODEL_V2_TUNING.gcDanger as unknown as GcDangerTuning;

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
function rider(id: string, team: string, over: Partial<Record<AbilityKey, number>> = {}, base = 50): Entrant {
  return { rider_id: id, abilities: { ...Object.fromEntries(KEYS.map((k) => [k, base])), ...over } as Record<AbilityKey, number>, role: "helper", effort: "normal", condition: 1, team_id: team } as Entrant;
}
const D: Record<string, Partial<Record<AbilityKey, number>>> = {
  flat: { sprint: 0.6, acceleration: 0.15, flat: 0.1, positioning: 0.1 },
  hilly: { punch: 0.45, tempo: 0.15, acceleration: 0.1, climbing: 0.1 },
  mountain: { climbing: 0.7, endurance: 0.15, tempo: 0.1 },
  high_mountain: { climbing: 0.75, endurance: 0.15, recovery: 0.05 },
  itt: { time_trial: 0.8, tempo: 0.15 },
};
const race = (profiles: string[]): GcStageDemand[] => profiles.map((p, i) => ({ stage_number: i + 1, profile_type: p, demand: D[p] }) as GcStageDemand);
function gcOf(standings: GcStanding[], stageNumber: number, stages: GcStageDemand[] | null, extra: Record<string, unknown> = {}): GcContext {
  return normalizeGcContext({ status: "standings", stage_number: stageNumber, leader_id: standings[0]?.rider_id ?? null, standings, threat_model: "s5", ...(stages ? { race_gc_stages: stages } : {}), ...extra });
}

// ── Fremskrivningen ──────────────────────────────────────────────────────────

test("#7258: tabsvaegten taeller kun etaperne EFTER i dag, og kun etapetyper der flytter klassementet", () => {
  const stages = race(["flat", "mountain", "flat", "high_mountain", "itt"]);
  const st = [{ rider_id: "a", rank: 1, gap_seconds: 0 }];
  assert.equal(remainingLossWeightSeconds(null), 0);
  assert.equal(remainingLossWeightSeconds({ status: "one_day" }), 0);
  assert.equal(remainingLossWeightSeconds(gcOf(st, 2, null)), 0, "uden loebets etaper: intet");
  const w = [1, 2, 3, 4, 5].map((n) => remainingLossWeightSeconds(gcOf(st, n, stages)));
  for (let i = 1; i < w.length; i += 1) assert.ok(w[i] <= w[i - 1], "monoton gennem loebet");
  assert.equal(w[4], 0, "sidste etape: intet tilbage");
  assert.ok(w[0] > 0);
  assert.equal(remainingLossWeightSeconds(gcOf(st, 1, race(["flat", "flat", "flat"]))), 0, "kun flade etaper: intet tab");
});

test("#7258: en svagere rytter taber mere jo svagere; en staerkere vinder spejlet; begge har et loft", () => {
  const gc = gcOf([{ rider_id: "a", rank: 1, gap_seconds: 0 }], 1, race(["mountain", "high_mountain", "itt", "mountain"]));
  assert.equal(projectedLossSeconds(gc, 1), 0);
  assert.equal(projectedLossSeconds(gc, 1.3), 0, "en staerkere taber intet");
  assert.equal(projectedLossSeconds(gc, Number.NaN), 0);
  let prev = 0;
  for (let r = 0.99; r >= T.minStrengthRatio; r -= 0.05) {
    const l = projectedLossSeconds(gc, r);
    assert.ok(l >= prev, `monoton ved ${r.toFixed(2)}`);
    prev = l;
  }
  assert.equal(projectedLossSeconds(gc, 0.01), projectedLossSeconds(gc, T.minStrengthRatio), "loft nedad");
  assert.equal(projectedGainSeconds(gc, 0.8), 0, "en svagere vinder intet");
  assert.ok(projectedGainSeconds(gc, 1.2) > projectedGainSeconds(gc, 1.1));
  assert.equal(projectedGainSeconds(gc, 100), projectedGainSeconds(gc, 1 / T.minStrengthRatio), "loft opad");
});

// Felt: en staerk klatrer der tabte tid tidligt, en svag rytter foerst i klassementet, fyld.
const FIELD: Record<string, Entrant> = {
  leaderWeak: rider("leaderWeak", "A", { climbing: 45, time_trial: 50 }),
  climber: rider("climber", "B", { climbing: 85, endurance: 75, tempo: 70, time_trial: 65 }),
  mid: rider("mid", "C", { climbing: 65, endurance: 60, tempo: 60 }),
  ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, rider(`f${i}`, `F${i % 4}`, { climbing: 40 })])),
};
const MOUNTAIN_RACE = race(["flat", "flat", "mountain", "high_mountain", "mountain", "itt", "high_mountain"]);
function standingsWith(gaps: Record<string, number>): GcStanding[] {
  const rows = Object.keys(FIELD).map((id) => ({ rider_id: id, gap_seconds: gaps[id] ?? 1200 + id.length }));
  rows.sort((a, b) => a.gap_seconds - b.gap_seconds || a.rider_id.localeCompare(b.rider_id));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

test("#7258 (B): fremskrevet slutklassement: en staerk klatrer der tabte tid tidligt staar foran en svag foerer naar bjergene venter", () => {
  const gc = gcOf(standingsWith({ leaderWeak: 0, mid: 30, climber: 240 }), 3, MOUNTAIN_RACE);
  const abilityOf = raceGcAbilityModel(gc)!;
  const racing = new Set(Object.keys(FIELD));
  const top1 = projectedTopRiders({ gc, entrants: FIELD, racingRiderIds: racing, abilityOf, topN: 1, syntheticFirstStage: false });
  assert.deepEqual([...top1], ["climber"]);
  // Med kun flade etaper tilbage taeller tiden alene.
  const flatGc = gcOf(standingsWith({ leaderWeak: 0, mid: 30, climber: 240 }), 1, race(["flat", "flat", "flat"]));
  const flatTop = projectedTopRiders({ gc: flatGc, entrants: FIELD, racingRiderIds: racing, abilityOf: raceGcAbilityModel(flatGc)!, topN: 1, syntheticFirstStage: false });
  assert.deepEqual([...flatTop], ["leaderWeak"]);
  assert.equal(projectedTopRiders({ gc, entrants: FIELD, racingRiderIds: racing, abilityOf, topN: 3, syntheticFirstStage: true }).size, 0, "syntetisk foerste etape: egen regel");
  assert.equal(projectedTopRiders({ gc, entrants: FIELD, racingRiderIds: racing, abilityOf: null, topN: 3, syntheticFirstStage: false }).size, 0);
});

test("#7258 (B): de faelles favoritter: foerste etape paa loebsevne, ellers fremskrevet; deterministisk raekkefoelge", () => {
  const racing = new Set(Object.keys(FIELD));
  const first = gcOf(Object.keys(FIELD).map((id) => ({ rider_id: id, rank: 1, gap_seconds: 0 })), 1, MOUNTAIN_RACE, { first_stage: true });
  const favFirst = projectedGcFavourites({ gc: first, entrants: FIELD, racingRiderIds: racing, abilityOf: raceGcAbilityModel(first), topN: 2, syntheticFirstStage: true });
  assert.deepEqual([...favFirst], ["climber", "mid"]);
  const later = gcOf(standingsWith({ leaderWeak: 0, mid: 30, climber: 240 }), 3, MOUNTAIN_RACE);
  const a = projectedGcFavourites({ gc: later, entrants: FIELD, racingRiderIds: racing, abilityOf: raceGcAbilityModel(later), topN: 3, syntheticFirstStage: false });
  const b = projectedGcFavourites({ gc: later, entrants: FIELD, racingRiderIds: racing, abilityOf: raceGcAbilityModel(later), topN: 3, syntheticFirstStage: false });
  assert.deepEqual([...a], [...b]);
  assert.equal([...a][0], "climber");
  assert.equal(projectedGcFavourites({ gc: { status: "one_day" }, entrants: FIELD, racingRiderIds: racing, abilityOf: null, topN: 3, syntheticFirstStage: false }).size, 0);
});

test("#7258: kun en reel kandidat (fremskrevet top eller foereren) holder en fremskreven trussel paa snor", () => {
  const gc = gcOf(standingsWith({ leaderWeak: 0, mid: 30, climber: 240 }), 3, MOUNTAIN_RACE);
  const abilityOf = raceGcAbilityModel(gc);
  assert.equal(isProjectedContender(gc, FIELD, "leaderWeak", abilityOf, false), true, "foereren forsvarer altid");
  assert.equal(isProjectedContender(gc, FIELD, "climber", abilityOf, false), true);
  assert.equal(isProjectedContender(gc, FIELD, "f11", abilityOf, false), false, "fyldrytter langt nede");
  assert.equal(isProjectedContender({ status: "one_day" }, FIELD, "climber", abilityOf, false), false);
});

test("#7258 (Codex): en udgaaet favorit er ikke den fremskrevne vinder; kun de ryttere der koerer taeller", () => {
  const gc = gcOf(standingsWith({ leaderWeak: 0, mid: 30, climber: 240 }), 3, MOUNTAIN_RACE);
  const abilityOf = raceGcAbilityModel(gc);
  const all = new Set(Object.keys(FIELD));
  const withoutClimber = new Set([...all].filter((id) => id !== "climber"));
  const withClimber = projectedGapToWinnerSeconds(gc, FIELD, "mid", abilityOf, false, all)!;
  const afterAbandon = projectedGapToWinnerSeconds(gc, FIELD, "mid", abilityOf, false, withoutClimber)!;
  assert.ok(afterAbandon <= withClimber, "uden klatreren er vinderen en anden, og ingen ligger laengere efter ham");
  assert.equal(projectedGapToWinnerSeconds(gc, FIELD, "climber", abilityOf, false, withoutClimber), null, "den udgaaede har ingen fremskrivning");
  assert.equal(isProjectedContender(gc, FIELD, "mid", abilityOf, false, withoutClimber), true);
});

// ── Snoren (gcThreat) ────────────────────────────────────────────────────────

const MOUNTAIN_ROUTE: RouteV2 = {
  distance_km: 180, profile_type: "mountain", finale_type: "long_climb",
  segments: [{ kind: "flat", from_km: 0, to_km: 120 }, { kind: "climb", from_km: 120, to_km: 180, gradient_pct: 7 } as unknown as RouteV2["segments"][number]],
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
} as RouteV2;
const FLAT_ROUTE: RouteV2 = {
  distance_km: 200, profile_type: "flat", finale_type: "flat_sprint",
  segments: [{ kind: "flat", from_km: 0, to_km: 200 }],
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
} as RouteV2;

function groups(breakaway: string[], lead: number): RaceGroup[] {
  return [
    { id: "breakaway-0", kind: "breakaway", rider_ids: breakaway, gap_seconds: 0, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: Object.keys(FIELD).filter((id) => !breakaway.includes(id)), gap_seconds: lead, cohesion: 1 },
  ] as RaceGroup[];
}
function assess(gc: GcContext, breakaway: string[], lead: number, protectedRiderId: string, v3: boolean, extra: { formationProbe?: true } = {}) {
  const stagesRemaining = gc.status === "standings" ? (gc.race_gc_stages?.filter((s) => s.stage_number > gc.stage_number).length ?? 0) : 0;
  const model: DangerModel = { stagesRemaining, tuning: DANGER, ...(v3 ? { s5V3: true as const } : {}) };
  return assessGcThreat({ gcContext: gc, groups: groups(breakaway, lead), entrants: FIELD, route: FLAT_ROUTE, protectedRiderId, km: 20,
    ownTeamId: FIELD[protectedRiderId].team_id ?? undefined, skipOwnRiderGroups: true, dangerModel: model, ...extra });
}

test("#7258 (B snor): en svagere udbryder under dangerFloor, der med forspringet kan vinde loebet, holdes paa snor under v3 (v2 uaendret)", () => {
  // Klatreren beskytter; den svage foerer (langt under dangerFloor) sidder i udbruddet, kun lidt foran.
  // Kun flade etaper tilbage: han taber intet paa resten, saa forspringet er hans sejr.
  // Han staar uden for klassementets forreste (rivalRankAlways), saa kun fremskrivningen goer ham farlig.
  const ahead = Number(DANGER.rivalRankAlways ?? 0) + 1;
  const gaps: Record<string, number> = { climber: 0, mid: 300, leaderWeak: ahead + 20 };
  for (let i = 0; i < ahead; i += 1) gaps[`f${i}`] = i + 1;
  const stages = race(["mountain", "mountain", "flat", "flat", "flat"]);
  const gc = gcOf(standingsWith(gaps), 3, stages);
  assert.ok((gc.status === "standings" ? gc.standings.find((s) => s.rider_id === "leaderWeak")!.rank : 0) > Number(DANGER.rivalRankAlways ?? 0));
  const lead = 900;
  const v3 = assess(gc, ["leaderWeak"], lead, "climber", true);
  const v2 = assess(gc, ["leaderWeak"], lead, "climber", false);
  assert.equal(v3.leash_hold, true, "v3 holder ham paa snor");
  assert.ok((v3.tolerated_lead_seconds ?? Infinity) < lead, "snoren er kortere end forspringet");
  assert.equal(v3.leash_projected, true);
  assert.notEqual(v2.leash_projected, true, "v2 kender ikke fremskrivningen");
  // Dannelsens proeve bruger aldrig fremskrivningen (dannelsen har sin egen regel).
  assert.notEqual(assess(gc, ["leaderWeak"], lead, "climber", true, { formationProbe: true }).leash_projected, true);
});

test("#7258 (B snor): samme svage udbryder med bjergene foran sig er ufarlig (fremskrevet tab); snoren er laengere jo flere bjerge", () => {
  const easy = gcOf(standingsWith({ climber: 0, leaderWeak: 20, mid: 300 }), 1, race(["flat", "flat", "flat"]));
  const hard = gcOf(standingsWith({ climber: 0, leaderWeak: 20, mid: 300 }), 1, race(["flat", "mountain", "high_mountain", "mountain", "high_mountain", "itt"]));
  const lead = 240;
  const a = assess(easy, ["leaderWeak"], lead, "climber", true);
  const b = assess(hard, ["leaderWeak"], lead, "climber", true);
  const room = (t: { tolerated_lead_seconds?: number; leash_hold?: boolean }) => (t.leash_hold ? t.tolerated_lead_seconds ?? Infinity : Infinity);
  assert.ok(room(b) >= room(a), "flere bjerge tilbage = laengere snor");
  assert.equal(a.leash_hold, true);
});

test("#7258: uden loebets etaper er vurderingen som foer (ingen fremskrivning)", () => {
  const gc = gcOf(standingsWith({ climber: 0, leaderWeak: 20, mid: 300 }), 3, null);
  const v3 = assess(gc, ["leaderWeak"], 900, "climber", true);
  assert.notEqual(v3.leash_projected, true);
});

// ── #7160 "ufarligt" ─────────────────────────────────────────────────────────

test("#7258 (#7160): ufarligt maales fremskrevet: en staerkere udbryder langt nede i tid er ikke ufarlig med bjergene foran", () => {
  const gc = gcOf(standingsWith({ leaderWeak: 0, mid: 30, climber: 1200 }), 2, race(["flat", "flat", "mountain", "high_mountain", "mountain", "high_mountain", "itt"]));
  const base = { breakawayRiderIds: ["climber"], gcContext: gc, gcRiderGapSeconds: 0 };
  const timeOnly = breakawayHarmlessFor(base);
  const projected = breakawayHarmlessFor({ ...base, projection: { gcRiderId: "leaderWeak", entrants: FIELD } });
  assert.ok(timeOnly || !projected, "fremskrivningen kan kun goere et udbrud farligere for en svagere klassementsrytter");
  assert.equal(projected, false);
  // En svagere udbryder bliver aldrig farligere af fremskrivningen.
  const weakBreak = { breakawayRiderIds: ["f0"], gcContext: gc, gcRiderGapSeconds: 0 };
  assert.equal(breakawayHarmlessFor({ ...weakBreak, projection: { gcRiderId: "climber", entrants: FIELD } }), breakawayHarmlessFor(weakBreak));
});

// ── (C) dagens favoritter + dannelsens vagter ────────────────────────────────

test("#7258 (C): dagens favoritter er de bedste paa finalens krav; tom uden krav; faktoren er i [0, 1]", () => {
  const ids = Object.keys(FIELD);
  const climbers = stageFavourites({ riderIds: ids, entrants: FIELD, demand: D.mountain });
  assert.ok(climbers.has("climber"));
  assert.ok(climbers.size <= T.stageFavouriteTopN);
  assert.equal(stageFavourites({ riderIds: ids, entrants: FIELD, demand: null }).size, 0);
  const s = stageFavouriteSpontaneousScale();
  assert.ok(s >= 0 && s <= 1);
});

test("#7258: dannelsens vagter: endagsloeb har favoritter men ingen klassementsblokering; etapeloeb med stilling har begge", () => {
  const ids = Object.keys(FIELD);
  const oneDay = s5V3FormationGuards7258({ gcContext: { status: "one_day" }, entrants: FIELD, route: MOUNTAIN_ROUTE, tuning: TUNING }, ids);
  assert.equal(oneDay.projectedTop.size, 0);
  assert.ok(oneDay.favourites.has("climber"), "endagsloebets favorit paa en bjergfinale");
  const gc = gcOf(standingsWith({ leaderWeak: 0, mid: 30, climber: 240 }), 3, MOUNTAIN_RACE);
  const stage = s5V3FormationGuards7258({ gcContext: gc, entrants: FIELD, route: MOUNTAIN_ROUTE, tuning: TUNING }, ids);
  assert.ok(stage.projectedTop.has("climber"), "den staerke klatrer der tabte tid tidligt blokeres");
});

// ── Snoren i finalen ─────────────────────────────────────────────────────────

test("#7258: snoren paa fremskrevne trusler er det mindste tolererede forspring og har et gulv", () => {
  assert.equal(s5V3ProjectedControlTargetSeconds([]), null);
  assert.equal(s5V3ProjectedControlTargetSeconds([undefined, Number.NaN]), null);
  const floor = T.projectedMinLeashSeconds;
  assert.equal(s5V3ProjectedControlTargetSeconds([floor + 200, floor + 100]), floor + 100);
  assert.equal(s5V3ProjectedControlTargetSeconds([0]), floor, "aldrig under gulvet: snoren brydes ikke");
});
