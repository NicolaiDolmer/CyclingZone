import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { statStyle } from "../lib/statColor";
import { ConfettiModal } from "../components/ConfettiModal";
import { BidConfirmModal } from "../components/BidConfirmModal";
import { Flag } from "../components/Flag";
import { formatCz, getRiderMarketValue, getRiderSalary } from "../lib/marketValues.js";
import { formatNumber, formatDate } from "../lib/intl";
import { resolveApiError } from "../lib/apiError";
import { sortListings, LISTING_SORT_OPTIONS } from "../lib/transferListingSort";

const API = import.meta.env.VITE_API_URL;

// #987: faner kan deep-linkes via ?tab= (fx /transfers?tab=market fra nav'ens
// "Transferliste"-genvej). Ukendte værdier falder tilbage til "received".
const VALID_TABS = ["received", "sent", "archive", "swaps", "loans", "market"];
const DEFAULT_TAB = "received";

// Samme 14 stats som rytterdatabasen (#987: transferlisten skal vise alle
// stats, ikke kun BJ/SP/TT/FL). Labels matcher RidersPage/AuctionsPage.
const LISTING_STATS = [
  { key: "stat_fl", label: "FL" }, { key: "stat_bj", label: "BJ" },
  { key: "stat_kb", label: "KB" }, { key: "stat_bk", label: "BK" },
  { key: "stat_tt", label: "TT" }, { key: "stat_prl", label: "PRL" },
  { key: "stat_bro", label: "Bro" }, { key: "stat_sp", label: "SP" },
  { key: "stat_acc", label: "ACC" }, { key: "stat_ned", label: "NED" },
  { key: "stat_udh", label: "UDH" }, { key: "stat_mod", label: "MOD" },
  { key: "stat_res", label: "RES" }, { key: "stat_ftr", label: "FTR" },
];

function useTimeAgo() {
  const { t } = useTranslation("transfers");
  return (d) => {
    if (!d) return t("relativeTime.dash");
    const diff = new Date() - new Date(d);
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const day = Math.floor(diff / 86400000);
    if (m < 1) return t("relativeTime.justNow");
    if (m < 60) return t("relativeTime.minutes", { m });
    if (h < 24) return t("relativeTime.hours", { h });
    return t("relativeTime.days", { day });
  };
}

const STATUS_STYLE = {
  pending:                { color: "text-cz-accent-t",   bg: "bg-cz-accent/10 border-cz-accent/30" },
  countered:              { color: "text-cz-warning",  bg: "bg-cz-warning-bg border-cz-warning/30" },
  awaiting_confirmation:  { color: "text-cz-info",    bg: "bg-cz-info/20 border-cz-info/30" },
  window_pending:         { color: "text-violet-700",  bg: "bg-violet-50 border-violet-200" },
  accepted:               { color: "text-cz-success",   bg: "bg-cz-success-bg border-cz-success/30" },
  rejected:               { color: "text-cz-danger",     bg: "bg-cz-danger-bg border-cz-danger/30" },
  withdrawn:              { color: "text-cz-3",   bg: "bg-cz-subtle border-cz-border" },
};

const STATUS_LABEL_KEY = {
  pending: "status.pending",
  countered: "status.countered",
  awaiting_confirmation: "status.awaitingConfirmation",
  window_pending: "status.windowPending",
  accepted: "status.accepted",
  rejected: "status.rejected",
  withdrawn: "status.withdrawn",
};

function statusCfg(t, status) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.pending;
  const labelKey = STATUS_LABEL_KEY[status] || STATUS_LABEL_KEY.pending;
  return { ...style, label: t(labelKey) };
}

