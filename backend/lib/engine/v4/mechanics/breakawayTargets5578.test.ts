// backend/lib/engine/v4/mechanics/breakawayTargets5578.test.ts
// #5578 (KUN official_times_v2): udbruddet holder hjem efter ejer-maalene.
// Testene laaser strukturen (hvilke knapper der kun laeses under
// official_times_v2, hvem der er en rival, at klassementets forreste aldrig
// slippes), ikke de kalibrerede tal (de staar privat i balance-internals/).
import { test } from "node:test";
import assert from "node:assert/strict";

import { assessGcThreat, V3_DANGER_TUNING, type DangerModel } from "./gcThreat.ts";
import { isLetGoChaseGroup, letGoMaxGapSeconds, rankedFormationPressure } from "./breakaway.ts";
import { DANGEROUS_ATTEMPT_TUNING, resolveMorningBreakFormation, type FormationRider } from "./breakawayPermission.ts";
import { readFileSync } from "node:fs";
import { S5_ONE_DAY_LET_GO_MAX_GAP_SCALE_BY_PROFILE, SHARED_TIME_MODEL_V2_TUNING, TIME_MODEL_V3_TUNING, timeModelTuningFor } from "./timeModel.ts";
import { __resetRaceEngineV4Cache, loadRaceEngineV4 } from "../../../raceEngineV4Bridge.js";
import { breakawaySets, breakawayWin, splitEntrants } from "../../../../scripts/dev/lib/tourScorecard.mjs";
import { BREAKAWAY_EXTRA_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, GcContext, RaceGroup, RouteV2 } from "../types.ts";

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
const abilities = (level: number) => Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>;
const entrant = (id: string, team: string, level: number, role: Entrant["role"] = "helper"): Entrant =>
  ({ rider_id: id, abilities: abilities(level), role, effort: "normal", condition: 1, team_id: team });

const FLAT: RouteV2 = {
  distance_km: 150, profile_type: "flat", finale_type: "bunch_sprint",
  segments: [{ kind: "flat", from_km: 0, to_km: 150 }],
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};

// Klassementet: tolv ryttere taet samlet (som efter en kort enkeltstart).
const IDS = Array.from({ length: 12 }, (_, i) => `r${i + 1}`);
const ENTRANTS: Record<string, Entrant> = Object.fromEntries(IDS.map((id, i) => [id, entrant(id, `T${i + 1}`, i === 0 ? 80 : 70 - i)]));
const GC: GcContext = {
  status: "standings", stage_number: 3, leader_id: "r1", stages_remaining: 15,
  standings: IDS.map((rider_id, i) => ({ rider_id, rank: i + 1, gap_seconds: i * 10 })),
};
const groups = (breakaway: string[], lead: number): RaceGroup[] => [
  { id: "breakaway-0", kind: "breakaway", rider_ids: breakaway, gap_seconds: 0, cohesion: 1 },
  { id: "peloton-0", kind: "peloton", rider_ids: IDS.filter((id) => !breakaway.includes(id)), gap_seconds: lead, cohesion: 1 },
];
const official: DangerModel = { stagesRemaining: 15, tuning: SHARED_TIME_MODEL_V2_TUNING.gcDanger! };
const v3: DangerModel = { stagesRemaining: 15 };
const assess = (protectedRiderId: string, breakaway: string[], lead: number, dangerModel: DangerModel) =>
  assessGcThreat({ gcContext: GC, groups: groups(breakaway, lead), entrants: ENTRANTS, route: FLAT, protectedRiderId, km: 20, ownTeamId: ENTRANTS[protectedRiderId].team_id as string, dangerModel });

test("#5578: knapperne er neutrale uden official_times_v2 (orders_gc_v3 og aeldre er uroerte)", () => {
  assert.equal(TIME_MODEL_V3_TUNING.gcDanger, null);
  assert.deepEqual(TIME_MODEL_V3_TUNING.letGoMaxGapScaleByProfile, {});
  assert.deepEqual(TIME_MODEL_V3_TUNING.letGoFinaleFactorByFinale, {});
  assert.equal(TIME_MODEL_V3_TUNING.letGoMinChaseRiders, null);
  assert.equal(TIME_MODEL_V3_TUNING.letGoCapAtTolerated, false);
  assert.equal(timeModelTuningFor({ ordersGcV3: true }), TIME_MODEL_V3_TUNING, "orders_gc_v3 uden faelles gruppeklokke");
  assert.equal(timeModelTuningFor({ sharedGroupTime: true }), TIME_MODEL_V3_TUNING, "official_times_v1 (klokke uden v3)");
  const tuned = timeModelTuningFor({ ordersGcV3: true, sharedGroupTime: true, route: { profile_type: "hilly" } });
  assert.ok(tuned.gcDanger !== null && tuned.letGoCapAtTolerated === true && tuned.letGoMinChaseRiders !== null);
  assert.ok(tuned.letGoMaxGapScaleByProfile.mountain !== undefined, "profil-tuningen arver de nye knapper");
  // V3_DANGER_TUNING er praecis de vaerdier v3 brugte foer #5578.
  assert.equal(V3_DANGER_TUNING.rivalRankAlways, null);
  assert.equal(V3_DANGER_TUNING.rankedLeadCapSeconds, null);
});

