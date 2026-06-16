// Ryttertyper (#49 / #1101-kæden) — eneste sandhedskilde for klassifikationsformlerne.
//
// En ryttertype udledes deterministisk af de game-abilities (rider_derived_abilities,
// abilityDerivation.js). Metoden er KONTRAST på z-score (ejer-kalibreret 2026-06-07):
//
//   1. z-score pr. evne mod populationen (baseline) — fjerner median-skævhed: nogle
//      evner er høje for alle (flad/acceleration), andre kun for specialister (klatring),
//      så et råt gennemsnit ville favorisere de første. z-score centrerer hver evne.
//   2. KONTRAST pr. type: speciale-evner (positiv vægt) MINUS modsatte evner (negativ
//      vægt). score = snit(positive z) − snit(negative z). Det adskiller overlappende
//      typer skarpt (en ren sprinter trækkes ned af høj klatring).
//   3. GUARDS (ejer-regler) udelukker urealistiske typer for en given rytter.
//
// Hvorfor ikke råt gennemsnit (v1) eller percentil: råt gennemsnit gav 30% sprinter +
// død gc (median-skævhed); percentil mætter i toppen (alle stjerner ~99 → kan ikke
// skelnes). z-score+kontrast løser begge. Verificeret mod 8.989 prod-ryttere.
//
// 8 typer (goat, domestique, allrounder OG leadout fjernet). leadout skåret per
// §0.1 Beslutning 6 (design-session 2, 15/6): benchmark viste den næsten-død uden
// leadout-tog-modellering, og den foldes i sprinter/rouleur.
//
// Baseline (mean/std pr. evne) gives som PARAMETER (ren funktion — ingen fs/JSON her).
// Produktion: backfillRiderTypes.js loader riderTypesBaseline.json (fittet af
// fitRiderTypesBaseline.js over rider_derived_abilities) og persisterer primary_type/
// secondary_type på riders. Frontend LÆSER bare kolonnerne (ingen formel-dublet).

// De evner type-formlerne + guards kan referere (kolonner i rider_derived_abilities).
export const ABILITY_KEYS = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration",
  "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "aggression",
]);

// Kontrast-vægte: positiv = speciale, negativ = modsat (straffes). Rækkefølgen er
// TIE-BREAK-prioritet (markante specialister først; brede typer sidst) + dropdown-orden.
// cobblestone vægtet højt (brostensrytter) + time_trial højt (gc) per ejer-feedback.
export const RIDER_TYPES = Object.freeze([
  { key: "sprinter",       weights: { acceleration: 3, sprint: 2, flat: 1, durability: 1, climbing: -2, endurance: -1 } },
  { key: "tt",             weights: { time_trial: 3, climbing: -2, sprint: -1, punch: -1 } }, // prolog merged ind i time_trial (§0.1 Besl. 2). climbing:-2 (#1122): en ren tidskører er IKKE bjergrytter — uden den vandt tt-scoren for komplette gc-ryttere (høj tt OG climbing) → gc deriverede kun ~21 mod ejer-gulv ≥30
  { key: "climber",        weights: { climbing: 3, tempo: 2, punch: 1, endurance: 1, sprint: -2, acceleration: -1, flat: -1 } },
  { key: "puncheur",       weights: { punch: 3, tempo: 2, climbing: 1, endurance: 1, time_trial: -1, sprint: -1 } },
  { key: "brostensrytter", weights: { cobblestone: 5, flat: 2, endurance: 1, punch: 1, climbing: -2 } },
  { key: "baroudeur",      weights: { aggression: 3, flat: 1, punch: 1, endurance: 1, descending: 1, recovery: 1, time_trial: -1 } },
  { key: "rouleur",        weights: { flat: 2, endurance: 1, climbing: -1, sprint: -1 } },
  { key: "gc",             weights: { climbing: 3, time_trial: 3, recovery: 2, tempo: 2, endurance: 1, durability: 1, sprint: -2 } },
]);

export const RIDER_TYPE_KEYS = Object.freeze(RIDER_TYPES.map((t) => t.key));

// Guard-tærskler i ABILITY-enheder (0-99), mappet fra ejer's PCM-tærskler via samme
// lineære skala som abilityDerivation (PCM 50-85 → 1-99): PCM 78→79, 70→57, 65→43.
export const GUARDS = Object.freeze({
  highSpeciality: 79,  // PCM 78: ≥ → ikke rouleur (har et reelt speciale, er ikke hjælperytter)
  gcClimbing: 57,      // PCM 70
  gcTimeTrial: 43,     // PCM 65
  gcRecovery: 43,      // PCM 65
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
