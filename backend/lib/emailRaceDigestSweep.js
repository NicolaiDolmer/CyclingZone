// Race-digest "you were away" sweep (#2853 v2 / #4650). Cron ticks hourly but
// the sweep only does work during the 19:00-19:59 Copenhagen-time hour --
// unchanged from before #4650 (copenhagenHour, DST-correct, never a
// hardcoded UTC hour).
//
// #4650 (owner, tone session 2026-09-02, "ingen spam"): this used to be a
// DAILY digest to every RECENTLY active manager who raced today -- up to
// ~30 emails a season to an engaged player. The owner rejected that cadence.
// The digest is now a come-back mail, not a report:
//
//   - Only to managers with users.last_seen OLDER than
//     DIGEST_ABSENCE_WINDOW_MS (3 days) -- the OPPOSITE direction from the
//     pre-#4650 "recently active" filter this file used to have.
//   - At most one per ISO-calendar-week per manager: dedupeKey now embeds
//     copenhagenIsoWeekString(now) instead of a calendar date, so
//     sendLoopEmail's existing dedupe_key uniqueness check IS the weekly
//     cap -- no separate counting needed for this rule.
//   - At most DIGEST_MAX_PER_ABSENCE (2) per absence period: counted as
//     email_log race_digest rows for that user with created_at >= their
//     CURRENT last_seen. last_seen only advances when the player actually
//     opens the app again, so this count naturally resets the moment they
//     come back -- a fresh absence period starts at 0.
//   - Only results since the player's LAST VISIT (race_results.imported_at
//     >= last_seen), not "today". An absent player may not have raced
//     specifically today, so the pre-#4650 query -- which started from
//     TODAY's race_results and derived candidate users from that -- no
//     longer fits. This sweep now starts from the candidate USER (human
//     teams, filtered to absentees first) and fetches each survivor's own
//     results window individually -- the same one-query-per-team shape
//     emailDay1Sweep.js already uses for its race_results lookup. The
//     candidate set reaching that per-user query is small BY CONSTRUCTION:
//     only absentees that passed the weekly dedupe (checked by sendLoopEmail
//     itself downstream) and the 2-per-absence cap (checked here) get this
//     far.
//   - No results since last visit -> no email at all (never an empty/
//     "nothing happened" digest).
//
// Unchanged: human-team filter (is_ai/is_bank/is_frozen/is_test_account),
// email_prefs opt-out (isEmailTypeEnabled, same rule sendLoopEmail enforces
// per-send), the 19:00 hour gate.
//
// #4654 (consent-audit follow-up, see the users-select filter below for the
// full rationale): candidates now also require an EXPLICIT
// consent_preferences.email_marketing === true opt-in, not just the
// email_prefs opt-out above. welcome.js/day1.js are unchanged.
//
// #3399's narrative-headline lead-in ("Krogh takes the sprint") is dropped
// along with the daily cadence -- the locked v2 copy in
// docs/drafts/mailtekster-2853-v2-dolmer-2026-09-02.md goes straight from
// the greeting to the result lines (see emailTemplates.js's
// buildRaceDigestEmail for the same removal on the template side).
//
// #2853 DA follow-up (2026-09-03): users.language is read alongside the
// other per-user columns above and passed straight through to
// buildRaceDigestEmail; emailTemplates.js owns the actual copy selection
// ('da' -> Danish, anything else -> English).

import { fetchAllRows } from "./supabasePagination.js";
import { isEmailLoopActive } from "./emailLoopFlag.js";
import { sendLoopEmail } from "./emailService.js";
import { isEmailTypeEnabled } from "./emailPrefs.js";
import { buildRaceDigestEmail } from "./emailTemplates.js";
import { unsubscribeUrlFor } from "./emailUnsubUrl.js";
import { copenhagenHour, copenhagenIsoWeekString } from "./copenhagenTime.js";
import { captureException } from "./sentry.js";

export const DIGEST_HOUR_COPENHAGEN = 19;
export const DIGEST_ABSENCE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export const DIGEST_MAX_PER_ABSENCE = 2;

