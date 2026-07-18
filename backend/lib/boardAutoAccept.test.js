// #2463 · Tests for kalenderdags-uret i board-auto-accept-cronen.
//
// Tærsklerne var oprindeligt kalibreret mod seasons.race_days_completed (Q-C
// 2026-05-05) under antagelsen ~1 race-day/kalenderdag. Men race_days_completed
// er SUM(stages) over ALLE completede løb på tværs af divisioner — vokser
// ~20+/dag. Prod-evidens 16/7: 524/60 race_days_completed, 218 auto-accepts
// (bulk dagen efter sæsonstart), 25 T-3-reminders, 0 T-1-reminders NOGENSINDE.
// Fixet: kalenderdags-ur PR PLAN via resolveNegotiationOpenedAt(). Dækker:
//   - resolveNegotiationOpenedAt (pure function, anker-kæden)
//   - processBoardAutoAcceptCron: dag 0/2/4/5-dispatch for et nyt hold
//   - renew-flip: frisk updated_at nulstiller uret, selv med gammelt hold
//   - manglende plan-række: anker = søster-planens created_at
//   - #2469: satisfaction/budget_modifier/tradeoff bevares stadig ved renewal

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AUTO_ACCEPT_THRESHOLDS,
  BOARD_AUTO_ACCEPT_SELECT,
  findPendingPlanType,
  resolveNegotiationOpenedAt,
  processBoardAutoAcceptCron,
} from "./boardAutoAccept.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-16T15:00:00Z");

function daysAgo(n, base = NOW) {
  return new Date(base.getTime() - n * DAY_MS).toISOString();
}

// =====================================================================
// resolveNegotiationOpenedAt — pure function
// =====================================================================

test("resolveNegotiationOpenedAt: pending-boardets updated_at vinder når den findes", () => {
  const opened = resolveNegotiationOpenedAt({
    team: { created_at: daysAgo(100) },
    pendingBoard: { updated_at: daysAgo(3) },
    realBoards: [],
  });
  assert.equal(opened.toISOString(), new Date(daysAgo(3)).toISOString());
});

test("resolveNegotiationOpenedAt: manglende plan-række → max(created_at) over completede søster-planer", () => {
  const opened = resolveNegotiationOpenedAt({
    team: { created_at: daysAgo(100) },
    pendingBoard: null,
    realBoards: [
      { plan_type: "5yr", negotiation_status: "completed", created_at: daysAgo(10) },
      { plan_type: "3yr", negotiation_status: "completed", created_at: daysAgo(4) },
    ],
  });
  assert.equal(opened.toISOString(), new Date(daysAgo(4)).toISOString());
});

test("resolveNegotiationOpenedAt: intet board overhovedet → fallback til team.created_at", () => {
  const opened = resolveNegotiationOpenedAt({
    team: { created_at: daysAgo(7) },
    pendingBoard: null,
    realBoards: [],
  });
  assert.equal(opened.toISOString(), new Date(daysAgo(7)).toISOString());
});

test("resolveNegotiationOpenedAt: alt ugyldigt/manglende → null (kaldestedet skal skippe)", () => {
  assert.equal(resolveNegotiationOpenedAt({ team: {}, pendingBoard: null, realBoards: [] }), null);
  assert.equal(
    resolveNegotiationOpenedAt({ team: { created_at: "not-a-date" }, pendingBoard: null, realBoards: [] }),
    null
  );
  assert.equal(
    resolveNegotiationOpenedAt({
      team: null,
      pendingBoard: { updated_at: "not-a-date" },
      realBoards: [],
    }),
    null
  );
});

// =====================================================================
// processBoardAutoAcceptCron — orchestrator med fake supabase
// =====================================================================

// #2598 · Tynd wrapper om den delte, projektion-aware fake (backend/lib/
// testUtils/fakeSupabase.js) — denne fils lokale variant var referencen for
// #2473/#2469; selve implementeringen bor nu ét sted, denne fil er blot
// endnu en forbruger af den.
function makeFakeSupabase(state) {
  return createFakeSupabase(state);
}

