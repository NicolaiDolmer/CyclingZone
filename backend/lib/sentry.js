import * as Sentry from "@sentry/node";

let enabled = false;

function releaseName() {
  return process.env.SENTRY_RELEASE ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    undefined;
}

function sampleRateFromEnv() {
  const value = Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function initSentry() {
  if (enabled || !process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: releaseName(),
    tracesSampleRate: sampleRateFromEnv(),
    beforeSend(event) {
      const message = event.message || event.exception?.values?.[0]?.value || "";
      if (/rate limit exceeded/i.test(message)) return null;
      return event;
    },
  });
  enabled = true;

  process.on("unhandledRejection", (reason) => {
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  });
  process.on("uncaughtException", (error) => {
    Sentry.captureException(error);
  });
}

export function captureException(error, context = {}) {
  if (!enabled) return;
  const { tags, ...extra } = context;
  Sentry.captureException(error, {
    extra,
    ...(tags ? { tags } : {}),
  });
}

export function setupSentryExpressErrorHandler(app) {
  if (!enabled || typeof Sentry.setupExpressErrorHandler !== "function") return;
  Sentry.setupExpressErrorHandler(app);
}

// #2077 (#621 punkt 5) — Sentry Cron-heartbeat. Wrap et cron-tick så Sentry ved
// hvornår et tick STARTER og SLUTTER (ok/error). Udebliver et tick (proces død,
// deploy-hang, event-loop blokeret) fyrer Sentry en MISSED-alarm ud fra schedulen
// i monitorConfig — komplementært til stall-watchdog'en, der fanger "tavse" stalls
// mens processen ellers kører fint. No-op når Sentry er disabled (ingen DSN).
export function captureCheckIn(payload, monitorConfig) {
  if (!enabled || typeof Sentry.captureCheckIn !== "function") return undefined;
  return Sentry.captureCheckIn(payload, monitorConfig);
}

/**
 * Returnerer en wrapped async-fn der sender in_progress → ok/error check-ins omkring
 * `fn`. Fejl re-throwes (så trackedTick stadig captureExceptioner). Er Sentry
 * disabled, køres fn direkte uden overhead.
 */
export function monitorCron(monitorSlug, fn, monitorConfig) {
  return async (...args) => {
    if (!enabled || typeof Sentry.captureCheckIn !== "function") return fn(...args);
    const checkInId = Sentry.captureCheckIn({ monitorSlug, status: "in_progress" }, monitorConfig);
    try {
      const result = await fn(...args);
      Sentry.captureCheckIn({ checkInId, monitorSlug, status: "ok" }, monitorConfig);
      return result;
    } catch (err) {
      Sentry.captureCheckIn({ checkInId, monitorSlug, status: "error" }, monitorConfig);
      throw err;
    }
  };
}

// #621 item 2 — tag request-scoped Sentry-events med user.id efter auth-validation.
// KUN UUID (req.user.id) — ingen email, ingen team-navn, ingen PII (GDPR-safe).
// Sentry v8+ Node-SDK bruger OpenTelemetry-context-isolation per request, så
// Sentry.setUser() inden for en request scopes til den request alene; den
// lækker ikke til parallelle requests. Refs:
// https://docs.sentry.io/platforms/javascript/guides/node/enriching-events/identify-user/
export function setSentryUser(userId) {
  if (!enabled || !userId) return;
  Sentry.setUser({ id: userId });
}
