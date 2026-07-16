import { useState, useEffect, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useNavigate } from "react-router-dom";
import OnboardingProgressCard from "../components/OnboardingProgressCard";
import OnboardingCompletionCard from "../components/OnboardingCompletionCard";
import { FinanceForecastBadge } from "../components/FinanceForecastCard";
import { computeDashboardSquadStats, fetchSquadCountInputs } from "../lib/dashboardSquadStats";
import { computeOverallBoardSatisfaction } from "../lib/boardUtils";
import { formatNumber } from "../lib/intl";
import { dateTextToDayOfYear } from "../lib/raceCalendar";
import { poolRaceDayTotals, deriveRaceStatus } from "../lib/raceHubLogic.js";
import { countdownParts, countdownSegments } from "../lib/stageScheduleConfig.js";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import { useActionSummary } from "../hooks/useActionSummary";
import NextActionsCard from "../components/NextActionsCard";
import TeamSelectionCtaCard from "../components/TeamSelectionCtaCard";
import MyLatestResultCard from "../components/MyLatestResultCard";
import { pickNextSelectableRace } from "../lib/nextSelectableRace";
import { pickUpcomingRaces } from "../lib/upcomingRaces";
import RiderLink from "../components/RiderLink";
import { Flag } from "../components/Flag";
import useDashboardLayout from "../lib/useDashboardLayout";
import {
  resolveBoardFeedbackHeadline,
  resolveBoardFeedbackSummary,
  resolveCategoryLabel,
} from "../lib/boardCopy";
import DashboardCustomizeMenu from "../components/DashboardCustomizeMenu";
import { Card, AlertTriangleIcon, XIcon, ArrowDownIcon, ChevronRightIcon, PageLoader } from "../components/ui";
import { flushPendingSignup, logFirstEvent, logTeamDrafted } from "../lib/logEvent";

const API = import.meta.env.VITE_API_URL;
// Realtime: sæson-fremskridt (race_days_completed) + resultat-afledte tal skal
// opdatere uden hård reload når et løb finaliseres (#783).
const REALTIME_TABLES = ["seasons", "race_results"];

// #1828: countdown til næste etape for et igangværende løb. Genbruger de delte rene
// helpers + races-namespacets countdown-strenge (samme tekst som StageScheduleCard).
function nextStageCountdown(scheduledMs, nowMs, t) {
  const parts = countdownParts(scheduledMs - nowMs);
  if (!parts) return t("races:detail.stageSchedule.startingNow");
  const segs = countdownSegments(parts).map((s) =>
    t(`races:detail.stageSchedule.countdown${s.unit[0].toUpperCase()}${s.unit.slice(1)}`, { count: s.count }));
  return `${t("races:detail.stageSchedule.countdownPrefix")} ${segs.join(" ")}`;
}

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

