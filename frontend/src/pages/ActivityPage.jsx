import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import RiderLink from "../components/RiderLink";
import { getRiderMarketValue } from "../lib/marketValues";
import WatchlistStar from "../components/WatchlistStar";
import { formatNumber, formatDate, formatRelativeTime } from "../lib/intl";
import {
  CheckIcon,
  LightningIcon,
  ExchangeIcon,
  StarIcon,
  InboxIcon,
  UndoIcon,
  ChevronRightIcon,
  PageLoader,
} from "../components/ui";

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

function getAuctionLeaderName(auction) {
  if (auction?.current_bidder?.name) return auction.current_bidder.name;
  if (auction?.winner?.name) return auction.winner.name;
  if (getAuctionLeaderId(auction) === auction?.seller_team_id) return auction?.seller?.name;
  return null;
}

function Countdown({ end, status }) {
  const { t } = useTranslation("activity");
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);
  useEffect(() => {
    function update() {
      const diff = new Date(end) - new Date();
      if (diff <= 0) { setText(t("countdown.ended")); return; }
      setUrgent(diff < 600000);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (h > 0) setText(`${h}t ${m}m`);
      else if (m > 0) setText(`${m}m ${s}s`);
      else setText(`${s}s`);
    }
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [end, t]);
  return (
    <span className={`font-mono text-xs font-bold tabular-nums whitespace-nowrap
      ${status === "extended" ? "text-cz-warning" : urgent ? "text-cz-danger" : "text-cz-2"}`}>
      {text}
    </span>
  );
}

// Status → badge styling. Labels resolved via t(labelKey) at render.
const OFFER_STATUS = {
  pending:               { labelKey: "offerStatus.pending",               cls: "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" },
  countered:             { labelKey: "offerStatus.countered",             cls: "bg-cz-warning-bg text-cz-warning border-cz-warning/30" },
  awaiting_confirmation: { labelKey: "offerStatus.awaiting_confirmation", cls: "bg-cz-info-bg text-cz-info border-cz-info/30" },
  window_pending:        { labelKey: "offerStatus.window_pending",        cls: "bg-cz-info-bg text-cz-info border-cz-info/30" },
  accepted:              { labelKey: "offerStatus.accepted",              cls: "bg-cz-success-bg text-cz-success border-cz-success/30" },
  rejected:              { labelKey: "offerStatus.rejected",              cls: "bg-cz-danger-bg text-cz-danger border-cz-danger/30" },
  withdrawn:             { labelKey: "offerStatus.withdrawn",             cls: "bg-cz-subtle text-cz-3 border-cz-border" },
};

function SectionHeader({ title, count }) {
  return (
    <div className="px-4 py-2.5 bg-cz-subtle border-b border-cz-border flex items-center gap-2">
      <p className="text-xs font-semibold text-cz-2 uppercase tracking-wider">{title}</p>
      {count > 0 && <span className="text-xs font-mono text-cz-3">{count}</span>}
    </div>
  );
}

function EmptyState({ icon, title, sub }) {
  return (
    <div className="text-center py-14">
      <div className="mb-3 flex justify-center text-cz-3">{icon}</div>
      <p className="text-cz-3 font-medium">{title}</p>
      {sub && <p className="text-sm mt-1 text-cz-3">{sub}</p>}
    </div>
  );
}

