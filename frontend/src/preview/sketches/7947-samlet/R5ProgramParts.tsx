// #7456/#7947 R5 fanen Program (ejer 20/11): data, den rene ugemodel og de
// byggesten, som baade desktop-fanen og de tre telefonmuligheder bruger.
// Alt er SKITSE-eksempler (navne fra ejerens hold i r5data.ts); intet her er
// motorens regel. Ordene foelger ejerens beslutninger paa #7456:
// - et loeb koerer altid og tager laveste prioritet foerst,
// - eet laast pas pr. dag; laasen beskytter kun mod loeb,
// - traethedsgraensen vinder over laasen (resten af dagen foelger managerens valg),
// - i Week blocks indhentes pas taget af loeb ikke; i Rotation venter rotationen,
// - programmer saettes kun paa en gruppe eller en rytter, rytterens egen plan
//   vinder over gruppens, og "No program" faar ingen advarsel.

import { useLayoutEffect, useRef, useState } from "react";
import Portal from "../../../components/ui/Portal.jsx";
import { useModalA11y } from "../../../hooks/useModalA11y.js";
import {
  CalendarIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ClipboardIcon, FlagIcon, FlameIcon,
  GripVerticalIcon, LockIcon, RefreshIcon, XIcon,
} from "../../../components/ui/icons/index.jsx";
import type { Session } from "./model.ts";
import { EFFORT_TONE, EFFORT_WORD, effortOf, fillRotation } from "./r5model.ts";
import { BLOCKS, FOLLOWERS, ROTATION, SESSION_EN, TEAM } from "./r5data.ts";
import { FatiguePlate } from "./R5Parts.tsx";

// --- Ugen --------------------------------------------------------------------

export const DAYS = [
  { short: "Mon", long: "Monday", date: 16 },
  { short: "Tue", long: "Tuesday", date: 17 },
  { short: "Wed", long: "Wednesday", date: 18 },
  { short: "Thu", long: "Thursday", date: 19 },
  { short: "Fri", long: "Friday", date: 20 },
  { short: "Sat", long: "Saturday", date: 21 },
  { short: "Sun", long: "Sunday", date: 22 },
] as const;
export const TODAY = 1; // tirsdag 17, samme dag som fanen Day
export const FIELD_TIME = ["11:00", "13:00", "15:00", "17:00", "19:00"];
export const FIELDS = [0, 1, 2, 3, 4] as const;

// To bogstaver pr. pas til rotationsbaandet og telefonens gitter (forklaret i en legende).
export const CODE: Record<Session, string> = {
  rest: "RE", recovery: "AR", technique: "TQ", aero: "AE", loebslaere: "RC",
  endurance: "EN", tempo: "TE", vo2max: "VO", vo2max_climb: "VC", vo2max_punch: "VP",
  threshold: "TH", sprint: "SP", cobbled_sectors: "CS", echelon_drills: "EC", attack_repeats: "AT",
};

// --- Biblioteket (ejer 20/11): programmer, grupper, egne planer --------------

export type Kind = "week" | "rotation";
export type ProgramDef = { id: string; name: string; kind: Kind; detail: string };
export const LIBRARY: ProgramDef[] = [
  { id: "team-week", name: "Team week", kind: "week", detail: "7 day blocks" },
  { id: "ardennes", name: "Ardennes", kind: "rotation", detail: `${ROTATION.length} sessions` },
  { id: "tt-block", name: "Time trial block", kind: "week", detail: "7 day blocks" },
];

export type Group = { id: string; name: string; riders: string[]; program: string };
export const GROUPS: Group[] = [
  { id: "g1", name: "Stage racers", riders: ["r1", "r2", "r3", "r5"], program: "team-week" },
  { id: "g2", name: "Hills", riders: ["r4", "r6", "r7"], program: "ardennes" },
];
// Rytterens egen plan vinder over gruppens (Sota er i Stage racers, men koerer sin egen).
export const OWN_PLAN: Record<string, string> = { r5: "tt-block", r9: "team-week" };

