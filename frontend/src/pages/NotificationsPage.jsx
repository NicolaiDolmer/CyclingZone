import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const TYPE_CONFIG = {
  bid_received:              { icon: "⚡", color: "text-amber-700", bg: "bg-amber-50 border-[#e8c547]/15", link: "/auctions" },
  bid_placed:                { icon: "⚡", color: "text-amber-700", bg: "bg-amber-50 border-[#e8c547]/15", link: "/auctions" },
  auction_won:               { icon: "🏆", color: "text-green-700",  bg: "bg-green-500/8 border-green-500/15", link: "/auctions" },
  auction_lost:              { icon: "↩",  color: "text-slate-500",   bg: "bg-slate-50 border-slate-200",          link: "/auctions" },
  auction_outbid:            { icon: "⚠️", color: "text-red-700",    bg: "bg-red-500/8 border-red-500/15",     link: "/auctions" },
  transfer_offer_received:   { icon: "↔",  color: "text-blue-700",   bg: "bg-blue-500/8 border-blue-500/15",   link: "/transfers" },
  transfer_offer_accepted:   { icon: "✅", color: "text-green-700",  bg: "bg-green-500/8 border-green-500/15", link: "/transfers" },
  transfer_offer_rejected:   { icon: "❌", color: "text-red-700",    bg: "bg-red-500/8 border-red-500/15",     link: "/transfers" },
  transfer_offer_withdrawn:  { icon: "↩",  color: "text-slate-500",   bg: "bg-slate-50 border-slate-200",          link: "/transfers" },
  transfer_counter:          { icon: "↔",  color: "text-amber-700", bg: "bg-amber-50 border-[#e8c547]/15", link: "/transfers" },
  transfer_interest:         { icon: "↔",  color: "text-blue-700",   bg: "bg-blue-500/8 border-blue-500/15",   link: "/transfers" },
  watchlist_rider_listed:    { icon: "⭐", color: "text-amber-700", bg: "bg-amber-50 border-[#e8c547]/15", link: "/transfers" },
  new_race:                  { icon: "🏁", color: "text-slate-900",      bg: "bg-slate-50 border-slate-200",          link: "/races" },
  season_started:            { icon: "🚀", color: "text-green-700",  bg: "bg-green-500/8 border-green-500/15", link: "/dashboard" },
  season_ended:              { icon: "🏁", color: "text-slate-900",      bg: "bg-slate-50 border-slate-200",          link: "/season-end" },
  salary_paid:               { icon: "💰", color: "text-orange-700", bg: "bg-orange-500/8 border-orange-500/15", link: "/finance" },
  sponsor_paid:              { icon: "💰", color: "text-green-700",  bg: "bg-green-500/8 border-green-500/15", link: "/finance" },
  loan_created:              { icon: "💰", color: "text-blue-700",   bg: "bg-blue-500/8 border-blue-500/15",   link: "/finance" },
  emergency_loan:            { icon: "⚠️", color: "text-red-700",    bg: "bg-red-500/8 border-red-500/15",     link: "/finance" },
  loan_paid_off:             { icon: "✅", color: "text-green-700",  bg: "bg-green-500/8 border-green-500/15", link: "/finance" },
  board_update:              { icon: "📋", color: "text-blue-700",   bg: "bg-blue-500/8 border-blue-500/15",   link: "/board" },
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
  auction_won:           { icon: "🏆", color: "text-amber-700",  label: (e) => `${e.team_name} vandt auktion` },
  auction_started:       { icon: "⚡", color: "text-slate-500",   label: (e) => `${e.team_name} startede auktion` },
  transfer_accepted:     { icon: "↔",  color: "text-green-700",  label: () => "Transfer gennemført" },
  rider_listed:          { icon: "📋", color: "text-blue-700",   label: (e) => `${e.team_name} satte rytter til salg` },
  season_started:        { icon: "🚀", color: "text-green-700",  label: (e) => `Sæson ${e.meta?.season_number} startet` },
  season_ended:          { icon: "🏁", color: "text-slate-500",   label: (e) => `Sæson ${e.meta?.season_number} afsluttet` },
  race_results_approved: { icon: "🏅", color: "text-amber-700", label: (e) => `Resultater godkendt: ${e.meta?.race_name}` },
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

  useEffect(() => { loadNotifications(); }, []);

  useEffect(() => {
    if (tab === "ligaen" && !feedLoaded) loadFeed();
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
          <h1 className="text-xl font-bold text-slate-900">Indbakke</h1>
          <p className="text-slate-400 text-sm">
            {tab === "mine"
              ? (unreadCount > 0 ? `${unreadCount} ulæste` : "Alle er læst")
              : "Hvad sker der i ligaen"}
          </p>
        </div>
        {tab === "mine" && (
          <div className="grid grid-cols-1 sm:flex gap-2 w-full sm:w-auto">
            {unreadCount > 0 && (
              <button onClick={markAllRead} disabled={markingAll}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-900
                  bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200
                  transition-all disabled:opacity-50">
                {markingAll ? "Markerer..." : "Marker alle læst"}
              </button>
            )}
            {notifications.some(n => n.is_read) && (
              <button onClick={deleteAllRead}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-red-700
                  bg-slate-100 hover:bg-red-50 rounded-lg border border-slate-200
                  hover:border-red-200 transition-all">
                Slet læste
              </button>
            )}
          </div>
        )}
      </div>

      {/* Primary tabs */}
      <div className="flex border-b border-slate-200 mb-4 overflow-x-auto">
        {[
          { key: "mine",   label: "Mine",   badge: unreadCount },
          { key: "ligaen", label: "Ligaen" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-all flex items-center gap-2
              ${tab === t.key
                ? "text-slate-900 border-b-2 border-[#e8c547] -mb-px"
                : "text-slate-400 hover:text-slate-600"}`}>
            {t.label}
            {t.badge > 0 && (
              <span className="px-1.5 py-0.5 text-xs font-bold rounded-full bg-[#e8c547] text-slate-900 leading-none">
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
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "text-slate-500 hover:text-slate-900 bg-white border-slate-200"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {notifLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-slate-200 border-t-amber-700 rounded-full animate-spin" />
            </div>
          ) : filteredNotifs.length === 0 ? (
            <div className="text-center py-16 text-slate-300">
              <p className="text-4xl mb-3">🔔</p>
              <p>{mineFilter === "unread" ? "Ingen ulæste notifikationer" : "Ingen notifikationer i denne kategori"}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredNotifs.map(n => {
                const config = TYPE_CONFIG[n.type] || { icon: "●", color: "text-slate-500", bg: "bg-slate-50 border-slate-200" };
                return (
                  <div key={n.id}
                    className={`flex items-start gap-3 p-3 sm:p-4 rounded-xl border transition-all cursor-pointer
                      ${n.is_read
                        ? "bg-white border-slate-200 opacity-60 hover:opacity-80"
                        : config.bg}`}
                    onClick={() => {
                      if (!n.is_read) markRead(n.id);
                      if (config.link) navigate(config.link);
                    }}>
                    <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center
                      text-base flex-shrink-0 mt-0.5">
                      {config.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${n.is_read ? "text-slate-500" : "text-slate-900"}`}>
                        {n.title}
                      </p>
                      <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">{n.message}</p>
                      <p className="text-slate-300 text-xs mt-1.5">{timeAgo(n.created_at)}</p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-2 flex-shrink-0">
                      {!n.is_read && (
                        <span className="w-2 h-2 rounded-full bg-[#e8c547] flex-shrink-0" />
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); deleteNotif(n.id); }}
                        className="text-slate-300 hover:text-slate-500 text-lg transition-colors p-1 rounded">
                        ×
                      </button>
                    </div>
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
              { key: "all",       label: `Alle (${events.length})` },
              { key: "auctions",  label: "Auktioner" },
              { key: "transfers", label: "Transfers" },
              { key: "season",    label: "Sæson" },
            ].map(f => (
              <button key={f.key} onClick={() => setFeedFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                  ${feedFilter === f.key
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "text-slate-500 hover:text-slate-900 bg-white border-slate-200"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {feedLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-slate-200 border-t-amber-700 rounded-full animate-spin" />
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-20 text-slate-300">
              <p className="text-4xl mb-3">◎</p>
              <p>Ingen aktivitet endnu</p>
              <p className="text-xs mt-2">Start auktioner og handler for at se aktivitet her</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredEvents.map((event, i) => {
                const cfg = EVENT_CONFIG[event.type] || { icon: "●", color: "text-slate-500", label: () => event.type };
                return (
                  <div key={event.id}
                    className={`flex items-start gap-3 px-3 sm:px-4 py-3.5 rounded-xl border transition-all
                      ${i === 0 ? "bg-white border-slate-300" : "bg-white border-slate-200 hover:border-slate-300"}`}>
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 text-sm">
                      {cfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${cfg.color}`}>
                        {cfg.label(event)}
                      </p>
                      {event.rider_name && (
                        <p className="text-slate-500 text-sm mt-0.5">
                          <span
                            className="hover:text-amber-700 cursor-pointer transition-colors"
                            onClick={() => event.rider_id && navigate(`/riders/${event.rider_id}`)}>
                            {event.rider_name}
                          </span>
                          {event.amount > 0 && (
                            <span className="text-amber-700 font-mono ml-2">
                              {event.amount.toLocaleString("da-DK")} CZ$
                            </span>
                          )}
                        </p>
                      )}
                      {event.team_name && event.type !== "season_started" && event.type !== "season_ended" && (
                        <p className="text-slate-400 text-xs mt-0.5">{event.team_name}</p>
                      )}
                    </div>
                    <span className="text-slate-300 text-xs flex-shrink-0 mt-0.5 whitespace-nowrap">{timeAgo(event.created_at)}</span>
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
