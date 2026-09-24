// First-touch signup attribution (#679). Snapshots how a visitor first reached
// the site so we can see which channels bring new players. Captured at first
// visit (UTM params + referrer are gone by the time they sign up) and persisted
// to the DB only at signup. First-party, minimal, no cross-site tracking —
// basis: legitimate interest (documented in the privacy policy). Independent of
// the analytics-consent gate by design: first-touch happens before the cookie
// banner is answered, and nothing is persisted until the user creates an account.
const STORAGE_KEY = "cz_attribution_v1"; // gitleaks:allow — localStorage-nøglenavn, ikke en secret
// Exported so trafficBeacon.js reads the same key list (#4320). Only the constant
// is shared — the beacon stays storage-less and never calls captureFirstTouch.
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

// URL.canParse is too new for older Safari, so parse defensively by hand.
function parseUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null; // not an absolute URL (e.g. a bare host): keep it as an external referrer
  }
}

// Builds the stored record. Pure, so the same-origin rule is unit-testable.
// #5310: since the marketing front page took over "/" (14/9) a visitor can reach
// the SPA from one of our own pages. A same-origin referrer is then our own page,
// never a channel: it is dropped, and when its query still carries utm_* (the
// tagged link landed on the marketing page) the UTMs are recovered from it. UTMs
// on the current URL always win. marketing/lib/attribution.ts writes the same
// record on the marketing pages; keep the two in step.
export function buildFirstTouchRecord({ search, referrer, path, origin, firstSeenAt }) {
  const params = new URLSearchParams(search || "");
  let utmParams = params;
  let externalReferrer = referrer ? String(referrer) : "";
  if (externalReferrer && origin) {
    const refUrl = parseUrl(externalReferrer);
    if (refUrl && refUrl.origin === origin) {
      externalReferrer = "";
      if (!UTM_KEYS.some((k) => params.get(k))) utmParams = refUrl.searchParams;
    }
  }
  const record = { first_seen_at: firstSeenAt };
  for (const k of UTM_KEYS) {
    const v = utmParams.get(k);
    record[k] = v ? v.slice(0, 200) : null;
  }
  record.referrer = externalReferrer ? externalReferrer.slice(0, 500) : null;
  record.landing_path = path ? String(path).slice(0, 200) : null;
  return record;
}

// Runs on every load but writes ONCE — the first visit wins. Args are injectable
// for unit-testing; defaults read the real browser context.
export function captureFirstTouch({
  search = window.location.search,
  referrer = document.referrer,
  path = window.location.pathname,
  origin = typeof window !== "undefined" ? window.location.origin : null,
  storage = window.localStorage,
  now = () => new Date().toISOString(),
} = {}) {
  try {
    if (storage.getItem(STORAGE_KEY)) return; // first-touch wins — never overwrite
    const record = buildFirstTouchRecord({ search, referrer, path, origin, firstSeenAt: now() });
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorage unavailable (private mode / blocked) — attribution is best-effort.
  }
}

export function getAttribution(storage = window.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
