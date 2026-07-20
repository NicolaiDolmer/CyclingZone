// Day-1 nudge sweep (#2725, D1). Targets teams created 20-30h ago — a single
// hourly tick window wide enough that an hourly cron cadence never skips a
// team between ticks, narrow enough that it only fires once per team
// (dedupe_key = `day1:<userId>` is the hard guard against a repeat if the
// window is ever widened later).
//
// Same human-team filter as emailWelcomeSweep.js.

import { fetchAllRows } from "./supabasePagination.js";
import { isEmailLoopActive } from "./emailLoopFlag.js";
import { sendLoopEmail } from "./emailService.js";
import { buildDay1Email } from "./emailTemplates.js";
import { signUnsubToken } from "./emailUnsubToken.js";
import { captureException } from "./sentry.js";

export const DAY1_WINDOW_MIN_MS = 20 * 60 * 60 * 1000;
export const DAY1_WINDOW_MAX_MS = 30 * 60 * 60 * 1000;

function unsubscribeUrlFor(userId, secret) {
  return `https://cyclingzone.org/api/email/unsubscribe?token=${signUnsubToken(userId, secret)}`;
}

export async function runEmailDay1Sweep({
  supabase,
  now = new Date(),
  isActive = isEmailLoopActive,
  send = sendLoopEmail,
  unsubSecret = process.env.EMAIL_UNSUB_SECRET,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(await isActive(supabase))) return { candidates: 0, sent: 0, skipped: 0, failed: 0 };

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

      const unsubscribeUrl = unsubscribeUrlFor(team.user_id, unsubSecret);
      const { subject, html, text } = buildDay1Email({ teamName: team.name, unsubscribeUrl });
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
