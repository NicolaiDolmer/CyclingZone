// Ryttertyper (#49 / #1101-kæden) — eneste sandhedskilde for klassifikationsformlerne.
//
// En ryttertype udledes deterministisk af rytterens EVNE-LOFT (rider_derived_
// abilities.ability_caps — det absolutte 0-99-loft pr. evne), IKKE de nuværende
// evner. Metoden er KONTRAST på z-score (vægte ejer-kalibreret 2026-06-07,
// caps-input + guards rekalibreret 2026-08-04, #3325):
//
//   1. z-score pr. evne mod populationen (baseline, fittet over CAPS — ikke live-
//      evner) — fjerner median-skævhed: nogle evner er høje for alle (flad/
//      acceleration), andre kun for specialister (klatring), så et råt gennemsnit
//      ville favorisere de første. z-score centrerer hver evne.
//   2. KONTRAST pr. type: speciale-evner (positiv vægt) MINUS modsatte evner (negativ
//      vægt). score = snit(positive z) − snit(negative z). Det adskiller overlappende
//      typer skarpt (en ren sprinter trækkes ned af høj klatring).
//   3. GUARDS (ejer-regler) udelukker urealistiske typer for en given rytter.
//
// #3325 (ejer 4/8, "ren B"): typen viser POTENTIALE, ikke dagens form — stabil hele
// karrieren, for ALLE aldre (ingen U23-grænse). "Hvad er han god til I DAG" dækkes af
// stage-fit-ikonet på holdudtagelsen. Klassificering mod LIVE-evner kollapsede 94% af
// U22 + 90% af seniorerne til climber/tt (#3325) — caps-input alene GENSKABTE (endda
// forværrede) kollapset, fordi ability_caps' headroom-fordeling selv er en funktion af
// rytterens PERSISTEREDE type (buildYouthCaps' rolle-faktor, riderProgression.js) — en
// rytter typet climber får climbing/tempo/punch/endurance boostet i sine egne caps,
// hvilket får klassifikatoren til at bekræfte climber igen. Vægtene nedenfor er derfor
// justeret (ikke kun input'et skiftet) for at bryde den selvforstærkende løkke: climber
// og puncheur straffer ikke længere hinandens speciale-evne (delte 3 af 4 positive
// evner FØR), climber/tt's brede negative vægte (som reelt fungerede som en "ikke-
// sprinter"-bonus for 80%+ af populationen) er trimmet, og gc/rouleur/brostensrytter
// er opjusteret. GUARDS er desuden REKALIBRERET til caps-rummets fordeling (samme
// percentil-selektivitet som originalen havde i live-rummet — de to rum har vidt
// forskellig spredning pr. evne, se scripts/simRiderTypesCapsMeasure.js).
//
// Hvorfor ikke råt gennemsnit (v1) eller percentil: råt gennemsnit gav 30% sprinter +
// død gc (median-skævhed); percentil mætter i toppen (alle stjerner ~99 → kan ikke
// skelnes). z-score+kontrast løser begge. Verificeret mod 8.301 prod-ryttere (#3325).
//
// 8 typer (goat, domestique, allrounder OG leadout fjernet). leadout skåret per
// §0.1 Beslutning 6 (design-session 2, 15/6): benchmark viste den næsten-død uden
// leadout-tog-modellering, og den foldes i sprinter/rouleur.
//
// Baseline (mean/std pr. evne) gives som PARAMETER (ren funktion — ingen fs/JSON her).
// Produktion: backfillRiderTypes.js loader riderTypesBaseline.json (fittet af
// fitRiderTypesBaseline.js --caps over rider_derived_abilities.ability_caps) og
// persisterer primary_type/secondary_type på riders. Frontend LÆSER bare kolonnerne
// (ingen formel-dublet).
//
// ADVARSEL til andre callers af computeRiderTypes(): mange scripts i backend/scripts/
// (scorecards/harnesses, ikke produktionsstien) kalder stadig computeRiderTypes() med
// LIVE rider_derived_abilities-kolonner mod denne fil (riderTypesBaseline.json er nu
// CAPS-fittet, ikke live-fittet). Det er en kendt, dokumenteret uoverensstemmelse for
// disse read-only diagnostik-scripts (ikke rettet i #3325 — se PR-beskrivelsen) — de
// skriver intet til DB, så det er en visnings-/tolknings-drift i deres eget output,
// ikke en produktionsbug. KUN backfillCores.js/riderValueRefresh.js (produktions-
// skrivestier) er opdateret til at bruge ability_caps som input.

