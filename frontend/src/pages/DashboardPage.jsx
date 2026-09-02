import { useState, useEffect, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useNavigate } from "react-router";
import OnboardingProgressCard from "../components/OnboardingProgressCard";
import OnboardingCompletionCard from "../components/OnboardingCompletionCard";
import { FinanceForecastBadge } from "../components/FinanceForecastCard";
import I18nReadyGate from "../components/I18nReadyGate.jsx"; // #4231
import { computeDashboardSquadStats, fetchSquadCountInputs } from "../lib/dashboardSquadStats";
// #2182 — rangliste-modulet skal defaulte til spillerens egen division+pulje,
// ikke hele tieren. Genbruger StandingsPage's rene merge/pulje-match-helpers i
// stedet for en parallel implementering (samme princip som #3197: "default-
// konteksten er spillerens egen verden").
import { mergeStandings } from "../lib/standingsMerge";
import { computeMyDivisionStandings } from "../lib/dashboardDivStandings.js";
import { computeOverallBoardSatisfaction } from "../lib/boardUtils";
import { formatNumber } from "../lib/intl";
import { getEffectiveOfferAmount } from "../lib/offerAmount.js";
import { dateTextToDayOfYear } from "../lib/raceCalendar";
import { poolStageTotals, deriveRaceStatus } from "../lib/raceHubLogic.js";
import { formatCountdown } from "../lib/stageScheduleConfig.js";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import { useActionSummary } from "../hooks/useActionSummary";
import NextActionsCard from "../components/NextActionsCard";
// Forum-synlighed (#3199, variant B): kompakt to-rækkers "From the forum"-
// kort. Selv-hentende komponentfil (ingen props), samme isolations-princip
// som HeroAgonyCard/TodayStagesStrip nedenfor — se komponentfilens kommentar.
import ForumHighlightsCard from "../components/ForumHighlightsCard";
import TeamSelectionCtaCard from "../components/TeamSelectionCtaCard";
import MyLatestResultCard from "../components/MyLatestResultCard";
// #3397 (epic #3395 bølge 1): Hero & Agony moment-kort. Selv-hentende
// komponent (kun team-props) med vilje — se komponentfilens kommentar.
import HeroAgonyCard from "../components/HeroAgonyCard";
// #3915 — "Today's stages"-stribe (dagens etaper/løb for holdet). Selv-
// hentende komponentfil (kun teamId som prop), samme isolations-princip som
// HeroAgonyCard ovenfor — se komponentfilens kommentar.
import TodayStagesStrip from "../components/TodayStagesStrip";
import DevTransitionCard from "../components/DevTransitionCard";
import MaidenWinMomentCard from "../components/MaidenWinMomentCard";
import { isFirstRaceMoment } from "../lib/firstRaceMoment.js";
import { pickNextSelectableRace } from "../lib/nextSelectableRace";
import { isSquadSelectionMissing } from "../lib/raceSquadSelectionStatus";
import { pickUpcomingRaces, filterTeamEnteredRaces } from "../lib/upcomingRaces";
import RiderLink from "../components/RiderLink";
import RaceLink from "../components/RaceLink";
import { recentResultStage } from "../lib/recentResultLink.js";
import { isContractExpiringAtTransition } from "../lib/riderAge";
import { Flag } from "../components/Flag";
import useDashboardLayout from "../lib/useDashboardLayout";
import {
  resolveBoardFeedbackHeadline,
  resolveBoardFeedbackSummary,
  resolveCategoryLabel,
} from "../lib/boardCopy";
import DashboardCustomizeMenu from "../components/DashboardCustomizeMenu";
import GlobalRankWidget from "../components/GlobalRankWidget";
import SeasonStartGuideCard from "../components/SeasonStartGuideCard";
import {
  isSeasonStartWindow, buildSeasonStartItems,
  readSeasonStartDismissed, writeSeasonStartDismissed,
} from "../lib/seasonStartGuide";
import SeasonWrapNudgeCard from "../components/SeasonWrapNudgeCard";
import { readSeasonWrapDismissed, writeSeasonWrapDismissed } from "../lib/seasonWrapNudge";
import SeasonSignupCard from "../components/SeasonSignupCard"; // [epic #4592 del 3] #452
import { computeDashboardGoldCta } from "../lib/dashboardGoldCta.js";
import { resolveSeasonMovement } from "../lib/seasonRecapData.js";
// vk-movement-signals — bevægelses-signaler på "My division standings":
// divisionsplacering + holdpoint siden sidste afsluttede løbsdag i egen pulje.
import { findLastCompletedRaceDay, sumPointsByTeam, computeDivisionMovement } from "../lib/dashboardMovementSignals.js";
import { fetchReservedBalance, computeAvailableBalance } from "../lib/availableBalance.js";
import { readCachedAcademyNav } from "../lib/academyNavVisibility";
import { buildRiderRankingLink } from "../lib/riderRankingDivisionLink";
import {
  Card, AlertTriangleIcon, XIcon, ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, CheckIcon, DiscordIcon,
  PageLoader, PageHeader, Section, SectionHeader, SectionAction, Button, ErrorState,
  SkeletonLines, EmptyState, ProgressMeter,
} from "../components/ui";
import { buttonClass } from "../components/ui/buttonStyles.js";
import { flushPendingSignup, logFirstEvent, logTeamDrafted } from "../lib/logEvent";

const API = import.meta.env.VITE_API_URL;
// Realtime: sæson-fremskridt (race_days_completed) + resultat-afledte tal skal
// opdatere uden hård reload når et løb finaliseres (#783).
// #3035: races (72 updates/vindue) erstatter race_results (34k writes/vindue) som
// finaliserings-signal — hver etape/løbs-afslutning bumper races-rækken, så UX er
// identisk, men realtime slipper for at WAL-dekode masseskrivningerne.
const REALTIME_TABLES = ["seasons", "races"];

function isAuctionSeller(auction, teamId) {
  return auction?.seller_team_id === teamId && auction?.rider?.team_id === teamId;
}

