import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRaceName, matchesSearch, finalStageByRace, buildRaceHistory, defendingChampion, paginate,
  type HistoryRow,
} from "./raceHistoryModel.ts";

function pick(rows: HistoryRow[], name: string): HistoryRow {
  const r = rows.find((x) => x.name === name);
  assert.ok(r, name);
  return r;
}

test("#6514 søgning: accent- og tegn-uafhængig (thelambas Tour de l'Hexagone/Vuelta Ibérica)", () => {
  assert.equal(normalizeRaceName("Tour de l'Hexagone"), "tourdelhexagone");
  assert.ok(matchesSearch("Vuelta Ibérica", "vuelta iberica"));
  assert.ok(matchesSearch("Tour de l'Hexagone", "hexagone"));
  assert.ok(matchesSearch("Giro della Penisola", ""));
  assert.ok(!matchesSearch("Giro della Penisola", "vuelta"));
});

const RACES = [
  { id: "g3", name: "Giro", race_type: "stage_race", race_class: "GiroVuelta", stages: 3, season_number: 3 },
  { id: "g2", name: "Giro", race_type: "stage_race", race_class: "GiroVuelta", stages: 3, season_number: 2 },
  { id: "o3", name: "Omloop", race_type: "single", race_class: "Monuments", stages: 1, season_number: 3 },
];
const WINNERS = [
  // Giro S3: gc-føreren skifter; vinderen er føreren efter sidste etape.
  { race_id: "g3", stage_number: 1, result_type: "gc", rank: 1, rider_id: "rA", rider_name: "Rytter A", team_name: "Hold A" },
  { race_id: "g3", stage_number: 3, result_type: "gc", rank: 1, rider_id: "rB", rider_name: "Rytter B", team_name: "Hold B" },
  { race_id: "g2", stage_number: 3, result_type: "gc", rank: 1, rider_id: "rC", rider_name: "Rytter C", team_name: "Hold C" },
  // Etapesejr i et etapeløb er ikke løbets vinder.
  { race_id: "g2", stage_number: 2, result_type: "stage", rank: 1, rider_id: "rX", rider_name: "Rytter X", team_name: "Hold X" },
  { race_id: "o3", stage_number: 1, result_type: "stage", rank: 1, rider_id: "rD", rider_name: "Rytter D", team_name: "Hold D" },
];

test("#6514 finalStageByRace: højeste gc-etape for etapeløb, 1 for endagsløb", () => {
  const f = finalStageByRace(RACES, WINNERS);
  assert.equal(f.get("g3"), 3);
  assert.equal(f.get("g2"), 3);
  assert.equal(f.get("o3"), 1);
});

test("#6514 buildRaceHistory: én række pr. løb, vindere pr. sæson nyeste først", () => {
  const rows = buildRaceHistory({ races: RACES, winnerRows: WINNERS });
  const giro = pick(rows, "Giro");
  assert.deepEqual(giro.editions.map((e) => [e.season, e.winner?.name]), [[3, "Rytter B"], [2, "Rytter C"]]);
  assert.equal(giro.champion?.name, "Rytter B");
  assert.equal(giro.champion?.season, 3);
  assert.equal(giro.champion?.raceId, "g3");
  assert.equal(pick(rows, "Omloop").champion?.name, "Rytter D");
});

test("#6514 buildRaceHistory: dit bedste = laveste placering i den endelige stilling", () => {
  const myRows = [
    { race_id: "g3", stage_number: 1, result_type: "gc", rank: 1 }, // førte efter etape 1: tæller ikke
    { race_id: "g3", stage_number: 3, result_type: "gc", rank: 7 },
    { race_id: "g2", stage_number: 3, result_type: "gc", rank: 4 },
    { race_id: "g2", stage_number: 3, result_type: "gc", rank: 12 },
  ];
  const giro = pick(buildRaceHistory({ races: RACES, winnerRows: WINNERS, myRows }), "Giro");
  assert.deepEqual(giro.myBest, { rank: 4, season: 2, raceId: "g2" });
  const omloop = pick(buildRaceHistory({ races: RACES, winnerRows: WINNERS, myRows }), "Omloop");
  assert.equal(omloop.myBest, null);
});

test("#6514 buildRaceHistory: terræn fra nyeste udgave med rute, hårdeste først", () => {
  const profiles = [
    { race_id: "g2", stage_number: 1, profile_type: "flat" },
    { race_id: "g2", stage_number: 2, profile_type: "high_mountain" },
    { race_id: "g2", stage_number: 3, profile_type: "itt" },
  ];
  const giro = pick(buildRaceHistory({ races: RACES, winnerRows: WINNERS, profiles }), "Giro");
  assert.deepEqual(giro.terrain, [
    { kind: "mountain", profileType: "high_mountain", count: 1 },
    { kind: "itt", profileType: "itt", count: 1 },
    { kind: "sprint", profileType: "flat", count: 1 },
  ]);
  assert.deepEqual(pick(buildRaceHistory({ races: RACES, winnerRows: WINNERS }), "Omloop").terrain, []);
});

test("#6514 defendingChampion: ingen vinder i nyeste udgave = ingen mester (aldrig en ældre)", () => {
  const rows = buildRaceHistory({ races: RACES, winnerRows: WINNERS.filter((w) => w.race_id !== "g3") });
  assert.equal(pick(rows, "Giro").champion, null);
  assert.equal(defendingChampion(null), null);
});

test("#6514 buildRaceHistory: samme navn, anden løbstype er et andet løb", () => {
  const rows = buildRaceHistory({ races: [...RACES, { id: "x", name: "Giro", race_type: "single", stages: 1, season_number: 1 }] });
  assert.equal(rows.filter((r) => r.name === "Giro").length, 2);
});

test("#6514 paginate: faste sider og tællere", () => {
  const rows = Array.from({ length: 61 }, (_, i) => i);
  const p0 = paginate(rows, 0, 25);
  assert.equal(p0.rows.length, 25);
  assert.deepEqual([p0.from, p0.to, p0.total, p0.pages], [1, 25, 61, 3]);
  const p2 = paginate(rows, 9, 25);
  assert.equal(p2.page, 2);
  assert.deepEqual([p2.from, p2.to], [51, 61]);
  assert.deepEqual([paginate([], 0).from, paginate([], 0).pages], [0, 1]);
});
