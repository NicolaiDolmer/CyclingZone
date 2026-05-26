import { useState, useEffect } from "react";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import { statBg } from "../lib/statBg";
import { Flag } from "../components/Flag";
import { formatCz, getRiderMarketValue } from "../lib/marketValues";
import { formatNumber } from "../lib/intl";
import PotentialeStars from "../components/PotentialeStars";
import WatchlistStar from "../components/WatchlistStar";
import { CompareToggle, CompareBar, MAX_COMPARE } from "../components/CompareSelection";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

function SortTh({ children, sortKey, sort, sortDir, onSort, className = "" }) {
  const active = sort === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none transition-colors ${active ? "text-cz-accent-t/80" : "text-cz-3 hover:text-cz-2"} ${className}`}>
      {children}{active && <span className="ms-0.5 text-[10px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

const PAGE_SIZE = 50;

export default function WatchlistPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [page, setPage] = useState(1);
  const [compareIds, setCompareIds] = useState([]);

  function toggleCompare(riderId) {
    setCompareIds(prev => {
      if (prev.includes(riderId)) return prev.filter(id => id !== riderId);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, riderId];
    });
  }

  async function loadWatchlist() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user.id);
    const { data } = await supabase
      .from("rider_watchlist")
      .select(`id, note, created_at,
        rider:rider_id(id, firstname, lastname, birthdate, uci_points, is_u25,
          salary, team_id, nationality_code, prize_earnings_bonus, potentiale, ${STATS.join(", ")},
          team:team_id(name))`)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setEntries(data || []);
    setLoading(false);
  }

  useEffect(() => { loadWatchlist(); }, []);

  async function removeFromWatchlist(riderId) {
    await supabase.from("rider_watchlist")
      .delete().eq("user_id", userId).eq("rider_id", riderId);
    setEntries(prev => prev.filter(e => e.rider.id !== riderId));
  }

  async function saveNote(entryId) {
    await supabase.from("rider_watchlist")
      .update({ note: noteText }).eq("id", entryId);
    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, note: noteText } : e));
    setEditingNote(null);
  }

  async function startAuction(rider) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/auctions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: rider.id, starting_price: getRiderMarketValue(rider) }),
    });
    if (res.ok) {
      // Vis squad-cap-warning hvis bud bringer manager over max (#29 — non-blocking).
      const data = await res.json().catch(() => ({}));
      const warning = (data.warnings || []).find(w => w?.code === "squad_capacity_exceeded");
      if (warning) {
        const fine = warning.finePerRider * warning.exceedBy;
        const points = warning.penaltyPointsPerRider * warning.exceedBy;
        alert(`Auktion startet.\n\nOBS: leder nu auktioner svarende til ${warning.totalAfter} ryttere (max ${warning.maxRiders}). ` +
          `Hvis du stadig er ${warning.exceedBy} over ved vindue-luk: auto-salg + ${formatNumber(fine)} CZ$ bøde + ${points} fradrag-points.`);
      }
      navigate("/auctions");
    } else { const d = await res.json(); alert(d.error); }
  }

  const riderFilters = useClientRiderFilters(entries.map(e => e.rider));
  const filteredRiders = new Set(riderFilters.filtered.map(r => r.id));
  const sort = riderFilters.filters.sort;
  const sortDir = riderFilters.filters.sort_dir;
  function handleSort(key) {
    if (sort === key) riderFilters.onChange("sort_dir", sortDir === "desc" ? "asc" : "desc");
    else { riderFilters.onChange("sort", key); riderFilters.onChange("sort_dir", "desc"); }
    setPage(1);
  }
  const filtered = entries.filter(e => filteredRiders.has(e.rider.id))
    .sort((a, b) => {
      const ai = riderFilters.filtered.findIndex(r => r.id === a.rider.id);
      const bi = riderFilters.filtered.findIndex(r => r.id === b.rider.id);
      return ai - bi;
    });
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => { setPage(1); }, [riderFilters.filters]);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">Talentspejder</h1>
          <p className="text-cz-3 text-sm">
            {entries.length} ryttere på din ønskeliste — kun synlig for dig
          </p>
        </div>
        <button onClick={() => navigate("/riders")}
          className="px-3 py-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
            rounded-lg text-xs font-medium hover:bg-cz-accent/10 transition-all">
          + Tilføj ryttere
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-20 text-cz-3">
          <p className="text-5xl mb-4">⭐</p>
          <p className="text-lg font-medium text-cz-3">Din ønskeliste er tom</p>
          <p className="text-sm mt-2">Klik på ⭐ ved siden af en rytter i rytterdatabasen for at tilføje dem her</p>
          <button onClick={() => navigate("/riders")}
            className="mt-5 px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110">
            Gå til Ryttere
          </button>
        </div>
      ) : (
        <>
          <RiderFilters filters={riderFilters.filters} onChange={riderFilters.onChange} onReset={riderFilters.onReset} showTeamFilter={false} nationalities={riderFilters.nationalities} />

          {/* Table */}
          <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
            <div className="overflow-auto max-h-[calc(100vh-220px)]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-20 bg-cz-card shadow-sm">
                  <tr className="border-b border-cz-border">
                    <SortTh sortKey="firstname" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-3 py-3 text-left font-medium uppercase tracking-wider">Rytter</SortTh>
                    <th className="px-1 py-3 w-8" title="Vælg til sammenligning">⇄</th>
                    <th className="px-2 py-3 w-8" />
                    <th className="px-3 py-3 text-left text-cz-3 font-medium uppercase tracking-wider hidden sm:table-cell">Hold</th>
                    <SortTh sortKey="uci_points" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-3 py-3 text-right font-medium">Værdi</SortTh>
                    <SortTh sortKey="salary" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-3 py-3 text-right font-medium">Løn</SortTh>
                    <SortTh sortKey="potentiale" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-3 py-3 text-left font-medium">Potentiale</SortTh>
                    {STATS.map((key, i) => (
                      <SortTh key={key} sortKey={key} sort={sort} sortDir={sortDir} onSort={handleSort}
                        className="px-1.5 py-3 text-center font-medium w-10">{STAT_LABELS[i]}</SortTh>
                    ))}
                    <th className="px-3 py-3 text-center text-cz-3">Note</th>
                    <th className="px-3 py-3 text-center text-cz-3">Handling</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(entry => {
                    const r = entry.rider;
                    const isFree = !r.team_id;
                    const compareActive = compareIds.includes(r.id);
                    return (
                      <tr key={entry.id} className={`border-b border-cz-border hover:bg-cz-subtle ${compareActive ? "bg-cz-accent/[0.04]" : ""}`}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            {r.nationality_code && <Flag code={r.nationality_code} className="flex-shrink-0" />}
                            <RiderLink id={r.id}
                              className="text-cz-1 text-sm font-medium hover:text-cz-accent-t transition-colors text-left">
                              {r.firstname} {r.lastname}
                            </RiderLink>
                            {r.is_u25 && (
                              <span className="text-[9px] uppercase bg-cz-info-bg0/20 text-cz-info px-1.5 py-0.5 rounded">U25</span>
                            )}
                          </div>
                        </td>
                        <td className="px-1 py-2.5 w-8">
                          <CompareToggle active={compareActive}
                            disabled={compareIds.length >= MAX_COMPARE}
                            onToggle={() => toggleCompare(r.id)} />
                        </td>
                        <td className="px-2 py-2.5 w-8">
                          <WatchlistStar active onToggle={() => removeFromWatchlist(r.id)} />
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          {isFree
                            ? <span className="text-cz-accent-t/70 text-xs">Fri agent</span>
                            : <span className="text-cz-2 text-xs">{r.team?.name}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-cz-accent-t font-mono font-bold">
                          {formatCz(getRiderMarketValue(r)).replace(" CZ$", "")}
                        </td>
                        <td className="px-3 py-2.5 text-right text-cz-2 font-mono">
                          {r.salary ? formatNumber(r.salary) : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <PotentialeStars value={r.potentiale} birthdate={r.birthdate} />
                        </td>
                        {STATS.map(key => (
                          <td key={key} className="px-1.5 py-2.5 text-center">
                            <span className={`inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded ${statBg(r[key] || 0)}`}>
                              {r[key] || "—"}
                            </span>
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-center max-w-28">
                          {editingNote === entry.id ? (
                            <div className="flex gap-1">
                              <input type="text" value={noteText} onChange={e => setNoteText(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && saveNote(entry.id)}
                                className="flex-1 bg-cz-subtle border border-cz-border rounded px-2 py-1
                                  text-cz-1 text-xs focus:outline-none focus:border-cz-accent w-20"
                                autoFocus placeholder="Note..." />
                              <button onClick={() => saveNote(entry.id)}
                                className="text-cz-success text-xs px-1">✓</button>
                            </div>
                          ) : (
                            <button onClick={() => { setEditingNote(entry.id); setNoteText(entry.note || ""); }}
                              className="text-cz-3 hover:text-cz-2 text-xs truncate max-w-24 block mx-auto transition-colors">
                              {entry.note || "+ note"}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1.5">
                            {isFree ? (
                              <button onClick={() => startAuction(r)}
                                className="px-2 py-1 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
                                  rounded text-xs hover:bg-cz-accent/10 transition-all whitespace-nowrap">
                                Start auktion
                              </button>
                            ) : (
                              <span className="text-cz-3 text-xs">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
            <span className="text-cz-3 text-xs">
              Viser {total === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, total)} af {formatNumber(total)}
            </span>
            <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
              <button disabled={safePage <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
                  hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed">
                ← Forrige
              </button>
              <button disabled={safePage >= pageCount}
                onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
                  hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed">
                Næste →
              </button>
            </div>
          </div>
        </>
      )}

      <CompareBar ids={compareIds} onClear={() => setCompareIds([])} />
    </div>
  );
}
