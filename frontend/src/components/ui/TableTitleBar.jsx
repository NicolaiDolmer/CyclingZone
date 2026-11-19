import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { logEvent } from "../../lib/logEvent.js";
import { useModalA11y } from "../../hooks/useModalA11y.js";
import Portal from "./Portal.jsx";
import Input from "./Input.jsx";
import { WRAP } from "./dataTableStyles.js";
import { backdropClass } from "./modalStyles.js";
import { CheckIcon, ChevronDownIcon, FilterIcon, SearchIcon, TableIcon, XIcon } from "./icons/index.jsx";
import { choiceLabel, columnsSummary, tableControlPayload } from "./tableTitleBar.js";

// #8280 (TASTE P21, ejer 19/11) — tabellens titellinje. ÉN linje (min. 44 px)
// inde i tabellens ramme, i stedet for kasse-selects, chip-række og løsrevne
// rækker over tabellen:
//
//   Division 2 ▾ · All ▾ · Standings ▾            ▽  ▦ 3/9  ⌕
//
//  - `choices`: valgene som ORD med en lille pil. Hvert ord er sit eget native
//    <select> (usynligt, lagt over ordet), så valget åbner på tryk og virker med
//    skærmlæser og på Android uden en hjemmelavet menu.
//  - `filters`: alt andet bag ét filter-ikon (ark), med tæller når noget er sat.
//  - `columns`: kolonne-knap (tabel-ikon + "N/M") der åbner et ark.
//  - `search`: yderst til højre; ikon på telefon (folder et felt ud), felt på
//    computer.
//  - `trailing`: stille tabel-handlinger (fx Sammenlign) på computeren.
// Ingen guld: en kontrol over en tabel er ikke sidens primære handling (TASTE P3).
// Ingen skygge, ingen pille-radius, hairlines.
//
// `framed` giver linjen sin egen ramme (til loading/tom-tilstand uden for en
// DataTable), så kontrollerne aldrig forsvinder sammen med rækkerne.
const ICON_BTN =
  "relative inline-flex h-11 min-w-11 flex-none items-center justify-center gap-1.5 rounded-cz px-2 " +
  "text-cz-2 transition-colors duration-150 hover:text-cz-1 sm:h-9 sm:min-w-9";