export const riderById = (id: string) => TEAM.find((r) => r.id === id)!;
export const groupOf = (riderId: string) => GROUPS.find((g) => g.riders.includes(riderId)) ?? null;
/** Hvilket program rytteren faktisk foelger, og hvorfra. */
export function programOf(riderId: string): { program: ProgramDef | null; via: "own" | "group" | null; group: Group | null } {
  const group = groupOf(riderId);
  const own = OWN_PLAN[riderId];
  if (own) return { program: LIBRARY.find((p) => p.id === own)!, via: "own", group };
  if (group) return { program: LIBRARY.find((p) => p.id === group.program)!, via: "group", group };
  return { program: null, via: null, group: null };
}
/** Hvem programmet sidder paa: grupper (minus dem med egen plan) og enkelte ryttere. */
export function usersOf(programId: string) {
  const groups = GROUPS.filter((g) => g.program === programId).map((g) => ({
    group: g, following: g.riders.filter((id) => programOf(id).program?.id === programId),
  }));
  const riders = Object.entries(OWN_PLAN).filter(([, p]) => p === programId).map(([id]) => id);
  return { groups, riders };
}

// --- Cellerne i ugen ----------------------------------------------------------

export type Cell =
  | { kind: "race"; event: string; stage: string }
  | { kind: "restDay" }
  | {
    kind: "session"; session: Session; prio?: number; n?: number; locked?: boolean;
    movedFrom?: number; limitedFrom?: Session;
  };

export type WeekView = {
  cells: Cell[][]; // 7 dage x 5 felter
  taken: Session[][]; // Week blocks: pas loeb tog (indhentes ikke)
  limitAfter: Record<number, number>; // dag -> sidste felt foer traethedsgraensen
  fatigueTonight: number[];
  summary: string;
};

export type DayBlock = { locked: Session | null; prio: Session[] };
export const DAY_BLOCKS: DayBlock[] = BLOCKS.map((b) => ({
  locked: b.sessions[b.locked],
  prio: b.sessions.filter((_, i) => i !== b.locked),
}));

type RaceSlot = { event: string; stage: string } | null;
const RACE = "Ronde van Preview";
const none = (): RaceSlot[] => [null, null, null, null, null];
// Henok Nguse (Stage racers): etapeloebet i de faste felter, saa ugen viser
// to loeb paa een dato, en laas der flytter og et loeb i dagens felt 3 (som fanen Day).
const HENOK_RACES: RaceSlot[][] = [
  [{ event: RACE, stage: "Stage 1" }, null, null, null, { event: RACE, stage: "Stage 2" }],
  [null, null, { event: RACE, stage: "Stage 3" }, null, null],
  [null, null, { event: RACE, stage: "Stage 4" }, null, null],
  [null, null, { event: RACE, stage: "Stage 5" }, null, null],
  none(), none(), none(),
];
// Torsdag rammer Henok sin graense efter felt 4: felt 5 bliver managerens valg, ogsaa det laaste pas.
const HENOK_LIMIT: Record<number, number> = { 3: 3 };
export const FATIGUE_LIMIT = 70; // holdets regel (eksempel, managerens eget valg)
const HENOK_TONIGHT = [56, 61, 64, 71, 58, 49, 41];

/**
 * Week blocks: laasen har hjemme i felt 5 og flytter til naermeste ledige felt,
 * hvis et loeb staar der. De ledige felter fyldes i prioritetsraekkefoelge; loeb
 * tager laveste prioritet foerst, og de pas indhentes ikke.
 */
export function fillWeekBlocks(blocks: DayBlock[], races: RaceSlot[][], limitAfter: Record<number, number>) {
  const taken: Session[][] = [];
  const cells = blocks.map((b, d) => {
    const row: Cell[] = races[d].map((r) => (r ? { kind: "race", event: r.event, stage: r.stage } : { kind: "restDay" }));
    const free = FIELDS.filter((f) => races[d][f] === null);
    let left = [...free];
    if (b.locked) {
      const home = 4;
      const at = left.includes(home) ? home : left[left.length - 1];
      if (at !== undefined) {
        row[at] = { kind: "session", session: b.locked, locked: true, movedFrom: at === home ? undefined : home };
        left = left.filter((f) => f !== at);
      }
    }
    // Flere ledige felter end pas i blokken: resten staar som hvile (ingen opdigtede pas).
    left.forEach((f, i) => { if (b.prio[i]) row[f] = { kind: "session", session: b.prio[i], prio: i + 1 }; });
    taken.push(b.prio.slice(Math.min(left.length, b.prio.length)));
    return applyLimit(row, limitAfter[d]);
  });
  return { cells, taken };
}

