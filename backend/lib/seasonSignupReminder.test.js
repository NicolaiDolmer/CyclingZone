import test from "node:test";
import assert from "node:assert/strict";
import {
  selectSeasonSignupReminderCandidates,
  seasonSignupReminderDedupeKey,
  seasonSignupReminderPrefsAllow,
  distributionByTemplateLanguage,
  runSeasonSignupReminder,
  SEASON_SIGNUP_REMINDER_EMAIL_KIND,
  SEASON_SIGNUP_REMINDER_APP_CONFIG_KEY,
} from "./seasonSignupReminder.js";
import { selectTeamsToPark, selectActiveSubscriptionTeamIds } from "./managerParking.js";

const NOW = new Date("2026-09-27T08:00:00.000Z");
const DAY_MS = 86_400_000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY_MS).toISOString();
const SEASON = "season-3";

function team(overrides = {}) {
  return {
    id: "team-1",
    user_id: "user-1",
    name: "Hold A",
    division: 3,
    league_division_id: "pool-3b",
    is_ai: false,
    is_bank: false,
    is_test_account: false,
    is_frozen: false,
    parked_at: null,
    next_season_signup_at: null,
    ...overrides,
  };
}

function user(overrides = {}) {
  return {
    id: "user-1",
    email: "a@example.com",
    last_seen: daysAgo(45),
    language: "en",
    consent_preferences: { email_marketing: true },
    email_prefs: {},
    ...overrides,
  };
}

function select(overrides = {}) {
  return selectSeasonSignupReminderCandidates({
    teams: [team()],
    users: [user()],
    seasonId: SEASON,
    now: NOW,
    ...overrides,
  });
}

test("type and gate reuse: own email type, same app_config switch as win-back", () => {
  assert.equal(SEASON_SIGNUP_REMINDER_EMAIL_KIND, "season_signup_reminder");
  assert.equal(SEASON_SIGNUP_REMINDER_APP_CONFIG_KEY, "winback_send_enabled");
});

test("includes a team the season switch would park, owned by a consenting manager", () => {
  const candidates = select({
    standings: [{ team_id: "team-1", rank_in_division: 5, league_division_id: "pool-3b" }],
    divisions: [{ id: "pool-3b", label: "Division 3 B" }],
  });
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    userId: "user-1",
    email: "a@example.com",
    language: "en",
    teamId: "team-1",
    teamName: "Hold A",
    daysSinceLastSeen: 45,
    rankInDivision: 5,
    poolLabel: "Division 3 B",
  });
});

test("segment is exactly selectTeamsToPark: every recipient's team is one the sweep would park", () => {
  const teams = [
    team(),
    team({ id: "team-2", user_id: "user-2", next_season_signup_at: daysAgo(1) }),
    team({ id: "team-3", user_id: "user-3" }),
  ];
  const users = [user(), user({ id: "user-2", email: "b@example.com" }), user({ id: "user-3", email: "c@example.com", last_seen: daysAgo(2) })];
  const parkIds = new Set(selectTeamsToPark({ teams, users, now: NOW }).map((t) => t.id));
  const candidates = select({ teams, users });
  assert.deepEqual(candidates.map((c) => c.teamId), ["team-1"]);
  for (const c of candidates) assert.ok(parkIds.has(c.teamId));
});

test("excludes a team that has already signed up for next season", () => {
  assert.equal(select({ teams: [team({ next_season_signup_at: daysAgo(3) })] }).length, 0);
});

test("excludes a team with an active (or still-entitled) subscription", () => {
  assert.equal(select({ subscriptions: [{ id: "s1", team_id: "team-1", status: "active" }] }).length, 0);
  const cancelledButPaid = { id: "s2", team_id: "team-1", status: "canceled", current_period_end: new Date(NOW.getTime() + 5 * DAY_MS).toISOString() };
  const withCancelled = select({ subscriptions: [cancelledButPaid] });
  const sweepWouldPark = selectTeamsToPark({
    teams: [team()], users: [user()], now: NOW,
    activeSubscriptionTeamIds: selectActiveSubscriptionTeamIds([cancelledButPaid], NOW),
  }).length;
  // Whatever entitlement decides for a cancelled-but-paid plan, the reminder follows the parking predicate 1:1.
  assert.equal(withCancelled.length, sweepWouldPark);
});

