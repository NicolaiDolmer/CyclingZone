// #6804 P6 (KUN s5_profiles_v3, slukket): klassementskontrol paa snor.
// Kontrakter, ingen balance-tal (hard rule 17): hvornaar P6 gaelder, monotoni og graenser
// i hjaelperne, de fire punkter i trusselsvurderingen og at v2 er uroert (G6).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  s5V3ControlledClosing,
  s5V3ControlTargetSeconds,
  s5V3InControlFinale,
  s5V3IsShortStageRace,
  s5V3ProjectionWeight,
} from "./breakawayV3_6804.ts";
import { assessGcThreat, normalizeGcContext, type DangerModel, type GcThreat } from "./gcThreat.ts";
import { SHARED_TIME_MODEL_V2_TUNING } from "./timeModel.ts";
import { S5_V3_BREAKAWAY_TUNING } from "../tuning.ts";
import { simulateStageV4 } from "../index.ts";
import type { AbilityKey, Entrant, GcContext, GcStanding, RaceGroup, RouteV2 } from "../types.ts";

const P6 = S5_V3_BREAKAWAY_TUNING.p6;
const DANGER = SHARED_TIME_MODEL_V2_TUNING.gcDanger;

// ── Hjaelperne ────────────────────────────────────────────────────────────────

test("#6804 P6.2: vaegten paa den fremskrevne gevinst er 1 i finalen, falder med distancen og har et gulv", () => {
  assert.equal(s5V3ProjectionWeight(0), 1);
  assert.equal(s5V3ProjectionWeight(P6.projectionFullKm), 1);
  assert.equal(s5V3ProjectionWeight(Number.NaN), 1);
  let prev = 1;
  for (let km = P6.projectionFullKm; km <= 400; km += 10) {
    const w = s5V3ProjectionWeight(km);
    assert.ok(w <= prev + 1e-12, `monoton ved ${km}`);
    assert.ok(w >= P6.projectionMinWeight && w <= 1);
    prev = w;
  }
  assert.equal(s5V3ProjectionWeight(1e6), P6.projectionMinWeight);
});

test("#6804 P6.3: kort etapeloeb = dagens etape + etaper tilbage (ellers loebets etaper); ukendt er ikke kort", () => {
  const ctx = (extra: Record<string, unknown>): GcContext => ({ status: "standings", stage_number: 3, leader_id: null, standings: [], ...extra }) as GcContext;
  assert.equal(s5V3IsShortStageRace(ctx({ stages_remaining: P6.shortRaceMaxStages - 3 })), true);
  assert.equal(s5V3IsShortStageRace(ctx({ stages_remaining: P6.shortRaceMaxStages - 2 })), false);
  assert.equal(s5V3IsShortStageRace(ctx({ stages_remaining: 18 })), false, "Grand Tour");
  const demand = { climbing: 1 };
  assert.equal(s5V3IsShortStageRace(ctx({ race_gc_stages: [1, 2, 3, 4, 5].map((n) => ({ stage_number: n, profile_type: "hilly", demand })) })), true);
  assert.equal(s5V3IsShortStageRace(ctx({})), false);
  assert.equal(s5V3IsShortStageRace({ status: "one_day" }), false);
  assert.equal(s5V3IsShortStageRace({ status: "first_stage", stage_number: 1 }), false);
  assert.equal(s5V3IsShortStageRace(null), false);
});

test("#6804 P6.1: finalen henter; snoren er det mindste tolererede forspring; en for kort snor er brudt", () => {
  assert.equal(s5V3InControlFinale(180, 180), true);
  assert.equal(s5V3InControlFinale(180, 180 - P6.controlFinaleKm), true);
  assert.equal(s5V3InControlFinale(180, 180 - P6.controlFinaleKm - 1), false);
  assert.equal(s5V3InControlFinale(0, 10), true, "ukendt distance: ingen kontrol (som v2)");
  assert.equal(s5V3ControlTargetSeconds([]), null);
  assert.equal(s5V3ControlTargetSeconds([undefined, Number.NaN]), null);
  const long = P6.minLeashSeconds + 100;
  assert.equal(s5V3ControlTargetSeconds([long + 50, long, undefined]), long);
  assert.equal(s5V3ControlTargetSeconds([long, P6.minLeashSeconds - 1]), null, "et hold med brudt snor henter");
  assert.equal(s5V3ControlTargetSeconds([P6.minLeashSeconds]), P6.minLeashSeconds);
});

