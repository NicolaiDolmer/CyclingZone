// Deterministisk simulerings-harness for passiv rytterudvikling (#1137 L0).
//
// FORMÅL: empirisk verifikation af de 5 acceptkriterier UDEN DB/prod (#1137 +
// [[feedback_simulate_before_ship_balance]]). Driver de SAMME rene funktioner som
// produktionens developRidersForSeason (riderProgression.js) over en syntetisk
// population på tværs af N sæsoner, og scorer trajektorierne mod scorecardet.
//
// Hvorfor genbruge engine-funktionerne i stedet for en parallel-model: simulationen
// skal bevise NETOP den kode der kører i season-transition — ikke en idealiseret
// kopi. buildCaps + developRiderSeason er rene (ingen DB/Date/Math.random), så hele
// kæden er reproducerbar og kan køres her uden mocks.
//
// Synthetic-only. Ingen DB, ingen prod, ingen Math.random/Date.now → al variation
// seedes via FNV-1a (seededUnit), så samme seed/population giver bit-identisk output
// (run-hash = idempotens-bevis for acceptkriterie e).

import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { RIDER_TYPES } from "./riderTypes.js";
import {
  buildCaps, developRiderSeason, seededUnit, peakAgeForType, PROGRESSION_CONFIG,
} from "./riderProgression.js";

const TYPE_KEYS = RIDER_TYPES.map((t) => t.key);

// Signatur-evnerne pr. type (positive type-vægte) — bruges til at måle "den evne der
// definerer rytteren" så scorecardet rapporterer meningsfuld bevægelse (ikke off-type
// støj). Falder tilbage til climbing hvis en type mangler positive vægte.
const SIGNATURE_ABILITIES = Object.fromEntries(
  RIDER_TYPES.map((t) => {
    const pos = Object.entries(t.weights).filter(([, w]) => w > 0).map(([k]) => k);
    return [t.key, pos.length ? pos : ["climbing"]];
  })
);

// ── Syntetisk population ────────────────────────────────────────────────────────
// Spænder alder 19..40 og potentiale 1..6 så ALLE faser (vækst/peak/decline/
// retirement) er repræsenteret. Deterministisk pr. seed (seededUnit, ingen RNG).
export function makeSyntheticPopulation({ count = 200, seed = 2026, baseAbility = 55 } = {}) {
  const pop = [];
  for (let i = 0; i < count; i++) {
    const id = `sim-${seed}-${i}`;
    const type = TYPE_KEYS[Math.floor(seededUnit(`type:${id}`) * TYPE_KEYS.length) % TYPE_KEYS.length];
    // Alder 19..40 jævnt udspændt over populationen (cyklisk), så hver fase fyldes.
    const age = 19 + (i % 22);
    // Potentiale 1..6 — biaset så unge har lidt højere spredning (realistisk talent-pool).
    const potRoll = seededUnit(`pot:${id}`);
    const potentiale = 1 + Math.floor(potRoll * 6); // 1..6
    // Baseline-abilities: signatur-evner lidt højere, off-type lidt lavere; seeded støj.
    const abilities = {};
    for (const ab of VISIBLE_ABILITIES) {
      const isSig = SIGNATURE_ABILITIES[type].includes(ab);
      const noise = (seededUnit(`ab:${id}:${ab}`) * 2 - 1) * 5; // ±5
      const v = baseAbility + (isSig ? 8 : -4) + noise;
      abilities[ab] = Math.max(1, Math.min(99, Math.round(v)));
    }
    pop.push({ id, primary_type: type, potentiale, age, abilities });
  }
  return pop;
}

// Sum af signatur-evner for én rytter (kerne-styrke-måler).
function signatureSum(type, abilities) {
  let s = 0;
  for (const ab of SIGNATURE_ABILITIES[type]) if (abilities[ab] != null) s += Number(abilities[ab]);
  return s;
}

function abilitySum(abilities) {
  let s = 0;
  for (const ab of VISIBLE_ABILITIES) if (abilities[ab] != null) s += Number(abilities[ab]);
  return s;
}

