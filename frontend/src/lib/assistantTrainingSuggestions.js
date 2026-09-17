// assistantTrainingSuggestions.js — ren logik bag "Get suggestions from the
// assistant"-panelet på træningssiden (#4522, ejer-direktiv 31/8).
//
// Genbruger UDELUKKENDE data siden allerede har hentet (riders + planFor +
// smartDefaultFocus, alle fra useTraining/#1894) — ingen ny AI, intet nyt
// backend-kald til forslaget selv. "Accept" skriver via den EKSISTERENDE
// smart-bulk-sti (POST /api/training/bulk med session="smart"), samme kode
// som roster-værktøjslinjens "Smart focus"-bulk-valg (§9.3 i
// docs/ASSISTANT_RULES.md) — denne fil bygger kun PREVIEW-rækkerne panelet
// viser FØR spilleren trykker accept.
//
// Ingen DB, ingen React, ingen Date — unit-testes isoleret med node --test,
// samme mønster som trainingFocus.js.

import { SESSION_INTENSITY } from "./trainingDayTypes.js";

// Én række pr. rytter assistenten har et forslag til. Ryttere uden et
// smartDefaultFocus-map-hit (retired ryttere — backend beregner kun for
// is_retired=false, se docs/ASSISTANT_RULES.md §9) udelades: der er intet
// forslag at vise for dem.
//
//   riders            : [{ id, firstname, lastname }]
//   smartDefaultFocusByRider : { [riderId]: focusKey } — fra useTraining (#1894)
//   planFor           : (riderId) => { focus, intensity } | null — fra useTraining
//
// Returnerer [{ riderId, name, hasPlan, focus, intensity }], i samme
// rækkefølge som `riders` (siden sorterer allerede rytterne — vi opfinder
// ingen ny sortering).
export function buildAssistantSuggestions({ riders, smartDefaultFocusByRider, planFor } = {}) {
  const focusByRider = smartDefaultFocusByRider ?? {};
  return (riders ?? [])
    .filter((r) => !!focusByRider[r.id])
    .map((r) => {
      const focus = focusByRider[r.id];
      const plan = planFor ? planFor(r.id) : null;
      return {
        riderId: r.id,
        name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(),
        hasPlan: !!plan?.focus,
        focus,
        intensity: SESSION_INTENSITY[focus] ?? "normal",
      };
    });
}

// Hvor mange af forslags-rækkerne der er til ryttere UDEN en aktiv plan —
// tallet i toggle-labellen "Only riders without a plan (N)".
export function countSuggestionsWithoutPlan(rows) {
  return (rows ?? []).filter((row) => !row.hasPlan).length;
}

// Panelets filtrerede visning: "kun ryttere uden planlagt træning" (issue
// #4522's egen indgang) rører KUN hvilke rækker der VISES — accept-stien
// (smart-bulk) håndhæver "overskriver aldrig en eksisterende plan" uafhængigt
// server-side, uanset hvad filteret viser.
export function filterAssistantSuggestions(rows, onlyWithoutPlan) {
  if (!onlyWithoutPlan) return rows ?? [];
  return (rows ?? []).filter((row) => !row.hasPlan);
}

// #4699: hvilke af de VISTE forslag accept-stien faktisk kan skrive.
//
// Accept går gennem POST /api/training/bulk med session="smart", og serveren
// springer HVER rytter der allerede har en plan i den aktive sæson over
// (partitionSmartBulkTargets, §9.3 i docs/ASSISTANT_RULES.md) — assistenten
// overskriver aldrig managerens eget valg. Panelet tilbød dem alligevel: en
// aktiv checkbox på hver række og en aktiv "Accept all". Målt i prod 3/9 har
// 65 af 241 manager-hold en plan på HVER ikke-pensioneret rytter, og det er
// præcis de aktive hold. For dem sendte et klik hele truppen afsted og fik
// "Updated 0 riders" tilbage — knappen lovede noget serveren aldrig kunne
// levere, hverken enkeltvis eller via accept-alle.
//
// Denne funktion er den ENE kilde til hvad der er acceptabelt, så panelets
// checkboxe, "Accept selected"-tælleren og "Accept all" ikke kan komme ud af
// sync med serverens kontrakt igen.
export function acceptableAssistantSuggestions(rows) {
  return (rows ?? []).filter((row) => !row.hasPlan);
}

// Rytter-id'erne for de acceptable rækker, i visnings-rækkefølge — det er dem
// "Accept all" må sende.
export function acceptableSuggestionIds(rows) {
  return acceptableAssistantSuggestions(rows).map((row) => row.riderId);
}

// Den anden accept-sti: markerede rækker. Beskærer et valg til det serveren
// faktisk kan skrive, så en markering der er blevet uacceptabel siden den blev
// sat (rytteren fik en plan i en anden fane) ikke sender et kald der skriver 0
// rækker. Bevarer rækkefølgen fra `rows`, ikke fra Set'ets indsættelse.
export function acceptableSelectionIds(selected, rows) {
  const picked = selected instanceof Set ? selected : new Set(selected ?? []);
  return acceptableSuggestionIds(rows).filter((id) => picked.has(id));
}
