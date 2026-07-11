import { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/intl";
import { renderBackendMessage } from "../lib/backendMessage";
import { resolveLegacyFinanceMessage } from "../lib/legacyFinanceMessage";
import FinanceFirstVisitHint from "../components/FinanceFirstVisitHint";
import FinanceForecastCard from "../components/FinanceForecastCard";
import SeasonFinanceReportPanel from "../components/SeasonFinanceReportPanel";
import SponsorContractPanel from "../components/SponsorContractPanel";
import OnboardingTour from "../components/OnboardingTour";
import { startTour } from "../lib/onboardingTour";
import { logEvent } from "../lib/logEvent";
import { FINANCE_CATEGORIES, buildCategoryOrFilter } from "../lib/financeCategories";
import {
  Tabs, TabList, Tab, TabPanel,
  Card, Button, Input, Select, ProgressMeter, PageLoader,
  ChevronRightIcon, XIcon,
} from "../components/ui";

const API = import.meta.env.VITE_API_URL;

const FINANCE_TABS = ["overview", "loans", "sponsors", "history"];
// #2306: sentinel-værdi for "ingen sæson valgt" i Historik-fanens sæsonvælger —
// viser al historik uafhængig af sæson (default), i modsætning til `null`
// (loading-tilstand før sæsonlisten er hentet).
const ALL_SEASONS = "all";
const TX_PAGE_SIZE = 30;

function useTimeAgo(t) {
  return (d) => {
    if (!d) return t("timeAgo.unknown");
    const diff = new Date() - new Date(d);
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const day = Math.floor(diff / 86400000);
    if (m < 1) return t("timeAgo.now");
    if (m < 60) return t("timeAgo.minutes", { m });
    if (h < 24) return t("timeAgo.hours", { h });
    return t("timeAgo.days", { d: day });
  };
}

export default function FinancePage() {
  const { t } = useTranslation("finance");
  // #666: tx.metadata.{code,params} renderes via backendMessages-namespace.
  const { t: tBackend } = useTranslation("backendMessages");
  const timeAgo = useTimeAgo(t);

  // #986: faner (Overblik/Lån/Historik) synkroniseret til ?tab= så dyb-links
  // og repointede sæsonrapport-knapper lander rigtigt.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = FINANCE_TABS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "overview";
  const setTab = (tab) =>
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", tab);
      return p;
    }, { replace: true });

  const [loanData, setLoanData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [team, setTeam] = useState(null);
  // #2305: sæson-scoped præmie-resumé, server-beregnet via finance-report.
  const [prizeSummary, setPrizeSummary] = useState({ seasonNumber: null, total: 0, raceCount: 0, allTimeTotal: 0, rows: [] });
  const [reservedBalance, setReservedBalance] = useState(0);
  const [forecast, setForecast] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [seasonsAhead, setSeasonsAhead] = useState(1);

  // Onboarding v2 Slice 3 — tour-trin på /finance (aktiveres fra FinanceFirstVisitHint
  // "Vis mig rundt"-knap). #986: tour peger nu på Overblik-fanens elementer
  // (balance-grid + gældsloft); transaktionshistorik flyttede til Historik-fanen.
  const tourSteps = useMemo(() => [
    {
      target: "[data-tour='finance-balance']",
      title: t("tour.balance.title"),
      body: t("tour.balance.body"),
    },
    {
      target: "[data-tour='finance-debt-ceiling']",
      title: t("tour.debtCeiling.title"),
      body: t("tour.debtCeiling.body"),
    },
  ], [t]);

  useEffect(() => {
    if (!forecastLoading && forecast) logEvent("feature_finance_forecast_card_viewed");
  }, [forecastLoading, forecast]);

  async function refetchForecast(nextSeasonsAhead) {
    setForecastLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${API}/api/me/finance-forecast?seasonsAhead=${nextSeasonsAhead}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (res.ok) {
        setForecast(await res.json());
      }
    } finally {
      setForecastLoading(false);
    }
  }
  const [seasons, setSeasons] = useState([]);
  // #986/#2306: fælles sæson-vælger for Historik-fanen — styrer BÅDE
  // rapport-panelet OG transaktionslisten (issue #2306: vælgeren filtrerede
  // tidligere kun rapport-panelet, hvilket var forvirrende). Default = ALL_SEASONS
  // ("Alle") så listen viser al historik; rapport-panelet kræver en konkret
  // sæson og skjules når "Alle" er valgt.
  const [historySeasonId, setHistorySeasonId] = useState(ALL_SEASONS);
  // #2306: kategori-filter + range-based pagination for transaktionslisten.
  const [txCategory, setTxCategory] = useState("all");
  const [txPage, setTxPage] = useState(0);
  const [txHasMore, setTxHasMore] = useState(true);
  const [txLoadingMore, setTxLoadingMore] = useState(false);
  const [txError, setTxError] = useState(false);
  const [loading, setLoading] = useState(true);
  // #1350: terminal error-state for initial load — uden den kunne en rejected
  // request efterlade en permanent spinner. Settle altid loading i finally.
  const [loadError, setLoadError] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "" });

  // Optag lån
  const [loanType, setLoanType] = useState("short");
  const [loanAmount, setLoanAmount] = useState("");
  const [takingLoan, setTakingLoan] = useState(false);

  // Betal lån
  const [repayId, setRepayId] = useState(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [repaying, setRepaying] = useState(false);

  // Onboarding v2 Slice 3 — first-visit-hint, dismiss persisteres i localStorage
  const [showHint, setShowHint] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("cz-finance-hint-shown") !== "1",
  );

  function dismissHint() {
    try { localStorage.setItem("cz-finance-hint-shown", "1"); } catch { /* private browsing */ }
    setShowHint(false);
  }

  function handleStartTour() {
    startTour("finance");
    dismissHint();
  }

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setLoadError(false);
    try {
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (finally rydder loading)
    if (!user) { return; }
    const { data: teamData } = await supabase.from("teams")
      .select("id, name, balance, division").eq("user_id", user.id).single();
    if (!teamData) { return; }
    setTeam(teamData);

    const { data: { session } } = await supabase.auth.getSession();
    const authHeaders = { Authorization: `Bearer ${session.access_token}` };
    const [loanRes, forecastRes, leadingRes, proxiesRes, seasonsRes] = await Promise.all([
      fetch(`${API}/api/finance/loans`, { headers: authHeaders }),
      fetch(`${API}/api/me/finance-forecast`, { headers: authHeaders }),
      // #44: hent leading auktioner + proxies så vi kan vise reserveret balance
      supabase.from("auctions")
        .select("id, current_price")
        .in("status", ["active", "extended"])
        .eq("current_bidder_id", teamData.id),
      supabase.from("auction_proxy_bids")
        .select("auction_id, max_amount, auction:auction_id(status)")
        .eq("team_id", teamData.id),
      // #986: alle holdets sæsoner til Historik-fanens sæsonvælger (erstatter det
      // tidligere statiske "aktiv sæson"-opslag til sæsonrapport-linket).
      supabase.from("seasons").select("id, number, status").order("number", { ascending: false }),
    ]);

    const allSeasons = seasonsRes.data || [];
    setSeasons(allSeasons);
    const active = allSeasons.find((s) => s.status === "active");
    // Default Historik-sæson: behold eksisterende valg (loadAll kaldes igen efter
    // lån-handlinger), ellers ?season= hvis gyldig, ellers ALL_SEASONS (#2306:
    // "Alle" er default så transaktionslisten viser alt uden en ekstra klik).
    const seasonParam = searchParams.get("season");
    setHistorySeasonId((prev) =>
      (prev && prev !== ALL_SEASONS ? prev : null)
        || (seasonParam && allSeasons.some((s) => s.id === seasonParam) ? seasonParam : null)
        || ALL_SEASONS,
    );

    if (loanRes.ok) setLoanData(await loanRes.json());
    if (forecastRes.ok) {
      setForecast(await forecastRes.json());
    } else {
      setForecast(null);
    }
    // #44: worst-case commitment = MAX(current_price, my_proxy_max) for leading
    // + my_proxy_max for ikke-leading auktioner.
    const leadingMap = new Map();
    for (const a of leadingRes.data || []) leadingMap.set(a.id, a.current_price || 0);
    const proxyMap = new Map();
    for (const p of proxiesRes.data || []) {
      if (["active", "extended"].includes(p.auction?.status)) {
        proxyMap.set(p.auction_id, p.max_amount || 0);
      }
    }
    let reserved = 0;
    const seen = new Set();
    for (const [auctionId, currentPrice] of leadingMap) {
      reserved += Math.max(currentPrice, proxyMap.get(auctionId) || 0);
      seen.add(auctionId);
    }
    for (const [auctionId, proxyMax] of proxyMap) {
      if (!seen.has(auctionId)) reserved += proxyMax;
    }
    setReservedBalance(reserved);

    // #2305: præmie-kortet er sæson-scoped og server-beregnet. Genbruger
    // finance-report-endpointets prizes-blok (season-sum + antal løb + all-time)
    // i stedet for den tidligere ubegrænsede klient-side prize-query.
    const prizeSeason = active || allSeasons[0] || null;
    if (prizeSeason) {
      const reportRes = await fetch(
        `${API}/api/teams/${teamData.id}/finance-report?seasonId=${prizeSeason.id}`,
        { headers: authHeaders },
      );
      if (!reportRes.ok) {
        setLoadError(true);
        return;
      }
      const report = await reportRes.json();
      const prizes = report.prizes || { season_total: 0, race_count: 0, all_time_total: 0, rows: [] };
      setPrizeSummary({
        seasonNumber: prizeSeason.number,
        total: prizes.season_total || 0,
        raceCount: prizes.race_count || 0,
        allTimeTotal: prizes.all_time_total || 0,
        rows: prizes.rows || [],
      });
    }
    } catch (e) {
      // #1350: rejected request (netværk/auth) — vis retry-bar fejl i stedet for
      // at lade spinneren hænge for evigt.
      console.error("FinancePage loadAll failed", e);
      setLoadError(true);
    } finally {
      setForecastLoading(false);
      setLoading(false);
    }
  }

  // #2306: transaktionslistens fetch er adskilt fra loadAll så sæson-/kategori-
  // filter + "vis flere"-pagination kan genkøre uden at re-hente hele resten af
  // Finance-siden (lån, forecast, præmie-kort m.v.).
  async function fetchTxPage(page, append) {
    if (!team?.id) return;
    if (append) setTxLoadingMore(true);
    try {
      let query = supabase.from("finance_transactions").select("*")
        .eq("team_id", team.id);
      if (historySeasonId && historySeasonId !== ALL_SEASONS) query = query.eq("season_id", historySeasonId);
      if (txCategory !== "all") {
        const orFilter = buildCategoryOrFilter(txCategory);
        if (orFilter) query = query.or(orFilter);
      }
      const from = page * TX_PAGE_SIZE;
      const to = from + TX_PAGE_SIZE - 1;
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(from, to);
      // #1350-mønster: en Supabase-fejl returnerer { data: null, error } i
      // stedet for at reject — behandl som (retry-bar) fejl, aldrig tavst [].
      if (error) throw error;
      const rows = data || [];
      setTransactions((prev) => (append ? [...prev, ...rows] : rows));
      setTxHasMore(rows.length === TX_PAGE_SIZE);
      setTxError(false);
      setTxPage(page);
    } catch (e) {
      console.error("FinancePage fetchTxPage failed", e);
      setTxError(true);
    } finally {
      if (append) setTxLoadingMore(false);
    }
  }

  // Nulstil til side 0 når team er klar, eller sæson-/kategori-filteret ændres.
  useEffect(() => {
    if (!team?.id) return;
    fetchTxPage(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, historySeasonId, txCategory]);

  function loadMoreTransactions() {
    fetchTxPage(txPage + 1, true);
  }

  function showMsg(text, type = "success") {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "" }), 5000);
  }

  async function handleTakeLoan(e) {
    e.preventDefault();
    if (!loanAmount || parseInt(loanAmount) < 1) return;
    setTakingLoan(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/finance/loans`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ loan_type: loanType, amount: parseInt(loanAmount) }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        showMsg(t("msg.loanCreated", { amount: formatNumber(parseInt(loanAmount)) }));
        setLoanAmount("");
        loadAll();
      } else {
        // #1012: strukturerede engine-fejl (error.debtCapReached m.fl.) renderes
        // lokaliseret via backendMessages; rå error-string er fallback.
        const errText = result.errorCode
          ? renderBackendMessage({ code: result.errorCode, params: result.errorParams }, tBackend, result.error)
          : result.error;
        showMsg(`${t("msg.errorPrefix")}${errText}`, "error");
      }
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    } finally {
      setTakingLoan(false);
    }
  }

  async function handleRepay(loanId, amount) {
    if (!amount || parseInt(amount) < 1) return;
    setRepaying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/finance/loans/${loanId}/repay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ amount: parseInt(amount) }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        showMsg(result.paid_off
          ? t("msg.loanRepaidFull")
          : t("msg.loanRepaidPartial", {
              paid: formatNumber(result.paid ?? 0),
              remaining: formatNumber(result.remaining ?? 0),
            }));
        setRepayId(null);
        setRepayAmount("");
        loadAll();
      } else {
        // #1012: samme lokaliserede fejl-rendering som handleTakeLoan
        // (fx error.repayInsufficient med { available }).
        const errText = result.errorCode
          ? renderBackendMessage({ code: result.errorCode, params: result.errorParams }, tBackend, result.error)
          : result.error;
        showMsg(`${t("msg.errorPrefix")}${errText}`, "error");
      }
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    } finally {
      setRepaying(false);
    }
  }

  if (loading) return (
    <PageLoader label={t("page.loadingAria")} />
  );

  // #1350: terminal, retry-bar fejl ved fejlet initial load — aldrig en evig
  // spinner og aldrig en tom-state der ligner "ingen finansdata".
  if (loadError) return (
    <div className="max-w-3xl mx-auto py-16">
      <div className="bg-cz-danger-bg border border-cz-danger/30 rounded-cz p-4 flex items-center justify-between gap-3"
        role="alert">
        <p className="text-cz-danger text-sm">{t("loadError.message")}</p>
        <Button variant="secondary" size="sm" onClick={loadAll}>{t("loadError.retry")}</Button>
      </div>
    </div>
  );

  const activeLoans = (loanData?.loans || []).filter(l => l.status === "active");
  // #2304: total livstids-akkumuleret rente på tværs af aktive lån (gældskort-synlighed).
  const totalAccruedInterest = activeLoans.reduce((sum, l) => sum + (l.accrued_interest || 0), 0);
  // #1948: vis kun spiller-takbare lån (kort/langt). 'reset' (rentefrit, admin-givet til
  // minus-spillere efter præmie-fjernelse) og 'emergency' (auto-nødlån) må aldrig kunne
  // vælges eller optages af spillere — backend afviser dem også, dette skjuler dem i UI.
  const configs = (loanData?.configs || []).filter(c => c.loan_type === "short" || c.loan_type === "long");
  const selectedConfig = configs.find(c => c.loan_type === loanType);
  const loanAmountNum = parseInt(loanAmount) || 0;
  // #1012: max_principal/max_fee/max_total_debt kommer fra backend (samme formel
  // som serverens loft-validering — ingen klient-kopi der kan drifte).
  const maxPrincipal = selectedConfig?.max_principal ?? null;
  const exceedsMax = maxPrincipal != null && loanAmountNum > maxPrincipal;
  const debtHeadroom = loanData?.debt_ceiling != null
    ? Math.max(0, loanData.debt_ceiling - (loanData?.total_debt || 0))
    : null;
  const loanLabel = (type) => t(`loans.types.${type}`, { defaultValue: type });
  const txLabel = (type) => t(`transactions.type.${type}`, { defaultValue: type });

  return (
    <div className="max-w-3xl mx-auto">
      <OnboardingTour pageKey="finance" steps={tourSteps} />

      <div className="mb-5">
        <h1 className="text-xl font-bold text-cz-1">{t("page.title")}</h1>
        <p className="text-cz-3 text-sm">{t("page.subtitle")}</p>
      </div>

      {msg.text && (
        // #1349 (WCAG 4.1.3): mutation-feedback annonceres til skærmlæsere.
        // Fejl = assertiv (role=alert), succes = høflig (role=status/aria-live).
        <div
          role={msg.type === "error" ? "alert" : "status"}
          aria-live={msg.type === "error" ? "assertive" : "polite"}
          className={`mb-4 px-4 py-3 rounded-cz text-sm border
          ${msg.type === "error"
            ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
            : "bg-cz-success-bg text-cz-success border-cz-success/30"}`}>
          {msg.text}
        </div>
      )}

      {showHint && <FinanceFirstVisitHint onDismiss={dismissHint} onStartTour={handleStartTour} />}

      <Tabs value={activeTab} onChange={setTab} className="mt-1">
        <TabList label={t("page.title")} className="mb-4">
          <Tab value="overview">{t("tabs.overview")}</Tab>
          <Tab value="loans">{t("tabs.loans")}</Tab>
          <Tab value="sponsors">{t("tabs.sponsors")}</Tab>
          <Tab value="history">{t("tabs.history")}</Tab>
        </TabList>

        {/* ───────────────────────────── Overblik ───────────────────────────── */}
        <TabPanel value="overview">
          {/* Balance + gæld + præmier */}
          <div data-tour="finance-balance" className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <Card className="p-5">
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("balance.label")}</p>
              <p className={`font-mono font-bold text-2xl ${(team?.balance || 0) >= 0 ? "text-cz-accent-t" : "text-cz-danger"}`}>
                {formatNumber(team?.balance || 0)} CZ$
              </p>
              <p className="text-cz-3 text-xs mt-1">{t("balance.division", { division: team?.division })}</p>
              {reservedBalance > 0 && (
                <p className="text-cz-3 text-xs mt-2 leading-snug">
                  {t("balance.available", { value: formatNumber(Math.max(0, (team?.balance || 0) - reservedBalance)) })}<br />
                  <span className="text-cz-3/70">{t("balance.lockedInBids", { value: formatNumber(reservedBalance) })}</span>
                </p>
              )}
            </Card>
            <Card data-tour="finance-debt-ceiling" className="p-5">
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("debt.label")}</p>
              <p className={`font-mono font-bold text-2xl ${(loanData?.total_debt || 0) > 0 ? "text-cz-danger" : "text-cz-3"}`}>
                {formatNumber(loanData?.total_debt || 0)} CZ$
              </p>
              {loanData?.debt_ceiling && (
                <p className="text-cz-3 text-xs mt-1">
                  {t("debt.ceiling", { value: formatNumber(loanData.debt_ceiling) })}
                </p>
              )}
              {debtHeadroom != null && (
                <p className="text-cz-3 text-xs mt-2 leading-snug">
                  {t("debt.headroom", { value: formatNumber(debtHeadroom) })}
                </p>
              )}
              {/* #2304: total livstids-akkumuleret rente på tværs af aktive lån —
                  synlighed for at et lån man ikke afdrager bliver dyrere. */}
              {totalAccruedInterest > 0 && (
                <p className="text-cz-warning text-xs mt-1">
                  {t("debt.accruedInterest", { value: formatNumber(totalAccruedInterest) })}
                </p>
              )}
            </Card>
            <Card className="col-span-2 md:col-span-1 p-5">
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">
                {prizeSummary.seasonNumber != null
                  ? t("prize.label", { season: prizeSummary.seasonNumber })
                  : t("prize.labelNoSeason")}
              </p>
              <p className={`font-mono font-bold text-2xl ${prizeSummary.total > 0 ? "text-cz-success" : "text-cz-3"}`}>
                {prizeSummary.total > 0 ? "+" : ""}{formatNumber(prizeSummary.total)} CZ$
              </p>
              <p className="text-cz-3 text-xs mt-1">{t("prize.raceCount", { count: prizeSummary.raceCount })}</p>
              <p className="text-cz-3 text-xs mt-1">{t("prize.allSeasons", { amount: formatNumber(prizeSummary.allTimeTotal) })}</p>
            </Card>
          </div>

          {/* #986: én-linjes lån-resumé — fuld lån-administration på Lån-fanen */}
          <Card className="p-4 mb-4 flex items-center justify-between gap-3">
            <p className="text-cz-2 text-sm">
              {activeLoans.length === 0
                ? t("loanSummary.none")
                : `${t("loanSummary.active", { count: activeLoans.length })} · ${t("loanSummary.owed", { value: formatNumber(loanData?.total_debt || 0) })}`}
            </p>
            {activeLoans.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setTab("loans")}>{t("loanSummary.view")}</Button>
            )}
          </Card>

          {/* Slice 07g · Næste sæsons forecast + risk-tier */}
          <FinanceForecastCard
            forecast={forecast}
            loading={forecastLoading}
            seasonsAhead={seasonsAhead}
            onSeasonsAheadChange={(value) => {
              setSeasonsAhead(value);
              refetchForecast(value);
            }}
          />

          {/* Løbspræmier */}
          {prizeSummary.rows.length > 0 && (
            <Card className="p-5 mb-4">
              <h2 className="text-cz-1 font-semibold text-sm mb-3">{t("prizeList.title")}</h2>
              <div className="flex flex-col divide-y divide-cz-border">
                {/* #1131: løbsnavne fik 690+ dead clicks (Clarity 5/6-12/6) — spillere forventer
                    navigation. Hele rækken er ét klikmål til løbet når race_id findes. */}
                {prizeSummary.rows.map(tx => {
                  const rowInner = (
                    <>
                      <div className="flex-1 min-w-0 pe-3">
                        <p className="text-cz-2 text-xs font-medium truncate">
                          {tx.race_name || tx.description || t("prizeList.fallbackName")}
                        </p>
                        <p className="text-cz-3 text-xs mt-0.5">{timeAgo(tx.created_at)}</p>
                      </div>
                      <p className="font-mono text-sm font-bold text-cz-success flex-shrink-0">
                        +{formatNumber(tx.amount || 0)} CZ$
                      </p>
                    </>
                  );
                  return tx.race_id ? (
                    <Link key={tx.id} to={`/races/${tx.race_id}`} title={t("prizeList.viewRace")}
                      className="flex items-center justify-between py-2 group hover:bg-cz-subtle/60 transition-colors">
                      {rowInner}
                      <ChevronRightIcon size={16} aria-hidden className="text-cz-3 group-hover:text-cz-2 ms-2 flex-shrink-0 transition-colors" />
                    </Link>
                  ) : (
                    <div key={tx.id} className="flex items-center justify-between py-2">
                      {rowInner}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </TabPanel>

        {/* ───────────────────────────── Lån ───────────────────────────── */}
        <TabPanel value="loans">
          {/* Aktive lån */}
          <Card className="p-5 mb-4">
            <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("loans.active.title")}</h2>
            {activeLoans.length === 0 ? (
              <p className="text-cz-3 text-sm">{t("loans.active.empty")}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {activeLoans.map(loan => {
                  // #44: maxRepay = MIN(available_balance, amount_remaining). Penge låst i
                  // bud kan ikke bruges til at betale gæld (ellers ville auktioner kunne
                  // gå i minus ved finalization).
                  const availableBalance = Math.max(0, (team?.balance || 0) - reservedBalance);
                  const maxRepay = Math.min(availableBalance, loan.amount_remaining);
                  const repayPct = Math.min(100, Math.round((loan.amount_remaining / ((loan.principal || 1) + (loan.origination_fee || 0))) * 100));
                  return (
                    <Card key={loan.id} className="bg-cz-subtle p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-cz-1 font-medium text-sm">
                            {loanLabel(loan.loan_type)}
                          </p>
                          <p className="text-cz-3 text-xs mt-0.5">{t("loans.active.createdAt", { when: timeAgo(loan.created_at) })}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-cz-danger font-mono font-bold text-sm">
                            {formatNumber(loan.amount_remaining || 0)} CZ$
                          </p>
                          <p className="text-cz-3 text-xs">{t("loans.active.remaining")}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 mb-3 text-center">
                        <div>
                          <p className="text-cz-2 font-mono text-xs">{formatNumber(loan.principal || 0)}</p>
                          <p className="text-cz-3 text-xs">{t("loans.active.principal")}</p>
                        </div>
                        <div>
                          <p className="text-cz-2 font-mono text-xs">{(loan.interest_rate * 100).toFixed(0)}%</p>
                          <p className="text-cz-3 text-xs">{t("loans.active.interestPerSeason")}</p>
                        </div>
                        <div>
                          <p className="text-cz-2 font-mono text-xs">{loan.seasons_remaining}</p>
                          <p className="text-cz-3 text-xs">{t("loans.active.seasonsRemaining")}</p>
                        </div>
                        {/* #2304: livstids-akkumuleret rente, synlig så spilleren ser at et
                            lån man ikke afdrager bliver dyrere. */}
                        <div>
                          <p className="text-cz-warning font-mono text-xs">{formatNumber(loan.accrued_interest || 0)}</p>
                          <p className="text-cz-3 text-xs">{t("loans.active.accruedInterest")}</p>
                        </div>
                      </div>

                      {/* Progress bar — andel restgæld */}
                      <div className="mb-3">
                        <ProgressMeter value={repayPct} tone="danger" ariaLabel={t("loans.active.remaining")} />
                      </div>

                      {repayId === loan.id ? (
                        <div className="flex gap-2">
                          <Input type="number" value={repayAmount}
                            onChange={e => setRepayAmount(e.target.value)}
                            placeholder={maxRepay > 0
                              ? t("loans.active.startRepayMaxPlaceholder", { value: formatNumber(maxRepay) })
                              : t("loans.active.repayPlaceholder")}
                            size="sm" className="flex-1" />
                          <Button variant="primary" size="sm" onClick={() => handleRepay(loan.id, repayAmount)}
                            disabled={repaying || !repayAmount || parseInt(repayAmount) < 1}>
                            {repaying ? t("loans.active.repayingBtn") : t("loans.active.repayBtn")}
                          </Button>
                          <Button variant="ghost" size="sm"
                            onClick={() => { setRepayId(null); setRepayAmount(""); }}
                            aria-label={t("loans.active.cancelRepayAria")}>
                            <XIcon size={14} aria-hidden />
                          </Button>
                        </div>
                      ) : (
                        <Button variant="secondary" size="sm" fullWidth
                          onClick={() => { setRepayId(loan.id); setRepayAmount(maxRepay > 0 ? maxRepay.toString() : ""); }}
                          disabled={maxRepay <= 0}>
                          {t("loans.active.startRepay")}
                        </Button>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Optag lån */}
          <Card className="p-5 mb-4">
            <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("loans.take.title")}</h2>
            {configs.length === 0 ? (
              <p className="text-cz-3 text-sm">{t("loans.take.noConfig", { division: team?.division })}</p>
            ) : (
              <form onSubmit={handleTakeLoan}>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-cz-3 text-xs mb-1">{t("loans.take.typeLabel")}</label>
                    <Select value={loanType} onChange={e => setLoanType(e.target.value)} className="w-full">
                      {configs.map(c => (
                        <option key={c.loan_type} value={c.loan_type}>{loanLabel(c.loan_type)}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="block text-cz-3 text-xs mb-1">{t("loans.take.amountLabel")}</label>
                    <Input type="number" required min={1} value={loanAmount}
                      onChange={e => setLoanAmount(e.target.value)}
                      placeholder={t("loans.take.amountPlaceholder")}
                      className="w-full" />
                  </div>
                </div>

                {/* #1012: max lånbart lige nu (gebyr-inkl.) — tal fra serverens egen formel */}
                {maxPrincipal != null && (
                  maxPrincipal > 0 ? (
                    <div className="flex items-center justify-between gap-2 -mt-2 mb-4">
                      <p className="text-cz-3 text-xs leading-snug">
                        {t("loans.take.maxBorrowable", { value: formatNumber(maxPrincipal) })}
                        <br />
                        <span className="text-cz-3/70">
                          {t("loans.take.maxBorrowableDetail", {
                            fee: formatNumber(selectedConfig.max_fee || 0),
                            total: formatNumber(selectedConfig.max_total_debt || 0),
                            ceiling: formatNumber(selectedConfig.debt_ceiling || 0),
                          })}
                        </span>
                      </p>
                      <Button type="button" variant="secondary" size="sm"
                        onClick={() => setLoanAmount(String(maxPrincipal))}
                        className="flex-shrink-0">
                        {t("loans.take.useMax")}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-cz-danger text-xs -mt-2 mb-4 leading-snug">
                      {t("loans.take.maxZero", { ceiling: formatNumber(selectedConfig.debt_ceiling || 0) })}
                    </p>
                  )
                )}

                {selectedConfig && loanAmountNum > 0 && (
                  <div className="bg-cz-subtle border border-cz-border rounded-cz p-3 mb-4">
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div>
                        <p className="text-cz-3">{t("loans.take.feeLabel", { pct: (selectedConfig.origination_fee_pct * 100).toFixed(0) })}</p>
                        <p className="text-cz-2 font-mono mt-0.5">
                          {t("loans.take.feeValue", { value: formatNumber(Math.round(loanAmountNum * selectedConfig.origination_fee_pct)) })}
                        </p>
                      </div>
                      <div>
                        <p className="text-cz-3">{t("loans.take.interestLabel")}</p>
                        <p className="text-cz-2 font-mono mt-0.5">{t("loans.take.interestValue", { pct: (selectedConfig.interest_rate_pct * 100).toFixed(0) })}</p>
                      </div>
                      <div>
                        <p className="text-cz-3">{t("loans.take.totalLabel")}</p>
                        <p className="text-cz-accent-t font-mono mt-0.5">
                          {t("loans.take.totalValue", { value: formatNumber(loanAmountNum + Math.round(loanAmountNum * selectedConfig.origination_fee_pct)) })}
                        </p>
                      </div>
                    </div>
                    {exceedsMax && (
                      <p className="text-cz-danger text-xs mt-2 text-center leading-snug">
                        {t("loans.take.exceedsMax", { value: formatNumber(maxPrincipal) })}
                      </p>
                    )}
                  </div>
                )}

                <Button type="submit" variant="primary" fullWidth
                  disabled={takingLoan || !loanAmount || exceedsMax}>
                  {takingLoan ? t("loans.take.processing") : t("loans.take.submit")}
                </Button>
              </form>
            )}
          </Card>

          {/* Lånebetingelser — kun spiller-takbare typer (kort/langt), jf. #1948 */}
          {configs.length > 0 && (
            <Card className="p-5 mb-4">
              <h2 className="text-cz-1 font-semibold text-sm mb-3">
                {t("loans.terms.title", { division: team?.division })}
              </h2>
              <div className="overflow-x-auto rounded-cz border border-cz-border">
                <table data-sort-exempt="Fast laane-vilkaar opslag, 2 raekker" className="w-full min-w-[480px] text-xs">
                  <thead>
                    <tr className="border-b border-cz-border">
                      <th className="px-3 py-2 text-start text-cz-3">{t("loans.terms.headers.type")}</th>
                      <th className="px-3 py-2 text-end text-cz-3">{t("loans.terms.headers.fee")}</th>
                      <th className="px-3 py-2 text-end text-cz-3">{t("loans.terms.headers.interest")}</th>
                      <th className="px-3 py-2 text-end text-cz-3">{t("loans.terms.headers.seasons")}</th>
                      <th className="px-3 py-2 text-end text-cz-3">{t("loans.terms.headers.debtCeiling")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {configs.map(c => (
                      <tr key={`${c.division}-${c.loan_type}`} className="border-b border-cz-border">
                        <td className="px-3 py-2 text-cz-1 font-medium">{loanLabel(c.loan_type)}</td>
                        <td className="px-3 py-2 text-end text-cz-2">{(c.origination_fee_pct * 100).toFixed(0)}%</td>
                        <td className="px-3 py-2 text-end text-cz-2">{(c.interest_rate_pct * 100).toFixed(0)}%</td>
                        <td className="px-3 py-2 text-end text-cz-2">{c.seasons}</td>
                        <td className="px-3 py-2 text-end text-cz-accent-t font-mono">
                          {formatNumber(c.debt_ceiling || 0)} CZ$
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabPanel>

        {/* ───────────────────────────── Sponsor ───────────────────────────── */}
        <TabPanel value="sponsors">
          <SponsorContractPanel />
        </TabPanel>

        {/* ───────────────────────────── Historik ───────────────────────────── */}
        <TabPanel value="history">
          {seasons.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <label htmlFor="finance-history-season" className="text-cz-3 text-xs">{t("history.seasonPicker")}</label>
              {/* #2306: vælgeren filtrerer nu BÅDE rapport-panelet OG
                  transaktionslisten nedenunder — "Alle" (default) viser al
                  historik uden sæson-filter. */}
              <Select id="finance-history-season" size="sm" value={historySeasonId}
                onChange={e => setHistorySeasonId(e.target.value)} className="w-auto">
                <option value={ALL_SEASONS}>{t("history.allSeasons")}</option>
                {seasons.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.status === "active"
                      ? t("history.optionActive", { number: s.number })
                      : t("history.option", { number: s.number })}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {historySeasonId && historySeasonId !== ALL_SEASONS && team?.id && (
            <div className="mb-4">
              <SeasonFinanceReportPanel seasonId={historySeasonId} teamId={team.id} />
            </div>
          )}

          {/* Transaktionshistorik — sæson- og kategori-filtreret, range-based
              "vis flere"-pagination (#2306). */}
          <Card data-tour="finance-tx-history" className="p-5">
            <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("transactions.history.title")}</h2>

            {/* Kategori-chips */}
            <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label={t("history.categoryFilterAria")}>
              {["all", ...FINANCE_CATEGORIES].map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setTxCategory(cat)}
                  aria-pressed={txCategory === cat}
                  className={`min-h-[32px] px-3 py-1 rounded-cz text-xs font-medium border transition-colors
                    ${txCategory === cat
                      ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                      : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}
                >
                  {t(`history.category.${cat}`)}
                </button>
              ))}
            </div>

            {txError && (
              <div role="alert"
                className="mb-4 bg-cz-danger-bg border border-cz-danger/30 rounded-cz p-3 flex items-center justify-between gap-3">
                <p className="text-cz-danger text-xs">{t("history.txLoadError")}</p>
                <Button variant="secondary" size="sm" onClick={() => fetchTxPage(0, false)}>
                  {t("loadError.retry")}
                </Button>
              </div>
            )}

            {transactions.length === 0 ? (
              <p className="text-cz-3 text-sm">{t("transactions.history.empty")}</p>
            ) : (
              <div className="flex flex-col divide-y divide-cz-border">
                {transactions.map(tx => {
                  const rowInner = (
                    <>
                      <div className="flex-1 min-w-0 pe-3">
                        <p className="text-cz-2 text-xs truncate">{(() => {
                          const resolved = resolveLegacyFinanceMessage(tx);
                          if (resolved.code) {
                            return renderBackendMessage(resolved, tBackend, txLabel(tx.type));
                          }
                          if (resolved.typeKey) {
                            return t(resolved.typeKey, { defaultValue: txLabel(tx.type) });
                          }
                          return resolved.fallback || txLabel(tx.type);
                        })()}</p>
                        {/* #2326: rente/hovedstol-split på repayment-poster — vises kun
                            når metadata'en findes (gamle poster har den ikke). */}
                        {tx.metadata?.interest_paid != null && tx.metadata?.principal_paid != null && (
                          <p className="text-cz-3 text-xs mt-0.5">
                            {t("history.interestSplit", {
                              interest: formatNumber(tx.metadata.interest_paid),
                              principal: formatNumber(tx.metadata.principal_paid),
                            })}
                          </p>
                        )}
                        <p className="text-cz-3 text-xs mt-0.5">{timeAgo(tx.created_at)}</p>
                      </div>
                      <p className={`font-mono text-sm font-bold flex-shrink-0 ${tx.amount >= 0 ? "text-cz-success" : "text-cz-danger"}`}>
                        {tx.amount >= 0 ? "+" : ""}{formatNumber(tx.amount || 0)} CZ$
                      </p>
                    </>
                  );
                  // #1131: samme klikmål-mønster som løbspræmie-listen — transaktioner
                  // med et tilknyttet løb navigerer til løbet.
                  return tx.race_id ? (
                    <Link key={tx.id} to={`/races/${tx.race_id}`} title={t("prizeList.viewRace")}
                      className="flex items-center justify-between py-2.5 group hover:bg-cz-subtle/60 transition-colors">
                      {rowInner}
                      <ChevronRightIcon size={16} aria-hidden className="text-cz-3 group-hover:text-cz-2 ms-2 flex-shrink-0 transition-colors" />
                    </Link>
                  ) : (
                    <div key={tx.id} className="flex items-center justify-between py-2.5">
                      {rowInner}
                    </div>
                  );
                })}
              </div>
            )}

            {txHasMore && transactions.length > 0 && (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" size="sm" onClick={loadMoreTransactions} disabled={txLoadingMore}>
                  {txLoadingMore ? t("history.loadingMore") : t("history.loadMore")}
                </Button>
              </div>
            )}
          </Card>
        </TabPanel>
      </Tabs>
    </div>
  );
}
