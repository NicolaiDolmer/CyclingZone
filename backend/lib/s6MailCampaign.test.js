import test from "node:test";
import assert from "node:assert/strict";
import {
  S6_MAIL_APP_CONFIG_KEY,
  S6_MAIL_EMAIL_KIND,
  S6_MAIL_SUBJECT_VARIANT,
  isS6HumanTeam,
  runS6Mail,
  s6MailAudience,
  s6MailDedupeKey,
  s6MailDistribution,
  s6MailLanguage,
  s6MailPrefsAllow,
  s6MailTestMatrix,
  selectS6MailCandidates,
} from "./s6MailCampaign.js";
import { buildS6SeasonEmail, s6AudienceForDaysAway } from "./emailTemplates.js";

const NOW = new Date("2026-11-26T10:00:00.000Z");
const DAY_MS = 86_400_000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY_MS).toISOString();
const EDITION = "before-start";

function team(overrides = {}) {
  return {
    id: "team-1",
    user_id: "user-1",
    name: "Hold A",
    is_ai: false,
    is_bank: false,
    is_test_account: false,
    is_frozen: false,
    ...overrides,
  };
}

function user(overrides = {}) {
  return {
    id: "user-1",
    email: "a@example.com",
    last_seen: daysAgo(3),
    language: "en",
    consent_preferences: { email_marketing: true },
    email_prefs: {},
    ...overrides,
  };
}

function select(overrides = {}) {
  return selectS6MailCandidates({ teams: [team()], users: [user()], now: NOW, ...overrides });
}

// ── constants ───────────────────────────────────────────────────────────

test("own email type, win-back's app_config gate, subject A", () => {
  assert.equal(S6_MAIL_EMAIL_KIND, "s6_season");
  assert.equal(S6_MAIL_APP_CONFIG_KEY, "winback_send_enabled");
  assert.equal(S6_MAIL_SUBJECT_VARIANT, "a");
});

// ── segment: human teams only ───────────────────────────────────────────

test("segment: a consenting human manager is a candidate", () => {
  const [c, ...rest] = select();
  assert.equal(rest.length, 0);
  assert.equal(c.userId, "user-1");
  assert.equal(c.teamId, "team-1");
  assert.equal(c.teamName, "Hold A");
});

for (const flag of ["is_ai", "is_bank", "is_test_account"]) {
  test(`segment: ${flag} team is excluded`, () => {
    assert.equal(select({ teams: [team({ [flag]: true })] }).length, 0);
  });
  test(`segment: ${flag} unknown (null) is excluded, not read as human`, () => {
    assert.equal(select({ teams: [team({ [flag]: null })] }).length, 0);
  });
}

test("segment: frozen team is excluded", () => {
  assert.equal(select({ teams: [team({ is_frozen: true })] }).length, 0);
  assert.equal(isS6HumanTeam(team({ is_frozen: true })), false);
});

test("segment: team without a user or a user without email is excluded", () => {
  assert.equal(select({ teams: [team({ user_id: null })] }).length, 0);
  assert.equal(select({ users: [user({ email: null })] }).length, 0);
  assert.equal(select({ users: [] }).length, 0);
});

test("segment: one mail per user even with two teams, and per address", () => {
  const twoTeams = select({ teams: [team(), team({ id: "team-2", name: "Hold B" })] });
  assert.equal(twoTeams.length, 1);
  const sharedAddress = select({
    teams: [team(), team({ id: "team-2", user_id: "user-2" })],
    users: [user(), user({ id: "user-2", email: " A@Example.com " })],
  });
  assert.equal(sharedAddress.length, 1);
});

// ── consent + prefs + suppression ───────────────────────────────────────

test("consent: only an explicit email_marketing true counts", () => {
  assert.equal(select({ users: [user({ consent_preferences: null })] }).length, 0);
  assert.equal(select({ users: [user({ consent_preferences: {} })] }).length, 0);
  assert.equal(select({ users: [user({ consent_preferences: { email_marketing: false } })] }).length, 0);
  assert.equal(select({ users: [user({ consent_preferences: { email_marketing: "true" } })] }).length, 0);
  // The ad category is not the mail gate.
  assert.equal(select({ users: [user({ consent_preferences: { marketing: true } })] }).length, 0);
});

test("prefs: all, winback or this type muted excludes; others do not", () => {
  assert.equal(s6MailPrefsAllow({}), true);
  assert.equal(s6MailPrefsAllow(null), true);
  assert.equal(s6MailPrefsAllow({ race_digest: false }), true);
  assert.equal(s6MailPrefsAllow({ all: false }), false);
  assert.equal(s6MailPrefsAllow({ winback: false }), false);
  assert.equal(s6MailPrefsAllow({ s6_season: false }), false);
  assert.equal(select({ users: [user({ email_prefs: { all: false } })] }).length, 0);
});

test("suppression: a bounced or complained row of any type excludes the user", () => {
  for (const status of ["bounced", "complained"]) {
    const rows = [{ user_id: "user-1", email_type: "welcome", dedupe_key: "welcome:user-1", status }];
    assert.equal(select({ emailLogRows: rows }).length, 0, status);
  }
  const delivered = [{ user_id: "user-1", email_type: "welcome", dedupe_key: "welcome:user-1", status: "delivered" }];
  assert.equal(select({ emailLogRows: delivered }).length, 1);
});