// FNV-1a over en streng → 8-hex hash (run-fingerprint til idempotens).
function fnv1aHex(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── Simulation: kør N sæsoner ───────────────────────────────────────────────────
// Hver sæson: byg loft fra første-sæsons-baseline (lazy-init én gang, som engine),
// kør developRiderSeason, ældes +1, stop ved retirement. Snapshot pr. sæson.
export function simulateProgression(population, { seasons = 3, startSeasonNumber = 2 } = {}) {
  const trajectories = [];
  let fingerprint = "";

  for (const rider of population) {
    let abilities = { ...rider.abilities };
    const caps = buildCaps(abilities, rider.primary_type, rider.potentiale);
    let age = rider.age;
    let retired = false;
    let retiredAtSeason = null;

    const snapshots = [{
      season: startSeasonNumber - 1, age,
      abilities: { ...abilities },
      signatureSum: signatureSum(rider.primary_type, abilities),
      abilitySum: abilitySum(abilities),
      retired: false,
    }];

    for (let s = 0; s < seasons; s++) {
      const seasonNumber = startSeasonNumber + s;
      if (retired) {
        // Pensioneret rytter fryses (ingen udvikling) — som is_retired-filteret i engine.
        snapshots.push({ season: seasonNumber, age, abilities: { ...abilities }, signatureSum: signatureSum(rider.primary_type, abilities), abilitySum: abilitySum(abilities), retired: true });
        continue;
      }
      const { next, retirement } = developRiderSeason(
        { id: rider.id, primary_type: rider.primary_type, potentiale: rider.potentiale, age },
        abilities, caps, seasonNumber
      );
      abilities = next;
      if (retirement.retire && !retired) { retired = true; retiredAtSeason = seasonNumber; }
      age += 1;
      snapshots.push({
        season: seasonNumber, age,
        abilities: { ...abilities },
        signatureSum: signatureSum(rider.primary_type, abilities),
        abilitySum: abilitySum(abilities),
        retired,
      });
    }

    const traj = {
      id: rider.id, primary_type: rider.primary_type, potentiale: rider.potentiale,
      startAge: rider.age, retired, retiredAtSeason, snapshots,
    };
    trajectories.push(traj);
    // Fingerprint: id + alle ability-værdier pr. snapshot (rækkefølge-stabil).
    fingerprint += `${rider.id}|` + snapshots.map((sn) =>
      `${sn.age}:${sn.retired ? "R" : "-"}:` + VISIBLE_ABILITIES.map((ab) => sn.abilities[ab]).join(",")
    ).join(";") + "\n";
  }

  return { trajectories, seasons, startSeasonNumber, hash: fnv1aHex(fingerprint), fingerprint };
}

// ── Scorecard: mål de 5 acceptkriterier mod simulationen ────────────────────────
export function scoreAcceptanceCriteria(sim) {
  const peakAge = PROGRESSION_CONFIG.peakAge;
  const trs = sim.trajectories;

  // (a) Ung høj-pot rytter (startAge ~21, potentiale >=4) stiger målbart i signatur.
  let bestRise = null;
  for (const tr of trs) {
    if (tr.startAge >= 19 && tr.startAge <= 23 && tr.potentiale >= 4) {
      const gain = tr.snapshots.at(-1).signatureSum - tr.snapshots[0].signatureSum;
      if (!bestRise || gain > bestRise.signatureGain) {
        bestRise = { id: tr.id, type: tr.primary_type, startAge: tr.startAge, potentiale: tr.potentiale, signatureGain: gain,
          from: tr.snapshots[0].signatureSum, to: tr.snapshots.at(-1).signatureSum };
      }
    }
  }
  const a = {
    met: !!bestRise && bestRise.signatureGain >= 3,
    exemplar: bestRise,
    detail: bestRise ? `${bestRise.id} (${bestRise.type}, pot ${bestRise.potentiale}, alder ${bestRise.startAge}→${bestRise.startAge + sim.seasons}): signatur ${bestRise.from}→${bestRise.to} (+${bestRise.signatureGain})` : "ingen ung høj-pot rytter fundet",
  };

  // (b) Ældre rytter (startAge > peak, fx 34) falder målbart i signatur.
  let bestDrop = null;
  for (const tr of trs) {
    if (tr.startAge > peakAge && tr.startAge <= peakAge + 8 && !tr.retired) {
      const drop = tr.snapshots[0].signatureSum - tr.snapshots.at(-1).signatureSum;
      if (!bestDrop || drop > bestDrop.signatureDrop) {
        bestDrop = { id: tr.id, type: tr.primary_type, startAge: tr.startAge, signatureDrop: drop,
          from: tr.snapshots[0].signatureSum, to: tr.snapshots.at(-1).signatureSum };
      }
    }
  }
  const b = {
    met: !!bestDrop && bestDrop.signatureDrop >= 2,
    exemplar: bestDrop,
    detail: bestDrop ? `${bestDrop.id} (${bestDrop.type}, alder ${bestDrop.startAge}→${bestDrop.startAge + sim.seasons}): signatur ${bestDrop.from}→${bestDrop.to} (−${bestDrop.signatureDrop})` : "ingen ældre rytter over peak fundet",
  };

  // (c) Retirements forekommer i høj-alder MED notifikations-hook (engine emitter
  //     rider_retired; her måler vi at beslutningen rammer). Tæl pr. sæson.
  const retiredTrs = trs.filter((tr) => tr.retired);
  const retiredByAge = {};
  for (const tr of retiredTrs) {
    const sn = tr.snapshots.find((x) => x.retired);
    const a2 = sn ? sn.age : tr.startAge;
    retiredByAge[a2] = (retiredByAge[a2] || 0) + 1;
  }
  const minRetireAge = retiredTrs.length ? Math.min(...retiredTrs.map((tr) => (tr.snapshots.find((x) => x.retired)?.age ?? 99))) : null;
  const c = {
    met: retiredTrs.length > 0 && (minRetireAge == null || minRetireAge >= PROGRESSION_CONFIG.retirement.windowStartAge),
    totalRetired: retiredTrs.length,
    retiredByAge,
    minRetireAge,
    detail: retiredTrs.length ? `${retiredTrs.length} pensioneret; yngste pensions-alder ${minRetireAge} (vindue starter ${PROGRESSION_CONFIG.retirement.windowStartAge})` : "ingen pensioneringer",
  };

  // (d) Board #813 youth-goal: gnsn. U25 ability-sum-vækst/sæson >= 8 (board-tærskel).
  //     Mål U25-ryttere (startAge < 25) der IKKE pensionerede; delta = (slut − start) / sæsoner.
  const u25 = trs.filter((tr) => tr.startAge < 25 && !tr.retired);
  const deltas = u25.map((tr) => (tr.snapshots.at(-1).abilitySum - tr.snapshots[0].abilitySum) / sim.seasons);
  const avgU25DeltaPerSeason = deltas.length ? deltas.reduce((s, v) => s + v, 0) / deltas.length : 0;
  const d = {
    met: avgU25DeltaPerSeason >= 8,
    avgU25DeltaPerSeason: Number(avgU25DeltaPerSeason.toFixed(2)),
    u25Count: u25.length,
    detail: `${u25.length} U25-ryttere; gnsn. ability-sum-vækst ${avgU25DeltaPerSeason.toFixed(2)}/sæson (board-mål >= 8)`,
  };

  // (e) Idempotens: re-kør simulationen → hash skal være identisk.
  const rerun = simulateProgression(rebuildPopulation(sim), { seasons: sim.seasons, startSeasonNumber: sim.startSeasonNumber });
  const e = {
    met: rerun.hash === sim.hash,
    hash: sim.hash,
    rerunHash: rerun.hash,
    detail: rerun.hash === sim.hash ? `re-run hash identisk (${sim.hash})` : `HASH-MISMATCH: ${sim.hash} != ${rerun.hash}`,
  };

  return { criteria: { a, b, c, d, e }, allMet: a.met && b.met && c.met && d.met && e.met };
}

// Rekonstruér start-population fra en sim (sæson-0-snapshot) — til idempotens-re-run.
function rebuildPopulation(sim) {
  return sim.trajectories.map((tr) => ({
    id: tr.id, primary_type: tr.primary_type, potentiale: tr.potentiale,
    age: tr.startAge, abilities: { ...tr.snapshots[0].abilities },
  }));
}

// ── Fuld pipeline + menneskelæsbar rapport ──────────────────────────────────────
export function runHarness({ count = 200, seed = 2026, seasons = 3 } = {}) {
  const population = makeSyntheticPopulation({ count, seed });
  const sim = simulateProgression(population, { seasons });
  const score = scoreAcceptanceCriteria(sim);
  const summaryText = formatReport({ count, seed, seasons, sim, score });
  return { count, seed, seasons, sim, score, allMet: score.allMet, hash: sim.hash, summaryText };
}

export function formatReport({ count, seed, seasons, sim, score }) {
  const c = score.criteria;
  const flag = (b) => (b ? "PASS" : "FAIL");
  const lines = [
    `Progression L0 (#1137) — deterministisk simulering`,
    `population=${count}  seed=${seed}  seasons=${seasons}  run-hash=${sim.hash}`,
    ``,
    `[${flag(c.a.met)}] (a) ung høj-pot stiger:   ${c.a.detail}`,
    `[${flag(c.b.met)}] (b) ældre rytter falder:  ${c.b.detail}`,
    `[${flag(c.c.met)}] (c) auto-retirement:      ${c.c.detail}`,
    `[${flag(c.d.met)}] (d) board #813 U25-delta:  ${c.d.detail}`,
    `[${flag(c.e.met)}] (e) idempotent re-run:    ${c.e.detail}`,
    ``,
    `ALLE 5 KRITERIER: ${score.allMet ? "OPFYLDT" : "IKKE OPFYLDT"}`,
  ];
  return lines.join("\n");
}
