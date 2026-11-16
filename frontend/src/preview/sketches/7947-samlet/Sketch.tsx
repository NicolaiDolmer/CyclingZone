// #7947 samlet design: tre sammenhaengende retninger for traeningssiden, alle
// bygget paa spillets rigtige datomodel: FEM felter pr. rytter pr. dato, en
// etape optager et felt og er laast, Traen nu koerer de aabne felter straks.
// Ejeren 16/11: runde 1 og 2 (#8184, #8221) viste kun eet valg pr. dag, og det
// er forkert. Her vises de fem felter altid.
// Intet her er produktkode; siden loeber ikke fra appen og gemmer intet.

import { useState, type ReactNode } from "react";
import Button from "../../../components/ui/Button.jsx";
import Segmented from "../../../components/ui/Segmented.jsx";
import {
  AlertTriangleIcon, CheckIcon, ChevronDownIcon, ClockIcon, GiftIcon, LockIcon,
} from "../../../components/ui/icons/index.jsx";
import {
  applyWholeDay, dayChoice, levelOf, overviewCounts, setField, trainNow,
  type Field, type Level, type Session,
} from "./model.ts";
import {
  DATE_LABEL, RACE_LABEL, RIDERS, SESSION_GROUPS, SESSION_NAME, SESSION_SHORT, WEEKDAYS,
  type SketchRider, type Tone,
} from "./data.ts";

export type DirectionId = "today" | "r1" | "r2" | "r3";

const BANNERS: Record<Exclude<DirectionId, "today">, { name: string; what: string; taps: string; pick?: boolean }> = {
  r1: {
    name: "Retning 1 · Én vælger, fem felter",
    what: "Som før 29/9: ét valg pr. rytter fylder dagens åbne felter, og de fem felter står lige ved siden af, så et enkelt felt rettes med ét tryk.",
    taps: "Almindeligt valg: vælgeren (1 valg) · ret ét felt: tryk på feltet · etapefelter er låst",
  },
  r2: {
    name: "Retning 2 · Ét tryk pr. rytter",
    what: "Program og Hvile er hver ét tryk direkte i rækken, alt andet ligger i Andet, og de fem felter under viser præcis hvad dagen bliver.",
    taps: "Program eller Hvile: 1 tryk · andet pas: Andet (1 valg) · ret ét felt: tryk på feltet",
    pick: true,
  },
  r3: {
    name: "Retning 3 · Ugen ved rytteren",
    what: "I dag og de næste seks dage står i samme række, så planlægning og det kommende ses samlet, og et tryk på en dag åbner dens fem felter.",
    taps: "Ret i dag: tryk på feltet · planlæg frem: tryk på dagen · programmet og dets kilde står i rækken",
  },
};

const TONE_TEXT: Record<Tone, string> = { ok: "text-cz-success", warn: "text-cz-warning", risk: "text-cz-danger" };
const FIELD_NUMBERS = [1, 2, 3, 4, 5] as const;
const LEVEL_WORD = ["hvile", "let", "mellem", "hård"] as const;

// --- Faelles stumper --------------------------------------------------------

function Banner({ id }: { id: Exclude<DirectionId, "today"> }) {
  const b = BANNERS[id];
  return (
    <header data-testid="sketch-banner" className="border-b-2 border-cz-1 bg-cz-subtle">
      <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-8">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-3">Skitse #7947 · 5 felter pr. dato</span>
          {b.pick && <span className="font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">Min anbefaling</span>}
        </div>
        <h2 className="mt-1 font-data text-xl font-bold leading-tight text-cz-1 sm:text-2xl">{b.name}</h2>
        <p className="mt-1.5 max-w-[920px] text-sm text-cz-1">{b.what}</p>
        <p className="mt-1.5 font-data text-xs font-semibold tabular-nums text-cz-2">{b.taps}</p>
      </div>
    </header>
  );
}

