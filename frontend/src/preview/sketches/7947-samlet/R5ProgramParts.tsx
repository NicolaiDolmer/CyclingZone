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

import {
  CalendarIcon, ClipboardIcon, FlagIcon, GripVerticalIcon, LockIcon, RefreshIcon,
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

// --- Telefon: byggestenene til dagen (selve varianterne ligger i R5ProgramPhone.tsx) ---

/** En lodret liste over dagens fem felter. */
export function DayFields({ view, d }: { view: WeekView; d: number }) {
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

export function DayFooter({ view, d }: { view: WeekView; d: number }) {
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

export function DayBlockEditor({ d }: { d: number }) {
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
