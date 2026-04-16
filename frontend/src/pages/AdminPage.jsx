import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

function AdminSection({ title, children }) {
  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-4">
      <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
        <span className="w-1 h-4 bg-red-400 rounded-full" />
        {title}
      </h2>
      {children}
    </div>
  );
}

export default function AdminPage() {
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("success");
  const [seasons, setSeasons] = useState([]);
  const [races, setRaces] = useState([]);
  const [teams, setTeams] = useState([]);
  const [seasonForm, setSeasonForm] = useState({ number: "", race_days_total: 60 });
  const [raceForm, setRaceForm] = useState({ season_id: "", name: "", race_type: "stage_race", stages: 21, start_date: "", prize_pool: 1000 });
  const [importRaceId, setImportRaceId] = useState("");
  const [importStage, setImportStage] = useState(1);
  const [loading, setLoading] = useState({});

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [s, r, t] = await Promise.all([
      supabase.from("seasons").select("*").order("number", { ascending: false }),
      supabase.from("races").select("*").order("start_date"),
      supabase.from("teams").select("id, name, balance, division, is_ai").eq("is_ai", false).order("name"),
    ]);
    setSeasons(s.data || []);
    setRaces(r.data || []);
    setTeams(t.data || []);
  }

  function setLoad(key, val) { setLoading(l => ({ ...l, [key]: val })); }

  function showMsg(text, type = "success") {
    setMsg(text); setMsgType(type);
    setTimeout(() => setMsg(""), 4000);
  }

  async function getAuthHeader() {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
  }

  async function handleCreateSeason(e) {
    e.preventDefault();
    setLoad("season", true);
    const headers = await getAuthHeader();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/seasons`, {
      method: "POST", headers,
      body: JSON.stringify({ number: parseInt(seasonForm.number), race_days_total: parseInt(seasonForm.race_days_total) }),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ Sæson ${data.number} oprettet — ID: ${data.id}`); loadData(); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("season", false);
  }

  async function handleStartSeason(seasonId) {
    setLoad(`start_${seasonId}`, true);
    const headers = await getAuthHeader();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/seasons/${seasonId}/start`, { method: "POST", headers });
    const data = await res.json();
    if (res.ok) { showMsg("✅ Sæson startet — sponsorpenge udbetalt til alle holds!"); loadData(); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad(`start_${seasonId}`, false);
  }

  async function handleEndSeason(seasonId) {
    if (!confirm("Er du sikker på du vil afslutte sæsonen? Dette kører op/nedrykning og trækker lønninger.")) return;
    setLoad(`end_${seasonId}`, true);
    const headers = await getAuthHeader();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/seasons/${seasonId}/end`, { method: "POST", headers });
    const data = await res.json();
    if (res.ok) { showMsg("✅ Sæson afsluttet — op/nedrykning kørt, lønninger trukket!"); loadData(); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad(`end_${seasonId}`, false);
  }

  async function handleCreateRace(e) {
    e.preventDefault();
    setLoad("race", true);
    const headers = await getAuthHeader();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/races`, {
      method: "POST", headers,
      body: JSON.stringify({ ...raceForm, stages: parseInt(raceForm.stages), prize_pool: parseInt(raceForm.prize_pool) }),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ Løb "${data.name}" tilføjet`); loadData(); setRaceForm(f => ({ ...f, name: "", start_date: "" })); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("race", false);
  }

  async function handleImportResults(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!importRaceId) { showMsg("❌ Vælg et løb først", "error"); return; }
    setLoad("import", true);
    showMsg("⏳ Importerer resultater...", "info");
    const { data: { session } } = await supabase.auth.getSession();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("race_id", importRaceId);
    formData.append("stage_number", importStage);
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/import-results`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
    });
    const data = await res.json();
    if (res.ok) showMsg(`✅ ${data.records_imported} resultater importeret — ${data.teams_paid} holds fik præmiepenge`);
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("import", false);
    e.target.value = "";
  }

  async function handleSyncUCI() {
    setLoad("sync", true);
    const headers = await getAuthHeader();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/sync-uci`, { method: "POST", headers });
    const data = await res.json();
    if (res.ok) showMsg(`✅ Synkroniseret — ${data.updated} ryttere opdateret`);
    else showMsg(`❌ ${data.error || "Konfigurér GOOGLE_SHEETS_CSV_URL i Railway environment variables"}`, "error");
    setLoad("sync", false);
  }

  async function resetForRealStart() {
    if (!confirm("⚠️ Dette sletter AL testdata og nulstiller alle holds. Er du helt sikker?")) return;
    setLoad("reset", true);
    const sql = `
      TRUNCATE seasons, races, race_results, auctions, auction_bids,
        transfer_listings, transfer_offers, season_standings,
        finance_transactions, notifications RESTART IDENTITY CASCADE;
      UPDATE teams SET balance = 500, division = 3;
      UPDATE riders SET team_id = NULL, salary = 0;
    `;
    showMsg("⚠️ Kør reset SQL manuelt i Supabase SQL Editor", "error");
    setLoad("reset", false);
  }

  const statusColor = { upcoming: "text-white/40", active: "text-green-400", completed: "text-white/20" };
  const statusLabel = { upcoming: "Kommende", active: "Aktiv", completed: "Afsluttet" };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin Panel</h1>
        <p className="text-white/30 text-sm">Sæsonstyring, dataimport og løbskalender</p>
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border
          ${msgType === "error" ? "bg-red-500/10 text-red-400 border-red-500/20" :
            msgType === "info" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
            "bg-green-500/10 text-green-400 border-green-500/20"}`}>
          {msg}
        </div>
      )}

      {/* Seasons overview */}
      <AdminSection title="Sæsoner">
        {seasons.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            {seasons.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-white/3 rounded-lg px-4 py-3">
                <div>
                  <span className="text-white font-medium text-sm">Sæson {s.number}</span>
                  <span className={`ml-3 text-xs ${statusColor[s.status]}`}>{statusLabel[s.status]}</span>
                  <p className="text-white/20 text-xs mt-0.5 font-mono">{s.id}</p>
                </div>
                <div className="flex gap-2">
                  {s.status === "upcoming" && (
                    <button onClick={() => handleStartSeason(s.id)} disabled={loading[`start_${s.id}`]}
                      className="px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20
                        rounded-lg text-xs font-medium hover:bg-green-500/20 transition-all disabled:opacity-50">
                      {loading[`start_${s.id}`] ? "..." : "▶ Start sæson"}
                    </button>
                  )}
                  {s.status === "active" && (
                    <button onClick={() => handleEndSeason(s.id)} disabled={loading[`end_${s.id}`]}
                      className="px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20
                        rounded-lg text-xs font-medium hover:bg-red-500/20 transition-all disabled:opacity-50">
                      {loading[`end_${s.id}`] ? "..." : "⏹ Afslut sæson"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleCreateSeason} className="flex gap-3 flex-wrap">
          <div>
            <label className="block text-white/30 text-xs mb-1">Sæsonnummer</label>
            <input type="number" required placeholder="1" value={seasonForm.number}
              onChange={e => setSeasonForm(f => ({ ...f, number: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm w-28 focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Løbsdage i alt</label>
            <input type="number" value={seasonForm.race_days_total}
              onChange={e => setSeasonForm(f => ({ ...f, race_days_total: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm w-28 focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={loading.season}
              className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50">
              {loading.season ? "..." : "Opret sæson"}
            </button>
          </div>
        </form>
      </AdminSection>

      {/* Race calendar */}
      <AdminSection title="Løbskalender">
        {races.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-lg border border-white/5">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-white/5">
                <th className="px-3 py-2 text-left text-white/30">Løb</th>
                <th className="px-3 py-2 text-left text-white/30">Dato</th>
                <th className="px-3 py-2 text-left text-white/30">Type</th>
                <th className="px-3 py-2 text-right text-white/30">Præmier</th>
                <th className="px-3 py-2 text-right text-white/30">ID</th>
              </tr></thead>
              <tbody>
                {races.map(r => (
                  <tr key={r.id} className="border-b border-white/4 hover:bg-white/3 cursor-pointer"
                    onClick={() => { setImportRaceId(r.id); showMsg(`✅ Valgt løb: ${r.name}`, "info"); }}>
                    <td className="px-3 py-2 text-white font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-white/50">{r.start_date ? new Date(r.start_date).toLocaleDateString("da-DK") : "—"}</td>
                    <td className="px-3 py-2 text-white/50">{r.race_type === "stage_race" ? `Etapeløb (${r.stages})` : "Enkeltdags"}</td>
                    <td className="px-3 py-2 text-right text-[#e8c547] font-mono">{r.prize_pool?.toLocaleString("da-DK")}</td>
                    <td className="px-3 py-2 text-right text-white/20 font-mono text-[10px]">{r.id.slice(0,8)}...</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form onSubmit={handleCreateRace} className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-white/30 text-xs mb-1">Sæson</label>
            <select value={raceForm.season_id} onChange={e => setRaceForm(f => ({ ...f, season_id: e.target.value }))} required
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50">
              <option value="">Vælg sæson...</option>
              {seasons.map(s => <option key={s.id} value={s.id}>Sæson {s.number} ({s.status})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Løbsnavn</label>
            <input type="text" required placeholder="Tour de France" value={raceForm.name}
              onChange={e => setRaceForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Type</label>
            <select value={raceForm.race_type} onChange={e => setRaceForm(f => ({ ...f, race_type: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50">
              <option value="stage_race">Etapeløb</option>
              <option value="single">Enkeltdagsløb</option>
            </select>
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Antal etaper</label>
            <input type="number" min={1} value={raceForm.stages}
              onChange={e => setRaceForm(f => ({ ...f, stages: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Startdato</label>
            <input type="date" value={raceForm.start_date}
              onChange={e => setRaceForm(f => ({ ...f, start_date: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Præmiepulje (CZ$)</label>
            <input type="number" min={0} value={raceForm.prize_pool}
              onChange={e => setRaceForm(f => ({ ...f, prize_pool: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div className="col-span-2">
            <button type="submit" disabled={loading.race}
              className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50">
              {loading.race ? "..." : "Tilføj løb"}
            </button>
          </div>
        </form>
      </AdminSection>

      {/* Import results */}
      <AdminSection title="Importer løbsresultater (PCM Excel)">
        <div className="flex gap-3 mb-3 flex-wrap">
          <div className="flex-1">
            <label className="block text-white/30 text-xs mb-1">Vælg løb (klik løb i tabellen ovenfor)</label>
            <select value={importRaceId} onChange={e => setImportRaceId(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50">
              <option value="">Vælg løb...</option>
              {races.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Etape nummer</label>
            <input type="number" min={1} value={importStage}
              onChange={e => setImportStage(parseInt(e.target.value))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm w-24 focus:outline-none focus:border-[#e8c547]/50" />
          </div>
        </div>
        <label className="block cursor-pointer">
          <div className="border-2 border-dashed border-white/10 rounded-xl p-6 text-center hover:border-[#e8c547]/30 transition-all">
            <p className="text-white/30 text-sm">Klik for at uploade PCM Excel-fil (.xlsx)</p>
            <p className="text-white/20 text-xs mt-1">Stage results, General results, Points, Mountain, Team results, Young results</p>
          </div>
          <input type="file" accept=".xlsx" className="hidden" onChange={handleImportResults} disabled={!importRaceId} />
        </label>
      </AdminSection>

      {/* Teams overview */}
      <AdminSection title="Holds oversigt">
        <div className="overflow-hidden rounded-lg border border-white/5">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-white/5">
              <th className="px-3 py-2 text-left text-white/30">Hold</th>
              <th className="px-3 py-2 text-right text-white/30">Balance</th>
              <th className="px-3 py-2 text-right text-white/30">Division</th>
            </tr></thead>
            <tbody>
              {teams.map(t => (
                <tr key={t.id} className="border-b border-white/4">
                  <td className="px-3 py-2 text-white font-medium">{t.name}</td>
                  <td className="px-3 py-2 text-right text-[#e8c547] font-mono">{t.balance?.toLocaleString("da-DK")} CZ$</td>
                  <td className="px-3 py-2 text-right text-white/50">{t.division}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminSection>

      {/* Sync & Reset */}
      <AdminSection title="Synkronisering og nulstilling">
        <div className="flex gap-3 flex-wrap">
          <button onClick={handleSyncUCI} disabled={loading.sync}
            className="px-4 py-2 bg-white/10 text-white font-medium rounded-lg text-sm
              hover:bg-white/15 border border-white/10 disabled:opacity-50">
            {loading.sync ? "Synkroniserer..." : "🔄 Sync UCI Points fra Google Sheets"}
          </button>
          <button onClick={resetForRealStart} disabled={loading.reset}
            className="px-4 py-2 bg-red-500/10 text-red-400 font-medium rounded-lg text-sm
              hover:bg-red-500/20 border border-red-500/20 disabled:opacity-50">
            {loading.reset ? "..." : "⚠️ Nulstil testdata"}
          </button>
        </div>
      </AdminSection>
    </div>
  );
}
