import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme.jsx";

const API = import.meta.env.VITE_API_URL;

const THEME_OPTIONS = [
  { value: "system", label: "Følg system", hint: "Skifter automatisk med din enhed" },
  { value: "light",  label: "Lyst",        hint: "Lys baggrund i hele appen" },
  { value: "dark",   label: "Mørkt",       hint: "Mørk baggrund i hele appen" },
];

export default function ProfilePage() {
  const [user, setUser] = useState(null);
  const [team, setTeam] = useState(null);
  const [discordId, setDiscordId] = useState("");
  const [dmStatus, setDmStatus] = useState(null);
  const [savingDmEnabled, setSavingDmEnabled] = useState(false);
  const [testingDm, setTestingDm] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [managerName, setManagerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingDiscord, setSavingDiscord] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const { theme, setTheme } = useTheme();

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const [{ data: userData }, { data: teamData }] = await Promise.all([
      supabase.from("users").select("discord_id, username, email, role").eq("id", authUser.id).single(),
      supabase.from("teams").select("id, name, manager_name").eq("user_id", authUser.id).single(),
    ]);
    setUser(userData);
    setDiscordId(userData?.discord_id || "");
    setTeam(teamData);
    setTeamName(teamData?.name || "");
    setManagerName(teamData?.manager_name || "");
    await refreshDmStatus();
    setLoading(false);
  }

  async function refreshDmStatus() {
    const headers = await getAuthHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`${API}/api/me/discord-status`, { headers });
      if (res.ok) setDmStatus(await res.json());
    } catch {
      // best-effort — UI viser bare tom status
    }
  }

  function showMsg(text, type = "success") {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "" }), 3000);
  }

  async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    };
  }

  async function saveDiscordId() {
    const trimmed = discordId.trim();
    if (trimmed && !/^\d{17,19}$/.test(trimmed)) {
      showMsg("❌ Discord ID skal være 17-19 cifre (kun tal). Du har sandsynligvis kopieret brugernavnet — højreklik på dit eget navn i Discord → 'Kopiér bruger-ID' (kræver Udviklertilstand under Avanceret).", "error");
      return;
    }
    setSavingDiscord(true);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("users")
      .update({ discord_id: trimmed || null })
      .eq("id", authUser.id);
    if (error) showMsg(`❌ ${error.message}`, "error");
    else showMsg("✅ Discord ID gemt!");
    await refreshDmStatus();
    setSavingDiscord(false);
  }

  async function toggleDmEnabled(enabled) {
    setSavingDmEnabled(true);
    const headers = await getAuthHeaders();
    if (!headers) {
      showMsg("❌ Ingen aktiv session", "error");
      setSavingDmEnabled(false);
      return;
    }
    const res = await fetch(`${API}/api/me/discord-dm-enabled`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json();
    if (!res.ok) showMsg(`❌ ${data.error}`, "error");
    else {
      setDmStatus(prev => ({ ...prev, dm_enabled: data.dm_enabled }));
      showMsg(enabled ? "✅ DM aktiveret" : "✅ DM slået fra");
    }
    setSavingDmEnabled(false);
  }

  async function sendTestDm() {
    setTestingDm(true);
    const headers = await getAuthHeaders();
    if (!headers) {
      showMsg("❌ Ingen aktiv session", "error");
      setTestingDm(false);
      return;
    }
    const res = await fetch(`${API}/api/me/discord-dm-test`, { method: "POST", headers });
    const data = await res.json();
    if (!res.ok) showMsg(`❌ ${data.error}`, "error");
    else showMsg("✅ Test-DM sendt — tjek Discord");
    setTestingDm(false);
  }

  async function saveTeamInfo() {
    if (!teamName.trim() || teamName.trim().length < 3) {
      showMsg("❌ Holdnavn skal være mindst 3 tegn", "error");
      return;
    }
    if (!managerName.trim() || managerName.trim().length < 2) {
      showMsg("❌ Managernavn skal være mindst 2 tegn", "error");
      return;
    }
    setSavingTeam(true);

    const headers = await getAuthHeaders();
    if (!headers) {
      showMsg("❌ Kunne ikke finde en aktiv session", "error");
      setSavingTeam(false);
      return;
    }

    const res = await fetch(`${API}/api/teams/my`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        name: teamName.trim(),
        manager_name: managerName.trim(),
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      showMsg(`❌ ${data.error}`, "error");
    } else {
      setTeam(data.team);
      setTeamName(data.team.name || "");
      setManagerName(data.team.manager_name || "");
      showMsg(team ? "✅ Holdinfo gemt!" : "✅ Hold oprettet!");
    }

    setSavingTeam(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  const canEditTeam = Boolean(team) || user?.role === "manager";

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">Min Profil</h1>
        <p className="text-cz-3 text-sm">Indstillinger og hold</p>
      </div>

      {/* Account info */}
      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
        <h2 className="text-cz-1 font-semibold text-sm mb-4">Konto</h2>
        <div className="space-y-3">
          <div>
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">Email</p>
            <p className="text-cz-1 text-sm">{user?.email}</p>
          </div>
          <div>
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">Brugernavn</p>
            <p className="text-cz-1 text-sm">{user?.username}</p>
          </div>
          {user?.role === "admin" && (
            <div>
              <span className="text-xs bg-cz-danger-bg text-cz-danger border border-cz-danger/30 px-2 py-0.5 rounded-full">Admin</span>
            </div>
          )}
        </div>
      </div>

      {/* Tema */}
      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
        <h2 className="text-cz-1 font-semibold text-sm mb-1">Udseende</h2>
        <p className="text-cz-3 text-xs mb-4">Vælg tema for hele appen.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {THEME_OPTIONS.map(opt => {
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme(opt.value)}
                aria-pressed={active}
                className={`text-left rounded-lg border px-3 py-2.5 transition-all
                  ${active
                    ? "border-cz-accent bg-cz-accent/10"
                    : "border-cz-border bg-cz-subtle hover:border-cz-accent/40"}`}
              >
                <p className={`text-sm font-semibold ${active ? "text-cz-accent-t" : "text-cz-1"}`}>
                  {opt.label}
                </p>
                <p className="text-cz-3 text-[11px] mt-0.5 leading-snug">{opt.hint}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Team info */}
      {canEditTeam && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
          <h2 className="text-cz-1 font-semibold text-sm mb-4">Hold</h2>
          <div className="space-y-4">
            {!team && (
              <div className="bg-cz-subtle border border-cz-border rounded-lg p-4">
                <p className="text-cz-2 text-sm">
                  Dit hold mangler stadig at blive initialiseret. Gem holdinfo for at oprette det nu.
                </p>
              </div>
            )}
            <div>
              <label className="block text-cz-3 text-xs uppercase tracking-wider mb-1.5">Holdnavn</label>
              <input
                type="text"
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                minLength={3}
                maxLength={30}
                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-4 py-2.5
                  text-cz-1 text-sm placeholder-cz-3
                  focus:outline-none focus:border-cz-accent transition-all"
              />
            </div>
            <div>
              <label className="block text-cz-3 text-xs uppercase tracking-wider mb-1.5">Managernavn</label>
              <input
                type="text"
                value={managerName}
                onChange={e => setManagerName(e.target.value)}
                placeholder="Dit navn som manager"
                minLength={2}
                maxLength={50}
                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-4 py-2.5
                  text-cz-1 text-sm placeholder-cz-3
                  focus:outline-none focus:border-cz-accent transition-all"
              />
            </div>

            {msg.text && (
              <div className={`px-4 py-2.5 rounded-lg text-sm border
                ${msg.type === "success"
                  ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                  : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
                {msg.text}
              </div>
            )}

            <button
              onClick={saveTeamInfo}
              disabled={savingTeam}
              className="w-full py-2.5 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm
                hover:brightness-110 transition-all disabled:opacity-50">
              {savingTeam ? "Gemmer..." : team ? "Gem holdinfo" : "Opret holdinfo"}
            </button>
          </div>
        </div>
      )}

      {/* Discord integration */}
      <div className="bg-cz-card border border-cz-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-[#5865F2]/20 flex items-center justify-center">
            <span className="text-[#5865F2] text-sm font-bold">D</span>
          </div>
          <div>
            <h2 className="text-cz-1 font-semibold text-sm">Discord Integration</h2>
            <p className="text-cz-3 text-xs">Modtag notifikationer direkte i Discord</p>
          </div>
        </div>

        {/* DM-status badge */}
        {dmStatus && (
          dmStatus.discord_id ? (
            !/^\d{17,19}$/.test(dmStatus.discord_id) ? (
              <div className="mb-4 px-4 py-2.5 rounded-lg border bg-cz-danger-bg text-cz-danger border-cz-danger/30 text-xs flex items-start gap-2">
                <span>❌</span>
                <span>
                  Dit gemte ID (<code className="font-mono">{dmStatus.discord_id}</code>) ser ud til at være et brugernavn, ikke et bruger-ID. DMs vil ikke blive leveret. Erstat det med et 17-19-cifret tal — se vejledningen nedenfor.
                </span>
              </div>
            ) : dmStatus.bot_configured ? (
              dmStatus.dm_enabled ? (
                <div className="mb-4 px-4 py-2.5 rounded-lg border bg-cz-success-bg text-cz-success border-cz-success/30 text-xs flex items-center gap-2">
                  <span>✅</span>
                  <span>Forbundet — du modtager DMs fra botten ved auktioner og transfers.</span>
                </div>
              ) : (
                <div className="mb-4 px-4 py-2.5 rounded-lg border bg-cz-warning-bg text-cz-warning border-cz-warning/30 text-xs flex items-center gap-2">
                  <span>⏸</span>
                  <span>Discord-ID er sat, men DMs er slået fra. Du får stadig @mention i kanalen.</span>
                </div>
              )
            ) : (
              <div className="mb-4 px-4 py-2.5 rounded-lg border bg-cz-warning-bg text-cz-warning border-cz-warning/30 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>Bot er endnu ikke konfigureret på serveren — kun kanal-mention virker indtil videre.</span>
              </div>
            )
          ) : (
            <div className="mb-4 px-4 py-2.5 rounded-lg border bg-cz-danger-bg text-cz-danger border-cz-danger/30 text-xs flex items-center gap-2">
              <span>❌</span>
              <span>Mangler Discord-ID — tilføj det nedenfor for at modtage DMs.</span>
            </div>
          )
        )}

        <div className="bg-cz-subtle border border-cz-border rounded-lg p-4 mb-4">
          <p className="text-cz-2 text-xs leading-relaxed">
            Hvis du tilknytter dit Discord bruger-ID, vil du blive tagget i Discord
            når du overbydes på auktioner, vinder auktioner, modtager transfer-tilbud m.m.
          </p>
        </div>

        <div className="mb-4">
          <label className="block text-cz-3 text-xs uppercase tracking-wider mb-2">
            Dit Discord Bruger-ID
          </label>
          <input
            type="text"
            value={discordId}
            onChange={e => setDiscordId(e.target.value)}
            placeholder="f.eks. 123456789012345678"
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-4 py-2.5
              text-cz-1 text-sm placeholder-cz-3 font-mono
              focus:outline-none focus:border-[#5865F2]/50"
          />
          <p className="text-cz-3 text-xs mt-2">
            Find dit ID: Discord → Indstillinger → Avanceret → Aktivér udviklertilstand
            → Højreklik på dit navn → "Kopiér bruger-ID".
            <span className="block mt-1 text-cz-2">
              Det er et <strong>17-19-cifret tal</strong>, ikke dit @brugernavn.
            </span>
          </p>
        </div>

        {!team && msg.text && (
          <div className={`mb-3 px-4 py-2.5 rounded-lg text-sm border
            ${msg.type === "success"
              ? "bg-cz-success-bg text-cz-success border-cz-success/30"
              : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
            {msg.text}
          </div>
        )}

        <button
          onClick={saveDiscordId}
          disabled={savingDiscord}
          className="w-full py-2.5 bg-[#5865F2] text-white font-bold rounded-lg text-sm
            hover:bg-[#4752c4] transition-all disabled:opacity-50">
          {savingDiscord ? "Gemmer..." : "Gem Discord ID"}
        </button>

        {/* DM-toggle + test-knap (kun når ID er sat) */}
        {dmStatus?.discord_id && (
          <div className="mt-4 bg-cz-subtle border border-cz-border rounded-lg p-4 space-y-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-cz-1 text-sm font-medium">Modtag DMs ved person-rettede events</span>
              <input
                type="checkbox"
                checked={dmStatus.dm_enabled}
                disabled={savingDmEnabled}
                onChange={e => toggleDmEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#5865F2]"
              />
            </label>
            <p className="text-cz-3 text-xs leading-relaxed">
              Slå fra hvis du ikke vil have private beskeder fra botten — du får stadig @mention i kanalen.
            </p>
            <button
              onClick={sendTestDm}
              disabled={testingDm || !dmStatus.bot_configured}
              className="w-full py-2 border border-cz-border bg-cz-card text-cz-1 text-sm rounded-lg
                hover:border-[#5865F2]/50 transition-all disabled:opacity-50">
              {testingDm ? "Sender..." : dmStatus.bot_configured ? "Send test-DM" : "Bot ikke konfigureret"}
            </button>
          </div>
        )}

        <div className="mt-4 bg-cz-subtle border border-cz-border rounded-lg p-3">
          <p className="text-cz-3 text-xs font-medium mb-2">Du modtager Discord-notifikationer når:</p>
          <ul className="space-y-1">
            {[
              "Du overbydes på en auktion",
              "Du vinder en auktion",
              "Du modtager et transfer-tilbud",
              "Dit transfer-tilbud accepteres eller afvises",
              "En ny auktion oprettes",
              "En ny sæson starter eller afsluttes",
            ].map(item => (
              <li key={item} className="flex items-center gap-2 text-cz-3 text-xs">
                <span className="text-cz-success">✓</span> {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
