// classifierWeights — bestemmer HVILKEN TYPE en rytter er (#3665, spec §D3).
//
// Én af fire vægt-tabeller udskilt fra den ene `RIDER_TYPES[].weights` der før
// blev læst af klassifikatoren, værdimodellen, loft-formningen OG visningen på
// én gang. En vægt-rettelse for at flytte ét vist tal flyttede derfor samtidig
// lofter, markedsværdier og typer. Det er rod-årsagen til at gentagne "små
// rettelser" er blevet til releases med fejl.
//
// TABELLEN ER BEVIDST DUPLIKERET på tværs af de fire filer i denne mappe. Den
// er bit-identisk med capsShapingWeights og valuationWeights ved ikrafttræden
// (`weightTableSplit.test.js` beviser det), men de deler IKKE en literal — så
// en fremtidig ændring ét sted kan ikke smitte af på de andre ved et uheld.
// Det er hele pointen med splittet; duplikeringen er funktionen, ikke gælden.
//
// ═══ FROSSET (ejer-beslutning 13/8, #3664 spørgsmål 5) ═══
// Denne tabel må IKKE ændres i rytter-pakken. Målt mod prod 13/8: alle 8.731
// levende ryttere har et `archetype_draw`, og `primary_type` matcher trækket i
// 100 % af tilfældene — siden #3570 læses typen fra trækket, ikke herfra.
// Tabellen klassificerer altså NUL eksisterende ryttere og er kun fallback for
// ryttere der fødes uden et træk. Efter en uge hvor spillerne så typer flakke
// frem og tilbage er den vigtigste egenskab pakken kan have, at ingen rytters
// type kan bevæge sig. Håndhæves af sha256-hash-pinnen i
// `weightTableSplit.test.js` ("#3665: classifierWeights er FROSSET"). #4479:
// her stod en `classifierWeightsFrozen`-testfil der aldrig har eksisteret
// — vagten er reel, men kommentaren pegede på et navn ingen kunne slå op.
//
// Betydning: positiv = speciale, negativ = modsat (straffes).
// ARRAY-RÆKKEFØLGEN er tie-break-prioritet (markante specialister først, brede
// typer sidst) + dropdown-orden. Den må ikke omarrangeres.
//
// Historik for tallene selv (#3325 caps-rekalibrering 2026-08-04, målt mod
// 8.301 prod-ryttere): se topkommentaren i ../riderTypes.js.

export const CLASSIFIER_WEIGHTS = Object.freeze([
  { key: "sprinter", weights: Object.freeze({ acceleration: 3, sprint: 2, flat: 1, durability: 1, climbing: -2, endurance: -1 }) },
  { key: "tt", weights: Object.freeze({ time_trial: 3, climbing: -2, sprint: -1, punch: -1 }) },
  { key: "climber", weights: Object.freeze({ climbing: 3, tempo: 2, punch: 1, endurance: 1, sprint: -1 }) },
  { key: "puncheur", weights: Object.freeze({ punch: 3, tempo: 2, endurance: 1, time_trial: -1, sprint: -1 }) },
  { key: "brostensrytter", weights: Object.freeze({ cobblestone: 6, flat: 2, endurance: 1, punch: 1, climbing: -1 }) },
  { key: "baroudeur", weights: Object.freeze({ aggression: 3, flat: 1, punch: 1, endurance: 1, descending: 1, recovery: 1, time_trial: -1 }) },
  { key: "rouleur", weights: Object.freeze({ flat: 4, endurance: 1, climbing: -1, sprint: -1 }) },
  { key: "gc", weights: Object.freeze({ climbing: 3, time_trial: 3, recovery: 2, tempo: 2, endurance: 1, durability: 1, sprint: -2 }) },
]);

export const CLASSIFIER_TYPE_KEYS = Object.freeze(CLASSIFIER_WEIGHTS.map((t) => t.key));
