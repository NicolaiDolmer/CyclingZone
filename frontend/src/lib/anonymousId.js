// Stable per-device anonymous id (#1797). Microsoft Clarity auto-generates a
// fresh visitor id per session unless we call its Identify API with a stable
// custom-id — which is why the dashboard saw a 1:1 session/user ratio (0
// returning users). For a logged-out visitor we have no account id, so we mint
// one stable random id and persist it in localStorage; a returning guest on the
// same device is then recognised as the same Clarity user instead of a brand
// new one.
//
// This id is a random opaque token — NOT derived from any personal data — so it
// stays within the "anonymous behavioural data" framing of the privacy policy.
// It is only ever read by analytics code that already gates on analytics
// consent, so it is never sent anywhere before consent is granted.
const ANON_ID_KEY = "cz_clarity_aid_v1"; // gitleaks:allow — localStorage key name, not a secret

function randomId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to Math.random fallback
  }
  // Fallback for environments without crypto.randomUUID — collision risk is
  // irrelevant for an analytics device id.
  return `aid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Returns a stable anonymous device id, minting and persisting one on first
// call. `storage` is injectable for unit-testing; defaults to localStorage.
export function getAnonymousId(storage = window.localStorage) {
  try {
    const existing = storage.getItem(ANON_ID_KEY);
    if (existing) return existing;
    const id = randomId();
    storage.setItem(ANON_ID_KEY, id);
    return id;
  } catch {
    // localStorage unavailable (private mode / blocked). Return a per-call id so
    // identify still fires; cross-session stability is simply lost in this case.
    return randomId();
  }
}
