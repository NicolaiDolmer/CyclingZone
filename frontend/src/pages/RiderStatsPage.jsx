import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { getAuthedUser } from "../lib/getAuthedUser.js";
import { formatCz, getRiderMarketValue, getRiderSalary } from "../lib/marketValues.js";
import { pickBestValueTrendWindow } from "../lib/riderValueTrend.js";
import { riderOverallRating } from "../lib/riderRating";
import { RIDER_TYPE_KEYS } from "../lib/riderTypeKeys.js";
import { chartColor } from "../lib/chartPalette.js";
import { formatNumber } from "../lib/intl";
import { resolveApiError } from "../lib/apiError";
import RiderManageActions from "../components/rider/RiderManageActions.jsx";
import { useScouting } from "../lib/useScouting";
import { useTraining } from "../lib/useTraining";
import { useTrainingHistory } from "../lib/useTrainingHistory";
import { BidConfirmModal } from "../components/BidConfirmModal";
import { RacePriceModal } from "../components/RacePriceModal";
import { ConfettiModal } from "../components/ConfettiModal";
import OverbidToast from "../components/OverbidToast";
import {
  isManagerSeller,
  getAuctionLeaderId,
  getAuctionLeaderName,
  getAuctionSellerLabel,
  computeWorstCaseReservation,
} from "../lib/auctionLogic";
import { useAuctionBidding } from "../lib/useAuctionBidding";
import { isOverbidEvent, shouldFlashPrice } from "../lib/auctionsRealtime";
import { logEvent, logFirstEvent } from "../lib/logEvent";
import { ABILITY_KEYS, topAbilityKey } from "../lib/abilities.js";
import { PageLoader } from "../components/ui";
import { buttonClass } from "../components/ui/buttonStyles.js";
import RiderProfileHero from "../components/rider/profile/RiderProfileHero.jsx";
import RiderSwitcherBar from "../components/rider/profile/RiderSwitcherBar.jsx";
import RiderProfileTabs from "../components/rider/profile/RiderProfileTabs.jsx";
import { winsOnTerrainKeys } from "../lib/riderTerrain.js";
import RiderAbilityColumns from "../components/rider/profile/RiderAbilityColumns.jsx";
import RiderTypeRadar from "../components/rider/profile/RiderTypeRadar.jsx";
import RiderOverviewPhysiology from "../components/rider/profile/RiderOverviewPhysiology.jsx";
import RiderPhysiologyTab from "../components/rider/profile/RiderPhysiologyTab.jsx";
import RiderTrainingTab from "../components/rider/profile/RiderTrainingTab.jsx";
import RiderDevelopmentTab from "../components/rider/profile/RiderDevelopmentTab.jsx";
import RiderScoutingTab from "../components/rider/profile/RiderScoutingTab.jsx";
import RiderHistoryTab from "../components/rider/profile/RiderHistoryTab.jsx";
import RiderResultsTab from "../components/rider/profile/RiderResultsTab.jsx";
import RiderPalmaresTab from "../components/rider/profile/RiderPalmaresTab.jsx";
import RiderInterestTab from "../components/rider/profile/RiderInterestTab.jsx";

const API = import.meta.env.VITE_API_URL;

// Hent ALLE en rytters race_results til Resultater-fanen (PCS-tabel + totaler).
// Pagineret fordi PostgREST capper ved 1000 rækker/side — uden det ville en
// rytter med mange resultater få trunkerede sejrs-/præmie-totaler.
// #2000: udvidet med stage/point/løbs-metadata + terræn via race_pool
// (races.pool_race_id → race_pool.terrain_archetype; public-read, verificeret
// mod prod 2026-07-03). Grupperingen sker i lib/riderResultsTab.js.
// Returnerer { rows, failed } — en query-fejl (side 1 ELLER en senere side) må
// ikke ligne "ingen/få resultater" (#1338-princippet, review-fund): fanen viser
// en eksplicit fejl-tilstand i stedet for stille trunkerede totaler.
async function fetchAllRiderSeasonRows(riderId) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("race_results")
      .select(`rank, prize_money, points_earned, result_type, stage_number, team_name,
        race:race_id(id, name, race_type, race_class, stages, status, scheduled_for,
          season:season_id(number), pool:pool_race_id(terrain_archetype))`)
      .eq("rider_id", riderId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) return { rows, failed: true };
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return { rows, failed: false };
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
}

// Hero-handlingsrækkens trigger-knapper (ejer-feedback 3/7): kompakte, auto-
// bredde og med appens delte buttonStyles i stedet for fuldbredde-bjælker.
// Åben-tilstand = accent-tint så den udfoldede formular kobles visuelt til sin knap.
const TRIGGER_OPEN = "!border-cz-accent/40 !text-cz-accent-t !bg-cz-accent/5";
const triggerClass = (open, variant = "secondary") =>
  `${buttonClass({ variant })} ${open ? TRIGGER_OPEN : ""}`;
// Udfoldede paneler/feedback: komponent-roden er display:contents, så panelet
// lægger sig i FULD bredde UNDER hele trigger-rækken (order-2) i stedet for at
// splitte rækken. Den tintede trigger viser hvilken knap panelet hører til.
const ACTION_PANEL = "order-2 w-full";

// Evne-rækker, power-stat-grid og race-physiology-preview er flyttet til de
// dedikerede Overblik-komponenter under components/rider/profile/ (#2000 stykke 2):
// RiderAbilityColumns (3-kort evne-grid), RiderTypeRadar (ryttertype-spider) og
// RiderOverviewPhysiology (compact fysiologi-teaser).

