// #8580 · LEVENDE SKITSE (design-branch, merges aldrig). Dagsvælgeren lagt oven på den rigtige
// I dag-fane på preview, så ejeren kan se A og B, som de ville se ud på siden.
//   ?dayPicker=a  A: dagene frem er en oversigt; ændringer sker i Program (pr. ugedag).
//   ?dayPicker=b  B: som A, plus "kun denne dato" pr. rytter (kræver ny datotabel + motor).
// Felterne for en dag frem regnes med de samme funktioner som i dag (dayFields,
// programSessionToday) på datoens ugedag. Løbene frem er preview-fiktion.
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeftIcon, ChevronRightIcon, FlagIcon, LockIcon } from "../../ui/icons/index.jsx";
import { WEEKDAY_KEYS } from "../../../lib/training.js";
import { programSessionToday, type ProgramWeekDays } from "../../../lib/trainingPrograms.ts";
import { dayTypeForProgram, sessionForProgram, sessionI18nKey, DAY_TYPES_WITHOUT_SESSION } from "../../../lib/trainingDayTypes.js";
import { dayFields } from "./todayR5Model.ts";
import type { TodayR5Props } from "./TodayR5.tsx";

export function previewDayPicker(): "a" | "b" | null {
  if (!import.meta.env.VITE_PREVIEW_MOCK || typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("dayPicker");
  return v === "a" || v === "b" ? v : null;
}

const DAYS = 8;
const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const SHORT: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const LONG: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Preview-fiktion: holdets løb de næste dage (i prod kommer det fra GET /forecast/week, #8591).
const FUTURE_RACES: Record<number, { label: string; event: string; slots: number[] }> = {
  2: { label: "One-day race", event: "Trofeo Preview", slots: [2] },
  4: { label: "Stage 1", event: "Ronde Preview", slots: [1, 3] },
  5: { label: "Stage 3", event: "Ronde Preview", slots: [0, 2, 4] },
};
const CHOICES = ["program", "rest", "recovery", "endurance", "tempo", "sprint"] as const;

type Plan = { focus?: string | null; intensity?: string | null } | null | undefined;

export default function DayPickerSketch8580({ r5, variant, today }: { r5: TodayR5Props; variant: "a" | "b"; today: ReactNode }) {
  const { t } = useTranslation("training");
  const [date, setDate] = useState(0);
  const [only, setOnly] = useState<Record<string, string>>({}); // `${date}:${riderId}` -> valg (B)
  const dates = useMemo(() => Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(r5.today);
    d.setDate(d.getDate() + i);
    const weekday = WD[d.getDay()];
    return { i, weekday, day: d.getDate(), month: MONTHS[d.getMonth()] };
  }), [r5.today]);
  const racingToday = Object.keys(r5.racingToday ?? {}).length > 0;
  const raceOf = (i: number) => (i === 0 ? (racingToday ? { label: "Race", event: "", slots: [] } : null) : FUTURE_RACES[i] ?? null);
  const changedDates = new Set(Object.keys(only).map((k) => Number(k.split(":")[0])));

  const label = (s: string | null) => (s == null ? "–" : t([sessionI18nKey("dayPanel.session", s), `dayPanel.dayType_${s}`], { defaultValue: s }));
  const phone = r5.phone;
  const first = Math.max(0, Math.min(date - 1, DAYS - 3));
  const visible = phone ? [first, first + 1, first + 2] : dates.map((d) => d.i);

  const strip = (
    <div className="flex items-stretch gap-1" role="group" aria-label="Choose day" data-testid="sketch-day-picker">
      <button type="button" aria-label="Previous day" disabled={date === 0} onClick={() => setDate((d) => Math.max(0, d - 1))}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-cz border border-cz-border bg-cz-card text-cz-2 disabled:opacity-40">
        <ChevronLeftIcon size={16} aria-hidden="true" />
      </button>
      <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}>
        {visible.map((i) => {
          const d = dates[i];
          const race = raceOf(i);
          const active = i === date;
          return (
            <button key={i} type="button" onClick={() => setDate(i)} aria-current={active ? "date" : undefined}
              className={`min-h-11 min-w-0 rounded-cz border px-2 py-1.5 text-start ${active ? "border-cz-1 bg-cz-card" : "border-cz-border bg-cz-card hover:border-cz-3"}`}>
              <span className="flex items-center justify-between gap-1">
                <span className={`font-data text-xs tabular-nums ${active ? "font-semibold text-cz-1" : "text-cz-2"}`}>{i === 0 ? "Today" : `${SHORT[d.weekday]} ${d.day}`}</span>
                {variant === "b" && changedDates.has(i) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cz-1" aria-label="Changed for this date" />}
              </span>
              <span className={`block truncate text-3xs ${race ? "font-semibold text-cz-1" : "text-cz-3"}`}>
                {race ? <span className="inline-flex items-center gap-0.5"><FlagIcon size={10} aria-hidden="true" className="shrink-0" />{race.label}</span> : "Training"}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-label="Next day" disabled={date === DAYS - 1} onClick={() => setDate((d) => Math.min(DAYS - 1, d + 1))}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-cz border border-cz-border bg-cz-card text-cz-2 disabled:opacity-40">
        <ChevronRightIcon size={16} aria-hidden="true" />
      </button>
    </div>
  );

  if (date === 0) return <div className="space-y-3">{strip}{today}</div>;

  const d = dates[date];
  const race = raceOf(date);
  const rows = r5.riders.map((rider, idx) => {
    const plan = r5.planFor(rider.id) as Plan;
    const planDay = plan?.focus ? (dayTypeForProgram(plan) as string) : null;
    const planSession = planDay && (DAY_TYPES_WITHOUT_SESSION as readonly string[]).includes(planDay) ? planDay : (sessionForProgram(plan) as string | null);
    const weekDays = (r5.riderWeekPlans[rider.id] ?? null) as ProgramWeekDays | null;
    const raceSlots = new Set(race && idx % 3 === 0 ? race.slots : []);
    const fields = dayFields({ programSlot: (slot) => programSessionToday(weekDays, WEEKDAY_KEYS, d.weekday, slot + 1), planSession: planSession ?? null, raceSlots });
    return { rider, fields, racing: raceSlots.size > 0 };
  });
  const racing = rows.filter((r) => r.racing).length;
  const dateWord = `${SHORT[d.weekday]} ${d.day} ${d.month.slice(0, 3)}`;

  return (
    <div className="space-y-3">
      {strip}
      <div className="flex flex-wrap items-center gap-x-1 text-xs text-cz-2">
        <span className="me-1 font-semibold text-cz-1">{`${LONG[d.weekday]} ${d.day} ${d.month}`}</span>
        <span className="px-1 text-cz-3">·</span><span><span className="font-data font-semibold tabular-nums text-cz-1">{rows.length - racing}</span> training</span>
        <span className="px-1 text-cz-3">·</span><span><span className="font-data font-semibold tabular-nums text-cz-1">{racing}</span> racing</span>
        {race && race.event && <><span className="px-1 text-cz-3">·</span><span className="inline-flex items-center gap-1"><FlagIcon size={11} aria-hidden="true" />{race.event}</span></>}
      </div>
      <div className="rounded-cz border border-cz-border bg-cz-card">
        <div className={`grid items-center gap-2 border-b border-cz-border bg-cz-subtle px-3 py-2 font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3 ${phone ? "grid-cols-1" : "grid-cols-[200px_repeat(5,minmax(0,1fr))_180px]"}`}>
          <span>Rider</span>
          {!phone && [1, 2, 3, 4, 5].map((n) => <span key={n}>RD {n}</span>)}
          {!phone && <span>{variant === "b" ? `${dateWord} only` : ""}</span>}
        </div>
        {rows.map(({ rider, fields }) => {
          const key = `${date}:${rider.id}`;
          const choice = only[key] ?? null;
          const overridden = variant === "b" && choice && choice !== "program";
          const shown = overridden ? fields.map((f) => (f === "stage" ? f : choice)) : fields;
          const cells = shown.map((f, i) => (
            <span key={i} className={`flex min-h-9 items-center gap-1 truncate rounded-cz border px-2 text-xs ${f === "stage" ? "border-cz-border bg-cz-subtle text-cz-2" : "border-cz-border text-cz-1"}`}>
              {f === "stage" ? <><LockIcon size={10} aria-hidden="true" className="shrink-0" />{race?.label ?? "Race"}</> : label(f)}
            </span>
          ));
          return (
            <div key={rider.id} className={`grid items-center gap-2 border-t border-cz-border px-3 py-2 first:border-t-0 ${phone ? "grid-cols-1" : "grid-cols-[200px_repeat(5,minmax(0,1fr))_180px]"}`}>
              <span className="min-w-0 truncate text-[13px] font-medium text-cz-1">{`${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim()}</span>
              {phone ? <span className="grid grid-cols-5 gap-1">{cells}</span> : cells}
              {variant === "b" ? (
                <span className="flex flex-col gap-0.5">
                  <select value={choice ?? "program"} onChange={(e) => setOnly((prev) => ({ ...prev, [key]: e.target.value }))}
                    aria-label={`${dateWord} only for ${rider.firstname} ${rider.lastname}`}
                    className="min-h-9 rounded-cz border border-cz-border bg-cz-card px-2 text-xs text-cz-1">
                    {CHOICES.map((c) => <option key={c} value={c}>{c === "program" ? "Program" : label(c)}</option>)}
                  </select>
                  {overridden && <span className="text-3xs text-cz-2">{dateWord} only · <button type="button" className="text-cz-accent-t underline" onClick={() => setOnly((prev) => { const n = { ...prev }; delete n[key]; return n; })}>Back to plan</button></span>}
                </span>
              ) : (!phone && <span />)}
            </div>
          );
        })}
      </div>
      {variant === "a" && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-cz-2">
          <span>Days ahead show the plan. A change applies to every {LONG[d.weekday]}.</span>
          <a href="/training?tab=weekplan" className="font-medium text-cz-accent-t hover:underline">{`Edit ${LONG[d.weekday]} in Program`} <ChevronRightIcon size={11} aria-hidden="true" className="inline" /></a>
        </p>
      )}
    </div>
  );
}
