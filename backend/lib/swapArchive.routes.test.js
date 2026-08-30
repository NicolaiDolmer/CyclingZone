import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #3492 · Afviste og accepterede BYTTETILBUD kunne ikke arkiveres. Almindelige
// transfertilbud har haft per-side arkivering siden 30/4
// (database/2026-04-30-transfer-offer-archive.sql + "archive"-grenen i PATCH
// /api/transfers/offers/:id) — swap_offers blev glemt, så Forhandlinger-fanen
// voksede monotont med døde rækker.
//
// Samme kilde-scannings-teknik som swapWithdrawNegotiated.routes.test.js: en
// fuld HTTP-mock ville kræve at stubbe hele supabase-kæden i handleren. Det
// denne fil beviser er wiringen — at swap-ruten har den SAMME gate og den
// SAMME per-side kontrakt som transfer-ruten, og at læse-ruten faktisk skiller
// det arkiverede fra det aktive (ellers ville arkivering intet skjule).

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(marker) {
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route-markør "${marker}" findes ikke i api.js`);
  const end = apiSource.indexOf("router.", start + marker.length);
  assert.notEqual(end, -1, `kunne ikke afgrænse handleren for ${marker}`);
  return apiSource.slice(start, end);
}

const swapPatch = () => routeBlock('router.patch("/transfers/swaps/:id"');
const swapGet = () => routeBlock('router.get("/transfers/swaps"');

test("#3492 PATCH /transfers/swaps/:id har en archive-gren", () => {
  assert.match(swapPatch(), /if \(action === "archive"\)/);
});

test("#3492 archive-grenen gater på de samme afsluttede tilstande som transfertilbud", () => {
  const swapGate = swapPatch().match(/\["accepted", "rejected", "withdrawn"\]\.includes\(swap\.status\)/);
  assert.ok(swapGate, "swap-archive skal kun tillade accepted/rejected/withdrawn");

  // Spejlingen er selve pointen: divergerer de to gates, er den ene fane
  // pludselig igen uryddelig. Transfer-grenen er referencen.
  const offerPatch = routeBlock('router.patch("/transfers/offers/:id"');
  assert.match(offerPatch, /\["accepted", "rejected", "withdrawn"\]\.includes\(offer\.status\)/);
});

test("#3492 archive skriver den korrekte side-kolonne (proposing vs receiving)", () => {
  const block = swapPatch();
  const branch = block.slice(block.indexOf('if (action === "archive")'));
  assert.match(
    branch,
    /const archiveField = isProposing \? "proposing_archived_at" : "receiving_archived_at";/,
    "arkivering er PER SIDE — modpartens visning må ikke røres",
  );
  assert.match(branch, /\.update\(\{ \[archiveField\]: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(branch, /\.from\("swap_offers"\)/);
});

test("#3492 archive er tilladt under markeds-pause (oprydning, ikke fremdrift)", () => {
  // MARKET_PAUSE_ALLOWED_ACTIONS indeholder "archive"; swap-ruten spørger
  // samme helper som transfer-ruten, så knappen ikke dør under en pause.
  assert.match(swapPatch(), /isActionBlockedDuringMarketPause\(action\)/);
  const pauseSource = readFileSync(resolve(__dirname, "./marketPause.js"), "utf8");
  assert.match(pauseSource, /MARKET_PAUSE_ALLOWED_ACTIONS = Object\.freeze\(\[\s*"archive",/);
});

test("#3492 GET /transfers/swaps skiller arkiverede fra aktive pr. side", () => {
  const block = swapGet();
  assert.match(block, /proposing_archived_at, receiving_archived_at/, "felterne skal med i select");
  assert.match(block, /\.is\("proposing_archived_at", null\)/);
  assert.match(block, /\.is\("receiving_archived_at", null\)/);
  assert.match(block, /\.not\("proposing_archived_at", "is", null\)/);
  assert.match(block, /\.not\("receiving_archived_at", "is", null\)/);
  assert.match(block, /archivedSent: archivedSentRes\.data \|\| \[\]/);
  assert.match(block, /archivedReceived: archivedReceivedRes\.data \|\| \[\]/);
});

test("#3492 migrationen tilføjer begge kolonner idempotent", () => {
  const migration = readFileSync(
    resolve(__dirname, "../../database/2026-08-30-3492-swap-offer-archive.sql"),
    "utf8",
  );
  assert.match(migration, /ALTER TABLE swap_offers/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS proposing_archived_at TIMESTAMPTZ/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS receiving_archived_at TIMESTAMPTZ/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_swap_offers_proposing_archive/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_swap_offers_receiving_archive/);
});

test("#3492 frontendens arkiv-affordance findes for bytteforslag i BEGGE locales", () => {
  const page = readFileSync(
    resolve(__dirname, "../../frontend/src/pages/TransfersPage.jsx"),
    "utf8",
  );
  assert.match(page, /t\("swapCard\.buttons\.archive"\)/);
  assert.match(page, /\["accepted", "rejected", "withdrawn"\]\.includes\(swap\.status\)/);

  const en = JSON.parse(readFileSync(resolve(__dirname, "../../frontend/public/locales/en/transfers.json"), "utf8"));
  const da = JSON.parse(readFileSync(resolve(__dirname, "../../frontend/public/locales/da/transfers.json"), "utf8"));
  for (const bundle of [en, da]) {
    assert.equal(typeof bundle.swapCard.buttons.archive, "string");
    assert.equal(typeof bundle.toast.swapArchived, "string");
    assert.equal(typeof bundle.sections.archivedReceivedProposals, "string");
    assert.equal(typeof bundle.sections.archivedSentProposals, "string");
  }
});
