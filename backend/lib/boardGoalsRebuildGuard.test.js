// #4865 · Forward-guard: en rebuild af `board_profiles.current_goals` må ALDRIG
// tabe et mål med en fremmed `source`.
//
// Rod-årsagen (målt mod prod 5-6/9): både POST /board/sign (routes/api.js) og
// autoAcceptPendingPlan (boardAutoAccept.js) skrev `current_goals` som et
// FRISKT array fra buildBoardProposal + finalizeBoardGoals. Alt en anden sti
// havde lagt i arrayet forsvandt derfor ved næste plan-signering. 11 hold
// mistede på den måde deres accepterede bonustilbuds ekstra-mål
// (`source: "bonus_offer"`) mellem 23/8 og 1/9 — pengene (200.000 CZ$) blev
// stående, kravet forsvandt.
//
// Bevis for at det var netop signerings-stien: alle 11 rækker bar bagefter
// mindst ét mål med `negotiated: true`, og det flag kan KUN komme fra
// buildNegotiatedGoal via finalizeBoardGoals med et ikke-tomt
// negotiationIndexes — auto-accept sender altid `[]`.
//
// Testene her fejler FØR fixet og består efter:
//   1. preserveExternalGoals (ren funktion) — bevarer, dedupliker, no-op.
//   2. autoAcceptPendingPlan end-to-end via processBoardAutoAcceptCron.
//   3. Kilde-kontrakt: /board/sign's upsert komponerer current_goals via
//      preserveExternalGoals (samme scan-mønster som boardBankGuard.routes.test.js).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GENERATED_GOAL_SOURCES,
  finalizeBoardGoals,
  isGeneratedGoalSource,
  preserveExternalGoals,
} from "./boardGoals.js";
import { processBoardAutoAcceptCron } from "./boardAutoAccept.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;

const BONUS_GOAL = Object.freeze({
  type: "signature_rider",
  label: "Sign 1 star (popularity ≥75)",
  source: "bonus_offer",
  target: 1,
  cumulative: false,
});

// ── 1) preserveExternalGoals — ren funktion ─────────────────────────────────

test("#4865: rebuild af goals taber aldrig et bonus_offer-mål", () => {
  const rebuilt = finalizeBoardGoals({
    goals: [
      { type: "stage_wins", target: 4 },
      { type: "no_outstanding_debt", target: 0 },
    ],
    negotiationIndexes: [],
  });

  const merged = preserveExternalGoals({
    rebuiltGoals: rebuilt,
    previousGoals: [{ type: "top_n_finish", target: 4 }, BONUS_GOAL],
  });

  assert.equal(merged.length, rebuilt.length + 1, "det fremmede mål skal være med");
  assert.deepEqual(
    merged.filter((goal) => goal.source === "bonus_offer"),
    [BONUS_GOAL],
    "bonus-målet bæres ORDRET med over"
  );
  assert.deepEqual(
    merged.slice(0, rebuilt.length),
    rebuilt,
    "de genererede mål er uændrede og står først"
  );
});

test("#4865: genererede mål (ingen source + club_dna) bevares IKKE fra den gamle række", () => {
  // Ellers ville et forhandlet/lempet target blive gen-indsat ved siden af sin
  // egen erstatning, og en focus-ændring ville stable gamle mål oven på nye.
  const rebuilt = finalizeBoardGoals({ goals: [{ type: "stage_wins", target: 1 }] });
  const merged = preserveExternalGoals({
    rebuiltGoals: rebuilt,
    previousGoals: [
      { type: "stage_wins", target: 9 },
      { type: "jersey_wins", target: 2, source: "club_dna", cumulative: true },
      { type: "min_riders", target: 15, source: null },
      { type: "min_u25_riders", target: 7, source: "" },
    ],
  });

  assert.deepEqual(merged, rebuilt, "ingen genereret kilde må overleve en rebuild");
  assert.ok(GENERATED_GOAL_SOURCES.includes("club_dna"));
  assert.equal(isGeneratedGoalSource(undefined), true);
  assert.equal(isGeneratedGoalSource(null), true);
  assert.equal(isGeneratedGoalSource(""), true);
  assert.equal(isGeneratedGoalSource("club_dna"), true);
  assert.equal(isGeneratedGoalSource("bonus_offer"), false);
});