function baseState({ teamCreatedAt, boardUpdatedAt, negotiationStatus = "pending" }) {
  return {
    transfer_windows: [
      { id: "tw-1", board_negotiation_state: "pending_5yr", created_at: "2026-06-22T00:00:00Z" },
    ],
    seasons: [
      { id: "season-1", number: 2, status: "active", race_days_completed: 524, race_days_total: 60 },
    ],
    teams: [
      {
        id: "team-1",
        user_id: "user-1",
        name: "Team Calendar",
        balance: 500000,
        sponsor_income: 240000,
        division: 3,
        season_1_identity_basis: null,
        team_dna_key: "sprint_kommerciel", // sat → auto-accept rører ikke DNA-grenen
        created_at: teamCreatedAt,
        is_ai: false,
        is_bank: false,
        is_frozen: false,
        is_test_account: false,
      },
    ],
    board_profiles: [
      {
        id: "bp-1", team_id: "team-1", plan_type: "5yr", focus: "balanced",
        negotiation_status: negotiationStatus, is_baseline: false,
        created_at: teamCreatedAt, updated_at: boardUpdatedAt ?? teamCreatedAt,
      },
    ],
    riders: [],
    season_standings: [],
  };
}

async function runCron(state, now) {
  const notifications = [];
  const summary = await processBoardAutoAcceptCron({
    supabase: makeFakeSupabase(state),
    notifyUser: async (args) => { notifications.push(args); return { delivered: true }; },
    now,
  });
  return { summary, notifications };
}

// ── Nyt hold: dag 0 / 2 / 4 / 5 siden planen blev åbnet ──────────────────

test("nyt hold, dag 0 siden åbning: intet sker", async () => {
  const state = baseState({ teamCreatedAt: NOW.toISOString() });
  const { summary, notifications } = await runCron(state, NOW);

  assert.equal(summary.teams_checked, 1);
  assert.equal(summary.reminders_sent, 0);
  assert.equal(summary.auto_accepted, 0);
  assert.equal(notifications.length, 0);
});

test("nyt hold, dag 2 siden åbning: T-3 info-reminder (board_update)", async () => {
  const opened = new Date(NOW.getTime() - 2 * DAY_MS);
  const state = baseState({ teamCreatedAt: opened.toISOString() });
  const { summary, notifications } = await runCron(state, NOW);

  assert.equal(summary.reminders_sent, 1);
  assert.equal(summary.auto_accepted, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "board_update");
  assert.equal(notifications[0].metadata.messageCode, "notif.boardT3Reminder.message");
  assert.equal(notifications[0].metadata.messageParams.daysLeft, 3);
});

test("nyt hold, dag 4 siden åbning: T-1 kritisk reminder (board_critical)", async () => {
  const opened = new Date(NOW.getTime() - 4 * DAY_MS);
  const state = baseState({ teamCreatedAt: opened.toISOString() });
  const { summary, notifications } = await runCron(state, NOW);

  assert.equal(summary.reminders_sent, 1);
  assert.equal(summary.auto_accepted, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "board_critical");
  assert.equal(notifications[0].metadata.messageCode, "notif.boardT1Reminder.messageSingle");
  assert.equal(notifications[0].metadata.messageParams.daysLeft, 1);
});

test("nyt hold, dag 5 siden åbning: bestyrelsen auto-accepterer", async () => {
  const opened = new Date(NOW.getTime() - 5 * DAY_MS);
  const state = baseState({ teamCreatedAt: opened.toISOString() });
  const { summary, notifications } = await runCron(state, NOW);

  assert.equal(summary.auto_accepted, 1);
  assert.equal(summary.reminders_sent, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].metadata.titleCode, "notif.boardAutoAccepted.title");
  const board = state.board_profiles.find((b) => b.team_id === "team-1" && b.plan_type === "5yr");
  assert.equal(board.negotiation_status, "completed");
});

