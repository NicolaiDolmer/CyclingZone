import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import { logEvent } from "../lib/logEvent";
import { groupNotifications } from "../lib/groupNotifications";
import { formatNumber, formatDate } from "../lib/intl";
import { renderBackendMessage } from "../lib/backendMessage";
import { useActionSummary } from "../hooks/useActionSummary";
import {
  Button, EmptyState, PageLoader,
  Tabs, TabList, Tab,
  LightningIcon, TrophyIcon, UndoIcon, AlertTriangleIcon, StarIcon,
  ExchangeIcon, CheckIcon, XIcon, FlagIcon, RocketIcon, CoinIcon,
  ClipboardIcon, PodiumIcon, BellIcon,
  ChevronRightIcon, ChevronDownIcon, InfoIcon,
} from "../components/ui";

// Role key for PENDING_ROLE — mapped to i18n via pending.role.<key>
const PENDING_ROLE_KEYS = {
  seller_decide: "sellerDecide",
  buyer_decide: "buyerDecide",
  seller_confirm: "sellerConfirm",
  buyer_confirm: "buyerConfirm",
  receiving_decide: "receivingDecide",
  proposing_decide: "proposingDecide",
  receiving_confirm: "receivingConfirm",
  proposing_confirm: "proposingConfirm",
};

const PENDING_KIND_ICON = {
  transfer_offer: ExchangeIcon,
  swap_offer: ExchangeIcon,
};

const TYPE_CONFIG = {
  bid_received:              { Icon: LightningIcon,    color: "text-cz-accent-t", bg: "bg-cz-accent/10 border-cz-accent/15",     link: "/auctions" },
  bid_placed:                { Icon: LightningIcon,    color: "text-cz-accent-t", bg: "bg-cz-accent/10 border-cz-accent/15",     link: "/auctions" },
  auction_won:               { Icon: TrophyIcon,       color: "text-cz-success",  bg: "bg-cz-success-bg0/8 border-cz-success/15", link: "/auctions" },
  auction_lost:              { Icon: UndoIcon,         color: "text-cz-2",        bg: "bg-cz-subtle border-cz-border",           link: "/auctions" },
  auction_outbid:            { Icon: AlertTriangleIcon, color: "text-cz-danger",   bg: "bg-cz-danger-bg0/8 border-cz-danger/15",    link: "/auctions" },
  watchlist_rider_auction:   { Icon: StarIcon,         color: "text-cz-accent-t", bg: "bg-cz-accent/10 border-cz-accent/15",     link: "/auctions" },
  transfer_offer_received:   { Icon: ExchangeIcon,     color: "text-cz-info",     bg: "bg-cz-info-bg0/8 border-cz-info/15",     link: "/transfers" },
  transfer_offer_accepted:   { Icon: CheckIcon,        color: "text-cz-success",  bg: "bg-cz-success-bg0/8 border-cz-success/15", link: "/transfers" },
  transfer_offer_rejected:   { Icon: XIcon,            color: "text-cz-danger",   bg: "bg-cz-danger-bg0/8 border-cz-danger/15",    link: "/transfers" },
  transfer_offer_withdrawn:  { Icon: UndoIcon,         color: "text-cz-2",        bg: "bg-cz-subtle border-cz-border",           link: "/transfers" },
  transfer_counter:          { Icon: ExchangeIcon,     color: "text-cz-accent-t", bg: "bg-cz-accent/10 border-cz-accent/15",     link: "/transfers" },
  transfer_interest:         { Icon: ExchangeIcon,     color: "text-cz-info",     bg: "bg-cz-info-bg0/8 border-cz-info/15",     link: "/transfers" },
  watchlist_rider_listed:    { Icon: StarIcon,         color: "text-cz-accent-t", bg: "bg-cz-accent/10 border-cz-accent/15",     link: "/transfers" },
  // #2524: rytteren er væk (slettet/forladt spillet) — ingen deep-link ind i en
  // rytterprofil der ikke findes længere, kun ind i selve ønskelisten.
  watchlist_departed:        { Icon: UndoIcon,         color: "text-cz-2",        bg: "bg-cz-subtle border-cz-border",           link: "/watchlist" },
  contract_expiring:         { Icon: AlertTriangleIcon, color: "text-cz-danger",   bg: "bg-cz-danger-bg0/8 border-cz-danger/15",    link: "/team" },
  new_race:                  { Icon: FlagIcon,         color: "text-cz-1",        bg: "bg-cz-subtle border-cz-border",           link: "/races" },
  race_result:               { Icon: PodiumIcon,       color: "text-cz-accent-t", bg: "bg-cz-accent/10 border-cz-accent/15",     link: "/resultater" },
  stage_result:              { Icon: PodiumIcon,       color: "text-cz-accent-t", bg: "bg-cz-accent/10 border-cz-accent/15",     link: "/resultater" },
  season_started:            { Icon: RocketIcon,       color: "text-cz-success",  bg: "bg-cz-success-bg0/8 border-cz-success/15", link: "/dashboard" },
  season_ended:              { Icon: FlagIcon,         color: "text-cz-1",        bg: "bg-cz-subtle border-cz-border",           link: "/seasons" },
  salary_paid:               { Icon: CoinIcon,         color: "text-cz-warning",  bg: "bg-cz-warning-bg0/8 border-cz-warning/15", link: "/finance" },
  sponsor_paid:              { Icon: CoinIcon,         color: "text-cz-success",  bg: "bg-cz-success-bg0/8 border-cz-success/15", link: "/finance" },
  loan_created:              { Icon: CoinIcon,         color: "text-cz-info",     bg: "bg-cz-info-bg0/8 border-cz-info/15",     link: "/finance" },
  emergency_loan:            { Icon: AlertTriangleIcon, color: "text-cz-danger",   bg: "bg-cz-danger-bg0/8 border-cz-danger/15",    link: "/finance" },
  loan_paid_off:             { Icon: CheckIcon,        color: "text-cz-success",  bg: "bg-cz-success-bg0/8 border-cz-success/15", link: "/finance" },
  board_update:              { Icon: ClipboardIcon,    color: "text-cz-info",     bg: "bg-cz-info-bg0/8 border-cz-info/15",     link: "/board" },
};

