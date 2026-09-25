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

// #5304: ad-platform click-ids. Paid traffic often arrives WITHOUT utm_* (the
// platform appends its own click-id automatically; utm_* only appears if a
// tracking template was set up by hand), so without these a paid visit lands
// as "(direct)" — same bucket as Discord/word-of-mouth. Kept as a separate
// constant (not merged into UTM_KEYS) so trafficBeacon.js's per-pageview beacon
// is unaffected — click-ids are only meaningful in the first-touch snapshot.
// fbclid = Meta/Facebook Ads, gclid = Google Ads, ttclid = TikTok Ads,
// msclkid = Microsoft/Bing Ads.
// PRIVACY (blocking review finding, #5304, 25/9): unlike utm_source — one
// value shared by an entire campaign — a click-id is unique PER CLICK, a
// stronger re-identifying signal. The owner's 16/9 review comment on #5304 is
// explicit that the existing first-touch consent basis for utm_* "cannot be
// inherited" by click-ids without its own assessment, and that comment did
// NOT grant build-go. This file only ever writes click-ids to localStorage —
// captureFirstTouch()/buildFirstTouchRecord() never call the network or
// Supabase. Anything that forwards the stored record OFF this device (Supabase
// auth signUp `options.data`, the team-bootstrap PUT body) must go through
// getAttributionForBackend() below instead of getAttribution(), so click-ids
// stay client-side-only until the owner makes that decision. See
// docs/GROWTH_STACK.md §3.1.
export const CLICK_ID_KEYS = ["fbclid", "gclid", "ttclid", "msclkid"];

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
      // #5304: fall back to the referrer's query for EITHER signal (utm or
      // click-id) missing from the current URL, same recovery as #5310.
      const carriesSignal = [...UTM_KEYS, ...CLICK_ID_KEYS].some((k) => params.get(k));
      if (!carriesSignal) utmParams = refUrl.searchParams;
    }
  }
  const record = { first_seen_at: firstSeenAt };
  for (const k of UTM_KEYS) {
    const v = utmParams.get(k);
    record[k] = v ? v.slice(0, 200) : null;
  }
  for (const k of CLICK_ID_KEYS) {
    const v = utmParams.get(k);
    record[k] = v ? v.slice(0, 200) : null;
  }
  // #5304: a click-id with no utm_source is a CANDIDATE paid signal, not proof
  // (owner review 16/9: "fbclid alone doesn't prove paid" — a click-id can
  // survive a forwarded/shared link same as a utm parameter can). Marked
  // distinctly from a confirmed utm_source-driven channel so downstream
  // reporting never silently counts it as "paid".
  record.source_hint = !record.utm_source && CLICK_ID_KEYS.some((k) => record[k]) ? "paid-candidate" : null;
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

// #5304 blocking fix (25/9): strips click-id fields (and the source_hint
// derived from them) from an attribution record, leaving only the
// utm_*/referrer/landing_path fields the owner already approved for
// off-device use. Pure, so both storage-backed reads and an already-read
// record (e.g. Supabase session.user.user_metadata.attribution) can be
// sanitized the same way. Returns the input unchanged if it isn't an object.
function stripClickIds(record) {
  if (!record || typeof record !== "object") return record;
  const sanitized = { ...record };
  for (const key of CLICK_ID_KEYS) delete sanitized[key];
  delete sanitized.source_hint;
  return sanitized;
}

// #5304 blocking fix (25/9): every caller that sends the attribution record
// off-device (Supabase auth signUp `options.data`, the team-bootstrap PUT
// body — LoginPage.jsx, Layout.jsx, SetupWizardModal.jsx) must use THIS
// instead of getAttribution(). getAttribution() returns the full localStorage
// record, which now includes click-ids (#5304); sending those to
// supabase.auth.signUp() persists them server-side in
// auth.users.raw_user_meta_data, which the owner has not signed off on (see
// the CLICK_ID_KEYS comment above).
export function getAttributionForBackend(storage = window.localStorage) {
  return stripClickIds(getAttribution(storage));
}

// #5304: same sanitizing as getAttributionForBackend(), for the cross-device
// fallback callers already read off `session.user.user_metadata.attribution`
// (Layout.jsx auto-bootstrap, SetupWizardModal.jsx) — that metadata may still
// carry click-ids written before this fix, so the fallback must be sanitized
// too, not just the localStorage read.
export function sanitizeAttributionForBackend(record) {
  return stripClickIds(record);
}
