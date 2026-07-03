// #1930 — Afsluttede løb på RacesPage skal som standard vises nyeste-først.
//
// "Kommende"-listen sorteres stigende på løbets dato (dateTextToDayOfYear ->
// måned*32 + dag). "Afsluttede"-listen havde ingen eksplicit sortering og arvede
// derfor DB-rækkefølgen (ORDER BY name), så nyeste resultat lå tilfældigt i listen.
//
// sortRacesByDateDesc spejler kommende-sorteringens dato-nøgle, men faldende, så
// det seneste løb ligger øverst. Ejeren planlægger senere et fuldt rework med
// bruger-valgbar sortering (se issue #1930); indtil da er dette den faste default.
//
// Datoteksten sidder på pool_race.date_text ("dd/mm"). Løb uden en gyldig dato
// (dateTextToDayOfYear -> Infinity) samles nederst i en stabil, deterministisk
// rækkefølge frem for at flyde tilfældigt til toppen.

import { dateTextToDayOfYear } from "./raceCalendar.js";

/**
 * Datonøgle for et løb ud fra pool_race.date_text ("dd/mm").
 * Ugyldig/manglende dato -> Infinity (håndteres som "nederst" ved DESC-sort).
 * @param {{ pool_race?: { date_text?: string|null } | null }} race
 * @returns {number}
 */
export function raceDayOfYear(race) {
  return dateTextToDayOfYear(race?.pool_race?.date_text);
}

/**
 * Sortér afsluttede løb nyeste-først (faldende på dato-nøgle).
 *
 * Muterer ikke input — returnerer en ny sorteret array. Løb uden gyldig dato
 * (Infinity) placeres sidst i stabil rækkefølge, så listen er deterministisk.
 *
 * @template {{ pool_race?: { date_text?: string|null } | null }} T
 * @param {T[]} races - afsluttede løb (ufiltreret rækkefølge)
 * @returns {T[]} ny array sorteret nyeste-først
 */
export function sortRacesByDateDesc(races) {
  if (!Array.isArray(races)) return [];
  return races
    .map((race, index) => ({ race, index, key: raceDayOfYear(race) }))
    .sort((a, b) => {
      // Løb uden gyldig dato (Infinity) hører nederst, ikke øverst.
      const aNoDate = a.key === Infinity;
      const bNoDate = b.key === Infinity;
      if (aNoDate && bNoDate) return a.index - b.index; // stabil
      if (aNoDate) return 1;
      if (bNoDate) return -1;
      if (b.key !== a.key) return b.key - a.key; // nyeste (højeste nøgle) først
      return a.index - b.index; // samme dato -> stabil rækkefølge
    })
    .map((entry) => entry.race);
}
