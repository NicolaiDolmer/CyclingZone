import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import EconomyAdminSection from "../../components/admin/EconomyAdminSection";
import ValuationPreviewSection from "../../components/admin/ValuationPreviewSection";
import AdminSection from "../../components/admin/shared/AdminSection";
import AdminMessageBanner from "../../components/admin/shared/AdminMessageBanner";
import { adminErrorMessage, readAdminJson, useAdminAuth } from "../../components/admin/shared/useAdminAuth";

const API = import.meta.env.VITE_API_URL;

const loanTypeLabels = { short: "Kort lån", long: "Langt lån", emergency: "Nødlån" };

export default function AdminEconomyTab() {
  const { getAuth, showMsg, msg } = useAdminAuth();
  const [seasons, setSeasons] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loanConfigs, setLoanConfigs] = useState([]);
  const [auctionConfig, setAuctionConfig] = useState(null);
  const [editingLoan, setEditingLoan] = useState(null);
  const [editingAuctionConfig, setEditingAuctionConfig] = useState(null);
  const [balTeam, setBalTeam] = useState("");
  const [balAmount, setBalAmount] = useState("");
  const [balReason, setBalReason] = useState("");
  const [prizePayoutSeason, setPrizePayoutSeason] = useState("");
  const [prizePreview, setPrizePreview] = useState(null);
  const [prizePayResult, setPrizePayResult] = useState(null);
  const [loading, setLoading] = useState({});

  function setLoad(k, v) { setLoading(l => ({ ...l, [k]: v })); }

  async function loadData() {
    const [s, t, lc, ac] = await Promise.all([
      supabase.from("seasons").select("*").order("number", { ascending: false }),
      supabase.from("teams").select("id,name,balance,division").eq("is_ai", false).order("name"),
      supabase.from("loan_config").select("*").order("division").order("loan_type"),
      supabase.from("auction_timing_config").select("*").eq("id", 1).single(),
    ]);
    setSeasons(s.data || []);
    setTeams(t.data || []);
    setLoanConfigs(lc.data || []);
    setAuctionConfig(ac.data || null);
  }

  useEffect(() => { loadData(); }, []);

  async function handleAdjustBalance() {
    if (!balTeam || !balAmount) { showMsg("❌ Vælg hold og angiv beløb", "error"); return; }
    setLoad("balance", true);
    try {
      const res = await fetch(`${API}/api/admin/adjust-balance`, {
        method: "POST", headers: await getAuth(),
        body: JSON.stringify({ team_id: balTeam, amount: parseInt(balAmount), reason: balReason }),
      });
      const data = await readAdminJson(res);
      if (res.ok) { showMsg(`✅ Balance justeret med ${parseInt(balAmount).toLocaleString("da-DK")} CZ$`); setBalAmount(""); setBalReason(""); loadData(); }
      else showMsg(`❌ ${adminErrorMessage(data, res)}`, "error");
    } catch (e) {
      showMsg(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad("balance", false);
    }
  }

  async function saveLoanConfig(cfg) {
    try {
      const res = await fetch(`${API}/api/admin/loan-config`, {
        method: "PATCH", headers: await getAuth(), body: JSON.stringify(cfg),
      });
      const data = await readAdminJson(res);
      if (res.ok) { showMsg("✅ Lånekonfiguration gemt"); setEditingLoan(null); loadData(); }
      else showMsg(`❌ ${adminErrorMessage(data, res)}`, "error");
    } catch (e) {
      showMsg(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    }
  }

  async function saveAuctionConfig() {
    if (!editingAuctionConfig) return;
    setLoad("auctionCfg", true);
    try {
      const res = await fetch(`${API}/api/admin/auction-config`, {
        method: "PUT", headers: await getAuth(), body: JSON.stringify(editingAuctionConfig),
      });
      const data = await readAdminJson(res);
      if (res.ok) { showMsg("✅ Auktionsregler gemt"); setEditingAuctionConfig(null); loadData(); }
      else showMsg(`❌ ${adminErrorMessage(data, res)}`, "error");
    } catch (e) {
      showMsg(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad("auctionCfg", false);
    }
  }

  async function loadPrizePreview() {
    if (!prizePayoutSeason) { showMsg("❌ Vælg en sæson", "error"); return; }
    setLoad("prize_preview", true);
    setPrizePreview(null);
    setPrizePayResult(null);
    try {
      const res = await fetch(`${API}/api/admin/prize-payout-preview?season_id=${prizePayoutSeason}`, {
        headers: await getAuth(),
      });
      const data = await readAdminJson(res);
      if (res.ok) setPrizePreview(data);
      else showMsg(`❌ ${adminErrorMessage(data, res)}`, "error");
    } catch (e) {
      showMsg(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad("prize_preview", false);
    }
  }

  async function handlePayPrizes() {
    if (!prizePayoutSeason) { showMsg("❌ Vælg en sæson", "error"); return; }
    const pendingRaces = prizePreview?.pending_payment?.length ?? 0;
    const pendingTotal = prizePreview?.total_pending ?? 0;
    if (pendingRaces === 0) { showMsg("❌ Ingen udestående præmier — kør forhåndsvisning først", "error"); return; }
    if (!confirm(`Udbetal ${pendingTotal.toLocaleString("da-DK")} CZ$ i præmiepenge til hold på tværs af ${pendingRaces} løb?\n\nDette krediterer holdenes balance med det samme og kan ikke fortrydes.`)) return;
    setLoad("prize_pay", true);
    try {
      const res = await fetch(`${API}/api/admin/pay-prizes-to-date`, {
        method: "POST", headers: await getAuth(),
        body: JSON.stringify({ season_id: prizePayoutSeason }),
      });
      const data = await readAdminJson(res);
      if (res.ok) {
        setPrizePayResult(data);
        setPrizePreview(null);
        showMsg(`✅ ${data.races_paid} løb betalt — i alt ${data.total_paid.toLocaleString("da-DK")} CZ$`);
      } else {
        showMsg(`❌ ${adminErrorMessage(data, res)}`, "error");
      }
    } catch (e) {
      showMsg(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad("prize_pay", false);
    }
  }

  return (
    <>
      <AdminMessageBanner msg={msg} />

      <AdminSection title="Økonomi">
        <EconomyAdminSection getAuth={getAuth} onMsg={showMsg} />
      </AdminSection>

      <AdminSection title="Rytter-værdi: ny model (forhåndsvisning · #1101)">
        <ValuationPreviewSection getAuth={getAuth} onMsg={showMsg} />
      </AdminSection>

      <AdminSection title="Manuel balancejustering">
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
      </AdminSection>

      <AdminSection title="Lånekonfiguration">
        {loanConfigs.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-cz-border mb-3">
            <table data-sort-exempt="Fast laane-konfiguration, faa raekker" className="w-full text-xs">
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
      </AdminSection>

      <AdminSection title="Auktionsregler">
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
      </AdminSection>

      <AdminSection title="Præmieudbetaling">
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
            {prizePreview.totals && (
              <div className="bg-cz-subtle border border-cz-border rounded-lg px-4 py-3 text-xs">
                <p className="text-cz-2 font-semibold mb-2">Sæson-total (completed-løb)</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-cz-3">Optjent</div>
                    <div className="text-cz-1 font-mono font-semibold">{prizePreview.totals.earned.toLocaleString("da-DK")}</div>
                  </div>
                  <div>
                    <div className="text-cz-3">Udbetalbar</div>
                    <div className="text-cz-accent-t font-mono font-semibold">{prizePreview.totals.payable.toLocaleString("da-DK")}</div>
                  </div>
                  <div>
                    <div className="text-cz-3">Fri/AI (udbetales aldrig)</div>
                    <div className="text-cz-3 font-mono font-semibold">{prizePreview.totals.free_ai.toLocaleString("da-DK")}</div>
                  </div>
                </div>
              </div>
            )}

            {prizePreview.team_totals?.length > 0 && (
              <div className="bg-cz-subtle border border-cz-border rounded-lg px-4 py-3 text-xs">
                <p className="text-cz-2 font-semibold mb-2">Pr. hold — hvad hvert hold står til at tjene</p>
                <div className="overflow-x-auto">
                  <table data-sort-exempt="Admin praemie-oversigt; sortering er opfoelgning" className="w-full">
                    <thead>
                      <tr className="text-cz-3 border-b border-cz-border">
                        <th className="text-left font-medium py-1 pe-2">Hold</th>
                        <th className="text-right font-medium py-1 px-2">Udestående</th>
                        <th className="text-right font-medium py-1 px-2">Udbetalt</th>
                        <th className="text-right font-medium py-1 ps-2">I alt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prizePreview.team_totals.map(tt => (
                        <tr key={tt.team_id} className="border-b border-cz-border/50 last:border-0">
                          <td className="py-1 pe-2 text-cz-1">{tt.team_name ?? tt.team_id}</td>
                          <td className="py-1 px-2 text-right font-mono text-cz-accent-t">{tt.pending.toLocaleString("da-DK")}</td>
                          <td className="py-1 px-2 text-right font-mono text-cz-3">{tt.paid.toLocaleString("da-DK")}</td>
                          <td className="py-1 ps-2 text-right font-mono font-semibold text-cz-1">{tt.total.toLocaleString("da-DK")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {prizePreview.warnings?.length > 0 && (
              <div className="bg-cz-warning-bg border border-cz-warning/30 rounded-lg px-4 py-3 text-xs space-y-1">
                <p className="text-cz-warning font-semibold">⚠️ Advarsler — {prizePreview.warnings.length} løb</p>
                {prizePreview.warnings.map(w => (
                  <div key={w.race_id} className="flex justify-between gap-3 text-cz-warning">
                    <span className="font-medium">{w.race_name}</span>
                    <span className="text-right text-cz-3">{w.message}</span>
                  </div>
                ))}
              </div>
            )}

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
                {prizePreview.already_paid.map(r => {
                  const rec = prizePreview.reconciliation?.find(x => x.race_id === r.race_id);
                  const mismatch = rec && !rec.ok;
                  return (
                    <div key={r.race_id} className={`flex justify-between ${mismatch ? "text-cz-warning" : "text-green-600"}`}>
                      <span>{mismatch ? "⚠️ " : ""}{r.race_name}</span>
                      <span className="font-mono">
                        {r.total_paid.toLocaleString("da-DK")} CZ$
                        {mismatch && (
                          <span className="ms-2 text-cz-3" title={`Udbetalt ${rec.finance_total.toLocaleString("da-DK")} vs. resultat-sum ${rec.results_total.toLocaleString("da-DK")}`}>
                            (afvigelse {rec.diff > 0 ? "+" : ""}{rec.diff.toLocaleString("da-DK")})
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
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
      </AdminSection>
    </>
  );
}
