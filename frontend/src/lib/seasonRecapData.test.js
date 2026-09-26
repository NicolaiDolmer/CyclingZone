import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSeasonMovement, resolveNextDivision, resolveSeasonMovement, pickRecapHighlights, isBoardVerdictShowable, pickMyClassicKing, buildRecapStatKeys } from "./seasonRecapData.js";

// ─── #5390 · buildRecapStatKeys (SeasonRecapHero's "holdets recap-række") ───
// Render-test på selve rækken: ingen DOM (node --test-uden-jsdom-konventionen
// resten af filen allerede følger) — buildRecapStatKeys er den rene derivation
// af HVILKE tiles der vises og med hvilken rå værdi, adskilt fra JSX/i18n, så
// testen beviser rækkens indhold uden at rendre komponenten.

test("buildRecapStatKeys: uden klassikersejre er rækken de 4 originale tiles, i uændret rækkefølge", () => {
  const keys = buildRecapStatKeys({ rank: 2, points: 1500, stageWins: 3, prizeWon: 40000 });
  assert.deepEqual(keys.map((k) => k.key), ["rank", "points", "stageWins", "prize"]);
});

test("buildRecapStatKeys: classicWins = 0 -> INGEN 5. tile (TASTE P11: intet tal for noget der ikke findes)", () => {
  const keys = buildRecapStatKeys({ rank: 2, points: 1500, stageWins: 3, prizeWon: 40000, classicWins: 0 });
  assert.equal(keys.length, 4);
  assert.ok(!keys.some((k) => k.key === "classicWins"));
});

test("buildRecapStatKeys: classicWins > 0 -> 5. tile tilføjes SIDST med den rå værdi", () => {
  const keys = buildRecapStatKeys({ rank: 2, points: 1500, stageWins: 3, prizeWon: 40000, classicWins: 2 });
  assert.deepEqual(keys.map((k) => k.key), ["rank", "points", "stageWins", "prize", "classicWins"]);
  assert.deepEqual(keys.at(-1), { key: "classicWins", value: 2 });
});

test("buildRecapStatKeys: manglende/undefined props giver stadig 4 gyldige tiles (ingen crash på et hold uden data endnu)", () => {
  const keys = buildRecapStatKeys({});
  assert.deepEqual(keys.map((k) => k.key), ["rank", "points", "stageWins", "prize"]);
  assert.equal(keys.find((k) => k.key === "rank").value, null);
});

test("buildRecapStatKeys: negativt classicWins (bør aldrig forekomme) skjules ligesom 0", () => {
  const keys = buildRecapStatKeys({ classicWins: -1 });
  assert.ok(!keys.some((k) => k.key === "classicWins"));
});

// ─── computeSeasonMovement ──────────────────────────────────────────────────

test("computeSeasonMovement: lower next division = promoted", () => {
  assert.equal(computeSeasonMovement(3, 2), "promoted");
});

test("computeSeasonMovement: higher next division = relegated", () => {
  assert.equal(computeSeasonMovement(2, 3), "relegated");
});

test("computeSeasonMovement: same division = maintained", () => {
  assert.equal(computeSeasonMovement(2, 2), "maintained");
});

test("computeSeasonMovement: missing finishedDivision = null", () => {
  assert.equal(computeSeasonMovement(null, 2), null);
});

test("computeSeasonMovement: missing nextDivision = null", () => {
  assert.equal(computeSeasonMovement(2, undefined), null);
});

// ─── resolveNextDivision ─────────────────────────────────────────────────────

test("resolveNextDivision: prefers a real next-season standings row", () => {
  assert.equal(
    resolveNextDivision({ nextSeasonStandingDivision: 2, nextSeasonStatus: "active", currentTeamDivision: 4 }),
    2
  );
});

test("resolveNextDivision: falls back to current team division when next season is active with no standings row yet", () => {
  assert.equal(
    resolveNextDivision({ nextSeasonStandingDivision: null, nextSeasonStatus: "active", currentTeamDivision: 2 }),
    2
  );
});

test("resolveNextDivision: does NOT use current team division when next season is not active (stale data risk)", () => {
  assert.equal(
    resolveNextDivision({ nextSeasonStandingDivision: null, nextSeasonStatus: "completed", currentTeamDivision: 2 }),
    null
  );
});

test("resolveNextDivision: next season does not exist at all -> null", () => {
  assert.equal(resolveNextDivision({}), null);
});

