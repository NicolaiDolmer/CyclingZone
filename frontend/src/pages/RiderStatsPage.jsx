import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { getCountryName } from "../lib/countryUtils";
import { Flag } from "../components/Flag";
import { formatCz, getRiderMarketValue } from "../lib/marketValues";
import { statColor } from "../lib/statColor";
import { formatNumber, formatDate, formatDateTime } from "../lib/intl";
import PotentialeStars from "../components/PotentialeStars";
import { BidConfirmModal } from "../components/BidConfirmModal";
import { RacePriceModal } from "../components/RacePriceModal";
import { ConfettiModal } from "../components/ConfettiModal";
import OverbidToast from "../components/OverbidToast";
import {
  isManagerSeller,
  getAuctionLeaderId,
  getAuctionLeaderName,
  getAuctionSellerLabel,
} from "../lib/auctionLogic";
import { useAuctionBidding } from "../lib/useAuctionBidding";
import { isOverbidEvent, shouldFlashPrice } from "../lib/auctionsRealtime";
import { logEvent } from "../lib/logEvent";
import TeamLink from "../components/TeamLink";
import { aggregateRiderSeasons } from "../lib/riderSeasonStats";

const API = import.meta.env.VITE_API_URL;
const RiderDevelopmentTab = lazy(() => import("../components/RiderDevelopmentTab"));

// Hent ALLE en rytters race_results (lette kolonner) til sæson-aggregeringen.
// Pagineret fordi PostgREST capper ved 1000 rækker/side — uden det ville en
// rytter med mange resultater få trunkerede sejrs-/præmie-totaler.
async function fetchAllRiderSeasonRows(riderId) {
  const PAGE = 1000;
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("race_results")
      .select("rank, prize_money, result_type, race:race_id(race_type, season:season_id(number))")
      .eq("rider_id", riderId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

// Skill-rows konstanteres med en stabil i18n-`slug` der mapper til `rider.skills.<slug>.short/long`.
// `key` er DB-kolonnen (stat_fl ...), `icon` er ASCII/unicode-symbolet vi viser foran labelen.
// Holder samme rækkefølge som tidligere så bestStat/typeLabel-arithmetic ikke ændres.
const STATS = [
  { key: "stat_fl",  slug: "fl",  icon: "═" },
  { key: "stat_bj",  slug: "bj",  icon: "▲" },
  { key: "stat_kb",  slug: "kb",  icon: "△" },
  { key: "stat_bk",  slug: "bk",  icon: "∧" },
  { key: "stat_tt",  slug: "tt",  icon: "⏱" },
  { key: "stat_prl", slug: "prl", icon: "◷" },
  { key: "stat_bro", slug: "bro", icon: "⬡" },
  { key: "stat_sp",  slug: "sp",  icon: "⚡" },
  { key: "stat_acc", slug: "acc", icon: "▶" },
  { key: "stat_ned", slug: "ned", icon: "↓" },
  { key: "stat_udh", slug: "udh", icon: "◎" },
  { key: "stat_mod", slug: "mod", icon: "◈" },
  { key: "stat_res", slug: "res", icon: "↺" },
  { key: "stat_ftr", slug: "ftr", icon: "★" },
];

function buildSkillsLocalized(t) {
  return STATS.map(s => ({ ...s, label: t(`skills.${s.slug}.long`) }));
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
}

function StatRow({ label, icon, value }) {
  const pct = Math.round(((value || 0) / 99) * 100);
  const color = statColor(value);
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-cz-3 w-4 text-center text-sm">{icon}</span>
      <span className="text-cz-2 text-sm w-28 sm:w-36 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-cz-subtle rounded-full h-2">
        <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-sm font-bold w-8 text-right flex-shrink-0" style={{ color }}>{value ?? "-"}</span>
    </div>
  );
}

function SwapOfferButton({ rider, myTeamId }) {
  const { t } = useTranslation("rider");
  const [show, setShow]         = useState(false);
  const [myRiders, setMyRiders] = useState([]);
  const [offeredId, setOfferedId] = useState("");
  const [cash, setCash]         = useState(0);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [windowOpen, setWindowOpen] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      fetch(`${API}/api/transfer-window`, { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json())
        .then(d => setWindowOpen(d?.open !== false))
        .catch(() => {});
    });
  }, []);

  async function loadMyRiders() {
    const { data } = await supabase
      .from("riders")
      .select("id, firstname, lastname, uci_points, prize_earnings_bonus")
      .eq("team_id", myTeamId)
      .order("lastname");
    setMyRiders(data || []);
  }

  function openForm() {
    loadMyRiders();
    setShow(!show);
  }

  async function sendSwap() {
    if (!offeredId) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/transfers/swaps`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ offered_rider_id: offeredId, requested_rider_id: rider.id, cash_adjustment: cash }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setResult({ ok: true, msg: t("swapOffer.toast.success") }); setShow(false); }
      else        { setResult({ ok: false, msg: `${t("swapOffer.toast.errorPrefix")} ${data.error}` }); }
    } catch {
      setResult({ ok: false, msg: t("auth:error.connectionFailed") });
    } finally {
      setLoading(false);
      setTimeout(() => setResult(null), 4000);
    }
  }

  return (
    <div>
      {result && (
        <div className={`mb-2 px-3 py-2 rounded-lg text-sm border
          ${result.ok ? "bg-cz-success-bg text-cz-success border-cz-success/30" : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
          {result.msg}
        </div>
      )}
      <button onClick={openForm}
        className={`w-full min-h-[44px] py-2.5 rounded-xl text-sm font-bold transition-all border
          ${show
              ? "bg-cz-accent/10 text-cz-accent-t border-[#e8c547]/25"
              : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle hover:text-cz-1"}`}>
        {t("swapOffer.buttonOpen")}
      </button>
      {show && (
        <div className="mt-3 flex flex-col gap-2">
          {!windowOpen && (
            <p className="rounded-lg border border-cz-border bg-cz-subtle px-3 py-2 text-xs text-cz-2">
              {t("swapOffer.windowPendingHint")}
            </p>
          )}
          <select value={offeredId} onChange={e => setOfferedId(e.target.value)}
            className="w-full min-h-[44px] bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-base sm:text-sm focus:outline-none focus:border-cz-accent">
            <option value="">{t("swapOffer.selectRider")}</option>
            {myRiders.map(r => (
              <option key={r.id} value={r.id}>{r.firstname} {r.lastname} ({formatNumber(getRiderMarketValue(r))} CZ$)</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-cz-3 text-xs flex-shrink-0">{t("swapOffer.cashLabel")}</label>
            <input type="number" value={cash} onChange={e => setCash(parseInt(e.target.value) || 0)}
              className="flex-1 min-h-[44px] bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-base sm:text-sm focus:outline-none focus:border-cz-accent" />
          </div>
          <p className="text-cz-3 text-xs">{t("swapOffer.cashHint")}</p>
          <button onClick={sendSwap} disabled={loading || !offeredId}
            className="w-full min-h-[44px] py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50 transition-all">
            {loading ? t("swapOffer.sending") : t("swapOffer.submit")}
          </button>
        </div>
      )}
    </div>
  );
}

function LoanOfferButton({ rider }) {
  const { t } = useTranslation("rider");
  const [show, setShow]         = useState(false);
  const [loanFee, setLoanFee]   = useState(0);
  const [season, setSeason]     = useState("");
  const [buyOption, setBuyOption] = useState("");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [windowOpen, setWindowOpen] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      fetch(`${API}/api/transfer-window`, { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json())
        .then(d => setWindowOpen(d?.open !== false))
        .catch(() => {});
    });
  }, []);

  async function sendLoan() {
    if (!season) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/loans`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          rider_id: rider.id,
          loan_fee: loanFee,
          start_season: parseInt(season),
          end_season: parseInt(season),
          buy_option_price: buyOption ? parseInt(buyOption) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setResult({ ok: true, msg: t("loanOffer.toast.success") }); setShow(false); }
      else        { setResult({ ok: false, msg: `${t("loanOffer.toast.errorPrefix")} ${data.error}` }); }
    } catch {
      setResult({ ok: false, msg: t("auth:error.connectionFailed") });
    } finally {
      setLoading(false);
      setTimeout(() => setResult(null), 4000);
    }
  }

  return (
    <div>
      {result && (
        <div className={`mb-2 px-3 py-2 rounded-lg text-sm border
          ${result.ok ? "bg-cz-success-bg text-cz-success border-cz-success/30" : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
          {result.msg}
        </div>
      )}
      <button onClick={() => setShow(!show)}
        className={`w-full min-h-[44px] py-2.5 rounded-xl text-sm font-bold transition-all border
          ${show
              ? "bg-cz-accent/10 text-cz-accent-t border-[#e8c547]/25"
              : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle hover:text-cz-1"}`}>
        {t("loanOffer.buttonOpen")}
      </button>
      {show && (
        <div className="mt-3 flex flex-col gap-2">
          {!windowOpen && (
            <p className="text-xs text-cz-3 bg-cz-warning-bg border border-cz-warning/25 rounded-lg px-3 py-2">
              {t("loanOffer.windowPendingHint")}
            </p>
          )}
          <input type="number" value={season} onChange={e => setSeason(e.target.value)}
            placeholder={t("loanOffer.seasonPlaceholder")}
            className="w-full min-h-[44px] bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-base sm:text-sm focus:outline-none focus:border-cz-accent" />
          <input type="number" value={loanFee} onChange={e => setLoanFee(parseInt(e.target.value) || 0)}
            placeholder={t("loanOffer.feePlaceholder")}
            className="w-full min-h-[44px] bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-base sm:text-sm focus:outline-none focus:border-cz-accent" />
          <input type="number" value={buyOption} onChange={e => setBuyOption(e.target.value)}
            placeholder={t("loanOffer.buyOptionPlaceholder")}
            className="w-full min-h-[44px] bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-base sm:text-sm focus:outline-none focus:border-cz-accent" />
          <button onClick={sendLoan} disabled={loading || !season}
            className="w-full min-h-[44px] py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50 transition-all">
            {loading ? t("loanOffer.sending") : t("loanOffer.submit")}
          </button>
        </div>
      )}
    </div>
  );
}

