// Deterministisk rename-mapping for PCM-ryttere (#669, fuld navne-udskiftning).
//
// Ren logik uden I/O — CLI'en er scripts/generate-fictional-rider-names.mjs.
// Genbruger den merged #669-infrastruktur:
//   • makeRng (mulberry32) fra backend/lib/fictionalRiderGenerator.js — samme
//     seedede PRNG som launch-population-generatoren.
//   • foldNameNordic fra backend/lib/pcmRiderMatcher.js — samme fold som
//     resultat-importens navne-matching, så unikheds-garantien gælder præcis
//     dér hvor kollisioner gør skade (§3-fælden i docs/slices/669-fictional-riders.md).
//
// Garantier:
//   • Deterministisk: samme (seed, rytter-sæt) → identisk mapping. Input
//     sorteres på pcm_id før generering, så rækkefølgen i input-filen er
//     ligegyldig.
//   • Nationalitet bevares 1:1 — kun navnet ændres.
//   • Unikhed: foldNameNordic af hvert nyt fulde navn er unik mod (a) ALLE
//     eksisterende navne i korpus (alle 8.699 PCM-navne = kendte virkelige
//     proffer, + evt. ekstra navne fx allerede-indsatte fiktive ryttere) og
//     (b) alle andre genererede navne.
//   • Overflow-strategi: kan et cluster ikke levere et unikt simpelt navn
//     efter MAX_SIMPLE_ATTEMPTS, sammensættes et dobbelt-efternavn
//     (spansk pool: "Last1 Last2", øvrige: "Last1-Last2") — deterministisk
//     og rapporteret i stats, aldrig stille.

import { makeRng } from "../../backend/lib/fictionalRiderGenerator.js";
import { foldNameNordic } from "../../backend/lib/pcmRiderMatcher.js";
import {
  EXTENDED_CLUSTERS,
  extendedClusterForNationality,
  clusterCapacities,
} from "./fictional-name-pools-extended.mjs";

const MAX_SIMPLE_ATTEMPTS = 80;
const MAX_COMPOUND_ATTEMPTS = 200;

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function makeUniqueName(rng, clusterKey, usedFolded) {
  const cluster = EXTENDED_CLUSTERS[clusterKey];
  for (let attempt = 0; attempt < MAX_SIMPLE_ATTEMPTS; attempt++) {
    const first = pick(rng, cluster.first);
    const last = pick(rng, cluster.last);
    const folded = foldNameNordic(`${first} ${last}`);
    if (!usedFolded.has(folded)) {
      usedFolded.add(folded);
      return { firstname: first, lastname: last, compound: false };
    }
  }
  // Overflow: dobbelt-efternavn. Spansk navnetradition bruger to efternavne
  // med mellemrum; øvrige clusters får bindestreg (plausibelt bredt).
  const joiner = clusterKey === "spanish" ? " " : "-";
  for (let attempt = 0; attempt < MAX_COMPOUND_ATTEMPTS; attempt++) {
    const first = pick(rng, cluster.first);
    const lastA = pick(rng, cluster.last);
    const lastB = pick(rng, cluster.last);
    if (lastA === lastB) continue;
    const lastname = `${lastA}${joiner}${lastB}`;
    const folded = foldNameNordic(`${first} ${lastname}`);
    if (!usedFolded.has(folded)) {
      usedFolded.add(folded);
      return { firstname: first, lastname, compound: true };
    }
  }
  throw new Error(
    `Navne-pool udtømt for cluster "${clusterKey}" — udvid poolen i fictional-name-pools-extended.mjs.`,
  );
}

/**
 * Generér deterministisk rename-mapping for et sæt PCM-ryttere.
 *
 * @param {Array<{pcm_id:number, nationality_code:string, firstname:string, lastname:string}>} riders
 *   Ryttere der skal omdøbes. firstname/lastname er de NUVÆRENDE (PCM-)navne —
 *   de indgår kun i kollisions-korpus og kopieres ALDRIG til output.
 * @param {object} opts
 * @param {number} opts.seed  heltal — styrer al tilfældighed deterministisk
 * @param {Iterable<string>} [opts.extraFoldedNames]  ekstra foldede fulde navne
 *   der også skal undgås (fx allerede-indsatte fiktive ryttere fra #1135).
 * @returns {{ mapping: Array<{pcm_id:number, nationality_code:string, cluster:string,
 *   new_firstname:string, new_lastname:string, compound:boolean}>, stats: object }}
 */