// ─── resolveSeasonMovement (shared helper, DashboardPage + SeasonEndPage) ────

test("resolveSeasonMovement: combines resolveNextDivision + computeSeasonMovement (real next-season standings row)", () => {
  assert.equal(
    resolveSeasonMovement({ finishedDivision: 3, nextSeasonStandingDivision: 2, nextSeasonStatus: "active", currentTeamDivision: 3 }),
    "promoted"
  );
});

test("resolveSeasonMovement: falls back to current team division when next season is active with no standings row yet", () => {
  assert.equal(
    resolveSeasonMovement({ finishedDivision: 3, nextSeasonStandingDivision: null, nextSeasonStatus: "active", currentTeamDivision: 3 }),
    "maintained"
  );
});

test("resolveSeasonMovement: unknown next division -> null (not 'maintained')", () => {
  assert.equal(
    resolveSeasonMovement({ finishedDivision: 3, nextSeasonStandingDivision: null, nextSeasonStatus: "completed", currentTeamDivision: 3 }),
    null
  );
});

// ─── pickRecapHighlights ─────────────────────────────────────────────────────

test("pickRecapHighlights: empty inputs -> no highlights", () => {
  assert.deepEqual(pickRecapHighlights({ myTeamId: "t1" }), []);
});

test("pickRecapHighlights: division prize leader is included", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    divisionStandings: [{ team_id: "t1" }, { team_id: "t2" }],
    prizeByTeam: { t1: 500000, t2: 100000 },
  });
  assert.deepEqual(highlights, [{ kind: "prizeLeader", amount: 500000 }]);
});

test("pickRecapHighlights: not the division prize leader -> no prizeLeader highlight", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t2",
    divisionStandings: [{ team_id: "t1" }, { team_id: "t2" }],
    prizeByTeam: { t1: 500000, t2: 100000 },
  });
  assert.deepEqual(highlights, []);
});

test("pickRecapHighlights: zero-prize leader does not count as a highlight", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    divisionStandings: [{ team_id: "t1" }],
    prizeByTeam: { t1: 0 },
  });
  assert.deepEqual(highlights, []);
});

test("pickRecapHighlights: biggest sale included when present", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    myBiggestSale: { amount: 250000, description: "Solgt Test Rider via transfer" },
  });
  assert.deepEqual(highlights, [
    { kind: "biggestSale", amount: 250000, name: "Solgt Test Rider via transfer" },
  ]);
});

test("pickRecapHighlights: stage king included when present", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    myStageKing: { riderId: "r1", name: "Marco Bittner", wins: 6 },
  });
  assert.deepEqual(highlights, [{ kind: "stageKing", wins: 6, name: "Marco Bittner" }]);
});

test("pickRecapHighlights: combines all three, capped at 3, in prize/sale/stage order", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    divisionStandings: [{ team_id: "t1" }],
    prizeByTeam: { t1: 300000 },
    myBiggestSale: { amount: 100000, description: "Solgt X" },
    myStageKing: { riderId: "r1", name: "Y", wins: 3 },
  });
  assert.deepEqual(highlights.map((h) => h.kind), ["prizeLeader", "biggestSale", "stageKing"]);
});

test("pickRecapHighlights: myBiggestSale with amount 0 is ignored", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    myBiggestSale: { amount: 0, description: "Free transfer" },
  });
  assert.deepEqual(highlights, []);
});

// ─── pickRecapHighlights: guaranteed-3 fallback (documentaryFacts) ──────────

test("pickRecapHighlights: mid-table team with none of the first three falls back to all 3 documentary facts", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    divisionStandings: [{ team_id: "t1" }, { team_id: "t2" }],
    prizeByTeam: { t1: 0, t2: 500000 },
    documentaryFacts: {
      bestRaceDay: { race_id: "r1", race_name: "Tour de Test", total_points: 240, riders_scoring: 3 },
      biggestResult: { rider_name: "Rider One", race_name: "Grand Prix" },
      rival: { team_name: "Rival FC", total_points: 900, gap: 15 },
      myStanding: { total_points: 885 },
    },
  });
  assert.deepEqual(highlights.map((h) => h.kind), ["turningPoint", "biggestResult", "rival"]);
});

