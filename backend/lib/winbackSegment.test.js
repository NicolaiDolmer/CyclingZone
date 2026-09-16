import test from "node:test";
import assert from "node:assert/strict";
import {
  selectWinbackCandidates,
  distributionByLanguage,
  distributionByPool,
  winbackDedupeKey,
  WINBACK_DORMANCY_DAYS,
  WINBACK_EMAIL_KIND,
} from "./winbackSegment.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const DAY_MS = 86_400_000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY_MS).toISOString();

function humanTeam(overrides = {}) {
  return {
    id: "team-1",
    user_id: "user-1",
    name: "Team Velodrome",
    is_ai: false,
    is_bank: false,
    is_test_account: false,
    is_frozen: false,
    league_division_id: "div-1",
    ...overrides,
  };
}

function consentingUser(overrides = {}) {
  return {
    id: "user-1",
    email: "manager@example.com",
    last_seen: daysAgo(45),
    language: "en",
    consent_preferences: { email_marketing: true },
    email_prefs: {},
    ...overrides,
  };
}

test("includes a dormant, consenting human manager", () => {
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [consentingUser()], now: NOW });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].userId, "user-1");
  assert.equal(candidates[0].email, "manager@example.com");
  assert.equal(candidates[0].teamName, "Team Velodrome");
  assert.equal(candidates[0].daysSinceLastSeen, 45);
});

test("excludes NULL consent (never answered the banner) -- NULL is not consent", () => {
  const user = consentingUser({ consent_preferences: null });
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [user], now: NOW });
  assert.equal(candidates.length, 0);
});

test("excludes consent_preferences.email_marketing === false", () => {
  const user = consentingUser({ consent_preferences: { email_marketing: false } });
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [user], now: NOW });
  assert.equal(candidates.length, 0);
});

test("excludes consent_preferences.marketing === true (wrong category -- must be email_marketing)", () => {
  const user = consentingUser({ consent_preferences: { marketing: true, email_marketing: undefined } });
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [user], now: NOW });
  assert.equal(candidates.length, 0);
});

test("excludes a manager active within the dormancy window", () => {
  const user = consentingUser({ last_seen: daysAgo(10) });
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [user], now: NOW });
  assert.equal(candidates.length, 0);
});

test(`boundary: exactly ${WINBACK_DORMANCY_DAYS} days absent is included (>=, not >)`, () => {
  const user = consentingUser({ last_seen: daysAgo(WINBACK_DORMANCY_DAYS) });
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [user], now: NOW });
  assert.equal(candidates.length, 1);
});

test("includes a manager who has never logged back in (last_seen null)", () => {
  const user = consentingUser({ last_seen: null });
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [user], now: NOW });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].daysSinceLastSeen, null);
});

for (const flag of ["is_ai", "is_bank", "is_test_account", "is_frozen"]) {
  test(`excludes a team with ${flag}=true`, () => {
    const candidates = selectWinbackCandidates({
      teams: [humanTeam({ [flag]: true })],
      users: [consentingUser()],
      now: NOW,
    });
    assert.equal(candidates.length, 0);
  });
}

test("excludes a user with no team at all", () => {
  const candidates = selectWinbackCandidates({ teams: [], users: [consentingUser()], now: NOW });
  assert.equal(candidates.length, 0);
});

test("excludes a user with no email", () => {
  const user = consentingUser({ email: null });
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [user], now: NOW });
  assert.equal(candidates.length, 0);
});

test("excludes email_prefs.winback === false (per-type opt-out)", () => {
  const user = consentingUser({ email_prefs: { winback: false } });
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [user], now: NOW });
  assert.equal(candidates.length, 0);
});

test("excludes email_prefs.all === false (master opt-out)", () => {
  const user = consentingUser({ email_prefs: { all: false } });
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [user], now: NOW });
  assert.equal(candidates.length, 0);
});

test("excludes a user already contacted (email_log winback row, status=sent)", () => {
  const emailLogRows = [{ user_id: "user-1", email_type: WINBACK_EMAIL_KIND, status: "sent" }];
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [consentingUser()], emailLogRows, now: NOW });
  assert.equal(candidates.length, 0);
});

