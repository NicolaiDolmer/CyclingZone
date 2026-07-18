/**
 * Rate limiters for write-heavy and abuse-prone HTTP routes.
 *
 * Storage: in-process memory store (day-1, single-instance Railway backend).
 * Multi-instance horizontal scaling will require a shared store (Redis or
 * Supabase-backed) — tracked as a follow-up at the time this lands.
 *
 * Key strategy: authenticated user id when available, otherwise client IP.
 * Mount AFTER `requireAuth`/`requireAdmin` so `req.user.id` is present and
 * one bad actor cannot evict legitimate users from the same egress IP.
 *
 * Thresholds and break-glass are documented in docs/ARCHITECTURE.md.
 */

import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const DISABLE_FLAG = process.env.RATE_LIMIT_DISABLED === "1";

// `trust proxy = 1` in server.js makes req.ip resolve to the first hop client.
// ipKeyGenerator normalises IPv6 to a /64 subnet prefix, preventing subnet-
// rotation bypass; IPv4 passes through unchanged.
export function userOrIpKey(req) {
  if (req.user?.id) return `u:${req.user.id}`;
  return `ip:${ipKeyGenerator(req.ip)}`;
}

function buildLimiter({ name, windowMs, max, message, errorCode }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    skip: () => DISABLE_FLAG,
    handler: (req, res) => {
      const retryAfter = Math.ceil(windowMs / 1000);
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({
        // `error` kept as legacy DA fallback; `errorCode` resolves via the
        // frontend errors:api.* namespace so EN players see English (#678).
        error: message,
        errorCode,
        code: "rate_limited",
        limiter: name,
        retry_after_seconds: retryAfter,
      });
    },
  });
}

// Auction bids — bursts are expected near auction close (proxy resolution runs
// in-process and does NOT hit this endpoint). 60/min covers heavy human bidding.
export const bidLimiter = buildLimiter({
  name: "bid",
  windowMs: 60_000,
  max: 60,
  message: "For mange bud på kort tid. Prøv igen om et øjeblik.",
  errorCode: "rate_bid",
});

// Auction create / market writes (transfer create/cancel, swaps, loans,
// finance loans, repay, team settings). Manager workflows are bursty but not
// rapid-fire — 30/min is generous without enabling spam.
export const marketWriteLimiter = buildLimiter({
  name: "market-write",
  windowMs: 60_000,
  max: 30,
  message: "For mange markedshandlinger på kort tid. Vent et øjeblik.",
  errorCode: "rate_market",
});

// Board interactions — proposals, signs, requests, bonus accept/decline, DNA.
// User flow is one decision at a time; tight limit catches scripted abuse.
export const boardWriteLimiter = buildLimiter({
  name: "board-write",
  windowMs: 60_000,
  max: 15,
  message: "For mange bestyrelseshandlinger på kort tid. Vent et øjeblik.",
  errorCode: "rate_board",
});

// Admin writes — single admin operator, but season-end / beta-reset flows fire
// multiple endpoints in rapid succession. 120/min keeps room for legitimate ops.
export const adminWriteLimiter = buildLimiter({
  name: "admin-write",
  windowMs: 60_000,
  max: 120,
  message: "For mange admin-handlinger på kort tid. Vent et øjeblik.",
});

// Presence pulse, login-streak, achievements/check, rider-view, notifications
// read. Frontend polls these on tab focus / route change — generous ceiling
// avoids breaking the UI but caps a runaway tab.
export const presencePulseLimiter = buildLimiter({
  name: "presence-pulse",
  windowMs: 60_000,
  max: 120,
  message: "For mange forespørgsler på kort tid. Vent et øjeblik.",
  errorCode: "rate_request",
});

// In-game feedback/bug-report submissions (#2602). Low-frequency, deliberate
// action (not a UI poll) — 5/10min is generous for genuine use and still caps
// scripted spam of the (unauthenticated-adjacent, service-role-inserted) table.
// #2602: `message` is English (not the Danish "legacy fallback" other limiters
// carry) — this endpoint has no pre-i18n callers to stay backwards-compatible
// with, and an EN-first raw string avoids a new backend i18n-leak (Refs #1068).
export const feedbackLimiter = buildLimiter({
  name: "feedback",
  windowMs: 600_000,
  max: 5,
  message: "Too many submissions in a short time. Try again shortly.",
  errorCode: "rate_feedback",
});

// Internal export for tests so they can exercise the same factory without
// hard-coding production thresholds.
export const __testing__ = { buildLimiter, userOrIpKey };