function LevelTicks({ level, inverted = false }: { level: Level; inverted?: boolean }) {
  const on = inverted ? "bg-cz-card" : "bg-cz-2";
  const off = inverted ? "bg-cz-card/30" : "bg-cz-border";
  return (
    <span aria-hidden="true" className="flex items-end gap-[2px]">
      {[1, 2, 3].map((n) => (
        <span key={n} className={`w-[3px] rounded-[1px] ${n <= level ? on : off}`} style={{ height: 3 + n * 2 }} />
      ))}
    </span>
  );
}

function SessionOptions() {
  return (
    <>
      {SESSION_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.sessions.map((s) => <option key={s} value={s}>{SESSION_NAME[s]}</option>)}
        </optgroup>
      ))}
    </>
  );
}

function FieldCell({
  field, n, riderName, onSet, tall = false,
}: { field: Field; n: number; riderName: string; onSet: (session: Session) => void; tall?: boolean }) {
  // Telefonen: navnet over maerket, saa kortnavnet faar hele feltets bredde.
  const height = tall ? "min-h-12 flex-col py-1" : "min-h-11 sm:min-h-9";
  if (field.kind === "stage") {
    return (
      <span
        className={`flex ${height} items-center justify-center gap-1 rounded-cz bg-cz-1 px-1 text-cz-card`}
        title="Låst af løbet"
        aria-label={`${riderName}, felt ${n}: ${field.label}, låst af løbet`}
      >
        <LockIcon size={11} aria-hidden="true" className="shrink-0" />
        <span className="truncate font-data text-2xs font-semibold">{field.label}</span>
      </span>
    );
  }
  if (field.kind === "done") {
    return (
      <span
        className={`flex ${height} items-center justify-center gap-1 rounded-cz border border-cz-border bg-cz-subtle px-1 text-cz-3`}
        aria-label={`${riderName}, felt ${n}: ${SESSION_NAME[field.session]}, kørt`}
      >
        <CheckIcon size={11} aria-hidden="true" className="shrink-0 text-cz-success" />
        <span className="truncate font-data text-2xs">{SESSION_SHORT[field.session]}</span>
      </span>
    );
  }
  const level = levelOf(field.session);
  return (
    <span
      className={`relative flex ${height} items-center ${tall ? "justify-center" : "justify-between"} gap-1 rounded-cz border px-1.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-cz-1 ${
        field.changed ? "border-cz-1 bg-cz-card" : "border-cz-border bg-cz-card hover:border-cz-border-strong"
      }`}
      title={field.changed ? "Rettet i dag" : undefined}
    >
      <span
        className={`truncate font-data text-2xs ${level === 0 ? "text-cz-3" : "text-cz-1"} ${
          field.changed ? "font-semibold underline decoration-dotted underline-offset-2" : ""
        }`}
      >
        {SESSION_SHORT[field.session]}
      </span>
      <LevelTicks level={level} />
      <select
        value={field.session}
        aria-label={`${riderName}, felt ${n}: ${SESSION_NAME[field.session]} (${LEVEL_WORD[level]})`}
        onChange={(e) => onSet(e.target.value as Session)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        <SessionOptions />
      </select>
    </span>
  );
}

function FieldStrip({
  rider, fields, onField, tall = false,
}: { rider: SketchRider; fields: Field[]; onField: (i: number, s: Session) => void; tall?: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-1" role="group" aria-label={`${rider.name}: dagens fem felter`}>
      {fields.map((field, i) => (
        <FieldCell key={i} field={field} n={i + 1} riderName={rider.name} onSet={(s) => onField(i, s)} tall={tall} />
      ))}
    </div>
  );
}

function Fatigue({ rider, inline = false }: { rider: SketchRider; inline?: boolean }) {
  return (
    <span className={`font-data tabular-nums ${inline ? "text-xs" : "text-[13px]"}`}>
      <span className="text-cz-1">{rider.fatigueNow}</span>
      <span className="px-1 text-cz-3">til</span>
      <span className={`font-semibold ${TONE_TEXT[rider.tone]}`}>~{rider.fatigueTonight}</span>
      {rider.tone === "risk" && (
        <AlertTriangleIcon size={12} aria-label="Over træthedsgrænsen" className={`ms-1 inline align-[-2px] ${TONE_TEXT.risk}`} />
      )}
    </span>
  );
}

function SourceLine({ rider }: { rider: SketchRider }) {
  const s = rider.source;
  if (s.kind === "own") {
    return (
      <span className="text-cz-2">
        Eget program: {s.name} <button type="button" className="ms-1 font-medium text-cz-accent-t hover:underline">Fjern</button>
      </span>
    );
  }
  if (s.kind === "team") return <span className="text-cz-3">Holdets program</span>;
  return <span className="font-semibold text-cz-warning">Mangler plan i dag</span>;
}

function RiderName({ rider }: { rider: SketchRider }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5">
        <span className="font-data text-3xs font-semibold text-cz-3">{rider.nation}</span>
        <a href="#rider" className="truncate text-[13.5px] font-medium text-cz-1 hover:underline">{rider.name}</a>
      </div>
      <div className="truncate font-data text-3xs uppercase tracking-[.04em] text-cz-3">{rider.type}</div>
    </div>
  );
}

