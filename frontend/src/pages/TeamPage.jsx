// TeamPage.jsx
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

export function TeamPage() {
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [tab, setTab] = useState("squad"); // squad | finances

  useEffect(() => { loadTeam(); }, []);

  async function loadTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams").select("*").eq("user_id", user.id).single();
    if (!t) return;
    setTeam(t);

    const [ridersRes, finRes] = await Promise.all([
      supabase.from("riders")
        .select("id, firstname, lastname, uci_points, salary, is_u25, " + STATS.join(", "))
        .eq("team_id", t.id)
        .order("uci_points", { ascending: false }),
      supabase.from("finance_transactions")
        .select("*").eq("team_id", t.id)
        .order("created_at", { ascending: false }).limit(30),
    ]);
    setRiders(ridersRes.data || []);
    setTransactions(finRes.data || []);
  }

  const totalSalary = riders.reduce((s, r) => s + (r.salary || 0), 0);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">{team?.name || "Mit Hold"}</h1>
        <div className="flex gap-4 mt-1">
          <span className="text-[#e8c547] font-mono text-sm">
            {team?.balance?.toLocaleString("da-DK")} pts
          </span>
          <span className="text-white/30 text-sm">
            Løn pr sæson: {totalSalary.toLocaleString("da-DK")} pts
          </span>
          <span className="text-white/30 text-sm">Division {team?.division}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {[{ key: "squad", label: "Trup" }, { key: "finances", label: "Økonomi" }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all
              ${tab === t.key
                ? "bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20"
                : "text-white/40 hover:text-white bg-[#0f0f18] border border-white/5"}`}>
            {t.label} {t.key === "squad" && `(${riders.length})`}
          </button>
        ))}
      </div>

      {tab === "squad" && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-3 py-3 text-left text-white/30 font-medium uppercase tracking-wider">Rytter</th>
                  <th className="px-3 py-3 text-right text-white/30 font-medium">UCI</th>
                  <th className="px-3 py-3 text-right text-white/30 font-medium">Løn</th>
                  {STAT_LABELS.map(l => (
                    <th key={l} className="px-1.5 py-3 text-center text-white/20 font-medium w-10">{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riders.map(r => (
                  <tr key={r.id} className="border-b border-white/4 hover:bg-white/3">
                    <td className="px-3 py-2.5">
                      <span className="text-white text-sm font-medium">
                        {r.firstname} {r.lastname}
                      </span>
                      {r.is_u25 && (
                        <span className="ml-2 text-[9px] uppercase bg-blue-500/20
                          text-blue-400 px-1.5 py-0.5 rounded">U25</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[#e8c547] font-mono text-sm">
                      {r.uci_points?.toLocaleString("da-DK")}
                    </td>
                    <td className="px-3 py-2.5 text-right text-white/40 font-mono text-xs">
                      {r.salary || 0}
                    </td>
                    {STATS.map(key => (
                      <td key={key} className="px-1.5 py-2.5 text-center">
                        <span className={`font-mono ${r[key] >= 80 ? "text-[#e8c547]" : "text-white/40"}`}>
                          {r[key] || "—"}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "finances" && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left text-white/30 font-medium uppercase tracking-wider text-xs">Dato</th>
                <th className="px-4 py-3 text-left text-white/30 font-medium uppercase tracking-wider text-xs">Beskrivelse</th>
                <th className="px-4 py-3 text-right text-white/30 font-medium uppercase tracking-wider text-xs">Beløb</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id} className="border-b border-white/4 hover:bg-white/3">
                  <td className="px-4 py-2.5 text-white/30 text-xs">
                    {new Date(t.created_at).toLocaleDateString("da-DK")}
                  </td>
                  <td className="px-4 py-2.5 text-white/60">{t.description}</td>
                  <td className={`px-4 py-2.5 text-right font-mono font-bold
                    ${t.amount > 0 ? "text-green-400" : "text-red-400"}`}>
                    {t.amount > 0 ? "+" : ""}{t.amount?.toLocaleString("da-DK")} pts
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

export default TeamPage;