// ── Modtaget tilbud ──────────────────────────────────────────────────────────
function ReceivedOfferCard({ offer, onAction, showArchive = true }) {
  const { t } = useTranslation("transfers");
  const timeAgo = useTimeAgo();
  const [counterAmt, setCounterAmt] = useState(offer.offer_amount || 0);
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);

  const isPending = offer.status === "pending";
  const isAwaiting = offer.status === "awaiting_confirmation";
  const isWindowPending = offer.status === "window_pending";
  const canArchive = showArchive && ["accepted", "rejected", "withdrawn"].includes(offer.status);
  const cfg = statusCfg(t, offer.status);
  const priceNum = offer.counter_amount || offer.offer_amount;
  const price = priceNum != null ? formatNumber(priceNum) : "";

  async function doAction(action, extra = {}) {
    setLoading(true);
    try {
      await onAction(offer.id, action, extra);
      setMode(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`bg-cz-card border rounded-xl p-5 transition-all
      ${isAwaiting ? "border-blue-500/30" : isWindowPending ? "border-violet-300" : isPending ? "border-cz-accent/30" : "border-cz-border opacity-70"}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <div className="min-w-0">
          <RiderLink id={offer.rider?.id}
            className="text-cz-1 font-semibold hover:text-cz-accent-t transition-colors block">
            {offer.rider?.nationality_code && <Flag code={offer.rider.nationality_code} className="me-1" />}{offer.rider?.firstname} {offer.rider?.lastname}
          </RiderLink>
          <p className="text-cz-3 text-xs">{t("offerCard.from")}: <TeamLink id={offer.buyer?.id} className="hover:text-cz-accent-t transition-colors">{offer.buyer?.name || "—"}</TeamLink> · {t("offerCard.round", { round: offer.round || 1 })} · {timeAgo(offer.created_at)}</p>
        </div>
        <div className="flex flex-col gap-1 items-end flex-shrink-0">
          <span className={`text-[10px] uppercase px-2 py-1 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
          {offer.seller_squad_critical && (
            <span className="text-[10px] px-2 py-1 rounded-full border font-medium bg-cz-danger-bg text-cz-danger border-cz-danger/30 whitespace-nowrap">
              {t("offerCard.squadCriticalReceived")}
            </span>
          )}
        </div>
      </div>

      <div className="bg-cz-subtle rounded-lg px-4 py-3 mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-0.5">
            {offer.status === "countered" ? t("offerCard.counterLabel") : t("offerCard.offerLabel")}
          </p>
          <p className="text-cz-accent-t font-mono font-bold text-xl">
            {formatNumber(offer.status === "countered" ? offer.counter_amount : offer.offer_amount)} CZ$
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-cz-3 text-xs">{t("offerCard.value")}</p>
          <p className="text-cz-2 font-mono text-sm">{formatCz(getRiderMarketValue(offer.rider))}</p>
          <p className="text-cz-3 text-xs mt-1">
            {offer.rider?.contract_length != null ? t("offerCard.salary") : t("offerCard.estSalary")}:{" "}
            <span className="text-cz-2 font-mono">{formatCz(getRiderSalary(offer.rider))}</span>
          </p>
          {offer.rider?.contract_length != null ? (
            <p className="text-cz-3 text-[10px]">{t("offerCard.contractExpires", { season: offer.rider.contract_end_season })}</p>
          ) : (
            <p className="text-cz-3 text-[10px]">{t("offerCard.noContract")}</p>
          )}
        </div>
      </div>

      {offer.message && (
        <div className="bg-cz-subtle rounded-lg px-3 py-2 mb-3 text-cz-2 text-xs italic">
          &quot;{offer.message}&quot;
        </div>
      )}

      {isPending && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button onClick={() => doAction("accept")} disabled={loading}
              className="flex-1 py-2 bg-cz-success-bg text-cz-success border border-green-500/25 rounded-lg text-sm font-medium hover:bg-cz-success-bg0/25 transition-all disabled:opacity-50">
              {t("offerCard.buttons.accept")}
            </button>
            <button onClick={() => setMode(mode === "counter" ? null : "counter")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "counter"
                  ? "bg-cz-warning-bg0/20 text-cz-warning border-orange-500/30"
                  : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
              {t("offerCard.buttons.counter")}
            </button>
            <button onClick={() => doAction("reject")} disabled={loading}
              className="flex-1 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm font-medium hover:bg-cz-danger-bg transition-all disabled:opacity-50">
              {t("offerCard.buttons.reject")}
            </button>
          </div>

          {mode === "counter" && (
            <div className="bg-cz-subtle rounded-lg p-3 flex flex-col gap-2">
              <label className="text-cz-3 text-xs uppercase tracking-wider">{t("offerCard.form.counterLabel")}</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input type="number" value={counterAmt}
                  onChange={e => setCounterAmt(parseInt(e.target.value) || 0)}
                  className="min-w-0 flex-1 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono focus:outline-none focus:border-cz-accent" />
                <button onClick={() => doAction("counter", { counter_amount: counterAmt, message: msg })}
                  disabled={loading || counterAmt <= 0}
                  className="w-full sm:w-auto px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
                  {t("offerCard.buttons.send")}
                </button>
              </div>
              <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
                placeholder={t("offerCard.form.messageBuyer")}
                className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
            </div>
          )}
        </div>
      )}

      {isAwaiting && (
        <div className="flex flex-col gap-2">
          {offer.seller_confirmed ? (
            <div className="bg-cz-info-bg0/10 border border-blue-500/20 rounded-lg px-4 py-3 text-center">
              <p className="text-blue-300 text-sm font-medium">{t("offerCard.awaiting.sellerAccepted")}</p>
              <p className="text-cz-3 text-xs mt-1">{price} CZ$ · {offer.buyer?.name}</p>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => doAction("confirm")} disabled={loading}
                className="flex-1 py-2 bg-cz-info-bg text-cz-info border border-blue-500/25 rounded-lg text-sm font-medium hover:bg-cz-info-bg0/25 transition-all disabled:opacity-50">
                {t("offerCard.buttons.confirmDeal", { amount: price })}
              </button>
            </div>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="w-full py-2 bg-cz-danger-bg0/5 text-cz-danger/70 border border-red-500/15 rounded-lg text-sm
              hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
            {t("offerCard.buttons.cancelDeal")}
          </button>
        </div>
      )}

      {isWindowPending && (
        <div className="flex flex-col gap-2">
          <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-3 text-center">
            <p className="text-violet-700 text-sm font-medium">{t("offerCard.awaiting.windowPending")}</p>
            <p className="text-cz-3 text-xs mt-1">{price} CZ$</p>
          </div>
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="w-full py-2 bg-cz-danger-bg0/5 text-cz-danger/70 border border-red-500/15 rounded-lg text-sm
              hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
            {t("offerCard.buttons.cancelDeal")}
          </button>
        </div>
      )}

      {canArchive && (
        <button onClick={() => doAction("archive")} disabled={loading}
          className="mt-3 w-full py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-border transition-all disabled:opacity-50">
          {t("offerCard.buttons.archive")}
        </button>
      )}
    </div>
  );
}

// ── Sendt tilbud ─────────────────────────────────────────────────────────────
function SentOfferCard({ offer, onAction, showArchive = true }) {
  const { t } = useTranslation("transfers");
  const timeAgo = useTimeAgo();
  const [newAmt, setNewAmt] = useState(offer.counter_amount || offer.offer_amount || 0);
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);

  const isCountered = offer.status === "countered";
  const isPending = offer.status === "pending";
  const isAwaiting = offer.status === "awaiting_confirmation";
  const isWindowPending = offer.status === "window_pending";
  const isActive = isCountered || isPending || isAwaiting;
  const canArchive = showArchive && ["accepted", "rejected", "withdrawn"].includes(offer.status);
  const cfg = statusCfg(t, offer.status);
  const priceNum = offer.counter_amount || offer.offer_amount;
  const price = priceNum != null ? formatNumber(priceNum) : "";

  async function doAction(action, extra = {}) {
    setLoading(true);
    try {
      await onAction(offer.id, action, extra);
      setMode(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`bg-cz-card border rounded-xl p-5 transition-all
      ${isAwaiting ? "border-blue-500/30" : isWindowPending ? "border-violet-300" : isCountered ? "border-cz-warning/30" : isActive ? "border-cz-border" : "border-cz-border opacity-60"}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <div className="min-w-0">
          <RiderLink id={offer.rider?.id}
            className="text-cz-1 font-semibold hover:text-cz-accent-t transition-colors block">
            {offer.rider?.nationality_code && <Flag code={offer.rider.nationality_code} className="me-1" />}{offer.rider?.firstname} {offer.rider?.lastname}
          </RiderLink>
          <p className="text-cz-3 text-xs">{t("offerCard.to")}: <TeamLink id={offer.seller?.id} className="hover:text-cz-accent-t transition-colors">{offer.seller?.name || "—"}</TeamLink> · {t("offerCard.round", { round: offer.round || 1 })} · {timeAgo(offer.updated_at)}</p>
        </div>
        <div className="flex flex-col gap-1 items-end flex-shrink-0">
          <span className={`text-[10px] uppercase px-2 py-1 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
          {offer.seller_squad_critical && (
            <span className="text-[10px] px-2 py-1 rounded-full border font-medium bg-cz-danger-bg text-cz-danger border-cz-danger/30 whitespace-nowrap">
              {t("offerCard.squadCriticalSent")}
            </span>
          )}
        </div>
      </div>

      <div className="bg-cz-subtle rounded-lg px-4 py-3 mb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-0.5">{t("offerCard.yourBidLabel")}</p>
            <p className="text-cz-1 font-mono font-bold text-lg">{formatNumber(offer.offer_amount)} CZ$</p>
          </div>
          {isCountered && offer.counter_amount && (
            <div className="sm:text-right">
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-0.5">{t("offerCard.counterLabel")}</p>
              <p className="text-cz-warning font-mono font-bold text-lg">{formatNumber(offer.counter_amount)} CZ$</p>
            </div>
          )}
        </div>
      </div>

      {offer.message && (
        <div className="bg-cz-subtle rounded-lg px-3 py-2 mb-3 text-cz-2 text-xs italic">
          &quot;{offer.message}&quot;
        </div>
      )}

      {isCountered && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
            <button onClick={() => doAction("accept_counter")} disabled={loading}
              className="flex-1 py-2 bg-cz-success-bg text-cz-success border border-green-500/25 rounded-lg text-sm font-medium hover:bg-cz-success-bg0/25 disabled:opacity-50">
              {t("offerCard.buttons.acceptCounter", { amount: formatNumber(offer.counter_amount) })}
            </button>
            <button onClick={() => setMode(mode === "new_offer" ? null : "new_offer")}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "new_offer"
                  ? "bg-cz-info-bg0/20 text-cz-info border-blue-500/30"
                  : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
              {t("offerCard.buttons.newOffer")}
            </button>
            <button onClick={() => doAction("withdraw")} disabled={loading}
              className="px-4 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm font-medium hover:bg-cz-danger-bg disabled:opacity-50">
              {t("offerCard.buttons.withdraw")}
            </button>
          </div>

          {mode === "new_offer" && (
            <div className="bg-cz-subtle rounded-lg p-3 flex flex-col gap-2">
              <label className="text-cz-3 text-xs uppercase tracking-wider">{t("offerCard.form.newOfferLabel")}</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input type="number" value={newAmt}
                  onChange={e => setNewAmt(parseInt(e.target.value) || 0)}
                  className="min-w-0 flex-1 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono focus:outline-none focus:border-cz-accent" />
                <button onClick={() => doAction("new_offer", { counter_amount: newAmt, message: msg })}
                  disabled={loading || newAmt <= 0}
                  className="w-full sm:w-auto px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
                  {t("offerCard.buttons.send")}
                </button>
              </div>
              <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
                placeholder={t("offerCard.form.messagePlaceholder")}
                className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
            </div>
          )}
        </div>
      )}

      {isPending && (
        <button onClick={() => doAction("withdraw")} disabled={loading}
          className="w-full py-2 bg-cz-subtle text-cz-3 border border-cz-border rounded-lg text-sm
            hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
          {t("offerCard.buttons.withdrawOffer")}
        </button>
      )}

      {isAwaiting && (
        <div className="flex flex-col gap-2">
          {offer.buyer_confirmed ? (
            <div className="bg-cz-info-bg0/10 border border-blue-500/20 rounded-lg px-4 py-3 text-center">
              <p className="text-blue-300 text-sm font-medium">{t("offerCard.awaiting.buyerConfirmed")}</p>
              <p className="text-cz-3 text-xs mt-1">{price} CZ$ · {offer.seller?.name}</p>
            </div>
          ) : (
            <button onClick={() => doAction("confirm")} disabled={loading}
              className="w-full py-2 bg-cz-info-bg text-cz-info border border-blue-500/25 rounded-lg text-sm font-medium hover:bg-cz-info-bg0/25 transition-all disabled:opacity-50">
              {t("offerCard.buttons.confirmDeal", { amount: price })}
            </button>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="w-full py-2 bg-cz-danger-bg0/5 text-cz-danger/70 border border-red-500/15 rounded-lg text-sm
              hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
            {t("offerCard.buttons.cancelDeal")}
          </button>
        </div>
      )}

      {isWindowPending && (
        <div className="flex flex-col gap-2">
          <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-3 text-center">
            <p className="text-violet-700 text-sm font-medium">{t("offerCard.awaiting.windowPending")}</p>
            <p className="text-cz-3 text-xs mt-1">{price} CZ$</p>
          </div>
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="w-full py-2 bg-cz-danger-bg0/5 text-cz-danger/70 border border-red-500/15 rounded-lg text-sm
              hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
            {t("offerCard.buttons.cancelDeal")}
          </button>
        </div>
      )}

      {canArchive && (
        <button onClick={() => doAction("archive")} disabled={loading}
          className="mt-3 w-full py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-border transition-all disabled:opacity-50">
          {t("offerCard.buttons.archive")}
        </button>
      )}
    </div>
  );
}

// ── Swap offer card ──────────────────────────────────────────────────────────
function SwapCard({ swap, myTeamId, onAction }) {
  const { t } = useTranslation("transfers");
  const [counterCash, setCounterCash] = useState(swap.counter_cash ?? swap.cash_adjustment ?? 0);
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);

  const isProposing     = swap.proposing?.id === myTeamId;
  const isReceiving     = swap.receiving?.id === myTeamId;
  const isPending       = swap.status === "pending";
  const isCountered     = swap.status === "countered";
  const isAwaiting      = swap.status === "awaiting_confirmation";
  const isWindowPending = swap.status === "window_pending";
  const cfg = statusCfg(t, swap.status);

  const effectiveCash = isCountered ? swap.counter_cash : swap.cash_adjustment;
  const cashLabel = effectiveCash === 0 ? t("swapCard.pureSwap")
    : effectiveCash > 0 ? t("swapCard.cashFrom", { amount: formatNumber(effectiveCash), team: swap.proposing?.name })
    : t("swapCard.cashFrom", { amount: formatNumber(Math.abs(effectiveCash)), team: swap.receiving?.name });

  async function doAction(action, extra = {}) {
    setLoading(true);
    try {
      await onAction(swap.id, action, extra);
      setMode(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`bg-cz-card border rounded-xl p-5 transition-all
      ${isAwaiting ? "border-blue-500/30" : isWindowPending ? "border-violet-300" : isCountered ? "border-cz-warning/30" : isPending ? "border-cz-border" : "border-cz-border opacity-60"}`}>

      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-cz-3 text-xs">
            {isProposing ? `${t("offerCard.to")}: ${swap.receiving?.name}` : `${t("offerCard.from")}: ${swap.proposing?.name}`}
          </p>
        </div>
        <span className={`text-[10px] uppercase px-2 py-1 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
          {cfg.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        {[
          { label: isProposing ? t("swapCard.youOffer") : t("swapCard.theyOffer"), rider: swap.offered },
          { label: isProposing ? t("swapCard.youWant")  : t("swapCard.theyWant"),  rider: swap.requested },
        ].map(({ label, rider }) => (
          <div key={rider?.id} className="bg-cz-subtle rounded-lg px-3 py-2">
            <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-1">{label}</p>
            <RiderLink id={rider?.id}
              className="text-cz-1 text-sm font-semibold hover:text-cz-accent-t transition-colors block">
              {rider?.firstname} {rider?.lastname}
            </RiderLink>
            <div className="flex gap-2 mt-1">
              {[["BJ", "stat_bj"], ["SP", "stat_sp"], ["TT", "stat_tt"], ["FL", "stat_fl"]].map(([l, k]) => (
                <span key={k} className="text-[10px] text-cz-3">{l}<span className="text-cz-2 ms-0.5">{rider?.[k] ?? "—"}</span></span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={`rounded-lg px-3 py-2 mb-3 text-xs text-center font-medium
        ${effectiveCash === 0 ? "bg-cz-subtle text-cz-2" : "bg-cz-accent/10 text-cz-accent-t/80"}`}>
        {cashLabel}
        {isCountered && <span className="text-cz-warning ms-2">{t("swapCard.counterTag")}</span>}
      </div>

      {swap.message && (
        <div className="bg-cz-subtle rounded-lg px-3 py-2 mb-3 text-cz-2 text-xs italic">
          &quot;{swap.message}&quot;
        </div>
      )}

      {isPending && isReceiving && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button onClick={() => doAction("accept")} disabled={loading}
              className="flex-1 py-2 bg-cz-success-bg text-cz-success border border-green-500/25 rounded-lg text-sm font-medium hover:bg-cz-success-bg0/25 disabled:opacity-50">
              {t("swapCard.buttons.accept")}
            </button>
            <button onClick={() => setMode(mode === "counter" ? null : "counter")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "counter" ? "bg-cz-warning-bg0/20 text-cz-warning border-orange-500/30" : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
              {t("swapCard.buttons.counter")}
            </button>
            <button onClick={() => doAction("reject")} disabled={loading}
              className="flex-1 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm font-medium hover:bg-cz-danger-bg disabled:opacity-50">
              {t("swapCard.buttons.reject")}
            </button>
          </div>
          {mode === "counter" && (
            <div className="bg-cz-subtle rounded-lg p-3 flex flex-col gap-2">
              <label className="text-cz-3 text-xs uppercase tracking-wider">{t("swapCard.form.cashReceiveLabel")}</label>
              <div className="flex gap-2">
                <input type="number" value={counterCash}
                  onChange={e => setCounterCash(parseInt(e.target.value) || 0)}
                  className="flex-1 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono focus:outline-none focus:border-cz-accent" />
                <button onClick={() => doAction("counter", { counter_cash: -counterCash })}
                  disabled={loading}
                  className="px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
                  {t("swapCard.buttons.send")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isPending && isProposing && (
        <button onClick={() => doAction("withdraw")} disabled={loading}
          className="w-full py-2 bg-cz-subtle text-cz-3 border border-cz-border rounded-lg text-sm
            hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
          {t("swapCard.buttons.withdraw")}
        </button>
      )}

      {isCountered && isProposing && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button onClick={() => doAction("accept_counter")} disabled={loading}
              className="flex-1 py-2 bg-cz-success-bg text-cz-success border border-green-500/25 rounded-lg text-sm font-medium hover:bg-cz-success-bg0/25 disabled:opacity-50">
              {t("swapCard.buttons.acceptCounter")}
            </button>
            <button onClick={() => setMode(mode === "counter" ? null : "counter")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "counter" ? "bg-cz-warning-bg0/20 text-cz-warning border-orange-500/30" : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
              {t("swapCard.buttons.counter")}
            </button>
            <button onClick={() => doAction("withdraw")} disabled={loading}
              className="px-4 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm hover:bg-cz-danger-bg disabled:opacity-50">
              {t("swapCard.buttons.rejectShort")}
            </button>
          </div>
          {mode === "counter" && (
            <div className="bg-cz-subtle rounded-lg p-3 flex flex-col gap-2">
              <label className="text-cz-3 text-xs uppercase tracking-wider">{t("swapCard.form.cashPayLabel")}</label>
              <div className="flex gap-2">
                <input type="number" value={counterCash}
                  onChange={e => setCounterCash(parseInt(e.target.value) || 0)}
                  className="flex-1 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono focus:outline-none focus:border-cz-accent" />
                <button onClick={() => doAction("counter", { counter_cash: counterCash })}
                  disabled={loading}
                  className="px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
                  {t("swapCard.buttons.send")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isAwaiting && (
        <div className="flex flex-col gap-2">
          {(isProposing ? swap.proposing_confirmed : swap.receiving_confirmed) ? (
            <div className="bg-cz-info-bg0/10 border border-blue-500/20 rounded-lg px-4 py-3 text-center">
              <p className="text-blue-300 text-sm font-medium">{t("swapCard.awaiting.selfConfirmed")}</p>
            </div>
          ) : (
            <button onClick={() => doAction("confirm")} disabled={loading}
              className="w-full py-2 bg-cz-info-bg text-cz-info border border-blue-500/25 rounded-lg text-sm font-medium hover:bg-cz-info-bg0/25 disabled:opacity-50">
              {t("swapCard.buttons.confirmSwap")}
            </button>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="w-full py-2 bg-cz-danger-bg0/5 text-cz-danger/70 border border-red-500/15 rounded-lg text-sm
              hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
            {t("swapCard.buttons.cancelSwap")}
          </button>
        </div>
      )}

      {isWindowPending && (
        <div className="flex flex-col gap-2">
          <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-3 text-center">
            <p className="text-violet-700 text-sm font-medium">{t("swapCard.awaiting.windowPending")}</p>
          </div>
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="w-full py-2 bg-cz-danger-bg0/5 text-cz-danger/70 border border-red-500/15 rounded-lg text-sm
              hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
            {t("swapCard.buttons.cancelSwap")}
          </button>
        </div>
      )}
    </div>
  );
}

// ── New swap form ─────────────────────────────────────────────────────────────
function NewSwapForm({ myRiders, onSubmit, onCancel }) {
  const { t } = useTranslation("transfers");
  const [offeredId, setOfferedId]   = useState("");
  const [requestedId, setRequestedId] = useState("");
  const [cash, setCash]             = useState(0);
  const [msg, setMsg]               = useState("");
  const [search, setSearch]         = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedRequested, setSelectedRequested] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [searching, setSearching]   = useState(false);

  async function runSearch(q) {
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("riders")
        .select("id, firstname, lastname, market_value, team_id, team:team_id(name)")
      .ilike("lastname", `%${q}%`)
      .eq("is_retired", false)
      .not("team_id", "is", null)
      .limit(20);
    setSearchResults((data || []).filter(r => !myRiders.find(m => m.id === r.id)));
    setSearching(false);
  }

  function pickRequested(rider) {
    setSelectedRequested(rider);
    setRequestedId(rider.id);
    setSearch(`${rider.firstname} ${rider.lastname}`);
    setSearchResults([]);
  }

  async function handleSubmit() {
    if (!offeredId || !requestedId) return;
    setLoading(true);
    try {
      await onSubmit({ offered_rider_id: offeredId, requested_rider_id: requestedId, cash_adjustment: cash, message: msg });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5 flex flex-col gap-4">
      <h3 className="text-cz-1 font-semibold">{t("newSwap.title")}</h3>

      <div>
        <label className="text-cz-3 text-xs uppercase tracking-wider mb-1 block">{t("newSwap.offeredLabel")}</label>
        <select value={offeredId} onChange={e => setOfferedId(e.target.value)}
          className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent">
          <option value="">{t("newSwap.selectRider")}</option>
          {myRiders.map(r => (
              <option key={r.id} value={r.id}>{r.firstname} {r.lastname} ({formatCz(getRiderMarketValue(r))})</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-cz-3 text-xs uppercase tracking-wider mb-1 block">{t("newSwap.requestedLabel")}</label>
        <div className="relative">
          <input type="text" value={search}
            onChange={e => { setSearch(e.target.value); runSearch(e.target.value); }}
            placeholder={t("newSwap.lastnamePlaceholder")}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent" />
          {searching && <span className="absolute right-3 top-2.5 text-cz-3 text-xs">...</span>}
          {searchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-cz-subtle border border-cz-border rounded-lg overflow-hidden shadow-lg">
              {searchResults.map(r => (
                <button key={r.id} onClick={() => pickRequested(r)}
                  className="w-full text-left px-3 py-2 hover:bg-cz-subtle text-cz-1 text-sm border-b border-cz-border last:border-0">
                  {r.firstname} {r.lastname}
                        <span className="text-cz-3 text-xs ms-2">{r.team?.name} · {formatCz(getRiderMarketValue(r))}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedRequested && (
          <p className="text-cz-accent-t/70 text-xs mt-1">{t("newSwap.selectedRider", { firstname: selectedRequested.firstname, lastname: selectedRequested.lastname, team: selectedRequested.team?.name })}</p>
        )}
      </div>

      <div>
        <label className="text-cz-3 text-xs uppercase tracking-wider mb-1 block">
          {t("newSwap.cashLabel")}
        </label>
        <input type="number" value={cash} onChange={e => setCash(parseInt(e.target.value) || 0)}
          className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none focus:border-cz-accent" />
      </div>

      <div>
        <label className="text-cz-3 text-xs uppercase tracking-wider mb-1 block">{t("newSwap.messageLabel")}</label>
        <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
          placeholder={t("newSwap.messagePlaceholder")}
          className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
      </div>

      <div className="flex gap-2">
        <button onClick={handleSubmit} disabled={loading || !offeredId || !requestedId}
          className="flex-1 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-40">
          {loading ? t("newSwap.sending") : t("newSwap.submit")}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-subtle">
          {t("newSwap.cancel")}
        </button>
      </div>
    </div>
  );
}

// ── Loan agreement card ───────────────────────────────────────────────────────
const LOAN_STATUS_STYLE = {
  pending:   { color: "text-cz-accent-t",   bg: "bg-cz-accent/10 border-cz-accent/30" },
  active:    { color: "text-purple-400",  bg: "bg-purple-500/10 border-purple-500/20" },
  buyout:    { color: "text-cz-success",   bg: "bg-cz-success-bg border-cz-success/30" },
  cancelled: { color: "text-cz-3",    bg: "bg-cz-subtle border-cz-border" },
  rejected:  { color: "text-cz-danger",     bg: "bg-cz-danger-bg border-cz-danger/30" },
};

const LOAN_STATUS_LABEL_KEY = {
  pending: "loanStatus.pending",
  active: "loanStatus.active",
  buyout: "loanStatus.buyout",
  cancelled: "loanStatus.cancelled",
  rejected: "loanStatus.rejected",
};

function loanCfg(t, status) {
  const style = LOAN_STATUS_STYLE[status] || LOAN_STATUS_STYLE.pending;
  const labelKey = LOAN_STATUS_LABEL_KEY[status] || LOAN_STATUS_LABEL_KEY.pending;
  return { ...style, label: t(labelKey) };
}

function LoanCard({ loan, myTeamId, onAction }) {
  const { t } = useTranslation("transfers");
  const [loading, setLoading] = useState(false);
  const isLender   = loan.from_team?.id === myTeamId;
  const isBorrower = loan.to_team?.id   === myTeamId;
  const cfg = loanCfg(t, loan.status);

  async function doAction(action) {
    setLoading(true);
    await onAction(loan.id, action);
    setLoading(false);
  }

  const seasons = loan.start_season === loan.end_season
    ? t("loanCard.seasonsSingle", { start: loan.start_season })
    : t("loanCard.seasonsRange", { start: loan.start_season, end: loan.end_season });

  return (
    <div className={`bg-cz-card border rounded-xl p-5 transition-all
      ${loan.status === "active" ? "border-purple-500/20" : loan.status === "pending" ? "border-cz-accent/30" : "border-cz-border opacity-70"}`}>

      <div className="flex items-start justify-between mb-3">
        <div>
          <RiderLink id={loan.rider?.id}
            className="text-cz-1 font-semibold hover:text-cz-accent-t transition-colors block">
            {loan.rider?.firstname} {loan.rider?.lastname}
          </RiderLink>
          <p className="text-cz-3 text-xs">
            {isLender ? `${t("loanCard.to")}: ${loan.to_team?.name}` : `${t("loanCard.from")}: ${loan.from_team?.name}`} · {seasons}
          </p>
        </div>
        <span className={`text-[10px] uppercase px-2 py-1 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
          {cfg.label}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-cz-subtle rounded-lg px-3 py-2 text-center">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-0.5">{t("loanCard.feeLabel")}</p>
          <p className="text-cz-1 font-mono text-sm font-bold">{formatNumber(loan.loan_fee)} CZ$</p>
        </div>
        <div className="bg-cz-subtle rounded-lg px-3 py-2 text-center">
            <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-0.5">{t("loanCard.valueLabel")}</p>
            <p className="text-cz-accent-t font-mono text-sm font-bold">{formatCz(getRiderMarketValue(loan.rider))}</p>
        </div>
        <div className="bg-cz-subtle rounded-lg px-3 py-2 text-center">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-0.5">{t("loanCard.buyOptionLabel")}</p>
          <p className="text-cz-2 font-mono text-sm">
            {loan.buy_option_price ? `${formatNumber(loan.buy_option_price)} CZ$` : t("loanCard.noBuyOption")}
          </p>
        </div>
      </div>

      {loan.status === "pending" && isLender && (
        <div className="flex gap-2">
          <button onClick={() => doAction("accept")} disabled={loading}
            className="flex-1 py-2 bg-cz-success-bg text-cz-success border border-green-500/25 rounded-lg text-sm font-medium hover:bg-cz-success-bg0/25 disabled:opacity-50">
            {t("loanCard.buttons.accept")}
          </button>
          <button onClick={() => doAction("reject")} disabled={loading}
            className="flex-1 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm font-medium hover:bg-cz-danger-bg disabled:opacity-50">
            {t("loanCard.buttons.reject")}
          </button>
        </div>
      )}
      {loan.status === "pending" && isBorrower && (
        <button onClick={() => doAction("cancel")} disabled={loading}
          className="w-full py-2 bg-cz-subtle text-cz-3 border border-cz-border rounded-lg text-sm
            hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
          {t("loanCard.buttons.withdraw")}
        </button>
      )}
      {loan.status === "active" && (
        <div className="flex flex-col gap-2">
          {isBorrower && loan.buy_option_price && (
            <button onClick={() => doAction("buyout")} disabled={loading}
              className="w-full py-2 bg-cz-success-bg text-cz-success border border-green-500/25 rounded-lg text-sm font-medium hover:bg-cz-success-bg0/25 disabled:opacity-50">
              {t("loanCard.buttons.exerciseBuyout", { amount: formatNumber(loan.buy_option_price) })}
            </button>
          )}
          {/* #156: aktive lejeaftaler er bindende — kun admin kan annullere. */}
          <p className="text-cz-3 text-xs italic">
            {t("loanCard.bindingNote")}
          </p>
        </div>
      )}
    </div>
  );
}

// ── New loan form ─────────────────────────────────────────────────────────────
function NewLoanForm({ myTeamId, onSubmit, onCancel }) {
  const { t } = useTranslation("transfers");
  const [search, setSearch]           = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedRider, setSelectedRider] = useState(null);
  const [loanFee, setLoanFee]         = useState(0);
  const [startSeason, setStartSeason] = useState("");
  const [buyOption, setBuyOption]     = useState("");
  const [loading, setLoading]         = useState(false);
  const [searching, setSearching]     = useState(false);

  async function runSearch(q) {
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("riders")
        .select("id, firstname, lastname, market_value, team_id, team:team_id(id, name)")
      .ilike("lastname", `%${q}%`)
      .eq("is_retired", false)
      .not("team_id", "is", null)
      .limit(20);
    setSearchResults((data || []).filter(r => r.team_id !== myTeamId));
    setSearching(false);
  }

  async function handleSubmit() {
    if (!selectedRider || !startSeason) return;
    setLoading(true);
    try {
      await onSubmit({
        rider_id: selectedRider.id,
        loan_fee: loanFee,
        start_season: parseInt(startSeason),
        end_season: parseInt(startSeason),
        buy_option_price: buyOption ? parseInt(buyOption) : null,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5 flex flex-col gap-4">
      <h3 className="text-cz-1 font-semibold">{t("newLoan.title")}</h3>

      <div>
        <label className="text-cz-3 text-xs uppercase tracking-wider mb-1 block">{t("newLoan.riderLabel")}</label>
        <div className="relative">
          <input type="text" value={search}
            onChange={e => { setSearch(e.target.value); runSearch(e.target.value); }}
            placeholder={t("newLoan.lastnamePlaceholder")}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent" />
          {searching && <span className="absolute right-3 top-2.5 text-cz-3 text-xs">...</span>}
          {searchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-cz-subtle border border-cz-border rounded-lg overflow-hidden shadow-lg">
              {searchResults.map(r => (
                <button key={r.id} onClick={() => { setSelectedRider(r); setSearch(`${r.firstname} ${r.lastname}`); setSearchResults([]); }}
                  className="w-full text-left px-3 py-2 hover:bg-cz-subtle text-cz-1 text-sm border-b border-cz-border last:border-0">
                  {r.firstname} {r.lastname}
                    <span className="text-cz-3 text-xs ms-2">{r.team?.name} · {formatCz(getRiderMarketValue(r))}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedRider && (
          <p className="text-purple-400/70 text-xs mt-1">{t("newLoan.selectedRider", { firstname: selectedRider.firstname, lastname: selectedRider.lastname, team: selectedRider.team?.name })}</p>
        )}
      </div>

      <div>
        <label className="text-cz-3 text-xs uppercase tracking-wider mb-1 block">{t("newLoan.seasonLabel")}</label>
        <input type="number" value={startSeason} onChange={e => setStartSeason(e.target.value)}
          placeholder={t("newLoan.seasonPlaceholder")}
          className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none focus:border-cz-accent" />
      </div>

      <div>
        <label className="text-cz-3 text-xs uppercase tracking-wider mb-1 block">{t("newLoan.feeLabel")}</label>
        <input type="number" value={loanFee} onChange={e => setLoanFee(parseInt(e.target.value) || 0)}
          className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none focus:border-cz-accent" />
      </div>

      <div>
        <label className="text-cz-3 text-xs uppercase tracking-wider mb-1 block">{t("newLoan.buyOptionLabel")}</label>
        <input type="number" value={buyOption} onChange={e => setBuyOption(e.target.value)}
          placeholder={t("newLoan.buyOptionPlaceholder")}
          className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none focus:border-cz-accent" />
      </div>

      <div className="flex gap-2">
        <button onClick={handleSubmit} disabled={loading || !selectedRider || !startSeason}
          className="flex-1 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-40">
          {loading ? t("newLoan.sending") : t("newLoan.submit")}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-subtle">
          {t("newLoan.cancel")}
        </button>
      </div>
    </div>
  );
}

// ── Egne listings: redigér pris + fjern (#1185) ──────────────────────────────
// Fjern-flowet bruger in-app confirm i stedet for window.confirm — native
// confirm-dialoger undertrykkes i visse mobile in-app-browsere/PWA-kontekster,
// så knappen virkede ikke for alle på mobil. Eneste player-facing window.confirm
// i appen lå her.
function OwnListingActions({ listing, riderName, onRemove, onUpdatePrice }) {
  const { t } = useTranslation("transfers");
  const [mode, setMode] = useState(null); // null | "edit" | "confirmRemove"
  const [price, setPrice] = useState(listing.asking_price || 0);
  const [busy, setBusy] = useState(false);

  const priceInvalid = !Number.isInteger(price) || price <= 0;

  async function savePrice() {
    setBusy(true);
    try {
      // Luk kun edit-formen ved succes — ved fejl (toast vises af parent)
      // beholder vi formen åben så prisen kan rettes uden at genåbne.
      const ok = await onUpdatePrice(listing.id, price);
      if (ok) setMode(null);
    } finally {
      setBusy(false);
    }
  }

  async function performRemove() {
    setBusy(true);
    try {
      await onRemove(listing.id, riderName);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "edit") {
    return (
      <div className="bg-cz-subtle rounded-lg p-3 flex flex-col gap-2">
        <label className="text-cz-3 text-xs uppercase tracking-wider">{t("transferCard.editPriceLabel")}</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="number" value={price} min={1}
            onChange={e => { const v = parseInt(e.target.value, 10); setPrice(Number.isNaN(v) ? 0 : v); }}
            className="min-w-0 flex-1 min-h-[44px] bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none focus:border-cz-accent" />
          <div className="flex gap-2">
            <button onClick={savePrice} disabled={busy || priceInvalid}
              className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50 transition-all">
              {busy ? "..." : t("transferCard.savePrice")}
            </button>
            <button onClick={() => { setMode(null); setPrice(listing.asking_price || 0); }} disabled={busy}
              className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 bg-cz-card text-cz-2 border border-cz-border rounded-lg text-sm hover:text-cz-1 disabled:opacity-50 transition-all">
              {t("transferCard.cancel")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "confirmRemove") {
    return (
      <div className="bg-cz-subtle rounded-lg p-3 flex flex-col gap-2">
        <p className="text-cz-2 text-sm">{t("transferCard.removeConfirm", { riderName })}</p>
        <div className="flex gap-2">
          <button onClick={performRemove} disabled={busy}
            className="flex-1 min-h-[44px] py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm font-medium hover:bg-cz-danger-bg disabled:opacity-50 transition-all">
            {busy ? t("transferCard.removing") : t("transferCard.confirmRemoveButton")}
          </button>
          <button onClick={() => setMode(null)} disabled={busy}
            className="flex-1 min-h-[44px] py-2 bg-cz-card text-cz-2 border border-cz-border rounded-lg text-sm hover:text-cz-1 disabled:opacity-50 transition-all">
            {t("transferCard.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <button onClick={() => { setPrice(listing.asking_price || 0); setMode("edit"); }}
        aria-label={t("transferCard.editPriceAria", { riderName })}
        className="min-h-[44px] py-2 rounded-lg text-sm font-medium transition-all border
          bg-cz-subtle text-cz-2 border-cz-border hover:text-cz-1 hover:border-cz-accent/40">
        {t("transferCard.editPrice")}
      </button>
      <button onClick={() => setMode("confirmRemove")}
        aria-label={t("transferCard.removeAria", { riderName })}
        className="min-h-[44px] py-2 rounded-lg text-sm font-medium transition-all border
          bg-cz-subtle text-cz-2 border-cz-border
          hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30">
        {t("transferCard.removeListing")}
      </button>
    </div>
  );
}

// ── Transfer market listing card ─────────────────────────────────────────────
function TransferCard({ listing, myTeamId, onOffer, onRemove, onUpdatePrice, windowOpen = true }) {
  const { t } = useTranslation("transfers");
  const [offerAmt, setOfferAmt] = useState(listing.asking_price || 0);
  const [msg, setMsg] = useState("");
  const [showOffer, setShowOffer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isOwn = listing.seller?.id === myTeamId;
  const riderName = listing.rider ? `${listing.rider.firstname} ${listing.rider.lastname}` : t("transferCard.ridersForSale");

  async function performSendOffer() {
    setLoading(true);
    try {
      await onOffer(listing.rider?.id, offerAmt, msg);
      setShowOffer(false);
      setConfirmOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-cz-card border border-cz-border hover:border-cz-border rounded-xl p-4 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div>
          <RiderLink id={listing.rider?.id} className="cursor-pointer block">
            <p className="text-cz-1 font-semibold hover:text-cz-accent-t transition-colors">
              {listing.rider?.nationality_code && <Flag code={listing.rider.nationality_code} className="me-1" />}{listing.rider?.firstname} {listing.rider?.lastname}
            </p>
          </RiderLink>
          <p className="text-cz-3 text-xs mt-0.5">
            <TeamLink id={listing.seller?.id} className="hover:text-cz-accent-t transition-colors">{listing.seller?.name || "—"}</TeamLink>
          </p>
          {listing.created_at && (
            <p className="text-cz-3 text-xs mt-0.5">
              {t("transferCard.listedSince", { date: formatDate(listing.created_at, null, { day: "numeric", month: "short" }) })}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-cz-accent-t font-mono font-bold text-lg">{formatNumber(listing.asking_price)} CZ$</p>
      <p className="text-cz-3 text-xs">{t("transferCard.valueLabel", { value: formatCz(getRiderMarketValue(listing.rider)) })}</p>
        </div>
      </div>

      {/* #987: alle 14 stats som på rytterdatabasen — ikke kun BJ/SP/TT/FL */}
      <div className="grid grid-cols-7 gap-x-1 gap-y-2 mb-3">
        {LISTING_STATS.map(({ key, label }) => (
          <div key={key} className="text-center">
            <p className="text-cz-3 text-[9px] uppercase">{label}</p>
            <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded" style={statStyle(listing.rider?.[key] || 0)}>
              {listing.rider?.[key] || "—"}
            </span>
          </div>
        ))}
      </div>

      {!isOwn && (
        <div>
          <button onClick={() => setShowOffer(!showOffer)}
            className={`w-full py-2 rounded-lg text-sm font-medium transition-all border
              ${showOffer
                  ? "bg-cz-accent/10 text-cz-accent-t border-[#e8c547]/25"
                  : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle hover:text-cz-1"}`}>
            {showOffer ? t("transferCard.hide") : t("transferCard.sendOffer")}
          </button>

          {showOffer && (
            <div className="mt-2 flex flex-col gap-2">
              {!windowOpen && (
                <p className="rounded-lg border border-cz-border bg-cz-subtle px-3 py-2 text-xs text-cz-2">
                  {t("transferCard.windowPendingHint")}
                </p>
              )}
              <div className="flex gap-2">
                <input type="number" value={offerAmt}
                  onChange={e => setOfferAmt(parseInt(e.target.value) || 0)}
                  className="flex-1 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none focus:border-cz-accent" />
                <button
                  onClick={() => { if (offerAmt > 0) setConfirmOpen(true); }}
                  disabled={loading || offerAmt <= 0}
                  className="px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
                  {loading ? "..." : t("transferCard.send")}
                </button>
              </div>
              <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
                placeholder={t("transferCard.messagePlaceholder")}
                className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-xs focus:outline-none" />
            </div>
          )}
        </div>
      )}
      {isOwn && (
        <OwnListingActions
          listing={listing}
          riderName={riderName}
          onRemove={onRemove}
          onUpdatePrice={onUpdatePrice}
        />
      )}
      <BidConfirmModal
        show={confirmOpen}
        mode="transfer"
        riderName={riderName}
        amount={offerAmt}
        busy={loading}
        onCancel={() => { if (!loading) setConfirmOpen(false); }}
        onConfirm={performSendOffer}
      />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function TransfersPage() {
  const { t } = useTranslation("transfers");
  // #987: aktiv fane lever i URL'en (?tab=) så nav-genvejen "Transferliste"
  // (/transfers?tab=market) og delte links lander på den rigtige fane.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = VALID_TABS.includes(tabParam) ? tabParam : DEFAULT_TAB;
  function setTab(key) {
    setSearchParams(key === DEFAULT_TAB ? {} : { tab: key }, { replace: true });
  }
  const [listings, setListings] = useState([]);
  const [sentOffers, setSentOffers] = useState([]);
  const [receivedOffers, setReceivedOffers] = useState([]);
  const [archivedSentOffers, setArchivedSentOffers] = useState([]);
  const [archivedReceivedOffers, setArchivedReceivedOffers] = useState([]);
  const [sentSwaps, setSentSwaps] = useState([]);
  const [receivedSwaps, setReceivedSwaps] = useState([]);
  const [lendingLoans, setLendingLoans] = useState([]);
  const [borrowingLoans, setBorrowingLoans] = useState([]);
  const [myRiders, setMyRiders] = useState([]);
  const [showNewSwap, setShowNewSwap] = useState(false);
  const [showNewLoan, setShowNewLoan] = useState(false);
  const [myTeamId, setMyTeamId] = useState(null);
  const [myBalance, setMyBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [celebration, setCelebration] = useState(null);
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const [transferWindow, setTransferWindow] = useState({ open: true, status: "open" });
  const [listingSort, setListingSort] = useState("newest"); // #1185: market-tab sortering

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: team } = await supabase.from("teams").select("id, balance").eq("user_id", user.id).single();
      if (!team) return;
      setMyTeamId(team.id);
      setMyBalance(team.balance);

      const { data: { session } } = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session.access_token}` };

      const [listingsRes, offersRes, swapsRes, loansRes, ridersRes, windowRes] = await Promise.all([
        fetch(`${API}/api/transfers`, { headers }).then(r => r.json()),
        fetch(`${API}/api/transfers/my-offers`, { headers }).then(r => r.json()),
        fetch(`${API}/api/transfers/swaps`, { headers }).then(r => r.json()),
        fetch(`${API}/api/loans`, { headers }).then(r => r.json()),
        supabase.from("riders").select("id, firstname, lastname, market_value").eq("team_id", team.id).eq("is_retired", false).order("lastname"),
        fetch(`${API}/api/transfer-window`, { headers }).then(r => r.json()),
      ]);

      setListings(Array.isArray(listingsRes) ? listingsRes : []);
      setSentOffers(offersRes.sent || []);
      setReceivedOffers(offersRes.received || []);
      setArchivedSentOffers(offersRes.archivedSent || []);
      setArchivedReceivedOffers(offersRes.archivedReceived || []);
      setSentSwaps(swapsRes.sent || []);
      setReceivedSwaps(swapsRes.received || []);
      setLendingLoans(loansRes.lending || []);
      setBorrowingLoans(loansRes.borrowing || []);
      setMyRiders(ridersRes.data || []);
      setTransferWindow(windowRes?.open !== undefined ? windowRes : { open: true, status: "open" });
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    } finally {
      setLoading(false);
    }
  }

  async function getHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
  }

  function showMsg(text, type = "success") {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "" }), 4000);
  }

  async function handleOffer(riderId, amount, message) {
    try {
      const res = await fetch(`${API}/api/transfers/offer`, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({ rider_id: riderId, offer_amount: amount, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { showMsg(t("toast.offerSent")); loadAll(); setTab("sent"); }
      else showMsg(`❌ ${resolveApiError(data, t)}`, "error");
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    }
  }

  async function handleRemoveListing(listingId) {
    try {
      const res = await fetch(`${API}/api/transfers/${listingId}`, {
        method: "DELETE",
        headers: await getHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showMsg(t("toast.listingRemoved"));
        loadAll();
      } else {
        showMsg(`❌ ${resolveApiError(data, t, t("toast.listingRemoveFailed"))}`, "error");
      }
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    }
  }

  // #1185: inline pris-redigering — før skulle listingen fjernes + genoprettes.
  // Returnerer true ved succes så OwnListingActions kun lukker edit-formen da.
  async function handleUpdateListingPrice(listingId, askingPrice) {
    try {
      const res = await fetch(`${API}/api/transfers/${listingId}`, {
        method: "PATCH",
        headers: await getHeaders(),
        body: JSON.stringify({ asking_price: askingPrice }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showMsg(t("toast.priceUpdated"));
        loadAll();
        return true;
      }
      showMsg(`❌ ${resolveApiError(data, t, t("toast.priceUpdateFailed"))}`, "error");
      return false;
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
      return false;
    }
  }

  async function handleOfferAction(offerId, action, extra = {}) {
    try {
      const res = await fetch(`${API}/api/transfers/offers/${offerId}`, {
        method: "PATCH",
        headers: await getHeaders(),
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (action === "confirm" && data.action === "accepted") {
          setCelebration({
            title: t("celebration.transferDone.title"),
            subtitle: t("celebration.transferDone.subtitle"),
            amount: data.price || 0,
            icon: "↔",
          });
          fetch(`${API}/api/achievements/check`, {
            method: "POST",
            headers: await getHeaders(),
            body: JSON.stringify({ context: "transfer_done", data: {} }),
          }).catch(() => {});
        } else {
          const msgs = {
            accept:          t("toast.offerAcceptedBuyer"),
            accept_counter:  t("toast.offerAcceptedSeller"),
            confirm:         t("toast.confirmedAwaiting"),
            cancel:          t("toast.dealCancelled"),
            reject:          t("toast.transferRejected"),
            counter:         t("toast.counterSent"),
            new_offer:       t("toast.newOfferSent"),
            withdraw:        t("toast.offerWithdrawn"),
            archive:         t("toast.offerArchived"),
          };
          showMsg(msgs[action] || t("toast.updated"));
        }
        loadAll();
      } else {
        showMsg(`❌ ${resolveApiError(data, t)}`, "error");
      }
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    }
  }

  async function handleSwapAction(swapId, action, extra = {}) {
    try {
      const res = await fetch(`${API}/api/transfers/swaps/${swapId}`, {
        method: "PATCH",
        headers: await getHeaders(),
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (action === "confirm" && data.action === "accepted") {
          setCelebration({
            title: t("celebration.swapDone.title"),
            subtitle: t("celebration.swapDone.subtitle"),
            amount: 0,
            icon: "↔",
          });
        } else {
          const msgs = {
            accept:         t("toast.swapAccepted"),
            accept_counter: t("toast.swapAccepted"),
            confirm:        t("toast.swapConfirmedAwaiting"),
            cancel:         t("toast.swapCancelled"),
            reject:         t("toast.swapRejected"),
            counter:        t("toast.counterSent"),
            withdraw:       t("toast.proposalWithdrawn"),
          };
          showMsg(msgs[action] || t("toast.updated"));
        }
        loadAll();
      } else {
        showMsg(`❌ ${resolveApiError(data, t)}`, "error");
      }
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    }
  }

  async function handleNewSwap(payload) {
    try {
      const res = await fetch(`${API}/api/transfers/swaps`, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showMsg(t("toast.swapProposalSent"));
        setShowNewSwap(false);
        loadAll();
      } else {
        showMsg(`❌ ${resolveApiError(data, t)}`, "error");
      }
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    }
  }

  async function handleLoanAction(loanId, action) {
    try {
      const res = await fetch(`${API}/api/loans/${loanId}`, {
        method: "PATCH",
        headers: await getHeaders(),
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (action === "buyout") {
          setCelebration({ title: t("celebration.buyoutDone.title"), subtitle: t("celebration.buyoutDone.subtitle"), amount: data.price || 0, icon: "📋" });
        } else {
          const msgs = { accept: t("toast.loanActivated"), reject: t("toast.loanRejected"), cancel: t("toast.loanCancelled") };
          showMsg(msgs[action] || t("toast.updated"));
        }
        loadAll();
      } else {
        showMsg(`❌ ${resolveApiError(data, t)}`, "error");
      }
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    }
  }

  async function handleNewLoan(payload) {
    try {
      const res = await fetch(`${API}/api/loans`, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { showMsg(t("toast.loanProposalSent")); setShowNewLoan(false); loadAll(); }
      else showMsg(`❌ ${resolveApiError(data, t)}`, "error");
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    }
  }

  const pendingReceived = receivedOffers.filter(o =>
    o.status === "pending" || (o.status === "awaiting_confirmation" && !o.seller_confirmed)
  ).length;
  const pendingSent = sentOffers.filter(o =>
    o.status === "countered" || (o.status === "awaiting_confirmation" && !o.buyer_confirmed)
  ).length;
  const pendingSwaps = [
    ...receivedSwaps.filter(s => s.status === "pending" || (s.status === "awaiting_confirmation" && !s.receiving_confirmed)),
    ...sentSwaps.filter(s => s.status === "countered" || (s.status === "awaiting_confirmation" && !s.proposing_confirmed)),
  ].length;
  const pendingLoans = lendingLoans.filter(l => l.status === "pending").length;

  const riderFilters = useClientRiderFilters(listings.map(l => l.rider).filter(Boolean));
  const filteredIds = new Set(riderFilters.filtered.map(r => r.id));
  // Rytter-filtrene styrer hvilke listings der vises; rækkefølgen styres på
  // listing-niveau (asking_price/created_at) — se lib/transferListingSort (#1185).
  const filteredListings = sortListings(
    listings.filter(l => !l.rider || filteredIds.has(l.rider.id)),
    listingSort
  );

  return (
    <div className="max-w-4xl mx-auto">
      <ConfettiModal
        show={!!celebration}
        onClose={() => setCelebration(null)}
        title={celebration?.title || ""}
        subtitle={celebration?.subtitle}
        amount={celebration?.amount}
        icon={celebration?.icon || "🎉"}
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("page.title")}</h1>
          <p className="text-cz-3 text-sm">{t("page.subtitle")}</p>
        </div>
        <div className="bg-cz-card border border-cz-border rounded-lg px-4 py-2 sm:text-right">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("page.balance")}</p>
          <p className="text-cz-accent-t font-mono font-bold text-sm">{formatNumber(myBalance)} CZ$</p>
        </div>
      </div>

      <div className={`mb-4 px-4 py-3 rounded-xl text-sm border flex items-center gap-2
        ${transferWindow.open
          ? "bg-cz-success-bg0/8 text-cz-success border-cz-success/30"
          : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${transferWindow.open ? "bg-green-400" : "bg-red-400"}`} />
        {transferWindow.open ? t("window.open") : t("window.closed")}
      </div>

      {msg.text && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border
          ${msg.type === "error"
            ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
            : "bg-cz-success-bg text-cz-success border-cz-success/30"}`}>
          {msg.text}
        </div>
      )}

      <div className="flex gap-2 mb-5 flex-wrap">
        {[
          { key: "received", label: t("tabs.received"), badge: pendingReceived },
          { key: "sent",     label: t("tabs.sent"),     badge: pendingSent },
          { key: "archive",  label: t("tabs.archive",  { count: archivedReceivedOffers.length + archivedSentOffers.length }) },
          { key: "swaps",    label: t("tabs.swaps"),    badge: pendingSwaps },
          { key: "loans",    label: t("tabs.loans"),    badge: pendingLoans },
          { key: "market",   label: t("tabs.market",   { count: listings.length }) },
        ].map(tt => (
          <button key={tt.key} onClick={() => setTab(tt.key)}
            className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all border
              ${tab === tt.key
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {tt.label}
            {tt.badge > 0 && (
              <span className="ms-2 bg-cz-accent text-cz-on-accent text-[9px] font-black px-1.5 py-0.5 rounded-full">
                {tt.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
        </div>
      ) : (
        <div>
          {tab === "received" && (
            <div className="flex flex-col gap-3">
              {receivedOffers.length === 0 ? (
                <div className="text-center py-16 text-cz-3">
                  <p className="text-4xl mb-3">↔</p>
                  <p>{t("empty.received")}</p>
                  <p className="text-xs mt-2">{t("empty.receivedHint")}</p>
                </div>
              ) : (
                receivedOffers.map(o => (
                  <ReceivedOfferCard key={o.id} offer={o} onAction={handleOfferAction} />
                ))
              )}
            </div>
          )}

          {tab === "sent" && (
            <div className="flex flex-col gap-3">
              {sentOffers.length === 0 ? (
                <div className="text-center py-16 text-cz-3">
                  <p className="text-4xl mb-3">↔</p>
                  <p>{t("empty.sent")}</p>
                  <p className="text-xs mt-2">{t("empty.sentHint")}</p>
                </div>
              ) : (
                sentOffers.map(o => (
                  <SentOfferCard key={o.id} offer={o} onAction={handleOfferAction} />
                ))
              )}
            </div>
          )}

          {tab === "archive" && (
            <div className="flex flex-col gap-4">
              {archivedReceivedOffers.length + archivedSentOffers.length === 0 ? (
                <div className="text-center py-16 text-cz-3">
                  <p className="text-4xl mb-3">◎</p>
                  <p>{t("empty.archive")}</p>
                </div>
              ) : (
                <>
                  {archivedReceivedOffers.length > 0 && (
                    <div>
                      <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("sections.archivedReceived")}</p>
                      <div className="flex flex-col gap-3">
                        {archivedReceivedOffers.map(o => (
                          <ReceivedOfferCard key={o.id} offer={o} onAction={handleOfferAction} showArchive={false} />
                        ))}
                      </div>
                    </div>
                  )}
                  {archivedSentOffers.length > 0 && (
                    <div>
                      <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("sections.archivedSent")}</p>
                      <div className="flex flex-col gap-3">
                        {archivedSentOffers.map(o => (
                          <SentOfferCard key={o.id} offer={o} onAction={handleOfferAction} showArchive={false} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "swaps" && (
            <div className="flex flex-col gap-4">
              {showNewSwap ? (
                <NewSwapForm
                  myRiders={myRiders}
                  onSubmit={handleNewSwap}
                  onCancel={() => setShowNewSwap(false)}
                />
              ) : (
                <button onClick={() => setShowNewSwap(true)}
                  className="w-full py-2.5 bg-cz-accent/10 text-cz-accent-t/80 border border-[#e8c547]/15 rounded-xl text-sm font-medium
                    hover:bg-cz-accent/10 hover:text-cz-accent-t transition-all">
                  {t("newSwap.newButton")}
                </button>
              )}

              {receivedSwaps.length > 0 && (
                <div>
                  <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("sections.receivedProposals")}</p>
                  <div className="flex flex-col gap-3">
                    {receivedSwaps.map(s => (
                      <SwapCard key={s.id} swap={s} myTeamId={myTeamId} onAction={handleSwapAction} />
                    ))}
                  </div>
                </div>
              )}

              {sentSwaps.length > 0 && (
                <div>
                  <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("sections.sentProposals")}</p>
                  <div className="flex flex-col gap-3">
                    {sentSwaps.map(s => (
                      <SwapCard key={s.id} swap={s} myTeamId={myTeamId} onAction={handleSwapAction} />
                    ))}
                  </div>
                </div>
              )}

              {receivedSwaps.length === 0 && sentSwaps.length === 0 && !showNewSwap && (
                <div className="text-center py-16 text-cz-3">
                  <p className="text-4xl mb-3">↔</p>
                  <p>{t("empty.swaps")}</p>
                  <p className="text-xs mt-2">{t("empty.swapsHint")}</p>
                </div>
              )}
            </div>
          )}

          {tab === "loans" && (
            <div className="flex flex-col gap-4">
              {showNewLoan ? (
                <NewLoanForm
                  myTeamId={myTeamId}
                  onSubmit={handleNewLoan}
                  onCancel={() => setShowNewLoan(false)}
                />
              ) : (
                <button onClick={() => setShowNewLoan(true)}
                  className="w-full py-2.5 bg-purple-500/8 text-purple-400/80 border border-purple-500/15 rounded-xl text-sm font-medium
                    hover:bg-purple-500/15 hover:text-purple-400 transition-all">
                  {t("newLoan.newButton")}
                </button>
              )}

              {lendingLoans.length > 0 && (
                <div>
                  <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("sections.yourLending")}</p>
                  <div className="flex flex-col gap-3">
                    {lendingLoans.map(l => (
                      <LoanCard key={l.id} loan={l} myTeamId={myTeamId} onAction={handleLoanAction} />
                    ))}
                  </div>
                </div>
              )}

              {borrowingLoans.length > 0 && (
                <div>
                  <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("sections.yourBorrowing")}</p>
                  <div className="flex flex-col gap-3">
                    {borrowingLoans.map(l => (
                      <LoanCard key={l.id} loan={l} myTeamId={myTeamId} onAction={handleLoanAction} />
                    ))}
                  </div>
                </div>
              )}

              {lendingLoans.length === 0 && borrowingLoans.length === 0 && !showNewLoan && (
                <div className="text-center py-16 text-cz-3">
                  <p className="text-4xl mb-3">📋</p>
                  <p>{t("empty.loans")}</p>
                  <p className="text-xs mt-2">{t("empty.loansHint")}</p>
                </div>
              )}
            </div>
          )}

          {tab === "market" && (
            <div>
              <RiderFilters
                filters={riderFilters.filters}
                onChange={riderFilters.onChange}
                onReset={riderFilters.onReset}
                showTeamFilter={false}
                nationalities={riderFilters.nationalities}
              />
              {/* #1185: sortér på listing-pris (asking_price) eller nyeste */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-cz-3 text-xs uppercase tracking-wider">{t("marketSort.label")}</span>
                {LISTING_SORT_OPTIONS.map(key => (
                  <button key={key} onClick={() => setListingSort(key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
                      ${listingSort === key
                        ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                        : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
                    {t(`marketSort.${key}`)}
                  </button>
                ))}
              </div>
              {filteredListings.length === 0 ? (
                <div className="text-center py-16 text-cz-3">
                  <p className="text-4xl mb-3">↔</p>
                  <p>{listings.length === 0 ? t("empty.marketNoListings") : t("empty.marketNoMatches")}</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {filteredListings.map(l => (
                    <TransferCard
                      key={l.id}
                      listing={l}
                      myTeamId={myTeamId}
                      onOffer={(riderId, amt, msg) => handleOffer(riderId, amt, msg)}
                      onRemove={handleRemoveListing}
                      onUpdatePrice={handleUpdateListingPrice}
                      windowOpen={transferWindow.open}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
