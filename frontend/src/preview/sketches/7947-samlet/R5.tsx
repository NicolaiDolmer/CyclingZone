// #7947 retning 5: traeningssiden tegnet praecis efter ejerens punkt 1-9 (17/11,
// kommentarerne paa #7947), farveskalaen #8364, "Day load" som ord + pil (#8354),
// Train now-oejeblikket #8363 og programmernes to wireframes (#7456).
// Al skitsetekst er engelsk (spillets primaere sprog). Intet her er produktkode;
// skitsen gemmer intet, og alle tal er eksempler.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Button from "../../../components/ui/Button.jsx";
import { Segmented } from "../../../components/ui/Segmented.jsx";
import { Dropdown, MenuItem } from "../../../components/ui/Menu.jsx";
import { Tabs, TabList, Tab } from "../../../components/ui/Tabs.jsx";
import {
  AlertTriangleIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon,
  ChevronRightIcon, FlagIcon, GiftIcon, LockIcon, SortIcon,
} from "../../../components/ui/icons/index.jsx";
import type { Session } from "./model.ts";
import { quickPattern } from "./r4model.ts";
import {
  DAY_LOAD_ARROW, DAY_LOAD_TONE, DAY_LOAD_WORD, EFFORT_TONE, EFFORT_WORD, EFFORTS,
  dayEffort, dayLoad, effortOf, fatigueStep, type Effort,
} from "./r5model.ts";
import { DATES, RACE, SESSION_EN, SESSION_GROUPS_EN, TEAM, programFields, type R5Rider } from "./r5data.ts";
import TodaysTraining from "./R5Moment.tsx";
import { ArrowMark, FatiguePlate, RiderName } from "./R5Parts.tsx";
import ProgramTab from "./R5Program.tsx";
import DevelopmentTab from "./R5Development.tsx";
import ReportTab, { type ReportRange } from "./R5Report.tsx";

export type R5Init = {
  tab: "day" | "program" | "development" | "report";
  range: ReportRange;
  moment: boolean;
  frame: number | null;
  pressed: boolean;
  date: number;
  allSessions: boolean;
  open: string[];
  menu: string | null;
  filter: Filter | null;
  mode: "week" | "rotation";
};

type Filter = "training" | "racing" | "tired" | "noProgram";
type Field = Session | "stage";
type SortKey = "rider" | "type" | "program" | "fatigue" | "load";

// Startbilledet viser ejerens tilstande paa een gang: et valg paa en
// programrytter (gaelder kun datoen), et manuelt felt, tre i loeb, en over
// traethedsgraensen og en uden program.
const START_CHOICE: Record<string, Record<number, Effort>> = { r4: { 0: "hard" } };
const START_MANUAL: Record<string, Record<number, Record<number, Session>>> = { r5: { 0: { 3: "aero" } } };

const QUICK_EFFORT = { easy: "let", medium: "mellem", hard: "hard" } as const;

function fieldsFor(rider: R5Rider, date: number, choice: Effort | null, manual: Record<number, Session>): Field[] {
  const base = programFields(rider, date);
  const pattern: Session[] | null = choice === null ? null
    : choice === "rest" ? ["rest", "rest", "rest", "rest", "rest"]
    : quickPattern({ kind: "effort", effort: QUICK_EFFORT[choice], type: rider.typeKey });
  let k = 0;
  return base.map((f, i) => {
    if (f === "stage") return f;
    const fromPattern = pattern ? pattern[k] ?? pattern[pattern.length - 1] : f;
    k += 1;
    return manual[i] ?? fromPattern;
  });
}

const trainingOnly = (fields: readonly Field[]): Session[] => fields.filter((f): f is Session => f !== "stage");

// --- Smaa byggesten ---------------------------------------------------------

function DayLoadCell({ fields, overLimit, compact = false }: { fields: readonly Field[]; overLimit: boolean; compact?: boolean }) {
  const load = dayLoad(fields);
  return (
    <span className={`inline-flex items-center gap-1 ${compact ? "text-xs" : "text-[13px]"} ${DAY_LOAD_TONE[load]}`}>
      <ArrowMark arrow={DAY_LOAD_ARROW[load]} />
      <span className={compact ? "leading-tight" : "whitespace-nowrap"}>{DAY_LOAD_WORD[load]}</span>
      {overLimit && <AlertTriangleIcon size={13} aria-label="Over the fatigue limit" className="shrink-0 text-cz-danger" />}
    </span>
  );
}