test("#6804 P6.1: kontrollen lukker aldrig mere end uden, aldrig mindre end grundjagten, og reaktionen bringer ikke hullet under snoren", () => {
  for (const full of [0, 20, 90, 300]) {
    for (const base of [0, 10, 80, 400]) {
      for (const gap of [0, 60, 150, 400]) {
        for (const target of [0, 60, 120, 240]) {
          const c = s5V3ControlledClosing({ fullClosing: full, baseClosing: base, gapSeconds: gap, targetSeconds: target });
          assert.ok(c <= full + 1e-12, "aldrig mere end uden kontrol");
          assert.ok(c >= Math.min(full, base) - 1e-12, "grundjagten virker som foer");
          if (c > Math.min(full, base) + 1e-12) assert.ok(gap - c >= target - 1e-9, "reaktionens ekstra stopper ved snoren");
        }
      }
    }
  }
});

// ── Trusselsvurderingen ──────────────────────────────────────────────────────

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
function entrant(id: string, team: string, level: number, role: Entrant["role"] = "helper"): Entrant {
  return { rider_id: id, abilities: Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>, role, effort: "normal", condition: 1, team_id: team };
}

const FLAT: RouteV2 = {
  distance_km: 200, profile_type: "flat", finale_type: "flat_sprint",
  segments: [{ kind: "flat", from_km: 0, to_km: 200 }],
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};

const STRONG = Math.max(12, P6.contenderAbilityRank + 2);
// Hold A: kaptajnen (foerer). flere staerke klassementsryttere end P6-graensen for en reel chance (paa hver sit hold), en svag
// rytter paa hold W og 20 fyldryttere.
const ENTRANTS: Record<string, Entrant> = {
  cap: entrant("cap", "A", 80, "captain"),
  aHelp: entrant("aHelp", "A", 55),
  ...Object.fromEntries(Array.from({ length: STRONG }, (_, i) => [`s${i}`, entrant(`s${i}`, `S${i}`, 76 + (i % 4), "captain")])),
  w1: entrant("w1", "W", 50, "captain"),
  weak: entrant("weak", "D", 55, "hunter"),
  ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, entrant(`f${i}`, `F${i % 5}`, 45)])),
};
const ALL = Object.keys(ENTRANTS);

function gc(rows: GcStanding[], stageNumber: number, stagesRemaining: number, leaderId: string): GcContext {
  const ranked = new Set(rows.map((r) => r.rider_id));
  const rest = ALL.filter((id) => !ranked.has(id)).map((rider_id, i) => ({ rider_id, rank: rows.length + 1 + i, gap_seconds: 900 + i }));
  return normalizeGcContext({ status: "standings", stage_number: stageNumber, leader_id: leaderId, standings: [...rows, ...rest], threat_model: "s5", stages_remaining: stagesRemaining });
}

function groups(breakaway: string[], lead: number): RaceGroup[] {
  return [
    { id: "breakaway-0", kind: "breakaway", rider_ids: breakaway, gap_seconds: 0, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: ALL.filter((id) => !breakaway.includes(id)), gap_seconds: lead, cohesion: 1 },
  ];
}

function assess(gcContext: GcContext, breakaway: string[], lead: number, protectedRiderId: string, km: number, v3: boolean): GcThreat {
  const stagesRemaining = gcContext.status === "standings" ? gcContext.stages_remaining : undefined;
  const model: DangerModel = { ...(stagesRemaining !== undefined ? { stagesRemaining } : {}), tuning: DANGER, ...(v3 ? { s5V3: true as const } : {}) };
  return assessGcThreat({ gcContext, groups: groups(breakaway, lead), entrants: ENTRANTS, route: FLAT, protectedRiderId, km,
    ownTeamId: ENTRANTS[protectedRiderId].team_id ?? undefined, skipOwnRiderGroups: true, dangerModel: model });
}

