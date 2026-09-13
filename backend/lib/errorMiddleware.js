// Express' sidste fejl-middleware — Refs #5144.
//
// Før: `app.use((err, _req, res) => res.status(500).json({ error: "Internal
// server error" }))` i server.js svarede 500 på ALT. En klient der sendte
// defekt JSON fik derfor 500 "Internal server error" i stedet for 400: både
// misvisende for brugeren (ligner et nedbrud på serveren) og dyrt i Sentry
// (klient-fejl blev talt som server-fejl). body-parser kaster netop en
// http-errors-fejl med `status: 400` og `type: "entity.parse.failed"` — den
// information lå der allerede, den blev bare smidt væk.
//
// Kontrakten nu:
//   • 400-499 på err.status/err.statusCode → dén status + kort JSON-krop.
//   • Alt andet (ingen status, 3xx, 5xx, ukendt)  → 500 med UÆNDRET krop
//     ({ error: "Internal server error" }), så frontenden ikke skal ændres.
//   • Ingen stack, ingen rå fejlbesked i 500-svaret — kun i serverloggen.
//   • Sentry-capture kun for 5xx: `shouldReportToSentry` gives til Sentrys
//     egen express-error-handler i server.js, så de to bruger PRÆCIS samme
//     status-udledning og ikke kan drifte fra hinanden.
//
// Middlewaren bor i sin egen fil (ikke i server.js) fordi server.js kalder
// app.listen()/startCron() ved import og derfor ikke kan importeres af en
// test — se kommentaren i lib/queryParserSimple.routes.test.js.

import { STATUS_CODES } from "node:http";

/**
 * Udled HTTP-status af en fejl. Samme felt-rækkefølge som Sentrys egen
 * `getStatusCodeFromResponse` (status → statusCode → status_code →
 * output.statusCode), så vores gating matcher Sentrys 1:1.
 *
 * Kun 400-499 respekteres; alt andet bliver 500 — bevidst konservativt, så
 * en fejl der bærer fx `status: 503` stadig svarer 500 som i dag og stadig
 * havner i Sentry.
 *
 * @param {unknown} err
 * @returns {number} 400-499, ellers 500
 */
export function resolveErrorStatus(err) {
  const raw =
    err && typeof err === "object"
      ? err.status ?? err.statusCode ?? err.status_code ?? err.output?.statusCode
      : undefined;
  // Bevidst IKKE Number.parseInt: den læser "404-oops" som 404, så en
  // vrøvle-status ville blive besvaret som klient-fejl OG holdt ude af Sentry.
  // Kun et heltal eller en fuldt numerisk streng accepteres.
  const status =
    typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  return Number.isInteger(status) && status >= 400 && status <= 499 ? status : 500;
}

/**
 * True når fejlen skal i Sentry. Bruges som `shouldHandleError` til Sentrys
 * express-error-handler — klient-fejl (4xx) er ikke driftshændelser.
 */
export function shouldReportToSentry(err) {
  return resolveErrorStatus(err) >= 500;
}

// body-parser/raw-body's `err.type` → kort, stabil tekst. Bevidst faste
// strenge frem for parserens egen besked: "Unexpected token } in JSON at
// position 41" varierer med input, hvilket ville splitte fejlen i uendeligt
// mange varianter hos enhver der grupperer på beskeden.
const BODY_PARSER_MESSAGES = {
  "entity.parse.failed": "Invalid JSON body",
  "entity.verify.failed": "Request body verification failed",
  "entity.too.large": "Payload too large",
  "request.aborted": "Request aborted",
  "request.size.invalid": "Request size did not match Content-Length",
  "parameters.too.many": "Too many parameters",
  "charset.unsupported": "Unsupported charset",
  "encoding.unsupported": "Unsupported content encoding",
};

const MAX_CLIENT_MESSAGE_LENGTH = 200;

/**
 * Kort, brugbar tekst til 4xx-kroppen. Prioritet:
 *   1. Kendt body-parser-type (stabil formulering, se ovenfor).
 *   2. Fejlens egen besked HVIS http-errors har markeret den `expose: true`
 *      (dvs. bevidst klient-vendt, fx `createError(403, "Not your team")`).
 *      Første linje, trimmet, maks 200 tegn — aldrig en stack.
 *   3. Standard-HTTP-teksten ("Bad Request", "Forbidden", ...).
 */
export function clientErrorMessage(err, status) {
  const byType = err && typeof err === "object" ? BODY_PARSER_MESSAGES[err.type] : undefined;
  if (byType) return byType;

  if (err && typeof err === "object" && err.expose === true && typeof err.message === "string") {
    const firstLine = err.message.split("\n")[0].trim();
    if (firstLine) return firstLine.slice(0, MAX_CLIENT_MESSAGE_LENGTH);
  }

  return STATUS_CODES[status] || "Client error";
}

/**
 * Byg 4xx-kroppen. `errorCode`/`errorParams` sendes med når fejlen bærer dem,
 * så frontendens `resolveApiError` (frontend/src/lib/apiError.js) kan slå den
 * lokaliserede tekst op i stedet for at vise den engelske fallback.
 */
export function clientErrorBody(err, status) {
  const body = { error: clientErrorMessage(err, status) };
  if (err && typeof err === "object") {
    if (typeof err.errorCode === "string" && err.errorCode) body.errorCode = err.errorCode;
    if (err.errorParams && typeof err.errorParams === "object") body.errorParams = err.errorParams;
  }
  return body;
}

/**
 * Express' terminale fejl-middleware. Skal monteres SIDST i server.js.
 */
export function errorMiddleware(err, _req, res, next) {
  // Er svaret allerede påbegyndt (fx en stream der fejlede midtvejs), kan vi
  // ikke sætte status/krop. Express' indbyggede handler lukker forbindelsen
  // korrekt — det er netop hvad `next(err)` gør her.
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = resolveErrorStatus(err);

  if (status >= 500) {
    console.error("[express] unhandled error:", err?.message || err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  // 4xx er klient-fejl, ikke driftshændelser — log kort som warn så de kan
  // ses i Railway-loggen uden at ligne nedbrud.
  console.warn(`[express] client error ${status}:`, err?.message || err);
  res.status(status).json(clientErrorBody(err, status));
}
