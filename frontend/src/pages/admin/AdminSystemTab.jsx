import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import AdminSection from "../../components/admin/shared/AdminSection";
import AdminMessageBanner from "../../components/admin/shared/AdminMessageBanner";
import { adminErrorMessage, readAdminJson, useAdminAuth } from "../../components/admin/shared/useAdminAuth";
import BetaToolsSection from "../../components/admin/sections/BetaToolsSection";
import BoardTestModeSection from "../../components/admin/sections/BoardTestModeSection";

const API = import.meta.env.VITE_API_URL;

const BETA_ENABLED = import.meta.env.DEV
  || import.meta.env.VITE_ENABLE_BETA_TOOLS === "true";

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

export default function AdminSystemTab() {
  const { getAuth, showMsg, msg } = useAdminAuth();
  const [webhooks, setWebhooks] = useState([]);
  const [adminLogs, setAdminLogs] = useState([]);
  const [marketPause, setMarketPause] = useState({ level: "none", pausedAt: null, reason: null });
  const [newWebhook, setNewWebhook] = useState({ webhook_name: "", webhook_url: "", webhook_type: "general" });
  const [webhookTestResults, setWebhookTestResults] = useState({});
  const [loading, setLoading] = useState({});

  function setLoad(k, v) { setLoading(l => ({ ...l, [k]: v })); }

  async function loadData() {
    // #517/#1180: discord_settings ejes af backend (RLS-lockdown 2026-05-22) —
    // frontend får kun maskerede URLs (webhook_url_masked), aldrig den rå secret.
    const webhooksPromise = (async () => {
      try {
        const res = await fetch(`${API}/api/admin/discord-settings`, { headers: await getAuth() });
        if (!res.ok) return { webhooks: [] };
        return await res.json();
      } catch { return { webhooks: [] }; }
    })();

    const [w, al, ac] = await Promise.all([
      webhooksPromise,
      supabase.from("admin_log").select("*, target_team:target_team_id(name)")
        .order("created_at", { ascending: false }).limit(50),
      supabase.from("auction_timing_config").select("*").eq("id", 1).single(),
    ]);
    setWebhooks(w.webhooks || []);
    setAdminLogs(al.data || []);
    setMarketPause({
      level: ac.data?.market_pause_level || "none",
      pausedAt: ac.data?.market_paused_at || null,
      reason: ac.data?.market_paused_reason || null,
    });
  }

  useEffect(() => { loadData(); }, []);

  async function pauseMarket(level) {
    const scopeText = level === "all" ? "HELE markedet (auktioner + transfers + bytter + lejeaftaler + bank-lån)" : "alle auktioner";
    const reason = window.prompt(`Pause ${scopeText}?\n\nÅrsag (vises til managere):`, "");
    if (reason === null) return;
    setLoad(`pause_${level}`, true);
    try {
      const res = await fetch(`${API}/api/admin/market/pause`, {
        method: "POST", headers: await getAuth(),
        body: JSON.stringify({ level, reason: reason || null }),
      });
      const data = await readAdminJson(res);
      if (res.ok) {
        showMsg(`✅ ${level === "all" ? "Hele markedet pauset" : "Auktioner pauset"}`);
        loadData();
        window.dispatchEvent(new Event("cz:market-pause-changed"));
      } else {
        showMsg(`❌ ${adminErrorMessage(data, res)}`, "error");
      }
    } catch (e) {
      showMsg(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad(`pause_${level}`, false);
    }
  }

  async function resumeMarket() {
    if (!confirm("Genoptag markedet?\n\nAuktioners slut-tid skubbes frem med pause-varigheden, så bydere får samme resterende tid som før.")) return;
    setLoad("market_resume", true);
    try {
      const res = await fetch(`${API}/api/admin/market/resume`, {
        method: "POST", headers: await getAuth(),
      });
      const data = await readAdminJson(res);
      if (res.ok) {
        showMsg(`✅ Marked genoptaget · ${data.auctions_shifted} auktioner forlænget med ${data.elapsed_minutes} min`);
        loadData();
        window.dispatchEvent(new Event("cz:market-pause-changed"));
      } else {
        showMsg(`❌ ${adminErrorMessage(data, res)}`, "error");
      }
    } catch (e) {
      showMsg(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad("market_resume", false);
    }
  }

  async function addWebhook() {
    if (!newWebhook.webhook_name || !newWebhook.webhook_url) return;
    setLoad("webhook_add", true);
    try {
      const res = await fetch(`${API}/api/admin/discord-settings`, {
        method: "POST", headers: await getAuth(),
        body: JSON.stringify({
          webhook_name: newWebhook.webhook_name,
          webhook_url: newWebhook.webhook_url,
          webhook_type: newWebhook.webhook_type,
        }),
      });
      const data = await readAdminJson(res);
      if (!res.ok) { showMsg(`❌ ${adminErrorMessage(data, res)}`, "error"); return; }
      setNewWebhook({ webhook_name: "", webhook_url: "", webhook_type: "general" });
      loadData();
      showMsg("✅ Webhook tilføjet" + (data.is_default ? " og sat som standard" : ""));
    } catch (e) {
      showMsg(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad("webhook_add", false);
    }
  }

  async function testWebhook(webhook) {
    setLoad(`test_${webhook.id}`, true);
    try {
      // Test via gemt URL server-side — klienten kender ikke længere den rå webhook_url.
      const res = await fetch(`${API}/api/admin/discord-settings/${webhook.id}/test`, {
        method: "POST", headers: await getAuth(),
      });
      const data = await readAdminJson(res);
      setWebhookTestResults(prev => ({
        ...prev,
        [webhook.id]: res.ok ? data : { ok: false, status: res.status, error: adminErrorMessage(data, res) },
      }));
    } catch (e) {
      setWebhookTestResults(prev => ({
        ...prev,
        [webhook.id]: { ok: false, status: 0, error: e.message || "ukendt" },
      }));
      showMsg("❌ Forbindelsen fejlede", "error");
    } finally {
      setLoad(`test_${webhook.id}`, false);
    }
  }

  function formatWebhookTest(result) {
    if (!result) return null;
    if (result.ok) {
      const t = new Date(result.timestamp).toLocaleTimeString("da-DK");
      return { tone: "ok", text: `✅ leveret (${result.status}) · ${t}` };
    }
    if (result.status === 404) return { tone: "err", text: "❌ 404 · webhook ikke fundet (slettet på Discord?)" };
    if (result.status === 401 || result.status === 403) return { tone: "err", text: `❌ ${result.status} · adgang afvist (token revoket?)` };
    if (result.status === 429) return { tone: "err", text: "❌ 429 · rate-limited af Discord" };
    if (result.status === 0) return { tone: "err", text: `❌ netværksfejl · ${(result.error || "ukendt").slice(0, 80)}` };
    return { tone: "err", text: `❌ ${result.status} · ${(result.error || "").slice(0, 80)}` };
  }

  async function setDefaultWebhook(id) {
    const res = await fetch(`${API}/api/admin/discord-settings/${id}/default`, {
      method: "PATCH", headers: await getAuth(),
    });
    if (!res.ok) { const d = await readAdminJson(res); showMsg(`❌ ${adminErrorMessage(d, res)}`, "error"); return; }
    loadData();
    showMsg("✅ Standard webhook opdateret");
  }

  async function deleteWebhook(id) {
    const res = await fetch(`${API}/api/admin/discord-settings/${id}`, {
      method: "DELETE", headers: await getAuth(),
    });
    if (!res.ok) { const d = await readAdminJson(res); showMsg(`❌ ${adminErrorMessage(d, res)}`, "error"); return; }
    loadData();
  }

  return (
    <>
      <AdminMessageBanner msg={msg} />

      <AdminSection title="Marked-pause">
        <p className="text-cz-3 text-xs mb-3">
          Brug i nødstilfælde — fryser auktioners slut-tid og blokerer nye bud/handler.
          Ved genoptagelse skubbes auktionernes calculated_end frem med pause-varigheden.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => pauseMarket("auctions")}
            disabled={marketPause.level !== "none" || loading.pause_auctions}
            className="px-4 py-2 bg-cz-warning-bg text-cz-warning border border-cz-warning/30 rounded-lg text-sm font-medium hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading.pause_auctions ? "..." : "🛑 Frys auktioner"}
          </button>
          <button
            onClick={() => pauseMarket("all")}
            disabled={marketPause.level === "all" || loading.pause_all}
            className="px-4 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-sm font-medium hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading.pause_all ? "..." : "🛑 Frys hele markedet"}
          </button>
          <button
            onClick={resumeMarket}
            disabled={marketPause.level === "none" || loading.market_resume}
            className="px-4 py-2 bg-cz-success-bg text-cz-success border border-cz-success/30 rounded-lg text-sm font-medium hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading.market_resume ? "..." : "▶ Genoptag"}
          </button>
        </div>
        <p className="text-cz-3 text-xs mt-3">
          <strong>Frys auktioner:</strong> nye bud, autobud-loft og oprettelse af auktioner blokeres. Cron pauser finalisering.<br/>
          <strong>Frys hele markedet:</strong> ovenstående + transfertilbud, byttehandler, lejeaftaler og bank-lån. Cleanup-handlinger (annuller/afvis/træk-tilbage) virker stadig.
        </p>
      </AdminSection>

      <AdminSection title="Discord webhooks">
        {webhooks.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {webhooks.map(w => {
              const result = formatWebhookTest(webhookTestResults[w.id]);
              return (
              <div key={w.id} className="flex items-center justify-between bg-cz-subtle rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-cz-1 text-sm font-medium">{w.webhook_name}</p>
                    {w.webhook_type && w.webhook_type !== "general" && (
                      <span className="text-cz-info text-xs border border-cz-info/30 px-1.5 py-0.5 rounded-full">{w.webhook_type}</span>
                    )}
                  </div>
                  <p className="text-cz-3 text-xs font-mono truncate max-w-xs">{w.webhook_url_masked}</p>
                  {result && (
                    <p className={`text-xs font-mono mt-1 ${result.tone === "ok" ? "text-cz-accent-t" : "text-cz-danger"}`}>
                      {result.text}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 items-center flex-shrink-0">
                  <button onClick={() => testWebhook(w)} disabled={loading[`test_${w.id}`]}
                    className="text-cz-3 text-xs hover:text-cz-1 disabled:opacity-50 transition-colors">
                    {loading[`test_${w.id}`] ? "..." : "Test"}
                  </button>
                  {w.is_default
                    ? <span className="text-cz-accent-t text-xs border border-cz-accent/30 px-2 py-0.5 rounded-full">Standard</span>
                    : <button onClick={() => setDefaultWebhook(w.id)} className="text-cz-3 text-xs hover:text-cz-1">Sæt standard</button>}
                  <button onClick={() => deleteWebhook(w.id)} className="text-cz-danger/50 text-xs hover:text-cz-danger">Slet</button>
                </div>
              </div>
              );
            })}
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
          <button onClick={addWebhook} disabled={loading.webhook_add}
            className="px-4 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-subtle hover:text-cz-1 transition-all disabled:opacity-50">
            {loading.webhook_add ? "..." : "Tilføj"}
          </button>
        </div>
      </AdminSection>

      <AdminSection title="Admin log">
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
      </AdminSection>

      {/* #805/#1062 · Board-åbning: admin-handling for en live feature — altid
          synlig for admin (uden for BETA_ENABLED-gaten, modsat de destruktive resets). */}
      <AdminSection title="Bestyrelse — åbn for test (frosset) eller live (ægte økonomi)">
        <BoardTestModeSection getAuth={getAuth} onMsg={showMsg} />
      </AdminSection>

      {BETA_ENABLED && (
        <AdminSection title="Beta-testværktøjer">
          <BetaToolsSection getAuth={getAuth} onMsg={showMsg} />
        </AdminSection>
      )}
    </>
  );
}
