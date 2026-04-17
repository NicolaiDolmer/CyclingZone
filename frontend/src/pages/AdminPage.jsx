import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

// ── Løbsklasser ──────────────────────────────────────────────────────────────
const RACE_CLASSES = [
  { key: "CWTGTFrance",     label: "Grand Tour France (kat. 1)",   type: "Grand Tour" },
  { key: "CWTGTAutres",     label: "Grand Tour Autres (kat. 2)",   type: "Grand Tour" },
  { key: "CWTAutresToursA", label: "CWT Etapeløb A (kat. 3)",      type: "Etapeløb" },
  { key: "CWTAutresToursB", label: "CWT Etapeløb B (kat. 4)",      type: "Etapeløb" },
  { key: "CWTAutresToursC", label: "CWT Etapeløb C (kat. 5)",      type: "Etapeløb" },
  { key: "CWTMajeures",     label: "CWT Monument (kat. 1)",        type: "Endagsløb" },
  { key: "CWTAutresClasA",  label: "CWT Klassiker A (kat. 2)",     type: "Endagsløb" },
  { key: "CWTAutresClasB",  label: "CWT Klassiker B (kat. 3)",     type: "Endagsløb" },
  { key: "CWTAutresClasC",  label: "CWT Klassiker C (kat. 4)",     type: "Endagsløb" },
  { key: "Cont2HC",         label: "Continental 2.HC (kat. 6)",    type: "Etapeløb" },
  { key: "Cont21",          label: "Continental 2.1 (kat. 7)",     type: "Etapeløb" },
  { key: "Cont22",          label: "Continental 2.2 (kat. 8)",     type: "Etapeløb" },
  { key: "Cont1HC",         label: "Continental 1.HC (kat. 5)",    type: "Endagsløb" },
  { key: "Cont11",          label: "Continental 1.1 (kat. 6)",     type: "Endagsløb" },
  { key: "Cont12",          label: "Continental 1.2 (kat. 7)",     type: "Endagsløb" },
];

// Alle benævnelser der kan give point
const RESULT_TYPES = [
  { key: "Etapeplacering", label: "Etapeplacering" },
  { key: "Klassement",     label: "Klassement" },
  { key: "Klassiker",      label: "Klassiker" },
  { key: "Pointtrøje",     label: "Pointtrøje" },
  { key: "Bjergtrøje",     label: "Bjergtrøje" },
  { key: "Ungdomstrøje",   label: "Ungdomstrøje" },
  { key: "EtapeløbHold",  label: "Etapeløb Hold" },
  { key: "KlassikerHold", label: "Klassiker Hold" },
];

// Max placeringer der vises per benævnelse
const MAX_RANKS = {
  Etapeplacering: 10, Klassement: 10, Klassiker: 10,
  Pointtrøje: 5, Bjergtrøje: 5, Ungdomstrøje: 5,
  EtapeløbHold: 1, KlassikerHold: 1,
};

// ── Hjælpere ─────────────────────────────────────────────────────────────────
function timeAgo(d) {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (m < 1) return "Lige nu";
  if (m < 60) return `${m}m siden`;
  if (h < 24) return `${h}t siden`;
  return `${day}d siden`;
}

