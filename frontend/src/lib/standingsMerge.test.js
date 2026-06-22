import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStandings } from "./standingsMerge.js";

// #1718 — Ranglisten viste ikke hold i divisioner der (næsten) kun bestod af AI,
// fordi is_ai-filteret holdt AI-hold helt ude af flettelisten. mergeStandings skal
// nu beholde AI-hold (med is_ai bevaret), så tabellen kan vise + markere dem.

const human = { id: "t-human", name: "Mit Hold", division: 1, is_ai: false };
const ai = { id: "t-ai", name: "AI-hold", division: 1, is_ai: true };

test("mergeStandings — AI-hold beholdes i flettelisten (vises nu, filtreres ikke væk)", () => {
  const merged = mergeStandings([human, ai], {});
  assert.equal(merged.length, 2);
  assert.ok(merged.some(s => s.team_id === "t-ai"));
});

test("mergeStandings — is_ai bevares på hold-objektet så tabellen kan markere AI-hold", () => {
  const merged = mergeStandings([ai], {});
  const aiRow = merged.find(s => s.team_id === "t-ai");
  assert.equal(aiRow.team.is_ai, true);
});

test("mergeStandings — eksisterende standings-række foretrækkes over 0-point-fallback", () => {
  const standingsMap = {
    "t-ai": { id: "ss-1", team_id: "t-ai", team: ai, total_points: 42, stage_wins: 3 },
  };
  const merged = mergeStandings([ai], standingsMap);
  const aiRow = merged.find(s => s.team_id === "t-ai");
  assert.equal(aiRow.total_points, 42);
  assert.equal(aiRow.stage_wins, 3);
});

test("mergeStandings — hold uden standings-række får 0-point-fallback der bærer hold-objektet", () => {
  const merged = mergeStandings([human], {});
  const row = merged.find(s => s.team_id === "t-human");
  assert.equal(row.total_points, 0);
  assert.equal(row.stage_wins, 0);
  assert.equal(row.team, human);
});

test("mergeStandings — division med kun AI-hold giver en ikke-tom liste (#1718 rod-bug)", () => {
  const aiOnly = [
    { id: "a1", name: "AI 1", division: 2, is_ai: true },
    { id: "a2", name: "AI 2", division: 2, is_ai: true },
  ];
  const merged = mergeStandings(aiOnly, {});
  assert.equal(merged.length, 2);
});

test("mergeStandings — tom/null input giver tom liste", () => {
  assert.deepEqual(mergeStandings([], {}), []);
  assert.deepEqual(mergeStandings(null, null), []);
  assert.deepEqual(mergeStandings(undefined, undefined), []);
});
