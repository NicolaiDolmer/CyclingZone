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

// De evner type-formlerne + guards kan referere (kolonner i rider_derived_abilities).
export const ABILITY_KEYS = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration",
  "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "aggression",
]);

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
export const RIDER_TYPES = Object.freeze([
  { key: "sprinter",       weights: { acceleration: 3, sprint: 2, flat: 1, durability: 1, climbing: -2, endurance: -1 } },
  { key: "tt",             weights: { time_trial: 3, climbing: -2, sprint: -1, punch: -1 } }, // prolog merged ind i time_trial (§0.1 Besl. 2). climbing:-2 (#1122): en ren tidskører er IKKE bjergrytter — uden den vandt tt-scoren for komplette gc-ryttere (høj tt OG climbing) → gc deriverede kun ~21 mod ejer-gulv ≥30. BEVARET uændret i #3325 (netop den konkurrence gc-gaten isolerer).
  { key: "climber",        weights: { climbing: 3, tempo: 2, punch: 1, endurance: 1, sprint: -1 } }, // #3325: acceleration/flat-straf fjernet (var en generisk "ikke-sprinter"-bonus under caps); sprint -2→-1.
  { key: "puncheur",       weights: { punch: 3, tempo: 2, endurance: 1, time_trial: -1, sprint: -1 } }, // #3325: climbing:1-krydsled mod climber fjernet.
  { key: "brostensrytter", weights: { cobblestone: 6, flat: 2, endurance: 1, punch: 1, climbing: -1 } }, // #3325: cobblestone 5→6, climbing-straf -2→-1 (målt: løftede 0,7%→2,2%).
  { key: "baroudeur",      weights: { aggression: 3, flat: 1, punch: 1, endurance: 1, descending: 1, recovery: 1, time_trial: -1 } },
  { key: "rouleur",        weights: { flat: 4, endurance: 1, climbing: -1, sprint: -1 } }, // #3325: flat 2→4 (målt: løftede 1,5%→2,1%; flat er den stærkeste rouleur-diskriminator under caps, endurance er for bredt delt til at skelne).
  { key: "gc",             weights: { climbing: 3, time_trial: 3, recovery: 2, tempo: 2, endurance: 1, durability: 1, sprint: -2 } },
]);

export const RIDER_TYPE_KEYS = Object.freeze(RIDER_TYPES.map((t) => t.key));

// Guard-tærskler i ABILITY-enheder (0-99). #3325 (2026-08-04): REKALIBRERET til
// caps-rummets fordeling — de originale tal (PCM-mappede, live-evne-rummet) betyder
// noget helt andet mod ability_caps, som har en anden mean/std pr. evne (fx recovery:
// caps-std 8,6 vs. live-std 13,3). Ny værdi = samme percentil i caps-populationen som
// originalen havde i live-populationen, derefter yderligere løsnet for gc (gc-AND-
// gaten var matematisk næsten-tom: 3-4 uafhængige ~97-99-percentil-betingelser
// SAMTIDIG ≈ produktet af sandsynlighederne ≈ 0, uanset skalering — se PR-beskrivelsen
// for målingerne). highSpeciality: 79→88. gcClimbing: 57→53 (rekalibreret ~84,
// yderligere løsnet). gcTimeTrial: 43→53 (rekalibreret ~70, yderligere løsnet).
// gcRecovery: 43→27 (rekalibreret ~45, yderligere løsnet).
export const GUARDS = Object.freeze({
  highSpeciality: 88,  // ≥ → ikke rouleur (har et reelt speciale, er ikke hjælperytter)
  gcClimbing: 53,
  gcTimeTrial: 53,
  gcRecovery: 27,
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
function guardedOut(abilities) {
  const out = new Set();
  // ≥ tærskel i et reelt speciale → ikke rouleur (hjælperytter): du har et speciale
  if (SPECIALITY_ABILITIES.some((a) => num(abilities[a]) >= GUARDS.highSpeciality)) out.add("rouleur");
  // sprint > brosten → ikke brostensrytter (en ægte spurter er ikke brostensrytter)
  if (num(abilities.sprint) > num(abilities.cobblestone)) out.add("brostensrytter");
  // gc kun for ægte etapeløbsryttere: bjerg + tt + recovery alle høje samtidig,
  // OG stærkere på enkeltstart end på korte stigninger (punch ≤ tt). Den sidste
  // betingelse skiller punch-tunge puncheurs/baroudeurs ud, der ellers sniger sig
  // gennem score-snittet som "gc" trods en eksplosiv (ikke etape-) profil (#1122).
  const isGc = num(abilities.climbing) >= GUARDS.gcClimbing
    && num(abilities.time_trial) >= GUARDS.gcTimeTrial
    && num(abilities.recovery) >= GUARDS.gcRecovery
    && num(abilities.punch) <= num(abilities.time_trial);
  if (!isGc) out.add("gc");
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