import { REGISTRY_CLASSIFIER_KEYS } from "./abilityRegistry.js";
import { CLASSIFIER_WEIGHTS } from "./weights/classifierWeights.js";

// De evner type-formlerne + guards kan referere (kolonner i rider_derived_abilities).
// #3665: udledt af evne-registret (`inClassifier`) i stedet for en egen literal —
// positioning og tactics er de to af de 15 der IKKE er klassifikator-input.
export const ABILITY_KEYS = REGISTRY_CLASSIFIER_KEYS;

// Kontrast-vægte: positiv = speciale, negativ = modsat (straffes). Rækkefølgen er
// TIE-BREAK-prioritet (markante specialister først; brede typer sidst) + dropdown-orden.
// cobblestone vægtet højt (brostensrytter) + time_trial højt (gc) per ejer-feedback.
//
// #3325 caps-rekalibrering (2026-08-04, målt mod 8.301 prod-ryttere, se
// scripts/simRiderTypesCapsMeasure.js): climber og puncheur delte FØR 3 af 4
// positive evner (climbing/punch var hinandens krydsled) — en puncheur med middel
// klatring tabte altid til climber. Krydsleddet er fjernet (hverken belønning eller
// straf) i begge. climber/tt's brede negative vægte (acceleration/flat for climber)
// fungerede reelt som en "ikke-sprinter"-bonus for det meste af populationen under
// caps (kun 1-3 af 8 typer vægter disse evner positivt, så de er strukturelt lave
// for alle andre) — trimmet til kun sprint. brostensrytter/rouleur opjusteret
// (cobblestone/flat) for at komme over ejerens ~3%-gulv.
// #3665: selve tabellen bor nu i ./weights/classifierWeights.js — én af fire
// adskilte vægt-tabeller (klassifikation / caps-formning / værdi / visning) der
// før var ÉN tabel med fire læsere. Se den fils header for hvorfor de tre andre
// er bit-identiske kopier og ikke deler literal med denne.
// Tabellen er FROSSET i rytter-pakken (ejer 13/8) — se classifierWeights.js.
export const RIDER_TYPES = CLASSIFIER_WEIGHTS;

export const RIDER_TYPE_KEYS = Object.freeze(RIDER_TYPES.map((t) => t.key));

// Guard-tærskler i ABILITY-enheder (0-99). #3325 (2026-08-04): REKALIBRERET til
// caps-rummets fordeling — de originale tal (PCM-mappede, live-evne-rummet) betyder
// noget helt andet mod ability_caps, som har en anden mean/std pr. evne (fx recovery:
// caps-std 8,6 vs. live-std 13,3). Ny værdi = samme percentil i caps-populationen som
// originalen havde i live-populationen. highSpeciality: 79→88.
//
// #3570 fase 2 (ejer-beslutning 9/8, låst): GC-guarden (gcClimbing/gcTimeTrial/
// gcRecovery + punch<=tt-betingelsen) er SLETTET herfra (se guardedOut nedenfor).
// Guarden var et AND af 3-4 uafhængige høj-percentil-betingelser oven på caps der
// nu FORMES af det trukne anlæg (#3570 fase 2, backfillCores.js) — en ægte gc-caps-
// profil rammer sjældent alle betingelser samtidig, og guarden var derfor selv en
// af de tre porte gc-tragten døde i (målt 9/8: gc 0,0 % uanset guard-dæmpning
// alene). Rouleur-guarden (highSpeciality) er UÆNDRET — den blokerer noget helt
// andet (en rytter med et reelt speciale er ikke hjælperytter) og var ikke en del
// af gc-defekten.
export const GUARDS = Object.freeze({
  highSpeciality: 88,  // ≥ → ikke rouleur (har et reelt speciale, er ikke hjælperytter)
});