function XpCell({ rider, compact = false }: { rider: SketchRider; compact?: boolean }) {
  if (rider.xpToday === 0) return <span className="font-data text-2xs text-cz-3">Ingen XP endnu</span>;
  return (
    <div className={compact ? "flex items-center gap-2" : "min-w-[120px]"}>
      <div className="flex items-baseline justify-between gap-2 font-data text-xs tabular-nums">
        <span className="font-semibold text-cz-1">+{rider.xpToday} XP</span>
        {!compact && rider.xpFromRace > 0 && <span className="text-3xs text-cz-3">heraf løb {rider.xpFromRace}</span>}
      </div>
      <div className={`${compact ? "w-16" : "mt-1"} h-1 overflow-hidden rounded-cz bg-cz-border`} aria-hidden="true">
        <div className="h-full bg-cz-2" style={{ width: `${Math.round(rider.nextShare * 100)}%` }} />
      </div>
      {!compact && <div className="mt-0.5 truncate font-data text-3xs text-cz-3">Næste point: {rider.nextPoint}</div>}
    </div>
  );
}

function DaySelect({ rider, fields, onDay, full = false }: { rider: SketchRider; fields: Field[]; onDay: (s: Session) => void; full?: boolean }) {
  const value = dayChoice(fields);
  return (
    <div className={`relative ${full ? "w-full" : "w-[176px]"}`}>
      <select
        value={value ?? ""}
        disabled={value === null}
        aria-label={`${rider.name}: dagens træning på alle åbne felter`}
        onChange={(e) => onDay(e.target.value as Session)}
        className={`w-full appearance-none rounded-cz border bg-cz-card py-1.5 pe-8 ps-2.5 text-xs disabled:opacity-50 max-sm:min-h-11 ${
          rider.hasPlan ? "border-cz-border text-cz-1" : "border-dashed border-cz-warning text-cz-1"
        }`}
      >
        {value === null && <option value="">Hele dagen er løb eller kørt</option>}
        <SessionOptions />
      </select>
      <ChevronDownIcon size={14} aria-hidden="true" className="pointer-events-none absolute inset-e-2.5 top-1/2 -translate-y-1/2 text-cz-3" />
    </div>
  );
}

// --- Siden omkring (samme ramme i alle tre retninger) -----------------------

