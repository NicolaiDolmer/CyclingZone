// Scouting-rapport (#1543 Fase 1) — RENE funktioner, ingen DB/Math.random.
//
// Loft-bånd pr. ryttertype beregnes fra ability_caps via visnings-opskriften
// (weights/displayRecipes.ratingForRole — vægtet snit af de evner der tæller for
// rollen, samme enhed som evne-tallene selv) og maskeres som BÅND før de
// forlader serveren (#1162): seeded center-bias + halvbredde efter scout-level.
// Verdict er deterministisk (ingen AI) og bygget af i18n-nøgler så copy lever i
// locales (EN/DA).
//
// #3666: ratingen kom før fra værdimodellens blendede output strukket mod to
// populations-ankre (O_ELITE 67,38 → 99). De ankre er væk — tallet afhænger nu
// kun af rytterens egne evner. Rækkefølgen er UÆNDRET og skal blive det:
// opskriften anvendes på ability_caps FØR bias og halvbredde lægges på, så
// maskeringen fortsat sker i rating-rum. Byttes den om (maskér hver evne, og
// beregn så ratingen), skifter anti-inversions-egenskaben karakter og beviset
// i scoutingInversionHarness holder ikke længere.
import { RIDER_TYPE_KEYS } from "./riderTypes.js";
import { seededUnit } from "./scouting.js";
import { DEFAULT_SCOUT, scoutHalfWidth, scoutQualityFactor } from "./scoutEngine.js";
import { ratingForRole } from "./weights/displayRecipes.js";
import { prognoseAbilityBands } from "./riderPrognosis.js";
import { buildCapsForRider } from "./riderProgression.js";

// Halvbredde i rating-punkter pr. scout-level (index = level; egen rytter
// behandles som maxLevel).
//
// #3666: rekalibreret fra [12, 8, 5, 3]. De gamle tal var fittet mod den
// anker-normaliserede skala, hvor lofterne masede mod 99 og båndene blev
// klippet af clampen. Den nye skala er ~25 % smallere (potentiel rating: p25
// 33, median 44, p75 55), så de SAMME punkt-bredder ville dække MERE af feltet,
// ikke mindre — målt ville dækningen gå fra 34/25/15/10 % til 46/32/22/13 %,
// altså scouting der føles mærkbart mere upræcis end i dag.
//
// [9, 6, 4, 3] reproducerer dagens indsnævring tættest muligt med heltal
// (36/26/17/13 %). Toppen står bevidst på 3 og ikke 2: CEIL_BIAS_FACTOR = 0,5
// forskyder båndets midtpunkt med op til en halv halvbredde, så halvbredde 2
// ville pinne sandheden til ±1 point. Det ville være en forringelse af
// maskeringen indført som sideeffekt af en skalaomlægning (#1543/#1162).
// Fuld udledning: #3666-kommentaren. Ejer-besluttet 13/8.
export const CEIL_HALF_WIDTH_BY_LEVEL = Object.freeze([9, 6, 4, 3]);
// Andel af halvbredden som det seedede center kan ligge skævt — båndets
// midtpunkt er dermed IKKE loft-sandheden (anti-inversion, #1162).
export const CEIL_BIAS_FACTOR = 0.5;

const clampInt = (n, lo, hi) => Math.round(Math.max(lo, Math.min(hi, n)));

// Rating for et sæt evner "som rolle" — vægtet snit af rollens opskrift.
// Spejler frontendens generated/displayRecipes.ratingForRole 1:1 (samme kilde,
// genereret af scripts/generate-ability-registry.mjs).
// Ryttere uden brugbare evner for rollen giver null; kalderen bestemmer visningen.
export function ratingFromAbilities(abilities, typeKey) {
  return ratingForRole(abilities, typeKey);
}

