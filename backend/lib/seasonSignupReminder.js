// #5814 -- one-off "sign up before you are parked" reminder (follow-up to the
// #2760 win-back). Same shape as winbackSegment.js + scripts/winback-send.mjs:
// this module holds the pure segment/dedupe logic AND the run loop with every
// side effect injected, so the whole flow (dry-run report, execute gate,
// per-recipient re-checks) is unit-tested without a database or Resend.
// scripts/season-signup-reminder-send.mjs is only the thin CLI around it.
//
// Recipients = the teams the season switch WOULD park, straight from
// managerParking.selectTeamsToPark (the one predicate, no copy: human team,
// not parked, not frozen, not signed up via next_season_signup_at, no
// protecting subscription, manager away 30+ days), intersected with:
//   - consent_preferences.email_marketing === true (same opt-in gate as
//     win-back, winbackSegment.hasWinbackConsent: NULL is not consent)
//   - email_prefs: not muted for this type, not muted for win-back (a manager
//     who switched win-back mails off asked not to get this kind of mail), and
//     not muted entirely ("all" -- which is also where a Resend hard bounce or
//     spam complaint lands, resendWebhook.suppressUser)
//   - no bounced/complained email_log row of any type, as a second guard for
//     a bounce the webhook could not tie to a user
//   - not already sent this reminder for this season (dedupe key per user AND
//     season, so a later season's reminder is not blocked by this one)
// One mail per user, even if a data error gives a user two teams.
//
// Gates are the win-back's own: --execute refuses unless
// app_config.winback_send_enabled is exactly true (owner-only flip), and the
// default is a pure read-only report.

import { isEmailTypeEnabled } from "./emailPrefs.js";
import { selectActiveSubscriptionTeamIds, selectTeamsToPark } from "./managerParking.js";
import { daysSinceLastSeen } from "./managerActivity.js";
import {
  ALREADY_CONTACTED_STATUSES,
  WINBACK_EMAIL_KIND,
  hasWinbackConsent,
} from "./winbackSegment.js";

export const SEASON_SIGNUP_REMINDER_EMAIL_KIND = "season_signup_reminder";
export const SEASON_SIGNUP_REMINDER_APP_CONFIG_KEY = "winback_send_enabled";

// Statuses that mean the address is dead or the recipient objected.
const SUPPRESSING_STATUSES = new Set(["bounced", "complained"]);

/** One reminder per user per season (the season that is ending). */
export function seasonSignupReminderDedupeKey(seasonId, userId) {
  return `${SEASON_SIGNUP_REMINDER_EMAIL_KIND}:${seasonId}:${userId}`;
}

/**
 * True when email_prefs allows this reminder: not muted entirely ("all"), not
 * muted for win-back, and not muted for this type. The type key is read
 * directly because emailPrefs.isEmailTypeEnabled ignores keys outside
 * EMAIL_PREF_TYPES (this one-off is deliberately not a settable pref type);
 * an explicit false must still win.
 */
export function seasonSignupReminderPrefsAllow(emailPrefs) {
  return isEmailTypeEnabled(emailPrefs, WINBACK_EMAIL_KIND) && emailPrefs?.[SEASON_SIGNUP_REMINDER_EMAIL_KIND] !== false;
}

/**
 * @param {object} args
 * @param {object[]} args.teams          human teams with managerParking.PARKING_TEAM_COLUMNS
 * @param {object[]} args.users          {id, email, last_seen, language, consent_preferences, email_prefs}
 * @param {object[]} [args.subscriptions] managerParking.PARKING_SUBSCRIPTION_COLUMNS rows
 * @param {object[]} [args.standings]    active-season {team_id, rank_in_division, league_division_id}
 * @param {object[]} [args.divisions]    {id, label}
 * @param {object[]} [args.emailLogRows] {user_id, email_type, dedupe_key, status}
 * @param {string|number} args.seasonId  the season that is ending (dedupe scope)
 * @param {Date} [args.now]
 * @param {number} [args.days]
 */
