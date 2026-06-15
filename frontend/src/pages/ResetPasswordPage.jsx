import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useLanguage } from "../lib/language";
import { mapSupabaseAuthError } from "../lib/authErrors";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { Wordmark } from "../components/Brand";
import { Card, Button, Input, CheckIcon, AlertTriangleIcon } from "../components/ui";
import { labelClass, helperClass } from "../components/ui/fieldStyles.js";

export default function ResetPasswordPage({ session }) {
  const navigate = useNavigate();
  const { t } = useTranslation(["auth", "errors"]);
  const { language } = useLanguage();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(Boolean(session));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    let resolved = false;

    function resolve(hasSession) {
      if (resolved || !active) return;
      resolved = true;
      setHasRecoverySession(hasSession);
      setChecking(false);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "USER_UPDATED") {
        resolve(Boolean(nextSession));
        return;
      }

      if (event === "SIGNED_OUT") {
        resolve(false);
      }
    });

    // Recovery-sessionen er ikke altid etableret med det samme efter redirect
    // (langsom forbindelse). Vi poller op til 5s med 250ms-interval — samme
    // mønster som LoginPage's waitForAuthHeaders — så et gyldigt link ikke
    // fejlagtigt markeres som udløbet efter blot 2s.
    let pollTimer = null;
    const pollDeadline = Date.now() + 5000;
    async function pollForSession() {
      const { data: { session: nextSession } } = await supabase.auth.getSession();
      if (!active || resolved) return;
      if (nextSession) { resolve(true); return; }
      if (Date.now() >= pollDeadline) { resolve(false); return; }
      pollTimer = setTimeout(pollForSession, 250);
    }
    pollForSession();

    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!hasRecoverySession) {
      setError(t("auth:error.resetLinkExpired"));
      return;
    }

    if (password.length < 6) {
      setError(t("auth:error.passwordTooShort"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("auth:error.passwordMismatch"));
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setError(mapSupabaseAuthError(error, t));
        return;
      }

      setSuccess(t("auth:success.passwordUpdatedTitle"));
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      // #1348 — updateUser brugte try/finally uden catch: et rejected kald
      // (offline/dropped connection) clearede loading men efterlod formularen
      // uden fejlbesked. Map fejlen (netværk → connection-error-copy) i stedet
      // for at sluge den.
      console.error("[auth] password-reset fejlede", err);
      setError(mapSupabaseAuthError(err, t));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-cz-body p-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          {/* #671: wordmark = primary brand mark (BRAND_BRIEF). Here it sits above
              the contextual "Reset password" heading rather than replacing it. */}
          <Wordmark className="mx-auto mb-6 h-8 w-auto" alt="" />
          <h1 className="text-2xl font-bold tracking-tight text-cz-1">
            {t("auth:resetPassword.title")}
          </h1>
          <p className="mt-1 text-sm text-cz-2">
            {t("auth:resetPassword.subtitle")}
          </p>
        </div>

        <Card className="p-6">
          {checking ? (
            <div className="flex justify-center py-10" role="status" aria-label={t("auth:resetPassword.title")}>
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-cz-border border-t-cz-accent" />
            </div>
          ) : success ? (
            <div className="py-4 text-center" role="status">
              <div className="mb-4 flex justify-center">
                <CheckIcon size={32} className="text-cz-success" />
              </div>
              <p className="text-sm font-medium text-cz-success">{success}</p>
              <p className="mt-3 text-xs text-cz-3">
                {t("auth:success.passwordUpdatedBody")}
              </p>
              <Button
                type="button"
                variant="primary"
                fullWidth
                className="mt-4"
                onClick={() => navigate("/dashboard", { replace: true })}
              >
                {t("auth:success.passwordUpdatedCta")}
              </Button>
            </div>
          ) : hasRecoverySession ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label htmlFor="reset-new-password" className={labelClass()}>
                  {t("auth:field.newPassword.label")}
                </label>
                <Input
                  id="reset-new-password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  error={Boolean(error)}
                  aria-describedby={
                    ["reset-new-password-help", error ? "reset-error" : null]
                      .filter(Boolean)
                      .join(" ")
                  }
                />
                <p id="reset-new-password-help" className={helperClass()}>{t("auth:field.newPassword.help")}</p>
              </div>

              <div>
                <label htmlFor="reset-confirm-password" className={labelClass()}>
                  {t("auth:field.confirmPassword.label")}
                </label>
                <Input
                  id="reset-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  error={Boolean(error)}
                  aria-describedby={error ? "reset-error" : undefined}
                />
              </div>

              {error && (
                <div
                  id="reset-error"
                  role="alert"
                  className="rounded-cz border border-cz-danger/30 bg-cz-danger-bg px-4 py-2.5 text-sm text-cz-danger"
                >
                  {error}
                </div>
              )}

              <Button type="submit" variant="primary" fullWidth loading={loading}>
                {loading ? t("auth:submit.savePassword.loading") : t("auth:submit.savePassword.idle")}
              </Button>
            </form>
          ) : (
            <div className="py-4 text-center" role="alert">
              <div className="mb-4 flex justify-center">
                <AlertTriangleIcon size={32} className="text-cz-danger" />
              </div>
              <p className="text-sm font-medium text-cz-danger">
                {t("auth:error.resetLinkInactive")}
              </p>
              <p className="mt-3 text-xs text-cz-3">
                {t("auth:resetPassword.linkExpiredHelp")}
              </p>
              <Button
                type="button"
                variant="primary"
                fullWidth
                className="mt-4"
                onClick={() => navigate("/login", { replace: true })}
              >
                {t("auth:switch.backToLogin")}
              </Button>
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
