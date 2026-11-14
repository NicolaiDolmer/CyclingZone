// #7535 · Ugeoversigten (week board): ugen paa tvaers af loebsdage. Loeb der deler loebsdage
// ligger i hver sin bane, saa overlap er synligt med det samme. Hver bar viser loebets korte navn,
// etape-striben og "x/6" valgte; klik vaelger loebet. Et gitter med 7 kolonner; paa mobil scroller
// tidslinjen vandret inde i kortet (wireframet), saa navnene kan laeses uden at siden bliver bredere.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeftIcon, ChevronRightIcon, Button } from "./primitives.ts";
import { layoutWeek, raceReadiness, isoWeekNumber, addDays, gameDaysOnDate, gameDaySpan, raceDayLabelKey, type SeasonRace } from "../../lib/planningWorkbench.ts";
import { StageStrip, ReadinessMark, formatShortDate, formatDayHeader } from "./planningUi.tsx";

interface WeekBoardProps {
  races: SeasonRace[];
  dates: Map<number, string>;
  monday: string;
  counts: Map<string, number>;
  withdrawn: Set<string>;
  terrain: Map<string, string[]>;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onWeekChange: (direction: -1 | 1) => void;
  canPrev: boolean;
  canNext: boolean;
}

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
}: WeekBoardProps) {
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

      {/* Mobil: tidslinjen scroller vandret inde i kortet (som wireframet paa 375), saa et loebsnavn i
          en bar paa én dag kan laeses; siden selv bliver aldrig bredere end skaermen. Fra sm passer ugen. */}
      <div className="overflow-x-auto px-4 pb-4 pt-3" data-testid="planning-week-board-scroll">
        <div
          className="grid min-w-[44rem] gap-x-1 gap-y-1.5 sm:min-w-0"
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
              {/* Loebsdags-aksen under datoen (PLANNING_CENTER_RULES §3). */}
              {gameDaysOnDate(dates, day) && (
                <span className="block truncate tabular-nums" title={t("raceList.raceDays", { days: gameDaysOnDate(dates, day) })}>
                  {/* Smal kolonne paa mobil: kun tallene; titlen siger "Loebsdage". */}
                  <span className="sm:hidden">{gameDaysOnDate(dates, day)}</span>
                  <span className="hidden sm:inline">{t("weekBoard.raceDaysShort", { days: gameDaysOnDate(dates, day) })}</span>
                </span>
              )}
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
                title={`${race.name} · ${t(raceDayLabelKey(race), { day: gameDaySpan(race.gameDayStart, race.gameDayEnd), days: gameDaySpan(race.gameDayStart, race.gameDayEnd) })}`}
                style={{ gridColumn: `${startCol + 1} / ${endCol + 2}`, gridRow: lane + 2 }}
                className={`flex min-w-0 items-center gap-1 overflow-hidden rounded-cz border px-1 py-1.5 text-left text-xs transition-colors sm:gap-2 sm:px-2 ${
                  selected ? "border-cz-3 bg-cz-subtle" : "border-cz-border bg-cz-card hover:bg-cz-subtle"
                }`}
              >
                <span className="hidden sm:inline-flex">
                  <ReadinessMark state={readiness.state} />
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold text-cz-1">{race.name}</span>
                {/* Navnet har forrang: i en bar paa én dag fylder etape-striben navnet vaek ("V."), saa den vises
                    kun naar baren spaender over flere dage (striben staar altid i loebslisten). */}
                {endCol > startCol && (
                  <span className="hidden sm:inline-flex">
                    <StageStrip types={types} max={4} size={12} />
                  </span>
                )}
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
