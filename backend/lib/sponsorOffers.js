// backend/lib/sponsorOffers.js
// Deterministisk sponsor-tilbuds-generering (#1663, udvidet i #2948 "Sponsorvalg 2.0").
// Givet et holds renownTarget (samlet sponsor ved fuld deltagelse) genereres 5
// arketype-tilbud med ægte forskellige indtjeningskilder: garanteret base,
// per-løbsdag-rate og bonusklausuler (signing/etapesejr/podie/sæsonmål).
// Seedet på team+season → stabil på tværs af reloads (ingen reroll ved refresh).
//
// #2913 (ejer-beslutning 25/7): enheden er PR. ETAPE ("1 race day = one stage
// your team starts"). Andelene (guaranteedFraction/raceDayShare/clause-shares)
// er kontraktens sandhed; selve per-etape-raten beregnes først endeligt ved
// AKTIVERING mod divisionens faktiske etapetal (sponsorContractsService).
// perRaceDayRate her er kun en DISPLAY-projektion mod calendarDays-argumentet.

// FULL_CALENDAR_DAYS: fallback-divisor når ingen kalenderdata findes (tests,
// legacy-kald). Prod bruger divisionens etapetal / seasons.race_days_total.
export const FULL_CALENDAR_DAYS = 60;

// ~50 fiktive sponsor-navne, partitioneret efter arketype-affinitet så navnet
// passer til aftalens karakter (bank → tryghed, outdoor → aktivitet, …).
// Kuratér for tone (ingen ægte mærker, ingen AI-slop-klang).
const NAME_POOLS = Object.freeze({
  safe: Object.freeze([
    "Meridian Bank", "Halvorsen Bank", "Provincia Forsikring", "Polaris Insurance",
    "Verema Pharma", "Brandt Pharma", "Sundberg Group", "Aurelia Jewelers",
    "Ravensburg Glass", "Lumen Optics",
  ]),
  loyal: Object.freeze([
    "Falcon Logistics", "Thorne Logistics", "Nordhavn Shipping", "Granvik Maritime",
    "Nilsen Marine", "Dalmar Cement", "Rendal Timber", "Ferro Metals",
    "Borealis Steel", "Hartmann Bau", "Petra Stone", "Stenmark Tools",
  ]),
  racing: Object.freeze([
    "Alta Cycles", "Kestrel Outdoor", "Aiden Outdoor", "Cobalt Mobility",
    "Vanguard Motors", "Northwind Energy", "Mistral Energy", "Eldfell Geothermal",
    "Calluna Botanics",
  ]),
  results: Object.freeze([
    "Vesna Robotics", "Sable Aerospace", "Corvus Aviation", "Saber Security",
    "Halcyon Telecom", "Vossberg Optics", "Cygnus Media", "Bjarke Design",
  ]),
  ambition: Object.freeze([
    "Larkin Brewing", "Brennan Whisky", "Drummond Whisky", "Marisol Wines",
    "Castell Vineyards", "Tagliani Olive", "Marquez Coffee", "Otero Foods",
    "Wexler Foods", "Solveig Dairy", "Kettler & Vos",
  ]),
});

// Samlet pulje (bagudkompatibel eksport — bruges af tests og evt. tooling).
export const SPONSOR_NAME_POOL = Object.freeze(
  Object.values(NAME_POOLS).flat()
);

