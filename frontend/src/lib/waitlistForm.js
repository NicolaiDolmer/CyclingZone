// Pure helpers for FounderSupporterWaitlistForm (#362). Isolated fra React
// så de kan unit-testes uden DOM. Lokal til waitlist-flowet — ikke generel utility.

import { getTierPricesDkk, dkkToEur, annualOf, eurLabel } from "./pricing.js";

// Tier-priser fra central konfig (#1104). Formens subs viser default-varianten
// (B, locked): DA i DKK, EN i EUR med fast dokumenteret kurs — se pricing.js.
const PRICES_DKK = getTierPricesDkk();
const SUPPORTER_ANNUAL_DKK = annualOf(PRICES_DKK.supporter);
const eurAnnualLabel = (dkkMonthly) => `€${annualOf(dkkToEur(dkkMonthly)).toFixed(2)}`;

export const INTEREST_OPTIONS = [
  { value: "very", label: "Meget interesseret, vil gerne være med fra start", label_en: "Very interested, want to be there from the start" },
  { value: "maybe", label: "Måske, afhænger af pris og indhold", label_en: "Maybe, depends on price and content" },
  { value: "unsure", label: "Usikker, vil vide mere først", label_en: "Unsure, want to know more first" },
];

// Tier-enum values bevares (DB-felt forventer dem) selv om labels er omdøbt
// til Session B-naming: supporter_* → Premium label, pro_analyst → Pro Analyst.
export const TIER_OPTIONS = [
  {
    value: "supporter_monthly",
    label: "Premium månedligt",
    label_en: "Premium monthly",
    sub: `${PRICES_DKK.supporter} DKK/md, bak projektet op og lås founder-badge`,
    sub_en: `${eurLabel(PRICES_DKK.supporter)}/mo, back the project and unlock founder badge`,
  },
  {
    value: "supporter_annual",
    label: "Premium årligt",
    label_en: "Premium annual",
    sub: `${SUPPORTER_ANNUAL_DKK} DKK/år, samme som månedlig + 2 måneder gratis`,
    sub_en: `${eurAnnualLabel(PRICES_DKK.supporter)}/yr, same as monthly + 2 months free`,
  },
  {
    value: "pro_analyst_monthly",
    label: "Pro Analyst månedligt",
    label_en: "Pro Analyst monthly",
    sub: `${PRICES_DKK.pro} DKK/md, Premium + avanceret tactical analysis`,
    sub_en: `${eurLabel(PRICES_DKK.pro)}/mo, Premium + advanced tactical analysis`,
  },
  {
    value: "free_only",
    label: "Kun gratis",
    label_en: "Free only",
    sub: "Jeg vil spille gratis, ikke betale",
    sub_en: "I will play for free, not pay",
  },
];

// Multi-select benefits. Strings gemmes som text[] i DB.
export const VALUED_BENEFITS = [
  { value: "founder_badge", label: "Founder-badge på profil", label_en: "Founder badge on profile" },
  { value: "early_pricing", label: "Lås tidlig pris for fremtiden", label_en: "Lock early-bird pricing for the future" },
  { value: "dev_dialog", label: "Direkte dialog med udvikler (Discord/DM)", label_en: "Direct dialog with developer (Discord/DM)" },
  { value: "beta_features", label: "Tidlig adgang til nye features", label_en: "Early access to new features" },
  { value: "tactical_analysis", label: "Avancerede tactical insights", label_en: "Advanced tactical insights" },
  { value: "income_breakdown", label: "Detaljeret indkomst-statistik", label_en: "Detailed income statistics" },
  { value: "ad_free", label: "Reklame-fri oplevelse", label_en: "Ad-free experience" },
  { value: "support_project", label: "Bare for at bakke projektet op", label_en: "Just to back the project" },
];

