// #3564 — livscyklus-simulering af DAGENS væksmotor, til negativ-test af trin 2-portene
// (T2-N1 anti-frontloading, T2-M1 skelet-median, T2-H1 specialiserings-gab, T2-H2
// tidlig-loft-andel). REN simulering — ingen DB, INGEN ændring af motor-kode. Kalder
// udelukkende eksisterende, uændrede funktioner fra riderProgression.js/dailyTraining.js
// (buildCapsForRider, applyDailyTick, resolveProgram) præcis som produktions-motoren gør:
// 28 dage/sæson, program normal/smartDefaultFocus, conditionMult 1, ingen staff/facility,
// caps genberegnet pr. sæson.
//
// Startprofil er en syntetisk TILNÆRMELSE til "en §2a-konform 16-årig" (§5-skelettets
// 16-års-anker × motorens EGEN rolle-faktor youthRoleFactor) — IKKE en påstand om at det
// er generatorens faktiske output (det er trin 3's ansvar, se OPGAVE-note om at
// startniveauet kalibreres SIDST). Formålet her er alene at bevise/afkræfte hvad
// VÆKSTKURVEN gør ved et rimeligt startpunkt, isoleret fra generator-støj.

import { buildCapsForRider, buildYouthCaps, youthRoleFactor } from "../../../lib/riderProgression.js";
import { applyDailyTick, resolveProgram, DAILY_TRAINING_CONFIG } from "../../../lib/dailyTraining.js";
import { VISIBLE_ABILITIES } from "../../../lib/abilityDerivation.js";
import { RIDER_TYPE_KEYS } from "../../../lib/riderTypes.js";
import { PHYSICAL_ABILITIES, median } from "./progressionGates3564.mjs";

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// §5 (FORESLÅET skelet) — 16-års-anker pr. potentiale. Bruges KUN som simulerings-
// startpunkt her (se filhoved).
export const SKELETON_16_ANCHOR = Object.freeze({ 1: 4, 2: 5, 3: 6, 4: 6, 5: 6, 6: 6 });

function buildStartingAbilities(potentiale, primaryType, secondaryType, anchor = SKELETON_16_ANCHOR) {
  const tier = Math.max(1, Math.min(6, Math.round(Number(potentiale) || 1)));
  const target = anchor[tier] ?? 6;
  const abilities = {};
  for (const ability of VISIBLE_ABILITIES) {
    const factor = youthRoleFactor(primaryType, secondaryType, ability);
    abilities[ability] = clamp(Math.round(target * factor), 1, 99);
  }
  return abilities;
}

/**
 * Simulér ÉN rytters livscyklus fra startAge til endAge (eksklusiv) med DAGENS motor.
 * Returnerer snapshots [{ age, abilities }]. Snapshot ved alder X = værdien EFTER at have
 * gennemført sæsonen som (X-1)-årig ("hvor god er han lige VED sin X-års fødselsdag").
 */
export function simulateOneLifecycle({ riderId, potentiale, primaryType, secondaryType = null, startAge = 16, endAge = 24, startAnchor = SKELETON_16_ANCHOR }) {
  let abilities = buildStartingAbilities(potentiale, primaryType, secondaryType, startAnchor);
  let progress = Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, 0]));
  const program = resolveProgram(null, primaryType);
  const daysPerSeason = DAILY_TRAINING_CONFIG.daysPerSeason;
  const snapshots = [{ age: startAge, abilities: { ...abilities } }];

  for (let age = startAge; age < endAge; age++) {
    const caps = buildCapsForRider(abilities, { potentiale, age }, primaryType, secondaryType);
    for (let day = 0; day < daysPerSeason; day++) {
      const tick = applyDailyTick({
        riderId, dateStr: `sim-${age}-${day}`, age, abilities, caps, progress, program,
        conditionMult: 1, bonus: false, potentiale,
      });
      abilities = tick.abilities;
      progress = tick.progress;
    }
    snapshots.push({ age: age + 1, abilities: { ...abilities } });
  }
  return snapshots;
}

/**
 * Simulér en POPULATION (mange ryttere pr. potentiale-tier, spredt over de 8 ryttertyper
 * for variation + seeded dags-støj pr. rider-id) og fladgør til ét array af per-alder-
 * records i SAMME form som progressionGates3564.mjs' cohort-records (age, potentiale,
 * bestPhysical, secondBestPhysical, corePhysical, ratio, loft) — så T2-portene kan
 * bruges direkte på outputtet.
 */
export function simulateLifecyclePopulation({ tiers = [1, 2, 3, 4, 5, 6], perTier = 30, startAge = 16, endAge = 24, startAnchor = SKELETON_16_ANCHOR } = {}) {
  const out = [];
  for (const tier of tiers) {
    for (let i = 0; i < perTier; i++) {
      const primaryType = RIDER_TYPE_KEYS[i % RIDER_TYPE_KEYS.length];
      const riderId = `lcsim-${tier}-${i}`;
      const snapshots = simulateOneLifecycle({ riderId, potentiale: tier, primaryType, startAge, endAge, startAnchor });
      const loft = Math.max(...Object.values(buildYouthCaps(tier, primaryType, null)));
      for (const snap of snapshots) {
        const physVals = PHYSICAL_ABILITIES.map((a) => Number(snap.abilities[a]) || 0).sort((a, b) => b - a);
        const bestPhysical = physVals[0] ?? 0;
        const secondBestPhysical = physVals[1] ?? 0;
        const corePhysical = median(PHYSICAL_ABILITIES.map((a) => Number(snap.abilities[a]) || 0));
        out.push({
          id: riderId, potentiale: tier, primaryType, age: snap.age, abilities: snap.abilities,
          loft, bestPhysical, secondBestPhysical, corePhysical, ratio: loft ? bestPhysical / loft : 0,
        });
      }
    }
  }
  return out;
}
