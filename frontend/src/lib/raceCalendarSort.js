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
//
// #3297 (regression af #1930): dato-nøglen har ALDRIG haft en sæson-komponent.
// Så længe kun sæson 1 eksisterede var det uden betydning; efter S2-start fik et
// S1-løb dateret sent på året (fx 20/12) en højere nøgle end et S2-løb kørt i
// går (fx 3/8) og lagde sig fejlagtigt øverst. sortRacesByDateDesc sorterer nu
// FØRST på sæson-nummer (faldende), DEREFTER på dato-nøglen inden for sæsonen.
// Kaldere der ikke henter season_id (fx ResultaterPage, som allerede er
// sæson-scopet via .eq("season_id", ...)) er upåvirkede: race.season er
// undefined for alle løb i den liste -> raceSeasonNumber giver samme værdi for
// alle -> sorteringen falder tilbage til ren dato-sammenligning som før.

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
 * Sæson-nummer for et løb ud fra race.season.number (join på season_id).
 * Mangler joinet/feltet -> -Infinity, så løb uden sæson-info sorteres INDBYRDES
 * på ren dato-nøgle (bagudkompatibelt med kaldere der ikke henter season_id).
 * @param {{ season?: { number?: number|null } | null }} race
 * @returns {number}
 */
export function raceSeasonNumber(race) {
  const n = race?.season?.number;
  return typeof n === "number" && Number.isFinite(n) ? n : -Infinity;
}

/**
 * Sortér afsluttede løb nyeste-først: faldende på sæson-nummer, derefter
 * faldende på dato-nøgle inden for sæsonen.
 *
 * Muterer ikke input — returnerer en ny sorteret array. Løb uden gyldig dato
 * (Infinity) placeres sidst inden for deres sæson, i stabil rækkefølge.
 *
 * @template {{ pool_race?: { date_text?: string|null } | null, season?: { number?: number|null } | null }} T
 * @param {T[]} races - afsluttede løb (ufiltreret rækkefølge)
 * @returns {T[]} ny array sorteret nyeste-først
 */
export function sortRacesByDateDesc(races) {
  if (!Array.isArray(races)) return [];
  return races
    .map((race, index) => ({ race, index, season: raceSeasonNumber(race), key: raceDayOfYear(race) }))
    .sort((a, b) => {
      // Sæson trumfer altid dato — et løb fra en tidligere sæson skal ALDRIG
      // ligge over et løb fra en nyere sæson, uanset dd/mm-nøglen.
      if (b.season !== a.season) return b.season - a.season;
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
