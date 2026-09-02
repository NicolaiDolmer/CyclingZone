// backend/scripts/lib/headToHeadAnchors.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { RACE_V4_TUNING } from "../../lib/engine/v4/tuning.ts";
import {
  ANCHOR_BANDS,
  judge,
  scoreFieldCohesion,
  scoreDescentVsSummitRatio,
  scoreDescentAttackBounds,
  scorePunchCorrelation,
  scoreDominance,
  scoreBreakawayRates,
  scoreTypeIntegrity,
  scoreBonusSecondsBounded,
  scoreGapRealism,
  buildScorecard,
  formatScorecard,
} from "./headToHeadAnchors.js";

function ability(overrides = {}) {
  const base = {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
  };
  return { ...base, ...overrides };
}

function v3Ranked(entries) {
  // entries: [{rider_id, rank, stageGap, team_id, breakaway}]
  return entries.map((e) => ({
    rider_id: e.rider_id,
    team_id: e.team_id ?? null,
    rank: e.rank,
    stageGap: e.stageGap,
    components: { terrain: e.terrain ?? 0, breakaway: e.breakaway ?? 0 },
  }));
}

function v4Results(entries) {
  // entries: [{rider_id, rank, time_seconds, group_id}]
  return entries.map((e) => ({
    rider_id: e.rider_id, rank: e.rank, time_seconds: e.time_seconds,
    group_id: e.group_id ?? "g1", status: "finished",
  }));
}

function makeRow({ profile_type, finale_type, v3Entries, v4Entries, events = [], stageRow = { race_id: "race1" } }) {
  return {
    raw: {
      route: { profile_type, finale_type, segments: [] },
      tuning: RACE_V4_TUNING,
      stageRow,
      v3Output: { ranked: v3Ranked(v3Entries) },
      v4Output: { results: v4Results(v4Entries), timeline: { events } },
    },
  };
}

// ── judge() ────────────────────────────────────────────────────────────────

test("judge: null/undefined vaerdi eller sampleCount=0 -> N/A, aldrig FAIL/PASS", () => {
  assert.equal(judge(null, { min: 0.8 }, 5).verdict, "N/A");
  assert.equal(judge(0.9, { min: 0.8 }, 0).verdict, "N/A");
  assert.equal(judge(NaN, { min: 0.8 }, 5).verdict, "N/A");
});

test("judge: indenfor baand -> PASS, udenfor -> FAIL", () => {
  assert.equal(judge(0.9, { min: 0.8, max: 0.95 }, 3).verdict, "PASS");
  assert.equal(judge(0.5, { min: 0.8, max: 0.95 }, 3).verdict, "FAIL");
  assert.equal(judge(0.99, { min: 0.8, max: 0.95 }, 3).verdict, "FAIL");
});

// ── scoreFieldCohesion ───────────────────────────────────────────────────

test("scoreFieldCohesion: 5 af 6 paa vindertiden (83%) -> PASS (indenfor 80-95%)", () => {
  const row = makeRow({
    profile_type: "flat", finale_type: "bunch_sprint",
    v3Entries: [
      { rider_id: "a", rank: 1, stageGap: 0 }, { rider_id: "b", rank: 2, stageGap: 0 },
      { rider_id: "c", rank: 3, stageGap: 0 }, { rider_id: "d", rank: 4, stageGap: 0 },
      { rider_id: "e", rank: 5, stageGap: 0 }, { rider_id: "f", rank: 6, stageGap: 12 },
    ],
    v4Entries: [
      { rider_id: "a", rank: 1, time_seconds: 100 }, { rider_id: "b", rank: 2, time_seconds: 100 },
      { rider_id: "c", rank: 3, time_seconds: 100 }, { rider_id: "d", rank: 4, time_seconds: 100 },
      { rider_id: "e", rank: 5, time_seconds: 100 }, { rider_id: "f", rank: 6, time_seconds: 112 },
    ],
  });
  const result = scoreFieldCohesion([row]);
  assert.ok(Math.abs(result.v3.value - 5 / 6) < 1e-9);
  assert.equal(result.v3.verdict, "PASS");
  assert.equal(result.v4.verdict, "PASS");
});

