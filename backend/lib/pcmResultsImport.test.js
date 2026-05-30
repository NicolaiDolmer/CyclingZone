import test from "node:test";
import assert from "node:assert/strict";

import { parseStageInfo, headerIndex } from "./pcmResultsParser.js";
import {
  extractParensRank,
  normalizeRaceName,
  raceNameFromTitle,
  matchRaceName,
  buildPcmResultRows,
  buildPcmImportEmbed,
} from "./pcmResultsImport.js";
import { resolvePcmTeamName, normalizePcmTeamName } from "./pcmTeamAliases.js";
import { foldName, foldNameNordic, buildRiderMatcher } from "./pcmRiderMatcher.js";
import { resolvePcmRiderName, normalizePcmRiderName, PCM_RIDER_ALIASES } from "./pcmRiderAliases.js";
import { PRIZE_PER_POINT } from "./raceResultsEngine.js";

// ── Parser helpers ────────────────────────────────────────────────

test("parseStageInfo læser etape-X/Y og final-flag", () => {
  assert.deepEqual(parseStageInfo("X: Stage results after stage 1/5: A - B"), {
    current: 1,
    total: 5,
    isFinalStage: false,
  });
  assert.deepEqual(parseStageInfo("X: Overall ranking after stage 5/5: A - B"), {
    current: 5,
    total: 5,
    isFinalStage: true,
  });
  assert.deepEqual(parseStageInfo("Bredene: Stage results after stage 1/1: A - B"), {
    current: 1,
    total: 1,
    isFinalStage: true,
  });
  assert.equal(parseStageInfo("ingen etape her"), null);
});

test("extractParensRank tager klassements-rank fra General Time", () => {
  assert.equal(extractParensRank("+ 43 (3)"), 3);
  assert.equal(extractParensRank("8h11'09 (1)"), 1);
  assert.equal(extractParensRank("+ 2'09 (15)"), 15);
  assert.equal(extractParensRank("s.t."), null);
  assert.equal(extractParensRank(""), null);
});

test("headerIndex er case-insensitiv", () => {
  const h = ["Rank", "Name", "Team", "General Time"];
  assert.equal(headerIndex(h, "name"), 1);
  assert.equal(headerIndex(h, "general time"), 3);
  assert.equal(headerIndex(h, "mangler"), -1);
});

// ── Race-navne-match ──────────────────────────────────────────────

test("normalizeRaceName folder accenter og tegn", () => {
  assert.equal(normalizeRaceName("Grand Prix des Hauts-de-France"), "grand prix des hauts de france");
  assert.equal(normalizeRaceName("De Brabantse Pijl - La Flèche Brabançonne"), "de brabantse pijl la fleche brabanconne");
});

test("raceNameFromTitle tager løbsnavn før kolon", () => {
  assert.equal(
    raceNameFromTitle("4 Jours de Dunkerque / Grand Prix des Hauts de France: Stage results after stage 1/5: A - B"),
    "4 Jours de Dunkerque / Grand Prix des Hauts de France",
  );
});

test("matchRaceName skelner Dunkerque-etapeløb fra Dunkerque-endagsløb", () => {
  const dbRaces = [
    { id: "stage", name: "4 Jours de Dunkerque / Grand Prix des Hauts-de-France", race_type: "stage_race" },
    { id: "single", name: "Classique Dunkerque / Grand Prix des Hauts-de-France", race_type: "single" },
  ];
  assert.equal(
    matchRaceName("4 Jours de Dunkerque / Grand Prix des Hauts de France", dbRaces).race?.id,
    "stage",
  );
  assert.equal(
    matchRaceName("Classique Dunkerque / Grand prix des Hauts de France", dbRaces).race?.id,
    "single",
  );
});

test("matchRaceName returnerer missing når intet match", () => {
  const res = matchRaceName("Tour de Nonexistent", [{ id: "a", name: "Paris-Roubaix" }]);
  assert.equal(res.race, null);
  assert.equal(res.status, "missing");
});

// ── Hold-alias ────────────────────────────────────────────────────

