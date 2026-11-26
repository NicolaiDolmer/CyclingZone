// #8580 · Dagsvælgeren i I dag R5 (wireframe R5 Day, ejer 22/11: A). Pile + i dag og 7 dage
// frem; hver dag mærket med holdets etape, endagsløb eller træning. Dag 0 er I dag-fanen som
// før. En dag frem er en oversigt over planens fem felter pr. rytter; ændringer sker i
// Program, fordi planen gælder ugedagen (B = "kun denne dato" er #8592).
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeftIcon, ChevronRightIcon, FlagIcon, LockIcon } from "../../ui/icons/index.jsx";
import { WEEKDAY_KEYS } from "../../../lib/training.js";
import { formatDate } from "../../../lib/intl.js";
import { programSessionToday, type ProgramWeekDays } from "../../../lib/trainingPrograms.ts";
import { DAY_TYPES_WITHOUT_SESSION, dayTypeForProgram, sessionForProgram, sessionI18nKey } from "../../../lib/trainingDayTypes.js";
import { STAGE } from "./todayR5Model.ts";
import { autoRaces, dayKind, futureCounts, futureFields, pickerWindow, ownRaces, type WeekResponse } from "./dayPickerModel.ts";
import { DayOverrideAction, DayOverrideRowNote, useDayOverrideStatus } from "./DayOverrideV1.tsx"; // #8592
import { dayOverridesOf, hasDayOverrides, overrideReplaced } from "./dayOverrideModel.ts";

type Rider = { id: string; firstname?: string | null; lastname?: string | null };
type Plan = { focus?: string | null; intensity?: string | null } | null | undefined;
const HEAD = "font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3";

const dateOf = (ymd: string) => new Date(`${ymd}T12:00:00`);

