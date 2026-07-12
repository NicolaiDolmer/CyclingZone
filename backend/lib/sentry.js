import * as Sentry from "@sentry/node";
import { normalizeSupabaseErrorMessage } from "./supabaseErrorNormalize.js";

let enabled = false;

// #2389 (A3): Supabase-js' query-fejl er PLAIN OBJECTS ({message, code, details,
// hint}), ikke Error-instanser. Sendes de rå til Sentry.captureException, bliver
// issue-titlen "captureException"/"<unknown>" og ALT grupperer i én bunke. Der er
// 30+ `throw someError;`-steder i lib/ der ender her via trackedTick m.fl., så
// normalisér centralt: syntetisér et Error med beskrivende besked, bevar code/
// details, og STRIP stacken — den syntetiske stack ville pege på denne fil for
// alle fejl og få Sentry til at gruppere ALT som ét issue; uden stack grupperer
// Sentry på type+besked, hvilket er præcis den ønskede adfærd for DB-fejl.
export function toSentryError(error) {
  if (error instanceof Error) return error;
  const rawMessage = error == null
    ? ""
    : (typeof error.message === "string" && error.message) ||
      (typeof error === "string" ? error : "") ||
      (() => { try { return JSON.stringify(error); } catch { return String(error); } })();
  const err = new Error(normalizeSupabaseErrorMessage(rawMessage) || "Unknown error (non-Error captured)");
  if (error && typeof error === "object") {
    if (error.code != null) err.code = error.code;
    if (error.details != null) err.details = error.details;
    if (error.hint != null) err.hint = error.hint;
  }
  err.stack = ""; // gruppér på besked, ikke på den syntetiske wrap-stack
  return err;
}

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
  Sentry.captureException(toSentryError(error), {
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
