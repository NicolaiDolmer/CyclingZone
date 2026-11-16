import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #8016 (Codex-fund): begge bekraeftelser venter paa spillerens svar med et beloeb,
// han har skrevet paa kortet. Et release-drevet reload maa ikke lukke dem (#5159 B1),
// ligesom den gamle BidConfirmModal sikrede.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("both confirmations hold a dialog reload block while they are open", () => {
  for (const source of [read("./BidConfirmDialog8016.tsx"), read("../AutoAcceptAuctionDialog.tsx")]) {
    assert.match(source, /useReloadBlock\(true, RELOAD_BLOCK_REASONS\.DIALOG\)/);
  }
});

test("the card has exactly one gold button and uses the shared amount field and segment control", () => {
  const card = read("./BuyerCard8016.tsx");
  assert.equal(card.match(/variant="primary"/g)?.length, 1);
  assert.match(card, /<AmountInput/);
  assert.match(card, /<Segmented/);
});
