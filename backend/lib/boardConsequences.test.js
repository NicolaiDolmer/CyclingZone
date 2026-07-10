// S-02e · Tests for konsekvens-tier-motoren.
// Pattern: hver lag får (a) trigger-positive case, (b) trigger-negative case,
// (c) idempotency-replay. Plus integration: assertSigningAllowed afviser korrekt
// for både salary-cap og signing-restriktion, og bonus-offer accept/decline-flow.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CONSEQUENCE_CONSTANTS,
  CONSEQUENCE_LAYERS,
  acceptBonusOffer,
  assertSalaryIncreaseAllowed,
  assertSigningAllowed,
  declineBonusOffer,
  evaluateAndApplyConsequences,
  expireSeasonScopedConsequences,
  getActiveConsequencesForTeam,
  getActiveSponsorPulloutFactor,
  getLayerLabel,
  isBonusOfferEligible,
  markForcedListingFulfilled,
  selectBonusExtraGoal,
  selectForcedListingRider,
} from "./boardConsequences.js";
import { STAR_RIDER_MARKET_VALUE } from "./economyConstants.js";

// =====================================================================
// Constants + helpers
// =====================================================================

test("CONSEQUENCE_LAYERS maps lag 2-6 to numeric values", () => {
  assert.equal(CONSEQUENCE_LAYERS.SALARY_CAP, 2);
  assert.equal(CONSEQUENCE_LAYERS.SIGNING_RESTRICTION, 3);
  assert.equal(CONSEQUENCE_LAYERS.FORCED_LISTING, 4);
  assert.equal(CONSEQUENCE_LAYERS.SPONSOR_PULLOUT, 5);
  assert.equal(CONSEQUENCE_LAYERS.BONUS_OFFER, 6);
});

test("getLayerLabel returns EN labels for known lag (i18n via getLayerLabelKey)", () => {
  // #666: getLayerLabel returnerer EN; locale-rendering kommer fra getLayerLabelKey via i18n.
  assert.equal(getLayerLabel(2), "Salary cap");
  assert.equal(getLayerLabel(4), "Forced listing");
  assert.equal(getLayerLabel(99), "Layer 99");
});

test("CONSEQUENCE_CONSTANTS lock Q-batch 1B Q11 thresholds", () => {
  assert.equal(CONSEQUENCE_CONSTANTS.SATISFACTION_THRESHOLDS.SALARY_CAP, 40);
  assert.equal(CONSEQUENCE_CONSTANTS.SATISFACTION_THRESHOLDS.SIGNING_RESTRICTION, 30);
  assert.equal(CONSEQUENCE_CONSTANTS.SATISFACTION_THRESHOLDS.FORCED_LISTING, 15);
  assert.equal(CONSEQUENCE_CONSTANTS.SATISFACTION_THRESHOLDS.SPONSOR_PULLOUT, 10);
  assert.equal(CONSEQUENCE_CONSTANTS.SATISFACTION_THRESHOLDS.BONUS_OFFER, 75);
});

// =====================================================================
// selectForcedListingRider — lowest market_value, protect stars
// =====================================================================

test("selectForcedListingRider picks lowest market_value among unprotected", () => {
  const target = selectForcedListingRider([
    { id: "r-1", market_value: 80_000, popularity: 30 },
    { id: "r-2", market_value: 50_000, popularity: 30 },
    { id: "r-3", market_value: 120_000, popularity: 30 },
  ]);
  assert.equal(target.id, "r-2");
});

test("selectForcedListingRider protects popularity >= 70", () => {
  const target = selectForcedListingRider([
    { id: "r-star", market_value: 20_000, popularity: 80 },
    { id: "r-other", market_value: 60_000, popularity: 30 },
  ]);
  assert.equal(target.id, "r-other", "Star with low value must not be selected");
});

test("selectForcedListingRider protects market_value >= STAR_RIDER_MARKET_VALUE (#1205)", () => {
  // Begge over tærsklen → ingen kandidat; lige under tærsklen → vælges.
  // Referér konstanten (#1210) så re-kalibreringer ikke brækker testen.
  const allStars = selectForcedListingRider([
    { id: "r-star-1", market_value: STAR_RIDER_MARKET_VALUE, popularity: 30 },
    { id: "r-star-2", market_value: STAR_RIDER_MARKET_VALUE * 2, popularity: 30 },
  ]);
  assert.equal(allStars, null, "Roster of only stars must not force-list anyone");

  const target = selectForcedListingRider([
    { id: "r-almost-star", market_value: STAR_RIDER_MARKET_VALUE - 1, popularity: 30 },
    { id: "r-star", market_value: STAR_RIDER_MARKET_VALUE, popularity: 30 },
  ]);
  assert.equal(target.id, "r-almost-star", "Boundary: threshold is protected, threshold-1 is not");
});