// ── dedupe ──────────────────────────────────────────────────────────────

test("dedupe: key is per edition and user", () => {
  assert.equal(s6MailDedupeKey(EDITION, "user-1"), "s6_season:before-start:user-1");
  assert.throws(() => s6MailDedupeKey("later", "user-1"), /unknown S6 mail edition/);
});

test("dedupe: an attempted mail 1 blocks a rerun; dry_run and other mails do not", () => {
  const key = s6MailDedupeKey(EDITION, "user-1");
  for (const status of ["sent", "delivered", "failed"]) {
    const rows = [{ user_id: "user-1", email_type: S6_MAIL_EMAIL_KIND, dedupe_key: key, status }];
    assert.equal(select({ emailLogRows: rows }).length, 0, status);
  }
  const dryRun = [{ user_id: "user-1", email_type: S6_MAIL_EMAIL_KIND, dedupe_key: key, status: "dry_run" }];
  assert.equal(select({ emailLogRows: dryRun }).length, 1);
  const winback = [{ user_id: "user-1", email_type: "winback", dedupe_key: "winback:s5-launch:user-1", status: "sent" }];
  assert.equal(select({ emailLogRows: winback }).length, 1);
});

test("dedupe: unknown edition is refused", () => {
  assert.throws(() => select({ edition: "started" }), /unknown S6 mail edition/);
});

// ── audience ────────────────────────────────────────────────────────────

test("audience: whole days since last_seen through s6AudienceForDaysAway", () => {
  for (const days of [0, 1, 13, 14, 30, 56, 57, 200]) {
    assert.equal(s6MailAudience(user({ last_seen: daysAgo(days) }), NOW), s6AudienceForDaysAway(days), `${days}`);
  }
  // A part-day rounds down: 13.9 days away is still under two weeks.
  assert.equal(s6MailAudience(user({ last_seen: daysAgo(13.9) }), NOW), "active");
});

test("audience: no or unreadable last_seen is away; future last_seen counts as today", () => {
  assert.equal(s6MailAudience(user({ last_seen: null }), NOW), "away");
  assert.equal(s6MailAudience(user({ last_seen: "not a date" }), NOW), "away");
  assert.equal(s6MailAudience(user({ last_seen: daysAgo(-1) }), NOW), "active");
});

test("audience: candidates carry their audience", () => {
  const rows = select({
    teams: [team(), team({ id: "team-2", user_id: "user-2" }), team({ id: "team-3", user_id: "user-3" })],
    users: [
      user({ last_seen: daysAgo(2) }),
      user({ id: "user-2", email: "b@example.com", last_seen: daysAgo(30) }),
      user({ id: "user-3", email: "c@example.com", last_seen: null }),
    ],
  });
  assert.deepEqual(rows.map((c) => [c.userId, c.audience]), [["user-1", "active"], ["user-2", "dormant"], ["user-3", "away"]]);
  assert.equal(rows[2].daysSinceLastSeen, null);
});

// ── language ────────────────────────────────────────────────────────────

test("language: da stays Danish, anything else falls back to English", () => {
  assert.equal(s6MailLanguage("da"), "da");
  assert.equal(s6MailLanguage("en"), "en");
  assert.equal(s6MailLanguage(null), "en");
  assert.equal(s6MailLanguage("de"), "en");
  assert.equal(select({ users: [user({ language: "da" })] })[0].language, "da");
  assert.equal(select({ users: [user({ language: null })] })[0].language, "en");
});

test("distribution: counts per audience and language, every cell present", () => {
  const dist = s6MailDistribution([
    { audience: "active", language: "da" },
    { audience: "active", language: "en" },
    { audience: "away", language: null },
  ]);
  assert.deepEqual(dist, {
    active: { en: 1, da: 1 },
    dormant: { en: 0, da: 0 },
    away: { en: 1, da: 0 },
  });
});

test("test matrix: one pair per audience and language", () => {
  const pairs = s6MailTestMatrix();
  assert.equal(pairs.length, 6);
  assert.equal(new Set(pairs.map((p) => `${p.audience}/${p.language}`)).size, 6);
});

test("every pair renders mail 1 with subject A and the unsubscribe link", () => {
  const unsubscribeUrl = "https://cyclingzone.org/api/email/unsubscribe?token=dry-run";
  for (const { audience, language } of s6MailTestMatrix()) {
    const mail = buildS6SeasonEmail({ edition: EDITION, audience, language, unsubscribeUrl, subjectVariant: S6_MAIL_SUBJECT_VARIANT, teamName: "Hold A" });
    assert.equal(mail.subject, mail.subjectVariants.a, `${audience}/${language}`);
    assert.ok(mail.html.includes("token=dry-run"), `${audience}/${language}`);
    assert.ok(mail.text.includes("token=dry-run"), `${audience}/${language}`);
  }
});

// ── run loop ────────────────────────────────────────────────────────────

