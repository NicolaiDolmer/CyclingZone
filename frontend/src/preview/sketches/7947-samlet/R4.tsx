// #7947 retning 4: samlet efter kravspecen (#8301 §6). Ramme med dagspile for
// hele holdet (i gaar, i dag, 7 dage frem), raekken fra R2, hurtigvalg (type +
// Let/Mellem/Haard) som raekkens hovedvalg, kilde under hvert af de fem felter,
// og et valg paa en dato gaelder kun den dato. Intet her er produktkode.

import { useMemo, useState } from "react";
import Button from "../../../components/ui/Button.jsx";
import { Flag } from "../../../components/Flag.jsx";
import {
  AlertTriangleIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, GiftIcon, LockIcon,
} from "../../../components/ui/icons/index.jsx";
import { levelOf, type Level, type Session } from "./model.ts";
import { RIDERS, SESSION_GROUPS, SESSION_NAME, SESSION_SHORT, type SketchRider, type Tone } from "./data.ts";
import {
  RIDER_TYPES, SOURCE_WORD, hasDateOverride, resolveDate,
  type BaseSource, type Effort, type Quick, type R4Field, type RiderType,
} from "./r4model.ts";

// --- Data til retning 4 -------------------------------------------------------

// Ni datoer: i gaar (koert), i dag og 7 dage frem (K5). Indeks 1 = i dag.
const DATES = [
  { short: "Man", day: 16, long: "Mandag 16. november" },
  { short: "Tir", day: 17, long: "Tirsdag 17. november" },
  { short: "Ons", day: 18, long: "Onsdag 18. november" },
  { short: "Tor", day: 19, long: "Torsdag 19. november" },
  { short: "Fre", day: 20, long: "Fredag 20. november" },
  { short: "Lør", day: 21, long: "Lørdag 21. november" },
  { short: "Søn", day: 22, long: "Søndag 22. november" },
  { short: "Man", day: 23, long: "Mandag 23. november" },
  { short: "Tir", day: 24, long: "Tirsdag 24. november" },
] as const;
const TODAY = 1;
const RACE_ON: Record<number, string> = { 0: "Etape 2", 1: "Etape 3 + endagsløb", 2: "Etape 4", 3: "Etape 5" };

// Ejerens hold (prod, kun SELECT 17/11): navne, nation og ryttertype er ægte.
// Træningstallene (træthed, felter, XP) er eksempler.
const REAL: Record<string, { name: string; nation: string; type: string }> = {
  r1: { name: "Nicolò Vitali", nation: "it", type: "Klatrer" },
  r2: { name: "Frederik Pedersen", nation: "dk", type: "Rouleur" },
  r3: { name: "Aron Bizimana", nation: "er", type: "Brostensrytter" },
  r4: { name: "Bram Janssen", nation: "be", type: "Puncheur" },
  r5: { name: "Elias Fuchs", nation: "de", type: "Enkeltstartsrytter" },
  r6: { name: "Henrik Nyström", nation: "no", type: "Rouleur" },
  r7: { name: "Felix Schmidt", nation: "ch", type: "Allround" },
  r8: { name: "Matthias Werner", nation: "de", type: "Allround" },
  r9: { name: "Enzo Lemaire", nation: "fr", type: "Rouleur" },
};
const TEAM: SketchRider[] = RIDERS.map((r) => ({ ...r, ...REAL[r.id] }));

type Origin = { source: BaseSource; label: string };
const ORIGIN: Record<string, Origin> = {
  r1: { source: "team", label: "Holdrytmen" },
  r2: { source: "team", label: "Holdrytmen" },
  r3: { source: "team", label: "Holdrytmen" },
  r4: { source: "program", label: "Program: Ardennerne" },
  r5: { source: "program", label: "Program: Enkeltstart-uge" },
  r6: { source: "group", label: "Gruppe: Rouleur-gruppen" },
  r7: { source: "team", label: "Holdrytmen" },
  r8: { source: "default", label: "Ingen plan · standard for Allround" },
  r9: { source: "team", label: "Holdrytmen" },
};

// Etapenummer pr. dato for de tre ryttere i etapeloebet.
const STAGE_NO: Record<number, number> = { 0: 2, 1: 3, 2: 4, 3: 5 };

