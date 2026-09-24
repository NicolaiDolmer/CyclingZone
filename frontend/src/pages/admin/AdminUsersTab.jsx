import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { applyNameSearch } from "../../lib/riderNameSearch";
import { formatCz, getRiderMarketValue } from "../../lib/marketValues";
import AdminSection from "../../components/admin/shared/AdminSection";
import AdminMessageBanner from "../../components/admin/shared/AdminMessageBanner";
import { adminErrorMessage, readAdminJson, useAdminAuth } from "../../components/admin/shared/useAdminAuth";
import { useTableSort } from "../../lib/useTableSort.js";
import SortableTh from "../../components/ui/SortableTh.jsx";
import { ChevronRightIcon } from "../../components/ui/icons/index.jsx";
// #5259: nye kaldsteder bruger apiFetch (Retry-After-respekt, central 401-vej).
import { apiFetch } from "../../lib/apiFetch.ts";

// Sorterbare kolonner (#2294) — bruger/email/rolle er tekst, hold sorteres på
// holdnavn (division indgår ikke i sort-nøglen, kun i visningen).
const USERS_SORT_ACCESSORS = {
  user: (u) => u.username ?? null,
  email: (u) => u.email ?? null,
  role: (u) => u.role ?? null,
  team: (u) => u.teams?.[0]?.name ?? null,
};

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
      const res = await apiFetch(`${API}/api/admin/override-rider`, {
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
      const res = await apiFetch(`${API}/api/admin/riders/${selectedRider.id}/retirement`, {
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
                  ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                  : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}
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
  const [betaPending, setBetaPending] = useState([]); // #5259
  const [loading, setLoading] = useState({});

  function setLoad(k, v) { setLoading(l => ({ ...l, [k]: v })); }

  // #5259: useCallback frem for en bar funktion. loadData læser nu getAuth, og
  // dermed begyndte react-hooks/exhaustive-deps at flage mount-effekten. Den
  // rigtige rettelse er at give effekten en STABIL reference (getAuth er selv
  // useCallback'et i useAdminAuth), ikke at slå advarslen fra: repoet har en
  // ratchet på både advarsler OG eslint-disable-direktiver.
  const loadData = useCallback(async () => {
    // #5259: beta-ansøgningerne læses gennem backenden (service-role), ikke
    // direkte fra tabellen — beta_requests har INGEN admin-skrive-grants til
    // authenticated, og listen skal sammenstilles med users.is_beta_tester.
    const betaPromise = (async () => {
      try {
        const res = await apiFetch(
          `${API}/api/admin/beta-access`, { headers: await getAuth() }, { source: "admin-beta-access" },
        );
        if (!res.ok) return { pending: [], members: [] };
        return res.data ?? { pending: [], members: [] };
      } catch { return { pending: [], members: [] }; }
    })();

    const [u, t, b] = await Promise.all([
      supabase.from("users").select("id, email, username, role, is_beta_tester, created_at, teams(id, name, division, is_test_account)").order("created_at", { ascending: false }),
      supabase.from("teams").select("id,name,balance,division").eq("is_ai", false).order("name"),
      betaPromise,
    ]);
    setUsers(u.data || []);
    setTeams(t.data || []);
    setBetaPending(b.pending || []);
  }, [getAuth]);

  useEffect(() => { loadData(); }, [loadData]);

  const { rows: sortedUsers, sort: usersSort, sortDir: usersSortDir, handleSort: handleUsersSort } =
    useTableSort(users, USERS_SORT_ACCESSORS, { initialDir: "asc" });

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
      const res = await apiFetch(`${API}/api/admin/users/${userId}`, {
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
      const res = await apiFetch(`${API}/api/admin/users/${userId}/role`, {
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

  // #5259: kontakten pr. bruger. Sætter KUN users.is_beta_tester — hvad en
  // beta-tester så faktisk kan se, afgøres server-side af evaluateFlagStage
  // og stadiet på det enkelte flag (Admin > System).
  async function handleToggleBeta(userId, next, username) {
    setLoad(`beta_${userId}`, true);
    try {
      const res = await apiFetch(`${API}/api/admin/users/${userId}/beta`, {
        method: "PATCH", headers: await getAuth(),
        body: JSON.stringify({ is_beta_tester: next }),
      }, { source: "admin-beta-toggle" });
      if (res.limited) return;
      const data = res.data ?? {};
      if (res.ok) { showMsg(`${username} ${next ? "er nu beta-tester" : "er ikke længere beta-tester"}`); loadData(); }
      else showMsg(adminErrorMessage(data, res), "error");
    } catch (e) {
      showMsg(`Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad(`beta_${userId}`, false);
    }
  }

  // Svar på en ansøgning. Modsat kontakten ovenfor lægger denne vej ÉN besked i
  // spillerens indbakke — han spurgte om noget, og skal have svaret.
  async function handleDecideBeta(userId, approved, username) {
    if (!confirm(`${approved ? "Godkend" : "Afvis"} beta-ansøgning fra ${username || userId}?\n\nSpilleren får en besked i indbakken.`)) return;
    setLoad(`beta_req_${userId}`, true);
    try {
      const res = await apiFetch(`${API}/api/admin/beta-requests/${userId}/decide`, {
        method: "POST", headers: await getAuth(),
        body: JSON.stringify({ approved }),
      }, { source: "admin-beta-decide" });
      if (res.limited) return;
      const data = res.data ?? {};
      if (res.ok) {
        showMsg(`Ansøgning ${approved ? "godkendt" : "afvist"}${data.notified ? "" : " (beskeden kunne ikke leveres)"}`);
        loadData();
      } else if (res.status === 503) {
        showMsg("Beta-tabellen er ikke migreret endnu — prøv igen om lidt", "error");
      } else {
        showMsg(adminErrorMessage(data, res), "error");
      }
    } catch (e) {
      showMsg(`Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad(`beta_req_${userId}`, false);
    }
  }

  return (
    <>
      <AdminMessageBanner msg={msg} />

      {/* #5259: ansøgningerne står ØVERST — de er den eneste liste her der
          venter på et svar fra dig. Er der ingen, forsvinder blokken helt. */}
      {betaPending.length > 0 && (
        <AdminSection title={`Beta-ansøgninger (${betaPending.length})`}>
          <p className="text-cz-3 text-xs mb-4">
            Spilleren har selv bedt om adgang fra sin profil. Ved godkendelse sættes beta-tester-kontakten,
            og han får én besked i indbakken. Et afslag kan han spørge videre fra.
          </p>
          <div className="flex flex-col divide-y divide-cz-border">
            {betaPending.map(r => (
              <div key={r.user_id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-cz-1 text-sm font-medium">{r.username || r.user_id.slice(0, 8)}</p>
                  <p className="text-cz-3 text-xs truncate">
                    {r.email} · ansøgte {new Date(r.requested_at).toLocaleDateString("da-DK")}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleDecideBeta(r.user_id, true, r.username)}
                    disabled={loading[`beta_req_${r.user_id}`]}
                    className="text-xs px-2 py-1 bg-cz-success-bg text-cz-success border border-cz-success/30 rounded hover:brightness-110 disabled:opacity-50 transition-all">
                    {loading[`beta_req_${r.user_id}`] ? "..." : "Godkend"}
                  </button>
                  <button
                    onClick={() => handleDecideBeta(r.user_id, false, r.username)}
                    disabled={loading[`beta_req_${r.user_id}`]}
                    className="text-xs px-2 py-1 bg-cz-subtle text-cz-2 border border-cz-border rounded hover:text-cz-1 disabled:opacity-50 transition-all">
                    Afvis
                  </button>
                </div>
              </div>
            ))}
          </div>
        </AdminSection>
      )}

      <AdminSection title="Brugere">
        {users.length === 0 ? (
          <p className="text-cz-3 text-sm">Ingen brugere endnu.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-cz-border">
            <table data-sortable className="w-full text-xs min-w-[580px]">
              <thead>
                <tr className="border-b border-cz-border">
                  <SortableTh sortKey="user" sort={usersSort} sortDir={usersSortDir} onSort={handleUsersSort}
                    className="px-3 py-2 text-left">Bruger</SortableTh>
                  <SortableTh sortKey="email" sort={usersSort} sortDir={usersSortDir} onSort={handleUsersSort}
                    className="px-3 py-2 text-left hidden sm:table-cell">Email</SortableTh>
                  <SortableTh sortKey="role" sort={usersSort} sortDir={usersSortDir} onSort={handleUsersSort}
                    className="px-3 py-2 text-left">Rolle</SortableTh>
                  <SortableTh sortKey="team" sort={usersSort} sortDir={usersSortDir} onSort={handleUsersSort}
                    className="px-3 py-2 text-left hidden md:table-cell">Hold</SortableTh>
                  <th className="px-3 py-2 text-right text-cz-3">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map(u => {
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`text-xs border px-2 py-0.5 rounded-full ${
                          u.role === "admin"
                            ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                            : "bg-cz-subtle text-cz-2 border-cz-border"
                        }`}>{u.role}</span>
                        {/* #5259: admin ER beta-tester i forvejen (isViewerBetaTester
                            = admin ELLER is_beta_tester), så mærket ville lyve hvis
                            det kun fulgte kolonnen for en admin. */}
                        {u.is_beta_tester && (
                          <span className="text-xs border px-2 py-0.5 rounded-full bg-cz-info/10 text-cz-info border-cz-info/30">beta</span>
                        )}
                      </div>
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
                          className="text-xs px-2 py-1 bg-cz-subtle text-cz-2 border border-cz-border rounded hover:text-cz-1 disabled:opacity-50 transition-all inline-flex items-center gap-0.5">
                          {loading[`role_${u.id}`] ? "..." : (
                            <>
                              <ChevronRightIcon size={11} aria-hidden="true" />
                              {u.role === "admin" ? "Manager" : "Admin"}
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleToggleBeta(u.id, !u.is_beta_tester, u.username)}
                          disabled={loading[`beta_${u.id}`]}
                          title={u.is_beta_tester ? "Fjern beta-tester" : "Gør til beta-tester"}
                          className={`text-xs px-2 py-1 border rounded disabled:opacity-50 transition-all ${
                            u.is_beta_tester
                              ? "bg-cz-info/10 text-cz-info border-cz-info/30"
                              : "bg-cz-subtle text-cz-2 border-cz-border hover:text-cz-1"
                          }`}>
                          {loading[`beta_${u.id}`] ? "..." : (u.is_beta_tester ? "Beta fra" : "Beta til")}
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
