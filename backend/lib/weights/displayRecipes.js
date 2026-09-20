// displayRecipes — bestemmer RATING-TALLET SPILLEREN SER (#3665, spec §D3/§3).
//
// ═══ DEFINERET HER, TAGET I BRUG I #3666 ═══
// Ingen visnings-flade læser denne tabel endnu. #3665 er ren refaktorering med
// nul synlige ændringer; opskrifterne står her, så de fire CI-vagter kan være
// skarpe fra dag ét i stedet for at blive skruet på bagefter. #3666 flytter
// forbrugerne over i én samlet PR, så der aldrig findes en mellemtilstand med
// to skalaer på skærmen samtidig.
//
// MODELLEN (ejer-besluttet 13/8):
//   rating(rytter, rolle) = vægtet snit af rollens evner, afrundet, klampet [0,99]
//   potentiel rating      = samme regnestykke på ability_caps
// Ingen normalisering, ingen kurve, ingen populations-ankre. 13 i alle evner
// der tæller → rating 13. Tallet afhænger kun af rytterens egne evner, så der
// findes ikke længere et "hvorfor faldt mit tal da der kom nye ryttere".
//
// Til sammenligning bruger dagens visning `0,5 × rolle-vægte + 0,5 × fladt snit
// af 13 evner`, strukket mod to populations-ankre (O_ELITE = 67,38 → 99). Det
// er derfor halvdelen af dagens tal er rolleblindt, og derfor #3592's "88 % af
// de bedste ryttere har loft 99 i mindst to roller" — de 99'ere var fabrikeret
// af normaliseringen. Målt read-only mod prod 13/8: ikke én evne har et LOFT på
// 95+ hos mere end en håndfuld af 8.731 ryttere. Lofterne var aldrig problemet.
//
// OPSKRIFTERNE (ejer-godkendt 13/8, spec §3 uændret)
// Princip: rollens signatur-evne vejer tungest; opskriften er bred nok til at
// ratingen ikke er ét tal kopieret; hver af de 15 evner tæller mindst ét sted.
//
// Ændringer mod i dag: sprinteren får sprint som tungeste evne (var
// acceleration — eksplicit ejer-godkendt 13/8). Tidskøreren får en bred
// opskrift (var time_trial alene). Rouleuren udvides fra to evner til syv,
// inkl. sprint for leadout-rollen. `positioning` kommer ind i fem roller og
// `tactics` i baroudeurens — de to var før synlige i NUL opskrifter selvom de
// begge påvirker løbene (spec §1.6). Det er præcis det hul R4-vagten lukker.
//
// FIRE VAGTER I `abilityRegistryGuards.test.js` HOLDER TABELLEN ÆRLIG:
//   1. hver registry-evne skal optræde i ≥1 opskrift        (R4)
//   2. hver opskrift-evne skal have en registry-post
//   3. ingen opskrifts evne-sæt må være DELMÆNGDE af en andens
//   4. frontend-kopien skal være genereret, ikke håndholdt   (R5)
//
// Vagt 3 er ny med #3664 spørgsmål 5: #3592 målte at fire typepar er
// uadskillelige, fordi det ene vægt-sæts positive evner er indeholdt i det
// andets (tt ⊆ gc, puncheur ⊆ climber, rouleur ⊆ brostensrytter, rouleur ⊆
// baroudeur). Ingen af de fire relationer overlever opskrifterne herunder —
// det var en sideeffekt af at hver opskrift blev bredere, ikke et designmål, og
// vagten er der for at sideeffekten ikke kan krybe tilbage ubemærket.