// Traethedsgraensen vinder over laasen: efter graensen bliver resten af dagen
// managerens valg (her Active recovery). Et loeb koerer altid.
function applyLimit(row: Cell[], after: number | undefined): Cell[] {
  if (after === undefined) return row;
  return row.map((c, f) => (f > after && c.kind === "session"
    ? { ...c, session: "recovery", limitedFrom: c.session }
    : c));
}

export function weekBlocksView(): WeekView {
  const { cells, taken } = fillWeekBlocks(DAY_BLOCKS, HENOK_RACES, HENOK_LIMIT);
  const raceFields = HENOK_RACES.flat().filter(Boolean).length;
  return {
    cells, taken, limitAfter: HENOK_LIMIT, fatigueTonight: HENOK_TONIGHT,
    summary: `${35 - raceFields} of 35 fields training · races took ${raceFields} sessions`,
  };
}

export const ROTATION_RIDERS = FOLLOWERS.map((f) => {
  const rider = riderById(f.id);
  const race = (d: number) => (d === 5 ? "Trofeo Preview" : d === 6 ? "GP Preview" : RACE);
  const res = fillRotation(ROTATION, f.start, f.blocked, race);
  return { ...f, rider, ...res };
});
const ROT_TONIGHT: Record<string, number[]> = {
  r4: [48, 55, 59, 62, 57, 66, 52], r6: [44, 52, 57, 38, 50, 55, 58], r7: [51, 58, 63, 66, 60, 54, 69],
};
const ROT_LIMIT: Record<string, Record<number, number>> = { r4: {}, r6: {}, r7: {} };

export function rotationView(riderId: string): WeekView {
  const r = ROTATION_RIDERS.find((x) => x.id === riderId)!;
  const cells: Cell[][] = r.week.map((day) => day.map((c): Cell => {
    if (c.kind === "race") return { kind: "race", event: c.label, stage: "One-day race" };
    if (c.kind === "restDay") return { kind: "restDay" };
    return { kind: "session", session: c.session, n: c.n };
  }));
  return {
    cells, taken: cells.map(() => []), limitAfter: ROT_LIMIT[riderId] ?? {}, fatigueTonight: ROT_TONIGHT[riderId] ?? [],
    summary: `${r.ridden} of 35 ridden · ${r.carried} carried to next week`,
  };
}

// --- Smaa byggesten -----------------------------------------------------------

export const LABEL = "font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3";

export function KindIcon({ kind, size = 14 }: { kind: Kind; size?: number }) {
  return kind === "week"
    ? <CalendarIcon size={size} aria-hidden="true" className="shrink-0 text-cz-3" />
    : <RefreshIcon size={size} aria-hidden="true" className="shrink-0 text-cz-3" />;
}

export function EffortWord({ session }: { session: Session }) {
  const e = effortOf(session);
  return <span className={EFFORT_TONE[e]}>{EFFORT_WORD[e]}</span>;
}

/** Eet felt i ugen. `size` styrer kun taetheden; anatomien er den samme overalt. */
export function CellBody({ cell, field, compact = false }: { cell: Cell; field: number; compact?: boolean }) {
  if (cell.kind === "race") {
    return (
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1 text-xs font-semibold text-cz-1">
          <FlagIcon size={12} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{cell.event}</span>
        </span>
        <span className="truncate font-data text-3xs tabular-nums text-cz-2">{cell.stage} · {FIELD_TIME[field]}</span>
      </span>
    );
  }
  if (cell.kind === "restDay") return <span className="text-xs text-cz-3">Rest day</span>;
  const meta = cell.limitedFrom
    ? <span className="text-cz-danger">Fatigue limit · was {SESSION_EN[cell.limitedFrom]}</span>
    : cell.locked
      ? <span className="inline-flex items-center gap-1 text-cz-accent-t"><LockIcon size={10} aria-hidden="true" />Locked{cell.movedFrom !== undefined ? ` · from LD ${cell.movedFrom + 1}` : ""}</span>
      : cell.prio ? <span className="text-cz-3">Priority {cell.prio}</span> : <EffortWord session={cell.session} />;
  return (
    <span className="flex min-w-0 flex-col">
      <span className={`truncate text-xs ${cell.limitedFrom ? "text-cz-2" : "font-medium text-cz-1"} ${compact ? "" : "pe-5"}`}>{SESSION_EN[cell.session]}</span>
      <span className="truncate text-3xs">{meta}</span>
    </span>
  );
}

