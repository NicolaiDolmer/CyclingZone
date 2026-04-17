import { useState, useEffect } from "react";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

export default function WatchlistPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [noteText, setNoteText] = useState("");

  useEffect(() => { loadWatchlist(); }, []);

  async function loadWatchlist() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user.id);
    const { data } = await supabase
      .from("rider_watchlist")
      .select(`id, note, created_at,
        rider:rider_id(id, firstname, lastname, uci_points, is_u25,
          team_id, ${STATS.join(", ")},
          team:team_id(name))`)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setEntries(data || []);
    setLoading(false);
  }

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
      body: JSON.stringify({ rider_id: rider.id, starting_price: Math.max(rider.uci_points || 1, 1) }),
    });
    if (res.ok) navigate("/auctions");
    else { const d = await res.json(); alert(d.error); }
  }

  const riderFilters = useClientRiderFilters(entries.map(e => e.rider));
  const filteredRiders = new Set(riderFilters.filtered.map(r => r.id));
  const filtered = entries.filter(e => filteredRiders.has(e.rider.id))
    .sort((a, b) => {
      const ai = riderFilters.filtered.findIndex(r => r.id === a.rider.id);
      const bi = riderFilters.filtered.findIndex(r => r.id === b.rider.id);
      return ai - bi;
    });

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Talentspejder</h1>
          <p className="text-white/30 text-sm">
            {entries.length} ryttere på din ønskeliste — kun synlig for dig
          </p>
        </div>
        <button onClick={() => navigate("/riders")}
          className="px-3 py-1.5 bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20
            rounded-lg text-xs font-medium hover:bg-[#e8c547]/20 transition-all">
          + Tilføj ryttere
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-20 text-white/20">
          <p className="text-5xl mb-4">⭐</p>
          <p className="text-lg font-medium text-white/30">Din ønskeliste er tom</p>
          <p className="text-sm mt-2">Klik på ⭐ ved siden af en rytter i rytterdatabasen for at tilføje dem her</p>
          <button onClick={() => navigate("/riders")}
            className="mt-5 px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060]">
            Gå til Ryttere
          </button>
        </div>
      ) : (
        <>
          <RiderFilters filters={riderFilters.filters} onChange={riderFilters.onChange} onReset={riderFilters.onReset} showTeamFilter={false} />

          {/* Table */}
          <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="px-3 py-3 text-left text-white/30 font-medium uppercase tracking-wider">Rytter</th>
                    <th className="px-3 py-3 text-left text-white/30 font-medium uppercase tracking-wider hidden sm:table-cell">Hold</th>
                    <th className="px-3 py-3 text-right text-white/30 font-medium">UCI</th>
                    {STAT_LABELS.map(l => (
                      <th key={l} className="px-1.5 py-3 text-center text-white/20 font-medium w-10">{l}</th>
                    ))}
                    <th className="px-3 py-3 text-center text-white/20">Note</th>
                    <th className="px-3 py-3 text-center text-white/20">Handling</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(entry => {
                    const r = entry.rider;
                    const isFree = !r.team_id;
                    return (
                      <tr key={entry.id} className="border-b border-white/4 hover:bg-white/3">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <button onClick={() => navigate(`/riders/${r.id}`)}
                              className="text-white text-sm font-medium hover:text-[#e8c547] transition-colors text-left">
                              {r.firstname} {r.lastname}
                            </button>
                            {r.is_u25 && (
                              <span className="text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">U25</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          {isFree
                            ? <span className="text-[#e8c547]/70 text-xs">Fri agent</span>
                            : <span className="text-white/40 text-xs">{r.team?.name}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[#e8c547] font-mono font-bold">
                          {r.uci_points?.toLocaleString("da-DK")}
                        </td>
                        {STATS.map(key => (
                          <td key={key} className="px-1.5 py-2.5 text-center">
                            <span className={`font-mono ${r[key] >= 80 ? "text-[#e8c547] font-bold" : "text-white/40"}`}>
                              {r[key] || "—"}
                            </span>
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-center max-w-28">
                          {editingNote === entry.id ? (
                            <div className="flex gap-1">
                              <input type="text" value={noteText} onChange={e => setNoteText(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && saveNote(entry.id)}
                                className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1
                                  text-white text-xs focus:outline-none focus:border-[#e8c547]/50 w-20"
                                autoFocus placeholder="Note..." />
                              <button onClick={() => saveNote(entry.id)}
                                className="text-green-400 text-xs px-1">✓</button>
                            </div>
                          ) : (
                            <button onClick={() => { setEditingNote(entry.id); setNoteText(entry.note || ""); }}
                              className="text-white/20 hover:text-white/60 text-xs truncate max-w-24 block mx-auto transition-colors">
                              {entry.note || "+ note"}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1.5">
                            {isFree && (
                              <button onClick={() => startAuction(r)}
                                className="px-2 py-1 bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20
                                  rounded text-xs hover:bg-[#e8c547]/20 transition-all whitespace-nowrap">
                                Start auktion
                              </button>
                            )}
                            <button onClick={() => removeFromWatchlist(r.id)}
                              className="px-2 py-1 bg-red-500/10 text-red-400 border border-red-500/20
                                rounded text-xs hover:bg-red-500/20 transition-all">
                              ★ Fjern
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
