// #5319 · Delt, men ikke evigt, svar på "er flaget tændt for mig?".
//
// Codex-fund på #7341: et delt promise der aldrig glemmes, holder det første
// svar resten af SPA-sessionen. Tænder ejeren flaget, mens en spiller har fanen
// åben, træner backend straks efter det nye katalog, mens vælgerne viser det
// gamle. Her deles kun det kald der er i gang (mange felter monteres på samme
// side), og svaret er friskt i `maxAgeMs`; derefter hentes det igen ved næste
// montering. Lyttere får hvert nyt svar, så allerede monterede felter følger med.

export type FreshFlagLoader = {
  load: () => Promise<boolean>;
  reset: () => void;
  subscribe: (listener: (on: boolean) => void) => () => void;
};

export function createFreshFlagLoader(
  fetchOn: () => Promise<boolean>,
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
      .catch(() => false)
      .then((on) => {
        // Et svar der kom efter et viewer-skift, tilhører den gamle viewer.
        if (mine !== generation) return on;
        cached = { value: on, at: now() };
        publish(on);
        return on;
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
