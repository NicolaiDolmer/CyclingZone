// Day-1 nudge sweep (#2725, D1). Targets teams created 20-30h ago — a single
// hourly tick window wide enough that an hourly cron cadence never skips a
// team between ticks, narrow enough that it only fires once per team
// (dedupe_key = `day1:<userId>` is the hard guard against a repeat if the
// window is ever widened later).
//
// Same human-team filter as emailWelcomeSweep.js.
//
// Review fix (PR #2728): production data shows only ~1/3 of new teams have
// any race_results within 24h, so the D1 copy cannot unconditionally claim
// "your results are already on the board" — that would be an invented claim
// for up to 2/3 of recipients (house hard rule: no invented content in
// player-facing copy). Per team we check race_results existence (an
// exists-style lookup on race_results.team_id, which points directly at
// teams, no riders-join needed) and pass hasResults into buildDay1Email so
// it renders one of two truthful variants. The check sits inside the
// existing per-team try/catch, so a failed results lookup for one team is
// isolated exactly like any other per-team failure (counts as `failed`,
// does not block the rest of the sweep).
//
// #3310 (dormant, flag stays off / #2853 unchanged): the same lookup also
// orders by imported_at desc and selects race_id, so the hasResults=true
// branch can deep-link the CTA straight to the manager's latest race
// (buildDay1Email's latestRaceId) instead of the generic dashboard.
//
// #3912: the lookup also selects stage_number from that same latest row and
// passes it through as latestStageNumber, so the CTA deep-links to the
// specific stage (?stage=N) instead of just the race as a whole. No extra
// query — stage_number lives on the same race_results row already fetched
// for latestRaceId. buildDay1Email falls back to the plain race link when
// stage_number is null (verified against database/schema-snapshot.json;
// the race-results engine always writes stage_number || 1, but legacy/PCM
// rows can still lack it).
//
// #3585: race_results has no created_at column (it has imported_at — the
// timestamp the import job wrote the row, verified against
// database/schema-snapshot.json). The lookup below used to select/order on
// created_at, which PostgREST rejects for every team the instant the email
// loop is switched on. Latent until then because isEmailLoopActive() short-
// circuits the whole sweep while the flag is off (see #3572 for the same
// shape of bug).

import { fetchAllRows } from "./supabasePagination.js";
import { isEmailLoopActive } from "./emailLoopFlag.js";
import { sendLoopEmail } from "./emailService.js";
import { buildDay1Email } from "./emailTemplates.js";
import { unsubscribeUrlFor } from "./emailUnsubUrl.js";
import { captureException } from "./sentry.js";

export const DAY1_WINDOW_MIN_MS = 20 * 60 * 60 * 1000;
export const DAY1_WINDOW_MAX_MS = 30 * 60 * 60 * 1000;

export async function runEmailDay1Sweep({
  supabase,
  now = new Date(),
  isActive = isEmailLoopActive,
  send = sendLoopEmail,
  unsubSecret = process.env.EMAIL_UNSUB_SECRET,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(await isActive(supabase, "day1"))) return { candidates: 0, sent: 0, skipped: 0, failed: 0 };

  const minCreatedIso = new Date(now.getTime() - DAY1_WINDOW_MAX_MS).toISOString();
  const maxCreatedIso = new Date(now.getTime() - DAY1_WINDOW_MIN_MS).toISOString();

  const candidates = await fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, name, user_id, created_at")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false)
      .gte("created_at", minCreatedIso)
      .lte("created_at", maxCreatedIso)
      .not("user_id", "is", null)
      .order("created_at")
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const team of candidates) {
    try {
      const { data: userRow, error } = await supabase
        .from("users").select("email").eq("id", team.user_id).maybeSingle();
      if (error) throw new Error(`users lookup: ${error.message}`);
      if (!userRow?.email) { skipped += 1; continue; }

      const { data: resultRows, error: resultsError } = await supabase
        .from("race_results")
        .select("id, race_id, stage_number, imported_at")
        .eq("team_id", team.id)
        .order("imported_at", { ascending: false })
        .limit(1);
      if (resultsError) throw new Error(`race_results lookup: ${resultsError.message}`);
      const hasResults = (resultRows || []).length > 0;
      const latestRaceId = resultRows?.[0]?.race_id ?? null;
      const latestStageNumber = resultRows?.[0]?.stage_number ?? null;

      const unsubscribeUrl = unsubscribeUrlFor(team.user_id, unsubSecret);
      const { subject, html, text } = buildDay1Email({ teamName: team.name, hasResults, latestRaceId, latestStageNumber, unsubscribeUrl });
      const result = await send({
        supabase,
        userId: team.user_id,
        teamId: team.id,
        type: "day1",
        dedupeKey: `day1:${team.user_id}`,
        to: userRow.email,
        subject,
        html,
        text,
        unsubscribeUrl,
      });
      if (result?.status === "sent" || result?.status === "dry_run") sent += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.error(`  ❌ day1-email fejlede for hold ${team.id}:`, err?.message || err);
      captureExceptionFn(err, {
        tags: { cron: "email-day1" },
        extra: { teamId: team.id, userId: team.user_id },
      });
    }
  }

  return { candidates: candidates.length, sent, skipped, failed };
}
