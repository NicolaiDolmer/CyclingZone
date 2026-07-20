// Welcome-email sweep (#2725, D0). Targets teams created in the last 48h.
// "Without a welcome email logged for that user" is enforced by
// sendLoopEmail's own dedupe check (dedupe_key = `welcome:<userId>`) — no
// separate email_log query needed here, the deterministic key IS the guard.
//
// Human-team filter mirrors academyHealSweep.js / aiTeamGenerator.js
// (is_ai=false, is_bank=false, is_frozen=false, is_test_account=false) —
// AI/bank/frozen/test accounts never get retention email.

import { fetchAllRows } from "./supabasePagination.js";
import { isEmailLoopActive } from "./emailLoopFlag.js";
import { sendLoopEmail } from "./emailService.js";
import { buildWelcomeEmail } from "./emailTemplates.js";
import { signUnsubToken } from "./emailUnsubToken.js";
import { captureException } from "./sentry.js";

export const WELCOME_WINDOW_MS = 48 * 60 * 60 * 1000;

function unsubscribeUrlFor(userId, secret) {
  return `https://cyclingzone.org/api/email/unsubscribe?token=${signUnsubToken(userId, secret)}`;
}

export async function runEmailWelcomeSweep({
  supabase,
  now = new Date(),
  isActive = isEmailLoopActive,
  send = sendLoopEmail,
  unsubSecret = process.env.EMAIL_UNSUB_SECRET,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(await isActive(supabase))) return { candidates: 0, sent: 0, skipped: 0, failed: 0 };

  const cutoffIso = new Date(now.getTime() - WELCOME_WINDOW_MS).toISOString();

  const candidates = await fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, name, user_id, created_at")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false)
      .gte("created_at", cutoffIso)
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
      const { subject, html, text } = buildWelcomeEmail({ teamName: team.name, unsubscribeUrl });
      const result = await send({
        supabase,
        userId: team.user_id,
        teamId: team.id,
        type: "welcome",
        dedupeKey: `welcome:${team.user_id}`,
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
      console.error(`  ❌ welcome-email fejlede for hold ${team.id}:`, err?.message || err);
      captureExceptionFn(err, {
        tags: { cron: "email-welcome" },
        extra: { teamId: team.id, userId: team.user_id },
      });
    }
  }

  return { candidates: candidates.length, sent, skipped, failed };
}