test("#4865: bonus-målet dubleres ikke — hverken på bonus_offer_id eller på indhold", () => {
  const withId = { ...BONUS_GOAL, bonus_offer_id: "offer-1" };

  // a) rebuild'en bærer allerede målet (fx en fremtidig sti der selv injicerer det)
  assert.equal(
    preserveExternalGoals({ rebuiltGoals: [withId], previousGoals: [withId] }).length,
    1
  );

  // b) samme tilbud to gange i den gamle række
  assert.equal(
    preserveExternalGoals({ rebuiltGoals: [], previousGoals: [withId, { ...withId }] }).length,
    1
  );

  // c) rækker skrevet FØR #4856 mangler bonus_offer_id → indholds-nøglen dedupliker
  assert.equal(
    preserveExternalGoals({ rebuiltGoals: [], previousGoals: [BONUS_GOAL, { ...BONUS_GOAL }] }).length,
    1
  );

  // d) to FORSKELLIGE tilbud er to mål
  assert.equal(
    preserveExternalGoals({
      rebuiltGoals: [],
      previousGoals: [withId, { ...BONUS_GOAL, bonus_offer_id: "offer-2" }],
    }).length,
    2
  );
});

test("#4865: dobbelt-encodet current_goals (jsonb-string) parses — præcis de 11 ramte rækker stod sådan", () => {
  // appendBonusGoalToBoardProfile skriver JSON.stringify(...) ind i jsonb-
  // kolonnen, så rækker med et bonus-mål stod som jsonb-`string`, ikke `array`.
  const merged = preserveExternalGoals({
    rebuiltGoals: [{ type: "stage_wins", target: 1 }],
    previousGoals: JSON.stringify([{ type: "min_riders", target: 10 }, BONUS_GOAL]),
  });
  assert.deepEqual(merged.at(-1), BONUS_GOAL);
});

test("#4865: tom/ugyldig historik er et rent no-op", () => {
  const rebuilt = [{ type: "stage_wins", target: 1 }];
  assert.deepEqual(preserveExternalGoals({ rebuiltGoals: rebuilt }), rebuilt);
  assert.deepEqual(preserveExternalGoals({ rebuiltGoals: rebuilt, previousGoals: [] }), rebuilt);
  assert.deepEqual(preserveExternalGoals({ rebuiltGoals: rebuilt, previousGoals: null }), rebuilt);
  assert.deepEqual(preserveExternalGoals({ rebuiltGoals: rebuilt, previousGoals: "" }), rebuilt);
  assert.deepEqual(preserveExternalGoals({ rebuiltGoals: rebuilt, previousGoals: "ikke json" }), rebuilt);
  assert.deepEqual(
    preserveExternalGoals({ rebuiltGoals: rebuilt, previousGoals: [null, 42, "x"] }),
    rebuilt
  );
  assert.deepEqual(preserveExternalGoals(), []);
});

// ── 2) autoAcceptPendingPlan end-to-end ─────────────────────────────────────

