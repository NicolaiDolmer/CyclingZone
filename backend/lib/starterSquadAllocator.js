// Startholds-allokering (#1103) — hver aktiv manager får en løbsklar trup ved
// relaunch, så ingen starter med tom trup (koldstart-fix + læner sig ind i
// progression-kernen #1136).
//
// Ren kerne (allocateStarterSquads) er deterministisk/seeded → dry-run == apply.
// DB-wrapper (runStarterSquadAllocation) GENERERER en dedikeret svag pulje, derive'r
// den, allokerer + skriver team_id.
//
// Design (ejer-godkendt, konstanter tunbare):
//   • SQUAD_SIZE = MIN_RIDERS_FOR_RACE (8): kan stille op til løb fra dag 1.
//   • YOUTH_PER_TEAM unge (18-21, høj potentiale) + DOMESTIQUE_PER_TEAM domestiques.
//   • #1487 approach B: start-trupperne kommer fra en DEDIKERET SVAG pulje
//     (STARTER_POOL_STAT_WINDOW), IKKE fra markeds-pyramiden. Markedet (de 800)
//     forbliver fuldt frit → managere bygger op via auktion/træning/ungdom.
//   • Stratificeret-lige: snake-draft på base_value → ~lige (svage) hold.

import { makeRng, generateFictionalRiders, toInsertPayload, STAT_KEYS } from "./fictionalRiderGenerator.js";
import { MIN_RIDERS_FOR_RACE } from "./marketUtils.js";
import { fetchAllRows } from "./supabasePagination.js";
import { LAUNCH_POPULATION } from "./fictionalLaunchPopulation.js";
import { foldNameNordic } from "./pcmRiderMatcher.js";
import { deriveForRiderIds } from "./backfillCores.js";

export const STARTER_SQUAD = Object.freeze({
  SQUAD_SIZE: MIN_RIDERS_FOR_RACE,        // 8
  YOUTH_PER_TEAM: 4,
  DOMESTIQUE_PER_TEAM: 4,
  YOUNG_AGE_MIN: 18,
  YOUNG_AGE_MAX: 21,
  YOUNG_POTENTIAL_MIN: 4.0,
  STAR_CUTOFF_FRACTION: 0.10,             // top 10% base_value bliver i markedet
  FAIRNESS_TOLERANCE_FRACTION: 0.15,      // tilladt max-min squad-base_value-spænd
});

// #1487 (ejer-valgt 19/6): start-trupperne var alt for stærke (median top-evne 73).
// Approach B = en DEDIKERET SVAG pulje genereres KUN til start-trupperne, mens
// markeds-pyramiden (de 800) forbliver fuldt fri. PCM-stats clampes ind i dette
// vindue FØR derivation. Relaunch/akademi seeder physiology UDEN `aero` →
// deriveAbilities falder tilbage til den rene lineære PCM-remap
// (ability = round(1 + clamp((stat-50)/35, 0, 1) * 98); INGEN kontrast-floor),
// så et vindue [50,57] giver de 13 styrke-evner ~5-21 = dybe domestikker (base_value
// ~7k, ingen stjerner) MEN med bevaret variation (4 distinkte rytter-typer). Lavere
// vindue = mere uniforme ryttere; [50,57] er ejer-valgt balance (svag + varieret).
export const STARTER_POOL_STAT_WINDOW = Object.freeze({ lo: 50, hi: 57 });

export function computeAge(birthdate, referenceYear) {
  const year = Number(String(birthdate).slice(0, 4));
  return referenceYear - year;
}

// Deterministisk 32-bit hash af en streng (FNV-1a). Bruges til at udlede et
// PER-HOLD seed for single-team-allokeringen, så to nye hold IKKE får identiske
// trupper, men hvert hold stadig er reproducerbart (samme teamId+seed → samme
// ryttere). team_id er en UUID → bredt hash-domæne.
export function hashStringToSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Per-hold seed: basis-seed XOR hash(teamId), holdt i 32-bit. Determinisk +
// hold-unik → varierede men reproducerbare start-trupper på tværs af nye hold.
export function deriveTeamSeed(baseSeed, teamId) {
  return ((baseSeed >>> 0) ^ hashStringToSeed(teamId)) >>> 0;
}

function seededShuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Snake-draft op til perTeam pr. hold; stopper hvis pool tømmes. Returnerer antal brugt.
function snakeDraft(sortedDesc, teamIds, perTeam, assignments, totals) {
  let idx = 0;
  for (let round = 0; round < perTeam; round++) {
    const order = round % 2 === 0 ? teamIds : [...teamIds].reverse();
    for (const t of order) {
      if (idx >= sortedDesc.length) return idx;
      assignments[t].push(sortedDesc[idx].id);
      totals[t] += sortedDesc[idx].base_value || 0;
      idx++;
    }
  }
  return idx;
}

export function allocateStarterSquads(pool, teamIds, {
  seed = LAUNCH_POPULATION.seed,
  starCutoffFraction = STARTER_SQUAD.STAR_CUTOFF_FRACTION,
} = {}) {
  const C = STARTER_SQUAD;
  const rng = makeRng(seed);

  // starCutoffFraction = 0 (svag #1487-pulje): hele puljen er allerede domestikker,
  // så der er ingen stjerner at holde tilbage → alle er eligible.
  const byValueDesc = [...pool].sort((a, b) => (b.base_value || 0) - (a.base_value || 0));
  const starCount = Math.floor(pool.length * starCutoffFraction);
  const stars = new Set(byValueDesc.slice(0, starCount).map((r) => r.id));
  const eligible = pool.filter((r) => !stars.has(r.id));

  const isYoung = (r) =>
    r.age >= C.YOUNG_AGE_MIN && r.age <= C.YOUNG_AGE_MAX && (r.potentiale || 0) >= C.YOUNG_POTENTIAL_MIN;
  const youngIds = new Set(eligible.filter(isYoung).map((r) => r.id));

  // Shuffle (fairness inden for værdi-bånd) → sortér desc for snake-balancering.
  const prep = (arr) => seededShuffle(arr, rng).sort((a, b) => (b.base_value || 0) - (a.base_value || 0));
  const youngPool = prep(eligible.filter((r) => youngIds.has(r.id)));
  const domPool = prep(eligible.filter((r) => !youngIds.has(r.id)));

  const assignments = Object.fromEntries(teamIds.map((t) => [t, []]));
  const totals = Object.fromEntries(teamIds.map((t) => [t, 0]));

  const yUsed = snakeDraft(youngPool, teamIds, C.YOUTH_PER_TEAM, assignments, totals);
  const dUsed = snakeDraft(domPool, teamIds, C.DOMESTIQUE_PER_TEAM, assignments, totals);

  // Top-up: hvis en pool er for lille, fyld resterende slots fra den anden (stadig u. stjerner).
  const leftover = [...youngPool.slice(yUsed), ...domPool.slice(dUsed)]
    .sort((a, b) => (b.base_value || 0) - (a.base_value || 0));
  let li = 0;
  for (const t of teamIds) {
    while (assignments[t].length < C.SQUAD_SIZE && li < leftover.length) {
      assignments[t].push(leftover[li].id);
      totals[t] += leftover[li].base_value || 0;
      li++;
    }
  }

  const assignedIds = new Set(teamIds.flatMap((t) => assignments[t]));
  const leftToMarket = pool.filter((r) => !assignedIds.has(r.id)).map((r) => r.id);
  const squadTotals = teamIds.map((t) => totals[t]);
  const stats = {
    minSquadBaseValue: squadTotals.length ? Math.min(...squadTotals) : 0,
    maxSquadBaseValue: squadTotals.length ? Math.max(...squadTotals) : 0,
    fairnessTolerance: (squadTotals.length ? Math.max(...squadTotals) : 0) * C.FAIRNESS_TOLERANCE_FRACTION,
  };
  return { assignments, leftToMarket, stats };
}

const WRITE_CONCURRENCY = 25;
const INSERT_BATCH = 500;

