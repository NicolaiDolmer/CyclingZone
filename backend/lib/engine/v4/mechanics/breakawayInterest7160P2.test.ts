// #7160 valg A (KUN s5_profiles_v3, slukket): "ufarligt udbrud != interesse" i P2's lad-gaa-loft.
// Kontrakter, ingen balance-tal (hard rule 17): et klassementsholds etapeinteresse bag et
// ufarligt udbrud taeller ikke i P2, holdets positive signal (ordre/reaktion) goer stadig, et
// farligt udbrud er uroert, og uden reglen er P2 identisk.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { s5V3P2CountedStageInterest } from "./breakawayInterest7160P2.ts";
import { s5V3MountainLetGoInterestScale } from "./breakawayInterest7160.ts";
import { s5V3InterestedTeamIds, s5V3RealisticLeadCeilingSeconds } from "./breakawayV3_6804.ts";
import { normalizeGcContext } from "./gcThreat.ts";
import { S5_V3_MOUNTAIN_LET_GO_7160_TUNING as T } from "../tuning.ts";
import type { AbilityKey, Entrant, GcContext, GcStanding } from "../types.ts";

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
function entrant(id: string, team: string, level: number, role: Entrant["role"] = "helper"): Entrant {
  return { rider_id: id, abilities: Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>, role, effort: "normal", condition: 1, team_id: team };
}

// Hold A og B har en klassementsrytter i toppen; hold C's bedste er uden for graensen; D har udbryderen.
const ENTRANTS: Record<string, Entrant> = {
  a1: entrant("a1", "A", 80, "captain"), a2: entrant("a2", "A", 62),
  b1: entrant("b1", "B", 78, "captain"), b2: entrant("b2", "B", 60),
  c1: entrant("c1", "C", 70, "captain"), c2: entrant("c2", "C", 58),
  d1: entrant("d1", "D", 66, "hunter"), d2: entrant("d2", "D", 55),
};
const CHASE = ["a1", "a2", "b1", "b2", "c1", "c2", "d2"];

function standings(gaps: Record<string, number>): GcContext {
  const rows: GcStanding[] = Object.entries(gaps)
    .sort(([, x], [, y]) => x - y)
    .map(([rider_id, gap_seconds], i) => ({ rider_id, rank: i + 1, gap_seconds }));
  return normalizeGcContext({ status: "standings", stage_number: 9, leader_id: rows[0].rider_id, standings: rows, threat_model: "s5", stages_remaining: 10 });
}
const FAR = T.harmlessGcGapSeconds * 3;
function gaps(extra: Record<string, number> = {}): Record<string, number> {
  const base: Record<string, number> = { a1: 0, b1: 30, a2: 120, b2: 150 };
  for (let i = 0; i < T.gcRiderMaxRank; i++) base[`fill${i}`] = 200 + i;
  return { ...base, c1: 400, c2: 450, d1: FAR, d2: FAR + 10, ...extra };
}
const harmlessFor = (gc: GcContext, breakawayRiderIds: string[]) => s5V3MountainLetGoInterestScale({
  s5ProfilesV3: true, profileType: "mountain", gcContext: gc, chaseGroupRiderIds: CHASE, breakawayRiderIds, entrants: ENTRANTS,
});

test("#7160 valg A: uden hold er etapeinteressen den samme map (P2 identisk)", () => {
  const interest = new Map([["A", 1], ["C", 2]]);
  assert.equal(s5V3P2CountedStageInterest(interest, undefined), interest);
  assert.equal(s5V3P2CountedStageInterest(interest, new Map()), interest);
});

test("#7160 valg A: kun klassementsholdene bag et ufarligt udbrud tages ud; resten og input er uroert", () => {
  const interest = new Map([["A", 1], ["B", 0.5], ["C", 2]]);
  const counted = s5V3P2CountedStageInterest(interest, new Map([["A", 0.5], ["B", 0.5]]));
  assert.deepEqual([...counted], [["C", 2]]);
  assert.deepEqual([...interest], [["A", 1], ["B", 0.5], ["C", 2]], "input muteres ikke");
});

test("#7160 valg A: ufarligt udbrud -> klassementsholdene er ikke P2-interesserede; et signal goer dem det stadig", () => {
  const gc = standings(gaps());
  const harmless = harmlessFor(gc, ["d1"]);
  assert.deepEqual(harmless && [...harmless.keys()], ["A", "B"]);
  const interestByTeam = new Map([["A", 1], ["B", 1]]);
  const counted = s5V3P2CountedStageInterest(interestByTeam, harmless);
  assert.deepEqual(s5V3InterestedTeamIds({ interestByTeam: counted }), [], "kun klassementsholdenes etapeinteresse: ingen interesse");
  // Ingen interesse -> den oevre zone; med interesse -> mellemzonen (som P2 i dag).
  assert.ok(s5V3RealisticLeadCeilingSeconds("mountain", false) > s5V3RealisticLeadCeilingSeconds("mountain", true));
  // En "jag"-ordre/reaktion (positivt signal) taeller stadig.
  assert.deepEqual(s5V3InterestedTeamIds({ interestByTeam: counted, teamSignals: new Map([["B", 1]]) }), ["B"]);
  // "Lad gaa" (negativt signal) taeller aldrig.
  assert.deepEqual(s5V3InterestedTeamIds({ interestByTeam: counted, teamSignals: new Map([["A", -1]]) }), []);
  // Et hold uden klassementsrytter (C) med etapeinteresse er stadig interesseret.
  assert.deepEqual(s5V3InterestedTeamIds({ interestByTeam: s5V3P2CountedStageInterest(new Map([["A", 1], ["C", 1]]), harmless) }), ["C"]);
});

test("#7160 valg A: et farligt udbrud jages som foer (ingen hold tages ud)", () => {
  const close = standings(gaps({ d1: 10 }));
  assert.equal(harmlessFor(close, ["d1"]), undefined, "udbryder taet paa klassementet");
  assert.equal(harmlessFor(standings(gaps()), ["d1", "ghost"]), undefined, "udbryder uden plads i klassementet");
  const interestByTeam = new Map([["A", 1], ["B", 1]]);
  assert.deepEqual(s5V3InterestedTeamIds({ interestByTeam: s5V3P2CountedStageInterest(interestByTeam, harmlessFor(close, ["d1"])) }), ["A", "B"]);
});

test("#7160 valg A: P2's interesse i breakaway.ts gaar gennem reglen (wiring-guard)", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "breakaway.ts"), "utf8");
  const fn = src.slice(src.indexOf("function realisticLeadInterest("), src.indexOf("function withAutoChaseWork("));
  assert.match(fn, /s5V3InterestedTeamIds\(\{\s*interestByTeam:\s*s5V3P2CountedStageInterest\(interestByTeam,\s*input\.teamInterestScale\)/);
});
