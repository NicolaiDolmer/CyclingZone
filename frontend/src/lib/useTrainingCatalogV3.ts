// #5319 · Er træningskatalog v3 (flag training_catalog_v3) tændt for MIG?
//
// GET /api/feature-flags deles mellem alle felter der monteres samtidig, og
// svaret er friskt i et minut (freshFlagLoader.ts); en ny montering derefter
// henter igen, så et flag-skift når en åben fane uden genindlæsning. Samme
// fail-safe som resten af flag-klienten: fejl = off = dagens katalog. Hooket
// sætter også visnings-kataloget i training.js, så evne-linjerne (fx hvad
// Tærskel træner) følger samme svar som vælgerne.
import { useEffect, useState } from "react";
import { fetchPlayerFeatureFlags } from "./playerFeatureFlags.js";
import { setDisplayCatalogV3, isDisplayCatalogV3 } from "./training.js";
import { supabase } from "./supabase";
import { isViewerChangeEvent } from "./viewerChange.ts";
import { createFreshFlagLoader } from "./freshFlagLoader.ts";

export const TRAINING_CATALOG_V3_FLAG_KEY = "training_catalog_v3";

// Et vellykket svar har en boolean for hver nøgle i allowlisten; mangler nøglen,
// fejlede kaldet eller serverens DB-læsning (fetchPlayerFeatureFlags giver {}
// ved netfejl, 5xx og `degraded`), og svaret er ukendt.
const loader = createFreshFlagLoader(() =>
  fetchPlayerFeatureFlags().then((flags: Record<string, boolean>) => {
    const value = flags?.[TRAINING_CATALOG_V3_FLAG_KEY];
    return typeof value === "boolean" ? value : null;
  }),
);
loader.subscribe((on) => setDisplayCatalogV3(on));

let authListenerInstalled = false;

// Codex-fund: svaret afhænger af viewerens beta-status, og modulet overlever
// logout i samme SPA-fane. Ved viewer-skift glemmes svaret, og visningen falder
// tilbage til dagens katalog, indtil den nye viewers svar er hentet.
function installAuthListener(): void {
  if (authListenerInstalled) return;
  authListenerInstalled = true;
  supabase.auth.onAuthStateChange((event) => {
    if (!isViewerChangeEvent(event)) return;
    loader.reset();
  });
}

export function loadTrainingCatalogV3(): Promise<boolean> {
  installAuthListener();
  return loader.load();
}

export function useTrainingCatalogV3(): boolean {
  const [on, setOn] = useState<boolean>(isDisplayCatalogV3());
  useEffect(() => {
    let alive = true;
    const unsubscribe = loader.subscribe((value) => {
      if (alive) setOn(value);
    });
    loadTrainingCatalogV3().then((value) => {
      if (alive) setOn(value);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return on;
}
