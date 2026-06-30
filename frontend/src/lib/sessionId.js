// Flygtigt session-id til at deduplikere session_started (#2040). Lever i
// sessionStorage med 30-min sliding expiry — ikke cross-session, ikke koblet til
// en bruger. Bruges KUN i den logget-ind, consent-gated event-kontekst.
const KEY = "cz_session_v1"; // gitleaks:allow — sessionStorage key, ikke secret
const WINDOW_MS = 30 * 60 * 1000;

function randomId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `sid-${Math.random().toString(36).slice(2, 14)}`;
}

function parseEntry(raw) {
  if (typeof raw !== "string") return null;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.id === "string" && typeof o.ts === "number") return o;
  } catch { /* ignore */ }
  return null;
}

// `storage` + `now` injiceres i tests; defaults til sessionStorage + Date.now().
export function getSessionId(
  storage = (typeof window !== "undefined" ? window.sessionStorage : null),
  now = Date.now(),
) {
  if (!storage) return randomId();
  try {
    const entry = parseEntry(storage.getItem(KEY));
    if (entry && now - entry.ts < WINDOW_MS) {
      storage.setItem(KEY, JSON.stringify({ id: entry.id, ts: now })); // slide vinduet
      return entry.id;
    }
    const id = randomId();
    storage.setItem(KEY, JSON.stringify({ id, ts: now }));
    return id;
  } catch {
    return randomId();
  }
}

export const __testing__ = { parseEntry, WINDOW_MS };