test("#5578: felt-graensen for lad-gaa er en parameter; udeladt = den gamle graense", () => {
  const min = BREAKAWAY_EXTRA_TUNING.letGoMinChaseRiders;
  assert.equal(isLetGoChaseGroup(min), true);
  assert.equal(isLetGoChaseGroup(min - 1), false);
  assert.equal(isLetGoChaseGroup(min - 1, min - 1), true, "official_times_v2: favoritgruppen er stadig et felt");
  assert.equal(isLetGoChaseGroup(Number.NaN, 1), false);
});

test("#5578: finalens faktor kan erstattes; udeladt = tabellen (bit-identisk)", () => {
  const base = { breakawayRiderIds: ["r11"], fieldRiderIds: IDS, entrants: ENTRANTS, profileType: "mountain" as const, finaleType: "descent" as const };
  const table = BREAKAWAY_EXTRA_TUNING.maxGapFinaleFactor.descent as number;
  assert.equal(letGoMaxGapSeconds(base), letGoMaxGapSeconds({ ...base, finaleFactor: table }));
  assert.ok(letGoMaxGapSeconds({ ...base, finaleFactor: table * 2 }) > letGoMaxGapSeconds(base));
});

test("#5578: kun hold med noget at forsvare reagerer; en rytter langt nede reagerer ikke paa en harmloes udbryder", () => {
  // r12 (rang 12) beskytter; r11 (rang 11, svagere end r1, men staerkere end r12) er i udbrud.
  assert.notEqual(assess("r12", ["r11"], 30, v3).reason, "no_gc_interest", "orders_gc_v3: alle inden for forsvars-vinduet forsvarer");
  assert.equal(assess("r12", ["r11"], 30, official).reason, "no_gc_interest");
});

test("#5578: klassementets forreste er altid en rival og holder altid snoren, med et loft", () => {
  // r5 (rang 5) er svagere end foereren r1: under orders_gc_v3 ingen rival (kun forbigaaende).
  const before = assess("r1", ["r5"], 30, v3);
  assert.notEqual(before.leash_hold, true);
  const after = assess("r1", ["r5"], 30, official);
  assert.equal(after.leash_hold, true);
  assert.deepEqual(after.leash_rider_ids, ["r5"]);
  const cap = SHARED_TIME_MODEL_V2_TUNING.gcDanger!.rankedLeadCapSeconds as number;
  assert.ok((after.tolerated_lead_seconds ?? Infinity) <= cap, "snoren er hoejst loftet lang");
});

// ── #5578 robust (ejer 9/10, A): tre felter, ogsaa med ekstra jagt ──────────

// En svag foerer (fx en sprinter i troejen efter flade etaper) og en udbryder
// der er staerkere end ham, men ingen reel klassementsrytter og ikke blandt de forreste.
const WEAK_LEADER: Record<string, Entrant> = { ...ENTRANTS, r1: entrant("r1", "T1", 40, "sprint_captain"), x: entrant("x", "TX", 55) };
const GC_WEAK: GcContext = { ...GC, standings: [...GC.standings, { rider_id: "x", rank: 13, gap_seconds: 120 }] } as GcContext;
const HILLY: RouteV2 = { ...FLAT, profile_type: "hilly", finale_type: "breakaway" };
const assessLeader = (route: RouteV2, dangerModel: DangerModel) => assessGcThreat({
  gcContext: GC_WEAK, entrants: WEAK_LEADER, route, protectedRiderId: "r1", km: 20, ownTeamId: "T1", dangerModel,
  groups: [
    { id: "breakaway-0", kind: "breakaway", rider_ids: ["x"], gap_seconds: 0, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: IDS, gap_seconds: 30, cohesion: 1 },
  ],
});

test("#5578 robust: de nye knapper findes kun under official_times_v2", () => {
  const v3Danger = V3_DANGER_TUNING as Record<string, unknown>;
  for (const key of ["leaderRivalFloorShare", "jerseyAllowanceSeconds", "formationRankedPressureWeight"]) {
    assert.equal(v3Danger[key], undefined, `${key} er neutral i orders_gc_v3`);
    assert.notEqual((SHARED_TIME_MODEL_V2_TUNING.gcDanger as Record<string, unknown>)[key], undefined, `${key} er sat i official_times_v2`);
  }
  assert.deepEqual(rankedFormationPressure(GC, null), {}, "uden knap: ingen ny vaegt (bit-identisk dannelse)");
  assert.deepEqual(rankedFormationPressure(GC, V3_DANGER_TUNING), {});
});

