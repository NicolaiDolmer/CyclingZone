#!/usr/bin/env node
// Verificerer ungdoms-generatoren mod den LÅSTE aftale i #2064 §2a (ejer-valg 19/7):
//   aldersbånd | afledt kerne (median) | bedste anlæg (median)
//   16-17      | 3                     | 6
//   18-19      | 8                     | 12
//   20-21      | 12                    | 12
// "kerne" = median over rytterens 10 fysiske evner. "bedste anlæg" = højeste.
// Begge aggregeres som MEDIAN over kuldet (ikke gennemsnit).
//
// RETTET 2026-08-09 (#3564, T3-M1/I3-portene — se progressionGates3564.mjs):
// scriptet testede FØR kun `k<=mål && bb<=mål` og kaldte underkorrektion "ok" — netop
// det der lod 9/8-hotfixet slippe igennem MED bunden under aftalen (kerne 1 mod mål 3).
// Nu delegeres selve gate-logikken til progressionGates3564.mjs (T3-M1 = tosidet
// [mål−1,mål+1], I3 = hale på graduerings-niveau) så scriptet og negativ-test-beviset
// (gates3564NegativeProof.mjs) deler ÉN sandhed. Tilføjet: hale-linje (I3) + en
// nedre-niveau-linje (p10 pr. bånd) der viser BUNDEN af fordelingen, ikke kun medianen —
// en median kan se pæn ud mens halen er kollapset (design-princip 2+3, §4).
import { generateAcademyCandidates, YOUTH_GEN_CONFIG } from "../../lib/academyGenerator.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../../lib/physiologySeeding.js";
import { deriveAbilities } from "../../lib/abilityDerivation.js";
import { LAUNCH_REFERENCE_YEAR } from "../../lib/riderSeasonAge.js";
import {
  PHYSICAL_ABILITIES, median, percentile,
  gateT3M1TwoSidedBands, gateI3GraduationLevelTail, BAND_2A_TARGETS,
} from "./lib/progressionGates3564.mjs";

const band = (age) => age <= 17 ? "16-17" : age <= 19 ? "18-19" : "20-21";

// Byg lette records (kun det T3-M1/I3 kræver: age, corePhysical, bestPhysical) — INGEN
// type-klassifikation/caps nødvendig for et rent bånd-check på rå afledte evner.
function buildLightRecords(cands, referenceYear) {
  const records = [];
  for (const c of cands) {
    const rr = { id: "v", ...c.rider };
    const ab = deriveAbilities(seedPhysiologyFromLegacy(rr), rr);
    const age = referenceYear - Number(String(rr.birthdate).slice(0, 4));
    const vals = PHYSICAL_ABILITIES.map((k) => ab[k]);
    records.push({
      age, potentiale: rr.potentiale,
      corePhysical: median(vals),
      bestPhysical: Math.max(...vals),
    });
  }
  return records;
}

function run(patch, label) {
  const cfg = Object.freeze({ ...YOUTH_GEN_CONFIG, ...patch });
  const rng = makeRng(31337);
  const cands = generateAcademyCandidates({ rng, referenceYear: LAUNCH_REFERENCE_YEAR, existingNames: new Set(), countOverride: 4000, genCfg: cfg });
  const records = buildLightRecords(cands, LAUNCH_REFERENCE_YEAR);

  console.log(`\n=== ${label} ===`);

  // ── Tosidet median-check (T3-M1) ──────────────────────────────────────────────
  const t3m1 = gateT3M1TwoSidedBands(records);
  console.log("bånd   | kerne (mål) | bedste (mål) | status");
  for (const d of t3m1.detaljer.detaljer) {
    if (d.note) { console.log(`${d.band.padEnd(6)} | ${d.note}`); continue; }
    console.log(`${d.band.padEnd(6)} | ${String(d.kerne).padStart(5)} (${d.kerneMål})   | ${String(d.bedste).padStart(6)} (${d.bedsteMål})   | ${d.status}`);
  }
  console.log(`T3-M1 (tosidet, ±1): ${t3m1.pass ? "PASS" : "FAIL"}`);

  // ── Hale-linje (I3): andel af 16-17-årige født på graduerings-niveau 12 ────────
  const i3 = gateI3GraduationLevelTail(records);
  console.log(`I3 (hale, graduerings-niveau 12, 16-17 år): ${i3.målt} — ${i3.pass ? "PASS" : "FAIL"} (grænse ${i3.grænse})`);

  // ── Nedre niveau-linje: p10 pr. bånd (viser BUNDEN, ikke kun medianen) ─────────
  console.log("bånd   | p10 kerne | p10 bedste  (diagnostisk — ingen hård grænse endnu)");
  for (const bandKey of Object.keys(BAND_2A_TARGETS)) {
    const inBand = records.filter((r) => band(r.age) === bandKey);
    if (!inBand.length) { console.log(`${bandKey.padEnd(6)} | ingen data`); continue; }
    const p10k = percentile(inBand.map((r) => r.corePhysical), 10);
    const p10b = percentile(inBand.map((r) => r.bestPhysical), 10);
    console.log(`${bandKey.padEnd(6)} | ${String(p10k).padStart(9)} | ${String(p10b).padStart(10)}`);
  }
}

run({}, `NUVÆRENDE KODE (base ${YOUTH_GEN_CONFIG.baseStatAt16}, boost ${YOUTH_GEN_CONFIG.signatureBoostPerWeight})`);
for (const base of [47.0, 46.5, 46.0]) run({ baseStatAt16: base }, `base ${base}`);
