import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const EVENT_CONFIG = {
  auction_won:             { icon: "🏆", color: "text-cz-accent-t",  label: (e) => `${e.team_name} vandt auktion` },
  auction_started:         { icon: "⚡", color: "text-cz-2",   label: (e) => `${e.team_name} startede auktion` },
  transfer_accepted:       { icon: "↔",  color: "text-cz-success",  label: (e) => `Transfer gennemført` },
  rider_listed:            { icon: "📋", color: "text-cz-info",   label: (e) => `${e.team_name} satte rytter til salg` },
  season_started:          { icon: "🚀", color: "text-cz-success",  label: (e) => `Sæson ${e.meta?.season_number} startet` },
  season_ended:            { icon: "🏁", color: "text-cz-2",   label: (e) => `Sæson ${e.meta?.season_number} afsluttet` },
  race_results_approved:   { icon: "🏅", color: "text-cz-accent-t", label: (e) => `Resultater godkendt: ${e.meta?.race_name}` },
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

export default function ActivityFeedPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    loadFeed();
    // Subscribe to new events
    const channel = supabase.channel("activity-feed-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_feed" },
        payload => setEvents(prev => [payload.new, ...prev].slice(0, 100)))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function loadFeed() {
    const { data } = await supabase
      .from("activity_feed")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setEvents(data || []);
    setLoading(false);
  }

  const FILTER_TYPES = {
    all:       null,
    auctions:  ["auction_won", "auction_started"],
    transfers: ["transfer_accepted", "rider_listed"],
    season:    ["season_started", "season_ended", "race_results_approved"],
  };

  const filtered = filter === "all"
    ? events
    : events.filter(e => FILTER_TYPES[filter]?.includes(e.type));

  return (
    <div className="max-w-2xl mx-auto px-1 sm:px-0">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-cz-1">Aktivitetsfeed</h1>
        <p className="text-cz-3 text-sm">Hvad sker der i spillet lige nu</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {[
          { key: "all",       label: `Alle (${events.length})` },
          { key: "auctions",  label: "Auktioner" },
          { key: "transfers", label: "Transfers" },
          { key: "season",    label: "Sæson" },
        ].map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${filter === t.key
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-cz-3">
          <p className="text-4xl mb-3">◎</p>
          <p>Ingen aktivitet endnu</p>
          <p className="text-xs mt-2">Start auktioner og handler for at se aktivitet her</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((event, i) => {
            const cfg = EVENT_CONFIG[event.type] || { icon: "●", color: "text-cz-2", label: () => event.type };
            const isFirst = i === 0;
            return (
              <div key={event.id}
                className={`flex items-start gap-3 px-4 py-3.5 rounded-xl border transition-all
                  ${isFirst ? "bg-cz-card border-cz-border" : "bg-cz-card border-cz-border hover:border-cz-border"}`}>

                {/* Icon */}
                <div className="w-8 h-8 rounded-lg bg-cz-subtle flex items-center justify-center flex-shrink-0 text-sm">
                  {cfg.icon}
                </div>

                {/* Content */}
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

                {/* Time */}
                <span className="text-cz-3 text-xs flex-shrink-0 mt-0.5">{timeAgo(event.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