function DirectOfferButton({ rider }) {
  const { t } = useTranslation("rider");
  const [show, setShow]       = useState(false);
  const [amount, setAmount]   = useState(getRiderMarketValue(rider));
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [windowOpen, setWindowOpen] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const API = import.meta.env.VITE_API_URL;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      fetch(`${API}/api/transfer-window`, { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json())
        .then(d => setWindowOpen(d?.open !== false))
        .catch(() => {});
    });
  }, []);

  async function performSendOffer() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/transfers/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ rider_id: rider.id, offer_amount: amount, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        logEvent("transfer_offer_sent", { rider_id: rider.id, amount });
        setResult({ ok: true, msg: t("directOffer.toast.success") }); setShow(false);
      }
      else        { setResult({ ok: false, msg: `${t("directOffer.toast.errorPrefix")} ${data.error}` }); }
    } catch {
      setResult({ ok: false, msg: t("auth:error.connectionFailed") });
    } finally {
      setLoading(false);
      setConfirmOpen(false);
      setTimeout(() => setResult(null), 4000);
    }
  }

  function sendOffer() {
    if (amount <= 0) return;
    setConfirmOpen(true);
  }
  return (
    <div>
      {result && (
        <div className={`mb-2 px-3 py-2 rounded-lg text-sm border
          ${result.ok ? "bg-cz-success-bg text-cz-success border-cz-success/30" : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
          {result.msg}
        </div>
      )}
      <button onClick={() => setShow(!show)}
        className={`w-full min-h-[44px] py-2.5 rounded-xl text-sm font-bold transition-all border
          ${show
              ? "bg-cz-accent/10 text-cz-accent-t border-[#e8c547]/25"
              : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle hover:text-cz-1"}`}>
        {t("directOffer.buttonOpen")}
      </button>
      {show && (
        <div className="mt-3 flex flex-col gap-2">
          {!windowOpen && (
            <p className="rounded-lg border border-cz-border bg-cz-subtle px-3 py-2 text-xs text-cz-2">
              {t("directOffer.windowPendingHint")}
            </p>
          )}
          <input type="number" value={amount} min={1} onChange={e => setAmount(parseInt(e.target.value) || 0)}
            placeholder={t("directOffer.amountPlaceholder")}
            className="w-full min-h-[44px] bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-base sm:text-sm focus:outline-none focus:border-cz-accent" />
          <input type="text" value={message} onChange={e => setMessage(e.target.value)}
            placeholder={t("directOffer.messagePlaceholder")}
            className="w-full min-h-[44px] bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-base sm:text-sm focus:outline-none focus:border-cz-accent" />
          <button onClick={sendOffer} disabled={loading || amount <= 0}
            className="w-full min-h-[44px] py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50 transition-all">
            {loading ? t("directOffer.sending") : t("directOffer.submit")}
          </button>
        </div>
      )}
      <BidConfirmModal
        show={confirmOpen}
        mode="transfer"
        riderName={`${rider.firstname} ${rider.lastname}`}
        amount={amount}
        busy={loading}
        onCancel={() => { if (!loading) setConfirmOpen(false); }}
        onConfirm={performSendOffer}
      />
    </div>
  );
}

// #254: Bid-panel på rytter-profil — Apple HIG sizing (≥44px), comfortable density
// matching AuctionCard. Bruger samme useAuctionBidding-hook som AuctionRow + AuctionCard
// så bid-flowet er identisk: balance-gate → confirm-modal → race-confirm ved 409.
function AuctionCountdown({ end, status }) {
  const { t } = useTranslation("rider");
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);
  useEffect(() => {
    if (status === "completed") { setText(t("countdown.completed")); return; }
    function update() {
      const diff = new Date(end) - new Date();
      if (diff <= 0) { setText(t("countdown.expired")); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setUrgent(diff < 600000);
      setText(h > 0 ? t("countdown.hoursMinutes", { h, m }) : m > 0 ? t("countdown.minutesSeconds", { m, s }) : t("countdown.seconds", { s }));
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [end, status, t]);
  return (
    <span className={`font-mono font-bold text-base tabular-nums ${urgent ? "text-cz-danger animate-pulse" : "text-cz-2"}`}>
      {text}
    </span>
  );
}

function RiderBidPanel({ auction, myTeamId, myAvailableBalance, riderName, onBid, onSetProxy, onRemoveProxy, requestBidConfirm, isFlashing }) {
  const { t } = useTranslation("rider");
  const r = auction?.rider;
  const isMyRider = r?.team_id === myTeamId;
  const isSeller  = isManagerSeller(auction, myTeamId);
  const imWinning = getAuctionLeaderId(auction) === myTeamId;
  const canBid    = !isMyRider && auction.status !== "completed";
  const wasOverbid = !imWinning && !isSeller && auction.myHighestBid != null && auction.current_bidder_id != null;

  const {
    minBid, myProxy,
    bidAmount, setBidAmount, bidStatus, errorText, warningText,
    proxyExpanded, setProxyExpanded, proxyInput, setProxyInput,
    proxyStatus, proxyErrorText,
    handleBid, handleSaveProxy, handleRemoveProxy,
  } = useAuctionBidding({
    auction, myAvailableBalance, onBid, onSetProxy, onRemoveProxy, requestBidConfirm,
    riderName: riderName || t("auctionPanel.riderNameFallback"),
  });

  return (
    <div className={`rounded-xl border p-4 ${imWinning ? "border-cz-accent/40 bg-cz-accent/[0.04]" : "border-cz-border bg-cz-subtle"}`}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <p className="text-cz-3 text-xs uppercase tracking-widest">{t("auctionPanel.activeLabel")}</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {imWinning && <span className="text-[10px] uppercase bg-cz-accent/15 text-cz-accent-t px-2 py-0.5 rounded font-semibold">{t("auctionPanel.badges.leading")}</span>}
          {isSeller && <span className="text-[10px] uppercase bg-cz-info-bg text-cz-info px-2 py-0.5 rounded font-semibold">{t("auctionPanel.badges.selling")}</span>}
          {wasOverbid && <span className="text-[10px] uppercase bg-cz-danger-bg text-cz-danger px-2 py-0.5 rounded font-semibold">{t("auctionPanel.badges.outbid")}</span>}
          {auction.status === "extended" && <span className="text-[10px] uppercase bg-cz-warning-bg text-cz-warning px-2 py-0.5 rounded">{t("auctionPanel.badges.extended")}</span>}
          {auction.is_flash && <span className="text-[10px] uppercase bg-cz-danger-bg text-cz-danger px-2 py-0.5 rounded">{t("auctionPanel.badges.flash")}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className={`bg-cz-card rounded-lg px-3 py-2 ${isFlashing ? "cz-pulse-flash" : ""}`}>
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("auctionPanel.highestBid")}</p>
          <p className="text-cz-1 font-mono font-bold text-base">
            {formatNumber(auction.current_price)} CZ$
          </p>
          {getAuctionLeaderName(auction) && !imWinning && (
            <p className="text-cz-3 text-[10px] truncate">{getAuctionLeaderName(auction)}</p>
          )}
        </div>
        <div className="bg-cz-card rounded-lg px-3 py-2">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("auctionPanel.timeLeft")}</p>
          <AuctionCountdown end={auction.calculated_end} status={auction.status} />
          <p className="text-cz-3 text-[10px] truncate">{t("auctionPanel.sellerPrefix", { name: getAuctionSellerLabel(auction) })}</p>
        </div>
      </div>

      {!canBid ? (
        <p className="text-cz-3 text-xs text-center py-2">
          {isSeller ? t("auctionPanel.cannotBidOwn") : t("auctionPanel.fallbackDash")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="number"
              value={bidAmount}
              min={minBid}
              onChange={e => { const v = parseInt(e.target.value, 10); setBidAmount(isNaN(v) ? 0 : v); }}
              aria-label={t("auctionPanel.bidInputAria")}
              className="min-w-0 min-h-[44px] bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-base focus:outline-none focus:border-cz-accent"
            />
            <button
              onClick={handleBid}
              disabled={bidStatus === "loading" || bidAmount < minBid}
              aria-label={imWinning ? t("auctionPanel.bidRaiseAria") : t("auctionPanel.bidPlaceAria")}
              className={`min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap
                ${bidStatus === "error" ? "bg-cz-danger-bg text-cz-danger border border-cz-danger/30" :
                  bidStatus === "success" ? "bg-cz-success-bg text-cz-success border border-cz-success/30" :
                  imWinning ? "bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 hover:bg-cz-accent/25" : "bg-cz-accent text-cz-on-accent hover:brightness-110"}
                disabled:opacity-50`}>
              {bidStatus === "loading" ? "..." : bidStatus === "error" ? t("auctionPanel.bidError") : bidStatus === "success" ? "✓" : imWinning ? t("auctionPanel.bidRaise") : t("auctionPanel.bidPlace")}
            </button>
          </div>
          <p className="text-[10px] text-cz-3">{t("auctionPanel.minBid", { amount: formatNumber(minBid) })}</p>
          {bidStatus === "error" && errorText && <p className="text-[11px] text-cz-danger">{errorText}</p>}
          {warningText && <p className="text-[11px] text-cz-warning leading-snug">{warningText}</p>}

          {/* Autobud-loft */}
          <div className="mt-1">
            {myProxy && !proxyExpanded ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] bg-cz-success-bg text-cz-success px-2 py-1 rounded-lg">
                  {t("auctionPanel.proxy.display", { amount: formatNumber(myProxy) })}
                </span>
                <button
                  onClick={() => setProxyExpanded(true)}
                  aria-label={t("auctionPanel.proxy.editAria")}
                  className="min-h-[44px] px-3 text-xs text-cz-3 hover:text-cz-2"
                >
                  {t("auctionPanel.proxy.edit")}
                </button>
                <button
                  onClick={handleRemoveProxy}
                  aria-label={t("auctionPanel.proxy.removeAria")}
                  className="min-h-[44px] px-3 text-xs text-cz-3 hover:text-cz-danger"
                >
                  {t("auctionPanel.proxy.remove")}
                </button>
              </div>
            ) : !proxyExpanded ? (
              <button
                onClick={() => setProxyExpanded(true)}
                aria-label={t("auctionPanel.proxy.addAria")}
                className="min-h-[44px] rounded-lg border border-cz-accent/50 bg-cz-accent/10 px-3 text-xs font-bold text-cz-accent-t hover:bg-cz-accent/20"
              >
                {t("auctionPanel.proxy.addButton")}
              </button>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={proxyInput}
                    min={minBid}
                    onChange={e => { const v = parseInt(e.target.value, 10); setProxyInput(isNaN(v) ? 0 : v); }}
                    placeholder={t("auctionPanel.proxy.inputPlaceholder")}
                    aria-label={t("auctionPanel.proxy.inputAria")}
                    className="min-w-0 w-32 min-h-[44px] bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-base focus:outline-none focus:border-cz-accent"
                  />
                  <button
                    onClick={handleSaveProxy}
                    disabled={proxyStatus === "loading" || proxyInput < minBid}
                    aria-label={t("auctionPanel.proxy.saveAria")}
                    className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap
                      ${proxyStatus === "error" ? "bg-cz-danger-bg text-cz-danger border border-cz-danger/30" :
                        proxyStatus === "saved" ? "bg-cz-success-bg text-cz-success border border-cz-success/30" :
                        "bg-cz-card border border-cz-border text-cz-2 hover:border-cz-accent hover:text-cz-accent-t"}
                      disabled:opacity-50`}>
                    {proxyStatus === "loading" ? "..." : proxyStatus === "error" ? t("auctionPanel.proxy.error") : proxyStatus === "saved" ? t("auctionPanel.proxy.saved") : t("auctionPanel.proxy.save")}
                  </button>
                  <button
                    onClick={() => setProxyExpanded(false)}
                    aria-label={t("auctionPanel.proxy.cancelAria")}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-xs text-cz-3 hover:text-cz-2"
                  >
                    ✕
                  </button>
                </div>
                {proxyStatus === "error" && proxyErrorText && (
                  <p className="text-[11px] text-cz-danger leading-tight">{proxyErrorText}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AuctionButton({ rider, auctionLabel, onStart, ddActive, isOwnRider }) {
  const { t } = useTranslation("rider");
  const riderValue      = getRiderMarketValue(rider);
  const [price, setPrice]           = useState(riderValue);
  const [loading, setLoading]       = useState(false);
  const [flash, setFlash]           = useState(false);

  // Egne ryttere: pris må være mellem 0 og Værdi (ikke over). AI/fri rytter: Værdi er gulvet.
  const priceError      = isOwnRider ? (price > riderValue || price < 0) : (price < riderValue);

  return (
    <div>
      <p className="text-cz-3 text-xs uppercase tracking-widest mb-2">
        {auctionLabel}
      </p>
      {ddActive && (
        <label className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-3 cursor-pointer select-none">
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={flash} onChange={e => setFlash(e.target.checked)}
              className="rounded accent-red-600" />
            <span className="text-sm text-cz-danger font-medium">{t("auctionStart.flash.label")}</span>
          </div>
          <span className="text-xs text-cz-3 sm:ms-0 ms-6">{t("auctionStart.flash.hint")}</span>
        </label>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="number"
          value={price}
          min={isOwnRider ? 0 : riderValue}
          max={isOwnRider ? riderValue : undefined}
          onChange={e => { const v = parseInt(e.target.value, 10); setPrice(Number.isNaN(v) ? (isOwnRider ? 0 : riderValue) : v); }}
          className={`min-w-0 flex-1 min-h-[44px] bg-cz-subtle border rounded-lg px-3 py-2 text-cz-1 text-base sm:text-sm font-mono focus:outline-none
            ${priceError
              ? "border-red-300 focus:border-red-400"
              : "border-cz-border focus:border-cz-accent"}`}
        />
        <button
          onClick={async () => { setLoading(true); await onStart(price, flash); setLoading(false); }}
          disabled={loading || priceError}
          className={`w-full sm:w-auto min-h-[44px] px-4 py-2 font-bold rounded-lg text-sm transition-all disabled:opacity-50
            ${flash ? "bg-red-600 text-white hover:bg-red-700" : "bg-cz-accent text-cz-on-accent hover:brightness-110"}`}>
          {loading ? t("auctionStart.buttons.loading") : flash ? t("auctionStart.buttons.startFlash") : t("auctionStart.buttons.start")}
        </button>
      </div>
      {priceError && (
        <p className="text-red-500 text-xs mt-1.5">
          {t(isOwnRider ? "auctionStart.priceErrorOwn" : "auctionStart.priceError", { amount: formatNumber(riderValue) })}
        </p>
      )}
    </div>
  );
}

export default function RiderStatsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("rider");

  const [rider, setRider]                   = useState(null);
  const [onWatchlist, setOnWatchlist]       = useState(false);
  const [watchlistId, setWatchlistId]       = useState(null);
  const [watchlistCount, setWatchlistCount] = useState(0);
  const [results, setResults]               = useState([]);
  const [seasonRows, setSeasonRows]         = useState([]);
  const [loading, setLoading]               = useState(true);
  const [tab, setTab]                       = useState("stats");
  const [myTeamId, setMyTeamId]             = useState(null);
  const [myBalance, setMyBalance]           = useState(0);
  const [activeAuction, setActiveAuction]   = useState(null);
  const [auctionError, setAuctionError]     = useState(null);
  const [history, setHistory]               = useState([]);
  const [uciHistory, setUciHistory]         = useState([]);
  const [statHistory, setStatHistory]       = useState([]);
  const [ddActive, setDdActive]             = useState(false);
  // #195: live bud-timeline for seneste auktion (aktiv eller completed).
  // Privacy-låst: backend lækker aldrig proxy_max — frontend respekterer samme kontrakt.
  const [bidTimeline, setBidTimeline]       = useState(null);
  // #254: bid-confirm + race-confirm + confetti + overbid-toast + price-flash
  // mirror'er AuctionsPage så ryttersiden har samme UX som auktion-listen.
  const [bidConfirm, setBidConfirm]         = useState(null);
  const [bidConfirmBusy, setBidConfirmBusy] = useState(false);
  const [raceConfirm, setRaceConfirm]       = useState(null);
  const [celebration, setCelebration]       = useState(null);
  const [priceFlash, setPriceFlash]         = useState(false);
  const [toasts, setToasts]                 = useState([]);
  // Refs så channel-callback kan se nyeste state uden at re-subscribe
  const activeAuctionRef = useRef(null);
  const myTeamIdRef      = useRef(null);
  useEffect(() => { activeAuctionRef.current = activeAuction; }, [activeAuction]);
  useEffect(() => { myTeamIdRef.current = myTeamId; }, [myTeamId]);

  async function loadWatchlistStatus() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase.from("rider_watchlist")
      .select("id").eq("user_id", user.id).eq("rider_id", id).single();
    if (data) { setOnWatchlist(true); setWatchlistId(data.id); }
    else      { setOnWatchlist(false); setWatchlistId(null); }
  }

  async function loadWatchlistCount() {
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${id}/watchlist-count`, { headers: h });
      const data = await res.json();
      setWatchlistCount(data.count || 0);
    } catch { /* non-critical: count badge stays at previous value */ }
  }

  async function toggleWatchlist() {
    const { data: { user } } = await supabase.auth.getUser();
    if (onWatchlist) {
      await supabase.from("rider_watchlist").delete().eq("id", watchlistId);
      setOnWatchlist(false); setWatchlistId(null);
    } else {
      const { data } = await supabase.from("rider_watchlist")
        .insert({ user_id: user.id, rider_id: id }).select("id").single();
      setOnWatchlist(true); setWatchlistId(data?.id);
      // Achievement check
      const h = await authHeaders();
      fetch(`${API}/api/achievements/check`, {
        method: "POST", headers: h,
        body: JSON.stringify({ context: "watchlist_add" }),
      }).catch(() => {});
    }
    loadWatchlistCount();
  }

  async function loadHistory() {
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${id}/history`, { headers: h });
      if (res.ok) setHistory(await res.json());
    } catch { /* non-critical: history section stays empty */ }
  }

  async function loadBidTimeline() {
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${id}/bid-timeline`, { headers: h });
      if (res.ok) setBidTimeline(await res.json());
    } catch { /* non-critical: bid-timeline tab falls back to empty state */ }
  }

  async function loadDevelopmentHistory() {
    const statColumns = STATS.map(s => s.key).join(", ");
    const [uciRes, statRes] = await Promise.all([
      supabase.from("rider_uci_history")
        .select("uci_points, synced_at")
        .eq("rider_id", id)
        .order("synced_at", { ascending: true })
        .limit(104),
      supabase.from("rider_stat_history")
        .select(`synced_at, ${statColumns}`)
        .eq("rider_id", id)
        .order("synced_at", { ascending: true })
        .limit(52),
    ]);

    setUciHistory(uciRes.data || []);
    setStatHistory(statRes.data || []);
  }

  async function loadMyTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams").select("id, balance, division, name").eq("user_id", user.id).single();
    if (t) { setMyTeamId(t.id); setMyBalance(t.balance || 0); }
  }

  // #254: Henter aktiv auktion på rytteren med ALLE felter bid-panelet skal bruge
  // (current_bidder, seller, min_increment, is_flash) + manager's eget proxy_max
  // og højeste bud. Kaldes initialt fra loadRider og igen fra realtime-channel
  // når et nyt bud lander eller auktionen opdateres.
  async function loadActiveAuctionFull(riderObj) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: auctionData } = await supabase.from("auctions")
      .select(`id, current_price, min_increment, calculated_end, status, is_guaranteed_sale, is_flash,
        seller_team_id, current_bidder_id,
        seller:seller_team_id(id, name),
        current_bidder:current_bidder_id(id, name)`)
      .eq("rider_id", id).in("status", ["active", "extended"]).maybeSingle();

    if (!auctionData) { setActiveAuction(null); return null; }

    // Embedded "rider" lader getAuctionLeaderId/isManagerSeller arbejde uden ekstra subquery
    auctionData.rider = riderObj ? { id: riderObj.id, team_id: riderObj.team_id } : null;

    if (user?.id) {
      const { data: team } = await supabase.from("teams").select("id").eq("user_id", user.id).maybeSingle();
      if (team?.id) {
        const [proxyRes, myBidRes] = await Promise.all([
          supabase.from("auction_proxy_bids").select("max_amount")
            .eq("auction_id", auctionData.id).eq("team_id", team.id).maybeSingle(),
          supabase.from("auction_bids").select("amount")
            .eq("auction_id", auctionData.id).eq("team_id", team.id)
            .order("amount", { ascending: false }).limit(1).maybeSingle(),
        ]);
        auctionData.myProxyMax = proxyRes.data?.max_amount || null;
        auctionData.myHighestBid = myBidRes.data?.amount || null;
      }
    }
    setActiveAuction(auctionData);
    return auctionData;
  }

  async function loadRider() {
    const [riderRes, resultsRes, seasonRowsAll] = await Promise.all([
      supabase.from("riders").select(`*, team:team_id(id, name, is_ai, is_bank)`).eq("id", id).single(),
      // Seneste 20 til "Løbsresultater"-listen (visning).
      supabase.from("race_results")
        .select(`*, race:race_id(name, race_type, season:season_id(number))`)
        .eq("rider_id", id).order("imported_at", { ascending: false }).limit(20),
      // ALLE rækker (lette kolonner, pagineret) til sæson-aggregeringen — ellers
      // ville .limit(20) trunkere sejre/præmie-totalerne (PostgREST capper ved 1000).
      fetchAllRiderSeasonRows(id),
    ]);
    setRider(riderRes.data);
    setResults(resultsRes.data || []);
    setSeasonRows(seasonRowsAll);
    await loadActiveAuctionFull(riderRes.data);
    setLoading(false);
    loadWatchlistCount();

    // Log besøg for ALLE ryttere (#963) — ikke kun hold-ejede. Endpointet
    // håndterer både besøgs-logging og det (team-gated) transferrygte internt.
    // Fyrer én gang pr. profil-mount (useEffect [id]) — ikke pr. re-render.
    if (riderRes.data?.id) {
      const h = await authHeaders();
      fetch(`${API}/api/riders/${id}/view`, { method: "POST", headers: h }).catch(() => {});
    }
  }

  async function loadDdStatus() {
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/deadline-day/status`, { headers: h });
      if (res.ok) {
        const data = await res.json();
        setDdActive(data.active === true);
      }
    } catch { /* non-critical: deadline-day banner falls back to inactive */ }
  }

  useEffect(() => { loadRider(); loadMyTeam(); loadWatchlistStatus(); loadHistory(); loadDevelopmentHistory(); loadDdStatus(); loadBidTimeline(); }, [id]);

  function pushOverbidToast({ riderName, amount }) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev, { id, riderName, amount }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }

  function dismissToast(id) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  // #195 + #254: Supabase realtime — kun aktive auktioner. INSERT på auction_bids
  // refetcher bid-timeline OG activeAuction (ny pris/bidder). UPDATE på auctions
  // trigger pris-flash + overbid-toast + confetti på win, og kollapser timeline
  // når status='completed'. Egen kanalnavn pr. auction undgår kollision med
  // AuctionsPage's "auctions-live" channel.
  useEffect(() => {
    const auctionId = bidTimeline?.auction_id;
    const isLive = bidTimeline?.status === "active" || bidTimeline?.status === "extended";
    if (!auctionId || !isLive) return;
    const channel = supabase.channel(`rider-bids-${auctionId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "auction_bids",
        filter: `auction_id=eq.${auctionId}`,
      }, () => {
        loadBidTimeline();
        loadActiveAuctionFull(rider);
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "auctions",
        filter: `id=eq.${auctionId}`,
      }, payload => {
        const updated = payload.new;
        const prev = activeAuctionRef.current;
        const myTeam = myTeamIdRef.current;
        if (prev && updated) {
          if (shouldFlashPrice(prev, updated)) {
            setPriceFlash(true);
            setTimeout(() => setPriceFlash(false), 1500);
          }
          if (isOverbidEvent(prev, updated, myTeam)) {
            const r = rider;
            pushOverbidToast({
              riderName: r ? `${r.firstname} ${r.lastname}` : "rytter",
              amount: updated.current_price,
            });
          }
        }
        if (updated.status === "completed") {
          loadBidTimeline();
          // Confetti hvis manager vandt
          const mergedForLeader = { ...(prev || {}), ...updated, rider: prev?.rider };
          if (myTeam && getAuctionLeaderId(mergedForLeader) === myTeam) {
            setCelebration({
              title: t("celebration.title"),
              subtitle: t("celebration.subtitle"),
              amount: updated.current_price,
            });
          }
          loadActiveAuctionFull(rider);
        } else {
          loadActiveAuctionFull(rider);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [bidTimeline?.auction_id, bidTimeline?.status, rider]);

  // #254: bid-handlers — POST /bid, PATCH /proxy, DELETE /proxy.
  // Re-bruger samme endpoints som AuctionsPage; #194 race-confirm modtages
  // som 409 og overbringes til top-level RacePriceModal.
  async function handleAuctionBid(auctionId, amount, { skipExpectedPrice = false } = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const cur = activeAuctionRef.current;
    const body = { amount };
    if (!skipExpectedPrice && cur) body.expected_current_price = cur.current_price;
    const res = await fetch(`${API}/api/auctions/${auctionId}/bid`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      let raceData = {};
      try { raceData = await res.json(); } catch { /* ignore */ }
      if (raceData.error === "price_changed") {
        setRaceConfirm({
          auctionId,
          newPrice: raceData.currentPrice,
          newMinBid: raceData.minimumBid,
        });
        loadActiveAuctionFull(rider);
        return { ok: false, race: true };
      }
    }
    if (res.ok) {
      fetch(`${API}/api/achievements/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ context: "auction_bid", data: { amount } }),
      }).catch(() => {});
      loadActiveAuctionFull(rider);
      let okData = {};
      try { okData = await res.json(); } catch { /* ignore */ }
      return { ok: true, warnings: okData.warnings || [] };
    }
    let data = {};
    try { data = await res.json(); } catch { /* ignore */ }
    return { ok: false, error: data.error || t("auctionPanel.errorFallback") };
  }

  async function handleConfirmRaceBid() {
    if (!raceConfirm) return;
    const { auctionId, newMinBid } = raceConfirm;
    setRaceConfirm(null);
    await handleAuctionBid(auctionId, newMinBid, { skipExpectedPrice: true });
  }

  async function handleSetProxy(auctionId, maxAmount) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API}/api/auctions/${auctionId}/proxy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ max_amount: maxAmount }),
    });
    if (res.ok) { loadActiveAuctionFull(rider); return { ok: true }; }
    let data = {};
    try { data = await res.json(); } catch { /* ignore */ }
    return { ok: false, error: data.error || t("auctionPanel.proxyErrorFallback") };
  }

  async function handleRemoveProxy(auctionId) {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`${API}/api/auctions/${auctionId}/proxy`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    loadActiveAuctionFull(rider);
  }

  function requestBidConfirm(payload) {
    setBidConfirm(payload);
  }

  async function handleBidConfirm() {
    if (!bidConfirm?.onConfirm) { setBidConfirm(null); return; }
    setBidConfirmBusy(true);
    try {
      await bidConfirm.onConfirm();
    } finally {
      setBidConfirmBusy(false);
      setBidConfirm(null);
    }
  }

  async function startAuction(startPrice, isFlash = false) {
    setAuctionError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API}/api/auctions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: id, starting_price: startPrice, flash_auction: isFlash }),
    });
    if (res.ok) {
      // Squad-cap-warning er non-blocking siden #29 — vis besked hvis manager går over max.
      const data = await res.json().catch(() => ({}));
      const warning = (data.warnings || []).find(w => w?.code === "squad_capacity_exceeded");
      if (warning) {
        const fine = warning.finePerRider * warning.exceedBy;
        const points = warning.penaltyPointsPerRider * warning.exceedBy;
        alert(t("auctionStart.squadWarning", {
          total: warning.totalAfter,
          max: warning.maxRiders,
          exceedBy: warning.exceedBy,
          fine: formatNumber(fine),
          points,
        }));
      }
      navigate("/auctions");
    } else {
      const data = await res.json();
      setAuctionError(data.error || t("blocked.errorFallback"));
      setTimeout(() => setAuctionError(null), 5000);
    }
  }

  if (loading) return (
    <div className="flex justify-center py-16" aria-label={t("page.loadingAria")}>
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  if (!rider) return <div className="text-cz-3 text-center py-16">{t("page.notFound")}</div>;

  // Lokaliserede skill-labels — bruges til bestStat/typeLabel + StatRow rendering.
  const localizedSkills = buildSkillsLocalized(t);
  const bestStat = localizedSkills.map(s => ({ ...s, val: rider[s.key] || 0 })).sort((a, b) => b.val - a.val)[0];
  const isMyRider  = rider.team_id === myTeamId;
  const isFreeAgent = !rider.team_id;
  const isBankRider = Boolean(rider.team?.is_bank);
  const isAiRider = Boolean(rider.team?.is_ai);
  const isPendingTransfer = Boolean(rider.pending_team_id);
  const isRetired = Boolean(rider.is_retired);
  const canAuction  = (isFreeAgent || isMyRider || isBankRider || isAiRider) && !isPendingTransfer && !isRetired;
  const canDirectOffer = rider.team_id && rider.team_id !== myTeamId && !isBankRider && !isAiRider && !isPendingTransfer && !isRetired;
  const auctionLabel = isMyRider
    ? t("auctionStart.label.myRider")
    : isBankRider
      ? t("auctionStart.label.bank")
      : isAiRider
        ? t("auctionStart.label.ai")
        : t("auctionStart.label.free");
  // Racing-age (year-arithmetic) — matches U25/filter-logik andre steder i appen.
  // Ellers kunne profil vise "24 år" mens max_age=25-filteret tæller rytteren som 25.
  const age = rider.birthdate
    ? new Date().getFullYear() - new Date(rider.birthdate).getFullYear()
    : null;
  const typeLabel = (() => {
    const vals = localizedSkills.map(s => rider[s.key] || 0);
    const max = Math.max(...vals);
    return localizedSkills[vals.indexOf(max)]?.label || t("header.typeDefault");
  })();
  const riderValueLabel = formatCz(getRiderMarketValue(rider));
  const riderValueAmount = riderValueLabel.replace(" CZ$", "");
  // Sæson-totaler fra ALLE rytterens rækker (ikke kun de 20 i resultat-listen),
  // med sejre opdelt pr. type. Se lib/riderSeasonStats.js.
  const bySeason = aggregateRiderSeasons(seasonRows);

  return (
    <div className="max-w-2xl mx-auto min-w-0">
      {/* #254: Bid-modaler — confirm før bud, race-confirm ved 409 stale price, confetti på win, overbid-toast */}
      <BidConfirmModal
        show={!!bidConfirm}
        mode={bidConfirm?.mode}
        riderName={bidConfirm?.riderName}
        amount={bidConfirm?.amount}
        busy={bidConfirmBusy}
        onCancel={() => { if (!bidConfirmBusy) setBidConfirm(null); }}
        onConfirm={handleBidConfirm}
      />
      <RacePriceModal
        show={!!raceConfirm}
        newPrice={raceConfirm?.newPrice ?? 0}
        newMinBid={raceConfirm?.newMinBid ?? 0}
        onCancel={() => setRaceConfirm(null)}
        onConfirm={handleConfirmRaceBid}
      />
      <ConfettiModal
        show={!!celebration}
        onClose={() => setCelebration(null)}
        title={celebration?.title || ""}
        subtitle={celebration?.subtitle}
        amount={celebration?.amount}
        icon="🏆"
      />
      <OverbidToast toasts={toasts} onDismiss={dismissToast} />

      <button onClick={() => navigate(-1)} className="text-cz-3 hover:text-cz-1 text-sm mb-4 flex items-center gap-1">{t("page.back")}</button>

      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-3">
              <h1 className="text-2xl font-bold text-cz-1 break-words">{rider.firstname} {rider.lastname}</h1>
              <button onClick={toggleWatchlist} title={onWatchlist ? t("header.watchlistRemove") : t("header.watchlistAdd")}
                className={`text-2xl flex-shrink-0 transition-all hover:scale-110 ${onWatchlist ? "text-cz-accent-t" : "text-cz-3 hover:text-cz-2"}`}>
                {onWatchlist ? "★" : "☆"}
              </button>
              <button onClick={() => navigate(`/compare?ids=${rider.id}`)} title={t("header.compareTitle")}
                className="flex-shrink-0 px-2 py-1 rounded-lg text-xs font-medium border border-cz-border text-cz-2 hover:text-cz-1 hover:border-cz-accent/40 transition-all">
                {t("header.compare")}
              </button>
            </div>
            {watchlistCount > 0 && (
              <p className="text-cz-3 text-xs mt-1">{t("header.watchlistCount", { count: watchlistCount })}</p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {rider.is_u25 && <span className="text-xs uppercase bg-cz-info-bg0/20 text-cz-info px-2 py-0.5 rounded">{t("header.u25")}</span>}
              {isRetired && <span className="text-xs uppercase bg-cz-danger-bg0/20 text-cz-danger px-2 py-0.5 rounded">{t("header.retired")}</span>}
              <span className="text-xs uppercase bg-cz-subtle text-cz-2 px-2 py-0.5 rounded font-medium">{typeLabel}</span>
              {rider.nationality_code && (
                <span className="text-cz-2 text-sm inline-flex items-center gap-1">
                  <Flag code={rider.nationality_code} /> {getCountryName(rider.nationality_code, i18n.language)}
                </span>
              )}
              {age && <span className="text-cz-3 text-sm">{t("header.ageYears", { age })}</span>}
              {rider.height && <span className="text-cz-3 text-sm">{t("header.heightCm", { height: rider.height })}</span>}
              {rider.weight && <span className="text-cz-3 text-sm">{t("header.weightKg", { weight: rider.weight })}</span>}
            </div>
            {rider.potentiale != null && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-cz-3 text-xs uppercase tracking-wider">{t("header.potential")}</span>
                <PotentialeStars value={rider.potentiale} birthdate={rider.birthdate} large showValue />
              </div>
            )}
            <p className="text-cz-2 text-sm mt-2">
              {rider.team
                ? <span>{t("header.teamPrefix")} <TeamLink id={rider.team.id} className="hover:text-cz-accent-t transition-colors">{rider.team.name}</TeamLink></span>
                : t("header.freeAgent")}
            </p>
            {activeAuction && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs bg-cz-accent/15 text-cz-accent-t px-2 py-0.5 rounded font-medium">
                  {t("header.activeAuctionBadge")}
                </span>
                <span className="text-xs text-cz-3">
                  {t("header.highestBidLabel", { amount: formatNumber(activeAuction.current_price) })}
                </span>
              </div>
            )}
          </div>
          <div className="min-w-0 sm:text-right bg-cz-subtle sm:bg-transparent rounded-lg sm:rounded-none px-3 py-2 sm:p-0">
            <p
              className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-cz-accent-t font-mono font-bold tabular-nums text-lg sm:text-2xl"
              data-testid="rider-value-amount"
              title={riderValueLabel}
            >
              {riderValueAmount}
            </p>
            <p className="text-cz-3 text-xs mt-0.5">{t("header.valueLabel")}</p>
            {bestStat && <p className="text-cz-2 text-xs mt-2">{t("header.bestStat", { label: bestStat.label, value: rider[bestStat.key] })}</p>}
          </div>
        </div>
        {auctionError && (
          <div className="mt-3 px-3 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm">
            {auctionError}
          </div>
        )}
        <div className="mt-5 pt-5 border-t border-cz-border flex flex-col gap-3">
          {isPendingTransfer && (
            <p className="text-cz-3 text-xs text-center py-2 bg-cz-subtle rounded-lg border border-cz-border">
              {t("blocked.pendingTransfer")}
            </p>
          )}
          {isRetired && (
            <p className="text-cz-3 text-xs text-center py-2 bg-cz-subtle rounded-lg border border-cz-border">
              {t("blocked.retired")}
            </p>
          )}
          {canAuction && !activeAuction && <AuctionButton rider={rider} auctionLabel={auctionLabel} onStart={startAuction} ddActive={ddActive} isOwnRider={isMyRider} />}
          {activeAuction && (
            <RiderBidPanel
              auction={activeAuction}
              myTeamId={myTeamId}
              myAvailableBalance={myBalance}
              riderName={`${rider.firstname} ${rider.lastname}`}
              onBid={handleAuctionBid}
              onSetProxy={handleSetProxy}
              onRemoveProxy={handleRemoveProxy}
              requestBidConfirm={requestBidConfirm}
              isFlashing={priceFlash}
            />
          )}
          {canDirectOffer && <DirectOfferButton rider={rider} />}
          {canDirectOffer && <SwapOfferButton rider={rider} myTeamId={myTeamId} />}
          {canDirectOffer && <LoanOfferButton rider={rider} />}
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { key: "stats", label: t("tabs.stats") },
          { key: "season", label: t("tabs.season") },
          { key: "results", label: t("tabs.results") },
          { key: "bids", label: t("tabs.bids") },
          { key: "history", label: t("tabs.history") },
          { key: "development", label: t("tabs.development") },
        ].map(tabDef => (
          <button key={tabDef.key} onClick={() => {
            setTab(tabDef.key);
            if (tabDef.key === "development") logEvent("feature_rider_development_tab_opened", { rider_id: rider.id });
          }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${tab === tabDef.key ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "text-cz-2 border-cz-border hover:text-cz-1 hover:border-cz-border"}`}>
            {tabDef.label}
          </button>
        ))}
      </div>

      {tab === "stats" && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          {rider.potentiale != null && (
            <div className="flex items-center gap-3 py-2 mb-1 border-b border-cz-border">
              <span className="text-cz-3 w-4 text-center text-sm">◆</span>
              <span className="text-cz-2 text-sm w-28 sm:w-36 flex-shrink-0">{t("stats.potentialRow")}</span>
              <PotentialeStars value={rider.potentiale} birthdate={rider.birthdate} showValue />
            </div>
          )}
          {localizedSkills.map(s => <StatRow key={s.key} label={s.label} icon={s.icon} value={rider[s.key]} />)}
        </div>
      )}

      {tab === "season" && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          {Object.keys(bySeason).length === 0 ? (
            <p className="text-cz-3 text-center py-8">{t("season.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-cz-border">
                  <th className="py-2 text-left text-cz-3 text-xs uppercase whitespace-nowrap">{t("season.table.season")}</th>
                  <th className="py-2 px-2 text-right text-cz-3 text-xs uppercase whitespace-nowrap">{t("season.table.stageWins")}</th>
                  <th className="py-2 px-2 text-right text-cz-3 text-xs uppercase whitespace-nowrap">{t("season.table.gcWins")}</th>
                  <th className="py-2 px-2 text-right text-cz-3 text-xs uppercase whitespace-nowrap">{t("season.table.classicWins")}</th>
                  <th className="py-2 px-2 text-right text-cz-3 text-xs uppercase whitespace-nowrap">{t("season.table.pointsJersey")}</th>
                  <th className="py-2 px-2 text-right text-cz-3 text-xs uppercase whitespace-nowrap">{t("season.table.mountainJersey")}</th>
                  <th className="py-2 pl-2 text-right text-cz-3 text-xs uppercase whitespace-nowrap">{t("season.table.prizes")}</th>
                </tr></thead>
                <tbody>
                  {Object.entries(bySeason)
                    .sort((a, b) => (b[1].season ?? -1) - (a[1].season ?? -1))
                    .map(([key, d]) => (
                    <tr key={key} className="border-b border-cz-border">
                      <td className="py-2 text-cz-2 whitespace-nowrap">{d.season != null ? t("season.row", { n: d.season }) : t("results.fallbackDash")}</td>
                      <td className="py-2 px-2 text-right text-cz-accent-t font-mono">{d.stageWins}</td>
                      <td className="py-2 px-2 text-right text-cz-1 font-mono">{d.gcWins}</td>
                      <td className="py-2 px-2 text-right text-cz-1 font-mono">{d.classicWins}</td>
                      <td className="py-2 px-2 text-right text-cz-2 font-mono">{d.pointsJerseys}</td>
                      <td className="py-2 px-2 text-right text-cz-2 font-mono">{d.mountainJerseys}</td>
                      <td className="py-2 pl-2 text-right text-cz-success font-mono text-xs whitespace-nowrap">+{formatNumber(d.totalPrize)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "results" && (
        <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          {results.length === 0 ? (
            <p className="text-cz-3 text-center py-8">{t("results.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-cz-border">
                  <th className="px-4 py-3 text-left text-cz-3 text-[10px] uppercase">{t("results.table.race")}</th>
                  <th className="px-4 py-3 text-center text-cz-3 text-[10px] uppercase">{t("results.table.type")}</th>
                  <th className="px-4 py-3 text-right text-cz-3 text-[10px] uppercase">{t("results.table.position")}</th>
                  <th className="px-4 py-3 text-right text-cz-3 text-[10px] uppercase">{t("results.table.prize")}</th>
                </tr></thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.id} className="border-b border-cz-border last:border-0">
                      <td className="px-4 py-3">
                        <p className="text-cz-1 text-sm">{r.race?.name || t("results.fallbackDash")}</p>
                        <p className="text-cz-3 text-xs">{r.race?.season?.number != null ? t("season.row", { n: r.race.season.number }) : t("results.fallbackDash")}</p>
                      </td>
                      <td className="px-4 py-3 text-center text-cz-2 text-xs">{r.result_type || t("results.fallbackDash")}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-mono font-bold text-sm ${r.rank === 1 ? "text-cz-accent-t" : r.rank <= 3 ? "text-cz-1" : "text-cz-2"}`}>
                          #{r.rank}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-cz-success font-mono text-xs">
                        {r.prize_money ? `+${formatNumber(r.prize_money)}` : t("results.fallbackDash")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "bids" && (
        <BidTimelineTab timeline={bidTimeline} />
      )}

      {tab === "history" && (
        <div className="bg-cz-card border border-cz-border rounded-xl divide-y divide-cz-border">
          {history.length === 0 ? (
            <p className="text-cz-3 text-center py-8">{t("history.empty")}</p>
          ) : history.map((e, i) => (
            <HistoryEvent key={i} event={e} />
          ))}
        </div>
      )}

      {tab === "development" && (
        <Suspense fallback={<div className="bg-cz-card border border-cz-border rounded-xl p-5 text-cz-3 text-center py-8">{t("stats.loadingDevelopment")}</div>}>
          <RiderDevelopmentTab uciHistory={uciHistory} statHistory={statHistory} stats={localizedSkills} />
        </Suspense>
      )}
    </div>
  );
}

function BidTimelineTab({ timeline }) {
  const { t } = useTranslation("rider");
  if (!timeline || timeline.auction_id === null) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-xl p-5">
        <p className="text-cz-3 text-center py-8">{t("bids.noAuction")}</p>
      </div>
    );
  }

  if (timeline.status === "completed") {
    const completedDate = timeline.completed_at
      ? formatDateTime(timeline.completed_at)
      : t("bids.fallbackDash");
    return (
      <div className="bg-cz-card border border-cz-border rounded-xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-cz-accent-t text-2xl mt-0.5">🏆</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-wider text-cz-accent-t font-medium mb-1">{t("bids.soldLabel")}</p>
            <p className="text-cz-1 text-base">
              <TeamLink id={timeline.winner_team_id} className="font-semibold hover:text-cz-accent-t transition-colors">{timeline.winner_name || t("bids.winnerFallback")}</TeamLink>
              <span className="text-cz-3"> {t("bids.soldFor")} </span>
              <span className="font-mono font-bold text-cz-accent-t">
                {formatNumber(timeline.final_bid)} CZ$
              </span>
            </p>
            {timeline.seller_name && (
              <p className="text-cz-2 text-sm mt-1">
                <span className="text-cz-3">{t("bids.sellerPrefix")} </span>
                <TeamLink id={timeline.seller_team_id} className="hover:text-cz-accent-t transition-colors">{timeline.seller_name}</TeamLink>
              </p>
            )}
            <p className="text-cz-3 text-xs mt-1">{completedDate}</p>
          </div>
        </div>
      </div>
    );
  }

  const bids = timeline.bid_timeline || [];
  // Vis nyeste først så aktuelle bud står øverst
  const ordered = [...bids].reverse();

  return (
    <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-cz-border flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-cz-accent-t font-medium">{t("bids.activeAuction")}</span>
        {timeline.current_price != null && (
          <span className="text-cz-1 font-mono font-bold text-sm">
            {formatNumber(timeline.current_price)} CZ$
          </span>
        )}
      </div>
      {ordered.length === 0 ? (
        <p className="text-cz-3 text-center py-8">{t("bids.noBids")}</p>
      ) : (
        <ul className="divide-y divide-cz-border">
          {ordered.map((b, i) => (
            <BidTimelineRow key={`${b.bid_time}-${i}`} bid={b} isLatest={i === 0} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BidTimelineRow({ bid, isLatest }) {
  const { t } = useTranslation("rider");
  const time = bid.bid_time
    ? formatDateTime(bid.bid_time, { dateStyle: "medium", timeStyle: "short" })
    : t("bids.fallbackDash");
  return (
    <li className={`px-5 py-3 flex items-center justify-between gap-3 ${isLatest ? "bg-cz-accent/[0.04]" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <TeamLink id={bid.team_id} stopPropagation className="text-cz-1 text-sm font-medium truncate hover:text-cz-accent-t transition-colors">{bid.team_name || t("bids.row.teamFallback")}</TeamLink>
          {bid.is_proxy && (
            <span className="text-[10px] uppercase bg-cz-info-bg text-cz-info px-1.5 py-0.5 rounded">
              {t("bids.row.autoBidTag")}
            </span>
          )}
          {isLatest && (
            <span className="text-[10px] uppercase bg-cz-accent/15 text-cz-accent-t px-1.5 py-0.5 rounded">
              {t("bids.row.highestTag")}
            </span>
          )}
        </div>
        <p className="text-cz-3 text-xs mt-0.5">{time}</p>
      </div>
      <span className="text-cz-1 font-mono font-bold text-sm whitespace-nowrap">
        {formatNumber(bid.amount)} CZ$
      </span>
    </li>
  );
}

function HistoryEvent({ event }) {
  const { t } = useTranslation("rider");
  const date = event.date
    ? formatDate(event.date)
    : t("history.fallbackDash");

  if (event.type === "auction") {
    const typeLabel = event.is_ai_sale
      ? t("history.auction.labelAi")
      : event.is_guaranteed_sale
        ? t("history.auction.labelGuaranteed")
        : t("history.auction.labelDefault");
    return (
      <div className="px-4 py-3 flex items-start gap-3">
        <span className="text-cz-accent-t text-lg mt-0.5">🏆</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-cz-accent-t font-medium">{typeLabel}</span>
            <span className="text-cz-3 text-xs">{date}</span>
          </div>
          <p className="text-cz-2 text-sm mt-0.5">
            <TeamLink id={event.buyer?.id} className="font-medium hover:text-cz-accent-t transition-colors">{event.buyer?.name || t("history.auction.buyerFallback")}</TeamLink>
            <span className="text-cz-3"> {t("history.auction.wonBy")} </span>
            <TeamLink id={event.seller?.id} className="font-medium hover:text-cz-accent-t transition-colors">{event.seller?.name || (event.is_ai_sale ? t("history.auction.sellerFallbackAi") : t("history.auction.sellerFallback"))}</TeamLink>
          </p>
          {event.price != null && (
            <p className="text-cz-accent-t font-mono text-xs mt-0.5">{formatNumber(event.price)} CZ$</p>
          )}
        </div>
      </div>
    );
  }

  if (event.type === "transfer") {
    return (
      <div className="px-4 py-3 flex items-start gap-3">
        <span className="text-blue-500 text-lg mt-0.5">↔</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-cz-info font-medium">{t("history.transfer.label")}</span>
            <span className="text-cz-3 text-xs">{date}</span>
          </div>
          <p className="text-cz-2 text-sm mt-0.5">
            <TeamLink id={event.buyer?.id} className="font-medium hover:text-cz-accent-t transition-colors">{event.buyer?.name || t("history.transfer.buyerFallback")}</TeamLink>
            <span className="text-cz-3"> {t("history.transfer.buys")} </span>
            <TeamLink id={event.seller?.id} className="font-medium hover:text-cz-accent-t transition-colors">{event.seller?.name || t("history.transfer.sellerFallback")}</TeamLink>
          </p>
          {event.price != null && (
            <p className="text-cz-accent-t font-mono text-xs mt-0.5">{formatNumber(event.price)} CZ$</p>
          )}
        </div>
      </div>
    );
  }

  if (event.type === "swap") {
    return (
      <div className="px-4 py-3 flex items-start gap-3">
        <span className="text-purple-500 text-lg mt-0.5">⇄</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-purple-700 font-medium">{t("history.swap.label")}</span>
            <span className="text-cz-3 text-xs">{date}</span>
          </div>
          <p className="text-cz-2 text-sm mt-0.5">
            <TeamLink id={event.proposing_team?.id} className="font-medium hover:text-cz-accent-t transition-colors">{event.proposing_team?.name || t("history.swap.teamFallback")}</TeamLink>
            <span className="text-cz-3"> ↔ </span>
            <TeamLink id={event.receiving_team?.id} className="font-medium hover:text-cz-accent-t transition-colors">{event.receiving_team?.name || t("history.swap.teamFallback")}</TeamLink>
          </p>
          {event.cash_adjustment !== 0 && event.cash_adjustment != null && (
            <p className="text-cz-2 font-mono text-xs mt-0.5">
              {t("history.swap.cashAdjustment", { amount: `${event.cash_adjustment > 0 ? "+" : ""}${formatNumber(event.cash_adjustment)}` })}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (event.type === "loan") {
    const statusColors = {
      active: "text-cz-success",
      completed: "text-cz-3",
      buyout: "text-cz-accent-t",
      pending: "text-blue-600",
      cancelled: "text-red-500",
      rejected: "text-red-400",
    };
    const statusKey = event.status && `history.loan.status.${event.status}`;
    const statusLabel = statusKey ? t(statusKey, { defaultValue: event.status }) : "";
    return (
      <div className="px-4 py-3 flex items-start gap-3">
        <span className="text-cz-3 text-lg mt-0.5">📋</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-cz-2 font-medium">{t("history.loan.label")}</span>
            <span className={`text-xs font-medium ${statusColors[event.status] || "text-cz-3"}`}>{statusLabel}</span>
            <span className="text-cz-3 text-xs">{date}</span>
          </div>
          <p className="text-cz-2 text-sm mt-0.5">
            <TeamLink id={event.to_team?.id} className="font-medium hover:text-cz-accent-t transition-colors">{event.to_team?.name || t("history.loan.toFallback")}</TeamLink>
            <span className="text-cz-3"> {t("history.loan.borrows")} </span>
            <TeamLink id={event.from_team?.id} className="font-medium hover:text-cz-accent-t transition-colors">{event.from_team?.name || t("history.loan.fromFallback")}</TeamLink>
          </p>
          <p className="text-cz-3 text-xs mt-0.5">
            {t("history.loan.seasonRange", { start: event.start_season, end: event.end_season })}
            {event.loan_fee ? ` ${t("history.loan.feeSuffix", { amount: formatNumber(event.loan_fee) })}` : ""}
          </p>
        </div>
      </div>
    );
  }

  return null;
}