test("resolvePcmTeamName mapper alias og bevarer ukendte", () => {
  assert.equal(resolvePcmTeamName("Swatt Club"), "Swatt Team");
  assert.equal(resolvePcmTeamName("Team Hopplà"), "Hopplà Team");
  assert.equal(resolvePcmTeamName("Team UKYO"), "Vestas - Vov Vov Cycling");
  assert.equal(resolvePcmTeamName("TotalEnergies"), "Chris Machines");
  assert.equal(resolvePcmTeamName("Bahrain Victorious"), "Bahrain Victorious"); // eksakt → uændret
});

test("normalizePcmTeamName collapser whitespace men bevarer tegn", () => {
  assert.equal(normalizePcmTeamName("  Swatt   Club "), "Swatt Club");
});

// ── Navne-fold ────────────────────────────────────────────────────

test("foldName fjerner diakritik", () => {
  assert.equal(foldName("Maël Guégan"), "mael guegan");
  assert.equal(foldName("Lukáš Kubiš"), "lukas kubis");
  assert.equal(foldName("Nélson Oliveira"), "nelson oliveira");
});

test("foldNameNordic folder ø/æ/å oven på accent-fold", () => {
  // å dekomponerer allerede i NFD; ø/æ gør IKKE → kræver eksplicit fold
  assert.equal(foldNameNordic("Søren Wærenskjold"), "soren waerenskjold");
  assert.equal(foldNameNordic("Magnus Bøgh"), "magnus bogh");
  assert.equal(foldNameNordic("Kasper Asgreen"), "kasper asgreen"); // uændret
  // bevarer accent-fold for ikke-nordiske tegn
  assert.equal(foldNameNordic("Lukáš Kubiš"), "lukas kubis");
});

// ── Rytter-alias (#770) ───────────────────────────────────────────

test("resolvePcmRiderName er identitet for navne uden alias", () => {
  assert.equal(resolvePcmRiderName("Tadej Pogacar"), "Tadej Pogacar");
  assert.equal(normalizePcmRiderName("  Tadej   Pogacar "), "Tadej Pogacar");
});

test("PCM_RIDER_ALIASES er en ren PCM→DB-streng-map (ingen tomme værdier)", () => {
  for (const [k, v] of Object.entries(PCM_RIDER_ALIASES)) {
    assert.equal(typeof k, "string");
    assert.equal(typeof v, "string");
    assert.ok(v.trim().length > 0, `alias for "${k}" må ikke være tom`);
  }
});

// Mock-supabase: buildRiderMatcher kalder .from(t).select(...).range(from,to).
// Håndhæver PostgREST's 1000-row-loft pr. kald, så en test fanger det hvis
// matcheren holder op med at paginere.
function fakeSupabase(riders, { maxRows = 1000 } = {}) {
  return {
    from: () => ({
      select: () => ({
        range: async (from, to) => {
          const end = Math.min(to, from + maxRows - 1);
          return { data: riders.slice(from, end + 1), error: null };
        },
      }),
    }),
  };
}

test("buildRiderMatcher: exact, accent-fold, nordisk-fold og missing", async () => {
  const m = await buildRiderMatcher(
    fakeSupabase([
      { id: "r1", firstname: "Tadej", lastname: "Pogačar", team_id: "t1" },
      { id: "r2", firstname: "Søren", lastname: "Wærenskjold", team_id: "t2" },
    ]),
  );
  // exact (med accenter)
  assert.deepEqual(m.match("Tadej Pogačar"), { riderId: "r1", teamId: "t1", status: "exact" });
  // accent-foldet variant
  assert.equal(m.match("Tadej Pogacar").status, "folded");
  assert.equal(m.match("Tadej Pogacar").riderId, "r1");
  // nordisk variant (ø/æ uden fold-dekomposition)
  assert.deepEqual(m.match("Soren Waerenskjold"), { riderId: "r2", teamId: "t2", status: "nordic" });
  // ukendt → missing (ingen falsk positiv)
  assert.deepEqual(m.match("Ukendt Rytter"), { riderId: null, teamId: null, status: "missing" });
});

test("buildRiderMatcher: ægte dublet → ambiguous, aldrig gæt", async () => {
  const m = await buildRiderMatcher(
    fakeSupabase([
      { id: "a", firstname: "Jakob", lastname: "Nielsen", team_id: "t1" },
      { id: "b", firstname: "Jakob", lastname: "Nielsen", team_id: "t2" },
    ]),
  );
  assert.equal(m.match("Jakob Nielsen").status, "ambiguous");
  assert.equal(m.match("Jakob Nielsen").riderId, null);
});

