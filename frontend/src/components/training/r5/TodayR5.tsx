// #7947 · Traenings I dag-fane i R5-udgaven, bag kontakten training_page_r5 (ejer 20/11).
//
// Specifikationen er R5-skitsen (design/7947-r5-idag: R5.tsx, R5Parts.tsx, r5data.ts)
// og ejerens beslutninger paa #7947: een linje pr. rytter (navnecellen er kun navnet,
// typen sin egen kolonne), Alder som egen kolonne, Program, Form, Fatigue now (varm
// skala, #8364), Day load (ord + pil, #8354) og I dag med Rest | Easy | Medium | Hard.
// Holdlinjen er massehandlingen ("Whole team today" / "N selected today"), med Group by
// type, filtrene (alder, grupper, type) og Simple | All sessions (huskes pr. spiller).
// Telefon: eet tryk (valgknapperne i raekken), fold ud kun til detaljer.
//
// Ren praesentation oven paa sidens AEGTE data og gemme-kald: hver handling peger paa
// TrainingPage's eksisterende mutationer (samme gemme-flow, Train now, assistent,
// sessionsvaelger og rytterkort). Ingen ny backend-logik og ingen egen fetch.
//
// TASTE: hairlines, 5px radius, ingen skygger, tabular figures, stroke-ikoner, ingen
// guldknap her (sidens ene guldknap er Train now i sidehovedet).

import { Fragment, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import ButtonJs from "../../ui/Button.jsx";
import EmptyState from "../../ui/EmptyState.jsx";
import { SkeletonLines } from "../../ui/Skeleton.jsx";
import { Segmented } from "../../ui/Segmented.jsx";
import { Dropdown, MenuItem } from "../../ui/Menu.jsx";
import {
  CheckIcon, ChevronDownIcon, ChevronRightIcon, FilterIcon, LockIcon, SortIcon, StarIcon, TeamIcon,
} from "../../ui/icons/index.jsx";
import RiderBadges from "../../rider/RiderBadges.jsx";
import RiderTypeBadge from "../../rider/RiderTypeBadge.jsx";
import { Flag, RiderNameCell } from "../reportXp/ui.ts";
import { FormPlate } from "../reportXp/XpToday.tsx";
import { DayLoadCell, FatiguePlate } from "../../tactics/TacticsRiderTable.tsx";
import DailyDecision from "../DailyDecision.tsx";
import type { DecisionRow } from "../DailyDecision.tsx";
import FatigueRuleSummary from "../FatigueRuleSummary.tsx";
import { raceSlotsFor, type ForecastResponse } from "../FatigueForecastModel.ts";
import { TIRED_FATIGUE_FROM } from "../trainingOverview.ts";
import { hasOwnProgram } from "../todayRowModel.ts";
import { daysOverLimit } from "../TrainingTeamTableBModel.ts";
import { groupNameByRider, type TrainingGroup } from "../groups/trainingGroupsModel.ts";
import { programName, programSessionToday, type CatalogProgram, type ProgramWeekDays } from "../../../lib/trainingPrograms.ts";
import {
  DAY_TYPES_WITHOUT_SESSION, SKILL_SESSIONS, TRAINING_LEVELS, dayTypeForProgram, sessionForProgram, sessionI18nKey, sessionsByLevelFor,
} from "../../../lib/trainingDayTypes.js";
import { useTrainingCatalogV3 } from "../../../lib/useTrainingCatalogV3.ts";
import { WEEKDAY_KEYS, injuryBadgeMessage, injuryTimeLeft } from "../../../lib/training.js";
import DayPickerR5 from "./DayPickerR5.tsx"; // #8580
import { weekUsable, type WeekResponse } from "./dayPickerModel.ts"; // #8580
import { ageForSeason, contractExpiringBadgeKey, retirementRiskBadgeKey } from "../../../lib/riderAge.js";
import { groupRidersByType, UNTYPED_KEY } from "../../../lib/trainingRoster.js";
import { formatDate } from "../../../lib/intl.js";
import {
  AGE_FILTERS, ALL_SESSIONS_STORAGE_KEY, EFFORTS, NO_FILTERS, NO_GROUP, canResetFilters, resetFilterState, PROGRAM_CHOICE, RECOVERY_CHOICE, STAGE,
  bulkPlan, bulkPlanLevels, dayEffort, dayFields, dayLoad, effortOf, fieldEfforts, filtersActive, levelForDayEntry, matchesFilters,
  matchesOverview, nextSort, overviewCounts, planEffort, readStoredFlag, settledDayFields, settledFieldEfforts, showsInjuryRisk,
  sortR5Rows, statusKeys, teamLine, toggleAllSelection, toggleOne, trainingChoiceOf,
  writeForEffort, writeForLevel, writeForTraining, writeForTrainingAtLevel, writeStoredFlag, yourDay,
  type Effort, type EffortLevel, type Field, type Filters, type OverviewKey, type R5Row, type SettledActivity, type SettledRow, type Sort,
  type SortKey, type StatusKey, type YourDay,
} from "./todayR5Model.ts";
import EffortPickerR5, { HardRiskLine } from "./EffortPickerR5.tsx";

// Et afregnet felts traening: hviledage som deres dagtype, ellers sessionen (samme
// stige som den gamle fanes afregnede kolonne).
function settledSession(activity: SettledActivity): string | null {
  if (!activity.focus && !activity.intensity) return null;
  const day = dayTypeForProgram(activity) as string;
  return (DAY_TYPES_WITHOUT_SESSION as readonly string[]).includes(day) ? day : (sessionForProgram(activity) as string | null);
}

// Knappen er .jsx; dens props skrives her een gang (samme greb som reportXp/ui.ts).
const Button = ButtonJs as unknown as ComponentType<{ type?: "button"; variant?: string; size?: string; iconLeft?: ReactNode; onClick?: () => void; children?: ReactNode; "data-testid"?: string }>;

// --- Kontrakten med TrainingPage ---------------------------------------------------

export type R5Rider = {
  id: string;
  firstname?: string | null;
  lastname?: string | null;
  birthdate?: string | null;
  nationality_code?: string | null;
  contract_end_season?: number | null;
  primary_type?: string | null;
  secondary_type?: string | null;
  is_academy?: boolean | null;
  squad?: string | null;
};
type Condition = { form?: number | null; fatigue?: number | null; risk?: number | null } & Record<string, unknown>;
type Plan = { focus?: string | null; intensity?: string | null } | null | undefined;
type Result = { ok: boolean; error?: string } | null | undefined;

export type TodayR5Props = {
  /** #8580: den rullende uge (GET /forecast/week). null/undefined = ingen dagsvælger, fanen som før. */
  week?: WeekResponse | null;
  /** #8580: "Ret <ugedag> i Program" fra en dag frem. */
  onEditWeekday?: (weekday: string) => void;
  riders: R5Rider[];
  loading: boolean;
  phone: boolean;
  seasonYear: number | null;
  activeSeasonNumber: number | null;
  today: Date;
  todayWeekday: string;
  condition: Record<string, Condition | undefined>;
  planFor: (riderId: string) => Plan;
  /** Dagens afregnede kvittering pr. rytter (TrainingPage.todayRowByRider): et koert felt laeses herfra, ikke fra planen. */
  settledToday?: Record<string, SettledRow | undefined> | null;
  /** #8533 Codex P2: datoens forventede loebsdage, saa et afregnet felt lander paa sin plads. */
  settledGameDays?: readonly number[] | null;
  riderWeekPlans: Record<string, ProgramWeekDays | null | undefined>;
  racingToday: Record<string, { race?: string | null } | null | undefined>;
  forecast: ForecastResponse | null;
  programAssigned: Record<string, string | null | undefined> | null | undefined;
  programCatalog: CatalogProgram[];
  groups: TrainingGroup[];
  fatigueDays70: Record<string, number> | null | undefined;
  smartDefaultFocus: Record<string, string | null | undefined>;
  trainedToday: boolean;
  savingId: string | null;
  bulkApplying: boolean;
  justSaved: ReadonlySet<string>;
  planError: { riderId: string; error: string } | null;
  runError: string | null;
  decisionRows: DecisionRow[] | null;
  fatigueRules: unknown;
  assistantPanel: ReactNode;
  bulkMessage: ReactNode;
  /**
   * #7947 PR 3: er indsatsvaelgeren Let/Mellem/Haard tilladt? Kommer fra stedet der kender
   * kontakten training_effort_levels (feltet `effortLevels` i traeningssvaret). Manglende
   * felt = false = de fire knapper som foer.
   */
  effortLevels?: boolean;
  /** `effort` (easy | normal | hard) sendes kun naar vaelgeren er taendt; ellers udeladt, som i dag. */
  onPlan: (riderId: string, dayType: string, session: string | null, effort?: EffortLevel | null) => Promise<boolean>;
  onBulk: (choice: string, ids: string[], effort?: EffortLevel | null) => Promise<boolean>;
  onPickSession: (riderId: string) => void;
  onReset: (riderId: string) => Promise<Result>;
  /** Fjerner kun rytterens egen dag (aldrig hans ugeplan): traeningsvaelgerens "Program". */
  onClearPlan: (riderId: string) => Promise<boolean>;
  onOpenPlan: (riderId: string) => void;
  onOpenPrograms: () => void;
  onEditFatigueRule: () => void;
  onOpenAssistant: () => void;
  renderCard: (riderId: string, detailId: string) => ReactNode;
};

// --- Smaa byggesten -----------------------------------------------------------------

const HEAD = "font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3";
const EFFORT_TONE: Readonly<Record<Effort, string>> = {
  rest: "text-cz-3", easy: "text-cz-2", medium: "text-cz-1", hard: "font-semibold text-cz-warning",
};

function EffortWord({ effort }: { effort: Effort }) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  return <span className={EFFORT_TONE[effort]}>{tR5(`effort.${effort}`)}</span>;
}

