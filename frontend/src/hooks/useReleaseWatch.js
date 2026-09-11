import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { getRelease } from "../lib/release.js";
import { logEvent } from "../lib/logEvent.js";
import { onRecoveryDeferred, safeSessionStorage } from "../lib/chunkErrors.js";
import {
  createReleaseReloader,
  createReleaseWatcher,
  installPendingNavigationInterceptor,
  installReleaseWatchHandlers,
  readFrontendIdMeta,
  takePendingTelemetry,
} from "../lib/releaseWatch.js";

// #5033 / #5159 — lag 3: opdag en ny FRONTEND mens fanen er åben, og genindlæs
// på et sikkert punkt.
//
// Hvornår vi TJEKKER:
//   · ved hvert route-skift (dog aldrig ved selve mount: siden ER lige loadet)
//   · når fanen kommer i fokus efter mere end 5 minutter i baggrunden
//   · hvert 5. minut mens fanen er synlig
// Throttlen (60 s) ligger i createReleaseWatcher, så klikkeri ikke bliver polling.
//
// Hvornår vi GENINDLÆSER — og det er hele forskellen fra første udkast (#5139):
// kun når tjekket BEVISER en ny frontend, fanen er synlig, markøren ikke står i
// et felt, OG reloadGate.js siger at ingen flade har ugemt arbejde, en åben
// dialog, en igangværende skrivning eller en kørende afspilning. Er noget af det
// i vejen, bliver markøren liggende, banneret vises, og vi prøver igen i samme
// sekund som den sidste blokering slippes (Gem/Annullér). Der er ingen timer der
// river siden væk under spilleren.
//
// Reloadet er et fuldt dokument-load: det henter frisk HTML med de nye
// asset-URL'er, hvor en client-side navigation ville gå videre med den gamle
// graf og ramme CYCLINGZONE-56. Klikker spilleren på et internt link mens vi ved
// at der er en ny frontend, laver `installPendingNavigationInterceptor` det
// dokument-load direkte til DESTINATIONEN (H3) — så bliver ét klik til ét
// sideskift, ikke til et reload oveni.
//
// lazyWithRetry (#881/#4595) er urørt og er stadig sikkerhedsnettet for de
// tilfælde hvor tjekket ikke nåede først.
//
// @returns {{updateReady: boolean, applyUpdate: () => void}} til banneret.
export default function useReleaseWatch() {
  const location = useLocation();
  const ctxRef = useRef(null);
  const [updateReady, setUpdateReady] = useState(false);
  // To UAFHAENGIGE grunde til at banneret staar, med hver sit liv:
  //   · `updateReady`      — versionsopslaget fandt en ny frontend (lag 3). Den
  //     forsvinder igen ved et rollback (`onUpdateGone`).
  //   · `recoveryDeferred` — lag 2 ville reparere en chunk-fejl, men porten var
  //     lukket (#5159, review-fund 1). Den har ingen mål-release, og et rollback
  //     goer den ikke uaktuel: chunk'en mangler stadig.
  // Samlet i én flag i returværdien, men de maa ikke kunne slukke hinanden.
  const [recoveryDeferred, setRecoveryDeferred] = useState(false);
  // Samme sandhed som `recoveryDeferred`, men laesbar fra en stabil callback.
  const recoveryDeferredRef = useRef(false);
  // Spilleren valgte "Save first" i bannerets bekraeftelse. Banneret lukkes uden
  // reload; markoeren bliver liggende, saa opdateringen tages automatisk paa det
  // sikre punkt i det sekund han HAR gemt.
  const [dismissed, setDismissed] = useState(false);
  // Mount-renderen er ikke et route-skift: den HTML vi kigger på, kom fra det
  // deployment der lige har svaret. Et tjek dér ville være garanteret spild.
  const skippedFirstRef = useRef(false);

  // Telemetrien fra FORRIGE page-load: eventet kan ikke nå at blive skrevet mens
  // dokumentet river sig selv ned, så det fyres her, efter reloadet.
  // M4: `outcome` siger om vi faktisk LANDEDE på den frontend vi ville hen til —
  // "arrived" eller "no_effect". Et reload der ikke ændrede noget, må ikke
  // tælles som en undgået chunk-fejl.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pending = takePendingTelemetry(safeSessionStorage(window), readFrontendIdMeta());
    if (pending) logEvent("app_version_reload", pending);
  }, []);

  // #5159 (review-fund 1): lag 2 — den globale preload-/rejection-handler —
  // udskyder nu ogsaa sit reparations-reload naar porten er lukket. Uden dette
  // abonnement ville spilleren staa med en brudt chunk og INGEN synlig udvej.
  // Abonnementet replayer et signal der allerede er faldet, fordi handlerne
  // installeres i main.jsx foer React monterer.
  useEffect(() => onRecoveryDeferred(() => {
    setRecoveryDeferred(true);
    recoveryDeferredRef.current = true;
    // Et nyt, uafhaengigt problem: et tidligere "Save first" maa ikke skjule det.
    setDismissed(false);
  }), []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;

    const storage = safeSessionStorage(window);
    const currentRelease = getRelease();
    const currentFrontendId = readFrontendIdMeta();

    const reloader = createReleaseReloader({
      win: window,
      doc: document,
      storage,
      currentRelease,
      currentFrontendId,
      // Bindes: en løs fetch-reference kaldt uden `this` giver "Illegal
      // invocation" i Chromium (samme fælde som i lazyWithRetry.js).
      watcher: createReleaseWatcher({
        currentFrontendId,
        fetchFn: typeof window.fetch === "function" ? window.fetch.bind(window) : undefined,
      }),
      onUpdateReady: ({ target, sha, reasons }) => {
        setUpdateReady(true);
        // Et NYT maal er et nyt faktum: et "Save first" paa den forrige release
        // maa ikke skjule det. `onUpdateReady` fyrer én gang pr. maal.
        setDismissed(false);
        // M4: "deferred" er et selvstændigt udfald — vi VED der er en ny
        // frontend, men vi tog den ikke af os selv. Uden det ville en udskudt
        // opdatering være usynlig i målingen.
        logEvent("app_version_reload", {
          from: currentFrontendId,
          to: target,
          fromSha: currentRelease,
          sha,
          trigger: "detected",
          outcome: "deferred",
          blockedBy: reasons.join(",") || "none",
        });
      },
      // Rollback eller CDN-flip: der er ikke laengere en nyere frontend, og saa
      // skal banneret vaek igen. Ellers ville knappen love en opdatering der
      // ikke findes.
      onUpdateGone: () => setUpdateReady(false),
    });
    ctxRef.current = reloader;

    const uninstall = installReleaseWatchHandlers({
      target: window,
      doc: document,
      runCheck: reloader.runCheck,
      // "feltet mistede fokus" er også et sikkert punkt — men kun mens der
      // ligger en markør og venter.
      hasPending: () => Boolean(reloader.state.pendingRelease),
    });

    // H3: beslut FØR routerens commit. Klik på et internt link, mens vi allerede
    // ved at der er en ny frontend, bliver til et rigtigt dokument-load af
    // destinationen i stedet for en client-side route mod en død chunk-graf.
    const uninstallNav = installPendingNavigationInterceptor({
      doc: document,
      win: window,
      storage,
      getTarget: () => reloader.state.pendingRelease,
    });

    return () => {
      uninstall();
      uninstallNav();
      reloader.dispose();
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

  const applyUpdate = useCallback(() => {
    Promise.resolve(ctxRef.current?.applyUpdate?.()).then((did) => {
      if (did) return;
      // Ingen maal-release at gaa til. Stod banneret alligevel, er det fordi lag
      // 2 udskoed en chunk-REPARATION (#5159 review-fund 1) — der findes intet
      // versions-maal, men der findes et brudt chunk. Klikket skal stadig virke,
      // ellers er den manuelle udvej et doedt klik. Et fuldt dokument-load er
      // praecis den reparation lag 2 ville have lavet af sig selv.
      if (!recoveryDeferredRef.current || typeof window === "undefined") return;
      window.location.reload();
    }).catch(() => {});
  }, []);

  // "Save first": luk banneret, reload INTET. Watcheren beholder sin markoer, saa
  // det automatiske reload sker paa det sikre punkt naar kladden er gemt.
  const dismissUpdate = useCallback(() => setDismissed(true), []);

  return {
    updateReady: (updateReady || recoveryDeferred) && !dismissed,
    applyUpdate,
    dismissUpdate,
  };
}
