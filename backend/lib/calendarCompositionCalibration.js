// backend/lib/calendarCompositionCalibration.js
// #3295 fase B: gør ARCHETYPE_PROFILES' filler-vægte SØGBARE, så kalibreringen mod
// K-B kan måles empirisk i stedet for gættes ("simulér-før-ship").
//
// HVORFOR EN TILT OG IKKE FRIE VÆGTE: ARCHETYPE_PROFILES har 8 stage-arketyper × op til
// 6 filler-terræner = ~40 frie parametre. En søgning i det rum ville (a) tage evigheder,
// (b) overfitte til ét katalog, og (c) udviske arketypernes KARAKTER — pointen med at
// have en mountain_tour og en sprinters_week er netop at de føles forskellige. En tilt
// er én multiplikator PR. KOMPOSITIONS-KATEGORI, anvendt på alle stage-arketypers filler
// og derefter re-normaliseret. Den flytter kalenderens globale balance mens de RELATIVE
// forhold inden for hver arketype (og dermed dens karakter) bevares.
//
// HVAD DEN IKKE RØRER:
//   · Endagsløbs-arketyper (kind:"single"). Deres terræn er FAST pr. design — "et
//     endagsløbs karakter ændrer sig ikke år til år" (raceStageProfileGenerator.js).
//     Paris-Roubaix skal være brosten hvert år. Endagsløbenes bidrag til kompositionen
//     styres derfor af KATALOGET (hvor mange løb har hvilken arketype), ikke af vægte.
//   · guarantees. En garanti er arketypens definition — fjerner man high_mountain fra
//     summit_tour er det ikke længere en summit_tour. Strukturelle garanti-ændringer er
//     et bevidst designvalg der tages separat og eksplicit, ikke noget en søgning må
//     snuble over.
//   · Ordnings-arketyperne (#3326). Tilt'en ændrer HVILKE etaper der er i et løb, ikke
//     rækkefølgen.
//
// Ren funktion — ingen DB/RNG/mutation af input.

import { ARCHETYPE_PROFILES } from "./raceStageProfileGenerator.js";
import { compositionCategory } from "./calendarCompositionTargets.js";

// Neutral tilt = 1.0 hele vejen rundt → output er DYBT lig ARCHETYPE_PROFILES.
export const NEUTRAL_TILT = Object.freeze({ flat: 1, hilly: 1, mountain: 1, itt: 1, cobbles: 1, ttt: 1 });

// Vægte er heltal i produktions-tabellen (weightedPick summerer dem), og det holder vi
// fast i: en tabel med 26.4 og 13.7 er ulæselig og umulig at ræsonnere om i review.
// MIN_WEIGHT sikrer at en tilt aldrig kan NULSTILLE et terræn helt — det ville fjerne
// terrænet fra arketypen (en strukturel ændring), ikke bare nedtone det.
export const MIN_WEIGHT = 1;

/**
 * Anvend en tilt på ÉN arketypes filler-vægte.
 * Vægte skaleres, afrundes til heltal og gulvsættes til MIN_WEIGHT.
 */
export function tiltFiller(filler = [], tilt = NEUTRAL_TILT) {
  return filler.map((it) => {
    const cat = compositionCategory(it.value);
    const factor = (cat && tilt[cat] != null) ? tilt[cat] : 1;
    return { value: it.value, weight: Math.max(MIN_WEIGHT, Math.round(it.weight * factor)) };
  });
}

/**
 * Byg en hel ARCHETYPE_PROFILES-tabel med tilt'en anvendt på alle kind:"stage"-arketypers
 * filler. Returnerer en NY tabel — input muteres aldrig.
 *
 * @param {{tilt?:object, profiles?:object, skipArchetypes?:string[]}} args
 *   skipArchetypes  arketyper der skal stå helt uændret (fx ["grand_tour"] hvis man vil
 *                   holde GT'ens parcours fast mens resten kalibreres).
 */
export function applyCompositionTilt({ tilt = NEUTRAL_TILT, profiles = ARCHETYPE_PROFILES, skipArchetypes = [] } = {}) {
  const skip = new Set(skipArchetypes);
  const out = {};
  for (const [name, cfg] of Object.entries(profiles)) {
    if (cfg?.kind !== "stage" || skip.has(name) || !Array.isArray(cfg.filler)) {
      out[name] = cfg;
      continue;
    }
    out[name] = { ...cfg, filler: tiltFiller(cfg.filler, tilt) };
  }
  return out;
}

