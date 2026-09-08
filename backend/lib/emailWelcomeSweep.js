// Welcome-email sweep (#2725, D0). Targets teams created in the last 48h.
// "Without a welcome email logged for that user" is enforced by
// sendLoopEmail's own dedupe check (dedupe_key = `welcome:<userId>`) — no
// separate email_log query needed here, the deterministic key IS the guard.
//
// Human-team filter mirrors academyHealSweep.js / aiTeamGenerator.js
// (is_ai=false, is_bank=false, is_frozen=false, is_test_account=false) —
// AI/bank/frozen/test accounts never get retention email.
//
// #2853 DA follow-up (2026-09-03): users.language ('da' -> Danish copy,
// anything else -> English) is read alongside email and passed straight
// through to buildWelcomeEmail; emailTemplates.js owns the actual copy
// selection.

import { fetchAllRows } from "./supabasePagination.js";
import { readEmailLoopStage } from "./emailLoopFlag.js";
import { sendLoopEmail } from "./emailService.js";
import { buildWelcomeEmail } from "./emailTemplates.js";
import { unsubscribeUrlForStage, assertUnsubSecretForStage } from "./emailUnsubUrl.js";
import { createEmailFailureCollector, postPermanentFailureAlert } from "./emailOpsAlert.js";
import { recordEmailSweepRun } from "./emailHealthReport.js";
import { captureException } from "./sentry.js";

export const WELCOME_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function runEmailWelcomeSweep({
  supabase,
  now = new Date(),
  // #2853 (fund 8/9): sweepen skal kende STAGE, ikke bare "aktiv ja/nej" —
  // unsub-URL'en bygges her, og dry_run maa ikke kraeve hemmeligheden.
  readStage = readEmailLoopStage,
  send = sendLoopEmail,
  unsubSecret = process.env.EMAIL_UNSUB_SECRET,
  sendWebhookFn = null,
  getOpsWebhookFn = null,
  recordRun = recordEmailSweepRun,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const stage = await readStage(supabase, "welcome");
  if (stage === "off") return { candidates: 0, sent: 0, skipped: 0, failed: 0 };

  // ÉN fejl pr. koersel, ikke én pr. hold pr. tick (#2853, fund 8/9: 3 Sentry-
  // alarmer paa 15 min for den samme manglende noegle).
  assertUnsubSecretForStage(stage, unsubSecret);

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
  const failureCollector = createEmailFailureCollector();

  for (const team of candidates) {
    try {
      const { data: userRow, error } = await supabase
        .from("users").select("email, language").eq("id", team.user_id).maybeSingle();
      if (error) throw new Error(`users lookup: ${error.message}`);
      if (!userRow?.email) { skipped += 1; continue; }

      const unsubscribeUrl = unsubscribeUrlForStage({ userId: team.user_id, secret: unsubSecret, stage });
      const { subject, html, text } = buildWelcomeEmail({ teamName: team.name, unsubscribeUrl, language: userRow.language });
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
        stage,
        failureCollector,
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

  // ÉN samlet ops-alarm for koerslen (#2853) + koerselens tal til den daglige
  // sundhedsrapport. Begge er best-effort og maa aldrig vaelte sweepen.
  // Fund 8/9 (review-runde 2): alarmen SKAL ligge i try/catch (samme
  // moenster som emailRetrySweep.js's dead-alarm) -- ellers vaelter en
  // kastende ops-webhook sweepen FOER recordRun naar at logge koerslen.
  try {
    await postPermanentFailureAlert({ collector: failureCollector, sweep: "email-welcome", now, sendWebhookFn, getOpsWebhookFn });
  } catch (err) {
    // best-effort: de permanente fejl staar ALLEREDE i Sentry og i
    // email_log.error. En Discord-kanal der er nede maa ikke koste os
    // koerslens tal i sundhedsrapporten.
    console.error("[email:welcome] ops-alarm fejlede:", err?.message || err);
  }
  await recordRun({ supabase, emailType: "welcome", stage, candidates: candidates.length, sent, skipped, failed });

  return { candidates: candidates.length, sent, skipped, failed };
}
