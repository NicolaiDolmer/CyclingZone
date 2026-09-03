"use client";

// Porteret fra frontend/src/components/landing/LaunchWaitlistForm.jsx (#672).
// Skriver til samme launch_waitlist-tabel via anon-klient. Ændringer i porten:
//   - t() bygges lokalt fra den serialiserbare dict-prop (funktioner kan ikke
//     krydse RSC-grænsen).
//   - Supabase-klienten oprettes lazy ved submit (build kræver ingen env).
//   - @vercel/analytics-track udeladt indtil analytics-beslutningen (GA4/Vercel)
//     implementeres samlet på marketing-sitet (#4067, måle-laget).

import { useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { makeT, type Dict } from "@/lib/t";
import { CheckIcon } from "@/components/icons";
import { buttonClass, controlClass } from "./button-styles";
import {
  INITIAL_STATE,
  type LaunchFormState,
  parseUtm,
  validateLaunchForm,
  isHoneypotTripped,
  buildLaunchPayload,
  mapLaunchInsertError,
  type MappedError,
} from "@/lib/launch-waitlist";

const DISCORD_URL = "https://discord.gg/ykysBrWUyC";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default function WaitlistForm({ dict, privacyHref }: { dict: Dict; privacyHref: string }) {
  const t = useMemo(() => makeT(dict), [dict]);

  const [state, setState] = useState<LaunchFormState>(INITIAL_STATE);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<MappedError | null>(null);
  const [success, setSuccess] = useState(false);

  const { errors } = useMemo(() => validateLaunchForm(state, t), [state, t]);
  const showErr = (key: "email" | "consent") => (touched ? errors[key] : undefined);

  function setField<K extends keyof LaunchFormState>(name: K, value: LaunchFormState[K]) {
    setState((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setSubmitErr(null);

    if (isHoneypotTripped(state.honeypot)) {
      setSuccess(true); // stille fake-success for bots
      return;
    }

    const { ok } = validateLaunchForm(state, t);
    if (!ok) return;

    const supabase = getSupabase();
    if (!supabase) {
      setSubmitErr({ kind: "unknown", message: t("waitlist.errors.unknown") });
      return;
    }

    setSubmitting(true);
    try {
      const utm = parseUtm(window.location.search);
      const payload = buildLaunchPayload(state, utm);
      const { error } = await supabase.from("launch_waitlist").insert(payload);

      if (error) {
        const mapped = mapLaunchInsertError(error, t);
        if (mapped?.kind === "duplicate") setSuccess(true);
        else setSubmitErr(mapped);
      } else {
        setSuccess(true);
      }
    } catch (err) {
      setSubmitErr(
        mapLaunchInsertError(err as { message?: string }, t) ?? {
          kind: "unknown",
          message: t("waitlist.errors.unknown"),
        },
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="border border-cz-border bg-cz-card p-6">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-cz border border-cz-accent/40 bg-cz-accent/10 text-cz-accent-t">
          <CheckIcon size={18} />
        </span>
        <h3 className="mt-3 font-display text-2xl tracking-wide text-cz-1">{t("waitlist.successTitle")}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-cz-2">{t("waitlist.successBody")}</p>
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-cz-accent-t underline underline-offset-4 hover:text-cz-1"
        >
          {t("waitlist.successDiscord")}
        </a>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="relative flex flex-col gap-4 border border-cz-border bg-cz-card p-5 sm:p-6"
      noValidate
    >
      <div>
        <label htmlFor="launch-email" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-cz-2">
          {t("waitlist.emailLabel")}
        </label>
        <input
          id="launch-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={state.email}
          onChange={(e) => setField("email", e.target.value)}
          placeholder={t("waitlist.emailPlaceholder")}
          className={controlClass({ error: Boolean(showErr("email")) })}
          aria-invalid={showErr("email") ? true : undefined}
          aria-describedby={showErr("email") ? "launch-email-err" : undefined}
        />
        {showErr("email") && (
          <p id="launch-email-err" className="mt-1.5 text-xs text-cz-danger">
            {showErr("email")}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="launch-name" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-cz-2">
          {t("waitlist.nameLabel")}{" "}
          <span className="font-normal normal-case text-cz-3">({t("waitlist.nameOptional")})</span>
        </label>
        <input
          id="launch-name"
          type="text"
          autoComplete="given-name"
          value={state.name}
          onChange={(e) => setField("name", e.target.value)}
          placeholder={t("waitlist.namePlaceholder")}
          maxLength={80}
          className={controlClass()}
        />
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-cz-2">
        <input
          type="checkbox"
          checked={state.consent}
          onChange={(e) => setField("consent", e.target.checked)}
          className="mt-0.5 accent-cz-accent"
          aria-invalid={showErr("consent") ? true : undefined}
        />
        <span>
          {t("waitlist.consentBefore")}
          <a href={privacyHref} target="_blank" rel="noopener noreferrer" className="text-cz-accent-t underline underline-offset-2">
            {t("waitlist.consentLink")}
          </a>
          {t("waitlist.consentAfter")}
        </span>
      </label>
      {showErr("consent") && <p className="-mt-1 text-xs text-cz-danger">{showErr("consent")}</p>}

      {/* Honeypot — skjult for sighted users + screen-readers. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute opacity-0"
        style={{ left: "-9999px", height: 0, overflow: "hidden" }}
      >
        <label>
          Company
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={state.honeypot}
            onChange={(e) => setField("honeypot", e.target.value)}
          />
        </label>
      </div>

      {submitErr && (
        <div className="border border-cz-danger/30 bg-cz-danger-bg px-4 py-2.5 text-sm text-cz-danger">
          {submitErr.message}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting || undefined}
        className={buttonClass({ variant: "primary", size: "lg", fullWidth: true })}
      >
        {submitting && (
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {submitting ? t("waitlist.submitting") : t("waitlist.submit")}
      </button>
      <p className="text-center text-xs text-cz-3">{t("waitlist.disclaimer")}</p>
    </form>
  );
}