export default function TableTitleBar({
  page,
  choices = /** @type {any[]} */ ([]),
  filters = /** @type {any} */ (null),
  columns = /** @type {any} */ (null),
  search = /** @type {any} */ (null),
  trailing = /** @type {any} */ (null),
  framed = false,
  tour = /** @type {string | undefined} */ (undefined),
  className = "",
}) {
  const { t } = useTranslation("common");
  const [sheet, setSheet] = useState(/** @type {string | null} */ (null)); // "filters" | "columns" | null
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const loggedRef = useRef(new Set());

  // Én hændelse pr. kontrol pr. besøg på siden: formålet er at se HVILKE
  // kontroller der bruges (så standardvalg kan afgøres ud fra brug), ikke at
  // tælle hvert tryk. Kun side + kontrolnavn sendes, aldrig værdier.
  function track(control, item = null) {
    const id = `${control}:${item ?? ""}`;
    if (loggedRef.current.has(id)) return;
    loggedRef.current.add(id);
    logEvent("table_control_used", tableControlPayload(page, control, item));
  }

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const hasSearchValue = Boolean(search?.value);
  const filterCount = filters?.count ?? 0;

  const bar = (
    <div
      data-testid="table-title-bar"
      data-tour={tour}
      className={`flex min-h-11 items-center gap-x-1 border-b border-cz-border px-3 sm:px-4 ${className}`}
    >
      {/* Telefon: åbent søgefelt overtager hele linjen, så højden aldrig vokser. */}
      {search && searchOpen && (
        <div className="flex w-full items-center gap-2 sm:hidden">
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cz-3"
            />
            <Input
              ref={searchRef}
              type="search"
              size="sm"
              value={search.value}
              onChange={(e) => {
                track("search");
                search.onChange(e);
              }}
              placeholder={search.placeholder}
              aria-label={search.ariaLabel ?? search.placeholder}
              className="pl-8"
            />
          </div>
          <button
            type="button"
            className={ICON_BTN}
            aria-label={t("table.titleBar.closeSearch")}
            onClick={() => setSearchOpen(false)}
          >
            <XIcon size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className={`flex min-w-0 flex-1 items-center gap-x-1 ${search && searchOpen ? "max-sm:hidden" : ""}`}>
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          {choices.map((choice, index) => (
            <span key={choice.key} className="flex min-w-0 shrink items-center">
              {index > 0 && (
                <span aria-hidden="true" className="px-0.5 text-cz-3">
                  ·
                </span>
              )}
              <label className="relative inline-flex h-11 min-w-0 cursor-pointer items-center gap-1 rounded-cz px-1.5 text-[13.5px] font-medium text-cz-1 has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-[-2px] has-[select:focus-visible]:outline-cz-accent-t sm:h-9">
                <span className="truncate">{choiceLabel(choice)}</span>
                <ChevronDownIcon size={12} aria-hidden="true" className="flex-none text-cz-3" />
                <select
                  aria-label={choice.ariaLabel}
                  value={choice.value}
                  onChange={(e) => {
                    track(`choice:${choice.key}`);
                    choice.onChange(e);
                  }}
                  className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 focus-visible:outline-hidden"
                >
                  {choice.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </span>
          ))}
        </div>

        {trailing && <div className="hidden flex-none items-center gap-2 sm:flex">{trailing}</div>}

        {filters && (
          <button
            type="button"
            className={`${ICON_BTN} ${filterCount > 0 ? "text-cz-1" : ""}`}
            aria-label={filters.label ?? t("table.titleBar.filters")}
            aria-haspopup="dialog"
            onClick={() => {
              track("filters");
              setSheet("filters");
            }}
          >
            <FilterIcon size={16} aria-hidden="true" />
            {filterCount > 0 && <span className="font-data text-2xs font-semibold tabular-nums">{filterCount}</span>}
          </button>
        )}

        {columns && (
          <button
            type="button"
            className={ICON_BTN}
            aria-label={columns.label ?? t("table.titleBar.columns")}
            aria-haspopup="dialog"
            onClick={() => {
              track("columns");
              setSheet("columns");
            }}
          >
            <TableIcon size={16} aria-hidden="true" />
            <span className="font-data text-2xs font-semibold tabular-nums">
              {columnsSummary(columns.count, columns.total)}
            </span>
          </button>
        )}

        {search && (
          <>
            <button
              type="button"
              className={`${ICON_BTN} sm:hidden ${hasSearchValue ? "text-cz-1" : ""}`}
              aria-label={search.ariaLabel ?? search.placeholder}
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon size={16} aria-hidden="true" />
              {hasSearchValue && <span aria-hidden="true" className="absolute right-1.5 top-2.5 h-1.5 w-1.5 rounded-full bg-cz-1" />}
            </button>
            <div className="relative hidden w-48 flex-none sm:block">
              <SearchIcon
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cz-3"
              />
              <Input
                type="search"
                size="sm"
                value={search.value}
                onChange={(e) => {
                  track("search");
                  search.onChange(e);
                }}
                placeholder={search.placeholder}
                aria-label={search.ariaLabel ?? search.placeholder}
                data-testid={search.testId}
                className="pl-8"
              />
            </div>
          </>
        )}
      </div>

      {filters && (
        <TableSheet
          open={sheet === "filters"}
          onClose={() => setSheet(null)}
          title={filters.label ?? t("table.titleBar.filters")}
          closeLabel={t("table.titleBar.close")}
          footer={
            filters.onReset && filterCount > 0 ? (
              <button
                type="button"
                onClick={filters.onReset}
                className="text-xs text-cz-2 transition-colors hover:text-cz-1"
              >
                {t("controls.clearFilters")}
              </button>
            ) : null
          }
        >
          {filters.children}
        </TableSheet>
      )}

      {columns && (
        <TableSheet
          open={sheet === "columns"}
          onClose={() => setSheet(null)}
          title={columns.label ?? t("table.titleBar.columns")}
          closeLabel={t("table.titleBar.close")}
        >
          {columns.hint && <p className="mb-2 text-xs text-cz-3">{columns.hint}</p>}
          <ul className="flex flex-col">
            {columns.items.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  aria-pressed={item.checked}
                  disabled={item.disabled}
                  onClick={() => {
                    track("column", item.key);
                    columns.onToggle(item.key);
                  }}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 border-b border-cz-border px-1 text-left text-sm transition-colors ${
                    item.checked ? "text-cz-1" : "text-cz-2 hover:text-cz-1"
                  } ${item.disabled ? "opacity-40" : ""}`}
                >
                  <span className="min-w-0 wrap-normal">{item.label}</span>
                  <span className="flex h-4 w-4 flex-none items-center justify-center">
                    {item.checked && <CheckIcon size={16} aria-hidden="true" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {columns.footer && (
            <button
              type="button"
              aria-pressed={columns.footer.checked}
              onClick={() => {
                track("column", "full-table");
                columns.footer.onToggle();
              }}
              className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-cz-1"
            >
              <TableIcon size={16} aria-hidden="true" />
              {columns.footer.label}
              {columns.footer.checked && <CheckIcon size={16} aria-hidden="true" />}
            </button>
          )}
        </TableSheet>
      )}
    </div>
  );

  return framed ? <div className={WRAP}>{bar}</div> : bar;
}

// Ark (TASTE P18): bund-ark på telefon, panel i højre side på computer. Samme
// focus-trap/Escape/scroll-lås som Modal via useModalA11y.
function TableSheet({ open, onClose, title, closeLabel, footer = /** @type {any} */ (null), children }) {
  const ref = useModalA11y(open ? onClose : null, Boolean(open));
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-modal flex items-end justify-center sm:items-stretch sm:justify-end">
        <div className={backdropClass()} aria-hidden="true" onClick={onClose} />
        <div
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="relative flex max-h-[85dvh] w-full flex-col rounded-t-cz border border-cz-border bg-cz-card outline-hidden sm:max-h-none sm:w-[360px] sm:rounded-none sm:border-y-0 sm:border-r-0"
        >
          <div className="flex min-h-11 items-center justify-between gap-3 border-b border-cz-border px-4">
            <h2 className="font-display text-xl leading-none tracking-[.01em] text-cz-1">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="inline-flex h-11 w-11 flex-none items-center justify-center text-cz-3 transition-colors hover:text-cz-1"
            >
              <XIcon size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {footer && <div className="flex justify-end border-t border-cz-border px-4 py-3">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}