test("excludes a user already contacted with a terminal failed row (no retry for a one-off send)", () => {
  const emailLogRows = [{ user_id: "user-1", email_type: WINBACK_EMAIL_KIND, status: "failed" }];
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [consentingUser()], emailLogRows, now: NOW });
  assert.equal(candidates.length, 0);
});

test("does NOT exclude on a dry_run email_log row (dry_run never blocks, same rule as emailService.js)", () => {
  const emailLogRows = [{ user_id: "user-1", email_type: WINBACK_EMAIL_KIND, status: "dry_run" }];
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [consentingUser()], emailLogRows, now: NOW });
  assert.equal(candidates.length, 1);
});

test("does NOT exclude on an email_log row of a DIFFERENT email type (e.g. race_digest)", () => {
  const emailLogRows = [{ user_id: "user-1", email_type: "race_digest", status: "sent" }];
  const candidates = selectWinbackCandidates({ teams: [humanTeam()], users: [consentingUser()], emailLogRows, now: NOW });
  assert.equal(candidates.length, 1);
});

test("attaches rank + pool label from the active-season standing when one exists", () => {
  const standings = [{ team_id: "team-1", rank_in_division: 4, league_division_id: "div-9" }];
  const divisions = [{ id: "div-9", label: "D3 Pool B" }];
  const candidates = selectWinbackCandidates({
    teams: [humanTeam()],
    users: [consentingUser()],
    standings,
    divisions,
    now: NOW,
  });
  assert.equal(candidates[0].rankInDivision, 4);
  assert.equal(candidates[0].poolLabel, "D3 Pool B");
});

test("falls back to the team's own league_division_id when there is no active-season standing row", () => {
  const divisions = [{ id: "div-1", label: "D3 Pool A" }];
  const candidates = selectWinbackCandidates({
    teams: [humanTeam({ league_division_id: "div-1" })],
    users: [consentingUser()],
    divisions,
    now: NOW,
  });
  assert.equal(candidates[0].rankInDivision, null);
  assert.equal(candidates[0].poolLabel, "D3 Pool A");
});

test("rank/pool are null when neither a standing nor a division label can be resolved", () => {
  const candidates = selectWinbackCandidates({
    teams: [humanTeam({ league_division_id: null })],
    users: [consentingUser()],
    now: NOW,
  });
  assert.equal(candidates[0].rankInDivision, null);
  assert.equal(candidates[0].poolLabel, null);
});

test("distributionByLanguage counts per language, unknown for missing", () => {
  const candidates = [{ language: "en" }, { language: "en" }, { language: "da" }, { language: null }];
  assert.deepEqual(distributionByLanguage(candidates), { en: 2, da: 1, unknown: 1 });
});

test("distributionByPool counts per pool label, unknown for missing", () => {
  const candidates = [{ poolLabel: "D3 Pool A" }, { poolLabel: "D3 Pool A" }, { poolLabel: null }];
  assert.deepEqual(distributionByPool(candidates), { "D3 Pool A": 2, unknown: 1 });
});

test("winbackDedupeKey is a stable, once-ever key per user (no time component)", () => {
  assert.equal(winbackDedupeKey("user-1"), "winback:user-1");
  assert.equal(winbackDedupeKey("user-1"), winbackDedupeKey("user-1"));
});

test("multiple independent candidates in one pass (segment shape, not just single-user unit checks)", () => {
  const teams = [
    humanTeam({ id: "team-1", user_id: "user-1" }),
    humanTeam({ id: "team-2", user_id: "user-2", is_frozen: true }),
    humanTeam({ id: "team-3", user_id: "user-3" }),
  ];
  const users = [
    consentingUser({ id: "user-1" }),
    consentingUser({ id: "user-2" }), // excluded: frozen team
    consentingUser({ id: "user-3", consent_preferences: { email_marketing: false } }), // excluded: no consent
  ];
  const candidates = selectWinbackCandidates({ teams, users, now: NOW });
  assert.deepEqual(
    candidates.map((c) => c.userId),
    ["user-1"]
  );
});
