import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/intl";
import { renderBackendMessage } from "../lib/backendMessage";
import { resolveLegacyFinanceMessage } from "../lib/legacyFinanceMessage";
import FinanceFirstVisitHint from "../components/FinanceFirstVisitHint";
import FinanceForecastCard from "../components/FinanceForecastCard";
import OnboardingTour from "../components/OnboardingTour";
import { startTour } from "../lib/onboardingTour";
import { logEvent } from "../lib/logEvent";

const API = import.meta.env.VITE_API_URL;

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
  // "Vis mig rundt"-knap). Pegger på balance-grid, gældsloft og transaktionshistorik.
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
    {
      target: "[data-tour='finance-tx-history']",
      title: t("tour.txHistory.title"),
      body: t("tour.txHistory.body"),
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
  const [activeSeasonId, setActiveSeasonId] = useState(null);
  const [loading, setLoading] = useState(true);
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
    const { data: { user } } = await supabase.auth.getUser();
    const { data: teamData } = await supabase.from("teams")
      .select("id, name, balance, division").eq("user_id", user.id).single();
    if (!teamData) { setLoading(false); return; }
    setTeam(teamData);

    const { data: { session } } = await supabase.auth.getSession();
    const authHeaders = { Authorization: `Bearer ${session.access_token}` };
    const [loanRes, forecastRes, txRes, prizeTxRes, leadingRes, proxiesRes, seasonRes] = await Promise.all([
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
      // Slice 07h: aktiv sæson — bruges som default for "Sæsonsrapport"-link.
      supabase.from("seasons").select("id").eq("status", "active").order("number", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setActiveSeasonId(seasonRes?.data?.id || null);

    if (loanRes.ok) setLoanData(await loanRes.json());
    if (forecastRes.ok) {
      setForecast(await forecastRes.json());
    } else {
      setForecast(null);
    }
    setForecastLoading(false);
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

    setLoading(false);
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
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  const activeLoans = (loanData?.loans || []).filter(l => l.status === "active");
  const configs = (loanData?.configs || []).filter(c => c.loan_type !== "emergency");
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

      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("page.title")}</h1>
          <p className="text-cz-3 text-sm">{t("page.subtitle")}</p>
        </div>
        {activeSeasonId && team?.id && (
          <Link
            to={`/seasons/${activeSeasonId}/finance/${team.id}`}
            className="text-sm bg-cz-card border border-cz-border hover:border-cz-accent rounded-lg px-3 py-2 text-cz-2 hover:text-cz-1 transition-colors"
          >
            📊 {t("page.seasonReport")}
          </Link>
        )}
      </div>

      {msg.text && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border
          ${msg.type === "error"
            ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
            : "bg-cz-success-bg text-cz-success border-cz-success/30"}`}>
          {msg.text}
        </div>
      )}

      {showHint && <FinanceFirstVisitHint onDismiss={dismissHint} onStartTour={handleStartTour} />}

      {/* Balance + gæld + præmier */}
      <div data-tour="finance-balance" className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
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
        </div>
        <div data-tour="finance-debt-ceiling" className="bg-cz-card border border-cz-border rounded-xl p-5">
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
        </div>
        <div className="col-span-2 md:col-span-1 bg-cz-card border border-cz-border rounded-xl p-5">
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("prize.label")}</p>
          <p className={`font-mono font-bold text-2xl ${prizeTotal > 0 ? "text-cz-success" : "text-cz-3"}`}>
            {prizeTotal > 0 ? "+" : ""}{formatNumber(prizeTotal)} CZ$
          </p>
          <p className="text-cz-3 text-xs mt-1">{t("prize.raceCount", { count: prizeRows.length })}</p>
        </div>
      </div>

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
        <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
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
                  <span aria-hidden className="text-cz-3 group-hover:text-cz-2 text-base ms-2 flex-shrink-0 transition-colors">›</span>
                </Link>
              ) : (
                <div key={tx.id} className="flex items-center justify-between py-2">
                  {rowInner}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Aktive lån */}
      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
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
              return (
                <div key={loan.id} className="bg-cz-subtle rounded-xl border border-cz-border p-4">
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

                  {/* Progress bar */}
                  <div className="bg-cz-subtle rounded-full h-1.5 mb-3">
                    <div className="h-1.5 rounded-full bg-cz-danger/50 transition-all"
                      style={{ width: `${Math.min(100, Math.round((loan.amount_remaining / ((loan.principal || 1) + (loan.origination_fee || 0))) * 100))}%` }} />
                  </div>

                  {repayId === loan.id ? (
                    <div className="flex gap-2">
                      <input type="number" value={repayAmount}
                        onChange={e => setRepayAmount(e.target.value)}
                        placeholder={maxRepay > 0
                          ? t("loans.active.startRepayMaxPlaceholder", { value: formatNumber(maxRepay) })
                          : t("loans.active.repayPlaceholder")}
                        className="flex-1 bg-cz-subtle border border-cz-border rounded-lg px-3 py-1.5
                          text-cz-1 text-sm focus:outline-none focus:border-cz-accent" />
                      <button onClick={() => handleRepay(loan.id, repayAmount)}
                        disabled={repaying || !repayAmount || parseInt(repayAmount) < 1}
                        className="px-3 py-1.5 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-xs
                          hover:brightness-110 disabled:opacity-50">
                        {repaying ? t("loans.active.repayingBtn") : t("loans.active.repayBtn")}
                      </button>
                      <button onClick={() => { setRepayId(null); setRepayAmount(""); }}
                        aria-label={t("loans.active.cancelRepayAria")}
                        className="px-3 py-1.5 bg-cz-subtle text-cz-2 rounded-lg text-xs hover:bg-cz-subtle">
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setRepayId(loan.id); setRepayAmount(maxRepay > 0 ? maxRepay.toString() : ""); }}
                      disabled={maxRepay <= 0}
                      className="w-full py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg
                        text-xs hover:bg-cz-subtle hover:text-cz-1 transition-all disabled:opacity-30">
                      {t("loans.active.startRepay")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Optag lån */}
      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
        <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("loans.take.title")}</h2>
        {configs.length === 0 ? (
          <p className="text-cz-3 text-sm">{t("loans.take.noConfig", { division: team?.division })}</p>
        ) : (
          <form onSubmit={handleTakeLoan}>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-cz-3 text-xs mb-1">{t("loans.take.typeLabel")}</label>
                <select value={loanType} onChange={e => setLoanType(e.target.value)}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2
                    text-cz-1 text-sm focus:outline-none">
                  {configs.map(c => (
                    <option key={c.loan_type} value={c.loan_type}>{loanLabel(c.loan_type)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-cz-3 text-xs mb-1">{t("loans.take.amountLabel")}</label>
                <input type="number" required min={1} value={loanAmount}
                  onChange={e => setLoanAmount(e.target.value)}
                  placeholder={t("loans.take.amountPlaceholder")}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2
                    text-cz-1 text-sm focus:outline-none" />
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
                  <button type="button"
                    onClick={() => setLoanAmount(String(maxPrincipal))}
                    className="px-3 py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg
                      text-xs hover:text-cz-1 hover:border-cz-accent transition-all flex-shrink-0">
                    {t("loans.take.useMax")}
                  </button>
                </div>
              ) : (
                <p className="text-cz-danger text-xs -mt-2 mb-4 leading-snug">
                  {t("loans.take.maxZero", { ceiling: formatNumber(selectedConfig.debt_ceiling || 0) })}
                </p>
              )
            )}

            {selectedConfig && loanAmountNum > 0 && (
              <div className="bg-cz-subtle border border-cz-border rounded-lg p-3 mb-4">
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

            <button type="submit" disabled={takingLoan || !loanAmount || exceedsMax}
              className="w-full py-2.5 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm
                hover:brightness-110 disabled:opacity-50 transition-all">
              {takingLoan ? t("loans.take.processing") : t("loans.take.submit")}
            </button>
          </form>
        )}
      </div>

      {/* Lånebetingelser */}
      {loanData?.configs?.length > 0 && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
          <h2 className="text-cz-1 font-semibold text-sm mb-3">
            {t("loans.terms.title", { division: team?.division })}
          </h2>
          <div className="overflow-hidden rounded-lg border border-cz-border">
            <table className="w-full text-xs">
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
        </div>
      )}

      {/* Transaktionshistorik */}
      <div data-tour="finance-tx-history" className="bg-cz-card border border-cz-border rounded-xl p-5">
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
                  <span aria-hidden className="text-cz-3 group-hover:text-cz-2 text-base ms-2 flex-shrink-0 transition-colors">›</span>
                </Link>
              ) : (
                <div key={tx.id} className="flex items-center justify-between py-2.5">
                  {rowInner}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
