// Pure helpers for FounderSupporterWaitlistForm (#362). Isolated fra React
// så de kan unit-testes uden DOM. Lokal til waitlist-flowet — ikke generel utility.

export const INTEREST_OPTIONS = [
  { value: "very", label: "Meget interesseret — vil gerne være med fra start" },
  { value: "maybe", label: "Måske — afhænger af pris og indhold" },
  { value: "unsure", label: "Usikker — vil vide mere først" },
];

export const TIER_OPTIONS = [
  {
    value: "supporter_monthly",
    label: "Supporter månedligt",
    sub: "49 DKK/md — vis støtte til projektet, lås founder-badge",
  },
  {
    value: "supporter_annual",
    label: "Supporter årligt",
    sub: "490 DKK/år — samme som månedlig + 2 måneder gratis",
  },
  {
    value: "pro_analyst_monthly",
    label: "Pro Analyst månedligt",
    sub: "89 DKK/md — supporter + avanceret tactical analysis",
  },
  {
    value: "free_only",
    label: "Kun gratis",
    sub: "Jeg vil bruge spillet gratis — ikke betale",
  },
];

// Multi-select benefits. Strings gemmes som text[] i DB.
export const VALUED_BENEFITS = [
  { value: "founder_badge", label: "Founder-badge på profil" },
  { value: "early_pricing", label: "Lås tidlig pris for fremtiden" },
  { value: "dev_dialog", label: "Direkte dialog med udvikler (Discord/DM)" },
  { value: "beta_features", label: "Tidlig adgang til nye features" },
  { value: "tactical_analysis", label: "Avancerede tactical insights" },
  { value: "income_breakdown", label: "Detaljeret indkomst-statistik" },
  { value: "ad_free", label: "Reklame-fri oplevelse" },
  { value: "support_project", label: "Bare for at støtte projektet" },
];

// Top EU + nordic prefill. "OTHER" → bruger må indtaste i fairness_red_line-feltet
// eller vi gemmer null.
export const COUNTRY_OPTIONS = [
  { value: "DK", label: "Danmark" },
  { value: "NO", label: "Norge" },
  { value: "SE", label: "Sverige" },
  { value: "DE", label: "Tyskland" },
  { value: "NL", label: "Holland" },
  { value: "BE", label: "Belgien" },
  { value: "FR", label: "Frankrig" },
  { value: "IT", label: "Italien" },
  { value: "ES", label: "Spanien" },
  { value: "GB", label: "Storbritannien" },
  { value: "IE", label: "Irland" },
  { value: "PL", label: "Polen" },
  { value: "CH", label: "Schweiz" },
  { value: "AT", label: "Østrig" },
  { value: "US", label: "USA" },
  { value: "OTHER", label: "Andet land" },
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

// Validér form-state. Returnerer { ok, errors }.
// errors-map har key per felt; UI viser kun fejl efter touched=true.
export function validateForm(state) {
  const errors = {};

  // Mindst én kontakt-kanal (matcher contact_present CHECK i DB).
  const hasEmail = state.email && state.email.trim();
  const hasDiscord = state.discord_handle && state.discord_handle.trim();
  if (!hasEmail && !hasDiscord) {
    errors._contact = "Angiv mindst email eller Discord-handle";
  }
  if (hasEmail && !isValidEmail(state.email)) {
    errors.email = "Ugyldig email-adresse";
  }
  if (hasDiscord && !isValidDiscordHandle(state.discord_handle)) {
    errors.discord_handle = "Ugyldigt Discord-handle (eks. nicolai.dolmer eller Name#1234)";
  }

  if (!state.interest_level || !VALID_INTERESTS.has(state.interest_level)) {
    errors.interest_level = "Vælg dit interesse-niveau";
  }
  if (!state.preferred_tier || !VALID_TIERS.has(state.preferred_tier)) {
    errors.preferred_tier = "Vælg en tier";
  }

  if (state.country && !VALID_COUNTRIES.has(state.country)) {
    errors.country = "Ugyldigt land";
  }

  if (Array.isArray(state.valued_benefits)) {
    const invalid = state.valued_benefits.filter(b => !VALID_BENEFITS.has(b));
    if (invalid.length) errors.valued_benefits = "Ukendt benefit valgt";
  }

  if (!state.gdpr_consent) {
    errors.gdpr_consent = "Du skal acceptere privatlivspolitikken for at fortsætte";
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

// Honeypot-felt skal ALTID være tomt (skjult fra rigtige users via CSS).
// Bots fylder typisk alle inputs ud → trip.
export function isHoneypotTripped(honeypotValue) {
  return typeof honeypotValue === "string" && honeypotValue.length > 0;
}

// Map Supabase insert-fejl til UI-venlig besked.
// Per #359-verifikation: brug error.code === '23505' for duplicate (anon kan ikke pre-SELECT).
export function mapInsertError(error) {
  if (!error) return null;
  const code = error.code || error?.details || "";
  const msg = (error.message || "").toLowerCase();

  if (code === "23505" || msg.includes("duplicate") || msg.includes("unique constraint")) {
    return {
      kind: "duplicate",
      message: "Du står allerede på listen — tjek din inbox (og spam) for vores første mail.",
    };
  }
  if (code === "42501" || msg.includes("row-level security") || msg.includes("rls")) {
    return {
      kind: "rls",
      message: "Adgang nægtet. Genindlæs siden og prøv igen — kontakt support hvis problemet fortsætter.",
    };
  }
  if (msg.includes("network") || msg.includes("fetch")) {
    return {
      kind: "network",
      message: "Kunne ikke kontakte serveren. Tjek din forbindelse og prøv igen.",
    };
  }
  return {
    kind: "unknown",
    message: error.message || "Noget gik galt. Prøv igen om lidt.",
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
