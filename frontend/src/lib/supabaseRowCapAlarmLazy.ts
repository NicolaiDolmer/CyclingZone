// #8797 — browser-klientens fetch med rækkeloft-alarm, uden at alarmen ligger i første
// indlæsning. Kaldet går direkte videre til fetch og svaret returneres med det samme;
// alarm-modulet (med Sentry-rapporteringen) hentes først efter første svar og vurderer
// svaret bagefter. Alarmen kan derfor aldrig forsinke, ændre eller vælte et kald.
import type { RowCapObserver } from "./supabaseRowCapAlarm.ts";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const loadBrowserObserver = (): Promise<RowCapObserver> =>
  import("./supabaseRowCapAlarm.ts").then((m) => m.createBrowserRowCapObserver());

/** fetch til createClient({ global: { fetch } }). */
export function createLazyRowCapAlarmFetch(
  baseFetch: FetchLike = (input, init) => globalThis.fetch(input, init),
  loadObserver: () => Promise<RowCapObserver> = loadBrowserObserver,
): FetchLike {
  let observer: Promise<RowCapObserver> | null = null;
  return async function supabaseFetchWithLazyRowCapAlarm(input, init) {
    const response = await baseFetch(input, init);
    observer ??= loadObserver();
    observer.then(
      (observe) => observe(input, init, response),
      () => { /* best-effort: alarmen er et driftssignal; et modul der ikke kunne hentes må ikke røre kaldet. */ },
    );
    return response;
  };
}
