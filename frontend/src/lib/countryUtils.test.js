import { test } from "node:test";
import assert from "node:assert/strict";
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