// ── Renew-flip: frisk updated_at nulstiller uret uanset holdets alder ────

test("renew-flip: frisk updated_at → intet før +2 dage, selv for et gammelt hold", async () => {
  const teamCreatedAt = daysAgo(200); // holdet er meget gammelt
  const renewedAt = new Date(NOW.getTime() - 1 * DAY_MS); // /board/renew satte updated_at i går
  const state = baseState({ teamCreatedAt, boardUpdatedAt: renewedAt.toISOString() });
  // created_at på boardet er langt tilbage (oprindelig signering) — kun updated_at er frisk.
  state.board_profiles[0].created_at = daysAgo(190);

  const { summary, notifications } = await runCron(state, NOW);

  assert.equal(summary.reminders_sent, 0, "1 dag siden renew er under T-3-tærsklen (2 dage)");
  assert.equal(summary.auto_accepted, 0);
  assert.equal(notifications.length, 0);
});

test("renew-flip: +2 dage efter frisk updated_at → T-3-reminder fyrer (uret måler fra updated_at, ikke created_at)", async () => {
  const teamCreatedAt = daysAgo(200);
  const renewedAt = new Date(NOW.getTime() - 2 * DAY_MS);
  const state = baseState({ teamCreatedAt, boardUpdatedAt: renewedAt.toISOString() });
  state.board_profiles[0].created_at = daysAgo(190);

  const { summary, notifications } = await runCron(state, NOW);

  assert.equal(summary.reminders_sent, 1);
  assert.equal(notifications[0].type, "board_update");
});

// ── Manglende plan-række: anker = søster-planens created_at ──────────────

test("manglende 3yr-række: anker = 5yr-rækkens created_at (da forrige plan blev signeret)", async () => {
  const teamCreatedAt = daysAgo(100);
  const fiveYrSignedAt = daysAgo(2); // 5yr blev signeret/auto-accepteret for 2 dage siden
  const state = {
    transfer_windows: [
      { id: "tw-1", board_negotiation_state: "pending_3yr", created_at: "2026-06-22T00:00:00Z" },
    ],
    seasons: [
      { id: "season-1", number: 2, status: "active", race_days_completed: 524, race_days_total: 60 },
    ],
    teams: [
      {
        id: "team-1", user_id: "user-1", name: "Team Sequential",
        balance: 500000, sponsor_income: 240000, division: 3,
        season_1_identity_basis: null, team_dna_key: "sprint_kommerciel",
        created_at: teamCreatedAt,
        is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
      },
    ],
    board_profiles: [
      {
        id: "bp-5", team_id: "team-1", plan_type: "5yr", focus: "balanced",
        negotiation_status: "completed", is_baseline: false,
        created_at: fiveYrSignedAt, updated_at: fiveYrSignedAt,
      },
      // Ingen 3yr-række endnu — findPendingPlanType skal returnere "3yr" uden board.
    ],
    riders: [],
    season_standings: [],
  };

  const { summary, notifications } = await runCron(state, NOW);

  // 2 dage siden 5yr blev signeret → 3yr's forhandlingsvindue anses for åbnet
  // samme dag → T-3-reminder for 3yr-planen, IKKE auto-accept/intet baseret
  // på det 100 dage gamle team.created_at.
  assert.equal(summary.reminders_sent, 1);
  assert.equal(summary.auto_accepted, 0);
  assert.equal(notifications[0].metadata.titleParams.planLabelKey, "planLabel.3yr");
});

// =====================================================================
// findPendingPlanType — pure function
// =====================================================================