test("buildRiderMatcher: paginerer forbi 1000-row-loftet (rod-årsag, #770)", async () => {
  // 2500 fyld-ryttere + én target langt forbi første side. Uden paginering
  // ville matcheren kun se de første 1000 og flagge target som missing.
  const riders = [];
  for (let i = 0; i < 2500; i += 1) {
    riders.push({ id: `fill-${i}`, firstname: `Fill${i}`, lastname: `Rider${i}`, team_id: null });
  }
  riders.splice(1800, 0, { id: "target", firstname: "Julian", lastname: "Alaphilippe", team_id: "t9" });
  const m = await buildRiderMatcher(fakeSupabase(riders));
  assert.equal(m.riderCount, riders.length); // alle sider hentet
  assert.deepEqual(m.match("Julian Alaphilippe"), { riderId: "target", teamId: "t9", status: "exact" });
});

test("buildRiderMatcher: verificeret alias matcher; alias mod ukendt DB-navn forbliver missing", async () => {
  const riders = [{ id: "r1", firstname: "Tobias", lastname: "Johannessen", team_id: "t1" }];
  // Injicér et midlertidigt alias for at teste forrangs-stien uden at låse til tabellens indhold
  PCM_RIDER_ALIASES["Tobias Halland Johannessen"] = "Tobias Johannessen";
  PCM_RIDER_ALIASES["Alias Til Ingenting"] = "Findes Ikke I Db";
  try {
    const m = await buildRiderMatcher(fakeSupabase(riders));
    const hit = m.match("Tobias Halland Johannessen");
    assert.equal(hit.riderId, "r1");
    assert.equal(hit.status, "exact"); // alias-resolved navn rammer exact-indekset
    // alias der peger på et navn DB ikke har → ingen falsk attribution
    assert.equal(m.match("Alias Til Ingenting").status, "missing");
  } finally {
    delete PCM_RIDER_ALIASES["Tobias Halland Johannessen"];
    delete PCM_RIDER_ALIASES["Alias Til Ingenting"];
  }
});

// ── GC-timing-pipeline (kernen) ───────────────────────────────────

// Byg et minimal-workbook for én etape.
function stageWorkbook({ current, total, stageRows, gcRows, pointsRows, mountainRows, youngRows, teamRows }) {
  const mk = (name, headers, rows) => ({ name, headers, rows, stageInfo: { current, total, isFinalStage: current === total } });
  return {
    stageInfo: { current, total, isFinalStage: current === total },
    sheets: [
      mk("Stage results", ["Rank", "Name", "Team", "Time"], stageRows || []),
      mk("General results", ["Rank", "Name", "Team", "Time"], gcRows || []),
      mk("Points", ["Rank", "Name", "Team", "Points", "General"], pointsRows || []),
      mk("Mountain", ["Rank", "Name", "Team", "Mountain", "General"], mountainRows || []),
      mk("Young results", ["Rank", "Name", "Team", "Time", "General Time"], youngRows || []),
      mk("Team results", ["Rank", "Team", "Time", "General Time"], teamRows || []),
    ],
  };
}

const riderMatcher = {
  match: (name) => (name ? { riderId: "r:" + name, teamId: "t:" + name, status: "exact" } : { riderId: null, teamId: null, status: "missing" }),
};
const teamMatcher = { matchGameName: (g) => ({ teamId: "team:" + g, status: "exact" }) };

const proSeriesPoints = {
  "stage__1": 20, "stage__2": 14, "stage__3": 12,
  "gc__1": 200, "gc__2": 150,
  "points__1": 32, "mountain__1": 32, "young__1": 16, "team__1": 10,
  "leader__1": 5, "points_day__1": 3, "mountain_day__1": 3, "young_day__1": 3,
};

test("endagsløb: kun gc + team, ingen stage-dobbelttælling", () => {
  const wb = stageWorkbook({
    current: 1, total: 1,
    stageRows: [["1", "Winner A", "Swatt Club", "4h00"]],
    gcRows: [["1", "Winner A", "Swatt Club", "4h00"], ["2", "Rider B", "Cofidis", "s.t."]],
    teamRows: [["1", "Swatt Club", "12h00", "12h00 (1)"]],
  });
  const race = { id: "race", race_type: "single" };
  const { resultRows, perTypeCounts } = buildPcmResultRows({
    raceFiles: [{ filename: "f", workbook: wb }],
    race, riderMatcher, teamMatcher, pointsLookup: proSeriesPoints,
  });
  // ingen "stage"-rækker for endagsløb
  assert.equal(perTypeCounts.stage, undefined);
  assert.equal(perTypeCounts.gc, 2);
  assert.equal(perTypeCounts.team, 1);
  const winner = resultRows.find((r) => r.result_type === "gc" && r.rank === 1);
  assert.equal(winner.points_earned, 200);
  assert.equal(winner.prize_money, 200 * PRIZE_PER_POINT);
});