// Top EU + nordic prefill. "OTHER" → bruger må indtaste i fairness_red_line-feltet
// eller vi gemmer null.
export const COUNTRY_OPTIONS = [
  { value: "DK", label: "Danmark", label_en: "Denmark" },
  { value: "NO", label: "Norge", label_en: "Norway" },
  { value: "SE", label: "Sverige", label_en: "Sweden" },
  { value: "DE", label: "Tyskland", label_en: "Germany" },
  { value: "NL", label: "Holland", label_en: "Netherlands" },
  { value: "BE", label: "Belgien", label_en: "Belgium" },
  { value: "FR", label: "Frankrig", label_en: "France" },
  { value: "IT", label: "Italien", label_en: "Italy" },
  { value: "ES", label: "Spanien", label_en: "Spain" },
  { value: "GB", label: "Storbritannien", label_en: "United Kingdom" },
  { value: "IE", label: "Irland", label_en: "Ireland" },
  { value: "PL", label: "Polen", label_en: "Poland" },
  { value: "CH", label: "Schweiz", label_en: "Switzerland" },
  { value: "AT", label: "Østrig", label_en: "Austria" },
  { value: "US", label: "USA", label_en: "USA" },
  { value: "OTHER", label: "Andet land", label_en: "Other country" },
];

const VALID_TIERS = new Set(TIER_OPTIONS.map(o => o.value));
const VALID_INTERESTS = new Set(INTEREST_OPTIONS.map(o => o.value));
const VALID_BENEFITS = new Set(VALUED_BENEFITS.map(o => o.value));
const VALID_COUNTRIES = new Set(COUNTRY_OPTIONS.map(o => o.value));

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

// Lang-aware fejlbeskeder. `da` er backwards-compat default.
const VALIDATION_MESSAGES = {
  da: {
    _contact: "Angiv mindst email eller Discord-handle",
    email: "Ugyldig email-adresse",
    discord_handle: "Ugyldigt Discord-handle (eks. nicolai.dolmer eller Name#1234)",
    interest_level: "Vælg dit interesse-niveau",
    preferred_tier: "Vælg en tier",
    country: "Ugyldigt land",
    valued_benefits: "Ukendt benefit valgt",
    gdpr_consent: "Du skal acceptere privatlivspolitikken for at fortsætte",
  },
  en: {
    _contact: "Please enter at least an email or Discord handle",
    email: "Invalid email address",
    discord_handle: "Invalid Discord handle (e.g. nicolai.dolmer or Name#1234)",
    interest_level: "Pick your interest level",
    preferred_tier: "Pick a tier",
    country: "Invalid country",
    valued_benefits: "Unknown benefit selected",
    gdpr_consent: "You must accept the privacy policy to continue",
  },
};

// Validér form-state. Returnerer { ok, errors }.
// errors-map har key per felt; UI viser kun fejl efter touched=true.
// `lang` styrer fejlbesked-sproget (default `da` for backwards compat).
export function validateForm(state, lang = "da") {
  const msg = VALIDATION_MESSAGES[lang] || VALIDATION_MESSAGES.da;
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

const INSERT_ERROR_MESSAGES = {
  da: {
    duplicate: "Du står allerede på listen — tjek din inbox (og spam) for vores første mail.",
    rls: "Adgang nægtet. Genindlæs siden og prøv igen — kontakt support hvis problemet fortsætter.",
    network: "Kunne ikke kontakte serveren. Tjek din forbindelse og prøv igen.",
    unknown: "Noget gik galt. Prøv igen om lidt.",
  },
  en: {
    duplicate: "You're already on the list — check your inbox (and spam) for our first email.",
    rls: "Access denied. Reload the page and try again — contact support if the problem persists.",
    network: "Couldn't reach the server. Check your connection and try again.",
    unknown: "Something went wrong. Try again in a moment.",
  },
};

// Map Supabase insert-fejl til UI-venlig besked.
// Per #359-verifikation: brug error.code === '23505' for duplicate (anon kan ikke pre-SELECT).
// `lang` styrer besked-sproget (default `da` for backwards compat).
export function mapInsertError(error, lang = "da") {
  if (!error) return null;
  const messages = INSERT_ERROR_MESSAGES[lang] || INSERT_ERROR_MESSAGES.da;
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
