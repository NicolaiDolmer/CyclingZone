import * as Sentry from "@sentry/react";
import { useEffect } from "react";
import { isChunkLoadError, shouldAttemptChunkReload } from "./chunkErrors.js";

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
    <Sentry.ErrorBoundary
      beforeCapture={(scope, error) => {
        scope.setTag("frontend_error_kind", isChunkLoadError(error) ? "chunk_load_error" : "render_error");
        if (RELEASE) scope.setTag("frontend_release", RELEASE);
      }}
      fallback={(props) => <AppErrorFallback {...props} />}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}

function getPreferredLanguage() {
  if (typeof window === "undefined") return "en";
  try {
    return window.localStorage?.getItem("cz_lang") || window.navigator?.language || "en";
  } catch {
    return window.navigator?.language || "en";
  }
}

function AppErrorFallback({ error, eventId, resetError }) {
  const chunkError = isChunkLoadError(error);
  const lang = getPreferredLanguage().toLowerCase().startsWith("da") ? "da" : "en";
  const copy = lang === "da"
    ? {
        eyebrow: chunkError ? "Ny version klar" : "Noget gik galt",
        title: chunkError ? "Cycling Zone er opdateret" : "Siden kunne ikke vises",
        body: chunkError
          ? "Din browser havde en ældre version af siden åben. Vi prøver at genindlæse den nye version automatisk."
          : "Der skete en fejl i appen. Fejlen er registreret, og du kan prøve at genindlæse siden.",
        reload: "Genindlæs siden",
        retry: "Prøv igen",
        event: "Fejl-id",
      }
    : {
        eyebrow: chunkError ? "New version ready" : "Something went wrong",
        title: chunkError ? "Cycling Zone was updated" : "The page could not be shown",
        body: chunkError
          ? "Your browser had an older version of the page open. We are trying to reload the new version automatically."
          : "The app hit an error. The error has been recorded, and you can try reloading the page.",
        reload: "Reload page",
        retry: "Try again",
        event: "Error ID",
      };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const shouldReload = shouldAttemptChunkReload({
      error,
      release: RELEASE,
      storage: window.sessionStorage,
    });
    if (shouldReload) {
      window.location.reload();
    }
  }, [error]);

  return (
    <main className="min-h-screen bg-cz-body text-cz-1 flex items-center justify-center px-4 py-10">
      <section className="w-full max-w-lg bg-cz-card border border-cz-border rounded-lg p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-cz-accent-t mb-2">{copy.eyebrow}</p>
        <h1 className="text-2xl font-bold mb-3">{copy.title}</h1>
        <p className="text-cz-2 text-sm leading-6 mb-5">{copy.body}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-cz-accent text-cz-on-accent text-sm font-bold hover:brightness-105"
          >
            {copy.reload}
          </button>
          {!chunkError && (
            <button
              type="button"
              onClick={() => resetError?.()}
              className="px-4 py-2 rounded-lg border border-cz-border bg-cz-subtle text-cz-1 text-sm font-medium hover:bg-cz-body"
            >
              {copy.retry}
            </button>
          )}
        </div>
        {eventId && (
          <p className="mt-4 text-[11px] text-cz-3 font-mono">
            {copy.event}: {eventId}
          </p>
        )}
      </section>
    </main>
  );
}

// User-context helpers (#621 item 2). Tag hver event med user.id så Sentry
// "Affected users"-counter virker. KUN UUID — ingen email, ingen team-navn,
// ingen PII (GDPR-safe).
export function setSentryUser(userId) {
  if (!ENABLED || !userId) return;
  Sentry.setUser({ id: userId });
}

export function clearSentryUser() {
  if (!ENABLED) return;
  Sentry.setUser(null);
}