test("#5578 robust: en svag foerer ser ikke enhver staerkere udbryder som en rival", () => {
  const v3Threat = assessLeader(FLAT, v3);
  assert.equal(v3Threat.reason, "leader_at_risk", "orders_gc_v3: staerkere end foereren = rival");
  const officialThreat = assessLeader(FLAT, official);
  assert.equal(officialThreat.reason, "leader_jersey_at_risk", "official_times_v2: kun troejen er i fare");
  assert.equal(officialThreat.severity, "moderate");
  assert.notEqual(officialThreat.leash_hold, true);
});

test("#5578 robust: troejens tolerance er et loft pr. profil, ikke en aaben dor", () => {
  const allowance = SHARED_TIME_MODEL_V2_TUNING.gcDanger!.jerseyAllowanceSeconds!;
  assert.equal(allowance.flat, undefined, "flad: snorens almindelige laengde");
  assert.ok((allowance.hilly ?? 0) > 0);
  const flat = assessLeader(FLAT, official).tolerated_lead_seconds ?? 0;
  const hilly = assessLeader(HILLY, official).tolerated_lead_seconds ?? 0;
  assert.ok(hilly > flat, "kuperet: foererens hold lader udbruddet tage troejen");
  assert.ok(Number.isFinite(hilly) && hilly <= 120 + (allowance.hilly as number), "men kun med et begraenset forspring");
});

test("#5578 robust: klassementets forreste moeder den haardeste modstand ved dannelsen", () => {
  const danger = SHARED_TIME_MODEL_V2_TUNING.gcDanger!;
  const { dangerPressureWeight } = rankedFormationPressure(GC, danger);
  assert.ok(dangerPressureWeight);
  assert.equal(dangerPressureWeight("r10"), danger.formationRankedPressureWeight, "rang 10 er blandt de forreste");
  assert.equal(dangerPressureWeight("r11"), DANGEROUS_ATTEMPT_TUNING.pressureWeight, "rang 11 som under orders_gc_v3");
  assert.ok((danger.formationRankedPressureWeight as number) > DANGEROUS_ATTEMPT_TUNING.pressureWeight);

  // Vaegten pr. rytter bruges af dannelsen; udeladt = den gamle vaegt (bit-identisk).
  const riders: FormationRider[] = ["A", "B", "C", "D"].flatMap((team) => Array.from({ length: 5 }, (_, i) => ({
    rider_id: `${team}${i}`, team_id: team, role: i === 0 ? "captain" : "helper", effort: "normal",
    tryBreak: `${team}${i}` === "C1" ? true : undefined, strength: 0.6, spontaneousChance: 0, engine: 0.5, freshness: 1,
  })));
  const base = { riders, stances: new Map([["A", "neutral" as const], ["B", "neutral" as const], ["C", "neutral" as const], ["D", "neutral" as const]]), maxSize: 8,
    roll: (stream: "attempt" | "success") => (stream === "attempt" ? 0 : 0.2), dangerTeams: (id: string) => (id === "C1" ? ["A", "B", "D"] : []) };
  const old = resolveMorningBreakFormation(base);
  assert.deepEqual(resolveMorningBreakFormation({ ...base, dangerPressureWeight: () => DANGEROUS_ATTEMPT_TUNING.pressureWeight }), old);
  assert.ok(old.escaped.includes("C1"), "med den gamle vaegt kommer han afsted paa dette rul");
  assert.equal(resolveMorningBreakFormation({ ...base, dangerPressureWeight: () => danger.formationRankedPressureWeight as number }).escaped.includes("C1"), false);
});

test("#5578: uden for de forreste er kun en mindst lige saa staerk rytter en rival", () => {
  // r10 (rang 10) beskytter; r12 er ikke blandt de forreste og er svagere end r10.
  const weaker = assess("r10", ["r12"], 30, official);
  assert.notEqual(weaker.leash_hold, true);
  assert.notEqual(weaker.severity, "serious");
});

// ── #6369 (KUN s5_profiles_v1, endagsloeb): bjerg-bucket'ens lad-gaa-loft ────────
// Bjergets loft er kalibreret paa etapeloeb, hvor klassementsholdene lofter udbruddet.
// I et endagsloeb paa en bjergprofil var der intet loft, og morgenudbruddet koerte
// hjem med et forspring ingen jagt kunne hente. Under S5 har endagsloebet sit eget
// loft paa bjerg-bucket'en; etapeloeb og alle aeldre revisioner er uroerte
// (oldRevisionDigests6199 m.fl. laaser de aeldre). Tallene: balance-internals/6367/.

