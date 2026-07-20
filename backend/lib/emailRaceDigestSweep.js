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
import { buildRaceDigestEmail } from "./emailTemplates.js";
import { signUnsubToken } from "./emailUnsubToken.js";
import { copenhagenHour, copenhagenDateString, copenhagenMidnightUTC } from "./copenhagenTime.js";
import { captureException } from "./sentry.js";

export const DIGEST_HOUR_COPENHAGEN = 19;

function unsubscribeUrlFor(userId, secret) {
  return `https://cyclingzone.org/api/email/unsubscribe?token=${signUnsubToken(userId, secret)}`;
}

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
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  if (copenhagenHour(now) !== DIGEST_HOUR_COPENHAGEN) {
    return { candidates: 0, sent: 0, skipped: 0, failed: 0, skippedReason: "outside_hour_window" };
  }
  if (!(await isActive(supabase))) return { candidates: 0, sent: 0, skipped: 0, failed: 0 };

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
    .from("users").select("id, email").in("id", userIds);
  if (usersErr) throw new Error(`race-digest users lookup: ${usersErr.message}`);
  const emailByUser = new Map((userRows || []).map((u) => [u.id, u.email]));

  const copenhagenDate = copenhagenDateString(now);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const [userId, perRace] of bestByUserRace) {
    try {
      const email = emailByUser.get(userId);
      if (!email) { skipped += 1; continue; }

      const results = [...perRace.values()];
      const unsubscribeUrl = unsubscribeUrlFor(userId, unsubSecret);
      const { subject, html, text } = buildRaceDigestEmail({ teamName: null, results, unsubscribeUrl });
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
