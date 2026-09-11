// #4565 — genskab Express 4's `req.body`-default efter opgraderingen til Express 5.
//
// body-parser 1 satte `req.body = {}` for enhver request den ikke parsede (se
// `req.body = req.body || {}` i dens jsonParser). body-parser 2 — som Express 5
// bringer med — lader den i stedet være `undefined`.
//
// Backenden har 67 steder der gør `const { ... } = req.body` og et dusin der
// læser `req.body.<felt>` direkte. Uden denne normalisering ville en POST/PUT
// uden `Content-Type: application/json` (eller helt uden body) gå fra et pænt
// 400-valideringssvar til en TypeError → 500 + Sentry-støj. Det er ren
// regression for klienter der sender forkert, ikke en forbedring.
//
// Middlewaren skal mountes EFTER alle body-parsere. På de to rå-webhook-paths
// (alunta, resend) har `req.body` på det tidspunkt allerede en Buffer, så
// normaliseringen rører dem ikke. I det eneste tilfælde hvor den ville — en
// webhook-POST helt uden body — behandler både aluntaWebhook.js og
// resendWebhook.js `undefined` og `{}` ens (`JSON.stringify(req.body ?? {})`),
// så signatur-verifikationen ser præcis de samme bytes som før.
export function normalizeRequestBody(req, _res, next) {
  if (req.body === undefined) req.body = {};
  next();
}
