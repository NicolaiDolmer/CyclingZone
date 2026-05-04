import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL;

const PENDING_ROLE_LABEL = {
  seller_decide: "Acceptér / afvis tilbud",
  buyer_decide: "Svar på modbud",
  seller_confirm: "Bekræft handel",
  buyer_confirm: "Bekræft handel",
  receiving_decide: "Acceptér / afvis byttehandel",
  proposing_decide: "Svar på modbud",
  receiving_confirm: "Bekræft byttehandel",
  proposing_confirm: "Bekræft byttehandel",
  borrower_decide: "Acceptér / afvis lånetilbud",
};

const PENDING_KIND_ICON = {
  transfer_offer: "↔",
  swap_offer: "🔁",
  loan_offer: "💰",
};

const TYPE_CONFIG = {
  bid_received:              { icon: "⚡", color: "text-cz-accent-t", bg: "bg-cz-accent/10 border-[#e8c547]/15", link: "/auctions" },
  bid_placed:                { icon: "⚡", color: "text-cz-accent-t", bg: "bg-cz-accent/10 border-[#e8c547]/15", link: "/auctions" },
  auction_won:               { icon: "🏆", color: "text-cz-success",  bg: "bg-cz-success-bg0/8 border-green-500/15", link: "/auctions" },
  auction_lost:              { icon: "↩",  color: "text-cz-2",   bg: "bg-cz-subtle border-cz-border",          link: "/auctions" },
  auction_outbid:            { icon: "⚠️", color: "text-cz-danger",    bg: "bg-cz-danger-bg0/8 border-red-500/15",     link: "/auctions" },
  transfer_offer_received:   { icon: "↔",  color: "text-cz-info",   bg: "bg-cz-info-bg0/8 border-blue-500/15",   link: "/transfers" },
  transfer_offer_accepted:   { icon: "✅", color: "text-cz-success",  bg: "bg-cz-success-bg0/8 border-green-500/15", link: "/transfers" },
  transfer_offer_rejected:   { icon: "❌", color: "text-cz-danger",    bg: "bg-cz-danger-bg0/8 border-red-500/15",     link: "/transfers" },
  transfer_offer_withdrawn:  { icon: "↩",  color: "text-cz-2",   bg: "bg-cz-subtle border-cz-border",          link: "/transfers" },
  transfer_counter:          { icon: "↔",  color: "text-cz-accent-t", bg: "bg-cz-accent/10 border-[#e8c547]/15", link: "/transfers" },
  transfer_interest:         { icon: "↔",  color: "text-cz-info",   bg: "bg-cz-info-bg0/8 border-blue-500/15",   link: "/transfers" },
  watchlist_rider_listed:    { icon: "⭐", color: "text-cz-accent-t", bg: "bg-cz-accent/10 border-[#e8c547]/15", link: "/transfers" },
  new_race:                  { icon: "🏁", color: "text-cz-1",      bg: "bg-cz-subtle border-cz-border",          link: "/races" },
  season_started:            { icon: "🚀", color: "text-cz-success",  bg: "bg-cz-success-bg0/8 border-green-500/15", link: "/dashboard" },
  season_ended:              { icon: "🏁", color: "text-cz-1",      bg: "bg-cz-subtle border-cz-border",          link: "/seasons" },
  salary_paid:               { icon: "💰", color: "text-cz-warning", bg: "bg-cz-warning-bg0/8 border-orange-500/15", link: "/finance" },
  sponsor_paid:              { icon: "💰", color: "text-cz-success",  bg: "bg-cz-success-bg0/8 border-green-500/15", link: "/finance" },
  loan_created:              { icon: "💰", color: "text-cz-info",   bg: "bg-cz-info-bg0/8 border-blue-500/15",   link: "/finance" },
  emergency_loan:            { icon: "⚠️", color: "text-cz-danger",    bg: "bg-cz-danger-bg0/8 border-red-500/15",     link: "/finance" },
  loan_paid_off:             { icon: "✅", color: "text-cz-success",  bg: "bg-cz-success-bg0/8 border-green-500/15", link: "/finance" },
  board_update:              { icon: "📋", color: "text-cz-info",   bg: "bg-cz-info-bg0/8 border-blue-500/15",   link: "/board" },
};

const MINE_FILTER_TYPES = {
  all:       null,
  unread:    null,
  auctions:  ["bid_received","bid_placed","auction_won","auction_lost","auction_outbid"],
  transfers: ["transfer_offer_received","transfer_offer_accepted","transfer_offer_rejected","transfer_counter","transfer_offer_withdrawn","transfer_interest","watchlist_rider_listed"],
  board:     ["board_update"],
  finance:   ["salary_paid","sponsor_paid","loan_created","emergency_loan","loan_paid_off"],
};