const DEFAULT_TYPE_CONFIG = { Icon: BellIcon, color: "text-cz-2", bg: "bg-cz-subtle border-cz-border" };

const MINE_FILTER_TYPES = {
  all:       null,
  unread:    null,
  auctions:  ["bid_received","bid_placed","auction_won","auction_lost","auction_outbid","watchlist_rider_auction"],
  transfers: ["transfer_offer_received","transfer_offer_accepted","transfer_offer_rejected","transfer_counter","transfer_offer_withdrawn","transfer_interest","watchlist_rider_listed","watchlist_departed","contract_expiring"],
  board:     ["board_update"],
  finance:   ["salary_paid","sponsor_paid","loan_created","emergency_loan","loan_paid_off"],
};

// Event-type → config. Label-building handled separately via i18n in component.
const EVENT_CONFIG = {
  auction_won:           { Icon: TrophyIcon,    color: "text-cz-accent-t", labelKey: "auctionWon" },
  auction_started:       { Icon: LightningIcon, color: "text-cz-2",        labelKey: "auctionStarted" },
  transfer_accepted:     { Icon: ExchangeIcon,  color: "text-cz-success",  labelKey: "transferAccepted" },
  rider_listed:          { Icon: ClipboardIcon, color: "text-cz-info",     labelKey: "riderListed" },
  season_started:        { Icon: RocketIcon,    color: "text-cz-success",  labelKey: "seasonStarted" },
  season_ended:          { Icon: FlagIcon,      color: "text-cz-2",        labelKey: "seasonEnded" },
  race_results_approved: { Icon: PodiumIcon,    color: "text-cz-accent-t", labelKey: "raceResultsApproved" },
};

const FEED_FILTER_TYPES = {
  all:       null,
  auctions:  ["auction_won","auction_started"],
  transfers: ["transfer_accepted","rider_listed"],
  season:    ["season_started","season_ended","race_results_approved"],
};

// timeAgo builder using i18n strings. Returns short locale-aware relative time.
function buildTimeAgo(t, _i18n) {
  return (dateStr) => {
    const diff = new Date() - new Date(dateStr);
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return t("relativeTime.justNow");
    if (m < 60) return t("relativeTime.minutes", { n: m });
    if (h < 24) return t("relativeTime.hours", { n: h });
    if (d < 7) return t("relativeTime.days", { n: d });
    // Beyond 7 days, fall back to a locale-aware date label (day + short month).
    return formatDate(new Date(dateStr), null, { day: "numeric", month: "short" });
  };
}