test("scoreFieldCohesion: ingen flade etaper i input -> N/A", () => {
  const row = makeRow({
    profile_type: "mountain", finale_type: "long_climb",
    v3Entries: [{ rider_id: "a", rank: 1, stageGap: 0 }],
    v4Entries: [{ rider_id: "a", rank: 1, time_seconds: 100 }],
  });
  const result = scoreFieldCohesion([row]);
  assert.equal(result.v3.verdict, "N/A");
  assert.equal(result.v4.verdict, "N/A");
});

// ── scoreDescentVsSummitRatio ────────────────────────────────────────────

test("scoreDescentVsSummitRatio: descent-spredning halvt saa stor som summit -> ratio 0.5 -> PASS", () => {
  const descentRow = makeRow({
    profile_type: "mountain", finale_type: "descent",
    v3Entries: Array.from({ length: 11 }, (_, i) => ({ rider_id: `d${i}`, rank: i + 1, stageGap: i * 2 })),
    v4Entries: Array.from({ length: 11 }, (_, i) => ({ rider_id: `d${i}`, rank: i + 1, time_seconds: 100 + i * 2 })),
  });
  const summitRow = makeRow({
    profile_type: "mountain", finale_type: "long_climb",
    v3Entries: Array.from({ length: 11 }, (_, i) => ({ rider_id: `s${i}`, rank: i + 1, stageGap: i * 4 })),
    v4Entries: Array.from({ length: 11 }, (_, i) => ({ rider_id: `s${i}`, rank: i + 1, time_seconds: 100 + i * 4 })),
  });
  const result = scoreDescentVsSummitRatio([descentRow, summitRow]);
  assert.ok(Math.abs(result.v3.value - 0.5) < 1e-9);
  assert.equal(result.v3.verdict, "PASS");
  assert.ok(Math.abs(result.v4.value - 0.5) < 1e-9);
  assert.equal(result.v4.verdict, "PASS");
});

test("scoreDescentVsSummitRatio: mangler descent- eller summit-etaper -> N/A", () => {
  const summitOnly = makeRow({
    profile_type: "mountain", finale_type: "long_climb",
    v3Entries: [{ rider_id: "a", rank: 1, stageGap: 0 }],
    v4Entries: [{ rider_id: "a", rank: 1, time_seconds: 100 }],
  });
  const result = scoreDescentVsSummitRatio([summitOnly]);
  assert.equal(result.v3.verdict, "N/A");
  assert.equal(result.v4.verdict, "N/A");
});

// ── scoreDescentAttackBounds ─────────────────────────────────────────────

test("scoreDescentAttackBounds: gevinst indenfor 10-20s -> PASS", () => {
  const row = makeRow({
    profile_type: "mountain", finale_type: "descent",
    v3Entries: [{ rider_id: "a", rank: 1, stageGap: 0 }],
    v4Entries: [{ rider_id: "a", rank: 1, time_seconds: 100 }],
    events: [{ type: "finale_attack", params: { direction: "descent", gained_seconds: 15 } }],
  });
  const result = scoreDescentAttackBounds([row]);
  assert.equal(result.v4.verdict, "PASS");
  assert.equal(result.v3.verdict, "N/A"); // v3 har ingen sammenlignelig mekanik
});

test("scoreDescentAttackBounds: gevinst over 20s -> FAIL", () => {
  const row = makeRow({
    profile_type: "mountain", finale_type: "descent",
    v3Entries: [{ rider_id: "a", rank: 1, stageGap: 0 }],
    v4Entries: [{ rider_id: "a", rank: 1, time_seconds: 100 }],
    events: [{ type: "finale_attack", params: { direction: "descent", gained_seconds: 45 } }],
  });
  const result = scoreDescentAttackBounds([row]);
  assert.equal(result.v4.verdict, "FAIL");
});

