// Normalisering + retry for Supabase/PostgREST-fejl.
//
// Problem (Sentry 29/6): når Supabase-gatewayen (Cloudflare foran *.supabase.co)
// er nede, returnerer den en HTML-fejlside i stedet for JSON. supabase-js kan
// ikke JSON-parse body'en og lægger hele HTML-dokumentet i `error.message`.
// Vores call-sites kaster `throw new Error(error.message)` → Sentry får ét issue
// PER call-site med en ulæselig titel ("Error: <!DOCTYPE html> ..."). Én outage
// blev til 7 separate issues.
//
// normalizeSupabaseErrorMessage() koger HTML-siden ned til én kort, stabil linje
// ("Supabase unavailable (522 Connection timed out)") så alle call-sites grupperer
// til ÉT læsbart issue. withSupabaseRetry() lader idempotente reads overleve et
// kort, selv-helende gateway-hikke.

// Cloudflares fejlsider har formen:
//   <title>supabase.co | 522: Connection timed out</title>
//   <span class="code-label">Error code 525</span>
const CF_TITLE_RE = /\|\s*(\d{3})\s*:\s*([^<\n]+?)\s*</;
const CF_CODE_LABEL_RE = /Error code\s+(\d{3})/i;

// Netværks-/socket-fejl der typisk forsvinder ved et retry.
const TRANSIENT_NETWORK_RE =
  /\b(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|EPIPE)\b|fetch failed|socket hang up|network\s?error|terminated/i;

function extractMessage(error) {
  if (error == null) return "";
  if (typeof error === "string") return error;
  return typeof error.message === "string" ? error.message : "";
}

function looksLikeHtmlErrorPage(message) {
  if (typeof message !== "string") return false;
  const head = message.trimStart().slice(0, 200).toLowerCase();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    message.includes("cf-error-details") ||
    message.includes("Cloudflare Ray ID")
  );
}

// Returnerer en kort, grupperbar besked hvis `message` er en HTML-fejlside;
// ellers returneres input uændret (også for ikke-strenge — defensivt).
export function normalizeSupabaseErrorMessage(message) {
  if (typeof message !== "string") return message;
  if (!looksLikeHtmlErrorPage(message)) return message;

  const title = message.match(CF_TITLE_RE);
  if (title) {
    return `Supabase unavailable (${title[1]} ${title[2].trim()})`;
  }
  const codeOnly = message.match(CF_CODE_LABEL_RE);
  if (codeOnly) {
    return `Supabase unavailable (${codeOnly[1]})`;
  }
  return "Supabase unavailable (HTML error page)";
}

// True hvis fejlen er et transient gateway-/netværks-hikke det er værd at retry'e.
export function isTransientSupabaseError(error) {
  const message = extractMessage(error);
  if (!message) return false;
  if (looksLikeHtmlErrorPage(message)) {
    // Cloudflare 5xx (502/504/520-525) = gateway/origin nede → transient.
    const code = (message.match(CF_TITLE_RE) || message.match(CF_CODE_LABEL_RE) || [])[1];
    if (code) return /^5\d\d$/.test(code);
    return true; // HTML-fejlside uden kode → behandl som transient outage
  }
  return TRANSIENT_NETWORK_RE.test(message);
}

function copyDbFields(error, err) {
  if (error && typeof error === "object") {
    if (error.code != null) err.code = error.code;
    if (error.details != null) err.details = error.details;
    if (error.hint != null) err.hint = error.hint;
  }
  return err;
}

// Sikrer et ægte Error-objekt (Supabase returnerer plain { message, code }).
// Bevarer rå besked + code; bruges til ikke-transiente fejl hvor vi ikke vil
// omskrive beskeden men stadig vil garantere en rigtig Error med stacktrace.
function asError(error) {
  if (error instanceof Error) return error;
  return copyDbFields(error, new Error(extractMessage(error) || "Supabase error"));
}

// Pakker et Supabase-fejlobjekt ind i et Error med normaliseret besked. Bevarer
// den oprindelige code/details så debugging stadig kan se PostgREST-koden.
export function toSupabaseError(error) {
  const normalized = normalizeSupabaseErrorMessage(extractMessage(error));
  return copyDbFields(error, new Error(normalized || "Supabase error"));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Kører fn() og retry'er KUN transiente fejl (gateway/netværk). Ikke-transiente
// fejl (permission denied, constraint-violation, ...) kastes med det samme.
// Den endelige fejl kastes med normaliseret besked via toSupabaseError.
export async function withSupabaseRetry(fn, { retries = 2, delayMs = 250, sleepFn = sleep } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientSupabaseError(error)) throw asError(error);
      if (attempt === retries) throw toSupabaseError(error);
      await sleepFn(delayMs * (attempt + 1));
    }
  }
  throw toSupabaseError(lastError);
}
