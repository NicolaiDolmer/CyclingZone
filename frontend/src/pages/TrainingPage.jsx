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
import { useScouting } from "../lib/useScouting.js";
import { useActiveSeasonYear } from "../hooks/useActiveSeasonYear.js";
import { ageForSeason } from "../lib/riderAge.js";
import { riderStatRating } from "../lib/riderRating.js";
import { TRAINING_INTENSITIES, injuryDaysLeft, WEEKDAY_KEYS, weekdayKeyForDate, resolveDayIntensityDisplay, resolveDayIntensitySource } from "../lib/training.js";
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
import { focusProgress, daySummary, breakthroughJumps, isBreakthrough, todayGainTotal, NEAR_BREAKTHROUGH, seasonAbilityGains, focusAbilityReceipt, yesterdaySummary, riderDayStories, SEASON_RECEIPT_RUNNING, SEASON_RECEIPT_NOT_STARTED } from "../lib/trainingReport.js";
import { formatDate } from "../lib/intl.js";
import { ABILITY_SELECT, flattenAbilities } from "../lib/abilities.js";
import AbilityReceiptRow from "../components/training/AbilityReceiptRow.jsx";
import FocusPanel from "../components/training/FocusPanel.jsx";
import TrainingHistory from "../components/training/TrainingHistory.jsx";
import TrainingMoment from "../components/training/TrainingMoment.jsx";
import DevelopmentGlyph from "../components/development/DevelopmentGlyph.jsx";
import OnboardingTour from "../components/OnboardingTour.jsx";
import SortTh from "../components/rider/RiderSortTh.jsx";
import { useSortState, sortRows } from "../lib/useTableSort.js";
import {
  PageHeader, Card, Button, Select, Checkbox,
  PageLoader, EmptyState, ChevronDownIcon, TeamIcon,
  ArrowUpIcon, ArrowDownIcon, FlagIcon,
  Tabs, TabList, Tab, TabPanel, CollapsibleSection,
} from "../components/ui";
import { WRAP, SCROLLER, TABLE, COUNT, thClass, tdClass, trClass } from "../components/ui/dataTableStyles.js";

