// #8781 · Saeson-visningen paa den nye planlaegningsside (ejerbeslutning 26/11 punkt 11-12 paa #8419).
// Den gamle udtagelsesmatrix fra /planning (Holdudtagelse > Saeson) med fire linser:
//   Udtagelser  matrixen som i dag (racehub/SeasonMatrix.jsx, samme kladde, popover og "Gem plan")
//   Rutematch   hver rytters rutematch for alle loeb side om side; bedste pr. loeb fremhaevet uden guld
//   Form        formplanen for hele saesonen (planner/): maal, assistentens udkast, formkurven
//   Belastning  matrixen med loebsdage pr. rytter, som i dag
//
// Ingen nye endpoints: matrixen henter GET /api/races/selection/season og deler loeb og ryttere med
// Rutematch (onData); Form og saesonvaelgeren bruger Formplan-fanens board (usePlanner). Matrixen
// forbliver monteret paa tvaers af linserne, saa en ugemt kladde ikke forsvinder ved et linseskift.
// Siden (#8419) monterer komponenten under "Saeson" og giver onOpenRace.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as ui from "../ui/index.js";
import SeasonMatrixBase from "../racehub/SeasonMatrix.jsx";
import SeasonPickerBase, { neighborSeasons as neighborSeasonsBase } from "../racehub/SeasonPicker.jsx";
import I18nReadyGateBase from "../I18nReadyGate.jsx";
import { usePlanner as usePlannerBase } from "../../lib/usePlanner.js";
import {
  effectivePlannerFilter as effectivePlannerFilterBase,
  plannerDivisions as plannerDivisionsBase,
  defaultPlannerDivision as defaultPlannerDivisionBase,
  plannerBoardRaces as plannerBoardRacesBase,
} from "../planner/plannerShared.js";
import {
  plannerStatusSummary as plannerStatusSummaryBase,
  pendingSuggestionPairs as pendingSuggestionPairsBase,
  ridersWithSuggestions as ridersWithSuggestionsBase,
} from "../planner/plannerSquadModel.js";
import MasterCanvasBase from "../planner/MasterCanvas.jsx";
import MobileLanesBase from "../planner/MobileLanes.jsx";
import PlannerDrawerBase from "../planner/PlannerDrawer.jsx";
import PlannerSquadBase from "../planner/PlannerSquad.jsx";
import PlannerStatusLineBase from "../planner/PlannerStatusLine.jsx";
import PlannerAssistantCardBase from "../planner/PlannerAssistantCard.jsx";
import { formatShortDate } from "./planningUi.tsx";
import {
  SEASON_LENSES,
  buildRouteMatchGrid,
  lensShowsMatrix,
  lensUsesProblemsFilter,
  matrixLensFor,
  pendingSuggestionCount,
  readStoredLens,
  storeLens,
  activeSeasonNumber,
  viewedSeason,
  type RouteGridRace,
  type RouteGridRider,
  type SeasonLens,
  type SeasonOption,
} from "./seasonMatrixLenses.ts";

// De delte komponenter er .jsx og faar deres prop-typer udledt af default-vaerdier; samme greb som
// primitives.ts: typerne loeses op her, saa denne fil kan vaere strikt.
type AnyComponent = (props: any) => any;
const SeasonMatrix = SeasonMatrixBase as AnyComponent;
const SeasonPicker = SeasonPickerBase as AnyComponent;
const I18nReadyGate = I18nReadyGateBase as AnyComponent;
const MasterCanvas = MasterCanvasBase as AnyComponent;
const MobileLanes = MobileLanesBase as AnyComponent;
const PlannerDrawer = PlannerDrawerBase as AnyComponent;
const PlannerSquad = PlannerSquadBase as AnyComponent;
const PlannerStatusLine = PlannerStatusLineBase as AnyComponent;
const PlannerAssistantCard = PlannerAssistantCardBase as AnyComponent;
const Segmented = ui.Segmented as AnyComponent;
const Spinner = ui.Spinner as AnyComponent;
const EmptyState = ui.EmptyState as AnyComponent;
const ErrorState = ui.ErrorState as AnyComponent;
const Button = ui.Button as AnyComponent;
const Select = ui.Select as AnyComponent;
const Tooltip = ui.Tooltip as AnyComponent;
const InfoIcon = ui.InfoIcon as AnyComponent;
const AlertTriangleIcon = ui.AlertTriangleIcon as AnyComponent;
const LockIcon = ui.LockIcon as AnyComponent;
const FlagIcon = ui.FlagIcon as AnyComponent;
const GripVerticalIcon = ui.GripVerticalIcon as AnyComponent;

