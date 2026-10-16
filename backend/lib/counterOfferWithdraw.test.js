// #6463 · Tests for sælgerens tilbagetrækning af et modbud.
// Kør: cd backend && node --test lib/counterOfferWithdraw.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  getCounterWithdrawIssue,
  withdrawCounterOffer,
  claimCounterForAccept,
  buildCounterOfferWithdrawnNotification,
  COUNTER_WITHDRAWN_STATUS,
} from "./counterOfferWithdraw.js";

const SELLER = "team-seller";
const BUYER = "team-buyer";

function makeOffer(overrides = {}) {
  return {
    id: "offer-1",
    seller_team_id: SELLER,
    buyer_team_id: BUYER,
    status: "countered",
    offer_amount: 100,
    counter_amount: 150,
    ...overrides,
  };
}

// Minimal in-memory Supabase-fake: én tabel, betinget UPDATE via .eq()-filtre,
// .select() returnerer de rækker der faktisk blev opdateret (som PostgREST).
function makeFakeSupabase(rows, { failWith = null } = {}) {
  const calls = [];
  return {
    calls,
    rows,
    from(table) {
      const filters = [];
      let patch = null;
      const builder = {
        update(p) { patch = p; return builder; },
        eq(col, val) { filters.push([col, val]); return builder; },
        select() {
          calls.push({ table, patch, filters: [...filters] });
          if (failWith) return Promise.resolve({ data: null, error: { message: failWith } });
          const hit = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
          for (const r of hit) Object.assign(r, patch);
          return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
        },
      };
      return builder;
    },
  };
}

test("getCounterWithdrawIssue: sælgeren må trække et åbent modbud tilbage", () => {
  assert.equal(getCounterWithdrawIssue(makeOffer(), SELLER), null);
});

test("getCounterWithdrawIssue: køberen kan ikke trække sælgerens modbud tilbage", () => {
  const issue = getCounterWithdrawIssue(makeOffer(), BUYER);
  assert.equal(issue.status, 403);
  assert.equal(issue.errorCode, "counter_withdraw_not_seller");
});

test("getCounterWithdrawIssue: manglende tilbud giver 404", () => {
  assert.equal(getCounterWithdrawIssue(null, SELLER).errorCode, "offer_not_found");
});

test("getCounterWithdrawIssue: kun status countered kan trækkes tilbage", () => {
  for (const status of ["pending", "awaiting_confirmation", "accepted", "rejected", "withdrawn", "window_pending"]) {
    const issue = getCounterWithdrawIssue(makeOffer({ status }), SELLER);
    assert.equal(issue?.errorCode, "counter_offer_not_open", `status ${status}`);
    assert.equal(issue.status, 409);
  }
});

test("withdrawCounterOffer: lukker tilbuddet som withdrawn med betinget update", async () => {
  const row = makeOffer();
  const supabase = makeFakeSupabase([row]);
  const now = new Date("2026-10-16T10:00:00Z");
  const result = await withdrawCounterOffer({ supabase, offer: makeOffer(), teamId: SELLER, now });

  assert.deepEqual(result, { ok: true });
  assert.equal(row.status, COUNTER_WITHDRAWN_STATUS);
  assert.equal(row.updated_at, now.toISOString());
  // Ingen penge flyttes: kun transfer_offers røres, og kun status + tidsstempel.
  assert.equal(supabase.calls.length, 1);
  assert.equal(supabase.calls[0].table, "transfer_offers");
  assert.deepEqual(Object.keys(supabase.calls[0].patch).sort(), ["status", "updated_at"]);
  assert.deepEqual(supabase.calls[0].filters, [
    ["id", "offer-1"],
    ["seller_team_id", SELLER],
    ["status", "countered"],
  ]);
  // Beløbene bevares til historikken.
  assert.equal(row.counter_amount, 150);
  assert.equal(row.offer_amount, 100);
});

test("withdrawCounterOffer: race — køberen accepterede først, tilbagetrækning afvises", async () => {
  // Læsningen så "countered", men rækken er i mellemtiden flyttet videre.
  const row = makeOffer({ status: "awaiting_confirmation" });
  const supabase = makeFakeSupabase([row]);
  const result = await withdrawCounterOffer({ supabase, offer: makeOffer(), teamId: SELLER });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.errorCode, "counter_offer_not_open");
  assert.equal(row.status, "awaiting_confirmation");
});

