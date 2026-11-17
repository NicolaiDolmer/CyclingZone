// #8298 · Rytternes tabel i det fælles taktikpanel, som wireframe v6c (loebsside-1280/375).
//
// Computer: Rider · Role · Rating · Form · Route match · Fatigue now · Today · Effort ·
// Orders · Lock · Day load. Under hver rytter ligger hans ordrer pr. rutedel og "Extra
// orders"; "Simple" (standard) skjuler dem, "All orders" viser dem alle, og "Orders ▾"
// åbner én rytters. Alle kolonner kan sorteres.
// Telefon (smalt panel): wireframets tids-akse (Rider | rutedelene) med én linje pr.
// rytter; et tryk åbner rytterens kort (tal-linje, indsats, rolle, lås, ordrer pr. rutedel).
//
// Tabellen ejer kun visningen (sortering, hvilke ordrer er åbne). Cellernes kontroller og
// reglerne (hvem må hvad, låst etape, udgået rytter) kommer færdige fra værten.
import { useState, type ReactNode } from "react";
import { RiderLink } from "../race/stagePageV2/ui.ts";
import { Flag as FlagJs } from "../Flag.jsx";
import { ArrowDownIcon as ArrowDownIconJs, ArrowUpIcon as ArrowUpIconJs, ChevronDownIcon as ChevronDownIconJs, LockIcon as LockIconJs } from "../ui/index.js";
import { statPlateStyle as statPlateStyleJs } from "../../lib/statColor.js";
import { RouteMatchPlate } from "../planning/SquadTable.tsx";
import { DAY_LOAD_ARROW, dayLoadTone, fatigueTone, type DayLoad } from "./tacticsV6cModel.ts";
import type { TaskCostWord } from "../race/tacticsReady7864.ts";

type IconProps = { size?: number; className?: string; "aria-hidden"?: boolean | "true" };
const Flag = FlagJs as unknown as (props: { code: string | null | undefined; className?: string }) => ReactNode;
const ChevronDownIcon = ChevronDownIconJs as unknown as (props: IconProps) => ReactNode;
const LockIcon = LockIconJs as unknown as (props: IconProps) => ReactNode;
const ArrowUpIcon = ArrowUpIconJs as unknown as (props: IconProps) => ReactNode;
const ArrowDownIcon = ArrowDownIconJs as unknown as (props: IconProps) => ReactNode;
const statPlateStyle = statPlateStyleJs as unknown as (value: number, opts?: { scale?: string }) => Record<string, string>;

/** Prisordets farve, samme tabel som #8293 (Let grøn, Middel neutral, Hård orange, Meget hård rød). */
export const COST_CLASS: Readonly<Record<TaskCostWord, string>> = Object.freeze({
  easy: "text-cz-success", medium: "text-cz-1", hard: "text-cz-warning", veryHard: "text-cz-danger",
});

export interface TacticsPartCell {
  /** Rutedelens navn ("To Salita di Bondone"). */
  label: string;
  /** Telefonens korte opgavenavn ("Sheltered"). */
  short: string;
  cost: TaskCostWord | null;
  /** Dropdown'en (eller teksten på en låst etape). */
  control: ReactNode;
}

export interface TacticsRiderRow {
  id: string;
  name: string | null;
  /** "R. Yamada" til telefonens tids-akse. */
  shortName: string;
  nation: string | null;
  /** Mestertrøje og talentmærke ved navnet (rytterens egne komponenter), eller null. */
  marks: ReactNode | null;
  abandoned: boolean;
  roleLabel: string;
  /** Rollen ER knappen (dropdown). */
  roleButton: ReactNode;
  /** Rollens vælger, når den er åben. */
  rolePicker: ReactNode | null;
  rating: number | null;
  form: number | null;
  fatigue: number | null;
  routeMatch: number | null;
  timeLimitMark: ReactNode | null;
  today: string;
  effort: ReactNode;
  effortMobile: ReactNode;
  /** Ordrer pr. rutedel (etapeplanen), eller null. */
  parts: TacticsPartCell[] | null;
  /** "Extra orders"-chips, eller null. */
  extra: ReactNode | null;
  /** "Hvis han bliver sat: Grupetto" o.l., eller null. */
  note: string | null;
  /** Indsatsens fem trin (uden etapeplan), bag "All orders". */
  steps: ReactNode | null;
  lock: { on: boolean; disabled: boolean; label: string; title: string; onToggle: () => void } | null;
  dayLoad: DayLoad | null;
}