test("pickRecapHighlights: only fills the REMAINING slots when some of the first three are already present", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    myStageKing: { riderId: "r1", name: "Marco Bittner", wins: 4 },
    documentaryFacts: {
      bestRaceDay: { race_id: "r1", race_name: "Tour de Test", total_points: 240, riders_scoring: 3 },
      biggestResult: { rider_name: "Rider One", race_name: "Grand Prix" },
      rival: { team_name: "Rival FC", total_points: 900, gap: 15 },
      myStanding: { total_points: 885 },
    },
  });
  assert.deepEqual(highlights.map((h) => h.kind), ["stageKing", "turningPoint", "biggestResult"]);
});

test("pickRecapHighlights: rival fallback marks 'ahead' correctly from myStanding vs rival points", () => {
  const behind = pickRecapHighlights({
    myTeamId: "t1",
    documentaryFacts: { rival: { team_name: "Rival FC", total_points: 900, gap: 15 }, myStanding: { total_points: 885 } },
  });
  assert.equal(behind[0].kind, "rival");
  assert.equal(behind[0].ahead, false);

  const ahead = pickRecapHighlights({
    myTeamId: "t1",
    documentaryFacts: { rival: { team_name: "Rival FC", total_points: 800, gap: 15 }, myStanding: { total_points: 815 } },
  });
  assert.equal(ahead[0].ahead, true);
});

test("pickRecapHighlights: missing documentaryFacts entirely -> still degrades to whatever the first three gave (no crash)", () => {
  const highlights = pickRecapHighlights({ myTeamId: "t1" });
  assert.deepEqual(highlights, []);
});

test("pickRecapHighlights: partial documentaryFacts (no rival, e.g. alone in division) fills only what exists", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    documentaryFacts: {
      bestRaceDay: { race_id: "r1", race_name: "Tour de Test", total_points: 240, riders_scoring: 3 },
      biggestResult: { rider_name: "Rider One", race_name: "Grand Prix" },
      rival: null,
      myStanding: { total_points: 885 },
    },
  });
  assert.deepEqual(highlights.map((h) => h.kind), ["turningPoint", "biggestResult"]);
});

// ─── #5753 · bestyrelsens dom (boardVerdict) ────────────────────────────────

const VERDICT = {
  enabled: true,
  seasonNumber: 3,
  goalsMet: 3,
  goalsTotal: 4,
  confidenceBefore: 50,
  confidenceAfter: 64,
  chairman: { name: "Chair Person", initials: "CP", archetypeKey: "sponsoraten", quoteKey: "archetypes.sponsoraten.reactions.receipt_positive.0", quoteFallbackDa: "Tekst" },
  mandateStatus: "completed",
  meetingAvailable: true,
};

test("pickRecapHighlights: boardVerdict står FØRST og bærer dommens felter", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    myStageKing: { riderId: "r1", name: "Y", wins: 3 },
    boardVerdict: VERDICT,
  });
  assert.deepEqual(highlights.map((h) => h.kind), ["boardVerdict", "stageKing"]);
  assert.deepEqual(highlights[0], {
    kind: "boardVerdict",
    goalsMet: 3,
    goalsTotal: 4,
    confidenceBefore: 50,
    confidenceAfter: 64,
    chairman: VERDICT.chairman,
    meetingAvailable: true,
  });
});

test("pickRecapHighlights: boardVerdict tager en af de 3 pladser (loftet er uændret)", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    divisionStandings: [{ team_id: "t1" }],
    prizeByTeam: { t1: 300000 },
    myBiggestSale: { amount: 100000, description: "Solgt X" },
    myStageKing: { riderId: "r1", name: "Y", wins: 3 },
    boardVerdict: VERDICT,
  });
  assert.deepEqual(highlights.map((h) => h.kind), ["boardVerdict", "prizeLeader", "biggestSale"]);
});

test("pickRecapHighlights: boardVerdict + dokumentar-fallback fylder op til 3", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    boardVerdict: VERDICT,
    documentaryFacts: {
      bestRaceDay: { race_id: "r1", race_name: "Tour de Test", total_points: 240, riders_scoring: 3 },
      biggestResult: { rider_name: "Rider One", race_name: "Grand Prix" },
      rival: { team_name: "Rival FC", total_points: 900, gap: 15 },
      myStanding: { total_points: 885 },
    },
  });
  assert.deepEqual(highlights.map((h) => h.kind), ["boardVerdict", "turningPoint", "biggestResult"]);
});

