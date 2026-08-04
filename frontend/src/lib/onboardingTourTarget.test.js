import { test } from "node:test";
import assert from "node:assert/strict";
import { findVisibleTarget } from "./onboardingTourTarget.js";

// #3007: AuctionsPage (og andre sider) rendrer to elementer med samme
// data-tour-attribut — en mobil-kort-variant (md:hidden, DOM-rækkefølge
// FØRST) og en desktop-tabel-variant (hidden md:block, DOM-rækkefølge
// SIDST). En almindelig querySelector() rammer altid det første match,
// uanset synlighed, så tour'en på desktop pegede på et skjult (nul-rect)
// element øverst til venstre i stedet for bud-feltet. findVisibleTarget()
// skal vælge det match der faktisk er synligt.

function makeFakeDoc(elements) {
  return {
    querySelectorAll(selector) {
      return elements.filter((el) => el.matches === selector);
    },
  };
}

test("findVisibleTarget springer hidden (offsetParent=null) match over og vælger det synlige", () => {
  const hiddenMobile = { matches: "[data-tour='auctions-bid-input']", offsetParent: null, label: "mobile" };
  const visibleDesktop = { matches: "[data-tour='auctions-bid-input']", offsetParent: {}, label: "desktop" };
  // Mobil-varianten kommer FØRST i DOM-rækkefølgen, som i AuctionsPage.jsx.
  const doc = makeFakeDoc([hiddenMobile, visibleDesktop]);

  const result = findVisibleTarget("[data-tour='auctions-bid-input']", doc);

  assert.equal(result, visibleDesktop);
});

test("findVisibleTarget falder tilbage til første match hvis ingen er synlige", () => {
  const hiddenA = { matches: "[data-tour='x']", offsetParent: null, label: "a" };
  const hiddenB = { matches: "[data-tour='x']", offsetParent: null, label: "b" };
  const doc = makeFakeDoc([hiddenA, hiddenB]);

  const result = findVisibleTarget("[data-tour='x']", doc);

  assert.equal(result, hiddenA);
});

test("findVisibleTarget returnerer null når intet matcher", () => {
  const doc = makeFakeDoc([]);

  const result = findVisibleTarget("[data-tour='does-not-exist']", doc);

  assert.equal(result, null);
});

test("findVisibleTarget vælger det synlige match selv når det er det ENESTE match (single-target sider)", () => {
  const onlyVisible = { matches: "[data-tour='y']", offsetParent: {}, label: "only" };
  const doc = makeFakeDoc([onlyVisible]);

  const result = findVisibleTarget("[data-tour='y']", doc);

  assert.equal(result, onlyVisible);
});
