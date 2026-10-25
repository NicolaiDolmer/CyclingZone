// #7160 (KUN s5_profiles_v3, slukket): favoritholdene lader et ufarligt udbrud gaa paa bjerg.
// Kontrakter, ingen balance-tal (hard rule 17): hvornaar reglen gaelder, hvem der er et
// klassementshold, hvornaar udbruddet er ufarligt, at kun etapeinteressen skaleres (ordrer og
// klassementsreaktioner uroerte, monotoni) og at kaldet er bit-identisk uden reglen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  breakawayHarmlessFor,
  gcRiderGapByTeam,
  s5V3GcTeamInterestScale,
  s5V3MountainLetGoApplies,
  s5V3MountainLetGoInterestScale,
} from "./breakawayInterest7160.ts";
import { computeNetChaseAdvantage, stageWinChaseForceV3 } from "./breakaway.ts";
import { normalizeGcContext } from "./gcThreat.ts";
import { S5_V3_MOUNTAIN_LET_GO_7160_TUNING as T } from "../tuning.ts";
import { simulateStageV4 } from "../index.ts";
import type { AbilityKey, Entrant, GcContext, GcStanding, ProfileType } from "../types.ts";

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
function entrant(id: string, team: string, level: number, role: Entrant["role"] = "helper"): Entrant {
  return { rider_id: id, abilities: Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>, role, effort: "normal", condition: 1, team_id: team };
}

// Hold A og B har en klassementsrytter i toppen; hold C's bedste er langt nede; D har en udbryder.
const ENTRANTS: Record<string, Entrant> = {
  a1: entrant("a1", "A", 80, "captain"), a2: entrant("a2", "A", 62),
  b1: entrant("b1", "B", 78, "captain"), b2: entrant("b2", "B", 60),
  c1: entrant("c1", "C", 70, "captain"), c2: entrant("c2", "C", 58),
  d1: entrant("d1", "D", 66, "hunter"), d2: entrant("d2", "D", 55),
  e1: entrant("e1", "E", 64, "hunter"),
};
const CHASE = ["a1", "a2", "b1", "b2", "c1", "c2", "d2"];

/** Klassement: rang i raekkefoelgen, afstand pr. rytter (sekunder). */
function standings(gaps: Record<string, number>): GcContext {
  const rows: GcStanding[] = Object.entries(gaps)
    .sort(([, x], [, y]) => x - y)
    .map(([rider_id, gap_seconds], i) => ({ rider_id, rank: i + 1, gap_seconds }));
  return normalizeGcContext({ status: "standings", stage_number: 9, leader_id: rows[0].rider_id, standings: rows, threat_model: "s5", stages_remaining: 10 });
}
const FAR = T.harmlessGcGapSeconds * 3;
// a1 foerer, b1 lige efter; c1 er uden for klassementsgraensen; udbryderne langt nede.
function farGaps(extra: Record<string, number> = {}): Record<string, number> {
  const base: Record<string, number> = { a1: 0, b1: 30, a2: 120, b2: 150 };
  // Fyld op saa c1 ligger efter klassementsgraensen.
  for (let i = 0; i < T.gcRiderMaxRank; i++) base[`fill${i}`] = 200 + i;
  return { ...base, c1: 400, c2: 450, d1: FAR, d2: FAR + 10, e1: FAR + 20, ...extra };
}

test("#7160: gaelder kun under v3, paa bjergprofilerne og i et etapeloeb med klassement", () => {
  const gc = standings(farGaps());
  for (const profileType of T.profiles) {
    assert.equal(s5V3MountainLetGoApplies({ s5ProfilesV3: true, profileType, gcContext: gc }), true, profileType);
    assert.equal(s5V3MountainLetGoApplies({ s5ProfilesV3: false, profileType, gcContext: gc }), false);
    assert.equal(s5V3MountainLetGoApplies({ profileType, gcContext: gc }), false, "aeldre revisioner");
    assert.equal(s5V3MountainLetGoApplies({ s5ProfilesV3: true, profileType, gcContext: { status: "first_stage", stage_number: 1 } }), false, "intet klassement endnu");
    assert.equal(s5V3MountainLetGoApplies({ s5ProfilesV3: true, profileType, gcContext: { status: "one_day" } }), false, "endagsloeb");
    assert.equal(s5V3MountainLetGoApplies({ s5ProfilesV3: true, profileType, gcContext: null }), false);
  }
  for (const profileType of ["flat", "rolling", "hilly", "medium_mountain", "itt"] as ProfileType[]) {
    assert.equal(s5V3MountainLetGoApplies({ s5ProfilesV3: true, profileType, gcContext: gc }), false, profileType);
  }
  assert.ok(T.profiles.includes("mountain") && T.profiles.includes("high_mountain"));
  const s = s5V3GcTeamInterestScale();
  assert.ok(s > 0 && s <= 1, "faktoren vaegter ned, aldrig op");
});

