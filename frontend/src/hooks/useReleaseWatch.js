import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { getRelease } from "../lib/release.js";
import { logEvent } from "../lib/logEvent.js";
import {
  createReleaseReloader,
  createReleaseWatcher,
  installReleaseWatchHandlers,
  takePendingTelemetry,
} from "../lib/releaseWatch.js";

// Selve OPSLAGET af sessionStorage kaster i browsere hvor site-data er slaaet
// fra — ikke kun kaldene paa den. Null betyder fail-closed hele vejen ned:
// claimReloadSlot afviser, og telemetrien er best-effort.
function safeSessionStorage() {
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

// #5033 — lag 3: opdag en ny release mens fanen er aaben, og genindlaes roligt.
//
// Hvornaar vi tjekker:
//   · ved hvert route-skift (dog aldrig ved selve mount: siden ER lige loadet)
//   · naar fanen kommer i fokus efter mere end 5 minutter i baggrunden
//     (visibilitychange + window focus/pageshow, se installReleaseWatchHandlers)
//   · hvert 5. minut mens fanen er synlig, saa et deploy fanges FOER naeste
//     navigation
// Throttlen (60 s) ligger i createReleaseWatcher, saa klikkeri ikke bliver polling.
//
// Hvornaar vi genindlaeser: kun naar tjekket BEVISER en ny release, fanen er
// synlig, og der ikke staar et fokuseret tekstfelt (isSafeToReload). Er det
// usikkert, bliver markoeren liggende og bruges ved naeste navigation eller
// fokus — der er ingen timer der genindlaeser af sig selv i baggrunden.
//
// Reloadet er `location.assign(href)` paa den URL brugeren allerede staar paa:
// et fuldt dokument-load henter frisk HTML med de nye asset-URL'er, hvor en
// client-side navigation ville gaa videre med den gamle graf og ramme
// CYCLINGZONE-56.
//
// lazyWithRetry (#881/#4595) er uroert og er stadig sikkerhedsnettet for de
// tilfaelde hvor tjekket ikke naaede foerst.
export default function useReleaseWatch() {
  const location = useLocation();
  const ctxRef = useRef(null);
  // Mount-renderen er ikke et route-skift: den HTML vi kigger paa, kom fra det
  // deployment der lige har svaret. Et tjek dér ville vaere et garanteret spild.
  const skippedFirstRef = useRef(false);

  // Telemetrien fra FOERRIGE page-load: eventet kan ikke naa at blive skrevet
  // mens dokumentet river sig selv ned, saa det fyres her, efter reloadet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pending = takePendingTelemetry(safeSessionStorage());
    if (pending) logEvent("app_version_reload", pending);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;

    const currentRelease = getRelease();
    const reloader = createReleaseReloader({
      win: window,
      doc: document,
      storage: safeSessionStorage(),
      currentRelease,
      // Bindes: en loes fetch-reference kaldt uden `this` giver "Illegal
      // invocation" i Chromium (samme faelde som i lazyWithRetry.js).
      watcher: createReleaseWatcher({
        currentRelease,
        fetchFn: typeof window.fetch === "function" ? window.fetch.bind(window) : undefined,
      }),
    });
    ctxRef.current = reloader;

    const uninstall = installReleaseWatchHandlers({
      target: window,
      doc: document,
      runCheck: reloader.runCheck,
    });

    return () => {
      uninstall();
      if (ctxRef.current === reloader) ctxRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!skippedFirstRef.current) {
      skippedFirstRef.current = true;
      return;
    }
    ctxRef.current?.runCheck?.("navigation").catch(() => {});
  }, [location.pathname, location.search]);
}
