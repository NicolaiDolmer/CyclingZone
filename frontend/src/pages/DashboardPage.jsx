import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useNavigate } from "react-router-dom";
import OnboardingModal from "../components/OnboardingModal";
import OnboardingProgressCard from "../components/OnboardingProgressCard";
import OnboardingCompletionCard from "../components/OnboardingCompletionCard";
import { FinanceForecastBadge } from "../components/FinanceForecastCard";
import SurveyBanner from "../components/SurveyBanner";
import { computeDashboardSquadStats, fetchSquadCountInputs } from "../lib/dashboardSquadStats";
import { formatNumber } from "../lib/intl";
import { dateTextToDayOfYear } from "../lib/raceCalendar";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import { useActionSummary } from "../hooks/useActionSummary";
import NextActionsCard from "../components/NextActionsCard";
import RiderLink from "../components/RiderLink";
import { Flag } from "../components/Flag";
import useDashboardLayout from "../lib/useDashboardLayout";
import {
  resolveBoardFeedbackHeadline,
  resolveBoardFeedbackSummary,
  resolveCategoryLabel,
} from "../lib/boardCopy";
import DashboardCustomizeMenu from "../components/DashboardCustomizeMenu";

const API = import.meta.env.VITE_API_URL;
// Realtime: sæson-fremskridt (race_days_completed) + resultat-afledte tal skal
// opdatere uden hård reload når et løb finaliseres (#783).
const REALTIME_TABLES = ["seasons", "race_results"];

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
  const [incomingLoanCount, setIncomingLoanCount] = useState(0);
  const [allAuctions, setAllAuctions] = useState([]);
  const [nextRaces, setNextRaces] = useState([]);
  const [standings, setStandings] = useState([]);
  const [board, setBoard] = useState(null);
  const [boardOutlook, setBoardOutlook] = useState(null);
  const [activeOffers, setActiveOffers] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);

  const [seasonInfo, setSeasonInfo] = useState(null);
  const [transferWindow, setTransferWindow] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [discordNudgeDismissed, setDiscordNudgeDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("cz-dashboard-discord-nudge-dismissed") === "1"
  );
  const [showDiscordNudge, setShowDiscordNudge] = useState(false);
  const [onboardingProgress, setOnboardingProgress] = useState(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("cz-dashboard-onboarding-dismissed") === "1"
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
  const recentResultsVisible = isVisible("recentResults");
  const riderRankingVisible = isVisible("riderRanking");

  async function loadAll() {
    try {
    const [{ data: { user } }, { data: { session } }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.auth.getSession(),
    ]);
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

    const [teamsRes, ridersRes, squadCountInputs, auctionsRes, racesRes, standingsRes, boardStatus, offersRes] = await Promise.all([
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
        ? supabase.from("races").select("*, pool_race:pool_race_id(date_text)")
            .eq("season_id", activeSeason.id)
            .not("status", "eq", "completed")
            .order("name").limit(10)
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
    ]);

    setSeasonInfo(activeSeason || null);
    setRiders(ridersRes.data || []);
    setPendingIncomingCount(squadCountInputs.pendingIncomingCount);
    setIncomingLoanCount(squadCountInputs.incomingLoanCount);
    setAllAuctions(auctionsRes.data || []);
    const sortedRaces = [...(racesRes.data || [])]
      .sort((a, b) => dateTextToDayOfYear(a.pool_race?.date_text) - dateTextToDayOfYear(b.pool_race?.date_text))
      .slice(0, 3);
    setNextRaces(sortedRaces);
    const activePlan = boardStatus?.plans?.["1yr"] || boardStatus?.plans?.["3yr"] || boardStatus?.plans?.["5yr"] || null;
    setBoard(activePlan?.board || null);
    setBoardOutlook(activePlan?.outlook || null);
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

    // Transfer window status
    const { data: tw } = await supabase
      .from("transfer_windows").select("*")
      .order("created_at", { ascending: false }).limit(1).single();
    setTransferWindow(tw);

    // Onboarding — show if user has no riders
    const riderCount = (ridersRes.data || []).length;
    if (riderCount === 0 && !localStorage.getItem("cz_onboarding_done")) {
      setShowOnboarding(true);
    }

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

  // #1005: hent de to nye moduler fra deres aggregat-endpoints — kun når modulet
  // er synligt, så managere der har skjult dem ikke betaler omkostningen. Endpoints
  // er cachede server-side (60s), så toggle on→off→on rammer cachen.
  useEffect(() => {
    let cancelled = false;
    async function loadExtras() {
      if (!recentResultsVisible && !riderRankingVisible) return;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };
      if (recentResultsVisible) {
        try {
          const r = await fetch(`${API}/api/dashboard/recent-results`, { headers });
          if (r.ok && !cancelled) setRecentResults((await r.json()).races || []);
        } catch { /* best-effort */ }
      }
      if (riderRankingVisible) {
        try {
          const r = await fetch(`${API}/api/dashboard/rider-ranking`, { headers });
          if (r.ok && !cancelled) setRiderRanking((await r.json()).riders || []);
        } catch { /* best-effort */ }
      }
    }
    loadExtras();
    return () => { cancelled = true; };
  }, [recentResultsVisible, riderRankingVisible]);

  function dismissDiscordNudge() {
    localStorage.setItem("cz-dashboard-discord-nudge-dismissed", "1");
    setDiscordNudgeDismissed(true);
    setShowDiscordNudge(false);
  }

  function dismissOnboarding() {
    localStorage.setItem("cz-dashboard-onboarding-dismissed", "1");
    setOnboardingDismissed(true);
  }

  function dismissCompletion() {
    localStorage.setItem("cz-dashboard-onboarding-completion-dismissed", "1");
    setCompletionDismissed(true);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
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
  const satisfactionColor = board?.satisfaction >= 70 ? "text-cz-success" : board?.satisfaction >= 40 ? "text-cz-accent-t" : "text-cz-danger";

  // Squad warnings — bug #250: tæller skal forudsige fremtidens hold-størrelse
  // (ejede MINUS pending-out PLUS pending-in PLUS indgående lån), ikke nuværende
  // ejet-tal. Ellers viser dashboardet falske over/under-warnings når en
  // manager har transfers pending over et vindue. #1090: indgående lån dækker
  // også window_pending (parkeret til næste sæson) — paritet med backend
  // getTeamMarketState.
  const squadStats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount,
    incomingLoanCount,
    myTeamId: team?.id,
    division: team?.division,
  });
  const { ownedNow, outgoingCount, warning: squadWarning } = squadStats;

  // My division standings
  const divStandings = standings.filter(s => !s.team?.is_ai && s.division === team?.division)
    .sort((a, b) => b.total_points - a.total_points).slice(0, 5);

  const pendingIncoming = pendingIncomingCount;
  const activeMarketOffers = activeOffers.filter(o =>
    ["pending", "countered", "awaiting_confirmation", "window_pending"].includes(o.status)
  );

  return (
    <div className="max-w-6xl mx-auto">
      <SurveyBanner />
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{team?.name}</h1>
          <p className="text-cz-3 text-sm">
            {t("dashboard:header.subtitle", { division: team?.division, count: ownedNow })}
            {pendingIncomingCount > 0 && <span className="text-cz-success"> {t("dashboard:header.incoming", { count: pendingIncomingCount })}</span>}
            {outgoingCount > 0 && <span className="text-cz-danger"> {t("dashboard:header.outgoing", { count: outgoingCount })}</span>}
            {incomingLoanCount > 0 && <span className="text-purple-400"> {t("dashboard:header.loans", { count: incomingLoanCount })}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <Link to="/finance" className="block text-right group" title={t("common:sidebar.balance")}>
            <p className="text-cz-accent-t font-mono font-bold text-xl group-hover:underline">{formatNumber(team?.balance)} CZ$</p>
            <p className="text-cz-3 text-xs">{t("common:sidebar.balance")}</p>
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

      {/* Næste træk — prioriteret action-overblik (#271 Slice B) */}
      <NextActionsCard pending={actionSummary} urgentAuctionCount={urgentAuctionCount} loading={actionLoading} />

      {/* Squad warning */}
      {squadWarning && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border flex items-center gap-2
          ${squadWarning.color === "red"
            ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
            : "bg-cz-warning-bg text-cz-warning border-cz-warning/30"}`}>
          <span>⚠️</span>
          <span>{t(`dashboard:squadWarning.${squadWarning.type}`, {
            count: squadWarning.count,
            limit: squadWarning.limit,
            division: squadWarning.division,
          })}</span>
          <Link to="/team" className="ms-auto text-xs underline opacity-70 hover:opacity-100">{t("dashboard:squadWarning.ctaMyTeam")}</Link>
        </div>
      )}

      {/* Slice 07g · Finance forecast widget — synlig altid (også grøn), så manageren
          får et stabilt blik på kommende sæsons cashflow inden FinancePage. */}
      {forecast && (
        <div className="mb-4">
          <FinanceForecastBadge forecast={forecast} />
        </div>
      )}

      {/* Onboarding progress — vis indtil alle trin nået eller dismissed */}
      {!onboardingDismissed && onboardingProgress && onboardingProgress.completed_count < onboardingProgress.total_count && (
        <OnboardingProgressCard progress={onboardingProgress} onDismiss={dismissOnboarding} />
      )}

      {/* Onboarding completion — vis engang når alle 4 trin er gennemført */}
      {!completionDismissed && onboardingProgress && onboardingProgress.completed_count === onboardingProgress.total_count && (
        <OnboardingCompletionCard onDismiss={dismissCompletion} />
      )}

      {/* Discord DM nudge */}
      {showDiscordNudge && (
        <div className="mb-4 px-4 py-3 bg-cz-card border border-[#5865F2]/30 rounded-xl flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#5865F2]/20 flex items-center justify-center flex-shrink-0">
            <span className="text-[#5865F2] text-sm font-bold">D</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-cz-1 text-sm font-medium">{t("dashboard:discordNudge.title")}</p>
            <p className="text-cz-3 text-xs mt-0.5">{t("dashboard:discordNudge.subtitle")}</p>
          </div>
          <Link
            to="/profile"
            className="px-3 py-1.5 bg-[#5865F2] text-white rounded-lg text-xs font-bold hover:bg-[#4752c4] transition-all flex-shrink-0">
            {t("dashboard:discordNudge.cta")}
          </Link>
          <button
            onClick={dismissDiscordNudge}
            className="text-cz-3 hover:text-cz-1 text-lg leading-none px-1 flex-shrink-0"
            aria-label={t("dashboard:discordNudge.dismissAria")}>
            ×
          </button>
        </div>
      )}

      {/* Deadline Day banner */}
      {transferWindow?.status === "open" && (() => {
        const closes = transferWindow.closes_at ? new Date(transferWindow.closes_at) : null;
        if (!closes) return null;
        const diff = closes - new Date();
        if (diff <= 0 || diff > 86400000 * 2) return null; // Only show last 48h
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        return (
          <div className="mb-4 px-4 py-3 bg-cz-danger-bg border border-cz-danger/30 rounded-xl
            flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-2">
              <span className="text-cz-danger text-lg">🔔</span>
              <div>
                <p className="text-cz-danger font-bold text-sm">{t("dashboard:deadlineDay.title")}</p>
                <p className="text-cz-danger/70 text-xs">{t("dashboard:deadlineDay.closesIn", { h, m })}</p>
              </div>
            </div>
            <Link to="/transfers"
              className="px-3 py-1.5 bg-cz-danger-bg text-cz-danger border border-cz-danger/30
                rounded-lg text-xs font-bold hover:bg-cz-danger-bg0/30 transition-all">
              {t("dashboard:deadlineDay.cta")}
            </Link>
          </div>
        );
      })()}

      {showOnboarding && (
        <OnboardingModal onClose={() => {
          setShowOnboarding(false);
          localStorage.setItem("cz_onboarding_done", "1");
        }} />
      )}

      {/* Season Status Banner */}
      {seasonInfo && (
        <div className="mb-5 bg-cz-card border border-cz-border rounded-xl px-5 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-cz-1 text-sm">{t("dashboard:seasonBanner.title", { number: seasonInfo.number })}</span>
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

          {(seasonInfo.race_days_total || 0) > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-cz-3 text-xs whitespace-nowrap">
                {t("dashboard:seasonBanner.raceDays", {
                  completed: seasonInfo.race_days_completed || 0,
                  total: seasonInfo.race_days_total,
                })}
              </span>
              <div className="w-20 bg-cz-subtle rounded-full h-1.5">
                <div className="h-1.5 rounded-full bg-cz-accent transition-all"
                  style={{ width: `${Math.min(100, ((seasonInfo.race_days_completed || 0) / seasonInfo.race_days_total) * 100)}%` }} />
              </div>
            </div>
          )}

          {transferWindow && (
            <span className={`ms-auto text-[10px] px-2 py-1 rounded-full border font-medium
              ${transferWindow.status === "open"
                ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                : "bg-cz-subtle text-cz-2 border-cz-border"}`}>
              {transferWindow.status === "open"
                ? t("dashboard:seasonBanner.transferWindow.open")
                : t("dashboard:seasonBanner.transferWindow.closed")}
            </span>
          )}
        </div>
      )}

      {/* Main grid */}
      <div className="grid lg:grid-cols-2 gap-4">

        {/* My auctions + winning */}
        {isVisible("auctions") && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          <Link to="/auctions" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.auctions.title")}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.auctions.linkAll")}</span>
          </Link>
          {myActiveAuctions.length === 0 ? (
            <p className="text-cz-3 text-sm text-center py-4">{t("dashboard:cards.auctions.empty")}</p>
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
        </div>
        )}

        {/* Pending transfers + offers */}
        {isVisible("transfers") && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          <Link to="/transfers" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.transfers.title")}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.transfers.linkAll")}</span>
          </Link>
          {activeMarketOffers.length === 0 && pendingIncoming === 0 ? (
            <p className="text-cz-3 text-sm text-center py-4">{t("dashboard:cards.transfers.empty")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {pendingIncoming > 0 && (
                <div className="flex items-center gap-3 py-2 border-b border-cz-border">
                  <span className="text-cz-success text-lg">↓</span>
                  <p className="text-cz-1 text-sm">{t("dashboard:cards.transfers.incomingCount", { count: pendingIncoming })}</p>
                  <span className="ms-auto text-[9px] bg-cz-success-bg text-cz-success border border-cz-success/30 px-2 py-0.5 rounded-full">{t("dashboard:cards.transfers.awaitingWindow")}</span>
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
                          : o.status === "window_pending"
                            ? t("dashboard:cards.transfers.awaitingWindow")
                            : t("dashboard:cards.transfers.active")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Upcoming races */}
        {isVisible("races") && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          <Link to="/races" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.races.title")}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.races.linkAll")}</span>
          </Link>
          {nextRaces.length === 0 ? (
            <p className="text-cz-3 text-sm text-center py-4">{t("dashboard:cards.races.empty")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {nextRaces.map((race) => (
                <Link key={race.id} to="/races"
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
                    {race.pool_race?.date_text
                      ? <p className="text-cz-2 text-sm">{race.pool_race.date_text}</p>
                      : <p className="text-cz-3 text-sm">{t("dashboard:cards.races.dateTbd")}</p>}
                    {race.edition_year && (
                      <p className="text-cz-accent-t text-xs font-mono">{t("common:race.editionYear", { year: race.edition_year })}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
        )}

        {/* My division standings */}
        {isVisible("divStandings") && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          <Link to="/standings" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.standings.title", { division: team?.division })}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.standings.linkAll")}</span>
          </Link>
          {divStandings.length === 0 ? (
            <p className="text-cz-3 text-sm text-center py-4">{t("dashboard:cards.standings.empty")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {divStandings.map((s, i) => {
                const isMe = s.team_id === team?.id;
                const isLeader = i === 0;
                const maxPts = divStandings[0]?.total_points || 1;
                return (
                  <Link key={s.id} to="/standings"
                    style={isMe ? { boxShadow: "inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)" } : undefined}
                    className={`flex items-center gap-3 py-1.5 -mx-2 px-2 rounded-lg transition-colors ${isLeader ? "bg-cz-accent/[0.08]" : "hover:bg-cz-subtle"}`}>
                    <span className={`font-mono text-xs w-4 text-right flex-shrink-0 ${isLeader ? "text-cz-accent-t" : "text-cz-3"}`}>#{i+1}</span>
                    <p className={`text-sm w-28 truncate flex-shrink-0 ${isMe ? "text-cz-1 font-medium" : "text-cz-2"}`}>{s.team?.name}</p>
                    <div className="flex-1">
                      <MiniBar value={s.total_points || 0} max={maxPts} color={isLeader ? "rgb(var(--accent))" : "var(--text-3)"} />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Board status */}
        {isVisible("board") && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5 lg:col-span-2">
          <Link to="/board" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.board.title")}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.board.linkAll")}</span>
          </Link>
          {!board ? (
            <p className="text-cz-3 text-sm text-center py-4">{t("dashboard:cards.board.empty")}</p>
          ) : (
            <div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("dashboard:cards.board.satisfaction")}</p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-cz-subtle rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all
                        ${board.satisfaction >= 70 ? "bg-green-400" : board.satisfaction >= 40 ? "bg-cz-accent" : "bg-red-400"}`}
                        style={{ width: `${board.satisfaction}%` }} />
                    </div>
                    <span className={`font-mono font-bold text-sm ${satisfactionColor}`}>{board.satisfaction}%</span>
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
                            className={`h-1.5 rounded-full ${category.score_pct >= 75 ? "bg-green-400" : category.score_pct >= 55 ? "bg-cz-accent" : "bg-red-400"}`}
                            style={{ width: `${Math.min(100, category.score_pct)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {/* Recent results (#1005) */}
        {isVisible("recentResults") && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          <Link to="/resultater" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.recentResults.title")}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.recentResults.linkAll")}</span>
          </Link>
          {recentResults.length === 0 ? (
            <p className="text-cz-3 text-sm text-center py-4">{t("dashboard:cards.recentResults.empty")}</p>
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
        </div>
        )}

        {/* Rider ranking (#1005) */}
        {isVisible("riderRanking") && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          <Link to="/rider-rankings" className="flex items-center justify-between mb-4 group">
            <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("dashboard:cards.riderRanking.title")}</h2>
            <span className="text-xs text-cz-accent-t group-hover:underline">{t("dashboard:cards.riderRanking.linkAll")}</span>
          </Link>
          {riderRanking.length === 0 ? (
            <p className="text-cz-3 text-sm text-center py-4">{t("dashboard:cards.riderRanking.empty")}</p>
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
        </div>
        )}

      </div>
    </div>
  );
}
