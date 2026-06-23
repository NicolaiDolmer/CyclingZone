// riderSort — delt sort-konvention for ALLE rytter-oversigter (#1755).
//
// Baggrund: hver rytter-tabel (rytterdatabase, eget hold, andre holds trup,
// watchlist, auktion, transferliste) havde sin egen kopi af klik-en-header-
// for-at-sortere-logikken. Det betød inkonsistent adfærd og at en kolonne nemt
// kunne ende som en død header (klik gør intet). Denne fil samler:
//   1. cycleSortState — den fælles "klik samme nøgle = vend retning, klik ny
//      nøgle = ny nøgle + start på desc"-cyklus, så ingen side genimplementerer
//      toggle-logikken (og glemmer en gren).
//   2. RIDER_SORT_KEYS — de kerne-attributter der SKAL kunne sorteres alle
//      steder de vises (jf. #1755 universel sortering). Numeriske felter sorterer
//      naturligt desc-først (højest øverst); tekst/navn/nation/type starter asc.
//
// Den faktiske sammenligning lever fortsat i useRiderFilters (server + klient)
// og riderTableSort (filter-løse trup-tabeller) — denne fil ejer KUN sort-STATE
// og hvilke nøgler der er kanoniske, ikke comparator-implementeringerne.

/**
 * Kanoniske, sorterbare rytter-kerneattributter. Bruges til at holde tabeller
 * ærlige (ingen død header) + til mobil-sort-kontrollernes nøgle-sæt. Værdierne
 * matcher de sort-nøgler comparatorerne i useRiderFilters/riderTableSort forstår.
 */
export const RIDER_SORT_KEYS = Object.freeze({
  nation: "nationality_code",
  name: "firstname",
  age: "birthdate",
  type: "primary_type",
  status: "is_u25",
  value: "value",
  salary: "salary",
});

// Tekst-/kategori-nøgler der giver mest mening stigende først (A→Å, ung→gammel
// håndteres i comparatoren). Resten (værdi, løn, evner) er numeriske og starter
// faldende, så "bedst/dyrest øverst" er default-klik.
const ASC_FIRST_KEYS = new Set(["firstname", "nationality_code", "primary_type"]);

/**
 * Standard-retning ved FØRSTE klik på en ny sort-nøgle.
 * @param {string} key
 * @returns {"asc"|"desc"}
 */
export function defaultSortDir(key) {
  return ASC_FIRST_KEYS.has(key) ? "asc" : "desc";
}

/**
 * Den fælles header-klik-cyklus. Returnerer den NYE { sort, dir }-tilstand:
 * - klik på den aktive nøgle → vend retning
 * - klik på en ny nøgle → skift nøgle + start på dens default-retning
 *
 * Ren funktion (muterer intet), så hver side kan kalde den uanset om dens sort-
 * state ligger i useState, i useClientRiderFilters eller i en URL-param.
 *
 * @param {{sort: string, dir: "asc"|"desc"}} current
 * @param {string} key
 * @returns {{sort: string, dir: "asc"|"desc"}}
 */
export function cycleSortState(current, key) {
  if (current?.sort === key) {
    return { sort: key, dir: current.dir === "desc" ? "asc" : "desc" };
  }
  return { sort: key, dir: defaultSortDir(key) };
}
