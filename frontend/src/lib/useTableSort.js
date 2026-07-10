import { useState, useCallback, useMemo } from "react";
import { cycleSortState } from "./riderSort.js";

// useTableSort — den delte, domæne-neutrale klient-sortering for enhver tabel
// der IKKE allerede kører gennem rytter-filtrene (useRiderFilters). Baggrund:
// hver nye tabel genopfandt "klik-header → sortér"-logikken (og glemte tit
// halvdelen af kolonnerne). Denne hook + den kanoniske SortableTh + guard-testen
// (tableSortIntent.test.js) gør sortering til standardvejen: giv den rækker +
// en accessor pr. sorterbar nøgle, og den ejer state, klik-cyklus og selve
// sorteringen. Klik-cyklussen er PRÆCIS den samme (cycleSortState) som rytter-
// tabellerne, så adfærden er ens på tværs af hele siden.

function isNil(v) {
  return v == null || v === "";
}

// Default-sammenligning for TO ikke-tomme værdier: tal numerisk, alt andet som
// lokaliseret streng med numerisk-bevidst kollation ("10" > "9"). Tom/null
// håndteres IKKE her (se sortRows) — det skal ske uden for retnings-faktoren,
// ellers vender desc tomme celler op i toppen.
function compareValues(a, b) {
  const aNil = isNil(a);
  const bNil = isNil(b);
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Ren, stabil sortering. Udskilt fra hooken så adfærden kan unit-testes uden
 * React-render. Muterer aldrig `rows`; ukendt/manglende accessor → uændret
 * rækkefølge.
 * @template T
 * @param {T[]} rows
 * @param {((row: T) => unknown)|null|undefined} accessor
 * @param {"asc"|"desc"} dir
 * @returns {T[]}
 */
export function sortRows(rows, accessor, dir) {
  if (typeof accessor !== "function") return rows;
  const factor = dir === "desc" ? -1 : 1;
  // Stabil: sortér en indekseret kopi og fald tilbage på original-index ved
  // lige værdier, så rækker med samme sort-værdi ikke hopper rundt.
  return rows
    .map((row, i) => [row, accessor(row), i])
    .sort((a, b) => {
      const [, av, ai] = a;
      const [, bv, bi] = b;
      // Tomme/null-værdier ALTID sidst — uafhængigt af retning, så en desc-sort
      // ikke skubber tomme celler op i toppen.
      const aNil = isNil(av);
      const bNil = isNil(bv);
      if (aNil || bNil) {
        if (aNil && bNil) return ai - bi;
        return aNil ? 1 : -1;
      }
      const cmp = compareValues(av, bv);
      return cmp !== 0 ? factor * cmp : ai - bi;
    })
    .map(([row]) => row);
}

/**
 * Kun sort-STATE + klik-cyklus. Kald denne øverst i en komponent (fx sider der
 * udleder deres rækker EFTER en tidlig `return` og derfor ikke kan give rows til
 * useTableSort ved hook-tid). Kombinér med den rene sortRows nede i render:
 *   const { sort, sortDir, handleSort } = useSortState();
 *   const sorted = sortRows(rows, sort ? ACCESSORS[sort] : null, sortDir);
 * @param {object} [opts]
 * @param {string|null} [opts.initialSort]  Aktiv nøgle ved mount (default: ingen).
 * @param {"asc"|"desc"} [opts.initialDir]  Retning ved mount (default: "desc").
 * @param {Set<string>} [opts.descFirstKeys]  Nøgler der starter faldende ved
 *   første klik (typisk numeriske kolonner). Uden dette bruges rytter-defaulten.
 * @returns {{sort: string|null, sortDir: "asc"|"desc", handleSort: (key: string) => void}}
 */
export function useSortState({ initialSort = null, initialDir = "desc", descFirstKeys } = {}) {
  const [state, setState] = useState({ sort: initialSort, dir: initialDir });
  const handleSort = useCallback(
    (key) => setState((cur) => cycleSortState(cur, key, descFirstKeys)),
    [descFirstKeys],
  );
  return { sort: state.sort, sortDir: state.dir, handleSort };
}

/**
 * Bekvemmeligheds-hook: sort-state + sorteret kopi i ét. Brug når rækkerne ER
 * tilgængelige ved hook-tid (ingen tidlig return imellem). Ellers: useSortState
 * + sortRows.
 * @template T
 * @param {T[]} rows  Rækkerne der skal vises (muteres aldrig).
 * @param {Record<string, (row: T) => unknown>} accessors  sortKey → værdi-udtræk.
 *   Definér denne som en modul-konstant eller useMemo — en inline-ny reference
 *   pr. render tvinger en unødig re-sort (men er ellers harmløs).
 * @param {object} [opts]  Samme options som useSortState (initialSort/initialDir/
 *   descFirstKeys). Udelad for "ingen aktiv sortering" ved mount.
 * @returns {{rows: T[], sort: string|null, sortDir: "asc"|"desc", handleSort: (key: string) => void}}
 */
export function useTableSort(rows, accessors, opts) {
  const { sort, sortDir, handleSort } = useSortState(opts);
  const sortedRows = useMemo(
    () => sortRows(rows, sort ? accessors?.[sort] : null, sortDir),
    [rows, accessors, sort, sortDir],
  );
  return { rows: sortedRows, sort, sortDir, handleSort };
}

// Eksponeret til test + genbrug.
export { compareValues };
