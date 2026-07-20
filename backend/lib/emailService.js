// Single choke-point for sending a retention-loop email (#2725). Every cron
// sweep (welcome/day1/race_digest) calls sendLoopEmail instead of touching
// Resend directly, so flag/dedupe/prefs gating and email_log bookkeeping
// live in exactly one place.
//
// Gate order (each one short-circuits the rest):
//   1. flag off             -> {skipped:"flag_off"}, no email_log row at all.
//   2. dedupe_key already logged -> {skipped:"dedupe"} (idempotent retries).
//   3. email_prefs opt-out (type or master "all") -> {skipped:"prefs"}.
//   4. flag dry_run         -> logs status "dry_run", never calls Resend.
//   5. flag on              -> sends via Resend, idempotencyKey = dedupe_key.
//
// Resend send failures are handled INSIDE this function (log "failed" +
// Sentry) and never thrown — a bad send for one user must never abort the
// rest of a sweep. Precondition errors (missing params, DB read failures,
// missing secrets while stage=on) DO throw; callers isolate those per-user
// with their own try/catch, matching the house sweep pattern (see
// academyHealSweep.js / checkDebtWarnings in cron.js).

import { Resend } from "resend";
import { readEmailLoopStage } from "./emailLoopFlag.js";
import { isEmailTypeEnabled } from "./emailPrefs.js";
import { captureException } from "./sentry.js";

export const FROM_ADDRESS = "Cycling Zone <updates@cyclingzone.org>";

let resendSingleton = null;

// Lazy + memoized so importing this module never requires RESEND_API_KEY to
// be set (tests, dry_run/off-only environments). Constructed fresh only once
// per process; tests inject their own fake client via `resendFactory` instead
// of touching this singleton.
function getResendClient() {
  if (resendSingleton) return resendSingleton;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("sendLoopEmail: RESEND_API_KEY not set");
  resendSingleton = new Resend(apiKey);
  return resendSingleton;
}

export async function sendLoopEmail({
  supabase,
  userId,
  teamId = null,
  type,
  dedupeKey,
  to,
  subject,
  html,
  text,
  unsubscribeUrl,
  readStage = readEmailLoopStage,
  resendFactory = getResendClient,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("sendLoopEmail: supabase required");
  if (!userId || !type || !dedupeKey || !to) {
    throw new Error("sendLoopEmail: userId, type, dedupeKey and to are required");
  }

  const stage = await readStage(supabase);
  if (stage === "off") return { skipped: "flag_off" };

  const { data: existing, error: dedupeErr } = await supabase
    .from("email_log").select("id").eq("dedupe_key", dedupeKey).maybeSingle();
  if (dedupeErr) throw new Error(`sendLoopEmail dedupe-check: ${dedupeErr.message}`);
  if (existing) return { skipped: "dedupe" };

  const { data: userRow, error: userErr } = await supabase
    .from("users").select("email_prefs").eq("id", userId).maybeSingle();
  if (userErr) throw new Error(`sendLoopEmail prefs-lookup: ${userErr.message}`);
  if (!isEmailTypeEnabled(userRow?.email_prefs, type)) return { skipped: "prefs" };

  if (stage === "dry_run") {
    const { error: insertErr } = await supabase.from("email_log").insert({
      user_id: userId, team_id: teamId, email_type: type, dedupe_key: dedupeKey, status: "dry_run",
    });
    if (insertErr) throw new Error(`sendLoopEmail dry_run log: ${insertErr.message}`);
    return { status: "dry_run" };
  }

  // stage === "on" from here.
  if (!process.env.RESEND_API_KEY) throw new Error("sendLoopEmail: RESEND_API_KEY not set");
  if (!process.env.EMAIL_UNSUB_SECRET) throw new Error("sendLoopEmail: EMAIL_UNSUB_SECRET not set");

  const resend = resendFactory();
  const { data, error } = await resend.emails.send(
    {
      from: FROM_ADDRESS,
      to: [to],
      subject,
      html,
      text,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    },
    { idempotencyKey: dedupeKey }
  );

  if (error) {
    const message = error.message ?? String(error);
    const { error: logErr } = await supabase.from("email_log").insert({
      user_id: userId, team_id: teamId, email_type: type, dedupe_key: dedupeKey,
      status: "failed", error: message,
    });
    if (logErr) console.error(`[emailService] failed-log insert error for ${dedupeKey}:`, logErr.message);
    captureExceptionFn(new Error(`email send failed (${type}): ${message}`), {
      tags: { flow: "email-loop", emailType: type },
      extra: { userId, dedupeKey },
    });
    return { status: "failed", error: message };
  }

  const { error: logErr } = await supabase.from("email_log").insert({
    user_id: userId, team_id: teamId, email_type: type, dedupe_key: dedupeKey,
    status: "sent", provider_id: data?.id ?? null,
  });
  if (logErr) {
    // Send already succeeded — a logging failure here must never look like a
    // send failure. Best-effort visibility only; the dedupe gap this could
    // theoretically open is bounded by Resend's own 24h idempotency window.
    console.error(`[emailService] sent-log insert error for ${dedupeKey}:`, logErr.message);
    captureExceptionFn(new Error(`email_log insert failed after send (${type}): ${logErr.message}`), {
      tags: { flow: "email-loop", emailType: type },
      extra: { userId, dedupeKey },
    });
  }

  return { status: "sent", providerId: data?.id ?? null };
}
