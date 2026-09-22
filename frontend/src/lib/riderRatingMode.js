// #5435 (D-049) — kontakten for rating-VISNINGEN: "egen rolle" (i dag) eller
// "bedste rolle nu" (model A). ÉN kontakt, alle flader.
//
// Hvorfor en modul-kontakt og ikke en parameter pr. kaldsted: riderOverallRating
// kaldes fra ~20 steder (hero, fem tabeller, auktionskort, træning, planner).
// #3666's garanti er at alle flader skifter skala i SAMME øjeblik — der må aldrig
// findes en side hvor tabellen viser bedste rolle og heroen egen rolle. En
// parameter der skal trådes igennem 20 steder kan glemmes ét sted; en kontakt
// som riderOverallRating selv læser kan ikke.
//
// Kilden er app_config-flaget `rider_best_role_display` (off|beta|on), evalueret
// SERVER-side mod viewerens beta-status (GET /api/display-flags, se
// backend/lib/riderBestRoleDisplayFlag.js). Klienten læser aldrig app_config.
// Fail-safe er OFF: intet svar, fejl eller ukendt værdi → dagens visning.
//
// Sidste kendte værdi caches pr. browser (localStorage), så en side der er
// tændt ikke blinker fra gammel til ny visning ved hver sideload. Cachen er
// kun en start-værdi: serverens svar vinder altid, og <RiderRatingModeGate>
// genmonterer indholdet hvis de to er uenige (sker kun den dag kontakten flippes).
//
// Ren .js uden React-import, så node --test kan loade riderRating.js.

const STORAGE_KEY = "cz_rider_best_role_display";

function readCached() {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let bestRoleDisplay = readCached();
const listeners = new Set();

export function isBestRoleDisplayOn() {
  return bestRoleDisplay;
}

export function setBestRoleDisplay(enabled) {
  const next = enabled === true;
  try {
    if (typeof localStorage !== "undefined") {
      if (next) localStorage.setItem(STORAGE_KEY, "1");
      else localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Blokeret storage: kontakten virker stadig for denne sideload.
  }
  if (next === bestRoleDisplay) return;
  bestRoleDisplay = next;
  for (const fn of listeners) fn();
}

export function subscribeBestRoleDisplay(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
