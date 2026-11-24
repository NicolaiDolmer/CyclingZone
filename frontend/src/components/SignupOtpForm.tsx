import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, InboxIcon, Input } from "./ui";
import { labelClass, helperClass } from "./ui/fieldStyles.js";
import { normalizeSignupOtp } from "../lib/signupOtp.ts";
import { supabase } from "../lib/supabase.ts";
import { isNetworkError } from "../lib/authErrors";
import { RELOAD_BLOCK_REASONS, useReloadBlock } from "../lib/reloadGate.js";

type Props = {
  address?: string;
  initialEmail?: string;
  danish: boolean;
  loadingMail: boolean;
  mailSent: boolean;
  resendError: string;
  cooldownLeft: number;
  onResend: (email: string) => Promise<boolean>;
  onChangeAddress?: () => void;
  onBack: () => void;
};

// The approved staging mockups provide test copy. Live wording has a separate release gate.
const STAGING_COPY = {
  en: {
    title: "Enter your email code",
    sentTo: "Code sent to",
    label: "6-digit code",
    submit: "Confirm email",
    verifying: "Confirming email…",
    resend: "Send a new code",
    cooldown: "You can send a new code in {{seconds}}s",
    invalid: "Check the code or request a new one.",
    format: "Enter all six digits.",
  },
  da: {
    title: "Indtast e-mailkoden",
    sentTo: "Kode sendt til",
    label: "6-cifret kode",
    submit: "Bekræft e-mail",
    verifying: "Bekræfter e-mail…",
    resend: "Send en ny kode",
    cooldown: "Du kan sende en ny kode om {{seconds}} sek.",
    invalid: "Tjek koden, eller bed om en ny.",
    format: "Indtast alle seks cifre.",
  },
};

export default function SignupOtpForm({
  address, initialEmail = "", danish, loadingMail, mailSent, resendError, cooldownLeft,
  onResend, onChangeAddress, onBack,
}: Props) {
  const { t } = useTranslation(["auth", "errors", "common"]);
  const copy = STAGING_COPY[danish ? "da" : "en"];
  const [email, setEmail] = useState(initialEmail);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const busy = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const target = address ?? email.trim();

  useReloadBlock(Boolean(input || (!address && email)), RELOAD_BLOCK_REASONS.DIRTY);
  useReloadBlock(verifying || loadingMail, RELOAD_BLOCK_REASONS.BUSY);
  useEffect(() => { heading.current?.focus(); }, []);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || loadingMail) return;
    const token = normalizeSignupOtp(input);
    if (!token) {
      setError(copy.format);
      return;
    }

    busy.current = true;
    setVerifying(true);
    setError("");
    try {
      const response = await supabase.auth.verifyOtp({ email: target, token, type: "email" });
      if (response.error) {
        setError(isNetworkError(response.error) ? t("errors:generic.networkError") : copy.invalid);
        return;
      }
      if (!response.data.session) {
        setError(t("errors:supabase.unknown"));
        return;
      }
    } catch (failure) {
      setError(isNetworkError(failure) ? t("errors:generic.networkError") : t("errors:supabase.unknown"));
    } finally {
      busy.current = false;
      setVerifying(false);
    }
  }

  async function resend() {
    if (busy.current || loadingMail || cooldownLeft > 0 || !target) return;
    if (emailInput.current && !emailInput.current.reportValidity()) return;
    busy.current = true;
    setError("");
    try {
      if (await onResend(target)) setInput("");
    } finally {
      busy.current = false;
    }
  }

  return (
    <section aria-labelledby="signup-code-title" className="flex flex-col gap-4">
      <div className="text-center">
        <InboxIcon size={28} className="mx-auto mb-2 text-cz-accent" />
        <h2 ref={heading} id="signup-code-title" tabIndex={-1} className="text-lg font-semibold text-cz-1">{copy.title}</h2>
        {address && (
          <p className="mt-2 text-sm text-cz-2">
            {copy.sentTo} <strong className="block font-semibold text-cz-1 [overflow-wrap:anywhere]">{address}</strong>
          </p>
        )}
      </div>

      <form onSubmit={verify} className="flex flex-col gap-4">
        {!address && (
          <div>
            <label className={labelClass()} htmlFor="signup-code-email">{t("auth:field.email.label")}</label>
            <Input
              ref={emailInput}
              id="signup-code-email"
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={email}
              disabled={verifying || loadingMail}
              onChange={(event: ChangeEvent<HTMLInputElement>) => { setEmail(event.target.value); setError(""); }}
            />
          </div>
        )}
        <div>
          <label className={labelClass()} htmlFor="signup-code">{copy.label}</label>
          <Input
            id="signup-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="done"
            spellCheck={false}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "signup-code-error" : undefined}
            value={input}
            disabled={verifying || loadingMail}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { setInput(event.target.value); setError(""); }}
            className="font-data text-lg tabular-nums tracking-widest"
          />
          {error && <p id="signup-code-error" className="mt-2 text-sm text-cz-danger" role="alert">{error}</p>}
        </div>
        <Button type="submit" variant="primary" fullWidth disabled={verifying || loadingMail}>
          {verifying ? copy.verifying : copy.submit}
        </Button>
      </form>

      <div className="border-t border-cz-border pt-3">
        <p className={helperClass()}>{t("auth:success.confirmSpam")}</p>
        <div role="status" className="text-sm text-cz-2">
          {resendError ? <p className="mt-1 text-cz-danger">{resendError}</p> : mailSent && <p className="mt-1">{t("auth:success.resendSent")}</p>}
          {cooldownLeft > 0 && <p className="mt-1" aria-live="off">{copy.cooldown.replace("{{seconds}}", String(cooldownLeft))}</p>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3">
          <QuietAction disabled={verifying || loadingMail || cooldownLeft > 0 || !target} onClick={resend}>
            {loadingMail ? t("auth:success.resendSending") : copy.resend}
          </QuietAction>
          {onChangeAddress && <QuietAction disabled={verifying || loadingMail} onClick={onChangeAddress}>{t("auth:success.wrongEmailCta")}</QuietAction>}
          <QuietAction disabled={verifying || loadingMail} onClick={onBack}>{t("auth:switch.backToLogin")}</QuietAction>
        </div>
      </div>
    </section>
  );
}

function QuietAction({ children, disabled, onClick }: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return <Button variant="ghost" type="button" disabled={disabled} onClick={onClick} className="min-h-11">{children}</Button>;
}