test("#6369: endags-loftet findes kun for bjerg-bucket'en og kan kun goere loftet mindre", () => {
  assert.ok(Object.isFrozen(S5_ONE_DAY_LET_GO_MAX_GAP_SCALE_BY_PROFILE));
  assert.deepEqual(Object.keys(S5_ONE_DAY_LET_GO_MAX_GAP_SCALE_BY_PROFILE), ["mountain"]);
  const scale = S5_ONE_DAY_LET_GO_MAX_GAP_SCALE_BY_PROFILE.mountain as number;
  assert.ok(scale > 0 && scale < 1, "et loft, aldrig et loeft");
});

// Et endagsloeb paa en bjergprofil: to kat. 1-stigninger, topankomst.
const ONE_DAY_MOUNTAIN = {
  race_id: "race-6369-one-day", stage_number: 1, profile_type: "mountain", finale_type: "long_climb", distance_km: 160,
  climbs: [
    { category: "1", crest_km: 96, length_km: 11.1, avg_gradient: 6.5, summit_finish: false },
    { category: "1", crest_km: 160, length_km: 12.2, avg_gradient: 7.5, summit_finish: true },
  ],
  sprints: [{ km: 160, kind: "finish", name: "Finish" }],
  sectors: [],
  segments: [
    { kind: "rolling", from_km: 0, to_km: 84.9 },
    { kind: "climb", from_km: 84.9, to_km: 96, category: "1", avg_gradient: 6.5, top_elevation_m: 971 },
    { kind: "descent", from_km: 96, to_km: 110, technicality: 2 },
    { kind: "rolling", from_km: 110, to_km: 147.8 },
    { kind: "climb", from_km: 147.8, to_km: 160, category: "1", avg_gradient: 7.5, top_elevation_m: 1886 },
  ],
  weather: { kind: "sun", wind_exposure: 0.37 },
};

test("#6369: S5-endagsloeb paa bjerg - udbruddet koerer ikke laengere hjem med et uindhenteligt forspring", async () => {
  const raw = JSON.parse(readFileSync(new URL("../../../../scripts/baselines/giro-field-6088-2026-10-02.json", import.meta.url), "utf8"));
  const field = { ...raw, orders: [], teams: raw.teams.map((t: Record<string, unknown>) => ({ ...t, is_ai: true })) };
  __resetRaceEngineV4Cache();
  const v4 = await loadRaceEngineV4();
  const data = { ...field, race: { ...field.race, id: ONE_DAY_MOUNTAIN.race_id, stages: 1 }, profiles: [ONE_DAY_MOUNTAIN] };
  const SEEDS = 6;
  const run = (revision: string) => Array.from({ length: SEEDS }, (_, i) => {
    const res = v4.simulateStage({
      entrants: splitEntrants(data).entrants, stageProfile: ONE_DAY_MOUNTAIN, seedString: `${ONE_DAY_MOUNTAIN.race_id}:1:t${i + 1}`,
      stageNumber: 1, teamOrderRows: [], isStageRace: false, raceStages: [ONE_DAY_MOUNTAIN], squad: null, rulesRevision: revision, gcStandings: null,
    });
    const out = res.v4Output;
    const fin = (out.results ?? []).filter((r: { status: string }) => r.status === "finished")
      .sort((a: { time_seconds: number }, b: { time_seconds: number }) => a.time_seconds - b.time_seconds);
    const { formed } = breakawaySets(out);
    const firstOutside = fin.find((r: { rider_id: string }) => !formed.has(r.rider_id));
    return { won: breakawayWin(out).won as boolean, margin: firstOutside ? firstOutside.time_seconds - fin[0].time_seconds : 0 };
  });
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
  const old = run("official_times_v4");
  const s5 = run("s5_profiles_v1");
  // Fejlen (uaendret under official_times_v4): udbruddet vinder hver gang, langt foran.
  assert.equal(old.filter((r) => r.won).length, SEEDS, "official_times_v4 er uroert: udbruddet vinder hvert seed");
  // S5: forspringet er en broekdel af det gamle, og udbruddet vinder ikke hver gang.
  assert.ok(median(s5.map((r) => r.margin)) * 4 < median(old.map((r) => r.margin)), `S5 ${median(s5.map((r) => r.margin))} s mod v4 ${median(old.map((r) => r.margin))} s`);
  assert.ok(s5.filter((r) => r.won).length < SEEDS, "S5: udbruddet vinder ikke hvert seed");
});