export function cellTone(cell: Cell) {
  if (cell.kind === "race") return "bg-cz-subtle";
  if (cell.kind === "restDay") return "bg-cz-card";
  return "bg-cz-card";
}

/** Traethedsgraensens linje mellem to felter: hvor dagen skifter til managerens valg. */
export function LimitLine({ label = true }: { label?: boolean }) {
  return (
    <span className="flex items-center gap-1.5" role="note" aria-label={`Fatigue limit ${FATIGUE_LIMIT} reached`}>
      <span className="h-0 flex-1 border-t-2 border-dashed border-cz-danger" />
      {label && <span className="shrink-0 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-danger">Limit {FATIGUE_LIMIT} · rest of day: active recovery</span>}
      <span className="h-0 flex-1 border-t-2 border-dashed border-cz-danger" />
    </span>
  );
}

export function TonightPlate({ value }: { value: number }) {
  return <FatiguePlate value={value} label="Fatigue tonight" />;
}

// --- Telefon: tre muligheder for ugeskemaet ---------------------------------

/** En lodret liste over dagens fem felter (A og B). */
function DayFields({ view, d }: { view: WeekView; d: number }) {
  return (
    <ol className="rounded-cz border border-cz-border bg-cz-card">
      {FIELDS.map((f) => {
        const c = view.cells[d][f];
        return (
          <li key={f} className="border-t border-cz-border first:border-t-0">
            <button type="button" className={`grid min-h-[52px] w-full grid-cols-[52px_1fr_auto] items-center gap-2 px-3 py-1.5 text-start ${cellTone(c)}`}>
              <span className="font-data text-3xs leading-tight tabular-nums text-cz-3">LD {f + 1}<span className="block">{FIELD_TIME[f]}</span></span>
              <CellBody cell={c} field={f} compact />
              {c.kind === "session" && !c.limitedFrom
                ? <GripVerticalIcon size={14} aria-label="Drag to change order" className="text-cz-3" />
                : <span />}
            </button>
            {view.limitAfter[d] === f && <div className="px-3 pb-1.5"><LimitLine /></div>}
          </li>
        );
      })}
    </ol>
  );
}

function DayFooter({ view, d }: { view: WeekView; d: number }) {
  const taken = view.taken[d];
  return (
    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-cz-2">
      <span className="min-w-0">{taken.length ? <>Races took: {taken.map((s) => SESSION_EN[s]).join(", ")}</> : "All sessions ridden"}</span>
      {view.fatigueTonight[d] !== undefined && (
        <span className="inline-flex shrink-0 items-center gap-1.5">Tonight <TonightPlate value={view.fatigueTonight[d]} /></span>
      )}
    </div>
  );
}