test("etapeløb mellem-etape: stage-placering + KUN trøje-ledere (ingen fuld GC)", () => {
  const wb = stageWorkbook({
    current: 2, total: 5,
    stageRows: [["1", "Stage Winner", "Cofidis", "4h00"], ["2", "Rider B", "Swatt Club", "s.t."]],
    gcRows: [["1", "GC Leader", "Cofidis", "4h00"], ["2", "GC Second", "Swatt Club", "+10"]],
    pointsRows: [["1", "Points Leader", "Cofidis", "30", "30"]],
    mountainRows: [["1", "KOM Leader", "Cofidis", "12", "12"]],
    youngRows: [["1", "Young X", "Swatt Club", "4h00", "+ 4 (1)"], ["2", "Young Y", "Cofidis", "s.t.", "+ 5 (2)"]],
  });
  const race = { id: "race", race_type: "stage_race" };
  const { resultRows, perTypeCounts } = buildPcmResultRows({
    raceFiles: [{ filename: "f", workbook: wb }],
    race, riderMatcher, teamMatcher, pointsLookup: proSeriesPoints,
  });
  // Stage-placeringer for begge
  assert.equal(perTypeCounts.stage, 2);
  // INGEN fuld gc/points/mountain/young — kun *_day + leader
  assert.equal(perTypeCounts.gc, undefined);
  assert.equal(perTypeCounts.points, undefined);
  assert.equal(perTypeCounts.leader, 1);
  assert.equal(perTypeCounts.points_day, 1);
  assert.equal(perTypeCounts.mountain_day, 1);
  assert.equal(perTypeCounts.young_day, 1);
  // young-leder = parens(1) = "Young X"
  const yLeader = resultRows.find((r) => r.result_type === "young_day");
  assert.equal(yLeader.rider_name, "Young X");
  assert.equal(yLeader.points_earned, 3);
  // GC-leder får leder-point (5), ikke klassements-point (200)
  const leader = resultRows.find((r) => r.result_type === "leader");
  assert.equal(leader.rider_name, "GC Leader");
  assert.equal(leader.points_earned, 5);
});

test("etapeløb sidste etape: fuld GC + trøjer + hold udbetales", () => {
  const wb = stageWorkbook({
    current: 5, total: 5,
    stageRows: [["1", "Final Stage Winner", "Cofidis", "4h00"]],
    gcRows: [["1", "Overall Winner", "Swatt Club", "20h00"], ["2", "Overall Second", "Cofidis", "+30"]],
    pointsRows: [["1", "Green Jersey", "Cofidis", "120", "120"]],
    mountainRows: [["1", "Polka Dot", "Swatt Club", "60", "60"]],
    youngRows: [["1", "White Jersey", "Swatt Club", "4h00", "20h05 (1)"]],
    teamRows: [["1", "Swatt Club", "60h00", "60h00 (1)"]],
  });
  const race = { id: "race", race_type: "stage_race" };
  const { perTypeCounts, resultRows } = buildPcmResultRows({
    raceFiles: [{ filename: "f", workbook: wb }],
    race, riderMatcher, teamMatcher, pointsLookup: proSeriesPoints,
  });
  assert.equal(perTypeCounts.stage, 1);
  assert.equal(perTypeCounts.gc, 2);
  assert.equal(perTypeCounts.points, 1);
  assert.equal(perTypeCounts.mountain, 1);
  assert.equal(perTypeCounts.young, 1);
  assert.equal(perTypeCounts.team, 1);
  // ingen *_day på sidste etape
  assert.equal(perTypeCounts.leader, undefined);
  assert.equal(perTypeCounts.young_day, undefined);
  const overall = resultRows.find((r) => r.result_type === "gc" && r.rank === 1);
  assert.equal(overall.points_earned, 200);
});

