// #6110 frossen golden (#7587): "kontakten slukket = bit-identisk med i dag".
//
// Faste scenarier for de flader, byggetrinnene i #6110 roerer: dags-tick'et
// (traening og loebsdags-aksen), prognosen (evne, baand, type) og akademiets
// roster-prognose. Modulerne GIVES IND, saa den samme scenariefil kan koeres mod
// en frossen kopi af merge-base-koden (generatoren, kun i lanens scratch) og mod
// den nye kode (developmentXp6110Golden.test.js). Fixturen indeholder kun
// fingeraftryk (sha256), ingen balance-tal.
//
// Bevidst udeladt: evner der er null eller mangler. Rettelse F2 aendrer netop det
// svar med vilje (en manglende evne er manglende, ikke 0); det doemmes af
// dommerens egne proever.

import { createHash } from "node:crypto";

const EVNER = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression",
  "tactics", "teamwork", "leadership",
]);
const TYPER = Object.freeze(["sprinter", "tt", "climber", "puncheur", "brostensrytter", "baroudeur", "rouleur", "gc"]);
const FOKUS = Object.freeze(["vo2max", "vo2max_climb", "vo2max_punch", "threshold", "sprint", "endurance", "technique",
  "aero", "tempo", "restitution", "loebslaere", "cobbled_sectors", "echelon_drills", "attack_repeats"]);
const INTENSITET = Object.freeze(["easy", "normal", "hard", "recovery", "rest"]);
const DATOER = Object.freeze(["2026-11-14", "2026-11-16", "2026-12-03", "2027-02-11"]);

// Deterministisk pseudotilfaeldighed (ingen afhaengighed af motorens egne seeds).
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function ryttere(antal, seed) {
  const r = lcg(seed);
  const ud = [];
  for (let i = 0; i < antal; i++) {
    const abilities = {};
    for (const e of EVNER) abilities[e] = 15 + Math.floor(r() * 75);
    const primaryType = TYPER[Math.floor(r() * TYPER.length)];
    const secondaryType = r() < 0.4 ? null : TYPER[Math.floor(r() * TYPER.length)];
    ud.push({
      riderId: `golden-6110-${seed}-${i}`,
      age: 16 + Math.floor(r() * 21),
      potentiale: 1 + Math.round(r() * 10) / 2,
      primaryType, secondaryType, abilities,
    });
  }
  return ud;
}

const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

/** Dags-tick'et i den gamle model: traening, loebsdags-aksen, dagsloft, traener og facilitet. */
export function tickAftryk({ applyDailyTick }) {
  const r = lcg(6110);
  const ud = [];
  let n = 0;
  for (const rytter of ryttere(24, 1)) {
    for (const dateStr of DATOER) {
      n += 1;
      const focus = FOKUS[Math.floor(r() * FOKUS.length)];
      const intensity = INTENSITET[Math.floor(r() * INTENSITET.length)];
      const caps = {};
      for (const [e, v] of Object.entries(rytter.abilities)) caps[e] = Math.min(99, v + Math.floor(r() * 25));
      const progress = {};
      for (const e of EVNER) if (r() < 0.35) progress[e] = Math.round(r() * 2500) / 1000;
      const basis = {
        riderId: rytter.riderId, dateStr, age: rytter.age, abilities: rytter.abilities, caps, progress,
        program: { focus, intensity }, conditionMult: 0.85 + Math.round(r() * 30) / 100,
        potentiale: rytter.potentiale, primaryType: rytter.primaryType, secondaryType: rytter.secondaryType,
      };
      const varianter = [
        basis,
        { ...basis, hardDailyCap: 1, budgetDivisor: 140, tickSeedKey: `golden#gd${n}` },
        { ...basis, hardDailyCap: 2 },
        { ...basis, staff: { overall: 70 + (n % 25), dimensions: { physical: 80, mental: 55, technical: 60 }, levels: { u23: 85, senior: 75 }, roleSkills: {} },
          facilityTier: 1 + (n % 5), riderLevel: rytter.age <= 22 ? "u23" : "senior" },
        { ...basis, developmentXp: null, trainNowBonus: n % 2 === 0, abilityYieldMult: null },
      ];
      for (const s of varianter) {
        const t = applyDailyTick(s);
        ud.push({ abilities: t.abilities, progress: t.progress, gains: t.gains, score: t.score, noise: t.noise,
          status: t.status, trainingScore: t.trainingScore ?? null, xp: t.xp ?? null });
      }
    }
  }
  return { antal: ud.length, hash: sha(ud) };
}

/** Prognosen uden XP: evne-endpoint, baand og type-prognose pr. scout-niveau. */
export function prognoseAftryk({ prognoseAbilities, prognoseAbilityBands, PROGNOSIS_ENVELOPES, buildTypePrognosisBands }) {
  const evne = [];
  const baand = [];
  const typer = [];
  for (const rytter of ryttere(40, 2)) {
    const f = { nowAbilities: rytter.abilities, age: rytter.age, primaryType: rytter.primaryType, secondaryType: rytter.secondaryType };
    for (const envelope of [PROGNOSIS_ENVELOPES.spredt, PROGNOSIS_ENVELOPES.dedikeret]) {
      evne.push(prognoseAbilities({ ...f, potentiale: rytter.potentiale, envelope }));
    }
    baand.push(prognoseAbilityBands({ ...f, potLo: Math.max(1, rytter.potentiale - 0.75), potHi: Math.min(6, rytter.potentiale + 0.5) }));
    for (const level of [0, 1, 2, 3]) {
      typer.push(buildTypePrognosisBands({ ...f, potentiale: rytter.potentiale, level, riderId: rytter.riderId, teamId: "golden-hold" }));
    }
    typer.push(buildTypePrognosisBands({ ...f, potentiale: rytter.potentiale, level: 2, riderId: rytter.riderId, teamId: "golden-hold",
      scout: { overall: 55 } }));
  }
  return { evne: sha(evne), baand: sha(baand), typer: sha(typer), antal: typer.length };
}

/** Akademiets roster-prognose (samme kilde som Optag 2.0 og akademi-afsloeringen). */
export function rosterAftryk({ rosterPrognosis }) {
  const ud = [];
  let i = 0;
  for (const rytter of ryttere(20, 3)) {
    i += 1;
    for (const daysOnTeam of [0, 5, 20, 60]) {
      ud.push(rosterPrognosis({
        rider: { id: rytter.riderId, birthdate: `${2026 - rytter.age}-03-01` },
        abilities: rytter.abilities,
        potRow: { id: rytter.riderId, potentiale: rytter.potentiale, birthdate: `${2026 - rytter.age}-03-01`,
          primary_type: rytter.primaryType, secondary_type: rytter.secondaryType },
        daysOnTeam, speed: 1 + (i % 3) / 2, seasonNumber: 3, teamId: "golden-hold",
      }));
    }
  }
  return { antal: ud.length, hash: sha(ud) };
}
