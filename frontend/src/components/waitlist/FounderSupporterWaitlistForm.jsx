import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { track } from "@vercel/analytics";
import { supabase } from "../../lib/supabase";
import DiscordJoinLink from "../DiscordJoinLink";
import { CheckIcon } from "../ui/icons/index.jsx";
import { formatCurrency, currencyForLocale } from "../../lib/intl.js";
import { getTierPricesDkk, monthlyInCurrency, annualOf } from "../../lib/pricing.js";
import {
  INITIAL_STATE,
  INTEREST_OPTIONS,
  TIER_OPTIONS,
  VALUED_BENEFITS,
  COUNTRY_OPTIONS,
  parseUtm,
  validateForm,
  isHoneypotTripped,
  mapInsertError,
  buildInsertPayload,
} from "../../lib/waitlistForm.js";

// Form til Founder-waitlist (#362, Session B naming locked in #500). Embeddes i landing
// page (#361) eller står alene på /founder-supporter til preview.
//
// Al copy lever i `founder.form.*` i locale-filerne (en + da) — #1170 slice B.
// Sproget følger appens globale i18n-sprog via useTranslation("founder").
//
// Implementations-locks fra #359-verifikation (overhold):
//   1. .insert() UDEN .select() → Supabase sender Prefer: return=minimal automatisk.
//      Anon har ingen SELECT-policy, så RETURNING fejler med RLS-violation.
//   2. Duplicate-check via error.code === '23505' (ikke pre-SELECT).
//   3. Honeypot er client-side; ingen edge-function rate-limit i denne PR.

const fieldLabel = "block text-xs font-medium text-cz-2 uppercase tracking-wider mb-1.5";
const inputBase =
  "w-full bg-cz-subtle border border-cz-border rounded-cz " +
  "px-4 py-2.5 text-cz-1 text-sm placeholder-cz-3 " +
  "focus:outline-none focus:border-cz-accent transition-all";
const inputErr = "border-cz-danger/50 focus:border-cz-danger";

function RadioCard({ name, value, checked, onChange, label, sub, disabled }) {
  return (
    <label
      className={
        "flex items-start gap-3 cursor-pointer rounded-cz border p-3 transition-all " +
        (checked
          ? "border-cz-accent bg-cz-subtle"
          : "border-cz-border bg-cz-subtle hover:border-cz-border-strong")
      }
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-1 accent-cz-accent"
      />
      <span className="flex-1">
        <span className="block text-cz-1 text-sm font-medium">{label}</span>
        {sub && <span className="block text-cz-3 text-xs mt-0.5">{sub}</span>}
      </span>
    </label>
  );
}

function CheckboxCard({ value, checked, onChange, label, disabled }) {
  return (
    <label
      className={
        "flex items-center gap-2.5 cursor-pointer rounded-cz border px-3 py-2 transition-all " +
        (checked
          ? "border-cz-accent bg-cz-subtle"
          : "border-cz-border bg-cz-subtle hover:border-cz-border-strong")
      }
    >
      <input
        type="checkbox"
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="accent-cz-accent"
      />
      <span className="text-cz-1 text-sm">{label}</span>
    </label>
  );
}

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} className="text-cz-danger text-xs mt-1.5">
      {message}
    </p>
  );
}

