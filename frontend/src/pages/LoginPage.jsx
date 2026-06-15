import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useLanguage } from "../lib/language";
import { mapSupabaseAuthError } from "../lib/authErrors";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { Wordmark } from "../components/Brand";
import DiscordJoinLink from "../components/DiscordJoinLink";
import { Card, Button, Input, CheckIcon, InboxIcon } from "../components/ui";
import { labelClass, helperClass } from "../components/ui/fieldStyles.js";
import { getAttribution } from "../lib/attribution";

const API = import.meta.env.VITE_API_URL;

const PUBLIC_APP_URL =
  import.meta.env.VITE_PUBLIC_APP_URL || "https://cyclingzone.org";

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
          attribution: getAttribution(),
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
    } catch (err) {
      // #1348 — login/signup/forgot brugte try/finally uden catch: et rejected
      // Supabase-kald (offline/dropped connection) clearede loading men
      // efterlod formularen UDEN fejlbesked. Vi mapper nu fejlen til en
      // handlingsanvisende besked (netværk → connection-error-copy, ellers
      // den kendte Supabase-mapping) i stedet for at sluge den.
      console.error("[auth] submit fejlede", err);
      setError(mapSupabaseAuthError(err, t));
    } finally {
      setLoading(false);
    }
  }

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
    <div className="relative flex min-h-screen items-center justify-center bg-cz-body p-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          {/* #671/#481: wordmark = the primary brand mark (BRAND_BRIEF: website
              header / marketing). The theme-aware logotype carries the brand name,
              so it doubles as the page heading — no redundant text title. */}
          <h1>
            <Wordmark className="mx-auto h-9 w-auto" />
          </h1>
          <p className="mt-4 text-sm text-cz-2">{subtitle}</p>
        </div>

        <Card className="p-6">
          {success ? (
            <div className="py-4 text-center" role="status">
              <div className="mb-4 flex justify-center">
                {success.kind === "signup" ? (
                  <CheckIcon size={32} className="text-cz-success" />
                ) : (
                  <InboxIcon size={32} className="text-cz-accent" />
                )}
              </div>
              <p className="text-sm font-medium text-cz-success">{success.message}</p>
              <p className="mt-3 text-xs text-cz-3">
                {success.kind === "signup"
                  ? t("auth:success.signupBody")
                  : t("auth:success.forgotBody")}
              </p>
              <Button
                type="button"
                variant="primary"
                fullWidth
                className="mt-4"
                onClick={() => {
                  setMode("login");
                  setSuccess(null);
                  setTeamName("");
                  setManagerName("");
                  setPassword("");
                }}
              >
                {t("auth:success.signupCta")}
              </Button>
              {success.kind === "signup" && (
                <div className="mt-4 border-t border-cz-border pt-4">
                  <p className="mb-2 text-xs text-cz-3">{t("auth:success.joinDiscord")}</p>
                  <DiscordJoinLink variant="button" label={t("auth:success.joinDiscordCta")} />
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {isSignupMode && (
                <>
                  <div>
                    <label htmlFor="auth-team-name" className={labelClass()}>
                      {t("auth:field.teamName.label")}
                    </label>
                    <Input
                      id="auth-team-name"
                      type="text"
                      value={teamName}
                      onChange={e => setTeamName(e.target.value)}
                      placeholder={t("auth:field.teamName.placeholder")}
                      required
                      minLength={3}
                      maxLength={30}
                      aria-describedby="auth-team-name-help"
                    />
                    <p id="auth-team-name-help" className={helperClass()}>{t("auth:field.teamName.help")}</p>
                  </div>
                  <div>
                    <label htmlFor="auth-manager-name" className={labelClass()}>
                      {t("auth:field.managerName.label")}
                    </label>
                    <Input
                      id="auth-manager-name"
                      type="text"
                      value={managerName}
                      onChange={e => setManagerName(e.target.value)}
                      placeholder={t("auth:field.managerName.placeholder")}
                      required
                      minLength={2}
                      maxLength={50}
                      aria-describedby="auth-manager-name-help"
                    />
                    <p id="auth-manager-name-help" className={helperClass()}>{t("auth:field.managerName.help")}</p>
                  </div>
                </>
              )}

              <div>
                <label htmlFor="auth-email" className={labelClass()}>
                  {t("auth:field.email.label")}
                </label>
                <Input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t("auth:field.email.placeholder")}
                  required
                  error={Boolean(error)}
                  aria-describedby={
                    [isForgotMode ? "auth-email-help" : null, error ? "auth-error" : null]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                />
                {isForgotMode && (
                  <p id="auth-email-help" className={helperClass()}>
                    {t("auth:field.email.forgotHelp")}
                  </p>
                )}
              </div>

              {!isForgotMode && (
                <div>
                  <label htmlFor="auth-password" className={labelClass()}>
                    {t("auth:field.password.label")}
                  </label>
                  <Input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    error={Boolean(error)}
                    aria-describedby={
                      [isSignupMode ? "auth-password-help" : null, error ? "auth-error" : null]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  />
                  {isSignupMode && (
                    <p id="auth-password-help" className={helperClass()}>{t("auth:field.password.help")}</p>
                  )}
                </div>
              )}

              {error && (
                <div
                  id="auth-error"
                  role="alert"
                  className="rounded-cz border border-cz-danger/30 bg-cz-danger-bg px-4 py-2.5 text-sm text-cz-danger"
                >
                  {error}
                </div>
              )}

              <Button type="submit" variant="primary" fullWidth loading={loading}>
                {submitLabel}
              </Button>
            </form>
          )}

          {!success && (
            <div className="mt-4 flex flex-col gap-2 text-center">
              {isLoginMode && (
                <>
                  <Button type="button" variant="ghost" size="sm" onClick={() => switchMode("forgot")}>
                    {t("auth:switch.forgot")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => switchMode("signup")}>
                    {t("auth:switch.signup")}
                  </Button>
                </>
              )}

              {isSignupMode && (
                <Button type="button" variant="ghost" size="sm" onClick={() => switchMode("login")}>
                  {t("auth:switch.login")}
                </Button>
              )}

              {isForgotMode && (
                <Button type="button" variant="ghost" size="sm" onClick={() => switchMode("login")}>
                  {t("auth:switch.backToLogin")}
                </Button>
              )}
            </div>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-cz-3">
          {t("auth:page.tagline")}
        </p>
        <p className="mt-2 text-center text-xs text-cz-3">
          <Link to={language === "en" ? "/privacy-policy" : "/privatlivspolitik"} className="underline hover:text-cz-1">
            {t("auth:footer.privacyPolicy")}
          </Link>
        </p>
      </div>
    </div>
  );
}