test("#4865: auto-accept af en pending 1yr-plan bevarer bonus_offer-målet i current_goals", async () => {
  const now = new Date("2026-07-16T15:00:00Z");
  const openedAt = new Date(now.getTime() - 30 * DAY_MS).toISOString();

  const state = {
    seasons: [
      { id: "season-3", number: 3, status: "active", race_days_completed: 10, race_days_total: 60 },
    ],
    teams: [
      {
        id: "team-1", user_id: "user-1", name: "Bonus FC",
        balance: 500000, sponsor_income: 240000, division: 3,
        season_1_identity_basis: null, team_dna_key: "sprint_kommerciel",
        created_at: openedAt,
        is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
      },
    ],
    board_profiles: [
      // ONBOARDING_PLAN_SEQUENCE er 5yr→3yr→1yr: uden de to signerede
      // søsterplaner ville findPendingPlanType pege på 5yr i stedet for 1yr.
      {
        id: "bp-5yr", team_id: "team-1", plan_type: "5yr", focus: "balanced",
        negotiation_status: "completed", is_baseline: false,
        satisfaction: 80, budget_modifier: 1.2, tradeoff_payload: null,
        current_goals: [], created_at: openedAt, updated_at: openedAt,
      },
      {
        id: "bp-3yr", team_id: "team-1", plan_type: "3yr", focus: "balanced",
        negotiation_status: "completed", is_baseline: false,
        satisfaction: 80, budget_modifier: 1.2, tradeoff_payload: null,
        current_goals: [], created_at: openedAt, updated_at: openedAt,
      },
      {
        id: "bp-1", team_id: "team-1", plan_type: "1yr", focus: "balanced",
        negotiation_status: "pending", is_baseline: false,
        satisfaction: 80, budget_modifier: 1.2, tradeoff_payload: null,
        current_goals: [{ type: "stage_wins", target: 4 }, BONUS_GOAL],
        created_at: openedAt, updated_at: openedAt,
      },
    ],
    riders: [],
    season_standings: [],
    users: [],
    transfer_windows: [],
  };

  const summary = await processBoardAutoAcceptCron({
    supabase: createFakeSupabase(state),
    notifyUser: async () => ({ delivered: true }),
    now,
    rolloutFloor: new Date(0),
  });

  assert.equal(summary.auto_accepted, 1, "holdet skal faktisk være auto-accepteret");

  const board = state.board_profiles.find((row) => row.id === "bp-1");
  assert.equal(board.negotiation_status, "completed");
  const bonusGoals = (board.current_goals || []).filter((goal) => goal?.source === "bonus_offer");
  assert.equal(
    bonusGoals.length, 1,
    "auto-accept genopbygger goals-arrayet — bonus-målet må ikke forsvinde med det"
  );
  assert.deepEqual(bonusGoals[0], BONUS_GOAL);
  assert.ok(
    (board.current_goals || []).length > 1,
    "de genererede mål skal stadig være skrevet"
  );
});

// ── 3) Kilde-kontrakt for POST /board/sign ──────────────────────────────────

test("#4865: POST /board/sign komponerer current_goals via preserveExternalGoals", () => {
  const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");
  const start = apiSource.indexOf('router.post("/board/sign"');
  assert.ok(start !== -1, "/board/sign-handleren skal findes");
  const end = apiSource.indexOf('router.post("/board/request"', start);
  const block = apiSource.slice(start, end === -1 ? start + 8000 : end);

  assert.match(
    block,
    /preserveExternalGoals\(\{[\s\S]*rebuiltGoals:\s*finalizeBoardGoals\(\{[\s\S]*previousGoals:\s*existingBoard\?\.current_goals/,
    "signeringen skal bære fremmede mål (bonus_offer) med over fra den eksisterende række"
  );
  assert.doesNotMatch(
    block,
    /current_goals:\s*finalizeBoardGoals\(/,
    "upserten må aldrig skrive et råt finalizeBoardGoals-array direkte"
  );
});

test("#4865: BOARD_AUTO_ACCEPT_SELECT henter current_goals", async () => {
  const { BOARD_AUTO_ACCEPT_SELECT } = await import("./boardAutoAccept.js");
  assert.match(
    BOARD_AUTO_ACCEPT_SELECT,
    /\bcurrent_goals\b/,
    "uden kolonnen er existingBoard.current_goals undefined og bonus-målet tabes igen"
  );
});