function isLegacyWatchlistAuctionNotification(notification, _i18n) {
  if (notification.type !== "watchlist_rider_listed") return false;
  const text = `${notification.title || ""} ${notification.message || ""}`.toLowerCase();
  // Detect via DK ("auktion") or EN ("auction") since legacy notifs persist text
  // that was localised at write-time in either language.
  return text.includes("auktion") || text.includes("auction");
}

function getNotificationConfig(notification, i18n) {
  if (isLegacyWatchlistAuctionNotification(notification, i18n)) {
    return TYPE_CONFIG.watchlist_rider_auction;
  }
  return TYPE_CONFIG[notification.type] || DEFAULT_TYPE_CONFIG;
}

// Build feed-event label using i18n. Falls back to event.type if no labelKey.
function buildFeedLabel(t, event) {
  const cfg = EVENT_CONFIG[event.type];
  if (!cfg) return event.type;
  const params = {
    team: event.team_name || "",
    number: event.meta?.season_number || "",
    race: event.meta?.race_name || "",
    type: event.type,
  };
  return t(`feed.${cfg.labelKey}`, params);
}

function pendingRoleLabel(t, role) {
  const key = PENDING_ROLE_KEYS[role];
  if (key) return t(`pending.role.${key}`);
  return t("pending.role.actionRequired");
}

// #666: notification.metadata.{titleCode, titleParams, messageCode, messageParams}
// renderes via backendMessages-namespace; falder tilbage til n.title/n.message
// for legacy rows uden metadata. Helper holdes ren funktion for genbrug.
function renderNotificationTitle(notification, tBackend) {
  const meta = notification?.metadata;
  if (meta?.titleCode) {
    return renderBackendMessage(
      { code: meta.titleCode, params: meta.titleParams },
      tBackend,
      notification.title,
    );
  }
  return notification.title;
}