function ProgramButton({ rider, defaultOpen, full = false }: { rider: R5Rider; defaultOpen: boolean; full?: boolean }) {
  const label = rider.program ?? "No program";
  return (
    <Dropdown
      defaultOpen={defaultOpen}
      className={full ? "w-full" : ""}
      trigger={({ open, toggle }: { open: boolean; toggle: () => void }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu"
          aria-label={`${rider.name}: program ${label}`}
          className={`inline-flex max-w-full items-center justify-between gap-1.5 rounded-cz border px-2 py-1 text-xs font-medium hover:border-cz-3 max-sm:min-h-11 ${full ? "w-full" : "w-[150px]"} ${
            rider.program ? "border-cz-border text-cz-1" : "border-cz-warning/50 text-cz-warning"}`}>
          <span className="inline-flex min-w-0 items-center gap-1">
            {!rider.program && <AlertTriangleIcon size={12} aria-hidden="true" className="shrink-0" />}
            <span className="truncate">{label}</span>
          </span>
          <ChevronDownIcon size={12} aria-hidden="true" className="shrink-0 text-cz-3" />
        </button>
      )}
    >
      {rider.program ? (
        <>
          <MenuItem>Pause today</MenuItem>
          <MenuItem>Remove</MenuItem>
          <MenuItem disabled className="opacity-40">Undo</MenuItem>
        </>
      ) : (
        <>
          <MenuItem>Team week</MenuItem>
          <MenuItem>Ardennes</MenuItem>
          <MenuItem>Time trial block</MenuItem>
        </>
      )}
    </Dropdown>
  );
}

function EffortWord({ effort }: { effort: Effort }) {
  return <span className={EFFORT_TONE[effort]}>{EFFORT_WORD[effort]}</span>;
}

function QuickSelect({ rider, choice, onChoice, programEffort, dateWord, full = false, readOnly }: {
  rider: R5Rider; choice: Effort | null; onChoice: (e: Effort | null) => void; programEffort: Effort; dateWord: string; full?: boolean; readOnly: boolean;
}) {
  if (readOnly) {
    return <span className="inline-flex items-center gap-1 text-xs text-cz-3"><CheckIcon size={12} aria-hidden="true" className="text-cz-success" />Trained · <EffortWord effort={choice ?? programEffort} /></span>;
  }
  return (
    <div className={`flex items-center gap-3 ${full ? "flex-col items-stretch gap-1.5" : ""}`}>
      <div className={full ? "[&_button]:flex-1" : ""}>
        <Segmented
          label={`${rider.name}: training ${dateWord}`}
          value={choice ?? "none"}
          onChange={(v: Effort) => onChoice(v)}
          options={EFFORTS.map((e) => ({ value: e, label: EFFORT_WORD[e] }))}
          className={full ? "w-full" : ""}
        />
      </div>
      <span className="whitespace-nowrap text-2xs text-cz-2">
        {choice === null ? (
          <>{rider.program ? "Program" : "Default"}: <EffortWord effort={programEffort} /></>
        ) : (
          <>{dateWord === "today" ? "Today only" : `${dateWord} only`} · <button type="button" onClick={() => onChoice(null)}
            className="font-medium text-cz-1 underline decoration-cz-border underline-offset-2 hover:decoration-cz-1">Back to program</button></>
        )}
      </span>
    </div>
  );
}

function RaceCell({ date, fields }: { date: number; fields: readonly Field[] }) {
  const field = fields.indexOf("stage") + 1;
  const label = DATES[date].race ?? "Race";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-cz-1">
      <LockIcon size={12} aria-hidden="true" className="text-cz-3" />
      <span className="font-semibold">{label}</span>
      <span className="text-cz-2">· {DATES[date].event ?? RACE} · session {field} of 5</span>
    </span>
  );
}

function SessionOptions() {
  return (
    <>
      {SESSION_GROUPS_EN.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.sessions.map((s) => <option key={s} value={s}>{SESSION_EN[s]}</option>)}
        </optgroup>
      ))}
    </>
  );
}

