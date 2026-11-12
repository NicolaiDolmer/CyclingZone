// @ts-nocheck: nye komponenter (#7535) bygget paa de eksisterende JS-primitiver, hvis default-null-props checkJs-budgettet ikke kan udtrykke; logikken er i planningWorkbench.ts (strict).
// #7535 · Ugeoversigten (week board): ugen paa tvaers af loebsdage. Loeb der deler loebsdage
// ligger i hver sin bane, saa overlap er synligt med det samme. Hver bar viser loebets korte navn,
// etape-striben og "x/6" valgte; klik vaelger loebet. Et gitter med 7 kolonner skalerer ned til
// 375 px uden vandret scroll (en bar kan blive smal, navnet afkortes).
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeftIcon, ChevronRightIcon, Button } from "../ui";
import { layoutWeek, raceReadiness, isoWeekNumber, addDays } from "../../lib/planningWorkbench.ts";
import { StageStrip, ReadinessMark, formatShortDate, formatDayHeader } from "./planningUi.jsx";

export default function WeekBoard({
  races,
  dates,
  monday,
  counts,
  withdrawn,
  terrain,
  selectedId,
  onSelect,
  onWeekChange,
  canPrev,
  canNext,
}) {
  const { t, i18n } = useTranslation("planning");
  const layout = useMemo(() => layoutWeek(races, dates, monday), [races, dates, monday]);
  const week = isoWeekNumber(monday);
  const range = `${formatShortDate(monday, i18n.language, false)} - ${formatShortDate(addDays(monday, 6), i18n.language, false)}`;

  return (
    <section
      aria-label={t("weekBoard.title")}
      data-testid="planning-week-board"
      className="mb-3.5 rounded-cz border border-cz-border bg-cz-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-cz-border px-4 py-2.5">
        <h2 className="text-[15px] font-semibold text-cz-1">{t("weekBoard.title")}</h2>
        <div className="inline-flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onWeekChange(-1)}
            disabled={!canPrev}
            aria-label={t("weekBoard.prev")}
            iconLeft={<ChevronLeftIcon size={14} aria-hidden="true" />}
          />
          <b className="font-data text-xs font-semibold tabular-nums text-cz-1">
            {t("weekBoard.week", { week })} <span className="font-normal text-cz-3">{range}</span>
          </b>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onWeekChange(1)}
            disabled={!canNext}
            aria-label={t("weekBoard.next")}
            iconLeft={<ChevronRightIcon size={14} aria-hidden="true" />}
          />
        </div>
      </header>

      <div className="px-4 pb-4 pt-3">
        <div
          className="grid gap-x-1 gap-y-1.5"
          style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
        >
          {layout.days.map((day, i) => (
            <div
              key={day}
              style={{ gridColumn: i + 1, gridRow: 1 }}
              className="truncate border-s border-cz-border ps-1.5 font-data text-3xs uppercase tracking-wide text-cz-3"
            >
              <span className="block truncate">{formatDayHeader(day, i18n.language).weekday}</span>
              <span className="block truncate tabular-nums">{formatDayHeader(day, i18n.language).day}</span>
            </div>
          ))}
          {layout.bars.map(({ race, lane, startCol, endCol }) => {
            const readiness = raceReadiness(race, counts.get(race.id) ?? 0, withdrawn);
            const selected = race.id === selectedId;
            const types = terrain.get(race.id) ?? [];
            return (
              <button
                key={race.id}
                type="button"
                onClick={() => onSelect(race.id)}
                aria-pressed={selected}
                title={race.name}
                style={{ gridColumn: `${startCol + 1} / ${endCol + 2}`, gridRow: lane + 2 }}
                className={`flex min-w-0 items-center gap-2 rounded-cz border px-2 py-1.5 text-left text-xs transition-colors ${
                  selected ? "border-cz-3 bg-cz-subtle" : "border-cz-border bg-cz-card hover:bg-cz-subtle"
                }`}
              >
                <ReadinessMark state={readiness.state} />
                <span className="min-w-0 flex-1 truncate font-semibold text-cz-1">{race.name}</span>
                <StageStrip types={types} max={4} size={12} className="hidden sm:inline-flex" />
                <span
                  className={`shrink-0 font-data text-3xs font-semibold tabular-nums ${
                    readiness.state === "ready" ? "text-cz-success" : "text-cz-warning"
                  }`}
                >
                  {readiness.picked}/{readiness.target}
                </span>
              </button>
            );
          })}
        </div>
        {layout.bars.length === 0 && (
          <p className="mt-3 text-[13px] text-cz-2">{t("weekBoard.empty")}</p>
        )}
      </div>
    </section>
  );
}
