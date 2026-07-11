import { useState, useEffect, useRef } from "react";
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
import { sortRows } from "../lib/useTableSort.js";
import { cycleSortState } from "../lib/riderSort.js";
import SortableTh from "../components/ui/SortableTh.jsx";
import { Card, EmptyState, ExchangeIcon, InboxIcon, PageLoader } from "../components/ui";
import { ABILITY_STATS as LISTING_STATS, ABILITY_KEYS, ABILITY_SHORT, flattenAbilities } from "../lib/abilities";
import { getRiderAge } from "../lib/riderAge";
import NationCell from "../components/rider/NationCell";
import RiderNameCell from "../components/rider/RiderNameCell";
import TeamCell from "../components/rider/TeamCell";

// #2329: markedstabellens ÉN kanoniske sort-state (useSortState) — headers og
// de gamle knapper/evne-dropdown deler samme { sort, dir }, så de aldrig kan
// komme i konflikt. Erstattede den listing-niveau sortListings (#1185/#2031),
// som kun kunne rammes fra knapperne, ikke fra header-klik.
//
// #2031: pris/værdi/alder-sortering vises som knapper; de 15 evne-sorteringer
// samles i en dropdown (for mange til knapper).
const MARKET_SORT_BUTTONS = [
  { key: "newest", sort: "listed", dir: "desc" },
  { key: "price_asc", sort: "price", dir: "asc" },
  { key: "price_desc", sort: "price", dir: "desc" },
  { key: "value_desc", sort: "value", dir: "desc" },
  { key: "value_asc", sort: "value", dir: "asc" },
  { key: "age_asc", sort: "age", dir: "asc" },
  { key: "age_desc", sort: "age", dir: "desc" },
];

// Numeriske kolonner + evner starter faldende ved første header-klik ("bedst/
// dyrest øverst"), som resten af sidens tabeller (riderSort-konventionen).
const MARKET_SORT_DESC_FIRST_KEYS = new Set(["age", "listed", "value", "salary", "price", ...ABILITY_KEYS]);

// Accessorer pr. sorterbar kolonne. Rytterens evner er fladtgjort op på
// listing.rider[<key>] (flattenAbilities ved load) — se abilities.js (SSOT).
const MARKET_SORT_ACCESSORS = {
  rider: (l) => (l.rider ? `${l.rider.firstname || ""} ${l.rider.lastname || ""}`.trim() || null : null),
  seller: (l) => l.seller?.name ?? null,
  age: (l) => (l.rider ? getRiderAge(l.rider.birthdate) : null),
  listed: (l) => (l.created_at ? new Date(l.created_at).getTime() : null),
  value: (l) => (l.rider ? getRiderMarketValue(l.rider) : null),
  salary: (l) => (l.rider ? getRiderSalary(l.rider) : null),
  price: (l) => l.asking_price ?? null,
  ...Object.fromEntries(
    ABILITY_KEYS.map((key) => [key, (l) => (typeof l.rider?.[key] === "number" ? l.rider[key] : null)]),
  ),
};

const API = import.meta.env.VITE_API_URL;

// #987: faner kan deep-linkes via ?tab= (fx /transfers?tab=market fra nav'ens
// "Transferliste"-genvej). Ukendte værdier falder tilbage til "received".
const VALID_TABS = ["received", "sent", "archive", "swaps", "market"];
const DEFAULT_TAB = "received";

// #58: de 6 sideordnede faner er grupperet i 3 handlingsorienterede modes, så en
// manager hurtigt ser "hvad skal jeg handle på nu?" uden at scanne 6 faner. Modes
// er ren UI-gruppering OVENPÅ det eksisterende ?tab=-dataflow: de gamle tab-værdier
// (og deres deep-links) router uændret — hvert mode peger blot på en delmængde af
// VALID_TABS. Rækkefølgen af faner i et mode = visnings-rækkefølge i sub-fane-båndet.
const TAB_MODES = [
  { key: "handle",       tabs: ["received"] },
  { key: "negotiations", tabs: ["sent", "archive", "swaps"] },
  { key: "market",       tabs: ["market"] },
];

// tab → mode-opslag (afledt af TAB_MODES, så de aldrig kan divergere). Bruges til at
// udlede det aktive mode fra den aktive fane (som stadig lever i ?tab=).
const TAB_TO_MODE = Object.fromEntries(
  TAB_MODES.flatMap((m) => m.tabs.map((tab) => [tab, m.key])),
);