// #1487: byg en dedikeret SVAG start-pool (in-memory). Genbruger den ægte generator
// (typer/demografi/potentiale/alder bevares) og clamper KUN stat-felterne ind i
// vinduet før derivation → lave afledte styrke-evner. Returnerer ren INSERT-payload
// (pcm_id null, intet id/base_value — DB/derive ejer dem).
export function buildWeakStarterPool({
  count,
  seed,
  referenceYear,
  existingFoldedNames = new Set(),
  window = STARTER_POOL_STAT_WINDOW,
  generate = generateFictionalRiders,
}) {
  const { riders } = generate({ seed, count, referenceYear, existingFoldedNames });
  const clamped = riders.map((r) => {
    const stats = {};
    for (const k of STAT_KEYS) stats[k] = Math.max(window.lo, Math.min(window.hi, r[k]));
    return { ...r, ...stats };
  });
  return toInsertPayload(clamped);
}

// Navne-unikhed mod ALLE eksisterende ryttere (den svage pulje genereres separat
// fra markeds-pyramiden → må ikke kollidere på navn, jf. PCM-import-fælden i #669).
async function fetchExistingFoldedNames(supabase) {
  const existing = await fetchAllRows(() =>
    supabase.from("riders").select("firstname, lastname").order("id"));
  return new Set(existing.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`)));
}

// DELT KERNE (relaunch + single-team): indsæt en svag pulje, kør hele derive-kæden
// (data-hale-garanti: physiology→abilities→type→base_value) og læs base_value +
// demografi tilbage som allokerings-pulje. Begge call-sites MÅ bruge denne, så
// start-truppernes balance ikke kan drifte mellem batch- og single-varianten.
async function insertDeriveAndReadPool(supabase, poolPayload, { referenceYear, derive }) {
  // 1) Indsæt svag pulje, fang DB-genererede id'er.
  const insertedIds = [];
  for (let i = 0; i < poolPayload.length; i += INSERT_BATCH) {
    const batch = poolPayload.slice(i, i + INSERT_BATCH);
    const { data, error } = await supabase.from("riders").insert(batch).select("id");
    if (error) throw new Error(`weak-pool insert ved ${i}: ${error.message}`);
    insertedIds.push(...(data || []).map((r) => r.id));
  }

  // 2) Data-hale-garanti: physiology→abilities→type→base_value for de nye ryttere.
  await derive(supabase, insertedIds, { dryRun: false });

  // 3) Læs base_value (+ alder/potentiale) tilbage → allokerings-pulje.
  const rows = await fetchAllRows(() =>
    supabase.from("riders").select("id, birthdate, potentiale, base_value").in("id", insertedIds).order("id"));
  return rows.map((r) => ({
    id: r.id,
    age: computeAge(r.birthdate, referenceYear),
    potentiale: r.potentiale,
    base_value: r.base_value,
  }));
}

// DELT KERNE: skriv team_id på de allokerede ryttere (concurrency-bounded).
async function writeTeamAssignments(supabase, pairs) {
  let assigned = 0;
  for (let i = 0; i < pairs.length; i += WRITE_CONCURRENCY) {
    const batch = pairs.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(batch.map(({ id, team_id }) =>
      supabase.from("riders").update({ team_id }).eq("id", id).then(({ error }) => {
        if (error) throw new Error(`assign ${id}: ${error.message}`);
      })));
    assigned += batch.length;
  }
  return assigned;
}

// Antal eksisterende ryttere på et hold (idempotens-guard for single-team-bootstrap).
async function countTeamRiders(supabase, teamId) {
  const rows = await fetchAllRows(() =>
    supabase.from("riders").select("id").eq("team_id", teamId).order("id"));
  return rows.length;
}

// #1560 — SINGLE-TEAM-allokering: et NYT hold (oprettet efter relaunch via den
// normale signup-flow) får automatisk en spilbar start-trup fra SAMME svage pulje-
// mekanik (#1487) som relaunch-holdene fik. Synkron ved signup → holdet er aldrig
// tomt før responsen. Deler kerne-generering + insert/derive/write med
// runStarterSquadAllocation, så de to varianter ikke kan drifte balance-mæssigt.
//
//   • Per-hold seed (deriveTeamSeed) → varierede men reproducerbare trupper.
//   • Idempotens-guard: har holdet ≥1 rytter, gør INTET (beskytter mod dobbelt-
//     bootstrap ved samtidige/gentagne signup-kald — samme race-mønster som
//     team-create i teamProfileEngine.js).
export async function allocateStarterSquadForTeam(supabase, teamId, {
  seed = LAUNCH_POPULATION.seed,
  referenceYear = LAUNCH_POPULATION.referenceYear,
  generate = generateFictionalRiders,
  derive = deriveForRiderIds,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!teamId) throw new Error("teamId required");

  // Idempotens: allokér aldrig dobbelt. Et samtidigt/gentaget bootstrap-kald
  // (eller et hold der allerede fik trup ved relaunch) skal være et no-op.
  const existingRiders = await countTeamRiders(supabase, teamId);
  if (existingRiders > 0) {
    return { teamId, skipped: "already-has-riders", existingRiders, assigned: 0 };
  }

  const count = STARTER_SQUAD.SQUAD_SIZE;
  const existingFoldedNames = await fetchExistingFoldedNames(supabase);

  // Per-hold seed: basis-offset (+1487, samme som relaunch-puljen) XOR hash(teamId)
  // → hvert nyt hold får sin egen reproducerbare, varierede 8-rytter-pulje.
  const teamSeed = deriveTeamSeed((seed + 1487) >>> 0, teamId);
  const poolPayload = buildWeakStarterPool({
    count,
    seed: teamSeed,
    referenceYear,
    existingFoldedNames,
    generate,
  });

  const pool = await insertDeriveAndReadPool(supabase, poolPayload, { referenceYear, derive });

  // Allokér hele puljen til det ene hold (starCutoffFraction 0 — alt er svagt).
  const { assignments, stats } = allocateStarterSquads(pool, [teamId], { seed: teamSeed, starCutoffFraction: 0 });
  const pairs = (assignments[teamId] || []).map((id) => ({ id, team_id: teamId }));
  const assigned = await writeTeamAssignments(supabase, pairs);

  return { teamId, poolSize: pool.length, assigned, stats };
}

// DB-wrapper (#1487 approach B): generér en dedikeret svag pulje (N×SQUAD_SIZE),
// indsæt den, kør hele derive-kæden (data-hale-garanti: physiology→abilities→type→
// base_value), allokér til holdene og skriv team_id. Markeds-pyramiden (de 800)
// røres IKKE — den forbliver fuldt fri til auktionen.
export async function runStarterSquadAllocation(supabase, {
  dryRun = true,
  seed = LAUNCH_POPULATION.seed,
  referenceYear = LAUNCH_POPULATION.referenceYear,
  getManagerTeams,
  deps = {},
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const d = { generate: generateFictionalRiders, derive: deriveForRiderIds, ...deps };

  let teams;
  if (getManagerTeams) {
    teams = await getManagerTeams(supabase);
  } else {
    const { getBetaManagerTeams } = await import("./betaResetService.js");
    teams = await getBetaManagerTeams(supabase);
  }
  const teamIds = teams.map((t) => t.id).filter(Boolean);
  const count = teamIds.length * STARTER_SQUAD.SQUAD_SIZE;

  const existingFoldedNames = await fetchExistingFoldedNames(supabase);

  // Eget seed-offset så puljen ikke spejler markeds-populationens første N ryttere.
  const poolPayload = buildWeakStarterPool({
    count,
    seed: (seed + 1487) >>> 0,
    referenceYear,
    existingFoldedNames,
    generate: d.generate,
  });

  if (dryRun) {
    return { dryRun: true, teams: teamIds.length, poolSize: count, assigned: 0, toAssign: count };
  }

  // Delt kerne: insert → derive (data-hale) → læs allokerings-pulje tilbage.
  const pool = await insertDeriveAndReadPool(supabase, poolPayload, { referenceYear, derive: d.derive });

  // Allokér (starCutoffFraction 0 — hele puljen er svag, ingen stjerner).
  const { assignments, leftToMarket, stats } = allocateStarterSquads(pool, teamIds, { seed, starCutoffFraction: 0 });
  const pairs = Object.entries(assignments).flatMap(([teamId, ids]) =>
    ids.map((id) => ({ id, team_id: teamId })));

  // Skriv team_id (delt kerne).
  const assigned = await writeTeamAssignments(supabase, pairs);
  return { dryRun: false, teams: teamIds.length, poolSize: pool.length, assigned, leftToMarket: leftToMarket.length, stats };
}
