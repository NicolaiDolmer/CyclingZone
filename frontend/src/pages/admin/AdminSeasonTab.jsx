import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { formatCz } from "../../lib/marketValues";
import SeasonCycleSection from "../../components/admin/SeasonCycleSection";
import DeadlineReadinessSection from "../../components/admin/DeadlineReadinessSection";
import AdminSection from "../../components/admin/shared/AdminSection";
import AdminMessageBanner from "../../components/admin/shared/AdminMessageBanner";
import { useAdminAuth } from "../../components/admin/shared/useAdminAuth";

const API = import.meta.env.VITE_API_URL;

export default function AdminSeasonTab() {
  const { getAuth, showMsg, msg } = useAdminAuth();
  const [seasons, setSeasons] = useState([]);
  const [window_, setWindow_] = useState(null);
  const [auctionConfig, setAuctionConfig] = useState(null);
  const [activeAuctions, setActiveAuctions] = useState([]);
  const [closesAtInput, setClosesAtInput] = useState("");
  const [seasonForm, setSeasonForm] = useState({ number: "", race_days_total: 60 });
  const [previewSeason, setPreviewSeason] = useState("");
  const [seasonPreview, setSeasonPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loading, setLoading] = useState({});

  function setLoad(k, v) { setLoading(l => ({ ...l, [k]: v })); }

  async function loadActiveAuctions() {
    try {
      const res = await fetch(`${API}/api/admin/auctions/active`, { headers: await getAuth() });
      const data = await res.json();
      if (res.ok) setActiveAuctions(data.auctions || []);
    } catch { /* silent */ }
  }

  async function loadData() {
    const [s, w, ac] = await Promise.all([
      supabase.from("seasons").select("*").order("number", { ascending: false }),
      supabase.from("transfer_windows").select("*").order("created_at", { ascending: false }).limit(1).single(),
      supabase.from("auction_timing_config").select("*").eq("id", 1).single(),
    ]);
    setSeasons(s.data || []);
    setWindow_(w.data || null);
    setAuctionConfig(ac.data || null);
    loadActiveAuctions();
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadData only on mount; handlers call it explicitly
  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (window_?.closes_at) {
      const d = new Date(window_.closes_at);
      const pad = n => String(n).padStart(2, "0");
      setClosesAtInput(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
  }, [window_?.closes_at]);

  async function handleCreateSeason(e) {
    e.preventDefault(); setLoad("season", true);
    const res = await fetch(`${API}/api/admin/seasons`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({ number: parseInt(seasonForm.number), race_days_total: parseInt(seasonForm.race_days_total) }),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ Sæson ${data.number} oprettet`); loadData(); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("season", false);
  }

  async function handleSeasonAction(seasonId, action) {
    if (action === "end" && !confirm("Afslut sæson? Dette kører divisionsbonus, op/nedrykning (fra sæson 3) og board-eval. Løn + renter trækkes IKKE her — det er flyttet til næste sæsons start (v3.78).")) return;
    setLoad(`${action}_${seasonId}`, true);
    const res = await fetch(`${API}/api/admin/seasons/${seasonId}/${action}`, {
      method: "POST", headers: await getAuth(),
    });
    const data = await res.json();
    if (res.ok) showMsg(`✅ ${action === "start" ? "Sæson startet" : "Sæson afsluttet"}`);
    else showMsg(`❌ ${data.error}`, "error");
    setLoad(`${action}_${seasonId}`, false);
    loadData();
  }

  async function handleRebuildStandings(seasonId) {
    if (!confirm("Genberegn standings for denne sæson ud fra gemte løbsresultater?")) return;
    setLoad(`rebuild_${seasonId}`, true);
    const res = await fetch(`${API}/api/admin/seasons/${seasonId}/rebuild-standings`, {
      method: "POST", headers: await getAuth(),
    });
    const data = await res.json();
    if (res.ok) {
      const warning = data.start_date_missing ? " Advarsel: sæsonen mangler stadig startdato i databasen." : "";
      showMsg(`✅ Standings genberegnet for ${data.rows_updated} hold.${warning}`);
    } else {
      showMsg(`❌ ${data.error}`, "error");
    }
    setLoad(`rebuild_${seasonId}`, false);
    loadData();
  }

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
    loadData();
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
    loadData();
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
    loadData();
  }

  async function handleCancelAuction(auction) {
    const riderName = `${auction.rider?.firstname || ""} ${auction.rider?.lastname || ""}`.trim() || "rytter";
    const bidderCount = auction.unique_bidder_count || 0;
    if (!confirm(`Annullér auktion på ${riderName}?\n\n${bidderCount} budgivere notificeres. Bud frigives automatisk.`)) return;
    setLoad(`cancel_auction_${auction.id}`, true);
    const res = await fetch(`${API}/api/admin/auctions/${auction.id}/cancel`, {
      method: "POST", headers: await getAuth(),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ ${data.message}`); loadActiveAuctions(); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad(`cancel_auction_${auction.id}`, false);
  }

  async function loadSeasonPreview() {
    if (!previewSeason) { showMsg("❌ Vælg en sæson", "error"); return; }
    setLoadingPreview(true);
    const res = await fetch(`${API}/api/admin/season-end-preview/${previewSeason}`, { headers: await getAuth() });
    const data = await res.json();
    if (res.ok) setSeasonPreview(data.preview);
    else showMsg(`❌ ${data.error}`, "error");
    setLoadingPreview(false);
  }

  const windowOpen = window_?.status === "open";
  const statusColor = { upcoming: "text-cz-2", active: "text-cz-success", completed: "text-cz-3" };
  const statusLabel = { upcoming: "Kommende", active: "Aktiv", completed: "Afsluttet" };

  return (
    <>
      <AdminMessageBanner msg={msg} />

      <AdminSection title="🔄 Sæson-cyklus">
        <SeasonCycleSection getAuth={getAuth} onMsg={showMsg} />
      </AdminSection>

      <AdminSection title="🚦 Klar til deadline?">
        <DeadlineReadinessSection getAuth={getAuth} onMsg={showMsg} />
      </AdminSection>

      <AdminSection title="Transfervindue">
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
      </AdminSection>

      <AdminSection title="Sæsoner">
        {seasons.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            {seasons.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-cz-subtle rounded-lg px-4 py-3">
                <div>
                  <span className="text-cz-1 font-medium text-sm">Sæson {s.number}</span>
                  <span className={`ms-3 text-xs ${statusColor[s.status]}`}>{statusLabel[s.status]}</span>
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
      </AdminSection>

      <AdminSection title="Aktive auktioner">
        {activeAuctions.length === 0 ? (
          <p className="text-cz-3 text-xs">Ingen aktive eller forlængede auktioner.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {activeAuctions.map(a => {
              const riderName = `${a.rider?.firstname || ""} ${a.rider?.lastname || ""}`.trim() || "—";
              const sellerName = a.seller?.name || (a.seller_team_id ? "(ukendt sælger)" : "AI");
              const endTxt = a.calculated_end
                ? new Date(a.calculated_end).toLocaleString("da-DK", { timeZoneName: "short" })
                : "—";
              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 bg-cz-subtle rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-cz-1 text-sm font-medium">
                      {riderName}
                      {a.is_flash && <span className="ms-2 text-cz-3 text-xs">(flash)</span>}
                      {a.is_guaranteed_sale && <span className="ms-2 text-cz-3 text-xs">(garanteret)</span>}
                    </p>
                    <p className="text-cz-3 text-xs">
                      Sælger: {sellerName} · Pris: {formatCz(a.current_price)} · Bud: {a.unique_bidder_count} · Slutter: {endTxt}
                      {a.status === "extended" && <span className="ms-2 text-cz-warn">forlænget</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => handleCancelAuction(a)}
                    disabled={loading[`cancel_auction_${a.id}`]}
                    className="px-3 py-1.5 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-xs hover:brightness-110 disabled:opacity-50 transition-all">
                    {loading[`cancel_auction_${a.id}`] ? "Annullerer..." : "Annullér"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-cz-3 text-xs mt-3">Annullering frigiver alle bud (balance er aldrig deduceret) og notificerer budgivere + sælger.</p>
      </AdminSection>

      <AdminSection title="Sæson-transition preview (næste sæson-start)">
        <p className="text-cz-3 text-xs mb-3">
          v3.78: Sponsor, lånerenter og lønninger udbetales nu ved STARTEN af næste sæson (samtidig). Tabellen viser samlet cashflow ved sæsonskiftet i den rækkefølge engine&apos;n kører: balance + sponsor − renter − løn = balance efter start. Nødlån oprettes hvis resultatet er negativt.
        </p>
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="flex-1">
            <label className="block text-cz-3 text-xs mb-1">Vælg sæson (den sæson der afsluttes)</label>
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
            <table className="w-full text-xs min-w-[760px]">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-3 py-2 text-left text-cz-3">Hold</th>
                  <th className="px-3 py-2 text-right text-cz-3">Balance</th>
                  <th className="px-3 py-2 text-right text-cz-3">+ Sponsor (start)</th>
                  <th className="px-3 py-2 text-right text-cz-3">− Renter</th>
                  <th className="px-3 py-2 text-right text-cz-3">− Løn</th>
                  <th className="px-3 py-2 text-right text-cz-3">Balance efter start</th>
                  <th className="px-3 py-2 text-right text-cz-3">Nødlån?</th>
                  <th className="px-3 py-2 text-right text-cz-3">Tilfredshed</th>
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
                    <td className="px-3 py-2 text-right text-cz-accent-t font-mono">+{row.next_season_sponsor?.toLocaleString("da-DK")}</td>
                    <td className="px-3 py-2 text-right text-cz-warning font-mono">
                      {row.loan_interest > 0 ? `-${row.loan_interest?.toLocaleString("da-DK")}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-cz-danger font-mono">-{row.salary_deduction?.toLocaleString("da-DK")}</td>
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
                    <td className="px-3 py-2 text-right text-cz-2 font-mono">#{row.current_rank || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {seasonPreview && (
          <p className="text-cz-3 text-xs mt-2">
            Preview er ikke bindende. Udfør sæsonskiftet via &quot;Udfør sæsonskifte&quot;-knappen i Sæson-cyklus-sektionen ovenfor.
          </p>
        )}
      </AdminSection>
    </>
  );
}
