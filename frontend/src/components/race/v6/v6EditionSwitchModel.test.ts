// #5841 · Udgave-skiftet: puljer og sæsoner for samme løb (pool_race_id), vinder og forspring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildEditionSwitch, editionSummary, formatMargin, gapToSeconds, nextMenuFocus, poolLetter,
  type EditionRaceRow, type EditionResultRow,
} from "./v6EditionSwitchModel.ts";

const S5 = { number: 5, status: "active" };
const S4 = { number: 4, status: "completed" };
const div = (tier: number, pool: number) => ({ tier, pool_index: pool, label: `Division ${tier} - ${String.fromCharCode(65 + pool)}` });
const race = (id: string, seasonId: string, season: { number: number; status: string }, tier: number, pool: number, extra: Partial<EditionRaceRow> = {}): EditionRaceRow => ({
  id, season_id: seasonId, league_division_id: tier * 10 + pool, status: "scheduled", stages: 7, stages_completed: 1,
  season, division: div(tier, pool), ...extra,
});
const res = (raceId: string, type: string, stage: number, rank: number, name: string, time: string): EditionResultRow => ({
  race_id: raceId, stage_number: stage, result_type: type, rank, rider_name: name, finish_time: time,
});

const EDITIONS: EditionRaceRow[] = [
  race("c5", "s5", S5, 3, 2),
  race("a5", "s5", S5, 3, 0),
  race("b5", "s5", S5, 3, 1),
  race("d5", "s5", S5, 3, 3),
  race("x5", "s5", S5, 2, 0), // samme katalogløb i en anden division: ikke en pulje-tvilling
  race("f4", "s4", S4, 4, 5, { status: "completed", stages_completed: 7 }),
  race("a4", "s4", S4, 4, 0, { status: "completed", stages_completed: 7 }),
];
const RESULTS: EditionResultRow[] = [
  res("b5", "stage", 1, 1, "Rider One", "4:01:10"),
  res("b5", "stage", 1, 2, "Rider Two", "+1:29"),
  res("c5", "stage", 1, 1, "Rider Three", "4:02:00"),
  res("c5", "stage", 1, 2, "Rider Four", "+1:02"),
  res("f4", "gc", 6, 1, "Old Leader", "+0:00"),
  res("f4", "gc", 7, 1, "Final Winner", "27:41:12"),
  res("f4", "gc", 7, 2, "Runner Up", "+0:41"),
];

test("poolLetter: pool_index 0 = A, ugyldigt = null", () => {
  assert.equal(poolLetter(0), "A");
  assert.equal(poolLetter(3), "D");
  assert.equal(poolLetter(null), null);
  assert.equal(poolLetter(-1), null);
});

test("gapToSeconds og formatMargin læser kun et gab", () => {
  assert.equal(gapToSeconds("+1:29"), 89);
  assert.equal(gapToSeconds("0:12"), 12);
  assert.equal(gapToSeconds("4:01:10"), null);
  assert.equal(gapToSeconds(null), null);
  assert.equal(formatMargin(89), "1:29");
  assert.equal(formatMargin(5), "0:05");
});

test("editionSummary: kørt færdig = gc rank 1 ved højeste etape, forspring fra rank 2", () => {
  const s = editionSummary(EDITIONS[5], RESULTS);
  assert.deepEqual(s, { kind: "won", name: "Final Winner", marginSec: 41, time: "27:41:12" });
});

test("editionSummary: i gang = seneste etapes vinder og forspring", () => {
  assert.deepEqual(editionSummary(EDITIONS[2], RESULTS), { kind: "stage", stage: 1, name: "Rider One", marginSec: 89 });
});

test("editionSummary: ikke startet og manglende resultater gætter ikke", () => {
  assert.deepEqual(editionSummary(race("n", "s5", S5, 3, 0, { stages_completed: 0 }), RESULTS), { kind: "upcoming" });
  assert.deepEqual(editionSummary(EDITIONS[1], RESULTS), { kind: "unknown" });
});

test("buildEditionSwitch: puljer = samme sæson og division, i puljeorden, holdets markeret", () => {
  const m = buildEditionSwitch({ currentRaceId: "c5", editions: EDITIONS, results: RESULTS, ownRaceIds: new Set(["b5", "f4"]) });
  assert.ok(m);
  assert.deepEqual(m.pools.map((p) => p.letter), ["A", "B", "C", "D"]);
  assert.deepEqual(m.pools.filter((p) => p.own).map((p) => p.raceId), ["b5"]);
  assert.deepEqual(m.pools.filter((p) => p.current).map((p) => p.raceId), ["c5"]);
  assert.equal(m.currentLetter, "C");
  assert.equal(m.currentSeasonNumber, 5);
  assert.deepEqual(m.ownElsewhere, { raceId: "b5", letter: "B", tier: 3, sameTier: true });
});

