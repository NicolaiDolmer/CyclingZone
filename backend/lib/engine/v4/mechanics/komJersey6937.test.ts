// backend/lib/engine/v4/mechanics/komJersey6937.test.ts
// #6937 G16 (KUN s5_profiles_v3): B1 bjergjaegeren og B2 strammet.
//  - B1: bjergkonkurrencens forreste (ikke kaptajner) kaemper om hver top undervejs i enhver
//    gruppe og tager pointene foran gruppens oevrige kaempere; et AI-hold der ikke jager,
//    sender sin jaeger i udbrud paa en dag med bjergpoint undervejs.
//  - B2 strammet: kaptajnerne ruller over i enhver gruppe uden for dagens udbrud, ogsaa som
//    troejefoerer, og passerer bag gruppens oevrige ryttere.
// Uden flagene (v1/v2) er passage-raekkefoelgen, AI-ordren og broens input uaendrede.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildFinishPassages, computePassageOrder, KOM_FAVOURITE_ROLL_OVER_ROLES, komPointScale, passagesHook } from "./bonusSeconds.ts";
import { aiKomHunterForBreak, komHunterSet, summitFinishSingleFor } from "./komJersey6937.ts";
import { simulateStageV4 } from "../index.ts";
import { generateAiTeamOrder } from "../ai/aiTactics.ts";
import { jerseyLeadersFromComps } from "../../../raceClassifications.js";
import { boundRngFor } from "../rng.ts";
import { BONUS_SECONDS_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, EngineState, FinaleType, RaceGroup, RiderRole, RiderState, RouteV2, SegmentHookContext, StageInput, StageResult, Waypoint } from "../types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(climbing: number): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = 50;
  out.climbing = climbing;
  out.endurance = climbing;
  return out;
}

const entrant = (id: string, climbing: number, role: RiderRole): Entrant => ({ rider_id: id, abilities: abilities(climbing), role, effort: "normal", condition: 1 });
const riderState = (id: string, groupId: string): RiderState => ({
  rider_id: id, group_id: groupId, cp: 0.5, wprimeMax: 1, wprime: 1, dayform: 0,
  seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0,
} as RiderState);

/** Et stort felt (over det aabne loft) med to kaptajner, hjaelpere og en jaeger, og et lille udbrud foran. */
function pelotonScene() {
  const ids: Array<[string, number, RiderRole]> = [
    ["capA", 95, "captain"], ["capB", 90, "captain"], ["hunt", 60, "helper"],
    ...Array.from({ length: 9 }, (_, i) => [`h${i}`, 70 + i, "helper"] as [string, number, RiderRole]),
    ["brk1", 65, "helper"], ["brk2", 80, "helper"],
  ];
  const entrants: Record<string, Entrant> = Object.fromEntries(ids.map(([id, c, r]) => [id, entrant(id, c, r)]));
  const pel = ids.map(([id]) => id).filter((id) => !id.startsWith("brk"));
  const groups: RaceGroup[] = [
    { id: "brk", kind: "breakaway", origin: "breakaway", rider_ids: ["brk1", "brk2"], gap_seconds: 0, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: pel, gap_seconds: 120, cohesion: 1 },
  ];
  const riders = Object.fromEntries(ids.map(([id]) => [id, riderState(id, id.startsWith("brk") ? "brk" : "peloton-0")]));
  return { entrants, state: { km: 100, groups, riders, virtual_gc: {} } as EngineState };
}

const KOM_CONTEST = {
  contenderRoles: BONUS_SECONDS_EXTRA_TUNING.komContenderRoles,
  openContestMaxGroupSize: BONUS_SECONDS_EXTRA_TUNING.passageOpenContestMaxGroupSize,
};
const order = (scene: ReturnType<typeof pelotonScene>, contest: Record<string, unknown>) => computePassageOrder(scene.state, scene.entrants, boundRngFor("6937-b1"), {
  stream: "passage:kom:0",
  qualityWeights: BONUS_SECONDS_EXTRA_TUNING.komQualityWeightsBig,
  noiseSd: 0.0001,
  contest: { ...KOM_CONTEST, ...contest } as Parameters<typeof computePassageOrder>[3]["contest"],
});

test("#6937 B1: bjergjaegerne er kun ikke-kaptajner, der er med i dagens felt", () => {
  const scene = pelotonScene();
  const set = komHunterSet({ kom: "capA", kom_hunters: ["capA", "hunt", "ghost", "brk2"] }, scene.entrants);
  assert.deepEqual([...set].sort(), ["brk2", "hunt"]);
  assert.equal(komHunterSet(null, scene.entrants).size, 0);
});

test("#6937 B1: jaegeren kaemper i feltet og tager toppen foran gruppens oevrige; udbruddet er stadig foran", () => {
  const scene = pelotonScene();
  const without = order(scene, {});
  const withHunter = order(scene, { komHunterIds: new Set(["hunt", "brk1"]) });
  assert.deepEqual(without.slice(0, 2), ["brk2", "brk1"], "udbruddet foerst, paa evne");
  assert.deepEqual(withHunter.slice(0, 3), ["brk1", "brk2", "hunt"], "jaegeren i udbruddet tager toppen; jaegeren i feltet er feltets foerste");
  assert.notEqual(without[2], "hunt", "uden jaegerrollen ruller han igennem paa evne");
});