// Evner der tæller som "et reelt speciale" for rouleur-guarden (bjerg, kb, bk, brosten, tt, sprint).
const SPECIALITY_ABILITIES = Object.freeze(["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"]);

// Neutral baseline (mean 0, std 1) = ingen z-transformation. Kun fallback; produktion
// SKAL give den fittede baseline (ellers degenererer klassifikationen til råt gennemsnit).
export const NEUTRAL_BASELINE = Object.freeze({
  mean: Object.freeze(Object.fromEntries(ABILITY_KEYS.map((a) => [a, 0]))),
  std: Object.freeze(Object.fromEntries(ABILITY_KEYS.map((a) => [a, 1]))),
});

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// z-score for én evne mod baseline. Manglende/ikke-numerisk → 0 (= mean).
function abilityZ(abilities, ability, baseline) {
  const v = Number(abilities?.[ability]);
  if (!Number.isFinite(v)) return 0;
  const mean = baseline?.mean?.[ability] ?? 0;
  const std = baseline?.std?.[ability] || 1;
  return (v - mean) / std;
}

// Kontrast-score for én type: snit(positive z) − snit(negative z). Skala er z;
// kun den relative rangering mellem typer afgør klassifikationen.
export function scoreRiderType(abilities = {}, weights = {}, baseline = NEUTRAL_BASELINE) {
  let pos = 0, posW = 0, neg = 0, negW = 0;
  for (const [ability, w] of Object.entries(weights)) {
    const z = abilityZ(abilities, ability, baseline);
    if (w > 0) { pos += z * w; posW += w; } else if (w < 0) { neg += z * -w; negW += -w; }
  }
  const posAvg = posW ? pos / posW : 0;
  const negAvg = negW ? neg / negW : 0;
  return posAvg - negAvg;
}

// Hvilke typer er udelukket for denne rytter (ejer-guards). Returnerer et Set af keys.
//
// #3570 fase 2: gc-guarden (bjerg+tt+recovery-AND + punch<=tt) er FJERNET herfra —
// se GUARDS' kommentar ovenfor. gc afgøres nu udelukkende af kontrast-scoren
// (scoreRiderType) mod den caps-profil det trukne anlæg formede.
function guardedOut(abilities) {
  const out = new Set();
  // ≥ tærskel i et reelt speciale → ikke rouleur (hjælperytter): du har et speciale
  if (SPECIALITY_ABILITIES.some((a) => num(abilities[a]) >= GUARDS.highSpeciality)) out.add("rouleur");
  // sprint > brosten → ikke brostensrytter (en ægte spurter er ikke brostensrytter)
  if (num(abilities.sprint) > num(abilities.cobblestone)) out.add("brostensrytter");
  return out;
}

// Beregn primær + sekundær type for en rytter ud fra dens abilities (top-2 efter guards).
// Returnerer { primary: {key, score}, secondary: {key, score} }.
// Deterministisk: ved lige score afgøres rækkefølgen af RIDER_TYPES-ordenen (stabil sort).
export function computeRiderTypes(abilities = {}, baseline = NEUTRAL_BASELINE) {
  const out = guardedOut(abilities);
  let scored = RIDER_TYPES
    .filter((t) => !out.has(t.key))
    .map((t) => ({ key: t.key, score: scoreRiderType(abilities, t.weights, baseline) }));
  // Defensivt: hvis guards skulle fjerne næsten alt, fald tilbage til alle typer.
  if (scored.length < 2) {
    scored = RIDER_TYPES.map((t) => ({ key: t.key, score: scoreRiderType(abilities, t.weights, baseline) }));
  }
  scored.sort((a, b) => b.score - a.score); // stabil: lige scores beholder RIDER_TYPES-orden
  return { primary: scored[0], secondary: scored[1] };
}