function MiniBar({ value, max, color = "rgb(var(--accent))" }) {
  const pct = Math.min(100, Math.round((value / Math.max(max, 1)) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-cz-subtle rounded-full h-1.5">
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono text-cz-2 w-8 text-right">{value}</span>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { t } = useTranslation(["dashboard", "common"]);
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [pendingIncomingCount, setPendingIncomingCount] = useState(0);
  const [allAuctions, setAllAuctions] = useState([]);
  const [nextRaces, setNextRaces] = useState([]);
  const [standings, setStandings] = useState([]);
  const [board, setBoard] = useState(null);
  // #1830 · board-bred tilfredshed (gnsn. på tværs af alle planer) — samme værdi
  // som Bestyrelse-sidens drivers-panel, så de to flader ikke divergerer.
  const [boardSatisfaction, setBoardSatisfaction] = useState(null);
  const [boardOutlook, setBoardOutlook] = useState(null);
  const [activeOffers, setActiveOffers] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);

  const [seasonInfo, setSeasonInfo] = useState(null);
  const [poolRaceDays, setPoolRaceDays] = useState(null); // #1829: per-pulje løbsdage-tæller
  const [nextStageByRace, setNextStageByRace] = useState({}); // #1828: live-løb → næste etapes ms-tid
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [discordNudgeDismissed, setDiscordNudgeDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("cz-dashboard-discord-nudge-dismissed") === "1"
  );
  const [showDiscordNudge, setShowDiscordNudge] = useState(false);
  const [onboardingProgress, setOnboardingProgress] = useState(null);
  // #1569: progress-guiden dismisses kun for DENNE session (sessionStorage), ikke
  // permanent — et fejlklik på X ved 0/4 trin må ikke dræbe den eneste onboarding-
  // guide for altid. Den kommer tilbage ved næste besøg indtil alle trin er nået.
  // Completion-kortet (4/4) beholder permanent localStorage-dismiss nedenfor.
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
  const [recentResults, setRecentResults] = useState([]);
  const [riderRanking, setRiderRanking] = useState([]);
  // #2466: resultat-push — null = ikke hentet endnu/fejlet (kortet renderer intet),
  // { race: null } = ingen finaliserede løb (empty state), ellers payload.
  const [myLatestResult, setMyLatestResult] = useState(null);
  const recentResultsVisible = isVisible("recentResults");
  const riderRankingVisible = isVisible("riderRanking");
  const myLatestResultVisible = isVisible("myLatestResult");

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

  async function loadAll() {
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
    const poolRacesPromise = activeSeason && teamData.league_division_id != null
      ? supabase.from("races").select("stages, stages_completed, status")
          .eq("season_id", activeSeason.id).eq("league_division_id", teamData.league_division_id)
      : Promise.resolve({ data: [] });

    const [teamsRes, ridersRes, squadCountInputs, auctionsRes, racesRes, standingsRes, boardStatus, offersRes, poolRacesRes] = await Promise.all([
      supabase.from("teams")
        .select("id, name, division, is_ai")
        .eq("is_ai", false)
        .eq("is_test_account", false)
        .order("division")
        .order("name"),
      // #1308: akademiryttere tæller ikke mod senior-cap
      supabase.from("riders").select("id, salary, is_u25, pending_team_id")
        .eq("team_id", teamData.id)
        .eq("is_academy", false),
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
        ? supabase.from("season_standings")
            .select("*, team:team_id(id, name, division, is_ai)")
            .eq("season_id", activeSeason.id)
            .order("total_points", { ascending: false })
        : Promise.resolve({ data: [] }),
      boardStatusPromise,
      token
        ? fetch(`${API}/api/transfers/my-offers`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
        : Promise.resolve({ sent: [], received: [] }),
      poolRacesPromise,
    ]);

    setSeasonInfo(activeSeason || null);
    setPoolRaceDays(poolRaceDayTotals(poolRacesRes.data || []));
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

    const standingsMap = {};
    (standingsRes.data || []).filter(s => !s.team?.is_ai).forEach(s => {
      standingsMap[s.team_id] = s;
    });
    const mergedStandings = (teamsRes.data || []).map(otherTeam => (
      standingsMap[otherTeam.id] || {
        id: otherTeam.id,
        team_id: otherTeam.id,
        division: otherTeam.division,
        team: otherTeam,
        total_points: 0,
        stage_wins: 0,
        gc_wins: 0,
        races_completed: 0,
      }
    ));
    setStandings(mergedStandings);

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
        }
      } catch {
        // best-effort
      }
    }

    } catch (e) {
      console.error("Dashboard load failed:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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

  // #2288 D1 — mangler holdudtagelse til det næste udtagelige løb? Samme kilde
  // som RaceSelectionPanel/saveSelection (race_entries, is_auto_filled=false).
  useEffect(() => {
    let cancelled = false;
    const nextRace = pickNextSelectableRace(nextRaces);
    if (!nextRace || !team?.id) { setSquadSelectionMissingRace(null); return undefined; }
    (async () => {
      const { count } = await supabase
        .from("race_entries")
        // race_entries har ingen id-kolonne (PK = race_id+rider_id); tæl på race_id.
        // "id" gav 400/42703 hver dashboard-load → count=null → nudgen viste sig ALDRIG (#2296-regression).
        .select("race_id", { count: "exact", head: true })
        .eq("race_id", nextRace.id)
        .eq("team_id", team.id)
        .eq("is_auto_filled", false);
      // Kun eksplicit count===0 viser nudgen — null (fejl/ukendt, fx e2e-mock
      // uden Content-Range) må ikke udløse et falsk "udtagelse mangler".
      if (!cancelled) setSquadSelectionMissingRace(count === 0 ? nextRace : null);
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
            if (r.ok && !cancelled) setRecentResults((await r.json()).races || []);
          } catch { /* best-effort */ }
        })(),
        riderRankingVisible && (async () => {
          try {
            const r = await fetch(`${API}/api/dashboard/rider-ranking`, { headers });
            if (r.ok && !cancelled) setRiderRanking((await r.json()).riders || []);
          } catch { /* best-effort */ }
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
    // #1569: session-scoped (ikke permanent) — se init-kommentar ovenfor.
    sessionStorage.setItem("cz-dashboard-onboarding-dismissed", "1");
    setOnboardingDismissed(true);
  }

  function dismissCompletion() {
    localStorage.setItem("cz-dashboard-onboarding-completion-dismissed", "1");
    setCompletionDismissed(true);
  }

  if (loading) return (
    <PageLoader />
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

  // #2328 — "Kommende løb"-kortet: de 3 faktisk kommende løb efter ægte
  // race_stage_schedule-tid (nextStageByRace), ikke den statiske PCM-dato som
  // det tidligere top-3-udvalg blev sorteret på FØR den ægte tid var kendt.
  const displayedRaces = pickUpcomingRaces(nextRaces, nextStageByRace, 3);

  // My division standings
  const divStandingsAll = standings.filter(s => !s.team?.is_ai && s.division === team?.division)
    .sort((a, b) => b.total_points - a.total_points);
  const myStandingIndex = divStandingsAll.findIndex(s => s.team_id === team?.id);
  // #2328 — egen placering skal altid være synlig, også uden for top-5. Top-5
  // vises som hidtil; er manageren ikke i top-5, tilføjes hans egen række sidst
  // (med den ægte placerings-nummer bevaret via myStandingIndex i JSX'en).
  const divStandingsTop = divStandingsAll.slice(0, 5).map((s, i) => ({ ...s, _rank: i + 1 }));
  const divStandings = myStandingIndex >= 0 && myStandingIndex >= 5
    ? [...divStandingsTop, { ...divStandingsAll[myStandingIndex], _rank: myStandingIndex + 1, _isOwnRowBreak: true }]
    : divStandingsTop;

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
  const showDiscordNudgeBanner = !onboardingIncomplete && showDiscordNudge;

  return (
    // #2253: translate="no" — dashboardet re-committer hyppigt tekst-noder (live
    // race-data, countdowns); browser-oversættere muterede dem og udløste
    // NotFoundError-crashes (Sentry-events med url=/dashboard). Se PR #2272.
    <div translate="no" className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{team?.name}</h1>
          <p className="text-cz-3 text-sm">
            {t("dashboard:header.subtitle", { division: team?.division, count: ownedNow })}
            {pendingIncomingCount > 0 && <span className="text-cz-success"> {t("dashboard:header.incoming", { count: pendingIncomingCount })}</span>}
            {outgoingCount > 0 && <span className="text-cz-danger"> {t("dashboard:header.outgoing", { count: outgoingCount })}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* #2288 E — synlig klikbar affordance: hover-underline + chevron, så
              saldoblokken læses som et link (den linker allerede til /finance). */}
          <Link to="/finance" className="flex items-center gap-1 text-right group" title={t("common:sidebar.balance")}>
            <div>
              <p className="text-cz-accent-t font-mono font-bold text-xl group-hover:underline">{formatNumber(team?.balance)} CZ$</p>
              <p className="text-cz-3 text-xs">{t("common:sidebar.balance")}</p>
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
        </div>
      </div>

      {/* #2288 B — Onboarding progress flyttet til TOP af stakken (over Næste
          træk) indtil onboarding er fuldført, så den ikke drukner blandt andre
          kort. Completion-kortet bliver hvor det plejer (post-onboarding). */}
      {!onboardingDismissed && onboardingIncomplete && (
        <OnboardingProgressCard progress={onboardingProgress} onDismiss={dismissOnboarding} />
      )}

      {/* Næste træk — prioriteret action-overblik (#271 Slice B).
          Valgfri via customize (#1536). */}
      {isVisible("nextActions") && (
        <NextActionsCard
          pending={actionSummary}
          urgentAuctionCount={urgentAuctionCount}
          loading={actionLoading}
          squadSelectionMissingRace={squadSelectionMissingRace}
          notTrainedToday={notTrainedToday}
          boardPlanMissing={boardPlanMissing}
        />
      )}

      {/* Squad warning */}
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

      {/* Slice 07g · Finance forecast widget — synlig altid (også grøn), så manageren
          får et stabilt blik på kommende sæsons cashflow inden FinancePage.
          Valgfri via customize (#1536). */}
      {isVisible("forecast") && forecast && (
        <div className="mb-4">
          <FinanceForecastBadge forecast={forecast} />
        </div>
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
          <div className="w-8 h-8 rounded-lg bg-cz-discord/20 flex items-center justify-center flex-shrink-0">
            <span className="text-cz-discord text-sm font-bold">D</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-cz-1 text-sm font-medium">{t("dashboard:discordNudge.title")}</p>
            <p className="text-cz-3 text-xs mt-0.5">{t("dashboard:discordNudge.subtitle")}</p>
          </div>
          <Link
            to="/profile"
            className="px-3 py-1.5 bg-cz-discord text-white rounded-lg text-xs font-bold hover:bg-cz-discord-hover transition-all flex-shrink-0">
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

      {/* Season Status Banner — links to the race calendar (#1421: was a dead Card).
          #2328: rettet fra /races (RaceHub) til /calendar — knappens tekst
          ("Se kalender") lovede kalendersiden, men Linket pegede på RaceHub. */}
      {seasonInfo && (
        <Link to="/calendar" className="group block">
        <Card className="mb-5 px-5 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 group-hover:border-cz-accent/30 transition-colors">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:seasonBanner.title", { number: seasonInfo.number })}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border
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

          {/* #1829: per-pulje løbsdage (kørt inkl. igangværende / puljens total), ikke det
              sæson-globale tal. Falder bort hvis puljen ingen løb har (fx pulje-løst hold). */}
          {(poolRaceDays?.total || 0) > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-cz-3 text-xs whitespace-nowrap">
                {t("dashboard:seasonBanner.raceDays", { completed: poolRaceDays.completed, total: poolRaceDays.total })}
                {poolRaceDays.inProgress > 0 && (
                  <span className="text-cz-accent-t ms-1">· {t("dashboard:seasonBanner.raceDaysLive", { count: poolRaceDays.inProgress })}</span>
                )}
              </span>
              <div className="w-20 bg-cz-subtle rounded-full h-1.5">
                <div className="h-1.5 rounded-full bg-cz-accent transition-all"
                  style={{ width: `${Math.min(100, (poolRaceDays.completed / poolRaceDays.total) * 100)}%` }} />
              </div>
            </div>
          )}

          <div className="ms-auto flex items-center gap-3">
            <span className="text-xs text-cz-accent-t group-hover:underline whitespace-nowrap">{t("dashboard:seasonBanner.viewCalendar")}</span>
          </div>
        </Card>
        </Link>
      )}

      {/* #1681: holdudtagelse-CTA — synlig genvej direkte til det løb der reelt
          MANGLER udtagelse (squadSelectionMissingRace, #2328 — ikke bare det
          tidligst scheduled-løb, som kunne være allerede-udtaget). */}
      <TeamSelectionCtaCard nextRace={squadSelectionMissingRace} />

      {/* #2466: "How your team did" — resultat-push øverst over modul-gridden.
          Kortet renderer intet før endpoint-svaret er landet (myLatestResult
          starter som null), empty state når holdet endnu ingen løb har kørt. */}
      {myLatestResultVisible && <MyLatestResultCard data={myLatestResult} />}

      {/* Main grid */}
      <div className="grid lg:grid-cols-2 gap-4">

        {/* My auctions + winning */}
        {isVisible("auctions") && (
        <Card className="p-5">
          <Link to="/auctions" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.auctions.title")}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.auctions.linkAll")}</span>
          </Link>
          {myActiveAuctions.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-cz-3 text-sm">{t("dashboard:cards.auctions.empty")}</p>
              <Link to="/auctions" className="text-cz-accent-t text-xs hover:underline mt-1 inline-block">{t("dashboard:cards.auctions.emptyCta")}</Link>
            </div>
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
                          {isWinning && <span className="text-[9px] bg-cz-success-bg text-cz-success px-1.5 py-0.5 rounded-full">{t("dashboard:cards.auctions.winning")}</span>}
                          {isSelling && !isWinning && <span className="text-[9px] bg-cz-info-bg text-cz-info px-1.5 py-0.5 rounded-full">{t("dashboard:cards.auctions.selling")}</span>}
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
        </Card>
        )}

        {/* Pending transfers + offers */}
        {isVisible("transfers") && (
        <Card className="p-5">
          <Link to="/transfers" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.transfers.title")}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.transfers.linkAll")}</span>
          </Link>
          {activeMarketOffers.length === 0 && pendingIncoming === 0 ? (
            <div className="text-center py-4">
              <p className="text-cz-3 text-sm">{t("dashboard:cards.transfers.empty")}</p>
              <Link to="/transfers" className="text-cz-accent-t text-xs hover:underline mt-1 inline-block">{t("dashboard:cards.transfers.emptyCta")}</Link>
            </div>
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
                      <p className="text-cz-accent-t font-mono text-sm">{formatNumber(o.counter_amount || o.offer_amount)} CZ$</p>
                      <span className={`text-[9px] ${needsAction ? "text-cz-warning" : "text-cz-3"}`}>
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
        </Card>
        )}

        {/* Upcoming races */}
        {isVisible("races") && (
        <Card className="p-5">
          <Link to="/races" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.races.title")}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.races.linkAll")}</span>
          </Link>
          {displayedRaces.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-cz-3 text-sm">{t("dashboard:cards.races.empty")}</p>
              <Link to="/races" className="text-cz-accent-t text-xs hover:underline mt-1 inline-block">{t("dashboard:cards.races.emptyCta")}</Link>
            </div>
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
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border bg-cz-accent/10 text-cz-accent-t border-cz-accent/30">
                          {t("dashboard:cards.races.live")}
                          {race.race_type === "stage_race" && (
                            <span className="font-mono normal-case tracking-normal">{race.stages_completed}/{race.stages}</span>
                          )}
                        </span>
                        {nextStageByRace[race.id] && (
                          <span className="text-[10px] text-cz-3 tabular-nums">{nextStageCountdown(nextStageByRace[race.id], nowMs, t)}</span>
                        )}
                      </span>
                    ) : nextStageByRace[race.id]
                      ? <p className="text-cz-2 text-sm tabular-nums">{nextStageCountdown(nextStageByRace[race.id], nowMs, t)}</p>
                      : <p className="text-cz-3 text-sm">{t("dashboard:cards.races.scheduled")}</p>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
        )}

        {/* My division standings */}
        {isVisible("divStandings") && (
        <Card className="p-5">
          <Link to="/standings" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.standings.title", { division: team?.division })}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.standings.linkAll")}</span>
          </Link>
          {divStandings.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-cz-3 text-sm">{t("dashboard:cards.standings.empty")}</p>
              <Link to="/standings" className="text-cz-accent-t text-xs hover:underline mt-1 inline-block">{t("dashboard:cards.standings.emptyCta")}</Link>
            </div>
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
                    <Link to="/standings"
                      style={isMe ? { boxShadow: "inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)" } : undefined}
                      className={`flex items-center gap-3 py-1.5 -mx-2 px-2 rounded-lg transition-colors ${isLeader ? "bg-cz-accent/[0.08]" : "hover:bg-cz-subtle"}`}>
                      <span className={`font-mono text-xs w-4 text-right flex-shrink-0 ${isLeader ? "text-cz-accent-t" : "text-cz-3"}`}>#{s._rank}</span>
                      <p className={`text-sm w-28 truncate flex-shrink-0 ${isMe ? "text-cz-1 font-medium" : "text-cz-2"}`}>{s.team?.name}</p>
                      <div className="flex-1">
                        <MiniBar value={s.total_points || 0} max={maxPts} color={isLeader ? "rgb(var(--accent))" : "var(--text-3)"} />
                      </div>
                    </Link>
                  </Fragment>
                );
              })}
            </div>
          )}
        </Card>
        )}

        {/* Board status — skjul kortet helt indtil bestyrelsen er etableret (#1488).
            board er kun non-null naar en 1yr/3yr/5yr-plan findes; under saeson-1
            baseline-fasen er alle plans=null, saa kortet skal ikke vises endnu. */}
        {isVisible("board") && board && (
        <Card className="p-5 lg:col-span-2">
          <Link to="/board" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.board.title")}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.board.linkAll")}</span>
          </Link>
          <div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("dashboard:cards.board.satisfaction")}</p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-cz-subtle rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all
                        ${displaySatisfaction >= 70 ? "bg-cz-success" : displaySatisfaction >= 40 ? "bg-cz-accent" : "bg-cz-danger"}`}
                        style={{ width: `${displaySatisfaction}%` }} />
                    </div>
                    <span className={`font-mono font-bold text-sm ${satisfactionColor}`}>{displaySatisfaction}%</span>
                  </div>
                </div>
                <div>
                  <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("dashboard:cards.board.focus")}</p>
                  <p className="text-cz-1 text-sm">{board.focus ? t(`dashboard:board.focus.${board.focus}`, { defaultValue: board.focus }) : "—"}</p>
                </div>
                <div>
                  <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("dashboard:cards.board.budgetMultiplier")}</p>
                  <p className={`font-mono font-bold text-sm ${board.budget_modifier >= 1 ? "text-cz-success" : "text-cz-danger"}`}>
                    ×{board.budget_modifier?.toFixed(2) || "1.00"}
                  </p>
                </div>
              </div>
              {boardOutlook?.feedback && (
                <div className="mt-4 pt-4 border-t border-cz-border">
                  <p className="text-cz-1 text-sm font-medium">{resolveBoardFeedbackHeadline(t, boardOutlook.feedback)}</p>
                  <p className="text-cz-2 text-xs mt-1">{resolveBoardFeedbackSummary(t, boardOutlook.feedback)}</p>
                  <div className="grid sm:grid-cols-4 gap-3 mt-3">
                    {Object.values(boardOutlook.score_breakdown?.categories || {}).map((category) => (
                      <div key={category.key} className="bg-cz-subtle rounded-lg p-3 border border-cz-border">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <p className="text-cz-3 text-[10px] uppercase tracking-wider truncate">{resolveCategoryLabel(t, category)}</p>
                          <span className="flex items-center gap-1 flex-shrink-0">
                            {category.score_pct > 100 && (
                              <span
                                className="text-[9px] font-medium text-cz-success bg-cz-success-bg/60 rounded px-1 leading-tight"
                                title={t("dashboard:cards.board.exceedsTitle")}
                              >
                                ✓ {t("dashboard:cards.board.exceeds")}
                              </span>
                            )}
                            <span className="text-cz-2 text-[10px] font-mono">{Math.min(100, category.score_pct)}%</span>
                          </span>
                        </div>
                        <div className="bg-cz-subtle rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${category.score_pct >= 75 ? "bg-cz-success" : category.score_pct >= 55 ? "bg-cz-accent" : "bg-cz-danger"}`}
                            style={{ width: `${Math.min(100, category.score_pct)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
        </Card>
        )}

        {/* Recent results (#1005) */}
        {isVisible("recentResults") && (
        <Card className="p-5">
          <Link to="/resultater" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.recentResults.title")}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.recentResults.linkAll")}</span>
          </Link>
          {recentResults.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-cz-3 text-sm">{t("dashboard:cards.recentResults.empty")}</p>
              <Link to="/races" className="text-cz-accent-t text-xs hover:underline mt-1 inline-block">{t("dashboard:cards.recentResults.emptyCta")}</Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {recentResults.map(race => (
                <div key={race.race_id} className="flex items-center justify-between py-2 border-b border-cz-border last:border-0 gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-cz-1 text-sm truncate">{race.name}</p>
                    <p className="text-cz-3 text-xs mt-0.5">
                      {race.winner?.result_type === "gc"
                        // Endagsløb gemmer vinderen som gc-række men har intet
                        // samlet klassement — dér er han bare "Vinder" (#1188).
                        ? (race.race_type === "stage_race"
                            ? t("dashboard:cards.recentResults.gc")
                            : t("dashboard:cards.recentResults.winner"))
                        : t("dashboard:cards.recentResults.stage", { n: race.winner?.stage_number ?? 0 })}
                    </p>
                  </div>
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
        </Card>
        )}

        {/* Rider ranking (#1005) */}
        {isVisible("riderRanking") && (
        <Card className="p-5">
          <Link to="/rider-rankings" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.riderRanking.title")}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.riderRanking.linkAll")}</span>
          </Link>
          {riderRanking.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-cz-3 text-sm">{t("dashboard:cards.riderRanking.empty")}</p>
              <Link to="/races" className="text-cz-accent-t text-xs hover:underline mt-1 inline-block">{t("dashboard:cards.riderRanking.emptyCta")}</Link>
            </div>
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
                    </p>
                  </div>
                  <span className="font-mono font-bold text-cz-accent-t text-sm flex-shrink-0">{t("dashboard:cards.riderRanking.points", { points: formatNumber(r.points || 0) })}</span>
                </RiderLink>
              ))}
            </div>
          )}
        </Card>
        )}

      </div>
    </div>
  );
}