test("#6937 B2 strammet: kaptajnerne passerer bag feltets oevrige ryttere og forsvarer ikke troejen undervejs", () => {
  const scene = pelotonScene();
  const old = order(scene, { smallGroupRollOverRoles: KOM_FAVOURITE_ROLL_OVER_ROLES, jerseyLeaderId: "capA" });
  assert.equal(old[2], "capA", "#7155: troejefoereren kaemper i feltet");
  const strict = order(scene, { smallGroupRollOverRoles: KOM_FAVOURITE_ROLL_OVER_ROLES, jerseyLeaderId: "capA", rollOverBehindGroup: true });
  assert.deepEqual(new Set(strict.slice(-2)), new Set(["capA", "capB"]), "kaptajnerne passerer sidst i feltet");
  // En kaptajn i dagens udbrud kaemper stadig.
  const capInBreak = pelotonScene();
  capInBreak.state.groups[0].rider_ids.push("capB");
  capInBreak.state.groups[1].rider_ids = capInBreak.state.groups[1].rider_ids.filter((id) => id !== "capB");
  assert.equal(order(capInBreak, { smallGroupRollOverRoles: KOM_FAVOURITE_ROLL_OVER_ROLES, rollOverBehindGroup: true })[0], "capB");
});

test("#6937: uden de nye felter er raekkefoelgen praecis #7155's (bit-identisk)", () => {
  const scene = pelotonScene();
  const base = { smallGroupRollOverRoles: KOM_FAVOURITE_ROLL_OVER_ROLES, jerseyLeaderId: "capB" };
  assert.deepEqual(order(scene, { ...base, komHunterIds: new Set(), rollOverBehindGroup: false }), order(scene, base));
});

// ── passagesHook: kun under v3-flaget ─────────────────────────────────────────

function hookWinner(s5ProfilesV3: boolean) {
  const scene = pelotonScene();
  const route = {
    distance_km: 150, profile_type: "mountain", finale_type: "long_climb",
    segments: [{ kind: "climb", from_km: 90, to_km: 110 }], weather: { kind: "sun", wind_exposure: 0.1 },
    waypoints: [{ kind: "kom", index: 0, name: "Top", km: 100, category: "HC", summit_finish: false } as Waypoint],
  } as RouteV2;
  const ctx: SegmentHookContext = {
    segment: route.segments[0], segmentIndex: 0, route, entrants: scene.entrants, tuning: RACE_V4_TUNING,
    rngFor: boundRngFor("6937-b1-hook"), rngForStage: boundRngFor("6937-b1-hook"), orders: [],
    jerseyLeaders: { kom: "capA", kom_hunters: ["hunt"] },
    ...(s5ProfilesV3 ? { s5ProfilesV3: true as const } : {}),
  };
  const kom = (passagesHook(scene.state, ctx).state.stage_passages ?? []).find((p) => p.kind === "kom");
  return kom?.results.map((r) => r.rider_id) ?? [];
}

test("#6937 B1: hooket bruger jaegerne kun under v3; uden flaget er jaegerlisten uden virkning", () => {
  const v3 = hookWinner(true);
  assert.equal(v3[2], "hunt");
  const v2 = hookWinner(false);
  assert.notEqual(v2[2], "hunt");
  assert.equal(v2[2], "capA", "uden v3 forsvarer troejefoereren som foer");
});

// ── AI: jaegeren i udbrud ────────────────────────────────────────────────────

test("#6937 B1: et AI-hold sender sin jaeger paa en bjergdag i et etapeloeb; aldrig en kaptajn, aldrig blokeret", () => {
  const roster = [{ rider_id: "cap", role: "captain" }, { rider_id: "hunt", role: "helper" }, { rider_id: "h2", role: "helper" }];
  const base = { profileType: "mountain", isStageRace: true, roster, noBreakIds: new Set<string>() };
  assert.equal(aiKomHunterForBreak({ ...base, komHunterIds: ["other", "cap", "hunt"] }), "hunt");
  assert.equal(aiKomHunterForBreak({ ...base, komHunterIds: ["hunt"], noBreakIds: new Set(["hunt"]) }), null);
  assert.equal(aiKomHunterForBreak({ ...base, komHunterIds: ["hunt"], profileType: "flat" }), null);
  assert.equal(aiKomHunterForBreak({ ...base, komHunterIds: ["hunt"], isStageRace: false }), null);
  assert.equal(aiKomHunterForBreak({ ...base, komHunterIds: null }), null);
});

