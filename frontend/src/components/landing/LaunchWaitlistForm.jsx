import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { track } from "@vercel/analytics";
import { supabase } from "../../lib/supabase";
import Input from "../ui/Input.jsx";
import Button from "../ui/Button.jsx";
import { CheckIcon } from "../ui/icons/index.jsx";
import {
  INITIAL_STATE,
  parseUtm,
  validateLaunchForm,
  isHoneypotTripped,
  mapLaunchInsertError,
  buildLaunchPayload,
} from "../../lib/launchWaitlist.js";

// Lean email-waitlist til den offentlige landing (#672). Skriver til launch_waitlist
// (ny ren tabel), ikke founder_supporter_waitlist. Al copy lever i `landing.waitlist.*`.
//
// Implementations-locks (som founder-flowet): .insert() UDEN .select() (anon har ingen
// SELECT-policy) + duplicate via error.code '23505' = soft success.

export default function LaunchWaitlistForm() {
  const { t } = useTranslation("landing");
  const [searchParams] = useSearchParams();
  const utm = useMemo(() => parseUtm(searchParams.toString()), [searchParams]);

  const [state, setState] = useState(INITIAL_STATE);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);
  const [success, setSuccess] = useState(false);

  const { errors } = useMemo(() => validateLaunchForm(state, t), [state, t]);
  const showErr = (key) => (touched ? errors[key] : null);

  function setField(name, value) {
    setState((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    setSubmitErr(null);

    if (isHoneypotTripped(state.honeypot)) {
      setSuccess(true); // stille fake-success for bots
      return;
    }

    const { ok } = validateLaunchForm(state, t);
    if (!ok) return;

    setSubmitting(true);
    try {
      const payload = buildLaunchPayload(state, utm);
      const { error } = await supabase.from("launch_waitlist").insert(payload);

      if (error) {
        const mapped = mapLaunchInsertError(error, t);
        if (mapped.kind === "duplicate") {
          setSuccess(true);
          track("launch_waitlist_duplicate", { source: payload.source ?? "direct" });
        } else {
          setSubmitErr(mapped);
        }
      } else {
        setSuccess(true);
        track("launch_waitlist_submit", {
          source: payload.source ?? "direct",
          campaign: payload.utm_campaign ?? "",
        });
      }
    } catch (err) {
      setSubmitErr(
        mapLaunchInsertError(err, t) ?? { kind: "unknown", message: t("waitlist.errors.unknown") },
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
          href="https://discord.gg/ykysBrWUyC"
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 border border-cz-border bg-cz-card p-5 sm:p-6" noValidate>
      <div>
        <label htmlFor="launch-email" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-cz-2">
          {t("waitlist.emailLabel")}
        </label>
        <Input
          id="launch-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={state.email}
          onChange={(e) => setField("email", e.target.value)}
          placeholder={t("waitlist.emailPlaceholder")}
          error={Boolean(showErr("email"))}
          aria-describedby={showErr("email") ? "launch-email-err" : undefined}
        />
        {showErr("email") && (
          <p id="launch-email-err" className="mt-1.5 text-xs text-cz-danger">{showErr("email")}</p>
        )}
      </div>

      <div>
        <label htmlFor="launch-name" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-cz-2">
          {t("waitlist.nameLabel")}{" "}
          <span className="font-normal normal-case text-cz-3">({t("waitlist.nameOptional")})</span>
        </label>
        <Input
          id="launch-name"
          type="text"
          autoComplete="given-name"
          value={state.name}
          onChange={(e) => setField("name", e.target.value)}
          placeholder={t("waitlist.namePlaceholder")}
          maxLength={80}
        />
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-cz-2">
        <input
          type="checkbox"
          checked={state.consent}
          onChange={(e) => setField("consent", e.target.checked)}
          className="mt-0.5 accent-cz-accent"
          aria-invalid={Boolean(showErr("consent")) || undefined}
        />
        <span>
          {t("waitlist.consentBefore")}
          <Link to={t("waitlist.privacyPath")} target="_blank" className="text-cz-accent-t underline underline-offset-2">
            {t("waitlist.consentLink")}
          </Link>
          {t("waitlist.consentAfter")}
        </span>
      </label>
      {showErr("consent") && <p className="-mt-1 text-xs text-cz-danger">{showErr("consent")}</p>}

      {/* Honeypot — skjult for sighted users + screen-readers. */}
      <div aria-hidden="true" className="pointer-events-none absolute opacity-0" style={{ left: "-9999px", height: 0, overflow: "hidden" }}>
        <label>
          Company
          <input type="text" tabIndex={-1} autoComplete="off" value={state.honeypot} onChange={(e) => setField("honeypot", e.target.value)} />
        </label>
      </div>

      {submitErr && (
        <div className="border border-cz-danger/30 bg-cz-danger-bg px-4 py-2.5 text-sm text-cz-danger">
          {submitErr.message}
        </div>
      )}

      <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting}>
        {submitting ? t("waitlist.submitting") : t("waitlist.submit")}
      </Button>
      <p className="text-center text-xs text-cz-3">{t("waitlist.disclaimer")}</p>
    </form>
  );
}
