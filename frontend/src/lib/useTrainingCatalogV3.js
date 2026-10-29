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

let pending = null;

export function loadTrainingCatalogV3() {
  if (!pending) {
    pending = fetchPlayerFeatureFlags()
      .then((flags) => flags?.[TRAINING_CATALOG_V3_FLAG_KEY] === true)
      .catch(() => false)
      .then((on) => {
        setDisplayCatalogV3(on);
        return on;
      });
  }
  return pending;
}

export function useTrainingCatalogV3() {
  const [on, setOn] = useState(isDisplayCatalogV3());
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