function baseFor(rider: SketchRider, dateIdx: number): R4Field[] {
  const origin = ORIGIN[rider.id];
  if (dateIdx === TODAY) {
    return rider.fields.map((f): R4Field => {
      if (f.kind === "stage") return { kind: "stage", label: f.label, source: "stage" };
      const session = f.kind === "train" || f.kind === "done" ? f.session : "endurance";
      const rule = rider.ruleNote !== null && levelOf(session) === 0;
      return { kind: "train", session, source: rule ? "rule" : origin.source };
    });
  }
  // rider.week[0] er i dag; i gaar laaner dagens moenster, +7 laaner ugens foerste dag.
  const day = rider.week[dateIdx === 0 ? 0 : (dateIdx - TODAY) % 7];
  return day.map((s): R4Field => {
    if (s === "S" && STAGE_NO[dateIdx] === undefined) return { kind: "train", session: "endurance", source: origin.source };
    if (s === "S") return { kind: "stage", label: `Etape ${STAGE_NO[dateIdx]}`, source: "stage" };
    return { kind: "train", session: s, source: origin.source, done: dateIdx < TODAY };
  });
}

type DateState = { quick: Quick | null; manual: Record<number, Session> };
type Plans = Record<string, Record<number, DateState>>;
const EMPTY: DateState = { quick: null, manual: {} };

// Startbilledet viser alle kilder paa en gang (i dag): et hurtigvalg paa en
// rytter i program (#8026), et manuelt felt, traethedsreglen og en rytter uden plan.
const START: Plans = {
  r4: { [TODAY]: { quick: { kind: "effort", effort: "hard", type: "Puncheur" }, manual: {} } },
  r5: { [TODAY]: { quick: null, manual: { 3: "aero" } } },
  r9: { [TODAY + 1]: { quick: { kind: "rest", rest: "recovery" }, manual: {} } },
};

// --- Smaa stumper -------------------------------------------------------------

const TONE_TEXT: Record<Tone, string> = { ok: "text-cz-success", warn: "text-cz-warning", risk: "text-cz-danger" };

function LevelTicks({ level }: { level: Level }) {
  return (
    <span aria-hidden="true" className="flex items-end gap-[2px]">
      {[1, 2, 3].map((n) => (
        <span key={n} className={`w-[3px] rounded-[1px] ${n <= level ? "bg-cz-2" : "bg-cz-border"}`} style={{ height: 3 + n * 2 }} />
      ))}
    </span>
  );
}

function SessionOptions() {
  return (
    <>
      {SESSION_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.sessions.map((s) => <option key={s} value={s}>{SESSION_NAME[s]}</option>)}
        </optgroup>
      ))}
    </>
  );
}

