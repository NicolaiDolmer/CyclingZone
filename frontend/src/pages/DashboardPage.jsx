import { Skeleton } from "../components/ui/index.js";
import { useState, useEffect, Fragment } from "react";
import { useDashboardData } from "../data/dashboardData.ts"; // #6494
import { useTodayStagesData } from "../data/todayStagesData.ts"; // #6494
import { useFirstRaceCardData, useSurveyInviteData } from "../data/dashboardCards.ts"; // #1140/#6494
import { useTranslation } from "react-i18next";
import ReservedBody from "../components/ui/ReservedBody.tsx";
import AuthLoading from "../components/ui/AuthLoading.tsx";
import { isNetworkError } from "../lib/networkErrorGuards.ts"; // #5312/#5322
import { Link, useNavigate } from "react-router";
import OnboardingProgressCard from "../components/OnboardingProgressCard";
import OnboardingCompletionCard from "../components/OnboardingCompletionCard";
import SurveyInviteCard from "../components/SurveyInviteCard"; // #4943
import { FinanceForecastBadge } from "../components/FinanceForecastCard";
import I18nReadyGate from "../components/I18nReadyGate.jsx"; // #4231
import { computeDashboardSquadStats } from "../lib/dashboardSquadStats";
import { computeSeniorStartWarning } from "../lib/seniorStartWarning.ts";
// #2182 — rangliste-modulet skal defaulte til spillerens egen division+pulje,
// ikke hele tieren. Genbruger StandingsPage's rene merge/pulje-match-helpers i
// stedet for en parallel implementering (samme princip som #3197: "default-
// konteksten er spillerens egen verden").
import { computeMyDivisionStandings } from "../lib/dashboardDivStandings.js";
// #5315 — "Full standings"-linket skal lande på managerens EGEN pulje/gruppe,
// ikke hele divisionen. Ren helper (unit-testet), genbruger hasPoolSubtabs/
// ownPoolRow fra computeMyDivisionStandings nedenfor.
import { buildStandingsLink } from "../lib/standingsLink.ts";
import { formatNumber } from "../lib/intl";
import { LockedSalesLine } from "../components/finance/LockedSaleEscrows.tsx"; // #6181
import { getEffectiveOfferAmount } from "../lib/offerAmount.js";
import { deriveRaceStatus } from "../lib/raceHubLogic.js";
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
import FirstRaceCard from "../components/FirstRaceCard"; // #1140
import { buildFirstRaceCardModel } from "../lib/firstRaceCardModel.js"; // #1140
import RacePausedBanner from "../components/race/RacePausedBanner.tsx"; // #6970
import useRacePause from "../hooks/useRacePause.ts"; // #6970
import { withoutPausedUpcoming } from "../lib/racePause.ts"; // #6970
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
import { pickUpcomingRaces, filterTeamUpcomingRaces } from "../lib/upcomingRaces.ts";
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
import AnnualMeetingNudgeCard from "../components/AnnualMeetingNudgeCard"; // #4557 S-M2d
import { daysUntil } from "./annualMeeting/meetingFormat";
import GlobalRankWidget from "../components/GlobalRankWidget";
import SeasonStartGuideCard from "../components/SeasonStartGuideCard";
import {
  isSeasonStartWindow, buildSeasonStartItems,
  readSeasonStartDismissed, writeSeasonStartDismissed,
} from "../lib/seasonStartGuide";
import SeasonWrapNudgeCard from "../components/SeasonWrapNudgeCard";
import { readSeasonWrapDismissed, writeSeasonWrapDismissed } from "../lib/seasonWrapNudge";
import {
  readContractExpiryDismissed, writeContractExpiryDismissed, shouldShowContractExpiryNotice,
} from "../lib/contractExpiryNotice";
import SeasonSignupCard from "../components/SeasonSignupCard"; // [epic #4592 del 3] #452
import { computeDashboardGoldCta } from "../lib/dashboardGoldCta.js";
import { computeAvailableBalance } from "../lib/availableBalance.js";
import { readCachedAcademyNav } from "../lib/academyNavVisibility";
import { buildRiderRankingLink } from "../lib/riderRankingDivisionLink";
import {
  Card, AlertTriangleIcon, XIcon, ArrowDownIcon, ChevronRightIcon, DiscordIcon,
  PageHeader, Section, SectionHeader, SectionAction, Button, ErrorState,
  EmptyState, ProgressMeter, StatusBadge,
} from "../components/ui";
import { buttonClass } from "../components/ui/buttonStyles.js";
import { flushPendingSignup, logFirstEvent, logTeamCreated, logTeamDrafted } from "../lib/logEvent";
// #4997 — NPS-prompten var kun monteret på Resultater-fanen på egen holdside;
// se komponent-monteringen nederst i filen.
import NpsPrompt from "../components/NpsPrompt.jsx";
import { useNpsPrompt } from "../hooks/useNpsPrompt.js";

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

// #6494: the stable empty list for core-derived values before the first read.
const EMPTY_LIST = /** @type {any[]} */ ([]);