// Bånd-maskerede loft-ratings for alle ryttertyper.
//   nowAbilities : synlige evner nu (rider_derived_abilities-rækkens felter)
//   caps         : ability_caps-objektet (SANDHED — forlader aldrig serveren rå)
//   level        : viewerens scout-niveau (egen rytter = maxLevel)
//   riderId/teamId: seed for per-manager center-bias
//   scout        : viewer-holdets spejder-objekt (#2244) — begrænser hvor meget
//                  af indsnævringen spejderen kan levere pr. niveau (#3671).
//                  Default DEFAULT_SCOUT (overall 40).
// Returnerer [{ key, now, ceilLo, ceilHi }] — heltal, clamp [0,99], ceilLo>=now.
//
// #3666: gulvet er 0, ikke 1. Den gamle skala kunne ikke producere 0 (den
// normaliserede til [1,99]); det kan den nye, og målt findes der 2 ryttere i
// prod hvis rolle-rating er præcis 0. De skal vise 0, ikke skjules som "ingen
// data" — derfor er alle falsy-gates på visnings-siden skiftet til
// Number.isFinite. Ryttere hvor opskriften slet ikke kan beregnes (ingen af
// rollens evner findes på rækken) giver null og udelades af båndet.
export function buildTypeCeilingBands({ nowAbilities, caps, level, riderId, teamId, scout = DEFAULT_SCOUT }) {
  const half = scoutHalfWidth(level, scout, CEIL_HALF_WIDTH_BY_LEVEL);
  return RIDER_TYPE_KEYS.map((key) =>
    ceilingBandForRole({ nowAbilities, caps, key, half, riderId, teamId }));
}

// Ét bånd for ÉN rolle. Udskilt af buildTypeCeilingBands (#2454) fordi tabel- og
// kort-fladerne kun skal bruge rytterens egen rolle, og de SKAL få præcis samme
// tal som Scouting-fanens kort viser for den samme rolle. To kopier af den her
// udregning ville før eller siden give to forskellige loft-bånd for samme rytter
// på samme skærm — den fejlklasse er allerede set i den håndholdte RADAR_ORDER
// og i frontendens gamle RATING_TYPE_WEIGHTS.
//
// `half` tages ind frem for at blive udledt her, så en kalder der beder om flere
// roller kun regner spejderens halvbredde én gang.
export function ceilingBandForRole({ nowAbilities, caps, key, half, riderId, teamId }) {
  const now = ratingFromAbilities(nowAbilities, key);
  const ceilTruth = ratingFromAbilities(caps, key);
  if (now == null || ceilTruth == null) return { key, now: null, ceilLo: null, ceilHi: null };
  const bias = (seededUnit(`scout-ceil:${riderId}:${teamId}:${key}`) * 2 - 1)
    * half * CEIL_BIAS_FACTOR;
  const center = ceilTruth + bias;
  // Loftet kan pr. definition ikke ligge under nuværende niveau — clamp mod now
  // FØR interval-clamp så båndet forbliver konsistent (lo<=hi).
  const ceilLo = clampInt(Math.min(Math.max(center - half, now), 99), 0, 99);
  const ceilHi = clampInt(Math.min(Math.max(center + half, now), 99), 0, 99);
  return { key, now, ceilLo, ceilHi };
}

// Halvbredden alene — så kaldere uden for denne fil ikke skal kende
// CEIL_HALF_WIDTH_BY_LEVEL for at kunne bruge ceilingBandForRole.
export function ceilingHalfWidth(level, scout = DEFAULT_SCOUT) {
  return scoutHalfWidth(level, scout, CEIL_HALF_WIDTH_BY_LEVEL);
}

// ═══ PROGNOSE-BÅND (trin 7, #3746, ejer-beslutning B+C+D 16/8) ═══════════════
//
// Under det flade tag røber loftet intet rytterspecifikt (samme tag for alle i
// rollen), så det scouten sælger er ikke længere loftet — det er FARTEN.
// Scoutens usikkerhed udtrykkes derfor i POTENTIALE-enheder (1-6): et interval
// [potLo, potHi] omkring et seeded-forskudt center, som prognose-motoren
// (riderPrognosis.js) fremskriver til et endpoint-bånd pr. evne, aggregeret til
// rating pr. rolle med samme opskrift som fladen viser.
//
// Anti-inversion (#1162's efterfølger): det viste bånd er en deterministisk
// funktion af (nu-evner, alder, typer, potentiale-INTERVAL). Center-bias med
// samme mønster som loft-båndet (CEIL_BIAS_FACTOR) gør at midtpunktet ikke er
// sandheden, og træningsspændet (spredt→dedikeret) ligger oven i og kan aldrig
// scoutes væk. #3679's inversionsangreb dør her: der er intet skjult loft at
// regne baglæns til — kun potentialet, og det er beskyttet af bias + bredde.
//
// Halvbredder i potentiale-enheder pr. scout-level. Den middelmådige spejder
// (overall < 60) kommer aldrig under 0,75 — samme "evigt loft"-princip som
// rating-båndets 4,5 (spec-beslutning 3), skaleret til 1-6-skalaen.
export const POT_HALF_WIDTH_BY_LEVEL = Object.freeze([1.5, 1.0, 0.6, 0.3]);
export const POT_MEDIOCRE_HALF_CAP = 0.75;
const POT_MEDIOCRE_THRESHOLD = 60;

