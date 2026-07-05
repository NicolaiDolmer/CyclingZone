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

// Effekt-visning pr. spor-type: academy måles i intake-SLOTS (base 1–5), de øvrige
// i procent. effectiveBonus er post-utilization (API), så academy kan være fraktio-
// neret når staff < fuld (staff = udnyttelsesgrad) — vis 1 decimal uden efterhængt
// .0. UDEN denne split ville academy vise "+300.0%" i stedet for "+3" (slots ≠ %).
export function formatTrackEffect(track, effectiveBonus) {
  if (track === "academy") {
    const n = Math.round(effectiveBonus * 10) / 10;
    return `+${Number.isInteger(n) ? n : n.toFixed(1)}`;
  }
  return `+${(effectiveBonus * 100).toFixed(1)}%`;
}

// Tier-ladder: 5 pips, fyldt op til (og med) det ejede tier.
export function tierPips(tier, max = 5) {
  return Array.from({ length: max }, (_, i) => i < tier);
}