test("excludes frozen, already parked, AI, bank and test-account teams", () => {
  assert.equal(select({ teams: [team({ is_frozen: true })] }).length, 0);
  assert.equal(select({ teams: [team({ parked_at: daysAgo(10) })] }).length, 0);
  assert.equal(select({ teams: [team({ is_ai: true })] }).length, 0);
  assert.equal(select({ teams: [team({ is_bank: true })] }).length, 0);
  assert.equal(select({ teams: [team({ is_test_account: true })] }).length, 0);
});

test("excludes an active manager (under 30 days away)", () => {
  assert.equal(select({ users: [user({ last_seen: daysAgo(29) })] }).length, 0);
  assert.equal(select({ users: [user({ last_seen: daysAgo(30) })] }).length, 1);
});

test("excludes managers without explicit marketing consent (NULL is not consent)", () => {
  assert.equal(select({ users: [user({ consent_preferences: null })] }).length, 0);
  assert.equal(select({ users: [user({ consent_preferences: { email_marketing: false } })] }).length, 0);
  assert.equal(select({ users: [user({ consent_preferences: {} })] }).length, 0);
});

test("respects email_prefs: muted entirely, muted for this type, or muted for win-back", () => {
  assert.equal(select({ users: [user({ email_prefs: { all: false } })] }).length, 0);
  assert.equal(select({ users: [user({ email_prefs: { season_signup_reminder: false } })] }).length, 0);
  assert.equal(select({ users: [user({ email_prefs: { winback: false } })] }).length, 0);
  assert.equal(select({ users: [user({ email_prefs: { race_digest: false } })] }).length, 1);
  assert.equal(seasonSignupReminderPrefsAllow(null), true);
});

test("excludes a manager whose address bounced or who complained on any earlier mail", () => {
  for (const status of ["bounced", "complained"]) {
    const rows = [{ user_id: "user-1", email_type: "winback", dedupe_key: "winback:user-1", status }];
    assert.equal(select({ emailLogRows: rows }).length, 0, status);
  }
  const delivered = [{ user_id: "user-1", email_type: "winback", dedupe_key: "winback:user-1", status: "delivered" }];
  assert.equal(select({ emailLogRows: delivered }).length, 1, "a delivered win-back does not block the reminder");
});

test("excludes a manager without an email or without a user row", () => {
  assert.equal(select({ users: [user({ email: null })] }).length, 0);
  assert.equal(select({ users: [] }).length, 0);
});

test("one mail per user even if a data error gives a user two parkable teams", () => {
  const candidates = select({ teams: [team(), team({ id: "team-2", name: "Hold B" })] });
  assert.equal(candidates.length, 1);
});

test("dedupe: key is per user AND season; an attempted send this season blocks, a dry_run or another season does not", () => {
  const key = seasonSignupReminderDedupeKey(SEASON, "user-1");
  assert.equal(key, "season_signup_reminder:season-3:user-1");
  for (const status of ["sent", "delivered", "failed"]) {
    const rows = [{ user_id: "user-1", email_type: SEASON_SIGNUP_REMINDER_EMAIL_KIND, dedupe_key: key, status }];
    assert.equal(select({ emailLogRows: rows }).length, 0, status);
  }
  const dryRun = [{ user_id: "user-1", email_type: SEASON_SIGNUP_REMINDER_EMAIL_KIND, dedupe_key: key, status: "dry_run" }];
  assert.equal(select({ emailLogRows: dryRun }).length, 1);
  const lastSeason = [{
    user_id: "user-1",
    email_type: SEASON_SIGNUP_REMINDER_EMAIL_KIND,
    dedupe_key: seasonSignupReminderDedupeKey("season-2", "user-1"),
    status: "sent",
  }];
  assert.equal(select({ emailLogRows: lastSeason }).length, 1);
});

test("requires a seasonId (the dedupe scope)", () => {
  assert.throws(() => selectSeasonSignupReminderCandidates({ teams: [], users: [] }), /seasonId required/);
});

test("distributionByTemplateLanguage counts DA vs EN as the template renders them", () => {
  assert.deepEqual(
    distributionByTemplateLanguage([{ language: "da" }, { language: "en" }, { language: null }, { language: "de" }]),
    { en: 3, da: 1 }
  );
});

// ─── run loop ──────────────────────────────────────────────────────────────