export function potentialeHalfWidth(level, scout = DEFAULT_SCOUT) {
  const idx = Math.max(0, Math.min(Number(level) || 0, POT_HALF_WIDTH_BY_LEVEL.length - 1));
  const widest = POT_HALF_WIDTH_BY_LEVEL[0];
  const base = POT_HALF_WIDTH_BY_LEVEL[idx];
  const overall = Number(scout?.overall ?? DEFAULT_SCOUT.overall);
  const half = widest - scoutQualityFactor(overall) * (widest - base);
  return Number.isFinite(overall) && overall < POT_MEDIOCRE_THRESHOLD
    ? Math.max(half, Math.min(widest, POT_MEDIOCRE_HALF_CAP))
    : half;
}

// Det potentiale-interval vieweren kan se. Seeded center-bias pr. (rytter,
// hold) så to naboer ikke kan sammenligne sig frem til sandheden, clamp [1,6].
//
// BIAS'EN ER NIVEAU-UAFHÆNGIG MED VILJE (#3679's lektie): skalerede bias'en
// med halvbredden, ville to scout-niveauer give to ligninger med to ubekendte
// (pot, bias-koefficient) — og så kunne en LSQ på tværs af niveauer isolere
// potentialet, præcis det angreb #3679 beviste mod loft-båndet. Med FAST
// absolut bias deler alle niveauer samme ukendte offset: mere scouting køber
// smallere bånd, men centret bærer for altid det samme seeded fejlled på op
// til ±(bredeste halvbredde × CEIL_BIAS_FACTOR) = ±0,75 potentiale.
export function potentialeIntervalFor({ potentiale, level, riderId, teamId, scout = DEFAULT_SCOUT }) {
  const half = potentialeHalfWidth(level, scout);
  const bias = (seededUnit(`scout-pot:${riderId}:${teamId}`) * 2 - 1)
    * POT_HALF_WIDTH_BY_LEVEL[0] * CEIL_BIAS_FACTOR;
  const center = Number(potentiale) + bias;
  return {
    potLo: Math.max(1, Math.min(6, center - half)),
    potHi: Math.max(1, Math.min(6, center + half)),
  };
}

// Prognose-bånd for alle ryttertyper — afløseren for buildTypeCeilingBands på
// fladen. Returnerer [{ key, now, progLo, progHi }] (heltal, clamp [0,99]).
//   nowAbilities/age/primaryType/secondaryType : rytterens ægte tilstand
//   potentiale : rytterens ÆGTE potentiale (forlader aldrig serveren rå)
//   level/riderId/teamId/scout : viewer-kontekst, som loft-båndet bruger i dag
// Rollens loft i rating-punkter — det TAL den gamle visning kredsede om, nu
// bevaret ved siden af prognosen (ejer-krav 18/8, overgangs-designet): spilleren
// skal kunne se at loftet ikke er "forsvundet" bag det nye bånd. Under det
// flade rolle-tag (#3746) er loftet en ren funktion af (rolle, andenrolle,
// alder) — potentiale indgår IKKE (youthAbilityCap ignorerer argumentet), så
// tallet røber intet skjult og må vises råt uden bånd-maskering (#1162 holder).
// `age: null` udelader alders-taperen bevidst ikke — kalderen sender sæson-
// alderen, så en 32-årigs loft ærligt viser taperingen.
export function roleCeilRating({ age, primaryType, secondaryType }) {
  if (!primaryType) return null;
  const caps = buildCapsForRider(null, { age }, primaryType, secondaryType);
  const rating = ratingFromAbilities(caps, primaryType);
  return rating == null ? null : clampInt(rating, 0, 99);
}

