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
