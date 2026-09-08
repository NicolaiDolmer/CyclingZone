// Shared unsubscribe-URL builder (#2725 review fix, PR #2728). Was
// previously duplicated verbatim (unsubscribeUrlFor) in emailWelcomeSweep.js,
// emailDay1Sweep.js and emailRaceDigestSweep.js — three copies of the same
// hardcoded host is how the base URL drifts if the frontend/backend split
// ever moves. EMAIL_UNSUB_BASE_URL lets ops repoint the base without editing
// three files; default stays the production cyclingzone.org path (NOT the
// Railway backend host) so the email-footer domain matches the From-domain,
// which matters for deliverability. See frontend/vercel.json for the rewrite
// that makes that path actually reach the backend.

import { signUnsubToken } from "./emailUnsubToken.js";

export const EMAIL_UNSUB_BASE_DEFAULT = "https://cyclingzone.org/api/email/unsubscribe";

/**
 * @param {string} userId
 * @param {string} secret - EMAIL_UNSUB_SECRET, required (forwarded to signUnsubToken).
 * @param {string} [base] - defaults to EMAIL_UNSUB_BASE_URL env var, else EMAIL_UNSUB_BASE_DEFAULT.
 *   Read at call time (not module load) so tests can override the env var per-test.
 */
export function unsubscribeUrlFor(userId, secret, base = process.env.EMAIL_UNSUB_BASE_URL || EMAIL_UNSUB_BASE_DEFAULT) {
  return `${base}?token=${signUnsubToken(userId, secret)}`;
}

// #2853 (fund 8/9 under dry_run): dry_run maa ALDRIG kraeve unsub-
// hemmeligheden. Sweepsene byggede URL'en FOER sendLoopEmail naaede at laese
// stage, saa en manglende EMAIL_UNSUB_SECRET fik hver eneste kandidat til at
// kaste `signUnsubToken: secret required` — ingen dry_run-raekke blev skrevet,
// og alarmen kom én gang pr. hold pr. tick i stedet for én gang i alt.
// dry_run kalder aldrig Resend, saa der findes ingen mail hvis footer-link kan
// klikkes: en dummy-token er tilstraekkelig, og den kan pr. konstruktion ikke
// verificeres (verifyUnsubToken kraever et "." og afviser denne).
export const DRY_RUN_UNSUB_TOKEN = "dry-run";

/**
 * Stage-bevidst unsub-URL.
 * @param {object} args
 * @param {string} args.userId
 * @param {string|undefined} args.secret - EMAIL_UNSUB_SECRET.
 * @param {"off"|"dry_run"|"on"} args.stage
 * @param {string} [args.base]
 */
export function unsubscribeUrlForStage({
  userId,
  secret,
  stage,
  base = process.env.EMAIL_UNSUB_BASE_URL || EMAIL_UNSUB_BASE_DEFAULT,
}) {
  if (stage !== "on" && !secret) return `${base}?token=${DRY_RUN_UNSUB_TOKEN}`;
  return unsubscribeUrlFor(userId, secret, base);
}

/**
 * Kastes ÉN gang pr. sweep-koersel (foer loopet over kandidater), ikke én gang
 * pr. hold — se kommentaren over DRY_RUN_UNSUB_TOKEN for hvorfor netop det
 * skel er hele pointen.
 * @param {"off"|"dry_run"|"on"} stage
 * @param {string|undefined} secret
 */
export function assertUnsubSecretForStage(stage, secret) {
  if (stage === "on" && !secret) {
    throw new Error("email-sweep: EMAIL_UNSUB_SECRET not set (stage=on) - ingen mails kan sendes");
  }
}
