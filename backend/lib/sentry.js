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