// Human teams only (mirrors emailWelcomeSweep.js / emailDay1Sweep.js's
// filter 1:1) -- the last_seen absence check happens afterwards, in JS,
// once we have each candidate's user row.
async function defaultFetchCandidateTeams({ supabase }) {
  return fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, name, user_id")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false)
      .not("user_id", "is", null)
      .order("id")
  );
}

// email_log rows for the 2-per-absence-period cap. Only user_id + created_at
// are needed -- the per-user filter (created_at >= that user's last_seen)
// happens in JS below, once per candidate.
async function defaultFetchDigestLogRows({ supabase, userIds }) {
  if (!userIds.length) return [];
  return fetchAllRows(() =>
    supabase
      .from("email_log")
      .select("user_id, created_at")
      .eq("email_type", "race_digest")
      .in("user_id", userIds)
      .order("id")
  );
}

// One query per surviving candidate (small set -- see header comment), same
// shape as emailDay1Sweep.js's per-team race_results lookup.
async function defaultFetchResultsSince({ supabase, teamId, sinceIso }) {
  return fetchAllRows(() =>
    supabase
      .from("race_results")
      .select("id, rank, rider_name, race_id, race:race_id!inner(id, name)")
      .eq("team_id", teamId)
      .gte("imported_at", sinceIso)
      .not("rank", "is", null)
      .order("id")
  );
}