// ── ManualOverride subkomponent ───────────────────────────────────────────────
function ManualOverride({ onMsg, onRefresh, teams }) {
  const [query, setQuery] = useState("");
  const [riderResults, setRiderResults] = useState([]);
  const [selectedRider, setSelectedRider] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [loading, setLoading] = useState(false);

  async function searchRiders(q) {
    setQuery(q);
    if (q.length < 2) { setRiderResults([]); return; }
    const { data } = await supabase.from("riders")
      .select("id, firstname, lastname, uci_points, team:team_id(name)")
      .or(`firstname.ilike.%${q}%,lastname.ilike.%${q}%`)
      .limit(5);
    setRiderResults(data || []);
  }

  async function moveRider() {
    if (!selectedRider) return;
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API}/api/admin/override-rider`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: selectedRider.id, team_id: selectedTeam || null }),
    });
    const data = await res.json();
    if (res.ok) { onMsg(`✅ ${data.message}`); setSelectedRider(null); setQuery(""); onRefresh(); }
    else onMsg(`❌ ${data.error}`, "error");
    setLoading(false);
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="relative">
        <label className="block text-white/30 text-xs mb-1">Søg rytter</label>
        <input type="text" value={query} onChange={e => searchRiders(e.target.value)}
          placeholder="Navn..."
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
        {riderResults.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-[#1a1a2e] border border-white/10 rounded-lg overflow-hidden shadow-xl">
            {riderResults.map(r => (
              <div key={r.id} className="px-3 py-2 cursor-pointer hover:bg-white/5 border-b border-white/5 last:border-0"
                onClick={() => { setSelectedRider(r); setQuery(`${r.firstname} ${r.lastname}`); setRiderResults([]); }}>
                <p className="text-white text-sm">{r.firstname} {r.lastname}</p>
                <p className="text-white/30 text-xs">{r.team?.name || "Fri agent"} — {r.uci_points?.toLocaleString()} CZ$</p>
              </div>
            ))}
          </div>
        )}
        {selectedRider && (
          <p className="text-[#e8c547] text-xs mt-1">✓ {selectedRider.firstname} {selectedRider.lastname}</p>
        )}
      </div>
      <div>
        <label className="block text-white/30 text-xs mb-1">Flyt til hold</label>
        <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
          <option value="">Fri agent (intet hold)</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name} (Div {t.division})</option>)}
        </select>
      </div>
      <div className="flex items-end">
        <button onClick={moveRider} disabled={loading || !selectedRider}
          className="w-full px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm
            hover:bg-[#f0d060] disabled:opacity-50 transition-all">
          {loading ? "Flytter..." : "Flyt rytter"}
        </button>
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
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

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const [seasons, setSeasons] = useState([]);
  const [races, setRaces] = useState([]);
  const [teams, setTeams] = useState([]);
  const [window_, setWindow_] = useState(null);
  const [prizes, setPrizes] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [loanConfigs, setLoanConfigs] = useState([]);
  const [adminLogs, setAdminLogs] = useState([]);
  const [racePoints, setRacePoints] = useState([]); // NEW: race_points tabel

  const [seasonForm, setSeasonForm] = useState({ number: "", race_days_total: 60 });
  const [raceForm, setRaceForm] = useState({
    season_id: "", name: "", race_type: "stage_race",
    race_class: "", stages: 21, start_date: "", prize_pool: 1000,
  });
  const [importRaceId, setImportRaceId] = useState("");
  const [importStage, setImportStage] = useState(1);
  const [loading, setLoading] = useState({});
  const [editingPrize, setEditingPrize] = useState(null);
  const [newWebhook, setNewWebhook] = useState({ webhook_name: "", webhook_url: "" });

  // Sæsonafslutnings-preview
  const [previewSeason, setPreviewSeason] = useState("");
  const [seasonPreview, setSeasonPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Manuel balancejustering
  const [balTeam, setBalTeam] = useState("");
  const [balAmount, setBalAmount] = useState("");
  const [balReason, setBalReason] = useState("");

  // Lånekonfiguration
  const [editingLoan, setEditingLoan] = useState(null);

  // Race editor — NY
  const [editingRace, setEditingRace] = useState(null);

  // Points editor — NY
  const [selectedPointsClass, setSelectedPointsClass] = useState(RACE_CLASSES[0].key);
  const [editingPoint, setEditingPoint] = useState(null); // { race_class, result_type, rank, points }
  const [savingPoint, setSavingPoint] = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [s, r, t, w, p, w2, lc, al, rp] = await Promise.all([
      supabase.from("seasons").select("*").order("number", { ascending: false }),
      supabase.from("races").select("*").order("start_date"),
      supabase.from("teams").select("id,name,balance,division").eq("is_ai", false).order("name"),
      supabase.from("transfer_windows").select("*").order("created_at", { ascending: false }).limit(1).single(),
      supabase.from("prize_tables").select("*").order("race_type").order("result_type").order("rank"),
      supabase.from("discord_settings").select("*").order("created_at"),
      supabase.from("loan_config").select("*").order("division").order("loan_type"),
      supabase.from("admin_log").select("*, target_team:target_team_id(name)")
        .order("created_at", { ascending: false }).limit(50),
      supabase.from("race_points").select("*").order("race_class").order("result_type").order("rank"),
    ]);
    setSeasons(s.data || []);
    setRaces(r.data || []);
    setTeams(t.data || []);
    setWindow_(w.data || null);
    setPrizes(p.data || []);
    setWebhooks(w2.data || []);
    setLoanConfigs(lc.data || []);
    setAdminLogs(al.data || []);
    setRacePoints(rp.data || []);
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

  // ── Sæson ──────────────────────────────────────────────────────────────────
  async function handleCreateSeason(e) {
    e.preventDefault(); setLoad("season", true);
    const res = await fetch(`${API}/api/admin/seasons`, {
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
    const res = await fetch(`${API}/api/admin/seasons/${seasonId}/${action}`, {
      method: "POST", headers: await getAuth(),
    });
    const data = await res.json();
    if (res.ok) showMsg(`✅ ${action === "start" ? "Sæson startet" : "Sæson afsluttet"}`);
    else showMsg(`❌ ${data.error}`, "error");
    setLoad(`${action}_${seasonId}`, false);
    loadAll();
  }

  // ── Løb ────────────────────────────────────────────────────────────────────
  async function handleCreateRace(e) {
    e.preventDefault(); setLoad("race", true);
    const res = await fetch(`${API}/api/admin/races`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({
        ...raceForm,
        stages: parseInt(raceForm.stages),
        prize_pool: parseInt(raceForm.prize_pool),
        race_class: raceForm.race_class || null,
      }),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ Løb "${data.name}" tilføjet`); loadAll(); setRaceForm(f => ({ ...f, name: "", start_date: "", race_class: "" })); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("race", false);
  }

  async function saveRaceEdit() {
    if (!editingRace) return;
    setLoad("raceEdit", true);
    const { error } = await supabase.from("races").update({
      name: editingRace.name,
      race_class: editingRace.race_class || null,
      race_type: editingRace.race_type,
      stages: parseInt(editingRace.stages) || 1,
      start_date: editingRace.start_date || null,
      prize_pool: parseInt(editingRace.prize_pool) || 0,
    }).eq("id", editingRace.id);
    if (!error) { showMsg("✅ Løb gemt"); setEditingRace(null); loadAll(); }
    else showMsg(`❌ ${error.message}`, "error");
    setLoad("raceEdit", false);
  }

  // ── Import ─────────────────────────────────────────────────────────────────
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
    const res = await fetch(`${API}/api/admin/import-results`, {
      method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body: formData,
    });
    const data = await res.json();
    if (res.ok) showMsg(`✅ ${data.records_imported} resultater importeret — ${data.teams_paid} holds fik præmiepenge`);
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("import", false);
    e.target.value = "";
  }

  // ── Transfervindue ─────────────────────────────────────────────────────────
  async function toggleTransferWindow() {
    const isOpen = window_?.status === "open";
    setLoad("window", true);
    const endpoint = isOpen ? "close" : "open";
    const body = isOpen ? {} : { season_id: seasons.find(s => s.status === "active")?.id };
    if (!isOpen && !body.season_id) { showMsg("❌ Ingen aktiv sæson fundet", "error"); setLoad("window", false); return; }
    const res = await fetch(`${API}/api/admin/transfer-window/${endpoint}`, {
      method: "POST", headers: await getAuth(), body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) showMsg(isOpen ? "✅ Transfervindue lukket" : `✅ Transfervindue åbnet — ${data.riders_processed} ryttere behandlet`);
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("window", false);
    loadAll();
  }

  // ── Præmiepenge (gammel tabel) ─────────────────────────────────────────────
  async function savePrize(prize) {
    await supabase.from("prize_tables").upsert({ ...prize }, { onConflict: "race_type,result_type,rank" });
    setEditingPrize(null);
    loadAll();
    showMsg("✅ Præmiepenge gemt");
  }

  // ── Points (ny tabel) ─────────────────────────────────────────────────────
  async function savePoint(raceClass, resultType, rank, pts) {
    setSavingPoint(true);
    const { error } = await supabase.from("race_points").upsert(
      { race_class: raceClass, result_type: resultType, rank, points: parseInt(pts) || 0, updated_at: new Date().toISOString() },
      { onConflict: "race_class,result_type,rank" }
    );
    if (!error) { showMsg("✅ Point gemt"); setEditingPoint(null); loadAll(); }
    else showMsg(`❌ ${error.message}`, "error");
    setSavingPoint(false);
  }

  function getPoints(raceClass, resultType, rank) {
    return racePoints.find(p => p.race_class === raceClass && p.result_type === resultType && p.rank === rank)?.points ?? "";
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────
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

  // ── Sæsonafslutnings-preview ───────────────────────────────────────────────
  async function loadSeasonPreview() {
    if (!previewSeason) { showMsg("❌ Vælg en sæson", "error"); return; }
    setLoadingPreview(true);
    const res = await fetch(`${API}/api/admin/season-end-preview/${previewSeason}`, { headers: await getAuth() });
    const data = await res.json();
    if (res.ok) setSeasonPreview(data.preview);
    else showMsg(`❌ ${data.error}`, "error");
    setLoadingPreview(false);
  }

  // ── Manuel balance ─────────────────────────────────────────────────────────
  async function handleAdjustBalance() {
    if (!balTeam || !balAmount) { showMsg("❌ Vælg hold og angiv beløb", "error"); return; }
    setLoad("balance", true);
    const res = await fetch(`${API}/api/admin/adjust-balance`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({ team_id: balTeam, amount: parseInt(balAmount), reason: balReason }),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ Balance justeret med ${parseInt(balAmount).toLocaleString("da-DK")} CZ$`); setBalAmount(""); setBalReason(""); loadAll(); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("balance", false);
  }

  // ── Lånekonfiguration ──────────────────────────────────────────────────────
  async function saveLoanConfig(cfg) {
    const res = await fetch(`${API}/api/admin/loan-config`, {
      method: "PATCH", headers: await getAuth(), body: JSON.stringify(cfg),
    });
    const data = await res.json();
    if (res.ok) { showMsg("✅ Lånekonfiguration gemt"); setEditingLoan(null); loadAll(); }
    else showMsg(`❌ ${data.error}`, "error");
  }

  // ── Konstanter til visning ─────────────────────────────────────────────────
  const windowOpen = window_?.status === "open";
  const statusColor = { upcoming: "text-white/40", active: "text-green-400", completed: "text-white/20" };
  const statusLabel = { upcoming: "Kommende", active: "Aktiv", completed: "Afsluttet" };
  const loanTypeLabels = { short: "Kort lån", long: "Langt lån", emergency: "Nødlån" };

  const prizeGroups = prizes.reduce((acc, p) => {
    const key = `${p.race_type}__${p.result_type}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin Panel</h1>
        <p className="text-white/30 text-sm">Sæsonstyring, transfervindue og løbskalender</p>
      </div>

      {msg.text && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border
          ${msg.type === "error" ? "bg-red-500/10 text-red-400 border-red-500/20" :
            msg.type === "info"  ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
            "bg-green-500/10 text-green-400 border-green-500/20"}`}>
          {msg.text}
        </div>
      )}

      {/* ── Transfervindue ──────────────────────────────────────────────────── */}
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

      {/* ── Sæsoner ─────────────────────────────────────────────────────────── */}
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

      {/* ── Løbskalender ────────────────────────────────────────────────────── */}
      <Section title="Løbskalender">
        {/* Eksisterende løb med redigering */}
        {races.length > 0 && (
          <div className="mb-5 overflow-hidden rounded-lg border border-white/5">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-3 py-2 text-left text-white/30">Løb</th>
                  <th className="px-3 py-2 text-left text-white/30 hidden sm:table-cell">Klasse</th>
                  <th className="px-3 py-2 text-left text-white/30 hidden md:table-cell">Dato</th>
                  <th className="px-3 py-2 text-right text-white/30">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {races.map(r => (
                  <>
                    <tr key={r.id} className="border-b border-white/4 hover:bg-white/2">
                      <td className="px-3 py-2.5">
                        <p className="text-white font-medium">{r.name}</p>
                        <p className="text-white/30">{r.race_type === "stage_race" ? `${r.stages} etaper` : "Enkeltdagsløb"}</p>
                      </td>
                      <td className="px-3 py-2.5 hidden sm:table-cell">
                        {r.race_class ? (
                          <span className="text-[#e8c547] text-xs font-mono">{r.race_class}</span>
                        ) : (
                          <span className="text-white/20 text-xs italic">Ikke sat</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-white/40 hidden md:table-cell">
                        {r.start_date ? new Date(r.start_date).toLocaleDateString("da-DK") : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { setImportRaceId(r.id); showMsg(`✅ Valgt til import: ${r.name}`, "info"); }}
                            className={`px-2 py-1 rounded text-xs border transition-all
                              ${importRaceId === r.id
                                ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20"
                                : "bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white"}`}>
                            {importRaceId === r.id ? "✓ Valgt" : "Vælg"}
                          </button>
                          <button
                            onClick={() => setEditingRace(editingRace?.id === r.id ? null : { ...r })}
                            className="px-2 py-1 bg-white/5 text-white/40 border border-white/10 rounded text-xs hover:bg-white/10 hover:text-white transition-all">
                            ✏ Rediger
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* Inline editor */}
                    {editingRace?.id === r.id && (
                      <tr key={`edit-${r.id}`} className="border-b border-[#e8c547]/10 bg-[#e8c547]/3">
                        <td colSpan={4} className="px-3 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                            <div className="col-span-2 sm:col-span-1">
                              <label className="block text-white/30 text-xs mb-1">Løbsnavn</label>
                              <input type="text" value={editingRace.name}
                                onChange={e => setEditingRace(er => ({ ...er, name: e.target.value }))}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
                            </div>
                            <div>
                              <label className="block text-white/30 text-xs mb-1">Løbsklasse</label>
                              <select value={editingRace.race_class || ""}
                                onChange={e => setEditingRace(er => ({ ...er, race_class: e.target.value }))}
                                className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50">
                                <option value="">— Ingen klasse —</option>
                                {["Grand Tour", "Etapeløb", "Endagsløb"].map(type => (
                                  <optgroup key={type} label={type}>
                                    {RACE_CLASSES.filter(c => c.type === type).map(c => (
                                      <option key={c.key} value={c.key}>{c.label}</option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-white/30 text-xs mb-1">Type</label>
                              <select value={editingRace.race_type}
                                onChange={e => setEditingRace(er => ({ ...er, race_type: e.target.value }))}
                                className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
                                <option value="stage_race">Etapeløb</option>
                                <option value="single">Enkeltdagsløb</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-white/30 text-xs mb-1">Etaper</label>
                              <input type="number" min={1} value={editingRace.stages}
                                onChange={e => setEditingRace(er => ({ ...er, stages: e.target.value }))}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
                            </div>
                            <div>
                              <label className="block text-white/30 text-xs mb-1">Startdato</label>
                              <input type="date" value={editingRace.start_date || ""}
                                onChange={e => setEditingRace(er => ({ ...er, start_date: e.target.value }))}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
                            </div>
                            <div>
                              <label className="block text-white/30 text-xs mb-1">Præmiepulje</label>
                              <input type="number" value={editingRace.prize_pool || 0}
                                onChange={e => setEditingRace(er => ({ ...er, prize_pool: e.target.value }))}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={saveRaceEdit} disabled={loading.raceEdit}
                              className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50">
                              {loading.raceEdit ? "Gemmer..." : "Gem ændringer"}
                            </button>
                            <button onClick={() => setEditingRace(null)}
                              className="px-4 py-2 bg-white/5 text-white/40 rounded-lg text-sm hover:bg-white/10">
                              Annuller
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Nyt løb */}
        <p className="text-white/30 text-xs uppercase tracking-wider mb-2 font-semibold">Tilføj nyt løb</p>
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
            <label className="block text-white/30 text-xs mb-1">Løbsklasse</label>
            <select value={raceForm.race_class} onChange={e => setRaceForm(f => ({ ...f, race_class: e.target.value }))}
              className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
              <option value="">— Ingen klasse —</option>
              {["Grand Tour", "Etapeløb", "Endagsløb"].map(type => (
                <optgroup key={type} label={type}>
                  {RACE_CLASSES.filter(c => c.type === type).map(c => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Type</label>
            <select value={raceForm.race_type} onChange={e => setRaceForm(f => ({ ...f, race_type: e.target.value }))}
              className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
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
            <label className="block text-white/30 text-xs mb-1">Præmiepulje</label>
            <input type="number" value={raceForm.prize_pool}
              onChange={e => setRaceForm(f => ({ ...f, prize_pool: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={loading.race}
              className="w-full px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50">
              {loading.race ? "..." : "Tilføj løb"}
            </button>
          </div>
        </form>
      </Section>

      {/* ── Pointtabel per løbsklasse (NY) ──────────────────────────────────── */}
      <Section title="Pointtabel per løbsklasse">
        <p className="text-white/30 text-xs mb-4 leading-relaxed">
          Vælg en løbsklasse og sæt point for hver benævnelse og placering.
          Klik på et felt for at redigere. Tomme felter giver 0 point.
        </p>

        {/* Klasse-vælger */}
        <div className="mb-4">
          <label className="block text-white/30 text-xs mb-1">Løbsklasse</label>
          <select value={selectedPointsClass} onChange={e => { setSelectedPointsClass(e.target.value); setEditingPoint(null); }}
            className="bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50 min-w-[260px]">
            {["Grand Tour", "Etapeløb", "Endagsløb"].map(type => (
              <optgroup key={type} label={type}>
                {RACE_CLASSES.filter(c => c.type === type).map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Pointgrid */}
        <div className="overflow-x-auto rounded-lg border border-white/5">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-3 py-2 text-left text-white/30 font-medium">Benævnelse</th>
                {Array.from({ length: Math.max(...Object.values(MAX_RANKS)) }, (_, i) => i + 1).map(r => (
                  <th key={r} className="px-2 py-2 text-center text-white/30 font-medium w-12">#{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RESULT_TYPES.map(rt => {
                const maxRank = MAX_RANKS[rt.key] || 10;
                return (
                  <tr key={rt.key} className="border-b border-white/4 last:border-0">
                    <td className="px-3 py-2 text-white/60 font-medium whitespace-nowrap">{rt.label}</td>
                    {Array.from({ length: Math.max(...Object.values(MAX_RANKS)) }, (_, i) => i + 1).map(rank => {
                      if (rank > maxRank) return <td key={rank} className="px-2 py-2 text-center text-white/10">—</td>;
                      const currentPts = getPoints(selectedPointsClass, rt.key, rank);
                      const isEditing = editingPoint?.race_class === selectedPointsClass && editingPoint?.result_type === rt.key && editingPoint?.rank === rank;
                      return (
                        <td key={rank} className="px-2 py-2 text-center">
                          {isEditing ? (
                            <div className="flex gap-1 items-center justify-center">
                              <input
                                type="number"
                                min={0}
                                autoFocus
                                defaultValue={currentPts}
                                onKeyDown={e => {
                                  if (e.key === "Enter") savePoint(selectedPointsClass, rt.key, rank, e.target.value);
                                  if (e.key === "Escape") setEditingPoint(null);
                                }}
                                onBlur={e => savePoint(selectedPointsClass, rt.key, rank, e.target.value)}
                                className="w-14 bg-[#0a0a0f] border border-[#e8c547]/50 rounded px-1 py-0.5 text-white text-xs font-mono text-center focus:outline-none"
                              />
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingPoint({ race_class: selectedPointsClass, result_type: rt.key, rank })}
                              className={`w-full px-1 py-1 rounded text-xs font-mono transition-all hover:bg-white/5
                                ${currentPts !== "" && currentPts > 0 ? "text-[#e8c547]" : "text-white/20 hover:text-white/40"}`}>
                              {currentPts !== "" ? currentPts : "—"}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-white/20 text-xs mt-2">Klik på et felt for at redigere. Enter eller klik uden for feltet for at gemme. Escape for at annullere.</p>
      </Section>

      {/* ── Import resultater ────────────────────────────────────────────────── */}
      <Section title="Importer løbsresultater (Excel)">
        <p className="text-white/30 text-xs mb-4">Vælg løb i tabellen ovenfor, angiv etape og upload fil.</p>
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <label className="block text-white/30 text-xs mb-1">Valgt løb</label>
            <p className="text-white text-sm px-3 py-2 bg-white/3 rounded-lg border border-white/5">
              {races.find(r => r.id === importRaceId)?.name || <span className="text-white/20 italic">Intet valgt</span>}
            </p>
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Etape #</label>
            <input type="number" min={1} value={importStage}
              onChange={e => setImportStage(parseInt(e.target.value))}
              className="w-24 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Excel-fil</label>
            <label className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-bold border transition-all flex items-center gap-2
              ${importRaceId
                ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20 hover:bg-[#e8c547]/20"
                : "bg-white/5 text-white/20 border-white/10 cursor-not-allowed"}`}>
              {loading.import ? "⏳ Importerer..." : "📁 Upload fil"}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={handleImportResults} disabled={!importRaceId || loading.import} />
            </label>
          </div>
        </div>
      </Section>

      {/* ── Manuel override ──────────────────────────────────────────────────── */}
      <Section title="Manuel override — flyt rytter">
        <p className="text-white/30 text-xs mb-4">
          Bruges til korrektioner og special-situationer. Handlingen logges ikke som en transaktion.
        </p>
        <ManualOverride onMsg={(text, type) => showMsg(text, type)} onRefresh={loadAll} teams={teams} />
      </Section>

      {/* ── Sæsonafslutnings-preview ─────────────────────────────────────────── */}
      <Section title="Sæsonafslutnings-preview">
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="flex-1">
            <label className="block text-white/30 text-xs mb-1">Vælg sæson</label>
            <select value={previewSeason} onChange={e => setPreviewSeason(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
              <option value="">Vælg sæson...</option>
              {seasons.map(s => <option key={s.id} value={s.id}>Sæson {s.number} ({s.status})</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={loadSeasonPreview} disabled={loadingPreview || !previewSeason}
              className="px-4 py-2 bg-white/5 text-white/60 border border-white/10 rounded-lg text-sm hover:bg-white/10 hover:text-white disabled:opacity-50">
              {loadingPreview ? "Indlæser..." : "Vis preview"}
            </button>
          </div>
        </div>
        {seasonPreview && (
          <div className="overflow-x-auto rounded-lg border border-white/5">
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-3 py-2 text-left text-white/30">Hold</th>
                  <th className="px-3 py-2 text-right text-white/30">Balance</th>
                  <th className="px-3 py-2 text-right text-white/30">Løntræk</th>
                  <th className="px-3 py-2 text-right text-white/30">Renter</th>
                  <th className="px-3 py-2 text-right text-white/30">Balance efter</th>
                  <th className="px-3 py-2 text-right text-white/30">Nødlån?</th>
                  <th className="px-3 py-2 text-right text-white/30">Tilfredshed</th>
                  <th className="px-3 py-2 text-right text-white/30">Sponsor næste</th>
                  <th className="px-3 py-2 text-right text-white/30">Rang</th>
                </tr>
              </thead>
              <tbody>
                {seasonPreview.sort((a, b) => a.division - b.division || (a.current_rank || 99) - (b.current_rank || 99)).map(row => (
                  <tr key={row.team_id} className={`border-b border-white/4 ${row.needs_emergency_loan ? "bg-red-500/5" : ""}`}>
                    <td className="px-3 py-2">
                      <p className="text-white font-medium">{row.team_name}</p>
                      <p className="text-white/30">Div {row.division}</p>
                    </td>
                    <td className="px-3 py-2 text-right text-white/60 font-mono">{row.current_balance?.toLocaleString("da-DK")}</td>
                    <td className="px-3 py-2 text-right text-red-400 font-mono">-{row.salary_deduction?.toLocaleString("da-DK")}</td>
                    <td className="px-3 py-2 text-right text-orange-400 font-mono">
                      {row.loan_interest > 0 ? `-${row.loan_interest?.toLocaleString("da-DK")}` : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${row.balance_after < 0 ? "text-red-400" : "text-green-400"}`}>
                      {row.balance_after?.toLocaleString("da-DK")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.needs_emergency_loan
                        ? <span className="text-red-400 font-mono">+{row.emergency_loan_amount?.toLocaleString("da-DK")}</span>
                        : <span className="text-white/20">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      <span className={row.board_satisfaction >= 70 ? "text-green-400" : row.board_satisfaction >= 40 ? "text-[#e8c547]" : "text-red-400"}>
                        {row.board_satisfaction}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-[#e8c547] font-mono">{row.next_season_sponsor?.toLocaleString("da-DK")}</td>
                    <td className="px-3 py-2 text-right text-white/60 font-mono">#{row.current_rank || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {seasonPreview && (
          <p className="text-white/20 text-xs mt-2">
            Preview er ikke bindende. Bekræft og afslut sæson via "⏹ Afslut"-knappen ovenfor.
          </p>
        )}
      </Section>

      {/* ── Manuel balancejustering ──────────────────────────────────────────── */}
      <Section title="Manuel balancejustering">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-white/30 text-xs mb-1">Hold</label>
            <select value={balTeam} onChange={e => setBalTeam(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
              <option value="">Vælg hold...</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name} (Div {t.division})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Beløb (positiv = indsæt, negativ = træk)</label>
            <input type="number" value={balAmount} onChange={e => setBalAmount(e.target.value)}
              placeholder="fx 500 eller -200"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none font-mono" />
          </div>
          <div>
            <label className="block text-white/30 text-xs mb-1">Årsag</label>
            <input type="text" value={balReason} onChange={e => setBalReason(e.target.value)}
              placeholder="Beskriv årsag..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
          </div>
        </div>
        <button onClick={handleAdjustBalance} disabled={loading.balance || !balTeam || !balAmount}
          className="mt-3 px-4 py-2 bg-white/5 text-white/60 border border-white/10 rounded-lg text-sm hover:bg-white/10 hover:text-white disabled:opacity-50 transition-all">
          {loading.balance ? "Justerer..." : "Juster balance"}
        </button>
      </Section>

      {/* ── Lånekonfiguration ────────────────────────────────────────────────── */}
      <Section title="Lånekonfiguration">
        {loanConfigs.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-white/5 mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-3 py-2 text-left text-white/30">Division</th>
                  <th className="px-3 py-2 text-left text-white/30">Type</th>
                  <th className="px-3 py-2 text-right text-white/30">Gebyr</th>
                  <th className="px-3 py-2 text-right text-white/30">Rente/sæson</th>
                  <th className="px-3 py-2 text-right text-white/30">Sæsoner</th>
                  <th className="px-3 py-2 text-right text-white/30">Gældsloft</th>
                </tr>
              </thead>
              <tbody>
                {loanConfigs.map(cfg => {
                  const isEditing = editingLoan?.id === cfg.id;
                  return (
                    <tr key={cfg.id} className={`border-b border-white/4 cursor-pointer hover:bg-white/2 ${isEditing ? "bg-[#e8c547]/3" : ""}`}
                      onClick={() => setEditingLoan(isEditing ? null : { ...cfg })}>
                      <td className="px-3 py-2 text-white/60">Div {cfg.division}</td>
                      <td className="px-3 py-2 text-white font-medium">{loanTypeLabels[cfg.loan_type] || cfg.loan_type}</td>
                      {isEditing ? (
                        <>
                          <td className="px-2 py-1"><input type="number" step="0.01" value={(editingLoan.origination_fee_pct * 100).toFixed(0)}
                            onChange={e => setEditingLoan(l => ({ ...l, origination_fee_pct: parseFloat(e.target.value) / 100 }))}
                            onClick={e => e.stopPropagation()}
                            className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-white font-mono text-xs" /></td>
                          <td className="px-2 py-1"><input type="number" step="0.01" value={(editingLoan.interest_rate_pct * 100).toFixed(0)}
                            onChange={e => setEditingLoan(l => ({ ...l, interest_rate_pct: parseFloat(e.target.value) / 100 }))}
                            onClick={e => e.stopPropagation()}
                            className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-white font-mono text-xs" /></td>
                          <td className="px-2 py-1"><input type="number" value={editingLoan.seasons}
                            onChange={e => setEditingLoan(l => ({ ...l, seasons: parseInt(e.target.value) }))}
                            onClick={e => e.stopPropagation()}
                            className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-white font-mono text-xs" /></td>
                          <td className="px-2 py-1"><input type="number" value={editingLoan.debt_ceiling}
                            onChange={e => setEditingLoan(l => ({ ...l, debt_ceiling: parseInt(e.target.value) }))}
                            onClick={e => e.stopPropagation()}
                            className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-white font-mono text-xs" /></td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-right text-white/50 font-mono">{(cfg.origination_fee_pct * 100).toFixed(0)}%</td>
                          <td className="px-3 py-2 text-right text-white/50 font-mono">{(cfg.interest_rate_pct * 100).toFixed(0)}%</td>
                          <td className="px-3 py-2 text-right text-white/50 font-mono">{cfg.seasons}</td>
                          <td className="px-3 py-2 text-right text-[#e8c547] font-mono">{cfg.debt_ceiling?.toLocaleString("da-DK")}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {editingLoan && (
          <div className="flex gap-2">
            <button onClick={() => saveLoanConfig(editingLoan)}
              className="px-3 py-1.5 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-xs hover:bg-[#f0d060]">Gem</button>
            <button onClick={() => setEditingLoan(null)}
              className="px-3 py-1.5 bg-white/5 text-white/40 rounded-lg text-xs hover:bg-white/10">Annuller</button>
          </div>
        )}
      </Section>

      {/* ── Discord webhooks ─────────────────────────────────────────────────── */}
      <Section title="Discord webhooks">
        {webhooks.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {webhooks.map(w => (
              <div key={w.id} className="flex items-center justify-between bg-white/3 rounded-lg px-3 py-2">
                <div>
                  <p className="text-white text-sm font-medium">{w.webhook_name}</p>
                  <p className="text-white/30 text-xs font-mono truncate max-w-xs">{w.webhook_url.slice(0, 40)}...</p>
                </div>
                <div className="flex gap-2">
                  {w.is_default
                    ? <span className="text-[#e8c547] text-xs border border-[#e8c547]/20 px-2 py-0.5 rounded-full">Standard</span>
                    : <button onClick={() => setDefaultWebhook(w.id)} className="text-white/30 text-xs hover:text-white">Sæt standard</button>}
                  <button onClick={() => deleteWebhook(w.id)} className="text-red-400/50 text-xs hover:text-red-400">Slet</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <input type="text" placeholder="Navn" value={newWebhook.webhook_name}
            onChange={e => setNewWebhook(w => ({ ...w, webhook_name: e.target.value }))}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm w-40 focus:outline-none" />
          <input type="text" placeholder="Webhook URL" value={newWebhook.webhook_url}
            onChange={e => setNewWebhook(w => ({ ...w, webhook_url: e.target.value }))}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm flex-1 min-w-[200px] focus:outline-none" />
          <button onClick={addWebhook}
            className="px-4 py-2 bg-white/5 text-white/60 border border-white/10 rounded-lg text-sm hover:bg-white/10 hover:text-white transition-all">
            Tilføj
          </button>
        </div>
      </Section>

      {/* ── Admin log ────────────────────────────────────────────────────────── */}
      <Section title="Admin log">
        {adminLogs.length === 0 ? (
          <p className="text-white/20 text-sm">Ingen handlinger logget endnu.</p>
        ) : (
          <div className="flex flex-col divide-y divide-white/4">
            {adminLogs.map(log => (
              <div key={log.id} className="py-2.5 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white/70 text-xs">{log.description}</p>
                  {log.target_team?.name && <p className="text-white/30 text-xs mt-0.5">Hold: {log.target_team.name}</p>}
                </div>
                <p className="text-white/20 text-xs flex-shrink-0">{timeAgo(log.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