test("selectForcedListingRider ignores frozen uci_points (#1101 decoupling)", () => {
  const target = selectForcedListingRider([
    { id: "r-frozen-uci", market_value: 20_000, popularity: 30, uci_points: 150 },
    { id: "r-other", market_value: 60_000, popularity: 30, uci_points: 50 },
  ]);
  assert.equal(target.id, "r-frozen-uci", "uci_points must no longer protect");
});

test("selectForcedListingRider returns null when all riders are protected", () => {
  const target = selectForcedListingRider([
    { id: "r-1", market_value: 20_000, popularity: 80 },
    { id: "r-2", market_value: STAR_RIDER_MARKET_VALUE + 1_000_000, popularity: 30 },
  ]);
  assert.equal(target, null);
});

test("selectForcedListingRider returns null for empty roster", () => {
  assert.equal(selectForcedListingRider([]), null);
  assert.equal(selectForcedListingRider(null), null);
});

test("selectForcedListingRider tie-breaks deterministically by id", () => {
  const target = selectForcedListingRider([
    { id: "z-rider", market_value: 50_000, popularity: 30 },
    { id: "a-rider", market_value: 50_000, popularity: 30 },
  ]);
  assert.equal(target.id, "a-rider");
});

// =====================================================================
// isBonusOfferEligible
// =====================================================================

test("isBonusOfferEligible requires satisfaction > 75 AND ≥75% goals met", () => {
  assert.equal(isBonusOfferEligible({ satisfaction: 80, goalsMet: 4, goalsTotal: 5 }), true);
  assert.equal(isBonusOfferEligible({ satisfaction: 75, goalsMet: 4, goalsTotal: 5 }), false, "75 is NOT > 75");
  assert.equal(isBonusOfferEligible({ satisfaction: 80, goalsMet: 3, goalsTotal: 5 }), false, "60% < 75%");
  assert.equal(isBonusOfferEligible({ satisfaction: 90, goalsMet: 0, goalsTotal: 0 }), false, "no goals");
});

// =====================================================================
// selectBonusExtraGoal
// =====================================================================

test("selectBonusExtraGoal picks signature_rider for star_signing focus", () => {
  const goal = selectBonusExtraGoal({ focus: "star_signing" });
  assert.equal(goal.type, "signature_rider");
  // #2308 · target er ANTAL kvalificerende ryttere (evalueres i boardGoals.js
  // som riders.filter(popularity>=75).length >= target). target: 75 var
  // matematisk uopfyldeligt (kræver 75 ryttere med popularity>=75); "Sign 1
  // star" betyder target: 1.
  assert.equal(goal.target, 1);
});

test("selectBonusExtraGoal defaults to monument_podium for non-star focuses", () => {
  assert.equal(selectBonusExtraGoal({ focus: "youth_development" }).type, "monument_podium");
  assert.equal(selectBonusExtraGoal({ focus: "balanced" }).type, "monument_podium");
  assert.equal(selectBonusExtraGoal({}).type, "monument_podium");
});

// =====================================================================
// evaluateAndApplyConsequences — per-lag triggers + idempotency
// =====================================================================

function makeBaseTeam({ riders = [] } = {}) {
  return { id: "team-1", name: "Test Team", riders };
}
function makeBaseBoard() {
  return { id: "board-1", focus: "balanced" };
}

test("evaluateAndApplyConsequences inserts salary_cap at sat<40 with 1.5x headroom (#2237)", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const team = makeBaseTeam({
    riders: [{ id: "r-1", salary: 30_000 }, { id: "r-2", salary: 20_000 }],
  });

  const result = await evaluateAndApplyConsequences({
    supabase,
    team,
    board: makeBaseBoard(),
    newSatisfaction: 35,
    previousSatisfaction: 32, // #2237: krise skal være vedvarende (2 evalueringer i træk)
    goalsMet: 1,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
  });

  const layers = result.applied.map((a) => a.layer);
  assert.ok(layers.includes(2), "Layer 2 must be applied");
  const cap = supabase.state.board_consequences.find((c) => c.layer === 2 && c.status === "active");
  assert.ok(cap);
  assert.equal(cap.severity, 75_000, "Cap = 1.5x current total salary (50K), not the frozen raw sum");
});

test("evaluateAndApplyConsequences guards against cap≈0 via SALARY_CAP_FLOOR (#2237)", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const team = makeBaseTeam({ riders: [{ id: "r-1", salary: 0 }] });

  await evaluateAndApplyConsequences({
    supabase,
    team,
    board: makeBaseBoard(),
    newSatisfaction: 35,
    previousSatisfaction: 32,
    goalsMet: 1,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
  });

  const cap = supabase.state.board_consequences.find((c) => c.layer === 2 && c.status === "active");
  assert.equal(cap.severity, CONSEQUENCE_CONSTANTS.SALARY_CAP_FLOOR, "Zero-salary roster must not freeze cap to 0");
});

