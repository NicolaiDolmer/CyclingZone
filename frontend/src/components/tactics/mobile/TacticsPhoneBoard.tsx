// #8386 · Taktik på telefonen, udgave B (ejervalg 17/11 på #8298, "B med dirigentens tre forslag").
//
// - Én linje pr. rytter: flag og navn, rolle, rutematch og dagens belastning i ord, og
//   Easy | Medium | Hard skrevet helt ud (ingen lyser = holdets plan). Hele holdet kan sættes
//   uden at åbne noget; knapperne har 44 px trykflade.
// - Sorteringsknap over listen; standard er rolle, kaptajnen først, hver gang siden åbnes.
// - "All orders" giver hver rytter én ekstra linje med dagens ordre pr. rutedel, farvet efter
//   pris. Ændringen sker i arket, ikke i listen.
// - Et tryk på rytteren åbner hans ark: tal-linjen, Easy | Medium | Hard, rollen som knap, låsen,
//   dagens linje og Day load, ordrerne pr. rutedel, Extra orders og "Rider N of M" med
//   forrige/næste uden at lukke arket. Gem står fast i arkets bund.
//
// Listen ejer kun visningen (sortering, hvilket ark er åbent). Kontrollerne og reglerne kommer
// færdige fra værten gennem de samme rækker som computerens tabel.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Flag as FlagJs } from "../../Flag.jsx";
import RiderNameCellJs from "../../rider/RiderNameCell.jsx";
import { ChevronDownIcon as ChevronDownIconJs, LockIcon as LockIconJs, SortIcon as SortIconJs } from "../../ui/index.js";
import { useDismiss } from "../../ui/useDismiss.js";
import { RouteMatchPlate } from "../../planning/SquadTable.tsx";
import { COST_CLASS, DayLoadCell, type TacticsRiderRow } from "../TacticsRiderTable.tsx";
import type { DayLoad } from "../tacticsV6cModel.ts";
import PhoneSheet from "./PhoneSheet.tsx";
import { PhoneSaveLine, usePhoneSave } from "./PhoneSave.tsx";
import { DEFAULT_PHONE_SORT, PHONE_SORT_KEYS, neighbours, sortPhoneRiders, type PhoneSortKey } from "./tacticsPhoneModel.ts";

type IconProps = { size?: number; className?: string; "aria-hidden"?: boolean | "true" };
type TFn = (key: string, opts?: Record<string, unknown>) => string;
const Flag = FlagJs as unknown as (props: { code: string | null | undefined; className?: string }) => ReactNode;
const RiderNameCell = RiderNameCellJs as unknown as (props: { id: string; name?: string; className?: string }) => ReactNode;
const ChevronDownIcon = ChevronDownIconJs as unknown as (props: IconProps) => ReactNode;
const LockIcon = LockIconJs as unknown as (props: IconProps) => ReactNode;
const SortIcon = SortIconJs as unknown as (props: IconProps) => ReactNode;
const useDismissTyped = useDismiss as unknown as (ref: { current: HTMLElement | null }, onDismiss: () => void, active: boolean) => void;

export interface PhoneRow {
  row: TacticsRiderRow;
  /** Rollens værdi (captain, helper, ...) til sorteringen. */
  role: string | null;
}

export interface TacticsPhoneBoardProps {
  rows: PhoneRow[];
  /** Rutedelenes navne; tom = ingen etapeplan. */
  partLabels: string[];
  allOrders: boolean;
}

const SORT_LABEL: Readonly<Record<PhoneSortKey, string>> = Object.freeze({
  role: "col.role", routeMatch: "col.routeMatch", rating: "col.rating", form: "col.form", fatigue: "col.fatigueNow",
});

