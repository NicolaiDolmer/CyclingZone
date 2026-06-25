// #940 In-app NPS — pure gating-logik (ingen Supabase-import, så den kan unit-testes).
//
// Reglerne (ejer-besluttede defaults):
//   1. Trigger = efter brugerens FØRSTE løb-resultat (samme touchpoint som
//      first_race_result_viewed). hasSeenRaceResult er gaten for "har et resultat".
//   2. Vis MAX én gang pr. 90 dage pr. bruger (throttle via nps_last_prompted_at).
//   3. Vis aldrig hvis brugeren allerede HAR svaret (hasResponded).
//
// shouldPromptNps samler de tre regler i én ren beslutning, så hook'en blot
// fodrer state ind og handler på resultatet.

export const NPS_THROTTLE_DAYS = 90;
export const NPS_THROTTLE_MS = NPS_THROTTLE_DAYS * 24 * 60 * 60 * 1000;

// Parser en ISO-timestamp til ms; returnerer null ved manglende/ugyldig værdi.
export function parseTimestamp(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// Er 90-dages-vinduet udløbet siden sidste prompt? null/aldrig-vist → true.
export function throttleElapsed(lastPromptedAt, now = Date.now()) {
  const last = parseTimestamp(lastPromptedAt);
  if (last === null) return true;
  return now - last >= NPS_THROTTLE_MS;
}

export function shouldPromptNps({
  hasSeenRaceResult,
  hasResponded,
  lastPromptedAt,
  now = Date.now(),
}) {
  if (!hasSeenRaceResult) return false;   // regel 1: kræver et løb-resultat
  if (hasResponded) return false;          // regel 3: allerede svaret
  return throttleElapsed(lastPromptedAt, now); // regel 2: 90-dages-throttle
}

// Validér et NPS-svar før insert. score skal være et heltal 0-10; reason er
// valgfri og trimmes (tom streng → null så vi ikke gemmer whitespace).
export function normalizeNpsSubmission({ score, reason }) {
  const n = Number(score);
  if (!Number.isInteger(n) || n < 0 || n > 10) return null;
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  return { score: n, reason: trimmed.length > 0 ? trimmed : null };
}
