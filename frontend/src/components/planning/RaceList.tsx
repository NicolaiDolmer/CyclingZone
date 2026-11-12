// #7535 · Loebslisten: kommende loeb grupperet efter uge. Ugen med dagens dato er aaben, de
// senere uger er foldet til en linje ("Uge 46 · 7 loeb · 5 mangler"). Raekken viser navn, dato,
// klasse, etapeantal, etape-stribe, advarsel om faelles loebsdage og klar-maerke.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, ChevronRightIcon, Button, EmptyState, FlagIcon } from "./primitives.ts";
import {
  groupRacesByWeek,
  overlappingRaces,
  raceReadiness,
  raceStartDate,
  raceDayLabelKey,
  gameDaySpan,
  mondayOf,
  type RaceScope,
  type Readiness,
  type SeasonRace,
} from "../../lib/planningWorkbench.ts";
import { StageStrip, ReadinessBadge, formatShortDate } from "./planningUi.tsx";

function ScopeSwitch({ scope, onScope }: { scope: RaceScope; onScope: (scope: RaceScope) => void }) {
  const { t } = useTranslation("planning");
  const options: Array<{ value: RaceScope; label: string }> = [
    { value: "next7", label: t("raceList.scopeNext7") },
    { value: "season", label: t("raceList.scopeSeason") },
  ];
  return (
    <div role="group" aria-label={t("raceList.scopeLabel")} className="inline-flex overflow-hidden rounded-cz border border-cz-border">
      {options.map((o) => {
        const active = o.value === scope;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={active ? undefined : () => onScope(o.value)}
            className={`min-h-11 px-2.5 py-1 text-xs font-medium sm:min-h-0 ${
              active ? "bg-cz-accent/10 text-cz-accent-t" : "text-cz-3 hover:text-cz-1"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function RaceRow({
  race,
  readiness,
  overlaps,
  types,
  selected,
  dates,
  onSelect,
}: {
  race: SeasonRace;
  readiness: Readiness;
  overlaps: SeasonRace[];
  types: string[];
  selected: boolean;
  dates: Map<number, string>;
  onSelect: (id: string) => void;
}) {
  const { t, i18n } = useTranslation("planning");
  const { t: tr } = useTranslation("races");
  const start = raceStartDate(race, dates);
  const cls = tr(`classOption.${race.raceClass}`, { defaultValue: String(race.raceClass ?? "") });
  return (
    <button
      type="button"
      onClick={() => onSelect(race.id)}
      aria-pressed={selected}
      data-testid="planning-race-row"
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-cz-border px-3.5 py-2.5 text-left last:border-b-0 ${
        selected ? "bg-cz-subtle" : "hover:bg-cz-subtle"
      }`}
    >
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-medium text-cz-1">{race.name}</span>
        <span className="mt-0.5 block font-data text-2xs uppercase tracking-wide text-cz-3">
          {/* Begge akser (PLANNING_CENTER_RULES §3): kalenderdatoen og loebsdagene. */}
          {start ? `${formatShortDate(start, i18n.language)} · ` : ""}
          {t(raceDayLabelKey(race), { day: gameDaySpan(race.gameDayStart, race.gameDayEnd), days: gameDaySpan(race.gameDayStart, race.gameDayEnd) })}
          {cls ? ` · ${cls}` : ""}
          {" · "}
          {race.stages > 1 ? t("raceList.stages", { count: race.stages }) : t("raceList.oneDay")}
        </span>
        <span className="mt-1.5 block">
          <StageStrip types={types} max={10} />
        </span>
        {overlaps.length > 0 && (
          <span className="mt-1.5 flex items-start gap-1 text-2xs text-cz-warning">
            <FlagIcon size={12} className="mt-px shrink-0" aria-hidden="true" />
            <span>{t("raceList.sharesDays", { races: overlaps.map((o) => o.name).join(", ") })}</span>
          </span>
        )}
      </span>
      <span className="self-start"><ReadinessBadge readiness={readiness} /></span>
    </button>
  );
}

interface RaceListProps {
  races: SeasonRace[];
  allRaces: SeasonRace[];
  dates: Map<number, string>;
  counts: Map<string, number>;
  withdrawn: Set<string>;
  terrain: Map<string, string[]>;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  scope: RaceScope;
  onScope: (scope: RaceScope) => void;
  showPast: boolean;
  onShowPast: (value: boolean) => void;
  today: string;
}

export default function RaceList({
  races,
  allRaces,
  dates,
  counts,
  withdrawn,
  terrain,
  selectedId,
  onSelect,
  scope,
  onScope,
  showPast,
  onShowPast,
  today,
}: RaceListProps) {
  const { t } = useTranslation("planning");
  const groups = useMemo(() => groupRacesByWeek(races, dates), [races, dates]);
  const thisMonday = mondayOf(today);
  // Ugen med dagens dato er aaben; findes den ikke i listen, er den foerste uge aaben.
  const defaultOpen = groups.some((g) => g.monday === thisMonday) ? thisMonday : groups[0]?.monday;
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (monday: string) => (monday in toggled ? toggled[monday] : monday === defaultOpen);

  return (
    <aside aria-label={t("raceList.title")} data-testid="planning-race-list" className="rounded-cz border border-cz-border bg-cz-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-cz-border bg-cz-subtle px-3.5 py-2">
        <ScopeSwitch scope={scope} onScope={onScope} />
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-cz-2 sm:min-h-0">
          <input
            type="checkbox"
            checked={showPast}
            onChange={(e) => onShowPast(e.target.checked)}
            className="accent-cz-accent"
          />
          {t("raceList.showPast")}
        </label>
      </header>

      {races.length === 0 ? (
        <div className="p-3.5">
          <EmptyState
            icon={<FlagIcon size={26} aria-hidden="true" />}
            title={t("raceList.empty.title")}
            description={t("raceList.empty.description")}
            action={
              scope === "next7" ? (
                <Button variant="secondary" size="sm" onClick={() => onScope("season")}>
                  {t("raceList.empty.action")}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        groups.map((group) => {
          const open = isOpen(group.monday);
          const missing = group.races.filter((r) => raceReadiness(r, counts.get(r.id) ?? 0, withdrawn).state === "missing").length;
          return (
            <section key={group.key} aria-label={t("raceList.weekLabel", { week: group.week })}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setToggled((s) => ({ ...s, [group.monday]: !open }))}
                className="flex min-h-11 w-full items-center justify-between gap-2 border-b border-cz-border bg-cz-subtle px-3.5 py-2 text-left sm:min-h-0"
              >
                <span className="flex items-center gap-1.5 font-data text-2xs font-semibold uppercase tracking-wide text-cz-2">
                  {open ? <ChevronDownIcon size={13} aria-hidden="true" /> : <ChevronRightIcon size={13} aria-hidden="true" />}
                  {t("raceList.weekSummary", { week: group.week, count: group.races.length, missing })}
                </span>
              </button>
              {open &&
                group.races.map((race) => (
                  <RaceRow
                    key={race.id}
                    race={race}
                    dates={dates}
                    types={terrain.get(race.id) ?? []}
                    selected={race.id === selectedId}
                    readiness={raceReadiness(race, counts.get(race.id) ?? 0, withdrawn)}
                    overlaps={overlappingRaces(race, allRaces, withdrawn)}
                    onSelect={onSelect}
                  />
                ))}
            </section>
          );
        })
      )}
    </aside>
  );
}