function renderNotificationMessage(notification, tBackend) {
  const meta = notification?.metadata;
  if (meta?.messageCode) {
    return renderBackendMessage(
      { code: meta.messageCode, params: meta.messageParams },
      tBackend,
      notification.message,
    );
  }
  return notification.message;
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("notifications");
  const { t: tBackend } = useTranslation("backendMessages");
  const timeAgo = buildTimeAgo(t, i18n);
  const [tab, setTab] = useState("mine");

  // Mine tab
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(true);
  const [mineFilter, setMineFilter] = useState("all");
  const [markingAll, setMarkingAll] = useState(false);
  const [expandedAggregates, setExpandedAggregates] = useState(() => new Set());
  const userIdRef = useRef(null);

  // Ligaen tab
  const [events, setEvents] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [feedFilter, setFeedFilter] = useState("all");

  // Skal handles tab — kanonisk "kræver handling"-summary (#271 Slice A).
  // Hook'en henter + realtime-opdaterer via /api/inbox/pending, så badge-tallet
  // matcher Dashboard "Næste træk" og Min Aktivitet uden duplikeret logik.
  const { pending, loading: pendingLoading, loaded: pendingLoaded } = useActionSummary();

  useEffect(() => { loadNotifications(); }, []);

  useEffect(() => {
    if (tab === "ligaen" && !feedLoaded) loadFeed();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: personlige notifikationer
  useEffect(() => {
    if (!userIdRef.current) return;
    const channel = supabase.channel("notifs-page-v2")
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications",
        filter: `user_id=eq.${userIdRef.current}`,
      }, payload => setNotifications(prev => [payload.new, ...prev]))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [userIdRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: aktivitetsfeed
  useEffect(() => {
    const channel = supabase.channel("activity-feed-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_feed" },
        payload => setEvents(prev => [payload.new, ...prev].slice(0, 100)))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // Pending decisions hentes + realtime-opdateres af useActionSummary (#271 Slice A).

  async function loadNotifications() {
    setNotifLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) { setNotifLoading(false); return; }
    userIdRef.current = user.id;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    setNotifications(data || []);
    setNotifLoading(false);
  }

  async function loadFeed() {
    setFeedLoading(true);
    const { data } = await supabase
      .from("activity_feed")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setEvents(data || []);
    setFeedLoading(false);
    setFeedLoaded(true);
  }


  async function markRead(id) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  }

  async function markManyRead(ids) {
    if (!ids?.length) return;
    const idSet = new Set(ids);
    setNotifications(prev => prev.map(n => idSet.has(n.id) ? { ...n, is_read: true } : n));
    await supabase.from("notifications").update({ is_read: true }).in("id", ids);
  }

  async function deleteMany(ids) {
    if (!ids?.length) return;
    const idSet = new Set(ids);
    setNotifications(prev => prev.filter(n => !idSet.has(n.id)));
    await supabase.from("notifications").delete().in("id", ids);
    window.dispatchEvent(new Event("cz:notif-deleted"));
  }

  function toggleAggregate(key) {
    setExpandedAggregates(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function markAllRead() {
    if (!userIdRef.current) return;
    setMarkingAll(true);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    const { error } = await supabase.from("notifications")
      .update({ is_read: true }).eq("user_id", userIdRef.current);
    if (error) await loadNotifications();
    setMarkingAll(false);
  }

  async function deleteNotif(id) {
    setNotifications(prev => prev.filter(n => n.id !== id));
    await supabase.from("notifications").delete().eq("id", id);
    window.dispatchEvent(new Event("cz:notif-deleted"));
  }

  async function deleteAllRead() {
    const readIds = notifications.filter(n => n.is_read).map(n => n.id);
    if (!readIds.length) return;
    setNotifications(prev => prev.filter(n => !n.is_read));
    await supabase.from("notifications").delete()
      .eq("user_id", userIdRef.current).eq("is_read", true);
    window.dispatchEvent(new Event("cz:notif-deleted"));
  }

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const filteredNotifs = (() => {
    if (mineFilter === "unread") return notifications.filter(n => !n.is_read);
    const types = MINE_FILTER_TYPES[mineFilter];
    if (!types) return notifications;
    return notifications.filter(n => {
      const matchesType = types.includes(n.type);
      if (mineFilter === "auctions") return matchesType || isLegacyWatchlistAuctionNotification(n, i18n);
      if (mineFilter === "transfers") return matchesType && !isLegacyWatchlistAuctionNotification(n, i18n);
      return matchesType;
    });
  })();

  const feedTypes = FEED_FILTER_TYPES[feedFilter];
  const filteredEvents = feedTypes ? events.filter(e => feedTypes.includes(e.type)) : events;

  // Build pending-list items with localised primary/secondary text.
  const pendingItems = [
    ...pending.transfer_offers.map(item => {
      const price = item.price;
      const primary = price != null
        ? t("pending.transferPrimary", { rider: item.rider_name, price: formatNumber(price) })
        : t("pending.transferUnknownPrice", { rider: item.rider_name });
      const secondary = t("pending.transferSecondary", {
        team: item.counterparty_team_name || t("pending.unknownTeam"),
        role: pendingRoleLabel(t, item.role),
      });
      return { ...item, primary, secondary };
    }),
    ...pending.swap_offers.map(item => {
      const primary = t("pending.swapPrimary", {
        offered: item.offered_rider_name,
        requested: item.requested_rider_name,
      });
      const team = item.counterparty_team_name || t("pending.unknownTeam");
      const role = pendingRoleLabel(t, item.role);
      const secondary = item.cash_adjustment !== 0
        ? t("pending.swapSecondaryWithCash", {
            team,
            cash: formatNumber(item.cash_adjustment),
            role,
          })
        : t("pending.swapSecondaryNoCash", { team, role });
      return { ...item, primary, secondary };
    }),
  ].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("page.title")}</h1>
          <p className="text-cz-3 text-sm">
            {tab === "mine"
              ? t("page.subtitleMine", { count: unreadCount })
              : tab === "skal_handles"
                ? t("page.subtitleHandle", { count: pending.counts.total })
                : t("page.subtitleLeague")}
          </p>
        </div>
        {tab === "mine" && (
          <div className="grid grid-cols-1 sm:flex gap-2 w-full sm:w-auto">
            {unreadCount > 0 && (
              <Button variant="secondary" size="sm" onClick={markAllRead}
                loading={markingAll} disabled={markingAll}>
                {markingAll ? t("actions.markingAll") : t("actions.markAllRead")}
              </Button>
            )}
            {notifications.some(n => n.is_read) && (
              <Button variant="danger" size="sm" onClick={deleteAllRead}>
                {t("actions.deleteRead")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Primary tabs */}
      <Tabs value={tab} onChange={setTab} className="mb-4">
        <TabList label={t("page.title")}>
          {[
            { key: "mine",         label: t("tabs.mine"),    badge: unreadCount },
            { key: "skal_handles", label: t("tabs.handle"),  badge: pending.counts.total },
            { key: "ligaen",       label: t("tabs.league") },
          ].map(tt => (
            <Tab key={tt.key} value={tt.key} className="flex items-center gap-2">
              {tt.label}
              {tt.badge > 0 && (
                <span className="px-1.5 py-0.5 text-xs font-bold rounded-cz-pill bg-cz-accent text-cz-on-accent leading-none">
                  {tt.badge > 9 ? "9+" : tt.badge}
                </span>
              )}
            </Tab>
          ))}
        </TabList>
      </Tabs>

      {tab === "mine" ? (
        <>
          {/* Mine — category filters */}
          <div className="flex gap-1.5 mb-5 flex-wrap">
            {[
              { key: "all",       label: t("filter.all",    { count: notifications.length }) },
              { key: "unread",    label: t("filter.unread", { count: unreadCount }) },
              { key: "auctions",  label: t("filter.auctions") },
              { key: "transfers", label: t("filter.transfers") },
              { key: "board",     label: t("filter.board") },
              { key: "finance",   label: t("filter.finance") },
            ].map(f => (
              <button key={f.key} onClick={() => setMineFilter(f.key)}
                className={`px-3 py-1.5 rounded-cz text-sm font-medium transition-colors border
                  ${mineFilter === f.key
                    ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                    : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {notifLoading ? (
            <PageLoader />
          ) : filteredNotifs.length === 0 ? (
            <EmptyState
              icon={<BellIcon size={32} />}
              title={mineFilter === "unread" ? t("empty.noneUnread") : t("empty.noneInCategory")}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {groupNotifications(filteredNotifs).map(entry => {
                if (entry.kind === "single") {
                  const n = entry.notification;
                  const config = getNotificationConfig(n, i18n);
                  const Icon = config.Icon;
                  return (
                    <div key={n.id}
                      className={`flex items-start gap-3 p-3 sm:p-4 rounded-cz border transition-colors cursor-pointer
                        ${n.is_read
                          ? "bg-cz-card border-cz-border opacity-60 hover:opacity-80"
                          : config.bg}`}
                      onClick={() => {
                        if (!n.is_read) markRead(n.id);
                        // #1486: rytter-centrerede notifikationer bærer riderId i metadata
                        // og deep-linker direkte til rytterprofilen. #921: legacy
                        // "Transferrygte" bruger related_id (ingen metadata). Begge falder
                        // ellers tilbage til den generiske config.link.
                        const link = n.metadata?.riderId
                          ? `/riders/${n.metadata.riderId}`
                          : n.type === "transfer_interest" && n.related_id
                            ? `/riders/${n.related_id}`
                            // #1952: resultat-notifikation deep-linker direkte til løbets resultatside
                            : n.type === "race_result" && (n.metadata?.raceId || n.related_id)
                              ? `/races/${n.metadata?.raceId || n.related_id}`
                              : config.link;
                        if (link) navigate(link);
                      }}>
                      <div className={`w-9 h-9 rounded-cz bg-cz-subtle flex items-center justify-center
                        flex-shrink-0 mt-0.5 ${config.color}`}>
                        {Icon ? <Icon size={18} /> : <InfoIcon size={18} aria-hidden="true" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${n.is_read ? "text-cz-2" : "text-cz-1"}`}>
                          {renderNotificationTitle(n, tBackend)}
                        </p>
                        <p className="text-cz-2 text-xs mt-0.5 leading-relaxed">
                          {/* #1486: rytter-notifikationer linker beskeden til rytterprofilen
                              når metadata.riderId findes; RiderLink falder selv tilbage til
                              ren tekst for legacy-rækker uden riderId. */}
                          <RiderLink id={n.metadata?.riderId} stopPropagation
                            className={n.metadata?.riderId ? "hover:text-cz-accent-t transition-colors" : ""}>
                            {renderNotificationMessage(n, tBackend)}
                          </RiderLink>
                        </p>
                        <p className="text-cz-3 text-xs mt-1.5">{timeAgo(n.created_at)}</p>
                      </div>
                      <div className="flex flex-col sm:flex-row items-center gap-2 flex-shrink-0">
                        {!n.is_read && (
                          <span className="w-2 h-2 rounded-cz-pill bg-cz-accent flex-shrink-0" />
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); deleteNotif(n.id); }}
                          aria-label={t("actions.deleteAria")}
                          className="text-cz-3 hover:text-cz-2 transition-colors p-1 rounded-cz">
                          <XIcon size={16} />
                        </button>
                      </div>
                    </div>
                  );
                }
                // Aggregate
                const config = TYPE_CONFIG[entry.type] || DEFAULT_TYPE_CONFIG;
                const AggIcon = config.Icon;
                const isExpanded = expandedAggregates.has(entry.key);
                const allRead = !entry.any_unread;
                const ids = entry.items.map(i => i.id);
                return (
                  <div key={entry.key}
                    className={`rounded-cz border transition-colors
                      ${allRead
                        ? "bg-cz-card border-cz-border opacity-60 hover:opacity-80"
                        : config.bg}`}>
                    <div className="flex items-start gap-3 p-3 sm:p-4 cursor-pointer"
                      onClick={() => {
                        if (entry.any_unread) markManyRead(ids);
                        toggleAggregate(entry.key);
                      }}>
                      <div className={`w-9 h-9 rounded-cz bg-cz-subtle flex items-center justify-center
                        flex-shrink-0 mt-0.5 relative ${config.color}`}>
                        {AggIcon ? <AggIcon size={18} /> : <InfoIcon size={18} aria-hidden="true" />}
                        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-cz-pill
                          bg-cz-accent text-cz-on-accent text-[10px] font-bold flex items-center justify-center leading-none">
                          {entry.count > 99 ? "99+" : entry.count}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${allRead ? "text-cz-2" : "text-cz-1"}`}>
                          {renderNotificationTitle({ metadata: entry.sample_metadata, title: entry.sample_title }, tBackend)} <span className="text-cz-3 font-normal">{t("aggregate.countSuffix", { count: entry.count })}</span>
                        </p>
                        <p className="text-cz-2 text-xs mt-0.5 leading-relaxed">{renderNotificationMessage({ metadata: entry.sample_metadata, message: entry.sample_message }, tBackend)}</p>
                        <p className="text-cz-3 text-xs mt-1.5">
                          {t("aggregate.firstLatest", { first: timeAgo(entry.earliest_at), latest: timeAgo(entry.latest_at) })}
                        </p>
                      </div>
                      <div className="flex flex-col sm:flex-row items-center gap-2 flex-shrink-0">
                        {entry.any_unread && (
                          <span className="w-2 h-2 rounded-cz-pill bg-cz-accent flex-shrink-0" />
                        )}
                        <span className="text-cz-3 flex items-center" aria-label={isExpanded ? t("aggregate.collapse") : t("aggregate.expand")} aria-hidden>
                          {isExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); deleteMany(ids); }}
                          className="text-cz-3 hover:text-cz-2 transition-colors p-1 rounded-cz"
                          aria-label={t("actions.deleteAllAria")}>
                          <XIcon size={16} />
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-cz-border px-3 sm:px-4 py-3 flex flex-col gap-2">
                        <ul className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                          {entry.items.map(item => (
                            <li key={item.id} className="flex items-start gap-2 text-xs">
                              <span className="text-cz-3 whitespace-nowrap min-w-[5rem]">{timeAgo(item.created_at)}</span>
                              <span className="text-cz-2 flex-1">
                                {/* #1486: link til rytterprofil når riderId findes i metadata */}
                                <RiderLink id={item.metadata?.riderId} stopPropagation
                                  className={item.metadata?.riderId ? "hover:text-cz-accent-t transition-colors" : ""}>
                                  {renderNotificationMessage(item, tBackend)}
                                </RiderLink>
                              </span>
                            </li>
                          ))}
                        </ul>
                        {config.link && (
                          <Button variant="secondary" size="sm" className="self-end inline-flex items-center gap-1"
                            onClick={e => { e.stopPropagation(); navigate(config.link); }}>
                            {t("actions.viewAuction")} <ChevronRightIcon size={14} aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : tab === "skal_handles" ? (
        <>
          {pendingLoading && !pendingLoaded ? (
            <PageLoader />
          ) : pending.counts.total === 0 ? (
            <EmptyState
              icon={<CheckIcon size={32} />}
              title={t("empty.noPending")}
              description={t("empty.noPendingHint")}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {pendingItems.map(item => {
                const PendingIcon = PENDING_KIND_ICON[item.kind];
                return (
                <div key={`${item.kind}-${item.id}`}
                  className="flex items-start gap-3 p-3 sm:p-4 rounded-cz border border-cz-accent/30 bg-cz-accent/5 hover:bg-cz-accent/10 transition-colors cursor-pointer"
                  onClick={() => { logEvent("notification_clicked", { kind: item.kind }); navigate(item.link); }}>
                  <div className="w-9 h-9 rounded-cz bg-cz-subtle flex items-center justify-center text-cz-accent-t flex-shrink-0 mt-0.5">
                    {PendingIcon ? <PendingIcon size={18} /> : <InfoIcon size={18} aria-hidden="true" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-cz-1">{item.primary}</p>
                    <p className="text-cz-2 text-xs mt-0.5 leading-relaxed">{item.secondary}</p>
                    <p className="text-cz-3 text-xs mt-1.5">{timeAgo(item.updated_at)}</p>
                  </div>
                  <ChevronRightIcon size={14} className="text-cz-accent-t flex-shrink-0 mt-1" aria-hidden="true" />
                </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Ligaen — feed filters */}
          <div className="flex gap-1.5 mb-5 flex-wrap">
            {[
              { key: "all",       label: t("filter.all", { count: events.length }) },
              { key: "auctions",  label: t("filter.auctions") },
              { key: "transfers", label: t("filter.transfers") },
              { key: "season",    label: t("filter.season") },
            ].map(f => (
              <button key={f.key} onClick={() => setFeedFilter(f.key)}
                className={`px-3 py-1.5 rounded-cz text-sm font-medium transition-colors border
                  ${feedFilter === f.key
                    ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                    : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {feedLoading ? (
            <PageLoader />
          ) : filteredEvents.length === 0 ? (
            <EmptyState
              icon={<FlagIcon size={32} aria-hidden="true" />}
              title={t("empty.noFeed")}
              description={t("empty.noFeedHint")}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {filteredEvents.map((event) => {
                const cfg = EVENT_CONFIG[event.type] || { Icon: null, color: "text-cz-2" };
                const FeedIcon = cfg.Icon;
                const label = buildFeedLabel(t, event);
                return (
                  <div key={event.id}
                    className="flex items-start gap-3 px-3 sm:px-4 py-3.5 rounded-cz border bg-cz-card border-cz-border transition-colors">
                    <div className={`w-8 h-8 rounded-cz bg-cz-subtle flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
                      {FeedIcon ? <FeedIcon size={16} /> : <InfoIcon size={16} aria-hidden="true" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${cfg.color}`}>
                        {label}
                      </p>
                      {event.rider_name && (
                        <p className="text-cz-2 text-sm mt-0.5">
                          <RiderLink id={event.rider_id}
                            className="hover:text-cz-accent-t cursor-pointer transition-colors">
                            {event.rider_name}
                          </RiderLink>
                          {event.amount > 0 && (
                            <span className="text-cz-accent-t font-mono ms-2">
                              {formatNumber(event.amount)} CZ$
                            </span>
                          )}
                        </p>
                      )}
                      {event.team_name && event.type !== "season_started" && event.type !== "season_ended" && (
                        <p className="text-cz-3 text-xs mt-0.5">
                          <TeamLink id={event.team_id} className="hover:text-cz-accent-t transition-colors">{event.team_name}</TeamLink>
                        </p>
                      )}
                    </div>
                    <span className="text-cz-3 text-xs flex-shrink-0 mt-0.5 whitespace-nowrap">{timeAgo(event.created_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