test("#6937 B1: AI-ordren faar jaegerens udbrudsforsoeg kun under s5_profiles_v3", () => {
  const roster = ["cap", "hunt", "h2", "h3"].map((id, i) => ({ rider_id: id, role: (i === 0 ? "captain" : "helper") as RiderRole, abilities: abilities(i === 0 ? 40 : 30) }));
  const field = [...roster, ...Array.from({ length: 20 }, (_, i) => ({ rider_id: `f${i}`, role: "captain" as RiderRole, abilities: abilities(90) }))];
  const input = (rev: string) => ({
    team_id: "t", route: { profile_type: "mountain" as const, finale_type: "long_climb" as const }, roster, field,
    race: { is_stage_race: true, later_stages: [] }, rules_revision: rev, kom_hunter_rider_ids: ["hunt"],
  });
  const tryBreak = (rev: string) => generateAiTeamOrder(input(rev)).order.riders.find((r) => r.rider_id === "hunt")?.try_break;
  assert.equal(tryBreak("s5_profiles_v3"), true);
  assert.equal(tryBreak("s5_profiles_v2"), false);
});

test("#6937 B1: runneren giver bjergkonkurrencens forreste med point kun naar kalderen beder om det", () => {
  const entrants = [{ rider_id: "a" }, { rider_id: "b" }, { rider_id: "c" }, { rider_id: "d" }];
  const kom = new Map([["a", 5], ["b", 12], ["c", 0]]);
  assert.deepEqual(jerseyLeadersFromComps(entrants, new Map(), kom), { points: null, kom: "b" }, "uden valget: uaendret form (checksum)");
  assert.deepEqual(jerseyLeadersFromComps(entrants, new Map(), kom, { komHunters: 5 }).komHunters, ["b", "a"]);
});

// ── Topankomsten: almindelige point (ejer 25/10) ─────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): StageInput =>
  JSON.parse(readFileSync(path.join(HERE, "..", "fixtures", name, "input.json"), "utf8")) as StageInput;
const finished = (id: string, rank: number): StageResult => ({ rider_id: id, rank, time_seconds: rank, group_id: "peloton-0", status: "finished" });
const summitKomPoints = (out: { passages?: readonly { kind: string; km: number; results: readonly { points: number }[] }[] }, km: number) =>
  out.passages?.find((p) => p.kind === "kom" && p.km === km)?.results.map((r) => r.points).filter((p) => p > 0);

test("#6937: topankomsten giver stigningens almindelige point kun under s5_profiles_v3", () => {
  assert.deepEqual(summitFinishSingleFor("s5_profiles_v3"), { summitFinishSingle: true });
  for (const rev of ["s5_profiles_v2", "s5_profiles_v1", "official_times_v5", "legacy", undefined]) {
    assert.deepEqual(summitFinishSingleFor(rev), {}, `${String(rev)}: uaendret (dobbelt)`);
  }
  const args = {
    results: ["a", "b", "c"].map((id, i) => finished(id, i + 1)),
    waypoints: [{ kind: "kom", index: 0, name: "Top", km: 180, category: "HC", summit_finish: true }, { kind: "finish", index: 1, name: "Maal", km: 180 }] as Waypoint[],
    distanceKm: 180,
    profileType: "high_mountain",
    finaleType: "long_climb" as FinaleType,
    tuning: RACE_V4_TUNING.bonusSeconds,
  };
  const pts = (p: ReturnType<typeof buildFinishPassages>) => p.find((x) => x.kind === "kom")?.results.map((r) => r.points);
  assert.deepEqual(pts(buildFinishPassages(args)), komPointScale("HC", true).slice(0, 3), "udeladt: dobbelt som foer");
  assert.deepEqual(pts(buildFinishPassages({ ...args, summitFinishSingle: true })), komPointScale("HC", false).slice(0, 3));
  assert.notDeepEqual(komPointScale("HC", true), komPointScale("HC", false), "skalaen er stadig dobbelt for aeldre revisioner");
});

test("#6937: vejetapen og enkeltstarten giver almindelige topankomst-point under v3, dobbelt under v2", () => {
  const road = fixture("bjerg-selektion");
  const roadSummitKm = road.route.distance_km;
  road.route.waypoints = [
    ...road.route.waypoints.filter((w) => w.kind !== "finish"),
    { kind: "kom", index: 1, name: "Topankomst", km: roadSummitKm, category: "1", summit_finish: true },
    { kind: "finish", index: 2, name: "Bjergmaal", km: roadSummitKm, summit_finish: true },
  ] as Waypoint[];
  const itt = fixture("itt-solo");
  const ittKm = itt.route.distance_km;
  itt.route.waypoints = [
    { kind: "kom", index: 0, name: "Topankomst", km: ittKm, category: "1", summit_finish: true },
    { kind: "finish", index: 1, name: "Maal", km: ittKm, summit_finish: true },
  ] as Waypoint[];
  for (const [input, km] of [[road, roadSummitKm], [itt, ittKm]] as const) {
    const v2 = summitKomPoints(simulateStageV4({ ...input, rules_revision: "s5_profiles_v2" }), km);
    const v3 = summitKomPoints(simulateStageV4({ ...input, rules_revision: "s5_profiles_v3" }), km);
    assert.ok(v2 && v2.length > 0 && v3 && v3.length > 0, "topankomsten skal give en kom-passage");
    assert.deepEqual(v2, komPointScale("1", true).slice(0, v2.length), "v2: dobbelt (uaendret)");
    assert.deepEqual(v3, komPointScale("1", false).slice(0, v3.length), "v3: stigningens almindelige point");
  }
});
