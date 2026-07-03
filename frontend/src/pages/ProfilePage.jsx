import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { mapSupabaseAuthError } from "../lib/authErrors";
import { useTheme } from "../lib/theme.jsx";
import { useConsent } from "../lib/consent.jsx";
import {
  Card,
  Button,
  Field,
  Input,
  Toggle,
  PageLoader,
  CheckIcon,
  XIcon,
  AlertTriangleIcon,
  ClockIcon,
  DiscordIcon,
  InboxIcon,
} from "../components/ui";
import { buttonClass } from "../components/ui/buttonStyles.js";

const API = import.meta.env.VITE_API_URL;

const THEME_OPTIONS = ["system", "light", "dark"];

export default function ProfilePage() {
  const { t } = useTranslation(["profile", "errors"]);
  const [user, setUser] = useState(null);
  const [team, setTeam] = useState(null);
  const [discordId, setDiscordId] = useState("");
  const [dmStatus, setDmStatus] = useState(null);
  const [savingDmEnabled, setSavingDmEnabled] = useState(false);
  const [testingDm, setTestingDm] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [managerName, setManagerName] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailNotice, setEmailNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingDiscord, setSavingDiscord] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const { theme, setTheme } = useTheme();
  const { consent, openBanner } = useConsent();

  // Mount: load profile once. loadProfile is a hoisted function declaration, so
  // calling it here is runtime-safe; disable the compiler's declaration-order
  // check for the hoisted call (and exhaustive-deps for the intentional one-shot).
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/immutability
  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → authUser=null; stop før authUser.id (auth-flow redirecter til /login)
    if (!authUser) { setLoading(false); return; }
    const [{ data: userData }, { data: teamData }] = await Promise.all([
      supabase.from("users").select("discord_id, username, email, role").eq("id", authUser.id).single(),
      supabase.from("teams").select("id, name, manager_name").eq("user_id", authUser.id).single(),
    ]);
    setUser(userData);
    setDiscordId(userData?.discord_id || "");
    setUsernameInput(userData?.username || "");
    setEmailInput(userData?.email || "");
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
      showMsg(t("discord.idError"), "error");
      return;
    }
    setSavingDiscord(true);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → authUser=null; stop før authUser.id (auth-flow redirecter til /login)
    if (!authUser) { setSavingDiscord(false); return; }
    const { error } = await supabase
      .from("users")
      .update({ discord_id: trimmed || null })
      .eq("id", authUser.id);
    if (error) showMsg(error.message, "error");
    else showMsg(t("discord.idSaved"));
    await refreshDmStatus();
    setSavingDiscord(false);
  }

  // #1746: skift brugernavn via backend (case-insensitivt unikheds-tjek +
  // validering). Backend er source-of-truth for unikhed; 3-20 tegn spejles her
  // for hurtig feedback uden et round-trip.
  async function saveUsername() {
    const trimmed = usernameInput.trim();
    if (trimmed === (user?.username || "")) return;
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(trimmed)) {
      showMsg(t("account.usernameError"), "error");
      return;
    }
    setSavingUsername(true);
    const headers = await getAuthHeaders();
    if (!headers) {
      showMsg(t("account.noSession"), "error");
      setSavingUsername(false);
      return;
    }
    try {
      const res = await fetch(`${API}/api/me/username`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ username: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMsg(res.status === 409 ? t("account.usernameTaken") : data.error || t("account.usernameError"), "error");
      } else {
        setUser(prev => ({ ...prev, username: data.username }));
        setUsernameInput(data.username);
        showMsg(t("account.usernameSaved"));
      }
    } catch {
      showMsg(t("account.noSession"), "error");
    }
    setSavingUsername(false);
  }

  // #1746: skift e-mail gennem Supabase Auth. updateUser({ email }) sender en
  // bekraeftelsesmail til den NYE adresse (og — afhængigt af projekt-config —
  // også til den gamle). public.users.email synces først NÅR linket er klikket,
  // via auth.users-trigger (2026-06-23-account-email-username.sql). Derfor viser
  // vi en "tjek din indbakke"-besked frem for at ændre visningen optimistisk.
  async function saveEmail() {
    const trimmed = emailInput.trim();
    setEmailNotice("");
    if (trimmed === (user?.email || "")) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      showMsg(t("account.emailError"), "error");
      return;
    }
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: trimmed });
    if (error) {
      showMsg(mapSupabaseAuthError(error, t), "error");
    } else {
      setEmailNotice(t("account.emailPending", { email: trimmed }));
    }
    setSavingEmail(false);
  }

  async function toggleDmEnabled(enabled) {
    setSavingDmEnabled(true);
    const headers = await getAuthHeaders();
    if (!headers) {
      showMsg(t("discord.noSession"), "error");
      setSavingDmEnabled(false);
      return;
    }
    const res = await fetch(`${API}/api/me/discord-dm-enabled`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json();
    if (!res.ok) showMsg(data.error, "error");
    else {
      setDmStatus(prev => ({ ...prev, dm_enabled: data.dm_enabled }));
      showMsg(enabled ? t("discord.dmOn") : t("discord.dmOff"));
    }
    setSavingDmEnabled(false);
  }

  async function toggleDmPref(prefKey, enabled) {
    const headers = await getAuthHeaders();
    if (!headers) { showMsg(t("discord.noSession"), "error"); return; }
    // Optimistic; revert to server truth on error.
    setDmStatus(prev => ({ ...prev, dm_prefs: { ...(prev?.dm_prefs || {}), [prefKey]: enabled } }));
    const res = await fetch(`${API}/api/me/discord-dm-prefs`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ prefs: { [prefKey]: enabled } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMsg(data.error || t("discord.noSession"), "error");
      await refreshDmStatus();
    } else {
      setDmStatus(prev => ({ ...prev, dm_prefs: data.dm_prefs }));
    }
  }

  async function sendTestDm() {
    setTestingDm(true);
    const headers = await getAuthHeaders();
    if (!headers) {
      showMsg(t("discord.noSession"), "error");
      setTestingDm(false);
      return;
    }
    const res = await fetch(`${API}/api/me/discord-dm-test`, { method: "POST", headers });
    const data = await res.json();
    if (!res.ok) showMsg(data.error, "error");
    else showMsg(t("discord.testSent"));
    setTestingDm(false);
  }

  async function saveTeamInfo() {
    if (!teamName.trim() || teamName.trim().length < 3) {
      showMsg(t("team.errorTeamName"), "error");
      return;
    }
    if (!managerName.trim() || managerName.trim().length < 2) {
      showMsg(t("team.errorManagerName"), "error");
      return;
    }
    setSavingTeam(true);

    const headers = await getAuthHeaders();
    if (!headers) {
      showMsg(t("team.errorNoSession"), "error");
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
      showMsg(data.error, "error");
    } else {
      setTeam(data.team);
      setTeamName(data.team.name || "");
      setManagerName(data.team.manager_name || "");
      showMsg(team ? t("team.saved") : t("team.created"));
    }

    setSavingTeam(false);
  }

  if (loading) return (
    <PageLoader />
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

  // Per-type Discord DM toggles, grouped as in the settings design. Keys match
  // the pref keys enforced in backend/lib/discordDmPrefs.js.
  const DM_PREF_GROUPS = [
    { group: "auctions", keys: ["auction_outbid", "auction_won", "watchlist_rider_auction"] },
    { group: "transfers", keys: ["transfer_offer", "transfer_response"] },
    { group: "club", keys: ["board_update"] },
  ];

  const renderMessageBanner = (className = "") => {
    if (!msg.text) return null;
    const error = msg.type === "error";
    const Icon = error ? XIcon : CheckIcon;
    return (
      <div className={`flex items-start gap-2 rounded-cz border px-4 py-2.5 text-sm
        ${error
          ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
          : "bg-cz-success-bg text-cz-success border-cz-success/30"} ${className}`}>
        <Icon size={16} className="mt-0.5 shrink-0" />
        <span>{msg.text}</span>
      </div>
    );
  };

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">{t("header.title")}</h1>
        <p className="text-cz-3 text-sm">{t("header.subtitle")}</p>
      </div>

      {/* Account info */}
      <Card className="p-5 mb-4">
        <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("account.title")}</h2>
        <div className="space-y-4">
          {/* Username */}
          <Field label={t("account.username")} htmlFor="profile-username">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="profile-username"
                type="text"
                value={usernameInput}
                onChange={e => setUsernameInput(e.target.value)}
                minLength={3}
                maxLength={20}
                autoComplete="username"
                className="flex-1"
              />
              <Button
                onClick={saveUsername}
                loading={savingUsername}
                disabled={usernameInput.trim() === (user?.username || "")}
                variant="secondary"
                className="sm:w-auto"
              >
                {savingUsername ? t("account.saving") : t("account.saveUsername")}
              </Button>
            </div>
            <p className="text-cz-3 text-xs mt-2">{t("account.usernameHelp")}</p>
          </Field>

          {/* Email */}
          <Field label={t("account.email")} htmlFor="profile-email">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="profile-email"
                type="email"
                value={emailInput}
                onChange={e => { setEmailInput(e.target.value); setEmailNotice(""); }}
                autoComplete="email"
                data-clarity-mask="True"
                className="flex-1"
              />
              <Button
                onClick={saveEmail}
                loading={savingEmail}
                disabled={emailInput.trim() === (user?.email || "")}
                variant="secondary"
                className="sm:w-auto"
              >
                {savingEmail ? t("account.saving") : t("account.saveEmail")}
              </Button>
            </div>
            <p className="text-cz-3 text-xs mt-2">{t("account.emailHelp")}</p>
            {emailNotice && (
              <div className="mt-2 flex items-start gap-2 rounded-cz border border-cz-accent/30 bg-cz-accent/10 px-3 py-2 text-xs text-cz-accent-t">
                <InboxIcon size={14} className="mt-0.5 shrink-0" />
                <span>{emailNotice}</span>
              </div>
            )}
          </Field>

          {renderMessageBanner()}

          {user?.role === "admin" && (
            <div>
              <span className="text-xs bg-cz-danger-bg text-cz-danger border border-cz-danger/30 px-2 py-0.5 rounded-cz-pill">{t("account.adminBadge")}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Tema */}
      <Card className="p-5 mb-4">
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
                className={`text-left rounded-cz border px-3 py-2.5 transition-colors
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
      </Card>

      {/* Privatliv */}
      <Card className="p-5 mb-4">
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
          <Button type="button" onClick={openBanner} className="flex-1">
            {t("privacy.changeChoices")}
          </Button>
          <Link to="/privatlivspolitik" className={`${buttonClass({ variant: "secondary" })} flex-1 text-center no-underline`}>
            {t("privacy.readPolicy")}
          </Link>
        </div>
      </Card>

      {/* Team info */}
      {canEditTeam && (
        <Card className="p-5 mb-4">
          <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("team.title")}</h2>
          <div className="space-y-4">
            {!team && (
              <div className="bg-cz-subtle border border-cz-border rounded-cz p-4">
                <p className="text-cz-2 text-sm">
                  {t("team.notInitialized")}
                </p>
              </div>
            )}
            <Field label={t("team.teamNameLabel")} htmlFor="profile-team-name">
              <Input
                id="profile-team-name"
                type="text"
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                minLength={3}
                maxLength={30}
              />
            </Field>
            <Field label={t("team.managerNameLabel")} htmlFor="profile-manager-name">
              <Input
                id="profile-manager-name"
                type="text"
                value={managerName}
                onChange={e => setManagerName(e.target.value)}
                placeholder={t("team.managerNamePlaceholder")}
                minLength={2}
                maxLength={50}
              />
            </Field>

            {renderMessageBanner()}

            <Button onClick={saveTeamInfo} loading={savingTeam} fullWidth>
              {savingTeam ? t("team.saving") : team ? t("team.save") : t("team.create")}
            </Button>
          </div>
        </Card>
      )}

      {/* Discord integration */}
      <Card className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-cz bg-cz-discord/20 flex items-center justify-center">
            <DiscordIcon size={18} className="text-cz-discord" aria-hidden="true" />
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
              <div className="mb-4 px-4 py-2.5 rounded-cz border bg-cz-danger-bg text-cz-danger border-cz-danger/30 text-xs flex items-start gap-2">
                <XIcon size={14} className="mt-0.5 shrink-0" />
                <span>
                  {t("discord.statusUsernamePre")}<code className="font-mono">{dmStatus.discord_id}</code>{t("discord.statusUsernamePost")}
                </span>
              </div>
            ) : dmStatus.bot_configured ? (
              dmStatus.dm_enabled ? (
                <div className="mb-4 px-4 py-2.5 rounded-cz border bg-cz-success-bg text-cz-success border-cz-success/30 text-xs flex items-center gap-2">
                  <CheckIcon size={14} className="shrink-0" />
                  <span>{t("discord.statusConnected")}</span>
                </div>
              ) : (
                <div className="mb-4 px-4 py-2.5 rounded-cz border bg-cz-warning-bg text-cz-warning border-cz-warning/30 text-xs flex items-center gap-2">
                  <ClockIcon size={14} className="shrink-0" />
                  <span>{t("discord.statusDmOff")}</span>
                </div>
              )
            ) : (
              <div className="mb-4 px-4 py-2.5 rounded-cz border bg-cz-warning-bg text-cz-warning border-cz-warning/30 text-xs flex items-center gap-2">
                <AlertTriangleIcon size={14} className="shrink-0" />
                <span>{t("discord.statusBotMissing")}</span>
              </div>
            )
          ) : (
            <div className="mb-4 px-4 py-2.5 rounded-cz border bg-cz-danger-bg text-cz-danger border-cz-danger/30 text-xs flex items-center gap-2">
              <XIcon size={14} className="shrink-0" />
              <span>{t("discord.statusIdMissing")}</span>
            </div>
          )
        )}

        <div className="bg-cz-subtle border border-cz-border rounded-cz p-4 mb-4">
          <p className="text-cz-2 text-xs leading-relaxed">
            {t("discord.intro")}
          </p>
        </div>

        <Field
          label={t("discord.idLabel")}
          htmlFor="profile-discord-id"
          className="mb-4"
        >
          <Input
            id="profile-discord-id"
            type="text"
            value={discordId}
            onChange={e => setDiscordId(e.target.value)}
            placeholder={t("discord.idPlaceholder")}
            data-clarity-mask="True"
            className="font-mono focus:border-cz-discord"
          />
          <p className="text-cz-3 text-xs mt-2">
            {t("discord.idHelp")}
            <span className="block mt-1 text-cz-2">
              {t("discord.idHelpStrong")}
            </span>
          </p>
        </Field>

        {!team && renderMessageBanner("mb-3")}

        <button
          type="button"
          onClick={saveDiscordId}
          disabled={savingDiscord}
          aria-busy={savingDiscord || undefined}
          className="inline-flex w-full items-center justify-center gap-2 rounded-cz border border-transparent px-4 py-2.5 text-sm font-semibold
            bg-cz-discord text-cz-on-accent transition-colors duration-150 ease-out
            hover:bg-cz-discord-hover active:translate-y-px
            disabled:opacity-40 disabled:pointer-events-none"
        >
          {savingDiscord && (
            <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-cz-pill border-2 border-current border-t-transparent" />
          )}
          {savingDiscord ? t("discord.saving") : t("discord.save")}
        </button>

        {/* DM-toggle + test-knap (kun når ID er sat) */}
        {dmStatus?.discord_id && (
          <div className="mt-4 bg-cz-subtle border border-cz-border rounded-cz p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-cz-1 text-sm font-medium">{t("discord.toggleLabel")}</span>
              <Toggle
                id="profile-dm-enabled"
                checked={dmStatus.dm_enabled}
                disabled={savingDmEnabled}
                onChange={e => toggleDmEnabled(e.target.checked)}
              />
            </div>
            <p className="text-cz-3 text-xs leading-relaxed">
              {t("discord.toggleHint")}
            </p>

            {/* Per-type DM prefs. Greyed + disabled when the master DM is off. */}
            <div className="pt-1 space-y-3 border-t border-cz-border">
              <p className="text-cz-3 text-xs font-medium pt-3">{t("discord.prefs.heading")}</p>
              {!dmStatus.dm_enabled && (
                <p className="text-cz-4 text-xs">{t("discord.prefs.masterOffHint")}</p>
              )}
              <div className={dmStatus.dm_enabled ? "space-y-3" : "space-y-3 opacity-50"}>
                {DM_PREF_GROUPS.map(({ group, keys }) => (
                  <div key={group}>
                    <p className="text-cz-3 text-[11px] font-semibold mb-1.5">{t(`discord.prefs.group.${group}`)}</p>
                    <div className="space-y-2">
                      {keys.map(key => (
                        <div key={key} className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-cz-1 text-sm">{t(`discord.prefs.${key}.label`)}</p>
                            <p className="text-cz-3 text-xs leading-snug">{t(`discord.prefs.${key}.desc`)}</p>
                          </div>
                          <Toggle
                            id={`dm-pref-${key}`}
                            checked={dmStatus.dm_prefs?.[key] !== false}
                            disabled={!dmStatus.dm_enabled}
                            onChange={e => toggleDmPref(key, e.target.checked)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button
              onClick={sendTestDm}
              disabled={testingDm || !dmStatus.bot_configured}
              loading={testingDm}
              variant="secondary"
              size="sm"
              fullWidth
            >
              {testingDm ? t("discord.testSending") : dmStatus.bot_configured ? t("discord.testSend") : t("discord.testBotMissing")}
            </Button>
          </div>
        )}

        {!dmStatus?.discord_id && (
          <div className="mt-4 bg-cz-subtle border border-cz-border rounded-cz p-3">
            <p className="text-cz-3 text-xs font-medium mb-2">{t("discord.eventsTitle")}</p>
            <ul className="space-y-1">
              {discordEvents.map(item => (
                <li key={item} className="flex items-center gap-2 text-cz-3 text-xs">
                  <CheckIcon size={13} className="text-cz-success shrink-0" /> {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
