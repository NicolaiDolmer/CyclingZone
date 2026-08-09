#!/usr/bin/env node
// #2064 §2a lader startLuck give overlap mellem potentiale-tiers ("små kan starte
// lidt over middel"). Men startLuckSd=1,2 rå point på et bånd der kun er 4 point
// bredt (rå 50-54 = evne 1-12) betyder at 7,1 % af alle 16-17-årige fødes på
// graduerings-niveau (evne 12) — og 2 ud af 3 af dem har potentiale <= 2.
// Måler hvad en strammere startLuck gør ved topenden vs. talent-signalet.
import { generateAcademyCandidates, YOUTH_GEN_CONFIG } from "../../lib/academyGenerator.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../../lib/physiologySeeding.js";
import { deriveAbilities } from "../../lib/abilityDerivation.js";
const PHYS=["climbing","time_trial","flat","tempo","sprint","acceleration","punch","endurance","recovery","durability"];
const med=(a)=>{const s=[...a].sort((x,y)=>x-y);return s.length%2?s[s.length>>1]:(s[(s.length>>1)-1]+s[s.length>>1])/2;};

console.log("startLuck | 16-17: kerne/bedste (mål 3/6) | andel evne>=12 | lavtalent i top | pot1 vs pot6 (median bedste)");
for (const sl of [1.2, 1.0, 0.8, 0.6, 0.5, 0.4]) {
  const cfg = Object.freeze({ ...YOUTH_GEN_CONFIG, startLuckSd: sl });
  const rng = makeRng(31337);
  const cands = generateAcademyCandidates({ rng, referenceYear: 2026, existingNames: new Set(), countOverride: 6000, genCfg: cfg });
  const y = [];
  for (const c of cands) {
    const rr = { id:"s", ...c.rider };
    const ab = deriveAbilities(seedPhysiologyFromLegacy(rr), rr);
    const age = 2026 - Number(String(rr.birthdate).slice(0,4));
    if (age <= 17) { const v = PHYS.map(k=>ab[k]); y.push({ pot: rr.potentiale, best: Math.max(...v), core: med(v) }); }
  }
  const top = y.filter(r=>r.best>=12);
  const lav = top.filter(r=>r.pot<=2).length;
  const p1 = y.filter(r=>r.pot<=1.5).map(r=>r.best), p6 = y.filter(r=>r.pot>=5.5).map(r=>r.best);
  console.log(
    `${String(sl).padStart(9)} | ${String(med(y.map(r=>r.core))).padStart(5)}/${String(med(y.map(r=>r.best))).padEnd(5)}            ` +
    `| ${(100*top.length/y.length).toFixed(1).padStart(5)}%        ` +
    `| ${String(lav).padStart(4)}/${String(top.length).padEnd(4)}     ` +
    `| ${med(p1)} vs ${p6.length?med(p6):"-"}`
  );
}
