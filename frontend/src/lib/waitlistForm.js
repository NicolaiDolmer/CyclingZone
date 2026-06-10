// Pure helpers for FounderSupporterWaitlistForm (#362). Isolated fra React
// så de kan unit-testes uden DOM. Lokal til waitlist-flowet — ikke generel utility.
//
// #1170 slice B: al player-facing tekst (labels, subs, fejlbeskeder) lever i
// locale-filerne under `founder.form.*` (en + da). Her ligger KUN enum-values
// (DB-kontrakt) og locale-KEYS — komponenten oversætter via t().

export const INTEREST_OPTIONS = ["very", "maybe", "unsure"];

// Tier-enum values bevares (DB-felt forventer dem) selv om labels er omdøbt
// til Session B-naming: supporter_* → Premium label, pro_analyst → Pro Analyst.
export const TIER_OPTIONS = [
  "supporter_monthly",
  "supporter_annual",
  "pro_analyst_monthly",
  "free_only",
];

// Multi-select benefits. Strings gemmes som text[] i DB.
export const VALUED_BENEFITS = [
  "founder_badge",
  "early_pricing",
  "dev_dialog",
  "beta_features",
  "tactical_analysis",
  "income_breakdown",
  "ad_free",
  "support_project",
];

// Top EU + nordic prefill. "OTHER" → bruger må indtaste i fairness_red_line-feltet
// eller vi gemmer null.
export const COUNTRY_OPTIONS = [
  "DK", "NO", "SE", "DE", "NL", "BE", "FR", "IT",
  "ES", "GB", "IE", "PL", "CH", "AT", "US", "OTHER",
];

const VALID_TIERS = new Set(TIER_OPTIONS);
const VALID_INTERESTS = new Set(INTEREST_OPTIONS);
const VALID_BENEFITS = new Set(VALUED_BENEFITS);
const VALID_COUNTRIES = new Set(COUNTRY_OPTIONS);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseUtm(searchString) {
  // Accept "?foo=bar" eller "foo=bar"; tom string → null felter.
  const out = { source: null, campaign: null, medium: null };
  if (!searchString || typeof searchString !== "string") return out;
  const cleaned = searchString.startsWith("?") ? searchString.slice(1) : searchString;
  if (!cleaned) return out;
  const params = new URLSearchParams(cleaned);
  const source = params.get("utm_source");
  const campaign = params.get("utm_campaign");
  const medium = params.get("utm_medium");
  if (source) out.source = source.slice(0, 100);
  if (campaign) out.campaign = campaign.slice(0, 100);
  if (medium) out.medium = medium.slice(0, 100);
  return out;
}

export function isValidEmail(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  return EMAIL_RE.test(trimmed);
}

