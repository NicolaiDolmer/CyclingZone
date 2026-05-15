import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import RiderLink from "./RiderLink";
import TeamLink from "./TeamLink";

const TYPE_LABEL = { auction: "Auktion", transfer: "Transfer", swap: "Swap", loan: "Lån" };

function SortTh({ children, sortKey, current, dir, onSort, align = "left" }) {
  const active = current === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none py-2 text-${align} transition-colors ${active ? "text-cz-accent-t/80" : "text-cz-3 hover:text-cz-2"}`}>
      {children}{active && <span className="ml-0.5 text-[10px]">{dir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

function DirectionBadge({ direction }) {
  if (direction === "in") return <span className="text-cz-success text-xs font-medium">Køb</span>;
  if (direction === "out") return <span className="text-cz-danger text-xs font-medium">Salg</span>;
  return <span className="text-cz-info text-xs font-medium">Bytte</span>;
}

function RiderCell({ event }) {
  const rider = event.rider;
  if (!rider) return <span className="text-cz-3">—</span>;
  const primary = (
    <RiderLink id={rider.id} className="text-cz-1 hover:text-cz-accent-t">
      {rider.firstname} {rider.lastname}
    </RiderLink>
  );
  if (event.type === "swap" && event.rider_swapped) {
    return (
      <span className="text-cz-2">
        {primary}
        <span className="text-cz-3 mx-1">↔</span>
        <RiderLink id={event.rider_swapped.id} className="text-cz-1 hover:text-cz-accent-t">
          {event.rider_swapped.firstname} {event.rider_swapped.lastname}
        </RiderLink>
      </span>
    );
  }
  return primary;
}

export default function TeamTransferHistoryTab({ teamId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [seasonFilter, setSeasonFilter] = useState("current");
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [currentSeason, setCurrentSeason] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const [historyRes, seasonRes] = await Promise.all([
          fetch(`${import.meta.env.VITE_API_URL}/api/teams/${teamId}/transfer-history`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }),
          supabase.from("seasons").select("number").eq("status", "active").maybeSingle(),
        ]);
        if (!historyRes.ok) throw new Error("Kunne ikke hente transferhistorik");
        const data = await historyRes.json();
        if (cancelled) return;
        setEvents(data);
        setCurrentSeason(seasonRes?.data?.number ?? null);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [teamId]);

  const availableSeasons = useMemo(() => {
    const set = new Set(events.map((e) => e.season_number).filter((n) => n != null));
    return [...set].sort((a, b) => b - a);
  }, [events]);

  const filtered = useMemo(() => {
    let list = events;
    if (seasonFilter === "current" && currentSeason != null) {
      list = list.filter((e) => e.season_number === currentSeason);
    } else if (seasonFilter !== "all" && seasonFilter !== "current") {
      const n = Number(seasonFilter);
      list = list.filter((e) => e.season_number === n);
    }
    const sorted = [...list].sort((a, b) => {
      let av, bv;
      if (sortKey === "date") { av = new Date(a.date).getTime(); bv = new Date(b.date).getTime(); }
      else { av = a.amount ?? 0; bv = b.amount ?? 0; }
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return sorted;
  }, [events, seasonFilter, currentSeason, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  if (loading) return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );
  if (error) return (
    <div className="bg-cz-danger-bg border border-cz-danger/30 rounded-xl p-4">
      <p className="text-cz-danger text-sm">{error}</p>
    </div>
  );

  const noFilteredResults = filtered.length === 0 && events.length > 0;
  const noResults = events.length === 0;

  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-cz-1 font-semibold text-sm">Transferhistorik</h2>
        <select value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)}
          className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-1.5 text-cz-1 text-sm focus:outline-none focus:border-cz-accent">
          <option value="all">Alle sæsoner</option>
          {currentSeason != null && (
            <option value="current">Sæson {currentSeason} (denne)</option>
          )}
          {availableSeasons.filter((n) => n !== currentSeason).map((n) => (
            <option key={n} value={n}>Sæson {n}</option>
          ))}
        </select>
      </div>

      {noResults && (
        <p className="text-cz-3 text-sm py-4">Holdet har ingen transferhistorik endnu.</p>
      )}

      {noFilteredResults && (
        <p className="text-cz-3 text-sm py-4">Ingen transfers fundet i den valgte sæson.</p>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-cz-border">
                <SortTh sortKey="date" current={sortKey} dir={sortDir} onSort={handleSort}>Dato</SortTh>
                <th className="text-left py-2 text-cz-3">Type</th>
                <th className="text-left py-2 text-cz-3">Retning</th>
                <th className="text-left py-2 text-cz-3">Rytter</th>
                <th className="text-left py-2 text-cz-3">Modpart</th>
                <SortTh sortKey="amount" current={sortKey} dir={sortDir} onSort={handleSort} align="right">Beløb</SortTh>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev) => (
                <tr key={ev.id} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle/40">
                  <td className="py-2 text-cz-2 whitespace-nowrap">
                    {ev.date ? new Date(ev.date).toLocaleDateString("da-DK") : "—"}
                  </td>
                  <td className="py-2 text-cz-2">{TYPE_LABEL[ev.type] ?? ev.type}</td>
                  <td className="py-2"><DirectionBadge direction={ev.direction} /></td>
                  <td className="py-2"><RiderCell event={ev} /></td>
                  <td className="py-2">
                    {ev.counterparty?.id ? (
                      <TeamLink id={ev.counterparty.id} className="text-cz-1 hover:text-cz-accent-t">
                        {ev.counterparty.name}
                        {ev.counterparty.is_ai && <span className="ml-1 text-cz-3 text-[10px]">(AI)</span>}
                      </TeamLink>
                    ) : <span className="text-cz-3">—</span>}
                  </td>
                  <td className="py-2 text-right font-mono whitespace-nowrap">
                    {ev.amount > 0
                      ? <span className={ev.direction === "in" ? "text-cz-success" : ev.direction === "out" ? "text-cz-danger" : "text-cz-2"}>
                          {ev.direction === "out" ? "-" : ev.direction === "in" ? "+" : ""}{ev.amount.toLocaleString("da-DK")} CZ$
                        </span>
                      : <span className="text-cz-3">{ev.type === "swap" ? "0 CZ$" : "—"}</span>}
                    {ev.type === "loan" && <span className="text-cz-3 ml-1">(lån)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
