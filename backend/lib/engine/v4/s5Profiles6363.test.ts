// backend/lib/engine/v4/s5Profiles6363.test.ts
// #6363 (Spor 2, epic #6369): S5-motoren bag s5_profiles_v1 (SLUKKET).
//   1. Alle eksisterende revisioner er byte-identiske (digests skrevet fra koden FOER
//      aendringen, test-data/s5UntouchedDigests6363.json; legacy..official_times_v1
//      daekkes af oldRevisionDigests6199.test.ts).
//   2. S5-ordforraadet under en aeldre revision koerer som den gamle finale/type det afloeser.
//   3. S5-finalerne: grundsaet + hybrid, ingen klatring i muren, egen tids-spredning.
//   4. Det sene soloangreb (#6368) er motoradfaerd og kun under s5_profiles_v1.
//   5. De tre S5-fixtures (mur, stigende spurt, mellembjerg) er bit-identiske og
//      fortaeller det scenariet beskriver.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { simulateStageV4 } from "./index.ts";
import { frozenDigests } from "./testUtils/oldRevisionDigests6199.ts";
import {
  hybridDurabilityShare,
  isS5ExplosiveFinaleClimb,
  priorCategorizedClimbs,
  routeForRulesRevision,
  s5FinaleDemandVector,
} from "./s5Profiles.ts";
import { lateAttack, lateAttackChance, lateAttackScore, lateAttackSegmentIndex } from "./mechanics/lateAttack.ts";
import { S5_PROFILES_TUNING } from "./tuning.ts";
import { routeFromStageProfileRow } from "./adapters/routeAdapter.ts";
import type { AbilityKey, EngineState, Entrant, RouteV2, Segment, StageInput, StageOutput } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const loadFixture = (name: string) => ({
  input: JSON.parse(readFileSync(path.join(here, "fixtures", name, "input.json"), "utf8")) as StageInput,
  expected: JSON.parse(readFileSync(path.join(here, "fixtures", name, "expected.json"), "utf8")) as StageOutput,
});

const climb = (from_km: number, to_km: number, category: "HC" | "1" | "2" | "3" | "4", avg_gradient: number): Segment =>
  ({ kind: "climb", from_km, to_km, category, avg_gradient, top_elevation_m: 400 });

function route(over: Partial<RouteV2>): RouteV2 {
  return {
    distance_km: 160, profile_type: "hilly", finale_type: "wall_finish",
    segments: [{ kind: "flat", from_km: 0, to_km: 100 }, { kind: "rolling", from_km: 100, to_km: 158.8 }, climb(158.8, 160, "3", 12)],
    weather: { kind: "sun", wind_exposure: 0.2 }, waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 160 }],
    ...over,
  };
}

// ── 1. Byte-identitet for alle eksisterende revisioner ─────────────────────────
test("#6363: official_times_v2/v3/v4 har praecis samme output som foer S5-motoren (digests fra main)", () => {
  const baseline = JSON.parse(readFileSync(path.join(here, "test-data", "s5UntouchedDigests6363.json"), "utf8")) as Record<string, Record<string, string>>;
  const revisions = Object.keys(baseline);
  assert.deepEqual(revisions, ["official_times_v2", "official_times_v3", "official_times_v4"]);
  const actual = frozenDigests(revisions);
  for (const revision of revisions) {
    assert.ok(Object.keys(baseline[revision]).length >= 20, `${revision}: baseline daekker alle profiler`);
    assert.deepEqual(actual[revision], baseline[revision], revision);
  }
});

test("#6363: en rute uden S5-ord er SAMME objekt under alle aeldre revisioner", () => {
  for (const revision of [undefined, "legacy", "orders_gc_v3", "official_times_v4"]) {
    for (const finale of ["bunch_sprint", "reduced_sprint", "punch", "breakaway", "descent", "long_climb", null] as const) {
      const r = route({ finale_type: finale });
      assert.equal(routeForRulesRevision(r, revision), r, `${String(revision)} / ${String(finale)}`);
    }
  }
});