export default function DayPickerR5({
  week, riders, planFor, riderWeekPlans, phone, onEditWeekday, today, groups = [], onWeekChanged,
}: {
  week: WeekResponse;
  riders: Rider[];
  planFor: (riderId: string) => Plan;
  riderWeekPlans: Record<string, ProgramWeekDays | null | undefined>;
  phone: boolean;
  onEditWeekday?: (weekday: string) => void;
  today: ReactNode;
  /** #8592: grupperne og genindlæsning efter et "Kun denne dag"-valg. */
  groups?: ReadonlyArray<{ id: string; name: string; members: ReadonlyArray<{ riderId: string }> }>;
  onWeekChanged?: () => void;
}) {
  const overrideStatus = useDayOverrideStatus(); // #8592: null = slukket, intet tegnes
  const { t, i18n } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  const [selected, setSelected] = useState(0);
  const days = week.days;
  const count = days.length;
  const visible = pickerWindow(selected, count, phone);
  const weekdayLong = useMemo(() => new Intl.DateTimeFormat(i18n.language, { weekday: "long" }), [i18n.language]);

  const chipWord = (i: number) => {
    const kind = dayKind(days[i]);
    if (kind.auto) return tR5("dayPicker.autoRace");
    if (kind.kind === "stage") return kind.stage != null ? tR5("dayPicker.stage", { n: kind.stage }) : tR5("dayPicker.stageRace");
    if (kind.kind === "oneday") return tR5("dayPicker.oneDay");
    return tR5("dayPicker.training");
  };

  const strip = (
    <div className="flex items-stretch gap-1" role="group" aria-label={tR5("dayPicker.label")} data-testid="r5-day-picker">
      <button type="button" aria-label={tR5("dayPicker.prev")} disabled={selected === 0} onClick={() => setSelected((d) => Math.max(0, d - 1))}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-cz border border-cz-border bg-cz-card text-cz-2 disabled:opacity-40">
        <ChevronLeftIcon size={16} aria-hidden="true" />
      </button>
      <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}>
        {visible.map((i) => {
          const day = days[i];
          const active = i === selected;
          const racing = dayKind(day).kind !== "training";
          const d = dateOf(day.date);
          return (
            <button key={day.date} type="button" onClick={() => setSelected(i)} aria-current={active ? "date" : undefined}
              data-testid="r5-day-picker-day"
              className={`min-h-11 min-w-0 rounded-cz border px-2 py-1.5 text-start ${active ? "border-cz-1 bg-cz-card" : "border-cz-border bg-cz-card hover:border-cz-3"}`}>
              <span className={`block truncate font-data text-xs tabular-nums ${active ? "font-semibold text-cz-1" : "text-cz-2"}`}>
                {i === 0 ? tR5("dayPicker.today") : `${t(`weekday_${day.weekday}`)} ${d.getDate()}`}
                {hasDayOverrides(day) && (
                  <span className="ms-1 inline-block h-1.5 w-1.5 rounded-full bg-cz-accent align-middle" role="img"
                    aria-label={tR5("dayOverride.dot")} data-testid="r5-day-override-dot" />
                )}
              </span>
              <span className={`block truncate text-3xs ${racing ? "font-semibold text-cz-1" : "text-cz-3"}`}>
                {racing ? <span className="inline-flex items-center gap-0.5"><FlagIcon size={10} aria-hidden="true" className="shrink-0" />{chipWord(i)}</span> : chipWord(i)}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-label={tR5("dayPicker.next")} disabled={selected === count - 1} onClick={() => setSelected((d) => Math.min(count - 1, d + 1))}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-cz border border-cz-border bg-cz-card text-cz-2 disabled:opacity-40">
        <ChevronRightIcon size={16} aria-hidden="true" />
      </button>
    </div>
  );

  if (selected === 0) return <div className="space-y-3">{strip}{today}</div>;

  const day = days[selected];
  const d = dateOf(day.date);
  const weekdayWord = weekdayLong.format(d);
  const races = ownRaces(day);
  const auto = autoRaces(day);
  const raceLabel = (() => {
    const kind = dayKind(day);
    return kind.kind === "training" ? tR5("dayPicker.training") : chipWord(selected);
  })();
  const label = (s: string | null) => (s == null ? "–" : t([sessionI18nKey("dayPanel.session", s), `dayPanel.dayType_${s}`], { defaultValue: s }));

  const overrides = dayOverridesOf(day); // #8592
  const dayLabel = `${weekdayWord} ${d.getDate()}`;
  const rows = riders.map((rider) => {
    const plan = planFor(rider.id);
    const planDay = plan?.focus ? (dayTypeForProgram(plan) as string) : null;
    const planSession = planDay && (DAY_TYPES_WITHOUT_SESSION as readonly string[]).includes(planDay) ? planDay : (sessionForProgram(plan) as string | null);
    const weekDays = riderWeekPlans[rider.id] ?? null;
    const override = overrides[rider.id]?.session ?? null;
    const fields = futureFields({
      programSlot: (slot) => override ?? programSessionToday(weekDays, WEEKDAY_KEYS, day.weekday, slot + 1),
      planSession: planSession ?? null,
      fields: day.riders?.[rider.id] ?? null,
    });
    return { rider, fields };
  });
  const counts = futureCounts(rows);
  const grid = phone ? "grid-cols-1" : "grid-cols-[200px_repeat(5,minmax(0,1fr))]";

  return (
    <div className="space-y-3" data-testid="r5-day-ahead">
      {strip}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-cz-2">
        <span className={`me-1 font-semibold text-cz-1 ${phone ? "basis-full" : ""}`}>{formatDate(d, "long")}</span>
        {day.available && auto.length === 0 && (
          <>
            <span><span className="font-data font-semibold tabular-nums text-cz-1">{counts.training}</span> {tR5("dayPicker.countTraining")}</span>
            <span className="px-1 text-cz-3" aria-hidden="true">·</span>
            <span><span className="font-data font-semibold tabular-nums text-cz-1">{counts.racing}</span> {tR5("dayPicker.countRacing")}</span>
          </>
        )}
        {races.map((race) => (
          <span key={race.raceId} className="inline-flex items-center gap-1">
            <span className="px-1 text-cz-3" aria-hidden="true">·</span><FlagIcon size={11} aria-hidden="true" />{race.name}
          </span>
        ))}
      </div>
      {auto.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-cz-2" data-testid="r5-day-ahead-auto">
          <FlagIcon size={12} aria-hidden="true" className="mt-px shrink-0" />
          <span>{tR5("dayPicker.autoNote", { races: auto.map((race) => race.name ?? "").filter(Boolean).join(", ") })}</span>
        </p>
      )}
      {!day.available ? (
        <p className="rounded-cz border border-dashed border-cz-border bg-cz-card px-4 py-6 text-center text-[13px] text-cz-2" data-testid="r5-day-ahead-unavailable">
          {tR5("dayPicker.notReady")}
        </p>
      ) : (
        <>
        {overrideStatus && (
          <div className="flex flex-wrap items-center gap-2">
            <DayOverrideAction status={overrideStatus} date={day.date} dayLabel={dayLabel} riders={riders} groups={[...groups]}
              overrides={overrides} sessionLabel={(s) => label(s)} onChanged={onWeekChanged} />
          </div>
        )}
        <div className="rounded-cz border border-cz-border bg-cz-card">
          <div className={`grid items-center gap-2 border-b border-cz-border bg-cz-subtle px-3 py-2 ${HEAD} ${grid}`}>
            <span>{tR5("dayPicker.rider")}</span>
            {!phone && [0, 1, 2, 3, 4].map((slot) => <span key={slot}>{t("mobile.raceDayShort", { n: slot + 1 })}</span>)}
          </div>
          {rows.map(({ rider, fields }) => {
            const cells = fields.map((field, slot) => (
              <span key={slot} className={`flex min-h-9 min-w-0 items-center gap-1 rounded-cz border border-cz-border px-2 text-xs ${field === STAGE ? "bg-cz-subtle text-cz-2" : "text-cz-1"}`}
                title={field === STAGE ? raceLabel : label(field)}>
                {field === STAGE
                  ? <><LockIcon size={10} aria-hidden="true" className="shrink-0" /><span className="truncate">{raceLabel}</span></>
                  : <span className="truncate">{label(field)}</span>}
              </span>
            ));
            return (
              <div key={rider.id} className={`grid items-center gap-2 border-t border-cz-border px-3 py-2 first:border-t-0 ${grid}`} data-testid="r5-day-ahead-row">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-cz-1">{`${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim()}</span>
                  {overrideStatus && overrides[rider.id] && (
                    <DayOverrideRowNote riderId={rider.id} date={day.date} dayLabel={dayLabel} weekdayWord={weekdayWord}
                      replaced={overrideReplaced(day.riders?.[rider.id])} onChanged={onWeekChanged} />
                  )}
                </span>
                {phone ? <span className="grid grid-cols-5 gap-1">{cells}</span> : cells}
              </div>
            );
          })}
        </div>
        </>
      )}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-cz-2">
        <span>{tR5("dayPicker.aheadNote", { weekday: weekdayWord })}</span>
        {onEditWeekday && (
          <button type="button" onClick={() => onEditWeekday(day.weekday)} data-testid="r5-day-ahead-edit"
            className="inline-flex min-h-11 items-center gap-0.5 font-medium text-cz-accent-t hover:underline">
            {tR5("dayPicker.editInProgram", { weekday: weekdayWord })}<ChevronRightIcon size={11} aria-hidden="true" />
          </button>
        )}
      </p>
    </div>
  );
}
