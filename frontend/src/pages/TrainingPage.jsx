// TrainingPage — daglig træning (#1305).
//
// #4613 (ejer-retning 2/9 + valgt retning B 3/9): siden er OVERBLIK FØRST.
// Fanen "Overblik" er én tæt rytterliste — form, træthed, dagens valg og de
// næste 7 dage pr. række — og alt det der før lå stablet under hinanden bor nu
// i en fane eller i assistent-panelet:
//   · sæson-kvitteringen pr. evne (#3709)      → Udvikling-fanen
//   · dagens rapport + udviklings-momentet     → Rapporter-fanen
//   · gårsdagens kvittering + tick-beskeden    → Rapporter-fanen
//   · den individuelle ugeplan pr. rytter      → Ugeplan-fanen (uge-cellen i
//     rosteret er indgangen, så vejen dertil stadig går gennem rytteren)
// INTET er fjernet funktionelt — kun flyttet. Prosaen på fladen er trimmet til
// én linje pr. sted; de fulde forklaringer bor uændret i help.json
// (dailytraining.weeklyRhythm / individualWeeklyPlan / trainToday).
//
// Rytterliste hentes fra Supabase (samme kilde som TeamPage) da det er holdets
// egne ryttere vi træner. Condition/progress/todayRun serveres fra useTraining.

