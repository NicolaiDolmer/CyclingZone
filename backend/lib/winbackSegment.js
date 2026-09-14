// One-off #2760 win-back campaign: pure, DB-free segment + dedupe logic.
// scripts/winback-send.mjs is the only caller. This mirrors
// docs/audits/winback-consent-audit-2026-09-02.md section 2's read-only SQL
// 1:1 as JS predicates over already-fetched rows, so the actual filter can be
// unit-tested against a fixture without ever touching prod -- owner rule
// 14/9: dry-run numbers for this campaign are computed read-only by the
// orchestrator AFTER this PR, never by the session that builds the send path.
//
// Reuses managerActivity.js's isDormantManager (SSOT for the 30-day dormancy
// threshold, owner decision 2/9, #4592) and emailPrefs.js's
// isEmailTypeEnabled (SSOT for the email_prefs opt-out semantics, #2725)
// instead of re-deriving either rule here.
//
// Consent gate (audit section 1.3): a win-back mail to a manager absent 30+
// days is marketing, not a service message tied to an in-progress
// transaction -- so the gate is the EXPLICIT opt-in
// consent_preferences.email_marketing === true. NULL (banner never answered)
// and false both exclude; NULL must never read as silent consent (GDPR art.
// 4(11)).
//
// Population filter (audit section 2, same discriminator as
// managerActivity.js's callers): human teams only (is_ai/is_bank/
// is_test_account all false), AND is_frozen false -- a parked/frozen team is
// not a useful win-back target ahead of #4592's parking flow being built out.

import { isDormantManager } from "./managerActivity.js";
import { isEmailTypeEnabled } from "./emailPrefs.js";

export const WINBACK_DORMANCY_DAYS = 30;
export const WINBACK_EMAIL_TYPE = "winback";

const DAY_MS = 86_400_000;

// email_log statuses that mean "already attempted" for this one-off send --
// mirrors emailService.js's dedupeBlocksSend 1:1 (dry_run never blocks). This
// script never writes a dry_run row itself (see scripts/winback-send.mjs
// header: --dry-run is a pure read-only report, no email_log writes at all),
// but the constant stays correct in case a future run ever does.
const ALREADY_CONTACTED_STATUSES = new Set(["sent", "delivered", "bounced", "complained", "failed"]);

function isHumanTeam(team) {
  return (
    !!team &&
    team.is_ai === false &&
    team.is_bank === false &&
    team.is_test_account === false &&
    team.is_frozen === false
  );
}

function hasWinbackConsent(user) {
  return user?.consent_preferences?.email_marketing === true;
}

/**
 * @param {object} args
 * @param {Array<{id, user_id, name, is_ai, is_bank, is_test_account, is_frozen, league_division_id}>} args.teams
 * @param {Array<{id, email, last_seen, language, consent_preferences, email_prefs}>} args.users
 * @param {Array<{team_id, rank_in_division, league_division_id}>} [args.standings] active-season season_standings rows
 * @param {Array<{id, label}>} [args.divisions] league_divisions rows
 * @param {Array<{user_id, email_type, status}>} [args.emailLogRows] existing email_log rows (any type -- filtered internally to "winback")
 * @param {Date} [args.now]
 * @returns {Array<{userId, email, language, teamId, teamName, daysSinceLastSeen: number|null, rankInDivision: number|null, poolLabel: string|null}>}
 */
export function selectWinbackCandidates({
  teams = [],
  users = [],
  standings = [],
  divisions = [],
  emailLogRows = [],
  now = new Date(),
} = {}) {
  // Same one-team-per-user assumption as emailRaceDigestSweep.js's teamByUser
  // map (a later team for the same user_id wins on a data violation of that
  // assumption -- a pre-existing convention this file inherits, not a new
  // one).
  const teamByUser = new Map();
  for (const team of teams) {
    if (!team?.user_id || !isHumanTeam(team)) continue;
    teamByUser.set(team.user_id, team);
  }

  const standingByTeam = new Map(standings.filter((s) => s?.team_id != null).map((s) => [s.team_id, s]));
  const divisionLabelById = new Map(divisions.filter((d) => d?.id != null).map((d) => [d.id, d.label]));

  const alreadyContacted = new Set(
    emailLogRows
      .filter((row) => row?.email_type === WINBACK_EMAIL_TYPE && ALREADY_CONTACTED_STATUSES.has(row.status))
      .map((row) => row.user_id)
  );

  const candidates = [];
  for (const user of users) {
    if (!user?.id || !user.email) continue;
    const team = teamByUser.get(user.id);
    if (!team) continue;
    if (!isDormantManager(user, now, { days: WINBACK_DORMANCY_DAYS })) continue;
    if (!hasWinbackConsent(user)) continue;
    if (!isEmailTypeEnabled(user.email_prefs, WINBACK_EMAIL_TYPE)) continue;
    if (alreadyContacted.has(user.id)) continue;

    const daysSinceLastSeen = user.last_seen
      ? Math.floor((now.getTime() - new Date(user.last_seen).getTime()) / DAY_MS)
      : null;
    const standing = standingByTeam.get(team.id) ?? null;
    const divisionId = standing?.league_division_id ?? team.league_division_id ?? null;

    candidates.push({
      userId: user.id,
      email: user.email,
      language: user.language ?? null,
      teamId: team.id,
      teamName: team.name ?? null,
      daysSinceLastSeen,
      rankInDivision: standing?.rank_in_division ?? null,
      poolLabel: divisionId != null ? (divisionLabelById.get(divisionId) ?? null) : null,
    });
  }
  return candidates;
}

/** Dry-run report helper: counts per users.language ("en"/"da"/... "unknown" for null/missing). */
export function distributionByLanguage(candidates) {
  const counts = {};
  for (const c of candidates) {
    const key = c.language || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** Dry-run report helper: counts per pool/division label ("unknown" when the team has no active-season standing yet). */
export function distributionByPool(candidates) {
  const counts = {};
  for (const c of candidates) {
    const key = c.poolLabel || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// One-off, once-ever dedupe key -- unlike the retention loop's per-week/per-
// day keys (#2853), win-back has no recurring cadence to key off, so the key
// is just the user id (scope point 3, "idempotent pr. bruger").
export function winbackDedupeKey(userId) {
  return `winback:${userId}`;
}
