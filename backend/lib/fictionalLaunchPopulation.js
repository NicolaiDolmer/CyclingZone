// Låste parametre for den fiktive launch-population (#669/#677, relaunch-epic #1105).
//
// SINGLE SOURCE OF TRUTH for "hvilken population genererer den friske sæson 1".
// Relaunch-orchestratoren (#1103) importerer disse + generateLaunchPopulation(),
// så populationen er reproducerbar uden at committe ~570 KB genereret JSON: seed +
// params + generator-koden + navne-pools determinerer outputtet fuldstændigt.
//
// Den fulde audit kan altid regenereres til inspektion:
//   node scripts/generateFictionalRiders.js --count 800 --seed 2026 --reference-year 2026 --out audit.json
// og fordelingen verificeres med:
//   node scripts/previewFictionalPopulation.js --count 800 --seed 2026
//
// Kalibrering (ejer-godkendt 2026-06-07, re-tunet mod værdimodel v3 i #1194) →
// kører hele værdi-kæden (deriveAbilities → computeRiderTypes → predictBaseValue)
// til design-pyramiden:
//   superstjerne ~12  (≥8M)     ·  stjerne  ~60  (1–8M)
//   solid        ~230 (200k–1M) ·  domestik ~500 (<200k)
// Faktisk ved seed 2026: 12/68/203/517, max ~24M (ingen urealistiske outliers).
// Type-mix: alle 8 repræsenteret (gulv gc≥30, sprinter≥40); klatrer/tt tungest,
// realistisk peloton-form. Detaljer: docs/slices/669-fictional-riders.md.

import { generateFictionalRiders } from "./fictionalRiderGenerator.js";
import { STAR_RIDER_MARKET_VALUE } from "./economyConstants.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";

export const LAUNCH_POPULATION = Object.freeze({
  seed: 2026,
  count: 800,
  referenceYear: 2026,
});

// Launch-pyramide-bånd (CZ$) — ejer-spec 2026-06-07. Superstjerne-grænsen ER
// spillets stjernerytter-tærskel (STAR_RIDER_MARKET_VALUE, #1205/#1210): én delt
// konstant, så bånd-definitionen, force-sale-beskyttelsen og team_star-achievementet
// aldrig kan drifte fra hinanden (#1198 mutant pop-MUT-4 — tidligere var 8M
// hardcodet to steder uden kobling).
export const LAUNCH_VALUE_BANDS = Object.freeze([
  Object.freeze({ key: "superstjerne", lo: STAR_RIDER_MARKET_VALUE, hi: Infinity, target: 12 }),
  Object.freeze({ key: "stjerne", lo: 1_000_000, hi: STAR_RIDER_MARKET_VALUE, target: 60 }),
  Object.freeze({ key: "solid", lo: 200_000, hi: 1_000_000, target: 230 }),
  Object.freeze({ key: "domestik", lo: 0, hi: 200_000, target: 500 }),
]);

// Ejer-gulve for type-mixet ved launch ("alle 8 repræsenteret, gulv gc≥30,
// sprinter≥40"). Generatorens ENSURE_MIN_TYPES er MEKANISMEN — dette er ORAKLET
// (uafhængig dobbelt-bogføring som preview-gaten håndhæver, #1198 pop-MUT-6).
export const LAUNCH_TYPE_FLOORS = Object.freeze({ gc: 30, sprinter: 40 });

/**
 * Oracle for launch-type-mixet (#1198): alle 8 typer repræsenteret + ejer-gulve.
 * @param {Record<string, number>} typeCounts afledt primary_type → antal
 * @returns {string[]} liste af brud (tom = OK)
 */
export function checkLaunchTypeMix(typeCounts = {}) {
  const failures = [];
  for (const key of RIDER_TYPE_KEYS) {
    if (!((typeCounts[key] || 0) >= 1)) {
      failures.push(`type '${key}' er slet ikke repræsenteret i populationen (launch-krav: alle 8 typer)`);
    }
  }
  for (const [key, min] of Object.entries(LAUNCH_TYPE_FLOORS)) {
    if ((typeCounts[key] || 0) < min) {
      failures.push(`type '${key}' har ${typeCounts[key] || 0} ryttere — ejer-gulvet er ≥${min}`);
    }
  }
  return failures;
}

/**
 * Generér den låste launch-population (rør ingen DB).
 * @param {Set<string>} [existingFoldedNames] foldNameNordic af alle eksisterende
 *   DB-navne — håndhæver navne-unikhed mod evt. tilbageværende PCM-ryttere
 *   (§3-fælden i 669-slicen). Orchestratoren henter dette fra DB før insert.
 * @returns se generateFictionalRiders
 */
export function generateLaunchPopulation(existingFoldedNames = new Set()) {
  return generateFictionalRiders({ ...LAUNCH_POPULATION, existingFoldedNames });
}