test("buildEditionSwitch: sæsoner nyeste først; en anden sæson åbner holdets pulje, ellers den første", () => {
  const withOwn = buildEditionSwitch({ currentRaceId: "c5", editions: EDITIONS, results: RESULTS, ownRaceIds: new Set(["b5", "f4"]) });
  assert.deepEqual(withOwn?.seasons.map((s) => [s.seasonNumber, s.raceId, s.current, s.ownLetter]), [[5, "c5", true, "B"], [4, "f4", false, "F"]]);
  assert.equal(withOwn?.seasons[0].live, true);
  const noOwn = buildEditionSwitch({ currentRaceId: "c5", editions: EDITIONS, results: RESULTS, ownRaceIds: new Set() });
  assert.deepEqual(noOwn?.seasons.map((s) => s.raceId), ["c5", "a4"]);
  assert.equal(noOwn?.ownElsewhere, null);
});

test("buildEditionSwitch: holdets egen udgave giver ingen tilbage-linje", () => {
  const m = buildEditionSwitch({ currentRaceId: "b5", editions: EDITIONS, results: RESULTS, ownRaceIds: new Set(["b5"]) });
  assert.equal(m?.ownElsewhere, null);
});

test("buildEditionSwitch: én udgave = intet at skifte imellem", () => {
  assert.equal(buildEditionSwitch({ currentRaceId: "a5", editions: [EDITIONS[1]], results: [], ownRaceIds: new Set() }), null);
  assert.equal(buildEditionSwitch({ currentRaceId: "zz", editions: EDITIONS, results: [], ownRaceIds: new Set() }), null);
});

test("nextMenuFocus går rundt i begge ender", () => {
  assert.equal(nextMenuFocus(3, 4, "ArrowDown"), 0);
  assert.equal(nextMenuFocus(0, 4, "ArrowUp"), 3);
  assert.equal(nextMenuFocus(2, 4, "Home"), 0);
  assert.equal(nextMenuFocus(0, 4, "End"), 3);
  assert.equal(nextMenuFocus(0, 4, "Tab"), null);
});

test("poolTwinsByRaceId: kalenderkortets puljer efter mergePoolTwins' regel, i divisionstræets orden", async () => {
  const { poolTwinsByRaceId, mergePoolTwins } = await import("../../../lib/calendarGrid.js");
  const divisions = [{ division: 3, pools: [{ id: 31, poolIndex: 0 }, { id: 32, poolIndex: 1 }, { id: 33, poolIndex: 2 }] }];
  const sched = [{ stage: 1, date: "2026-11-07", terrain: "hilly" }];
  const entries = [
    { id: "r-c", name: "Giro", raceType: "stage_race", stages: 1, division: 3, poolId: 33, stageSchedule: sched },
    { id: "r-a", name: "Giro", raceType: "stage_race", stages: 1, division: 3, poolId: 31, stageSchedule: sched },
    { id: "r-b", name: "Giro", raceType: "stage_race", stages: 1, division: 3, poolId: 32, stageSchedule: sched },
    { id: "solo", name: "Solo", raceType: "single", stages: 1, division: 3, poolId: 31, date: "2026-11-08" },
  ];
  const twins = poolTwinsByRaceId(entries, { divisions });
  assert.deepEqual(twins.get("r-b")?.map((tw) => [tw.id, tw.poolIndex]), [["r-a", 0], ["r-b", 1], ["r-c", 2]]);
  assert.equal(twins.get("solo"), undefined);
  // Samme gruppering som kalenderens sammenlægning: tre tvillinger bliver til ét løb.
  assert.equal(mergePoolTwins(entries, { divisions }).length, 2);
});

test("kilden: switchen monteres i løbshovedet bag v6 og bruger det route-gatede navnerum", () => {
  const page = readFileSync(new URL("./RacePageV6.tsx", import.meta.url), "utf8");
  assert.match(page, /editions=\{<V6EditionSwitch raceId=\{raceId\} myTeamId=\{myTeamId\} \/>\}/);
  const sw = readFileSync(new URL("./V6EditionSwitch.tsx", import.meta.url), "utf8");
  assert.match(sw, /useTranslation\("calendar"\)/);
  assert.match(sw, /\.eq\("pool_race_id", /);
  assert.doesNotMatch(sw, /variant="primary"/);
});

test("buildEditionSwitch: én pulje og én sæson, men holdet kører en anden division = tilbage-linjen bliver (Codex #8303)", () => {
  const editions = [race("x1", "s5", S5, 1, 0), race("c3", "s5", S5, 3, 2)];
  const m = buildEditionSwitch({ currentRaceId: "x1", editions, results: [], ownRaceIds: new Set(["c3"]) });
  assert.ok(m, "modellen findes, fordi holdets løb er et andet sted");
  assert.equal(m.pools.length, 1);
  assert.equal(m.seasons.length, 1);
  assert.equal(m.ownElsewhere?.raceId, "c3");
  assert.equal(m.ownElsewhere?.sameTier, false);
});