test("#7160: klassementshold = holdets bedst placerede rytter i jagtgruppen ligger inden for graensen", () => {
  const gc = standings(farGaps());
  const byTeam = gcRiderGapByTeam({ chaseGroupRiderIds: CHASE, entrants: ENTRANTS, gcContext: gc });
  assert.deepEqual([...byTeam.keys()], ["A", "B"], "C's bedste er uden for graensen, D's er langt nede");
  assert.equal(byTeam.get("A"), 0, "holdets BEDSTE rytter (a1, ikke a2)");
  assert.equal(byTeam.get("B"), 30);
  // Kun jagtgruppens ryttere taeller: uden a1 er A's bedste a2.
  const withoutA1 = gcRiderGapByTeam({ chaseGroupRiderIds: CHASE.filter((id) => id !== "a1"), entrants: ENTRANTS, gcContext: gc });
  assert.equal(withoutA1.get("A"), 120);
  // Deterministisk uanset raekkefoelge.
  assert.deepEqual([...gcRiderGapByTeam({ chaseGroupRiderIds: [...CHASE].reverse(), entrants: ENTRANTS, gcContext: gc })], [...byTeam]);
});

test("#7160: ufarligt kun naar HVER udbryder staar i klassementet og ligger langt nok efter", () => {
  const gc = standings(farGaps());
  assert.equal(breakawayHarmlessFor({ breakawayRiderIds: ["d1", "e1"], gcContext: gc, gcRiderGapSeconds: 0 }), true);
  assert.equal(breakawayHarmlessFor({ breakawayRiderIds: [], gcContext: gc, gcRiderGapSeconds: 0 }), false, "intet udbrud");
  assert.equal(breakawayHarmlessFor({ breakawayRiderIds: ["d1", "ghost"], gcContext: gc, gcRiderGapSeconds: 0 }), false, "mangler i klassementet = farlig");
  assert.equal(breakawayHarmlessFor({ breakawayRiderIds: ["d1", "c1"], gcContext: gc, gcRiderGapSeconds: 0 }), false, "én udbryder taet paa er nok");
  assert.equal(breakawayHarmlessFor({ breakawayRiderIds: ["d1"], gcContext: gc, gcRiderGapSeconds: Number.NaN }), false);
  // Graensen maales fra holdets egen klassementsrytter.
  const edge = standings(farGaps({ d1: 100 + T.harmlessGcGapSeconds }));
  assert.equal(breakawayHarmlessFor({ breakawayRiderIds: ["d1"], gcContext: edge, gcRiderGapSeconds: 100 }), true, "praecis paa graensen er ufarlig");
  assert.equal(breakawayHarmlessFor({ breakawayRiderIds: ["d1"], gcContext: edge, gcRiderGapSeconds: 101 }), false);
});

test("#7160: faktoren pr. hold kun for klassementshold med et ufarligt udbrud; ellers undefined", () => {
  const gc = standings(farGaps());
  const base = { s5ProfilesV3: true, profileType: "mountain" as ProfileType, gcContext: gc, chaseGroupRiderIds: CHASE, entrants: ENTRANTS };
  const scale = s5V3MountainLetGoInterestScale({ ...base, breakawayRiderIds: ["d1", "e1"] });
  assert.deepEqual(scale && [...scale], [["A", s5V3GcTeamInterestScale()], ["B", s5V3GcTeamInterestScale()]]);
  // B's rytter ligger efter A's: et udbrud taet paa B (men langt fra A) skaleres kun for A.
  const nearB = standings(farGaps({ d1: 30 + T.harmlessGcGapSeconds - 1, d2: FAR }));
  const onlyA = s5V3MountainLetGoInterestScale({ ...base, gcContext: nearB, breakawayRiderIds: ["d1"] });
  assert.deepEqual(onlyA && [...onlyA], [["A", s5V3GcTeamInterestScale()]], "ufarligt for A, for taet paa B");
  const closeToLeader = standings(farGaps({ e1: 10 }));
  assert.equal(s5V3MountainLetGoInterestScale({ ...base, gcContext: closeToLeader, breakawayRiderIds: ["d1", "e1"] }), undefined, "farligt udbrud: ingen faktor");
  assert.equal(s5V3MountainLetGoInterestScale({ ...base, s5ProfilesV3: undefined, breakawayRiderIds: ["d1"] }), undefined, "aeldre revisioner");
  assert.equal(s5V3MountainLetGoInterestScale({ ...base, profileType: "hilly", breakawayRiderIds: ["d1"] }), undefined);
  assert.equal(s5V3MountainLetGoInterestScale({ ...base, gcContext: { status: "one_day" }, breakawayRiderIds: ["d1"] }), undefined);
});

