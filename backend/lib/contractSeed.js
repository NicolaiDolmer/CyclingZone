// Kontrakt-seed (#1309) — frossen løn + længde + udløbssæson på ejede ryttere.
// Pure helpers er deterministiske/seeded → dry-run == apply. DB-wrapper
// (runContractSeed, Task 3) læser ejede ryttere + founder-hold og skriver felterne.
//
// Beslutninger (ejer 13/6): kontrakter kun på ejede ryttere (free agents = NULL);
// founders 2 sæsoner; andre ejede blandet 1-3.

import { makeRng } from "./fictionalRiderGenerator.js";
import { fetchAllRows } from "./supabasePagination.js";

export const CONTRACT = Object.freeze({
  FOUNDER_LENGTH: 2,          // founder-hold: stabil trup i 2 sæsoner
  DEFAULT_ACQUIRE_LENGTH: 2,  // auto-kontrakt ved erhvervelse (create-if-missing)
  MIN_LENGTH: 1,
  MAX_LENGTH: 3,
  SALARY_RATE: 0.10,          // = den gamle generated-formel
  BASE_VALUE_FALLBACK: 1000,  // spejler RIDER_BASE_VALUE_FALLBACK
});

// Spejler den gamle generated kolonne EKSAKT:
// GREATEST(1, ROUND((COALESCE(base_value,1000)+prize_earnings_bonus)*0.10))
export function computeFrozenSalary({ base_value, prize_earnings_bonus } = {}) {
  const base = Number(base_value) > 0 ? Number(base_value) : CONTRACT.BASE_VALUE_FALLBACK;
  const mv = base + (Number(prize_earnings_bonus) || 0);
  return Math.max(1, Math.round(mv * CONTRACT.SALARY_RATE));
}

// ~1/3 hver af 1,2,3. rng = makeRng(seed) fra fictionalRiderGenerator.
export function pickContractLength(rng) {
  return CONTRACT.MIN_LENGTH + Math.floor(rng() * (CONTRACT.MAX_LENGTH - CONTRACT.MIN_LENGTH + 1));
}

// Sidste aktive sæson = startSeason + length - 1.
export function computeContractEndSeason(startSeasonNumber, length) {
  return startSeasonNumber + length - 1;
}

// #1309 kontrakt-on-acquire: returnér et patch der opretter en standard-kontrakt
// HVIS rytteren er kontraktløs (salary == null); ellers {} (eksisterende kontrakt
// arves UÆNDRET — regenerér ALDRIG). Bruges af alle erhvervelses-paths (auktion,
// transfer, swap, lån-buyout) så "ejede ryttere har altid salary != null" holder.
// currentSeasonNumber = aktiv sæson-number (default-håndteres af kalderen).
// NB: undefined salary behandles som kontraktløs (== null loose) — det er det
// ønskede for free agents der aldrig har haft en kontrakt.
export function contractOnAcquirePatch(rider, currentSeasonNumber) {
  if (rider && rider.salary != null) return {};
  const length = CONTRACT.DEFAULT_ACQUIRE_LENGTH;
  return {
    salary: computeFrozenSalary(rider),
    contract_length: length,
    contract_end_season: computeContractEndSeason(currentSeasonNumber, length),
  };
}

const WRITE_CONCURRENCY = 25;

// DB-wrapper: sæt kontrakt på alle ejede ryttere. Founders → 2 sæsoner; andre
// ejede → blandet 1-3 (seeded). Free agents (team_id NULL) røres ALDRIG.
// Kører i orchestratoren EFTER allocation + sæson-transition (kender sæson-number).
export async function runContractSeed(supabase, {
  dryRun = true,
  seed = 2026,
  getManagerTeams,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  let founderTeams;
  if (getManagerTeams) {
    founderTeams = await getManagerTeams(supabase);
  } else {
    const { getBetaManagerTeams } = await import("./betaResetService.js");
    founderTeams = await getBetaManagerTeams(supabase);
  }
  const founderIds = new Set(founderTeams.map((t) => t.id).filter(Boolean));

  const seasonRes = await supabase.from("seasons").select("number").eq("status", "active").maybeSingle();
  if (seasonRes?.error) throw new Error(`runContractSeed season lookup: ${seasonRes.error.message}`);
  const startSeason = seasonRes?.data?.number ?? 1;

  const owned = await fetchAllRows(() =>
    supabase.from("riders")
      .select("id, team_id, base_value, prize_earnings_bonus")
      .not("team_id", "is", null)
      .order("id"));

  const rng = makeRng(seed);
  const patches = owned.map((r) => {
    const length = founderIds.has(r.team_id) ? CONTRACT.FOUNDER_LENGTH : pickContractLength(rng);
    return {
      id: r.id,
      patch: {
        salary: computeFrozenSalary(r),
        contract_length: length,
        contract_end_season: computeContractEndSeason(startSeason, length),
      },
    };
  });

  if (dryRun) {
    return { dryRun: true, toSeed: patches.length, founders: founderIds.size, startSeason };
  }

  let seeded = 0;
  for (let i = 0; i < patches.length; i += WRITE_CONCURRENCY) {
    const batch = patches.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(batch.map(({ id, patch }) =>
      supabase.from("riders").update(patch).eq("id", id).then(({ error }) => {
        if (error) throw new Error(`contract seed ${id}: ${error.message}`);
      })));
    seeded += batch.length;
  }
  return { dryRun: false, seeded, founders: founderIds.size, startSeason };
}