test("withdrawCounterOffer: idempotent — anden tilbagetrækning afvises uden ændring", async () => {
  const row = makeOffer();
  const supabase = makeFakeSupabase([row]);
  assert.equal((await withdrawCounterOffer({ supabase, offer: makeOffer(), teamId: SELLER })).ok, true);
  const second = await withdrawCounterOffer({ supabase, offer: { ...row }, teamId: SELLER });
  assert.equal(second.ok, false);
  assert.equal(second.errorCode, "counter_offer_not_open");
  assert.equal(supabase.calls.length, 1, "anden runde stoppes allerede af valideringen");
});

test("withdrawCounterOffer: afvist validering rører ikke databasen", async () => {
  const supabase = makeFakeSupabase([makeOffer()]);
  const result = await withdrawCounterOffer({ supabase, offer: makeOffer(), teamId: BUYER });
  assert.equal(result.errorCode, "counter_withdraw_not_seller");
  assert.equal(supabase.calls.length, 0);
});

test("withdrawCounterOffer: DB-fejl giver 500 med kode", async () => {
  const supabase = makeFakeSupabase([makeOffer()], { failWith: "boom" });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await withdrawCounterOffer({ supabase, offer: makeOffer(), teamId: SELLER });
    assert.equal(result.status, 500);
    assert.equal(result.errorCode, "counter_withdraw_failed");
  } finally {
    console.error = originalError;
  }
});

test("claimCounterForAccept: accept lykkes mens modbuddet er åbent", async () => {
  const row = makeOffer();
  const supabase = makeFakeSupabase([row]);
  const patch = { status: "awaiting_confirmation", buyer_confirmed: true, seller_confirmed: false };
  const result = await claimCounterForAccept({ supabase, offerId: row.id, patch });
  assert.deepEqual(result, { ok: true });
  assert.equal(row.status, "awaiting_confirmation");
  assert.equal(row.buyer_confirmed, true);
});

test("claimCounterForAccept: accept efter tilbagetrækning afvises (gammel pris kan ikke genoplives)", async () => {
  const row = makeOffer();
  const supabase = makeFakeSupabase([row]);
  await withdrawCounterOffer({ supabase, offer: makeOffer(), teamId: SELLER });

  const result = await claimCounterForAccept({
    supabase,
    offerId: row.id,
    patch: { status: "awaiting_confirmation", buyer_confirmed: true, seller_confirmed: false },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.errorCode, "counter_offer_not_open");
  assert.equal(row.status, "withdrawn");
  assert.equal(row.buyer_confirmed, undefined);
});

test("claimCounterForAccept: DB-fejl giver 500 med kode", async () => {
  const supabase = makeFakeSupabase([makeOffer()], { failWith: "boom" });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await claimCounterForAccept({ supabase, offerId: "offer-1", patch: { status: "awaiting_confirmation" } });
    assert.equal(result.status, 500);
    assert.equal(result.errorCode, "counter_accept_failed");
  } finally {
    console.error = originalError;
  }
});

test("buildCounterOfferWithdrawnNotification: EN-fallback + i18n-koder + riderId", () => {
  const n = buildCounterOfferWithdrawnNotification({ sellerName: "Hold A", riderName: "R. Rider", riderId: "r1" });
  assert.equal(n.type, "transfer_offer_withdrawn");
  assert.match(n.message, /Hold A withdrew their counter offer on R\. Rider/);
  assert.equal(n.metadata.riderId, "r1");
  assert.equal(n.metadata.titleCode, "notif.transfer.counterWithdrawn.title");
  assert.deepEqual(n.metadata.messageParams, { sellerName: "Hold A", riderName: "R. Rider" });
  assert.equal("riderId" in buildCounterOfferWithdrawnNotification({ sellerName: "S", riderName: "R" }).metadata, false);
});

// Key-guard (samme mønster som transferNotifications.coverage.test.js): koderne
// skal findes i BÅDE en + da, ellers lækker EN-fallback eller rå nøgle.
test("i18n: notifikations- og fejlkoder findes i en + da", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const locales = join(here, "..", "..", "frontend", "public", "locales");
  const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  const n = buildCounterOfferWithdrawnNotification({ sellerName: "S", riderName: "R" });
  for (const lang of ["en", "da"]) {
    const bm = JSON.parse(readFileSync(join(locales, lang, "backendMessages.json"), "utf8"));
    assert.equal(typeof get(bm, n.metadata.titleCode), "string", `${lang} ${n.metadata.titleCode}`);
    assert.equal(typeof get(bm, n.metadata.messageCode), "string", `${lang} ${n.metadata.messageCode}`);
    const errors = JSON.parse(readFileSync(join(locales, lang, "errors.json"), "utf8"));
    for (const code of ["counter_offer_not_open", "counter_withdraw_not_seller", "counter_withdraw_failed", "counter_accept_failed"]) {
      assert.equal(typeof errors.api?.[code], "string", `${lang} errors.api.${code}`);
    }
  }
});