const usePlanner = usePlannerBase as (seasonNumber: number | null) => any;
const neighborSeasons = neighborSeasonsBase as (seasons: SeasonOption[], active: number | null) => SeasonOption[];
const effectivePlannerFilter = effectivePlannerFilterBase as (filter: string, divisionPending: boolean) => string;
const plannerDivisions = plannerDivisionsBase as (races: unknown[]) => number[];
const defaultPlannerDivision = defaultPlannerDivisionBase as (races: unknown[], opts: Record<string, unknown>) => number | null;
const plannerBoardRaces = plannerBoardRacesBase as (races: unknown[], opts: { division: number | null }) => unknown[];
const plannerStatusSummary = plannerStatusSummaryBase as (args: Record<string, unknown>) => unknown;
const pendingSuggestionPairs = pendingSuggestionPairsBase as (riders: unknown[]) => Array<{ riderId: string; raceId: string }>;
const ridersWithSuggestions = ridersWithSuggestionsBase as (riders: unknown[]) => number;

type MatrixSnapshot =
  | { state: "error" }
  | { state: "off" }
  | {
      state: "ready";
      seasonNumber: number;
      readOnly: boolean;
      races: RouteGridRace[];
      riders: RouteGridRider[];
      dayDates: Array<{ gameDay: number; date: string }>;
    };

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export default function SeasonMatrixView({ onOpenRace }: { onOpenRace?: (raceId: string) => void }) {
  const { t } = useTranslation(["races", "planner", "common"]);
  const [lens, setLens] = useState<SeasonLens>(() => readStoredLens(safeLocalStorage()));
  const [problemsOnly, setProblemsOnly] = useState(false);
  // null = den aktive saeson (backend-default), ellers et eksplicit valg fra saesonvaelgeren.
  const [seasonChoice, setSeasonChoice] = useState<number | null>(null);
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [snapshot, setSnapshot] = useState<MatrixSnapshot | undefined>(undefined);
  const planner = usePlanner(seasonChoice);

  const seasons: SeasonOption[] = planner.availableSeasons || [];
  const activeNumber = activeSeasonNumber(seasons);
  const pickerSeasons = useMemo(() => neighborSeasons(seasons, activeNumber), [seasons, activeNumber]);
  const current = viewedSeason(seasonChoice, seasons);

  function changeLens(next: SeasonLens) {
    setLens(next);
    storeLens(safeLocalStorage(), next);
  }

  function selectSeason(number: number) {
    if (matrixDirty && !window.confirm(t("matrix.leaveUnsaved"))) return;
    setSnapshot(undefined);
    setSeasonChoice(activeNumber != null && number === activeNumber ? null : number);
  }

  const onData = useCallback((next: MatrixSnapshot) => setSnapshot(next), []);
  const readOnly = snapshot?.state === "ready" && snapshot.readOnly;

  return (
    <div data-testid="season-matrix-view" data-lens={lens}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          label={t("matrix.lensLabel")}
          value={lens}
          onChange={changeLens}
          options={SEASON_LENSES.map((key) => ({ value: key, label: t(`matrix.lens.${key}`) }))}
          className="w-full sm:w-auto [&>button]:min-h-8 [&>button]:flex-1 [&>button]:px-1.5 sm:[&>button]:flex-none sm:[&>button]:px-3"
        />
        <Tooltip label={t(`matrix.lensHelp.${lens}`)}>
          <button
            type="button"
            aria-label={t("matrix.lensHelpAria")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-cz text-cz-3 hover:text-cz-1"
          >
            <InfoIcon size={14} aria-hidden="true" />
          </button>
        </Tooltip>
        {lensUsesProblemsFilter(lens) && (
          <button
            type="button"
            aria-pressed={problemsOnly}
            onClick={() => setProblemsOnly((v) => !v)}
            className={`inline-flex min-h-8 items-center gap-1 rounded-cz border px-3 text-xs font-medium transition-colors duration-150 ${
              problemsOnly ? "bg-cz-danger-bg text-cz-danger border-cz-danger/40" : "border-cz-border bg-cz-card text-cz-2 hover:text-cz-1"
            }`}
          >
            <AlertTriangleIcon size={12} aria-hidden="true" />
            {t("matrix.problemsOnly")}
          </button>
        )}
        {pickerSeasons.length > 1 && (
          <div className="sm:ms-auto">
            <SeasonPicker seasons={pickerSeasons} activeNumber={activeNumber} current={current} onSelect={selectSeason} />
          </div>
        )}
      </div>
      {readOnly && <p className="mb-3 text-xs text-cz-3">{t("seasonView.readOnlyHint")}</p>}

      {/* Matrixen er altid monteret: kladden overlever et skift til Rutematch eller Form. */}
      <div hidden={!lensShowsMatrix(lens)} data-testid="season-matrix-entries">
        <SeasonMatrix
          seasonNumber={seasonChoice ?? undefined}
          lens={matrixLensFor(lens)}
          problemsOnly={problemsOnly}
          embedded
          onOpenRace={onOpenRace}
          onDirtyChange={setMatrixDirty}
          onData={onData}
        />
      </div>

      {lens === "routeMatch" && <RouteMatchLens snapshot={snapshot} onOpenRace={onOpenRace} />}
      {lens === "form" && (
        <I18nReadyGate ns="planner">
          {/* key: et divisionsvalg foelger aldrig med over i en anden saeson (samme regel som Formplan-fanen). */}
          <FormLens key={seasonChoice ?? "active"} planner={planner} seasonChoice={seasonChoice} />
        </I18nReadyGate>
      )}
    </div>
  );
}

const NAME_COL = 148;
const RACE_COL = 64;

export function RouteMatchLens({ snapshot, onOpenRace }: { snapshot: MatrixSnapshot | undefined; onOpenRace?: (raceId: string) => void }) {
  const { t, i18n } = useTranslation("races");
  const grid = useMemo(
    () => (snapshot?.state === "ready" ? buildRouteMatchGrid(snapshot.races, snapshot.riders) : null),
    [snapshot],
  );
  const dateByDay = useMemo(
    () => new Map((snapshot?.state === "ready" ? snapshot.dayDates : []).map((d) => [d.gameDay, d.date])),
    [snapshot],
  );

  if (snapshot === undefined) return <div className="flex justify-center py-8"><Spinner size={20} /></div>;
  if (snapshot.state === "error") {
    return <ErrorState title={t("matrix.errorTitle")} description={t("seasonView.error")} />;
  }
  if (!grid || !grid.races.length) {
    return <EmptyState icon={<FlagIcon size={22} />} title={t("matrix.empty")} />;
  }

  return (
    <div data-testid="season-route-grid" className="rounded-cz border border-cz-border bg-cz-card overflow-x-auto">
      <table
        data-sort-exempt="rytter x loeb-gitter med rutematch, ikke en sorterbar liste"
        className="border-collapse"
        style={{ tableLayout: "fixed", width: `${NAME_COL + grid.races.length * RACE_COL}px` }}
      >
        <colgroup>
          <col style={{ width: NAME_COL }} />
          {grid.races.map((race) => <col key={race.id} style={{ width: RACE_COL }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky left-0 z-sticky border-b border-r border-cz-border bg-cz-subtle px-3 py-1.5 text-left align-bottom text-2xs font-medium text-cz-3">
              {t("matrix.routeGrid.rider")}
            </th>
            {grid.races.map((race) => {
              const date = race.gameDayStart != null ? dateByDay.get(race.gameDayStart) : null;
              const inactive = race.withdrawn || race.didNotStart;
              return (
                <th key={race.id} className="border-b border-l border-cz-border bg-cz-subtle p-0 align-bottom">
                  <button
                    type="button"
                    disabled={!onOpenRace}
                    onClick={() => onOpenRace?.(race.id)}
                    title={race.name}
                    aria-label={t("matrix.routeGrid.openRace", { race: race.name })}
                    className="w-full px-1.5 py-1.5 text-left hover:bg-cz-card disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className={`flex items-center gap-0.5 text-2xs font-medium ${inactive ? "text-cz-3" : "text-cz-1"}`}>
                      {inactive && <LockIcon size={9} className="shrink-0" aria-hidden="true" />}
                      <span className="truncate">{race.name}</span>
                    </span>
                    <span className="block font-data text-3xs tabular-nums text-cz-3">{date ? formatShortDate(date, i18n.language, false) : ""}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map(({ rider, cells }) => (
            <tr key={rider.id} className="group">
              <td className="sticky left-0 z-sticky border-b border-r border-cz-border bg-cz-card px-3 py-1.5 text-left group-hover:bg-cz-subtle">
                <span className="block truncate text-xs font-medium text-cz-1">{rider.name}</span>
              </td>
              {cells.map((cell, col) => {
                const race = grid.races[col];
                const inactive = race.withdrawn || race.didNotStart;
                const label = cell.score == null
                  ? t("matrix.routeGrid.noScore", { rider: rider.name, race: race.name })
                  : t(cell.best ? "matrix.routeGrid.bestAria" : "matrix.routeGrid.cellAria", { rider: rider.name, race: race.name, score: cell.score });
                return (
                  <td
                    key={cell.raceId}
                    title={label}
                    aria-label={label}
                    data-best={cell.best ? "true" : undefined}
                    className={`border-b border-l border-cz-border px-2 py-1.5 text-right font-data text-xs tabular-nums ${
                      cell.best ? "bg-cz-subtle font-semibold text-cz-1 ring-1 ring-inset ring-cz-border-strong" : "text-cz-2"
                    } ${inactive ? "opacity-50" : ""}`}
                  >
                    {cell.score ?? ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegendItem({ children }: { children: any }) {
  return <span className="flex items-center gap-1.5">{children}</span>;
}

// Formplanen for hele saesonen: samme komponenter, data og kald som Formplan-fanen
// (SeasonPlannerPage.jsx), uden dens egne faner og URL-parametre (siden ejer URL'en).
function FormLens({ planner, seasonChoice }: { planner: any; seasonChoice: number | null }) {
  const { t } = useTranslation(["planner", "races", "common"]);
  const { enabled, loading, error, season, divisionPending, expectedDivision, riders, races, maxPerRider, today, leadupDays, paybackDays, busy } = planner;
  const [filter, setFilter] = useState("mine");
  const [divisionChoice, setDivisionChoice] = useState<number | null | undefined>(undefined);
  const [selected, setSelected] = useState<{ mode: "race" | "rider"; id: string } | null>(null);
  const [toast, setToast] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  useEffect(() => {
    if (!toast) return undefined;
    const h = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(h);
  }, [toast]);

  const viewFilter = effectivePlannerFilter(filter, divisionPending);
  const defaultDivision = useMemo(
    () => defaultPlannerDivision(races || [], { divisionPending, expectedDivision }),
    [races, divisionPending, expectedDivision],
  );
  const activeDivision = divisionChoice === undefined ? defaultDivision : divisionChoice;
  const divisionOptions = useMemo(() => plannerDivisions(races || []), [races]);
  const boardRaces = useMemo(
    () => (viewFilter === "all" ? plannerBoardRaces(races || [], { division: activeDivision }) : races),
    [races, viewFilter, activeDivision],
  );
  const selectedRace = useMemo(() => (selected?.mode === "race" ? (races || []).find((r: any) => r.id === selected.id) : null), [selected, races]);
  const selectedRider = useMemo(() => (selected?.mode === "rider" ? (riders || []).find((r: any) => r.id === selected.id) : null), [selected, riders]);
  const months = t("months", { returnObjects: true });

  if (loading) return <div className="flex justify-center py-8"><Spinner size={20} /></div>;
  if (error) {
    return (
      <ErrorState
        title={t("error.title")}
        description={error === "auth" ? t("error.session") : t("error.description")}
        action={<Button size="sm" variant="secondary" onClick={() => planner.refresh()}>{t("error.retry")}</Button>}
      />
    );
  }
  if (!enabled) return <EmptyState title={t("empty.title")} description={t("empty.description")} />;
  if (seasonChoice != null && !season) {
    return <EmptyState title={t("seasonNotReady.title", { number: seasonChoice })} description={t("seasonNotReady.description")} />;
  }
  const hasRiders = (riders || []).length > 0;
  if (!hasRiders) return <EmptyState title={t("empty.title")} description={t("empty.description")} />;

  const errText = (code: string) => t(`error.${code}`, { max: maxPerRider, defaultValue: t("error.generic") });
  const runMutation = async (fn: () => Promise<any>, okText?: string) => {
    const res = await fn();
    if (!res.ok) setToast({ kind: "error", text: errText(res.error) });
    else if (okText) setToast({ kind: "ok", text: okText });
    return res;
  };
  const onCreatePeak = (riderId: string, raceId: string) => runMutation(() => planner.createPeak(riderId, raceId));
  const onRetarget = (planId: string, raceId: string) => runMutation(() => planner.retargetPeak(planId, raceId));
  const onRemovePeak = (planId: string) => runMutation(() => planner.deletePeak(planId));
  const onAccept = (planId: string, week: string, rider: any) => runMutation(
    () => planner.acceptTraining(planId, week),
    t("drawer.rider.accepted", { week: week === "build" ? t("drawer.rider.build") : t("drawer.rider.taper"), name: rider?.lastname || "" }),
  );
  const onAcceptSuggestion = (riderId: string, raceId: string) => runMutation(() => planner.acceptSuggestion(riderId, raceId));
  const onDismissSuggestion = (riderId: string) => runMutation(() => planner.dismissSuggestions(riderId), t("assistant.resetDone"));
  const onAcceptAll = async () => {
    const pairs = pendingSuggestionPairs(riders);
    if (!pairs.length) return;
    const res = await planner.createPeaksBulk(pairs);
    if (!res.ok) { setToast({ kind: "error", text: errText(res.error) }); return; }
    const skipped = (res.skipped || []).length;
    setToast({
      kind: skipped ? "error" : "ok",
      text: skipped ? t("assistant.acceptedPartial", { created: res.created, skipped }) : t("assistant.acceptedAll", { count: res.created }),
    });
  };

  const suggestionCount = pendingSuggestionCount(riders);
  const statusSummary = plannerStatusSummary({ riders, today, leadupDays });

  return (
    <div data-testid="season-form-lens">
      {(!divisionPending || (viewFilter === "all" && divisionOptions.length > 1)) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {!divisionPending && (
            <Segmented
              label={t("races:matrix.formRacesLabel")}
              value={filter}
              onChange={setFilter}
              options={["mine", "all"].map((f) => ({ value: f, label: t(`filter.${f}`) }))}
            />
          )}
          {viewFilter === "all" && divisionOptions.length > 1 && (
            <Select
              size="sm"
              value={activeDivision ?? ""}
              onChange={(e: any) => setDivisionChoice(e.target.value === "" ? null : Number(e.target.value))}
              aria-label={t("planner:expectedDivision.label")}
              className="w-48"
            >
              <option value="">{t("planner:expectedDivision.all")}</option>
              {divisionOptions.map((d) => (
                <option key={d} value={d}>
                  {divisionPending && d === expectedDivision
                    ? t("planner:expectedDivision.optionExpected", { n: d })
                    : t("planner:expectedDivision.option", { n: d })}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}

      {divisionPending && (
        <p className="mb-3 flex items-start gap-1.5 text-[13px] text-cz-2">
          <InfoIcon size={14} aria-hidden="true" className="mt-[3px] shrink-0 text-cz-3" />
          <span>{t("divisionPending.title", { number: season?.number ?? seasonChoice })}</span>
        </p>
      )}

      {toast && (
        <div className={`mb-3 rounded-cz border px-3 py-2 text-xs ${toast.kind === "error" ? "border-cz-danger/40 text-cz-danger" : "border-cz-border bg-cz-subtle text-cz-1"}`} role="status">
          {toast.text}
        </div>
      )}

      {suggestionCount > 0 && (
        <PlannerAssistantCard
          suggestionCount={suggestionCount}
          riderCount={ridersWithSuggestions(riders)}
          maxPerRider={maxPerRider}
          busy={busy}
          onAcceptAll={onAcceptAll}
        />
      )}

      <PlannerStatusLine summary={statusSummary} />

      {/* Formkurven: toppen og formhullet efter den ses paa kurven (ordet staar ikke paa fladen). */}
      <div className="mb-[14px] hidden overflow-hidden rounded-cz border border-cz-border bg-cz-card md:block">
        <div className="flex items-center justify-between gap-3 border-b border-cz-border px-4 py-2.5">
          <span className="text-[13px] font-medium text-cz-1">{t("board.title")}</span>
          <span className="flex items-center gap-1.5 text-3xs text-cz-2">
            <GripVerticalIcon size={13} className="text-cz-accent-t" aria-hidden="true" />{t("legend.drag")}
          </span>
        </div>
        <MasterCanvas
          riders={riders} races={boardRaces} today={today} leadupDays={leadupDays}
          filter={viewFilter}
          selectedRaceId={selected?.mode === "race" ? selected.id : null}
          selectedRiderId={selected?.mode === "rider" ? selected.id : null}
          onSelectRace={(id: string) => setSelected({ mode: "race", id })}
          onSelectRider={(id: string) => setSelected({ mode: "rider", id })}
          onRetarget={onRetarget}
          onCreatePeak={onCreatePeak}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-cz-border px-4 py-2.5 text-3xs text-cz-2">
          <LegendItem><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="rgb(var(--accent-t))" strokeWidth="1.5" strokeDasharray="3 2" /></svg>{t("legend.potential")}</LegendItem>
          <LegendItem><svg width="22" height="10" aria-hidden="true"><rect x="0" y="1" width="22" height="8" fill="var(--text-1)" opacity="0.16" /><line x1="0" y1="1.5" x2="22" y2="1.5" stroke="var(--text-1)" strokeWidth="1.5" /></svg>{t("legend.realized")}</LegendItem>
          <LegendItem><svg width="18" height="12" aria-hidden="true"><rect x="2" y="1" width="14" height="10" fill="var(--text-1)" opacity="0.09" /></svg>{t("legend.block")}</LegendItem>
          <LegendItem><span className="h-2 w-2 rounded-full" style={{ background: "rgb(var(--accent))", border: "1px solid rgb(var(--accent-t))" }} />{t("legend.token")}</LegendItem>
        </div>
      </div>
      <div className="mb-[14px] md:hidden">
        <MobileLanes
          riders={riders} races={boardRaces} filter={viewFilter} today={today}
          selectedRaceId={selected?.mode === "race" ? selected.id : null}
          selectedRiderId={selected?.mode === "rider" ? selected.id : null}
          onSelectRace={(id: string) => setSelected({ mode: "race", id })}
          onSelectRider={(id: string) => setSelected({ mode: "rider", id })}
        />
      </div>

      {/* Maalene: op til maxPerRider pr. rytter, assistentens udkast med acceptér og nulstil. */}
      <PlannerSquad
        riders={riders} races={races} maxPerRider={maxPerRider} months={months}
        today={today} paybackDays={paybackDays} busy={busy} divisionPending={divisionPending}
        selectedRiderId={selected?.mode === "rider" ? selected.id : null}
        onCreatePeak={onCreatePeak}
        onRetarget={onRetarget}
        onRemovePeak={onRemovePeak}
        onSelectRider={(id: string) => setSelected({ mode: "rider", id })}
        onAcceptSuggestion={onAcceptSuggestion}
        onDismissSuggestion={onDismissSuggestion}
      />

      {(selectedRace || selectedRider) && (
        <div className="mt-[14px]">
          <PlannerDrawer
            mode={selectedRace ? "race" : "rider"}
            race={selectedRace} rider={selectedRider}
            riders={riders} races={races} maxPerRider={maxPerRider} months={months} today={today}
            paybackDays={paybackDays}
            busy={busy} divisionPending={divisionPending}
            onClose={() => setSelected(null)}
            onCreatePeak={onCreatePeak}
            onRemovePeak={onRemovePeak}
            onAccept={onAccept}
            onAcceptSuggestion={onAcceptSuggestion}
            onDismissSuggestion={onDismissSuggestion}
          />
        </div>
      )}
    </div>
  );
}
