// Startholds-allokering (#1103) — hver aktiv manager får en løbsklar trup ved
// relaunch, så ingen starter med tom trup (koldstart-fix + læner sig ind i
// progression-kernen #1136).
//
// Ren kerne (allocateStarterSquads) er deterministisk/seeded → dry-run == apply.
// DB-wrapper (runStarterSquadAllocation) læser pool + managers og skriver team_id.
//
// Design (ejer-godkendt, konstanter tunbare):
//   • SQUAD_SIZE = MIN_RIDERS_FOR_RACE (8): kan stille op til løb fra dag 1.
//   • YOUTH_PER_TEAM unge (18-21, høj potentiale) + DOMESTIQUE_PER_TEAM domestiques.
//   • Top base_value-fraktion (stjerner) forhåndstildeles ALDRIG — vindes i auktionen.
//   • Stratificeret-lige: snake-draft på base_value → ~lige stærke hold.

import { makeRng } from "./fictionalRiderGenerator.js";
import { MIN_RIDERS_FOR_RACE } from "./marketUtils.js";
import { fetchAllRows } from "./supabasePagination.js";
import { LAUNCH_POPULATION } from "./fictionalLaunchPopulation.js";

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

export function computeAge(birthdate, referenceYear) {
  const year = Number(String(birthdate).slice(0, 4));
  return referenceYear - year;
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

export function allocateStarterSquads(pool, teamIds, { seed = LAUNCH_POPULATION.seed } = {}) {
  const C = STARTER_SQUAD;
  const rng = makeRng(seed);

  const byValueDesc = [...pool].sort((a, b) => (b.base_value || 0) - (a.base_value || 0));
  const starCount = Math.floor(pool.length * C.STAR_CUTOFF_FRACTION);
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

// DB-wrapper: læs ledige fiktive ryttere + manager-hold, allokér, skriv team_id.
export async function runStarterSquadAllocation(supabase, {
  dryRun = true,
  seed = LAUNCH_POPULATION.seed,
  referenceYear = LAUNCH_POPULATION.referenceYear,
  getManagerTeams,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  let teams;
  if (getManagerTeams) {
    teams = await getManagerTeams(supabase);
  } else {
    const { getBetaManagerTeams } = await import("./betaResetService.js");
    teams = await getBetaManagerTeams(supabase);
  }
  const teamIds = teams.map((t) => t.id).filter(Boolean);

  // Ledige fiktive ryttere (pcm_id null, aktive, ikke på hold endnu).
  const rows = await fetchAllRows(() =>
    supabase
      .from("riders")
      .select("id, birthdate, potentiale, base_value")
      .is("pcm_id", null)
      .eq("is_retired", false)
      .order("id"));
  const pool = rows.map((r) => ({
    id: r.id,
    age: computeAge(r.birthdate, referenceYear),
    potentiale: r.potentiale,
    base_value: r.base_value,
  }));

  const { assignments, leftToMarket, stats } = allocateStarterSquads(pool, teamIds, { seed });
  const pairs = Object.entries(assignments).flatMap(([teamId, ids]) =>
    ids.map((id) => ({ id, team_id: teamId })));

  if (dryRun) {
    return { dryRun: true, teams: teamIds.length, poolSize: pool.length, assigned: 0, toAssign: pairs.length, leftToMarket: leftToMarket.length, stats };
  }

  let assigned = 0;
  for (let i = 0; i < pairs.length; i += WRITE_CONCURRENCY) {
    const batch = pairs.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(batch.map(({ id, team_id }) =>
      supabase.from("riders").update({ team_id }).eq("id", id).then(({ error }) => {
        if (error) throw new Error(`assign ${id}: ${error.message}`);
      })));
    assigned += batch.length;
  }
  return { dryRun: false, teams: teamIds.length, poolSize: pool.length, assigned, leftToMarket: leftToMarket.length, stats };
}
