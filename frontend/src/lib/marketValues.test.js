import { test } from "node:test";
import assert from "node:assert/strict";
import i18n from "i18next";
import {
  formatCz,
  getRiderBaseValue,
  getRiderMarketValue,
  MIN_RIDER_UCI_POINTS,
  RIDER_VALUE_FACTOR,
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

test("getRiderBaseValue — bruger pris før UCI-point", () => {
  assert.equal(
    getRiderBaseValue({ price: 750000, uci_points: 10 }),
    750000,
  );
});

test("getRiderBaseValue — bruger minimum UCI-point når point mangler", () => {
  assert.equal(
    getRiderBaseValue({}),
    MIN_RIDER_UCI_POINTS * RIDER_VALUE_FACTOR,
  );
});

test("getRiderMarketValue — market_value vinder over beregnet værdi", () => {
  assert.equal(
    getRiderMarketValue({ market_value: 900000, price: 750000, prize_earnings_bonus: 50000 }),
    900000,
  );
});

test("getRiderMarketValue — lægger bonus oven i fallback-værdi", () => {
  assert.equal(
    getRiderMarketValue({ uci_points: 20, prize_earnings_bonus: 15000 }),
    20 * RIDER_VALUE_FACTOR + 15000,
  );
});
