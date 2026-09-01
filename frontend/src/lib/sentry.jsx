import * as Sentry from "@sentry/react";
import { useEffect, useState } from "react";
import {
  documentIsStillLoadable,
  isChunkLoadError,
  isUnambiguousChunkLoadError,
  shouldAttemptChunkReload,
} from "./chunkErrors.js";
// Direkte imports (IKKE barrel) — saa main-bundlen kun traekker ErrorState +
// Button (+ deres ikon/styles) ind, ikke hele ui-laget (#479). #671 Plan 3.
import ErrorState from "../components/ui/ErrorState.jsx";
import Button from "../components/ui/Button.jsx";
// denyUrls-moenstre i ren .js-fil (unit-testbar uden JSX-import), se #2018.
import { DENY_URLS } from "./sentryDenyUrls.js";

const DSN = import.meta.env.VITE_SENTRY_DSN;
const ENABLED = import.meta.env.PROD && Boolean(DSN);
const RELEASE = import.meta.env.VITE_SENTRY_RELEASE || import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA;

// Ét fingerprint for alle chunk-load-fejl, saa de lander i EN gruppe der kan
// arkiveres i Sentry i stedet for at blive slettet i klienten (#4545).
const CHUNK_ERROR_FINGERPRINT = "frontend-chunk-load-error";

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
      // #4545: chunk-fejl blev FOER droppet helt (#881: "recoverable stoej,
      // deploy-sundhed overvaages via Vercel"). Det kostede to ting paa én gang:
      // fejl-id'et fallbacken viser spilleren pegede paa et event der aldrig blev
      // sendt, og omfanget var umaaleligt — foerste signal paa haendelsen 1/9 var
      // en Discord-besked fra en spiller, ikke dashboardet.
      //
      // De sendes nu som warning under ÉT fingerprint. Saa bliver de én gruppe man
      // kan arkivere i Sentry: stoejen styres der hvor man kan se hvad man slaar
      // fra, i stedet for her hvor man ikke kan.
      //
      // KUN de utvetydige moenstre grupperes. isChunkLoadError() matcher ogsaa
      // React.lazy-interne strenge som almindelig kode kan producere (se
      // chunkErrors.js) — at samle dem her ville begrave et aegte crash i en
      // daempet chunk-gruppe, hvilket er praecis den fejl vi retter.
      if (event.tags?.frontend_error_kind === "chunk_load_error" || isUnambiguousChunkLoadError({ message: value })) {
        event.level = "warning";
        event.fingerprint = [CHUNK_ERROR_FINGERPRINT];
      }
      return event;
    },
  });
  started = true;
}

export function classifyFrontendError(error) {
  if (isUnambiguousChunkLoadError(error)) return "chunk_load_error";
  if (isChunkLoadError(error)) return "possible_chunk_load_error";
  return "render_error";
}

