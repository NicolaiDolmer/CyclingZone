// TrainingPage — daglig træning (#1305).
//
// Viser holdets træningsprogrammer (fokus + intensitet per rytter) + dagens
// kørsel-knap (med konsistens-bonus) + rapport fra seneste kørsel.
// Rytterliste hentes fra Supabase (samme kilde som TeamPage) da det er holdets
// egne ryttere vi træner. Condition/progress/todayRun serveres fra useTraining.

import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { supabase } from "../lib/supabase";
import RiderLink from "../components/RiderLink.jsx";
import RiderTypeBadge from "../components/rider/RiderTypeBadge.jsx";
import RiderBadges from "../components/rider/RiderBadges.jsx";
import { useTraining } from "../lib/useTraining.js";
import { useTrainingHistory } from "../lib/useTrainingHistory.js";
import { useReloadBlock, RELOAD_BLOCK_REASONS } from "../lib/reloadGate.js";
import { useScouting } from "../lib/useScouting.js";
import { useActiveSeasonYear } from "../hooks/useActiveSeasonYear.js";
import { ageForSeason, retirementRiskBadgeKey, contractExpiringBadgeKey, seasonNumberFromReferenceYear } from "../lib/riderAge.js";
import { riderOverallRating } from "../lib/riderRating.js";
import { TRAINING_INTENSITIES, injuryTimeLeft, injuryBadgeMessage, WEEKDAY_KEYS, weekdayKeyForDate, resolveDayIntensityDisplay, resolveDayIntensitySource } from "../lib/training.js";
import { groupRidersByType, UNTYPED_KEY } from "../lib/trainingRoster.js";
import {
  SESSION_INTENSITY,
  dayTypeForProgram,
  sessionForProgram,
  DAY_TYPES_WITHOUT_SESSION,
  TRAINING_LEVELS,
  TRAINING_SESSIONS_BY_LEVEL,
  SKILL_SESSIONS,
} from "../lib/trainingDayTypes.js";
import { focusProgress, daySummary, breakthroughJumps, isBreakthrough, todayGainTotal, NEAR_BREAKTHROUGH, seasonAbilityGains, focusAbilityReceipt, yesterdaySummary, riderDayStories, SEASON_RECEIPT_RUNNING, SEASON_RECEIPT_NOT_STARTED, SEASON_RECEIPT_NO_DAYS, SEASON_RECEIPT_NOTE_KEY } from "../lib/trainingReport.js";
import { formatDate } from "../lib/intl.js";
import { ABILITY_SELECT, flattenAbilities } from "../lib/abilities.js";
import AbilityReceiptRow from "../components/training/AbilityReceiptRow.jsx";
import FocusPanel from "../components/training/FocusPanel.jsx";
import TrainingHistory from "../components/training/TrainingHistory.jsx";
import TrainingMoment from "../components/training/TrainingMoment.jsx";
import AssistantSuggestionsPanel from "../components/training/AssistantSuggestionsPanel.jsx";
import { buildAssistantSuggestions, countSuggestionsWithoutPlan, filterAssistantSuggestions, acceptableSuggestionIds, acceptableSelectionIds } from "../lib/assistantTrainingSuggestions.js";
import DevelopmentGlyph from "../components/development/DevelopmentGlyph.jsx";
import OnboardingTour from "../components/OnboardingTour.jsx";
import { readTour } from "../lib/onboardingTour.js";
import SortTh from "../components/rider/RiderSortTh.jsx";
import TrainingScoreSparkline from "../components/training/TrainingScoreSparkline.tsx";
import { useSortState, sortRows } from "../lib/useTableSort.js";
import {
  PageHeader, Card, Button, Select, Checkbox,
  PageLoader, EmptyState, SkeletonLines, ChevronDownIcon, TeamIcon,
  ArrowUpIcon, ArrowDownIcon, FlagIcon, StarIcon, InfoIcon, ChevronRightIcon, PlayIcon,
  Tabs, TabList, Tab, TabPanel, CollapsibleSection,
} from "../components/ui";
import { WRAP, SCROLLER, MOBILE_SCROLLER, TABLE, COUNT, thClass, tdClass, trClass } from "../components/ui/dataTableStyles.js";
import { useIsMobileViewport, useMediaQuery } from "../hooks/useMediaQuery.ts";
import { useMobileTableColumns, MobileColumnChips } from "../components/ui/MobileTableChips.jsx";
// #5485 (ejer-go 23/9): overblik oeverst, een guld-knap der skifter med
// situationen, een dagsvaelger pr. rytter og rytterens kort under raekken.
import TrainingOverview from "../components/training/TrainingOverview.tsx";
import TrainingTodayTable from "../components/training/TrainingTodayTable.tsx";
import TrainingDaySelect from "../components/training/TrainingDaySelect.tsx";
import TrainingWeekPlan from "../components/training/TrainingWeekPlan.tsx";
import TrainingMobileRiderCard from "../components/training/mobile/TrainingMobileRiderCard.tsx";
import {
  TIRED_FATIGUE_FROM, buildOverview, idsForFilter, isTired, primaryActionFor, canRunToday,
  tourRunTarget, tourRunStepKey, pruneSelection, visibleIdsFor,
} from "../components/training/trainingOverview.ts";
import { countsForRole, mobileScoreCell, pacePerWeek, scoreSortValue } from "../lib/trainingMobileModel.ts";
import { DISPLAY_RECIPES } from "../lib/generated/displayRecipes.js";
// #3643: telefonens egen visning af I dag-fanen (ejer-valg 18/9, mockup 2).
// BAG FLAG (training_mobile_table, stadie beta — ejer 19/9): kun beta-testere
// ser den; alle andre ser #5124's D-047-gren, som derfor er bevaret nedenfor.
import TrainingMobileToday from "../components/training/mobile/TrainingMobileToday.tsx";
import { buildRaceDayColumns } from "../lib/trainingMobileModel.ts";

// #3721: siden fik faner (Train today / Development / History), ?tab=-
// synkroniseret efter samme mønster som FinancePage/RiderStatsPage. Ukendt
// eller manglende param falder tilbage til "today".
// #3746 trin 7 (ejer-beslutning 20/8): "weekplan" er ny fane nr. 2 — den
// ugentlige rytme-editor flyttet ud af Train today, se TabPanel value="weekplan".
// Siden er nu 4 faner: today, weekplan, development, history.
// #5485 (ejer-go 23/9): fanerne hedder Today / Week plan / Development /
// Report — History og dagens rapport er samlet i Report. Et gammelt
// ?tab=history-link (bogmaerker, notifikationer) lander paa Report.
const TRAINING_TABS = ["today", "weekplan", "development", "report"];
const LEGACY_TAB_ALIASES = { history: "report" };

// #5485 (23/9): hvor længe en rytter hvis dag lige er gemt, bliver stående i
// et filter han ikke længere hører til ("Needs a day"), så "Saved" kan ses.
const SAVED_LINGER_MS = 2000;

// #2849 bølge 4 — migreret til T2 wide-data-skabelonen (docs/design/PAGE_TEMPLATES.md):
// PageHeader-recipe (status i subtitle, "Train today" som sidens ene gold CTA),
// max-w-[1600px]-container, PageLoader ved initial load, kanonisk Card-chrome for
// ugerytme-sektionen (#3746 trin 7: åben sektion på sin egen fane, ikke længere
// en accordion), ui/DataTable-recepten (dataTableStyles: WRAP/SCROLLER/
// thClass/tdClass/trClass) på begge tabeller. Roster-tabellen bruger dataTableStyles-
// chrome i stedet for <DataTable> direkte, fordi den har multi-select-checkbox +
// group-header-rækker + en per-rytter udvidelig ugeplan-række, som DataTable's
// 1-række-pr-row-kolonnemodel ikke understøtter.
// #3721 (ejer-godkendt design 19/8): siden er nu 3 faner i stedet for én lang
// flade — se TRAINING_TABS. Den åbne FAQ er slettet (indhold levede allerede i
// help.json). Fetches/beregninger/save-handlers/state-maskiner er UÆNDREDE
// (useTraining/useTrainingHistory rører ingen af de to omlægninger).

// Roster-tabellen sorterer på navn/type (tekst, asc-først) + form/træthed/status
// (tal, desc-først: "hvem er mest træt/i bedst form / hvem er akademi?" med ét klik).
// #3815: alder er ligeledes numerisk og følger derfor samme desc-først-konvention.
// Spørgsmålet man stiller kolonnen her er "hvem er for gammel til at investere
// hård træning i?", så ét klik skal give de ældste øverst.
// #4851: Score er numerisk og stiller spoergsmaalet "hvem fik det bedste pas"
// — ét klik skal give de hoejeste oeverst, samme desc-foerst-konvention.
const ROSTER_DESC_FIRST = new Set(["age", "form", "fatigue", "score", "status"]);

// #3706: Status-kolonnens comparator. Overskriften var et bart <th> uden
// SortTh, så et klik gjorde bogstavelig talt ingenting (@cybersimon, Discord
// 13/8). Kolonnen bærer to badges, så rangen er en vægt i stedet for en enkelt
// værdi: akademi vejer tungest (det var dét spilleren bad om at kunne samle),
// skade lægger et point oveni. Desc-først → akademi øverst med ét klik.
const STATUS_ACADEMY_WEIGHT = 2;
const STATUS_INJURED_WEIGHT = 1;

// ── #3762: dagen som label + hurtig-skift ─────────────────────────────────
// Rosteret viste før et fokusnavn i én kolonne og fire intensitets-knapper i
// den næste. Under dagstype-modellen er det ÉN ting: hvad er det for en dag.
// Kolonnen viser dagen, og knapperne skifter den.

// Hvile · Aktiv restitution · rytterens egen session. Den sidste er en sentinel,
// ikke en dagstype: hvilken dag den fører til afhænger af rytterens session.
const QUICK_DAY_TYPES = Object.freeze(["rest", "recovery", "session"]);

// #4851: praecis samme funktion som DataTable.jsx's egen `withBreakHints`
// (D-047/#5124) — kopieret lokalt i stedet for importeret, saa denne fil
// (den GAMLE, haandrullede mobil-gren, ikke DataTable) ikke traekker en
// deling ind i en delt UI-komponent for en enkelt intern hjaelpefunktion.
// "Klatrer/GC" er EET ord for browseren uden en brydningsmulighed ved "/",
// saa linjen falder ellers tilbage paa break-words og braekker midt i ordet
// ("SPRINTE/R/ROULE/UR", maalt 21/9 paa 412px). `<wbr>` er en frivillig
// brydning der hverken tegner noget eller aendrer `textContent`.
function withBreakHints(value) {
  const parts = String(value).split("/");
  if (parts.length === 1) return value;
  // Brydningen ligger EFTER skraastregen, saa "SPRINTER/" bliver staaende paa
  // den foerste linje — ikke "/ROULEUR" paa den naeste.
  return parts.flatMap((part, index) =>
    index === parts.length - 1 ? [part] : [`${part}/`, <wbr key={`wbr-${index}`} />],
  );
}

// Dagstypen rytterens gemte session hører til (skill eller training), eller
// null hvis planen ikke bærer en session (fx en restitutionsdag).
function sessionDayType(plan) {
  const session = plan?.focus ?? null;
  if (!session || !SESSION_INTENSITY[session]) return null;
  return dayTypeForProgram({ focus: session, intensity: SESSION_INTENSITY[session] });
}

// Bulk-vælgerens værdi → { dayType, session }. "smart" sendes videre som
// session, fordi assistenten vælger pr. rytter server-side (#1894).
function bulkChoiceToDay(choice) {
  if (choice === "smart") return { dayType: "training", session: "smart" };
  if (DAY_TYPES_WITHOUT_SESSION.includes(choice)) return { dayType: choice, session: null };
  return { dayType: dayTypeForProgram({ focus: choice, intensity: SESSION_INTENSITY[choice] }), session: choice };
}

// "Hvile" · "Aktiv restitution" · "Træning · Sprint" · "Færdighed · Teknik".
function dayLabel(plan, t) {
  const dayType = dayTypeForProgram(plan);
  if (DAY_TYPES_WITHOUT_SESSION.includes(dayType)) return t(`dayPanel.dayType_${dayType}`);
  const session = sessionForProgram(plan);
  if (!session) return t(`dayPanel.dayType_${dayType}`);
  return `${t(`dayPanel.dayType_${dayType}`)} · ${t(`dayPanel.session_${session}`)}`;
}


// #2819 — guidet tour på /training (aktiveres fra dashboardets "Show me how" når
// onboarding-trin 2, first_training_run, er næste trin). Samme mønster som
// AuctionsPage's getAuctionsTourSteps: bygges via t() ved render-tid så sproget
// følger brugerens locale. Ankrene sidder på første roster-række + dagens knap.
//
// #5485 (rettet 23/9): trin 2 peger på det tryk der faktisk KØRER dagens
// træning, og kun det tryk fuldfører onboarding-trinnet (en kørsel med
// executed_by = manager). Står guld-knappen på "Set days for N riders", kører
// den ingen træning, så turen peger på "Run now" og siger hvad dét tryk gør.
// Nye hold har typisk ingen dage sat, så det er den første oplevelse.
// `runTarget` kommer fra tourRunTarget og teksten fra tourRunStepKey
// (trainingOverview.ts, testet): med #4847's dayClose lover turen ingen bonus.
function getTrainingTourSteps(t, runTarget = "primary", dayCloseOn = false) {
  const runKey = tourRunStepKey(runTarget, dayCloseOn);
  return [
    {
      target: "[data-tour='training-focus']",
      title: t("tour.focus.title"),
      body: t("tour.focus.body"),
    },
    {
      target: "[data-tour='training-run-today']",
      title: t(`tour.${runKey}.title`),
      body: t(`tour.${runKey}.body`),
    },
    {
      target: "[data-tour='training-next-up']",
      title: t("tour.nextUp.title"),
      body: t("tour.nextUp.body"),
    },
  ];
}

// Stabil trin-liste pr. (sprog, anker): OnboardingTour genstarter sin rulle-
// og måle-effekt når trinnets objekt skifter, så listen må ikke bygges på ny
// ved hver render af siden.
function useTrainingTourSteps(t, runTarget, dayCloseOn) {
  return useMemo(() => getTrainingTourSteps(t, runTarget, dayCloseOn), [t, runTarget, dayCloseOn]);
}

// Bred side — samme mønster som TeamPage / RidersPage.
// (Layout WIDE_CONTENT_ROUTES håndterer kun specific paths — vi bruger inline max-w)

