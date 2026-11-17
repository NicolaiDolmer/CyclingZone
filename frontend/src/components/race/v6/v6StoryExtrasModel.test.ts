// #8383: Din dag-sætningen, mellemtiderne og spoiler-reglen 7/11 under løbsfilmen i Historie.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SplitRow } from "../stagePageV2/raceStoryModel.ts";
import type { ResultRow } from "../stagePageV2/stagePageV2Model.ts";
import { markV6ResultsSeen, v6DaySentences, v6ExtrasView, v6ResultsSeen } from "./v6StoryExtrasModel.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const MINE = "team-me";
const OTHER = "team-x";
function row(id: string, type: string, stage: number, rank: number, rider: string, team: string, gap: string): ResultRow {
  const [firstname, lastname] = rider.split(" ");
  return { id, result_type: type, stage_number: stage, rank, rider_id: `rid-${rider}`, team_id: team, finish_time: gap, rider: { firstname, lastname, nationality_code: "dk" } };
}
const RESULTS: ResultRow[] = [
  row("s1", "stage", 2, 1, "Carl Rojas", OTHER, "+0:00"),
  row("s2", "stage", 2, 2, "Luca Marchetti", OTHER, "+0:12"),
  row("s3", "stage", 2, 3, "Simon Kranjc", OTHER, "+0:24"),
  row("s6", "stage", 2, 6, "Ana Ibarra", MINE, "+1:10"),
];

function split(key: string, kind: SplitRow["kind"], km: number): SplitRow {
  return { key, kind, name: null, category: null, km, leaderTime: null, leaderIds: [], leaderIsPeloton: false, leaderSize: null, firstId: null, myGap: null };
}
const SPLITS = [split("c1", "climb", 40), split("s1", "sprint", 90), split("c2", "climb", 140), split("f", "finish", 160)];

test("Din dag-sætningen: vinderen, hullet til nummer to og din bedste, som YourDayCard", () => {
  const out = v6DaySentences({ results: RESULTS, stageNumber: 2, isStageRace: true, myTeamId: MINE });
  assert.deepEqual(out.map((s) => s.key), ["stagePageV2.yourDay.whyGap", "stagePageV2.yourDay.mineLine"]);
  assert.deepEqual(out[0].params, { winner: "Carl Rojas", gap: "+0:12", second: "Luca Marchetti" });
  assert.deepEqual(out[1].params, { name: "Ana Ibarra", rank: 6, gap: "+1:10" });
});

test("Din dag-sætningen: samme tid giver whySame, din vinder giver mineWon, ingen egne = kun vinderen", () => {
  const same = RESULTS.map((r) => (r.id === "s2" ? { ...r, finish_time: "+0:00" } : r));
  assert.equal(v6DaySentences({ results: same, stageNumber: 2, isStageRace: true, myTeamId: null })[0].key, "stagePageV2.yourDay.whySame");
  const won = v6DaySentences({ results: RESULTS, stageNumber: 2, isStageRace: true, myTeamId: OTHER });
  assert.equal(won.at(-1)?.key, "stagePageV2.yourDay.mineWon");
  assert.equal(v6DaySentences({ results: RESULTS, stageNumber: 2, isStageRace: true, myTeamId: "nobody" }).length, 1);
});

test("Din dag-sætningen: et ulæseligt hul giver ingen vinder-sætning (gætter ikke)", () => {
  const odd = RESULTS.map((r) => (r.id === "s2" ? { ...r, finish_time: "s.t." } : r));
  assert.deepEqual(v6DaySentences({ results: odd, stageNumber: 2, isStageRace: true, myTeamId: null }), []);
});

test("7/11-reglen: før mål kun mellemtider op til filmen, aldrig målet; ingen Din dag", () => {
  const v = v6ExtrasView({ km: 100, distanceKm: 160, spoilerActive: false, resultsSeen: false, splitRows: SPLITS });
  assert.equal(v.full, false);
  assert.equal(v.day, false);
  assert.deepEqual(v.rows.map((r) => r.key), ["c1", "s1"]);
  const start = v6ExtrasView({ km: 0, distanceKm: 160, spoilerActive: false, resultsSeen: false, splitRows: SPLITS });
  assert.deepEqual(start.rows, [], "filmen starter ved start: intet er passeret");
});

test("7/11-reglen: et mål før distancen (afrundet km) står ikke, før filmen er i mål", () => {
  const rows = [split("c1", "climb", 40), split("f", "finish", 159.6)];
  const v = v6ExtrasView({ km: 159.8, distanceKm: 160, spoilerActive: false, resultsSeen: false, splitRows: rows });
  assert.deepEqual(v.rows.map((r) => r.key), ["c1"]);
});

test("filmen i mål: alle mellemtider, referat og Din dag", () => {
  const v = v6ExtrasView({ km: 160, distanceKm: 160, spoilerActive: false, resultsSeen: false, splitRows: SPLITS });
  assert.deepEqual(v, { full: true, day: true, rows: SPLITS });
});

test("Resultater set: Din dag-sætningen står før mål, resten følger stadig filmen", () => {
  const v = v6ExtrasView({ km: 20, distanceKm: 160, spoilerActive: false, resultsSeen: true, splitRows: SPLITS });
  assert.equal(v.day, true);
  assert.equal(v.full, false);
  assert.deepEqual(v.rows, []);
});

test("spoiler-skjoldet: intet afslørende, heller ikke når Resultater er set", () => {
  const v = v6ExtrasView({ km: 160, distanceKm: 160, spoilerActive: true, resultsSeen: true, splitRows: SPLITS });
  assert.deepEqual(v, { full: false, day: false, rows: [] });
});

test("Resultater set huskes pr. løb og etape, aldrig uden løb", () => {
  assert.equal(v6ResultsSeen("race-a", 3), false);
  markV6ResultsSeen("race-a", 3);
  assert.equal(v6ResultsSeen("race-a", 3), true);
  assert.equal(v6ResultsSeen("race-a", 4), false);
  assert.equal(v6ResultsSeen("race-b", 3), false);
  markV6ResultsSeen(null, 3);
  assert.equal(v6ResultsSeen(null, 3), false);
});

test("kobling: filmen viser delene under sig, siden husker Resultater og sender de udgåede", () => {
  const film = read("./V6RaceFilm.tsx");
  assert.match(film, /extras\?\.\(\{ km, distanceKm: D, lines: storyLines, timeTrial \}\)/);
  const page = read("./RacePageV6.tsx");
  assert.match(page, /if \(activeTab === "results"\) markV6ResultsSeen\(raceId, selectedStage\);/);
  assert.match(page, /<V6RaceFilm [^\n]*dnfRows=\{dnfRows\}/);
  const extras = read("./V6StoryExtras.tsx");
  // Den gamle sides egne dele, ikke kopier: mellemtidstabellen, tabt tid og vejret.
  assert.match(extras, /import \{ SplitTable \} from "\.\.\/stagePageV2\/RaceStoryCard\.tsx";/);
  assert.match(extras, /import \{ LossRow \} from "\.\.\/StageSplitTimes\.jsx";/);
  assert.match(extras, /import \{ WeatherTag, weatherSentenceKey \} from "\.\.\/stagePageV2\/WeatherTag\.tsx";/);
});
