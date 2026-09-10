import { cellClass } from "./tableStyles.js";
import { SortIndicator } from "./SortableTh.jsx";

export function Table({ className = "", children, ...rest }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse ${className}`} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function Tr({ className = "", children, ...rest }) {
  return (
    <tr className={`group transition-colors duration-150 hover:bg-cz-subtle ${className}`} {...rest}>
      {children}
    </tr>
  );
}

// Th — statisk header som standard. Angiv sortKey + sort + sortDir + onSort for
// at gøre den til en klikbar, sorterbar header med samme retnings-indikator og
// aria-sort som den kanoniske SortableTh (så en <Table>-baseret tabel kan
// sortere uden at skifte til rå <table>/<SortTh>). Uden onSort er adfærden
// uændret — eksisterende ikke-sorterbare headers rører intet.
export function Th({ numeric = false, sticky = false, sortKey, sort, sortDir, onSort, className = "", children, ...rest }) {
  const sortable = typeof onSort === "function" && sortKey != null;
  const active = sortable && sort === sortKey;
  // #5060: den table-lokale z-skala (#2952), ikke page-chrome-skalaens
  // `z-sticky` (1100). En tabelcelle skal aldrig kunne male sig oven paa en
  // dropdown (1000), og hjoernecellen skal ligge over baade den oevrige
  // overskriftsraekke og kroppens pinnede kolonne.
  const stickyCls = sticky ? "sticky left-0 z-table-corner cz-pinned-rule-end" : "";
  const sortableCls = sortable
    ? `cursor-pointer select-none transition-colors ${active ? "text-cz-accent-t/80" : "hover:text-cz-2"}`
    : "";
  return (
    <th
      className={`${cellClass({ numeric, header: true })} bg-cz-subtle ${stickyCls} ${sortableCls} ${className}`}
      onClick={sortable ? () => onSort(sortKey) : undefined}
      aria-sort={sortable ? (active ? (sortDir === "desc" ? "descending" : "ascending") : "none") : undefined}
      {...rest}
    >
      {children}
      {sortable && <SortIndicator active={active} dir={sortDir} />}
    </th>
  );
}

export function Td({ numeric = false, sticky = false, className = "", children, ...rest }) {
  // #5060: se Th ovenfor — kroppens pinnede kolonne hoerer i `z-table-col`,
  // under overskriftsraekken.
  const stickyCls = sticky ? "sticky left-0 z-table-col cz-pinned-rule-end bg-cz-card group-hover:bg-cz-subtle" : "";
  return (
    <td className={`${cellClass({ numeric })} ${stickyCls} ${className}`} {...rest}>
      {children}
    </td>
  );
}

export function JerseyDot({ color = "#888", title, className = "" }) {
  return (
    <span
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      title={title}
      className={`inline-block h-2.5 w-2.5 rounded-cz-pill ring-1 ring-cz-border ${className}`}
      style={{ backgroundColor: color }}
    />
  );
}