// ── 2. S5-ord under en aeldre revision ─────────────────────────────────────────
test("#6363: under official_times_v4 koerer de nye finaler som den gamle finale de afloeser", () => {
  const cases = [["flat_sprint", "bunch_sprint"], ["uphill_sprint", "reduced_sprint"], ["wall_finish", "punch"]] as const;
  for (const [s5, legacy] of cases) {
    assert.equal(routeForRulesRevision(route({ finale_type: s5 }), "official_times_v4").finale_type, legacy);
    assert.equal(routeForRulesRevision(route({ finale_type: s5 }), "s5_profiles_v1").finale_type, s5);
  }
  // Hele etapen: S5-fixturen under v4 = samme fixture skrevet med de gamle ord.
  const { input } = loadFixture("mur-finale");
  const v4 = { ...input, rules_revision: "official_times_v4" } as StageInput;
  const legacyWords = { ...v4, route: { ...v4.route, finale_type: "punch" } } as StageInput;
  assert.deepEqual(simulateStageV4(v4), simulateStageV4(legacyWords));
});

test("#6363: mellembjerg koerer i motorens terraen-bucket (kuperet, bjerg ved topankomst), i alle revisioner", () => {
  for (const revision of ["official_times_v4", "s5_profiles_v1"]) {
    assert.equal(routeForRulesRevision(route({ profile_type: "medium_mountain", finale_type: "punch" }), revision).profile_type, S5_PROFILES_TUNING.mediumMountainBucket);
    assert.equal(routeForRulesRevision(route({ profile_type: "medium_mountain", finale_type: "long_climb" }), revision).profile_type, S5_PROFILES_TUNING.mediumMountainSummitBucket);
  }
  // routeAdapter kender typen (foer faldt den til "flat").
  const row = { race_id: "r", stage_number: 1, profile_type: "medium_mountain", finale_type: "punch", distance_km: 150, climbs: [{ name: "A", crest_km: 80, category: "2", length_km: 7, avg_gradient: 6 }] };
  assert.equal(routeFromStageProfileRow(row).profile_type, "medium_mountain");
});

test("#6363: under s5_profiles_v1 er udbrud ikke en finale - en breakaway-finale bliver terraenets egen", () => {
  assert.equal(routeForRulesRevision(route({ finale_type: "breakaway", profile_type: "flat" }), "s5_profiles_v1").finale_type, "flat_sprint");
  assert.equal(routeForRulesRevision(route({ finale_type: "breakaway", profile_type: "hilly" }), "s5_profiles_v1").finale_type, "punch");
  assert.equal(routeForRulesRevision(route({ finale_type: "breakaway", profile_type: "mountain" }), "s5_profiles_v1").finale_type, "long_climb");
  assert.equal(routeForRulesRevision(route({ finale_type: "breakaway" }), "official_times_v4").finale_type, "breakaway");
});

// ── 3. S5-finalerne ────────────────────────────────────────────────────────────
test("#6363: hybriden gaar til punch ved 0-1 tidligere stigninger og glider monotont over i durability", () => {
  let last = -1;
  for (let n = 0; n <= 8; n++) {
    const share = hybridDurabilityShare(n);
    assert.ok(share >= last && share >= 0 && share <= 1, `n=${n}`);
    last = share;
  }
  assert.equal(hybridDurabilityShare(0), 0);
  assert.equal(hybridDurabilityShare(1), 0);
  assert.equal(hybridDurabilityShare(S5_PROFILES_TUNING.hybridDurabilityFullPriorClimbs), 1);
});