test("scoreDescentAttackBounds: ingen angreb udloest -> N/A (ikke automatisk fejl)", () => {
  const row = makeRow({
    profile_type: "mountain", finale_type: "descent",
    v3Entries: [{ rider_id: "a", rank: 1, stageGap: 0 }],
    v4Entries: [{ rider_id: "a", rank: 1, time_seconds: 100 }],
    events: [],
  });
  const result = scoreDescentAttackBounds([row]);
  assert.equal(result.v4.verdict, "N/A");
});

// ── scorePunchCorrelation ────────────────────────────────────────────────

test("scorePunchCorrelation: hoejere punch-evne -> bedre placering -> positiv korrelation -> PASS", () => {
  const row = makeRow({
    profile_type: "hilly", finale_type: "punch",
    v3Entries: [
      { rider_id: "a", rank: 1, stageGap: 0 }, { rider_id: "b", rank: 2, stageGap: 5 },
      { rider_id: "c", rank: 3, stageGap: 10 }, { rider_id: "d", rank: 4, stageGap: 15 },
    ],
    v4Entries: [
      { rider_id: "a", rank: 1, time_seconds: 100 }, { rider_id: "b", rank: 2, time_seconds: 105 },
      { rider_id: "c", rank: 3, time_seconds: 110 }, { rider_id: "d", rank: 4, time_seconds: 115 },
    ],
  });
  const abilitiesByRider = new Map([
    ["a", ability({ punch: 90 })], ["b", ability({ punch: 70 })],
    ["c", ability({ punch: 50 })], ["d", ability({ punch: 30 })],
  ]);
  const result = scorePunchCorrelation([row], abilitiesByRider);
  assert.equal(result.v3.verdict, "PASS");
  assert.equal(result.v4.verdict, "PASS");
});

test("scorePunchCorrelation: ingen punch-etaper -> N/A", () => {
  const row = makeRow({
    profile_type: "flat", finale_type: "bunch_sprint",
    v3Entries: [{ rider_id: "a", rank: 1, stageGap: 0 }],
    v4Entries: [{ rider_id: "a", rank: 1, time_seconds: 100 }],
  });
  const result = scorePunchCorrelation([row], new Map());
  assert.equal(result.v3.verdict, "N/A");
  assert.equal(result.v4.verdict, "N/A");
});

// ── scoreDominance (favorite-win-rate + samme-hold-top-10) ──────────────

test("scoreDominance: returnerer to ankre (favorite_win_rate, same_team_top10_share_4plus)", () => {
  const v4EntrantsById = {
    a: { rider_id: "a", abilities: ability({ punch: 90 }) },
    b: { rider_id: "b", abilities: ability({ punch: 30 }) },
  };
  const row = makeRow({
    profile_type: "hilly", finale_type: "punch",
    v3Entries: [
      { rider_id: "a", rank: 1, stageGap: 0, terrain: 90, team_id: "t1" },
      { rider_id: "b", rank: 2, stageGap: 5, terrain: 30, team_id: "t2" },
    ],
    v4Entries: [{ rider_id: "a", rank: 1, time_seconds: 100 }, { rider_id: "b", rank: 2, time_seconds: 105 }],
  });
  const teamByRider = new Map([["a", "t1"], ["b", "t2"]]);
  const [winRate, sameTeam] = scoreDominance([row], { teamByRider, v4EntrantsById });
  assert.equal(winRate.id, "favorite_win_rate");
  assert.equal(sameTeam.id, "same_team_top10_share_4plus");
  // Favoritten (hoejeste terrain-score/finale-ability) vandt i begge motorer.
  assert.equal(winRate.v3.value, 1);
  assert.equal(winRate.v4.value, 1);
});

// ── scoreBreakawayRates ───────────────────────────────────────────────────

