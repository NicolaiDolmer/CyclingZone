// #3502 · Forward-guard: fuld "afslut sæson → sæsonskifte → board-cronflows
// virker stadig"-cyklus. Ingen eksisterende test dækkede dette (grep i
// seasonTransition.test.js gav 0 hits, jf. #3502-issuet).
//
// Root cause (#3502): transfer_windows.board_negotiation_state skrives kun ÉT
// sted i hele koden (boardSequentialNegotiation.js, kun til 'pending_5yr', kun
// når sæson 1 slutter) og falder aldrig videre til 'pending_3yr'/'pending_1yr'/
// 'complete'. Hver efterfølgende sæsonskifte opretter desuden et NYT
// transfer_windows-row uden feltet (seasonTransition.js
// insertTransferWindowIfMissing, linje ~698-718 — kun {id, season_id, status,
// created_at}), som falder tilbage til DB-default 'locked'. De to board-crons
// (boardAutoAccept.js, boardMidSeason.js) gatede tidligere HELE deres kørsel på
// netop dette driftende felt — resultatet var at auto-accept-cronen reelt
// stoppede med at virke fra 26/7, og mid-season-cronen ALDRIG kørte i prod.
//
// Denne fil kæder de FAKTISKE sæson-slut/sæsonskifte-funktioner sammen med de
// to crons og beviser at de stadig fungerer selvom transfer_windows drifter
// nøjagtigt som i prod:
//   startSequentialNegotiation (economyEngine.processSeasonEnd's inline-kald
//   ved sæson-1-slut) → insertTransferWindowIfMissing (kaldt ved ETHVERT
//   sæsonskifte) → processBoardAutoAcceptCron / processMidSeasonReviewCron.
//
// Derudover: en dedikeret test af AUTO_ACCEPT_ROLLOUT_FLOOR-dæmpningen.
// Prod-verifikation 7/8 (samme dag som #3502-fixet blev skrevet) viste 161
// pending real board-rækker for humane hold, hvoraf 149 allerede havde et
// anker >= 5 dage gammelt — uden dæmpning ville FØRSTE cron-tick efter merge
// bulk-auto-acceptere alle 149 på én gang (samme skadesmønster som #2463).

import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_ACCEPT_ROLLOUT_FLOOR,
  processBoardAutoAcceptCron,
} from "./boardAutoAccept.js";
import { startSequentialNegotiation } from "./boardSequentialNegotiation.js";
import { insertTransferWindowIfMissing } from "./seasonTransition.js";
import { processMidSeasonReviewCron } from "./boardMidSeason.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

// De to window-drift-guard-tests nedenfor tester specifikt drift-scenariet,
// ikke rollout-dæmpningen — floor'en disables derfor eksplicit (epoch, altid
// passeret) så den ikke interfererer med deres egne, ældre `now`-tidsstempler.
const DISABLE_ROLLOUT_FLOOR = new Date(0);

const RIDER_STAT_FIELDS = {
  nationality_code: "FR", uci_points: 100, popularity: 50,
  stat_fl: 70, stat_bj: 70, stat_kb: 70, stat_bk: 70, stat_tt: 70, stat_bro: 70,
  stat_sp: 70, stat_acc: 70, stat_udh: 70, stat_mod: 70, stat_res: 70, stat_ftr: 70,
};

