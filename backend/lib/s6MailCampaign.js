// #8396 -- Season 6 mail 1 ("before-start") sender. Same shape as
// seasonSignupReminder.js + winbackSegment.js: this module holds the pure
// segment/consent/dedupe logic AND the run loop with every side effect
// injected, so dry-run, test send and execute are unit-tested without a
// database or Resend. scripts/s6-mail-send.mjs is only the thin CLI around it.
//
// Recipients:
//   - human teams only (is_ai, is_bank and is_test_account all false) that
//     are not frozen, the same population filter as the win-back
//     (winbackSegment.js); one mail per user and per address, even if a data
//     error gives a user two teams
//   - consent: consent_preferences.email_marketing === true, the opt-in gate
//     every earlier season mail used (winbackSegment.hasWinbackConsent; the
//     S5 launch mail and the season sign-up reminder). The banner text for
//     that choice is "occasional newsletters about major season updates or
//     events", which is exactly what the mail footer says the reader opted in
//     to. NULL (banner never answered) is not consent.
//   - email_prefs: not muted entirely ("all", which is also where a Resend
//     hard bounce or spam complaint lands via resendWebhook.suppressUser),
//     not muted for win-back (the switch the earlier season mails were sent
//     under) and not muted for this type
//   - no bounced/complained email_log row of any type, as a second guard for
//     a bounce the webhook could not tie to a user
//   - not already sent this edition: the dedupe key is per edition and user,
//     so a rerun never mails anyone twice and mail 2 ("started") is not
//     blocked by mail 1
//
// Audience = s6AudienceForDaysAway(whole days since users.last_seen), with
// managerActivity.daysSinceLastSeen as the "last seen" source (the same one
// the dormancy rule uses). Language = users.language ("da" or English).
// Subject = variant "a" (owner 25/11).
//
// Gates are the win-back's own: --execute refuses unless
// app_config.winback_send_enabled is exactly true (owner-only flip), and the
// default is a pure read-only report. A test send goes to one given address
// only and never writes email_log.

import { isEmailTypeEnabled } from "./emailPrefs.js";
import { daysSinceLastSeen } from "./managerActivity.js";
import { S6_AUDIENCES, s6AudienceForDaysAway } from "./emailTemplates.js";
import { ALREADY_CONTACTED_STATUSES, WINBACK_EMAIL_KIND, hasWinbackConsent } from "./winbackSegment.js";

export const S6_MAIL_EMAIL_KIND = "s6_season";
export const S6_MAIL_APP_CONFIG_KEY = "winback_send_enabled";
// Only mail 1 is wired up in this sender; mail 2 gets its own go.
export const S6_MAIL_EDITIONS = Object.freeze(["before-start"]);
export const S6_MAIL_DEFAULT_EDITION = "before-start";
export const S6_MAIL_SUBJECT_VARIANT = "a";
export const S6_MAIL_LANGUAGES = Object.freeze(["en", "da"]);

// Statuses that mean the address is dead or the recipient objected.
const SUPPRESSING_STATUSES = new Set(["bounced", "complained"]);

export function isKnownS6MailEdition(edition) {
  return S6_MAIL_EDITIONS.includes(edition);
}

function assertEdition(edition) {
  if (!isKnownS6MailEdition(edition)) throw new Error(`unknown S6 mail edition: ${edition}`);
}

/** One mail per user per edition, across reruns. */
export function s6MailDedupeKey(edition, userId) {
  assertEdition(edition);
  return `${S6_MAIL_EMAIL_KIND}:${edition}:${userId}`;
}

/** The population filter: a human team that is not frozen. */
export function isS6HumanTeam(team) {
  return (
    !!team &&
    team.is_ai === false &&
    team.is_bank === false &&
    team.is_test_account === false &&
    team.is_frozen !== true
  );
}

/**
 * True when email_prefs allows this mail: not muted entirely, not muted for
 * win-back and not muted for this type. The type key is read directly because
 * emailPrefs.isEmailTypeEnabled ignores keys outside EMAIL_PREF_TYPES; an
 * explicit false must still win.
 */
export function s6MailPrefsAllow(emailPrefs) {
  return isEmailTypeEnabled(emailPrefs, WINBACK_EMAIL_KIND) && emailPrefs?.[S6_MAIL_EMAIL_KIND] !== false;
}

