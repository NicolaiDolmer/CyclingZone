import { test } from "node:test";
import assert from "node:assert/strict";
import i18n from "i18next";
import {
  formatCz,
  getRiderMarketValue,
} from "./marketValues.js";

async function setLanguage(language) {
  if (!i18n.isInitialized) {
    await i18n.init({
      lng: language,
      fallbackLng: "en",
      resources: {},
      initImmediate: false,
    });
    return;
  }

  await i18n.changeLanguage(language);
}

test("formatCz — følger engelsk tusindseparator", async () => {
  await setLanguage("en");

  assert.equal(formatCz(1234567), "1,234,567 CZ$");
});

test("formatCz — følger dansk tusindseparator", async () => {
  await setLanguage("da");

  assert.equal(formatCz(1234567), "1.234.567 CZ$");
});

test("formatCz — ugyldig værdi bevarer fallback", async () => {
  await setLanguage("en");

  assert.equal(formatCz(null), "-");
  assert.equal(formatCz("ikke-et-tal"), "-");
});

// #1101 cutover: DB-kolonnen market_value er sandheden; fallback = base_value + bonus.
test("getRiderMarketValue — market_value vinder", () => {
  assert.equal(
    getRiderMarketValue({ market_value: 900000, base_value: 100, prize_earnings_bonus: 50000 }),
    900000,
  );
});

test("getRiderMarketValue — base_value + bonus som fallback", () => {
  assert.equal(
    getRiderMarketValue({ base_value: 50000, prize_earnings_bonus: 15000 }),
    65000,
  );
});

test("getRiderMarketValue — uci_points indgår aldrig", () => {
  assert.equal(getRiderMarketValue({ uci_points: 500 }), 1000);
});
