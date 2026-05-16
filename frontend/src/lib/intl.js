// Intl-wrappers — Refs #410.
//
// Locale-aware formatering via standard `Intl`-API. Bruger i18next's
// `language`-state som single source of truth. Eksempler:
//
//   formatCurrency(1500, 'DKK')  // da: "1.500,00 kr."  · en: "DKK 1,500.00"
//   formatDate(new Date())       // da: "16. maj 2026"  · en: "May 16, 2026"
//   formatNumber(1234.5)         // da: "1.234,5"       · en: "1,234.5"
//
// Lazy import af i18next for at undgå cirkulær reference med language.jsx.

import i18n from "../i18n";

function currentLocale() {
  // i18next bruger ISO 639-1 ("en", "da"). Intl-API kræver BCP 47 — disse
  // er kompatible som-er for vores 2 sprog.
  return i18n.language || "en";
}

export function formatCurrency(amount, currency = "DKK", options = {}) {
  if (amount == null || Number.isNaN(amount)) return "";
  try {
    return new Intl.NumberFormat(currentLocale(), {
      style: "currency",
      currency,
      ...options,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function formatDate(date, style = "medium", options = {}) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(currentLocale(), {
      dateStyle: style,
      ...options,
    }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

export function formatDateTime(date, options = {}) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(currentLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
      ...options,
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

export function formatNumber(n, options = {}) {
  if (n == null || Number.isNaN(n)) return "";
  try {
    return new Intl.NumberFormat(currentLocale(), options).format(n);
  } catch {
    return String(n);
  }
}

export function formatRelativeTime(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const diffSec = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSec);

  const units = [
    { unit: "year", sec: 31536000 },
    { unit: "month", sec: 2592000 },
    { unit: "day", sec: 86400 },
    { unit: "hour", sec: 3600 },
    { unit: "minute", sec: 60 },
    { unit: "second", sec: 1 },
  ];

  try {
    const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" });
    for (const { unit, sec } of units) {
      if (abs >= sec) {
        return rtf.format(Math.round(diffSec / sec), unit);
      }
    }
    return rtf.format(0, "second");
  } catch {
    return d.toLocaleDateString();
  }
}