// Er `draw` et brugbart, persisteret anlæg? (jsonb fra riders.archetype_draw — kan
// være null, {} eller bære en type-nøgle vi ikke længere kender.)
function drawPrimaryKey(draw) {
  const key = draw && typeof draw === "object" ? draw.primary : null;
  return RIDER_TYPE_KEYS.includes(key) ? key : null;
}

// Rytterens IDENTITET (#3570, ejer-beslutning 10/8: "fast identitet fra fødslen").
//
// Rod-årsagen den lukker: klassifikationen var et LUKKET KREDSLØB. buildCapsForRider
// former ability_caps ud fra den PERSISTEREDE type (dailyTrainingEngine, hvert tick),
// og computeRiderTypes udledte typen igen af netop de caps (riderValueRefresh, hver
// nat via trainingSweep) — typen bekræftede bare sig selv. Målt 9/8 ved at iterere
// løkken til fikspunkt på de 3.382 menneske-ejede ryttere: baroudeur 53,5 % /
// puncheur 0,2 % mod ejer-målene 11 % / 13 % — og fikspunktet var stort set
// uafhængigt af hvilke RIDER_TYPES-vægte der blev shippet (E1+D_TT: 53,1 %; genfit
// af ungdoms-baselinen: 68,0 %). Vægt-tuning flyttede altså startbetingelsen for en
// proces hvis slutpunkt ikke afhang af den. Det forklarer #3450 direkte: spillernes
// klatrere gled tilbage mod fighter i løbet af nogle nætter efter hver rettelse.
//
// Løsningen: når rytteren HAR et anlæg (riders.archetype_draw — trukket ved
// generering, persisteret i academyIntake.js) er DET identiteten. Klassifikatoren
// beholder sine to ægte roller: at forme lofterne (youthRoleFactor deler
// RIDER_TYPES-vægtene) og at give en rytter UDEN anlæg en identitet.
//
// Sekundær-typen: et ikke-hybrid træk har secondary = null, men hver rytter i spillet
// viser i dag en sekundær type. Den UI-kontrakt bevares ved at lade klassifikatoren
// udpege den bedste type ≠ primær. Det er bevidst en svagere forankring end primæren
// (naturalSecondaryFactor 0,82 mod 1,0 i youthRoleFactor) — fikspunkt-målingen i
// PR-beskrivelsen viser at primær-forankringen alene er nok til at bryde driften.
//
// BAGUDKOMPATIBEL: uden et gyldigt draw er dette bit-identisk med computeRiderTypes
// (samme kald, samme retur) — dvs. uændret for alle 8.186 eksisterende ryttere.
// Returnerer samme form som computeRiderTypes: { primary: {key, score}, secondary: {…} }.
export function resolveRiderTypes(archetypeDraw, abilities = {}, baseline = NEUTRAL_BASELINE) {
  const primaryKey = drawPrimaryKey(archetypeDraw);
  if (!primaryKey) return computeRiderTypes(abilities, baseline);

  // Guards springes bevidst over for den TRUKNE primær: anlægget ER sandheden om
  // rytteren, og en guard er en heuristik der skal udelukke urealistiske GÆT.
  const scored = RIDER_TYPES.map((t) => ({ key: t.key, score: scoreRiderType(abilities, t.weights, baseline) }));
  const byKey = new Map(scored.map((s) => [s.key, s]));

  const drawSecondary = archetypeDraw.secondary;
  const secondaryKey = (RIDER_TYPE_KEYS.includes(drawSecondary) && drawSecondary !== primaryKey)
    ? drawSecondary
    : scored.filter((s) => s.key !== primaryKey).sort((a, b) => b.score - a.score)[0].key;

  return { primary: byKey.get(primaryKey), secondary: byKey.get(secondaryKey) };
}