const EVENT_CONFIG = {
  auction_won:           { icon: "🏆", color: "text-cz-accent-t",  label: (e) => `${e.team_name} vandt auktion` },
  auction_started:       { icon: "⚡", color: "text-cz-2",   label: (e) => `${e.team_name} startede auktion` },
  transfer_accepted:     { icon: "↔",  color: "text-cz-success",  label: () => "Transfer gennemført" },
  rider_listed:          { icon: "📋", color: "text-cz-info",   label: (e) => `${e.team_name} satte rytter til salg` },
  season_started:        { icon: "🚀", color: "text-cz-success",  label: (e) => `Sæson ${e.meta?.season_number} startet` },
  season_ended:          { icon: "🏁", color: "text-cz-2",   label: (e) => `Sæson ${e.meta?.season_number} afsluttet` },
  race_results_approved: { icon: "🏅", color: "text-cz-accent-t", label: (e) => `Resultater godkendt: ${e.meta?.race_name}` },
};

const FEED_FILTER_TYPES = {
  all:       null,
  auctions:  ["auction_won","auction_started"],
  transfers: ["transfer_accepted","rider_listed"],
  season:    ["season_started","season_ended","race_results_approved"],
};

function timeAgo(dateStr) {
  const diff = new Date() - new Date(dateStr);
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "Lige nu";
  if (m < 60) return `${m}m siden`;
  if (h < 24) return `${h}t siden`;
  if (d < 7) return `${d}d siden`;
  return new Date(dateStr).toLocaleDateString("da-DK", { day: "numeric", month: "short" });
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("mine");

  // Mine tab
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(true);
  const [mineFilter, setMineFilter] = useState("all");
  const [markingAll, setMarkingAll] = useState(false);
  const userIdRef = useRef(null);

  // Ligaen tab
  const [events, setEvents] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [feedFilter, setFeedFilter] = useState("all");

  // Skal handles tab — pending decisions
  const [pending, setPending] = useState({
    transfer_offers: [],
    swap_offers: [],
    loan_offers: [],
    counts: { transfer_offers: 0, swap_offers: 0, loan_offers: 0, total: 0 },
  });
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingLoaded, setPendingLoaded] = useState(false);

  useEffect(() => { loadNotifications(); loadPending(); }, []);

  useEffect(() => {
    if (tab === "ligaen" && !feedLoaded) loadFeed();
    if (tab === "skal_handles" && !pendingLoaded) loadPending();
  }, [tab]);

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
  }, [userIdRef.current]);

  // Realtime: aktivitetsfeed
  useEffect(() => {
    const channel = supabase.channel("activity-feed-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_feed" },
        payload => setEvents(prev => [payload.new, ...prev].slice(0, 100)))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // Realtime: pending decisions — refetch på hver ændring i de 3 kilde-tabeller
  useEffect(() => {
    const channel = supabase.channel("inbox-pending-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "transfer_offers" }, () => loadPending())
      .on("postgres_changes", { event: "*", schema: "public", table: "swap_offers" }, () => loadPending())
      .on("postgres_changes", { event: "*", schema: "public", table: "loan_agreements" }, () => loadPending())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function loadNotifications() {
    setNotifLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
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

  async function loadPending() {
    setPendingLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setPendingLoading(false); return; }
      const res = await fetch(`${API}/api/inbox/pending`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPending(data);
      }
    } catch (e) { /* silent — UI viser tom-state */ }
    setPendingLoading(false);
    setPendingLoaded(true);
  }

  async function markRead(id) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
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
  }

  async function deleteAllRead() {
    const readIds = notifications.filter(n => n.is_read).map(n => n.id);
    if (!readIds.length) return;
    setNotifications(prev => prev.filter(n => !n.is_read));
    await supabase.from("notifications").delete()
      .eq("user_id", userIdRef.current).eq("is_read", true);
  }

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const filteredNotifs = (() => {
    if (mineFilter === "unread") return notifications.filter(n => !n.is_read);
    const types = MINE_FILTER_TYPES[mineFilter];
    if (!types) return notifications;
    return notifications.filter(n => types.includes(n.type));
  })();

  const feedTypes = FEED_FILTER_TYPES[feedFilter];
  const filteredEvents = feedTypes ? events.filter(e => feedTypes.includes(e.type)) : events;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">Indbakke</h1>
          <p className="text-cz-3 text-sm">
            {tab === "mine"
              ? (unreadCount > 0 ? `${unreadCount} ulæste` : "Alle er læst")
              : tab === "skal_handles"
                ? (pending.counts.total > 0
                    ? `${pending.counts.total} venter på dig`
                    : "Intet at handle på lige nu")
                : "Hvad sker der i ligaen"}
          </p>
        </div>
        {tab === "mine" && (
          <div className="grid grid-cols-1 sm:flex gap-2 w-full sm:w-auto">
            {unreadCount > 0 && (
              <button onClick={markAllRead} disabled={markingAll}
                className="px-3 py-1.5 text-xs text-cz-2 hover:text-cz-1
                  bg-cz-subtle hover:bg-cz-border rounded-lg border border-cz-border
                  transition-all disabled:opacity-50">
                {markingAll ? "Markerer..." : "Marker alle læst"}
              </button>
            )}
            {notifications.some(n => n.is_read) && (
              <button onClick={deleteAllRead}
                className="px-3 py-1.5 text-xs text-cz-3 hover:text-cz-danger
                  bg-cz-subtle hover:bg-cz-danger-bg rounded-lg border border-cz-border
                  hover:border-cz-danger/30 transition-all">
                Slet læste
              </button>
            )}
          </div>
        )}
      </div>

      {/* Primary tabs */}
      <div className="flex border-b border-cz-border mb-4 overflow-x-auto">
        {[
          { key: "mine",         label: "Mine",         badge: unreadCount },
          { key: "skal_handles", label: "Skal handles", badge: pending.counts.total },
          { key: "ligaen",       label: "Ligaen" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-all flex items-center gap-2
              ${tab === t.key
                ? "text-cz-1 border-b-2 border-[#e8c547] -mb-px"
                : "text-cz-3 hover:text-cz-2"}`}>
            {t.label}
            {t.badge > 0 && (
              <span className="px-1.5 py-0.5 text-xs font-bold rounded-full bg-cz-accent text-cz-1 leading-none">
                {t.badge > 9 ? "9+" : t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "mine" ? (
        <>
          {/* Mine — category filters */}
          <div className="flex gap-1.5 mb-5 flex-wrap">
            {[
              { key: "all",       label: `Alle (${notifications.length})` },
              { key: "unread",    label: `Ulæste (${unreadCount})` },
              { key: "auctions",  label: "Auktioner" },
              { key: "transfers", label: "Transfers" },
              { key: "board",     label: "Bestyrelse" },
              { key: "finance",   label: "Finans" },
            ].map(f => (
              <button key={f.key} onClick={() => setMineFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                  ${mineFilter === f.key
                    ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                    : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {notifLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
            </div>
          ) : filteredNotifs.length === 0 ? (
            <div className="text-center py-16 text-cz-3">
              <p className="text-4xl mb-3">🔔</p>
              <p>{mineFilter === "unread" ? "Ingen ulæste notifikationer" : "Ingen notifikationer i denne kategori"}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredNotifs.map(n => {
                const config = TYPE_CONFIG[n.type] || { icon: "●", color: "text-cz-2", bg: "bg-cz-subtle border-cz-border" };
                return (
                  <div key={n.id}
                    className={`flex items-start gap-3 p-3 sm:p-4 rounded-xl border transition-all cursor-pointer
                      ${n.is_read
                        ? "bg-cz-card border-cz-border opacity-60 hover:opacity-80"
                        : config.bg}`}
                    onClick={() => {
                      if (!n.is_read) markRead(n.id);
                      if (config.link) navigate(config.link);
                    }}>
                    <div className="w-9 h-9 rounded-lg bg-cz-subtle flex items-center justify-center
                      text-base flex-shrink-0 mt-0.5">
                      {config.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${n.is_read ? "text-cz-2" : "text-cz-1"}`}>
                        {n.title}
                      </p>
                      <p className="text-cz-2 text-xs mt-0.5 leading-relaxed">{n.message}</p>
                      <p className="text-cz-3 text-xs mt-1.5">{timeAgo(n.created_at)}</p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-2 flex-shrink-0">
                      {!n.is_read && (
                        <span className="w-2 h-2 rounded-full bg-cz-accent flex-shrink-0" />
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); deleteNotif(n.id); }}
                        className="text-cz-3 hover:text-cz-2 text-lg transition-colors p-1 rounded">
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : tab === "skal_handles" ? (
        <>
          {pendingLoading && !pendingLoaded ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
            </div>
          ) : pending.counts.total === 0 ? (
            <div className="text-center py-20 text-cz-3">
              <p className="text-4xl mb-3">✅</p>
              <p>Intet venter på din beslutning</p>
              <p className="text-xs mt-2">Tilbud, byttehandler og lånetilbud du skal svare på dukker op her</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {[
                ...pending.transfer_offers.map(item => ({
                  ...item,
                  primary: `${item.rider_name} — ${item.price?.toLocaleString("da-DK") || "?"} CZ$`,
                  secondary: `Fra ${item.counterparty_team_name || "ukendt hold"} · ${PENDING_ROLE_LABEL[item.role] || "Handling påkrævet"}`,
                })),
                ...pending.swap_offers.map(item => ({
                  ...item,
                  primary: `${item.offered_rider_name} ↔ ${item.requested_rider_name}`,
                  secondary: `${item.counterparty_team_name || "ukendt hold"} · ${item.cash_adjustment !== 0 ? `Cash ${item.cash_adjustment.toLocaleString("da-DK")} CZ$ · ` : ""}${PENDING_ROLE_LABEL[item.role] || "Handling påkrævet"}`,
                })),
                ...pending.loan_offers.map(item => ({
                  ...item,
                  primary: `${item.rider_name} — lån ${item.loan_fee?.toLocaleString("da-DK") || "0"} CZ$`,
                  secondary: `Fra ${item.counterparty_team_name || "ukendt hold"} · Sæson ${item.start_season}${item.end_season !== item.start_season ? `–${item.end_season}` : ""} · ${PENDING_ROLE_LABEL[item.role] || "Handling påkrævet"}`,
                })),
              ]
                .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
                .map(item => (
                  <div key={`${item.kind}-${item.id}`}
                    className="flex items-start gap-3 p-3 sm:p-4 rounded-xl border border-cz-accent/30 bg-cz-accent/5 hover:bg-cz-accent/10 transition-all cursor-pointer"
                    onClick={() => navigate(item.link)}>
                    <div className="w-9 h-9 rounded-lg bg-cz-subtle flex items-center justify-center text-base flex-shrink-0 mt-0.5">
                      {PENDING_KIND_ICON[item.kind] || "●"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-cz-1">{item.primary}</p>
                      <p className="text-cz-2 text-xs mt-0.5 leading-relaxed">{item.secondary}</p>
                      <p className="text-cz-3 text-xs mt-1.5">{timeAgo(item.updated_at)}</p>
                    </div>
                    <span className="text-cz-accent-t text-xs flex-shrink-0 mt-1 whitespace-nowrap">→</span>
                  </div>
                ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Ligaen — feed filters */}
          <div className="flex gap-1.5 mb-5 flex-wrap">
            {[
              { key: "all",       label: `Alle (${events.length})` },
              { key: "auctions",  label: "Auktioner" },
              { key: "transfers", label: "Transfers" },
              { key: "season",    label: "Sæson" },
            ].map(f => (
              <button key={f.key} onClick={() => setFeedFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                  ${feedFilter === f.key
                    ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                    : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {feedLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-20 text-cz-3">
              <p className="text-4xl mb-3">◎</p>
              <p>Ingen aktivitet endnu</p>
              <p className="text-xs mt-2">Start auktioner og handler for at se aktivitet her</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredEvents.map((event, i) => {
                const cfg = EVENT_CONFIG[event.type] || { icon: "●", color: "text-cz-2", label: () => event.type };
                return (
                  <div key={event.id}
                    className={`flex items-start gap-3 px-3 sm:px-4 py-3.5 rounded-xl border transition-all
                      ${i === 0 ? "bg-cz-card border-cz-border" : "bg-cz-card border-cz-border hover:border-cz-border"}`}>
                    <div className="w-8 h-8 rounded-lg bg-cz-subtle flex items-center justify-center flex-shrink-0 text-sm">
                      {cfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${cfg.color}`}>
                        {cfg.label(event)}
                      </p>
                      {event.rider_name && (
                        <p className="text-cz-2 text-sm mt-0.5">
                          <span
                            className="hover:text-cz-accent-t cursor-pointer transition-colors"
                            onClick={() => event.rider_id && navigate(`/riders/${event.rider_id}`)}>
                            {event.rider_name}
                          </span>
                          {event.amount > 0 && (
                            <span className="text-cz-accent-t font-mono ml-2">
                              {event.amount.toLocaleString("da-DK")} CZ$
                            </span>
                          )}
                        </p>
                      )}
                      {event.team_name && event.type !== "season_started" && event.type !== "season_ended" && (
                        <p className="text-cz-3 text-xs mt-0.5">{event.team_name}</p>
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