// #3721: siden fik faner (Train today / Development / History), ?tab=-
// synkroniseret efter samme mønster som FinancePage/RiderStatsPage. Ukendt
// eller manglende param falder tilbage til "today".
// #3746 trin 7 (ejer-beslutning 20/8): "weekplan" er ny fane nr. 2 — den
// ugentlige rytme-editor flyttet ud af Train today, se TabPanel value="weekplan".
// Siden er nu 4 faner: today, weekplan, development, history.
const TRAINING_TABS = ["today", "weekplan", "development", "history"];

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
const ROSTER_DESC_FIRST = new Set(["form", "fatigue", "status"]);

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
        <span className="min-w-0">
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
function RosterMobileSortControl({ sort, sortDir, onSort, t }) {
  const options = [
    { key: "name", label: t("colRider") },
    { key: "primary_type", label: t("colType") },
    { key: "form", label: t("form") },
    { key: "fatigue", label: t("fatigue") },
    // #3706: Status blev sorterbar — kontrollen skal blive ved med at eksponere
    // PRÆCIS de samme nøgler som desktop-headerne.
    { key: "status", label: t("colStatus") },
  ];
  const dirAria = sortDir === "desc" ? t("mobileSort.descAria") : t("mobileSort.ascAria");

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

  // #3721: tre faner, ?tab=-synkroniseret efter samme mønster som FinancePage/
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

  // #3746 trin 7: Week plan-fanens "gå til rosteret"-knap — den simple løsning
  // for #4 i issuet (ingen ny data/redigering på denne fane, kun link til
  // rosteret på Train today). Skifter fane og scroller roster-tabellen i
  // synsfeltet, når today-panelet er mountet igen (TabPanel unmounter inaktive
  // faner, så scrollet skal vente på næste render efter fane-skiftet).
  const rosterTableRef = useRef(null);
  const [scrollToRosterPending, setScrollToRosterPending] = useState(false);
  function handleGoToRoster() {
    setScrollToRosterPending(true);
    setTab("today");
  }
  useEffect(() => {
    if (activeTab === "today" && scrollToRosterPending) {
      rosterTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setScrollToRosterPending(false);
    }
  }, [activeTab, scrollToRosterPending]);

  // #3721: Development-fanens prognose-bånd — samme kilde som spejder-fladerne
  // (POST /api/scouting/estimates via useScouting). Egne ryttere er altid et
  // bånd (isOwn i backend/lib/scouting.js), så INGEN scout-knap/slots er
  // relevante her — kun requestEstimates + estimateFor bruges.
  const { requestEstimates, estimateFor } = useScouting();
  const seasonYear = useActiveSeasonYear();

  const training = useTraining();
  const {
    enabled, todayRun, condition, progress, capped, trainability, smartDefaultFocus, loading,
    savingId, running, bulkApplying, setPlan, setPlanBulk, clearPlan, planFor, runToday,
    weekPlan, savingWeekPlan, setWeekPlan, clearWeekPlan,
    riderWeekPlans, savingRiderWeekPlanId, setRiderWeekPlan, clearRiderWeekPlan,
    racingToday,
  } = training;

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
        // intet nyt kald) — feltet findes allerede på riders, kun mangel på
        // visning på trænings-siden.
        // #3709 trin 1: + de 15 evne-kolonner via det delte ABILITY_SELECT-embed
        // (samme mønster som AuctionsPage/RidersPage). Kvitteringen skal vise hvad
        // evnen står på NU, og uden dette embed havde rækken kun fremdrifts-
        // procenten. Ingen ny query og ingen loft-tal: ability_caps er ikke med i
        // ABILITY_KEYS og forlader aldrig serveren (#1162).
        // #3721: + birthdate — Development-fanens navn+alder-række har brug for
        // det (samme ageForSeason-helper som rytterprofilen). Ingen ny query.
        const { data } = await supabase
          .from("riders")
          .select(`id, firstname, lastname, birthdate, primary_type, secondary_type, is_academy, ${ABILITY_SELECT}`)
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

  const isLoading = loading || ridersLoading;

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
  // mellem to sæsoner). Da er der ingen sæsondage at kvittere for, og map'et
  // bliver tomt — rækkerne får seasonGains = null og viser "—" i stedet for et
  // målt "+0" om en periode der ikke er begyndt.
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
  const ROSTER_COLS = 10;

  // Accessors til roster-sortering. form/fatigue bor i condition-map'et (ikke på
  // rytteren), så closure over condition — useMemo holder referencen stabil pr.
  // condition-ændring så sorteringen ikke re-kører hver render.
  const rosterAccessors = useMemo(() => ({
    name: (r) => `${r.lastname ?? ""} ${r.firstname ?? ""}`.trim(),
    primary_type: (r) => r.primary_type ?? "",
    form: (r) => condition[r.id]?.form ?? null,
    fatigue: (r) => condition[r.id]?.fatigue ?? null,
    // #3706: samme to badges som Status-cellen viser, som ét sorterbart tal.
    // injuryDaysLeft er den samme kilde cellen selv bruger, så rækkefølgen kan
    // ikke drive fra det man ser.
    status: (r) => (r.is_academy ? STATUS_ACADEMY_WEIGHT : 0)
      + (injuryDaysLeft(condition[r.id]?.injured_until, today) > 0 ? STATUS_INJURED_WEIGHT : 0),
  }), [condition, today]);
  const rosterAccessor = rosterSort.sort ? rosterAccessors[rosterSort.sort] : null;
  const sortRoster = (list) => sortRows(list, rosterAccessor, rosterSort.sortDir);

  // Vis enten flade rækker eller type-grupper. Begge bruger samme allerede-hentede
  // riders-array (ingen ny query) og den samme aktive sortering.
  const groups = groupByType ? groupRidersByType(riders) : null;

  const allSelected = riders.length > 0 && selected.size === riders.length;

  function toggleSelect(riderId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(riderId)) next.delete(riderId);
      else next.add(riderId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === riders.length ? new Set() : new Set(riders.map((r) => r.id))));
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
    const daysLeft = injuryDaysLeft(cond.injured_until, today);
    const injured = daysLeft > 0;
    const highRisk = !injured && (cond.risk ?? 0) >= 0.05;
    const busy = savingId === rider.id || bulkApplying;
    const isSelected = selected.has(rider.id);
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

    // #3459 V3: løbsdags-badge — feltet findes KUN når race_day_engine_enabled er
    // on (backend udelader det helt ellers, se useTraining.js), så tilstedeværelse
    // alene er hele gaten. Planen (fokus/intensitet) RØRES ALDRIG her — kun visning.
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
        <td className="border-t border-cz-border px-2 py-3 w-10 sticky-name-cell sticky left-0 z-sticky">
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
        <td className="border-t border-cz-border px-4 py-3 sticky-name-cell sticky left-10 z-sticky border-r border-cz-border">
          {/* whitespace-nowrap: navnet er kolonnens naturlige bredde (DataTable-opskriften)
              — uden den kollapser cellen til underlinjens max-w og ombryder navnet. */}
          <div className="flex items-center gap-1.5 whitespace-nowrap">
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
            {[
              rider.primary_type
                ? (rider.secondary_type && rider.secondary_type !== rider.primary_type
                  ? `${tTypes(`types.${rider.primary_type}`)}/${tTypes(`types.${rider.secondary_type}`)}`
                  : tTypes(`types.${rider.primary_type}`))
                : null,
              `${t("form")} ${cond.form ?? "—"}`,
              `${t("fatigue")} ${cond.fatigue ?? "—"}`,
            ].filter(Boolean).join(" · ")}
          </div>
        </td>

        {/* Ryttertype */}
        <td className={`${tdClass({})} hidden sm:table-cell`}>
          <RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} />
        </td>

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
        <td className={tdClass({})}>
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

        {/* Intensitet */}
        <td className={tdClass({})}>
          {plan?.focus ? (
            <div
              role="group"
              aria-label={`${t("dayPanel.colChangeDay")} — ${rider.firstname} ${rider.lastname}`}
              // #3459 V3: dæmpet (ikke deaktiveret) på løbsdage — planen er urørt og
              // gælder alle ikke-løbsdage, knapperne forbliver derfor fuldt aktive.
              className={`inline-flex rounded-cz border border-cz-border overflow-hidden ${raceToday ? "opacity-[0.55]" : ""}`}
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

        {/* #3709 trin 1: kvitteringen for fokussets egne evner. Hver evne får
            sin egen linje med nu / point i sæsonen / på vej, og en låst evne
            skriver "færdig". Den gamle ene aggregerede bar viste kun evnen
            tættest på gennembrud (#3639), og de tre loft-tekster lovede at en
            evne aldrig steg igen — et løfte den nye model gør usandt (#3649). */}
        <td className={tdClass({})} data-tour={isFirst ? "training-next-up" : undefined}>
          {focusReceipt ? (
            <div className="min-w-[176px]">
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
        <td className={tdClass({})}>
          <div className="flex flex-wrap gap-1">
            <RiderBadges badges={[rider.is_academy && "academy"]} />
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

        {/* Individuel ugeplan — egen kolonne (rework af #3300, ejer-feedback: knappen
            der åbner rytterens egen ugeplan skal ikke ligge i navne-cellen, men have
            sin egen kolonne, ligesom akademi-badgen ovenfor). Ingen `hidden sm:table-
            cell` — skal virke på mobil ligesom badges-kolonnen. */}
        <td className={tdClass({})}>
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
      </tr>

      {/* #1895 PR 2: individuel ugeplan-flade — udvidet inline-række under rytteren.
          Rører ALDRIG fokus; overstyrer KUN holdets ugerytme for netop denne rytter. */}
      {isExpanded && (
        <tr className="bg-cz-subtle/40">
          <td colSpan={ROSTER_COLS} className="border-t border-cz-border px-4 py-3">
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

  // Sidehoved-status (T2 PageHeader subtitle) — samme 3 tilstande som før, nu i
  // ÉT sted i stedet for inline i JSX'en. Ren tekst/farve-mapping, ingen ny logik.
  const headerStatus = todayRun
    ? <span className="text-cz-success font-medium">{trainedTodayLabel()}</span>
    : !enabled
      ? <span className="italic">{t("disabledNote")}</span>
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
        actions={
          /* #2819: tour-anker på dagens knap. Wrapper-span frem for data-tour på
             <Button>, så ankeret overlever uanset om Button videresender data-*. */
          <span data-tour="training-run-today" className="inline-flex">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleRunToday}
              disabled={!enabled || !!todayRun || running}
            >
              {running ? t("loading") : t("trainToday")}
            </Button>
          </span>
        }
      />

      {/* #3721: 3 faner (Train today / Development / History), ?tab=-
          synkroniseret. Én gold primary-knap pr. view (#trainToday i headeren)
          — fanebjælken bærer ingen egen primary. */}
      <Tabs value={activeTab} onChange={setTab} className="mt-1">
        <TabList label={t("title")} className="mb-4">
          <Tab value="today">{t("tabs.today")}</Tab>
          <Tab value="weekplan">{t("tabs.weekplan")}</Tab>
          <Tab value="development">{t("tabs.development")}</Tab>
          <Tab value="history">{t("tabs.history")}</Tab>
        </TabList>

      <TabPanel value="today">
      <div className="space-y-6">
        {runError && (
          <p className="text-cz-danger text-sm">{runError}</p>
        )}

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
        {riders.length > 0 && (
          <RosterMobileSortControl
            sort={rosterSort.sort}
            sortDir={rosterSort.sortDir}
            onSort={rosterSort.handleSort}
            t={t}
          />
        )}

        {/* Roster-værktøjslinje (#1480 gruppér-toggle + #3721 stille Hjælp-link).
            #3721: erstatter den slettede FAQ/accordion-forklaring ovenfor —
            i stedet for prosa på siden, ét dæmpet link til Hjælpens Daglig
            Træning-afsnit (recovery, ugerytme, kvitteringen, alt sammen). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {riders.length > 0 ? (
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
        {selected.size > 0 && (
          <Card className="p-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-cz-1">{t("selected", { n: selected.size })}</span>

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
          </Card>
        )}

        {/* Rosterbord (T2 wide-data-recipe: dataTableStyles-chrome i stedet for
            <DataTable> direkte — checkbox-multiselect + sticky navnekolonne kræver 2
            forskellige sticky-offsets (left-0/left-10), og group-header-rækker +
            udvidelig ugeplan-række pr. rytter passer ikke DataTable's 1-række-pr-row-
            model. Se HallOfFamePage/StaffOverviewPage for de to varianter af recepten.) */}
        {riders.length === 0 ? (
          <EmptyState icon={<TeamIcon size={26} aria-hidden="true" />} title={t("noRiders")} />
        ) : (
          <>
            {/* #4293: "This season"-kolonnen står tom hele vejen ned når sæsonen
                er aktiv men endnu ikke begyndt. Fladen siger roligt hvorfor og
                hvornår tallene begynder, i stedet for at lade en kolonne fuld af
                "—" tale for sig selv. Samme copy-nøgle som rytterprofilens
                kvittering, så de to steder ikke kan sige forskellige ting. */}
            {history.seasonState === SEASON_RECEIPT_NOT_STARTED && history.seasonStart && (
              <p className="mb-2 text-2xs text-cz-3 leading-snug">
                {t("receipt.notStarted", { date: formatDate(history.seasonStart) })}
              </p>
            )}
            <div ref={rosterTableRef} className={WRAP}>
              <div className={SCROLLER}>
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
                      {/* #3762: kolonnerne hedder nu det de indeholder. Før stod
                          der "Fokus" og "Intensitet" — to akser der kunne modsige
                          hinanden. Nu er der én dag, og en hurtig vej til at
                          skifte den. */}
                      <th className={thClass({})}>{t("dayPanel.colDay")}</th>
                      <th className={thClass({})}>{t("dayPanel.colChangeDay")}</th>
                      {/* #3709 trin 1: kolonnen er ikke længere "næste +1" på ÉN
                          evne, men sæsonens kvittering pr. evne i fokusset. */}
                      <th className={thClass({})}>{t("receipt.title")}</th>
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
                      <SortTh sortKey="status" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                        className={thClass({})}>
                        {t("colStatus")}
                      </SortTh>
                      {/* #3300-rework: individuel ugeplan-knap i egen kolonne (ejer-
                          feedback), samme mønster som badges-kolonnen ovenfor. */}
                      <th className={thClass({})}>{t("colWeekPlan")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupByType
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
                      : sortRoster(riders).map((rider, ri) => renderRosterRow(rider, ri === 0))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className={COUNT}>{t("groupCount", { n: riders.length })}</div>
          </>
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
                    const reportDaysLeft = injuryDaysLeft(condition[row.rider_id]?.injured_until, today);
                    const reportInjured = reportDaysLeft > 0;
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

        {/* #3746 trin 7 (ejer-beslutning 20/8): ugentlig træningsrytme-editoren
            er flyttet HERFRA til sin egen fane ("Week plan" / "Ugeplan") — se
            TabPanel value="weekplan" nedenfor. #3721 flyttede den først fra
            oversiden af rosteret til en accordion under kvitteringen; nu bor
            den slet ikke på Train today længere. Selve funktionen (state,
            useTraining-wiring, gem/nulstil-handlers) er UÆNDRET, kun
            placeringen + accordion→åben-sektion ændrede sig. weekRhythmTodayShort
            -hintet på roster-rækken (linje ~841) er UBERØRT — det bliver hvor det er. */}
      </div>
      </TabPanel>

      {/* #3746 trin 7: "Week plan"-fanen — den ugentlige rytme-editor som en
          åben sektion (ikke en accordion), + en kompakt oversigt over ryttere
          med egen individuel ugeplan. Ingen nye API-kald: riderWeekPlans/
          weekPlan kommer begge fra useTraining, allerede hentet af siden. */}
      <TabPanel value="weekplan">
      <div className="space-y-6">
        <Card className="overflow-hidden">
          <div className="px-4 py-3 sm:px-5 border-b border-cz-border">
            <span className="text-[15px] font-semibold text-cz-1">{t("weekRhythmTitle")}</span>
          </div>
          <div className="px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
            <p className="text-sm text-cz-3 leading-relaxed">{t("weekRhythmIntro")}</p>

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
            </div>

            <p className="text-xs text-cz-3 leading-relaxed mt-2">{t("weekRhythmBonusNote")}</p>
          </div>
        </Card>

        {/* #3746 trin 7: kompakt læse-oversigt over ryttere MED en individuel
            ugeplan-override. Selve redigeringen bliver på rosteret (Train
            today) — her genbruges kun riderWeekPlans (allerede på siden, ingen
            nyt kald) til navn + 7-dages plan i læseform + en note om at den
            overstyrer holdrytmen, plus en knap der springer til rosteret. */}
        <Card className="p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-cz-1">{t("individualWeekPlanOverviewTitle")}</h2>
          {ridersWithOwnWeekPlan.length === 0 ? (
            <p className="mt-2 text-sm text-cz-3 leading-relaxed">{t("individualWeekPlanOverviewEmpty")}</p>
          ) : (
            <div className="mt-2 divide-y divide-cz-border">
              {ridersWithOwnWeekPlan.map((rider) => (
                <div key={rider.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                  <RiderLink id={rider.id} className="min-w-[140px] text-[13px] font-medium text-cz-1 hover:text-cz-accent transition-colors">
                    {rider.firstname} {rider.lastname}
                  </RiderLink>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {WEEKDAY_KEYS.map((weekday) => (
                      <span key={weekday} className="font-data text-3xs uppercase tracking-[.05em] text-cz-3 whitespace-nowrap">
                        {t(`weekday_${weekday}`)} <span className="text-cz-2">{tRider(`training.intensity_${riderWeekPlans[rider.id]?.[weekday]?.intensity ?? "normal"}`)}</span>
                      </span>
                    ))}
                  </div>
                  <span
                    className="ms-auto text-3xs px-1.5 py-0.5 rounded-cz-pill border bg-cz-accent/10 text-cz-accent border-cz-accent/30 whitespace-nowrap"
                    title={t("individualWeekPlanBadgeTitle")}
                  >
                    {t("individualWeekPlanOverviewOverridesNote")}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <Button type="button" variant="ghost" size="sm" onClick={handleGoToRoster}>
              {t("individualWeekPlanOverviewGoToRoster")}
            </Button>
          </div>
        </Card>
      </div>
      </TabPanel>

      {/* #3721: Development-fanen — én række pr. rytter i truppen: navn+alder,
          udviklings-glyffen (DevelopmentGlyph, FAST 0-99-skala), tallene
          "now · lo-hi · loft", og den SAMME FocusOpenButton/FocusPanel-mutation
          som Train today's roster-række bruger (ingen ny fokus-logik). Estimatet
          kommer fra useScouting (POST /api/scouting/estimates, samme kilde som
          spejder-fladerne) — egne ryttere er altid et bånd, så der er ingen
          scout-knap eller slots-tilstand at vise her. */}
      <TabPanel value="development">
        {riders.length === 0 ? (
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
                          <span className="font-mono tabular-nums text-2xs text-cz-1">{riderStatRating(rider) || "—"}</span>
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

      <TabPanel value="history">
        {/* Træningsrapport-historik (#1533) — seneste 30 dage. Uændret indhold,
            kun flyttet fra bunden af Train today til sin egen fane (#3721). */}
        <TrainingHistory history={history} />
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
