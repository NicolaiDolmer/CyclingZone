import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { track } from "@vercel/analytics";
import { supabase } from "../../lib/supabase";
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

// Form til Founder Supporter waitlist (#362). Embeddes i landing page (#361)
// eller står alene på /founder-supporter til preview.
//
// Implementations-locks fra #359-verifikation (overhold):
//   1. .insert() UDEN .select() → Supabase sender Prefer: return=minimal automatisk.
//      Anon har ingen SELECT-policy, så RETURNING fejler med RLS-violation.
//   2. Duplicate-check via error.code === '23505' (ikke pre-SELECT).
//   3. Honeypot er client-side; ingen edge-function rate-limit i denne PR.

const fieldLabel = "block text-xs font-medium text-cz-2 uppercase tracking-wider mb-1.5";
const inputBase =
  "w-full bg-cz-subtle border border-cz-border rounded-lg " +
  "px-4 py-2.5 text-cz-1 text-sm placeholder-cz-3 " +
  "focus:outline-none focus:border-cz-accent transition-all";
const inputErr = "border-cz-danger/50 focus:border-cz-danger";

function RadioCard({ name, value, checked, onChange, label, sub, disabled }) {
  return (
    <label
      className={
        "flex items-start gap-3 cursor-pointer rounded-lg border p-3 transition-all " +
        (checked
          ? "border-cz-accent bg-cz-accent/5"
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
        "flex items-center gap-2.5 cursor-pointer rounded-lg border px-3 py-2 transition-all " +
        (checked
          ? "border-cz-accent bg-cz-accent/5"
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

export default function FounderSupporterWaitlistForm({ priceVariantLabel = null }) {
  const [searchParams] = useSearchParams();
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

  const { errors } = useMemo(() => validateForm(state), [state]);

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

    const { ok } = validateForm(state);
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
        const mapped = mapInsertError(error);
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
      setSubmitErr(mapInsertError(err) ?? { kind: "unknown", message: "Uventet fejl. Prøv igen." });
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-2xl p-6 text-center">
        <div className="text-4xl mb-3">🎉</div>
        <h2 className="text-cz-1 text-xl font-bold mb-2">Du er på listen!</h2>
        <p className="text-cz-2 text-sm mb-4">
          Tak fordi du vil være med fra start. Vi sender en mail når Founder Supporter
          rulles ud — og inden da hvis vi har spørgsmål til hvad du synes.
        </p>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3 text-left text-cz-2 text-sm">
          <p className="font-medium mb-1">Næste skridt:</p>
          <ul className="list-disc list-inside space-y-1 text-cz-3">
            <li>Tilmeld dig vores Discord når invite-link er klar (se{" "}
              <a href="https://github.com/NicolaiDolmer/CyclingZone/issues/415" target="_blank" rel="noopener noreferrer" className="text-cz-accent hover:underline">
                #415
              </a>)
            </li>
            <li>Følg patch notes for fremgang</li>
            <li>Tjek din inbox de næste dage</li>
          </ul>
        </div>
        <p className="text-cz-3 text-xs mt-4">
          Refs sprint-validation #362. Du kan altid skrive til{" "}
          <a href="mailto:nicolai.dolmer.mikkelsen@gmail.com" className="text-cz-accent hover:underline">
            nicolai.dolmer.mikkelsen@gmail.com
          </a>
          .
        </p>
      </div>
    );
  }

  const showErr = (key) => (touched ? errors[key] : null);

  return (
    <form onSubmit={handleSubmit} className="bg-cz-card border border-cz-border rounded-2xl p-5 sm:p-6 flex flex-col gap-6" noValidate>
      {priceVariantLabel && (
        <div className="bg-cz-accent/10 border border-cz-accent/30 rounded-lg px-3 py-2 text-cz-1 text-sm">
          <span className="text-cz-3 text-xs">Pris-variant:</span>{" "}
          <span className="font-semibold">{priceVariantLabel}</span>
        </div>
      )}

      {/* ----- Kontakt ----- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-cz-1 text-base font-semibold mb-1">Sådan kontakter vi dig</legend>
        <p className="text-cz-3 text-xs -mt-1">Mindst én af felterne skal udfyldes.</p>

        <div>
          <label htmlFor="waitlist-email" className={fieldLabel}>Email</label>
          <input
            id="waitlist-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={state.email}
            onChange={e => setField("email", e.target.value)}
            placeholder="din@email.dk"
            className={`${inputBase} ${showErr("email") ? inputErr : ""}`}
            aria-invalid={Boolean(showErr("email"))}
            aria-describedby={showErr("email") ? "err-email" : undefined}
          />
          <FieldError id="err-email" message={showErr("email")} />
        </div>

        <div>
          <label htmlFor="waitlist-discord" className={fieldLabel}>Discord-handle (valgfri)</label>
          <input
            id="waitlist-discord"
            type="text"
            autoComplete="off"
            value={state.discord_handle}
            onChange={e => setField("discord_handle", e.target.value)}
            placeholder="f.eks. nicolai.dolmer"
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
        <legend className="text-cz-1 text-base font-semibold mb-1">Hvor interesseret er du?</legend>
        {INTEREST_OPTIONS.map(opt => (
          <RadioCard
            key={opt.value}
            name="interest_level"
            value={opt.value}
            checked={state.interest_level === opt.value}
            onChange={() => setField("interest_level", opt.value)}
            label={opt.label}
          />
        ))}
        <FieldError id="err-interest" message={showErr("interest_level")} />
      </fieldset>

      {/* ----- Tier ----- */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-cz-1 text-base font-semibold mb-1">Hvilken tier ville passe dig?</legend>
        <p className="text-cz-3 text-xs -mt-1 mb-1">
          Vi tester forskellige pris-punkter — dit svar er ikke bindende.
        </p>
        {TIER_OPTIONS.map(opt => (
          <RadioCard
            key={opt.value}
            name="preferred_tier"
            value={opt.value}
            checked={state.preferred_tier === opt.value}
            onChange={() => setField("preferred_tier", opt.value)}
            label={opt.label}
            sub={opt.sub}
          />
        ))}
        <FieldError id="err-tier" message={showErr("preferred_tier")} />
      </fieldset>

      {/* ----- Valued benefits ----- */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-cz-1 text-base font-semibold mb-1">Hvad ville være vigtigt for dig? (valgfri)</legend>
        <p className="text-cz-3 text-xs -mt-1 mb-1">Vælg så mange som relevant.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {VALUED_BENEFITS.map(opt => (
            <CheckboxCard
              key={opt.value}
              value={opt.value}
              checked={state.valued_benefits.includes(opt.value)}
              onChange={() => toggleBenefit(opt.value)}
              label={opt.label}
            />
          ))}
        </div>
        <FieldError id="err-benefits" message={showErr("valued_benefits")} />
      </fieldset>

      {/* ----- Fri tekst (optional) ----- */}
      <fieldset className="flex flex-col gap-3">
        <div>
          <label htmlFor="waitlist-main-reason" className={fieldLabel}>Hvad er den vigtigste grund til at du overvejer at støtte? (valgfri)</label>
          <textarea
            id="waitlist-main-reason"
            value={state.main_reason}
            onChange={e => setField("main_reason", e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Skriv et par sætninger..."
            className={`${inputBase} resize-y`}
          />
        </div>

        <div>
          <label htmlFor="waitlist-fairness" className={fieldLabel}>Noget der ville få dig til at sige nej? (valgfri)</label>
          <textarea
            id="waitlist-fairness"
            value={state.fairness_red_line}
            onChange={e => setField("fairness_red_line", e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="F.eks. pay-to-win mekanikker, dårlig fairness..."
            className={`${inputBase} resize-y`}
          />
        </div>
      </fieldset>

      {/* ----- Country ----- */}
      <div>
        <label htmlFor="waitlist-country" className={fieldLabel}>Hvor bor du?</label>
        <select
          id="waitlist-country"
          value={state.country}
          onChange={e => setField("country", e.target.value)}
          className={`${inputBase} ${showErr("country") ? inputErr : ""}`}
        >
          {COUNTRY_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
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
          <span>
            Det er OK at jeg bliver kontaktet med op til 2 follow-up spørgsmål (interview / kort survey).
            Dette er valgfrit.
          </span>
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
            Jeg har læst og accepterer{" "}
            <Link to="/privatlivspolitik" target="_blank" className="text-cz-accent hover:underline">
              privatlivspolitikken
            </Link>{" "}
            og indvilliger i at min email + Discord-handle gemmes til formålet ovenfor.
          </span>
        </label>
        <FieldError id="err-gdpr" message={showErr("gdpr_consent")} />
      </fieldset>

      {/* Honeypot — skjult for sighted users + screen-readers (aria-hidden + tabIndex=-1). */}
      <div aria-hidden="true" className="absolute opacity-0 pointer-events-none" style={{ left: "-9999px", height: 0, overflow: "hidden" }}>
        <label>
          Lad dette felt være tomt
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
        <div className="bg-cz-danger-bg border border-cz-danger/30 rounded-lg px-4 py-2.5 text-cz-danger text-sm">
          {submitErr.message}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-cz-accent text-cz-on-accent font-bold rounded-lg py-3 text-sm
          tracking-wide hover:brightness-110 transition-all
          disabled:opacity-50 disabled:cursor-not-allowed
          shadow-[0_4px_20px_rgba(232,197,71,0.2)]"
      >
        {submitting ? "Sender..." : "Tilmeld mig waitlisten"}
      </button>

      <p className="text-cz-3 text-xs text-center">
        Vi sender ikke spam og deler aldrig din info. Du kan altid skrive til os for at blive slettet.
      </p>
    </form>
  );
}
