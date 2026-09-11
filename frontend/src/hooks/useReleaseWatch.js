import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { getRelease } from "../lib/release.js";
import { logEvent } from "../lib/logEvent.js";
import {
  BACKGROUND_THRESHOLD_MS,
  claimReloadSlot,
  createReleaseWatcher,
  hardReload,
  isSafeToReload,
  rememberPendingTelemetry,
  takePendingTelemetry,
} from "../lib/releaseWatch.js";

// #5033 — lag 3: opdag en ny release mens fanen er aaben, og genindlaes roligt.
//
// Hvornaar vi tjekker:
//   · ved hvert route-skift (dog aldrig ved selve mount: siden ER lige loadet)
//   · naar fanen kommer i fokus efter mere end 5 minutter i baggrunden
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
    let pending;
    try {
      pending = takePendingTelemetry(window.sessionStorage);
    } catch {
      // sessionStorage utilgaengelig (privat browsing) — maalingen er best-effort.
      return;
    }
    if (pending) logEvent("app_version_reload", pending);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;

    const currentRelease = getRelease();
    const ctx = {
      currentRelease,
      // Bindes: en loes fetch-reference kaldt uden `this` giver "Illegal
      // invocation" i Chromium (samme faelde som i lazyWithRetry.js).
      watcher: createReleaseWatcher({
        currentRelease,
        fetchFn: typeof window.fetch === "function" ? window.fetch.bind(window) : undefined,
      }),
      pendingRelease: null,
      reloading: false,
      hiddenAt: 0,
    };
    ctxRef.current = ctx;

    const attemptReload = (target, trigger) => {
      if (ctx.reloading || !target) return;
      if (!isSafeToReload(document)) return;
      // Loop-guard: hoejst ét reload pr. maal-release pr. session. Naar den nye
      // HTML af en eller anden grund ikke naar frem, ender vi altsaa paa den
      // gamle side med lazyWithRetry som net — ikke i en reload-spiral.
      if (!claimReloadSlot(window.sessionStorage, target)) return;
      ctx.reloading = true;
      rememberPendingTelemetry(window.sessionStorage, {
        from: ctx.currentRelease,
        to: target,
        trigger,
      });
      hardReload(window);
    };

    const runCheck = async (trigger) => {
      if (ctx.reloading) return;
      // Allerede bevist ny: intet nyt netvaerkskald, bare et nyt forsoeg paa at
      // finde et roligt oejeblik.
      if (ctx.pendingRelease) {
        attemptReload(ctx.pendingRelease, trigger);
        return;
      }
      const result = await ctx.watcher.check();
      if (result?.status !== "ok" || !result.isNew) return;
      ctx.pendingRelease = result.release;
      attemptReload(result.release, trigger);
    };

    ctx.runCheck = runCheck;

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        ctx.hiddenAt = Date.now();
        return;
      }
      if (document.visibilityState !== "visible") return;
      const hiddenFor = ctx.hiddenAt ? Date.now() - ctx.hiddenAt : 0;
      ctx.hiddenAt = 0;
      if (hiddenFor <= BACKGROUND_THRESHOLD_MS) return;
      // Fejl i recovery-stien maa aldrig blive til en unhandledrejection —
      // chunkErrors.js' globale handler lytter paa netop dem.
      runCheck("focus").catch(() => {});
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (ctxRef.current === ctx) ctxRef.current = null;
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
