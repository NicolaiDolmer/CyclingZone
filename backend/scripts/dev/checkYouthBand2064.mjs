#!/usr/bin/env node
// Verificerer ungdoms-generatoren mod den LÅSTE aftale i #2064 §2a (ejer-valg 19/7):
//   aldersbånd | afledt kerne (median) | bedste anlæg (median)
//   16-17      | 3                     | 6
//   18-19      | 8                     | 12
//   20-21      | 12                    | 12
// "kerne" = median over rytterens 10 fysiske evner. "bedste anlæg" = højeste.
// Begge aggregeres som MEDIAN over kuldet (ikke gennemsnit).
import { generateAcademyCandidates, YOUTH_GEN_CONFIG } from "../../lib/academyGenerator.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../../lib/physiologySeeding.js";
import { deriveAbilities } from "../../lib/abilityDerivation.js";

const PHYS = ["climbing","time_trial","flat","tempo","sprint","acceleration","punch","endurance","recovery","durability"];
const MAAL = { "16-17": [3,6], "18-19": [8,12], "20-21": [12,12] };
const med = (a) => { const s=[...a].sort((x,y)=>x-y); return s.length%2 ? s[s.length>>1] : (s[(s.length>>1)-1]+s[s.length>>1])/2; };
const band = (age) => age<=17 ? "16-17" : age<=19 ? "18-19" : "20-21";

function run(patch, label) {
  const cfg = Object.freeze({ ...YOUTH_GEN_CONFIG, ...patch });
  const rng = makeRng(31337);
  const cands = generateAcademyCandidates({ rng, referenceYear: 2026, existingNames: new Set(), countOverride: 4000, genCfg: cfg });
  const by = { "16-17": {k:[],b:[]}, "18-19": {k:[],b:[]}, "20-21": {k:[],b:[]} };
  const potTop = {};
  for (const c of cands) {
    const rr = { id:"v", ...c.rider };
    const ab = deriveAbilities(seedPhysiologyFromLegacy(rr), rr);
    const age = 2026 - Number(String(rr.birthdate).slice(0,4));
    const vals = PHYS.map(k=>ab[k]);
    by[band(age)].k.push(med(vals));
    by[band(age)].b.push(Math.max(...vals));
    if (age<=17) (potTop[rr.potentiale] ??= []).push(Math.max(...vals));
  }
  console.log(`\n=== ${label} ===`);
  console.log("bånd   | kerne (mål) | bedste (mål) | status");
  for (const [b,[mk,mb]] of Object.entries(MAAL)) {
    const k = med(by[b].k), bb = med(by[b].b);
    const ok = k<=mk && bb<=mb ? "ok" : "OVER MÅL";
    console.log(`${b.padEnd(6)} | ${String(k).padStart(5)} (${mk})   | ${String(bb).padStart(6)} (${mb})   | ${ok}`);
  }
  const pots = Object.keys(potTop).map(Number).sort((a,b)=>a-b);
  console.log("16-17-årige, bedste anlæg pr. potentiale (median / max):");
  console.log("  " + pots.map(p=>`pot ${p}: ${med(potTop[p])}/${Math.max(...potTop[p])}`).join("  "));
}

run({}, `NUVÆRENDE KODE (base ${YOUTH_GEN_CONFIG.baseStatAt16}, boost ${YOUTH_GEN_CONFIG.signatureBoostPerWeight})`);
for (const base of [47.0, 46.5, 46.0]) run({ baseStatAt16: base }, `base ${base}`);
