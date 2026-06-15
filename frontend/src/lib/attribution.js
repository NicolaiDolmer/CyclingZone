// First-touch signup attribution (#679). Snapshots how a visitor first reached
// the site so we can see which channels bring new players. Captured at first
// visit (UTM params + referrer are gone by the time they sign up) and persisted
// to the DB only at signup. First-party, minimal, no cross-site tracking —
// basis: legitimate interest (documented in the privacy policy). Independent of
// the analytics-consent gate by design: first-touch happens before the cookie
// banner is answered, and nothing is persisted until the user creates an account.
const KEY = "cz_attribution_v1";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

// Runs on every load but writes ONCE — the first visit wins. Args are injectable
// for unit-testing; defaults read the real browser context.
export function captureFirstTouch({
  search = window.location.search,
  referrer = document.referrer,
  path = window.location.pathname,
  storage = window.localStorage,
  now = () => new Date().toISOString(),
} = {}) {
  try {
    if (storage.getItem(KEY)) return; // first-touch wins — never overwrite
    const params = new URLSearchParams(search || "");
    const record = { first_seen_at: now() };
    for (const k of UTM_KEYS) {
      const v = params.get(k);
      record[k] = v ? v.slice(0, 200) : null;
    }
    record.referrer = referrer ? String(referrer).slice(0, 500) : null;
    record.landing_path = path ? String(path).slice(0, 200) : null;
    storage.setItem(KEY, JSON.stringify(record));
  } catch {
    // localStorage unavailable (private mode / blocked) — attribution is best-effort.
  }
}

export function getAttribution(storage = window.localStorage) {
  try {
    const raw = storage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