export interface TacticsRiderTableProps {
  rows: TacticsRiderRow[];
  allOrders: boolean;
  /** Rutedelenes navne (telefonens tids-akse); tom = ingen etapeplan. */
  partLabels: string[];
  columns: { rider: string; role: string; rating: string; form: string; routeMatch: string; fatigueNow: string; today: string; effort: string; orders: string; lock: string; dayLoad: string };
  words: { orders: (name: string) => string; ordersButton: string; extra: string; steps: string; dayLoad: (load: DayLoad) => string; numbers: (row: TacticsRiderRow) => string };
}

type SortKey = "rider" | "role" | "rating" | "form" | "match" | "fatigue";

const TH = "px-1.5 py-1.5 text-left text-2xs font-medium uppercase tracking-wider text-cz-3 whitespace-nowrap";
const TD = "px-1.5 py-2 align-top";

function NumPlate({ value, scale = "rating" }: { value: number | null; scale?: string }) {
  if (value == null) return <span className="text-cz-3">—</span>;
  return (
    <span className="inline-flex min-w-[2.125rem] items-center justify-center rounded-cz px-1 py-0.5 font-data text-[13px] font-semibold leading-none tabular-nums" style={statPlateStyle(value, { scale })}>
      {value}
    </span>
  );
}

/** Træthed nu på den varme skala (#8364): neutral, rav, rød. */
export function FatiguePlate({ value }: { value: number | null }) {
  if (value == null) return <span className="text-cz-3">—</span>;
  const { tone, strength } = fatigueTone(value);
  const color = tone === "red" ? "var(--color-cz-danger)" : "var(--color-cz-warning)";
  const style = tone === "neutral" ? undefined : { backgroundColor: `color-mix(in srgb, ${color} ${20 + Math.round(strength * 0.3)}%, transparent)` };
  return (
    <span data-fatigue-tone={tone} className="inline-flex min-w-[2.125rem] items-center justify-center rounded-cz border border-cz-border px-1 py-0.5 font-data text-[13px] font-semibold leading-none tabular-nums text-cz-1" style={style}>
      {value}
    </span>
  );
}

const ARROW_PATH: Record<(typeof DAY_LOAD_ARROW)[DayLoad], string> = {
  up: "M6 10V2M2.5 5.5 6 2l3.5 3.5",
  flat: "M2 6h8M6.5 2.5 10 6l-3.5 3.5",
  downSlight: "M3 3l6 6M9 4.5V9H4.5",
  down: "M6 2v8M2.5 6.5 6 10l3.5-3.5",
  downMuch: "M4 1v9M8 1v9M1.5 7.5 4 10l2-2.5M6 7.5 8 10l2.5-2.5",
};

/** "Day load": pil (retning og størrelse) + ord, i træthedens farve. Ikke et facit for aftenen. */
export function DayLoadCell({ load, label }: { load: DayLoad | null; label: (load: DayLoad) => string }) {
  if (!load) return <span className="text-cz-3">—</span>;
  const tone = dayLoadTone(load);
  const cls = tone === "red" ? "text-cz-danger" : tone === "amber" ? "text-cz-warning" : "text-cz-2";
  return (
    <span data-day-load={load} className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold ${cls}`}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={ARROW_PATH[DAY_LOAD_ARROW[load]]} />
      </svg>
      {label(load)}
    </span>
  );
}

function LockButton({ lock }: { lock: TacticsRiderRow["lock"] }) {
  if (!lock) return null;
  return (
    <button
      type="button"
      aria-pressed={lock.on}
      aria-label={lock.label}
      title={lock.title}
      disabled={lock.disabled}
      onClick={lock.onToggle}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-cz border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 [@media(max-width:640px),(pointer:coarse)]:h-11 [@media(max-width:640px),(pointer:coarse)]:w-11 ${
        lock.on ? "border-cz-accent bg-cz-accent/10 text-cz-accent-t" : "border-cz-border bg-cz-card text-cz-3 hover:text-cz-1"
      }`}
    >
      <LockIcon size={12} aria-hidden="true" />
    </button>
  );
}

/** Navnecellen (ejerens faste regel 17/11): flag + hover-ikon + navn på én linje, typen aldrig i navnet. */
function Name({ row }: { row: TacticsRiderRow }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 whitespace-nowrap" title={row.name ?? undefined}>
      {row.nation && <Flag code={row.nation} className="shrink-0" />}
      <RiderLink id={row.id} className="min-w-0 truncate text-cz-1 underline decoration-dotted decoration-cz-3 underline-offset-4 hover:text-cz-accent-t">{row.name || "—"}</RiderLink>
      {row.marks}
    </span>
  );
}