function inputs(overrides = {}) {
  return {
    seasonId: SEASON,
    teams: [team(), team({ id: "team-2", user_id: "user-2", name: "Hold B" })],
    users: [user(), user({ id: "user-2", email: "b@example.com", language: "da" })],
    subscriptions: [],
    standings: [],
    divisions: [],
    emailLogRows: [],
    ...overrides,
  };
}

test("dry-run (default) never reads the gate, never re-reads state and never sends", async () => {
  let touched = 0;
  const result = await runSeasonSignupReminder({
    loadInputs: async () => inputs(),
    execute: false,
    readSendEnabled: async () => { touched += 1; return true; },
    readFreshState: async () => { touched += 1; return {}; },
    sendEmail: async () => { touched += 1; return { status: "sent" }; },
    now: NOW,
  });
  assert.equal(touched, 0);
  assert.equal(result.mode, "dry_run");
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.byLanguage, { en: 1, da: 1 });
  assert.equal(result.examples.length, 2);
});

test("dry-run examples are capped at 3", async () => {
  const many = Array.from({ length: 5 }, (_, i) => i + 1);
  const result = await runSeasonSignupReminder({
    loadInputs: async () => inputs({
      teams: many.map((i) => team({ id: `team-${i}`, user_id: `user-${i}` })),
      users: many.map((i) => user({ id: `user-${i}`, email: `${i}@example.com` })),
    }),
    execute: false,
    now: NOW,
  });
  assert.equal(result.candidates.length, 5);
  assert.equal(result.examples.length, 3);
});

test("execute refuses to send unless the app_config gate is exactly true", async () => {
  for (const gate of [false, null, "true"]) {
    let sends = 0;
    const result = await runSeasonSignupReminder({
      loadInputs: async () => inputs(),
      execute: true,
      readSendEnabled: async () => gate,
      readFreshState: async () => ({}),
      sendEmail: async () => { sends += 1; return { status: "sent" }; },
      sleep: async () => {},
      now: NOW,
    });
    assert.equal(result.refused, true, String(gate));
    assert.equal(sends, 0);
  }
});

test("execute sends with the per-season dedupe key and skips anyone who signed up, withdrew consent or muted mail meanwhile", async () => {
  const fresh = {
    "user-1": { consent_preferences: { email_marketing: true }, email_prefs: {}, next_season_signup_at: null },
    "user-2": { consent_preferences: { email_marketing: true }, email_prefs: {}, next_season_signup_at: daysAgo(0) },
    "user-3": { consent_preferences: { email_marketing: false }, email_prefs: {}, next_season_signup_at: null },
    "user-4": { consent_preferences: { email_marketing: true }, email_prefs: { winback: false }, next_season_signup_at: null },
  };
  const ids = [1, 2, 3, 4];
  const sent = [];
  const result = await runSeasonSignupReminder({
    loadInputs: async () => inputs({
      teams: ids.map((i) => team({ id: `team-${i}`, user_id: `user-${i}` })),
      users: ids.map((i) => user({ id: `user-${i}`, email: `${i}@example.com` })),
    }),
    execute: true,
    readSendEnabled: async () => true,
    readFreshState: async (userId) => fresh[userId],
    sendEmail: async (candidate, dedupeKey) => { sent.push([candidate.userId, dedupeKey]); return { status: "sent" }; },
    sleep: async () => {},
    now: NOW,
  });
  assert.deepEqual(sent, [["user-1", "season_signup_reminder:season-3:user-1"]]);
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 3);
  assert.equal(result.failed, 0);
});

test("execute counts provider failures and thrown errors as failed, dedupe skips as skipped", async () => {
  const ids = [1, 2, 3];
  const outcomes = { "user-1": { status: "failed" }, "user-2": { skipped: "dedupe" } };
  const result = await runSeasonSignupReminder({
    loadInputs: async () => inputs({
      teams: ids.map((i) => team({ id: `team-${i}`, user_id: `user-${i}` })),
      users: ids.map((i) => user({ id: `user-${i}`, email: `${i}@example.com` })),
    }),
    execute: true,
    readSendEnabled: async () => true,
    readFreshState: async () => ({ consent_preferences: { email_marketing: true }, email_prefs: {} }),
    sendEmail: async (candidate) => {
      if (candidate.userId === "user-3") throw new Error("boom");
      return outcomes[candidate.userId];
    },
    sleep: async () => {},
    now: NOW,
  });
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 2);
  assert.equal(result.skipped, 1);
});
