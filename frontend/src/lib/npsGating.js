// #940 In-app NPS — pure gating-logik (ingen Supabase-import, så den kan unit-testes).
//
// Reglerne (ejer-besluttede defaults, opdateret i #4997):
//   1. Trigger = holdet har mindst NPS_MIN_RACE_DAYS afsluttede løbsdage.
//      Den gamle regel var "har set sit FØRSTE løbsresultat" (#940). Den var for
//      tidlig: én placering er for lidt at give en anbefalings-score på, og den
//      bandt prompten til ét enkelt touchpoint (Resultater-fanen på egen holdside),
//      som kun 40 af 262 brugere nogensinde nåede — se #4997.
//   2. Vis MAX én gang pr. 90 dage pr. bruger (throttle via nps_last_prompted_at).
//   3. Vis aldrig hvis brugeren allerede HAR svaret (hasResponded).
//
// shouldPromptNps samler de tre regler i én ren beslutning, så hook'en blot
// fodrer state ind og handler på resultatet.

export const NPS_THROTTLE_DAYS = 90;
export const NPS_THROTTLE_MS = NPS_THROTTLE_DAYS * 24 * 60 * 60 * 1000;

// Antal afsluttede løbsdage et hold skal have bag sig før vi spørger. 3 er
// ejer-valgt (#4997): nok til at spilleren har set motoren køre mere end én
// gang, lavt nok til at prompten når nye managere mens de stadig er aktive.
export const NPS_MIN_RACE_DAYS = 3;

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

// Har holdet nok afsluttede løbsdage bag sig? Ukendt/ugyldigt tal → false, så
// et fejlet opslag aldrig kan åbne prompten for en helt frisk manager.
export function hasEnoughRaceDays(completedRaceDays) {
  const n = Number(completedRaceDays);
  if (!Number.isFinite(n)) return false;
  return n >= NPS_MIN_RACE_DAYS;
}

export function shouldPromptNps({
  completedRaceDays,
  hasResponded,
  lastPromptedAt,
  now = Date.now(),
}) {
  if (!hasEnoughRaceDays(completedRaceDays)) return false; // regel 1
  if (hasResponded) return false;                          // regel 3
  return throttleElapsed(lastPromptedAt, now);             // regel 2
}

// Validér et NPS-svar før insert. score skal være et heltal 0-10; reason er
// valgfri og trimmes (tom streng → null så vi ikke gemmer whitespace).
export function normalizeNpsSubmission({ score, reason }) {
  const n = Number(score);
  if (!Number.isInteger(n) || n < 0 || n > 10) return null;
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  return { score: n, reason: trimmed.length > 0 ? trimmed : null };
}
