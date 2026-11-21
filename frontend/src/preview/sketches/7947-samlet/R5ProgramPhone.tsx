// #7456/#8547 R5 fanen Program, telefonudgaven (390). Ejer 20/11: "A, en dag ad
// gangen" med tre rettelser: Gem (guld) fast i bunden, dagene i EN linje med pile
// til siden, og program- og rytter-valget maa ikke ligne samme valg to gange.
// En spiller (Discord 20/11) vil have B, hele ugen som liste, med de nuvaerende
// sessionsnavne i stedet for to-bogstavs-koder. Ejeren spurgte om en skifter
// mellem de to. Fire muligheder, valgt med ?phone=v1|v2|b|switch:
//   v1      A, programnavnet oeverst som overskrift, rytterne som chips under
//   v2      A, kun et rytter-valg oeverst, programmet som almindelig tekst under
//   b       hele ugen som liste, sessionsnavnene skrevet ud
//   switch  A og B med en skifter Day / Week (?head=v2 bytter hovedet; ?view=week
//           aabner den paa ugelisten)
// Ryttere her er opdigtede (ikke holdets), og intet gemmes. Skitse, ikke produktkode.

import { useRef, useState } from "react";
import Button from "../../../components/ui/Button.jsx";
import { Segmented } from "../../../components/ui/Segmented.jsx";
import {
  ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, FlagIcon, FlameIcon, LockIcon,
} from "../../../components/ui/icons/index.jsx";
import { SESSION_EN } from "./r5data.ts";
import {
  DAYS, DayBlockEditor, DayFields, DayFooter, FATIGUE_LIMIT, KindIcon, LABEL, TODAY, TonightPlate,
  programOf, riderById, usersOf, type Cell, type Kind, type ProgramDef, type WeekView,
} from "./R5ProgramParts.tsx";

export type PhoneMode = "v1" | "v2" | "b" | "switch";
export const PHONE_MODES: readonly PhoneMode[] = ["v1", "v2", "b", "switch"];
/** Ejer 20/11: Gem er fast i bunden paa telefonen, saa sidehovedet har ingen guldknap dér. */
export const BOTTOM_SAVE = true;

// Opdigtede navne til de fire telefonbilleder (holdets rigtige ryttere staar ikke i dem).
const NAMES: Record<string, string> = {
  r1: "Tomas Varga", r2: "Idris Kalen", r3: "Marek Dolan", r4: "Pavel Orlin", r5: "Ivo Marten",
  r6: "Joran Bekker", r7: "Elias Mounir", r8: "Ruben Castell", r9: "Anselm Rask",
};
const nameOf = (id: string) => NAMES[id] ?? riderById(id).name;
const shortName = (id: string) => { const [f, ...l] = nameOf(id).split(" "); return `${f[0]}. ${l.join(" ")}`; };
const kindWord = (k: Kind) => (k === "week" ? "Week blocks" : "Rotation");

// --- Hoved: program og rytter ----------------------------------------------------------

