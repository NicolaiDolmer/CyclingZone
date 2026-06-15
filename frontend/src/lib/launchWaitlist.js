// Pure helpers for the public landing waitlist (#672). Isolated fra React så de
// kan unit-testes uden DOM. Adskilt fra waitlistForm.js (founder premium-survey) —
// her er kontrakten lean: email + valgfrit navn + consent + attribution.
//
// Al player-facing tekst lever i `landing`-namespacet (en + da). Her ligger KUN
// validerings-logik + locale-KEYS; komponenten oversætter via t().
//
// Implementations-locks (samme som founder-flowet, #359-verifikation):
//   1. .insert() UDEN .select() → Supabase sender Prefer: return=minimal. Anon har
//      ingen SELECT-policy, så RETURNING ville fejle med RLS-violation.
//   2. Duplicate-check via error.code === '23505' (ikke pre-SELECT) → soft success.

import { isValidEmail, parseUtm } from "./waitlistForm.js";

export { isValidEmail, parseUtm };

const MAX_NAME = 80;

// Locale-keys i `landing`-namespacet. Teksterne lever i
// frontend/public/locales/{en,da}/landing.json (EN-first, DA sekundært).
const ERROR_KEYS = {
  emailRequired: "waitlist.errors.emailRequired",
  emailInvalid: "waitlist.errors.emailInvalid",
  consent: "waitlist.errors.consent",
};

// Validér waitlist-state. Returnerer { ok, errors }.
// `t` er en oversætter-funktion (i18next t fra `landing`-namespacet); uden t
// returneres rå locale-keys (praktisk i unit-tests).
export function validateLaunchForm(state, t = (key) => key) {
  const errors = {};
  const email = typeof state.email === "string" ? state.email.trim() : "";

  if (!email) {
    errors.email = t(ERROR_KEYS.emailRequired);
  } else if (!isValidEmail(email)) {
    errors.email = t(ERROR_KEYS.emailInvalid);
  }

  if (!state.consent) {
    errors.consent = t(ERROR_KEYS.consent);
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

// Honeypot-felt skal ALTID være tomt (skjult fra rigtige users via CSS).
export function isHoneypotTripped(honeypotValue) {
  return typeof honeypotValue === "string" && honeypotValue.length > 0;
}

// Byg insert-payload fra form-state + UTM-kontekst. Ren funktion (testbar mapping).
// Returnerer kun felter der findes i `launch_waitlist`. Tom string → null så DB
// ikke gemmer "". Navn trimmes og kappes til MAX_NAME.
export function buildLaunchPayload(state, utm, nowIso) {
  const trim = (v) => (typeof v === "string" ? v.trim() : v);
  const name = trim(state.name);

  return {
    email: trim(state.email),
    name: name ? name.slice(0, MAX_NAME) : null,
    consent_given_at: nowIso || new Date().toISOString(),
    source: utm?.source ?? null,
    utm_campaign: utm?.campaign ?? null,
    utm_medium: utm?.medium ?? null,
  };
}

// Locale-keys i `landing`-namespacet for insert-fejl.
const INSERT_ERROR_KEYS = {
  duplicate: "waitlist.errors.duplicate",
  rls: "waitlist.errors.rls",
  network: "waitlist.errors.network",
  unknown: "waitlist.errors.unknown",
};

// Map Supabase insert-fejl til UI-venlig besked.
// Per #359-verifikation: error.code === '23505' for duplicate (anon kan ikke pre-SELECT).
export function mapLaunchInsertError(error, t = (key) => key) {
  if (!error) return null;
  const messages = {
    duplicate: t(INSERT_ERROR_KEYS.duplicate),
    rls: t(INSERT_ERROR_KEYS.rls),
    network: t(INSERT_ERROR_KEYS.network),
    unknown: t(INSERT_ERROR_KEYS.unknown),
  };
  const code = error.code || error?.details || "";
  const msg = (error.message || "").toLowerCase();

  if (code === "23505" || msg.includes("duplicate") || msg.includes("unique constraint")) {
    return { kind: "duplicate", message: messages.duplicate };
  }
  if (code === "42501" || msg.includes("row-level security") || msg.includes("rls")) {
    return { kind: "rls", message: messages.rls };
  }
  if (msg.includes("network") || msg.includes("fetch")) {
    return { kind: "network", message: messages.network };
  }
  return { kind: "unknown", message: messages.unknown };
}

export const INITIAL_STATE = Object.freeze({
  email: "",
  name: "",
  consent: false,
  honeypot: "",
});
