// capsShapingWeights — bestemmer HVORDAN LOFTER FORMES og hvor hurtigt hver
// evne vokser (#3665, spec §D3). Læses af riderProgression.js'
// `signatureFactor` (positiv vægt = signatur-evne, vokser fuldt; negativ =
// svaghed, vokser ikke) og indirekte af `youthRoleFactor`.
//
// Bit-identisk med classifierWeights og valuationWeights ved ikrafttræden —
// bevist af `weightTableSplit.test.js`. Tabellen er BEVIDST duplikeret og deler
// ikke literal med de andre tre: en ændring her må kunne ske uden at røre en
// eneste rytters type eller markedsværdi. Se ./classifierWeights.js for hvorfor
// duplikeringen er funktionen.
//
// ═══ KENDT MISMATCH, ejer-accepteret 13/8 (#3664 spørgsmål 4) ═══
// De nye visnings-opskrifter (./displayRecipes.js) belønner `positioning` hos
// fem roller, men positioning vokser NEUTRALT for alle her — ingen rolle former
// den op. Målt read-only mod prod 13/8: positioning har det laveste loft i hele
// spillet (median 22, p90 34, højeste loft hos nogen rytter 70), mens fx
// endurance ligger på median 46. Vi belønner altså en evne ingen kan
// specialisere sig i; det koster ~3-4 point på sprinter-opskriften.
//
// Rettelsen er IKKE udskudt på ubestemt tid — den er sit eget trin efter #3592.
// Den ligger ikke i #3666, fordi #3666's eneste sikkerhedsgaranti er at INTET
// flytter sig (R2/R3). En caps-formnings-ændring flytter lofter på eksisterende
// ryttere og kræver en prod-mutation, hvilket spec §5 gør til et stopsignal der
// skal forbi ejeren. De to kan derfor ikke dele PR uden at miste beviset.

export const CAPS_SHAPING_WEIGHTS = Object.freeze([
  { key: "sprinter", weights: Object.freeze({ acceleration: 3, sprint: 2, flat: 1, durability: 1, climbing: -2, endurance: -1 }) },
  { key: "tt", weights: Object.freeze({ time_trial: 3, climbing: -2, sprint: -1, punch: -1 }) },
  { key: "climber", weights: Object.freeze({ climbing: 3, tempo: 2, punch: 1, endurance: 1, sprint: -1 }) },
  { key: "puncheur", weights: Object.freeze({ punch: 3, tempo: 2, endurance: 1, time_trial: -1, sprint: -1 }) },
  { key: "brostensrytter", weights: Object.freeze({ cobblestone: 6, flat: 2, endurance: 1, punch: 1, climbing: -1 }) },
  { key: "baroudeur", weights: Object.freeze({ aggression: 3, flat: 1, punch: 1, endurance: 1, descending: 1, recovery: 1, time_trial: -1 }) },
  { key: "rouleur", weights: Object.freeze({ flat: 4, endurance: 1, climbing: -1, sprint: -1 }) },
  { key: "gc", weights: Object.freeze({ climbing: 3, time_trial: 3, recovery: 2, tempo: 2, endurance: 1, durability: 1, sprint: -2 }) },
]);