test("#6804 P6.4: en udbryder uden klassementsevne truer ikke troejen under v3 (v2 uaendret)", () => {
  // Alle staar paa samme tid (efter flade etaper); udbryderen er langt nede paa evne og uden for de forreste.
  const rows: GcStanding[] = [{ rider_id: "cap", rank: 1, gap_seconds: 0 },
    ...Array.from({ length: 12 }, (_, i) => ({ rider_id: `s${i}`, rank: i + 2, gap_seconds: 0 })),
    { rider_id: "weak", rank: 14, gap_seconds: 0 }];
  const ctx = gc(rows, 3, 18, "cap");
  const v2 = assess(ctx, ["weak"], 600, "cap", 150, false);
  const v3 = assess(ctx, ["weak"], 600, "cap", 150, true);
  assert.equal(v2.reason, "leader_jersey_at_risk");
  assert.equal(v2.severity, "moderate");
  assert.equal(v3.severity, "none");
  assert.equal(v3.reason, "transient_only");
  assert.notEqual(v3.leash_hold, true);
});

test("#6804 P6.4: klassementets forreste er altid en rival under v3, uanset evne (rivalRankAlways)", () => {
  assert.ok(DANGER.rivalRankAlways !== null);
  const rows: GcStanding[] = [{ rider_id: "cap", rank: 1, gap_seconds: 0 }, { rider_id: "weak", rank: 2, gap_seconds: 5 },
    ...Array.from({ length: 12 }, (_, i) => ({ rider_id: `s${i}`, rank: i + 3, gap_seconds: 30 }))];
  const ctx = gc(rows, 3, 18, "cap");
  for (const v3 of [false, true]) {
    const t = assess(ctx, ["weak"], 600, "cap", 150, v3);
    assert.equal(t.severity, "serious", `v3=${v3}`);
    assert.deepEqual(t.threat_rider_ids, ["weak"]);
    assert.equal(t.leash_hold, true);
    assert.ok((t.tolerated_lead_seconds ?? Infinity) <= (DANGER.rankedLeadCapSeconds ?? Infinity), "snoren er hoejst loftet: aldrig minutter uden jagt");
  }
});

test("#6804 P6.3: i et kort etapeloeb forsvarer et hold uden reel klassementschance ikke; Grand Tours er uaendrede", () => {
  // W ligger godt placeret, men er langt nede paa evne. En staerk rytter sidder i udbruddet.
  const rows: GcStanding[] = [{ rider_id: "cap", rank: 1, gap_seconds: 0 }, { rider_id: "s1", rank: 2, gap_seconds: 10 },
    { rider_id: "s2", rank: 3, gap_seconds: 15 }, { rider_id: "w1", rank: 4, gap_seconds: 20 },
    ...Array.from({ length: 9 }, (_, i) => ({ rider_id: `s${i + 3}`, rank: i + 5, gap_seconds: 40 + i }))];
  const short = gc(rows, 3, P6.shortRaceMaxStages - 3, "cap");
  const grandTour = gc(rows, 3, 18, "cap");
  const v2Short = assess(short, ["s1"], 120, "w1", 150, false);
  const v3Short = assess(short, ["s1"], 120, "w1", 150, true);
  assert.notEqual(v2Short.reason, "no_gc_interest", "v2: placeringen alene giver noget at forsvare");
  assert.equal(v3Short.reason, "no_gc_interest");
  assert.equal(v3Short.severity, "none");
  // Grand Tour: punkt 3 gaelder ikke (kun korte etapeloeb).
  assert.notEqual(assess(grandTour, ["s1"], 120, "w1", 150, true).reason, "no_gc_interest");
  // Et hold med en reel chance (evne + placering) forsvarer stadig, og foereren altid.
  assert.notEqual(assess(short, ["s1"], 120, "s2", 150, true).reason, "no_gc_interest");
  assert.notEqual(assess(short, ["s1"], 120, "cap", 150, true).reason, "no_gc_interest");
});