// #5321 — TILBAGERULNING af #5268's fire vægte (ejer-go 17/9 kl. 19:35).
//
// #5268 (PR #5280, 15/9) gav `leadership` en vægt hos `sprinter`/`gc` og
// `teamwork` hos `climber`/`rouleur`. Kommentaren her antog at en NULL evne
// blev sprunget over i både tæller og nævner — det gjorde den ikke:
// `Number(null)` er 0 og 0 er finite, så alle 8.731 eksisterende ryttere fik
// et ægte nul med i snittet. Spillerne så ratings falde uden at nogen rytter
// var blevet dårligere (Ryan Cooper 44 → 41, Nathan Maillot 53 → 49), og
// samtidig forskelligt pr. flade, fordi rytterprofilens hero ikke henter de to
// kolonner (undefined → NaN → sprunget over) mens Mit hold og Scouting-fanen
// gør (NULL → 0). NULL-fejlen er rettet i `ratingForRole` nedenfor, men selve
// vægtene ruller ud igen, fordi ejerens regel (c) står over bekvemmeligheden:
// en ny evne tæller først med i ratingen når rytterne reelt HAR den.
//
// De to evner bliver i registret som DATA (kolonner, derivation, træning,
// lofter) — kun display-vægtene er væk. De kommer ind i opskriften igen i
// SAMME deploy som #5268-point-flytningen, efter ejerens beslutning på #5351.
// Indtil da står de i PENDING_DISPLAY_ABILITIES, som vagt 1 kender.
//
// Forward-guard mod at det sker igen: `ratingGolden.5321.json` fryser ratingen
// pr. rolle på et fast fixture-sæt. Ændrer nogen opskriften eller regnestykket,
// bliver testen rød — synlige ratings må aldrig flytte sig ubemærket.
export const DISPLAY_RECIPES = Object.freeze([
  { key: "sprinter", weights: Object.freeze({ sprint: 4, acceleration: 3, positioning: 2, flat: 2, durability: 1 }) },
  { key: "tt", weights: Object.freeze({ time_trial: 5, tempo: 2, endurance: 1, durability: 1, positioning: 1 }) },
  // punch 1 er IKKE i spec §3's udkast — den er tilføjet 13/8 fordi vagt 3 fandt
  // `climber ⊆ gc` på sin allerførste kørsel: bjergrytterens seks evner lå alle
  // inde i GC's syv, så de to roller var uadskillelige på samme måde som #3592's
  // fire par. punch findes ikke i gc-opskriften og bryder derfor delmængden.
  // Valget er tematisk (en klatrer angriber på stigningen) og trækker tættere på
  // i dag, ikke længere væk: den gamle formel havde punch 1 hos climber i forvejen.
  { key: "climber", weights: Object.freeze({ climbing: 5, tempo: 2, endurance: 2, recovery: 1, durability: 1, descending: 1, punch: 1 }) },
  { key: "puncheur", weights: Object.freeze({ punch: 5, tempo: 2, acceleration: 1, climbing: 1, positioning: 1, endurance: 1 }) },
  { key: "brostensrytter", weights: Object.freeze({ cobblestone: 5, flat: 2, durability: 2, positioning: 1, punch: 1, endurance: 1 }) },
  { key: "rouleur", weights: Object.freeze({ flat: 4, endurance: 2, tempo: 2, durability: 1, positioning: 1, recovery: 1, sprint: 1 }) },
  { key: "baroudeur", weights: Object.freeze({ aggression: 4, endurance: 2, descending: 1, recovery: 1, punch: 1, flat: 1, tactics: 1 }) },
  { key: "gc", weights: Object.freeze({ climbing: 3, time_trial: 3, recovery: 2, endurance: 2, tempo: 2, durability: 1, descending: 1 }) },
]);

export const DISPLAY_RECIPE_KEYS = Object.freeze(DISPLAY_RECIPES.map((t) => t.key));

// Registry-evner der BEVIDST står uden for enhver visnings-opskrift, fordi de
// endnu ikke har værdier på alle ryttere (#5321, ejer-go 17/9 kl. 19:35).
//
// Vagt 1 i `abilityRegistryGuards.test.js` kræver normalt at hver registry-evne
// tæller mindst ét sted — en evne spilleren kan træne uden at se effekt er en
// usynlig evne. Denne liste er den ENESTE lovlige undtagelse, og vagten
// sammenligner mod den PRÆCIST: en evne der falder ud af opskrifterne ved et
// uheld fejler stadig bygningen, og en evne der står her uden at være orphan
// fejler også.
//
// REGLEN (hard rule 30, docs/HOWTO_ADD_ABILITY.md trin 4): en ny evne må ikke
// ind i display-opskrifterne før den har værdier på ALLE ryttere. Ellers
// ændrer den synlige ratings for hele bestanden uden at nogen rytter har
// flyttet sig — præcis det der skete 15/9 og som spillerne meldte 16-17/9.
//
// At fjerne en key herfra er det samme som at ændre spillernes synlige ratings
// og kræver et ejer-go i samme PR (#5351 bærer beslutningen for disse to).
export const PENDING_DISPLAY_ABILITIES = Object.freeze(["teamwork", "leadership"]);

/**
 * Én evne-værdi, eller null hvis rækken ikke har et tal for den.
 *
 * #5321: HER lå fejlen. Den gamle form var `Number(v)` + `Number.isFinite`, og
 * `Number(null)` er 0 — et finite tal. En NULL-kolonne (evnen findes, men er
 * ikke beregnet for denne rytter endnu) talte derfor som et ægte nul i BÅDE
 * tæller og nævner og trak ratingen ned, mens en helt manglende nøgle gav
 * `Number(undefined)` = NaN og blev sprunget over. Samme rytter fik dermed
 * forskellig rating på to flader, alt efter hvilke kolonner fladen hentede.
 * `Number("")` er 0 af samme grund, og `Number(true)` er 1.
 *
 * Regel: kun et tal — eller en streng der ER et tal — tæller med. `0` er en
 * ægte værdi og skal tælle; der findes ryttere i prod hvis rolle-rating er
 * præcis 0 (#3666), og de skal vise 0, ikke blive maskeret væk.
 */
export function abilityValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Rating for ét sæt evner som én rolle. Vægtet snit, afrundet, klampet [0,99].
 * Evner der mangler på rækken — eller står NULL — tæller ikke med i hverken
 * tæller eller nævner, så en delvist udfyldt række ikke trækkes kunstigt mod 0.
 * Ukendt rolle eller ingen brugbare evner → null (kalderen bestemmer visningen).
 */
export function ratingForRole(abilities, roleKey) {
  const recipe = DISPLAY_RECIPES.find((r) => r.key === roleKey);
  if (!recipe) return null;
  let sum = 0;
  let wsum = 0;
  for (const [ability, weight] of Object.entries(recipe.weights)) {
    const v = abilityValue(abilities?.[ability]);
    if (v === null) continue;
    sum += v * weight;
    wsum += weight;
  }
  if (wsum <= 0) return null;
  return Math.max(0, Math.min(99, Math.round(sum / wsum)));
}