function MiniBar({ value, color, label }) {
  // value = 0..100
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]" title={`${label}: ${pct}`}>
      <div className="flex-1 h-1.5 bg-cz-subtle rounded-cz-pill overflow-hidden">
        <div className={`h-full rounded-cz-pill transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-3xs font-mono text-cz-3 w-6 text-right">{pct}</span>
    </div>
  );
}

// Progress mod næste +1 for en fokus-evne (anticipation). Baren bliver grøn ved
// NEAR_BREAKTHROUGH+ ("tæt på gennembrud"). info = { ability, pct } eller null (tom-tilstand).
function FocusProgress({ info, emptyLabel, tRider, toGoLabel }) {
  if (!info) {
    return <span className="text-cz-3 text-xs">{emptyLabel}</span>;
  }
  const near = info.pct >= NEAR_BREAKTHROUGH * 100;
  const abilityLabel = tRider(`racePreview.derived.${info.ability}`);
  return (
    <div className="min-w-[96px]" title={toGoLabel({ pct: 100 - info.pct, ability: abilityLabel })}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-2xs text-cz-2 truncate">{abilityLabel}</span>
        <span className={`text-3xs font-mono ${near ? "text-cz-success" : "text-cz-3"}`}>{info.pct}%</span>
      </div>
      <div className="h-1.5 bg-cz-subtle rounded-cz overflow-hidden">
        <div
          className={`h-full rounded-cz transition-all ${near ? "bg-cz-success" : "bg-cz-accent"}`}
          style={{ width: `${info.pct}%` }}
        />
      </div>
    </div>
  );
}

// #3924 trin 1 (design-go 20/8): kvalitativ tekst pr. rytter til "Yesterday's
// gains"-fold-ud'et. Ren i18n-komposition over riderDayStories' klassifikation
// (trainingReport.js) — ingen ny data, ingen lofter/rater (kun det der faktisk
// skete, eller en observerbar fremdriftsfraktion, jf. #1162 fog-gate).
function yesterdayLineText(story, t, tRider) {
  switch (story.type) {
    case "injured":
      return t("yesterdayLine.injured");
    case "point": {
      if (story.jumps.length === 1) {
        const j = story.jumps[0];
        const ability = tRider(`racePreview.derived.${j.ability}`);
        return j.from != null && j.to != null
          ? t("yesterdayLine.pointOne", { ability, from: j.from, to: j.to })
          : t("yesterdayLine.pointOnePlain", { ability });
      }
      const abilities = story.jumps.map((j) => tRider(`racePreview.derived.${j.ability}`)).join(", ");
      return t("yesterdayLine.pointMany", { abilities });
    }
    case "restFresh":
      return t("yesterdayLine.restFresh", { from: story.fatigueFrom, to: story.fatigueTo });
    case "rest":
      return t("yesterdayLine.rest", { from: story.fatigueFrom, to: story.fatigueTo });
    case "recovery":
      return t("yesterdayLine.recovery", { from: story.fatigueFrom, to: story.fatigueTo });
    case "nearBreakthrough":
      return t("yesterdayLine.nearBreakthrough", { ability: tRider(`racePreview.derived.${story.ability}`) });
    case "progressing":
      return t("yesterdayLine.progressing", { ability: tRider(`racePreview.derived.${story.ability}`) });
    case "trained":
      return t("yesterdayLine.trained");
    default:
      return t("yesterdayLine.noFocus");
  }
}

// #3721: fokus-åbne-knappen — DELT mellem roster-rækken og Development-fanens
// rækker, så de to flader bruger samme komponent/mutation (FocusPanel via
// onOpen) i stedet for at Development opfinder sin egen fokus-visning. Ren
// visning: al state (plan, busy, fejl) ejes stadig af TrainingPage.
function FocusOpenButton({ rider, plan, busy, smartFocus, error, onOpen, t, dataTour }) {
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={onOpen}
        data-tour={dataTour}
        aria-label={`${t("dayPanel.colDay")} — ${rider.firstname} ${rider.lastname}`}
        className="flex w-full max-w-[184px] items-center justify-between gap-2 rounded-cz border border-cz-border px-2.5 py-1.5 text-start transition-colors hover:border-cz-2/40 hover:bg-cz-subtle disabled:opacity-40"
      >
        {/* #5124: min-w-[40px]-gulv på labelen — uden den kan `min-w-0` (som
            truncate kræver) skrumpe teksten til 0px når roster-tabellens
            mobil-standardtilstand giver denne kolonne meget lidt plads
            (se rosterMobileColumns/max-w-[15vw] i TrainingPage.jsx). Ingen
            effekt ved normal 184px-bredde. */}
        <span className="min-w-[40px]">
          <span className={`block truncate text-[13px] ${plan?.focus ? "font-medium text-cz-1" : "text-cz-3"}`}>
            {plan?.focus ? dayLabel(plan, t) : t("dayPanel.chooseDay")}
          </span>
          {!plan?.focus && smartFocus && (
            <span className="mt-0.5 block truncate font-data text-3xs uppercase tracking-[.06em] text-cz-3">
              {t("smartFocusHint", { focus: t(`dayPanel.session_${smartFocus}`) })}
            </span>
          )}
        </span>
        <ChevronDownIcon size={13} className="shrink-0 text-cz-3" aria-hidden="true" />
      </button>
      {error && (
        <div role="alert" className="mt-0.5 text-3xs text-cz-danger">
          {t([`planActionError_${error}`, "planActionErrorGeneric"])}
        </div>
      )}
    </div>
  );
}

// #3299: mobil-sorterings-kontrol — Type/Form/Træthed-headerne er skjult i portræt
// (#3045-kolonnekontrakten, "hidden sm:table-cell"), og træthed er netop den
// kolonne spillere sorterer på for at afgøre hvem der skal have hvile (restsymptom
// efter #3194's portræt-fix). Samme mønster som RidersPage's MobileSortControl:
// select + retnings-toggle eksponerer PRÆCIS de samme sort-nøgler som desktop-
// headerne og skriver til samme rosterSort-state via handleSort — ingen ny
// sort-logik. Synlig kun under sm-breakpointet (`sm:hidden`).
//
// #5485: desktop-tabellen har kun kolonner for navn, form, træthed og score.
// Type, alder (#3815) og status (#3706) var sorterbare kolonner, men står nu i
// navnets underlinje og i rytterens kort. `inline` viser SAMME kontrol i
// tabellens værktøjslinje, så desktop kan sortere på alle nøgler uden at få
// kolonnerne tilbage.
function RosterMobileSortControl({ sort, sortDir, onSort, scoreVisible, t, inline = false }) {
  const options = [
    { key: "name", label: t("colRider") },
    { key: "primary_type", label: t("colType") },
    // #3815: alderen er sorterbar på desktop — kontrollen skal eksponere
    // PRÆCIS de samme nøgler som desktop-headerne (samme krav som #3706).
    { key: "age", label: t("colAge") },
    // #3643 (paritets-audit 21/9): Score-headeren er sorterbar på desktop, så
    // telefonen skal have samme nøgle. Kun når scoren er synlig
    // (training_score_visible) — ellers findes kolonnen ikke nogen steder, og
    // en sortering på et tal man ikke kan se ville være en skjult rækkefølge.
    ...(scoreVisible ? [{ key: "score", label: t("score.column") }] : []),
    { key: "form", label: t("form") },
    { key: "fatigue", label: t("fatigue") },
    // #3706: Status blev sorterbar — kontrollen skal blive ved med at eksponere
    // PRÆCIS de samme nøgler som desktop-headerne.
    { key: "status", label: t("colStatus") },
  ];
  const dirAria = sortDir === "desc" ? t("mobileSort.descAria") : t("mobileSort.ascAria");

  if (inline) {
    return (
      <div className="flex items-center gap-1.5">
        <label className="flex items-center gap-2">
          <span className="font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">{t("mobileSort.label")}</span>
          <Select size="sm" value={sort ?? ""} onChange={(e) => onSort(e.target.value)} className="w-32">
            {options.map(({ key, label }) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
        </label>
        <button
          type="button"
          onClick={() => sort && onSort(sort)}
          disabled={!sort}
          aria-label={dirAria}
          title={dirAria}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-cz border border-cz-border bg-cz-subtle text-cz-2 transition-colors hover:text-cz-1 disabled:opacity-40"
        >
          {sortDir === "desc"
            ? <ArrowDownIcon size={14} aria-hidden="true" />
            : <ArrowUpIcon size={14} aria-hidden="true" />}
        </button>
      </div>
    );
  }

  return (
    <div className="sm:hidden flex items-end gap-2 mb-3">
      <label className="flex-1 min-w-0">
        <span className="block text-cz-3 text-3xs uppercase tracking-wider mb-1">{t("mobileSort.label")}</span>
        <Select size="sm" value={sort ?? ""} onChange={(e) => onSort(e.target.value)} className="w-full">
          {options.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </Select>
      </label>
      <button
        type="button"
        onClick={() => sort && onSort(sort)}
        disabled={!sort}
        aria-label={dirAria}
        title={dirAria}
        // #3643: min-h-11/min-w-11 — knappen stod i 32px høj og ~40px bred og
        // var det eneste tryk-mål på mobil-fladen under #1602's 44px-krav.
        // Kravet gælder BEGGE led: et 44px højt, 40px bredt mål er stadig for
        // lille til en tommel. Kontrollen deles af BEGGE mobil-visninger (den
        // nye tabel og #5124's D-047-gren), så rettelsen gælder også når
        // training_mobile_table er off — et for lille tryk-mål er en fejl i
        // begge flader, ikke en egenskab ved den ene.
        className="flex-shrink-0 flex min-h-11 min-w-11 items-center justify-center px-3 rounded-cz border border-cz-border
          bg-cz-subtle text-cz-2 hover:text-cz-1 transition-colors disabled:opacity-40"
      >
        {sortDir === "desc"
          ? <ArrowDownIcon size={16} aria-hidden="true" />
          : <ArrowUpIcon size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}

export default function TrainingPage() {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;

  const tTypes = useTranslation("riderTypes").t;

  // #3721: tre faner, ?tab=-synkroniseret efter samme mønster som FinancePage/
  // RiderStatsPage (VALID_TABS-fallback). Kun læst ved mount for den initiale
  // fane; skift derefter styres af setTab (skriver `replace`, ingen historik-
  // spam pr. fane-klik).
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = LEGACY_TAB_ALIASES[searchParams.get("tab")] ?? searchParams.get("tab");
  const activeTab = TRAINING_TABS.includes(requestedTab) ? requestedTab : "today";
  const setTab = (tab) =>
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", tab);
      return p;
    }, { replace: true });

  // #5485: Week plan-fanens "gå til rosteret"-knap er væk (#3643/PR #5552
  // fandt den død på telefonen): rytterens egen plan redigeres nu på selve
  // fanen via "Plan for". Ref'en bærer stadig tabellen.
  const rosterTableRef = useRef(null);

  // #4522 (ejer-direktiv 31/8): "Get suggestions from the assistant"-panelet.
  // Header-knappen kan klikkes fra enhver fane, så vi skifter til "today" +
  // scroller panelet i syne — samme mønster som handleGoToRoster ovenfor,
  // fordi TabPanel unmounter inaktive faner (panelet lever kun i "today").
  const assistantPanelRef = useRef(null);
  const [assistantPanelOpen, setAssistantPanelOpen] = useState(false);
  const [assistantOnlyNoPlan, setAssistantOnlyNoPlan] = useState(false);
  const [assistantSelected, setAssistantSelected] = useState(() => new Set());
  const [assistantMsg, setAssistantMsg] = useState(null);
  const [scrollToAssistantPending, setScrollToAssistantPending] = useState(false);

  function handleOpenAssistantPanel() {
    setAssistantMsg(null);
    setAssistantPanelOpen(true);
    setScrollToAssistantPending(true);
    setTab("today");
  }
  function handleDismissAssistantPanel() {
    setAssistantPanelOpen(false);
    setAssistantSelected(new Set());
    setAssistantMsg(null);
  }
  useEffect(() => {
    if (activeTab === "today" && scrollToAssistantPending) {
      assistantPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setScrollToAssistantPending(false);
    }
  }, [activeTab, scrollToAssistantPending]);

  // #3721: Development-fanens prognose-bånd — samme kilde som spejder-fladerne
  // (POST /api/scouting/estimates via useScouting). Egne ryttere er altid et
  // bånd (isOwn i backend/lib/scouting.js), så INGEN scout-knap/slots er
  // relevante her — kun requestEstimates + estimateFor bruges.
  const { requestEstimates, estimateFor } = useScouting();
  const seasonYear = useActiveSeasonYear();
  // #3761: kontrakt-udløb sammenlignes mod sæson-NUMMERET (contract_end_season er
  // et nummer, ikke et år). seasonNumberFromReferenceYear er den eksakte inverse
  // af seasonReferenceYear, så nummeret udledes af det år vi allerede har hentet
  // til alders-visningen — ingen ekstra kald. Samme mønster som TeamPage.jsx.
  const activeSeasonNumber = seasonNumberFromReferenceYear(seasonYear);

  const training = useTraining();
  const {
    enabled, todayRun, condition, progress, capped, trainability, smartDefaultFocus, loading,
    savingId, running, bulkApplying, setPlan, setPlanBulk, clearPlan, planFor, runToday,
    weekPlan, savingWeekPlan, setWeekPlan, clearWeekPlan,
    riderWeekPlans, savingRiderWeekPlanId, setRiderWeekPlan, clearRiderWeekPlan,
    // #4851: null naar training_score_visible er off ⇒ kolonnen findes ikke.
    trainingScore,
    // #3643 (ejer 19/9): true = telefonen tegner den nye løbsdags-tabel (kun
    // beta-testere, stadie `beta`); false = den mobil-visning der står i prod
    // i dag. Serveren afgør det — se trainingMobileTableFlag.js.
    // Står FØR racingToday med vilje: #3459's guard i TrainingPage.raceDay.test.js
    // pinner at racingToday er det sidste felt før `} = training;`.
    mobileTable,
    racingToday,
    // #4847: knappens aabne-tilstand (null = flaget training_tick_per_race_day er off).
    dayClose,
  } = training;
  const scoreVisible = trainingScore != null;
  // #5485 (ejer-valg A 23/9): er dagens pas kørt? Før det har ingen rytter et
  // tal for i dag, og Score viser det SENESTE tal dæmpet (mobileScoreCell).
  const scoreSettled = !!todayRun;
  const scoreCellFor = (riderId) => mobileScoreCell(trainingScore?.[riderId] ?? null, { settled: scoreSettled });

  // #2578: dagens vundne hele point pr. rytter fra dagens kørsel — så roster-
  // rækkens progress-celle kan vise "+N i dag" når baren netop har wrappet efter
  // et gennembrud (ellers fejllæses wrappen som "ingen fremgang").
  const todayGainsByRider = useMemo(() => {
    const out = {};
    for (const row of todayRun?.report?.riders ?? []) {
      const total = todayGainTotal(row);
      if (total > 0) out[row.rider_id] = total;
    }
    return out;
  }, [todayRun]);

  // #3924 trin 2: rider_id → hele gårsdagens rapport-linje, så roster-rækkens
  // kvitteringsbar kan udlede gårsdagens bidrag (progress_before + gains pr.
  // evne). Samme todayRun som alt andet på denne side — intet nyt kald.
  const todayRowByRider = useMemo(() => {
    const out = {};
    for (const row of todayRun?.report?.riders ?? []) out[row.rider_id] = row;
    return out;
  }, [todayRun]);

  // #3924 trin 1 (design-go 20/8): "Yesterday's gains"-resuméet øverst på Train
  // today — holdniveau-tallene til den ÉNE linje + kvitteringens per-rytter-
  // historier til fold-ud'et. Samme todayRun/progress som resten af siden.
  const yesterday = todayRun?.report ? yesterdaySummary(todayRun.report.riders) : null;
  const yesterdayStories = useMemo(
    () => (todayRun?.report ? riderDayStories(todayRun.report.riders, progress) : []),
    [todayRun, progress],
  );

  // #1895 PR 1: dagens ugedag (display) + lokalt draft-state for ugerytme-panelet.
  const todayWeekday = useMemo(() => weekdayKeyForDate(new Date()), []);
  const [weekDraft, setWeekDraft] = useState(null); // null = ikke redigeret endnu (spejler weekPlan)
  const [weekPlanMsg, setWeekPlanMsg] = useState(null);
  const activeWeekDays = weekDraft ?? weekPlan;

  // #1895 PR 2: individuel ugeplan pr. rytter — udvidbar inline-flade i rosteret,
  // tænkt til de 2-3 ryttere man mikro-styrer. Kun ÉN rytter udvidet ad gangen.
  const [expandedRiderId, setExpandedRiderId] = useState(null);
  const [riderWeekDraftMap, setRiderWeekDraftMap] = useState({}); // { <rider_id>: days } — kun redigerede
  const [riderWeekMsgMap, setRiderWeekMsgMap] = useState({}); // { <rider_id>: {type,text} | null }

  // #5159 (B1): holdets ugerytme og de individuelle ugeplaner er kladder indtil
  // Gem. Et release-drevet reload kunne kassere dem uden en lyd — det tidligere
  // vaern ("er der fokus i en select?") holdt kun mens select'en HAVDE fokus.
  useReloadBlock(
    weekDraft !== null || Object.keys(riderWeekDraftMap).length > 0,
    RELOAD_BLOCK_REASONS.DIRTY,
  );
  useReloadBlock(
    Boolean(savingWeekPlan || savingRiderWeekPlanId || savingId || bulkApplying || running),
    RELOAD_BLOCK_REASONS.BUSY,
  );

  // Træningsrapport-historik (#1533): seneste 30 dages kørsler. Egen RLS-låst
  // SELECT-hook (training_day_runs), uafhængig af useTraining's /me-state.
  const history = useTrainingHistory();

  const [riders, setRiders] = useState([]);
  const [ridersLoading, setRidersLoading] = useState(true);
  const [runError, setRunError] = useState(null);

  // #2465: roster-radens Fokus-select/clear-knap/intensitet-knapper kaldte tidligere
  // setPlan/clearPlan uden await og uden at læse {ok,error} — en fejl (session,
  // netværk, backend-afvisning) var visuelt usynlig. Fælles wrapper + pr.-rytter
  // fejl-state (kun én celle relevant ad gangen pr. bruger-handling).
  const [planActionError, setPlanActionError] = useState(null); // { riderId, error } | null

  // #5485 (23/9): i filtret "Needs a day" forsvandt rækken i samme øjeblik
  // dagen blev gemt, så kvitteringen "Saved" aldrig kunne ses. En rytter hvis
  // dag LIGE er gemt, bliver derfor stående i tabellen ca. 2 sekunder med
  // "Saved" (visibleIdsFor). Kun synlighed: markeringen og "Apply to N"
  // følger stadig filtret alene (pruneSelection).
  const [lingerIds, setLingerIds] = useState(() => new Set());
  const lingerTimers = useRef(new Map());
  useEffect(() => {
    const timers = lingerTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);
  function lingerAfterSave(riderId) {
    setLingerIds((prev) => new Set(prev).add(riderId));
    const timers = lingerTimers.current;
    if (timers.has(riderId)) clearTimeout(timers.get(riderId));
    timers.set(riderId, setTimeout(() => {
      timers.delete(riderId);
      setLingerIds((prev) => {
        const next = new Set(prev);
        next.delete(riderId);
        return next;
      });
    }, SAVED_LINGER_MS));
  }

  async function handlePlanChange(riderId, dayType, session = null) {
    setPlanActionError(null);
    const result = await setPlan(riderId, dayType, session);
    if (result && !result.ok) {
      setPlanActionError({ riderId, error: result.error || "failed" });
      return false;
    }
    lingerAfterSave(riderId);
    return true;
  }
  async function handleClearPlan(riderId) {
    setPlanActionError(null);
    const result = await clearPlan(riderId);
    if (result && !result.ok) {
      setPlanActionError({ riderId, error: result.error || "failed" });
      return false;
    }
    return true;
  }

  // #3721: fokus-panelet — hvilken rytters panel er åbent (null = ingen). Kun
  // ÉT ad gangen; panelet ejer intet state der overlever lukning.
  const [focusPanelRiderId, setFocusPanelRiderId] = useState(null);
  const focusPanelRider = focusPanelRiderId ? riders.find((r) => r.id === focusPanelRiderId) ?? null : null;

  // #3643: den rytter der har sit fulde kort foldet ud i mobil-tabellen. Kun
  // mobil-visningen læser den; desktop-fladen kender den ikke. `null` fra start
  // (ejer 21/9): ingen rytter er foldet ud ved indlæsning.
  const [mobileRiderId, setMobileRiderId] = useState(null);
  // #5620/#5485: telefonens markerings-tilstand (hurtig hvile). Markeringen selv
  // er den samme `selected` som desktoppens afkrydsning.
  const [mobilePickMode, setMobilePickMode] = useState(false);

  // #2819: kørte onboarding-touren da siden blev mountet? Tourens tredje trin
  // peger på fremgangen pr. evne, som på telefonen kun findes i rytterens kort,
  // så mobil-visningen folder den øverste rytter ud ÉN gang når det er tilfældet
  // — ellers ville trinnet pege på en flade der ikke er der. Læses én gang ved
  // mount, præcis som OnboardingTour selv gør det.
  const [tourActiveAtMount] = useState(() => readTour()?.page === "training");

  async function handleFocusPanelSave(dayType, session) {
    if (await handlePlanChange(focusPanelRiderId, dayType, session)) setFocusPanelRiderId(null);
  }

  // #3762: hurtig-skift af DAGEN direkte fra rosteret. Hvile og aktiv
  // restitution kan vælges uden et trin 2, og rytterens hidtidige session
  // bevares i kolonnen (serveren gør det), så vejen tilbage er ét klik.
  // Kender vi ikke hans session (fx en rytter der står på restitution), åbner
  // vi panelet i stedet for at gætte en for ham.
  async function handleDayQuickChange(riderId, dayType, storedFocus) {
    if (dayType === "rest" || dayType === "recovery") {
      await handlePlanChange(riderId, dayType, null);
      return;
    }
    const session = storedFocus && SESSION_INTENSITY[storedFocus] ? storedFocus : null;
    if (!session) {
      setFocusPanelRiderId(riderId);
      return;
    }
    await handlePlanChange(riderId, dayTypeForProgram({ focus: session, intensity: SESSION_INTENSITY[session] }), session);
  }
  async function handleFocusPanelClear() {
    if (await handleClearPlan(focusPanelRiderId)) setFocusPanelRiderId(null);
  }

  // Gruppering + multi-select + bulk-apply (#1480).
  const [groupByType, setGroupByType] = useState(false);
  const rosterSort = useSortState({ descFirstKeys: ROSTER_DESC_FIRST });
  const [selected, setSelected] = useState(() => new Set()); // valgte rider-id'er
  // #3762: ét valg i stedet for to. Værdien er enten "smart", en dagstype uden
  // session (rest/recovery) eller en session-nøgle — dagstypen udledes af den.
  const [bulkDay, setBulkDay] = useState("");
  const [bulkMsg, setBulkMsg] = useState(null); // { type: "ok" | "partial" | "warn", text }

  // #5485 (aendring 1): et tryk paa en overbliks-celle filtrerer tabellen.
  // null = alle ryttere. Et tryk mere paa den samme celle viser alle igen.
  const [overviewFilter, setOverviewFilter] = useState(null);
  // #5485 (A3): den rytter hvis kort er foldet ud under raekken paa desktop.
  // Hoejst eet ad gangen; tryk paa den samme rytter igen lukker kortet.
  const [openRiderId, setOpenRiderId] = useState(null);
  // #5485 (aendring 6): fanen Week plan redigerer enten holdets plan ("team")
  // eller een rytters egen plan (hans id).
  const [weekPlanFor, setWeekPlanFor] = useState("team");

  // Hent egne ryttere fra Supabase — samme mønster som TeamPage.
  useEffect(() => {
    async function loadRiders() {
      setRidersLoading(true);
      try {
        // #4160: getSession() laeser den lokale (auto-refreshede) session UDEN
        // en netvaerkstur; getUser() lavede en ekstra GET /auth/v1/user foran
        // hele kaeden. session.user baerer samme id, og vaernet er uaendret:
        // udloebet/uopfriskelig session => session=null => user=null => vi
        // stopper foer user.id. RLS validerer stadig hvert opslag server-side,
        // saa den fjernede tur var ren latenstid, ikke et vaern.
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user ?? null;
        if (!user) return;
        const { data: myTeam } = await supabase
          .from("teams")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!myTeam) return;
        // #3300: is_academy medtages read-only i samme select (ingen migration,
        // intet nyt kald) — feltet findes allerede på riders, kun mangel på
        // visning på trænings-siden.
        // #3709 trin 1: + de 15 evne-kolonner via det delte ABILITY_SELECT-embed
        // (samme mønster som AuctionsPage/RidersPage). Kvitteringen skal vise hvad
        // evnen står på NU, og uden dette embed havde rækken kun fremdrifts-
        // procenten. Ingen ny query og ingen loft-tal: ability_caps er ikke med i
        // ABILITY_KEYS og forlader aldrig serveren (#1162).
        // #3721: + birthdate — Development-fanens navn+alder-række har brug for
        // det (samme ageForSeason-helper som rytterprofilen). Ingen ny query.
        // #3815: birthdate bærer nu OGSÅ roster-tabellens alders-kolonne.
        // #3761: + contract_end_season — Status-cellens contractExpiring-badge
        // (samme kolonne TeamPage allerede henter). Read-only felt på riders,
        // ingen migration og ingen ny query.
        // #5763: + squad — U23/JR-mærket i træningstabellen (desktop+mobil)
        // afgøres af riders.squad, ALDRIG alder alene (spiller 25/9: ACAD-
        // mærket forsvandt med den nye oversigt). Read-only felt, ingen
        // migration og ingen ny query — samme kolonne SquadPage/TeamPage
        // allerede henter server-side via effectiveSquad.
        const { data } = await supabase
          .from("riders")
          .select(`id, firstname, lastname, birthdate, contract_end_season, primary_type, secondary_type, is_academy, squad, ${ABILITY_SELECT}`)
          .eq("team_id", myTeam.id)
          .order("lastname");
        setRiders((data || []).map(flattenAbilities));
      } finally {
        setRidersLoading(false);
      }
    }
    loadRiders();
  }, []);

  // #3721: Development-fanens estimater hentes lazy — kun når fanen faktisk
  // besøges, så et besøg der aldrig åbner Development ikke sender et ekstra
  // POST /api/scouting/estimates for hele truppen. Hooken dedupliserer selv
  // (requestedRef), så et tab-skift frem og tilbage aldrig genspørger.
  useEffect(() => {
    if (activeTab === "development" && riders.length > 0) {
      requestEstimates(riders.map((r) => r.id));
    }
  }, [activeTab, riders, requestEstimates]);

  async function handleRunToday() {
    setRunError(null);
    const result = await runToday();
    if (result && !result.ok) {
      setRunError(result.error || "failed");
    }
  }

  // #1895 PR 1: ugerytme-panel — flad "normal"-skabelon som redigerings-
  // udgangspunkt når holdet endnu ikke har en rytme (weekPlan === null).
  function flatWeekTemplate(intensity = "normal") {
    const days = {};
    for (const k of WEEKDAY_KEYS) days[k] = { intensity };
    return days;
  }

  function setWeekDraftDay(weekday, intensity) {
    setWeekDraft((prev) => ({ ...(prev ?? weekPlan ?? flatWeekTemplate()), [weekday]: { intensity } }));
  }

  async function handleSaveWeekPlan() {
    setWeekPlanMsg(null);
    const days = weekDraft ?? weekPlan ?? flatWeekTemplate();
    const result = await setWeekPlan(days);
    setWeekPlanMsg(result.ok
      ? { type: "ok", text: t("weekRhythmSaved") }
      : { type: "error", text: t("weekRhythmSaveFailed") });
    if (result.ok) setWeekDraft(null);
  }

  async function handleResetWeekPlan() {
    setWeekPlanMsg(null);
    const result = await clearWeekPlan();
    setWeekPlanMsg(result.ok
      ? { type: "ok", text: t("weekRhythmReset") }
      : { type: "error", text: t("weekRhythmSaveFailed") });
    if (result.ok) setWeekDraft(null);
  }

  // #1895 PR 2: individuel ugeplan pr. rytter — samme draft/gem/nulstil-mønster
  // som holdets ugerytme ovenfor, men skoped pr. rytter-id.
  function toggleRiderWeekPlan(riderId) {
    setExpandedRiderId((prev) => (prev === riderId ? null : riderId));
  }

  function riderWeekDraftFor(riderId) {
    return riderWeekDraftMap[riderId] ?? riderWeekPlans[riderId] ?? flatWeekTemplate();
  }

  function setRiderWeekDraftDay(riderId, weekday, intensity) {
    setRiderWeekDraftMap((prev) => ({
      ...prev,
      [riderId]: { ...(prev[riderId] ?? riderWeekPlans[riderId] ?? flatWeekTemplate()), [weekday]: { intensity } },
    }));
  }

  async function handleSaveRiderWeekPlan(riderId) {
    setRiderWeekMsgMap((prev) => ({ ...prev, [riderId]: null }));
    const days = riderWeekDraftMap[riderId] ?? riderWeekPlans[riderId] ?? flatWeekTemplate();
    const result = await setRiderWeekPlan(riderId, days);
    setRiderWeekMsgMap((prev) => ({
      ...prev,
      [riderId]: result.ok
        ? { type: "ok", text: t("individualWeekPlanSaved") }
        : { type: "error", text: t("weekRhythmSaveFailed") },
    }));
    if (result.ok) setRiderWeekDraftMap((prev) => { const next = { ...prev }; delete next[riderId]; return next; });
  }

  async function handleRemoveRiderWeekPlan(riderId) {
    setRiderWeekMsgMap((prev) => ({ ...prev, [riderId]: null }));
    const result = await clearRiderWeekPlan(riderId);
    setRiderWeekMsgMap((prev) => ({
      ...prev,
      [riderId]: result.ok
        ? { type: "ok", text: t("individualWeekPlanRemoved") }
        : { type: "error", text: t("weekRhythmSaveFailed") },
    }));
    if (result.ok) setRiderWeekDraftMap((prev) => { const next = { ...prev }; delete next[riderId]; return next; });
  }

  // Dagens tick-tidspunkt i dansk lokaltid (created_at er UTC). null → vis label uden kl.
  function trainedTime() {
    const ts = todayRun?.created_at;
    if (!ts) return null;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Copenhagen",
    });
  }

  // Bestem hvilken trained-today label der vises (med klokkeslæt når det kendes).
  function trainedTodayLabel() {
    const by = todayRun?.executed_by;
    const who = by === "assistant" || by === "cron" ? "assistant" : "you";
    const time = trainedTime();
    return time ? t(`trainedTodayAt_${who}`, { time }) : t(`trainedToday_${who}`);
  }

  // Stabil dags-reference: bruges både af rækkernes skade-visning og af #3706's
  // Status-comparator, som er memoiseret — en frisk Date pr. render ville
  // invalidere den memo hver eneste gang.
  const today = useMemo(() => new Date(), []);

  // #4160: sidens helsides-PageLoader ventede foer paa BEGGE kilder. Rytter-
  // kaeden (session -> teams -> riders) er den laengste, men den fodrer KUN
  // roster-/development-tabellerne; dagens panel (dagens koersel, status,
  // rapport) kommer fra useTraining og er sidens stoerste tekstblok — altsaa
  // LCP-elementet. Ved at gate helsides-loaderen paa useTraining alene males
  // hovedindholdet efter eet tur/retur i stedet for tre, og trup-tabellerne
  // hydrerer bagefter i deres eget skelet.
  // PAGE_TEMPLATES.md, "Canonical states": "The card header and border stay
  // mounted; only the body swaps between loading / empty / error / content."
  const isLoading = loading;

  // Dags-opsummering til rapportens payoff-stribe (trænede / gennembrud / topform).
  const summary = todayRun?.report ? daySummary(todayRun.report.riders) : null;

  // Dagligt udviklings-moment (#2484, H3): ÉN kurateret historie i stedet for
  // kun rå tal. latestRun = dagens kørsel hvis den allerede er kørt, ellers
  // seneste historiske dag (typisk "i går"). pastRuns bruges KUN til cooldown
  // (undgå samme rytter/historie-type dag-for-dag) — aldrig til visning.
  const latestRun = todayRun ?? history.runs[0] ?? null;
  const latestIsToday = !!todayRun;
  const pastRuns = latestIsToday
    ? history.runs.filter((r) => r.tick_date !== todayRun.tick_date)
    : history.runs.slice(1);

  // #3709 trin 1: sæsonens hele point pr. rytter, summeret fra den AKTIVE sæsons
  // trænings-kørsler (useTrainingHistory skærer selv forrige sæsons hale fra).
  // Uden en kendt sæsonstart bliver map'et tomt, rækkerne får seasonGains = null
  // og viser "—" i stedet for et opfundet "+0".
  // #4293: en sæson kan være `active` med en start_date i FREMTIDEN (interregnum
  // mellem to sæsoner), og en begyndt sæson kan endnu ikke have en eneste
  // træningsdag. I begge tilfælde er der ingen sæsondage at kvittere for, og
  // map'et bliver tomt — rækkerne får seasonGains = null og viser "—" i stedet
  // for et "+0" om en periode der ikke har målt noget.
  const seasonGainsByRider = useMemo(() => {
    const out = {};
    if (history.seasonState !== SEASON_RECEIPT_RUNNING || !history.seasonStart) return out;
    for (const r of riders) {
      out[r.id] = seasonAbilityGains(history.seasonRuns, r.id, history.seasonStart) ?? {};
    }
    return out;
  }, [riders, history.seasonRuns, history.seasonStart, history.seasonState]);

  // #3746 trin 7: Week plan-fanens kompakte oversigt — ryttere med en egen
  // individuel ugeplan-override. Genbruger riderWeekPlans (allerede hentet af
  // useTraining til roster-rækkens udvidelige panel), ingen nyt kald.
  const ridersWithOwnWeekPlan = useMemo(
    () => riders.filter((r) => riderWeekPlans[r.id] != null),
    [riders, riderWeekPlans],
  );

  // --- Gruppering + multi-select (#1480) ---
  // Antal kolonner i roster-tabellen (select + type + 7 oprindelige) — bruges til
  // colSpan på gruppe-header-rækker.
  // #3300-rework: +1 kolonne (individuel ugeplan-knap flyttet ud af navne-cellen
  // og ind i sin egen kolonne, jf. ejer-feedback).
  // #3815: +1 kolonne (Alder).
  const ROSTER_COLS = 11;
  // #4851: Score-kolonnen laegges oveni naar flaget er on. Basistallet ovenfor
  // er pinnet af TrainingPage.wiring.test.js (#3300-rework), saa den betingede
  // kolonne bor i sit eget tal i stedet for at goere basistallet dynamisk.
  const ROSTER_COLS_TOTAL = ROSTER_COLS + (scoreVisible ? 1 : 0);

  // #5124 — D-047 for roster-tabellen. Den kan ikke bruge <DataTable> (multi-
  // select-checkbox + gruppe-header-rækker + en udvidelig ugeplan-underrække,
  // se filhovedets note), så mobil-standarden bygges her ovenpå de SAMME
  // primitiver DataTable bruger (MobileTableChips.jsx → mobileTableColumns.ts).
  // Type/Alder/Form/Træthed er allerede foldet ind i navne-underlinjen (#3045/
  // #3815, `hidden sm:table-cell`) og tæller derfor ikke som "swappable" her —
  // de fem RESTERENDE kolonner (Dag, Skift dag, Kvittering, Status, Ugeplan)
  // er for mange til at vise samtidig uden vandret scroll på 375-390px, så de
  // går gennem chip-bytteren. "Skift dag" er sidens hovedhandling ("vælg
  // træning" i #5124) og står derfor i standard-tre sammen med Kvittering og
  // Status; "Dag" (åbner fokus-panelet) og Ugeplan er ét chip-tryk / "Fuld
  // tabel" væk.
  //
  // ⚠ #3643 (ejer 19/9): DETTE ER DEN GAMLE MOBIL-VISNING, og den er BEVARET
  //   med vilje. Den vises når `training_mobile_table` er off for brugeren,
  //   dvs. for alle der ikke er beta-testere. Hele blokken (rosterMobile*,
  //   showRosterCol, rosterScrollerClass, rosterMobileWrapAlign, den dynamiske
  //   colSpan og chip-rækken længere nede) er DØD KODE DEN DAG FLAGET GÅR TIL
  //   `on` — slet den da, i én rettelse, og fjern samtidig `mobileTable` fra
  //   gaten i TabPanel value="today". Se #3643.
  const isMobile = useIsMobileViewport();
  // #5485 (aendring 7): en telefon paa langs (under ca. 500 px hoejde) bruger
  // telefonens layout, ikke desktop-tabellen. Maalt 22/9 paa #3643: 0 ryttere
  // paa foerste skaerm i 844 x 390 med desktop-fladen.
  const isShortLandscape = useMediaQuery("(max-height: 500px) and (orientation: landscape)");
  const phoneLayout = isMobile || isShortLandscape;
  // #3643: gaten mellem de to mobil-visninger. Serveren har allerede evalueret
  // training_mobile_table mod viewerens beta-status (GET /api/training/me), så
  // klienten vælger kun MELLEM to flader — den åbner aldrig selv en.
  const mobileTableView = phoneLayout && mobileTable;
  // Tegner fanen Today en af telefonens to visninger (beta-tabellen eller
  // D-047-grenen)? Ellers desktop-tabellen — også på en telefon på langs uden
  // beta-flaget, der har sin egen #5124-gren ≤640 px, ikke på 844 px.
  const phoneTodayView = phoneLayout && (isMobile || mobileTable);
  // Den gamle D-047-tilstand gælder KUN når den nye tabel ikke er valgt.
  const mobileRosterView = isMobile && !mobileTable;
  // #5124-rettelse (fanget af eksisterende specs, ikke af mig selv): fire
  // eksisterende specs kræver hver sin kolonne synlig UDEN "Fuld tabel" på
  // mobil (3762-day-panel + onboarding-touren → "focus"/FocusOpenButton;
  // training-season-receipt → "receipt" OG "status"), men D-047 giver kun
  // plads til tre. "focus" (åbn fokus-panelet) og "today" (Skift dag-knapperne)
  // er derfor SLÅET SAMMEN til én fysisk kolonne ("day") i stedet for at
  // opfinde en fjerde plads — de to hører allerede sammen (samme handling: sæt
  // dagens træning), og standard-tre bliver day/receipt/status.
  const rosterMobileColumns = useMemo(
    () => [
      { key: "day", header: `${t("dayPanel.colDay")} / ${t("dayPanel.colChangeDay")}` },
      { key: "receipt", header: t("receipt.title") },
      { key: "status", header: t("colStatus") },
      { key: "weekplan", header: t("colWeekPlan") },
    ],
    [t]
  );
  const ROSTER_MOBILE_DEFAULTS = useMemo(() => ["day", "receipt", "status"], []);
  const rosterMobile = useMobileTableColumns(rosterMobileColumns, ROSTER_MOBILE_DEFAULTS);
  // Desktop er uændret: `!mobileRosterView` gør showRosterCol altid true dér,
  // uanset chip-valg. Kun ≤640px MED flaget off filtrerer efter kolonnesættet.
  const showRosterCol = (key) => !mobileRosterView || rosterMobile.visibleKeys.includes(key);
  const showRosterChips = mobileRosterView && rosterMobile.hasChips;
  // "Fuld tabel" på mobil genbruger den kontaminerede (egen scroller, ikke
  // sidescroll) sticky-navnekolonne-mekanik denne tabel allerede bruger på
  // desktop (.sticky-name-cell) — IKKE DataTable's to-lags-teknik. Rækkens
  // model (checkbox + gruppe-header-rækker + en udvidelig ugeplan-underrække
  // der skal spænde ALLE kolonner) lader sig ikke splitte i to uafhængige
  // table-elementer uden at bryde netop den underrække. Da mekanikken er
  // KONTAINERET (egen overflow-auto, aldrig side-scroll) kan den ikke gengive
  // #5060 (navnekolonnen fulgte slet ikke med — den var ikke sticky, ikke et
  // spørgsmål om at være kontaineret), og den er allerede battle-tested på
  // netop denne tabel på desktop. Dokumenteret afvigelse fra D-047's "aldrig
  // CSS sticky i Fuld tabel", parallel til den skriftlige undtagelse #5124
  // giver sæsonmatricen.
  const rosterScrollerClass = mobileRosterView && !rosterMobile.fullTable ? MOBILE_SCROLLER : SCROLLER;
  // #5124 ejer-fund 15/9: `<td>`'s browser-default er `vertical-align: middle`.
  // Navnecellen kan nu blive markant højere end de andre celler i rækken (2-linjers
  // navn + op til 4-linjers type/alder/form/træthed-underlinje, alt sammen wrappet
  // for D-047's "ingen vandret scroll"). De ANDRE, kortere celler (checkbox,
  // Fokus-knappen, Skift dag-knapperne) centrerede sig derfor lodret i den nu høje
  // række og landede visuelt midt inde i navnecellens ombrudte undertekst i stedet
  // for øverst ved navnet — set af ejeren som "overlap i rytter-cellen" på både
  // Træning og Transfers. Kun et layout-spørgsmål (ingen elementer flyttede sig
  // fysisk uden for deres egen kolonne) — align-top løser det uden at ændre
  // kolonnebredder. Kun nødvendigt når navnet rent faktisk kan wrappe (mobil-
  // standardtilstanden); "Fuld tabel" og desktop beholder browser-default.
  const rosterMobileWrapAlign = mobileRosterView && !rosterMobile.fullTable ? "align-top" : "";
  // "day" er ÉN chip-nøgle men TO fysiske kolonner (Dag + Skift dag, samme
  // <th>-gate, se showRosterCol("day") ovenfor) — colSpan tæller derfor fysiske
  // kolonner pr. nøgle, ikke antal nøgler, ellers driver gruppe-header- og
  // ugeplan-underrækkens colSpan fra det faktisk renderede antal <td>.
  const ROSTER_SWAPPABLE_WEIGHTS = { day: 2, receipt: 1, status: 1, weekplan: 1 };
  const rosterHiddenPhysicalCols = mobileRosterView
    ? Object.entries(ROSTER_SWAPPABLE_WEIGHTS).reduce(
        (sum, [key, weight]) => sum + (rosterMobile.visibleKeys.includes(key) ? 0 : weight),
        0
      )
    : 0;
  // #4851 (main) tilføjede en betinget Score-kolonne til ROSTER_COLS_TOTAL efter
  // denne gren forgrenede sig — basistallet skal derfor være det TOTALE (inkl.
  // Score når synlig), ikke det faste ROSTER_COLS, ellers colSpan for lidt når
  // begge features er aktive samtidig.
  const rosterColSpan = ROSTER_COLS_TOTAL - rosterHiddenPhysicalCols;

  // Accessors til roster-sortering. form/fatigue bor i condition-map'et (ikke på
  // rytteren), så closure over condition — useMemo holder referencen stabil pr.
  // condition-ændring så sorteringen ikke re-kører hver render.
  const rosterAccessors = useMemo(() => ({
    name: (r) => `${r.lastname ?? ""} ${r.firstname ?? ""}`.trim(),
    primary_type: (r) => r.primary_type ?? "",
    // #3815: sæson-alderen som tal, samme helper som cellen selv viser, så
    // rækkefølgen ikke kan drive fra det man læser. Uden sæson-år giver
    // ageForSeason null, og sortRows lægger null'er sidst uanset retning.
    age: (r) => ageForSeason(r.birthdate, seasonYear),
    form: (r) => condition[r.id]?.form ?? null,
    fatigue: (r) => condition[r.id]?.fatigue ?? null,
    // #3706: samme to badges som Status-cellen viser, som ét sorterbart tal.
    // injuryTimeLeft er den samme kilde cellen selv bruger, så rækkefølgen kan
    // ikke drive fra det man ser.
    status: (r) => (r.is_academy ? STATUS_ACADEMY_WEIGHT : 0)
      + (injuryTimeLeft(condition[r.id], today).count > 0 ? STATUS_INJURED_WEIGHT : 0),
    // #4851: dagens tal. Ryttere uden et tal (hvile, loebsdag) giver null, og
    // sortRows laegger null'er sidst uanset retning — de kan derfor ikke
    // forurene toppen af en "hvem traente bedst"-sortering.
    // #5485: foer dagens pas sorteres der paa det SENESTE tal, samme tal som
    // cellen viser (scoreSortValue), saa raekkefoelgen ikke kan drive fra det
    // man laeser.
    score: (r) => scoreSortValue(mobileScoreCell(trainingScore?.[r.id] ?? null, { settled: scoreSettled })),
  }), [condition, today, seasonYear, trainingScore, scoreSettled]);
  const rosterAccessor = rosterSort.sort ? rosterAccessors[rosterSort.sort] : null;
  const sortRoster = (list) => sortRows(list, rosterAccessor, rosterSort.sortDir);

  // Vis enten flade rækker eller type-grupper. Begge bruger samme allerede-hentede
  // riders-array (ingen ny query) og den samme aktive sortering.
  const groups = groupByType ? groupRidersByType(riders) : null;

  function toggleSelect(riderId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(riderId)) next.delete(riderId);
      else next.add(riderId);
      return next;
    });
  }

  // "Vælg alle" gælder de ryttere tabellen VISER (visibleRiders, overblikkets
  // filter), aldrig dem filtret skjuler. Ellers kunne mængde-handlingen skifte
  // dag for ryttere spilleren ikke kan se.
  function toggleSelectAll() {
    // #5485: filtrets ryttere, ikke dem der kun står et øjeblik endnu med
    // "Saved" (lingerIds) — de hører ikke længere til filtret.
    const ids = selectableRiders.map((r) => r.id);
    setSelected((prev) => (ids.length > 0 && ids.every((id) => prev.has(id)) ? new Set() : new Set(ids)));
  }

  function clearSelection() {
    setSelected(new Set());
    setBulkMsg(null);
  }

  function groupLabel(type) {
    return type === UNTYPED_KEY ? t("untypedGroup") : tTypes(`types.${type}`);
  }

  // Én roster-række (genbruges af både flad liste og type-grupperet visning).
  // #2819: isFirst markerer den øverste synlige roster-række som tour-anker
  // (samme mønster som AuctionsPage's isFirst → data-tour="auctions-bid-input").
  function renderRosterRow(rider, isFirst = false) {
    const plan = planFor(rider.id);
    const cond = condition[rider.id] ?? {};
    // #5462: loebsdage naar backenden har skrevet dem, ellers kalenderdage som foer.
    const injury = injuryTimeLeft(cond, today);
    const daysLeft = injury.count;
    const injured = daysLeft > 0;
    const highRisk = !injured && (cond.risk ?? 0) >= 0.05;
    const busy = savingId === rider.id || bulkApplying;
    const isSelected = selected.has(rider.id);
    // #4851: dagens traeningsscore + de sidste 7 dage. undefined naar flaget er
    // off (trainingScore er null) — cellen tegnes saa slet ikke.
    const riderScore = trainingScore?.[rider.id] ?? null;
    const riderScoreCell = scoreVisible ? scoreCellFor(rider.id) : null;
    // #3709 trin 1: kvitteringen for fokussets 2-3 evner. Erstatter den ene
    // aggregerede progress-bar, som var rod-årsagen bag #3639: baren viste kun
    // evnen tættest på gennembrud, så en låst evne ved siden af var usynlig.
    // Nu står hver af fokussets evner på sin egen linje med nu / sæson / på vej,
    // og en låst evne skriver "færdig" i stedet for en død bar.
    // `capped` er kun ability-NØGLER — cap-tal forlader aldrig serveren (#1162).
    const focusReceipt = focusAbilityReceipt(plan?.focus, {
      abilities: rider.abilities,
      progress: progress[rider.id],
      capped: capped[rider.id],
      seasonGains: seasonGainsByRider[rider.id] ?? null,
      // #3924 trin 2: gårsdagens bidrag som mørkere segment på baren — begge
      // fra samme todayRun-linje, null når rytteren ikke indgik i dagens kørsel.
      progressBefore: todayRowByRider[rider.id]?.progress_before ?? null,
      gainsToday: todayRowByRider[rider.id]?.gains ?? null,
    });

    // #3459 V3 / #4375: løbsdags-badge - feltet findes KUN når
    // race_day_development_enabled er on (backend udelader det helt ellers, se
    // useTraining.js), så tilstedeværelse alene er hele gaten. Planen
    // (fokus/intensitet) RØRES ALDRIG her - kun visning.
    const raceToday = racingToday[rider.id] ?? null;

    // #1895 PR 2: rytterens EGEN ugeplan-override, hvis sat — vinder over holdets
    // ugerytme for netop denne rytter (samme lagdeling som motoren).
    const riderOverrideDays = riderWeekPlans[rider.id] ?? null;
    const hasOwnWeekPlan = riderOverrideDays != null;
    const isExpanded = expandedRiderId === rider.id;
    const savingRiderPlan = savingRiderWeekPlanId === rider.id;

    // #2438 — "én sandhed pr. rytter": rytterens EGEN eksplicitte focus+intensity
    // (training_plans) overtrumfer holdets ugerytme; rytmen er kun default for
    // ryttere uden egen override. Samme lagdeling som motoren (training.js
    // resolveDayIntensity). Kun relevant til visning når holdet HAR en ugerytme —
    // uden rytme er der intet konkurrerende signal at forklare.
    const hasExplicitPlan = !!(plan?.focus && plan?.intensity);
    const teamRhythmActive = weekPlan != null;
    const effectiveTodayIntensity = teamRhythmActive
      ? resolveDayIntensityDisplay({
          weekday: todayWeekday,
          riderOverrideDays,
          teamWeekDays: weekPlan,
          planIntensity: plan?.intensity ?? "normal",
          hasExplicitPlan,
        })
      : null;
    const todayIntensitySource = teamRhythmActive
      ? resolveDayIntensitySource({ weekday: todayWeekday, riderOverrideDays, teamWeekDays: weekPlan, hasExplicitPlan })
      : null;
    const todayHintKey = {
      individualPlan: "weekRhythmTodayHintOwn",
      ownSetting: "weekRhythmTodayHintPlan",
      teamRhythm: "weekRhythmTodayHint",
      default: "weekRhythmTodayHint",
    }[todayIntensitySource];

    return (
      <Fragment key={rider.id}>
      <tr className={`${trClass(null)} ${isSelected ? "bg-cz-accent/5" : ""}`}>
        {/* Multi-select — sticky sammen med navnekolonnen (#2446), fast w-10 så
            offsettet på navnekolonnen (left-10) matcher præcis. */}
        <td className={`border-t border-cz-border px-2 py-3 w-10 sticky-name-cell sticky left-0 z-sticky ${rosterMobileWrapAlign}`}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelect(rider.id)}
            aria-label={`${t("selectAll")} — ${rider.firstname} ${rider.lastname}`}
            className="h-4 w-4 rounded-[3px] accent-cz-accent"
          />
        </td>

        {/* Navn — sticky ved horisontal scroll (#2446), så rytter-identiteten aldrig
            forsvinder når man scroller ud til fokus/intensitet-kolonnerne. Samme
            opskrift som RidersPage/TeamPage (.sticky-name-cell). Ingen rå skygge-klasse
            (#2849 bølge 4 anti-slop) — den opake .sticky-name-cell-baggrund + 1px
            border-r ER den kanoniske sticky-first-column-recipe (T2). */}
        <td
          className={`border-t border-cz-border px-4 py-3 sticky-name-cell sticky left-10 z-sticky border-r border-cz-border ${rosterMobileWrapAlign} ${
            mobileRosterView && !rosterMobile.fullTable ? "w-full max-w-0" : ""
          }`}
        >
          {/* whitespace-nowrap: navnet er kolonnens naturlige bredde (DataTable-opskriften)
              — uden den kollapser cellen til underlinjens max-w og ombryder navnet.
              #5124: i mobil-standardtilstanden (ingen vandret scroll) BRYDER navnet i
              stedet — samme regel som DataTable's renderStickyCell(wrap=true): uden det
              kan et langt navn skubbe tabellen ud over 390px, præcis den garanti D-047
              kræver ("ikke håbet om at indholdet passer"). */}
          <div
            className={`flex items-center gap-1.5 ${
              // #5124: KUN `min-w-0` (bryd ved ordgrænser om nødvendigt), ikke
              // `break-words` — den brød korte navne midt i ordet ("Peder-
              // /sen"), fordi tabellens to øvrige mobil-kolonner (knap-gruppe
              // + "Denne sæson"-teksten) ikke har nogen bredde-modvægt og
              // derfor æder navnekolonnens plads i auto-table-layout'et. De to
              // datakolonner får derfor deres egen `max-w` nedenfor, så navnet
              // beholder en rimelig andel.
              mobileRosterView && !rosterMobile.fullTable ? "min-w-0" : "whitespace-nowrap"
            }`}
          >
            <RiderLink id={rider.id} className="text-cz-1 font-medium hover:text-cz-accent transition-colors">
              {rider.firstname} {rider.lastname}
            </RiderLink>
          </div>
          {/* #3045: portræt-kolonnekontrakt — Type + Form + Træthed foldes ind
              i navne-underlinjen ≤640px (samme "DataTable fold"-mønster som
              RidersPage/TeamPage/WatchlistPage), så Fokus + Intensitet-
              kolonnerne (dem man rent faktisk redigerer) ikke skal dele
              skærmen med rent info-only kolonner i portræt. Skjult ≥640px,
              hvor Type/Form/Træthed vises som deres egne kolonner (uændret).
              #3194: underlinjen må ALDRIG diktere kolonnebredden — denne celle er
              STICKY, så en nowrap-linje ("SPRINTER/KLATRER · FORM 78 · TRÆTHED 42")
              gjorde navnekolonnen ~skærmbred i portræt og reducerede fokus/
              intensitet til en ubrugelig scroll-strimmel (2 spillere, iOS+Android).
              max-w + ombrydning i stedet for nowrap: infoen står på 2 korte linjer. */}
          <div className="mt-0.5 sm:hidden max-w-[40vw] font-data text-3xs uppercase tracking-[.05em] text-cz-3">
            {/* #4851: ingen break-words her — den brød ord midt i bogstaverne
                ("SPRINTE/R/ROULE/UR", maalt 21/9 med det laengste ryttertype-
                par paa 412px). Samme opskrift som DataTable's renderStickyCell
                (D-047/#5124, withBreakHints): kun "/" i selve typeparret faar
                en <wbr/>-brydningsmulighed, resten bryder alene ved de naturlige
                mellemrum omkring " · ". */}
            {[
              rider.primary_type
                ? (rider.secondary_type && rider.secondary_type !== rider.primary_type
                  ? `${tTypes(`types.${rider.primary_type}`)}/${tTypes(`types.${rider.secondary_type}`)}`
                  : tTypes(`types.${rider.primary_type}`))
                : null,
              // #3815: alderen følger samme portræt-fold som Type/Form/Træthed —
              // kolonnen er skjult ≤640px, så tallet står her i stedet. Uden
              // dette ville ønsket ("alder under Daglig træning") kun være
              // opfyldt på desktop, og fladen bruges også i portræt.
              `${t("colAge")} ${ageForSeason(rider.birthdate, seasonYear) ?? "—"}`,
              `${t("form")} ${cond.form ?? "—"}`,
              `${t("fatigue")} ${cond.fatigue ?? "—"}`,
              // #4851: scoren staar ogsaa i portraet-underlinjen, saa dagens
              // vigtigste tal kan laeses uden vandret scroll (D-047's princip).
              // #5485: foer dagens pas er det det SENESTE tal, og linjen siger det.
              scoreVisible && riderScoreCell?.state === "score"
                ? `${t("score.column")} ${riderScoreCell.value}`
                : scoreVisible && riderScoreCell?.state === "latest"
                  ? `${t("score.column")} ${riderScoreCell.value} (${t("score.latest")})`
                  : null,
            ].filter(Boolean).flatMap((value, index) => [
              index > 0 ? " · " : null,
              ...[].concat(withBreakHints(value)),
            ])}
          </div>
        </td>

        {/* Ryttertype */}
        <td className={`${tdClass({})} hidden sm:table-cell`}>
          <RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} />
        </td>

        {/* #3815: Alder. Sæson-alderen (ageForSeason, ikke wall-clock — #3071),
            samme tal som rytterprofilen og Development-fanen viser. "—" når
            sæson-året endnu ikke er hentet; en manglende alder er bedre end en
            forkert. tabular-nums via numeric-recipen, så cifrene flugter
            lodret ned gennem truppen. */}
        <td className={`${tdClass({ numeric: true, compact: true })} hidden sm:table-cell`}>
          <span className="text-cz-2">{ageForSeason(rider.birthdate, seasonYear) ?? "—"}</span>
        </td>

        {/* #4851: Score — dagens tal + de sidste 7 dage. Loebsdage viser
            "loeb" uden tal og efterlader et hul i kurven (spec §4.4).
            Tabular figures, saa cifrene flugter lodret ned gennem truppen. */}
        {scoreVisible && (
          <td
            className={tdClass({ numeric: true, compact: true })}
            data-testid="training-score-cell"
            data-score-state={riderScoreCell?.state ?? "none"}
          >
            {/* #5485 (ejer-valg A 23/9): samme fire tilstande som den nye
                tabel (mobileScoreCell). Før dagens pas: seneste tal dæmpet med
                "latest"; kurven står altid når der er målte dage. */}
            <div className="flex flex-col items-end gap-1">
              {riderScoreCell?.state === "race" ? (
                <span className="font-data text-3xs uppercase tracking-[.06em] text-cz-3">
                  {t("score.raceDay")}
                </span>
              ) : riderScoreCell?.state === "score" ? (
                <span className="font-mono tabular-nums text-sm font-bold leading-none text-cz-1">
                  {riderScoreCell.value}
                </span>
              ) : riderScoreCell?.state === "latest" ? (
                <span className="inline-flex items-baseline gap-1" title={t("score.latestHint")}>
                  <span className="font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">{t("score.latest")}</span>
                  <span className="font-mono tabular-nums text-sm font-bold leading-none text-cz-3">{riderScoreCell.value}</span>
                </span>
              ) : (
                <span className="text-cz-3 text-xs">—</span>
              )}
              {(riderScore?.spark?.length ?? 0) > 0 && (
                <TrainingScoreSparkline
                  points={riderScore.spark}
                  label={t("score.sparkAria", { name: `${rider.firstname} ${rider.lastname}` })}
                  width={64}
                  height={18}
                />
              )}
            </div>
          </td>
        )}

        {/* #3721: fokus-vælgeren er et panel, ikke en <select> (ejer-godkendt
            14/8). Cellen bar før fire signaler i 184 px — fokussets navn, et
            trænbarheds-mærke klistret ind i option-teksten (som klippede:
            "Threshold / TT (X very lir"), en to-linjers chip, og assistentens
            hint. Trin 2 lægger et syvende fokus i den og trin 4 point pr. sæson
            pr. fokus; en <select> kan ikke bære det. Cellen er nu én knap der
            åbner panelet, hvor hvert fokus har sin egen række.

            Trænbarheds-chippen er VÆK herfra, ikke flyttet. Den røde
            "blocked"-variant er målt uopnåelig (0 af 384 type-kombinationer på
            både main og #3741), og den gule "limited" er den tvetydige bucket
            #3747 beskriver, hvor håndværk (tag 0,95) og anden rolle (0,70)
            lander sammen. Panelet viser kun de påstande der kan efterprøves. */}
        {showRosterCol("day") && (
        <td className={`${tdClass({})} ${rosterMobileWrapAlign} ${mobileRosterView && !rosterMobile.fullTable ? "max-w-[15vw]" : ""}`}>
          {/* #3721: DELT FocusOpenButton — samme komponent/mutation som
              Development-fanens rækker bruger (ingen forgrenet fokus-logik). */}
          <FocusOpenButton
            rider={rider}
            plan={plan}
            busy={busy}
            smartFocus={smartDefaultFocus[rider.id]}
            error={planActionError?.riderId === rider.id ? planActionError.error : null}
            onOpen={() => setFocusPanelRiderId(rider.id)}
            t={t}
            dataTour={isFirst ? "training-focus" : undefined}
          />
        </td>
        )}

        {/* Intensitet — #5124: sidens hovedhandling ("skift dagens træning"),
            derfor en af de tre mobil-standardkolonner (rosterMobile). #3643:
            den nye mobil-tabel har sin egen vej til den samme mutation
            (rytterens kort, foldet ud under hans egen række), men den vises
            kun bag flaget. */}
        {showRosterCol("day") && (
        // #5124: `max-w` på mobil-standardtilstanden — uden den æder de to
        // tekst-tunge datakolonner (denne + "Denne sæson") navnekolonnens
        // plads i auto-table-layout'et (se navnecellens kommentar ovenfor).
        <td className={`${tdClass({})} ${rosterMobileWrapAlign} ${mobileRosterView && !rosterMobile.fullTable ? "max-w-[19vw]" : ""}`}>
          {plan?.focus ? (
            <div
              role="group"
              aria-label={`${t("dayPanel.colChangeDay")} — ${rider.firstname} ${rider.lastname}`}
              // #3459 V3: dæmpet (ikke deaktiveret) på løbsdage — planen er urørt og
              // gælder alle ikke-løbsdage, knapperne forbliver derfor fuldt aktive.
              // #5124: på mobil (ingen vandret scroll) bryder knap-gruppen til to
              // linjer i stedet for at tvinge cellen bredere end skærmen —
              // `overflow-hidden` droppes samtidig, ellers klippes anden linje væk.
              // Desktop uændret (mobileRosterView er altid false dér).
              className={`inline-flex rounded-cz border border-cz-border ${
                mobileRosterView ? "flex-wrap" : "overflow-hidden"
              } ${raceToday ? "opacity-[0.55]" : ""}`}
            >
              {/* #3762: intensiteten er ikke længere et frit valg — den er en
                  egenskab ved sessionen. Knapperne skifter derfor DAGEN.
                  Sessions-knappen bærer rytterens egen session, som serveren
                  bevarer hen over en hviledag, så vejen tilbage er ét klik. */}
              {QUICK_DAY_TYPES.map((k) => {
                const activeDay = dayTypeForProgram(plan);
                const isSession = k === "session";
                const dayType = isSession ? sessionDayType(plan) : k;
                const label = isSession
                  ? t(`dayPanel.session_${plan.focus}`, { defaultValue: t("dayPanel.dayType_training") })
                  : t(`dayPanel.dayType_${k}`);
                const pressed = isSession ? activeDay === dayType : activeDay === k;
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={busy}
                    onClick={() => handleDayQuickChange(rider.id, isSession ? "session" : k, plan.focus)}
                    aria-pressed={pressed}
                    className={`text-xs px-2 py-1 transition-colors disabled:opacity-50 ${
                      pressed ? "bg-cz-accent text-white" : "text-cz-2 hover:bg-cz-subtle"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="text-cz-3 text-xs">—</span>
          )}
          {/* #2438 — "én sandhed pr. rytter": vis altid dagens EFFEKTIVE intensitet +
              kilden når holdet har en ugerytme, uanset om rytteren selv har en plan.
              Uden dette forsvandt hele forklaringen for ryttere uden eget fokus, som
              stille fulgte holdrytmen uden nogen synlig grund. */}
          {/* Ejer-kvalitetspas 24/7: den fulde kilde-forklaring gentaget som prosa
              under HVER række var visuel støj — kompakt T2-meta-linje med den
              fulde forklaring som title-tooltip i stedet. */}
          {/* #3459 V3: løbsdags-linjen ERSTATTER (ikke supplerer) den normale
              rytme-hint på dage rytteren racer i dag — planen er urørt (knapperne
              er kun dæmpet ovenfor, ikke deaktiveret), racedagen ER dagens svar på
              "hvorfor". Tooltip forklarer hele mekanikken; badgen selv holdes kort
              (samme kompakte T2 meta-linje-format som rytme-hinten den erstatter). */}
          {raceToday ? (
            <div
              className="mt-1 flex items-center gap-1 font-data text-3xs uppercase tracking-[.06em] text-cz-accent"
              title={t("raceDayTooltip", {
                riderName: `${rider.firstname} ${rider.lastname}`,
                raceName: raceToday.race ?? t("raceDayTooltipRaceFallback"),
              })}
            >
              <FlagIcon size={12} aria-hidden="true" />
              {t("raceDayBadge")}
            </div>
          ) : teamRhythmActive && (
            <div
              className="mt-1 font-data text-3xs uppercase tracking-[.06em] text-cz-3"
              title={t(todayHintKey, { intensity: tRider(`training.intensity_${effectiveTodayIntensity}`) })}
            >
              {t("weekRhythmTodayShort", { intensity: tRider(`training.intensity_${effectiveTodayIntensity}`) })}
            </div>
          )}
        </td>
        )}

        {/* #3709 trin 1: kvitteringen for fokussets egne evner. Hver evne får
            sin egen linje med nu / point i sæsonen / på vej, og en låst evne
            skriver "færdig". Den gamle ene aggregerede bar viste kun evnen
            tættest på gennembrud (#3639), og de tre loft-tekster lovede at en
            evne aldrig steg igen — et løfte den nye model gør usandt (#3649). */}
        {showRosterCol("receipt") && (
        <td
          className={`${tdClass({})} ${rosterMobileWrapAlign} ${mobileRosterView && !rosterMobile.fullTable ? "max-w-[30vw]" : ""}`}
          data-tour={isFirst ? "training-next-up" : undefined}
        >
          {/* #5124: min-w droppes på mobil-standardtilstanden (ingen vandret
              scroll) — 176px er for bredt sammen med navn + "Skift dag" på
              390px. Desktop/Fuld tabel uændret. */}
          {focusReceipt ? (
            <div className={mobileRosterView && !rosterMobile.fullTable ? "" : "min-w-[176px]"}>
              {focusReceipt.map((row) => (
                <AbilityReceiptRow key={row.ability} row={row} />
              ))}
            </div>
          ) : (
            <span className="text-cz-3 text-xs">{t("noFocus")}</span>
          )}
          {todayGainsByRider[rider.id] > 0 && (
            <div className="mt-0.5">
              <span className="inline-block text-3xs px-1.5 py-0.5 rounded-cz-pill bg-cz-success-bg text-cz-success border border-cz-success/30">
                {t("gainedToday", { count: todayGainsByRider[rider.id] })}
              </span>
            </div>
          )}
        </td>
        )}

        {/* Form */}
        <td className={`${tdClass({})} hidden sm:table-cell`}>
          <MiniBar value={cond.form} color="bg-cz-info" label={t("form")} />
        </td>

        {/* Træthed */}
        <td className={`${tdClass({})} hidden sm:table-cell`}>
          <MiniBar value={cond.fatigue} color="bg-cz-warning" label={t("fatigue")} />
        </td>

        {/* Status: akademi + skadet / høj risiko. Ejer-feedback (rework af #3300):
            akademi-badgen skal stå i sin egen kolonne "på samme måde som badges
            andre steder" — samme RiderBadges-recipe og samme Status-kolonne som
            TeamPage/TeamProfilePage bundler badges i (injured/academy/age/risk/
            contract alt sammen under ÉN "Status"-header), i stedet for at ligge
            inline i navne-cellen. Ingen `hidden sm:table-cell` — TeamPages
            badges-kolonne foldes heller ikke væk i portræt (#3194), den scroller
            vandret som resten af tabellen. */}
        {showRosterCol("status") && (
        <td className={`${tdClass({})} ${rosterMobileWrapAlign} ${mobileRosterView && !rosterMobile.fullTable ? "max-w-[13vw]" : ""}`}>
          <div className="flex flex-wrap gap-1">
            {/* #3761: Status-cellen viste ÉN af de badges rytteren kan bære.
                De to der mangler er præcis dem der afgør om træningen
                overhovedet er en investering værd: kontrakten udløber ved
                næste sæsonskifte, eller rytteren er i/lige før pensions-
                vinduet. Begge er allerede beregnede helpers (riderAge.js) og
                vises på TeamPage — samme kald-form her, ingen ny mekanik.
                is_academy udelades fra begge, ligesom på TeamPage: squad-risk-
                spærren (#2748) tæller kun senior-ryttere. */}
            <RiderBadges badges={[
              rider.is_academy && "academy",
              !rider.is_academy && retirementRiskBadgeKey(rider, seasonYear),
              !rider.is_academy && contractExpiringBadgeKey(rider, activeSeasonNumber),
            ]} />
            {injured && (() => {
              // Status-cellen er smal (den deler plads med akademi-, pensions- og
              // kontrakt-badges), saa badget er KORT og ca.-datoen staar i title'en.
              const msg = injuryBadgeMessage(injury, { compact: true });
              return (
                <span
                  className="text-3xs px-2 py-0.5 rounded-cz-pill bg-cz-danger-bg text-cz-danger border border-cz-danger/30"
                  title={injury.unit === "race_day" && injury.approxDate
                    ? t("injuredApprox", { date: formatDate(injury.approxDate, "medium") })
                    : undefined}
                >
                  {t(msg.key, { days: msg.days })}
                </span>
              );
            })()}
            {highRisk && (
              <span className="text-3xs px-2 py-0.5 rounded-cz-pill bg-cz-warning/10 text-cz-warning border border-cz-warning/20">
                {t("injuryRisk")}
              </span>
            )}
          </div>
        </td>
        )}

        {/* Individuel ugeplan — egen kolonne (rework af #3300, ejer-feedback: knappen
            der åbner rytterens egen ugeplan skal ikke ligge i navne-cellen, men have
            sin egen kolonne, ligesom akademi-badgen ovenfor). Ingen `hidden sm:table-
            cell` — skal virke på mobil ligesom badges-kolonnen. */}
        {showRosterCol("weekplan") && (
        <td className={`${tdClass({})} ${rosterMobileWrapAlign}`}>
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={() => toggleRiderWeekPlan(rider.id)}
              className="text-3xs text-cz-3 hover:text-cz-accent underline decoration-dotted whitespace-nowrap"
            >
              {isExpanded ? t("individualWeekPlanToggleClose") : t("individualWeekPlanToggleOpen")}
            </button>
            {/* #1895 PR 2: markering for ryttere med egen ugeplan-override, så man
                kan se hvem der kører sit eget program uden at åbne panelet. */}
            {hasOwnWeekPlan && (
              <span
                className="inline-block text-3xs px-1.5 py-0.5 rounded-cz-pill border bg-cz-accent/10 text-cz-accent border-cz-accent/30"
                title={t("individualWeekPlanBadgeTitle")}
              >
                {t("individualWeekPlanBadge")}
              </span>
            )}
          </div>
        </td>
        )}
      </tr>

      {/* #1895 PR 2: individuel ugeplan-flade — udvidet inline-række under rytteren.
          Rører ALDRIG fokus; overstyrer KUN holdets ugerytme for netop denne rytter. */}
      {isExpanded && (
        <tr className="bg-cz-subtle/40">
          <td colSpan={rosterColSpan} className="border-t border-cz-border px-4 py-3">
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-cz-3 leading-relaxed">
                {t("individualWeekPlanIntro", { name: `${rider.firstname} ${rider.lastname}` })}
              </p>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_KEYS.map((weekday) => {
                  const current = riderWeekDraftFor(rider.id)[weekday]?.intensity ?? "normal";
                  return (
                    <div key={weekday} className="flex flex-col items-center gap-1">
                      <span className="font-data text-3xs uppercase tracking-[.05em] text-cz-3">{t(`weekday_${weekday}`)}</span>
                      <div className="w-[92px]">
                        <Select
                          size="sm"
                          value={current}
                          disabled={savingRiderPlan}
                          aria-label={`${t("individualWeekPlanTitle")} — ${t(`weekday_${weekday}`)} — ${rider.firstname} ${rider.lastname}`}
                          onChange={(e) => setRiderWeekDraftDay(rider.id, weekday, e.target.value)}
                        >
                          {TRAINING_INTENSITIES.map((k) => (
                            <option key={k} value={k}>{tRider(`training.intensity_${k}`)}</option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleSaveRiderWeekPlan(rider.id)}
                  disabled={savingRiderPlan}
                >
                  {savingRiderPlan ? t("loading") : t("individualWeekPlanSave")}
                </Button>
                {hasOwnWeekPlan && (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => handleRemoveRiderWeekPlan(rider.id)}
                    disabled={savingRiderPlan}
                  >
                    {t("individualWeekPlanRemove")}
                  </Button>
                )}
                {riderWeekMsgMap[rider.id] && (
                  <span className={`text-xs ${riderWeekMsgMap[rider.id].type === "ok" ? "text-cz-success" : "text-cz-danger"}`}>
                    {riderWeekMsgMap[rider.id].text}
                  </span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
      </Fragment>
    );
  }

  function handleBulkApply() {
    return applyBulkChoice(bulkDay);
  }

  // #5620/#5485: telefonens "Rest"-knap er den samme mængde-sti som "Apply to N"
  // med valget "rest" (bulkChoiceToDay → setPlanBulk). Returnerer true når alle
  // valgte fik dagen, så telefonen kan forlade markerings-tilstanden.
  async function applyBulkChoice(choice) {
    setBulkMsg(null);
    if (!choice) {
      setBulkMsg({ type: "warn", text: t("bulkPickFocus") });
      return false;
    }
    // #5485: "Apply to N" rammer aldrig en rytter der ikke står i filtret,
    // heller ikke i det øjeblik før markeringen er skåret ned (effekten nedenfor).
    const ids = [...pruneSelection(selected, filterIds)];
    if (ids.length === 0) return false;
    const { dayType, session } = bulkChoiceToDay(choice);
    const result = await setPlanBulk(ids, dayType, session);
    // #1894 variant 3: smart-mode springer ryttere MED eksisterende plan over
    // (server-håndhævet — overskriver ALDRIG en managers eget valg). Det er en
    // forventet, ikke-fejlende delmængde, så den vises separat fra "failed".
    const skippedHasPlan = result.skippedHasPlan ?? [];
    if (result.failed.length === 0) {
      const text = skippedHasPlan.length > 0
        ? `${t("bulkApplied", { n: result.applied })} ${t("bulkSmartSkippedHasPlan", { n: skippedHasPlan.length })}`
        : t("bulkApplied", { n: result.applied });
      setBulkMsg({ type: skippedHasPlan.length > 0 ? "partial" : "ok", text });
      setSelected(new Set());
      return true;
    }
    setBulkMsg({
      type: "partial",
      text: t("bulkPartial", { applied: result.applied, total: ids.length, failed: result.failed.length }),
    });
    // Behold de fejlede valgte, så brugeren kan prøve igen.
    setSelected(new Set(result.failed.map((f) => f.riderId)));
    return false;
  }

  // #4522: assistent-forslagene til panelet. Ren afledning af data siden
  // allerede har (riders + planFor + smartDefaultFocus) — se
  // lib/assistantTrainingSuggestions.js for logikken (unit-testet).
  const assistantSuggestionRows = useMemo(
    () => buildAssistantSuggestions({ riders, smartDefaultFocusByRider: smartDefaultFocus, planFor }),
    [riders, smartDefaultFocus, planFor],
  );
  const assistantNoPlanCount = useMemo(
    () => countSuggestionsWithoutPlan(assistantSuggestionRows),
    [assistantSuggestionRows],
  );
  const assistantVisibleRows = useMemo(
    () => filterAssistantSuggestions(assistantSuggestionRows, assistantOnlyNoPlan),
    [assistantSuggestionRows, assistantOnlyNoPlan],
  );
  // #4699: DE eneste id'er accept-kaldet må sende. Smart-bulk springer server-
  // side hver rytter med en egen plan over (§9.3), så et valg der indeholder
  // dem skriver 0 rækker — panelets checkboxe, tælleren og "Accept all" læser
  // alle det HER sæt, så UI og server-kontrakt ikke kan komme ud af sync.
  const assistantAcceptableIds = useMemo(
    () => new Set(acceptableSuggestionIds(assistantVisibleRows)),
    [assistantVisibleRows],
  );

  function handleToggleAssistantOnlyNoPlan(checked) {
    setAssistantOnlyNoPlan(checked);
    // Nulstil valget ved filter-skift — undgår at "Accept selected" tæller
    // ryttere der netop blev filtreret ud af synet.
    setAssistantSelected(new Set());
  }
  function toggleAssistantSelect(riderId) {
    // Kan serveren ikke skrive rytteren, må han ikke kunne vælges (#4699).
    if (!assistantAcceptableIds.has(riderId)) return;
    setAssistantSelected((prev) => {
      const next = new Set(prev);
      if (next.has(riderId)) next.delete(riderId);
      else next.add(riderId);
      return next;
    });
  }

  // Accept skriver via DEN EKSISTERENDE smart-bulk-sti (setPlanBulk med
  // session="smart") — nøjagtig samme kald som roster-værktøjslinjens "Smart
  // focus"-bulk-valg (handleBulkApply ovenfor). Serveren springer ryttere med
  // en eksisterende plan over uanset hvad panelet viste (§9.3,
  // docs/ASSISTANT_RULES.md) — INTET assistent-forslag overskriver en
  // managers eget valg.
  async function applyAssistantSuggestions(ids) {
    setAssistantMsg(null);
    if (ids.length === 0) return;
    const result = await setPlanBulk(ids, "training", "smart");
    const skippedHasPlan = result.skippedHasPlan ?? [];
    if (result.failed.length === 0) {
      const text = skippedHasPlan.length > 0
        ? `${t("bulkApplied", { n: result.applied })} ${t("bulkSmartSkippedHasPlan", { n: skippedHasPlan.length })}`
        : t("bulkApplied", { n: result.applied });
      setAssistantMsg({ type: skippedHasPlan.length > 0 ? "partial" : "ok", text });
      setAssistantSelected(new Set());
    } else {
      setAssistantMsg({
        type: "partial",
        text: t("bulkPartial", { applied: result.applied, total: ids.length, failed: result.failed.length }),
      });
      setAssistantSelected(new Set(result.failed.map((f) => f.riderId)));
    }
  }
  function handleAcceptAssistantSelected() {
    // Dobbelt-sikring: et valg kan være blevet uacceptabelt siden det blev
    // sat (fx fordi rytteren fik en plan i en anden fane).
    applyAssistantSuggestions(acceptableSelectionIds(assistantSelected, assistantVisibleRows));
  }
  function handleAcceptAssistantAll() {
    // #4699: "Accept all" = alle ACCEPTABLE synlige rækker, ikke alle synlige.
    // Før sendte den også ryttere med managerens egen plan, som serveren
    // springer over, så et fuldt planlagt hold fik "Updated 0 riders".
    applyAssistantSuggestions([...assistantAcceptableIds]);
  }

  // ── #5485: dagens model, delt af desktop-tabellen, telefonen og overblikket ──
  //
  // Løbsdags-modellen kører ikke i prod endnu (`training_tick_per_race_day` er
  // OFF), og API'et leverer ikke et antal løbsdage pr. dato. Uden tal giver
  // `buildRaceDayColumns` PRÆCIS én kolonne ("Today"); den samme tabel bærer
  // 1-5 kolonner den dag tallet kommer. Intet hårdkodet sæson-tal.
  const raceDayColumns = buildRaceDayColumns({ settled: !!todayRun });

  // Løb slår træning: på en løbsdag kører rytteren ét løb ELLER træner
  // (realisme-reglen, ejer 18/9). `racingToday` findes kun bag
  // race_day_development_enabled; uden feltet racer ingen.
  const racingFor = (riderId, column) =>
    racingToday[riderId] != null && (raceDayColumns.length === 1 || column.state === "now");
  const racingTodayFor = (riderId) => racingToday[riderId] != null;

  const sessionFor = (riderId, column) => {
    if (racingFor(riderId, column)) return null;
    // En AFREGNET løbsdag viser hvad rytteren FAKTISK kørte (rapport-rækken),
    // ikke hvad planen står på nu: planen kan ændres efter dagens kørsel og
    // gælder så fra i morgen (tickModelDone).
    const plan = column.state === "done" ? todayRowByRider[riderId] ?? null : planFor(riderId);
    if (!plan?.focus) return null;
    const dayType = dayTypeForProgram(plan);
    if (DAY_TYPES_WITHOUT_SESSION.includes(dayType)) return dayType;
    return sessionForProgram(plan);
  };

  // A1 (ejer-go 23/9): cellen viser dagtypen i kort form (Race/Thresh/Recov/…),
  // samme etiketter som telefonens tabel, så de to flader ikke siger det samme
  // på to måder.
  const cellFor = (riderId, column) => {
    if (racingFor(riderId, column)) {
      return { label: t("mobile.raceShort"), tone: "race", title: racingToday[riderId]?.race ?? undefined };
    }
    const session = sessionFor(riderId, column);
    if (!session) return { label: t("mobile.noDay"), tone: "off" };
    if (session === "rest") return { label: t("mobile.sessionShort_rest"), tone: "off" };
    const label = t([`mobile.sessionShort_${session}`, `dayPanel.session_${session}`]);
    const full = t(`dayPanel.session_${session}`, { defaultValue: label });
    return { label, tone: "session", title: full };
  };

  // Overblikket (aendring 1). Samme riders/planFor/condition som resten af
  // siden; ingen nye kald.
  const overview = buildOverview({
    riderIds: riders.map((r) => r.id),
    hasDay: (id) => !!planFor(id)?.focus,
    isRacing: racingTodayFor,
    dayType: (id) => {
      const plan = planFor(id);
      return plan?.focus ? dayTypeForProgram(plan) : null;
    },
    fatigue: (id) => condition[id]?.fatigue ?? null,
  });
  const riderByIdMap = new Map(riders.map((r) => [r.id, r]));
  const namesLine = (ids, max = 3) => {
    const names = ids.slice(0, max).map((id) => riderByIdMap.get(id)?.lastname ?? "").filter(Boolean);
    const rest = ids.length - names.length;
    return rest > 0 ? `${names.join(", ")} ${t("overview.more", { n: rest })}` : names.join(", ");
  };
  const raceNames = [...new Set(overview.racing.map((id) => racingToday[id]?.race).filter(Boolean))];
  const overviewCells = [
    {
      key: "needsDay",
      label: t("overview.needsDay"),
      shortLabel: t("overview.needsDayShort"),
      count: overview.needsDay.length,
      context: namesLine(overview.needsDay),
      warn: true,
    },
    {
      key: "racing",
      label: t("overview.racing"),
      shortLabel: t("overview.racingShort"),
      count: overview.racing.length,
      context: raceNames.slice(0, 2).join(" · "),
    },
    {
      key: "training",
      label: t("overview.training"),
      shortLabel: t("overview.trainingShort"),
      count: overview.training.length,
      context: overview.resting + overview.recovering > 0
        ? t("overview.restRecovery", { rest: overview.resting, recovery: overview.recovering })
        : null,
    },
    {
      key: "tired",
      label: t("overview.tired", { from: TIRED_FATIGUE_FROM }),
      shortLabel: t("overview.tiredShort"),
      count: overview.tired.length,
      context: namesLine(overview.tired, 2),
      warn: true,
    },
  ];
  const filterIds = idsForFilter(overview, overviewFilter);
  // Filtrets ryttere: dem markeringen og "Apply to N" må ramme.
  const selectableRiders = filterIds ? riders.filter((r) => filterIds.has(r.id)) : riders;
  // Rækkerne tabellen viser: filtrets ryttere + dem hvis dag lige er gemt
  // (vises ca. 2 sekunder endnu med "Saved", se lingerAfterSave).
  const visibleIds = visibleIdsFor(filterIds, lingerIds);
  const visibleRiders = visibleIds ? riders.filter((r) => visibleIds.has(r.id)) : riders;
  const allSelected = selectableRiders.length > 0 && selectableRiders.every((r) => selected.has(r.id));

  // #5485 (rettet 23/9): markeringen skæres ned til filtrets ryttere, både ved
  // filterskift OG når en rytter forsvinder fra filtret fordi han har fået en
  // dag (hans egen vælger, "Use assistant pick", dagspanelet eller en mængde-
  // handling). Nøglen er filtrets indhold som tekst, så effekten kun kører når
  // indholdet faktisk skifter, ikke ved hver render.
  const filterKey = filterIds ? [...filterIds].sort().join("|") : null;
  useEffect(() => {
    if (filterKey === null) return;
    const keep = new Set(filterKey ? filterKey.split("|") : []);
    setSelected((prev) => {
      const next = pruneSelection(prev, keep);
      return next.size === prev.size ? prev : next;
    });
  }, [filterKey]);

  // Et tryk på en overbliks-celle filtrerer tabellen; et tryk mere viser alle.
  // En rytter der forsvinder fra tabellen, må ikke blive ved med at være valgt
  // til mængde-handlingen i værktøjslinjen (effekten ovenfor).
  function toggleOverviewFilter(key) {
    setOverviewFilter(overviewFilter === key ? null : key);
  }
  const activeFilterLabel = overviewFilter ? overviewCells.find((c) => c.key === overviewFilter)?.label : null;

  // A2 (ejer-go 23/9): EN guld-knap der skifter med situationen og aldrig står
  // grå. #3643/PR #5552: dayClose-gaten gælder på alle flader og bor derfor i
  // primaryActionFor, ét sted.
  const primaryAction = primaryActionFor({
    needsDay: overview.needsDay.length,
    trainedToday: !!todayRun,
    enabled,
    dayClose,
  });
  const runnable = canRunToday({ trainedToday: !!todayRun, enabled, dayClose });
  // #2819/#5485: turens trin 2 peger på det tryk der KØRER dagen (se
  // getTrainingTourSteps). Ét anker ad gangen: guld-knappen, "Run now" eller
  // statuslinjen.
  const tourTarget = tourRunTarget(primaryAction, runnable);
  const trainingTourSteps = useTrainingTourSteps(t, tourTarget, dayClose != null);
  const selectedCount = pruneSelection(selected, filterIds).size;
  const runTodayLabel = running ? t("loading") : (dayClose ? t("runDayNow") : t("trainToday"));
  const primaryLabel = primaryAction.kind === "setDays"
    ? t("primary.setDays", { n: primaryAction.riders })
    : runTodayLabel;

  // "Set days for N riders": filtrér til dem der mangler en dag. På desktop
  // markeres de også, så værktøjslinjen over rækkerne straks tilbyder at sætte
  // én dag for dem alle (aendring 5). På telefonen (ingen markering) åbner
  // dagspanelet for den første af dem.
  function handleSetDays() {
    setTab("today");
    setOverviewFilter("needsDay");
    setBulkMsg(null);
    if (phoneLayout && mobileTable) {
      const first = sortRoster(riders).find((r) => overview.needsDay.includes(r.id));
      if (first) setFocusPanelRiderId(first.id);
      return;
    }
    setSelected(new Set(overview.needsDay));
  }
  function handlePrimary() {
    if (primaryAction.kind === "setDays") handleSetDays();
    else if (primaryAction.kind === "run") handleRunToday();
  }

  // Een dagsvælger (aendring 4): valget gemmes med det samme via den samme
  // mutation som dagspanelet og mængde-vælgeren (bulkChoiceToDay → setPlan).
  async function handleDayChoice(riderId, choice) {
    const { dayType, session } = bulkChoiceToDay(choice);
    return handlePlanChange(riderId, dayType, session);
  }

  // Dagens status-linje (overblikkets femte celle).
  const todayStatusText = todayRun
    ? trainedTodayLabel()
    : !enabled
      ? t("overview.statusPaused")
      : dayClose && !dayClose.open
        ? t("overview.statusWaiting", { hour: dayClose.opensAtHour ?? 20 })
        : dayClose
          ? t("overview.statusReady")
          : t("overview.statusNotYet");

  // #2819: tourens trin 3 peger på fremgangen pr. evne, som nu bor i rytterens
  // kort. Kører touren, folder desktop den øverste rytter ud ÉN gang, præcis
  // som telefonen gør (openFirstForTour).
  const didOpenForTour = useRef(false);
  useEffect(() => {
    if (!tourActiveAtMount || didOpenForTour.current || phoneLayout || riders.length === 0) return;
    didOpenForTour.current = true;
    setOpenRiderId(riders[0].id);
  }, [tourActiveAtMount, phoneLayout, riders]);

  // Rytterens ugeplan + profil-linket, inde i kortet (A3). Clarity: klik på
  // navnet sendte spilleren ud på profilen og straks tilbage (quickbacks).
  function riderCardFooter(riderId) {
    const rider = riderByIdMap.get(riderId);
    if (!rider) return null;
    const hasOwn = riderWeekPlans[riderId] != null;
    const injury = injuryTimeLeft(condition[riderId], today);
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="font-data text-3xs font-semibold uppercase tracking-[.09em] text-cz-3">{t("card.weekPlan")}</div>
          <div className="text-[13px] text-cz-1">{hasOwn ? t("card.ownPlan") : t("card.followsTeam")}</div>
          <button
            type="button"
            onClick={() => { setWeekPlanFor(riderId); setTab("weekplan"); }}
            className="mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium text-cz-accent-t hover:underline"
          >
            {hasOwn ? t("card.editOwnPlan") : t("card.giveOwnPlan")}
            <ChevronRightIcon size={12} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <RiderBadges badges={[
            rider.is_academy && "academy",
            !rider.is_academy && retirementRiskBadgeKey(rider, seasonYear),
            !rider.is_academy && contractExpiringBadgeKey(rider, activeSeasonNumber),
            injury.count > 0 && "injured",
          ]} />
        </div>
        <RiderLink id={riderId} className="inline-flex min-h-11 items-center gap-0.5 text-xs font-medium text-cz-accent-t hover:underline">
          {t("card.profile")}
          <ChevronRightIcon size={12} aria-hidden="true" />
        </RiderLink>
      </div>
    );
  }

  function receiptRowsFor(riderId) {
    const rider = riderByIdMap.get(riderId);
    if (!rider) return null;
    return focusAbilityReceipt(planFor(riderId)?.focus, {
      abilities: rider.abilities,
      progress: progress[riderId],
      capped: capped[riderId],
      seasonGains: seasonGainsByRider[riderId] ?? null,
      progressBefore: todayRowByRider[riderId]?.progress_before ?? null,
      gainsToday: todayRowByRider[riderId]?.gains ?? null,
    });
  }
  function seasonPointsFor(riderId) {
    const gains = seasonGainsByRider[riderId];
    if (!gains) return null;
    return Object.values(gains).reduce((sum, n) => sum + (Number(n) > 0 ? Number(n) : 0), 0);
  }
  const seasonDaysElapsed = history.seasonState === SEASON_RECEIPT_RUNNING ? (history.seasonRuns?.length ?? null) : null;
  function riderTypeLine(rider) {
    if (!rider?.primary_type) return null;
    return rider.secondary_type && rider.secondary_type !== rider.primary_type
      ? `${tTypes(`types.${rider.primary_type}`)}/${tTypes(`types.${rider.secondary_type}`)}`
      : tTypes(`types.${rider.primary_type}`);
  }

  // Desktop-kortet (A3): den samme komponent som telefonens låste variant
  // (#5458), foldet ud lige under rækken.
  function renderRiderCard(riderId, detailId) {
    const rider = riderByIdMap.get(riderId);
    if (!rider) return null;
    const cond = condition[riderId] ?? {};
    const injury = injuryTimeLeft(cond, today);
    const injuryMsg = injury.count > 0 ? injuryBadgeMessage(injury) : null;
    const riderScore = scoreVisible ? trainingScore?.[riderId] ?? null : null;
    const age = ageForSeason(rider.birthdate, seasonYear);
    return (
      <div className="max-w-[880px] overflow-hidden rounded-cz border border-cz-border">
        <TrainingMobileRiderCard
          id={detailId}
          name={`${rider.firstname} ${rider.lastname}`}
          meta={[riderTypeLine(rider), age != null ? `${t("colAge")} ${age}` : null].filter(Boolean).join(" · ")}
          form={cond.form ?? null}
          fatigue={cond.fatigue ?? null}
          injuryLabel={injuryMsg ? t(injuryMsg.key, { days: injuryMsg.days, ...(injuryMsg.date ? { date: formatDate(injuryMsg.date, "short") } : {}) }) : null}
          dayLabel={planFor(riderId)?.focus ? dayLabel(planFor(riderId), t) : t("dayPanel.chooseDay")}
          receiptRows={receiptRowsFor(riderId)}
          countsFor={countsForRole(DISPLAY_RECIPES, rider.primary_type, rider, capped[riderId] ?? [])}
          roleLabel={rider.primary_type ? tTypes(`types.${rider.primary_type}`) : null}
          pacePerWeek={pacePerWeek({ gainedPoints: seasonPointsFor(riderId), daysElapsed: seasonDaysElapsed })}
          seasonPoints={seasonPointsFor(riderId)}
          onChangeDay={() => setFocusPanelRiderId(riderId)}
          changeDisabled={savingId === riderId || bulkApplying}
          changeLabel={t("card.changeDay")}
          score={scoreVisible ? scoreCellFor(riderId) : null}
          scoreSpark={riderScore?.spark ? [...riderScore.spark] : null}
          scoreAria={t("score.sparkAria", { name: `${rider.firstname} ${rider.lastname}` })}
          footer={riderCardFooter(riderId)}
        />
      </div>
    );
  }

  // ── #3643: I dag-fanen på telefonen ────────────────────────────────────────
  //
  // Ejer-valg 18/9 (låst): mockup 2, tabel. Rækker er ryttere, kolonner er
  // dagens løbsdage. Ejer-beslutning 21/9 (variant A): den rytter man trykker
  // på får sit fulde kort foldet ud LIGE UNDER sig selv, inde i listen — ikke
  // under hele tabellen (beta-feedback 19/9, 201 px scroll ved rytter nr. 6).
  // Alt herunder er PRÆSENTATION: hver callback peger på den samme state og de
  // samme mutationer som desktop-fladen bruger.
  //
  // Løbsdags-modellen kører ikke i prod endnu (`training_tick_per_race_day` er
  // OFF, se docs/TRAINING_RULES.md §13.3), og API'et leverer derfor ikke et
  // antal løbsdage pr. dato. `buildRaceDayColumns` uden tal giver PRÆCIS én
  // kolonne ("I dag"), og den samme tabel bærer 1-5 kolonner den dag tallet
  // kommer. Der står aldrig et hårdkodet sæson-tal på fladen.
  // #5620/#5485 (spillerfund 24/9): hurtig hvile på telefonen. "Select riders"
  // slår markerings-tilstanden til; et tryk på en række markerer rytteren, og
  // "Rest" eller en anden dag sættes for alle valgte på én gang, samme mængde-
  // sti som desktoppens værktøjslinje. Ingen guld her: sidens ene guld-knap er
  // stadig primaryAction.
  function startMobilePick() {
    setMobileRiderId(null);
    setSelected(new Set());
    setBulkMsg(null);
    setMobilePickMode(true);
  }
  function endMobilePick() {
    setMobilePickMode(false);
    setSelected(new Set());
  }
  async function applyMobileBulk(choice) {
    const ok = await applyBulkChoice(choice);
    if (ok) setMobilePickMode(false);
  }

  function renderMobileBulkBar() {
    // Uden markering står indgangen ("Select riders") i assistent-rækken; her
    // vises kun en evt. besked fra sidste mængde-handling.
    if (!mobilePickMode) {
      return bulkMsgNode ? <div data-testid="training-mobile-bulk-bar">{bulkMsgNode}</div> : null;
    }
    return (
      <div data-testid="training-mobile-bulk-bar" className="flex flex-wrap items-center gap-2">
        {(
          <>
            <div className="flex w-full items-center justify-between gap-2">
              <span className="min-w-0 text-[13px] font-semibold tabular-nums text-cz-1">
                {selectedCount > 0 ? t("selected", { n: selectedCount }) : t("mobile.pickHint")}
              </span>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 flex-none" onClick={endMobilePick} disabled={bulkApplying}>
                {t("mobile.selectDone")}
              </Button>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11"
              onClick={() => applyMobileBulk("rest")}
              disabled={bulkApplying || selectedCount === 0}
            >
              {bulkApplying ? t("bulkApplying") : t("mobile.restSelected")}
            </Button>
            <div className="min-w-0 flex-1 basis-36">
              <Select
                size="sm"
                value={bulkDay}
                disabled={bulkApplying}
                aria-label={t("dayPanel.bulkSetDay")}
                onChange={(e) => setBulkDay(e.target.value)}
              >
                {renderBulkDayOptions()}
              </Select>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11"
              onClick={() => applyMobileBulk(bulkDay)}
              disabled={bulkApplying || selectedCount === 0 || !bulkDay}
            >
              {t("today.applyTo", { n: selectedCount })}
            </Button>
          </>
        )}
        {bulkMsgNode}
      </div>
    );
  }

  function renderMobileToday() {
    const columns = raceDayColumns;
    // #5485: overblikkets filter gælder også telefonens tabel.
    const rows = sortRoster(visibleRiders);
    const seasonDays = seasonDaysElapsed;
    const riderById = riderByIdMap;

    return (
      <div className="space-y-3">
        {runError && <p className="text-sm text-cz-danger">{runError}</p>}
        {ridersLoading ? (
          <div className={WRAP}>
            <div className="p-5"><SkeletonLines lines={12} /></div>
          </div>
        ) : riders.length === 0 ? (
          <EmptyState icon={<TeamIcon size={26} aria-hidden="true" />} title={t("noRiders")} />
        ) : (
          <TrainingMobileToday
            riders={rows}
            columns={columns}
            picked={mobilePickMode ? selected : null}
            onTogglePick={toggleSelect}
            bulkSlot={renderMobileBulkBar()}
            selectedRiderId={mobileRiderId}
            // Tryk på den samme rytter igen LUKKER kortet; tryk på en anden
            // flytter det. Der er højst ét åbent kort ad gangen.
            onSelectRider={(riderId) => setMobileRiderId((prev) => (prev === riderId ? null : riderId))}
            openFirstForTour={tourActiveAtMount}
            // #4851: samme kilde som desktop-kolonnen. `null` naar
            // training_score_visible er off ⇒ hverken kolonnen eller blokken i
            // kortet findes paa telefonen, praecis som paa desktop.
            scoreFor={scoreVisible ? (riderId) => trainingScore?.[riderId] ?? null : null}
            scoreSettled={scoreSettled}
            conditionFor={(riderId) => condition[riderId] ?? null}
            ageFor={(riderId) => ageForSeason(riderById.get(riderId)?.birthdate, seasonYear)}
            isRacing={racingFor}
            raceNameFor={(riderId) => racingToday[riderId]?.race ?? null}
            // Samme sessionFor som desktop-tabellen (se #5485-blokken ovenfor):
            // en AFREGNET løbsdag viser hvad rytteren faktisk kørte.
            sessionFor={sessionFor}
            dayLabelFor={(riderId) => {
              const plan = planFor(riderId);
              return plan?.focus ? dayLabel(plan, t) : t("dayPanel.chooseDay");
            }}
            receiptFor={receiptRowsFor}
            // Rytteren er allerede fladet op (flattenAbilities i hentningen), så
            // opskriftens evne-nøgler kan slås direkte op på rytter-objektet.
            abilitiesFor={(riderId) => riderById.get(riderId) ?? null}
            cappedFor={(riderId) => capped[riderId] ?? []}
            seasonPointsFor={seasonPointsFor}
            seasonDays={seasonDays}
            // #5485: sidens overblik står over fanerne, programmet bor i fanen
            // Week plan og gårsdagens kvittering i Report.
            overviewLayout
            cardFooterFor={riderCardFooter}
            changeLabel={t("card.changeDay")}
            weekdays={WEEKDAY_KEYS}
            intensityForWeekday={(weekday) => (activeWeekDays ?? flatWeekTemplate())[weekday]?.intensity ?? "normal"}
            onEditProgram={() => setTab("weekplan")}
            onOpenDay={(riderId) => setFocusPanelRiderId(riderId)}
            dayBusyFor={(riderId) => savingId === riderId || bulkApplying}
            yesterdaySlot={null}
            // #5805 (ejer 26/9): sorteringen står over tabellen, hvor spilleren
            // leder efter den, ikke under den (#5485 havde den nederst). Den
            // er én række høj, så tabellen rykker kun den ene række ned.
            // Assistenten står stadig i rækken under overblikket (assistantRow).
            sortSlot={
              <RosterMobileSortControl
                sort={rosterSort.sort}
                sortDir={rosterSort.sortDir}
                onSort={rosterSort.handleSort}
                scoreVisible={scoreVisible}
                t={t}
              />
            }
            assistantSlot={null}
          />
        )}
        <div className="pt-1">
          <Link
            to="/help?section=dailytraining"
            className="text-2xs text-cz-3 underline decoration-dotted hover:text-cz-accent"
          >
            {t("howTrainingWorksLink")}
          </Link>
        </div>
      </div>
    );
  }

  // ── #5485: sidens ene guld-knap (A2) ──────────────────────────────────────
  // Ingen knap når dagen er kørt eller ikke kan køres: så står statuslinjen
  // alene (sidehovedets undertitel + overblikkets femte celle). Mens
  // assistentens panel er åbent bærer dets "Accept selected" sidens gold
  // (#4522), så denne dæmpes til secondary.
  const overviewVariant = isShortLandscape && !isMobile ? "chips" : phoneLayout ? "compact" : "desktop";
  // Mens guld-knappen beder om dage, skal dagen stadig kunne køres. På desktop
  // står "Run now" i overblikkets statuscelle; telefonens overblik (compact og
  // chips) har ingen statuscelle, så knappen står dér ved siden af guld-knappen
  // i samme række (ingen ekstra højde, CodeRabbit på #5564).
  const runNowBesidePrimary = overviewVariant !== "desktop" && runnable && primaryAction.kind === "setDays";
  // #2819/#5485: tour-ankeret sidder på det tryk der KØRER dagen (tourTarget).
  // Wrapper-span frem for data-tour på <Button>, så ankeret overlever uanset om
  // Button videresender data-*.
  const tourAnchor = (target) => (tourTarget === target ? "training-run-today" : undefined);
  const primaryButton = primaryAction.kind === "none" ? null : (
    <span className={isMobile ? "mb-3 flex gap-2" : "inline-flex gap-2"}>
      <span data-tour={tourAnchor("primary")} className={isMobile ? "flex flex-1" : "inline-flex"}>
        <Button
          type="button"
          variant={assistantPanelOpen ? "secondary" : "primary"}
          size={isMobile ? "md" : "sm"}
          onClick={handlePrimary}
          // Kun optaget mens kørslen eller en mængde-ændring står på; ellers er
          // knappen aldrig grå (Clarity: den grå "Train today" var en af sidens
          // største kilder til døde klik).
          disabled={running || bulkApplying}
          // min-h-11 = #1602's 44px tryk-mål på telefonen.
          className={isMobile ? "min-h-11 flex-1" : ""}
          data-testid="training-primary"
        >
          {primaryLabel}
        </Button>
      </span>
      {runNowBesidePrimary && (
        <span data-tour={tourAnchor("runNow")} className="inline-flex flex-none">
          <Button
            type="button"
            variant="secondary"
            size={isMobile ? "md" : "sm"}
            iconLeft={<PlayIcon size={12} aria-hidden="true" />}
            onClick={handleRunToday}
            disabled={running || bulkApplying}
            className={isMobile ? "min-h-11 flex-none" : ""}
            data-testid="training-run-now"
          >
            {running ? t("loading") : t("overview.runNow")}
          </Button>
        </span>
      )}
    </span>
  );

  // Overblikkets femte celle: dagens status + en sekundær "Run now" mens
  // guld-knappen beder om dage, så dagen stadig kan køres uden at alle har en.
  // #5485 (rettet 23/9, #1936): er dagen kørt, siger cellen også at ændringer
  // nu gælder fra i morgen (tickModelDone i fuld længde som title).
  const overviewStatus = (
    <>
      <div className="min-w-0" data-tour={!phoneLayout ? tourAnchor("status") : undefined}>
        <div className="font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-3">{t("overview.status")}</div>
        <div className="mt-1.5 truncate text-[13px] text-cz-1" title={todayStatusText}>{todayStatusText}</div>
        {todayRun && (
          <div className="mt-0.5 truncate text-2xs text-cz-3" title={t("tickModelDone")} data-testid="training-tick-model-note">
            {t("overview.changesTomorrow")}
          </div>
        )}
      </div>
      {runnable && primaryAction.kind === "setDays" && (
        <span data-tour={tourAnchor("runNow")} className="inline-flex flex-none">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            iconLeft={<PlayIcon size={12} aria-hidden="true" />}
            onClick={handleRunToday}
            disabled={running}
            data-testid="training-run-now"
          >
            {running ? t("loading") : t("overview.runNow")}
          </Button>
        </span>
      )}
    </>
  );

  // #4522/#5485: assistentens forslags-panel. Samme panel på alle flader;
  // kun stedet det åbnes fra er forskelligt.
  const assistantPanel = assistantPanelOpen ? (
    <div ref={assistantPanelRef}>
      <AssistantSuggestionsPanel
        rows={assistantSuggestionRows}
        visibleRows={assistantVisibleRows}
        noPlanCount={assistantNoPlanCount}
        onlyWithoutPlan={assistantOnlyNoPlan}
        onToggleOnlyWithoutPlan={handleToggleAssistantOnlyNoPlan}
        selected={assistantSelected}
        onToggleSelect={toggleAssistantSelect}
        onAcceptSelected={handleAcceptAssistantSelected}
        onAcceptAll={handleAcceptAssistantAll}
        onDismiss={handleDismissAssistantPanel}
        busy={bulkApplying}
        message={assistantMsg}
        acceptableCount={assistantAcceptableIds.size}
      />
    </div>
  ) : null;

  // #5485 (ejer-go 23/9): på telefonen står assistenten som en række LIGE
  // under overblikkets fire tal, over tabellen, i begge telefon-visninger
  // (beta-tabellen og #5124's D-047-gren). Samme lukkede række med tælling som
  // mockup 2; trykket åbner det samme panel lige under rækken.
  const assistantRow = (
    <div className="space-y-3">
      {/* #5620/#5485: "Select riders" står i SAMME række som assistenten, så
          indgangen til hurtig hvile ikke skubber tabellen ned (mindst 8 ryttere
          på første skærm, 390 × 844). Kun telefonens tabel-visning. */}
      <div className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={handleOpenAssistantPanel}
        data-testid="training-assistant-row"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-cz border border-cz-border bg-cz-card px-3 text-start transition-colors hover:bg-cz-subtle"
      >
        <StarIcon size={16} className="flex-none text-cz-3" aria-hidden="true" />
        <span className="flex-1 text-[13px] font-semibold text-cz-1">{t("mobile.assistantTitle")}</span>
        <span className="font-data text-2xs tabular-nums text-cz-3">
          {t("mobile.assistantCount", { n: assistantSuggestionRows.length })}
        </span>
        <ChevronRightIcon size={14} className="flex-none text-cz-3" aria-hidden="true" />
      </button>
      {mobileTableView && activeTab === "today" && !mobilePickMode && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11 flex-none"
          onClick={startMobilePick}
          data-testid="training-mobile-select-riders"
        >
          {t("mobile.selectRiders")}
        </Button>
      )}
      </div>
      {assistantPanel}
    </div>
  );

  function renderBulkDayOptions() {
    return (
      <>
        <option value="">{t("dayPanel.bulkSetDay")}</option>
        <option value="smart">{t("bulkSmartFocusOption")}</option>
        <optgroup label={t("dayPanel.bulkWholeDay")}>
          <option value="rest">{t("dayPanel.dayType_rest")}</option>
          <option value="recovery">{t("dayPanel.dayType_recovery")}</option>
        </optgroup>
        {TRAINING_LEVELS.map((level) => (
          <optgroup key={level} label={`${t("dayPanel.dayType_training")} · ${t(`dayPanel.level_${level}`)}`}>
            {TRAINING_SESSIONS_BY_LEVEL[level].map((k) => (
              <option key={k} value={k}>{t(`dayPanel.session_${k}`)}</option>
            ))}
          </optgroup>
        ))}
        <optgroup label={t("dayPanel.dayType_skill")}>
          {SKILL_SESSIONS.map((k) => (
            <option key={k} value={k}>{t(`dayPanel.session_${k}`)}</option>
          ))}
        </optgroup>
      </>
    );
  }

  const bulkMsgNode = bulkMsg && (
    <span
      role="status"
      className={`text-xs ${bulkMsg.type === "ok" ? "text-cz-success" : bulkMsg.type === "partial" ? "text-cz-warning" : "text-cz-danger"}`}
    >
      {bulkMsg.text}
    </span>
  );

  // Rækkerne til desktop-tabellen. Type, alder og "egen plan" står i navnets
  // underlinje; resten af rytteren bor i kortet ét tryk væk (A3).
  function todayRowsFor(list) {
    return sortRoster(list).map((rider) => {
      const cond = condition[rider.id] ?? {};
      const age = ageForSeason(rider.birthdate, seasonYear);
      const cell = scoreVisible ? scoreCellFor(rider.id) : null;
      return {
        id: rider.id,
        name: `${rider.firstname} ${rider.lastname}`,
        sub: [
          riderTypeLine(rider),
          age != null ? String(age) : null,
          riderWeekPlans[rider.id] != null ? t("individualWeekPlanBadge") : null,
        ].filter(Boolean).join(" · "),
        form: cond.form ?? null,
        fatigue: cond.fatigue ?? null,
        tired: isTired(cond.fatigue),
        seasonPoints: seasonPointsFor(rider.id),
        noDay: !planFor(rider.id)?.focus && !racingTodayFor(rider.id),
        squad: rider.squad ?? null,
        score: cell
          ? {
              state: cell.state,
              value: cell.state === "score" || cell.state === "latest" ? cell.value : null,
              spark: trainingScore?.[rider.id]?.spark ?? null,
            }
          : null,
      };
    });
  }

  // Status der betyder noget FOR DAGEN (skade, høj skaderisiko) står under
  // navnet; akademi, kontrakt og pension står i kortet.
  function renderRowStatus(riderId) {
    const cond = condition[riderId] ?? {};
    const injury = injuryTimeLeft(cond, today);
    const injured = injury.count > 0;
    const highRisk = !injured && (cond.risk ?? 0) >= 0.05;
    if (!injured && !highRisk) return null;
    const msg = injured ? injuryBadgeMessage(injury, { compact: true }) : null;
    return (
      <div className="mb-1 flex flex-wrap gap-1">
        {injured && (
          <span
            className="rounded-cz-pill border border-cz-danger/30 bg-cz-danger-bg px-2 py-0.5 text-3xs text-cz-danger"
            title={injury.unit === "race_day" && injury.approxDate
              ? t("injuredApprox", { date: formatDate(injury.approxDate, "medium") })
              : undefined}
          >
            {t(msg.key, { days: msg.days })}
          </span>
        )}
        {highRisk && (
          <span className="rounded-cz-pill border border-cz-warning/20 bg-cz-warning/10 px-2 py-0.5 text-3xs text-cz-warning">
            {t("injuryRisk")}
          </span>
        )}
      </div>
    );
  }

  function renderNoDay(riderId) {
    const smart = smartDefaultFocus[riderId];
    const canUseSmart = smart && SESSION_INTENSITY[smart];
    return (
      <div className="flex items-center justify-between gap-2 rounded-cz border border-dashed border-cz-border bg-cz-warning-bg px-2.5 py-1 text-xs text-cz-warning">
        <span>{t("today.noDaySet")}</span>
        {canUseSmart && (
          <button
            type="button"
            disabled={savingId === riderId || bulkApplying}
            onClick={() => handleDayChoice(riderId, smart)}
            className="text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50"
          >
            {t("today.useAssistantPick", { session: t(`dayPanel.session_${smart}`) })}
          </button>
        )}
      </div>
    );
  }

  // ── #5485 (aendring 6): fanen Week plan ────────────────────────────────────
  // "Plan for: Team / rytter". Holdets plan bruger weekDraft/handleSaveWeekPlan
  // og rytterens egen plan riderWeekDraftMap/handleSaveRiderWeekPlan — samme
  // kladde/gem/nulstil som før, nu i ét gitter. #3643/PR #5552: den døde
  // "Go to roster"-knap er væk; rytterens plan åbnes her, på fanen selv.
  function renderWeekPlanTab() {
    const isTeam = weekPlanFor === "team" || !riderByIdMap.has(weekPlanFor);
    const key = isTeam ? "team" : weekPlanFor;
    const rider = isTeam ? null : riderByIdMap.get(key);
    const draft = isTeam ? (activeWeekDays ?? flatWeekTemplate()) : riderWeekDraftFor(key);
    const saved = isTeam ? (weekPlan ?? flatWeekTemplate()) : (riderWeekPlans[key] ?? flatWeekTemplate());
    const changed = WEEKDAY_KEYS.filter(
      (weekday) => (draft[weekday]?.intensity ?? "normal") !== (saved[weekday]?.intensity ?? "normal"),
    ).length;
    const options = [
      { value: "team", label: t("weekPlan.team", { n: riders.length }) },
      ...sortRows(riders, (r) => `${r.lastname ?? ""} ${r.firstname ?? ""}`, "asc").map((r) => ({
        value: r.id,
        label: `${r.firstname} ${r.lastname}${riderWeekPlans[r.id] != null ? ` · ${t("individualWeekPlanBadge")}` : ""}`,
      })),
    ];
    return (
      <TrainingWeekPlan
        weekdays={WEEKDAY_KEYS}
        todayWeekday={todayWeekday}
        columns={raceDayColumns}
        planFor={key}
        planForOptions={options}
        onPlanFor={setWeekPlanFor}
        intro={isTeam
          ? t("weekPlan.teamIntro")
          : t("individualWeekPlanIntro", { name: `${rider.firstname} ${rider.lastname}` })}
        intensities={TRAINING_INTENSITIES}
        intensityFor={(weekday) => draft[weekday]?.intensity ?? "normal"}
        onSetDay={(weekday, intensity) =>
          isTeam ? setWeekDraftDay(weekday, intensity) : setRiderWeekDraftDay(key, weekday, intensity)}
        changedCount={changed}
        saving={isTeam ? !!savingWeekPlan : savingRiderWeekPlanId === key}
        onSave={() => (isTeam ? handleSaveWeekPlan() : handleSaveRiderWeekPlan(key))}
        onUndo={() => {
          if (isTeam) setWeekDraft(null);
          else setRiderWeekDraftMap((prev) => { const next = { ...prev }; delete next[key]; return next; });
        }}
        resetLabel={isTeam
          ? (weekPlan ? t("weekRhythmResetButton") : null)
          : (riderWeekPlans[key] != null ? t("individualWeekPlanRemove") : null)}
        onReset={() => (isTeam ? handleResetWeekPlan() : handleRemoveRiderWeekPlan(key))}
        message={isTeam ? weekPlanMsg : riderWeekMsgMap[key] ?? null}
        ownPlans={ridersWithOwnWeekPlan.map((r) => ({
          id: r.id,
          name: `${r.firstname} ${r.lastname}`,
          summary: WEEKDAY_KEYS.map(
            (weekday) => `${t(`weekday_${weekday}`)} ${tRider(`training.intensity_${riderWeekPlans[r.id]?.[weekday]?.intensity ?? "normal"}`)}`,
          ).join(" · "),
        }))}
        onOpenOwnPlan={setWeekPlanFor}
      />
    );
  }

  // ── #5485: fanen Today på desktop ─────────────────────────────────────────
  function renderDesktopToday() {
    const groupsForTable = groupByType
      ? groupRidersByType(visibleRiders).map((group) => ({
          key: group.type,
          label: groupLabel(group.type),
          count: t("groupCount", { n: group.riders.length }),
          rows: todayRowsFor(group.riders),
        }))
      : null;
    const toolbar = (
      <>
        <div className="flex flex-wrap items-center gap-2.5">
          {selectedCount > 0 ? (
            <>
              <span className="text-[13px] font-semibold text-cz-1">{t("selected", { n: selectedCount })}</span>
              <div className="w-56">
                <Select
                  size="sm"
                  value={bulkDay}
                  disabled={bulkApplying}
                  aria-label={t("dayPanel.bulkSetDay")}
                  onChange={(e) => setBulkDay(e.target.value)}
                >
                  {renderBulkDayOptions()}
                </Select>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={handleBulkApply} disabled={bulkApplying}>
                {bulkApplying ? t("bulkApplying") : t("today.applyTo", { n: selectedCount })}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={clearSelection} disabled={bulkApplying}>
                {t("today.clear")}
              </Button>
            </>
          ) : activeFilterLabel ? (
            <>
              <span className="text-[13px] text-cz-2">{t("overview.showing", { label: activeFilterLabel })}</span>
              <button type="button" onClick={() => setOverviewFilter(null)} className="text-xs font-medium text-cz-accent-t hover:underline">
                {t("overview.showAll")}
              </button>
            </>
          ) : (
            <span className="font-data text-xs text-cz-3">{t("today.count", { n: riders.length })}</span>
          )}
          {bulkMsgNode}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <RosterMobileSortControl
            inline
            sort={rosterSort.sort}
            sortDir={rosterSort.sortDir}
            onSort={rosterSort.handleSort}
            scoreVisible={scoreVisible}
            t={t}
          />
          <Checkbox checked={groupByType} onChange={(e) => setGroupByType(e.target.checked)} label={t("groupByType")} />
          {/* #4522: assistentens forslag — flyttet fra sidehovedet til
              tabellens værktøjslinje (en tabel-handling, ikke sidens).
              #5485 (ejer-go 23/9): en rigtig sekundær knap med ramme, ikke et
              tekst-link. Sidens ene gold er stadig guld-knappen. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            iconLeft={<StarIcon size={13} aria-hidden="true" />}
            onClick={handleOpenAssistantPanel}
            data-testid="training-assistant-button"
          >
            {t("assistantSuggestions.openButton")}
          </Button>
          <Link
            to="/help?section=dailytraining"
            className="whitespace-nowrap text-2xs text-cz-3 underline decoration-dotted hover:text-cz-accent"
          >
            {t("howTrainingWorksLink")}
          </Link>
        </div>
      </>
    );

    return (
      <div className="space-y-3">
        {assistantPanel}
        {runError && <p className="text-sm text-cz-danger">{runError}</p>}
        {(history.seasonState === SEASON_RECEIPT_NOT_STARTED || history.seasonState === SEASON_RECEIPT_NO_DAYS) && history.seasonStart && (
          <p className="text-2xs leading-snug text-cz-3">
            {t(SEASON_RECEIPT_NOTE_KEY[history.seasonState], { date: formatDate(history.seasonStart) })}
          </p>
        )}
        {ridersLoading ? (
          <div className={WRAP}>
            <div className="p-5">
              <SkeletonLines lines={18} />
            </div>
          </div>
        ) : riders.length === 0 ? (
          <EmptyState icon={<TeamIcon size={26} aria-hidden="true" />} title={t("noRiders")} />
        ) : (
          <div ref={rosterTableRef}>
            <TrainingTodayTable
              rows={groupsForTable ? [] : todayRowsFor(visibleRiders)}
              groups={groupsForTable}
              columns={raceDayColumns}
              cellFor={cellFor}
              showScore={scoreVisible}
              sort={rosterSort.sort}
              sortDir={rosterSort.sortDir}
              onSort={rosterSort.handleSort}
              selected={selected}
              allSelected={allSelected}
              onToggleSelect={toggleSelect}
              onToggleAll={toggleSelectAll}
              openId={openRiderId}
              onToggleOpen={(riderId) => setOpenRiderId((prev) => (prev === riderId ? null : riderId))}
              renderDay={(riderId, isFirst) => {
                const rider = riderByIdMap.get(riderId);
                return (
                  <TrainingDaySelect
                    riderName={rider ? `${rider.firstname} ${rider.lastname}` : ""}
                    plan={planFor(riderId)}
                    busy={savingId === riderId || bulkApplying}
                    error={planActionError?.riderId === riderId ? planActionError.error : null}
                    onChoose={(choice) => handleDayChoice(riderId, choice)}
                    dataTour={isFirst ? "training-focus" : undefined}
                    justSaved={lingerIds.has(riderId)}
                  />
                );
              }}
              renderDetail={renderRiderCard}
              renderStatus={renderRowStatus}
              renderNoDay={renderNoDay}
              toolbar={toolbar}
              empty={visibleRiders.length === 0 ? <p className="text-sm text-cz-3">{t("overview.emptyFiltered")}</p> : null}
            />
          </div>
        )}
        {!ridersLoading && riders.length > 0 && (
          <div className={COUNT}>{t("groupCount", { n: visibleRiders.length })}</div>
        )}
      </div>
    );
  }

  // Sidehoved-status (T2 PageHeader subtitle) — samme 3 tilstande som før, nu i
  // ÉT sted i stedet for inline i JSX'en. Ren tekst/farve-mapping, ingen ny logik.
  // #5485 (rettet 23/9, #1936): telefonen har ingen statuscelle i overblikket,
  // så sidehovedets statuslinje siger på telefonen også at ændringer nu gælder
  // fra i morgen (tickModelDone i fuld længde som title). Desktop har samme
  // linje i overblikkets statuscelle.
  const headerStatus = todayRun
    ? (
      <>
        <span className="text-cz-success font-medium">{trainedTodayLabel()}</span>
        {phoneLayout && (
          <span className="block text-cz-3" title={t("tickModelDone")} data-testid="training-tick-model-note">
            {t("overview.changesTomorrow")}
          </span>
        )}
      </>
    )
    : !enabled
      ? <span className="italic">{t("disabledNote")}</span>
      // #4847: naar loebsdags-ticket er on, koerer programmet af sig selv naar dagens
      // sidste loeb er lukket. Én KORT linje paa fladen; prosaen bor i help.json
      // (feedback "kort paa fladen, manualer i Hjaelp", ejer 20/8).
      : dayClose && !dayClose.open
        ? t("dayClose.waiting", { hour: dayClose.opensAtHour ?? 20 })
        : dayClose
          ? t("dayClose.ready")
          : t("notTrainedYetToday");


  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1600px]">
        <PageHeader title={t("title")} />
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px]">
      <OnboardingTour pageKey="training" steps={trainingTourSteps} />
      <PageHeader
        title={t("title")}
        subtitle={headerStatus}
        // #5485 (A2): sidens ENE guld-knap. På en smal telefon står den i fuld
        // bredde under sidehovedet (44 px tryk-mål), ellers her. "Get
        // suggestions from the assistant" er flyttet til tabellens
        // værktøjslinje, så sidehovedet kun bærer den ene handling.
        actions={isMobile ? null : primaryButton}
      />

      {isMobile && primaryButton}

      {/* #5485: fanerne hedder Today / Week plan / Development / Report.
          Tallet ved Today er antallet af ryttere der mangler en dag.
          `fit` (rettet 23/9): alle fire faner står helt på 360-390 px; uden den
          blev "Report"/"Rapport" skåret af. Den kanoniske fane-komponent, kun
          luften mellem fanerne er strammet på telefonen (tabsStyles.js). */}
      <Tabs value={activeTab} onChange={setTab} className="mt-1">
        <TabList label={t("title")} className="mb-3" fit>
          <Tab value="today">
            {t("tabs.today")}
            {overview.needsDay.length > 0 && (
              <span className="ms-1 font-data text-2xs tabular-nums text-cz-3">{overview.needsDay.length}</span>
            )}
          </Tab>
          <Tab value="weekplan">{t("tabs.weekplan")}</Tab>
          <Tab value="development">{t("tabs.development")}</Tab>
          <Tab value="report">{t("tabs.report")}</Tab>
        </TabList>

      <TabPanel value="today">
      <div className="space-y-3">
      {/* #5485 (aendring 1): overblikket øverst. Et tryk filtrerer tabellen. */}
      <div data-tour={phoneLayout ? tourAnchor("status") : undefined}>
        <TrainingOverview
          cells={overviewCells}
          active={overviewFilter}
          onToggle={toggleOverviewFilter}
          variant={overviewVariant}
          status={overviewStatus}
        />
      </div>
      {/* #5485 (ejer-go 23/9): assistenten rykket OP på telefonen — rækken
          lige under overblikkets fire tal, over tabellen, i begge telefon-
          visninger. Desktop (og telefon på langs uden beta) har knappen i
          tabellens værktøjslinje. */}
      {phoneTodayView && assistantRow}
      {/* #3643 (ejer-valg 18/9, låst): telefonen får sin EGEN visning — tabel
          med dagens løbsdage som kolonner, mockup 2. Alt under gaten er ren
          præsentation: fetches, mutationer og state-maskiner er de samme, og
          desktop-fladen nedenfor er uændret.

          BAG BETA-FLAG (ejer 19/9): "Jeg vil have det kun live for beta testere
          i starten, sådan at vi kan snakke om det og tilpasse, hvor vi derefter
          gør den bedre og bedre løbende". `mobileTable` kommer fra serveren
          (training_mobile_table i stadie `beta`, evalueret mod viewerens
          beta-status) — klienten beder aldrig selv om den nye flade. Er den
          false, tegnes tabellen nedenfor med #5124's D-047-gren, præcis som i
          dag. ⚠ NÅR FLAGET GÅR TIL `on`: slet D-047-grenen (rosterMobile*,
          showRosterCol, rosterScrollerClass, rosterMobileWrapAlign, chip-rækken
          og den dynamiske colSpan) og denne gate i én rettelse — se #3643. */}
      {/* #5485: desktop (og telefon på langs uden beta-flaget) får den nye
          tabel; telefonen med flaget sin løbsdags-tabel; telefonen uden flaget
          #5124's D-047-gren, uændret indhold i den nye struktur. */}
      {!phoneTodayView ? renderDesktopToday() : mobileTableView ? renderMobileToday() : (
      <div className="space-y-6">
        {/* #4522/#5485: assistent-forslagspanelet åbnes nu fra rækken lige
            under overblikket (assistantRow ovenfor), og panelet står dér. */}

        {runError && (
          <p className="text-cz-danger text-sm">{runError}</p>
        )}

        {/* #3721 (ejer-godkendt design 19/8, #3721): den åbne FAQ ("Får man
            energi tilbage hver dag?") + fokus-guide-accordionen (#1908) er
            begge slettet fra siden. Fokus-guiden svarede "hvad træner hvert
            fokus" i fokus-panelets Træner-kolonne i stedet (uændret). Recovery-
            svaret findes uændret i Hjælp (help.json dailytraining.formFatigue,
            allerede ordret dækkende) — nået via toolbar-linket nedenfor
            ("How training works" → /help?section=dailytraining), ikke gentaget
            her. Ingen kopi gik tabt: begge afsnits indhold levede allerede i
            help.json før denne ændring. */}

        {/* #3299: mobil-sortering — Form/Træthed sorteres via kolonne-headers på
            desktop, men headerne er skjult i portræt (#3045-kolonnekontrakten).
            Uden denne kontrol kunne træthed (den kolonne spillere rent faktisk
            sorterer på for at se hvem der skal have hvile) slet ikke sorteres i
            portræt. */}
        {/* #4160: monteret ogsaa mens truppen hydrerer, saa kontrollen ikke
            dukker op bagefter og skubber tabellen ned (CLS). At sortere en
            endnu-tom liste er en no-op. */}
        {(ridersLoading || riders.length > 0) && (
          <RosterMobileSortControl
            sort={rosterSort.sort}
            sortDir={rosterSort.sortDir}
            onSort={rosterSort.handleSort}
            scoreVisible={scoreVisible}
            t={t}
          />
        )}

        {/* Roster-værktøjslinje (#1480 gruppér-toggle + #3721 stille Hjælp-link).
            #3721: erstatter den slettede FAQ/accordion-forklaring ovenfor —
            i stedet for prosa på siden, ét dæmpet link til Hjælpens Daglig
            Træning-afsnit (recovery, ugerytme, kvitteringen, alt sammen). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* #4160: samme grund som sorterings-kontrollen ovenfor — pladsen
              holdes fra foerste maling i stedet for at blive skabt bagefter. */}
          {(ridersLoading || riders.length > 0) ? (
            <Checkbox
              checked={groupByType}
              onChange={(e) => setGroupByType(e.target.checked)}
              label={t("groupByType")}
            />
          ) : <span />}
          <Link
            to="/help?section=dailytraining"
            className="text-2xs text-cz-3 hover:text-cz-accent underline decoration-dotted whitespace-nowrap"
          >
            {t("howTrainingWorksLink")}
          </Link>
        </div>

        {/* Bulk-apply bjælke — vises kun når ryttere er valgt (#1480) */}
        {selectedCount > 0 && (
          <Card className="p-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-cz-1">{t("selected", { n: selectedCount })}</span>

            {/* #3762: ét valg, ikke to. Listen er de DAGE der findes, grupperet
                som i panelet — så en markering aldrig kan få en kombination som
                den enkelte rytter ikke kunne have fået. */}
            <div className="w-60">
              <Select
                size="sm"
                value={bulkDay}
                disabled={bulkApplying}
                aria-label={t("dayPanel.bulkSetDay")}
                onChange={(e) => setBulkDay(e.target.value)}
              >
                <option value="">{t("dayPanel.bulkSetDay")}</option>
                <option value="smart">{t("bulkSmartFocusOption")}</option>
                <optgroup label={t("dayPanel.bulkWholeDay")}>
                  <option value="rest">{t("dayPanel.dayType_rest")}</option>
                  <option value="recovery">{t("dayPanel.dayType_recovery")}</option>
                </optgroup>
                {TRAINING_LEVELS.map((level) => (
                  <optgroup key={level} label={`${t("dayPanel.dayType_training")} · ${t(`dayPanel.level_${level}`)}`}>
                    {TRAINING_SESSIONS_BY_LEVEL[level].map((k) => (
                      <option key={k} value={k}>{t(`dayPanel.session_${k}`)}</option>
                    ))}
                  </optgroup>
                ))}
                <optgroup label={t("dayPanel.dayType_skill")}>
                  {SKILL_SESSIONS.map((k) => (
                    <option key={k} value={k}>{t(`dayPanel.session_${k}`)}</option>
                  ))}
                </optgroup>
              </Select>
            </div>

            <Button type="button" variant="secondary" size="sm" onClick={handleBulkApply} disabled={bulkApplying || !bulkDay}>
              {bulkApplying ? t("bulkApplying") : t("bulkApply", { n: selectedCount })}
            </Button>

            <Button type="button" variant="ghost" size="sm" onClick={clearSelection} disabled={bulkApplying}>
              {t("bulkClear")}
            </Button>

            {bulkMsg && (
              <span
                className={`text-xs ${
                  bulkMsg.type === "ok" ? "text-cz-success" : bulkMsg.type === "partial" ? "text-cz-warning" : "text-cz-danger"
                }`}
              >
                {bulkMsg.text}
              </span>
            )}
          </Card>
        )}

        {/* Rosterbord (T2 wide-data-recipe: dataTableStyles-chrome i stedet for
            <DataTable> direkte — checkbox-multiselect + sticky navnekolonne kræver 2
            forskellige sticky-offsets (left-0/left-10), og group-header-rækker +
            udvidelig ugeplan-række pr. rytter passer ikke DataTable's 1-række-pr-row-
            model. Se HallOfFamePage/StaffOverviewPage for de to varianter af recepten.) */}
        {ridersLoading ? (
          // #4160: truppen hydrerer efter sidens foerste maling. Skelet i
          // tabellens egen hairline-ramme, ikke et falsk "ingen ryttere" —
          // og ikke en spinner (PAGE_TEMPLATES.md: "Never a spinner inside
          // cards"). Vi kender ikke trupstoerrelsen foer svaret lander, saa
          // hoejden kan ikke reserveres eksakt; 18 linjer ligger taettere paa
          // en rigtig trup end 10 og skaerer dermed skreddet ned naar tabellen
          // erstatter skelettet.
          <div className={WRAP}>
            <div className="p-5">
              <SkeletonLines lines={18} />
            </div>
          </div>
        ) : riders.length === 0 ? (
          <EmptyState icon={<TeamIcon size={26} aria-hidden="true" />} title={t("noRiders")} />
        ) : (
          <>
            {/* #4293: "This season"-kolonnen står tom hele vejen ned både når
                sæsonen er aktiv men endnu ikke begyndt, og på sæsonens første
                morgen før dagens tick har kørt. Fladen siger roligt hvorfor, i
                stedet for at lade en kolonne fuld af "—" tale for sig selv.
                Samme copy-nøgle som rytterprofilens kvittering, så de to steder
                ikke kan sige forskellige ting. */}
            {(history.seasonState === SEASON_RECEIPT_NOT_STARTED || history.seasonState === SEASON_RECEIPT_NO_DAYS) && history.seasonStart && (
              <p className="mb-2 text-2xs text-cz-3 leading-snug">
                {t(SEASON_RECEIPT_NOTE_KEY[history.seasonState], { date: formatDate(history.seasonStart) })}
              </p>
            )}
            {/* #5124 — D-047's chip-række (genbrugt fra MobileTableChips.jsx/
                DataTable.jsx, se noten ved rosterMobile ovenfor). Kun ≤640px
                og kun når der reelt er flere end tre kolonner at vælge imellem.
                #3643: og kun når training_mobile_table er off for brugeren —
                den nye mobil-tabel har hverken chips eller "Fuld tabel". */}
            {showRosterChips && (
              <MobileColumnChips
                columns={rosterMobile.chipColumns}
                selected={rosterMobile.selectedKeys}
                onPick={rosterMobile.pick}
                fullTable={rosterMobile.fullTable}
                onToggleFullTable={rosterMobile.toggleFullTable}
              />
            )}
            <div ref={rosterTableRef} className={WRAP}>
              <div className={rosterScrollerClass}>
                <table className={TABLE} data-sortable>
                  <thead>
                    <tr>
                      {/* Sticky sammen med navne-headeren nedenfor (#2446) — fast w-10 så
                          offsettet på navne-kolonnen (left-10) matcher præcis. */}
                      <th className={`${thClass({})} sticky-name-cell sticky left-0 z-sticky w-10`}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          aria-label={t("selectAll")}
                          className="h-4 w-4 rounded-[3px] accent-cz-accent"
                        />
                      </th>
                      <SortTh sortKey="name" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                        className={`${thClass({})} sticky-name-cell sticky left-10 z-sticky border-r border-cz-border`}>
                        {t("colRider")}
                      </SortTh>
                      {/* #3045: Type/Form/Træthed foldes ind i navne-underlinjen ≤640px
                          (samme portræt-kolonnekontrakt som de andre rytterflader), så
                          Fokus + Intensitet — de to felter man rent faktisk REDIGERER på
                          denne side — beholder pladsen i portræt uden at konkurrere med
                          info-only kolonner. Landskabs-visningen er uændret (kun hidden
                          sm:table-cell tilføjet). */}
                      <SortTh sortKey="primary_type" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                        className={`${thClass({})} hidden sm:table-cell`}>
                        {t("colType")}
                      </SortTh>
                      {/* #3815: alderen er den vigtigste enkeltvariabel når man
                          vælger hvem der skal trænes hårdt — ung rytter har
                          hovedrum, ældre har ikke — og den manglede netop dér
                          hvor valget træffes (@knud_r_flink, Discord 15/8).
                          #1674 lukkede hullet på rytteroverblik + transferliste,
                          men ikke her. Kompakt numerisk kolonne (samme
                          numeric+compact-recipe som TeamPages alders-kolonne),
                          og samme portræt-kontrakt som Type/Form/Træthed
                          (#3045): foldet ind i navne-underlinjen ≤640px, så
                          Dag + Skift dag beholder pladsen i portræt. */}
                      <SortTh sortKey="age" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                        className={`${thClass({ numeric: true, compact: true })} hidden sm:table-cell`}>
                        {t("colAge")}
                      </SortTh>
                      {/* #4851: Score. Ejer-beslutning 6 (6/9): dagens tal +
                          de sidste 7 dage som monokrom sparkline, sortérbar.
                          IKKE `hidden sm:table-cell` — tallet er et af dem
                          spilleren traeffer dagens valg paa, saa det skal kunne
                          ses i portraet (D-047's princip; rosteret er ikke en
                          <DataTable>, saa chip-mekanikken gaelder ikke her). */}
                      {/* "Score" siger ikke af sig selv HVAD der maales. Samme
                          forklarings-moenster som resten af siden: en `title`-
                          tooltip paa headeren (#1592's kolonne-moenster) plus et
                          stille link til Hjaelpens Daglig traening-afsnit, hvor
                          "The training score" staar i fuld prosa (help.json,
                          en+da). Kort tekst paa fladen, prosa i Hjaelp (#4025). */}
                      {scoreVisible && (
                        <SortTh sortKey="score" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                          title={t("score.columnHint")}
                          className={thClass({ numeric: true, compact: true })}
                          help={(
                            <Link
                              to="/help?section=dailytraining"
                              aria-label={t("score.columnHelpAria")}
                              title={t("score.columnHelpAria")}
                              className="inline-flex items-center text-cz-3 hover:text-cz-accent"
                            >
                              <InfoIcon size={12} aria-hidden="true" />
                            </Link>
                          )}>
                          {t("score.column")}
                        </SortTh>
                      )}
                      {/* #3762: kolonnerne hedder nu det de indeholder. Før stod
                          der "Fokus" og "Intensitet" — to akser der kunne modsige
                          hinanden. Nu er der én dag, og en hurtig vej til at
                          skifte den. */}
                      {showRosterCol("day") && <th className={thClass({})}>{t("dayPanel.colDay")}</th>}
                      {showRosterCol("day") && <th className={thClass({})}>{t("dayPanel.colChangeDay")}</th>}
                      {/* #3709 trin 1: kolonnen er ikke længere "næste +1" på ÉN
                          evne, men sæsonens kvittering pr. evne i fokusset. */}
                      {showRosterCol("receipt") && <th className={thClass({})}>{t("receipt.title")}</th>}
                      <SortTh sortKey="form" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort} className={`${thClass({})} hidden sm:table-cell`}>
                        {t("form")}
                      </SortTh>
                      <SortTh sortKey="fatigue" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort} className={`${thClass({})} hidden sm:table-cell`}>
                        {t("fatigue")}
                      </SortTh>
                      {/* #3706: var et bart <th> — overskriften kunne klikkes uden
                          at der skete noget (@cybersimon, Discord 13/8). Nu samme
                          SortTh-recipe som navn/type/form/træthed, med en
                          comparator der samler akademi-rytterne. */}
                      {showRosterCol("status") && (
                        <SortTh sortKey="status" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                          className={thClass({})}>
                          {t("colStatus")}
                        </SortTh>
                      )}
                      {/* #3300-rework: individuel ugeplan-knap i egen kolonne (ejer-
                          feedback), samme mønster som badges-kolonnen ovenfor. */}
                      {showRosterCol("weekplan") && <th className={thClass({})}>{t("colWeekPlan")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {groupByType
                      ? groups.map((group, gi) => (
                          <Fragment key={group.type}>
                            <tr className="bg-cz-subtle/60">
                              <td colSpan={rosterColSpan} className="border-t border-cz-border px-4 py-2">
                                <span className="font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-2">
                                  {groupLabel(group.type)}
                                </span>
                                <span className="ms-2 font-data text-2xs text-cz-3">
                                  {t("groupCount", { n: group.riders.length })}
                                </span>
                              </td>
                            </tr>
                            {sortRoster(filterIds ? group.riders.filter((r) => filterIds.has(r.id)) : group.riders).map((rider, ri) => renderRosterRow(rider, gi === 0 && ri === 0))}
                          </Fragment>
                        ))
                      : sortRoster(visibleRiders).map((rider, ri) => renderRosterRow(rider, ri === 0))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className={COUNT}>{t("groupCount", { n: riders.length })}</div>
          </>
        )}

        {/* #3746 trin 7 (ejer-beslutning 20/8): ugentlig træningsrytme-editoren
            er flyttet HERFRA til sin egen fane ("Week plan" / "Ugeplan") — se
            TabPanel value="weekplan" nedenfor. #3721 flyttede den først fra
            oversiden af rosteret til en accordion under kvitteringen; nu bor
            den slet ikke på Train today længere. Selve funktionen (state,
            useTraining-wiring, gem/nulstil-handlers) er UÆNDRET, kun
            placeringen + accordion→åben-sektion ændrede sig. weekRhythmTodayShort
            -hintet på roster-rækken (linje ~841) er UBERØRT — det bliver hvor det er. */}
      </div>
      )}
      </div>
      </TabPanel>

      {/* #5485 (aendring 6): fanen Week plan — holdets plan og hver rytters
          egen plan i ét gitter, valgt med "Plan for". Ingen nye API-kald:
          weekPlan/riderWeekPlans kommer fra useTraining som før. */}
      <TabPanel value="weekplan">
        {renderWeekPlanTab()}
      </TabPanel>

      {/* #3721: Development-fanen — én række pr. rytter i truppen: navn+alder,
          udviklings-glyffen (DevelopmentGlyph, FAST 0-99-skala), tallene
          "now · lo-hi · loft", og den SAMME FocusOpenButton/FocusPanel-mutation
          som Train today's roster-række bruger (ingen ny fokus-logik). Estimatet
          kommer fra useScouting (POST /api/scouting/estimates, samme kilde som
          spejder-fladerne) — egne ryttere er altid et bånd, så der er ingen
          scout-knap eller slots-tilstand at vise her. */}
      <TabPanel value="development">
        {ridersLoading ? (
          // #4160: samme regel som roster-tabellen — skelet mens truppen
          // hydrerer, aldrig et falsk "ingen ryttere".
          <Card className="p-5">
            <SkeletonLines lines={10} />
          </Card>
        ) : riders.length === 0 ? (
          <EmptyState icon={<TeamIcon size={26} aria-hidden="true" />} title={t("noRiders")} />
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="divide-y divide-cz-border">
              {riders.map((rider) => {
                const age = ageForSeason(rider.birthdate, seasonYear);
                const estimate = estimateFor(rider.id);
                const plan = planFor(rider.id);
                const busy = savingId === rider.id || bulkApplying;
                const hasBand = estimate && estimate.now != null && estimate.prog
                  && Number.isFinite(estimate.prog.lo) && Number.isFinite(estimate.prog.hi);
                // Tester-feedback 20/8 (#3798): rollen skal stå PÅ rækken —
                // uden den skal spilleren gætte hvilken evne tallene gælder.
                // estimate.role er båndets egen nøgle (backend, samme payload
                // som tallene) og kan derfor aldrig pege på en anden rolle end
                // den der faktisk er prognosticeret; primary_type er kun
                // fallback for rækker uden bånd endnu.
                const roleKey = estimate?.role ?? rider.primary_type ?? null;
                const roleLabel = roleKey ? tTypes(`types.${roleKey}`) : null;
                return (
                  <div key={rider.id} className="flex flex-wrap items-center gap-4 px-4 py-[13px] sm:px-5">
                    <div className="min-w-[160px] flex-1">
                      <RiderLink id={rider.id} className="text-[13.5px] font-medium text-cz-1 hover:text-cz-accent transition-colors">
                        {rider.firstname} {rider.lastname}
                      </RiderLink>
                      <div className="mt-0.5 font-data text-3xs uppercase tracking-[.05em] text-cz-3">
                        {age != null
                          ? (roleLabel
                            ? t("development.ageRoleLine", { age, role: roleLabel })
                            : t("development.ageLine", { age }))
                          : (roleLabel ?? "—")}
                      </div>
                    </div>

                    <div className="min-w-[180px] max-w-[260px] flex-1">
                      {estimate === undefined ? (
                        <span className="text-cz-3 text-xs">{t("loading")}</span>
                      ) : hasBand ? (
                        <>
                          <DevelopmentGlyph now={estimate.now} progLo={estimate.prog.lo} progHi={estimate.prog.hi} loft={estimate.loft} />
                          <div className="mt-1 font-mono tabular-nums text-2xs text-cz-2">
                            {roleLabel ? (
                              <span className="font-data uppercase tracking-[.05em] text-3xs text-cz-1 me-1.5">{roleLabel}</span>
                            ) : null}
                            {Number.isFinite(estimate.loft)
                              ? t("development.numbers", { now: estimate.now, lo: estimate.prog.lo, hi: estimate.prog.hi, loft: estimate.loft })
                              : t("development.numbersNoLoft", { now: estimate.now, lo: estimate.prog.lo, hi: estimate.prog.hi })}
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          {/* #5321: rytteren uden prognose-bånd viste her et
                              uvægtet snit af ALLE evner — et helt andet tal end
                              den rating Mit hold, rytterprofilen, auktionerne og
                              ønskelisten viser for samme rytter. Nu er det den
                              samme rating som alle andre steder. */}
                          <span className="font-mono tabular-nums text-2xs text-cz-1">{riderOverallRating(rider) ?? "—"}</span>
                          <span className="text-cz-3 text-3xs italic">{t("development.noForecastYet")}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex-none">
                      <FocusOpenButton
                        rider={rider}
                        plan={plan}
                        busy={busy}
                        smartFocus={smartDefaultFocus[rider.id]}
                        error={planActionError?.riderId === rider.id ? planActionError.error : null}
                        onOpen={() => setFocusPanelRiderId(rider.id)}
                        t={t}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </TabPanel>

      {/* #5485: Report samler dagens rapport og historikken (før fanen History).
          Gårsdagens kvittering, dagens historie og rapport-tabellen stod før
          øverst på Train today og skubbede truppen ned under folden. */}
      <TabPanel value="report">
      <div className="space-y-6">
        {/* #3924 trin 1 (design-go 20/8, ejer-godkendt): "Yesterday's gains" —
            ÉN resumé-linje øverst på Train today, foldet ud til en kvalitativ
            linje pr. rytter. "Ingen nyt kort" (fold-disciplin): genbruger
            CollapsibleSection (#3914's delte fold-primitiv) i stedet for en ny
            stat-grid; ingen ny beregning — todayRun + live progress, samme
            kilde som resten af siden. Skjult uden en dagens kørsel. */}
        {yesterday && (
          <CollapsibleSection
            title={[
              t("yesterdayTrainedLine", { n: yesterday.trainedFocus }),
              t("yesterdayRestedLine", { n: yesterday.rested }),
              t("yesterdayPointsLanded", { n: yesterday.pointsLanded }),
            ].join(" · ")}
          >
            <ul className="flex flex-col gap-2">
              {yesterdayStories.map((story) => (
                <li key={story.riderId} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <RiderLink id={story.riderId} className="font-medium text-cz-1 hover:text-cz-accent transition-colors">
                    {story.riderName}
                  </RiderLink>
                  <span className="text-cz-3">{yesterdayLineText(story, t, tRider)}</span>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        )}

        {/* Dagligt udviklings-moment (#2484, H3) — ÉN kurateret historie fra
            seneste kørsel i stedet for kun rå tal. Selvstændigt kort, rører
            ikke roster-/rapport-tabellernes markup (koord. #2446-layoutfix). */}
        <TrainingMoment
          latestRun={latestRun}
          isToday={latestIsToday}
          progressByRider={progress}
          pastRuns={pastRuns}
        />

        {/* Tick-model-besked (#1936): når dagens træning er kørt, forklar at ændringer
            nu gælder fra i morgen + at form/træthed kun rykker ved det daglige tick.
            Fjerner "fokus blev ikke gemt"/"træthed fryser"-forvirringen. */}
        {todayRun && (
          <div className="bg-cz-accent/5 border border-cz-accent/20 rounded-cz px-4 py-2.5">
            <p className="text-sm text-cz-2 leading-relaxed">{t("tickModelDone")}</p>
          </div>
        )}

        {/* Rapport fra seneste kørsel */}
        {todayRun?.report && (
          <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
            <div className="px-5 py-4 border-b border-cz-border flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-cz-1">{t("report")}</h2>
              {todayRun.bonus_applied && (
                <span className="text-xs px-2 py-0.5 rounded-cz bg-cz-accent/10 text-cz-accent border border-cz-accent/30">
                  {t("bonusApplied")}
                </span>
              )}
            </div>

            {/* Dags-opsummering (payoff, holdniveau) */}
            <div className="grid grid-cols-3 divide-x divide-cz-border border-b border-cz-border">
              <div className="px-5 py-3">
                <div className="font-data text-lg font-bold tabular-nums text-cz-1">
                  {summary.trained}<span className="text-cz-3 text-sm font-normal"> / {summary.total}</span>
                </div>
                <div className="font-data text-2xs uppercase tracking-[.06em] text-cz-3">{t("summaryTrained")}</div>
              </div>
              <div className="px-5 py-3">
                <div className={`font-data text-lg font-bold tabular-nums ${summary.breakthroughs > 0 ? "text-cz-success" : "text-cz-1"}`}>
                  {summary.breakthroughs}
                </div>
                <div className="font-data text-2xs uppercase tracking-[.06em] text-cz-3">{t("summaryBreakthroughs")}</div>
              </div>
              <div className="px-5 py-3">
                <div className="font-data text-lg font-bold tabular-nums text-cz-1">{summary.peakForm}</div>
                <div className="font-data text-2xs uppercase tracking-[.06em] text-cz-3">{t("summaryPeakForm")}</div>
              </div>
            </div>

            <div className={SCROLLER}>
              <table className={TABLE} data-sort-exempt="Per-koersel traeningsrapport i rapport-orden">
                <thead>
                  <tr>
                    <th className={thClass({ sticky: true })}>{t("colRider")}</th>
                    <th className={thClass({})}>{tRider("training.focus")}</th>
                    <th className={thClass({})}>{tRider("training.intensity")}</th>
                    <th className={thClass({})}>{t("colNextUp")}</th>
                    <th className={thClass({})}>{t("colGains")}</th>
                    <th className={thClass({})}>{t("colResult")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(todayRun.report.riders ?? []).map((row) => {
                    const jumps = breakthroughJumps(row);
                    const breakthrough = isBreakthrough(row);
                    const fatigueDelta = row.fatigue_delta ?? 0;
                    const fatigueSign = fatigueDelta > 0 ? "+" : "";
                    const prog = focusProgress(row.focus, progress[row.rider_id]);
                    // #3541: rapportens egne skadefelter på denne række er en
                    // engangs-snapshot fra selve dagens tick og opdateres aldrig
                    // efterfølgende (0 for en rytter der allerede var skadet FØR i dag,
                    // jf. dailyTrainingEngine.js hvor snapshot-tallet kun sættes i den
                    // nyligt-skadet-gren). injuryDaysLeft på den samme condition-state
                    // som roster-rækken (linje ~548) og ConditionChips på rytterprofilen
                    // er ÉN kanonisk kilde, så de tre visninger ikke kan divergere.
                    // #5462: samme kilde som roster-raekken — de to flader kan ikke
                    // sige forskelligt om den samme skade (#1672-mønsteret).
                    const reportInjury = injuryTimeLeft(condition[row.rider_id], today);
                    const reportDaysLeft = reportInjury.count;
                    const reportInjured = reportDaysLeft > 0;
                    const reportInjuryMsg = injuryBadgeMessage(reportInjury, { compact: true });
                    return (
                      <tr
                        key={row.rider_id}
                        className={`group transition-colors duration-150 hover:bg-cz-subtle ${breakthrough ? "bg-cz-success-bg border-l-2 border-l-cz-success" : ""}`}
                      >
                        <td className={tdClass({ sticky: true })}>
                          <RiderLink id={row.rider_id} className="text-cz-1 font-medium hover:text-cz-accent transition-colors">
                            {row.name}
                          </RiderLink>
                          {reportInjured && (
                            <span
                              className="ms-2 text-3xs px-1.5 py-0.5 rounded-cz-pill bg-cz-danger-bg text-cz-danger"
                              title={reportInjury.unit === "race_day" && reportInjury.approxDate
                                ? t("injuredApprox", { date: formatDate(reportInjury.approxDate, "medium") })
                                : undefined}
                            >
                              {t(reportInjuryMsg.key, { days: reportInjuryMsg.days })}
                            </span>
                          )}
                        </td>
                        <td className={tdClass({})}>
                          {row.focus ? tRider(`training.focus_${row.focus}`) : "—"}
                        </td>
                        <td className={tdClass({})}>
                          {row.intensity ? tRider(`training.intensity_${row.intensity}`) : "—"}
                        </td>
                        {/* Progress mod næste +1 (anticipation efter kørsel) */}
                        <td className={tdClass({})}>
                          <FocusProgress
                            info={prog}
                            emptyLabel={row.intensity === "rest" ? t("restDay") : t("noFocus")}
                            tRider={tRider}
                            toGoLabel={(o) => t("toGo", o)}
                          />
                        </td>
                        {/* Gevinster — gennembrud vist som faktisk tal-spring */}
                        <td className={tdClass({})}>
                          {jumps.length > 0 ? (
                            <span className="text-cz-success text-xs font-medium">
                              {jumps.map((j) => (
                                j.from != null && j.to != null
                                  ? t("gainJump", { from: j.from, to: j.to, ability: tRider(`racePreview.derived.${j.ability}`) })
                                  : t("gains", { n: j.n, ability: tRider(`racePreview.derived.${j.ability}`) })
                              )).join(", ")}
                            </span>
                          ) : (
                            <span className="text-cz-3 text-xs">{t("noGains")}</span>
                          )}
                        </td>
                        {/* Result — dagsform + trætheds-delta (erstatter rå score) */}
                        <td className={tdClass({})}>
                          <div className="flex flex-col gap-0.5">
                            {row.status === "over" && (
                              <span className="text-cz-success text-xs">{t("sharpDay")}</span>
                            )}
                            {row.status === "under" && (
                              <span className="text-cz-danger text-xs">{t("flatDay")}</span>
                            )}
                            <span className={`text-2xs font-mono ${fatigueDelta > 0 ? "text-cz-warning" : fatigueDelta < 0 ? "text-cz-success" : "text-cz-3"}`}>
                              {t("fatigueChange", { delta: `${fatigueSign}${fatigueDelta}` })}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Træningsrapport-historik (#1533) — seneste 30 dage. */}
        {/* #5734: samme trainingScore-kort som Today (null = training_score_visible off) — TrainingHistory slaar selv dags-dato op i .spark. */}
        <TrainingHistory history={history} trainingScore={trainingScore} />
      </div>
      </TabPanel>
      </Tabs>

      {/* #3721: fokus-panelet. Ét ad gangen, uden for tabellen (Modal
          portaler selv), så rosterets sticky-kolonner og vandrette scroller
          ikke kan klippe det. `perSeason` sendes bevidst ikke: trin 4 (#3741)
          er ikke merget, og panelet udelader kolonnen frem for at vise et
          opfundet tal. */}
      <FocusPanel
        open={!!focusPanelRider}
        onClose={() => setFocusPanelRiderId(null)}
        rider={focusPanelRider}
        // Ejer-krav 14/8: samme badge-sæt som rosterets Status-kolonne, via de
        // samme komponenter. Panelet må ikke opfinde sin egen status-visning.
        badges={
          focusPanelRider
            ? [
                focusPanelRider.is_academy && "academy",
                injuryTimeLeft(condition[focusPanelRider.id], today).count > 0 && "injured",
              ]
            : []
        }
        focus={focusPanelRider ? planFor(focusPanelRider.id)?.focus ?? null : null}
        intensity={focusPanelRider ? planFor(focusPanelRider.id)?.intensity ?? "normal" : "normal"}
        trainability={focusPanelRider ? trainability[focusPanelRider.id] ?? null : null}
        assistantFocus={focusPanelRider ? smartDefaultFocus[focusPanelRider.id] ?? null : null}
        saving={savingId === focusPanelRiderId}
        error={planActionError?.riderId === focusPanelRiderId ? planActionError.error : null}
        onSave={handleFocusPanelSave}
        onClear={handleFocusPanelClear}
      />
    </div>
  );
}