function sortValue(row: TacticsRiderRow, key: SortKey): string | number {
  switch (key) {
    case "rider": return row.name ?? "";
    case "role": return row.roleLabel;
    case "rating": return row.rating ?? -1;
    case "form": return row.form ?? -1;
    case "match": return row.routeMatch ?? -1;
    default: return row.fatigue ?? -1;
  }
}

function SortTh({ label, sortKey, sort, onSort, right = false }: { label: string; sortKey: SortKey; sort: { key: SortKey; dir: 1 | -1 } | null; onSort: (k: SortKey) => void; right?: boolean }) {
  const active = sort?.key === sortKey;
  return (
    <th className={`${TH} ${right ? "text-right" : ""}`} aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(sortKey)} className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-cz-1 ${active ? "text-cz-1" : ""}`}>
        {label}
        {active && (sort!.dir === 1 ? <ArrowUpIcon size={10} aria-hidden="true" /> : <ArrowDownIcon size={10} aria-hidden="true" />)}
      </button>
    </th>
  );
}

function OrdersRow({ row, words }: { row: TacticsRiderRow; words: TacticsRiderTableProps["words"] }) {
  return (
    <div data-tactics-orders={row.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-1.5 py-2 text-xs">
      {row.parts?.map((part) => (
        <div key={part.label} className="flex min-w-0 flex-col gap-1">
          <span className="text-2xs text-cz-3">{part.label}</span>
          {part.control}
        </div>
      ))}
      {row.steps && (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-2xs text-cz-3">{words.steps}</span>
          {row.steps}
        </div>
      )}
      {row.extra && (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-2xs text-cz-3">{words.extra}</span>
          <div className="flex flex-wrap items-center gap-1.5">{row.extra}</div>
        </div>
      )}
      {row.note && <p className="m-0 basis-full text-2xs text-cz-3">{row.note}</p>}
    </div>
  );
}

export default function TacticsRiderTable({ rows, allOrders, partLabels, columns, words }: TacticsRiderTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [mobileOpen, setMobileOpen] = useState<string | null>(null);
  const onSort = (key: SortKey) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "rider" || key === "role" ? 1 : -1 }));
  const sorted = sort
    ? [...rows].sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      return (typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : Number(x) - Number(y)) * sort.dir;
    })
    : rows;
  const hasOrders = (row: TacticsRiderRow) => !!(row.parts?.length || row.extra || row.steps);
  const span = 11;

  return (
    <div className="@container">
      <div className="hidden @4xl:block">
        <table data-sortable className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-cz-border">
              <SortTh label={columns.rider} sortKey="rider" sort={sort} onSort={onSort} />
              <SortTh label={columns.role} sortKey="role" sort={sort} onSort={onSort} />
              <SortTh label={columns.rating} sortKey="rating" sort={sort} onSort={onSort} right />
              <SortTh label={columns.form} sortKey="form" sort={sort} onSort={onSort} right />
              <SortTh label={columns.routeMatch} sortKey="match" sort={sort} onSort={onSort} right />
              <SortTh label={columns.fatigueNow} sortKey="fatigue" sort={sort} onSort={onSort} right />
              <th className={TH}>{columns.today}</th>
              <th className={TH}>{columns.effort}</th>
              <th className={TH}>{columns.orders}</th>
              <th className={TH}>{columns.lock}</th>
              <th className={TH}>{columns.dayLoad}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const shown = hasOrders(row) && (allOrders || open[row.id] === true);
              return [
                <tr key={row.id} data-tactics-rider={row.id} className={shown ? "" : "border-b border-cz-border"}>
                  <td className={`${TD} max-w-[200px] font-medium`}><Name row={row} /></td>
                  <td className={TD}>{row.roleButton}</td>
                  <td className={`${TD} text-right`}><NumPlate value={row.rating} /></td>
                  <td className={`${TD} text-right`}><NumPlate value={row.form} /></td>
                  <td className={`${TD} text-right`}>
                    <span className="inline-flex flex-col items-end gap-1"><RouteMatchPlate value={row.routeMatch} />{row.timeLimitMark}</span>
                  </td>
                  <td className={`${TD} text-right`}><FatiguePlate value={row.fatigue} /></td>
                  <td className={`${TD} max-w-[130px] text-xs text-cz-1`}>{row.today}</td>
                  <td className={TD}>{row.effort}</td>
                  <td className={TD}>
                    {hasOrders(row) && (
                      <button
                        type="button"
                        aria-expanded={shown}
                        aria-label={words.orders(row.name || "—")}
                        disabled={allOrders}
                        onClick={() => setOpen((o) => ({ ...o, [row.id]: !o[row.id] }))}
                        className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-cz border border-cz-border bg-cz-card px-2 text-xs text-cz-1 hover:bg-cz-subtle disabled:cursor-default"
                      >
                        {words.ordersButton}
                        <ChevronDownIcon size={11} aria-hidden="true" className={shown ? "rotate-180" : ""} />
                      </button>
                    )}
                  </td>
                  <td className={TD}><LockButton lock={row.lock} /></td>
                  <td className={TD}><DayLoadCell load={row.dayLoad} label={words.dayLoad} /></td>
                </tr>,
                row.rolePicker ? (
                  <tr key={`${row.id}-role`} className="border-b border-cz-border bg-cz-subtle">
                    <td colSpan={span} className="px-1.5 pb-3 pt-1">{row.rolePicker}</td>
                  </tr>
                ) : null,
                shown ? (
                  <tr key={`${row.id}-orders`} className="border-b border-cz-border bg-cz-subtle">
                    <td colSpan={span} className="p-0"><OrdersRow row={row} words={words} /></td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* Telefon / smalt panel: wireframets tids-akse (Rider | rutedelene) og et åbent kort pr. rytter. */}
      <div className="@4xl:hidden" data-tactics-timeline>
        <div className={`grid items-end gap-x-2 border-b border-cz-border pb-1.5 text-2xs font-medium uppercase tracking-wider text-cz-3`} style={{ gridTemplateColumns: `minmax(0,1.4fr) repeat(${Math.max(1, partLabels.length)}, minmax(0,1fr))` }}>
          <span>{columns.rider}</span>
          {partLabels.length ? partLabels.map((label) => <span key={label} className="leading-tight">{label}</span>) : <span>{columns.effort}</span>}
        </div>
        <ul className="m-0 list-none p-0">
          {sorted.map((row) => {
            const isOpen = mobileOpen === row.id;
            return (
              <li key={row.id} data-tactics-rider={row.id} className={`border-b border-cz-border ${isOpen ? "bg-cz-subtle" : ""}`}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setMobileOpen(isOpen ? null : row.id)}
                  className="grid w-full items-start gap-x-2 py-2 text-left text-xs"
                  style={{ gridTemplateColumns: `minmax(0,1.4fr) repeat(${Math.max(1, partLabels.length)}, minmax(0,1fr))` }}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-cz-1">
                      {row.nation && <Flag code={row.nation} className="shrink-0" />}
                      <span className="truncate">{row.shortName}</span>
                    </span>
                    <span className="text-2xs text-cz-3">
                      {row.roleLabel}{row.dayLoad ? " · " : ""}{row.dayLoad && <DayLoadCell load={row.dayLoad} label={words.dayLoad} />}
                    </span>
                  </span>
                  {row.parts?.length
                    ? row.parts.map((part) => <span key={part.label} className={`font-semibold leading-tight ${part.cost ? COST_CLASS[part.cost] : "text-cz-2"}`}>{part.short}</span>)
                    : <span className="text-cz-2">{row.today}</span>}
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-3 pb-3">
                    <p className="m-0 font-data text-2xs tabular-nums text-cz-2">{words.numbers(row)}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">{row.effortMobile}</div>
                      {row.roleButton}
                      <LockButton lock={row.lock} />
                    </div>
                    {row.rolePicker}
                    {row.timeLimitMark}
                    {row.parts?.map((part) => (
                      <div key={part.label} className="flex flex-col gap-1">
                        <span className="text-2xs text-cz-3">{part.label}</span>
                        <div className="[&>div]:block [&_button[aria-haspopup]]:w-full [&_button[aria-haspopup]]:justify-center">{part.control}</div>
                      </div>
                    ))}
                    {row.steps && (
                      <div className="flex flex-col gap-1">
                        <span className="text-2xs text-cz-3">{words.steps}</span>
                        {row.steps}
                      </div>
                    )}
                    {row.extra && (
                      <div className="flex flex-col gap-1">
                        <span className="text-2xs text-cz-3">{words.extra}</span>
                        <div className="flex flex-wrap gap-1.5">{row.extra}</div>
                      </div>
                    )}
                    {row.note && <p className="m-0 text-2xs text-cz-3">{row.note}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