// #1529: stat-kolonnerne = de 15 CZ-evner (delt config, importeret som LISTING_STATS).
// Erstattede de 14 PCM stat_*. Backend /api/transfers (+ my-offers/swaps) leverer
// rider_derived_abilities, som flades op på rytter-objektet (flattenAbilities) ved load.
//
// #2002: SwapCard's hurtig-preview er en KURATERET delmængde (4 evner) — men både
// rækkefølge og labels udledes af SSOT (abilities.js), så den aldrig kan divergere
// fra de andre evne-flader. Nøglerne holdes i ABILITY_KEYS-rækkefølge (guard-test i
// TransfersPage.abilities.test.js fejler hvis en nøgle er ukendt eller ude af orden),
// og labelen kommer fra ABILITY_SHORT i stedet for en hardcodet streng.
const SWAP_PREVIEW_KEYS = ["climbing", "sprint", "flat", "time_trial"];
const SWAP_PREVIEW = SWAP_PREVIEW_KEYS.map((key) => [ABILITY_SHORT[key], key]);

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
  accepted:               { color: "text-cz-success",   bg: "bg-cz-success-bg border-cz-success/30" },
  rejected:               { color: "text-cz-danger",     bg: "bg-cz-danger-bg border-cz-danger/30" },
  withdrawn:              { color: "text-cz-3",   bg: "bg-cz-subtle border-cz-border" },
};

