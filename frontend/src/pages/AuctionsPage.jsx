import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { NavLink } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { statStyle } from "../lib/statColor";
import { ConfettiModal } from "../components/ConfettiModal";
import { RacePriceModal } from "../components/RacePriceModal";
import { Flag } from "../components/Flag";
import ScoutablePotentiale from "../components/rider/ScoutablePotentiale";
import { useScouting } from "../lib/useScouting";
import { scoutSortValue } from "../lib/scouting";
import AuctionsFirstBidHint from "../components/AuctionsFirstBidHint";
import OnboardingTour from "../components/OnboardingTour";
import { startTour } from "../lib/onboardingTour";
import AuctionsSidebarFeed from "../components/AuctionsSidebarFeed";
import OverbidToast from "../components/OverbidToast";
import WatchlistStar from "../components/WatchlistStar";
import { BidConfirmModal } from "../components/BidConfirmModal";
import StatsToggle from "../components/StatsToggle";
import useStatsToggle from "../lib/useStatsToggle";
import { logEvent } from "../lib/logEvent";
import {
  isOverbidEvent,
  shouldFlashPrice,
  filterBidEventsForFeed,
  getMyParticipatingAuctionIds,
  pruneStaleBidEvents,
} from "../lib/auctionsRealtime";
import {
  isManagerSeller,
  getAuctionLeaderId,
  getAuctionLeaderName,
  getAuctionSellerLabel,
  computeWorstCaseReservation,
} from "../lib/auctionLogic";
import { useAuctionBidding } from "../lib/useAuctionBidding";
import { formatNumber } from "../lib/intl";
import { resolveApiError } from "../lib/apiError";
import { getRiderSalary } from "../lib/marketValues.js";

const API = import.meta.env.VITE_API_URL;

// Live bud-feed: hvor længe et bud bliver liggende i feed/ticker-bufferen.
// Tidligere 30s — udvidet til 15 min (#1510406001751363584) så manageren kan se
// "de seneste bud" over en brugbar periode, ikke kun de sidste sekunder.
const BID_FEED_WINDOW_MS = 15 * 60 * 1000;

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABEL_BY_KEY = {
  stat_fl: "FL", stat_bj: "BJ", stat_kb: "KB", stat_bk: "BK", stat_tt: "TT",
  stat_prl: "PRL", stat_bro: "Bro", stat_sp: "SP", stat_acc: "ACC",
  stat_ned: "NED", stat_udh: "UDH", stat_mod: "MOD", stat_res: "RES", stat_ftr: "FTR",
};

// Onboarding v2 Slice 1b — tour-trin på /auctions (aktiveres fra Dashboard "Vis mig hvordan").
// i18n Fase 3b: konstrueres via t() ved render-tid så sproget følger user's locale.
function getAuctionsTourSteps(t) {
  return [
    {
      target: "[data-tour='auctions-bid-input']",
      title: t("auctions:tour.placeBid.title"),
      body: t("auctions:tour.placeBid.body"),
    },
    {
      target: "[data-tour='auctions-countdown']",
      title: t("auctions:tour.countdown.title"),
      body: t("auctions:tour.countdown.body"),
    },
  ];
}

