import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme.jsx";
import { useConsent } from "../lib/consent.jsx";

const API = import.meta.env.VITE_API_URL;

const THEME_OPTIONS = ["system", "light", "dark"];

export default function ProfilePage() {
  const { t } = useTranslation("profile");
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
  const { consent, openBanner } = useConsent();

  useEffect(() => { loadProfile(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      showMsg(`❌ ${t("discord.idError")}`, "error");
      return;
    }
    setSavingDiscord(true);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("users")
      .update({ discord_id: trimmed || null })
      .eq("id", authUser.id);
    if (error) showMsg(`❌ ${error.message}`, "error");
    else showMsg(`✅ ${t("discord.idSaved")}`);
    await refreshDmStatus();
    setSavingDiscord(false);
  }

  async function toggleDmEnabled(enabled) {
    setSavingDmEnabled(true);
    const headers = await getAuthHeaders();
    if (!headers) {
      showMsg(`❌ ${t("discord.noSession")}`, "error");
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
      showMsg(`✅ ${enabled ? t("discord.dmOn") : t("discord.dmOff")}`);
    }
    setSavingDmEnabled(false);
  }

  async function sendTestDm() {
    setTestingDm(true);
    const headers = await getAuthHeaders();
    if (!headers) {
      showMsg(`❌ ${t("discord.noSession")}`, "error");
      setTestingDm(false);
      return;
    }
    const res = await fetch(`${API}/api/me/discord-dm-test`, { method: "POST", headers });
    const data = await res.json();
    if (!res.ok) showMsg(`❌ ${data.error}`, "error");
    else showMsg(`✅ ${t("discord.testSent")}`);
    setTestingDm(false);
  }

  async function saveTeamInfo() {
    if (!teamName.trim() || teamName.trim().length < 3) {
      showMsg(`❌ ${t("team.errorTeamName")}`, "error");
      return;
    }
    if (!managerName.trim() || managerName.trim().length < 2) {
      showMsg(`❌ ${t("team.errorManagerName")}`, "error");
      return;
    }
    setSavingTeam(true);

    const headers = await getAuthHeaders();
    if (!headers) {
      showMsg(`❌ ${t("team.errorNoSession")}`, "error");
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
      showMsg(`✅ ${team ? t("team.saved") : t("team.created")}`);
    }

    setSavingTeam(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  const canEditTeam = Boolean(team) || user?.role === "manager";

  const discordEvents = [
    t("discord.eventOutbid"),
    t("discord.eventWonAuction"),
    t("discord.eventTransferOffer"),
    t("discord.eventOfferResolved"),
    t("discord.eventNewAuction"),
    t("discord.eventSeasonChange"),
  ];

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">{t("header.title")}</h1>
        <p className="text-cz-3 text-sm">{t("header.subtitle")}</p>
      </div>

      {/* Account info */}
      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
        <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("account.title")}</h2>
        <div className="space-y-3">
          <div>
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("account.email")}</p>
            <p className="text-cz-1 text-sm" data-clarity-mask="True">{user?.email}</p>
          </div>
          <div>
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("account.username")}</p>
            <p className="text-cz-1 text-sm">{user?.username}</p>
          </div>
          {user?.role === "admin" && (
            <div>
              <span className="text-xs bg-cz-danger-bg text-cz-danger border border-cz-danger/30 px-2 py-0.5 rounded-full">{t("account.adminBadge")}</span>
            </div>
          )}
        </div>
      </div>

      {/* Tema */}
      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
        <h2 className="text-cz-1 font-semibold text-sm mb-1">{t("appearance.title")}</h2>
        <p className="text-cz-3 text-xs mb-4">{t("appearance.subtitle")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {THEME_OPTIONS.map(value => {
            const active = theme === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                aria-pressed={active}
                className={`text-left rounded-lg border px-3 py-2.5 transition-all
                  ${active
                    ? "border-cz-accent bg-cz-accent/10"
                    : "border-cz-border bg-cz-subtle hover:border-cz-accent/40"}`}
              >
                <p className={`text-sm font-semibold ${active ? "text-cz-accent-t" : "text-cz-1"}`}>
                  {t(`appearance.${value}Label`)}
                </p>
                <p className="text-cz-3 text-[11px] mt-0.5 leading-snug">{t(`appearance.${value}Hint`)}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Privatliv */}
      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
        <h2 className="text-cz-1 font-semibold text-sm mb-1">{t("privacy.title")}</h2>
        <p className="text-cz-3 text-xs mb-4">
          {t("privacy.subtitle")}
        </p>
        <ul className="text-cz-2 text-sm space-y-1 mb-4">
          <li className="flex items-center justify-between">
            <span>{t("privacy.necessary")}</span>
            <span className="text-cz-3 text-xs">{t("privacy.alwaysOn")}</span>
          </li>
          <li className="flex items-center justify-between">
            <span>{t("privacy.analytics")}</span>
            <span className={consent.analytics ? "text-cz-success text-xs font-semibold" : "text-cz-3 text-xs"}>
              {consent.analytics ? t("privacy.accepted") : t("privacy.declined")}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span>{t("privacy.marketing")}</span>
            <span className={consent.marketing ? "text-cz-success text-xs font-semibold" : "text-cz-3 text-xs"}>
              {consent.marketing ? t("privacy.accepted") : t("privacy.declined")}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span>{t("privacy.email")}</span>
            <span className={consent.email_marketing ? "text-cz-success text-xs font-semibold" : "text-cz-3 text-xs"}>
              {consent.email_marketing ? t("privacy.accepted") : t("privacy.declined")}
            </span>
          </li>
        </ul>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={openBanner}
            className="flex-1 py-2.5 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 transition-all"
          >
            {t("privacy.changeChoices")}
          </button>
          <Link
            to="/privatlivspolitik"
            className="flex-1 py-2.5 border border-cz-border bg-cz-subtle text-cz-1 font-semibold rounded-lg text-sm text-center hover:border-cz-accent/40 transition-all"
          >
            {t("privacy.readPolicy")}
          </Link>
        </div>
      </div>

      {/* Team info */}
      {canEditTeam && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
          <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("team.title")}</h2>
          <div className="space-y-4">
            {!team && (
              <div className="bg-cz-subtle border border-cz-border rounded-lg p-4">
                <p className="text-cz-2 text-sm">
                  {t("team.notInitialized")}
                </p>
              </div>
            )}
            <div>
              <label className="block text-cz-3 text-xs uppercase tracking-wider mb-1.5">{t("team.teamNameLabel")}</label>
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
              <label className="block text-cz-3 text-xs uppercase tracking-wider mb-1.5">{t("team.managerNameLabel")}</label>
              <input
                type="text"
                value={managerName}
                onChange={e => setManagerName(e.target.value)}
                placeholder={t("team.managerNamePlaceholder")}
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
              {savingTeam ? t("team.saving") : team ? t("team.save") : t("team.create")}
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
            <h2 className="text-cz-1 font-semibold text-sm">{t("discord.title")}</h2>
            <p className="text-cz-3 text-xs">{t("discord.subtitle")}</p>
          </div>
        </div>

        {/* DM-status badge */}
        {dmStatus && (
          dmStatus.discord_id ? (
            !/^\d{17,19}$/.test(dmStatus.discord_id) ? (
              <div className="mb-4 px-4 py-2.5 rounded-lg border bg-cz-danger-bg text-cz-danger border-cz-danger/30 text-xs flex items-start gap-2">
                <span>❌</span>
                <span>
                  {t("discord.statusUsernamePre")}<code className="font-mono">{dmStatus.discord_id}</code>{t("discord.statusUsernamePost")}
                </span>
              </div>
            ) : dmStatus.bot_configured ? (
              dmStatus.dm_enabled ? (
                <div className="mb-4 px-4 py-2.5 rounded-lg border bg-cz-success-bg text-cz-success border-cz-success/30 text-xs flex items-center gap-2">
                  <span>✅</span>
                  <span>{t("discord.statusConnected")}</span>
                </div>
              ) : (
                <div className="mb-4 px-4 py-2.5 rounded-lg border bg-cz-warning-bg text-cz-warning border-cz-warning/30 text-xs flex items-center gap-2">
                  <span>⏸</span>
                  <span>{t("discord.statusDmOff")}</span>
                </div>
              )
            ) : (
              <div className="mb-4 px-4 py-2.5 rounded-lg border bg-cz-warning-bg text-cz-warning border-cz-warning/30 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>{t("discord.statusBotMissing")}</span>
              </div>
            )
          ) : (
            <div className="mb-4 px-4 py-2.5 rounded-lg border bg-cz-danger-bg text-cz-danger border-cz-danger/30 text-xs flex items-center gap-2">
              <span>❌</span>
              <span>{t("discord.statusIdMissing")}</span>
            </div>
          )
        )}

        <div className="bg-cz-subtle border border-cz-border rounded-lg p-4 mb-4">
          <p className="text-cz-2 text-xs leading-relaxed">
            {t("discord.intro")}
          </p>
        </div>

        <div className="mb-4">
          <label className="block text-cz-3 text-xs uppercase tracking-wider mb-2">
            {t("discord.idLabel")}
          </label>
          <input
            type="text"
            value={discordId}
            onChange={e => setDiscordId(e.target.value)}
            placeholder={t("discord.idPlaceholder")}
            data-clarity-mask="True"
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-4 py-2.5
              text-cz-1 text-sm placeholder-cz-3 font-mono
              focus:outline-none focus:border-[#5865F2]/50"
          />
          <p className="text-cz-3 text-xs mt-2">
            {t("discord.idHelp")}
            <span className="block mt-1 text-cz-2">
              {t("discord.idHelpStrong")}
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
          {savingDiscord ? t("discord.saving") : t("discord.save")}
        </button>

        {/* DM-toggle + test-knap (kun når ID er sat) */}
        {dmStatus?.discord_id && (
          <div className="mt-4 bg-cz-subtle border border-cz-border rounded-lg p-4 space-y-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-cz-1 text-sm font-medium">{t("discord.toggleLabel")}</span>
              <input
                type="checkbox"
                checked={dmStatus.dm_enabled}
                disabled={savingDmEnabled}
                onChange={e => toggleDmEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#5865F2]"
              />
            </label>
            <p className="text-cz-3 text-xs leading-relaxed">
              {t("discord.toggleHint")}
            </p>
            <button
              onClick={sendTestDm}
              disabled={testingDm || !dmStatus.bot_configured}
              className="w-full py-2 border border-cz-border bg-cz-card text-cz-1 text-sm rounded-lg
                hover:border-[#5865F2]/50 transition-all disabled:opacity-50">
              {testingDm ? t("discord.testSending") : dmStatus.bot_configured ? t("discord.testSend") : t("discord.testBotMissing")}
            </button>
          </div>
        )}

        <div className="mt-4 bg-cz-subtle border border-cz-border rounded-lg p-3">
          <p className="text-cz-3 text-xs font-medium mb-2">{t("discord.eventsTitle")}</p>
          <ul className="space-y-1">
            {discordEvents.map(item => (
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