test("#6363: mur, bakke og stigende spurt = grundsaet + 20 points hybrid; ingen klatring i muren", () => {
  const sum = (v: Partial<Record<AbilityKey, number>>) => Object.values(v).reduce((a, b) => a + (b ?? 0), 0);
  const easy = route({});
  const gap = (a: number, b: number): Segment => ({ kind: "rolling", from_km: a, to_km: b });
  const hard = route({ segments: [gap(0, 20), climb(20, 25, "3", 6), gap(25, 50), climb(50, 55, "3", 6), gap(55, 80), climb(80, 85, "3", 6), gap(85, 110), climb(110, 115, "3", 6), gap(115, 158.8), climb(158.8, 160, "3", 12)] });
  assert.equal(priorCategorizedClimbs(easy), 0);
  assert.equal(priorCategorizedClimbs(hard), 4);
  for (const finale of ["wall_finish", "punch", "uphill_sprint"] as const) {
    for (const r of [easy, hard]) {
      const v = s5FinaleDemandVector({ ...r, finale_type: finale });
      assert.ok(v, finale);
      assert.ok(Math.abs(sum(v!) - 1) < 1e-9, `${finale}: vaegtene summer til 1`);
      assert.ok(Object.values(v!).every((w) => (w ?? 0) >= 0), `${finale}: ingen negative vaegte (monotoni)`);
      if (finale === "wall_finish") assert.equal(v!.climbing, undefined, "klatring indgaar ikke i mur-finalen");
    }
    assert.equal(s5FinaleDemandVector({ ...easy, finale_type: finale })!.durability, undefined, `${finale}: let etape -> hybriden er punch`);
    assert.ok(Math.abs((s5FinaleDemandVector({ ...hard, finale_type: finale })!.durability ?? 0) - S5_PROFILES_TUNING.hybridWeight) < 1e-9, `${finale}: haard etape -> hybriden er durability`);
  }
  assert.equal(s5FinaleDemandVector({ ...easy, finale_type: "long_climb" }), null, "bjergtop er uaendret");
  assert.equal(s5FinaleDemandVector({ ...easy, finale_type: "flat_sprint" }), null, "flad spurt er uaendret");
});

test("#6363: finalestigningen paa en kort eksplosiv afslutning afgoeres af finalen, ikke klatre-selektionen", () => {
  const r = route({});
  assert.equal(isS5ExplosiveFinaleClimb(r, 2), true);
  assert.equal(isS5ExplosiveFinaleClimb(r, 1), false);
  assert.equal(isS5ExplosiveFinaleClimb({ ...r, finale_type: "long_climb" }, 2), false, "bjergtoppen beholder selektionen");
  // CodeRabbit: en lang sammenhaengende stigning foer selve afslutningen beholder selektionen.
  const block = route({ segments: [{ kind: "flat", from_km: 0, to_km: 150 }, climb(150, 156, "2", 6), climb(156, 160, "3", 8)] });
  assert.equal(isS5ExplosiveFinaleClimb(block, 1), false);
  assert.equal(isS5ExplosiveFinaleClimb(block, 2), true);
  // ... og en delt finalestigning taeller ikke som tidligere stigninger.
  assert.equal(priorCategorizedClimbs(block), 0);
  const split = route({ segments: [climb(20, 24, "3", 6), climb(24, 27, "3", 6), { kind: "flat", from_km: 27, to_km: 158.8 }, climb(158.8, 160, "3", 12)] });
  assert.equal(priorCategorizedClimbs(split), 1, "én stigning delt i to segmenter er én stigning");
});

test("#6363: et mellembjerg maerket breakaway der ender paa en kat. 2-top er en bjergtop under S5", () => {
  const summit = route({ profile_type: "medium_mountain", finale_type: "breakaway", segments: [{ kind: "flat", from_km: 0, to_km: 150 }, climb(150, 160, "2", 6)] });
  const mapped = routeForRulesRevision(summit, "s5_profiles_v1");
  assert.equal(mapped.finale_type, "long_climb");
  assert.equal(mapped.profile_type, S5_PROFILES_TUNING.mediumMountainSummitBucket);
  assert.equal(routeForRulesRevision({ ...summit, segments: [{ kind: "flat", from_km: 0, to_km: 158 }, climb(158, 160, "3", 6)] }, "s5_profiles_v1").finale_type, "punch");
});

