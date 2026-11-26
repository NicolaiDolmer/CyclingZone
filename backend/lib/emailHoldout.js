// #8807 -- control group (holdout) for hand-run mail campaigns.
//
// A held-out manager passes every recipient rule but does NOT get the mail, so
// the campaign report can compare activity with the mail against activity
// without it (the real effect, not just "who clicked").
//
// Deterministic on the user id: the bucket is a hash of the campaign salt and
// the user id, so a rerun, a later edition of the same campaign and the report
// all agree on who is in the control group without storing anything. A
// fraction only ever grows the group (a higher fraction contains every user a
// lower one held out), so mail 2 with a larger share keeps mail 1's control
// group intact.
//
// The share per audience is the same fraction applied to each user's own
// bucket, so it holds per group on average; it is not forced to an exact
// count per group, because an exact count would depend on who else is in the
// list on the day and a rerun could then mail someone held out the first time.
//
// Default is 0 (owner 26/11: build it, do not use it until the list is much
// bigger). At 0 the candidate list is returned untouched.

import { createHash } from "node:crypto";

/** Upper limit for the share. A typo like 10 (meant 10 %) must fail, not hold out everyone. */
export const MAX_HOLDOUT_FRACTION = 0.5;

/**
 * Parse and validate a holdout share. Accepts a number or a numeric string in
 * [0, MAX_HOLDOUT_FRACTION]; undefined, null and "" mean 0.
 */
export function normalizeHoldoutFraction(value) {
  if (value === undefined || value === null || value === "") return 0;
  const fraction = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > MAX_HOLDOUT_FRACTION) {
    throw new RangeError(`holdout share must be a number from 0 to ${MAX_HOLDOUT_FRACTION}`);
  }
  return fraction;
}

/** A stable number in [0, 1) for this salt and user. */
export function holdoutBucket(salt, userId) {
  if (!salt || !userId) throw new Error("holdoutBucket needs a salt and a user id");
  const digest = createHash("sha256").update(`${salt}:${userId}`).digest();
  return digest.readUInt32BE(0) / 2 ** 32;
}

/** True when this user is in the control group for the given share. */
export function isHeldOut({ salt, userId, fraction }) {
  const share = normalizeHoldoutFraction(fraction);
  if (share === 0) return false;
  return holdoutBucket(salt, userId) < share;
}

/**
 * Split candidates into the ones to mail and the control group, keeping the
 * original order in both. At share 0 `send` is the same array, untouched.
 *
 * @template T
 * @param {T[]} candidates
 * @param {object} args
 * @param {string} args.salt
 * @param {number} [args.fraction]
 * @param {(candidate: T) => string} [args.idOf]
 * @returns {{send: T[], holdout: T[]}}
 */
export function splitHoldout(candidates, { salt, fraction = 0, idOf = (c) => c.userId } = {}) {
  const share = normalizeHoldoutFraction(fraction);
  if (share === 0) return { send: candidates, holdout: [] };
  const send = [];
  const holdout = [];
  for (const candidate of candidates) {
    if (holdoutBucket(salt, idOf(candidate)) < share) holdout.push(candidate);
    else send.push(candidate);
  }
  return { send, holdout };
}
