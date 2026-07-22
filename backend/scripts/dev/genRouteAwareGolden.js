// Sub-3 (#2771): golden-gate generator — bit-identitets-anker.
//
// Kør PÅ MAIN-koden (FØR stageGapModel/route-aware-ændringerne rammer
// raceSimulator.js): bygger 20 deterministiske cases der spænder alle 9
// profile_types, blandede seeds og v3 on/off, og kører dem gennem den
// UÆNDREDE simulateStage. Output = golden-filen som Sub-3-implementeringen
// skal reproducere BIT-FOR-BIT for etaper UDEN rutedata (raceRunnerRouteAware.
// test.js). stageProfile-objekterne her er bevidst BARE — profile_type,
// finale_type, demand_vector, stage_number — INGEN rutefelter (distance_km,
// climbs, sectors, ...). Det er selve invarianten: uden rutedata er hver
// kodesti en identitet.
//
// Ingen rng i case-opbygningen — kun deterministiske formler afledt af index,
// så scriptet selv er reproducerbart (kør det to gange → samme golden-fil).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { simulateStage, ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { DEMAND_VECTORS } from "../../lib/raceStageProfileGenerator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "..", "lib", "raceRunnerRouteAware.golden.json");

const PROFILE_TYPES = Object.freeze([
  "flat", "rolling", "hilly", "mountain", "high_mountain",
  "itt", "ttt", "cobbles", "classic",
]);

// Én plausibel finale_type pr. profil (jf. FINALE_BY_PROFILE i
// raceStageProfileGenerator.js — her hardkodet: golden-scriptet skal blive
// ved med at bygge de SAMME cases uanset senere ændringer i den tabel).
const FINALE_BY_PROFILE = Object.freeze({
  flat: "bunch_sprint",
  rolling: "reduced_sprint",
  hilly: "punch",
  mountain: "descent",
  high_mountain: "long_climb",
  itt: "solo_tt",
  ttt: "solo_tt",
  cobbles: "reduced_sprint",
  classic: "punch",
});

const SEEDS = Object.freeze([2026, 7, 42]);

// Deterministiske roller cyklisk fordelt — så team-konteksten (kaptajn/hjælper/
// hunter) er aktiv i nogle cases uden at kræve rng.
const ROLES = Object.freeze(["captain", "helper", "sprint_captain", "helper", "hunter"]);

// Abilities udledt rent af (case, rytter)-index — ingen rng. Alle 15 evner
// får en værdi i [50, 89], spredt via forskellige multiplikatorer pr. evne
// så ryttere inden for samme case ikke er identiske.
function entrantAbilities(idx) {
  const abilities = {};
  ABILITY_KEYS.forEach((k, ki) => {
    abilities[k] = 50 + ((idx * 7 + ki * 13) % 40);
  });
  return abilities;
}

function buildEntrants(count, caseIdx) {
  return Array.from({ length: count }, (_, i) => {
    const idx = caseIdx * 100 + i; // globalt unik + deterministisk
    return {
      rider_id: `r${caseIdx}_${i}`,
      team_id: `t${caseIdx}_${i % 4}`,
      race_role: ROLES[i % ROLES.length],
      abilities: entrantAbilities(idx),
      fatigue: (idx * 11) % 60,
      form: (idx * 17) % 100,
    };
  });
}

// 20 cases: alle 9 profile_types × {v3:false, v3:true} = 18, + 2 ekstra
// (mountain v3:false-gentagelse med anden seed/felt-størrelse, flat v3:true-
// gentagelse) for at ramme 20 og teste at samme profil opfører sig identisk
// på tværs af entrant-tællinger.
function buildCaseSpecs() {
  const specs = [];
  for (const pt of PROFILE_TYPES) {
    specs.push({ profileType: pt, v3: false });
    specs.push({ profileType: pt, v3: true });
  }
  specs.push({ profileType: "mountain", v3: false });
  specs.push({ profileType: "flat", v3: true });
  return specs;
}

function main() {
  const specs = buildCaseSpecs();
  if (specs.length !== 20) throw new Error(`Forventede 20 cases, fik ${specs.length}`);

  const cases = specs.map((spec, caseIdx) => {
    const seed = SEEDS[caseIdx % SEEDS.length];
    const count = 8 + (caseIdx % 5); // 8..12 entrants
    const stageNumber = (caseIdx % 8) + 1;
    const entrants = buildEntrants(count, caseIdx);
    const stageProfile = {
      profile_type: spec.profileType,
      finale_type: FINALE_BY_PROFILE[spec.profileType],
      demand_vector: DEMAND_VECTORS[spec.profileType],
      stage_number: stageNumber,
    };
    const result = simulateStage({ entrants, stageProfile, seed, v3: spec.v3 });
    return {
      entrants,
      stageProfile,
      seed,
      v3: spec.v3,
      expected: JSON.parse(JSON.stringify(result)),
    };
  });

  writeFileSync(OUT_PATH, JSON.stringify({ cases }, null, 2) + "\n", "utf8");
  console.log(`Skrev ${cases.length} golden-cases → ${OUT_PATH}`);
}

main();