test("findPendingPlanType: sekventiel 5yr→3yr→1yr-orden, returnerer første manglende/pending", () => {
  assert.equal(findPendingPlanType([]), "5yr");
  assert.equal(findPendingPlanType([{ plan_type: "5yr", negotiation_status: "completed" }]), "3yr");
  assert.equal(
    findPendingPlanType([
      { plan_type: "5yr", negotiation_status: "completed" },
      { plan_type: "3yr", negotiation_status: "pending" },
    ]),
    "3yr"
  );
  assert.equal(
    findPendingPlanType([
      { plan_type: "5yr", negotiation_status: "completed" },
      { plan_type: "3yr", negotiation_status: "completed" },
      { plan_type: "1yr", negotiation_status: "completed" },
    ]),
    null
  );
});

// =====================================================================
// #2469 · Datatab ved plan-renewal (sæsonskifte) — stadig dækket efter #2463
//
// Kill-kæden: economyEngine.processTeamSeasonEnd skriver den netop optjente
// satisfaction + budget_modifier ind på board-rækken OG sætter
// negotiation_status='pending' når planen udløber. Auto-accept-cron'en tager
// derefter over — og nulstillede før dette fix rækken til 50/1.0, fordi dens
// select ikke hentede kolonnerne. /board/sign havde aldrig fejlen (.select("*")).
// =====================================================================

function makeRenewalState({ satisfaction = 82, budgetModifier = 1.2, tradeoffPayload = null } = {}) {
  const oldSignedAt = daysAgo(20);
  const expiredPendingAt = daysAgo(6); // >= AUTO_ACCEPT_THRESHOLDS.AUTO_ACCEPT dage siden season-end-flippet
  return {
    transfer_windows: [
      { id: "tw-1", board_negotiation_state: "pending_5yr", created_at: "2026-06-22T00:00:00Z" },
    ],
    seasons: [
      { id: "season-2", number: 2, status: "active", race_days_completed: 524, race_days_total: 60 },
    ],
    teams: [
      {
        id: "team-1", user_id: "user-1", name: "Team Renewal",
        balance: 1230000, sponsor_income: 240000, division: 3,
        season_1_identity_basis: null, team_dna_key: "sprint_kommerciel",
        created_at: daysAgo(300),
        is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
      },
    ],
    board_profiles: [
      {
        id: "bp-5", team_id: "team-1", plan_type: "5yr", focus: "balanced",
        negotiation_status: "completed", is_baseline: false,
        satisfaction, budget_modifier: budgetModifier, tradeoff_payload: null,
        created_at: oldSignedAt, updated_at: oldSignedAt,
      },
      {
        id: "bp-3", team_id: "team-1", plan_type: "3yr", focus: "balanced",
        negotiation_status: "completed", is_baseline: false,
        satisfaction, budget_modifier: budgetModifier, tradeoff_payload: null,
        created_at: oldSignedAt, updated_at: oldSignedAt,
      },
      // Den udløbne plan — pending, men BÆRER de optjente værdier. updated_at
      // afspejler hvornår economyEngine flippede den til pending (season-end).
      {
        id: "bp-1", team_id: "team-1", plan_type: "1yr", focus: "balanced",
        negotiation_status: "pending", is_baseline: false,
        satisfaction, budget_modifier: budgetModifier,
        tradeoff_payload: tradeoffPayload,
        tradeoff_active_until_season_id: tradeoffPayload ? "season-1" : null,
        major_pivot_used_at: null,
        created_at: oldSignedAt, updated_at: expiredPendingAt,
      },
    ],
    riders: [],
    season_standings: [],
  };
}

async function runRenewalCron(state) {
  const notifications = [];
  const summary = await processBoardAutoAcceptCron({
    supabase: makeFakeSupabase(state),
    notifyUser: async (args) => { notifications.push(args); return { delivered: true }; },
    now: NOW,
  });
  const renewed = state.board_profiles.find((b) => b.team_id === "team-1" && b.plan_type === "1yr");
  return { summary, notifications, renewed };
}

