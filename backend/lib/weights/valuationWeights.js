// valuationWeights — bestemmer MARKEDSVÆRDIEN (#3665, spec §D3). Læses af
// riderValuation.js' `outputScore` → `blendedOutput` → `predictBaseValue`.
//
// Bit-identisk med classifierWeights og capsShapingWeights ved ikrafttræden —
// bevist af `weightTableSplit.test.js`. Bevidst duplikeret literal; se
// ./classifierWeights.js for hvorfor duplikeringen er funktionen.
//
// VIGTIGT om negative vægte: `outputScore` springer alt med w <= 0 over. De
// negative tal i denne tabel er altså i dag rent dekorative for værdimodellen —
// de bæres kun med fordi tabellen skal være bit-identisk med de tre andre ved
// ikrafttræden. #3592's fund om at fire typepar er matematisk uadskillelige på
// et rent anlægs-formet caps-sæt (tt ⊆ gc, puncheur ⊆ climber, rouleur ⊆
// brostensrytter, rouleur ⊆ baroudeur) skyldes præcis den udeladelse.
//
// #3592 er 13/8 skåret ned til caps-formningen alene; værdimodellens andel af
// problemet hører hjemme i #3448/#3353-sporet, ikke i rytter-pakken. Rør ikke
// denne tabel uden at kunne bevise R3 (ingen markedsværdi ændres).

export const VALUATION_WEIGHTS = Object.freeze([
  { key: "sprinter", weights: Object.freeze({ acceleration: 3, sprint: 2, flat: 1, durability: 1, climbing: -2, endurance: -1 }) },
  { key: "tt", weights: Object.freeze({ time_trial: 3, climbing: -2, sprint: -1, punch: -1 }) },
  { key: "climber", weights: Object.freeze({ climbing: 3, tempo: 2, punch: 1, endurance: 1, sprint: -1 }) },
  { key: "puncheur", weights: Object.freeze({ punch: 3, tempo: 2, endurance: 1, time_trial: -1, sprint: -1 }) },
  { key: "brostensrytter", weights: Object.freeze({ cobblestone: 6, flat: 2, endurance: 1, punch: 1, climbing: -1 }) },
  { key: "baroudeur", weights: Object.freeze({ aggression: 3, flat: 1, punch: 1, endurance: 1, descending: 1, recovery: 1, time_trial: -1 }) },
  { key: "rouleur", weights: Object.freeze({ flat: 4, endurance: 1, climbing: -1, sprint: -1 }) },
  { key: "gc", weights: Object.freeze({ climbing: 3, time_trial: 3, recovery: 2, tempo: 2, endurance: 1, durability: 1, sprint: -2 }) },
]);