function SortTh({ children, sortKey, sort, sortDir, onSort, className = "" }) {
  const active = sort === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none transition-colors ${active ? "text-cz-accent-t/80" : "text-cz-3 hover:text-cz-2"} ${className}`}>
      {children}{active && <span className="ms-0.5 text-[10px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

// ── Countdown timer ───────────────────────────────────────────────────────────
function Countdown({ end, status }) {
  const { t, i18n } = useTranslation("auctions");
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);

  // Absolute end time in user's local timezone with explicit TZ label (e.g. "21:00 CEST")
  const endLabel = useMemo(() => {
    if (!end || status === "completed") return null;
    return new Date(end).toLocaleTimeString(i18n.language || "en", {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  }, [end, status, i18n.language]);

  useEffect(() => {
    if (status === "completed") { setText(t("timer.completed")); return; }
    function update() {
      const diff = new Date(end) - new Date();
      if (diff <= 0) { setText(t("timer.expired")); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setUrgent(diff < 600000);
      setText(
        h > 0 ? t("timer.hoursMinutes", { h, m })
        : m > 0 ? t("timer.minutesSeconds", { m, s })
        : t("timer.seconds", { s })
      );
    }
    update();
    const tick = setInterval(update, 1000);
    return () => clearInterval(tick);
  }, [end, status, t]);

  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span className={`font-mono text-xs ${urgent ? "text-cz-danger animate-pulse" : "text-cz-2"}`}>
        {text}
      </span>
      {endLabel && (
        <span className="text-[9px] text-cz-3 leading-none">{endLabel}</span>
      )}
    </span>
  );
}

// ── Auction table row ─────────────────────────────────────────────────────────
function AuctionRow({ auction, myTeamId, myBalance, reservedBalance, watchlist, onToggleWatchlist, onBid, onSetProxy, onRemoveProxy, requestBidConfirm, isFirst, isFlashing, visibleStats, scouting }) {
  const { t } = useTranslation(["auctions", "common"]);
  const r = auction.rider;
  const isMyRider = r?.team_id === myTeamId;
  const isSeller  = isManagerSeller(auction, myTeamId);
  const imWinning = getAuctionLeaderId(auction) === myTeamId;
  const canBid    = !isMyRider && auction.status !== "completed";
  const onWatchlist = r?.id ? watchlist?.has(r.id) : false;
  const visibleStatsArr = STATS.filter(k => visibleStats?.has(k));
  const riderName = r ? `${r.firstname} ${r.lastname}` : t("auctions:fallback.rider");

  const {
    minBid, myProxy,
    bidAmount, setBidAmount, bidStatus, errorText, warningText,
    proxyExpanded, setProxyExpanded, proxyInput, setProxyInput,
    proxyStatus, proxyErrorText,
    handleBid, handleSaveProxy, handleRemoveProxy,
  } = useAuctionBidding({
    auction, myBalance, reservedBalance, myTeamId, onBid, onSetProxy, onRemoveProxy, requestBidConfirm, riderName, t,
  });

  const age = r?.birthdate ? new Date().getFullYear() - new Date(r.birthdate).getFullYear() : null;

  return (
    <tr className={`group border-b border-cz-border hover:bg-cz-subtle transition-colors
      ${imWinning ? "bg-cz-accent/[0.08]" : ""}`}>

      {/* Rytter — sticky left */}
      <td className={`auction-rider-cell px-3 py-1.5 min-w-[180px] sticky left-0 z-10 border-r border-cz-border shadow-[10px_0_16px_-16px_rgba(0,0,0,0.5)] ${imWinning ? "auction-rider-cell-winning" : ""}`}>
        <div className="flex items-start gap-2">
          {r?.id && (
            <WatchlistStar
              active={onWatchlist}
              onToggle={() => onToggleWatchlist(r.id)}
              className="mt-0.5"
            />
          )}
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            {r?.nationality_code && <Flag code={r.nationality_code} className="text-xs flex-shrink-0" />}
            <RiderLink id={r?.id}
              className="text-cz-1 text-sm font-medium hover:text-cz-accent-t transition-colors text-left truncate max-w-[160px]">
              {r?.firstname} {r?.lastname}
            </RiderLink>
            <div className="flex items-center gap-1 flex-wrap">
              {imWinning && (
                <span className="text-[9px] uppercase bg-cz-accent/10 text-cz-accent-t px-1.5 py-0.5 rounded">
                  {t("auctions:badge.winning")}
                </span>
              )}
              {isSeller && (
                <span className="text-[9px] uppercase bg-cz-info-bg text-cz-info px-1.5 py-0.5 rounded">
                  {t("auctions:badge.seller")}
                </span>
              )}
              {isMyRider && !isSeller && (
                <span className="text-[9px] uppercase bg-cz-info-bg text-cz-info px-1.5 py-0.5 rounded">
                  {t("auctions:badge.mine")}
                </span>
              )}
              {auction.status === "extended" && (
                <span className="text-[9px] uppercase bg-cz-warning-bg text-cz-warning px-1.5 py-0.5 rounded">
                  {t("auctions:badge.extended")}
                </span>
              )}
              {auction.is_flash && (
                <span className="text-[9px] uppercase bg-cz-danger-bg text-cz-danger px-1.5 py-0.5 rounded">
                  {t("auctions:badge.flash")}
                </span>
              )}
              {r?.is_u25 && (
                <span className="text-[9px] uppercase bg-cz-subtle text-cz-3 px-1.5 py-0.5 rounded">{t("auctions:badge.u25")}</span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* Højeste bud */}
      <td className="px-3 py-1.5 text-right whitespace-nowrap">
        <span className={`inline-block px-1.5 ${isFlashing ? "cz-pulse-flash" : ""}`}>
          <span className="text-cz-1 font-mono font-bold text-sm">
            {formatNumber(auction.current_price ?? 0)}
          </span>
          <span className="text-cz-3 text-xs ms-1">CZ$</span>
        </span>
        {getAuctionLeaderName(auction) && !imWinning && (
          <p className="text-cz-3 text-[10px] truncate max-w-[100px]">
            {getAuctionLeaderName(auction)}
          </p>
        )}
      </td>

      {/* Tid tilbage */}
      <td className="px-3 py-1.5 text-center whitespace-nowrap" data-tour={isFirst ? "auctions-countdown" : undefined}>
        <Countdown end={auction.calculated_end} status={auction.status} />
      </td>

      {/* Alder */}
      <td className="px-2 py-1.5 text-center text-cz-2 font-mono text-xs hidden xl:table-cell">
        {age ?? "—"}
      </td>

      {/* Løn */}
      <td className="px-2 py-1.5 text-right text-cz-2 font-mono text-xs whitespace-nowrap">
        {formatNumber(getRiderSalary(r))}
        {r?.contract_length != null && (
          <span className="ms-1 text-cz-3 text-[10px]">{t("auctions:card.contractExpires", { season: r.contract_end_season })}</span>
        )}
      </td>

      {/* Potentiale */}
      <td className="px-3 py-1.5">
        <ScoutablePotentiale rider={r} scouting={scouting} showScout />
      </td>

      {/* Sælger — lige før stats */}
      <td className="px-3 py-1.5 text-left text-cz-2 text-xs whitespace-nowrap hidden xl:table-cell">
        <span className="truncate max-w-[120px] inline-block">{getAuctionSellerLabel(auction)}</span>
      </td>

      {/* Stats — kun de toggled */}
      {visibleStatsArr.map(key => (
        <td key={key} className="px-1 py-1.5 text-center">
          <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded" style={statStyle(r?.[key] || 0)}>
            {r?.[key] || "—"}
          </span>
        </td>
      ))}

      {/* Byd */}
      <td className={`auction-bid-cell px-3 py-1.5 sticky right-0 z-10 min-w-[190px] border-l border-cz-border shadow-[-10px_0_16px_-16px_rgba(0,0,0,0.5)] transition-colors ${imWinning ? "auction-bid-cell-winning" : ""}`}>
        {canBid ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={bidAmount}
                min={minBid}
                onChange={e => { const v = parseInt(e.target.value, 10); setBidAmount(isNaN(v) ? 0 : v); }}
                data-tour={isFirst ? "auctions-bid-input" : undefined}
                aria-label={t("auctions:bid.inputAria")}
                className="w-24 bg-cz-subtle border border-cz-border rounded px-2 py-1.5
                  text-cz-1 font-mono text-xs focus:outline-none focus:border-cz-accent"
              />
              <button
                onClick={handleBid}
                disabled={bidStatus === "loading" || bidAmount < minBid}
                aria-label={imWinning ? t("auctions:bid.buttonRaiseAria") : t("auctions:bid.buttonPlaceAria")}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all whitespace-nowrap
                  ${bidStatus === "error"   ? "bg-cz-danger-bg text-cz-danger border border-cz-danger/30" :
                    bidStatus === "success" ? "bg-cz-success-bg text-cz-success border border-cz-success/30" :
                    imWinning
                      ? "bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 hover:bg-cz-accent/25"
                      : "bg-cz-accent text-cz-on-accent hover:brightness-110"}
                  disabled:opacity-50`}>
                {bidStatus === "loading" ? t("common:actions.loadingShort") :
                 bidStatus === "error"   ? t("auctions:bid.buttonError") :
                 bidStatus === "success" ? t("common:actions.success") :
                 imWinning ? t("auctions:bid.buttonRaise") : t("auctions:bid.buttonPlace")}
              </button>
              {bidStatus === "error" && errorText && (
                <p className="text-[10px] text-cz-danger max-w-[90px] leading-tight">{errorText}</p>
              )}
            </div>
            <p className="text-[9px] text-cz-3 leading-none">{t("auctions:bid.minBid", { amount: formatNumber(minBid) })}</p>
            {/* Proxy bid section */}
            {myProxy && !proxyExpanded ? (
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[9px] bg-cz-success-bg text-cz-success px-1.5 py-0.5 rounded whitespace-nowrap">
                  {t("auctions:bid.proxy.display", { amount: formatNumber(myProxy) })}
                </span>
                <button onClick={() => setProxyExpanded(true)} aria-label={t("auctions:bid.proxy.edit")} className="text-[9px] text-cz-3 hover:text-cz-2">{t("auctions:bid.proxy.editButton")}</button>
                <button onClick={handleRemoveProxy} aria-label={t("auctions:bid.proxy.remove")} className="text-[9px] text-cz-3 hover:text-cz-danger">✕</button>
              </div>
            ) : !proxyExpanded ? (
              <button
                onClick={() => setProxyExpanded(true)}
                aria-label={t("auctions:bid.proxy.set")}
                className="mt-1 inline-flex min-h-[28px] items-center justify-center rounded border border-cz-accent/50 bg-cz-accent/10 px-2 py-1 text-[10px] font-bold text-cz-accent-t hover:bg-cz-accent/20"
              >
                {t("auctions:bid.proxy.buttonAdd")}
              </button>
            ) : (
              <div className="flex flex-col gap-0.5 mt-0.5">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={proxyInput}
                    min={minBid}
                    onChange={e => { const v = parseInt(e.target.value, 10); setProxyInput(isNaN(v) ? 0 : v); }}
                    placeholder={t("auctions:bid.proxy.placeholder")}
                    aria-label={t("auctions:bid.proxy.inputAria")}
                    className="w-20 bg-cz-subtle border border-cz-border rounded px-1.5 py-1 text-cz-1 font-mono text-[10px] focus:outline-none focus:border-cz-accent"
                  />
                  <button
                    onClick={handleSaveProxy}
                    disabled={proxyStatus === "loading" || proxyInput < minBid}
                    aria-label={t("auctions:bid.proxy.save")}
                    className={`px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap
                      ${proxyStatus === "error" ? "bg-cz-danger-bg text-cz-danger border border-cz-danger/30" :
                        proxyStatus === "saved" ? "bg-cz-success-bg text-cz-success border border-cz-success/30" :
                        "bg-cz-subtle border border-cz-border text-cz-2 hover:border-cz-accent hover:text-cz-accent-t"}
                      disabled:opacity-50`}>
                    {proxyStatus === "loading" ? t("common:actions.loadingShort") : proxyStatus === "error" ? t("auctions:bid.buttonError") : proxyStatus === "saved" ? t("common:actions.success") : t("auctions:bid.proxy.saveButton")}
                  </button>
                  <button onClick={() => setProxyExpanded(false)} aria-label={t("auctions:bid.proxy.cancel")} className="text-[9px] text-cz-3 hover:text-cz-2">✕</button>
                </div>
                {proxyStatus === "error" && proxyErrorText && (
                  <p className="text-[10px] text-cz-danger max-w-[160px] leading-tight">{proxyErrorText}</p>
                )}
              </div>
            )}
          </div>
        ) : isSeller ? (
          <span className="text-cz-3 text-xs">{t("auctions:bid.sellerLabel")}</span>
        ) : (
          <span className="text-cz-3 text-xs">—</span>
        )}
        {warningText && (
          <p className="text-[10px] text-cz-warning leading-tight mt-1 max-w-[260px]">{warningText}</p>
        )}
      </td>
    </tr>
  );
}

