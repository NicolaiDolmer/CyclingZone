// backend/lib/sponsorOffers.js
// Deterministisk sponsor-tilbuds-generering (#1663). Givet et holds renownTarget
// (samlet sponsor ved fuld kalender) splittes den i 3 varianter: garanteret base +
// per-løbsdag-rate + længde. Seedet på team+season → stabil på tværs af reloads
// (spilleren kan ikke "reroll'e" ved refresh). Split-faktorer er justérbare og
// kalibreres i harness (Phase J).

// FULL_CALENDAR_DAYS: forventede løbsdage pr. sæson (sæson 1 = ProSeries). Læses i
// produktion fra seasons.race_days_total (default 60); her som kalibrerings-konstant.
export const FULL_CALENDAR_DAYS = 60;

// ~50 fiktive sponsor-navne. Kuratér for tone (ingen ægte mærker, ingen AI-slop-klang).
export const SPONSOR_NAME_POOL = Object.freeze([
  "Meridian Bank", "Alta Cycles", "Provincia Forsikring", "Northwind Energy",
  "Sundberg Group", "Kettler & Vos", "Halcyon Telecom", "Verema Pharma",
  "Borealis Steel", "Falcon Logistics", "Marisol Wines", "Cobalt Mobility",
  "Hartmann Bau", "Lumen Optics", "Sable Aerospace", "Granvik Maritime",
  "Otero Foods", "Brennan Whisky", "Vesna Robotics", "Kestrel Outdoor",
  "Dalmar Cement", "Polaris Insurance", "Rendal Timber", "Solveig Dairy",
  "Tagliani Olive", "Vanguard Motors", "Eldfell Geothermal", "Marquez Coffee",
  "Nordhavn Shipping", "Cygnus Media", "Brandt Pharma", "Aurelia Jewelers",
  "Stenmark Tools", "Larkin Brewing", "Castell Vineyards", "Ferro Metals",
  "Aiden Outdoor", "Vossberg Optics", "Calluna Botanics", "Drummond Whisky",
  "Saber Security", "Wexler Foods", "Nilsen Marine", "Petra Stone",
  "Halvorsen Bank", "Corvus Aviation", "Mistral Energy", "Bjarke Design",
  "Ravensburg Glass", "Thorne Logistics",
]);

// Lille deterministisk hash (FNV-1a-agtig) → uint32. Ingen Math.random (banned i harness).
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Split-varianter: guaranteedFraction = andel af target lagt i garanteret base; resten
// dækkes af per-dag × calendarDays (den reelle sæson-kalender; default FULL_CALENDAR_DAYS),
// så total ≈ target ved fuld kalender.
const VARIANTS = [
  { variant: "predictable", guaranteedFraction: 0.88, lengthSeasons: 1 },
  { variant: "activity",    guaranteedFraction: 0.55, lengthSeasons: 2 },
  { variant: "long",        guaranteedFraction: 0.73, lengthSeasons: 3 },
];

// calendarDays: den reelle sæson-kalenderlængde (seasons.race_days_total). Bruges som
// divisor så per-dag-raten skalerer med den faktiske sæson. Defaulter til
// FULL_CALENDAR_DAYS (60) — eksisterende callsites uden argumentet bevarer adfærden.
export function generateOffers({ teamId, seasonNumber, renownTargetValue, calendarDays = FULL_CALENDAR_DAYS }) {
  const divisor = Number(calendarDays) > 0 ? Number(calendarDays) : FULL_CALENDAR_DAYS;
  const seed = hashSeed(`${teamId}:${seasonNumber}`);
  // Vælg 3 forskellige navne deterministisk.
  const names = [];
  let cursor = seed % SPONSOR_NAME_POOL.length;
  while (names.length < 3) {
    const name = SPONSOR_NAME_POOL[cursor % SPONSOR_NAME_POOL.length];
    if (!names.includes(name)) names.push(name);
    cursor += 1 + (seed % 7);
  }

  return VARIANTS.map((v, i) => {
    const guaranteedBase = Math.round(renownTargetValue * v.guaranteedFraction);
    const perRaceDayRate = Math.round((renownTargetValue - guaranteedBase) / divisor);
    return {
      variant: v.variant,
      sponsorName: names[i],
      guaranteedBase,
      perRaceDayRate,
      lengthSeasons: v.lengthSeasons,
    };
  });
}

// #2589: reverse-lookup for aktiverings-genberegning (sponsorContractsService.
// expireAndRenewContracts). length_seasons er unikt pr. variant (1/2/3) og gemmes
// direkte på sponsor_contracts-raden, så guaranteedFraction kan slås op UDEN at
// gætte/matche mod et frisk regenereret tilbud — det matchede tidligere (PR #2606)
// mod guaranteed_base, hvilket driftede når renownTargetValue (season_standings)
// ændrede sig mellem pick og aktivering (~36% mismatch, verificeret i prod 17/7).
// length_seasons ændres aldrig efter pick, så dette opslag er altid stabilt.
export function guaranteedFractionForLength(lengthSeasons) {
  const match = VARIANTS.find((v) => v.lengthSeasons === Number(lengthSeasons));
  return match ? match.guaranteedFraction : null;
}
