import test from "node:test";
import assert from "node:assert/strict";
import {
  DM_PREF_KEYS,
  prefKeyFor,
  isDmTypeEnabled,
  sanitizeDmPrefs,
} from "./discordDmPrefs.js";

test("DM_PREF_KEYS lists the six configurable pref keys in group order", () => {
  assert.deepEqual(DM_PREF_KEYS, [
    "auction_outbid",
    "auction_won",
    "watchlist_rider_auction",
    "transfer_offer",
    "transfer_response",
    "board_update",
  ]);
});

test("prefKeyFor maps directly-keyed DM types to themselves", () => {
  assert.equal(prefKeyFor("auction_outbid"), "auction_outbid");
  assert.equal(prefKeyFor("auction_won"), "auction_won");
  assert.equal(prefKeyFor("watchlist_rider_auction"), "watchlist_rider_auction");
  assert.equal(prefKeyFor("transfer_offer"), "transfer_offer");
});

test("prefKeyFor collapses transfer replies onto a shared transfer_response key", () => {
  assert.equal(prefKeyFor("transfer_accepted"), "transfer_response");
  assert.equal(prefKeyFor("transfer_rejected"), "transfer_response");
});

test("prefKeyFor collapses both board types onto board_update", () => {
  assert.equal(prefKeyFor("board_update"), "board_update");
  assert.equal(prefKeyFor("board_critical"), "board_update");
});

test("prefKeyFor returns null for unknown types", () => {
  assert.equal(prefKeyFor("nonexistent_type"), null);
});

test("isDmTypeEnabled defaults to on when the pref is absent", () => {
  assert.equal(isDmTypeEnabled({}, "auction_outbid"), true);
  assert.equal(isDmTypeEnabled(null, "auction_outbid"), true);
  assert.equal(isDmTypeEnabled(undefined, "auction_outbid"), true);
});

test("isDmTypeEnabled is false only when the mapped pref is explicitly false", () => {
  assert.equal(isDmTypeEnabled({ auction_outbid: false }, "auction_outbid"), false);
  assert.equal(isDmTypeEnabled({ auction_outbid: true }, "auction_outbid"), true);
});

test("isDmTypeEnabled honors the shared key for grouped types", () => {
  assert.equal(isDmTypeEnabled({ transfer_response: false }, "transfer_rejected"), false);
  assert.equal(isDmTypeEnabled({ transfer_response: false }, "transfer_accepted"), false);
  assert.equal(isDmTypeEnabled({ board_update: false }, "board_critical"), false);
});

test("isDmTypeEnabled fails open for unknown types (never silently drops a DM)", () => {
  assert.equal(isDmTypeEnabled({}, "some_future_type"), true);
  assert.equal(isDmTypeEnabled({ some_future_type: false }, "some_future_type"), true);
});

test("sanitizeDmPrefs keeps known boolean keys and reports unknown keys", () => {
  const { prefs, unknownKeys } = sanitizeDmPrefs({
    auction_outbid: false,
    board_update: true,
    bogus_key: false,
  });
  assert.deepEqual(prefs, { auction_outbid: false, board_update: true });
  assert.deepEqual(unknownKeys, ["bogus_key"]);
});

test("sanitizeDmPrefs drops non-boolean values (no string/number coercion)", () => {
  const { prefs, unknownKeys } = sanitizeDmPrefs({
    auction_outbid: "false",
    auction_won: 0,
    transfer_offer: true,
  });
  assert.deepEqual(prefs, { transfer_offer: true });
  assert.deepEqual(unknownKeys, []);
});

test("sanitizeDmPrefs tolerates non-object input", () => {
  assert.deepEqual(sanitizeDmPrefs(null), { prefs: {}, unknownKeys: [] });
  assert.deepEqual(sanitizeDmPrefs("nope"), { prefs: {}, unknownKeys: [] });
});
