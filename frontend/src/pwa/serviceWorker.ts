// #6584 · Registrering af /sw.js.
//
// Workerens kontrakt (public/sw.js): den serverer aldrig app-kode, kun en
// offline-side naar en navigation fejler. Derfor kan den registreres uden at
// roere lag 1-3 i chunk-forsvaret, og derfor er "ny version klar" stadig
// releaseWatch.js + ReleaseUpdateBanner's opgave, ikke workerens.
//
// Hvornaar vi IKKE registrerer:
//   - dev-server (import.meta.env.PROD falsk): HMR og en worker er en daarlig blanding
//   - automatiseret browser (navigator.webdriver): Playwright-suiten mocker
//     netvaerket med page.route, og en navigation der gaar gennem en worker
//     er usynlig for page.route. E2E skal maale appen, ikke workeren.
//   - browsere uden serviceWorker-API
// Registreringen venter til efter `load` og en idle-periode, saa den aldrig
// konkurrerer med first paint om netvaerket.

export const SW_URL = "/sw.js";

export interface SwEnv {
  isProd: boolean;
  nav: (Navigator & { webdriver?: boolean }) | null;
}

export type SwSkipReason = "dev" | "automation" | "unsupported" | null;

/** Ren beslutning: hvorfor springer vi registreringen over (null = registrér). */
export function serviceWorkerSkipReason(env: SwEnv): SwSkipReason {
  if (!env.isProd) return "dev";
  if (!env.nav || !("serviceWorker" in env.nav)) return "unsupported";
  if (env.nav.webdriver === true) return "automation";
  return null;
}

function whenIdle(win: Window, fn: () => void): void {
  const ric = (win as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === "function") ric.call(win, fn, { timeout: 5000 });
  else win.setTimeout(fn, 2000);
}

export function registerServiceWorker(win: Window = window): void {
  const reason = serviceWorkerSkipReason({ isProd: import.meta.env.PROD, nav: win.navigator ?? null });
  if (reason) return;
  const start = () => {
    whenIdle(win, () => {
      // updateViaCache "none": browseren spoerger altid serveren om sw.js, saa
      // en ny worker-version aldrig haenger i HTTP-cachen.
      win.navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" }).catch(() => {
        // En fejlet registrering er usynlig for spilleren: appen virker som foer.
      });
    });
  };
  if (win.document.readyState === "complete") start();
  else win.addEventListener("load", start, { once: true });
}