function SwapOfferButton({ rider, myTeamId }) {
  const { t } = useTranslation("rider");
  const [show, setShow]         = useState(false);
  const [myRiders, setMyRiders] = useState([]);
  const [offeredId, setOfferedId] = useState("");
  const [cash, setCash]         = useState(0);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);

  async function loadMyRiders() {
    const { data } = await supabase
      .from("riders")
      .select("id, firstname, lastname, market_value")
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
      else        { setResult({ ok: false, msg: `${t("swapOffer.toast.errorPrefix")} ${resolveApiError(data, t)}` }); }
    } catch {
      setResult({ ok: false, msg: t("auth:error.connectionFailed") });
    } finally {
      setLoading(false);
      setTimeout(() => setResult(null), 4000);
    }
  }

  return (
    <div className="contents">
      {result && (
        <div className={`${ACTION_PANEL} px-3 py-2 rounded-lg text-sm border
          ${result.ok ? "bg-cz-success-bg text-cz-success border-cz-success/30" : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
          {result.msg}
        </div>
      )}
      <button type="button" onClick={openForm} className={triggerClass(show)}>
        {t("swapOffer.buttonOpen")}
      </button>
      {show && (
        <div className={`${ACTION_PANEL} flex flex-col gap-2`}>
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

function DirectOfferButton({ rider }) {
  const { t } = useTranslation("rider");
  const [show, setShow]       = useState(false);
  const [amount, setAmount]   = useState(getRiderMarketValue(rider));
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
        // #1583: aktiverings-funnel — kun brugerens FØRSTE transfer (de-dup pr. bruger).
        logFirstEvent("first_transfer", { rider_id: rider.id, amount });
        setResult({ ok: true, msg: t("directOffer.toast.success") }); setShow(false);
      }
      else        { setResult({ ok: false, msg: `${t("directOffer.toast.errorPrefix")} ${resolveApiError(data, t)}` }); }
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
    <div className="contents">
      {result && (
        <div className={`${ACTION_PANEL} px-3 py-2 rounded-lg text-sm border
          ${result.ok ? "bg-cz-success-bg text-cz-success border-cz-success/30" : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
          {result.msg}
        </div>
      )}
      {/* Primær CTA i scouting-visningen (én accent-knap pr. kontekst). */}
      <button type="button" onClick={() => setShow(!show)} className={triggerClass(false, "primary")}>
        {t("directOffer.buttonOpen")}
      </button>
      {show && (
        <div className={`${ACTION_PANEL} flex flex-col gap-2`}>
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

// #1185: sæt rytteren til salg på transferlisten direkte fra profilen — før
// kun muligt via Min trup-modalen. Viser eksisterende åben listing (pris +
// redigér + fjern) hvis rytteren allerede er til salg; ellers pris-form der
// POSTer /api/transfers. Genbruger PATCH/DELETE /api/transfers/:id fra
// transferlistens egne kort. Fjern bruger in-app confirm (ikke window.confirm
// — upålidelig i mobile in-app-browsere).
function TransferListButton({ rider }) {
  const { t } = useTranslation("rider");
  const [show, setShow]       = useState(false);
  const [listing, setListing] = useState(null);
  const [price, setPrice]     = useState(getRiderMarketValue(rider));
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        // GET /api/transfers returnerer åbne listings — find rytterens egen.
        // Fejler kaldet, virker salgs-knappen stadig (POST svarer 409 hvis
        // rytteren allerede er listet).
        const res = await fetch(`${API}/api/transfers`, { headers: { Authorization: `Bearer ${session.access_token}` } });
        const data = await res.json().catch(() => []);
        if (!cancelled && Array.isArray(data)) {
          const own = data.find(l => l.rider?.id === rider.id) || null;
          setListing(own);
          if (own) setPrice(own.asking_price);
        }
      } catch { /* bevidst stille — se kommentar ovenfor */ }
    })();
    return () => { cancelled = true; };
  }, [rider.id]);

  const priceInvalid = !Number.isInteger(price) || price <= 0;

  function flashResult(ok, msg) {
    setResult({ ok, msg });
    setTimeout(() => setResult(null), 4000);
  }

  async function submit() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        listing ? `${API}/api/transfers/${listing.id}` : `${API}/api/transfers`,
        {
          method: listing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify(listing ? { asking_price: price } : { rider_id: rider.id, asking_price: price }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setListing(listing ? { ...listing, asking_price: price } : data);
        setShow(false);
        flashResult(true, listing ? t("sellRider.toast.priceUpdated") : t("sellRider.toast.listed"));
      } else {
        flashResult(false, `${t("sellRider.toast.errorPrefix")} ${resolveApiError(data, t)}`);
      }
    } catch {
      flashResult(false, t("auth:error.connectionFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function removeListing() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/transfers/${listing.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setListing(null);
        setPrice(getRiderMarketValue(rider));
        setShow(false);
        flashResult(true, t("sellRider.toast.removed"));
      } else {
        flashResult(false, `${t("sellRider.toast.errorPrefix")} ${resolveApiError(data, t)}`);
      }
    } catch {
      flashResult(false, t("auth:error.connectionFailed"));
    } finally {
      setLoading(false);
      setConfirmRemove(false);
    }
  }

  return (
    <div className="contents">
      {result && (
        <div className={`${ACTION_PANEL} px-3 py-2 rounded-lg text-sm border
          ${result.ok ? "bg-cz-success-bg text-cz-success border-cz-success/30" : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
          {result.msg}
        </div>
      )}
      {listing ? (
        <div className={`${ACTION_PANEL} rounded-cz border border-cz-border bg-cz-subtle p-3 flex flex-col gap-2`}>
          <p className="text-cz-2 text-sm">
            {t("sellRider.listedStatus", { amount: formatNumber(listing.asking_price) })}
          </p>
          {confirmRemove ? (
            <div className="flex gap-2">
              <button onClick={removeListing} disabled={loading}
                className="flex-1 min-h-[44px] py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm font-medium disabled:opacity-50 transition-all">
                {loading ? "..." : t("sellRider.confirmRemove")}
              </button>
              <button onClick={() => setConfirmRemove(false)} disabled={loading}
                className="flex-1 min-h-[44px] py-2 bg-cz-card text-cz-2 border border-cz-border rounded-lg text-sm hover:text-cz-1 disabled:opacity-50 transition-all">
                {t("sellRider.cancel")}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setShow(!show)}
                className="flex-1 min-h-[44px] py-2 bg-cz-card text-cz-2 border border-cz-border rounded-lg text-sm font-medium hover:text-cz-1 hover:border-cz-accent/40 transition-all">
                {show ? t("sellRider.hideEdit") : t("sellRider.editPrice")}
              </button>
              <button onClick={() => { setShow(false); setConfirmRemove(true); }}
                className="flex-1 min-h-[44px] py-2 bg-cz-card text-cz-2 border border-cz-border rounded-lg text-sm font-medium hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all">
                {t("sellRider.remove")}
              </button>
            </div>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setShow(!show)} className={triggerClass(show)}>
          {t("sellRider.buttonOpen")}
        </button>
      )}
      {show && (
        <div className={`${ACTION_PANEL} flex flex-col gap-2`}>
          <p className="text-cz-3 text-xs">{t("sellRider.description")}</p>
          <input type="number" value={price} min={1}
            onChange={e => { const v = parseInt(e.target.value, 10); setPrice(Number.isNaN(v) ? 0 : v); }}
            placeholder={t("sellRider.pricePlaceholder")}
            className="w-full min-h-[44px] bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-base sm:text-sm focus:outline-none focus:border-cz-accent" />
          <button onClick={submit} disabled={loading || priceInvalid}
            className="w-full min-h-[44px] py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50 transition-all">
            {loading ? t("sellRider.sending") : listing ? t("sellRider.submitUpdate") : t("sellRider.submit")}
          </button>
        </div>
      )}
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

function RiderBidPanel({ auction, myTeamId, myBalance, reservedBalance, riderName, onBid, onSetProxy, onRemoveProxy, requestBidConfirm, isFlashing }) {
  // "auctions" loades med så hookets fejltekst (auctions:error.insufficientBalance)
  // kan resolves — uden den kastede klient-gaten TypeError (t var ikke givet videre)
  // og spilleren så ingen fejl overhovedet (#1184).
  const { t } = useTranslation(["rider", "auctions"]);
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
    auction, myBalance, reservedBalance, myTeamId, onBid, onSetProxy, onRemoveProxy, requestBidConfirm,
    riderName: riderName || t("auctionPanel.riderNameFallback"),
    t,
  });

  return (
    <div className={`rounded-cz border p-4 ${imWinning ? "border-cz-accent/40 bg-cz-accent/[0.04]" : "border-cz-border bg-cz-subtle"}`}>
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
  // Ejer-feedback 3/7: pris-formularen var altid udfoldet og fyldte hero'en —
  // nu en kompakt trigger-knap der folder formularen ud (samme mønster som
  // salgs-/bud-knapperne).
  const [open, setOpen]             = useState(false);
  const [price, setPrice]           = useState(riderValue);
  const [loading, setLoading]       = useState(false);
  const [flash, setFlash]           = useState(false);

  // Egne ryttere: pris må være mellem 0 og Værdi (ikke over). AI/fri rytter: Værdi er gulvet.
  const priceError      = isOwnRider ? (price > riderValue || price < 0) : (price < riderValue);

  return (
    <div className="contents">
      <button type="button" onClick={() => setOpen(!open)} className={triggerClass(open)}>
        {auctionLabel}
      </button>
      {open && (
        <div className={ACTION_PANEL}>
          {ddActive && (
            <label className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-3 cursor-pointer select-none">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={flash} onChange={e => setFlash(e.target.checked)}
                  className="rounded accent-cz-danger" />
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
                  ? "border-cz-danger/40 focus:border-cz-danger"
                  : "border-cz-border focus:border-cz-accent"}`}
            />
            <button
              onClick={async () => { setLoading(true); await onStart(price, flash); setLoading(false); }}
              disabled={loading || priceError}
              className={`w-full sm:w-auto min-h-[44px] px-4 py-2 font-bold rounded-lg text-sm transition-all disabled:opacity-50
                ${flash ? "bg-cz-danger text-white hover:brightness-110" : "bg-cz-accent text-cz-on-accent hover:brightness-110"}`}>
              {loading ? t("auctionStart.buttons.loading") : flash ? t("auctionStart.buttons.startFlash") : t("auctionStart.buttons.start")}
            </button>
          </div>
          {priceError && (
            <p className="text-cz-danger text-xs mt-1.5">
              {t(isOwnRider ? "auctionStart.priceErrorOwn" : "auctionStart.priceError", { amount: formatNumber(riderValue) })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function RiderStatsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation("rider");
  const { t: tTypes } = useTranslation("riderTypes");

  const scouting = useScouting();
  const training = useTraining();
  // #1533: træningsrapport-historik (egne ryttere) — vises i Development-fanen.
  const trainingHistory = useTrainingHistory();
  const [rider, setRider]                   = useState(null);
  const [onWatchlist, setOnWatchlist]       = useState(false);
  const [watchlistId, setWatchlistId]       = useState(null);
  const [watchlistCount, setWatchlistCount] = useState(0);
  const [visits, setVisits]                 = useState(null);
  const [seasonRows, setSeasonRows]         = useState([]);
  // Fejl-flag for resultat-hentningen (#1338-princippet): en query-fejl må ikke
  // ligne "ingen resultater" eller stille trunkerede totaler.
  const [seasonRowsFailed, setSeasonRowsFailed] = useState(false);
  // #2000 Interesse: null = loader (fanen viser spinner, ikke "ingen interesse").
  const [interest, setInterest]             = useState(null);
  const [loading, setLoading]               = useState(true);
  const [tab, setTab]                       = useState("overview");
  // Roster for switcher-baren (#2000): det VISTE holds trup, til prev/next + index.
  const [roster, setRoster]                 = useState([]);
  const [myTeamId, setMyTeamId]             = useState(null);
  const [myBalance, setMyBalance]           = useState(0);
  const [myReservedBalance, setMyReservedBalance] = useState(0);
  const [activeAuction, setActiveAuction]   = useState(null);
  const [auctionError, setAuctionError]     = useState(null);
  // #2000 Historik: null = loader — [] betyder ægte "ingen handelshistorik".
  const [history, setHistory]               = useState(null);
  const [statHistory, setStatHistory]       = useState(null); // null = loader endnu
  const [projection, setProjection]         = useState(null); // #2100 fuzzy loft-projektion
  const [valueTrend, setValueTrend]         = useState(null); // #2499: { windows: {"7":...,"14":...} } | null
  const [physBenchmark, setPhysBenchmark]   = useState(null);
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
  // #2000 stykke 5: stale-guard for development-fetchen (hurtig prev/next-switch).
  const developmentFetchIdRef = useRef(null);
  const projectionFetchIdRef = useRef(null); // #2100 samme stale-guard for projektionen
  const valueTrendFetchIdRef = useRef(null); // #2499 samme stale-guard for værdi-deltaet
  // #2000 sidste faner: samme stale-guards for historik + interesse + de
  // datastroemme fanerne konsumerer (bid-timeline, visits, watchlist-count,
  // rider/seasonRows) — review-fund: uden guards kan hurtig prev/next i
  // switcheren lade forrige rytters sene svar overskrive den nyes.
  const historyFetchIdRef = useRef(null);
  const interestFetchIdRef = useRef(null);
  const bidTimelineFetchIdRef = useRef(null);
  const visitsFetchIdRef = useRef(null);
  const watchlistCountFetchIdRef = useRef(null);
  const riderFetchIdRef = useRef(null);
  useEffect(() => { activeAuctionRef.current = activeAuction; }, [activeAuction]);
  useEffect(() => { myTeamIdRef.current = myTeamId; }, [myTeamId]);

  // #2000: hent det VISTE holds trup til switcher-baren (prev/next + index).
  // Non-kritisk — fejler stille (switcheren skjules bare hvis rosteret mangler).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const teamId = rider?.team_id;
      if (!teamId) { setRoster([]); return; }
      const { data } = await supabase
        .from("riders")
        .select("id, firstname, lastname")
        .eq("team_id", teamId)
        .or("is_retired.is.null,is_retired.eq.false")
        .order("lastname");
      if (!cancelled) setRoster(data || []);
    })();
    return () => { cancelled = true; };
  }, [rider?.team_id]);

  // #2000 stykke 3: divisions-fysiologi-snit til Fysiologi-fanens benchmarks.
  // Hentes lazily når fanen åbnes (backend cacher pr. division). Fri agent/ingen
  // division → intet snit (fanen viser egne tal uden sammenligning). Non-kritisk.
  useEffect(() => {
    if (tab !== "physiology") return;
    const division = rider?.team?.division;
    if (!division) { setPhysBenchmark(null); return; }
    if (physBenchmark?.division === division) return; // allerede hentet
    let cancelled = false;
    (async () => {
      try {
        const h = await authHeaders();
        const res = await fetch(`${API}/api/physiology/division-benchmark?division=${division}`, { headers: h });
        if (res.ok && !cancelled) setPhysBenchmark(await res.json());
      } catch { /* non-kritisk: fanen falder tilbage til egne tal uden sammenligning */ }
    })();
    return () => { cancelled = true; };
  }, [tab, rider?.team?.division, physBenchmark?.division]);

  async function loadWatchlistStatus() {
    const user = await getAuthedUser();
    if (!user) return;
    const { data } = await supabase.from("rider_watchlist")
      .select("id").eq("user_id", user.id).eq("rider_id", id).maybeSingle();
    if (data) { setOnWatchlist(true); setWatchlistId(data.id); }
    else      { setOnWatchlist(false); setWatchlistId(null); }
  }

  async function loadWatchlistCount() {
    // Reset kun ved rytter-skift (toggleWatchlist genkalder for SAMME rytter —
    // et ubetinget reset ville flashe tallet). Stale-guard mod sene svar.
    const fetchId = id;
    if (watchlistCountFetchIdRef.current !== fetchId) setWatchlistCount(0);
    watchlistCountFetchIdRef.current = fetchId;
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${fetchId}/watchlist-count`, { headers: h });
      const data = await res.json();
      if (watchlistCountFetchIdRef.current !== fetchId) return;
      setWatchlistCount(data.count || 0);
    } catch { /* non-critical: tallet forbliver 0 for den nye rytter */ }
  }

  // Popularitet (#957): unikke besøgende 24t/7d + trend. Non-critical — fejler
  // stille, men reset + stale-guard sikrer at Interesse-fanen aldrig viser
  // forrige rytters visningstal/trend.
  async function loadVisits() {
    const fetchId = id;
    visitsFetchIdRef.current = fetchId;
    setVisits(null);
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${fetchId}/view-count`, { headers: h });
      const data = await res.json();
      if (visitsFetchIdRef.current !== fetchId) return;
      setVisits(data);
    } catch { /* non-critical: TrendSub/summary håndterer visits=null */ }
  }

  async function toggleWatchlist() {
    const user = await getAuthedUser();
    if (!user) return;
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
    // Reset up-front + stale-guard (samme mønster som loadDevelopmentHistory):
    // et rytter-skift må hverken vise forrige rytters historik eller lade et
    // sent svar overskrive den nyes.
    const fetchId = id;
    historyFetchIdRef.current = fetchId;
    setHistory(null);
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${fetchId}/history`, { headers: h });
      // Fejl må ikke ligne "ingen handelshistorik" (#1338-princippet) — fanen
      // viser en eksplicit kunne-ikke-hentes-tilstand i stedet for tom liste.
      const data = res.ok ? await res.json() : { error: true };
      if (historyFetchIdRef.current !== fetchId) return;
      setHistory(Array.isArray(data) || data?.error ? data : []);
    } catch {
      if (historyFetchIdRef.current === fetchId) setHistory({ error: true });
    }
  }

  async function loadInterest() {
    // #2000 Interesse: scoutet-af + aktivitetsfeed (backend aggregerer +
    // håndhæver privacy — team-navne kun til ejeren). Samme stale-guard.
    const fetchId = id;
    interestFetchIdRef.current = fetchId;
    setInterest(null);
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${fetchId}/interest`, { headers: h });
      // Fejl må ikke ligne "ingen interesse" (#1338-princippet) — fanen viser
      // en eksplicit kunne-ikke-hentes-tilstand i stedet for nuller.
      const data = res.ok ? await res.json() : { error: true };
      if (interestFetchIdRef.current !== fetchId) return;
      setInterest(data);
    } catch {
      if (interestFetchIdRef.current === fetchId) setInterest({ error: true });
    }
  }

  async function loadBidTimeline() {
    // Bud-rækkerne flettes ind i Historik-tabellen (review-fund): reset ved
    // rytter-skift + stale-guard, så forrige rytters bud aldrig optræder i den
    // nyes handelshistorik. Reset er BETINGET — realtime-callbacks genkalder
    // loadBidTimeline for SAMME rytter ved hvert live-bud, og et ubetinget
    // null-reset ville flashe rækkerne væk midt i en auktion.
    const fetchId = id;
    if (bidTimelineFetchIdRef.current !== fetchId) setBidTimeline(null);
    bidTimelineFetchIdRef.current = fetchId;
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${fetchId}/bid-timeline`, { headers: h });
      const data = res.ok ? await res.json() : { auction_id: null, status: null };
      if (bidTimelineFetchIdRef.current !== fetchId) return;
      setBidTimeline(data);
    } catch {
      if (bidTimelineFetchIdRef.current === fetchId) setBidTimeline({ auction_id: null, status: null });
    }
  }

  async function loadDevelopmentHistory() {
    // #2000 Part 2 / #918: evnevektor-snapshots fra det RLS-lukkede datalag
    // (rider_derived_ability_history) via backend-endpoint — erstatter den døde
    // PCM rider_stat_history-feed. Type-ratingen pr. ryttertype beregnes i
    // RiderDevelopmentTab via rating-SSOT'en (riderRating.js).
    // null = loader (fanen viser spinner, ikke misvisende empty-state); ryd
    // up-front (CodeRabbit #2015) så et rytter-skift ALDRIG viser forrige rytters
    // kurve. Stale-guard via ref: hurtig prev/next i switcheren må ikke lade et
    // SENT svar fra forrige rytter overskrive den nyes data (roster-mønstret).
    const fetchId = id;
    developmentFetchIdRef.current = fetchId;
    setStatHistory(null);
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${fetchId}/development`, { headers: h });
      const data = res.ok ? await res.json() : [];
      if (developmentFetchIdRef.current !== fetchId) return; // stale svar — ny rytter er i gang
      setStatHistory(data);
    } catch {
      // non-critical: Udvikling-tabben falder tilbage til empty-state
      if (developmentFetchIdRef.current === fetchId) setStatHistory([]);
    }
  }

  async function loadDevelopmentProjection() {
    // #2100: fuzzy loft-projektion til Udvikling-fanen. Backend maskerer alt (hidden for
    // uscoutede rivaler, capsMissing hvis ingen caps) → null her betyder bare "vis den
    // rene registrerede kurve". Samme stale-guard som development-historikken.
    const fetchId = id;
    projectionFetchIdRef.current = fetchId;
    setProjection(null);
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${fetchId}/development-projection`, { headers: h });
      const data = res.ok ? await res.json() : null;
      if (projectionFetchIdRef.current !== fetchId) return; // stale svar — ny rytter er i gang
      setProjection(data);
    } catch {
      if (projectionFetchIdRef.current === fetchId) setProjection(null);
    }
  }

  async function loadValueTrend() {
    // #2499: værdi-bevægelse skal kunne SES — on-demand delta (7/14 dage) ved
    // siden af market_value i hero'en. Non-critical (samme mønster som de
    // andre sekundære profil-fetches): en fejl skjuler bare deltaet, brækker
    // aldrig resten af profilen. Samme stale-guard som Udvikling-fanens data.
    const fetchId = id;
    valueTrendFetchIdRef.current = fetchId;
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${fetchId}/value-trend`, { headers: h });
      const data = res.ok ? await res.json() : null;
      if (valueTrendFetchIdRef.current !== fetchId) return; // stale svar — ny rytter er i gang
      setValueTrend(data);
    } catch {
      if (valueTrendFetchIdRef.current === fetchId) setValueTrend(null);
    }
  }

  async function loadMyTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) return;
    const { data: t } = await supabase.from("teams").select("id, balance, division, name").eq("user_id", user.id).single();
    if (t) { setMyTeamId(t.id); setMyBalance(t.balance || 0); }

    // #1184: hent worst-case commitment (førende auktioner + autobud-lofter) så
    // bid-panelets klient-gate validerer mod TILGÆNGELIG saldo — samme semantik
    // som auktionssiden og backend-gaten (auctionRules.js).
    if (t?.id) {
      const [leadingRes, proxiesRes] = await Promise.all([
        supabase.from("auctions")
          .select("id, current_price, current_bidder_id")
          .in("status", ["active", "extended"])
          .eq("current_bidder_id", t.id),
        supabase.from("auction_proxy_bids")
          .select("auction_id, max_amount, auction:auction_id(id, current_price, current_bidder_id, status)")
          .eq("team_id", t.id),
      ]);
      const proxyMaxByAuction = {};
      const proxyAuctions = [];
      for (const p of proxiesRes.data || []) {
        if (!["active", "extended"].includes(p.auction?.status)) continue;
        proxyMaxByAuction[p.auction_id] = p.max_amount;
        proxyAuctions.push(p.auction);
      }
      const seen = new Set();
      const committedAuctions = [];
      for (const a of [...(leadingRes.data || []), ...proxyAuctions]) {
        if (!a?.id || seen.has(a.id)) continue;
        seen.add(a.id);
        committedAuctions.push({ ...a, myProxyMax: proxyMaxByAuction[a.id] || null });
      }
      setMyReservedBalance(computeWorstCaseReservation(committedAuctions, t.id));
    }
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
    // Race-engine-fundamentet (#676) hentes fejl-tolerant ved siden af rytteren, så
    // en manglende tabel/profil (fx i deploy-vinduet før migrationen er kørt, eller
    // for ryttere uden backfill) aldrig brækker rytter-siden — preview vises bare ikke.
    // Stale-guard (review-fund): hurtig prev/next må ikke lade forrige rytters
    // sene svar overskrive rider/seasonRows for den nye.
    const fetchId = id;
    riderFetchIdRef.current = fetchId;
    const safe = async (q) => { try { return await q; } catch { return { data: null }; } };
    const [riderRes, seasonRowsAll, physRes, abilRes, progressRes] = await Promise.all([
      // #1162: eksplicit kolonneliste — `select=*` på riders afvises efter
      // column-privilege-migrationen (potentiale er server-skjult; klienter får
      // kun det maskerede estimat via POST /api/scouting/estimates).
      // #2000: PCM stat_* droppet fra denne select — typeLabel afleder nu af de
      // udledte evner (rider_derived_abilities, hentet nedenfor). Ingen andre
      // visnings-flader på rytterprofilen læser riders.stat_* længere.
      supabase.from("riders").select(`id, pcm_id, firstname, lastname, birthdate, height, weight,
        market_value, base_value, prize_earnings_bonus, salary, contract_length, contract_end_season, is_u25, is_retired, is_academy, pending_team_id,
        nationality_code, primary_type, secondary_type, team_id, acquired_at,
        team:team_id(id, name, is_ai, is_bank, division),
        pending_team:pending_team_id(id, name)`).eq("id", id).single(),
      // ALLE rækker (pagineret) til Resultater-fanen — både PCS-tabellen og
      // totalerne bygger på det fulde sæt (en .limit(20) ville trunkere begge).
      // #2000: den gamle separate "seneste 20"-visningsquery er fjernet.
      fetchAllRiderSeasonRows(id),
      safe(supabase.from("rider_physiology_profiles").select("*").eq("rider_id", id).maybeSingle()),
      // #1162: eksplicit kolonneliste — hidden_potential er server-skjult (eksakt
      // invertérbar til potentiale: ungdom + seeded støj kan begge beregnes i
      // klienten), og select=* afvises efter column-privilege-migrationen.
      // Kun de 15 synlige evner (ABILITY_CATEGORIES) + metadata bruges i UI'et.
      safe(supabase.from("rider_derived_abilities").select(`rider_id, formula_version,
        climbing, time_trial, flat, tempo, sprint, acceleration, punch,
        endurance, recovery, durability, descending, cobblestone, positioning,
        aggression, tactics`).eq("rider_id", id).maybeSingle()),
      // #2000: ability_progress (0..1 pr. evne mod næste +1) i ET SEPARAT,
      // fejl-tolerant kald — så et eventuelt manglende kolonne-SELECT-grant i
      // deploy-vinduet (før 2026-06-29-ability-progress-client-select-grant.sql
      // er kørt) aldrig brækker hoved-evne-kaldet. Progress vises for ALLE ryttere.
      safe(supabase.from("rider_derived_abilities")
        .select("ability_progress").eq("rider_id", id).maybeSingle()),
    ]);
    if (riderFetchIdRef.current !== fetchId) return; // stale svar — ny rytter er i gang
    setRider(riderRes.data
      ? {
          ...riderRes.data,
          physiology: physRes.data || null,
          abilities: abilRes.data || null,
          // ability_progress: { <evne>: 0..1 } | null. Manglende rad/kolonne →
          // null → tomme/neutrale progress-bjælker (StatRow håndterer null).
          abilityProgress: progressRes.data?.ability_progress || null,
        }
      : riderRes.data);
    setSeasonRows(seasonRowsAll.rows);
    setSeasonRowsFailed(seasonRowsAll.failed);

    await loadActiveAuctionFull(riderRes.data);
    if (riderFetchIdRef.current !== fetchId) return;
    setLoading(false);
    loadWatchlistCount();

    // Log besøg for ALLE ryttere (#963) — ikke kun hold-ejede. Endpointet
    // håndterer både besøgs-logging og det (team-gated) transferrygte internt.
    // Fyrer én gang pr. profil-mount (useEffect [id]) — ikke pr. re-render.
    if (riderRes.data?.id) {
      const h = await authHeaders();
      fetch(`${API}/api/riders/${fetchId}/view`, { method: "POST", headers: h }).catch(() => {});
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

  useEffect(() => { loadRider(); loadMyTeam(); loadWatchlistStatus(); loadHistory(); loadDevelopmentHistory(); loadDevelopmentProjection(); loadValueTrend(); loadDdStatus(); loadBidTimeline(); loadVisits(); loadInterest(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [bidTimeline?.auction_id, bidTimeline?.status, rider]); // eslint-disable-line react-hooks/exhaustive-deps

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
    return { ok: false, error: resolveApiError(data, t, t("auctionPanel.errorFallback")) };
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
    return { ok: false, error: resolveApiError(data, t, t("auctionPanel.proxyErrorFallback")) };
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
      setAuctionError(resolveApiError(data, t, t("blocked.errorFallback")));
      setTimeout(() => setAuctionError(null), 5000);
    }
  }

  if (loading) return (
    <PageLoader label={t("page.loadingAria")} />
  );

  if (!rider) return <div className="text-cz-3 text-center py-16">{t("page.notFound")}</div>;

  // #2000 Part 2 / #918: type-meta (label + token-backet linje-farve fra den delte
  // chart-palette, ingen raw hex) til Udvikling-fanens type-rating-graf. Rækkefølge =
  // RIDER_TYPE_KEYS; rating beregnes i tabben.
  const developmentTypes = RIDER_TYPE_KEYS.map((key, i) => ({ key, label: tTypes(`types.${key}`), color: chartColor(i) }));
  const isMyRider  = rider.team_id === myTeamId;
  // #2007: en egen AKADEMI-rytter har sit eget flow (promovér) — den kan ikke
  // sættes på auktion/transferliste/fyres (backend afviser rider_is_academy).
  const isAcademyRider = Boolean(rider.is_academy);
  const isMySeniorRider = isMyRider && !isAcademyRider;
  const isFreeAgent = !rider.team_id;
  const isBankRider = Boolean(rider.team?.is_bank);
  const isAiRider = Boolean(rider.team?.is_ai);
  const isPendingTransfer = Boolean(rider.pending_team_id);
  const isRetired = Boolean(rider.is_retired);

  // #2000 stykke 2: progress-fraktion pr. evne til Overblik-evnekolonnerne.
  // Egne ryttere foretrækker den friske training.progress (optimistisk efter et
  // tick); ellers DB'ens ability_progress. Bygges i SSOT-evne-rækkefølge.
  const overviewProgress = {};
  if (rider.abilities) {
    for (const key of ABILITY_KEYS) {
      const ownFrac = isMyRider ? training.progress?.[rider.id]?.[key] : undefined;
      overviewProgress[key] = ownFrac != null ? ownFrac : rider.abilityProgress?.[key];
    }
  }
  // #2007: akademi-ryttere ekskluderes fra auktion (kun frie agenter og egne
  // SENIOR-ryttere kan sættes på auktion). #2264: bank/AI-ryttere er fjernet —
  // backend har blokeret dem siden 2026-06-30 (ai_rider_no_auction), så knappen
  // gav kun en fejl.
  const canAuction  = (isFreeAgent || isMySeniorRider) && !isPendingTransfer && !isRetired;
  const canDirectOffer = rider.team_id && rider.team_id !== myTeamId && !isBankRider && !isAiRider && !isPendingTransfer && !isRetired;
  const auctionLabel = isMyRider
    ? t("auctionStart.label.myRider")
    : t("auctionStart.label.free");
  // Racing-age (year-arithmetic) — matches U25/filter-logik andre steder i appen.
  // Ellers kunne profil vise "24 år" mens max_age=25-filteret tæller rytteren som 25.
  const age = rider.birthdate
    ? new Date().getFullYear() - new Date(rider.birthdate).getFullYear()
    : null;
  // #2000: type-label-fallbacken (vist når primary_type mangler) afledes nu af de
  // udledte CZ-evner via abilities.js-SSOT'en — ikke længere af PCM stat_*-kolonner.
  const typeLabel = (() => {
    const key = topAbilityKey(rider.abilities);
    return key ? t(`racePreview.derived.${key}`) : t("header.typeDefault");
  })();
  const riderValueLabel = formatCz(getRiderMarketValue(rider));
  const riderValueAmount = riderValueLabel.replace(" CZ$", "");
  // #2499: værdi-bevægelse skal kunne SES — vælg det bedste tilgængelige vindue
  // (foretræk 14 dage) fra det separat hentede value-trend-svaret. null = intet
  // vist (ny/utrænet rytter eller fetch fejlede) — RiderValueTrendBadge skjuler sig selv.
  const riderValueTrendWindow = pickBestValueTrendWindow(valueTrend?.windows);
  // #2006: Overall 1-99-rating. Evnerne ligger på rider.abilities (rå rad fra
  // rider_derived_abilities) — riderOverallRating læser rider.climbing osv., så
  // vi fladter abilities ind sammen med den lagrede primary_type (ejer-direktiv:
  // samme type-model som den viste primær/sekundær-type).
  const overallRating = rider.abilities
    ? riderOverallRating({ ...rider.abilities, primary_type: rider.primary_type })
    : 0;
  // ── #2000 redesign — afledte hero-felter (ren visning, ingen ny data) ────────
  const divisionLabel = rider.team?.division != null
    ? t("profile.hero.divisionChip", { division: rider.team.division })
    : null;
  // #1287/#950: kommende hold ved handel til næste sæson — skjult ved self-pending
  // (pending_team == nuværende hold, fx intern handel — ikke et reelt holdskifte).
  const pendingTeam = rider.pending_team?.name && rider.pending_team.id !== rider.team?.id
    ? rider.pending_team
    : null;
  // Hero'en sætter selv "Løn"-etiketten — værdien er kun beløbet (~ = estimat
  // for fri agent). Før gav header.contractSalary ("Salary CZ$") dublet-tekst:
  // "Salary 42,000 Salary CZ$".
  const salaryText = rider.contract_length != null
    ? `${formatNumber(rider.salary)} CZ$`
    : `~${formatNumber(getRiderSalary(rider))} CZ$`;
  const winsOnText = winsOnTerrainKeys(rider.primary_type, rider.secondary_type)
    .map((k) => t(`terrain.${k}`)).join(", ") || null;
  // Status-banner: auktion > akademi > kontrakt-udløb (egne ryttere).
  let statusBanner = null;
  if (activeAuction) {
    const diff = new Date(activeAuction.calculated_end) - new Date();
    const h = Math.max(0, Math.floor(diff / 3600000));
    const m = Math.max(0, Math.floor((diff % 3600000) / 60000));
    statusBanner = {
      kind: "auction",
      endsIn: diff > 0 ? (h > 0 ? `${h}t ${m}m` : `${m}m`) : "—",
      highBid: formatNumber(activeAuction.current_price),
    };
  } else if (isAcademyRider) {
    statusBanner = { kind: "academy" };
  } else if (isMyRider && rider.contract_end_season != null) {
    statusBanner = { kind: "expiry", season: rider.contract_end_season };
  }
  // Switcher: rytterens position i det viste holds trup.
  const rosterIdx = roster.findIndex((r) => String(r.id) === String(rider.id));
  const prevRider = rosterIdx > 0 ? roster[rosterIdx - 1] : null;
  const nextRider = rosterIdx >= 0 && rosterIdx < roster.length - 1 ? roster[rosterIdx + 1] : null;

  return (
    // #2253: translate="no" — rytterprofilen (dynamiske stats/scouting-flader)
    // fik NotFoundError-crashes når browser-oversættere muterede tekst-noderne
    // (Sentry CYCLINGZONE-1P m.fl., url=/riders/:id). Se PR #2272.
    <div translate="no" className="max-w-5xl mx-auto min-w-0">
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
      />
      <OverbidToast toasts={toasts} onDismiss={dismissToast} />

      <button onClick={() => navigate(-1)} className="text-cz-3 hover:text-cz-1 text-sm mb-4 flex items-center gap-1">{t("page.back")}</button>

      {roster.length > 1 && rosterIdx >= 0 && (
        <RiderSwitcherBar
          prevRider={prevRider}
          nextRider={nextRider}
          teamName={rider.team?.name ?? t("header.freeAgent")}
          index={rosterIdx + 1}
          total={roster.length}
          onNavigate={(rid) => navigate(`/riders/${rid}`)}
        />
      )}

      <div className="mb-4">
        <RiderProfileHero
          rider={rider}
          viewer={isMyRider ? "own" : "scouting"}
          overallRating={overallRating}
          age={age}
          typeLabel={typeLabel}
          divisionLabel={divisionLabel}
          valueAmount={riderValueAmount}
          valueLabel={riderValueLabel}
          valueTrendWindow={riderValueTrendWindow}
          salaryText={salaryText}
          winsOnText={winsOnText}
          isAiTeam={isAiRider}
          pendingTeam={pendingTeam}
          banner={statusBanner}
          scouting={scouting}
          onWatchlist={onWatchlist}
          onToggleWatchlist={toggleWatchlist}
          onCompare={() => navigate(`/compare?ids=${rider.id}`)}
          actions={
            /* Ejer-feedback 3/7: kompakt horisontal handlingsrække (prototypens
               action row) — udvidede formularer folder ud i fuld bredde under
               rækken (hver komponents wrapper skifter selv til w-full). Fuld-
               bredde-elementer (notiser, fejl, bid-panel) er w-full-børn. */
            <div className="flex flex-wrap items-start gap-2">
              {isPendingTransfer && (
                <p className="w-full text-cz-3 text-xs text-center py-2 bg-cz-subtle rounded-lg border border-cz-border">
                  {t("blocked.pendingTransfer")}
                </p>
              )}
              {isRetired && (
                <p className="w-full text-cz-3 text-xs text-center py-2 bg-cz-subtle rounded-lg border border-cz-border">
                  {t("blocked.retired")}
                </p>
              )}
              {auctionError && (
                <div className="w-full px-3 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm">
                  {auctionError}
                </div>
              )}
              {activeAuction && (
                <div className="w-full">
                  <RiderBidPanel
                    auction={activeAuction}
                    myTeamId={myTeamId}
                    myBalance={myBalance}
                    reservedBalance={myReservedBalance}
                    riderName={`${rider.firstname} ${rider.lastname}`}
                    onBid={handleAuctionBid}
                    onSetProxy={handleSetProxy}
                    onRemoveProxy={handleRemoveProxy}
                    requestBidConfirm={requestBidConfirm}
                    isFlashing={priceFlash}
                  />
                </div>
              )}
              {/* #2007: egen-rytter-handlinger. Rækkefølge som prototypen:
                  Forlæng (guld) · Akademi · Sæt til salg · Start auktion · Frigiv
                  — markeds-knapperne injiceres FØR den destruktive Frigiv. */}
              {isMyRider && !isPendingTransfer && !isRetired ? (
                <RiderManageActions
                  rider={rider}
                  onChanged={loadRider}
                  marketActions={
                    <>
                      {/* #1185: egne SENIOR-ryttere kan sættes til salg direkte herfra */}
                      {isMySeniorRider && <TransferListButton rider={rider} />}
                      {canAuction && !activeAuction && <AuctionButton rider={rider} auctionLabel={auctionLabel} onStart={startAuction} ddActive={ddActive} isOwnRider={isMyRider} />}
                    </>
                  }
                />
              ) : (
                canAuction && !activeAuction && <AuctionButton rider={rider} auctionLabel={auctionLabel} onStart={startAuction} ddActive={ddActive} isOwnRider={isMyRider} />
              )}
              {canDirectOffer && <DirectOfferButton rider={rider} />}
              {canDirectOffer && <SwapOfferButton rider={rider} myTeamId={myTeamId} />}
            </div>
          }
        />
      </div>

      <RiderProfileTabs
        tabs={[
          { key: "overview",    label: t("profile.tabs.overview") },
          { key: "physiology",  label: t("profile.tabs.physiology") },
          { key: "training",    label: t("profile.tabs.training") },
          { key: "development", label: t("profile.tabs.development") },
          // Scouting-fanen bygges i egen slice (#2000) — viser indtil da en
          // "på vej"-flade med link til roadmappet (ejer-beslutning 3/7).
          { key: "scouting",    label: t("profile.tabs.scouting") },
          { key: "history",     label: t("profile.tabs.history") },
          { key: "results",     label: t("profile.tabs.results") },
          { key: "palmares",    label: t("profile.tabs.palmares") },
          { key: "interest",    label: t("profile.tabs.interest") },
        ]}
        activeTab={tab}
        onSelect={(key) => {
          setTab(key);
          // Telemetri pr. redesign-fane (#2000) — samme mønster som Udvikling.
          if (key === "development") logEvent("feature_rider_development_tab_opened", { rider_id: rider.id });
          if (key === "scouting") logEvent("feature_rider_scouting_tab_opened", { rider_id: rider.id });
          if (key === "history") logEvent("feature_rider_history_tab_opened", { rider_id: rider.id });
          if (key === "results") logEvent("feature_rider_results_tab_opened", { rider_id: rider.id });
          if (key === "palmares") logEvent("feature_rider_palmares_tab_opened", { rider_id: rider.id });
          if (key === "interest") logEvent("feature_rider_interest_tab_opened", { rider_id: rider.id });
        }}
      />

      {/* #2000 stykke 2 — Overblik: objektivt snapshot. Evne-kolonner (3 kort) +
          ryttertype-radar (ægte type-ratings) + compact fysiologi-teaser. Intet
          scout-verdikt her (det lever i Scouting). */}
      {tab === "overview" && (
        rider.abilities ? (
          <div className="flex flex-col gap-[13px]">
            <RiderAbilityColumns
              abilities={rider.abilities}
              progressByKey={overviewProgress}
              isOwnRider={isMyRider}
            />
            <div className={`grid grid-cols-1 ${rider.physiology ? "lg:grid-cols-2" : ""} gap-[13px] items-start`}>
              <RiderTypeRadar
                rider={rider}
                onGoScouting={() => setTab("scouting")}
              />
              {rider.physiology && (
                <RiderOverviewPhysiology
                  physiology={rider.physiology}
                  weight={rider.weight}
                  onGoFysiologi={() => setTab("physiology")}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="bg-cz-card border border-cz-border rounded-cz p-5">
            <p className="text-cz-3 text-sm py-2">{t("stats.abilitiesPending")}</p>
          </div>
        )
      )}

      {/* #2000 sidste faner — Resultater (PCS-stil: totaler + udfoldelige etapeløb),
          Interesse (ægte interesse-signaler) og Historik (kompakt handels-tabel).
          key={id} nulstiller fanens lokale state (filter/udfoldning) ved rytter-skift. */}
      {tab === "results" && <RiderResultsTab key={rider.id} seasonRows={seasonRows} loadFailed={seasonRowsFailed} />}

      {/* #1997 S1 — Palmarès: trofæskab + karrieretotaler + sæson-æresliste
          m. holdet ved hvert resultat (#1993-snapshot). Samme seasonRows som
          Resultater-fanen, ingen dublet-fetch. */}
      {tab === "palmares" && <RiderPalmaresTab key={rider.id} seasonRows={seasonRows} loadFailed={seasonRowsFailed} />}

      {tab === "interest" && (
        <RiderInterestTab
          viewer={isMyRider ? "own" : "scouting"}
          watchlistCount={watchlistCount}
          visits={visits}
          interest={interest}
        />
      )}

      {tab === "history" && <RiderHistoryTab events={history} bidTimeline={bidTimeline} />}

      {tab === "training" && (
        <RiderTrainingTab
          rider={rider}
          training={training}
          trainingHistory={trainingHistory}
          progress={overviewProgress}
          viewer={isMyRider ? "own" : "scouting"}
          isRetired={isRetired}
        />
      )}

      {/* #2000 stykke 5 — Udvikling: registreret rating-udvikling pr. type +
          vækst denne sæson + træningsdrevet udviklingslog (kun egne ryttere).
          Loft/projektion er BEVIDST udskudt til ejer-review (balance-følsomt). */}
      {tab === "development" && (
        <RiderDevelopmentTab
          rider={rider}
          history={statHistory}
          types={developmentTypes}
          trainingHistory={trainingHistory}
          viewer={isMyRider ? "own" : "scouting"}
          projection={projection}
        />
      )}

      {tab === "physiology" && (
        <RiderPhysiologyTab physiology={rider.physiology} benchmark={physBenchmark} />
      )}

      {/* Scouting bygges i egen slice — "på vej"-flade med roadmap-link +
          stemme-opfordring (ejer-beslutning 3/7). Scout-flowet (estimat +
          scout-knap) lever indtil da i hero'en. */}
      {tab === "scouting" && <RiderScoutingTab key={rider.id} rider={rider} scouting={scouting} />}
    </div>
  );
}
