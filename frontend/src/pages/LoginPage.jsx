import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useLanguage } from "../lib/language";
import { mapSupabaseAuthError } from "../lib/authErrors";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { StackedMark } from "../components/Brand";

const API = import.meta.env.VITE_API_URL;

const PUBLIC_APP_URL =
  import.meta.env.VITE_PUBLIC_APP_URL || "https://cycling-zone.vercel.app";

function getPasswordResetRedirectUrl() {
  return new URL("/reset-password", PUBLIC_APP_URL).toString();
}

export default function LoginPage() {
  const { t } = useTranslation(["auth", "errors"]);
  const { language } = useLanguage();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teamName, setTeamName] = useState("");
  const [managerName, setManagerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);

  const isLoginMode = mode === "login";
  const isSignupMode = mode === "signup";
  const isForgotMode = mode === "forgot";

  function resetMessages() {
    setError("");
    setSuccess(null);
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    resetMessages();

    if (nextMode !== "signup") {
      setTeamName("");
      setManagerName("");
    }
  }

  async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    };
  }

  // #446: signup-bootstrap fejlede stille på langsomt netværk fordi fixed 1s
  // setTimeout ikke var nok til at Supabase-session blev tilgængelig.
  // Vi venter nu op til 5s med 250ms polling og logger udfaldet.
  async function waitForAuthHeaders(maxMs = 5000) {
    const intervalMs = 250;
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const headers = await getAuthHeaders();
      if (headers) return headers;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    resetMessages();
    setLoading(true);

    try {
      if (isLoginMode) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) setError(t("auth:error.invalidCredentials"));
        return;
      }

      if (isForgotMode) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: getPasswordResetRedirectUrl(),
        });

        if (error) {
          setError(mapSupabaseAuthError(error, t));
          return;
        }

        setSuccess({
          kind: "forgot",
          message: t("auth:success.forgotTitle"),
        });
        setPassword("");
        return;
      }

      if (!teamName.trim() || teamName.trim().length < 3) {
        setError(t("auth:error.teamNameTooShort"));
        return;
      }

      if (!managerName.trim() || managerName.trim().length < 2) {
        setError(t("auth:error.managerNameTooShort"));
        return;
      }

      const { data: existing } = await supabase
        .from("teams")
        .select("id")
        .ilike("name", teamName.trim())
        .single();

      if (existing) {
        setError(t("auth:error.teamNameTaken"));
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { team_name: teamName.trim(), language },
        },
      });

      if (signUpError) {
        setError(mapSupabaseAuthError(signUpError, t));
        return;
      }

      if (!data?.user) return;

      const headers = await waitForAuthHeaders(5000);
      if (!headers) {
        console.warn("[signup] session ikke ready efter 5s — viser signupPartial");
        setSuccess({
          kind: "signup",
          message: t("auth:success.signupPartial"),
        });
        return;
      }

      const bootstrapRes = await fetch(`${API}/api/teams/my`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          name: teamName.trim(),
          manager_name: managerName.trim(),
        }),
      });
      let bootstrapData = {};
      try {
        bootstrapData = await bootstrapRes.json();
      } catch {
        // Backend kan returnere tomt body på 502/503; behold tomt object.
      }

      if (!bootstrapRes.ok) {
        console.error("[signup] bootstrap fejlede", bootstrapRes.status, bootstrapData);
        setError(t("auth:error.bootstrapFailed", { detail: bootstrapData.error || `HTTP ${bootstrapRes.status}` }));
        return;
      }

      setSuccess({
        kind: "signup",
        message: t("auth:success.signupComplete", { teamName: bootstrapData.team?.name || teamName.trim() }),
      });
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full bg-cz-subtle border border-cz-border rounded-lg " +
    "px-4 py-2.5 text-cz-1 text-sm placeholder-cz-3 " +
    "focus:outline-none focus:border-cz-accent transition-all";

  const subtitle = isLoginMode
    ? t("auth:page.subtitle.login")
    : isSignupMode
      ? t("auth:page.subtitle.signup")
      : t("auth:page.subtitle.forgot");

  const submitLabel = loading
    ? isSignupMode
      ? t("auth:submit.signup.loading")
      : isForgotMode
        ? t("auth:submit.forgot.loading")
        : t("auth:submit.login.loading")
    : isSignupMode
      ? t("auth:submit.signup.idle")
      : isForgotMode
        ? t("auth:submit.forgot.idle")
        : t("auth:submit.login.idle");

  return (
    <div className="min-h-screen bg-cz-body flex items-center justify-center p-4 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(rgb(var(--accent)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--accent)) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[500px] h-[500px] rounded-full opacity-10 blur-[120px] bg-cz-accent pointer-events-none"
      />

      <div className="absolute top-4 right-4 z-20">
        <LanguageSwitcher />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-10">
          {/* #481: real stacked CYCLING/ZONE brand mark (replaces the placeholder "C" tile). */}
          <StackedMark className="w-16 h-16 mb-5 shadow-[0_0_40px_rgba(232,197,71,0.3)]" />

          <h1 className="text-2xl font-bold text-cz-1 tracking-tight">
            {t("auth:page.title")}
          </h1>
          <p className="text-cz-2 text-sm mt-1">{subtitle}</p>
        </div>

        <div className="bg-cz-card border border-cz-border rounded-2xl p-6">
          {success ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-4">{success.kind === "signup" ? "🎉" : "✉️"}</div>
              <p className="text-cz-success text-sm font-medium">{success.message}</p>
              <p className="text-cz-3 text-xs mt-3">
                {success.kind === "signup"
                  ? t("auth:success.signupBody")
                  : t("auth:success.forgotBody")}
              </p>
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setSuccess(null);
                  setTeamName("");
                  setManagerName("");
                  setPassword("");
                }}
                className="mt-4 w-full bg-cz-accent text-cz-on-accent font-bold rounded-lg
                  py-2.5 text-sm hover:brightness-110 transition-all"
              >
                {t("auth:success.signupCta")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {isSignupMode && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-cz-2 uppercase tracking-wider mb-1.5">
                      {t("auth:field.teamName.label")}
                    </label>
                    <input
                      type="text"
                      value={teamName}
                      onChange={e => setTeamName(e.target.value)}
                      placeholder={t("auth:field.teamName.placeholder")}
                      required
                      minLength={3}
                      maxLength={30}
                      className={inputClass}
                    />
                    <p className="text-cz-3 text-xs mt-1">{t("auth:field.teamName.help")}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-cz-2 uppercase tracking-wider mb-1.5">
                      {t("auth:field.managerName.label")}
                    </label>
                    <input
                      type="text"
                      value={managerName}
                      onChange={e => setManagerName(e.target.value)}
                      placeholder={t("auth:field.managerName.placeholder")}
                      required
                      minLength={2}
                      maxLength={50}
                      className={inputClass}
                    />
                    <p className="text-cz-3 text-xs mt-1">{t("auth:field.managerName.help")}</p>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-cz-2 uppercase tracking-wider mb-1.5">
                  {t("auth:field.email.label")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t("auth:field.email.placeholder")}
                  required
                  className={inputClass}
                />
                {isForgotMode && (
                  <p className="text-cz-3 text-xs mt-1">
                    {t("auth:field.email.forgotHelp")}
                  </p>
                )}
              </div>

              {!isForgotMode && (
                <div>
                  <label className="block text-xs font-medium text-cz-2 uppercase tracking-wider mb-1.5">
                    {t("auth:field.password.label")}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className={inputClass}
                  />
                  {isSignupMode && (
                    <p className="text-cz-3 text-xs mt-1">{t("auth:field.password.help")}</p>
                  )}
                </div>
              )}

              {error && (
                <div className="bg-cz-danger-bg border border-cz-danger/30 rounded-lg px-4 py-2.5 text-cz-danger text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-cz-accent text-cz-on-accent font-bold rounded-lg
                  py-2.5 text-sm tracking-wide hover:brightness-110 transition-all
                  disabled:opacity-50 disabled:cursor-not-allowed
                  shadow-[0_4px_20px_rgba(232,197,71,0.2)]"
              >
                {submitLabel}
              </button>
            </form>
          )}

          {!success && (
            <div className="mt-4 flex flex-col gap-2 text-center">
              {isLoginMode && (
                <>
                  <button
                    type="button"
                    onClick={() => switchMode("forgot")}
                    className="text-sm text-cz-2 hover:text-cz-1 transition-colors"
                  >
                    {t("auth:switch.forgot")}
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode("signup")}
                    className="text-sm text-cz-2 hover:text-cz-1 transition-colors"
                  >
                    {t("auth:switch.signup")}
                  </button>
                </>
              )}

              {isSignupMode && (
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-sm text-cz-2 hover:text-cz-1 transition-colors"
                >
                  {t("auth:switch.login")}
                </button>
              )}

              {isForgotMode && (
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-sm text-cz-2 hover:text-cz-1 transition-colors"
                >
                  {t("auth:switch.backToLogin")}
                </button>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-cz-3 text-xs mt-6">
          {t("auth:page.tagline")}
        </p>
        <p className="text-center text-cz-3 text-xs mt-2">
          <Link to={language === "en" ? "/privacy-policy" : "/privatlivspolitik"} className="hover:text-cz-1 underline">
            {t("auth:footer.privacyPolicy")}
          </Link>
        </p>
      </div>
    </div>
  );
}