export function SentryBoundary({ children }) {
  // Altid-aktiv: Sentry.ErrorBoundary fungerer som en almindelig React-
  // error-boundary selv uden init (captureException er en no-op uden client),
  // saa render-fejl fanges OGSAA i dev/preview/uden DSN -> branded fallback i
  // stedet for white-screen (#671 Plan 3). Rapportering sker kun naar ENABLED.
  return (
    <Sentry.ErrorBoundary
      beforeCapture={(scope, error) => {
        // Tre vaerdier, ikke to (#4545): "possible_chunk_load_error" er de
        // React.lazy-interne signaturer som almindelig kode ogsaa kan producere.
        // Recovery behandler dem stadig som chunk-fejl (billigt at tage fejl),
        // men de daempes ikke i Sentry — saa et aegte crash forbliver synligt,
        // og du kan maale hvor stor den tvetydige bunke faktisk er.
        scope.setTag("frontend_error_kind", classifyFrontendError(error));
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
  // Sat naar auto-recovery er opbrugt for denne release — se effecten nedenfor.
  const [recoveryExhausted, setRecoveryExhausted] = useState(false);
  // "Stuck" = chunk-fejl hvor der IKKE kommer et automatisk reload. Copyen skal
  // sige hvad der faktisk sker, og give spilleren det skridt der virker: et
  // haardt gen-indlaes, og ellers rydning af sidens data. Et almindeligt reload
  // henter ikke en `immutable`-cachet ressource igen, saa knappen ovenfor kan
  // ikke loese det (#4545).
  const stuck = chunkError && recoveryExhausted;
  const lang = getPreferredLanguage().toLowerCase().startsWith("da") ? "da" : "en";
  const copy = lang === "da"
    ? {
        title: stuck
          ? "Siden kunne ikke indlæses"
          : chunkError ? "Cycling Zone er opdateret" : "Siden kunne ikke vises",
        body: stuck
          ? "Genindlæsning løste det ikke. Et hårdt gen-indlæs plejer at virke: hold Shift nede, og klik Genindlæs. Sker det stadig, så ryd sidens gemte data i browserens indstillinger."
          : chunkError
            ? "Din browser havde en ældre version af siden åben. Vi prøver at genindlæse den nye version automatisk."
            : "Der skete en fejl i appen. Fejlen er registreret, og du kan prøve at genindlæse siden.",
        reload: "Genindlæs siden",
        retry: "Prøv igen",
        event: "Fejl-id",
      }
    : {
        title: stuck
          ? "The page could not be loaded"
          : chunkError ? "Cycling Zone was updated" : "The page could not be shown",
        body: stuck
          ? "Reloading did not fix it. A hard refresh usually does: hold Shift and click Reload. If it keeps happening, clear this site's saved data in your browser settings."
          : chunkError
            ? "Your browser had an older version of the page open. We are trying to reload the new version automatically."
            : "The app hit an error. The error has been recorded, and you can try reloading the page.",
        reload: "Reload page",
        retry: "Try again",
        event: "Error ID",
      };

  // Auto-recovery ved stale chunk (#881/#906) — navigations-guarded (#3602).
  //
  // Denne effect kaldte før `window.location.reload()` synkront. Men WebKit melder
  // en chunk-load der blev ABORTERET af en igangværende navigation med præcis
  // samme fejlstreng som en ægte stale chunk, så boundary'en reloadede dokumenter
  // der allerede var på vej væk — og kaprede brugerens navigation (målt: reload
  // 39 ms efter aborten, 1,4 s før den ægte navigation nåede at committe).
  //
  // documentIsStillLoadable() spørger dokumentet om det stadig kan hente noget.
  // Kun hvis ja brænder vi loop-guard-nøglen og reloader. Se chunkErrors.js.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    // Gate på chunk-fejl FØR canary'en: en almindelig render-fejl skal ikke
    // udløse et netværkskald.
    if (!isChunkLoadError(error)) return undefined;

    let cancelled = false;
    const cancel = () => { cancelled = true; };
    window.addEventListener("pagehide", cancel);

    documentIsStillLoadable({
      fetchFn: window.fetch?.bind(window),
      url: window.location.href,
    }).then((alive) => {
      if (cancelled || !alive) return;
      const shouldReload = shouldAttemptChunkReload({
        error,
        release: RELEASE,
        storage: window.sessionStorage,
      });
      if (shouldReload) {
        window.location.reload();
        return;
      }
      // #4545: dokumentet ER i live, men loop-guarden er braendt — ét reload er
      // allerede brugt paa denne release. Der sker altsaa INTET automatisk herfra,
      // og copyen maa ikke blive ved med at love det. Uden dette flag sad
      // spilleren 1/9 i en loekke: samme "vi genindlaeser automatisk", nyt fejl-id,
      // i det uendelige, uden at faa at vide hvad han selv kunne goere.
      setRecoveryExhausted(true);
    });

    return () => {
      cancel();
      window.removeEventListener("pagehide", cancel);
    };
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
              {/* #4545: "Proev igen" skjules mens et automatisk reload er paa vej,
                  men vises igen naar recovery er opbrugt — saa spilleren har en
                  udvej ud over den knap der beviseligt ikke hjalp ham. */}
              {(!chunkError || stuck) && (
                <Button variant="secondary" size="sm" onClick={() => resetError?.()}>
                  {copy.retry}
                </Button>
              )}
            </div>
            {ENABLED && eventId && (
              <p className="font-mono text-2xs text-cz-3">
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