const STATUS_LABEL_KEY = {
  pending: "status.pending",
  countered: "status.countered",
  awaiting_confirmation: "status.awaitingConfirmation",
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
    <div className={`bg-cz-card border rounded-cz p-5 transition-all
      ${isAwaiting ? "border-cz-info/30" : isPending ? "border-cz-accent/30" : "border-cz-border opacity-70"}`}>
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
              className="min-h-[44px] flex-1 py-2 bg-cz-success-bg text-cz-success border border-cz-success/25 rounded-lg text-sm font-medium hover:bg-cz-success-bg0/25 transition-all disabled:opacity-50">
              {t("offerCard.buttons.accept")}
            </button>
            <button onClick={() => setMode(mode === "counter" ? null : "counter")}
              className={`min-h-[44px] flex-1 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "counter"
                  ? "bg-cz-warning-bg0/20 text-cz-warning border-cz-warning/30"
                  : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
              {t("offerCard.buttons.counter")}
            </button>
            <button onClick={() => doAction("reject")} disabled={loading}
              className="min-h-[44px] flex-1 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm font-medium hover:bg-cz-danger-bg transition-all disabled:opacity-50">
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
                  className="min-h-[44px] w-full sm:w-auto px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
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
            <div className="bg-cz-info-bg0/10 border border-cz-info/20 rounded-lg px-4 py-3 text-center">
              <p className="text-cz-info text-sm font-medium">{t("offerCard.awaiting.sellerAccepted")}</p>
              <p className="text-cz-3 text-xs mt-1">{price} CZ$ · {offer.buyer?.name}</p>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => doAction("confirm")} disabled={loading}
                className="min-h-[44px] flex-1 py-2 bg-cz-info-bg text-cz-info border border-cz-info/25 rounded-lg text-sm font-medium hover:bg-cz-info-bg0/25 transition-all disabled:opacity-50">
                {t("offerCard.buttons.confirmDeal", { amount: price })}
              </button>
            </div>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="min-h-[44px] w-full py-2 bg-cz-danger-bg0/5 text-cz-danger/70 border border-cz-danger/15 rounded-lg text-sm
              hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
            {t("offerCard.buttons.cancelDeal")}
          </button>
        </div>
      )}

      {canArchive && (
        <button onClick={() => doAction("archive")} disabled={loading}
          className="min-h-[44px] mt-3 w-full py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-border transition-all disabled:opacity-50">
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
    <div className={`bg-cz-card border rounded-cz p-5 transition-all
      ${isAwaiting ? "border-cz-info/30" : isCountered ? "border-cz-warning/30" : isActive ? "border-cz-border" : "border-cz-border opacity-60"}`}>
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
              className="min-h-[44px] flex-1 py-2 bg-cz-success-bg text-cz-success border border-cz-success/25 rounded-lg text-sm font-medium hover:bg-cz-success-bg0/25 disabled:opacity-50">
              {t("offerCard.buttons.acceptCounter", { amount: formatNumber(offer.counter_amount) })}
            </button>
            <button onClick={() => setMode(mode === "new_offer" ? null : "new_offer")}
              className={`min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "new_offer"
                  ? "bg-cz-info-bg0/20 text-cz-info border-cz-info/30"
                  : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
              {t("offerCard.buttons.newOffer")}
            </button>
            <button onClick={() => doAction("withdraw")} disabled={loading}
              className="min-h-[44px] px-4 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm font-medium hover:bg-cz-danger-bg disabled:opacity-50">
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
                  className="min-h-[44px] w-full sm:w-auto px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
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
          className="min-h-[44px] w-full py-2 bg-cz-subtle text-cz-3 border border-cz-border rounded-lg text-sm
            hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
          {t("offerCard.buttons.withdrawOffer")}
        </button>
      )}

      {isAwaiting && (
        <div className="flex flex-col gap-2">
          {offer.buyer_confirmed ? (
            <div className="bg-cz-info-bg0/10 border border-cz-info/20 rounded-lg px-4 py-3 text-center">
              <p className="text-cz-info text-sm font-medium">{t("offerCard.awaiting.buyerConfirmed")}</p>
              <p className="text-cz-3 text-xs mt-1">{price} CZ$ · {offer.seller?.name}</p>
            </div>
          ) : (
            <button onClick={() => doAction("confirm")} disabled={loading}
              className="min-h-[44px] w-full py-2 bg-cz-info-bg text-cz-info border border-cz-info/25 rounded-lg text-sm font-medium hover:bg-cz-info-bg0/25 transition-all disabled:opacity-50">
              {t("offerCard.buttons.confirmDeal", { amount: price })}
            </button>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="min-h-[44px] w-full py-2 bg-cz-danger-bg0/5 text-cz-danger/70 border border-cz-danger/15 rounded-lg text-sm
              hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
            {t("offerCard.buttons.cancelDeal")}
          </button>
        </div>
      )}

      {canArchive && (
        <button onClick={() => doAction("archive")} disabled={loading}
          className="min-h-[44px] mt-3 w-full py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-border transition-all disabled:opacity-50">
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
    <div className={`bg-cz-card border rounded-cz p-5 transition-all
      ${isAwaiting ? "border-cz-info/30" : isCountered ? "border-cz-warning/30" : isPending ? "border-cz-border" : "border-cz-border opacity-60"}`}>

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
          <RiderLink key={rider?.id} id={rider?.id}
            aria-label={rider ? `${rider.firstname} ${rider.lastname}` : undefined}
            className="group block bg-cz-subtle rounded-lg px-3 py-2 transition-colors hover:ring-1 hover:ring-cz-accent/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cz-accent/40">
            <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-1">{label}</p>
            <p className="text-cz-1 text-sm font-semibold transition-colors group-hover:text-cz-accent-t">
              {rider?.firstname} {rider?.lastname}
            </p>
            <div className="flex gap-2 mt-1">
              {SWAP_PREVIEW.map(([l, k]) => (
                <span key={k} className="text-[10px] text-cz-3">{l}<span className="text-cz-2 ms-0.5">{rider?.[k] ?? "—"}</span></span>
              ))}
            </div>
          </RiderLink>
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
              className="min-h-[44px] flex-1 py-2 bg-cz-success-bg text-cz-success border border-cz-success/25 rounded-lg text-sm font-medium hover:bg-cz-success-bg0/25 disabled:opacity-50">
              {t("swapCard.buttons.accept")}
            </button>
            <button onClick={() => setMode(mode === "counter" ? null : "counter")}
              className={`min-h-[44px] flex-1 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "counter" ? "bg-cz-warning-bg0/20 text-cz-warning border-cz-warning/30" : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
              {t("swapCard.buttons.counter")}
            </button>
            <button onClick={() => doAction("reject")} disabled={loading}
              className="min-h-[44px] flex-1 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm font-medium hover:bg-cz-danger-bg disabled:opacity-50">
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
                  className="min-h-[44px] px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
                  {t("swapCard.buttons.send")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isPending && isProposing && (
        <button onClick={() => doAction("withdraw")} disabled={loading}
          className="min-h-[44px] w-full py-2 bg-cz-subtle text-cz-3 border border-cz-border rounded-lg text-sm
            hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
          {t("swapCard.buttons.withdraw")}
        </button>
      )}

      {isCountered && isProposing && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button onClick={() => doAction("accept_counter")} disabled={loading}
              className="min-h-[44px] flex-1 py-2 bg-cz-success-bg text-cz-success border border-cz-success/25 rounded-lg text-sm font-medium hover:bg-cz-success-bg0/25 disabled:opacity-50">
              {t("swapCard.buttons.acceptCounter")}
            </button>
            <button onClick={() => setMode(mode === "counter" ? null : "counter")}
              className={`min-h-[44px] flex-1 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "counter" ? "bg-cz-warning-bg0/20 text-cz-warning border-cz-warning/30" : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
              {t("swapCard.buttons.counter")}
            </button>
            <button onClick={() => doAction("withdraw")} disabled={loading}
              className="min-h-[44px] px-4 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm hover:bg-cz-danger-bg disabled:opacity-50">
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
                  className="min-h-[44px] px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
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
            <div className="bg-cz-info-bg0/10 border border-cz-info/20 rounded-lg px-4 py-3 text-center">
              <p className="text-cz-info text-sm font-medium">{t("swapCard.awaiting.selfConfirmed")}</p>
            </div>
          ) : (
            <button onClick={() => doAction("confirm")} disabled={loading}
              className="min-h-[44px] w-full py-2 bg-cz-info-bg text-cz-info border border-cz-info/25 rounded-lg text-sm font-medium hover:bg-cz-info-bg0/25 disabled:opacity-50">
              {t("swapCard.buttons.confirmSwap")}
            </button>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="min-h-[44px] w-full py-2 bg-cz-danger-bg0/5 text-cz-danger/70 border border-cz-danger/15 rounded-lg text-sm
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
    <Card className="p-5 flex flex-col gap-4">
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
                  className="min-h-[44px] w-full text-left px-3 py-2 hover:bg-cz-subtle text-cz-1 text-sm border-b border-cz-border last:border-0">
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
          className="min-h-[44px] flex-1 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-40">
          {loading ? t("newSwap.sending") : t("newSwap.submit")}
        </button>
        <button onClick={onCancel}
          className="min-h-[44px] px-4 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-subtle">
          {t("newSwap.cancel")}
        </button>
      </div>
    </Card>
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

// ── Market række-layout (#1523) ──────────────────────────────────────────────
// Transferlistens market-fane vises nu som rækker på linje med ryttersiden
// (RidersPage), så stats kan sammenlignes på tværs af rytteroversigterne.
// Samme byggeklodser (NationCell/RiderNameCell/TeamCell + statStyle-badges) +
// samme tabel-struktur (sticky navn-kolonne, evne-kolonner). Den transferliste-
// specifikke funktionalitet (pris, status, bud, redigér/fjern) bor i en
// expander-række under selve rytterrækken, så tabel-overblikket bevares.

function MarketStatBar({ value }) {
  return (
    <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded" style={statStyle(value ?? 0)}>
      {value ?? "—"}
    </span>
  );
}

// Bud-form (ikke-egen listing) — samme felter/validering som TransferCard.
function MarketOfferForm({ listing, onOffer }) {
  const { t } = useTranslation("transfers");
  const [offerAmt, setOfferAmt] = useState(listing.asking_price || 0);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const riderName = listing.rider ? `${listing.rider.firstname} ${listing.rider.lastname}` : t("transferCard.ridersForSale");

  async function performSendOffer() {
    setLoading(true);
    try {
      await onOffer(listing.rider?.id, offerAmt, msg);
      setConfirmOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <input type="number" value={offerAmt}
          onChange={e => setOfferAmt(parseInt(e.target.value) || 0)}
          aria-label={t("offerCard.form.newOfferLabel")}
          className="min-w-0 flex-1 min-h-[44px] bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none focus:border-cz-accent" />
        <button
          onClick={() => { if (offerAmt > 0) setConfirmOpen(true); }}
          disabled={loading || offerAmt <= 0}
          className="min-h-[44px] px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
          {loading ? "..." : t("transferCard.send")}
        </button>
      </div>
      <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
        placeholder={t("transferCard.messagePlaceholder")}
        className="bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-xs focus:outline-none focus:border-cz-accent" />
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

// Én listing = én rytterrække (+ optionel action-expander-række under).
function MarketRow({ listing, myTeamId, statCols, expanded, onToggleExpand, onOffer, onRemove, onUpdatePrice }) {
  const { t } = useTranslation("transfers");
  const rider = listing.rider;
  const isOwn = listing.seller?.id === myTeamId;
  const riderName = rider ? `${rider.firstname} ${rider.lastname}` : t("transferCard.ridersForSale");

  return (
    <>
      <tr className={`border-b border-cz-border transition-colors ${expanded ? "bg-cz-subtle" : "hover:bg-cz-subtle"}`}>
        <td className="px-2 py-2.5 w-12 hidden sm:table-cell">
          <NationCell code={rider?.nationality_code} />
        </td>
        <td className="px-3 py-2.5 sticky-name-cell sticky left-0 z-10 border-r border-cz-border shadow-[10px_0_16px_-16px_rgba(0,0,0,0.5)]">
          <RiderNameCell id={rider?.id} firstname={rider?.firstname} lastname={rider?.lastname} />
        </td>
        <td className="px-3 py-2.5 hidden sm:table-cell">
          <TeamCell team={listing.seller} freeLabel="—" />
        </td>
        <td className="px-2 py-2.5 text-center hidden md:table-cell">
          <span className="text-cz-2 font-mono text-xs">{getRiderAge(rider?.birthdate) ?? "—"}</span>
        </td>
        <td className="px-3 py-2.5 hidden md:table-cell">
          <span className="text-cz-3 text-xs whitespace-nowrap">
            {listing.created_at ? formatDate(listing.created_at, null, { day: "numeric", month: "short" }) : "—"}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right">
          <span className="text-cz-2 font-mono text-sm">{formatCz(getRiderMarketValue(rider))}</span>
        </td>
        <td className="px-3 py-2.5 text-right hidden sm:table-cell">
          <span className="text-cz-2 font-mono text-sm">{formatCz(getRiderSalary(rider))}</span>
        </td>
        <td className="px-3 py-2.5 text-right">
          <span className="text-cz-accent-t font-mono text-sm font-bold whitespace-nowrap">
            {formatNumber(listing.asking_price)} CZ$
          </span>
        </td>
        {statCols.map(({ key }) => (
          <td key={key} className="px-1.5 py-2.5 w-14 text-center">
            <MarketStatBar value={rider?.[key]} />
          </td>
        ))}
        <td className="px-3 py-2.5 text-right w-28">
          <button
            onClick={() => onToggleExpand(listing.id)}
            aria-expanded={expanded}
            aria-label={isOwn ? t("marketRow.manageAria", { riderName }) : t("marketRow.offerAria", { riderName })}
            className={`min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-medium transition-all border whitespace-nowrap
              ${expanded
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/25"
                : "bg-cz-card text-cz-2 border-cz-border hover:text-cz-1 hover:border-cz-accent/40"}`}>
            {expanded ? t("marketRow.close") : isOwn ? t("marketRow.manage") : t("marketRow.offer")}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-cz-border bg-cz-subtle">
          <td colSpan={8 + statCols.length + 1} className="px-3 pb-4 pt-1">
            <div className="max-w-xl rounded-lg border border-cz-border bg-cz-card p-3">
              {isOwn ? (
                <OwnListingActions
                  listing={listing}
                  riderName={riderName}
                  onRemove={onRemove}
                  onUpdatePrice={onUpdatePrice}
                />
              ) : (
                <MarketOfferForm listing={listing} onOffer={onOffer} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
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
  // #1569: en ny spiller har ALLE handels-faner tomme (ingen tilbud/swaps/
  // archive), så default-fanen 'received' var en tom blindgyde. Når data er loadet
  // og alle handels-faner er tomme — og manageren ikke selv har deep-linket en
  // fane — defaulter vi ÉN gang til 'market'-fanen, hvor der faktisk er ryttere.
  const didDefaultTabRef = useRef(false);
  const [listings, setListings] = useState([]);
  const [sentOffers, setSentOffers] = useState([]);
  const [receivedOffers, setReceivedOffers] = useState([]);
  const [archivedSentOffers, setArchivedSentOffers] = useState([]);
  const [archivedReceivedOffers, setArchivedReceivedOffers] = useState([]);
  const [sentSwaps, setSentSwaps] = useState([]);
  const [receivedSwaps, setReceivedSwaps] = useState([]);
  const [myRiders, setMyRiders] = useState([]);
  const [showNewSwap, setShowNewSwap] = useState(false);
  const [myTeamId, setMyTeamId] = useState(null);
  const [myBalance, setMyBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [celebration, setCelebration] = useState(null);
  const [msg, setMsg] = useState({ text: "", type: "success" });
  // #2329: markedstabellens ÉN kanoniske sort-state — delt af header-klik
  // (klik = cycleSortState, samme klik-cyklus som resten af siden via
  // useSortState) OG de gamle knapper/evne-dropdown (klik = præcis
  // sort+retning). Samme { sort, dir } uanset indgang, så de aldrig kan
  // komme i konflikt.
  const [marketSortState, setMarketSortState] = useState({ sort: "listed", dir: "desc" });
  const marketSort = marketSortState.sort;
  const marketSortDir = marketSortState.dir;
  function handleMarketSort(key) {
    setMarketSortState((cur) => cycleSortState(cur, key, MARKET_SORT_DESC_FIRST_KEYS));
  }
  function setExactMarketSort(sort, dir) {
    setMarketSortState({ sort, dir });
  }
  const [expandedListingId, setExpandedListingId] = useState(null); // #1523: åben action-række i market-tabellen

  function toggleExpandedListing(id) {
    setExpandedListingId(prev => (prev === id ? null : id));
  }

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // #1569: én-skuds default-til-'market' når alle handels-faner er tomme.
  // Gates på: data loadet, intet eksplicit ?tab= i URL'en, og alle handels-
  // arrays tomme. Ref'en sikrer at vi kun gør det én gang.
  useEffect(() => {
    if (loading || didDefaultTabRef.current || tabParam) return;
    const allTradeTabsEmpty =
      receivedOffers.length === 0 &&
      sentOffers.length === 0 &&
      archivedReceivedOffers.length === 0 &&
      archivedSentOffers.length === 0 &&
      receivedSwaps.length === 0 &&
      sentSwaps.length === 0;
    didDefaultTabRef.current = true;
    if (allTradeTabsEmpty) setTab("market");
  }, [loading, tabParam, receivedOffers, sentOffers, archivedReceivedOffers, archivedSentOffers, receivedSwaps, sentSwaps]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // #1792: udløbet/ugyldig session → user=null; stop før user.id (finally rydder loading)
      if (!user) return;
      const { data: team } = await supabase.from("teams").select("id, balance").eq("user_id", user.id).single();
      if (!team) return;
      setMyTeamId(team.id);
      setMyBalance(team.balance);

      const { data: { session } } = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session.access_token}` };

      const [listingsRes, offersRes, swapsRes, ridersRes] = await Promise.all([
        fetch(`${API}/api/transfers`, { headers }).then(r => r.json()),
        fetch(`${API}/api/transfers/my-offers`, { headers }).then(r => r.json()),
        fetch(`${API}/api/transfers/swaps`, { headers }).then(r => r.json()),
        supabase.from("riders").select("id, firstname, lastname, market_value").eq("team_id", team.id).eq("is_retired", false).order("lastname"),
      ]);

      // #1529: backend leverer rider.rider_derived_abilities (nested) — flad evnerne op
      // på rytter-objektet så ${key}-opslag i kortene virker som med de gamle stat_*.
      const flatRider = (o) => (o && o.rider ? { ...o, rider: flattenAbilities(o.rider) } : o);
      const flatSwap = (s) => (s ? { ...s, offered: flattenAbilities(s.offered), requested: flattenAbilities(s.requested) } : s);
      setListings(Array.isArray(listingsRes) ? listingsRes.map(flatRider) : []);
      setSentOffers((offersRes.sent || []).map(flatRider));
      setReceivedOffers((offersRes.received || []).map(flatRider));
      setArchivedSentOffers((offersRes.archivedSent || []).map(flatRider));
      setArchivedReceivedOffers((offersRes.archivedReceived || []).map(flatRider));
      setSentSwaps((swapsRes.sent || []).map(flatSwap));
      setReceivedSwaps((swapsRes.received || []).map(flatSwap));
      setMyRiders(ridersRes.data || []);
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
      else showMsg(resolveApiError(data, t), "error");
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
        showMsg(resolveApiError(data, t, t("toast.listingRemoveFailed")), "error");
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
      showMsg(resolveApiError(data, t, t("toast.priceUpdateFailed")), "error");
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
            icon: <ExchangeIcon size={56} className="text-cz-accent-t" aria-hidden="true" />,
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
        showMsg(resolveApiError(data, t), "error");
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
            icon: <ExchangeIcon size={56} className="text-cz-accent-t" aria-hidden="true" />,
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
        showMsg(resolveApiError(data, t), "error");
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
        showMsg(resolveApiError(data, t), "error");
      }
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

  // #58: pr-fane label + badge, delt af mode-båndet og sub-fane-båndet. Nøglerne
  // matcher VALID_TABS; rækkefølgen styres af TAB_MODES.
  const tabMeta = {
    received: { label: t("tabs.received"), badge: pendingReceived },
    sent:     { label: t("tabs.sent"),     badge: pendingSent },
    archive:  { label: t("tabs.archive",  { count: archivedReceivedOffers.length + archivedSentOffers.length }) },
    swaps:    { label: t("tabs.swaps"),    badge: pendingSwaps },
    market:   { label: t("tabs.market",   { count: listings.length }) },
  };
  // #58: aktivt mode udledes af den aktive fane (som stadig lever i ?tab=). Klik på
  // et mode åbner modets FØRSTE fane; er man allerede i modet bevares underfanen.
  const activeMode = TAB_TO_MODE[tab] || TAB_MODES[0].key;
  function selectMode(modeKey) {
    const mode = TAB_MODES.find((m) => m.key === modeKey);
    if (!mode) return;
    if (mode.tabs.includes(tab)) return; // allerede i modet — bevar underfane
    setTab(mode.tabs[0]);
  }
  // Sum af pending-badges pr. mode → tydelig "handling påkrævet"-markør på mode-niveau.
  const modeBadge = Object.fromEntries(
    TAB_MODES.map((m) => [m.key, m.tabs.reduce((sum, k) => sum + (tabMeta[k]?.badge || 0), 0)]),
  );
  // Underfaner vises kun for modes med >1 fane (i praksis "Forhandlinger").
  const activeModeTabs = (TAB_MODES.find((m) => m.key === activeMode)?.tabs) || [];
  const showSubTabs = activeModeTabs.length > 1;

  const riderFilters = useClientRiderFilters(listings.map(l => l.rider).filter(Boolean));
  const filteredIds = new Set(riderFilters.filtered.map(r => r.id));
  // Rytter-filtrene styrer hvilke listings der vises; rækkefølgen styres af den
  // kanoniske markedstabel-sort-state (#2329, se MARKET_SORT_ACCESSORS ovenfor).
  const filteredListings = sortRows(
    listings.filter(l => !l.rider || filteredIds.has(l.rider.id)),
    MARKET_SORT_ACCESSORS[marketSort] ?? null,
    marketSortDir,
  );

  // #1675: market-fanen viser en bred evne-tabel (15 kolonner) — den bruger fuld
  // content-bredde (Layout giver /transfers max-w-full). De kort-baserede faner
  // (tilbud/swaps/arkiv) + header cappes til en læsbar kolonne, så kortene
  // ikke strækkes over hele skærmen.
  const isMarketTab = tab === "market";
  return (
    <div className={isMarketTab ? "max-w-full" : "max-w-4xl mx-auto"}>
      <ConfettiModal
        show={!!celebration}
        onClose={() => setCelebration(null)}
        title={celebration?.title || ""}
        subtitle={celebration?.subtitle}
        amount={celebration?.amount}
        icon={celebration?.icon}
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5 max-w-4xl">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("page.title")}</h1>
          <p className="text-cz-3 text-sm">{t("page.subtitle")}</p>
        </div>
        <div className="bg-cz-card border border-cz-border rounded-lg px-4 py-2 sm:text-right">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("page.balance")}</p>
          <p className="text-cz-accent-t font-mono font-bold text-sm">{formatNumber(myBalance)} CZ$</p>
        </div>
      </div>

      {msg.text && (
        <div className={`mb-4 px-4 py-3 rounded-cz text-sm border max-w-4xl
          ${msg.type === "error"
            ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
            : "bg-cz-success-bg text-cz-success border-cz-success/30"}`}>
          {msg.text}
        </div>
      )}

      {/* #58: primær navigation = 3 handlingsorienterede modes (Skal handles /
          Forhandlinger / Marked). Modet er den øverste beslutning ("hvad skal jeg
          handle på nu?"); de gamle faner lever videre som underfaner i modet. */}
      <div className="flex gap-2 mb-3 flex-wrap max-w-4xl">
        {TAB_MODES.map(m => {
          const on = m.key === activeMode;
          return (
            <button key={m.key} onClick={() => selectMode(m.key)}
              aria-pressed={on}
              className={`min-h-[44px] relative px-4 py-2 rounded-lg text-sm font-semibold transition-all border
                ${on
                  ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                  : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
              {t(`modes.${m.key}`)}
              {modeBadge[m.key] > 0 && (
                <span className="ms-2 bg-cz-accent text-cz-on-accent text-[9px] font-black px-1.5 py-0.5 rounded-full">
                  {modeBadge[m.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* #58: sekundært underfane-bånd — kun for modes med flere faner (Forhandlinger).
          "Skal handles" og "Marked" har hver kun én fane, så de skjuler dette bånd. */}
      {showSubTabs && (
        <div className="flex gap-2 mb-5 flex-wrap max-w-4xl">
          {activeModeTabs.map(key => {
            const meta = tabMeta[key];
            const on = tab === key;
            return (
              <button key={key} onClick={() => setTab(key)}
                aria-pressed={on}
                className={`min-h-[44px] relative px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
                  ${on
                    ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                    : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
                {meta.label}
                {meta.badge > 0 && (
                  <span className="ms-2 bg-cz-accent text-cz-on-accent text-[9px] font-black px-1.5 py-0.5 rounded-full">
                    {meta.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <PageLoader />
      ) : (
        <div>
          {tab === "received" && (
            <div className="flex flex-col gap-3">
              {receivedOffers.length === 0 ? (
                <EmptyState
                  icon={<ExchangeIcon size={28} aria-hidden="true" />}
                  title={t("empty.received")}
                  description={t("empty.receivedHint")}
                />
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
                <EmptyState
                  icon={<ExchangeIcon size={28} aria-hidden="true" />}
                  title={t("empty.sent")}
                  description={t("empty.sentHint")}
                />
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
                <EmptyState
                  icon={<InboxIcon size={28} aria-hidden="true" />}
                  title={t("empty.archive")}
                />
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
                  className="min-h-[44px] w-full py-2.5 bg-cz-accent/10 text-cz-accent-t/80 border border-cz-accent/15 rounded-cz text-sm font-medium
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
                <EmptyState
                  icon={<ExchangeIcon size={28} aria-hidden="true" />}
                  title={t("empty.swaps")}
                  description={t("empty.swapsHint")}
                />
              )}
            </div>
          )}

          {tab === "market" && (
            <div>
              {/* #1569: kort intro så nye spillere forstår transferlistens marked
                  (vs. auktioner). */}
              <p className="text-cz-3 text-xs mb-3 max-w-4xl">{t("marketIntro")}</p>
              {/* #1675: cap filter-panelet (form-inputs strækkes ikke i fuld bredde —
                  samme konvention som RidersPage max-w-[1600px]). */}
              <div className="max-w-[1600px]">
                <RiderFilters
                  filters={riderFilters.filters}
                  onChange={riderFilters.onChange}
                  onReset={riderFilters.onReset}
                  showTeamFilter={false}
                  nationalities={riderFilters.nationalities}
                />
              </div>
              {/* #1185/#2329: sortér på listing-pris (asking_price)/værdi/alder/nyeste
                  via knapperne, ELLER klik en kolonne-header direkte — begge sætter
                  den samme kanoniske sort-state (marketSortState).
                  #2031: evne-sortering via dropdown (15 evner = for mange til knapper). */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-cz-3 text-xs uppercase tracking-wider">{t("marketSort.label")}</span>
                {MARKET_SORT_BUTTONS.map(btn => {
                  const active = marketSort === btn.sort && marketSortDir === btn.dir;
                  return (
                    <button key={btn.key} onClick={() => setExactMarketSort(btn.sort, btn.dir)}
                      className={`min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
                        ${active
                          ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                          : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
                      {t(`marketSort.${btn.key}`)}
                    </button>
                  );
                })}
                <select
                  aria-label={t("marketSort.abilityLabel")}
                  value={ABILITY_KEYS.includes(marketSort) ? marketSort : ""}
                  onChange={e => { if (e.target.value) setExactMarketSort(e.target.value, "desc"); }}
                  className={`min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
                    ${ABILITY_KEYS.includes(marketSort)
                      ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                      : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
                  <option value="">{t("marketSort.abilityPlaceholder")}</option>
                  {ABILITY_KEYS.map(key => (
                    <option key={key} value={key}>{t(`marketSort.abilities.${key}`)}</option>
                  ))}
                </select>
              </div>
              {filteredListings.length === 0 ? (
                <EmptyState
                  icon={<ExchangeIcon size={28} aria-hidden="true" />}
                  title={listings.length === 0 ? t("empty.marketNoListings") : t("empty.marketNoMatches")}
                />
              ) : (
                /* #1523: rækkelayout på linje med ryttersiden (RidersPage) — bedre
                   overblik + samme evne-kolonner. Sticky navn-kolonne + vandret
                   scroll til evnerne; pris/status/bud i en expander-række. */
                <Card className="overflow-hidden">
                  <div className="overflow-auto max-h-[calc(100vh-260px)]">
                    <table data-sortable className="w-full text-xs">
                      <thead className="sticky top-0 z-20 bg-cz-card shadow-sm">
                        <tr className="border-b border-cz-border">
                          {/* Nation-kolonnen er bevidst ikke sorterbar (rent visuelt flag, ingen
                              entydig "bedste" nation) — resten af kolonnerne er via SortableTh. */}
                          <th className="px-2 py-3 text-left font-medium uppercase tracking-wider text-cz-3 w-12 hidden sm:table-cell">{t("marketRow.nation")}</th>
                          <SortableTh sortKey="rider" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className="px-3 py-3 text-left uppercase tracking-wider w-40 sticky left-0 z-30 bg-cz-card border-r border-cz-border">
                            {t("marketRow.rider")}
                          </SortableTh>
                          <SortableTh sortKey="seller" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className="px-3 py-3 text-left uppercase tracking-wider hidden sm:table-cell">
                            {t("marketRow.seller")}
                          </SortableTh>
                          <SortableTh sortKey="age" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className="px-2 py-3 text-center uppercase tracking-wider w-12 hidden md:table-cell">
                            {t("marketRow.age")}
                          </SortableTh>
                          <SortableTh sortKey="listed" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className="px-3 py-3 text-left uppercase tracking-wider hidden md:table-cell">
                            {t("marketRow.listed")}
                          </SortableTh>
                          <SortableTh sortKey="value" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className="px-3 py-3 text-right uppercase tracking-wider w-20">
                            {t("marketRow.value")}
                          </SortableTh>
                          <SortableTh sortKey="salary" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className="px-3 py-3 text-right uppercase tracking-wider w-20 hidden sm:table-cell">
                            {t("marketRow.salary")}
                          </SortableTh>
                          <SortableTh sortKey="price" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className="px-3 py-3 text-right uppercase tracking-wider w-24">
                            {t("marketRow.price")}
                          </SortableTh>
                          {LISTING_STATS.map(({ key, label }) => (
                            <SortableTh key={key} sortKey={key} sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                              className="px-1.5 py-3 text-center w-14">
                              {label}
                            </SortableTh>
                          ))}
                          <th className="px-3 py-3 text-right font-medium uppercase tracking-wider text-cz-3 w-28">{t("marketRow.action")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredListings.map(l => (
                          <MarketRow
                            key={l.id}
                            listing={l}
                            myTeamId={myTeamId}
                            statCols={LISTING_STATS}
                            expanded={expandedListingId === l.id}
                            onToggleExpand={toggleExpandedListing}
                            onOffer={(riderId, amt, msg) => handleOffer(riderId, amt, msg)}
                            onRemove={handleRemoveListing}
                            onUpdatePrice={handleUpdateListingPrice}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