test("pickRecapHighlights: ingen boardVerdict når flaget er slået fra eller dommen mangler kvitteringer", () => {
  assert.deepEqual(pickRecapHighlights({ myTeamId: "t1", boardVerdict: { enabled: false } }), []);
  assert.deepEqual(pickRecapHighlights({ myTeamId: "t1", boardVerdict: { ...VERDICT, goalsMet: null } }), []);
  assert.deepEqual(pickRecapHighlights({ myTeamId: "t1", boardVerdict: null }), []);
});

// ─── #5390 · pickMyClassicKing ──────────────────────────────────────────────
// #5390 (CodeRabbit-fund 26/9): pickMyClassicKing slår IKKE længere op via
// rytterens NUVÆRENDE team_id (det gav forkert hold-tilskrivning ved et
// sæson-midt-salg) — den er nu et rent opslag i RPC'ens allerede korrekt
// hold-attribuerede team_classic_king-map.

const TEAM_CLASSIC_KING = {
  tMine: { rider_id: "r2", firstname: "Britt", lastname: "Bravo", wins: 2 },
  tOther: { rider_id: "r1", firstname: "Anna", lastname: "Alfa", wins: 3 },
};

test("pickMyClassicKing: finder mit holds klassiker-konge i team_classic_king", () => {
  assert.deepEqual(pickMyClassicKing(TEAM_CLASSIC_KING, "tMine"), {
    riderId: "r2", name: "Britt Bravo", wins: 2,
  });
});

test("pickMyClassicKing: mit hold har ingen nøgle i team_classic_king -> null", () => {
  assert.equal(pickMyClassicKing(TEAM_CLASSIC_KING, "tUkendt"), null);
});

test("pickMyClassicKing: 0 sejre (bør ikke forekomme, RPC'en udelader 0-hold) tælles alligevel som 'ingen' for en sikkerheds skyld", () => {
  assert.equal(pickMyClassicKing({ tMine: { rider_id: "r9", firstname: "X", lastname: "Y", wins: 0 } }, "tMine"), null);
});

test("pickMyClassicKing: manglende myTeamId eller manglende map -> null uden at crashe", () => {
  assert.equal(pickMyClassicKing(TEAM_CLASSIC_KING, null), null);
  assert.equal(pickMyClassicKing({}, "tMine"), null);
  assert.equal(pickMyClassicKing(undefined, "tMine"), null);
});

// ─── #5390 · pickRecapHighlights + classicKing ──────────────────────────────

test("pickRecapHighlights: classic king included when present, samme plads-mønster som stage king", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    myClassicKing: { riderId: "r1", name: "Anna Alfa", wins: 2 },
  });
  assert.deepEqual(highlights, [{ kind: "classicKing", wins: 2, name: "Anna Alfa" }]);
});

test("pickRecapHighlights: stage king og classic king kan begge være med, i den rækkefølge, indtil loftet på 3", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    divisionStandings: [{ team_id: "t1" }],
    prizeByTeam: { t1: 300000 },
    myStageKing: { riderId: "r1", name: "Y", wins: 3 },
    myClassicKing: { riderId: "r2", name: "Z", wins: 1 },
  });
  assert.deepEqual(highlights.map((h) => h.kind), ["prizeLeader", "stageKing", "classicKing"]);
});

test("pickRecapHighlights: myClassicKing med 0 sejre tæller ikke som highlight", () => {
  assert.deepEqual(
    pickRecapHighlights({ myTeamId: "t1", myClassicKing: { riderId: "r1", name: "Anna", wins: 0 } }),
    [],
  );
});

test("pickRecapHighlights: uden myClassicKing (eksisterende opkald) er adfærden UÆNDRET", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    myStageKing: { riderId: "r1", name: "Marco Bittner", wins: 6 },
  });
  assert.deepEqual(highlights, [{ kind: "stageKing", wins: 6, name: "Marco Bittner" }]);
});

test("isBoardVerdictShowable: kræver enabled, tal for mål og mindst ét mål", () => {
  assert.equal(isBoardVerdictShowable(VERDICT), true);
  assert.equal(isBoardVerdictShowable({ ...VERDICT, goalsMet: 0 }), true, "0 af 4 er en ægte dom");
  assert.equal(isBoardVerdictShowable({ ...VERDICT, goalsTotal: 0 }), false);
  assert.equal(isBoardVerdictShowable({ ...VERDICT, enabled: false }), false);
  assert.equal(isBoardVerdictShowable({ ...VERDICT, goalsMet: null }), false);
  assert.equal(isBoardVerdictShowable(undefined), false);
});
