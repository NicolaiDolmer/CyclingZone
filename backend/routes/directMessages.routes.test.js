// #3200 · Kontrakt-test af DM-ruterne. api.js kræver en live Supabase-klient
// og kan ikke instantieres i test, så ruterne verificeres ved kildetekst-scan
// — samme mønster som feedback.routes.test.js.
//
// Det disse tests beskytter er de tre steder hvor en fremtidig ændring ville
// være farlig i stilhed: afsender-id fra klienten, en manglende rate-limit,
// og at `delivered` slipper ud i svaret og dermed afslører en blokering.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "./api.js"), "utf8");

function routeBlock(signature, length = 2500) {
  const idx = apiSource.indexOf(signature);
  assert.ok(idx !== -1, `${signature} skal findes i api.js`);
  return apiSource.slice(idx, idx + length);
}

const READ_ROUTES = [
  'router.get("/messages/conversations"',
  'router.get("/messages/unread-count"',
  'router.get("/messages/conversations/:id"',
  'router.get("/messages/with/:teamId"',
];

const WRITE_ROUTES = [
  'router.post("/messages/send"',
  'router.post("/messages/conversations/:id/read"',
  'router.post("/messages/conversations/:id/hide"',
  'router.post("/messages/conversations/:id/report"',
  'router.post("/messages/block"',
];

test("alle DM-ruter kræver auth", () => {
  for (const signature of [...READ_ROUTES, ...WRITE_ROUTES]) {
    assert.match(routeBlock(signature, 200), /requireAuth/, `${signature} skal kræve auth`);
  }
});

// #530: ogsaa laeseruterne. De POLLES (aaben traad hvert 20. sekund), saa de er
// praecis den klasse en loebsk fane kan hamre.
test("alle DM-ruter er rate-limitede, ogsaa laesningerne", () => {
  for (const signature of READ_ROUTES) {
    assert.match(
      routeBlock(signature, 200),
      /presencePulseLimiter/,
      `${signature} skal have en rate-limiter`,
    );
  }
});

test("alle DM-skriveruter er rate-limitede", () => {
  for (const signature of WRITE_ROUTES) {
    assert.match(
      routeBlock(signature, 200),
      /dmSendLimiter|dmActionLimiter/,
      `${signature} skal have en rate-limiter`,
    );
  }
});

test("send bruger dmSendLimiter, ikke den løsere handlings-limiter", () => {
  assert.match(routeBlock('router.post("/messages/send"', 200), /dmSendLimiter/);
});

test("afsenderen udledes ALDRIG af req.body", () => {
  const block = routeBlock('router.post("/messages/send"', 3000);
  assert.match(block, /senderUserId:\s*req\.user\.id/);
  assert.doesNotMatch(block, /senderUserId:\s*(sender|req\.body)/);
});

test("send lækker ikke `delivered` — det ville afsløre en blokering", () => {
  const start = apiSource.indexOf('router.post("/messages/send"');
  const block = apiSource.slice(start, apiSource.indexOf('router.post("/messages/conversations/:id/read"', start));
  // Svaret bygges eksplicit af de to felter klienten skal have — aldrig som
  // et bart `res.json(body)`, der ville sende `delivered` med ud.
  assert.match(block, /res\.status\(200\)\.json\(\{\s*conversationId: body\.conversationId, message: body\.message\s*\}\)/);
  assert.doesNotMatch(block, /res\.status\(200\)\.json\(body\)/);
});

test("modtager- og samtale-id valideres som UUID før de rammer databasen", () => {
  const block = routeBlock('router.post("/messages/send"', 3000);
  assert.match(block, /UUID_RE\.test\(recipientTeamId\)/);
  assert.match(block, /UUID_RE\.test\(conversationId\)/);
});

test("blokér-ruten slår modparten op via holdet og afviser ikke-managere", () => {
  const block = routeBlock('router.post("/messages/block"', 2000);
  assert.match(block, /resolveManagerUserId/);
  assert.match(block, /dm_recipient_not_found/);
});

test("DM-ruterne delegerer til directMessages.js og bygger ikke queries inline", () => {
  const block = apiSource.slice(
    apiSource.indexOf("BESKEDER MELLEM MANAGERS (#3200)"),
    apiSource.indexOf("// ACHIEVEMENTS"),
  );
  assert.ok(block.length > 1000, "DM-blokken skal findes i api.js");
  assert.doesNotMatch(block, /supabase\s*\n?\s*\.from\("dm_/, "ingen inline dm_-queries i api.js");
});

test("blokér-ruten udleder modparten paa serveren naar traaden noegler paa samtalen", () => {
  const block = routeBlock('router.post("/messages/block"');
  // Klienten maa ALDRIG kunne udpege hvem der blokeres via et bart bruger-id;
  // begge veje gaar gennem en server-side opslag med medlemskabs-tjek.
  assert.match(block, /resolveCounterpartUserId\(\{ supabase, userId: req\.user\.id, conversationId \}\)/);
  assert.match(block, /resolveManagerUserId\(\{ supabase, teamId \}\)/);
  assert.doesNotMatch(block, /targetUserId\s*=\s*req\.body/);
  // Og mindst een af de to noegler skal vaere en gyldig UUID.
  assert.match(block, /UUID_RE\.test\(conversationId\)/);
  assert.match(block, /dm_invalid_block_target/);
});