/** The manager's language as the template renders it: Danish or English. */
export function s6MailLanguage(language) {
  return language === "da" ? "da" : "en";
}

/**
 * Audience from users.last_seen. A missing or unreadable visit reads as away
 * (s6AudienceForDaysAway's own rule); a last_seen slightly in the future
 * (clock skew) counts as today.
 */
export function s6MailAudience(user, now) {
  const days = daysSinceLastSeen(user, now);
  if (days === null) return s6AudienceForDaysAway(null);
  return s6AudienceForDaysAway(Math.max(0, Math.floor(days)));
}

/** True when a fresh user row still passes the consent and prefs gates. */
export function s6MailUserStillAllowed(user) {
  return !!user && hasWinbackConsent(user) && s6MailPrefsAllow(user.email_prefs);
}

/**
 * @param {object} args
 * @param {object[]} args.teams         {id, user_id, name, is_ai, is_bank, is_test_account, is_frozen}
 * @param {object[]} args.users         {id, email, last_seen, language, consent_preferences, email_prefs}
 * @param {object[]} [args.emailLogRows] {user_id, email_type, dedupe_key, status}
 * @param {string} [args.edition]
 * @param {Date} [args.now]
 * @returns {Array<{userId, email, language, teamId, teamName, daysSinceLastSeen: number|null, audience}>}
 */
export function selectS6MailCandidates({
  teams = [],
  users = [],
  emailLogRows = [],
  edition = S6_MAIL_DEFAULT_EDITION,
  now = new Date(),
} = {}) {
  assertEdition(edition);
  const userById = new Map(users.filter((u) => u?.id).map((u) => [u.id, u]));

  const suppressedUsers = new Set(
    emailLogRows.filter((row) => row?.user_id && SUPPRESSING_STATUSES.has(row.status)).map((row) => row.user_id)
  );
  const alreadySentKeys = new Set(
    emailLogRows
      .filter((row) => row?.dedupe_key && ALREADY_CONTACTED_STATUSES.has(row.status))
      .map((row) => row.dedupe_key)
  );

  const seenUsers = new Set();
  const seenAddresses = new Set();
  // Codex P2 (#8767): a rerun must not mail a second account that shares an
  // address with someone already contacted in this edition. Seed the address
  // set from already-contacted users before picking new candidates.
  for (const row of emailLogRows) {
    if (!row?.user_id || !ALREADY_CONTACTED_STATUSES.has(row.status)) continue;
    if (row.dedupe_key !== s6MailDedupeKey(edition, row.user_id)) continue;
    const contacted = userById.get(row.user_id);
    if (contacted?.email) seenAddresses.add(String(contacted.email).trim().toLowerCase());
  }
  const candidates = [];
  for (const team of teams) {
    if (!isS6HumanTeam(team) || !team.user_id) continue;
    const user = userById.get(team.user_id);
    if (!user?.email) continue;
    const address = String(user.email).trim().toLowerCase();
    if (seenUsers.has(user.id) || seenAddresses.has(address)) continue;
    if (!s6MailUserStillAllowed(user)) continue;
    if (suppressedUsers.has(user.id)) continue;
    if (alreadySentKeys.has(s6MailDedupeKey(edition, user.id))) continue;
    seenUsers.add(user.id);
    seenAddresses.add(address);

    const days = daysSinceLastSeen(user, now);
    candidates.push({
      userId: user.id,
      email: user.email,
      language: s6MailLanguage(user.language),
      teamId: team.id,
      teamName: team.name ?? null,
      daysSinceLastSeen: days === null ? null : Math.max(0, Math.floor(days)),
      audience: s6MailAudience(user, now),
    });
  }
  return candidates;
}

/** Report counts per audience and language. Numbers only, never addresses. */
export function s6MailDistribution(candidates) {
  const counts = {};
  for (const audience of S6_AUDIENCES) {
    counts[audience] = {};
    for (const language of S6_MAIL_LANGUAGES) counts[audience][language] = 0;
  }
  for (const c of candidates) {
    const audience = S6_AUDIENCES.includes(c.audience) ? c.audience : "away";
    counts[audience][s6MailLanguage(c.language)] += 1;
  }
  return counts;
}

/** Every audience and language pair, in a fixed order (the test send). */
export function s6MailTestMatrix() {
  const pairs = [];
  for (const audience of S6_AUDIENCES) {
    for (const language of S6_MAIL_LANGUAGES) pairs.push({ audience, language });
  }
  return pairs;
}

