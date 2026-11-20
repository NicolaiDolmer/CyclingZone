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
import { ArrowMark, FORM, FatiguePlate, RiderName, TypeCell, FilterWords } from "./R5Parts.tsx";
import { FormPlate } from "../../../components/training/reportXp/XpToday.tsx";
import ProgramTab from "./R5Program.tsx";
import DevelopmentTab from "./R5Development.tsx";
import ReportTab, { type ReportRange } from "./R5Report.tsx";
import { useReloadBlock, RELOAD_BLOCK_REASONS } from "../../../lib/reloadGate.js";
import { resolveBulkScope, groupBulkIds } from "../../../components/training/bulkDayScope.ts";
import { STATUS } from "./r5data.ts";
import {
  Days70, FatigueNowTonight, HelpLink, R5Decision, R5Tour, R5TrainNowNote, RiderCardR5, RowStatus, SavedMark, SquadBadge,
  StateBody, TrainNowConfirm, TrainsLine, type DevMode, type TodayState,
} from "./R5TodayParts.tsx";

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
  // I dag-paritet 20/11: de fem afvigelser som R5-forslag (r5) eller gammel loesning (old),
  // en tilstand (indlaesning, tom, fejl, gemmer, tour), Train now-dialogen og massehandlinger.
  dev: DevMode;
  state: TodayState;
  confirm: boolean;
  selected: string[];
  group: boolean;
  pick: boolean;
  saved: string[];
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

