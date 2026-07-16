// Kontrakt-seed (#1309) — frossen løn + længde + udløbssæson på ejede ryttere.
// Pure helpers er deterministiske/seeded → dry-run == apply. DB-wrapper
// (runContractSeed, Task 3) læser ejede ryttere + founder-hold og skriver felterne.
//
// Beslutninger (ejer 13/6): kontrakter kun på ejede ryttere (free agents = NULL);
// founders 2 sæsoner; andre ejede blandet 1-3.

import { makeRng } from "./fictionalRiderGenerator.js";
import { fetchAllRows } from "./supabasePagination.js";
import { SALARY_RATE } from "./economyConstants.js";

export const CONTRACT = Object.freeze({
  FOUNDER_LENGTH: 2,          // founder-hold: stabil trup i 2 sæsoner
  DEFAULT_ACQUIRE_LENGTH: 2,  // auto-kontrakt ved erhvervelse (create-if-missing)
  MIN_LENGTH: 1,
  MAX_LENGTH: 3,
  SALARY_RATE,                // E2 strict_fair_v1: 0.067 (delt SSOT i economyConstants)
  BASE_VALUE_FALLBACK: 1000,  // spejler RIDER_BASE_VALUE_FALLBACK
});

// Frossen løn (#1309): GREATEST(1, ROUND((COALESCE(base_value,1000)+prize_earnings_bonus)*SALARY_RATE)).
// SALARY_RATE = 0.067 efter E2-retunen (var 0.10 = den gamle generated-formel).
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

// #1719 fyrings-/opsigelses-gebyr (ejer-besluttet): manageren betaler en halv
// sæson-løn pr. resterende kontrakt-sæson for at fyre en rytter før tid.
//   gebyr = round(salary * max(1, contract_end_season - currentSeason + 1) * 0.5)
// max(1, ...) sikrer mindst én sæson, så en netop-udløbet/samme-sæson-kontrakt
// stadig koster et halvt års løn (manageren slipper aldrig gratis for en
// lønnet rytter). NULL/0-løn → 0 gebyr (gratis-kontrakt). NULL end-sæson
// behandles som "1 resterende" (gulvet).
export const RELEASE_BUYOUT_RATE = 0.5;

export function computeReleaseBuyoutFee({ salary, contractEndSeason, currentSeason } = {}) {
  const wage = Number(salary);
  if (!Number.isFinite(wage) || wage <= 0) return 0;
  const end = Number(contractEndSeason);
  const current = Number(currentSeason) || 1;
  const remaining = Number.isFinite(end) ? end - current + 1 : 1;
  const seasons = Math.max(1, remaining);
  return Math.round(wage * seasons * RELEASE_BUYOUT_RATE);
}

// #1720 kontraktforlængelse: forlæng kontrakten 1 sæson og genforhandl lønnen
// fra rytterens AKTUELLE markedsværdi (samme SALARY_RATE-formel som signering,
// så lønnen følger rytterens nuværende værdi i stedet for den gamle frosne).
// Returnerer et patch {salary, contract_length, contract_end_season}.
//
// Den nye udløbssæson forankres i max(eksisterende end, currentSeason) + 1, så
// en udløbet eller kontraktløs (NULL end) rytter altid forlænges til en sæson i
// fremtiden — ikke til en fortidens sæson. contract_length +1 (eller 1 hvis NULL).
export function computeContractExtension({
  market_value,
  base_value,
  prize_earnings_bonus,
  contract_end_season,
  contract_length,
  currentSeason = 1,
} = {}) {
  // Genberegn lønnen fra market_value hvis sat; ellers fra base_value+prize
  // (samme kilde som computeFrozenSalary / calculateRiderMarketValue).
  const mv = Number(market_value);
  const salaryBase = Number.isFinite(mv)
    ? { base_value: mv, prize_earnings_bonus: 0 }
    : { base_value, prize_earnings_bonus };
  const salary = computeFrozenSalary(salaryBase);

  const current = Number(currentSeason) || 1;
  const end = Number(contract_end_season);
  const anchor = Number.isFinite(end) ? Math.max(end, current) : current;
  const newEnd = anchor + 1;

  // #2424 clamp: riders_contract_length_check tillader kun 1..MAX_LENGTH.
  // En rytter der allerede er på MAX_LENGTH må forlænges (ny løn + ny
  // udløbssæson) uden at kontraktlængden crasher DB-constraintet — den
  // clampes i stedet til loftet i stedet for at vokse ubegrænset.
  const len = Number(contract_length);
  const rawLength = (Number.isFinite(len) && len > 0) ? len + 1 : 1;
  const newLength = Math.min(rawLength, CONTRACT.MAX_LENGTH);

  return {
    salary,
    contract_length: newLength,
    contract_end_season: newEnd,
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
