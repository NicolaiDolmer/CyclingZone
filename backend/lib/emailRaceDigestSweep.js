// Daily race-digest sweep (#2725). Cron ticks hourly but the sweep only does
// work during the 19:00-19:59 Copenhagen-time hour — computed via
// copenhagenHour (Intl-based, DST-correct, no hardcoded UTC offset), never a
// fixed UTC hour. dedupe_key includes the Copenhagen calendar date
// (`digest:<userId>:<YYYY-MM-DD>`) so the daily digest is idempotent even if
// the hourly cron ticks more than once inside the 19:00 hour, and so a
// digest can never accidentally span two different days.
//
// Source query mirrors notificationService.js's fetch-participating-managers
// join shape (race_results -> riders'/team via team_id -> teams), filtered to
// today's Copenhagen calendar day via race_results.imported_at, restricted to
// human teams (is_ai/is_bank/is_frozen/is_test_account), and reduced to each
// manager's single best (lowest rank) result per race — never invented data,
// every line comes straight from a race_results row.

import { fetchAllRows } from "./supabasePagination.js";
import { isEmailLoopActive } from "./emailLoopFlag.js";
import { sendLoopEmail } from "./emailService.js";
import { isEmailTypeEnabled } from "./emailPrefs.js";
import { buildRaceDigestEmail } from "./emailTemplates.js";
import { unsubscribeUrlFor } from "./emailUnsubUrl.js";
import { copenhagenHour, copenhagenDateString, copenhagenMidnightUTC } from "./copenhagenTime.js";
import { captureException } from "./sentry.js";
import { buildRaceResultNarrative } from "./raceNarrativeNotification.js";

export const DIGEST_HOUR_COPENHAGEN = 19;