const inputs = () => ({
  teams: [team(), team({ id: "team-2", user_id: "user-2" })],
  users: [user(), user({ id: "user-2", email: "b@example.com", language: "da", last_seen: daysAgo(40) })],
  emailLogRows: [],
});
const noSleep = async () => {};
const forbidden = (name) => async () => {
  throw new Error(`${name} must not be called`);
};

test("run: dry-run reports counts only and never sends or reads the gate", async () => {
  const result = await runS6Mail({
    mode: "dry_run",
    loadInputs: async () => inputs(),
    readSendEnabled: forbidden("readSendEnabled"),
    sendEmail: forbidden("sendEmail"),
    sendTestEmail: forbidden("sendTestEmail"),
    readFreshUser: forbidden("readFreshUser"),
    now: NOW,
    sleep: noSleep,
  });
  assert.equal(result.mode, "dry_run");
  assert.equal(result.total, 2);
  assert.equal(result.distribution.active.en, 1);
  assert.equal(result.distribution.dormant.da, 1);
  assert.equal(JSON.stringify(result).includes("@"), false, "the report holds no addresses");
});

test("run: execute refuses unless the gate is exactly true", async () => {
  for (const gate of [false, null, "true", 1]) {
    const result = await runS6Mail({
      mode: "execute",
      loadInputs: async () => inputs(),
      readSendEnabled: async () => gate,
      sendEmail: forbidden("sendEmail"),
      readFreshUser: forbidden("readFreshUser"),
      now: NOW,
      sleep: noSleep,
    });
    assert.equal(result.refused, true, String(gate));
  }
});

test("run: execute re-checks consent and prefs per recipient and uses the edition key", async () => {
  const sentKeys = [];
  const result = await runS6Mail({
    mode: "execute",
    loadInputs: async () => inputs(),
    readSendEnabled: async () => true,
    readFreshUser: async (id) =>
      id === "user-2"
        ? user({ id, consent_preferences: { email_marketing: false } })
        : user({ id, last_seen: daysAgo(20) }),
    sendEmail: async (candidate, key) => {
      sentKeys.push([key, candidate.audience]);
      return { status: "sent" };
    },
    now: NOW,
    sleep: noSleep,
  });
  assert.deepEqual(sentKeys, [["s6_season:before-start:user-1", "dormant"]], "audience re-picked from the fresh row");
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
});

test("run: execute counts failed, skipped (dedupe) and thrown sends", async () => {
  const outcomes = [{ status: "failed" }, { skipped: "dedupe" }];
  const lines = [];
  const result = await runS6Mail({
    mode: "execute",
    loadInputs: async () => ({
      ...inputs(),
      teams: [...inputs().teams, team({ id: "team-3", user_id: "user-3" })],
      users: [...inputs().users, user({ id: "user-3", email: "c@example.com" })],
    }),
    readSendEnabled: async () => true,
    readFreshUser: async (id) => user({ id }),
    sendEmail: async () => {
      const next = outcomes.shift();
      if (!next) throw new Error("boom");
      return next;
    },
    now: NOW,
    sleep: noSleep,
    log: (line) => lines.push(line),
  });
  assert.equal(result.failed, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.sent, 0);
  assert.equal(lines.length, 1);
});

test("run: test mode sends one mail per audience and language to the one address, reads no recipients", async () => {
  const calls = [];
  const result = await runS6Mail({
    mode: "test",
    testTo: "owner@example.com",
    loadInputs: forbidden("loadInputs"),
    readSendEnabled: forbidden("readSendEnabled"),
    sendEmail: forbidden("sendEmail"),
    sendTestEmail: async (args) => {
      calls.push(args);
      return { status: "sent" };
    },
    sleep: noSleep,
    now: NOW,
  });
  assert.equal(result.sent, 6);
  assert.equal(result.failed, 0);
  assert.ok(calls.every((c) => c.to === "owner@example.com" && c.subjectVariant === "a" && c.edition === EDITION));
  assert.equal(new Set(calls.map((c) => `${c.audience}/${c.language}`)).size, 6);
});

test("run: test mode needs an address and unknown modes are refused", async () => {
  await assert.rejects(runS6Mail({ mode: "test", testTo: "", sendTestEmail: forbidden("sendTestEmail"), now: NOW }), /needs one address/);
  await assert.rejects(runS6Mail({ mode: "send", now: NOW }), /unknown mode/);
});

test("segment: a rerun never mails a second account that shares an already contacted address (Codex P2, #8767)", () => {
  const firstRun = select({
    teams: [team(), team({ id: "team-2", user_id: "user-2" })],
    users: [user(), user({ id: "user-2", email: " A@Example.com " })],
  });
  assert.equal(firstRun.length, 1);
  const contacted = firstRun[0].userId;
  const rerun = select({
    teams: [team(), team({ id: "team-2", user_id: "user-2" })],
    users: [user(), user({ id: "user-2", email: " A@Example.com " })],
    emailLogRows: [{ user_id: contacted, dedupe_key: s6MailDedupeKey(EDITION, contacted), status: "sent" }],
  });
  assert.equal(rerun.length, 0);
});