test("evaluateAndApplyConsequences does NOT create salary_cap on a single dip below 40% (#2237)", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const team = makeBaseTeam({ riders: [{ id: "r-1", salary: 30_000 }] });

  const result = await evaluateAndApplyConsequences({
    supabase,
    team,
    board: makeBaseBoard(),
    newSatisfaction: 35,
    previousSatisfaction: 55, // forrige evaluering var IKKE i krise
    goalsMet: 1,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
  });

  assert.equal(supabase.state.board_consequences.filter((c) => c.layer === 2).length, 0);
  assert.ok(result.skipped.some((s) => s.layer === 2 && s.reason === "first_dip_not_sustained"));
});

test("evaluateAndApplyConsequences does NOT create salary_cap when previousSatisfaction is unknown (first-ever evaluation) (#2237)", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const team = makeBaseTeam({ riders: [{ id: "r-1", salary: 30_000 }] });

  const result = await evaluateAndApplyConsequences({
    supabase,
    team,
    board: makeBaseBoard(),
    newSatisfaction: 35,
    // previousSatisfaction omitted → null default (ingen tidligere data at bekræfte mod)
    goalsMet: 1,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
  });

  assert.equal(supabase.state.board_consequences.filter((c) => c.layer === 2).length, 0);
  assert.ok(result.skipped.some((s) => s.layer === 2 && s.reason === "first_dip_not_sustained"));
});

test("evaluateAndApplyConsequences never creates salary_cap for a team within its first 30 days, even with sustained low satisfaction (#2237)", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const now = new Date("2026-07-07T00:00:00Z");
  const team = makeBaseTeam({
    riders: [{ id: "r-1", salary: 30_000 }],
  });
  team.created_at = new Date("2026-07-01T00:00:00Z").toISOString(); // 6 dage gammel

  const result = await evaluateAndApplyConsequences({
    supabase,
    team,
    board: makeBaseBoard(),
    newSatisfaction: 20,
    previousSatisfaction: 18, // vedvarende krise — ville ellers udløse cappen
    goalsMet: 0,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
    now,
  });

  assert.equal(supabase.state.board_consequences.filter((c) => c.layer === 2).length, 0);
  assert.ok(result.skipped.some((s) => s.layer === 2 && s.reason === "new_manager_grace"));
});

test("evaluateAndApplyConsequences allows salary_cap once the 30-day new-manager grace has passed (#2237)", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const now = new Date("2026-07-07T00:00:00Z");
  const team = makeBaseTeam({ riders: [{ id: "r-1", salary: 30_000 }] });
  team.created_at = new Date("2026-06-01T00:00:00Z").toISOString(); // 36 dage gammel

  const result = await evaluateAndApplyConsequences({
    supabase,
    team,
    board: makeBaseBoard(),
    newSatisfaction: 20,
    previousSatisfaction: 18,
    goalsMet: 0,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
    now,
  });

  assert.ok(result.applied.some((a) => a.layer === 2));
});

test("evaluateAndApplyConsequences never lowers an existing cap on re-evaluation (#2237)", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "cap-1", team_id: "team-1", layer: 2, severity: 90_000, status: "active", payload: {} },
    ],
  });
  // Lønsummen er nu FALDET siden cappen blev sat (fx efter en tvunget listing).
  const team = makeBaseTeam({ riders: [{ id: "r-1", salary: 10_000 }] });

  await evaluateAndApplyConsequences({
    supabase,
    team,
    board: makeBaseBoard(),
    newSatisfaction: 35,
    goalsMet: 1,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
  });

  // Ingen ny row indsat (severity uændret) — den gamle, højere cap forbliver aktiv.
  const cap = supabase.state.board_consequences.find((c) => c.id === "cap-1");
  assert.equal(cap.status, "active");
  assert.equal(cap.severity, 90_000, "Cap må aldrig strammes bagud — kun re-evalueres opad");
});

test("evaluateAndApplyConsequences expires salary_cap when sat rises ≥40", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "old-cap", team_id: "team-1", layer: 2, severity: 100_000, status: "active", payload: {} },
    ],
  });

  await evaluateAndApplyConsequences({
    supabase,
    team: makeBaseTeam({ riders: [{ salary: 50_000 }] }),
    board: makeBaseBoard(),
    newSatisfaction: 60,
    goalsMet: 2,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
  });

  const cap = supabase.state.board_consequences.find((c) => c.id === "old-cap");
  assert.equal(cap.status, "expired");
});

test("evaluateAndApplyConsequences skips salary_cap when severity unchanged (idempotency)", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "cap-1", team_id: "team-1", layer: 2, severity: 75_000, status: "active", payload: {} },
    ],
  });
  const team = makeBaseTeam({
    riders: [{ id: "r-1", salary: 50_000 }],
  });

  const result = await evaluateAndApplyConsequences({
    supabase,
    team,
    board: makeBaseBoard(),
    newSatisfaction: 35,
    goalsMet: 1,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
  });

  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "unchanged");
});