export default function DashboardPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["dashboard", "common"]);
  // #3697: board.json (55 KB rå pr. sprogpar) lazy-loades via HttpBackend i
  // stedet for at ligge inline i language-chunken. Dashboardets bestyrelseskort
  // er den ENESTE forbruger uden for BoardPage, og feedback-blokken er den
  // eneste del der resolver board:-nøgler (resolveBoardFeedback*/resolveCategoryLabel),
  // så den vises først når namespacet er hentet — ellers rå nøgler (useSuspense: false).
  const { ready: boardCopyReady } = useTranslation("board");
  // #6494: every server resource of the page comes from the shared data layer
  // (data/dashboardData.ts, keyed per viewer/team). Only UI state lives here.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [discordNudgeDismissed, setDiscordNudgeDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("cz-dashboard-discord-nudge-dismissed") === "1"
  );
  // #2439: dismiss er SERVER-persisteret (teams.onboarding_progress_dismissed_at);
  // sessionStorage er kun den optimistiske UI-state foer server-svaret er hentet.
  const [onboardingDismissedLocal, setOnboardingDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem("cz-dashboard-onboarding-dismissed") === "1"
  );
  const [completionDismissed, setCompletionDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("cz-dashboard-onboarding-completion-dismissed") === "1"
  );
  // #2444/#8022: one mount budget includes core and secondary requests.
  // Ready data latches this same release state early; refresh never re-gates.
  const [initialWaitExpired, setInitialWaitExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setInitialWaitExpired(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Dashboard-customize (#1005): vis/skjul moduler, persisteret i localStorage.
  const { isVisible, toggleModule, resetToDefault } = useDashboardLayout();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const recentResultsVisible = isVisible("recentResults");
  const riderRankingVisible = isVisible("riderRanking");
  const myLatestResultVisible = isVisible("myLatestResult");
  const heroAgonyVisible = isVisible("heroAgony"); // #3397
  const racePause = useRacePause(); // #6970: pauset = ingen gamle starttider nedenfor

  // #2925/#2752/#4387: dismissals huskes lokalt pr. saeson/hold (laeses i effekter, ikke i render).
  const [seasonStartDismissed, setSeasonStartDismissed] = useState(false);
  const [academyEnabled, setAcademyEnabled] = useState(false);
  const [seasonWrapDismissed, setSeasonWrapDismissed] = useState(false);
  const [contractExpiryDismissedIds, setContractExpiryDismissedIds] = useState(null);
  // [epic #4592 del 3] #452: ingen optimistisk tilmelding, knappen viser sin egen loading.
  const [seasonSignupSubmitting, setSeasonSignupSubmitting] = useState(false);

  // The page stays untyped JS: the typed data layer is cast once at this boundary.
  const dashboard = /** @type {any} */ (useDashboardData({
    discordNudgeDismissed,
    onboardingNeeded: !(onboardingDismissedLocal && completionDismissed),
    recentResultsVisible,
    riderRankingVisible,
    myLatestResultVisible,
    racePause: Boolean(racePause),
    nowMs,
    // #2925: saesonstart-vinduet er afledt af den aktive saesons start_date; nowMs tikker hvert minut.
    seasonStartWindowOpen: (season) => isSeasonStartWindow(season, new Date(nowMs)),
    academyEnabled,
  }));
  const {
    team, loading, error, allAuctions, activeOffers, cardReady, teamRaceIds, teamRaceIdsLoaded,
    forecast, onboardingProgress, seasonSignupStatus, optionalModulesSettled, annualMeeting,
    nextStageByRace, squadSelectionMissingRace, selectionReady, notTrainedToday,
    seasonStartCounts, completedSeasonRecap, recentResults, riderRanking, myLatestResult,
  } = dashboard;
  const seasonInfo = dashboard.season;
  const core = dashboard.core;
  const riders = core?.riders ?? EMPTY_LIST;
  const seniorRosterReady = core?.seniorRosterReady ?? false;
  const pendingIncomingCount = core?.pendingIncomingCount ?? 0;
  const reservedBalance = core?.reservedBalance ?? 0;
  const nextRaces = core?.nextRaces ?? EMPTY_LIST;
  const standings = core?.standings ?? EMPTY_LIST;
  const pools = core?.pools ?? EMPTY_LIST;
  const poolStages = core?.poolStages ?? null;
  const board = dashboard.boardStatus?.board ?? null;
  const boardSatisfaction = dashboard.boardStatus?.boardSatisfaction ?? null;
  const boardOutlook = dashboard.boardStatus?.boardOutlook ?? null;
  const boardPlanMissing = dashboard.boardStatus?.boardPlanMissing ?? false;
  const boardStatusLoaded = dashboard.boardStatus?.boardStatusLoaded ?? false;
  const showDiscordNudge = Boolean(dashboard.discordStatus && !dashboard.discordStatus.discord_id) && !discordNudgeDismissed;
  // #2439: server er sandheden: et tidligere dismiss eller et "etableret hold" skjuler kortet.
  const onboardingDismissed = onboardingDismissedLocal || Boolean(onboardingProgress?.dismissed || onboardingProgress?.established);
  const myLatestResultSettled = myLatestResult !== undefined;
  const seasonStartWindowOpen = isSeasonStartWindow(seasonInfo, new Date(nowMs));

  // Kanonisk "kræver handling"-summary til "Næste træk"-sektionen (#271 Slice B).
  const { pending: actionSummary, loading: actionLoading } = useActionSummary();
  // #1140: server-afgjort "Your first race"-kort (flag first_race_card, preview). null = intet kort.
  const firstRaceCard = /** @type {any} */ (useFirstRaceCardData());

  // #4997: In-app NPS. Hook'en gater selv og renderer intet før beslutningen er truffet.
  const nps = useNpsPrompt({ teamId: team?.id, surface: "dashboard" });

  // #783/#3035: saeson-fremskridt og loebsfinalisering opdaterer uden hard reload. Kun de
  // ressourcer den gamle loadAll laeste genhentes; resten har egen friskhed.
  useRealtimeRefetch("dashboard-live", REALTIME_TABLES, dashboard.refreshLive);
  // #6569: paa topniveau (foer early-return) saa stribens fetch starter naar team er kendt.
  const todayStages = withoutPausedUpcoming(useTodayStagesData(), Boolean(racePause)); // #6970
  const surveyInvite = useSurveyInviteData();
  const initialDataReady = !loading && optionalModulesSettled && surveyInvite.settled && (!team || (!todayStages.loading && selectionReady && (!myLatestResultVisible || myLatestResultSettled)));
  useEffect(() => {
    if (initialDataReady) setInitialWaitExpired(true);
  }, [initialDataReady]);

  // Et minut-tick rækker til en kalender-countdown (vi viser ikke sekunder).
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setSeasonStartDismissed(readSeasonStartDismissed(seasonInfo?.id));
  }, [seasonInfo?.id]);

  // Akademiet er feature-gated. Layout.jsx har allerede afgjort synligheden og
  // cachet den; vi genbruger cachen frem for at betale et ekstra /api/academy/me.
  useEffect(() => {
    setAcademyEnabled(readCachedAcademyNav());
  }, [team?.id]);

  useEffect(() => {
    setSeasonWrapDismissed(readSeasonWrapDismissed(completedSeasonRecap?.seasonId));
  }, [completedSeasonRecap?.seasonId]);

  useEffect(() => {
    setContractExpiryDismissedIds(readContractExpiryDismissed(team?.id, seasonInfo?.number));
  }, [team?.id, seasonInfo?.number]);

  // #1583: flush en ventende signup når brugeren er authenticated på dashboardet.
  useEffect(() => {
    if (team?.id) flushPendingSignup();
    // #4321: kerne-rejsens "hold oprettet" (kun nye hold, se logTeamCreated).
    if (team?.id) logTeamCreated(team.created_at);
  }, [team?.id, team?.created_at]);

  // #1583: onboarding_completed-funnel-event når alle steps er nået (4/4).
  useEffect(() => {
    if (!onboardingProgress) return;
    const { completed_count, total_count } = onboardingProgress;
    if (total_count > 0 && completed_count === total_count) {
      logFirstEvent("onboarding_completed", { completed_count, total_count });
    }
  }, [onboardingProgress]);

  // #940: team_drafted-funnel-event — fyrer FØRSTE gang manageren har en løbsklar trup.
  useEffect(() => {
    if (team?.id) logTeamDrafted(riders.length);
  }, [team?.id, riders.length]);

  function dismissDiscordNudge() {
    localStorage.setItem("cz-dashboard-discord-nudge-dismissed", "1");
    setDiscordNudgeDismissed(true);
  }

  function dismissOnboarding() {
    // Optimistisk lokal UI-state med det samme (undgår flash mens API-kaldet er i flugt).
    sessionStorage.setItem("cz-dashboard-onboarding-dismissed", "1");
    setOnboardingDismissed(true);
    // #2439: persistér SERVER-SIDE (teams.onboarding_progress_dismissed_at) så
    // dismisset holder på tværs af enheder/sessions.
    void dashboard.dismissOnboardingOnServer();
  }

  function dismissSeasonStart() {
    writeSeasonStartDismissed(seasonInfo?.id);
    setSeasonStartDismissed(true);
  }

  function dismissSeasonWrap() {
    writeSeasonWrapDismissed(completedSeasonRecap?.seasonId);
    setSeasonWrapDismissed(true);
  }

  // #4387 — X-knappen og "Forstået, lad den udløbe"-knappen har begge samme
  // effekt: gem det NUVÆRENDE sæt af udløbende rytter-id'er som lukket for
  // resten af sæsonen.
  function dismissContractExpiryNotice() {
    const ids = expiringRiders.map((r) => r.id);
    writeContractExpiryDismissed(team?.id, seasonInfo?.number, ids);
    setContractExpiryDismissedIds(ids);
  }

  // [epic #4592 del 3] "Tilmeld dig næste sæson" (#452). Ingen optimistisk
  // lokal state FØR svaret (til forskel fra dismissOnboarding ovenfor) — en
  // fejlet POST skal IKKE vise en falsk bekræftelse for noget så vigtigt som
  // "beholder jeg min plads". Knappen viser sin egen loading-tilstand
  // (Button `loading`-prop) mens kaldet er i flugt.
  async function handleSeasonSignup() {
    setSeasonSignupSubmitting(true);
    try {
      await dashboard.submitSeasonSignup();
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

  // #2230: resolve conditional top-strip presence before placing the dashboard.
  // Once revealed, background refresh never replaces it with a page loader.
  if (!initialWaitExpired && !initialDataReady && !error) return <AuthLoading />;

  // #3510 — kanonisk ErrorState (docs/design/PAGE_TEMPLATES.md) i stedet for at
  // falde igennem til et fuldt tomt dashboard. Retry gen-kalder loadAll direkte
  // (samme mønster som StandingsPage/#2175); setLoading(true) genviser
  // PageLoader mens den nye forespørgsel er i flugt.
  // #5312: skeln "naaede aldrig serveren" fra "serveren svarede en fejl".
  // En spiller hvis netvaerk ikke kan naa backenden fik foer "Kunne ikke
  // indlaese dashboardet" — en besked der peger paa spillet og ikke giver
  // ham noget at handle paa. `error` er selve fejl-objektet fra loadAll's
  // catch, saa klassifikationen kan ske her uden ekstra plumbing.
  // #5322: `error` kan nu OGSAA vaere apiFetch's resultat (som ikke laengere
  // kaster ved en transportfejl) — isNetworkError daekker begge former.
  if (error) return (
    <div translate="no" className="max-w-5xl mx-auto">
      <ErrorState
        title={isNetworkError(error) ? t("dashboard:offlineError") : t("dashboard:loadError")}
        action={<Button size="sm" variant="secondary" onClick={() => { void dashboard.retry(); }}>{t("dashboard:retry")}</Button>}
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
  const seniorStartWarning = seniorRosterReady ? computeSeniorStartWarning({ team, riders }) : null;

  // #1150 · kontraktudløb-varsel: ryttere hvis kontrakt udløber ved NÆSTE
  // sæsonskifte (contract_end_season <= den AKTIVE sæsons nummer) — samme rene
  // klassifikation som squad-tabellens contractExpiring-badge (#3097,
  // TeamPage.jsx). Ejer-design 3/8 (#1150): "genforhandling MED frigivelse" —
  // ikke-handling frigiver rytteren ved skiftet, så dette skal være svært at
  // overse i modsætning til den passive badge alene (170 af 180 menneskehold
  // ramt ved S2→S3, dry-run 5/8, se scripts/dryRunContractExpirySeasonEnd.js).
  const expiringRiders = riders.filter(
    (r) => isContractExpiringAtTransition(r.contract_end_season, seasonInfo?.number)
  );
  const expiringContractCount = expiringRiders.length;
  // #4387 — beskeden er lukket for resten af sæsonen MEDMINDRE mindst én af de
  // nuværende udløbende ryttere ikke var med i sættet fra sidste lukning (ny
  // rytter i vinduet siden da, se lib/contractExpiryNotice.js).
  const showContractExpiryNotice = shouldShowContractExpiryNotice(
    expiringRiders.map((r) => r.id),
    contractExpiryDismissedIds
  );

  // #2328 — "Kommende løb"-kortet: de 3 faktisk kommende løb efter ægte
  // race_stage_schedule-tid (nextStageByRace), ikke den statiske PCM-dato som
  // det tidligere top-3-udvalg blev sorteret på FØR den ægte tid var kendt.
  // #3751 — filtreret til holdets EGNE løb først: et hold der tilmelder sig
  // midt i et etapeløb er ikke med i det løb (trup låst), og skal ikke se en
  // nedtælling til det. No-op for etablerede hold (de ER tilmeldt).
  const displayedRaces = /** @type {any[]} */ (pickUpcomingRaces(
    filterTeamUpcomingRaces(nextRaces, teamRaceIds), // #7539: + ikke-startede løb
    nextStageByRace,
    3
  ));

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
  const { hasPoolSubtabs, ownPoolRow, divStandingsTop, divStandings, myManagerRank } =
    computeMyDivisionStandings(standings, team, pools);
  // #5315 — "Full standings" skal lande på managerens egen pulje/gruppe (samme
  // kilde som modulet selv viser), ikke hele divisionen. Fallder tilbage til
  // almindeligt /standings (dagens adfærd) når puljen endnu er ukendt.
  const standingsLink = buildStandingsLink(hasPoolSubtabs, ownPoolRow);

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
  // #1140: paret styres af myLatestResultPaired nedenfor, efter firstRaceCardModel.
  const nextActionsVisible = isVisible("nextActions");
  // TeamSelectionCtaCard afgør selv om den renderer (kræver nextRace) — vi
  // spejler samme betingelse her for at vide hvornår kollaps-col-span skal på.
  // #1140: "Your first race"-kortet ejer toppen for et nyt hold uden resultat.
  // Resultat-gaten er den SAMME kilde som MyLatestResultCard (race: null); serveren
  // har allerede afgjort flag/preview/resultat, saa klienten kun sikrer at kortet
  // aldrig staar ved siden af first-race-momentet (#3310).
  const firstRaceCardGateOpen = Boolean(firstRaceCard) && !firstRaceMomentActive
    && (firstRaceCard.preview || !myLatestResultVisible || myLatestResult?.race === null);
  const firstRaceCardModel = firstRaceCardGateOpen
    ? buildFirstRaceCardModel({
      nextRaces, nextStageByRace, squadSelectionMissingRace, enteredRaceIds: teamRaceIdsLoaded ? teamRaceIds : null,
      card: firstRaceCard, nowMs, locale: i18n.language,
    })
    : null;
  // #7507: backend saetter feedback.expired kun for en plan der har vaeret i kraft.
  const boardPlanExpired = /** @type {any} */ (boardOutlook)?.feedback?.headline_key === "feedback.expired.headline";
  // "Pick your race squad" skjules MENS kortet vises (ingen to guldknapper); "Next move" er uroert.
  const showTeamSelectionCta = Boolean(squadSelectionMissingRace) && !firstRaceCardModel;
  // #1140: det TOMME "How your team did" (race: null) skjules mens "Your first race" vises,
  // saa budskabet ikke staar to gange. Har holdet et resultat (preview), er kortet uaendret.
  const myLatestResultEmptyHidden = Boolean(firstRaceCardModel) && myLatestResult?.race === null;
  const myLatestResultPaired = !firstRaceMomentActive && myLatestResultVisible && !myLatestResultEmptyHidden;

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
    firstRaceMomentActive: firstRaceMomentActive || Boolean(firstRaceCardModel?.showCta), // #1140: kortets knap ejer guldet
    squadCtaEligible: showTeamSelectionCta,
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
        title={team?.name || (loading ? <Skeleton className="h-7 w-28 max-w-full" /> : t("common:nav.item.dashboard"))}
        subtitle={loading ? <Skeleton className="h-4 w-28 max-w-full" /> :
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
                  {loading ? <Skeleton className="h-7 w-28" /> : <>{formatNumber(computeAvailableBalance(team?.balance, reservedBalance))} CZ$</>}
                </p>
                <p className="text-cz-3 text-xs">{t("common:sidebar.balance")}</p>
                {!loading && <LockedSalesLine refreshKey={/** @type {any} */ (team)?.balance} className="text-cz-2 text-xs" />}
                {loading && <Skeleton className="h-4 w-28" />}
                {!loading && reservedBalance > 0 && (
                  <p className="text-cz-2 text-xs">
                    {t("dashboard:header.lockedInBids", { value: formatNumber(reservedBalance) })}
                  </p>
                )}
              </div>
              <ChevronRightIcon size={16} className="text-cz-3 group-hover:text-cz-accent-t transition-colors shrink-0" aria-hidden="true" />
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

      {/* #4943 (ejer-bestilling 8/9): flyttet til TOPPEN af dashboardet, som
          første element under sidehovedet — over squad-/kontrakt-advarslerne.
          Indgang til det aktive spoergeskema. Renderer intet
          naar der ikke er et aabent skema, spilleren har gennemfoert, eller
          kortet er lukket inden for 3 dage. Sekundaer CTA: dashboardets ene
          guld-primaere element ejes af computeDashboardGoldCta. */}
      <SurveyInviteCard survey={surveyInvite.survey} hide={surveyInvite.hide} />

      {/* Squad warning + kontrakt-fornyelses-advarsel — ALLERØVERST i
          indholdsflowet, over dagens etaper. #3915 satte oprindeligt dagens
          etaper allerøverst, men ejer besluttede 25/8 at KUN advarsler må stå
          over dem: en trup under minimum og udløbende kontrakter er de eneste
          ting på siden der koster point hvis de overses (Clarity: 94,65%
          scroll-dybde — synlighed er ikke problemet, punktér de dyre ting). */}
      {seniorStartWarning && (
        <div className="mb-4 px-4 py-3 rounded-cz text-sm border flex flex-wrap items-center gap-2 bg-cz-danger-bg text-cz-danger border-cz-danger/30">
          <AlertTriangleIcon size={16} className="shrink-0" />
          <span className="flex-1 min-w-[200px]">{t("dashboard:seniorStartWarning.message", seniorStartWarning)}</span>
          <Link to="/auctions" className="ms-auto inline-flex items-center gap-0.5 text-xs underline opacity-70 hover:opacity-100">
            {t("dashboard:seniorStartWarning.cta")}
            <ChevronRightIcon size={13} aria-hidden="true" />
          </Link>
        </div>
      )}
      {squadWarning && (
        <div className={`mb-4 px-4 py-3 rounded-cz text-sm border flex items-center gap-2
          ${squadWarning.color === "red"
            ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
            : "bg-cz-warning-bg text-cz-warning border-cz-warning/30"}`}>
          <AlertTriangleIcon size={16} className="shrink-0" />
          <span>{t(`dashboard:squadWarning.${squadWarning.type}`, {
            count: squadWarning.count,
            limit: squadWarning.limit,
            division: squadWarning.division,
          })}</span>
          <Link to="/team" className="ms-auto inline-flex items-center gap-0.5 text-xs underline opacity-70 hover:opacity-100">
            {t("dashboard:squadWarning.ctaMyTeam")}
            <ChevronRightIcon size={13} aria-hidden="true" />
          </Link>
        </div>
      )}

      {/* #1150 · Contract renewal warning — separat fra squad-cap-warningen
          ovenfor (anden årsag, samme visuelle sprog). Vises når der er
          udløbende kontrakter, uanset squad-cap-status — MEDMINDRE spilleren
          har lukket den for resten af sæsonen (#4387, ejer-go i Discord-tråden
          29/8) og ingen NY rytter er kommet ind i vinduet siden da. */}
      {expiringContractCount > 0 && showContractExpiryNotice && (
        <div className="mb-4 px-4 py-3 rounded-cz text-sm border flex flex-wrap items-center gap-2 bg-cz-warning-bg text-cz-warning border-cz-warning/30">
          <AlertTriangleIcon size={16} className="shrink-0" />
          <span className="flex-1 min-w-[200px]">{t("dashboard:contractWarning.message", { count: expiringContractCount })}</span>
          {/* #4387 — egen flex-gruppe (i stedet for løse ms-auto-børn på det
              yderste flex-wrap) så handlingerne wrapper som ÉN blok under
              beskeden på mobil, i stedet for at knække midt i teksten. */}
          <div className="flex items-center gap-2 shrink-0 ms-auto">
            <Link to="/team" className="inline-flex items-center gap-0.5 text-xs underline opacity-70 hover:opacity-100">
              {t("dashboard:contractWarning.cta")}
              <ChevronRightIcon size={13} aria-hidden="true" />
            </Link>
            {/* Sekundær handling: samme effekt som X-knappen (dismiss for resten
                af sæsonen), for spilleren der aktivt vælger at lade kontrakten
                udløbe fremfor blot at lukke en advarsel. */}
            <button
              type="button"
              onClick={dismissContractExpiryNotice}
              className="text-xs underline opacity-70 hover:opacity-100">
              {t("dashboard:contractWarning.letExpire")}
            </button>
            <button
              type="button"
              onClick={dismissContractExpiryNotice}
              className="text-cz-warning hover:opacity-100 opacity-70 leading-none px-1"
              aria-label={t("dashboard:contractWarning.dismissAria")}>
              <XIcon size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* [epic #4592 del 3] "Tilmeld dig næste sæson" (#452) — lige under
          trup-/kontrakt-advarslerne, over dagens etaper (ejer-go 23/9: kortet
          lå nederst på første skærm på desktop og under folden på telefonen).
          Samme klasse som de to advarsler ovenfor (docs/DASHBOARD_RULES.md
          §2): en manager der er ved at miste sin plads skal se det først, og
          kortet har heller ingen dismiss. Stadig et Card, ikke et banner (§3),
          og guld-knappen følger uændret computeDashboardGoldCta — står
          holdudtagelsen eller første-løbs-øjeblikket med guld længere nede,
          er knappen her sekundær (én guld pr. view). */}
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

      {/* #3915 — dagens etaper/løb for holdet, herefter i indholdsflowet (under
          page-header + advarsler ovenfor). #3915 satte den oprindeligt
          allerøverst; ejer besluttede 25/8 at KUN advarsler (trup + kontrakt-
          fornyelse, se blokken ovenfor — og fra 23/9 tilmeldingskortet, #452)
          må stå over dagens etaper — se docs/
          DASHBOARD_RULES.md §2. Skjuler sig selv når holdet ingen løb har i
          dag (mindst-støj-valg, ejer 18/8). */}
      <RacePausedBanner pause={racePause} />
      {(loading || team) && <TodayStagesStrip stages={todayStages} />}

      {/* #1140: "Your first race" (flag first_race_card), samme plads som #3310-kortet
          nedenfor; de to optræder aldrig sammen (se firstRaceCardGateOpen). */}
      {firstRaceCardModel && (
        <div className="mb-4">
          <FirstRaceCard model={firstRaceCardModel} nowMs={nowMs} division={team?.division} />
        </div>
      )}

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
                loading={actionLoading || !cardReady.auctions || !selectionReady}
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
                    <span className="inline-flex items-center gap-0.5 text-xs text-cz-accent-t group-hover:underline whitespace-nowrap">
                      {t("dashboard:seasonBanner.viewCalendar")}
                      <ChevronRightIcon size={13} aria-hidden="true" />
                    </span>
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
        <div className={firstRaceMomentActive || firstRaceCardModel ? "opacity-75" : undefined}>
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
          seasonId={completedSeasonRecap.seasonId}
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
          <div className="w-8 h-8 rounded-cz bg-cz-discord/20 flex items-center justify-center shrink-0">
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
            to="/profile?tab=notifications#discord"
            className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-cz border border-transparent text-xs font-semibold bg-cz-discord text-white transition-colors duration-150 ease-out hover:bg-cz-discord-hover shrink-0">
            {t("dashboard:discordNudge.cta")}
          </Link>
          <button
            onClick={dismissDiscordNudge}
            className="text-cz-3 hover:text-cz-1 leading-none px-1 shrink-0"
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

      {/* #4557 (S-M2d): dashboard-genvej til aarsmoedet — fuld bredde,
          UDENFOR to-kolonne-gridet, i den oevre stak af betingede engangs-
          kort (docs/DASHBOARD_RULES.md §4 "oevre del": Udviklings-overgang,
          Onboarding-progress, Season Wrap/Start Guide er ALLE fuld bredde i
          samme stak, ingen af dem er parret i gridet). §0 regel 1 er
          opfyldt af den samme begrundelse som de kort: et betinget,
          engangs-nudge-kort med titel+meta+subtitle+CTA hoerer ikke i
          gridets faste parringer (som binder to LOEBENDE datamoduler
          sammen), og en paring ville efterlade en forreldreloes halv-celle
          naar kortet er skjult (§3 "betingede moduler maa ikke efterlade
          tomme grid-celler") — ret-runde #4732 fund 3. Placeret EFTER
          Maiden Win/Hero & Agony (samme oevre stak), lige foer hovedgridet,
          saa den ikke forskyder Board/Global-Rank-parringen nedenfor. Vises
          udelukkende naar GET /board/meeting svarer available:true —
          automatisk skjult for alle uden for beta. */}
      {annualMeeting?.mandate && (
        <div className="mb-4">
          <AnnualMeetingNudgeCard daysLeft={daysUntil(annualMeeting.mandate.deadlineAt)} />
        </div>
      )}

      {/* Main grid — #2849 bølge 1: sibling-gap 14px (spec) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[14px]">

        {/* My auctions + winning */}
        {isVisible("auctions") && (
        <Section>
          <SectionHeader
            title={t("dashboard:cards.auctions.title")}
            action={<SectionAction as={Link} to="/auctions">{t("dashboard:cards.auctions.linkAll")}</SectionAction>}
          />
          <ReservedBody name="auctions" loading={!cardReady.auctions} rows={5} rowHeight={60}>
          {myActiveAuctions.length === 0 ? (
            <EmptyState
              title={t("dashboard:cards.auctions.empty")}
              description={t("dashboard:cards.auctions.emptyHint")}
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
                  </ReservedBody>
        </Section>
        )}

        {/* Pending transfers + offers */}
        {isVisible("transfers") && (
        <Section>
          <SectionHeader
            title={t("dashboard:cards.transfers.title")}
            action={<SectionAction as={Link} to="/transfers">{t("dashboard:cards.transfers.linkAll")}</SectionAction>}
          />
          <ReservedBody name="transfers" loading={!cardReady.transfers} rows={5} rowHeight={56}>
          {activeMarketOffers.length === 0 && pendingIncoming === 0 ? (
            <EmptyState
              title={t("dashboard:cards.transfers.empty")}
              description={t("dashboard:cards.transfers.emptyHint")}
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
                  <ArrowDownIcon aria-hidden="true" className="text-cz-success w-4 h-4 shrink-0" />
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
                  </ReservedBody>
        </Section>
        )}

        {/* Upcoming races */}
        {isVisible("races") && (
        <Section>
          <SectionHeader
            title={t("dashboard:cards.races.title")}
            action={<SectionAction as={Link} to="/planning">{t("dashboard:cards.races.linkAll")}</SectionAction>}
          />
          <ReservedBody name="races" loading={!teamRaceIdsLoaded} rows={3} rowHeight={64}>
          {displayedRaces.length === 0 ? (
            <EmptyState
              title={t("dashboard:cards.races.empty")}
              description={t("dashboard:cards.races.emptyHint")}
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
                        {/* #6717: spillets status-maerke (5 px radius, samme anatomi som
                            "Overgaaet" paa bestyrelseskortet), ikke en rund guld-pille. Rolig
                            info-tone (ejer 16/10): et loeb i gang er normal drift, ikke en fejl. */}
                        <StatusBadge state="info" emphasis>
                          {t("dashboard:cards.races.live")}
                          {race.race_type === "stage_race" && (
                            <span>{race.stages_completed}/{race.stages}</span>
                          )}
                        </StatusBadge>
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
                  </ReservedBody>
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
            action={<SectionAction as={Link} to={standingsLink}>{t("dashboard:cards.standings.linkAll")}</SectionAction>}
          />
          <ReservedBody name="standings" loading={loading} rows={5} rowHeight={44}>
          {divStandings.length === 0 ? (
            <EmptyState
              title={t("dashboard:cards.standings.empty")}
              description={t("dashboard:cards.standings.emptyHint")}
              action={
                <Link to={standingsLink} className={buttonClass({ variant: "secondary", size: "sm" })}>
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
                    <Link to={standingsLink}
                      className={`${isMe ? (isLeader ? "cz-me-block-bar " : "cz-me-block ") : ""}flex items-center gap-3 py-1.5 -mx-2 px-2 rounded-cz transition-colors ${isLeader ? "bg-cz-accent/8" : "hover:bg-cz-subtle"}`}>
                      <span className={`font-mono text-xs w-4 text-right shrink-0 ${isLeader ? "text-cz-accent-t" : "text-cz-3"}`}>#{s._rank}</span>
                      <div className="w-28 shrink-0 min-w-0">
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
                      </div>
                    </Link>
                  </Fragment>
                );
              })}
            </div>
          )}
          </ReservedBody>
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
          <ReservedBody name="recentResults" loading={recentResults === null} rows={5} rowHeight={64}>
          {!recentResults?.length ? (
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
                  </ReservedBody>
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
          <ReservedBody name="riderRanking" loading={riderRanking === null} rows={5} rowHeight={56}>
          {!riderRanking?.length ? (
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
                  className="flex items-center gap-3 py-1.5 hover:bg-cz-subtle rounded-cz -mx-2 px-2 transition-colors">
                  <span className={`font-mono text-xs w-4 text-right shrink-0 ${i === 0 ? "text-cz-accent-t" : "text-cz-3"}`}>#{i + 1}</span>
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
                  <span className="font-mono font-bold text-cz-accent-t text-sm shrink-0">{t("dashboard:cards.riderRanking.points", { points: formatNumber(r.points || 0) })}</span>
                </RiderLink>
              ))}
            </div>
          )}
                  </ReservedBody>
        </Section>
        )}

        {/* Board status — skjul kortet helt indtil bestyrelsen er etableret (#1488).
            board er kun non-null naar en 1yr/3yr/5yr-plan findes; under saeson-1
            baseline-fasen er alle plans=null, saa kortet skal ikke vises endnu.
            #dashboard-layout-25/8: mistede sin lg:col-span-2 og flyttede til
            gridets sidste plads, parret med Global Rank-widget'en (docs/
            DASHBOARD_RULES.md §4 — /board har 959 sessions mod Mit Holds 5.955,
            så den fyldte mest og blev brugt mindst). */}
        {isVisible("board") && (board || dashboard.boardPending) && (
        <Section>
          <SectionHeader
            title={t("dashboard:cards.board.title")}
            action={<SectionAction as={Link} to="/board">{t("dashboard:cards.board.linkAll")}</SectionAction>}
          />
          {board ? <div>
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
              {/* #7507: en plan der aldrig er underskrevet (nyt hold) har intet at evaluere — vis
                  "ingen plan endnu". En UDLOEBET plan (backend: feedback.expired) beholder sin evaluering. */}
              {boardPlanMissing && !boardPlanExpired && (
                <div className="mt-4 pt-4 border-t border-cz-border">
                  <p className="text-cz-2 text-xs">{t("dashboard:nextActions.boardPlanMissing")}</p>
                </div>
              )}
              {(!boardPlanMissing || boardPlanExpired) && boardOutlook?.feedback && boardCopyReady && (
                <div className="mt-4 pt-4 border-t border-cz-border">
                  <p className="text-cz-1 text-sm font-medium">{resolveBoardFeedbackHeadline(t, boardOutlook.feedback)}</p>
                  <p className="text-cz-2 text-xs mt-1">{resolveBoardFeedbackSummary(t, boardOutlook.feedback)}</p>
                  {/* #6717: maalets navn oeverst (ombrydes, aldrig afskaaret),
                      derunder status-maerke + procent, saa bjaelken. 2 kolonner
                      ogsaa paa mobil: kortet deler raekke med Global Rank, saa 4
                      kolonner pressede navnet ud til "RANGERI…". */}
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    {Object.values(boardOutlook.score_breakdown?.categories || {}).map((category) => (
                      <div key={category.key} className="flex flex-col bg-cz-subtle rounded-cz p-3 border border-cz-border">
                        <p className="font-data text-2xs uppercase tracking-[.08em] text-cz-3 break-words hyphens-auto">{resolveCategoryLabel(t, category)}</p>
                        <div className="flex items-center justify-between gap-2 mt-auto pt-1 mb-1.5 min-h-6">
                          {category.score_pct > 100 ? (
                            <StatusBadge state="won" emphasis className="whitespace-nowrap">
                              <span title={t("dashboard:cards.board.exceedsTitle")}>{t("dashboard:cards.board.exceeds")}</span>
                            </StatusBadge>
                          ) : <span aria-hidden="true" />}
                          <span className="text-cz-2 text-xs font-data tabular-nums">{Math.min(100, category.score_pct)}%</span>
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
          </div> : (
            <div aria-hidden="true" className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map(index => (
                <div key={index}>
                  <Skeleton className="mb-2 h-3 w-20 max-w-full" />
                  <Skeleton className="h-5 w-full" />
                </div>
              ))}
            </div>
          )}
        </Section>
        )}

        {/* Global Rank widget (#2453) — "#N ▲x · point", linker til /global-rank.
            Parret med Bestyrelse (docs/DASHBOARD_RULES.md §4). */}
        {isVisible("globalRank") && <GlobalRankWidget />}

      </div>

      {/* #4997 — lav, ikke-blokerende bundbar. Fixed overlay, så den ligger
          uden for sidens indholdsflow og ikke skubber noget. */}
      <NpsPrompt
        visible={nps.visible}
        done={nps.done}
        submitting={nps.submitting}
        onSubmit={nps.submit}
        onDismiss={nps.dismiss}
        onClose={nps.close}
      />
    </div>
  );
}
