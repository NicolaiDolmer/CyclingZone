import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useNavigate } from "react-router-dom";
import OnboardingModal from "../components/OnboardingModal";
import OnboardingProgressCard from "../components/OnboardingProgressCard";
import OnboardingCompletionCard from "../components/OnboardingCompletionCard";
import { FinanceForecastBadge } from "../components/FinanceForecastCard";
import SurveyBanner from "../components/SurveyBanner";
import { computeDashboardSquadStats } from "../lib/dashboardSquadStats";
import { formatNumber, formatDate } from "../lib/intl";
import { dateTextToDayOfYear } from "../lib/raceCalendar";

const API = import.meta.env.VITE_API_URL;

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

function StatCard({ label, value, sub, accent = "text-cz-1", icon }) {
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <p className="text-cz-3 text-xs uppercase tracking-wider">{label}</p>
        <span className="text-base">{icon}</span>
      </div>
      <p className={`text-xl font-bold font-mono ${accent}`}>{value}</p>
      {sub && <p className="text-cz-3 text-xs mt-1 truncate">{sub}</p>}
    </div>
  );
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
  const [activeLoanCount, setActiveLoanCount] = useState(0);
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

    const [teamsRes, ridersRes, pendingIncomingRes, loansInRes, auctionsRes, racesRes, standingsRes, boardStatus, offersRes] = await Promise.all([
      supabase.from("teams")
        .select("id, name, division, is_ai")
        .eq("is_ai", false)
        .eq("is_test_account", false)
        .order("division")
        .order("name"),
      supabase.from("riders").select("id, uci_points, salary, is_u25, pending_team_id")
        .eq("team_id", teamData.id),
      supabase.from("riders")
        .select("id", { count: "exact", head: true })
        .eq("pending_team_id", teamData.id)
        .neq("team_id", teamData.id),
      supabase.from("loan_agreements")
        .select("id", { count: "exact", head: true })
        .eq("to_team_id", teamData.id)
        .eq("status", "active"),
      supabase.from("auctions")
        .select("id, current_price, calculated_end, status, is_guaranteed_sale, seller_team_id, current_bidder_id, rider:rider_id(firstname, lastname, team_id)")
        .in("status", ["active", "extended"]),
      supabase.from("races").select("*, pool_race:pool_race_id(date_text)").not("status", "eq", "completed")
        .order("name").limit(10),
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
    setPendingIncomingCount(pendingIncomingRes.count || 0);
    setActiveLoanCount(loansInRes.count || 0);
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

  useEffect(() => { loadAll(); }, []);

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
  const satisfactionColor = board?.satisfaction >= 70 ? "text-cz-success" : board?.satisfaction >= 40 ? "text-cz-accent-t" : "text-cz-danger";

  // Squad warnings — bug #250: tæller skal forudsige fremtidens hold-størrelse
  // (ejede MINUS pending-out PLUS pending-in PLUS aktive lån), ikke nuværende
  // ejet-tal. Ellers viser dashboardet falske over/under-warnings når en
  // manager har transfers pending over et vindue.
  const squadStats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount,
    activeLoanCount,
    myTeamId: team?.id,
    division: team?.division,
  });
  const { ownedNow, outgoingCount, futureRiderCount, warning: squadWarning } = squadStats;

  // My division standings
  const divStandings = standings.filter(s => !s.team?.is_ai && s.division === team?.division)
    .sort((a, b) => b.total_points - a.total_points).slice(0, 5);

  const totalSalary = riders.reduce((s, r) => s + (r.salary || 0), 0);
  const pendingIncoming = pendingIncomingCount;
  const activeMarketOffers = activeOffers.filter(o =>
    ["pending", "countered", "awaiting_confirmation", "window_pending"].includes(o.status)
  );

  return (
    <div className="max-w-6xl mx-auto">
      <SurveyBanner />
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{team?.name}</h1>
          <p className="text-cz-3 text-sm">
            {t("dashboard:header.subtitle", { division: team?.division, count: ownedNow })}
            {pendingIncomingCount > 0 && <span className="text-cz-success"> {t("dashboard:header.incoming", { count: pendingIncomingCount })}</span>}
            {outgoingCount > 0 && <span className="text-cz-danger"> {t("dashboard:header.outgoing", { count: outgoingCount })}</span>}
            {activeLoanCount > 0 && <span className="text-purple-400"> {t("dashboard:header.loans", { count: activeLoanCount })}</span>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-cz-accent-t font-mono font-bold text-xl">{formatNumber(team?.balance)} CZ$</p>
          <p className="text-cz-3 text-xs">{t("common:sidebar.balance")}</p>
        </div>
      </div>

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

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label={t("dashboard:stats.balance")} value={formatNumber(team?.balance)} sub="CZ$" accent="text-cz-accent-t" icon="💰" />
        <StatCard
          label={t("dashboard:stats.riders")}
          value={futureRiderCount}
          sub={
            pendingIncomingCount > 0 || outgoingCount > 0
              ? t("dashboard:stats.nowAndSalary", { now: ownedNow, amount: formatNumber(totalSalary) })
              : t("dashboard:stats.salaryOnly", { amount: formatNumber(totalSalary) })
          }
          icon="🚴"
        />
        <StatCard label={t("dashboard:stats.activeAuctions")} value={allAuctions.length} sub={t("dashboard:stats.winning", { count: winningAuctions.length })} icon="⚡" accent={winningAuctions.length > 0 ? "text-cz-success" : "text-cz-1"} />
        <StatCard label={t("dashboard:stats.boardSatisfaction")} value={board ? `${board.satisfaction}%` : "—"} sub={board?.focus ? t(`dashboard:board.focus.${board.focus}`, { defaultValue: board.focus }) : t("dashboard:stats.noData")} accent={satisfactionColor} icon="◉" />
      </div>

      {/* Main grid */}
      <div className="grid lg:grid-cols-2 gap-4">

        {/* My auctions + winning */}
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-cz-1 text-sm">{t("dashboard:cards.auctions.title")}</h2>
            <Link to="/auctions" className="text-xs text-cz-accent-t hover:underline">{t("dashboard:cards.auctions.linkAll")}</Link>
          </div>
          {allAuctions.length === 0 ? (
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

        {/* Pending transfers + offers */}
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-cz-1 text-sm">{t("dashboard:cards.transfers.title")}</h2>
            <Link to="/transfers" className="text-xs text-cz-accent-t hover:underline">{t("dashboard:cards.transfers.linkAll")}</Link>
          </div>
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

        {/* Upcoming races */}
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-cz-1 text-sm">{t("dashboard:cards.races.title")}</h2>
            <Link to="/races" className="text-xs text-cz-accent-t hover:underline">{t("dashboard:cards.races.linkAll")}</Link>
          </div>
          {nextRaces.length === 0 ? (
            <p className="text-cz-3 text-sm text-center py-4">{t("dashboard:cards.races.empty")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {nextRaces.map((race, i) => (
                <div key={race.id}
                  className={`flex items-center justify-between py-2.5 ${i < nextRaces.length - 1 ? "border-b border-cz-border" : ""}`}>
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
                      <p className="text-cz-accent-t text-xs font-mono">{race.edition_year}-udgave</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* My division standings */}
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-cz-1 text-sm">{t("dashboard:cards.standings.title", { division: team?.division })}</h2>
            <Link to="/standings" className="text-xs text-cz-accent-t hover:underline">{t("dashboard:cards.standings.linkAll")}</Link>
          </div>
          {divStandings.length === 0 ? (
            <p className="text-cz-3 text-sm text-center py-4">{t("dashboard:cards.standings.empty")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {divStandings.map((s, i) => {
                const isMe = s.team_id === team?.id;
                const maxPts = divStandings[0]?.total_points || 1;
                return (
                  <div key={s.id} className={`flex items-center gap-3 py-1.5 ${isMe ? "bg-cz-accent/10 -mx-2 px-2 rounded-lg" : ""}`}>
                    <span className={`font-mono text-xs w-4 text-right flex-shrink-0 ${isMe ? "text-cz-accent-t" : "text-cz-3"}`}>#{i+1}</span>
                    <p className={`text-sm w-28 truncate flex-shrink-0 ${isMe ? "text-cz-accent-t font-medium" : "text-cz-2"}`}>{s.team?.name}</p>
                    <div className="flex-1">
                      <MiniBar value={s.total_points || 0} max={maxPts} color={isMe ? "rgb(var(--accent))" : "var(--text-3)"} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Board status */}
        <div className="bg-cz-card border border-cz-border rounded-xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-cz-1 text-sm">{t("dashboard:cards.board.title")}</h2>
            <Link to="/board" className="text-xs text-cz-accent-t hover:underline">{t("dashboard:cards.board.linkAll")}</Link>
          </div>
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
                  <p className="text-cz-1 text-sm font-medium">{boardOutlook.feedback.headline}</p>
                  <p className="text-cz-2 text-xs mt-1">{boardOutlook.feedback.summary}</p>
                  <div className="grid sm:grid-cols-4 gap-3 mt-3">
                    {Object.values(boardOutlook.score_breakdown?.categories || {}).map((category) => (
                      <div key={category.key} className="bg-cz-subtle rounded-lg p-3 border border-cz-border">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{category.label}</p>
                          <span className="text-cz-2 text-[10px] font-mono">{category.score_pct}%</span>
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

      </div>
    </div>
  );
}