function AuctionCard({ auction, myTeamId, myBalance, reservedBalance, watchlist, onToggleWatchlist, onBid, onSetProxy, onRemoveProxy, requestBidConfirm, isFirst, isFlashing, visibleStats, scouting }) {
  const { t } = useTranslation(["auctions", "common"]);
  const r = auction.rider;
  const isMyRider = r?.team_id === myTeamId;
  const isSeller = isManagerSeller(auction, myTeamId);
  const imWinning = getAuctionLeaderId(auction) === myTeamId;
  const canBid = !isMyRider && auction.status !== "completed";
  const age = r?.birthdate ? new Date().getFullYear() - new Date(r.birthdate).getFullYear() : null;
  const onWatchlist = r?.id ? watchlist?.has(r.id) : false;
  const visibleStatsArr = STATS.filter(k => visibleStats?.has(k));
  const riderName = r ? `${r.firstname} ${r.lastname}` : t("auctions:fallback.rider");

  const {
    minBid, myProxy,
    bidAmount, setBidAmount, bidStatus, errorText, warningText,
    proxyExpanded, setProxyExpanded, proxyInput, setProxyInput,
    proxyStatus, proxyErrorText,
    handleBid, handleSaveProxy, handleRemoveProxy,
  } = useAuctionBidding({
    auction, myBalance, reservedBalance, myTeamId, onBid, onSetProxy, onRemoveProxy, requestBidConfirm, riderName, t,
  });

  return (
    <div className={`bg-cz-card border rounded-xl p-4 transition-all ${imWinning ? "border-cz-accent/40 bg-cz-accent/10/40" : "border-cz-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          {r?.id && (
            <WatchlistStar
              active={onWatchlist}
              onToggle={() => onToggleWatchlist(r.id)}
              className="mt-0.5"
            />
          )}
          <div className="min-w-0">
            <RiderLink id={r?.id}
              className="text-left text-cz-1 font-semibold text-sm hover:text-cz-accent-t transition-colors">
              {r?.nationality_code && <Flag code={r.nationality_code} className="me-1" />}
              {r?.firstname} {r?.lastname}
            </RiderLink>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {imWinning && <span className="text-[9px] uppercase bg-cz-accent/20 text-cz-accent-t px-1.5 py-0.5 rounded">{t("auctions:badge.winning")}</span>}
              {isSeller && <span className="text-[9px] uppercase bg-cz-info-bg text-cz-info px-1.5 py-0.5 rounded">{t("auctions:badge.seller")}</span>}
              {auction.status === "extended" && <span className="text-[9px] uppercase bg-cz-warning-bg text-cz-warning px-1.5 py-0.5 rounded">{t("auctions:badge.extended")}</span>}
              {auction.is_flash && <span className="text-[9px] uppercase bg-cz-danger-bg text-cz-danger px-1.5 py-0.5 rounded">{t("auctions:badge.flash")}</span>}
              {r?.is_u25 && <span className="text-[9px] uppercase bg-cz-subtle text-cz-2 px-1.5 py-0.5 rounded">{t("auctions:badge.u25")}</span>}
              {age && <span className="text-cz-3 text-xs">{t("auctions:card.ageYears", { age })}</span>}
            </div>
          </div>
        </div>
        <div className="text-right flex-shrink-0" data-tour={isFirst ? "auctions-countdown" : undefined}>
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("auctions:card.time")}</p>
          <Countdown end={auction.calculated_end} status={auction.status} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className={`bg-cz-subtle rounded-lg px-3 py-2 ${isFlashing ? "cz-pulse-flash" : ""}`}>
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("auctions:card.highestBid")}</p>
          <p className="text-cz-1 font-mono font-bold text-sm">
            {formatNumber(auction.current_price ?? 0)} CZ$
          </p>
          {getAuctionLeaderName(auction) && !imWinning && (
            <p className="text-cz-3 text-[10px] truncate">{getAuctionLeaderName(auction)}</p>
          )}
        </div>
        <div className="bg-cz-subtle rounded-lg px-3 py-2">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">
            {r?.contract_length != null ? t("auctions:card.salary") : t("auctions:card.estSalary")}
          </p>
          <p className="text-cz-2 font-mono text-sm font-medium">
            {formatNumber(getRiderSalary(r))} CZ$
          </p>
          {r?.contract_length != null && (
            <p className="text-cz-3 text-[10px] mt-0.5">{t("auctions:card.contractExpires", { season: r.contract_end_season })}</p>
          )}
        </div>
        <div className="bg-cz-subtle rounded-lg px-3 py-2">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("auctions:card.seller")}</p>
          <p className="text-cz-2 text-sm font-medium truncate">{getAuctionSellerLabel(auction)}</p>
        </div>
      </div>

      {r?.id && scouting.estimateFor(r.id) !== null && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-cz-3 text-[9px] uppercase tracking-wider">{t("auctions:card.potential")}</span>
          <ScoutablePotentiale rider={r} scouting={scouting} showScout />
        </div>
      )}
      {visibleStatsArr.length > 0 && (
        <div className={`mt-2 grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${Math.min(visibleStatsArr.length, 5)}, minmax(0, 1fr))` }}>
          {visibleStatsArr.map(key => (
            <div key={key} className="text-center">
              <p className="text-cz-3 text-[9px] uppercase mb-0.5">{STAT_LABEL_BY_KEY[key]}</p>
              <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded" style={statStyle(r?.[key] || 0)}>
                {r?.[key] || "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        {canBid ? (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="number"
              value={bidAmount}
              min={minBid}
              onChange={e => { const v = parseInt(e.target.value, 10); setBidAmount(isNaN(v) ? 0 : v); }}
              data-tour={isFirst ? "auctions-bid-input" : undefined}
              aria-label={t("auctions:bid.inputAria")}
              className="min-w-0 min-h-[44px] bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-base focus:outline-none focus:border-cz-accent"
            />
            <p className="col-span-2 text-[10px] text-cz-3">{t("auctions:bid.minBidCard", { amount: formatNumber(minBid) })}</p>
            {bidStatus === "error" && errorText && <p className="col-span-2 text-[11px] text-cz-danger">{errorText}</p>}
            <button
              onClick={handleBid}
              disabled={bidStatus === "loading" || bidAmount < minBid}
              aria-label={imWinning ? t("auctions:bid.buttonRaiseAria") : t("auctions:bid.buttonPlaceAria")}
              className={`min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap
                ${bidStatus === "error" ? "bg-cz-danger-bg text-cz-danger border border-cz-danger/30" :
                  bidStatus === "success" ? "bg-cz-success-bg text-cz-success border border-cz-success/30" :
                  imWinning ? "bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40" : "bg-cz-accent text-cz-on-accent"}
                disabled:opacity-50`}>
              {bidStatus === "loading" ? t("common:actions.loadingShort") : bidStatus === "error" ? t("auctions:bid.buttonError") : bidStatus === "success" ? t("common:actions.success") : imWinning ? t("auctions:bid.buttonRaise") : t("auctions:bid.buttonPlace")}
            </button>
            {warningText && (
              <p className="col-span-2 text-[11px] text-cz-warning leading-snug">{warningText}</p>
            )}
            {/* Proxy bid section */}
            <div className="col-span-2 mt-1">
              {myProxy && !proxyExpanded ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] bg-cz-success-bg text-cz-success px-2 py-1 rounded-lg">
                    {t("auctions:bid.proxy.display", { amount: formatNumber(myProxy) })}
                  </span>
                  <button
                    onClick={() => setProxyExpanded(true)}
                    aria-label={t("auctions:bid.proxy.edit")}
                    className="min-h-[44px] px-3 text-xs text-cz-3 hover:text-cz-2"
                  >
                    {t("auctions:bid.proxy.editButton")}
                  </button>
                  <button
                    onClick={handleRemoveProxy}
                    aria-label={t("auctions:bid.proxy.remove")}
                    className="min-h-[44px] px-3 text-xs text-cz-3 hover:text-cz-danger"
                  >
                    {t("auctions:bid.proxy.removeButton")}
                  </button>
                </div>
              ) : !proxyExpanded ? (
                <button
                  onClick={() => setProxyExpanded(true)}
                  aria-label={t("auctions:bid.proxy.set")}
                  className="min-h-[44px] rounded-lg border border-cz-accent/50 bg-cz-accent/10 px-3 text-xs font-bold text-cz-accent-t hover:bg-cz-accent/20"
                >
                  {t("auctions:bid.proxy.buttonAddCard")}
                </button>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={proxyInput}
                      min={minBid}
                      onChange={e => { const v = parseInt(e.target.value, 10); setProxyInput(isNaN(v) ? 0 : v); }}
                      placeholder={t("auctions:bid.proxy.placeholder")}
                      aria-label={t("auctions:bid.proxy.inputAria")}
                      className="min-w-0 w-32 min-h-[44px] bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-base focus:outline-none focus:border-cz-accent"
                    />
                    <button
                      onClick={handleSaveProxy}
                      disabled={proxyStatus === "loading" || proxyInput < minBid}
                      aria-label={t("auctions:bid.proxy.save")}
                      className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap
                        ${proxyStatus === "error" ? "bg-cz-danger-bg text-cz-danger border border-cz-danger/30" :
                          proxyStatus === "saved" ? "bg-cz-success-bg text-cz-success border border-cz-success/30" :
                          "bg-cz-subtle border border-cz-border text-cz-2 hover:border-cz-accent hover:text-cz-accent-t"}
                        disabled:opacity-50`}>
                      {proxyStatus === "loading" ? t("common:actions.loadingShort") : proxyStatus === "error" ? t("auctions:bid.buttonError") : proxyStatus === "saved" ? t("common:actions.success") : t("auctions:bid.proxy.saveButton")}
                    </button>
                    <button
                      onClick={() => setProxyExpanded(false)}
                      aria-label={t("auctions:bid.proxy.cancel")}
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
        ) : (
          <p className="text-cz-3 text-xs text-center py-1">{isSeller ? t("auctions:bid.sellerLabel") : "—"}</p>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AuctionsPage() {
  const { t } = useTranslation(["auctions", "common"]);
  const auctionsTourSteps = useMemo(() => getAuctionsTourSteps(t), [t]);
  // #1162: hoisted hertil (fra AuctionsContent) så rider-listen kan dekoreres med
  // estimat-midtpunkter (_scoutMid) til klient-side potentiale-sortering.
  const scouting = useScouting();
  const [auctions, setAuctions] = useState([]);
  const [myTeamId, setMyTeamId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [watchlist, setWatchlist] = useState(() => new Set());
  const [myBalance, setMyBalance] = useState(0);
  const [currentRiderCount, setCurrentRiderCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("my-situation");
  // Ønskeliste-filter — toggle der viser kun auktioner på ryttere i manager's wishlist.
  // Kombineres oven på den aktive filter-tab (my-situation/all/other).
  const [wishlistOnly, setWishlistOnly] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("cz-auctions-wishlist-only") === "1",
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("cz-auctions-wishlist-only", wishlistOnly ? "1" : "0");
    } catch {
      // localStorage kan være disabled (privacy mode); accepter tab af persistens
    }
  }, [wishlistOnly]);
  // "Live bud"-feed kan slås fra (#1510406001751363584) — default synligt, husket i localStorage.
  const [showFeed, setShowFeed] = useState(
    () => typeof window === "undefined" || localStorage.getItem("cz-auctions-show-feed") !== "0",
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("cz-auctions-show-feed", showFeed ? "1" : "0");
    } catch {
      // localStorage kan være disabled (privacy mode); accepter tab af persistens
    }
  }, [showFeed]);
  const [celebration, setCelebration] = useState(null);
  // Stats toggle (persisted i localStorage) — default tomt, manageren vælger selv
  const { visibleStats, toggleStat, showAll, hideAll } = useStatsToggle();
  // Bekræftelses-dialog for bud (auktionsbud, autobud-loft) — { mode, riderName, amount, onConfirm } | null
  const [bidConfirm, setBidConfirm] = useState(null);
  const [bidConfirmBusy, setBidConfirmBusy] = useState(false);
  // #194 race-confirm: { auctionId, newPrice, newMinBid } når server returnerer 409 price_changed
  const [raceConfirm, setRaceConfirm] = useState(null);
  const [auctionSort, setAuctionSort] = useState({ key: null, dir: "desc" });
  const [showFirstBidHint, setShowFirstBidHint] = useState(false);
  const [firstBidDismissed, setFirstBidDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("cz-first-bid-shown") === "1",
  );
  // #196: realtime UX — recentBidEvents driver både ticker og sidebar-feed,
  // flashingAuctionIds driver pulse-animation, toasts vises ved overbud.
  const [recentBidEvents, setRecentBidEvents] = useState([]);
  const [flashingAuctionIds, setFlashingAuctionIds] = useState(() => new Set());
  const [toasts, setToasts] = useState([]);
  const [now, setNow] = useState(() => Date.now());

  // Refs så channel-callback kan se nyeste auctions/myTeamId uden at re-subscribe.
  // tRef tilføjet i Fase 3b så i18n-strings inde i channel-callback opdateres
  // uden at tear-down + recreate supabase-subscription ved language-skift.
  const auctionsRef = useRef([]);
  const myTeamIdRef = useRef(null);
  const tRef = useRef(t);
  // Cache af holdnavn pr. team-id. Realtime-payloaden for auctions-UPDATE indeholder
  // kun rå kolonner (current_bidder_id), ikke det joinede current_bidder-objekt, så
  // fører-NAVNET skal slås op herfra (eller hentes) når en ny byder overtager føringen.
  const teamNameCacheRef = useRef(new Map());
  useEffect(() => { auctionsRef.current = auctions; }, [auctions]);
  useEffect(() => { myTeamIdRef.current = myTeamId; }, [myTeamId]);
  useEffect(() => { tRef.current = t; }, [t]);

  useEffect(() => { logEvent("auction_view"); }, []);

  // 1s tick: opdater "now" så ticker+sidebar relative-tid bevæger sig,
  // og prune events ældre end feed-vinduet ud af bufferen.
  useEffect(() => {
    const interval = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setRecentBidEvents(prev => pruneStaleBidEvents(prev, t, BID_FEED_WINDOW_MS));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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

  function flashAuctionPrice(auctionId) {
    setFlashingAuctionIds(prev => {
      const next = new Set(prev);
      next.add(auctionId);
      return next;
    });
    setTimeout(() => {
      setFlashingAuctionIds(prev => {
        const next = new Set(prev);
        next.delete(auctionId);
        return next;
      });
    }, 1500);
  }

  function handleSort(key) {
    if (key === "current_price" || key === "calculated_end") {
      setAuctionSort(s => ({ key, dir: s.key === key ? (s.dir === "desc" ? "asc" : "desc") : "desc" }));
    } else {
      const cur = riderFilters.filters.sort;
      const dir = riderFilters.filters.sort_dir;
      if (cur === key) riderFilters.onChange("sort_dir", dir === "desc" ? "asc" : "desc");
      else { riderFilters.onChange("sort", key); riderFilters.onChange("sort_dir", "desc"); }
      setAuctionSort({ key: null, dir: "desc" });
    }
  }

  function activeSort(key) {
    if (key === "current_price" || key === "calculated_end") return auctionSort.key === key;
    return !auctionSort.key && riderFilters.filters.sort === key;
  }
  function activeSortDir(key) {
    if (key === "current_price" || key === "calculated_end") return auctionSort.dir;
    return riderFilters.filters.sort_dir;
  }

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) setUserId(user.id);
    const { data: team } = await supabase.from("teams").select("id, balance, division").eq("user_id", user.id).single();
    if (team) { setMyTeamId(team.id); setMyBalance(team.balance); }
    // Load watchlist for clickable star på rytter-celle
    if (user?.id) {
      const { data: wl } = await supabase.from("rider_watchlist").select("rider_id").eq("user_id", user.id);
      if (wl) setWatchlist(new Set(wl.map(w => w.rider_id)));
    }

    const [auctionsRes, myBidsRes, riderCountRes, myProxiesRes] = await Promise.all([
      supabase.from("auctions")
        .select(`id, current_price, min_increment, calculated_end, status, is_guaranteed_sale, is_flash,
          seller_team_id, current_bidder_id,
          rider:rider_id(id, firstname, lastname, market_value, is_u25, team_id, birthdate, nationality_code,
            prize_earnings_bonus, salary, contract_length, contract_end_season, ${STATS.join(", ")}),
          seller:seller_team_id(id, name),
          current_bidder:current_bidder_id(id, name)`)
        .in("status", ["active", "extended"])
        .order("calculated_end", { ascending: true }),
      team ? supabase.from("auction_bids").select("auction_id, amount").eq("team_id", team.id)
           : Promise.resolve({ data: [] }),
      // #1308: akademiryttere tæller ikke mod senior-cap
      team ? supabase.from("riders").select("id", { count: "exact", head: true }).eq("team_id", team.id).eq("is_academy", false)
           : Promise.resolve({ count: 0 }),
      team ? supabase.from("auction_proxy_bids").select("auction_id, max_amount").eq("team_id", team.id)
           : Promise.resolve({ data: [] }),
    ]);

    if (riderCountRes.count !== null) setCurrentRiderCount(riderCountRes.count);

    if (auctionsRes.data) {
      const myBidMap = {};
      (myBidsRes.data || []).forEach(b => {
        if (!myBidMap[b.auction_id] || b.amount > myBidMap[b.auction_id]) {
          myBidMap[b.auction_id] = b.amount;
        }
      });
      const myProxyMap = {};
      (myProxiesRes.data || []).forEach(p => { myProxyMap[p.auction_id] = p.max_amount; });
      // Seed holdnavn-cachen så live fører-opdatering kan slå navne op uden ekstra fetch.
      auctionsRes.data.forEach(a => {
        if (a.seller?.id) teamNameCacheRef.current.set(a.seller.id, a.seller.name);
        if (a.current_bidder?.id) teamNameCacheRef.current.set(a.current_bidder.id, a.current_bidder.name);
      });
      setAuctions(auctionsRes.data.map(a => ({
        ...a,
        myHighestBid: myBidMap[a.id] || null,
        myProxyMax: myProxyMap[a.id] || null,
      })));

      // Backfill: fyld feed-bufferen med de seneste bud på de auktioner manageren
      // deltager i, så "Live bud"-panelet ikke er tomt ved frisk load (#1510406001751363584).
      const participatingIds = [...new Set([...Object.keys(myBidMap), ...Object.keys(myProxyMap)])];
      if (participatingIds.length) {
        const cutoff = new Date(Date.now() - BID_FEED_WINDOW_MS).toISOString();
        const { data: recentBids } = await supabase
          .from("auction_bids")
          .select("id, auction_id, team_id, amount, bid_time")
          .in("auction_id", participatingIds)
          .gte("bid_time", cutoff)
          .order("bid_time", { ascending: true })
          .limit(60);
        if (recentBids?.length) {
          setRecentBidEvents(prev => {
            const seen = new Set(prev.map(e => e.id));
            const backfilled = recentBids
              .filter(b => !seen.has(b.id))
              .map(b => ({
                id: b.id,
                auction_id: b.auction_id,
                team_id: b.team_id,
                amount: b.amount,
                ts: new Date(b.bid_time).getTime(),
              }));
            return pruneStaleBidEvents([...backfilled, ...prev], Date.now(), BID_FEED_WINDOW_MS);
          });
        }
      }
    }
    setLoading(false);
  }

  // Onboarding v2 Slice 1b — vis first-bid hint indtil manager har afgivet et bud (eller dismissed)
  useEffect(() => {
    if (firstBidDismissed) return;
    async function checkFirstBid() {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      try {
        const res = await fetch(`${API}/api/me/onboarding-progress`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const prog = await res.json();
        const firstBid = prog.steps?.find(s => s.key === "first_bid_placed");
        if (firstBid && !firstBid.done) setShowFirstBidHint(true);
      } catch {
        // best-effort — banneret skjult ved fejl
      }
    }
    checkFirstBid();
  }, [firstBidDismissed]);

  function dismissFirstBidHint() {
    localStorage.setItem("cz-first-bid-shown", "1");
    setFirstBidDismissed(true);
    setShowFirstBidHint(false);
  }

  function handleStartFirstBidTour() {
    startTour("auctions");
    dismissFirstBidHint();
  }

  useEffect(() => {
    loadAll();
    const channel = supabase.channel("auctions-live")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auctions" },
        payload => {
          const updated = payload.new;
          // #196: pulse + overbid-toast bygger på SAMME prev som auctions-listen,
          // men læses fra ref så closuren ikke ser stale state efter re-render.
          const prevFromRef = auctionsRef.current.find(a => a.id === updated.id);
          const myTeam = myTeamIdRef.current;
          if (prevFromRef) {
            if (shouldFlashPrice(prevFromRef, updated)) {
              flashAuctionPrice(updated.id);
            }
            if (isOverbidEvent(prevFromRef, updated, myTeam)) {
              const r = prevFromRef.rider;
              pushOverbidToast({
                riderName: r ? `${r.firstname} ${r.lastname}` : tRef.current("auctions:fallback.rider"),
                amount: updated.current_price,
              });
            }
          }
          setAuctions(prev => {
            const prevAuction = prev.find(a => a.id === updated.id);
            if (updated.status === "completed" && prevAuction?.status !== "completed") {
              setMyTeamId(tid => {
                if (getAuctionLeaderId({ ...prevAuction, ...updated }) === tid) {
                  setCelebration({
                    title: tRef.current("auctions:celebration.title"),
                    subtitle: tRef.current("auctions:celebration.subtitle"),
                    amount: updated.current_price,
                  });
                }
                return tid;
              });
              return prev.filter(a => a.id !== updated.id);
            }
            return prev.map(a => {
              if (a.id !== updated.id) return a;
              const merged = { ...a, ...updated };
              // Realtime-payloaden mangler det joinede current_bidder-objekt, så fører-
              // navnet ville ellers forblive stale. Genopbyg det fra raw current_bidder_id.
              if (updated.current_bidder_id == null) {
                merged.current_bidder = null;
              } else if (a.current_bidder?.id !== updated.current_bidder_id) {
                merged.current_bidder = {
                  id: updated.current_bidder_id,
                  name: teamNameCacheRef.current.get(updated.current_bidder_id) || null,
                };
              }
              return merged;
            });
          });
          // Ny fører hvis navn ikke er cachet → hent det og flet ind, så føringen
          // opdateres live uden manuel reload (#1511441112815108157).
          const newBidderId = updated.current_bidder_id;
          if (newBidderId && !teamNameCacheRef.current.has(newBidderId)) {
            supabase.from("teams").select("id, name").eq("id", newBidderId).single()
              .then(({ data }) => {
                if (!data) return;
                teamNameCacheRef.current.set(data.id, data.name);
                setAuctions(prev => prev.map(a =>
                  a.id === updated.id && a.current_bidder_id === data.id
                    ? { ...a, current_bidder: { id: data.id, name: data.name } }
                    : a));
              });
          }
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "auction_bids" },
        payload => {
          // #196: nye bud feeder både aggregat-tickeren og sidebar-feeden.
          // Buffer prunes til 30s rolling vindue.
          const bid = payload.new;
          const t = Date.now();
          setRecentBidEvents(prev => pruneStaleBidEvents([
            ...prev,
            {
              id: bid.id,
              auction_id: bid.auction_id,
              team_id: bid.team_id,
              amount: bid.amount,
              ts: t,
            },
          ], t, BID_FEED_WINDOW_MS));
        })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function handleBid(auctionId, amount, { skipExpectedPrice = false } = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const API = import.meta.env.VITE_API_URL;
    const auction = auctions.find(a => a.id === auctionId);
    const body = { amount };
    if (!skipExpectedPrice && auction) {
      // #194 race-guard: send sidste pris vi så, så server kan returnere 409 hvis stale
      body.expected_current_price = auction.current_price;
    }
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
        loadAll();
        return { ok: false, race: true };
      }
    }
    if (res.ok) {
      fetch(`${API}/api/achievements/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ context: "auction_bid", data: { amount } }),
      }).catch(() => {});
      loadAll();
      let okData = {};
      try { okData = await res.json(); } catch { /* tolerér tom body */ }
      return { ok: true, warnings: okData.warnings || [] };
    }
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error response — fall back to default error message below */ }
    return { ok: false, error: resolveApiError(data, t, t("auctions:error.bidFailed")) };
  }

  async function handleConfirmRaceBid() {
    if (!raceConfirm) return;
    const { auctionId, newMinBid } = raceConfirm;
    setRaceConfirm(null);
    await handleBid(auctionId, newMinBid, { skipExpectedPrice: true });
  }

  async function handleSetProxy(auctionId, maxAmount) {
    const { data: { session } } = await supabase.auth.getSession();
    const API = import.meta.env.VITE_API_URL;
    const res = await fetch(`${API}/api/auctions/${auctionId}/proxy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ max_amount: maxAmount }),
    });
    if (res.ok) { loadAll(); return { ok: true }; }
    let data = {};
    try { data = await res.json(); } catch { /* ignore */ }
    return { ok: false, error: resolveApiError(data, t, t("auctions:error.proxyFailed")) };
  }

  async function handleRemoveProxy(auctionId) {
    const { data: { session } } = await supabase.auth.getSession();
    const API = import.meta.env.VITE_API_URL;
    await fetch(`${API}/api/auctions/${auctionId}/proxy`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    loadAll();
  }

  async function toggleWatchlist(riderId) {
    if (!userId) return;
    const inList = watchlist.has(riderId);
    // Optimistic update — UI flipper med det samme
    setWatchlist(prev => {
      const next = new Set(prev);
      if (inList) next.delete(riderId); else next.add(riderId);
      return next;
    });
    if (inList) {
      await supabase.from("rider_watchlist").delete().eq("user_id", userId).eq("rider_id", riderId);
    } else {
      await supabase.from("rider_watchlist").insert({ user_id: userId, rider_id: riderId });
    }
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

  const riderFilters = useClientRiderFilters(
    auctions.map(a => a.rider).filter(Boolean)
      .map(r => ({ ...r, _scoutMid: scoutSortValue(scouting.estimateFor(r.id)) }))
  );
  const filteredRiderOrder = new Map(riderFilters.filtered.map((r, i) => [r.id, i]));

  const winningAuctions  = auctions.filter(a => getAuctionLeaderId(a) === myTeamId);
  // #44: worst-case reservation — delt klient-spejl af backendens commitment-
  // formel (auctionLogic.js / auctionRules.js). availableBalance vises i headeren;
  // selve bid-gaten beregner pr.-auktion-available i useAuctionBidding (#1184).
  const reservedBalance = computeWorstCaseReservation(auctions, myTeamId);
  const availableBalance = Math.max(0, myBalance - reservedBalance);
  const incomingCount    = winningAuctions.filter(a => a.rider?.team_id !== myTeamId).length;
  const outgoingCount    = auctions.filter(a => {
    if (a.rider?.team_id !== myTeamId) return false;
    const leaderId = getAuctionLeaderId(a);
    return leaderId !== null && leaderId !== myTeamId;
  }).length;
  const projectedRiderCount = currentRiderCount !== null ? currentRiderCount + incomingCount - outgoingCount : null;

  // Min situation-buckets — ekskluder overlap (sælger med ingen bud kommer kun i "Sælger", ikke "Leder")
  const mySellingAuctions = auctions.filter(a => isManagerSeller(a, myTeamId));
  const myLeadingAuctions = auctions.filter(a =>
    getAuctionLeaderId(a) === myTeamId && !isManagerSeller(a, myTeamId)
  );
  const myOverbidAuctions = auctions.filter(a => {
    if (isManagerSeller(a, myTeamId)) return false;
    const leaderId = getAuctionLeaderId(a);
    return a.myHighestBid && leaderId !== null && leaderId !== myTeamId;
  });
  const mySituationIds = new Set([
    ...myLeadingAuctions.map(a => a.id),
    ...myOverbidAuctions.map(a => a.id),
    ...mySellingAuctions.map(a => a.id),
  ]);
  const mySituationCount = mySituationIds.size;
  const otherManagerCount = auctions.filter(a => a.rider?.team_id && a.rider.team_id !== myTeamId).length;

  function passesAuctionPriceFilter(a) {
    const price = a.current_price || 0;
    const minP = parseInt(riderFilters.filters.min_auction_price);
    const maxP = parseInt(riderFilters.filters.max_auction_price);
    if (!isNaN(minP) && price < minP) return false;
    if (!isNaN(maxP) && price > maxP) return false;
    return true;
  }

  function passesWishlistFilter(a) {
    if (!wishlistOnly) return true;
    return Boolean(a.rider?.id && watchlist.has(a.rider.id));
  }

  const filtered = auctions
    .filter(a => {
      if (a.rider && !filteredRiderOrder.has(a.rider.id)) return false;
      if (!passesAuctionPriceFilter(a)) return false;
      if (!passesWishlistFilter(a)) return false;
      if (filter === "my-situation") return mySituationIds.has(a.id);
      if (filter === "other")        return a.rider?.team_id && a.rider.team_id !== myTeamId;
      return true;
    })
    .sort((a, b) => {
      const ai = a.rider ? (filteredRiderOrder.get(a.rider.id) ?? Infinity) : Infinity;
      const bi = b.rider ? (filteredRiderOrder.get(b.rider.id) ?? Infinity) : Infinity;
      return ai - bi;
    });

  const FILTER_TABS = [
    { key: "my-situation", label: t("auctions:filter.mySituation", { count: mySituationCount }) },
    { key: "all",          label: t("auctions:filter.all", { count: auctions.length }) },
    { key: "other",        label: t("auctions:filter.otherManagers", { count: otherManagerCount }) },
  ];

  // #196: feed-events filtreres til auktioner manageren deltager i, og
  // auctionsById giver sidebar adgang til rytter-navn pr. event.
  const myParticipatingAuctionIds = getMyParticipatingAuctionIds(auctions);
  const feedEvents = filterBidEventsForFeed(recentBidEvents, myParticipatingAuctionIds);
  const auctionsById = auctions.reduce((acc, a) => { acc[a.id] = a; return acc; }, {});
  const tickerCount = recentBidEvents.length;

  return (
    <div className="max-w-full">
      <OnboardingTour pageKey="auctions" steps={auctionsTourSteps} />
      <ConfettiModal
        show={!!celebration}
        onClose={() => setCelebration(null)}
        title={celebration?.title || ""}
        subtitle={celebration?.subtitle}
        amount={celebration?.amount}
        icon="🏆"
      />
      <RacePriceModal
        show={!!raceConfirm}
        newPrice={raceConfirm?.newPrice ?? 0}
        newMinBid={raceConfirm?.newMinBid ?? 0}
        onCancel={() => setRaceConfirm(null)}
        onConfirm={handleConfirmRaceBid}
      />

      <BidConfirmModal
        show={!!bidConfirm}
        mode={bidConfirm?.mode}
        riderName={bidConfirm?.riderName}
        amount={bidConfirm?.amount}
        busy={bidConfirmBusy}
        onCancel={() => { if (!bidConfirmBusy) setBidConfirm(null); }}
        onConfirm={handleBidConfirm}
      />

      <OverbidToast toasts={toasts} onDismiss={dismissToast} />

      <div className="mb-5">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h1 className="text-xl font-bold text-cz-1">{t("auctions:page.title")}</h1>
          {/* #196: aggregat-ticker — 30s rolling vindue, opdateres live via channel + 1s tick */}
          <span
            data-testid="auctions-ticker"
            className="text-cz-3 text-[11px] font-mono tabular-nums whitespace-nowrap"
            aria-live="polite"
          >
            {t("auctions:ticker.bidCount", { count: tickerCount })}
          </span>
        </div>
        <div className="flex gap-2">
          <NavLink to="/auctions" end
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                isActive
                  ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                  : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {t("auctions:nav.active", { count: auctions.length })}
          </NavLink>
          <NavLink to="/auctions/history"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                isActive
                  ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                  : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {t("auctions:nav.history")}
          </NavLink>
        </div>
      </div>

      {!loading && myTeamId && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5 max-w-[1600px]">
          <div className="bg-cz-card border border-cz-border rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-cz-3 mb-0.5">{t("auctions:stats.balance")}</p>
            <p className="text-cz-accent-t font-mono font-bold text-sm leading-tight">
              {formatNumber(myBalance)} CZ$
            </p>
            {reservedBalance > 0 && (
              <p className="text-cz-3 text-[10px] mt-0.5">
                {t("auctions:stats.balanceAvailable", { amount: formatNumber(availableBalance) })}
              </p>
            )}
          </div>
          <div className="bg-cz-card border border-cz-border rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-cz-3 mb-0.5">{t("auctions:stats.reserved")}</p>
            <p className="text-cz-1 font-mono font-bold text-sm leading-tight">
              {formatNumber(reservedBalance)} CZ$
            </p>
            {winningAuctions.length > 0 && (
              <p className="text-cz-3 text-[10px] mt-0.5">{t("auctions:stats.auctionsLeading", { count: winningAuctions.length })}</p>
            )}
          </div>
          <div className="bg-cz-card border border-cz-border rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-cz-3 mb-0.5">{t("auctions:stats.ridersNow")}</p>
            <p className="text-cz-1 font-mono font-bold text-sm leading-tight">
              {currentRiderCount ?? "—"}
            </p>
          </div>
          <div className="bg-cz-card border border-cz-border rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-cz-3 mb-0.5">{t("auctions:stats.projection")}</p>
            <p className="text-cz-1 font-mono font-bold text-sm leading-tight">
              {projectedRiderCount ?? "—"}
              {projectedRiderCount !== null && projectedRiderCount !== currentRiderCount && (
                <span className={`text-xs ms-1.5 font-medium ${projectedRiderCount > currentRiderCount ? "text-cz-success" : "text-cz-danger"}`}>
                  {projectedRiderCount > currentRiderCount ? "+" : ""}{projectedRiderCount - currentRiderCount}
                </span>
              )}
            </p>
            {(incomingCount > 0 || outgoingCount > 0) && (
              <p className="text-cz-3 text-[10px] mt-0.5">
                {incomingCount > 0 && t("auctions:stats.incoming", { count: incomingCount })}
                {incomingCount > 0 && outgoingCount > 0 && " · "}
                {outgoingCount > 0 && t("auctions:stats.outgoing", { count: outgoingCount })}
              </p>
            )}
          </div>
        </div>
      )}

      {showFirstBidHint && (
        <AuctionsFirstBidHint
          onDismiss={dismissFirstBidHint}
          onStartTour={handleStartFirstBidTour}
        />
      )}

      {/* Filter tabs + Wishlist-toggle + StatsToggle */}
      <div className="flex gap-2 mb-4 flex-wrap items-center justify-between">
        <div className="flex gap-2 flex-wrap items-center">
          {FILTER_TABS.map(tab => (
            <button key={tab.key} onClick={() => setFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                ${filter === tab.key
                  ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                  : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
              {tab.label}
            </button>
          ))}
          <button
            onClick={() => setWishlistOnly(v => !v)}
            aria-pressed={wishlistOnly}
            title={wishlistOnly ? t("auctions:filter.wishlistTitleOn") : t("auctions:filter.wishlistTitleOff")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${wishlistOnly
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            <span className={wishlistOnly ? "text-cz-accent-t" : "text-cz-3"}>{wishlistOnly ? "★" : "☆"}</span>
            {t("auctions:filter.wishlistButton")}
          </button>
          <button
            onClick={() => setShowFeed(v => !v)}
            aria-pressed={showFeed}
            title={showFeed ? t("auctions:filter.feedTitleOn") : t("auctions:filter.feedTitleOff")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${showFeed
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            <span className={showFeed ? "text-cz-accent-t" : "text-cz-3"}>📡</span>
            {t("auctions:filter.feedButton")}
          </button>
        </div>
        <StatsToggle
          visibleStats={visibleStats}
          onToggleStat={toggleStat}
          onShowAll={showAll}
          onHideAll={hideAll}
        />
      </div>

      <div className="max-w-[1600px]">
        <RiderFilters
          filters={riderFilters.filters}
          onChange={riderFilters.onChange}
          onReset={riderFilters.onReset}
          showTeamFilter={false}
          nationalities={riderFilters.nationalities}
          showAuctionPriceFilter={true}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16" role="status" aria-label={t("auctions:page.loadingAria")}>
          <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
        </div>
      ) : (
        <AuctionsContent
          filter={filter}
          filtered={filtered}
          scouting={scouting}
          wishlistOnly={wishlistOnly}
          mySituationBuckets={{
            leading: myLeadingAuctions.filter(a => (!a.rider || filteredRiderOrder.has(a.rider.id)) && passesAuctionPriceFilter(a) && passesWishlistFilter(a)),
            overbid: myOverbidAuctions.filter(a => (!a.rider || filteredRiderOrder.has(a.rider.id)) && passesAuctionPriceFilter(a) && passesWishlistFilter(a)),
            selling: mySellingAuctions.filter(a => (!a.rider || filteredRiderOrder.has(a.rider.id)) && passesAuctionPriceFilter(a) && passesWishlistFilter(a)),
          }}
          myTeamId={myTeamId}
          myBalance={myBalance}
          reservedBalance={reservedBalance}
          watchlist={watchlist}
          toggleWatchlist={toggleWatchlist}
          handleBid={handleBid}
          handleSetProxy={handleSetProxy}
          handleRemoveProxy={handleRemoveProxy}
          requestBidConfirm={requestBidConfirm}
          flashingAuctionIds={flashingAuctionIds}
          visibleStats={visibleStats}
          auctionSort={auctionSort}
          activeSort={activeSort}
          activeSortDir={activeSortDir}
          handleSort={handleSort}
          riderFiltersSort={riderFilters.filters.sort}
          feedEvents={feedEvents}
          auctionsById={auctionsById}
          now={now}
          showFeed={showFeed}
        />
      )}
    </div>
  );
}

function applyAuctionSort(list, auctionSort) {
  if (!auctionSort.key) return list;
  return [...list].sort((a, b) => {
    const av = auctionSort.key === "calculated_end"
      ? new Date(a.calculated_end).getTime()
      : (a.current_price || 0);
    const bv = auctionSort.key === "calculated_end"
      ? new Date(b.calculated_end).getTime()
      : (b.current_price || 0);
    return auctionSort.dir === "desc" ? bv - av : av - bv;
  });
}

function AuctionTableHead({ visibleStats, activeSort, activeSortDir, handleSort, riderFiltersSort, auctionSort }) {
  const { t } = useTranslation("auctions");
  const visibleStatsArr = STATS.filter(k => visibleStats?.has(k));
  return (
    <thead className="sticky top-0 z-20 bg-cz-card shadow-sm">
      <tr className="border-b border-cz-border">
        <SortTh sortKey="firstname" sort={activeSort("firstname") ? "firstname" : riderFiltersSort}
          sortDir={activeSortDir("firstname")} onSort={handleSort}
          className="px-3 py-3 text-left font-medium uppercase tracking-wider sticky left-0 z-30 bg-cz-card border-r border-cz-border">{t("table.rider")}</SortTh>
        <SortTh sortKey="current_price"
          sort={auctionSort.key} sortDir={auctionSort.dir} onSort={handleSort}
          className="px-3 py-3 text-right font-medium uppercase tracking-wider whitespace-nowrap">
          {t("table.highestBid")}
        </SortTh>
        <SortTh sortKey="calculated_end"
          sort={auctionSort.key} sortDir={auctionSort.dir} onSort={handleSort}
          className="px-3 py-3 text-center font-medium uppercase tracking-wider whitespace-nowrap">
          {t("table.timeLeft")}
        </SortTh>
        <th className="px-2 py-3 text-center text-cz-3 font-medium hidden xl:table-cell">{t("table.age")}</th>
        <SortTh sortKey="salary" sort={activeSort("salary") ? "salary" : riderFiltersSort}
          sortDir={activeSortDir("salary")} onSort={handleSort}
          className="px-2 py-3 text-right font-medium">{t("table.salary")}</SortTh>
        <SortTh sortKey="_scoutMid"
          sort={activeSort("_scoutMid") ? "_scoutMid" : riderFiltersSort}
          sortDir={activeSortDir("_scoutMid")} onSort={handleSort}
          className="px-3 py-3 text-left font-medium uppercase tracking-wider whitespace-nowrap">{t("table.potential")}</SortTh>
        <th className="px-3 py-3 text-left text-cz-3 font-medium uppercase tracking-wider hidden xl:table-cell">{t("table.seller")}</th>
        {visibleStatsArr.map(key => (
          <SortTh key={key} sortKey={key}
            sort={activeSort(key) ? key : riderFiltersSort}
            sortDir={activeSortDir(key)} onSort={handleSort}
            className="px-1 py-3 text-center font-medium w-9">{STAT_LABEL_BY_KEY[key]}</SortTh>
        ))}
        <th className="auction-bid-cell px-3 py-3 text-left text-cz-3 font-medium uppercase tracking-wider sticky right-0 z-30 border-l border-cz-border shadow-[-10px_0_16px_-16px_rgba(0,0,0,0.5)]">{t("table.bid")}</th>
      </tr>
    </thead>
  );
}

function AuctionList({ auctions, sectionId, sharedProps }) {
  const sorted = applyAuctionSort(auctions, sharedProps.auctionSort);
  return (
    <>
      <div className="md:hidden flex flex-col gap-3">
        {sorted.map((a, i) => (
          <AuctionCard
            key={a.id}
            auction={a}
            myTeamId={sharedProps.myTeamId}
            myBalance={sharedProps.myBalance}
            reservedBalance={sharedProps.reservedBalance}
            watchlist={sharedProps.watchlist}
            onToggleWatchlist={sharedProps.toggleWatchlist}
            onBid={sharedProps.handleBid}
            onSetProxy={sharedProps.handleSetProxy}
            onRemoveProxy={sharedProps.handleRemoveProxy}
            requestBidConfirm={sharedProps.requestBidConfirm}
            isFirst={sectionId === "main" && i === 0}
            isFlashing={sharedProps.flashingAuctionIds.has(a.id)}
            visibleStats={sharedProps.visibleStats}
            scouting={sharedProps.scouting}
          />
        ))}
      </div>
      <div className="hidden md:block bg-cz-card border border-cz-border rounded-xl overflow-hidden min-w-0">
        <div className="overflow-auto max-h-[calc(100vh-220px)]">
          <table className="w-full text-xs">
            <AuctionTableHead
              visibleStats={sharedProps.visibleStats}
              activeSort={sharedProps.activeSort}
              activeSortDir={sharedProps.activeSortDir}
              handleSort={sharedProps.handleSort}
              riderFiltersSort={sharedProps.riderFiltersSort}
              auctionSort={sharedProps.auctionSort}
            />
            <tbody>
              {sorted.map((a, i) => (
                <AuctionRow
                  key={a.id}
                  auction={a}
                  myTeamId={sharedProps.myTeamId}
                  myBalance={sharedProps.myBalance}
                  reservedBalance={sharedProps.reservedBalance}
                  watchlist={sharedProps.watchlist}
                  onToggleWatchlist={sharedProps.toggleWatchlist}
                  onBid={sharedProps.handleBid}
                  onSetProxy={sharedProps.handleSetProxy}
                  onRemoveProxy={sharedProps.handleRemoveProxy}
                  requestBidConfirm={sharedProps.requestBidConfirm}
                  isFirst={sectionId === "main" && i === 0}
                  isFlashing={sharedProps.flashingAuctionIds.has(a.id)}
                  visibleStats={sharedProps.visibleStats}
                  scouting={sharedProps.scouting}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function MySituationSection({ title, badgeClass, auctions, sectionId, sharedProps }) {
  if (auctions.length === 0) return null;
  return (
    <section className="mb-5">
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className={`text-sm font-bold ${badgeClass}`}>{title}</h2>
        <span className="text-cz-3 text-xs font-mono">({auctions.length})</span>
      </div>
      <AuctionList auctions={auctions} sectionId={sectionId} sharedProps={sharedProps} />
    </section>
  );
}

function AuctionsContent(props) {
  const { t } = useTranslation("auctions");
  const {
    filter, filtered, wishlistOnly, mySituationBuckets,
    feedEvents, auctionsById, myTeamId, now, showFeed,
    ...rest
  } = props;
  const sharedProps = { myTeamId, ...rest };
  const mySituationVisibleCount = mySituationBuckets.leading.length + mySituationBuckets.overbid.length + mySituationBuckets.selling.length;

  const isEmpty = filter === "my-situation"
    ? mySituationVisibleCount === 0
    : filtered.length === 0;

  return (
    <div className={showFeed ? "md:grid md:grid-cols-[minmax(0,1fr)_280px] md:gap-4" : ""}>
      <div className="min-w-0">
        {isEmpty ? (
          <div className="text-center py-16 text-cz-3">
            <p className="text-4xl mb-3">{wishlistOnly ? "★" : "⚡"}</p>
            <p>
              {wishlistOnly
                ? t("empty.wishlistNoResults")
                : (filter === "my-situation" ? t("empty.noInvolvementMySituation") : t("empty.noResults"))}
            </p>
            <p className="text-sm mt-2">
              {wishlistOnly
                ? t("empty.wishlistHelp")
                : (filter === "my-situation" ? t("empty.browseSuggestion") : t("empty.startAuctionSuggestion"))}
            </p>
          </div>
        ) : filter === "my-situation" ? (
          <>
            <MySituationSection
              title={t("section.leading")}
              badgeClass="text-cz-success"
              auctions={mySituationBuckets.leading}
              sectionId="leading"
              sharedProps={sharedProps}
            />
            <MySituationSection
              title={t("section.overbid")}
              badgeClass="text-cz-danger"
              auctions={mySituationBuckets.overbid}
              sectionId="overbid"
              sharedProps={sharedProps}
            />
            <MySituationSection
              title={t("section.selling")}
              badgeClass="text-cz-info"
              auctions={mySituationBuckets.selling}
              sectionId="selling"
              sharedProps={sharedProps}
            />
          </>
        ) : (
          <AuctionList auctions={filtered} sectionId="main" sharedProps={sharedProps} />
        )}
      </div>
      {showFeed && (
        <div>
          <AuctionsSidebarFeed
            events={feedEvents}
            auctionsById={auctionsById}
            myTeamId={myTeamId}
            now={now}
          />
        </div>
      )}
    </div>
  );
}