export function selectSeasonSignupReminderCandidates({
  teams = [],
  users = [],
  subscriptions = [],
  standings = [],
  divisions = [],
  emailLogRows = [],
  seasonId,
  now = new Date(),
  days = 30,
} = {}) {
  if (seasonId == null) throw new Error("selectSeasonSignupReminderCandidates: seasonId required");
  const activeSubscriptionTeamIds = selectActiveSubscriptionTeamIds(subscriptions, now);
  const toPark = selectTeamsToPark({ teams, users, now, days, activeSubscriptionTeamIds });

  const userById = new Map(users.filter((u) => u?.id).map((u) => [u.id, u]));
  const standingByTeam = new Map(standings.filter((s) => s?.team_id != null).map((s) => [s.team_id, s]));
  const divisionLabelById = new Map(divisions.filter((d) => d?.id != null).map((d) => [d.id, d.label]));

  const suppressedUsers = new Set(
    emailLogRows.filter((row) => row?.user_id && SUPPRESSING_STATUSES.has(row.status)).map((row) => row.user_id)
  );
  const alreadySentKeys = new Set(
    emailLogRows
      .filter((row) => row?.dedupe_key && ALREADY_CONTACTED_STATUSES.has(row.status))
      .map((row) => row.dedupe_key)
  );

  const seenUsers = new Set();
  const candidates = [];
  for (const team of toPark) {
    const user = team.user_id ? userById.get(team.user_id) : null;
    if (!user?.email) continue;
    if (seenUsers.has(user.id)) continue;
    if (!hasWinbackConsent(user)) continue;
    if (!seasonSignupReminderPrefsAllow(user.email_prefs)) continue;
    if (suppressedUsers.has(user.id)) continue;
    if (alreadySentKeys.has(seasonSignupReminderDedupeKey(seasonId, user.id))) continue;
    seenUsers.add(user.id);

    const standing = standingByTeam.get(team.id) ?? null;
    const divisionId = standing?.league_division_id ?? team.league_division_id ?? null;
    const daysAway = daysSinceLastSeen(user, now);
    candidates.push({
      userId: user.id,
      email: user.email,
      language: user.language ?? null,
      teamId: team.id,
      teamName: team.name ?? null,
      daysSinceLastSeen: daysAway == null ? null : Math.floor(daysAway),
      rankInDivision: standing?.rank_in_division ?? null,
      poolLabel: divisionId != null ? (divisionLabelById.get(divisionId) ?? null) : null,
    });
  }
  return candidates;
}

/** Dry-run counts: EN vs DA as the template renders them (anything but "da" gets English). */
export function distributionByTemplateLanguage(candidates) {
  const counts = { en: 0, da: 0 };
  for (const c of candidates) counts[c.language === "da" ? "da" : "en"] += 1;
  return counts;
}


/**
 * The whole run with every side effect injected. Dry-run (execute=false) only
 * reads and returns the report; it never calls sendEmail or reads the gate.
 *
 * @param {object} deps
 * @param {() => Promise<object>} deps.loadInputs   resolves {teams, users, subscriptions, standings, divisions, emailLogRows, seasonId}
 * @param {boolean} deps.execute
 * @param {() => Promise<boolean>} [deps.readSendEnabled]  app_config gate (execute only)
 * @param {(userId: string, teamId: string) => Promise<{consent_preferences?, email_prefs?, next_season_signup_at?}|null>} [deps.readFreshState]
 * @param {(candidate: object, dedupeKey: string) => Promise<{status?: string, skipped?: string}>} [deps.sendEmail]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {number} [deps.rateLimitMs]
 * @param {Date} [deps.now]
 * @param {(line: string) => void} [deps.log]
 */
export async function runSeasonSignupReminder({
  loadInputs,
  execute,
  readSendEnabled,
  readFreshState,
  sendEmail,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  rateLimitMs = 600,
  now = new Date(),
  log = () => {},
}) {
  const inputs = await loadInputs();
  const candidates = selectSeasonSignupReminderCandidates({ ...inputs, now });
  const byLanguage = distributionByTemplateLanguage(candidates);

  if (!execute) {
    return { mode: "dry_run", seasonId: inputs.seasonId, candidates, byLanguage, examples: candidates.slice(0, 3) };
  }

  if ((await readSendEnabled()) !== true) {
    return { mode: "execute", refused: true, seasonId: inputs.seasonId, candidates, byLanguage };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      // The candidate list is a snapshot from before this (rate-limited) loop.
      // Re-read what can change meanwhile: consent (the opt-in gate), prefs
      // (sendLoopEmail only knows the "all" switch for this type), and the
      // sign-up itself -- a manager who pressed the button a minute ago must
      // not get a mail telling her to press it.
      const fresh = await readFreshState(candidate.userId, candidate.teamId);
      if (
        !hasWinbackConsent(fresh) ||
        !seasonSignupReminderPrefsAllow(fresh?.email_prefs) ||
        fresh?.next_season_signup_at != null
      ) {
        skipped += 1;
        continue;
      }
      const result = await sendEmail(candidate, seasonSignupReminderDedupeKey(inputs.seasonId, candidate.userId));
      if (result?.status === "sent") sent += 1;
      else if (result?.status === "failed") failed += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      log(`  fejl for bruger ${candidate.userId}: ${err?.message || err}`);
    }
    await sleep(rateLimitMs);
  }
  return { mode: "execute", refused: false, seasonId: inputs.seasonId, candidates, byLanguage, sent, skipped, failed };
}
