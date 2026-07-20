// One-click unsubscribe token (#2725). HMAC-SHA256 over the userId, keyed by
// EMAIL_UNSUB_SECRET. No expiry — CAN-SPAM/CASL require unsubscribe links to
// keep working for 30-60 days after send, and a welcome/digest email can sit
// unread far longer than that, so a token that outlives the mailbox item is
// the safer default (worst case: a stale token still successfully mutes
// email for a user who no longer wants it — never a security issue, since
// the only thing it can do is flip email_prefs.all to false).
//
// verifyToken is constant-time (timingSafeEqual) to avoid a timing side
// channel on the HMAC comparison. Pure Node crypto — no Supabase import, so
// this unit-tests without env/websocket coupling (same separation as
// discordDmPrefs.js / emailPrefs.js).

import { createHmac, timingSafeEqual } from "node:crypto";

function hmacHex(userId, secret) {
  return createHmac("sha256", secret).update(String(userId)).digest("hex");
}

/**
 * @param {string} userId
 * @param {string} secret - EMAIL_UNSUB_SECRET, required.
 * @returns {string} token in "<userId>.<hmacHex>" form, URL-safe (hex has no
 *   reserved query-string characters).
 */
export function signUnsubToken(userId, secret) {
  if (!userId) throw new Error("signUnsubToken: userId required");
  if (!secret) throw new Error("signUnsubToken: secret required");
  return `${userId}.${hmacHex(userId, secret)}`;
}

/**
 * @param {string} token
 * @param {string} secret - EMAIL_UNSUB_SECRET, required.
 * @returns {string|null} the userId if the token is valid, else null.
 */
export function verifyUnsubToken(token, secret) {
  if (!token || !secret || typeof token !== "string") return null;
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === token.length - 1) return null;
  const userId = token.slice(0, dotIndex);
  const providedMac = token.slice(dotIndex + 1);

  const expectedMac = hmacHex(userId, secret);
  const expectedBuf = Buffer.from(expectedMac, "hex");
  const providedBuf = Buffer.from(providedMac, "hex");
  if (expectedBuf.length !== providedBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, providedBuf)) return null;

  return userId;
}