export function buildTypePrognosisBands({
  nowAbilities, age, primaryType, secondaryType, potentiale, level, riderId, teamId, scout = DEFAULT_SCOUT,
}) {
  const { potLo, potHi } = potentialeIntervalFor({ potentiale, level, riderId, teamId, scout });
  const bands = prognoseAbilityBands({ nowAbilities, age, primaryType, secondaryType, potLo, potHi });
  const loAb = {}, hiAb = {};
  for (const [ability, b] of Object.entries(bands)) { loAb[ability] = b.lo; hiAb[ability] = b.hi; }
  // Overgangs-designet (ejer 18/8): rollens loft leveres SAMMEN MED prognosen
  // pr. rolle, så fladerne kan vise "hvor kan han nå til" ved siden af "hvor
  // lander han realistisk" — det gamle tal må ikke opleves som slettet. Under
  // det flade tag er loftet rolle+alder-bestemt, intet rytter-hemmeligt (#1162).
  const capsAb = primaryType ? buildCapsForRider(null, { age }, primaryType, secondaryType) : null;
  return RIDER_TYPE_KEYS.map((key) => {
    const now = ratingFromAbilities(nowAbilities, key);
    const lo = ratingFromAbilities(loAb, key);
    const hi = ratingFromAbilities(hiAb, key);
    if (now == null || lo == null || hi == null) return { key, now: null, progLo: null, progHi: null, loft: null };
    const loft = capsAb ? ratingFromAbilities(capsAb, key) : null;
    return {
      key,
      now: clampInt(now, 0, 99),
      progLo: clampInt(Math.min(lo, hi), 0, 99),
      progHi: clampInt(Math.max(lo, hi), 0, 99),
      loft: loft == null ? null : clampInt(loft, 0, 99),
    };
  });
}

// Under denne gevinst forsvinder et ekstra scout-niveau i afrundingen til
// heltal (clampInt nedenfor) og er dermed usynligt for spilleren, uanset hvad
// knappen lover. Bruges til at afgøre hvad der reelt kan købes.
const MIN_USEFUL_GAIN = 0.25;

// #3671 — hvad køber det næste scout-niveau egentlig?
//
// Knappen har hidtil lovet at scouting "snævrer estimatet ind" og taget 1.000
// CZ$ pr. niveau, uden at kunne vide om spillerens chefscout overhovedet kan
// levere en indsnævring. Med det gamle absolutte gulv var svaret for 150 af 203
// menneskehold: nul. Det relative gulv (#3671, scoutEngine.scoutHalfWidth) gør
// at hvert niveau altid køber noget — men "noget" kan stadig være under
// afrundingens opløsning for en middelmådig spejder, fordi det evige loft på
// 4,5 rating-point (spec-beslutning 3) stadig gælder under overall 60.
//
// Returnerer den effektive halvbredde nu, hvad næste niveau ville give, hvad
// det køber, og det højeste niveau der stadig er værd at betale for. Ingen af
// tallene afslører noget om rytterens loft — de beskriver KUN viewerens egen
// spejder, præcis som `scout`-blokken allerede gør (#3334/#2798).
export function scoutPrecisionInfo(level, maxLevel, scout = DEFAULT_SCOUT) {
  const cap = Math.max(0, Math.min(Number(maxLevel) || 0, CEIL_HALF_WIDTH_BY_LEVEL.length - 1));
  const cur = Math.max(0, Math.min(Number(level) || 0, cap));
  const halfAt = (l) => scoutHalfWidth(l, scout, CEIL_HALF_WIDTH_BY_LEVEL);

  let maxUsefulLevel = 0;
  for (let l = 1; l <= cap; l += 1) {
    if (halfAt(l - 1) - halfAt(l) >= MIN_USEFUL_GAIN) maxUsefulLevel = l;
    else break;
  }

  const halfWidth = halfAt(cur);
  const hasNext = cur < cap;
  const nextHalfWidth = hasNext ? halfAt(cur + 1) : null;
  const nextGain = hasNext ? halfWidth - nextHalfWidth : 0;

  return {
    halfWidth: Math.round(halfWidth * 100) / 100,
    nextHalfWidth: hasNext ? Math.round(nextHalfWidth * 100) / 100 : null,
    nextGain: Math.round(nextGain * 100) / 100,
    // Er næste niveau reelt gratis luft? Frontend dæmper knappen på dette flag
    // alene — den skal aldrig selv regne på halvbredder.
    nextLevelIsUseless: hasNext && nextGain < MIN_USEFUL_GAIN,
    maxUsefulLevel,
    // Er grænsen spejderens, og ikke niveauets? Så er svaret at opgradere
    // chefscouten, ikke at købe endnu et niveau.
    limitedByScout: hasNext && nextGain < MIN_USEFUL_GAIN,
  };
}

