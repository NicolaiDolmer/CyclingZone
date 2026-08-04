import { ArrowUpIcon, ArrowDownIcon, SortIcon } from "./icons/index.jsx";

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
 * Delt retnings-indikator. Bruges af både SortableTh og den delte Table.Th, så
 * enhver sorterbar kolonne viser samme glyf uanset hvilken tabel-primitiv den
 * er bygget med.
 *
 * #3188: en INAKTIV sorterbar header viste tidligere INTET ikon — kun
 * cursor-pointer + en hover-farve, som er usynlig affordance på touch (ingen
 * hover) og let overses på desktop. Det fik kolonne-headers til at fremstå som
 * "ligner en kontrol, men intet sker" (Clarity dead-click-mistanke på /team,
 * #3188). Nu viser en inaktiv-men-sorterbar kolonne en dæmpet to-vejs-pil
 * (SortIcon, samme mutede tekstfarve som headeren selv — ingen ny farve
 * introduceres); den aktive kolonne viser fortsat den skarpe retningspil
 * (op/ned efter sortDir). Ren tilføjelse — aria-sort/klik-mål er uændret.
 */
export function SortIndicator({ active, dir }) {
  if (!active) {
    return (
      <span className="ms-0.5 inline-flex align-middle">
        <SortIcon size={10} aria-hidden="true" />
      </span>
    );
  }
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