test("evaluateAndApplyConsequences inserts signing_restriction at sat<30", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const result = await evaluateAndApplyConsequences({
    supabase,
    team: makeBaseTeam({ riders: [{ salary: 30_000 }] }),
    board: makeBaseBoard(),
    newSatisfaction: 25,
    goalsMet: 1,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
  });

  const restriction = supabase.state.board_consequences.find((c) => c.layer === 3 && c.status === "active");
  assert.ok(restriction);
  assert.equal(restriction.severity, 300_000, "Pris-tærskel = 300K");
  assert.ok(result.applied.find((a) => a.layer === 3));
});

test("evaluateAndApplyConsequences inserts forced_listing at sat<15 + sends notif", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [], transfer_listings: [] });
  const notifications = [];
  const team = {
    id: "team-1",
    name: "Test Team",
    riders: [
      { id: "r-cheap", market_value: 40_000, popularity: 30, firstname: "Cheap", lastname: "Rider", salary: 4_000 },
      { id: "r-star", market_value: 20_000, popularity: 80, firstname: "Star", lastname: "Rider", salary: 2_000 },
    ],
  };

  await evaluateAndApplyConsequences({
    supabase,
    team,
    board: makeBaseBoard(),
    newSatisfaction: 12,
    goalsMet: 0,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
    notify: (payload) => notifications.push(payload),
  });

  const listing = supabase.state.transfer_listings[0];
  assert.ok(listing);
  assert.equal(listing.rider_id, "r-cheap");
  assert.equal(listing.asking_price, 40_000);
  assert.equal(listing.status, "open");

  const consequence = supabase.state.board_consequences.find((c) => c.layer === 4);
  assert.ok(consequence);
  assert.equal(consequence.payload.rider_id, "r-cheap");
  assert.equal(consequence.payload.listing_id, listing.id);

  const notif = notifications.find((n) => n.title === "The board demands a sale");
  assert.ok(notif);
  assert.equal(notif.type, "board_critical");
  // #666: metadata sikrer locale-rendering i frontend
  assert.equal(notif.metadata?.titleCode, "notif.boardForcedListing.title");
  assert.equal(notif.metadata?.messageCode, "notif.boardForcedListing.message");
});

test("evaluateAndApplyConsequences skips forced_listing when no eligible rider exists", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [], transfer_listings: [] });
  const team = {
    id: "team-1",
    name: "All-Star Team",
    riders: [{ id: "r-1", market_value: 200_000, popularity: 90 }],
  };

  await evaluateAndApplyConsequences({
    supabase,
    team,
    board: makeBaseBoard(),
    newSatisfaction: 12,
    goalsMet: 0,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
  });

  assert.equal(supabase.state.transfer_listings.length, 0);
  assert.equal(supabase.state.board_consequences.filter((c) => c.layer === 4).length, 0);
});

// #805 · Board test-mode: lag 4/5 (reelle økonomiske konsekvenser) suppress.
test("evaluateAndApplyConsequences suppresses forced_listing in board test-mode", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [], transfer_listings: [] });
  const notifications = [];
  const team = {
    id: "team-1",
    name: "Test Team",
    riders: [
      { id: "r-cheap", market_value: 40_000, popularity: 30, firstname: "Cheap", lastname: "Rider", salary: 4_000 },
    ],
  };

  const result = await evaluateAndApplyConsequences({
    supabase,
    team,
    board: makeBaseBoard(),
    newSatisfaction: 12,
    goalsMet: 0,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
    boardTestMode: true,
    notify: (payload) => notifications.push(payload),
  });

  // Ingen reel listing, ingen lag-4-row, ingen notify (ærlig player-facing copy).
  assert.equal(supabase.state.transfer_listings.length, 0);
  assert.equal(supabase.state.board_consequences.filter((c) => c.layer === 4).length, 0);
  assert.equal(notifications.length, 0);
  assert.ok(result.skipped.some((s) => s.layer === 4 && s.reason === "test_mode_suppressed"));
});

test("evaluateAndApplyConsequences suppresses sponsor_pullout in board test-mode", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const notifications = [];

  const result = await evaluateAndApplyConsequences({
    supabase,
    team: makeBaseTeam({ riders: [{ market_value: 50_000, popularity: 30 }] }),
    board: makeBaseBoard(),
    newSatisfaction: 8,
    goalsMet: 0,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
    boardTestMode: true,
    notify: (p) => notifications.push(p),
  });

  assert.equal(supabase.state.board_consequences.filter((c) => c.layer === 5).length, 0);
  assert.equal(notifications.length, 0);
  assert.ok(result.skipped.some((s) => s.layer === 5 && s.reason === "test_mode_suppressed"));
});

test("evaluateAndApplyConsequences inserts sponsor_pullout at sat<10", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const notifications = [];

  await evaluateAndApplyConsequences({
    supabase,
    team: makeBaseTeam({ riders: [{ market_value: 50_000, popularity: 30 }] }),
    board: makeBaseBoard(),
    newSatisfaction: 8,
    goalsMet: 0,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
    notify: (p) => notifications.push(p),
  });

  const pullout = supabase.state.board_consequences.find((c) => c.layer === 5 && c.status === "active");
  assert.ok(pullout);
  assert.equal(pullout.severity, 900);
  assert.equal(pullout.expires_at_season_id, "season-1");
  assert.equal(pullout.payload.trigger, "low_satisfaction");

  const notif = notifications.find((n) => n.title === "Sponsor pulls out");
  assert.ok(notif);
  assert.equal(notif.type, "board_critical");
  assert.equal(notif.metadata?.titleCode, "notif.boardSponsorPullout.title");
});