// Discord handles: username (3-32 chars, lowercase letters/digits/_/.) — moderne format.
// Legacy "Name#1234" tillades også. Empty string → false.
const DISCORD_RE = /^([a-z0-9._]{2,32}|.{2,32}#\d{4})$/i;
export function isValidDiscordHandle(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return DISCORD_RE.test(trimmed);
}

// Locale-keys i `founder`-namespacet for fejlbeskeder. Selve teksterne lever i
// frontend/public/locales/{en,da}/founder.json (EN-first, DA sekundært).
const ERROR_KEYS = {
  _contact: "form.errors.contact",
  email: "form.errors.email",
  discord_handle: "form.errors.discordHandle",
  interest_level: "form.errors.interestLevel",
  preferred_tier: "form.errors.preferredTier",
  country: "form.errors.country",
  valued_benefits: "form.errors.valuedBenefits",
  gdpr_consent: "form.errors.gdprConsent",
};

// Validér form-state. Returnerer { ok, errors }.
// errors-map har key per felt; UI viser kun fejl efter touched=true.
// `t` er en oversætter-funktion (i18next t fra `founder`-namespacet); uden t
// returneres rå locale-keys (praktisk i unit-tests).
export function validateForm(state, t = (key) => key) {
  const msg = {
    _contact: t(ERROR_KEYS._contact),
    email: t(ERROR_KEYS.email),
    discord_handle: t(ERROR_KEYS.discord_handle),
    interest_level: t(ERROR_KEYS.interest_level),
    preferred_tier: t(ERROR_KEYS.preferred_tier),
    country: t(ERROR_KEYS.country),
    valued_benefits: t(ERROR_KEYS.valued_benefits),
    gdpr_consent: t(ERROR_KEYS.gdpr_consent),
  };
  const errors = {};

  // Mindst én kontakt-kanal (matcher contact_present CHECK i DB).
  const hasEmail = state.email && state.email.trim();
  const hasDiscord = state.discord_handle && state.discord_handle.trim();
  if (!hasEmail && !hasDiscord) {
    errors._contact = msg._contact;
  }
  if (hasEmail && !isValidEmail(state.email)) {
    errors.email = msg.email;
  }
  if (hasDiscord && !isValidDiscordHandle(state.discord_handle)) {
    errors.discord_handle = msg.discord_handle;
  }

  if (!state.interest_level || !VALID_INTERESTS.has(state.interest_level)) {
    errors.interest_level = msg.interest_level;
  }
  if (!state.preferred_tier || !VALID_TIERS.has(state.preferred_tier)) {
    errors.preferred_tier = msg.preferred_tier;
  }

  if (state.country && !VALID_COUNTRIES.has(state.country)) {
    errors.country = msg.country;
  }

  if (Array.isArray(state.valued_benefits)) {
    const invalid = state.valued_benefits.filter(b => !VALID_BENEFITS.has(b));
    if (invalid.length) errors.valued_benefits = msg.valued_benefits;
  }

  if (!state.gdpr_consent) {
    errors.gdpr_consent = msg.gdpr_consent;
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

// Honeypot-felt skal ALTID være tomt (skjult fra rigtige users via CSS).
// Bots fylder typisk alle inputs ud → trip.
export function isHoneypotTripped(honeypotValue) {
  return typeof honeypotValue === "string" && honeypotValue.length > 0;
}

// Locale-keys i `founder`-namespacet for insert-fejl. Tekster i locale-filerne.
const INSERT_ERROR_KEYS = {
  duplicate: "form.insertErrors.duplicate",
  rls: "form.insertErrors.rls",
  network: "form.insertErrors.network",
  unknown: "form.insertErrors.unknown",
};

// Map Supabase insert-fejl til UI-venlig besked.
// Per #359-verifikation: brug error.code === '23505' for duplicate (anon kan ikke pre-SELECT).
// `t` er en oversætter-funktion; uden t returneres rå locale-keys.
export function mapInsertError(error, t = (key) => key) {
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
  return {
    kind: "unknown",
    message: error.message || messages.unknown,
  };
}

// Byg insert-payload fra form-state + UTM-kontekst. Ren funktion så vi kan teste mapping.
// VIGTIGT: Returnerer kun felter der findes i `founder_supporter_waitlist`. Felter med
// tom string mappes til null så DB ikke gemmer "".
export function buildInsertPayload(state, utm, nowIso) {
  const trim = (v) => (typeof v === "string" ? v.trim() : v);
  const nullIfEmpty = (v) => {
    const t = trim(v);
    return t ? t : null;
  };

  const email = nullIfEmpty(state.email);
  const discord = nullIfEmpty(state.discord_handle);
  const contactType = email ? "email" : discord ? "discord" : "unknown";

  return {
    email,
    discord_handle: discord,
    contact_type: contactType,
    interest_level: state.interest_level,
    preferred_tier: state.preferred_tier,
    main_reason: nullIfEmpty(state.main_reason),
    valued_benefits: Array.isArray(state.valued_benefits) && state.valued_benefits.length
      ? state.valued_benefits
      : null,
    fairness_red_line: nullIfEmpty(state.fairness_red_line),
    follow_up_consent: Boolean(state.follow_up_consent),
    country: state.country && state.country !== "OTHER" ? state.country : null,
    source: utm?.source ?? null,
    utm_campaign: utm?.campaign ?? null,
    utm_medium: utm?.medium ?? null,
    consent_given_at: nowIso || new Date().toISOString(),
  };
}

export const INITIAL_STATE = Object.freeze({
  email: "",
  discord_handle: "",
  interest_level: "",
  preferred_tier: "",
  main_reason: "",
  valued_benefits: [],
  fairness_red_line: "",
  follow_up_consent: false,
  country: "DK",
  gdpr_consent: false,
  honeypot: "",
});