function SavedMark() {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  return (
    <span role="status" className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-cz-success" data-testid="r5-saved">
      <CheckIcon size={12} aria-hidden="true" />{tR5("saved")}
    </span>
  );
}

type Row = R5Row & {
  rider: R5Rider;
  secondaryType: string | null;
  nation: string | null;
  status: StatusKey[];
  injuryLabel: string | null;
  daysOver70: number | null;
  plan: Plan;
  raceName: string | null;
  effective: Effort | null;
  hasOwn: boolean;
  /** Traeningsvaelgerens vaerdi: "program" eller traeningen rytterens egen dag bygger paa. */
  choice: string;
  yourDay: YourDay | null;
  /** Den indsats hvert felt koerer paa (sessionens eget niveau, eller det valgte med indsatsvaelgeren). */
  efforts: (Effort | null)[];
  /** Rytterens egen dags indsats (trykket i vaelgeren); null = ingen egen dag. */
  ownEffort: Effort | null;
  /** Skaderisikoen fra spillets tilstand (0-1), vist kun paa Haard. */
  risk: number | null;
};

// Raekkens og holdlinjens traeningsvalg, som TodayR5 holder (en traening valgt i
// raekken huskes, saa Hard efter et Easy-tryk gaar tilbage til den).
type Choices = { chosen: Record<string, string>; remember: (id: string, choice: string | null) => void };

function StatusLine({ row, compact = false }: { row: Row; compact?: boolean }) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  const pills: ReactNode[] = [];
  const badges: string[] = [];
  for (const key of row.status) {
    if (key === "injured" && row.injuryLabel) {
      pills.push(<span key={key} className="rounded-cz-pill border border-cz-danger/30 bg-cz-danger-bg px-2 py-0.5 text-3xs text-cz-danger">{row.injuryLabel}</span>);
    } else if (key === "injuryRisk") {
      pills.push(<span key={key} className="rounded-cz-pill border border-cz-warning/20 bg-cz-warning/10 px-2 py-0.5 text-3xs text-cz-warning">{t("injuryRisk")}</span>);
    } else if (key === "days70") {
      pills.push(<span key={key} className="rounded-cz-pill border border-cz-warning/20 bg-cz-warning/10 px-2 py-0.5 font-data text-3xs tabular-nums text-cz-warning">{tR5("status.days70", { n: row.daysOver70 ?? 0, from: TIRED_FATIGUE_FROM })}</span>);
    } else if (key === "retirementRisk") {
      badges.push("retireRisk");
    } else {
      badges.push(key);
    }
  }
  if (!pills.length && !badges.length) return null;
  return (
    <div className={`mt-0.5 flex flex-wrap items-center gap-1 ${compact ? "" : "ps-[22px]"}`} data-testid="r5-row-status">
      {pills}
      {badges.length > 0 && <RiderBadges badges={badges} />}
    </div>
  );
}