/**
 * The whole run with every side effect injected.
 *   mode "dry_run": reads and returns counts; never sends, never reads the gate.
 *   mode "test":    sends one mail per audience and language to testTo via
 *                   sendTestEmail; reads no recipients and writes no email_log.
 *   mode "execute": refuses unless readSendEnabled() is exactly true, then
 *                   re-checks each recipient and sends via sendEmail.
 *
 * @param {object} deps
 * @param {"dry_run"|"test"|"execute"} deps.mode
 * @param {string} [deps.edition]
 * @param {() => Promise<object>} [deps.loadInputs]   resolves {teams, users, emailLogRows}
 * @param {string} [deps.testTo]
 * @param {(args: {to, audience, language, edition, subjectVariant}) => Promise<{status?: string}>} [deps.sendTestEmail]
 * @param {() => Promise<boolean>} [deps.readSendEnabled]
 * @param {(userId: string) => Promise<object|null>} [deps.readFreshUser] {id, last_seen, consent_preferences, email_prefs}
 * @param {(candidate: object, dedupeKey: string) => Promise<{status?: string, skipped?: string}>} [deps.sendEmail]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {number} [deps.rateLimitMs]
 * @param {Date} [deps.now]
 * @param {(line: string) => void} [deps.log]
 */
export async function runS6Mail({
  mode,
  edition = S6_MAIL_DEFAULT_EDITION,
  loadInputs,
  testTo,
  sendTestEmail,
  readSendEnabled,
  readFreshUser,
  sendEmail,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  rateLimitMs = 600,
  now = new Date(),
  log = () => {},
}) {
  assertEdition(edition);
  if (!["dry_run", "test", "execute"].includes(mode)) throw new Error(`runS6Mail: unknown mode ${mode}`);

  if (mode === "test") {
    if (!testTo || !String(testTo).includes("@")) throw new Error("runS6Mail: test mode needs one address");
    let sent = 0;
    let failed = 0;
    for (const { audience, language } of s6MailTestMatrix()) {
      try {
        const result = await sendTestEmail({ to: testTo, audience, language, edition, subjectVariant: S6_MAIL_SUBJECT_VARIANT });
        if (result?.status === "sent") sent += 1;
        else failed += 1;
      } catch (err) {
        // best-effort: one failed test mail must not hide the other five. It
        // is logged and counted in the report the operator reads.
        failed += 1;
        log(`  testmail fejlede (${audience}/${language}): ${err?.message || err}`);
      }
      await sleep(rateLimitMs);
    }
    return { mode, edition, sent, failed, total: s6MailTestMatrix().length };
  }

  const inputs = await loadInputs();
  const candidates = selectS6MailCandidates({ ...inputs, edition, now });
  const distribution = s6MailDistribution(candidates);

  if (mode === "dry_run") {
    return { mode, edition, total: candidates.length, distribution };
  }

  if ((await readSendEnabled()) !== true) {
    return { mode, edition, refused: true, total: candidates.length, distribution };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      // The candidate list is a snapshot from before this (rate-limited)
      // loop. Consent (the opt-in gate) and prefs (sendLoopEmail only knows
      // the "all" switch for this type) are re-read right before the send, so
      // a manager who opted out a minute ago gets nothing. A fresh last_seen
      // also re-picks the audience, so the opening matches today.
      const fresh = await readFreshUser(candidate.userId);
      if (!s6MailUserStillAllowed(fresh)) {
        skipped += 1;
        continue;
      }
      const current = { ...candidate, audience: s6MailAudience(fresh, now) };
      const result = await sendEmail(current, s6MailDedupeKey(edition, candidate.userId));
      if (result?.status === "sent") sent += 1;
      else if (result?.status === "failed") failed += 1;
      else skipped += 1;
    } catch (err) {
      // best-effort: one recipient's failure must not stop the rest of a
      // hand-run send. It is logged and counted as failed in the final report,
      // and sendLoopEmail already reports provider failures to Sentry.
      failed += 1;
      log(`  fejl for bruger ${candidate.userId}: ${err?.message || err}`);
    }
    await sleep(rateLimitMs);
  }
  return { mode, edition, refused: false, total: candidates.length, distribution, sent, skipped, failed };
}
