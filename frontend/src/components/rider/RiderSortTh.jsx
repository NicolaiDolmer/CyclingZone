import { ArrowUpIcon, ArrowDownIcon } from "../ui";

// RiderSortTh — én kanonisk sorterbar tabel-header for ALLE rytter-oversigter
// (#1755). Erstatter de fem næsten-ens lokale SortTh-kopier (rytterdatabase,
// eget hold, andre holds trup, watchlist, auktion) der drev fra hinanden: nogle
// brugte ikon-pile, andre tekst-glyfferne ↓/↑. Nu er retnings-indikatoren ens
// alle steder (samme ArrowUp/DownIcon som ranglisten), så en sorterbar kolonne
// ser og opfører sig identisk uanset side.
//
// Prop-formen er bevaret 1:1 fra de gamle lokale kopier (sortKey/sort/sortDir/
// onSort/className/title), så hvert kald-site kan importere denne som `SortTh`
// uden at røre JSX'en — kildetekst-testene (#1537) matcher fortsat <SortTh
// sortKey="...">.
export default function SortTh({ children, sortKey, sort, sortDir, onSort, className = "", title }) {
  const active = sort === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      title={title}
      aria-sort={active ? (sortDir === "desc" ? "descending" : "ascending") : "none"}
      className={`cursor-pointer select-none transition-colors ${active ? "text-cz-accent-t/80" : "text-cz-3 hover:text-cz-2"} ${className}`}
    >
      {children}
      {active && (
        <span className="ms-0.5 inline-flex align-middle">
          {sortDir === "desc"
            ? <ArrowDownIcon size={10} aria-hidden="true" />
            : <ArrowUpIcon size={10} aria-hidden="true" />}
        </span>
      )}
    </th>
  );
}