function NameCell({ row, wrap = false }: { row: Row; wrap?: boolean }) {
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${wrap ? "items-start" : ""}`}>
      {row.nation ? <Flag code={row.nation} className="shrink-0" /> : <span className="inline-block w-4 shrink-0" aria-hidden="true" />}
      <RiderNameCell id={row.id} firstname={row.rider.firstname ?? ""} lastname={row.rider.lastname ?? ""} wrap={wrap}
        className={`text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t ${wrap ? "leading-tight" : "truncate"}`} />
    </span>
  );
}

function TypeCell({ row }: { row: Row }) {
  return <RiderTypeBadge primaryType={row.primaryType} secondaryType={row.secondaryType} stacked />;
}

function ProgramButton({ row, r5 }: { row: Row; r5: TodayR5Props }) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  const label = row.program.kind === "none" ? tR5("program.none") : row.program.name ?? tR5("program.own");
  const locked = r5.trainedToday;
  return (
    <Dropdown
      className="w-full"
      trigger={({ open, toggle }: { open: boolean; toggle: () => void }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu"
          aria-label={tR5("program.aria", { name: row.name, program: label })}
          className={`inline-flex max-w-full items-center justify-between gap-1.5 rounded-cz border border-cz-border px-2 py-1 text-xs font-medium hover:border-cz-3 max-sm:min-h-11 w-full ${
            row.program.kind === "none" ? "text-cz-2" : "text-cz-1"}`}>
          {/* Ejer 19/11: ingen advarsel ved "No program"; at undlade et program er et aktivt valg. */}
          <span className="truncate">{label}</span>
          <ChevronDownIcon size={12} aria-hidden="true" className="shrink-0 text-cz-3" />
        </button>
      )}
    >
      {!locked && <MenuItem onClick={() => r5.onPickSession(row.id)}>{tR5("program.changeToday")}</MenuItem>}
      <MenuItem onClick={() => r5.onOpenPlan(row.id)}>{tR5("program.editPlan")}</MenuItem>
      {row.program.kind === "none" && <MenuItem onClick={r5.onOpenPrograms}>{tR5("program.choose")}</MenuItem>}
      {row.hasOwn && !locked && <MenuItem onClick={() => { void r5.onReset(row.id); }}>{tR5("program.backToTeam")}</MenuItem>}
    </Dropdown>
  );
}

function RaceCell({ row, compact = false }: { row: Row; compact?: boolean }) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  return (
    <span className={`inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs text-cz-1 ${compact ? "font-semibold" : ""}`}>
      <LockIcon size={12} aria-hidden="true" className="shrink-0 text-cz-3" />
      <span className="whitespace-nowrap font-semibold">{tR5("race")}</span>
      {!compact && row.raceName && <span className="min-w-0 truncate text-cz-2">· {row.raceName}</span>}
    </span>
  );
}

// En traenings navn i vaelgeren og i "Your day"-linjen (samme noegler som dagspanelet).
function useTrainingName() {
  const { t } = useTranslation("training");
  return (choice: string) => (choice === "rest" || choice === RECOVERY_CHOICE
    ? t(`dayPanel.dayType_${choice}`)
    : t(sessionI18nKey("dayPanel.session", choice), { defaultValue: choice }));
}

// "Training: <fokus> ▾" (ejer 20/11). Kataloget er sidens eget: samme sessioner,
// samme niveauer og samme v3-styring som den gamle fanes "Set day". Foerste valg
// "Program" er som i dag. En naturlig <select>: telefonens egen liste er den
// bedste tryk-flade, og et valg er eet tryk.
function TrainingPicker({ value, onPick, disabled, label, full = false, testId }: {
  value: string; onPick: (choice: string) => void; disabled: boolean; label: string; full?: boolean; testId: string;
}) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  const name = useTrainingName();
  const byLevel = sessionsByLevelFor({ catalogV3: useTrainingCatalogV3() }) as Record<string, readonly string[]>;
  const listed = new Set<string>([PROGRAM_CHOICE, ...(SKILL_SESSIONS as readonly string[]), ...Object.values(byLevel).flat()]);
  return (
    <label className={`relative inline-flex min-w-0 items-center gap-1 rounded-cz border border-cz-border bg-cz-card ps-2 pe-6 text-xs hover:border-cz-3 focus-within:border-cz-1 max-sm:min-h-11 ${
      full ? "w-full" : "max-w-[232px]"} ${disabled ? "opacity-50" : ""}`} data-testid={testId}>
      <span className="shrink-0 text-cz-2">{tR5("training.label")}</span>
      <select value={value} disabled={disabled} aria-label={label} onChange={(e) => onPick(e.target.value)}
        className="min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent py-1 font-medium text-cz-1 outline-hidden disabled:cursor-default">
        <option value={PROGRAM_CHOICE}>{tR5("training.program")}</option>
        {(TRAINING_LEVELS as readonly string[]).map((level) => (
          <optgroup key={level} label={`${t("dayPanel.dayType_training")} · ${t(`dayPanel.level_${level}`)}`}>
            {(byLevel[level] ?? []).map((s) => <option key={s} value={s}>{name(s)}</option>)}
          </optgroup>
        ))}
        <optgroup label={t("dayPanel.dayType_skill")}>
          {(SKILL_SESSIONS as readonly string[]).map((s) => <option key={s} value={s}>{name(s)}</option>)}
        </optgroup>
        {/* En dag vaelgeren ikke tilbyder (fx aktiv restitution fra dagspanelet) vises som den er. */}
        {!listed.has(value) && <option value={value} disabled>{name(value)}</option>}
      </select>
      <ChevronDownIcon size={12} aria-hidden="true" className="pointer-events-none absolute inset-e-2 top-1/2 -translate-y-1/2 text-cz-3" />
    </label>
  );
}

// "Your day: Sprint, Hard on all 3 sessions · Back to team program" (ejer 20/11).
function YourDayLine({ row, day, r5 }: { row: Row; day: YourDay; r5: TodayR5Props }) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  const name = useTrainingName();
  const busy = r5.savingId === row.id || r5.bulkApplying;
  const effort = row.ownEffort;
  const withEffort = day.session !== "rest" && day.session !== RECOVERY_CHOICE && effort;
  return (
    <span className="text-2xs text-cz-2" data-testid="r5-your-day">
      {tR5("source.own")}: <span className="font-medium text-cz-1">{name(day.session)}</span>
      {withEffort && <>, <EffortWord effort={effort} /></>}{" "}
      {day.count === day.free ? tR5("yourDay.onAll", { n: day.count }) : tR5("yourDay.onSome", { n: day.count, total: day.free })}
      {!r5.trainedToday && (
        <> · <button type="button" disabled={busy} onClick={() => { void r5.onClearPlan(row.id); }}
          className="font-medium text-cz-1 underline decoration-cz-border underline-offset-2 hover:decoration-cz-1 disabled:opacity-50">
          {row.program.kind === "none" ? tR5("program.backToTeam") : tR5("yourDay.backToProgram")}</button></>
      )}
    </span>
  );
}

// Hvad raekken siger under valget: hvor dagen kommer fra, og vejen tilbage.
function SourceLine({ row, r5 }: { row: Row; r5: TodayR5Props }) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  const busy = r5.savingId === row.id || r5.bulkApplying;
  if (row.yourDay) return <YourDayLine row={row} day={row.yourDay} r5={r5} />;
  if (row.program.kind !== "none") {
    return (
      <span className="whitespace-nowrap text-2xs text-cz-2">
        {row.program.kind === "own" ? tR5("program.own") : tR5(`source.${row.program.kind}`)}: {row.effective ? <EffortWord effort={row.effective} /> : tR5("source.noDay")}
      </span>
    );
  }
  const smart = r5.smartDefaultFocus[row.id];
  const smartEffort = effortOf(smart);
  return (
    <span className="whitespace-nowrap text-2xs text-cz-2">
      {tR5("source.noDay")}
      {smart && smartEffort && (
        <> · <button type="button" disabled={busy}
          onClick={() => { const w = writeForEffort(smartEffort, { storedFocus: smart, assistantFocus: smart }); if (w.kind === "write") void r5.onPlan(row.id, w.dayType, w.session); }}
          className="font-medium text-cz-1 underline decoration-cz-border underline-offset-2 hover:decoration-cz-1 disabled:opacity-50">
          {tR5("source.useAssistant", { session: t(sessionI18nKey("dayPanel.session", smart)) })}</button></>
      )}
    </span>
  );
}

// Indsatsknapperne: de fire (Rest | Easy | Medium | Hard) som foer, eller med
// training_effort_levels indsatsvaelgeren (Let | Mellem | Haard + Hvile for sig, #7947 PR 3).
function EffortControl({ levelsOn, label, scope, value, onPick, disabled, full = false, testId }: {
  levelsOn: boolean; label: string; scope: string; value: Effort | null; onPick: (effort: Effort) => void;
  disabled: boolean; full?: boolean; testId: string;
}) {
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  if (levelsOn) return <EffortPickerR5 value={value} onPick={onPick} disabled={disabled} scope={scope} full={full} testId={testId} />;
  return (
    <Segmented
      label={label}
      value={value ?? "none"}
      onChange={(v: Effort) => onPick(v)}
      options={EFFORTS.map((e) => ({ value: e, label: tR5(`effort.${e}`), disabled }))}
      className={full ? "w-full" : ""}
    />
  );
}

function QuickSelect({ row, r5, choices, full = false, tour }: { row: Row; r5: TodayR5Props; choices: Choices; full?: boolean; tour?: string }) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  const levelsOn = r5.effortLevels === true;
  const busy = r5.savingId === row.id || r5.bulkApplying;
  if (r5.trainedToday) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-cz-3">
        <CheckIcon size={12} aria-hidden="true" className="text-cz-success" />{tR5("trained")}
        {row.effective && <> · <EffortWord effort={row.effective} /></>}
      </span>
    );
  }
  // Det trykkede segment er rytterens egen dag; et program eller ingen dag staar i linjen under.
  const pressed = row.ownEffort;
  const focus = {
    storedFocus: row.plan?.focus ?? null, assistantFocus: r5.smartDefaultFocus[row.id] ?? null, chosenFocus: choices.chosen[row.id] ?? null,
  };
  const choose = (effort: Effort) => {
    if (levelsOn) {
      // Hver session maa koere paa hvert niveau: tryk skriver den valgte/gemte session paa det trykkede niveau.
      const w = writeForLevel(effort, focus);
      if (w.kind === "pick") r5.onPickSession(row.id);
      else void r5.onPlan(row.id, w.dayType, w.session, w.effort);
      return;
    }
    const w = writeForEffort(effort, focus);
    if (w.kind === "pick") r5.onPickSession(row.id);
    else void r5.onPlan(row.id, w.dayType, w.session);
  };
  // Et valg i vaelgeren gemmes straks paa traeningens egen indsats (med niveauer: paa dagens niveau); "Program" fjerner kun dagen.
  const pickTraining = (choice: string) => {
    if (levelsOn) {
      const w = writeForTrainingAtLevel(choice, row.ownEffort);
      choices.remember(row.id, w.kind === "clear" ? null : choice);
      if (w.kind === "clear") void r5.onClearPlan(row.id);
      else if (w.kind === "write") void r5.onPlan(row.id, w.dayType, w.session, w.effort);
      return;
    }
    const w = writeForTraining(choice);
    choices.remember(row.id, w.kind === "clear" ? null : choice);
    if (w.kind === "clear") void r5.onClearPlan(row.id);
    else if (w.kind === "write") void r5.onPlan(row.id, w.dayType, w.session);
  };
  const error = r5.planError?.riderId === row.id ? r5.planError.error : null;
  return (
    <div className={`flex flex-col ${full ? "items-stretch gap-1.5" : "items-start gap-1"}`} data-tour={tour}>
      {/* Telefon: vaelgeren staar over indsatsknapperne; computer: foer dem (brydes naar kolonnen er smal). */}
      <div className={full ? "flex flex-col items-stretch gap-1.5 [&_[role=group]_button]:flex-1" : "flex flex-wrap items-center gap-x-2 gap-y-1"}>
        <TrainingPicker value={row.choice} onPick={pickTraining} disabled={busy} full={full}
          label={tR5("training.aria", { name: row.name })} testId="r5-row-training" />
        <EffortControl levelsOn={levelsOn} label={tR5("quickLabel", { name: row.name })} scope={row.name} value={pressed}
          onPick={choose} disabled={busy} full={full} testId="r5-row-effort" />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <SourceLine row={row} r5={r5} />
        {/* Skaderisikoen staar kun paa Haard (ejer 20/11). */}
        {levelsOn && showsInjuryRisk(row.effective) && <HardRiskLine />}
        {r5.justSaved.has(row.id) && <SavedMark />}
      </div>
      {error && <span role="alert" className="text-3xs text-cz-danger">{t([`planActionError_${error}`, "planActionErrorGeneric"])}</span>}
    </div>
  );
}

// De fem felter (ejer punkt 7): hvad dagen faktisk traener. Et tryk aabner spillets
// sessionsvaelger, der viser hvad passet traener og om det passer til typen (afvigelse 5).
function SessionsRow({ row, r5, mobile = false }: { row: Row; r5: TodayR5Props; mobile?: boolean }) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  const locked = r5.trainedToday;
  return (
    <div className={`grid gap-2 ${mobile ? "grid-cols-1" : "grid-cols-5"}`} data-testid="r5-sessions">
      {row.fields.map((f: Field, i: number) => {
        const head = <div className="mb-0.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">{tR5("session", { n: i + 1 })}</div>;
        const wrap = (body: ReactNode) => (
          <div key={i} className={mobile ? "grid grid-cols-[76px_1fr] items-center gap-x-2" : ""}>{head}{body}</div>
        );
        if (f === STAGE) {
          return wrap(
            <span className="flex min-h-9 items-center gap-1.5 rounded-cz bg-cz-1 px-2 text-xs font-semibold text-cz-card max-sm:min-h-11">
              <LockIcon size={12} aria-hidden="true" />{row.raceName ?? tR5("race")}
            </span>,
          );
        }
        const effort = row.efforts[i];
        const name = f ? t([sessionI18nKey("dayPanel.session", f), `dayPanel.dayType_${f}`], { defaultValue: f }) : tR5("source.noDay");
        const body = (
          <>
            <span className="inline-flex min-w-0 items-center gap-1">
              {locked && <CheckIcon size={12} aria-hidden="true" className="shrink-0 text-cz-success" />}
              <span className="truncate">{name}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-2xs">
              {effort && <EffortWord effort={effort} />}
              {!locked && <ChevronDownIcon size={11} aria-hidden="true" className="text-cz-3" />}
            </span>
          </>
        );
        return wrap(locked ? (
          <span className="flex min-h-9 items-center justify-between gap-1 rounded-cz border border-cz-border bg-cz-subtle px-2 text-xs text-cz-3 max-sm:min-h-11">{body}</span>
        ) : (
          <button type="button" onClick={() => r5.onPickSession(row.id)}
            aria-label={tR5("sessionAria", { name: row.name, n: i + 1, session: name })}
            className="flex min-h-9 w-full items-center justify-between gap-1 rounded-cz border border-cz-border bg-cz-card px-2 text-start text-xs text-cz-1 hover:border-cz-3 max-sm:min-h-11">
            {body}
          </button>
        ));
      })}
    </div>
  );
}

function RiderDetails({ row, r5, mobile }: { row: Row; r5: TodayR5Props; mobile: boolean }) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  return (
    <div className="flex flex-col gap-3">
      <SessionsRow row={row} r5={r5} mobile={mobile} />
      {/* Afvigelse 3 (ejer 20/11): dage over graensen staar kun her i kortet (+ advarsel i status). */}
      {row.daysOver70 != null && (
        <p className="font-data text-2xs tabular-nums text-cz-2" data-testid="r5-days70">
          {tR5("card.days70", { n: row.daysOver70, from: TIRED_FATIGUE_FROM })}
        </p>
      )}
      {r5.renderCard(row.id, `r5-card-${row.id}`)}
    </div>
  );
}

function SortTh({ k, label, cls, sort, onSort }: { k: SortKey | null; label: string; cls: string; sort: Sort; onSort: (k: SortKey) => void }) {
  return (
    <th className={`px-3 py-2 text-start ${HEAD} ${cls}`}
      aria-sort={sort && k === sort.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      {k ? (
        <button type="button" onClick={() => onSort(k)} className="inline-flex max-w-full items-center gap-1 text-start uppercase hover:text-cz-1">
          <span className="min-w-0">{label}</span><SortIcon size={11} aria-hidden="true" className="shrink-0" />
        </button>
      ) : label}
    </th>
  );
}

function FilterMenu({ label, items, value, onPick }: { label: string; items: Array<[string, string]>; value: string; onPick: (v: string) => void }) {
  return (
    <Dropdown
      trigger={({ open, toggle }: { open: boolean; toggle: () => void }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu"
          className={`inline-flex items-center gap-0.5 font-medium hover:text-cz-accent-t max-sm:min-h-11 ${value === "all" ? "text-cz-1" : "text-cz-accent-t"}`}>
          {label}<ChevronDownIcon size={11} aria-hidden="true" className="text-cz-3" />
        </button>
      )}
    >
      {items.map(([v, l]) => <MenuItem key={v} active={v === value} onClick={() => onPick(v)}>{l}</MenuItem>)}
    </Dropdown>
  );
}

// --- Fanen ------------------------------------------------------------------------------

export default function TodayR5({ r5 }: { r5: TodayR5Props }) {
  const { t, i18n } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  const tTypes = useTranslation("riderTypes").t;
  const [sort, setSort] = useState<Sort>(null);
  const [overview, setOverview] = useState<OverviewKey | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [groupByType, setGroupByType] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  // Traeningsvaelgerne (ejer 20/11): holdlinjens valg gaelder dens knapper; raekkens huskes pr. rytter.
  const [teamTraining, setTeamTraining] = useState<string>(PROGRAM_CHOICE);
  const [skippedHard, setSkippedHard] = useState(0);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const choices: Choices = {
    chosen,
    remember: (id, choice) => setChosen((prev) => {
      const next = { ...prev };
      if (choice) next[id] = choice;
      else delete next[id];
      return next;
    }),
  };
  // Simple | All sessions huskes pr. spiller (ejer 19/11); lukket som standard.
  const [allSessions, setAllSessionsState] = useState<boolean>(() => readStoredFlag(typeof window === "undefined" ? null : window.localStorage, ALL_SESSIONS_STORAGE_KEY));
  const setAllSessions = (on: boolean) => {
    setAllSessionsState(on);
    writeStoredFlag(typeof window === "undefined" ? null : window.localStorage, ALL_SESSIONS_STORAGE_KEY, on);
  };

  const groupIdByRider = useMemo(() => {
    const out = new Map<string, string>();
    for (const g of r5.groups ?? []) for (const m of g.members ?? []) out.set(m.riderId, g.id);
    return out;
  }, [r5.groups]);
  const groupNames = useMemo(() => groupNameByRider(r5.groups ?? []), [r5.groups]);

  const levelsOn = r5.effortLevels === true; // #7947 PR 3: Let/Mellem/Haard (training_effort_levels)
  const rows: Row[] = useMemo(() => r5.riders.map((rider) => {
    const id = rider.id;
    const cond = r5.condition[id] ?? {};
    const plan = r5.planFor(id);
    const planDay = plan?.focus ? (dayTypeForProgram(plan) as string) : null;
    const planSession = planDay && (DAY_TYPES_WITHOUT_SESSION as readonly string[]).includes(planDay) ? planDay : (sessionForProgram(plan) as string | null);
    const racing = r5.racingToday[id] != null;
    const known = raceSlotsFor(r5.forecast, id);
    const raceSlots = racing && known.size === 0 ? new Set([0]) : known;
    const weekDays = r5.riderWeekPlans[id] ?? null;
    const planned = dayFields({
      programSlot: (slot) => programSessionToday(weekDays, WEEKDAY_KEYS, r5.todayWeekday, slot + 1),
      planSession: planSession ?? null,
      raceSlots,
    });
    // Codex P2 paa #8511: et allerede koert felt viser kvitteringen, ikke den redigerbare plan.
    const fields = settledDayFields(planned, r5.settledToday?.[id], settledSession, r5.settledGameDays);
    const programKey = r5.programAssigned?.[id] ?? null;
    const groupName = groupNames.get(id) ?? null;
    const program = programKey
      ? { kind: "program" as const, name: programName(r5.programCatalog.find((p) => p.key === programKey) ?? null, i18n.language) || null }
      : groupName ? { kind: "group" as const, name: groupName }
        : weekDays != null ? { kind: "own" as const, name: null } : { kind: "none" as const, name: null };
    const injury = injuryTimeLeft(cond, r5.today) as { count: number };
    const injuryMsg = injury.count > 0 ? (injuryBadgeMessage(injury, { compact: true }) as { key: string; days?: number } | null) : null;
    const daysOver70 = daysOverLimit(r5.fatigueDays70, id);
    const age = ageForSeason(rider.birthdate, r5.seasonYear) as number | null;
    const own = hasOwnProgram({ weekDays, plan });
    // Indsatsvaelgeren (#7947 PR 3): hvert felts indsats er kvitteringens, programcellens eller
    // rytterens egen dags; uden kontakten (eller uden et niveau) er den sessionens eget niveau.
    const settledEfforts = levelsOn ? settledFieldEfforts(r5.settledToday?.[id], undefined, r5.settledGameDays) : null;
    const todayEntry = weekDays?.[r5.todayWeekday] ?? null;
    const ownLevel = levelsOn ? planEffort(plan) : null;
    const efforts = fieldEfforts(fields, (slot) => {
      if (!levelsOn) return null;
      const settled = settledEfforts?.[slot] ?? null;
      if (settled) return settled;
      const fromProgram = programSessionToday(weekDays, WEEKDAY_KEYS, r5.todayWeekday, slot + 1) != null;
      return fromProgram ? levelForDayEntry(todayEntry, slot) : ownLevel;
    });
    const rowYourDay = yourDay(fields, planSession ?? null);
    return {
      id,
      name: `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim(),
      lastname: rider.lastname ?? "",
      primaryType: rider.primary_type ?? null,
      secondaryType: rider.secondary_type ?? null,
      nation: rider.nationality_code ?? null,
      age: typeof age === "number" ? age : null,
      form: typeof cond.form === "number" ? cond.form : null,
      fatigue: typeof cond.fatigue === "number" ? cond.fatigue : null,
      racing,
      raceName: r5.racingToday[id]?.race ?? null,
      program,
      groupId: groupIdByRider.get(id) ?? null,
      fields,
      ownDay: !!plan?.focus,
      hasOwn: own.any,
      plan,
      choice: trainingChoiceOf(plan),
      // Linjen under raekken: dagens egen traening paa de felter den faktisk faar
      // (et programfelt eller et loebsfelt vinder, samme stige som motoren).
      yourDay: rowYourDay,
      effective: dayEffort(fields, efforts),
      efforts,
      ownEffort: rowYourDay ? (levelsOn ? ownLevel : effortOf(rowYourDay.session)) : null,
      risk: typeof cond.risk === "number" ? cond.risk : null,
      rider,
      daysOver70,
      injuryLabel: injuryMsg ? t(injuryMsg.key, { days: injuryMsg.days }) : null,
      status: statusKeys({
        injuredCount: injury.count,
        injuryRisk: typeof cond.risk === "number" ? cond.risk : null,
        daysOver70,
        squad: rider.squad ?? null,
        isAcademy: rider.is_academy === true,
        contractExpiring: !!contractExpiringBadgeKey(rider, r5.activeSeasonNumber),
        retirementRisk: !!retirementRiskBadgeKey(rider, r5.seasonYear),
      }),
    };
  }), [r5, groupNames, groupIdByRider, i18n.language, t]);

  const counts = overviewCounts(rows, TIRED_FATIGUE_FROM);
  const filtered = rows.filter((r) => (overview ? matchesOverview(r, overview, TIRED_FATIGUE_FROM) : true) && matchesFilters(r, filters));
  const shown = sortR5Rows(filtered, sort);
  const line = teamLine(selected, shown);
  const shownIds = shown.map((r) => r.id);
  const allSelected = shownIds.length > 0 && shownIds.every((id) => selected.has(id));

  // En rytter der forsvinder fra visningen (filter), er heller ikke markeret laengere.
  const shownKey = shownIds.join("|");
  useEffect(() => {
    const keep = new Set(shownKey ? shownKey.split("|") : []);
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => keep.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [shownKey]);

  const focusOf = (id: string) => ({ storedFocus: r5.planFor(id)?.focus ?? null, assistantFocus: r5.smartDefaultFocus[id] ?? null });
  // Holdlinjen og "Set for group" bruger holdlinjens traening. En rytter uden kendt
  // haard traening faar aldrig et gaet: han bliver staaende markeret, og linjen siger
  // at en traening skal vaelges.
  const applyEffort = async (effort: Effort, ids: string[]) => {
    if (levelsOn) {
      // Indsatsvaelgeren (#7947 PR 3): hver session paa det trykkede niveau; Hvile uden fokus.
      const planned = bulkPlanLevels(effort, ids, focusOf, teamTraining);
      setSkippedHard(planned.skipped.length);
      let done = planned.calls.length > 0;
      for (const call of planned.calls) done = (await r5.onBulk(call.choice, call.ids, call.effort)) && done;
      if (done) setSelected(new Set(planned.skipped));
      return;
    }
    const { calls, skipped } = bulkPlan(effort, ids, focusOf, teamTraining);
    setSkippedHard(skipped.length);
    let ok = calls.length > 0;
    for (const call of calls) ok = (await r5.onBulk(call.choice, call.ids)) && ok;
    if (ok) setSelected(new Set(skipped));
  };
  const toggle = (id: string) => setOpen((o) => toggleOne(o, id));
  const isOpen = (id: string) => allSessions || open.has(id);
  const locked = r5.trainedToday;

  let firstQuick = true;
  const tourAnchor = () => { const f = firstQuick; firstQuick = false; return f ? "training-focus" : undefined; };

  const groups = groupByType
    ? (groupRidersByType(shown.map((r) => ({ ...r, primary_type: r.primaryType }))) as Array<{ type: string; riders: Row[] }>)
        .map((g) => ({ key: g.type, label: g.type === UNTYPED_KEY ? t("untypedGroup") : tTypes(`types.${g.type}`), rows: g.riders.map((x) => rows.find((r) => r.id === x.id) as Row) }))
    : [{ key: "all", label: "", rows: shown }];

  // --- Overblikket: EN linje; et tryk paa et tal filtrerer (ejer punkt 8) ---------
  const overviewLine = (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-cz-2" data-testid="r5-overview">
      <span className={`me-1 font-semibold text-cz-1 ${r5.phone ? "basis-full" : ""}`}>
        {tR5("overview.today", { date: formatDate(r5.today, "long") })}
      </span>
      {(["training", "racing", "tired", "noProgram"] as const).map((key, i) => (
        <span key={key} className="inline-flex items-center">
          {(!r5.phone || i > 0) && <span className="px-1 text-cz-3" aria-hidden="true">·</span>}
          <button type="button" aria-pressed={overview === key} onClick={() => setOverview(overview === key ? null : key)}
            className={`rounded-cz px-1 py-0.5 max-sm:min-h-11 ${overview === key ? "bg-cz-subtle text-cz-1 underline underline-offset-4" : "hover:text-cz-1"}`}>
            {tR5(`overview.${key}`, { n: counts[key], from: TIRED_FATIGUE_FROM })}
          </button>
        </span>
      ))}
      {overview && (
        <button type="button" onClick={() => setOverview(null)} className="ms-2 font-medium text-cz-1 underline decoration-cz-border underline-offset-2 max-sm:min-h-11">
          {t("overview.showAll")}
        </button>
      )}
    </div>
  );

  // --- Filtrene (ejer 19/11): alder, grupper, type -----------------------------------
  const typesPresent = [...new Set(rows.map((r) => r.primaryType).filter((x): x is string => !!x))];
  const filterWords = (
    <span className="inline-flex flex-wrap items-center gap-x-1 text-xs" data-testid="r5-filters">
      <FilterIcon size={13} aria-hidden="true" className="me-0.5 text-cz-3" />
      <FilterMenu label={tR5(`filter.age_${filters.age}`)} value={filters.age}
        items={AGE_FILTERS.map((a) => [a, tR5(`filter.age_${a}`)])} onPick={(v) => setFilters((f) => ({ ...f, age: v as Filters["age"] }))} />
      <span className="px-1 text-cz-3" aria-hidden="true">·</span>
      <FilterMenu label={filters.group === "all" ? tR5("filter.groupAll") : filters.group === NO_GROUP ? tR5("filter.groupNone") : (r5.groups.find((g) => g.id === filters.group)?.name ?? tR5("filter.groupAll"))}
        value={filters.group}
        items={[["all", tR5("filter.groupAll")], ...r5.groups.map((g): [string, string] => [g.id, g.name]), [NO_GROUP, tR5("filter.groupNone")]]}
        onPick={(v) => setFilters((f) => ({ ...f, group: v }))} />
      <span className="px-1 text-cz-3" aria-hidden="true">·</span>
      <FilterMenu label={filters.type === "all" ? tR5("filter.typeAll") : tTypes(`types.${filters.type}`)} value={filters.type}
        items={[["all", tR5("filter.typeAll")], ...typesPresent.map((ty): [string, string] => [ty, tTypes(`types.${ty}`)])]}
        onPick={(v) => setFilters((f) => ({ ...f, type: v }))} />
      {filtersActive(filters) && (
        <button type="button" onClick={() => setFilters(NO_FILTERS)} className="ms-1 font-medium text-cz-1 underline decoration-cz-border underline-offset-2 max-sm:min-h-11">
          {tR5("filter.clear")}
        </button>
      )}
    </span>
  );

  // --- Holdlinjen = massehandlingen (afvigelse 4: "N selected today") ---------------
  const scopeWord = line.kind === "selected" ? tR5("team.selected", { n: line.ids.length }) : tR5("team.whole");
  const teamLineNode = (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cz-border px-3 py-2 text-xs ${r5.phone ? "gap-x-2" : ""}`} data-testid="r5-team-line">
      <span className="font-semibold tabular-nums text-cz-1" data-testid="r5-team-scope">{scopeWord}</span>
      {locked ? <span className="text-cz-3">{t("oneTap.locked")}</span> : (
        <div className={r5.phone
          ? `flex basis-full flex-col items-stretch gap-1.5 ${levelsOn ? "" : "[&_[role=group]]:w-full [&_[role=group]_button]:flex-1"}`
          : "flex items-center gap-2"}>
          <TrainingPicker value={teamTraining} onPick={(v) => { setTeamTraining(v); setSkippedHard(0); }} disabled={r5.bulkApplying}
            full={r5.phone} label={tR5("training.teamAria", { scope: scopeWord })} testId="r5-team-training" />
          <EffortControl levelsOn={levelsOn} label={scopeWord} scope={scopeWord} value={null} onPick={(v) => { void applyEffort(v, line.ids); }}
            disabled={r5.bulkApplying || line.ids.length === 0} full={r5.phone} testId="r5-team-effort" />
        </div>
      )}
      {skippedHard > 0 && !locked && (
        <span role="status" className="text-cz-warning" data-testid="r5-team-skipped">{tR5("teamSkippedHard", { n: skippedHard })}</span>
      )}
      {line.kind === "selected" && (
        <button type="button" onClick={() => setSelected(new Set())} className="font-medium text-cz-1 underline decoration-cz-border underline-offset-2 max-sm:min-h-11">
          {t("today.clear")}
        </button>
      )}
      <button type="button" aria-pressed={groupByType} onClick={() => setGroupByType((g) => !g)}
        className={`rounded-cz border px-2 py-1 font-medium max-sm:min-h-11 ${groupByType ? "border-cz-1 bg-cz-subtle text-cz-1" : "border-cz-border text-cz-2 hover:text-cz-1"}`}>
        {t("groupByType")}
      </button>
      {filterWords}
      <div className={`flex items-center gap-2 ${r5.phone ? "" : "ms-auto"}`}>
        <Button type="button" variant="secondary" size="sm" iconLeft={<StarIcon size={13} aria-hidden="true" />} onClick={r5.onOpenAssistant} data-testid="r5-assistant-button">
          {t("mobile.assistantTitle")}
        </Button>
        <Segmented label={tR5("sessions.label")} value={allSessions ? "all" : "simple"} onChange={(v: string) => setAllSessions(v === "all")}
          options={[{ value: "simple", label: tR5("sessions.simple") }, { value: "all", label: tR5("sessions.all") }]} />
      </div>
      {r5.bulkMessage}
    </div>
  );

  const setForGroup = (g: (typeof groups)[number]) => !locked && (
    <span className="ms-auto inline-flex items-center gap-2">
      <span className="text-cz-2">{t("today.setForGroup")}</span>
      <EffortControl levelsOn={levelsOn} label={`${t("today.setForGroup")} ${g.label}`} scope={g.label} value={null}
        onPick={(v) => { void applyEffort(v, g.rows.filter((r) => !r.racing).map((r) => r.id)); }}
        disabled={r5.bulkApplying} testId="r5-group-effort" />
    </span>
  );

  // --- Computer: tabellen -------------------------------------------------------------
  const colCount = 10;
  const onSort = (k: SortKey) => setSort((s) => nextSort(s, k));
  const desktopTable = (
    <table className="w-full table-fixed text-xs" data-sortable data-testid="r5-table">
      <thead>
        <tr className="border-b border-cz-border">
          <th className="w-[40px] ps-3 text-start">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(toggleAllSelection(selected, shownIds))}
              aria-label={tR5("selectAll")} className="h-4 w-4 rounded-[3px] accent-cz-accent" />
          </th>
          <th className="w-[36px]"><span className="sr-only">{tR5("sessions.label")}</span></th>
          <SortTh k="rider" label={t("colRider")} cls="w-[184px]" sort={sort} onSort={onSort} />
          <SortTh k="type" label={t("colType")} cls="w-[128px]" sort={sort} onSort={onSort} />
          <SortTh k="age" label={t("colAge")} cls="w-[56px]" sort={sort} onSort={onSort} />
          <SortTh k="program" label={tR5("col.program")} cls="w-[150px]" sort={sort} onSort={onSort} />
          <SortTh k="form" label={t("form")} cls="w-[64px]" sort={sort} onSort={onSort} />
          {/* Pilen stoedte op til Day load (ejer 20/11): kolonnen er bred nok, og en lang overskrift brydes inde i sin egen celle. */}
          <SortTh k="fatigue" label={tR5("col.fatigueNow")} cls="w-[124px]" sort={sort} onSort={onSort} />
          <SortTh k="load" label={tR5("col.dayLoad")} cls="w-[124px]" sort={sort} onSort={onSort} />
          <SortTh k={null} label={tR5("col.today")} cls="" sort={sort} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <Fragment key={g.key}>
            {groupByType && (
              <tr className="border-t border-cz-border bg-cz-subtle">
                <td colSpan={colCount} className="px-3 py-1.5">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-1">{g.label}</span>
                    <span className="font-data tabular-nums text-cz-3">{t("groupCount", { n: g.rows.length })}</span>
                    {setForGroup(g)}
                  </div>
                </td>
              </tr>
            )}
            {g.rows.map((row) => {
              const o = isOpen(row.id);
              const sel = selected.has(row.id);
              const load = dayLoad(row.fields, row.efforts);
              return (
                <Fragment key={row.id}>
                  <tr className={`border-t border-cz-border first:border-t-0 ${o || sel ? "bg-cz-subtle/40" : ""}`} data-testid="r5-row">
                    <td className="ps-3">
                      <input type="checkbox" checked={sel} onChange={() => setSelected((s) => toggleOne(s, row.id))}
                        aria-label={tR5("selectRider", { name: row.name })} className="h-4 w-4 rounded-[3px] accent-cz-accent" />
                    </td>
                    <td>
                      <button type="button" onClick={() => toggle(row.id)} aria-expanded={o} aria-label={tR5("openRider", { name: row.name })}
                        className="flex h-7 w-7 items-center justify-center rounded-cz text-cz-2 hover:bg-cz-subtle hover:text-cz-1">
                        {o ? <ChevronDownIcon size={14} aria-hidden="true" /> : <ChevronRightIcon size={14} aria-hidden="true" />}
                      </button>
                    </td>
                    <td className="px-3 py-[7px]">
                      <NameCell row={row} />
                      <StatusLine row={row} />
                    </td>
                    <td className="px-3 py-[7px]"><TypeCell row={row} /></td>
                    <td className="px-3 py-[7px] font-data text-[13px] tabular-nums text-cz-1">{row.age ?? "—"}</td>
                    <td className="px-3 py-[7px]"><ProgramButton row={row} r5={r5} /></td>
                    <td className="px-3 py-[7px]"><FormPlate value={row.form} /></td>
                    <td className="px-3 py-[7px]"><FatiguePlate value={row.fatigue} /></td>
                    <td className="px-3 py-[7px]"><DayLoadCell load={load} label={(l) => tR5(`load.${l}`)} /></td>
                    <td className="px-3 py-[7px]">
                      {row.racing ? <RaceCell row={row} /> : (
                        <div className="flex items-center gap-2">
                          <QuickSelect row={row} r5={r5} choices={choices} tour={tourAnchor()} />
                        </div>
                      )}
                    </td>
                  </tr>
                  {o && (
                    <tr className="bg-cz-subtle/40">
                      <td colSpan={2} />
                      <td colSpan={colCount - 2} className="px-3 pb-3 pt-0.5"><RiderDetails row={row} r5={r5} mobile={false} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );

  // --- Telefonen: eet tryk i raekken, fold ud kun til detaljer -------------------------
  const sortKeys: SortKey[] = ["rider", "type", "age", "program", "form", "fatigue", "load"];
  const sortLabel: Record<SortKey, string> = {
    rider: t("colRider"), type: t("colType"), age: t("colAge"), program: tR5("col.program"),
    form: t("form"), fatigue: tR5("col.fatigueNow"), load: tR5("col.dayLoad"),
  };
  const mobileCols = "grid-cols-[minmax(0,1fr)_34px_44px_76px_12px] gap-1.5";
  const mobileList = (
    <div>
      <div className="flex items-center gap-2 border-b border-cz-border px-3 py-2 text-xs" data-testid="r5-mobile-tools">
        <label className="flex min-h-11 flex-1 items-center gap-1.5 text-cz-2">
          <SortIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
          <span className="sr-only">{t("mobileSort.label")}</span>
          <select value={sort?.key ?? "rider"} onChange={(e) => setSort(nextSort(null, e.target.value as SortKey))}
            className="min-h-9 flex-1 rounded-cz border border-cz-border bg-cz-card px-2 text-xs text-cz-1">
            {sortKeys.map((k) => <option key={k} value={k}>{tR5("sortBy", { col: sortLabel[k] })}</option>)}
          </select>
        </label>
        <button type="button" aria-pressed={pickMode} onClick={() => { setPickMode((p) => !p); if (pickMode) setSelected(new Set()); }}
          className={`min-h-11 rounded-cz border px-3 font-medium ${pickMode ? "border-cz-1 bg-cz-subtle text-cz-1" : "border-cz-border text-cz-2"}`}>
          {pickMode ? t("selected", { n: selected.size }) : t("mobile.selectRiders")}
        </button>
      </div>
      <div className={`grid ${mobileCols} border-b border-cz-border px-3 py-2 font-data text-3xs font-semibold uppercase leading-tight text-cz-3`}>
        <span>{t("colRider")}</span><span>{t("form")}</span><span>{t("fatigue")}</span><span>{tR5("col.dayLoad")}</span><span />
      </div>
      <ul>
        {groups.map((g) => (
          <Fragment key={g.key}>
            {groupByType && (
              <li className="flex flex-wrap items-center gap-2 border-t border-cz-border bg-cz-subtle px-3 py-1.5 text-xs">
                <span className="font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-1">{g.label}</span>
                <span className="font-data tabular-nums text-cz-3">{g.rows.length}</span>
                {!locked && (
                  <div className={`basis-full ${levelsOn ? "" : "[&_[role=group]]:w-full [&_button]:flex-1"}`}>
                    <EffortControl levelsOn={levelsOn} label={`${t("today.setForGroup")} ${g.label}`} scope={g.label} value={null}
                      onPick={(v) => { void applyEffort(v, g.rows.filter((r) => !r.racing).map((r) => r.id)); }}
                      disabled={r5.bulkApplying} full testId="r5-group-effort" />
                  </div>
                )}
              </li>
            )}
            {g.rows.map((row) => {
              const o = !pickMode && isOpen(row.id);
              const sel = selected.has(row.id);
              return (
                <li key={row.id} className={`border-t border-cz-border first:border-t-0 ${sel ? "bg-cz-subtle/60" : ""}`} data-testid="r5-row">
                  {/* #8563: knappen er en strakt flade bag indholdet, saa navnelinket (til profilen) ikke
                      ligger inde i en knap. Kun linket tager imod tryk; resten af raekken folder ud. */}
                  <div className={`relative ${o ? "bg-cz-subtle/60" : ""}`}>
                  <button type="button" onClick={() => (pickMode ? setSelected((s) => toggleOne(s, row.id)) : toggle(row.id))}
                    aria-expanded={pickMode ? undefined : o} aria-pressed={pickMode ? sel : undefined}
                    aria-label={pickMode ? row.name : tR5("openRider", { name: row.name })} data-testid="r5-row-toggle"
                    className="absolute inset-0 h-full w-full" />
                  <div className={`pointer-events-none relative grid min-h-11 ${mobileCols} items-center px-3 pt-2 text-start ${pickMode ? "" : "[&_a]:pointer-events-auto [&_a]:relative [&_a]:z-10"} ${row.racing || locked || pickMode ? "pb-2" : "pb-1"}`}>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-start gap-1">
                        {pickMode && <input type="checkbox" checked={sel} readOnly tabIndex={-1} aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none rounded-[3px] accent-cz-accent" />}
                        <NameCell row={row} wrap />
                      </span>
                      <StatusLine row={row} compact />
                    </span>
                    <span><FormPlate value={row.form} /></span>
                    <span><FatiguePlate value={row.fatigue} /></span>
                    <span>{row.racing ? <RaceCell row={row} compact /> : <span className="[&>span]:whitespace-normal [&>span]:text-2xs [&>span]:leading-tight"><DayLoadCell load={dayLoad(row.fields, row.efforts)} label={(l) => tR5(`load.${l}`)} /></span>}</span>
                    <span>{!pickMode && (o ? <ChevronDownIcon size={13} aria-hidden="true" className="text-cz-3" /> : <ChevronRightIcon size={13} aria-hidden="true" className="text-cz-3" />)}</span>
                  </div>
                  </div>
                  {/* Eet tryk som foer (ejer 20/11): valgknapperne staar i raekken. */}
                  {!row.racing && !pickMode && (
                    <div className="px-3 pb-2" data-testid="r5-onetap">
                      <QuickSelect row={row} r5={r5} choices={choices} full tour={tourAnchor()} />
                    </div>
                  )}
                  {o && (
                    <div className="flex flex-col gap-3 border-t border-cz-border bg-cz-subtle/60 px-3 pb-4 pt-3">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div><div className={`mb-1 ${HEAD}`}>{t("colType")}</div><TypeCell row={row} /></div>
                        <div><div className={`mb-1 ${HEAD}`}>{tR5("col.program")}</div><ProgramButton row={row} r5={r5} /></div>
                        <div><div className={`mb-1 ${HEAD}`}>{t("colAge")}</div><span className="font-data tabular-nums text-cz-1">{row.age ?? "—"}</span></div>
                      </div>
                      <RiderDetails row={row} r5={r5} mobile />
                    </div>
                  )}
                </li>
              );
            })}
          </Fragment>
        ))}
      </ul>
    </div>
  );

  // --- Tilstande: indlaesning, tom, filtreret tom, fejl ----------------------------------
  const body = r5.loading ? (
    <div className="p-5" data-testid="r5-loading"><SkeletonLines lines={r5.phone ? 12 : 18} /></div>
  ) : r5.riders.length === 0 ? (
    <div className="p-5"><EmptyState icon={<TeamIcon size={26} aria-hidden="true" />} title={t("noRiders")} description={null} action={null} /></div>
  ) : shown.length === 0 ? (
    <div className="p-5" data-testid="r5-empty-filtered">
      <EmptyState icon={<FilterIcon size={26} aria-hidden="true" />} title={t("overview.emptyFiltered")} description={null}
        action={canResetFilters(filters, overview) ? (
          <Button type="button" variant="secondary" size="sm" data-testid="r5-reset-filters"
            onClick={() => { const s = resetFilterState(); setFilters(s.filters); setOverview(s.overview); }}>
            {tR5("filter.reset")}
          </Button>
        ) : null} />
    </div>
  ) : r5.phone ? mobileList : desktopTable;

  const page = (
    <div className="space-y-3" data-testid="r5-today">
      {overviewLine}
      <FatigueRuleSummary data={r5.fatigueRules as never} onEdit={r5.onEditFatigueRule} />
      {/* Assistenten (hul 2): Dagens beslutning med flere forslag og "Use all", og panelet. */}
      {r5.decisionRows && !r5.loading && (
        <DailyDecision rows={r5.decisionRows} compact={r5.phone}
          onUse={(row: DecisionRow) => r5.onPlan(row.riderId, row.dayType, null)} />
      )}
      {r5.assistantPanel}
      {r5.runError && <p role="alert" className="text-sm text-cz-danger">{r5.runError}</p>}
      <div className="rounded-cz border border-cz-border bg-cz-card">
        {teamLineNode}
        {body}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link to="/help?section=dailytraining" className="text-2xs text-cz-3 underline decoration-dotted hover:text-cz-accent">
          {t("howTrainingWorksLink")}
        </Link>
        {!r5.loading && r5.riders.length > 0 && (
          <span className="font-data text-2xs tabular-nums text-cz-3">{t("groupCount", { n: shown.length })}</span>
        )}
      </div>
    </div>
  );
  // #8580: med ugen hentet (kontakten training_week_forecast) står dagsvælgeren øverst; dag 0 er fanen som før.
  if (!weekUsable(r5.week)) return page;
  return (
    <DayPickerR5 week={r5.week} riders={r5.riders} planFor={r5.planFor} riderWeekPlans={r5.riderWeekPlans}
      phone={r5.phone} onEditWeekday={r5.onEditWeekday} today={page} />
  );
}