test("scoreBreakawayRates: v3 maaler breakaway-vinderandel, v4 er altid N/A (M5 F3-scope)", () => {
  const row = makeRow({
    profile_type: "mountain", finale_type: "breakaway",
    v3Entries: [{ rider_id: "a", rank: 1, stageGap: 0, breakaway: 5 }],
    v4Entries: [{ rider_id: "a", rank: 1, time_seconds: 100 }],
  });
  const result = scoreBreakawayRates([row]);
  assert.equal(result.v3.value, 1);
  assert.equal(result.v4.verdict, "N/A");
  assert.match(result.v4.naReason, /F3-scope/);
});

// ── scoreTypeIntegrity ─────────────────────────────────────────────────

test("scoreTypeIntegrity: top-sprint-evne-rytter vinder flad etape -> sprinter_win_rate PASS", () => {
  const row = makeRow({
    profile_type: "flat", finale_type: "bunch_sprint",
    v3Entries: [
      { rider_id: "a", rank: 1, stageGap: 0 }, { rider_id: "b", rank: 2, stageGap: 1 },
      { rider_id: "c", rank: 3, stageGap: 2 }, { rider_id: "d", rank: 4, stageGap: 3 },
      { rider_id: "e", rank: 5, stageGap: 4 },
    ],
    v4Entries: [
      { rider_id: "a", rank: 1, time_seconds: 100 }, { rider_id: "b", rank: 2, time_seconds: 101 },
      { rider_id: "c", rank: 3, time_seconds: 102 }, { rider_id: "d", rank: 4, time_seconds: 103 },
      { rider_id: "e", rank: 5, time_seconds: 104 },
    ],
  });
  const abilitiesByRider = new Map([
    ["a", ability({ sprint: 95, time_trial: 40 })], ["b", ability({ sprint: 60, time_trial: 40 })],
    ["c", ability({ sprint: 50, time_trial: 40 })], ["d", ability({ sprint: 40, time_trial: 40 })],
    ["e", ability({ sprint: 30, time_trial: 40 })],
  ]);
  const [sprintAnchor, ittAnchor] = scoreTypeIntegrity([row], abilitiesByRider);
  assert.equal(sprintAnchor.v3.verdict, "PASS");
  assert.equal(sprintAnchor.v4.verdict, "PASS");
  assert.equal(ittAnchor.v3.verdict, "N/A"); // ingen ITT-etaper i input
});

// ── scoreBonusSecondsBounded ───────────────────────────────────────────

test("scoreBonusSecondsBounded: v3 strukturelt PASS (racePassages-konstanter), v4 N/A (M9 F3-scope)", () => {
  const result = scoreBonusSecondsBounded();
  assert.equal(result.v3.verdict, "PASS");
  assert.equal(result.v4.verdict, "N/A");
  assert.match(result.v4.naReason, /F3-scope/);
});

// ── scoreGapRealism ──────────────────────────────────────────────────────

test("scoreGapRealism: mountain-etape med 198s top-10-spredning -> PASS (#2415-baand 180-240s)", () => {
  // spreadAtRank(times, 10) laeser index 9 (0-indekseret 10.-mindste) af 11
  // sorterede vaerdier [0,22,44,...,220] -> index 9 = 198.
  const row = makeRow({
    profile_type: "mountain", finale_type: "long_climb",
    v3Entries: Array.from({ length: 11 }, (_, i) => ({ rider_id: `r${i}`, rank: i + 1, stageGap: i * 22 })),
    v4Entries: Array.from({ length: 11 }, (_, i) => ({ rider_id: `r${i}`, rank: i + 1, time_seconds: 100 + i * 22 })),
  });
  const [mountainAnchor, gtAnchor] = scoreGapRealism([row]);
  assert.equal(mountainAnchor.v3.value, 198);
  assert.equal(mountainAnchor.v3.verdict, "PASS");
  assert.equal(gtAnchor.v3.verdict, "N/A"); // kraever saeson-GC, aldrig maalbart her
});

