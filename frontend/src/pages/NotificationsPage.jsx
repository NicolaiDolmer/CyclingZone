import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

const TYPE_CONFIG = {
  bid_received:              { icon: "⚡", color: "text-[#e8c547]", bg: "bg-[#e8c547]/8 border-[#e8c547]/15" },
  bid_placed:                { icon: "⚡", color: "text-[#e8c547]", bg: "bg-[#e8c547]/8 border-[#e8c547]/15" },
  auction_won:               { icon: "🏆", color: "text-green-400",  bg: "bg-green-500/8 border-green-500/15" },
  auction_lost:              { icon: "↩",  color: "text-white/40",   bg: "bg-white/3 border-white/8" },
  auction_outbid:            { icon: "⚠️", color: "text-red-400",    bg: "bg-red-500/8 border-red-500/15" },
  transfer_offer_received:   { icon: "↔",  color: "text-blue-400",   bg: "bg-blue-500/8 border-blue-500/15" },
  transfer_offer_accepted:   { icon: "✅", color: "text-green-400",  bg: "bg-green-500/8 border-green-500/15" },
  transfer_offer_rejected:   { icon: "❌", color: "text-red-400",    bg: "bg-red-500/8 border-red-500/15" },
  transfer_counter:          { icon: "↔",  color: "text-[#e8c547]", bg: "bg-[#e8c547]/8 border-[#e8c547]/15" },
  new_race:                  { icon: "🏁", color: "text-white",      bg: "bg-white/3 border-white/8" },
  season_started:            { icon: "🚀", color: "text-green-400",  bg: "bg-green-500/8 border-green-500/15" },
  season_ended:              { icon: "🏁", color: "text-white",      bg: "bg-white/3 border-white/8" },
  salary_paid:               { icon: "💰", color: "text-orange-400", bg: "bg-orange-500/8 border-orange-500/15" },
  sponsor_paid:              { icon: "💰", color: "text-green-400",  bg: "bg-green-500/8 border-green-500/15" },
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
  return new Date(dateStr).toLocaleDateString("da-DK");
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [markingAll, setMarkingAll] = useState(false);
  const userIdRef = useRef(null); // Use ref so it's always current in async functions

  useEffect(() => {
    loadNotifications();
  }, []);

  // Subscribe to new notifications only (INSERT)
  useEffect(() => {
    if (!userIdRef.current) return;
    const channel = supabase.channel("notifs-page-v2")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userIdRef.current}`,
      }, payload => {
        // Add new notification to top of list
        setNotifications(prev => [payload.new, ...prev]);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [userIdRef.current]);

  async function loadNotifications() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    userIdRef.current = user.id;

    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);

    setNotifications(data || []);
    setLoading(false);
  }

  async function markRead(id) {
    // Update locally immediately
    setNotifications(prev => prev.map(n =>
      n.id === id ? { ...n, is_read: true } : n
    ));
    // Then update in database
    await supabase.from("notifications")
      .update({ is_read: true })
      .eq("id", id);
  }

  async function markAllRead() {
    if (!userIdRef.current) return;
    setMarkingAll(true);
    // Update locally first for instant feedback
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    // Then update all in database
    const { error } = await supabase.from("notifications")
      .update({ is_read: true })
      .eq("user_id", userIdRef.current);
    if (error) {
      console.error("markAllRead error:", error);
      // Re-fetch if something went wrong
      await loadNotifications();
    }
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
    await supabase.from("notifications")
      .delete()
      .eq("user_id", userIdRef.current)
      .eq("is_read", true);
  }

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const filtered = filter === "unread"
    ? notifications.filter(n => !n.is_read)
    : notifications;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Notifikationer</h1>
          <p className="text-white/30 text-sm">
            {unreadCount > 0 ? `${unreadCount} ulæste` : "Alle er læst"}
          </p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <button onClick={markAllRead} disabled={markingAll}
              className="px-3 py-1.5 text-xs text-white/50 hover:text-white
                bg-white/5 hover:bg-white/10 rounded-lg border border-white/5
                transition-all disabled:opacity-50">
              {markingAll ? "Markerer..." : "Marker alle læst"}
            </button>
          )}
          {notifications.some(n => n.is_read) && (
            <button onClick={deleteAllRead}
              className="px-3 py-1.5 text-xs text-white/30 hover:text-red-400
                bg-white/5 hover:bg-red-500/10 rounded-lg border border-white/5
                hover:border-red-500/20 transition-all">
              Slet læste
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {[
          { key: "all",    label: `Alle (${notifications.length})` },
          { key: "unread", label: `Ulæste (${unreadCount})` },
        ].map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${filter === t.key
                ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20"
                : "text-white/40 hover:text-white bg-[#0f0f18] border-white/5"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-white/20">
          <p className="text-4xl mb-3">🔔</p>
          <p>{filter === "unread" ? "Ingen ulæste notifikationer" : "Ingen notifikationer endnu"}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(n => {
            const config = TYPE_CONFIG[n.type] || { icon: "●", color: "text-white/40", bg: "bg-white/3 border-white/8" };
            return (
              <div key={n.id}
                className={`flex items-start gap-3 p-4 rounded-xl border transition-all cursor-pointer
                  ${n.is_read
                    ? "bg-[#0f0f18] border-white/5 opacity-60 hover:opacity-80"
                    : config.bg}`}
                onClick={() => !n.is_read && markRead(n.id)}>

                {/* Icon */}
                <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center
                  text-base flex-shrink-0 mt-0.5">
                  {config.icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${n.is_read ? "text-white/50" : "text-white"}`}>
                    {n.title}
                  </p>
                  <p className="text-white/40 text-xs mt-0.5 leading-relaxed">{n.message}</p>
                  <p className="text-white/20 text-xs mt-1.5">{timeAgo(n.created_at)}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!n.is_read && (
                    <span className="w-2 h-2 rounded-full bg-[#e8c547] flex-shrink-0" />
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); deleteNotif(n.id); }}
                    className="text-white/20 hover:text-white/60 text-lg transition-colors p-1 rounded">
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
