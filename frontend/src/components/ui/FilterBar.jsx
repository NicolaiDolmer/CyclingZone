import Input from "./Input.jsx";
import Select from "./Select.jsx";
import Checkbox from "./Checkbox.jsx";
import { SearchIcon, FilterIcon, ChevronDownIcon } from "./icons/index.jsx";

// #4625 (slice 3 af #4622) — DEN kanoniske T2-filterlinje (docs/design/PAGE_TEMPLATES.md
// "Filter bar"). Ét idiom for alle T2-sider: søgefelt + op til 3 selects + valgfri
// checkbox på ÉN linje, "More filters" lukket som standard (details/summary, samme
// mekanik som CollapsibleSection). Erstatter håndrullede filterpaneler med 8-12 felter
// åbne som default (audit 2026-09: Ryttere, Auktioner, Transfers) — TASTE fork 1.
//
// `filters` er MAKS 3 (kaster i dev over 3 — det femte felt hører hjemme i `children`
// bag "More filters", ikke i selve linjen). Hvert filter-select faar automatisk
// size="sm" uanset hvad selve <Select> fik, saa siden ikke kan blande store og smaa
// felter i baren.
export default function FilterBar({
  search = null,
  filters = [],
  checkbox = null,
  meta = null,
  moreLabel = "More filters",
  moreDefaultOpen = false,
  moreWide = false,
  children = null,
  className = "",
}) {
  if (import.meta.env.DEV && filters.length > 3) {
    throw new Error(
      `FilterBar understoetter maks 3 selects i selve linjen (fik ${filters.length}). ` +
        'Flyt resten ind i "More filters" via `children` — se docs/design/PAGE_TEMPLATES.md#filter-bar.'
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {search && (
        <div className="relative w-full sm:w-60">
          <SearchIcon
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cz-3"
          />
          <Input
            type="search"
            size="sm"
            value={search.value}
            onChange={search.onChange}
            placeholder={search.placeholder}
            aria-label={search.ariaLabel ?? search.placeholder}
            className="pl-8"
          />
        </div>
      )}

      {filters.map((f) => (
        <Select
          key={f.key}
          size="sm"
          value={f.value}
          onChange={f.onChange}
          aria-label={f.ariaLabel}
          className="w-auto min-w-[9rem]"
        >
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ))}

      {checkbox && (
        <Checkbox
          id={checkbox.id}
          label={checkbox.label}
          checked={checkbox.checked}
          onChange={checkbox.onChange}
        />
      )}

      {/* #4628: `moreWide` — naar "More filters" gemmer et helt panel (Auktioner
          skjuler hele RiderFilters-panelet bag den) skal disclosuren ligge paa
          sin egen linje i fuld bredde; den shrink-wrappede sm:w-auto-variant
          lader et bredt panel vokse ud over filterlinjens bredde. Default er
          uaendret: en kort felt-liste der flugter til hoejre. */}
      {children && (
        <details open={moreDefaultOpen} className={`group order-last w-full ${moreWide ? "basis-full" : "sm:order-none sm:ms-auto sm:w-auto"}`}>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-cz-2 select-none hover:text-cz-1">
            <FilterIcon size={14} aria-hidden="true" />
            {moreLabel}
            <ChevronDownIcon size={14} aria-hidden="true" className="transition-transform duration-150 group-open:rotate-180" />
          </summary>
          <div className="mt-3 flex w-full flex-wrap items-center gap-3 basis-full">{children}</div>
        </details>
      )}

      {meta && (
        <span className={`font-data text-xs text-cz-3 ${children ? "" : "sm:ms-auto"}`}>{meta}</span>
      )}
    </div>
  );
}