import { useState, useEffect, useMemo, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { supabase } from "../lib/supabase";
import RiderLink from "../components/RiderLink.jsx";
import RiderTypeBadge from "../components/rider/RiderTypeBadge.jsx";
import RiderBadges from "../components/rider/RiderBadges.jsx";
import { useTraining } from "../lib/useTraining.js";
import { useTrainingHistory } from "../lib/useTrainingHistory.js";
import { useScouting } from "../lib/useScouting.js";
import { useActiveSeasonYear } from "../hooks/useActiveSeasonYear.js";
import { ageForSeason, retirementRiskBadgeKey, contractExpiringBadgeKey, seasonNumberFromReferenceYear } from "../lib/riderAge.js";
import { riderStatRating } from "../lib/riderRating.js";
import { TRAINING_INTENSITIES, injuryDaysLeft, WEEKDAY_KEYS, weekdayKeyForDate, resolveDayIntensityDisplay, resolveDayIntensitySource } from "../lib/training.js";
import { riderWeekStrip } from "../lib/trainingWeekStrip.js";
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
import TrainingWeekStrip from "../components/training/TrainingWeekStrip.jsx";
import AssistantSuggestionsPanel from "../components/training/AssistantSuggestionsPanel.jsx";
import { buildAssistantSuggestions, countSuggestionsWithoutPlan, filterAssistantSuggestions, acceptableSuggestionIds, acceptableSelectionIds } from "../lib/assistantTrainingSuggestions.js";
import DevelopmentGlyph from "../components/development/DevelopmentGlyph.jsx";
import OnboardingTour from "../components/OnboardingTour.jsx";
import SortTh from "../components/rider/RiderSortTh.jsx";
import { useSortState, sortRows } from "../lib/useTableSort.js";
import {
  PageHeader, Card, Button, Select, FilterBar, Segmented,
  PageLoader, EmptyState, ChevronDownIcon, TeamIcon,
  ArrowUpIcon, ArrowDownIcon, FlagIcon, StarIcon,
  Tabs, TabList, Tab, TabPanel, CollapsibleSection,
} from "../components/ui";
import { buttonClass } from "../components/ui/buttonStyles.js";
import { WRAP, SCROLLER, TABLE, COUNT, thClass, tdClass, trClass } from "../components/ui/dataTableStyles.js";

// #3721 gav siden faner, ?tab=-synkroniseret efter samme mønster som
// FinancePage/RiderStatsPage. #4613 gør listen DATA-DREVET, fordi de to næste
// faner er specificeret og på vej: Program (#4629) og Løbsdag (#4632). De to
// tilføjes som et element hver i listen nedenfor + et <TabPanel> — der er
// ingen tom placeholder-fane i mellemtiden (TASTE P11: intet "Coming soon").
// ?tab=-værdierne er UÆNDREDE, så alle eksisterende dyb-links holder.
const TRAINING_TAB_DEFS = Object.freeze([
  { value: "today", labelKey: "tabs.today" },
  { value: "weekplan", labelKey: "tabs.weekplan" },
  { value: "development", labelKey: "tabs.development" },
  { value: "history", labelKey: "tabs.history" },
]);
const TRAINING_TABS = TRAINING_TAB_DEFS.map((tab) => tab.value);

// #2849 bølge 4 — T2 wide-data-skabelonen (docs/design/PAGE_TEMPLATES.md):
// PageHeader-recipe (status i subtitle, "Train today" som sidens ene gold CTA),
// max-w-[1600px]-container, PageLoader ved initial load, ui/DataTable-recepten
// (dataTableStyles: WRAP/SCROLLER/thClass/tdClass/trClass) på begge tabeller.
// Roster-tabellen bruger dataTableStyles-chrome i stedet for <DataTable>
// direkte, fordi den har multi-select-checkbox + group-header-rækker, som
// DataTable's 1-række-pr-row-kolonnemodel ikke understøtter. #4613 sætter
// `dense` på den (T2's ene opt-in for rosters hvor rækker-pr-skærm ER pointen)
// og lægger tabellens egne kontroller i toolbar-slotten inde i hairline-rammen
// i stedet for som løsrevne rækker over tabellen.

// Roster-tabellen sorterer på navn/type (tekst, asc-først) + form/træthed/status
// (tal, desc-først: "hvem er mest træt/i bedst form / hvem er akademi?" med ét klik).
// #3815: alder er ligeledes numerisk og følger derfor samme desc-først-konvention.
const ROSTER_DESC_FIRST = new Set(["age", "form", "fatigue", "status"]);

// #3706: Status-kolonnens comparator. Kolonnen bærer to badges, så rangen er en
// vægt i stedet for en enkelt værdi: akademi vejer tungest, skade lægger et
// point oveni. Desc-først → akademi øverst med ét klik.
const STATUS_ACADEMY_WEIGHT = 2;
const STATUS_INJURED_WEIGHT = 1;

// ── #3762: dagen som label + hurtig-skift ─────────────────────────────────
// Hvile · Aktiv restitution · rytterens egen session. Den sidste er en sentinel,
// ikke en dagstype: hvilken dag den fører til afhænger af rytterens session.
const QUICK_DAY_TYPES = Object.freeze(["rest", "recovery", "session"]);

// #4613: overbliksfanens status-segment. Ét spørgsmål ad gangen om truppen —
// hvem mangler en dag, hvem er i fare, hvem racer i dag.
const ROSTER_VIEWS = Object.freeze(["all", "noplan", "risk", "racing"]);

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
// følger brugerens locale. Ankrene sidder på første roster-rækkes dags-knap +
// uge-strip + dagens knap i sidehovedet (#4613: det tredje anker lå før på
// kvitterings-kolonnen, som nu bor på Udvikling-fanen).
function getTrainingTourSteps(t) {
  return [
    {
      target: "[data-tour='training-focus']",
      title: t("tour.focus.title"),
      body: t("tour.focus.body"),
    },
    {
      target: "[data-tour='training-run-today']",
      title: t("tour.runToday.title"),
      body: t("tour.runToday.body"),
    },
    {
      target: "[data-tour='training-next-up']",
      title: t("tour.nextUp.title"),
      body: t("tour.nextUp.body"),
    },
  ];
}

// Bred side — samme mønster som TeamPage / RidersPage.
// (Layout WIDE_CONTENT_ROUTES håndterer kun specific paths — vi bruger inline max-w)

// #4613: form/træthed som ét tal + én hairline-måler i samme celle. Tallet er
// det man skanner efter (tabular, højrestillet), måleren er formen på det.
function ConditionCell({ value, label, tone = "neutral" }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const known = value != null;
  return (
    <div className="flex items-center justify-end gap-2" title={`${label}: ${known ? pct : "—"}`}>
      <span className={`font-data text-[13px] tabular-nums ${tone === "danger" ? "font-semibold text-cz-danger" : "text-cz-1"}`}>
        {known ? pct : "—"}
      </span>
      <span className="hidden h-1 w-10 overflow-hidden bg-cz-subtle sm:block" aria-hidden="true">
        <span
          className={`block h-full ${tone === "danger" ? "bg-cz-danger" : "bg-cz-2"}`}
          style={{ width: `${known ? pct : 0}%` }}
        />
      </span>
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
// #4613: knappen er strammet til en chip i rækkehøjde, og en rytter UDEN en
// valgt dag bærer den stiplede advarsels-kant — "3 mangler en dag" skal kunne
// ses ned gennem kolonnen uden at læse et ord.
function FocusOpenButton({ rider, plan, busy, smartFocus, error, onOpen, t, dataTour }) {
  const chosen = !!plan?.focus;
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={onOpen}
        data-tour={dataTour}
        aria-label={`${t("dayPanel.colDay")} — ${rider.firstname} ${rider.lastname}`}
        className={`flex w-full max-w-[176px] items-center justify-between gap-1.5 rounded-cz border px-2 py-1 text-start transition-colors hover:bg-cz-subtle disabled:opacity-40 ${
          chosen ? "border-cz-border" : "border-dashed border-cz-warning/60"
        }`}
      >
        <span className="min-w-0">
          <span className={`block truncate text-[13px] ${chosen ? "font-medium text-cz-1" : "text-cz-warning"}`}>
            {chosen ? dayLabel(plan, t) : t("dayPanel.chooseDay")}
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
// kolonne spillere sorterer på for at afgøre hvem der skal have hvile.
// Eksponerer PRÆCIS de samme sort-nøgler som desktop-headerne og skriver til
// samme rosterSort-state via handleSort — ingen ny sort-logik. Synlig kun under
// sm-breakpointet. #4613: bor nu i tabellens toolbar-slot i stedet for som en
// løsrevet række over tabellen (PAGE_TEMPLATES "no orphan action rows").
function RosterMobileSortControl({ sort, sortDir, onSort, t }) {
  const options = [
    { key: "name", label: t("colRider") },
    { key: "primary_type", label: t("colType") },
    // #3815: alderen er sorterbar på desktop — kontrollen skal eksponere
    // PRÆCIS de samme nøgler som desktop-headerne (samme krav som #3706).
    { key: "age", label: t("colAge") },
    { key: "form", label: t("form") },
    { key: "fatigue", label: t("fatigue") },
    // #3706: Status blev sorterbar — kontrollen skal blive ved med at eksponere
    // PRÆCIS de samme nøgler som desktop-headerne.
    { key: "status", label: t("colStatus") },
  ];
  const dirAria = sortDir === "desc" ? t("mobileSort.descAria") : t("mobileSort.ascAria");

  return (
    <div className="sm:hidden flex w-full items-end gap-2">
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
        className="flex-shrink-0 flex items-center justify-center px-3 py-[7px] rounded-cz border border-cz-border
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

  // #2819: guidet rundvisning for onboarding-trin 2 (first_training_run).
  const trainingTourSteps = useMemo(() => getTrainingTourSteps(t), [t]);

  // #3721: faner, ?tab=-synkroniseret efter samme mønster som FinancePage/
  // RiderStatsPage (VALID_TABS-fallback). Kun læst ved mount for den initiale
  // fane; skift derefter styres af setTab (skriver `replace`, ingen historik-
  // spam pr. fane-klik).
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = TRAINING_TABS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "today";
  const setTab = (tab) =>
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", tab);
      return p;
    }, { replace: true });

  // #4522 (ejer-direktiv 31/8): "Get suggestions from the assistant"-panelet —
  // et LUKKET panel man åbner fra sidehovedet (retning B, #4613). Det ligger
  // øverst i overbliksfanen når det er åbent, og fladen er uberørt indtil man
  // åbner det. Header-knappen kan klikkes fra enhver fane, så vi skifter til
  // "today" (panelet lever kun der).
  const [assistantPanelOpen, setAssistantPanelOpen] = useState(false);
  const [assistantOnlyNoPlan, setAssistantOnlyNoPlan] = useState(false);
  const [assistantSelected, setAssistantSelected] = useState(() => new Set());
  const [assistantMsg, setAssistantMsg] = useState(null);

  function handleOpenAssistantPanel() {
    setAssistantMsg(null);
    setAssistantPanelOpen(true);
    setTab("today");
  }
  function handleDismissAssistantPanel() {
    setAssistantPanelOpen(false);
    setAssistantSelected(new Set());
    setAssistantMsg(null);
  }

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
    racingToday,
  } = training;

  // #2578: dagens vundne hele point pr. rytter fra dagens kørsel — så
  // kvitterings-rækken kan vise "+N i dag" når baren netop har wrappet efter
  // et gennembrud (ellers fejllæses wrappen som "ingen fremgang").
  const todayGainsByRider = useMemo(() => {
    const out = {};
    for (const row of todayRun?.report?.riders ?? []) {
      const total = todayGainTotal(row);
      if (total > 0) out[row.rider_id] = total;
    }
    return out;
  }, [todayRun]);

  // #3924 trin 2: rider_id → hele gårsdagens rapport-linje, så kvitteringens
  // bar kan udlede gårsdagens bidrag (progress_before + gains pr. evne).
  // Samme todayRun som alt andet på denne side — intet nyt kald.
  const todayRowByRider = useMemo(() => {
    const out = {};
    for (const row of todayRun?.report?.riders ?? []) out[row.rider_id] = row;
    return out;
  }, [todayRun]);

  // #3924 trin 1 (design-go 20/8): "Yesterday's gains"-resuméet — holdniveau-
  // tallene til den ÉNE linje + kvitteringens per-rytter-historier til fold-
  // ud'et. Samme todayRun/progress som resten af siden. #4613: linjen bor nu
  // på Rapporter-fanen sammen med resten af dagens kvittering.
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

  // #1895 PR 2: individuel ugeplan pr. rytter. #4613: editoren bor på Ugeplan-
  // fanen (én rytter udvidet ad gangen), og uge-cellen i rosteret er genvejen
  // dertil — funktionen er uændret, kun placeringen.
  const [expandedRiderId, setExpandedRiderId] = useState(null);
  const [riderWeekDraftMap, setRiderWeekDraftMap] = useState({}); // { <rider_id>: days } — kun redigerede
  const [riderWeekMsgMap, setRiderWeekMsgMap] = useState({}); // { <rider_id>: {type,text} | null }

  // Træningsrapport-historik (#1533): seneste 30 dages kørsler. Egen RLS-låst
  // SELECT-hook (training_day_runs), uafhængig af useTraining's /me-state.
  const history = useTrainingHistory();

  const [riders, setRiders] = useState([]);
  const [ridersLoading, setRidersLoading] = useState(true);
  const [runError, setRunError] = useState(null);

  // #2465: roster-radens handlinger kaldte tidligere setPlan/clearPlan uden
  // await og uden at læse {ok,error} — en fejl var visuelt usynlig. Fælles
  // wrapper + pr.-rytter fejl-state.
  const [planActionError, setPlanActionError] = useState(null); // { riderId, error } | null
  async function handlePlanChange(riderId, dayType, session = null) {
    setPlanActionError(null);
    const result = await setPlan(riderId, dayType, session);
    if (result && !result.ok) {
      setPlanActionError({ riderId, error: result.error || "failed" });
      return false;
    }
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

  // #4613: overbliksfanens filtre. Søgefelt + ryttertype i den kanoniske
  // FilterBar, status-spørgsmålet som Segmented i tabellens egen toolbar.
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterType, setRosterType] = useState("all");
  const [rosterView, setRosterView] = useState("all");

  // Hent egne ryttere fra Supabase — samme mønster som TeamPage.
  useEffect(() => {
    async function loadRiders() {
      setRidersLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: myTeam } = await supabase
          .from("teams")
          .select("id")
          .eq("user_id", user.id)
          .single();
        if (!myTeam) return;
        // #3300: is_academy medtages read-only i samme select (ingen migration,
        // intet nyt kald). #3709 trin 1: + de 15 evne-kolonner via det delte
        // ABILITY_SELECT-embed. #3721/#3815: + birthdate (alder). #3761:
        // + contract_end_season (Status-cellens contractExpiring-badge).
        const { data } = await supabase
          .from("riders")
          .select(`id, firstname, lastname, birthdate, contract_end_season, primary_type, secondary_type, is_academy, ${ABILITY_SELECT}`)
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

  // #4613: uge-cellen i rosteret er indgangen til rytterens egen ugeplan —
  // skifter til Ugeplan-fanen med netop den rytter udvidet. Samme state og
  // samme mutation som fanens egen toggle, kun en anden vej ind.
  function openRiderWeekPlan(riderId) {
    setExpandedRiderId(riderId);
    setTab("weekplan");
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

  // Stabil dags-reference: bruges både af rækkernes skade-visning, uge-strippen
  // og af #3706's Status-comparator, som er memoiseret — en frisk Date pr.
  // render ville invalidere den memo hver eneste gang.
  const today = useMemo(() => new Date(), []);

  const isLoading = loading || ridersLoading;

  // Dags-opsummering til rapportens payoff-stribe (trænede / gennembrud / topform).
  const summary = todayRun?.report ? daySummary(todayRun.report.riders) : null;

  // Dagligt udviklings-moment (#2484, H3): ÉN kurateret historie i stedet for
  // kun rå tal. latestRun = dagens kørsel hvis den allerede er kørt, ellers
  // seneste historiske dag (typisk "i går"). pastRuns bruges KUN til cooldown.
  const latestRun = todayRun ?? history.runs[0] ?? null;
  const latestIsToday = !!todayRun;
  const pastRuns = latestIsToday
    ? history.runs.filter((r) => r.tick_date !== todayRun.tick_date)
    : history.runs.slice(1);

  // #3709 trin 1: sæsonens hele point pr. rytter, summeret fra den AKTIVE sæsons
  // trænings-kørsler (useTrainingHistory skærer selv forrige sæsons hale fra).
  // Uden en kendt sæsonstart bliver map'et tomt, rækkerne får seasonGains = null
  // og viser "—" i stedet for et opfundet "+0" (#4293 dækker interregnum +
  // sæsonens første morgen).
  const seasonGainsByRider = useMemo(() => {
    const out = {};
    if (history.seasonState !== SEASON_RECEIPT_RUNNING || !history.seasonStart) return out;
    for (const r of riders) {
      out[r.id] = seasonAbilityGains(history.seasonRuns, r.id, history.seasonStart) ?? {};
    }
    return out;
  }, [riders, history.seasonRuns, history.seasonStart, history.seasonState]);

  // --- Gruppering + multi-select (#1480) ---
  // Antal kolonner i roster-tabellen — bruges til colSpan på gruppe-header-rækker.
  // #4613: kvitterings-kolonnen flyttede til Udvikling-fanen, og ugeplan-
  // knappens egen kolonne blev uge-strippen. #4736: Dag og "Skift dag" er slået
  // sammen til ÉN celle, så der er 9 kolonner (vælg, navn, type, alder, dag,
  // uge, form, træthed, status).
  const ROSTER_COLS = 9;

  // Accessors til roster-sortering. form/fatigue bor i condition-map'et (ikke på
  // rytteren), så closure over condition — useMemo holder referencen stabil pr.
  // condition-ændring så sorteringen ikke re-kører hver render.
  const rosterAccessors = useMemo(() => ({
    name: (r) => `${r.lastname ?? ""} ${r.firstname ?? ""}`.trim(),
    primary_type: (r) => r.primary_type ?? "",
    // #3815: sæson-alderen som tal, samme helper som cellen selv viser, så
    // rækkefølgen ikke kan drive fra det man læser.
    age: (r) => ageForSeason(r.birthdate, seasonYear),
    form: (r) => condition[r.id]?.form ?? null,
    fatigue: (r) => condition[r.id]?.fatigue ?? null,
    // #3706: samme to badges som Status-cellen viser, som ét sorterbart tal.
    status: (r) => (r.is_academy ? STATUS_ACADEMY_WEIGHT : 0)
      + (injuryDaysLeft(condition[r.id]?.injured_until, today) > 0 ? STATUS_INJURED_WEIGHT : 0),
  }), [condition, today, seasonYear]);
  const rosterAccessor = rosterSort.sort ? rosterAccessors[rosterSort.sort] : null;
  const sortRoster = (list) => sortRows(list, rosterAccessor, rosterSort.sortDir);

  // #4613: overbliksfladens tællinger. Alle fra data siden ALLEREDE har —
  // ingen nye kald, ingen opdigtede tal (en rytter uden condition tælles ikke
  // som i fare, han tælles slet ikke).
  const rosterCounts = useMemo(() => {
    let noPlan = 0;
    let risk = 0;
    let injured = 0;
    let racing = 0;
    for (const r of riders) {
      const cond = condition[r.id] ?? {};
      const isInjured = injuryDaysLeft(cond.injured_until, today) > 0;
      if (!planFor(r.id)?.focus) noPlan += 1;
      if (isInjured) injured += 1;
      else if ((cond.risk ?? 0) >= 0.05) risk += 1;
      if (racingToday[r.id]) racing += 1;
    }
    return { total: riders.length, planned: riders.length - noPlan, noPlan, risk, injured, racing };
  }, [riders, condition, today, planFor, racingToday]);

  // Ryttertyper der faktisk findes i truppen — filteret må ikke tilbyde en type
  // ingen rytter har (TASTE P11: ingen tomme valg).
  const rosterTypeOptions = useMemo(() => {
    const seen = new Set();
    for (const r of riders) if (r.primary_type) seen.add(r.primary_type);
    return [...seen].sort((a, b) => tTypes(`types.${a}`).localeCompare(tTypes(`types.${b}`)));
  }, [riders, tTypes]);

  const filteredRiders = useMemo(() => {
    const needle = rosterQuery.trim().toLowerCase();
    return riders.filter((r) => {
      if (needle && !`${r.firstname ?? ""} ${r.lastname ?? ""}`.toLowerCase().includes(needle)) return false;
      if (rosterType !== "all" && r.primary_type !== rosterType) return false;
      if (rosterView === "noplan" && planFor(r.id)?.focus) return false;
      if (rosterView === "racing" && !racingToday[r.id]) return false;
      if (rosterView === "risk") {
        const cond = condition[r.id] ?? {};
        const isInjured = injuryDaysLeft(cond.injured_until, today) > 0;
        if (!isInjured && (cond.risk ?? 0) < 0.05) return false;
      }
      return true;
    });
  }, [riders, rosterQuery, rosterType, rosterView, planFor, racingToday, condition, today]);

  const filtersActive = rosterQuery.trim() !== "" || rosterType !== "all" || rosterView !== "all";
  function clearRosterFilters() {
    setRosterQuery("");
    setRosterType("all");
    setRosterView("all");
  }

  // Vis enten flade rækker eller type-grupper. Begge bruger samme allerede-hentede
  // (og nu filtrerede) riders-array — ingen ny query — og samme aktive sortering.
  const groups = groupByType ? groupRidersByType(filteredRiders) : null;

  const allSelected = filteredRiders.length > 0 && filteredRiders.every((r) => selected.has(r.id));

  function toggleSelect(riderId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(riderId)) next.delete(riderId);
      else next.add(riderId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (
      filteredRiders.length > 0 && filteredRiders.every((r) => prev.has(r.id))
        ? new Set()
        : new Set(filteredRiders.map((r) => r.id))
    ));
  }

  function clearSelection() {
    setSelected(new Set());
    setBulkMsg(null);
  }

  function groupLabel(type) {
    return type === UNTYPED_KEY ? t("untypedGroup") : tTypes(`types.${type}`);
  }

  // Én roster-række (genbruges af både flad liste og type-grupperet visning).
  // #2819: isFirst markerer den øverste synlige roster-række som tour-anker.
  function renderRosterRow(rider, isFirst = false) {
    const plan = planFor(rider.id);
    const cond = condition[rider.id] ?? {};
    const daysLeft = injuryDaysLeft(cond.injured_until, today);
    const injured = daysLeft > 0;
    const highRisk = !injured && (cond.risk ?? 0) >= 0.05;
    const busy = savingId === rider.id || bulkApplying;
    const isSelected = selected.has(rider.id);

    // #3459 V3 / #4375: løbsdags-badge - feltet findes KUN når
    // race_day_development_enabled er on (backend udelader det helt ellers, se
    // useTraining.js), så tilstedeværelse alene er hele gaten. Planen
    // (fokus/intensitet) RØRES ALDRIG her - kun visning.
    const raceToday = racingToday[rider.id] ?? null;

    // #1895 PR 2: rytterens EGEN ugeplan-override, hvis sat — vinder over holdets
    // ugerytme for netop denne rytter (samme lagdeling som motoren).
    const riderOverrideDays = riderWeekPlans[rider.id] ?? null;
    const hasOwnWeekPlan = riderOverrideDays != null;

    // #2438 — "én sandhed pr. rytter": rytterens EGEN eksplicitte focus+intensity
    // (training_plans) overtrumfer holdets ugerytme; rytmen er kun default for
    // ryttere uden egen override. Samme lagdeling som motoren (training.js
    // resolveDayIntensity). Kun relevant til visning når holdet HAR en ugerytme.
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

    // #4613: de næste 7 dage som strimmel. Ren lagdeling af data siden allerede
    // har (lib/trainingWeekStrip.js, unit-testet) — ingen kalender fremad, så
    // kun I DAG kan bære en løbsmarkering.
    const weekStripDays = riderWeekStrip({
      fromDate: today,
      riderOverrideDays,
      teamWeekDays: weekPlan,
      planIntensity: plan?.intensity ?? "normal",
      hasExplicitPlan,
      racingToday: !!raceToday,
    });

    return (
      <tr key={rider.id} className={`${trClass(null)} ${isSelected ? "bg-cz-accent/5" : ""}`}>
        {/* Multi-select — sticky sammen med navnekolonnen (#2446), fast w-10 så
            offsettet på navnekolonnen (left-10) matcher præcis. */}
        <td className="border-t border-cz-border px-2 py-[7px] w-10 sticky-name-cell sticky left-0 z-sticky">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelect(rider.id)}
            aria-label={`${t("selectAll")} — ${rider.firstname} ${rider.lastname}`}
            className="h-4 w-4 rounded-[3px] accent-cz-accent"
          />
        </td>

        {/* Navn — sticky ved horisontal scroll (#2446), så rytter-identiteten aldrig
            forsvinder når man scroller ud til dag/uge-kolonnerne. Samme opskrift
            som RidersPage/TeamPage (.sticky-name-cell): den opake baggrund + 1px
            border-r ER den kanoniske sticky-first-column-recipe (T2). */}
        <td className="border-t border-cz-border px-4 py-[7px] sticky-name-cell sticky left-10 z-sticky border-r border-cz-border">
          {/* whitespace-nowrap: navnet er kolonnens naturlige bredde (DataTable-opskriften). */}
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <RiderLink id={rider.id} className="text-cz-1 font-medium hover:text-cz-accent transition-colors">
              {rider.firstname} {rider.lastname}
            </RiderLink>
          </div>
          {/* #3045: portræt-kolonnekontrakt — Type + Alder + Form + Træthed foldes
              ind i navne-underlinjen ≤640px (samme "DataTable fold"-mønster som
              RidersPage/TeamPage), så Dag + Uge beholder pladsen i
              portræt. #3194: underlinjen må ALDRIG diktere kolonnebredden —
              denne celle er STICKY, så max-w + ombrydning i stedet for nowrap. */}
          <div className="mt-0.5 sm:hidden max-w-[40vw] font-data text-3xs uppercase tracking-[.05em] text-cz-3">
            {[
              rider.primary_type
                ? (rider.secondary_type && rider.secondary_type !== rider.primary_type
                  ? `${tTypes(`types.${rider.primary_type}`)}/${tTypes(`types.${rider.secondary_type}`)}`
                  : tTypes(`types.${rider.primary_type}`))
                : null,
              `${t("colAge")} ${ageForSeason(rider.birthdate, seasonYear) ?? "—"}`,
              `${t("form")} ${cond.form ?? "—"}`,
              `${t("fatigue")} ${cond.fatigue ?? "—"}`,
            ].filter(Boolean).join(" · ")}
          </div>
        </td>

        {/* Ryttertype */}
        <td className={`${tdClass({ dense: true })} hidden sm:table-cell`}>
          <RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} />
        </td>

        {/* #3815: Alder. Sæson-alderen (ageForSeason, ikke wall-clock — #3071),
            samme tal som rytterprofilen og Development-fanen viser. "—" når
            sæson-året endnu ikke er hentet; en manglende alder er bedre end en
            forkert. */}
        <td className={`${tdClass({ numeric: true, compact: true, dense: true })} hidden sm:table-cell`}>
          <span className="text-cz-2">{ageForSeason(rider.birthdate, seasonYear) ?? "—"}</span>
        </td>

        {/* #4736 (ejer-review af #4613, 3/9): ÉN dags-celle pr. række. "Dag" og
            "Skift dag" stod side om side og sagde det samme, og de to kolonner
            skubbede Form, Træthed og Status ud over højre kant ved 1440 px.
            Segmentet er nu det primære — Hvile · Aktiv restitution · rytterens
            egen session — og de øvrige sessionstyper ligger bag "Andet", som
            åbner PRÆCIS det samme dags-panel som "Dag"-chippen gjorde. Uden en
            valgt dag beholder cellen "Vælg dag"-tilstanden med assistentens
            forslag. Samme mutationer som før, kun én celle i stedet for to. */}
        <td className={tdClass({ compact: true, dense: true })}>
          {/* #2819: tour-ankeret sidder på cellens wrapper, ikke på en af de to
              grene, så det findes uanset om rytteren har valgt en dag endnu. */}
          <div data-tour={isFirst ? "training-focus" : undefined}>
            {plan?.focus ? (
              <div
                role="group"
                aria-label={`${t("dayPanel.colDay")} — ${rider.firstname} ${rider.lastname}`}
                // #3459 V3: dæmpet (ikke deaktiveret) på løbsdage — planen er urørt og
                // gælder alle ikke-løbsdage, knapperne forbliver derfor fuldt aktive.
                className={`inline-flex rounded-cz border border-cz-border overflow-hidden ${raceToday ? "opacity-[0.55]" : ""}`}
              >
                {/* #3762: intensiteten er ikke længere et frit valg — den er en
                    egenskab ved sessionen. Knapperne skifter derfor DAGEN.
                    Sessions-knappen bærer rytterens egen session, som serveren
                    bevarer hen over en hviledag, så vejen tilbage er ét klik.
                    #4613: det aktive segment er guld-TEKST på 10% guld-flade,
                    samme anatomi som kittets Segmented (TASTE fork 3) — den
                    fyldte guld-knap var et andet guld-signal i hver række. */}
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
                      // #4736: kun sessions-labelen kan blive lang (fx
                      // "Klatreintervaller"), så kun den får et loft — og en
                      // title, så det fulde navn stadig kan læses. Hvile og
                      // Aktiv restitution står uafkortede.
                      title={isSession ? label : undefined}
                      className={`text-xs px-1.5 py-1 transition-colors disabled:opacity-50 ${
                        isSession ? "max-w-[96px] truncate" : "whitespace-nowrap"
                      } ${pressed ? "bg-cz-accent/10 font-semibold text-cz-accent-t" : "text-cz-2 hover:bg-cz-subtle"}`}
                    >
                      {label}
                    </button>
                  );
                })}
                {/* #4736: resten af sessionstyperne. Åbner den samme FocusPanel
                    (setFocusPanelRiderId) som den gamle Dag-chip, så vejen til
                    fx en klatreintervals-dag er præcis uændret. Chevronen alene
                    — teksten "Andet" ville koste ~44 px i hver række, og det var
                    netop de px der klippede Status af i højre kant. Navnet bor i
                    aria-label + title, så kontrollen stadig kan læses højt og
                    forklarer sig selv ved hover. */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setFocusPanelRiderId(rider.id)}
                  title={t("dayPanel.otherDay")}
                  aria-label={`${t("dayPanel.otherDay")} — ${rider.firstname} ${rider.lastname}`}
                  className="flex items-center border-s border-cz-border px-1.5 py-1 text-cz-3 transition-colors hover:bg-cz-subtle hover:text-cz-1 disabled:opacity-50"
                >
                  <ChevronDownIcon size={13} className="shrink-0" aria-hidden="true" />
                </button>
              </div>
            ) : (
              /* #3721: DELT FocusOpenButton — samme komponent/mutation som
                 Development-fanens rækker bruger (ingen forgrenet fokus-logik).
                 #4613: den stiplede advarsels-kant gør hullerne synlige ned
                 gennem kolonnen. Fejlen renderes én gang på celle-niveau
                 nedenfor, så den dækker BEGGE grene. */
              <FocusOpenButton
                rider={rider}
                plan={plan}
                busy={busy}
                smartFocus={smartDefaultFocus[rider.id]}
                onOpen={() => setFocusPanelRiderId(rider.id)}
                t={t}
              />
            )}
            {planActionError?.riderId === rider.id && (
              <div role="alert" className="mt-0.5 text-3xs text-cz-danger">
                {t([`planActionError_${planActionError.error}`, "planActionErrorGeneric"])}
              </div>
            )}
            {/* #2438 — "én sandhed pr. rytter": vis altid dagens EFFEKTIVE intensitet +
                kilden når holdet har en ugerytme, uanset om rytteren selv har en plan.
                Kompakt T2-meta-linje med den fulde forklaring som title-tooltip.
                #3459 V3: løbsdags-linjen ERSTATTER (ikke supplerer) rytme-hinten på
                dage rytteren racer i dag — racedagen ER dagens svar på "hvorfor". */}
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
          </div>
        </td>

        {/* #4613 — Uge: de næste 7 dage som strimmel, og samtidig indgangen til
            rytterens EGEN ugeplan (editoren bor på Ugeplan-fanen, jf.
            openRiderWeekPlan). Ugeplan-knappen havde før sin egen kolonne
            (#3300-rework); strimlen bærer nu både svaret og vejen videre, så
            rækken ikke har to celler til den samme ting. */}
        <td className={tdClass({ compact: true, dense: true })}>
          <button
            type="button"
            onClick={() => openRiderWeekPlan(rider.id)}
            data-tour={isFirst ? "training-next-up" : undefined}
            aria-label={`${t("individualWeekPlanToggleOpen")} — ${rider.firstname} ${rider.lastname}`}
            className="flex items-center gap-2 rounded-cz border border-transparent px-1 py-0.5 transition-colors hover:border-cz-border"
          >
            <TrainingWeekStrip days={weekStripDays} />
            {/* #1895 PR 2: markering for ryttere med egen ugeplan-override, så man
                kan se hvem der kører sit eget program uden at åbne panelet. */}
            {hasOwnWeekPlan && (
              <span
                className="inline-block whitespace-nowrap rounded-cz-pill border border-cz-accent/30 bg-cz-accent/10 px-1.5 py-0.5 text-3xs text-cz-accent-t"
                title={t("individualWeekPlanBadgeTitle")}
              >
                {t("individualWeekPlanBadge")}
              </span>
            )}
          </button>
        </td>

        {/* Form */}
        <td className={`${tdClass({ numeric: true, compact: true, dense: true })} hidden sm:table-cell`}>
          <ConditionCell value={cond.form} label={t("form")} />
        </td>

        {/* Træthed */}
        <td className={`${tdClass({ numeric: true, compact: true, dense: true })} hidden sm:table-cell`}>
          <ConditionCell value={cond.fatigue} label={t("fatigue")} tone={highRisk || injured ? "danger" : "neutral"} />
        </td>

        {/* Status: akademi + skadet / høj risiko. Ejer-feedback (rework af #3300):
            akademi-badgen skal stå i sin egen kolonne "på samme måde som badges
            andre steder" — samme RiderBadges-recipe og samme Status-kolonne som
            TeamPage/TeamProfilePage bundler badges i (injured/academy/age/risk/
            contract alt sammen under ÉN "Status"-header), i stedet for at ligge
            inline i navne-cellen. Ingen `hidden sm:table-cell` — kolonnen
            scroller vandret som resten af tabellen (#3194). */}
        <td className={tdClass({ dense: true })}>
          <div className="flex flex-wrap gap-1">
            {/* #3761: de to badges der afgør om træningen overhovedet er en
                investering værd — kontrakten udløber ved næste sæsonskifte,
                eller rytteren er i/lige før pensions-vinduet. Begge er
                allerede beregnede helpers (riderAge.js) og vises på TeamPage.
                is_academy udelades fra begge, ligesom på TeamPage. */}
            <RiderBadges badges={[
              rider.is_academy && "academy",
              !rider.is_academy && retirementRiskBadgeKey(rider, seasonYear),
              !rider.is_academy && contractExpiringBadgeKey(rider, activeSeasonNumber),
            ]} />
            {injured && (
              <span className="text-3xs px-2 py-0.5 rounded-cz-pill bg-cz-danger-bg text-cz-danger border border-cz-danger/30">
                {daysLeft === 1
                  ? t("injured", { days: daysLeft })
                  : t("injured_plural", { days: daysLeft })}
              </span>
            )}
            {highRisk && (
              <span className="text-3xs px-2 py-0.5 rounded-cz-pill bg-cz-warning/10 text-cz-warning border border-cz-warning/20">
                {t("injuryRisk")}
              </span>
            )}
          </div>
        </td>
      </tr>
    );
  }

  async function handleBulkApply() {
    setBulkMsg(null);
    if (!bulkDay) {
      setBulkMsg({ type: "warn", text: t("bulkPickFocus") });
      return;
    }
    const ids = [...selected];
    if (ids.length === 0) return;
    const { dayType, session } = bulkChoiceToDay(bulkDay);
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
    } else {
      setBulkMsg({
        type: "partial",
        text: t("bulkPartial", { applied: result.applied, total: ids.length, failed: result.failed.length }),
      });
      // Behold de fejlede valgte, så brugeren kan prøve igen.
      setSelected(new Set(result.failed.map((f) => f.riderId)));
    }
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

  // Sidehoved-status (T2 PageHeader subtitle) — samme 3 tilstande som før.
  const headerStatus = todayRun
    ? <span className="text-cz-success font-medium">{trainedTodayLabel()}</span>
    : !enabled
      ? <span className="italic">{t("disabledNote")}</span>
      : t("notTrainedYetToday");

  // #4613: tom-tilstanden på en side hvor man endnu ikke HAR nogen ryttere —
  // handling + én knap (TASTE fork 4), ikke en beskrivelse af et hul.
  const noRidersState = (
    <EmptyState
      icon={<TeamIcon size={26} aria-hidden="true" />}
      title={t("noRiders")}
      description={t("noRidersHint")}
      action={
        <Link to="/auctions" className={buttonClass({ variant: "secondary", size: "sm" })}>
          {t("noRidersAction")}
        </Link>
      }
    />
  );

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
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* #4522: "Get suggestions from the assistant" — sekundær, stroke-ikon
                (aldrig gold). Åbner gennemsyns-panelet; intet anvendes før accept. */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconLeft={<StarIcon size={14} aria-hidden="true" />}
              onClick={handleOpenAssistantPanel}
            >
              {t("assistantSuggestions.openButton")}
            </Button>
            {/* #2819: tour-anker på dagens knap. Wrapper-span frem for data-tour på
                <Button>, så ankeret overlever uanset om Button videresender data-*.
                #4522: mens forslags-panelet er åbent bærer panelets "Accept selected"
                sidens ENE gold primary — denne knap dæmpes til secondary så længe
                panelet er åbent. */}
            <span data-tour="training-run-today" className="inline-flex">
              <Button
                type="button"
                variant={assistantPanelOpen ? "secondary" : "primary"}
                size="sm"
                onClick={handleRunToday}
                disabled={!enabled || !!todayRun || running}
              >
                {running ? t("loading") : t("trainToday")}
              </Button>
            </span>
          </div>
        }
      />

      {/* #3721/#4613: faner, ?tab=-synkroniseret og DATA-DREVET (TRAINING_TAB_DEFS
          — Program #4629 og Løbsdag #4632 kobles på som ét element hver, når de
          er bygget). Én gold primary-knap pr. view (trainToday i sidehovedet) —
          fanebjælken bærer ingen egen primary. */}
      <Tabs value={activeTab} onChange={setTab} className="mt-1">
        <TabList label={t("title")} className="mb-4">
          {TRAINING_TAB_DEFS.map((tab) => (
            <Tab key={tab.value} value={tab.value}>{t(tab.labelKey)}</Tab>
          ))}
        </TabList>

      {/* ── Overblik: truppen som én tæt liste (retning B, #4613) ───────────── */}
      <TabPanel value="today">
      <div className="space-y-3">
        {/* #4522 (ejer-direktiv 31/8): assistent-panelet — lukket som standard,
            åbnes fra sidehovedet. Card med accent-hairline-border. */}
        {assistantPanelOpen && (
          /* Merge med main 3/9: mains scroll-i-syne-wrapper (assistantPanelRef)
             er BEVIDST væk — #4613 flyttede panelet op som det ØVERSTE element i
             overbliksfanen, så der ikke er noget at scrolle til. #4699's faktiske
             rettelse (acceptableCount) er beholdt uændret. */
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
        )}

        {runError && (
          <p className="text-cz-danger text-sm">{runError}</p>
        )}

        {riders.length === 0 ? noRidersState : (
          <>
            {/* #4613: den slanke overbliks-stribe. Ikke stat-kort — én linje der
                svarer på "hvad kræver min opmærksomhed i dag", så rytterrækkerne
                bliver over folden. Hvert tal står ÉT sted på siden. */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-cz border border-cz-border bg-cz-card px-3.5 py-2 text-[12.5px] text-cz-2">
              <span>{t("overview.planned", { n: rosterCounts.planned })}</span>
              <span className={rosterCounts.noPlan > 0 ? "text-cz-warning" : undefined}>
                {t("overview.noPlan", { n: rosterCounts.noPlan })}
              </span>
              <span className={rosterCounts.risk > 0 ? "text-cz-danger" : undefined}>
                {t("overview.risk", { n: rosterCounts.risk })}
              </span>
              {rosterCounts.injured > 0 && <span>{t("overview.injured", { n: rosterCounts.injured })}</span>}
              {rosterCounts.racing > 0 && <span>{t("overview.racing", { n: rosterCounts.racing })}</span>}
            </div>

            {/* Den kanoniske T2-filterlinje (#4625): søgefelt + ryttertype +
                gruppér-efter-type, og det stille Hjælp-link som trailing action
                (erstatter den slettede FAQ-prosa, #3721). */}
            <FilterBar
              search={{
                value: rosterQuery,
                onChange: (e) => setRosterQuery(e.target.value),
                placeholder: t("overview.searchPlaceholder"),
              }}
              filters={[
                {
                  key: "type",
                  value: rosterType,
                  onChange: (e) => setRosterType(e.target.value),
                  ariaLabel: t("colType"),
                  options: [
                    { value: "all", label: t("overview.allTypes") },
                    ...rosterTypeOptions.map((type) => ({ value: type, label: tTypes(`types.${type}`) })),
                  ],
                },
              ]}
              checkbox={{
                id: "training-group-by-type",
                label: t("groupByType"),
                checked: groupByType,
                onChange: (e) => setGroupByType(e.target.checked),
              }}
              trailing={
                <Link
                  to="/help?section=dailytraining"
                  className="text-2xs text-cz-3 hover:text-cz-accent underline decoration-dotted whitespace-nowrap"
                >
                  {t("howTrainingWorksLink")}
                </Link>
              }
              meta={t("overview.showing", { shown: filteredRiders.length, total: riders.length })}
            />

            {/* #4293: "This season"-kvitteringen bor på Udvikling-fanen, men noten
                om en sæson der ikke er begyndt hører til der hvor tallet mangler —
                se TabPanel value="development". */}
            <div className={WRAP}>
              {/* #4628: tabellens EGNE kontroller i toolbar-slotten, inde i
                  hairline-rammen — status-segmentet, mobil-sorteringen og
                  bulk-bjælken. De lå før som løsrevne rækker mellem sidehovedet
                  og tabellen (PAGE_TEMPLATES "no orphan action rows"). */}
              <div className="flex flex-wrap items-center gap-2 border-b border-cz-border px-4 py-2.5">
                <Segmented
                  label={t("overview.viewLabel")}
                  value={rosterView}
                  onChange={setRosterView}
                  options={ROSTER_VIEWS.map((view) => ({
                    value: view,
                    label: view === "all"
                      ? t("overview.viewAll")
                      : view === "noplan"
                        ? t("overview.viewNoPlan", { n: rosterCounts.noPlan })
                        : view === "risk"
                          ? t("overview.viewRisk", { n: rosterCounts.risk })
                          : t("overview.viewRacing", { n: rosterCounts.racing }),
                  }))}
                />
                <RosterMobileSortControl
                  sort={rosterSort.sort}
                  sortDir={rosterSort.sortDir}
                  onSort={rosterSort.handleSort}
                  t={t}
                />

                {/* Bulk-apply (#1480) — kun når ryttere er valgt. */}
                {selected.size > 0 && (
                  <div className="flex w-full flex-wrap items-center gap-2 border-t border-cz-border pt-2.5">
                    <span className="text-sm font-medium text-cz-1">{t("selected", { n: selected.size })}</span>
                    {/* #3762: ét valg, ikke to. Listen er de DAGE der findes,
                        grupperet som i panelet — så en markering aldrig kan give
                        en kombination den enkelte rytter ikke kunne have fået. */}
                    <div className="w-56">
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
                      {bulkApplying ? t("bulkApplying") : t("bulkApply", { n: selected.size })}
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
                  </div>
                )}
              </div>

              <div className={SCROLLER}>
                <table className={TABLE} data-sortable>
                  <thead>
                    <tr>
                      {/* Sticky sammen med navne-headeren nedenfor (#2446) — fast w-10 så
                          offsettet på navne-kolonnen (left-10) matcher præcis. */}
                      <th className={`${thClass({ dense: true })} sticky-name-cell sticky left-0 z-sticky w-10`}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          aria-label={t("selectAll")}
                          className="h-4 w-4 rounded-[3px] accent-cz-accent"
                        />
                      </th>
                      <SortTh sortKey="name" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                        className={`${thClass({ dense: true })} sticky-name-cell sticky left-10 z-sticky border-r border-cz-border`}>
                        {t("colRider")}
                      </SortTh>
                      {/* #3045: Type/Alder/Form/Træthed foldes ind i navne-underlinjen
                          ≤640px (samme portræt-kolonnekontrakt som de andre
                          rytterflader), så Dag + Uge — dem man rent
                          faktisk REDIGERER — beholder pladsen i portræt. */}
                      <SortTh sortKey="primary_type" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                        className={`${thClass({ dense: true })} hidden sm:table-cell`}>
                        {t("colType")}
                      </SortTh>
                      {/* #3815: alderen er den vigtigste enkeltvariabel når man
                          vælger hvem der skal trænes hårdt (@knud_r_flink,
                          Discord 15/8), og manglede netop dér hvor valget
                          træffes. Kompakt numerisk kolonne, samme portræt-
                          kontrakt som Type/Form/Træthed (#3045). */}
                      <SortTh sortKey="age" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                        className={`${thClass({ numeric: true, compact: true, dense: true })} hidden sm:table-cell`}>
                        {t("colAge")}
                      </SortTh>
                      {/* #3762: kolonnen hedder det den indeholder — én dag.
                          #4736: "Dag" og "Skift dag" var to kolonner om det
                          samme og klippede Form/Træthed/Status af ved 1440 px;
                          nu er der ét kontrol under ÉN overskrift. */}
                      <th className={thClass({ compact: true, dense: true })}>{t("dayPanel.colDay")}</th>
                      {/* #4613: de næste 7 dage. */}
                      <th className={thClass({ compact: true, dense: true })}>{t("colWeek")}</th>
                      <SortTh sortKey="form" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                        className={`${thClass({ numeric: true, compact: true, dense: true })} hidden sm:table-cell`}>
                        {t("form")}
                      </SortTh>
                      <SortTh sortKey="fatigue" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                        className={`${thClass({ numeric: true, compact: true, dense: true })} hidden sm:table-cell`}>
                        {t("fatigue")}
                      </SortTh>
                      {/* #3706: var et bart <th> — overskriften kunne klikkes uden
                          at der skete noget (@cybersimon, Discord 13/8). Nu samme
                          SortTh-recipe som navn/type/form/træthed. */}
                      <SortTh sortKey="status" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                        className={thClass({ dense: true })}>
                        {t("colStatus")}
                      </SortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {/* PAGE_TEMPLATES "Canonical states": ved et filter der tømmer
                        tabellen swappes <tbody>, ikke hele kortet — ellers ryger
                        toolbaren med, og filteret kan ikke slås fra igen. */}
                    {filteredRiders.length === 0 ? (
                      <tr>
                        <td colSpan={ROSTER_COLS} className="border-t border-cz-border p-4">
                          <EmptyState
                            icon={<TeamIcon size={26} aria-hidden="true" />}
                            title={t("overview.emptyFiltered")}
                            description={t("overview.emptyFilteredHint")}
                            action={
                              <Button type="button" variant="secondary" size="sm" onClick={clearRosterFilters} disabled={!filtersActive}>
                                {t("overview.clearFilters")}
                              </Button>
                            }
                          />
                        </td>
                      </tr>
                    ) : groupByType
                      ? groups.map((group, gi) => (
                          <Fragment key={group.type}>
                            <tr className="bg-cz-subtle/60">
                              <td colSpan={ROSTER_COLS} className="border-t border-cz-border px-4 py-2">
                                <span className="font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-2">
                                  {groupLabel(group.type)}
                                </span>
                                <span className="ms-2 font-data text-2xs text-cz-3">
                                  {t("groupCount", { n: group.riders.length })}
                                </span>
                              </td>
                            </tr>
                            {sortRoster(group.riders).map((rider, ri) => renderRosterRow(rider, gi === 0 && ri === 0))}
                          </Fragment>
                        ))
                      : sortRoster(filteredRiders).map((rider, ri) => renderRosterRow(rider, ri === 0))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className={COUNT}>{t("overview.showing", { shown: filteredRiders.length, total: riders.length })}</div>
          </>
        )}
      </div>
      </TabPanel>

      {/* ── Ugeplan: holdets rytme + rytterens egen ugeplan ─────────────────── */}
      {/* #3746 trin 7: den ugentlige rytme-editor som en åben sektion (ikke en
          accordion). #4613: den individuelle ugeplan pr. rytter er FLYTTET
          hertil fra roster-rækken — samme state, samme handlers, samme markup,
          bare på den fane den hører til. Ingen nye API-kald: riderWeekPlans/
          weekPlan kommer begge fra useTraining, allerede hentet af siden. */}
      <TabPanel value="weekplan">
      <div className="space-y-3.5">
        <Card className="overflow-hidden">
          <div className="px-4 py-3 sm:px-5 border-b border-cz-border">
            <span className="text-[15px] font-semibold text-cz-1">{t("weekRhythmTitle")}</span>
          </div>
          <div className="px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
            {/* Kort på fladen, manualen i Hjælp (#4025): én linje her, hele
                lagdelingen i help.json dailytraining.weeklyRhythm. */}
            <p className="text-[13px] text-cz-2">{t("weekRhythmIntro")}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              {WEEKDAY_KEYS.map((weekday) => {
                const current = (activeWeekDays ?? flatWeekTemplate())[weekday]?.intensity ?? "normal";
                return (
                  <div key={weekday} className="flex flex-col items-center gap-1">
                    <span className="font-data text-3xs uppercase tracking-[.05em] text-cz-3">{t(`weekday_${weekday}`)}</span>
                    <div className="w-[92px]">
                      <Select
                        size="sm"
                        value={current}
                        disabled={savingWeekPlan}
                        aria-label={`${t("weekRhythmTitle")} — ${t(`weekday_${weekday}`)}`}
                        onChange={(e) => setWeekDraftDay(weekday, e.target.value)}
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

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" size="sm" onClick={handleSaveWeekPlan} disabled={savingWeekPlan}>
                {savingWeekPlan ? t("loading") : t("weekRhythmSave")}
              </Button>
              {weekPlan && (
                <Button type="button" variant="danger" size="sm" onClick={handleResetWeekPlan} disabled={savingWeekPlan}>
                  {t("weekRhythmResetButton")}
                </Button>
              )}
              {weekPlanMsg && (
                <span className={`text-xs ${weekPlanMsg.type === "ok" ? "text-cz-success" : "text-cz-danger"}`}>
                  {weekPlanMsg.text}
                </span>
              )}
              <Link
                to="/help?section=dailytraining"
                className="ms-auto text-2xs text-cz-3 hover:text-cz-accent underline decoration-dotted whitespace-nowrap"
              >
                {t("howTrainingWorksLink")}
              </Link>
            </div>
          </div>
        </Card>

        {/* #4613: den individuelle ugeplan pr. rytter. Kom fra roster-rækkens
            udvidelige række; ÉN rytter udvidet ad gangen, som før. Rører ALDRIG
            fokus; overstyrer KUN holdets ugerytme for netop denne rytter. */}
        <Card className="overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 border-b border-cz-border px-4 py-3 sm:px-5">
            <span className="text-[15px] font-semibold text-cz-1">{t("individualWeekPlanOverviewTitle")}</span>
            <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">
              {t("individualWeekPlanCount", { n: riders.filter((r) => riderWeekPlans[r.id] != null).length })}
            </span>
          </div>
          {riders.length === 0 ? (
            <div className="p-4 sm:p-5">{noRidersState}</div>
          ) : (
            <div className="divide-y divide-cz-border">
              {riders.map((rider) => {
                const hasOwnWeekPlan = riderWeekPlans[rider.id] != null;
                const isExpanded = expandedRiderId === rider.id;
                const savingRiderPlan = savingRiderWeekPlanId === rider.id;
                return (
                  <div key={rider.id} className="px-4 py-2.5 sm:px-5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <RiderLink id={rider.id} className="min-w-[150px] text-[13.5px] font-medium text-cz-1 hover:text-cz-accent transition-colors">
                        {rider.firstname} {rider.lastname}
                      </RiderLink>
                      {hasOwnWeekPlan ? (
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {WEEKDAY_KEYS.map((weekday) => (
                            <span key={weekday} className="font-data text-3xs uppercase tracking-[.05em] text-cz-3 whitespace-nowrap">
                              {t(`weekday_${weekday}`)}{" "}
                              <span className="text-cz-2">
                                {tRider(`training.intensity_${riderWeekPlans[rider.id]?.[weekday]?.intensity ?? "normal"}`)}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="font-data text-3xs uppercase tracking-[.05em] text-cz-3">
                          {t("individualWeekPlanFollowsTeam")}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleRiderWeekPlan(rider.id)}
                        className="ms-auto text-2xs text-cz-3 hover:text-cz-accent underline decoration-dotted whitespace-nowrap"
                      >
                        {isExpanded ? t("individualWeekPlanToggleClose") : t("individualWeekPlanToggleOpen")}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="mt-2.5 flex flex-col gap-2 border-t border-cz-border pt-2.5">
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
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
      </TabPanel>

      {/* ── Udvikling: prognose-båndet + sæsonens kvittering pr. evne ────────── */}
      {/* #3721: én række pr. rytter i truppen: navn+alder, udviklings-glyffen
          (DevelopmentGlyph, FAST 0-99-skala), tallene "now · lo-hi · loft", og
          den SAMME FocusOpenButton/FocusPanel-mutation som overbliks-rækken
          bruger. #4613: sæsonens kvittering pr. evne (#3709 trin 1) er flyttet
          hertil fra roster-kolonnen — det er samme spørgsmål som fanen
          allerede svarer på, og overbliksrækken kunne ikke bære 3-4 linjer. */}
      <TabPanel value="development">
        {riders.length === 0 ? noRidersState : (
          <>
            {/* #4293: kvitteringens sæson-kolonne står tom både når sæsonen er
                aktiv men ikke begyndt, og på sæsonens første morgen før dagens
                tick. Fladen siger roligt hvorfor. Samme copy-nøgle som
                rytterprofilens kvittering, så de to ikke kan sige forskellige
                ting. */}
            {(history.seasonState === SEASON_RECEIPT_NOT_STARTED || history.seasonState === SEASON_RECEIPT_NO_DAYS) && history.seasonStart && (
              <p className="mb-2 text-2xs text-cz-3 leading-snug">
                {t(SEASON_RECEIPT_NOTE_KEY[history.seasonState], { date: formatDate(history.seasonStart) })}
              </p>
            )}
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
                  // estimate.role er båndets egen nøgle (samme payload som
                  // tallene); primary_type er kun fallback for rækker uden bånd.
                  const roleKey = estimate?.role ?? rider.primary_type ?? null;
                  const roleLabel = roleKey ? tTypes(`types.${roleKey}`) : null;
                  // #3709 trin 1: kvitteringen for fokussets 2-3 evner. Hver
                  // evne står på sin egen linje med nu / sæson / på vej, og en
                  // låst evne skriver "færdig" i stedet for en død bar.
                  // `capped` er kun ability-NØGLER — cap-tal forlader aldrig
                  // serveren (#1162).
                  const focusReceipt = focusAbilityReceipt(plan?.focus, {
                    abilities: rider.abilities,
                    progress: progress[rider.id],
                    capped: capped[rider.id],
                    seasonGains: seasonGainsByRider[rider.id] ?? null,
                    // #3924 trin 2: gårsdagens bidrag som mørkere segment på
                    // baren — begge fra samme todayRun-linje, null når rytteren
                    // ikke indgik i dagens kørsel.
                    progressBefore: todayRowByRider[rider.id]?.progress_before ?? null,
                    gainsToday: todayRowByRider[rider.id]?.gains ?? null,
                  });
                  return (
                    <div key={rider.id} data-rider-id={rider.id} className="flex flex-wrap items-start gap-4 px-4 py-[13px] sm:px-5">
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
                            <span className="font-mono tabular-nums text-2xs text-cz-1">{riderStatRating(rider) || "—"}</span>
                            <span className="text-cz-3 text-3xs italic">{t("development.noForecastYet")}</span>
                          </div>
                        )}
                      </div>

                      <div className="min-w-[190px] flex-1">
                        <div className="font-data text-3xs uppercase tracking-[.08em] text-cz-3">{t("receipt.title")}</div>
                        {focusReceipt ? (
                          <div className="mt-1">
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
          </>
        )}
      </TabPanel>

      {/* ── Rapporter: dagens kvittering + de seneste 30 dage ────────────────── */}
      {/* #4613: dagens rapport, udviklings-momentet, gårsdagens kvittering og
          tick-beskeden lå alle stablet under rosteret på Train today. De hører
          sammen — det er dagens KVITTERING, ikke dagens VALG — og bor nu her,
          sammen med den uændrede historik (#1533). */}
      <TabPanel value="history">
      <div className="space-y-3.5">
        {/* Dagligt udviklings-moment (#2484, H3) — ÉN kurateret historie fra
            seneste kørsel i stedet for kun rå tal. */}
        <TrainingMoment
          latestRun={latestRun}
          isToday={latestIsToday}
          progressByRider={progress}
          pastRuns={pastRuns}
        />

        {/* #3924 trin 1 (design-go 20/8): "Yesterday's gains" — ÉN resumé-linje,
            foldet ud til en kvalitativ linje pr. rytter. Genbruger
            CollapsibleSection (#3914's delte fold-primitiv); ingen ny
            beregning — todayRun + live progress. Skjult uden en dagens kørsel. */}
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

        {/* Tick-model-besked (#1936): når dagens træning er kørt, gælder
            ændringer fra i morgen. Kort på fladen; hele mekanikken står i
            Hjælp (dailytraining.trainToday / formFatigue). */}
        {todayRun && (
          <div className="bg-cz-accent/5 border border-cz-accent/20 rounded-cz px-4 py-2.5">
            <p className="text-[13px] text-cz-2">{t("tickModelDone")}</p>
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
                    // efterfølgende. injuryDaysLeft på den samme condition-state
                    // som roster-rækken og ConditionChips på rytterprofilen er
                    // ÉN kanonisk kilde, så de tre visninger ikke kan divergere.
                    const reportDaysLeft = injuryDaysLeft(condition[row.rider_id]?.injured_until, today);
                    const reportInjured = reportDaysLeft > 0;
                    return (
                      <tr
                        key={row.rider_id}
                        className={`group transition-colors duration-150 hover:bg-cz-subtle ${breakthrough ? "bg-cz-success-bg" : ""}`}
                      >
                        <td className={tdClass({ sticky: true })}>
                          <RiderLink id={row.rider_id} className="text-cz-1 font-medium hover:text-cz-accent transition-colors">
                            {row.name}
                          </RiderLink>
                          {reportInjured && (
                            <span className="ms-2 text-3xs px-1.5 py-0.5 rounded-cz-pill bg-cz-danger-bg text-cz-danger">
                              {reportDaysLeft === 1
                                ? t("injured", { days: reportDaysLeft })
                                : t("injured_plural", { days: reportDaysLeft })}
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

        {/* Træningsrapport-historik (#1533) — seneste 30 dage, uændret. */}
        <TrainingHistory history={history} />
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
                injuryDaysLeft(condition[focusPanelRider.id]?.injured_until, today) > 0 && "injured",
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
