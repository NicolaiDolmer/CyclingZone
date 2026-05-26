import { test } from "node:test";
import assert from "node:assert/strict";
import i18n from "i18next";
import {
  getCountryDisplay,
  getCountryName,
  getFlagEmoji,
} from "./countryUtils.js";

test("getCountryName — returnerer engelsk landenavn for EN-locale", () => {
  assert.equal(getCountryName("DK", "en-US"), "Denmark");
});

test("getCountryName — returnerer dansk landenavn for DA-locale", () => {
  assert.equal(getCountryName("DK", "da-DK"), "Danmark");
});

test("getCountryName — dækker flere regioner på EN og DA", () => {
  const cases = [
    ["AE", "United Arab Emirates", "De Forenede Arabiske Emirater"],
    ["AL", "Albania", "Albanien"],
    ["AO", "Angola", "Angola"],
    ["AT", "Austria", "Østrig"],
    ["SI", "Slovenia", "Slovenien"],
  ];

  for (const [code, enName, daName] of cases) {
    assert.equal(getCountryName(code, "en-US"), enName);
    assert.equal(getCountryName(code, "da-DK"), daName);
  }
});

test("getCountryName — default følger aktiv i18next-locale", () => {
  const originalLanguage = i18n.language;

  try {
    i18n.language = "en-US";
    assert.equal(getCountryName("SI"), "Slovenia");

    i18n.language = "da-DK";
    assert.equal(getCountryName("SI"), "Slovenien");
  } finally {
    i18n.language = originalLanguage;
  }
});

test("getCountryName — normaliserer whitespace og casing", () => {
  assert.equal(getCountryName(" dk ", "en-US"), "Denmark");
});

test("getCountryName — manglende country code giver tom streng", () => {
  assert.equal(getCountryName(null, "en-US"), "");
  assert.equal(getCountryName("", "da-DK"), "");
});

test("getCountryName — ugyldig region-kode falder tilbage til normaliseret kode", () => {
  assert.equal(getCountryName("xxx", "en-US"), "XXX");
});

test("getFlagEmoji — returnerer flag for gyldig ISO2-kode", () => {
  assert.equal(getFlagEmoji("dk"), "🇩🇰");
});

test("getFlagEmoji — ugyldig kode giver tom streng", () => {
  assert.equal(getFlagEmoji("xxx"), "");
  assert.equal(getFlagEmoji(null), "");
});

test("getCountryDisplay — bygger locale-aware label", () => {
  assert.deepEqual(getCountryDisplay("DK", "en-US"), {
    code: "DK",
    flag: "🇩🇰",
    name: "Denmark",
    label: "🇩🇰 Denmark",
  });

  assert.equal(getCountryDisplay("DK", "da-DK").label, "🇩🇰 Danmark");
});

test("getCountryDisplay — fallback-label for manglende kode er stabil", () => {
  assert.deepEqual(getCountryDisplay(null, "en-US"), {
    code: null,
    flag: "",
    name: "",
    label: "Ukendt land",
  });
});