test("hele etapeløb over 3 filer: stage hver etape, GC kun til sidst", () => {
  const files = [
    { filename: "s1", workbook: stageWorkbook({ current: 1, total: 3, stageRows: [["1", "A", "Cofidis", "4h"]], gcRows: [["1", "A", "Cofidis", "4h"]] }) },
    { filename: "s2", workbook: stageWorkbook({ current: 2, total: 3, stageRows: [["1", "B", "Swatt Club", "4h"]], gcRows: [["1", "A", "Cofidis", "8h"]] }) },
    { filename: "s3", workbook: stageWorkbook({ current: 3, total: 3, stageRows: [["1", "C", "Cofidis", "4h"]], gcRows: [["1", "A", "Cofidis", "12h"], ["2", "B", "Swatt Club", "+5"]] }) },
  ];
  const race = { id: "race", race_type: "stage_race" };
  const { perTypeCounts, resultRows } = buildPcmResultRows({
    raceFiles: files, race, riderMatcher, teamMatcher, pointsLookup: proSeriesPoints,
  });
  assert.equal(perTypeCounts.stage, 3); // én pr. etape
  assert.equal(perTypeCounts.gc, 2);    // kun sidste etapes GC (2 ryttere)
  // leder-point på etape 1+2 (ikke 3)
  assert.equal(perTypeCounts.leader, 2);
  const stageNums = [...new Set(resultRows.filter((r) => r.result_type === "stage").map((r) => r.stage_number))].sort();
  assert.deepEqual(stageNums, [1, 2, 3]);
});

test("umatchede scorende ryttere flagges (men 0-point-ryttere ignoreres)", () => {
  const matcher = {
    match: (name) => (name === "Known" ? { riderId: "r1", teamId: "t1", status: "exact" } : { riderId: null, teamId: null, status: "missing" }),
  };
  const wb = stageWorkbook({
    current: 1, total: 1,
    gcRows: [["1", "Unknown Scorer", "Cofidis", "4h"], ["50", "Unknown Tail", "Cofidis", "+5"]],
  });
  const race = { id: "race", race_type: "single" };
  const built = buildPcmResultRows({
    raceFiles: [{ filename: "f", workbook: wb }],
    race, riderMatcher: matcher, teamMatcher, pointsLookup: proSeriesPoints,
  });
  // rank 1 har 200 point + umatchet → tæller; rank 50 har 0 point → tæller ikke
  assert.equal(built.unmatchedScoring, 1);
  assert.deepEqual(built.unmatchedScoringNames, ["Unknown Scorer"]);
});

// ── Discord-embed ─────────────────────────────────────────────────

test("buildPcmImportEmbed laver felter pr. resultat-type", () => {
  const race = { name: "Test Tour", race_type: "stage_race" };
  const resultRows = [
    { result_type: "stage", rank: 1, stage_number: 1, rider_name: "Stage1 Winner" },
    { result_type: "stage", rank: 1, stage_number: 2, rider_name: "Stage2 Winner" },
    { result_type: "gc", rank: 1, rider_name: "Overall Winner" },
    { result_type: "gc", rank: 2, rider_name: "Runner Up" },
    { result_type: "points", rank: 1, rider_name: "Sprinter" },
    { result_type: "mountain", rank: 1, rider_name: "Climber" },
    { result_type: "team", rank: 1, team_name: "Swatt Club" },
  ];
  const preview = { rows: 7, unmatched_scoring: 0 };
  const embed = buildPcmImportEmbed({ race, preview, resultRows });
  assert.match(embed.title, /Test Tour/);
  const names = embed.fields.map((f) => f.name);
  assert.ok(names.some((n) => n.includes("Etapevindere")));
  assert.ok(names.some((n) => n.includes("Klassement")));
  assert.ok(names.some((n) => n.includes("Point")));
  assert.ok(names.some((n) => n.includes("Bjerg")));
  assert.ok(names.some((n) => n.includes("Hold")));
});

test("buildPcmImportEmbed advarer ved umatchede scorende ryttere", () => {
  const embed = buildPcmImportEmbed({
    race: { name: "X", race_type: "single" },
    preview: { rows: 10, unmatched_scoring: 2 },
    resultRows: [{ result_type: "gc", rank: 1, rider_name: "W" }],
  });
  assert.match(embed.description, /2 umatchede/);
});
