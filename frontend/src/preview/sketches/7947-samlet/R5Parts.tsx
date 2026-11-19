import { Dropdown, MenuItem } from "../../../components/ui/Menu.jsx";
import { ChevronDownIcon as FilterChevron, FilterIcon } from "../../../components/ui/icons/index.jsx";
import RiderTypeBadge from "../../../components/rider/RiderTypeBadge.jsx";
// #7947 retning 5: smaa faelles byggesten (navnecellen, traethedspladen, pilen).
import { Flag } from "../../../components/Flag.jsx";
import { ArrowDownIcon, ArrowUpIcon, SortIcon, UserIcon } from "../../../components/ui/icons/index.jsx";
import { fatigueStep, type Arrow } from "./r5model.ts";
import type { R5Rider } from "./r5data.ts";

const PLATE = "inline-flex min-w-[2.125rem] items-center justify-center rounded-cz border px-1 py-0.5 font-data text-[13px] font-semibold leading-none tabular-nums text-cz-1";
// Varm skala (#8364): neutral, rav, staerkere rav, roed. Trinene er skitse-trin.
const FATIGUE_PLATE = [
  "border-cz-border bg-cz-subtle",
  "border-cz-warning/30 bg-cz-warning/10",
  "border-cz-warning/50 bg-cz-warning/25",
  "border-cz-danger/50 bg-cz-danger/20",
];

export function FatiguePlate({ value, label = "Fatigue now" }: { value: number; label?: string }) {
  return <span className={`${PLATE} ${FATIGUE_PLATE[fatigueStep(value)]}`} aria-label={`${label} ${value}`}>{value}</span>;
}

// XP pr. dag de sidste 30 dage som smaa soejler (aeldst til venstre, i dag er moerkest).
export function Spark({ values, label }: { values: readonly number[]; label: string }) {
  const max = Math.max(1, ...values);
  const w = 3;
  const gap = 1;
  const h = 18;
  return (
    <svg width={values.length * (w + gap)} height={h} role="img" aria-label={label} className="shrink-0">
      {values.map((v, i) => {
        const bar = Math.max(1, Math.round((v / max) * h));
        const last = i === values.length - 1;
        return <rect key={i} x={i * (w + gap)} y={h - bar} width={w} height={bar} fill="currentColor" className={last ? "text-cz-1" : "text-cz-3"} opacity={last ? 1 : 0.55} />;
      })}
    </svg>
  );
}

// Vejen til naeste evnepoint som procent af bjaelken (ingen pris vises).
export function PctBar({ pct, wide = false }: { pct: number; wide?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5" role="img" aria-label={`${pct} percent of the way to the next point`}>
      <span className={`relative block h-1.5 overflow-hidden rounded-cz bg-cz-border ${wide ? "w-24" : "w-14"}`}>
        <span className="absolute inset-y-0 start-0 bg-cz-1" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-data text-2xs tabular-nums text-cz-2">{pct} %</span>
    </span>
  );
}

// Sorterbar kolonneoverskrift (TASTE 7a) til udviklings- og rapporttabellen.
export type SortState<K extends string> = { key: K; dir: 1 | -1 } | null;
export function SortHead<K extends string>({ k, label, cls, sort, onSort, right = false }: {
  k: K | null; label: string; cls: string; sort: SortState<K>; onSort: (k: K) => void; right?: boolean;
}) {
  return (
    <th className={`px-3 py-2 font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3 ${right ? "text-end" : "text-start"} ${cls}`}
      aria-sort={sort && k === sort.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      {k ? (
        <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 uppercase hover:text-cz-1">
          {label}<SortIcon size={11} aria-hidden="true" />
        </button>
      ) : label}
    </th>
  );
}

export function ArrowMark({ arrow }: { arrow: Arrow }) {
  if (arrow === "up") return <ArrowUpIcon size={13} aria-hidden="true" />;
  if (arrow === "flat") return <ArrowUpIcon size={13} aria-hidden="true" className="rotate-90" />;
  if (arrow === "down") return <ArrowDownIcon size={13} aria-hidden="true" />;
  return (
    <span className="inline-flex" aria-hidden="true">
      <ArrowDownIcon size={13} />
      <ArrowDownIcon size={13} className="-ms-1.5" />
    </span>
  );
}

export function RiderName({ rider, wrap = false }: { rider: R5Rider; wrap?: boolean }) {
  // Navnecellen (ejer punkt 2 + TASTE P12): flag, hover-ikon, navn. Aldrig typen.
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${wrap ? "items-start" : ""}`}>
      <Flag code={rider.nation} title={rider.country} className="shrink-0" />
      <UserIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
      <a href="#rider" className={`text-[13.5px] font-medium text-cz-1 hover:underline ${wrap ? "leading-tight" : "truncate"}`}>{rider.name}</a>
    </span>
  );
}

// Ejer 19/11: formen paa fanen Day og formens udvikling i rapporten. Eksempeldata pr. rytter.
export const FORM: Record<string, number> = { r1: 71, r2: 64, r3: 58, r4: 66, r5: 69, r6: 62, r7: 60, r8: 55, r9: 67 };
export const FORM_DELTA: Record<string, number> = { r1: 2, r2: 1, r3: -3, r4: 2, r5: 3, r6: 2, r7: 1, r8: 0, r9: 2 };

// Ejer 19/11: ryttertypen som i spillets andre tabeller (RiderTypeBadge, primaer + sekundaer, stacked).
const TYPES: Record<string, [string, string]> = {
  r1: ["climber", "gc"], r2: ["rouleur", "tt"], r3: ["brostensrytter", "rouleur"], r4: ["puncheur", "baroudeur"],
  r5: ["tt", "rouleur"], r6: ["rouleur", "baroudeur"], r7: ["gc", "climber"], r8: ["rouleur", "sprinter"], r9: ["sprinter", "puncheur"],
};
export function TypeCell({ id }: { id: string }) {
  const t = TYPES[id];
  return t ? <RiderTypeBadge primaryType={t[0]} secondaryType={t[1]} stacked /> : null;
}

// Ejer 19/11: filtre paa traeningen og i rapporten (alder, grupper, ryttertype) som P21-ord med lille pil.
const FILTERS: Array<[string, string[]]> = [
  ["All ages", ["All ages", "Under 23", "Under 25", "25 and over"]],
  ["All groups", ["All groups", "Climbers", "Sprinters", "Classics", "No group"]],
  ["All types", ["All types", "Climber", "Sprinter", "Time trialist", "Puncheur", "Cobbles", "Baroudeur", "Rouleur", "GC"]],
];
export function FilterWords() {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 text-xs" data-testid="r5-filter-words">
      {FILTERS.map(([label, items], i) => (
        <span key={label} className="inline-flex items-center">
          {i > 0 && <span className="px-1 text-cz-3">·</span>}
          <Dropdown
            trigger={({ open, toggle }: { open: boolean; toggle: () => void }) => (
              <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu"
                className="inline-flex items-center gap-0.5 font-medium text-cz-1 hover:text-cz-accent-t max-sm:min-h-11">
                {label}<FilterChevron size={11} aria-hidden="true" className="text-cz-3" />
              </button>
            )}
          >
            {items.map((it) => <MenuItem key={it}>{it}</MenuItem>)}
          </Dropdown>
        </span>
      ))}
      <button type="button" aria-label="More filters: injured, racing, program" className="ms-1 inline-flex h-7 w-7 items-center justify-center rounded-cz text-cz-2 hover:bg-cz-subtle hover:text-cz-1 max-sm:h-11 max-sm:w-11">
        <FilterIcon size={14} aria-hidden="true" />
      </button>
    </span>
  );
}
