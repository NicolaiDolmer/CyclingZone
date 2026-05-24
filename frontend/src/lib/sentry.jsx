import * as Sentry from "@sentry/react";

const DSN = import.meta.env.VITE_SENTRY_DSN;
const ENABLED = import.meta.env.PROD && Boolean(DSN);
const RELEASE = import.meta.env.VITE_SENTRY_RELEASE || import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA;

let started = false;

function sampleRateFromEnv(name, fallback = 0) {
  const value = Number(import.meta.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function initSentry() {
  if (started || !ENABLED) return;
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: RELEASE || undefined,
    tracesSampleRate: sampleRateFromEnv("VITE_SENTRY_TRACES_SAMPLE_RATE"),
    replaysSessionSampleRate: sampleRateFromEnv("VITE_SENTRY_REPLAY_SAMPLE_RATE"),
    replaysOnErrorSampleRate: sampleRateFromEnv("VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE", 0.1),
    beforeSend(event) {
      const value = event.exception?.values?.[0]?.value || event.message || "";
      if (/ResizeObserver loop completed|NetworkError when attempting to fetch resource/i.test(value)) {
        return null;
      }
      return event;
    },
  });
  started = true;
}

export function SentryBoundary({ children }) {
  if (!ENABLED) return children;
  return (
    <Sentry.ErrorBoundary fallback={<div className="min-h-screen bg-cz-bg text-cz-1" />}>
      {children}
    </Sentry.ErrorBoundary>
  );
}

// #348 frontend-verify URL-trigger — fjernes igen efter Sentry MCP bekraefter event.
// Aktiveres ved at besoege https://cycling-zone.vercel.app/?sentry-test=1
export function maybeTriggerVerifyEvent() {
  if (!ENABLED || typeof window === "undefined") return;
  if (new URLSearchParams(window.location.search).get("sentry-test") !== "1") return;
  const err = new Error("Sentry frontend verify - #348 URL-trigger test");
  Sentry.captureException(err, {
    tags: { verify: "frontend-348" },
    extra: {
      source: "main.jsx URL-trigger",
      timestamp: new Date().toISOString(),
      userAgent: window.navigator?.userAgent,
    },
  });
}