// Ejer 19/11: hvor langt programmet er naaet. ?progress=under (graa linje under knappen) | inline (i knappen).
const PROGRESS_MODE = new URLSearchParams(window.location.search).get("progress");
const PROGRESS: Record<string, [string, string]> = {
  "Team week": ["Day 3 of 7", "3/7"], Ardennes: ["Week 2 of 4", "2/4"], "Time trial block": ["Day 5 of 14", "5/14"],
};
function ProgramProgress({ rider }: { rider: R5Rider }) {
  if (PROGRESS_MODE !== "under" || !rider.program || !PROGRESS[rider.program]) return null;
  return <div className="mt-0.5 font-data text-2xs tabular-nums text-cz-3">{PROGRESS[rider.program][0]}</div>;
}
function ProgramButton({ rider, defaultOpen, full = false }: { rider: R5Rider; defaultOpen: boolean; full?: boolean }) {
  const short = PROGRESS_MODE === "inline" && rider.program ? PROGRESS[rider.program]?.[1] : null;
  const label = rider.program ? (short ? `${rider.program} · ${short}` : rider.program) : "No program";
  return (
    <Dropdown
      defaultOpen={defaultOpen}
      className={full ? "w-full" : ""}
      trigger={({ open, toggle }: { open: boolean; toggle: () => void }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu"
          aria-label={`${rider.name}: program ${label}`}
          className={`inline-flex max-w-full items-center justify-between gap-1.5 rounded-cz border px-2 py-1 text-xs font-medium hover:border-cz-3 max-sm:min-h-11 ${full ? "w-full" : "w-[150px]"} ${
            rider.program ? "border-cz-border text-cz-1" : "border-cz-border text-cz-2"}`}>
          <span className="inline-flex min-w-0 items-center gap-1">
            {/* Ejer 19/11: ingen advarsel ved "No program"; at undlade et program er et aktivt valg. */}
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

function QuickSelect({ rider, choice, onChoice, programEffort, dateWord, full = false, readOnly, busy = false }: {
  rider: R5Rider; choice: Effort | null; onChoice: (e: Effort | null) => void; programEffort: Effort; dateWord: string; full?: boolean; readOnly: boolean;
  busy?: boolean; // gemmer: valget er spaerret, og siden spaerrer reload (useReloadBlock)
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
          options={EFFORTS.map((e) => ({ value: e, label: EFFORT_WORD[e], disabled: busy }))}
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
function SessionsRow({ rider, fields, manual, onSet, done, date, mobile = false, fieldInfo = false }: {
  rider: R5Rider; fields: readonly Field[]; manual: Record<number, Session>; onSet: (i: number, s: Session) => void; done: boolean; date: number; mobile?: boolean;
  // Gammel loesning (dev=old): feltvaelgeren siger, hvad passet traener, og om det passer til typen.
  fieldInfo?: boolean;
}) {
  return (
    <div className={`grid gap-2 ${mobile ? "grid-cols-1" : "grid-cols-5"}`}>
      {fields.map((f, i) => {
        const head = <div className="mb-0.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">Session {i + 1}</div>;
        const info = fieldInfo && f !== "stage" && !done ? <div className={mobile ? "col-start-2" : "mt-0.5"}><TrainsLine sessions={[f]} rider={rider} compact /></div> : null;
        const wrap = (body: ReactNode) => (
          <div key={i} className={mobile ? "grid grid-cols-[76px_1fr] items-center gap-x-2 gap-y-0.5" : ""}>{head}{body}{info}</div>
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
  // I dag-paritet 20/11 (#7947): Train now-dialogen, markering, Group by type, "Saved" og gem-spaerren.
  const [confirmOpen, setConfirmOpen] = useState(init.confirm);
  const [selected, setSelected] = useState<Set<string>>(new Set(init.selected));
  const [groupByType, setGroupByType] = useState(init.group);
  const [pickMode, setPickMode] = useState(init.pick || (mobile && init.selected.length > 0));
  const [saved, setSaved] = useState<Set<string>>(new Set(init.saved));
  const old = init.dev === "old";
  const saving = init.state === "saving";
  // Samme reload-spaerre som TrainingPage: et release-reload venter, mens et valg gemmes.
  useReloadBlock(saving, RELOAD_BLOCK_REASONS.BUSY);

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
    setSaved((x) => new Set(x).add(id));
  };
  const setField = (id: string, i: number, s: Session) =>
    setManual((m) => ({ ...m, [id]: { ...(m[id] ?? {}), [date]: { ...(m[id]?.[date] ?? {}), [i]: s } } }));
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleSelect = (id: string) => setSelected((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Massehandlinger (bulkDayScope, #6523): intet markeret = alle i visningen, ellers kun de markerede.
  const selectable = shown.filter((r) => !r.racing).map((r) => r.rider.id);
  const scope = resolveBulkScope(selected, filter ? new Set(shown.map((r) => r.rider.id)) : null, selectable);
  const applyTo = (ids: readonly string[], e: Effort) => { for (const id of ids) if (selectable.includes(id)) setChoice(id, e); };
  const allSelected = shown.length > 0 && shown.every((r) => selected.has(r.rider.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(shown.map((r) => r.rider.id)));
  const changedDates = new Set<number>();
  for (const byDate of Object.values(choices)) for (const [d, v] of Object.entries(byDate)) if (v) changedDates.add(Number(d));
  for (const byDate of Object.values(manual)) for (const [d, v] of Object.entries(byDate)) if (Object.keys(v).length) changedDates.add(Number(d));

  if (moment) {
    return <TodaysTraining mobile={mobile} frame={init.frame} onDone={() => setMoment(false)} />;
  }

  const press = () => { setConfirmOpen(false); setPressed(true); setMoment(true); setDate(0); };
  const header = (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-3">
      <div className="min-w-0">
        <h1 className="font-data text-[20px] font-bold tracking-[-0.01em] text-cz-1">Training</h1>
        <p className="mt-1 text-[13px] text-cz-2">{TEAM.length} riders · 5 sessions each per day</p>
      </div>
      {tab === "day" ? (
        <div className="flex flex-col items-end gap-1 max-sm:items-stretch" data-testid="r5-train-now">
          {!pressed ? (
            // #6740: dagens loeb har for faa raske ryttere, saa trykket spoerger foerst (TrainNowConfirm).
            <Button size="sm" data-tour="training-run-today" onClick={() => setConfirmOpen(true)} className={mobile ? "w-full" : ""}>Train now</Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setMoment(true)} className={mobile ? "w-full" : ""}>
              <CheckIcon size={14} aria-hidden="true" />Trained 14:05 · Today's training
            </Button>
          )}
          <span className="inline-flex items-center gap-1 text-2xs text-cz-2">
            <GiftIcon size={12} aria-hidden="true" className="shrink-0 text-cz-3" />
            {pressed ? "Bonus earned: +15 % for pressing it yourself" : "+15 % when you press it yourself · otherwise it runs at 20:00"}
          </span>
          <R5TrainNowNote pressed={pressed} />
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

  // Holdlinjen (ejer punkt 8): hurtigvalget, markeringen, Group by type og Simple | All sessions.
  // R5-forslag: holdlinjen ER massehandlingen ("Whole team" bliver til "3 selected").
  // Gammel loesning (dev=old): en egen "Set today's day for N riders"-linje under den.
  const scopeWord = scope.kind === "selected" ? `${scope.ids.length} selected ${dateWord}` : `Whole team ${dateWord}`;
  const teamLine = (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cz-border px-3 py-2 text-xs ${mobile ? "flex-col items-stretch" : ""}`} data-testid="r5-team-line">
      <span className="font-semibold text-cz-1">{old ? `Whole team ${dateWord}` : scopeWord}</span>
      {done ? <span className="text-cz-3">Trained. Pick another day to plan ahead.</span> : (
        <div className={mobile ? "[&_button]:flex-1" : ""}>
          <Segmented label={old ? `Whole team ${dateWord}` : scopeWord} value="none"
            onChange={(v: Effort) => applyTo(old ? selectable : scope.ids, v)}
            options={EFFORTS.map((e) => ({ value: e, label: EFFORT_WORD[e], disabled: saving }))} className={mobile ? "w-full" : ""} />
        </div>
      )}
      {!old && scope.kind === "selected" && (
        <button type="button" onClick={() => setSelected(new Set())} className="font-medium text-cz-1 underline decoration-cz-border underline-offset-2">Clear selection</button>
      )}
      <button type="button" aria-pressed={groupByType} onClick={() => setGroupByType((g) => !g)}
        className={`rounded-cz border px-2 py-1 font-medium max-sm:min-h-11 ${groupByType ? "border-cz-1 bg-cz-subtle text-cz-1" : "border-cz-border text-cz-2 hover:text-cz-1"}`}>
        Group by type
      </button>
      <FilterWords />
      <div className={mobile ? "[&_button]:flex-1" : "ms-auto"}>
        <Segmented label="Sessions" value={allSessions ? "all" : "simple"} onChange={(v: string) => setAllSessions(v === "all")}
          options={[{ value: "simple", label: "Simple" }, { value: "all", label: "All sessions" }]} className={mobile ? "w-full" : ""} />
      </div>
    </div>
  );
  const oldBulkLine = old && !done ? (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-cz-border bg-cz-subtle/40 px-3 py-2 text-xs ${mobile ? "flex-col items-stretch" : ""}`} data-testid="r5-old-bulk">
      <span className="font-semibold text-cz-1">Set today's day for {scope.kind === "selected" ? `${scope.ids.length} selected` : `all ${scope.ids.length} riders`}</span>
      <div className={mobile ? "[&_button]:flex-1" : ""}>
        <Segmented label="Set today's day" value="none" onChange={(v: Effort) => applyTo(scope.ids, v)}
          options={EFFORTS.map((e) => ({ value: e, label: EFFORT_WORD[e] }))} className={mobile ? "w-full" : ""} />
      </div>
      <span className="text-cz-3">Tick riders to set it for just them.</span>
    </div>
  ) : null;

  const isOpen = (id: string) => allSessions || open.has(id);
  const savedFor = (id: string) => saved.has(id) && !done ? <SavedMark /> : null;
  let firstQuick = true;
  const tourAnchor = () => { const f = firstQuick; firstQuick = false; return f ? "training-focus" : undefined; };

  // Grupperne (Group by type): en overskrift pr. type med "Set for group".
  const groups: Array<{ key: string; label: string; rows: typeof shown }> = groupByType
    ? [...new Set(shown.map((r) => r.rider.type))].map((type) => ({ key: type, label: type, rows: shown.filter((r) => r.rider.type === type) }))
    : [{ key: "all", label: "", rows: shown }];
  const groupHead = (g: (typeof groups)[number], colSpan: number) => (
    <tr key={`g-${g.key}`} className="border-t border-cz-border bg-cz-subtle">
      <td colSpan={colSpan} className="px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-1">{g.label}</span>
          <span className="text-cz-3">{g.rows.length} {g.rows.length === 1 ? "rider" : "riders"}</span>
          {!done && (
            <span className="ms-auto inline-flex items-center gap-2">
              <span className="text-cz-2">Set for group</span>
              <Segmented label={`Set for group ${g.label}`} value="none"
                onChange={(v: Effort) => applyTo(groupBulkIds(g.rows.map((r) => r.rider.id), selectable), v)}
                options={EFFORTS.map((e) => ({ value: e, label: EFFORT_WORD[e] }))} />
            </span>
          )}
        </div>
      </td>
    </tr>
  );

  const colCount = old ? 11 : 10;
  const desktopTable = (
    <table className="w-full table-fixed text-xs" data-sortable>
      <thead>
        <tr className="border-b border-cz-border">
          <th className="w-[40px] ps-3 text-start">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" className="h-4 w-4 rounded-[3px] accent-cz-accent" />
          </th>
          <th className="w-[36px]" aria-label="Sessions" />
          <SortTh k={"rider"} label="Rider" cls="w-[230px]" sort={sort} onSort={onSort} />
          <SortTh k={"type"} label="Type" cls="w-[140px]" sort={sort} onSort={onSort} />
          {old && <SortTh k={null} label="Age" cls="w-[56px]" sort={sort} onSort={onSort} />}
          <SortTh k={"program"} label="Program" cls="w-[170px]" sort={sort} onSort={onSort} />
          <SortTh k={null} label="Form" cls="w-[72px]" sort={sort} onSort={onSort} />
          {old ? (
            <>
              <SortTh k={"fatigue"} label="Fatigue now / tonight" cls="w-[150px] whitespace-nowrap" sort={sort} onSort={onSort} />
              <SortTh k={null} label="Days 70+" cls="w-[80px] whitespace-nowrap" sort={sort} onSort={onSort} />
            </>
          ) : (
            <>
              <SortTh k={"fatigue"} label="Fatigue now" cls="w-[110px] whitespace-nowrap" sort={sort} onSort={onSort} />
              <SortTh k={"load"} label="Day load" cls="w-[150px]" sort={sort} onSort={onSort} />
            </>
          )}
          <SortTh k={null} label="Today" cls="" sort={sort} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {groups.flatMap((g) => [
          groupByType ? groupHead(g, colCount) : null,
          ...g.rows.map((r) => {
            const o = isOpen(r.rider.id);
            const sel = selected.has(r.rider.id);
            return [
              <tr key={r.rider.id} className={`border-t border-cz-border first:border-t-0 ${o || sel ? "bg-cz-subtle/40" : ""}`}>
                <td className="ps-3">
                  <input type="checkbox" checked={sel} onChange={() => toggleSelect(r.rider.id)} aria-label={`Select ${r.rider.name}`} className="h-4 w-4 rounded-[3px] accent-cz-accent" />
                </td>
                <td>
                  <button type="button" onClick={() => toggle(r.rider.id)} aria-expanded={o} aria-label={`Sessions for ${r.rider.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-cz text-cz-2 hover:bg-cz-subtle hover:text-cz-1">
                    {o ? <ChevronDownIcon size={14} aria-hidden="true" /> : <ChevronRightIcon size={14} aria-hidden="true" />}
                  </button>
                </td>
                <td className="px-3 py-[7px]">
                  <span className="flex min-w-0 items-center gap-1"><RiderName rider={r.rider} /><SquadBadge id={r.rider.id} /></span>
                  <RowStatus id={r.rider.id} />
                </td>
                <td className="px-3 py-[7px]"><TypeCell id={r.rider.id} /></td>
                {old && <td className="px-3 py-[7px] font-data text-[13px] tabular-nums text-cz-1">{STATUS[r.rider.id]?.age}</td>}
                <td className="px-3 py-[7px]"><ProgramButton rider={r.rider} defaultOpen={init.menu === r.rider.id} /><ProgramProgress rider={r.rider} /></td>
                <td className="px-3 py-[7px]"><FormPlate value={FORM[r.rider.id] ?? null} /></td>
                {old ? (
                  <>
                    <td className="px-3 py-[7px]"><FatigueNowTonight rider={r.rider} settled={done} /></td>
                    <td className="px-3 py-[7px]"><Days70 id={r.rider.id} /></td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-[7px]"><FatiguePlate value={r.rider.fatigue} /></td>
                    <td className="px-3 py-[7px]"><DayLoadCell fields={r.fields} overLimit={r.rider.overLimit} /></td>
                  </>
                )}
                <td className="px-3 py-[7px]">
                  {r.racing ? <RaceCell date={date} fields={r.fields} /> : (
                    <div className="flex items-center gap-2" data-tour={tourAnchor()}>
                      <QuickSelect rider={r.rider} choice={r.choice} programEffort={r.programEffort} dateWord={dateWord} readOnly={done} busy={saving}
                        onChoice={(e) => setChoice(r.rider.id, e)} />
                      {savedFor(r.rider.id)}
                    </div>
                  )}
                </td>
              </tr>,
              o && (
                <tr key={`${r.rider.id}-s`} className="bg-cz-subtle/40">
                  <td colSpan={2} />
                  <td colSpan={colCount - 2} className="px-3 pb-3 pt-0.5">
                    <SessionsRow rider={r.rider} fields={r.fields} manual={r.man} done={done} date={date} fieldInfo={old}
                      onSet={(i, s) => setField(r.rider.id, i, s)} />
                    <RiderCardR5 rider={r.rider} sessions={trainingOnly(r.fields)} mobile={false} />
                  </td>
                </tr>
              ),
            ];
          }),
        ])}
      </tbody>
    </table>
  );

  // Telefonen: sin egen loesning. Navn + kolonner (Form, Fatigue, Day load, Today);
  // resten (type, program, hurtigvalget, de fem felter og kortet) i rytterens aabne kort.
  // Markering + sortering (gamle I dag): "Select riders" slaar markering til, og
  // sorteringen staar i vaerktoejslinjen over listen.
  const sortKeys: Array<[SortKey, string]> = [["rider", "Rider"], ["type", "Type"], ["program", "Program"], ["fatigue", "Fatigue"], ["load", "Day load"]];
  const mobileTools = (
    <div className="flex items-center gap-2 border-b border-cz-border px-3 py-2 text-xs" data-testid="r5-mobile-tools">
      <label className="flex min-h-11 flex-1 items-center gap-1.5 text-cz-2">
        <SortIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
        <span className="sr-only">Sort by</span>
        <select value={sort?.key ?? "rider"} onChange={(e) => setSort({ key: e.target.value as SortKey, dir: sort?.dir ?? 1 })}
          className="min-h-9 flex-1 rounded-cz border border-cz-border bg-cz-card px-2 text-xs text-cz-1">
          {sortKeys.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}
        </select>
      </label>
      <button type="button" aria-pressed={pickMode} onClick={() => { setPickMode((p) => !p); if (pickMode) setSelected(new Set()); }}
        className={`min-h-11 rounded-cz border px-3 font-medium ${pickMode ? "border-cz-1 bg-cz-subtle text-cz-1" : "border-cz-border text-cz-2"}`}>
        {pickMode ? `${selected.size} selected` : "Select riders"}
      </button>
    </div>
  );
  const mobileCols = old ? "grid-cols-[1fr_36px_74px_70px]" : "grid-cols-[1fr_36px_40px_76px_76px]";
  const mobileList = (
    <div>
      {mobileTools}
      <div className={`grid ${mobileCols} gap-2 border-b border-cz-border px-3 py-2 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3`}>
        {old ? <><span>Rider</span><span>Form</span><span>Fatigue / tonight</span><span>Today</span></>
          : <><span>Rider</span><span>Form</span><span>Fatigue</span><span>Day load</span><span>Today</span></>}
      </div>
      <ul>
        {groups.flatMap((g) => [
          groupByType ? (
            <li key={`g-${g.key}`} className="flex flex-wrap items-center gap-2 border-t border-cz-border bg-cz-subtle px-3 py-1.5 text-xs">
              <span className="font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-1">{g.label}</span>
              <span className="text-cz-3">{g.rows.length}</span>
              {!done && (
                <div className="basis-full [&_button]:flex-1">
                  <Segmented label={`Set for group ${g.label}`} value="none" className="w-full"
                    onChange={(v: Effort) => applyTo(groupBulkIds(g.rows.map((r) => r.rider.id), selectable), v)}
                    options={EFFORTS.map((e) => ({ value: e, label: EFFORT_WORD[e] }))} />
                </div>
              )}
            </li>
          ) : null,
          ...g.rows.map((r) => {
            const o = isOpen(r.rider.id);
            const sel = selected.has(r.rider.id);
            const todayWord = r.racing ? (
              <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-cz-1"><LockIcon size={11} aria-hidden="true" className="shrink-0 text-cz-3" />{DATES[date].race}</span>
            ) : done ? (
              <span className="inline-flex items-center gap-1 text-cz-3"><CheckIcon size={11} aria-hidden="true" className="text-cz-success" />Trained</span>
            ) : r.choice ? (
              <span className="leading-tight"><EffortWord effort={r.choice} /><span className="block text-3xs text-cz-3">Today only</span></span>
            ) : (
              <span className="leading-tight text-cz-2">Program<span className="block text-3xs"><EffortWord effort={r.programEffort} /></span></span>
            );
            const nameCell = (
              <span className="flex min-w-0 flex-col">
                <span className="flex min-w-0 items-start gap-1">
                  {pickMode && (
                    <input type="checkbox" checked={sel} readOnly tabIndex={-1} aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none rounded-[3px] accent-cz-accent" />
                  )}
                  <RiderName rider={r.rider} wrap /><SquadBadge id={r.rider.id} />
                </span>
                <RowStatus id={r.rider.id} />
              </span>
            );
            return (
              <li key={r.rider.id} className={`border-t border-cz-border first:border-t-0 ${sel ? "bg-cz-subtle/60" : ""}`}>
                <button type="button" onClick={() => (pickMode ? toggleSelect(r.rider.id) : toggle(r.rider.id))}
                  aria-expanded={pickMode ? undefined : o} aria-pressed={pickMode ? sel : undefined}
                  className={`grid min-h-11 w-full ${mobileCols} items-center gap-2 px-3 py-2 text-start ${o && !pickMode ? "bg-cz-subtle/60" : ""}`}>
                  {nameCell}
                  <span><FormPlate value={FORM[r.rider.id] ?? null} /></span>
                  {old ? (
                    <span><FatigueNowTonight rider={r.rider} settled={done} /></span>
                  ) : (
                    <>
                      <span><FatiguePlate value={r.rider.fatigue} /></span>
                      <span><DayLoadCell fields={r.fields} overLimit={r.rider.overLimit} compact /></span>
                    </>
                  )}
                  <span className="flex items-start justify-between gap-1 text-xs">
                    {todayWord}
                    {!pickMode && (o ? <ChevronDownIcon size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-3" /> : <ChevronRightIcon size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-3" />)}
                  </span>
                </button>
                {/* Gammel loesning (dev=old): ET tryk i raekken vaelger dagen (TodayRowMobile). */}
                {old && !r.racing && !done && !pickMode && (
                  <div className="flex items-center gap-2 px-3 pb-2 [&_button]:flex-1" data-tour={tourAnchor()}>
                    <Segmented label={`${r.rider.name}: training ${dateWord}`} value={r.choice ?? "none"} onChange={(v: Effort) => setChoice(r.rider.id, v)}
                      options={EFFORTS.map((e) => ({ value: e, label: EFFORT_WORD[e] }))} className="w-full" />
                    {savedFor(r.rider.id)}
                  </div>
                )}
                {o && !pickMode && (
                  <div className="flex flex-col gap-3 border-t border-cz-border bg-cz-subtle/60 px-3 pb-4 pt-3">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div><div className="mb-1 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">Type</div><div><TypeCell id={r.rider.id} /></div></div>
                      <div><div className="mb-1 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">Program</div><ProgramButton rider={r.rider} defaultOpen={init.menu === r.rider.id} full /><ProgramProgress rider={r.rider} /></div>
                    </div>
                    {!old && (
                      <div>
                        <div className="mb-1 flex items-center justify-between font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3"><span>Today</span>{savedFor(r.rider.id)}</div>
                        {r.racing ? <RaceCell date={date} fields={r.fields} /> : (
                          <div data-tour={tourAnchor()}>
                            <QuickSelect rider={r.rider} choice={r.choice} programEffort={r.programEffort} dateWord={dateWord} readOnly={done} busy={saving} full
                              onChoice={(e) => setChoice(r.rider.id, e)} />
                          </div>
                        )}
                      </div>
                    )}
                    <SessionsRow rider={r.rider} fields={r.fields} manual={r.man} done={done} date={date} mobile fieldInfo={old}
                      onSet={(i, s) => setField(r.rider.id, i, s)} />
                    <RiderCardR5 rider={r.rider} sessions={trainingOnly(r.fields)} mobile />
                  </div>
                )}
              </li>
            );
          }),
        ])}
      </ul>
    </div>
  );

  const stateBody = init.state === "loading" || init.state === "empty" || init.state === "error" ? <StateBody state={init.state} /> : null;
  return (
    <main className={`mx-auto max-w-[1600px] pb-16 pt-7 ${mobile ? "px-4" : "px-8"}`}>
      {header}
      {tabs}
      {dayPicker}
      {overview}
      {/* Assistenten (gamle I dag: DailyDecision): flere forslag og "Use all". */}
      {!done && !stateBody && <div className="mb-3"><R5Decision compact={mobile} onUse={(id) => setChoice(id, "rest")} /></div>}
      {saving && (
        <p role="status" className="mb-2 text-2xs text-cz-3" data-testid="r5-saving">Saving… your choices are kept if the game updates now.</p>
      )}
      <div className="rounded-cz border border-cz-border bg-cz-card">
        {teamLine}
        {oldBulkLine}
        {stateBody ?? (mobile ? mobileList : desktopTable)}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <HelpLink />
        <p className="text-2xs text-cz-3">
          Names, nations and types: your squad. Fatigue, programs, sessions, status and the race are examples.
        </p>
      </div>
      <TrainNowConfirm open={confirmOpen && !pressed} onClose={() => setConfirmOpen(false)} onGo={press} />
      <R5Tour on={init.state === "tour"} />
    </main>
  );
}