// #2853: the digest previously emailed EVERY manager with a ranked result
// today, regardless of whether they had touched the game in months (verified
// against the pre-#2853 query below — it filtered AI/bank/frozen/test teams
// only, no activity check at all). A 14-day last_seen window matches the
// house "recently active" cutoff used elsewhere (see users.last_seen
// consumers) — a manager who raced today via idle riders/auto-lineups but
// hasn't opened the app in 2+ weeks is exactly the "unsubscribe as spam"
// risk this filter targets.
export const DIGEST_ACTIVITY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// #2725: a single race day can produce >1000 race_results rows once every
// division races the same day (stage races × many teams), so this MUST
// paginate via fetchAllRows rather than a single .select() — a naive load
// would silently drop rows past PostgREST's 1000-row default limit (jf.
// supabasePagination.js's header comment: PCM rider-matcher lost 88% of
// riders this exact way). Stable .order("id") required for correct paging.
async function defaultFetchDigestRows({ supabase, sinceIso }) {
  return fetchAllRows(() =>
    supabase
      .from("race_results")
      .select(
        "id, rank, rider_name, team_id, race:race_id!inner(id, name), team:team_id!inner(user_id, is_ai, is_bank, is_frozen, is_test_account)"
      )
      .gte("imported_at", sinceIso)
      .eq("team.is_ai", false)
      .eq("team.is_bank", false)
      .eq("team.is_frozen", false)
      .eq("team.is_test_account", false)
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
  fetchRows = defaultFetchDigestRows,
  captureExceptionFn = captureException,
  // #3399: narrativ rubrik ("Krogh takes the sprint") for dagens BEDSTE
  // (laveste rank) løb pr. manager — buildRaceDigestEmail leder med den i
  // stedet for en nøgen liste. Ærlig degradering: returnerer null for
  // gamle/PCM-løb eller når v3 var slukket, og digesten ser da ud som før
  // #3399 (kun listen, ingen rubrik-afsnit).
  fetchNarrative = buildRaceResultNarrative,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  // 2026-08-06 (#3475-klassen): præcis-time-gate + interval-nulstilling ved
  // deploy kan springe HELE dagen over. `<` + den persisterede dedupe
  // (email_log.dedupe_key med Copenhagen-dato, tjekket FØR send i
  // emailService.js) giver én-gang-pr.-dag uden afhængighed af tick-timing.
  if (copenhagenHour(now) < DIGEST_HOUR_COPENHAGEN) {
    return { candidates: 0, sent: 0, skipped: 0, failed: 0, skippedReason: "outside_hour_window" };
  }
  if (!(await isActive(supabase, "race_digest"))) return { candidates: 0, sent: 0, skipped: 0, failed: 0 };

  const sinceIso = copenhagenMidnightUTC(now).toISOString();
  const rows = await fetchRows({ supabase, sinceIso });

  // Best (lowest rank) row per (userId, raceId).
  const bestByUserRace = new Map(); // userId -> Map(raceId -> row)
  const teamIdByUser = new Map();
  for (const row of rows) {
    const userId = row.team?.user_id;
    const raceId = row.race?.id;
    if (!userId || !raceId || row.rank == null) continue;
    if (!teamIdByUser.has(userId)) teamIdByUser.set(userId, row.team_id ?? null);

    if (!bestByUserRace.has(userId)) bestByUserRace.set(userId, new Map());
    const perRace = bestByUserRace.get(userId);
    const existing = perRace.get(raceId);
    if (!existing || row.rank < existing.rank) {
      perRace.set(raceId, { rank: row.rank, riderName: row.rider_name, raceName: row.race?.name ?? "your race" });
    }
  }

  const userIds = [...bestByUserRace.keys()];
  if (!userIds.length) return { candidates: 0, sent: 0, skipped: 0, failed: 0 };

  const { data: userRows, error: usersErr } = await supabase
    .from("users").select("id, email, last_seen, email_prefs").in("id", userIds);
  if (usersErr) throw new Error(`race-digest users lookup: ${usersErr.message}`);

  // #2853: activity + consent filter. last_seen reuses the house "recently
  // active" cutoff (DIGEST_ACTIVITY_WINDOW_MS); the consent check reuses
  // email_prefs's existing isEmailTypeEnabled rule (same one sendLoopEmail
  // already enforces per-send) rather than inventing a second opt-out
  // mechanism — doing it here too means an inactive/opted-out manager never
  // even counts as a send attempt (and never triggers the narrative lookup
  // below), instead of silently landing in `skipped` after the work was
  // already done for them.
  const activityCutoffIso = new Date(now.getTime() - DIGEST_ACTIVITY_WINDOW_MS).toISOString();
  const emailByUser = new Map(
    (userRows || [])
      .filter((u) => u.last_seen && u.last_seen >= activityCutoffIso)
      .filter((u) => isEmailTypeEnabled(u.email_prefs, "race_digest"))
      .map((u) => [u.id, u.email])
  );

  const copenhagenDate = copenhagenDateString(now);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // #3399: memoized pr. raceId — flere managere kan dele den samme "bedste"
  // løbsdag (fx samme division-race), så vi vil ikke genberegne rubrikken pr.
  // manager. narrativeCache holder Promise<narrative|null> per raceId.
  const narrativeCache = new Map();
  const getNarrative = (raceId, raceName) => {
    if (!narrativeCache.has(raceId)) {
      narrativeCache.set(raceId, fetchNarrative({ supabase, race: { id: raceId, name: raceName } }).catch(() => null));
    }
    return narrativeCache.get(raceId);
  };

  for (const [userId, perRace] of bestByUserRace) {
    try {
      const email = emailByUser.get(userId);
      if (!email) { skipped += 1; continue; }

      const results = [...perRace.values()];
      // Dagens rubrik = managerens BEDSTE (laveste rank) løb i dag — samme
      // "bedste-resultat"-diskriminator digesten allerede bruger pr. løb.
      const [topRaceId] = [...perRace.entries()].sort((a, b) => (a[1].rank ?? Infinity) - (b[1].rank ?? Infinity))[0] ?? [];
      const narrative = topRaceId ? await getNarrative(topRaceId, perRace.get(topRaceId)?.raceName) : null;

      const unsubscribeUrl = unsubscribeUrlFor(userId, unsubSecret);
      const { subject, html, text } = buildRaceDigestEmail({
        teamName: null,
        results,
        headline: narrative?.headlineText ?? null,
        unsubscribeUrl,
      });
      const result = await send({
        supabase,
        userId,
        teamId: teamIdByUser.get(userId) ?? null,
        type: "race_digest",
        dedupeKey: `digest:${userId}:${copenhagenDate}`,
        to: email,
        subject,
        html,
        text,
        unsubscribeUrl,
      });
      if (result?.status === "sent" || result?.status === "dry_run") sent += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.error(`  ❌ race-digest fejlede for bruger ${userId}:`, err?.message || err);
      captureExceptionFn(err, { tags: { cron: "email-race-digest" }, extra: { userId } });
    }
  }

  return { candidates: bestByUserRace.size, sent, skipped, failed };
}