test("#6804 P6.2: tidligt paa etapen taeller den fremskrevne gevinst mindre; i finalen er v2 og v3 ens", () => {
  // En lige saa staerk rytter (fuld fare) uden for de forreste, et stykke nede.
  const rows: GcStanding[] = [{ rider_id: "cap", rank: 1, gap_seconds: 0 },
    ...Array.from({ length: 11 }, (_, i) => ({ rider_id: `s${i}`, rank: i + 2, gap_seconds: 20 + i })),
    { rider_id: "s11", rank: 13, gap_seconds: 200 }];
  const ctx = gc(rows, 3, 18, "cap");
  const early = { v2: assess(ctx, ["s11"], 60, "cap", 10, false), v3: assess(ctx, ["s11"], 60, "cap", 10, true) };
  const rank = { none: 0, moderate: 1, serious: 2 } as const;
  assert.ok(rank[early.v3.severity] <= rank[early.v2.severity], "tidligt: aldrig mere alvorligt under v3");
  const finale = { v2: assess(ctx, ["s11"], 60, "cap", FLAT.distance_km - 10, false), v3: assess(ctx, ["s11"], 60, "cap", FLAT.distance_km - 10, true) };
  assert.equal(finale.v3.severity, finale.v2.severity);
  assert.equal(finale.v3.tolerated_lead_seconds, finale.v2.tolerated_lead_seconds);
});

test("#6804 P6.2: en lige saa staerk rival der er inden for raekkevidde tidligt (v2) er det ikke under v3", () => {
  const rows: GcStanding[] = [{ rider_id: "cap", rank: 1, gap_seconds: 0 },
    ...Array.from({ length: 11 }, (_, i) => ({ rider_id: `s${i}`, rank: i + 2, gap_seconds: 20 + i })),
    { rider_id: "twin", rank: 13, gap_seconds: 0 }];
  const entrants = { ...ENTRANTS, twin: entrant("twin", "T", 80, "captain") };
  const ctx = normalizeGcContext({ status: "standings", stage_number: 3, leader_id: "cap", threat_model: "s5", stages_remaining: 18,
    standings: [...rows, ...ALL.filter((id) => !rows.some((r) => r.rider_id === id)).map((rider_id, i) => ({ rider_id, rank: 14 + i, gap_seconds: 900 + i }))] });
  // Afstand + snorens margin ligger mellem den nedvaegtede og den fulde fremskrivning.
  const deficit = P6.minLeashSeconds + 200;
  const lead = deficit - 150;
  const ctxDeficit = normalizeGcContext({ ...(ctx as Record<string, unknown>), standings: (ctx as { standings: GcStanding[] }).standings.map((s) => (s.rider_id === "twin" ? { ...s, gap_seconds: deficit } : s)) });
  const run = (v3: boolean, km: number) => assessGcThreat({
    gcContext: ctxDeficit, groups: [
      { id: "breakaway-0", kind: "breakaway", rider_ids: ["twin"], gap_seconds: 0, cohesion: 1 },
      { id: "peloton-0", kind: "peloton", rider_ids: [...ALL], gap_seconds: lead, cohesion: 1 },
    ],
    entrants, route: FLAT, protectedRiderId: "cap", km, ownTeamId: "A", skipOwnRiderGroups: true,
    dangerModel: { stagesRemaining: 18, tuning: DANGER, ...(v3 ? { s5V3: true as const } : {}) },
  });
  assert.equal(run(false, 10).severity, "serious", "v2: den fulde fremskrivning goer ham farlig straks");
  assert.equal(run(true, 10).severity, "none", "v3: tidligt taeller gevinsten mindre");
  assert.equal(run(true, FLAT.distance_km - 10).severity, run(false, FLAT.distance_km - 10).severity, "i finalen ens");
});

// ── Motoren (G6) ─────────────────────────────────────────────────────────────

test("#6804 P6: v3 er deterministisk paa en etape i et etapeloeb med klassement", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
  for (const name of ["flat-massespurt", "bjerg-selektion", "mur-finale"]) {
    const input = JSON.parse(readFileSync(path.join(dir, name, "input.json"), "utf8"));
    const ids: string[] = input.startlist.map((e: { rider_id: string }) => e.rider_id);
    const gcContext = { status: "standings", stage_number: 3, leader_id: ids[0], threat_model: "s5", stages_remaining: 3,
      standings: ids.map((rider_id, i) => ({ rider_id, rank: i + 1, gap_seconds: i * 7 })) };
    const run = (): string => JSON.stringify(simulateStageV4({ ...input, gc_context: gcContext, rules_revision: "s5_profiles_v3" }));
    assert.equal(run(), run(), name);
  }
});
