import test from "node:test";
import assert from "node:assert/strict";
import {
  contractExpiryDismissKey,
  shouldShowContractExpiryNotice,
} from "./contractExpiryNotice.js";

test("contractExpiryDismissKey: keyed on both team-id and season number", () => {
  assert.equal(contractExpiryDismissKey("t1", 3), "cz-dashboard-contract-expiry-dismissed-t1-3");
  assert.equal(contractExpiryDismissKey("t1", 4), "cz-dashboard-contract-expiry-dismissed-t1-4");
  assert.equal(contractExpiryDismissKey("t2", 3), "cz-dashboard-contract-expiry-dismissed-t2-3");
});

test("shouldShowContractExpiryNotice: never dismissed -> show", () => {
  assert.equal(shouldShowContractExpiryNotice(["r1", "r2"], null), true);
});

test("shouldShowContractExpiryNotice: dismissed with the same rider set -> stay hidden", () => {
  assert.equal(shouldShowContractExpiryNotice(["r1", "r2"], ["r1", "r2"]), false);
  // rækkefølge er ligegyldig
  assert.equal(shouldShowContractExpiryNotice(["r2", "r1"], ["r1", "r2"]), false);
});

test("shouldShowContractExpiryNotice: a rider dropped out of the window since dismiss -> stay hidden", () => {
  // r2 forlængede/blev solgt og er ikke længere i udløbsvinduet — ingen ny risiko, ingen grund til at spamme.
  assert.equal(shouldShowContractExpiryNotice(["r1"], ["r1", "r2"]), false);
});

test("shouldShowContractExpiryNotice: a new rider entered the window since dismiss -> show again", () => {
  // #4387 acceptance-krav 2: r3 kom ind i vinduet efter lukning (fx akademi-graduering).
  assert.equal(shouldShowContractExpiryNotice(["r1", "r2", "r3"], ["r1", "r2"]), true);
});

test("shouldShowContractExpiryNotice: id-typer (number vs string) sammenlignes ens", () => {
  assert.equal(shouldShowContractExpiryNotice([1, 2], ["1", "2"]), false);
});

test("shouldShowContractExpiryNotice: empty current list -> nothing to show", () => {
  assert.equal(shouldShowContractExpiryNotice([], ["r1"]), false);
  assert.equal(shouldShowContractExpiryNotice(null, ["r1"]), false);
});