export async function runEmailRaceDigestSweep({
  supabase,
  now = new Date(),
  isActive = isEmailLoopActive,
  send = sendLoopEmail,
  unsubSecret = process.env.EMAIL_UNSUB_SECRET,
  fetchCandidateTeams = defaultFetchCandidateTeams,
  fetchDigestLogRows = defaultFetchDigestLogRows,
  fetchResultsSince = defaultFetchResultsSince,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  // 2026-08-06 (#3475-klassen): precise-hour-gate + interval-reset ved deploy
  // kan springe hele dagen over. `<` + den persisterede dedupe (email_log.
  // dedupe_key, tjekket FØR send i emailService.js) giver stadig korrekt
  // en-gang-pr.-uge selvom en catch-up-tick rammer efter kl. 19.
  if (copenhagenHour(now) < DIGEST_HOUR_COPENHAGEN) {
    return { candidates: 0, sent: 0, skipped: 0, failed: 0, skippedReason: "outside_hour_window" };
  }
  if (!(await isActive(supabase, "race_digest"))) return { candidates: 0, sent: 0, skipped: 0, failed: 0 };

  const teams = await fetchCandidateTeams({ supabase });
  if (!teams.length) return { candidates: 0, sent: 0, skipped: 0, failed: 0 };

  const teamByUser = new Map(teams.map((t) => [t.user_id, t]));
  const userIds = [...teamByUser.keys()];

  const { data: userRows, error: usersErr } = await supabase
    .from("users").select("id, email, last_seen, email_prefs, consent_preferences, language").in("id", userIds);
  if (usersErr) throw new Error(`race-digest users lookup: ${usersErr.message}`);

  // #4650: absence + opt-out filter, reusing the existing isEmailTypeEnabled
  // rule (same one sendLoopEmail already enforces per-send) instead of
  // inventing a second opt-out mechanism. A user with no last_seen at all
  // (never returned since account creation) is treated as NOT yet absent in
  // the digest's sense -- they have nothing to "come back" from -- so they
  // are excluded rather than default-included.
  //
  // Consent gate (#4654, owner 2026-09-02: "we do this properly, no spam").
  // The audit at docs/audits/winback-consent-audit-2026-09-02.md (PR #4652)
  // found this sweep checked email_prefs (opt-OUT) but never
  // consent_preferences.email_marketing (opt-IN). Since #4650 this digest
  // only reaches managers already absent 3+ days, about a season update --
  // not a message tied to an in-progress transaction -- which the audit
  // classifies as marketing under GDPR art. 6(1)(a) (consent), not the
  // account-service basis of art. 6(1)(b). consent_preferences is a
  // SEPARATE mechanism from email_prefs above (see database/2026-05-11-
  // consent-preferences.sql): it is the cookie banner's per-category
  // opt-IN, JSONB with an `email_marketing` boolean, and NULL whenever the
  // player has never answered the banner post-login. NULL must never read
  // as silent consent (GDPR art. 4(11): consent must be an unambiguous,
  // active choice) -- so only an EXPLICIT `email_marketing === true` passes;
  // both NULL and false are excluded, same as anyone who said no.
  //
  // welcome.js / day1.js are deliberately NOT gated the same way: both fire
  // once, right after a manager creates the very account the mail is about
  // (onboarding to their own just-taken action), and the banner's own
  // "Email" category copy (frontend/public/locales/*/banners.json) says
  // transactional email does not depend on this choice -- there is no
  // separate marketing-classification question to resolve for them here.
  const absenceCutoffIso = new Date(now.getTime() - DIGEST_ABSENCE_WINDOW_MS).toISOString();
  const absentees = (userRows || []).filter(
    (u) =>
      u.email &&
      u.last_seen &&
      u.last_seen < absenceCutoffIso &&
      isEmailTypeEnabled(u.email_prefs, "race_digest") &&
      u.consent_preferences?.email_marketing === true
  );
  if (!absentees.length) return { candidates: 0, sent: 0, skipped: 0, failed: 0 };

  const digestLogRows = await fetchDigestLogRows({ supabase, userIds: absentees.map((u) => u.id) });
  const digestLogsByUser = new Map();
  for (const row of digestLogRows) {
    if (!digestLogsByUser.has(row.user_id)) digestLogsByUser.set(row.user_id, []);
    digestLogsByUser.get(row.user_id).push(row);
  }

  const isoWeek = copenhagenIsoWeekString(now);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of absentees) {
    try {
      // Højst 2 pr. fraværsperiode: digests logget SIDEN spillerens nuværende
      // last_seen. Kommer spilleren tilbage, rykker last_seen frem og tælleren
      // starter forfra af sig selv -- ingen separat "nulstil"-handling nødvendig.
      const sentSinceLastSeen = (digestLogsByUser.get(user.id) || []).filter((r) => r.created_at >= user.last_seen).length;
      if (sentSinceLastSeen >= DIGEST_MAX_PER_ABSENCE) { skipped += 1; continue; }

      const team = teamByUser.get(user.id);
      const resultRows = await fetchResultsSince({ supabase, teamId: team.id, sinceIso: user.last_seen });

      // Bedste (laveste rank) placering pr. løb siden sidste besøg -- aldrig
      // opfundet data, hver linje kommer direkte fra en race_results-række.
      const bestByRace = new Map();
      for (const row of resultRows) {
        if (row.rank == null) continue;
        const raceId = row.race?.id ?? row.race_id;
        if (!raceId) continue;
        const existing = bestByRace.get(raceId);
        if (!existing || row.rank < existing.rank) {
          bestByRace.set(raceId, { rank: row.rank, riderName: row.rider_name, raceName: row.race?.name ?? "your race" });
        }
      }
      if (!bestByRace.size) { skipped += 1; continue; } // ingen resultater siden sidste besøg -> ingen mail

      const unsubscribeUrl = unsubscribeUrlFor(user.id, unsubSecret);
      const { subject, html, text } = buildRaceDigestEmail({
        teamName: team.name,
        results: [...bestByRace.values()],
        unsubscribeUrl,
        language: user.language,
      });
      const result = await send({
        supabase,
        userId: user.id,
        teamId: team.id,
        type: "race_digest",
        dedupeKey: `digest:${user.id}:${isoWeek}`,
        to: user.email,
        subject,
        html,
        text,
        unsubscribeUrl,
      });
      if (result?.status === "sent" || result?.status === "dry_run") sent += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.error(`  ❌ race-digest fejlede for bruger ${user.id}:`, err?.message || err);
      captureExceptionFn(err, { tags: { cron: "email-race-digest" }, extra: { userId: user.id } });
    }
  }

  return { candidates: absentees.length, sent, skipped, failed };
}
