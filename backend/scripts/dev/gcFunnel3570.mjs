// EKSPERIMENT (#3570 fase 2-opfølgning): hvor i kæden dør GC-kandidaterne — NU
// under den NYE kæde (archetype_draw former caps DIREKTE, backfillCores.js).
//
// Kopieret + opdateret fra fase 1-versionen (gcFunnel3570.mjs, wf_a1281334-109-1) —
// den målte 0/303 gc-trukne genkendt som gc, fordi bootstrap-typen (klassificeret
// mod NEUTRAL_BASELINE på flade 1-12-profiler) formede caps' rolle-faktor i stedet
// for det trukne anlæg. Denne version springer bootstrap-trinnet over og former
// caps af DET TRUKNE anlæg direkte — spejler backfillCores.deriveForRiderIds' nye
// kæde (physiology → abilities → [archetype_draw ELLER bootstrap] → caps → endelig
// type) præcist.
//
//   node scripts/dev/gcFunnel3570.mjs [--gcTt=0.55] [--gcClimb=0.85]
import { generateAcademyCandidates, YOUTH_GEN_CONFIG } from "../../lib/academyGenerator.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildCapsForRider } from "../../lib/riderProgression.js";
import { computeRiderTypes } from "../../lib/riderTypes.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const youthBaseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaselineYouth.json"), "utf8"));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? parseFloat(hit.split("=")[1]) : def;
}
const gcTt = arg("gcTt", YOUTH_GEN_CONFIG.gcTimeTrialBoostRatio);
const gcClimb = arg("gcClimb", YOUTH_GEN_CONFIG.gcClimbingBoostRatio);
const genCfg = { ...YOUTH_GEN_CONFIG, gcTimeTrialBoostRatio: gcTt, gcClimbingBoostRatio: gcClimb };

const N = 3000;
const rng = makeRng(2026);
const cands = generateAcademyCandidates({ rng, referenceYear: 2026, existingNames: new Set(), countOverride: N, genCfg });

let drawnGc = 0, finalGc = 0;
const finalForDrawnGc = {};
const finalDist = {};
for (let i = 0; i < cands.length; i++) {
  const c = cands[i];
  const riderRow = { id: `f-${i}`, ...c.rider };
  const abilities = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
  const baseline = {};
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
  // NY KÆDE (#3570 fase 2): caps formes DIREKTE af det trukne anlæg — intet
  // bootstrap-mellemtrin. Spejler backfillCores.deriveForRiderIds' archetype_draw-
  // gren (draw.primary/draw.secondary i stedet for bootstrapTypeByRider).
  const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale }, c.archetypeDraw.primary, c.archetypeDraw.secondary);
  const final = computeRiderTypes(caps, youthBaseline);
  finalDist[final.primary.key] = (finalDist[final.primary.key] ?? 0) + 1;
  if (final.primary.key === "gc") finalGc++;

  const isDrawnGc = c.archetypeDraw.primary === "gc" || c.archetypeDraw.secondary === "gc";
  if (isDrawnGc) {
    drawnGc++;
    finalForDrawnGc[final.primary.key] = (finalForDrawnGc[final.primary.key] ?? 0) + 1;
  }
}
console.log(`n=${N}  gcTimeTrialBoostRatio=${gcTt}  gcClimbingBoostRatio=${gcClimb}`);
console.log(`1. Trukket med gc-anlæg (primær/sekundær): ${drawnGc} (${(100 * drawnGc / N).toFixed(1)} %)`);
console.log(`2. Endelig type gc, blandt de TRUKNE gc-kandidater: ${finalForDrawnGc.gc ?? 0} (${(100 * (finalForDrawnGc.gc ?? 0) / drawnGc).toFixed(1)} % af de trukne)`);
console.log(`3. Endelig type gc, HELE kuldet: ${finalGc} (${(100 * finalGc / N).toFixed(1)} %)`);
console.log(`Hvad blev de trukne gc-anlæg i stedet? ${JSON.stringify(finalForDrawnGc)}`);
console.log(`Endelig fordeling (hele kuldet): ${JSON.stringify(finalDist)}`);