test("#3502 forward-guard: sæson-1-slut → sæsonskifte → auto-accept-cron virker stadig trods driftende window-state", async () => {
  const teamCreatedAt = "2026-01-01T00:00:00Z";

  const state = {
    teams: [{
      id: "team-1", user_id: "user-1", name: "Team Forward Guard",
      balance: 500000, sponsor_income: 240000, division: 3,
      season_1_identity_basis: null, team_dna_key: "sprint_kommerciel",
      created_at: teamCreatedAt,
      is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
    }],
    riders: [
      { team_id: "team-1", is_u25: true, ...RIDER_STAT_FIELDS },
      { team_id: "team-1", is_u25: false, ...RIDER_STAT_FIELDS },
    ],
    board_profiles: [
      {
        id: "bp-baseline", team_id: "team-1", plan_type: "baseline", is_baseline: true,
        negotiation_status: "completed", satisfaction: 50, budget_modifier: 1.0,
      },
    ],
    seasons: [
      { id: "season-1", number: 1, status: "active", race_days_completed: 60, race_days_total: 60 },
    ],
    transfer_windows: [
      { id: "tw-season-1", season_id: "season-1", board_negotiation_state: "locked", created_at: "2025-11-01T00:00:00Z" },
    ],
    team_board_members: [],
    season_standings: [],
  };
  const supabase = createFakeSupabase(state);

  // 1. Sæson 1 slutter — dette er PRÆCIS det inline-kald economyEngine.processSeasonEnd
  //    laver (currentSeasonNumber === 1, ikke en cron-loop, jf. boardSequentialNegotiation.js).
  const seqResult = await startSequentialNegotiation({ supabase, completedSeasonId: "season-1" });
  assert.equal(seqResult.window_state, "pending_5yr");
  assert.equal(
    state.board_profiles.find((b) => b.plan_type === "baseline"), undefined,
    "baseline-raekken skal vaere slettet"
  );
  assert.ok(state.teams[0].season_1_identity_basis, "identity_basis skal vaere persisteret ved onboarding-start");

  // 2. Sæson 2 starter — dette er PRÆCIS insertTransferWindowIfMissing-kaldet
  //    seasonTransition.js laver ved ETHVERT sæsonskifte (linje ~898-901). Ingen
  //    board_negotiation_state i payloaden → DB-default 'locked' ville gælde i
  //    prod (selve #3502-mekanismen; fake'en her efterlader feltet blot fraværende,
  //    hvilket dokumenterer at det IKKE længere er noget cronerne kan stole på).
  state.seasons[0].status = "completed";
  state.seasons.push({ id: "season-2", number: 2, status: "active", race_days_completed: 0, race_days_total: 60 });
  await insertTransferWindowIfMissing(supabase, "tw-season-2", "season-2", "2026-01-05T00:00:00Z");

  const { data: newestWindow } = await supabase.from("transfer_windows")
    .select("id, board_negotiation_state")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assert.equal(newestWindow.id, "tw-season-2", "det nyeste vindue er nu sæson 2's, ikke sæson 1's pending_5yr-vindue");
  assert.equal(
    newestWindow.board_negotiation_state, undefined,
    "det nye vindue baerer IKKE feltet videre — roden til #3502"
  );

  // 3. Auto-accept-cronen kører 9 dage senere. FØR #3502-fixet ville den globale
  //    window-gate stoppe hele cronen her (nyeste vindue har intet
  //    board_negotiation_state → '?? "locked"' → early-return, teams_checked=0,
  //    ingen reminders/auto-accept). Med fixet aflæses behovet direkte fra
  //    board_profiles/teams-domænet — cronen virker stadig.
  const now = new Date("2026-01-10T00:00:00Z");
  const notifications = [];
  const summary = await processBoardAutoAcceptCron({
    supabase,
    notifyUser: async (args) => { notifications.push(args); return { delivered: true }; },
    now,
    rolloutFloor: DISABLE_ROLLOUT_FLOOR,
  });

  assert.equal(summary.teams_checked, 1);
  assert.equal(summary.auto_accepted, 1, "5yr-planen skal auto-accepteres trods driftende window-state — se #3502");
  assert.equal(summary.errors, 0);
  assert.equal(notifications.length, 1);
  const fiveYrBoard = state.board_profiles.find((b) => b.team_id === "team-1" && b.plan_type === "5yr");
  assert.ok(fiveYrBoard, "5yr-boardet skal vaere oprettet af auto-accept-cronen");
  assert.equal(fiveYrBoard.negotiation_status, "completed");
});

test("#3502 forward-guard: mid-season-cronen virker stadig efter et sæsonskifte selvom nyeste window er 'locked'", async () => {
  const state = {
    teams: [{
      id: "team-1", user_id: "user-1", name: "Team Forward Guard MS",
      is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
      division: 3, season_1_identity_basis: null,
    }],
    riders: [{ team_id: "team-1", is_u25: true, popularity: 50 }],
    board_profiles: [{
      id: "board-1yr", team_id: "team-1", plan_type: "1yr",
      satisfaction: 20, // < 50 → low_satisfaction-trigger
      current_goals: [{ type: "top_n_finish", target: 3 }],
      negotiation_status: "completed", is_baseline: false,
    }],
    seasons: [
      { id: "season-3", number: 3, status: "active", race_days_completed: 30, race_days_total: 60 },
    ],
    season_standings: [{
      team_id: "team-1", season_id: "season-3", division: 3,
      rank_in_division: 4, total_points: 200, stage_wins: 1, gc_wins: 0, prize_money: 50000,
    }],
    notifications: [],
  };
  const supabase = createFakeSupabase(state);

  // Sæsonskifte til sæson 3 opretter et nyt window uden feltet — samme drift som
  // i testen ovenfor. Bevidst egen, mindre fixture: mid-season-cronen kræver ikke
  // hele onboarding-kæden, kun en completed 1yr-board ved midpoint.
  await insertTransferWindowIfMissing(supabase, "tw-season-3", "season-3", "2026-03-01T00:00:00Z");
  const { data: newestWindow } = await supabase.from("transfer_windows")
    .select("board_negotiation_state")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assert.equal(newestWindow.board_negotiation_state, undefined, "roden til #3502 — samme drift som i testen ovenfor");

  const summary = await processMidSeasonReviewCron({
    supabase,
    notifyUser: async (args) => {
      state.notifications.push({
        id: "n1", user_id: args.userId, type: args.type, title: args.title, related_id: args.relatedId,
      });
      return { delivered: true, deduped: false };
    },
  });

  assert.equal(summary.teams_checked, 1);
  assert.equal(summary.banners_sent, 1, "mid-season-banneret skal fyre trods driftende window-state — se #3502");
  assert.equal(summary.errors, 0);
});

