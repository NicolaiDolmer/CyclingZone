// #7535 · Loebslisten: kommende loeb grupperet efter uge. Ugen med dagens dato er aaben, de
// senere uger er foldet til en linje ("Uge 46 · 7 loeb · 5 mangler"). Raekken viser navn, dato,
// klasse, etapeantal, etape-stribe, advarsel om faelles loebsdage og klar-maerke.
//
// #8419 punkt 5 (ejer 26/11): 2 linjer pr. loeb. Foerste linje er navn og status, anden linje dato, klasse og
// terraen. "Deler loebsdage med ..." og formtop-maerket staar ikke laengere paa kortet (delte loebsdage ses i
// loebets hoved og som status "I [loeb]" ved rytteren; formtoppen i Formtop-fanen).
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, ChevronRightIcon, Button, EmptyState, FlagIcon } from "./primitives.ts";
import {
  groupRacesByWeek,
  raceReadiness,
  raceStartDate,
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
  types,
  selected,
  dates,
  onSelect,
  check = null,
  mark = null,
}: {
  race: SeasonRace;
  readiness: Readiness;
  types: string[];
  selected: boolean;
  dates: Map<number, string>;
  onSelect: (id: string) => void;
  /** Handlinger-menuens "Kryds loeb af i listen": et flueben foran raekken. */
  check?: { checked: boolean; onToggle: () => void } | null;
  /** "Kladde"-maerket, naar loebet er i Handlinger-kladden. */
  mark?: ReactNode;
}) {
  const { t, i18n } = useTranslation("planning");
  const { t: tr } = useTranslation("races");
  const start = raceStartDate(race, dates);
  const cls = tr(`classOption.${race.raceClass}`, { defaultValue: String(race.raceClass ?? "") });
  const row = (
    <button
      type="button"
      onClick={() => onSelect(race.id)}
      aria-pressed={selected}
      data-testid="planning-race-row"
      className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 py-2.5 pr-3.5 text-left ${
        check ? "pl-1" : "border-b border-cz-border pl-3.5 last:border-b-0"
      } ${selected ? "bg-cz-subtle" : "hover:bg-cz-subtle"}`}
    >
      <span className="min-w-0">
        {/* Linje 1: navnet (status staar til hoejre). */}
        <span className="block truncate text-[13.5px] font-medium text-cz-1">{race.name}</span>
        {/* Linje 2: dato, klasse og terraen (etape-striben; et etapeloeb viser hver etapes terraen). */}
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-cz-3" data-testid="planning-race-meta">
          <span className="shrink-0 tabular-nums">
            {[start ? formatShortDate(start, i18n.language) : null, cls || null].filter(Boolean).join(" · ")}
          </span>
          {types.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <StageStrip types={types} max={race.stages > 1 ? 7 : 1} size={12} className="min-w-0 overflow-hidden" />
            </>
          )}
          {race.stages > 1 && types.length === 0 && <span className="truncate">{t("raceList.stages", { count: race.stages })}</span>}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1 self-start">
        <ReadinessBadge readiness={readiness} />
        {mark}
      </span>
    </button>
  );
  if (!check) return row;
  return (
    <div className={`flex border-b border-cz-border last:border-b-0 ${selected ? "bg-cz-subtle" : ""}`}>
      <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer justify-center pt-3 sm:min-h-0 sm:min-w-9">
        <input
          type="checkbox"
          checked={check.checked}
          onChange={check.onToggle}
          aria-label={race.name}
          className="h-4 w-4 accent-cz-accent"
          data-testid="planning-race-check"
        />
      </label>
      {row}
    </div>
  );
}

interface RaceListProps {
  races: SeasonRace[];
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
  /** Handlinger-knappen (variant B) i hovedet. */
  headerAction?: ReactNode;
  /** "Kryds loeb af i listen": flueben foran raekkerne. */
  checks?: { checked: Set<string>; onToggle: (id: string) => void } | null;
  /** Maerke ved et loeb i Handlinger-kladden. */
  rowMark?: (raceId: string) => ReactNode;
}

export default function RaceList({
  races,
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
  headerAction = null,
  checks = null,
  rowMark,
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-cz-2 sm:min-h-0">
            <input
              type="checkbox"
              checked={showPast}
              onChange={(e) => onShowPast(e.target.checked)}
              className="accent-cz-accent"
            />
            {t("raceList.showPast")}
          </label>
          {headerAction}
        </div>
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
                <span className="flex items-center gap-1.5 font-data text-xs font-semibold text-cz-2">
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
                    onSelect={onSelect}
                    check={checks ? { checked: checks.checked.has(race.id), onToggle: () => checks.onToggle(race.id) } : null}
                    mark={rowMark?.(race.id)}
                  />
                ))}
            </section>
          );
        })
      )}
    </aside>
  );
}
