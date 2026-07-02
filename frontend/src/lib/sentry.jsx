import * as Sentry from "@sentry/react";
import { useEffect } from "react";
import { isChunkLoadError, shouldAttemptChunkReload } from "./chunkErrors.js";
// Direkte imports (IKKE barrel) — saa main-bundlen kun traekker ErrorState +
// Button (+ deres ikon/styles) ind, ikke hele ui-laget (#479). #671 Plan 3.
import ErrorState from "../components/ui/ErrorState.jsx";
import Button from "../components/ui/Button.jsx";
// denyUrls-moenstre i ren .js-fil (unit-testbar uden JSX-import), se #2018.
import { DENY_URLS } from "./sentryDenyUrls.js";

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
    // #1792 (extensions) + #2018 (Vercel Live Feedback toolbar): dropper events
    // hvis "blame"-frame stammer fra tredjeparts-injiceret kode. Se DENY_URLS.
    denyUrls: DENY_URLS,
    beforeSend(event) {
      const value = event.exception?.values?.[0]?.value || event.message || "";
      if (/ResizeObserver loop completed|NetworkError when attempting to fetch resource/i.test(value)) {
        return null;
      }
      // #881: stale-chunk-fejl efter deploy er recoverable (appen auto-reloader til
      // ny version) — drop dem som støj. Deploy-sundhed overvåges via Vercel, ikke her.
      if (event.tags?.frontend_error_kind === "chunk_load_error" || isChunkLoadError({ message: value })) {
        return null;
      }
      return event;
    },
  });
  started = true;
}

export function SentryBoundary({ children }) {
  // Altid-aktiv: Sentry.ErrorBoundary fungerer som en almindelig React-
  // error-boundary selv uden init (captureException er en no-op uden client),
  // saa render-fejl fanges OGSAA i dev/preview/uden DSN -> branded fallback i
  // stedet for white-screen (#671 Plan 3). Rapportering sker kun naar ENABLED.
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

// #1170 slice B-beslutning: boundary-copy herunder er BEVIDST statisk (ingen
// t()/i18n). Error-boundary kan ramme før i18n er initialiseret eller mens et
// chunk-load fejler, så den må ikke afhænge af i18n-runtime. EN er default;
// DA vælges kun ved eksplicit cz_lang=da (samme nøgle som LanguageProvider)
// eller dansk browser-sprog. Filen er EXEMPT i scripts/i18n-check-lib-strings.mjs.
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
        title: chunkError ? "Cycling Zone er opdateret" : "Siden kunne ikke vises",
        body: chunkError
          ? "Din browser havde en ældre version af siden åben. Vi prøver at genindlæse den nye version automatisk."
          : "Der skete en fejl i appen. Fejlen er registreret, og du kan prøve at genindlæse siden.",
        reload: "Genindlæs siden",
        retry: "Prøv igen",
        event: "Fejl-id",
      }
    : {
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

  // On-spec branded fallback paa ErrorState + Button (#671 Plan 3). Statisk
  // copy bevaret (#1170); eventId vises kun naar ENABLED (deterministisk +
  // meningsfuldt — vi viser kun et id vi faktisk har rapporteret).
  return (
    // role="alert" -> skaermlaesere annoncerer fejlen assertivt naar fallback'en
    // mountes (ErrorState's titel er en <p>, ikke en heading — alert-regionen
    // bevarer a11y for en fuld-skaerms crash). #671 Plan 3.
    <main role="alert" className="flex min-h-screen items-center justify-center bg-cz-body px-4 py-10 text-cz-1">
      <ErrorState
        className="w-full max-w-lg"
        title={copy.title}
        description={copy.body}
        action={
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
                {copy.reload}
              </Button>
              {!chunkError && (
                <Button variant="secondary" size="sm" onClick={() => resetError?.()}>
                  {copy.retry}
                </Button>
              )}
            </div>
            {ENABLED && eventId && (
              <p className="font-mono text-[11px] text-cz-3">
                {copy.event}: {eventId}
              </p>
            )}
          </div>
        }
      />
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
