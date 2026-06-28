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
import {
  Tabs, TabList, Tab, TabPanel,
  Card, Button, Input, Select, ProgressMeter, PageLoader,
  ChevronRightIcon, XIcon,
} from "../components/ui";

const API = import.meta.env.VITE_API_URL;

const FINANCE_TABS = ["overview", "loans", "sponsors", "history"];

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
  const [prizeTotal, setPrizeTotal] = useState(0);
  const [prizeRows, setPrizeRows] = useState([]);
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
  // #986: valgt sæson i Historik-fanen (default = aktiv, eller ?season=).
  const [historySeasonId, setHistorySeasonId] = useState(null);
  const [loading, setLoading] = useState(true);
  // #1350: terminal error-state for initial load — uden den kunne en rejected
  // request efterlade en permanent spinner. Settle altid loading i finally.
  const [loadError, setLoadError] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "" });

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
    const [loanRes, forecastRes, txRes, prizeTxRes, leadingRes, proxiesRes, seasonsRes] = await Promise.all([
      fetch(`${API}/api/finance/loans`, { headers: authHeaders }),
      fetch(`${API}/api/me/finance-forecast`, { headers: authHeaders }),
      supabase.from("finance_transactions").select("*")
        .eq("team_id", teamData.id).order("created_at", { ascending: false }).limit(30),
      supabase.from("finance_transactions")
        .select("id, amount, race_id, description, created_at")
        .eq("team_id", teamData.id)
        .in("type", ["prize", "bonus"])
        .order("amount", { ascending: false }),
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

    // #1350: en Supabase-fejl returnerer { data: null, error } i stedet for at
    // reject — uden denne guard ville et fejlet transaktions-kald ligne et tomt
    // finans-overblik. Behandl det som en (retry-bar) load-fejl.
    if (txRes.error || prizeTxRes.error) {
      setLoadError(true);
      return;
    }

    const allSeasons = seasonsRes.data || [];
    setSeasons(allSeasons);
    const active = allSeasons.find((s) => s.status === "active");
    // Default Historik-sæson: behold eksisterende valg (loadAll kaldes igen efter
    // lån-handlinger), ellers ?season= hvis gyldig, ellers aktiv/seneste.
    const seasonParam = searchParams.get("season");
    setHistorySeasonId((prev) =>
      prev
        || (seasonParam && allSeasons.some((s) => s.id === seasonParam) ? seasonParam : null)
        || active?.id
        || allSeasons[0]?.id
        || null,
    );

    if (loanRes.ok) setLoanData(await loanRes.json());
    if (forecastRes.ok) {
      setForecast(await forecastRes.json());
    } else {
      setForecast(null);
    }
    setTransactions(txRes.data || []);

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

    const allPrizeTxs = prizeTxRes.data || [];
    setPrizeTotal(allPrizeTxs.reduce((s, r) => s + (r.amount || 0), 0));

    const raceIds = [...new Set(allPrizeTxs.map(r => r.race_id).filter(Boolean))];
    if (raceIds.length > 0) {
      const { data: raceNames } = await supabase.from("races").select("id, name").in("id", raceIds);
      const raceMap = Object.fromEntries((raceNames || []).map(r => [r.id, r.name]));
      setPrizeRows(allPrizeTxs.map(tx => ({ ...tx, raceName: raceMap[tx.race_id] || null })));
    } else {
      setPrizeRows(allPrizeTxs);
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

  function showMsg(text, type = "success") {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "" }), 5000);
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
        // #1012: lokaliseret engine-fejl-rendering (fx error.repayInsufficient
        // med { available }) via backendMessages; rå error-string er fallback.
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
            </Card>
            <Card className="col-span-2 md:col-span-1 p-5">
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("prize.label")}</p>
              <p className={`font-mono font-bold text-2xl ${prizeTotal > 0 ? "text-cz-success" : "text-cz-3"}`}>
                {prizeTotal > 0 ? "+" : ""}{formatNumber(prizeTotal)} CZ$
              </p>
              <p className="text-cz-3 text-xs mt-1">{t("prize.raceCount", { count: prizeRows.length })}</p>
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
          {prizeRows.length > 0 && (
            <Card className="p-5 mb-4">
              <h2 className="text-cz-1 font-semibold text-sm mb-3">{t("prizeList.title")}</h2>
              <div className="flex flex-col divide-y divide-cz-border">
                {/* #1131: løbsnavne fik 690+ dead clicks (Clarity 5/6-12/6) — spillere forventer
                    navigation. Hele rækken er ét klikmål til løbet når race_id findes. */}
                {prizeRows.map(tx => {
                  const rowInner = (
                    <>
                      <div className="flex-1 min-w-0 pe-3">
                        <p className="text-cz-2 text-xs font-medium truncate">
                          {tx.raceName || tx.description || t("prizeList.fallbackName")}
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

                      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
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

          {/* #1948: spiller-initierede lån er fjernet — nødlån gives automatisk
              ved sæsonstart hvis sponsor + saldo ikke kan dække løn/renter. */}
          <Card className="p-5 mb-4">
            <h2 className="text-cz-1 font-semibold text-sm mb-2">{t("loans.auto.title")}</h2>
            <p className="text-cz-3 text-sm leading-snug">{t("loans.auto.text")}</p>
          </Card>

          {/* Lånebetingelser */}
          {loanData?.configs?.length > 0 && (
            <Card className="p-5 mb-4">
              <h2 className="text-cz-1 font-semibold text-sm mb-3">
                {t("loans.terms.title", { division: team?.division })}
              </h2>
              <div className="overflow-x-auto rounded-cz border border-cz-border">
                <table className="w-full min-w-[480px] text-xs">
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
                    {loanData.configs.map(c => (
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
              <Select id="finance-history-season" size="sm" value={historySeasonId || ""}
                onChange={e => setHistorySeasonId(e.target.value)} className="w-auto">
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

          {historySeasonId && team?.id && (
            <div className="mb-4">
              <SeasonFinanceReportPanel seasonId={historySeasonId} teamId={team.id} />
            </div>
          )}

          {/* Transaktionshistorik (alle typer, seneste 30) */}
          <Card data-tour="finance-tx-history" className="p-5">
            <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("transactions.history.title")}</h2>
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
          </Card>
        </TabPanel>
      </Tabs>
    </div>
  );
}