test("#2469: auto-accept BEVARER optjent satisfaction + budget_modifier ved renewal", async () => {
  const state = makeRenewalState({ satisfaction: 82, budgetModifier: 1.2 });
  const { summary, renewed } = await runRenewalCron(state);

  assert.equal(summary.auto_accepted, 1, "den udløbne 1yr-plan auto-accepteres");
  assert.equal(renewed.negotiation_status, "completed");
  assert.equal(renewed.satisfaction, 82, "optjent tilfredshed må ikke nulstilles til 50");
  assert.equal(renewed.budget_modifier, 1.2, "optjent sponsor-modifier må ikke nulstilles til 1.0");
});

test("#2469: gælder også nedad — en straffet modifier må heller ikke gratis-opskrives", async () => {
  const state = makeRenewalState({ satisfaction: 30, budgetModifier: 0.9 });
  const { renewed } = await runRenewalCron(state);
  assert.equal(renewed.satisfaction, 30);
  assert.equal(renewed.budget_modifier, 0.9, "0.9 må ikke 'heles' til 1.0 af auto-accept");
});

test("#2469: ægte NY plan (ingen eksisterende række) defaulter fortsat til 50 / 1.0", async () => {
  const state = makeRenewalState();
  // Fjern 1yr-rækken helt → findPendingPlanType returnerer '1yr' uden board.
  // Anker falder da tilbage til 5yr/3yr's created_at (20 dage siden — over
  // auto-accept-tærsklen), så cronen stadig auto-accepterer med det samme.
  state.board_profiles = state.board_profiles.filter((b) => b.plan_type !== "1yr");
  const { summary, renewed } = await runRenewalCron(state);

  assert.equal(summary.auto_accepted, 1);
  assert.equal(renewed.satisfaction, 50, "ny plan starter neutralt");
  assert.equal(renewed.budget_modifier, 1.0);
});

test("#2469: auto-accept anvender spillerens deferred tradeoff (samme udfald som /board/sign)", async () => {
  const payload = { kind: "identity_tighten", u25_delta: 1 };
  const state = makeRenewalState({ tradeoffPayload: payload });
  const { renewed } = await runRenewalCron(state);

  assert.equal(renewed.tradeoff_payload, null, "tradeoff ryddes efter anvendelse");
  assert.equal(renewed.tradeoff_active_until_season_id, null);
  assert.equal(renewed.major_pivot_used_at, null, "frisk plan = frisk pivot-cooldown");
});

// Forward-guard: fanger at en fremtidig ændring læser et NYT felt fra
// existingBoard uden at udvide selecten — nøjagtig den fejl der skabte #2469.
test("#2469 forward-guard: BOARD_AUTO_ACCEPT_SELECT dækker hvert felt der læses fra existingBoard", async () => {
  const raw = await readFile(new URL("./boardAutoAccept.js", import.meta.url), "utf8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const selected = new Set(BOARD_AUTO_ACCEPT_SELECT.split(",").map((c) => c.trim()));

  const read = new Set();
  for (const m of src.matchAll(/existingBoard\?\.(\w+)/g)) read.add(m[1]);

  assert.ok(read.size > 0, "regexen skal faktisk finde noget — ellers er guarden tandløs");
  assert.ok(read.has("satisfaction") && read.has("budget_modifier"),
    "guarden skal se de felter #2469 handlede om — ellers er den holdt op med at virke");
  const missing = [...read].filter((field) => !selected.has(field));
  assert.deepEqual(
    missing, [],
    `Disse felter læses fra existingBoard men hentes ikke af BOARD_AUTO_ACCEPT_SELECT: ${missing.join(", ")}. `
    + "Uden kolonnen bliver 'existingBoard?.x ?? default' til en tavs nulstilling (#2469)."
  );
});

// Sanity: tærsklerne er stadig 2/4/5, blot i dage nu — dokumenterer #2463's kontrakt.
test("#2463: AUTO_ACCEPT_THRESHOLDS er kalenderdage (2/4/5), ikke race_days_completed", () => {
  assert.deepEqual(AUTO_ACCEPT_THRESHOLDS, { T_MINUS_3: 2, T_MINUS_1: 4, AUTO_ACCEPT: 5 });
});