function getAuctionLeaderId(auction) {
  if (auction?.current_bidder_id) return auction.current_bidder_id;
  if (!auction?.is_guaranteed_sale && auction?.seller_team_id && auction?.rider?.team_id !== auction.seller_team_id) {
    return auction.seller_team_id;
  }
  return null;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { t } = useTranslation(["dashboard", "common"]);
  // #3697: board.json (55 KB rå pr. sprogpar) lazy-loades via HttpBackend i
  // stedet for at ligge inline i language-chunken. Dashboardets bestyrelseskort
  // er den ENESTE forbruger uden for BoardPage, og feedback-blokken er den
  // eneste del der resolver board:-nøgler (resolveBoardFeedback*/resolveCategoryLabel),
  // så den vises først når namespacet er hentet — ellers rå nøgler (useSuspense: false).
  const { ready: boardCopyReady } = useTranslation("board");
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [pendingIncomingCount, setPendingIncomingCount] = useState(0);
  const [allAuctions, setAllAuctions] = useState([]);
  // #3508: reserveret beløb i førende auktionsbud + proxy-max — samme
  // beregning som FinancePage (lib/availableBalance.js), så header-saldoen
  // aldrig kan vise et højere disponibelt tal end Finance-siden.
  const [reservedBalance, setReservedBalance] = useState(0);
  const [nextRaces, setNextRaces] = useState([]);
  // #3751 — race-id'er holdet faktisk er tilmeldt (mindst én race_entries-
  // række). Bruges KUN til at filtrere "Kommende løb"-kortet, ikke nextRaces
  // selv — squadSelectionMissingRace/nextStageByRace skal fortsat se ALLE
  // puljens løb (selectableRaces filtrerer allerede korrekt på trup-lås).
  const [teamRaceIds, setTeamRaceIds] = useState(() => new Set());
  const [standings, setStandings] = useState([]);
  // vk-movement-signals — hold-point pr. hold for SIDSTE afsluttede
  // løbsdag i egen pulje (team_id → sum af race_points). {} = ingen data endnu
  // (før hentet, eller ingen afsluttet løbsdag) → movement-badges vises ikke.
  const [lastRaceDayPoints, setLastRaceDayPoints] = useState({});
  // #2182 — league_divisions (alle puljer, ~15 rækker reference-data). Bruges til
  // at afgøre om egen tier har >1 pulje (hasPoolSubtabs) + puljens label i titlen.
  const [pools, setPools] = useState([]);
  const [board, setBoard] = useState(null);
  // #1830 · board-bred tilfredshed (gnsn. på tværs af alle planer) — samme værdi
  // som Bestyrelse-sidens drivers-panel, så de to flader ikke divergerer.
  const [boardSatisfaction, setBoardSatisfaction] = useState(null);
  const [boardOutlook, setBoardOutlook] = useState(null);
  const [activeOffers, setActiveOffers] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  // #3510 — eksplicit fejl-tilstand med retry frem for et tomt, "ingen data"-
  // udseende dashboard: loadAll fangede tidligere fejl med console.error alene
  // og faldt igennem til finally { setLoading(false) } → et fuldt tomt dashboard
  // uden fejlbesked. Samme mønster som StandingsPage/#2175.
  const [error, setError] = useState(null);

  const [seasonInfo, setSeasonInfo] = useState(null);
  const [poolStages, setPoolStages] = useState(null); // #1829/#4245: per-pulje etape-tæller
  const [nextStageByRace, setNextStageByRace] = useState({}); // #1828: live-løb → næste etapes ms-tid
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [discordNudgeDismissed, setDiscordNudgeDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("cz-dashboard-discord-nudge-dismissed") === "1"
  );
  const [showDiscordNudge, setShowDiscordNudge] = useState(false);
  const [onboardingProgress, setOnboardingProgress] = useState(null);
  // #2439: dismiss er nu SERVER-persisteret (teams.onboarding_progress_dismissed_at,
  // via GET/POST /api/me/onboarding-progress) i stedet for det session-scopede
  // sessionStorage-dismiss fra #1569 — sessionStorage nulstillede sig selv ved
  // hver ny fane/browser-genstart/enhed, så kortet blev ved med at "spamme"
  // etablerede spillere hvis completed_count aldrig nåede total_count. Vi
  // beholder sessionStorage KUN som optimistisk øjeblikkelig UI-state før
  // server-svaret er hentet (undgår et flash af kortet ved sideload) — den
  // reelle sandhed kommer fra `dismissed`/`established` i progress-response'en.
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem("cz-dashboard-onboarding-dismissed") === "1"
  );
  const [completionDismissed, setCompletionDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("cz-dashboard-onboarding-completion-dismissed") === "1"
  );

  // Kanonisk "kræver handling"-summary til "Næste træk"-sektionen (#271 Slice B).
  const { pending: actionSummary, loading: actionLoading } = useActionSummary();

  // Dashboard-customize (#1005): vis/skjul moduler, persisteret i localStorage.
  const { isVisible, toggleModule, resetToDefault } = useDashboardLayout();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // #3510 — null = ikke hentet endnu (post-first-paint modul), skal vise
  // loading-skeleton; [] = hentet OG bekræftet tom, skal vise empty-state.
  // Tidligere defaultede begge til [] direkte, så modulerne viste et falsk
  // "ingen resultater"-empty-state i round-trip-vinduet ved HVERT load (false-
  // empty flash) — samme distinktion som MyLatestResultCard allerede laver
  // korrekt for sit eget null-default (se datakontrakt-kommentaren i den fil).
  const [recentResults, setRecentResults] = useState(null);
  const [riderRanking, setRiderRanking] = useState(null);
  // #2466: resultat-push — null = ikke hentet endnu/fejlet (kortet renderer intet),
  // { race: null } = ingen finaliserede løb (empty state), ellers payload.
  const [myLatestResult, setMyLatestResult] = useState(null);
  const recentResultsVisible = isVisible("recentResults");
  const riderRankingVisible = isVisible("riderRanking");
  const myLatestResultVisible = isVisible("myLatestResult");
  const heroAgonyVisible = isVisible("heroAgony"); // #3397

  // #2288 D — "Næste træk"-udvidelse: 3 lette signaler beregnet efter nextRaces/
  // board er hentet. squadSelectionMissingRace = det næste udtagelige løb HVIS
  // holdet endnu ikke har lavet en manuel udtagelse til det (samme kilde som
  // RaceSelectionPanel/saveSelection skriver til: race_entries.is_auto_filled=false).
  const [squadSelectionMissingRace, setSquadSelectionMissingRace] = useState(null);
  const [notTrainedToday, setNotTrainedToday] = useState(false);
  // D3: "bestyrelsesplan mangler" = forhandling er ÅBEN (ikke sæson-1 baseline-lås)
  // og ingen plan er forhandlet færdig (negotiation_status='completed' — planer
  // auto-seedes som 'pending' ved sæson-start, så board non-null er IKKE nok;
  // samme signal som onboarding-trinnet board_plan_set).
  const [boardPlanMissing, setBoardPlanMissing] = useState(false);
  // #2925 — blev /api/board/status overhovedet besvaret? boardPlanMissing=false
  // betyder ELLERS to vidt forskellige ting ("plan forhandlet" vs. "kaldet
  // fejlede"), og sæsonstart-guiden må ikke vise et falsk grønt flueben.
  const [boardStatusLoaded, setBoardStatusLoaded] = useState(false);

  // #2925 — "Season N: kom i gang". Vises kun i sæsonstart-vinduet (dage siden
  // aktiv sæsons start_date, se lib/seasonStartGuide.js), dismissable pr. sæson.
  const [seasonStartDismissed, setSeasonStartDismissed] = useState(false);
  const [academyEnabled, setAcademyEnabled] = useState(false);
  const [seasonStartCounts, setSeasonStartCounts] = useState({
    trainingPlanCount: null, pendingGraduations: null,
  });

  // #2752/#2361 — "Sæson N er slut"-nudgekortet: samme vindue som sæsonstart-
  // guiden ovenfor (seasonStartWindowOpen), men eget dismiss (per AFSLUTTET
  // sæson, ikke per aktiv — se lib/seasonWrapNudge.js). null = intet at vise
  // endnu (ikke hentet, eller ingen af mit holds rækker fundet).
  const [seasonWrapDismissed, setSeasonWrapDismissed] = useState(false);
  const [completedSeasonRecap, setCompletedSeasonRecap] = useState(null);

  // [epic #4592 del 3] "Tilmeld dig næste sæson" (#452) — status fra
  // GET /api/season/signup-status: { enabled, eligible, parked, signed_up,
  // next_season_number }. null = ikke hentet endnu/fejlet → kortet renderer
  // intet (samme fail-stille-mønster som resten af DASHBOARD_RULES.md §3).
  // Bevidst INGEN dismiss/localStorage her (til forskel fra SeasonWrapNudge/
  // SeasonStartGuide ovenfor): dette er et konto-risiko-varsel i samme klasse
  // som trup-/kontrakt-advarslerne øverst på siden (heller ingen dismiss) —
  // en manager der er ved at miste sin plads skal blive ved med at se det
  // indtil hun rent faktisk tilmelder sig, ikke kunne klikke det væk.
  const [seasonSignupStatus, setSeasonSignupStatus] = useState(null);
  const [seasonSignupSubmitting, setSeasonSignupSubmitting] = useState(false);

  // #2925 — sæsonstart-vinduet. Afledt af eksisterende data (aktiv sæsons
  // start_date), ikke af et nyt flag. `nowMs` tikker allerede hvert minut, så
  // vinduet lukker af sig selv uden reload og uden urent new Date() i render.
  const seasonStartWindowOpen = isSeasonStartWindow(seasonInfo, new Date(nowMs));

  async function loadAll() {
    setError(null);
    try {
    const [{ data: { user } }, { data: { session } }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.auth.getSession(),
    ]);
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (finally rydder loading)
    if (!user) { return; }
    const { data: teamData } = await supabase
      .from("teams").select("*").eq("user_id", user.id).single();
    if (!teamData) { return; }
    setTeam(teamData);

    const { data: activeSeason } = await supabase
      .from("seasons")
      .select("id, number, status, start_date, end_date, race_days_total, race_days_completed")
      .eq("status", "active")
      .single();

    const token = session?.access_token;
    const boardStatusPromise = token
      ? fetch(`${API}/api/board/status`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(async (response) => (response.ok ? response.json() : null))
      : Promise.resolve(null);

    // #1829: per-pulje løbsdage-tæller — ALLE løb i managerens egen pulje (inkl. afsluttede),
    // så vi kan vise kørt/muligt for puljen i stedet for det sæson-globale tal. Klient-side
    // (races er public-read via RLS); ingen migration.
    // vk-movement-signals: id + game_day_start tilføjet til selectet (2 ekstra kolonner, SAMME
    // query — ingen ny round-trip) — genbruges af findLastCompletedRaceDay til at
    // finde sidste afsluttede løbsdag i puljen (movement-signalerne nedenfor).
    const poolRacesPromise = activeSeason && teamData.league_division_id != null
      ? supabase.from("races").select("id, stages, stages_completed, status, game_day_start")
          .eq("season_id", activeSeason.id).eq("league_division_id", teamData.league_division_id)
      : Promise.resolve({ data: [] });

    const [teamsRes, ridersRes, squadCountInputs, auctionsRes, racesRes, standingsRes, boardStatus, offersRes, poolRacesRes, poolsRes, reservedBalanceValue] = await Promise.all([
      // #2182: league_division_id + is_frozen-udelukkelse med — samme
      // "rigtige hold"-diskriminator (test/frosne, IKKE AI) og select-
      // udvidelse som StandingsPage.jsx's teamsPromise, så rangliste-modulet
      // kan pulje-scope. #3506: AI-hold TÆLLES MED (fjernet .eq("is_ai",
      // false)) — samme scope som Standings-siden (#1718), ellers giver
      // dashboardets placeringstal et andet resultat end målsiden for samme
      // hold.
      supabase.from("teams")
        .select("id, name, division, is_ai, league_division_id")
        .eq("is_test_account", false)
        .eq("is_frozen", false)
        .order("division")
        .order("name"),
      // #1308: akademiryttere tæller ikke mod senior-cap
      // #2748: pensionerede ryttere tæller ikke med i trup-størrelsen — de
      // frigives ved sæsonskiftet og kan ikke køre løb. Spejler backend
      // getTeamMarketState (marketUtils.js).
      // #1150: contract_end_season med i selectet (samme rækker, ingen ekstra
      // tur) — driver contractExpiringCount nedenfor (kontraktudløb-varsel).
      supabase.from("riders").select("id, salary, is_u25, pending_team_id, contract_end_season")
        .eq("team_id", teamData.id)
        .eq("is_academy", false)
        .eq("is_retired", false),
      // #1090: pending-in + indgående lån (inkl. window_pending) hentes med
      // samme diskriminatorer som backend getTeamMarketState — se
      // fetchSquadCountInputs i lib/dashboardSquadStats.js.
      fetchSquadCountInputs(supabase, teamData.id),
      supabase.from("auctions")
        .select("id, current_price, calculated_end, status, is_guaranteed_sale, seller_team_id, current_bidder_id, rider:rider_id(firstname, lastname, team_id)")
        .in("status", ["active", "extended"]),
      activeSeason
        ? // #1906: filtrér på holdets egen pulje (league_division_id), så Dashboards
          // "næste løb" matcher holdudtagelse (RaceHub /api/races/distribution bruger
          // teamInRacePool). Uden filteret viste Dashboard løb fra ANDRE divisioner som
          // brugeren ikke kan udtage til. 0 pulje-løse fremtidige løb i prod, så strict
          // .eq() er ækvivalent med teamInRacePool. Hentet bredt (pulje har ~14 løb) så
          // den klient-side dato-sortering nedenfor ser alle holdets kommende løb.
          supabase.from("races").select("*, pool_race:pool_race_id(date_text)")
            .eq("season_id", activeSeason.id)
            .eq("league_division_id", teamData.league_division_id)
            .not("status", "eq", "completed")
            .order("name").limit(50)
        : Promise.resolve({ data: [] }),
      activeSeason
        // #2182: league_division_id med i team-joinet (samme udvidelse som
        // StandingsPage.jsx's standingsRes), så rangliste-modulet kan pulje-scope.
        ? supabase.from("season_standings")
            .select("*, team:team_id(id, name, division, is_ai, league_division_id)")
            .eq("season_id", activeSeason.id)
            .order("total_points", { ascending: false })
        : Promise.resolve({ data: [] }),
      boardStatusPromise,
      token
        ? fetch(`${API}/api/transfers/my-offers`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
        : Promise.resolve({ sent: [], received: [] }),
      poolRacesPromise,
      // #2182: alle puljer — samme reference-query som StandingsPage/ResultaterPage.
      supabase.from("league_divisions").select("id, tier, pool_index, label"),
      // #3508: reserveret beløb i førende bud + proxy-max — delt helper med
      // FinancePage (lib/availableBalance.js), se kommentar ved state-deklarationen.
      fetchReservedBalance(supabase, teamData.id),
    ]);

    // #3751: holdets EGNE race_entries — kun for de løb Dashboard rent faktisk
    // viser (racesRes' <=50 rækker), IKKE holdets fulde entry-historik. race_entries
    // står på pagination-guardens deny-liste (#3331, PostgREST 1000-rækkers-loft) —
    // et hold akkumulerer én entries-række pr. rytter pr. løb over sæsoner, så et
    // uafgrænset `.eq("team_id", …)`-opslag kunne rammes af loftet og give et
    // FALSK "ikke tilmeldt" for et gammelt hold. `.in("race_id", …)` afgrænser
    // opslaget til netop de kendte, allerede-hentede løb — sekventiel EFTER
    // Promise.all'et, da racesRes' id-liste er forudsætningen.
    const racesForTeamCheck = (racesRes.data || []).map((r) => r.id);
    const teamRaceEntriesRes = racesForTeamCheck.length
      // pagination-safe: dobbelt afgrænset — ét hold (RLS-scoped team_id) OG
      // højst 50 race_id'er (racesRes' .limit(50) ovenfor), så rækketallet er
      // højst 50 × en løbstrups størrelse, langt under PostgREST's 1000-loft.
      ? await supabase.from("race_entries").select("race_id")
          .eq("team_id", teamData.id).in("race_id", racesForTeamCheck)
      : { data: [] };

    // vk-movement-signals — ÉN ekstra query (sekventiel EFTER
    // Promise.all'et, da den kræver poolRacesRes' race_id'er): sidste
    // afsluttede løbsdags hold-point i egen pulje, til divisionsplacering- +
    // holdpoint-deltaerne på "My division standings"-modulet. Ingen
    // afsluttet løbsdag endnu → ingen query, {} forbliver ({}=intet at vise).
    const lastRaceDay = findLastCompletedRaceDay(poolRacesRes.data || []);
    const lastRaceDayPointsRes = lastRaceDay?.raceIds.length
      ? await supabase.from("team_race_points_mv").select("team_id, race_points")
          .in("race_id", lastRaceDay.raceIds)
      : { data: [] };

    setReservedBalance(reservedBalanceValue || 0);
    setSeasonInfo(activeSeason || null);
    setPools(poolsRes.data || []);
    setPoolStages(poolStageTotals(poolRacesRes.data || []));
    setRiders(ridersRes.data || []);
    setPendingIncomingCount(squadCountInputs.pendingIncomingCount);
    setAllAuctions(auctionsRes.data || []);
    // #2328: hold ALLE holdets kommende puljeløb i state (ikke kun top-3) — både
    // "Kommende løb"-kortets faktiske dagsordning (pickUpcomingRaces nedenfor,
    // som kræver den ægte race_stage_schedule-tid for hele listen) og holdudtagelses-
    // CTA'en/squadSelectionMissingRace skal kunne finde det RIGTIGE næste udtagelige
    // løb blandt ALLE puljens løb, ikke kun de tre der viste-tilfældigt fra den
    // gamle PCM-dato-sortering.
    const sortedRaces = [...(racesRes.data || [])]
      .sort((a, b) => dateTextToDayOfYear(a.pool_race?.date_text) - dateTextToDayOfYear(b.pool_race?.date_text));
    setNextRaces(sortedRaces);
    // #3751: distinkte race_id'er holdet har mindst én entry i.
    setTeamRaceIds(new Set((teamRaceEntriesRes.data || []).map((e) => e.race_id)));
    const activePlan = boardStatus?.plans?.["1yr"] || boardStatus?.plans?.["3yr"] || boardStatus?.plans?.["5yr"] || null;
    setBoard(activePlan?.board || null);
    // #1830 · tilfredsheds-tallet aggregeres på tværs af ALLE planer (samme delte
    // helper som Bestyrelse-siden) — ikke kun den første aktive plan, ellers
    // viste Dashboard 65% mens Bestyrelse viste 67%.
    setBoardSatisfaction(computeOverallBoardSatisfaction(boardStatus?.plans));
    setBoardOutlook(activePlan?.outlook || null);
    const hasNegotiatedPlan = ["1yr", "3yr", "5yr"].some(
      (pt) => boardStatus?.plans?.[pt]?.board?.negotiation_status === "completed"
    );
    setBoardPlanMissing(Boolean(boardStatus) && !boardStatus.is_baseline_phase && !hasNegotiatedPlan);
    setBoardStatusLoaded(Boolean(boardStatus));
    setActiveOffers([
      ...(offersRes.received || []).map(offer => ({ ...offer, _dir: "received" })),
      ...(offersRes.sent || []).map(offer => ({ ...offer, _dir: "sent" })),
    ]);

    // Slice 07g · Forecast-widget — best-effort, fejler stille hvis endpoint smider 500.
    if (token) {
      try {
        const forecastRes = await fetch(`${API}/api/me/finance-forecast`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (forecastRes.ok) setForecast(await forecastRes.json());
      } catch {
        // best-effort
      }
    }

    // #3506: AI-hold var tidligere filtreret væk her (før mergeStandings), så
    // de aldrig indgik i rangberegningen — deraf placerings-mismatchet mod
    // Standings-siden. AI-hold tælles nu med, samme scope som Standings-siden.
    const standingsMap = {};
    (standingsRes.data || []).forEach(s => {
      standingsMap[s.team_id] = s;
    });
    // #2182: genbruger StandingsPage's rene mergeStandings-helper (lib/standingsMerge.js)
    // i stedet for en parallel hand-rullet merge — samme 0-punkts-fallback-shape,
    // der bærer team-objektet (inkl. league_division_id) videre til rangliste-filteret.
    setStandings(mergeStandings(teamsRes.data || [], standingsMap));
    // vk-movement-signals: se lastRaceDayPointsRes-kommentaren ovenfor.
    setLastRaceDayPoints(sumPointsByTeam(lastRaceDayPointsRes.data || []));

    // #1140: OnboardingModal (det redundante 3-korts intro-modal) er konsolideret
    // væk — OnboardingProgressCard nedenfor er nu den ENESTE kanoniske dashboard-
    // onboarding-UI. Vi viser ikke længere et separat modal for ny-spillere.

    // Discord nudge — vises hvis brugeren ikke har discord_id (og ikke har dismissed)
    if (!discordNudgeDismissed && token) {
      try {
        const dmRes = await fetch(`${API}/api/me/discord-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (dmRes.ok) {
          const dm = await dmRes.json();
          if (!dm.discord_id) setShowDiscordNudge(true);
        }
      } catch {
        // best-effort
      }
    }

    // Onboarding progress — fetch hvis enten progress- eller completion-kort kan blive vist.
    // (Eksisterende managers der har dismisset progress, skal stadig kunne se completion-kortet
    //  første gang efter v2.19-deploy.)
    if ((!onboardingDismissed || !completionDismissed) && token) {
      try {
        const progRes = await fetch(`${API}/api/me/onboarding-progress`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (progRes.ok) {
          const prog = await progRes.json();
          setOnboardingProgress(prog);
          // #2439: server er sandheden — et tidligere dismiss (andet device/
          // session) eller et "etableret hold"-flag skal skjule kortet uden at
          // manageren skal afvise det igen.
          if (prog.dismissed || prog.established) {
            setOnboardingDismissed(true);
          }
        }
      } catch {
        // best-effort
      }
    }

    // [epic #4592 del 3] "Tilmeld dig næste sæson" (#452) — best-effort, samme
    // mønster som Discord-status/onboarding-progress ovenfor: fejler kaldet,
    // forbliver seasonSignupStatus null og kortet renderer intet
    // (docs/DASHBOARD_RULES.md §3: "et modul må aldrig kunne vælte
    // dashboardet"). Flaget er off som default (seasonSignupFlag.js), så dette
    // er typisk et enkelt hurtigt 200-svar med enabled:false.
    if (token) {
      try {
        const signupRes = await fetch(`${API}/api/season/signup-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (signupRes.ok) setSeasonSignupStatus(await signupRes.json());
      } catch {
        // best-effort
      }
    }

    } catch (e) {
      console.error("Dashboard load failed:", e);
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- loadAll er lokal funktion (ny ref hver render) — kun mount-fetch
  useRealtimeRefetch("dashboard-live", REALTIME_TABLES, loadAll);

  // #1828 + #2171: for "Kommende løb"-kortet henter vi den ægte kalender-tid for
  // næste etape (game-day-countdown), både for igangværende OG endnu-ikke-startede
  // løb. #2171 fjernede de forvirrende PCM-datoer (pool_race.date_text) fra kortet;
  // countdown'en til første/næste etape er den meningsfulde erstatning ("starter om
  // X dage"), afledt af race_stage_schedule.scheduled_at — ikke af date_text.
  useEffect(() => {
    const scheduled = nextRaces.filter((r) => {
      const s = deriveRaceStatus(r.status, r.stages_completed, r.stages);
      return s === "live" || s === "scheduled";
    });
    if (!scheduled.length) { setNextStageByRace({}); return undefined; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("race_stage_schedule")
        .select("race_id, stage_number, scheduled_at").in("race_id", scheduled.map((r) => r.id));
      if (cancelled) return;
      const map = {};
      for (const r of scheduled) {
        const next = (data || []).find((s) => s.race_id === r.id && s.stage_number === (r.stages_completed ?? 0) + 1);
        const ms = next ? Date.parse(next.scheduled_at) : NaN;
        if (Number.isFinite(ms)) map[r.id] = ms;
      }
      setNextStageByRace(map);
    })();
    return () => { cancelled = true; };
  }, [nextRaces]);

  // Et minut-tick rækker til en kalender-countdown (vi viser ikke sekunder).
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // #2288 D1 / #3042 — mangler holdudtagelse til det næste udtagelige løb? Bruger
  // NU samme kontrakt som løbssiden: GET /api/races/:id/selection (det
  // RaceSelectionPanel selv henter fra) → selection.rider_ids.length vs size.max,
  // via den delte rene isSquadSelectionMissing (raceSquadSelectionStatus.js).
  //
  // Tidligere talte vi selv race_entries filtreret på is_auto_filled=false ("har
  // manageren manuelt valgt mindst én rytter?"). Det matchede ikke løbssidens
  // "fuld trup"-begreb (ALLE entries, manuelle + auto-fyldte, mod size.max) — så
  // en trup raceEntryGenerator havde top-fyldt fuldt automatisk (0 manuelle
  // entries) blev fejlagtigt vist som "udtagelse mangler" på Dashboard, selvom
  // løbssiden viste en fuld trup (#3042, Discord-bug 25/7).
  useEffect(() => {
    let cancelled = false;
    const nextRace = pickNextSelectableRace(nextRaces);
    if (!nextRace || !team?.id) { setSquadSelectionMissingRace(null); return undefined; }
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      try {
        const r = await fetch(`${API}/api/races/${nextRace.id}/selection`, { headers: { Authorization: `Bearer ${token}` } });
        // Fejl/ukendt svar må ikke udløse et falsk "udtagelse mangler" — samme
        // forsigtighed som den tidligere count===0-only-regel (#2296-regression).
        if (!r.ok || cancelled) return;
        const body = await r.json();
        if (!cancelled) setSquadSelectionMissingRace(isSquadSelectionMissing(body) ? nextRace : null);
      } catch { /* netværk — nudgen forbliver som den var */ }
    })();
    return () => { cancelled = true; };
  }, [nextRaces, team?.id]);

  // #2288 D2 — trænede holdet i dag? Letvægts-endpoint, kun training_day_runs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      try {
        const r = await fetch(`${API}/api/training/today-status`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok && !cancelled) {
          const body = await r.json();
          setNotTrainedToday(Boolean(body.enabled) && !body.ran_today);
        }
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [team?.id]);

  // #2925 — dismiss huskes PR. SÆSON i localStorage (samme mønster som Discord-
  // nudgen og completion-kortet). Læsningen ligger i en effekt, ikke i render,
  // så komponenten forbliver ren. Nøglen bærer sæson-id'et, så et dismiss i
  // sæson 2 ikke skjuler guiden ved næste sæsonskifte.
  useEffect(() => {
    setSeasonStartDismissed(readSeasonStartDismissed(seasonInfo?.id));
  }, [seasonInfo?.id]);

  // Akademiet er feature-gated. Layout.jsx har allerede afgjort synligheden og
  // cachet den; vi genbruger cachen frem for at betale et ekstra /api/academy/me.
  useEffect(() => {
    setAcademyEnabled(readCachedAcademyNav());
  }, [team?.id]);

  // #2925 — de to "udført"-signaler der ikke allerede ligger på dashboardet.
  // Begge er head-count-queries (ingen rækker over tråden) mod tabeller med
  // ejer-scoped RLS (training_plans_own_select / academy_graduation_owner_read),
  // og de køres KUN når sæsonstart-vinduet er åbent, så managere uden for
  // vinduet betaler intet. Tælles på rider_id: begge tabeller har den kolonne,
  // og en select på en ikke-eksisterende kolonne giver 400 og en tavs null-count
  // (race_entries-fælden fra #2296).
  useEffect(() => {
    if (!seasonStartWindowOpen || !team?.id || !seasonInfo?.id) return undefined;
    let cancelled = false;
    (async () => {
      const [trainingRes, gradRes] = await Promise.all([
        supabase.from("training_plans")
          .select("rider_id", { count: "exact", head: true })
          .eq("team_id", team.id).eq("season_id", seasonInfo.id),
        academyEnabled
          ? supabase.from("academy_graduation")
              .select("rider_id", { count: "exact", head: true })
              .eq("team_id", team.id).eq("status", "pending")
          : Promise.resolve({ count: 0 }),
      ]);
      if (cancelled) return;
      // count===null (fejl/ukendt) bevares som null → punktet vises UDEN flueben.
      setSeasonStartCounts({
        trainingPlanCount: trainingRes.count ?? null,
        pendingGraduations: gradRes.count ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [seasonStartWindowOpen, team?.id, seasonInfo?.id, academyEnabled]);

  // #2752/#2361 — "Sæson N er slut"-kortets data: min slutstilling i den
  // AFSLUTTEDE sæson lige før den aktive. Samme vindue/gate som ovenstående
  // effekt (kun 7 dage efter et sæsonskifte), så managere uden for vinduet
  // betaler intet. Tre små, MÅLRETTEDE opslag (season-lookup, min egen række,
  // resten af min division) — ingen af dem ligner #2891-klassens problem.
  useEffect(() => {
    if (!seasonStartWindowOpen || !team?.id || !seasonInfo?.id) {
      setCompletedSeasonRecap(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const { data: completedSeason } = await supabase
        .from("seasons").select("id, number")
        .eq("status", "completed")
        .order("number", { ascending: false })
        .limit(1).maybeSingle();
      if (cancelled) return;
      // Kun relevant hvis den seneste completed sæson RENT FAKTISK er den den
      // aktive sæson efterfulgte — undgår at vise et forældet facit hvis
      // sæson-numrene af en eller anden grund ikke er fortløbende.
      if (!completedSeason || completedSeason.number !== seasonInfo.number - 1) {
        setCompletedSeasonRecap(null);
        return;
      }

      const { data: standingsRow } = await supabase
        .from("season_standings")
        .select("division, rank_in_division, total_points, stage_wins")
        .eq("team_id", team.id).eq("season_id", completedSeason.id).maybeSingle();
      if (cancelled) return;
      if (!standingsRow) { setCompletedSeasonRecap(null); return; }

      // #2182-mønstret: "rigtige hold" = ikke-AI/test/frosne — samme
      // diskriminator som resten af dashboardet bruger til holdtællinger.
      const { data: divTeams } = await supabase
        .from("season_standings")
        .select("team_id, team:team_id(is_ai, is_test_account, is_frozen)")
        .eq("season_id", completedSeason.id)
        .eq("division", standingsRow.division);
      if (cancelled) return;
      const divisionSize = (divTeams || [])
        .filter(r => !r.team?.is_ai && !r.team?.is_test_account && !r.team?.is_frozen).length;

      // #season-recap-polish (18/8) — samme robuste sti som SeasonEndPage.jsx's
      // recap-hero (resolveSeasonMovement, seasonRecapData.js): foretrækker en
      // RIGTIG season_standings-række for seasonInfo (efterfølgersæsonen — den
      // er allerede verificeret ovenfor til at være DEN sæson completedSeason
      // overgik til), falder kun tilbage til team.division hvis den rækken
      // ikke findes endnu. Før kaldte kortet computeSeasonMovement direkte med
      // team.division — to stier til "samme" tal der kunne drifte fra
      // hinanden (fx en admin-korrektion af division EFTER transitionen).
      const { data: nextRow } = await supabase
        .from("season_standings")
        .select("division")
        .eq("team_id", team.id).eq("season_id", seasonInfo.id).maybeSingle();
      if (cancelled) return;

      setCompletedSeasonRecap({
        seasonId: completedSeason.id,
        seasonNumber: completedSeason.number,
        division: standingsRow.division,
        divisionSize,
        rank: standingsRow.rank_in_division,
        movement: resolveSeasonMovement({
          finishedDivision: standingsRow.division,
          nextSeasonStandingDivision: nextRow?.division ?? null,
          nextSeasonStatus: seasonInfo.status ?? null,
          currentTeamDivision: team.division,
        }),
        points: standingsRow.total_points,
        wins: standingsRow.stage_wins,
      });
    })();
    return () => { cancelled = true; };
  }, [seasonStartWindowOpen, team?.id, seasonInfo?.id, seasonInfo?.number, seasonInfo?.status, team?.division]);

  // #2752/#2361 — dismiss huskes PR. AFSLUTTET SÆSON (ikke pr. aktiv, som
  // seasonStartDismissed ovenfor) — se lib/seasonWrapNudge.js.
  useEffect(() => {
    setSeasonWrapDismissed(readSeasonWrapDismissed(completedSeasonRecap?.seasonId));
  }, [completedSeasonRecap?.seasonId]);

  // #1583: flush en ventende signup når brugeren er authenticated på dashboardet.
  // Dækker confirm-on-flowet (prod), hvor LoginPage ingen session havde i selve
  // signup-øjeblikket. No-op hvis ingen ventende markør / manglende consent.
  useEffect(() => {
    if (team?.id) flushPendingSignup();
  }, [team?.id]);

  // #1583: onboarding_completed-funnel-event når alle steps er nået (4/4).
  // logFirstEvent de-dup'er pr. bruger, så eventet kun fyrer én gang.
  useEffect(() => {
    if (!onboardingProgress) return;
    const { completed_count, total_count } = onboardingProgress;
    if (total_count > 0 && completed_count === total_count) {
      logFirstEvent("onboarding_completed", { completed_count, total_count });
    }
  }, [onboardingProgress]);

  // #940: team_drafted-funnel-event — fyrer FØRSTE gang manageren har en løbsklar
  // trup (≥ DRAFTED_SQUAD_THRESHOLD ejede ryttere). riders = ejede ryttere på
  // holdet nu (samme kilde som ownedNow). logTeamDrafted gater på tærsklen +
  // de-dup'er pr. bruger via logFirstEvent, så eventet kun lander én gang.
  useEffect(() => {
    if (team?.id) logTeamDrafted(riders.length);
  }, [team?.id, riders.length]);

  // #1005: hent de tre push-moduler fra deres aggregat-endpoints — kun når modulet
  // er synligt, så managere der har skjult dem ikke betaler omkostningen. Endpoints
  // er cachede server-side (60s), så toggle on→off→on rammer cachen. Effekten
  // kører EFTER first paint (#2444: intet af dette blokerer dashboardets critical
  // path — kortene fylder ud når svarene lander).
  useEffect(() => {
    let cancelled = false;
    async function loadExtras() {
      if (!recentResultsVisible && !riderRankingVisible && !myLatestResultVisible) return;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };
      // Parallelt (ikke sekventielt) — hvert kort fylder ud så snart dets eget
      // svar lander; især resultat-pushet (#2466) skal ikke vente bag to andre
      // round-trips. Hver gren er fortsat best-effort og fejler stille alene.
      await Promise.all([
        recentResultsVisible && (async () => {
          try {
            const r = await fetch(`${API}/api/dashboard/recent-results`, { headers });
            if (cancelled) return;
            // #3510 — svaret er nu SANDHEDEN uanset ok/fejl: r.ok → de rigtige
            // resultater (evt. []); ellers eksplicit [] så modulet falder tilbage
            // til empty-state fremfor at blive hængende i skeleton for evigt.
            setRecentResults(r.ok ? (await r.json()).races || [] : []);
          } catch { if (!cancelled) setRecentResults([]); }
        })(),
        riderRankingVisible && (async () => {
          try {
            const r = await fetch(`${API}/api/dashboard/rider-ranking`, { headers });
            if (cancelled) return;
            setRiderRanking(r.ok ? (await r.json()).riders || [] : []);
          } catch { if (!cancelled) setRiderRanking([]); }
        })(),
        // #2466: "How your team did" — holdets eget seneste løbsresultat.
        myLatestResultVisible && (async () => {
          try {
            const r = await fetch(`${API}/api/dashboard/my-latest-result`, { headers });
            if (r.ok && !cancelled) {
              const body = await r.json();
              // race === undefined (fx mock-fallback {}) normaliseres til null →
              // kortets empty state i stedet for en død boks.
              setMyLatestResult({ ...body, race: body.race ?? null });
            }
          } catch { /* best-effort — kortet renderer intet ved fejl */ }
        })(),
      ]);
    }
    loadExtras();
    return () => { cancelled = true; };
  }, [recentResultsVisible, riderRankingVisible, myLatestResultVisible]);

  function dismissDiscordNudge() {
    localStorage.setItem("cz-dashboard-discord-nudge-dismissed", "1");
    setDiscordNudgeDismissed(true);
    setShowDiscordNudge(false);
  }

  function dismissOnboarding() {
    // Optimistisk lokal UI-state med det samme (undgår flash mens API-kaldet er i flugt).
    sessionStorage.setItem("cz-dashboard-onboarding-dismissed", "1");
    setOnboardingDismissed(true);
    // #2439: persistér SERVER-SIDE (teams.onboarding_progress_dismissed_at) så
    // dismisset holder på tværs af enheder/sessions — erstatter det rent
    // session-scopede sessionStorage-dismiss fra #1569, som var rod-årsagen
    // til at kortet "spammede" etablerede spillere igen og igen.
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        await fetch(`${API}/api/me/onboarding-progress/dismiss`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // best-effort — lokal dismiss er allerede anvendt
      }
    })();
  }

  function dismissSeasonStart() {
    writeSeasonStartDismissed(seasonInfo?.id);
    setSeasonStartDismissed(true);
  }

  function dismissSeasonWrap() {
    writeSeasonWrapDismissed(completedSeasonRecap?.seasonId);
    setSeasonWrapDismissed(true);
  }

  // [epic #4592 del 3] "Tilmeld dig næste sæson" (#452). Ingen optimistisk
  // lokal state FØR svaret (til forskel fra dismissOnboarding ovenfor) — en
  // fejlet POST skal IKKE vise en falsk bekræftelse for noget så vigtigt som
  // "beholder jeg min plads". Knappen viser sin egen loading-tilstand
  // (Button `loading`-prop) mens kaldet er i flugt.
  async function handleSeasonSignup() {
    setSeasonSignupSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch(`${API}/api/season/signup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = await res.json();
        setSeasonSignupStatus((prev) => ({
          ...(prev || {}),
          signed_up: true,
          next_season_number: body.next_season_number ?? prev?.next_season_number,
        }));
      }
    } catch {
      // best-effort — kortet forbliver i sin ikke-tilmeldt tilstand, manageren kan prøve igen
    } finally {
      setSeasonSignupSubmitting(false);
    }
  }

  function dismissCompletion() {
    localStorage.setItem("cz-dashboard-onboarding-completion-dismissed", "1");
    setCompletionDismissed(true);
  }

  if (loading) return (
    <PageLoader />
  );

  // #3510 — kanonisk ErrorState (docs/design/PAGE_TEMPLATES.md) i stedet for at
  // falde igennem til et fuldt tomt dashboard. Retry gen-kalder loadAll direkte
  // (samme mønster som StandingsPage/#2175); setLoading(true) genviser
  // PageLoader mens den nye forespørgsel er i flugt.
  if (error) return (
    <div translate="no" className="max-w-5xl mx-auto">
      <ErrorState
        title={t("dashboard:loadError")}
        action={<Button size="sm" variant="secondary" onClick={() => { setLoading(true); loadAll(); }}>{t("dashboard:retry")}</Button>}
      />
    </div>
  );

  const winningAuctions = allAuctions.filter(a => getAuctionLeaderId(a) === team?.id);
  const myAuctions = allAuctions.filter(a => isAuctionSeller(a, team?.id));

  // Auktioner jeg deltager i (sælger eller fører). allAuctions er markedsbredt,
  // men stat-kortet + listen skal vise MINE auktioner — ellers mismatch (#271 Slice C).
  const myActiveAuctions = allAuctions.filter(a => isAuctionSeller(a, team?.id) || getAuctionLeaderId(a) === team?.id);

  // "Næste træk": af mine auktioner dem der slutter < 1 time.
  const urgentAuctionCount = myActiveAuctions.filter(a => {
    const diff = new Date(a.calculated_end) - new Date();
    return diff > 0 && diff < 3600000;
  }).length;
  // #1830 · board-bred tilfredshed (delt med Bestyrelse-siden). Fald tilbage til
  // den aktive plans værdi hvis aggregatet mangler, så kortet aldrig viser tomt.
  const displaySatisfaction = boardSatisfaction ?? board?.satisfaction ?? null;
  const satisfactionColor = displaySatisfaction >= 70 ? "text-cz-success" : displaySatisfaction >= 40 ? "text-cz-accent-t" : "text-cz-danger";

  // Squad warnings — bug #250: tæller skal forudsige fremtidens hold-størrelse
  // (ejede MINUS pending-out PLUS pending-in PLUS indgående lån), ikke nuværende
  // ejet-tal. Ellers viser dashboardet falske over/under-warnings når en
  // manager har transfers pending over et vindue. #1090: indgående lån dækker
  // også window_pending (parkeret til næste sæson) — paritet med backend
  // getTeamMarketState.
  const squadStats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount,
    myTeamId: team?.id,
    division: team?.division,
  });
  const { ownedNow, outgoingCount, warning: squadWarning } = squadStats;

  // #1150 · kontraktudløb-varsel: ryttere hvis kontrakt udløber ved NÆSTE
  // sæsonskifte (contract_end_season <= den AKTIVE sæsons nummer) — samme rene
  // klassifikation som squad-tabellens contractExpiring-badge (#3097,
  // TeamPage.jsx). Ejer-design 3/8 (#1150): "genforhandling MED frigivelse" —
  // ikke-handling frigiver rytteren ved skiftet, så dette skal være svært at
  // overse i modsætning til den passive badge alene (170 af 180 menneskehold
  // ramt ved S2→S3, dry-run 5/8, se scripts/dryRunContractExpirySeasonEnd.js).
  const expiringContractCount = riders.filter(
    (r) => isContractExpiringAtTransition(r.contract_end_season, seasonInfo?.number)
  ).length;

  // #2328 — "Kommende løb"-kortet: de 3 faktisk kommende løb efter ægte
  // race_stage_schedule-tid (nextStageByRace), ikke den statiske PCM-dato som
  // det tidligere top-3-udvalg blev sorteret på FØR den ægte tid var kendt.
  // #3751 — filtreret til holdets EGNE løb først: et hold der tilmelder sig
  // midt i et etapeløb er ikke med i det løb (trup låst), og skal ikke se en
  // nedtælling til det. No-op for etablerede hold (de ER tilmeldt).
  const displayedRaces = pickUpcomingRaces(
    filterTeamEnteredRaces(nextRaces, teamRaceIds),
    nextStageByRace,
    3
  );

  // My division+pool standings (#2182 — default er spillerens egen division OG
  // pulje, ikke hele tieren; en tier kan have op til 8 puljer, se
  // database/2026-06-21-league-divisions-pyramid.sql). Filter-logikken er
  // udtrukket til lib/dashboardDivStandings.js (ren funktion, unit-testet med
  // `node --test`) i stedet for at leve inline her — genbruger StandingsPage's
  // matchesPoolTab (lib/standingsPoolFilter.js #2879) internt fremfor en
  // parallel implementering. hasPoolSubtabs falder tilbage til false (= ingen
  // pulje-filtrering, hele tieren, som i dag) hvis egen pulje endnu er ukendt
  // (helt nyt hold uden league_division_id), så modulet aldrig render'er tomt
  // for den kant-sag (#2182 acceptance).
  // #3506: _rank er nu det kanoniske, Standings-konsistente tal (AI-hold med
  // i rangberegningen, jf. #1718). myManagerRank er det sekundære "blandt
  // managere"-tal (kun menneskehold), vist som lille tillægslinje på egen række.
  const { hasPoolSubtabs, ownPoolRow, divStandingsAll, divStandingsTop, divStandings, myManagerRank } =
    computeMyDivisionStandings(standings, team, pools);

  // vk-movement-signals — divisionsplacering + holdpoint siden sidste
  // afsluttede løbsdag i egen pulje. null/0 → ingen badge (ingen "0"-støj,
  // samme konvention som GlobalRankWidget's movement != null && movement !== 0).
  const { rankMovement, pointsDelta } = computeDivisionMovement({
    divStandingsAll, myTeamId: team?.id, pointsByTeam: lastRaceDayPoints,
  });

  const pendingIncoming = pendingIncomingCount;
  const activeMarketOffers = activeOffers.filter(o =>
    ["pending", "countered", "awaiting_confirmation", "window_pending"].includes(o.status)
  );

  // #2288 B — banner-prioritering: indtil onboarding er fuldført skal onboarding-
  // kortet have hele skærmen for sig selv (ingen Discord-nudge, der konkurrerer om
  // opmærksomhed med de 4 kom-i-gang-trin). SurveyBanner er fjernet (#2467: admin-
  // preview uden ægte Tally-URL loggede survey_banner_shown ved hver mount og
  // forurenede player_events — 8% af tabellen fra 2 admin/test-brugere). Komponenten
  // ligger stadig i git-historikken og kan genindføres når en ægte survey-URL findes.
  const onboardingIncomplete = Boolean(
    onboardingProgress && onboardingProgress.completed_count < onboardingProgress.total_count
  );

  // #3310 comeback-buen: første-løbs-øjeblikket ejer toppen af dashboardet
  // indtil manageren har set sit første resultat (samme server-flag som
  // "Nyt"-badgen, teams.my_result_seen_race_id via #2593 del 2).
  const firstRaceMomentActive = myLatestResultVisible && isFirstRaceMoment(myLatestResult);
  const showDiscordNudgeBanner = !onboardingIncomplete && showDiscordNudge;

  // #dashboard-layout-25/8 (docs/DASHBOARD_RULES.md §4) — betingelser for de to
  // øvre par ([Seneste resultat|Næste træk] og [Holdudtagelse|Sæsonstatus]).
  // myLatestResultPaired dækker KUN normaltilstanden — first-race-momentet
  // ovenfor (#3310) ejer toppen alene og deltager ikke i parringen.
  const myLatestResultPaired = !firstRaceMomentActive && myLatestResultVisible;
  const nextActionsVisible = isVisible("nextActions");
  // TeamSelectionCtaCard afgør selv om den renderer (kræver nextRace) — vi
  // spejler samme betingelse her for at vide hvornår kollaps-col-span skal på.
  const showTeamSelectionCta = Boolean(squadSelectionMissingRace);

  // #2925 — sæsonstart-guiden. Undertrykt mens onboarding kører (samme regel som
  // Discord-nudgen, #2288 B: onboarding-kortet får skærmen for sig selv), og kun
  // inden for vinduet. `ownedNow` og `boardPlanMissing` er allerede hentet, så
  // kun to lette tællinger kommer oveni.
  // #2752/#2361 — samme vindue/onboarding-undertrykkelse som sæsonstart-guiden;
  // eget dismiss + kræver at completedSeasonRecap rent faktisk blev fundet
  // (ingen tom/halv-udfyldt kort mens fetch'et stadig kører eller fejlede).
  const showSeasonWrapNudge = seasonStartWindowOpen && !seasonWrapDismissed && !onboardingIncomplete && !!completedSeasonRecap;
  const showSeasonStartGuide = seasonStartWindowOpen && !seasonStartDismissed && !onboardingIncomplete;

  // [epic #4592 del 3] "Tilmeld dig næste sæson" (#452) — vises KUN når
  // backend-flaget er on (default off, fail-safe) OG holdet rent faktisk er
  // kandidat (parkeret ELLER inaktiv, samme definition som parkerings-
  // sweepen). BEVIDST IKKE undertrykt af onboardingIncomplete (til forskel
  // fra søskende-kortene ovenfor): en manager der onboardede og forsvandt
  // UDEN at gennemføre et eneste af de 4 kom-i-gang-trin kan sagtens være
  // 30-dages-inaktiv — og er netop den manager kortet skal nå. At skjule det
  // bag onboarding ville gemme det for præcis dem der har mest brug for det.
  const showSeasonSignupCard = Boolean(seasonSignupStatus?.enabled && seasonSignupStatus?.eligible);

  // #3509 — gold-CTA prioritetskæde (docs/design/PAGE_TEMPLATES.md: maks ÉN gold
  // primary-knap pr. view). Rækkefølge: first-race-moment > squad-selection-CTA >
  // season-signup > season-wrap (#4592). Kun det højst-prioriterede aktive kort
  // beholder guld; resten nedgraderes til sekundær variant (samme mønster som
  // MyLatestResultCard's eksisterende nedgradering af TeamSelectionCtaCard). Ren
  // logik i lib/dashboardGoldCta.js — se DashboardPage.goldCtaPriority.test.js
  // for dækning af alle kombinationer.
  const { squadCtaActive, seasonSignupPrimary, seasonWrapPrimary } = computeDashboardGoldCta({
    firstRaceMomentActive,
    squadCtaEligible: !!squadSelectionMissingRace,
    seasonSignupEligible: showSeasonSignupCard,
    seasonWrapVisible: showSeasonWrapNudge,
  });
  const seasonStartItems = showSeasonStartGuide
    ? buildSeasonStartItems({
      squadCount: ownedNow,
      trainingPlanCount: seasonStartCounts.trainingPlanCount,
      boardPlanMissing,
      boardStatusLoaded,
      pendingGraduations: seasonStartCounts.pendingGraduations,
      academyEnabled,
    })
    : [];

  return (
    // #2253: translate="no" — dashboardet re-committer hyppigt tekst-noder (live
    // race-data, countdowns); browser-oversættere muterede dem og udløste
    // NotFoundError-crashes (Sentry-events med url=/dashboard). Se PR #2272.
    <div translate="no" className="max-w-5xl mx-auto">
      {/* Header — #2849 bølge 1: kanonisk PageHeader (docs/design/PAGE_TEMPLATES.md).
          actions-slotten bærer saldo-linket + customize-menuen uændret (features
          bevares; action-cluster-kontrakten på maks 1 select + 1 primary håndhæves
          ikke retroaktivt her). */}
      <PageHeader
        title={team?.name}
        subtitle={
          <>
            {t("dashboard:header.subtitle", { division: team?.division, count: ownedNow })}
            {pendingIncomingCount > 0 && <span className="text-cz-success"> {t("dashboard:header.incoming", { count: pendingIncomingCount })}</span>}
            {outgoingCount > 0 && <span className="text-cz-danger"> {t("dashboard:header.outgoing", { count: outgoingCount })}</span>}
          </>
        }
        actions={
          <>
            {/* #2288 E — synlig klikbar affordance: hover-underline + chevron, så
                saldoblokken læses som et link (den linker allerede til /finance). */}
            <Link to="/finance" className="flex items-center gap-1 text-right group" title={t("common:sidebar.balance")}>
              <div>
                {/* #3508: disponibel saldo (rå minus bundet i førende bud + proxy-max) —
                    samme beregning som FinancePage (lib/availableBalance.js), aldrig rå
                    team.balance. Det bundne beløb er synligt nedenfor (genbruger
                    FinancePage's "locked in bids"-formsprog). */}
                <p className="text-cz-accent-t font-mono font-bold text-xl group-hover:underline">
                  {formatNumber(computeAvailableBalance(team?.balance, reservedBalance))} CZ$
                </p>
                <p className="text-cz-3 text-xs">{t("common:sidebar.balance")}</p>
                {reservedBalance > 0 && (
                  <p className="text-cz-3/70 text-xs">
                    {t("dashboard:header.lockedInBids", { value: formatNumber(reservedBalance) })}
                  </p>
                )}
              </div>
              <ChevronRightIcon size={16} className="text-cz-3 group-hover:text-cz-accent-t transition-colors flex-shrink-0" aria-hidden="true" />
            </Link>
            {/* Customize-knap (#1005) — vis/skjul moduler. Top-højre = konventionel
                placering for view-indstillinger, så den er let at finde (#957-follow-up). */}
            <DashboardCustomizeMenu
              open={customizeOpen}
              onToggleOpen={() => setCustomizeOpen(o => !o)}
              isVisible={isVisible}
              toggleModule={toggleModule}
              resetToDefault={resetToDefault}
              t={t}
            />
          </>
        }
      />

      {/* Squad warning + kontrakt-fornyelses-advarsel — ALLERØVERST i
          indholdsflowet, over dagens etaper. #3915 satte oprindeligt dagens
          etaper allerøverst, men ejer besluttede 25/8 at KUN advarsler må stå
          over dem: en trup under minimum og udløbende kontrakter er de eneste
          ting på siden der koster point hvis de overses (Clarity: 94,65%
          scroll-dybde — synlighed er ikke problemet, punktér de dyre ting). */}
      {squadWarning && (
        <div className={`mb-4 px-4 py-3 rounded-cz text-sm border flex items-center gap-2
          ${squadWarning.color === "red"
            ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
            : "bg-cz-warning-bg text-cz-warning border-cz-warning/30"}`}>
          <AlertTriangleIcon size={16} className="flex-shrink-0" />
          <span>{t(`dashboard:squadWarning.${squadWarning.type}`, {
            count: squadWarning.count,
            limit: squadWarning.limit,
            division: squadWarning.division,
          })}</span>
          <Link to="/team" className="ms-auto text-xs underline opacity-70 hover:opacity-100">{t("dashboard:squadWarning.ctaMyTeam")}</Link>
        </div>
      )}

      {/* #1150 · Contract renewal warning — separat fra squad-cap-warningen
          ovenfor (anden årsag, samme visuelle sprog). Vises altid når der er
          udløbende kontrakter, uanset squad-cap-status. */}
      {expiringContractCount > 0 && (
        <div className="mb-4 px-4 py-3 rounded-cz text-sm border flex items-center gap-2 bg-cz-warning-bg text-cz-warning border-cz-warning/30">
          <AlertTriangleIcon size={16} className="flex-shrink-0" />
          <span>{t("dashboard:contractWarning.message", { count: expiringContractCount })}</span>
          <Link to="/team" className="ms-auto text-xs underline opacity-70 hover:opacity-100">{t("dashboard:contractWarning.cta")}</Link>
        </div>
      )}

      {/* #3915 — dagens etaper/løb for holdet, herefter i indholdsflowet (under
          page-header + advarsler ovenfor). #3915 satte den oprindeligt
          allerøverst; ejer besluttede 25/8 at KUN advarsler (trup + kontrakt-
          fornyelse, se blokken ovenfor) må stå over dagens etaper — se docs/
          DASHBOARD_RULES.md §2. Skjuler sig selv når holdet ingen løb har i
          dag (mindst-støj-valg, ejer 18/8). */}
      <TodayStagesStrip teamId={team?.id} />

      {/* #3310: første-løbs-øjeblikket ejer toppen ALENE indtil resultatet er
          set — INGEN par, i modsætning til normaltilstanden lige nedenfor. */}
      {firstRaceMomentActive && (
        <div className="mb-4">
          <MyLatestResultCard
            data={myLatestResult}
            nextRace={squadSelectionMissingRace}
            nextRaceStartAtMs={squadSelectionMissingRace ? nextStageByRace[squadSelectionMissingRace.id] : null}
            nowMs={nowMs}
          />
        </div>
      )}

      {/* #dashboard-layout-25/8 (docs/DASHBOARD_RULES.md §4) — [Seneste resultat |
          Næste træk]: "hvad skete der / hvad skal jeg gøre" side om side fra lg.
          MyLatestResultCard renderer her KUN i normaltilstand (ikke under
          first-race-momentet ovenfor, #3310) — kollapser til fuld bredde hvis
          dens partner er skjult, så et par med ét skjult modul aldrig efterlader
          en tom celle. */}
      {(myLatestResultPaired || nextActionsVisible) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-[14px] mb-4">
          {myLatestResultPaired && (
            <div className={nextActionsVisible ? undefined : "lg:col-span-2"}>
              <MyLatestResultCard data={myLatestResult} />
            </div>
          )}
          {nextActionsVisible && (
            <div className={myLatestResultPaired ? undefined : "lg:col-span-2"}>
              <NextActionsCard
                pending={actionSummary}
                urgentAuctionCount={urgentAuctionCount}
                loading={actionLoading}
                squadSelectionMissingRace={squadSelectionMissingRace}
                notTrainedToday={notTrainedToday}
                boardPlanMissing={boardPlanMissing}
              />
            </div>
          )}
        </div>
      )}

      {/* #dashboard-layout-25/8 (docs/DASHBOARD_RULES.md §4) — [Holdudtagelse |
          Sæsonstatus] side om side fra lg. Samme kollaps-mønster som ovenfor:
          begge kort afgør selv om de renderer intet (TeamSelectionCtaCard uden
          nextRace, sæsonbanneret uden seasonInfo), så vi spejler den samme
          betingelse her for at vide hvornår kollaps-col-span skal på. */}
      {(showTeamSelectionCta || seasonInfo) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-[14px] mb-4">
          {showTeamSelectionCta && (
            <div className={seasonInfo ? undefined : "lg:col-span-2"}>
              {/* #1681: holdudtagelse-CTA — synlig genvej direkte til det løb der
                  reelt MANGLER udtagelse (squadSelectionMissingRace, #2328).
                  #3243: startAtMs/nowMs giver kortet en ægte countdown til
                  løbsstart. */}
              <TeamSelectionCtaCard
                nextRace={squadSelectionMissingRace}
                startAtMs={squadSelectionMissingRace ? nextStageByRace[squadSelectionMissingRace.id] : null}
                nowMs={nowMs}
                primary={squadCtaActive}
              />
            </div>
          )}
          {seasonInfo && (
            <div className={showTeamSelectionCta ? undefined : "lg:col-span-2"}>
              {/* Season Status Banner — links to the race calendar (#1421: was a
                  dead Card). #2328: rettet fra /races (RaceHub) til /calendar.
                  #3102 etape 3 (PR 3): kalenderen er en fane i Planlægnings-hubben. */}
              <Link to="/planning?tab=calendar" className="group block h-full">
                <Card
                  borderClass="border-cz-border group-hover:border-cz-accent/30"
                  className="px-5 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 transition-colors h-full"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:seasonBanner.title", { number: seasonInfo.number })}</span>
                    <span className={`text-3xs px-1.5 py-0.5 rounded-full font-medium border
                      ${seasonInfo.status === "active" ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                      : seasonInfo.status === "upcoming" ? "bg-cz-info-bg text-cz-info border-cz-info/30"
                      : "bg-cz-subtle text-cz-2 border-cz-border"}`}>
                      {t(`dashboard:seasonBanner.status.${seasonInfo.status}`, { defaultValue: seasonInfo.status })}
                    </span>
                  </div>

                  {seasonInfo.end_date && (() => {
                    const daysLeft = Math.ceil((new Date(seasonInfo.end_date) - new Date()) / 86400000);
                    if (daysLeft <= 0) return <span className="text-cz-3 text-xs">{t("dashboard:seasonBanner.ended")}</span>;
                    return (
                      <div className="flex items-center gap-1.5">
                        <span className="text-cz-1 font-mono font-bold text-sm">{daysLeft}</span>
                        <span className="text-cz-3 text-xs">{t("dashboard:seasonBanner.daysLeftSuffix")}</span>
                      </div>
                    );
                  })()}

                  {/* #1829/#4245: per-pulje ETAPER (kørt inkl. igangværende / puljens total), ikke det
                      sæson-globale tal og ikke løbsdage. Falder bort hvis puljen ingen løb har (fx pulje-løst hold). */}
                  {(poolStages?.total || 0) > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-cz-3 text-xs whitespace-nowrap">
                        {t("dashboard:seasonBanner.stages", { completed: poolStages.completed, total: poolStages.total })}
                        {poolStages.inProgress > 0 && (
                          <span className="text-cz-accent-t ms-1">· {t("dashboard:seasonBanner.stagesLive", { count: poolStages.inProgress })}</span>
                        )}
                      </span>
                      <ProgressMeter
                        value={poolStages.completed}
                        max={poolStages.total}
                        tone="accent"
                        className="w-20"
                        trackClassName="h-1.5"
                        ariaLabel={t("dashboard:seasonBanner.stages", { completed: poolStages.completed, total: poolStages.total })}
                      />
                    </div>
                  )}

                  <div className="ms-auto flex items-center gap-3">
                    <span className="text-xs text-cz-accent-t group-hover:underline whitespace-nowrap">{t("dashboard:seasonBanner.viewCalendar")}</span>
                  </div>
                </Card>
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Trin 7-overgangspanelet (#3746/#3803, ejer-design 18/8) — engangs-
          forklaring af loft-omlægningen med holdets egne før/efter-tal.
          Selv-gatende: renderer kun når backfillen har kørt og holdet ikke
          har dismissed (server-persisteret). #dashboard-layout-25/8: rykket
          ned efter de to nye par (docs/DASHBOARD_RULES.md §4 — "betingede
          engangskort" står EFTER [Seneste resultat|Næste træk] og
          [Holdudtagelse|Sæsonstatus], ikke lige efter dagens etaper). */}
      <DevTransitionCard />

      {/* #2288 B — Onboarding progress flyttet til TOP af stakken (over Næste
          træk) indtil onboarding er fuldført, så den ikke drukner blandt andre
          kort. Completion-kortet bliver hvor det plejer (post-onboarding). */}
      {!onboardingDismissed && onboardingIncomplete && (
        <div className={firstRaceMomentActive ? "opacity-75" : undefined}>
          <OnboardingProgressCard progress={onboardingProgress} onDismiss={dismissOnboarding} />
        </div>
      )}

      {/* #2752/#2361 — "Sæson N er slut": den aktive sæson-lukning. Står FØR
          "kom i gang"-tjeklisten (samme vindue, egen dismiss) — narrativ-
          rækkefølgen er facit først ("hvad skete der"), så opgaver ("hvad nu").
          CTA'en leder til /seasons/:id, som nu viser SeasonRecapHero (samme
          data) for holdet. */}
      {showSeasonWrapNudge && (
        <SeasonWrapNudgeCard
          seasonNumber={completedSeasonRecap.seasonNumber}
          nextSeasonNumber={seasonInfo?.number}
          division={completedSeasonRecap.division}
          divisionSize={completedSeasonRecap.divisionSize}
          rank={completedSeasonRecap.rank}
          movement={completedSeasonRecap.movement}
          points={completedSeasonRecap.points}
          wins={completedSeasonRecap.wins}
          primary={seasonWrapPrimary}
          onView={() => navigate(`/seasons/${completedSeasonRecap.seasonId}`)}
          onDismiss={dismissSeasonWrap}
        />
      )}

      {/* [epic #4592 del 3] "Tilmeld dig næste sæson" (#452) — placeret mellem
          sæson-opsummeringen og sæsonstart-guiden (docs/DASHBOARD_RULES.md §4/
          §5: ikke en af de historisk ejer-låste rækker i §2, bygget som Card
          ikke banner jf. §3). Tematisk nabo til de to andre sæson-kort:
          "sæsonen sluttede" → "beholder du din plads" → "sæsonen startede". */}
      {showSeasonSignupCard && (
        <SeasonSignupCard
          nextSeasonNumber={seasonSignupStatus?.next_season_number}
          parked={Boolean(seasonSignupStatus?.parked)}
          signedUp={Boolean(seasonSignupStatus?.signed_up)}
          submitting={seasonSignupSubmitting}
          primary={seasonSignupPrimary}
          onSignUp={handleSeasonSignup}
        />
      )}

      {/* #2925 — "Season N: kom i gang". Over "Næste træk", fordi de fire
          sæsonskifte-beslutninger er dét der reelt venter mandag morgen; kortet
          forsvinder af sig selv når vinduet lukker (7 dage) eller ved dismiss. */}
      {showSeasonStartGuide && (
        <SeasonStartGuideCard
          seasonNumber={seasonInfo?.number}
          items={seasonStartItems}
          onDismiss={dismissSeasonStart}
        />
      )}

      {/* Onboarding completion — vis engang når alle 4 trin er gennemført */}
      {!completionDismissed && onboardingProgress && onboardingProgress.completed_count === onboardingProgress.total_count && (
        <OnboardingCompletionCard onDismiss={dismissCompletion} />
      )}

      {/* Discord DM nudge — undertrykt under onboarding (#2288 B). SurveyBanner er
          fjernet (#2467), så den var tidligere den anden halvdel af "max 1
          nudge-banner ad gangen"-reglen. */}
      {showDiscordNudgeBanner && (
        <div className="mb-4 px-4 py-3 bg-cz-card border border-cz-discord/30 rounded-cz flex items-center gap-3">
          <div className="w-8 h-8 rounded-cz bg-cz-discord/20 flex items-center justify-center flex-shrink-0">
            <DiscordIcon size={16} className="text-cz-discord" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-cz-1 text-sm font-medium">{t("dashboard:discordNudge.title")}</p>
            <p className="text-cz-3 text-xs mt-0.5">{t("dashboard:discordNudge.subtitle")}</p>
          </div>
          {/* Discord-branded knap — bevidst IKKE gold/accent (viewets ene guld-
              knap er styret af computeDashboardGoldCta). Bruger buttonClass'
              BASE+size-sm-form (px-3 py-1.5 text-xs, rounded-cz) uden dens
              farve-variant: at lægge et diskret-farve-override oveni
              buttonClass({variant}) risikerer samme tavse cascade-tab som
              Card.jsx's borderClass-fælde (to bg-*-klasser på samme property,
              vinderen afgøres af CSS-bundle-rækkefølge, ikke JSX). */}
          <Link
            to="/profile"
            className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-cz border border-transparent text-xs font-semibold bg-cz-discord text-white transition-colors duration-150 ease-out hover:bg-cz-discord-hover flex-shrink-0">
            {t("dashboard:discordNudge.cta")}
          </Link>
          <button
            onClick={dismissDiscordNudge}
            className="text-cz-3 hover:text-cz-1 leading-none px-1 flex-shrink-0"
            aria-label={t("dashboard:discordNudge.dismissAria")}>
            <XIcon size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* #1140: OnboardingModal er konsolideret væk — OnboardingProgressCard
          ovenfor er den kanoniske onboarding-UI. Filen beholdes (genbruges evt.
          senere), men monteres ikke længere her. */}

      {/* #3398 (Maiden Win Engine): career-first-momentkort — renderer intet
          uden data. Bevidst FØR Hero & Agony: en career-first er det sjældnere,
          større øjeblik. */}
      <MaidenWinMomentCard />

      {/* #3397: Hero & Agony moment-kort — selv-hentende, se HeroAgonyCard.jsx. */}
      {heroAgonyVisible && <HeroAgonyCard teamId={team?.id} teamName={team?.name} />}

      {/* Main grid — #2849 bølge 1: sibling-gap 14px (spec) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[14px]">

        {/* My auctions + winning */}
        {isVisible("auctions") && (
        <Section>
          <SectionHeader
            title={t("dashboard:cards.auctions.title")}
            action={<SectionAction as={Link} to="/auctions">{t("dashboard:cards.auctions.linkAll")}</SectionAction>}
          />
          {myActiveAuctions.length === 0 ? (
            <EmptyState
              title={t("dashboard:cards.auctions.empty")}
              action={
                <Link to="/auctions" className={buttonClass({ variant: "secondary", size: "sm" })}>
                  {t("dashboard:cards.auctions.emptyCta")}
                </Link>
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {[...winningAuctions, ...myAuctions.filter(a => getAuctionLeaderId(a) !== team?.id)]
                .slice(0, 5).map(a => {
                  const isWinning = getAuctionLeaderId(a) === team?.id;
                  const isSelling = isAuctionSeller(a, team?.id);
                  const diff = new Date(a.calculated_end) - new Date();
                  const h = Math.floor(diff / 3600000);
                  const m = Math.floor((diff % 3600000) / 60000);
                  const timeLeft = diff < 0
                    ? t("dashboard:cards.auctions.expired")
                    : h > 0
                      ? t("dashboard:cards.auctions.timeLeftHm", { h, m })
                      : t("dashboard:cards.auctions.timeLeftM", { m });
                  const urgent = diff > 0 && diff < 600000;
                  return (
                    <div key={a.id} onClick={() => navigate("/auctions")}
                      className="flex items-center justify-between py-2 border-b border-cz-border last:border-0 cursor-pointer hover:bg-cz-subtle rounded px-1 -mx-1 transition-all">
                      <div className="flex-1 min-w-0">
                        <p className="text-cz-1 text-sm truncate">{a.rider?.firstname} {a.rider?.lastname}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {isWinning && <span className="text-3xs bg-cz-success-bg text-cz-success px-1.5 py-0.5 rounded-full">{t("dashboard:cards.auctions.winning")}</span>}
                          {isSelling && !isWinning && <span className="text-3xs bg-cz-info-bg text-cz-info px-1.5 py-0.5 rounded-full">{t("dashboard:cards.auctions.selling")}</span>}
                        </div>
                      </div>
                      <div className="text-right ms-3">
                        <p className="text-cz-accent-t font-mono text-sm font-bold">{formatNumber(a.current_price)} CZ$</p>
                        <p className={`text-xs font-mono ${urgent ? "text-cz-danger animate-pulse" : "text-cz-3"}`}>{timeLeft}</p>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </Section>
        )}

        {/* Pending transfers + offers */}
        {isVisible("transfers") && (
        <Section>
          <SectionHeader
            title={t("dashboard:cards.transfers.title")}
            action={<SectionAction as={Link} to="/transfers">{t("dashboard:cards.transfers.linkAll")}</SectionAction>}
          />
          {activeMarketOffers.length === 0 && pendingIncoming === 0 ? (
            <EmptyState
              title={t("dashboard:cards.transfers.empty")}
              action={
                <Link to="/transfers" className={buttonClass({ variant: "secondary", size: "sm" })}>
                  {t("dashboard:cards.transfers.emptyCta")}
                </Link>
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {pendingIncoming > 0 && (
                <div className="flex items-center gap-3 py-2 border-b border-cz-border">
                  <ArrowDownIcon aria-hidden="true" className="text-cz-success w-4 h-4 flex-shrink-0" />
                  <p className="text-cz-1 text-sm">{t("dashboard:cards.transfers.incomingCount", { count: pendingIncoming })}</p>
                </div>
              )}
              {activeMarketOffers.slice(0, 4).map(o => {
                const isReceived = o._dir === "received";
                const needsAction = (isReceived && ["pending", "awaiting_confirmation"].includes(o.status) && !o.seller_confirmed)
                  || (!isReceived && ["countered", "awaiting_confirmation"].includes(o.status) && !o.buyer_confirmed);
                return (
                  <div key={o.id} onClick={() => navigate("/transfers")}
                    className="flex items-center justify-between py-2 border-b border-cz-border last:border-0 cursor-pointer hover:bg-cz-subtle rounded px-1 -mx-1">
                    <div>
                      <p className="text-cz-1 text-sm">{o.rider?.firstname} {o.rider?.lastname}</p>
                      <p className="text-cz-3 text-xs">{isReceived
                        ? t("dashboard:cards.transfers.from", { name: o.buyer?.name })
                        : t("dashboard:cards.transfers.to", { name: o.seller?.name })}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-cz-accent-t font-mono text-sm">{formatNumber(getEffectiveOfferAmount(o))} CZ$</p>
                      <span className={`text-3xs ${needsAction ? "text-cz-warning" : "text-cz-3"}`}>
                        {needsAction
                          ? t("dashboard:cards.transfers.needsAction")
                          : t("dashboard:cards.transfers.active")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
        )}

        {/* Upcoming races */}
        {isVisible("races") && (
        <Section>
          <SectionHeader
            title={t("dashboard:cards.races.title")}
            action={<SectionAction as={Link} to="/planning">{t("dashboard:cards.races.linkAll")}</SectionAction>}
          />
          {displayedRaces.length === 0 ? (
            <EmptyState
              title={t("dashboard:cards.races.empty")}
              action={
                <Link to="/planning" className={buttonClass({ variant: "secondary", size: "sm" })}>
                  {t("dashboard:cards.races.emptyCta")}
                </Link>
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {displayedRaces.map((race) => (
                <Link key={race.id} to={`/races/${race.id}`} state={{ from: "dashboard" }}
                  className="flex items-center justify-between py-2.5 border-b border-cz-border last:border-0 cursor-pointer hover:bg-cz-subtle rounded px-1 -mx-1 transition-all">
                  <div>
                    <p className="text-cz-1 text-sm font-medium">{race.name}</p>
                    <p className="text-cz-3 text-xs mt-0.5">
                      {race.race_type === "stage_race"
                        ? t("dashboard:cards.races.stages", { count: race.stages })
                        : t("dashboard:cards.races.oneDay")}
                    </p>
                  </div>
                  <div className="text-right">
                    {/* #1828: et igangværende etapeløb vises "Live" + etape-fremdrift i stedet for datoen. */}
                    {deriveRaceStatus(race.status, race.stages_completed, race.stages) === "live" ? (
                      <span className="inline-flex flex-col items-end gap-0.5">
                        <span className="inline-flex items-center gap-1 text-3xs uppercase tracking-wide px-2 py-0.5 rounded-full border bg-cz-accent/10 text-cz-accent-t border-cz-accent/30">
                          {t("dashboard:cards.races.live")}
                          {race.race_type === "stage_race" && (
                            <span className="font-mono normal-case tracking-normal">{race.stages_completed}/{race.stages}</span>
                          )}
                        </span>
                        {nextStageByRace[race.id] && (
                          <span className="text-3xs text-cz-3 tabular-nums">{formatCountdown(nextStageByRace[race.id], nowMs, t)}</span>
                        )}
                      </span>
                    ) : nextStageByRace[race.id]
                      ? <p className="text-cz-2 text-sm tabular-nums">{formatCountdown(nextStageByRace[race.id], nowMs, t)}</p>
                      : <p className="text-cz-3 text-sm">{t("dashboard:cards.races.scheduled")}</p>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>
        )}

        {/* Forum-synlighed (#3199, variant B) — "From the forum", parret med
            "Løb" (docs/DASHBOARD_RULES.md §4). Almindeligt Card, ikke en CTA —
            tager IKKE viewets guld-knap og tæller ikke i nudge-banner-reglen
            (se ForumHighlightsCard-kommentaren). Valgfri via customize (#1005). */}
        {isVisible("forumHighlights") && <ForumHighlightsCard />}

        {/* My division standings */}
        {isVisible("divStandings") && (
        <Section>
          <SectionHeader
            // #2182 — når egen tier har flere puljer, vises puljens rigtige label
            // ("Division 3 — B", samme label-kilde som StandingsPage's
            // league_divisions-query) i stedet for det generiske tier-tal, så
            // titlen matcher hvad modulet faktisk viser (egen pulje, ikke hele tieren).
            title={hasPoolSubtabs && ownPoolRow
              ? t("dashboard:cards.standings.titlePool", { label: ownPoolRow.label })
              : t("dashboard:cards.standings.title", { division: team?.division })}
            action={<SectionAction as={Link} to="/standings">{t("dashboard:cards.standings.linkAll")}</SectionAction>}
          />
          {divStandings.length === 0 ? (
            <EmptyState
              title={t("dashboard:cards.standings.empty")}
              action={
                <Link to="/standings" className={buttonClass({ variant: "secondary", size: "sm" })}>
                  {t("dashboard:cards.standings.emptyCta")}
                </Link>
              }
            />
          ) : (
            <div className="flex flex-col gap-1">
              {divStandings.map((s) => {
                const isMe = s.team_id === team?.id;
                const isLeader = s._rank === 1;
                const maxPts = divStandingsTop[0]?.total_points || 1;
                return (
                  <Fragment key={s.id}>
                    {/* #2328 — egen række uden for top-5 skilles visuelt fra
                        top-5-blokken med en tynd skillelinje, så spring i
                        placeringsnummeret (fx #5 → #14) ikke ser ud som en fejl. */}
                    {s._isOwnRowBreak && (
                      <div className="border-t border-cz-border my-1" aria-hidden="true" />
                    )}
                    {/* #2795-opfoelgning: er egen raekke ogsaa leder, bruges kun
                        kanten - fladetoningen ville ellers ligge oven paa
                        leder-guldet. Samme opdeling som .cz-me / .cz-me-bar i
                        tabellerne, saa dashboardet ser ud som /standings. */}
                    <Link to="/standings"
                      className={`${isMe ? (isLeader ? "cz-me-block-bar " : "cz-me-block ") : ""}flex items-center gap-3 py-1.5 -mx-2 px-2 rounded-lg transition-colors ${isLeader ? "bg-cz-accent/[0.08]" : "hover:bg-cz-subtle"}`}>
                      <span className={`font-mono text-xs w-4 text-right flex-shrink-0 ${isLeader ? "text-cz-accent-t" : "text-cz-3"}`}>#{s._rank}</span>
                      {/* vk-movement-signals — divisionsplacerings-bevægelse siden
                          sidste løbsdag, KUN på egen række. null/0 = ingen løbsdag endnu
                          eller uændret placering → ingen badge (ingen "0"-støj, samme
                          konvention som GlobalRankWidget). */}
                      {isMe && rankMovement != null && rankMovement !== 0 && (
                        <span
                          title={t("dashboard:cards.standings.movementTitle")}
                          className={`font-mono text-3xs font-bold inline-flex items-center gap-0.5 flex-shrink-0 ${rankMovement > 0 ? "text-cz-success" : "text-cz-danger"}`}
                        >
                          {rankMovement > 0
                            ? <ArrowUpIcon size={11} aria-hidden="true" />
                            : <ArrowDownIcon size={11} aria-hidden="true" />}
                          {Math.abs(rankMovement)}
                        </span>
                      )}
                      <div className="w-28 flex-shrink-0 min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <p className={`text-sm truncate ${isMe ? "text-cz-1 font-medium" : "text-cz-2"}`}>{s.team?.name}</p>
                          {/* #1718/#3506 — diskret AI-markør, samme dæmpede stil som
                              Standings-siden (lib/standingsPoolFilter-relateret formsprog) —
                              AI-hold tælles nu med i rangberegningen og kan optræde i
                              top-5, og skal kunne skelnes ligesom på målsiden. */}
                          {s.team?.is_ai && (
                            <span className="shrink-0 rounded border border-cz-border px-1 py-0.5 text-3xs font-medium uppercase text-cz-3">
                              {t("dashboard:cards.standings.aiBadge")}
                            </span>
                          )}
                        </div>
                        {/* #3506 — sekundær tillægslinje: kun på egen række, og kun når
                            "blandt managere"-tallet reelt afviger fra det kanoniske
                            placeringstal (dvs. AI-hold ligger foran). Undgår støj når
                            de to tal er ens. */}
                        {isMe && myManagerRank != null && myManagerRank !== s._rank && (
                          <p className="text-cz-3 text-3xs tabular-nums">
                            {t("dashboard:cards.standings.managerRank", { rank: myManagerRank })}
                          </p>
                        )}
                      </div>
                      <div className="flex-1 flex items-center gap-2">
                        <ProgressMeter
                          value={s.total_points || 0}
                          max={maxPts}
                          tone="accent"
                          className="flex-1"
                          trackClassName="h-1.5"
                          ariaLabel={t("dashboard:cards.standings.title", { division: team?.division })}
                        />
                        <span className="font-data text-xs text-cz-2 w-8 text-right tabular-nums">{s.total_points || 0}</span>
                        {/* vk-movement-signals — holdpoint siden sidste løbsdag ("+86"), KUN på egen
                            række. 0 point den dag = ingen badge (ingen "0"-støj). */}
                        {isMe && pointsDelta != null && pointsDelta !== 0 && (
                          <span
                            title={t("dashboard:cards.standings.pointsDeltaTitle")}
                            className={`font-mono text-3xs font-bold tabular-nums flex-shrink-0 ${pointsDelta > 0 ? "text-cz-success" : "text-cz-danger"}`}
                          >
                            {formatNumber(pointsDelta, { signDisplay: "exceptZero" })}
                          </span>
                        )}
                      </div>
                    </Link>
                  </Fragment>
                );
              })}
            </div>
          )}
        </Section>
        )}

        {/* Slice 07g · Finance forecast widget — parret med "Stilling/pulje"
            (docs/DASHBOARD_RULES.md §4), synlig altid (også grøn), så manageren
            får et stabilt blik på kommende sæsons cashflow inden FinancePage.
            Valgfri via customize (#1536). */}
        {isVisible("forecast") && forecast && (
          <div className="flex flex-col justify-center">
            {/* #4231: `backendMessages` er flyttet ud af den inlinede language-chunk
                og hentes nu via HttpBackend. Badget er den ENESTE forbruger paa
                dashboardet, saa det gates paa kort-niveau i stedet for hele siden
                (samme moenster som `board` i #3697). fallback=null frem for en
                PageLoader: et badge der dukker op et oejeblik senere er bedre end
                en spinner midt i dashboardet. */}
            <I18nReadyGate ns="backendMessages" fallback={null}>
              <FinanceForecastBadge forecast={forecast} />
            </I18nReadyGate>
          </div>
        )}

        {/* Recent results (#1005) */}
        {isVisible("recentResults") && (
        <Section>
          <SectionHeader
            title={t("dashboard:cards.recentResults.title")}
            action={<SectionAction as={Link} to="/resultater">{t("dashboard:cards.recentResults.linkAll")}</SectionAction>}
          />
          {recentResults === null ? (
            // #3510 — post-first-paint fetch endnu ikke landet: skeleton, ikke
            // et falsk "ingen resultater"-empty-state (false-empty flash).
            <SkeletonLines lines={3} />
          ) : recentResults.length === 0 ? (
            <EmptyState
              title={t("dashboard:cards.recentResults.empty")}
              action={
                <Link to="/planning" className={buttonClass({ variant: "secondary", size: "sm" })}>
                  {t("dashboard:cards.recentResults.emptyCta")}
                </Link>
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {recentResults.map(race => (
                <div key={race.race_id} className="flex items-center justify-between py-2 border-b border-cz-border last:border-0 gap-3">
                  {/* #3373 (spillerrapport, Discord 4/8: "Løbene under seneste
                      resultater under dashboard linker ikke"): løbsnavnet var ren
                      tekst i en ikke-interaktiv <div>, mens vinderen ved siden af
                      var et link — modulet var altså det ENESTE sted i appen hvor
                      et løb ikke var klikbart. Hele venstre celle (navn OG
                      vinder-linjen) er nu ét hit-target via RaceLink, samme greb
                      som løbskortenes header (#3187) — ægte <a>, så tastatur-fokus
                      + Enter virker. Vinderen forbliver sit eget RiderLink: et
                      link i et link er ikke tilgængeligt (samme grænse som
                      RaceResultCard på Resultat-hubben). */}
                  <RaceLink
                    id={race.race_id}
                    stage={recentResultStage(race)}
                    state={{ from: "dashboard" }}
                    data-testid="recent-result-open"
                    className="group block flex-1 min-w-0"
                  >
                    <p className="text-cz-1 text-sm truncate transition-colors group-hover:text-cz-accent-t">{race.name}</p>
                    <p className="text-cz-3 text-xs mt-0.5">
                      {race.winner?.result_type === "gc"
                        // Endagsløb gemmer vinderen som gc-række men har intet
                        // samlet klassement — dér er han bare "Vinder" (#1188).
                        ? (race.race_type === "stage_race"
                            ? t("dashboard:cards.recentResults.gc")
                            : t("dashboard:cards.recentResults.winner"))
                        : t("dashboard:cards.recentResults.stage", { n: race.winner?.stage_number ?? 0 })}
                    </p>
                  </RaceLink>
                  {race.winner && (
                    <div className="text-right min-w-0">
                      <RiderLink id={race.winner.rider_id} className="text-cz-1 text-sm hover:underline inline-flex items-center justify-end gap-1 max-w-full">
                        {race.winner.nationality_code && <Flag code={race.winner.nationality_code} />}
                        <span className="truncate">{race.winner.firstname} {race.winner.lastname}</span>
                      </RiderLink>
                      <p className="text-cz-3 text-xs truncate">{race.winner.is_ai ? t("dashboard:cards.recentResults.aiBadge") : (race.winner.team_name || "")}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
        )}

        {/* Rider ranking (#1005). #3507: modulet er division-scopet (bevidst,
            #2182/#3262 — "dit eget univers som default"); "Din division"-
            mærket + linket der bærer scopet med gør det tydeligt at listen
            IKKE er sæson-global, og at "Fuld rangliste →" lander på præcis
            den samme liste (prod-bug var nul overlap mellem de to). */}
        {isVisible("riderRanking") && (
        <Section>
          <SectionHeader
            title={
              <>
                {t("dashboard:cards.riderRanking.title")}
                <span className="ms-2 font-data text-2xs uppercase tracking-[.08em] text-cz-3 align-middle">
                  {t("dashboard:cards.riderRanking.scopeLabel")}
                </span>
              </>
            }
            action={
              <SectionAction as={Link} to={buildRiderRankingLink({ division: team?.division, poolId: team?.league_division_id })}>
                {t("dashboard:cards.riderRanking.linkAll")}
              </SectionAction>
            }
          />
          {riderRanking === null ? (
            <SkeletonLines lines={3} />
          ) : riderRanking.length === 0 ? (
            <EmptyState
              title={t("dashboard:cards.riderRanking.empty")}
              action={
                <Link to="/planning" className={buttonClass({ variant: "secondary", size: "sm" })}>
                  {t("dashboard:cards.riderRanking.emptyCta")}
                </Link>
              }
            />
          ) : (
            <div className="flex flex-col gap-1">
              {riderRanking.map((r, i) => (
                <RiderLink key={r.rider_id} id={r.rider_id}
                  className="flex items-center gap-3 py-1.5 hover:bg-cz-subtle rounded-lg -mx-2 px-2 transition-colors">
                  <span className={`font-mono text-xs w-4 text-right flex-shrink-0 ${i === 0 ? "text-cz-accent-t" : "text-cz-3"}`}>#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-cz-1 text-sm truncate">
                      {r.nationality_code && <Flag code={r.nationality_code} className="me-1" />}
                      {r.firstname} {r.lastname}
                    </p>
                    <p className="text-cz-3 text-xs truncate">
                      {r.is_ai ? t("dashboard:cards.riderRanking.aiBadge") : (r.team_name || "")}
                      {r.stage_wins > 0 && ` · ${t("dashboard:cards.riderRanking.stageWins", { count: r.stage_wins })}`}
                      {r.gc_wins > 0 && ` · ${t("dashboard:cards.riderRanking.gcWins", { count: r.gc_wins })}`}
                      {r.classic_wins > 0 && ` · ${t("dashboard:cards.riderRanking.classicWins", { count: r.classic_wins })}`}
                    </p>
                  </div>
                  <span className="font-mono font-bold text-cz-accent-t text-sm flex-shrink-0">{t("dashboard:cards.riderRanking.points", { points: formatNumber(r.points || 0) })}</span>
                </RiderLink>
              ))}
            </div>
          )}
        </Section>
        )}

        {/* Board status — skjul kortet helt indtil bestyrelsen er etableret (#1488).
            board er kun non-null naar en 1yr/3yr/5yr-plan findes; under saeson-1
            baseline-fasen er alle plans=null, saa kortet skal ikke vises endnu.
            #dashboard-layout-25/8: mistede sin lg:col-span-2 og flyttede til
            gridets sidste plads, parret med Global Rank-widget'en (docs/
            DASHBOARD_RULES.md §4 — /board har 959 sessions mod Mit Holds 5.955,
            så den fyldte mest og blev brugt mindst). */}
        {isVisible("board") && board && (
        <Section>
          <SectionHeader
            title={t("dashboard:cards.board.title")}
            action={<SectionAction as={Link} to="/board">{t("dashboard:cards.board.linkAll")}</SectionAction>}
          />
          <div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <p className="font-data text-2xs uppercase tracking-[.08em] text-cz-3 mb-2">{t("dashboard:cards.board.satisfaction")}</p>
                  <div className="flex items-center gap-3">
                    <ProgressMeter
                      value={displaySatisfaction}
                      max={100}
                      tone={displaySatisfaction >= 70 ? "success" : displaySatisfaction >= 40 ? "accent" : "danger"}
                      className="flex-1"
                      ariaLabel={t("dashboard:cards.board.satisfaction")}
                    />
                    <span className={`font-mono font-bold text-sm ${satisfactionColor}`}>{displaySatisfaction}%</span>
                  </div>
                </div>
                <div>
                  <p className="font-data text-2xs uppercase tracking-[.08em] text-cz-3 mb-2">{t("dashboard:cards.board.focus")}</p>
                  <p className="text-cz-1 text-sm">{board.focus ? t(`dashboard:board.focus.${board.focus}`, { defaultValue: board.focus }) : "—"}</p>
                </div>
                <div>
                  <p className="font-data text-2xs uppercase tracking-[.08em] text-cz-3 mb-2">{t("dashboard:cards.board.budgetMultiplier")}</p>
                  <p className={`font-mono font-bold text-sm ${board.budget_modifier >= 1 ? "text-cz-success" : "text-cz-danger"}`}>
                    ×{board.budget_modifier?.toFixed(2) || "1.00"}
                  </p>
                </div>
              </div>
              {boardOutlook?.feedback && boardCopyReady && (
                <div className="mt-4 pt-4 border-t border-cz-border">
                  <p className="text-cz-1 text-sm font-medium">{resolveBoardFeedbackHeadline(t, boardOutlook.feedback)}</p>
                  <p className="text-cz-2 text-xs mt-1">{resolveBoardFeedbackSummary(t, boardOutlook.feedback)}</p>
                  <div className="grid sm:grid-cols-4 gap-3 mt-3">
                    {Object.values(boardOutlook.score_breakdown?.categories || {}).map((category) => (
                      <div key={category.key} className="bg-cz-subtle rounded-cz p-3 border border-cz-border">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <p className="font-data text-2xs uppercase tracking-[.08em] text-cz-3 truncate">{resolveCategoryLabel(t, category)}</p>
                          <span className="flex items-center gap-1 flex-shrink-0">
                            {category.score_pct > 100 && (
                              <span
                                className="inline-flex items-center gap-0.5 text-3xs font-medium text-cz-success bg-cz-success-bg/60 rounded px-1 leading-tight"
                                title={t("dashboard:cards.board.exceedsTitle")}
                              >
                                <CheckIcon size={10} aria-hidden="true" /> {t("dashboard:cards.board.exceeds")}
                              </span>
                            )}
                            <span className="text-cz-2 text-3xs font-mono">{Math.min(100, category.score_pct)}%</span>
                          </span>
                        </div>
                        <ProgressMeter
                          value={Math.min(100, category.score_pct)}
                          max={100}
                          tone={category.score_pct >= 75 ? "success" : category.score_pct >= 55 ? "accent" : "danger"}
                          trackClassName="h-1.5"
                          ariaLabel={resolveCategoryLabel(t, category)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
        </Section>
        )}

        {/* Global Rank widget (#2453) — "#N ▲x · point", linker til /global-rank.
            Parret med Bestyrelse (docs/DASHBOARD_RULES.md §4). */}
        {isVisible("globalRank") && <GlobalRankWidget />}

      </div>
    </div>
  );
}
