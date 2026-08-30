#!/usr/bin/env node
// Fitter (signatureBoostPerWeight, dampPerWeight) mod de FAKTISKE prod-start-værdier
// fra kuldene før 7/8 — målt på de 384 'offered'-kandidater der aldrig fik et hold
// (= aldrig trænet, altså rene start-værdier). #2064's ejer-godkendte bånd.
import { generateAcademyCandidates, YOUTH_GEN_CONFIG } from "../../lib/academyGenerator.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../../lib/physiologySeeding.js";
import { deriveAbilities } from "../../lib/abilityDerivation.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";

const PHYS = ["climbing","time_trial","flat","tempo","sprint","acceleration","punch","endurance","recovery","durability"];
// Reference (prod, aldrig trænet): { alder: [bedsteEvne, gab] }
const REF = { 16:[5.2,1.25], 17:[7.4,1.96], 18:[9.6,1.57], 19:[11.8,0.98], 20:[13.0,0.29], 21:[13.0,0.11] };

function measure(patch, n = 2500) {
  const cfg = Object.freeze({ ...YOUTH_GEN_CONFIG, ...patch });
  const rng = makeRng(777);
  const cands = generateAcademyCandidates({ rng, referenceYear: 2026, existingNames: new Set(), countOverride: n, genCfg: cfg });
  const byAge = {};
  for (const c of cands) {
    const rr = { id: "f", ...c.rider };
    const ab = deriveAbilities(seedPhysiologyFromLegacy(rr), rr);
    const age = ageForSeason(rr.birthdate, 1);
    const v = PHYS.map(k => ab[k]).sort((a,b)=>b-a);
    (byAge[age] ??= []).push([v[0], v[0]-v[1]]);
  }
  const out = {};
  for (const [age, rows] of Object.entries(byAge)) {
    out[age] = [
      Math.round(rows.reduce((s,r)=>s+r[0],0)/rows.length*10)/10,
      Math.round(rows.reduce((s,r)=>s+r[1],0)/rows.length*100)/100,
    ];
  }
  return out;
}

// Score = summeret relativ afvigelse på både niveau og gab (lige vægt).
function score(m) {
  let s = 0, k = 0;
  for (const [age, [refBest, refGap]] of Object.entries(REF)) {
    if (!m[age]) continue;
    s += Math.abs(m[age][0] - refBest) / Math.max(1, refBest);
    s += Math.abs(m[age][1] - refGap) / Math.max(0.5, refGap);
    k += 2;
  }
  return k ? s / k : 99;
}

const results = [];
for (const boost of [0.6,0.8,1.0,1.2]) {
  for (const damp of [0.8,1.0,1.3]) {
    for (const base of [47.5,48.0,48.5,49.0,49.5]) {
      const m = measure({ signatureBoostPerWeight: boost, dampPerWeight: damp, statCeilBoosted: 54, baseStatAt16: base });
      results.push({ boost, damp, base, score: Math.round(score(m)*1000)/1000, m });
    }
  }
}
results.sort((a,b)=>a.score-b.score);
console.log("Top 8 kalibreringer (lavest afvigelse fra prod-referencen):\n");
console.log("boost damp base | afvig |  16        17        18        19        20        21   (bedste/gab)");
for (const r of results.slice(0,8)) {
  const cells = [16,17,18,19,20,21].map(a => r.m[a] ? `${r.m[a][0]}/${r.m[a][1]}` : "-").map(s=>s.padStart(9)).join(" ");
  console.log(`${String(r.boost).padStart(5)} ${String(r.damp).padStart(4)} ${String(r.base).padStart(4)} | ${String(r.score).padStart(5)} |${cells}`);
}
console.log(`\nREFERENCE (prod, aldrig trænet)      |` + [16,17,18,19,20,21].map(a=>`${REF[a][0]}/${REF[a][1]}`).map(s=>s.padStart(9)).join(" "));
const m2 = measure({ signatureBoostPerWeight: 2, dampPerWeight: 2.6, statCeilBoosted: 54 });
console.log(`Min nuværende PR (2 / 2,6 / 47,5): afvigelse ${Math.round(score(m2)*1000)/1000}`);