/** V1: programmet er en overskrift (tekst, ingen kasse); rytterne er chips under den. */
function HeadV1({ program, riders, rider, onRider }: { program: ProgramDef; riders: string[]; rider: string; onRider: (id: string) => void }) {
  const u = usersOf(program.id);
  const on = [...u.groups.map((g) => g.group.name), ...u.riders.map(nameOf)];
  return (
    <>
      <div className="flex items-start gap-2" data-mark="program-title">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-cz-1">
            <KindIcon kind={program.kind} />
            <span className="truncate">{program.name}</span>
          </h2>
          <p className="mt-0.5 truncate text-xs text-cz-2">{kindWord(program.kind)} · on {on.join(", ")}</p>
        </div>
        <button type="button" className="-me-1 inline-flex min-h-11 shrink-0 items-center px-1 text-xs font-medium text-cz-accent-t">Change program</button>
      </div>
      <div data-mark="rider-chips">
        <span className={LABEL}>Week for</span>
        <div role="group" aria-label="Week for rider" className="-mx-4 mt-1 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
          {riders.map((id) => {
            const active = id === rider;
            return (
              <button key={id} type="button" aria-pressed={active} onClick={() => onRider(id)}
                className={`inline-flex min-h-11 shrink-0 items-center rounded-cz border px-3 text-xs ${active ? "border-cz-1 bg-cz-card font-semibold text-cz-1" : "border-cz-border text-cz-2"}`}>
                {shortName(id)}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** V2: et ENKELT valg, rytteren. Programmet staar som en almindelig saetning under. */
function HeadV2({ program, riders, rider, onRider }: { program: ProgramDef; riders: string[]; rider: string; onRider: (id: string) => void }) {
  const own = programOf(rider);
  const shown = own.program ?? program;
  return (
    <>
      <div data-mark="rider-select">
        <label htmlFor="phone-week-rider" className={LABEL}>Week for</label>
        <span className="relative mt-1 block">
          <select id="phone-week-rider" value={rider} onChange={(e) => onRider(e.target.value)}
            className="min-h-11 w-full appearance-none rounded-cz border border-cz-border bg-cz-card pe-9 ps-3 text-sm font-semibold text-cz-1">
            {riders.map((id) => <option key={id} value={id}>{nameOf(id)} · {riderById(id).type}</option>)}
          </select>
          <ChevronDownIcon size={14} aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-cz-3" />
        </span>
      </div>
      <p className="text-xs leading-relaxed text-cz-2" data-mark="program-text">
        {own.via === "own" ? "Own plan: " : "Follows "}
        <span className="font-semibold text-cz-1">{shown.name}</span>
        {own.via === "group" && own.group ? <> via the group {own.group.name}</> : null}
        {" · "}{kindWord(shown.kind)}.{" "}
        <button type="button" className="inline-flex min-h-11 items-center font-medium text-cz-accent-t">Change program</button>
      </p>
    </>
  );
}

function LimitLine1() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-cz-2" data-mark="limit">
      <FlameIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
      <span><span className="font-semibold text-cz-1">Limit {FATIGUE_LIMIT}</span> · above it the rest of the day is active recovery</span>
    </p>
  );
}

// --- A: en dag ad gangen ---------------------------------------------------------------

/** Dagene i EN linje; en pil i hver side flytter en dag. Aktiv dag = hairline i --text-1. */
function DayStrip({ view, day, onDay }: { view: WeekView; day: number; onDay: (d: number) => void }) {
  const arrow = "flex w-9 shrink-0 items-center justify-center rounded-cz text-cz-2 disabled:opacity-40";
  return (
    <div className="flex items-stretch gap-0.5" data-mark="daystrip">
      <button type="button" aria-label="Previous day" disabled={day === 0} onClick={() => onDay(Math.max(0, day - 1))} className={arrow}>
        <ChevronLeftIcon size={18} aria-hidden="true" />
      </button>
      <div className="grid flex-1 grid-cols-7 gap-0.5" role="tablist" aria-label="Day">
        {DAYS.map((x, d) => {
          const active = d === day;
          const races = view.cells[d].filter((c) => c.kind === "race").length;
          return (
            <button key={x.short} type="button" role="tab" aria-selected={active} onClick={() => onDay(d)}
              className={`flex min-h-[54px] min-w-0 flex-col items-center justify-center rounded-cz border text-center ${active ? "border-cz-1 bg-cz-card font-semibold text-cz-1" : "border-cz-border text-cz-2"}`}>
              <span className="text-3xs uppercase tracking-[.04em]">{x.short}</span>
              <span className="font-data text-sm tabular-nums">{x.date}</span>
              <span className="flex h-3 items-center gap-0.5" aria-label={`${races} races`}>
                {races > 0 && <FlagIcon size={10} aria-hidden="true" />}
                {races > 1 && <span className="font-data text-3xs tabular-nums">{races}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-label="Next day" disabled={day === 6} onClick={() => onDay(Math.min(6, day + 1))} className={arrow}>
        <ChevronRightIcon size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

function DayPanel({ view, d, editable, onDay }: { view: WeekView; d: number; editable: boolean; onDay: (d: number) => void }) {
  // Et swipe til siden flytter ogsaa en dag; pilene er den synlige vej.
  const x0 = useRef<number | null>(null);
  return (
    <div onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (x0.current === null) return;
        const dx = e.changedTouches[0].clientX - x0.current;
        x0.current = null;
        if (Math.abs(dx) > 60) onDay(Math.max(0, Math.min(6, d + (dx < 0 ? 1 : -1))));
      }}>
      <h3 className="mb-1.5 text-sm font-semibold text-cz-1">{DAYS[d].long} {DAYS[d].date}{d === TODAY ? " · today" : ""}</h3>
      <DayFields view={view} d={d} />
      <DayFooter view={view} d={d} />
      {editable && <DayBlockEditor d={d} />}
    </div>
  );
}

// --- B: hele ugen som liste, sessionsnavnene skrevet ud ---------------------------------

function InlineName({ c, f }: { c: Cell; f: number }) {
  const n = <span className="font-data text-3xs tabular-nums text-cz-3">{f + 1}</span>;
  if (c.kind === "race") {
    return <>{n}<span className="inline-flex items-center gap-1 font-semibold text-cz-1"><FlagIcon size={11} aria-hidden="true" />{c.stage}</span></>;
  }
  if (c.kind === "restDay") return <>{n}<span className="text-cz-3">Rest day</span></>;
  if (c.limitedFrom) return <>{n}<span className="text-cz-danger">{SESSION_EN[c.session]}</span></>;
  return (
    <>{n}
      <span className="inline-flex items-center gap-1 text-cz-1">
        {c.locked && <LockIcon size={10} aria-label="Locked" className="text-cz-accent-t" />}{SESSION_EN[c.session]}
      </span>
    </>
  );
}

function WeekList({ view, open, editable }: { view: WeekView; open: number; editable: boolean }) {
  return (
    <div className="flex flex-col gap-1.5" data-mark="weeklist">
      {DAYS.map((x, d) => {
        const races = view.cells[d].filter((c) => c.kind === "race").length;
        return (
          <details key={x.short} name="program-week-names" open={d === open} className="group rounded-cz border border-cz-border bg-cz-card">
            <summary className="grid cursor-pointer list-none grid-cols-[54px_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block text-sm font-semibold tabular-nums text-cz-1">{x.short} {x.date}</span>
                <span className="block text-3xs text-cz-2">{d === TODAY ? "Today" : races ? `${races} race${races > 1 ? "s" : ""}` : "No races"}</span>
              </span>
              <ol className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
                {view.cells[d].map((c, f) => (
                  <li key={f} className="inline-flex items-baseline gap-1 whitespace-nowrap text-xs"><InlineName c={c} f={f} /></li>
                ))}
              </ol>
              <span className="flex items-center gap-1.5 pt-0.5">
                <TonightPlate value={view.fatigueTonight[d]} />
                <ChevronDownIcon size={14} aria-hidden="true" className="shrink-0 text-cz-3 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="px-3 pb-3">
              <DayFields view={view} d={d} />
              <DayFooter view={view} d={d} />
              {editable && <DayBlockEditor d={d} />}
            </div>
          </details>
        );
      })}
      <p className="text-3xs leading-relaxed text-cz-3">Number = field (LD 1-5) · flag = race · lock = never taken by a race · red = fatigue limit · plate = fatigue tonight</p>
    </div>
  );
}

// --- Gem fast i bunden -------------------------------------------------------------------

/** Sidens ene guldknap. Paa telefonen fast i bunden (over appens bundnavigation). */
function SaveBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-cz-border bg-cz-card px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3" data-mark="savebar">
      <Button className="w-full">Save plan</Button>
    </div>
  );
}

// --- Samlet ------------------------------------------------------------------------------

export type PhoneProps = {
  mode: PhoneMode; head: "v1" | "v2"; startView: "day" | "week"; startDay: number;
  kind: Kind; program: ProgramDef; riders: string[]; rider: string; onRider: (id: string) => void; view: WeekView;
};

export default function ProgramPhone({ mode, head, startView, startDay, kind, program, riders, rider, onRider, view }: PhoneProps) {
  const [day, setDay] = useState(startDay);
  const [shown, setShown] = useState<"day" | "week">(startView);
  const asWeek = mode === "b" || (mode === "switch" && shown === "week");
  const Head = mode === "v2" || (mode === "switch" && head === "v2") ? HeadV2 : HeadV1;
  const editable = kind === "week";
  return (
    <div className="flex flex-col gap-3 pb-8">
      <Head program={program} riders={riders} rider={rider} onRider={onRider} />
      <LimitLine1 />
      <div className="flex items-center justify-between gap-3" data-mark="summary">
        <p className="min-w-0 text-3xs leading-snug text-cz-2">{view.summary}</p>
        {mode === "switch" && (
          <Segmented label="View" value={shown} onChange={(v: "day" | "week") => setShown(v)}
            options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }]} />
        )}
      </div>
      {asWeek
        ? <WeekList key={`${kind}-${rider}`} view={view} open={startDay} editable={editable} />
        : (
          <>
            <DayStrip view={view} day={day} onDay={setDay} />
            <DayPanel key={`${kind}-${rider}`} view={view} d={day} editable={editable} onDay={setDay} />
          </>
        )}
      <p className="text-3xs text-cz-3">Today's fields lock after Train now. A saved plan then applies from tomorrow.</p>
      <SaveBar />
    </div>
  );
}
