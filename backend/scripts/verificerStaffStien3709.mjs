#!/usr/bin/env node
//
// verificerStaffStien3709 — lukker hul 7 i #3709's spec.
//
// Specen: "Staff-stien uverificeret. facilityTrainingMultiplier målt til maks
// +8,3 % ved tier 5; staffTrainingBonus gav 1,0 mod en syntetisk profil, hvilket
// lige så godt kan være forkert input. Verificér mod en ægte profil."
//
// Den 1,0 er præcis den slags resultat man ikke må tro på: `staffTrainingBonus`
// returnerer 1,0 ad FIRE forskellige veje (ingen chef · ingen facilitet ·
// ukendt dimension · ingen specialiserings-fordel), og tre af dem er "du gav mig
// noget jeg ikke kunne læse". En syntetisk profil med forkerte nøgler rammer dem
// alle uden at sige noget.
//
// Derfor køres funktionerne her mod ÆGTE profiler hentet read-only fra prod
// (fixture: ./fixtures/staff-training-profiles-2026-08-15.json — anonymiseret,
// kun tiers og afledte evner, ingen navne eller hold-id'er).
//
//   node scripts/verificerStaffStien3709.mjs

import { readFileSync } from "node:fs";
import { staffTrainingBonus, facilityTrainingMultiplier, STAFF_TRAINING_BONUS_CONFIG } from "../lib/staffTrainingBonus.js";
import { dimensionOf, normalizeLevelBands } from "../lib/staffAbilityConstants.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";

const profiler = JSON.parse(readFileSync(new URL("./fixtures/staff-training-profiles-2026-08-15.json", import.meta.url), "utf8"));

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pct = (x) => `${((x - 1) * 100).toFixed(2)} %`;

console.log("# Hul 7: staff-stien verificeret mod ægte profiler\n");
console.log(`Profiler: ${profiler.length} aktive trænings-chefer fra prod (read-only, ${profiler.meta?.hentet ?? "2026-08-15"}).\n`);

// ── 0) Kan funktionen overhovedet LÆSE en ægte profil? ──────────────────────
// Den vigtigste kontrol, og den specen manglede: er akserne dem koden slår op i?
const dimensionerIProfil = new Set(profiler.flatMap((p) => Object.keys(p.dimensions ?? {})));
const dimensionerIKode = new Set(VISIBLE_ABILITIES.map((a) => dimensionOf(a)).filter(Boolean));
const niveauerIProfil = new Set(profiler.flatMap((p) => Object.keys(normalizeLevelBands(p.levels ?? {}))));
console.log("## 0. Læser koden profilens akser?\n");
console.log(`Dimensioner i profilerne : ${[...dimensionerIProfil].sort().join(", ")}`);
console.log(`Dimensioner koden slår op: ${[...dimensionerIKode].sort().join(", ")}`);
const dimOk = [...dimensionerIKode].every((d) => dimensionerIProfil.has(d));
console.log(`→ ${dimOk ? "✅ match" : "❌ MISMATCH — bonussen kan ikke ramme"}`);
console.log(`Niveauer i profilerne    : ${[...niveauerIProfil].sort().join(", ")}`);
console.log(`→ ${niveauerIProfil.has("u23") && niveauerIProfil.has("senior") ? "✅ match" : "❌ MISMATCH"}\n`);

// ── 1) staffTrainingBonus mod ægte profiler ─────────────────────────────────
const alle = [];
const perNiveau = { u23: [], senior: [] };
let enNulEffekt = 0, ialt = 0;
for (const p of profiler) {
  const staff = { overall: p.overall, dimensions: p.dimensions, levels: normalizeLevelBands(p.levels) };
  for (const niveau of ["u23", "senior"]) {
    for (const ability of VISIBLE_ABILITIES) {
      const b = staffTrainingBonus({ facilityTier: p.facility_tier, staff, ability, riderLevel: niveau });
      alle.push(b); perNiveau[niveau].push(b); ialt++;
      if (b === 1.0) enNulEffekt++;
    }
  }
}
console.log("## 1. staffTrainingBonus (specialisering, pr. rytter-evne)\n");
console.log(`Opslag i alt: ${ialt} (${profiler.length} chefer × 2 niveauer × ${VISIBLE_ABILITIES.length} evner)`);
console.log(`Præcis 1,0 (ingen effekt): ${enNulEffekt} (${((100 * enNulEffekt) / ialt).toFixed(1)} %)`);
console.log(`Effekt:  min ${pct(Math.min(...alle))} · median ${pct(median(alle))} · max ${pct(Math.max(...alle))}`);
for (const n of ["u23", "senior"]) {
  console.log(`  ${n.padEnd(7)} median ${pct(median(perNiveau[n]))} · max ${pct(Math.max(...perNiveau[n]))}`);
}

// ── 2) facilityTrainingMultiplier ───────────────────────────────────────────
console.log("\n## 2. facilityTrainingMultiplier (magnitude, hele truppen)\n");
const facs = profiler.map((p) => facilityTrainingMultiplier({
  facilityTier: p.facility_tier,
  staff: { overall: p.overall, dimensions: p.dimensions, levels: normalizeLevelBands(p.levels) },
}));
console.log(`min ${pct(Math.min(...facs))} · median ${pct(median(facs))} · max ${pct(Math.max(...facs))}`);

// ── 3) Den SAMLEDE effekt motoren faktisk ganger ind ────────────────────────
console.log("\n## 3. Samlet effekt (begge led, som dailyAbilityDelta ganger dem)\n");
const samlet = [];
const bedsteCase = { v: 0 };
for (let i = 0; i < profiler.length; i++) {
  const p = profiler[i];
  const staff = { overall: p.overall, dimensions: p.dimensions, levels: normalizeLevelBands(p.levels) };
  for (const niveau of ["u23", "senior"]) {
    for (const ability of VISIBLE_ABILITIES) {
      const v = staffTrainingBonus({ facilityTier: p.facility_tier, staff, ability, riderLevel: niveau }) * facs[i];
      samlet.push(v);
      if (v > bedsteCase.v) Object.assign(bedsteCase, { v, tier: p.facility_tier, staffTier: p.staff_tier, ability, niveau, overall: p.overall });
    }
  }
}
console.log(`min ${pct(Math.min(...samlet))} · median ${pct(median(samlet))} · max ${pct(Math.max(...samlet))}`);
console.log(`Bedste enkelt-tilfælde: ${pct(bedsteCase.v)} (facilitet tier ${bedsteCase.tier}, chef tier ${bedsteCase.staffTier}, overall ${bedsteCase.overall}, ${bedsteCase.ability}, ${bedsteCase.niveau})`);

console.log(`\nKalibrerings-konstanter: k=${STAFF_TRAINING_BONUS_CONFIG.k}, facilityScale=${JSON.stringify(STAFF_TRAINING_BONUS_CONFIG.facilityScale)}`);