function usePlans(pressedAtStart: boolean) {
  const base = Object.fromEntries(RIDERS.map((r) => [r.id, r.fields])) as Record<string, Field[]>;
  const [fields, setFields] = useState<Record<string, Field[]>>(() =>
    pressedAtStart ? Object.fromEntries(RIDERS.map((r) => [r.id, trainNow(r.fields)])) : base,
  );
  const [pressed, setPressed] = useState(pressedAtStart);
  const onField = (id: string, i: number, s: Session) => setFields((p) => ({ ...p, [id]: setField(p[id], i, s) }));
  const onDay = (id: string, s: Session) => setFields((p) => ({ ...p, [id]: applyWholeDay(p[id], s) }));
  const onProgram = (id: string) => setFields((p) => ({ ...p, [id]: base[id] }));
  const press = () => {
    setFields((p) => Object.fromEntries(Object.entries(p).map(([id, f]) => [id, trainNow(f)])));
    setPressed(true);
  };
  return { fields, base, pressed, onField, onDay, onProgram, press };
}

type Plans = ReturnType<typeof usePlans>;

function PageFrame({ plans, children }: { plans: Plans; children: ReactNode }) {
  const counts = overviewCounts(RIDERS.map((r) => ({ fields: plans.fields[r.id], hasPlan: r.hasPlan, tired: r.tone === "risk" || r.ruleNote !== null })));
  const waiting = RIDERS.filter((r) => plans.fields[r.id].some((f) => f.kind === "stage")).length;
  const cells: Array<{ label: string; n: number; warn?: boolean }> = [
    { label: "Mangler plan i dag", n: counts.needsPlan, warn: counts.needsPlan > 0 },
    { label: "Kører løb i dag", n: counts.racing },
    { label: "Træner i dag", n: counts.training },
    { label: "Trætte", n: counts.tired, warn: counts.tired > 0 },
  ];
  return (
    <main className="mx-auto max-w-[1600px] px-4 pb-16 pt-7 sm:px-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-data text-[20px] font-bold tracking-[-0.01em] text-cz-1">Træning</h1>
          <p className="mt-1 text-[13px] text-cz-2">{DATE_LABEL} · 5 felter pr. rytter · {RACE_LABEL}, etape 3 på felt 3</p>
        </div>
        <div className="flex flex-col items-end gap-1 max-sm:w-full max-sm:items-stretch">
          {plans.pressed ? (
            <Button variant="secondary" size="sm" disabled iconLeft={<CheckIcon size={14} aria-hidden="true" />}>Trænet kl. 14:05</Button>
          ) : (
            <Button size="sm" onClick={plans.press}>Træn nu</Button>
          )}
          <span className="inline-flex items-center gap-1 text-2xs text-cz-2">
            {plans.pressed ? (
              <><ClockIcon size={12} aria-hidden="true" className="text-cz-3" />{waiting} ryttere venter på deres løb; løbet afregnes efter etapen</>
            ) : (
              <><GiftIcon size={12} aria-hidden="true" className="text-cz-3" />Bonus når du selv trykker, før holdets automatiske træning</>
            )}
          </span>
        </div>
      </header>

      <nav className="mb-4 flex gap-5 border-b border-cz-border text-[13px]" aria-label="Træning">
        {["I dag", "I morgen", "Program", "Rapport"].map((tab, i) => (
          <a
            key={tab}
            href={`#${tab}`}
            aria-current={i === 0 ? "page" : undefined}
            className={`-mb-px border-b-2 pb-2 font-medium max-sm:min-h-11 ${i === 0 ? "border-cz-1 text-cz-1" : "border-transparent text-cz-2 hover:text-cz-1"}`}
          >
            {tab}
          </a>
        ))}
      </nav>

      <div className="mb-4 grid grid-cols-4 overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        {cells.map((c, i) => (
          <button
            key={c.label}
            type="button"
            className={`px-3 py-2 text-start hover:bg-cz-subtle max-sm:px-2 ${i > 0 ? "border-s border-cz-border" : ""}`}
          >
            <div className={`font-data text-lg font-bold tabular-nums ${c.warn ? "text-cz-warning" : "text-cz-1"}`}>{c.n}</div>
            <div className="text-3xs leading-tight text-cz-2 sm:text-2xs">{c.label}</div>
          </button>
        ))}
      </div>
      {children}
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-cz-3">
        <span className="inline-flex items-center gap-1"><LevelTicks level={0} /> hvile</span>
        <span className="inline-flex items-center gap-1"><LevelTicks level={1} /> let</span>
        <span className="inline-flex items-center gap-1"><LevelTicks level={2} /> mellem</span>
        <span className="inline-flex items-center gap-1"><LevelTicks level={3} /> hård</span>
        <span className="inline-flex items-center gap-1"><LockIcon size={11} aria-hidden="true" /> etape, låst af løbet</span>
        <span className="inline-flex items-center gap-1"><span className="font-semibold text-cz-1 underline decoration-dotted underline-offset-2">Tempo</span> rettet i dag</span>
        <span>Træthed: nu til i aften. XP vises, når Udvikling 2.0 er tændt.</span>
      </p>
    </main>
  );
}