// Lille deterministisk hash (FNV-1a-agtig) → uint32. Ingen Math.random (banned i harness).
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// De 5 arketyper (#2948, ejer-godkendt mockup 25/7; results+ambition rebalanceret
// #3192 — risiko-præmie-princippet var brudt, se docs/audits/2026-08-03-sponsor-
// archetype-ev-3192.md). Andele er af renownTarget:
//   guaranteedFraction  → garanteret base (udbetales ved sæsonstart, board-modificeret)
//   raceDayShare        → variabel pulje, optjenes pr. etape holdet starter i
//   clauses[].share     → bonusklausul-beløb (frosset i kroner ved pick)
// Potentiale ved fuld deltagelse: safe 1.00 · loyal 1.04 · racing 1.08 ·
// results 0.72 + sejre/podier (loft +0.53, EV ≈0.86 pop.-gns / ≈1.11 for top-
// kvartilen der reelt bør vælge den) · ambition 0.90 + 0.38 ved top-40 % af egen
// division (EV ≈1.06, empirisk P(top-40%) ≈0.42 — se audit-rapporten).
// Lavere garanti køber højere loft (risikopræmie): betinget skal i FORVENTNING
// slå den flade 'safe' (100 %) for den population der rationelt vælger den — det
// var netop dette der var brudt for 'ambition' (EV ≈99 %, ~coin-flip vs. flad).
// Kalibreret i scripts/sponsorChoiceScorecard.js mod ægte population (±10 %-guard
// på total; #3192-rebalancen målt til +1,1 % vs. flad i mix-scenariet, se audit).
export const ARCHETYPES = Object.freeze([
  {
    variant: "safe",
    guaranteedFraction: 0.92,
    raceDayShare: 0.08,
    lengthSeasons: 1,
    clauses: [],
  },
  {
    variant: "loyal",
    guaranteedFraction: 0.78,
    raceDayShare: 0.18,
    lengthSeasons: 3,
    clauses: [{ type: "signing", share: 0.08 }],
  },
  {
    variant: "racing",
    guaranteedFraction: 0.5,
    raceDayShare: 0.58,
    lengthSeasons: 1,
    clauses: [],
  },
  {
    variant: "results",
    guaranteedFraction: 0.6,
    raceDayShare: 0.12,
    lengthSeasons: 2,
    clauses: [
      { type: "stage_win", share: 0.035 },
      { type: "podium", share: 0.014 },
      { type: "results_cap", share: 0.53 },
    ],
  },
  {
    variant: "ambition",
    guaranteedFraction: 0.7,
    raceDayShare: 0.2,
    lengthSeasons: 2,
    clauses: [{ type: "season_objective", objective: "top_40pct", share: 0.38 }],
  },
]);

// Frys en klausul til kroner ud fra target. share-feltet erstattes af amount så
// kontraktrækken (bonus_clauses jsonb) er selvbærende — den må aldrig afhænge af
// et live-driftende renownTarget (samme lektie som #2589).
function freezeClauses(clauses, renownTargetValue) {
  return clauses.map(({ share, ...rest }) => ({
    ...rest,
    amount: Math.round(renownTargetValue * share),
  }));
}

// calendarDays: divisor for DISPLAY-raten (den endelige rate sættes ved aktivering
// mod divisionens etapetal). Defaulter til FULL_CALENDAR_DAYS.
export function generateOffers({ teamId, seasonNumber, renownTargetValue, calendarDays = FULL_CALENDAR_DAYS }) {
  const divisor = Number(calendarDays) > 0 ? Number(calendarDays) : FULL_CALENDAR_DAYS;
  const seed = hashSeed(`${teamId}:${seasonNumber}`);

  return ARCHETYPES.map((a, i) => {
    const pool = NAME_POOLS[a.variant];
    const sponsorName = pool[(seed + i * 7 + (seed % 13)) % pool.length];
    const guaranteedBase = Math.round(renownTargetValue * a.guaranteedFraction);
    const raceDayPool = Math.round(renownTargetValue * a.raceDayShare);
    return {
      variant: a.variant,
      sponsorName,
      guaranteedBase,
      guaranteedFraction: a.guaranteedFraction,
      raceDayShare: a.raceDayShare,
      perRaceDayRate: Math.round(raceDayPool / divisor),
      lengthSeasons: a.lengthSeasons,
      clauses: freezeClauses(a.clauses, renownTargetValue),
    };
  });
}

// Legacy-varianter (før #2948). Rækker skrevet FØR variant/guaranteed_fraction-
// kolonnerne fandtes kan kun identificeres via length_seasons (unikt 1/2/3 i det
// gamle sæt). Bruges udelukkende som fallback i recomputeActivationRate for
// gamle pending/aktive rækker — nye rækker bærer fraction eksplicit.
const LEGACY_VARIANTS = [
  { variant: "predictable", guaranteedFraction: 0.88, lengthSeasons: 1 },
  { variant: "activity", guaranteedFraction: 0.55, lengthSeasons: 2 },
  { variant: "long", guaranteedFraction: 0.73, lengthSeasons: 3 },
];

export function guaranteedFractionForLength(lengthSeasons) {
  const match = LEGACY_VARIANTS.find((v) => v.lengthSeasons === Number(lengthSeasons));
  return match ? match.guaranteedFraction : null;
}
