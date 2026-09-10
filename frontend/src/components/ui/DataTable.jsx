import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SortIndicator } from "./SortableTh.jsx";
import { WRAP, SCROLLER, MOBILE_SCROLLER, TABLE, COUNT, thClass, tdClass, mergeRowProps, zonePillClass } from "./dataTableStyles.js";
import { TableRowContext } from "./tableRowContext.js";
import { ChevronRightIcon, TableIcon } from "./icons/index.jsx";
import { useIsMobileViewport } from "../../hooks/useMediaQuery.ts";
import {
  MOBILE_COLUMN_COUNT,
  applyMobileChipOrder,
  defaultMobileColumnKeys,
  mobileColumnLabel,
  mobileColumnsSignature,
  mobileSwappableColumns,
  orderMobileChips,
  orderMobileColumns,
  readMobileColumnKeys,
  swapMobileColumn,
  writeMobileColumnKeys,
} from "./mobileTableColumns.ts";

// #2849 bølge 0 — DEN kanoniske wide-data-tabel (T2, docs/design/PAGE_TEMPLATES.md).
//
// Kolonne-def: {
//   key,          // felt-nøgle; default-celleindhold er row[key]
//   header,       // header-label
//   numeric,      // true → højrestillet font-data tabular
//   compact,      // true → halv vandret gutter (px-2); til smalle ét-tals-kolonner
//   tight,        // true → mindste gutter (px-1); til en MATRIX af tal-celler (de 15 evner)
//   sticky,       // true → entity-/navnekolonnen (desktop: pinned; mobil: navneblok)
//   render,       // (row, i) => node — celleindhold
//   subline,      // kun sticky: (row, i) => node — text-3xs uppercase underlinje
//   sublineIndent,// kun sticky: true → pl-[17px] så underlinjen flugter forbi JerseyDot
//   fold,         // true → skjules ≤640px og foldes ind i sticky-cellens underlinje
//   foldValue,    // (row) => string — tekstværdi til mobil-fold (default row[key])
//   mobileLabel,  // chip-label på mobil når `header` ikke er ren tekst
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
//
// ── Mobil ≤640px: D-047 (ejer 10/9 kl. 15:20, #5102) ────────────────────────
// Standardtilstanden er navnekolonnen + PRÆCIS tre datakolonner UDEN vandret
// scroll. En chip-række over tabellen bytter kolonner (valget huskes pr.
// KOLONNESÆT, ikke pr. oversat label), og "Fuld tabel" åbner alle kolonner som
// TO-LAGS: navneblokken er sin egen kolonne ved siden af en scrollbar datablok —
// ikke CSS sticky, så #5060's fejlklasse ikke kan opstå igen. Sortering og
// kolonneorden er desktopens. Sticky-kolonne + vandret scroll som DEFAULT er
// dermed væk (afløser TASTE P10 fork 6 / PAGE_TEMPLATES T2 "Mobile ≤640px").
// Desktop er uændret.
//
//   mobileDefaults: ["ovr", "value", "salary"]  // sidens tre standardkolonner
//
// "Ingen vandret scroll" er HÅNDHÆVET, ikke håbet: standardtilstanden ligger i
// MOBILE_SCROLLER (overflow-x: hidden), og navnecellen wrapper i stedet for at
// stå på én nowrap-linje, så et langt rytternavn eller et 8-cifret beløb bliver
// to linjer i stedet for at skubbe tabellen ud over 375px.
//
// TASTE §3 (ejerens AI-slop-krav i D-047): ingen gradienter, ingen skygger,
// ingen rå hex — og "Fuld tabel" er en NEUTRAL kontrol, aldrig gold: guld er
// sidens ene primary, og en kolonne-kontrol er ikke sidens primære handling.
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
  toolbar = null,
  empty = null,
  mobileDefaults = null,
}) {
  const { t } = useTranslation("common");
  const isMobile = useIsMobileViewport();
  const zones = rows.map((row, i) => (rowZone ? rowZone(row, i) : null));
  const foldCols = columns.filter((c) => c.fold);
  const entityCol = columns.find((c) => c.sticky) ?? null;
  const swappable = mobileSwappableColumns(columns);

  // #4625 → D-047: navnekolonnen er stadig den kolonne alt andet hænger på —
  // uden den ved mobil-standarden ikke hvad navneblokken er, og tabellen falder
  // tilbage til den gamle vandrette scroller. Dev-warning (ikke kast — DataTable
  // bruges af snesevis af sider) så nye tabeller ikke stille mister mønsteret.
  if (import.meta.env.DEV && rows.length > 0 && !entityCol) {
    console.error(
      `DataTable "${label ?? "(uden label)"}": ingen kolonne har sticky:true. ` +
        "Mobil-standarden (D-047, #5102) bygger paa en entity-/navnekolonne — marker den `sticky: true` " +
        "(docs/design/PAGE_TEMPLATES.md#t2-wide-data-page)."
    );
  }

  const [mobileKeys, setMobileKeys] = useState(() => defaultMobileColumnKeys(columns, mobileDefaults));
  const [fullTable, setFullTable] = useState(false);
  // En `mobileDefaults`-nøgle der peger på en fold- eller sticky-kolonne (eller
  // på en kolonne der er blevet omdøbt) bliver STILLE kasseret, og pladsen
  // fyldes af den første numeriske kolonne i stedet. Akademiet ramte præcis det
  // (`value` er `fold: true` dér), og ingen kunne se det uden at tælle
  // kolonner i en telefon. Dev-warning, ikke kast — samme linje som ovenfor.
  if (import.meta.env.DEV && mobileDefaults) {
    const valid = new Set(swappable.map((c) => c.key));
    const unknown = mobileDefaults.filter((key) => !valid.has(key));
    if (unknown.length > 0) {
      console.error(
        `DataTable "${label ?? "(uden label)"}": mobileDefaults ${JSON.stringify(unknown)} findes ikke som ` +
          "byttebare kolonner (fold/sticky-kolonner kan ikke vaere standardkolonner) og ignoreres. " +
          "Refs #5102."
      );
    }
  }

  // Kolonnesættets IDENTITET (nøgler + sticky/fold-roller), ikke de nye
  // array-referencer hver render. Den er også localStorage-nøglens grundlag, så
  // en closure der er fanget på denne signatur kan aldrig skrive til en anden
  // nøgle end den nuværende render ville.
  const columnSignature = mobileColumnsSignature(columns);
  const defaultsSignature = (mobileDefaults ?? []).join("|");

  // Chip-rækkens ORDEN fryses pr. kolonnesæt: de valgte først, men KUN som de
  // stod da tabellen åbnede. Rækkefølgen må ikke ændre sig mens fingeren er på
  // skærmen — en række der omarrangerer sig under trykket gør næste tryk på
  // samme sted til et tryk på en anden kolonne (fejlklik-generator på mobil).
  const [chipOrder, setChipOrder] = useState(() =>
    orderMobileChips(columns, defaultMobileColumnKeys(columns, mobileDefaults)).map((c) => c.key)
  );

  // Læs det huskede valg EFTER mount (localStorage er per-browser og må ikke
  // gøre first render afhængig af en I/O der kan kaste i et privat vindue).
  useEffect(() => {
    const stored = readMobileColumnKeys(columns, mobileDefaults);
    setMobileKeys(stored);
    setChipOrder(orderMobileChips(columns, stored).map((c) => c.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kolonne-/defaults-IDENTITET, ikke de nye array-referencer hver render
  }, [columnSignature, defaultsSignature]);

  const pickColumn = useCallback(
    (key) => {
      setMobileKeys((current) => {
        const next = swapMobileColumn(current, key);
        writeMobileColumnKeys(columns, next);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se columnSignature ovenfor
    [columnSignature]
  );

  const mobileStandard = isMobile && Boolean(entityCol);
  const hasChips = mobileStandard && swappable.length > MOBILE_COLUMN_COUNT;
  const visibleMobileCols = hasChips && !fullTable ? orderMobileColumns(columns, mobileKeys) : swappable;

  if (mobileStandard) {
    return (
      <div className={className}>
        {hasChips && (
          <MobileColumnChips
            columns={applyMobileChipOrder(columns, chipOrder)}
            selected={mobileKeys}
            onPick={pickColumn}
            fullTable={fullTable}
            onToggleFullTable={() => setFullTable((v) => !v)}
            t={t}
          />
        )}
        <div className={WRAP}>
          {toolbar && (
            <div className="flex flex-wrap items-center gap-2 border-b border-cz-border px-4 py-2.5">{toolbar}</div>
          )}
          {fullTable ? (
            <MobileFullTable
              entityCol={entityCol}
              dataCols={swappable}
              rows={rows}
              rowKey={rowKey}
              rowProps={rowProps}
              zones={zones}
              foldCols={foldCols}
              sort={sort}
              sortDir={sortDir}
              onSort={onSort}
              label={label}
              dense={dense}
              empty={empty}
              t={t}
            />
          ) : (
            <div className={MOBILE_SCROLLER}>
              <table className={TABLE} aria-label={label} data-sortable>
                <TableHead
                  columns={[entityCol, ...visibleMobileCols]}
                  sort={sort}
                  sortDir={sortDir}
                  onSort={onSort}
                  dense={dense}
                  mobile
                />
                <TableRowContext.Provider value={true}>
                  <tbody>
                    <EmptyRow rows={rows} empty={empty} colSpan={visibleMobileCols.length + 1} />
                    {rows.map((row, i) => {
                      const edges = zoneEdges(zones, i);
                      return (
                        <tr key={rowKey ? rowKey(row, i) : i} {...mergeRowProps(zones[i], rowProps ? rowProps(row, i) : null)}>
                          {/* w-full + max-w-0: navnekolonnen tager den plads der
                              er tilovers og GIVER den fra sig igen naar tallene
                              bliver brede — sammen med `wrap` nedenfor er det
                              det der holder tabellen inden for 375px. */}
                          <td className={`${tdClass({ ...edges, zone: zones[i], compact: true, dense })} w-full max-w-0`}>
                            {renderStickyCell(entityCol, row, i, foldCols, true)}
                          </td>
                          {visibleMobileCols.map((col) => (
                            <td
                              key={col.key}
                              className={tdClass({
                                numeric: col.numeric,
                                zone: zones[i],
                                ...edges,
                                compact: true,
                                tight: col.tight,
                                dense,
                              })}
                            >
                              {col.render ? col.render(row, i) : row[col.key]}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </TableRowContext.Provider>
              </table>
            </div>
          )}
        </div>
        {count && <div className={COUNT}>{count}</div>}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className={WRAP}>
        {/* #4628 (slice 3 af #4622) — tabellens egen kontrol-bjaelke. Kontroller
            der KUN styrer tabellen (gruppe-filtre, visnings-segmenter) laa foer
            som en fritsvaevende raekke mellem sidehovedet og tabellen; det er
            praecis PAGE_TEMPLATES' "no orphan action rows" og audit 2026-09's
            fund paa Mit hold. Inde i tabellens hairline-ramme, adskilt af den
            samme 1px-regel som headeren, hoerer de synligt til tabellen. */}
        {toolbar && (
          <div className="flex flex-wrap items-center gap-2 border-b border-cz-border px-4 py-2.5">
            {toolbar}
          </div>
        )}
        <div className={SCROLLER}>
          <table className={TABLE} aria-label={label} data-sortable>
            <TableHead columns={columns} sort={sort} sortDir={sortDir} onSort={onSort} dense={dense} />
            <TableRowContext.Provider value={true}>
              <tbody>
                {/* PAGE_TEMPLATES "Canonical states": for tabeller swappes
                    <tbody>, ikke hele kortet — headeren og toolbaren bliver
                    monteret. #4628: uden det forsvandt filter-kontrollerne
                    sammen med raekkerne, saa et filter der tømte tabellen ikke
                    kunne slaas fra igen. */}
                <EmptyRow rows={rows} empty={empty} colSpan={columns.length} />
                {rows.map((row, i) => {
                  const edges = zoneEdges(zones, i);
                  return (
                    <tr key={rowKey ? rowKey(row, i) : i} {...mergeRowProps(zones[i], rowProps ? rowProps(row, i) : null)}>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`${tdClass({ numeric: col.numeric, sticky: col.sticky, zone: zones[i], ...edges, compact: col.compact, tight: col.tight, dense })} ${col.fold ? "hidden sm:table-cell" : ""}`}
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

function zoneEdges(zones, i) {
  const zone = zones[i];
  return {
    edgeTop: Boolean(zone) && i > 0 && zones[i - 1] !== zone,
    edgeBottom: Boolean(zone) && i < zones.length - 1 && zones[i + 1] !== zone,
  };
}

function EmptyRow({ rows, empty, colSpan }) {
  if (rows.length > 0 || !empty) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="border-t border-cz-border p-4">
        {empty}
      </td>
    </tr>
  );
}

// Delt <thead>. `mobile` slaar fold-skjulet fra (mobil-standarden vaelger selv
// hvilke kolonner der vises) og `stickyHeader:false` bruges af to-lags-
// tilstanden, hvor to separate tabeller skal have PRAECIS samme header-adfaerd.
function TableHead({ columns, sort, sortDir, onSort, dense, mobile = false, stickyHeader = true }) {
  return (
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
              // mobile ⇒ compact gutter (px-2) på ALLE celler: på 393px er de
              // 16px ekstra pr. kolonne forskellen på at tabellen passer og på
              // at den skubber sig selv ud over kanten (målt, ikke gættet).
              className={`${thClass({ numeric: col.numeric, sticky: !mobile && col.sticky, compact: mobile || col.compact, tight: col.tight, dense, stickyHeader })} ${!mobile && col.fold ? "hidden sm:table-cell" : ""} ${sortableCls}`}
              onClick={sortable ? () => onSort(col.sortKey) : undefined}
              aria-sort={
                sortable ? (active ? (sortDir === "desc" ? "descending" : "ascending") : "none") : undefined
              }
            >
              {col.header}
              {sortable && <SortIndicator active={active} dir={sortDir} />}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

// D-047's chip-raekke. text-2xs uppercase som al anden meta i systemet, hairline
// og 999px-pille (den ENE plads hvor pille-radius er tilladt, TASTE fork 6).
// Aktiv kolonne = --text-1-kant.
//
// "Fuld tabel" er NEUTRAL (--text-1), aldrig gold: TASTE P3 giver hvert view
// PRAECIS EEN gold primary, og paa hver af de sider tabellen bor paa er den
// allerede brugt (auktions-banneret paa Mit hold, saldoen, den aktive fane).
// En kolonne-kontrol er heller ikke sidens primaere handling. Derfor er der
// ingen tone-prop at saette forkert.
//
// Raekken har hverken maske, gradient eller skygge (TASTE §3): den halvt
// synlige chip i hoejre kant ER affordancen, praecis som i en hvilken som helst
// vandret chip-raekke paa en telefon. Ordenen er FRYSSET af DataTable, saa et
// tryk aldrig flytter chippen under fingeren; derfor ruller raekken heller ikke
// tilbage til start af sig selv.
function MobileColumnChips({ columns, selected, onPick, fullTable, onToggleFullTable, t }) {
  const base =
    "flex-none inline-flex items-center gap-1.5 rounded-cz-pill border px-2.5 min-h-[32px] " +
    "font-data text-2xs font-semibold uppercase tracking-[.06em] transition-colors duration-150";
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <div
        className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto"
        role="group"
        aria-label={t("table.columnsLabel")}
      >
        {columns.map((col) => {
          const active = selected.includes(col.key);
          return (
            <button
              key={col.key}
              type="button"
              onClick={() => onPick(col.key)}
              aria-pressed={active}
              disabled={fullTable}
              className={`${base} ${
                active ? "border-cz-1 text-cz-1" : "border-cz-border text-cz-2 hover:text-cz-1"
              } ${fullTable ? "opacity-40" : ""}`}
            >
              {mobileColumnLabel(col)}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onToggleFullTable}
        aria-pressed={fullTable}
        className={`${base} ${fullTable ? "border-cz-1 bg-cz-1 text-cz-card" : "border-cz-1 text-cz-1"}`}
      >
        <TableIcon size={14} aria-hidden="true" />
        {t("table.fullTable")}
      </button>
    </div>
  );
}

// To-lags "Fuld tabel" (D-047): navneblokken er sin EGEN tabel ved siden af en
// vandret scrollbar datablok. Ikke CSS sticky — #5060 viste at en sticky kolonne
// over en scroller er den skroebelige del. Prisen er at raekkehoejderne skal
// synkroniseres i JS; det er en maaling, ikke et layout-hack, og den koerer kun
// paa mobil.
function MobileFullTable({
  entityCol,
  dataCols,
  rows,
  rowKey,
  rowProps,
  zones,
  foldCols,
  sort,
  sortDir,
  onSort,
  label,
  dense,
  empty,
  t,
}) {
  const nameRef = useRef(null);
  const dataRef = useRef(null);
  const scrollerRef = useRef(null);
  // To-lags-tilstanden splitter en raekke over to tabeller. Uden en eksplicit
  // kobling mister datablokkens raekke sit navn — baade for skaermlaesere og for
  // enhver "find raekken der hedder X"-logik. Navnecellen faar et id, og
  // datablokkens <tr> peger paa det med aria-labelledby.
  const uid = useId();
  const nameCellId = (i) => `${uid}-name-${i}`;
  const [headerHeight, setHeaderHeight] = useState(0);
  const [atEnd, setAtEnd] = useState(true);

  // Raekke-IDENTITET, ikke raekke-ANTAL: en sortering, et filter der giver samme
  // antal, eller en async efterfyldning skifter hoejder uden at aendre laengden,
  // og fordi sync() laaser en inline `height` paa hver <tr> aendrer tabellens
  // samlede hoejde sig ikke noedvendigvis — saa ResizeObserver fanger det heller
  // ikke. Signaturen fanger raekkeskift; MutationObserver nedenfor fanger
  // indhold der aendrer sig inde i en uaendret raekke.
  const rowSignature = rows.map((row, i) => (rowKey ? rowKey(row, i) : i)).join("|");

  useLayoutEffect(() => {
    const nameTable = nameRef.current;
    const dataTable = dataRef.current;
    if (!nameTable || !dataTable) return undefined;

    let frame = 0;
    let observer = null;
    const sync = () => {
      const left = Array.from(nameTable.rows);
      const right = Array.from(dataTable.rows);
      const n = Math.min(left.length, right.length);
      for (let i = 0; i < n; i += 1) {
        left[i].style.height = "";
        right[i].style.height = "";
      }
      const heights = [];
      for (let i = 0; i < n; i += 1) {
        heights.push(Math.max(left[i].getBoundingClientRect().height, right[i].getBoundingClientRect().height));
      }
      for (let i = 0; i < n; i += 1) {
        left[i].style.height = `${heights[i]}px`;
        right[i].style.height = `${heights[i]}px`;
      }
      setHeaderHeight(heights[0] ?? 0);
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };

    sync();
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(schedule);
      observer.observe(nameTable);
      observer.observe(dataTable);
    }
    // Indhold der aendrer sig INDE i en uaendret raekke (scouting-stjerner der
    // lander, en styrke der bliver hentet) aendrer ikke tabellens maalte hoejde,
    // fordi raekkehoejderne er laast inline. Uden denne observer ville de to lag
    // stille glide fra hinanden uden at noget rettede op paa det.
    let mutations = null;
    if (typeof MutationObserver !== "undefined") {
      mutations = new MutationObserver(schedule);
      const opts = { childList: true, subtree: true, characterData: true };
      mutations.observe(nameTable, opts);
      mutations.observe(dataTable, opts);
    }
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      mutations?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [rowSignature, dataCols.length, dense]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    onScroll();
  }, [onScroll, rowSignature, dataCols.length]);

  const entityLabel = mobileColumnLabel(entityCol);

  return (
    <div className={SCROLLER}>
      <div className="relative flex">
        <div className="flex-none border-r border-cz-border bg-cz-card">
          <table className={TABLE} ref={nameRef} aria-label={`${label ?? ""} · ${entityLabel}`.trim()} data-sortable>
            <TableHead
              columns={[entityCol]}
              sort={sort}
              sortDir={sortDir}
              onSort={onSort}
              dense={dense}
              mobile
              stickyHeader={false}
            />
            <TableRowContext.Provider value={true}>
              <tbody>
                <EmptyRow rows={rows} empty={empty} colSpan={1} />
                {rows.map((row, i) => (
                  <tr key={rowKey ? rowKey(row, i) : i} {...mergeRowProps(zones[i], rowProps ? rowProps(row, i) : null)}>
                    <td id={nameCellId(i)} className={tdClass({ zone: zones[i], ...zoneEdges(zones, i), dense })}>
                      {renderStickyCell(entityCol, row, i, foldCols)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableRowContext.Provider>
          </table>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto" ref={scrollerRef} onScroll={onScroll}>
          <table className={`${TABLE} w-max min-w-full`} ref={dataRef} aria-label={label} data-sortable>
            <TableHead
              columns={dataCols}
              sort={sort}
              sortDir={sortDir}
              onSort={onSort}
              dense={dense}
              mobile
              stickyHeader={false}
            />
            <TableRowContext.Provider value={true}>
              <tbody>
                {/* Navneblokken faar den rigtige tomme tilstand; datablokken
                    faar en TOM modsvarende raekke, saa de to lag har lige mange
                    <tr> og hoejde-synkroniseringen ogsaa rammer tom-raekken. */}
                <EmptyRow rows={rows} empty={empty ? <span aria-hidden="true">&nbsp;</span> : null} colSpan={dataCols.length} />
                {rows.map((row, i) => {
                  const edges = zoneEdges(zones, i);
                  return (
                    <tr
                      key={rowKey ? rowKey(row, i) : i}
                      aria-labelledby={nameCellId(i)}
                      {...mergeRowProps(zones[i], rowProps ? rowProps(row, i) : null)}
                    >
                      {dataCols.map((col) => (
                        <td
                          key={col.key}
                          className={tdClass({
                            numeric: col.numeric,
                            zone: zones[i],
                            ...edges,
                            compact: col.compact,
                            tight: col.tight,
                            dense,
                          })}
                        >
                          {col.render ? col.render(row, i) : row[col.key]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </TableRowContext.Provider>
          </table>
        </div>
        {/* "Der er mere til hoejre"-mærket. Opak kort-baggrund + hairline mod
            venstre — INGEN gradient og ingen skygge (TASTE §3, ejerens
            AI-slop-krav i D-047). Det staar i header-baandet, hvor cellerne
            alligevel har kort-baggrund, saa en hairline er nok til at skille
            det fra den kolonne der ruller ind under det. */}
        {!atEnd && (
          <div
            className="pointer-events-none absolute right-0 top-0 flex items-center justify-end border-l border-cz-border bg-cz-card px-2 text-cz-3"
            style={headerHeight ? { height: `${headerHeight}px` } : undefined}
            title={t("table.moreRight")}
          >
            <ChevronRightIcon size={14} aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}

// Sticky-celle: navnelinje 13.5/500 + text-3xs uppercase underlinje. På mobil
// foldes `fold`-kolonnernes værdier ind forrest i underlinjen (" · "-adskilt).
//
// `wrap` (mobil-standardtilstanden, D-047): navnet må BRYDE til to linjer i
// stedet for at stå på én nowrap-linje. Det er dét der gør "ingen vandret
// scroll" til en garanti frem for et held: uden det skubber et langt rytternavn
// eller et bredt beløb tabellen ud over 375px, og desktopens scroller ville
// snige sig tilbage ad bagvejen. `min-w-0` er nødvendig, fordi flex-børn ellers
// har `min-width: auto` og nægter at krympe under deres indhold.
function renderStickyCell(col, row, i, foldCols, wrap = false) {
  const primary = col.render ? col.render(row, i) : row[col.key];
  const sub = col.subline ? col.subline(row, i) : null;
  const folded = foldCols
    .map((c) => (c.foldValue ? c.foldValue(row) : row[c.key]))
    .filter((v) => v != null && v !== "");
  const indent = col.sublineIndent ? "pl-[17px]" : "";
  // `break-words`: uden det saetter det laengste ORD i navnet kolonnens
  // min-bredde, og en raekke med en bred handlingsknap kan saa ikke laengere
  // give plads — tabellen bliver bredere end telefonen. Med det kan
  // navnekolonnen altid krympe, og et navn brydes hellere end at tabellen
  // scroller (D-047's raekkefoelge af prioriteter).
  const nowrap = wrap ? "min-w-0 break-words [&>*]:min-w-0" : "whitespace-nowrap";
  return (
    <>
      <span className={`flex items-center gap-2 text-[13.5px] font-medium text-cz-1 ${nowrap}`}>
        {primary}
      </span>
      {(sub != null || folded.length > 0) && (
        <span
          className={`mt-0.5 block font-data text-3xs uppercase tracking-[.05em] text-cz-3 ${wrap ? "" : "whitespace-nowrap"} ${indent}`}
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
