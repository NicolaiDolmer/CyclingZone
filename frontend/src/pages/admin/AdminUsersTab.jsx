import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { applyNameSearch } from "../../lib/riderNameSearch";
import { formatCz, getRiderMarketValue } from "../../lib/marketValues";
import AdminSection from "../../components/admin/shared/AdminSection";
import AdminMessageBanner from "../../components/admin/shared/AdminMessageBanner";
import { adminErrorMessage, readAdminJson, useAdminAuth } from "../../components/admin/shared/useAdminAuth";

const API = import.meta.env.VITE_API_URL;

function ManualOverride({ getAuth, onMsg, onRefresh, teams }) {
  const [query, setQuery] = useState("");
  const [riderResults, setRiderResults] = useState([]);
  const [selectedRider, setSelectedRider] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [loading, setLoading] = useState(false);

  async function searchRiders(q) {
    setQuery(q);
    if (q.length < 2) { setRiderResults([]); return; }
    let query = supabase.from("riders")
      .select("id, firstname, lastname, uci_points, market_value, prize_earnings_bonus, is_retired, team:team_id(name)")
      .limit(5);
    query = applyNameSearch(query, q); // #47: token-set match (fornavn + efternavn)
    const { data } = await query;
    setRiderResults(data || []);
  }

  async function moveRider() {
    if (!selectedRider) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/override-rider`, {
        method: "POST", headers: await getAuth(),
        body: JSON.stringify({ rider_id: selectedRider.id, team_id: selectedTeam || null }),
      });
      const data = await readAdminJson(res);
      if (res.ok) { onMsg(`✅ ${data.message}`); setSelectedRider(null); setQuery(""); onRefresh(); }
      else onMsg(`❌ ${adminErrorMessage(data, res)}`, "error");
    } catch (e) {
      onMsg(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function setRetirement(isRetired) {
    if (!selectedRider) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/riders/${selectedRider.id}/retirement`, {
        method: "POST", headers: await getAuth(),
        body: JSON.stringify({ is_retired: isRetired }),
      });
      const data = await readAdminJson(res);
      if (res.ok) {
        onMsg(`✅ ${data.message}`);
        setSelectedRider(r => r ? { ...r, is_retired: isRetired } : r);
        onRefresh();
      } else {
        onMsg(`❌ ${adminErrorMessage(data, res)}`, "error");
      }
    } catch (e) {
      onMsg(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoading(false);
    }
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
                <p className="text-cz-3 text-xs">
                  {r.team?.name || "Fri agent"} — {formatCz(getRiderMarketValue(r))}
                  {r.is_retired && <span className="ms-2 text-cz-danger">Pensioneret</span>}
                </p>
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
        <div className="w-full grid grid-cols-1 gap-2">
          <button onClick={moveRider} disabled={loading || !selectedRider}
            className="w-full px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm
              hover:brightness-110 disabled:opacity-50 transition-all">
            {loading ? "Arbejder..." : "Flyt rytter"}
          </button>
          {selectedRider && (
            <button
              onClick={() => setRetirement(!selectedRider.is_retired)}
              disabled={loading}
              className={`w-full px-4 py-2 font-bold rounded-lg text-sm border transition-all disabled:opacity-50
                ${selectedRider.is_retired
                  ? "bg-cz-success-bg0/20 text-cz-success border-cz-success/30"
                  : "bg-cz-danger-bg0/20 text-cz-danger border-cz-danger/30"}`}
            >
              {selectedRider.is_retired ? "Aktivér rytter" : "Pensionér rytter"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminUsersTab() {
  const { getAuth, showMsg, msg } = useAdminAuth();
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState({});

  function setLoad(k, v) { setLoading(l => ({ ...l, [k]: v })); }

  async function loadData() {
    const [u, t] = await Promise.all([
      supabase.from("users").select("id, email, username, role, created_at, teams(id, name, division, is_test_account)").order("created_at", { ascending: false }),
      supabase.from("teams").select("id,name,balance,division").eq("is_ai", false).order("name"),
    ]);
    setUsers(u.data || []);
    setTeams(t.data || []);
  }

  useEffect(() => { loadData(); }, []);

  async function handleDeleteUser(userId, username, isTestAccount) {
    if (!confirm(`Slet bruger "${username}" permanent?\n\nHoldet bevares, men mister sin ejer. Notifikationer slettes.`)) return;
    // #2245: test-a/b/seller er permanente og er blevet slettet ved fejl under bulk-oprydning
    // af disposable workflow-exec-konti — kræv at admin skriver navnet for netop disse.
    if (isTestAccount) {
      const typed = prompt(`"${username}" er en PERMANENT test-konto (bruges til preview-login). Skriv brugernavnet for at bekræfte sletning:`);
      if (typed !== username) { showMsg("Sletning annulleret — navn matchede ikke", "error"); return; }
    }
    setLoad(`del_user_${userId}`, true);
    try {
      const res = await fetch(`${API}/api/admin/users/${userId}`, {
        method: "DELETE", headers: await getAuth(),
        body: JSON.stringify({ confirm_test_account: isTestAccount }),
      });
      const data = await readAdminJson(res);
      if (res.ok) { showMsg(`✅ Bruger ${username} slettet`); loadData(); }
      else showMsg(`❌ ${adminErrorMessage(data, res)}`, "error");
    } catch (e) {
      showMsg(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad(`del_user_${userId}`, false);
    }
  }

  async function handleChangeRole(userId, newRole, username) {
    if (!confirm(`Skift ${username} til ${newRole}?`)) return;
    setLoad(`role_${userId}`, true);
    try {
      const res = await fetch(`${API}/api/admin/users/${userId}/role`, {
        method: "PATCH", headers: await getAuth(),
        body: JSON.stringify({ role: newRole }),
      });
      const data = await readAdminJson(res);
      if (res.ok) { showMsg(`✅ ${username} er nu ${newRole}`); loadData(); }
      else showMsg(`❌ ${adminErrorMessage(data, res)}`, "error");
    } catch (e) {
      showMsg(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad(`role_${userId}`, false);
    }
  }

  return (
    <>
      <AdminMessageBanner msg={msg} />

      <AdminSection title="Brugere">
        {users.length === 0 ? (
          <p className="text-cz-3 text-sm">Ingen brugere endnu.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-cz-border">
            <table data-sort-exempt="Admin brugerliste; sortering er opfoelgning" className="w-full text-xs min-w-[580px]">
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
                {users.map(u => {
                  const isTestAccount = !!u.teams?.[0]?.is_test_account;
                  return (
                  <tr key={u.id} className="border-b border-cz-border last:border-0">
                    <td className="px-3 py-2.5">
                      <p className="text-cz-1 font-medium">
                        {u.username}
                        {isTestAccount && (
                          <span className="ms-2 text-xs border px-2 py-0.5 rounded-full bg-cz-accent/10 text-cz-accent-t border-cz-accent/30">
                            permanent test-konto
                          </span>
                        )}
                      </p>
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
                          onClick={() => handleDeleteUser(u.id, u.username, isTestAccount)}
                          disabled={loading[`del_user_${u.id}`]}
                          className="text-xs px-2 py-1 bg-cz-danger-bg text-red-600 border border-cz-danger/30 rounded hover:bg-cz-danger-bg disabled:opacity-50 transition-all">
                          {loading[`del_user_${u.id}`] ? "..." : "Slet"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>

      <AdminSection title="Manuel override — flyt rytter">
        <p className="text-cz-3 text-xs mb-4">
          Bruges til korrektioner og special-situationer. Handlingen logges ikke som en transaktion.
        </p>
        <ManualOverride getAuth={getAuth} onMsg={showMsg} onRefresh={loadData} teams={teams} />
      </AdminSection>
    </>
  );
}
