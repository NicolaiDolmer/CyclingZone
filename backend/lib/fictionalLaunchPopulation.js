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
// Kalibrering (ejer-godkendt 2026-06-07) → kører hele værdi-kæden
// (deriveAbilities → computeRiderTypes → predictBaseValue) til denne pyramide:
//   superstjerne ~10  (≥8M)   ·  stjerne ~68   (1–8M)
//   solid        ~160 (200k–1M) ·  domestik ~560 (<200k)
// Type-mix: alle 9 repræsenteret (gulv gc≥30, sprinter≥40); klatrer/tt tungest,
// realistisk peloton-form. Detaljer: docs/slices/669-fictional-riders.md.

import { generateFictionalRiders } from "./fictionalRiderGenerator.js";

export const LAUNCH_POPULATION = Object.freeze({
  seed: 2026,
  count: 800,
  referenceYear: 2026,
});

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
