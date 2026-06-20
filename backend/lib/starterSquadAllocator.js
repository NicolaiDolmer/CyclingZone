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

// Rytter-id'er på et hold (rækkefølge-stabil). Single-team-bootstrap bruger den
// til at afgøre om et markør-NULL hold mangler/har en delvis start-trup.
async function listTeamRiderIds(supabase, teamId) {
  const rows = await fetchAllRows(() =>
    supabase.from("riders").select("id").eq("team_id", teamId).order("id"));
  return rows.map((r) => r.id);
}

// Slet ryttere (concurrency-bounded). Bruges KUN til at rydde en delvis/ufuldstændig
// start-trup på et markør-NULL hold før en ren re-allokering (yderst sjælden sti —
// kræver en delvis-insert, som det ene batch-insert nedenfor gør næsten umulig).
async function deleteRiders(supabase, ids) {
  for (let i = 0; i < ids.length; i += WRITE_CONCURRENCY) {
    const batch = ids.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(batch.map((id) =>
      supabase.from("riders").delete().eq("id", id).then(({ error }) => {
        if (error) throw new Error(`delete partial starter ${id}: ${error.message}`);
      })));
  }
}

// #1563-markør: "fik dette hold nogensinde sin start-trup?" (teams.starter_squad_allocated_at).
// SANDHEDEN for idempotens — IKKE rytter-antallet — så et hold der selv har solgt
// ned under 8 aldrig får gratis ryttere. Service-role-managed (api.js + cron).
async function readSquadMarker(supabase, teamId) {
  const { data, error } = await supabase
    .from("teams").select("starter_squad_allocated_at").eq("id", teamId).single();
  if (error) throw new Error(`read starter-squad marker ${teamId}: ${error.message}`);
  return data?.starter_squad_allocated_at ?? null;
}

async function setSquadMarker(supabase, teamId, nowIso) {
  const { error } = await supabase
    .from("teams").update({ starter_squad_allocated_at: nowIso }).eq("id", teamId);
  if (error) throw new Error(`set starter-squad marker ${teamId}: ${error.message}`);
}

// #1563: indsæt en frisk svag 8-rytter-pulje DIREKTE med team_id sat (ikke
// team_id=null + separat assign-skridt). Det lukker orphan-vinduet: fejler noget
// efter insert, er rytterne EJET (ikke ejerløse i markedet), og en re-derive heler
// dem. Genbruger den svage pulje-mekanik (#1487) + derive-kæden (data-hale).
async function insertWeakSquadForTeam(supabase, teamId, { seed, referenceYear, generate, derive }) {
  const existingFoldedNames = await fetchExistingFoldedNames(supabase);
  // Per-hold seed: basis-offset (+1487, samme som relaunch-puljen) XOR hash(teamId).
  const teamSeed = deriveTeamSeed((seed + 1487) >>> 0, teamId);
  const poolPayload = buildWeakStarterPool({
    count: STARTER_SQUAD.SQUAD_SIZE, seed: teamSeed, referenceYear, existingFoldedNames, generate,
  }).map((r) => ({ ...r, team_id: teamId }));

  const insertedIds = [];
  for (let i = 0; i < poolPayload.length; i += INSERT_BATCH) {
    const batch = poolPayload.slice(i, i + INSERT_BATCH);
    const { data, error } = await supabase.from("riders").insert(batch).select("id");
    if (error) throw new Error(`starter-squad insert ${teamId} ved ${i}: ${error.message}`);
    insertedIds.push(...(data || []).map((r) => r.id));
  }

  // Data-hale-garanti: physiology→abilities→type→base_value for de nye ryttere.
  await derive(supabase, insertedIds, { dryRun: false });
  return insertedIds;
}

// #1560/#1563 — SINGLE-TEAM-allokering, robust mod delvis/transient fejl.
// Et NYT hold (oprettet efter relaunch via den normale signup-flow) får en spilbar
// start-trup fra SAMME svage pulje-mekanik (#1487) som relaunch-holdene. Synkron ved
// signup → holdet er aldrig tomt før responsen; en self-heal-sweep
// (runStarterSquadHealSweep) reparerer hold hvis selve signup-allokeringen fejlede.
//
//   • Per-hold seed (deriveTeamSeed) → varierede men reproducerbare trupper.
//   • Idempotens på MARKØREN starter_squad_allocated_at (#1563), IKKE rytter-antal:
//     markør sat → no-op (også hvis ejeren selv har solgt ned under 8 → ingen
//     gratis-trup-exploit). Markør NULL = bootstrap aldrig fuldført → alle holdets
//     nuværende ryttere (0-8) stammer fra et ufuldstændigt forsøg → bring til præcis
//     SQUAD_SIZE derive'de ryttere + sæt markøren.
//   • insert-med-team_id → intet orphan-vindue ved fejl.
export async function allocateStarterSquadForTeam(supabase, teamId, {
  seed = LAUNCH_POPULATION.seed,
  referenceYear = LAUNCH_POPULATION.referenceYear,
  generate = generateFictionalRiders,
  derive = deriveForRiderIds,
  now = () => new Date(),
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!teamId) throw new Error("teamId required");

  const marker = await readSquadMarker(supabase, teamId);
  if (marker) {
    return { teamId, skipped: "already-allocated", allocatedAt: marker, assigned: 0 };
  }

  const existingIds = await listTeamRiderIds(supabase, teamId);
  const n = existingIds.length;
  const SIZE = STARTER_SQUAD.SQUAD_SIZE;

  let assigned;
  let recovered = null;
  if (n === 0) {
    const ids = await insertWeakSquadForTeam(supabase, teamId, { seed, referenceYear, generate, derive });
    assigned = ids.length;
  } else if (n === SIZE) {
    // Insert lykkedes sidst, men derive/markør fejlede → re-derive (idempotent) + markér.
    await derive(supabase, existingIds, { dryRun: false });
    assigned = n;
    recovered = "re-derived";
  } else {
    // 0<n<SIZE: en yderst sjælden delvis-insert. Ryd det halve forsøg + re-allokér rent.
    await deleteRiders(supabase, existingIds);
    const ids = await insertWeakSquadForTeam(supabase, teamId, { seed, referenceYear, generate, derive });
    assigned = ids.length;
    recovered = "cleaned-partial";
  }

  await setSquadMarker(supabase, teamId, now().toISOString());
  return { teamId, assigned, ...(recovered ? { recovered } : {}) };
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

  // #1563: markér holdene som start-trup-allokeret, så self-heal-sweep'en og
  // single-team-bootstrappen ALDRIG re-allokerer dem (markør = sandhed). Uden det
  // ville et forever-relaunch-hold (markør NULL fra denne sti) blive "healet" af
  // sweep'en. Best-effort pr. hold — en fejl her efterlader holdet med sin trup,
  // og sweep'en re-deriver det blot (idempotent), så det må aldrig fejle relaunchen.
  const nowIso = new Date().toISOString();
  await Promise.all(teamIds.map((teamId) =>
    setSquadMarker(supabase, teamId, nowIso).catch((err) => {
      console.error(`[runStarterSquadAllocation] markér ${teamId} fejlede:`, err?.message || err);
    })));

  return { dryRun: false, teams: teamIds.length, poolSize: pool.length, assigned, leftToMarket: leftToMarket.length, stats };
}