// De fem traeningsfelter (ejer punkt 7): Session 1-5 som dropdowns med
// indsatsordet i farve. En etape er laast i sit felt.
function SessionsRow({ rider, fields, manual, onSet, done, date, mobile = false }: {
  rider: R5Rider; fields: readonly Field[]; manual: Record<number, Session>; onSet: (i: number, s: Session) => void; done: boolean; date: number; mobile?: boolean;
}) {
  return (
    <div className={`grid gap-2 ${mobile ? "grid-cols-1" : "grid-cols-5"}`}>
      {fields.map((f, i) => {
        const head = <div className="mb-0.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">Session {i + 1}</div>;
        const wrap = (body: ReactNode) => (
          <div key={i} className={mobile ? "grid grid-cols-[76px_1fr] items-center gap-2" : ""}>{head}{body}</div>
        );
        if (f === "stage") {
          return wrap(
            <span className="flex min-h-9 items-center gap-1.5 rounded-cz bg-cz-1 px-2 text-xs font-semibold text-cz-card max-sm:min-h-11" role="img"
              aria-label={`${rider.name}, session ${i + 1}: ${DATES[date].race}, locked by the race`}>
              <LockIcon size={12} aria-hidden="true" />{DATES[date].race}
            </span>,
          );
        }
        const effort = effortOf(f);
        if (done) {
          return wrap(
            <span className="flex min-h-9 items-center justify-between gap-1 rounded-cz border border-cz-border bg-cz-subtle px-2 text-xs text-cz-3 max-sm:min-h-11">
              <span className="inline-flex min-w-0 items-center gap-1"><CheckIcon size={12} aria-hidden="true" className="shrink-0 text-cz-success" /><span className="truncate">{SESSION_EN[f]}</span></span>
              <span className="shrink-0 text-2xs">{EFFORT_WORD[effort]}</span>
            </span>,
          );
        }
        const changed = manual[i] !== undefined;
        return wrap(
          <span className={`relative flex min-h-9 items-center justify-between gap-1 rounded-cz border bg-cz-card px-2 focus-within:outline focus-within:outline-2 focus-within:outline-cz-1 max-sm:min-h-11 ${
            changed ? "border-cz-1" : "border-cz-border hover:border-cz-3"}`}>
            <span className={`truncate text-xs ${changed ? "font-semibold text-cz-1" : "text-cz-1"}`}>{SESSION_EN[f]}</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-2xs">
              <span className={EFFORT_TONE[effort]}>{EFFORT_WORD[effort]}</span>
              <ChevronDownIcon size={11} aria-hidden="true" className="text-cz-3" />
            </span>
            <select value={f} onChange={(e) => onSet(i, e.target.value as Session)}
              aria-label={`${rider.name}, session ${i + 1}: ${SESSION_EN[f]}, ${EFFORT_WORD[effort]}`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
              <SessionOptions />
            </select>
          </span>,
        );
      })}
    </div>
  );
}

type Sort = { key: SortKey; dir: 1 | -1 } | null;

// Sortérbar kolonneoverskrift (TASTE 7a). Type er sin egen sortérbare kolonne (ejer punkt 2).
function SortTh({ k, label, cls, sort, onSort }: { k: SortKey | null; label: string; cls: string; sort: Sort; onSort: (k: SortKey) => void }) {
  return (
    <th className={`px-3 py-2 text-start font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3 ${cls}`}
      aria-sort={sort && k === sort.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      {k ? (
        <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 uppercase hover:text-cz-1">
          {label}<SortIcon size={11} aria-hidden="true" />
        </button>
      ) : label}
    </th>
  );
}

// --- Siden ---------------------------------------------------------------------

export default function Direction5({ init, mobile }: { init: R5Init; mobile: boolean }) {
  const [tab, setTab] = useState(init.tab);
  const [moment, setMoment] = useState(init.moment);
  const [pressed, setPressed] = useState(init.pressed || init.moment);
  const [date, setDate] = useState(init.date);
  const [choices, setChoices] = useState<Record<string, Record<number, Effort | null>>>(START_CHOICE);
  const [manual, setManual] = useState<Record<string, Record<number, Record<number, Session>>>>(START_MANUAL);
  const [open, setOpen] = useState<Set<string>>(new Set(init.open));
  const [allSessions, setAllSessions] = useState(init.allSessions);
  const [filter, setFilter] = useState<Filter | null>(init.filter);
  const [sort, setSort] = useState<Sort>(null);
  const onSort = (key: SortKey) => setSort((x) => (x?.key === key ? { key, dir: (x.dir * -1) as 1 | -1 } : { key, dir: 1 }));

  const isToday = date === 0;
  const done = pressed && isToday;
  const dateWord = isToday ? "today" : `${DATES[date].short} ${DATES[date].day} Nov`;

  const rows = useMemo(() => TEAM.map((rider) => {
    const choice = choices[rider.id]?.[date] ?? null;
    const man = manual[rider.id]?.[date] ?? {};
    const base = programFields(rider, date);
    const fields = fieldsFor(rider, date, choice, man);
    const racing = fields.includes("stage");
    return { rider, choice, man, fields, racing, programEffort: dayEffort(trainingOnly(base)) };
  }), [choices, manual, date]);

  const counts = {
    training: rows.filter((r) => !r.racing && trainingOnly(r.fields).some((s) => effortOf(s) !== "rest")).length,
    racing: rows.filter((r) => r.racing).length,
    tired: rows.filter((r) => fatigueStep(r.rider.fatigue) >= 2).length,
    noProgram: rows.filter((r) => r.rider.program === null).length,
  };
  const match: Record<Filter, (r: (typeof rows)[number]) => boolean> = {
    training: (r) => !r.racing && trainingOnly(r.fields).some((s) => effortOf(s) !== "rest"),
    racing: (r) => r.racing,
    tired: (r) => fatigueStep(r.rider.fatigue) >= 2,
    noProgram: (r) => r.rider.program === null,
  };
  let shown = filter ? rows.filter(match[filter]) : rows;
  if (sort) {
    const val = (r: (typeof rows)[number]): string | number => ({
      rider: r.rider.name, type: r.rider.type, program: r.rider.program ?? "", fatigue: r.rider.fatigue,
      load: ["easy", "light", "normal", "hard", "veryHard"].indexOf(dayLoad(r.fields)),
    })[sort.key];
    shown = [...shown].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }

  const setChoice = (id: string, e: Effort | null) => {
    setChoices((c) => ({ ...c, [id]: { ...(c[id] ?? {}), [date]: e } }));
    setManual((m) => ({ ...m, [id]: { ...(m[id] ?? {}), [date]: {} } }));
  };
  const setField = (id: string, i: number, s: Session) =>
    setManual((m) => ({ ...m, [id]: { ...(m[id] ?? {}), [date]: { ...(m[id]?.[date] ?? {}), [i]: s } } }));
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const wholeTeam = (e: Effort) => { for (const r of rows) if (!r.racing) setChoice(r.rider.id, e); };
  const changedDates = new Set<number>();
  for (const byDate of Object.values(choices)) for (const [d, v] of Object.entries(byDate)) if (v) changedDates.add(Number(d));
  for (const byDate of Object.values(manual)) for (const [d, v] of Object.entries(byDate)) if (Object.keys(v).length) changedDates.add(Number(d));

  if (moment) {
    return <TodaysTraining mobile={mobile} frame={init.frame} onDone={() => setMoment(false)} />;
  }

  const header = (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-3">
      <div className="min-w-0">
        <h1 className="font-data text-[20px] font-bold tracking-[-0.01em] text-cz-1">Training</h1>
        <p className="mt-1 text-[13px] text-cz-2">{TEAM.length} riders · 5 sessions each per day</p>
      </div>
      {tab === "day" ? (
        <div className="flex flex-col items-end gap-1 max-sm:items-stretch">
          {!pressed ? (
            <Button size="sm" onClick={() => { setPressed(true); setMoment(true); setDate(0); }} className={mobile ? "w-full" : ""}>Train now</Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setMoment(true)} className={mobile ? "w-full" : ""}>
              <CheckIcon size={14} aria-hidden="true" />Trained 14:05 · Today's training
            </Button>
          )}
          <span className="inline-flex items-center gap-1 text-2xs text-cz-2">
            <GiftIcon size={12} aria-hidden="true" className="shrink-0 text-cz-3" />
            {pressed ? "Bonus earned: +15 % for pressing it yourself" : "+15 % when you press it yourself · otherwise it runs at 20:00"}
          </span>
        </div>
      ) : tab === "program" ? (
        <div className="flex items-center gap-2 max-sm:w-full">
          <Button variant="secondary" size="sm" className="max-sm:flex-1">Copy to riders</Button>
          <Button size="sm" className="max-sm:flex-1">Save plan</Button>
        </div>
      ) : null}
    </header>
  );

  const tabs = (
    <Tabs value={tab} onChange={(v: string) => (v === "day" || v === "program" || v === "development" || v === "report") && setTab(v)} className="mb-4">
      <TabList label="Training">
        <Tab value="day">Day</Tab>
        <Tab value="program">Program</Tab>
        <Tab value="development">Development</Tab>
        <Tab value="report">Report</Tab>
      </TabList>
    </Tabs>
  );

  if (tab === "program") {
    return (
      <main className="mx-auto max-w-[1600px] px-4 pb-16 pt-7 sm:px-8">
        {header}
        {tabs}
        <ProgramTab mode={init.mode} mobile={mobile} />
      </main>
    );
  }

  if (tab === "development" || tab === "report") {
    return (
      <main className={`mx-auto max-w-[1600px] pb-16 pt-7 ${mobile ? "px-4" : "px-8"}`}>
        {header}
        {tabs}
        {tab === "development"
          ? <DevelopmentTab mobile={mobile} openIds={init.open} />
          : <ReportTab mobile={mobile} range={init.range} openIds={init.open} />}
      </main>
    );
  }

  // Dagsvaelgeren (ejer punkt 8): pile, i dag + syv dage frem, loebsdage mærket med etapen.
  const first = Math.max(0, Math.min(date - 1, DATES.length - 3));
  const visible = mobile ? [first, first + 1, first + 2] : DATES.map((_, i) => i);
  const dayPicker = (
    <div className="mb-3 flex items-stretch gap-1" role="group" aria-label="Choose day">
      <button type="button" aria-label="Previous day" disabled={date === 0} onClick={() => setDate((d) => Math.max(0, d - 1))}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-cz border border-cz-border bg-cz-card text-cz-2 disabled:opacity-40">
        <ChevronLeftIcon size={16} aria-hidden="true" />
      </button>
      <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}>
        {visible.map((i) => {
          const d = DATES[i];
          const active = i === date;
          return (
            <button key={i} type="button" onClick={() => setDate(i)} aria-current={active ? "date" : undefined}
              className={`min-w-0 rounded-cz border px-2 py-1.5 text-start ${active ? "border-cz-1 bg-cz-card" : "border-cz-border bg-cz-card hover:border-cz-3"}`}>
              <span className="flex items-center justify-between gap-1">
                <span className={`font-data text-xs tabular-nums ${active ? "font-bold text-cz-1" : "text-cz-2"}`}>{i === 0 ? "Today" : `${d.short} ${d.day}`}</span>
                {changedDates.has(i) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cz-1" aria-label="Changed for this date" />}
              </span>
              <span className={`block truncate text-3xs ${d.race ? "font-semibold text-cz-1" : "text-cz-3"}`}>
                {d.race ? <span className="inline-flex items-center gap-0.5"><FlagIcon size={10} aria-hidden="true" className="shrink-0" />{d.race}</span> : "Training"}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-label="Next day" disabled={date === DATES.length - 1} onClick={() => setDate((d) => Math.min(DATES.length - 1, d + 1))}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-cz border border-cz-border bg-cz-card text-cz-2 disabled:opacity-40">
        <ChevronRightIcon size={16} aria-hidden="true" />
      </button>
    </div>
  );

  // Overblikket som EN linje (ejer punkt 8); et tryk paa et tal filtrerer listen.
  const overview = (
    <div className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-cz-2">
      <span className={`me-1 font-semibold text-cz-1 ${mobile ? "basis-full" : ""}`}>{DATES[date].long}</span>
      {([
        ["training", counts.training, "training"],
        ["racing", counts.racing, "racing"],
        ["tired", counts.tired, "tired"],
        ["noProgram", counts.noProgram, "no program"],
      ] as const).map(([key, n, word]) => (
        <span key={key} className="inline-flex items-center">
          {(!mobile || key !== "training") && <span className="px-1 text-cz-3">·</span>}
          <button type="button" aria-pressed={filter === key} onClick={() => setFilter(filter === key ? null : key)}
            className={`rounded-cz px-1 py-0.5 max-sm:min-h-11 ${filter === key ? "bg-cz-subtle text-cz-1 underline underline-offset-4" : "hover:text-cz-1"}`}>
            <span className="font-data font-semibold tabular-nums text-cz-1">{n}</span> {word}
          </button>
        </span>
      ))}
      {filter && (
        <button type="button" onClick={() => setFilter(null)} className="ms-2 font-medium text-cz-1 underline decoration-cz-border underline-offset-2">Show all</button>
      )}
    </div>
  );

  // "Whole team today" (ejer punkt 8): hurtigvalget, assistentens forslag og Simple | All sessions.
  const teamLine = (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cz-border px-3 py-2 text-xs ${mobile ? "flex-col items-stretch" : ""}`}>
      <span className="font-semibold text-cz-1">Whole team {dateWord}</span>
      {done ? <span className="text-cz-3">Trained. Pick another day to plan ahead.</span> : (
        <div className={mobile ? "[&_button]:flex-1" : ""}>
          <Segmented label={`Whole team ${dateWord}`} value="none" onChange={(v: Effort) => wholeTeam(v)}
            options={EFFORTS.map((e) => ({ value: e, label: EFFORT_WORD[e] }))} className={mobile ? "w-full" : ""} />
        </div>
      )}
      {!done && (
        <span className="text-cz-2">
          Assistant suggests: <span className="text-cz-1">Rest for Zhen Qian</span> (over the fatigue limit) ·{" "}
          <button type="button" onClick={() => setChoice("r3", "rest")} className="font-medium text-cz-1 underline decoration-cz-border underline-offset-2">Use</button>
        </span>
      )}
      <div className={mobile ? "[&_button]:flex-1" : "ms-auto"}>
        <Segmented label="Sessions" value={allSessions ? "all" : "simple"} onChange={(v: string) => setAllSessions(v === "all")}
          options={[{ value: "simple", label: "Simple" }, { value: "all", label: "All sessions" }]} className={mobile ? "w-full" : ""} />
      </div>
    </div>
  );

  const isOpen = (id: string) => allSessions || open.has(id);

  const desktopTable = (
    <table className="w-full table-fixed text-xs" data-sortable>
      <thead>
        <tr className="border-b border-cz-border">
          <th className="w-[40px]" aria-label="Sessions" />
          <SortTh k={"rider"} label="Rider" cls="w-[230px]" sort={sort} onSort={onSort} />
          <SortTh k={"type"} label="Type" cls="w-[140px]" sort={sort} onSort={onSort} />
          <SortTh k={"program"} label="Program" cls="w-[180px]" sort={sort} onSort={onSort} />
          <SortTh k={"fatigue"} label="Fatigue now" cls="w-[130px] whitespace-nowrap" sort={sort} onSort={onSort} />
          <SortTh k={"load"} label="Day load" cls="w-[160px]" sort={sort} onSort={onSort} />
          <SortTh k={null} label="Today" cls="" sort={sort} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {shown.map((r) => {
          const o = isOpen(r.rider.id);
          return [
            <tr key={r.rider.id} className={`border-t border-cz-border first:border-t-0 ${o ? "bg-cz-subtle/40" : ""}`}>
              <td className="ps-3">
                <button type="button" onClick={() => toggle(r.rider.id)} aria-expanded={o} aria-label={`Sessions for ${r.rider.name}`}
                  className="flex h-7 w-7 items-center justify-center rounded-cz text-cz-2 hover:bg-cz-subtle hover:text-cz-1">
                  {o ? <ChevronDownIcon size={14} aria-hidden="true" /> : <ChevronRightIcon size={14} aria-hidden="true" />}
                </button>
              </td>
              <td className="px-3 py-[7px]"><RiderName rider={r.rider} /></td>
              <td className="px-3 py-[7px] text-[13px] text-cz-2">{r.rider.type}</td>
              <td className="px-3 py-[7px]"><ProgramButton rider={r.rider} defaultOpen={init.menu === r.rider.id} /></td>
              <td className="px-3 py-[7px]"><FatiguePlate value={r.rider.fatigue} /></td>
              <td className="px-3 py-[7px]"><DayLoadCell fields={r.fields} overLimit={r.rider.overLimit} /></td>
              <td className="px-3 py-[7px]">
                {r.racing ? <RaceCell date={date} fields={r.fields} /> : (
                  <QuickSelect rider={r.rider} choice={r.choice} programEffort={r.programEffort} dateWord={dateWord} readOnly={done}
                    onChoice={(e) => setChoice(r.rider.id, e)} />
                )}
              </td>
            </tr>,
            o && (
              <tr key={`${r.rider.id}-s`} className="bg-cz-subtle/40">
                <td />
                <td colSpan={6} className="px-3 pb-3 pt-0.5">
                  <SessionsRow rider={r.rider} fields={r.fields} manual={r.man} done={done} date={date}
                    onSet={(i, s) => setField(r.rider.id, i, s)} />
                </td>
              </tr>
            ),
          ];
        })}
      </tbody>
    </table>
  );

  // Telefonen: sin egen loesning. Navn + tre kolonner (Fatigue, Day load, Today);
  // resten (type, program, hurtigvalget og de fem felter) i rytterens aabne kort.
  const mobileList = (
    <div>
      <div className="grid grid-cols-[1fr_40px_76px_76px] gap-2 border-b border-cz-border px-3 py-2 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
        <span>Rider</span><span>Fatigue</span><span>Day load</span><span>Today</span>
      </div>
      <ul>
        {shown.map((r) => {
          const o = open.has(r.rider.id);
          const todayWord = r.racing ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-cz-1"><LockIcon size={11} aria-hidden="true" className="shrink-0 text-cz-3" />{DATES[date].race}</span>
          ) : done ? (
            <span className="inline-flex items-center gap-1 text-cz-3"><CheckIcon size={11} aria-hidden="true" className="text-cz-success" />Trained</span>
          ) : r.choice ? (
            <span className="leading-tight"><EffortWord effort={r.choice} /><span className="block text-3xs text-cz-3">Today only</span></span>
          ) : (
            <span className="leading-tight text-cz-2">Program<span className="block text-3xs"><EffortWord effort={r.programEffort} /></span></span>
          );
          return (
            <li key={r.rider.id} className="border-t border-cz-border first:border-t-0">
              <button type="button" onClick={() => toggle(r.rider.id)} aria-expanded={o}
                className={`grid min-h-11 w-full grid-cols-[1fr_40px_76px_76px] items-center gap-2 px-3 py-2 text-start ${o ? "bg-cz-subtle/60" : ""}`}>
                <RiderName rider={r.rider} wrap />
                <span><FatiguePlate value={r.rider.fatigue} /></span>
                <span><DayLoadCell fields={r.fields} overLimit={r.rider.overLimit} compact /></span>
                <span className="flex items-start justify-between gap-1 text-xs">
                  {todayWord}
                  {o ? <ChevronDownIcon size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-3" /> : <ChevronRightIcon size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-3" />}
                </span>
              </button>
              {o && (
                <div className="flex flex-col gap-3 border-t border-cz-border bg-cz-subtle/60 px-3 pb-4 pt-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><div className="mb-1 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">Type</div><div className="text-[13px] text-cz-1">{r.rider.type}</div></div>
                    <div><div className="mb-1 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">Program</div><ProgramButton rider={r.rider} defaultOpen={init.menu === r.rider.id} full /></div>
                  </div>
                  <div>
                    <div className="mb-1 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">Today</div>
                    {r.racing ? <RaceCell date={date} fields={r.fields} /> : (
                      <QuickSelect rider={r.rider} choice={r.choice} programEffort={r.programEffort} dateWord={dateWord} readOnly={done} full
                        onChoice={(e) => setChoice(r.rider.id, e)} />
                    )}
                  </div>
                  <SessionsRow rider={r.rider} fields={r.fields} manual={r.man} done={done} date={date} mobile
                    onSet={(i, s) => setField(r.rider.id, i, s)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <main className={`mx-auto max-w-[1600px] pb-16 pt-7 ${mobile ? "px-4" : "px-8"}`}>
      {header}
      {tabs}
      {dayPicker}
      {overview}
      <div className="rounded-cz border border-cz-border bg-cz-card">
        {teamLine}
        {mobile ? mobileList : desktopTable}
      </div>
      <p className="mt-3 text-2xs text-cz-3">
        Names, nations and types: your squad. Fatigue, programs, sessions and the race are examples.
      </p>
    </main>
  );
}
