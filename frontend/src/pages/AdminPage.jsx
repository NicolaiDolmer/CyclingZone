import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

function Section({ title, children }) {
  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-4">
      <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
        <span className="w-1 h-4 bg-red-400 rounded-full" />{title}
      </h2>
      {children}
    </div>
  );
}

export default function AdminPage() {
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const [seasons, setSeasons] = useState([]);
  const [races, setRaces] = useState([]);
  const [teams, setTeams] = useState([]);
  const [window_, setWindow_] = useState(null);
  const [prizes, setPrizes] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [seasonForm, setSeasonForm] = useState({ number: "", race_days_total: 60 });
  const [raceForm, setRaceForm] = useState({ season_id: "", name: "", race_type: "stage_race", stages: 21, start_date: "", prize_pool: 1000 });
  const [importRaceId, setImportRaceId] = useState("");
  const [importStage, setImportStage] = useState(1);
  const [loading, setLoading] = useState({});
  const [editingPrize, setEditingPrize] = useState(null);
  const [newWebhook, setNewWebhook] = useState({ webhook_name: "", webhook_url: "" });

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [s, r, t, w, p, w2] = await Promise.all([
      supabase.from("seasons").select("*").order("number", { ascending: false }),
      supabase.from("races").select("*").order("start_date"),
      supabase.from("teams").select("id,name,balance,division").eq("is_ai", false).order("name"),
      supabase.from("transfer_windows").select("*").order("created_at", { ascending: false }).limit(1).single(),
      supabase.from("prize_tables").select("*").order("race_type").order("result_type").order("rank"),
      supabase.from("discord_settings").select("*").order("created_at"),
    ]);
    setSeasons(s.data || []);
    setRaces(r.data || []);
    setTeams(t.data || []);
    setWindow_(w.data || null);
    setPrizes(p.data || []);
    setWebhooks(w2.data || []);
  }

  function setLoad(k, v) { setLoading(l => ({ ...l, [k]: v })); }
  function showMsg(text, type = "success") {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "" }), 4000);
  }

  async function getAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
  }

  async function handleCreateSeason(e) {
    e.preventDefault(); setLoad("season", true);
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/seasons`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({ number: parseInt(seasonForm.number), race_days_total: parseInt(seasonForm.race_days_total) }),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ Sæson ${data.number} oprettet`); loadAll(); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("season", false);
  }

  async function handleSeasonAction(seasonId, action) {
    if (action === "end" && !confirm("Afslut sæson? Dette kører op/nedrykning og trækker lønninger.")) return;
    setLoad(`${action}_${seasonId}`, true);
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/seasons/${seasonId}/${action}`, {
      method: "POST", headers: await getAuth(),
    });
    const data = await res.json();
    if (res.ok) showMsg(`✅ ${action === "start" ? "Sæson startet" : "Sæson afsluttet"}`);
    else showMsg(`❌ ${data.error}`, "error");
    setLoad(`${action}_${seasonId}`, false);
    loadAll();
  }

  async function handleCreateRace(e) {
    e.preventDefault(); setLoad("race", true);
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/races`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({ ...raceForm, stages: parseInt(raceForm.stages), prize_pool: parseInt(raceForm.prize_pool) }),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ Løb "${data.name}" tilføjet`); loadAll(); setRaceForm(f => ({ ...f, name: "", start_date: "" })); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("race", false);
  }

  async function handleImportResults(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!importRaceId) { showMsg("❌ Vælg et løb først", "error"); return; }
    setLoad("import", true);
    showMsg("⏳ Importerer...", "info");
    const { data: { session } } = await supabase.auth.getSession();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("race_id", importRaceId);
    formData.append("stage_number", importStage);
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/import-results`, {
      method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body: formData,
    });
    const data = await res.json();
    if (res.ok) showMsg(`✅ ${data.records_imported} resultater importeret — ${data.teams_paid} holds fik præmiepenge`);
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("import", false);
    e.target.value = "";
  }

  async function toggleTransferWindow() {
    const isOpen = window_?.status === "open";
    setLoad("window", true);
    const endpoint = isOpen ? "close" : "open";
    const body = isOpen ? {} : { season_id: seasons.find(s => s.status === "active")?.id };
    if (!isOpen && !body.season_id) { showMsg("❌ Ingen aktiv sæson fundet", "error"); setLoad("window", false); return; }
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/transfer-window/${endpoint}`, {
      method: "POST", headers: await getAuth(), body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) showMsg(isOpen ? "✅ Transfervindue lukket" : `✅ Transfervindue åbnet — ${data.riders_processed} ryttere behandlet`);
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("window", false);
    loadAll();
  }

  async function savePrize(prize) {
    await supabase.from("prize_tables").upsert({ ...prize }, { onConflict: "race_type,result_type,rank" });
    setEditingPrize(null);
    loadAll();
    showMsg("✅ Præmiepenge gemt");
  }

  async function addWebhook() {
    if (!newWebhook.webhook_name || !newWebhook.webhook_url) return;
    const isFirst = webhooks.length === 0;
    await supabase.from("discord_settings").insert({
      webhook_name: newWebhook.webhook_name,
      webhook_url: newWebhook.webhook_url,
      is_default: isFirst,
    });
    setNewWebhook({ webhook_name: "", webhook_url: "" });
    loadAll();
    showMsg("✅ Webhook tilføjet" + (isFirst ? " og sat som standard" : ""));
  }

  async function setDefaultWebhook(id) {
    await supabase.from("discord_settings").update({ is_default: false }).neq("id", id);
    await supabase.from("discord_settings").update({ is_default: true }).eq("id", id);
    loadAll();
    showMsg("✅ Standard webhook opdateret");
  }

  async function deleteWebhook(id) {
    await supabase.from("discord_settings").delete().eq("id", id);
    loadAll();
  }

  const windowOpen = window_?.status === "open";
  const statusColor = { upcoming: "text-white/40", active: "text-green-400", completed: "text-white/20" };
  const statusLabel = { upcoming: "Kommende", active: "Aktiv", completed: "Afsluttet" };
  const resultTypeLabels = { stage: "Etape", gc: "Samlet", points: "Point", mountain: "Bjerg", young: "Unge", team: "Hold" };
  const raceTypeLabels = { stage_race: "Etapeløb", single: "Enkeltdagsløb" };

  const prizeGroups = prizes.reduce((acc, p) => {
    const key = `${p.race_type}__${p.result_type}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin Panel</h1>
        <p className="text-white/30 text-sm">Sæsonstyring, transfervindue og løbskalender</p>
      </div>

      {msg.text && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border
          ${msg.type === "error" ? "bg-red-500/10 text-red-400 border-red-500/20" :
            msg.type === "info" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
            "bg-green-500/10 text-green-400 border-green-500/20"}`}>
          {msg.text}
        </div>
      )}

      {/* Transfer window */}
      <Section title="Transfervindue">
        <div className="flex items-center justify-between bg-white/3 rounded-xl p-4 mb-3">
          <div>
            <p className="text-white font-medium text-sm">
              Status: <span className={windowOpen ? "text-green-400" : "text-white/40"}>
                {windowOpen ? "🟢 Åbent" : "🔒 Lukket"}
              </span>
            </p>
            {window_?.opened_at && (
              <p className="text-white/30 text-xs mt-0.5">Åbnede: {new Date(window_.opened_at).toLocaleString("da-DK")}</p>
            )}
          </div>
          <button onClick={toggleTransferWindow} disabled={loading.window}
            className={`px-4 py-2 font-bold rounded-lg text-sm transition-all disabled:opacity-50
              ${windowOpen
                ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                : "bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20"}`}>
            {loading.window ? "..." : windowOpen ? "Luk vindue" : "Åbn vindue"}
          </button>
        </div>
        <p className="text-white/20 text-xs">Når vinduet åbnes behandles alle ventende transfers automatisk.</p>
      </Section>

      {/* Seasons */}
      <Section title="Sæsoner">
        {seasons.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            {seasons.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-white/3 rounded-lg px-4 py-3">
                <div>
                  <span className="text-white font-medium text-sm">Sæson {s.number}</span>
                  <span className={`ml-3 text-xs ${statusColor[s.status]}`}>{statusLabel[s.status]}</span>
                  <p className="text-white/20 text-xs mt-0.5 font-mono truncate">{s.id}</p>
                </div>
                <div className="flex gap-2">
                  {s.status === "upcoming" && (
                    <button onClick={() => handleSeasonAction(s.id, "start")} disabled={loading[`start_${s.id}`]}
                      className="px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg text-xs disabled:opacity-50">
                      {loading[`start_${s.id}`] ? "..." : "▶ Start"}
                    </button>
                  )}
                  {s.status === "active" && (
                    <button onClick={() => handleSeasonAction(s.id, "end")} disabled={loading[`end_${s.id}`]}
                      className="px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs disabled:opacity-50">
                      {loading[`end_${s.id}`] ? "..." : "⏹ Afslut"}
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
            <label className="block text-white/30 text-xs mb-1">Løbsdage</label>
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
      </Section>

      {/* Race calendar */}
      <Section title="Løbskalender">
        {races.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-lg border border-white/5">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-white/5">
                <th className="px-3 py-2 text-left text-white/30">Løb</th>
                <th className="px-3 py-2 text-left text-white/30 hidden sm:table-cell">Dato</th>
                <th className="px-3 py-2 text-right text-white/30">Præmier</th>
                <th className="px-3 py-2 text-right text-white/30">Vælg</th>
              </tr></thead>
              <tbody>
                {races.map(r => (
                  <tr key={r.id}
                    className={`border-b border-white/4 cursor-pointer hover:bg-white/3 ${importRaceId === r.id ? "bg-[#e8c547]/5" : ""}`}
                    onClick={() => { setImportRaceId(r.id); showMsg(`✅ Valgt: ${r.name}`, "info"); }}>
                    <td className="px-3 py-2 text-white font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-white/50 hidden sm:table-cell">{r.start_date ? new Date(r.start_date).toLocaleDateString("da-DK") : "—"}</td>
                    <td className="px-3 py-2 text-right text-[#e8c547] font-mono">{r.prize_pool?.toLocaleString("da-DK")}</td>
                    <td className="px-3 py-2 text-right">{importRaceId === r.id && <span className="text-[#e8c547] text-xs">✓</span>}</td>
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
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
              <option value="">Vælg sæson...</option>
              {seasons.map(s => <option key={s.id} value={s.id}>Sæson {s.number} ({s.status})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Løbsnavn</label>
            <input type="text" required placeholder="Tour de France" value={raceForm.name}
              onChange={e => setRaceForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Type</label>
            <select value={raceForm.race_type} onChange={e => setRaceForm(f => ({ ...f, race_type: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
              <option value="stage_race">Etapeløb</option>
              <option value="single">Enkeltdagsløb</option>
            </select>
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Etaper</label>
            <input type="number" min={1} value={raceForm.stages}
              onChange={e => setRaceForm(f => ({ ...f, stages: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Startdato</label>
            <input type="date" value={raceForm.start_date}
              onChange={e => setRaceForm(f => ({ ...f, start_date: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Præmiepulje (CZ$)</label>
            <input type="number" min={0} value={raceForm.prize_pool}
              onChange={e => setRaceForm(f => ({ ...f, prize_pool: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
          </div>
          <div className="col-span-2">
            <button type="submit" disabled={loading.race}
              className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50">
              {loading.race ? "..." : "Tilføj løb"}
            </button>
          </div>
        </form>
      </Section>

      {/* Import results */}
      <Section title="Importer løbsresultater (PCM Excel)">
        <div className="flex gap-3 mb-3 flex-wrap">
          <div className="flex-1">
            <label className="block text-white/30 text-xs mb-1">Løb</label>
            <select value={importRaceId} onChange={e => setImportRaceId(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
              <option value="">Vælg løb...</option>
              {races.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Etape nr.</label>
            <input type="number" min={1} value={importStage} onChange={e => setImportStage(parseInt(e.target.value))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm w-24 focus:outline-none" />
          </div>
        </div>
        <label className="block cursor-pointer">
          <div className={`border-2 border-dashed rounded-xl p-6 text-center transition-all
            ${!importRaceId ? "border-white/5 opacity-50 cursor-not-allowed" : "border-white/10 hover:border-[#e8c547]/30"}`}>
            <p className="text-white/30 text-sm">📁 Klik for at uploade PCM Excel-fil (.xlsx)</p>
            <p className="text-white/20 text-xs mt-1">Vælg et løb ovenfor inden du uploader</p>
          </div>
          <input type="file" accept=".xlsx" className="hidden" onChange={handleImportResults} disabled={!importRaceId} />
        </label>
      </Section>

      {/* Prize tables */}
      <Section title="Præmiepenge (CZ$ per placering)">
        <p className="text-white/30 text-xs mb-4">Klik på et beløb for at redigere det. Tryk Enter for at gemme.</p>
        {Object.entries(prizeGroups).map(([key, group]) => {
          const [race_type, result_type] = key.split("__");
          return (
            <div key={key} className="mb-4">
              <p className="text-white/50 text-xs font-medium uppercase tracking-wider mb-2">
                {raceTypeLabels[race_type]} — {resultTypeLabels[result_type]}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.map(p => (
                  <div key={p.id} className="flex items-center gap-1 bg-white/3 border border-white/8 rounded-lg px-2 py-1">
                    <span className="text-white/40 text-xs w-4">#{p.rank}</span>
                    {editingPrize?.id === p.id ? (
                      <input type="number"
                        value={editingPrize.prize_amount}
                        onChange={e => setEditingPrize({ ...editingPrize, prize_amount: parseInt(e.target.value) })}
                        onBlur={() => savePrize(editingPrize)}
                        onKeyDown={e => e.key === "Enter" && savePrize(editingPrize)}
                        className="bg-transparent text-[#e8c547] font-mono text-xs w-16 focus:outline-none"
                        autoFocus />
                    ) : (
                      <button onClick={() => setEditingPrize(p)}
                        className="text-[#e8c547] font-mono text-xs hover:underline">
                        {p.prize_amount} CZ$
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </Section>

      {/* Teams overview */}
      <Section title="Holds oversigt">
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
      </Section>

      {/* Discord webhooks */}
      <Section title="Discord Integration">
        <p className="text-white/30 text-xs mb-4">
          Tilføj webhook URLs fra Discord — beskeder sendes til den kanal du opretter webhook'en i.
          Find/opret webhook: Discord kanal → Redigér kanal → Integrationer → Webhooks.
        </p>
        {webhooks.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            {webhooks.map(w => (
              <div key={w.id} className="flex items-center justify-between bg-white/3 rounded-lg px-4 py-3">
                <div>
                  <p className="text-white text-sm font-medium">{w.webhook_name}</p>
                  <p className="text-white/20 text-xs font-mono">{w.webhook_url.slice(0, 50)}...</p>
                </div>
                <div className="flex items-center gap-2">
                  {w.is_default && (
                    <span className="text-[9px] uppercase bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20 px-2 py-0.5 rounded-full">Standard</span>
                  )}
                  <button onClick={() => setDefaultWebhook(w.id)}
                    className="px-2 py-1 bg-white/5 text-white/40 hover:text-white rounded text-xs border border-white/5">
                    Sæt standard
                  </button>
                  <button onClick={() => deleteWebhook(w.id)}
                    className="px-2 py-1 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded text-xs border border-red-500/20">
                    Slet
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-40">
            <label className="block text-white/30 text-xs mb-1">Kanalnavn</label>
            <input type="text" placeholder="f.eks. #cycling-zone" value={newWebhook.webhook_name}
              onChange={e => setNewWebhook(w => ({ ...w, webhook_name: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#5865F2]/50" />
          </div>
          <div className="flex-1 min-w-60">
            <label className="block text-white/30 text-xs mb-1">Webhook URL</label>
            <input type="text" placeholder="https://discord.com/api/webhooks/..." value={newWebhook.webhook_url}
              onChange={e => setNewWebhook(w => ({ ...w, webhook_url: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#5865F2]/50" />
          </div>
          <div className="flex items-end">
            <button onClick={addWebhook}
              className="px-4 py-2 bg-[#5865F2] text-white font-bold rounded-lg text-sm hover:bg-[#4752c4] transition-all">
              Tilføj webhook
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