function SortMenu({ value, onPick }: { value: PhoneSortKey; onPick: (k: PhoneSortKey) => void }) {
  const { t } = useTranslation("tactics") as unknown as { t: TFn };
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useDismissTyped(ref, () => setOpen(false), open);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="tactics-phone-sort"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-cz border border-cz-border bg-cz-card px-3 text-xs text-cz-2 hover:bg-cz-subtle"
      >
        <SortIcon size={13} aria-hidden="true" />
        {t("phone.sort")} <b className="font-semibold text-cz-1">{t(SORT_LABEL[value])}</b>
        <ChevronDownIcon size={11} aria-hidden="true" className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div role="menu" aria-label={t("phone.sortAria")} className="cz-menu-panel absolute right-0 z-dropdown mt-1 min-w-[11rem] rounded-cz border border-cz-border bg-cz-elevated py-1">
          {PHONE_SORT_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={key === value}
              onClick={() => { setOpen(false); onPick(key); }}
              className={`flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-cz-subtle ${key === value ? "bg-cz-accent/10 font-semibold text-cz-accent-t" : "text-cz-1"}`}
            >
              {t(SORT_LABEL[key])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rollen og rutematch under navnet, dagens belastning på linjen under. */
function Meta({ row, dayLoad }: { row: TacticsRiderRow; dayLoad: (l: DayLoad) => string }) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-cz-2">
        {row.lock?.on && <LockIcon size={11} aria-hidden="true" className="text-cz-accent-t" />}
        <span>{row.roleLabel}</span>
        {row.routeMatch != null && <><span aria-hidden="true">·</span><RouteMatchPlate value={row.routeMatch} /></>}
      </span>
      {row.dayLoad && <DayLoadCell load={row.dayLoad} label={dayLoad} />}
    </>
  );
}

/** "All orders": dagens ordre pr. rutedel, farvet efter pris (uden etapeplan: dagens linje). */
function OrdersLine({ row, columns }: { row: TacticsRiderRow; columns: number }) {
  if (!row.parts?.length) return <p className="m-0 pb-2 text-xs text-cz-2">{row.today}</p>;
  return (
    <div data-tactics-phone-orders={row.id} className="grid gap-x-2 pb-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>
      {row.parts.map((part) => (
        <span key={part.label} className={`truncate border-t-2 border-current pt-1 text-xs font-semibold ${part.cost ? COST_CLASS[part.cost] : "text-cz-2"}`}>
          {part.short}
        </span>
      ))}
    </div>
  );
}

function RiderSheet({ row, position, total, onPrev, onNext, onClose }: { row: TacticsRiderRow; position: number; total: number; onPrev: (() => void) | null; onNext: (() => void) | null; onClose: () => void }) {
  const { t } = useTranslation("tactics") as unknown as { t: TFn };
  const save = usePhoneSave();
  const name = row.name || "—";
  const label = (key: string) => <span className="text-2xs font-medium uppercase tracking-wider text-cz-3">{t(key)}</span>;
  return (
    <PhoneSheet
      label={name}
      testId="tactics-phone-rider-sheet"
      closeLabel={t("phone.close")}
      onClose={onClose}
      nav={{ onPrev, onNext, prevLabel: t("phone.prev"), nextLabel: t("phone.next") }}
      heading={(
        <>
          <span className="inline-flex max-w-full items-center justify-center gap-1.5">
            {row.nation && <Flag code={row.nation} className="shrink-0" />}
            <RiderNameCell id={row.id} name={name} className="text-[15px] font-semibold text-cz-1 hover:text-cz-accent-t" />
          </span>
          <p className="m-0 font-data text-2xs tabular-nums text-cz-3">{t("phone.riderOf", { n: position, total })}</p>
        </>
      )}
      footer={save && !save.locked ? <PhoneSaveLine save={save} /> : null}
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-center font-data text-xs tabular-nums text-cz-2">
          {t("mobile.numbers", { rating: row.rating ?? "—", form: row.form ?? "—", match: row.routeMatch ?? "—", fatigue: row.fatigue ?? "—" })}
        </p>
        <div>{row.effortMobile}</div>
        <div className="flex items-stretch gap-2">
          <div className="min-w-0 flex-1 [&>button]:w-full [&>button]:justify-between">{row.roleButton}</div>
          {row.lock && (
            <button
              type="button"
              aria-pressed={row.lock.on}
              aria-label={row.lock.label}
              title={row.lock.title}
              disabled={row.lock.disabled}
              onClick={row.lock.onToggle}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-cz border px-3 text-xs font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                row.lock.on ? "border-cz-accent bg-cz-accent/10 text-cz-accent-t" : "border-cz-border bg-cz-card text-cz-2 hover:text-cz-1"
              }`}
            >
              <LockIcon size={12} aria-hidden="true" />
              {t(row.lock.on ? "phone.locked" : "phone.lock")}
            </button>
          )}
        </div>
        {row.rolePicker}
        {row.timeLimitMark}
        <div className="flex items-start justify-between gap-3 border-b border-cz-border pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">{label("col.today")}<span className="text-sm font-semibold text-cz-1">{row.today}</span></div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">{label("col.dayLoad")}<DayLoadCell load={row.dayLoad} label={(l) => t(`dayLoad.${l}`)} /></div>
        </div>
        {row.parts?.map((part) => (
          <div key={part.label} className="flex flex-col gap-1">
            <span className="text-xs text-cz-2">{part.label}</span>
            <div className="[&>div]:block [&_button[aria-haspopup]]:w-full [&_button[aria-haspopup]>svg]:ml-auto">{part.control}</div>
          </div>
        ))}
        {row.steps && <div className="flex flex-col gap-1">{label("orders.steps")}{row.steps}</div>}
        {row.extra && <div className="flex flex-col gap-1.5">{label("orders.extra")}<div className="flex flex-wrap gap-1.5">{row.extra}</div></div>}
        {row.note && <p className="m-0 text-2xs text-cz-3">{row.note}</p>}
      </div>
    </PhoneSheet>
  );
}

export default function TacticsPhoneBoard({ rows, partLabels, allOrders }: TacticsPhoneBoardProps) {
  const { t } = useTranslation("tactics") as unknown as { t: TFn };
  // Standard er rolle, hver gang siden åbnes (ejer 17/11); et andet valg gælder kun visningen.
  const [sort, setSort] = useState<PhoneSortKey>(DEFAULT_PHONE_SORT);
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = useMemo(
    () => sortPhoneRiders(rows.map((r) => ({ ...r, id: r.row.id, name: r.row.name, routeMatch: r.row.routeMatch, rating: r.row.rating, form: r.row.form, fatigue: r.row.fatigue })), sort),
    [rows, sort],
  );
  const ids = sorted.map((r) => r.id);
  const open = openId ? sorted.find((r) => r.id === openId)?.row ?? null : null;
  const nav = openId ? neighbours(ids, openId) : null;
  const dayLoad = (l: DayLoad) => t(`dayLoad.${l}`);
  const columns = Math.max(1, partLabels.length);

  return (
    <div data-tactics-phone className="flex flex-col gap-2">
      <div className="flex justify-end">
        <SortMenu value={sort} onPick={setSort} />
      </div>
      {allOrders && partLabels.length > 0 && (
        <div className="grid gap-x-2 px-0.5 text-2xs font-medium uppercase tracking-wider text-cz-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>
          {partLabels.map((label) => <span key={label} className="truncate">{label}</span>)}
        </div>
      )}
      <ul className="m-0 list-none rounded-cz border border-cz-border p-0">
        {sorted.map(({ row }) => (
          <li key={row.id} data-tactics-phone-rider={row.id} className="border-b border-cz-border px-2 last:border-b-0">
            <div className="flex items-center gap-2 py-1.5">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={t("phone.open", { name: row.name || "—" })}
                onClick={() => setOpenId(row.id)}
                className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 text-left"
              >
                {/* Navnecellen: kun flag og navn (ejer 17/11). */}
                <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm font-semibold text-cz-1">
                  {row.nation && <Flag code={row.nation} className="shrink-0" />}
                  <span className="truncate">{row.shortName}</span>
                </span>
                <Meta row={row} dayLoad={dayLoad} />
              </button>
              <div className="shrink-0">{row.effort}</div>
            </div>
            {allOrders && <OrdersLine row={row} columns={columns} />}
          </li>
        ))}
      </ul>
      {open && nav && (
        <RiderSheet
          row={open}
          position={nav.index + 1}
          total={ids.length}
          onPrev={nav.prev ? () => setOpenId(nav.prev) : null}
          onNext={nav.next ? () => setOpenId(nav.next) : null}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
