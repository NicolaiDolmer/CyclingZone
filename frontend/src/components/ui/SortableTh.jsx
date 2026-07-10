import { ArrowUpIcon, ArrowDownIcon } from "./icons/index.jsx";

// SortableTh — den ENE kanoniske sorterbare tabel-header for HELE siden.
//
// Baggrund (#1755 → generaliseret): rytter-oversigterne delte allerede én
// header (RiderSortTh), men ikke-rytter-tabeller (træning, manager-profil,
// løbsbibliotek) genopfandt hver deres. Denne komponent er nu domæne-neutral,
// og RiderSortTh re-eksporterer den, så ALLE sorterbare headers — rytter eller
// ej — ser og opfører sig identisk (samme pil-ikon, samme aria-sort, samme
// klik-mål). En ny sorterbar tabel importerer denne og er automatisk i tråd.
//
// Prop-formen er bevaret 1:1 fra RiderSortTh (sortKey/sort/sortDir/onSort/
// className/title), så eksisterende kald-sites + kilde-tekst-testene (#1537)
// matcher fortsat <SortTh sortKey="..."> uændret.

/**
 * Delt retnings-indikator (op/ned-pil). Bruges af både SortableTh og den delte
 * Table.Th, så en aktiv sort-kolonne viser samme glyf uanset hvilken tabel-
 * primitiv den er bygget med.
 */
export function SortIndicator({ active, dir }) {
  if (!active) return null;
  return (
    <span className="ms-0.5 inline-flex align-middle">
      {dir === "desc"
        ? <ArrowDownIcon size={10} aria-hidden="true" />
        : <ArrowUpIcon size={10} aria-hidden="true" />}
    </span>
  );
}

export default function SortableTh({ children, sortKey, sort, sortDir, onSort, className = "", title }) {
  const active = sort === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      title={title}
      aria-sort={active ? (sortDir === "desc" ? "descending" : "ascending") : "none"}
      className={`cursor-pointer select-none transition-colors ${active ? "text-cz-accent-t/80" : "text-cz-3 hover:text-cz-2"} ${className}`}
    >
      {children}
      <SortIndicator active={active} dir={sortDir} />
    </th>
  );
}
