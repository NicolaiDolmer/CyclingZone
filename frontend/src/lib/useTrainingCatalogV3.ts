// #5319 · Er træningskatalog v3 (flag training_catalog_v3) tændt for MIG?
//
// Ét kald til GET /api/feature-flags pr. sideindlæsning (delt promise), samme
// fail-safe som resten af flag-klienten: fejl = off = dagens katalog. Hooket
// sætter også visnings-kataloget i training.js, så evne-linjerne (fx hvad
// Tærskel træner) følger samme svar som vælgerne.
import { useEffect, useState } from "react";
import { fetchPlayerFeatureFlags } from "./playerFeatureFlags.js";
import { setDisplayCatalogV3, isDisplayCatalogV3 } from "./training.js";

export const TRAINING_CATALOG_V3_FLAG_KEY = "training_catalog_v3";

let pending: Promise<boolean> | null = null;

export function loadTrainingCatalogV3(): Promise<boolean> {
  if (!pending) {
    pending = fetchPlayerFeatureFlags()
      .then((flags: Record<string, boolean>) => flags?.[TRAINING_CATALOG_V3_FLAG_KEY] === true)
      .catch(() => false)
      .then((on: boolean) => {
        setDisplayCatalogV3(on);
        return on;
      });
  }
  return pending;
}

export function useTrainingCatalogV3(): boolean {
  const [on, setOn] = useState<boolean>(isDisplayCatalogV3());
  useEffect(() => {
    let alive = true;
    loadTrainingCatalogV3().then((value) => {
      if (alive) setOn(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return on;
}