function DayBlockEditor({ d }: { d: number }) {
  const b = DAY_BLOCKS[d];
  return (
    <section className="mt-3" aria-label={`${DAYS[d].long} order`}>
      <div className="mb-1.5 flex items-center justify-between">
        <h4 className={LABEL}>{DAYS[d].long}'s order</h4>
        <button type="button" className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-cz-2">
          <ClipboardIcon size={14} aria-hidden="true" />Copy day
        </button>
      </div>
      <ol className="rounded-cz border border-cz-border bg-cz-card">
        {b.locked && (
          <li className="flex min-h-11 items-center gap-2 px-3">
            <LockIcon size={13} aria-label="Locked" className="shrink-0 text-cz-accent-t" />
            <span className="flex-1 text-xs font-medium text-cz-1">{SESSION_EN[b.locked]}</span>
            <span className="text-3xs text-cz-3">Races never take it</span>
          </li>
        )}
        {b.prio.map((s, i) => (
          <li key={i} className="flex min-h-11 items-center gap-2 border-t border-cz-border px-3">
            <span className="w-3 font-data text-2xs tabular-nums text-cz-3">{i + 1}</span>
            <span className="flex-1 text-xs text-cz-1">{SESSION_EN[s]}</span>
            <GripVerticalIcon size={14} aria-label="Drag to change order" className="text-cz-3" />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A · een dag ad gangen: dagsvaelger + vandret swipe med scroll-snap. */
export function PhoneDayAtATime({ view, start, editable }: { view: WeekView; start: number; editable: boolean }) {
  const [day, setDay] = useState(start);
  const track = useRef<HTMLDivElement>(null);
  const go = (d: number, smooth = true) => {
    const el = track.current?.children[d] as HTMLElement | undefined;
    track.current?.scrollTo({ left: el ? el.offsetLeft - (track.current?.offsetLeft ?? 0) : 0, behavior: smooth ? "smooth" : "instant" });
    setDay(d);
  };
  // Startdagen staar i sporet fra foerste billede (uden glidende rul).
  useLayoutEffect(() => {
    const place = () => {
      const t = track.current;
      const el = t?.children[start] as HTMLElement | undefined;
      if (t && el) t.scrollLeft = el.offsetLeft - t.offsetLeft;
    };
    place();
    // Fonte og faner kan flytte bredden efter foerste maaling; saet dagen igen naar layoutet staar.
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [start]);
  // Fanger hvor sporet falder til ro, saa vaelgeren foelger et swipe.
  const settle = useRef<number | undefined>(undefined);
  const onScrollEnd = () => {
    const t = track.current;
    if (!t) return;
    const d = Math.round(t.scrollLeft / t.clientWidth);
    if (d !== day) setDay(d);
  };
  // Reserve til browsere uden scrollend: vent til rullen har staaet stille et oejeblik.
  const onScroll = () => { window.clearTimeout(settle.current); settle.current = window.setTimeout(onScrollEnd, 120); };
  return (
    <div>
      <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Day">
        {DAYS.map((x, d) => {
          const active = d === day;
          const races = view.cells[d].filter((c) => c.kind === "race").length;
          return (
            <button key={x.short} type="button" role="tab" aria-selected={active} onClick={() => go(d)}
              className={`flex min-h-[54px] flex-col items-center justify-center rounded-cz border text-center ${active ? "border-cz-1 bg-cz-card font-semibold text-cz-1" : "border-cz-border text-cz-2"}`}>
              <span className="text-3xs uppercase tracking-[.06em]">{x.short}</span>
              <span className="font-data text-sm tabular-nums">{x.date}</span>
              <span className="flex h-3 items-center gap-0.5" aria-label={`${races} races`}>
                {races > 0 && <FlagIcon size={10} aria-hidden="true" />}
                {races > 1 && <span className="font-data text-3xs tabular-nums">{races}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button type="button" aria-label="Previous day" onClick={() => go(Math.max(0, day - 1))} disabled={day === 0}
          className="inline-flex h-11 w-11 items-center justify-center rounded-cz text-cz-2 disabled:opacity-40"><ChevronLeftIcon size={18} /></button>
        <span className="text-sm font-semibold text-cz-1">{DAYS[day].long} {DAYS[day].date}{day === TODAY ? " · today" : ""}</span>
        <button type="button" aria-label="Next day" onClick={() => go(Math.min(6, day + 1))} disabled={day === 6}
          className="inline-flex h-11 w-11 items-center justify-center rounded-cz text-cz-2 disabled:opacity-40"><ChevronRightIcon size={18} /></button>
      </div>
      <div ref={track} onScroll={onScroll} className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none]" aria-live="polite">
        {DAYS.map((x, d) => (
          <div key={x.short} className="min-w-0 shrink-0 basis-full overflow-hidden snap-center snap-always" aria-hidden={d !== day} inert={d !== day}>
            <DayFields view={view} d={d} />
            <DayFooter view={view} d={d} />
            {editable && <DayBlockEditor d={d} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Fem smaa felter som eet overblik i en raekke (B's sammenfoldede dag). */
function MiniStrip({ cells }: { cells: Cell[] }) {
  return (
    <span className="grid grid-cols-5 gap-0.5" aria-hidden="true">
      {cells.map((c, f) => (
        <span key={f} className={`flex h-6 w-8 items-center justify-center rounded-cz border font-data text-3xs font-semibold ${
          c.kind === "race" ? "border-cz-border-strong bg-cz-subtle text-cz-1"
            : c.kind === "session" && c.limitedFrom ? "border-dashed border-cz-danger text-cz-danger"
              : "border-cz-border text-cz-1"}`}>
          {c.kind === "race" ? <FlagIcon size={10} /> : c.kind === "restDay" ? "RE" : c.locked ? <LockIcon size={10} /> : CODE[c.session]}
        </span>
      ))}
    </span>
  );
}

/** B · hele ugen som lodret liste; en dag foldes ud ad gangen (details name). */
export function PhoneWeekList({ view, open }: { view: WeekView; open: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {DAYS.map((x, d) => {
        const races = view.cells[d].filter((c) => c.kind === "race").length;
        return (
          <details key={x.short} name="program-week" open={d === open} className="group rounded-cz border border-cz-border bg-cz-card">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-3 [&::-webkit-details-marker]:hidden">
              <span className="w-[68px] shrink-0">
                <span className="block text-sm font-semibold text-cz-1">{x.short} {x.date}</span>
                <span className="block text-3xs text-cz-2">{d === TODAY ? "Today · " : ""}{races ? `${races} race${races > 1 ? "s" : ""}` : "No races"}</span>
              </span>
              <span className="flex-1"><MiniStrip cells={view.cells[d]} /></span>
              <ChevronDownIcon size={16} aria-hidden="true" className="shrink-0 text-cz-3 transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-3 pb-3">
              <DayFields view={view} d={d} />
              <DayFooter view={view} d={d} />
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** C · kompakt 7x5-gitter med koder; et tryk aabner feltet i et ark. */
export function PhoneGrid({ view, sheet }: { view: WeekView; sheet: { d: number; f: number } | null }) {
  const [open, setOpen] = useState(sheet);
  return (
    <div>
      <div className="grid grid-cols-[30px_repeat(7,minmax(0,1fr))] gap-0.5" role="grid" aria-label="Week">
        <span />
        {DAYS.map((x, d) => (
          <span key={x.short} className={`pb-1 text-center leading-tight ${d === TODAY ? "font-semibold text-cz-1" : "text-cz-2"}`}>
            <span className="block text-3xs uppercase">{x.short}</span>
            <span className="block font-data text-xs tabular-nums">{x.date}</span>
          </span>
        ))}
        {FIELDS.map((f) => (
          <Row key={f} f={f} view={view} onOpen={(d) => setOpen({ d, f })} active={open} />
        ))}
        <span className="flex items-center text-cz-3"><FlameIcon size={13} aria-label="Fatigue tonight" /></span>
        {DAYS.map((x, d) => (
          <span key={x.short} className="flex justify-center pt-1"><TonightPlate value={view.fatigueTonight[d]} /></span>
        ))}
      </div>
      <p className="mt-2 text-3xs leading-relaxed text-cz-3">
        SP Sprint · TE Tempo · EN Endurance · TQ Technique · AE Aero · VO VO2max · TH Threshold · AR Active recovery · flag = race · flame = fatigue tonight
      </p>
      {open && <CellSheet view={view} at={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Row({ f, view, onOpen, active }: { f: number; view: WeekView; onOpen: (d: number) => void; active: { d: number; f: number } | null }) {
  return (
    <>
      <span className="flex items-center font-data text-3xs tabular-nums text-cz-3">LD{f + 1}</span>
      {DAYS.map((x, d) => {
        const c = view.cells[d][f];
        const limitHere = view.limitAfter[d] !== undefined && f > view.limitAfter[d];
        const isActive = active?.d === d && active.f === f;
        return (
          <button key={x.short} type="button" onClick={() => onOpen(d)}
            aria-label={`${x.long} LD ${f + 1}: ${c.kind === "race" ? `race, ${c.event}` : c.kind === "restDay" ? "rest day" : SESSION_EN[c.session]}`}
            className={`relative flex h-11 items-center justify-center rounded-cz border font-data text-xs font-semibold ${
              c.kind === "race" ? "border-cz-border-strong bg-cz-subtle text-cz-1"
                : limitHere ? "border-dashed border-cz-danger text-cz-danger"
                  : "border-cz-border bg-cz-card text-cz-1"} ${isActive ? "outline-2 outline-offset-1 outline-cz-accent-t" : ""}`}>
            {c.kind === "race" ? <FlagIcon size={13} aria-hidden="true" /> : c.kind === "restDay" ? "RE" : CODE[c.session]}
            {c.kind === "session" && c.locked && <LockIcon size={9} aria-hidden="true" className="absolute end-0.5 top-0.5 text-cz-accent-t" />}
            {c.kind === "session" && c.n !== undefined && <span className="absolute end-0.5 top-0 font-data text-3xs font-normal text-cz-3">{c.n}</span>}
          </button>
        );
      })}
    </>
  );
}

const PICK: Session[] = ["recovery", "endurance", "technique", "tempo", "threshold", "sprint", "vo2max"];

function CellSheet({ view, at, onClose }: { view: WeekView; at: { d: number; f: number }; onClose: () => void }) {
  const ref = useModalA11y(onClose, true);
  const c = view.cells[at.d][at.f];
  const titleId = "program-cell-sheet";
  return (
    <Portal>
      <div className="fixed inset-0 z-modal flex items-end justify-center">
        <div className="cz-overlay-backdrop absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
        <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
          className="cz-overlay-panel relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-cz border-x border-b-0 border-t border-cz-border bg-cz-card px-4 pb-4 pt-4 shadow-overlay outline-hidden">
          <button type="button" onClick={onClose} aria-label="Close"
            className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-cz text-cz-3 hover:bg-cz-subtle hover:text-cz-1">
            <XIcon size={18} aria-hidden="true" />
          </button>
          <p className={LABEL}>{DAYS[at.d].long} {DAYS[at.d].date} · LD {at.f + 1} · {FIELD_TIME[at.f]}</p>
          <h3 id={titleId} className="mt-1 text-base font-semibold text-cz-1">
            {c.kind === "race" ? c.event : c.kind === "restDay" ? "Rest day" : SESSION_EN[c.session]}
          </h3>
          {c.kind === "session" && c.limitedFrom && (
            <p className="mt-1 text-xs text-cz-2">
              Planned: <span className="font-medium text-cz-1">{SESSION_EN[c.limitedFrom]}</span>{c.locked ? " (locked)" : ""}. Fatigue tonight passes the limit after LD {at.f}, so the rest of the day is active recovery. The limit beats the lock; a race would still run.
            </p>
          )}
          {c.kind === "race" && <p className="mt-1 text-xs text-cz-2">{c.stage} · races sit in their fixed field and always run.</p>}
          {c.kind === "session" && (
            <>
              <p className={`${LABEL} mt-4 mb-1.5`}>Planned session</p>
              <div className="flex flex-wrap gap-1.5">
                {PICK.map((s) => (
                  <button key={s} type="button" aria-pressed={s === (c.limitedFrom ?? c.session)}
                    className={`min-h-11 rounded-cz border px-3 text-xs ${s === (c.limitedFrom ?? c.session) ? "border-cz-1 font-semibold text-cz-1" : "border-cz-border text-cz-2"}`}>
                    {SESSION_EN[s]}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-cz-border pt-3">
                <span className="inline-flex items-center gap-2 text-sm text-cz-1"><LockIcon size={14} aria-hidden="true" />Lock this session</span>
                <span className="text-xs text-cz-2">{c.locked ? "On · one per day" : "Off"}</span>
              </div>
              <button type="button" className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-cz-2">
                <ClipboardIcon size={14} aria-hidden="true" />Copy {DAYS[at.d].long} to other days
              </button>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}