function FieldCell({ field, n, riderName, onSet, readOnly }: {
  field: R4Field; n: number; riderName: string; onSet: (s: Session) => void; readOnly: boolean;
}) {
  const sourceWord = field.kind === "train" && field.done ? SOURCE_WORD.done : SOURCE_WORD[field.source];
  const strong = field.source === "quick" || field.source === "manual";
  const chip = (() => {
    if (field.kind === "stage") {
      return (
        <span className="flex min-h-9 items-center justify-center gap-1 rounded-cz bg-cz-1 px-1 text-cz-card" role="img"
          aria-label={`${riderName}, felt ${n}: ${field.label}, låst af løbet`}>
          <LockIcon size={11} aria-hidden="true" className="shrink-0" />
          <span className="truncate font-data text-2xs font-semibold">{field.label}</span>
        </span>
      );
    }
    const level = levelOf(field.session);
    if (field.done || readOnly) {
      return (
        <span className="flex min-h-9 items-center justify-center gap-1 rounded-cz border border-cz-border bg-cz-subtle px-1 text-cz-3" role="img"
          aria-label={`${riderName}, felt ${n}: ${SESSION_NAME[field.session]}, kørt`}>
          <CheckIcon size={11} aria-hidden="true" className="shrink-0 text-cz-success" />
          <span className="truncate font-data text-2xs">{SESSION_SHORT[field.session]}</span>
        </span>
      );
    }
    return (
      <span className={`relative flex min-h-9 items-center justify-between gap-1 rounded-cz border bg-cz-card px-1.5 focus-within:outline focus-within:outline-2 focus-within:outline-cz-1 ${
        field.source === "manual" ? "border-cz-1" : "border-cz-border hover:border-cz-border-strong"}`}>
        <span className={`truncate font-data text-2xs ${level === 0 ? "text-cz-3" : "text-cz-1"} ${field.source === "manual" ? "font-semibold" : ""}`}>
          {SESSION_SHORT[field.session]}
        </span>
        <LevelTicks level={level} />
        <select value={field.session} onChange={(e) => onSet(e.target.value as Session)}
          aria-label={`${riderName}, felt ${n}: ${SESSION_NAME[field.session]}, kilde ${sourceWord}. Ret kun denne dato`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
          <SessionOptions />
        </select>
      </span>
    );
  })();
  return (
    <div className="min-w-0">
      {chip}
      <div className={`mt-0.5 truncate text-center font-data text-3xs ${strong ? "font-semibold text-cz-1" : field.source === "rule" ? "text-cz-warning" : "text-cz-3"}`}>
        {sourceWord}
      </div>
    </div>
  );
}

// Raekkens hovedvalg. "Program" = foelg det, der staar bag datoen (program,
// gruppe, holdrytme eller standard). Hvile er sit eget valg (aktiv restitution
// under Hvile, ejer 16/11), aldrig en indsats sammen med en type.
type Choice = "base" | Effort | "rest";
const CHOICES: Array<{ id: Choice; word: string }> = [
  { id: "base", word: "Program" },
  { id: "let", word: "Let" },
  { id: "mellem", word: "Mellem" },
  { id: "hard", word: "Hård" },
  { id: "rest", word: "Hvile" },
];

function choiceOf(q: Quick | null): Choice {
  if (!q) return "base";
  return q.kind === "rest" ? "rest" : q.effort;
}

function QuickSelect({ rider, state, onQuick, readOnly, full = false }: {
  rider: SketchRider; state: DateState; onQuick: (q: Quick | null) => void; readOnly: boolean; full?: boolean;
}) {
  const current = choiceOf(state.quick);
  const type = (state.quick?.kind === "effort" ? state.quick.type : rider.type) as RiderType;
  const baseWord = ORIGIN[rider.id].source === "default" ? "Standard" : ORIGIN[rider.id].source === "team" ? "Holdet" : "Program";
  const pick = (c: Choice) => {
    if (c === "base") onQuick(null);
    else if (c === "rest") onQuick({ kind: "rest", rest: state.quick?.kind === "rest" ? state.quick.rest : "recovery" });
    else onQuick({ kind: "effort", effort: c, type });
  };
  return (
    <div className={`flex flex-col gap-1 ${full ? "w-full" : "w-[300px]"}`}>
      <div role="radiogroup" aria-label={`${rider.name}: dagens træning`}
        className={`grid grid-cols-5 overflow-hidden rounded-cz border border-cz-border ${readOnly ? "opacity-50" : ""}`}>
        {CHOICES.map((c, i) => (
          <button key={c.id} type="button" role="radio" aria-checked={current === c.id} disabled={readOnly}
            onClick={() => pick(c.id)}
            className={`min-h-9 px-1 text-xs max-sm:min-h-11 ${i > 0 ? "border-s border-cz-border" : ""} ${
              current === c.id ? "bg-cz-accent/10 font-semibold text-cz-accent-t" : "bg-cz-card text-cz-2 hover:text-cz-1"}`}>
            {c.id === "base" ? baseWord : c.word}
          </button>
        ))}
      </div>
      <div className="relative">
        {state.quick?.kind === "rest" ? (
          <select value={state.quick.rest} disabled={readOnly} aria-label={`${rider.name}: hvilens art`}
            onChange={(e) => onQuick({ kind: "rest", rest: e.target.value as "rest" | "recovery" })}
            className="w-full appearance-none rounded-cz border border-cz-border bg-cz-card py-1 pe-7 ps-2 text-2xs text-cz-1 max-sm:min-h-11">
            <option value="recovery">Aktiv restitution</option>
            <option value="rest">Fuld hvile</option>
          </select>
        ) : (
          <select value={type} disabled={readOnly || current === "base"} aria-label={`${rider.name}: udvikl mod ryttertype`}
            onChange={(e) => state.quick?.kind === "effort" && onQuick({ ...state.quick, type: e.target.value as RiderType })}
            className="w-full appearance-none rounded-cz border border-cz-border bg-cz-card py-1 pe-7 ps-2 text-2xs text-cz-1 disabled:text-cz-3 max-sm:min-h-11">
            {RIDER_TYPES.map((t) => <option key={t} value={t}>{current === "base" ? `${ORIGIN[rider.id].label}` : `Udvikl mod: ${t}`}</option>)}
          </select>
        )}
        <ChevronDownIcon size={12} aria-hidden="true" className="pointer-events-none absolute inset-e-2 top-1/2 -translate-y-1/2 text-cz-3" />
      </div>
    </div>
  );
}

function RiderCell({ rider, override, dateLabel, onRemove }: { rider: SketchRider; override: boolean; dateLabel: string; onRemove: () => void }) {
  const origin = ORIGIN[rider.id];
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <Flag code={rider.nation} />
        <a href="#rider" className="truncate text-[13.5px] font-medium text-cz-1 hover:underline">{rider.name}</a>
      </div>
      <div className="truncate font-data text-3xs uppercase tracking-[.04em] text-cz-3">{rider.type}</div>
      <div className="mt-0.5 text-3xs">
        {origin.source === "program" || origin.source === "group" ? (
          <span className="text-cz-2">
            {origin.label}
            <button type="button" className="ms-1.5 font-medium text-cz-1 underline decoration-cz-border underline-offset-2 hover:decoration-cz-1">Pause i dag</button>
            <button type="button" className="ms-1.5 font-medium text-cz-1 underline decoration-cz-border underline-offset-2 hover:decoration-cz-1">Fjern</button>
          </span>
        ) : origin.source === "default" ? (
          <span className="font-semibold text-cz-warning">Mangler plan · standard for typen</span>
        ) : (
          <span className="text-cz-3">{origin.label}</span>
        )}
      </div>
      {override && (
        <div className="mt-0.5 text-3xs text-cz-1">
          Gælder kun {dateLabel}.{" "}
          {origin.source === "program" || origin.source === "group" ? "Programmet fortsætter dagen efter. " : ""}
          <button type="button" onClick={onRemove} className="font-medium underline decoration-cz-border underline-offset-2 hover:decoration-cz-1">Fortryd</button>
        </div>
      )}
    </div>
  );
}