export function generateRenameMapping(riders, { seed, extraFoldedNames = [] }) {
  if (!Number.isInteger(seed)) throw new Error("seed skal være et heltal");
  if (!Array.isArray(riders) || riders.length === 0) throw new Error("riders er tom");

  const seen = new Set();
  for (const r of riders) {
    if (!Number.isInteger(r.pcm_id)) throw new Error(`Ugyldigt pcm_id: ${JSON.stringify(r.pcm_id)}`);
    if (seen.has(r.pcm_id)) throw new Error(`Duplikeret pcm_id i input: ${r.pcm_id}`);
    seen.add(r.pcm_id);
    if (!r.nationality_code) throw new Error(`Rytter ${r.pcm_id} mangler nationality_code`);
  }

  // Kollisions-korpus: ALLE nuværende navne (kendte virkelige proffer) + extra.
  const corpus = new Set();
  for (const r of riders) {
    corpus.add(foldNameNordic(`${r.firstname || ""} ${r.lastname || ""}`));
  }
  for (const folded of extraFoldedNames) corpus.add(folded);

  // usedFolded starter som korpus-kopi: nye navne må hverken kollidere med
  // korpus eller hinanden. Korpus-sættet selv bevares til slut-verifikation.
  const usedFolded = new Set(corpus);

  const rng = makeRng(seed);
  const sorted = [...riders].sort((a, b) => a.pcm_id - b.pcm_id);

  const mapping = [];
  const byCluster = {};
  const byNationality = {};
  const fallbackNationalities = {};
  let compoundCount = 0;

  for (const rider of sorted) {
    const clusterKey = extendedClusterForNationality(rider.nationality_code);
    if (clusterKey === "generic") {
      fallbackNationalities[rider.nationality_code] =
        (fallbackNationalities[rider.nationality_code] || 0) + 1;
    }
    const { firstname, lastname, compound } = makeUniqueName(rng, clusterKey, usedFolded);
    if (compound) compoundCount++;
    byCluster[clusterKey] = (byCluster[clusterKey] || 0) + 1;
    byNationality[rider.nationality_code] = (byNationality[rider.nationality_code] || 0) + 1;
    mapping.push({
      pcm_id: rider.pcm_id,
      nationality_code: rider.nationality_code,
      cluster: clusterKey,
      new_firstname: firstname,
      new_lastname: lastname,
      compound,
    });
  }

  // ── Selv-verifikation (fail fast — aldrig stille) ────────────────────────────
  const newFolded = new Set();
  for (const m of mapping) {
    const folded = foldNameNordic(`${m.new_firstname} ${m.new_lastname}`);
    if (newFolded.has(folded)) throw new Error(`Internt unikheds-brud: ${m.new_firstname} ${m.new_lastname}`);
    if (corpus.has(folded)) throw new Error(`Kollision med eksisterende navn (foldet): ${m.new_firstname} ${m.new_lastname}`);
    newFolded.add(folded);
  }
  if (mapping.length !== riders.length) throw new Error("Mapping-count matcher ikke input-count");

  const capacities = clusterCapacities();
  const utilization = {};
  for (const [key, count] of Object.entries(byCluster)) {
    utilization[key] = {
      generated: count,
      capacity: capacities[key],
      pct: Math.round((count / capacities[key]) * 1000) / 10,
    };
  }

  return {
    mapping,
    stats: {
      seed,
      total: mapping.length,
      nationalities: Object.keys(byNationality).length,
      byCluster,
      byNationality,
      utilization,
      compoundCount,
      fallbackNationalities,
      corpusSize: corpus.size,
    },
  };
}

/**
 * Deterministisk repræsentativt sample til ejer-review.
 * Garanterer ≥2 rækker pr. anvendt cluster (så hver navne-pool kan reviewes),
 * resten fordeles proportionalt over nationaliteter (largest remainder).
 */
export function selectReviewSample(mapping, { size = 100 } = {}) {
  const byNat = new Map();
  for (const m of mapping) {
    if (!byNat.has(m.nationality_code)) byNat.set(m.nationality_code, []);
    byNat.get(m.nationality_code).push(m);
  }

  const picked = [];
  const pickedIds = new Set();
  const take = (m) => {
    if (m && !pickedIds.has(m.pcm_id)) {
      pickedIds.add(m.pcm_id);
      picked.push(m);
    }
  };

  // 1) ≥2 pr. cluster — tag fra clusterets største nationalitet (deterministisk:
  //    mapping er allerede sorteret på pcm_id fra generatoren).
  const byCluster = new Map();
  for (const m of mapping) {
    if (!byCluster.has(m.cluster)) byCluster.set(m.cluster, []);
    byCluster.get(m.cluster).push(m);
  }
  for (const key of [...byCluster.keys()].sort()) {
    const rows = byCluster.get(key);
    take(rows[0]);
    take(rows[Math.floor(rows.length / 2)]);
  }

  // 2) Resten proportionalt over nationaliteter (largest remainder), størst først.
  const total = mapping.length;
  const remaining = size - picked.length;
  if (remaining > 0) {
    const natEntries = [...byNat.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const quotas = natEntries.map(([iso, rows]) => ({
      iso,
      rows,
      exact: (rows.length / total) * remaining,
    }));
    for (const q of quotas) q.base = Math.floor(q.exact);
    let assigned = quotas.reduce((s, q) => s + q.base, 0);
    const byRemainder = [...quotas].sort((a, b) => (b.exact - b.base) - (a.exact - a.base) || a.iso.localeCompare(b.iso));
    for (const q of byRemainder) {
      if (assigned >= remaining) break;
      q.base++;
      assigned++;
    }
    for (const q of quotas) {
      let taken = 0;
      for (const m of q.rows) {
        if (taken >= q.base) break;
        if (pickedIds.has(m.pcm_id)) continue;
        take(m);
        taken++;
      }
    }
  }

  return picked.slice(0, Math.max(size, picked.length)).sort((a, b) =>
    a.cluster.localeCompare(b.cluster) || a.nationality_code.localeCompare(b.nationality_code) || a.pcm_id - b.pcm_id,
  );
}

// SQL-literal-escape (kun enkelt-anførselstegn er relevant for navne).
export function sqlString(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}