test("evaluateAndApplyConsequences inserts sponsor_pullout via 2x plan-lapse trigger", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });

  await evaluateAndApplyConsequences({
    supabase,
    team: makeBaseTeam(),
    board: makeBaseBoard(),
    newSatisfaction: 25, // sat<30 men >10
    goalsMet: 0,
    goalsTotal: 3,
    planIsComplete: true,
    consecutiveLowExpirations: 2, // post-replacement counter from S-02c
    seasonId: "season-1",
  });

  const pullout = supabase.state.board_consequences.find((c) => c.layer === 5);
  assert.ok(pullout);
  assert.equal(pullout.payload.trigger, "double_plan_lapse");
});

test("evaluateAndApplyConsequences does NOT trigger pullout via plan-lapse if planIsComplete=false", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });

  await evaluateAndApplyConsequences({
    supabase,
    team: makeBaseTeam(),
    board: makeBaseBoard(),
    newSatisfaction: 25,
    goalsMet: 0,
    goalsTotal: 3,
    planIsComplete: false,
    consecutiveLowExpirations: 2,
    seasonId: "season-1",
  });

  assert.equal(supabase.state.board_consequences.filter((c) => c.layer === 5).length, 0);
});

test("evaluateAndApplyConsequences inserts bonus_offer at sat>75 + ≥75% goals met", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const notifications = [];

  await evaluateAndApplyConsequences({
    supabase,
    team: makeBaseTeam(),
    board: { id: "board-1", focus: "balanced" },
    newSatisfaction: 85,
    goalsMet: 4,
    goalsTotal: 5,
    planIsComplete: false,
    seasonId: "season-1",
    notify: (p) => notifications.push(p),
  });

  const offer = supabase.state.board_consequences.find((c) => c.layer === 6 && c.status === "active");
  assert.ok(offer);
  assert.equal(offer.severity, 200_000);
  assert.equal(offer.payload.extra_goal_type, "monument_podium");
  assert.equal(offer.expires_at_season_id, "season-1");

  const notif = notifications.find((n) => n.title === "Bonus offer from the board");
  assert.ok(notif);
  assert.equal(notif.metadata?.titleCode, "notif.boardBonusOffer.title");
  assert.equal(notif.metadata?.messageCode, "notif.boardBonusOffer.message");
});

test("evaluateAndApplyConsequences uses signature_rider extra-goal for star_signing focus", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });

  await evaluateAndApplyConsequences({
    supabase,
    team: makeBaseTeam(),
    board: { id: "board-1", focus: "star_signing" },
    newSatisfaction: 90,
    goalsMet: 5,
    goalsTotal: 5,
    planIsComplete: false,
    seasonId: "season-1",
  });

  const offer = supabase.state.board_consequences.find((c) => c.layer === 6);
  assert.equal(offer.payload.extra_goal_type, "signature_rider");
  // #2308 · target: 75 var opfyldelighed-buggen (se selectBonusExtraGoal-test).
  assert.equal(offer.payload.extra_goal_target, 1);
});

test("evaluateAndApplyConsequences skips bonus_offer if one already issued this season", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      {
        id: "old-offer",
        team_id: "team-1",
        layer: 6,
        severity: 200_000,
        status: "declined",
        expires_at_season_id: "season-1",
        payload: {},
      },
    ],
  });

  const result = await evaluateAndApplyConsequences({
    supabase,
    team: makeBaseTeam(),
    board: makeBaseBoard(),
    newSatisfaction: 90,
    goalsMet: 5,
    goalsTotal: 5,
    planIsComplete: false,
    seasonId: "season-1",
  });

  assert.equal(supabase.state.board_consequences.filter((c) => c.layer === 6).length, 1);
  assert.ok(result.skipped.find((s) => s.reason === "already_offered_this_season"));
});

test("evaluateAndApplyConsequences allows new bonus_offer in next season", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      {
        id: "old-offer",
        team_id: "team-1",
        layer: 6,
        severity: 200_000,
        status: "declined",
        expires_at_season_id: "season-1",
        payload: {},
      },
    ],
  });

  await evaluateAndApplyConsequences({
    supabase,
    team: makeBaseTeam(),
    board: makeBaseBoard(),
    newSatisfaction: 90,
    goalsMet: 5,
    goalsTotal: 5,
    planIsComplete: false,
    seasonId: "season-2",
  });

  const newOffer = supabase.state.board_consequences.find(
    (c) => c.layer === 6 && c.status === "active" && c.expires_at_season_id === "season-2"
  );
  assert.ok(newOffer);
});

