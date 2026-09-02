import { SortIndicator } from "./SortableTh.jsx";
import { WRAP, SCROLLER, TABLE, COUNT, thClass, tdClass, mergeRowProps, zonePillClass } from "./dataTableStyles.js";
import { TableRowContext } from "./tableRowContext.js";

// #2849 bølge 0 — DEN kanoniske wide-data-tabel (T2, docs/design/PAGE_TEMPLATES.md).
//
// Kolonne-def: {
//   key,          // felt-nøgle; default-celleindhold er row[key]
//   header,       // header-label
//   numeric,      // true → højrestillet font-data tabular
//   compact,      // true → halv vandret gutter (px-2); til smalle ét-tals-kolonner
//   tight,        // true → mindste gutter (px-1); til en MATRIX af tal-celler (de 15 evner)
//   sticky,       // true → pinned første kolonne (opak bg + 1px højre-rule)
//   render,       // (row, i) => node — celleindhold
//   subline,      // kun sticky: (row, i) => node — text-3xs uppercase underlinje
//   sublineIndent,// kun sticky: true → pl-[17px] så underlinjen flugter forbi JerseyDot
//   fold,         // true → skjules ≤640px og foldes ind i sticky-cellens underlinje
//   foldValue,    // (row) => string — tekstværdi til mobil-fold (default row[key])
//   sortKey,      // gør headeren sorterbar når onSort er sat
// }
//
// rowZone(row, i) => "success" | "danger" | null styrer zone-row-tints; 2px
// separatorer beregnes automatisk på zone-grænserne (ikke mod tabellens kant).
//
// rowProps(row, i) => { ref?, onClick?, className?, ...andre <tr>-props } — valgfrit
// per-række-hook (#2849 bølge 1). className KONKATENERES EFTER den zone-afledte
// klasse (så caller-klasser, fx en selektions-ring, kan style oven på zone-tint/
// hover); øvrige props (ref, onClick, data-*, …) spredes uændret på <tr>.
// `dense` (#2906): halveret lodret cellepolstring for tabeller hvor antallet af
// rækker pr. skærm er pointen (truppen: 30 ryttere). Default = T2's 13px-rytme.
export function DataTable({
  columns,
  rows,
  rowKey,
  rowZone = null,
  rowProps = null,
  sort,
  sortDir,
  onSort,
  count = null,
  label,
  className = "",
  dense = false,
}) {
  const zones = rows.map((row, i) => (rowZone ? rowZone(row, i) : null));
  const foldCols = columns.filter((c) => c.fold);

  // #4625 (slice 3 af #4622, TASTE fork 6 / P10) — pinned navnekolonne + vandret
  // scroll er DEN vedtagne mobil-standard for T2 (Traeningssiden havde moensteret
  // allerede; audit 2026-09 fandt 6 sider uden det: Ryttere, Mit hold, /teams/:id,
  // /managers/:teamId, /auctions/history, /admin/feedback). SCROLLER er allerede
  // ubetinget "overflow-x-auto"; det eneste en tabel kan glemme er selve pin'et.
  // Dev-warning (ikke kast — DataTable bruges af snesevis af sider der endnu ikke
  // er migreret) saa nye tabeller ikke stille mister moensteret.
  if (import.meta.env.DEV && rows.length > 0 && !columns.some((c) => c.sticky)) {
    console.error(
      `DataTable "${label ?? "(uden label)"}": ingen kolonne har sticky:true. ` +
        "Mobil-standarden er pinned navnekolonne + vandret scroll under den (docs/design/PAGE_TEMPLATES.md#t2-wide-data-page) — marker entity-navnekolonnen `sticky: true`."
    );
  }

  return (
    <div className={className}>
      <div className={WRAP}>
        <div className={SCROLLER}>
          <table className={TABLE} aria-label={label} data-sortable>
            <thead>
              <tr>
                {columns.map((col) => {
                  const sortable = typeof onSort === "function" && col.sortKey != null;
                  const active = sortable && sort === col.sortKey;
                  const sortableCls = sortable
                    ? `cursor-pointer select-none transition-colors ${active ? "text-cz-accent-t/80" : "hover:text-cz-2"}`
                    : "";
                  return (
                    <th
                      key={col.key}
                      className={`${thClass({ numeric: col.numeric, sticky: col.sticky, compact: col.compact, tight: col.tight, dense })} ${col.fold ? "hidden sm:table-cell" : ""} ${sortableCls}`}
                      onClick={sortable ? () => onSort(col.sortKey) : undefined}
                      aria-sort={
                        sortable
                          ? active
                            ? sortDir === "desc"
                              ? "descending"
                              : "ascending"
                            : "none"
                          : undefined
                      }
                    >
                      {col.header}
                      {sortable && <SortIndicator active={active} dir={sortDir} />}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <TableRowContext.Provider value={true}>
              <tbody>
                {rows.map((row, i) => {
                  const zone = zones[i];
                  const edgeTop = Boolean(zone) && i > 0 && zones[i - 1] !== zone;
                  const edgeBottom = Boolean(zone) && i < rows.length - 1 && zones[i + 1] !== zone;
                  return (
                    <tr key={rowKey ? rowKey(row, i) : i} {...mergeRowProps(zone, rowProps ? rowProps(row, i) : null)}>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`${tdClass({ numeric: col.numeric, sticky: col.sticky, zone, edgeTop, edgeBottom, compact: col.compact, tight: col.tight, dense })} ${col.fold ? "hidden sm:table-cell" : ""}`}
                        >
                          {col.sticky
                            ? renderStickyCell(col, row, i, foldCols)
                            : col.render
                              ? col.render(row, i)
                              : row[col.key]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </TableRowContext.Provider>
          </table>
        </div>
      </div>
      {count && <div className={COUNT}>{count}</div>}
    </div>
  );
}

// Sticky-celle: navnelinje 13.5/500 + text-3xs uppercase underlinje. På mobil
// foldes `fold`-kolonnernes værdier ind forrest i underlinjen (" · "-adskilt).
function renderStickyCell(col, row, i, foldCols) {
  const primary = col.render ? col.render(row, i) : row[col.key];
  const sub = col.subline ? col.subline(row, i) : null;
  const folded = foldCols
    .map((c) => (c.foldValue ? c.foldValue(row) : row[c.key]))
    .filter((v) => v != null && v !== "");
  const indent = col.sublineIndent ? "pl-[17px]" : "";
  return (
    <>
      <span className="flex items-center gap-2 whitespace-nowrap text-[13.5px] font-medium text-cz-1">
        {primary}
      </span>
      {(sub != null || folded.length > 0) && (
        <span
          className={`mt-0.5 block whitespace-nowrap font-data text-3xs uppercase tracking-[.05em] text-cz-3 ${indent}`}
        >
          {folded.length > 0 && (
            <span className="sm:hidden">
              {folded.join(" · ")}
              {sub != null && " · "}
            </span>
          )}
          {sub}
        </span>
      )}
    </>
  );
}

// text-3xs uppercase zone-/status-pill — samme recipe overalt hvor rækker danner
// zoner (standings-zoner, listings der lukker, "New" osv.).
export function ZonePill({ tone = "neutral", className = "", children }) {
  return <span className={`${zonePillClass(tone)} ${className}`}>{children}</span>;
}
