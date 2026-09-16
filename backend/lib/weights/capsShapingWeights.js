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
// ═══ MISMATCHET ER LUKKET 15/8 (#3682, trin 3 af #3709) ═══
// Historik: de nye visnings-opskrifter (./displayRecipes.js) belønnede
// `positioning` hos fem roller, mens positioning voksede NEUTRALT for alle her
// — ingen rolle formede den op. Målt read-only mod prod 13/8 havde positioning
// det laveste loft i hele spillet (median 22, p90 34, højeste loft hos nogen
// rytter 70), mens fx endurance lå på median 46. Vi belønnede altså en evne
// ingen kunne specialisere sig i.
//
// To ting lukker hullet, og de er bevidst adskilte:
//   1. HER: `positioning` får positiv vægt hos de fire FELTKØRSELS-roller
//      (ejer-beslutning 13/8, #3682) — sprinter, brostensrytter, puncheur,
//      rouleur. Det gør den til en SIGNATUR-evne for dem: at ligge rigtigt de
//      sidste kilometer (sprinter), kampen om position før en brostensektor
//      (brostensrytter), at bringe kaptajnen frem (rouleur), at ligge fremme før
//      en kort stigning (punchér).
//   2. I riderProgression.js: HÅNDVÆRKS-GULVET (spec §2.1, beslutning 3) giver
//      `positioning` + `tactics` et reelt tag for ALLE ryttere, også de fire
//      typer der ikke ejer dem her. De to evner var før låst på neutral-faktoren
//      for hver eneste rytter i spillet.
//
// TIDSKØREREN ER TAGET UD (ejer 13/8): han kører alene mod uret, der er ingen
// at positionere sig imod. Han er ikke ladt tilbage — håndværks-gulvet giver ham
// stadig et positionerings-tag langt over dagens neutrale.
//
// MAGNITUDEN ER LIGEGYLDIG, FORTEGNET ER ALT: både `signatureFactor` og
// `youthRoleFactor` tester kun `w > 0`. Derfor 1, ikke et tal der lader som om
// det er kalibreret.
//
// Denne tabel er dermed IKKE længere bit-identisk med de tre andre — se
// ../weightTableSplit.test.js, hvor `capsShapingWeights` er fjernet fra
// IDENTICAL_AT_SPLIT med netop denne begrundelse. Splittet i #3665 var præcis
// forberedelsen til dette: ændringen rører KUN lofter, ikke en eneste rytters
// type (classifierWeights) eller markedsværdi (valuationWeights).

// ═══ #5268 (15/9): DE TO NYE MENTALE EVNER + LOFT-FIXET FOR TAKTIK/AGGRESSION ═══
//
// KUN POSITIVE VÆGTE FOR `teamwork`/`leadership`. Det er ikke pynt: `abilityRoleClass`
// giver klassen `svaghed` (tag 45) så snart primær- ELLER sekundærtypen har en NEGATIV
// vægt. En rytter hvis to typer begge straffede holdarbejde ville altså blive født med
// et holdarbejds-loft under en evne ingen rolle ejer — den "dobbelte svaghed" spec §3.1
// eksplicit forbyder ("ingen 'dobbelt svaghed'-gulv for dem", retning A i
// TRAINING_RULES §12: lofter skal føles fraværende). Uden en eneste negativ vægt kan
// den tilstand ikke opstå, uanset hvordan typerne kombineres.
//
// Placeringen spejler visnings-opskrifterne (displayRecipes.js):
//   teamwork   → `rouleur` (leadout-manden) + `climber` (bjerg-domestiquen)
//   leadership → `gc` (etapeløbs-kaptajnen) + `sprinter` (sprint-toget kører på hans kald)
// Magnituden er stadig ligegyldig, fortegnet er alt (se ovenfor) — derfor 1.
//
// Loft-TALLENE for de fire mentale evner står i riderProgression.js
// (`MENTAL_ABILITY_TAG_CEILING`), ikke her: denne tabel bestemmer hvilken KLASSE en
// evne har for en type, mens loftet er klassens tag. Ceiling-tabellen er det
// ejer-godkendte tal-punkt; den ligger samlet ét sted frem for spredt over otte roller.
export const CAPS_SHAPING_WEIGHTS = Object.freeze([
  { key: "sprinter", weights: Object.freeze({ acceleration: 3, sprint: 2, flat: 1, durability: 1, positioning: 1, leadership: 1, climbing: -2, endurance: -1 }) },
  { key: "tt", weights: Object.freeze({ time_trial: 3, climbing: -2, sprint: -1, punch: -1 }) },
  { key: "climber", weights: Object.freeze({ climbing: 3, tempo: 2, punch: 1, endurance: 1, teamwork: 1, sprint: -1 }) },
  { key: "puncheur", weights: Object.freeze({ punch: 3, tempo: 2, endurance: 1, positioning: 1, time_trial: -1, sprint: -1 }) },
  { key: "brostensrytter", weights: Object.freeze({ cobblestone: 6, flat: 2, endurance: 1, punch: 1, positioning: 1, climbing: -1 }) },
  { key: "baroudeur", weights: Object.freeze({ aggression: 3, flat: 1, punch: 1, endurance: 1, descending: 1, recovery: 1, time_trial: -1 }) },
  { key: "rouleur", weights: Object.freeze({ flat: 4, endurance: 1, positioning: 1, teamwork: 1, climbing: -1, sprint: -1 }) },
  { key: "gc", weights: Object.freeze({ climbing: 3, time_trial: 3, recovery: 2, tempo: 2, endurance: 1, durability: 1, leadership: 1, sprint: -2 }) },
]);
