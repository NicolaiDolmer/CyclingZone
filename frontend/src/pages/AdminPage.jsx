import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import {
  MAX_RANKS,
  RACE_CLASSES,
  RESULT_TYPES,
  getRaceClassLabel,
} from "../lib/uciRaceClasses";
import { formatCz, getRiderMarketValue } from "../lib/marketValues";

const API = import.meta.env.VITE_API_URL;

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
      .select("id, firstname, lastname, uci_points, market_value, prize_earnings_bonus, team:team_id(name)")
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
        <label className="block text-cz-3 text-xs mb-1">Søg rytter</label>
        <input type="text" value={query} onChange={e => searchRiders(e.target.value)}
          placeholder="Navn..."
          className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent" />
        {riderResults.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-cz-subtle border border-cz-border rounded-lg overflow-hidden shadow-xl">
            {riderResults.map(r => (
              <div key={r.id} className="px-3 py-2 cursor-pointer hover:bg-cz-subtle border-b border-cz-border last:border-0"
                onClick={() => { setSelectedRider(r); setQuery(`${r.firstname} ${r.lastname}`); setRiderResults([]); }}>
                <p className="text-cz-1 text-sm">{r.firstname} {r.lastname}</p>
                <p className="text-cz-3 text-xs">{r.team?.name || "Fri agent"} — {formatCz(getRiderMarketValue(r))}</p>
              </div>
            ))}
          </div>
        )}
        {selectedRider && (
          <p className="text-cz-accent-t text-xs mt-1">✓ {selectedRider.firstname} {selectedRider.lastname}</p>
        )}
      </div>
      <div>
        <label className="block text-cz-3 text-xs mb-1">Flyt til hold</label>
        <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)}
          className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
          <option value="">Fri agent (intet hold)</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name} (Div {t.division})</option>)}
        </select>
      </div>
      <div className="flex items-end">
        <button onClick={moveRider} disabled={loading || !selectedRider}
          className="w-full px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm
            hover:brightness-110 disabled:opacity-50 transition-all">
          {loading ? "Flytter..." : "Flyt rytter"}
        </button>
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-4 sm:p-5 mb-4">
      <h2 className="text-cz-1 font-semibold text-sm mb-4 flex items-center gap-2">
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
  const [racePoints, setRacePoints] = useState([]);
  const [users, setUsers] = useState([]);

  const [seasonForm, setSeasonForm] = useState({ number: "", race_days_total: 60 });
  const [raceForm, setRaceForm] = useState({
    season_id: "", name: "", race_type: "stage_race",
    race_class: "", stages: 21, start_date: "", prize_pool: 1000,
  });
  const [importRaceId, setImportRaceId] = useState("");
  const [importStage, setImportStage] = useState(1);
  const [loading, setLoading] = useState({});
  const [editingPrize, setEditingPrize] = useState(null);
  const [newWebhook, setNewWebhook] = useState({ webhook_name: "", webhook_url: "", webhook_type: "general" });
  const [dynCyclistUrl, setDynCyclistUrl] = useState("");
  const [dynSyncResult, setDynSyncResult] = useState(null);

  // Sheets løbsresultater
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [sheetsResult, setSheetsResult] = useState(null);

  // Præmieudbetaling
  const [prizePayoutSeason, setPrizePayoutSeason] = useState("");
  const [prizePreview, setPrizePreview] = useState(null);
  const [prizePayResult, setPrizePayResult] = useState(null);

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

  // Auktionskonfiguration
  const [auctionConfig, setAuctionConfig] = useState(null);
  const [editingAuctionConfig, setEditingAuctionConfig] = useState(null);

  // Race editor — NY
  const [editingRace, setEditingRace] = useState(null);

  // Deadline Day
  const [closesAtInput, setClosesAtInput] = useState("");

  // Beta-testværktøjer
  const [betaResult, setBetaResult] = useState(null);
  const [betaClearTransactions, setBetaClearTransactions] = useState(false);

  // Points editor — NY
  const [selectedPointsClass, setSelectedPointsClass] = useState(RACE_CLASSES[0].key);
  const [editingPoint, setEditingPoint] = useState(null); // { race_class, result_type, rank, points }
  const [savingPoint, setSavingPoint] = useState(false);

  useEffect(() => { loadAll(); }, []);

  // Synkroniser closes_at input fra window_ når det loader
  useEffect(() => {
    if (window_?.closes_at) {
      const d = new Date(window_.closes_at);
      const pad = n => String(n).padStart(2, "0");
      setClosesAtInput(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
  }, [window_?.closes_at]);

  async function loadAll() {
    const [s, r, t, w, p, w2, lc, al, rp, u, ac] = await Promise.all([
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
      supabase.from("users").select("id, email, username, role, created_at, teams(id, name, division)").order("created_at", { ascending: false }),
      supabase.from("auction_timing_config").select("*").eq("id", 1).single(),
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
    setUsers(u.data || []);
    setAuctionConfig(ac.data || null);
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

  async function handleRebuildStandings(seasonId) {
    if (!confirm("Genberegn standings for denne sæson ud fra gemte løbsresultater?")) return;
    setLoad(`rebuild_${seasonId}`, true);
    const res = await fetch(`${API}/api/admin/seasons/${seasonId}/rebuild-standings`, {
      method: "POST", headers: await getAuth(),
    });
    const data = await res.json();
    if (res.ok) {
      const warning = data.start_date_missing
        ? " Advarsel: sæsonen mangler stadig startdato i databasen."
        : "";
      showMsg(`✅ Standings genberegnet for ${data.rows_updated} hold.${warning}`);
    } else {
      showMsg(`❌ ${data.error}`, "error");
    }
    setLoad(`rebuild_${seasonId}`, false);
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
    const body = isOpen
      ? {}
      : { season_id: seasons.find(s => s.status === "active")?.id, ...(closesAtInput ? { closes_at: new Date(closesAtInput).toISOString() } : {}) };
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

  async function updateClosesAt() {
    if (!closesAtInput) { showMsg("❌ Vælg en lukketid", "error"); return; }
    setLoad("closesAt", true);
    const res = await fetch(`${API}/api/admin/transfer-window/closes-at`, {
      method: "PUT", headers: await getAuth(),
      body: JSON.stringify({ closes_at: new Date(closesAtInput).toISOString() }),
    });
    const data = await res.json();
    if (res.ok) showMsg("✅ Lukketid gemt");
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("closesAt", false);
    loadAll();
  }

  async function updateDeadlineDayOverride(override) {
    setLoad(`dd_${override}`, true);
    const res = await fetch(`${API}/api/admin/deadline-day/override`, {
      method: "PUT", headers: await getAuth(),
      body: JSON.stringify({ override }),
    });
    const data = await res.json();
    if (res.ok) showMsg(`✅ Deadline Day: ${override}`);
    else showMsg(`❌ ${data.error}`, "error");
    setLoad(`dd_${override}`, false);
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
      webhook_type: newWebhook.webhook_type,
      is_default: isFirst,
    });
    setNewWebhook({ webhook_name: "", webhook_url: "", webhook_type: "general" });
    loadAll();
    showMsg("✅ Webhook tilføjet" + (isFirst ? " og sat som standard" : ""));
  }

  async function testWebhook(webhookUrl) {
    setLoad(`test_${webhookUrl}`, true);
    const res = await fetch(`${API}/api/admin/discord/test`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({ webhook_url: webhookUrl }),
    });
    const data = await res.json();
    if (res.ok) showMsg("✅ Testbesked sendt til Discord");
    else showMsg(`❌ ${data.error}`, "error");
    setLoad(`test_${webhookUrl}`, false);
  }

  async function handleDynCyclistSync() {
    if (!dynCyclistUrl) { showMsg("❌ Indsæt Google Sheets URL", "error"); return; }
    setLoad("dyn_cyclist", true);
    showMsg("⏳ Synkroniserer rytterstats...", "info");
    const res = await fetch(`${API}/api/admin/sync-dyn-cyclist`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({ spreadsheet_url: dynCyclistUrl }),
    });
    const data = await res.json();
    if (res.ok) { setDynSyncResult(data); showMsg(`✅ Sync fuldført — ${data.rows_matched} ryttere opdateret`); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("dyn_cyclist", false);
  }

  async function loadPrizePreview() {
    if (!prizePayoutSeason) { showMsg("❌ Vælg en sæson", "error"); return; }
    setLoad("prize_preview", true);
    setPrizePreview(null);
    setPrizePayResult(null);
    const res = await fetch(`${API}/api/admin/prize-payout-preview?season_id=${prizePayoutSeason}`, {
      headers: await getAuth(),
    });
    const data = await res.json();
    if (res.ok) setPrizePreview(data);
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("prize_preview", false);
  }

  async function handlePayPrizes() {
    if (!prizePayoutSeason) { showMsg("❌ Vælg en sæson", "error"); return; }
    setLoad("prize_pay", true);
    const res = await fetch(`${API}/api/admin/pay-prizes-to-date`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({ season_id: prizePayoutSeason }),
    });
    const data = await res.json();
    if (res.ok) {
      setPrizePayResult(data);
      setPrizePreview(null);
      showMsg(`✅ ${data.races_paid} løb betalt — i alt ${data.total_paid.toLocaleString("da-DK")} CZ$`);
    } else {
      showMsg(`❌ ${data.error}`, "error");
    }
    setLoad("prize_pay", false);
  }

  async function handleSheetsImport() {
    if (!sheetsUrl) { showMsg("❌ Indsæt Google Sheets URL", "error"); return; }
    setLoad("sheets_import", true);
    setSheetsResult(null);
    showMsg("⏳ Importerer løbsresultater...", "info");
    const res = await fetch(`${API}/api/admin/import-results-sheets`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({ spreadsheet_url: sheetsUrl }),
    });
    const data = await res.json();
    if (res.ok) { setSheetsResult(data); showMsg(`✅ Import fuldført — ${data.rows_imported} resultater fra ${data.races_imported.length} løb`); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("sheets_import", false);
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

  // ── Auktionskonfiguration ──────────────────────────────────────────────────
  async function saveAuctionConfig() {
    if (!editingAuctionConfig) return;
    setLoad("auctionCfg", true);
    const res = await fetch(`${API}/api/admin/auction-config`, {
      method: "PUT", headers: await getAuth(), body: JSON.stringify(editingAuctionConfig),
    });
    const data = await res.json();
    if (res.ok) { showMsg("✅ Auktionsregler gemt"); setEditingAuctionConfig(null); loadAll(); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("auctionCfg", false);
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

  // ── Beta-testværktøjer ─────────────────────────────────────────────────────
  async function handleBeta(endpoint, confirmMsg, body = {}) {
    if (!confirm(confirmMsg)) return;
    setLoad(`beta_${endpoint}`, true);
    setBetaResult(null);
    try {
      const res = await fetch(`${API}/api/admin/beta/${endpoint}`, {
        method: "POST", headers: await getAuth(), body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) { setBetaResult({ endpoint, ...data }); showMsg(`✅ beta/${endpoint} udført`); }
      else { showMsg(`❌ ${data.error}`, "error"); }
    } catch (e) {
      showMsg(`❌ Netværksfejl: ${e.message}`, "error");
    }
    setLoad(`beta_${endpoint}`, false);
  }

  // ── Brugere ────────────────────────────────────────────────────────────────
  async function handleDeleteUser(userId, username) {
    if (!confirm(`Slet bruger "${username}" permanent?\n\nHoldet bevares, men mister sin ejer. Notifikationer slettes.`)) return;
    setLoad(`del_user_${userId}`, true);
    const res = await fetch(`${API}/api/admin/users/${userId}`, {
      method: "DELETE", headers: await getAuth(),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ Bruger ${username} slettet`); loadAll(); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad(`del_user_${userId}`, false);
  }

  async function handleChangeRole(userId, newRole, username) {
    if (!confirm(`Skift ${username} til ${newRole}?`)) return;
    setLoad(`role_${userId}`, true);
    const res = await fetch(`${API}/api/admin/users/${userId}/role`, {
      method: "PATCH", headers: await getAuth(),
      body: JSON.stringify({ role: newRole }),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ ${username} er nu ${newRole}`); loadAll(); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad(`role_${userId}`, false);
  }

  // ── Slet løb ───────────────────────────────────────────────────────────────
  async function handleDeleteRace(raceId, raceName) {
    if (!confirm(`Slet "${raceName}"?\n\nAlle løbsresultater for dette løb slettes også.`)) return;
    setLoad(`del_race_${raceId}`, true);
    const res = await fetch(`${API}/api/admin/races/${raceId}`, {
      method: "DELETE", headers: await getAuth(),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ ${raceName} slettet`); loadAll(); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad(`del_race_${raceId}`, false);
  }

  // ── Konstanter til visning ─────────────────────────────────────────────────
  const windowOpen = window_?.status === "open";
  const statusColor = { upcoming: "text-cz-2", active: "text-cz-success", completed: "text-cz-3" };
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
        <h1 className="text-xl font-bold text-cz-1">Admin Panel</h1>
        <p className="text-cz-3 text-sm">Sæsonstyring, transfervindue og løbskalender</p>
      </div>

      {msg.text && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border
          ${msg.type === "error" ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30" :
            msg.type === "info"  ? "bg-cz-info-bg0/10 text-cz-info border-blue-500/20" :
            "bg-cz-success-bg text-cz-success border-cz-success/30"}`}>
          {msg.text}
        </div>
      )}

      {/* ── Transfervindue ──────────────────────────────────────────────────── */}
      <Section title="Transfervindue">
        <div className="flex items-center justify-between bg-cz-subtle rounded-xl p-4 mb-3">
          <div>
            <p className="text-cz-1 font-medium text-sm">
              Status: <span className={windowOpen ? "text-cz-success" : "text-cz-2"}>
                {windowOpen ? "🟢 Åbent" : "🔒 Lukket"}
              </span>
            </p>
            {window_?.opened_at && (
              <p className="text-cz-3 text-xs mt-0.5">Åbnede: {new Date(window_.opened_at).toLocaleString("da-DK")}</p>
            )}
          </div>
          <button onClick={toggleTransferWindow} disabled={loading.window}
            className={`px-4 py-2 font-bold rounded-lg text-sm transition-all disabled:opacity-50
              ${windowOpen
                ? "bg-cz-danger-bg text-cz-danger border border-cz-danger/30 hover:bg-cz-danger-bg"
                : "bg-cz-success-bg text-cz-success border border-cz-success/30 hover:bg-cz-success-bg"}`}>
            {loading.window ? "..." : windowOpen ? "Luk vindue" : "Åbn vindue"}
          </button>
        </div>

        {/* Lukketid */}
        <div className="bg-cz-subtle rounded-xl p-4 mb-3">
          <p className="text-cz-2 font-medium text-sm mb-2">Lukketidspunkt</p>
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={closesAtInput}
              onChange={e => setClosesAtInput(e.target.value)}
              className="flex-1 px-3 py-2 border border-cz-border rounded-lg text-sm text-cz-1 bg-cz-card"
            />
            {windowOpen && (
              <button onClick={updateClosesAt} disabled={loading.closesAt}
                className="px-3 py-2 bg-cz-info-bg text-cz-info border border-cz-info/30 rounded-lg text-sm font-medium hover:bg-blue-100 disabled:opacity-50">
                {loading.closesAt ? "..." : "Gem"}
              </button>
            )}
          </div>
          <p className="text-cz-3 text-xs mt-1.5">
            {windowOpen ? "Opdater lukketid — aktiverer Deadline Day countdown automatisk." : "Udfyld inden vinduet åbnes for at sætte countdown."}
          </p>
        </div>

        {/* Deadline Day override */}
        <div className="bg-cz-subtle rounded-xl p-4 mb-3">
          <p className="text-cz-2 font-medium text-sm mb-2">Deadline Day tilstand</p>
          <div className="flex gap-2">
            {["auto", "on", "off"].map(mode => {
              const current = auctionConfig?.deadline_day_override || "auto";
              const labels = { auto: "Auto", on: "Tændt", off: "Slukket" };
              const active = current === mode;
              return (
                <button key={mode} onClick={() => updateDeadlineDayOverride(mode)}
                  disabled={loading[`dd_${mode}`] || active}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all disabled:cursor-default
                    ${active
                      ? "bg-cz-sidebar text-white border-[#1a1f38]"
                      : "bg-cz-card text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
                  {labels[mode]}
                </button>
              );
            })}
          </div>
          <p className="text-cz-3 text-xs mt-1.5">
            Auto = aktiveres 24t inden lukketid · Tændt = altid aktiv (test) · Slukket = deaktiveret
          </p>
          {auctionConfig?.deadline_day_override === "on" && (
            <p className="text-cz-accent-t text-xs mt-1 font-medium">⚠ Manuel tilstand aktiv — husk at sætte tilbage til Auto</p>
          )}
        </div>

        <p className="text-cz-3 text-xs">Når vinduet åbnes behandles alle ventende transfers automatisk.</p>
      </Section>

      {/* ── Sæsoner ─────────────────────────────────────────────────────────── */}
      <Section title="Sæsoner">
        {seasons.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            {seasons.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-cz-subtle rounded-lg px-4 py-3">
                <div>
                  <span className="text-cz-1 font-medium text-sm">Sæson {s.number}</span>
                  <span className={`ml-3 text-xs ${statusColor[s.status]}`}>{statusLabel[s.status]}</span>
                  <p className="text-cz-3 text-xs mt-0.5 font-mono truncate">{s.id}</p>
                </div>
                <div className="flex gap-2">
                  {s.status !== "upcoming" && (
                    <button onClick={() => handleRebuildStandings(s.id)} disabled={loading[`rebuild_${s.id}`]}
                      className="px-3 py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-xs disabled:opacity-50 hover:bg-cz-subtle hover:text-cz-1">
                      {loading[`rebuild_${s.id}`] ? "..." : "↻ Standings"}
                    </button>
                  )}
                  {s.status === "upcoming" && (
                    <button onClick={() => handleSeasonAction(s.id, "start")} disabled={loading[`start_${s.id}`]}
                      className="px-3 py-1.5 bg-cz-success-bg text-cz-success border border-cz-success/30 rounded-lg text-xs disabled:opacity-50">
                      {loading[`start_${s.id}`] ? "..." : "▶ Start"}
                    </button>
                  )}
                  {s.status === "active" && (
                    <button onClick={() => handleSeasonAction(s.id, "end")} disabled={loading[`end_${s.id}`]}
                      className="px-3 py-1.5 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-xs disabled:opacity-50">
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
            <label className="block text-cz-3 text-xs mb-1">Sæsonnummer</label>
            <input type="number" required placeholder="1" value={seasonForm.number}
              onChange={e => setSeasonForm(f => ({ ...f, number: e.target.value }))}
              className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm w-28 focus:outline-none focus:border-cz-accent" />
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Løbsdage</label>
            <input type="number" value={seasonForm.race_days_total}
              onChange={e => setSeasonForm(f => ({ ...f, race_days_total: e.target.value }))}
              className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm w-28 focus:outline-none focus:border-cz-accent" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={loading.season}
              className="px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
              {loading.season ? "..." : "Opret sæson"}
            </button>
          </div>
        </form>
      </Section>

      {/* ── Løbskalender ────────────────────────────────────────────────────── */}
      <Section title="Løbskalender">
        {/* Eksisterende løb med redigering */}
        {races.length > 0 && (
          <div className="mb-5 overflow-hidden rounded-lg border border-cz-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-3 py-2 text-left text-cz-3">Løb</th>
                  <th className="px-3 py-2 text-left text-cz-3 hidden sm:table-cell">Klasse</th>
                  <th className="px-3 py-2 text-left text-cz-3 hidden md:table-cell">Dato</th>
                  <th className="px-3 py-2 text-right text-cz-3">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {races.map(r => (
                  <>
                    <tr key={r.id} className="border-b border-cz-border hover:bg-cz-subtle">
                      <td className="px-3 py-2.5">
                        <p className="text-cz-1 font-medium">{r.name}</p>
                        <p className="text-cz-3">{r.race_type === "stage_race" ? `${r.stages} etaper` : "Enkeltdagsløb"}</p>
                      </td>
                      <td className="px-3 py-2.5 hidden sm:table-cell">
                        {r.race_class ? (
                          <span className="text-cz-accent-t text-xs font-mono">{getRaceClassLabel(r.race_class)}</span>
                        ) : (
                          <span className="text-cz-3 text-xs italic">Ikke sat</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-cz-2 hidden md:table-cell">
                        {r.start_date ? new Date(r.start_date).toLocaleDateString("da-DK") : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { setImportRaceId(r.id); showMsg(`✅ Valgt til import: ${r.name}`, "info"); }}
                            className={`px-2 py-1 rounded text-xs border transition-all
                              ${importRaceId === r.id
                                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                                : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle hover:text-cz-1"}`}>
                            {importRaceId === r.id ? "✓ Valgt" : "Vælg"}
                          </button>
                          <button
                            onClick={() => setEditingRace(editingRace?.id === r.id ? null : { ...r })}
                            className="px-2 py-1 bg-cz-subtle text-cz-2 border border-cz-border rounded text-xs hover:bg-cz-subtle hover:text-cz-1 transition-all">
                            ✏ Rediger
                          </button>
                          <button
                            onClick={() => handleDeleteRace(r.id, r.name)}
                            disabled={loading[`del_race_${r.id}`]}
                            className="px-2 py-1 bg-cz-danger-bg text-red-600 border border-cz-danger/30 rounded text-xs hover:bg-cz-danger-bg disabled:opacity-50 transition-all">
                            {loading[`del_race_${r.id}`] ? "..." : "Slet"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* Inline editor */}
                    {editingRace?.id === r.id && (
                      <tr key={`edit-${r.id}`} className="border-b border-[#e8c547]/10 bg-cz-accent/3">
                        <td colSpan={4} className="px-3 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                            <div className="col-span-2 sm:col-span-1">
                              <label className="block text-cz-3 text-xs mb-1">Løbsnavn</label>
                              <input type="text" value={editingRace.name}
                                onChange={e => setEditingRace(er => ({ ...er, name: e.target.value }))}
                                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent" />
                            </div>
                            <div>
                              <label className="block text-cz-3 text-xs mb-1">Løbsklasse</label>
                              <select value={editingRace.race_class || ""}
                                onChange={e => setEditingRace(er => ({ ...er, race_class: e.target.value }))}
                                className="w-full bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent">
                                <option value="">— Ingen klasse —</option>
                                {["Grand Tour", "WorldTour", "Endagsløb", "Continental Circuit"].map(type => (
                                  <optgroup key={type} label={type}>
                                    {RACE_CLASSES.filter(c => c.type === type).map(c => (
                                      <option key={c.key} value={c.key}>{c.label}</option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-cz-3 text-xs mb-1">Type</label>
                              <select value={editingRace.race_type}
                                onChange={e => setEditingRace(er => ({ ...er, race_type: e.target.value }))}
                                className="w-full bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
                                <option value="stage_race">Etapeløb</option>
                                <option value="single">Enkeltdagsløb</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-cz-3 text-xs mb-1">Etaper</label>
                              <input type="number" min={1} value={editingRace.stages}
                                onChange={e => setEditingRace(er => ({ ...er, stages: e.target.value }))}
                                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
                            </div>
                            <div>
                              <label className="block text-cz-3 text-xs mb-1">Startdato</label>
                              <input type="date" value={editingRace.start_date || ""}
                                onChange={e => setEditingRace(er => ({ ...er, start_date: e.target.value }))}
                                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
                            </div>
                            <div>
                              <label className="block text-cz-3 text-xs mb-1">Præmiepulje</label>
                              <input type="number" value={editingRace.prize_pool || 0}
                                onChange={e => setEditingRace(er => ({ ...er, prize_pool: e.target.value }))}
                                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={saveRaceEdit} disabled={loading.raceEdit}
                              className="px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
                              {loading.raceEdit ? "Gemmer..." : "Gem ændringer"}
                            </button>
                            <button onClick={() => setEditingRace(null)}
                              className="px-4 py-2 bg-cz-subtle text-cz-2 rounded-lg text-sm hover:bg-cz-subtle">
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
        <p className="text-cz-3 text-xs uppercase tracking-wider mb-2 font-semibold">Tilføj nyt løb</p>
        <form onSubmit={handleCreateRace} className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-cz-3 text-xs mb-1">Sæson</label>
            <select value={raceForm.season_id} onChange={e => setRaceForm(f => ({ ...f, season_id: e.target.value }))} required
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
              <option value="">Vælg sæson...</option>
              {seasons.map(s => <option key={s.id} value={s.id}>Sæson {s.number} ({s.status})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Løbsnavn</label>
            <input type="text" required placeholder="Tour de France" value={raceForm.name}
              onChange={e => setRaceForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Løbsklasse</label>
            <select value={raceForm.race_class} onChange={e => setRaceForm(f => ({ ...f, race_class: e.target.value }))}
              className="w-full bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
              <option value="">— Ingen klasse —</option>
              {["Grand Tour", "WorldTour", "Endagsløb", "Continental Circuit"].map(type => (
                <optgroup key={type} label={type}>
                  {RACE_CLASSES.filter(c => c.type === type).map(c => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Type</label>
            <select value={raceForm.race_type} onChange={e => setRaceForm(f => ({ ...f, race_type: e.target.value }))}
              className="w-full bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
              <option value="stage_race">Etapeløb</option>
              <option value="single">Enkeltdagsløb</option>
            </select>
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Etaper</label>
            <input type="number" min={1} value={raceForm.stages}
              onChange={e => setRaceForm(f => ({ ...f, stages: e.target.value }))}
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Startdato</label>
            <input type="date" value={raceForm.start_date}
              onChange={e => setRaceForm(f => ({ ...f, start_date: e.target.value }))}
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Præmiepulje</label>
            <input type="number" value={raceForm.prize_pool}
              onChange={e => setRaceForm(f => ({ ...f, prize_pool: e.target.value }))}
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={loading.race}
              className="w-full px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
              {loading.race ? "..." : "Tilføj løb"}
            </button>
          </div>
        </form>
      </Section>

      {/* ── Pointtabel per løbsklasse (NY) ──────────────────────────────────── */}
      <Section title="Pointtabel per løbsklasse">
        <p className="text-cz-3 text-xs mb-4 leading-relaxed">
          Vælg en løbsklasse og sæt point for hver benævnelse og placering.
          Klik på et felt for at redigere. Tomme felter giver 0 point.
        </p>

        {/* Klasse-vælger */}
        <div className="mb-4">
          <label className="block text-cz-3 text-xs mb-1">Løbsklasse</label>
          <select value={selectedPointsClass} onChange={e => { setSelectedPointsClass(e.target.value); setEditingPoint(null); }}
            className="bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent min-w-[260px]">
            {["Grand Tour", "WorldTour", "Endagsløb", "Continental Circuit"].map(type => (
              <optgroup key={type} label={type}>
                {RACE_CLASSES.filter(c => c.type === type).map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Pointgrid */}
        <div className="overflow-x-auto rounded-lg border border-cz-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-cz-border">
                <th className="px-3 py-2 text-left text-cz-3 font-medium">Benævnelse</th>
                {Array.from({ length: Math.max(...Object.values(MAX_RANKS)) }, (_, i) => i + 1).map(r => (
                  <th key={r} className="px-2 py-2 text-center text-cz-3 font-medium w-12">#{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RESULT_TYPES.map(rt => {
                const maxRank = MAX_RANKS[rt.key] || 10;
                return (
                  <tr key={rt.key} className="border-b border-cz-border last:border-0">
                    <td className="px-3 py-2 text-cz-2 font-medium whitespace-nowrap">{rt.label}</td>
                    {Array.from({ length: Math.max(...Object.values(MAX_RANKS)) }, (_, i) => i + 1).map(rank => {
                      if (rank > maxRank) return <td key={rank} className="px-2 py-2 text-center text-cz-3">—</td>;
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
                                className="w-14 bg-cz-card border border-[#e8c547]/50 rounded px-1 py-0.5 text-cz-1 text-xs font-mono text-center focus:outline-none"
                              />
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingPoint({ race_class: selectedPointsClass, result_type: rt.key, rank })}
                              className={`w-full px-1 py-1 rounded text-xs font-mono transition-all hover:bg-cz-subtle
                                ${currentPts !== "" && currentPts > 0 ? "text-cz-accent-t" : "text-cz-3 hover:text-cz-2"}`}>
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
        <p className="text-cz-3 text-xs mt-2">Klik på et felt for at redigere. Enter eller klik uden for feltet for at gemme. Escape for at annullere.</p>
      </Section>

      {/* ── Import resultater ────────────────────────────────────────────────── */}
      <Section title="Importer løbsresultater (Excel)">
        <p className="text-cz-3 text-xs mb-4">Vælg løb i tabellen ovenfor, angiv etape og upload fil.</p>
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <label className="block text-cz-3 text-xs mb-1">Valgt løb</label>
            <p className="text-cz-1 text-sm px-3 py-2 bg-cz-subtle rounded-lg border border-cz-border">
              {races.find(r => r.id === importRaceId)?.name || <span className="text-cz-3 italic">Intet valgt</span>}
            </p>
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Etape #</label>
            <input type="number" min={1} value={importStage}
              onChange={e => setImportStage(parseInt(e.target.value))}
              className="w-24 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Excel-fil</label>
            <label className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-bold border transition-all flex items-center gap-2
              ${importRaceId
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30 hover:bg-cz-accent/10"
                : "bg-cz-subtle text-cz-3 border-cz-border cursor-not-allowed"}`}>
              {loading.import ? "⏳ Importerer..." : "📁 Upload fil"}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={handleImportResults} disabled={!importRaceId || loading.import} />
            </label>
          </div>
        </div>
      </Section>

      {/* ── Manuel override ──────────────────────────────────────────────────── */}
      <Section title="Manuel override — flyt rytter">
        <p className="text-cz-3 text-xs mb-4">
          Bruges til korrektioner og special-situationer. Handlingen logges ikke som en transaktion.
        </p>
        <ManualOverride onMsg={(text, type) => showMsg(text, type)} onRefresh={loadAll} teams={teams} />
      </Section>

      {/* ── Sæsonafslutnings-preview ─────────────────────────────────────────── */}
      <Section title="Sæsonafslutnings-preview">
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="flex-1">
            <label className="block text-cz-3 text-xs mb-1">Vælg sæson</label>
            <select value={previewSeason} onChange={e => setPreviewSeason(e.target.value)}
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
              <option value="">Vælg sæson...</option>
              {seasons.map(s => <option key={s.id} value={s.id}>Sæson {s.number} ({s.status})</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={loadSeasonPreview} disabled={loadingPreview || !previewSeason}
              className="px-4 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-subtle hover:text-cz-1 disabled:opacity-50">
              {loadingPreview ? "Indlæser..." : "Vis preview"}
            </button>
          </div>
        </div>
        {seasonPreview && (
          <div className="overflow-x-auto rounded-lg border border-cz-border">
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-3 py-2 text-left text-cz-3">Hold</th>
                  <th className="px-3 py-2 text-right text-cz-3">Balance</th>
                  <th className="px-3 py-2 text-right text-cz-3">Løntræk</th>
                  <th className="px-3 py-2 text-right text-cz-3">Renter</th>
                  <th className="px-3 py-2 text-right text-cz-3">Balance efter</th>
                  <th className="px-3 py-2 text-right text-cz-3">Nødlån?</th>
                  <th className="px-3 py-2 text-right text-cz-3">Tilfredshed</th>
                  <th className="px-3 py-2 text-right text-cz-3">Sponsor næste</th>
                  <th className="px-3 py-2 text-right text-cz-3">Rang</th>
                </tr>
              </thead>
              <tbody>
                {seasonPreview.sort((a, b) => a.division - b.division || (a.current_rank || 99) - (b.current_rank || 99)).map(row => (
                  <tr key={row.team_id} className={`border-b border-cz-border ${row.needs_emergency_loan ? "bg-cz-danger-bg0/5" : ""}`}>
                    <td className="px-3 py-2">
                      <p className="text-cz-1 font-medium">{row.team_name}</p>
                      <p className="text-cz-3">Div {row.division}</p>
                    </td>
                    <td className="px-3 py-2 text-right text-cz-2 font-mono">{row.current_balance?.toLocaleString("da-DK")}</td>
                    <td className="px-3 py-2 text-right text-cz-danger font-mono">-{row.salary_deduction?.toLocaleString("da-DK")}</td>
                    <td className="px-3 py-2 text-right text-cz-warning font-mono">
                      {row.loan_interest > 0 ? `-${row.loan_interest?.toLocaleString("da-DK")}` : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${row.balance_after < 0 ? "text-cz-danger" : "text-cz-success"}`}>
                      {row.balance_after?.toLocaleString("da-DK")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.needs_emergency_loan
                        ? <span className="text-cz-danger font-mono">+{row.emergency_loan_amount?.toLocaleString("da-DK")}</span>
                        : <span className="text-cz-3">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      <span className={row.board_satisfaction >= 70 ? "text-cz-success" : row.board_satisfaction >= 40 ? "text-cz-accent-t" : "text-cz-danger"}>
                        {row.board_satisfaction}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-cz-accent-t font-mono">{row.next_season_sponsor?.toLocaleString("da-DK")}</td>
                    <td className="px-3 py-2 text-right text-cz-2 font-mono">#{row.current_rank || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {seasonPreview && (
          <p className="text-cz-3 text-xs mt-2">
            Preview er ikke bindende. Bekræft og afslut sæson via "⏹ Afslut"-knappen ovenfor.
          </p>
        )}
      </Section>

      {/* ── Manuel balancejustering ──────────────────────────────────────────── */}
      <Section title="Manuel balancejustering">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-cz-3 text-xs mb-1">Hold</label>
            <select value={balTeam} onChange={e => setBalTeam(e.target.value)}
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
              <option value="">Vælg hold...</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name} (Div {t.division})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Beløb (positiv = indsæt, negativ = træk)</label>
            <input type="number" value={balAmount} onChange={e => setBalAmount(e.target.value)}
              placeholder="fx 500 eller -200"
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none font-mono" />
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Årsag</label>
            <input type="text" value={balReason} onChange={e => setBalReason(e.target.value)}
              placeholder="Beskriv årsag..."
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
          </div>
        </div>
        <button onClick={handleAdjustBalance} disabled={loading.balance || !balTeam || !balAmount}
          className="mt-3 px-4 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-subtle hover:text-cz-1 disabled:opacity-50 transition-all">
          {loading.balance ? "Justerer..." : "Juster balance"}
        </button>
      </Section>

      {/* ── Lånekonfiguration ────────────────────────────────────────────────── */}
      <Section title="Lånekonfiguration">
        {loanConfigs.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-cz-border mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-3 py-2 text-left text-cz-3">Division</th>
                  <th className="px-3 py-2 text-left text-cz-3">Type</th>
                  <th className="px-3 py-2 text-right text-cz-3">Gebyr</th>
                  <th className="px-3 py-2 text-right text-cz-3">Rente/sæson</th>
                  <th className="px-3 py-2 text-right text-cz-3">Sæsoner</th>
                  <th className="px-3 py-2 text-right text-cz-3">Gældsloft</th>
                </tr>
              </thead>
              <tbody>
                {loanConfigs.map(cfg => {
                  const isEditing = editingLoan?.id === cfg.id;
                  return (
                    <tr key={cfg.id} className={`border-b border-cz-border cursor-pointer hover:bg-cz-subtle ${isEditing ? "bg-cz-accent/3" : ""}`}
                      onClick={() => setEditingLoan(isEditing ? null : { ...cfg })}>
                      <td className="px-3 py-2 text-cz-2">Div {cfg.division}</td>
                      <td className="px-3 py-2 text-cz-1 font-medium">{loanTypeLabels[cfg.loan_type] || cfg.loan_type}</td>
                      {isEditing ? (
                        <>
                          <td className="px-2 py-1"><input type="number" step="0.01" value={(editingLoan.origination_fee_pct * 100).toFixed(0)}
                            onChange={e => setEditingLoan(l => ({ ...l, origination_fee_pct: parseFloat(e.target.value) / 100 }))}
                            onClick={e => e.stopPropagation()}
                            className="w-16 bg-cz-subtle border border-cz-border rounded px-2 py-1 text-cz-1 font-mono text-xs" /></td>
                          <td className="px-2 py-1"><input type="number" step="0.01" value={(editingLoan.interest_rate_pct * 100).toFixed(0)}
                            onChange={e => setEditingLoan(l => ({ ...l, interest_rate_pct: parseFloat(e.target.value) / 100 }))}
                            onClick={e => e.stopPropagation()}
                            className="w-16 bg-cz-subtle border border-cz-border rounded px-2 py-1 text-cz-1 font-mono text-xs" /></td>
                          <td className="px-2 py-1"><input type="number" value={editingLoan.seasons}
                            onChange={e => setEditingLoan(l => ({ ...l, seasons: parseInt(e.target.value) }))}
                            onClick={e => e.stopPropagation()}
                            className="w-16 bg-cz-subtle border border-cz-border rounded px-2 py-1 text-cz-1 font-mono text-xs" /></td>
                          <td className="px-2 py-1"><input type="number" value={editingLoan.debt_ceiling}
                            onChange={e => setEditingLoan(l => ({ ...l, debt_ceiling: parseInt(e.target.value) }))}
                            onClick={e => e.stopPropagation()}
                            className="w-20 bg-cz-subtle border border-cz-border rounded px-2 py-1 text-cz-1 font-mono text-xs" /></td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-right text-cz-2 font-mono">{(cfg.origination_fee_pct * 100).toFixed(0)}%</td>
                          <td className="px-3 py-2 text-right text-cz-2 font-mono">{(cfg.interest_rate_pct * 100).toFixed(0)}%</td>
                          <td className="px-3 py-2 text-right text-cz-2 font-mono">{cfg.seasons}</td>
                          <td className="px-3 py-2 text-right text-cz-accent-t font-mono">{cfg.debt_ceiling?.toLocaleString("da-DK")}</td>
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
              className="px-3 py-1.5 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-xs hover:brightness-110">Gem</button>
            <button onClick={() => setEditingLoan(null)}
              className="px-3 py-1.5 bg-cz-subtle text-cz-2 rounded-lg text-xs hover:bg-cz-subtle">Annuller</button>
          </div>
        )}
      </Section>

      {/* ── Auktionsregler ───────────────────────────────────────────────────── */}
      <Section title="Auktionsregler">
        {auctionConfig && !editingAuctionConfig && (
          <div className="mb-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
              <div className="bg-cz-subtle rounded-lg px-3 py-2">
                <p className="text-cz-3 text-xs mb-0.5">Varighed (aktive timer)</p>
                <p className="text-cz-1 font-mono font-semibold">{auctionConfig.duration_hours} timer</p>
              </div>
              <div className="bg-cz-subtle rounded-lg px-3 py-2">
                <p className="text-cz-3 text-xs mb-0.5">Hverdag aktiv</p>
                <p className="text-cz-1 font-mono font-semibold">{auctionConfig.weekday_open_hour}:00 – {auctionConfig.weekday_close_hour}:00</p>
              </div>
              <div className="bg-cz-subtle rounded-lg px-3 py-2">
                <p className="text-cz-3 text-xs mb-0.5">Weekend aktiv</p>
                <p className="text-cz-1 font-mono font-semibold">{auctionConfig.weekend_open_hour}:00 – {auctionConfig.weekend_close_hour}:00</p>
              </div>
              <div className="bg-cz-subtle rounded-lg px-3 py-2">
                <p className="text-cz-3 text-xs mb-0.5">Forlængelse ved bud</p>
                <p className="text-cz-1 font-mono font-semibold">{auctionConfig.extension_minutes} min</p>
              </div>
            </div>
            <p className="text-cz-3 text-xs mb-3">Timer uden for det aktive vindue tæller ikke med i varigheden. Bud inden for de sidste {auctionConfig.extension_minutes} minutter forlænger auktionen.</p>
            <button onClick={() => setEditingAuctionConfig({ ...auctionConfig })}
              className="px-3 py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-xs hover:text-cz-1 transition-all">
              Rediger regler
            </button>
          </div>
        )}
        {editingAuctionConfig && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-cz-3 text-xs mb-1">Varighed (aktive timer)</label>
                <input type="number" min="1" max="72" value={editingAuctionConfig.duration_hours}
                  onChange={e => setEditingAuctionConfig(c => ({ ...c, duration_hours: parseInt(e.target.value) }))}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-cz-3 text-xs mb-1">Hverdag åbner (time)</label>
                <input type="number" min="0" max="23" value={editingAuctionConfig.weekday_open_hour}
                  onChange={e => setEditingAuctionConfig(c => ({ ...c, weekday_open_hour: parseInt(e.target.value) }))}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-cz-3 text-xs mb-1">Hverdag lukker (time)</label>
                <input type="number" min="0" max="23" value={editingAuctionConfig.weekday_close_hour}
                  onChange={e => setEditingAuctionConfig(c => ({ ...c, weekday_close_hour: parseInt(e.target.value) }))}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-cz-3 text-xs mb-1">Weekend åbner (time)</label>
                <input type="number" min="0" max="23" value={editingAuctionConfig.weekend_open_hour}
                  onChange={e => setEditingAuctionConfig(c => ({ ...c, weekend_open_hour: parseInt(e.target.value) }))}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-cz-3 text-xs mb-1">Weekend lukker (time)</label>
                <input type="number" min="0" max="23" value={editingAuctionConfig.weekend_close_hour}
                  onChange={e => setEditingAuctionConfig(c => ({ ...c, weekend_close_hour: parseInt(e.target.value) }))}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-cz-3 text-xs mb-1">Forlængelse (minutter)</label>
                <input type="number" min="1" max="60" value={editingAuctionConfig.extension_minutes}
                  onChange={e => setEditingAuctionConfig(c => ({ ...c, extension_minutes: parseInt(e.target.value) }))}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveAuctionConfig} disabled={loading.auctionCfg}
                className="px-3 py-1.5 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-xs hover:brightness-110 disabled:opacity-50">
                {loading.auctionCfg ? "Gemmer..." : "Gem"}
              </button>
              <button onClick={() => setEditingAuctionConfig(null)}
                className="px-3 py-1.5 bg-cz-subtle text-cz-2 rounded-lg text-xs hover:bg-cz-subtle">Annuller</button>
            </div>
          </div>
        )}
        {!auctionConfig && <p className="text-cz-3 text-xs">Kør migrationen for at aktivere auktionskonfiguration.</p>}
      </Section>

      {/* ── Discord webhooks ─────────────────────────────────────────────────── */}
      <Section title="Discord webhooks">
        {webhooks.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {webhooks.map(w => (
              <div key={w.id} className="flex items-center justify-between bg-cz-subtle rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-cz-1 text-sm font-medium">{w.webhook_name}</p>
                    {w.webhook_type && w.webhook_type !== "general" && (
                      <span className="text-cz-info text-xs border border-cz-info/30 px-1.5 py-0.5 rounded-full">{w.webhook_type}</span>
                    )}
                  </div>
                  <p className="text-cz-3 text-xs font-mono truncate max-w-xs">{w.webhook_url?.slice(0, 40)}...</p>
                </div>
                <div className="flex gap-2 items-center flex-shrink-0">
                  <button onClick={() => testWebhook(w.webhook_url)} disabled={loading[`test_${w.webhook_url}`]}
                    className="text-cz-3 text-xs hover:text-cz-1 disabled:opacity-50 transition-colors">
                    {loading[`test_${w.webhook_url}`] ? "..." : "Test"}
                  </button>
                  {w.is_default
                    ? <span className="text-cz-accent-t text-xs border border-cz-accent/30 px-2 py-0.5 rounded-full">Standard</span>
                    : <button onClick={() => setDefaultWebhook(w.id)} className="text-cz-3 text-xs hover:text-cz-1">Sæt standard</button>}
                  <button onClick={() => deleteWebhook(w.id)} className="text-cz-danger/50 text-xs hover:text-cz-danger">Slet</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <input type="text" placeholder="Navn" value={newWebhook.webhook_name}
            onChange={e => setNewWebhook(w => ({ ...w, webhook_name: e.target.value }))}
            className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm w-36 focus:outline-none" />
          <input type="text" placeholder="Webhook URL" value={newWebhook.webhook_url}
            onChange={e => setNewWebhook(w => ({ ...w, webhook_url: e.target.value }))}
            className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm flex-1 min-w-[200px] focus:outline-none" />
          <select value={newWebhook.webhook_type}
            onChange={e => setNewWebhook(w => ({ ...w, webhook_type: e.target.value }))}
            className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
            <option value="general">General</option>
            <option value="transfer_history">Transferhistorik</option>
          </select>
          <button onClick={addWebhook}
            className="px-4 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-subtle hover:text-cz-1 transition-all">
            Tilføj
          </button>
        </div>
      </Section>

      {/* ── dyn_cyclist stats sync ──────────────────────────────────────────── */}
      <Section title="dyn_cyclist stats sync">
        <p className="text-cz-3 text-xs mb-4">
          Opdaterer rytterstats fra PCM dyn_cyclist Google Sheet. Match sker på pcm_id (IDcyclist-kolonne).
          Synkroniserer: FL, BJ, KB, BK, TT, PRL, BRO, SP, ACC, NED, UDH, MOD, RES, FTR, højde, vægt, popularitet.
        </p>
        <div className="flex gap-2 flex-wrap items-end mb-3">
          <div className="flex-1">
            <label className="block text-cz-3 text-xs mb-1">Google Sheets URL</label>
            <input type="text" value={dynCyclistUrl} onChange={e => setDynCyclistUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent" />
          </div>
          <button onClick={handleDynCyclistSync} disabled={loading.dyn_cyclist || !dynCyclistUrl}
            className="px-4 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-subtle hover:text-cz-1 disabled:opacity-50 transition-all">
            {loading.dyn_cyclist ? "Synkroniserer..." : "Synkroniser"}
          </button>
        </div>
        {dynSyncResult && (
          <div className="bg-cz-success-bg border border-cz-success/30 rounded-lg px-4 py-3 text-xs">
            <p className="text-cz-success font-semibold mb-1">Sync fuldført</p>
            <div className="flex gap-4 text-green-600">
              <span>Rækker i ark: <strong>{dynSyncResult.rows_in_sheet}</strong></span>
              <span>Opdateret: <strong>{dynSyncResult.rows_matched}</strong></span>
              <span>Ikke fundet: <strong>{dynSyncResult.not_found}</strong></span>
            </div>
          </div>
        )}
      </Section>

      {/* ── Løbsresultater fra Google Sheets ────────────────────────────────── */}
      <Section title="Importer løbsresultater fra Google Sheets">
        <p className="text-cz-3 text-xs mb-4 leading-relaxed">
          Importerer resultater fra et Google Sheet med kolonnerne: <span className="font-mono text-cz-2">Rank, Name, Team, Benævnelse, Løb, Sæson</span>.
          Sæson-kolonnen bestemmer hvilken sæson hvert resultat tilhører — arket kan indeholde flere sæsoner på én gang.
          Løbene skal eksistere i databasen. Re-import sletter og erstatter eksisterende resultater.
        </p>
        <div className="flex gap-2 flex-wrap items-end mb-3">
          <div className="flex-1">
            <label className="block text-cz-3 text-xs mb-1">Google Sheets URL</label>
            <input type="text" value={sheetsUrl} onChange={e => setSheetsUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent" />
          </div>
          <button onClick={handleSheetsImport} disabled={loading.sheets_import || !sheetsUrl}
            className="px-4 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-subtle hover:text-cz-1 disabled:opacity-50 transition-all">
            {loading.sheets_import ? "Importerer..." : "Importer"}
          </button>
        </div>
        {sheetsResult && (
          <div className="bg-cz-success-bg border border-cz-success/30 rounded-lg px-4 py-3 text-xs space-y-2">
            <p className="text-cz-success font-semibold">Import fuldført — {sheetsResult.rows_imported} resultater fra {sheetsResult.races_imported.length} løb</p>
            {sheetsResult.seasons?.length > 0 && (
              <div className="flex gap-4 text-green-600 flex-wrap">
                {sheetsResult.seasons.map(s => (
                  <span key={s.season}>Sæson {s.season}: <strong>{s.races}</strong> løb · <strong>{s.rows}</strong> rækker</span>
                ))}
              </div>
            )}
            {sheetsResult.races_skipped.length > 0 && (
              <p className="text-cz-accent-t">Ikke matchet ({sheetsResult.races_skipped.length}): {sheetsResult.races_skipped.join(", ")}</p>
            )}
          </div>
        )}
      </Section>

      {/* ── Præmieudbetaling ────────────────────────────────────────────────── */}
      <Section title="Præmieudbetaling">
        <p className="text-cz-3 text-xs mb-3">
          Præmier udbetales kun manuelt. Vælg sæson, se hvad der er betalt og hvad der mangler, og godkend udbetaling.
        </p>
        <div className="flex gap-2 flex-wrap items-end mb-4">
          <div>
            <label className="block text-cz-3 text-xs mb-1">Sæson</label>
            <select value={prizePayoutSeason} onChange={e => { setPrizePayoutSeason(e.target.value); setPrizePreview(null); setPrizePayResult(null); }}
              className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent">
              <option value="">Vælg sæson</option>
              {seasons.map(s => <option key={s.id} value={s.id}>Sæson {s.number} ({s.status})</option>)}
            </select>
          </div>
          <button onClick={loadPrizePreview} disabled={loading.prize_preview || !prizePayoutSeason}
            className="px-4 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-subtle hover:text-cz-1 disabled:opacity-50 transition-all">
            {loading.prize_preview ? "Henter..." : "Se status"}
          </button>
        </div>

        {prizePreview && (
          <div className="space-y-4">
            {prizePreview.pending_payment.length > 0 && (
              <div className="bg-cz-accent/10 border border-cz-accent/30 rounded-lg px-4 py-3 text-xs space-y-2">
                <p className="text-cz-accent-t font-semibold">
                  Udestående præmier — {prizePreview.pending_payment.length} løb · i alt {prizePreview.total_pending.toLocaleString("da-DK")} CZ$
                </p>
                <div className="space-y-1">
                  {prizePreview.pending_payment.map(r => (
                    <div key={r.race_id} className="flex justify-between text-cz-accent-t">
                      <span>{r.race_name}</span>
                      <span className="font-mono">{r.total_prize.toLocaleString("da-DK")} CZ$</span>
                    </div>
                  ))}
                </div>
                <button onClick={handlePayPrizes} disabled={loading.prize_pay}
                  className="mt-2 px-4 py-2 bg-cz-accent text-white rounded-lg text-sm font-medium hover:bg-cz-accent/80 disabled:opacity-50 transition-all">
                  {loading.prize_pay ? "Udbetaler..." : `Udbetal ${prizePreview.total_pending.toLocaleString("da-DK")} CZ$ til alle hold`}
                </button>
              </div>
            )}
            {prizePreview.already_paid.length > 0 && (
              <div className="bg-cz-success-bg border border-cz-success/30 rounded-lg px-4 py-3 text-xs space-y-1">
                <p className="text-cz-success font-semibold">Allerede udbetalt — {prizePreview.already_paid.length} løb</p>
                {prizePreview.already_paid.map(r => (
                  <div key={r.race_id} className="flex justify-between text-green-600">
                    <span>{r.race_name}</span>
                    <span className="font-mono">{r.total_paid.toLocaleString("da-DK")} CZ$</span>
                  </div>
                ))}
              </div>
            )}
            {prizePreview.pending_payment.length === 0 && (
              <p className="text-cz-success text-sm font-medium">Alle løb er allerede udbetalt for denne sæson.</p>
            )}
          </div>
        )}

        {prizePayResult && (
          <div className="bg-cz-success-bg border border-cz-success/30 rounded-lg px-4 py-3 text-xs space-y-1">
            <p className="text-cz-success font-semibold">
              Udbetaling gennemført — {prizePayResult.races_paid} løb · {prizePayResult.total_paid.toLocaleString("da-DK")} CZ$
            </p>
            {prizePayResult.by_race?.map(r => (
              <div key={r.race_name} className="flex justify-between text-green-600">
                <span>{r.race_name}</span>
                <span className="font-mono">{r.total_prize.toLocaleString("da-DK")} CZ$</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Brugere ─────────────────────────────────────────────────────────── */}
      <Section title="Brugere">
        {users.length === 0 ? (
          <p className="text-cz-3 text-sm">Ingen brugere endnu.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-cz-border">
            <table className="w-full text-xs min-w-[580px]">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-3 py-2 text-left text-cz-3">Bruger</th>
                  <th className="px-3 py-2 text-left text-cz-3 hidden sm:table-cell">Email</th>
                  <th className="px-3 py-2 text-left text-cz-3">Rolle</th>
                  <th className="px-3 py-2 text-left text-cz-3 hidden md:table-cell">Hold</th>
                  <th className="px-3 py-2 text-right text-cz-3">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-cz-border last:border-0">
                    <td className="px-3 py-2.5">
                      <p className="text-cz-1 font-medium">{u.username}</p>
                      <p className="text-cz-3 text-xs font-mono truncate max-w-[120px]">{u.id.slice(0, 8)}…</p>
                    </td>
                    <td className="px-3 py-2.5 text-cz-2 hidden sm:table-cell">{u.email}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs border px-2 py-0.5 rounded-full ${
                        u.role === "admin"
                          ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                          : "bg-cz-subtle text-cz-2 border-cz-border"
                      }`}>{u.role}</span>
                    </td>
                    <td className="px-3 py-2.5 text-cz-2 hidden md:table-cell">
                      {u.teams?.[0]
                        ? `${u.teams[0].name} (Div ${u.teams[0].division})`
                        : <span className="text-cz-3">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => handleChangeRole(u.id, u.role === "admin" ? "manager" : "admin", u.username)}
                          disabled={loading[`role_${u.id}`]}
                          className="text-xs px-2 py-1 bg-cz-subtle text-cz-2 border border-cz-border rounded hover:text-cz-1 disabled:opacity-50 transition-all">
                          {loading[`role_${u.id}`] ? "..." : u.role === "admin" ? "→ Manager" : "→ Admin"}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u.id, u.username)}
                          disabled={loading[`del_user_${u.id}`]}
                          className="text-xs px-2 py-1 bg-cz-danger-bg text-red-600 border border-cz-danger/30 rounded hover:bg-cz-danger-bg disabled:opacity-50 transition-all">
                          {loading[`del_user_${u.id}`] ? "..." : "Slet"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Beta-testværktøjer ───────────────────────────────────────────────── */}
      <Section title="Beta-testværktøjer">
        <div className="mb-4 flex items-start gap-2 bg-cz-accent/10 border border-cz-accent/30 rounded-lg p-3 text-xs text-cz-accent-t">
          <span className="text-base leading-none mt-0.5">⚠️</span>
          <span>Disse handlinger er destruktive og irreversible. Brug kun under testperioden. AI-holds, bank-hold og frosne hold påvirkes ikke af manager-resettene.</span>
        </div>
        <label className="mb-4 inline-flex items-center gap-2 text-xs text-cz-2 select-none">
          <input
            type="checkbox"
            checked={betaClearTransactions}
            onChange={e => setBetaClearTransactions(e.target.checked)}
            className="rounded border-cz-border text-cz-accent focus:ring-cz-accent"
          />
          Ryd finance-transaktioner for manager-hold ved balance/full reset
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2 mb-4">
          <button
            onClick={() => handleBeta("cancel-market", "Annuller ALLE åbne auktioner, transfers, swaps og låneaftaler?\n\nHandlingen kan ikke fortrydes.")}
            disabled={loading["beta_cancel-market"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["beta_cancel-market"] ? "..." : "Annuller marked"}
          </button>
          <button
            onClick={() => handleBeta("reset-rosters", "Returner ALLE manager-ejede ryttere til deres AI-hold?\n\nHandlingen kan ikke fortrydes.")}
            disabled={loading["beta_reset-rosters"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["beta_reset-rosters"] ? "..." : "Nulstil trupper"}
          </button>
          <button
            onClick={() => handleBeta("reset-balances", `Sæt balance = 800.000 CZ$ på alle manager-holds?${betaClearTransactions ? "\n\nFinance-transaktioner for manager-hold ryddes også." : ""}\n\nHandlingen kan ikke fortrydes.`, { clear_transactions: betaClearTransactions })}
            disabled={loading["beta_reset-balances"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["beta_reset-balances"] ? "..." : "Nulstil balancer"}
          </button>
          <button
            onClick={() => handleBeta("reset-divisions", "Sæt ALLE aktive managerhold tilbage til 3. division?\n\nHandlingen kan ikke fortrydes.")}
            disabled={loading["beta_reset-divisions"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["beta_reset-divisions"] ? "..." : "Nulstil divisioner"}
          </button>
          <button
            onClick={() => handleBeta("reset-board", "Nulstil bestyrelsesprofiler, snapshots og board requests til baseline?\n\nHandlingen kan ikke fortrydes.")}
            disabled={loading["beta_reset-board"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["beta_reset-board"] ? "..." : "Nulstil bestyrelse"}
          </button>
          <button
            onClick={() => handleBeta("reset-transfer-archive", "Slet HELE transferarkivet — alle listings, tilbud og swap-tilbud for manager-hold?\n\nHandlingen kan ikke fortrydes.")}
            disabled={loading["beta_reset-transfer-archive"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["beta_reset-transfer-archive"] ? "..." : "Nulstil transferarkiv"}
          </button>
          <button
            onClick={() => handleBeta("reset-loans", "Slet alle aktive finanslån (inkl. renter) for manager-hold?\n\nHandlingen kan ikke fortrydes.")}
            disabled={loading["beta_reset-loans"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["beta_reset-loans"] ? "..." : "Nulstil lån"}
          </button>
          <button
            onClick={() => handleBeta("reset-notifications", "Ryd indbakken for alle manager-brugere?\n\nHandlingen kan ikke fortrydes.")}
            disabled={loading["beta_reset-notifications"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["beta_reset-notifications"] ? "..." : "Nulstil indbakke"}
          </button>
          <button
            onClick={() => handleBeta("reset-calendar", "Ryd løbskalender, pending resultater, race results, standings og præmiepenge-bonus?\n\nHandlingen kan ikke fortrydes.")}
            disabled={loading["beta_reset-calendar"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["beta_reset-calendar"] ? "..." : "Nulstil løbskalender"}
          </button>
          <button
            onClick={() => handleBeta("reset-seasons", "Ryd ALLE sæsoner?\n\nKør typisk løbskalender-reset først. Handlingen kan ikke fortrydes.")}
            disabled={loading["beta_reset-seasons"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["beta_reset-seasons"] ? "..." : "Nulstil sæsoner"}
          </button>
          <button
            onClick={() => handleBeta("reset-manager-progress", "Nulstil manager XP og level til baseline?\n\nHandlingen kan ikke fortrydes.")}
            disabled={loading["beta_reset-manager-progress"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["beta_reset-manager-progress"] ? "..." : "Nulstil XP/level"}
          </button>
          <button
            onClick={() => handleBeta("reset-achievements", "Ryd alle manager achievement unlocks?\n\nAchievement-definitioner bevares. Handlingen kan ikke fortrydes.")}
            disabled={loading["beta_reset-achievements"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["beta_reset-achievements"] ? "..." : "Nulstil achievements"}
          </button>
          <button
            onClick={() => handleBeta("full-reset", `FULD TEST-NULSTILLING:\n• Alle åbne markedsaktiviteter annulleres\n• Hele transferarkivet slettes (listings, tilbud, swaps)\n• Alle finanslån og renter slettes\n• Indbakke ryddes for alle managers\n• Alle manager-ryttere returneres til AI-hold\n• Alle balancer sættes til 800.000 CZ$\n• Managerhold sættes i 3. division\n• Løbskalender, resultater, standings og præmiepenge-bonus ryddes\n• Sæsoner slettes\n• Board-profiler resettes til baseline\n• XP/level og achievement unlocks nulstilles${betaClearTransactions ? "\n• Finance-transaktioner for manager-hold ryddes" : ""}\n\nDette er en test-reset, ikke et live-reset. Handlingen kan ikke fortrydes. Fortsæt?`, { clear_transactions: betaClearTransactions, reset_mode: "test" })}
            disabled={loading["beta_full-reset"]}
            className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-danger-bg text-cz-danger border border-red-300 rounded-lg hover:bg-cz-danger-bg disabled:opacity-50 transition-all font-semibold">
            {loading["beta_full-reset"] ? "..." : "Fuld nulstilling"}
          </button>
        </div>
        {betaResult && (
          <div className="bg-cz-subtle border border-cz-border rounded-lg p-3 text-xs text-cz-2 font-mono">
            <p className="font-semibold text-cz-2 mb-1">Kvittering — {betaResult.endpoint}</p>
            {betaResult.reset_mode && <p className="mb-1">Reset-type: {betaResult.reset_mode}</p>}
            {betaResult.cancelled && (
              <div className="mb-1">
                <p>Auktioner annulleret: {betaResult.cancelled.auctions}</p>
                <p>Transfer-opslag trukket: {betaResult.cancelled.transfer_listings}</p>
                <p>Transfer-tilbud afvist: {betaResult.cancelled.transfer_offers}</p>
                <p>Swap-tilbud afvist: {betaResult.cancelled.swap_offers}</p>
                <p>Låneaftaler annulleret: {betaResult.cancelled.loan_agreements}</p>
              </div>
            )}
            {betaResult.transfer_archive && (
              <p className="mb-1">Transferarkiv slettet: {betaResult.transfer_archive.transfer_listings} listings · {betaResult.transfer_archive.transfer_offers} tilbud · {betaResult.transfer_archive.swap_offers} swaps</p>
            )}
            {betaResult.loans != null && (
              <p className="mb-1">Finanslån slettet: {betaResult.loans?.loans ?? betaResult.loans}</p>
            )}
            {betaResult.notifications != null && (
              <p className="mb-1">Notifikationer slettet: {betaResult.notifications?.notifications ?? betaResult.notifications}</p>
            )}
            {betaResult.rosters != null && (
              <p className="mb-1">Ryttere flyttet: {betaResult.rosters?.moved ?? betaResult.moved} (til AI: {betaResult.rosters?.to_ai ?? betaResult.to_ai}, til NULL: {betaResult.rosters?.to_null ?? betaResult.to_null})</p>
            )}
            {betaResult.balances != null && (
              <p>Balancer nulstillet: {betaResult.balances?.reset ?? betaResult.reset} hold · finance ryddet: {String(betaResult.balances?.clear_transactions ?? betaResult.clear_transactions ?? false)}</p>
            )}
            {betaResult.divisions && (
              <p className="mb-1">Divisioner nulstillet: {betaResult.divisions.reset} hold til division {betaResult.divisions.division}</p>
            )}
            {betaResult.board_profiles && (
              <p className="mb-1">Bestyrelser reset: {betaResult.board_profiles.reset} · oprettet: {betaResult.board_profiles.created} · snapshots slettet: {betaResult.board_profiles.snapshots_deleted} · requests slettet: {betaResult.board_profiles.requests_deleted}</p>
            )}
            {betaResult.race_calendar && (
              <p className="mb-1">Løbskalender ryddet: {betaResult.race_calendar.races} løb · {betaResult.race_calendar.race_results} resultater · {betaResult.race_calendar.pending_race_results} pending · {betaResult.race_calendar.season_standings} standings</p>
            )}
            {betaResult.seasons && (
              <p className="mb-1">Sæsoner slettet: {betaResult.seasons.seasons}</p>
            )}
            {betaResult.manager_progress && (
              <p className="mb-1">Manager-progress reset: {betaResult.manager_progress.users} brugere · xp_log slettet: {betaResult.manager_progress.xp_log}</p>
            )}
            {betaResult.achievements && (
              <p className="mb-1">Achievement unlocks slettet: {betaResult.achievements.manager_achievements}</p>
            )}
            {betaResult.moved != null && betaResult.rosters == null && (
              <p>Ryttere flyttet: {betaResult.moved} (til AI: {betaResult.to_ai}, til NULL: {betaResult.to_null})</p>
            )}
            {betaResult.reset != null && betaResult.balances == null && (
              <p>Balancer nulstillet: {betaResult.reset} holds</p>
            )}
          </div>
        )}
      </Section>

      {/* ── Admin log ────────────────────────────────────────────────────────── */}
      <Section title="Admin log">
        {adminLogs.length === 0 ? (
          <p className="text-cz-3 text-sm">Ingen handlinger logget endnu.</p>
        ) : (
          <div className="flex flex-col divide-y divide-cz-border">
            {adminLogs.map(log => (
              <div key={log.id} className="py-2.5 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-cz-2 text-xs">{log.description}</p>
                  {log.target_team?.name && <p className="text-cz-3 text-xs mt-0.5">Hold: {log.target_team.name}</p>}
                </div>
                <p className="text-cz-3 text-xs flex-shrink-0">{timeAgo(log.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