test("#6363 fixture mur-finale: puncheuren vinder, den bedste klatrer er ikke med i finalen, reelle tidsgab", () => {
  const { input, expected } = loadFixture("mur-finale");
  const actual = simulateStageV4(input);
  assert.deepEqual(actual, expected, "bit-identitet");
  assert.equal(actual.results[0].rider_id, "r01");
  const climber = actual.results.find((r) => r.rider_id === "r02")!;
  assert.ok(climber.rank > 5, "klatring indgaar ikke i mur-finalen");
  assert.ok(actual.results[9].time_seconds - actual.results[0].time_seconds > 20, "muren spreder top 10");
  const v4 = simulateStageV4({ ...input, rules_revision: "official_times_v4" });
  assert.ok(actual.results[9].time_seconds - actual.results[0].time_seconds > v4.results[9].time_seconds - v4.results[0].time_seconds, "S5 spreder mere end den gamle punch-finale");
});

test("#6363 fixture stigende-spurt: spurteren vinder, de forreste er inden for faa sekunder", () => {
  const { input, expected } = loadFixture("stigende-spurt");
  const actual = simulateStageV4(input);
  assert.deepEqual(actual, expected, "bit-identitet");
  assert.equal(actual.results[0].rider_id, "r03");
  assert.ok(actual.results[4].time_seconds - actual.results[0].time_seconds <= 10, "en stigende spurt er taet");
});

test("#6363 fixture mellembjerg: bakken efter to kat. 2 belonner holdbarhed (hybriden) over ren klatring", () => {
  const { input, expected } = loadFixture("mellembjerg");
  const actual = simulateStageV4(input);
  assert.deepEqual(actual, expected, "bit-identitet");
  const rank = (id: string) => actual.results.find((r) => r.rider_id === id)!.rank;
  assert.ok(rank("r05") < rank("r02"), "den holdbare (r05) slaar den rene klatrer (r02)");
});

// ── 4. Det sene soloangreb (#6368) ─────────────────────────────────────────────
test("#6368: angrebet sker paa det seneste segment der slutter 5-15 km fra maal, aldrig paa bjerg", () => {
  const r = route({ segments: [{ kind: "flat", from_km: 0, to_km: 100 }, { kind: "rolling", from_km: 100, to_km: 150 }, { kind: "flat", from_km: 150, to_km: 158.8 }, climb(158.8, 160, "3", 12)] });
  assert.equal(lateAttackSegmentIndex(r), 1);
  assert.equal(lateAttackSegmentIndex(route({ segments: [{ kind: "flat", from_km: 0, to_km: 160 }] })), -1);
  assert.equal(lateAttackChance({ ...r, profile_type: "mountain", finale_type: "long_climb" }), 0);
  assert.equal(lateAttackChance({ ...r, profile_type: "flat", finale_type: "flat_sprint" }), 0, "flad uden sektorer: massespurt");
  const sectors = { ...r, profile_type: "flat" as const, finale_type: "flat_sprint" as const, segments: [...r.segments.slice(0, 1), { kind: "cobbles" as const, from_km: 100, to_km: 103, sector_name: "S", stars: 4 as const }, ...r.segments.slice(1)] };
  assert.equal(lateAttackChance(sectors), S5_PROFILES_TUNING.lateAttack.chanceWithSectors, "brosten/grus giver angrebet");
  // s5_profiles_v1 laegger en segmentgraense i vinduet; aeldre revisioner roerer ikke segmenterne.
  const long = route({ segments: [{ kind: "flat", from_km: 0, to_km: 100 }, { kind: "rolling", from_km: 100, to_km: 158.8 }, climb(158.8, 160, "3", 12)] });
  assert.equal(lateAttackSegmentIndex(long), -1);
  assert.ok(lateAttackSegmentIndex(routeForRulesRevision(long, "s5_profiles_v1")) >= 0);
  assert.equal(routeForRulesRevision({ ...long, finale_type: "punch" }, "official_times_v4").segments, long.segments);
});

