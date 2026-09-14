// #5124 — D-047 (docs/design/gdd/DECISIONS.md, #5102) for HÅNDRULLEDE tabeller.
//
// DataTable.jsx bygger D-047 (navn + tre faste kolonner, chip-bytte, "Fuld
// tabel" som to-lags) på sin egen kolonne→celle-render-model. Auktioner,
// Transferlisten og Daglig træning kan IKKE bruge <DataTable> direkte (#5124's
// ejerskabs-note): rækkerne bærer multi-select-checkbokse, gruppe-header-rækker
// og/eller en udvidelig underrække, som DataTable's 1-række-pr-row-model ikke
// understøtter. Denne fil er derfor IKKE en ny mobilstandard — den er de SAMME
// primitiver som DataTable bruger (mobileTableColumns.ts, uændret, importeret
// begge steder), pakket ud som en genbrugelig hook + chip-komponent, så disse
// sider kan bygge D-047's chip-adfærd oven på deres egen <tr>-markup i stedet
// for at opfinde en ny mobilmekanik (jf. #5124's regel: "genbrug mønsteret,
// opfind ikke et nyt"). De ~40 linjer React-state-wiring nedenfor er en bevidst
// duplikering af DataTable.jsx linje 106-171 — selve ALGORITMEN (hvilke tre
// kolonner, FIFO-bytte, chip-frysning) bor udelukkende i mobileTableColumns.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TableIcon } from "./icons/index.jsx";
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

export { MOBILE_COLUMN_COUNT };

/**
 * Samme state-mekanik som DataTable.jsx: læs gemt kolonnevalg efter mount,
 * frys chip-rækkens orden pr. åbning, FIFO-bytte pr. tryk, "Fuld tabel" som en
 * lokal boolean. `columns` er `MobileColumnLike[]` (key/sticky/fold/numeric) —
 * en side der har brug for widgets i cellerne (knapper, badges) sender selv
 * `render` via sin egen kolonnedefinition og bruger kun `key` herfra til at
 * afgøre synlighed.
 */
export function useMobileTableColumns(columns, mobileDefaults = null) {
  const swappable = mobileSwappableColumns(columns);
  const [selected, setSelected] = useState(() => defaultMobileColumnKeys(columns, mobileDefaults));
  const [fullTable, setFullTable] = useState(false);
  const [chipOrder, setChipOrder] = useState(() =>
    orderMobileChips(columns, defaultMobileColumnKeys(columns, mobileDefaults)).map((c) => c.key)
  );

  const latestRef = useRef({ columns, mobileDefaults });
  useEffect(() => {
    latestRef.current = { columns, mobileDefaults };
  });

  const columnSignature = mobileColumnsSignature(columns);
  const defaultsSignature = (mobileDefaults ?? []).join("|");

  useEffect(() => {
    const latest = latestRef.current;
    const stored = readMobileColumnKeys(latest.columns, latest.mobileDefaults);
    setSelected(stored);
    setChipOrder(orderMobileChips(latest.columns, stored).map((c) => c.key));
  }, [columnSignature, defaultsSignature]);

  const pick = useCallback((key) => {
    setSelected((current) => {
      const next = swapMobileColumn(current, key);
      writeMobileColumnKeys(latestRef.current.columns, next);
      return next;
    });
  }, []);

  const hasChips = swappable.length > MOBILE_COLUMN_COUNT;
  const visibleColumns = hasChips && !fullTable ? orderMobileColumns(columns, selected) : swappable;

  return {
    selectedKeys: selected,
    pick,
    fullTable,
    toggleFullTable: () => setFullTable((v) => !v),
    setFullTable,
    hasChips,
    visibleColumns,
    visibleKeys: visibleColumns.map((c) => c.key),
    chipColumns: applyMobileChipOrder(columns, chipOrder),
  };
}

// Samme visuelle recipe som DataTable's private MobileColumnChips (text-2xs
// uppercase pille, hairline, aktiv = --text-1-kant; "Fuld tabel" neutral,
// aldrig gold — TASTE §3/D-047). Genbruger common.json's `table.*`-nøgler,
// samme tre der allerede findes til DataTable, så der ikke skal duplikeres copy.
// #5124 — samme "Fuld tabel"-knap som MobileColumnChips bærer, men standalone
// for tabeller der ikke swapper mellem alternative 3-kolonnesæt (Transferlisten/
// Auktioner: de tre altid-synlige kolonner er FASTE — værdi, pris, handling —
// og "Fuld tabel" afslører i stedet de mange evne-/bud-kolonner der ellers ville
// tvinge siden til vandret scroll). Samme visuelle sprog (TASTE §3: neutral,
// aldrig gold), så et view der bruger denne og et der bruger MobileColumnChips
// ikke kan se ud som to forskellige mekanikker.
export function FullTableToggle({ fullTable, onToggle }) {
  const { t } = useTranslation("common");
  const base =
    "flex-none inline-flex items-center gap-1.5 rounded-cz-pill border px-2.5 min-h-[32px] " +
    "font-data text-2xs font-semibold uppercase tracking-[.06em] transition-colors duration-150";
  return (
    <div className="mb-2 flex justify-end">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={fullTable}
        className={`${base} ${fullTable ? "border-cz-1 bg-cz-1 text-cz-card" : "border-cz-1 text-cz-1"}`}
      >
        <TableIcon size={14} aria-hidden="true" />
        {t("table.fullTable")}
      </button>
    </div>
  );
}

export function MobileColumnChips({ columns, selected, onPick, fullTable, onToggleFullTable }) {
  const { t } = useTranslation("common");
  const base =
    "flex-none inline-flex items-center gap-1.5 rounded-cz-pill border px-2.5 min-h-[32px] " +
    "font-data text-2xs font-semibold uppercase tracking-[.06em] transition-colors duration-150";
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto" role="group" aria-label={t("table.columnsLabel")}>
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