// Deterministisk verdict i i18n-nøgler (copy lever i locales, EN/DA).
//   age         : rytterens alder (år)
//   own         : er det viewerens egen rytter?
//   level       : scout-niveau; maxLevel: config-max
//   bestNow     : bedste type-rating nu (maks over buildTypeCeilingBands[].now)
//   bestCeilMid : midtpunkt af bedste types loft-bånd
//   valueGap    : forventet værdi minus markedsværdi (>0 = potentielt røverkøb);
//                 0/ukendt → faktoren udelades.
// Gap-tærskler i rating-point. #3666: rekalibreret fra 4/6/12.
//
// Tærsklerne er ABSOLUTTE tal, så en skalaomlægning ændrer hvilken dom en rytter
// får — uden at nogen har rørt verdict-koden. Målt på hele bestanden (n=8.747)
// falder gap-medianen fra 38 til 26 point, og kompressionen er ikke uniform
// (p10 skrumper 42 %, medianen 32 %), så en lineær nedskalering rammer skævt:
// den gav diff 144 mod grid-søgningens 86.
//
// 2/3/8 er fundet ved heltalssøgning der minimerer den samlede afvigelse fra
// dagens FORDELING af domme. Den rammer "behold/byd"-gruppen eksakt (3.534 mod
// 3.534). `solid_contributor` kan ikke lukkes helt (199 mod 242) — det er en
// konsekvens af den ikke-uniforme kompression, ikke af søgningen; ingen
// tærskel-triple i det afsøgte rum kom tættere.
//
// Formålet er bevidst konservativt: dommene skal betyde det SAMME efter
// omlægningen som før. Landing 1 lover at ingen rytters data flytter sig, og en
// dom der pludselig skifter ville modsige det løfte på skærmen.
const GAP_NEAR_CEILING = 2;  // var 4
const GAP_MONITOR = 3;       // var 6
const GAP_HIGH_UPSIDE = 8;   // var 12

export function buildVerdict({ age, own, level, maxLevel, bestNow, bestCeilMid, valueGap = 0 }) {
  const gap = (Number(bestCeilMid) || 0) - (Number(bestNow) || 0);
  const a = Number(age) || 26;
  const headlineKey =
    a >= 31 && gap < GAP_NEAR_CEILING ? "past_peak"
    : gap >= GAP_HIGH_UPSIDE && a <= 23 ? (own ? "keep_and_develop" : "bid_worth_considering")
    : gap >= GAP_MONITOR ? "monitor"
    : "solid_contributor";
  const confidence = own || level >= maxLevel ? "high" : level >= 2 ? "medium" : "low";
  const pool = [];
  if (a <= 23) pool.push("age_upside");
  if (gap >= GAP_HIGH_UPSIDE) pool.push("ceiling_gap");
  if (gap < GAP_NEAR_CEILING) pool.push("near_ceiling");
  if (a >= 31) pool.push("decline_risk");
  if (valueGap > 0) pool.push("value_gap");
  pool.push("type_match", "form_unknown", "watch_races");
  return { headlineKey, confidence, factorKeys: pool.slice(0, 4) };
}