// =====================================================================
// #3502 · AUTO_ACCEPT_ROLLOUT_FLOOR — backfill-dæmpning ved deploy
//
// Prod-verifikation 7/8: 161 pending real board-rækker for humane hold,
// heraf 149 med et anker der allerede var >= 5 dage gammelt (outage siden
// 26/7). Uden dæmpning ville FØRSTE cron-tick efter merge bulk-auto-
// acceptere alle 149 på én gang — samme skadesmønster som #2463
// ("218 auto-accepts dagen efter sæsonstart"). Disse tests bruger den
// EKSPORTEREDE, rigtige AUTO_ACCEPT_ROLLOUT_FLOOR (ingen override) for at
// bevise den faktiske deploy-adfærd, ikke en syntetisk stand-in.
// =====================================================================

function makeBackloggedTeamState({ teamCreatedAt }) {
  return {
    teams: [{
      id: "team-backlog", user_id: "user-backlog", name: "Team Backlog",
      balance: 500000, sponsor_income: 240000, division: 3,
      season_1_identity_basis: { rider_count: 1 }, team_dna_key: "sprint_kommerciel",
      created_at: teamCreatedAt,
      is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
    }],
    riders: [],
    seasons: [{ id: "season-2", number: 2, status: "active", race_days_completed: 300, race_days_total: 60 }],
    board_profiles: [],
    team_board_members: [],
    season_standings: [],
  };
}

test("#3502: en outage-backlogget forhandling (anker langt før floor) auto-accepterer IKKE straks ved deploy", async () => {
  // Holdets forhandling har reelt stået åben siden LÆNGE før rollout-floor'en
  // (spejler prod-fundet: anker 26/7, floor 15/8) — uden dæmpning ville dette
  // være dagevis over auto-accept-tærsklen allerede ved deploy.
  const state = makeBackloggedTeamState({ teamCreatedAt: "2026-06-01T00:00:00Z" });
  const supabase = createFakeSupabase(state);

  const justAfterFloor = new Date(AUTO_ACCEPT_ROLLOUT_FLOOR.getTime() + 1 * 24 * 60 * 60 * 1000);
  const summary = await processBoardAutoAcceptCron({
    supabase,
    notifyUser: async () => ({ delivered: true }),
    now: justAfterFloor,
  });

  assert.equal(summary.teams_checked, 1);
  assert.equal(summary.auto_accepted, 0, "backlogget hold skal IKKE straks auto-accepteres ved deploy — se #3502");
  assert.equal(summary.reminders_sent, 0, "1 dag efter floor er stadig under T-3-tærsklen (2 dage)");
});

test("#3502: samme backloggede hold får en frisk, fuld cyklus TALT FRA floor'en, ikke fra det reelle (gamle) anker", async () => {
  const state = makeBackloggedTeamState({ teamCreatedAt: "2026-06-01T00:00:00Z" });
  const supabase = createFakeSupabase(state);

  const sixDaysAfterFloor = new Date(AUTO_ACCEPT_ROLLOUT_FLOOR.getTime() + 6 * 24 * 60 * 60 * 1000);
  const summary = await processBoardAutoAcceptCron({
    supabase,
    notifyUser: async () => ({ delivered: true }),
    now: sixDaysAfterFloor,
  });

  assert.equal(summary.auto_accepted, 1, "6 dage EFTER floor'en skal holdet auto-accepteres normalt");
});

test("#3502: en forhandling der åbner EFTER floor'en er slet ikke påvirket af dæmpningen (ren nedre grænse)", async () => {
  // team.created_at ligger EFTER floor'en — det reelle anker er allerede
  // nyere end floor'en, så clampen er et no-op og normal 2/4/5-dages-logik
  // gælder uændret. Dette er den PERMANENTE tilstand efter floor-vinduet.
  const afterFloor = new Date(AUTO_ACCEPT_ROLLOUT_FLOOR.getTime() + 10 * 24 * 60 * 60 * 1000);
  const twoDaysAfterThat = new Date(afterFloor.getTime() + 2 * 24 * 60 * 60 * 1000);
  const state = makeBackloggedTeamState({ teamCreatedAt: afterFloor.toISOString() });
  const supabase = createFakeSupabase(state);

  const summary = await processBoardAutoAcceptCron({
    supabase,
    notifyUser: async () => ({ delivered: true }),
    now: twoDaysAfterThat,
  });

  assert.equal(summary.reminders_sent, 1, "2 rigtige dage efter et rigtigt (post-floor) anker skal give T-3 som normalt");
  assert.equal(summary.auto_accepted, 0);
});