export default function FounderSupporterWaitlistForm() {
  const { t, i18n } = useTranslation("founder");
  const [searchParams] = useSearchParams();

  // #1104: tier-subs viser default-prisvarianten (B, locked) i visningsvalutaen
  // (da -> DKK, ellers EUR) fra samme centrale konfig som sidens tier-kort, så
  // formen aldrig drifter fra pricing.js. free_only har ingen pris.
  const tierPrice = useMemo(() => {
    const currency = currencyForLocale(i18n.language);
    const dkk = getTierPricesDkk();
    const fmt = amount =>
      formatCurrency(amount, currency, {
        minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
        maximumFractionDigits: 2,
      });
    const supporter = monthlyInCurrency(dkk.supporter, currency);
    const pro = monthlyInCurrency(dkk.pro, currency);
    return {
      supporter_monthly: fmt(supporter),
      supporter_annual: fmt(annualOf(supporter)),
      pro_analyst_monthly: fmt(pro),
    };
  }, [i18n.language]);
  const utm = useMemo(() => parseUtm(searchParams.toString()), [searchParams]);

  const [state, setState] = useState(INITIAL_STATE);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);
  const [success, setSuccess] = useState(false);

  // Persist UTM på første mount så de stadig er der hvis bruger filtrerer URL.
  useEffect(() => {
    if (utm.source || utm.campaign || utm.medium) {
      // Vises i hidden inputs for transparency + så devtools kan inspecte.
    }
  }, [utm]);

  const { errors } = useMemo(() => validateForm(state, t), [state, t]);

  function setField(name, value) {
    setState(prev => ({ ...prev, [name]: value }));
  }

  function toggleBenefit(value) {
    setState(prev => {
      const next = new Set(prev.valued_benefits);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, valued_benefits: Array.from(next) };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    setSubmitErr(null);

    if (isHoneypotTripped(state.honeypot)) {
      // Stille fake-success for bots — de skal ikke vide at de blev fanget.
      setSuccess(true);
      return;
    }

    const { ok } = validateForm(state, t);
    if (!ok) return;

    setSubmitting(true);
    try {
      const payload = buildInsertPayload(state, utm);

      // VIGTIGT: ingen .select() — Supabase bruger Prefer: return=minimal automatisk
      // når .select() udelades. Anon har ingen SELECT-policy så RETURNING ville fejle.
      const { error } = await supabase
        .from("founder_supporter_waitlist")
        .insert(payload);

      if (error) {
        const mapped = mapInsertError(error, t);
        // Duplicate behandles som soft-success (de står allerede på listen).
        if (mapped.kind === "duplicate") {
          setSuccess(true);
          track("waitlist_duplicate", {
            source: payload.source ?? "direct",
            campaign: payload.utm_campaign ?? "",
          });
        } else {
          setSubmitErr(mapped);
        }
      } else {
        setSuccess(true);
        track("waitlist_submit", {
          interest: payload.interest_level,
          tier: payload.preferred_tier,
          source: payload.source ?? "direct",
          campaign: payload.utm_campaign ?? "",
        });
      }
    } catch (err) {
      setSubmitErr(mapInsertError(err, t) ?? { kind: "unknown", message: t("form.insertErrors.unknown") });
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    const successNext = t("form.successNext", { returnObjects: true });
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-6 text-center">
        <div className="mb-4 flex justify-center" aria-hidden="true">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-cz-pill border border-cz-accent/40 bg-cz-accent/10 text-cz-accent-t">
            <CheckIcon size={26} />
          </span>
        </div>
        <h2 className="text-cz-1 font-display text-2xl tracking-wide mb-2">{t("form.successTitle")}</h2>
        <p className="text-cz-2 text-sm mb-4">{t("form.successBody")}</p>
        <div className="bg-cz-subtle border border-cz-border rounded-cz p-3 text-left text-cz-2 text-sm">
          <p className="font-medium mb-1">{t("form.successNextTitle")}</p>
          <ul className="list-disc list-inside space-y-1 text-cz-3">
            {(Array.isArray(successNext) ? successNext : []).map((item, i) => (
              <li key={i}>
                {item.text}
                {item.link && (
                  <>
                    <a href={item.link.href} target="_blank" rel="noopener noreferrer" className="text-cz-accent underline">
                      {item.link.text}
                    </a>
                    {item.suffix}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4">
          <DiscordJoinLink variant="button" label={t("form.successDiscordCta")} />
        </div>
      </div>
    );
  }

  const showErr = (key) => (touched ? errors[key] : null);

  return (
    <form onSubmit={handleSubmit} className="bg-cz-card border border-cz-border rounded-cz p-5 sm:p-6 flex flex-col gap-6" noValidate>
      {/* ----- Kontakt ----- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-cz-1 text-base font-semibold mb-1">{t("form.contactLegend")}</legend>
        <p className="text-cz-3 text-xs -mt-1">{t("form.contactHelp")}</p>

        <div>
          <label htmlFor="waitlist-email" className={fieldLabel}>{t("form.emailLabel")}</label>
          <input
            id="waitlist-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={state.email}
            onChange={e => setField("email", e.target.value)}
            placeholder={t("form.emailPlaceholder")}
            className={`${inputBase} ${showErr("email") ? inputErr : ""}`}
            aria-invalid={Boolean(showErr("email"))}
            aria-describedby={showErr("email") ? "err-email" : undefined}
          />
          <FieldError id="err-email" message={showErr("email")} />
        </div>

        <div>
          <label htmlFor="waitlist-discord" className={fieldLabel}>{t("form.discordLabel")}</label>
          <input
            id="waitlist-discord"
            type="text"
            autoComplete="off"
            value={state.discord_handle}
            onChange={e => setField("discord_handle", e.target.value)}
            placeholder={t("form.discordPlaceholder")}
            className={`${inputBase} ${showErr("discord_handle") ? inputErr : ""}`}
            aria-invalid={Boolean(showErr("discord_handle"))}
            aria-describedby={showErr("discord_handle") ? "err-discord" : undefined}
          />
          <FieldError id="err-discord" message={showErr("discord_handle")} />
        </div>

        {showErr("_contact") && (
          <p className="text-cz-danger text-xs">{errors._contact}</p>
        )}
      </fieldset>

      {/* ----- Interesse-niveau ----- */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-cz-1 text-base font-semibold mb-1">{t("form.interestLegend")}</legend>
        {INTEREST_OPTIONS.map(value => (
          <RadioCard
            key={value}
            name="interest_level"
            value={value}
            checked={state.interest_level === value}
            onChange={() => setField("interest_level", value)}
            label={t(`form.interestOptions.${value}`)}
          />
        ))}
        <FieldError id="err-interest" message={showErr("interest_level")} />
      </fieldset>

      {/* ----- Tier ----- */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-cz-1 text-base font-semibold mb-1">{t("form.tierLegend")}</legend>
        <p className="text-cz-3 text-xs -mt-1 mb-1">{t("form.tierHelp")}</p>
        {TIER_OPTIONS.map(value => (
          <RadioCard
            key={value}
            name="preferred_tier"
            value={value}
            checked={state.preferred_tier === value}
            onChange={() => setField("preferred_tier", value)}
            label={t(`form.tierOptions.${value}.label`)}
            sub={t(`form.tierOptions.${value}.sub`, { price: tierPrice[value] })}
          />
        ))}
        <FieldError id="err-tier" message={showErr("preferred_tier")} />
      </fieldset>

      {/* ----- Valued benefits ----- */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-cz-1 text-base font-semibold mb-1">{t("form.benefitsLegend")}</legend>
        <p className="text-cz-3 text-xs -mt-1 mb-1">{t("form.benefitsHelp")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {VALUED_BENEFITS.map(value => (
            <CheckboxCard
              key={value}
              value={value}
              checked={state.valued_benefits.includes(value)}
              onChange={() => toggleBenefit(value)}
              label={t(`form.benefitOptions.${value}`)}
            />
          ))}
        </div>
        <FieldError id="err-benefits" message={showErr("valued_benefits")} />
      </fieldset>

      {/* ----- Fri tekst (optional) ----- */}
      <fieldset className="flex flex-col gap-3">
        <div>
          <label htmlFor="waitlist-main-reason" className={fieldLabel}>{t("form.mainReasonLabel")}</label>
          <textarea
            id="waitlist-main-reason"
            value={state.main_reason}
            onChange={e => setField("main_reason", e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t("form.mainReasonPlaceholder")}
            className={`${inputBase} resize-y`}
          />
        </div>

        <div>
          <label htmlFor="waitlist-fairness" className={fieldLabel}>{t("form.fairnessLabel")}</label>
          <textarea
            id="waitlist-fairness"
            value={state.fairness_red_line}
            onChange={e => setField("fairness_red_line", e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t("form.fairnessPlaceholder")}
            className={`${inputBase} resize-y`}
          />
        </div>
      </fieldset>

      {/* ----- Country ----- */}
      <div>
        <label htmlFor="waitlist-country" className={fieldLabel}>{t("form.countryLabel")}</label>
        <select
          id="waitlist-country"
          value={state.country}
          onChange={e => setField("country", e.target.value)}
          className={`${inputBase} ${showErr("country") ? inputErr : ""}`}
        >
          {COUNTRY_OPTIONS.map(value => (
            <option key={value} value={value}>{t(`form.countryOptions.${value}`)}</option>
          ))}
        </select>
        <FieldError id="err-country" message={showErr("country")} />
      </div>

      {/* ----- Consents ----- */}
      <fieldset className="flex flex-col gap-3">
        <label className="flex items-start gap-2.5 cursor-pointer text-sm text-cz-2">
          <input
            type="checkbox"
            checked={state.follow_up_consent}
            onChange={e => setField("follow_up_consent", e.target.checked)}
            className="mt-0.5 accent-cz-accent"
          />
          <span>{t("form.followUpConsent")}</span>
        </label>

        <label className="flex items-start gap-2.5 cursor-pointer text-sm text-cz-2">
          <input
            type="checkbox"
            checked={state.gdpr_consent}
            onChange={e => setField("gdpr_consent", e.target.checked)}
            className="mt-0.5 accent-cz-accent"
            aria-invalid={Boolean(showErr("gdpr_consent"))}
          />
          <span>
            {t("form.gdprBefore")}
            <Link to={t("form.privacyPath")} target="_blank" className="text-cz-accent underline">
              {t("form.gdprLink")}
            </Link>
            {t("form.gdprAfter")}
          </span>
        </label>
        <FieldError id="err-gdpr" message={showErr("gdpr_consent")} />
      </fieldset>

      {/* Honeypot — skjult for sighted users + screen-readers (aria-hidden + tabIndex=-1). */}
      <div aria-hidden="true" className="absolute opacity-0 pointer-events-none" style={{ left: "-9999px", height: 0, overflow: "hidden" }}>
        <label>
          {t("form.honeypotLabel")}
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={state.honeypot}
            onChange={e => setField("honeypot", e.target.value)}
          />
        </label>
      </div>

      {submitErr && (
        <div className="bg-cz-danger-bg border border-cz-danger/30 rounded-cz px-4 py-2.5 text-cz-danger text-sm">
          {submitErr.message}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-cz-accent text-cz-on-accent font-bold rounded-cz py-3 text-sm
          tracking-wide hover:brightness-110 transition-all
          disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? t("form.submitLoading") : t("form.submit")}
      </button>

      <p className="text-cz-3 text-xs text-center">{t("form.submitDisclaimer")}</p>
    </form>
  );
}
