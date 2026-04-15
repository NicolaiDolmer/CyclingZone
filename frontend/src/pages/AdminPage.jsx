import { useState } from "react";
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
  const [syncMsg, setSyncMsg] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [seasonForm, setSeasonForm] = useState({ number: "", race_days_total: 60 });
  const [raceForm, setRaceForm] = useState({
    season_id: "", name: "", race_type: "stage_race",
    stages: 1, start_date: "", prize_pool: 0,
  });
  const [loading, setLoading] = useState({});

  function setLoad(key, val) {
    setLoading(l => ({ ...l, [key]: val }));
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
      body: JSON.stringify({ number: parseInt(seasonForm.number), race_days_total: seasonForm.race_days_total }),
    });
    const data = await res.json();
    setSyncMsg(res.ok ? `✅ Sæson ${data.number} oprettet` : `❌ ${data.error}`);
    setLoad("season", false);
  }

  async function handleCreateRace(e) {
    e.preventDefault();
    setLoad("race", true);
    const headers = await getAuthHeader();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/races`, {
      method: "POST", headers,
      body: JSON.stringify({
        ...raceForm,
        stages: parseInt(raceForm.stages),
        prize_pool: parseInt(raceForm.prize_pool),
      }),
    });
    const data = await res.json();
    setSyncMsg(res.ok ? `✅ Løb "${data.name}" tilføjet` : `❌ ${data.error}`);
    setLoad("race", false);
  }

  async function handleImportResults(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoad("import", true);
    setImportMsg("Importerer...");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("race_id", "RACE_UUID_HERE"); // Replace via UI
    formData.append("stage_number", "1");

    // For now just show file info — full upload endpoint to be wired up
    setImportMsg(`✅ Fil klar: ${file.name} (${(file.size / 1024).toFixed(0)} KB) — konfigurer race_id og kør upload`);
    setLoad("import", false);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin Panel</h1>
        <p className="text-white/30 text-sm">Sæsonstyring, dataimport og løbskalender</p>
      </div>

      {(syncMsg || importMsg) && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border
          ${(syncMsg || importMsg).startsWith("✅")
            ? "bg-green-500/10 text-green-400 border-green-500/20"
            : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
          {syncMsg || importMsg}
        </div>
      )}

      <AdminSection title="Opret ny sæson">
        <form onSubmit={handleCreateSeason} className="flex gap-3 flex-wrap">
          <div>
            <label className="block text-white/30 text-xs mb-1">Sæsonnummer</label>
            <input type="number" required placeholder="1"
              value={seasonForm.number}
              onChange={e => setSeasonForm(f => ({ ...f, number: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2
                text-white text-sm w-28 focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Løbsdage i alt</label>
            <input type="number" placeholder="60"
              value={seasonForm.race_days_total}
              onChange={e => setSeasonForm(f => ({ ...f, race_days_total: parseInt(e.target.value) }))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2
                text-white text-sm w-28 focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={loading.season}
              className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg
                text-sm hover:bg-[#f0d060] transition-all disabled:opacity-50">
              {loading.season ? "..." : "Opret sæson"}
            </button>
          </div>
        </form>
      </AdminSection>

      <AdminSection title="Tilføj løb til kalender">
        <form onSubmit={handleCreateRace} className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-white/30 text-xs mb-1">Sæson ID (UUID)</label>
            <input type="text" required placeholder="uuid..."
              value={raceForm.season_id}
              onChange={e => setRaceForm(f => ({ ...f, season_id: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2
                text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Løbsnavn</label>
            <input type="text" required placeholder="Tour de France"
              value={raceForm.name}
              onChange={e => setRaceForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2
                text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Type</label>
            <select value={raceForm.race_type}
              onChange={e => setRaceForm(f => ({ ...f, race_type: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2
                text-white text-sm focus:outline-none focus:border-[#e8c547]/50">
              <option value="stage_race">Etapeløb</option>
              <option value="single">Enkeltdagsløb</option>
            </select>
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Antal etaper</label>
            <input type="number" min={1}
              value={raceForm.stages}
              onChange={e => setRaceForm(f => ({ ...f, stages: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2
                text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Startdato</label>
            <input type="date"
              value={raceForm.start_date}
              onChange={e => setRaceForm(f => ({ ...f, start_date: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2
                text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Præmiepulje (pts)</label>
            <input type="number" min={0}
              value={raceForm.prize_pool}
              onChange={e => setRaceForm(f => ({ ...f, prize_pool: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2
                text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
          </div>
          <div className="col-span-2">
            <button type="submit" disabled={loading.race}
              className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg
                text-sm hover:bg-[#f0d060] transition-all disabled:opacity-50">
              {loading.race ? "..." : "Tilføj løb"}
            </button>
          </div>
        </form>
      </AdminSection>

      <AdminSection title="Importer løbsresultater (PCM Excel)">
        <p className="text-white/40 text-xs mb-3">
          Upload PCM-eksport fil (.xlsx) med faner: Stage results, General results,
          Points, Mountain, Team results, Young results
        </p>
        <label className="block">
          <div className="border-2 border-dashed border-white/10 rounded-xl p-8
            text-center hover:border-[#e8c547]/30 transition-all cursor-pointer">
            <p className="text-white/30 text-sm">Klik for at vælge Excel-fil</p>
            <p className="text-white/20 text-xs mt-1">.xlsx format</p>
          </div>
          <input type="file" accept=".xlsx" className="hidden"
            onChange={handleImportResults} />
        </label>
        {loading.import && (
          <div className="mt-2 flex items-center gap-2 text-white/40 text-sm">
            <div className="w-4 h-4 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
            Importerer...
          </div>
        )}
      </AdminSection>

      <AdminSection title="Synkroniser ryttere fra Google Sheets">
        <p className="text-white/40 text-xs mb-3">
          Trækker UCI-point fra Google Sheets og opdaterer rytterpriser i databasen.
        </p>
        <button
          onClick={async () => {
            setLoad("sync", true);
            setSyncMsg("Synkronisering starter snart — konfigurer Google Sheets API nøgle i backend .env");
            setLoad("sync", false);
          }}
          disabled={loading.sync}
          className="px-4 py-2 bg-white/10 text-white font-medium rounded-lg
            text-sm hover:bg-white/15 transition-all disabled:opacity-50 border border-white/10">
          {loading.sync ? "Synkroniserer..." : "Sync UCI Points"}
        </button>
      </AdminSection>
    </div>
  );
}
