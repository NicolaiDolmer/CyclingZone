// Rene display-helpers for Klub-fladen (#1441 A3). Ingen React, ingen I/O — så
// logikken er unit-testet og siden forbliver tynd. Labels er i18n-NØGLER (ikke
// tekst): copy'en bor i public/locales/{en,da}/klub.json (EN først, DA under).

export const TRACK_ORDER = ["training", "scouting", "medical", "academy", "commercial"];

export function trackDisplayKey(track) { return `tracks.${track}.name`; }
export function roleDisplayKey(track) { return `roles.${track}`; }

// Tid-som-valuta: sæsoner med 1 decimal; null (max tier) videreføres som null.
export function formatSeasons(seasons) {
  return seasons == null ? null : (Math.round(seasons * 10) / 10).toFixed(1);
}

// Ærlig live-vs-target-mærkning af effekt-kolonnen (Q3).
export function effectStatusKey(effectLive) { return effectLive ? "effect.live" : "effect.target"; }

// Tier-ladder: 5 pips, fyldt op til (og med) det ejede tier.
export function tierPips(tier, max = 5) {
  return Array.from({ length: max }, (_, i) => i < tier);
}