test("evaluateAndApplyConsequences high-sat team gets NO consequences (lag 2-5 silent)", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });

  const result = await evaluateAndApplyConsequences({
    supabase,
    team: makeBaseTeam({ riders: [{ salary: 50_000 }] }),
    board: makeBaseBoard(),
    newSatisfaction: 65,
    goalsMet: 2,
    goalsTotal: 3,
    planIsComplete: false,
    seasonId: "season-1",
  });

  // Sat 65: no lag 2 (≥40), no lag 3 (≥30), no lag 4 (≥15), no lag 5 (≥10), no lag 6 (≤75).
  assert.equal(result.applied.length, 0);
  assert.equal(supabase.state.board_consequences.length, 0);
});

// =====================================================================
// assertSigningAllowed — hard-block helpers
// =====================================================================

test("assertSigningAllowed returns null when no consequences are active", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const result = await assertSigningAllowed({
    supabase,
    buyerTeamId: "team-1",
    riderId: "r-target",
    purchasePrice: 500_000,
  });
  assert.equal(result, null);
});

test("assertSigningAllowed blocks purchase above signing_restriction threshold", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      {
        id: "rest-1",
        team_id: "team-1",
        layer: 3,
        severity: 300_000,
        status: "active",
        payload: {},
      },
    ],
    riders: [{ id: "r-target", team_id: "other-team", salary: 20_000 }],
  });

  const blocked = await assertSigningAllowed({
    supabase,
    buyerTeamId: "team-1",
    riderId: "r-target",
    purchasePrice: 350_000,
  });
  assert.ok(blocked);
  assert.equal(blocked.code, "board_signing_restriction");
  assert.equal(blocked.layer, 3);
});

test("assertSigningAllowed allows purchase at or below signing_restriction threshold", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "rest-1", team_id: "team-1", layer: 3, severity: 300_000, status: "active", payload: {} },
    ],
    riders: [{ id: "r-target", team_id: "other-team", salary: 20_000 }],
  });

  const allowed = await assertSigningAllowed({
    supabase,
    buyerTeamId: "team-1",
    riderId: "r-target",
    purchasePrice: 300_000,
  });
  assert.equal(allowed, null);
});

test("assertSigningAllowed blocks when salary_cap would be exceeded", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "cap-1", team_id: "team-1", layer: 2, severity: 100_000, status: "active", payload: {} },
    ],
    riders: [
      // Buyer's existing roster
      { id: "buyer-r1", team_id: "team-1", salary: 80_000 },
      // Target rider on other team
      { id: "r-target", team_id: "other-team", salary: 50_000 },
    ],
  });

  const blocked = await assertSigningAllowed({
    supabase,
    buyerTeamId: "team-1",
    riderId: "r-target",
    purchasePrice: 100_000,
  });
  assert.ok(blocked);
  assert.equal(blocked.code, "board_salary_cap");
});

test("assertSigningAllowed allows when salary_cap fits", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "cap-1", team_id: "team-1", layer: 2, severity: 100_000, status: "active", payload: {} },
    ],
    riders: [
      { id: "buyer-r1", team_id: "team-1", salary: 30_000 },
      { id: "r-target", team_id: "other-team", salary: 40_000 },
    ],
  });

  const allowed = await assertSigningAllowed({
    supabase,
    buyerTeamId: "team-1",
    riderId: "r-target",
    purchasePrice: 100_000,
  });
  assert.equal(allowed, null);
});

test("assertSigningAllowed prefers signing_restriction error code when both lag 2+3 fire", async () => {
  // Lag 3 checks first (cheaper) — pris-tærskel rammer altid før vi loader rider-løn for cap.
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "cap-1", team_id: "team-1", layer: 2, severity: 100_000, status: "active", payload: {} },
      { id: "rest-1", team_id: "team-1", layer: 3, severity: 300_000, status: "active", payload: {} },
    ],
    riders: [
      { id: "buyer-r1", team_id: "team-1", salary: 90_000 },
      { id: "r-target", team_id: "other-team", salary: 50_000 },
    ],
  });

  const blocked = await assertSigningAllowed({
    supabase,
    buyerTeamId: "team-1",
    riderId: "r-target",
    purchasePrice: 400_000,
  });
  assert.equal(blocked.code, "board_signing_restriction");
});

// =====================================================================
// assertSalaryIncreaseAllowed — #2237 lag 2 håndhævet på kontraktforlængelse
// =====================================================================

test("assertSalaryIncreaseAllowed returns null when no cap is active", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const result = await assertSalaryIncreaseAllowed({
    supabase,
    teamId: "team-1",
    oldSalary: 10_000,
    newSalary: 500_000,
  });
  assert.equal(result, null);
});

test("assertSalaryIncreaseAllowed allows non-increases even with cap active", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "cap-1", team_id: "team-1", layer: 2, severity: 100_000, status: "active", payload: {} },
    ],
  });
  const result = await assertSalaryIncreaseAllowed({
    supabase,
    teamId: "team-1",
    oldSalary: 20_000,
    newSalary: 15_000,
  });
  assert.equal(result, null, "A decrease/unchanged extension must never be blocked");
});