// Compact row used throughout all tabs
function Row({ badge, badgeCls, rider, riderId, detail, amount, time, children, onClick }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b border-cz-border last:border-0 hover:bg-cz-subtle transition-colors cursor-pointer"
      onClick={onClick}>
      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium uppercase whitespace-nowrap flex-shrink-0 ${badgeCls}`}>
        {badge}
      </span>
      <div className="flex-1 min-w-0">
        <RiderLink id={riderId} stopPropagation
          className="text-sm font-medium text-cz-1 hover:text-cz-accent-t transition-colors text-left truncate max-w-full block">
          {rider}
        </RiderLink>
        {detail && <p className="text-xs text-cz-3 truncate">{detail}</p>}
      </div>
      {children}
      {amount != null && (
        <span className="text-cz-accent-t font-mono text-sm font-bold whitespace-nowrap flex-shrink-0">
          {formatNumber(amount)} CZ$
        </span>
      )}
      {time && <span className="text-xs text-cz-3 whitespace-nowrap flex-shrink-0">{time}</span>}
      <ChevronRightIcon size={16} aria-hidden="true" className="text-cz-3 flex-shrink-0" />
    </div>
  );
}

export default function ActivityPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("activity");
  const { t: tCommon } = useTranslation("common");
  const [tab, setTab] = useState("action");
  const [myTeamId, setMyTeamId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoaded, setLastLoaded] = useState(null);

  const [activeAuctions, setActiveAuctions]     = useState([]);
  const [completedAuctions, setCompletedAuctions] = useState([]);
  const [sentOffers, setSentOffers]             = useState([]);
  const [receivedOffers, setReceivedOffers]     = useState([]);
  const [watchlist, setWatchlist]               = useState([]);

  async function loadAll({ silent = false } = {}) {
    if (silent) setRefreshing(true); else setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) { setLoading(false); setRefreshing(false); return; }
    const { data: team } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (!team) { setLoading(false); setRefreshing(false); return; }
    setMyTeamId(team.id);

    const { data: { session } } = await supabase.auth.getSession();
    const headers = { Authorization: `Bearer ${session.access_token}` };

    const [activeRes, completedRes, offersData, watchlistRes] = await Promise.all([
      supabase.from("auctions")
        .select(`id, current_price, calculated_end, status, is_guaranteed_sale, seller_team_id, current_bidder_id,
          rider:rider_id(id, firstname, lastname, market_value, team_id),
          seller:seller_team_id(name), current_bidder:current_bidder_id(name)`)
        .in("status", ["active", "extended"])
        .or(`seller_team_id.eq.${team.id},current_bidder_id.eq.${team.id}`)
        .order("calculated_end"),

      supabase.from("auctions")
        .select(`id, current_price, actual_end, status, is_guaranteed_sale, seller_team_id, current_bidder_id,
          rider:rider_id(id, firstname, lastname, market_value, team_id),
          seller:seller_team_id(name), winner:current_bidder_id(name)`)
        .eq("status", "completed")
        .or(`seller_team_id.eq.${team.id},current_bidder_id.eq.${team.id}`)
        .order("actual_end", { ascending: false })
        .limit(30),

      fetch(`${API}/api/transfers/my-offers`, { headers })
        .then(r => r.json())
        .catch(err => { console.warn("activity: my-offers load failed", err); return { sent: [], received: [] }; }),

      supabase.from("rider_watchlist")
        .select(`id, created_at, rider:rider_id(id, firstname, lastname, market_value, team:team_id(name))`)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
    ]);

    setActiveAuctions(activeRes.data || []);
    setCompletedAuctions(completedRes.data || []);
    setSentOffers(offersData.sent || []);
    setReceivedOffers(offersData.received || []);
    setWatchlist(watchlistRes.data || []);
    setLastLoaded(new Date());
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { loadAll(); }, []);

  async function removeFromWatchlist(riderId) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("rider_watchlist")
      .delete().eq("user_id", user.id).eq("rider_id", riderId);
    setWatchlist(prev => prev.filter(e => e.rider?.id !== riderId));
  }

  // "Needs action" — items that require the user's action
  const actionTransfers = [
    ...receivedOffers.filter(o => o.status === "pending"),
    ...sentOffers.filter(o => o.status === "countered"),
    ...receivedOffers.filter(o => o.status === "awaiting_confirmation" && !o.seller_confirmed),
    ...sentOffers.filter(o => o.status === "awaiting_confirmation" && !o.buyer_confirmed),
  ];
  const urgentAuctions = activeAuctions.filter(a => {
    const diff = new Date(a.calculated_end) - new Date();
    return diff > 0 && diff < 3600000;
  });
  const actionCount = actionTransfers.length;

  // Transfers tab — split active vs history
  const activeReceivedOffers = receivedOffers.filter(o => ["pending", "countered", "awaiting_confirmation"].includes(o.status));
  const activeSentOffers     = sentOffers.filter(o => ["pending", "countered", "awaiting_confirmation"].includes(o.status));
  const histReceivedOffers   = receivedOffers.filter(o => ["accepted", "rejected"].includes(o.status));
  const histSentOffers       = sentOffers.filter(o => ["accepted", "rejected"].includes(o.status));

  // Watchlist — mark riders currently in an auction (not mine)
  const auctionRiderIds = new Set(
    activeAuctions
      .filter(a => !isAuctionSeller(a, myTeamId))
      .map(a => a.rider?.id).filter(Boolean)
  );

  const TABS = [
    { key: "action",    label: t("tabs.action"),              count: actionCount },
    { key: "auctions",  label: tCommon("nav.item.auctions"),  count: activeAuctions.length },
    { key: "transfers", label: t("tabs.transfers"),           count: activeReceivedOffers.length + activeSentOffers.length },
    { key: "watchlist", label: tCommon("nav.item.watchlist"), count: watchlist.length },
    { key: "history",   label: t("tabs.history"),             count: 0 },
  ];

  if (loading) return (
    <PageLoader />
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("header.title")}</h1>
          <p className="text-cz-3 text-sm">{t("header.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {lastLoaded && (
            <span className="text-cz-3 text-xs hidden sm:inline">
              {t("lastUpdated", { time: formatDate(lastLoaded, null, { hour: "2-digit", minute: "2-digit" }) })}
            </span>
          )}
          <button onClick={() => loadAll({ silent: true })} disabled={refreshing}
            className="px-3 py-1.5 text-xs text-cz-2 hover:text-cz-1
              bg-cz-card hover:bg-cz-subtle rounded-lg border border-cz-border
              transition-all disabled:opacity-50 flex items-center gap-1.5"
            title={t("refreshTitle")}>
            <UndoIcon size={14} aria-hidden="true" className={refreshing ? "animate-spin" : undefined} />
            {refreshing ? t("refreshing") : t("refresh")}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 overflow-x-auto pb-px">
        {TABS.map(tabItem => (
          <button key={tabItem.key} onClick={() => setTab(tabItem.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all border flex-shrink-0
              ${tab === tabItem.key
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {tabItem.label}
            {tabItem.count > 0 && (
              <span className={`text-xs font-mono rounded-full px-1.5 min-w-[18px] text-center leading-5
                ${tab === tabItem.key
                  ? (tabItem.key === "action" ? "bg-cz-accent-t text-white" : "bg-cz-accent/20 text-cz-accent-t")
                  : "bg-cz-subtle text-cz-2"}`}>
                {tabItem.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── NEEDS ACTION ── */}
      {tab === "action" && (
        <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
          {actionCount === 0 && urgentAuctions.length === 0 ? (
            <EmptyState icon={<CheckIcon className="w-8 h-8" aria-hidden="true" />} title={t("empty.actionTitle")} sub={t("empty.actionSub")} />
          ) : (
            <>
              {actionTransfers.length > 0 && (
                <>
                  <SectionHeader title={t("section.offersNeedResponse")} count={actionTransfers.length} />
                  {actionTransfers.map(o => {
                    const isSent = sentOffers.some(s => s.id === o.id);
                    const cfg = OFFER_STATUS[o.status] || OFFER_STATUS.pending;
                    const counterpart = isSent ? o.seller?.name : o.buyer?.name;
                    return (
                      <Row key={o.id}
                        badge={t(cfg.labelKey)} badgeCls={cfg.cls}
                        rider={`${o.rider?.firstname} ${o.rider?.lastname}`}
                        riderId={o.rider?.id}
                        detail={isSent ? t("detail.to", { name: counterpart }) : t("detail.from", { name: counterpart })}
                        amount={o.counter_amount ?? o.offer_amount}
                        time={formatRelativeTime(o.updated_at)}
                        onClick={() => navigate("/transfers")} />
                    );
                  })}
                </>
              )}

              {urgentAuctions.length > 0 && (
                <>
                  <SectionHeader title={t("section.auctionsEndingSoon")} count={urgentAuctions.length} />
                  {urgentAuctions.map(a => {
                    const isSelling = isAuctionSeller(a, myTeamId);
                    const isWinning = getAuctionLeaderId(a) === myTeamId;
                    const leaderName = getAuctionLeaderName(a);
                    return (
                      <Row key={a.id}
                        badge={isSelling ? t("badge.seller") : isWinning ? t("badge.winner") : t("badge.bidder")}
                        badgeCls={isSelling ? "bg-cz-info-bg text-cz-info border-cz-info/30"
                          : isWinning ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                          : "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"}
                        rider={`${a.rider?.firstname} ${a.rider?.lastname}`}
                        riderId={a.rider?.id}
                        detail={isSelling
                          ? (a.current_bidder ? t("detail.highestBidder", { name: a.current_bidder.name }) : t("detail.noBidsYet"))
                          : leaderName
                            ? t("detail.leader", { name: leaderName })
                            : t("detail.noLeaderYet")}
                        amount={a.current_price}
                        time={null}
                        onClick={() => navigate("/auctions")}>
                        <Countdown end={a.calculated_end} status={a.status} />
                      </Row>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── AUCTIONS ── */}
      {tab === "auctions" && (
        <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
          {activeAuctions.length === 0 ? (
            <EmptyState icon={<LightningIcon className="w-8 h-8" aria-hidden="true" />} title={t("empty.auctionsTitle")} sub={t("empty.auctionsSub")} />
          ) : (
            <>
              <SectionHeader title={t("section.activeAuctions")} count={activeAuctions.length} />
              {activeAuctions.map(a => {
                const isSelling = isAuctionSeller(a, myTeamId);
                const isWinning = getAuctionLeaderId(a) === myTeamId;
                const leaderName = getAuctionLeaderName(a);
                return (
                  <Row key={a.id}
                    badge={isSelling ? t("badge.seller") : isWinning ? t("badge.winner") : t("badge.bidder")}
                    badgeCls={isSelling ? "bg-cz-info-bg text-cz-info border-cz-info/30"
                      : isWinning ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                      : "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"}
                    rider={`${a.rider?.firstname} ${a.rider?.lastname}`}
                    riderId={a.rider?.id}
                    detail={isSelling
                      ? (a.current_bidder ? t("detail.highestBidder", { name: a.current_bidder.name }) : t("detail.noBidsYet"))
                      : leaderName
                        ? t("detail.leader", { name: leaderName })
                        : t("detail.noLeaderYet")}
                    amount={a.current_price}
                    time={null}
                    onClick={() => navigate("/auctions")}>
                    <Countdown end={a.calculated_end} status={a.status} />
                  </Row>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ── TRANSFERS ── */}
      {tab === "transfers" && (
        <div className="space-y-4">
          {activeReceivedOffers.length + activeSentOffers.length === 0 && (
            <div className="bg-cz-card border border-cz-border rounded-cz">
              <EmptyState icon={<ExchangeIcon className="w-8 h-8" aria-hidden="true" />} title={t("empty.transfersTitle")} sub={t("empty.transfersSub")} />
            </div>
          )}

          {activeReceivedOffers.length > 0 && (
            <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
              <SectionHeader title={t("section.receivedOffers")} count={activeReceivedOffers.length} />
              {activeReceivedOffers.map(o => {
                const cfg = OFFER_STATUS[o.status] || OFFER_STATUS.pending;
                return (
                  <Row key={o.id}
                    badge={t(cfg.labelKey)} badgeCls={cfg.cls}
                    rider={`${o.rider?.firstname} ${o.rider?.lastname}`}
                    riderId={o.rider?.id}
                    detail={t("detail.from", { name: o.buyer?.name })}
                    amount={o.counter_amount ?? o.offer_amount}
                    time={formatRelativeTime(o.updated_at)}
                    onClick={() => navigate("/transfers")} />
                );
              })}
            </div>
          )}

          {activeSentOffers.length > 0 && (
            <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
              <SectionHeader title={t("section.sentOffers")} count={activeSentOffers.length} />
              {activeSentOffers.map(o => {
                const cfg = OFFER_STATUS[o.status] || OFFER_STATUS.pending;
                return (
                  <Row key={o.id}
                    badge={t(cfg.labelKey)} badgeCls={cfg.cls}
                    rider={`${o.rider?.firstname} ${o.rider?.lastname}`}
                    riderId={o.rider?.id}
                    detail={t("detail.to", { name: o.seller?.name })}
                    amount={o.counter_amount ?? o.offer_amount}
                    time={formatRelativeTime(o.updated_at)}
                    onClick={() => navigate("/transfers")} />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── WATCHLIST ── */}
      {tab === "watchlist" && (
        <div>
          <div className="flex justify-end mb-3">
            <button onClick={() => navigate("/watchlist")}
              className="text-sm text-cz-accent-t hover:text-cz-accent-t font-medium transition-colors">
              {t("watchlist.goToFull")}
            </button>
          </div>
          <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
            {watchlist.length === 0 ? (
              <EmptyState icon={<StarIcon className="w-8 h-8" aria-hidden="true" />} title={t("empty.watchlistTitle")}
                sub={t("empty.watchlistSub")} />
            ) : (
              watchlist.map(entry => {
                const r = entry.rider;
                const inAuction = auctionRiderIds.has(r?.id);
                return (
                  <div key={entry.id}
                    className="flex items-center gap-3 px-4 py-3 border-b border-cz-border last:border-0 hover:bg-cz-subtle transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <RiderLink id={r?.id}
                          className="text-sm font-medium text-cz-1 hover:text-cz-accent-t transition-colors text-left truncate">
                          {r?.firstname} {r?.lastname}
                        </RiderLink>
                        <WatchlistStar active onToggle={() => removeFromWatchlist(r?.id)} />
                      </div>
                      <p className="text-xs text-cz-3 truncate">{r?.team?.name || t("watchlist.freeAgent")}</p>
                    </div>
                    {inAuction && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium uppercase bg-cz-accent/10 text-cz-accent-t border-cz-accent/30 whitespace-nowrap flex-shrink-0">
                        {t("badge.inAuction")}
                      </span>
                    )}
                    <span className="text-cz-accent-t font-mono text-sm font-bold whitespace-nowrap flex-shrink-0">
                      {formatNumber(getRiderMarketValue(r))} CZ$
                    </span>
                    <RiderLink id={r?.id}
                      className="text-cz-3 hover:text-cz-accent-t text-sm transition-colors flex-shrink-0">
                      →
                    </RiderLink>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── HISTORY ── */}
      {tab === "history" && (
        <div className="space-y-4">
          {completedAuctions.length + histSentOffers.length + histReceivedOffers.length === 0 ? (
            <div className="bg-cz-card border border-cz-border rounded-cz">
              <EmptyState icon={<InboxIcon className="w-8 h-8" aria-hidden="true" />} title={t("empty.historyTitle")} sub={t("empty.historySub")} />
            </div>
          ) : (
            <>
              {completedAuctions.length > 0 && (
                <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
                  <SectionHeader title={t("section.auctions")} count={completedAuctions.length} />
                  {completedAuctions.map(a => {
                    const iWon  = getAuctionLeaderId(a) === myTeamId;
                    const iSold = isAuctionSeller(a, myTeamId);
                    const noSale = !a.current_bidder_id;
                    const badge = iWon ? t("badge.bought") : iSold && !noSale ? t("badge.sold") : iSold && noSale ? t("badge.noBids") : t("badge.lost");
                    const badgeCls = iWon
                      ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                      : iSold && !noSale ? "bg-cz-info-bg text-cz-info border-cz-info/30"
                      : "bg-cz-subtle text-cz-3 border-cz-border";
                    return (
                      <Row key={a.id}
                        badge={badge} badgeCls={badgeCls}
                        rider={`${a.rider?.firstname} ${a.rider?.lastname}`}
                        riderId={a.rider?.id}
                        detail={iWon ? t("detail.from", { name: a.seller?.name }) : iSold && !noSale ? t("detail.to", { name: a.winner?.name }) : ""}
                        amount={noSale ? null : a.current_price}
                        time={formatRelativeTime(a.actual_end)}
                        onClick={() => a.rider?.id && navigate(`/riders/${a.rider.id}`)} />
                    );
                  })}
                </div>
              )}

              {(histReceivedOffers.length + histSentOffers.length) > 0 && (
                <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
                  <SectionHeader title={t("section.transfers")} count={histReceivedOffers.length + histSentOffers.length} />
                  {[
                    ...histReceivedOffers.map(o => ({ ...o, _dir: "received" })),
                    ...histSentOffers.map(o => ({ ...o, _dir: "sent" })),
                  ]
                    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
                    .map(o => {
                      const cfg = OFFER_STATUS[o.status] || OFFER_STATUS.pending;
                      const isSent = o._dir === "sent";
                      return (
                        <Row key={`${o._dir}-${o.id}`}
                          badge={t(cfg.labelKey)} badgeCls={cfg.cls}
                          rider={`${o.rider?.firstname} ${o.rider?.lastname}`}
                          riderId={o.rider?.id}
                          detail={isSent ? t("detail.to", { name: o.seller?.name }) : t("detail.from", { name: o.buyer?.name })}
                          amount={o.offer_amount}
                          time={formatRelativeTime(o.updated_at)}
                          onClick={() => o.rider?.id && navigate(`/riders/${o.rider.id}`)} />
                      );
                    })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