/**
 * Er to profil-tabeller ens på filler-niveau? Bruges til at bevise at NEUTRAL_TILT er en
 * no-op (determinisme-garanti: en kalibrering der ikke ændrer noget må ikke ændre nogen
 * kalender).
 */
export function fillersEqual(a, b) {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const n of names) {
    const fa = a[n]?.filler, fb = b[n]?.filler;
    if (!fa || !fb) { if (fa !== fb) return false; continue; }
    if (fa.length !== fb.length) return false;
    for (let i = 0; i < fa.length; i++) {
      if (fa[i].value !== fb[i].value || fa[i].weight !== fb[i].weight) return false;
    }
  }
  return true;
}

/**
 * Afstand fra en målt komposition til målprofilen. Summen af absolutte afvigelser i
 * procentpoint (L1) — samme enhed som tolerancen, så tallet kan læses direkte:
 * "13,2 pp samlet skævhed". Vægtet variant lader kalibreringen prioritere de kategorier
 * ejeren har været mest eksplicit om, hvis det bliver nødvendigt.
 */
export function compositionDistance(pct = {}, target = {}, weights = {}) {
  let sum = 0;
  for (const [cat, goal] of Object.entries(target)) {
    sum += Math.abs((pct[cat] ?? 0) - goal) * (weights[cat] ?? 1);
  }
  return sum;
}

/**
 * Værste enkelt-afvigelse i procentpoint. Det er DEN der afgør om ±2 pp-kravet er opfyldt
 * — en lav L1-sum kan stadig skjule ét kategori-brud, så begge tal rapporteres altid.
 */
export function worstDeviation(pct = {}, target = {}) {
  let worst = 0;
  let category = null;
  for (const [cat, goal] of Object.entries(target)) {
    const d = Math.abs((pct[cat] ?? 0) - goal);
    if (d > worst) { worst = d; category = cat; }
  }
  return { worst, category };
}

/**
 * Koordinat-descent over tilt-akserne. Bevidst simpelt og deterministisk: ingen tilfældig
 * start, ingen RNG, samme input → samme output. Rummet er lille (6 akser, glat respons),
 * så en gradient-fri koordinat-søgning er rigelig — og et resultat man kan genskabe er
 * mere værd her end et marginalt bedre optimum man ikke kan.
 *
 * `evaluate(tilt)` leverer kalderen: den kører den fulde generator-pipeline for et
 * kandidat-tilt og returnerer {score, ...}. Lavere score = bedre.
 *
 * @returns {{tilt:object, score:number, evaluations:number, history:Array}}
 */
export function searchTilt({
  evaluate, axes = ["flat", "hilly", "mountain", "itt", "cobbles"],
  start = NEUTRAL_TILT, steps = [0.5, 0.7, 0.85, 1.15, 1.4, 2.0, 3.0],
  rounds = 3, onProgress = () => {},
} = {}) {
  // Engelsk: developer-facing programmeringsfejl, ikke en spiller-/API-fejl (i18n-guard).
  if (typeof evaluate !== "function") throw new Error("searchTilt requires an evaluate function");

  let best = { ...start };
  let bestResult = evaluate(best);
  let evaluations = 1;
  const history = [{ tilt: { ...best }, score: bestResult.score, round: 0 }];

  for (let round = 1; round <= rounds; round++) {
    let improvedThisRound = false;
    for (const axis of axes) {
      for (const step of steps) {
        const candidate = { ...best, [axis]: Math.round(best[axis] * step * 1000) / 1000 };
        // Hold tilt'en i et fornuftigt bånd: uden for [0.1, 10] er vi reelt ved at
        // fjerne eller monopolisere et terræn, hvilket er en strukturel ændring
        // (guarantees) forklædt som en vægt-justering.
        if (candidate[axis] < 0.1 || candidate[axis] > 10) continue;
        const result = evaluate(candidate);
        evaluations++;
        history.push({ tilt: { ...candidate }, score: result.score, round });
        if (result.score < bestResult.score - 1e-9) {
          best = candidate;
          bestResult = result;
          improvedThisRound = true;
          onProgress({ round, axis, tilt: { ...best }, score: bestResult.score });
        }
      }
    }
    if (!improvedThisRound) break; // konvergeret — flere runder ville koste tid uden gevinst
  }

  return { tilt: best, score: bestResult.score, result: bestResult, evaluations, history };
}
