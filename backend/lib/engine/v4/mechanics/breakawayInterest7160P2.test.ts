// #7160 valg A2 (KUN s5_profiles_v3, slukket): P2's snor gaelder ikke paa bjerg, naar udbruddet er
// ufarligt for klassementet. Kontrakter, ingen balance-tal (hard rule 17): P2 slaas fra kun naar
// udbruddet er ufarligt for HVERT klassementshold i jagtgruppen; et farligt udbrud (for bare ét
// hold) og alt uden reglen er uroert, og breakaway.ts gaar gennem reglen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { s5V3P2OffForHarmlessBreak } from "./breakawayInterest7160P2.ts";
import { s5V3MountainLetGoInterestScale } from "./breakawayInterest7160.ts";
import { normalizeGcContext } from "./gcThreat.ts";
import { S5_V3_MOUNTAIN_LET_GO_7160_TUNING as T } from "../tuning.ts";
import type { AbilityKey, Entrant, GcContext, GcStanding, ProfileType } from "../types.ts";

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
function p2Off(gc: GcContext, breakawayRiderIds: string[], opts: { chase?: string[]; profileType?: ProfileType; s5ProfilesV3?: boolean } = {}): boolean {
  const chaseGroupRiderIds = opts.chase ?? CHASE;
  const harmlessGcTeams = s5V3MountainLetGoInterestScale({
    s5ProfilesV3: opts.s5ProfilesV3 ?? true, profileType: opts.profileType ?? "mountain", gcContext: gc, chaseGroupRiderIds, breakawayRiderIds, entrants: ENTRANTS,
  });
  return s5V3P2OffForHarmlessBreak({ harmlessGcTeams, chaseGroupRiderIds, entrants: ENTRANTS, gcContext: gc });
}

test("#7160 valg A2: uden #7176's hold (reglen gaelder ikke) er P2 uroert", () => {
  const gc = standings(gaps());
  assert.equal(s5V3P2OffForHarmlessBreak({ harmlessGcTeams: undefined, chaseGroupRiderIds: CHASE, entrants: ENTRANTS, gcContext: gc }), false);
  assert.equal(s5V3P2OffForHarmlessBreak({ harmlessGcTeams: new Map(), chaseGroupRiderIds: CHASE, entrants: ENTRANTS, gcContext: gc }), false);
  assert.equal(s5V3P2OffForHarmlessBreak({ harmlessGcTeams: new Map([["A", 0.5]]), chaseGroupRiderIds: CHASE, entrants: ENTRANTS, gcContext: null }), false);
  assert.equal(p2Off(gc, ["d1"], { s5ProfilesV3: false }), false, "aeldre revisioner");
  assert.equal(p2Off(gc, ["d1"], { profileType: "hilly" }), false, "uden for bjerg");
  assert.equal(p2Off(normalizeGcContext({ status: "one_day" }), ["d1"]), false, "endagsloeb");
});

test("#7160 valg A2: ufarligt udbrud for hvert klassementshold -> P2 slaas fra paa bjerg og hoejfjeld", () => {
  const gc = standings(gaps());
  assert.equal(p2Off(gc, ["d1"]), true);
  assert.equal(p2Off(gc, ["d1"], { profileType: "high_mountain" }), true);
});

test("#7160 valg A2: farligt udbrud jages med P2 som foer", () => {
  assert.equal(p2Off(standings(gaps({ d1: 10 })), ["d1"]), false, "udbryder taet paa klassementet");
  assert.equal(p2Off(standings(gaps()), ["d1", "ghost"]), false, "udbryder uden plads i klassementet");
});

test("#7160 valg A2: farligt for bare ét klassementshold -> P2 som foer", () => {
  // B's klassementsrytter ligger langt nede; udbryderen er langt efter A, men taet paa B.
  const bFar = T.harmlessGcGapSeconds * 2;
  const deeper: Record<string, number> = { b1: bFar, b2: bFar + 5, d1: bFar + 1, c1: bFar * 10, c2: bFar * 10 + 1, d2: bFar * 20 };
  for (let i = 0; i < T.gcRiderMaxRank; i++) deeper[`fill${i}`] = bFar + 100 + i;
  const gc = standings(gaps(deeper));
  const harmless = s5V3MountainLetGoInterestScale({ s5ProfilesV3: true, profileType: "mountain", gcContext: gc, chaseGroupRiderIds: CHASE, breakawayRiderIds: ["d1"], entrants: ENTRANTS });
  assert.ok(harmless?.has("A") && !harmless.has("B"), "ufarligt for A, farligt for B");
  assert.equal(p2Off(gc, ["d1"]), false);
  // Uden B i jagtgruppen er udbruddet ufarligt for hvert klassementshold der jager.
  assert.equal(p2Off(gc, ["d1"], { chase: CHASE.filter((id) => !id.startsWith("b")) }), true);
});

test("#7160 valg A2: P2 i breakaway.ts gaar gennem reglen, og valg A's interesse-filter er vaek (wiring-guard)", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "breakaway.ts"), "utf8");
  assert.match(src, /const p2Interest = p2Lead && !s5V3P2OffForHarmlessBreak\(\{ harmlessGcTeams: mountainLetGo,/);
  assert.doesNotMatch(src, /s5V3P2CountedStageInterest/);
});