test("assertSalaryIncreaseAllowed blocks an extension that would push the team over the cap", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "cap-1", team_id: "team-1", layer: 2, severity: 100_000, status: "active", payload: {} },
    ],
    riders: [
      { id: "r-1", team_id: "team-1", salary: 20_000 },
      { id: "r-2", team_id: "team-1", salary: 70_000 },
    ],
  });

  const blocked = await assertSalaryIncreaseAllowed({
    supabase,
    teamId: "team-1",
    oldSalary: 20_000,
    newSalary: 40_000,
  });
  assert.ok(blocked, "20K→40K on r-1 pushes total from 90K to 110K, over the 100K cap");
  assert.equal(blocked.code, "board_salary_cap");
  assert.equal(blocked.layer, 2);
});

test("assertSalaryIncreaseAllowed self-heals a stale pre-fix cap: does not retroactively punish existing salary, but still blocks further growth (#2237)", async () => {
  // Simulerer prod-tilstanden fra #2237: cap frosset til near-0 (4.670), men holdet
  // har reelt allerede 33.710 i lønsum (kommet ind via veje udenom den gamle guard).
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "cap-1", team_id: "team-1", layer: 2, severity: 4_670, status: "active", payload: {} },
    ],
    riders: [{ id: "r-1", team_id: "team-1", salary: 33_710 }],
  });

  const allowed = await assertSalaryIncreaseAllowed({
    supabase,
    teamId: "team-1",
    oldSalary: 33_710,
    newSalary: 33_710,
  });
  assert.equal(allowed, null, "Must never retroactively punish salary the team already has");

  const blocked = await assertSalaryIncreaseAllowed({
    supabase,
    teamId: "team-1",
    oldSalary: 33_710,
    newSalary: 40_000,
  });
  assert.ok(blocked, "Further growth beyond current salary is still capped until next season-end re-evaluation");
  assert.equal(blocked.threshold, 33_710);
});

test("assertSalaryIncreaseAllowed allows an extension that stays under the cap", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "cap-1", team_id: "team-1", layer: 2, severity: 100_000, status: "active", payload: {} },
    ],
    riders: [
      { id: "r-1", team_id: "team-1", salary: 20_000 },
      { id: "r-2", team_id: "team-1", salary: 50_000 },
    ],
  });

  const allowed = await assertSalaryIncreaseAllowed({
    supabase,
    teamId: "team-1",
    oldSalary: 20_000,
    newSalary: 25_000,
  });
  assert.equal(allowed, null, "70K→75K stays under the 100K cap");
});

// =====================================================================
// Sponsor-pullout multiplier + season-scoped expiration
// =====================================================================

test("getActiveSponsorPulloutFactor returns 1.0 when no pullout is active", async () => {
  const supabase = makeFakeSupabase({ board_consequences: [] });
  const factor = await getActiveSponsorPulloutFactor(supabase, "team-1");
  assert.equal(factor, 1.0);
});

test("getActiveSponsorPulloutFactor returns 0.9 when pullout is active", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "pull-1", team_id: "team-1", layer: 5, severity: 900, status: "active", payload: {} },
    ],
  });
  const factor = await getActiveSponsorPulloutFactor(supabase, "team-1");
  assert.equal(factor, 0.9);
});

test("expireSeasonScopedConsequences expires only matching season's pullouts", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "pull-1", team_id: "team-1", layer: 5, status: "active", expires_at_season_id: "season-1", payload: {} },
      { id: "pull-2", team_id: "team-2", layer: 5, status: "active", expires_at_season_id: "season-1", payload: {} },
      { id: "pull-3", team_id: "team-3", layer: 5, status: "active", expires_at_season_id: "season-2", payload: {} },
    ],
  });

  const result = await expireSeasonScopedConsequences(supabase, "season-1");
  assert.equal(result.expired, 2);
  assert.equal(supabase.state.board_consequences.find((c) => c.id === "pull-1").status, "expired");
  assert.equal(supabase.state.board_consequences.find((c) => c.id === "pull-2").status, "expired");
  assert.equal(supabase.state.board_consequences.find((c) => c.id === "pull-3").status, "active");
});

// =====================================================================
// Bonus-offer accept/decline flow
// =====================================================================

test("acceptBonusOffer marks row 'accepted' and returns bonus + extra_goal", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      {
        id: "offer-1",
        team_id: "team-1",
        layer: 6,
        severity: 200_000,
        status: "active",
        source_board_id: "board-1",
        payload: { extra_goal_type: "monument_podium", extra_goal_target: 1, extra_goal_label: "Top-3 monument" },
      },
    ],
  });

  const result = await acceptBonusOffer({ supabase, teamId: "team-1", offerId: "offer-1" });
  assert.equal(result.ok, true);
  assert.equal(result.bonus_amount, 200_000);
  assert.equal(result.extra_goal.type, "monument_podium");
  assert.equal(result.source_board_id, "board-1");
  assert.equal(supabase.state.board_consequences.find((c) => c.id === "offer-1").status, "accepted");
});