test("#7160: kun etapeinteressen skaleres pr. hold; udeladt/tom = bit-identisk; en ordre kan stadig kun oege kraften", () => {
  const input = { chaseGroupRiderIds: CHASE, entrants: ENTRANTS, finaleType: "long_climb" as const, abilityScale: 1, profileType: "mountain" as const, teamSignals: new Map<string, number>() };
  const plain = stageWinChaseForceV3(input);
  const flat = (r: ReturnType<typeof stageWinChaseForceV3>) => ({ ...r, interestByTeam: [...r.interestByTeam] });
  assert.deepEqual(flat(stageWinChaseForceV3({ ...input, teamInterestScale: new Map() })), flat(plain));
  assert.deepEqual(flat(stageWinChaseForceV3({ ...input, teamInterestScale: new Map([["A", 1]]) })), flat(plain), "x1 er eksakt");
  const scaled = stageWinChaseForceV3({ ...input, teamInterestScale: new Map([["A", 0.5]]) });
  assert.ok(Math.abs((scaled.interestByTeam.get("A") ?? 0) - (plain.interestByTeam.get("A") ?? 0) * 0.5) < 1e-12);
  for (const team of ["B", "C", "D"]) assert.equal(scaled.interestByTeam.get(team), plain.interestByTeam.get(team), `${team} uroert`);
  assert.ok(scaled.interest < plain.interest);
  // Holdets ordre er uroert: med en "jag"-ordre er kraften mindst lige saa stor som uden.
  const ordered = stageWinChaseForceV3({ ...input, teamInterestScale: new Map([["A", 0.5]]), teamSignals: new Map([["A", 1]]) });
  assert.ok(ordered.total >= scaled.total);
  // Netto-fordelen: ikke-stigende i faktoren, uaendret uden.
  const adv = (scale?: ReadonlyMap<string, number>) => computeNetChaseAdvantage({
    chaseGroupRiderIds: CHASE, breakawayRiderIds: ["d1", "e1"], entrants: ENTRANTS, finaleType: "long_climb", remainingKmFraction: 0.5, stance: 0,
    officialTimesV3: { profileType: "mountain", teamSignals: new Map(), ...(scale ? { teamInterestScale: scale } : {}) },
  });
  assert.equal(adv(new Map()), adv());
  assert.ok(adv(new Map([["A", 0.5], ["B", 0.5]])) < adv());
  assert.ok(adv(new Map([["A", 0.25], ["B", 0.25]])) <= adv(new Map([["A", 0.5], ["B", 0.5]])));
});

test("#7160: v3 paa en bjergetape i et etapeloeb med klassement er deterministisk, og v2 laeser intet herfra", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "bjerg-selektion");
  const input = JSON.parse(readFileSync(path.join(dir, "input.json"), "utf8"));
  const teams = ["A", "B", "C", "D", "E"];
  const startlist = input.startlist.map((e: Entrant, i: number) => ({ ...e, team_id: teams[i % teams.length] }));
  const gaps = Object.fromEntries(startlist.map((e: Entrant, i: number) => [e.rider_id, i * 90]));
  const gc_context = standings(gaps);
  const run = (rev: string): string => JSON.stringify(simulateStageV4({ ...input, startlist, gc_context, rules_revision: rev }));
  assert.equal(run("s5_profiles_v3"), run("s5_profiles_v3"));
  assert.equal(run("s5_profiles_v2"), run("s5_profiles_v2"));
});
