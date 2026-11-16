// #7741 · Kontakten training_train_now_bonus (binær, som motoren) for Træn nu-bonussen.
// Kvitteringens bonusmærke og teksterne om bonussen vises kun, når den er on.
// Svaret evalueres server-side (GET /api/feature-flags); fejl eller manglende
// svar = off, så fladerne ser ud som uden bonussen.
//
// Kvitteringen har en række pr. dato, så opslaget deles: ét kald i den korte
// periode, hvor mange kvitteringer monteres samtidig. Klienten hentes foerst naar
// effekten koerer, saa komponenten kan renderes uden netvaerks-/auth-kaeden.
import { useEffect, useState } from "react";

export const TRAIN_NOW_BONUS_FLAG_KEY = "training_train_now_bonus";
const SHARE_MS = 5000;

let shared: { at: number; promise: Promise<boolean> } | null = null;

function readBonusFlag(): Promise<boolean> {
  const now = Date.now();
  if (!shared || now - shared.at > SHARE_MS) {
    shared = {
      at: now,
      promise: import("./playerFeatureFlags.js")
        .then(({ fetchPlayerFeatureFlags }) => fetchPlayerFeatureFlags() as Promise<Record<string, boolean>>)
        .then((flags) => flags?.[TRAIN_NOW_BONUS_FLAG_KEY] === true)
        .catch(() => false), // catch-ok: ukendt = off, som uden bonussen
    };
  }
  return shared.promise;
}

export function useTrainNowBonusEnabled(active = true): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    readBonusFlag().then((on) => { if (alive) setEnabled(on); });
    return () => { alive = false; };
  }, [active]);
  return enabled;
}