test("declineBonusOffer marks row 'declined'", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "offer-1", team_id: "team-1", layer: 6, status: "active", payload: {} },
    ],
  });

  const result = await declineBonusOffer({ supabase, teamId: "team-1", offerId: "offer-1" });
  assert.equal(result.ok, true);
  assert.equal(supabase.state.board_consequences.find((c) => c.id === "offer-1").status, "declined");
});

test("acceptBonusOffer returns not_found for already-resolved row", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "offer-1", team_id: "team-1", layer: 6, status: "declined", payload: {} },
    ],
  });

  const result = await acceptBonusOffer({ supabase, teamId: "team-1", offerId: "offer-1" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_found");
});

// =====================================================================
// Forced listing fulfilled-flow
// =====================================================================

test("markForcedListingFulfilled marks row 'fulfilled' when listing-id matches", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      {
        id: "fl-1",
        team_id: "team-1",
        layer: 4,
        status: "active",
        payload: { listing_id: "listing-x", rider_id: "r-1" },
      },
    ],
  });

  const result = await markForcedListingFulfilled({ supabase, teamId: "team-1", listingId: "listing-x" });
  assert.equal(result.ok, true);
  assert.equal(supabase.state.board_consequences.find((c) => c.id === "fl-1").status, "fulfilled");
});

test("markForcedListingFulfilled returns ok=false when listing-id does not match", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "fl-1", team_id: "team-1", layer: 4, status: "active", payload: { listing_id: "other" } },
    ],
  });

  const result = await markForcedListingFulfilled({ supabase, teamId: "team-1", listingId: "listing-x" });
  assert.equal(result.ok, false);
});

// =====================================================================
// getActiveConsequencesForTeam
// =====================================================================

test("getActiveConsequencesForTeam returns active rows sorted by layer", async () => {
  const supabase = makeFakeSupabase({
    board_consequences: [
      { id: "c-3", team_id: "team-1", layer: 3, status: "active", payload: {} },
      { id: "c-2", team_id: "team-1", layer: 2, status: "active", payload: {} },
      { id: "c-old", team_id: "team-1", layer: 5, status: "expired", payload: {} },
      { id: "c-other", team_id: "team-2", layer: 2, status: "active", payload: {} },
    ],
  });

  const rows = await getActiveConsequencesForTeam(supabase, "team-1");
  assert.deepEqual(rows.map((r) => r.layer), [2, 3]);
});

// =====================================================================
// Fake supabase for tests (mimics core PostgREST surface)
// =====================================================================

function makeFakeSupabase(initialState = {}) {
  const state = JSON.parse(JSON.stringify(initialState));
  for (const key of ["board_consequences", "transfer_listings", "riders", "teams"]) {
    if (!state[key]) state[key] = [];
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function ensureTable(table) {
    if (!state[table]) state[table] = [];
    return state[table];
  }

  function makeQuery(table, action, payload = null) {
    const filters = [];

    function matches(row) {
      return filters.every((filter) => {
        if (filter.type === "eq") return row[filter.column] === filter.value;
        if (filter.type === "in") return filter.values.includes(row[filter.column]);
        return true;
      });
    }

    function execute() {
      const rows = ensureTable(table);
      if (action === "select") {
        return Promise.resolve({ data: clone(rows.filter(matches)), error: null });
      }
      if (action === "delete") {
        const deleted = rows.filter(matches);
        state[table] = rows.filter((row) => !matches(row));
        return Promise.resolve({ data: clone(deleted), error: null });
      }
      if (action === "update") {
        const updated = [];
        for (const row of rows) {
          if (matches(row)) {
            Object.assign(row, clone(payload));
            updated.push(row);
          }
        }
        return Promise.resolve({ data: clone(updated), error: null });
      }
      if (action === "insert") {
        const newRows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
          id: row.id || `${table}-${Math.random().toString(36).slice(2, 9)}`,
          ...clone(row),
        }));
        rows.push(...newRows);
        return Promise.resolve({ data: clone(newRows), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }

    const query = {
      eq(column, value) { filters.push({ type: "eq", column, value }); return query; },
      in(column, values) { filters.push({ type: "in", column, values }); return query; },
      select() { return query; },
      single() { return execute().then((res) => ({ data: res.data?.[0] || null, error: res.error })); },
      maybeSingle() { return execute().then((res) => ({ data: res.data?.[0] || null, error: res.error })); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return query;
  }

  return {
    state,
    from(table) {
      ensureTable(table);
      return {
        select() { return makeQuery(table, "select"); },
        delete() { return makeQuery(table, "delete"); },
        update(payload) { return makeQuery(table, "update", payload); },
        insert(payload) { return makeQuery(table, "insert", payload); },
      };
    },
  };
}