function Fatigue({ rider }: { rider: SketchRider }) {
  return (
    <span className="font-data text-[13px] tabular-nums">
      <span className="text-cz-1">{rider.fatigueNow}</span>
      <span className="px-1 text-cz-3">til</span>
      <span className={`font-semibold ${TONE_TEXT[rider.tone]}`}>~{rider.fatigueTonight}</span>
      {rider.tone === "risk" && <AlertTriangleIcon size={12} aria-label="Over træthedsgrænsen" className={`ms-1 inline align-[-2px] ${TONE_TEXT.risk}`} />}
    </span>
  );
}

// --- Siden ---------------------------------------------------------------------

export default function Direction4({ pressedAtStart, dateAtStart, mobile }: { pressedAtStart: boolean; dateAtStart: number; mobile: boolean }) {
  const [date, setDate] = useState(dateAtStart);
  const [plans, setPlans] = useState<Plans>(START);
  const [pressed, setPressed] = useState(pressedAtStart);
  const isToday = date === TODAY;
  const isPast = date < TODAY;
  const dateLabel = date === TODAY ? "i dag" : date === TODAY + 1 ? "i morgen" : `${DATES[date].short.toLowerCase()} ${DATES[date].day}/11`;

  const stateOf = (id: string, d: number) => plans[id]?.[d] ?? EMPTY;
  const write = (id: string, d: number, next: DateState) =>
    setPlans((p) => ({ ...p, [id]: { ...(p[id] ?? {}), [d]: next } }));

  const rows = useMemo(() => TEAM.map((r) => {
    const st = stateOf(r.id, date);
    let fields = resolveDate(baseFor(r, date), st.quick, st.manual);
    if (pressed && isToday) fields = fields.map((f) => (f.kind === "train" ? { ...f, done: true } : f));
    return { rider: r, st, fields, override: hasDateOverride(st.quick, st.manual) };
  }), [plans, date, pressed]);

  const changedDates = new Set<number>();
  for (const byDate of Object.values(plans)) for (const [d, st] of Object.entries(byDate)) if (hasDateOverride(st.quick, st.manual)) changedDates.add(Number(d));

  const counts = {
    needsPlan: TEAM.filter((r) => ORIGIN[r.id].source === "default").length,
    racing: rows.filter((x) => x.fields.some((f) => f.kind === "stage")).length,
    training: rows.filter((x) => x.fields.some((f) => f.kind === "train" && levelOf(f.session) > 0)).length,
    tired: TEAM.filter((r) => r.tone === "risk" || r.ruleNote !== null).length,
  };
  const readOnly = isPast || (pressed && isToday);

  return (
    <main className="mx-auto max-w-[1600px] px-4 pb-16 pt-6 sm:px-8">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-data text-[20px] font-bold tracking-[-0.01em] text-cz-1">Træning</h1>
          <p className="mt-1 text-[13px] text-cz-2">5 felter pr. rytter pr. dag · vælg et hurtigvalg, eller ret et felt</p>
        </div>
        <div className="flex flex-col items-end gap-1 max-sm:w-full max-sm:items-stretch">
          {isToday && !pressed && <Button size="sm" onClick={() => setPressed(true)}>Træn nu</Button>}
          {isToday && pressed && (
            <Button variant="secondary" size="sm" disabled>
              <span className="inline-flex items-center gap-1.5"><CheckIcon size={14} aria-hidden="true" />Trænet kl. 14:05</span>
            </Button>
          )}
          <span className="inline-flex items-center gap-1 text-2xs text-cz-2">
            {isToday
              ? (<><GiftIcon size={12} aria-hidden="true" className="text-cz-3" />Bonus når du selv trykker, før holdets automatiske træning</>)
              : isPast ? "Kørt. Datoen kan ikke ændres." : "Træn nu findes kun i dag. Denne dato køres automatisk, når den kommer."}
          </span>
        </div>
      </header>

      <nav className="mb-3 flex gap-5 border-b border-cz-border text-[13px]" aria-label="Træning">
        {["Dag", "Program", "Udvikling", "Rapport"].map((tab, i) => (
          <a key={tab} href={`#${tab}`} aria-current={i === 0 ? "page" : undefined}
            className={`-mb-px border-b-2 pb-2 font-medium max-sm:min-h-11 ${i === 0 ? "border-cz-1 text-cz-1" : "border-transparent text-cz-2 hover:text-cz-1"}`}>
            {tab}
          </a>
        ))}
      </nav>

      {/* Dagspile for hele holdet (K5). */}
      <div className="mb-3 flex items-stretch gap-1" aria-label="Vælg dag">
        <button type="button" aria-label="Forrige dag" disabled={date === 0} onClick={() => setDate((d) => Math.max(0, d - 1))}
          className="flex min-w-11 items-center justify-center rounded-cz border border-cz-border bg-cz-card text-cz-2 disabled:opacity-40">
          <ChevronLeftIcon size={16} aria-hidden="true" />
        </button>
        <div className="grid flex-1 gap-1 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${mobile ? 4 : DATES.length}, minmax(0, 1fr))` }}>
          {DATES.map((d, i) => {
            if (mobile && (i < date - 1 || i > date + 2)) return null;
            const active = i === date;
            return (
              <button key={i} type="button" onClick={() => setDate(i)} aria-current={active ? "date" : undefined}
                className={`rounded-cz border px-2 py-1.5 text-start ${active ? "border-cz-1 bg-cz-card" : "border-cz-border bg-cz-card/60 hover:bg-cz-card"}`}>
                <div className="flex items-baseline justify-between gap-1">
                  <span className={`font-data text-xs tabular-nums ${active ? "font-bold text-cz-1" : "text-cz-2"}`}>{d.short} {d.day}/11</span>
                  {changedDates.has(i) && <span className="h-1.5 w-1.5 rounded-full bg-cz-1" aria-label="Ændret for denne dato" />}
                </div>
                <div className={`truncate text-3xs ${i === TODAY ? "font-semibold text-cz-1" : i < TODAY ? "text-cz-3" : "text-cz-3"}`}>
                  {i === TODAY ? "I dag" : i < TODAY ? "Kørt" : RACE_ON[i] ?? "Træning"}
                </div>
              </button>
            );
          })}
        </div>
        <button type="button" aria-label="Næste dag" disabled={date === DATES.length - 1} onClick={() => setDate((d) => Math.min(DATES.length - 1, d + 1))}
          className="flex min-w-11 items-center justify-center rounded-cz border border-cz-border bg-cz-card text-cz-2 disabled:opacity-40">
          <ChevronRightIcon size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="mb-3 text-xs text-cz-2">
        <span className="font-semibold text-cz-1">{DATES[date].long}</span>
        {isToday ? " · i dag" : isPast ? " · kørt" : " · du planlægger frem. Et valg her gælder kun denne dato."}
        {RACE_ON[date] ? ` · Ronde van Preview: ${RACE_ON[date]}` : ""}
      </p>

      <div className="mb-3 grid grid-cols-4 overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        {[
          { label: "Mangler plan", n: counts.needsPlan, warn: counts.needsPlan > 0 },
          { label: "Kører løb", n: counts.racing },
          { label: "Træner", n: counts.training },
          { label: "Trætte", n: counts.tired, warn: counts.tired > 0 },
        ].map((c, i) => (
          <button key={c.label} type="button" className={`px-3 py-2 text-start hover:bg-cz-subtle max-sm:px-2 ${i > 0 ? "border-s border-cz-border" : ""}`}>
            <div className="flex items-center gap-1.5 font-data text-lg font-bold tabular-nums text-cz-1">{c.n}{c.warn && <AlertTriangleIcon size={14} aria-label="Kræver handling" className="text-cz-warning" />}</div>
            <div className="text-3xs leading-tight text-cz-2 sm:text-2xs">{c.label}</div>
          </button>
        ))}
      </div>

      {/* Paritet: Dagens beslutning + assistentens forslag + hele holdet + masse-dag + gruppering. */}
      {!readOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-cz border border-cz-border bg-cz-card px-3 py-2 text-xs">
          <span className="font-semibold text-cz-1">Dagens beslutning</span>
          <span className="text-cz-2">Aron Bizimana er over grænsen: Aktiv restitution</span>
          <button type="button" className="font-medium text-cz-1 underline decoration-cz-border underline-offset-2">Brug</button>
          <span className="text-cz-3">·</span>
          <span className="text-cz-2">Matthias Werner mangler plan: Mellem mod Allround</span>
          <button type="button" className="font-medium text-cz-1 underline decoration-cz-border underline-offset-2">Brug</button>
          <span className="ms-auto text-cz-2"><button type="button" className="font-medium text-cz-1 underline decoration-cz-border underline-offset-2">Assistentens forslag (3)</button></span>
        </div>
      )}
      {!readOnly && !mobile && (
        <div className="flex flex-wrap items-center gap-3 rounded-t-cz border border-b-0 border-cz-border bg-cz-subtle px-3 py-2 text-xs">
          <label className="inline-flex items-center gap-1.5 text-cz-2"><input type="checkbox" aria-label="Markér alle ryttere" /> Markér</label>
          <span className="font-semibold text-cz-1">Hele holdet {dateLabel}:</span>
          {["Program", "Let", "Mellem", "Hård", "Hvile"].map((w) => (
            <button key={w} type="button" className="rounded-cz border border-cz-border bg-cz-card px-2 py-1 text-cz-1 hover:border-cz-border-strong">{w}</button>
          ))}
          <span className="text-cz-3">Hurtigvalg bruger hver rytters egen type. Et tryk på et felt retter kun det felt {dateLabel}.</span>
          <span className="ms-auto inline-flex items-center gap-2 text-cz-2">Gruppér
            <select className="rounded-cz border border-cz-border bg-cz-card px-2 py-1 text-xs" aria-label="Gruppér efter"><option>Ingen</option><option>Ryttertype</option></select>
          </span>
        </div>
      )}

      {mobile ? (
        <ul className="divide-y divide-cz-border overflow-hidden rounded-cz border border-cz-border bg-cz-card">
          {rows.map(({ rider, st, fields, override }) => (
            <li key={rider.id} className="flex flex-col gap-2 px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <RiderCell rider={rider} override={override} dateLabel={dateLabel} onRemove={() => write(rider.id, date, EMPTY)} />
                <Fatigue rider={rider} />
              </div>
              <QuickSelect rider={rider} state={st} readOnly={readOnly} full onQuick={(q) => write(rider.id, date, { quick: q, manual: {} })} />
              <div className="grid grid-cols-5 gap-1">
                {fields.map((f, i) => (
                  <FieldCell key={i} field={f} n={i + 1} riderName={rider.name} readOnly={readOnly}
                    onSet={(s) => write(rider.id, date, { ...st, manual: { ...st.manual, [i]: s } })} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-hidden rounded-b-cz border border-cz-border bg-cz-card">
          <table className="w-full table-fixed text-xs" data-sort-intent="none">
            <thead className="bg-cz-subtle">
              <tr>
                <th className="w-[28px]" />
                {["Rytter", "Træthed", "Hurtigvalg", "Felt 1 · 2 · 3 · 4 · 5 (kilde under feltet)", "XP"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 text-start font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3 ${
                    ["w-[250px]", "w-[96px]", "w-[324px]", "", "w-[120px]"][i]}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ rider, st, fields, override }) => (
                <tr key={rider.id} className="border-t border-cz-border align-top">
                  <td className="ps-3 pt-3"><input type="checkbox" aria-label={`Markér ${rider.name}`} disabled={readOnly} /></td>
                  <td className="px-3 py-2"><RiderCell rider={rider} override={override} dateLabel={dateLabel} onRemove={() => write(rider.id, date, EMPTY)} /></td>
                  <td className="px-3 py-2">
                    <Fatigue rider={rider} />
                    {rider.ruleNote && <div className="mt-0.5 text-3xs text-cz-warning">{rider.ruleNote}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <QuickSelect rider={rider} state={st} readOnly={readOnly} onQuick={(q) => write(rider.id, date, { quick: q, manual: {} })} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="grid grid-cols-5 gap-1">
                      {fields.map((f, i) => (
                        <FieldCell key={i} field={f} n={i + 1} riderName={rider.name} readOnly={readOnly}
                          onSet={(s) => write(rider.id, date, { ...st, manual: { ...st.manual, [i]: s } })} />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {rider.xpToday === 0 ? <span className="font-data text-2xs text-cz-3">Ingen XP endnu</span> : (
                      <div>
                        <div className="font-data text-xs font-semibold tabular-nums text-cz-1">+{rider.xpToday} XP</div>
                        <div className="mt-1 h-1 overflow-hidden rounded-cz bg-cz-border" aria-hidden="true">
                          <div className="h-full bg-cz-2" style={{ width: `${Math.round(rider.nextShare * 100)}%` }} />
                        </div>
                        <div className="mt-0.5 truncate font-data text-3xs text-cz-3">Næste point: {rider.nextPoint}</div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-cz-3">
        <span className="inline-flex items-center gap-1"><LevelTicks level={0} /> hvile</span>
        <span className="inline-flex items-center gap-1"><LevelTicks level={1} /> let</span>
        <span className="inline-flex items-center gap-1"><LevelTicks level={2} /> mellem</span>
        <span className="inline-flex items-center gap-1"><LevelTicks level={3} /> hård</span>
        <span className="inline-flex items-center gap-1"><LockIcon size={11} aria-hidden="true" /> etape, låst af løbet</span>
        <span>Kilde under feltet: Manuel vinder over Hurtigvalg, som vinder over Program, Gruppe, Holdrytme og Standard. Træthed = holdets træthedsregel. Navne og typer er dit hold; træningstallene er eksempler.</span>
      </p>
    </main>
  );
}
