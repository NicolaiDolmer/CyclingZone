// #5319 · Delt, men ikke evigt, svar på "er flaget tændt for mig?".
//
// Codex-fund på #7341: et delt promise der aldrig glemmes, holder det første
// svar resten af SPA-sessionen. Tænder ejeren flaget, mens en spiller har fanen
// åben, træner backend straks efter det nye katalog, mens vælgerne viser det
// gamle. Her deles kun det kald der er i gang (mange felter monteres på samme
// side), og svaret er friskt i `maxAgeMs`; derefter hentes det igen ved næste
// montering. Lyttere får hvert nyt svar, så allerede monterede felter følger med.
//
// `fetchOn` giver null når svaret er ukendt (netfejl, 5xx, nøglen mangler).
// Et ukendt svar er ikke et "off" (review-fund): det caches og publiceres ikke,
// så felterne beholder det sidst kendte svar, og næste montering prøver igen.

export type FreshFlagLoader = {
  load: () => Promise<boolean>;
  reset: () => void;
  subscribe: (listener: (on: boolean) => void) => () => void;
};

export function createFreshFlagLoader(
  fetchOn: () => Promise<boolean | null>,
  { maxAgeMs = 60_000, now = () => Date.now() }: { maxAgeMs?: number; now?: () => number } = {},
): FreshFlagLoader {
  let cached: { value: boolean; at: number } | null = null;
  let pending: Promise<boolean> | null = null;
  let generation = 0;
  const listeners = new Set<(on: boolean) => void>();

  function publish(on: boolean): void {
    for (const listener of listeners) listener(on);
  }

  function load(): Promise<boolean> {
    if (cached && now() - cached.at < maxAgeMs) return Promise.resolve(cached.value);
    if (pending) return pending;
    const mine = generation;
    const request = fetchOn()
      .catch(() => null)
      .then((answer) => {
        const known = cached?.value ?? false;
        // Et svar der kom efter et viewer-skift, tilhører den gamle viewer.
        if (mine !== generation) return answer ?? known;
        if (answer === null) return known;
        cached = { value: answer, at: now() };
        publish(answer);
        return answer;
      })
      .finally(() => {
        if (pending === request) pending = null;
      });
    pending = request;
    return request;
  }

  function reset(): void {
    generation += 1;
    cached = null;
    pending = null;
    publish(false);
  }

  function subscribe(listener: (on: boolean) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return { load, reset, subscribe };
}