const TH = "px-3 py-2 text-start font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3";
const TD = "border-t border-cz-border px-3 py-[7px] align-middle";

function FieldHeader() {
  return (
    <th className={`${TH} w-[400px]`}>
      <div className="grid grid-cols-5 gap-1">
        {FIELD_NUMBERS.map((n) => <span key={n} className="text-center">Felt {n}</span>)}
      </div>
    </th>
  );
}

// --- Retning 1: en vaelger, fem felter --------------------------------------

function Direction1({ plans }: { plans: Plans }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-cz border border-cz-border bg-cz-card md:block">
        <table className="w-full border-collapse">
          <thead className="bg-cz-subtle">
            <tr>
              <th className={TH}>Rytter</th>
              <th className={TH}>Træthed</th>
              <th className={TH}>Dagens træning</th>
              <FieldHeader />
              <th className={TH}>XP, seneste dato</th>
            </tr>
          </thead>
          <tbody>
            {RIDERS.map((r) => (
              <tr key={r.id}>
                <td className={TD}>
                  <RiderName rider={r} />
                  <div className="truncate text-3xs"><SourceLine rider={r} /></div>
                </td>
                <td className={TD}>
                  <Fatigue rider={r} />
                  {r.ruleNote && <div className="text-3xs text-cz-warning">{r.ruleNote}</div>}
                </td>
                <td className={TD}><DaySelect rider={r} fields={plans.fields[r.id]} onDay={(s) => plans.onDay(r.id, s)} /></td>
                <td className={TD}><FieldStrip rider={r} fields={plans.fields[r.id]} onField={(i, s) => plans.onField(r.id, i, s)} /></td>
                <td className={TD}><XpCell rider={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-cz-border overflow-hidden rounded-cz border border-cz-border bg-cz-card md:hidden">
        {RIDERS.map((r) => (
          <li key={r.id} className="space-y-2 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <RiderName rider={r} />
              <div className="text-end">
                <Fatigue rider={r} inline />
                <div className="font-data text-3xs tabular-nums text-cz-2">{r.xpToday > 0 ? `+${r.xpToday} XP` : ""}</div>
              </div>
            </div>
            {r.ruleNote && <div className="text-3xs text-cz-warning">{r.ruleNote}</div>}
            <DaySelect rider={r} fields={plans.fields[r.id]} onDay={(s) => plans.onDay(r.id, s)} full />
            <FieldStrip rider={r} fields={plans.fields[r.id]} onField={(i, s) => plans.onField(r.id, i, s)} tall />
            <div className="truncate text-3xs"><SourceLine rider={r} /></div>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- Retning 2: et tryk pr. rytter ------------------------------------------

type Quick = "program" | "rest" | "recovery" | "other";

function quickOf(fields: Field[], base: Field[]): Quick | null {
  const open = fields.filter((f) => f.kind === "train");
  if (open.length === 0) return null;
  if (JSON.stringify(fields) === JSON.stringify(base)) return "program";
  if (open.every((f) => f.kind === "train" && f.session === "rest")) return "rest";
  if (open.every((f) => f.kind === "train" && f.session === "recovery")) return "recovery";
  return "other";
}

function QuickChoice({ rider, plans, full = false }: { rider: SketchRider; plans: Plans; full?: boolean }) {
  const fields = plans.fields[rider.id];
  const quick = quickOf(fields, plans.base[rider.id]);
  if (quick === null) {
    return <span className="font-data text-2xs text-cz-3">{plans.pressed ? "Kørt i dag" : "Hele dagen er løb"}</span>;
  }
  const restOn = quick === "rest" || quick === "recovery";
  const other = quick === "other" ? dayChoice(fields) : null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${full ? "w-full" : ""}`}>
      <Segmented
        label={`${rider.name}: dagens træning`}
        value={restOn ? "rest" : quick}
        onChange={(v: string) => (v === "program" ? plans.onProgram(rider.id) : plans.onDay(rider.id, "rest"))}
        options={[
          { value: "program", label: rider.hasPlan ? "Program" : "Assistentens" },
          { value: "rest", label: "Hvile" },
        ]}
      />
      <div className="relative">
        <select
          value={other ?? ""}
          aria-label={`${rider.name}: andet pas på alle åbne felter`}
          onChange={(e) => plans.onDay(rider.id, e.target.value as Session)}
          className={`appearance-none rounded-cz border py-1.5 pe-7 ps-2.5 text-xs max-sm:min-h-11 ${
            other ? "border-cz-accent/40 bg-cz-accent/10 font-medium text-cz-accent-t" : "border-cz-border bg-cz-card text-cz-2"
          }`}
        >
          {!other && <option value="">Andet</option>}
          <SessionOptions />
        </select>
        <ChevronDownIcon size={13} aria-hidden="true" className="pointer-events-none absolute inset-e-2 top-1/2 -translate-y-1/2 text-cz-3" />
      </div>
      {restOn && (
        <Segmented
          label={`${rider.name}: slags hvile`}
          value={quick}
          onChange={(v: string) => plans.onDay(rider.id, v === "recovery" ? "recovery" : "rest")}
          options={[
            { value: "rest", label: "Fuld hvile" },
            { value: "recovery", label: "Aktiv restitution" },
          ]}
        />
      )}
    </div>
  );
}

function Direction2({ plans }: { plans: Plans }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-cz border border-cz-border bg-cz-card md:block">
        <div className="flex flex-wrap items-center gap-3 border-b border-cz-border px-3 py-2 text-xs text-cz-2">
          <span className="font-medium text-cz-1">Hele holdet</span>
          <Segmented label="Hele holdet" value="" onChange={() => undefined} options={[{ value: "program", label: "Alle følger program" }, { value: "rest", label: "Trætte hviler" }]} />
          <span className="text-2xs text-cz-3">Et tryk på et felt retter kun det felt i dag.</span>
        </div>
        <table className="w-full border-collapse">
          <thead className="bg-cz-subtle">
            <tr>
              <th className={TH}>Rytter</th>
              <th className={TH}>Træthed</th>
              <th className={TH}>Dagens træning</th>
              <FieldHeader />
              <th className={TH}>XP, seneste dato</th>
            </tr>
          </thead>
          <tbody>
            {RIDERS.map((r) => (
              <tr key={r.id}>
                <td className={TD}>
                  <RiderName rider={r} />
                  <div className="truncate text-3xs"><SourceLine rider={r} /></div>
                </td>
                <td className={TD}>
                  <Fatigue rider={r} />
                  {r.ruleNote && <div className="text-3xs text-cz-warning">{r.ruleNote}</div>}
                </td>
                <td className={TD}><QuickChoice rider={r} plans={plans} /></td>
                <td className={TD}><FieldStrip rider={r} fields={plans.fields[r.id]} onField={(i, s) => plans.onField(r.id, i, s)} /></td>
                <td className={TD}><XpCell rider={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-cz-border overflow-hidden rounded-cz border border-cz-border bg-cz-card md:hidden">
        {RIDERS.map((r) => (
          <li key={r.id} className="space-y-2 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <RiderName rider={r} />
              <Fatigue rider={r} inline />
            </div>
            {r.ruleNote && <div className="text-3xs text-cz-warning">{r.ruleNote}</div>}
            <QuickChoice rider={r} plans={plans} full />
            <FieldStrip rider={r} fields={plans.fields[r.id]} onField={(i, s) => plans.onField(r.id, i, s)} tall />
            <div className="flex items-center justify-between gap-3 text-3xs">
              <span className="min-w-0 truncate"><SourceLine rider={r} /></span>
              <XpCell rider={r} compact />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- Retning 3: ugen ved rytteren -------------------------------------------

const BAR_WIDTH = ["w-[18%]", "w-[45%]", "w-[72%]", "w-full"] as const;

function MiniDay({ day, label, active, today, onOpen }: { day: Array<Session | "S">; label: string; active: boolean; today: boolean; onOpen: () => void }) {
  const hasStage = day.includes("S");
  const words = day.map((d) => (d === "S" ? "etape" : SESSION_SHORT[d])).join(", ");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={active}
      aria-label={`${label}: ${words}`}
      className={`flex min-h-11 min-w-0 flex-col gap-[3px] rounded-cz border px-1.5 py-1 text-start ${
        active ? "border-cz-1 bg-cz-subtle" : "border-cz-border bg-cz-card hover:border-cz-border-strong"
      }`}
    >
      <span className={`flex items-center gap-1 font-data text-3xs ${today ? "font-bold text-cz-1" : "text-cz-2"}`}>
        {label}{hasStage && <LockIcon size={9} aria-hidden="true" />}
      </span>
      {day.map((d, i) => (
        <span key={i} aria-hidden="true" className="block h-[3px] w-full">
          <span className={`block h-full rounded-[1px] ${d === "S" ? "w-full bg-cz-1" : `${BAR_WIDTH[levelOf(d)]} ${levelOf(d) === 0 ? "bg-cz-border-strong" : "bg-cz-3"}`}`} />
        </span>
      ))}
    </button>
  );
}

function weekFieldsFor(rider: SketchRider, dayIndex: number): Field[] {
  return rider.week[dayIndex].map((d) => (d === "S" ? { kind: "stage", label: "Etape" } : { kind: "train", session: d, changed: false }));
}

function Direction3({ plans, openDay }: { plans: Plans; openDay: { id: string; day: number } | null }) {
  const [open, setOpen] = useState(openDay);
  const [future, setFuture] = useState<Record<string, Field[]>>({});
  const keyOf = (id: string, day: number) => `${id}:${day}`;
  const fieldsAt = (r: SketchRider, day: number) => (day === 0 ? plans.fields[r.id] : future[keyOf(r.id, day)] ?? weekFieldsFor(r, day));
  const setAt = (r: SketchRider, day: number, next: Field[]) => (day === 0 ? undefined : setFuture((p) => ({ ...p, [keyOf(r.id, day)]: next })));
  const toggle = (id: string, day: number) => setOpen((o) => (o && o.id === id && o.day === day ? null : { id, day }));

  const renderWeek = (r: SketchRider) => (
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAYS.map((wd, day) => (
        <MiniDay
          key={wd}
          day={day === 0 ? plans.fields[r.id].map((f) => (f.kind === "stage" ? "S" : f.session)) : fieldsAt(r, day).map((f) => (f.kind === "stage" ? "S" : f.session))}
          label={day === 0 ? "I dag" : wd}
          today={day === 0}
          active={open?.id === r.id && open.day === day}
          onOpen={() => toggle(r.id, day)}
        />
      ))}
    </div>
  );

  const renderExpanded = (r: SketchRider) => {
    if (!open || open.id !== r.id) return null;
    const day = open.day;
    const fields = fieldsAt(r, day);
    const onField = (i: number, s: Session) => (day === 0 ? plans.onField(r.id, i, s) : setAt(r, day, setField(fields, i, s)));
    const onDay = (s: Session) => (day === 0 ? plans.onDay(r.id, s) : setAt(r, day, applyWholeDay(fields, s)));
    return (
      <div className="space-y-2 rounded-cz border border-cz-border bg-cz-subtle p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-cz-1">{day === 0 ? "I dag" : `${WEEKDAYS[day]}, om ${day} ${day === 1 ? "dag" : "dage"}`}: fem felter</span>
          <DaySelect rider={r} fields={fields} onDay={onDay} />
        </div>
        <FieldStrip rider={r} fields={fields} onField={onField} tall />
        {r.source.kind === "own" && day > 0 && (
          <p className="text-3xs text-cz-2">Ændringen gælder kun denne dato. Programmet {r.source.name} fortsætter bagefter.</p>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="hidden overflow-hidden rounded-cz border border-cz-border bg-cz-card md:block">
        <table className="w-full border-collapse">
          <thead className="bg-cz-subtle">
            <tr>
              <th className={TH}>Rytter</th>
              <th className={TH}>Træthed</th>
              <FieldHeader />
              <th className={TH}>De næste 7 dage</th>
            </tr>
          </thead>
          <tbody>
            {RIDERS.map((r) => (
              <tr key={r.id}>
                <td className={`${TD} w-[220px]`}>
                  <RiderName rider={r} />
                  <div className="truncate text-3xs"><SourceLine rider={r} /></div>
                  {r.xpToday > 0 && <div className="mt-0.5"><XpCell rider={r} compact /></div>}
                </td>
                <td className={TD}>
                  <Fatigue rider={r} />
                  {r.ruleNote && <div className="text-3xs text-cz-warning">{r.ruleNote}</div>}
                </td>
                <td className={TD}><FieldStrip rider={r} fields={plans.fields[r.id]} onField={(i, s) => plans.onField(r.id, i, s)} /></td>
                <td className={`${TD} w-[440px]`}>
                  {renderWeek(r)}
                  {open?.id === r.id && open.day > 0 && <div className="mt-2">{renderExpanded(r)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-cz-border overflow-hidden rounded-cz border border-cz-border bg-cz-card md:hidden">
        {RIDERS.map((r) => (
          <li key={r.id} className="space-y-2 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <RiderName rider={r} />
              <div className="text-end">
                <Fatigue rider={r} inline />
                <div className="font-data text-3xs tabular-nums text-cz-2">{r.xpToday > 0 ? `+${r.xpToday} XP` : ""}</div>
              </div>
            </div>
            {renderWeek(r)}
            {open?.id === r.id ? renderExpanded(r) : <FieldStrip rider={r} fields={plans.fields[r.id]} onField={(i, s) => plans.onField(r.id, i, s)} tall />}
            <div className="truncate text-3xs"><SourceLine rider={r} /></div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Sketch({ id, pressed, openDay }: { id: Exclude<DirectionId, "today">; pressed: boolean; openDay: { id: string; day: number } | null }) {
  const plans = usePlans(pressed);
  return (
    <div className="min-h-screen bg-cz-body">
      <Banner id={id} />
      <PageFrame plans={plans}>
        {id === "r1" && <Direction1 plans={plans} />}
        {id === "r2" && <Direction2 plans={plans} />}
        {id === "r3" && <Direction3 plans={plans} openDay={openDay} />}
      </PageFrame>
    </div>
  );
}
