import i18n from "i18next";
import { ISO2_TO_IOC } from "./countryCodes.js";

function normalizeCountryCode(code) {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

// 2-bogstavs ISO (fx "fr") → IOC 3-bogstavskode (fx "FRA") til kompakt nation-kolonne.
// Falder tilbage til 2-bogstav uppercase hvis koden ikke er i ISO2_TO_IOC-tabellen.
export function getCountryCode3(code) {
  const normalized = normalizeCountryCode(code);
  if (!/^[A-Z]{2}$/.test(normalized)) return "";
  return ISO2_TO_IOC[normalized.toLowerCase()] || normalized;
}

// Sortér nationer på den VISTE IOC-kode (fx DEN/GER/SUI), ikke rå ISO2 (#802).
// ISO2-orden ville fx give CH(SUI) < DE(GER) < DK(DEN) — visuelt forkert når
// kolonnen viser IOC-koder. Tom/ugyldig kode sorterer sidst i ascending.
export function compareNationality(aCode, bCode) {
  const a = getCountryCode3(aCode);
  const b = getCountryCode3(bCode);
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function currentLocale(locale) {
  return locale || i18n.language || "da-DK";
}

export function getFlagEmoji(code) {
  const normalizedCode = normalizeCountryCode(code);
  if (!/^[A-Z]{2}$/.test(normalizedCode)) return "";

  return [...normalizedCode]
    .map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)))
    .join("");
}

export function getCountryName(code, locale) {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode) return "";

  try {
    return new Intl.DisplayNames([currentLocale(locale), "en"], { type: "region" }).of(normalizedCode) || normalizedCode;
  } catch {
    return normalizedCode;
  }
}

export function getCountryDisplay(code, locale) {
  const normalizedCode = normalizeCountryCode(code);
  const flag = getFlagEmoji(normalizedCode);
  const name = getCountryName(normalizedCode, locale);

  return {
    code: normalizedCode || null,
    flag,
    name,
    label: [flag, name].filter(Boolean).join(" ").trim() || normalizedCode || "Ukendt land",
  };
}
