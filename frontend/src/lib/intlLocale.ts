// Intl-locale-valg samlet ét sted (Refs #6785). Ingen imports med vilje, så små
// moduler (bundle-budget #6372) kan bruge det uden at hente i18next.
//
// Hidtil valgte hver formatter selv med `lang === "da" ? "da-DK" : "en-GB"`.
// Det sender fr/es/nl til engelsk formatering. Her mapper vi i stedet sproget
// til Intl-locale, og alle andre sprog bruges som de er (fr, es, nl, ...).
//
// scripts/i18n-check-hardcoded-formats.mjs tillader locale-literaler i denne
// fil og i intl.js, men ingen andre steder.

const ISO_BASE_RE = /[-_]/;

// da giver da-DK. en giver `en` (default en-GB, den danske spillers
// "27 Aug"-stil; givet videre som { en: "en-US" } hvor siden altid brugte det).
// Alle andre sprog sendes uaendret videre til Intl.
export function intlLocale(
  language: string | null | undefined,
  { en = "en-GB" }: { en?: string } = {},
): string {
  const raw = String(language || "");
  const base = raw.toLowerCase().split(ISO_BASE_RE)[0];
  if (base === "da") return "da-DK";
  if (base === "en" || base === "") return en;
  return raw;
}

// Fast 24-timers "HH:MM" i en given tidszone, ens i ALLE sprog. Spillets slots
// og traenings-ticks vises som klokkeslaet i Koebenhavn-tid, og det maa ikke
// skifte skriftbillede med sproget (da giver ellers "14.05"). en-GB er den
// locale der giver "14:05" uden AM/PM; det er derfor den staar her og ikke i
// kalderne.
export function formatClock24(
  date: Date | number | string | null | undefined,
  timeZone?: string,
): string {
  if (date == null) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(d);
}
