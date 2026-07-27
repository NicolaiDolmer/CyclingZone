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
//
// #169 (code-scanning js/polynomial-redos): de tidligere `\s*` DIREKTE op ad
// capture-gruppen (`:\s*([^<\n]+?)\s*<`) var flertydige — både `\s*` og `[^<\n]`
// matcher mellemrum, så en fejlside med lange mellemrums-runs og manglende `<`
// gav polynomisk backtracking. Fjernet de to omkringliggende `\s*`; capture-gruppen
// er nu afgrænset af FASTE tegn (`:` og `<`) → lineær. Ledende/afsluttende mellemrum
// trimmes stadig i JS (title[2].trim() nedenfor), så resultatet er uændret.
const CF_TITLE_RE = /\|\s*(\d{3})\s*:([^<\n]+?)</;
const CF_CODE_LABEL_RE = /Error code\s+(\d{3})/i;

// Netværks-/socket-fejl der typisk forsvinder ved et retry.
const TRANSIENT_NETWORK_RE =
  /\b(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|EPIPE)\b|fetch failed|socket hang up|network\s?error|terminated/i;

// Postgres statement/lock-timeout (Sentry 24/7, CYCLINGZONE-3D/3E). Backenden går
// gennem PostgREST's `authenticator`-rolle, som har statement_timeout=8s + lock_timeout=8s.
// Når flere løb afvikler samme etape på samme scheduler-tick, kører flere fulde
// standings-recomputes (seq scan over race_results, 458k rækker pr. 25/7) samtidig →
// enkelte kald sprænger de 8 s og Postgres CANCELLER statementet.
//
// Et cancelleret statement er ALTID rullet tilbage (ingen delvis effekt), og begge
// call-sites bag withSupabaseRetry er idempotente (paginerede reads + samme-payload
// PATCHes). Derfor er et retry både sikkert og næsten altid nok: presset er kortvarigt.
// Uden denne klassificering kastede withSupabaseRetry med det samme — og i race-motoren
// afbrød det etapens berigelse (runs/moments/incidents + træthed) PERMANENT.
const TRANSIENT_DB_TIMEOUT_RE = /canceling statement due to (statement|lock) timeout/i;
// 57014 = query_canceled, 55P03 = lock_not_available (Postgres-klasse 57/55).
const TRANSIENT_DB_TIMEOUT_CODES = new Set(["57014", "55P03"]);

// Supabase-gatewayens bare JSON-5xx (Sentry 2/8, CYCLINGZONE-47, #3180). Når
// gatewayen foran PostgREST fejler UDEN at Cloudflare når at rendere en HTML-side,
// er hele svar-body'en `{"message":"Internal server error."}` — ingen Postgres-kode,
// ingen HTML, intet netværks-token. Ingen af de tre eksisterende klasser fangede den,
// så withSupabaseRetry kastede med 0 retries og afbrød hele auto-prize-sweepet.
//
// Matchet er ANKRET på hele beskeden: PostgREST's egne fejl er altid mere specifikke
// ('permission denied for table "riders"', 'column ... does not exist'), så en fuld-
// streng-match kan ikke maskere en ægte DB-fejl som et transient hikke.
const TRANSIENT_GATEWAY_MESSAGE_RE =
  /^(internal server error|bad gateway|service (temporarily )?unavailable|gateway time-?out)\.?$/i;

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

// #3052: de fleste call-sites kaster `new Error(\`min-kontekst: ${err.message}\`)`,
// så HTML-siden ligger EFTER et præfiks i stedet for at udgøre hele beskeden.
// Find hvor dokumentet starter, så præfikset kan bevares og kun HTML-delen
// erstattes. Returnerer -1 hvis der ikke er noget dokument-start-tag.
const HTML_DOC_START_RE = /<!doctype html|<html[\s>]/i;

// Koger en HTML-fejlside ned til én kort linje. Forudsætter at input ER en side.
function summarizeHtmlErrorPage(html) {
  const title = html.match(CF_TITLE_RE);
  if (title) {
    return `Supabase unavailable (${title[1]} ${title[2].trim()})`;
  }
  const codeOnly = html.match(CF_CODE_LABEL_RE);
  if (codeOnly) {
    return `Supabase unavailable (${codeOnly[1]})`;
  }
  return "Supabase unavailable (HTML error page)";
}

// Returnerer en kort, grupperbar besked hvis `message` indeholder en HTML-fejlside;
// ellers returneres input uændret (også for ikke-strenge — defensivt).
//
// Et eventuelt præfiks før dokumentet bevares (#3052), så call-site-konteksten
// ikke går tabt: "stall-watchdog seasons: <!DOCTYPE html>…" bliver til
// "stall-watchdog seasons: Supabase unavailable (522 Connection timed out)".
export function normalizeSupabaseErrorMessage(message) {
  if (typeof message !== "string") return message;
  if (!looksLikeHtmlErrorPage(message)) return message;

  const docStart = message.search(HTML_DOC_START_RE);
  if (docStart <= 0) return summarizeHtmlErrorPage(message);

  // Kun HTML-delen erstattes. Præfikset trimmes for det mellemrum der stod
  // umiddelbart før dokumentet, så resultatet ikke får dobbelt-mellemrum.
  const prefix = message.slice(0, docStart).trimEnd();
  const summary = summarizeHtmlErrorPage(message.slice(docStart));
  return prefix ? `${prefix} ${summary}` : summary;
}

// True hvis fejlen er et transient gateway-/netværks-hikke det er værd at retry'e.
export function isTransientSupabaseError(error) {
  // Postgres-koden tjekkes FØR beskeden: PostgREST sender 57014 med en besked der
  // kan variere med lokalisering/version, så koden er det stabile signal.
  const code = error && typeof error === "object" ? error.code : null;
  if (code != null && TRANSIENT_DB_TIMEOUT_CODES.has(String(code))) return true;

  const message = extractMessage(error);
  if (!message) return false;
  if (TRANSIENT_DB_TIMEOUT_RE.test(message)) return true;
  if (TRANSIENT_GATEWAY_MESSAGE_RE.test(message.trim())) return true;
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
