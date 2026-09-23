// Signal: rute-boundary'en med den prerendrede landing er hydreret (#4925).
//
// Hvorfor et signal og ikke en timer: landing prerendres på engelsk, og en
// dansk besøgende hydrerer mod EN og skifter sprog bagefter (main.jsx →
// LanguageProvider's deferredLanguage). Skiftet må først ske når React har
// hydreret ALT prerendret indhold. Rute-indholdet ligger inde i en <Suspense>
// (App.jsx), og React hydrerer en Suspense-boundarys indhold i et SENERE pass
// end skallen udenom: skallen committer, dens effekter kører (herunder
// LanguageProvider's), og først derefter hydreres boundary'en.
//
// Det gamle skifte ventede på requestIdleCallback og håbede at boundary'en var
// færdig til den tid. WebKit/Safari har ingen requestIdleCallback, så
// fallback'en setTimeout(0) kunne lande mellem Reacts hydrerings-skiver → dansk
// "Spring til indhold" mod engelsk "Skip to content" → React #418, og React
// genopbyggede landing på klienten. Intermitterende og belastningsafhængigt
// (målinger i #4925), og det rammer også rigtige Safari-brugere med dansk.
//
// Markøren nedenfor ligger INDE i rute-boundary'en. Dens effekt kører først
// når boundary'ens indhold er committet — hydreret, eller client-renderet hvis
// noget andet gik galt. Så er der intet prerendret indhold tilbage at ramme.
import { useEffect } from "react";

type Listener = () => void;

let hydrated = false;
const listeners = new Set<Listener>();

/** Kaldes af markøren når rute-boundary'en er committet. Idempotent. */
export function markPrerenderHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  const pending = [...listeners];
  listeners.clear();
  for (const listener of pending) listener();
}

/**
 * Kør `listener` når rute-boundary'en er hydreret — med det samme, hvis den
 * allerede er det (en klient-render uden dehydreret boundary committer
 * markøren FØR LanguageProvider's effekt, fordi børns effekter kører først).
 *
 * @returns afmelding; kaldes fra effektens cleanup.
 */
export function whenPrerenderHydrated(listener: Listener): () => void {
  if (hydrated) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Kun til tests: nulstil modulets tilstand mellem cases. */
export function resetPrerenderHydrationForTests(): void {
  hydrated = false;
  listeners.clear();
}

/**
 * Renderer intet. Placeres som SIDSTE barn i rute-<Suspense> i App.jsx, så
 * effekten kører efter resten af boundary'ens indhold er committet.
 */
export function PrerenderHydrationMarker(): null {
  useEffect(() => {
    markPrerenderHydrated();
  }, []);
  return null;
}
