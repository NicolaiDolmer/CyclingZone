// Intl-wrappers — Refs #410, #1104.
//
// Locale-aware formatering via standard `Intl`-API. Bruger i18next's
// `language`-state som single source of truth. Eksempler:
//
//   formatCurrency(1500, 'DKK')  // da: "1.500,00 kr."  · en: "DKK 1,500.00"
//   formatCurrency(6.57)         // da: "6,57 kr." (DKK) · en: "€6.57" (EUR)
//   formatDate(new Date())       // da: "16. maj 2026"  · en: "May 16, 2026"
//   formatNumber(1234.5)         // da: "1.234,5"       · en: "1,234.5"
//
// Brug i18next-singleton direkte så pure helper-tests ikke skal loade Vite JSON imports.

import i18n from "i18next";

function currentLocale() {
  // i18next bruger ISO 639-1 ("en", "da"). Intl-API kræver BCP 47 — disse
  // er kompatible som-er for vores 2 sprog.
  return i18n.language || "en";
}

const PLAIN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// #3724: en ren dato-kolonne ("YYYY-MM-DD", intet klokkeslæt — fx sæson-start,
// snapshot_date) skal tolkes som den LOKALE kalenderdag, ikke UTC-midnat.
// `new Date("2026-05-01")` parses per ISO 8601 som UTC-midnat; formateres den
// bagefter i lokal tid, viser en spiller vest for UTC "30. april" i stedet for
// "1. maj". Byg Date'en af lokale år/måned/dag-komponenter i stedet, så den
// altid formaterer til samme kalenderdag i ethvert tidszone-default.
function toLocalDate(date) {
  if (date instanceof Date) return date;
  if (typeof date === "string") {
    const m = PLAIN_DATE_RE.exec(date);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(date);
}

// Locale-styret visningsvaluta (#1104): da → DKK, alle andre sprog → EUR.
// EUR-beløb på EN er en visnings-omregning med FAST kurs — se lib/pricing.js.
export function currencyForLocale(locale = currentLocale()) {
  return String(locale).toLowerCase().startsWith("da") ? "DKK" : "EUR";
}

export function formatCurrency(amount, currency = currencyForLocale(), options = {}) {
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
  const d = toLocalDate(date);
  if (Number.isNaN(d.getTime())) return "";
  // Intl.DateTimeFormat forbyder dateStyle sammen med day/month/year/etc.
  // Pass style=null for at bruge custom-options uden dateStyle.
  const opts = style == null ? { ...options } : { dateStyle: style, ...options };
  try {
    return new Intl.DateTimeFormat(currentLocale(), opts).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

export function formatDateTime(date, options = {}) {
  if (!date) return "";
  const d = toLocalDate(date);
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

// #3915 — tidspunkt ALENE i spillerens lokale tidszone (browserens default —
// IKKE en fast game-tidszone som lib/raceCentre.js's København-visning).
// `date` skal være et absolut tidsstempel (ms/Date/fuld ISO-timestamp),
// ALDRIG en ren dato-streng — #3724s UTC-midnat-fælde gælder kun toLocalDate's
// særtilfælde for "YYYY-MM-DD", som race_stage_schedule.scheduled_at aldrig er.
export function formatLocalTime(date) {
  if (date == null) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(currentLocale(), { hour: "2-digit", minute: "2-digit" }).format(d);
  } catch {
    return d.toLocaleTimeString();
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
  const d = toLocalDate(date);
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