test("scoreGapRealism: bjergetape med NEDKOERSELS-finale taeller IKKE med (ejer 2/9, #4604)", () => {
  // Samme spredning som testen ovenfor, men finale_type: descent. Etapen hoerer
  // til nedkoersels-ankeret, ikke til #2415's topankomst-baand.
  const summit = makeRow({
    profile_type: "mountain", finale_type: "long_climb",
    v3Entries: Array.from({ length: 11 }, (_, i) => ({ rider_id: `r${i}`, rank: i + 1, stageGap: i * 22 })),
    v4Entries: Array.from({ length: 11 }, (_, i) => ({ rider_id: `r${i}`, rank: i + 1, time_seconds: 100 + i * 22 })),
  });
  const descentFinale = makeRow({
    profile_type: "mountain", finale_type: "descent",
    v3Entries: Array.from({ length: 11 }, (_, i) => ({ rider_id: `d${i}`, rank: i + 1, stageGap: i * 2 })),
    v4Entries: Array.from({ length: 11 }, (_, i) => ({ rider_id: `d${i}`, rank: i + 1, time_seconds: 100 + i * 2 })),
  });

  const [onlySummit] = scoreGapRealism([summit]);
  const [both] = scoreGapRealism([summit, descentFinale]);

  assert.equal(both.v3.sampleCount, onlySummit.v3.sampleCount, "nedkoerselsfinalen maa ikke tælles med");
  assert.equal(both.v3.value, onlySummit.v3.value, "nedkoerselsfinalen maa ikke flytte gennemsnittet");
  assert.equal(both.v3.verdict, "PASS");
});

// ── buildScorecard + formatScorecard (integration af alle ankre) ────────

test("buildScorecard: returnerer alle forventede anker-id'er, formatScorecard producerer laesbar tekst", () => {
  const v4EntrantsById = {
    a: { rider_id: "a", abilities: ability({ sprint: 90, punch: 40, time_trial: 40 }) },
    b: { rider_id: "b", abilities: ability({ sprint: 40, punch: 90, time_trial: 40 }) },
  };
  const flatRow = makeRow({
    profile_type: "flat", finale_type: "bunch_sprint",
    v3Entries: [{ rider_id: "a", rank: 1, stageGap: 0, team_id: "t1" }, { rider_id: "b", rank: 2, stageGap: 1, team_id: "t2" }],
    v4Entries: [{ rider_id: "a", rank: 1, time_seconds: 100 }, { rider_id: "b", rank: 2, time_seconds: 101 }],
  });
  const abilitiesByRider = new Map([["a", v4EntrantsById.a.abilities], ["b", v4EntrantsById.b.abilities]]);
  const teamByRider = new Map([["a", "t1"], ["b", "t2"]]);

  const scorecard = buildScorecard([flatRow], { teamByRider, abilitiesByRider, v4EntrantsById });
  const ids = scorecard.map((a) => a.id);
  for (const expectedId of [
    "field_cohesion_flat", "descent_vs_summit_gap_ratio", "descent_attack_gain_bounds",
    "punch_correlation", "favorite_win_rate", "same_team_top10_share_4plus",
    "breakaway_rate_per_terrain", "sprinter_win_rate_flat", "itt_correlation",
    "bonus_seconds_bounded", "mountain_top10_spread", "gt_winner_margin",
  ]) {
    assert.ok(ids.includes(expectedId), `mangler anker "${expectedId}" i scorecardet`);
  }

  const text = formatScorecard(scorecard);
  assert.match(text, /Head-to-Head Scorecard/);
  assert.match(text, /Opsummering/);
  for (const anchor of scorecard) {
    assert.ok(text.includes(anchor.label), `formatScorecard mangler anker-label "${anchor.label}"`);
  }
});

test("ANCHOR_BANDS: alle citerede baand har en source-streng (ingen ubegrundede tal)", () => {
  for (const [key, band] of Object.entries(ANCHOR_BANDS)) {
    assert.ok(typeof band.source === "string" && band.source.length > 0, `ANCHOR_BANDS.${key} mangler source`);
  }
});