function attackState(attackerBoost: number): { state: EngineState; entrants: Record<string, Entrant> } {
  const keys: AbilityKey[] = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics"];
  const entrants: Record<string, Entrant> = {};
  const riders: EngineState["riders"] = {};
  for (let i = 0; i < 8; i++) {
    const id = `r${i}`;
    const abilities = Object.fromEntries(keys.map((k) => [k, 60])) as Record<AbilityKey, number>;
    if (i === 0) for (const k of ["aggression", "tempo", "endurance", "tactics"] as AbilityKey[]) abilities[k] = 60 + attackerBoost;
    entrants[id] = { rider_id: id, abilities, role: "free_role", effort: "normal", condition: 1, team_id: `t${i}` };
    riders[id] = { status: "racing", wprime: 1, wprimeMax: 1 } as EngineState["riders"][string];
  }
  const state = { groups: [{ id: "peloton-0", kind: "peloton", rider_ids: Object.keys(entrants), gap_seconds: 0, cohesion: 1 }], riders } as unknown as EngineState;
  return { state, entrants };
}

test("#6368: en klart staerkere angriber koerer fra; forspringet vokser monotont med evnen og er clampet", () => {
  const r = route({ segments: [{ kind: "flat", from_km: 0, to_km: 100 }, { kind: "rolling", from_km: 100, to_km: 150 }, { kind: "flat", from_km: 150, to_km: 158.8 }, climb(158.8, 160, "3", 12)] });
  const always = () => () => 0; // lodtraekningen siger altid ja
  let last = -1;
  for (const boost of [0, 2, 5, 10, 20, 35]) {
    const { state, entrants } = attackState(boost);
    const res = lateAttack(state, { route: r, segment: r.segments[1], segmentIndex: 1, entrants, rngForStage: always });
    const gain = res.events.length ? Number(res.events[0].params.gained_seconds) : 0;
    assert.ok(gain >= last, `boost ${boost}: forspringet falder aldrig med evnen`);
    assert.ok(gain <= S5_PROFILES_TUNING.lateAttack.maxGainSeconds);
    if (gain > 0) {
      assert.equal(res.events[0].params.rider_id, "r0");
      assert.equal(res.state.groups.length, 2, "angriberen er sin egen gruppe");
    }
    last = gain;
  }
  assert.equal(lateAttack(attackState(0).state, { route: r, segment: r.segments[1], segmentIndex: 1, entrants: attackState(0).entrants, rngForStage: always }).events.length, 0, "ingen fri angriber i et ligeligt felt");
  assert.ok(last > 0, "en klart staerkere angriber kommer fri");
  assert.ok(lateAttackScore(attackState(10).entrants.r0.abilities, 1, true) > lateAttackScore(attackState(10).entrants.r0.abilities, 1, false), "brostensevnen taeller paa sektorer");
});

test("#6368: det sene angreb findes kun under s5_profiles_v1", () => {
  const { input } = loadFixture("mur-finale");
  const sectorRoute: RouteV2 = { ...input.route, profile_type: "flat", finale_type: "flat_sprint",
    segments: [{ kind: "flat", from_km: 0, to_km: 120 }, ...Array.from({ length: 6 }, (_, i) => [
      { kind: "cobbles", from_km: 120 + i * 6, to_km: 122 + i * 6, sector_name: `S${i}`, stars: 4 },
      { kind: "flat", from_km: 122 + i * 6, to_km: 126 + i * 6 },
    ]).flat() as Segment[], { kind: "flat", from_km: 156, to_km: 160 }] };
  // En klassikerrytter der er klart staerkest paa angrebets evner og paa brosten.
  const startlist = input.startlist.map((e) => e.rider_id !== "r05" ? e
    : { ...e, abilities: { ...e.abilities, aggression: 92, tempo: 90, endurance: 92, tactics: 88, cobblestone: 95 } });
  const lateAttacks = (revision: string) => {
    let n = 0;
    for (let s = 0; s < 12; s++) {
      const out = simulateStageV4({ ...input, startlist, route: sectorRoute, seed: `6368-${s}`, rules_revision: revision } as StageInput);
      n += out.timeline.events.filter((e) => e.type === "finale_attack" && e.params.kind === "late_attack").length;
    }
    return n;
  };
  assert.equal(lateAttacks("official_times_v4"), 0);
  assert.ok(lateAttacks("s5_profiles_v1") > 0);
});
